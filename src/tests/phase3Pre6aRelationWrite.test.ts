/**
 * V3 Faz 3 — PRE-6a testleri: aynı-stem oto-ilişki YAZMA routing.
 *
 * - epoch<3: `detectAndSaveSameStemRelationsAsync` BİREBİR sync yola düşer
 *   (invoke YOK), `asset_relations`'a sql.js INSERT yapılır.
 * - epoch>=3: `asset_relations` vec.db'de yaşar →
 *   * duplicate-guard `vec_db_asset_relations` (assetId=null) ile vec.db'den,
 *   * inline sql.js `INSERT` atlanır (tablo DROP'lu olsa bile crash YOK),
 *   * `onCreate` yine her yeni ilişki için fire eder (eski SYNC sürümde
 *     `db.run` "no such table" atıp `onCreate`'i de keserdi — PRE-6a bug fix),
 *   * `onCreate` yoksa `scan_write_batch` (relations-only) ile self-persist.
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
    getAssetById,
    getRelationsForAsset,
    detectAndSaveSameStemRelations,
    detectAndSaveSameStemRelationsAsync,
    _setDbForTesting,
    __setSchemaEpochForTesting,
} from '../services/database';

function callsTo(cmd: string) {
    return invokeMock.mock.calls.filter(([c]) => c === cmd);
}

/** Aynı dizin + stem ('C:/P/plan.<ext>') ile bir asset seed et → gerçek Asset. */
function seedAsset(id: string, fileType: string, ext: string) {
    upsertAsset({
        id,
        fileName: `plan.${ext}`,
        filePath: `C:/P/plan.${ext}`,
        fileSize: 10,
        fileType,
        category: '2D Çizim',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-06-15T12:00:00Z',
        projectName: 'P',
        projectPhase: 'Konsept',
    });
    return getAssetById(id)!;
}

