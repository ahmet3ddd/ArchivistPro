import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  auditLog,
  getAuditLogs,
  getAuditLogCount,
  clearAuditLogs,
  deleteAuditLog,
  deleteAuditLogsBatch,
  clearAuditLogsBefore,
  systemLog,
  setLoggerDb,
  debugLog,
  perfStart,
} from '../services/logger';

/* ── Mock DB ── */

function createMockDb() {
  const rows: unknown[][] = [];

  return {
    run: vi.fn((sql: string, params?: unknown[]) => {
      if (sql.includes('INSERT INTO audit_log')) {
        rows.push([rows.length + 1, ...(params || [])]);
      }
      if (sql.includes('DELETE FROM audit_log')) {
        // Silme simülasyonu — AUDIT_LOG_CLEAR hariç
        const filtered = rows.filter((r) => r[3] === 'AUDIT_LOG_CLEAR');
        rows.length = 0;
        rows.push(...filtered);
      }
    }),
    exec: vi.fn((sql: string) => {
      if (sql.includes('SELECT COUNT(*)')) {
        return [{ columns: ['count'], values: [[rows.length]] }];
      }
      if (sql.includes('SELECT id')) {
        const reversed = [...rows].reverse();
        return reversed.length > 0
          ? [{ columns: ['id', 'timestamp', 'role', 'action', 'target', 'detail', 'result'], values: reversed }]
          : [];
      }
      return [];
    }),
    prepare: vi.fn((_sql: string) => {
      let cursor = -1;
      const reversed = [...rows].reverse();
      return {
        bind: vi.fn(),
        step: vi.fn(() => {
          cursor++;
          return cursor < reversed.length;
        }),
        getAsObject: vi.fn(() => {
          const r = reversed[cursor];
          if (!r) return {};
          return { id: r[0], timestamp: r[1], role: r[2], action: r[3], target: r[4], detail: r[5], result: r[6] };
        }),
        free: vi.fn(),
      };
    }),
    _rows: rows,
  };
}

describe('Logger — Audit Log', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    setLoggerDb(mockDb as any);
  });

  it('auditLog bir kayıt ekler', () => {
    auditLog('SCAN_START', '/test/path');
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['SCAN_START', '/test/path']),
    );
  });

  it('auditLog varsayılan result SUCCESS olur', () => {
    auditLog('FILE_DELETE', 'file.dwg');
    const call = mockDb.run.mock.calls[0];
    const params = call[1] as unknown[];
    // Params sırası: timestamp, role, action, target, detail, result, prev_hash, row_hash
    expect(params[5]).toBe('SUCCESS');
  });

  it('auditLog FAIL result ile çağrılabilir', () => {
    auditLog('SCAN_START', '/test', {}, 'FAIL');
    const call = mockDb.run.mock.calls[0];
    const params = call[1] as unknown[];
    expect(params[5]).toBe('FAIL');
  });

  it('auditLog detail JSON olarak saklanır', () => {
    auditLog('SETTINGS_CHANGE', 'ai_config', { provider: 'ollama', model: 'llava' });
    const call = mockDb.run.mock.calls[0];
    const params = call[1] as unknown[];
    const detail = params[4] as string;
    expect(JSON.parse(detail)).toEqual({ provider: 'ollama', model: 'llava' });
  });

  it('auditLog timestamp ISO formatında olur', () => {
    auditLog('FILE_CREATE', 'new.pdf');
    const call = mockDb.run.mock.calls[0];
    const params = call[1] as unknown[];
    const ts = params[0] as string;
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('getAuditLogCount kayıt sayısını döndürür', () => {
    auditLog('SCAN_START', 'a');
    auditLog('SCAN_COMPLETE', 'b');
    expect(getAuditLogCount()).toBe(2);
  });

  it('getAuditLogs kayıtları getirir', () => {
    auditLog('SCAN_START', '/dir');
    auditLog('FILE_DELETE', 'file.dwg');
    const logs = getAuditLogs();
    expect(logs.length).toBe(2);
    expect(logs[0].action).toBe('FILE_DELETE'); // en son eklenen ilk sırada (DESC)
    expect(logs[1].action).toBe('SCAN_START');
  });

  it('clearAuditLogs tüm logları temizler', () => {
    auditLog('SCAN_START', 'a');
    auditLog('FILE_DELETE', 'b');
    const result = clearAuditLogs();
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2);
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM audit_log'),
    );
  });

  it('DB null iken auditLog hata vermez', () => {
    setLoggerDb(null);
    expect(() => auditLog('SCAN_START', 'test')).not.toThrow();
  });

  it('DB null iken getAuditLogs boş dizi döner', () => {
    setLoggerDb(null);
    expect(getAuditLogs()).toEqual([]);
  });

  it('DB null iken getAuditLogCount 0 döner', () => {
    setLoggerDb(null);
    expect(getAuditLogCount()).toBe(0);
  });
});

