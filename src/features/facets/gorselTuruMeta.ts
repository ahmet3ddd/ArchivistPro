// Gorsel turu (AI vision `ai_gorsel_turu`) kanonik token → i18n etiket anahtari + kenar-cubugu
// renkli nokta sinifi. FacetSidebar (bolum) + FilterChips (cip) AYNI eslemeyi kullanir (tek
// kaynak; kopya-yapistir yok). Renkler AiVisionSection rozetiyle TUTARLI (foto=emerald /
// render=violet / doku=amber). Yalniz 3 kova — backend `gorsel_turu_facets` sozlesmesi:
// value ∈ {"Fotoğraf","Render","Doku"}. Etiket anahtarlari ZATEN var (`ai_vision.kind_*`).

export interface GorselTuruMeta {
  labelKey: string; // i18n anahtari (ai_vision.kind_*)
  dot: string; // Tailwind arka-plan sinifi — kenar-cubugu satir noktasi
  chip: string; // renkli metin-hapi sinifi (bg+text; light+dark, data-theme uyumlu) — kart/detay
}

// chip sinifi AiVisionSection VISION_KIND_STYLES ile BIREBIR (detay rozeti = kart hapi = ayni renk).
export const GORSEL_TURU_META: Record<string, GorselTuruMeta> = {
  "Fotoğraf": {
    labelKey: "ai_vision.kind_photo",
    dot: "bg-emerald-500",
    chip: "bg-emerald-500/15 text-emerald-700 [[data-theme=dark]_&]:bg-emerald-500/20 [[data-theme=dark]_&]:text-emerald-300",
  },
  "Render": {
    labelKey: "ai_vision.kind_render",
    dot: "bg-violet-500",
    chip: "bg-violet-500/15 text-violet-700 [[data-theme=dark]_&]:bg-violet-500/20 [[data-theme=dark]_&]:text-violet-300",
  },
  "Doku": {
    labelKey: "ai_vision.kind_texture",
    dot: "bg-amber-500",
    chip: "bg-amber-500/15 text-amber-700 [[data-theme=dark]_&]:bg-amber-500/20 [[data-theme=dark]_&]:text-amber-300",
  },
};

/** Token → i18n etiket anahtari (taninmazsa null → cagiran ham degeri gosterir). */
export function gorselTuruLabelKey(value: string): string | null {
  return GORSEL_TURU_META[value]?.labelKey ?? null;
}
