// Kopya Bulucu paneli (P3 dedup; H2 DuplicateFinderModal pariti) — overlay/portal (AuditLogPanel/
// BackupPanel deseni: TopBar backdrop-blur containing-block tuzagindan kacmak icin
// `createPortal(document.body)`; scrim/Esc kapatir).
//
// Kontroller: 4 tarama modu (birebir / ayni-ad / gorsel-benzer / yapisal-benzer) + gorsel & yapisal
// icin benzerlik-esigi slider'lari. "Tara" → `findDuplicates` (salt-okuma; her rol). Sonuc: ozet +
// grup kartlari (DuplicateGroupCard). Silme editor+ (canWrite); cop sonrasi yerel rapor tazelenir
// (uyeler cikar, <2 uye kalan grup dusuruler) + bumpData (ana gorunum) + toast.
//
// MASTER-DETAY: bir uyeye tiklayinca detay panelin ICINDE (sag sutun) acilir — finder KAPANMAZ,
// sonuclar solda kalir (yan yana karsilastirma). Detay = ana arayuzdeki AssetDetailPanel'in AYNISI
// (`assetId` ile guudumlenir → global secimi ETKILEMEZ). (Onceki "kucult + sonuclara don" pill
// desenini degistirir: kullanici istegi "panelin disina cikmak yerine detay burada".)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { ContextualHelp, type HelpSection } from "../../components/ContextualHelp";
import type { DuplicateReport } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useSession } from "../../hooks/useSession";
import { useThumbnails } from "../../hooks/useThumbnails";
import { useUiStore } from "../../store/useUiStore";
import type { DedupSeed } from "../../store/useUiStore";
import { AssetDetailPanel } from "../assets/AssetDetailPanel";
import { useToast } from "../toast/useToast";
import { DuplicateGroupCard } from "./DuplicateGroupCard";
import { filterReportForSeed } from "./filterReportForSeed";

interface Props {
  onClose: () => void;
  seed?: DedupSeed | null;
}

/** Kopya Bulucu yardim icerigi (§11). Modlarin TANIMI burada TEKRARLANMAZ — o bilgi zaten her
 *  mod kutusunun altinda (`dedup.mode_*_hint`). Burada akis + geri-alinabilirlik anlatilir. */
const DEDUP_HELP_SECTIONS: HelpSection[] = [
  {
    titleKey: "dedup.help.sec_flow",
    items: [
      { labelKey: "dedup.help.step_modes_label", descKey: "dedup.help.step_modes_desc" },
      { labelKey: "dedup.help.step_scan_label", descKey: "dedup.help.step_scan_desc" },
      { labelKey: "dedup.help.step_review_label", descKey: "dedup.help.step_review_desc" },
    ],
  },
  {
    titleKey: "dedup.help.sec_safety",
    items: [
      { labelKey: "dedup.help.trash_label", descKey: "dedup.help.trash_desc" },
      { labelKey: "dedup.help.keep_label", descKey: "dedup.help.keep_desc" },
      { labelKey: "dedup.help.stop_label", descKey: "dedup.help.stop_desc" },
    ],
  },
];

/** Yuzde benzerlik (kullaniciya) → pHash Hamming mesafe esigi (0..64; kucuk = daha kati).
 *  or. %85 → round((1 - 0.85) * 64) = 10. */
function pctToDistance(pct: number): number {
  return Math.round((1 - pct / 100) * 64);
}

/** Cope atilan id'leri rapordan cikar; <2 uye kalan gruplari dusur; sayaclari yeniden hesapla. */
function pruneReport(rep: DuplicateReport, trashedIds: number[]): DuplicateReport {
  const gone = new Set(trashedIds);
  const groups = rep.groups
    .map((g) => ({ ...g, members: g.members.filter((m) => !gone.has(m.id)) }))
    .filter((g) => g.members.length >= 2);
  const totalFiles = groups.reduce((n, g) => n + g.members.length, 0);
  return { groups, totalGroups: groups.length, totalFiles, cancelled: rep.cancelled };
}

