/**
 * V3 Faz 3 — PRE-6d testleri: snapshot/restore (klasör-sil undo) yazma routing.
 *
 * - epoch<N: BİREBİR eski sql.js yolu.
 * - epoch>=1/2/3: embeddings/text_chunks/asset_relations vec.db'de →
 *   snapshot `vec_db_export_assets` ile yakalar, restore `vec_db_import_assets`
 *   ile geri yazar. sql.js `SELECT *`/`INSERT` "no such table" atmaz (crash YOK).
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
    addScannedRoot,
    snapshotScannedRootWithAssets,
    restoreScannedRootWithAssets,
    deleteScannedRootWithAssets,
    getAssetById,
    _setDbForTesting,
    __setSchemaEpochForTesting,
} from '../services/database';

function callsTo(cmd: string) {
    return invokeMock.mock.calls.filter(([c]) => c === cmd);
}

function seedAsset(id: string, filePath: string) {
    upsertAsset({
        id,
        fileName: `${id}.dwg`,
        filePath,
        fileSize: 10,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-06-15T12:00:00Z',
        projectName: 'P',
        projectPhase: 'Konsept',
    });
}

describe('Faz 3 PRE-6d — snapshot/restore yazma routing', () => {
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

    function count(sql: string): number {
        return db.exec(sql)[0].values[0][0] as number;
    }

    // ── epoch=0: sql.js yolu ─────────────────────────────────────────────

    it('epoch=0: snapshot+restore sql.js — vec_db_export/import invoke YOK', async () => {
        const rootId = addScannedRoot('C:/Proj');
        seedAsset('a1', 'C:/Proj/f.dwg');
        db.run(
            `INSERT INTO embeddings (id,asset_id,ref_id,vector_blob,source) VALUES (?,?,?,?,?)`,
            ['e1', 'a1', null, new Uint8Array([1, 2]), 'text'],
        );
        db.run(
            `INSERT INTO text_chunks (id,asset_id,chunk_index,page,text,lang) VALUES (?,?,?,?,?,?)`,
            ['c1', 'a1', 0, null, 'metin', 'tr'],
        );

        const snap = await snapshotScannedRootWithAssets(rootId);
        expect(snap!.assets).toHaveLength(1);
        expect(snap!.embeddings).toHaveLength(1);
        expect(snap!.textChunks).toHaveLength(1);
        expect(callsTo('vec_db_export_assets')).toHaveLength(0);

        deleteScannedRootWithAssets(rootId);
        expect(getAssetById('a1')).toBeNull();

        await restoreScannedRootWithAssets(snap!);
        expect(getAssetById('a1')).not.toBeNull();
        expect(count(`SELECT COUNT(*) FROM embeddings WHERE asset_id='a1'`)).toBe(1);
        expect(count(`SELECT COUNT(*) FROM text_chunks WHERE asset_id='a1'`)).toBe(1);
        expect(callsTo('vec_db_import_assets')).toHaveLength(0);
    });

    // ── epoch>=2/3: vec.db yolu ──────────────────────────────────────────

    it('epoch=3: snapshot vec_db_export_assets, restore vec_db_import_assets', async () => {
        const rootId = addScannedRoot('C:/Proj');
        seedAsset('a1', 'C:/Proj/f.dwg');
        db.run('DROP TABLE embeddings');
        db.run('DROP TABLE text_chunks');
        db.run('DROP TABLE asset_relations');
        __setSchemaEpochForTesting(3);

        const exported = {
            embeddings: [{ id: 'e1', asset_id: 'a1', ref_id: null, vector_blob: [1, 2], source: 'text' }],
            textChunks: [{ id: 'c1', asset_id: 'a1', chunk_index: 0, page: null, text: 'm', lang: 'tr' }],
            assetRelations: [{ id: 'r1', source_id: 'a1', target_id: 'a2', relation_type: 'x', notes: null, created_at: 't', created_by: 'auto' }],
        };
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_export_assets') return Promise.resolve(exported);
            return Promise.resolve(null); // vec_db_import_assets / scan_clear_assets / cascade
        });

        const snap = await snapshotScannedRootWithAssets(rootId);
        expect(snap!.embeddings).toEqual(exported.embeddings);
        expect(snap!.textChunks).toEqual(exported.textChunks);
        expect(snap!.assetRelations).toEqual(exported.assetRelations);
        expect(callsTo('vec_db_export_assets')[0][1]).toEqual({ archiveAt: null, assetIds: ['a1'] });

        deleteScannedRootWithAssets(rootId);
        expect(getAssetById('a1')).toBeNull();

        await restoreScannedRootWithAssets(snap!);
        expect(getAssetById('a1')).not.toBeNull(); // asset sql.js'e geri geldi
        const imp = callsTo('vec_db_import_assets');
        expect(imp).toHaveLength(1);
        expect(imp[0][1]).toEqual({
            archiveAt: null,
            data: {
                embeddings: exported.embeddings,
                textChunks: exported.textChunks,
                assetRelations: exported.assetRelations,
            },
        });
    });

    it('epoch=3: vec_db_export_assets null → snapshot V3 dizileri boş, crash YOK', async () => {
        const rootId = addScannedRoot('C:/Proj');
        seedAsset('a1', 'C:/Proj/f.dwg');
        db.run('DROP TABLE embeddings');
        db.run('DROP TABLE text_chunks');
        db.run('DROP TABLE asset_relations');
        __setSchemaEpochForTesting(3);
        invokeMock.mockResolvedValue(null); // export null

        const snap = await snapshotScannedRootWithAssets(rootId);
        expect(snap).not.toBeNull();
        expect(snap!.assets).toHaveLength(1);
        expect(snap!.embeddings).toEqual([]);
        expect(snap!.textChunks).toEqual([]);
        expect(snap!.assetRelations).toEqual([]);
    });

    it('epoch=2: text_chunks vec.db\'den, asset_relations hâlâ sql.js', async () => {
        const rootId = addScannedRoot('C:/Proj');
        seedAsset('a1', 'C:/Proj/f.dwg');
        db.run('DROP TABLE embeddings');
        db.run('DROP TABLE text_chunks');
        // asset_relations epoch<3 → sql.js'te kalır
        db.run(
            `INSERT INTO asset_relations (id,source_id,target_id,relation_type,notes,created_at,created_by) VALUES (?,?,?,?,?,?,?)`,
            ['r1', 'a1', 'a1', 'version_of', null, 't', 'auto'],
        );
        __setSchemaEpochForTesting(2);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_export_assets') return Promise.resolve({
                embeddings: [{ id: 'e1', asset_id: 'a1', ref_id: null, vector_blob: [1], source: 'text' }],
                textChunks: [{ id: 'c1', asset_id: 'a1', chunk_index: 0, page: null, text: 'm', lang: null }],
                assetRelations: [],
            });
            return Promise.resolve(null);
        });

        const snap = await snapshotScannedRootWithAssets(rootId);
        expect(snap!.embeddings).toHaveLength(1);     // epoch>=1 → vec.db export
        expect(snap!.textChunks).toHaveLength(1);     // epoch>=2 → vec.db export
        expect(snap!.assetRelations).toHaveLength(1); // epoch<3 → sql.js
    });
});
