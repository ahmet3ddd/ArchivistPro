// Cop kutusu satiri (TrashPanel) — ikon + ad + yol (dir=ltr) + boyut + tarih
// ardindan satir-ici eylemler: Geri yukle (editor+) · Kalici sil (yalniz admin, onayli).
// Asset detayina abone OLMAZ (statik satir); eylemler ust panele iletilir.

import { useTranslation } from "react-i18next";

import type { AssetRow } from "../../ipc/client";
import { extIcon, formatBytes, formatDateShort } from "../../lib/format";

interface Props {
  asset: AssetRow;
  /** Geri-yukleme eylemini gosterir mi? (editor+). */
  canRestore: boolean;
  /** Kalici-silme eylemini gosterir mi? (yalniz admin). */
  canPurge: boolean;
  /** Bu satir su an islem altinda mi? (cift-tik/yaris onleme + gorsel geri-bildirim). */
  busy: boolean;
  onRestore: () => void;
  onPurge: () => void;
}

export function TrashRow({ asset, canRestore, canPurge, busy, onRestore, onPurge }: Props) {
  const { t } = useTranslation();
  const label = asset.title?.trim() || asset.file_name;

  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-border bg-bg-tertiary/50 px-3 py-2 transition
        ${busy ? "opacity-50" : "hover:border-border-hover hover:bg-bg-tertiary"}`}
    >
      <span className="shrink-0 text-2xl leading-none" aria-hidden>
        {extIcon(asset.ext)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text-primary" title={label}>
          {label}
        </p>
        {/* Yol her zaman LTR (Windows/POSIX yollari RTL'de bozulmasin). */}
        <p className="truncate text-[11px] text-text-muted" dir="ltr" title={asset.path}>
          {asset.path}
        </p>
        <p className="mt-0.5 text-[11px] text-text-muted">
          {formatBytes(asset.size_bytes)}
          <span className="mx-1.5 opacity-50">·</span>
          {t("trash.trashed_at", { date: formatDateShort(asset.modified_at) })}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {canRestore && (
          <button
            type="button"
            onClick={onRestore}
            disabled={busy}
            className="rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:border-border-hover hover:bg-bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("trash.restore")}
          </button>
        )}
        {canPurge && (
          <button
            type="button"
            onClick={onPurge}
            disabled={busy}
            className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("trash.purge")}
          </button>
        )}
      </div>
    </div>
  );
}
