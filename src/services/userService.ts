/**
 * ArchivistPro — Kullanıcı Servisi
 *
 * DB tabanlı kullanıcı yönetimi. SHA-256 hash ile şifre saklama.
 * Tüm yazımlar rusqlite (db_upsert_user / db_delete_user_row) üzerinden;
 * SQL.js DB export'u kullanılmaz — tek satırlık değişiklik için ana thread bloklamasın.
 */

import { getSetting } from './database';
import { auditLog, debugLog } from './logger';
import type { AppRole } from '../permissions/roles';
import i18n from '../i18n';

/** Kullanıcı satırını rusqlite ile doğrudan diske yazar. SQL.js export'tan bağımsız kalıcılık. */
async function _persistUserRow(row: {
    id: number; username: string; passwordHash: string;
    displayName: string | null; role: AppRole; avatar: string | null;
    isBlocked: boolean; isDeveloper: boolean; isFounder: boolean;
    createdAt: string; updatedAt: string;
}): Promise<void> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('db_upsert_user', {
            id: row.id,
            username: row.username,
            passwordHash: row.passwordHash,
            displayName: row.displayName,
            role: row.role,
            avatar: row.avatar,
            isBlocked: row.isBlocked,
            isDeveloper: row.isDeveloper,
            isFounder: row.isFounder,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        });
    } catch (err) {
        debugLog('UserService', 'db_upsert_user yazma hatası — diskteki kullanıcı satırı güncel olmayabilir', err);
    }
}

async function _deleteUserRow(id: number): Promise<void> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('db_delete_user_row', { id });
    } catch (err) {
        debugLog('UserService', 'db_delete_user_row fallback hatası', err);
    }
}

/* ── Tipler ── */

export interface UserInfo {
  id: number;
  username: string;
  displayName: string | null;
  role: AppRole;
  avatar: string | null;
  isBlocked: boolean;
  isDeveloper: boolean;
  isFounder: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  username: string;
  password: string;
  role: AppRole;
  displayName?: string;
  isDeveloper?: boolean;
}

export interface UpdateUserInput {
  displayName?: string;
  password?: string;
  role?: AppRole;
  avatar?: string | null;
  isBlocked?: boolean;
  isDeveloper?: boolean;
}

export interface UserResult {
  success: boolean;
  error?: string;
  userId?: number;
}

/* ── DB Referansı ── */

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

let _db: SqlJsDb | null = null;

export function setUserDb(db: unknown): void {
  _db = db as SqlJsDb;
}

/* ── Login Rate-Limit (localStorage-persistent) ──
 * Default: 5 başarısız deneme / 5 dakika pencerede → 5 dakika kilit.
 * Eşikler Settings'ten ayarlanabilir (login_max_attempts, login_lockout_minutes).
 * Pencere = lockout süresi (kullanıcı zihinsel modeli sade kalsın diye tek değişken).
 * Username başına; case-insensitive. localStorage'da tutulur — app/pencere kapanıp
 * açılsa da kilit korunur. Tauri webview localStorage app data altında persist eder.
 */

const DEFAULT_LOGIN_MAX_ATTEMPTS = 5;
const DEFAULT_LOGIN_LOCKOUT_MIN = 5;
const LOGIN_STORAGE_KEY = 'archivist_login_attempts';

function getLoginMaxAttempts(): number {
  try {
    const raw = getSetting('login_max_attempts');
    if (raw === null) return DEFAULT_LOGIN_MAX_ATTEMPTS;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return DEFAULT_LOGIN_MAX_ATTEMPTS;
    return Math.max(3, Math.min(20, n));
  } catch {
    return DEFAULT_LOGIN_MAX_ATTEMPTS;
  }
}

function getLoginLockoutMs(): number {
  try {
    const raw = getSetting('login_lockout_minutes');
    if (raw === null) return DEFAULT_LOGIN_LOCKOUT_MIN * 60_000;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return DEFAULT_LOGIN_LOCKOUT_MIN * 60_000;
    return Math.max(1, Math.min(120, n)) * 60_000;
  } catch {
    return DEFAULT_LOGIN_LOCKOUT_MIN * 60_000;
  }
}

interface LoginAttempt {
  count: number;
  firstFailMs: number;
  lockedUntilMs: number;
}

type AttemptsMap = Record<string, LoginAttempt>;

function readAttempts(): AttemptsMap {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(LOGIN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed as AttemptsMap : {};
  } catch {
    return {};
  }
}

function writeAttempts(map: AttemptsMap): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(map));
  } catch { /* quota / disabled — sessizce */ }
}

export interface LoginLockoutInfo {
  /** Kilitlenmişse kalan süre (ms). 0 = kilit yok. */
  remainingMs: number;
  /** İnsan-okur dakika (yukarı yuvarlanmış, en az 1). */
  remainingMinutes: number;
}

