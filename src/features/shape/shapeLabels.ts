// Sekil-etiket + kategori yardimcilari (DWG/DXF sekil arama).
//
// Poligon adi ve kategori DEGERLERI backend anahtarlaridir (dropdown value = backend'in
// bekledigi `layerCategory`); kullaniciya gorunen METIN daima i18n'den (`shape.*`) gelir.
// `shapeLabel` yalniz vertex sayisi + duzgunlukten okunur bir ad turetir (per-sekil ekstra
// veri gerekmez) — bu yuzden ImageShapeTab'in "algilanan sekil" onizlemesinde kullanilir.

import type { TFunction } from "i18next";

// Vertex sayisi → i18n poligon alt-anahtari (bilinen duzgun-coken adlari).
const POLYGON_KEY: Record<number, string> = {
  3: "triangle",
  4: "quad",
  5: "pentagon",
  6: "hexagon",
  7: "heptagon",
  8: "octagon",
  9: "nonagon",
  10: "decagon",
  12: "dodecagon",
};

/** Kategori dropdown degerleri — backend `categorize_layer` anahtarlari (H2 pariti) + "TUMU"
 *  (filtre yok). Value backend'e gider (TUMU → null'a cevrilir); etiket `shape.category_label.*`. */
export const SHAPE_CATEGORIES = [
  "TUMU",
  "HAVUZ",
  "DUVAR",
  "KAPI",
  "PENCERE",
  "KOLON",
  "KIRIS",
  "MERDIVEN",
  "DOSEME",
  "CATI",
  "DIGER",
] as const;

export type ShapeCategory = (typeof SHAPE_CATEGORIES)[number];

/** Vertex sayisi + duzgunlukten okunur sekil etiketi (i18n).
 *  Yuksek regularity (>0.85) + bilinen poligon → "Düzgün Sekizgen"; degilse poligon adi
 *  ("Altıgen") ya da bilinmeyen vertex icin "N-köşeli". */
export function shapeLabel(t: TFunction, vertexCount: number, regularity: number): string {
  const key = POLYGON_KEY[vertexCount];
  const base = key
    ? t(`shape.polygon.${key}`)
    : t("shape.polygon.generic", { count: vertexCount });
  return regularity > 0.85 && key ? t("shape.polygon.regular", { name: base }) : base;
}
