/**
 * V3 Faz 3 — PRE-5b testleri: embeddings OKUMA routing.
 *
 * - epoch=0: BİREBİR eski sync sql.js yolu (invoke YOK).
 * - epoch>=1: embeddings vec.db'de → ilgili `vec_db_*` komutuna invoke.
 * - invoke null (Tauri yok / hata) → sync fallback.
 *
 * Gate `_schemaEpoch` (bayrak DEĞİL) — A4 deseni; epoch ancak migration
 * verify+DROP yaptıysa ilerler.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

const invokeMock = vi.fn((..._args: unknown[]) => Promise.resolve(null));
vi.mock('@tauri-apps/api/core', () => ({
    invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('../permissions/roles', () => ({ getAppRole: vi.fn(() => 'admin') }));
vi.mock('../services/logger', () => ({
    auditLog: vi.fn(),
    setLoggerDb: vi.fn(),
    debugLog: vi.fn(),
    errorLog: vi.fn(),
    warnLog: vi.fn(),
    infoLog: vi.fn(),
}));
vi.mock('../services/tagService', () => ({ setTagDb: vi.fn() }));
vi.mock('../services/favorites', () => ({ setFavoritesDb: vi.fn() }));
vi.mock('../services/messageService', () => ({ setMessageDb: vi.fn() }));
vi.mock('../services/userService', () => ({ setUserDb: vi.fn() }));

import {
    saveEmbedding,
    upsertAsset,
    _setDbForTesting,
    __setSchemaEpochForTesting,
    getEmbeddingStatsAsync,
    hasAnyEmbeddingsAsync,
    getAllEmbeddingsAsync,
    getEmbeddingsBySourcePrefixAsync,
    getChunkEmbeddingsByAssetIdsAsync,
} from '../services/database';

function callsTo(cmd: string) {
    return invokeMock.mock.calls.filter(([c]) => c === cmd);
}

/** embeddings.asset_id → assets.id FK'sini karşılamak için minimal asset. */
function makeAsset(id: string) {
    return {
        id,
        fileName: `${id}.dwg`,
        filePath: `C:/Projects/${id}.dwg`,
        fileSize: 1024,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-06-15T12:00:00Z',
        projectName: 'P',
        projectPhase: 'K',
    };
}

