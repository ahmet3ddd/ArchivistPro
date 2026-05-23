/**
 * Audit log hash chain integration testleri.
 *
 * Gerçek sql.js in-memory DB kullanır — migration, auditLog INSERT, verify akışını
 * uçtan uca doğrular. Tampering simülasyonu için DB'ye doğrudan UPDATE yapılır.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

// Tauri invoke mock (logger içinde dolaylı çağrı olabilir)
vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(() => Promise.resolve(null)),
}));

// Permissions — auditLog içinde getAppRole çağrılıyor
vi.mock('../permissions/roles', () => ({
    getAppRole: vi.fn(() => 'admin'),
}));

import {
    auditLog,
    setLoggerDb,
    verifyAuditLogIntegrity,
    clearAuditLogs,
    deleteAuditLog,
    deleteAuditLogsBatch,
    computeAuditRowHash,
} from '../services/logger';

type SqlJsDb = Awaited<ReturnType<typeof createTestDatabase>>;

function getAllAuditRows(db: SqlJsDb): Array<Record<string, unknown>> {
    const result = db.exec(`SELECT id, timestamp, role, action, target, detail, result, prev_hash, row_hash FROM audit_log ORDER BY id ASC`);
    if (result.length === 0) return [];
    return result[0].values.map((row) => ({
        id: row[0], timestamp: row[1], role: row[2], action: row[3], target: row[4],
        detail: row[5], result: row[6], prev_hash: row[7], row_hash: row[8],
    }));
}

describe('Audit log hash chain', () => {
    let db: SqlJsDb;

    beforeEach(async () => {
        db = await createTestDatabase();
        setLoggerDb(db as any);
    });

    it('fresh DB: ilk auditLog prev_hash = "", row_hash dolu', () => {
        auditLog('SCAN_START', '/some/path', { files: 10 });

        const rows = getAllAuditRows(db);
        expect(rows).toHaveLength(1);
        expect(rows[0].prev_hash).toBe('');
        expect(rows[0].row_hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('ardışık auditLog: prev_hash önceki satırın row_hash\'ine eşit', () => {
        auditLog('SCAN_START', '/a');
        auditLog('SCAN_COMPLETE', '/a');
        auditLog('FILE_DELETE', '/a/x.pdf');

        const rows = getAllAuditRows(db);
        expect(rows).toHaveLength(3);
        expect(rows[0].prev_hash).toBe('');
        expect(rows[1].prev_hash).toBe(rows[0].row_hash);
        expect(rows[2].prev_hash).toBe(rows[1].row_hash);
    });

    it('row_hash, buildAuditHashInput ile aynı hesaplanır (manuel teyit)', () => {
        auditLog('SCAN_START', '/test');

        const rows = getAllAuditRows(db);
        const r = rows[0];
        const expected = computeAuditRowHash(
            r.timestamp as string,
            r.role as string,
            r.action as string,
            r.target as string,
            r.detail as string,
            r.result as string,
            r.prev_hash as string,
        );
        expect(r.row_hash).toBe(expected);
    });

    it('verify: taze chain valid döner', () => {
        auditLog('SCAN_START', '/a');
        auditLog('SCAN_COMPLETE', '/a');
        auditLog('USER_LOGIN', 'ahmet');

        const result = verifyAuditLogIntegrity();
        expect(result.valid).toBe(true);
        expect(result.totalRows).toBe(3);
        expect(result.brokenRowIds).toEqual([]);
        expect(result.missingHashCount).toBe(0);
    });

    it('verify: boş DB valid (vacuously true)', () => {
        const result = verifyAuditLogIntegrity();
        expect(result.valid).toBe(true);
        expect(result.totalRows).toBe(0);
    });

    it('tampering: ortadaki satırın detail\'i değişirse verify invalid döner', () => {
        auditLog('SCAN_START', '/a');
        auditLog('FILE_DELETE', '/a/x.pdf', { filename: 'x.pdf' });
        auditLog('SCAN_COMPLETE', '/a');

        // Dışarıdan tampering — ortadaki satırın detail'ini UPDATE ile değiştir
        db.run(`UPDATE audit_log SET detail = ? WHERE id = 2`, [JSON.stringify({ filename: 'tampered.pdf' })]);

        const result = verifyAuditLogIntegrity();
        expect(result.valid).toBe(false);
        // 2. satır row_hash artık içerikle uyumsuz → 2 kırık. 3. satır da 2'nin row_hash'i
        // değişmediği için chain bakımından OK ama verify yine de content mismatch yakalar.
        expect(result.brokenRowIds).toContain(2);
        expect(result.firstBrokenId).toBe(2);
    });

    it('tampering: bir satırın row_hash\'i manuel olarak değiştirilirse invalid', () => {
        auditLog('SCAN_START', '/a');
        auditLog('FILE_DELETE', '/a/x.pdf');
        auditLog('SCAN_COMPLETE', '/a');

        // 2. satırın row_hash'ini random değere çevir
        db.run(`UPDATE audit_log SET row_hash = ? WHERE id = 2`, ['0'.repeat(64)]);

        const result = verifyAuditLogIntegrity();
        expect(result.valid).toBe(false);
        expect(result.brokenRowIds).toContain(2);
    });

    it('tampering: satır silinirse chain\'de boşluk verify ile yakalanır', () => {
        auditLog('SCAN_START', '/a');
        auditLog('FILE_DELETE', '/a/x.pdf');
        auditLog('SCAN_COMPLETE', '/a');

        // Doğrudan DELETE ile (tamper marker EKLEMEDEN) ortadaki satırı sil
        db.run(`DELETE FROM audit_log WHERE id = 2`);

        const result = verifyAuditLogIntegrity();
        expect(result.valid).toBe(false);
        // 3. satırın prev_hash'i 2'nin row_hash'iydi; 1'in row_hash'i ile eşleşmez
        expect(result.brokenRowIds).toContain(3);
    });

    it('LOG_DELETED marker meşru silme için chain\'i sürdürür (yeni marker valid)', () => {
        auditLog('SCAN_START', '/a');
        auditLog('FILE_DELETE', '/a/x.pdf');
        auditLog('SCAN_COMPLETE', '/a');

        // Meşru silme — deleteAuditLog marker ekler
        deleteAuditLog(1);

        // Kalan satırlar: id=2, 3, 4 (marker). 2 ve 3'ün chain'i orijinal kalsın; 4'ün
        // prev_hash'i = 3'ün row_hash'i. Verify: 2'nin prev_hash'i 1'in hash'iydi — 1 yok,
        // dolayısıyla expectedPrev='' ama 2'nin prev_hash != '' → kırık. Tasarım:
        // kırık tespit edilsin + LOG_DELETED marker varlığı ipucudur.
        const result = verifyAuditLogIntegrity();
        expect(result.valid).toBe(false);
        // En az 1 kırık nokta bulundu (id 2 veya sonrası)
        expect(result.brokenRowIds.length).toBeGreaterThan(0);
    });

    it('clearAuditLogs sonrası yeni chain prev_hash="" ile temiz kurulur', () => {
        auditLog('SCAN_START', '/a');
        auditLog('SCAN_COMPLETE', '/a');

        clearAuditLogs(); // tümünü siler + LOG_CLEARED marker ekler

        auditLog('USER_LOGIN', 'ahmet');

        const rows = getAllAuditRows(db);
        expect(rows).toHaveLength(2);
        expect(rows[0].action).toBe('LOG_CLEARED');
        expect(rows[0].prev_hash).toBe(''); // yeni chain başlangıcı
        expect(rows[1].action).toBe('USER_LOGIN');
        expect(rows[1].prev_hash).toBe(rows[0].row_hash);

        const result = verifyAuditLogIntegrity();
        expect(result.valid).toBe(true);
    });

    it('deleteAuditLogsBatch marker chain\'e yeni hash ekler', () => {
        auditLog('SCAN_START', '/a');
        auditLog('FILE_DELETE', '/x');
        auditLog('FILE_DELETE', '/y');
        auditLog('SCAN_COMPLETE', '/a');

        deleteAuditLogsBatch([2, 3]); // 2, 3 silinir + marker eklenir

        const rows = getAllAuditRows(db);
        // id=1, id=4, ve yeni marker id=5 kalır
        expect(rows.some((r) => r.action === 'LOG_DELETED_BATCH')).toBe(true);

        const marker = rows.find((r) => r.action === 'LOG_DELETED_BATCH')!;
        // Marker'ın prev_hash'i, chain'in en son ucu (silinmemişler içinde en büyük id = 4'ün row_hash'i)
        const lastBeforeMarker = rows.find((r) => r.id === 4)!;
        expect(marker.prev_hash).toBe(lastBeforeMarker.row_hash);
    });
});
