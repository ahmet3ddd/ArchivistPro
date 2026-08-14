// Tek bir kopya-grubu karti (Kopya Bulucu) — kind rozeti + %score + uye listesi + eylemler.
//
// Salt-gosterim + iki geri-cagri: `onOpen(id)` (uyeye tikla → detayi panel ICINDE sag sutunda ac;
// panel KAPANMAZ), `onTrash(ids)` (cop'e at — panel gercek IPC + yerel tazeleme). Silme yalniz `canWrite`
// (editor+); viewer'da eylemler gizli (salt-okuma). "Gerisini cope at" ILK uyeyi korur, kalanini
// toplu cope atar (onayli); ayrica uye-basina tek cope-at. Yol LTR + truncate (RTL-guvenli).

import { confirm } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";

import type { DupGroup, DupKind } from "../../ipc/client";
import { extIcon, formatBytes } from "../../lib/format";

interface Props {
  group: DupGroup;
  /** Silme kontrollerini goster mi? (editor+; viewer salt-okuma). */
  canWrite: boolean;
  /** Uyeye tiklandi → detayi panel ICINDE (sag sutun) ac; panel kapanmaz. */
  onOpen: (id: number) => void;
  /** Verilen id'leri cop kutusuna at (panel: IPC + yerel rapor tazeleme + toast). */
  onTrash: (ids: number[]) => void;
  /** asset id → data-URI onizleme (panel tek batch ceker; yoksa uzanti ikonu fallback). */
  thumbnails: Record<number, string>;
}

/** Dosya adindan uzanti (kucuk-harf, noktasiz); nokta yoksa/onekse `null` (extIcon fallback). */
function extOf(fileName: string): string | null {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? fileName.slice(i + 1).toLowerCase() : null;
}

/** Kind rozeti renk sinifi (birebir=accent, ayni-ad=uyari, gorsel=ikincil, yapisal=basari/yesil).
 *  Exhaustive switch (default YOK) → yeni DupKind eklenince TS derleme-zamani uyarir. */
function badgeClass(kind: DupKind): string {
  switch (kind) {
    case "exact_hash":
      return "border-accent/40 bg-accent/10 text-accent";
    case "same_name":
      return "border-warning/40 bg-warning/10 text-warning";
    case "visual_similar":
      return "border-accent-secondary/40 bg-accent-secondary/10 text-accent-secondary";
    case "structural_similar":
      return "border-success/40 bg-success/10 text-success";
  }
}

export function DuplicateGroupCard({ group, canWrite, onOpen, onTrash, thumbnails }: Props) {
  const { t } = useTranslation();
  const restIds = group.members.slice(1).map((m) => m.id);

  // "Gerisini cope at": ILK uye korunur, kalan uyeler (onayli) cope atilir.
  const trashRest = () =>
    void (async () => {
      if (restIds.length === 0) return;
      const ok = await confirm(t("dedup.trash_rest_confirm", { count: restIds.length }), {
        title: t("dedup.trash_rest"),
        kind: "warning",
      });
      if (ok) onTrash(restIds);
    })();

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-bg-tertiary/40 p-3">
      {/* Baslik: kind rozeti + %score + uye sayisi + (editor+) gerisini-cope-at */}
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${badgeClass(group.kind)}`}
        >
          {t(`dedup.kind.${group.kind}`)}
        </span>
        <span className="text-xs text-text-muted tabular-nums">
          {t("dedup.score", { score: Math.round(group.score) })}
        </span>
        <span className="text-xs text-text-muted">
          {t("dedup.members", { count: group.members.length })}
        </span>
        {canWrite && restIds.length > 0 && (
          <button
            type="button"
            onClick={trashRest}
            className="ms-auto rounded-md border border-danger/40 px-2 py-1 text-xs text-danger transition hover:bg-danger/10"
          >
            {t("dedup.trash_rest")}
          </button>
        )}
      </div>

      {/* Uye listesi — ilk uye "korunacak" rozeti; tikla → detayda ac; (editor+) tek cope-at */}
      <ul className="flex flex-col gap-1">
        {group.members.map((m, i) => (
          <li
            key={m.id}
            className="flex items-center gap-2 rounded border border-border bg-bg-primary/40 px-2 py-1"
          >
            <button
              type="button"
              onClick={() => onOpen(m.id)}
              title={t("dedup.open_asset")}
              className="flex min-w-0 flex-1 items-center gap-2 text-start transition hover:text-accent"
            >
              {/* Onizleme (thumbnail; yoksa uzanti ikonu) — tikla → detayda ac. */}
              <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border border-border bg-bg-primary/60">
                {thumbnails[m.id] ? (
                  <img
                    src={thumbnails[m.id]}
                    alt={m.fileName}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-lg leading-none">{extIcon(extOf(m.fileName))}</span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-text-primary">
                    {m.fileName}
                  </span>
                  {i === 0 && (
                    <span className="shrink-0 rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-success">
                      {t("dedup.keep_first")}
                    </span>
                  )}
                </div>
                <span dir="ltr" className="block truncate text-xs text-text-muted" title={m.path}>
                  {m.path} · {formatBytes(m.sizeBytes)}
                </span>
              </div>
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={() => onTrash([m.id])}
                aria-label={t("dedup.trash_member")}
                title={t("dedup.trash_member")}
                className="shrink-0 rounded px-1.5 text-text-muted transition hover:text-danger"
              >
                🗑
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
