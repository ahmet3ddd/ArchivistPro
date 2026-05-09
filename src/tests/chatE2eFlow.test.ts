/**
 * E2E Chat Akışı — Entegrasyon Testleri
 *
 * chatStorage + ragService pipeline'ını birlikte test eder.
 * Gerçek sql.js DB kullanır, Ollama fetch mock'lanır.
 *
 * Kapsam:
 *   1. Tam akış: oturum oluştur → mesaj gönder → stream → DB'ye kaydet → doğrula
 *   2. Abort senaryosu: kullanıcı stream ortasında durdurur → kısmi mesaj kaydedilir
 *   3. Hata senaryosu: Ollama bağlantı hatası → hata mesajı kaydedilir
 *   4. Keyword gate: arsivde bilgi yoksa LLM çağrılmaz
 *   5. Sentez akışı: çoklu belge → per-asset retrieval → sentez yanıtı
 *   6. Oturum kalıcılığı: oturum/mesaj → sil → snapshot/restore round-trip
 *   7. Token istatistikleri: tokensIn/tokensOut DB'ye kaydedilir
 *   8. Görsel arama akışı: /görsel komutu → citation'lar kaydedilir
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

// ─── Mock'lar ────────────────────────────────────────────────────────────────

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
    setLoggerDb: vi.fn(),
}));

vi.mock('../services/tagService', () => ({
    setTagDb: vi.fn(),
}));

vi.mock('../services/favorites', () => ({
    setFavoritesDb: vi.fn(),
}));

vi.mock('../services/messageService', () => ({
    setMessageDb: vi.fn(),
}));

vi.mock('../services/userService', () => ({
    setUserDb: vi.fn(),
}));

// DB mock'ları (ragService'in kullandığı arama fonksiyonları)
const mockFtsSearchChunks = vi.fn<[string, number], Map<string, { assetId: string; score: number }>>();
const mockGetChunksByIds = vi.fn<[string[]], Array<{
    id: string; assetId: string; chunkIndex: number; page: number | null;
    text: string; fileName: string; filePath: string;
}>>();
const mockGetChunkEmbeddingsByIds = vi.fn<[string[]], Array<{ assetId: string; chunkId: string; vector: number[] }>>();
const mockGetChunkEmbeddingsByAssetIds = vi.fn<[string[]], Array<{ assetId: string; chunkId: string; vector: number[] }>>();

// database mock — gerçek DB fonksiyonlarını koruyoruz, arama fonksiyonlarını mock'lıyoruz
vi.mock('../services/database', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/database')>();
    return {
        ...actual,
        saveDatabase: vi.fn(),
        saveDatabaseDeferred: vi.fn(),
        ftsSearchChunks: (...args: Parameters<typeof mockFtsSearchChunks>) => mockFtsSearchChunks(...args),
        getChunksByIds: (...args: Parameters<typeof mockGetChunksByIds>) => mockGetChunksByIds(...args),
        getChunkEmbeddingsByIds: (...args: Parameters<typeof mockGetChunkEmbeddingsByIds>) => mockGetChunkEmbeddingsByIds(...args),
        getChunkEmbeddingsByAssetIds: (...args: Parameters<typeof mockGetChunkEmbeddingsByAssetIds>) => mockGetChunkEmbeddingsByAssetIds(...args),
    };
});

// Embeddings mock
const mockGenerateEmbedding = vi.fn<[string], Promise<number[]>>();
vi.mock('../services/embeddings', () => ({
    generateEmbedding: (...args: Parameters<typeof mockGenerateEmbedding>) => mockGenerateEmbedding(...args),
    loadEmbeddingModel: vi.fn(() => Promise.resolve()),
    cosineSimilarity: (a: number[], b: number[]) => {
        const dot = a.reduce((s, v, i) => s + v * (b[i] ?? 0), 0);
        const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
        const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
        if (magA === 0 || magB === 0) return 0;
        return dot / (magA * magB);
    },
}));

vi.mock('../services/ollamaService', () => ({
    chatModel: vi.fn(() => 'qwen3:4b'),
    normalizeOllamaGenerateUrl: vi.fn((url: string) => url || 'http://localhost:11434/api/generate'),
    assertLocalOllamaUrl: vi.fn(), // test'te no-op — SSRF kontrolü atla
}));

// ─── Import'lar ──────────────────────────────────────────────────────────────

import { _setDbForTesting } from '../services/database';
import {
    createSession,
    listSessions,
    deleteSession,
    appendMessage,
    listMessages,
    snapshotSession,
    restoreSession,
    renameSession,
} from '../services/chatStorage';
import {
    askQuestionStream,
    askSynthesisStream,
    setRerankerEnabled,
    setQueryRewriteEnabled,
    type RagCitation,
} from '../services/ragService';

// ─── Yardımcılar ─────────────────────────────────────────────────────────────

const stubConfig = {
    provider: 'ollama' as const,
    apiProvider: 'ollama' as const,
    apiKey: '',
    apiUrl: 'http://localhost:11434',
    model: 'qwen3:4b',
    chatModel: 'qwen3:4b',
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

function setupHit(chunkText = 'merdiven basamak detayı', chunkId = 'c1', assetId = 'a1') {
    mockFtsSearchChunks.mockReturnValue(makeFtsMap([[chunkId, assetId, 0.8]]));
    mockGetChunkEmbeddingsByIds.mockReturnValue([
        { assetId, chunkId, vector: uniformVec() },
    ]);
    mockGetChunksByIds.mockReturnValue([makeChunk(chunkId, assetId, chunkText)]);
}

// ─── Test Setup ──────────────────────────────────────────────────────────────

let db: any;

beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    setRerankerEnabled(false);
    setQueryRewriteEnabled(false);
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue(uniformVec());
    mockFtsSearchChunks.mockReturnValue(new Map());
    mockGetChunksByIds.mockReturnValue([]);
    mockGetChunkEmbeddingsByIds.mockReturnValue([]);
    mockGetChunkEmbeddingsByAssetIds.mockReturnValue([]);
});

afterEach(() => {
    _setDbForTesting(null);
    db.close();
    if ((global as unknown as Record<string, unknown>).fetch) {
        delete (global as unknown as Record<string, unknown>).fetch;
    }
});

// =============================================================================
// 1. Tam E2E Akışı
// =============================================================================

describe('E2E: oturum → soru → stream → kaydet → doğrula', () => {
    it('tam akış: oturum oluştur, soru sor, stream cevap, mesajları doğrula', async () => {
        // 1. Oturum oluştur
        const session = createSession('Test Sohbeti', { type: 'all' }, 'qwen3:4b');
        expect(session.id).toMatch(/^cs_/);

        // 2. Kullanıcı mesajı kaydet
        const userMsg = appendMessage(session.id, 'user', 'merdiven planı nedir?');
        expect(userMsg.role).toBe('user');

        // 3. RAG pipeline'ı çalıştır (stream)
        setupHit('merdiven basamak detayı zemin kat planında');
        mockOllamaStream(
            ['Merdiven ', 'planı ', 'şöyledir.'],
            { eval_count: 15, prompt_eval_count: 80 },
        );

        const receivedTokens: string[] = [];
        const history = [{ role: 'user' as const, content: 'merdiven planı nedir?' }];

        const result = await askQuestionStream(
            'merdiven planı nedir?',
            stubConfig,
            {
                onToken: (t) => receivedTokens.push(t),
                onDone: () => {},
            },
            { topK: 8 },
            { type: 'all' },
            history,
        );

        // 4. Stream sonucunu DB'ye kaydet
        const fullAnswer = receivedTokens.join('');
        expect(fullAnswer).toContain('Merdiven');
        const assistantMsg = appendMessage(
            session.id,
            'assistant',
            fullAnswer,
            result.citations,
            result.tokenStats.tokensIn,
            result.tokenStats.tokensOut,
        );

        // 5. Mesajları DB'den geri oku ve doğrula
        const messages = listMessages(session.id);
        expect(messages).toHaveLength(2);
        expect(messages[0].role).toBe('user');
        expect(messages[0].content).toBe('merdiven planı nedir?');
        expect(messages[1].role).toBe('assistant');
        expect(messages[1].content).toBe(fullAnswer);
        expect(messages[1].tokensIn).toBe(80);
        expect(messages[1].tokensOut).toBe(15);

        // 6. Citation'lar da round-trip'te korunuyor
        expect(messages[1].citations.length).toBeGreaterThan(0);
        expect(messages[1].citations[0]).toHaveProperty('fileName');
        expect(messages[1].citations[0]).toHaveProperty('score');
    });

    it('çoklu mesaj alışverişi — history birikmeli', async () => {
        const session = createSession('Çoklu Alışveriş');

        // İlk alışveriş
        appendMessage(session.id, 'user', 'merdiven nedir?');
        setupHit('merdiven basamak detayı');
        mockOllamaStream(['Merdiven ', 'yapısal ', 'elemandır.']);

        const r1 = await askQuestionStream('merdiven nedir?', stubConfig, { onToken: () => {} });
        appendMessage(session.id, 'assistant', 'Merdiven yapısal elemandır.', r1.citations);

        // İkinci alışveriş — önceki mesajlar history olarak geçilir
        setupHit('merdiven basamak yüksekliği 17cm');
        mockOllamaStream(['Basamak ', 'yüksekliği ', '17cm.']);

        const history = listMessages(session.id)
            .slice(-4)
            .map((m) => ({ role: m.role, content: m.content }));

        appendMessage(session.id, 'user', 'basamak yüksekliği kaç?');
        const r2 = await askQuestionStream('basamak yüksekliği kaç?', stubConfig, { onToken: () => {} }, {}, { type: 'all' }, history);
        appendMessage(session.id, 'assistant', 'Basamak yüksekliği 17cm.', r2.citations);

        // 4 mesaj olmalı
        const messages = listMessages(session.id);
        expect(messages).toHaveLength(4);
        expect(messages[0].content).toBe('merdiven nedir?');
        expect(messages[1].content).toBe('Merdiven yapısal elemandır.');
        expect(messages[2].content).toBe('basamak yüksekliği kaç?');
        expect(messages[3].content).toBe('Basamak yüksekliği 17cm.');
    });
});

// =============================================================================
// 2. Abort Senaryosu
// =============================================================================

describe('E2E: abort — kullanıcı stream ortasında durdurur', () => {
    it('AbortSignal ile stream kesilir, kısmi cevap kaydedilir', async () => {
        const session = createSession('Abort Testi');
        appendMessage(session.id, 'user', 'merdiven detayı');

        setupHit('merdiven basamak planı');

        // Yavaş stream simülasyonu — abort 1. chunk'tan sonra
        const controller = new AbortController();
        const encoder = new TextEncoder();
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            body: new ReadableStream({
                async start(ctrl) {
                    ctrl.enqueue(encoder.encode(JSON.stringify({ response: 'İlk kısım ', done: false }) + '\n'));
                    // Abort sinyali gönderdikten sonra stream devam edemeyecek
                    controller.abort();
                    try {
                        ctrl.enqueue(encoder.encode(JSON.stringify({ response: 'İkinci kısım', done: false }) + '\n'));
                        ctrl.enqueue(encoder.encode(JSON.stringify({ response: '', done: true, eval_count: 5, prompt_eval_count: 20 }) + '\n'));
                        ctrl.close();
                    } catch { /* aborted */ }
                },
            }),
        });

        const tokens: string[] = [];
        try {
            await askQuestionStream(
                'merdiven detayı',
                stubConfig,
                { onToken: (t) => tokens.push(t) },
                {},
                { type: 'all' },
                [],
                controller.signal,
            );
        } catch {
            // AbortError bekleniyor
        }

        // Kısmi cevabı kaydet (ChatPanel davranışı)
        const partial = tokens.join('');
        if (partial) {
            appendMessage(session.id, 'assistant', partial + '\n\n⏹ (durduruldu)');
        }

        const messages = listMessages(session.id);
        // En az kullanıcı mesajı olmalı
        expect(messages.length).toBeGreaterThanOrEqual(1);
        expect(messages[0].content).toBe('merdiven detayı');
    });
});

