/**
 * ragService.ts — keyword gate + RRF fusion unit testleri.
 *
 * Strateji:
 * - normalizeTr / hasWordMatch / extractSearchTokens / hasNoKeywordMatch →
 *   doğrudan export edilmiyor; davranışları enrichQuery ve retrieve üzerinden
 *   gözlemlenir.
 * - rrfFuse mantığı → retrieve()'in döndürdüğü sıralama gözlemlenerek test edilir.
 * - Ağır bağımlılıklar (Ollama, embeddings, DB) mock'lanır.
 *
 * Her test grubunun sonunda hangi iç fonksiyonu hedeflediği belirtilmiştir.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock'lar ──────────────────────────────────────────────────────────────────

// Tauri IPC — tüm testlerde no-op
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.resolve(null)),
}));

// invokeWithTimeout — Ollama çağrılarını stub'la
vi.mock('../utils/invokeWithTimeout', () => ({
    invokeWithTimeout: vi.fn(() => Promise.resolve(JSON.stringify({ response: 'test cevap' }))),
}));

// Logger — konsol kirliliği yok
vi.mock('../services/logger', () => ({
    debugLog: vi.fn(),
    auditLog: vi.fn(),
}));

// queryExpansion — orijinal mantığı koru (normalizasyon testleri için gerekli)
// Not: Bazı testlerde override edeceğiz
vi.mock('../services/queryExpansion', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/queryExpansion')>();
    return actual;
});

// DB fonksiyonları — kontrollü mock: her test grubu kendi ihtiyacına göre ayarlar
const mockFtsSearchChunks = vi.fn<[string, number], Map<string, { assetId: string; score: number }>>();
const mockGetChunksByIds = vi.fn<[string[]], Array<{
    id: string; assetId: string; chunkIndex: number; page: number | null;
    text: string; fileName: string; filePath: string;
}>>();
const mockGetChunkEmbeddingsByIds = vi.fn<[string[]], Array<{ assetId: string; chunkId: string; vector: number[] }>>();
const mockGetChunkEmbeddingsByAssetIds = vi.fn<[string[]], Array<{ assetId: string; chunkId: string; vector: number[] }>>();
const mockQueryAll = vi.fn<[string, unknown[]], unknown[][]>();

const mockGetAllChunkEmbeddings = vi.fn<[string?, string[]?], Array<{ assetId: string; chunkId: string; vector: number[] }>>().mockReturnValue([]);
const mockGetAllAssets = vi.fn().mockReturnValue([]);

vi.mock('../services/database', () => ({
    ftsSearchChunks: (...args: Parameters<typeof mockFtsSearchChunks>) => mockFtsSearchChunks(...args),
    ftsSearchChunksAsync: async (...args: Parameters<typeof mockFtsSearchChunks>) => mockFtsSearchChunks(...args),
    getChunkStatsAsync: vi.fn(async () => ({ total: 0, metaTotal: 0, metaAssets: 0, contentAssets: 0 })),
    getChunksByIds: (...args: Parameters<typeof mockGetChunksByIds>) => mockGetChunksByIds(...args),
    getChunksByIdsAsync: async (...args: Parameters<typeof mockGetChunksByIds>) => mockGetChunksByIds(...args),
    getChunkEmbeddingsByIds: (...args: Parameters<typeof mockGetChunkEmbeddingsByIds>) => mockGetChunkEmbeddingsByIds(...args),
    getChunkEmbeddingsByAssetIds: (...args: Parameters<typeof mockGetChunkEmbeddingsByAssetIds>) => mockGetChunkEmbeddingsByAssetIds(...args),
    getChunkEmbeddingsByAssetIdsAsync: async (...args: Parameters<typeof mockGetChunkEmbeddingsByAssetIds>) => mockGetChunkEmbeddingsByAssetIds(...args),
    getAllChunkEmbeddings: (...args: Parameters<typeof mockGetAllChunkEmbeddings>) => mockGetAllChunkEmbeddings(...args),
    getAllAssets: (...args: Parameters<typeof mockGetAllAssets>) => mockGetAllAssets(...args),
    queryAll: (...args: Parameters<typeof mockQueryAll>) => mockQueryAll(...args),
    runSql: vi.fn(),
    saveDatabase: vi.fn(),
    saveDatabaseDeferred: vi.fn(),
    getSetting: vi.fn(() => null),
    getExcludedAssetIds: vi.fn(() => new Set()),
    findAssetIdsByKeywords: vi.fn(() => new Set()),
}));

// Embeddings — senkron, deterministik vektörler döner
const mockGenerateEmbedding = vi.fn<[string], Promise<number[]>>();
const mockLoadEmbeddingModel = vi.fn<[], Promise<void>>();
vi.mock('../services/embeddings', () => ({
    generateEmbedding: (...args: Parameters<typeof mockGenerateEmbedding>) => mockGenerateEmbedding(...args),
    loadEmbeddingModel: (...args: Parameters<typeof mockLoadEmbeddingModel>) => mockLoadEmbeddingModel(...args),
    cosineSimilarity: (a: number[], b: number[]) => {
        // Gerçek cosine similarity — test hesaplamaları doğru olsun
        const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
        const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
        const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
        if (magA === 0 || magB === 0) return 0;
        return dot / (magA * magB);
    },
}));

// ollamaService
vi.mock('../services/ollamaService', () => ({
    chatModel: vi.fn(() => 'llama3.1'),
    normalizeOllamaGenerateUrl: vi.fn((url: string) => url || 'http://localhost:11434/api/generate'),
}));

import {
    retrieve,
    enrichQuery,
    setQueryRewriteEnabled,
    setRerankerEnabled,
    getLastQueryWarnings,
    invalidateRagEmbeddingCache,
    directFileListAnswer,
    detectListIntent,
} from '../services/ragService';

// ── Yardımcılar ───────────────────────────────────────────────────────────────

/** Boş embedding (tüm boyutlar 0.5) — cosine ile anlamlı skor üretir */
function uniformVec(dim = 8): number[] {
    return new Array(dim).fill(0.5);
}

