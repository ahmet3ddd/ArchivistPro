// Semantik isabet % rozeti (LAN Faz 5). Rozet KULLANICIYA gosterilen tek guven sinyali —
// kelepce kalkarsa "%-12" / "%143" gibi kirik degerler ekrana basardi (cosine [-1,1] olabilir).
//
// NOT: gorsel/CLIP rozetinden (visualScore.ts `displayPct`) KASITLI olarak farkli — orada algisal
// bant-esleme var, burada metin↔metin cosine dogrudan yuzdeye cevrilir. Ikisi karistirilirsa
// rozetler ayni ekranda tutarsiz okunur.

import { describe, expect, it } from "vitest";

import { semanticScorePct } from "./semanticScore";

describe("semanticScorePct", () => {
  it("cosine'i dogrudan yuzdeye cevirir (bant-esleme YOK)", () => {
    expect(semanticScorePct(1)).toBe(100); // kendisiyle esleme
    expect(semanticScorePct(0.87)).toBe(87);
    expect(semanticScorePct(0.5)).toBe(50);
    expect(semanticScorePct(0)).toBe(0);
  });

  it("aralik disini KELEPCELER (negatif cosine / kayan-nokta tasmasi ekrana sizmaz)", () => {
    expect(semanticScorePct(-0.4)).toBe(0);
    expect(semanticScorePct(-1)).toBe(0);
    expect(semanticScorePct(1.0000001)).toBe(100);
    expect(semanticScorePct(3)).toBe(100);
  });

  it("tamsayiya yuvarlar (rozet ondalik gostermez)", () => {
    expect(semanticScorePct(0.876)).toBe(88);
    expect(semanticScorePct(0.874)).toBe(87);
    expect(Number.isInteger(semanticScorePct(0.3333))).toBe(true);
  });
});