/** Kullanıcı şu anda kilitli mi? Değilse null. */
export function getLoginLockout(username: string): LoginLockoutInfo | null {
  const key = username.toLowerCase();
  const attempts = readAttempts();
  const entry = attempts[key];
  if (!entry) return null;
  const now = Date.now();
  if (entry.lockedUntilMs > now) {
    const remainingMs = entry.lockedUntilMs - now;
    return { remainingMs, remainingMinutes: Math.max(1, Math.ceil(remainingMs / 60_000)) };
  }
  if (entry.lockedUntilMs > 0 && entry.lockedUntilMs <= now) {
    delete attempts[key];
    writeAttempts(attempts);
  }
  return null;
}

function recordLoginFailure(username: string): void {
  const key = username.toLowerCase();
  const now = Date.now();
  const lockoutMs = getLoginLockoutMs(); // pencere = lockout aynı süre
  const maxAttempts = getLoginMaxAttempts();
  const attempts = readAttempts();
  const entry = attempts[key];
  if (!entry || (now - entry.firstFailMs) > lockoutMs) {
    attempts[key] = { count: 1, firstFailMs: now, lockedUntilMs: 0 };
  } else {
    entry.count += 1;
    if (entry.count >= maxAttempts) {
      entry.lockedUntilMs = now + lockoutMs;
    }
    attempts[key] = entry;
  }
  writeAttempts(attempts);
}

function clearLoginAttempts(username: string): void {
  const key = username.toLowerCase();
  const attempts = readAttempts();
  if (key in attempts) {
    delete attempts[key];
    writeAttempts(attempts);
  }
}

/** Test/diagnostic — tüm rate-limit state'ini sıfırlar. */
export function __resetLoginAttempts(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(LOGIN_STORAGE_KEY);
  } catch { /* sessizce */ }
}

/* ── Şifre Hash (PBKDF2-SHA256) ── */

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16; // bytes

