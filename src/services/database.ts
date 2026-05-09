/**
 * Archivist Pro — SQLite Veritabanı Servisi (sql.js WASM)
 *
 * İlişkisel metadata + vektör arama için yerel SQLite veritabanı.
 * Tarayıcıda tamamen offline çalışır. Dynamic import ile yüklenir.
 *
 * Depolama: Tauri uygulamasında disk (appDataDir/archivist.db),
 *           web/geliştirme ortamında localStorage fallback.
 */
import type { Asset, AssetType, CategoryType, ProjectPhase, MaterialGroup, ColorTheme, ArchitecturalStyle, ApprovalStatus, AssetRelation, RelationType } from '../types';
import { buildBaselineRecord, computeCompositeVersion } from './extractorRegistry';
import { detectVersion } from './versionDetection';
import { getAppRole } from '../permissions/roles';
import { setLoggerDb, debugLog, computeAuditRowHash } from './logger';
import { setTagDb } from './tagService';
import { setFavoritesDb } from './favorites';
import { setMessageDb } from './messageService';
import { setUserDb } from './userService';
import { setRootTagDb } from './rootTagService';

// Tauri invoke — sadece Tauri ortamında mevcuttur
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<T>(cmd, args);
    } catch {
        return null;
    }
}

/** Tauri void komutları için: başarıda true, hata/Tauri-yok durumunda false döner. */
async function tauriVoidInvoke(cmd: string, args?: Record<string, unknown>): Promise<boolean> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke(cmd, args);
        return true;
    } catch {
        return false;
    }
}

export async function setDatabasePath(path: string): Promise<void> {
    await tauriInvoke('set_database_path', { path });
}

export async function setLocalDatabasePath(path: string): Promise<void> {
    await tauriInvoke('set_local_database_path', { path });
}

type SqlJsDatabase = {
    run: (sql: string, params?: unknown[]) => void;
    exec: (sql: string, params?: unknown[]) => Array<{ columns: string[]; values: unknown[][] }>;
    prepare: (sql: string) => {
        bind: (params: unknown[]) => void;
        step: () => boolean;
        getAsObject: () => Record<string, unknown>;
        free: () => void;
    };
    export: () => Uint8Array;
};

/* ── Çoklu Arşiv Desteği ── */
export type ArchiveType = string;

export const MAIN_ARCHIVE_ID = 'main' as const;
export const LOCAL_ARCHIVE_ID = 'local' as const;

export interface ArchiveDef {
    id: string;
    name: string;
    type: 'shared' | 'personal';
    dbPath?: string;
    createdAt: string;
    color?: string;
}

export interface ScannedRoot {
    id: string;
    path: string;
    label: string;
    addedAt: string;
    lastScan: string | null;
    fileCount: number;
    status: 'active' | 'removed';
    groupId: string | null;
    isFavorite: boolean;
}

export interface RootGroup {
    id: string;
    name: string;
    color: string;
    sortOrder: number;
    createdAt: string;
}

const dbMap = new Map<string, SqlJsDatabase>();
let activeArchive: ArchiveType = MAIN_ARCHIVE_ID;
let archiveRegistry: ArchiveDef[] = [];

/** Uyumluluk erişimcileri — eski mainDb/localDb referansları yerine */
function getMainDb(): SqlJsDatabase | null { return dbMap.get(MAIN_ARCHIVE_ID) ?? null; }
function getLocalDb(): SqlJsDatabase | null { return dbMap.get(LOCAL_ARCHIVE_ID) ?? null; }

/** Arşiv kayıt defterinden tanımı döndürür */
export function getArchiveDef(id: string): ArchiveDef | undefined {
    return archiveRegistry.find(a => a.id === id);
}

/** Arşiv kayıt defterini günceller (store'dan çağrılır) */
export function setArchiveRegistry(archives: ArchiveDef[]): void {
    archiveRegistry = archives;
}

/**
 * Arşiv IO komutlarını çözümler (Tauri cmd + localStorage key + extra args).
 * main/local sabit komutlarla çalışır, diğer arşivler generic write_archive komutuna
 * archiveId parametresi gönderir.
 */
function resolveArchiveIO(archiveId: string): {
    tauriCmd: string;
    storageKey: string;
    extraArgs?: Record<string, unknown>;
} {
    if (archiveId === MAIN_ARCHIVE_ID) return { tauriCmd: 'write_database', storageKey: 'archivist_db' };
    if (archiveId === LOCAL_ARCHIVE_ID) return { tauriCmd: 'write_local_database', storageKey: 'archivist_local_db' };
    return {
        tauriCmd: 'write_archive',
        storageKey: `archivist_archive_${archiveId}`,
        extraArgs: { archiveId },
    };
}

/** Aktif arşivi değiştirir — db referansını da günceller */
export function setActiveArchive(archive: ArchiveType): void {
    activeArchive = archive;
    db = dbMap.get(archive) ?? null;
    if (db) {
        setTagDb(db);
        setFavoritesDb(db);
        setRootTagDb(db);
    }
    // Mesajlar ve loglar her zaman mainDb'de kalır (admin-viewer paylaşımlı)
    const main = getMainDb();
    if (main) {
        setLoggerDb(main);
        setMessageDb(main);
    }
}

/** Aktif arşiv tipini döndürür */
export function getActiveArchive(): ArchiveType {
    return activeArchive;
}

/**
 * Verilen arşivde bir işlemi aktif arşivi bozmadan çalıştırır.
 * İşlem sırasında global `db` referansı geçici olarak target'a kayar.
 * try/finally ile her koşulda orijinal aktif arşive geri döner.
 *
 * Uyarı: İşlem içinde çağrılan tüm yazma fonksiyonları (upsertAsset,
 * saveEmbedding vb.) hedef arşive yazar. İşlem sonunda saveDatabase()
 * çağrısını op() içinde yapmak sorumluluğunuzdadır.
 */
export async function withArchive<T>(archiveId: string, op: () => Promise<T> | T): Promise<T> {
    const targetDb = dbMap.get(archiveId);
    if (!targetDb) throw new Error(`Arşiv yüklü değil: ${archiveId}`);
    const originalActive = activeArchive;
    try {
        setActiveArchive(archiveId);
        return await op();
    } finally {
        setActiveArchive(originalActive);
    }
}

/**
 * Path'in sonuna ayırıcı ekler (yoksa). LIKE pattern ve startsWith karşılaştırmalarında
 * "C:\Proje1" patterninin "C:\Proje1_Backup" ile yanlış eşleşmesini engeller.
 */
function ensureTrailingSep(p: string): string {
    if (p.endsWith('/') || p.endsWith('\\')) return p;
    return p + (p.includes('\\') ? '\\' : '/');
}

/** Viewer rolünde paylaşımlı (shared) arşive yazma girişimini engeller */
function assertWriteAccess(): void {
    const def = getArchiveDef(activeArchive);
    if (def?.type === 'shared' && getAppRole() === 'viewer') {
        throw new Error('Paylaşımlı arşive yazma yetkiniz yok (Viewer rolü)');
    }
}

// Eski `db` değişkeni geriye uyumluluk için — aktif DB'ye yönlendirir
let db: SqlJsDatabase | null = null;

/** true ise bu oturumda bozuk bir DB tespit edildi ve temiz başlatıldı */
let _dbRecoveryOccurred = false;
export function wasDbRecovered(): boolean { return _dbRecoveryOccurred; }
export function clearDbRecovery(): void { _dbRecoveryOccurred = false; }

/**
 * Ana veritabanını başlat ve şema oluştur.
 * Admin: ana DB'yi tam yetkili açar.
 * Viewer: ana DB'yi salt-okunur açar.
 */
export async function initDatabase(): Promise<SqlJsDatabase> {
    if (db) return db;

    try {
        const sqlJsModule = await import('sql.js');
        const initSqlJs: (config?: Record<string, unknown>) => Promise<any> =
            typeof sqlJsModule.default === 'function' ? sqlJsModule.default : (sqlJsModule as any);
        const SQL = await initSqlJs({
            locateFile: () => '/sql-wasm.wasm',
        });

        // 1. Önce diskten yüklemeyi dene (Tauri ortamı)
        // İki adımlı: önce meta (corruption/lock/boyut), sonra binary IPC ile raw bytes.
        // Bu büyük DB'lerde JSON Vec<u8> serialize maliyetini elimine eder.
        const meta = await tauriInvoke<{ exists: boolean; sizeBytes: number; corrupted: boolean; lockedByOther: boolean }>('read_database_meta');
        if (meta?.corrupted) {
            _dbRecoveryOccurred = true;
            debugLog('Database', 'Rust: DB dosyası bozuk (magic byte), temiz veritabanı oluşturuluyor.');
        }
        if (meta?.lockedByOther) {
            debugLog('Database', 'Uyarı: DB dosyası başka bir işlem tarafından yazılıyor.');
            try {
                const { notifyWarning } = await import('./notificationCenter');
                const { default: i18n } = await import('../i18n');
                notifyWarning(
                    i18n.t('database.lockWarningTitle'),
                    i18n.t('database.lockWarningMessage'),
                );
            } catch { /* bildirim servisi henüz hazır değilse sessizce geç */ }
        }

        if (meta?.exists && meta.sizeBytes > 0) {
            const buffer = await tauriInvoke<ArrayBuffer>('read_database_binary');
            if (buffer && buffer.byteLength > 0) {
                const buf = new Uint8Array(buffer);
                try {
                    db = new SQL.Database(buf) as unknown as SqlJsDatabase;
                    db.exec('SELECT 1');
                } catch {
                    debugLog('Database', 'Frontend: DB dosyası bozuk (iç yapı), temiz veritabanı oluşturuluyor.');
                    db = new SQL.Database() as unknown as SqlJsDatabase;
                    _dbRecoveryOccurred = true;
                }
                localStorage.removeItem('archivist_db');
            } else {
                db = new SQL.Database() as unknown as SqlJsDatabase;
            }
        } else {
            // 2. localStorage'dan göç et (eski sürümden yükseltme)
            const saved = localStorage.getItem('archivist_db');
            if (saved) {
                const buf = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
                db = new SQL.Database(buf) as unknown as SqlJsDatabase;
                // Disk'e yaz ve localStorage'ı temizle (tek seferlik göç)
                const migrationData = db.export();
                tauriInvoke('write_database', { data: Array.from(migrationData) }).then(() => {
                    localStorage.removeItem('archivist_db');
                    debugLog('Database', 'Veritabanı localStorage\'dan diske taşındı.');
                }).catch(() => {
                    // Tauri yoksa (web geliştirme) localStorage'ı koru
                });
            } else {
                db = new SQL.Database() as unknown as SqlJsDatabase;
            }
        }

        // Foreign key desteğini etkinleştir (sql.js'te varsayılan kapalı)
        db.run('PRAGMA foreign_keys = ON');

        // Şemaları oluştur
        _applySchema(db);
        _applyMigrations(db);

        // 30 günden eski çöp öğeleri otomatik temizle (non-fatal)
        try { _purgeExpiredTrashInternal(db); } catch { /* sessizce devam et */ }

        // Çoklu arşiv: ana arşiv olarak dbMap'e kaydet
        dbMap.set(MAIN_ARCHIVE_ID, db);

        // Servislere DB referansı ver
        setLoggerDb(db);
        setTagDb(db);
        setFavoritesDb(db);
        setMessageDb(db);
        setUserDb(db);

        return db;
    } catch (err) {
        debugLog('Database', 'init error', err);
        throw err;
    }
}

/**
 * Disk DB'yi yeniden okuyarak WASM SQLite'ı günceller.
 * Import/download sonrası oturumu koruyarak veriyi tazeler.
 */
export async function reloadDatabase(): Promise<void> {
    const meta = await tauriInvoke<{ exists: boolean; sizeBytes: number; corrupted: boolean }>('read_database_meta');
    if (!meta?.exists || meta.sizeBytes === 0) return;

    const buffer = await tauriInvoke<ArrayBuffer>('read_database_binary');
    if (!buffer || buffer.byteLength === 0) return;

    const sqlJsModule = await import('sql.js');
    const initSqlJs: (config?: Record<string, unknown>) => Promise<any> =
        typeof sqlJsModule.default === 'function' ? sqlJsModule.default : (sqlJsModule as any);
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });

    const buf = new Uint8Array(buffer);
    const newDb = new SQL.Database(buf) as unknown as SqlJsDatabase;
    newDb.run('PRAGMA foreign_keys = ON');
    _applySchema(newDb);
    _applyMigrations(newDb);

    // Referansları güncelle
    db = newDb;
    dbMap.set(MAIN_ARCHIVE_ID, newDb);
    setLoggerDb(newDb);
    setTagDb(newDb);
    setFavoritesDb(newDb);
    setMessageDb(newDb);
    setUserDb(newDb);
}

/**
 * Belirtilen arşivi diskten yeniden yükler ve in-memory DB'yi günceller.
 * Snapshot restore sonrası çağrılmalı.
 * @param archiveType "main" veya "local"
 */
export async function reloadDatabaseForArchive(archiveType: string): Promise<void> {
    if (archiveType !== LOCAL_ARCHIVE_ID) {
        return reloadDatabase();
    }

    const diskBytes = await tauriInvoke<number[]>('read_local_database');
    if (!diskBytes || diskBytes.length === 0) return;

    const sqlJsModule = await import('sql.js');
    const initSqlJs: (config?: Record<string, unknown>) => Promise<any> =
        typeof sqlJsModule.default === 'function' ? sqlJsModule.default : (sqlJsModule as any);
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });

    const buf = new Uint8Array(diskBytes);
    const newLocalDb = new SQL.Database(buf) as unknown as SqlJsDatabase;
    newLocalDb.run('PRAGMA foreign_keys = ON');
    _applySchema(newLocalDb);
    _applyMigrations(newLocalDb);

    dbMap.set(LOCAL_ARCHIVE_ID, newLocalDb);

    // Aktif arşiv local ise db pointer'ını ve servis referanslarını güncelle
    if (activeArchive === LOCAL_ARCHIVE_ID) {
        db = newLocalDb;
        setTagDb(newLocalDb);
        setFavoritesDb(newLocalDb);
        const main = getMainDb();
        if (main) {
            setLoggerDb(main);
            setMessageDb(main);
        }
    }
}

/* ── Vektör binary serileştirme (Float32) ────────────────────────── */

/** number[] → Uint8Array (Float32 binary, ~2.25x daha kompakt + ~10-20x daha hızlı parse) */
function vectorToBlob(vector: number[]): Uint8Array {
    const f32 = new Float32Array(vector);
    return new Uint8Array(f32.buffer);
}

/** Uint8Array → number[] */
function blobToVector(blob: Uint8Array): number[] {
    const f32 = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    return Array.from(f32);
}

/**
 * Satırdan vektör çöz: vector_blob varsa binary oku, yoksa vector_json fallback.
 * Migration geçiş döneminde her iki format da desteklenir.
 */
function parseVectorFromRow(blobVal: unknown, jsonVal: unknown): number[] | null {
    if (blobVal instanceof Uint8Array && blobVal.byteLength > 0) {
        return blobToVector(blobVal);
    }
    if (typeof jsonVal === 'string' && jsonVal.length > 2) {
        return JSON.parse(jsonVal);
    }
    return null;
}

/**
 * Mevcut JSON vektörlerini Float32 binary blob'a dönüştürür.
 * Tek seferlik migration — vector_blob kolonu eklendiğinde çağrılır.
 */
function _migrateEmbeddingsJsonToBlob(target: SqlJsDatabase): void {
    try {
        const countResult = target.exec(
            "SELECT COUNT(*) FROM embeddings WHERE vector_blob IS NULL AND vector_json IS NOT NULL AND vector_json != ''"
        );
        const count = (countResult[0]?.values[0]?.[0] as number) ?? 0;
        if (count === 0) return;

        debugLog('Database', `Migrating ${count} embeddings from JSON to binary...`);
        const rows = target.exec(
            "SELECT id, vector_json FROM embeddings WHERE vector_blob IS NULL AND vector_json IS NOT NULL AND vector_json != ''"
        );
        if (!rows.length || !rows[0].values.length) return;

        target.run('BEGIN TRANSACTION');
        try {
            const stmt = target.prepare("UPDATE embeddings SET vector_blob = ?, vector_json = '' WHERE id = ?") as { bind: (p: unknown[]) => void; step: () => boolean; getAsObject: () => Record<string, unknown>; free: () => void; run: (p: unknown[]) => void };
            for (const row of rows[0].values) {
                try {
                    const vector = JSON.parse(row[1] as string);
                    stmt.run([vectorToBlob(vector), row[0] as string]);
                } catch { /* geçersiz JSON — atla */ }
            }
            stmt.free();
            target.run('COMMIT');
            debugLog('Database', `Migration complete: ${count} embeddings converted to binary`);
        } catch (err) {
            target.run('ROLLBACK');
            debugLog('Database', 'Embedding blob migration transaction error', err);
        }
    } catch (err) {
        debugLog('Database', 'Embedding blob migration error', err);
    }
}

