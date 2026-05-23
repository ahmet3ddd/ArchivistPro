/**
 * V3 Faz 3 — PRE-5e testleri: asset_relations OKUMA routing.
 *
 * - epoch<3: BİREBİR eski sync sql.js yolu (invoke YOK).
 * - epoch>=3: asset_relations vec.db'de → `vec_db_asset_relations` invoke.
 * - invoke null → sync fallback.
 *
 * Gate `_schemaEpoch >= 3` (asset_relations epoch 3'te taşınır).
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
    addAssetRelation,
    _setDbForTesting,
    __setSchemaEpochForTesting,
    getRelationsForAssetAsync,
} from '../services/database';

function callsTo(cmd: string) {
    return invokeMock.mock.calls.filter(([c]) => c === cmd);
}
function makeAsset(id: string) {
    return {
        id,
        fileName: `${id}.dwg`,
        filePath: `C:/P/${id}.dwg`,
        fileSize: 10,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-06-15T12:00:00Z',
        projectName: 'P',
        projectPhase: 'K',
    };
}

describe('Faz 3 PRE-5e — asset_relations okuma routing', () => {
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

    // ── epoch<3: sync sql.js yolu (invoke YOK) ───────────────────────────

    it('epoch=0: getRelationsForAssetAsync sql.js okur, invoke YOK', async () => {
        upsertAsset(makeAsset('a1'));
        upsertAsset(makeAsset('a2'));
        addAssetRelation({
            sourceId: 'a1',
            targetId: 'a2',
            relationType: 'version_of',
            createdAt: '2024-01-01T00:00:00Z',
            createdBy: 'user',
        });
        const r = await getRelationsForAssetAsync('a1');
        expect(r).toHaveLength(1);
        expect(r[0].targetId).toBe('a2');
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=2: hâlâ sync (asset_relations epoch>=3 taşınır)', async () => {
        __setSchemaEpochForTesting(2);
        await getRelationsForAssetAsync('a1');
        expect(invokeMock).not.toHaveBeenCalled();
    });

    // ── epoch>=3: vec.db invoke yolu ─────────────────────────────────────

    it('epoch=3: getRelationsForAssetAsync vec_db_asset_relations invoke', async () => {
        invokeMock.mockResolvedValueOnce([
            {
                id: 'r1',
                sourceId: 'a1',
                targetId: 'a2',
                relationType: 'pdf_export',
                notes: null,
                createdAt: 't',
                createdBy: 'auto',
            },
        ]);
        __setSchemaEpochForTesting(3);
        const r = await getRelationsForAssetAsync('a1');
        expect(r).toEqual([
            {
                id: 'r1',
                sourceId: 'a1',
                targetId: 'a2',
                relationType: 'pdf_export',
                notes: undefined,
                createdAt: 't',
                createdBy: 'auto',
            },
        ]);
        expect(callsTo('vec_db_asset_relations')[0][1]).toEqual({
            archiveAt: null,
            assetId: 'a1',
        });
    });

    // ── invoke null → sync fallback ──────────────────────────────────────

    it('epoch=3: invoke null → sync fallback (asset_relations DROP\'lu → [])', async () => {
        db.run('DROP TABLE asset_relations');
        __setSchemaEpochForTesting(3);
        invokeMock.mockResolvedValue(null);
        const r = await getRelationsForAssetAsync('a1');
        expect(r).toEqual([]);
        expect(callsTo('vec_db_asset_relations')).toHaveLength(1);
    });
});