/** PBKDF2-SHA256 ile salted hash üretir. Format: saltHex:hashHex */
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${saltHex}:${hashHex}`;
}

/** Eski SHA-256 hash (sadece migration doğrulaması için). */
async function legacyHash(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Hex string'i Uint8Array'e çevirir; geçersizse boş dizi döner. */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length === 0 || clean.length % 2 !== 0) return new Uint8Array(0);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return new Uint8Array(0);
    out[i] = byte;
  }
  return out;
}

/** Constant-time Uint8Array eşitlik kontrolü — timing attack'a karşı. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Şifre doğrulama. Hem yeni (salt:hash) hem eski (64-char hex) formatı destekler.
 *  Karşılaştırma constant-time; yanlış şifre uzunluğu bile sabit döner. */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.includes(':')) {
    // Yeni PBKDF2 format: saltHex:hashHex
    const [saltHex, expectedHashHex] = storedHash.split(':');
    const salt = hexToBytes(saltHex);
    const expected = hexToBytes(expectedHashHex);
    if (salt.length === 0 || expected.length === 0) return false;
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const hashBuffer = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: new Uint8Array(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      keyMaterial,
      256
    );
    return constantTimeEqual(new Uint8Array(hashBuffer), expected);
  } else {
    // Eski SHA-256 format (64 char hex) — migration uyumluluğu
    const hash = await legacyHash(password);
    return constantTimeEqual(hexToBytes(hash), hexToBytes(storedHash));
  }
}

/* ── Yardımcılar ── */

function rowToUser(row: Record<string, unknown>): UserInfo {
  return {
    id: row.id as number,
    username: row.username as string,
    displayName: (row.display_name as string) || null,
    role: row.role as AppRole,
    avatar: (row.avatar as string) || null,
    isBlocked: (row.is_blocked as number) === 1,
    isDeveloper: (row.is_developer as number) === 1,
    isFounder: (row.is_founder as number) === 1,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function queryUser(sql: string, params: unknown[]): UserInfo | null {
  if (!_db) return null;
  try {
    const stmt = _db.prepare(sql);
    stmt.bind(params);
    let user: UserInfo | null = null;
    if (stmt.step()) {
      user = rowToUser(stmt.getAsObject());
    }
    stmt.free();
    return user;
  } catch (err) {
    debugLog('UserService', 'query error', err);
    return null;
  }
}

function queryUsers(sql: string, params: unknown[] = []): UserInfo[] {
  if (!_db) return [];
  try {
    const stmt = _db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    const results: UserInfo[] = [];
    while (stmt.step()) {
      results.push(rowToUser(stmt.getAsObject()));
    }
    stmt.free();
    return results;
  } catch (err) {
    debugLog('UserService', 'query error', err);
    return [];
  }
}

/* ── İlk Kurulum ── */

/** İlk çalıştırmada varsayılan admin hesabı oluşturur. */
export async function ensureDefaultAdmin(): Promise<void> {
  if (!_db) return;
  try {
    const result = _db.exec('SELECT COUNT(*) FROM users');
    const count = result.length > 0 ? (result[0].values[0][0] as number) : 0;
    if (count === 0) {
      await createUser({
        username: 'admin',
        password: 'admin',
        role: 'admin',
        displayName: i18n.t('userService.defaultAdminName'),
      });
    }
  } catch (err) {
    debugLog('UserService', 'ensureDefaultAdmin error', err);
  }
}

/* ── CRUD ── */

/** Yeni kullanıcı oluştur. */
export async function createUser(input: CreateUserInput): Promise<UserResult> {
  if (!_db) return { success: false, error: i18n.t('userService.dbNotReady') };

  if (!input.username.trim() || !input.password.trim()) {
    return { success: false, error: i18n.t('userService.usernameRequired') };
  }

  if (input.username.length < 3 || input.username.length > 32) {
    return { success: false, error: i18n.t('userService.usernameLengthError') };
  }
  if (input.password.length > 128) {
    return { success: false, error: i18n.t('userService.passwordTooLong') };
  }

  // Uniqueness check
  const existing = queryUser('SELECT * FROM users WHERE username = ?', [input.username.toLowerCase()]);
  if (existing) {
    return { success: false, error: i18n.t('userService.usernameTaken') };
  }

  try {
    const hash = await hashPassword(input.password);
    const now = new Date().toISOString();
    // İlk admin otomatik kurucu olur
    const isFounder = input.role === 'admin' && getFounderCount() === 0;
    _db.run(
      `INSERT INTO users (username, password_hash, display_name, role, is_developer, is_founder, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.username.toLowerCase(), hash, input.displayName || null, input.role, input.isDeveloper ? 1 : 0, isFounder ? 1 : 0, now, now],
    );
    const result = _db.exec('SELECT last_insert_rowid() AS id');
    const id = (result[0]?.values[0]?.[0] as number) ?? -1;
    _persistUserRow({
        id, username: input.username.toLowerCase(), passwordHash: hash,
        displayName: input.displayName || null, role: input.role, avatar: null,
        isBlocked: false, isDeveloper: input.isDeveloper ?? false, isFounder,
        createdAt: now, updatedAt: now,
    });
    auditLog('USER_CREATE', input.username, { role: input.role });
    return { success: true, userId: id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog('UserService', 'createUser error', err);
    return { success: false, error: msg };
  }
}

/** Kullanıcı güncelle. Sadece verilen alanlar değişir. */
export async function updateUser(id: number, input: UpdateUserInput): Promise<UserResult> {
  if (!_db) return { success: false, error: i18n.t('userService.dbNotReady') };

  const fields: string[] = [];
  const params: unknown[] = [];

  if (input.displayName !== undefined) {
    fields.push('display_name = ?');
    params.push(input.displayName);
  }
  if (input.password !== undefined) {
    if (input.password.length > 128) {
      return { success: false, error: i18n.t('userService.passwordTooLong') };
    }
    const hash = await hashPassword(input.password);
    fields.push('password_hash = ?');
    params.push(hash);
  }
  if (input.role !== undefined) {
    const target = getUserById(id);
    if (target?.isFounder && input.role !== 'admin') {
      return { success: false, error: i18n.t('userService.cannotDemoteFounder') };
    }
    fields.push('role = ?');
    params.push(input.role);
  }
  if (input.avatar !== undefined) {
    fields.push('avatar = ?');
    params.push(input.avatar);
  }
  if (input.isBlocked !== undefined) {
    fields.push('is_blocked = ?');
    params.push(input.isBlocked ? 1 : 0);
  }
  if (input.isDeveloper !== undefined) {
    fields.push('is_developer = ?');
    params.push(input.isDeveloper ? 1 : 0);
  }

  if (fields.length === 0) return { success: true };

  fields.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  try {
    _db.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);
    const updated = getUserById(id);
    if (updated && _db) {
      let hash = '';
      try {
        const stmt = _db.prepare('SELECT password_hash FROM users WHERE id = ?');
        stmt.bind([id]);
        if (stmt.step()) hash = (stmt.getAsObject().password_hash as string) ?? '';
        stmt.free();
      } catch { /* hash kalır boş */ }
      _persistUserRow({
        id: updated.id, username: updated.username, passwordHash: hash,
        displayName: updated.displayName || null, role: updated.role,
        avatar: updated.avatar || null, isBlocked: updated.isBlocked,
        isDeveloper: updated.isDeveloper, isFounder: updated.isFounder,
        createdAt: updated.createdAt, updatedAt: updated.updatedAt,
      });
    }
    const updatedFields = Object.keys(input).filter(k => (input as Record<string, unknown>)[k] !== undefined);
    auditLog('USER_UPDATE', `user#${id}`, { fields: updatedFields });
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog('UserService', 'updateUser error', err);
    return { success: false, error: msg };
  }
}