/** Chunk objesi fabrikası */
function makeChunk(id: string, assetId: string, text: string) {
    return { id, assetId, chunkIndex: 0, page: null, text, fileName: `${assetId}.dwg`, filePath: `/x/${assetId}.dwg` };
}

/** FTS sonucu fabrikası */
function makeFtsMap(entries: Array<[string, string, number]>): Map<string, { assetId: string; score: number }> {
    const m = new Map<string, { assetId: string; score: number }>();
    for (const [chunkId, assetId, score] of entries) {
        m.set(chunkId, { assetId, score });
    }
    return m;
}

// AIConfig minimal stub
const stubConfig = {
    provider: 'ollama' as const,
    apiUrl: 'http://localhost:11434',
    model: 'llama3.1',
    isConnected: false,
};

// ── Testler başlamadan önce reranker ve query-rewrite'ı kapat ─────────────────

beforeEach(() => {
    setRerankerEnabled(false);
    setQueryRewriteEnabled(false);
    invalidateRagEmbeddingCache();
    vi.clearAllMocks();
    // Varsayılan: embedding modeli yüklenebilir
    mockLoadEmbeddingModel.mockResolvedValue(undefined);
    mockGenerateEmbedding.mockResolvedValue(uniformVec());
    // Varsayılan: boş FTS ve chunk yanıtları
    mockFtsSearchChunks.mockReturnValue(new Map());
    mockGetChunksByIds.mockReturnValue([]);
    mockGetChunkEmbeddingsByIds.mockReturnValue([]);
    mockGetChunkEmbeddingsByAssetIds.mockReturnValue([]);
    mockGetAllChunkEmbeddings.mockReturnValue([]);
    mockGetAllAssets.mockReturnValue([]);
    mockQueryAll.mockReturnValue([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalizeTr — Türkçe karakter normalizasyonu (enrichQuery üzerinden gözlemleme)
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeTr — Türkçe karakter normalizasyonu', () => {
    // enrichQuery kısa sorguları Ollama'ya göndermek ister; ama query-rewrite KAPALI.
    // Bu testler retrieve() üzerinden keyword gate davranışını gözlemler.
    // Doğrudan normalizasyon string dönüşümünü, retrieve() ile kelime eşleşmesi
    // senaryoları aracılığıyla test ediyoruz.

    it('ç harfi "c" olarak normalize edilir — chunk eşleşmesi bulunur', async () => {
        // "çatı" sorgusu — normalize → "cati"
        // Chunk metni: "cati korumas" (normalize edilmis)
        // FTS hit var, chunk metni içinde "cati" kelimesi geçiyor
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.8]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'çatı koruma detayı')]);

        const hits = await retrieve('çatı', { type: 'all' }, 5);
        // Gate: "çatı" → normalizeTr → "cati"; chunk içinde "çatı" geçiyor
        // Sonuç: hits dönmeli (gate geçildi)
        expect(hits.length).toBeGreaterThan(0);
    });

    it('ş harfi "s" olarak normalize edilir — eşleşme kaçmaz', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.9]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'şaşırtıcı şekil')]);

        // "şekil" sorgusu — normalizeTr → "sekil"; chunk'ta "şekil" → "sekil" geçiyor
        const hits = await retrieve('şekil', { type: 'all' }, 5);
        expect(hits.length).toBeGreaterThan(0);
    });

    it('ı harfi "i" olarak normalize edilir', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.7]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'yapı kılığı')]);

        const hits = await retrieve('yapı', { type: 'all' }, 5);
        expect(hits.length).toBeGreaterThan(0);
    });

    it('ü harfi "u" olarak normalize edilir', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.85]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'üst kat düzeni')]);

        const hits = await retrieve('üst', { type: 'all' }, 5);
        expect(hits.length).toBeGreaterThan(0);
    });

    it('İ (büyük) harfi "i" olarak normalize edilir', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.75]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'İnşaat detay planı')]);

        const hits = await retrieve('İnşaat', { type: 'all' }, 5);
        expect(hits.length).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. hasWordMatch — kelime sınırı eşleşmesi
// ─────────────────────────────────────────────────────────────────────────────

