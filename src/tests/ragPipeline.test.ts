/**
 * ragService.ts — Pipeline fonksiyonları için kapsamlı testler.
 *
 * Kapsam:
 *   Group 1: retrieve() — embedding + FTS + RRF + scope + citation alanları
 *   Group 2: askQuestionStream() — streaming, onToken/onDone/onPhase, tokenStats, abort, hata
 *   Group 3: askSynthesis / askSynthesisStream() — sentez, per-asset, min-score, num_predict
 *   Group 4: generateSessionTitle() — başlık üretme, temizlik, hata fallback
 *   Group 5: buildSynthesisPrompt() — prompt yapısı
 *   Group 6: Dinamik num_ctx hesabı
 *
 * Strateji:
 *   - Tauri IPC, embeddings, database, Ollama fetch tamamen mock'lanır.
 *   - Her test beforeEach ile temiz state'e döner.
 *   - setRerankerEnabled(false) + setQueryRewriteEnabled(false) ile pipeline sadelestir.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ─── Mock'lar ─────────────────────────────────────────────────────────────────

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.resolve(null)),
}));

vi.mock('../utils/invokeWithTimeout', () => ({
    invokeWithTimeout: vi.fn(() =>
        Promise.resolve(JSON.stringify({ response: 'Mock LLM cevabı' }))
    ),
}));

vi.mock('../services/logger', () => ({
    debugLog: vi.fn(),
    auditLog: vi.fn(),
}));

vi.mock('../services/queryExpansion', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/queryExpansion')>();
    return actual;
});

// DB mock'ları
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

// Embeddings
const mockGenerateEmbedding = vi.fn<[string], Promise<number[]>>();
const mockLoadEmbeddingModel = vi.fn<[], Promise<void>>();
vi.mock('../services/embeddings', () => ({
    generateEmbedding: (...args: Parameters<typeof mockGenerateEmbedding>) => mockGenerateEmbedding(...args),
    loadEmbeddingModel: (...args: Parameters<typeof mockLoadEmbeddingModel>) => mockLoadEmbeddingModel(...args),
    cosineSimilarity: (a: number[], b: number[]) => {
        const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
        const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
        const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
        if (magA === 0 || magB === 0) return 0;
        return dot / (magA * magB);
    },
}));

vi.mock('../services/ollamaService', () => ({
    chatModel: vi.fn(() => 'llama3.1'),
    normalizeOllamaGenerateUrl: vi.fn((url: string) => url || 'http://localhost:11434/api/generate'),
    assertLocalOllamaUrl: vi.fn(), // test'te no-op — SSRF kontrolü atla
}));

// ─── Import'lar ───────────────────────────────────────────────────────────────

import {
    retrieve,
    askQuestionStream,
    askSynthesis,
    askSynthesisStream,
    generateSessionTitle,
    buildSynthesisPrompt,
    retrievePerAsset,
    setRerankerEnabled,
    setQueryRewriteEnabled,
    invalidateRagEmbeddingCache,
} from '../services/ragService';

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

const stubConfig = {
    provider: 'ollama' as const,
    apiProvider: 'ollama' as const,
    apiKey: '',
    apiUrl: 'http://localhost:11434',
    model: 'llama3.1',
    chatModel: 'llama3.1',
    isConnected: false,
};

function uniformVec(dim = 8, val = 0.5): number[] {
    return new Array(dim).fill(val);
}

function makeChunk(id: string, assetId: string, text: string, page: number | null = null) {
    return {
        id,
        assetId,
        chunkIndex: 0,
        page,
        text,
        fileName: `${assetId}.dwg`,
        filePath: `/archive/${assetId}.dwg`,
    };
}

function makeFtsMap(entries: Array<[string, string, number]>): Map<string, { assetId: string; score: number }> {
    const m = new Map<string, { assetId: string; score: number }>();
    for (const [chunkId, assetId, score] of entries) {
        m.set(chunkId, { assetId, score });
    }
    return m;
}

/**
 * Ollama streaming yanıtını simüle eden ReadableStream oluşturur.
 * Ollama NDJSON formatı: her satır bir JSON objesi.
 */
