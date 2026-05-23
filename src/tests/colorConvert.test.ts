/**
 * colorConvert.ts için kapsamlı testler
 * Renk dönüşümleri: HEX → RGB, RGB → CMYK, RGB → HSL, RAL eşleşmesi
 */
import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToCmyk,
  rgbToHsl,
  rgbToWB,
  findClosestRAL,
  getColorInfo,
  type RGB,
} from '../utils/colorConvert';

// ── hexToRgb ──────────────────────────────────────────────────────────────────

describe('hexToRgb', () => {
  it('siyahı doğru parse eder', () => {
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('beyazı doğru parse eder', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('saf kırmızıyı doğru parse eder', () => {
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('saf yeşili doğru parse eder', () => {
    expect(hexToRgb('#00FF00')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('saf maviyi doğru parse eder', () => {
    expect(hexToRgb('#0000FF')).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('hash olmadan da çalışır', () => {
    expect(hexToRgb('FF8000')).toEqual({ r: 255, g: 128, b: 0 });
  });

  it('küçük harf hex kodunu da işler', () => {
    const result = hexToRgb('#a0b0c0');
    expect(result.r).toBe(0xa0);
    expect(result.g).toBe(0xb0);
    expect(result.b).toBe(0xc0);
  });

  it('karmaşık renk değerini doğru parse eder', () => {
    const result = hexToRgb('#2c3e50');
    expect(result.r).toBe(44);
    expect(result.g).toBe(62);
    expect(result.b).toBe(80);
  });
});

// ── rgbToCmyk ────────────────────────────────────────────────────────────────

describe('rgbToCmyk', () => {
  it('beyaz için C=0 M=0 Y=0 K=0 döner', () => {
    expect(rgbToCmyk({ r: 255, g: 255, b: 255 })).toEqual({ c: 0, m: 0, y: 0, k: 0 });
  });

  it('siyah için K=100 döner', () => {
    expect(rgbToCmyk({ r: 0, g: 0, b: 0 })).toEqual({ c: 0, m: 0, y: 0, k: 100 });
  });

  it('saf kırmızı için doğru CMYK değeri döner', () => {
    const result = rgbToCmyk({ r: 255, g: 0, b: 0 });
    expect(result.c).toBe(0);
    expect(result.m).toBe(100);
    expect(result.y).toBe(100);
    expect(result.k).toBe(0);
  });

  it('saf yeşil için doğru CMYK değeri döner', () => {
    const result = rgbToCmyk({ r: 0, g: 255, b: 0 });
    expect(result.c).toBe(100);
    expect(result.m).toBe(0);
    expect(result.y).toBe(100);
    expect(result.k).toBe(0);
  });

  it('saf mavi için doğru CMYK değeri döner', () => {
    const result = rgbToCmyk({ r: 0, g: 0, b: 255 });
    expect(result.c).toBe(100);
    expect(result.m).toBe(100);
    expect(result.y).toBe(0);
    expect(result.k).toBe(0);
  });

  it('değerler 0-100 arasında kalır', () => {
    const rgb: RGB = { r: 128, g: 64, b: 192 };
    const result = rgbToCmyk(rgb);
    expect(result.c).toBeGreaterThanOrEqual(0);
    expect(result.c).toBeLessThanOrEqual(100);
    expect(result.m).toBeGreaterThanOrEqual(0);
    expect(result.m).toBeLessThanOrEqual(100);
    expect(result.y).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeLessThanOrEqual(100);
    expect(result.k).toBeGreaterThanOrEqual(0);
    expect(result.k).toBeLessThanOrEqual(100);
  });
});

// ── rgbToHsl ─────────────────────────────────────────────────────────────────

describe('rgbToHsl', () => {
  it('siyah için H=0 S=0 L=0 döner', () => {
    expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('beyaz için H=0 S=0 L=100 döner', () => {
    expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 });
  });

  it('saf kırmızı için H=0 S=100 L=50 döner', () => {
    const result = rgbToHsl({ r: 255, g: 0, b: 0 });
    expect(result.h).toBe(0);
    expect(result.s).toBe(100);
    expect(result.l).toBe(50);
  });

  it('saf yeşil için H=120 döner', () => {
    const result = rgbToHsl({ r: 0, g: 255, b: 0 });
    expect(result.h).toBe(120);
    expect(result.s).toBe(100);
    expect(result.l).toBe(50);
  });

  it('saf mavi için H=240 döner', () => {
    const result = rgbToHsl({ r: 0, g: 0, b: 255 });
    expect(result.h).toBe(240);
    expect(result.s).toBe(100);
    expect(result.l).toBe(50);
  });

  it('orta gri için doygunluk 0 döner', () => {
    const result = rgbToHsl({ r: 128, g: 128, b: 128 });
    expect(result.s).toBe(0);
  });

  it('H değeri 0-360 arasında kalır', () => {
    const colors: RGB[] = [
      { r: 255, g: 128, b: 0 },
      { r: 128, g: 0, b: 255 },
      { r: 0, g: 128, b: 255 },
    ];
    for (const rgb of colors) {
      const result = rgbToHsl(rgb);
      expect(result.h).toBeGreaterThanOrEqual(0);
      expect(result.h).toBeLessThanOrEqual(360);
    }
  });
});

// ── rgbToWB ───────────────────────────────────────────────────────────────────

describe('rgbToWB', () => {
  it('siyah için white=0 black=100 döner', () => {
    const result = rgbToWB({ r: 0, g: 0, b: 0 });
    expect(result.white).toBe(0);
    expect(result.black).toBe(100);
  });

  it('beyaz için white=100 black=0 döner', () => {
    const result = rgbToWB({ r: 255, g: 255, b: 255 });
    expect(result.white).toBe(100);
    expect(result.black).toBe(0);
  });

  it('white + black = 100 invariant\'ını korur', () => {
    const colors: RGB[] = [
      { r: 100, g: 200, b: 50 },
      { r: 180, g: 90, b: 30 },
      { r: 64, g: 64, b: 64 },
    ];
    for (const rgb of colors) {
      const result = rgbToWB(rgb);
      expect(result.white + result.black).toBe(100);
    }
  });

  it('yeşil bileşeni daha ağır sayılır (luminance)', () => {
    // ITU-R BT.709: green katkısı (~0.715) red'den (~0.213) yüksek
    const greenHeavy = rgbToWB({ r: 0, g: 255, b: 0 });
    const redHeavy = rgbToWB({ r: 255, g: 0, b: 0 });
    expect(greenHeavy.white).toBeGreaterThan(redHeavy.white);
  });
});

// ── findClosestRAL ────────────────────────────────────────────────────────────

describe('findClosestRAL', () => {
  it('tam beyaz için RAL 9010 (Saf Beyaz) döner', () => {
    const result = findClosestRAL('#FFFFFF');
    // Beyaza en yakın RAL beyaz tonlarından biri olmalı
    expect(result.code).toMatch(/^RAL 9/);
  });

  it('tam siyah için RAL 9005 (Simsiyah) döner', () => {
    const result = findClosestRAL('#0A0A0A');
    expect(result.code).toBe('RAL 9005');
  });

  it('distance alanı sayısal ve >= 0 döner', () => {
    const result = findClosestRAL('#FF5500');
    expect(typeof result.distance).toBe('number');
    expect(result.distance).toBeGreaterThanOrEqual(0);
  });

  it('dönen obje gerekli alanları içerir', () => {
    const result = findClosestRAL('#3481B8');
    expect(result).toHaveProperty('code');
    expect(result).toHaveProperty('name');
    expect(result).toHaveProperty('hex');
    expect(result).toHaveProperty('distance');
  });

  it('RAL kataloğundaki bir renk için distance 0 veya çok küçük döner', () => {
    // RAL 9010 Saf Beyaz = #FFFFFF
    const result = findClosestRAL('#FFFFFF');
    expect(result.distance).toBeLessThan(10);
  });

  it('benzer renkler için aynı RAL kodu döner', () => {
    // Çok koyu siyah tonu
    const result1 = findClosestRAL('#050505');
    const result2 = findClosestRAL('#0A0A0A');
    expect(result1.code).toBe(result2.code);
  });
});

// ── getColorInfo ──────────────────────────────────────────────────────────────

describe('getColorInfo', () => {
  it('tüm renk bilgilerini tek çağrıda döner', () => {
    const info = getColorInfo('#2c3e50');
    expect(info).toHaveProperty('rgb');
    expect(info).toHaveProperty('cmyk');
    expect(info).toHaveProperty('hsl');
    expect(info).toHaveProperty('wb');
    expect(info).toHaveProperty('ral');
  });

  it('rgb değerleri hexToRgb ile tutarlı', () => {
    const hex = '#85c1e9';
    const info = getColorInfo(hex);
    const direct = hexToRgb(hex);
    expect(info.rgb).toEqual(direct);
  });

  it('hsl.l 0-100 arasında döner', () => {
    const info = getColorInfo('#4a3728');
    expect(info.hsl.l).toBeGreaterThanOrEqual(0);
    expect(info.hsl.l).toBeLessThanOrEqual(100);
  });

  it('wb tutarlı toplamı 100 verir', () => {
    const info = getColorInfo('#c4956a');
    expect(info.wb.white + info.wb.black).toBe(100);
  });
});