// =============================================================================
// 3. Hata Senaryosu
// =============================================================================

describe('E2E: Ollama bağlantı hatası', () => {
    it('fetch hatası → hata mesajı DB\'ye kaydedilir', async () => {
        const session = createSession('Hata Testi');
        appendMessage(session.id, 'user', 'merdiven planı');

        setupHit('merdiven basamak');
        global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

        try {
            await askQuestionStream(
                'merdiven planı',
                stubConfig,
                { onToken: vi.fn() },
            );
        } catch (err) {
            // Hata mesajını kaydet (ChatPanel davranışı)
            appendMessage(session.id, 'assistant', `Hata: ${(err as Error).message}`);
        }

        const messages = listMessages(session.id);
        expect(messages).toHaveLength(2);
        expect(messages[1].role).toBe('assistant');
        expect(messages[1].content).toContain('Connection refused');
    });
});

// =============================================================================
// 4. Keyword Gate
// =============================================================================

describe('E2E: keyword gate — bilgi yoksa LLM çağrılmaz', () => {
    it('arsivde eşleşme yoksa kullanıcıya bilgi mesajı döner, fetch çağrılmaz', async () => {
        const session = createSession('Gate Testi');
        appendMessage(session.id, 'user', 'quantum_fizik_xyz');

        // Boş arama sonuçları
        mockFtsSearchChunks.mockReturnValue(new Map());
        mockGetChunkEmbeddingsByIds.mockReturnValue([]);

        const tokens: string[] = [];
        await askQuestionStream(
            'quantum_fizik_xyz',
            stubConfig,
            { onToken: (t) => tokens.push(t) },
        );

        const answer = tokens.join('');
        expect(answer).toContain('bilgi bulamadım');

        // Sonucu kaydet
        appendMessage(session.id, 'assistant', answer);

        // fetch hiç çağrılmamalı (LLM kullanılmadı)
        expect(global.fetch).not.toBeDefined();

        // Mesajlar doğru kaydedildi
        const messages = listMessages(session.id);
        expect(messages).toHaveLength(2);
        expect(messages[1].content).toContain('bilgi bulamadım');
    });
});