function mockOllamaStream(
    tokens: string[],
    tokenStats?: { eval_count: number; prompt_eval_count: number },
): void {
    const lines = tokens.map((t) => JSON.stringify({ response: t, done: false }));
    lines.push(
        JSON.stringify({
            response: '',
            done: true,
            eval_count: tokenStats?.eval_count ?? 10,
            prompt_eval_count: tokenStats?.prompt_eval_count ?? 50,
        }),
    );
    // Trailing newline ensures the last line isn't left in the buffer unprocessed.
    // The ragService parser does buffer.split('\n') then pops the last element into buffer;
    // a trailing '\n' means the done object is a complete line before the empty tail.
    const body = lines.join('\n') + '\n';

    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
            start(ctrl) {
                ctrl.enqueue(new TextEncoder().encode(body));
                ctrl.close();
            },
        }),
    });
}

// ─── beforeEach — her test temiz state ───────────────────────────────────────

beforeEach(() => {
    setRerankerEnabled(false);
    setQueryRewriteEnabled(false);
    invalidateRagEmbeddingCache();
    vi.clearAllMocks();

    mockLoadEmbeddingModel.mockResolvedValue(undefined);
    mockGenerateEmbedding.mockResolvedValue(uniformVec());
    mockFtsSearchChunks.mockReturnValue(new Map());
    mockGetChunksByIds.mockReturnValue([]);
    mockGetAllChunkEmbeddings.mockReturnValue([]);
    mockGetChunkEmbeddingsByAssetIds.mockReturnValue([]);
    mockGetAllChunkEmbeddings.mockReturnValue([]);
    mockGetAllAssets.mockReturnValue([]);
    mockQueryAll.mockReturnValue([]);
});

afterEach(() => {
    // global.fetch'i temizle (her test bağımsız)
    if ((global as unknown as Record<string, unknown>).fetch) {
        delete (global as unknown as Record<string, unknown>).fetch;
    }
});

// =============================================================================
// Group 1: retrieve()
// =============================================================================

describe('retrieve() — temel davranışlar', () => {
    it('boş string sorgu boş dizi döner', async () => {
        const result = await retrieve('');
        expect(result).toEqual([]);
    });

    it('sadece boşluk içeren sorgu boş dizi döner', async () => {
        const result = await retrieve('   ');
        expect(result).toEqual([]);
    });

    it('FTS ve semantik hit yoksa boş dizi döner', async () => {
        mockFtsSearchChunks.mockReturnValue(new Map());
        mockGetAllChunkEmbeddings.mockReturnValue([]);

        const result = await retrieve('merdiven', { type: 'all' }, 5);
        expect(result).toEqual([]);
    });

    it('sonuçlar score DESC sıralıdır', async () => {
        // c1: yüksek semantik + FTS skoru → daha yüksek RRF
        // c2: sadece FTS'te, düşük sıra
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);

        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.9],
            ['c2', 'a1', 0.5],
            ['c3', 'a1', 0.3],
        ]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
            { assetId: 'a1', chunkId: 'c2', vector: [0.8, 0, 0, 0, 0, 0, 0, 0] },
            { assetId: 'a1', chunkId: 'c3', vector: [0.1, 0, 0, 0, 0, 0, 0, 0] },
        ]);

        const hits = await retrieve('merdiven', { type: 'all' }, 10);
        expect(hits.length).toBeGreaterThan(1);
        for (let i = 1; i < hits.length; i++) {
            expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
        }
    });

    it('topK parametresi sonuç sayısını sınırlar', async () => {
        const ftsMap = makeFtsMap(
            Array.from({ length: 10 }, (_, i) => [`c${i}`, 'a1', 0.9 - i * 0.05]),
        );
        mockFtsSearchChunks.mockReturnValue(ftsMap);
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

    it('her hit objesi chunkId, assetId, score alanlarını içerir', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.8]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);

        const hits = await retrieve('merdiven', { type: 'all' }, 5);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0]).toHaveProperty('chunkId');
        expect(hits[0]).toHaveProperty('assetId');
        expect(hits[0]).toHaveProperty('score');
        expect(typeof hits[0].score).toBe('number');
    });

    it('RRF fusion: her iki listede olan chunk daha yüksek skor alır', async () => {
        // c1 hem FTS hem semantikte yüksek → daha büyük RRF
        // c2 sadece FTS'te
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);

        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.9],
            ['c2', 'a1', 0.8],
        ]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },  // cosine=1
            { assetId: 'a1', chunkId: 'c2', vector: [0, 1, 0, 0, 0, 0, 0, 0] },  // cosine=0
        ]);

        const hits = await retrieve('merdiven', { type: 'all' }, 10);
        // c2 semantik listede yok (cosine=0, eşik 0.1 altında kalır)
        // c1 her iki listede → daha yüksek RRF skoru
        const c1 = hits.find((h) => h.chunkId === 'c1');
        const c2 = hits.find((h) => h.chunkId === 'c2');
        if (c1 && c2) {
            expect(c1.score).toBeGreaterThan(c2.score);
        }
    });

    it('scope "assets" filtresi dışındaki asset\'leri dışlar', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'asset_A', 0.8],
            ['c2', 'asset_B', 0.7],
            ['c3', 'asset_C', 0.6],  // scope dışı
        ]));

        const scope = { type: 'assets' as const, values: ['asset_A', 'asset_B'] };
        const hits = await retrieve('sorgu', scope, 10);

        const assetIds = new Set(hits.map((h) => h.assetId));
        expect(assetIds.has('asset_C')).toBe(false);
    });

    it('scope "all" — tüm asset\'ler değerlendirmeye girer', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'assetX', 0.8],
            ['c2', 'assetY', 0.7],
        ]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'assetX', chunkId: 'c1', vector: uniformVec() },
            { assetId: 'assetY', chunkId: 'c2', vector: uniformVec() },
        ]);

        const hits = await retrieve('sorgu', { type: 'all' }, 10);
        const assetIds = new Set(hits.map((h) => h.assetId));
        expect(assetIds.size).toBeGreaterThan(0);
    });

    it('sadece FTS sonucu varsa (semantik boş) — FTS\'ten döner', async () => {
        // Embedding vektörü döndürme ama cosine < 0.1 olacak şekilde
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.9]]));
        mockGetAllChunkEmbeddings.mockReturnValue([]); // semantik boş

        const hits = await retrieve('merdiven', { type: 'all' }, 5);
        // FTS hit var → RRF'e girer → sonuç döner
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].chunkId).toBe('c1');
    });

    it('sadece semantik sonuç varsa (FTS boş) — semantik\'ten döner', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);

        // FTS boş — ama cache'de embedding mevcut (semantik)
        mockFtsSearchChunks.mockReturnValue(new Map());
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);

        const scope = { type: 'assets' as const, values: ['a1'] };
        const hits = await retrieve('test', scope, 5);
        // cosine([1,0,...],[1,0,...]) = 1.0 > 0.1 → semantik listeye girer
        expect(hits.length).toBeGreaterThan(0);
    });

    it('minScore parametresi kabul edilir (sıfır ile tüm sonuçlar dahil)', async () => {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.001],
            ['c2', 'a1', 0.5],
        ]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
            { assetId: 'a1', chunkId: 'c2', vector: uniformVec() },
        ]);

        const hits = await retrieve('test', { type: 'all' }, 10, 0);
        // RRF her ikisini de dahil eder (min_score=0, pre-filter yok)
        expect(hits.length).toBeGreaterThan(0);
    });
});

