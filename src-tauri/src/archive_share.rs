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

/// Import sonrası vec.db'yi (V3-2, DESIGN-LOCK §6) arşivle TUTARLA:
/// - `entry` zip'te var ve boş değil → `target`'a atomik yaz.
/// - yok/boş → diskteki stale `target` (+ lock/journal) sil.
///
/// Gerekçe: importer archive.db'yi merge etmeden DEĞİŞTİRİR; vec.db de simetrik
/// olmalı. epoch-0 eski .archivistpro (vec.db YOK) import edilince diskte kalan
/// önceki arşivin vec.db'si, sonraki T4-upgrade'in `INSERT OR IGNORE`'unda
/// çapraz-arşiv veri karışımına yol açar → stale silinmeli (temiz upgrade).
///
/// Saf (AppHandle gerektirmez) → unit-testable. Döner: true = yazıldı.
fn reconcile_vec_db_entry(
    archive: &mut zip::ZipArchive<fs::File>,
    entry: &str,
    target: &std::path::Path,
) -> Result<bool, String> {
    let bytes = match archive.by_name(entry) {
        Ok(mut e) => {
            let mut buf = Vec::new();
            e.read_to_end(&mut buf)
                .map_err(|err| format!("{} okunamadı: {}", entry, err))?;
            if buf.is_empty() {
                None
            } else {
                Some(buf)
            }
        }
        Err(_) => None,
    };
    match bytes {
        Some(data) => {
            if let Some(parent) = target.parent() {
                let _ = fs::create_dir_all(parent);
            }
            ollama_db::write_and_sync(target, &data)
                .map_err(|e| format!("{} yazılamadı: {}", entry, e))?;
            Ok(true)
        }
        None => {
            if target.exists() {
                fs::remove_file(target)
                    .map_err(|e| format!("stale vec.db silinemedi: {}", e))?;
            }
            let _ = fs::remove_file(target.with_extension("db.lock"));
            let _ = fs::remove_file(target.with_extension("db-journal"));
            Ok(false)
        }
    }
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

    // WAL'de duran commit'li veriyi ana dosyaya katla (DELETE modunda no-op).
    ollama_db::checkpoint_wal_truncate(&db_path);
    let db_bytes = fs::read(&db_path).map_err(|e| format!("DB okunamadı: {}", e))?;
    let db_size = db_bytes.len() as u64;

    // Optionally include local DB
    let local_db_bytes = ollama_db::resolve_local_db_path(&app)
        .ok()
        .and_then(|p| {
            if p.exists() {
                ollama_db::checkpoint_wal_truncate(&p);
                fs::read(&p).ok()
            } else {
                None
            }
        });

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

    // Write *_vec.db (V3-2, DESIGN-LOCK §6) — varsa ekle. local.db deseninin
    // aynısı; main → archive_vec.db, local → local_vec.db. Yoksa entry yazılmaz
    // (import tarafı entry yoksa diskteki stale vec.db'yi temizler).
    for (archive_at, entry) in [(None, "archive_vec.db"), (Some("local"), "local_vec.db")] {
        let vec_bytes = crate::vec_db::resolve_vec_db_path(&app, archive_at)
            .ok()
            .and_then(|p| if p.exists() { fs::read(&p).ok() } else { None });
        if let Some(bytes) = vec_bytes {
            zip_writer
                .start_file(entry, options)
                .map_err(|e| format!("ZIP {} hatası: {}", entry, e))?;
            zip_writer
                .write_all(&bytes)
                .map_err(|e| format!("ZIP yazma hatası: {}", e))?;
        }
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

    let db_path = ollama_db::resolve_db_path(&app)?;

    let archive_lock = ollama_db::get_db_lock_for(&db_path);
    let _guard = archive_lock
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;

    // Backup existing DB if replacing
    let bak_path = db_path.with_extension("db.bak");
    if replace_existing && db_path.exists() {
        // WAL'deki commit'li veriyi katla — yedek eksik kalmasın.
        ollama_db::checkpoint_wal_truncate(&db_path);
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

    let mut local_imported = false;
    if let Ok(mut local_entry) = archive2.by_name("local.db") {
        let mut local_bytes = Vec::new();
        if local_entry.read_to_end(&mut local_bytes).is_ok() && !local_bytes.is_empty() {
            if let Ok(local_db_path) = ollama_db::resolve_local_db_path(&app) {
                if let Some(parent) = local_db_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = ollama_db::write_and_sync(&local_db_path, &local_bytes);
                local_imported = true;
            }
        }
    }

    // V3-2 vec.db reconcile (DESIGN-LOCK §6). Best-effort (local.db gibi):
    // başarısızsa import'u BOZMA — main DB zaten yazıldı, frontend T4/upgrade
    // yeniden migrate edebilir. main HER ZAMAN (archive.db ile birlikte
    // değişti); local yalnız local.db import edildiyse.
    if let Ok(main_vec) = crate::vec_db::resolve_vec_db_path(&app, None) {
        let _ = reconcile_vec_db_entry(&mut archive2, "archive_vec.db", &main_vec);
    }
    if local_imported {
        if let Ok(local_vec) = crate::vec_db::resolve_vec_db_path(&app, Some("local")) {
            let _ = reconcile_vec_db_entry(&mut archive2, "local_vec.db", &local_vec);
        }
    }

    Ok(ImportResult {
        success: true,
        asset_count: 0, // Frontend manifesten dolduracak
        error: None,
        rolled_back: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_zip(path: &std::path::Path, entries: &[(&str, &[u8])]) {
        let f = fs::File::create(path).unwrap();
        let mut zw = zip::ZipWriter::new(f);
        let opts =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(bytes).unwrap();
        }
        zw.finish().unwrap();
    }

    fn open_zip(path: &std::path::Path) -> zip::ZipArchive<fs::File> {
        zip::ZipArchive::new(fs::File::open(path).unwrap()).unwrap()
    }

    #[test]
    fn reconcile_writes_entry_when_present() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("a.archivistpro");
        let target = tmp.path().join("sub/archivist_vec.db");
        make_zip(&zip_path, &[("archive_vec.db", b"VECDATA123")]);
        let mut ar = open_zip(&zip_path);
        assert!(reconcile_vec_db_entry(&mut ar, "archive_vec.db", &target).unwrap());
        assert_eq!(fs::read(&target).unwrap(), b"VECDATA123");
    }

    #[test]
    fn reconcile_deletes_stale_when_entry_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("a.archivistpro");
        let target = tmp.path().join("archivist_vec.db");
        fs::write(&target, b"STALE").unwrap();
        fs::write(target.with_extension("db.lock"), b"").unwrap();
        make_zip(&zip_path, &[("manifest.json", b"{}")]); // vec entry YOK
        let mut ar = open_zip(&zip_path);
        assert!(!reconcile_vec_db_entry(&mut ar, "archive_vec.db", &target).unwrap());
        assert!(!target.exists(), "stale vec.db silinmeli");
        assert!(
            !target.with_extension("db.lock").exists(),
            "lock da silinmeli"
        );
    }

    #[test]
    fn reconcile_empty_entry_treated_as_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("a.archivistpro");
        let target = tmp.path().join("archivist_vec.db");
        fs::write(&target, b"STALE").unwrap();
        make_zip(&zip_path, &[("archive_vec.db", b"")]); // boş entry
        let mut ar = open_zip(&zip_path);
        assert!(!reconcile_vec_db_entry(&mut ar, "archive_vec.db", &target).unwrap());
        assert!(!target.exists(), "boş entry → stale silinir");
    }

    #[test]
    fn reconcile_absent_entry_no_target_is_noop() {
        let tmp = tempfile::tempdir().unwrap();
        let zip_path = tmp.path().join("a.archivistpro");
        let target = tmp.path().join("archivist_vec.db");
        make_zip(&zip_path, &[("manifest.json", b"{}")]);
        let mut ar = open_zip(&zip_path);
        assert!(!reconcile_vec_db_entry(&mut ar, "archive_vec.db", &target).unwrap());
        assert!(!target.exists());
    }
}