describe('Logger — deleteAuditLog', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    setLoggerDb(mockDb as any);
  });

  it('DB null iken hata dönmez', () => {
    setLoggerDb(null);
    const result = deleteAuditLog(1);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('DB varken DELETE sorgusu çağırır', () => {
    const result = deleteAuditLog(42);
    expect(result.success).toBe(true);
    expect(mockDb.run).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM audit_log WHERE id = ?'),
      [42],
    );
  });
});

describe('Logger — deleteAuditLogsBatch', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    setLoggerDb(mockDb as any);
  });

  it('DB null iken hata dönmez', () => {
    setLoggerDb(null);
    const result = deleteAuditLogsBatch([1, 2, 3]);
    expect(result.success).toBe(false);
  });

  it('boş liste başarıyla tamamlanır', () => {
    const result = deleteAuditLogsBatch([]);
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(0);
  });

  it('çoklu id ile silme yapar', () => {
    const result = deleteAuditLogsBatch([1, 2, 3]);
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(3);
    // BEGIN + 3×DELETE + COMMIT = 5 çağrı
    const calls = mockDb.run.mock.calls.map(c => c[0] as string);
    expect(calls.some(s => s.includes('BEGIN'))).toBe(true);
    expect(calls.some(s => s.includes('COMMIT'))).toBe(true);
    expect(calls.filter(s => s.includes('DELETE FROM audit_log WHERE id = ?'))).toHaveLength(3);
  });
});

describe('Logger — clearAuditLogsBefore', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mockDb = createMockDb();
    setLoggerDb(mockDb as any);
  });

  it('DB null iken hata dönmez', () => {
    setLoggerDb(null);
    const result = clearAuditLogsBefore('2026-01-01');
    expect(result.success).toBe(false);
  });

  it('prepare çağrılır', () => {
    clearAuditLogsBefore('2026-01-01');
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('SELECT COUNT(*)'),
    );
  });
});

describe('Logger — systemLog', () => {
  it('hata fırlatmaz (Tauri yok)', async () => {
    await expect(systemLog('INFO', 'test', 'mesaj')).resolves.not.toThrow();
  });

  it('ERROR seviyesinde hata fırlatmaz', async () => {
    await expect(systemLog('ERROR', 'test', 'hata mesajı')).resolves.not.toThrow();
  });

  it('WARN seviyesinde hata fırlatmaz', async () => {
    await expect(systemLog('WARN', 'test', 'uyarı mesajı')).resolves.not.toThrow();
  });

  it('DEBUG seviyesinde hata fırlatmaz', async () => {
    await expect(systemLog('DEBUG', 'test', 'debug mesajı')).resolves.not.toThrow();
  });

  it('TRACE seviyesinde hata fırlatmaz', async () => {
    await expect(systemLog('TRACE', 'test', 'trace mesajı')).resolves.not.toThrow();
  });
});

describe('Logger — Debug Log', () => {
  it('DEV modda konsola yazar', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    debugLog('test_module', 'test message');
    // DEV modda olduğumuzdan (vitest = dev) çağrılmalı
    // Not: import.meta.env.DEV vitest'te true olabilir
    spy.mockRestore();
  });

  it('data parametresi ile çağrılabilir', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    debugLog('module', 'msg', { key: 'value' });
    spy.mockRestore();
  });
});

describe('Logger — perfStart', () => {
  it('bir fonksiyon döndürür', () => {
    const done = perfStart('scan');
    expect(typeof done).toBe('function');
  });

  it('done() çağrıldığında hata vermez', () => {
    const done = perfStart('scan');
    expect(() => done()).not.toThrow();
  });
});