// =============================================================================
// Group 2: askQuestionStream()
// =============================================================================

describe('askQuestionStream() — streaming pipeline', () => {
    // Keyword gate geçebilmek için her chunk'ta sorgu kelimesi geçmeli
    function setupHit(chunkText: string = 'merdiven basamak detayı') {
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.8]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', chunkText)]);
    }

    it('onPhase "searching" ardından "generating" çağrılır', async () => {
        setupHit();
        mockOllamaStream(['Merdiven ', 'bulundu.']);

        const phases: string[] = [];
        await askQuestionStream(
            'merdiven',
            stubConfig,
            {
                onToken: vi.fn(),
                onPhase: (p) => phases.push(p),
            },
        );

        expect(phases[0]).toBe('searching');
        expect(phases).toContain('generating');
    });

    it('onToken her token için delta ile çağrılır', async () => {
        setupHit();
        const tokens = ['Merdiven ', 'sistemi ', 'detayı.'];
        mockOllamaStream(tokens);

        const received: string[] = [];
        await askQuestionStream(
            'merdiven',
            stubConfig,
            { onToken: (t) => received.push(t) },
        );

        // En azından bir token gelmeli (done öncesi token'lar)
        expect(received.length).toBeGreaterThan(0);
    });

    it('onDone stream bitişinde tam cevapla çağrılır', async () => {
        setupHit();
        const tokens = ['Cevap ', 'burada.'];
        mockOllamaStream(tokens);

        let doneAnswer = '';
        await askQuestionStream(
            'merdiven',
            stubConfig,
            {
                onToken: vi.fn(),
                onDone: (ans) => { doneAnswer = ans; },
            },
        );

        expect(doneAnswer).toBe('Cevap burada.');
    });

    it('tokenStats eval_count ve prompt_eval_count doldurulur', async () => {
        setupHit();
        mockOllamaStream(['cevap'], { eval_count: 42, prompt_eval_count: 100 });

        let stats: unknown = null;
        await askQuestionStream(
            'merdiven',
            stubConfig,
            {
                onToken: vi.fn(),
                onDone: (_ans, s) => { stats = s; },
            },
        );

        expect(stats).toMatchObject({ tokensIn: 100, tokensOut: 42 });
    });

    it('retrieve boşsa hallucination gate mesajı onToken\'a gönderilir', async () => {
        // FTS ve embedding boş → retrieve [] döner
        mockFtsSearchChunks.mockReturnValue(new Map());
        mockGetAllChunkEmbeddings.mockReturnValue([]);

        const tokens: string[] = [];
        await askQuestionStream(
            'bilinmeyen_terim_xyz',
            stubConfig,
            { onToken: (t) => tokens.push(t) },
        );

        const full = tokens.join('');
        expect(full).toContain('bilgi bulamadım');
    });

    it('citations dönen sonuçta fileName, filePath, score alanlarını içerir', async () => {
        setupHit('merdiven detayı');
        mockOllamaStream(['cevap']);

        const result = await askQuestionStream(
            'merdiven',
            stubConfig,
            { onToken: vi.fn() },
        );

        expect(result.citations.length).toBeGreaterThan(0);
        const cit = result.citations[0];
        expect(cit).toHaveProperty('fileName');
        expect(cit).toHaveProperty('filePath');
        expect(cit).toHaveProperty('score');
        expect(cit).toHaveProperty('snippet');
        expect(cit).toHaveProperty('index');
    });

    it('Ollama bağlantı hatası onError callback\'ini çağırır ve hata fırlatır', async () => {
        setupHit();
        global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));

        const errors: string[] = [];
        await expect(
            askQuestionStream(
                'merdiven',
                stubConfig,
                {
                    onToken: vi.fn(),
                    onError: (e) => errors.push(e),
                },
            )
        ).rejects.toThrow();

        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]).toContain('ulaşılamadı');
    });

    it('Ollama HTTP 500 hatası onError callback\'ini çağırır', async () => {
        setupHit();
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            text: () => Promise.resolve('model not found'),
        });

        const errors: string[] = [];
        await expect(
            askQuestionStream(
                'merdiven',
                stubConfig,
                {
                    onToken: vi.fn(),
                    onError: (e) => errors.push(e),
                },
            )
        ).rejects.toThrow();
    });

    it('AbortSignal ile iptal edildiğinde hata fırlatmaz — citation ve model döner', async () => {
        setupHit();
        const controller = new AbortController();

        // Fetch henüz tamamlanmadan abort et
        global.fetch = vi.fn().mockImplementation(() => {
            controller.abort();
            return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });

        // abortSignal.aborted=true → hata yerine graceful dönüş
        const result = await askQuestionStream(
            'merdiven',
            stubConfig,
            { onToken: vi.fn() },
            {},
            { type: 'all' },
            [],
            controller.signal,
        );

        // Abort edildiğinde hata fırlatılmaz, results döner
        expect(result).toHaveProperty('citations');
        expect(result).toHaveProperty('model');
    });

    it('geçmiş (history) parametresi kabul edilir — hata yok', async () => {
        setupHit();
        mockOllamaStream(['cevap']);

        const history = [
            { role: 'user', content: 'Önceki soru' },
            { role: 'assistant', content: 'Önceki cevap' },
        ];

        await expect(
            askQuestionStream(
                'merdiven',
                stubConfig,
                { onToken: vi.fn() },
                {},
                { type: 'all' },
                history,
            )
        ).resolves.toBeDefined();
    });

    it('retrievedChunks sayısı dönen sonuçta doğru', async () => {
        setupHit();
        mockOllamaStream(['cevap']);

        const result = await askQuestionStream(
            'merdiven',
            stubConfig,
            { onToken: vi.fn() },
        );

        expect(result.retrievedChunks).toBeGreaterThan(0);
    });
});

