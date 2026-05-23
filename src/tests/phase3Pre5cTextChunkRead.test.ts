/**
 * V3 Faz 3 — PRE-5c testleri: text_chunks OKUMA routing.
 *
 * - epoch<2: BİREBİR eski sync sql.js yolu (invoke YOK).
 * - epoch>=2: text_chunks vec.db'de → ilgili `vec_db_chunks_*` komutuna invoke.
 *   `getChunksByIdsAsync` ayrıca sql.js `assets`'ten file_name/file_path join'ler.
 * - invoke null → sync fallback.
 *
 * Gate `_schemaEpoch >= 2` (text_chunks epoch 2'de taşınır).
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
    _setDbForTesting,
    __setSchemaEpochForTesting,
    getChunksByIdsAsync,
    getChunksByAssetIdAsync,
    getChunkByIdAsync,
    getChunkCountByAssetIdAsync,
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

describe('Faz 3 PRE-5c — text_chunks okuma routing', () => {
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

    // ── epoch<2: sync sql.js yolu (BİREBİR, invoke YOK) ──────────────────

    it('epoch=0: getChunksByAssetIdAsync sql.js okur, invoke YOK', async () => {
        upsertAsset(makeAsset('a1'));
        upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'ilk' });
        upsertTextChunk({ id: 'a1_c1', assetId: 'a1', chunkIndex: 1, text: 'iki' });
        const r = await getChunksByAssetIdAsync('a1');
        expect(r).toHaveLength(2);
        expect(r[0].text).toBe('ilk');
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=1: text_chunks henüz taşınmadı (epoch>=2 gerekir) → sync yol', async () => {
        upsertAsset(makeAsset('a1'));
        upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'metin' });
        __setSchemaEpochForTesting(1);
        expect(await getChunkCountByAssetIdAsync('a1')).toBe(1);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=0: getChunkByIdAsync + getChunksByIdsAsync sql.js (assets join)', async () => {
        upsertAsset(makeAsset('a1'));
        upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'gövde' });
        const one = await getChunkByIdAsync('a1_c0');
        expect(one?.text).toBe('gövde');
        const many = await getChunksByIdsAsync(['a1_c0']);
        expect(many[0].fileName).toBe('a1.pdf');
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('boş chunk id listesi → [], invoke YOK', async () => {
        expect(await getChunksByIdsAsync([])).toEqual([]);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    // ── epoch>=2: vec.db invoke yolu ─────────────────────────────────────

    it('epoch=2: getChunkCountByAssetIdAsync vec_db_chunk_count invoke', async () => {
        invokeMock.mockResolvedValueOnce(296);
        __setSchemaEpochForTesting(2);
        expect(await getChunkCountByAssetIdAsync('a1')).toBe(296);
        expect(callsTo('vec_db_chunk_count')[0][1]).toEqual({
            archiveAt: null,
            assetId: 'a1',
        });
    });

    it('epoch=2: getChunksByAssetIdAsync vec_db_chunks_by_asset invoke', async () => {
        invokeMock.mockResolvedValueOnce([
            { id: 'c0', assetId: 'a1', chunkIndex: 0, page: 1, text: 'x', lang: 'tr' },
        ]);
        __setSchemaEpochForTesting(2);
        const r = await getChunksByAssetIdAsync('a1', 10);
        // asset_id alanı düşürülür (getChunksByAssetId kontratı)
        expect(r).toEqual([{ id: 'c0', chunkIndex: 0, page: 1, text: 'x', lang: 'tr' }]);
        expect(callsTo('vec_db_chunks_by_asset')[0][1]).toEqual({
            archiveAt: null,
            assetId: 'a1',
            limit: 10,
        });
    });

    it('epoch=2: getChunksByIdsAsync vec.db + sql.js assets join', async () => {
        // assets sql.js'te kalır → join için gerçek asset gerekli
        upsertAsset(makeAsset('a1'));
        invokeMock.mockResolvedValueOnce([
            { id: 'c0', assetId: 'a1', chunkIndex: 0, page: null, text: 'gövde', lang: null },
        ]);
        __setSchemaEpochForTesting(2);
        const r = await getChunksByIdsAsync(['c0']);
        expect(r).toHaveLength(1);
        expect(r[0].text).toBe('gövde');
        expect(r[0].fileName).toBe('a1.pdf');
        expect(r[0].filePath).toBe('C:/P/a1.pdf');
        expect(callsTo('vec_db_chunks_by_ids')).toHaveLength(1);
    });

    it('epoch=2: getChunkByIdAsync vec_db_chunks_by_ids tek satır', async () => {
        invokeMock.mockResolvedValueOnce([
            { id: 'c0', assetId: 'a1', chunkIndex: 0, page: null, text: 'tek', lang: null },
        ]);
        __setSchemaEpochForTesting(2);
        const one = await getChunkByIdAsync('c0');
        expect(one?.text).toBe('tek');
        expect(callsTo('vec_db_chunks_by_ids')[0][1]).toEqual({
            archiveAt: null,
            ids: ['c0'],
        });
    });

    // ── invoke null → sync fallback ──────────────────────────────────────

    it('epoch=2: invoke null → sync fallback (text_chunks DROP\'lu → 0)', async () => {
        db.run('DROP TABLE text_chunks');
        __setSchemaEpochForTesting(2);
        invokeMock.mockResolvedValue(null);
        expect(await getChunkCountByAssetIdAsync('a1')).toBe(0);
        expect(callsTo('vec_db_chunk_count')).toHaveLength(1);
    });
});
