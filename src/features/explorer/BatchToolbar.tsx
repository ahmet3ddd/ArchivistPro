// Toplu islem arac cubugu (Faz 7.5; kontrol-paritesi genisletmesi) — `selectedIds.length > 0`
// iken AssetGrid'de mevcut arac cubugunun ALTINDA gosterilir.
//
// Secili sayi + "Tumunu sec" (su an YUKLU items id'leri) + "Temizle". Yazma eylemleri (editor+,
// viewer'da gizli): favori EKLE/CIKAR · etiket EKLE/KALDIR · koleksiyona EKLE/CIKAR · cope at.
// Etiket/koleksiyon eylemleri ebeveyn (AssetGrid) PickerModal'ini ACAR (ekle=find-or-create,
// kaldir=yalniz-secim). Dogrudan eylemler (favori/cop) useBulkActions ile burada calisir.
// Toplu yazma sonrasi bumpFacets/bumpData (useBulkActions) durumu tazeler; secim korunur
// (ardisik toplu islem) — yalniz "Temizle" ve "cope at" secimi bosaltir.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { AssetRow } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useSession } from "../../hooks/useSession";
import { BulkProjectStatusModal } from "../assets/detail/BulkProjectStatusModal";
import { ProjectAssignModal } from "../projects/ProjectAssignModal";
import { useBgTaskStore } from "../bgtask/bgTaskStore";
import { getDefaultVisionModel } from "../settings/aiSettings";
import { useVisionOutcomeToast } from "../settings/useVisionOutcomeToast";
import { OrganizeModal } from "../refile/OrganizeModal";
import { useRefileMove } from "../refile/useRefileMove";
import { useToast } from "../toast/useToast";
import { useUiStore } from "../../store/useUiStore";
import { useBulkActions } from "./useBulkActions";

interface Props {
  /** O an YUKLU (sanal-pencere degil; sonsuz-kaydirmada biriken) liste — "tumunu sec" kaynagi. */
  items: AssetRow[];
  /** Sorgunun tam sonuc sayisi; buton yuklu alt-kumeyi sectigini acikca gostermek icin. */
  total: number;
  /** Toplu etiket EKLE → ebeveyn PickerModal acar (autocomplete + find-or-create). */
  onAddTag: (ids: number[]) => void;
  /** Toplu etiket KALDIR → ebeveyn PickerModal acar (yalniz mevcut etiketler). */
  onRemoveTag: (ids: number[]) => void;
  /** Toplu koleksiyona EKLE → ebeveyn PickerModal acar (find-or-create). */
  onAddToCollection: (ids: number[]) => void;
  /** Toplu koleksiyondan CIKAR → ebeveyn PickerModal acar (yalniz mevcut koleksiyonlar). */
  onRemoveFromCollection: (ids: number[]) => void;
}