// =============================================================================
// Group 3: askSynthesis / askSynthesisStream()
// =============================================================================

describe('askSynthesis() — çoklu belge sentezi (non-stream)', () => {
    it('assetIds boş olduğunda hata mesajı döner', async () => {
        const result = await askSynthesis('ne var?', [], stubConfig);
        expect(result.answer).toContain('en az 1 belge');
        expect(result.citations).toEqual([]);
        expect(result.retrievedChunks).toBe(0);
    });

    it('ilgili chunk bulunamazsa "bilgi bulunamadı" mesajı döner', async () => {
        // retrievePerAsset: embeddings boş → [] döner
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([]);
        mockFtsSearchChunks.mockReturnValue(new Map());

        const result = await askSynthesis('bilinmeyen', ['asset1'], stubConfig);
        expect(result.answer).toContain('bilgi bulunamadı');
        expect(result.retrievedChunks).toBe(0);
    });

    it('tek asset ile çalışır — citations dolu döner', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.9]]));
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'merdiven detayı')]);

        const { invokeWithTimeout: iWT } = await import('../utils/invokeWithTimeout');
        const mockInvoke = vi.mocked(iWT);
        mockInvoke.mockResolvedValueOnce(JSON.stringify({ response: 'Sentez cevabı' }));

        const result = await askSynthesis('merdiven', ['a1'], stubConfig);
        expect(result.answer).toBe('Sentez cevabı');
        expect(result.citations.length).toBeGreaterThan(0);
    });

    it('num_predict 700 — non-stream proxy çağrısında kısa cevap limiti geçirilir', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.9]]));
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'merdiven detayı')]);

        const { invokeWithTimeout: iWT } = await import('../utils/invokeWithTimeout');
        const mockInvoke = vi.mocked(iWT);
        mockInvoke.mockResolvedValueOnce(JSON.stringify({ response: 'Sentez' }));

        await askSynthesis('merdiven', ['a1'], stubConfig);

        expect(mockInvoke).toHaveBeenCalled();
        const callArgs = mockInvoke.mock.calls[0];
        const bodyArg = JSON.parse((callArgs[1] as { body: string }).body);
        expect(bodyArg.options.num_predict).toBe(700);
    });

    it('multiple asset per-asset RRF — her asset kendi chunk\'larına sahip', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
            { assetId: 'a2', chunkId: 'c2', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.9],
            ['c2', 'a2', 0.8],
        ]));
        mockGetChunksByIds.mockReturnValue([
            makeChunk('c1', 'a1', 'a1 merdiven'),
            makeChunk('c2', 'a2', 'a2 merdiven'),
        ]);

        const { invokeWithTimeout: iWT } = await import('../utils/invokeWithTimeout');
        const mockInvoke = vi.mocked(iWT);
        mockInvoke.mockResolvedValueOnce(JSON.stringify({ response: 'Çoklu sentez' }));

        const result = await askSynthesis('merdiven', ['a1', 'a2'], stubConfig);
        // Her iki asset'ten citation gelmeli
        const assetIds = new Set(result.citations.map((c) => c.assetId));
        expect(assetIds.size).toBe(2);
    });

    it('SYNTHESIS_MIN_SCORE altındaki asset\'ler atlanır', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);

        // a2 nin semantic skoru çok düşük → cosine < 0.1 → semantik listeye girmez
        // FTS skoru da yok → rrfFuse sıfır → SYNTHESIS_MIN_SCORE 0.012 altında → atlanır
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
            // a2: cosine = 0 (dik vektör) → score 0 → atlanır
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.9],
            // a2: FTS'te de yok
        ]));
        mockGetChunksByIds.mockReturnValue([
            makeChunk('c1', 'a1', 'a1 merdiven'),
        ]);

        const { invokeWithTimeout: iWT } = await import('../utils/invokeWithTimeout');
        const mockInvoke = vi.mocked(iWT);
        mockInvoke.mockResolvedValueOnce(JSON.stringify({ response: 'Sentez' }));

        const result = await askSynthesis('merdiven', ['a1', 'a2'], stubConfig);
        // a2 için chunk yok → citationlarda sadece a1
        const assetIds = new Set(result.citations.map((c) => c.assetId));
        expect(assetIds.has('a2')).toBe(false);
    });

    it('Ollama proxy hatası throw eder', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.9]]));
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'merdiven detayı')]);

        const { invokeWithTimeout: iWT } = await import('../utils/invokeWithTimeout');
        const mockInvoke = vi.mocked(iWT);
        mockInvoke.mockRejectedValueOnce(new Error('connection refused'));

        await expect(askSynthesis('merdiven', ['a1'], stubConfig)).rejects.toThrow('ulaşılamadı');
    });
});

