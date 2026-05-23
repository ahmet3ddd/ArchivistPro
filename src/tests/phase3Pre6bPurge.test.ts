/**
 * V3 Faz 3 — PRE-6b testleri: purgeNonIndexableChunks yazma-yolu epoch routing.
 *
 * - epoch<2: BİREBİR eski sql.js yolu (victim = assets JOIN text_chunks).
 *   epoch=1'de embeddings vec.db'de → sql.js DELETE atlanır (crash YOK).
 * - epoch>=2: text_chunks vec.db'de → victim = non-indexable file_type (sql.js)
 *   ∩ body-chunk sayımları (`vec_db_body_chunk_counts`). Metadata-only
 *   non-indexable asset'ler purge EDİLMEZ.
 * - Silme her durumda `mirrorRagWriteToDisk` → `scan_write_batch`
 *   `delete_chunks_for` (PRE-3a epoch-aware) ile diske yansır.
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
} from '../services/database';
import { purgeNonIndexableChunks } from '../services/ragIndexStatus';

function callsTo(cmd: string) {
    return invokeMock.mock.calls.filter(([c]) => c === cmd);
}

function seedAsset(id: string, fileType: string) {
    upsertAsset({
        id,
        fileName: `${id}.x`,
        filePath: `C:/P/${id}.x`,
        fileSize: 10,
        fileType,
        category: '2D Çizim',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-06-15T12:00:00Z',
        projectName: 'P',
        projectPhase: 'Konsept',
    });
}

describe('Faz 3 PRE-6b — purgeNonIndexableChunks yazma routing', () => {
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

    function addChunk(id: string, assetId: string, chunkIndex: number) {
        db.run(
            `INSERT INTO text_chunks (id, asset_id, chunk_index, page, text, lang) VALUES (?,?,?,?,?,?)`,
            [id, assetId, chunkIndex, null, `text ${id}`, 'tr'],
        );
    }
    function addChunkEmb(id: string, assetId: string, refId: string) {
        db.run(
            `INSERT INTO embeddings (id, asset_id, ref_id, vector_blob, source) VALUES (?,?,?,?,?)`,
            [id, assetId, refId, new Uint8Array([1, 2, 3, 4]), 'chunk_text'],
        );
    }
    function count(sql: string): number {
        return db.exec(sql)[0].values[0][0] as number;
    }

    // ── epoch<2: sql.js yolu ─────────────────────────────────────────────

    it('epoch=0: non-indexable body chunk silinir; metadata + indexable korunur', async () => {
        seedAsset('dwg1', 'DWG');   // non-indexable + body chunk → victim
        seedAsset('dwg2', 'DWG');   // non-indexable, yalnız metadata → korunur
        seedAsset('pdf1', 'PDF');   // indexable → korunur
        addChunk('c1', 'dwg1', 0); addChunkEmb('e1', 'dwg1', 'c1');
        addChunk('m2', 'dwg2', -1); // metadata chunk
        addChunk('c3', 'pdf1', 0); addChunkEmb('e3', 'pdf1', 'c3');

        const r = await purgeNonIndexableChunks();
        expect(r).toEqual({ chunks: 1, embeddings: 1, assets: 1 });

        // dwg1 body chunk + emb sql.js'ten silindi
        expect(count(`SELECT COUNT(*) FROM text_chunks WHERE asset_id='dwg1'`)).toBe(0);
        expect(count(`SELECT COUNT(*) FROM embeddings WHERE asset_id='dwg1'`)).toBe(0);
        // dwg2 metadata + pdf1 body korundu
        expect(count(`SELECT COUNT(*) FROM text_chunks WHERE asset_id='dwg2'`)).toBe(1);
        expect(count(`SELECT COUNT(*) FROM text_chunks WHERE asset_id='pdf1'`)).toBe(1);
        // diske mirror — deleteChunksFor=['dwg1']
        const swb = callsTo('scan_write_batch');
        expect(swb).toHaveLength(1);
        expect((swb[0][1] as { payload: { delete_chunks_for: string[] } }).payload.delete_chunks_for).toEqual(['dwg1']);
    });

    it('epoch=0: temizlenecek çöp yok → {0,0,0}, mirror invoke YOK', async () => {
        seedAsset('pdf1', 'PDF');
        addChunk('c1', 'pdf1', 0);
        const r = await purgeNonIndexableChunks();
        expect(r).toEqual({ chunks: 0, embeddings: 0, assets: 0 });
        expect(callsTo('scan_write_batch')).toHaveLength(0);
    });

    it('epoch=1: embeddings vec.db\'de (DROP\'lu) → crash YOK, text_chunks silinir', async () => {
        seedAsset('dwg1', 'DWG');
        addChunk('c1', 'dwg1', 0);
        db.run('DROP TABLE embeddings'); // epoch>=1: embeddings vec.db'de
        __setSchemaEpochForTesting(1);

        const r = await purgeNonIndexableChunks();
        // chunk sql.js'ten sayılır+silinir; embeddings sayımı atlanır (kozmetik)
        expect(r).toEqual({ chunks: 1, embeddings: 0, assets: 1 });
        expect(count(`SELECT COUNT(*) FROM text_chunks WHERE asset_id='dwg1'`)).toBe(0);
        const swb = callsTo('scan_write_batch');
        expect(swb).toHaveLength(1);
        expect((swb[0][1] as { payload: { delete_chunks_for: string[] } }).payload.delete_chunks_for).toEqual(['dwg1']);
    });

    // ── epoch>=2: vec.db yolu ────────────────────────────────────────────

    it('epoch=2: victim = non-indexable ∩ vec_db_body_chunk_counts', async () => {
        seedAsset('dwg1', 'DWG');
        seedAsset('dwg2', 'DWG');   // metadata-only → body count'ta YOK
        seedAsset('pdf1', 'PDF');   // indexable → file_type filtresinde elenir
        db.run('DROP TABLE text_chunks');
        db.run('DROP TABLE embeddings');
        __setSchemaEpochForTesting(2);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_body_chunk_counts') {
                return Promise.resolve({
                    chunkCounts: [
                        { assetId: 'dwg1', count: 3 },
                        { assetId: 'pdf1', count: 5 }, // indexable → victim olmaz
                    ],
                    embedCounts: [{ assetId: 'dwg1', count: 2 }],
                });
            }
            if (cmd === 'scan_write_batch') return Promise.resolve({ chunks_deleted: 3 });
            return Promise.resolve(null);
        });

        const r = await purgeNonIndexableChunks();
        expect(r).toEqual({ chunks: 3, embeddings: 2, assets: 1 });
        const swb = callsTo('scan_write_batch');
        expect(swb).toHaveLength(1);
        expect((swb[0][1] as { payload: { delete_chunks_for: string[] } }).payload.delete_chunks_for).toEqual(['dwg1']);
    });

    it('epoch=2: vec_db_body_chunk_counts null → sql.js fallback boş → {0,0,0}', async () => {
        seedAsset('dwg1', 'DWG');
        db.run('DROP TABLE text_chunks');
        db.run('DROP TABLE embeddings');
        __setSchemaEpochForTesting(2);
        // invoke null (default) → getBodyChunkCountsAsync sql.js fallback;
        // text_chunks DROP'lu → boş map → victim yok.
        const r = await purgeNonIndexableChunks();
        expect(r).toEqual({ chunks: 0, embeddings: 0, assets: 0 });
        expect(callsTo('scan_write_batch')).toHaveLength(0);
        expect(callsTo('vec_db_body_chunk_counts')).toHaveLength(1);
    });
});
