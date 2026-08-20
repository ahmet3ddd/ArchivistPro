// Renk dönüşümleri + algısal fark — SAF fonksiyonlar (React/i18n yok → birim test edilebilir).
//
// Neden burada: detay panelindeki renk kartelası artık HEX'in yanında RGB · HSL gösteriyor ve
// en yakın RAL Classic rengini buluyor. "En yakın renk" naif RGB uzaklığıyla hesaplanamaz:
// RGB uzayı algısal olarak DÜZGÜN DEĞİLDİR (koyu tonlarda 10 birim fark gözle görünmez, açık
// tonlarda göze batar). Doğrusu CIELAB + CIEDE2000. Zaten çıkarım tarafı da baskın renkleri
// CIELAB k-means ile buluyor (`image_meta.rs:266`) — aynı uzayda kalıyoruz.
//
// ⚠️ D65 / 2° gözlemci varsayılır (sRGB'nin tanımı). Ekrandan gelen bir renk ile fiziksel bir
// boya standardı arasındaki eşleşme DAİMA yaklaşıktır; bu yüzden ΔE değeri UI'da gösterilir
// (bkz `ralMatch`) — "yakın mı, uzak mı" kararını kullanıcı görebilsin.

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

const clamp255 = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** `#rrggbb` (küçük harf). */
export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;
}

/** `#rrggbb` / `rrggbb` → RGB. Geçersiz girdi → null (tablo/JSON bozulursa sessizce yanlış renk üretme). */
export function hexToRgb(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** RGB → HSL (h: 0–360, s/l: 0–100). Gri tonlarda h=0 (tanımsız yerine kararlı değer). */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = clamp255(r) / 255;
  const gn = clamp255(g) / 255;
  const bn = clamp255(b) / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

/** sRGB kanalı → lineer ışık (gamma çözme; sRGB EOTF). */
function toLinear(channel: number): number {
  const c = clamp255(channel) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** sRGB → CIELAB (D65). `image_meta.rs::srgb_to_lab` ile aynı dönüşüm (aynı beyaz nokta). */
export function rgbToLab(rgb: Rgb): Lab {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  // sRGB → XYZ (D65 matrisi).
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * **CIEDE2000** algısal renk farkı (ΔE00). Kaba kural: <1 gözle ayırt edilemez · 1–2 çok yakın ·
 * 2–5 yakın (aynı ailenin tonu) · >5 gözle net farklı · >10 başka renk.
 *
 * Neden ΔE76 değil: ΔE76 (düz Öklid) maviyi ve doygun tonları abartır, açık grileri küçümser →
 * "en yakın RAL" sıralaması gözle uyuşmaz. ΔE00 tam bu sapmaları düzelten standarttır.
 * Uygulama Sharma/Wu/Dalal referans veri kümesiyle test edilir (bkz `colorMath.test.ts`).
 */
export function deltaE2000(a: Lab, b: Lab): number {
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const c1 = Math.hypot(a.a, a.b);
  const c2 = Math.hypot(b.a, b.b);
  const cBar = (c1 + c2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))));

  const a1p = (1 + g) * a.a;
  const a2p = (1 + g) * b.a;
  const c1p = Math.hypot(a1p, a.b);
  const c2p = Math.hypot(a2p, b.b);

  const h1p = c1p === 0 ? 0 : (deg(Math.atan2(a.b, a1p)) + 360) % 360;
  const h2p = c2p === 0 ? 0 : (deg(Math.atan2(b.b, a2p)) + 360) % 360;

  const dLp = b.l - a.l;
  const dCp = c2p - c1p;

  let dhp: number;
  if (c1p * c2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(rad(dhp) / 2);

  const lBarP = (a.l + b.l) / 2;
  const cBarP = (c1p + c2p) / 2;

  let hBarP: number;
  if (c1p * c2p === 0) hBarP = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hBarP = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hBarP = (h1p + h2p + 360) / 2;
  else hBarP = (h1p + h2p - 360) / 2;

  const t =
    1 -
    0.17 * Math.cos(rad(hBarP - 30)) +
    0.24 * Math.cos(rad(2 * hBarP)) +
    0.32 * Math.cos(rad(3 * hBarP + 6)) -
    0.2 * Math.cos(rad(4 * hBarP - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hBarP - 275) / 25, 2));
  const cBarP7 = Math.pow(cBarP, 7);
  const rC = 2 * Math.sqrt(cBarP7 / (cBarP7 + Math.pow(25, 7)));
  const rT = -rC * Math.sin(rad(2 * dTheta));

  const lBarP50 = Math.pow(lBarP - 50, 2);
  const sL = 1 + (0.015 * lBarP50) / Math.sqrt(20 + lBarP50);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;

  const termL = dLp / (kL * sL);
  const termC = dCp / (kC * sC);
  const termH = dHp / (kH * sH);
  return Math.sqrt(termL * termL + termC * termC + termH * termH + rT * termC * termH);
}

/** İki sRGB renk arasındaki algısal fark (ΔE00) — çağıranın Lab'a inmesine gerek kalmasın. */
export function rgbDeltaE(a: Rgb, b: Rgb): number {
  return deltaE2000(rgbToLab(a), rgbToLab(b));
}