describe('Faz 3 PRE-6a — aynı-stem oto-ilişki yazma routing', () => {
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

    it('epoch=0: async sürüm sync yola düşer — sql.js INSERT, invoke YOK', async () => {
        const dwg = seedAsset('a1', 'DWG', 'dwg');
        const pdf = seedAsset('a2', 'PDF', 'pdf');
        const created = await detectAndSaveSameStemRelationsAsync([dwg, pdf]);
        expect(created).toBe(1);
        // sql.js asset_relations'a yazıldı → senkron okuma görür
        const rels = getRelationsForAsset('a1');
        expect(rels).toHaveLength(1);
        expect(rels[0].relationType).toBe('pdf_export');
        expect(invokeMock).not.toHaveBeenCalled();
    });

    it('epoch=0: sync detectAndSaveSameStemRelations birebir eski davranış', () => {
        const dwg = seedAsset('a1', 'DWG', 'dwg');
        const pdf = seedAsset('a2', 'PDF', 'pdf');
        expect(detectAndSaveSameStemRelations([dwg, pdf])).toBe(1);
        expect(getRelationsForAsset('a2')).toHaveLength(1);
        expect(invokeMock).not.toHaveBeenCalled();
    });

    // ── epoch>=3: vec.db yolu ────────────────────────────────────────────

    it('epoch=3: existingIds vec_db_asset_relations (assetId=null) ile okunur', async () => {
        const dwg = seedAsset('a1', 'DWG', 'dwg');
        const pdf = seedAsset('a2', 'PDF', 'pdf');
        db.run('DROP TABLE asset_relations'); // epoch>=3: tablo vec.db'de
        __setSchemaEpochForTesting(3);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_asset_relations') return Promise.resolve([]);
            if (cmd === 'scan_write_batch') return Promise.resolve({ relations_written: 1 });
            return Promise.resolve(null);
        });

        const created = await detectAndSaveSameStemRelationsAsync([dwg, pdf]);
        expect(created).toBe(1);
        expect(callsTo('vec_db_asset_relations')).toHaveLength(1);
        expect(callsTo('vec_db_asset_relations')[0][1]).toEqual({
            archiveAt: null,
            assetId: null,
        });
    });

    it('epoch=3: asset_relations DROP\'lu olsa bile crash YOK + onCreate fire eder', async () => {
        const dwg = seedAsset('a1', 'DWG', 'dwg');
        const pdf = seedAsset('a2', 'PDF', 'pdf');
        db.run('DROP TABLE asset_relations');
        __setSchemaEpochForTesting(3);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_asset_relations') return Promise.resolve([]);
            return Promise.resolve(null);
        });

        const onCreate = vi.fn();
        // skipSave:true → fileScanner kontratı; caller (writeBuffer) persist eder
        const created = await detectAndSaveSameStemRelationsAsync(
            [dwg, pdf], onCreate, { skipSave: true },
        );
        expect(created).toBe(1);
        // inline sql.js INSERT "no such table" atmadı → onCreate KESİNTİSİZ fire
        expect(onCreate).toHaveBeenCalledTimes(1);
        expect(onCreate.mock.calls[0][0]).toMatchObject({
            id: 'a1:a2:pdf_export',
            sourceId: 'a1',
            targetId: 'a2',
            relationType: 'pdf_export',
            createdBy: 'auto',
        });
        // skipSave:true → fonksiyon kendi persist etmez
        expect(callsTo('scan_write_batch')).toHaveLength(0);
    });

    it('epoch=3: onCreate yok → scan_write_batch ile self-persist', async () => {
        const dwg = seedAsset('a1', 'DWG', 'dwg');
        const pdf = seedAsset('a2', 'PDF', 'pdf');
        db.run('DROP TABLE asset_relations');
        __setSchemaEpochForTesting(3);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_asset_relations') return Promise.resolve([]);
            if (cmd === 'scan_write_batch') return Promise.resolve({ relations_written: 1 });
            return Promise.resolve(null);
        });

        const created = await detectAndSaveSameStemRelationsAsync([dwg, pdf]);
        expect(created).toBe(1);
        const swb = callsTo('scan_write_batch');
        expect(swb).toHaveLength(1);
        const args = swb[0][1] as { payload: any; archiveAt: unknown };
        expect(args.archiveAt).toBeNull();
        expect(args.payload.assets).toEqual([]);
        expect(args.payload.relations).toHaveLength(1);
        expect(args.payload.relations[0]).toMatchObject({
            id: 'a1:a2:pdf_export',
            source_id: 'a1',
            target_id: 'a2',
            relation_type: 'pdf_export',
            created_by: 'auto',
        });
        expect(typeof args.payload.relations[0].created_at).toBe('string');
    });

    it('epoch=3: duplicate guard — ilişki vec.db\'de varsa created=0, onCreate fire ETMEZ', async () => {
        const dwg = seedAsset('a1', 'DWG', 'dwg');
        const pdf = seedAsset('a2', 'PDF', 'pdf');
        db.run('DROP TABLE asset_relations');
        __setSchemaEpochForTesting(3);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_asset_relations') {
                return Promise.resolve([
                    {
                        id: 'a1:a2:pdf_export',
                        sourceId: 'a1',
                        targetId: 'a2',
                        relationType: 'pdf_export',
                        notes: null,
                        createdAt: 't',
                        createdBy: 'auto',
                    },
                ]);
            }
            return Promise.resolve(null);
        });

        const onCreate = vi.fn();
        const created = await detectAndSaveSameStemRelationsAsync([dwg, pdf], onCreate);
        expect(created).toBe(0);
        expect(onCreate).not.toHaveBeenCalled();
        expect(callsTo('scan_write_batch')).toHaveLength(0);
    });

    it('epoch=3: vec_db_asset_relations null → sql.js fallback (DROP\'lu → boş guard)', async () => {
        const dwg = seedAsset('a1', 'DWG', 'dwg');
        const pdf = seedAsset('a2', 'PDF', 'pdf');
        db.run('DROP TABLE asset_relations');
        __setSchemaEpochForTesting(3);
        // vec_db_asset_relations null → _getAllRelationIdsAsync sql.js'e düşer;
        // tablo DROP'lu → _getAllRelationIds catch → boş Set → ilişki yine üretilir.
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'scan_write_batch') return Promise.resolve({ relations_written: 1 });
            return Promise.resolve(null);
        });

        const created = await detectAndSaveSameStemRelationsAsync([dwg, pdf]);
        expect(created).toBe(1);
        expect(callsTo('vec_db_asset_relations')).toHaveLength(1);
        expect(callsTo('scan_write_batch')).toHaveLength(1);
    });
});
