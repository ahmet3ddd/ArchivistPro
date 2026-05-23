/**
 * V3 Faz 3 — Adım A4 testleri: asset DELETE → `vec_db_cascade_delete` invoke
 * + sql.js cascade'in DROP'lu tabloları skip etmesi.
 *
 * - Default (epoch=0): davranış BİREBİR korunur (invoke YOK, tüm sql.js DELETE'leri çalışır).
 * - epoch>=1: embeddings tablosu DROP edilmiş; cascade skip + invoke fire.
 * - epoch>=2: text_chunks da DROP; cascade skip + invoke fire.
 * - epoch>=3: asset_relations da DROP; cascade skip + invoke fire.
 *
 * Tüm değişiklikler `_schemaEpoch` ile gate edildiği için bayrak (ARCHIVIST_V3_EPOCH)
 * dolaylı — epoch ancak `runV3EpochMigration` (A3) başarıyla yaptıysa ilerler.
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
    saveEmbedding,
    saveChunkEmbedding,
    upsertTextChunk,
    deleteAsset,
    permanentlyDeleteAsset,
    softDeleteAsset,
    deleteOrphanedAssets,
    emptyTrashDb,
    _setDbForTesting,
    __setSchemaEpochForTesting,
    getSchemaEpoch,
} from '../services/database';

function makeAsset(id: string) {
    return {
        id,
        fileName: `${id}.dwg`,
        filePath: `C:/Projects/${id}.dwg`,
        fileSize: 1024,
        fileType: 'DWG',
        category: '2D Çizim',
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-06-15T12:00:00Z',
        projectName: 'P',
        projectPhase: 'K',
    };
}

function cascadeInvokeCalls() {
    return invokeMock.mock.calls.filter(
        ([cmd]) => cmd === 'vec_db_cascade_delete',
    );
}

/** `tauriInvoke` dinamik `await import('@tauri-apps/api/core')` kullanır →
 *  fire-and-forget mikrotask zinciri için event loop'a yield gerekir.
 *  Bazı yollar (`permanentlyDeleteAsset`, `emptyTrashDb`) cascade'den önce
 *  `clearAssetsOnDisk` invoke'unu da fire eder → çift dynamic-import zinciri. */
async function flushFireAndForget(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 0));
    }
}

describe('Faz 3 A4 — sql.js cascade gating + vec_db_cascade_delete', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
        invokeMock.mockClear();
        __setSchemaEpochForTesting(0);
    });

    afterEach(() => {
        __setSchemaEpochForTesting(0);
        _setDbForTesting(null);
        db.close();
    });

    it('epoch=0 default: cascade tüm tablolara dokunur, invoke YOK', async () => {
        upsertAsset(makeAsset('a1'));
        saveEmbedding('a1', [0.1, 0.2], 'text');
        upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 't' });

        expect(getSchemaEpoch()).toBe(0);
        expect(deleteAsset('a1')).toBe(true);
        await flushFireAndForget();

        // Hiçbir vec.db cascade invoke YOK (epoch=0 → eski yol).
        expect(cascadeInvokeCalls()).toHaveLength(0);
    });

    it('epoch=1: embeddings DROP\'lu — sql.js DELETE skip + invoke fire', async () => {
        upsertAsset(makeAsset('a1'));
        upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 't' });
        // Migrasyon simulasyonu: embeddings DROP, epoch=1.
        db.run('DROP TABLE embeddings');
        __setSchemaEpochForTesting(1);

        // DELETE FROM embeddings sql.js'te çağrılırsa "no such table" atar — atmamalı.
        expect(deleteAsset('a1')).toBe(true);
        await flushFireAndForget();

        const calls = cascadeInvokeCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual({ archiveAt: null, assetIds: ['a1'] });
    });

    it('epoch=2: text_chunks da DROP — skip + invoke fire', async () => {
        upsertAsset(makeAsset('a1'));
        db.run('DROP TABLE embeddings');
        db.run('DROP TABLE text_chunks');
        __setSchemaEpochForTesting(2);

        expect(permanentlyDeleteAsset('a1')).toBe(true);
        await flushFireAndForget();
        const calls = cascadeInvokeCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual({ archiveAt: null, assetIds: ['a1'] });
    });

    it('epoch=3: asset_relations da DROP — skip + invoke fire', async () => {
        upsertAsset(makeAsset('a1'));
        db.run('DROP TABLE embeddings');
        db.run('DROP TABLE text_chunks');
        db.run('DROP TABLE asset_relations');
        __setSchemaEpochForTesting(3);

        expect(deleteAsset('a1')).toBe(true);
        await flushFireAndForget();
        const calls = cascadeInvokeCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual({ archiveAt: null, assetIds: ['a1'] });
    });

    it('deleteOrphanedAssets toplu — ID\'leri tek invoke\'la fire eder', async () => {
        upsertAsset(makeAsset('a1'));
        upsertAsset(makeAsset('a2'));
        upsertAsset(makeAsset('a3'));
        db.run('DROP TABLE embeddings');
        __setSchemaEpochForTesting(1);

        expect(deleteOrphanedAssets(['a1', 'a2', 'a3'])).toBe(3);
        await flushFireAndForget();
        const calls = cascadeInvokeCalls();
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual({
            archiveAt: null,
            assetIds: ['a1', 'a2', 'a3'],
        });
    });

    it('emptyTrashDb — çöpteki ID\'leri tek invoke\'la fire eder', async () => {
        upsertAsset(makeAsset('a1'));
        upsertAsset(makeAsset('a2'));
        // Çöp kutusuna taşı.
        softDeleteAsset('a1');
        softDeleteAsset('a2');
        db.run('DROP TABLE embeddings');
        __setSchemaEpochForTesting(1);

        expect(emptyTrashDb()).toBe(2);
        await flushFireAndForget();
        const calls = cascadeInvokeCalls();
        expect(calls).toHaveLength(1);
        const payload = calls[0][1] as { archiveAt: null; assetIds: string[] };
        expect(payload.archiveAt).toBeNull();
        expect(payload.assetIds).toHaveLength(2);
        expect(payload.assetIds).toEqual(expect.arrayContaining(['a1', 'a2']));
    });

    it('softDelete trigger\'ı invoke fire ETMEZ (cascade dışı)', async () => {
        upsertAsset(makeAsset('a1'));
        db.run('DROP TABLE embeddings');
        __setSchemaEpochForTesting(1);

        softDeleteAsset('a1'); // sadece is_deleted flag — cascade yok
        await flushFireAndForget();
        expect(cascadeInvokeCalls()).toHaveLength(0);
    });

    it('boş ID listesi — invoke fire EDİLMEZ (NOOP)', async () => {
        __setSchemaEpochForTesting(1);
        expect(deleteOrphanedAssets([])).toBe(0);
        await flushFireAndForget();
        expect(cascadeInvokeCalls()).toHaveLength(0);
    });
});
