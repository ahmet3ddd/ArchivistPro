//! DWG/DXF geometric shape index — ayrı DB dosyası.
//!
//! `dwg_shapes` tablosu ana arşiv DB'sinden bağımsız bir dosyada (`*_shapes.db`)
//! tutulur. Sql.js (frontend) bu tabloyu hiç görmez — V8 heap'i şişirmesini önler.
//! Yazma + okuma + arama Rust rusqlite ile doğrudan disk üzerinde yapılır.

use std::path::PathBuf;
use serde::{Deserialize, Serialize};

/// Shape DB sema — `dwg_shapes` ana DB'dekiyle aynı yapıda, FK referansı YOK
/// (cross-database FK SQLite'ta desteklenmez; orphan temizliği manuel).
const SHAPES_ENSURE_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS dwg_shapes (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    layer_name TEXT,
    layer_category TEXT,
    entity_type TEXT,
    compactness REAL DEFAULT 0,
    solidity REAL DEFAULT 0,
    rectangularity REAL DEFAULT 0,
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
    indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dwg_shapes_asset_id ON dwg_shapes(asset_id);
CREATE INDEX IF NOT EXISTS idx_dwg_shapes_layer_cat ON dwg_shapes(layer_category) WHERE is_closed = 1;
";

/// Frontend `DxfShapeRaw` ile 1:1 eşleşir (camelCase yok — frontend snake_case gönderir).
#[derive(Deserialize)]
pub struct DxfShapeRaw {
    pub entity_type: String,
    pub layer_name: String,
    pub vertex_count: i32,
    pub is_closed: bool,
    pub area: f64,
    pub perimeter: f64,
    pub aspect_ratio: f64,
    pub regularity: f64,
    pub bbox_w: f64,
    pub bbox_h: f64,
    pub centroid_x: f64,
    pub centroid_y: f64,
    #[serde(default)]
    pub compactness: f64,
    #[serde(default)]
    pub solidity: f64,
    #[serde(default)]
    pub rectangularity: f64,
}

/// Ana arşiv DB path'inin yanında `_shapes.db` konumlu shape DB path'i.
///
/// - `archivist.db` → `archivist_shapes.db`
/// - `archivist_local.db` → `archivist_local_shapes.db`
/// - `D:/.../myarchive.db` → `D:/.../myarchive_shapes.db`
pub fn resolve_shapes_db_path(app: &tauri::AppHandle, archive_at: Option<&str>) -> Result<PathBuf, String> {
    let main_path = match archive_at {
        Some("local") => crate::ollama_db::resolve_local_db_path(app)?,
        Some(id) if id != "main" && !id.is_empty() => crate::ollama_db::resolve_archive_path(app, id)?,
        _ => crate::ollama_db::resolve_db_path(app)?,
    };

    let parent = main_path.parent().ok_or("Geçersiz ana DB path")?;
    let stem = main_path.file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Geçersiz ana DB dosya adı")?;
    let shapes_name = format!("{}_shapes.db", stem);
    Ok(parent.join(shapes_name))
}

/// Layer adından kategori türet — frontend `categorizeLayerForShape` ile aynı.
pub fn categorize_layer(layer_name: &str) -> String {
    let upper = layer_name.to_uppercase();
    let patterns: &[(&[&str], &str)] = &[
        (&["HAVUZ", "POOL", "BASIN"], "HAVUZ"),
        (&["DUVAR", "WALL", "MURO"], "DUVAR"),
        (&["KAPI", "DOOR", "PORTA"], "KAPI"),
        (&["PENCERE", "WINDOW", "CAM"], "PENCERE"),
        (&["KOLON", "COLUMN"], "KOLON"),
        (&["KIRIS", "KIRIŞ", "BEAM"], "KIRIS"),
        (&["MERDIVEN", "MERDİVEN", "STAIR"], "MERDIVEN"),
        (&["DOSEME", "DÖŞEME", "SLAB", "FLOOR"], "DOSEME"),
        (&["CATI", "ÇATI", "ROOF"], "CATI"),
    ];
    for (keys, cat) in patterns {
        for k in *keys {
            if upper.contains(k) {
                return (*cat).to_string();
            }
        }
    }
    "DIGER".to_string()
}

/// Shape DB bağlantısı aç (yoksa oluştur, sema apply et).
/// WAL mode: paralel taramada concurrency=3 invoke'u serileştirmeden geçmesi için.
/// synchronous=NORMAL: fsync azaltır (WAL ile birlikte güvenli — checkpoint'te flush'lanır).
pub fn open_shapes_db(path: &PathBuf) -> Result<rusqlite::Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Shape DB dizini oluşturulamadı: {}", e))?;
    }
    let conn = rusqlite::Connection::open(path)
        .map_err(|e| format!("Shape DB açılamadı: {}", e))?;
    // PRAGMA hataları yutulur — bazı sistemlerde WAL desteklenmeyebilir (örn. read-only fs)
    let _ = conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;");
    conn.execute_batch(SHAPES_ENSURE_SCHEMA)
        .map_err(|e| format!("Shape sema apply hatası: {}", e))?;
    Ok(conn)
}

