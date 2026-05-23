/**
 * Archivist Pro — Merkezi Loglama Servisi
 *
 * Üç katman:
 * 1. Audit Log  — Kim ne yaptı (DB tablosu, kalıcı)
 * 2. System Log — Hata, uyarı, performans (Rust tracing üzerinden dosyaya)
 * 3. Debug Log  — Geliştirici için (konsol + opsiyonel dosya)
 *
 * Arama terimleri LOGLANMAZ (gizlilik kararı).
 */

import { getAppRole, type AppRole } from '../permissions/roles';
import { sha256Hex } from '../utils/sha256';

/* ── Tipler ── */

export type AuditAction =
  // Dosya işlemleri
  | 'FILE_DELETE'
  | 'FILE_MOVE'
  | 'FILE_CREATE'
  | 'FILE_RENAME'
  | 'FILE_ZIP'
  // Arşiv işlemleri
  | 'SCAN_START'
  | 'SCAN_COMPLETE'
  | 'SCAN_CANCEL'
  | 'SCAN_ERROR'
  | 'SCAN_ERRORS'
  | 'SCAN_INTERRUPTED'
  | 'SCAN_REPORT_WRITTEN'
  | 'APP_SHUTDOWN_GRACEFUL'
  | 'INDEX_START'
  | 'INDEX_COMPLETE'
  | 'REFILE_EXECUTE'
  | 'ARCHIVE_EXPORT'
  | 'ARCHIVE_IMPORT'
  | 'ARCHIVE_SWITCH'
  | 'ARCHIVE_JOIN_START'
  | 'ARCHIVE_JOIN_COMPLETE'
  | 'ARCHIVE_JOIN_FAILED'
  | 'ARCHIVE_JOIN_ROLLBACK_FAILED'
  | 'ARCHIVE_EXTRACT_START'
  | 'ARCHIVE_EXTRACT_COMPLETE'
  | 'ARCHIVE_EXTRACT_FAILED'
  | 'SCANNED_ROOT_ERROR'
  // AI işlemleri
  | 'AI_VISION_START'
  | 'AI_VISION_COMPLETE'
  | 'AI_EMBEDDING_START'
  | 'AI_EMBEDDING_COMPLETE'
  // Ayar değişiklikleri
  | 'SETTINGS_CHANGE'
  | 'AI_CONFIG_CHANGE'
  // Undo/Redo
  | 'UNDO'
  | 'REDO'
  // Yönetim
  | 'AUDIT_LOG_CLEAR'
  | 'LOG_CLEARED'
  | 'LOG_DELETED'
  | 'LOG_DELETED_BATCH'
  | 'DB_SNAPSHOT_CREATE'
  | 'DB_SNAPSHOT_RESTORE'
  | 'METADATA_UPDATE'
  // Arşiv import rollback
  | 'ARCHIVE_IMPORT_ROLLBACK'
  // Mesajlaşma
  | 'MESSAGE_SEND'
  | 'MESSAGE_REPLY'
  | 'MESSAGE_READ'
  | 'MESSAGE_RESOLVE'
  | 'MESSAGE_DELETE'
  | 'MESSAGE_DELETE_OWN'
  | 'BROADCAST_SEND'
  | 'REQUEST_CLAIM'
  | 'REQUEST_RELEASE'
  // Kullanıcı yönetimi
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'USER_PASSWORD_RESET'
  | 'USER_ROLE_CHANGE'
  | 'USER_LOGIN'
  | 'USER_LOGOUT';

export type AuditResult = 'SUCCESS' | 'FAIL' | 'CANCELLED';

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

export interface AuditLogEntry {
  id: number;
  timestamp: string;
  role: AppRole;
  action: AuditAction;
  target: string;
  detail: string; // JSON
  result: AuditResult;
}

/* ── Tauri invoke yardımcısı ── */

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/* ── Audit Log Mirror (sql.js → rusqlite) ──
 * saveDatabase() yerine kullanılır — db.export ana thread blokunu önler.
 * Sql.js DELETE/INSERT'leri rusqlite'a yansıtılır; restart sonrası ground truth.
 * Fire-and-forget; hata sessizce loglanır (UX için kritik değil).
 */

interface AuditMirrorRow {
  timestamp: string;
  role: string;
  action: string;
  target?: string | null;
  detail?: string | null;
  result: string;
  prev_hash?: string | null;
  row_hash?: string | null;
}

interface AuditMirrorPayload {
  delete_ids?: number[];
  delete_before_iso?: string;
  delete_all?: boolean;
  inserts?: AuditMirrorRow[];
}

