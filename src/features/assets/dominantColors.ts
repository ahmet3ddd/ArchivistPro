import type { DominantColor } from "../../ipc/client";

export const DOMINANT_COLORS_METADATA_KEY = "dominant_colors";

function channel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

/** Guvenilmeyen/eski LAN JSON'u dahil, UI'ya yalniz gecerli en cok 5 renk sokar. */
export function normalizeDominantColors(colors: readonly DominantColor[] | null | undefined): DominantColor[] {
  if (!Array.isArray(colors)) return [];
  return colors
    .filter(
      (color) =>
        color != null &&
        Number.isFinite(color.r) &&
        Number.isFinite(color.g) &&
        Number.isFinite(color.b) &&
        Number.isFinite(color.percentage) &&
        color.percentage > 0,
    )
    .slice(0, 5)
    .map((color) => ({
      r: channel(color.r),
      g: channel(color.g),
      b: channel(color.b),
      percentage: Math.min(100, Math.max(0, color.percentage)),
    }));
}

export function dominantColorHex(color: DominantColor): string {
  return `#${[color.r, color.g, color.b]
    .map((value) => channel(value).toString(16).padStart(2, "0"))
    .join("")}`;
}
