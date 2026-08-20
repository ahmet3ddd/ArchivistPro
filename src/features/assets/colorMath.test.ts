// Renk matematiği sözleşme testleri.
//
// ΔE2000 formülü uzun ve TERS-SIRA/aralık hatalarına açıktır (açı sarmalı, hue ortalaması,
// rotasyon terimi). Bu yüzden literatürün standart doğrulama kümesi kullanılır:
// Sharma, Wu & Dalal (2005) "The CIEDE2000 Color-Difference Formula" ekindeki test çiftleri —
// her biri formülün AYRI bir köşe durumunu (hue sarmalı, nötr renk, mavi rotasyonu) yoklar.
// Elle yazılmış bir uygulamanın doğruluğu ancak bu çiftlerle kanıtlanır.

import { describe, expect, it } from "vitest";

import { deltaE2000, hexToRgb, rgbDeltaE, rgbToHex, rgbToHsl, rgbToLab } from "./colorMath";

describe("rgbToLab", () => {
  it("beyaz/siyah/gri referans noktalarını tutturur", () => {
    const white = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.l).toBeCloseTo(100, 2);
    expect(white.a).toBeCloseTo(0, 1);
    expect(white.b).toBeCloseTo(0, 1);

    const black = rgbToLab({ r: 0, g: 0, b: 0 });
    expect(black.l).toBeCloseTo(0, 4);

    // Orta gri: nötr → a,b ≈ 0 (renk sapması yok).
    const gray = rgbToLab({ r: 128, g: 128, b: 128 });
    expect(gray.a).toBeCloseTo(0, 1);
    expect(gray.b).toBeCloseTo(0, 1);
    expect(gray.l).toBeGreaterThan(50);
    expect(gray.l).toBeLessThan(56);
  });

  it("saf kırmızıyı bilinen Lab değerine çevirir", () => {
    const red = rgbToLab({ r: 255, g: 0, b: 0 });
    expect(red.l).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
    expect(red.b).toBeCloseTo(67.2, 1);
  });
});

describe("deltaE2000 — Sharma/Wu/Dalal referans çiftleri", () => {
  // [L1,a1,b1, L2,a2,b2, beklenen ΔE00]
  const CASES: [number, number, number, number, number, number, number][] = [
    [50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425], // mavi rotasyon terimi
    [50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615],
    [50, 2.8361, -74.02, 50, 0, -82.7485, 3.4412],
    [50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0], // hue sarmalı
    [50, -1.1848, -84.8006, 50, 0, -82.7485, 1.0],
    [50, 2.5, 0, 50, 3.1736, 0.5854, 1.0], // sC/sH ölçekleri
    [50, 2.5, 0, 73, 25, -18, 27.1492], // uzak çift
  ];

  it("beklenen değerleri 1e-3 hassasiyetle üretir", () => {
    for (const [l1, a1, b1, l2, a2, b2, expected] of CASES) {
      const got = deltaE2000({ l: l1, a: a1, b: b1 }, { l: l2, a: a2, b: b2 });
      expect(got, `${l1},${a1},${b1} ↔ ${l2},${a2},${b2}`).toBeCloseTo(expected, 3);
    }
  });

  it("simetriktir (a↔b sırası sonucu değiştirmez)", () => {
    const x = { l: 50, a: 2.6772, b: -79.7751 };
    const y = { l: 50, a: 0, b: -82.7485 };
    expect(deltaE2000(x, y)).toBeCloseTo(deltaE2000(y, x), 10);
  });

  it("aynı renk için 0 döner", () => {
    expect(deltaE2000({ l: 42, a: 5, b: -3 }, { l: 42, a: 5, b: -3 })).toBe(0);
  });
});

describe("rgbDeltaE — algısal sıralama RGB uzaklığından FARKLIDIR", () => {
  // Bu testin varlık sebebi: naif RGB uzaklığı kullanılsaydı "en yakın RAL" gözle yanlış
  // görünürdü. Koyu tonlarda aynı sayısal RGB farkı, açık tonlardakinden DAHA AZ görünür.
  it("koyu tondaki 20 birimlik fark, açık tondakinden daha küçük ΔE üretir", () => {
    const darkPair = rgbDeltaE({ r: 10, g: 10, b: 10 }, { r: 30, g: 30, b: 30 });
    const lightPair = rgbDeltaE({ r: 200, g: 200, b: 200 }, { r: 220, g: 220, b: 220 });
    expect(darkPair).toBeGreaterThan(lightPair);
  });

  it("beyaz↔siyah farkı en büyük uçtadır", () => {
    expect(rgbDeltaE({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeGreaterThan(90);
  });
});

describe("hex/hsl yardımcıları", () => {
  it("hex gidiş-dönüşü kayıpsızdır", () => {
    expect(rgbToHex({ r: 79, g: 106, b: 125 })).toBe("#4f6a7d");
    expect(hexToRgb("#4F6A7D")).toEqual({ r: 79, g: 106, b: 125 });
    expect(hexToRgb("4f6a7d")).toEqual({ r: 79, g: 106, b: 125 });
  });

  it("geçersiz hex null döner (bozuk tablo sessizce yanlış renk üretmesin)", () => {
    expect(hexToRgb("#fff")).toBeNull();
    expect(hexToRgb("mavi")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });

  it("HSL bilinen değerleri verir", () => {
    expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 100, l: 50 });
    const green = rgbToHsl({ r: 0, g: 255, b: 0 });
    expect(green.h).toBeCloseTo(120, 6);
    const gray = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(gray.s).toBe(0);
    expect(gray.h).toBe(0); // nötrde hue tanımsız → kararlı 0
  });
});
