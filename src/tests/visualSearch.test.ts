import { describe, it, expect, vi, beforeEach } from 'vitest';

/* ── Mock'lar ── */

const mockGenerateClipTextEmbedding = vi.fn(async () => new Float32Array([1, 0, 0]));
const mockCosineSimilarity = vi.fn(() => 0.5);
const mockLoadClipTextModel = vi.fn();

vi.mock('../services/embeddings', () => ({
    generateClipTextEmbedding: (...a: unknown[]) => mockGenerateClipTextEmbedding(...a),
    cosineSimilarity: (...a: unknown[]) => mockCosineSimilarity(...a),
    loadClipTextModel: () => mockLoadClipTextModel(),
}));

const mockGetEmbeddingsBySourcePrefix = vi.fn(() => []);
vi.mock('../services/database', () => ({
    getEmbeddingsBySourcePrefix: (...a: unknown[]) => mockGetEmbeddingsBySourcePrefix(...a),
}));

const mockInvokeWithTimeout = vi.fn();
vi.mock('../utils/invokeWithTimeout', () => ({
    invokeWithTimeout: (...a: unknown[]) => mockInvokeWithTimeout(...a),
}));

vi.mock('../services/ollamaService', () => ({
    chatModel: () => 'qwen3:4b',
    normalizeOllamaGenerateUrl: (url: string) => url + '/api/generate',
}));

vi.mock('../services/logger', () => ({
    debugLog: vi.fn(),
}));

import { translateToEnglish, searchImagesByText } from '../services/visualSearch';

const MOCK_CONFIG = {
    apiUrl: 'http://localhost:11434',
    model: 'qwen3:4b',
    visionModel: 'llava',
    autoIndex: true,
    advancedMode: false,
} as never;

beforeEach(() => {
    vi.clearAllMocks();
});

/* ════════════════════════════════════════════════════════════════════
   translateToEnglish
   ════════════════════════════════════════════════════════════════════ */

describe('visualSearch — translateToEnglish', () => {
    it('boş string için boş döner', async () => {
        const result = await translateToEnglish('', MOCK_CONFIG);
        expect(result).toBe('');
    });

    it('sadece boşluk için boş döner', async () => {
        const result = await translateToEnglish('   ', MOCK_CONFIG);
        expect(result).toBe('');
    });

    it('İngilizce metin olduğu gibi döner (Ollama çağrılmaz)', async () => {
        const result = await translateToEnglish('facade drawing', MOCK_CONFIG);
        expect(result).toBe('facade drawing');
        expect(mockInvokeWithTimeout).not.toHaveBeenCalled();
    });

    it('Türkçe karakter varsa Ollama çağırır', async () => {
        mockInvokeWithTimeout.mockResolvedValueOnce(JSON.stringify({ response: 'stair plan' }));
        const result = await translateToEnglish('merdiven çizimi', MOCK_CONFIG);
        expect(result).toBe('stair plan');
        expect(mockInvokeWithTimeout).toHaveBeenCalledOnce();
    });

    it('yaygın Türkçe kelime varsa Ollama çağırır', async () => {
        mockInvokeWithTimeout.mockResolvedValueOnce(JSON.stringify({ response: 'doors and windows' }));
        const result = await translateToEnglish('kapi ve pencere', MOCK_CONFIG);
        expect(result).toBe('doors and windows');
        expect(mockInvokeWithTimeout).toHaveBeenCalledOnce();
    });

    it('<think> taglarını temizler', async () => {
        mockInvokeWithTimeout.mockResolvedValueOnce(JSON.stringify({
            response: '<think>Let me translate this</think>floor plan',
        }));
        const result = await translateToEnglish('kat planı', MOCK_CONFIG);
        expect(result).toBe('floor plan');
    });

    it('EN: prefixi temizler', async () => {
        mockInvokeWithTimeout.mockResolvedValueOnce(JSON.stringify({
            response: 'EN: elevation drawing',
        }));
        const result = await translateToEnglish('cephe çizimi', MOCK_CONFIG);
        expect(result).toBe('elevation drawing');
    });

    it('tırnak ve noktalama temizler', async () => {
        mockInvokeWithTimeout.mockResolvedValueOnce(JSON.stringify({
            response: '"floor plan."',
        }));
        const result = await translateToEnglish('kat planı', MOCK_CONFIG);
        expect(result).toBe('floor plan');
    });

    it('Ollama hatası durumunda orijinal metni döner', async () => {
        mockInvokeWithTimeout.mockRejectedValueOnce(new Error('timeout'));
        const result = await translateToEnglish('merdiven çizimi', MOCK_CONFIG);
        expect(result).toBe('merdiven çizimi');
    });

    it('Ollama boş response dönerse orijinal metni döner', async () => {
        mockInvokeWithTimeout.mockResolvedValueOnce(JSON.stringify({ response: '' }));
        const result = await translateToEnglish('kat planı', MOCK_CONFIG);
        expect(result).toBe('kat planı');
    });
});