describe('askSynthesisStream() — streaming sentez', () => {
    it('assetIds boş olduğunda "en az 1 belge" mesajı onToken\'a gönderilir', async () => {
        const tokens: string[] = [];
        await askSynthesisStream(
            'sorgu',
            [],
            stubConfig,
            { onToken: (t) => tokens.push(t) },
        );
        expect(tokens.join('')).toContain('en az 1 belge');
    });

    it('hit yoksa "bilgi bulunamadı" onToken\'a gönderilir', async () => {
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([]);
        mockFtsSearchChunks.mockReturnValue(new Map());

        const tokens: string[] = [];
        await askSynthesisStream(
            'bilinmeyen',
            ['a1'],
            stubConfig,
            { onToken: (t) => tokens.push(t) },
        );
        expect(tokens.join('')).toContain('bilgi bulunamadı');
    });

    it('streaming token\'lar onToken callback\'ine iletilir', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.9]]));
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'merdiven detayı')]);

        mockOllamaStream(['Sentez ', 'cevabı.']);

        const received: string[] = [];
        const result = await askSynthesisStream(
            'merdiven',
            ['a1'],
            stubConfig,
            { onToken: (t) => received.push(t) },
        );

        expect(received.length).toBeGreaterThan(0);
        expect(result.citations.length).toBeGreaterThan(0);
        expect(result.retrievedChunks).toBeGreaterThan(0);
    });

    it('tokenStats eval_count ve prompt_eval_count doğru doldurulur', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.9]]));
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'merdiven')]);

        mockOllamaStream(['cevap'], { eval_count: 77, prompt_eval_count: 200 });

        let stats: unknown = null;
        await askSynthesisStream(
            'merdiven',
            ['a1'],
            stubConfig,
            {
                onToken: vi.fn(),
                onDone: (_ans, s) => { stats = s; },
            },
        );

        expect(stats).toMatchObject({ tokensIn: 200, tokensOut: 77 });
    });

    it('num_predict 700 — stream body\'de kısa cevap limiti gönderilir', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.9]]));
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', 'merdiven')]);

        const fetchCalls: Request[] = [];
        global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
            fetchCalls.push(init as unknown as Request);
            const body = JSON.parse(init.body as string);
            // num_predict kontrolü için body'yi kaydet
            (global as unknown as Record<string, unknown>).__lastFetchBody = body;
            // minimal stream yanıtı
            const streamBody = JSON.stringify({ response: 'ok', done: false }) + '\n'
                + JSON.stringify({ response: '', done: true, eval_count: 1, prompt_eval_count: 1 });
            return Promise.resolve({
                ok: true,
                body: new ReadableStream({
                    start(ctrl) {
                        ctrl.enqueue(new TextEncoder().encode(streamBody));
                        ctrl.close();
                    },
                }),
            });
        });

        await askSynthesisStream(
            'merdiven',
            ['a1'],
            stubConfig,
            { onToken: vi.fn() },
        );

        const lastBody = (global as unknown as Record<string, unknown>).__lastFetchBody as { options: { num_predict: number } };
        expect(lastBody?.options?.num_predict).toBe(700);
    });
});