/** Veritabanı şemasını uygular (her iki arşiv için ortak) */
function _applySchema(target: SqlJsDatabase): void {
    target.run(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        file_type TEXT,
        category TEXT,
        created_at TEXT,
        modified_at TEXT,
        project_name TEXT,
        project_phase TEXT,
        material_group TEXT,
        color_theme TEXT,
        architectural_style TEXT,
        omniclass_code TEXT,
        is_indexed INTEGER DEFAULT 0,
        hash TEXT,
        phash TEXT,
        content_hash TEXT,
        metadata_json TEXT,
        ai_tags_json TEXT,
        color_palette_json TEXT,
        thumbnail_url TEXT,
        raw_metadata TEXT,
        metadata_version INTEGER DEFAULT 1,
        applied_extractors TEXT,
        extracted_at TEXT,
        rag_status TEXT,
        rag_status_reason TEXT,
        fs_mtime INTEGER
      )
    `);

    target.run(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        ref_id TEXT,
        vector_json TEXT,
        vector_blob BLOB,
        source TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      )
    `);

    target.run(`
      CREATE TABLE IF NOT EXISTS text_chunks (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        page INTEGER,
        text TEXT NOT NULL,
        lang TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      )
    `);

    target.run(`
      CREATE TABLE IF NOT EXISTS asset_summaries (
        asset_id TEXT PRIMARY KEY,
        summary TEXT NOT NULL,
        keywords_json TEXT NOT NULL,
        model TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
      )
    `);

    target.run(`CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      phase TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    target.run(`CREATE TABLE IF NOT EXISTS scan_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      directory TEXT NOT NULL,
      scanned_at TEXT DEFAULT (datetime('now')),
      total_files INTEGER,
      indexed_files INTEGER,
      errors INTEGER DEFAULT 0
    )`);

    target.run(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      result TEXT NOT NULL DEFAULT 'SUCCESS',
      prev_hash TEXT,
      row_hash TEXT
    )`);

    target.run(`CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    target.run(`CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (asset_id, tag_id),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )`);

    target.run(`CREATE TABLE IF NOT EXISTS favorites (
      asset_id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    )`);

    target.run(`CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#a855f7',
      created_at TEXT DEFAULT (datetime('now'))
    )`);

    target.run(`CREATE TABLE IF NOT EXISTS collection_items (
      collection_id INTEGER NOT NULL,
      asset_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (collection_id, asset_id),
      FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    )`);

    // Faz 1.5: Kaynak Klasör Paneli — taranan kök dizinlerin kaydı
    target.run(`CREATE TABLE IF NOT EXISTS scanned_roots (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      added_at TEXT DEFAULT (datetime('now')),
      last_scan TEXT,
      file_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    )`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_scanned_roots_path ON scanned_roots(path)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_scanned_roots_status ON scanned_roots(status)`);

    // Faz 2: Kaynak klasör grupları
    target.run(`CREATE TABLE IF NOT EXISTS root_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366f1',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_root_groups_sort ON root_groups(sort_order)`);

    // Faz 2: Klasör etiket ilişkileri (mevcut tags tablosunu yeniden kullanır)
    target.run(`CREATE TABLE IF NOT EXISTS root_tags (
      root_id TEXT NOT NULL,
      tag_id INTEGER NOT NULL,
      PRIMARY KEY (root_id, tag_id),
      FOREIGN KEY (root_id) REFERENCES scanned_roots(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    )`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_root_tags_root ON root_tags(root_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_root_tags_tag ON root_tags(tag_id)`);

    target.run(`CREATE INDEX IF NOT EXISTS idx_collection_items_col ON collection_items(collection_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_asset_tags_asset ON asset_tags(asset_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_asset_tags_tag ON asset_tags(tag_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_name)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(file_type)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_embeddings_asset ON embeddings(asset_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_embeddings_ref ON embeddings(ref_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_chunks_asset ON text_chunks(asset_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp)`);

    target.run(`CREATE TABLE IF NOT EXISTS user_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      recipient TEXT,
      message_type TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'normal',
      subject TEXT,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'unread',
      parent_id INTEGER,
      assigned_to TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (parent_id) REFERENCES user_messages(id) ON DELETE CASCADE
    )`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_user_messages_sender ON user_messages(sender)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_user_messages_status ON user_messages(status)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_user_messages_parent ON user_messages(parent_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_user_messages_recipient ON user_messages(recipient)`);

    target.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL DEFAULT 'viewer',
      avatar TEXT,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      is_developer INTEGER NOT NULL DEFAULT 0,
      is_founder INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    target.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)`);

    target.run(`CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);

    // Dosya ilişkileri
    target.run(`CREATE TABLE IF NOT EXISTS asset_relations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      created_by TEXT DEFAULT 'user',
      FOREIGN KEY(source_id) REFERENCES assets(id) ON DELETE CASCADE,
      FOREIGN KEY(target_id) REFERENCES assets(id) ON DELETE CASCADE
    )`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_relations_source ON asset_relations(source_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_relations_target ON asset_relations(target_id)`);

    // RAG Q&A — sohbet oturumları ve mesajları (v2.3.0)
    target.run(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scope_json TEXT,
      model TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC)`);

    target.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations_json TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    )`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at)`);

    // Faz 4.1 + 4.4 — Geometrik DWG shape index (gelişmiş özelliklerle)
    target.run(`CREATE TABLE IF NOT EXISTS dwg_shapes (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      layer_name TEXT,
      layer_category TEXT,
      entity_type TEXT,
      vertex_count INTEGER,
      is_closed INTEGER,
      area REAL,
      perimeter REAL,
      aspect_ratio REAL,
      regularity REAL,
      bbox_w REAL,
      bbox_h REAL,
      centroid_x REAL,
      centroid_y REAL,
      compactness REAL DEFAULT 0,
      solidity REAL DEFAULT 0,
      rectangularity REAL DEFAULT 0,
      indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    )`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_dwg_shapes_asset ON dwg_shapes(asset_id)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_dwg_shapes_vertex ON dwg_shapes(vertex_count)`);
    target.run(`CREATE INDEX IF NOT EXISTS idx_dwg_shapes_category ON dwg_shapes(layer_category)`);
}

/** Eski veritabanlarına migration uygular */
function _applyMigrations(target: SqlJsDatabase): void {
    try {
        const tableInfo = target.exec(`PRAGMA table_info(assets)`);
        if (tableInfo.length > 0) {
            const columns = tableInfo[0].values.map(row => row[1] as string);
            if (!columns.includes('thumbnail_url')) {
                target.run(`ALTER TABLE assets ADD COLUMN thumbnail_url TEXT`);
            }
            if (!columns.includes('phash')) {
                target.run(`ALTER TABLE assets ADD COLUMN phash TEXT`);
            }
            if (!columns.includes('raw_metadata')) {
                target.run(`ALTER TABLE assets ADD COLUMN raw_metadata TEXT`);
            }
            if (!columns.includes('metadata_version')) {
                target.run(`ALTER TABLE assets ADD COLUMN metadata_version INTEGER DEFAULT 1`);
            }
            if (!columns.includes('applied_extractors')) {
                target.run(`ALTER TABLE assets ADD COLUMN applied_extractors TEXT`);
            }
            if (!columns.includes('extracted_at')) {
                target.run(`ALTER TABLE assets ADD COLUMN extracted_at TEXT`);
            }
            if (!columns.includes('rag_status')) {
                target.run(`ALTER TABLE assets ADD COLUMN rag_status TEXT`);
            }
            if (!columns.includes('rag_status_reason')) {
                target.run(`ALTER TABLE assets ADD COLUMN rag_status_reason TEXT`);
            }
        }
    } catch { /* Kolon zaten varsa sessizce devam et */ }

    try {
        const tableInfo = target.exec(`PRAGMA table_info(embeddings)`);
        if (tableInfo.length > 0) {
            const columns = tableInfo[0].values.map(row => row[1] as string);
            if (!columns.includes('ref_id')) {
                target.run(`ALTER TABLE embeddings ADD COLUMN ref_id TEXT`);
            }
            if (!columns.includes('vector_blob')) {
                target.run(`ALTER TABLE embeddings ADD COLUMN vector_blob BLOB`);
                // Mevcut JSON vektörlerini binary'ye dönüştür
                _migrateEmbeddingsJsonToBlob(target);
            }
        }
    } catch { /* sessizce devam et */ }

    try {
        target.run(`UPDATE embeddings SET source = 'chunk_ocr' WHERE source = 'chunk_text' AND ref_id LIKE '%_ocr%'`);
    } catch { /* sessizce devam et */ }

    try {
        const bakResult = target.exec(`SELECT id, file_name FROM assets WHERE file_type != 'BAK'`);
        if (bakResult.length > 0) {
            const BAK_EXTS = new Set(['bak', '~bak', 'dwl', 'dwl2', 'sv$', 'asv']);
            let fixed = 0;
            for (const row of bakResult[0].values) {
                const id = row[0] as string;
                const fileName = row[1] as string;
                const ext = (fileName.split('.').pop() || '').toLowerCase();
                if (!BAK_EXTS.has(ext)) continue;
                target.run(`UPDATE assets SET file_type = 'BAK', category = 'Döküman' WHERE id = ?`, [id]);
                fixed++;
            }
            if (fixed > 0) debugLog('Database', `Migration: ${fixed} yanlış sınıflandırılmış BAK dosyası düzeltildi.`);
        }
    } catch { /* sessizce devam et */ }

    // user_messages tablosuna recipient kolonu ekle (eski DB'ler için)
    try {
        const msgInfo = target.exec(`PRAGMA table_info(user_messages)`);
        if (msgInfo.length > 0) {
            const columns = msgInfo[0].values.map(row => row[1] as string);
            if (!columns.includes('recipient')) {
                target.run(`ALTER TABLE user_messages ADD COLUMN recipient TEXT`);
            }
            if (!columns.includes('assigned_to')) {
                target.run(`ALTER TABLE user_messages ADD COLUMN assigned_to TEXT`);
            }
        }
    } catch { /* sessizce devam et */ }

    // users tablosuna is_blocked kolonu ekle (eski DB'ler için)
    try {
        const userInfo = target.exec(`PRAGMA table_info(users)`);
        if (userInfo.length > 0) {
            const columns = userInfo[0].values.map(row => row[1] as string);
            if (!columns.includes('is_blocked')) {
                target.run(`ALTER TABLE users ADD COLUMN is_blocked INTEGER NOT NULL DEFAULT 0`);
            }
            if (!columns.includes('is_developer')) {
                target.run(`ALTER TABLE users ADD COLUMN is_developer INTEGER NOT NULL DEFAULT 0`);
            }
            if (!columns.includes('is_founder')) {
                target.run(`ALTER TABLE users ADD COLUMN is_founder INTEGER NOT NULL DEFAULT 0`);
                // Eski DB: en eski admin'i kurucu olarak işaretle
                target.run(`UPDATE users SET is_founder = 1 WHERE id = (SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1)`);
            }
        }
    } catch { /* sessizce devam et */ }

    // Proje durumu alanları (kullanıcı tanımlı, yeniden taramada korunur)
    try {
        const assetInfoPD = target.exec(`PRAGMA table_info(assets)`);
        if (assetInfoPD.length > 0) {
            const columns = assetInfoPD[0].values.map(row => row[1] as string);
            if (!columns.includes('client_name'))       target.run(`ALTER TABLE assets ADD COLUMN client_name TEXT`);
            if (!columns.includes('approval_status'))  target.run(`ALTER TABLE assets ADD COLUMN approval_status TEXT DEFAULT 'draft'`);
            if (!columns.includes('rejection_reason')) target.run(`ALTER TABLE assets ADD COLUMN rejection_reason TEXT`);
            if (!columns.includes('version_label'))    target.run(`ALTER TABLE assets ADD COLUMN version_label TEXT`);
            if (!columns.includes('deadline'))         target.run(`ALTER TABLE assets ADD COLUMN deadline TEXT`);
        }
    } catch { /* sessizce devam et */ }

    // asset_relations tablosu (eski DB'ler için)
    try {
        target.run(`CREATE TABLE IF NOT EXISTS asset_relations (
          id TEXT PRIMARY KEY,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation_type TEXT NOT NULL,
          notes TEXT,
          created_at TEXT NOT NULL,
          created_by TEXT DEFAULT 'user',
          FOREIGN KEY(source_id) REFERENCES assets(id) ON DELETE CASCADE,
          FOREIGN KEY(target_id) REFERENCES assets(id) ON DELETE CASCADE
        )`);
        target.run(`CREATE INDEX IF NOT EXISTS idx_relations_source ON asset_relations(source_id)`);
        target.run(`CREATE INDEX IF NOT EXISTS idx_relations_target ON asset_relations(target_id)`);
    } catch { /* sessizce devam et */ }

    // Soft delete: is_deleted + deleted_at kolonları
    try {
        const assetInfo2 = target.exec(`PRAGMA table_info(assets)`);
        if (assetInfo2.length > 0) {
            const columns = assetInfo2[0].values.map(row => row[1] as string);
            if (!columns.includes('is_deleted')) {
                target.run(`ALTER TABLE assets ADD COLUMN is_deleted INTEGER DEFAULT 0`);
            }
            if (!columns.includes('deleted_at')) {
                target.run(`ALTER TABLE assets ADD COLUMN deleted_at TEXT`);
            }
            if (!columns.includes('content_hash')) {
                target.run(`ALTER TABLE assets ADD COLUMN content_hash TEXT`);
            }
            if (!columns.includes('fs_mtime')) {
                target.run(`ALTER TABLE assets ADD COLUMN fs_mtime INTEGER`);
            }
            if (!columns.includes('rag_excluded')) {
                target.run(`ALTER TABLE assets ADD COLUMN rag_excluded INTEGER DEFAULT 0`);
            }
        }
    } catch { /* sessizce devam et */ }

    // Soft delete index
    try {
        target.run(`CREATE INDEX IF NOT EXISTS idx_assets_deleted ON assets(is_deleted)`);
    } catch { /* sessizce devam et */ }

    // Faz 2: scanned_roots tablosuna group_id ve is_favorite sütunları ekle
    try {
        const rootsInfo = target.exec(`PRAGMA table_info(scanned_roots)`);
        if (rootsInfo.length > 0) {
            const cols = rootsInfo[0].values.map(r => r[1] as string);
            if (!cols.includes('group_id')) {
                target.run(`ALTER TABLE scanned_roots ADD COLUMN group_id TEXT`);
            }
            if (!cols.includes('is_favorite')) {
                target.run(`ALTER TABLE scanned_roots ADD COLUMN is_favorite INTEGER DEFAULT 0`);
            }
        }
    } catch { /* sessizce devam et */ }

    // Faz 2: root_groups tablosunu eski DB'lere ekle
    try {
        target.run(`CREATE TABLE IF NOT EXISTS root_groups (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          color TEXT DEFAULT '#6366f1',
          sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )`);
        target.run(`CREATE INDEX IF NOT EXISTS idx_root_groups_sort ON root_groups(sort_order)`);
    } catch { /* sessizce devam et */ }

    // Faz 2: root_tags tablosunu eski DB'lere ekle
    try {
        target.run(`CREATE TABLE IF NOT EXISTS root_tags (
          root_id TEXT NOT NULL,
          tag_id INTEGER NOT NULL,
          PRIMARY KEY (root_id, tag_id),
          FOREIGN KEY (root_id) REFERENCES scanned_roots(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )`);
        target.run(`CREATE INDEX IF NOT EXISTS idx_root_tags_root ON root_tags(root_id)`);
        target.run(`CREATE INDEX IF NOT EXISTS idx_root_tags_tag ON root_tags(tag_id)`);
    } catch { /* sessizce devam et */ }

    // Faz 1.5: scanned_roots tablosu boşsa mevcut asset'lerden kök dizinleri çıkar
    try {
        const rootsCount = target.exec('SELECT COUNT(*) FROM scanned_roots');
        const isEmpty = rootsCount.length === 0 || (rootsCount[0].values[0][0] as number) === 0;
        if (isEmpty) {
            const pathResult = target.exec('SELECT DISTINCT file_path FROM assets WHERE is_deleted = 0');
            if (pathResult.length > 0 && pathResult[0].values.length > 0) {
                const paths = pathResult[0].values.map(r => r[0] as string).filter(Boolean);
                const roots = _detectRootDirectories(paths);
                for (const rootPath of roots) {
                    const id = crypto.randomUUID();
                    const label = _basenameFromPath(rootPath);
                    const count = paths.filter(p => p.startsWith(rootPath)).length;
                    target.run(
                        'INSERT OR IGNORE INTO scanned_roots (id, path, label, file_count, status) VALUES (?, ?, ?, ?, ?)',
                        [id, rootPath, label, count, 'active']
                    );
                }
            }
        }
    } catch { /* sessizce devam et */ }

    // audit_log hash chain (tamper evidence) — prev_hash/row_hash kolonları + backfill.
    // Kolon yoksa ekle; ardından hash'i olmayan mevcut satırları sıra ile doldur.
    try {
        const auditInfo = target.exec(`PRAGMA table_info(audit_log)`);
        if (auditInfo.length > 0) {
            const cols = auditInfo[0].values.map(r => r[1] as string);
            if (!cols.includes('prev_hash')) {
                target.run(`ALTER TABLE audit_log ADD COLUMN prev_hash TEXT`);
            }
            if (!cols.includes('row_hash')) {
                target.run(`ALTER TABLE audit_log ADD COLUMN row_hash TEXT`);
            }
        }
        // Backfill: row_hash NULL olan satırları chain'le (tek seferlik migration)
        const nullCheck = target.exec(`SELECT COUNT(*) FROM audit_log WHERE row_hash IS NULL OR row_hash = ''`);
        const nullCount = (nullCheck[0]?.values[0]?.[0] as number) ?? 0;
        if (nullCount > 0) {
            // Önce mevcut chain'in son row_hash'ini al (hash'lenmiş satırlar varsa)
            const tailResult = target.exec(`SELECT row_hash FROM audit_log WHERE row_hash IS NOT NULL AND row_hash != '' ORDER BY id DESC LIMIT 1`);
            let prevHash = (tailResult[0]?.values[0]?.[0] as string | null) ?? '';

            // Hash'lenmemiş satırları id sırasıyla işle
            const rowsResult = target.exec(
                `SELECT id, timestamp, role, action, target, detail, result
                 FROM audit_log WHERE row_hash IS NULL OR row_hash = ''
                 ORDER BY id ASC`
            );
            if (rowsResult.length > 0) {
                for (const row of rowsResult[0].values) {
                    const id = row[0] as number;
                    const timestamp = row[1] as string;
                    const role = row[2] as string | null;
                    const action = row[3] as string;
                    const tgt = row[4] as string | null;
                    const detail = row[5] as string | null;
                    const result = row[6] as string;
                    const rowHash = computeAuditRowHash(timestamp, role, action, tgt, detail, result, prevHash);
                    target.run(
                        `UPDATE audit_log SET prev_hash = ?, row_hash = ? WHERE id = ?`,
                        [prevHash, rowHash, id],
                    );
                    prevHash = rowHash;
                }
                debugLog('Database', `audit_log hash chain backfill: ${rowsResult[0].values.length} satır hash'lendi`);
            }
        }
    } catch (err) {
        debugLog('Database', 'audit_log hash migration hatası (yoksayıldı)', err);
    }

    // Onay geçmişi tablosu (approval audit trail)
    try {
        target.run(`CREATE TABLE IF NOT EXISTS approval_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          asset_id TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT NOT NULL,
          reason TEXT,
          changed_by TEXT NOT NULL,
          changed_at TEXT NOT NULL
        )`);
        target.run(`CREATE INDEX IF NOT EXISTS idx_approval_log_asset ON approval_log(asset_id)`);
        target.run(`CREATE INDEX IF NOT EXISTS idx_approval_log_time ON approval_log(changed_at)`);
    } catch { /* sessizce devam et */ }

    // Scanned roots soft-delete (Klasör Çöp Kutusu)
    try {
        const rootsInfoSD = target.exec(`PRAGMA table_info(scanned_roots)`);
        if (rootsInfoSD.length > 0) {
            const cols = rootsInfoSD[0].values.map(r => r[1] as string);
            if (!cols.includes('is_deleted')) {
                target.run(`ALTER TABLE scanned_roots ADD COLUMN is_deleted INTEGER DEFAULT 0`);
            }
            if (!cols.includes('deleted_at')) {
                target.run(`ALTER TABLE scanned_roots ADD COLUMN deleted_at TEXT`);
            }
        }
        target.run(`CREATE INDEX IF NOT EXISTS idx_roots_deleted ON scanned_roots(is_deleted)`);
    } catch { /* sessizce devam et */ }

    // Faz 4.4: dwg_shapes tablosuna gelişmiş geometrik özellik kolonları
    try {
        const shapeInfo = target.exec(`PRAGMA table_info(dwg_shapes)`);
        if (shapeInfo.length > 0) {
            const cols = shapeInfo[0].values.map(r => r[1] as string);
            if (!cols.includes('compactness'))    target.run(`ALTER TABLE dwg_shapes ADD COLUMN compactness REAL DEFAULT 0`);
            if (!cols.includes('solidity'))       target.run(`ALTER TABLE dwg_shapes ADD COLUMN solidity REAL DEFAULT 0`);
            if (!cols.includes('rectangularity')) target.run(`ALTER TABLE dwg_shapes ADD COLUMN rectangularity REAL DEFAULT 0`);
        }
    } catch { /* sessizce devam et */ }

    // FTS5 chunk arama index
    try {
        target.run(`CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
            chunk_id UNINDEXED,
            asset_id UNINDEXED,
            text,
            tokenize='ascii'
        )`);
    } catch { /* sessizce devam et */ }
    try {
        // Tek seferlik populate: fts_chunks boşsa mevcut chunk'ları aktar
        const ftsCountResult = target.exec('SELECT COUNT(*) FROM fts_chunks');
        const ftsCount = (ftsCountResult[0]?.values[0]?.[0] as number) ?? 0;
        if (ftsCount === 0) {
            target.run(`
                INSERT INTO fts_chunks(chunk_id, asset_id, text)
                SELECT id, asset_id,
                    lower(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
                        text,
                        'ğ','g'),'Ğ','g'),'ş','s'),'Ş','s'),'ı','i'),'İ','i'),'ü','u'),'Ü','u'),'ö','o'),'Ö','o'),'ç','c'),'Ç','c'))
                FROM text_chunks
            `);
        }
    } catch { /* sessizce devam et */ }

    // Baseline migration: mevcut taranmış dosyalara applied_extractors atanır
    // Böylece ilk çalıştırmada tüm dosyalar "versiyon eski" olarak işaretlenmez.
    // Sadece sonradan eklenen yeni çıkarıcılar delta taramayı tetikler.
    try {
        const nullCheck = target.exec(
            `SELECT COUNT(*) FROM assets WHERE applied_extractors IS NULL AND metadata_json != '{}'`
        );
        const nullCount = (nullCheck[0]?.values[0]?.[0] as number) ?? 0;
        if (nullCount > 0) {
            // buildBaselineRecord ve computeCompositeVersion top-level import'tan gelir
            // Her dosya tipini toplu güncelle
            const typeResult = target.exec(
                `SELECT DISTINCT file_type FROM assets WHERE applied_extractors IS NULL AND metadata_json != '{}'`
            );
            if (typeResult.length > 0) {
                for (const row of typeResult[0].values) {
                    const ft = row[0] as string;
                    const baseline = buildBaselineRecord(ft);
                    if (baseline) {
                        target.run(
                            `UPDATE assets SET applied_extractors = ?, metadata_version = ? WHERE file_type = ? AND applied_extractors IS NULL AND metadata_json != '{}'`,
                            [JSON.stringify(baseline), computeCompositeVersion(ft), ft]
                        );
                    }
                }
            }
        }
    } catch { /* sessizce devam et */ }
}

/**
 * Yerel arşiv veritabanını başlat (Viewer'ın kendi arşivi).
 * Ana arşivle aynı şemayı kullanır, ayrı bir DB dosyasında tutulur.
 */
