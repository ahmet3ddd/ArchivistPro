// Tek kaynak-klasor karti (RootsPanel ici). Gosterir: etiket (satir-ici duzenle) · yol (truncate,
// dir=ltr, title) · favori yildizi · grup secici · etiketler (chip + ekle/kaldir) · son tarama ·
// dosya sayisi rozeti · aksiyonlar (Listeden cikar / Cope at / Yeniden aktifle). Yazma editor+
// (ProtectedAction; gercek yetki Rust'ta). Bilesen sunum-odakli: IPC/toast/tazeleme ebeveynde.

import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { RootGroup, ScannedRoot, WatchFailure } from "../../ipc/client";
import { formatDate } from "../../lib/format";
import { ProtectedAction } from "../../permissions";
import { watchOffKey } from "../watch/watchErrors";
import { showsNeverScannedHint } from "./rootBadges";

interface Props {
  root: ScannedRoot;
  groups: RootGroup[];
  /** Bu kok SU AN izlenemiyorsa nedeni; izleniyorsa/izleme kapaliysa `undefined`. */
  watchFailure?: WatchFailure;
  /** Izlemeyi yeniden dene (surucu baglandi / izin duzeltildi) — rozet uzerindeki cikis yolu. */
  onRetryWatch: () => void;
  onRename: (label: string) => void;
  onToggleFavorite: () => void;
  onAssignGroup: (groupId: number | null) => void;
  onAddTag: (tagName: string) => void;
  onRemoveTag: (tagId: number) => void;
  onRemove: () => void;
  onTrash: () => void;
  onReactivate: () => void;
  /** Bu kokun icerigini indeksle → İngest penceresi yol on-dolulu acilir (Y2).
   *  Kok EKLEMEK indekslemez (kayit + izleyici kurar); tarama AYRI ve ACIK bir eylemdir. */
  onScan: () => void;
}

const CHIP_CLS =
  "inline-flex items-center gap-1 rounded-full border border-border bg-bg-tertiary px-2 py-0.5 text-[11px] text-text-secondary";