// =============================================================================
// Group 4: generateSessionTitle()
// =============================================================================

describe('generateSessionTitle()', () => {
    it('LLM cevabından temiz başlık döner', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: 'Merdiven Detayları' }),
        );

        const title = await generateSessionTitle('merdiven nedir', 'Merdiven bilgisi var', stubConfig);
        expect(title).toBe('Merdiven Detayları');
    });

    it('LLM boş yanıt dönerse null döner', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: '' }),
        );

        const title = await generateSessionTitle('soru', 'cevap', stubConfig);
        expect(title).toBeNull();
    });

    it('LLM hata fırlatırsa null döner (sessiz fallback)', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockRejectedValueOnce(new Error('timeout'));

        const title = await generateSessionTitle('soru', 'cevap', stubConfig);
        expect(title).toBeNull();
    });

    it('başlıktan tırnak işaretleri temizlenir', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: '"Zemin Kat Planı"' }),
        );

        const title = await generateSessionTitle('zemin kat', 'plan bilgisi', stubConfig);
        expect(title).not.toContain('"');
    });

    it('60 karakterden uzun başlık kesilir ve … eklenir', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        const longTitle = 'Bu çok uzun bir başlık metni olup altmış karakterden fazlasını içermektedir gerçekten';
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: longTitle }),
        );

        const title = await generateSessionTitle('soru', 'cevap', stubConfig);
        // Null değilse uzunluk kontrolü
        if (title !== null) {
            expect(title.length).toBeLessThanOrEqual(63); // 60 + '…' (3 bytes UTF-8)
            expect(title.endsWith('…')).toBe(true);
        }
    });

    it('<think> blokları başlıktan temizlenir', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: '<think>Düşünüyorum...</think>Merdiven Analizi' }),
        );

        const title = await generateSessionTitle('merdiven', 'cevap', stubConfig);
        expect(title).toBe('Merdiven Analizi');
    });

    it('"BAŞLIK:" ön eki temizlenir', async () => {
        const { invokeWithTimeout } = await import('../utils/invokeWithTimeout');
        vi.mocked(invokeWithTimeout).mockResolvedValueOnce(
            JSON.stringify({ response: 'BAŞLIK: Yapı Analizi' }),
        );

        const title = await generateSessionTitle('yapı', 'cevap', stubConfig);
        expect(title).toBe('Yapı Analizi');
    });
});

