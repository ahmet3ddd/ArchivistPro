// Kok grubu (root_groups) ortak yardimcilari — renk paleti. Renk SERBEST (hex) depolanir;
// bu palet yalniz secim kolayligi icin sunulur (kullanici baska da secebilir). projectMeta deseni.

/** Grup renk paleti — olusturma/degistirme swatch'lari (hex; ilk = varsayilan). */
export const ROOT_GROUP_COLORS = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
] as const;

/** Yeni grup varsayilan rengi. */
export const DEFAULT_GROUP_COLOR = ROOT_GROUP_COLORS[0];