export function RootCard({
  root,
  groups,
  watchFailure,
  onRetryWatch,
  onRename,
  onToggleFavorite,
  onAssignGroup,
  onAddTag,
  onRemoveTag,
  onRemove,
  onTrash,
  onReactivate,
  onScan,
}: Props) {
  const { t } = useTranslation();
  const removed = root.status !== "active";
  // Kok diskte YOK (takili olmayan surucu / tasinmis klasor). `undefined` = backend bu listede
  // denetim gondermedi → BILINMIYOR; uyari cikarma (yanlis alarm, dogru bilgiden kotudur).
  const unreachable = root.pathExists === false;
  // Tarama bekleyen kayit var mi — "hangi koku taratayim" sorusunun DOGRUDAN cevabi.
  const pending = root.pendingCount > 0;

  // Etiket satir-ici duzenleme (yerel kip).
  const [editing, setEditing] = useState(false);
  const skipBlurCommitRef = useRef(false);
  const [labelDraft, setLabelDraft] = useState(root.label);
  const [tagDraft, setTagDraft] = useState("");

  const commitLabel = () => {
    const v = labelDraft.trim();
    setEditing(false);
    if (v && v !== root.label) onRename(v);
    else setLabelDraft(root.label);
  };
  const commitTag = () => {
    const v = tagDraft.trim();
    if (!v) return;
    setTagDraft("");
    onAddTag(v);
  };

  return (
    <div
      className={`flex flex-col gap-2 rounded-md border p-3 ${
        removed ? "border-border bg-bg-secondary/50 opacity-75" : "border-border bg-bg-secondary"
      }`}
    >
      {/* Ust satir: favori + etiket (duzenle) + durum rozeti */}
      <div className="flex items-start gap-2">
        <ProtectedAction require="editor" mode="disabled">
          <button
            type="button"
            onClick={onToggleFavorite}
            aria-label={root.isFavorite ? t("roots.unfavorite") : t("roots.favorite")}
            title={root.isFavorite ? t("roots.unfavorite") : t("roots.favorite")}
            className={`shrink-0 text-lg leading-none transition ${
              root.isFavorite ? "text-amber-400" : "text-text-muted hover:text-amber-400"
            }`}
          >
            {root.isFavorite ? "★" : "☆"}
          </button>
        </ProtectedAction>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              data-escape-local
              type="text"
              value={labelDraft}
              autoFocus
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={() => {
                if (skipBlurCommitRef.current) {
                  skipBlurCommitRef.current = false;
                  return;
                }
                commitLabel();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  skipBlurCommitRef.current = true;
                  commitLabel();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  skipBlurCommitRef.current = true;
                  setLabelDraft(root.label);
                  setEditing(false);
                }
              }}
              className="w-full rounded border border-border bg-bg-tertiary px-2 py-0.5 text-sm
                         text-text-primary focus:border-accent focus:outline-none"
            />
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 truncate font-medium text-text-primary">{root.label}</span>
              <ProtectedAction require="editor" mode="disabled">
                <button
                  type="button"
                  onClick={() => {
                    setLabelDraft(root.label);
                    skipBlurCommitRef.current = false;
                    setEditing(true);
                  }}
                  aria-label={t("roots.rename")}
                  title={t("roots.rename")}
                  className="shrink-0 text-xs text-text-muted transition hover:text-text-primary"
                >
                  ✎
                </button>
              </ProtectedAction>
            </div>
          )}
        </div>

        {removed && (
          <span className="shrink-0 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">
            {t("roots.status_removed")}
          </span>
        )}
      </div>

      {/* Yol (LTR; truncate; tam yol title) */}
      <p dir="ltr" title={root.path} className="truncate text-xs text-text-muted">
        {root.path}
      </p>

      {/* IZLENMIYOR ROZETI — kalici durum, kalici gosterim.
          Gerekce (kullanici bulgusu 2026-08-08): izleme hatasinin TEK gorunurlugu bir toast'ti;
          toast kaybolunca kullanici o klasorun hala izlenmedigini hicbir yerden goremiyordu ve
          oradaki degisiklikler sessizce indeks disinda kaliyordu. Rozet neden + eylem tasir; ham
          hata metni `title`'da (kaybolmaz, kart duzenini de sismez).
          `removed` kokte gosterilmez: kasten izlenmeyen kok icin ariza uyarisi yaniltirdi. */}
      {!removed && watchFailure && (
        <div
          className="rounded border border-warning/40 bg-warning/10 px-2 py-1.5 text-[11px]"
          title={watchFailure.message}
        >
          {/* Baslik + eylem TEK satirda; gerekce ALTTA tam genislikte. Yan yana dizmek kart dar
              kolona dustugunde (xl:grid-cols-2) gerekceyi birkac karakterlik seride eziyordu. */}
          <div className="flex items-center gap-2">
            <span className="font-medium text-warning">⚠ {t("roots.watch_off")}</span>
            {/* Izleme kurmak ADMIN isi (backend kapisi) — editor'e acik birakmak, reddedilen
                denemenin gercek nedeni "forbidden" ile EZMESINE yol acardi (teshis kaybolur). */}
            <ProtectedAction require="admin" mode="disabled">
              <button
                type="button"
                onClick={onRetryWatch}
                className="ms-auto shrink-0 rounded border border-warning/50 px-1.5 py-0.5
                           font-medium text-warning transition hover:bg-warning/20"
              >
                {t("roots.watch_retry")}
              </button>
            </ProtectedAction>
          </div>
          <p className="mt-1 text-text-secondary">{t(watchOffKey(watchFailure.kind))}</p>
        </div>
      )}

      {/* ERISILEMIYOR ROZETI — izleme rozetinden BAGIMSIZ.
          Gerekce (kullanici bulgusu 2026-08-11, H2 aktarimi sonrasi): kopuk bir surucudeki
          kok (or. takili olmayan `Y:`) panelde TAMAMEN NORMAL gorunuyordu; tek isaret
          "⚠ Izlenmiyor" rozetiydi, o da YALNIZ canli izleme aciksa ciziliyordu. Izleme kapali
          bir kurulumda kullanici, dosyalari erisilemez olan bir koku saglikli sanip taratiyordu.
          Bu, kozmetikten fazlasi: tarama "Degistir" modunda kayip dosyalari COPE ATAR — neyin
          erisilemez oldugunu gormeden o modu secmek veri kaybi demektir.
          "Silinmis" DEMIYORUZ: takili-degil ile silinmis ayirt edilemez (bkz `path_exists`). */}
      {!removed && unreachable && (
        <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1.5 text-[11px]">
          <span className="font-medium text-danger">⚠ {t("roots.unreachable")}</span>
          <p className="mt-1 text-text-secondary">{t("roots.unreachable_hint")}</p>
        </div>
      )}

      {/* Meta: son tarama + bekleyen + dosya sayisi rozeti */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-secondary">
        <span>
          {root.lastScan != null
            ? t("roots.last_scan", { date: formatDate(root.lastScan) })
            : t("roots.never_scanned")}
        </span>
        {/* Y2: "Hic taranmadi" rozeti eskiden CIKMAZ SOKAKTI (panelde tarama yolu yoktu) →
            neden dosya gorunmedigini soyleyen bir ipucu ver. Kosul `showsNeverScannedHint`'te
            (saf + testli): ipucu "icerigi arsivde YOK" iddiasidir → dosya sayisi 0 degilse
            gosterilmez, bekleyen rozeti varsa ayni seyi zaten SAYIYLA soyler. */}
        {showsNeverScannedHint(root) && (
          <span className="text-warning">{t("roots.never_scanned_hint")}</span>
        )}
        {/* BEKLEYEN ROZETI — `lastScan` bunun yerine GECMEZ: taranmis bir koke sonradan
            H2 aktarimi ya da yeni dosya girebilir; kart "taranmis" der ama icerik indeks
            disindadir. Sayi, kullanicinin hangi koku oncelikle taratacagini secmesini saglar. */}
        {!removed && pending && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">
            {t("roots.pending_count", { count: root.pendingCount })}
          </span>
        )}
        <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">
          {t("roots.file_count", { count: root.fileCount })}
        </span>
      </div>

      {/* Grup secici */}
      <ProtectedAction require="editor" mode="disabled">
        <label className="flex items-center gap-2 text-[11px] text-text-secondary">
          <span className="shrink-0">{t("roots.group")}</span>
          <select
            value={root.groupId ?? ""}
            onChange={(e) => onAssignGroup(e.target.value === "" ? null : Number(e.target.value))}
            className="min-w-0 flex-1 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs
                       text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="">{t("roots.no_group")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
      </ProtectedAction>

      {/* Etiketler: chip + ekle/kaldir */}
      <div className="flex flex-col gap-1.5">
        {root.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {root.tags.map((tag) => (
              <span key={tag.id} className={CHIP_CLS}>
                {tag.name}
                <ProtectedAction require="editor" mode="disabled">
                  <button
                    type="button"
                    onClick={() => onRemoveTag(tag.id)}
                    aria-label={t("roots.remove_tag")}
                    className="text-text-muted transition hover:text-danger"
                  >
                    ×
                  </button>
                </ProtectedAction>
              </span>
            ))}
          </div>
        )}
        <ProtectedAction require="editor" mode="disabled">
          <input
            type="text"
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitTag()}
            placeholder={t("roots.add_tag")}
            className="w-full rounded border border-border bg-bg-tertiary px-2 py-1 text-[11px]
                       text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
        </ProtectedAction>
      </div>

      {/* Aksiyonlar: aktifken Listeden cikar + Cope at; removed'da Yeniden aktifle */}
      <ProtectedAction require="editor" mode="disabled">
        <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-2">
          {/* Y2 — TARA: kok eklemek icerigi indekslemez, bu ayri ve acik bir eylemdir.
              Hic taranmamis VEYA bekleyeni olan kokte VURGULU (dolu) gosterilir → kullanicinin
              "simdi ne yapacagim" sorusunun cevabi kartin uzerinde durur. Cop/removed kokte
              anlamsiz → gizli.
              Erisilemeyen kokte DEVRE DISI BIRAKILMAZ: `pathExists` bir anlik goruntudur;
              surucu yeniden takildiginda kullanici tarayabilmeli. Uyari yukaridaki rozette. */}
          {!removed && (
            <button
              type="button"
              onClick={onScan}
              className={`me-auto rounded px-2 py-1 text-xs font-medium transition ${
                root.lastScan == null || pending
                  ? "bg-accent text-white hover:bg-accent-hover"
                  : "border border-border text-text-secondary hover:border-border-hover hover:text-text-primary"
              }`}
            >
              {t("roots.scan")}
            </button>
          )}
          {removed ? (
            <button
              type="button"
              onClick={onReactivate}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary
                         transition hover:border-border-hover hover:text-text-primary"
            >
              {t("roots.reactivate")}
            </button>
          ) : (
            <button
              type="button"
              onClick={onRemove}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary
                         transition hover:border-border-hover hover:text-text-primary"
            >
              {t("roots.remove")}
            </button>
          )}
          <button
            type="button"
            onClick={onTrash}
            className="rounded border border-danger/40 px-2 py-1 text-xs text-danger
                       transition hover:border-danger hover:bg-danger/10"
          >
            {t("roots.trash_action")}
          </button>
        </div>
      </ProtectedAction>
    </div>
  );
}