function mirrorAuditChangesToDisk(payload: AuditMirrorPayload): void {
  const hasWork = payload.delete_all
    || (payload.delete_ids && payload.delete_ids.length > 0)
    || payload.delete_before_iso
    || (payload.inserts && payload.inserts.length > 0);
  if (!hasWork) return;
  void tauriInvoke('audit_log_apply_changes', { payload }).catch(() => { /* sessizce */ });
}

/* ── DB referansı (lazy) ── */

type SqlJsDb = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => Array<{ columns: string[]; values: unknown[][] }>;
  prepare: (sql: string) => {
    bind: (params: unknown[]) => void;
    step: () => boolean;
    getAsObject: () => Record<string, unknown>;
    free: () => void;
  };
};

let _dbRef: SqlJsDb | null = null;

/** Logger'ın kullanacağı DB referansını set eder (initDatabase sonrası çağrılmalı) */
export function setLoggerDb(db: SqlJsDb | null): void {
  _dbRef = db;
}

/* ── Hash Chain (tamper evidence) ── */

/**
 * Hash chain için satır içeriğini deterministik şekilde serialize eder.
 *
 * JSON.stringify kullanımı — audit_log alanlarının hepsi kontrollü enum veya
 * JSON-serialize edilmiş detail olsa da pipe/comma ayırıcılı format
 * detail içinde o karakter geçtiğinde zayıf kalır. JSON.stringify ise
 * kaçış yapar + sıralama stabil (dizi kullanıyoruz).
 *
 * NOT: id hash'e dahil değil — AUTOINCREMENT INSERT öncesi bilinmiyor.
 * Chain bütünlüğü prev_hash ile sağlanıyor, id surrogate key.
 */
export function buildAuditHashInput(
    timestamp: string,
    role: string | null,
    action: string,
    target: string | null,
    detail: string | null,
    result: string,
    prevHash: string,
): string {
    return JSON.stringify([
        timestamp,
        role ?? '',
        action,
        target ?? '',
        detail ?? '',
        result,
        prevHash,
    ]);
}

/**
 * Audit log satırının row_hash'ini hesaplar.
 * @param prevHash Önceki satırın row_hash'i — ilk satır için boş string
 */
export function computeAuditRowHash(
    timestamp: string,
    role: string | null,
    action: string,
    target: string | null,
    detail: string | null,
    result: string,
    prevHash: string,
): string {
    return sha256Hex(buildAuditHashInput(timestamp, role, action, target, detail, result, prevHash));
}

/** En son eklenen audit satırının row_hash'ini çeker (chain'in ucunu bul). */
function getLastAuditRowHash(): string {
    if (!_dbRef) return '';
    try {
        const result = _dbRef.exec(`SELECT row_hash FROM audit_log ORDER BY id DESC LIMIT 1`);
        const row = result[0]?.values?.[0];
        const hash = row?.[0];
        return typeof hash === 'string' ? hash : '';
    } catch {
        return '';
    }
}

/* ── 1. Audit Log ── */

/**
 * Kullanıcı aksiyonunu audit log'a yazar.
 * DB hazır değilse sessizce atlar (uygulama başlangıcında olabilir).
 */
