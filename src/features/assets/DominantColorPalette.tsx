import { useTranslation } from "react-i18next";

import type { DominantColor } from "../../ipc/client";
import { dominantColorHex, normalizeDominantColors } from "./dominantColors";

interface Props {
  colors?: readonly DominantColor[] | null;
  /** Karttaki sabit yukseklikli satira sigan dar varyant. */
  compact?: boolean;
  className?: string;
  /** SECILEBILIR varyant (detay paneli): tiklanan segmentin indeksi ust bilesene bildirilir.
   *  Verilmezse cubuk eskisi gibi SALT-GOSTERIM kalir — kart tarafi degismesin (100K karttan
   *  her birine gereksiz buton/olay baglamayiz). */
  onSelect?: (index: number) => void;
  /** Secili segment (yalniz `onSelect` ile anlamli) — halka ile isaretlenir. */
  selectedIndex?: number;
}

/** Baskin renkleri, yuzdelerine orantili tek bir erisilebilir palet cubugunda gosterir. */
export function DominantColorPalette({
  colors,
  compact,
  className = "",
  onSelect,
  selectedIndex,
}: Props) {
  const { t } = useTranslation();
  const normalized = normalizeDominantColors(colors);
  if (normalized.length === 0) return null;

  const summary = normalized
    .map((color) => `${dominantColorHex(color)} ${Math.round(color.percentage)}%`)
    .join(", ");

  const height = compact ? "h-3 w-16" : onSelect ? "h-6" : "h-5 w-32";

  return (
    <div
      role={onSelect ? "group" : "img"}
      aria-label={`${t("ingest.color_extract")}: ${summary}`}
      title={onSelect ? undefined : summary}
      className={`flex shrink-0 overflow-hidden rounded-sm border border-border ${height} ${className}`}
    >
      {normalized.map((color, index) => {
        const hex = dominantColorHex(color);
        const style = {
          backgroundColor: hex,
          flexBasis: 0,
          flexGrow: Math.max(color.percentage, 1),
        } as const;
        if (!onSelect) {
          return <span key={`${hex}-${index}`} aria-hidden style={style} />;
        }
        const active = index === selectedIndex;
        return (
          <button
            key={`${hex}-${index}`}
            type="button"
            data-testid="color-segment"
            onClick={() => onSelect(index)}
            aria-pressed={active}
            // Etiket yerellestirilmis metin + makine degeri: ekran okuyucu "%34, #4f6a7d" duyar.
            aria-label={`${Math.round(color.percentage)}% ${hex}`}
            title={`${hex} · ${Math.round(color.percentage)}%`}
            style={style}
            className={`transition-[box-shadow] ${
              active ? "shadow-[inset_0_0_0_2px_var(--color-accent)]" : "hover:brightness-110"
            }`}
          />
        );
      })}
    </div>
  );
}
