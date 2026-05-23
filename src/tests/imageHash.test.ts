/**
 * imageHash — bytesToBase64 (dahili) ve Tauri-bağımlı fonksiyonların fallback davranışı.
 * Tauri export fonksiyonları (computeImagePhashFromPath vb.) invoke bağımlı.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.reject(new Error('Tauri not available'))),
}));

import { computeImagePhashFromPath, computeImagePhashFromFile, getHammingDistance } from '../services/imageHash';

describe('imageHash — Tauri unavailable', () => {
    it('computeImagePhashFromPath exception fırlatır (Tauri yok)', async () => {
        await expect(computeImagePhashFromPath('C:\\test.jpg')).rejects.toThrow();
    });

    it('computeImagePhashFromFile exception fırlatır (Tauri yok)', async () => {
        const fakeFile = new File([''], 'test.jpg', { type: 'image/jpeg' });
        await expect(computeImagePhashFromFile(fakeFile)).rejects.toThrow();
    });

    it('getHammingDistance exception fırlatır (Tauri yok)', async () => {
        await expect(getHammingDistance('aaaa', 'bbbb')).rejects.toThrow();
    });
});

describe('imageHash — Tauri available mock', () => {
    it('computeImagePhashFromPath invoke çağrılır ve değer döner', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        vi.mocked(invoke).mockResolvedValueOnce('abcdef1234567890');
        const result = await computeImagePhashFromPath('C:\\photo.jpg');
        expect(result).toBe('abcdef1234567890');
        expect(invoke).toHaveBeenCalledWith('compute_image_phash', { path: 'C:\\photo.jpg' });
    });

    it('getHammingDistance invoke çağrılır ve sayı döner', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        vi.mocked(invoke).mockResolvedValueOnce(5);
        const dist = await getHammingDistance('aaaa1111', 'aaaa2222');
        expect(dist).toBe(5);
        expect(invoke).toHaveBeenCalledWith('hamming_distance', { hashA: 'aaaa1111', hashB: 'aaaa2222' });
    });

    it('computeImagePhashFromFile — File verisini base64 dönüştürüp invoke çağrılır', async () => {
        const { invoke } = await import('@tauri-apps/api/core');
        vi.mocked(invoke).mockResolvedValueOnce('ff00112233445566');

        // Gerçek File API test ortamında mevcut
        const content = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const file = new File([content], 'test.jpg', { type: 'image/jpeg' });

        const result = await computeImagePhashFromFile(file);
        expect(result).toBe('ff00112233445566');
        expect(invoke).toHaveBeenCalledWith('compute_image_phash_from_bytes', {
            base64Data: expect.any(String),
        });
    });
});