export function BatchToolbar({
  items,
  total,
  onAddTag,
  onRemoveTag,
  onAddToCollection,
  onRemoveFromCollection,
}: Props) {
  const { t } = useTranslation();
  const { canWrite, isAdmin } = useSession();
  const toast = useToast();
  const notifyVisionOutcome = useVisionOutcomeToast();
  const selectedIds = useUiStore((s) => s.selectedIds);
  const setSelectedMany = useUiStore((s) => s.setSelectedMany);
  const clearSelected = useUiStore((s) => s.clearSelected);
  const bumpData = useUiStore((s) => s.bumpData);
  const bumpFacets = useUiStore((s) => s.bumpFacets);
  const bgStart = useBgTaskStore((s) => s.start);
  const bgUpdate = useBgTaskStore((s) => s.update);
  const bgEnd = useBgTaskStore((s) => s.end);
  const { setFavoriteMany, trashMany } = useBulkActions();

  // Yeniden-indeksleme yerel durumu (admin bakim eylemi) — ilerleme HEM buton metninde (inline) HEM
  // global BgTaskBanner'da (her gorunumden gorunur). `reindexing` buton disabled + ilerleme kilidi.
  const [reindexing, setReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState({ processed: 0, total: 0 });
  // XMP sidecar dis-aktarim (admin; FS-yazma) — dosya yanina .xmp yazar (olmazsa fallback).
  const [xmpBusy, setXmpBusy] = useState(false);

  // AI gorsel-analiz (admin) — SECIM kapsami (`{ kind:"ids" }`). bulkReindex ile birebir desen:
  // inline buton ilerlemesi + global BgTaskBanner + iptal. `stopImageAnalysis` ile durdurulabilir
  // (kalan is bekleyen kalir → resumable). Analiz sonrasi bumpData+bumpFacets → analiz edilenler
  // artik metin aramasinda/facet'lerde gorunur.
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState({ processed: 0, total: 0 });

  // Toplu "Tasi" (admin) — klasor-secici → refileAssets. Ilerleme buton metninde; bitince ozet
  // toast + bumpData (grid tazelensin, tasinan dosyalar yeni klasorde). AssetDetailPanel ile paylasik.
  const { moving, progress: moveProgress, move } = useRefileMove(() => bumpData());

  // Toplu "Kural ile duzenle" (admin) — OrganizeModal acar (onizleme + hedef-kok + calistir).
  // Basari sonrasi bumpData (grid tazelensin; duzenlenen dosyalar yeni klasorlerde).
  const [organizeOpen, setOrganizeOpen] = useState(false);

  // Toplu "Proje durumu" (editor+) — BulkProjectStatusModal acar (secili alanlari tum dosyalara
  // yaz). Basari sonrasi bumpData + bumpFacets (liste + onay-durumu faceti tazelensin).
  const [projectOpen, setProjectOpen] = useState(false);

  // Toplu "Projeye Ata" (editor+) — ProjectAssignModal acar (secili asset'leri bir projeye ata /
  // atamayi kaldir). Basari sonrasi bumpData (liste + proje asset-sayimlari tazelensin).
  const [assignOpen, setAssignOpen] = useState(false);

  const count = selectedIds.length;
  if (count === 0) return null;

  const selectAll = () => setSelectedMany(items.map((a) => a.id));
  const allLoadedSelected =
    items.length > 0 && items.every((item) => selectedIds.includes(item.id));

  const bulkFavorite = (on: boolean) => {
    void setFavoriteMany(selectedIds, on).catch(() => undefined);
  };

  const bulkTrash = () => {
    void trashMany(selectedIds).catch(() => undefined);
  };

  // Secili asset'ler icin XMP sidecar yaz (admin; FS'e additive .xmp). Ozet toast'lanir:
  // written+fallback = yazilan; hata varsa ayri uyari. Kaynak dosyaya dokunmaz.
  const exportXmp = async () => {
    if (xmpBusy) return;
    setXmpBusy(true);
    try {
      const r = await ipc.exportXmpSidecars(selectedIds);
      const ok = r.written + r.fallback;
      if (r.errors.length > 0) {
        toast.error(t("xmp.done_errors", { ok, errors: r.errors.length }));
      } else {
        toast.success(t("xmp.done", { count: ok }));
      }
    } catch {
      toast.error(t("xmp.failed"));
    } finally {
      setXmpBusy(false);
    }
  };

  // Secili asset'leri ZORLA yeniden-indeksle (admin; cikarici iyilesince thumbnail/phash/renk
  // geri-doldurulur). Sonra bumpData → thumbnail'lar tazelensin (grid yeniden ceker; secim de
  // temizlenir, mevcut yikici-olmayan toplu-islem tazeleme deseni). Silme YOK.
  const bulkReindex = async () => {
    if (reindexing) return;
    const ids = selectedIds;
    setReindexing(true);
    setReindexProgress({ processed: 0, total: ids.length });
    const taskId = bgStart("reindex", ids.length); // buton metnine EK global banner (her gorunumden gorunur)
    try {
      const report = await ipc.reindexAssets(ids, (p) => {
        setReindexProgress(p);
        bgUpdate(taskId, { processed: p.processed, total: p.total });
      });
      toast.success(
        t("reindex.done", {
          reindexed: report.reindexed,
          missing: report.missing,
          failed: report.failed,
        }),
      );
      bumpData(); // thumbnail'lar tazelensin (grid yeniden ceker)
    } catch {
      toast.error(t("reindex.failed"));
    } finally {
      setReindexing(false);
      bgEnd(taskId);
    }
  };

  // Secili gorselleri AI vision ile analiz et (admin; SECIM kapsami). Model: Ayarlar'daki varsayilan
  // vision modeli (bos → backend varsayilani). Ollama/vision yoksa backend Err → toast. Iptal edilebilir
  // (cancelAnalyze → stopImageAnalysis). Bitince ozet toast + bumpData/bumpFacets (aranabilir hale gelir).
  const bulkAnalyze = async () => {
    if (analyzing) return;
    const ids = selectedIds;
    setAnalyzing(true);
    setAnalyzeProgress({ processed: 0, total: ids.length });
    const taskId = bgStart("analyze", ids.length); // buton metnine EK global banner (her gorunumden gorunur)
    try {
      const report = await ipc.runImageAnalysis(
        getDefaultVisionModel(),
        { kind: "ids", ids },
        (p) => {
          setAnalyzeProgress({ processed: p.processed, total: p.total });
          bgUpdate(taskId, { processed: p.processed, total: p.total });
        },
      );
      const abortedAfter = report.abortedAfterConsecutiveFailures ?? null;
      if (abortedAfter) {
        // Devre kesici kosuyu yarida kesti → "tamamlandi" gostermek yaniltici olurdu. AMA yalniz
        // "art arda N hata" demek de yetmez (canli dogrulama 2026-08-15): o N dosyaya ne oldugu,
        // isaretlendikleri ve nerede bulunacaklari da soylenmeli → bildirim tek yerden uretilir
        // (durdurma cumlesi on-ek olarak icinde).
        notifyVisionOutcome(report);
      } else if (report.stopped) {
        toast.info(t("vision_index.stopped_toast", { analyzed: report.analyzed }));
      } else {
        toast.success(
          t("batch.analyze_ai_done", { analyzed: report.analyzed, failed: report.failed }),
        );
      }
      // Ham Ollama govdesi DEGIL, anlasilir sinif cumlesi (ham metin `tauri dev` konsolunda).
      // Eleme (`unusable_output`) durumunda cumle SAYILI kurulur ve elenen gorselleri gosteren
      // bir eylem butonu tasir — "bekliyor" demek yerine BEKLEYENI gosterir.
      if (report.failed > 0 && !abortedAfter) notifyVisionOutcome(report);
      bumpData(); // analiz edilenler artik aranabilir → liste tazelensin
      bumpFacets(); // vision-etiketleri facet'lere yansisin
    } catch (e: unknown) {
      toast.error(t("vision_index.failed", { message: String(e) }));
    } finally {
      setAnalyzing(false);
      bgEnd(taskId);
    }
  };

  // Aktif analiz kosusunu durdur ("İptal"; admin). Backend bayrak set eder → kosu araya girip biter,
  // rapor `stopped=true` doner (bulkAnalyze'daki toast'i tetikler).
  const cancelAnalyze = () => {
    void ipc.stopImageAnalysis().catch(() => undefined);
  };

  const btn =
    "rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50";
  const dangerBtn =
    "rounded-md border border-danger/40 bg-bg-tertiary px-2 py-1 text-xs text-danger transition hover:border-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50";
  const sep = <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-secondary/60 px-4 py-2 backdrop-blur-lg">
      <span className="text-xs font-medium text-accent">
        {t("batch.selected", { count })}
      </span>
      <button
        type="button"
        onClick={selectAll}
        disabled={allLoadedSelected}
        className={btn}
      >
        {t("batch.select_loaded", { loaded: items.length, total })}
      </button>
      <button type="button" onClick={clearSelected} className={btn}>
        {t("batch.clear")}
      </button>

      {canWrite && (
        <>
          {sep}
          <button type="button" onClick={() => bulkFavorite(true)} className={btn}>
            ★ {t("batch.bulk_favorite")}
          </button>
          <button type="button" onClick={() => bulkFavorite(false)} className={btn}>
            ☆ {t("batch.bulk_unfavorite")}
          </button>
          {sep}
          <button type="button" onClick={() => onAddTag(selectedIds)} className={btn}>
            {t("batch.bulk_tag")}
          </button>
          <button type="button" onClick={() => onRemoveTag(selectedIds)} className={btn}>
            {t("batch.bulk_untag")}
          </button>
          {sep}
          <button type="button" onClick={() => onAddToCollection(selectedIds)} className={btn}>
            {t("batch.bulk_collection")}
          </button>
          <button
            type="button"
            onClick={() => onRemoveFromCollection(selectedIds)}
            className={btn}
          >
            {t("batch.bulk_uncollection")}
          </button>
          {sep}
          <button type="button" onClick={() => setProjectOpen(true)} className={btn}>
            {t("project.bulk.action")}
          </button>
          <button type="button" onClick={() => setAssignOpen(true)} className={btn}>
            {t("projects.assign")}
          </button>
          {sep}
          <button type="button" onClick={bulkTrash} className={dangerBtn}>
            {t("batch.bulk_trash")}
          </button>
        </>
      )}

      {/* Yeniden-indeksle: yalniz admin (reindex backend'de admin-gated). Cikarici iyilesince
          secili dosyalar (or. thumbnail'siz PSD) zorla yeniden cikarilir → thumbnail/phash/renk. */}
      {isAdmin && (
        <>
          {sep}
          <button
            type="button"
            onClick={() => void bulkReindex()}
            disabled={reindexing}
            className={btn}
          >
            {reindexing ? t("reindex.running", reindexProgress) : t("reindex.action")}
          </button>
          <button
            type="button"
            onClick={() => void move(selectedIds)}
            disabled={moving}
            className={btn}
          >
            {moving ? t("refile.moving", moveProgress) : t("refile.move")}
          </button>
          <button type="button" onClick={() => setOrganizeOpen(true)} className={btn}>
            {t("organize.action")}
          </button>
          {/* XMP sidecar dis-aktar — kurate metadata'yi .xmp'e (Adobe Bridge/Lightroom okur). */}
          <button
            type="button"
            onClick={() => void exportXmp()}
            disabled={xmpBusy}
            className={btn}
          >
            {xmpBusy ? t("xmp.running") : t("xmp.action")}
          </button>
          {sep}
          {/* AI ile analiz et (SECIM kapsami) — Ollama vision → metin betim → aranabilir. Uzun is
              (saniyeler/gorsel); iptal edilebilir. Backend Ollama/vision yoksa Err → toast gosterir. */}
          <button
            type="button"
            onClick={() => void bulkAnalyze()}
            disabled={analyzing}
            className={btn}
          >
            {analyzing
              ? t("batch.analyze_ai_running", analyzeProgress)
              : t("batch.analyze_ai", { count })}
          </button>
          {analyzing && (
            <button type="button" onClick={cancelAnalyze} className={dangerBtn}>
              {t("vision_index.cancel")}
            </button>
          )}
        </>
      )}

      {organizeOpen && (
        <OrganizeModal
          ids={selectedIds}
          onClose={() => setOrganizeOpen(false)}
          onDone={() => bumpData()}
        />
      )}

      {projectOpen && (
        <BulkProjectStatusModal
          ids={selectedIds}
          onClose={() => setProjectOpen(false)}
          onDone={() => {
            bumpData();
            bumpFacets();
          }}
        />
      )}

      {assignOpen && (
        <ProjectAssignModal
          ids={selectedIds}
          onClose={() => setAssignOpen(false)}
          onDone={() => bumpData()}
        />
      )}
    </div>
  );
}
