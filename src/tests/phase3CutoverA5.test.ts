/**
 * V3 Faz 3 — Adım A5 testleri: arşiv manifesti `schemaEpoch` taşır
 * (geri-uyumlu); `reloadDatabase` PRAGMA user_version'ı yeniden okur.
 *
 * A5 dark-ship: bayrak (`ARCHIVIST_V3_EPOCH`) kapalı → manifest sadece
 * BİLGİ taşır, davranışı değiştirmez. T4 auto-upgrade tetiği A6 işidir.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
vi.mock('../appVersion', () => ({ APP_VERSION: '2.4.10' }));

import { exportArchive, peekArchive, type ArchiveManifest } from '../services/archiveShare';
import {
    _setDbForTesting,
    __setSchemaEpochForTesting,
    getSchemaEpoch,
    reloadDatabase,
    applyV3PostImportUpgrade,
} from '../services/database';

describe('Faz 3 A5 — manifest schemaEpoch', () => {
    let db: any;

    beforeEach(async () => {
        db = await createTestDatabase();
        _setDbForTesting(db);
        invokeMock.mockReset();
        __setSchemaEpochForTesting(0);
    });

    it('exportArchive: manifest schemaEpoch=0 (default)', async () => {
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'export_archive') {
                return Promise.resolve({ assetCount: 0, dbSize: 100, fileSize: 200 });
            }
            return Promise.resolve(null);
        });

        const m = await exportArchive('/tmp/test.archivistpro', 'desc');
        expect(m).not.toBeNull();
        expect(m!.schemaEpoch).toBe(0);

        // Rust'a giden manifest string'inde de var.
        const exportCall = invokeMock.mock.calls.find(c => c[0] === 'export_archive');
        expect(exportCall).toBeDefined();
        const parsedManifest = JSON.parse((exportCall![1] as { manifest: string }).manifest);
        expect(parsedManifest.schemaEpoch).toBe(0);
    });

    it('exportArchive: epoch=2 → manifest schemaEpoch=2', async () => {
        __setSchemaEpochForTesting(2);
        expect(getSchemaEpoch()).toBe(2);

        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'export_archive') {
                return Promise.resolve({ assetCount: 0, dbSize: 100, fileSize: 200 });
            }
            return Promise.resolve(null);
        });

        const m = await exportArchive('/tmp/test.archivistpro');
        expect(m!.schemaEpoch).toBe(2);

        const exportCall = invokeMock.mock.calls.find(c => c[0] === 'export_archive');
        const parsedManifest = JSON.parse((exportCall![1] as { manifest: string }).manifest);
        expect(parsedManifest.schemaEpoch).toBe(2);
    });

    it('peekArchive: schemaEpoch alanı manifestte yoksa undefined (geri-uyumlu)', async () => {
        // Eski (v2) arşiv: schemaEpoch yok.
        const oldManifest = JSON.stringify({
            version: 1,
            appVersion: '2.4.9',
            createdAt: '2026-05-01T00:00:00Z',
            createdBy: 'admin',
            assetCount: 100,
            dbSizeBytes: 1024,
        });
        invokeMock.mockResolvedValue(oldManifest);

        const m = await peekArchive('/tmp/old.archivistpro');
        expect(m).not.toBeNull();
        expect(m!.assetCount).toBe(100);
        // Eski arşiv → schemaEpoch undefined; tüketici 0 varsayar.
        expect(m!.schemaEpoch).toBeUndefined();
        const effectiveEpoch = m!.schemaEpoch ?? 0;
        expect(effectiveEpoch).toBe(0);
    });

    it('peekArchive: schemaEpoch yeni manifestte korunur', async () => {
        const newManifest = JSON.stringify({
            version: 1,
            appVersion: '2.4.10',
            createdAt: '2026-05-20T00:00:00Z',
            createdBy: 'admin',
            assetCount: 50,
            dbSizeBytes: 2048,
            schemaEpoch: 3,
        });
        invokeMock.mockResolvedValue(newManifest);

        const m = await peekArchive('/tmp/new.archivistpro');
        expect(m).not.toBeNull();
        expect(m!.schemaEpoch).toBe(3);
    });

    it('ArchiveManifest.schemaEpoch opsiyoneldir (tip-seviyesi)', () => {
        // Derlemenin geçmesi yeterli — runtime'da hiçbir field yok.
        const m: ArchiveManifest = {
            version: 1,
            appVersion: '2.4.10',
            createdAt: '2026-05-20',
            createdBy: 'admin',
            assetCount: 0,
            dbSizeBytes: 0,
            // schemaEpoch yok — derlemeli.
        };
        expect(m.schemaEpoch).toBeUndefined();
    });
});

describe('Faz 3 A5 — reloadDatabase epoch refresh', () => {
    beforeEach(() => {
        invokeMock.mockReset();
        __setSchemaEpochForTesting(99); // bilinçli yanlış değer — refresh test'i için
    });

    async function makeDbBlobWithUserVersion(uv: number): Promise<Uint8Array> {
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();
        const tmpDb = new SQL.Database();
        tmpDb.run(`PRAGMA user_version = ${uv}`);
        const bytes = tmpDb.export();
        tmpDb.close();
        return bytes;
    }

    it('reloadDatabase — PRAGMA user_version=0 (eski monolit) → _schemaEpoch=0', async () => {
        const blob = await makeDbBlobWithUserVersion(0);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'read_database_meta') {
                return Promise.resolve({ exists: true, sizeBytes: blob.length, corrupted: false });
            }
            if (cmd === 'read_database_binary') {
                return Promise.resolve(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer);
            }
            return Promise.resolve(null);
        });

        await reloadDatabase();
        expect(getSchemaEpoch()).toBe(0);
    });

    it('reloadDatabase — PRAGMA user_version=2 (migrasyon yapılmış) → _schemaEpoch=2', async () => {
        const blob = await makeDbBlobWithUserVersion(2);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'read_database_meta') {
                return Promise.resolve({ exists: true, sizeBytes: blob.length, corrupted: false });
            }
            if (cmd === 'read_database_binary') {
                return Promise.resolve(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) as ArrayBuffer);
            }
            return Promise.resolve(null);
        });

        await reloadDatabase();
        // Kritik: A5 fix öncesi `_schemaEpoch` 99 kalırdı (stale) → A4 gating
        // yanlış skip/cascade verirdi.
        expect(getSchemaEpoch()).toBe(2);
    });

    it('reloadDatabase — DB yoksa _schemaEpoch dokunulmaz (early return)', async () => {
        __setSchemaEpochForTesting(1);
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'read_database_meta') {
                return Promise.resolve({ exists: false, sizeBytes: 0, corrupted: false });
            }
            return Promise.resolve(null);
        });

        await reloadDatabase();
        expect(getSchemaEpoch()).toBe(1); // değişmedi
    });
});

describe('Faz 3 A5/A6 — applyV3PostImportUpgrade', () => {
    beforeEach(async () => {
        const db = await createTestDatabase();
        _setDbForTesting(db);
        invokeMock.mockReset();
        __setSchemaEpochForTesting(0);
        // localStorage'ı temizle — testler arası tertemiz başlangıç.
        // Default'un AÇIK olduğunu unutma (A6): anahtar yokken triggered=true.
        try { localStorage.removeItem('ARCHIVIST_V3_EPOCH'); } catch { /* noop */ }
    });

    it('bayrak kapalı → triggered=false, NOOP', async () => {
        // A6 (2026-05-22) sonrası default AÇIK; "kapalı" durumu açık opt-out
        // (`setItem('off')`) gerektirir.
        try { localStorage.setItem('ARCHIVIST_V3_EPOCH', 'off'); } catch { /* noop */ }
        __setSchemaEpochForTesting(0);
        const result = await applyV3PostImportUpgrade();
        expect(result.triggered).toBe(false);
        expect(result.ok).toBe(true);
        expect(result.epoch).toBe(0);
        // runV3EpochMigration çağrılmamış → premigrate-backup invoke YOK.
        const premigCalls = invokeMock.mock.calls.filter(c => c[0] === 'vec_db_premigrate_backup');
        expect(premigCalls).toHaveLength(0);
    });

    it('A6: bayrak SET EDİLMEMİŞ → default AÇIK → triggered=true (epoch<3)', async () => {
        // 2026-05-22 A6 flip (PRE-5/6 tamam): localStorage'da 'ARCHIVIST_V3_EPOCH'
        // yok → isV3EpochEnabled()=true → epoch hedef altındaysa migrate tetiklenir.
        // Açık opt-out ('off') geri çevirir.
        try { localStorage.removeItem('ARCHIVIST_V3_EPOCH'); } catch { /* noop */ }
        __setSchemaEpochForTesting(0);

        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_premigrate_backup') return Promise.resolve(2048);
            if (cmd === 'vec_db_migrate_embeddings') return Promise.resolve(5);
            // verify=false → rollback + DUR (akış kanıtı yeter; gerçek başarı
            // ayrı testte). Burada yalnız "bayrak yokken tetiklenir mi" ölçeriz.
            if (cmd === 'vec_db_verify_embeddings') return Promise.resolve({ verified: false });
            if (cmd === 'vec_db_rollback') return Promise.resolve(true);
            return Promise.resolve(null);
        });

        const result = await applyV3PostImportUpgrade();
        expect(result.triggered).toBe(true); // ← A6'nın kanıtı
        const cmds = invokeMock.mock.calls.map(c => c[0]);
        expect(cmds).toContain('vec_db_premigrate_backup');
    });

    it('bayrak açık + epoch=3 (zaten hedef) → triggered=false, NOOP', async () => {
        try { localStorage.setItem('ARCHIVIST_V3_EPOCH', 'on'); } catch { /* noop */ }
        __setSchemaEpochForTesting(3);
        const result = await applyV3PostImportUpgrade();
        expect(result.triggered).toBe(false);
        expect(result.ok).toBe(true);
        expect(result.epoch).toBe(3);
        const premigCalls = invokeMock.mock.calls.filter(c => c[0] === 'vec_db_premigrate_backup');
        expect(premigCalls).toHaveLength(0);
    });

    it('bayrak açık + epoch=0 → triggered=true, runV3EpochMigration çağrılır', async () => {
        try { localStorage.setItem('ARCHIVIST_V3_EPOCH', 'on'); } catch { /* noop */ }
        __setSchemaEpochForTesting(0);

        // runV3EpochMigration zinciri: premigrate_backup → her epoch için migrate→verify.
        // verify FAIL döner → rollback çağrılır, DUR (epoch advancement YOK).
        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_premigrate_backup') return Promise.resolve(1024);
            if (cmd === 'vec_db_migrate_embeddings') return Promise.resolve(10);
            if (cmd === 'vec_db_verify_embeddings') return Promise.resolve({ verified: false });
            if (cmd === 'vec_db_rollback') return Promise.resolve(true);
            return Promise.resolve(null);
        });

        const result = await applyV3PostImportUpgrade();
        expect(result.triggered).toBe(true);
        // verify=false → rollback + dur; ok=false.
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/verify-failed@embeddings/);

        // Akış: premigrate_backup → migrate_embeddings → verify_embeddings → rollback.
        const cmds = invokeMock.mock.calls.map(c => c[0]);
        expect(cmds).toContain('vec_db_premigrate_backup');
        expect(cmds).toContain('vec_db_migrate_embeddings');
        expect(cmds).toContain('vec_db_verify_embeddings');
        expect(cmds).toContain('vec_db_rollback');
    });

    it('bayrak açık + epoch=0, tüm verify GEÇER → finalize + reload → ok, epoch=3', async () => {
        try { localStorage.setItem('ARCHIVIST_V3_EPOCH', 'on'); } catch { /* noop */ }
        __setSchemaEpochForTesting(0);

        // Migrate sonrası diskteki epoch=3 DB'yi simüle et — reloadDatabase
        // bunu read_database_binary'den okuyup _schemaEpoch=3 yapar.
        const initSqlJs = (await import('sql.js')).default;
        const SQL = await initSqlJs();
        const migrated = new SQL.Database();
        migrated.run('PRAGMA user_version = 3');
        const migratedBytes = migrated.export();
        migrated.close();

        invokeMock.mockImplementation((cmd: string) => {
            if (cmd === 'vec_db_premigrate_backup') return Promise.resolve(1024);
            if (cmd.startsWith('vec_db_migrate_')) return Promise.resolve(5);
            if (cmd.startsWith('vec_db_verify_')) return Promise.resolve({ verified: true });
            if (cmd === 'vec_db_finalize_main_migration') return Promise.resolve(2048);
            if (cmd === 'read_database_meta') {
                return Promise.resolve({ exists: true, sizeBytes: migratedBytes.length, corrupted: false });
            }
            if (cmd === 'read_database_binary') {
                return Promise.resolve(
                    migratedBytes.buffer.slice(
                        migratedBytes.byteOffset,
                        migratedBytes.byteOffset + migratedBytes.byteLength,
                    ) as ArrayBuffer,
                );
            }
            return Promise.resolve(null);
        });

        const result = await applyV3PostImportUpgrade();
        expect(result.triggered).toBe(true);
        expect(result.ok).toBe(true);
        expect(result.epoch).toBe(3);
        expect(getSchemaEpoch()).toBe(3);

        const cmds = invokeMock.mock.calls.map(c => c[0]);
        for (const c of [
            'vec_db_premigrate_backup', 'vec_db_migrate_embeddings',
            'vec_db_migrate_text_chunks', 'vec_db_migrate_asset_relations',
            'vec_db_finalize_main_migration',
        ]) {
            expect(cmds).toContain(c);
        }
        // DROP yok → 3 verify de finalize'dan ÖNCE bütün kaynağa karşı koşar.
        expect(cmds.indexOf('vec_db_verify_asset_relations'))
            .toBeLessThan(cmds.indexOf('vec_db_finalize_main_migration'));
    });
});