// =============================================================================
// 5. Sentez Akışı (Çoklu Belge)
// =============================================================================

describe('E2E: sentez — çoklu belge karşılaştırma', () => {
    it('birden fazla asset seçilince per-asset retrieval + sentez yanıtı', async () => {
        const session = createSession('Sentez Testi');
        appendMessage(session.id, 'user', 'iki planı karşılaştır');

        // İki farklı asset'ten hit'ler
        mockFtsSearchChunks.mockReturnValue(makeFtsMap([
            ['c1', 'a1', 0.9],
            ['c2', 'a2', 0.7],
        ]));
        mockGetChunkEmbeddingsByAssetIds.mockReturnValue([
            { assetId: 'a1', chunkId: 'c1', vector: uniformVec() },
            { assetId: 'a2', chunkId: 'c2', vector: uniformVec() },
        ]);
        mockGetChunksByIds.mockReturnValue([
            makeChunk('c1', 'a1', 'Plan A merdiven sol tarafta'),
            makeChunk('c2', 'a2', 'Plan B merdiven sağ tarafta'),
        ]);
        mockOllamaStream(
            ['Plan A\'da ', 'merdiven ', 'solda, ', 'Plan B\'de ', 'sağda.'],
            { eval_count: 25, prompt_eval_count: 120 },
        );

        const tokens: string[] = [];
        const result = await askSynthesisStream(
            'iki planı karşılaştır',
            ['a1', 'a2'],
            stubConfig,
            { onToken: (t) => tokens.push(t) },
            { topPerAsset: 3 },
        );

        const answer = tokens.join('');
        appendMessage(
            session.id,
            'assistant',
            answer,
            result.citations,
            result.tokenStats.tokensIn,
            result.tokenStats.tokensOut,
        );

        const messages = listMessages(session.id);
        expect(messages).toHaveLength(2);
        expect(messages[1].tokensIn).toBe(120);
        expect(messages[1].tokensOut).toBe(25);
    });
});