export async function initLocalDatabase(): Promise<SqlJsDatabase> {
    const existing = getLocalDb();
    if (existing) return existing;

    try {
        const sqlJsModule = await import('sql.js');
        const initSqlJs: (config?: Record<string, unknown>) => Promise<any> =
            typeof sqlJsModule.default === 'function' ? sqlJsModule.default : (sqlJsModule as any);
        const SQL = await initSqlJs({
            locateFile: () => '/sql-wasm.wasm',
        });

        // Önce Tauri diskten oku, yoksa localStorage fallback
        let newLocalDb: SqlJsDatabase;
        let loaded = false;
        const diskBytes = await tauriInvoke<number[]>('read_local_database');
        if (diskBytes && diskBytes.length > 0) {
            newLocalDb = new SQL.Database(new Uint8Array(diskBytes)) as unknown as SqlJsDatabase;
            loaded = true;
            // Diskten yüklendi — eski localStorage verisini temizle
            localStorage.removeItem('archivist_local_db');
        } else {
            newLocalDb = new SQL.Database() as unknown as SqlJsDatabase;
        }

        if (!loaded) {
            // localStorage fallback (web dev modu veya göç)
            const saved = localStorage.getItem('archivist_local_db');
            if (saved) {
                const buf = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
                newLocalDb = new SQL.Database(buf) as unknown as SqlJsDatabase;
                // Diske göç et ve localStorage'ı temizle
                const migrationData = newLocalDb.export();
                tauriInvoke('write_local_database', { data: Array.from(migrationData) }).then(() => {
                    localStorage.removeItem('archivist_local_db');
                    debugLog('Database', 'Yerel arşiv localStorage\'dan diske taşındı.');
                }).catch((err) => debugLog('Database', 'DB migration to disk failed', err));
            }
        }

        _applySchema(newLocalDb);
        _applyMigrations(newLocalDb);
        dbMap.set(LOCAL_ARCHIVE_ID, newLocalDb);

        if (activeArchive === LOCAL_ARCHIVE_ID) {
            setTagDb(newLocalDb);
            setFavoritesDb(newLocalDb);
            // Mesajlar ve loglar her zaman mainDb'de kalır
            const main = getMainDb();
            if (main) {
                setLoggerDb(main);
                setMessageDb(main);
            }
        }
        return newLocalDb;
    } catch (err) {
        debugLog('Database', 'local init error', err);
        throw err;
    }
}

/**
 * Veritabanını diske (Tauri) veya localStorage'a (fallback) kaydet.
 * Promise chain ile seri yazım: eşzamanlı çağrılarda race condition'ı önler.
 */
let _writeChain: Promise<void> = Promise.resolve();

/**
 * Tarama aktifken sql.js dump'ın diske yazılmasını engeller.
 * Rusqlite inkremental yazıyor; sql.js dump (eski snapshot) diski ezerse veri kaybı olur.
 * useScanWorkflow tarama başında true, bitince false yapar.
 */
let _scanWriteLock = false;
export function setScanWriteLock(locked: boolean): void { _scanWriteLock = locked; }
export function isScanWriteLocked(): boolean { return _scanWriteLock; }

/* ── DB Export Worker ─────────────────────────────────────────────────────────
 * Uint8Array → number[] dönüşümü (Array.from) ana thread'i 200-500ms bloklayabilir.
 * Worker bunu ayrı thread'de yapar; ana thread (UI) hiç donmaz.
 */

/**
 * Bekleyen tüm `_serializedWrite` çağrılarının diske flush edilmesini bekler.
 * Çağrı anındaki chain'in tamamlandığı anda resolve eder; sonradan eklenen
 * yeni write'ları beklemez. Graceful shutdown sırasında veri kaybı olmaması için.
 */
export async function flushPendingWrites(): Promise<void> {
    // _writeChain'in mevcut snapshot'ını bekle. Reject olsa bile sessiz geç —
    // shutdown akışını bloklamamak için.
    try { await _writeChain; } catch { /* sessizce */ }
}

function _serializedWrite(
    dbRef: SqlJsDatabase | null,
    tauriCmd: string,
    fallbackKey: string,
    extraArgs?: Record<string, unknown>,
): Promise<boolean> {
    if (!dbRef) return Promise.resolve(false);
    // Tarama aktifken sql.js dump'ını diske yazma — rusqlite verisi ezilir
    if (_scanWriteLock) {
        debugLog('Database', '_serializedWrite skipped: scan write lock active');
        return Promise.resolve(true); // Kayıp yok: deferred tekrar tetikleyecek veya scan bitişinde flush olacak
    }

    return new Promise<boolean>((resolveResult) => {
        _writeChain = _writeChain
            .then(() => new Promise<void>((resolve) => {
                // UI'ye "kaydediliyor" bildirimi göstermesi için sinyal — render etmeye fırsat ver
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('archivist:dbSaveStart'));
                }
                // setTimeout(0) → macrotask kuyruğuna alır.
                // Promise.then() microtask olduğundan UI render'dan önce çalışır;
                // setTimeout ile tarayıcı önce render edip olaylara yanıt verir,
                // ardından db.export() + worker + invoke çalışır — UI hiç donmaz.
                setTimeout(async () => {
                    if (!dbRef) {
                        if (typeof window !== 'undefined') window.dispatchEvent(new Event('archivist:dbSaveEnd'));
                        resolve(); resolveResult(false); return;
                    }
                    try {
                        // db.export() ana thread'de kalır (WASM belleği erişimi gerektirir)
                        const data = dbRef.export();
                        // Tauri v2 raw binary IPC: Uint8Array doğrudan Vec<u8>'e serialize edilir
                        // (JSON Array dönüşümü yok — büyük DB'lerde RangeError ve perf sorunu yaşanmaz).
                        const invokeArgs = { ...(extraArgs || {}), data };
                        const ok = await tauriVoidInvoke(tauriCmd, invokeArgs);
                        if (!ok) _saveToLocalStorage(data, fallbackKey);
                        resolve();
                        resolveResult(ok);
                    } catch (err) {
                        debugLog('Database', 'Serialized write error', err);
                        resolve();          // zinciri kırma
                        resolveResult(false); // çağırana hata bildir
                    } finally {
                        if (typeof window !== 'undefined') window.dispatchEvent(new Event('archivist:dbSaveEnd'));
                    }
                }, 0);
            }))
            .catch((err) => {
                debugLog('Database', 'Write chain error', err);
                if (typeof window !== 'undefined') window.dispatchEvent(new Event('archivist:dbSaveEnd'));
                resolveResult(false);
            });
    });
}

/**
 * Mesaj tablosu yazımı için — viewer'ın user_messages'a yazabilmesi için
 * assertWriteAccess atlanır. Sadece messageService tarafından kullanılmalı.
 */
export function saveMessageDatabase(): void {
    _serializedWrite(getMainDb(), 'write_database', 'archivist_db');
}

export function saveDatabase(): void {
    assertWriteAccess();
    const { tauriCmd, storageKey, extraArgs } = resolveArchiveIO(activeArchive);
    _serializedWrite(db, tauriCmd, storageKey, extraArgs); // promise ignored — fire-and-forget
}

/**
 * Awaitable versiyon: diske yazımın başarılı olup olmadığını döner.
 * Tarama checkpoint'leri gibi sonucu bilmesi gereken çağıranlar için.
 */
export function saveDatabaseAsync(): Promise<boolean> {
    assertWriteAccess();
    const { tauriCmd, storageKey, extraArgs } = resolveArchiveIO(activeArchive);
    return _serializedWrite(db, tauriCmd, storageKey, extraArgs);
}

/**
 * Debounced + idle-aware save. Ardışık çağrıları birleştirir VE tarayıcı idle
 * olduğunda çalıştırır — kullanıcı aktifken db.export()'un 100-200ms blok
 * yaptığı hissedilmez.
 *
 * Strateji:
 *   1. minWaitMs > 0 ise önce en az o kadar bekle (idle callback re-render'dan hemen
 *      sonra tetiklenmesin — db.export() kullanıcı aksiyonuna çakışmasın)
 *   2. Sonra requestIdleCallback dene (WebView2'de mevcut) — UI'ya zarar vermez
 *   3. timeout fallback: en geç maxWaitMs sonra kesin kaydet (idle hiç gelmezse)
 *   4. requestIdleCallback yoksa setTimeout'a düş
 *
 * Kriz durumunda (uygulama çöker) kayıp: son (minWaitMs + maxWaitMs) içindeki değişiklikler.
 * Chat gibi low-stakes işlemler için minWaitMs=2000 kullan — senkron WASM export
 * kullanıcı etkileşimine denk gelmesin.
 */
type IdleHandle = number;
interface IdleDeadline { timeRemaining(): number; didTimeout: boolean; }
type RequestIdleCallback = (cb: (d: IdleDeadline) => void, opts?: { timeout?: number }) => IdleHandle;
type CancelIdleCallback = (h: IdleHandle) => void;
const _ric: RequestIdleCallback | undefined = (window as unknown as { requestIdleCallback?: RequestIdleCallback }).requestIdleCallback;
const _cic: CancelIdleCallback | undefined = (window as unknown as { cancelIdleCallback?: CancelIdleCallback }).cancelIdleCallback;

let _deferredSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _deferredSaveIdle: IdleHandle | null = null;

// Kullanıcı aktivite takibi: son fare/klavye olayı zamanı.
// db.export() (senkron WASM) kullanıcı etkileşimine denk gelmesin diye
// aktif kullanım sırasında kayıtlamayı erteleriz.
let _lastUserActivity = 0;
if (typeof document !== 'undefined') {
    const _trackActivity = () => { _lastUserActivity = Date.now(); };
    document.addEventListener('mousemove', _trackActivity, { passive: true, capture: true });
    document.addEventListener('keydown', _trackActivity, { passive: true, capture: true });
    document.addEventListener('pointerdown', _trackActivity, { passive: true, capture: true });
}

export function saveDatabaseDeferred(maxWaitMs: number = 1500, minWaitMs: number = 0): void {
    // Ardışık çağrılarda eski zamanlamayı iptal et
    if (_deferredSaveTimer !== null) { clearTimeout(_deferredSaveTimer); _deferredSaveTimer = null; }
    if (_deferredSaveIdle !== null && _cic) { _cic(_deferredSaveIdle); _deferredSaveIdle = null; }

    // Mutlak son tarih: kullanıcı sürekli aktif olsa bile en geç bu süre dolunca kaydet
    const deadline = Date.now() + minWaitMs + maxWaitMs;

    const doSave = () => {
        _deferredSaveTimer = null;
        _deferredSaveIdle = null;
        try { saveDatabase(); } catch (err) { debugLog('Database', 'deferred save failed', err); }
    };

    const runSave = () => {
        // Kullanıcı son 2 saniyede aktifse ve deadline geçmediyse kayıtlamayı ertele
        const msSinceActivity = _lastUserActivity > 0 ? Date.now() - _lastUserActivity : Infinity;
        const msLeft = deadline - Date.now();
        if (msSinceActivity < 2000 && msLeft > 200) {
            const delay = Math.min(2000 - msSinceActivity + 50, msLeft);
            if (_ric) {
                _deferredSaveIdle = _ric(runSave, { timeout: Math.max(200, delay) });
            } else {
                _deferredSaveTimer = setTimeout(runSave, Math.max(200, delay));
            }
            return;
        }
        doSave();
    };

    const scheduleIdle = () => {
        _deferredSaveTimer = null;
        if (_ric) {
            // Idle zamanı varsa o anda çalış, yoksa maxWaitMs sonra zorla çalış
            _deferredSaveIdle = _ric(runSave, { timeout: maxWaitMs });
        } else {
            _deferredSaveTimer = setTimeout(runSave, 400);
        }
    };

    if (minWaitMs > 0) {
        // Minimum bekleme: idle callback aksiyondan hemen sonra tetiklenmesin
        _deferredSaveTimer = setTimeout(scheduleIdle, minWaitMs);
    } else {
        scheduleIdle();
    }
}

/**
 * Bekleyen deferred save varsa anında tetikler (idle/timer beklemeden).
 * Graceful shutdown sırasında flushPendingWrites()'tan ÖNCE çağrılmalı.
 * Deferred yoksa no-op.
 */
export function flushDeferredSave(): void {
    const hasPending = _deferredSaveTimer !== null || _deferredSaveIdle !== null;
    if (!hasPending) return;
    // Timer/idle'ı iptal et ve anında çalıştır
    if (_deferredSaveTimer !== null) { clearTimeout(_deferredSaveTimer); _deferredSaveTimer = null; }
    if (_deferredSaveIdle !== null && _cic) { _cic(_deferredSaveIdle); _deferredSaveIdle = null; }
    try { saveDatabase(); } catch (err) { debugLog('Database', 'flushDeferredSave failed', err); }
}

function _saveToLocalStorage(data: Uint8Array, storageKey = 'archivist_db'): void {
    try {
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < data.length; i += chunk) {
            binary += String.fromCharCode.apply(null, Array.from(data.slice(i, i + chunk)));
        }
        localStorage.setItem(storageKey, btoa(binary));
    } catch (err: unknown) {
        const isQuota = err instanceof DOMException && (
            err.name === 'QuotaExceededError' ||
            err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
        );
        if (isQuota) {
            debugLog('Database', 'save error: localStorage dolu (5-10MB limit aşıldı)');
            window.dispatchEvent(new CustomEvent('archivist:storage-full'));
        } else {
            debugLog('Database', 'save error', err);
        }
    }
}

/**
 * TÜM asset'leri ve ilişkili kayıtları siler (fullReset scan için).
 * assets + embeddings + text_chunks + asset_relations + asset_tags + favorites
 * + collection_items + asset_summaries + scanned_roots temizlenir.
 * Kullanıcı oluşturduğu tags/collections registry'leri korunur.
 * Silinen asset sayısını döner.
 */
export function clearAllAssets(options: { skipSave?: boolean } = {}): number {
    assertWriteAccess();
    if (!db) return 0;
    db.run('BEGIN TRANSACTION');
    try {
        const countResult = db.exec('SELECT COUNT(*) FROM assets');
        const deleted = countResult.length > 0 ? (countResult[0].values[0][0] as number) : 0;
        db.run('DELETE FROM asset_relations');
        db.run('DELETE FROM embeddings');
        db.run('DELETE FROM text_chunks');
        db.run('DELETE FROM asset_tags');
        db.run('DELETE FROM favorites');
        db.run('DELETE FROM collection_items');
        db.run('DELETE FROM asset_summaries');
        db.run('DELETE FROM dwg_shapes');
        db.run('DELETE FROM assets');
        db.run('DELETE FROM root_tags');
        db.run('DELETE FROM scanned_roots');
        db.run('COMMIT');
        if (!options.skipSave) saveDatabaseDeferred();
        return deleted;
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'clearAllAssets error', err);
        return 0;
    }
}

/**
 * Verilen kök klasörün altındaki tüm asset'leri siler (kapsamlı replace-scan için).
 * scanned_roots satırı korunur — yeni tarama sayacı günceller.
 * Silinen asset sayısını döner.
 */
export function clearAssetsUnderPath(rootPath: string, options: { skipSave?: boolean } = {}): number {
    assertWriteAccess();
    if (!db) return 0;
    const safePath = ensureTrailingSep(rootPath);
    const escaped = safePath.replace(/[\\_%]/g, '\\$&');
    const pattern = `${escaped}%`;
    db.run('BEGIN TRANSACTION');
    try {
        const result = db.exec(
            "SELECT id FROM assets WHERE file_path LIKE ? ESCAPE '\\'",
            [pattern] as any
        );
        let deleted = 0;
        if (result.length > 0) {
            const ids = result[0].values.map(r => r[0] as string);
            deleted = ids.length;
            for (const id of ids) {
                _cascadeDeleteAssetRows(id);
            }
        }
        db.run('COMMIT');
        if (!options.skipSave) saveDatabaseDeferred();
        return deleted;
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'clearAssetsUnderPath error', err);
        return 0;
    }
}

/**
 * Bir asset'in tüm bağımlı kayıtlarını cascade siler (transaction İÇİNDE çağrılmalı).
 * Ortak pattern: deleteAsset, deleteOrphanedAssets, permanentlyDeleteAsset, emptyTrashDb.
 */
function _cascadeDeleteAssetRows(assetId: string): void {
    db!.run('DELETE FROM asset_relations WHERE source_id = ? OR target_id = ?', [assetId, assetId]);
    db!.run('DELETE FROM embeddings WHERE asset_id = ?', [assetId]);
    db!.run('DELETE FROM text_chunks WHERE asset_id = ?', [assetId]);
    db!.run('DELETE FROM dwg_shapes WHERE asset_id = ?', [assetId]);
    db!.run('DELETE FROM asset_tags WHERE asset_id = ?', [assetId]);
    db!.run('DELETE FROM favorites WHERE asset_id = ?', [assetId]);
    db!.run('DELETE FROM collection_items WHERE asset_id = ?', [assetId]);
    db!.run('DELETE FROM asset_summaries WHERE asset_id = ?', [assetId]);
    db!.run('DELETE FROM assets WHERE id = ?', [assetId]);
}

/**
 * Tek bir asset'i arşivden siler (embeddings ve chunks dahil).
 */
export function deleteAsset(assetId: string): boolean {
    assertWriteAccess();
    if (!db) return false;
    db.run('BEGIN TRANSACTION');
    try {
        _cascadeDeleteAssetRows(assetId);
        db.run('COMMIT');
        saveDatabaseDeferred();
        return true;
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'deleteAsset error', err);
        return false;
    }
}

/**
 * Diskte mevcut olmayan dosyalara ait asset kayıtlarını tespit eder.
 * Admin sağlık kontrolü için kullanılır.
 */
export async function findOrphanedAssets(): Promise<{ id: string; fileName: string; filePath: string }[]> {
    if (!db) return [];
    const result = db.exec('SELECT id, file_name, file_path FROM assets');
    if (!result.length) return [];

    const rows = result[0].values;
    const allPaths = rows.map(r => String(r[2]));

    // Rust komutuyla toplu kontrol — mevcut olmayan yolları döndürür
    const missingPaths = await tauriInvoke<string[]>('check_files_exist', { paths: allPaths });
    if (!missingPaths || missingPaths.length === 0) return [];

    const missingSet = new Set(missingPaths);
    return rows
        .filter(r => missingSet.has(String(r[2])))
        .map(r => ({ id: String(r[0]), fileName: String(r[1]), filePath: String(r[2]) }));
}

/**
 * Belirtilen ID'lere sahip orphan asset'leri toplu siler.
 * Cascading delete: embeddings, chunks, tags, favorites, collections, summaries, assets.
 */
export function deleteOrphanedAssets(ids: string[]): number {
    assertWriteAccess();
    if (!db || ids.length === 0) return 0;
    let deleted = 0;
    db.run('BEGIN TRANSACTION');
    try {
        for (const id of ids) {
            _cascadeDeleteAssetRows(id);
            deleted++;
        }
        db.run('COMMIT');
        saveDatabaseDeferred();
        return deleted;
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'deleteOrphanedAssets error', err);
        return 0;
    }
}

/** Ana DB'den bir uygulama ayarı okur. Bulunamazsa null döner. */
export function getSetting(key: string): string | null {
    const main = getMainDb();
    if (!main) return null;
    try {
        const stmt = main.prepare('SELECT value FROM app_settings WHERE key = ?');
        stmt.bind([key]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            const val = row['value'];
            return typeof val === 'string' ? val : null;
        }
        stmt.free();
        return null;
    } catch { return null; }
}

/**
 * Ana DB'deki app_settings tablosunu sql.js bellekte günceller VE Rust üzerinden
 * tek bir SQL UPDATE ile diske yazar — tüm DB'yi export etmeden.
 *
 * Settings tab'larında her tıklamada saveDatabase() çağrılması, sql.js'in 100MB+ DB'yi
 * her seferinde Uint8Array'e serialize etmesi nedeniyle UI'yi 100-500ms+ blokluyordu.
 * Bu fonksiyon rusqlite tarafına direkt INSERT OR REPLACE çalıştırır (~1ms).
 *
 * Tauri yoksa (web dev modu) sessizce sql.js bellekte kalır; saveDatabaseDeferred ile
 * fallback save tetiklenir.
 */
export async function setSettingPersistent(key: string, value: string): Promise<void> {
    setSetting(key, value); // sql.js bellek (UI tutarlılığı için anında)
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('update_app_setting', { key, value });
    } catch (err) {
        debugLog('Database', 'update_app_setting failed, falling back to deferred save', err);
        saveDatabaseDeferred();
    }
}

/** Ana DB'ye bir uygulama ayarı yazar (INSERT OR REPLACE). */
export function setSetting(key: string, value: string): void {
    const main = getMainDb();
    if (!main) return;
    try {
        main.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
    } catch { /* sessizce geç */ }
}

export function isArchiveReady(id: string): boolean {
    return dbMap.has(id);
}

export function isLocalDbReady(): boolean {
    return isArchiveReady(LOCAL_ARCHIVE_ID);
}

/**
 * Belirli bir arşivden asset listesi döndürür — aktif arşivi DEĞİŞTİRMEZ.
 * DuplicateFinder gibi scope seçici gerektiren UI'lar için kullanılır.
 */
export function getAllAssetsFromArchive(archive: ArchiveType): Asset[] {
    const target = dbMap.get(archive) ?? null;
    if (!target) return [];
    const assets: Asset[] = [];
    try {
        const result = target.exec(`
            SELECT ${ASSET_SELECT_COLUMNS}
            FROM assets WHERE is_deleted = 0 ORDER BY modified_at DESC
        `);
        if (result.length === 0) return assets;
        const { columns, values } = result[0];
        for (const row of values) {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            assets.push(assetFromDbRow(obj));
        }
    } catch (err) {
        debugLog('Database', 'getAllAssetsFromArchive error', err);
    }
    return assets;
}

