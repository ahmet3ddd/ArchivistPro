/**
 * LAN İstemci Servisi testleri.
 *
 * fetch global'ı vi.fn() ile mock edilir — ağ bağlantısı yok.
 * verifyDownloadIntegrity Web Crypto API kullanır (test ortamında mevcut).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    lanPing,
    lanFetchManifest,
    lanDownloadArchive,
    verifyDownloadIntegrity,
} from '../services/lanService';
import type { LanServerInfo } from '../services/lanService';

// TIMINGS mock — timeout'ları makul tut
vi.mock('../config/constants', () => ({
    TIMINGS: {
        AI_REQUEST_TIMEOUT_MS: 5000,
        LAN_DOWNLOAD_TIMEOUT_MS: 30000,
    },
}));

const SERVER: LanServerInfo = {
    host: '192.168.1.100',
    port: 9471,
    authCode: '12345678',
};

/* ── Fetch mock helpers ── */

function mockFetch(response: Partial<Response>, body?: unknown): void {
    const jsonFn = body !== undefined ? () => Promise.resolve(body) : () => Promise.resolve({});
    const defaultResp: Partial<Response> = {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: jsonFn,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        body: null,
        ...response,
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(defaultResp as Response));
}

function mockFetchThrow(err?: Error): void {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err ?? new Error('Network error')));
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

/* ── lanPing ── */

describe('lanPing', () => {
    it('status:ok → true döner', async () => {
        mockFetch({ ok: true }, { status: 'ok' });
        expect(await lanPing(SERVER)).toBe(true);
    });

    it('status:ok değilse → false döner', async () => {
        mockFetch({ ok: true }, { status: 'error' });
        expect(await lanPing(SERVER)).toBe(false);
    });

    it('HTTP hata (404) → false döner', async () => {
        mockFetch({ ok: false, status: 404 });
        expect(await lanPing(SERVER)).toBe(false);
    });

    it('fetch exception → false döner (try/catch)', async () => {
        mockFetchThrow();
        expect(await lanPing(SERVER)).toBe(false);
    });

    it('doğru URL ile çağrılır (/ping auth\'suz)', async () => {
        mockFetch({ ok: true }, { status: 'ok' });
        await lanPing(SERVER);
        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0][0]).toBe('http://192.168.1.100:9471/ping');
        // /ping auth header içermemeli
        expect(calls[0][1]?.headers?.['X-Auth-Code']).toBeUndefined();
    });
});

/* ── lanFetchManifest ── */

describe('lanFetchManifest', () => {
    it('başarılı yanıt → manifest objesi döner', async () => {
        const manifest = { version: 1, appVersion: '2.3.1', dbSizeBytes: 5242880, createdAt: '2026-04-23T12:00:00Z', sha256: 'abc123' };
        mockFetch({ ok: true }, manifest);
        const result = await lanFetchManifest(SERVER);
        expect(result).toEqual(manifest);
    });

    it('HTTP hata → null döner', async () => {
        mockFetch({ ok: false, status: 403 });
        expect(await lanFetchManifest(SERVER)).toBeNull();
    });

    it('fetch exception → null döner', async () => {
        mockFetchThrow();
        expect(await lanFetchManifest(SERVER)).toBeNull();
    });

    it('X-Auth-Code header ile çağrılır', async () => {
        mockFetch({ ok: true }, {});
        await lanFetchManifest(SERVER);
        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0][1]?.headers?.['X-Auth-Code']).toBe('12345678');
    });

    it('/manifest endpoint kullanılır', async () => {
        mockFetch({ ok: true }, {});
        await lanFetchManifest(SERVER);
        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0][0]).toBe('http://192.168.1.100:9471/manifest');
    });
});

/* ── lanDownloadArchive ── */

describe('lanDownloadArchive', () => {
    it('HTTP hata → null döner', async () => {
        mockFetch({ ok: false, status: 503 });
        expect(await lanDownloadArchive(SERVER)).toBeNull();
    });

    it('fetch exception → null döner', async () => {
        mockFetchThrow();
        expect(await lanDownloadArchive(SERVER)).toBeNull();
    });

    it('body null (ReadableStream yok) → arrayBuffer fallback', async () => {
        const buf = new ArrayBuffer(10);
        mockFetch({
            ok: true,
            body: null,
            headers: new Headers({ 'Content-Length': '10' }),
            arrayBuffer: () => Promise.resolve(buf),
        });
        const result = await lanDownloadArchive(SERVER);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result!.byteLength).toBe(10);
    });

    it('X-Auth-Code header ile çağrılır', async () => {
        mockFetch({ ok: false });
        await lanDownloadArchive(SERVER);
        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0][1]?.headers?.['X-Auth-Code']).toBe('12345678');
    });

    it('/download endpoint kullanılır', async () => {
        mockFetch({ ok: false });
        await lanDownloadArchive(SERVER);
        const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
        expect(calls[0][0]).toBe('http://192.168.1.100:9471/download');
    });

    it('progress callback — chunked okumada çağrılır (ReadableStream)', async () => {
        // ReadableStream mock
        const chunk = new Uint8Array([1, 2, 3, 4, 5]);
        let callCount = 0;
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: chunk })
                .mockResolvedValueOnce({ done: true, value: undefined }),
        };
        const mockBody = { getReader: () => reader };
        mockFetch({
            ok: true,
            body: mockBody as unknown as ReadableStream,
            headers: new Headers({ 'Content-Length': '5' }),
        });

        const onProgress = vi.fn((loaded: number, total: number) => {
            callCount++;
            expect(typeof loaded).toBe('number');
            expect(typeof total).toBe('number');
        });
        const result = await lanDownloadArchive(SERVER, onProgress);
        expect(callCount).toBeGreaterThan(0);
        expect(result).toBeInstanceOf(Uint8Array);
        expect(result!.byteLength).toBe(5);
    });
});

/* ── verifyDownloadIntegrity ── */

describe('verifyDownloadIntegrity', () => {
    it('expectedSha256 yoksa (undefined) → true döner (eski sunucu)', async () => {
        const data = new Uint8Array([1, 2, 3]);
        expect(await verifyDownloadIntegrity(data, undefined)).toBe(true);
    });

    it('doğru SHA-256 ile eşleşir', async () => {
        // SHA-256("abc") = ba7816bf...
        const data = new TextEncoder().encode('abc');
        const expectedHex = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
        expect(await verifyDownloadIntegrity(data, expectedHex)).toBe(true);
    });

    it('yanlış SHA-256 ile eşleşmez', async () => {
        const data = new TextEncoder().encode('abc');
        expect(await verifyDownloadIntegrity(data, '0000000000000000000000000000000000000000000000000000000000000000')).toBe(false);
    });

    it('büyük harf hash de eşleşir (toLowerCase ile normalize)', async () => {
        const data = new TextEncoder().encode('abc');
        const upperHex = 'BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD';
        expect(await verifyDownloadIntegrity(data, upperHex)).toBe(true);
    });

    it('boş veri → doğru hash ile eşleşir', async () => {
        const data = new Uint8Array(0);
        // SHA-256("") = e3b0c442...
        const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
        expect(await verifyDownloadIntegrity(data, emptyHash)).toBe(true);
    });
});
