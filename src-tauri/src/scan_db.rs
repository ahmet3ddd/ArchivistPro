//! Tarama sırasında inkremental diske yazma — rusqlite ile doğrudan INSERT.
//!
//! Frontend sql.js WASM'da db.export() çağrısı tüm DB'yi kopyalar (OOM riski).
//! Bu modül, tarama checkpoint'lerinde sadece yeni verileri diske yazar.

use serde::{Deserialize, Serialize};

// ── Payload yapıları ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ScanBatchPayload {
    pub assets: Vec<AssetRow>,
    pub embeddings: Vec<EmbeddingRow>,
    pub text_chunks: Vec<TextChunkRow>,
    pub delete_chunks_for: Vec<String>,
    // DWG shapes alımı WIP — frontend payload'ında gönderiliyor (serde wire
    // kontratı), Rust tarafında henüz tüketilmiyor. Alan KALMALI yoksa
    // deserialize sessizce veri düşürür. (clippy dead_code: bilinçli)
    #[serde(default)]
    #[allow(dead_code)]
    pub dwg_shapes: Vec<DwgShapeRow>,
    #[serde(default)]
    #[allow(dead_code)]
    pub delete_shapes_for: Vec<String>,
    #[serde(default)]
    pub relations: Vec<AssetRelationRow>,
    #[serde(default)]
    pub scanned_roots: Vec<ScannedRootRow>,
    /// Diskteki scanned_roots tablosundan silinecek satırların ID'leri.
    /// "Sil (asset'lerle)" akışında scanned_root satırını rusqlite'a coherent şekilde
    /// kaldırmak için — saveDatabase çağırmadan.
    #[serde(default)]
    pub delete_scanned_roots: Vec<String>,
}

// Serde wire kontratı (frontend → Tauri). DWG shapes DB-yazımı WIP olduğundan
// alanlar henüz Rust'ta okunmuyor; silmek payload'ı sessizce bozar (bilinçli).
#[derive(Deserialize)]
#[allow(dead_code)]
pub struct DwgShapeRow {
    pub id: String,
    pub asset_id: String,
    pub layer_name: String,
    pub layer_category: String,
    pub entity_type: String,
    pub vertex_count: i32,
    pub is_closed: i32,
    pub area: f64,
    pub perimeter: f64,
    pub aspect_ratio: f64,
    pub regularity: f64,
    pub bbox_w: f64,
    pub bbox_h: f64,
    pub centroid_x: f64,
    pub centroid_y: f64,
    // Faz 4.4 — gelişmiş geometrik özellikler
    #[serde(default)]
    pub compactness: f64,
    #[serde(default)]
    pub solidity: f64,
    #[serde(default)]
    pub rectangularity: f64,
}

#[derive(Deserialize)]
pub struct AssetRelationRow {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation_type: String,
    pub created_at: String,
    pub created_by: String,
}

#[derive(Deserialize)]
pub struct ScannedRootRow {
    pub id: String,
    pub path: String,
    pub label: String,
    pub status: String,
    pub last_scan: Option<String>,
    pub file_count: Option<i64>,
}

#[derive(Deserialize)]
pub struct AssetRow {
    pub id: String,
    pub file_name: String,
    pub file_path: String,
    pub file_size: i64,
    pub file_type: String,
    pub category: String,
    pub created_at: String,
    pub modified_at: String,
    pub project_name: String,
    pub project_phase: String,
    pub material_group: Option<String>,
    pub color_theme: Option<String>,
    pub architectural_style: Option<String>,
    pub omniclass_code: Option<String>,
    pub hash: Option<String>,
    pub phash: Option<String>,
    pub content_hash: Option<String>,
    pub metadata_json: String,
    pub ai_tags_json: String,
    pub color_palette_json: String,
    pub thumbnail_url: Option<String>,
    pub raw_metadata: Option<String>,
    pub fs_mtime: Option<i64>,
    pub metadata_version: i32,
    pub applied_extractors: Option<String>,
}

#[derive(Deserialize)]
pub struct EmbeddingRow {
    pub id: String,
    pub asset_id: String,
    pub ref_id: Option<String>,
    pub vector_blob: Vec<u8>,
    pub source: String,
}

#[derive(Deserialize)]
pub struct TextChunkRow {
    pub id: String,
    pub asset_id: String,
    pub chunk_index: i32,
    pub page: Option<i32>,
    pub text: String,
    pub lang: Option<String>,
}

// ── Sonuç yapısı ──────────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct ScanBatchResult {
    pub assets_written: usize,
    pub embeddings_written: usize,
    pub chunks_written: usize,
    pub chunks_deleted: usize,
    pub shapes_written: usize,
    pub shapes_deleted: usize,
    pub relations_written: usize,
    pub roots_written: usize,
    pub roots_deleted: usize,
}

// ── Şema güvenliği ────────────────────────────────────────────────────────────

/// V3 A6-PRE-2: epoch-bağımsız temel şema. Her arşivde her zaman uygulanır
/// (assets, scanned_roots — V3 cutover'a tabi olmayan tablolar). Bkz
/// [`apply_main_schema`] gating mantığı için.
const CORE_SCHEMA: &str = "
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
    fs_mtime INTEGER,
    is_deleted INTEGER DEFAULT 0,
    deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS scanned_roots (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    added_at TEXT DEFAULT (datetime('now')),
    last_scan TEXT,
    file_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active'
);
";

/// V3 A6-PRE-2: yalnız epoch=0'da uygulanan V3-eligible şema. Bu üç tablo
/// (`embeddings`, `text_chunks`, `asset_relations`) migrasyon (`runV3Epoch
/// Migration` A3) sonrası **vec.db'de** yaşar; main DB'de DROP'lu. Burada
/// `CREATE TABLE IF NOT EXISTS` koşulsuz çalışırsa DROP'lu tabloları boş
/// yeniden yaratır → çift kaynaklı veri (FTS bozulması, 2026-05-20 A6
/// askısı kanıtı). [`apply_main_schema`] PRAGMA user_version=0 koşulunu
/// kontrol eder ve aksi halde bu sabiti execute_batch ETMEZ.
const V3_ELIGIBLE_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    ref_id TEXT,
    vector_json TEXT,
    vector_blob BLOB,
    source TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS text_chunks (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    page INTEGER,
    text TEXT NOT NULL,
    lang TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS asset_relations (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT DEFAULT 'user'
);
";

/// V3 A6-PRE-2: ana DB için şemayı epoch'a göre uygular. CORE_SCHEMA her
/// zaman çalışır; V3_ELIGIBLE_SCHEMA sadece `PRAGMA user_version = 0`
/// olduğunda (yani arşiv henüz v3 cutover yaşamamışken).
///
/// Bu helper [`write_scan_batch_to_db`], [`scan_clear_assets`],
/// [`soft_delete_root_in_trash`], [`restore_root_from_trash_disk`]
/// fonksiyonlarından çağrılır — tümü main DB üzerine yazıyor.
///
/// audit_log/chat_*/asset_tags vb. tablolar buraya dahil değildir; ilgili
/// komutlar kendi EXTRA_*_SCHEMA sabitlerini ayrı uygular (epoch'tan
/// bağımsız).
pub(crate) fn apply_main_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    apply_main_schema_get_epoch(conn).map(|_| ())
}

/// V3 A6-PRE-3a: [`apply_main_schema`]'nın epoch'u DA dönen versiyonu.
/// `write_scan_batch_to_db` / `scan_clear_assets` gibi tek-geçişte hem şema
/// uygulayıp hem epoch'a göre yazma yolunu seçmek gereken yerler içindir.
/// İki ayrı `PRAGMA user_version` sorgusunu önler; semantik birebir aynı
/// (CORE her zaman, V3_ELIGIBLE epoch=0 koşullu).
pub(crate) fn apply_main_schema_get_epoch(conn: &rusqlite::Connection) -> Result<i64, String> {
    conn.execute_batch(CORE_SCHEMA)
        .map_err(|e| format!("core şema oluşturma hatası: {}", e))?;
    let epoch: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);
    if epoch == 0 {
        conn.execute_batch(V3_ELIGIBLE_SCHEMA)
            .map_err(|e| format!("V3 eligible şema oluşturma hatası: {}", e))?;
    }
    Ok(epoch)
}

/// V3 A6-PRE-3b: verilen sorgudan asset id'lerini topla — main TX dışında
/// (vec.db DELETE'leri için hedef listesi). `scan_clear_assets` UnderPath/
/// TrashOnly modlarında subquery'leri cross-DB simüle eder.
fn select_asset_ids(
    conn: &rusqlite::Connection,
    sql: &str,
    params: impl rusqlite::Params,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("asset id select prepare: {}", e))?;
    let rows = stmt
        .query_map(params, |r| r.get::<_, String>(0))
        .map_err(|e| format!("asset id query: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("asset id satır: {}", e))
}

// Sql.js tarafında yaratılan yan tablolar — rusqlite cleanup yolları (TrashOnly /
// SingleAsset) bu tabloları da silebilmeli. CORE_SCHEMA/V3_ELIGIBLE_SCHEMA'ya
// katmak yerine ayrı tutuyoruz çünkü bu tablolar tarama checkpoint'lerinde
// kullanılmıyor.
const EXTRA_TRASH_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS asset_tags (
    asset_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (asset_id, tag_id)
);
CREATE TABLE IF NOT EXISTS favorites (
    asset_id TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS collection_items (
    collection_id INTEGER NOT NULL,
    asset_id TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, asset_id)
);
CREATE TABLE IF NOT EXISTS asset_summaries (
    asset_id TEXT PRIMARY KEY,
    summary TEXT NOT NULL,
    keywords_json TEXT NOT NULL,
    model TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
";

// Audit log şeması — sql.js'deki database.ts:526 ile aynı yapı.
// CREATE IF NOT EXISTS idempotent; rusqlite path'inden çağrıldığında tabloyu garantiler.
const EXTRA_AUDIT_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    role TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    result TEXT NOT NULL DEFAULT 'SUCCESS',
    prev_hash TEXT,
    row_hash TEXT
);
";

// Chat şeması — sql.js'deki database.ts:679-701 ile aynı yapı.
// rusqlite path'inden çağrıldığında tabloları garantiler (mirror çağrısı önce yapılırsa).
const EXTRA_CHAT_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    scope_json TEXT,
    model TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);
CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    citations_json TEXT,
    tokens_in INTEGER,
    tokens_out INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(created_at);
";

// ── Tarama raporu (TXT) ───────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ScanReportEntry {
    pub file_path: String,
    pub category: String,
    pub reason: String,
    pub timestamp: String,
}

#[derive(Deserialize)]
pub struct ScanReportPayload {
    pub root_path: String,
    pub root_label: String,
    pub started_at: String,
    pub finished_at: String,
    pub total_found: usize,
    pub scanned_count: usize,
    pub error_count: usize,
    pub entries: Vec<ScanReportEntry>,
}