/** Belirli bir arşivde asset var mı kontrol eder (soft-deleted dahil değil). */
export function assetExistsInArchive(archiveId: string, assetId: string): boolean {
    const target = dbMap.get(archiveId) ?? null;
    if (!target) return false;
    try {
        const result = target.exec(
            'SELECT 1 FROM assets WHERE id = ? AND is_deleted = 0 LIMIT 1',
            [assetId] as any
        );
        return result.length > 0 && result[0].values.length > 0;
    } catch { return false; }
}

/** Belirli bir arşivdeki tüm embedding kayıtlarını döndürür. */
export function getAllEmbeddingsFromArchive(archiveId: string): Array<{
    id: string; assetId: string; refId: string | null; vector: number[]; source: string;
}> {
    const target = dbMap.get(archiveId) ?? null;
    if (!target) return [];
    const rows: Array<{ id: string; assetId: string; refId: string | null; vector: number[]; source: string }> = [];
    try {
        const result = target.exec('SELECT id, asset_id, ref_id, vector_blob, vector_json, source FROM embeddings');
        if (result.length === 0) return rows;
        for (const row of result[0].values) {
            try {
                const vec = parseVectorFromRow(row[3], row[4]);
                if (!vec) continue;
                rows.push({
                    id: row[0] as string,
                    assetId: row[1] as string,
                    refId: (row[2] as string) ?? null,
                    vector: vec,
                    source: row[5] as string,
                });
            } catch { /* geçersiz vektör — atla */ }
        }
    } catch (err) {
        debugLog('Database', 'getAllEmbeddingsFromArchive error', err);
    }
    return rows;
}

/** Belirli bir arşivdeki tüm text_chunks kayıtlarını döndürür. */
export function getAllTextChunksFromArchive(archiveId: string): Array<{
    id: string; assetId: string; chunkIndex: number; page: number | null; text: string; lang: string | null;
}> {
    const target = dbMap.get(archiveId) ?? null;
    if (!target) return [];
    const rows: Array<{ id: string; assetId: string; chunkIndex: number; page: number | null; text: string; lang: string | null }> = [];
    try {
        const result = target.exec('SELECT id, asset_id, chunk_index, page, text, lang FROM text_chunks');
        if (result.length === 0) return rows;
        for (const row of result[0].values) {
            rows.push({
                id: row[0] as string,
                assetId: row[1] as string,
                chunkIndex: row[2] as number,
                page: (row[3] as number) ?? null,
                text: row[4] as string,
                lang: (row[5] as string) ?? null,
            });
        }
    } catch (err) {
        debugLog('Database', 'getAllTextChunksFromArchive error', err);
    }
    return rows;
}

/** Belirli bir arşivdeki tüm asset_summaries kayıtlarını döndürür. */
export function getAllAssetSummariesFromArchive(archiveId: string): Array<{
    assetId: string; summary: string; keywords: string[]; model: string | null;
}> {
    const target = dbMap.get(archiveId) ?? null;
    if (!target) return [];
    const rows: Array<{ assetId: string; summary: string; keywords: string[]; model: string | null }> = [];
    try {
        const result = target.exec('SELECT asset_id, summary, keywords_json, model FROM asset_summaries');
        if (result.length === 0) return rows;
        for (const row of result[0].values) {
            let keywords: string[] = [];
            try { keywords = JSON.parse(row[2] as string); } catch { /* */ }
            rows.push({
                assetId: row[0] as string,
                summary: row[1] as string,
                keywords,
                model: (row[3] as string) ?? null,
            });
        }
    } catch (err) {
        debugLog('Database', 'getAllAssetSummariesFromArchive error', err);
    }
    return rows;
}

/** Belirli bir arşivdeki tüm tags + asset_tags ilişkisini döndürür. */
export function getAllTagDataFromArchive(archiveId: string): {
    tags: Array<{ id: number; name: string; color: string }>;
    assetTags: Array<{ assetId: string; tagId: number }>;
} {
    const target = dbMap.get(archiveId) ?? null;
    if (!target) return { tags: [], assetTags: [] };
    const tags: Array<{ id: number; name: string; color: string }> = [];
    const assetTags: Array<{ assetId: string; tagId: number }> = [];
    try {
        const tagResult = target.exec('SELECT id, name, color FROM tags');
        if (tagResult.length > 0) {
            for (const row of tagResult[0].values) {
                tags.push({
                    id: row[0] as number,
                    name: row[1] as string,
                    color: row[2] as string,
                });
            }
        }
        const linkResult = target.exec('SELECT asset_id, tag_id FROM asset_tags');
        if (linkResult.length > 0) {
            for (const row of linkResult[0].values) {
                assetTags.push({
                    assetId: row[0] as string,
                    tagId: row[1] as number,
                });
            }
        }
    } catch (err) {
        debugLog('Database', 'getAllTagDataFromArchive error', err);
    }
    return { tags, assetTags };
}

/**
 * Belirli bir arşivdeki tüm etiketleri tagService.getAllTags() ile aynı şekilde döndürür.
 * Aktif arşivi değiştirmez — dbMap üzerinden hedef arşivi okur.
 * Cross-archive tag filtresi (Extract/Merge modal) için kullanılır.
 */
export function getAllTagsFromArchive(archiveId: string): Array<{ id: number; name: string; color: string; createdAt: string }> {
    const target = dbMap.get(archiveId) ?? null;
    if (!target) return [];
    try {
        const result = target.exec('SELECT id, name, color, created_at FROM tags ORDER BY name');
        if (result.length === 0) return [];
        return result[0].values.map((row) => ({
            id: row[0] as number,
            name: row[1] as string,
            color: row[2] as string,
            createdAt: row[3] as string,
        }));
    } catch (err) {
        debugLog('Database', 'getAllTagsFromArchive error', err);
        return [];
    }
}

/** Belirli bir arşivdeki tüm favorite asset ID'lerini döndürür. */
export function getAllFavoritesFromArchive(archiveId: string): string[] {
    const target = dbMap.get(archiveId) ?? null;
    if (!target) return [];
    const ids: string[] = [];
    try {
        const result = target.exec('SELECT asset_id FROM favorites');
        if (result.length === 0) return ids;
        for (const row of result[0].values) {
            ids.push(row[0] as string);
        }
    } catch (err) {
        debugLog('Database', 'getAllFavoritesFromArchive error', err);
    }
    return ids;
}

/**
 * Belirli bir arşivden asset siler — aktif arşivi DEĞİŞTİRMEZ.
 * Viewer ana arşivden silemez; yerel arşivde her rol silebilir.
 */
export function deleteAssetFromArchive(assetId: string, archive: ArchiveType): boolean {
    const def = getArchiveDef(archive);
    if (def?.type === 'shared' && getAppRole() === 'viewer') {
        throw new Error('Paylaşımlı arşive yazma yetkiniz yok (Viewer rolü)');
    }
    const target = dbMap.get(archive) ?? null;
    if (!target) return false;
    target.run('BEGIN TRANSACTION');
    try {
        target.run('DELETE FROM embeddings WHERE asset_id = ?', [assetId]);
        target.run('DELETE FROM text_chunks WHERE asset_id = ?', [assetId]);
        target.run('DELETE FROM asset_tags WHERE asset_id = ?', [assetId]);
        target.run('DELETE FROM favorites WHERE asset_id = ?', [assetId]);
        target.run('DELETE FROM collection_items WHERE asset_id = ?', [assetId]);
        target.run('DELETE FROM asset_summaries WHERE asset_id = ?', [assetId]);
        target.run('DELETE FROM assets WHERE id = ?', [assetId]);
        target.run('COMMIT');
        const { tauriCmd, storageKey, extraArgs } = resolveArchiveIO(archive);
        _serializedWrite(target, tauriCmd, storageKey, extraArgs);
        return true;
    } catch (err) {
        target.run('ROLLBACK');
        debugLog('Database', 'deleteAssetFromArchive error', err);
        return false;
    }
}

/**
 * Belirli bir arşivden asset'i çöp kutusuna taşır (soft delete) — aktif arşivi DEĞİŞTİRMEZ.
 * Viewer ana arşivden silemez; yerel arşivde her rol silebilir.
 */
export function softDeleteAssetFromArchive(assetId: string, archive: ArchiveType): boolean {
    const def = getArchiveDef(archive);
    if (def?.type === 'shared' && getAppRole() === 'viewer') {
        throw new Error('Paylaşımlı arşive yazma yetkiniz yok (Viewer rolü)');
    }
    const target = dbMap.get(archive) ?? null;
    if (!target) return false;
    try {
        target.run(
            'UPDATE assets SET is_deleted = 1, deleted_at = ? WHERE id = ?',
            [new Date().toISOString(), assetId]
        );
        const { tauriCmd, storageKey, extraArgs } = resolveArchiveIO(archive);
        _serializedWrite(target, tauriCmd, storageKey, extraArgs);
        return true;
    } catch (err) {
        debugLog('Database', 'softDeleteAssetFromArchive error', err);
        return false;
    }
}

/**
 * Asset tablosuna yeni kayıt ekle veya güncelle (UPSERT).
 */
export function upsertAsset(asset: {
    id: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    fileType: string;
    category: string;
    createdAt: string;
    modifiedAt: string;
    projectName: string;
    projectPhase: string;
    materialGroup?: string;
    colorTheme?: string;
    architecturalStyle?: string;
    omniclassCode?: string;
    thumbnailUrl?: string;
    hash?: string;
    phash?: string;
    contentHash?: string;
    rawMetadata?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    aiTags?: Array<{ label: string; confidence: number; source: string }>;
    colorPalette?: Array<{ hex: string; percentage: number; name?: string }>;
    fsMtime?: number;
    metadataVersion?: number;
    appliedExtractors?: Record<string, number>;
}): void {
    if (!db) return;

    db.run(
        `INSERT INTO assets
    (id, file_name, file_path, file_size, file_type, category, created_at, modified_at,
     project_name, project_phase, material_group, color_theme, architectural_style,
     omniclass_code, is_indexed, hash, phash, content_hash, metadata_json, ai_tags_json,
     color_palette_json, thumbnail_url, raw_metadata, fs_mtime, metadata_version, applied_extractors)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      file_name          = excluded.file_name,
      file_path          = excluded.file_path,
      file_size          = excluded.file_size,
      file_type          = excluded.file_type,
      category           = excluded.category,
      created_at         = excluded.created_at,
      modified_at        = excluded.modified_at,
      project_name       = excluded.project_name,
      project_phase      = excluded.project_phase,
      material_group     = excluded.material_group,
      color_theme        = excluded.color_theme,
      architectural_style = excluded.architectural_style,
      omniclass_code     = excluded.omniclass_code,
      is_indexed         = excluded.is_indexed,
      is_deleted         = 0,
      deleted_at         = NULL,
      hash               = excluded.hash,
      phash              = excluded.phash,
      content_hash       = excluded.content_hash,
      metadata_json      = excluded.metadata_json,
      ai_tags_json       = excluded.ai_tags_json,
      color_palette_json = excluded.color_palette_json,
      thumbnail_url      = excluded.thumbnail_url,
      raw_metadata       = excluded.raw_metadata,
      fs_mtime           = excluded.fs_mtime,
      metadata_version   = excluded.metadata_version,
      applied_extractors = excluded.applied_extractors`,
        [
            asset.id, asset.fileName, asset.filePath, asset.fileSize, asset.fileType,
            asset.category, asset.createdAt, asset.modifiedAt, asset.projectName,
            asset.projectPhase, asset.materialGroup || null, asset.colorTheme || null,
            asset.architecturalStyle || null, asset.omniclassCode || null, asset.hash || null,
            asset.phash || null, asset.contentHash || null,
            JSON.stringify(asset.metadata || {}),
            JSON.stringify(asset.aiTags || []),
            JSON.stringify(asset.colorPalette || []),
            asset.thumbnailUrl || null,
            asset.rawMetadata ? JSON.stringify(asset.rawMetadata) : null,
            asset.fsMtime ?? null,
            asset.metadataVersion ?? 1,
            asset.appliedExtractors ? JSON.stringify(asset.appliedExtractors) : null,
        ]
    );
}

/**
 * Delta tarama: Mevcut asset metadata'sını kısmi olarak günceller.
 * Yeni alanlar eklenir, mevcut alanlar korunur. Kullanıcı tanımlı
 * alanlar (clientName, approvalStatus vb.) dokunulmaz.
 */
export function mergeAssetMetadata(
    assetId: string,
    newFields: Record<string, unknown>,
    newAppliedExtractors: Record<string, number>,
    newMetadataVersion: number,
): void {
    if (!db) return;
    const existing = getAssetById(assetId);
    if (!existing) return;

    // Metadata merge: yeni alanlar mevcut alanları override eder, diğerleri korunur
    const mergedMetadata = { ...(existing.metadata || {}), ...newFields };
    // Applied extractors merge
    const mergedExtractors = { ...(existing.appliedExtractors || {}), ...newAppliedExtractors };

    db.run(
        `UPDATE assets SET
            metadata_json = ?,
            applied_extractors = ?,
            metadata_version = ?
        WHERE id = ?`,
        [
            JSON.stringify(mergedMetadata),
            JSON.stringify(mergedExtractors),
            newMetadataVersion,
            assetId,
        ]
    );
}

/**
 * Embedding vektörü kaydet.
 */
export function saveEmbedding(assetId: string, vector: number[], source: string): void {
    if (!db) return;
    const id = `${assetId}_${source}`;
    db.run(
        `INSERT OR REPLACE INTO embeddings (id, asset_id, ref_id, vector_json, vector_blob, source)
     VALUES (?, ?, ?, '', ?, ?)`,
        [id, assetId, null, vectorToBlob(vector), source]
    );
}

/**
 * Chunk embedding kaydet.
 * Not: embeddings.asset_id yine asset'a bağlı kalır; ref_id = text_chunks.id.
 */
export function saveChunkEmbedding(assetId: string, chunkId: string, vector: number[], source: string = 'chunk_text'): void {
    if (!db) return;
    const id = `${chunkId}_${source}`;
    db.run(
        `INSERT OR REPLACE INTO embeddings (id, asset_id, ref_id, vector_json, vector_blob, source)
     VALUES (?, ?, ?, '', ?, ?)`,
        [id, assetId, chunkId, vectorToBlob(vector), source]
    );
}

export type TextChunkRow = {
    id: string;
    assetId: string;
    chunkIndex: number;
    page?: number;
    text: string;
    lang?: string;
};

export function upsertTextChunk(row: TextChunkRow): void {
    if (!db) return;
    db.run(
        `INSERT OR REPLACE INTO text_chunks (id, asset_id, chunk_index, page, text, lang)
     VALUES (?, ?, ?, ?, ?, ?)`,
        [row.id, row.assetId, row.chunkIndex, row.page ?? null, row.text, row.lang ?? null]
    );
}

export function deleteTextChunksByAssetId(assetId: string): void {
    if (!db) return;
    try {
        db.run('DELETE FROM text_chunks WHERE asset_id = ?', [assetId]);
    } catch (err) {
        debugLog('Database', 'deleteTextChunksByAssetId error', err);
    }
}

/**
 * Genel-amaçlı SQL runner — aktif (default) arşiv üzerinde çalışır.
 * Sadece ek modüller (chatStorage vb.) için açıktır; ana CRUD bunu
 * kullanmamalı, kendi tipli helper'ı olmalı.
 */
export function runSql(sql: string, params: unknown[] = []): void {
    if (!db) return;
    db.run(sql, params as never);
}

export function queryAll(sql: string, params: unknown[] = []): unknown[][] {
    if (!db) return [];
    try {
        const result = db.exec(sql, params as never);
        if (result.length === 0) return [];
        return result[0].values as unknown[][];
    } catch (err) {
        debugLog('Database', 'queryAll error', { sql, err });
        return [];
    }
}

/**
 * Asset'in RAG index durumunu günceller.
 * status: 'indexed' | 'skipped' | null (bekliyor/yeniden denenebilir)
 */
export function updateAssetRagStatus(
    assetId: string,
    status: 'indexed' | 'skipped' | null,
    reason: string | null = null,
): void {
    if (!db) return;
    try {
        db.run(
            `UPDATE assets SET rag_status = ?, rag_status_reason = ? WHERE id = ?`,
            [status, reason, assetId],
        );
        // Targeted rusqlite mirror — saveDatabase yerine. Fire-and-forget; UI bloku yok.
        void mirrorRagStatusToDisk([{ id: assetId, status, reason }]);
    } catch (err) {
        debugLog('Database', 'updateAssetRagStatus error', err);
    }
}

/**
 * RAG için: birden çok chunk ID için chunk metnini ve asset bilgisini getirir.
 * IN (?, ?, ...) ile tek sorgu.
 */
export function getChunksByIds(chunkIds: string[]): Array<{
    id: string; assetId: string; chunkIndex: number; page: number | null; text: string;
    fileName: string; filePath: string;
}> {
    if (!db || chunkIds.length === 0) return [];
    const rows: Array<{ id: string; assetId: string; chunkIndex: number; page: number | null; text: string; fileName: string; filePath: string }> = [];
    try {
        const placeholders = chunkIds.map(() => '?').join(',');
        const result = db.exec(
            `SELECT c.id, c.asset_id, c.chunk_index, c.page, c.text, a.file_name, a.file_path
             FROM text_chunks c
             LEFT JOIN assets a ON a.id = c.asset_id
             WHERE c.id IN (${placeholders})`,
            chunkIds,
        );
        if (result.length === 0) return rows;
        for (const row of result[0].values) {
            rows.push({
                id: row[0] as string,
                assetId: row[1] as string,
                chunkIndex: row[2] as number,
                page: (row[3] as number) ?? null,
                text: row[4] as string,
                fileName: (row[5] as string) ?? '',
                filePath: (row[6] as string) ?? '',
            });
        }
    } catch (err) {
        debugLog('Database', 'getChunksByIds error', err);
    }
    return rows;
}

export function deleteChunkEmbeddingsByAssetId(assetId: string, source: string = 'chunk_text'): void {
    if (!db) return;
    try {
        db.run(
            `DELETE FROM embeddings
       WHERE asset_id = ? AND source = ? AND ref_id IS NOT NULL AND ref_id != ''`,
            [assetId, source]
        );
    } catch (err) {
        debugLog('Database', 'deleteChunkEmbeddingsByAssetId error', err);
    }
}

export function getChunksByAssetId(assetId: string, limit: number = 50): Array<{ id: string; chunkIndex: number; page: number | null; text: string; lang: string | null }> {
    if (!db) return [];
    const rows: Array<{ id: string; chunkIndex: number; page: number | null; text: string; lang: string | null }> = [];
    try {
        const stmt = db.prepare(
            `SELECT id, chunk_index, page, text, lang
       FROM text_chunks
       WHERE asset_id = ?
       ORDER BY chunk_index ASC
       LIMIT ?`
        );
        stmt.bind([assetId, limit]);
        while (stmt.step()) {
            const o = stmt.getAsObject();
            rows.push({
                id: o.id as string,
                chunkIndex: o.chunk_index as number,
                page: (o.page as number) ?? null,
                text: o.text as string,
                lang: (o.lang as string) ?? null,
            });
        }
        stmt.free();
    } catch (err) {
        debugLog('Database', 'getChunksByAssetId error', err);
    }
    return rows;
}

export function getChunkCountByAssetId(assetId: string): number {
    if (!db) return 0;
    try {
        const stmt = db.prepare('SELECT COUNT(*) AS cnt FROM text_chunks WHERE asset_id = ?');
        stmt.bind([assetId]);
        let count = 0;
        if (stmt.step()) {
            const row = stmt.getAsObject();
            const cnt = row.cnt;
            count = typeof cnt === 'number' ? cnt : Number(cnt) || 0;
        }
        stmt.free();
        return count;
    } catch (err) {
        debugLog('Database', 'getChunkCountByAssetId error', err);
        return 0;
    }
}

/**
 * text_chunks tablosunda LIKE araması yapar — özel isimler ve birebir eşleşmeler için.
 * Semantic vektör aramasının kaçırdığı exact keyword'leri yakalar.
 * Sorgu token'larına bölünür; her token için eşleşen asset_id'ler döndürülür.
 */
/**
 * Bir token için büyük/küçük harf varyantlarını döndürür.
 * SQLite LIKE, ASCII dışı karakterlerde (ü, ş, ç…) harf duyarlıdır;
 * bu nedenle manuel olarak birden fazla pattern oluşturuyoruz.
 */
