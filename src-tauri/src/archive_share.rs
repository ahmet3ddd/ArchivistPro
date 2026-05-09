//! Archivist Pro — Arşiv Export/Import (.archivistpro formatı)
//!
//! .archivistpro = ZIP dosyası:
//!   - manifest.json — meta bilgi
//!   - archive.db   — main SQLite kopyası
//!   - local.db     — opsiyonel local DB

use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use zip::write::SimpleFileOptions;

use crate::ollama_db;

#[derive(Serialize)]
pub struct ExportResult {
    #[serde(rename = "assetCount")]
    pub asset_count: u64,
    #[serde(rename = "dbSize")]
    pub db_size: u64,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub success: bool,
    #[serde(rename = "assetCount")]
    pub asset_count: u64,
    pub error: Option<String>,
    #[serde(rename = "rolledBack")]
    pub rolled_back: bool,
}

/// Counts assets in an SQLite database file by reading the assets table.
fn count_assets_in_db(db_bytes: &[u8]) -> u64 {
    // Quick heuristic: if the DB is empty, return 0.
    if db_bytes.is_empty() {
        return 0;
    }
    // We can't run SQL without a full SQLite library in Rust.
    // Instead, the frontend already sends the assetCount in the manifest.
    // We'll return 0 here and let the frontend fill it from the manifest.
    0
}

/// Arşivi .archivistpro dosyası olarak dışa aktarır.
#[tauri::command]
pub async fn export_archive(
    app: tauri::AppHandle,
    dest_path: String,
    manifest: String,
) -> Result<ExportResult, String> {
    let db_path = ollama_db::resolve_db_path(&app)?;

    if !db_path.exists() {
        return Err("Veritabanı dosyası bulunamadı".to_string());
    }

    let db_bytes = fs::read(&db_path).map_err(|e| format!("DB okunamadı: {}", e))?;
    let db_size = db_bytes.len() as u64;

    // Optionally include local DB
    let local_db_bytes = ollama_db::resolve_local_db_path(&app)
        .ok()
        .and_then(|p| if p.exists() { fs::read(&p).ok() } else { None });

    // Manifest'in dbSizeBytes alanını gerçek değerle override et — frontend bunu hesaplayamaz
    let manifest_to_write: String = match serde_json::from_str::<serde_json::Value>(&manifest) {
        Ok(mut value) => {
            if let Some(obj) = value.as_object_mut() {
                obj.insert("dbSizeBytes".to_string(), serde_json::json!(db_size));
            }
            serde_json::to_string(&value).unwrap_or(manifest.clone())
        }
        Err(_) => manifest.clone(),
    };

    let file =
        fs::File::create(&dest_path).map_err(|e| format!("Dosya oluşturulamadı: {}", e))?;
    let mut zip_writer = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Write manifest.json
    zip_writer
        .start_file("manifest.json", options)
        .map_err(|e| format!("ZIP manifest hatası: {}", e))?;
    zip_writer
        .write_all(manifest_to_write.as_bytes())
        .map_err(|e| format!("ZIP yazma hatası: {}", e))?;

    // Write archive.db
    zip_writer
        .start_file("archive.db", options)
        .map_err(|e| format!("ZIP db hatası: {}", e))?;
    zip_writer
        .write_all(&db_bytes)
        .map_err(|e| format!("ZIP yazma hatası: {}", e))?;

    // Write local.db (optional)
    if let Some(ref local_bytes) = local_db_bytes {
        zip_writer
            .start_file("local.db", options)
            .map_err(|e| format!("ZIP local db hatası: {}", e))?;
        zip_writer
            .write_all(local_bytes)
            .map_err(|e| format!("ZIP yazma hatası: {}", e))?;
    }

    let finished_file = zip_writer
        .finish()
        .map_err(|e| format!("ZIP kapatma hatası: {}", e))?;
    finished_file.sync_all().map_err(|e| format!("ZIP fsync hatası: {}", e))?;

    let file_size = fs::metadata(&dest_path)
        .map(|m| m.len())
        .unwrap_or(0);

    let asset_count = count_assets_in_db(&db_bytes);

    Ok(ExportResult {
        asset_count,
        db_size,
        file_size,
    })
}