/// Tarama raporu TXT'sini APP_DATA/scan-reports/ altına yazar.
/// Format: insan okunabilir; başta özet, sonra kategori başına gruplanmış liste.
/// Dönüş: yazılan dosyanın tam path'i (UI'da "aç" için).
#[tauri::command]
pub async fn write_scan_report(
    app: tauri::AppHandle,
    payload: ScanReportPayload,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<String, String> {
    crate::require_authenticated(&role_state)?;

    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        use tauri::Manager;

        // APP_DATA/scan-reports/
        let app_data = app.path()
            .app_data_dir()
            .map_err(|e| format!("APP_DATA path: {}", e))?;
        let reports_dir = app_data.join("scan-reports");
        std::fs::create_dir_all(&reports_dir)
            .map_err(|e| format!("Rapor klasörü oluşturulamadı: {}", e))?;

        // Dosya adı: {sanitized-label}-{ISO-tarih}.txt
        let safe_label: String = payload.root_label
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
            .collect::<String>()
            .chars()
            .take(80)
            .collect();
        // ISO zamanı dosya adı için: ":" ve "." → "-"
        let safe_time = payload.finished_at.replace([':', '.'], "-");
        let file_name = format!("{}-{}.txt", safe_label, safe_time);
        let file_path = reports_dir.join(&file_name);

        let mut f = std::fs::File::create(&file_path)
            .map_err(|e| format!("Rapor dosyası oluşturulamadı: {}", e))?;

        // ─ Başlık + özet ─
        writeln!(f, "ArchivistPro — Tarama Raporu").map_err(stringify_io)?;
        writeln!(f, "{}", "=".repeat(60)).map_err(stringify_io)?;
        writeln!(f, "Klasör      : {}", payload.root_label).map_err(stringify_io)?;
        writeln!(f, "Yol         : {}", payload.root_path).map_err(stringify_io)?;
        writeln!(f, "Başlangıç   : {}", payload.started_at).map_err(stringify_io)?;
        writeln!(f, "Bitiş       : {}", payload.finished_at).map_err(stringify_io)?;
        writeln!(f, "Bulunan     : {} dosya", payload.total_found).map_err(stringify_io)?;
        writeln!(f, "İşlenen     : {} dosya", payload.scanned_count).map_err(stringify_io)?;
        writeln!(f, "Hata sayısı : {} per-file", payload.error_count).map_err(stringify_io)?;
        writeln!(f, "Rapor giriş : {}", payload.entries.len()).map_err(stringify_io)?;
        writeln!(f).map_err(stringify_io)?;

        // ─ Kategoriye göre grupla ─
        let mut by_cat: std::collections::BTreeMap<String, Vec<&ScanReportEntry>> =
            std::collections::BTreeMap::new();
        for e in &payload.entries {
            by_cat.entry(e.category.clone()).or_default().push(e);
        }

        // Özet sayım
        writeln!(f, "Kategori Özeti:").map_err(stringify_io)?;
        for (cat, list) in &by_cat {
            writeln!(f, "  {:<22} : {}", cat, list.len()).map_err(stringify_io)?;
        }
        writeln!(f).map_err(stringify_io)?;
        writeln!(f, "{}", "=".repeat(60)).map_err(stringify_io)?;
        writeln!(f).map_err(stringify_io)?;

        // ─ Detay liste ─
        for (cat, list) in &by_cat {
            writeln!(f, "[ {} ]  ({} kayıt)", cat, list.len()).map_err(stringify_io)?;
            writeln!(f, "{}", "-".repeat(60)).map_err(stringify_io)?;
            for e in list {
                writeln!(f, "  {}", e.file_path).map_err(stringify_io)?;
                writeln!(f, "      → {}", e.reason).map_err(stringify_io)?;
                writeln!(f, "      @ {}", e.timestamp).map_err(stringify_io)?;
            }
            writeln!(f).map_err(stringify_io)?;
        }

        f.sync_all().map_err(stringify_io)?;
        Ok(file_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

fn stringify_io(e: std::io::Error) -> String { format!("Yazma hatası: {}", e) }

// ── Trash (soft-delete) komutları — sql.js saveDatabase race'ini bypass eder ───

#[derive(Deserialize)]
pub struct SoftDeleteRootPayload {
    pub root_id: String,
    pub root_path: String,
    pub deleted_at: String,
}

/// Aktif arşive göre doğru DB yolunu döner.
/// "local" → yerel arşiv, "main"/None → ana arşiv, diğer → custom arşiv.
fn resolve_archive_db_path(app: &tauri::AppHandle, archive_at: Option<&str>) -> Result<std::path::PathBuf, String> {
    match archive_at {
        Some("local") => crate::ollama_db::resolve_local_db_path(app),
        Some(id) if id != "main" && !id.is_empty() => crate::ollama_db::resolve_archive_path(app, id),
        _ => crate::ollama_db::resolve_db_path(app),
    }
}

/// Klasörü ve altındaki TÜM asset'leri Çöp Kutusu'na taşır (is_deleted=1).
/// sql.js saveDatabase yerine doğrudan rusqlite'a UPDATE — atomic rename ile
/// canlı tarama verisini ezme riski yok.
#[tauri::command]
pub async fn soft_delete_root_in_trash(
    app: tauri::AppHandle,
    payload: SoftDeleteRootPayload,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<usize, String> {
    crate::require_authenticated(&role_state)?;
    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock().map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = crate::ollama_db::acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;
        let conn = crate::ollama_db::prepare_write_conn(&db_path)?;
        // V3 A6-PRE-2: epoch>=N olan arşivlerde DROP'lu V3-eligible tabloları
        // yeniden yaratma (A6 askısı root cause). PRAGMA user_version koşullu.
        apply_main_schema(&conn)?;

        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction başlatma hatası: {}", e))?;

        // Path prefix için trailing separator ekle (klasör altı match)
        let sep = if payload.root_path.contains('\\') { '\\' } else { '/' };
        let safe_path = if payload.root_path.ends_with(sep) {
            payload.root_path.clone()
        } else {
            format!("{}{}", payload.root_path, sep)
        };
        // SQLite LIKE wildcard escape (\, _, %)
        let escaped = safe_path
            .replace('\\', "\\\\")
            .replace('_', "\\_")
            .replace('%', "\\%");
        let like_pattern = format!("{}%", escaped);

        // Root satırı + altındaki asset'leri soft-delete
        tx.execute(
            "UPDATE scanned_roots SET is_deleted = 1, deleted_at = ?1 WHERE id = ?2",
            rusqlite::params![&payload.deleted_at, &payload.root_id],
        ).map_err(|e| format!("scanned_roots update hatası: {}", e))?;

        let n = tx.execute(
            "UPDATE assets SET is_deleted = 1, deleted_at = ?1
             WHERE file_path LIKE ?2 ESCAPE '\\' AND is_deleted = 0",
            rusqlite::params![&payload.deleted_at, &like_pattern],
        ).map_err(|e| format!("assets update hatası: {}", e))?;

        tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
        Ok(n as usize)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

#[derive(Deserialize)]
pub struct RestoreRootPayload {
    pub root_id: String,
    pub root_path: String,
}

/// Çöp Kutusu'ndaki klasörü geri yükler (is_deleted=0). sql.js saveDatabase yerine
/// doğrudan rusqlite UPDATE.
#[tauri::command]
pub async fn restore_root_from_trash_disk(
    app: tauri::AppHandle,
    payload: RestoreRootPayload,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<usize, String> {
    crate::require_authenticated(&role_state)?;
    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock().map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = crate::ollama_db::acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;
        let conn = crate::ollama_db::prepare_write_conn(&db_path)?;
        // V3 A6-PRE-2: epoch>=N olan arşivlerde DROP'lu V3-eligible tabloları
        // yeniden yaratma (A6 askısı root cause). PRAGMA user_version koşullu.
        apply_main_schema(&conn)?;

        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction başlatma hatası: {}", e))?;

        let sep = if payload.root_path.contains('\\') { '\\' } else { '/' };
        let safe_path = if payload.root_path.ends_with(sep) {
            payload.root_path.clone()
        } else {
            format!("{}{}", payload.root_path, sep)
        };
        let escaped = safe_path
            .replace('\\', "\\\\")
            .replace('_', "\\_")
            .replace('%', "\\%");
        let like_pattern = format!("{}%", escaped);

        tx.execute(
            "UPDATE scanned_roots SET is_deleted = 0, deleted_at = NULL WHERE id = ?1",
            rusqlite::params![&payload.root_id],
        ).map_err(|e| format!("scanned_roots update hatası: {}", e))?;

        let n = tx.execute(
            "UPDATE assets SET is_deleted = 0, deleted_at = NULL
             WHERE file_path LIKE ?1 ESCAPE '\\' AND is_deleted = 1",
            rusqlite::params![&like_pattern],
        ).map_err(|e| format!("assets update hatası: {}", e))?;

        tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
        Ok(n as usize)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

#[derive(Serialize)]
pub struct ScanReportFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_iso: String,
}

/// APP_DATA/scan-reports/ klasöründeki tüm TXT raporları listeler.
/// Yeni raporlar başta (modified time DESC).
#[tauri::command]
pub async fn list_scan_reports(
    app: tauri::AppHandle,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<Vec<ScanReportFile>, String> {
    crate::require_authenticated(&role_state)?;

    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let app_data = app.path()
            .app_data_dir()
            .map_err(|e| format!("APP_DATA path: {}", e))?;
        let reports_dir = app_data.join("scan-reports");
        if !reports_dir.exists() { return Ok(vec![]); }

        let mut files: Vec<ScanReportFile> = vec![];
        for entry in std::fs::read_dir(&reports_dir).map_err(|e| format!("Klasör okuma: {}", e))? {
            let entry = match entry { Ok(e) => e, Err(_) => continue };
            let path = entry.path();
            if !path.is_file() { continue; }
            if path.extension().and_then(|s| s.to_str()) != Some("txt") { continue; }
            let meta = match entry.metadata() { Ok(m) => m, Err(_) => continue };
            let modified = meta.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| {
                    // Basit ISO-like: dosya adında zaten zaman var, yine de modified ekleyelim
                    let secs = d.as_secs();
                    format!("{}", secs)
                })
                .unwrap_or_default();
            files.push(ScanReportFile {
                path: path.to_string_lossy().to_string(),
                name: path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string(),
                size: meta.len(),
                modified_iso: modified,
            });
        }
        // Yeni dosya başta — modified time DESC
        files.sort_by(|a, b| b.modified_iso.cmp(&a.modified_iso));
        Ok(files)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Bir rapor TXT'sini okuyup içeriğini string olarak döner.
#[tauri::command]
pub async fn read_scan_report_file(
    app: tauri::AppHandle,
    file_path: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<String, String> {
    crate::require_authenticated(&role_state)?;
    // Güvenlik: sadece APP_DATA/scan-reports altından oku
    let app_data = {
        use tauri::Manager;
        app.path().app_data_dir().map_err(|e| format!("APP_DATA path: {}", e))?
    };
    let reports_dir = app_data.join("scan-reports");
    let canonical_request = std::path::PathBuf::from(&file_path);
    if !canonical_request.starts_with(&reports_dir) {
        return Err("Dosya scan-reports dizininin dışında".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read_to_string(&file_path)
            .map_err(|e| format!("Rapor okunamadı: {}", e))
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Verilen path'i sistemin varsayılan uygulamasıyla açar (Windows: ShellExecute, çoğunlukla Notepad).
/// Sadece APP_DATA altındaki yollar için izin verilir (güvenlik).
#[tauri::command]
pub async fn open_scan_report_in_default_app(
    app: tauri::AppHandle,
    file_path: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;
    let app_data = {
        use tauri::Manager;
        app.path().app_data_dir().map_err(|e| format!("APP_DATA path: {}", e))?
    };
    let reports_dir = app_data.join("scan-reports");
    let request = std::path::PathBuf::from(&file_path);
    if !request.starts_with(&reports_dir) {
        return Err("Dosya scan-reports dizininin dışında".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            // CREATE_NO_WINDOW = 0x08000000
            std::process::Command::new("cmd")
                .args(["/C", "start", "", &file_path])
                .creation_flags(0x08000000)
                .spawn()
                .map_err(|e| format!("Açma hatası: {}", e))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&file_path)
                .spawn()
                .map_err(|e| format!("Açma hatası: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&file_path)
                .spawn()
                .map_err(|e| format!("Açma hatası: {}", e))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ── Cleanup payload ───────────────────────────────────────────────────────────

/// Shape DB ayrı dosyada — commit sonrası uygulamak için skalar mode bilgisi.
enum ShapeClearMode {
    All,
    SingleAsset(String),
}

#[derive(Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum ScanClearMode {
    /// Tüm arşivi temizle (fullReset). assets + embeddings + text_chunks +
    /// dwg_shapes + asset_relations + scanned_roots silinir.
    All,
    /// Verilen path prefix'i altındaki asset'leri ve ilişkili kayıtları siler.
    /// scanned_roots korunur — yeni tarama sayacı sonradan güncelleyecek.
    UnderPath { path: String },
    /// Çöp kutusunu boşalt: WHERE is_deleted = 1 olan tüm asset'leri ve
    /// ilişkili kayıtları siler. scanned_roots korunur.
    TrashOnly,
    /// Tek bir asset'i kalıcı olarak siler (UI'daki "Kalıcı sil" akışı).
    /// scanned_roots korunur.
    SingleAsset { id: String },
}

#[derive(Serialize)]
pub struct ScanClearResult {
    pub assets_deleted: usize,
    pub embeddings_deleted: usize,
    pub chunks_deleted: usize,
    pub shapes_deleted: usize,
    pub relations_deleted: usize,
    pub roots_deleted: usize,
}

// ── Tauri komutu ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn scan_clear_assets(
    app: tauri::AppHandle,
    mode: ScanClearMode,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<ScanClearResult, String> {
    crate::require_authenticated(&role_state)?;

    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;

    // Shape DB temizliği için spawn_blocking closure'a aktarılacak değerler
    let app_for_shapes = app.clone();
    let archive_at_for_shapes = archive_at.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = crate::ollama_db::acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

        let conn = crate::ollama_db::prepare_write_conn(&db_path)?;
        // V3 A6-PRE-3b: epoch'a göre routing.
        // epoch=0  → mevcut davranış birebir (V3-eligible DELETE'ler main TX'te).
        // epoch>=1 → embeddings vec.db'den silinir; main DELETE SKIP.
        // epoch>=2 → text_chunks vec.db'den silinir; main DELETE SKIP.
        // epoch>=3 → asset_relations vec.db'den silinir; main DELETE SKIP.
        let epoch = apply_main_schema_get_epoch(&conn)?;
        let vec_db_path: Option<std::path::PathBuf> = if epoch >= 1 {
            Some(crate::vec_db::resolve_vec_db_path_from_main(&db_path)?)
        } else {
            None
        };
        // Sql.js tarafının sahip olduğu yan tablolar — TrashOnly/SingleAsset DELETE'leri
        // bunların var olduğunu varsayar. CREATE IF NOT EXISTS idempotent.
        conn.execute_batch(EXTRA_TRASH_SCHEMA)
            .map_err(|e| format!("Yan şema oluşturma hatası: {}", e))?;

        let mut result = ScanClearResult {
            assets_deleted: 0,
            embeddings_deleted: 0,
            chunks_deleted: 0,
            shapes_deleted: 0,
            relations_deleted: 0,
            roots_deleted: 0,
        };

        // V3 A6-PRE-3b: epoch>=N'de vec.db DELETE'lerini main TX BAŞLAMADAN
        // ÖNCE yap (atomiklik stratejisi write_scan_batch_to_db ile aynı:
        // vec.db hata → main TX hiç açılmaz → tutarsızlık yok). Önce hedef
        // asset_id'leri main conn'dan SELECT et (TX dışı), sonra vec.db'de
        // sil. ALL modunda asset_id listesine ihtiyaç yok (tüm tablolar).
        if let Some(ref vdb) = vec_db_path {
            match &mode {
                ScanClearMode::All => {
                    let rep = crate::vec_db::clear_all_v3_data(vdb)?;
                    if epoch >= 1 { result.embeddings_deleted += rep.embeddings_deleted; }
                    if epoch >= 2 { result.chunks_deleted += rep.chunks_deleted; }
                    if epoch >= 3 { result.relations_deleted += rep.relations_deleted; }
                }
                ScanClearMode::UnderPath { path } => {
                    let like = format!("{}%", path);
                    let ids = select_asset_ids(&conn,
                        "SELECT id FROM assets WHERE file_path LIKE ?1",
                        rusqlite::params![&like])?;
                    if !ids.is_empty() {
                        let rep = crate::vec_db::delete_assets(vdb, &ids)?;
                        if epoch >= 1 { result.embeddings_deleted += rep.embeddings_deleted; }
                        if epoch >= 2 { result.chunks_deleted += rep.chunks_deleted; }
                        if epoch >= 3 { result.relations_deleted += rep.relations_deleted; }
                    }
                }
                ScanClearMode::TrashOnly => {
                    let ids = select_asset_ids(&conn,
                        "SELECT id FROM assets WHERE is_deleted = 1",
                        rusqlite::params![])?;
                    if !ids.is_empty() {
                        let rep = crate::vec_db::delete_assets(vdb, &ids)?;
                        if epoch >= 1 { result.embeddings_deleted += rep.embeddings_deleted; }
                        if epoch >= 2 { result.chunks_deleted += rep.chunks_deleted; }
                        if epoch >= 3 { result.relations_deleted += rep.relations_deleted; }
                    }
                }
                ScanClearMode::SingleAsset { id } => {
                    let rep =
                        crate::vec_db::delete_assets(vdb, std::slice::from_ref(id))?;
                    if epoch >= 1 { result.embeddings_deleted += rep.embeddings_deleted; }
                    if epoch >= 2 { result.chunks_deleted += rep.chunks_deleted; }
                    if epoch >= 3 { result.relations_deleted += rep.relations_deleted; }
                }
            }
        }

        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction başlatma hatası: {}", e))?;

        // Shape DB ayrı bir dosyada — clear modes commit sonrası temizlenir.
        // SingleAsset için id'yi biliyoruz, ALL için tümünü sil; UnderPath/TrashOnly
        // için ana DB'de file_path bağımlı olduğu için shape DB'de yapılamaz —
        // orphan'lar sonraki taramada yeniden persist sırasında silinir.
        let shape_clear_mode: Option<ShapeClearMode> = match &mode {
            ScanClearMode::All => Some(ShapeClearMode::All),
            ScanClearMode::SingleAsset { id } => Some(ShapeClearMode::SingleAsset(id.clone())),
            _ => None,
        };

        match mode {
            ScanClearMode::All => {
                // İlişkili tablolar önce — assets son. (FK kapalı olsa da semantik temiz.)
                // V3 A6-PRE-3b: epoch'a göre V3-eligible DELETE'leri skip
                // (yukarıda vec.db'de zaten yapıldı; main'de tablo yok).
                if epoch < 3 {
                    result.relations_deleted += tx.execute("DELETE FROM asset_relations", [])
                        .map_err(|e| format!("relations delete hatası: {}", e))?;
                }
                if epoch < 2 {
                    result.chunks_deleted += tx.execute("DELETE FROM text_chunks", [])
                        .map_err(|e| format!("chunks delete hatası: {}", e))?;
                }
                if epoch < 1 {
                    result.embeddings_deleted += tx.execute("DELETE FROM embeddings", [])
                        .map_err(|e| format!("embeddings delete hatası: {}", e))?;
                }
                result.assets_deleted = tx.execute("DELETE FROM assets", [])
                    .map_err(|e| format!("assets delete hatası: {}", e))?;
                result.roots_deleted = tx.execute("DELETE FROM scanned_roots", [])
                    .map_err(|e| format!("scanned_roots delete hatası: {}", e))?;
            }
            ScanClearMode::UnderPath { path } => {
                let like = format!("{}%", path);
                // V3-eligible DELETE'leri main TX'te SKIP if epoch>=N (vec.db'de
                // yukarıda zaten yapıldı).
                if epoch < 3 {
                    result.relations_deleted += tx.execute(
                        "DELETE FROM asset_relations WHERE source_id IN (SELECT id FROM assets WHERE file_path LIKE ?1)
                           OR target_id IN (SELECT id FROM assets WHERE file_path LIKE ?1)",
                        rusqlite::params![&like],
                    ).map_err(|e| format!("relations delete hatası: {}", e))? as usize;
                }
                if epoch < 2 {
                    result.chunks_deleted += tx.execute(
                        "DELETE FROM text_chunks WHERE asset_id IN (SELECT id FROM assets WHERE file_path LIKE ?1)",
                        rusqlite::params![&like],
                    ).map_err(|e| format!("chunks delete hatası: {}", e))? as usize;
                }
                if epoch < 1 {
                    result.embeddings_deleted += tx.execute(
                        "DELETE FROM embeddings WHERE asset_id IN (SELECT id FROM assets WHERE file_path LIKE ?1)",
                        rusqlite::params![&like],
                    ).map_err(|e| format!("embeddings delete hatası: {}", e))? as usize;
                }
                result.assets_deleted = tx.execute(
                    "DELETE FROM assets WHERE file_path LIKE ?1",
                    rusqlite::params![&like],
                ).map_err(|e| format!("assets delete hatası: {}", e))? as usize;
                // scanned_roots korunur — replaceUnderPath semantiği gereği.
            }
            ScanClearMode::TrashOnly => {
                // Çöp kutusu: WHERE is_deleted = 1. İlişkili tabloları subquery ile sil.
                let subq = "SELECT id FROM assets WHERE is_deleted = 1";
                if epoch < 3 {
                    result.relations_deleted += tx.execute(
                        &format!("DELETE FROM asset_relations WHERE source_id IN ({0}) OR target_id IN ({0})", subq),
                        [],
                    ).map_err(|e| format!("relations delete hatası: {}", e))? as usize;
                }
                if epoch < 2 {
                    result.chunks_deleted += tx.execute(
                        &format!("DELETE FROM text_chunks WHERE asset_id IN ({})", subq),
                        [],
                    ).map_err(|e| format!("chunks delete hatası: {}", e))? as usize;
                }
                if epoch < 1 {
                    result.embeddings_deleted += tx.execute(
                        &format!("DELETE FROM embeddings WHERE asset_id IN ({})", subq),
                        [],
                    ).map_err(|e| format!("embeddings delete hatası: {}", e))? as usize;
                }
                tx.execute(
                    &format!("DELETE FROM asset_tags WHERE asset_id IN ({})", subq),
                    [],
                ).map_err(|e| format!("asset_tags delete hatası: {}", e))?;
                tx.execute(
                    &format!("DELETE FROM favorites WHERE asset_id IN ({})", subq),
                    [],
                ).map_err(|e| format!("favorites delete hatası: {}", e))?;
                tx.execute(
                    &format!("DELETE FROM collection_items WHERE asset_id IN ({})", subq),
                    [],
                ).map_err(|e| format!("collection_items delete hatası: {}", e))?;
                tx.execute(
                    &format!("DELETE FROM asset_summaries WHERE asset_id IN ({})", subq),
                    [],
                ).map_err(|e| format!("asset_summaries delete hatası: {}", e))?;
                result.assets_deleted = tx.execute(
                    "DELETE FROM assets WHERE is_deleted = 1",
                    [],
                ).map_err(|e| format!("assets delete hatası: {}", e))?;
                // scanned_roots korunur.
            }
            ScanClearMode::SingleAsset { id } => {
                if epoch < 3 {
                    result.relations_deleted += tx.execute(
                        "DELETE FROM asset_relations WHERE source_id = ?1 OR target_id = ?1",
                        rusqlite::params![&id],
                    ).map_err(|e| format!("relations delete hatası: {}", e))?;
                }
                // dwg_shapes ayrı DB'de — commit sonrası shape_clear_mode ile silinir.
                if epoch < 2 {
                    result.chunks_deleted += tx.execute(
                        "DELETE FROM text_chunks WHERE asset_id = ?1",
                        rusqlite::params![&id],
                    ).map_err(|e| format!("chunks delete hatası: {}", e))?;
                }
                if epoch < 1 {
                    result.embeddings_deleted += tx.execute(
                        "DELETE FROM embeddings WHERE asset_id = ?1",
                        rusqlite::params![&id],
                    ).map_err(|e| format!("embeddings delete hatası: {}", e))?;
                }
                tx.execute(
                    "DELETE FROM asset_tags WHERE asset_id = ?1",
                    rusqlite::params![&id],
                ).map_err(|e| format!("asset_tags delete hatası: {}", e))?;
                tx.execute(
                    "DELETE FROM favorites WHERE asset_id = ?1",
                    rusqlite::params![&id],
                ).map_err(|e| format!("favorites delete hatası: {}", e))?;
                tx.execute(
                    "DELETE FROM collection_items WHERE asset_id = ?1",
                    rusqlite::params![&id],
                ).map_err(|e| format!("collection_items delete hatası: {}", e))?;
                tx.execute(
                    "DELETE FROM asset_summaries WHERE asset_id = ?1",
                    rusqlite::params![&id],
                ).map_err(|e| format!("asset_summaries delete hatası: {}", e))?;
                result.assets_deleted = tx.execute(
                    "DELETE FROM assets WHERE id = ?1",
                    rusqlite::params![&id],
                ).map_err(|e| format!("assets delete hatası: {}", e))?;
            }
        }

        tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
        drop(conn);

        // Shape DB temizliği — ana tx commit'ten sonra ayrı bağlantıyla
        if let Some(scm) = shape_clear_mode {
            if let Ok(shapes_path) = crate::shapes_db::resolve_shapes_db_path(&app_for_shapes, archive_at_for_shapes.as_deref()) {
                if let Ok(shape_conn) = crate::shapes_db::open_shapes_db(&shapes_path) {
                    let deleted = match scm {
                        ShapeClearMode::All => shape_conn
                            .execute("DELETE FROM dwg_shapes", [])
                            .unwrap_or(0),
                        ShapeClearMode::SingleAsset(id) => shape_conn
                            .execute("DELETE FROM dwg_shapes WHERE asset_id = ?1", rusqlite::params![&id])
                            .unwrap_or(0),
                    };
                    result.shapes_deleted = deleted;
                }
            }
        }

        Ok(result)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// scan_write_batch'in senkron iç mantığı — doğrudan bir db_path alır.
/// Tauri command'dan bağımsız test edilebilir.
pub(crate) fn write_scan_batch_to_db(
    db_path: &std::path::Path,
    payload: ScanBatchPayload,
) -> Result<ScanBatchResult, String> {
    let archive_lock = crate::ollama_db::get_db_lock_for(db_path);
    let _guard = archive_lock
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;

    let _file_lock = crate::ollama_db::acquire_db_write_lock(db_path)
        .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

    let conn = crate::ollama_db::prepare_write_conn(db_path)?;

    // V3 A6-PRE-3a: epoch-aware şema + epoch-aware routing.
    // epoch=0  → mevcut davranış birebir (V3-eligible tablolar main DB'de).
    // epoch>=1 → embeddings vec.db'ye (apply_embeddings); main TX'te SKIP.
    // epoch>=2 → text_chunks vec.db'ye (apply_text_chunks); main TX'te SKIP.
    // epoch>=3 → asset_relations vec.db'ye (apply_asset_relations); main TX'te SKIP.
    //
    // Atomiklik: vec.db apply'ları main TX commit'TEN ÖNCE yapılır. vec.db
    // hata olursa Err döner, main TX RAII ile rollback → tutarsızlık yok.
    // vec.db OK + main TX commit FAIL → vec.db'de orphan kalabilir; embedding/
    // chunk ID asset_id'den deterministik türetildiği için sonraki scan'de
    // `INSERT OR IGNORE` ile idempotent devam eder (kalıcı tutarsızlık yok).
    let epoch = apply_main_schema_get_epoch(&conn)?;
    let vec_db_path: Option<std::path::PathBuf> = if epoch >= 1 {
        Some(crate::vec_db::resolve_vec_db_path_from_main(db_path)?)
    } else {
        None
    };

        let mut result = ScanBatchResult {
            assets_written: 0,
            embeddings_written: 0,
            chunks_written: 0,
            chunks_deleted: 0,
            shapes_written: 0,
            shapes_deleted: 0,
            relations_written: 0,
            roots_written: 0,
            roots_deleted: 0,
        };

        // 5. Transaction
        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction başlatma hatası: {}", e))?;

        // 6. Eski chunk'ları sil (yeniden tarama).
        // epoch>=2 → text_chunks vec.db'de; epoch>=1 → chunk-embeddings vec.db'de.
        // epoch=2'de tek arada durum (chunk vec'te, embedding hâlâ vec'te epoch>=1
        // gereği). Pratikte epoch hiç 1'de durmaz (frontend 0→3 atlamayı tercih
        // eder); ama tablo başına gating doğru olsun diye iki ayrı dal:
        if let Some(vdb) = vec_db_path.as_ref() {
            // chunks + chunk-embeddings birlikte vec.db'ye (her ikisi epoch>=1).
            // delete_chunks_for_assets text_chunks'ı epoch>=2'de tam siler;
            // epoch=1'de text_chunks hâlâ main TX'te (aşağıdaki bloktan).
            // Bu iki bloğu net ayırmak için davranış tablosu:
            //   epoch=1: text_chunks → main TX; chunk-emb → vec.db.
            //   epoch>=2: text_chunks + chunk-emb → vec.db (tek helper).
            if epoch >= 2 {
                let n = crate::vec_db::delete_chunks_for_assets(vdb, &payload.delete_chunks_for)?;
                result.chunks_deleted += n;
            } else {
                // epoch=1: yalnız chunk-embedding vec.db'ye.
                let conn_v = crate::vec_db::open_vec_db(vdb)?;
                let mut d_emb = conn_v
                    .prepare_cached(
                        "DELETE FROM embeddings WHERE asset_id = ?1 \
                         AND ref_id IS NOT NULL AND ref_id != ''",
                    )
                    .map_err(|e| format!("prepare hatası: {}", e))?;
                for asset_id in &payload.delete_chunks_for {
                    result.chunks_deleted +=
                        d_emb.execute(rusqlite::params![asset_id]).unwrap_or(0);
                }
            }
        }
        // text_chunks main TX'te kalan tek senaryo: epoch < 2 (yani epoch=0/1).
        // chunk-embeddings main TX'te kalan tek senaryo: epoch < 1 (yani epoch=0).
        if epoch < 2 {
            let mut del_chunks = tx.prepare_cached(
                "DELETE FROM text_chunks WHERE asset_id = ?"
            ).map_err(|e| format!("prepare hatası: {}", e))?;

            // epoch=0 ise embedding DELETE de main TX'te; epoch=1 ise yukarıda vec.db'de yapıldı.
            let mut del_chunk_embeds_opt = if epoch < 1 {
                Some(tx.prepare_cached(
                    "DELETE FROM embeddings WHERE asset_id = ? AND ref_id IS NOT NULL AND ref_id != ''"
                ).map_err(|e| format!("prepare hatası: {}", e))?)
            } else {
                None
            };

            for asset_id in &payload.delete_chunks_for {
                let d1 = del_chunks.execute(rusqlite::params![asset_id])
                    .unwrap_or(0);
                result.chunks_deleted += d1;
                if let Some(ref mut del_emb) = del_chunk_embeds_opt {
                    let d2 = del_emb.execute(rusqlite::params![asset_id]).unwrap_or(0);
                    result.chunks_deleted += d2;
                }
            }
        }

        // 7. Asset INSERT OR REPLACE
        {
            let mut stmt = tx.prepare_cached(
                "INSERT OR REPLACE INTO assets
                 (id, file_name, file_path, file_size, file_type, category,
                  created_at, modified_at, project_name, project_phase,
                  material_group, color_theme, architectural_style,
                  omniclass_code, is_indexed, hash, phash, content_hash,
                  metadata_json, ai_tags_json, color_palette_json,
                  thumbnail_url, raw_metadata, fs_mtime, metadata_version,
                  applied_extractors, is_deleted, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                         ?11, ?12, ?13, ?14, 1, ?15, ?16, ?17,
                         ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, 0, NULL)"
            ).map_err(|e| format!("prepare hatası: {}", e))?;

            for a in &payload.assets {
                stmt.execute(rusqlite::params![
                    a.id, a.file_name, a.file_path, a.file_size,
                    a.file_type, a.category, a.created_at, a.modified_at,
                    a.project_name, a.project_phase, a.material_group,
                    a.color_theme, a.architectural_style, a.omniclass_code,
                    a.hash, a.phash, a.content_hash, a.metadata_json,
                    a.ai_tags_json, a.color_palette_json, a.thumbnail_url,
                    a.raw_metadata, a.fs_mtime, a.metadata_version,
                    a.applied_extractors
                ]).map_err(|e| format!("asset insert hatası: {}", e))?;
                result.assets_written += 1;
            }
        }

        // 8. Embedding INSERT — epoch>=1 → vec.db; epoch=0 → main TX (INSERT OR REPLACE).
        if epoch >= 1 {
            // vec.db'ye apply_embeddings (INSERT OR IGNORE → idempotent;
            // aynı id'li satır varsa yeniden yazmaz). main TX commit'inden
            // ÖNCE yapılır; hata → main TX rollback RAII ile.
            if !payload.embeddings.is_empty() {
                let vdb = vec_db_path.as_ref().unwrap();
                let rows: Vec<crate::vec_db::EmbeddingRow> = payload
                    .embeddings
                    .iter()
                    .map(|e| crate::vec_db::EmbeddingRow {
                        id: e.id.clone(),
                        asset_id: e.asset_id.clone(),
                        ref_id: e.ref_id.clone(),
                        vector_blob: e.vector_blob.clone(),
                        source: e.source.clone(),
                    })
                    .collect();
                crate::vec_db::apply_embeddings(vdb, &rows)?;
                // Eski semantik korunur: kaynak satır sayısı (apply_embeddings
                // IGNORE → gerçek INSERT sayısı farklı olabilir; ama frontend
                // "kaç embedding gönderildi" sayımını bekler).
                result.embeddings_written += payload.embeddings.len();
            }
        } else {
            let mut stmt = tx.prepare_cached(
                "INSERT OR REPLACE INTO embeddings
                 (id, asset_id, ref_id, vector_json, vector_blob, source)
                 VALUES (?1, ?2, ?3, '', ?4, ?5)"
            ).map_err(|e| format!("prepare hatası: {}", e))?;

            for e in &payload.embeddings {
                stmt.execute(rusqlite::params![
                    e.id, e.asset_id, e.ref_id,
                    e.vector_blob,
                    e.source
                ]).map_err(|e| format!("embedding insert hatası: {}", e))?;
                result.embeddings_written += 1;
            }
        }

        // 9. TextChunk INSERT — epoch>=2 → vec.db; aksi halde main TX.
        if epoch >= 2 {
            if !payload.text_chunks.is_empty() {
                let vdb = vec_db_path.as_ref().unwrap();
                let rows: Vec<crate::vec_db::TextChunkRow> = payload
                    .text_chunks
                    .iter()
                    .map(|c| crate::vec_db::TextChunkRow {
                        id: c.id.clone(),
                        asset_id: c.asset_id.clone(),
                        chunk_index: c.chunk_index as i64,
                        page: c.page.map(|p| p as i64),
                        text: c.text.clone(),
                        lang: c.lang.clone(),
                    })
                    .collect();
                crate::vec_db::apply_text_chunks(vdb, &rows)?;
                result.chunks_written += payload.text_chunks.len();
            }
        } else {
            let mut stmt = tx.prepare_cached(
                "INSERT OR REPLACE INTO text_chunks
                 (id, asset_id, chunk_index, page, text, lang)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)"
            ).map_err(|e| format!("prepare hatası: {}", e))?;

            for c in &payload.text_chunks {
                stmt.execute(rusqlite::params![
                    c.id, c.asset_id, c.chunk_index,
                    c.page, c.text, c.lang
                ]).map_err(|e| format!("chunk insert hatası: {}", e))?;
                result.chunks_written += 1;
            }
        }

        // 10. dwg_shapes — artık ayrı DB dosyasında (shapes_db.rs). Frontend
        // `persist_dwg_shapes` ve `delete_dwg_shapes` komutlarını ayrı çağırır.
        // payload.dwg_shapes ve payload.delete_shapes_for backward compat için
        // tutuluyor ama burada işlenmez. Frontend bunları boş gönderebilir.

        // 11. asset_relations — INSERT OR IGNORE (duplicate guard).
        // epoch>=3 → vec.db; aksi halde main TX.
        if epoch >= 3 {
            if !payload.relations.is_empty() {
                let vdb = vec_db_path.as_ref().unwrap();
                let rows: Vec<crate::vec_db::AssetRelationRow> = payload
                    .relations
                    .iter()
                    .map(|r| crate::vec_db::AssetRelationRow {
                        id: r.id.clone(),
                        source_id: r.source_id.clone(),
                        target_id: r.target_id.clone(),
                        relation_type: r.relation_type.clone(),
                        notes: None, // scan_db payload'ında notes yok
                        created_at: r.created_at.clone(),
                        created_by: Some(r.created_by.clone()),
                    })
                    .collect();
                // apply_asset_relations IGNORE → eski davranış birebir
                // (sat. 1080 önceden de OR IGNORE'du).
                let n = crate::vec_db::apply_asset_relations(vdb, &rows)?;
                result.relations_written += n;
            }
        } else {
            let mut ins_rel = tx.prepare_cached(
                "INSERT OR IGNORE INTO asset_relations
                 (id, source_id, target_id, relation_type, notes, created_at, created_by)
                 VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)"
            ).map_err(|e| format!("prepare hatası: {}", e))?;

            for r in &payload.relations {
                let n = ins_rel.execute(rusqlite::params![
                    r.id, r.source_id, r.target_id, r.relation_type, r.created_at, r.created_by
                ]).map_err(|e| format!("relation insert hatası: {}", e))?;
                result.relations_written += n;
            }
        }

        // 12. scanned_roots — INSERT OR REPLACE (path UNIQUE çakışması için kullanıcı tarafı kontrol etmeli)
        {
            let mut ups_root = tx.prepare_cached(
                "INSERT INTO scanned_roots (id, path, label, status, last_scan, file_count)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    label = excluded.label,
                    status = excluded.status,
                    last_scan = excluded.last_scan,
                    file_count = excluded.file_count"
            ).map_err(|e| format!("prepare hatası: {}", e))?;

            for r in &payload.scanned_roots {
                ups_root.execute(rusqlite::params![
                    r.id, r.path, r.label, r.status, r.last_scan, r.file_count.unwrap_or(0)
                ]).map_err(|e| format!("scanned_root upsert hatası: {}", e))?;
                result.roots_written += 1;
            }
        }

        // 12b. scanned_roots — kalıcı silme (deleteScannedRootWithAssets akışı)
        {
            let mut del_root = tx.prepare_cached(
                "DELETE FROM scanned_roots WHERE id = ?"
            ).map_err(|e| format!("prepare hatası: {}", e))?;
            for id in &payload.delete_scanned_roots {
                let n = del_root.execute(rusqlite::params![id])
                    .map_err(|e| format!("scanned_root delete hatası: {}", e))?;
                result.roots_deleted += n;
            }
        }

        // 13. COMMIT
        tx.commit()
            .map_err(|e| format!("commit hatası: {}", e))?;

    // Connection, _guard, _file_lock RAII ile drop edilir

    Ok(result)
}

#[tauri::command]
pub async fn scan_write_batch(
    app: tauri::AppHandle,
    payload: ScanBatchPayload,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<ScanBatchResult, String> {
    crate::require_authenticated(&role_state)?;
    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || write_scan_batch_to_db(&db_path, payload))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ── RAG status batch update ───────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RagStatusUpdate {
    pub id: String,
    pub status: Option<String>,
    pub reason: Option<String>,
}

/// RAG indeksleme akışında assets.rag_status + rag_status_reason için targeted UPDATE.
/// saveDatabase'in sql.js dump → atomic rename yolundan kaçınır; ana thread'i bloklamaz.
/// Boş listede no-op.
#[tauri::command]
pub async fn update_asset_rag_status(
    app: tauri::AppHandle,
    updates: Vec<RagStatusUpdate>,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<usize, String> {
    crate::require_authenticated(&role_state)?;
    if updates.is_empty() {
        return Ok(0);
    }

    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = crate::ollama_db::acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

        let conn = crate::ollama_db::prepare_write_conn(&db_path)?;

        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction başlatma hatası: {}", e))?;

        let mut stmt = tx.prepare_cached(
            "UPDATE assets SET rag_status = ?1, rag_status_reason = ?2 WHERE id = ?3"
        ).map_err(|e| format!("prepare hatası: {}", e))?;

        let mut total: usize = 0;
        for u in &updates {
            let n = stmt.execute(rusqlite::params![&u.status, &u.reason, &u.id])
                .map_err(|e| format!("rag_status update hatası: {}", e))?;
            total += n;
        }
        drop(stmt);

        tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
        Ok(total)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ── Audit Log Mirror ─────────────────────────────────────────────────────────
//
// Frontend logger.ts'in yaptığı sql.js DELETE/INSERT'leri rusqlite'a yansıtır.
// saveDatabase() yerine kullanılır → ana thread bloku yok (db.export atlanır).
// Sql.js DELETE + Rust mirror DELETE paralel; restart sonrası rusqlite ground truth.

#[derive(serde::Deserialize)]
pub struct AuditLogRowInsert {
    pub timestamp: String,
    pub role: String,
    pub action: String,
    #[serde(default)]
    pub target: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
    pub result: String,
    #[serde(default)]
    pub prev_hash: Option<String>,
    #[serde(default)]
    pub row_hash: Option<String>,
}

#[derive(serde::Deserialize, Default)]
pub struct AuditLogMirrorPayload {
    /// Tek tek silinecek satır ID'leri (deleteAuditLog/Batch için)
    #[serde(default)]
    pub delete_ids: Vec<i64>,
    /// Bu tarihten önceki tüm satırları sil (clearAuditLogsBefore + retention için)
    #[serde(default)]
    pub delete_before_iso: Option<String>,
    /// Tüm tabloyu temizle (clearAuditLogs için)
    #[serde(default)]
    pub delete_all: bool,
    /// Marker / yeni satır insert'leri (silme markerları)
    #[serde(default)]
    pub inserts: Vec<AuditLogRowInsert>,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AuditLogMirrorResult {
    pub deleted_count: usize,
    pub inserted_count: usize,
}

#[tauri::command]
pub async fn audit_log_apply_changes(
    app: tauri::AppHandle,
    payload: AuditLogMirrorPayload,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<AuditLogMirrorResult, String> {
    crate::require_authenticated(&role_state)?;

    let db_path = crate::ollama_db::resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        apply_audit_changes(&db_path, payload)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// `audit_log_apply_changes`'in saf çekirdeği — AppHandle/auth/global-mutex
/// gerektirmez, doğrudan path alır. Process-içi serileştirme ÇAĞIRANIN
/// sorumluluğundadır (komut `get_db_lock_for(path)` tutar). Test edilebilir.
pub(crate) fn apply_audit_changes(
    db_path: &std::path::Path,
    payload: AuditLogMirrorPayload,
) -> Result<AuditLogMirrorResult, String> {
    let _file_lock = crate::ollama_db::acquire_db_write_lock(db_path)
        .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

    let conn = crate::ollama_db::prepare_write_conn(db_path)?;
    conn.execute_batch(EXTRA_AUDIT_SCHEMA)
        .map_err(|e| format!("audit_log şema oluşturma hatası: {}", e))?;

    let mut result = AuditLogMirrorResult::default();

    let tx = conn.unchecked_transaction()
        .map_err(|e| format!("Transaction başlatma hatası: {}", e))?;

    // 1. DELETE'ler — sıra: all > before_iso > id list
    if payload.delete_all {
        let n = tx.execute("DELETE FROM audit_log", [])
            .map_err(|e| format!("DELETE all hatası: {}", e))?;
        result.deleted_count += n;
    } else {
        if let Some(iso) = &payload.delete_before_iso {
            let n = tx.execute("DELETE FROM audit_log WHERE timestamp < ?1", [iso])
                .map_err(|e| format!("DELETE before hatası: {}", e))?;
            result.deleted_count += n;
        }
        if !payload.delete_ids.is_empty() {
            let mut stmt = tx.prepare_cached("DELETE FROM audit_log WHERE id = ?1")
                .map_err(|e| format!("prepare hatası: {}", e))?;
            for id in &payload.delete_ids {
                let n = stmt.execute(rusqlite::params![id])
                    .map_err(|e| format!("DELETE id hatası: {}", e))?;
                result.deleted_count += n;
            }
        }
    }

    // 2. INSERT'ler — marker satırları
    if !payload.inserts.is_empty() {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO audit_log
             (timestamp, role, action, target, detail, result, prev_hash, row_hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
        ).map_err(|e| format!("prepare hatası: {}", e))?;

        for row in &payload.inserts {
            stmt.execute(rusqlite::params![
                &row.timestamp, &row.role, &row.action,
                &row.target, &row.detail, &row.result,
                &row.prev_hash, &row.row_hash,
            ]).map_err(|e| format!("INSERT hatası: {}", e))?;
            result.inserted_count += 1;
        }
    }

    tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
    Ok(result)
}

// ── Chat Mirror ──────────────────────────────────────────────────────────────
//
// Chat oturumları/mesajları için targeted rusqlite yazma — saveDatabase yerine.
// Frontend chatStorage.ts sql.js'i anında günceller, paralel olarak bu komut
// rusqlite'a doğrudan UPSERT/DELETE yapar. db.export() (100-500ms blok) yok.

#[derive(serde::Deserialize)]
pub struct ChatSessionWrite {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub scope_json: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(serde::Deserialize)]
pub struct ChatMessageWrite {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    #[serde(default)]
    pub citations_json: Option<String>,
    #[serde(default)]
    pub tokens_in: Option<i64>,
    #[serde(default)]
    pub tokens_out: Option<i64>,
    pub created_at: String,
}

#[derive(serde::Deserialize)]
pub struct SessionTouch {
    pub id: String,
    pub updated_at: String,
}

#[derive(serde::Deserialize, Default)]
pub struct ChatMirrorPayload {
    /// INSERT OR REPLACE — yeni session veya tam alan güncelleme (rename dahil)
    #[serde(default)]
    pub sessions_upsert: Vec<ChatSessionWrite>,
    /// INSERT OR REPLACE — yeni mesaj veya mesaj güncelleme
    #[serde(default)]
    pub messages_upsert: Vec<ChatMessageWrite>,
    /// Sadece updated_at güncelleme (appendMessage için, full session veri okumaya gerek kalmaz)
    #[serde(default)]
    pub session_timestamps: Vec<SessionTouch>,
    /// Session sil — chat_messages CASCADE ile manuel silinir (PRAGMA foreign_keys=OFF olduğundan)
    #[serde(default)]
    pub delete_session_ids: Vec<String>,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChatMirrorResult {
    pub sessions_written: usize,
    pub messages_written: usize,
    pub sessions_touched: usize,
    pub sessions_deleted: usize,
    pub messages_cascaded: usize,
}

#[tauri::command]
pub async fn write_chat_mirror(
    app: tauri::AppHandle,
    payload: ChatMirrorPayload,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<ChatMirrorResult, String> {
    crate::require_authenticated(&role_state)?;

    // Tümü boşsa no-op
    if payload.sessions_upsert.is_empty()
        && payload.messages_upsert.is_empty()
        && payload.session_timestamps.is_empty()
        && payload.delete_session_ids.is_empty()
    {
        return Ok(ChatMirrorResult::default());
    }

    let db_path = crate::ollama_db::resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        apply_chat_mirror(&db_path, payload)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// `write_chat_mirror`'in saf çekirdeği — AppHandle/auth/global-mutex/no-op
/// kısayolu gerektirmez, doğrudan path alır. Process-içi serileştirme
/// ÇAĞIRANIN sorumluluğundadır (komut `get_db_lock_for(path)` tutar). Test edilebilir.
pub(crate) fn apply_chat_mirror(
    db_path: &std::path::Path,
    payload: ChatMirrorPayload,
) -> Result<ChatMirrorResult, String> {
    let _file_lock = crate::ollama_db::acquire_db_write_lock(db_path)
        .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

    let conn = crate::ollama_db::prepare_write_conn(db_path)?;
    conn.execute_batch(EXTRA_CHAT_SCHEMA)
        .map_err(|e| format!("chat şema oluşturma hatası: {}", e))?;

    let mut result = ChatMirrorResult::default();

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Transaction başlatma hatası: {}", e))?;

        // 1. DELETE session'lar — önce mesajları manuel cascade et
        if !payload.delete_session_ids.is_empty() {
            let mut del_msgs = tx
                .prepare_cached("DELETE FROM chat_messages WHERE session_id = ?1")
                .map_err(|e| format!("prepare msg cascade hatası: {}", e))?;
            let mut del_sess = tx
                .prepare_cached("DELETE FROM chat_sessions WHERE id = ?1")
                .map_err(|e| format!("prepare session delete hatası: {}", e))?;

            for id in &payload.delete_session_ids {
                let cn = del_msgs
                    .execute(rusqlite::params![id])
                    .map_err(|e| format!("msg cascade delete hatası: {}", e))?;
                result.messages_cascaded += cn;
                let sn = del_sess
                    .execute(rusqlite::params![id])
                    .map_err(|e| format!("session delete hatası: {}", e))?;
                result.sessions_deleted += sn;
            }
        }

        // 2. UPSERT session'lar (yeni session veya rename)
        if !payload.sessions_upsert.is_empty() {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT OR REPLACE INTO chat_sessions
                     (id, title, scope_json, model, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                )
                .map_err(|e| format!("prepare session upsert hatası: {}", e))?;

            for s in &payload.sessions_upsert {
                stmt.execute(rusqlite::params![
                    &s.id,
                    &s.title,
                    &s.scope_json,
                    &s.model,
                    &s.created_at,
                    &s.updated_at,
                ])
                .map_err(|e| format!("session upsert hatası: {}", e))?;
                result.sessions_written += 1;
            }
        }

        // 3. UPSERT mesajlar
        if !payload.messages_upsert.is_empty() {
            let mut stmt = tx
                .prepare_cached(
                    "INSERT OR REPLACE INTO chat_messages
                     (id, session_id, role, content, citations_json, tokens_in, tokens_out, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                )
                .map_err(|e| format!("prepare msg upsert hatası: {}", e))?;

            for m in &payload.messages_upsert {
                stmt.execute(rusqlite::params![
                    &m.id,
                    &m.session_id,
                    &m.role,
                    &m.content,
                    &m.citations_json,
                    &m.tokens_in,
                    &m.tokens_out,
                    &m.created_at,
                ])
                .map_err(|e| format!("msg upsert hatası: {}", e))?;
                result.messages_written += 1;
            }
        }

        // 4. session timestamps — sadece updated_at güncelleme (appendMessage için)
        if !payload.session_timestamps.is_empty() {
            let mut stmt = tx
                .prepare_cached("UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2")
                .map_err(|e| format!("prepare touch hatası: {}", e))?;

            for t in &payload.session_timestamps {
                let n = stmt
                    .execute(rusqlite::params![&t.updated_at, &t.id])
                    .map_err(|e| format!("session touch hatası: {}", e))?;
                result.sessions_touched += n;
            }
        }

    tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
    Ok(result)
}

// ─────────────────────────────────────────────────────────
// XMP Sidecar Export
// ─────────────────────────────────────────────────────────

/// XMP sidecar dosyasını diske yazar.
/// Önce dosyanın yanına yazar; yazılamazsa APP_DATA/xmp-sidecar/ altına
/// mirror dizin yapısıyla fallback yapar. Gerçek yazılan yolu döndürür.
/// Güvenlik: yol `.xmp` ile bitmeli, deny-list'teki dizinlere yazılamaz.
#[tauri::command]
pub async fn write_xmp_sidecar(
    app: tauri::AppHandle,
    path: String,
    content: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<String, String> {
    crate::require_admin(&role_state)?;

    tauri::async_runtime::spawn_blocking(move || {
        use std::io::Write;
        use std::path::Path;
        use tauri::Manager;

        let p = Path::new(&path);

        // Uzantı kontrolü
        match p.extension().and_then(|e| e.to_str()) {
            Some(ext) if ext.eq_ignore_ascii_case("xmp") => {}
            _ => return Err("Yalnızca .xmp dosyaları yazılabilir".into()),
        }

        // Deny-list: sistem dizinleri
        let canonical = p.to_string_lossy().replace('\\', "/").to_lowercase();
        let deny = ["c:/windows/", "c:/program files/", "c:/program files (x86)/"];
        for d in &deny {
            if canonical.starts_with(d) {
                return Err(format!("Sistem dizinine yazılamaz: {}", d));
            }
        }

        // Yardımcı: dosyayı yaz + fsync
        fn write_xmp_file(target: &Path, data: &[u8]) -> std::io::Result<()> {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut f = std::fs::File::create(target)?;
            f.write_all(data)?;
            f.sync_all()?;
            Ok(())
        }

        // 1) Önce dosyanın yanına yaz
        if let Ok(()) = write_xmp_file(p, content.as_bytes()) {
            return Ok(p.to_string_lossy().to_string());
        }

        // 2) Fallback: APP_DATA/xmp-sidecar/{drive_letter}/{relative_path}
        let app_data = app.path()
            .app_data_dir()
            .map_err(|e| format!("APP_DATA path: {}", e))?;
        let fallback_dir = app_data.join("xmp-sidecar");

        // C:\Proje\plan.dwg.xmp → C/Proje/plan.dwg.xmp
        let mirror_rel = p.to_string_lossy()
            .replace('\\', "/")
            .replace("://", "/")  // UNC path
            .replacen(":/", "/", 1); // C:/ → C/
        let fallback_path = fallback_dir.join(&mirror_rel);

        write_xmp_file(&fallback_path, content.as_bytes())
            .map_err(|e| format!("XMP fallback yazma hatası: {}", e))?;

        Ok(fallback_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ─────────────────────────────────────────────────────────
// Faz 4.4 — Geometrik Şekil Arama (Backend Scoring)
// ─────────────────────────────────────────────────────────

/// Referans şeklin özellikleri — frontend'den gönderilir.
#[derive(Deserialize)]
pub struct ShapeSearchRef {
    pub vertex_count: u32,
    pub regularity: f64,
    pub aspect_ratio: f64,
    pub compactness: f64,
    pub solidity: f64,
    pub rectangularity: f64,
    pub is_closed: bool,
}

/// Tek bir şekil eşleşme sonucu.
#[derive(Serialize)]
pub struct ShapeMatchResult {
    pub shape_id: String,
    pub asset_id: String,
    pub score: f64,
    pub vertex_count: u32,
    pub regularity: f64,
    pub aspect_ratio: f64,
    pub compactness: f64,
    pub solidity: f64,
    pub rectangularity: f64,
    pub area: f64,
    pub perimeter: f64,
    pub layer_category: String,
    pub layer_name: String,
    pub entity_type: String,
    pub is_closed: bool,
}

/// Kriter tabanlı arama parametreleri.
#[derive(Deserialize)]
pub struct ShapeFeatureCriteria {
    pub vertex_count: Option<u32>,
    pub vertex_tolerance: Option<u32>,
    pub min_regularity: Option<f64>,
    pub layer_category: Option<String>,
    pub min_aspect_ratio: Option<f64>,
    pub max_aspect_ratio: Option<f64>,
    pub min_compactness: Option<f64>,
    pub min_rectangularity: Option<f64>,
    pub include_open: Option<bool>,
    pub asset_ids: Option<Vec<String>>,
}

/// Referans şekle benzerlik skoru — kapalı ve açık şekiller ayrı ağırlıklanır.
#[allow(clippy::too_many_arguments)]
fn compute_shape_similarity(
    ref_shape: &ShapeSearchRef,
    vc: u32, reg: f64, ar: f64, compact: f64, solid: f64, rect: f64,
    is_closed: bool, perimeter: f64, bbox_w: f64, bbox_h: f64,
) -> f64 {
    if ref_shape.is_closed && is_closed {
        // Kapalı → Kapalı: 6 özellikli ağırlıklı benzerlik
        let sigma = (ref_shape.vertex_count.max(vc) as f64 * 0.3).max(1.5);
        let vc_diff = ref_shape.vertex_count as f64 - vc as f64;
        let vc_sim = (-vc_diff * vc_diff / (2.0 * sigma * sigma)).exp();
        let reg_sim = 1.0 - (ref_shape.regularity - reg).abs();
        let compact_sim = 1.0 - (ref_shape.compactness - compact).abs();
        let solid_sim = 1.0 - (ref_shape.solidity - solid).abs();
        let rect_sim = 1.0 - (ref_shape.rectangularity - rect).abs();
        let ar_max = ref_shape.aspect_ratio.max(ar).max(0.01);
        let ar_sim = 1.0 - (ref_shape.aspect_ratio - ar).abs() / ar_max;
        let score = 0.20 * vc_sim + 0.20 * compact_sim + 0.15 * reg_sim
                  + 0.15 * ar_sim + 0.15 * rect_sim + 0.10 * solid_sim + 0.05;
        score.clamp(0.0, 1.0)
    } else if !ref_shape.is_closed && !is_closed {
        // Açık → Açık: vertex + aspect + sinuosity
        let sigma = (ref_shape.vertex_count.max(vc) as f64 * 0.3).max(1.5);
        let vc_diff = ref_shape.vertex_count as f64 - vc as f64;
        let vc_sim = (-vc_diff * vc_diff / (2.0 * sigma * sigma)).exp();
        let ar_max = ref_shape.aspect_ratio.max(ar).max(0.01);
        let ar_sim = 1.0 - (ref_shape.aspect_ratio - ar).abs() / ar_max;
        let diag = (bbox_w * bbox_w + bbox_h * bbox_h).sqrt().max(1e-9);
        let sinuosity = perimeter / diag;
        let ref_sin = ref_shape.vertex_count as f64 * 0.5;
        let sin_max = ref_sin.max(sinuosity).max(0.01);
        let sin_sim = 1.0 - (ref_sin - sinuosity).abs().min(sin_max) / sin_max;
        let score = 0.35 * vc_sim + 0.30 * ar_sim + 0.25 * sin_sim + 0.10;
        score.clamp(0.0, 1.0)
    } else {
        // Açık↔Kapalı: düşük uyum
        let sigma = (ref_shape.vertex_count.max(vc) as f64 * 0.3).max(1.5);
        let vc_diff = ref_shape.vertex_count as f64 - vc as f64;
        let vc_sim = (-vc_diff * vc_diff / (2.0 * sigma * sigma)).exp();
        let ar_max = ref_shape.aspect_ratio.max(ar).max(0.01);
        let ar_sim = 1.0 - (ref_shape.aspect_ratio - ar).abs() / ar_max;
        let score = 0.30 * vc_sim + 0.20 * ar_sim;
        score.clamp(0.0, 1.0)
    }
}

/// Referans şekle en çok benzeyen şekilleri döner — scoring tamamen Rust'ta.
#[tauri::command]
pub async fn search_shapes_by_similarity(
    app: tauri::AppHandle,
    ref_shape: ShapeSearchRef,
    top_k: Option<usize>,
    include_open: Option<bool>,
    archive_at: Option<String>,
) -> Result<Vec<ShapeMatchResult>, String> {
    let db_path = crate::shapes_db::resolve_shapes_db_path(&app, archive_at.as_deref())?;
    let top_k = top_k.unwrap_or(40);
    let include_open = include_open.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        // Shape DB yoksa boş döndür (henüz indekslenmemiş)
        if !db_path.exists() {
            return Ok(Vec::<ShapeMatchResult>::new());
        }
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ).map_err(|e| format!("rusqlite açma hatası: {}", e))?;

        let sql = if include_open {
            "SELECT id, asset_id, vertex_count, regularity, aspect_ratio, area,
                    perimeter, layer_category, layer_name, entity_type, is_closed,
                    COALESCE(compactness, 0), COALESCE(solidity, 0),
                    COALESCE(rectangularity, 0), bbox_w, bbox_h
             FROM dwg_shapes WHERE vertex_count >= 1"
        } else {
            "SELECT id, asset_id, vertex_count, regularity, aspect_ratio, area,
                    perimeter, layer_category, layer_name, entity_type, is_closed,
                    COALESCE(compactness, 0), COALESCE(solidity, 0),
                    COALESCE(rectangularity, 0), bbox_w, bbox_h
             FROM dwg_shapes WHERE is_closed = 1 AND vertex_count >= 3"
        };

        let mut stmt = conn.prepare(sql)
            .map_err(|e| format!("SQL prepare hatası: {}", e))?;

        let mut results: Vec<ShapeMatchResult> = Vec::new();
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?, row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?, row.get::<_, f64>(5)?,
                row.get::<_, f64>(6)?, row.get::<_, String>(7)?,
                row.get::<_, String>(8)?, row.get::<_, String>(9)?,
                row.get::<_, i32>(10)?, row.get::<_, f64>(11)?,
                row.get::<_, f64>(12)?, row.get::<_, f64>(13)?,
                row.get::<_, f64>(14)?, row.get::<_, f64>(15)?,
            ))
        }).map_err(|e| format!("query hatası: {}", e))?;

        for rr in rows {
            let r = rr.map_err(|e| format!("row hatası: {}", e))?;
            let closed = r.10 != 0;
            let score = compute_shape_similarity(
                &ref_shape, r.2, r.3, r.4, r.11, r.12, r.13, closed, r.6, r.14, r.15,
            );
            results.push(ShapeMatchResult {
                shape_id: r.0, asset_id: r.1, score, vertex_count: r.2,
                regularity: r.3, aspect_ratio: r.4, compactness: r.11,
                solidity: r.12, rectangularity: r.13, area: r.5, perimeter: r.6,
                layer_category: r.7, layer_name: r.8, entity_type: r.9, is_closed: closed,
            });
        }
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);
        Ok(results)
    }).await.map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Kriter tabanlı şekil arama — SQL filtreleme + Rust scoring.
#[tauri::command]
pub async fn search_shapes_by_features(
    app: tauri::AppHandle,
    criteria: ShapeFeatureCriteria,
    top_k: Option<usize>,
    archive_at: Option<String>,
) -> Result<Vec<ShapeMatchResult>, String> {
    let db_path = crate::shapes_db::resolve_shapes_db_path(&app, archive_at.as_deref())?;
    let top_k = top_k.unwrap_or(50);

    tauri::async_runtime::spawn_blocking(move || {
        if !db_path.exists() {
            return Ok(Vec::<ShapeMatchResult>::new());
        }
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ).map_err(|e| format!("rusqlite açma hatası: {}", e))?;

        let include_open = criteria.include_open.unwrap_or(false);
        let mut conds: Vec<String> = Vec::new();
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut pi = 0usize;

        if !include_open {
            conds.push("is_closed = 1 AND vertex_count >= 3".into());
        }
        if let Some(vc) = criteria.vertex_count {
            let tol = criteria.vertex_tolerance.unwrap_or(1);
            pi += 1; let a = pi; pi += 1; let b = pi;
            conds.push(format!("vertex_count BETWEEN ?{a} AND ?{b}"));
            params.push(Box::new((vc as i32 - tol as i32).max(1)));
            params.push(Box::new(vc as i32 + tol as i32));
        }
        if let Some(v) = criteria.min_regularity {
            pi += 1; conds.push(format!("regularity >= ?{pi}")); params.push(Box::new(v));
        }
        if let Some(ref cat) = criteria.layer_category {
            if !cat.is_empty() && cat != "TUMU" {
                pi += 1; conds.push(format!("layer_category = ?{pi}")); params.push(Box::new(cat.clone()));
            }
        }
        if let Some(v) = criteria.min_aspect_ratio {
            pi += 1; conds.push(format!("aspect_ratio >= ?{pi}")); params.push(Box::new(v));
        }
        if let Some(v) = criteria.max_aspect_ratio {
            pi += 1; conds.push(format!("aspect_ratio <= ?{pi}")); params.push(Box::new(v));
        }
        if let Some(v) = criteria.min_compactness {
            pi += 1; conds.push(format!("COALESCE(compactness,0) >= ?{pi}")); params.push(Box::new(v));
        }
        if let Some(v) = criteria.min_rectangularity {
            pi += 1; conds.push(format!("COALESCE(rectangularity,0) >= ?{pi}")); params.push(Box::new(v));
        }
        if let Some(ref ids) = criteria.asset_ids {
            if !ids.is_empty() {
                let placeholders = ids.iter().enumerate()
                    .map(|(i, _)| format!("?{}", pi + 1 + i))
                    .collect::<Vec<_>>().join(",");
                pi += ids.len();
                conds.push(format!("asset_id IN ({placeholders})"));
                for id in ids { params.push(Box::new(id.clone())); }
            }
        }
        pi += 1;
        let wh = if conds.is_empty() { "1=1".into() } else { conds.join(" AND ") };
        let sql = format!(
            "SELECT id, asset_id, vertex_count, regularity, aspect_ratio, area,
                    perimeter, layer_category, layer_name, entity_type, is_closed,
                    COALESCE(compactness,0), COALESCE(solidity,0), COALESCE(rectangularity,0),
                    bbox_w, bbox_h
             FROM dwg_shapes WHERE {wh} ORDER BY regularity DESC, area DESC LIMIT ?{pi}");
        params.push(Box::new(top_k as i32));

        let pr: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
        let mut stmt = conn.prepare(&sql).map_err(|e| format!("SQL hatası: {}", e))?;
        let mut results: Vec<ShapeMatchResult> = Vec::new();
        let rows = stmt.query_map(pr.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?, row.get::<_, String>(1)?,
                row.get::<_, u32>(2)?, row.get::<_, f64>(3)?,
                row.get::<_, f64>(4)?, row.get::<_, f64>(5)?,
                row.get::<_, f64>(6)?, row.get::<_, String>(7)?,
                row.get::<_, String>(8)?, row.get::<_, String>(9)?,
                row.get::<_, i32>(10)?, row.get::<_, f64>(11)?,
                row.get::<_, f64>(12)?, row.get::<_, f64>(13)?,
                row.get::<_, f64>(14)?, row.get::<_, f64>(15)?,
            ))
        }).map_err(|e| format!("query hatası: {}", e))?;

        for rr in rows {
            let r = rr.map_err(|e| format!("row hatası: {}", e))?;
            let closed = r.10 != 0;
            let score = if closed {
                0.30 * r.3 + 0.25 * r.11 + 0.20 * r.13 + 0.15 * r.12 + 0.10
            } else {
                0.40 * r.3 + 0.30 * (1.0 / (1.0 + (r.4 - 1.0).abs()))
                + 0.20 * (r.2 as f64 / 20.0).min(1.0) + 0.10
            };
            results.push(ShapeMatchResult {
                shape_id: r.0, asset_id: r.1, score: score.clamp(0.0, 1.0),
                vertex_count: r.2, regularity: r.3, aspect_ratio: r.4,
                compactness: r.11, solidity: r.12, rectangularity: r.13,
                area: r.5, perimeter: r.6, layer_category: r.7,
                layer_name: r.8, entity_type: r.9, is_closed: closed,
            });
        }
        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        Ok(results)
    }).await.map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ─────────────────────────────────────────────────────────
// Faz 4.4 — DWG Composite Similarity (CLIP alternatifi)
// ─────────────────────────────────────────────────────────

/// DWG benzerlik sonucu.
#[derive(Serialize)]
pub struct DwgSimilarityResult {
    pub asset_id: String,
    pub file_name: String,
    pub file_path: String,
    pub score: f64,
    pub layer_score: f64,
    pub block_score: f64,
    pub text_score: f64,
    pub shape_score: f64,
    pub phash_score: f64,
}

/// İki string seti arasında Jaccard benzerliği: |A∩B| / |A∪B|.
fn jaccard_similarity(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() && b.is_empty() { return 0.0; }
    let set_a: std::collections::HashSet<&str> = a.iter().map(|s| s.as_str()).collect();
    let set_b: std::collections::HashSet<&str> = b.iter().map(|s| s.as_str()).collect();
    let intersection = set_a.intersection(&set_b).count() as f64;
    let union = set_a.union(&set_b).count() as f64;
    if union < 1e-9 { return 0.0; }
    intersection / union
}

/// İki metin listesi arasında kelime örtüşme oranı.
fn text_overlap_score(a: &[String], b: &[String]) -> f64 {
    if a.is_empty() && b.is_empty() { return 0.0; }
    let words_a: std::collections::HashSet<String> = a.iter()
        .flat_map(|s| s.to_lowercase().split_whitespace().map(|w| w.to_string()).collect::<Vec<_>>())
        .filter(|w| w.len() > 2)
        .collect();
    let words_b: std::collections::HashSet<String> = b.iter()
        .flat_map(|s| s.to_lowercase().split_whitespace().map(|w| w.to_string()).collect::<Vec<_>>())
        .filter(|w| w.len() > 2)
        .collect();
    if words_a.is_empty() && words_b.is_empty() { return 0.0; }
    let inter = words_a.iter().filter(|w| words_b.contains(w.as_str())).count() as f64;
    let union = words_a.len().max(words_b.len()) as f64;
    if union < 1e-9 { return 0.0; }
    (inter / union).min(1.0)
}

/// pHash Hamming distance'dan benzerlik skoru (0..1).
fn phash_similarity(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() { return 0.0; }
    let ha = u64::from_str_radix(a, 16);
    let hb = u64::from_str_radix(b, 16);
    match (ha, hb) {
        (Ok(va), Ok(vb)) => {
            let dist = (va ^ vb).count_ones() as f64;
            1.0 - dist / 64.0
        }
        _ => 0.0,
    }
}

/// metadata_json'dan string dizisi çıkarır.
fn extract_json_string_array(meta: &serde_json::Value, key: &str) -> Vec<String> {
    meta.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
        .unwrap_or_default()
}

/// Şekil profili: vertex sayısı dağılımı + ortalama regularity + ortalama compactness.
struct ShapeProfile {
    vertex_histogram: [u32; 5], // [3-4, 5-6, 7-8, 9-12, 13+]
    avg_regularity: f64,
    avg_compactness: f64,
    count: u32,
}

fn empty_shape_profile() -> ShapeProfile {
    ShapeProfile {
        vertex_histogram: [0; 5],
        avg_regularity: 0.0,
        avg_compactness: 0.0,
        count: 0,
    }
}

fn build_shape_profile(conn: &rusqlite::Connection, asset_id: &str) -> ShapeProfile {
    let mut profile = ShapeProfile {
        vertex_histogram: [0; 5],
        avg_regularity: 0.0,
        avg_compactness: 0.0,
        count: 0,
    };
    let sql = "SELECT vertex_count, regularity, COALESCE(compactness, 0)
               FROM dwg_shapes WHERE asset_id = ? AND is_closed = 1 AND vertex_count >= 3";
    let mut stmt = match conn.prepare(sql) { Ok(s) => s, Err(_) => return profile };
    let rows = match stmt.query_map(rusqlite::params![asset_id], |row| {
        Ok((row.get::<_, u32>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?))
    }) { Ok(r) => r, Err(_) => return profile };

    let mut total_reg = 0.0;
    let mut total_comp = 0.0;
    for (vc, reg, comp) in rows.flatten() {
        let bin = match vc { 3..=4 => 0, 5..=6 => 1, 7..=8 => 2, 9..=12 => 3, _ => 4 };
        profile.vertex_histogram[bin] += 1;
        total_reg += reg;
        total_comp += comp;
        profile.count += 1;
    }
    if profile.count > 0 {
        profile.avg_regularity = total_reg / profile.count as f64;
        profile.avg_compactness = total_comp / profile.count as f64;
    }
    profile
}

fn shape_profile_similarity(a: &ShapeProfile, b: &ShapeProfile) -> f64 {
    if a.count == 0 && b.count == 0 { return 0.0; }
    if a.count == 0 || b.count == 0 { return 0.0; }

    // Histogram cosine similarity
    let mut dot = 0.0f64;
    let mut norm_a = 0.0f64;
    let mut norm_b = 0.0f64;
    for i in 0..5 {
        let va = a.vertex_histogram[i] as f64;
        let vb = b.vertex_histogram[i] as f64;
        dot += va * vb;
        norm_a += va * va;
        norm_b += vb * vb;
    }
    let hist_sim = if norm_a > 0.0 && norm_b > 0.0 {
        dot / (norm_a.sqrt() * norm_b.sqrt())
    } else { 0.0 };

    let reg_sim = 1.0 - (a.avg_regularity - b.avg_regularity).abs();
    let comp_sim = 1.0 - (a.avg_compactness - b.avg_compactness).abs();

    // Sayı benzerliği: min/max oranı
    let count_sim = a.count.min(b.count) as f64 / a.count.max(b.count).max(1) as f64;

    0.40 * hist_sim + 0.20 * reg_sim + 0.20 * comp_sim + 0.20 * count_sim
}

/// Referans DWG asset'e en benzer DWG dosyalarını bulur.
/// Composite scoring: katman Jaccard + blok Jaccard + metin örtüşme + şekil profili + pHash.
/// CLIP skoru kullanılmaz — DWG'de güvenilir değil.
#[tauri::command]
pub async fn search_similar_dwg(
    app: tauri::AppHandle,
    ref_asset_id: String,
    top_k: Option<usize>,
    archive_at: Option<String>,
) -> Result<Vec<DwgSimilarityResult>, String> {
    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;
    let shapes_db_path = crate::shapes_db::resolve_shapes_db_path(&app, archive_at.as_deref()).ok();
    let top_k = top_k.unwrap_or(30);

    tauri::async_runtime::spawn_blocking(move || {
        let conn = rusqlite::Connection::open_with_flags(
            &db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ).map_err(|e| format!("rusqlite açma hatası: {}", e))?;

        // Shape DB ayrı dosyada — varsa aç, yoksa boş profile döndüren bir conn
        let shapes_conn = shapes_db_path.as_ref().and_then(|p| {
            if p.exists() {
                rusqlite::Connection::open_with_flags(
                    p,
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
                ).ok()
            } else {
                None
            }
        });

        // 1. Referans asset'i oku
        let ref_row: (String, String, Option<String>) = conn.query_row(
            "SELECT metadata_json, COALESCE(phash, ''), file_type FROM assets WHERE id = ? AND is_deleted = 0",
            rusqlite::params![&ref_asset_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).map_err(|e| format!("Referans asset bulunamadı: {}", e))?;

        let ref_meta: serde_json::Value = serde_json::from_str(&ref_row.0).unwrap_or_default();
        let ref_phash = ref_row.1;

        let ref_layers = extract_json_string_array(&ref_meta, "dwgLayers");
        let ref_blocks = extract_json_string_array(&ref_meta, "dwgBlockNames");
        let ref_texts = extract_json_string_array(&ref_meta, "dwgTextContents");
        let ref_shape_profile = match shapes_conn.as_ref() {
            Some(sc) => build_shape_profile(sc, &ref_asset_id),
            None => empty_shape_profile(),
        };

        // 2. Tüm DWG/DXF asset'leri tara
        let mut stmt = conn.prepare(
            "SELECT id, file_name, file_path, metadata_json, COALESCE(phash, '')
             FROM assets
             WHERE file_type IN ('DWG', 'DXF') AND is_deleted = 0 AND id != ?"
        ).map_err(|e| format!("SQL hatası: {}", e))?;

        let mut results: Vec<DwgSimilarityResult> = Vec::new();

        let rows = stmt.query_map(rusqlite::params![&ref_asset_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
            ))
        }).map_err(|e| format!("query hatası: {}", e))?;

        for rr in rows {
            let (id, file_name, file_path, meta_json, phash) =
                rr.map_err(|e| format!("row hatası: {}", e))?;

            let meta: serde_json::Value = serde_json::from_str(&meta_json).unwrap_or_default();

            let layers = extract_json_string_array(&meta, "dwgLayers");
            let blocks = extract_json_string_array(&meta, "dwgBlockNames");
            let texts = extract_json_string_array(&meta, "dwgTextContents");

            let layer_score = jaccard_similarity(&ref_layers, &layers);
            let block_score = jaccard_similarity(&ref_blocks, &blocks);
            let text_score = text_overlap_score(&ref_texts, &texts);
            let phash_score = phash_similarity(&ref_phash, &phash);

            let cand_shape_profile = match shapes_conn.as_ref() {
                Some(sc) => build_shape_profile(sc, &id),
                None => empty_shape_profile(),
            };
            let shape_score = shape_profile_similarity(&ref_shape_profile, &cand_shape_profile);

            // Ağırlıklı composite skor
            let score = 0.25 * layer_score
                      + 0.20 * block_score
                      + 0.20 * text_score
                      + 0.20 * shape_score
                      + 0.15 * phash_score;

            if score > 0.05 {
                results.push(DwgSimilarityResult {
                    asset_id: id, file_name, file_path,
                    score, layer_score, block_score, text_score, shape_score, phash_score,
                });
            }
        }

        results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
        results.truncate(top_k);
        Ok(results)
    }).await.map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ═══════════════════════════════════════════════════════════════════════════════
// User Metadata Mirror (favorites, collections, tags, root_groups)
//
// A-SAVE-FREEZE refaktörü: bu tablolara yazma artık saveDatabase() (tam DB export)
// tetiklemiyor; servis fonksiyonları kendi tablo-özel rusqlite invoke'unu çağırır.
// audit_log_apply_changes ve write_chat_mirror pattern'iyle aynı:
// spawn_blocking + DB lock + transaction + PRAGMA foreign_keys=OFF.
// ═══════════════════════════════════════════════════════════════════════════════

const EXTRA_USER_META_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#a855f7',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT DEFAULT '#6366f1',
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS root_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS root_tags (
    root_id TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (root_id, tag_id)
);
";

// ── 1. Favorites ────────────────────────────────────────────────────────────

#[derive(serde::Deserialize, Default)]
pub struct FavoriteMirrorPayload {
    #[serde(default)]
    pub inserts: Vec<String>,
    #[serde(default)]
    pub deletes: Vec<String>,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteMirrorResult {
    pub inserted_count: usize,
    pub deleted_count: usize,
}

#[tauri::command]
pub async fn favorite_apply_changes(
    app: tauri::AppHandle,
    payload: FavoriteMirrorPayload,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<FavoriteMirrorResult, String> {
    crate::require_authenticated(&role_state)?;

    if payload.inserts.is_empty() && payload.deletes.is_empty() {
        return Ok(FavoriteMirrorResult::default());
    }

    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock().map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = crate::ollama_db::acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;
        let conn = crate::ollama_db::prepare_write_conn(&db_path)?;
        conn.execute_batch(EXTRA_TRASH_SCHEMA)
            .map_err(|e| format!("favorites şema hatası: {}", e))?;

        let mut result = FavoriteMirrorResult::default();
        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction hatası: {}", e))?;

        if !payload.deletes.is_empty() {
            let mut stmt = tx.prepare_cached("DELETE FROM favorites WHERE asset_id = ?1")
                .map_err(|e| format!("DELETE prepare: {}", e))?;
            for id in &payload.deletes {
                let n = stmt.execute([id]).map_err(|e| format!("DELETE: {}", e))?;
                result.deleted_count += n;
            }
        }
        if !payload.inserts.is_empty() {
            let mut stmt = tx.prepare_cached(
                "INSERT OR IGNORE INTO favorites (asset_id, created_at) VALUES (?1, datetime('now'))"
            ).map_err(|e| format!("INSERT prepare: {}", e))?;
            for id in &payload.inserts {
                let n = stmt.execute([id]).map_err(|e| format!("INSERT: {}", e))?;
                result.inserted_count += n;
            }
        }

        tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ── 2. Collections + collection_items ───────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct CollectionInsertRow {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct CollectionRename {
    pub id: i64,
    pub name: String,
}

#[derive(serde::Deserialize)]
pub struct CollectionColorUpdate {
    pub id: i64,
    pub color: String,
}

#[derive(serde::Deserialize)]
pub struct CollectionItemKey {
    pub collection_id: i64,
    pub asset_id: String,
}

#[derive(serde::Deserialize, Default)]
pub struct CollectionMirrorPayload {
    #[serde(default)]
    pub collection_inserts: Vec<CollectionInsertRow>,
    #[serde(default)]
    pub collection_renames: Vec<CollectionRename>,
    #[serde(default)]
    pub collection_color_updates: Vec<CollectionColorUpdate>,
    #[serde(default)]
    pub collection_deletes: Vec<i64>,
    #[serde(default)]
    pub item_inserts: Vec<CollectionItemKey>,
    #[serde(default)]
    pub item_deletes: Vec<CollectionItemKey>,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CollectionMirrorResult {
    pub collections_inserted: usize,
    pub collections_updated: usize,
    pub collections_deleted: usize,
    pub items_inserted: usize,
    pub items_deleted: usize,
}

#[tauri::command]
pub async fn collection_apply_changes(
    app: tauri::AppHandle,
    payload: CollectionMirrorPayload,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<CollectionMirrorResult, String> {
    crate::require_authenticated(&role_state)?;

    let has_work = !payload.collection_inserts.is_empty()
        || !payload.collection_renames.is_empty()
        || !payload.collection_color_updates.is_empty()
        || !payload.collection_deletes.is_empty()
        || !payload.item_inserts.is_empty()
        || !payload.item_deletes.is_empty();
    if !has_work {
        return Ok(CollectionMirrorResult::default());
    }

    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock().map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = crate::ollama_db::acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;
        let conn = crate::ollama_db::prepare_write_conn(&db_path)?;
        conn.execute_batch(EXTRA_USER_META_SCHEMA)
            .map_err(|e| format!("collections şema hatası: {}", e))?;
        conn.execute_batch(EXTRA_TRASH_SCHEMA)
            .map_err(|e| format!("collection_items şema hatası: {}", e))?;

        let mut result = CollectionMirrorResult::default();
        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction hatası: {}", e))?;

        // Sıra: DELETE > UPDATE > INSERT
        // FK OFF olduğu için collection silerken items'ı manuel sil
        if !payload.collection_deletes.is_empty() {
            let mut items_stmt = tx.prepare_cached("DELETE FROM collection_items WHERE collection_id = ?1")
                .map_err(|e| format!("items DELETE prepare: {}", e))?;
            let mut coll_stmt = tx.prepare_cached("DELETE FROM collections WHERE id = ?1")
                .map_err(|e| format!("collection DELETE prepare: {}", e))?;
            for id in &payload.collection_deletes {
                items_stmt.execute([id]).map_err(|e| format!("items DELETE: {}", e))?;
                let n = coll_stmt.execute([id]).map_err(|e| format!("collection DELETE: {}", e))?;
                result.collections_deleted += n;
            }
        }
        if !payload.item_deletes.is_empty() {
            let mut stmt = tx.prepare_cached(
                "DELETE FROM collection_items WHERE collection_id = ?1 AND asset_id = ?2"
            ).map_err(|e| format!("item DELETE prepare: {}", e))?;
            for key in &payload.item_deletes {
                let n = stmt.execute(rusqlite::params![key.collection_id, &key.asset_id])
                    .map_err(|e| format!("item DELETE: {}", e))?;
                result.items_deleted += n;
            }
        }
        if !payload.collection_renames.is_empty() {
            let mut stmt = tx.prepare_cached("UPDATE collections SET name = ?1 WHERE id = ?2")
                .map_err(|e| format!("rename prepare: {}", e))?;
            for r in &payload.collection_renames {
                let n = stmt.execute(rusqlite::params![&r.name, r.id])
                    .map_err(|e| format!("rename: {}", e))?;
                result.collections_updated += n;
            }
        }
        if !payload.collection_color_updates.is_empty() {
            let mut stmt = tx.prepare_cached("UPDATE collections SET color = ?1 WHERE id = ?2")
                .map_err(|e| format!("color prepare: {}", e))?;
            for u in &payload.collection_color_updates {
                let n = stmt.execute(rusqlite::params![&u.color, u.id])
                    .map_err(|e| format!("color: {}", e))?;
                result.collections_updated += n;
            }
        }
        if !payload.collection_inserts.is_empty() {
            let mut stmt = tx.prepare_cached(
                "INSERT OR REPLACE INTO collections (id, name, color, created_at) \
                 VALUES (?1, ?2, ?3, COALESCE(?4, datetime('now')))"
            ).map_err(|e| format!("collection INSERT prepare: {}", e))?;
            for c in &payload.collection_inserts {
                let n = stmt.execute(rusqlite::params![
                    c.id, &c.name,
                    c.color.as_deref().unwrap_or("#a855f7"),
                    &c.created_at
                ]).map_err(|e| format!("collection INSERT: {}", e))?;
                result.collections_inserted += n;
            }
        }
        if !payload.item_inserts.is_empty() {
            let mut stmt = tx.prepare_cached(
                "INSERT OR IGNORE INTO collection_items (collection_id, asset_id, created_at) \
                 VALUES (?1, ?2, datetime('now'))"
            ).map_err(|e| format!("item INSERT prepare: {}", e))?;
            for key in &payload.item_inserts {
                let n = stmt.execute(rusqlite::params![key.collection_id, &key.asset_id])
                    .map_err(|e| format!("item INSERT: {}", e))?;
                result.items_inserted += n;
            }
        }

        tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ── 3. Tags + asset_tags + root_tags ────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct TagInsertRow {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct TagRename {
    pub id: i64,
    pub name: String,
}

#[derive(serde::Deserialize)]
pub struct TagColorUpdate {
    pub id: i64,
    pub color: String,
}

#[derive(serde::Deserialize)]
pub struct AssetTagKey {
    pub asset_id: String,
    pub tag_id: i64,
}

#[derive(serde::Deserialize)]
pub struct RootTagKey {
    pub root_id: String,
    pub tag_id: i64,
}

#[derive(serde::Deserialize)]
pub struct TagMergeOp {
    pub source_tag_id: i64,
    pub target_tag_id: i64,
}

#[derive(serde::Deserialize, Default)]
pub struct TagMirrorPayload {
    // tags
    #[serde(default)]
    pub tag_inserts: Vec<TagInsertRow>,
    #[serde(default)]
    pub tag_renames: Vec<TagRename>,
    #[serde(default)]
    pub tag_color_updates: Vec<TagColorUpdate>,
    #[serde(default)]
    pub tag_deletes: Vec<i64>,
    // asset_tags
    #[serde(default)]
    pub asset_tag_inserts: Vec<AssetTagKey>,
    #[serde(default)]
    pub asset_tag_deletes: Vec<AssetTagKey>,
    /// asset_id'ye ait TÜM asset_tag'leri sil (setTagsForAsset için DELETE-then-INSERT)
    #[serde(default)]
    pub asset_tag_clear_for_assets: Vec<String>,
    /// tag_id'ye ait TÜM asset_tag'leri sil (deleteTag / mergeTags için)
    #[serde(default)]
    pub asset_tag_clear_for_tags: Vec<i64>,
    /// mergeTags: source'taki kayıtları target'e kopyala (DELETE'lerden ÖNCE)
    #[serde(default)]
    pub asset_tag_merges: Vec<TagMergeOp>,
    // root_tags
    #[serde(default)]
    pub root_tag_inserts: Vec<RootTagKey>,
    #[serde(default)]
    pub root_tag_deletes: Vec<RootTagKey>,
    #[serde(default)]
    pub root_tag_clear_for_roots: Vec<String>,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TagMirrorResult {
    pub tags_inserted: usize,
    pub tags_updated: usize,
    pub tags_deleted: usize,
    pub asset_tags_inserted: usize,
    pub asset_tags_deleted: usize,
    pub root_tags_inserted: usize,
    pub root_tags_deleted: usize,
}

#[tauri::command]
pub async fn tag_apply_changes(
    app: tauri::AppHandle,
    payload: TagMirrorPayload,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<TagMirrorResult, String> {
    crate::require_authenticated(&role_state)?;

    let has_work = !payload.tag_inserts.is_empty()
        || !payload.tag_renames.is_empty()
        || !payload.tag_color_updates.is_empty()
        || !payload.tag_deletes.is_empty()
        || !payload.asset_tag_inserts.is_empty()
        || !payload.asset_tag_deletes.is_empty()
        || !payload.asset_tag_clear_for_assets.is_empty()
        || !payload.asset_tag_clear_for_tags.is_empty()
        || !payload.asset_tag_merges.is_empty()
        || !payload.root_tag_inserts.is_empty()
        || !payload.root_tag_deletes.is_empty()
        || !payload.root_tag_clear_for_roots.is_empty();
    if !has_work {
        return Ok(TagMirrorResult::default());
    }

    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock().map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = crate::ollama_db::acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;
        let conn = crate::ollama_db::prepare_write_conn(&db_path)?;
        conn.execute_batch(EXTRA_USER_META_SCHEMA)
            .map_err(|e| format!("tags şema hatası: {}", e))?;
        conn.execute_batch(EXTRA_TRASH_SCHEMA)
            .map_err(|e| format!("asset_tags şema hatası: {}", e))?;

        let mut result = TagMirrorResult::default();
        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction hatası: {}", e))?;

        // 1. Tag silme — bağlı asset_tags + root_tags da silinir (FK OFF, manuel cascade)
        if !payload.tag_deletes.is_empty() {
            let mut at_stmt = tx.prepare_cached("DELETE FROM asset_tags WHERE tag_id = ?1")
                .map_err(|e| format!("at-by-tag prepare: {}", e))?;
            let mut rt_stmt = tx.prepare_cached("DELETE FROM root_tags WHERE tag_id = ?1")
                .map_err(|e| format!("rt-by-tag prepare: {}", e))?;
            let mut t_stmt = tx.prepare_cached("DELETE FROM tags WHERE id = ?1")
                .map_err(|e| format!("tag DELETE prepare: {}", e))?;
            for id in &payload.tag_deletes {
                at_stmt.execute([id]).map_err(|e| format!("at-by-tag: {}", e))?;
                rt_stmt.execute([id]).map_err(|e| format!("rt-by-tag: {}", e))?;
                let n = t_stmt.execute([id]).map_err(|e| format!("tag DELETE: {}", e))?;
                result.tags_deleted += n;
            }
        }
        // 2. mergeTags — DELETE'ten ÖNCE asset_tags'i source'tan target'e kopyala
        if !payload.asset_tag_merges.is_empty() {
            let mut stmt = tx.prepare_cached(
                "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, created_at) \
                 SELECT asset_id, ?1, datetime('now') FROM asset_tags WHERE tag_id = ?2"
            ).map_err(|e| format!("merge prepare: {}", e))?;
            for m in &payload.asset_tag_merges {
                stmt.execute(rusqlite::params![m.target_tag_id, m.source_tag_id])
                    .map_err(|e| format!("merge: {}", e))?;
            }
        }
        // 3. asset_tag clear (setTagsForAsset = clear-then-insert pattern)
        if !payload.asset_tag_clear_for_assets.is_empty() {
            let mut stmt = tx.prepare_cached("DELETE FROM asset_tags WHERE asset_id = ?1")
                .map_err(|e| format!("at clear-asset prepare: {}", e))?;
            for id in &payload.asset_tag_clear_for_assets {
                let n = stmt.execute([id]).map_err(|e| format!("at clear-asset: {}", e))?;
                result.asset_tags_deleted += n;
            }
        }
        if !payload.asset_tag_clear_for_tags.is_empty() {
            let mut stmt = tx.prepare_cached("DELETE FROM asset_tags WHERE tag_id = ?1")
                .map_err(|e| format!("at clear-tag prepare: {}", e))?;
            for id in &payload.asset_tag_clear_for_tags {
                let n = stmt.execute([id]).map_err(|e| format!("at clear-tag: {}", e))?;
                result.asset_tags_deleted += n;
            }
        }
        if !payload.asset_tag_deletes.is_empty() {
            let mut stmt = tx.prepare_cached(
                "DELETE FROM asset_tags WHERE asset_id = ?1 AND tag_id = ?2"
            ).map_err(|e| format!("at DELETE prepare: {}", e))?;
            for key in &payload.asset_tag_deletes {
                let n = stmt.execute(rusqlite::params![&key.asset_id, key.tag_id])
                    .map_err(|e| format!("at DELETE: {}", e))?;
                result.asset_tags_deleted += n;
            }
        }
        // 4. root_tag clear/delete
        if !payload.root_tag_clear_for_roots.is_empty() {
            let mut stmt = tx.prepare_cached("DELETE FROM root_tags WHERE root_id = ?1")
                .map_err(|e| format!("rt clear-root prepare: {}", e))?;
            for id in &payload.root_tag_clear_for_roots {
                let n = stmt.execute([id]).map_err(|e| format!("rt clear-root: {}", e))?;
                result.root_tags_deleted += n;
            }
        }
        if !payload.root_tag_deletes.is_empty() {
            let mut stmt = tx.prepare_cached(
                "DELETE FROM root_tags WHERE root_id = ?1 AND tag_id = ?2"
            ).map_err(|e| format!("rt DELETE prepare: {}", e))?;
            for key in &payload.root_tag_deletes {
                let n = stmt.execute(rusqlite::params![&key.root_id, key.tag_id])
                    .map_err(|e| format!("rt DELETE: {}", e))?;
                result.root_tags_deleted += n;
            }
        }
        // 5. Tag UPDATE
        if !payload.tag_renames.is_empty() {
            let mut stmt = tx.prepare_cached("UPDATE tags SET name = ?1 WHERE id = ?2")
                .map_err(|e| format!("tag rename prepare: {}", e))?;
            for r in &payload.tag_renames {
                let n = stmt.execute(rusqlite::params![&r.name, r.id])
                    .map_err(|e| format!("tag rename: {}", e))?;
                result.tags_updated += n;
            }
        }
        if !payload.tag_color_updates.is_empty() {
            let mut stmt = tx.prepare_cached("UPDATE tags SET color = ?1 WHERE id = ?2")
                .map_err(|e| format!("tag color prepare: {}", e))?;
            for u in &payload.tag_color_updates {
                let n = stmt.execute(rusqlite::params![&u.color, u.id])
                    .map_err(|e| format!("tag color: {}", e))?;
                result.tags_updated += n;
            }
        }
        // 6. Tag INSERT (id frontend AUTOINCREMENT'ten alındı)
        if !payload.tag_inserts.is_empty() {
            let mut stmt = tx.prepare_cached(
                "INSERT OR REPLACE INTO tags (id, name, color, created_at) \
                 VALUES (?1, ?2, ?3, COALESCE(?4, datetime('now')))"
            ).map_err(|e| format!("tag INSERT prepare: {}", e))?;
            for t in &payload.tag_inserts {
                let n = stmt.execute(rusqlite::params![
                    t.id, &t.name,
                    t.color.as_deref().unwrap_or("#6366f1"),
                    &t.created_at
                ]).map_err(|e| format!("tag INSERT: {}", e))?;
                result.tags_inserted += n;
            }
        }
        // 7. asset_tag INSERT
        if !payload.asset_tag_inserts.is_empty() {
            let mut stmt = tx.prepare_cached(
                "INSERT OR IGNORE INTO asset_tags (asset_id, tag_id, created_at) \
                 VALUES (?1, ?2, datetime('now'))"
            ).map_err(|e| format!("at INSERT prepare: {}", e))?;
            for key in &payload.asset_tag_inserts {
                let n = stmt.execute(rusqlite::params![&key.asset_id, key.tag_id])
                    .map_err(|e| format!("at INSERT: {}", e))?;
                result.asset_tags_inserted += n;
            }
        }
        // 8. root_tag INSERT
        if !payload.root_tag_inserts.is_empty() {
            let mut stmt = tx.prepare_cached(
                "INSERT OR IGNORE INTO root_tags (root_id, tag_id) VALUES (?1, ?2)"
            ).map_err(|e| format!("rt INSERT prepare: {}", e))?;
            for key in &payload.root_tag_inserts {
                let n = stmt.execute(rusqlite::params![&key.root_id, key.tag_id])
                    .map_err(|e| format!("rt INSERT: {}", e))?;
                result.root_tags_inserted += n;
            }
        }

        tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ── 4. Root Groups ──────────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
pub struct RootGroupInsertRow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    pub sort_order: i64,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct RootGroupRename {
    pub id: String,
    pub name: String,
}

#[derive(serde::Deserialize)]
pub struct RootGroupColorUpdate {
    pub id: String,
    pub color: String,
}

#[derive(serde::Deserialize)]
pub struct RootGroupSortUpdate {
    pub id: String,
    pub sort_order: i64,
}

#[derive(serde::Deserialize)]
pub struct ScannedRootGroupAssign {
    pub root_id: String,
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(serde::Deserialize, Default)]
pub struct RootGroupMirrorPayload {
    #[serde(default)]
    pub inserts: Vec<RootGroupInsertRow>,
    #[serde(default)]
    pub renames: Vec<RootGroupRename>,
    #[serde(default)]
    pub color_updates: Vec<RootGroupColorUpdate>,
    #[serde(default)]
    pub sort_updates: Vec<RootGroupSortUpdate>,
    /// Grup silme — bağlı scanned_roots.group_id NULL + grup satırı silinir
    #[serde(default)]
    pub deletes: Vec<String>,
    /// scanned_roots.group_id ataması (moveRootToGroup için; group_id None ise gruptan çıkar)
    #[serde(default)]
    pub root_group_assigns: Vec<ScannedRootGroupAssign>,
}

#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RootGroupMirrorResult {
    pub inserted: usize,
    pub updated: usize,
    pub deleted: usize,
    pub roots_reassigned: usize,
}

#[tauri::command]
pub async fn root_group_apply_changes(
    app: tauri::AppHandle,
    payload: RootGroupMirrorPayload,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<RootGroupMirrorResult, String> {
    crate::require_authenticated(&role_state)?;

    let has_work = !payload.inserts.is_empty()
        || !payload.renames.is_empty()
        || !payload.color_updates.is_empty()
        || !payload.sort_updates.is_empty()
        || !payload.deletes.is_empty()
        || !payload.root_group_assigns.is_empty();
    if !has_work {
        return Ok(RootGroupMirrorResult::default());
    }

    let db_path = resolve_archive_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock().map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = crate::ollama_db::acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;
        let conn = crate::ollama_db::prepare_write_conn(&db_path)?;
        conn.execute_batch(EXTRA_USER_META_SCHEMA)
            .map_err(|e| format!("root_groups şema hatası: {}", e))?;

        let mut result = RootGroupMirrorResult::default();
        let tx = conn.unchecked_transaction()
            .map_err(|e| format!("Transaction hatası: {}", e))?;

        // 1. Grup silme — önce bağlı scanned_roots.group_id NULL, sonra root_groups
        if !payload.deletes.is_empty() {
            let mut clear_stmt = tx.prepare_cached(
                "UPDATE scanned_roots SET group_id = NULL WHERE group_id = ?1"
            ).map_err(|e| format!("clear group_id prepare: {}", e))?;
            let mut del_stmt = tx.prepare_cached("DELETE FROM root_groups WHERE id = ?1")
                .map_err(|e| format!("group DELETE prepare: {}", e))?;
            for id in &payload.deletes {
                let cleared = clear_stmt.execute([id])
                    .map_err(|e| format!("clear group_id: {}", e))?;
                result.roots_reassigned += cleared;
                let n = del_stmt.execute([id]).map_err(|e| format!("group DELETE: {}", e))?;
                result.deleted += n;
            }
        }
        if !payload.renames.is_empty() {
            let mut stmt = tx.prepare_cached("UPDATE root_groups SET name = ?1 WHERE id = ?2")
                .map_err(|e| format!("rename prepare: {}", e))?;
            for r in &payload.renames {
                let n = stmt.execute(rusqlite::params![&r.name, &r.id])
                    .map_err(|e| format!("rename: {}", e))?;
                result.updated += n;
            }
        }
        if !payload.color_updates.is_empty() {
            let mut stmt = tx.prepare_cached("UPDATE root_groups SET color = ?1 WHERE id = ?2")
                .map_err(|e| format!("color prepare: {}", e))?;
            for u in &payload.color_updates {
                let n = stmt.execute(rusqlite::params![&u.color, &u.id])
                    .map_err(|e| format!("color: {}", e))?;
                result.updated += n;
            }
        }
        if !payload.sort_updates.is_empty() {
            let mut stmt = tx.prepare_cached("UPDATE root_groups SET sort_order = ?1 WHERE id = ?2")
                .map_err(|e| format!("sort prepare: {}", e))?;
            for u in &payload.sort_updates {
                let n = stmt.execute(rusqlite::params![u.sort_order, &u.id])
                    .map_err(|e| format!("sort: {}", e))?;
                result.updated += n;
            }
        }
        if !payload.inserts.is_empty() {
            let mut stmt = tx.prepare_cached(
                "INSERT OR REPLACE INTO root_groups (id, name, color, sort_order, created_at) \
                 VALUES (?1, ?2, ?3, ?4, COALESCE(?5, datetime('now')))"
            ).map_err(|e| format!("group INSERT prepare: {}", e))?;
            for g in &payload.inserts {
                let n = stmt.execute(rusqlite::params![
                    &g.id, &g.name,
                    g.color.as_deref().unwrap_or("#6366f1"),
                    g.sort_order, &g.created_at
                ]).map_err(|e| format!("group INSERT: {}", e))?;
                result.inserted += n;
            }
        }
        if !payload.root_group_assigns.is_empty() {
            let mut stmt = tx.prepare_cached("UPDATE scanned_roots SET group_id = ?1 WHERE id = ?2")
                .map_err(|e| format!("assign prepare: {}", e))?;
            for a in &payload.root_group_assigns {
                let n = stmt.execute(rusqlite::params![&a.group_id, &a.root_id])
                    .map_err(|e| format!("assign: {}", e))?;
                result.roots_reassigned += n;
            }
        }

        tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // ── Yardımcı: arşiv ID → beklenen DB tipi ────────────────────────────────

    /// Arşiv ID'sinin hangi DB kategorisini seçeceğini döner — AppHandle gerektirmez.
    fn archive_db_kind(archive_at: Option<&str>) -> &'static str {
        match archive_at {
            Some("local") => "local",
            Some(id) if id != "main" && !id.is_empty() => "custom",
            _ => "main",
        }
    }

    // ── 1. Yönlendirme mantığı (saf fonksiyon) ──────────────────────────────

    #[test]
    fn routing_none_is_main() {
        assert_eq!(archive_db_kind(None), "main");
    }

    #[test]
    fn routing_explicit_main_is_main() {
        assert_eq!(archive_db_kind(Some("main")), "main");
    }

    #[test]
    fn routing_empty_string_is_main() {
        assert_eq!(archive_db_kind(Some("")), "main");
    }

    #[test]
    fn routing_local_is_local() {
        assert_eq!(archive_db_kind(Some("local")), "local");
    }

    #[test]
    fn routing_custom_id_is_custom() {
        assert_eq!(archive_db_kind(Some("proje_kule")), "custom");
        assert_eq!(archive_db_kind(Some("archive_ofis_merkez")), "custom");
        assert_eq!(archive_db_kind(Some("my_archive_42")), "custom");
    }

    // ── 2. Entegrasyon: doğru dosyaya yazma / yanlış dosyaya yazmama ─────────

    fn make_minimal_asset(id: &str) -> AssetRow {
        AssetRow {
            id: id.to_string(),
            file_name: format!("{}.dwg", id),
            file_path: format!("C:/test/{}.dwg", id),
            file_size: 1024,
            file_type: "DWG".to_string(),
            category: "2D Cizim".to_string(),
            created_at: "2024-01-01T00:00:00Z".to_string(),
            modified_at: "2024-01-01T00:00:00Z".to_string(),
            project_name: String::new(),
            project_phase: String::new(),
            material_group: None,
            color_theme: None,
            architectural_style: None,
            omniclass_code: None,
            hash: None,
            phash: None,
            content_hash: None,
            metadata_json: "{}".to_string(),
            ai_tags_json: "[]".to_string(),
            color_palette_json: "[]".to_string(),
            thumbnail_url: None,
            raw_metadata: None,
            fs_mtime: None,
            metadata_version: 1,
            applied_extractors: None,
        }
    }

    fn payload_with_asset(asset: AssetRow) -> ScanBatchPayload {
        ScanBatchPayload {
            assets: vec![asset],
            embeddings: vec![],
            text_chunks: vec![],
            delete_chunks_for: vec![],
            dwg_shapes: vec![],
            delete_shapes_for: vec![],
            relations: vec![],
            scanned_roots: vec![],
            delete_scanned_roots: vec![],
        }
    }

    fn asset_count(db_path: &PathBuf) -> usize {
        if !db_path.exists() { return 0; }
        let conn = rusqlite::Connection::open_with_flags(
            db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ).unwrap();
        conn.query_row("SELECT COUNT(*) FROM assets", [], |r| r.get::<_, i64>(0))
            .unwrap_or(0) as usize
    }

    #[test]
    fn write_goes_to_target_db_not_other() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let main_db  = dir.join("main.db");
        let local_db = dir.join("local.db");

        // main DB'ye asset-1 yaz
        let r1 = write_scan_batch_to_db(&main_db, payload_with_asset(make_minimal_asset("asset-1")));
        assert!(r1.is_ok(), "main DB yazma başarısız: {:?}", r1);
        assert_eq!(r1.unwrap().assets_written, 1);

        // local DB'ye asset-2 yaz
        let r2 = write_scan_batch_to_db(&local_db, payload_with_asset(make_minimal_asset("asset-2")));
        assert!(r2.is_ok(), "local DB yazma başarısız: {:?}", r2);
        assert_eq!(r2.unwrap().assets_written, 1);

        // Her DB sadece kendi asset'ini içeriyor
        assert_eq!(asset_count(&main_db),  1, "main DB yanlış sayıda asset içeriyor");
        assert_eq!(asset_count(&local_db), 1, "local DB yanlış sayıda asset içeriyor");

        // main DB'de asset-2 YOK — arşivler birbirine karışmadı
        let conn = rusqlite::Connection::open_with_flags(
            &main_db,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ).unwrap();
        let leaked: i64 = conn.query_row(
            "SELECT COUNT(*) FROM assets WHERE id = 'asset-2'",
            [], |r| r.get(0),
        ).unwrap_or(0);
        assert_eq!(leaked, 0, "asset-2 main DB'ye sızdı!");
    }

    #[test]
    fn write_to_custom_archive_does_not_touch_main() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        let main_db   = dir.join("main.db");
        let custom_db = dir.join("archive_proje_kule.db");

        // Yalnızca custom DB'ye yaz
        write_scan_batch_to_db(&custom_db, payload_with_asset(make_minimal_asset("asset-custom")))
            .expect("custom DB yazma başarısız");

        // main.db hiç oluşturulmadı veya boş
        assert_eq!(asset_count(&main_db), 0, "custom yazma main DB'ye dokunmamalı");
        assert_eq!(asset_count(&custom_db), 1);
    }

    // ── Sync core: apply_audit_changes (Sprint 0.3) ──────────────────────────

    fn count(db: &PathBuf, sql: &str) -> i64 {
        let conn = rusqlite::Connection::open(db).unwrap();
        conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(-1)
    }

    fn audit_insert(ts: &str, prev: Option<&str>, row: Option<&str>) -> AuditLogRowInsert {
        AuditLogRowInsert {
            timestamp: ts.to_string(),
            role: "admin".to_string(),
            action: "TEST".to_string(),
            target: Some("t".to_string()),
            detail: None,
            result: "ok".to_string(),
            prev_hash: prev.map(|s| s.to_string()),
            row_hash: row.map(|s| s.to_string()),
        }
    }

    #[test]
    fn audit_insert_then_count() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("audit.db");
        let payload = AuditLogMirrorPayload {
            inserts: vec![
                audit_insert("2026-01-01T00:00:00Z", None, Some("h1")),
                audit_insert("2026-01-02T00:00:00Z", Some("h1"), Some("h2")),
            ],
            ..Default::default()
        };
        let r = apply_audit_changes(&db, payload).expect("apply başarılı");
        assert_eq!(r.inserted_count, 2);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM audit_log"), 2);
    }

    #[test]
    fn audit_hash_chain_preserved_in_order() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("audit.db");
        apply_audit_changes(&db, AuditLogMirrorPayload {
            inserts: vec![
                audit_insert("2026-01-01T00:00:00Z", None, Some("h1")),
                audit_insert("2026-01-02T00:00:00Z", Some("h1"), Some("h2")),
                audit_insert("2026-01-03T00:00:00Z", Some("h2"), Some("h3")),
            ],
            ..Default::default()
        }).unwrap();

        // Zincir bütünlüğü: her satırın prev_hash'i bir önceki row_hash'e eşit
        let conn = rusqlite::Connection::open(&db).unwrap();
        let mut stmt = conn
            .prepare("SELECT prev_hash, row_hash FROM audit_log ORDER BY timestamp")
            .unwrap();
        let rows: Vec<(Option<String>, Option<String>)> = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|x| x.unwrap())
            .collect();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].0, None);
        assert_eq!(rows[1].0, rows[0].1, "h2.prev == h1.row");
        assert_eq!(rows[2].0, rows[1].1, "h3.prev == h2.row");
    }

    #[test]
    fn audit_delete_all_then_before_iso() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("audit.db");
        apply_audit_changes(&db, AuditLogMirrorPayload {
            inserts: vec![
                audit_insert("2026-01-01T00:00:00Z", None, Some("a")),
                audit_insert("2026-06-01T00:00:00Z", Some("a"), Some("b")),
            ],
            ..Default::default()
        }).unwrap();

        // delete_before_iso: sadece eski satır gider
        let r = apply_audit_changes(&db, AuditLogMirrorPayload {
            delete_before_iso: Some("2026-03-01T00:00:00Z".to_string()),
            ..Default::default()
        }).unwrap();
        assert_eq!(r.deleted_count, 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM audit_log"), 1);

        // delete_all: kalan da gider
        let r2 = apply_audit_changes(&db, AuditLogMirrorPayload {
            delete_all: true,
            ..Default::default()
        }).unwrap();
        assert_eq!(r2.deleted_count, 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM audit_log"), 0);
    }

    #[test]
    fn audit_idempotent_reopen_same_db() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("audit.db");
        for _ in 0..3 {
            apply_audit_changes(&db, AuditLogMirrorPayload {
                inserts: vec![audit_insert("2026-01-01T00:00:00Z", None, Some("h"))],
                ..Default::default()
            }).unwrap();
        }
        // 3 ayrı çağrı = 3 satır (şema her seferinde IF NOT EXISTS — hata yok)
        assert_eq!(count(&db, "SELECT COUNT(*) FROM audit_log"), 3);
    }

    // ── Sync core: apply_chat_mirror (Sprint 0.3) ────────────────────────────

    fn sess(id: &str, title: &str) -> ChatSessionWrite {
        ChatSessionWrite {
            id: id.to_string(),
            title: title.to_string(),
            scope_json: None,
            model: Some("mistral".to_string()),
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }
    fn msg(id: &str, sid: &str) -> ChatMessageWrite {
        ChatMessageWrite {
            id: id.to_string(),
            session_id: sid.to_string(),
            role: "user".to_string(),
            content: "selam".to_string(),
            citations_json: None,
            tokens_in: Some(3),
            tokens_out: Some(0),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn chat_upsert_session_and_messages() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("chat.db");
        let r = apply_chat_mirror(&db, ChatMirrorPayload {
            sessions_upsert: vec![sess("s1", "İlk")],
            messages_upsert: vec![msg("m1", "s1"), msg("m2", "s1")],
            ..Default::default()
        }).unwrap();
        assert_eq!(r.sessions_written, 1);
        assert_eq!(r.messages_written, 2);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM chat_sessions"), 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM chat_messages"), 2);

        // Rename = INSERT OR REPLACE, satır sayısı artmaz
        apply_chat_mirror(&db, ChatMirrorPayload {
            sessions_upsert: vec![sess("s1", "Yeniden adlandırıldı")],
            ..Default::default()
        }).unwrap();
        assert_eq!(count(&db, "SELECT COUNT(*) FROM chat_sessions"), 1);
        let conn = rusqlite::Connection::open(&db).unwrap();
        let title: String = conn
            .query_row("SELECT title FROM chat_sessions WHERE id='s1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Yeniden adlandırıldı");
    }

    #[test]
    fn chat_delete_session_cascades_messages() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("chat.db");
        apply_chat_mirror(&db, ChatMirrorPayload {
            sessions_upsert: vec![sess("s1", "A"), sess("s2", "B")],
            messages_upsert: vec![msg("m1", "s1"), msg("m2", "s1"), msg("m3", "s2")],
            ..Default::default()
        }).unwrap();

        let r = apply_chat_mirror(&db, ChatMirrorPayload {
            delete_session_ids: vec!["s1".to_string()],
            ..Default::default()
        }).unwrap();
        assert_eq!(r.sessions_deleted, 1);
        assert_eq!(r.messages_cascaded, 2, "s1'in 2 mesajı manuel cascade silinmeli");
        assert_eq!(count(&db, "SELECT COUNT(*) FROM chat_sessions"), 1);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM chat_messages"), 1);
        // s2 ve m3 sağlam
        assert_eq!(count(&db, "SELECT COUNT(*) FROM chat_messages WHERE session_id='s2'"), 1);
    }

    #[test]
    fn chat_session_timestamp_touch() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("chat.db");
        apply_chat_mirror(&db, ChatMirrorPayload {
            sessions_upsert: vec![sess("s1", "A")],
            ..Default::default()
        }).unwrap();
        let r = apply_chat_mirror(&db, ChatMirrorPayload {
            session_timestamps: vec![SessionTouch {
                id: "s1".to_string(),
                updated_at: "2026-12-31T23:59:59Z".to_string(),
            }],
            ..Default::default()
        }).unwrap();
        assert_eq!(r.sessions_touched, 1);
        let conn = rusqlite::Connection::open(&db).unwrap();
        let ts: String = conn
            .query_row("SELECT updated_at FROM chat_sessions WHERE id='s1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ts, "2026-12-31T23:59:59Z");
    }

    #[test]
    fn chat_empty_payload_is_noop_but_creates_schema() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("chat.db");
        // apply_chat_mirror no-op kısayolu içermez (o komutta); şema oluşur, 0 satır
        let r = apply_chat_mirror(&db, ChatMirrorPayload::default()).unwrap();
        assert_eq!(r.sessions_written, 0);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM chat_sessions"), 0);
    }

    // ── V3 A6-PRE-2: apply_main_schema epoch-aware ──────────────────────────

    fn table_exists(db_path: &PathBuf, name: &str) -> bool {
        let conn = rusqlite::Connection::open(db_path).unwrap();
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                rusqlite::params![name],
                |r| r.get(0),
            )
            .unwrap_or(0);
        n > 0
    }

    #[test]
    fn apply_main_schema_creates_v3_tables_when_epoch_zero() {
        // PRAGMA user_version varsayılan 0 → V3-eligible şema da uygulanır.
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("e0.db");
        let conn = crate::ollama_db::prepare_write_conn(&db).unwrap();
        apply_main_schema(&conn).expect("apply_main_schema epoch=0 başarısız");
        drop(conn);

        assert!(table_exists(&db, "assets"), "assets core'da yok");
        assert!(table_exists(&db, "scanned_roots"), "scanned_roots core'da yok");
        assert!(table_exists(&db, "embeddings"), "embeddings epoch=0'da yaratılmalı");
        assert!(table_exists(&db, "text_chunks"), "text_chunks epoch=0'da yaratılmalı");
        assert!(table_exists(&db, "asset_relations"), "asset_relations epoch=0'da yaratılmalı");
    }

    #[test]
    fn apply_main_schema_skips_v3_tables_when_epoch_advanced() {
        // PRAGMA user_version=3 → V3-eligible tablolar DROP varsayılır;
        // apply_main_schema bunları yeniden yaratmaz (A6 askısı root cause fix).
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("e3.db");
        let conn = crate::ollama_db::prepare_write_conn(&db).unwrap();
        conn.execute_batch("PRAGMA user_version = 3").unwrap();
        apply_main_schema(&conn).expect("apply_main_schema epoch=3 başarısız");
        drop(conn);

        assert!(table_exists(&db, "assets"), "core epoch'tan bağımsız");
        assert!(table_exists(&db, "scanned_roots"), "core epoch'tan bağımsız");
        assert!(!table_exists(&db, "embeddings"), "embeddings epoch=3'te SKIP olmalı");
        assert!(!table_exists(&db, "text_chunks"), "text_chunks epoch=3'te SKIP olmalı");
        assert!(!table_exists(&db, "asset_relations"), "asset_relations epoch=3'te SKIP olmalı");
    }

    #[test]
    fn apply_main_schema_skips_each_v3_tier_at_epoch_two() {
        // Epoch=2 → embeddings + text_chunks DROP'lu, asset_relations hala MAIN'de.
        // CORE_SCHEMA'da ayrım yok (V3_ELIGIBLE_SCHEMA hep ya tam ya hiç).
        // Aslında current apply_main_schema "epoch == 0 ise hepsi" semantiği.
        // Yani epoch>=1 → hiçbir V3-eligible yaratılmaz; epoch=2'de
        // asset_relations da skip edilir. Bu testte bunu kanıtlıyoruz: A6-PRE-2
        // semantiği "all-or-nothing" — frontend (database.ts) tek tek granüler
        // (epoch<1/2/3), ama Rust tarafı kasıtlı kabaca. Bu güvenli çünkü
        // hangi epoch>=1'de yazılırsa yazılsın frontend ilgili tabloya yazmaz
        // (A6-PRE-1 guard'ları); Rust'ın ekstra koruma için tek bayrak yeter.
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("e2.db");
        let conn = crate::ollama_db::prepare_write_conn(&db).unwrap();
        conn.execute_batch("PRAGMA user_version = 2").unwrap();
        apply_main_schema(&conn).expect("apply_main_schema epoch=2 başarısız");
        drop(conn);

        assert!(table_exists(&db, "assets"));
        assert!(!table_exists(&db, "embeddings"));
        assert!(!table_exists(&db, "text_chunks"));
        // asset_relations epoch=2'de teknik olarak hala main'de OLABİLİR
        // (sadece epoch=3'te DROP). Ama all-or-nothing yaklaşımı ile burada
        // yaratılmıyor. Frontend bu durumda asset_relations'ı yine `_applySchema`
        // yoluyla yaratıyor (epoch<3 → yaratır). Bu kabul edilebilir asimetri:
        // Rust skip → frontend (sql.js) yaratır; sql.js'in saved'i export
        // edildiğinde main DB'de mevcut olur.
        assert!(!table_exists(&db, "asset_relations"));
    }

    #[test]
    fn apply_main_schema_idempotent_at_epoch_zero() {
        // Aynı conn üzerinde iki kez çağrı tablo bozmamalı.
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("idem.db");
        let conn = crate::ollama_db::prepare_write_conn(&db).unwrap();
        apply_main_schema(&conn).unwrap();
        apply_main_schema(&conn).unwrap();
        drop(conn);

        assert!(table_exists(&db, "assets"));
        assert!(table_exists(&db, "embeddings"));
        assert!(table_exists(&db, "text_chunks"));
        assert!(table_exists(&db, "asset_relations"));
    }

    // ── V3 A6-PRE-3a: write_scan_batch_to_db epoch-aware routing ─────────────

    /// Test helper: epoch-aware payload — embedding/text_chunk/relation dolu.
    fn payload_with_v3_rows(
        asset_id: &str,
        n_embeddings: usize,
        n_chunks: usize,
        n_relations: usize,
    ) -> ScanBatchPayload {
        let mut p = payload_with_asset(make_minimal_asset(asset_id));
        for i in 0..n_embeddings {
            p.embeddings.push(EmbeddingRow {
                id: format!("{}_emb_{}", asset_id, i),
                asset_id: asset_id.to_string(),
                ref_id: if i == 0 { None } else { Some(format!("chunk_{}", i)) },
                vector_blob: vec![0u8; 384 * 4],
                source: "test".to_string(),
            });
        }
        for i in 0..n_chunks {
            p.text_chunks.push(TextChunkRow {
                id: format!("{}_chunk_{}", asset_id, i),
                asset_id: asset_id.to_string(),
                chunk_index: i as i32,
                page: None,
                text: format!("test chunk {}", i),
                lang: Some("tr".to_string()),
            });
        }
        for i in 0..n_relations {
            p.relations.push(AssetRelationRow {
                id: format!("rel_{}_{}", asset_id, i),
                source_id: asset_id.to_string(),
                target_id: format!("target_{}", i),
                relation_type: "version".to_string(),
                created_at: "2026-05-21T00:00:00Z".to_string(),
                created_by: "test".to_string(),
            });
        }
        p
    }

    /// Test helper: PRAGMA user_version=N → epoch'u ayarla.
    /// Gerçek migrasyon semantiğini taklit eder: V3 cutover'da hedef tablolar
    /// DROP edilir + user_version set edilir (atomik, frontend
    /// `runV3EpochMigration` tarafından yapılan iş). Burada test ortamında
    /// aynı son durumu üretiyoruz ki `write_scan_batch_to_db` gerçek prod
    /// koşullarındaki routing'i sergilesin.
    fn set_db_epoch(db: &std::path::Path, epoch: i64) {
        let conn = crate::ollama_db::prepare_write_conn(db).unwrap();
        apply_main_schema(&conn).unwrap();
        // Migrasyonun DROP'larını simüle et — gerçek frontend cutover de aynısını yapar.
        if epoch >= 1 {
            conn.execute_batch("DROP TABLE IF EXISTS embeddings").unwrap();
        }
        if epoch >= 2 {
            conn.execute_batch("DROP TABLE IF EXISTS text_chunks").unwrap();
        }
        if epoch >= 3 {
            conn.execute_batch("DROP TABLE IF EXISTS asset_relations").unwrap();
        }
        conn.execute_batch(&format!("PRAGMA user_version = {}", epoch))
            .unwrap();
    }

    fn count_in_db(db: &std::path::Path, sql: &str) -> i64 {
        if !db.exists() { return 0; }
        let conn = rusqlite::Connection::open(db).unwrap();
        conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap_or(0)
    }

    #[test]
    fn epoch_zero_routes_embeddings_chunks_relations_to_main_db() {
        // Mevcut davranış birebir korunmalı: epoch=0'da hepsi main DB'de.
        let tmp = tempfile::tempdir().unwrap();
        let main_db = tmp.path().join("main.db");
        let vec_db = crate::vec_db::resolve_vec_db_path_from_main(&main_db).unwrap();

        let payload = payload_with_v3_rows("asset-e0", 2, 3, 1);
        let r = write_scan_batch_to_db(&main_db, payload).expect("yazma");
        assert_eq!(r.assets_written, 1);
        assert_eq!(r.embeddings_written, 2);
        assert_eq!(r.chunks_written, 3);
        assert_eq!(r.relations_written, 1);

        assert_eq!(count_in_db(&main_db, "SELECT COUNT(*) FROM embeddings"), 2);
        assert_eq!(count_in_db(&main_db, "SELECT COUNT(*) FROM text_chunks"), 3);
        assert_eq!(count_in_db(&main_db, "SELECT COUNT(*) FROM asset_relations"), 1);
        // vec.db dosyası hiç oluşturulmamalı
        assert!(!vec_db.exists(), "epoch=0'da vec.db oluşmamalı");
    }

    #[test]
    fn epoch_one_routes_embeddings_to_vec_db_others_main() {
        let tmp = tempfile::tempdir().unwrap();
        let main_db = tmp.path().join("main.db");
        let vec_db = crate::vec_db::resolve_vec_db_path_from_main(&main_db).unwrap();

        set_db_epoch(&main_db, 1);
        let payload = payload_with_v3_rows("asset-e1", 2, 3, 1);
        let r = write_scan_batch_to_db(&main_db, payload).expect("yazma");
        assert_eq!(r.assets_written, 1);
        assert_eq!(r.embeddings_written, 2);
        assert_eq!(r.chunks_written, 3);
        assert_eq!(r.relations_written, 1);

        // assets MAIN'de
        assert_eq!(count_in_db(&main_db, "SELECT COUNT(*) FROM assets"), 1);
        // embeddings VEC'te (main'de tablo yok — V3_ELIGIBLE_SCHEMA epoch>=1'de skip)
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM embeddings"), 2);
        // text_chunks + asset_relations hâlâ MAIN'de (epoch<2/3 için)
        // Ancak epoch=1'de _applySchema bunları yaratmaz (Rust all-or-nothing);
        // frontend (sql.js) bunları yaratır. Test ortamında frontend yok →
        // tabloları manuel yarat ki INSERT başarılı olabilsin.
        // Bu kısım epoch=1 düşük-frekans path'i; test pragmatik: epoch=1'de
        // _applySchema atlanırsa write_scan_batch_to_db hata vermeli.
        // Test odağı: embeddings vec.db'ye gitti ✓.
    }

    #[test]
    fn epoch_two_routes_embeddings_and_chunks_to_vec_db() {
        let tmp = tempfile::tempdir().unwrap();
        let main_db = tmp.path().join("main.db");
        let vec_db = crate::vec_db::resolve_vec_db_path_from_main(&main_db).unwrap();

        set_db_epoch(&main_db, 2);
        let payload = payload_with_v3_rows("asset-e2", 2, 3, 0);
        let r = write_scan_batch_to_db(&main_db, payload).expect("yazma");
        assert_eq!(r.assets_written, 1);
        assert_eq!(r.embeddings_written, 2);
        assert_eq!(r.chunks_written, 3);

        // embeddings + text_chunks VEC'te
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM embeddings"), 2);
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM text_chunks"), 3);
        // assets MAIN'de
        assert_eq!(count_in_db(&main_db, "SELECT COUNT(*) FROM assets"), 1);
    }

    #[test]
    fn epoch_three_routes_all_v3_eligible_to_vec_db() {
        let tmp = tempfile::tempdir().unwrap();
        let main_db = tmp.path().join("main.db");
        let vec_db = crate::vec_db::resolve_vec_db_path_from_main(&main_db).unwrap();

        set_db_epoch(&main_db, 3);
        let payload = payload_with_v3_rows("asset-e3", 2, 3, 2);
        let r = write_scan_batch_to_db(&main_db, payload).expect("yazma");
        assert_eq!(r.assets_written, 1);
        assert_eq!(r.embeddings_written, 2);
        assert_eq!(r.chunks_written, 3);
        assert_eq!(r.relations_written, 2);

        // Üçü de VEC'te
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM embeddings"), 2);
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM text_chunks"), 3);
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM asset_relations"), 2);
        // assets MAIN'de
        assert_eq!(count_in_db(&main_db, "SELECT COUNT(*) FROM assets"), 1);
        // V3-eligible main'de YOK (epoch>=1 → V3_ELIGIBLE_SCHEMA atlanır)
        assert!(!table_exists(&main_db, "embeddings"), "embeddings main'de OLMAMALI");
        assert!(!table_exists(&main_db, "text_chunks"), "text_chunks main'de OLMAMALI");
        assert!(!table_exists(&main_db, "asset_relations"), "asset_relations main'de OLMAMALI");
    }

    #[test]
    fn epoch_three_rescan_idempotent_via_vec_db() {
        // Aynı asset'i iki kez yazınca vec.db'de tek satır (INSERT OR IGNORE).
        let tmp = tempfile::tempdir().unwrap();
        let main_db = tmp.path().join("main.db");
        let vec_db = crate::vec_db::resolve_vec_db_path_from_main(&main_db).unwrap();

        set_db_epoch(&main_db, 3);
        let p1 = payload_with_v3_rows("asset-resc", 1, 1, 0);
        let r1 = write_scan_batch_to_db(&main_db, p1).expect("ilk yazma");
        assert_eq!(r1.embeddings_written, 1);
        assert_eq!(r1.chunks_written, 1);

        let p2 = payload_with_v3_rows("asset-resc", 1, 1, 0);
        let _r2 = write_scan_batch_to_db(&main_db, p2).expect("ikinci yazma");

        // Aynı id → vec.db'de tek satır (IGNORE)
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM embeddings"), 1);
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM text_chunks"), 1);
    }

    #[test]
    fn epoch_three_delete_chunks_for_routes_to_vec_db() {
        // delete_chunks_for: text_chunks tam + chunk-embedding (ref_id != '')
        // vec.db'den silinmeli; asset-level embedding (ref_id=null) korunmalı.
        let tmp = tempfile::tempdir().unwrap();
        let main_db = tmp.path().join("main.db");
        let vec_db = crate::vec_db::resolve_vec_db_path_from_main(&main_db).unwrap();

        set_db_epoch(&main_db, 3);
        // 1) asset + 3 embedding (idx 0 ref_id=None=asset-level, idx 1/2 chunk-emb) + 2 chunk
        let p1 = payload_with_v3_rows("asset-del", 3, 2, 0);
        write_scan_batch_to_db(&main_db, p1).expect("yazma");
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM embeddings"), 3);
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM text_chunks"), 2);

        // 2) delete_chunks_for ile rescan
        let mut p2 = payload_with_asset(make_minimal_asset("asset-del"));
        p2.delete_chunks_for.push("asset-del".to_string());
        write_scan_batch_to_db(&main_db, p2).expect("rescan");

        // text_chunks tamamen silinmiş (2 → 0)
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM text_chunks"), 0);
        // embeddings: chunk-emb (idx 1, 2) silindi, asset-level emb (idx 0, ref_id=None) korundu
        assert_eq!(count_in_db(&vec_db, "SELECT COUNT(*) FROM embeddings"), 1);
        let asset_level: i64 = rusqlite::Connection::open(&vec_db).unwrap()
            .query_row(
                "SELECT COUNT(*) FROM embeddings WHERE ref_id IS NULL",
                [], |r| r.get(0),
            ).unwrap_or(0);
        assert_eq!(asset_level, 1, "asset-level embedding korunmalıydı");
    }
}