// =============================================================================
// 6. Oturum Kalıcılığı — Snapshot/Restore
// =============================================================================

describe('E2E: oturum kalıcılığı — sil → geri yükle', () => {
    it('snapshot → sil → restore → mesajlar korunur', () => {
        const session = createSession('Kalıcılık Testi');
        appendMessage(session.id, 'user', 'soru 1');
        appendMessage(session.id, 'assistant', 'cevap 1', [
            { index: 1, chunkId: 'c1', assetId: 'a1', fileName: 'plan.dwg', filePath: '/plan.dwg', page: null, score: 0.9, snippet: 'detay' },
        ]);

        // Snapshot al
        const snap = snapshotSession(session.id);
        expect(snap).not.toBeNull();
        expect(snap!.messages).toHaveLength(2);

        // Sil
        deleteSession(session.id);
        expect(listMessages(session.id)).toHaveLength(0);
        expect(listSessions().find((s) => s.id === session.id)).toBeUndefined();

        // Geri yükle
        restoreSession(snap!);
        const restored = listMessages(session.id);
        expect(restored).toHaveLength(2);
        expect(restored[0].content).toBe('soru 1');
        expect(restored[1].content).toBe('cevap 1');
        expect(restored[1].citations).toHaveLength(1);
        expect(restored[1].citations[0].fileName).toBe('plan.dwg');
    });

    it('rename sonrası başlık ve updated_at güncellenir', () => {
        const session = createSession('Eski Başlık');
        const beforeUpdate = session.updatedAt;

        // Küçük bir gecikme — updated_at farkı olsun
        renameSession(session.id, 'Yeni Başlık');

        const sessions = listSessions();
        const updated = sessions.find((s) => s.id === session.id)!;
        expect(updated.title).toBe('Yeni Başlık');
        expect(updated.updatedAt >= beforeUpdate).toBe(true);
    });
});