// ── Tauri Komutları ────────────────────────────────────────────────────────

/// Shape DB'yi başlat — dosya yoksa oluştur, sema apply et, eski backup varsa
/// migrate et. Frontend startup'ta çağrılır.
#[tauri::command]
pub async fn init_shapes_db(
    app: tauri::AppHandle,
    archive_at: Option<String>,
) -> Result<(), String> {
    let shapes_path = resolve_shapes_db_path(&app, archive_at.as_deref())?;
    let archive_id = archive_at.as_deref().unwrap_or("main").to_string();

    tauri::async_runtime::spawn_blocking(move || {
        // 1. Migration: AppData'daki backup dosyası varsa → shapes DB'ye taşı
        if !shapes_path.exists() {
            let app_data = shapes_path.parent().ok_or("Geçersiz path")?.to_path_buf();
            let backup_tag = match archive_id.as_str() {
                "local" => "local".to_string(),
                "main" => "main".to_string(),
                other => other.to_string(),
            };
            let backup_path = app_data.join(format!("archivist_shapes_backup_{}.db", backup_tag));
            if backup_path.exists() {
                std::fs::copy(&backup_path, &shapes_path)
                    .map_err(|e| format!("Backup migration kopyalama hatası: {}", e))?;
            }
        }

        // 2. Sema apply (dosya oluşturulur veya açılır)
        let _conn = open_shapes_db(&shapes_path)?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Belirli bir asset için shape'leri toplu yaz — eski kayıtlar silinir.
/// `archive_at`: None/main = ana, "local" = yerel, diğer = custom.
#[tauri::command]
pub async fn persist_dwg_shapes(
    app: tauri::AppHandle,
    asset_id: String,
    shapes: Vec<DxfShapeRaw>,
    archive_at: Option<String>,
) -> Result<usize, String> {
    let shapes_path = resolve_shapes_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        persist_shapes_at(&shapes_path, &asset_id, &shapes)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// `persist_dwg_shapes`'in saf çekirdeği — AppHandle gerektirmez, doğrudan
/// shapes DB path'i alır. Eski kayıtlar silinir, yenileri tek TX'te yazılır.
/// Test edilebilir (`shapes_db.rs` rusqlite-only deseni; V3-2 referansı).
pub(crate) fn persist_shapes_at(
    shapes_path: &std::path::Path,
    asset_id: &str,
    shapes: &[DxfShapeRaw],
) -> Result<usize, String> {
    let mut conn = open_shapes_db(&shapes_path.to_path_buf())?;
    let tx = conn.transaction().map_err(|e| format!("TX başlatılamadı: {}", e))?;

    // Eski kayıtları sil
    tx.execute("DELETE FROM dwg_shapes WHERE asset_id = ?1", rusqlite::params![asset_id])
        .map_err(|e| format!("Eski shape silme hatası: {}", e))?;

    if shapes.is_empty() {
        tx.commit().map_err(|e| format!("TX commit hatası: {}", e))?;
        return Ok(0usize);
    }

    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO dwg_shapes
             (id, asset_id, layer_name, layer_category, entity_type,
              vertex_count, is_closed, area, perimeter, aspect_ratio, regularity,
              bbox_w, bbox_h, centroid_x, centroid_y,
              compactness, solidity, rectangularity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)"
        ).map_err(|e| format!("INSERT prepare hatası: {}", e))?;

        for (idx, s) in shapes.iter().enumerate() {
            let id = format!("{}:{}", asset_id, idx);
            let category = categorize_layer(&s.layer_name);
            let layer = if s.layer_name.is_empty() { "0".to_string() } else { s.layer_name.clone() };
            stmt.execute(rusqlite::params![
                id, asset_id,
                layer, category, s.entity_type,
                s.vertex_count, s.is_closed as i32,
                s.area, s.perimeter, s.aspect_ratio, s.regularity,
                s.bbox_w, s.bbox_h, s.centroid_x, s.centroid_y,
                s.compactness, s.solidity, s.rectangularity,
            ]).map_err(|e| format!("INSERT hatası: {}", e))?;
        }
    }

    let count = shapes.len();
    tx.commit().map_err(|e| format!("TX commit hatası: {}", e))?;
    Ok(count)
}

/// Bir asset için shape entry — batch'te kullanılır.
#[derive(Deserialize)]
pub struct ShapeBatchEntry {
    pub asset_id: String,
    pub shapes: Vec<DxfShapeRaw>,
}

/// Birden fazla asset'in shape'lerini tek tx içinde yaz. Eski kayıtlar her asset için silinir.
/// Tarama writeBuffer checkpoint'lerinde çağrılır — asset başına ayrı tx maliyetini elimine eder.
#[tauri::command]
pub async fn persist_dwg_shapes_batch(
    app: tauri::AppHandle,
    entries: Vec<ShapeBatchEntry>,
    archive_at: Option<String>,
) -> Result<usize, String> {
    if entries.is_empty() {
        return Ok(0);
    }
    let shapes_path = resolve_shapes_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = open_shapes_db(&shapes_path)?;
        let tx = conn.transaction().map_err(|e| format!("TX başlatılamadı: {}", e))?;

        let mut total = 0usize;
        {
            let mut del = tx.prepare_cached("DELETE FROM dwg_shapes WHERE asset_id = ?1")
                .map_err(|e| format!("DEL prepare hatası: {}", e))?;
            let mut ins = tx.prepare_cached(
                "INSERT INTO dwg_shapes
                 (id, asset_id, layer_name, layer_category, entity_type,
                  vertex_count, is_closed, area, perimeter, aspect_ratio, regularity,
                  bbox_w, bbox_h, centroid_x, centroid_y,
                  compactness, solidity, rectangularity)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)"
            ).map_err(|e| format!("INS prepare hatası: {}", e))?;

            for entry in &entries {
                del.execute(rusqlite::params![&entry.asset_id])
                    .map_err(|e| format!("DEL hatası: {}", e))?;

                for (idx, s) in entry.shapes.iter().enumerate() {
                    let id = format!("{}:{}", entry.asset_id, idx);
                    let category = categorize_layer(&s.layer_name);
                    let layer = if s.layer_name.is_empty() { "0".to_string() } else { s.layer_name.clone() };
                    ins.execute(rusqlite::params![
                        id, entry.asset_id,
                        layer, category, s.entity_type,
                        s.vertex_count, s.is_closed as i32,
                        s.area, s.perimeter, s.aspect_ratio, s.regularity,
                        s.bbox_w, s.bbox_h, s.centroid_x, s.centroid_y,
                        s.compactness, s.solidity, s.rectangularity,
                    ]).map_err(|e| format!("INS hatası: {}", e))?;
                    total += 1;
                }
            }
        }

        tx.commit().map_err(|e| format!("TX commit hatası: {}", e))?;
        Ok(total)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Asset'in tüm shape'lerini sil.
#[tauri::command]
pub async fn delete_dwg_shapes(
    app: tauri::AppHandle,
    asset_id: String,
    archive_at: Option<String>,
) -> Result<usize, String> {
    let shapes_path = resolve_shapes_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_shapes_db(&shapes_path)?;
        let n = conn.execute("DELETE FROM dwg_shapes WHERE asset_id = ?1", rusqlite::params![&asset_id])
            .map_err(|e| format!("Shape silme hatası: {}", e))?;
        Ok(n)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// `needsShapeReindex` desteği — asset için en son indexed_at'i döndürür.
/// None → henüz indexlenmemiş.
#[tauri::command]
pub async fn query_dwg_shape_max_indexed(
    app: tauri::AppHandle,
    asset_id: String,
    archive_at: Option<String>,
) -> Result<Option<String>, String> {
    let shapes_path = resolve_shapes_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_shapes_db(&shapes_path)?;
        let result: Option<String> = conn.query_row(
            "SELECT MAX(indexed_at) FROM dwg_shapes WHERE asset_id = ?1",
            rusqlite::params![&asset_id],
            |row| row.get(0),
        ).optional().map_err(|e| format!("Query hatası: {}", e))?;
        Ok(result)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Tüm shape index'i temizle.
#[tauri::command]
pub async fn clear_all_dwg_shapes(
    app: tauri::AppHandle,
    archive_at: Option<String>,
) -> Result<usize, String> {
    let shapes_path = resolve_shapes_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_shapes_db(&shapes_path)?;
        let n = conn.execute("DELETE FROM dwg_shapes", [])
            .map_err(|e| format!("Shape clear hatası: {}", e))?;
        // VACUUM eşzamanlı yapılmaz (lock) — kullanıcı isterse manuel
        Ok(n)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Asset için shape istatistikleri (UI badge/ön izleme için).
#[derive(Serialize)]
pub struct ShapeStats {
    pub total: i64,
    pub closed_count: i64,
}

#[tauri::command]
pub async fn get_dwg_shape_stats(
    app: tauri::AppHandle,
    asset_id: String,
    archive_at: Option<String>,
) -> Result<ShapeStats, String> {
    let shapes_path = resolve_shapes_db_path(&app, archive_at.as_deref())?;

    tauri::async_runtime::spawn_blocking(move || {
        let conn = open_shapes_db(&shapes_path)?;
        let total: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dwg_shapes WHERE asset_id = ?1",
            rusqlite::params![&asset_id],
            |row| row.get(0),
        ).unwrap_or(0);
        let closed_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dwg_shapes WHERE asset_id = ?1 AND is_closed = 1",
            rusqlite::params![&asset_id],
            |row| row.get(0),
        ).unwrap_or(0);
        Ok(ShapeStats { total, closed_count })
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// rusqlite OptionalExtension trait için
use rusqlite::OptionalExtension;

// ═══════════════════════════════════════════════════════════════════════════════
// Tests (Sprint 0.3 — persist_shapes_at sync core; V3-2 referans deseni)
// ═══════════════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(layer: &str, etype: &str) -> DxfShapeRaw {
        DxfShapeRaw {
            entity_type: etype.to_string(),
            layer_name: layer.to_string(),
            vertex_count: 4,
            is_closed: true,
            area: 10.0,
            perimeter: 12.0,
            aspect_ratio: 1.0,
            regularity: 0.9,
            bbox_w: 3.0,
            bbox_h: 3.0,
            centroid_x: 1.5,
            centroid_y: 1.5,
            compactness: 0.8,
            solidity: 0.95,
            rectangularity: 0.99,
        }
    }

    fn shape_count(db: &std::path::Path) -> i64 {
        let conn = rusqlite::Connection::open(db).unwrap();
        conn.query_row("SELECT COUNT(*) FROM dwg_shapes", [], |r| r.get(0))
            .unwrap_or(-1)
    }

    #[test]
    fn persist_then_count() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("a_shapes.db");
        let n = persist_shapes_at(&db, "asset-1", &[shape("DUVAR", "LWPOLYLINE"), shape("KAPI", "LINE")])
            .expect("persist başarılı");
        assert_eq!(n, 2);
        assert_eq!(shape_count(&db), 2);
    }

    #[test]
    fn persist_empty_clears_existing_for_asset() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("a_shapes.db");
        persist_shapes_at(&db, "asset-1", &[shape("L", "LINE"), shape("L", "LINE")]).unwrap();
        assert_eq!(shape_count(&db), 2);
        // Boş persist = sadece o asset'in eski kayıtlarını sil
        let n = persist_shapes_at(&db, "asset-1", &[]).unwrap();
        assert_eq!(n, 0);
        assert_eq!(shape_count(&db), 0);
    }

    #[test]
    fn persist_replaces_old_records_for_same_asset() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("a_shapes.db");
        persist_shapes_at(&db, "asset-1", &[shape("L", "LINE"), shape("L", "LINE"), shape("L", "LINE")]).unwrap();
        assert_eq!(shape_count(&db), 3);
        // Yeniden persist = eski 3 silinir, yeni 1 yazılır (idempotent değil — replace)
        persist_shapes_at(&db, "asset-1", &[shape("YENI", "ARC")]).unwrap();
        assert_eq!(shape_count(&db), 1);
        let conn = rusqlite::Connection::open(&db).unwrap();
        let layer: String = conn
            .query_row("SELECT layer_name FROM dwg_shapes WHERE asset_id='asset-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(layer, "YENI");
    }

    #[test]
    fn persist_different_assets_coexist() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("a_shapes.db");
        persist_shapes_at(&db, "asset-1", &[shape("L", "LINE")]).unwrap();
        persist_shapes_at(&db, "asset-2", &[shape("L", "LINE"), shape("L", "LINE")]).unwrap();
        assert_eq!(shape_count(&db), 3);
        // asset-1 yeniden persist → sadece asset-1 etkilenir, asset-2 sağlam
        persist_shapes_at(&db, "asset-1", &[]).unwrap();
        assert_eq!(shape_count(&db), 2);
        let conn = rusqlite::Connection::open(&db).unwrap();
        let a2: i64 = conn
            .query_row("SELECT COUNT(*) FROM dwg_shapes WHERE asset_id='asset-2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(a2, 2);
    }

    #[test]
    fn persist_separate_db_files_are_isolated() {
        let tmp = tempfile::tempdir().unwrap();
        let main_db = tmp.path().join("archivist_shapes.db");
        let local_db = tmp.path().join("archivist_local_shapes.db");
        persist_shapes_at(&main_db, "asset-1", &[shape("L", "LINE")]).unwrap();
        persist_shapes_at(&local_db, "asset-2", &[shape("L", "LINE"), shape("L", "LINE")]).unwrap();
        // Çoklu-arşiv izolasyonu: her DB sadece kendi verisini içerir
        assert_eq!(shape_count(&main_db), 1);
        assert_eq!(shape_count(&local_db), 2);
        let conn = rusqlite::Connection::open(&main_db).unwrap();
        let leaked: i64 = conn
            .query_row("SELECT COUNT(*) FROM dwg_shapes WHERE asset_id='asset-2'", [], |r| r.get(0))
            .unwrap_or(0);
        assert_eq!(leaked, 0, "asset-2 main shapes DB'ye sızmamalı");
    }
}