export function auditLog(
  action: AuditAction,
  target: string,
  detail: Record<string, unknown> = {},
  result: AuditResult = 'SUCCESS',
): void {
  const role = getAppRole();
  const timestamp = new Date().toISOString();
  const detailJson = JSON.stringify(detail);

  // DB'ye yaz — hash chain ile
  if (_dbRef) {
    try {
      const prevHash = getLastAuditRowHash();
      const rowHash = computeAuditRowHash(timestamp, role, action, target, detailJson, result, prevHash);
      _dbRef.run(
        `INSERT INTO audit_log (timestamp, role, action, target, detail, result, prev_hash, row_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [timestamp, role, action, target, detailJson, result, prevHash, rowHash],
      );
    } catch (err) {
      if (import.meta.env.DEV) console.error('[AuditLog] DB yazma hatası:', err);
    }
  }

  // Debug modda konsola da yaz
  if (import.meta.env.DEV) {
    console.log(`[Audit] ${timestamp} [${role}] ${action} → ${target} (${result})`);
  }
}

/** Audit log kayıtlarını getirir (sayfalanmış) */
export function getAuditLogs(
  limit = 100,
  offset = 0,
  filters?: { action?: AuditAction; role?: AppRole; dateFrom?: string; dateTo?: string },
): AuditLogEntry[] {
  if (!_dbRef) return [];

  let sql = `SELECT id, timestamp, role, action, target, detail, result FROM audit_log WHERE 1=1`;
  const params: unknown[] = [];

  if (filters?.action) {
    sql += ` AND action = ?`;
    params.push(filters.action);
  }
  if (filters?.role) {
    sql += ` AND role = ?`;
    params.push(filters.role);
  }
  if (filters?.dateFrom) {
    sql += ` AND timestamp >= ?`;
    params.push(filters.dateFrom);
  }
  if (filters?.dateTo) {
    sql += ` AND timestamp <= ?`;
    params.push(filters.dateTo);
  }

  sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  try {
    const stmt = _dbRef.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const entries: AuditLogEntry[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      entries.push({
        id: row.id as number,
        timestamp: row.timestamp as string,
        role: row.role as AppRole,
        action: row.action as AuditAction,
        target: row.target as string,
        detail: row.detail as string,
        result: row.result as AuditResult,
      });
    }
    stmt.free();
    return entries;
  } catch (err) {
    if (import.meta.env.DEV) console.error('[AuditLog] Okuma hatası:', err);
    return [];
  }
}

/** Audit log toplam kayıt sayısı */
export function getAuditLogCount(): number {
  if (!_dbRef) return 0;
  try {
    const result = _dbRef.exec(`SELECT COUNT(*) FROM audit_log`);
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  } catch {
    return 0;
  }
}

/* ── Silme sonuç tipi ── */

export interface AuditDeleteResult {
  success: boolean;
  deletedCount: number;
  error?: string;
}

/**
 * Audit logları temizler — bu işlemin kendisi de loglanır (tamper marker).
 * Sadece admin çağırabilir.
 *
 * Tamper koruması: tüm logları silmeden önce kaç kayıt silindiğini gösteren
 * `LOG_CLEARED` kaydı bırakılır; bu kayıt DELETE'ten sonra çalıştığı için
 * yeni tablonun en eski kaydı olur ve silme işleminin kendisi iz bırakır.
 */
export function clearAuditLogs(): AuditDeleteResult {
  if (!_dbRef) return { success: false, deletedCount: 0, error: 'DB hazır değil' };
  try {
    const count = getAuditLogCount();
    const role = getAppRole();
    const timestamp = new Date().toISOString();
    // Marker: tüm eski zincir silindi — marker yeni chain'in kökü olur (prev_hash = '').
    const detail = JSON.stringify({ deletedCount: count, reason: 'clearAuditLogs' });
    const prevHash = '';
    const rowHash = computeAuditRowHash(timestamp, role, 'LOG_CLEARED', 'audit_log', detail, 'SUCCESS', prevHash);
    _dbRef.run('BEGIN TRANSACTION');
    try {
      _dbRef.run(`DELETE FROM audit_log`);
      _dbRef.run(
        `INSERT INTO audit_log (timestamp, role, action, target, detail, result, prev_hash, row_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [timestamp, role, 'LOG_CLEARED', 'audit_log', detail, 'SUCCESS', prevHash, rowHash],
      );
      _dbRef.run('COMMIT');
    } catch (innerErr) {
      _dbRef.run('ROLLBACK');
      throw innerErr;
    }
    // Rust mirror — saveDatabase yerine, ana thread bloku yok
    mirrorAuditChangesToDisk({
      delete_all: true,
      inserts: [{
        timestamp, role, action: 'LOG_CLEARED', target: 'audit_log',
        detail, result: 'SUCCESS', prev_hash: prevHash, row_hash: rowHash,
      }],
    });
    return { success: true, deletedCount: count };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (import.meta.env.DEV) console.error('[AuditLog] Temizleme hatası:', err);
    return { success: false, deletedCount: 0, error: msg };
  }
}

/** Tek bir audit log kaydını siler. Silme işlemi de LOG_DELETED marker ile loglanır. */
export function deleteAuditLog(id: number): AuditDeleteResult {
  if (!_dbRef) return { success: false, deletedCount: 0, error: 'DB hazır değil' };
  try {
    _dbRef.run(`DELETE FROM audit_log WHERE id = ?`, [id]);
    // Silme eyleminin kendisini kaydet (tamper marker) — chain'i sürdür.
    const timestamp = new Date().toISOString();
    const role = getAppRole();
    const detail = JSON.stringify({ reason: 'deleteAuditLog' });
    const target = `audit_log#${id}`;
    const prevHash = getLastAuditRowHash();
    const rowHash = computeAuditRowHash(timestamp, role, 'LOG_DELETED', target, detail, 'SUCCESS', prevHash);
    _dbRef.run(
      `INSERT INTO audit_log (timestamp, role, action, target, detail, result, prev_hash, row_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [timestamp, role, 'LOG_DELETED', target, detail, 'SUCCESS', prevHash, rowHash],
    );
    // Rust mirror — saveDatabase yerine
    mirrorAuditChangesToDisk({
      delete_ids: [id],
      inserts: [{
        timestamp, role, action: 'LOG_DELETED', target,
        detail, result: 'SUCCESS', prev_hash: prevHash, row_hash: rowHash,
      }],
    });
    return { success: true, deletedCount: 1 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (import.meta.env.DEV) console.error('[AuditLog] Tek kayıt silme hatası:', err);
    return { success: false, deletedCount: 0, error: msg };
  }
}

/**
 * Birden fazla audit log kaydını toplu siler.
 * Transaction loop — deleteAsset() pattern'i ile aynı.
 * Tamper marker: toplam silinen sayı transaction sonunda LOG_DELETED_BATCH ile loglanır.
 */
export function deleteAuditLogsBatch(ids: number[]): AuditDeleteResult {
  if (!_dbRef) return { success: false, deletedCount: 0, error: 'DB hazır değil' };
  if (ids.length === 0) return { success: true, deletedCount: 0 };
  try {
    // Marker'ı chain sonuna ekle — silinenler zincirde boşluk bırakır (tespit edilir).
    const timestamp = new Date().toISOString();
    const role = getAppRole();
    const detail = JSON.stringify({ deletedCount: ids.length, reason: 'deleteAuditLogsBatch' });
    const prevHash = getLastAuditRowHash();
    const rowHash = computeAuditRowHash(timestamp, role, 'LOG_DELETED_BATCH', 'audit_log', detail, 'SUCCESS', prevHash);
    _dbRef.run('BEGIN TRANSACTION');
    try {
      for (const id of ids) {
        _dbRef.run(`DELETE FROM audit_log WHERE id = ?`, [id]);
      }
      _dbRef.run(
        `INSERT INTO audit_log (timestamp, role, action, target, detail, result, prev_hash, row_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [timestamp, role, 'LOG_DELETED_BATCH', 'audit_log', detail, 'SUCCESS', prevHash, rowHash],
      );
      _dbRef.run('COMMIT');
    } catch (innerErr) {
      _dbRef.run('ROLLBACK');
      throw innerErr;
    }
    // Rust mirror — saveDatabase yerine
    mirrorAuditChangesToDisk({
      delete_ids: ids,
      inserts: [{
        timestamp, role, action: 'LOG_DELETED_BATCH', target: 'audit_log',
        detail, result: 'SUCCESS', prev_hash: prevHash, row_hash: rowHash,
      }],
    });
    return { success: true, deletedCount: ids.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (import.meta.env.DEV) console.error('[AuditLog] Toplu silme hatası:', err);
    return { success: false, deletedCount: 0, error: msg };
  }
}

/** Belirli bir tarihten eski audit log kayıtlarını siler. */
export function clearAuditLogsBefore(dateIso: string): AuditDeleteResult {
  if (!_dbRef) return { success: false, deletedCount: 0, error: 'DB hazır değil' };
  try {
    const stmt = _dbRef.prepare(`SELECT COUNT(*) AS cnt FROM audit_log WHERE timestamp < ?`);
    stmt.bind([dateIso]);
    let count = 0;
    if (stmt.step()) count = (stmt.getAsObject().cnt as number) ?? 0;
    stmt.free();

    if (count === 0) return { success: true, deletedCount: 0 };

    _dbRef.run(`DELETE FROM audit_log WHERE timestamp < ?`, [dateIso]);
    // Rust mirror — saveDatabase yerine
    mirrorAuditChangesToDisk({ delete_before_iso: dateIso });
    return { success: true, deletedCount: count };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (import.meta.env.DEV) console.error('[AuditLog] Tarih bazlı temizleme hatası:', err);
    return { success: false, deletedCount: 0, error: msg };
  }
}

/* ── Audit Log Integrity Verification ── */

export interface AuditIntegrityResult {
  /** Genel sonuç — tüm zincir tutarlıysa true. */
  valid: boolean;
  /** Doğrulanan toplam satır sayısı. */
  totalRows: number;
  /** Kırık satırların id listesi — zincir uyumsuz veya row_hash yanlış hesaplanmış. */
  brokenRowIds: number[];
  /** İlk kırık satırın id'si (hızlı bakış için). */
  firstBrokenId: number | null;
  /** row_hash/prev_hash kolonu NULL olan (migration eksik) satır sayısı. */
  missingHashCount: number;
  /** Hata durumunda mesaj (DB erişilemezse vs.). */
  error?: string;
}

/**
 * Audit log hash chain'ini baştan sona doğrular.
 *
 * Her satır için:
 *   - row_hash'ın doğru hesaplanmış olması (content + prev_hash)
 *   - prev_hash'ın önceki satırın row_hash'ine eşit olması (chain süreklilik)
 *
 * Kırıklıklar tamper (dışarıdan DB düzenleme) veya meşru LOG_CLEARED/LOG_DELETED
 * olabilir — kullanıcı aynı bölgedeki marker'ları kontrol etmeli. Marker yoksa
 * şüpheli tampering olarak değerlendirilmeli.
 */
export function verifyAuditLogIntegrity(): AuditIntegrityResult {
  if (!_dbRef) {
    return { valid: false, totalRows: 0, brokenRowIds: [], firstBrokenId: null, missingHashCount: 0, error: 'DB hazır değil' };
  }
  try {
    const result = _dbRef.exec(
      `SELECT id, timestamp, role, action, target, detail, result, prev_hash, row_hash
       FROM audit_log ORDER BY id ASC`
    );
    if (result.length === 0 || result[0].values.length === 0) {
      return { valid: true, totalRows: 0, brokenRowIds: [], firstBrokenId: null, missingHashCount: 0 };
    }

    const rows = result[0].values;
    const brokenRowIds: number[] = [];
    let missingHashCount = 0;
    let expectedPrev = '';

    for (const row of rows) {
      const id = row[0] as number;
      const timestamp = row[1] as string;
      const role = row[2] as string | null;
      const action = row[3] as string;
      const target = row[4] as string | null;
      const detail = row[5] as string | null;
      const res = row[6] as string;
      const prevHash = (row[7] as string | null) ?? '';
      const rowHash = (row[8] as string | null) ?? '';

      if (!rowHash) {
        missingHashCount++;
        brokenRowIds.push(id);
        // Chain referansını kaybettik — sonraki satırları da kırık sayma,
        // ama expectedPrev'i sıfırla ki yanlış chained-invalid üretmeyelim
        expectedPrev = '';
        continue;
      }

      // Chain kontrol: prev_hash, önceki satırın row_hash'ine eşit olmalı.
      // İlk satır, LOG_CLEARED marker'ı (prev_hash = '') ise chain sıfırlanması meşru.
      const chainBroken = prevHash !== expectedPrev;

      // row_hash doğru mu?
      const computedHash = computeAuditRowHash(timestamp, role, action, target, detail, res, prevHash);
      const hashMismatch = computedHash !== rowHash;

      if (chainBroken || hashMismatch) {
        brokenRowIds.push(id);
      }

      expectedPrev = rowHash;
    }

    return {
      valid: brokenRowIds.length === 0 && missingHashCount === 0,
      totalRows: rows.length,
      brokenRowIds,
      firstBrokenId: brokenRowIds[0] ?? null,
      missingHashCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, totalRows: 0, brokenRowIds: [], firstBrokenId: null, missingHashCount: 0, error: msg };
  }
}

/* ── 2. System Log (Rust tracing üzerinden) ── */

/**
 * Sistem logunu Rust backend'e iletir.
 * Rust tarafında tracing ile dosyaya yazılır.
 */
export async function systemLog(
  level: LogLevel,
  module: string,
  message: string,
): Promise<void> {
  // Rust'a ilet
  await tauriInvoke('write_system_log', {
    level,
    module,
    message,
  });

  // Fallback: konsola da yaz
  const prefix = `[${level}] [${module}]`;
  switch (level) {
    case 'ERROR':
      console.error(prefix, message);
      break;
    case 'WARN':
      console.warn(prefix, message);
      break;
    case 'INFO':
      console.info(prefix, message);
      break;
    default:
      if (import.meta.env.DEV) {
        console.debug(prefix, message);
      }
  }
}

/* ── 3. Debug Log ── */

/** Debug log — sadece DEV modda aktif, production'da sessiz */
export function debugLog(module: string, message: string, data?: unknown): void {
  if (!import.meta.env.DEV) return;
  if (data !== undefined) {
    console.debug(`[DEBUG] [${module}]`, message, data);
  } else {
    console.debug(`[DEBUG] [${module}]`, message);
  }
}

/* ── Yardımcı: Performans ölçümü ── */

/**
 * Bir işlemin süresini ölçer ve system log'a yazar.
 * Kullanım: const done = perfStart('scan'); ... done();
 */
export function perfStart(module: string, label: string): () => void {
  const start = performance.now();
  return () => {
    const elapsed = Math.round(performance.now() - start);
    systemLog('INFO', module, `${label}: ${elapsed}ms`);
  };
}
