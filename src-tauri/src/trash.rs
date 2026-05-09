// Archivist Pro — Çöp Kutusu Komutları
//
// Dosyaları .archivistpro-trash/ klasörüne taşır, geri yükler ve temizler.
// Frontend trash.ts ile eşleşen 5 Tauri komutu içerir.
//
// Çöp kutusu yapısı:
//   <trashDir>/
//     {timestamp}_{orijinal_dosya_adı}   — taşınan dosya
//     _manifest.json                     — orijinal yol eşlemeleri

use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

/* ── Yardımcılar ── */

fn trash_dir_path(trash_dir: &str) -> PathBuf {
    PathBuf::from(trash_dir)
}

fn manifest_path(trash_dir: &str) -> PathBuf {
    trash_dir_path(trash_dir).join("_manifest.json")
}

fn ensure_trash_dir(trash_dir: &str) -> Result<(), String> {
    let path = trash_dir_path(trash_dir);
    if !path.exists() {
        fs::create_dir_all(&path)
            .map_err(|e| format!("Çöp kutusu dizini oluşturulamadı: {}", e))?;
    }
    Ok(())
}

/* ── Tauri Komutları ── */

/// Varsayılan çöp kutusu dizinini (appDataDir/.archivistpro-trash) döndürür.
/// Frontend uygulama başlangıcında çağırıp setTrashDir() ile kaydeder.
#[tauri::command]
pub async fn get_trash_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("appDataDir alınamadı: {}", e))?
        .join(".archivistpro-trash");
    Ok(dir.to_string_lossy().to_string())
}


/// Çöp kutusu manifest dosyasını okur.
/// Dosya yoksa boş manifest JSON döndürür.
#[tauri::command]
pub async fn read_trash_manifest(
    trash_dir: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<String, String> {
    crate::require_authenticated(&role_state)?;

    let path = manifest_path(&trash_dir);
    if !path.exists() {
        return Ok(r#"{"entries":[]}"#.to_string());
    }
    fs::read_to_string(&path)
        .map_err(|e| format!("Manifest okunamadı: {}", e))
}

/// Çöp kutusu manifest dosyasını yazar (JSON string).
#[tauri::command]
pub async fn write_trash_manifest(
    trash_dir: String,
    data: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;

    ensure_trash_dir(&trash_dir)?;
    let path = manifest_path(&trash_dir);
    fs::write(&path, data.as_bytes())
        .map_err(|e| format!("Manifest yazılamadı: {}", e))
}

/// Dosyayı çöp kutusuna taşır.
/// Döndürülen değer: taşınan dosyanın byte cinsinden boyutu.
#[tauri::command]
pub async fn trash_move_file(
    source_path: String,
    trash_dir: String,
    trash_name: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<u64, String> {
    crate::require_authenticated(&role_state)?;

    // Path traversal koruması
    if trash_name.contains("..") || trash_name.contains('/') || trash_name.contains('\\') {
        return Err("Geçersiz çöp kutusu dosya adı".to_string());
    }

    let source = Path::new(&source_path);
    if !source.exists() {
        return Err(format!("Kaynak dosya bulunamadı: {}", source_path));
    }

    let file_size = source
        .metadata()
        .map(|m| m.len())
        .unwrap_or(0);

    ensure_trash_dir(&trash_dir)?;
    let dest = trash_dir_path(&trash_dir).join(&trash_name);

    // Önce aynı disk içinde rename dene (hızlı), başarısız olursa kopyala+sil
    if fs::rename(source, &dest).is_err() {
        fs::copy(source, &dest)
            .map_err(|e| format!("Dosya çöp kutusuna kopyalanamadı: {}", e))?;
        fs::remove_file(source)
            .map_err(|e| format!("Kaynak dosya silinemedi: {}", e))?;
    }

    Ok(file_size)
}

/// Çöp kutusundan orijinal konuma geri yükler.
#[tauri::command]
pub async fn trash_restore_file(
    trash_dir: String,
    trash_name: String,
    original_path: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<bool, String> {
    crate::require_authenticated(&role_state)?;

    // Path traversal koruması
    if trash_name.contains("..") || trash_name.contains('/') || trash_name.contains('\\') {
        return Err("Geçersiz çöp kutusu dosya adı".to_string());
    }

    let trash_file = trash_dir_path(&trash_dir).join(&trash_name);
    if !trash_file.exists() {
        return Ok(false);
    }

    let dest = Path::new(&original_path);

    // Hedef dizin yoksa oluştur
    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Hedef dizin oluşturulamadı: {}", e))?;
        }
    }

    if fs::rename(&trash_file, dest).is_err() {
        fs::copy(&trash_file, dest)
            .map_err(|e| format!("Dosya geri yüklenemedi: {}", e))?;
        fs::remove_file(&trash_file)
            .map_err(|e| format!("Çöp kutusu dosyası silinemedi: {}", e))?;
    }

    Ok(true)
}

/// Çöp kutusundaki tüm dosyaları kalıcı olarak siler.
/// _manifest.json korunur (frontend sıfırlayacak).
#[tauri::command]
pub async fn trash_empty(
    trash_dir: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;

    let dir = trash_dir_path(&trash_dir);
    if !dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Çöp kutusu okunamadı: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        // Manifest dosyasını atlıyoruz — frontend _writeManifest ile sıfırlıyor
        if path.file_name().and_then(|n| n.to_str()) == Some("_manifest.json") {
            continue;
        }
        if path.is_file() {
            let _ = fs::remove_file(&path);
        }
    }

    Ok(())
}