// =============================================================================
// Group 5: buildSynthesisPrompt()
// =============================================================================

describe('buildSynthesisPrompt() — prompt yapısı', () => {
    it('belge adlarını BELGE N — başlığıyla içerir', () => {
        const prompt = buildSynthesisPrompt(
            'merdiven nedir',
            [
                {
                    assetId: 'a1',
                    fileName: 'plan.dwg',
                    chunks: [{ index: 1, page: null, text: 'merdiven basamak' }],
                },
            ],
        );

        expect(prompt).toContain('BELGE 1');
        expect(prompt).toContain('plan.dwg');
    });

    it('çoklu belge için ayrı BELGE bölümleri içerir', () => {
        const prompt = buildSynthesisPrompt(
            'karşılaştır',
            [
                { assetId: 'a1', fileName: 'dosya1.dwg', chunks: [{ index: 1, page: null, text: 'metin1' }] },
                { assetId: 'a2', fileName: 'dosya2.dwg', chunks: [{ index: 2, page: null, text: 'metin2' }] },
            ],
        );

        expect(prompt).toContain('BELGE 1');
        expect(prompt).toContain('BELGE 2');
        expect(prompt).toContain('dosya1.dwg');
        expect(prompt).toContain('dosya2.dwg');
    });

    it('sayfa numarası varsa (s.N) formatında gösterilir', () => {
        const prompt = buildSynthesisPrompt(
            'soru',
            [
                { assetId: 'a1', fileName: 'rapor.pdf', chunks: [{ index: 1, page: 5, text: 'içerik' }] },
            ],
        );

        expect(prompt).toContain('s.5');
    });

    it('konuşma geçmişi prompt\'a eklenir (son 4 mesaj)', () => {
        const history = [
            { role: 'user', content: 'Önceki soru 1' },
            { role: 'assistant', content: 'Önceki cevap 1' },
        ];

        const prompt = buildSynthesisPrompt(
            'yeni soru',
            [{ assetId: 'a1', fileName: 'f.dwg', chunks: [{ index: 1, page: null, text: 'metin' }] }],
            history,
        );

        expect(prompt).toContain('Önceki soru 1');
    });

    it('sorgu prompt\'a SORU: başlığıyla eklenir', () => {
        const prompt = buildSynthesisPrompt(
            'test sorusu',
            [{ assetId: 'a1', fileName: 'f.dwg', chunks: [{ index: 1, page: null, text: 'metin' }] }],
        );

        expect(prompt).toContain('SORU: test sorusu');
    });

    it('/no_think direktifi ile başlar', () => {
        const prompt = buildSynthesisPrompt(
            'soru',
            [{ assetId: 'a1', fileName: 'f.dwg', chunks: [{ index: 1, page: null, text: 'metin' }] }],
        );

        expect(prompt.trim().startsWith('/no_think')).toBe(true);
    });

    it('chunk index [N] formatında gösterilir', () => {
        const prompt = buildSynthesisPrompt(
            'soru',
            [
                { assetId: 'a1', fileName: 'f.dwg', chunks: [{ index: 3, page: null, text: 'metin' }] },
            ],
        );

        expect(prompt).toContain('[3]');
    });
});

// =============================================================================
// Group 6: Dinamik num_ctx hesabı
// =============================================================================