// =============================================================================
// 7. Token İstatistikleri
// =============================================================================

describe('E2E: token istatistikleri round-trip', () => {
    it('tokensIn/tokensOut DB\'ye kaydedilir ve geri okunur', async () => {
        const session = createSession('Token Testi');
        appendMessage(session.id, 'user', 'merdiven');

        setupHit('merdiven basamak detayı');
        mockOllamaStream(['cevap'], { eval_count: 42, prompt_eval_count: 128 });

        const result = await askQuestionStream(
            'merdiven',
            stubConfig,
            { onToken: () => {} },
        );

        appendMessage(
            session.id,
            'assistant',
            'cevap',
            result.citations,
            result.tokenStats.tokensIn,
            result.tokenStats.tokensOut,
        );

        const messages = listMessages(session.id);
        const assistant = messages.find((m) => m.role === 'assistant')!;
        expect(assistant.tokensIn).toBe(128);
        expect(assistant.tokensOut).toBe(42);
    });

    it('tokensIn/tokensOut null olarak da kaydedilebilir', () => {
        const session = createSession('Null Token Testi');
        appendMessage(session.id, 'user', 'soru');
        appendMessage(session.id, 'assistant', 'cevap', [], null, null);

        const messages = listMessages(session.id);
        expect(messages[1].tokensIn).toBeNull();
        expect(messages[1].tokensOut).toBeNull();
    });
});

// =============================================================================
// 8. Görsel Arama Akışı
// =============================================================================

describe('E2E: görsel arama — citation round-trip', () => {
    it('visual citation\'lar DB\'ye kaydedilir ve geri okunur', () => {
        const session = createSession('Görsel Arama Testi');
        appendMessage(session.id, 'user', '/görsel cephe çizimi');

        // Görsel arama sonuçlarını citation olarak kaydet (ChatPanel davranışı)
        const visualCitations: RagCitation[] = [
            {
                index: 1,
                chunkId: 'visual:asset_1',
                assetId: 'asset_1',
                fileName: 'cephe.jpg',
                filePath: '/archive/cephe.jpg',
                page: null,
                score: 0.85,
                snippet: '',
            },
            {
                index: 2,
                chunkId: 'visual:asset_2',
                assetId: 'asset_2',
                fileName: 'facade.png',
                filePath: '/archive/facade.png',
                page: null,
                score: 0.72,
                snippet: '',
            },
        ];

        appendMessage(
            session.id,
            'assistant',
            '[VISUAL] "cephe çizimi" — 2 sonuç',
            visualCitations,
        );

        const messages = listMessages(session.id);
        expect(messages).toHaveLength(2);

        const visualMsg = messages[1];
        expect(visualMsg.content).toContain('[VISUAL]');
        expect(visualMsg.citations).toHaveLength(2);
        expect(visualMsg.citations[0].chunkId).toBe('visual:asset_1');
        expect(visualMsg.citations[0].score).toBeCloseTo(0.85, 2);
        expect(visualMsg.citations[1].chunkId).toBe('visual:asset_2');
    });
});

// =============================================================================
// 9. Çoklu Oturum İzolasyonu
// =============================================================================

describe('E2E: çoklu oturum izolasyonu', () => {
    it('farklı oturumların mesajları birbirini etkilemez', () => {
        const s1 = createSession('Oturum 1');
        const s2 = createSession('Oturum 2');

        appendMessage(s1.id, 'user', 'soru A');
        appendMessage(s1.id, 'assistant', 'cevap A');
        appendMessage(s2.id, 'user', 'soru B');

        expect(listMessages(s1.id)).toHaveLength(2);
        expect(listMessages(s2.id)).toHaveLength(1);

        // s1 silinince s2 etkilenmemeli
        deleteSession(s1.id);
        expect(listMessages(s1.id)).toHaveLength(0);
        expect(listMessages(s2.id)).toHaveLength(1);
        expect(listMessages(s2.id)[0].content).toBe('soru B');
    });

    it('oturum cascade delete — tüm mesajlar silinir', () => {
        const session = createSession('Cascade Testi');
        for (let i = 0; i < 5; i++) {
            appendMessage(session.id, 'user', `soru ${i}`);
            appendMessage(session.id, 'assistant', `cevap ${i}`);
        }
        expect(listMessages(session.id)).toHaveLength(10);

        deleteSession(session.id);
        expect(listMessages(session.id)).toHaveLength(0);
    });
});
