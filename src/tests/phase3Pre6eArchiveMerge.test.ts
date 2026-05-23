/**
 * V3 Faz 3 — PRE-6e testleri: cross-archive merge (Join/Extract) epoch routing.
 *
 * `joinArchives`/`extractAssets` epoch>=N'de embedding/text_chunk'u kaybediyordu:
 * kaynak okuma sql.js'ten boş (tablo DROP'lu), hedef yazma global `_schemaEpoch`
 * guard'lı NOOP. `copyV3Data` kaynağı VE hedefi `getArchiveSchemaEpoch` ile ayrı
 * epoch-aware ele alır: epoch>=N → vec.db (`vec_db_export/import_assets`), aksi
 * sql.js. Pratikte yalnız `main` epoch>0 olabilir.
 *
 * NOT: joinArchives/extractAssets için bu dosya aynı zamanda ilk test kapsamı.
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
vi.mock('../services/rootTagService', () => ({ setRootTagDb: vi.fn() }));
vi.mock('../services/messageService', () => ({ setMessageDb: vi.fn() }));
vi.mock('../services/userService', () => ({ setUserDb: vi.fn() }));

import {
    upsertAsset,
    setActiveArchive,
    _setDbForTesting,
    _registerArchiveForTesting,
    __setSchemaEpochForTesting,
} from '../services/database';
import { joinArchives, extractAssets, type JoinOptions } from '../services/archiveOps';

function callsTo(cmd: string) {
    return invokeMock.mock.calls.filter(([c]) => c === cmd);
}

const F32 = [1, 2, 0.5]; // tam-temsil-edilebilir f32 — bayt round-trip için
function f32Bytes(vals: number[] = F32): number[] {
    return Array.from(new Uint8Array(new Float32Array(vals).buffer));
}

describe('Faz 3 PRE-6e — cross-archive merge yazma routing', () => {
    let mainDb: any;
    let xDb: any;

    beforeEach(async () => {
        mainDb = await createTestDatabase();
        xDb = await createTestDatabase();
        _setDbForTesting(mainDb);                     // 'main' + aktif
        _registerArchiveForTesting('archive_x', xDb); // ek arşiv
        invokeMock.mockReset();
        invokeMock.mockResolvedValue(null);
        __setSchemaEpochForTesting(0);
    });

    afterEach(() => {
        setActiveArchive('main');
        _registerArchiveForTesting('archive_x', null);
        _setDbForTesting(null);
        __setSchemaEpochForTesting(0);
        mainDb.close();
        xDb.close();
    });

    function makeAsset(id: string) {
        return {
            id, fileName: `${id}.dwg`, filePath: `C:/P/${id}.dwg`,
            fileSize: 10, fileType: 'DWG', category: '2D Çizim',
            createdAt: '2024-01-01T00:00:00Z', modifiedAt: '2024-06-15T12:00:00Z',
            projectName: 'P', projectPhase: 'Konsept',
        };
    }
    /** Asset'i belirli arşive ekler (aktif arşivi geçici değiştirir). */
    function seedAsset(archiveId: string, id: string) {
        setActiveArchive(archiveId);
        upsertAsset(makeAsset(id));
        setActiveArchive('main');
    }
    function seedEmbedding(db: any, id: string, assetId: string, refId: string | null, source: string) {
        db.run(
            `INSERT INTO embeddings (id, asset_id, ref_id, vector_json, vector_blob, source) VALUES (?,?,?,'',?,?)`,
            [id, assetId, refId, new Uint8Array(f32Bytes()), source],
        );
    }
    function seedChunk(db: any, id: string, assetId: string, text: string) {
        db.run(
            `INSERT INTO text_chunks (id, asset_id, chunk_index, page, text, lang) VALUES (?,?,?,?,?,?)`,
            [id, assetId, 0, null, text, 'tr'],
        );
    }
    /** Test db'sini epoch=3'e simüle et — V3-eligible tabloları DROP + user_version. */
    function simulateEpoch3(db: any) {
        db.run('DROP TABLE embeddings');
        db.run('DROP TABLE text_chunks');
        db.run('DROP TABLE asset_relations');
        db.run('PRAGMA user_version = 3');
    }
    function count(db: any, sql: string): number {
        return db.exec(sql)[0].values[0][0] as number;
    }
    function joinOpts(sourceId: string, targetId: string, over: Partial<JoinOptions> = {}): JoinOptions {
        return {
            sourceId, targetId, conflictStrategy: 'keep_newer',
            includeEmbeddings: true, includeTags: false, includeFavorites: false,
            includeTextChunks: true, includeSummaries: false,
            ...over,
        };
    }

    // ── epoch 0 ↔ 0: sql.js yolu (regresyon guard) ───────────────────────

    it('epoch 0↔0 join: embeddings+chunks sql.js\'e gider, vec_db invoke YOK', async () => {
        seedAsset('main', 's1');
        seedEmbedding(mainDb, 'e1', 's1', null, 'text');
        seedChunk(mainDb, 'c1', 's1', 'metin');

        const r = await joinArchives(joinOpts('main', 'archive_x'));
        expect(r.errors).toEqual([]);
        expect(r.embeddingsCopied).toBe(1);
        expect(r.chunksCopied).toBe(1);
        expect(count(xDb, `SELECT COUNT(*) FROM embeddings WHERE asset_id='s1'`)).toBe(1);
        expect(count(xDb, `SELECT COUNT(*) FROM text_chunks WHERE asset_id='s1'`)).toBe(1);
        expect(callsTo('vec_db_export_assets')).toHaveLength(0);
        expect(callsTo('vec_db_import_assets')).toHaveLength(0);
    });

    // ── main(epoch3) → ek(epoch0): kaynak vec.db, hedef sql.js ───────────

    it('main(epoch3) → ek(epoch0) join: vec_db_export_assets + hedef sql.js dolar', async () => {
        seedAsset('main', 's1');
        simulateEpoch3(mainDb);
        __setSchemaEpochForTesting(3);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_export_assets') {
                return Promise.resolve({
                    embeddings: [{ id: 'e1', asset_id: 's1', ref_id: null, vector_blob: f32Bytes(), source: 'text' }],
                    textChunks: [{ id: 'c1', asset_id: 's1', chunk_index: 0, page: null, text: 'metin', lang: 'tr' }],
                    assetRelations: [],
                });
            }
            return Promise.resolve(null);
        });

        const r = await joinArchives(joinOpts('main', 'archive_x'));
        expect(r.embeddingsCopied).toBe(1);
        expect(r.chunksCopied).toBe(1);
        // kaynak main → archiveAt: null ile export
        expect(callsTo('vec_db_export_assets')).toHaveLength(1);
        expect((callsTo('vec_db_export_assets')[0][1] as { archiveAt: unknown }).archiveAt).toBeNull();
        // hedef epoch0 → import YOK, sql.js'e yazıldı
        expect(callsTo('vec_db_import_assets')).toHaveLength(0);
        expect(count(xDb, `SELECT COUNT(*) FROM text_chunks WHERE id='c1'`)).toBe(1);
        // vector_blob baytları korundu
        const blob = xDb.exec(`SELECT vector_blob FROM embeddings WHERE id='e1'`)[0].values[0][0];
        expect(Array.from(blob as Uint8Array)).toEqual(f32Bytes());
    });

    // ── ek(epoch0) → main(epoch3): kaynak sql.js, hedef vec.db ───────────

    it('ek(epoch0) → main(epoch3) join: vec_db_import_assets EmbeddingRow şekliyle', async () => {
        seedAsset('archive_x', 's1');
        seedEmbedding(xDb, 'e1', 's1', null, 'text');
        seedChunk(xDb, 'c1', 's1', 'metin');
        simulateEpoch3(mainDb);
        __setSchemaEpochForTesting(3);

        const r = await joinArchives(joinOpts('archive_x', 'main'));
        expect(r.embeddingsCopied).toBe(1);
        expect(r.chunksCopied).toBe(1);
        expect(callsTo('vec_db_export_assets')).toHaveLength(0); // kaynak epoch0
        const imp = callsTo('vec_db_import_assets');
        expect(imp).toHaveLength(1); // tek birleşik çağrı
        const data = (imp[0][1] as { archiveAt: unknown; data: any }).data;
        expect((imp[0][1] as { archiveAt: unknown }).archiveAt).toBeNull(); // hedef main
        // EmbeddingRow şekli: snake_case, vector_blob ham number[]
        expect(data.embeddings).toHaveLength(1);
        expect(data.embeddings[0]).toMatchObject({ id: 'e1', asset_id: 's1', ref_id: null, source: 'text' });
        expect(data.embeddings[0].vector_blob).toEqual(f32Bytes());
        expect(data.textChunks).toHaveLength(1);
        expect(data.textChunks[0]).toMatchObject({ id: 'c1', asset_id: 's1', chunk_index: 0, text: 'metin' });
    });

    // ── extract: main(epoch3) → mevcut ek(epoch0) ────────────────────────

    it('extract main(epoch3) → mevcut ek(epoch0): vec_db_export + hedef sql.js', async () => {
        seedAsset('main', 's1');
        simulateEpoch3(mainDb);
        __setSchemaEpochForTesting(3);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_export_assets') {
                return Promise.resolve({
                    embeddings: [{ id: 'e1', asset_id: 's1', ref_id: null, vector_blob: f32Bytes(), source: 'text' }],
                    textChunks: [{ id: 'c1', asset_id: 's1', chunk_index: 0, page: null, text: 'm', lang: 'tr' }],
                    assetRelations: [],
                });
            }
            return Promise.resolve(null);
        });

        const r = await extractAssets({
            sourceId: 'main',
            targetMode: 'existing',
            existingTargetId: 'archive_x',
            filter: {},
            mode: 'copy',
            includeEmbeddings: true,
            includeTextChunks: true,
            includeTags: false,
            includeSummaries: false,
            includeFavorites: false,
        });
        expect(r.embeddingsCopied).toBe(1);
        expect(r.chunksCopied).toBe(1);
        expect(callsTo('vec_db_export_assets')).toHaveLength(1);
        expect(count(xDb, `SELECT COUNT(*) FROM embeddings WHERE id='e1'`)).toBe(1);
        expect(count(xDb, `SELECT COUNT(*) FROM text_chunks WHERE id='c1'`)).toBe(1);
    });

    // ── keep_both: idMap remap — kopyalanan embedding yeni asset_id alır ──

    it('keep_both join: çakışan asset rename → embedding asset_id remap', async () => {
        seedAsset('main', 's1');
        seedAsset('archive_x', 's1'); // hedefte de var → çakışma
        seedEmbedding(mainDb, 'e1', 's1', null, 'text');

        const r = await joinArchives(joinOpts('main', 'archive_x', { conflictStrategy: 'keep_both' }));
        expect(r.renamed).toBe(1);
        expect(r.embeddingsCopied).toBe(1);
        // e1'in asset_id'si remap edildi — 's1' DEĞİL, hedefteki yeni asset
        const newAssetId = xDb.exec(`SELECT asset_id FROM embeddings WHERE id='e1'`)[0].values[0][0] as string;
        expect(newAssetId).not.toBe('s1');
        expect(count(xDb, `SELECT COUNT(*) FROM assets WHERE id='${newAssetId}'`)).toBe(1);
    });

    // ── skip_existing: atlanan asset'in V3 verisi kopyalanmaz ────────────

    it('skip_existing join: atlanan asset\'in embedding\'i kopyalanmaz', async () => {
        seedAsset('main', 's1');
        seedAsset('archive_x', 's1'); // hedefte var → skip
        seedEmbedding(mainDb, 'e1', 's1', null, 'text');

        const r = await joinArchives(joinOpts('main', 'archive_x', { conflictStrategy: 'skip_existing' }));
        expect(r.skipped).toBe(1);
        expect(r.embeddingsCopied).toBe(0);
        expect(count(xDb, `SELECT COUNT(*) FROM embeddings`)).toBe(0);
    });

    // ── vec_db_export_assets null → crash YOK, non-fatal hata ────────────

    it('main(epoch3) → ek(epoch0): vec_db_export_assets null → crash YOK, hata kaydedilir', async () => {
        seedAsset('main', 's1');
        simulateEpoch3(mainDb);
        __setSchemaEpochForTesting(3);
        invokeMock.mockResolvedValue(null); // export null

        const r = await joinArchives(joinOpts('main', 'archive_x'));
        expect(r.embeddingsCopied).toBe(0);
        expect(r.chunksCopied).toBe(0);
        expect(r.errors.some((e) => e.includes('vec_db_export_assets null'))).toBe(true);
        // join yine de tamamlandı — asset taşındı
        expect(count(xDb, `SELECT COUNT(*) FROM assets WHERE id='s1'`)).toBe(1);
    });
});