describe('Dinamik num_ctx hesabı (askQuestionStream üzerinden)', () => {
    // askQuestionStream'in fetch çağrısındaki num_ctx'i kontrol ederiz.
    // Prompt uzunluğuna göre: numCtx = max(4096, min(16384, estimatedTokens * 2))
    // estimatedTokens = ceil(prompt.length / 4)
    //
    // Keyword gate bypass: chunk metni sorgu kelimesi ('merdiven') içermeli.
    // Ek padding 'x' karakteriyle prompt uzunluğunu kontrol ederiz.

    async function getNumCtxFromStream(extraPadding: number = 0): Promise<number> {
        // Chunk: 'merdiven ' + padding — gate geçer (query token chunk'ta mevcut)
        const chunkText = 'merdiven ' + 'x'.repeat(extraPadding);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([['c1', 'a1', 0.8]]));
        mockGetAllChunkEmbeddings.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
        ]);
        mockGetChunksByIds.mockReturnValue([makeChunk('c1', 'a1', chunkText)]);

        let capturedBody: { options: { num_ctx: number } } | null = null;
        global.fetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
            capturedBody = JSON.parse(init.body as string);
            const streamData = JSON.stringify({ response: '', done: true, eval_count: 1, prompt_eval_count: 1 }) + '\n';
            return Promise.resolve({
                ok: true,
                body: new ReadableStream({
                    start(ctrl) {
                        ctrl.enqueue(new TextEncoder().encode(streamData));
                        ctrl.close();
                    },
                }),
            });
        });

        await askQuestionStream('merdiven', stubConfig, { onToken: vi.fn() });

        return capturedBody?.options?.num_ctx ?? -1;
    }

    it('çok kısa prompt → num_ctx = 4096 (minimum)', async () => {
        // chunk kısa → prompt kısa → estimatedTokens * 2 < 4096 → clamp to min
        const numCtx = await getNumCtxFromStream(0);
        expect(numCtx).toBe(4096);
    });

    it('çok uzun prompt → num_ctx = 16384 (maksimum)', async () => {
        // Prompt uzunluğu > 16384*4/2 = 32768 karakter → clamp to max
        // Chunk + prompt template ≈ 40000 chars when padding = 37000
        const numCtx = await getNumCtxFromStream(37_000);
        expect(numCtx).toBe(16384);
    });

    it('orta uzunluk → 4096 ile 16384 arasında', async () => {
        // padding = 10000 → chunk ~10009 chars → prompt ~10900 → est ~2725 → numCtx=5450
        const numCtx = await getNumCtxFromStream(10_000);
        expect(numCtx).toBeGreaterThanOrEqual(4096);
        expect(numCtx).toBeLessThanOrEqual(16384);
    });
});

// =============================================================================
// Group 7: retrievePerAsset()
// =============================================================================

describe('retrievePerAsset() — per-asset retrieval', () => {
    it('boş sorgu boş dizi döner', async () => {
        const result = await retrievePerAsset('', ['a1'], 3);
        expect(result).toEqual([]);
    });

    it('boş assetIds boş dizi döner', async () => {
        const result = await retrievePerAsset('merdiven', [], 3);
        expect(result).toEqual([]);
    });

    it('embedding boşsa boş dizi döner', async () => {
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([]);
        const result = await retrievePerAsset('merdiven', ['a1'], 3);
        expect(result).toEqual([]);
    });

    it('her asset kendi chunkId\'leriyle ayrı RRF yapar', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
            { assetId: 'a1', chunkId: 'c2', vector: [0.9, 0, 0, 0, 0, 0, 0, 0] },
            { assetId: 'a2', chunkId: 'c3', vector: [1, 0, 0, 0, 0, 0, 0, 0] },
        ]);
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.9],
            ['c2', 'a1', 0.7],
            ['c3', 'a2', 0.8],
        ]));

        const result = await retrievePerAsset('merdiven', ['a1', 'a2'], 2);

        // Her iki asset'ten chunk gelmeli
        const assetIds = new Set(result.map((r) => r.assetId));
        expect(assetIds.has('a1')).toBe(true);
        expect(assetIds.has('a2')).toBe(true);
    });

    it('topPerAsset sınırı her asset için ayrı uygulanır', async () => {
        const queryVec = [1, 0, 0, 0, 0, 0, 0, 0];
        mockGenerateEmbedding.mockResolvedValue(queryVec);
        // a1 için 5 chunk
        const a1Chunks = Array.from({ length: 5 }, (_, i) => ({
            assetId: 'a1',
            chunkId: `c${i}`,
            vector: [1, 0, 0, 0, 0, 0, 0, 0] as number[],
        }));
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue(a1Chunks);
        mockFtsSearchChunks.mockReturnValue(
            makeFtsMap(a1Chunks.map((c, i) => [c.chunkId, 'a1', 0.9 - i * 0.1])),
        );

        const result = await retrievePerAsset('merdiven', ['a1'], 2);
        // a1'den en fazla 2 chunk gelmeli
        const a1Results = result.filter((r) => r.assetId === 'a1');
        expect(a1Results.length).toBeLessThanOrEqual(2);
    });
});