/** Kullanıcı sil. */
export function deleteUser(id: number): UserResult {
  if (!_db) return { success: false, error: i18n.t('userService.dbNotReady') };
  const user = getUserById(id);
  if (user?.isFounder) {
    return { success: false, error: i18n.t('userService.cannotDeleteFounder') };
  }
  try {
    _db.run('DELETE FROM users WHERE id = ?', [id]);
    _deleteUserRow(id);
    auditLog('USER_DELETE', user?.username || `user#${id}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    debugLog('UserService', 'deleteUser error', err);
    return { success: false, error: msg };
  }
}

/* ── Sorgular ── */

/** Login doğrulaması. Başarısızsa null döner. Eski hash formatını otomatik migrate eder.
 *  Rate-limit: 5 yanlış deneme / 5 dk → 5 dk kilit. Lockout durumunda da null döner;
 *  UI getLoginLockout() ile farklı mesaj göstermeli.
 */
export async function getUserByCredentials(username: string, password: string): Promise<UserInfo | null> {
  if (!_db) return null;

  // Lockout kontrolü — kilitli kullanıcıyı DB'ye bile sorma
  if (getLoginLockout(username)) return null;

  // Sadece kullanıcı adıyla sorgula (salted hash ile SQL WHERE yapılamaz)
  let storedHash: string | null = null;
  let user: UserInfo | null = null;
  try {
    const stmt = _db.prepare(
      'SELECT id, username, display_name, role, avatar, is_blocked, is_developer, is_founder, created_at, updated_at, password_hash FROM users WHERE username = ?'
    );
    stmt.bind([username.toLowerCase()]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      storedHash = row.password_hash as string;
      user = rowToUser(row);
    }
    stmt.free();
  } catch (err) {
    debugLog('UserService', 'getUserByCredentials query error', err);
    return null;
  }

  if (!user || !storedHash) {
    // Username yok → yine de attempt say (username enumeration'a karşı tutarlı davran)
    recordLoginFailure(username);
    return null;
  }

  // Şifre doğrula
  const valid = await verifyPassword(password, storedHash);
  if (!valid) {
    recordLoginFailure(username);
    return null;
  }

  // Başarılı login → varsa attempt kaydını temizle
  clearLoginAttempts(username);

  // Eski format ise (64-char hex, ':' içermez) otomatik migrate et
  if (!storedHash.includes(':')) {
    try {
      const newHash = await hashPassword(password);
      _db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
      _persistUserRow({
        id: user.id, username: user.username, passwordHash: newHash,
        displayName: user.displayName, role: user.role, avatar: user.avatar,
        isBlocked: user.isBlocked, isDeveloper: user.isDeveloper, isFounder: user.isFounder,
        createdAt: user.createdAt, updatedAt: user.updatedAt,
      });
    } catch (err) {
      debugLog('UserService', 'Password migration failed (non-critical)', err);
    }
  }

  return user;
}

/** Tüm kullanıcılar (şifre hariç). */
export function getAllUsers(): UserInfo[] {
  return queryUsers('SELECT id, username, display_name, role, avatar, is_blocked, is_developer, is_founder, created_at, updated_at FROM users ORDER BY id');
}

/** ID ile kullanıcı getir. */
export function getUserById(id: number): UserInfo | null {
  return queryUser(
    'SELECT id, username, display_name, role, avatar, is_blocked, is_developer, is_founder, created_at, updated_at FROM users WHERE id = ?',
    [id],
  );
}

/** Toplam kullanıcı sayısı (ilk kurulum tespiti için). */
export function getUserCount(): number {
  if (!_db) return 0;
  try {
    const result = _db.exec('SELECT COUNT(*) FROM users');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  } catch { return 0; }
}

/** Admin sayısı (son admin koruması için). */
export function getAdminCount(): number {
  if (!_db) return 0;
  try {
    const result = _db.exec("SELECT COUNT(*) FROM users WHERE role = 'admin'");
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  } catch { return 0; }
}

/** Kurucu admin sayısı (ilk admin tespiti için). */
export function getFounderCount(): number {
  if (!_db) return 0;
  try {
    const result = _db.exec("SELECT COUNT(*) FROM users WHERE is_founder = 1");
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  } catch { return 0; }
}
