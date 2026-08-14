import { useTranslation } from "react-i18next";

import type { DominantColor } from "../../ipc/client";
import { dominantColorHex, normalizeDominantColors } from "./dominantColors";

interface Props {
  colors?: readonly DominantColor[] | null;
  /** Karttaki sabit yukseklikli satira sigan dar varyant. */
  compact?: boolean;
  className?: string;
}

/** Baskin renkleri, yuzdelerine orantili tek bir erisilebilir palet cubugunda gosterir. */
export function DominantColorPalette({ colors, compact, className = "" }: Props) {
  const { t } = useTranslation();
  const normalized = normalizeDominantColors(colors);
  if (normalized.length === 0) return null;

  const summary = normalized
    .map((color) => `${dominantColorHex(color)} ${Math.round(color.percentage)}%`)
    .join(", ");

  return (
    <div
      role="img"
      aria-label={`${t("ingest.color_extract")}: ${summary}`}
      title={summary}
      className={`flex shrink-0 overflow-hidden rounded-sm border border-border ${
        compact ? "h-3 w-16" : "h-5 w-32"
      } ${className}`}
    >
      {normalized.map((color, index) => (
        <span
          key={`${dominantColorHex(color)}-${index}`}
          aria-hidden
          style={{
            backgroundColor: dominantColorHex(color),
            flexBasis: 0,
            flexGrow: Math.max(color.percentage, 1),
          }}
        />
      ))}
    </div>
  );
}
