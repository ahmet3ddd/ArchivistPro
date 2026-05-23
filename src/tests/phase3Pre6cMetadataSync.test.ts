/**
 * V3 Faz 3 — PRE-6c testleri: ChatPanel B2 auto-metadata-sync yazma routing.
 *
 * - `getAssetsMissingMetadataChunkAsync`: epoch<2 → sql.js `NOT EXISTS`;
 *   epoch>=2 → tüm asset (sql.js) − metadata chunk'ı olanlar
 *   (`vec_db_metadata_chunk_asset_ids`, vec.db).
 * - `deleteMetadataChunksFromVecDb`: `vec_db_delete_metadata_chunks` invoke.
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
    _setDbForTesting,
    __setSchemaEpochForTesting,
    getAssetsMissingMetadataChunkAsync,
    deleteMetadataChunksFromVecDb,
} from '../services/database';

function callsTo(cmd: string) {
    return invokeMock.mock.calls.filter(([c]) => c === cmd);
}

function seedAsset(id: string) {
    upsertAsset({
        id,
        fileName: `${id}.dwg`,
        filePath: `C:/P/${id}.dwg`,
        fileSize: 10,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-06-15T12:00:00Z',
        projectName: 'P',
        projectPhase: 'Konsept',
    });
}

describe('Faz 3 PRE-6c — metadata-sync yazma routing', () => {
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

    function addMetaChunk(chunkId: string, assetId: string) {
        db.run(
            `INSERT INTO text_chunks (id, asset_id, chunk_index, page, text, lang) VALUES (?,?,?,?,?,?)`,
            [chunkId, assetId, -1, null, 'meta', null],
        );
    }

    // ── epoch<2: sql.js NOT EXISTS yolu ──────────────────────────────────

    it('epoch=0: metadata chunk eksik asset\'ler — sql.js, invoke YOK', async () => {
        seedAsset('a1'); seedAsset('a2'); seedAsset('a3');
        addMetaChunk('m1', 'a1'); // yalnız a1'in metadata chunk'ı var
        const missing = await getAssetsMissingMetadataChunkAsync();
        expect(missing.slice().sort()).toEqual(['a2', 'a3']);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=0: silinmiş asset (is_deleted=1) hariç tutulur', async () => {
        seedAsset('a1'); seedAsset('a2');
        db.run(`UPDATE assets SET is_deleted = 1 WHERE id = 'a2'`);
        const missing = await getAssetsMissingMetadataChunkAsync();
        expect(missing).toEqual(['a1']);
    });

    // ── epoch>=2: vec.db yolu ────────────────────────────────────────────

    it('epoch=2: missing = tüm asset − vec_db_metadata_chunk_asset_ids', async () => {
        seedAsset('a1'); seedAsset('a2'); seedAsset('a3');
        db.run('DROP TABLE text_chunks'); // epoch>=2: text_chunks vec.db'de
        __setSchemaEpochForTesting(2);
        invokeMock.mockResolvedValueOnce(['a1']); // a1'in vec.db'de meta chunk'ı var

        const missing = await getAssetsMissingMetadataChunkAsync();
        expect(missing.slice().sort()).toEqual(['a2', 'a3']);
        expect(callsTo('vec_db_metadata_chunk_asset_ids')).toHaveLength(1);
        expect(callsTo('vec_db_metadata_chunk_asset_ids')[0][1]).toEqual({ archiveAt: null });
    });

    it('epoch=2: limit uygulanır', async () => {
        for (let i = 0; i < 5; i++) seedAsset(`a${i}`);
        db.run('DROP TABLE text_chunks');
        __setSchemaEpochForTesting(2);
        invokeMock.mockResolvedValueOnce([]); // hiçbirinde meta chunk yok

        const missing = await getAssetsMissingMetadataChunkAsync(3);
        expect(missing).toHaveLength(3);
    });

    it('epoch=2: invoke null → sql.js fallback (text_chunks DROP\'lu → [])', async () => {
        seedAsset('a1');
        db.run('DROP TABLE text_chunks');
        __setSchemaEpochForTesting(2);
        invokeMock.mockResolvedValue(null);

        const missing = await getAssetsMissingMetadataChunkAsync();
        expect(missing).toEqual([]);
        expect(callsTo('vec_db_metadata_chunk_asset_ids')).toHaveLength(1);
    });

    // ── deleteMetadataChunksFromVecDb ────────────────────────────────────

    it('deleteMetadataChunksFromVecDb → vec_db_delete_metadata_chunks invoke', async () => {
        __setSchemaEpochForTesting(2);
        invokeMock.mockResolvedValue(1);
        await deleteMetadataChunksFromVecDb('a1');
        expect(callsTo('vec_db_delete_metadata_chunks')).toHaveLength(1);
        expect(callsTo('vec_db_delete_metadata_chunks')[0][1]).toEqual({
            archiveAt: null,
            assetId: 'a1',
        });
    });
});