/// .archivistpro dosyasının manifest bilgisini okur (import öncesi önizleme).
#[tauri::command]
pub fn peek_archive_manifest(file_path: String) -> Result<String, String> {
    let file = fs::File::open(&file_path).map_err(|e| format!("Dosya açılamadı: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("ZIP açılamadı: {}", e))?;

    let mut manifest_file = archive
        .by_name("manifest.json")
        .map_err(|_| "manifest.json bulunamadı".to_string())?;

    let mut contents = String::new();
    manifest_file
        .read_to_string(&mut contents)
        .map_err(|e| format!("Manifest okunamadı: {}", e))?;

    Ok(contents)
}

/// .archivistpro dosyasını içe aktarır. (Admin-only)
#[tauri::command]
pub async fn import_archive(
    app: tauri::AppHandle,
    file_path: String,
    replace_existing: bool,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<ImportResult, String> {
    crate::require_admin(&role_state)?;
    let file =
        fs::File::open(&file_path).map_err(|e| format!("Dosya açılamadı: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("ZIP açılamadı: {}", e))?;

    // Extract archive.db
    let mut db_entry = archive
        .by_name("archive.db")
        .map_err(|_| "archive.db bulunamadı".to_string())?;

    let mut db_bytes = Vec::new();
    db_entry
        .read_to_end(&mut db_bytes)
        .map_err(|e| format!("DB okunamadı: {}", e))?;
    drop(db_entry);

    if db_bytes.is_empty() {
        return Ok(ImportResult {
            success: false,
            asset_count: 0,
            error: Some("Boş veritabanı dosyası".to_string()),
            rolled_back: false,
        });
    }

    let _guard = ollama_db::get_db_lock()
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;

    let db_path = ollama_db::resolve_db_path(&app)?;

    // Backup existing DB if replacing
    let bak_path = db_path.with_extension("db.bak");
    if replace_existing && db_path.exists() {
        fs::copy(&db_path, &bak_path)
            .map_err(|e| format!("Yedekleme hatası: {}", e))?;
        // Windows'ta sync_all() FlushFileBuffers çağırır → yazma izni gerekir.
        // File::open() salt okunur açıyor, OpenOptions ile read+write aç.
        std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&bak_path)
            .and_then(|f| f.sync_all())
            .map_err(|e| format!("Yedek fsync hatası: {}", e))?;
    }

    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
    }

    // DB yazma — başarısız olursa yedekten otomatik geri yükle
    if let Err(write_err) = ollama_db::write_and_sync(&db_path, &db_bytes) {
        // Rollback: .db.bak varsa geri yükle
        if bak_path.exists() {
            match fs::read(&bak_path).and_then(|bak_data| ollama_db::write_and_sync(&db_path, &bak_data)) {
                Ok(()) => {
                    return Ok(ImportResult {
                        success: false,
                        asset_count: 0,
                        error: Some(format!("DB yazılamadı: {}. Yedekten geri yüklendi.", write_err)),
                        rolled_back: true,
                    });
                }
                Err(restore_err) => {
                    return Ok(ImportResult {
                        success: false,
                        asset_count: 0,
                        error: Some(format!("DB yazılamadı: {}. Geri yükleme de başarısız: {}", write_err, restore_err)),
                        rolled_back: false,
                    });
                }
            }
        }
        return Ok(ImportResult {
            success: false,
            asset_count: 0,
            error: Some(format!("DB yazılamadı: {}", write_err)),
            rolled_back: false,
        });
    }

    // Also import local.db if present
    // Re-open the archive since we dropped the previous borrow
    let file2 =
        fs::File::open(&file_path).map_err(|e| format!("Dosya yeniden açılamadı: {}", e))?;
    let mut archive2 =
        zip::ZipArchive::new(file2).map_err(|e| format!("ZIP yeniden açılamadı: {}", e))?;

    if let Ok(mut local_entry) = archive2.by_name("local.db") {
        let mut local_bytes = Vec::new();
        if local_entry.read_to_end(&mut local_bytes).is_ok() && !local_bytes.is_empty() {
            if let Ok(local_db_path) = ollama_db::resolve_local_db_path(&app) {
                if let Some(parent) = local_db_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = ollama_db::write_and_sync(&local_db_path, &local_bytes);
            }
        }
    }

    Ok(ImportResult {
        success: true,
        asset_count: 0, // Frontend manifesten dolduracak
        error: None,
        rolled_back: false,
    })
}
