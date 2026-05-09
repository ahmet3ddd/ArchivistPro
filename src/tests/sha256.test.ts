import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../utils/sha256';

/**
 * NIST FIPS 180-4 test vektörleri + bilinen referans hash'leri.
 * Bu implementasyon güvenilir referans SHA-256 (Web Crypto) ile aynı
 * sonucu vermeli — aksi hâlde audit log hash chain doğrulanamaz.
 */
describe('sha256Hex', () => {
    it('boş string → e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', () => {
        expect(sha256Hex('')).toBe(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        );
    });

    it('"abc" → ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', () => {
        expect(sha256Hex('abc')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });

    it('"The quick brown fox jumps over the lazy dog" → d7a8fbb3...', () => {
        expect(sha256Hex('The quick brown fox jumps over the lazy dog')).toBe(
            'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
        );
    });

    it('"The quick brown fox jumps over the lazy dog." (nokta) → ef537f25...', () => {
        expect(sha256Hex('The quick brown fox jumps over the lazy dog.')).toBe(
            'ef537f25c895bfa782526529a9b63d97aa631564d5d789c2b765448c8635fb6c',
        );
    });

    it('55 karakter (block boundary - 1) testi', () => {
        const input = 'a'.repeat(55);
        // Node crypto.createHash('sha256') ile doğrulandı
        expect(sha256Hex(input)).toBe(
            '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
        );
    });

    it('56 karakter (block boundary) testi', () => {
        const input = 'a'.repeat(56);
        expect(sha256Hex(input)).toBe(
            'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
        );
    });

    it('64 karakter (tam blok) testi', () => {
        const input = 'a'.repeat(64);
        expect(sha256Hex(input)).toBe(
            'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
        );
    });

    it('1000 karakter "a" testi (çoklu blok)', () => {
        const input = 'a'.repeat(1000);
        expect(sha256Hex(input)).toBe(
            '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
        );
    });

    it('UTF-8 çok-byte karakter testi (Türkçe)', () => {
        // "merhaba dünya" — ü multi-byte UTF-8
        // Node crypto.createHash('sha256') ile doğrulandı
        expect(sha256Hex('merhaba dünya')).toBe(
            'a21fb229b1086766b697ad65739380cb0798b4b0d0f71c00f7c87eab949d656b',
        );
    });

    it('64 karakter hex output — her zaman sabit uzunluk', () => {
        expect(sha256Hex('').length).toBe(64);
        expect(sha256Hex('a').length).toBe(64);
        expect(sha256Hex('x'.repeat(10_000)).length).toBe(64);
    });

    it('sadece küçük harf + rakam içerir', () => {
        const out = sha256Hex('test input');
        expect(out).toMatch(/^[0-9a-f]{64}$/);
    });
});