function buildCaseVariants(token: string): string[] {
    // JavaScript toLowerCase/toUpperCase Türkçe dahil Unicode'u doğru işler
    const lower = token.toLowerCase();
    const upper = token.toUpperCase();
    // Title case: ilk harfi büyüt (Türkçe i/ı özel durumu)
    const firstUpper = token[0] === 'i' ? 'İ' + token.slice(1)
        : token[0] === 'ı' ? 'I' + token.slice(1)
        : token[0].toUpperCase() + token.slice(1).toLowerCase();
    return [...new Set([lower, upper, firstUpper, token])].map(v => `%${v}%`);
}

export function searchTextChunksByKeyword(query: string): string[] {
    if (!db || !query.trim()) return [];
    try {
        const tokens = query.trim().split(/\s+/).filter(t => t.length >= 2);
        if (tokens.length === 0) return [];

        const union = new Set<string>();

        for (const token of tokens) {
            const patterns = buildCaseVariants(token);
            // Her varyant için OR yapıp tek sorguda çalıştır
            const placeholders = patterns.map(() => 'tc.text LIKE ?').join(' OR ');
            const stmt = db!.prepare(
                `SELECT DISTINCT tc.asset_id FROM text_chunks tc
                 INNER JOIN assets a ON a.id = tc.asset_id AND a.is_deleted = 0
                 WHERE ${placeholders} LIMIT 200`
            );
            stmt.bind(patterns);
            while (stmt.step()) {
                union.add(stmt.getAsObject().asset_id as string);
            }
            stmt.free();
        }

        return Array.from(union);
    } catch {
        return [];
    }
}

/** Hızlı kontrol: DB'de embedding var mı? (dosya-seviye + chunk embedding'lerin tümü) */
export function getEmbeddingCount(): number {
    if (!db) return 0;
    try {
        const stmt = db.prepare(
            `SELECT COUNT(*) as cnt FROM embeddings`
        );
        let count = 0;
        if (stmt.step()) {
            const row = stmt.getAsObject();
            const cnt = row.cnt;
            count = typeof cnt === 'number' ? cnt : Number(cnt) || 0;
        }
        stmt.free();
        return count;
    } catch {
        return 0;
    }
}

/** Returns the count of distinct assets that have at least one embedding vector. */
export function getEmbeddedAssetCount(): number {
    if (!db) return 0;
    try {
        const result = db.exec('SELECT COUNT(DISTINCT asset_id) FROM embeddings');
        return (result[0]?.values[0]?.[0] as number) || 0;
    } catch {
        return 0;
    }
}

export function getAllChunkEmbeddings(
    source: string = 'chunk_text',
    allowedAssetTypes?: string[],
): Array<{ assetId: string; chunkId: string; vector: number[] }> {
    if (!db) return [];
    const results: Array<{ assetId: string; chunkId: string; vector: number[] }> = [];
    try {
        let sql = `SELECT e.asset_id, e.ref_id, e.vector_blob, e.vector_json
                   FROM embeddings e`;
        const params: (string | number)[] = [];
        if (allowedAssetTypes && allowedAssetTypes.length > 0) {
            const ph = allowedAssetTypes.map(() => '?').join(',');
            sql += ` JOIN assets a ON a.id = e.asset_id
                     WHERE e.source = ? AND e.ref_id IS NOT NULL AND e.ref_id != ''
                       AND a.file_type IN (${ph})`;
            params.push(source, ...allowedAssetTypes);
        } else {
            sql += ` WHERE e.source = ? AND e.ref_id IS NOT NULL AND e.ref_id != ''`;
            params.push(source);
        }
        const stmt = db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const vec = parseVectorFromRow(row.vector_blob, row.vector_json);
            if (!vec) continue;
            results.push({
                assetId: row.asset_id as string,
                chunkId: row.ref_id as string,
                vector: vec,
            });
        }
        stmt.free();
    } catch (err) {
        debugLog('Database', 'getAllChunkEmbeddings error', err);
    }
    return results;
}

export function getChunkById(chunkId: string): { id: string; assetId: string; chunkIndex: number; page: number | null; text: string; lang: string | null } | null {
    if (!db) return null;
    try {
        const stmt = db.prepare(
            `SELECT id, asset_id, chunk_index, page, text, lang
       FROM text_chunks
       WHERE id = ?`
        );
        stmt.bind([chunkId]);
        if (!stmt.step()) {
            stmt.free();
            return null;
        }
        const o = stmt.getAsObject();
        stmt.free();
        return {
            id: o.id as string,
            assetId: o.asset_id as string,
            chunkIndex: o.chunk_index as number,
            page: (o.page as number) ?? null,
            text: o.text as string,
            lang: (o.lang as string) ?? null,
        };
    } catch (err) {
        debugLog('Database', 'getChunkById error', err);
        return null;
    }
}

export function saveAssetSummary(assetId: string, summary: string, keywords: string[], model?: string): void {
    if (!db) return;
    db.run(
        `INSERT OR REPLACE INTO asset_summaries (asset_id, summary, keywords_json, model)
     VALUES (?, ?, ?, ?)`,
        [assetId, summary, JSON.stringify(keywords), model || null]
    );
}

export function getAssetSummary(assetId: string): { assetId: string; summary: string; keywords: string[]; model: string | null } | null {
    if (!db) return null;
    try {
        const stmt = db.prepare(
            `SELECT asset_id, summary, keywords_json, model
       FROM asset_summaries
       WHERE asset_id = ?`
        );
        stmt.bind([assetId]);
        if (!stmt.step()) {
            stmt.free();
            return null;
        }
        const o = stmt.getAsObject();
        stmt.free();
        return {
            assetId: o.asset_id as string,
            summary: o.summary as string,
            keywords: JSON.parse((o.keywords_json as string) || '[]'),
            model: (o.model as string) ?? null,
        };
    } catch (err) {
        debugLog('Database', 'getAssetSummary error', err);
        return null;
    }
}

/**
 * Tüm embeddings'i getir (vektör arama için).
 */
/** DB'de en az bir embedding kaydı var mı? (hızlı kontrol) */
export function hasAnyEmbeddings(): boolean {
    if (!db) return false;
    try {
        const result = db.exec('SELECT 1 FROM embeddings LIMIT 1');
        return result.length > 0 && result[0].values.length > 0;
    } catch { return false; }
}

export function getAllEmbeddings(source: string = 'text'): Array<{ assetId: string; vector: number[] }> {
    if (!db) return [];
    const results: Array<{ assetId: string; vector: number[] }> = [];
    try {
        const stmt = db.prepare(
            `SELECT asset_id, vector_blob, vector_json FROM embeddings WHERE source = ?`
        );
        stmt.bind([source]);
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const vec = parseVectorFromRow(row.vector_blob, row.vector_json);
            if (!vec) continue;
            results.push({
                assetId: row.asset_id as string,
                vector: vec,
            });
        }
        stmt.free();
    } catch (err) {
        debugLog('Database', 'getAllEmbeddings error', err);
    }
    return results;
}

/**
 * source ön eki ile eşleşen tüm embedding kayıtlarını getirir.
 * Ör: "image_" -> image_global, image_center, ...
 */
export function getEmbeddingsBySourcePrefix(prefix: string): Array<{ assetId: string; source: string; vector: number[] }> {
    if (!db) return [];
    const results: Array<{ assetId: string; source: string; vector: number[] }> = [];
    try {
        const stmt = db.prepare(
            `SELECT asset_id, source, vector_blob, vector_json FROM embeddings WHERE source LIKE ?`
        );
        stmt.bind([`${prefix}%`]);
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const vec = parseVectorFromRow(row.vector_blob, row.vector_json);
            if (!vec) continue;
            results.push({
                assetId: row.asset_id as string,
                source: row.source as string,
                vector: vec,
            });
        }
        stmt.free();
    } catch (err) {
        debugLog('Database', 'getEmbeddingsBySourcePrefix error', err);
    }
    return results;
}

/**
 * Asset pHash map'i döndürür (rerank için hızlı erişim).
 */
export function getAssetPhashMap(): Record<string, string> {
    if (!db) return {};
    const map: Record<string, string> = {};
    try {
        const result = db.exec(`SELECT id, phash FROM assets WHERE phash IS NOT NULL AND phash != '' AND is_deleted = 0`);
        if (result.length === 0) return map;
        const { columns, values } = result[0];
        for (const row of values) {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            map[obj.id as string] = obj.phash as string;
        }
    } catch (err) {
        debugLog('Database', 'getAssetPhashMap error', err);
    }
    return map;
}

/**
 * Dosya yollarını toplu olarak yeniden eşle (prefix bazlı).
 * Örn: C:\Eski\Proje -> D:\Yeni\Proje
 */
export function remapFilePaths(oldPrefix: string, newPrefix: string): void {
    if (!db) return;
    const trimmedOld = oldPrefix.trim();
    if (!trimmedOld) return;
    try {
        const likePattern = `${trimmedOld}%`;
        db.run(
            'UPDATE assets SET file_path = REPLACE(file_path, ?, ?) WHERE file_path LIKE ?',
            [trimmedOld, newPrefix.trim(), likePattern]
        );
    } catch (err) {
        debugLog('Database', 'remapFilePaths error', err);
    }
}

/**
 * İstatistik bilgilerini getir.
 */
export function getStats(): { totalAssets: number; indexedAssets: number; totalEmbeddings: number } {
    if (!db) return { totalAssets: 0, indexedAssets: 0, totalEmbeddings: 0 };
    try {
        const total = db.exec('SELECT COUNT(*) FROM assets WHERE is_deleted = 0')[0]?.values[0]?.[0] as number || 0;
        const indexed = db.exec('SELECT COUNT(*) FROM assets WHERE is_indexed = 1 AND is_deleted = 0')[0]?.values[0]?.[0] as number || 0;
        const emb = db.exec('SELECT COUNT(*) FROM embeddings')[0]?.values[0]?.[0] as number || 0;
        return { totalAssets: total, indexedAssets: indexed, totalEmbeddings: emb };
    } catch (err) {
        debugLog('Database', 'getStats error', err);
        return { totalAssets: 0, indexedAssets: 0, totalEmbeddings: 0 };
    }
}

const ASSET_SELECT_COLUMNS = `
    id, file_name, file_path, file_size, file_type, category,
    created_at, modified_at, project_name, project_phase,
    material_group, color_theme, architectural_style, omniclass_code,
    is_indexed, hash, phash, content_hash, metadata_json, ai_tags_json, color_palette_json, thumbnail_url,
    raw_metadata, client_name, approval_status, version_label, deadline, fs_mtime, metadata_version, applied_extractors
`;

function assetFromDbRow(obj: Record<string, unknown>): Asset {
    return {
        id: obj.id as string,
        fileName: obj.file_name as string,
        filePath: obj.file_path as string,
        fileSize: obj.file_size as number,
        fileType: obj.file_type as AssetType,
        category: obj.category as CategoryType,
        createdAt: obj.created_at as string,
        modifiedAt: obj.modified_at as string,
        projectName: obj.project_name as string,
        projectPhase: obj.project_phase as ProjectPhase,
        materialGroup: (obj.material_group as MaterialGroup) || undefined,
        colorTheme: (obj.color_theme as ColorTheme) || undefined,
        architecturalStyle: (obj.architectural_style as ArchitecturalStyle) || undefined,
        omniclassCode: (obj.omniclass_code as string) || undefined,
        isIndexed: (obj.is_indexed as number) === 1,
        hash: (obj.hash as string) || undefined,
        phash: (obj.phash as string) || undefined,
        contentHash: (obj.content_hash as string) || undefined,
        metadata: JSON.parse((obj.metadata_json as string) || '{}'),
        rawMetadata: obj.raw_metadata ? JSON.parse(obj.raw_metadata as string) : undefined,
        aiTags: JSON.parse((obj.ai_tags_json as string) || '[]'),
        colorPalette: JSON.parse((obj.color_palette_json as string) || '[]'),
        thumbnailUrl: (obj.thumbnail_url as string) || undefined,
        clientName: (obj.client_name as string) || undefined,
        approvalStatus: (obj.approval_status as ApprovalStatus) || undefined,
        rejectionReason: (obj.rejection_reason as string) || undefined,
        versionLabel: (obj.version_label as string) || undefined,
        deadline: (obj.deadline as string) || undefined,
        fsMtime: (obj.fs_mtime as number | null) ?? undefined,
        metadataVersion: (obj.metadata_version as number | null) ?? undefined,
        appliedExtractors: obj.applied_extractors ? JSON.parse(obj.applied_extractors as string) : undefined,
        ragExcluded: obj.rag_excluded === 1,
    };
}

/**
 * Tek asset getir (indeks atlama için).
 */
export function getAssetById(id: string): Asset | null {
    if (!db) return null;
    try {
        const stmt = db.prepare(
            `SELECT ${ASSET_SELECT_COLUMNS} FROM assets WHERE id = ? AND is_deleted = 0`
        );
        stmt.bind([id]);
        if (!stmt.step()) {
            stmt.free();
            return null;
        }
        const row = stmt.getAsObject() as Record<string, unknown>;
        stmt.free();
        return assetFromDbRow(row);
    } catch (err) {
        debugLog('Database', 'getAssetById error', err);
        return null;
    }
}

/**
 * Veritabanındaki tüm asset'leri React state için Asset dizisi olarak döndür.
 */
export function getAllAssets(): Asset[] {
    if (!db) return [];
    const assets: Asset[] = [];
    try {
        const result = db.exec(`
            SELECT ${ASSET_SELECT_COLUMNS}
            FROM assets WHERE is_deleted = 0 ORDER BY modified_at DESC
        `);
        if (result.length === 0) return [];
        const { columns, values } = result[0];
        for (const row of values) {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            assets.push(assetFromDbRow(obj));
        }
    } catch (err) {
        debugLog('Database', 'getAllAssets error', err);
    }
    return assets;
}

/**
 * Sadece kullanıcı tanımlı proje alanlarını günceller.
 * upsertAsset() kullanmaz — yeniden taramada bu alanlar korunur.
 */
export function updateAssetFields(id: string, fields: {
    clientName?: string | null;
    approvalStatus?: ApprovalStatus | null;
    rejectionReason?: string | null;
    versionLabel?: string | null;
    deadline?: string | null;
}, changedBy?: string): void {
    assertWriteAccess();
    if (!db) return;

    // Onay geçmişi: approval_log kaydı (status değiştiğinde)
    if ('approvalStatus' in fields && changedBy) {
        try {
            const prev = db.exec('SELECT approval_status FROM assets WHERE id = ?', [id] as any);
            const fromStatus = prev[0]?.values[0]?.[0] as string | null;
            if (fromStatus !== (fields.approvalStatus ?? null)) {
                db.run(
                    `INSERT INTO approval_log (asset_id, from_status, to_status, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, fromStatus ?? 'draft', fields.approvalStatus ?? 'draft', fields.rejectionReason ?? null, changedBy, new Date().toISOString()],
                );
            }
        } catch { /* approval_log yoksa sessizce devam et */ }
    }

    const setClauses: string[] = [];
    const params: unknown[] = [];
    if ('clientName' in fields)       { setClauses.push('client_name = ?');       params.push(fields.clientName ?? null); }
    if ('approvalStatus' in fields)   { setClauses.push('approval_status = ?');   params.push(fields.approvalStatus ?? null); }
    if ('rejectionReason' in fields)  { setClauses.push('rejection_reason = ?');  params.push(fields.rejectionReason ?? null); }
    if ('versionLabel' in fields)     { setClauses.push('version_label = ?');     params.push(fields.versionLabel ?? null); }
    if ('deadline' in fields)         { setClauses.push('deadline = ?');          params.push(fields.deadline ?? null); }
    if (setClauses.length === 0) return;
    params.push(id);
    db.run(`UPDATE assets SET ${setClauses.join(', ')} WHERE id = ?`, params as any);
    saveDatabaseDeferred();
}

// ── RAG Hassasiyet Filtresi ─────────────────────────────────────────────────

/** Tek asset'in RAG dışlama durumunu değiştirir. */
export function setAssetRagExcluded(assetId: string, excluded: boolean): void {
    if (!db) return;
    db.run(`UPDATE assets SET rag_excluded = ? WHERE id = ?`, [excluded ? 1 : 0, assetId]);
    saveDatabaseDeferred();
}

/** Belirli klasör altındaki tüm asset'lerin RAG dışlama durumunu değiştirir. */
export function setFolderRagExcluded(folderPath: string, excluded: boolean): void {
    if (!db) return;
    const sep = folderPath.endsWith('/') || folderPath.endsWith('\\') ? '' : '/';
    const prefix = folderPath.replace(/\\/g, '/') + sep;
    db.run(
        `UPDATE assets SET rag_excluded = ? WHERE REPLACE(file_path, '\\', '/') LIKE ?`,
        [excluded ? 1 : 0, prefix + '%'],
    );
    saveDatabaseDeferred();
}

/** Manuel olarak RAG'dan hariç tutulan asset ID'lerini döndürür. */
export function getExcludedAssetIds(): Set<string> {
    if (!db) return new Set();
    const rows = db.exec(`SELECT id FROM assets WHERE rag_excluded = 1`);
    const set = new Set<string>();
    if (rows[0]) for (const r of rows[0].values) set.add(r[0] as string);
    return set;
}

/** Manuel olarak RAG'dan hariç tutulan asset sayısını döndürür. */
export function getExcludedAssetCount(): number {
    if (!db) return 0;
    const rows = db.exec(`SELECT COUNT(*) FROM assets WHERE rag_excluded = 1`);
    return rows[0]?.values[0]?.[0] as number ?? 0;
}

/** Keyword listesine göre eşleşen asset ID'lerini text_chunks'tan bulur. */
export function findAssetIdsByKeywords(keywords: string[]): Set<string> {
    if (!db || keywords.length === 0) return new Set();
    const conditions = keywords.map(() => `LOWER(tc.text) LIKE ?`).join(' OR ');
    const params = keywords.map(k => `%${k.toLowerCase()}%`);
    // Dosya adı + proje adı + chunk text'te arama
    const sql = `
        SELECT DISTINCT a.id FROM assets a
        LEFT JOIN text_chunks tc ON tc.asset_id = a.id
        WHERE (${conditions})
        OR ${keywords.map(() => `LOWER(a.file_name) LIKE ?`).join(' OR ')}
        OR ${keywords.map(() => `LOWER(COALESCE(a.project_name,'')) LIKE ?`).join(' OR ')}
    `;
    const allParams = [...params, ...params, ...params];
    const rows = db.exec(sql, allParams as any);
    const set = new Set<string>();
    if (rows[0]) for (const r of rows[0].values) set.add(r[0] as string);
    return set;
}

/** Onay geçmişi kayıtlarını döndürür (en yeniden eskiye). */
export function getApprovalLog(limit = 50): Array<{
    id: number; assetId: string; fromStatus: string; toStatus: string;
    reason: string | null; changedBy: string; changedAt: string;
    fileName?: string;
}> {
    if (!db) return [];
    try {
        const result = db.exec(
            `SELECT l.id, l.asset_id, l.from_status, l.to_status, l.reason, l.changed_by, l.changed_at, a.file_name
             FROM approval_log l LEFT JOIN assets a ON l.asset_id = a.id
             ORDER BY l.changed_at DESC LIMIT ?`,
            [limit] as any,
        );
        if (result.length === 0) return [];
        return result[0].values.map(r => ({
            id: r[0] as number,
            assetId: r[1] as string,
            fromStatus: r[2] as string,
            toStatus: r[3] as string,
            reason: (r[4] as string) || null,
            changedBy: r[5] as string,
            changedAt: r[6] as string,
            fileName: (r[7] as string) || undefined,
        }));
    } catch { return []; }
}

/**
 * İki asset arasında ilişki ekler.
 */
export function addAssetRelation(rel: Omit<AssetRelation, 'id'>): AssetRelation | null {
    assertWriteAccess();
    if (!db) return null;
    const id = `${rel.sourceId}:${rel.targetId}:${rel.relationType}`;
    try {
        db.run(
            `INSERT OR IGNORE INTO asset_relations (id, source_id, target_id, relation_type, notes, created_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, rel.sourceId, rel.targetId, rel.relationType, rel.notes ?? null, rel.createdAt, rel.createdBy]
        );
        saveDatabaseDeferred();
        return { ...rel, id };
    } catch (err) {
        debugLog('Database', 'addAssetRelation error', err);
        return null;
    }
}

/**
 * Belirli bir ilişkiyi kaldırır.
 */
export function removeAssetRelation(id: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('DELETE FROM asset_relations WHERE id = ?', [id]);
    saveDatabaseDeferred();
}

/**
 * Bir asset'in tüm ilişkilerini döndürür (her iki yön).
 */
export function getRelationsForAsset(assetId: string): AssetRelation[] {
    if (!db) return [];
    try {
        const result = db.exec(
            `SELECT id, source_id, target_id, relation_type, notes, created_at, created_by
             FROM asset_relations
             WHERE source_id = ? OR target_id = ?`,
            [assetId, assetId] as any
        );
        if (!result.length) return [];
        return result[0].values.map(row => ({
            id: row[0] as string,
            sourceId: row[1] as string,
            targetId: row[2] as string,
            relationType: row[3] as RelationType,
            notes: (row[4] as string) || undefined,
            createdAt: row[5] as string,
            createdBy: row[6] as 'user' | 'auto',
        }));
    } catch (err) {
        debugLog('Database', 'getRelationsForAsset error', err);
        return [];
    }
}

/** Tüm ilişkileri döndürür (otomatik tespit için). */
function _getAllRelationIds(): Set<string> {
    if (!db) return new Set();
    try {
        const result = db.exec('SELECT id FROM asset_relations');
        if (!result.length) return new Set();
        return new Set(result[0].values.map(r => r[0] as string));
    } catch { return new Set(); }
}

/** Dosya yolundan dizin + stem döndürür (ilişki gruplamak için). */
function _dirAndStem(filePath: string): { dir: string; stem: string } {
    const normalized = filePath.replace(/\\/g, '/');
    const lastSlash = normalized.lastIndexOf('/');
    const dir = lastSlash >= 0 ? normalized.slice(0, lastSlash) : '';
    const name = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot).toLowerCase() : name.toLowerCase();
    return { dir, stem };
}

/** detectVersion wrapper — database modülü içinde kullanım kolaylığı */
const _detectVersion = detectVersion;

/**
 * Aynı klasörde, aynı stem'e sahip dosyalar arasında otomatik ilişki tespiti.
 * Döner: oluşturulan ilişki sayısı.
 *
 * `onCreate` opsiyonel callback — sql.js INSERT'inden sonra her yeni ilişki için çağrılır
 * (örn. fileScanner rusqlite mirror için writeBuffer.addRelation kullanır).
 * `options.skipSave` true ise sondaki saveDatabase atlanır — caller başka yolla persist eder.
 */
export function detectAndSaveSameStemRelations(
    assets: Asset[],
    onCreate?: (rel: { id: string; sourceId: string; targetId: string; relationType: string; createdAt: string; createdBy: string }) => void,
    options: { skipSave?: boolean } = {},
): number {
    if (!db || assets.length === 0) return 0;

    const MODEL_EXTS = new Set(['MAX', 'SKP', 'RVT', 'BLEND', 'C4D', 'OBJ', 'FBX', '3DS', '3DM']);
    const IMAGE_EXTS = new Set(['JPEG', 'PNG', 'TIFF', 'WEBP', 'EXR', 'HDR', 'BMP']);

    // Mevcut ilişkileri yükle (duplicate engellemek için)
    const existingIds = _getAllRelationIds();

    // dir/stem bazında grupla
    const groups = new Map<string, Asset[]>();
    for (const asset of assets) {
        const { dir, stem } = _dirAndStem(asset.filePath);
        const key = `${dir}|${stem}`;
        const arr = groups.get(key) ?? [];
        arr.push(asset);
        groups.set(key, arr);
    }

    let created = 0;
    const now = new Date().toISOString();

    for (const group of groups.values()) {
        if (group.length < 2) continue;

        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = group[i];
                const b = group[j];

                let relType: RelationType | null = null;
                let sourceId = a.id;
                let targetId = b.id;

                // DWG/DXF → PDF
                if (
                    (a.fileType === 'DWG' || a.fileType === 'DXF') && b.fileType === 'PDF'
                ) {
                    relType = 'pdf_export'; sourceId = a.id; targetId = b.id;
                } else if (
                    (b.fileType === 'DWG' || b.fileType === 'DXF') && a.fileType === 'PDF'
                ) {
                    relType = 'pdf_export'; sourceId = b.id; targetId = a.id;
                }
                // 3D Model → Render/Image
                else if (MODEL_EXTS.has(a.fileType) && IMAGE_EXTS.has(b.fileType)) {
                    relType = 'render_of'; sourceId = b.id; targetId = a.id;
                } else if (IMAGE_EXTS.has(a.fileType) && MODEL_EXTS.has(b.fileType)) {
                    relType = 'render_of'; sourceId = a.id; targetId = b.id;
                }
                // Aynı tip + versiyon pattern → version_of (zengin pattern tespiti)
                else if (a.fileType === b.fileType) {
                    const vA = _detectVersion(a.fileName);
                    const vB = _detectVersion(b.fileName);
                    if (vA && vB && vA.baseName === vB.baseName) {
                        // Düşük sıradan yükseğe: source=eski, target=yeni
                        if (vA.sortOrder <= vB.sortOrder) {
                            relType = 'version_of'; sourceId = a.id; targetId = b.id;
                        } else {
                            relType = 'version_of'; sourceId = b.id; targetId = a.id;
                        }
                        // versionLabel auto-populate (sadece boşsa)
                        if (!a.versionLabel) {
                            try { db.run('UPDATE assets SET version_label = ? WHERE id = ? AND (version_label IS NULL OR version_label = \'\')', [vA.versionLabel, a.id]); } catch { /* skip */ }
                        }
                        if (!b.versionLabel) {
                            try { db.run('UPDATE assets SET version_label = ? WHERE id = ? AND (version_label IS NULL OR version_label = \'\')', [vB.versionLabel, b.id]); } catch { /* skip */ }
                        }
                    }
                }

                if (!relType) continue;

                const id = `${sourceId}:${targetId}:${relType}`;
                if (existingIds.has(id)) continue;

                try {
                    db.run(
                        `INSERT OR IGNORE INTO asset_relations (id, source_id, target_id, relation_type, notes, created_at, created_by)
                         VALUES (?, ?, ?, ?, NULL, ?, 'auto')`,
                        [id, sourceId, targetId, relType, now]
                    );
                    existingIds.add(id);
                    created++;
                    onCreate?.({ id, sourceId, targetId, relationType: relType, createdAt: now, createdBy: 'auto' });
                } catch { /* sessizce devam et */ }
            }
        }
    }

    if (created > 0 && !options.skipSave) saveDatabaseDeferred();
    return created;
}

