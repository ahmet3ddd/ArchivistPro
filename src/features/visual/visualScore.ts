// CLIP metin→gorsel cosine skorunun ALGISAL yuzde gosterimi.
//
// SORUN: CLIP capraz-modal (metin↔gorsel) cosine'i doga geregi SIKISIKTIR — cok iyi bir eslesme
// bile ~0.28-0.32 civarindadir (0.90 DEGIL), cunku metin ve gorsel embedding'leri ortak ama farkli
// uzaylarda yasar. Ham cosine'i dogrudan "%30" diye gostermek kullaniciya "zayif eslesme" gibi
// okunur — oysa %30 CLIP icin GUCLU eslesmedir (ornekte "bulutlu cami" → camiler 0.28-0.30 alir).
//
// COZUM: CLIP'in ANLAMLI bandini (`SCORE_LO`..`SCORE_HI`) 0-100'e dogrusal esle → guclu eslesme
// yuksek %, gurultu dusuk okur. Bu YALNIZ GOSTERIM; siralama ham cosine'de (monoton → sira ayni).
// Degerler bu (homojen ic-mimari) arsivde ampirik: ~0.18 gurultu tabani, ~0.32 guclu eslesme.
export const SCORE_LO = 0.18;
export const SCORE_HI = 0.32;

/** Ham cosine → algisal yuzde (0..100, tamsayi). LO alti → 0, HI ustu → 100. */
export function displayPct(cos: number): number {
  const t = (cos - SCORE_LO) / (SCORE_HI - SCORE_LO);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}