describe('Faz 3 PRE-5b — embeddings okuma routing', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
        invokeMock.mockReset();
        invokeMock.mockResolvedValue(null);
        __setSchemaEpochForTesting(0);
    });

    afterEach(() => {
        __setSchemaEpochForTesting(0);
        _setDbForTesting(null);
        db.close();
    });

    // ── epoch=0: sync sql.js yolu (BİREBİR, invoke YOK) ──────────────────

    it('epoch=0: getEmbeddingStatsAsync sql.js sayar, invoke YOK', async () => {
        upsertAsset(makeAsset('a1'));
        upsertAsset(makeAsset('a2'));
        saveEmbedding('a1', [0.1, 0.2], 'text');
        saveEmbedding('a2', [0.3, 0.4], 'text');
        saveEmbedding('a1', [0.5, 0.6], 'image'); // a1'in ikinci embedding'i
        const s = await getEmbeddingStatsAsync();
        expect(s.total).toBe(3);
        expect(s.distinctAssets).toBe(2);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=0: hasAnyEmbeddingsAsync boş false / dolu true', async () => {
        expect(await hasAnyEmbeddingsAsync()).toBe(false);
        upsertAsset(makeAsset('a1'));
        saveEmbedding('a1', [0.1], 'text');
        expect(await hasAnyEmbeddingsAsync()).toBe(true);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=0: getChunkEmbeddingsByAssetIdsAsync boş input → [], invoke YOK', async () => {
        expect(await getChunkEmbeddingsByAssetIdsAsync([])).toEqual([]);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    // ── epoch>=1: vec.db invoke yolu ─────────────────────────────────────

    it('epoch=1: getEmbeddingStatsAsync vec_db_embedding_stats invoke eder', async () => {
        invokeMock.mockResolvedValueOnce({ total: 1687, distinctAssets: 445 });
        __setSchemaEpochForTesting(1);
        const s = await getEmbeddingStatsAsync();
        expect(s).toEqual({ total: 1687, distinctAssets: 445 });
        const c = callsTo('vec_db_embedding_stats');
        expect(c).toHaveLength(1);
        expect(c[0][1]).toEqual({ archiveAt: null });
    });

    it('epoch=1: hasAnyEmbeddingsAsync invoke total>0 → true / 0 → false', async () => {
        __setSchemaEpochForTesting(1);
        invokeMock.mockResolvedValueOnce({ total: 5, distinctAssets: 2 });
        expect(await hasAnyEmbeddingsAsync()).toBe(true);
        invokeMock.mockResolvedValueOnce({ total: 0, distinctAssets: 0 });
        expect(await hasAnyEmbeddingsAsync()).toBe(false);
    });

    it('epoch=1: getAllEmbeddingsAsync invoke eder + source alanını düşürür', async () => {
        invokeMock.mockResolvedValueOnce([
            { assetId: 'a1', source: 'text', vector: [0.1, 0.2] },
            { assetId: 'a2', source: 'text', vector: [0.3, 0.4] },
        ]);
        __setSchemaEpochForTesting(1);
        const r = await getAllEmbeddingsAsync('text');
        expect(r).toEqual([
            { assetId: 'a1', vector: [0.1, 0.2] },
            { assetId: 'a2', vector: [0.3, 0.4] },
        ]);
        const c = callsTo('vec_db_embeddings_by_source');
        expect(c[0][1]).toEqual({ archiveAt: null, source: 'text', prefix: false });
    });

    it('epoch=1: getEmbeddingsBySourcePrefixAsync prefix:true ile invoke', async () => {
        invokeMock.mockResolvedValueOnce([
            { assetId: 'a1', source: 'image_global', vector: [0.1] },
        ]);
        __setSchemaEpochForTesting(1);
        const r = await getEmbeddingsBySourcePrefixAsync('image_');
        expect(r).toHaveLength(1);
        expect(r[0].source).toBe('image_global');
        const c = callsTo('vec_db_embeddings_by_source');
        expect(c[0][1]).toEqual({ archiveAt: null, source: 'image_', prefix: true });
    });

    it('epoch=1: getChunkEmbeddingsByAssetIdsAsync by_assets komutuna invoke', async () => {
        invokeMock.mockResolvedValueOnce([
            { assetId: 'a1', chunkId: 'c1', vector: [0.1] },
        ]);
        __setSchemaEpochForTesting(1);
        const r = await getChunkEmbeddingsByAssetIdsAsync(['a1', 'a2']);
        expect(r).toEqual([{ assetId: 'a1', chunkId: 'c1', vector: [0.1] }]);
        const c = callsTo('vec_db_chunk_embeddings_by_assets');
        expect(c[0][1]).toEqual({
            archiveAt: null,
            assetIds: ['a1', 'a2'],
            source: 'chunk_text',
        });
    });

    // ── invoke null → sync fallback ──────────────────────────────────────

    it('epoch=1: invoke null → sync fallback (embeddings DROP\'lu → 0)', async () => {
        // Migrasyon simülasyonu: embeddings DROP, epoch=1, invoke null döner.
        db.run('DROP TABLE embeddings');
        __setSchemaEpochForTesting(1);
        invokeMock.mockResolvedValue(null);
        const s = await getEmbeddingStatsAsync();
        // sync getEmbeddingCount "no such table" → catch → 0
        expect(s).toEqual({ total: 0, distinctAssets: 0 });
        // invoke denendi (epoch>=1) ama null döndü
        expect(callsTo('vec_db_embedding_stats')).toHaveLength(1);
    });
});