/**
 * Belirli bir dosya yolunun yedeklerini döndür.
 * 1. metadata_json.backupOfPath ile tam eşleşme
 * 2. Fallback: aynı dizinde, aynı stem ile başlayan BAK dosyaları
 */
export function getBackupsForAsset(filePath: string): Asset[] {
    if (!db) return [];
    try {
        const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase();
        const normalized = norm(filePath);
        // Kaynak dosyanın dizini ve stem'i (uzantısız adı)
        const lastSlash = normalized.lastIndexOf('/');
        const sourceDir = normalized.substring(0, lastSlash + 1);
        const sourceFileName = normalized.substring(lastSlash + 1);
        const sourceStem = sourceFileName.substring(0, sourceFileName.lastIndexOf('.')) || sourceFileName;

        const result = db.exec(`
            SELECT ${ASSET_SELECT_COLUMNS}
            FROM assets
            WHERE file_type = 'BAK' AND is_deleted = 0
            ORDER BY modified_at DESC
        `);
        if (result.length === 0) return [];
        const { columns, values } = result[0];
        const backups: Asset[] = [];
        for (const row of values) {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            const asset = assetFromDbRow(obj);
            // Yöntem 1: backupOfPath tam eşleşme
            const bakPath = norm(asset.metadata.backupOfPath || '');
            if (bakPath && bakPath === normalized) {
                backups.push(asset);
                continue;
            }
            // Yöntem 2: aynı dizin + aynı stem ile başlayan dosya
            const bakFilePath = norm(asset.filePath);
            const bakLastSlash = bakFilePath.lastIndexOf('/');
            const bakDir = bakFilePath.substring(0, bakLastSlash + 1);
            const bakFileName = bakFilePath.substring(bakLastSlash + 1);
            if (bakDir === sourceDir && bakFileName.startsWith(sourceStem + '.')) {
                backups.push(asset);
            }
        }
        return backups;
    } catch (err) {
        debugLog('Database', 'getBackupsForAsset error', err);
        return [];
    }
}

/**
 * Tüm BAK dosyalarını döndür (refile işlemleri için).
 */
export function getAllBackupAssets(): Asset[] {
    if (!db) return [];
    try {
        const result = db.exec(`
            SELECT ${ASSET_SELECT_COLUMNS}
            FROM assets
            WHERE file_type = 'BAK' AND is_deleted = 0
            ORDER BY modified_at DESC
        `);
        if (result.length === 0) return [];
        const { columns, values } = result[0];
        return values.map(row => {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return assetFromDbRow(obj);
        });
    } catch (err) {
        debugLog('Database', 'getAllBackupAssets error', err);
        return [];
    }
}

/* ── Çöp Kutusu (Soft Delete) ── */

/** Asset'i çöp kutusuna taşır (soft delete) */
export function softDeleteAsset(assetId: string): boolean {
    assertWriteAccess();
    if (!db) return false;
    try {
        db.run(
            'UPDATE assets SET is_deleted = 1, deleted_at = ? WHERE id = ?',
            [new Date().toISOString(), assetId]
        );
        saveDatabaseDeferred();
        return true;
    } catch (err) {
        debugLog('Database', 'softDeleteAsset error', err);
        return false;
    }
}

/** Çöp kutusundaki asset'i geri yükler */
export function restoreAsset(assetId: string): boolean {
    assertWriteAccess();
    if (!db) return false;
    try {
        db.run(
            'UPDATE assets SET is_deleted = 0, deleted_at = NULL WHERE id = ?',
            [assetId]
        );
        saveDatabaseDeferred();
        return true;
    } catch (err) {
        debugLog('Database', 'restoreAsset error', err);
        return false;
    }
}

/** Çöp kutusundaki tüm asset'leri döndürür */
export function getDeletedAssets(): Array<Asset & { deletedAt: string }> {
    if (!db) return [];
    try {
        const result = db.exec(`
            SELECT ${ASSET_SELECT_COLUMNS}, deleted_at
            FROM assets WHERE is_deleted = 1
            ORDER BY deleted_at DESC
        `);
        if (result.length === 0) return [];
        const { columns, values } = result[0];
        return values.map(row => {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            return {
                ...assetFromDbRow(obj),
                deletedAt: (obj.deleted_at as string) || '',
            };
        });
    } catch (err) {
        debugLog('Database', 'getDeletedAssets error', err);
        return [];
    }
}

/** Çöp kutusundaki asset sayısını döndürür */
export function getTrashCount(): number {
    if (!db) return 0;
    try {
        const result = db.exec('SELECT COUNT(*) FROM assets WHERE is_deleted = 1');
        return (result[0]?.values[0]?.[0] as number) || 0;
    } catch {
        return 0;
    }
}

/** Çöp kutusundaki kaynak klasör (scanned_roots) sayısını döndürür */
export function getTrashFolderCount(): number {
    if (!db) return 0;
    try {
        const result = db.exec('SELECT COUNT(*) FROM scanned_roots WHERE is_deleted = 1');
        return (result[0]?.values[0]?.[0] as number) || 0;
    } catch {
        return 0;
    }
}

/** Tek bir asset'i kalıcı olarak siler (embeddings, chunks, tags, favorites dahil) */
export function permanentlyDeleteAsset(assetId: string): boolean {
    assertWriteAccess();
    if (!db) return false;
    db.run('BEGIN TRANSACTION');
    try {
        _cascadeDeleteAssetRows(assetId);
        db.run('COMMIT');
        // saveDatabase yerine targeted rusqlite cleanup — sql.js dump'ı diske yazmaz,
        // ana thread'i bloklamaz, çöp boşaltma sırasındaki donmayı engeller.
        void clearAssetsOnDisk('single_asset', assetId);
        return true;
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'permanentlyDeleteAsset error', err);
        return false;
    }
}

/** Çöp kutusundaki tüm asset'leri kalıcı olarak siler */
export function emptyTrashDb(): number {
    assertWriteAccess();
    if (!db) return 0;
    db.run('BEGIN TRANSACTION');
    try {
        // Çöpteki asset ID'lerini topla
        const result = db.exec('SELECT id FROM assets WHERE is_deleted = 1');
        if (result.length === 0 || result[0].values.length === 0) {
            db.run('COMMIT');
            return 0;
        }
        const ids = result[0].values.map(row => row[0] as string);
        for (const id of ids) {
            _cascadeDeleteAssetRows(id);
        }
        db.run('COMMIT');
        // saveDatabase yerine targeted rusqlite cleanup — db.export() ana thread'i
        // bloklamaz, "DB kaydediliyor" turuncu banner + donma yaşanmaz.
        void clearAssetsOnDisk('trash_only');
        return ids.length;
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'emptyTrashDb error', err);
        return 0;
    }
}

/**
 * DB dosyasının bulunduğu diskteki boş alanı kontrol eder.
 * Eşik: max(DB_boyutu * 3, 50MB). Düşükse 'archivist:storage-full' event fırlatır.
 * Hata durumunda sessizce devam eder — engelleme yapmaz.
 */
export async function checkDiskSpaceAndWarn(): Promise<void> {
    try {
        const info = await tauriInvoke<[string, number]>('get_database_info');
        if (!info) return;
        const [dbPath, dbSize] = info;

        const result = await tauriInvoke<[number, number]>('check_disk_space', { path: dbPath });
        if (!result) return;
        const [available] = result;

        const threshold = Math.max(dbSize * 3, 50 * 1024 * 1024); // max(DB*3, 50MB)
        if (available < threshold) {
            window.dispatchEvent(new CustomEvent('archivist:storage-full', { detail: { type: 'disk' } }));
        }
    } catch {
        // Sessiz — disk alanı kontrolü engelleyici olmamalı
    }
}

export function getDatabase(): SqlJsDatabase | null {
    return db;
}

/** @internal Test-only: DB referansını dışarıdan enjekte et */
export function _setDbForTesting(testDb: SqlJsDatabase | null): void {
    db = testDb;
    if (testDb) {
        dbMap.set(MAIN_ARCHIVE_ID, testDb);
    } else {
        dbMap.delete(MAIN_ARCHIVE_ID);
    }
}

/** @internal Test-only: Şemayı uygula */
export function _applySchemaForTesting(target: SqlJsDatabase): void {
    _applySchema(target);
}

/** @internal Test-only: Migration'ları uygula (şema sonrası) */
export function _applyMigrationsForTesting(target: SqlJsDatabase): void {
    _applyMigrations(target);
}

/* ── Çoklu Arşiv: N-arşiv yönetim fonksiyonları ── */

/** Yeni boş arşiv oluşturur ve dbMap'e kaydeder */
export async function createArchive(def: ArchiveDef): Promise<void> {
    const sqlJsModule = await import('sql.js');
    const initSqlJs: (config?: Record<string, unknown>) => Promise<any> =
        typeof sqlJsModule.default === 'function' ? sqlJsModule.default : (sqlJsModule as any);
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });

    const newDb = new SQL.Database() as unknown as SqlJsDatabase;
    newDb.run('PRAGMA foreign_keys = ON');
    _applySchema(newDb);
    _applyMigrations(newDb);

    dbMap.set(def.id, newDb);

    // Rust'a kaydet: config'e ekle + boş DB'yi diske yaz
    await tauriInvoke('create_archive_file', {
        archiveId: def.id,
        dbPath: def.dbPath ?? '',
        name: def.name,
        archiveType: def.type,
    });
    const data = newDb.export();
    await tauriInvoke('write_archive', { archiveId: def.id, data: Array.from(data) });
}

/** Mevcut ekstra arşivi diskten yükler (main/local dışındaki arşivler için) */
export async function initArchive(archiveId: string): Promise<SqlJsDatabase> {
    const existing = dbMap.get(archiveId);
    if (existing) return existing;

    const sqlJsModule = await import('sql.js');
    const initSqlJs: (config?: Record<string, unknown>) => Promise<any> =
        typeof sqlJsModule.default === 'function' ? sqlJsModule.default : (sqlJsModule as any);
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });

    const diskBytes = await tauriInvoke<number[]>('read_archive', { archiveId });
    let newDb: SqlJsDatabase;
    if (diskBytes && diskBytes.length > 0) {
        newDb = new SQL.Database(new Uint8Array(diskBytes)) as unknown as SqlJsDatabase;
    } else {
        newDb = new SQL.Database() as unknown as SqlJsDatabase;
    }
    newDb.run('PRAGMA foreign_keys = ON');
    _applySchema(newDb);
    _applyMigrations(newDb);

    dbMap.set(archiveId, newDb);
    return newDb;
}

/** Arşivi bellekten kaldırır (main hariç) */
export function unloadArchive(id: string): void {
    if (id === MAIN_ARCHIVE_ID) return;
    dbMap.delete(id);
}

/**
 * Belirli bir arşivin mevcut durumunu Uint8Array olarak döndürür.
 * Rollback/undo amaçlı snapshot oluşturmak için kullanılır.
 */
export function getArchiveSnapshot(archiveId: string): Uint8Array | null {
    const target = dbMap.get(archiveId);
    if (!target) return null;
    try {
        // .export() yeni bir Uint8Array döndürür — kopya gerekmez
        return target.export();
    } catch (err) {
        debugLog('Database', 'getArchiveSnapshot error', err);
        return null;
    }
}

/**
 * Daha önce alınmış snapshot'tan bir arşivi geri yükler.
 * Mevcut DB instance'ı imha edilir, yeni SQL.Database snapshot'tan oluşturulur.
 * Aktif arşivse dependent servisler (tag/favorite/message/logger) yeniden set edilir.
 * Diske de yazar (saveArchive).
 */
export async function restoreArchiveFromSnapshot(
    archiveId: string,
    snapshot: Uint8Array,
): Promise<void> {
    const sqlJsModule = await import('sql.js');
    const initSqlJs: (config?: Record<string, unknown>) => Promise<any> =
        typeof sqlJsModule.default === 'function' ? sqlJsModule.default : (sqlJsModule as any);
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });

    const newDb = new SQL.Database(snapshot) as unknown as SqlJsDatabase;
    newDb.run('PRAGMA foreign_keys = ON');
    dbMap.set(archiveId, newDb);

    // Aktif arşivse servisleri ve db referansını yenile
    if (archiveId === activeArchive) {
        db = newDb;
        setTagDb(newDb);
        setFavoritesDb(newDb);
    }
    if (archiveId === MAIN_ARCHIVE_ID) {
        setLoggerDb(newDb);
        setMessageDb(newDb);
        setUserDb(newDb);
    }

    // Diske yaz — kaynağa göre uygun komut seçilir
    const { tauriCmd, storageKey, extraArgs } = resolveArchiveIO(archiveId);
    _serializedWrite(newDb, tauriCmd, storageKey, extraArgs);
}

/* ── Kaynak Klasör Paneli (Faz 1.5) ── */

/** file_path'lerden kök dizinleri tespit eder. İlk 2 seviyeyi kök olarak kabul eder. */
function _detectRootDirectories(paths: string[]): string[] {
    const roots = new Set<string>();
    for (const p of paths) {
        if (!p) continue;
        const useBackslash = p.includes('\\');
        const parts = p.split(/[\\/]/).filter(Boolean);
        if (parts.length < 2) continue;
        const sep = useBackslash ? '\\' : '/';
        const prefix = p.startsWith('/') ? '/' : '';
        const root = prefix + parts.slice(0, 2).join(sep);
        roots.add(root);
    }
    return Array.from(roots);
}

function _basenameFromPath(p: string): string {
    const parts = p.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || p;
}

function _scannedRootFromRow(row: Record<string, unknown>): ScannedRoot {
    return {
        id: row.id as string,
        path: row.path as string,
        label: row.label as string,
        addedAt: (row.added_at as string) ?? '',
        lastScan: (row.last_scan as string) ?? null,
        fileCount: (row.file_count as number) ?? 0,
        status: (row.status as 'active' | 'removed') ?? 'active',
        groupId: (row.group_id as string | null) ?? null,
        isFavorite: Boolean(row.is_favorite),
    };
}

/**
 * Tarama raporunu APP_DATA/scan-reports/ altına TXT olarak yazar.
 * Tarama bittikten sonra çağrılır — ScanProgress.report'taki entry'leri
 * insan-okunabilir formatta dosyalar. Yazılan dosyanın tam path'ini döner.
 * Hata durumunda null — tarama akışını bozmaz.
 */
export async function writeScanReportToDisk(args: {
    rootPath: string;
    rootLabel: string;
    startedAt: string;
    finishedAt: string;
    totalFound: number;
    scannedCount: number;
    errorCount: number;
    entries: { filePath: string; category: string; reason: string; timestamp: string }[];
}): Promise<string | null> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        const path = await invoke<string>('write_scan_report', {
            payload: {
                root_path: args.rootPath,
                root_label: args.rootLabel,
                started_at: args.startedAt,
                finished_at: args.finishedAt,
                total_found: args.totalFound,
                scanned_count: args.scannedCount,
                error_count: args.errorCount,
                entries: args.entries.map(e => ({
                    file_path: e.filePath,
                    category: e.category,
                    reason: e.reason,
                    timestamp: e.timestamp,
                })),
            },
        });
        return path;
    } catch (err) {
        debugLog('Database', 'writeScanReportToDisk error', err);
        return null;
    }
}

