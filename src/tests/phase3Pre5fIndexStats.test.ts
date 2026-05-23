/**
 * V3 Faz 3 — PRE-5f testleri: index durum/sayım OKUMA routing.
 *
 * - getRagIndexCountMapsAsync: epoch<1 sql.js GROUP BY; epoch>=1 vec.db
 *   (`vec_db_rag_index_counts`). `analyzeRagIndex` için.
 * - getChunkStatsAsync: epoch<2 sql.js; epoch>=2 vec.db (`vec_db_chunk_stats`).
 *   `ChatPanel` rozeti + `buildNoResultDiagnostic` için.
 * - invoke null → sync fallback.
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
    upsertAsset,
    upsertTextChunk,
    saveChunkEmbedding,
    _setDbForTesting,
    __setSchemaEpochForTesting,
    getRagIndexCountMapsAsync,
    getChunkStatsAsync,
} from '../services/database';

function callsTo(cmd: string) {
    return invokeMock.mock.calls.filter(([c]) => c === cmd);
}
function makeAsset(id: string) {
    return {
        id,
        fileName: `${id}.pdf`,
        filePath: `C:/P/${id}.pdf`,
        fileSize: 10,
        fileType: 'PDF',
        category: 'Belge',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-06-15T12:00:00Z',
        projectName: 'P',
        projectPhase: 'K',
    };
}

describe('Faz 3 PRE-5f — index durum/sayım okuma routing', () => {
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

    // ── getRagIndexCountMapsAsync ────────────────────────────────────────

    it('epoch=0: getRagIndexCountMapsAsync sql.js GROUP BY, invoke YOK', async () => {
        upsertAsset(makeAsset('a1'));
        upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'x' });
        upsertTextChunk({ id: 'a1_c1', assetId: 'a1', chunkIndex: 1, text: 'y' });
        saveChunkEmbedding('a1', 'a1_c0', [0.1], 'chunk_text');
        const maps = await getRagIndexCountMapsAsync();
        expect(maps.chunkCounts.get('a1')).toBe(2);
        expect(maps.embedCounts.get('a1')).toBe(1);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=1: getRagIndexCountMapsAsync vec_db_rag_index_counts invoke', async () => {
        invokeMock.mockResolvedValueOnce({
            chunkCounts: [{ assetId: 'a1', count: 5 }],
            embedCounts: [{ assetId: 'a1', count: 3 }],
        });
        __setSchemaEpochForTesting(1);
        const maps = await getRagIndexCountMapsAsync();
        expect(maps.chunkCounts.get('a1')).toBe(5);
        expect(maps.embedCounts.get('a1')).toBe(3);
        expect(callsTo('vec_db_rag_index_counts')).toHaveLength(1);
    });

    // ── getChunkStatsAsync ───────────────────────────────────────────────

    it('epoch=1: getChunkStatsAsync sql.js (text_chunks epoch>=2 taşınır)', async () => {
        upsertAsset(makeAsset('a1'));
        upsertTextChunk({ id: 'a1_m', assetId: 'a1', chunkIndex: -1, text: 'meta' });
        upsertTextChunk({ id: 'a1_b', assetId: 'a1', chunkIndex: 0, text: 'body' });
        __setSchemaEpochForTesting(1);
        const s = await getChunkStatsAsync();
        expect(s.total).toBe(2);
        expect(s.metaTotal).toBe(1);
        expect(s.metaAssets).toBe(1);
        expect(s.contentAssets).toBe(1);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=2: getChunkStatsAsync vec_db_chunk_stats invoke', async () => {
        invokeMock.mockResolvedValueOnce({
            total: 296,
            metaTotal: 100,
            metaAssets: 80,
            contentAssets: 60,
        });
        __setSchemaEpochForTesting(2);
        const s = await getChunkStatsAsync();
        expect(s).toEqual({ total: 296, metaTotal: 100, metaAssets: 80, contentAssets: 60 });
        expect(callsTo('vec_db_chunk_stats')).toHaveLength(1);
    });

    it('epoch=2: invoke null → sql.js fallback (text_chunks DROP\'lu → 0)', async () => {
        db.run('DROP TABLE text_chunks');
        __setSchemaEpochForTesting(2);
        invokeMock.mockResolvedValue(null);
        const s = await getChunkStatsAsync();
        expect(s).toEqual({ total: 0, metaTotal: 0, metaAssets: 0, contentAssets: 0 });
        expect(callsTo('vec_db_chunk_stats')).toHaveLength(1);
    });
});
