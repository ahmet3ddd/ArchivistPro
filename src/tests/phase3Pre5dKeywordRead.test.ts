/**
 * V3 Faz 3 — PRE-5d testleri: keyword/FTS OKUMA routing.
 *
 * - epoch<2: BİREBİR eski sync sql.js yolu (`ftsSearchChunks` /
 *   `searchTextChunksByKeyword`) — invoke YOK.
 * - epoch>=2: `text_chunks` vec.db'de; keyword araması vec.db FTS5
 *   (`vec_db_fts_search`) komutuna invoke.
 * - `searchTextChunksByKeywordAsync`: distinct assetId + soft-delete süzme.
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
    softDeleteAsset,
    _setDbForTesting,
    __setSchemaEpochForTesting,
    ftsSearchChunksAsync,
    searchTextChunksByKeywordAsync,
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

describe('Faz 3 PRE-5d — keyword/FTS okuma routing', () => {
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

    // ── epoch<2: sync sql.js yolu (invoke YOK) ───────────────────────────

    it('epoch=0: ftsSearchChunksAsync sync yol, invoke YOK', async () => {
        const r = await ftsSearchChunksAsync('merdiven');
        expect(r).toBeInstanceOf(Map);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=1: ftsSearchChunksAsync hâlâ sync (text_chunks epoch>=2 taşınır)', async () => {
        __setSchemaEpochForTesting(1);
        await ftsSearchChunksAsync('merdiven');
        await searchTextChunksByKeywordAsync('merdiven');
        expect(invokeMock).not.toHaveBeenCalled();
    });

    // ── epoch>=2: vec.db FTS5 invoke yolu ────────────────────────────────

    it('epoch=2: ftsSearchChunksAsync vec_db_fts_search invoke + bm25 skor', async () => {
        invokeMock.mockResolvedValueOnce([
            { chunkId: 'c1', assetId: 'a1' },
            { chunkId: 'c2', assetId: 'a2' },
        ]);
        __setSchemaEpochForTesting(2);
        const r = await ftsSearchChunksAsync('merdiven', 50);
        // skor = 1/(idx+1): dizin sırası bm25 sırası
        expect(r.get('c1')).toEqual({ assetId: 'a1', score: 1 });
        expect(r.get('c2')).toEqual({ assetId: 'a2', score: 0.5 });
        expect(callsTo('vec_db_fts_search')[0][1]).toEqual({
            archiveAt: null,
            query: 'merdiven',
            limit: 50,
        });
    });

    it('epoch=2: searchTextChunksByKeywordAsync distinct assetId + soft-delete süzer', async () => {
        upsertAsset(makeAsset('a1'));
        upsertAsset(makeAsset('a2'));
        upsertAsset(makeAsset('a3'));
        softDeleteAsset('a2'); // a2 çöp kutusunda
        invokeMock.mockResolvedValueOnce([
            { chunkId: 'c1', assetId: 'a1' },
            { chunkId: 'c1b', assetId: 'a1' }, // aynı asset → distinct
            { chunkId: 'c2', assetId: 'a2' }, // soft-deleted → süzülür
            { chunkId: 'c3', assetId: 'a3' },
        ]);
        __setSchemaEpochForTesting(2);
        const ids = await searchTextChunksByKeywordAsync('hesap');
        expect([...ids].sort()).toEqual(['a1', 'a3']);
        expect(callsTo('vec_db_fts_search')).toHaveLength(1);
    });

    // ── invoke null → sync fallback ──────────────────────────────────────

    it('epoch=2: invoke null → sync fallback (Map döner, crash YOK)', async () => {
        __setSchemaEpochForTesting(2);
        invokeMock.mockResolvedValue(null);
        const r = await ftsSearchChunksAsync('merdiven');
        expect(r).toBeInstanceOf(Map);
        expect(callsTo('vec_db_fts_search')).toHaveLength(1);
    });
});
