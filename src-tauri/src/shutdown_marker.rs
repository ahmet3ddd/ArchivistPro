//! ArchivistPro — Graceful Shutdown Marker
//!
//! Kullanıcı uygulamayı düzgün kapattığında küçük bir JSON dosyası yazar
//! (`<app_data>/last_graceful_shutdown.json`). Sonraki açılışta bu dosya
//! tüketilir (oku + sil) ve SCAN_INTERRUPTED tespiti "kullanıcı kapatması"
//! ile "beklenmedik sonlanma"yı bu marker'a göre ayırır.
//!
//! Avantaj: sql.js DB save akışına bağımlı değil — büyük DB'lerde IPC
//! tamamlanmadan exit olsa bile marker garantili yazılır (saniyenin altında).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShutdownMarker {
    pub timestamp: String,
    pub reason: String,
}

fn marker_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?;
    Ok(dir.join("last_graceful_shutdown.json"))
}

/// Çıkış sırasında çağrılır — küçük JSON dosyası yazar (atomik fs::write).
#[tauri::command]
pub async fn mark_graceful_shutdown(
    app: tauri::AppHandle,
    timestamp: String,
    reason: String,
) -> Result<(), String> {
    let path = marker_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
    }
    let marker = ShutdownMarker { timestamp, reason };
    let json = serde_json::to_string(&marker)
        .map_err(|e| format!("JSON serialize hatası: {}", e))?;
    std::fs::write(&path, json.as_bytes())
        .map_err(|e| format!("Marker yazılamadı: {}", e))?;
    Ok(())
}

/// Açılışta çağrılır — marker varsa içeriğini döndür ve dosyayı sil (one-shot).
#[tauri::command]
pub async fn take_graceful_shutdown_marker(
    app: tauri::AppHandle,
) -> Result<Option<ShutdownMarker>, String> {
    let path = marker_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) => return Err(format!("Marker okunamadı: {}", e)),
    };
    let marker: ShutdownMarker = match serde_json::from_slice(&bytes) {
        Ok(m) => m,
        Err(e) => {
            // Bozuk dosyayı sil ki ileride takılmasın
            let _ = std::fs::remove_file(&path);
            return Err(format!("Marker parse hatası: {}", e));
        }
    };
    let _ = std::fs::remove_file(&path);
    Ok(Some(marker))
}