/* ════════════════════════════════════════════════════════════════════
   searchImagesByText
   ════════════════════════════════════════════════════════════════════ */

describe('visualSearch — searchImagesByText', () => {
    it('boş sorgu için boş hits döner', async () => {
        const result = await searchImagesByText('', MOCK_CONFIG);
        expect(result.hits).toEqual([]);
    });

    it('embedding yoksa boş hits döner', async () => {
        mockGetEmbeddingsBySourcePrefix.mockReturnValue([]);
        const result = await searchImagesByText('test query', MOCK_CONFIG, 10, { translate: false });
        expect(result.hits).toEqual([]);
        expect(mockLoadClipTextModel).toHaveBeenCalled();
    });

    it('asset başına en iyi crop skorunu seçer', async () => {
        mockGetEmbeddingsBySourcePrefix.mockReturnValue([
            { assetId: 'a1', vector: new Float32Array([1, 0, 0]) },
            { assetId: 'a1', vector: new Float32Array([0, 1, 0]) },
            { assetId: 'a2', vector: new Float32Array([0, 0, 1]) },
        ]);
        // İlk çağrıda 0.8, ikincisinde 0.3, üçüncüsünde 0.6
        mockCosineSimilarity
            .mockReturnValueOnce(0.8)
            .mockReturnValueOnce(0.3)
            .mockReturnValueOnce(0.6);

        const result = await searchImagesByText('test', MOCK_CONFIG, 10, { translate: false });
        expect(result.hits).toHaveLength(2);
        expect(result.hits[0].assetId).toBe('a1');
        expect(result.hits[0].score).toBe(0.8);
        expect(result.hits[1].assetId).toBe('a2');
        expect(result.hits[1].score).toBe(0.6);
    });

    it('minScore altındaki sonuçları filtreler', async () => {
        mockGetEmbeddingsBySourcePrefix.mockReturnValue([
            { assetId: 'a1', vector: new Float32Array([1, 0, 0]) },
            { assetId: 'a2', vector: new Float32Array([0, 1, 0]) },
        ]);
        mockCosineSimilarity.mockReturnValueOnce(0.5).mockReturnValueOnce(0.1);

        const result = await searchImagesByText('test', MOCK_CONFIG, 10, { translate: false, minScore: 0.2 });
        expect(result.hits).toHaveLength(1);
        expect(result.hits[0].assetId).toBe('a1');
    });

    it('limit parametresine uyar', async () => {
        const embeddings = Array.from({ length: 10 }, (_, i) => ({
            assetId: `a${i}`,
            vector: new Float32Array([1, 0, 0]),
        }));
        mockGetEmbeddingsBySourcePrefix.mockReturnValue(embeddings);
        mockCosineSimilarity.mockReturnValue(0.5);

        const result = await searchImagesByText('test', MOCK_CONFIG, 3, { translate: false });
        expect(result.hits).toHaveLength(3);
    });

    it('translate: false ise çeviri yapmaz', async () => {
        mockGetEmbeddingsBySourcePrefix.mockReturnValue([]);
        await searchImagesByText('merdiven çizimi', MOCK_CONFIG, 10, { translate: false });
        expect(mockInvokeWithTimeout).not.toHaveBeenCalled();
    });

    it('effectiveQuery döner', async () => {
        mockGetEmbeddingsBySourcePrefix.mockReturnValue([]);
        const result = await searchImagesByText('facade', MOCK_CONFIG, 10, { translate: false });
        expect(result.effectiveQuery).toBe('facade');
    });

    it('sonuçları score\'a göre azalan sıralar', async () => {
        mockGetEmbeddingsBySourcePrefix.mockReturnValue([
            { assetId: 'a1', vector: new Float32Array([1, 0, 0]) },
            { assetId: 'a2', vector: new Float32Array([0, 1, 0]) },
            { assetId: 'a3', vector: new Float32Array([0, 0, 1]) },
        ]);
        mockCosineSimilarity
            .mockReturnValueOnce(0.3)
            .mockReturnValueOnce(0.9)
            .mockReturnValueOnce(0.6);

        const result = await searchImagesByText('test', MOCK_CONFIG, 10, { translate: false });
        expect(result.hits[0].score).toBe(0.9);
        expect(result.hits[1].score).toBe(0.6);
        expect(result.hits[2].score).toBe(0.3);
    });
});
