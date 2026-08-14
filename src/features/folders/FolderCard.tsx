// Klasor karti (Faz 7.2) — FoldersView'de kullanilir. Tiklayinca o klasore filtreler
// (pathPrefix) + explorer'a gecer. Ad/yol veri; dosya sayisi + son-tarama tarihi rozetle
// gosterilir (tarih yerel-duyarli; `last_indexed` varsa).

import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { formatDateShort } from "../../lib/format";

interface FolderCardProps {
  /** Klasor adi (yolun son parcasi). */
  name: string;
  /** Tam klasor yolu (alt-baslik + tooltip). */
  path: string;
  /** Bu klasordeki dogrudan asset sayisi. */
  fileCount: number;
  /** Son indeksleme zamani (unix SANIYE; ×1000 → JS Date). Yoksa rozet cizilmez. */
  lastIndexed?: number;
  /** Karta tiklaninca (klasoru ac → filtrele). */
  onOpen: () => void;
  /** Sag-tik (baglam menusu) — preventDefault + menu konumlandirma ebeveynde (FoldersView). */
  onContextMenu?: (e: MouseEvent) => void;
}

export function FolderCard({
  name,
  path,
  fileCount,
  lastIndexed,
  onOpen,
  onContextMenu,
}: FolderCardProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onOpen}
      onContextMenu={onContextMenu}
      title={path}
      className="glass flex w-full flex-col gap-1 p-3 text-start hover:border-border-hover focus:border-accent focus:outline-none"
    >
      <div className="flex items-center gap-2">
        <span aria-hidden className="text-lg">
          📁
        </span>
        <span className="truncate font-display text-sm font-medium text-text-primary">{name}</span>
      </div>
      {/* Yol her zaman LTR okunur (Windows/POSIX), RTL dilde de bozulmasin */}
      <span className="truncate text-xs text-text-muted" dir="ltr">
        {path}
      </span>
      <div className="mt-1 flex items-center gap-2">
        <span className="self-start rounded bg-bg-tertiary px-1.5 py-0.5 text-xs text-text-secondary">
          📄 {fileCount}
        </span>
        {lastIndexed != null && (
          <span className="text-[11px] text-text-muted" title={t("folders.last_scan")}>
            🕒 {formatDateShort(lastIndexed)}
          </span>
        )}
      </div>
    </button>
  );
}