export function DuplicateFinderPanel({ onClose, seed = null }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { canWrite } = useSession();
  const bumpData = useUiStore((s) => s.bumpData);

  // Tarama modlari — varsayilan yalniz "birebir" (en guvenli/kullanisli ilk tarama).
  const [exact, setExact] = useState(true);
  const [sameName, setSameName] = useState(false);
  const [visual, setVisual] = useState(false);
  const [structural, setStructural] = useState(false);
  // Gorsel benzerlik esigi (% kullaniciya; varsayilan %85 → mesafe 10).
  const [thresholdPct, setThresholdPct] = useState(85);
  // Yapisal (cizim) benzerlik esigi — DOGRUDAN min_score yuzdesi (varsayilan %80; buyuk = daha kati).
  const [structuralPct, setStructuralPct] = useState(80);

  const [report, setReport] = useState<DuplicateReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ilk tarama yapildi mi (bos-durum ile "henuz tarama yok"u ayirt etmek icin).
  const [scanned, setScanned] = useState(false);
  // Master-detay sag sutununda gosterilen uye (null = henuz secim yok → AssetDetailPanel bos-durum).
  // AssetDetailPanel'e `assetId` ile verilir → global secimi ETKILEMEZ (gomulu reuse).
  const [detailId, setDetailId] = useState<number | null>(null);
  const autoScanStarted = useRef(false);
  // Y1: tarama suresi (sn) — "takildi mi?" sorusunun tek gorunur cevabi. Belirsiz pulse
  // yerine GERCEK sayac: O(n²) tarama dakikalar surebilir, kullanici ilerlemedigini sanmasin.
  const [elapsedSec, setElapsedSec] = useState(0);
  // Iptal istendi → dugme kilitlenir, "iptal ediliyor" gosterilir (IngestModal deseni).
  const [cancelRequested, setCancelRequested] = useState(false);

  const anyMode = exact || sameName || visual || structural;

  // Y1: tarama boyunca saniye sayaci.
  useEffect(() => {
    if (!loading) return;
    setElapsedSec(0);
    const id = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Y1: devam eden taramayi durdur. Backend salt-atomic bayrak set eder (DB kilidi ISTEMEZ) →
  // O(n²) dongusu satir basinda gorup erken cikar; rapor `cancelled: true` doner.
  const cancelScan = useCallback(() => {
    setCancelRequested(true);
    void ipc.cancelFindDuplicates().catch(() => {
      // Iptal IPC'si duserse kullanici en azindan kilitli dugmede kalmasin.
      setCancelRequested(false);
    });
  }, []);

  // Esc → finder'i kapat (capture; ShapeSearchModal deseni).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // Y1 — HAYALET TARAMA KORUMASI: panel kapanirken (Esc / scrim / ×) devam eden tarama varsa
  // durdur. Onceden hesap arka planda SURUYOR ve `state.db` kilidini TUTUYORDU → kullanici
  // paneli kapattiktan sonra tum uygulama aciklamasiz doniyordu ("program bozuldu" sinifi).
  useEffect(
    () => () => {
      void ipc.cancelFindDuplicates().catch(() => {});
    },
    [],
  );

  const runScan = useCallback(
    () =>
      void (async () => {
        if (!anyMode || loading) return;
        setLoading(true);
        setCancelRequested(false);
        setError(null);
        try {
          const rep = await ipc.findDuplicates(
            exact,
            sameName,
            visual,
            pctToDistance(thresholdPct),
            structural,
            structuralPct,
          );
          // Y1: iptal ≠ "kopya bulunamadi". Bos raporu sonuc gibi gostermek sessiz yanlis
          // cevap olurdu → `scanned` KURULMAZ, bilgilendirici toast atilir, onceki sonuc
          // (varsa) ekranda kalir.
          if (rep.cancelled) {
            toast.info(t("dedup.cancelled_toast"));
            return;
          }
          setReport(seed ? filterReportForSeed(rep, seed.id) : rep);
          setScanned(true);
        } catch (e) {
          setError(String(e));
          toast.error(t("dedup.error", { message: String(e) }));
        } finally {
          setLoading(false);
          setCancelRequested(false);
        }
      })(),
    [
      anyMode,
      exact,
      loading,
      sameName,
      seed,
      structural,
      structuralPct,
      thresholdPct,
      toast,
      t,
      visual,
    ],
  );

  // Baglam menusunden gelindiginde en guvenli varsayilan modla bekletmeden tara.
  useEffect(() => {
    if (!seed || autoScanStarted.current) return;
    autoScanStarted.current = true;
    runScan();
  }, [runScan, seed]);

  // Uyeye tikla → detayi panelin ICINDE (sag sutun) goster; finder KAPANMAZ, sonuclar solda kalir
  // (master-detay; kullanici istegi: "panelin disina cikmak yerine detay burada"). Global secime
  // dokunmaz — AssetDetailPanel `assetId` ile guudumlenir.
  const openAsset = (id: number) => setDetailId(id);

  // Cope at (editor+; DuplicateGroupCard cagirir) → IPC + yerel rapor tazeleme + toast.
  const trashIds = (ids: number[]) =>
    void (async () => {
      if (ids.length === 0) return;
      try {
        await ipc.trashAssets(ids);
        setReport((prev) => (prev ? pruneReport(prev, ids) : prev));
        // Cope atilan asset detayda aciksa sag sutunu temizle (bayat detay kalmasin).
        if (detailId != null && ids.includes(detailId)) setDetailId(null);
        bumpData(); // cope atilanlar ana gorunumden kaybolur
        toast.success(t("dedup.trashed", { count: ids.length }));
      } catch (e) {
        toast.error(t("dedup.trash_failed"));
        setError(String(e));
      }
    })();

  const groups = report?.groups ?? [];
  // Uye onizlemeleri — tek batch (grup uyeleri sinirli sayida). useThumbnails icerik-anahtarli
  // (id-listesi ayni → yeniden cekmez); thumbnail'i olmayan (DWG vb.) → kart uzanti-ikonuna duser.
  const memberIds = useMemo(() => groups.flatMap((g) => g.members.map((m) => m.id)), [groups]);
  const thumbnails = useThumbnails(memberIds);
  const summary = useMemo(
    () =>
      report
        ? t("dedup.summary", { groups: report.totalGroups, files: report.totalFiles })
        : "",
    [report, t],
  );

  const btn =
    "rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("dedup.title")}
      >
        {/* Baslik + ozet + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-accent">
            {t("dedup.title")}
            {/* Baglam-ici yardim (§11) — modlarin NE aradigini kutu altindaki ipuclari zaten
                yaziyor; buradaki yardim AKISI ve GUVENLIGI anlatir (tekrar degil). */}
            <ContextualHelp
              titleKey="dedup.help.title"
              introKey="dedup.help.intro"
              sections={DEDUP_HELP_SECTIONS}
              hintKey="dedup.help.hint"
              buttonLabelKey="dedup.help.button"
            />
            {report && report.totalGroups > 0 && (
              <span className="ms-2 text-xs font-normal text-text-muted">{summary}</span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:text-text-primary"
          >
            ×
          </button>
        </div>

        {/* Kontroller: modlar + gorsel esik slider'i + Tara */}
        <div className="flex flex-col gap-3 border-b border-border bg-bg-tertiary/40 px-5 py-3">
          <p className="text-xs text-text-muted">{t("dedup.hint")}</p>
          {seed && (
            <p className="rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-text-primary">
              {t("dedup.seeded_for", { name: seed.name })}
            </p>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("dedup.modes")}
            </span>
            <ModeCheckbox
              checked={exact}
              onChange={setExact}
              label={t("dedup.mode_exact")}
              hint={t("dedup.mode_exact_hint")}
            />
            <ModeCheckbox
              checked={sameName}
              onChange={setSameName}
              label={t("dedup.mode_same_name")}
              hint={t("dedup.mode_same_name_hint")}
            />
            <ModeCheckbox
              checked={visual}
              onChange={setVisual}
              label={t("dedup.mode_visual")}
              hint={t("dedup.mode_visual_hint")}
            />
            <ModeCheckbox
              checked={structural}
              onChange={setStructural}
              label={t("dedup.mode_structural")}
              hint={t("dedup.mode_structural_hint")}
            />
          </div>

          {/* Gorsel esik slider'i — yalniz gorsel modu acikken. */}
          {visual && (
            <div className="ms-6 flex flex-col gap-1">
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">{t("dedup.threshold")}</span>
                <span className="tabular-nums text-text-primary">
                  {t("dedup.threshold_value", { pct: thresholdPct })}
                </span>
              </label>
              <input
                type="range"
                min={50}
                max={100}
                step={1}
                value={thresholdPct}
                onChange={(e) => setThresholdPct(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <span className="text-[11px] text-text-muted">{t("dedup.threshold_hint")}</span>
            </div>
          )}

          {/* Yapisal esik slider'i — yalniz yapisal modu acikken. Dogrudan min_score yuzdesi. */}
          {structural && (
            <div className="ms-6 flex flex-col gap-1">
              <label className="flex items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary">{t("dedup.threshold")}</span>
                <span className="tabular-nums text-text-primary">
                  {t("dedup.threshold_value", { pct: structuralPct })}
                </span>
              </label>
              <input
                type="range"
                min={50}
                max={100}
                step={1}
                value={structuralPct}
                onChange={(e) => setStructuralPct(Number(e.target.value))}
                className="w-full accent-accent"
              />
              <span className="text-[11px] text-text-muted">
                {t("dedup.threshold_structural_hint")}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={runScan} disabled={!anyMode || loading} className={btn}>
              {loading ? t("dedup.scanning") : t("dedup.scan")}
            </button>
            {/* Y1: tarama sirasinda IPTAL + gecen sure. Oncesinde iptal yolu YOKTU; kullanici
                paneli kapatiyordu ama hesap arka planda surup DB kilidini tutuyordu. */}
            {loading && (
              <>
                <button
                  type="button"
                  onClick={cancelScan}
                  disabled={cancelRequested}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary
                             transition hover:border-border-hover hover:text-text-primary
                             disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {cancelRequested ? t("dedup.cancelling") : t("dedup.stop")}
                </button>
                <span className="text-xs tabular-nums text-text-muted">
                  {t("dedup.elapsed", { seconds: elapsedSec })}
                </span>
              </>
            )}
            {!anyMode && <span className="text-xs text-text-muted">{t("dedup.no_mode")}</span>}
          </div>
        </div>

        {/* Govde: sol = sonuc listesi (kaydirilir), sag = secili uyenin detayi (master-detay).
            Detay = ana arayuzdeki AssetDetailPanel'in AYNISI, `assetId` ile guudumlenir → global
            secimi ETKILEMEZ; detailId null iken kendi "bir oge secin" bos-durumunu gosterir. */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Sol: yukleniyor / hata / henuz-tarama-yok / bos / gruplar */}
          <div className="min-w-0 flex-1 overflow-auto px-5 py-3">
            {loading ? (
              <div className="text-sm text-text-muted">
                <p>{t("dedup.scanning")}</p>
                {/* Y1: BEKLENTI cumlesi — gorsel/yapisal mod O(n²); "takildi" sanilmasin. */}
                {(visual || structural) && (
                  <p className="mt-1 text-xs">{t("dedup.scanning_slow_hint")}</p>
                )}
              </div>
            ) : error ? (
              <div className="text-sm text-danger">
                <p>{t("dedup.error", { message: error })}</p>
                <button type="button" onClick={runScan} className={`mt-2 ${btn}`}>
                  {t("common.retry")}
                </button>
              </div>
            ) : !scanned ? (
              <p className="py-8 text-center text-sm text-text-muted">{t("dedup.start_hint")}</p>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-text-secondary">
                  {t(seed ? "dedup.seed_empty" : "dedup.empty")}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  {t(seed ? "dedup.seed_empty_hint" : "dedup.empty_hint")}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {groups.map((g, i) => (
                  <DuplicateGroupCard
                    key={`${g.kind}-${g.members[0]?.id ?? i}`}
                    group={g}
                    canWrite={canWrite}
                    onOpen={openAsset}
                    onTrash={trashIds}
                    thumbnails={thumbnails}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Sag: secili uyenin detayi — AssetDetailPanel reuse (kendi w-80 aside + border-s). */}
          <AssetDetailPanel assetId={detailId} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface ModeCheckboxProps {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
  hint: string;
}

/** Tek bir tarama-modu onay-kutusu (etiket + aciklama). */
function ModeCheckbox({ checked, onChange, label, hint }: ModeCheckboxProps) {
  return (
    <label className="flex items-start gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-accent"
      />
      <span className="flex flex-col">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted">{hint}</span>
      </span>
    </label>
  );
}
