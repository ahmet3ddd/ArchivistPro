/**
 * fetchWithTimeout utility testleri.
 * fetch global'ı vi.stubGlobal ile mock edilir.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/constants', () => ({
    TIMINGS: { API_TIMEOUT_MS: 5000 },
}));

import { fetchWithTimeout } from '../utils/fetchWithTimeout';

const MOCK_RESPONSE = {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: 'ok' }),
    text: () => Promise.resolve('ok'),
} as Response;

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('fetchWithTimeout', () => {
    it('başarılı fetch sonucu döner', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(MOCK_RESPONSE));
        const resp = await fetchWithTimeout('http://example.com/api');
        expect(resp.ok).toBe(true);
    });

    it('URL doğru iletilir', async () => {
        const mockFetch = vi.fn().mockResolvedValue(MOCK_RESPONSE);
        vi.stubGlobal('fetch', mockFetch);
        await fetchWithTimeout('http://test.com/endpoint');
        expect(mockFetch.mock.calls[0][0]).toBe('http://test.com/endpoint');
    });

    it('options merge edilir', async () => {
        const mockFetch = vi.fn().mockResolvedValue(MOCK_RESPONSE);
        vi.stubGlobal('fetch', mockFetch);
        const opts: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
        await fetchWithTimeout('http://test.com/', opts);
        const calledOpts = mockFetch.mock.calls[0][1] as RequestInit;
        expect(calledOpts.method).toBe('POST');
        expect((calledOpts.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });

    it('AbortSignal options\'a eklenir', async () => {
        const mockFetch = vi.fn().mockResolvedValue(MOCK_RESPONSE);
        vi.stubGlobal('fetch', mockFetch);
        await fetchWithTimeout('http://test.com/', {});
        const calledOpts = mockFetch.mock.calls[0][1] as RequestInit;
        expect(calledOpts.signal).toBeInstanceOf(AbortSignal);
    });

    it('fetch exception propagate edilir', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
        await expect(fetchWithTimeout('http://test.com/')).rejects.toThrow('network error');
    });

    it('timeout süresi 0 olduğunda hemen abort eder', async () => {
        // Çok uzun süren fetch simüle et
        vi.stubGlobal('fetch', vi.fn((_url: string, opts: RequestInit) => {
            return new Promise<Response>((resolve, reject) => {
                opts.signal?.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'));
                });
                // 10 saniye bekleyen işlem — timeout zaten abort eder
            });
        }));
        await expect(fetchWithTimeout('http://test.com/', {}, 0)).rejects.toThrow();
    });

    it('özel timeout parametresi kullanılır', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(MOCK_RESPONSE));
        // timeout=100ms, fetch anında dönüyor — sorun yok
        const resp = await fetchWithTimeout('http://test.com/', {}, 100);
        expect(resp).toBeDefined();
    });

    it('HTTP 4xx hatası response olarak döner (exception atmaz)', async () => {
        const errResp = { ok: false, status: 404, statusText: 'Not Found' } as Response;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errResp));
        const resp = await fetchWithTimeout('http://test.com/missing');
        expect(resp.ok).toBe(false);
        expect(resp.status).toBe(404);
    });
});
