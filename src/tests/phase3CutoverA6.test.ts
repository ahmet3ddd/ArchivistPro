/**
 * V3 Faz 3 — Adım A6-PRE-1 testleri: `_applySchema` epoch-aware + init
 * order fix + direct-save guards.
 *
 * A6 ASKISININ ROOT CAUSE'i (2026-05-20): `_applySchema` koşulsuz
 * `CREATE TABLE IF NOT EXISTS embeddings/text_chunks/asset_relations`
 * çalıştırıyordu → migrasyon sonrası bir sonraki açılışta DROP'lu
 * tabloları BOŞ yeniden yarattı → sql.js'in boş tablolarına yazma →
 * çift kaynaklı veri → FTS bozuldu.
 *
 * Bu testler tabloların epoch>=N'de yaratılmadığını ve direct save
 * helper'larının NOOP olduğunu kanıtlar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import initSqlJs from 'sql.js';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.resolve(null)),
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
vi.mock('../appVersion', () => ({ APP_VERSION: '2.4.10' }));

import {
    _applySchemaForTesting,
    _applyMigrationsForTesting,
    _setDbForTesting,
    __setSchemaEpochForTesting,
    saveEmbedding,
    saveChunkEmbedding,
    upsertTextChunk,
    deleteTextChunksByAssetId,
} from '../services/database';

async function makeRawSqlJsDb(): Promise<any> {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON');
    return db;
}

function tableExists(db: any, name: string): boolean {
    const res = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`);
    return !!(res?.[0]?.values?.length);
}

function indexExists(db: any, name: string): boolean {
    const res = db.exec(`SELECT name FROM sqlite_master WHERE type='index' AND name='${name}'`);
    return !!(res?.[0]?.values?.length);
}

function countRows(db: any, table: string, where: string = '1=1'): number {
    const res = db.exec(`SELECT COUNT(*) FROM ${table} WHERE ${where}`);
    return Number(res?.[0]?.values?.[0]?.[0] ?? 0);
}

// FK ile uyumlu minimal asset insert.
function insertMinAsset(db: any, id: string): void {
    db.run(
        `INSERT INTO assets (id, file_name, file_path, file_type, category, created_at, modified_at)
     VALUES (?, ?, ?, 'txt', 'document', '2026-01-01', '2026-01-01')`,
        [id, `${id}.txt`, `/${id}.txt`]
    );
}

describe('Faz 3 A6-PRE-1 — _applySchema epoch-aware', () => {
    it('epoch=0 → 3 V3-eligible tablo + 6 index VAR (mevcut davranış birebir)', async () => {
        const db = await makeRawSqlJsDb();
        _applySchemaForTesting(db, 0);

        // Tablolar
        expect(tableExists(db, 'embeddings')).toBe(true);
        expect(tableExists(db, 'text_chunks')).toBe(true);
        expect(tableExists(db, 'asset_relations')).toBe(true);
        // İndeksler
        expect(indexExists(db, 'idx_embeddings_asset')).toBe(true);
        expect(indexExists(db, 'idx_embeddings_source')).toBe(true);
        expect(indexExists(db, 'idx_embeddings_ref')).toBe(true);
        expect(indexExists(db, 'idx_chunks_asset')).toBe(true);
        expect(indexExists(db, 'idx_relations_source')).toBe(true);
        expect(indexExists(db, 'idx_relations_target')).toBe(true);
        // Core (her zaman var)
        expect(tableExists(db, 'assets')).toBe(true);
        expect(tableExists(db, 'scanned_roots')).toBe(true);
        expect(tableExists(db, 'tags')).toBe(true);
    });

    it('epoch=1 → embeddings + 3 index YOK; text_chunks ve asset_relations VAR', async () => {
        const db = await makeRawSqlJsDb();
        _applySchemaForTesting(db, 1);

        // Embeddings (epoch>=1 → vec.db'de)
        expect(tableExists(db, 'embeddings')).toBe(false);
        expect(indexExists(db, 'idx_embeddings_asset')).toBe(false);
        expect(indexExists(db, 'idx_embeddings_source')).toBe(false);
        expect(indexExists(db, 'idx_embeddings_ref')).toBe(false);
        // Diğer V3-eligible hala main'de
        expect(tableExists(db, 'text_chunks')).toBe(true);
        expect(indexExists(db, 'idx_chunks_asset')).toBe(true);
        expect(tableExists(db, 'asset_relations')).toBe(true);
        expect(indexExists(db, 'idx_relations_source')).toBe(true);
        // Core sabit
        expect(tableExists(db, 'assets')).toBe(true);
    });

    it('epoch=2 → embeddings + text_chunks + ilgili index YOK; asset_relations VAR', async () => {
        const db = await makeRawSqlJsDb();
        _applySchemaForTesting(db, 2);

        expect(tableExists(db, 'embeddings')).toBe(false);
        expect(tableExists(db, 'text_chunks')).toBe(false);
        expect(indexExists(db, 'idx_embeddings_asset')).toBe(false);
        expect(indexExists(db, 'idx_chunks_asset')).toBe(false);
        // asset_relations hala main'de
        expect(tableExists(db, 'asset_relations')).toBe(true);
        expect(indexExists(db, 'idx_relations_source')).toBe(true);
        expect(indexExists(db, 'idx_relations_target')).toBe(true);
    });

    it('epoch=3 → 3 V3-eligible tablo + 6 index hiçbiri YOK (A6 askısı senaryosu)', async () => {
        const db = await makeRawSqlJsDb();
        _applySchemaForTesting(db, 3);

        // Hiçbir V3-eligible yaratılmamalı
        expect(tableExists(db, 'embeddings')).toBe(false);
        expect(tableExists(db, 'text_chunks')).toBe(false);
        expect(tableExists(db, 'asset_relations')).toBe(false);
        expect(indexExists(db, 'idx_embeddings_asset')).toBe(false);
        expect(indexExists(db, 'idx_embeddings_source')).toBe(false);
        expect(indexExists(db, 'idx_embeddings_ref')).toBe(false);
        expect(indexExists(db, 'idx_chunks_asset')).toBe(false);
        expect(indexExists(db, 'idx_relations_source')).toBe(false);
        expect(indexExists(db, 'idx_relations_target')).toBe(false);
        // Core bozulmadı
        expect(tableExists(db, 'assets')).toBe(true);
        expect(tableExists(db, 'audit_log')).toBe(true);
        expect(tableExists(db, 'tags')).toBe(true);
    });

    it('_applyMigrations asset_relations fallback CREATE de epoch>=3\'te skip', async () => {
        // _applyMigrations (database.ts:~1124) try/catch içinde asset_relations
        // CREATE TABLE'ı tekrar dener (eski DB'ler için fallback). Bu da
        // epoch-aware olmalı — yoksa A6 askısı senaryosu yine olur.
        const db = await makeRawSqlJsDb();
        __setSchemaEpochForTesting(3);
        _applySchemaForTesting(db, 3);
        _applyMigrationsForTesting(db);
        expect(tableExists(db, 'asset_relations')).toBe(false);
    });

    it('epoch=0 → idempotent: aynı db\'ye 2 kez uygulamak tablolari bozmaz', async () => {
        const db = await makeRawSqlJsDb();
        _applySchemaForTesting(db, 0);
        _applySchemaForTesting(db, 0);
        expect(tableExists(db, 'embeddings')).toBe(true);
        expect(tableExists(db, 'text_chunks')).toBe(true);
        expect(tableExists(db, 'asset_relations')).toBe(true);
    });
});

describe('Faz 3 A6-PRE-1 — direct save helper guards', () => {
    let db: any;

    beforeEach(async () => {
        // epoch=0 ile başlat (mevcut davranış); her test kendi epoch'unu set eder.
        db = await makeRawSqlJsDb();
        _applySchemaForTesting(db, 0);
        _applyMigrationsForTesting(db);
        _setDbForTesting(db);
        __setSchemaEpochForTesting(0);
    });

    it('saveEmbedding epoch=0 → embeddings\'a yazar', () => {
        insertMinAsset(db, 'a1');
        saveEmbedding('a1', [0.1, 0.2, 0.3], 'text');
        expect(countRows(db, 'embeddings', "asset_id='a1'")).toBe(1);
    });

    it('saveEmbedding epoch>=1 → NOOP (sql.js\'e dokunmaz)', () => {
        insertMinAsset(db, 'a2');
        // epoch=0'da ekle, sonra 1'e geç → ikinci save NOOP olmalı.
        saveEmbedding('a2', [0.1], 'text');
        __setSchemaEpochForTesting(1);
        saveEmbedding('a2', [0.2], 'image_global');
        // Hala sadece 1 satır (epoch=1'deki ikinci insert atlandı).
        expect(countRows(db, 'embeddings', "asset_id='a2'")).toBe(1);
    });

    it('saveChunkEmbedding epoch>=1 → NOOP', () => {
        insertMinAsset(db, 'a3');
        __setSchemaEpochForTesting(1);
        saveChunkEmbedding('a3', 'a3_c0', [0.4, 0.5], 'chunk_text');
        expect(countRows(db, 'embeddings', "asset_id='a3'")).toBe(0);
    });

    it('upsertTextChunk epoch>=2 → NOOP; epoch=1\'de hala yazar', () => {
        insertMinAsset(db, 'a4');
        __setSchemaEpochForTesting(1);
        upsertTextChunk({ id: 'a4_c0', assetId: 'a4', chunkIndex: 0, text: 'hello' });
        expect(countRows(db, 'text_chunks', "asset_id='a4'")).toBe(1);

        __setSchemaEpochForTesting(2);
        upsertTextChunk({ id: 'a4_c1', assetId: 'a4', chunkIndex: 1, text: 'world' });
        // epoch=2'deki ikinci insert atlandı → hala 1 satır.
        expect(countRows(db, 'text_chunks', "asset_id='a4'")).toBe(1);
    });

    it('deleteTextChunksByAssetId epoch>=2 → NOOP (no "no such table" hatası)', () => {
        insertMinAsset(db, 'a5');
        upsertTextChunk({ id: 'a5_c0', assetId: 'a5', chunkIndex: 0, text: 'hello' });
        expect(countRows(db, 'text_chunks', "asset_id='a5'")).toBe(1);

        __setSchemaEpochForTesting(2);
        // epoch>=2'de fonksiyon NOOP; sql.js'teki tabloya dokunmaz.
        deleteTextChunksByAssetId('a5');
        expect(countRows(db, 'text_chunks', "asset_id='a5'")).toBe(1);
    });
});

describe('Faz 3 A6-PRE-1 — init order regresyon', () => {
    // Bu test A6 askısının ROOT CAUSE'ünü kilitler: PRAGMA user_version
    // okuma ile _applySchema arasındaki yarış. initDatabase artık ÖNCE
    // PRAGMA okuyor → _applySchema(db, epoch) çağırıyor → DROP'lu tablolar
    // yeniden yaratılmaz. Bu testte aynı sırayı manuel simüle ediyoruz.

    it('epoch=2 olan blob yüklendiğinde text_chunks yeniden CREATE edilmez', async () => {
        // Önce epoch=2 olan bir blob hazırla.
        const SQL = await initSqlJs();
        const seedDb = new SQL.Database();
        seedDb.run('PRAGMA user_version = 2');
        const blobBytes = seedDb.export();
        seedDb.close();

        // Reload akışı: PRAGMA oku → _applySchema(epoch). text_chunks
        // tablosu seedDb'de yok (DROP edilmiş gibi); _applySchema'nın
        // yeniden create etmemesi gerek.
        const reloadedDb = new SQL.Database(blobBytes);
        reloadedDb.run('PRAGMA foreign_keys = ON');

        // initDatabase'deki sıraya birebir uy: önce PRAGMA, sonra schema.
        const uv = reloadedDb.exec('PRAGMA user_version');
        const v = uv?.[0]?.values?.[0]?.[0];
        const epoch = typeof v === 'number' ? v : 0;
        expect(epoch).toBe(2);

        _applySchemaForTesting(reloadedDb as any, epoch);

        // text_chunks ve embeddings: epoch=2 → main'den DROP'lu kalır.
        expect(tableExists(reloadedDb, 'embeddings')).toBe(false);
        expect(tableExists(reloadedDb, 'text_chunks')).toBe(false);
        // asset_relations hala main'de.
        expect(tableExists(reloadedDb, 'asset_relations')).toBe(true);
        // Core tablolar yaratıldı (assets, vs.).
        expect(tableExists(reloadedDb, 'assets')).toBe(true);

        reloadedDb.close();
    });
});