/**
 * Tarama öncesi cleanup'i doğrudan rusqlite'a (diske) yansıtır.
 * fullReset: tüm assets/embeddings/text_chunks/dwg_shapes/asset_relations/scanned_roots silinir.
 * underPath: verilen prefix altındaki assets ve ilişkili kayıtlar silinir; scanned_roots korunur.
 *
 * KRİTİK: saveDatabaseAsync() yerine bunu kullan. saveDatabaseAsync sql.js dump'ını atomik
 * rename ile diske yazar → cleanup sonrası sql.js boşken çağrılırsa rusqlite'taki canlı
 * tarama verisini ezer (28 GB veri kaybı riski).
 */
export async function clearAssetsOnDisk(
    mode: 'all' | 'under_path' | 'trash_only' | 'single_asset',
    arg?: string,
): Promise<boolean> {
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        let payload: Record<string, unknown>;
        switch (mode) {
            case 'all':
                payload = { mode: 'all' };
                break;
            case 'under_path':
                payload = { mode: 'under_path', path: arg ?? '' };
                break;
            case 'trash_only':
                payload = { mode: 'trash_only' };
                break;
            case 'single_asset':
                payload = { mode: 'single_asset', id: arg ?? '' };
                break;
        }
        await invoke('scan_clear_assets', { mode: payload, archiveAt: activeArchive });
        return true;
    } catch (err) {
        debugLog('Database', 'clearAssetsOnDisk error', err);
        return false;
    }
}

/**
 * RAG indeksleme için targeted rusqlite mirror.
 * scan_write_batch'in text_chunks + embeddings + delete_chunks_for alt-kümesini kullanır;
 * diğer alanlar boş array. saveDatabase çağrılmaz; UI bloku yok.
 *
 * vector_blob: Float32Array.buffer'ın Uint8Array temsili → number[] (IPC için).
 * fileScanner.ts ScanWriteBuffer.addEmbedding ile aynı format.
 */
export async function mirrorRagWriteToDisk(payload: {
    chunks: Array<{ id: string; asset_id: string; chunk_index: number; page: number | null; text: string; lang: string | null }>;
    embeddings: Array<{ id: string; asset_id: string; ref_id: string | null; vector_blob: number[]; source: string }>;
    deleteChunksFor: string[];
}): Promise<boolean> {
    // Hiç değişiklik yoksa IPC'ye gerek yok
    if (payload.chunks.length === 0 && payload.embeddings.length === 0 && payload.deleteChunksFor.length === 0) {
        return true;
    }
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('scan_write_batch', {
            payload: {
                assets: [],
                embeddings: payload.embeddings,
                text_chunks: payload.chunks,
                delete_chunks_for: payload.deleteChunksFor,
                dwg_shapes: [],
                delete_shapes_for: [],
                relations: [],
                scanned_roots: [],
                delete_scanned_roots: [],
            },
            archiveAt: activeArchive,
        });
        return true;
    } catch (err) {
        debugLog('Database', 'mirrorRagWriteToDisk error', err);
        return false;
    }
}

/**
 * assets.rag_status + rag_status_reason için targeted rusqlite UPDATE.
 * update_asset_rag_status Rust komutunu çağırır — tek transaction, batch destekli.
 * Boş listede no-op.
 */
export async function mirrorRagStatusToDisk(
    updates: Array<{ id: string; status: string | null; reason: string | null }>,
): Promise<boolean> {
    if (updates.length === 0) return true;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('update_asset_rag_status', { updates, archiveAt: activeArchive });
        return true;
    } catch (err) {
        debugLog('Database', 'mirrorRagStatusToDisk error', err);
        return false;
    }
}

/**
 * Chat oturumları/mesajları için targeted rusqlite yazma — saveDatabase yerine.
 * sql.js bellek tarafı çağıran fonksiyonda zaten güncellenir; bu fonksiyon
 * paralel olarak diske yazar (~1ms). db.export() (100-500ms blok) atlar.
 *
 * Tüm alanlar opsiyonel — sadece kullanılanlar gönderilir.
 * Boş payload'da no-op (true döner).
 */
export type ChatMirrorPayload = {
    sessionsUpsert?: Array<{
        id: string; title: string;
        scopeJson: string | null; model: string | null;
        createdAt: string; updatedAt: string;
    }>;
    messagesUpsert?: Array<{
        id: string; sessionId: string; role: string; content: string;
        citationsJson: string | null;
        tokensIn: number | null; tokensOut: number | null;
        createdAt: string;
    }>;
    /** Sadece updated_at güncelleme (appendMessage için). */
    sessionTimestamps?: Array<{ id: string; updatedAt: string }>;
    /** Session sil (mesajları manuel CASCADE eder). */
    deleteSessionIds?: string[];
};

export async function writeChatMirror(payload: ChatMirrorPayload): Promise<boolean> {
    const sUp = payload.sessionsUpsert ?? [];
    const mUp = payload.messagesUpsert ?? [];
    const sTs = payload.sessionTimestamps ?? [];
    const dIds = payload.deleteSessionIds ?? [];
    if (sUp.length === 0 && mUp.length === 0 && sTs.length === 0 && dIds.length === 0) {
        return true;
    }
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('write_chat_mirror', {
            payload: {
                sessions_upsert: sUp.map((s) => ({
                    id: s.id,
                    title: s.title,
                    scope_json: s.scopeJson,
                    model: s.model,
                    created_at: s.createdAt,
                    updated_at: s.updatedAt,
                })),
                messages_upsert: mUp.map((m) => ({
                    id: m.id,
                    session_id: m.sessionId,
                    role: m.role,
                    content: m.content,
                    citations_json: m.citationsJson,
                    tokens_in: m.tokensIn,
                    tokens_out: m.tokensOut,
                    created_at: m.createdAt,
                })),
                session_timestamps: sTs.map((t) => ({ id: t.id, updated_at: t.updatedAt })),
                delete_session_ids: dIds,
            },
        });
        return true;
    } catch (err) {
        debugLog('Database', 'writeChatMirror error', err);
        return false;
    }
}

/**
 * Diskteki scanned_roots tablosundan bir veya daha fazla satırı kalıcı siler.
 * deleteScannedRootWithAssets akışında saveDatabase yerine kullanılır — sql.js dump'ı
 * diske yazmadığı için rusqlite'taki canlı asset/embedding verisini ezme riski yok.
 */
export async function deleteScannedRootRowsOnDisk(rootIds: string[]): Promise<boolean> {
    if (rootIds.length === 0) return true;
    try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('scan_write_batch', {
            payload: {
                assets: [], embeddings: [], text_chunks: [], delete_chunks_for: [],
                dwg_shapes: [], delete_shapes_for: [], relations: [], scanned_roots: [],
                delete_scanned_roots: rootIds,
            },
            archiveAt: activeArchive,
        });
        return true;
    } catch (err) {
        debugLog('Database', 'deleteScannedRootRowsOnDisk error', err);
        return false;
    }
}

/**
 * Belirli bir scanned_roots satırının güncel sql.js durumunu rusqlite'a (diske) yazar.
 * Tarama sonrası, addScannedRoot + updateRootScanInfo'dan sonra çağrılır — saveDatabase()
 * yerine targeted persist yapar (1-2 GB DB'yi yeniden yazmadan sadece tek satır).
 */
export async function persistScannedRootToDisk(rootId: string): Promise<boolean> {
    if (!db) return false;
    try {
        const result = db.exec(
            'SELECT id, path, label, status, last_scan, file_count FROM scanned_roots WHERE id = ?',
            [rootId] as never,
        );
        if (result.length === 0 || result[0].values.length === 0) return false;
        const row = result[0].values[0];
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('scan_write_batch', {
            payload: {
                assets: [], embeddings: [], text_chunks: [], delete_chunks_for: [],
                dwg_shapes: [], delete_shapes_for: [], relations: [],
                scanned_roots: [{
                    id: row[0] as string,
                    path: row[1] as string,
                    label: row[2] as string,
                    status: row[3] as string,
                    last_scan: (row[4] as string | null) ?? null,
                    file_count: (row[5] as number | null) ?? 0,
                }],
            },
            archiveAt: activeArchive,
        });
        return true;
    } catch (err) {
        debugLog('Database', 'persistScannedRootToDisk error', err);
        return false;
    }
}

/** Yeni taranan kök dizin kaydı oluşturur. ID döndürür. */
export function addScannedRoot(path: string, label?: string, options: { skipSave?: boolean } = {}): string {
    assertWriteAccess();
    if (!db) throw new Error('Database not ready');
    const id = crypto.randomUUID();
    const finalLabel = label ?? _basenameFromPath(path);
    try {
        db.run(
            'INSERT INTO scanned_roots (id, path, label, status) VALUES (?, ?, ?, ?)',
            [id, path, finalLabel, 'active']
        );
        if (!options.skipSave) saveDatabaseDeferred();
        return id;
    } catch (err) {
        // UNIQUE çakışması → mevcut kaydı aktif duruma getir (status + is_deleted)
        const existing = getScannedRootByExactPath(path);
        if (existing) {
            ensureScannedRootActive(existing.id);
            return existing.id;
        }
        debugLog('Database', 'addScannedRoot error', err);
        throw err;
    }
}

/** Mevcut bir scanned_root'u aktif duruma getirir.
 *  - is_deleted = 1 (çöp kutusunda) ise restoreScannedRootFromTrash ile geri yükler
 *    (klasör + altındaki asset'ler) ve kullanıcıya bilgi notification gösterir.
 *  - status !== 'active' ise UPDATE eder (rusqlite mirror).
 *  - Zaten aktifse no-op.
 *  Yeniden tarama akışında (useScanWorkflow) ve addScannedRoot UNIQUE branch'inde
 *  ortak nokta — kullanıcının çöpe attığını unuttuğu klasörü tarayınca sessizce
 *  geri gelir. */
export function ensureScannedRootActive(rootId: string): void {
    if (!db) return;
    try {
        const result = db.exec(
            'SELECT label, status, is_deleted FROM scanned_roots WHERE id = ?',
            [rootId] as any,
        );
        if (result.length === 0 || result[0].values.length === 0) return;
        const row = result[0].values[0];
        const label = row[0] as string;
        const status = row[1] as string;
        const isDeleted = (row[2] as number | null) === 1;

        if (isDeleted) {
            restoreScannedRootFromTrash(rootId);
            void (async () => {
                try {
                    const { notifyInfo } = await import('./notificationCenter');
                    const { default: i18n } = await import('../i18n');
                    notifyInfo(
                        i18n.t('trash.autoRestore.title'),
                        i18n.t('trash.autoRestore.message', { label }),
                    );
                } catch { /* notification servisi henüz hazır değilse sessizce geç */ }
            })();
        } else if (status !== 'active') {
            db.run('UPDATE scanned_roots SET status = ? WHERE id = ?', ['active', rootId]);
            void persistScannedRootToDisk(rootId);
        }
    } catch (err) {
        debugLog('Database', 'ensureScannedRootActive error', err);
    }
}

/** Kök dizini arşivden çıkarır (soft remove) — asset'ler silinmez.
 *  saveDatabase yerine targeted persist (rusqlite tek satır UPSERT). Bu sayede
 *  sql.js dump diske yazılmaz → rusqlite'taki canlı veri ezilme riski yok. */
export function removeScannedRoot(rootId: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('UPDATE scanned_roots SET status = ? WHERE id = ?', ['removed', rootId]);
    void persistScannedRootToDisk(rootId);
}

/** Soft-remove'lu klasörü tekrar aktifleştirir (undo için). */
export function reactivateScannedRoot(rootId: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('UPDATE scanned_roots SET status = ? WHERE id = ?', ['active', rootId]);
    void persistScannedRootToDisk(rootId);
}

/** Kök dizini ve ilgili tüm asset'leri kalıcı olarak siler. Silinen asset sayısı döner. */
export function deleteScannedRootWithAssets(rootId: string): number {
    assertWriteAccess();
    if (!db) return 0;
    const rootResult = db.exec('SELECT path FROM scanned_roots WHERE id = ?', [rootId] as any);
    if (rootResult.length === 0 || rootResult[0].values.length === 0) return 0;
    const rootPath = rootResult[0].values[0][0] as string;

    db.run('BEGIN TRANSACTION');
    try {
        const safePath = ensureTrailingSep(rootPath);
        const escaped = safePath.replace(/[\\_%]/g, '\\$&');
        const assetResult = db.exec(
            'SELECT id FROM assets WHERE file_path LIKE ? ESCAPE \'\\\'',
            [`${escaped}%`] as any
        );
        let deletedCount = 0;
        if (assetResult.length > 0) {
            const assetIds = assetResult[0].values.map(r => r[0] as string);
            deletedCount = assetIds.length;
            for (const id of assetIds) {
                _cascadeDeleteAssetRows(id);
            }
        }
        db.run('DELETE FROM scanned_roots WHERE id = ?', [rootId]);
        db.run('COMMIT');
        // saveDatabase yerine targeted rusqlite cleanup — sql.js dump diske yazmadan
        // canlı asset/embedding verisini ezme riski yok.
        void clearAssetsOnDisk('under_path', rootPath).then(() => deleteScannedRootRowsOnDisk([rootId]));
        return deletedCount;
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'deleteScannedRootWithAssets error', err);
        return 0;
    }
}

/* ── Fine-grained snapshot (undo desteği için) ─────────────────────── */

export interface RootDeletionSnapshot {
    root: Record<string, unknown>;
    assets: Record<string, unknown>[];
    embeddings: Record<string, unknown>[];
    textChunks: Record<string, unknown>[];
    assetTags: Record<string, unknown>[];
    favorites: Record<string, unknown>[];
    collectionItems: Record<string, unknown>[];
    assetRelations: Record<string, unknown>[];
    assetSummaries: Record<string, unknown>[];
    rootTags: Record<string, unknown>[];
}

function execToObjects(db: SqlJsDatabase, sql: string, params: unknown[] = []): Record<string, unknown>[] {
    const result = db.exec(sql, params as any);
    if (!result.length) return [];
    const { columns, values } = result[0];
    return values.map(row => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
    });
}

/**
 * Bir scanned_root ve tüm bağlı verilerini bellekte serialize eder.
 * Silme öncesi çağrılır; dönen obje undoRedo stack'inde saklanır.
 */
export function snapshotScannedRootWithAssets(rootId: string): RootDeletionSnapshot | null {
    if (!db) return null;
    const roots = execToObjects(db, 'SELECT * FROM scanned_roots WHERE id = ?', [rootId]);
    if (!roots.length) return null;
    const rootPath = roots[0].path as string;
    const safePath = ensureTrailingSep(rootPath);
    const escaped = safePath.replace(/[\\_%]/g, '\\$&');
    const pattern = `${escaped}%`;
    const assets = execToObjects(db, `SELECT * FROM assets WHERE file_path LIKE ? ESCAPE '\\'`, [pattern]);
    if (!assets.length) return { root: roots[0], assets: [], embeddings: [], textChunks: [], assetTags: [], favorites: [], collectionItems: [], assetRelations: [], assetSummaries: [], rootTags: [] };
    const ids = assets.map(a => a.id as string);
    const placeholders = ids.map(() => '?').join(',');
    return {
        root: roots[0],
        assets,
        embeddings: execToObjects(db, `SELECT * FROM embeddings WHERE asset_id IN (${placeholders})`, ids),
        textChunks: execToObjects(db, `SELECT * FROM text_chunks WHERE asset_id IN (${placeholders})`, ids),
        assetTags: execToObjects(db, `SELECT * FROM asset_tags WHERE asset_id IN (${placeholders})`, ids),
        favorites: execToObjects(db, `SELECT * FROM favorites WHERE asset_id IN (${placeholders})`, ids),
        collectionItems: execToObjects(db, `SELECT * FROM collection_items WHERE asset_id IN (${placeholders})`, ids),
        assetRelations: execToObjects(db, `SELECT * FROM asset_relations WHERE source_id IN (${placeholders}) OR target_id IN (${placeholders})`, [...ids, ...ids]),
        assetSummaries: execToObjects(db, `SELECT * FROM asset_summaries WHERE asset_id IN (${placeholders})`, ids),
        rootTags: execToObjects(db, 'SELECT * FROM root_tags WHERE root_id = ?', [rootId]),
    };
}

function insertRows(db: SqlJsDatabase, table: string, rows: Record<string, unknown>[]): void {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(',');
    const sql = `INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`;
    for (const row of rows) {
        db.run(sql, cols.map(c => row[c]) as any);
    }
}

/**
 * Fine-grained snapshot'tan veriyi geri yükler.
 * Sadece silinen root + assetlerini geri ekler; diğer veriye dokunmaz.
 */
export function restoreScannedRootWithAssets(snap: RootDeletionSnapshot): void {
    assertWriteAccess();
    if (!db) return;
    db.run('BEGIN TRANSACTION');
    try {
        insertRows(db, 'scanned_roots', [snap.root]);
        insertRows(db, 'assets', snap.assets);
        insertRows(db, 'embeddings', snap.embeddings);
        insertRows(db, 'text_chunks', snap.textChunks);
        insertRows(db, 'asset_tags', snap.assetTags);
        insertRows(db, 'favorites', snap.favorites);
        insertRows(db, 'collection_items', snap.collectionItems);
        insertRows(db, 'asset_relations', snap.assetRelations);
        insertRows(db, 'asset_summaries', snap.assetSummaries);
        insertRows(db, 'root_tags', snap.rootTags);
        db.run('COMMIT');
        saveDatabaseDeferred();
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'restoreScannedRootWithAssets error', err);
        throw err;
    }
}

/** Kök dizin label'ını değiştirir (path değişmez). */
export function renameScannedRoot(rootId: string, newLabel: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('UPDATE scanned_roots SET label = ? WHERE id = ?', [newLabel, rootId]);
    saveDatabaseDeferred();
}

/**
 * Aktif durumdaki tüm kök dizinleri döndürür.
 * `file_count` alanı canlı sayımdan gelir: BAK dosyaları hariç, silinmemiş assetler,
 * tek asset en uzun prefix eşleşen kök'e atanır (overlap olan köklerde çifte sayım olmaz).
 */
export function getScannedRoots(): ScannedRoot[] {
    if (!db) return [];
    const roots: ScannedRoot[] = [];
    try {
        const result = db.exec(
            "SELECT id, path, label, added_at, last_scan, file_count, status, group_id, is_favorite FROM scanned_roots WHERE status = 'active' AND (is_deleted IS NULL OR is_deleted = 0) ORDER BY added_at DESC"
        );
        if (result.length === 0) return roots;
        const { columns, values } = result[0];
        for (const row of values) {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            roots.push(_scannedRootFromRow(obj));
        }
    } catch (err) {
        debugLog('Database', 'getScannedRoots error', err);
        return roots;
    }

    // file_count'u canlı hesapla — stored değer taramada güncellenir ama silme,
    // BAK filtresi ve cross-root overlap senaryolarında güvensiz kalır.
    try {
        const assetsResult = db.exec(
            "SELECT file_path FROM assets WHERE is_deleted = 0 AND file_type != 'BAK'"
        );
        if (assetsResult.length === 0) {
            return roots.map(r => ({ ...r, fileCount: 0 }));
        }
        const liveCounts = new Map<string, number>(roots.map(r => [r.id, 0]));
        const sortedRoots = [...roots].sort((a, b) => b.path.length - a.path.length); // longest prefix first
        const rootPrefixes = new Map(sortedRoots.map(r => [r.id, ensureTrailingSep(r.path)]));
        for (const valueRow of assetsResult[0].values) {
            const filePath = valueRow[0] as string;
            for (const r of sortedRoots) {
                if (filePath.startsWith(rootPrefixes.get(r.id)!)) {
                    liveCounts.set(r.id, (liveCounts.get(r.id) ?? 0) + 1);
                    break;
                }
            }
        }
        return roots.map(r => ({ ...r, fileCount: liveCounts.get(r.id) ?? 0 }));
    } catch (err) {
        debugLog('Database', 'getScannedRoots live-count error', err);
        return roots;
    }
}

/** Kök dizinin son tarama bilgisini günceller. */
export function updateRootScanInfo(rootId: string, fileCount: number, options: { skipSave?: boolean } = {}): void {
    assertWriteAccess();
    if (!db) return;
    db.run(
        'UPDATE scanned_roots SET last_scan = ?, file_count = ? WHERE id = ?',
        [new Date().toISOString(), fileCount, rootId]
    );
    if (!options.skipSave) saveDatabaseDeferred();
}

/**
 * Asset dosya yolu (file_path) için en uygun (longest prefix match) kök dizini bulur.
 * Asset → kök eşleme gerektiğinde kullan. "Bu path zaten kayıtlı mı?" sorusu için
 * `getScannedRootByExactPath` kullan — aksi halde alt klasör taramaları mevcut kökle
 * yanlışlıkla birleşir.
 */
