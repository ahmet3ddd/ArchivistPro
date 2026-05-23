/**
 * Pure JavaScript SHA-256 — senkron, harici bağımlılık yok.
 *
 * FIPS 180-4 referansına göre yazılmıştır. Logger'ın auditLog fonksiyonu
 * sync olduğu için Web Crypto API (async `crypto.subtle.digest`) kullanılamıyor;
 * bu modül sadece bu kullanım senaryosu için gereklidir.
 *
 * Sadece UTF-8 string input → 64-karakter hex string output.
 * Binary input gerekirse genişletilir.
 */

/* eslint-disable no-bitwise */

const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const H0 = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

function rotr(x: number, n: number): number {
    return (x >>> n) | (x << (32 - n));
}

/** UTF-8 encode — TextEncoder ile (standart Node/browser). */
function utf8Bytes(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

/** Mesajı FIPS 180-4 §5.1.1'e göre pad eder: `1` biti, sıfırlar, 64-bit büyük-endian uzunluk. */
function pad(bytes: Uint8Array): Uint8Array {
    const bitLen = bytes.length * 8;
    // 448 ≡ len (mod 512) olacak şekilde doldur — bytes cinsinden (len + 1 + pad) % 64 === 56
    const padLen = (56 - (bytes.length + 1) % 64 + 64) % 64;
    const out = new Uint8Array(bytes.length + 1 + padLen + 8);
    out.set(bytes);
    out[bytes.length] = 0x80;
    // son 8 byte: big-endian bit uzunluğu
    // JS bitwise 32-bit; yüksek 32 biti de doğru yaz
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    out[out.length - 8] = (hi >>> 24) & 0xff;
    out[out.length - 7] = (hi >>> 16) & 0xff;
    out[out.length - 6] = (hi >>> 8) & 0xff;
    out[out.length - 5] = hi & 0xff;
    out[out.length - 4] = (lo >>> 24) & 0xff;
    out[out.length - 3] = (lo >>> 16) & 0xff;
    out[out.length - 2] = (lo >>> 8) & 0xff;
    out[out.length - 1] = lo & 0xff;
    return out;
}

/** Tek 512-bit (64-byte) bloğu işler. */
function processBlock(block: Uint8Array, offset: number, h: Int32Array): void {
    const w = new Int32Array(64);
    for (let t = 0; t < 16; t++) {
        const i = offset + t * 4;
        w[t] = (block[i] << 24) | (block[i + 1] << 16) | (block[i + 2] << 8) | block[i + 3];
    }
    for (let t = 16; t < 64; t++) {
        const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
        const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }

    let a = h[0], b = h[1], c = h[2], d = h[3];
    let e = h[4], f = h[5], g = h[6], hh = h[7];

    for (let t = 0; t < 64; t++) {
        const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const t1 = (hh + s1 + ch + K[t] + w[t]) | 0;
        const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const mj = (a & b) ^ (a & c) ^ (b & c);
        const t2 = (s0 + mj) | 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
    }

    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + hh) | 0;
}

function toHex(h: Int32Array): string {
    let out = '';
    for (let i = 0; i < 8; i++) {
        out += (h[i] >>> 0).toString(16).padStart(8, '0');
    }
    return out;
}

/**
 * SHA-256 hex digest — senkron.
 * @param input UTF-8 string
 * @returns 64-karakter küçük harf hex string
 */
export function sha256Hex(input: string): string {
    const bytes = pad(utf8Bytes(input));
    const h = new Int32Array(H0);
    for (let offset = 0; offset < bytes.length; offset += 64) {
        processBlock(bytes, offset, h);
    }
    return toHex(h);
}
