//! Tarama yapılmış kök klasörlerinin dosya sistemi olaylarını izler.
//!
//! Phase 1 kapsamı: SADECE TESPİT — kullanıcıya "X klasöründe değişiklik var"
//! bildirim toast'ı gönderir. Otomatik tarama tetikleme YOK; kullanıcı manuel
//! "Yeniden Tara" butonuyla devam eder.
//!
//! Mimari:
//!   - Her scanned_root için bir notify watcher (recursive)
//!   - FS event geldiğinde 1 saniye debounce edip Tauri event emit
//!   - Event payload: { path: String, kind: "created"|"modified"|"removed" }
//!   - UI tarafı: useFolderWatcher hook event'i dinler, toast gösterir
//!
//! Network drive (UNC/SMB): Windows ReadDirectoryChangesW destekli.
//! Linux/Mac: inotify polling fallback (notify crate handle eder).

use notify::{RecommendedWatcher, RecursiveMode, Watcher, EventKind};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

/// Aktif watcher'ları tutan global state. Path string → Watcher instance.
/// Watcher Drop edildiğinde notify thread otomatik kapanır.
static WATCHERS: std::sync::OnceLock<Mutex<HashMap<String, RecommendedWatcher>>> =
    std::sync::OnceLock::new();

/// Aynı root için art arda emit'leri 1 saniye debounce eder.
/// Path string → son emit zamanı.
static LAST_EMIT: std::sync::OnceLock<Mutex<HashMap<String, Instant>>> =
    std::sync::OnceLock::new();

const DEBOUNCE_MS: u128 = 1000;

fn watchers() -> &'static Mutex<HashMap<String, RecommendedWatcher>> {
    WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn last_emit() -> &'static Mutex<HashMap<String, Instant>> {
    LAST_EMIT.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FolderChangePayload {
    /// İzlenen kök klasör (event'in geldiği root, alt klasör değil)
    root_path: String,
    /// Olay tipi: created | modified | removed | other
    kind: &'static str,
}

fn event_kind_str(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "created",
        EventKind::Modify(_) => "modified",
        EventKind::Remove(_) => "removed",
        _ => "other",
    }
}

fn should_emit(root_path: &str) -> bool {
    let mut map = match last_emit().lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let now = Instant::now();
    if let Some(last) = map.get(root_path) {
        if now.duration_since(*last).as_millis() < DEBOUNCE_MS {
            return false;
        }
    }
    map.insert(root_path.to_string(), now);
    true
}

/// Tek bir scanned_root için dosya sistemi izlemeyi başlatır.
/// Aynı path için tekrar çağrılırsa eski watcher değiştirilir (memory leak yok).
#[tauri::command]
pub fn start_watching_root(app: AppHandle, path: String) -> Result<(), String> {
    let path_buf = PathBuf::from(&path);
    if !path_buf.exists() {
        return Err(format!("Klasör bulunamadı: {}", path));
    }

    let root_for_event = path.clone();
    let app_handle = app.clone();

    let watcher_result = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(e) => e,
            Err(e) => {
                log::warn!("[folder_watcher] event hatası: {}", e);
                return;
            }
        };

        // Sadece anlamlı event'leri yayınla — Access/Other'ı atla
        let kind = event.kind;
        if !matches!(kind, EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)) {
            return;
        }

        if !should_emit(&root_for_event) {
            return; // 1sn debounce
        }

        let payload = FolderChangePayload {
            root_path: root_for_event.clone(),
            kind: event_kind_str(&kind),
        };
        if let Err(e) = app_handle.emit("folder_changed", payload) {
            log::warn!("[folder_watcher] emit başarısız: {}", e);
        }
    });

    let mut watcher = watcher_result.map_err(|e| format!("Watcher oluşturulamadı: {}", e))?;
    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| format!("Watch başarısız: {}", e))?;

    let mut map = watchers().lock().map_err(|_| "Watcher kilidi alınamadı".to_string())?;
    // Eskisini değiştir (Drop ile thread kapanır)
    map.insert(path, watcher);

    Ok(())
}

/// Belirli bir kök klasörün izlemesini durdurur.
#[tauri::command]
pub fn stop_watching_root(path: String) -> Result<(), String> {
    let mut map = watchers().lock().map_err(|_| "Watcher kilidi alınamadı".to_string())?;
    map.remove(&path);
    if let Ok(mut emit_map) = last_emit().lock() {
        emit_map.remove(&path);
    }
    Ok(())
}

/// Tüm aktif watcher'ları durdurur (logout, app exit, settings toggle off).
#[tauri::command]
pub fn stop_all_watchers() -> Result<(), String> {
    if let Ok(mut map) = watchers().lock() {
        map.clear();
    }
    if let Ok(mut emit_map) = last_emit().lock() {
        emit_map.clear();
    }
    Ok(())
}