export function getScannedRootForPath(filePath: string): ScannedRoot | null {
    if (!db) return null;
    try {
        const result = db.exec(
            "SELECT id, path, label, added_at, last_scan, file_count, status, group_id, is_favorite FROM scanned_roots WHERE status = 'active'"
        );
        if (result.length === 0) return null;
        const { columns, values } = result[0];
        let bestMatch: ScannedRoot | null = null;
        let bestLength = 0;
        for (const row of values) {
            const obj: Record<string, unknown> = {};
            columns.forEach((col, i) => { obj[col] = row[i]; });
            const rootPath = obj.path as string;
            if (filePath.startsWith(rootPath) && rootPath.length > bestLength) {
                bestMatch = _scannedRootFromRow(obj);
                bestLength = rootPath.length;
            }
        }
        return bestMatch;
    } catch (err) {
        debugLog('Database', 'getScannedRootForPath error', err);
        return null;
    }
}

/**
 * Verilen path ile TAM eşleşen kök dizini döndürür (status farketmez — reactivation
 * için `removed` satırlar da dahil). Tarama akışında "bu klasör daha önce tarandı mı?"
 * sorusu için bunu kullan.
 */
export function getScannedRootByExactPath(path: string): ScannedRoot | null {
    if (!db) return null;
    try {
        const result = db.exec(
            'SELECT id, path, label, added_at, last_scan, file_count, status, group_id, is_favorite FROM scanned_roots WHERE path = ? LIMIT 1',
            [path] as any
        );
        if (result.length === 0 || result[0].values.length === 0) return null;
        const { columns, values } = result[0];
        const obj: Record<string, unknown> = {};
        columns.forEach((col, i) => { obj[col] = values[0][i]; });
        return _scannedRootFromRow(obj);
    } catch (err) {
        debugLog('Database', 'getScannedRootByExactPath error', err);
        return null;
    }
}

/* ── Faz 2: Root Group CRUD ── */

/** Yeni klasör grubu oluşturur. ID döndürür. */
export function createRootGroup(name: string, color = '#6366f1'): string {
    assertWriteAccess();
    if (!db) throw new Error('Database not ready');
    const id = crypto.randomUUID();
    const maxOrder = db.exec('SELECT COALESCE(MAX(sort_order), -1) FROM root_groups');
    const nextOrder = ((maxOrder[0]?.values[0][0] as number) ?? -1) + 1;
    db.run('INSERT INTO root_groups (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [id, name.trim(), color, nextOrder]);
    saveDatabaseDeferred();
    return id;
}

/** Undo için: sağlanan ID ile grup oluşturur — createRootGroup ile farkı ID'nin dışarıdan verilmesi. */
export function recreateRootGroup(id: string, name: string, color: string, sortOrder: number): void {
    assertWriteAccess();
    if (!db) return;
    db.run('INSERT OR REPLACE INTO root_groups (id, name, color, sort_order) VALUES (?, ?, ?, ?)', [id, name.trim(), color, sortOrder]);
    saveDatabaseDeferred();
}

/** Tüm grupları sort_order'a göre döndürür. */
export function getRootGroups(): RootGroup[] {
    if (!db) return [];
    try {
        const result = db.exec('SELECT id, name, color, sort_order, created_at FROM root_groups ORDER BY sort_order ASC');
        if (result.length === 0) return [];
        return result[0].values.map(row => ({
            id: row[0] as string,
            name: row[1] as string,
            color: row[2] as string,
            sortOrder: row[3] as number,
            createdAt: row[4] as string,
        }));
    } catch { return []; }
}

/** Grup adını değiştirir. */
export function renameRootGroup(groupId: string, newName: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('UPDATE root_groups SET name = ? WHERE id = ?', [newName.trim(), groupId]);
    saveDatabaseDeferred();
}

/** Grup rengini değiştirir. */
export function updateRootGroupColor(groupId: string, color: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('UPDATE root_groups SET color = ? WHERE id = ?', [color, groupId]);
    saveDatabaseDeferred();
}

/** Grubu siler — içindeki klasörler grupsuz kalır (group_id = NULL), silinmez. */
export function deleteRootGroup(groupId: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('UPDATE scanned_roots SET group_id = NULL WHERE group_id = ?', [groupId]);
    db.run('DELETE FROM root_groups WHERE id = ?', [groupId]);
    saveDatabaseDeferred();
}

export type RootGroupSnapshot = {
    group: { id: string; name: string; color: string; sortOrder: number; createdAt: string };
    memberRootIds: string[];
};

/** Grubu silmeden önce snapshot alır — undo için kullanılır. */
export function snapshotRootGroup(groupId: string): RootGroupSnapshot | null {
    if (!db) return null;
    try {
        const groupRow = db.exec('SELECT id, name, color, sort_order, created_at FROM root_groups WHERE id = ?', [groupId] as any);
        if (groupRow.length === 0 || groupRow[0].values.length === 0) return null;
        const v = groupRow[0].values[0];
        const group = {
            id: v[0] as string,
            name: v[1] as string,
            color: v[2] as string,
            sortOrder: v[3] as number,
            createdAt: v[4] as string,
        };
        const members = db.exec('SELECT id FROM scanned_roots WHERE group_id = ?', [groupId] as any);
        const memberRootIds: string[] = members.length > 0
            ? members[0].values.map((r) => r[0] as string)
            : [];
        return { group, memberRootIds };
    } catch (err) {
        debugLog('Database', 'snapshotRootGroup error', err);
        return null;
    }
}

/** Snapshot'tan grubu (ve üye klasör ilişkilerini) geri yükler. */
export function restoreRootGroup(snap: RootGroupSnapshot): void {
    assertWriteAccess();
    if (!db) return;
    const { group, memberRootIds } = snap;
    db.run(
        'INSERT OR REPLACE INTO root_groups (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
        [group.id, group.name, group.color, group.sortOrder, group.createdAt]
    );
    for (const rid of memberRootIds) {
        db.run('UPDATE scanned_roots SET group_id = ? WHERE id = ?', [group.id, rid]);
    }
    saveDatabaseDeferred();
}

/** Klasörü bir gruba atar (groupId = null → grupsuz). */
export function setRootGroup(rootId: string, groupId: string | null): void {
    assertWriteAccess();
    if (!db) return;
    db.run('UPDATE scanned_roots SET group_id = ? WHERE id = ?', [groupId, rootId]);
    saveDatabaseDeferred();
}

/** Klasörün favori durumunu günceller. */
export function setRootFavorite(rootId: string, isFavorite: boolean): void {
    assertWriteAccess();
    if (!db) return;
    db.run('UPDATE scanned_roots SET is_favorite = ? WHERE id = ?', [isFavorite ? 1 : 0, rootId]);
    saveDatabaseDeferred();
}

/** Verilen kök path altındaki asset sayısını döndürür. */
export function getAssetCountByRoot(rootPath: string): number {
    if (!db) return 0;
    try {
        const escaped = rootPath.replace(/[\\_%]/g, '\\$&');
        const result = db.exec(
            "SELECT COUNT(*) FROM assets WHERE file_path LIKE ? ESCAPE '\\' AND is_deleted = 0",
            [`${escaped}%`] as any
        );
        if (result.length === 0 || result[0].values.length === 0) return 0;
        return result[0].values[0][0] as number;
    } catch (err) {
        debugLog('Database', 'getAssetCountByRoot error', err);
        return 0;
    }
}

/* ─── FTS5 Chunk Arama (Lazy Loading) ────────────────────────────── */

/**
 * FTS5 ile keyword araması yapar. Dönen Map: chunkId → {assetId, score}.
 * Metinler Türkçe normalize edilmiş (normalizeTr) ve prefix wildcard destekli.
 */
export function ftsSearchChunks(
    query: string,
    limit: number = 300,
): Map<string, { assetId: string; score: number }> {
    const results = new Map<string, { assetId: string; score: number }>();
    if (!db) return results;
    const normalized = query
        .toLocaleLowerCase('tr')
        .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g')
        .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3);
    if (normalized.length === 0) return results;
    const matchExpr = normalized.map(t => `${t}*`).join(' OR ');
    try {
        const rows = db.exec(
            `SELECT chunk_id, asset_id FROM fts_chunks WHERE fts_chunks MATCH ? ORDER BY bm25(fts_chunks) LIMIT ?`,
            [matchExpr, limit] as never,
        );
        if (rows.length > 0) {
            for (let rank = 0; rank < rows[0].values.length; rank++) {
                const row = rows[0].values[rank];
                const chunkId = row[0] as string;
                const assetId = row[1] as string;
                if (chunkId && assetId) {
                    results.set(chunkId, { assetId, score: 1 / (rank + 1) });
                }
            }
        }
    } catch (err) {
        debugLog('Database', 'ftsSearchChunks error', err);
    }

    // FTS5 fallback: sql.js WASM FTS5 build'inde tokenize='ascii' bazen beklenen
    // tokenları üretmiyor ve MATCH 0 satır döndürüyor. Güvenli ağ olarak
    // normal `text_chunks` tablosuna LIKE yap — FTS5 virtual table'da LIKE
    // desteklenmez, bu yüzden text_chunks'ı hedefliyoruz.
    if (results.size === 0) {
        try {
            const likeClauses = normalized.map(() => `LOWER(text) LIKE ?`).join(' OR ');
            const likeParams = normalized.map((t) => `%${t}%`);
            const rows = db.exec(
                `SELECT id, asset_id FROM text_chunks WHERE ${likeClauses} LIMIT ?`,
                [...likeParams, limit] as never,
            );
            if (rows.length > 0) {
                for (let rank = 0; rank < rows[0].values.length; rank++) {
                    const row = rows[0].values[rank];
                    const chunkId = row[0] as string;
                    const assetId = row[1] as string;
                    if (chunkId && assetId) {
                        // Fallback score: FTS5'ten daha düşük tut (~0.5 * MATCH)
                        results.set(chunkId, { assetId, score: 0.5 / (rank + 1) });
                    }
                }
            }
        } catch (err) {
            debugLog('Database', 'ftsSearchChunks LIKE fallback error', err);
        }
    }

    return results;
}

/** Belirli chunkId'ler için embedding vektörlerini çeker (tam tablo taraması yok). */
export function getChunkEmbeddingsByIds(
    chunkIds: string[],
): Array<{ assetId: string; chunkId: string; vector: number[] }> {
    if (!db || chunkIds.length === 0) return [];
    const results: Array<{ assetId: string; chunkId: string; vector: number[] }> = [];
    try {
        const placeholders = chunkIds.map(() => '?').join(',');
        const rows = db.exec(
            `SELECT asset_id, ref_id, vector_blob, vector_json FROM embeddings WHERE source = 'chunk_text' AND ref_id IN (${placeholders})`,
            chunkIds as never,
        );
        if (rows.length === 0) return results;
        for (const row of rows[0].values) {
            const chunkId = row[1] as string;
            if (!chunkId) continue;
            const vec = parseVectorFromRow(row[2], row[3]);
            if (!vec) continue;
            results.push({
                assetId: row[0] as string,
                chunkId,
                vector: vec,
            });
        }
    } catch (err) {
        debugLog('Database', 'getChunkEmbeddingsByIds error', err);
    }
    return results;
}

/** Belirli asset ID'leri için tüm chunk embedding vektörlerini çeker. */
export function getChunkEmbeddingsByAssetIds(
    assetIds: string[],
): Array<{ assetId: string; chunkId: string; vector: number[] }> {
    if (!db || assetIds.length === 0) return [];
    const results: Array<{ assetId: string; chunkId: string; vector: number[] }> = [];
    try {
        const placeholders = assetIds.map(() => '?').join(',');
        const rows = db.exec(
            `SELECT asset_id, ref_id, vector_blob, vector_json FROM embeddings WHERE source = 'chunk_text' AND asset_id IN (${placeholders})`,
            assetIds as never,
        );
        if (rows.length === 0) return results;
        for (const row of rows[0].values) {
            const chunkId = row[1] as string;
            if (!chunkId) continue;
            const vec = parseVectorFromRow(row[2], row[3]);
            if (!vec) continue;
            results.push({
                assetId: row[0] as string,
                chunkId,
                vector: vec,
            });
        }
    } catch (err) {
        debugLog('Database', 'getChunkEmbeddingsByAssetIds error', err);
    }
    return results;
}

/** Bir chunk'ı FTS5 indeksine ekler. Metin Türkçe normalize edilir. */
export function insertFtsChunk(chunkId: string, assetId: string, text: string): void {
    if (!db) return;
    try {
        const normalized = text
            .toLocaleLowerCase('tr')
            .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g')
            .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u');
        db.run(
            'INSERT INTO fts_chunks(chunk_id, asset_id, text) VALUES (?, ?, ?)',
            [chunkId, assetId, normalized] as never,
        );
    } catch (err) {
        debugLog('Database', 'insertFtsChunk error', err);
    }
}

/** Bir asset'in tüm FTS5 chunk girdilerini siler. Re-index öncesi çağrılır. */
export function deleteFtsChunksByAssetId(assetId: string): void {
    if (!db) return;
    try {
        db.run('DELETE FROM fts_chunks WHERE asset_id = ?', [assetId] as never);
    } catch (err) {
        debugLog('Database', 'deleteFtsChunksByAssetId error', err);
    }
}

/* ─── Klasör Çöp Kutusu (Trash v2) ───────────────────────────────── */

export interface DeletedRoot {
    id: string;
    path: string;
    label: string;
    deletedAt: string;
}

/** Klasörü ve altındaki tüm asset'leri soft-delete eder (Çöp Kutusu'na taşır).
 *  saveDatabase yerine Rust soft_delete_root_in_trash komutu — atomic rename ile
 *  rusqlite verisini ezme riski yok. UI tutarlılığı için sql.js de paralel günceller. */
export function softDeleteScannedRootWithAssets(rootId: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('BEGIN TRANSACTION');
    try {
        const rootResult = db.exec('SELECT path FROM scanned_roots WHERE id = ?', [rootId] as any);
        if (rootResult.length === 0 || rootResult[0].values.length === 0) {
            db.run('ROLLBACK');
            return;
        }
        const rootPath = rootResult[0].values[0][0] as string;
        const now = new Date().toISOString();
        // 1. sql.js (UI/in-memory state)
        db.run('UPDATE scanned_roots SET is_deleted = 1, deleted_at = ? WHERE id = ?', [now, rootId]);
        const safePath = ensureTrailingSep(rootPath);
        const escaped = safePath.replace(/[\\_%]/g, '\\$&');
        db.run(
            "UPDATE assets SET is_deleted = 1, deleted_at = ? WHERE file_path LIKE ? ESCAPE '\\' AND is_deleted = 0",
            [now, `${escaped}%`],
        );
        db.run('COMMIT');
        // 2. rusqlite (disk) — fire-and-forget; saveDatabase ÇAĞRILMAZ
        void (async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('soft_delete_root_in_trash', {
                    payload: { root_id: rootId, root_path: rootPath, deleted_at: now },
                    archiveAt: activeArchive,
                });
            } catch (err) {
                debugLog('Database', 'soft_delete_root_in_trash error', err);
            }
        })();
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'softDeleteScannedRootWithAssets error', err);
    }
}

/** Çöp Kutusu'ndaki klasörü ve altındaki asset'leri geri yükler. */
export function restoreScannedRootFromTrash(rootId: string): void {
    assertWriteAccess();
    if (!db) return;
    db.run('BEGIN TRANSACTION');
    try {
        const rootResult = db.exec(
            'SELECT path FROM scanned_roots WHERE id = ? AND is_deleted = 1',
            [rootId] as any,
        );
        if (rootResult.length === 0 || rootResult[0].values.length === 0) {
            db.run('ROLLBACK');
            return;
        }
        const rootPath = rootResult[0].values[0][0] as string;
        // 1. sql.js
        db.run('UPDATE scanned_roots SET is_deleted = 0, deleted_at = NULL WHERE id = ?', [rootId]);
        const safePath = ensureTrailingSep(rootPath);
        const escaped = safePath.replace(/[\\_%]/g, '\\$&');
        db.run(
            "UPDATE assets SET is_deleted = 0, deleted_at = NULL WHERE file_path LIKE ? ESCAPE '\\' AND is_deleted = 1",
            [`${escaped}%`],
        );
        db.run('COMMIT');
        // 2. rusqlite (disk) — fire-and-forget; saveDatabase ÇAĞRILMAZ
        void (async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('restore_root_from_trash_disk', {
                    payload: { root_id: rootId, root_path: rootPath },
                    archiveAt: activeArchive,
                });
            } catch (err) {
                debugLog('Database', 'restore_root_from_trash_disk error', err);
            }
        })();
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'restoreScannedRootFromTrash error', err);
    }
}

/** Soft-delete edilmiş klasörleri döndürür. */
export function getDeletedRoots(): DeletedRoot[] {
    if (!db) return [];
    try {
        const result = db.exec(
            "SELECT id, path, COALESCE(label, '') as label, deleted_at FROM scanned_roots WHERE is_deleted = 1 ORDER BY deleted_at DESC",
        );
        if (result.length === 0) return [];
        return result[0].values.map(row => {
            const p = row[1] as string;
            return {
                id: row[0] as string,
                path: p,
                label: (row[2] as string) || p.split(/[\\/]/).pop() || p,
                deletedAt: row[3] as string,
            };
        });
    } catch (err) {
        debugLog('Database', 'getDeletedRoots error', err);
        return [];
    }
}

/** @internal initDatabase'den çağrılır — assertWriteAccess atlanır. */
function _purgeExpiredTrashInternal(target: SqlJsDatabase): number {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    target.run('BEGIN TRANSACTION');
    try {
        const expiredAssets = target.exec(
            "SELECT id FROM assets WHERE is_deleted = 1 AND deleted_at < ?",
            [cutoff] as any,
        );
        let count = 0;
        if (expiredAssets.length > 0 && expiredAssets[0].values.length > 0) {
            const ids = expiredAssets[0].values.map(r => r[0] as string);
            count += ids.length;
            for (const id of ids) {
                target.run('DELETE FROM embeddings WHERE asset_id = ?', [id]);
                target.run('DELETE FROM text_chunks WHERE asset_id = ?', [id]);
                target.run('DELETE FROM asset_tags WHERE asset_id = ?', [id]);
                target.run('DELETE FROM favorites WHERE asset_id = ?', [id]);
                target.run('DELETE FROM collection_items WHERE asset_id = ?', [id]);
                target.run('DELETE FROM asset_summaries WHERE asset_id = ?', [id]);
                target.run('DELETE FROM assets WHERE id = ?', [id]);
            }
        }
        const expiredRoots = target.exec(
            "SELECT id FROM scanned_roots WHERE is_deleted = 1 AND deleted_at < ?",
            [cutoff] as any,
        );
        if (expiredRoots.length > 0 && expiredRoots[0].values.length > 0) {
            const rootIds = expiredRoots[0].values.map(r => r[0] as string);
            count += rootIds.length;
            for (const rootId of rootIds) {
                target.run('DELETE FROM scanned_roots WHERE id = ?', [rootId]);
            }
        }
        target.run('COMMIT');
        if (count > 0) saveDatabaseDeferred();
        return count;
    } catch (err) {
        target.run('ROLLBACK');
        debugLog('Database', '_purgeExpiredTrashInternal error', err);
        return 0;
    }
}

/** 30 günden eski çöp öğelerini kalıcı olarak siler. Silinen öğe sayısı döner. */
export function purgeExpiredTrash(daysOld: number = 30): number {
    assertWriteAccess();
    if (!db) return 0;
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
    db.run('BEGIN TRANSACTION');
    try {
        const expiredAssets = db.exec(
            "SELECT id FROM assets WHERE is_deleted = 1 AND deleted_at < ?",
            [cutoff] as any,
        );
        let count = 0;
        if (expiredAssets.length > 0 && expiredAssets[0].values.length > 0) {
            const ids = expiredAssets[0].values.map(r => r[0] as string);
            count += ids.length;
            for (const id of ids) {
                _cascadeDeleteAssetRows(id);
            }
        }
        const expiredRoots = db.exec(
            "SELECT id FROM scanned_roots WHERE is_deleted = 1 AND deleted_at < ?",
            [cutoff] as any,
        );
        if (expiredRoots.length > 0 && expiredRoots[0].values.length > 0) {
            const rootIds = expiredRoots[0].values.map(r => r[0] as string);
            count += rootIds.length;
            for (const rootId of rootIds) {
                db.run('DELETE FROM scanned_roots WHERE id = ?', [rootId]);
            }
        }
        db.run('COMMIT');
        if (count > 0) saveDatabaseDeferred();
        return count;
    } catch (err) {
        db.run('ROLLBACK');
        debugLog('Database', 'purgeExpiredTrash error', err);
        return 0;
    }
}