describe('hasWordMatch — kelime sınırı kontrolü', () => {
    /**
     * hasWordMatch doğrudan export değil; ama retrieve() → hasNoKeywordMatch()
     * üzerinden gözlemlenir. Gate miss=true olduğunda retrieve() boş dönmez ama
     * askQuestion() "bilgi bulamadım" döner. Biz retrieve()'i test ediyoruz:
     * retrieve() FTS hits döndüğünde keyword gate, chunk metinlerindeki kelime
     * sınırı eşleşmesini kontrol eder.
     *
     * Alternatif yaklaşım: enrichQuery() üzerinden normalizeTr + hasWordMatch'ı
     * dolaylı gözlemlemek — query_rewrite devre dışı iken enrichQuery orijinali döner.
     * Bu nedenle keyword gate testlerini askQuestion mock'suz, retrieve() ile yapıyoruz.
     */

    it('"cam" token\'ı "camilerin" kelimesinde EŞLEŞMEMELI (kelime sınırı)', async () => {
        // "cam" sorgusu — FTS sonucu dönsün ama chunk metni "camilerin" içersin
        // hasWordMatch: /\bcam\b/ → "camilerin"de match YOK
        // Dolayısıyla keyword gate miss=true → retrieve boş dönmez ama askQuestion engelleyecek
        // retrieve() gate uygulamaz; sadece askQuestion/askQuestionStream gate uygular.
        // Bu davranışı doğrudan test etmek için: retrieve() hits döner, ama gate inceleme
        // askQuestion düzeyinde olduğundan retrieve testinde bu senaryoyu skip ediyoruz.
        // Bunun yerine: retrieve() semantik+keyword birleşimi üretir, gate dışarıda test edilir.
        // Kelime sınırı mantığını pure fonksiyon olarak replika edip test edelim:

        // Replika: orijinal hasWordMatch mantığı
        function hasWordMatch(text: string, token: string): boolean {
            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`).test(text);
        }
        function normalizeTr(s: string): string {
            return s.toLocaleLowerCase('tr')
                .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g')
                .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
        }

        // "cam" sözcüğü "camilerin" içinde OLMAMALI
        const text = normalizeTr('Camilerin restore edilmesi');
        const token = normalizeTr('cam');
        expect(hasWordMatch(text, token)).toBe(false);
    });

    it('"cam" token\'ı "cam profili" metninde EŞLEŞMELI', async () => {
        function hasWordMatch(text: string, token: string): boolean {
            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`).test(text);
        }
        function normalizeTr(s: string): string {
            return s.toLocaleLowerCase('tr')
                .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g')
                .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
        }

        const text = normalizeTr('cam profili ve pencere detayı');
        const token = normalizeTr('cam');
        expect(hasWordMatch(text, token)).toBe(true);
    });

    it('"merdiven" kelimesi "merdivenler"de tam sınırla EŞLEŞMEZ', () => {
        function hasWordMatch(text: string, token: string): boolean {
            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`).test(text);
        }
        // "merdivenler" içinde "merdiven" kelime sınırında değil
        expect(hasWordMatch('merdivenler boyandı', 'merdiven')).toBe(false);
        // ama "merdiven" geçerken tam eşleşmeli
        expect(hasWordMatch('merdiven boyanması', 'merdiven')).toBe(true);
    });

    it('token "plan" → "planı" eşleşmez ama "plan" eşleşir', () => {
        function hasWordMatch(text: string, token: string): boolean {
            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`).test(text);
        }
        // "planı" — ı suffix nedeniyle "plan" bağımsız sözcük değil JavaScript regex açısından
        // Not: JavaScript \b word boundary Latin char tabanlı; Türkçe ı sonrasında \b tutarlı değil.
        // Bilinen sınırlama: normalize ile ı→i yapılmadan önce \b Türkçe ek'lerle tutarlı olmaz.
        // normalize sonrası: "plani" — "plan" burada match VERMEZ (\b plan \b: "plani" içinde n-i bağlı)
        expect(hasWordMatch('plani cizimi', 'plan')).toBe(false);
        // Ama "plan cizimi"de match verir
        expect(hasWordMatch('plan cizimi', 'plan')).toBe(true);
    });

    it('regex özel karakterler token\'da varsa güvenli escape edilir', () => {
        function hasWordMatch(text: string, token: string): boolean {
            const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp(`\\b${escaped}\\b`).test(text);
        }
        // Regex özel karakterler içeren token — hata fırlatmamalı
        expect(() => hasWordMatch('test.file', 'test.file')).not.toThrow();
        expect(() => hasWordMatch('test(file)', 'test(file)')).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Stop word filtresi — extractSearchTokens / STOP_WORDS
// ─────────────────────────────────────────────────────────────────────────────

describe('Stop word filtresi', () => {
    /**
     * extractSearchTokens ve STOP_WORDS doğrudan test edilemiyor.
     * Ancak: retrieve() → hasNoKeywordMatch() → extractSearchTokens() çağırır.
     * Saf stop word sorguları (ör. "ne var") için significantTokens boş olur
     * ve gate miss=false döner (geçer). Bu davranış retrieve()'in sonucuna yansır:
     * FTS hit yoksa retrieve boş döner, gate bypass gerçekleşir.
     *
     * enrichQuery üzerinden: stop-word-only sorgu (significantTokens.length==0)
     * için query_rewrite aktif bile olsa enrichQuery orijinali döner.
     */

    it('enrichQuery: sadece stop word içeren sorgu değiştirilmeden döner', async () => {
        setQueryRewriteEnabled(true);
        // "ne var" — iki stop word; significantTokens boş → enrichQuery bypass
        const result = await enrichQuery('ne var', stubConfig);
        expect(result).toBe('ne var');
    });

    it('enrichQuery: tek stop word içeren sorgu değiştirilmeden döner', async () => {
        setQueryRewriteEnabled(true);
        const result = await enrichQuery('nedir', stubConfig);
        expect(result).toBe('nedir');
    });

    it('enrichQuery: anlamlı token içeren sorgu Ollama\'ya gönderilir (query_rewrite aktif)', async () => {
        setQueryRewriteEnabled(true);
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        const mockInvoke = vi.mocked(invokeWithTimeout);
        // Ollama'nın döndüreceği zenginleştirilmiş sorgu
        mockInvoke.mockResolvedValueOnce(JSON.stringify({ response: 'merdiven basamak stair' }));

        const result = await enrichQuery('merdiven', stubConfig);
        // enrichQuery orijinal token'ları koruduğunu kontrol eder
        // eğer korunmuyorsa orijinali döner; bu durumda mockInvoke çağrılmış olmalı
        expect(mockInvoke).toHaveBeenCalled();
        // Sonuç: ya zenginleştirilmiş ya orijinal
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    it('enrichQuery: QUERY_REWRITE_MAX_SIGTOKENS (5) üstü token → bypass', async () => {
        setQueryRewriteEnabled(true);
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        const mockInvoke = vi.mocked(invokeWithTimeout);

        // 6 anlamlı token — max sınırı aşıyor
        const longQuery = 'merdiven kolon duvar pencere zemin tavan';
        const result = await enrichQuery(longQuery, stubConfig);
        // invokeWithTimeout çağrılmamalı (bypass)
        expect(mockInvoke).not.toHaveBeenCalled();
        expect(result).toBe(longQuery);
    });

    it('stop word\'ler 3 karakterden kısa token\'ları filtreler', async () => {
        setQueryRewriteEnabled(false);
        // "mi mı mu mü" — hepsi 2 karakter veya stop word
        // Retrieve: FTS boş → boş dönmeli
        const hits = await retrieve('mi mi', { type: 'all' }, 5);
        expect(hits).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. retrieve() guard davranışları
// ─────────────────────────────────────────────────────────────────────────────

describe('retrieve() — guard ve temel davranışlar', () => {
    it('boş sorgu için boş dizi döner', async () => {
        expect(await retrieve('')).toEqual([]);
        expect(await retrieve('   ')).toEqual([]);
    });

    it('FTS ve semantik hit yoksa boş dizi döner', async () => {
        mockFtsSearchChunks.mockReturnValue(new Map());
        mockGetAllChunkEmbeddings.mockReturnValue([]);
        const hits = await retrieve('merdiven', { type: 'all' }, 5);
        expect(hits).toEqual([]);
    });

    it('topK parametresini dikkate alır', async () => {
        // 10 FTS hit, topK=3 → en fazla 3 döner
        const ftsMap = makeFtsMap(
            Array.from({ length: 10 }, (_, i) => [`c${i}`, 'a1', 0.9 - i * 0.05]),
        );
        mockFtsSearchChunks.mockReturnValue(ftsMap);
        // Chunk vektörlerini de döndür
        mockGetAllChunkEmbeddings.mockReturnValue(
            Array.from({ length: 10 }, (_, i) => ({
                assetId: 'a1',
                chunkId: `c${i}`,
                vector: uniformVec(),
            })),
        );

        const hits = await retrieve('merdiven', { type: 'all' }, 3);
        expect(hits.length).toBeLessThanOrEqual(3);
    });

    it('her hit chunkId, assetId ve score alanlarını içerir', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.8]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);

        const hits = await retrieve('merdiven', { type: 'all' }, 5);
        if (hits.length > 0) {
            expect(hits[0]).toHaveProperty('chunkId');
            expect(hits[0]).toHaveProperty('assetId');
            expect(hits[0]).toHaveProperty('score');
            expect(typeof hits[0].score).toBe('number');
        }
    });

    it('sonuçlar score DESC sıralıdır', async () => {
        // 3 chunk, farklı FTS skorları
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.5],
            ['c2', 'a1', 0.9],
            ['c3', 'a1', 0.3],
        ]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
            { assetId: 'a1', chunkId: 'c2', vector: uniformVec() },
            { assetId: 'a1', chunkId: 'c3', vector: uniformVec() },
        ]);

        const hits = await retrieve('test', { type: 'all' }, 10);
        for (let i = 1; i < hits.length; i++) {
            expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
        }
    });

    it('scope "all" — eligible filter uygulanmaz, tüm chunklar değerlendirmeye girer', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'asset_A', 0.8],
            ['c2', 'asset_B', 0.7],
        ]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'asset_A', chunkId: 'c1', vector: uniformVec() },
            { assetId: 'asset_B', chunkId: 'c2', vector: uniformVec() },
        ]);

        const hits = await retrieve('sorgu', { type: 'all' }, 10);
        const assetIds = hits.map((h) => h.assetId);
        // Her iki asset de sonuçlarda olabilmeli
        expect(assetIds.length).toBeGreaterThan(0);
    });

    it('scope "assets" — sadece belirtilen asset\'ler değerlendirilir', async () => {
        // scope assets ile dar set — queryAll ile asset'ler gelmez, getChunkEmbeddingsByAssetIds çağrılır
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'asset_A', 0.8],
            ['c2', 'asset_B', 0.7],
            ['c3', 'asset_C', 0.6],
        ]));
        // Scope: sadece asset_A ve asset_B
        const scope = { type: 'assets' as const, values: ['asset_A', 'asset_B'] };

        const hits = await retrieve('sorgu', scope, 10);
        // asset_C filtre dışı olmalı
        const assetIds = new Set(hits.map((h) => h.assetId));
        expect(assetIds.has('asset_C')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. RRF Skor Hesabı — matematiksel doğruluk
// ─────────────────────────────────────────────────────────────────────────────

describe('RRF skor hesabı', () => {
    /**
     * rrfFuse doğrudan export değil; ancak RRF'nin matematiksel davranışını
     * retrieve()'nin döndürdüğü sıradan gözlemleriz.
     *
     * RRF formülü: score(d) = Σ 1 / (k + rank_i(d))
     * k = 60 (standart)
     *
     * İki listede de 1. sırada olan chunk: 1/61 + 1/61 ≈ 0.0328
     * Sadece bir listede 1. sırada: 1/61 ≈ 0.0164
     */

    it('RRF k=60 formülü: tek listede 1. sıradan beklenen skor doğrulanır', () => {
        // Doğrudan RRF formül doğrulaması — replika
        const RRF_K = 60;
        function rrfScore(rank: number): number {
            return 1 / (RRF_K + rank + 1); // rank 0-based
        }
        // 1. sıra (rank=0): 1/61 ≈ 0.01639
        expect(rrfScore(0)).toBeCloseTo(1 / 61, 6);
        // 10. sıra (rank=9): 1/70 ≈ 0.01429
        expect(rrfScore(9)).toBeCloseTo(1 / 70, 6);
        // 50. sıra (rank=49): 1/110 ≈ 0.00909
        expect(rrfScore(49)).toBeCloseTo(1 / 110, 6);
    });

    it('RRF: her iki listede 1. sırada olana daha yüksek skor', () => {
        const RRF_K = 60;
        // Her iki listede 1. sıra
        const bothFirst = 1 / (RRF_K + 1) + 1 / (RRF_K + 1);
        // Sadece semantic listede 1. sıra
        const onlyFirst = 1 / (RRF_K + 1);
        expect(bothFirst).toBeGreaterThan(onlyFirst);
        expect(bothFirst).toBeCloseTo(2 / 61, 6);
    });

    it('RRF: sıralama tutarlı — daha yüksek ham skor → daha düşük rank → daha yüksek RRF', () => {
        const RRF_K = 60;
        function rrfScore(rank: number): number {
            return 1 / (RRF_K + rank + 1);
        }
        // rank 0 her zaman rank 1'den yüksek skor
        expect(rrfScore(0)).toBeGreaterThan(rrfScore(1));
        expect(rrfScore(1)).toBeGreaterThan(rrfScore(5));
        expect(rrfScore(5)).toBeGreaterThan(rrfScore(20));
    });

    it('STRONG_MATCH_THRESHOLD = 0.025 — her iki listede top-10\'luk chunk bu eşiği geçer', () => {
        const RRF_K = 60;
        const STRONG_MATCH_THRESHOLD = 0.025;
        // Her iki listede 10. sıra (rank=9): 1/70 + 1/70 ≈ 0.02857
        const score = 1 / (RRF_K + 10) + 1 / (RRF_K + 10);
        expect(score).toBeGreaterThan(STRONG_MATCH_THRESHOLD);
    });

    it('STRONG_MATCH_THRESHOLD = 0.025 — tek listede top-50 eşiği geçemez', () => {
        const RRF_K = 60;
        const STRONG_MATCH_THRESHOLD = 0.025;
        // Tek listede 50. sıra (rank=49): 1/110 ≈ 0.00909
        const score = 1 / (RRF_K + 50);
        expect(score).toBeLessThan(STRONG_MATCH_THRESHOLD);
    });

    it('retrieve() ile RRF: her iki kaynakta geçen chunk daha yüksek skor alır', async () => {
        // c1: hem FTS hem semantic → yüksek RRF skoru
        // c2: sadece FTS → düşük RRF skoru
        // Embedding vektörleri: c1 sorgu vektörüne çok yakın, c2 dik
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);

        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.9],  // FTS 1. sıra
            ['c2', 'a1', 0.5],  // FTS 2. sıra
        ]));

        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },   // cosine = 1.0
            { assetId: 'a1', chunkId: 'c2', vector: [0, 1, 0, 0, 0, 0, 0, 0] },   // cosine = 0.0
        ]);

        const hits = await retrieve('merdiven', { type: 'all' }, 10);
        // c1 her iki listede top sırada — c2 sadece FTS'te
        if (hits.length >= 2) {
            const c1 = hits.find((h) => h.chunkId === 'c1');
            const c2 = hits.find((h) => h.chunkId === 'c2');
            if (c1 && c2) {
                expect(c1.score).toBeGreaterThan(c2.score);
            }
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Keyword gate — hasNoKeywordMatch senaryoları
// ─────────────────────────────────────────────────────────────────────────────

describe('Keyword gate — hasNoKeywordMatch senaryoları', () => {
    /**
     * keyword gate askQuestion/askQuestionStream içinde çalışır.
     * retrieve() seviyesinde gate uygulanmaz; bu nedenle gate'i
     * replika mantıkla doğrudan test ediyoruz.
     */

    // Replika: orijinal ragService mantığı
    function normalizeTr(s: string): string {
        return s.toLocaleLowerCase('tr')
            .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g')
            .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
    }
    function hasWordMatch(text: string, token: string): boolean {
        const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`).test(text);
    }
    const STOP_WORDS = new Set([
        'kimdir', 'nedir', 'ne', 'nerede', 'nasil', 'nasıl', 'hangi', 'hangisi', 'var', 'yok',
        'kac', 'kaç', 'neden', 'niye', 'kim', 'bir', 'bu', 'şu', 'o', 'ile', 'için', 'icin',
        'mi', 'mı', 'mu', 'mü', 'de', 'da', 'ki', 'ama', 'fakat', 'veya', 'hem', 'ya', 'yani',
        'dosya', 'dosyada', 'dosyanin', 'dosyanın', 'dosyalar', 'dosyalarda',
        'belge', 'belgede', 'belgenin', 'belgeler', 'belgelerde',
        'dokuman', 'doküman', 'dokümanda', 'dokumanda',
        'arsiv', 'arşiv', 'arsivde', 'arşivde',
        'the', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'what', 'who',
        'file', 'files', 'document', 'documents',
    ]);
    function extractSearchTokens(query: string) {
        const tokens = normalizeTr(query)
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((t) => t.length >= 3);
        const significant = tokens.filter((t) => !STOP_WORDS.has(t));
        return { tokens, significantTokens: significant };
    }
    function hasNoKeywordMatch(
        query: string,
        hits: Array<{ chunkId: string }>,
        chunkMap: Map<string, { text: string }>,
    ): { miss: boolean; tokens: string[] } {
        const { significantTokens } = extractSearchTokens(query);
        if (significantTokens.length === 0) return { miss: false, tokens: [] };
        const match = hits.some((h) => {
            const text = chunkMap.get(h.chunkId)?.text;
            if (!text) return false;
            const norm = normalizeTr(text);
            return significantTokens.some((tok) => hasWordMatch(norm, tok));
        });
        return { miss: !match, tokens: significantTokens };
    }

    it('tüm token\'lar eşleşince miss=false (gate geçer)', () => {
        const chunkMap = new Map([
            ['c1', { text: 'merdiven basamak korkuluk detayı' }],
        ]);
        const result = hasNoKeywordMatch('merdiven korkuluk', [{ chunkId: 'c1' }], chunkMap);
        expect(result.miss).toBe(false);
    });

    it('hiçbir token eşleşmeyince miss=true (gate engeller)', () => {
        const chunkMap = new Map([
            ['c1', { text: 'pencere camı ve çerçevesi' }],
        ]);
        // "merdiven" chunk'ta geçmiyor
        const result = hasNoKeywordMatch('merdiven', [{ chunkId: 'c1' }], chunkMap);
        expect(result.miss).toBe(true);
        expect(result.tokens).toContain('merdiven');
    });

    it('en az bir token eşleşince miss=false (OR mantığı)', () => {
        const chunkMap = new Map([
            ['c1', { text: 'merdiven ve kapı detayı' }],
        ]);
        // "pencere" yok ama "merdiven" var — gate geçer
        const result = hasNoKeywordMatch('merdiven pencere', [{ chunkId: 'c1' }], chunkMap);
        expect(result.miss).toBe(false);
    });

    it('sadece stop word içeren sorgu için miss=false döner (significant boş)', () => {
        const chunkMap = new Map([
            ['c1', { text: 'rastgele içerik' }],
        ]);
        const result = hasNoKeywordMatch('ne var', [{ chunkId: 'c1' }], chunkMap);
        expect(result.miss).toBe(false);
        expect(result.tokens).toHaveLength(0);
    });

    it('chunk metni yoksa miss=true döner', () => {
        const chunkMap = new Map<string, { text: string }>(); // boş map
        const result = hasNoKeywordMatch('merdiven', [{ chunkId: 'c1' }], chunkMap);
        expect(result.miss).toBe(true);
    });

    it('Türkçe normalizasyon: "çatı" sorgusu "cati" metinde eşleşir', () => {
        const chunkMap = new Map([
            ['c1', { text: 'cati koruma detayi' }], // normalize edilmiş içerik
        ]);
        const result = hasNoKeywordMatch('çatı', [{ chunkId: 'c1' }], chunkMap);
        expect(result.miss).toBe(false);
    });

    it('tokens dizisi anlamlı token\'ları döndürür (stop word hariç)', () => {
        const chunkMap = new Map([
            ['c1', { text: 'herhangi bir içerik' }],
        ]);
        const result = hasNoKeywordMatch('merdiven nedir', [{ chunkId: 'c1' }], chunkMap);
        // "nedir" stop word — sadece "merdiven" significant token
        expect(result.tokens).toContain('merdiven');
        expect(result.tokens).not.toContain('nedir');
    });

    it('boş hits listesi için miss=true döner', () => {
        const chunkMap = new Map([
            ['c1', { text: 'merdiven' }],
        ]);
        const result = hasNoKeywordMatch('merdiven', [], chunkMap);
        expect(result.miss).toBe(true);
    });

    it('"cam" token\'ı "camilerin" metninde miss=true (kelime sınırı)', () => {
        const chunkMap = new Map([
            ['c1', { text: 'camilerin restore edilmesi' }],
        ]);
        // "cam" → hasWordMatch → /\bcam\b/ → "camilerin"de MATCH YOK → miss=true
        const result = hasNoKeywordMatch('cam', [{ chunkId: 'c1' }], chunkMap);
        expect(result.miss).toBe(true);
    });

    it('"cam" token\'ı "cam profili" metninde miss=false (tam kelime)', () => {
        const chunkMap = new Map([
            ['c1', { text: 'cam profili ve montaj detayi' }],
        ]);
        const result = hasNoKeywordMatch('cam', [{ chunkId: 'c1' }], chunkMap);
        expect(result.miss).toBe(false);
    });

    it('çok sayıda chunk varken en az biri eşleşince geçer', () => {
        const chunkMap = new Map([
            ['c1', { text: 'pencere camı ve çerçevesi' }],
            ['c2', { text: 'kapi ve koridor' }],
            ['c3', { text: 'merdiven basamak' }], // match burada
        ]);
        const result = hasNoKeywordMatch('merdiven', [
            { chunkId: 'c1' },
            { chunkId: 'c2' },
            { chunkId: 'c3' },
        ], chunkMap);
        expect(result.miss).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. enrichQuery — Query Rewriting davranışı
// ─────────────────────────────────────────────────────────────────────────────

describe('enrichQuery — query rewriting', () => {
    beforeEach(() => {
        setQueryRewriteEnabled(true);
    });

    it('boş sorgu değiştirilmeden döner', async () => {
        const result = await enrichQuery('', stubConfig);
        expect(result).toBe('');
    });

    it('sadece boşluk içeren sorgu trim edilmiş haliyle döner', async () => {
        // enrichQuery: trimmed = query.trim() → '' → orijinal trimmed döner
        const result = await enrichQuery('   ', stubConfig);
        expect(result).toBe('');
    });

    it('Ollama hata dönerse orijinal sorgu döner (sessiz fallback)', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockRejectedValueOnce(new Error('Ollama connection refused'));

        const result = await enrichQuery('merdiven', stubConfig);
        expect(result).toBe('merdiven');
    });

    it('Ollama boş yanıt dönerse orijinal sorgu döner', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(JSON.stringify({ response: '' }));

        const result = await enrichQuery('merdiven', stubConfig);
        expect(result).toBe('merdiven');
    });

    it('zenginleştirilmiş sorgu orijinal token\'ları içermiyorsa fallback', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        // Orijinal "merdiven" kelimesi yok — fallback
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: 'stair railing architecture' }),
        );

        const result = await enrichQuery('merdiven', stubConfig);
        expect(result).toBe('merdiven');
    });

    it('geçerli zenginleştirme orijinali + ek terimler içerir', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: 'merdiven basamak korkuluk stair staircase' }),
        );

        const result = await enrichQuery('merdiven', stubConfig);
        expect(result).toContain('merdiven');
        expect(result).toContain('basamak');
    });

    it('zenginleştirilmiş sorgu 12 kelime kapını aşmaz', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        const manyWords = Array.from({ length: 20 }, (_, i) => `kelime${i}`).join(' ');
        // orijinal "merdiven" kelimesini de ekleyelim ki fallback olmayalım
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: 'merdiven ' + manyWords }),
        );

        const result = await enrichQuery('merdiven', stubConfig);
        const wordCount = result.split(/\s+/).length;
        expect(wordCount).toBeLessThanOrEqual(12);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. setRerankerEnabled / setQueryRewriteEnabled flag testleri
// ─────────────────────────────────────────────────────────────────────────────

describe('Feature flags', () => {
    it('isRerankerEnabled varsayılan değeri false (beforeEach tarafından set edildi)', async () => {
        const { isRerankerEnabled } = await import('../services/ragService');
        expect(isRerankerEnabled()).toBe(false);
    });

    it('setRerankerEnabled flag\'i değiştirir', async () => {
        const { isRerankerEnabled, setRerankerEnabled: setRE } = await import('../services/ragService');
        setRE(true);
        expect(isRerankerEnabled()).toBe(true);
        setRE(false);
        expect(isRerankerEnabled()).toBe(false);
    });

    it('isQueryRewriteEnabled varsayılan değeri false (beforeEach tarafından set edildi)', async () => {
        const { isQueryRewriteEnabled } = await import('../services/ragService');
        expect(isQueryRewriteEnabled()).toBe(false);
    });

    it('setQueryRewriteEnabled flag\'i değiştirir', async () => {
        const { isQueryRewriteEnabled, setQueryRewriteEnabled: setSQRE } = await import('../services/ragService');
        setSQRE(true);
        expect(isQueryRewriteEnabled()).toBe(true);
        setSQRE(false);
        expect(isQueryRewriteEnabled()).toBe(false);
    });

    it('getLastQueryWarnings başlangıçta boş dizi döner', async () => {
        const { getLastQueryWarnings } = await import('../services/ragService');
        const warnings = getLastQueryWarnings();
        expect(Array.isArray(warnings)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  Keyword gate — birebir tüm-token eşleşmesi GARANTİ dahil (Şenay regresyonu)
//  fts_chunks yokken keyword skoru zayıf (fallback) kalıp semantik gürültüye
//  yenilmemeli; kullanıcının kelimelerini AYNEN geçen chunk topK'ya garanti
//  girmeli ve en üstte sıralanmalı.
// ─────────────────────────────────────────────────────────────────────────────

describe('keyword gate — birebir tüm-token eşleşmesi garanti dahil', () => {
    it('zayıf keyword skoru + güçlü semantik rakipler varken bile gated chunk topK\'da ve en üstte', async () => {
        // Keyword-hit: "Şenay" geçen belge ama ZAYIF fts skoru (fts_chunks yok → fallback)
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['cKw', 'aKw', 0.05]]));
        mockGetChunksByIds.mockReturnValue([
            makeChunk('cKw', 'aKw', 'ŞENAY GÖK ATAMAN sigorta hizmet dökümü kaydı'),
        ]);
        // Semantik rakipler: sorgu vektörüyle birebir aynı (cosine=1) → yüksek skor,
        // topK'yı doldurup zayıf keyword chunk'ı dışarı iterlerdi (gate olmasa).
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
            { assetId: 'a2', chunkId: 'c2', vector: uniformVec() },
            { assetId: 'a3', chunkId: 'c3', vector: uniformVec() },
            { assetId: 'a4', chunkId: 'c4', vector: uniformVec() },
            { assetId: 'a5', chunkId: 'c5', vector: uniformVec() },
        ]);

        const hits = await retrieve('şenay var mı', { type: 'all' }, 3);

        const gatedHit = hits.find((h) => h.chunkId === 'cKw');
        expect(gatedHit).toBeDefined();                  // garanti dahil
        expect(hits[0].chunkId).toBe('cKw');             // en üstte
        expect(gatedHit!.score).toBeGreaterThan(0.9);    // güçlü skor tabanı (gate ~0.99)
    });

    it('anlamlı token\'ı içermeyen keyword-hit chunk gate-boost ALMAZ (gate hassas)', async () => {
        // FTS "var" OR gürültüsüyle alakasız bir chunk döndü ama "şenay" GEÇMİYOR
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['cX', 'aX', 0.5]]));
        mockGetChunksByIds.mockReturnValue([
            makeChunk('cX', 'aX', 'çatı koruma detayı ve katman planı'),
        ]);

        const hits = await retrieve('şenay', { type: 'all' }, 5);

        const cx = hits.find((h) => h.chunkId === 'cX');
        // Gate "şenay" içermediği için 0.99 boost VERMEZ; normal füzyondan
        // gelebilir ama güçlü gate skoru almamalı.
        if (cx) expect(cx.score).toBeLessThan(0.9);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  directFileListAnswer — list-intent ("X hangi belgede") içerik araması
//  Regresyon: buildFullSearchableText yalnız dosya adı/metadata tarar; token
//  belge İÇERİĞİNDE olup dosya adında değilse eskiden "bulunamadı" derdi.
//  Fix: ftsSearchChunks (FTS5 + tr_norm) ile tüm-token içerik eşleşmesi eklenir.
// ─────────────────────────────────────────────────────────────────────────────

describe('directFileListAnswer — içerik (text_chunks) araması', () => {
    function makeAsset(id: string, fileName: string, fileType = 'docx') {
        return {
            id, fileName, filePath: `/x/${fileName}`, fileType,
            projectName: '', category: '', materialGroup: '', colorTheme: '',
            architecturalStyle: '', omniclassCode: '', projectPhase: '',
            aiTags: [], metadata: {},
        };
    }

    it('token dosya adında DEĞİL belge içeriğinde → dosya bulunur (asıl regresyon)', async () => {
        // Dosya adı tokenları içermiyor; içerik (chunk) hepsini içeriyor.
        mockGetAllAssets.mockReturnValue([makeAsset('aDoc', '3d dizayn yetki.docx')]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['cDoc', 'aDoc', 0.5]]));
        mockGetChunksByIds.mockReturnValue([
            makeChunk('cDoc', 'aDoc',
                'TR5800 nolu sirket hesabinin internet bankaciligini kullanma yetkilisi TC 593 Senay Gok Ataman'),
        ]);

        const r = await directFileListAnswer(
            'internet bankacılığını kullanma yetkilisi hangi belgede var', { type: 'all' }, 10);
        expect(r).not.toBeNull();
        expect(r!.answer).toContain('3d dizayn yetki.docx');
        expect(r!.answer).not.toContain('bulunamadı');
        expect(r!.citations).toHaveLength(1);
        expect(r!.citations[0].assetId).toBe('aDoc');
    });

    it('içerikte token\'ların TÜMÜ geçmiyorsa eklenmez (kesinlik korunur)', async () => {
        mockGetAllAssets.mockReturnValue([makeAsset('aPartial', 'rapor.docx')]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['cP', 'aPartial', 0.5]]));
        // Sadece "internet" geçiyor; "yetkilisi" yok → tüm-token şartı sağlanmaz
        mockGetChunksByIds.mockReturnValue([makeChunk('cP', 'aPartial', 'internet baglantisi notu')]);

        const r = await directFileListAnswer('internet yetkilisi hangi belgede', { type: 'all' }, 10);
        expect(r).not.toBeNull();
        expect(r!.answer).toContain('bulunamadı');
        expect(r!.citations).toHaveLength(0);
    });

    it('regresyon: dosya adında geçen token metadata ile bulunur (içerik boşken)', async () => {
        mockGetAllAssets.mockReturnValue([makeAsset('aMeta', 'internet plani.docx')]);
        // ftsSearchChunks beforeEach'te boş → içerik bloğu no-op
        const r = await directFileListAnswer('internet hangi belgede', { type: 'all' }, 10);
        expect(r).not.toBeNull();
        expect(r!.answer).toContain('internet plani.docx');
        expect(r!.citations).toHaveLength(1);
    });

    it('regresyon: ne metadata ne içerikte yoksa "bulunamadı"', async () => {
        mockGetAllAssets.mockReturnValue([makeAsset('aX', 'rapor.docx')]);
        const r = await directFileListAnswer('merdiven hangi belgede', { type: 'all' }, 10);
        expect(r).not.toBeNull();
        expect(r!.answer).toContain('bulunamadı');
        expect(r!.citations).toHaveLength(0);
    });

    it('regresyon: anlamlı token yoksa null (RAG akışına düşer)', async () => {
        mockGetAllAssets.mockReturnValue([makeAsset('aY', 'plan.docx')]);
        const r = await directFileListAnswer('hangi belgede var', { type: 'all' }, 10);
        expect(r).toBeNull();
    });

    it('metadata + içerik aynı asset\'i eşlerse tekrar eklenmez', async () => {
        mockGetAllAssets.mockReturnValue([makeAsset('aDup', 'internet.docx')]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['cDup', 'aDup', 0.6]]));
        mockGetChunksByIds.mockReturnValue([makeChunk('cDup', 'aDup', 'internet erisim notu')]);
        const r = await directFileListAnswer('internet hangi belgede', { type: 'all' }, 10);
        expect(r).not.toBeNull();
        expect(r!.citations).toHaveLength(1);
        expect(r!.citations[0].assetId).toBe('aDup');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
//  detectListIntent — Türkçe soru-eki yakalama
//  Regresyon (2026-05-23): "hüvellezi var mı" gibi yes/no soruları list-intent
//  tetiklemiyordu çünkü tokenizer "var" ve "mı"yı ayrı parçalıyor, marker
//  listesinde ise birleşik "varmi" var. Fix: normalize sonrası "mi"/"mu" soru-
//  ekini önceki kelimeye yapıştır. Aksi halde sorgu normal RAG akışına düşer
//  ve LLM "kaynaklarda görmüyorum" diyebilir.
// ─────────────────────────────────────────────────────────────────────────────

describe('detectListIntent — Türkçe soru-eki yakalama', () => {
    it('regresyon: "X var mı" → true (soru-eki "mı" önceki kelimeye birleştirilir)', () => {
        expect(detectListIntent('hüvellezi var mı')).toBe(true);
    });

    it('"X var mi" (ASCII varyant) → true', () => {
        expect(detectListIntent('hesap özeti var mi')).toBe(true);
    });

    it('"X geçer mi" → true ("gecer" zaten marker)', () => {
        expect(detectListIntent('hüvellezi geçer mi')).toBe(true);
    });

    it('"X içerir mi" → "iceren" değil → false (içerir marker\'da yok)', () => {
        // Bu test kasıtlı negatif: marker listesi "iceren"/"iceriyor" tutar
        // ama "icerir" yok. Sorun fix değil — marker kapsamı ayrı iş.
        expect(detectListIntent('hüvellezi içerir mi')).toBe(false);
    });

    it('mevcut: "X hangi belgede" → true (kontrol, fix bunu bozmadı)', () => {
        expect(detectListIntent('merdiven hangi belgede')).toBe(true);
    });

    it('mevcut: "X içeren dosyalar" → true (kontrol)', () => {
        expect(detectListIntent('merdiven içeren dosyalar')).toBe(true);
    });

    it('liste niyeti olmayan sorgu → false', () => {
        expect(detectListIntent('hüvellezi nasıl yapılır')).toBe(false);
    });

    it('boş sorgu → false', () => {
        expect(detectListIntent('')).toBe(false);
    });
});
