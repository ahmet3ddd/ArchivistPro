// Anlamli (semantik) arama isabetinin % benzerlik rozeti — saf donusum (test'li).
//
// Sozlesme (gorev karari): metin embedding cosine'i DOGRUDAN yuzdeye cevrilir — `Math.round(score
// *100)`. Gorsel/CLIP aramasinin ALGISAL olceklemesinden (visualScore.ts `displayPct`) FARKLI:
// orada capraz-modal (metin↔gorsel) cosine sikisik oldugu icin bant-esleme gerekiyordu; burada
// metin↔metin (MiniLM) cosine dogal olarak sezgisel bir yuzde verir (self ~1.0, iyi eslesme ~0.5+).
//
// Guard: cosine [-1,1] olabilir → [0,1]'e KELEPCELE ki negatif/>%100 rozet cikmasin (kirik gorunur).

/** Gercek cosine skoru (0..1 beklenir) → tamsayi yuzde (0..100). Kelepceli. */
export function semanticScorePct(score: number): number {
  const clamped = Math.max(0, Math.min(1, score));
  return Math.round(clamped * 100);
}
