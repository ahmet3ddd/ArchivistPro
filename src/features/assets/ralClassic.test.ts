// RAL Classic tablosu — BÜTÜNLÜK testleri.
//
// Bu test tek tek renklerin "doğru" olduğunu iddia ETMEZ (sRGB karşılıkları zaten yaklaşıktır;
// doğruluk tablonun kaynağına aittir). Yakaladığı şey, elle bakılan bir veri dosyasında kaçınılmaz
// olan KABA hatalardır: eksik aile, tekrar eden kod, bozuk hex, yanlış aileye yazılmış renk.
//
// Gerçek örnek (bu tabloyu yazarken oldu): `RAL 1037 Sun yellow` yanlışlıkla `#F82000` (KIRMIZI)
// yazılmıştı. Aşağıdaki "aile ↔ ton" testi tam bunu yakalar: 1000 serisi sarı ailesidir, hue 8°
// oraya düşemez. Tablo ofisin resmi listesiyle değiştirilirse bu testler yine geçmelidir.

import { describe, expect, it } from "vitest";

import { hexToRgb, rgbDeltaE, rgbToHsl } from "./colorMath";
import { nearestRal, RAL_CLASSIC, RAL_FAR_MATCH_DELTA } from "./ralClassic";

describe("RAL_CLASSIC tablosu", () => {
  it("213 renk içerir ve kodlar benzersizdir", () => {
    expect(RAL_CLASSIC).toHaveLength(213);
    expect(new Set(RAL_CLASSIC.map((c) => c.code)).size).toBe(213);
  });

  it("her satır geçerli biçimdedir (kod · ad · #rrggbb)", () => {
    for (const color of RAL_CLASSIC) {
      expect(color.code, color.code).toMatch(/^RAL \d{4}$/);
      expect(color.name.trim(), color.code).not.toBe("");
      expect(hexToRgb(color.hex), `${color.code} hex`).not.toBeNull();
    }
  });

  it("aile başına renk sayısı standartla birebir (eksik/fazla satır yakalanır)", () => {
    const counts = new Map<string, number>();
    for (const color of RAL_CLASSIC) {
      const family = color.code.slice(4, 5);
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    // RAL Classic'in bilinen dağılımı (toplam 213).
    expect(Object.fromEntries(counts)).toEqual({
      "1": 30,
      "2": 13,
      "3": 25,
      "4": 12,
      "5": 25,
      "6": 36,
      "7": 38,
      "8": 20,
      "9": 14,
    });
  });

  it("aynı hex iki koda yazılmamıştır (kopyala-yapıştır hatası nöbetçisi)", () => {
    // Not: resmi bir tabloda gerçek bir çakışma çıkarsa bu beklenti gevşetilebilir — ama
    // önce çakışmanın GERÇEK olduğu doğrulanmalı; pratikte sebebi neredeyse hep kopyalamadır.
    const seen = new Map<string, string>();
    for (const color of RAL_CLASSIC) {
      const key = color.hex.toUpperCase();
      expect(seen.has(key), `${color.code} ile ${seen.get(key)} aynı hex: ${key}`).toBe(false);
      seen.set(key, color.code);
    }
  });

  it("renkler ait oldukları AİLENİN ton aralığındadır", () => {
    // Aile↔ton pencereleri standardın kendi sınır adlarını da kapsayacak kadar geniştir
    // ("Red orange" 2000'de kırmızıya, "Blue green" 6000'de maviye taşar). Nötr/çok koyu/çok
    // açık renklerde ton anlamsızdır → onlar denetim dışı.
    const WINDOWS: Record<string, [number, number]> = {
      "1": [25, 70], // sarı · bej · altın
      "2": [0, 45], // turuncu (kırmızı-turuncular dahil)
      "3": [330, 20], // kırmızı · pembe (0° etrafında sarmalı)
      "4": [260, 350], // mor (kırmızı-mor dahil)
      "5": [180, 265], // mavi
      "6": [70, 190], // yeşil (mavi-yeşil dahil)
    };
    const inWindow = (hue: number, [lo, hi]: [number, number]) =>
      lo <= hi ? hue >= lo && hue <= hi : hue >= lo || hue <= hi;

    for (const color of RAL_CLASSIC) {
      const family = color.code.slice(4, 5);
      const window = WINDOWS[family];
      if (!window) continue; // 7/8/9: gri · kahve · siyah-beyaz → ton ayırt edici değil
      const rgb = hexToRgb(color.hex);
      expect(rgb, color.code).not.toBeNull();
      const { h, s, l } = rgbToHsl(rgb!);
      if (s <= 25 || l < 15 || l > 85) continue; // nötre yakın → ton güvenilmez
      expect(inWindow(h, window), `${color.code} ${color.name} (${color.hex}) hue=${Math.round(h)}`)
        .toBe(true);
    }
  });
});

describe("nearestRal", () => {
  it("tablodaki bir rengin kendisini ΔE=0 ile bulur", () => {
    const target = RAL_CLASSIC.find((c) => c.code === "RAL 5015")!;
    const match = nearestRal(hexToRgb(target.hex)!);
    expect(match?.code).toBe("RAL 5015");
    expect(match?.delta).toBeCloseTo(0, 6);
    expect(match?.far).toBe(false);
  });

  it("bilinen renkleri beklenen aileye eşler", () => {
    // Saf siyah/beyaz: RAL'in siyah/beyaz ailesine düşmeli (9000 serisi).
    expect(nearestRal({ r: 0, g: 0, b: 0 })?.code.startsWith("RAL 9")).toBe(true);
    expect(nearestRal({ r: 255, g: 255, b: 255 })?.code.startsWith("RAL 9")).toBe(true);
    // Mimarlıkta sık kullanılan antrasit tonu → 7016 civarı (gri ailesi).
    expect(nearestRal({ r: 41, g: 49, b: 51 })?.code).toBe("RAL 7016");
  });

  it("uzak eşleşmeyi İŞARETLER (sessizce 'en yakın' diye sunmaz)", () => {
    // Tabloda karşılığı olmayan doygun bir eflatun: en yakın bulunur ama `far` ile uyarılır.
    const match = nearestRal({ r: 255, g: 0, b: 255 });
    expect(match).not.toBeNull();
    expect(match!.delta).toBeGreaterThan(RAL_FAR_MATCH_DELTA);
    expect(match!.far).toBe(true);
  });

  it("ΔE sıralaması gerçekten en yakını seçer (tablonun tamamı taranır)", () => {
    const probe = { r: 120, g: 140, b: 160 };
    const match = nearestRal(probe)!;
    // Tablodaki HİÇBİR renk, döndürülen eşleşmeden daha yakın olmamalı.
    for (const color of RAL_CLASSIC) {
      const delta = rgbDeltaE(probe, hexToRgb(color.hex)!);
      expect(delta, `${color.code} daha yakın çıktı`).toBeGreaterThanOrEqual(match.delta - 1e-9);
    }
  });
});
