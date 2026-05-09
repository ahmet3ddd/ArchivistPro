use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

const MAX_CRASH_FILES: usize = 20;
const MAX_FILE_SIZE: usize = 100 * 1024; // 100 KB

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CrashReport {
    pub id: String,
    pub timestamp: String,
    pub error_type: String,
    pub message: String,
    pub stack_trace: String,
    pub app_version: String,
    pub os_info: String,
    pub memory_usage: String,
    pub component: String,
}

fn crash_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e: tauri::Error| e.to_string())?;
    let dir = base.join("crash_logs");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot create crash_logs dir: {e}"))?;
    Ok(dir)
}

/// Enforces FIFO: keeps at most MAX_CRASH_FILES, deletes oldest.
fn enforce_fifo(dir: &PathBuf) {
    let mut entries: Vec<_> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "json")
                .unwrap_or(false)
        })
        .collect();

    if entries.len() < MAX_CRASH_FILES {
        return;
    }

    // Sort by name ascending (timestamp is in the filename)
    entries.sort_by_key(|e| e.file_name());

    let to_remove = entries.len() - MAX_CRASH_FILES + 1; // +1 to make room for new file
    for entry in entries.into_iter().take(to_remove) {
        let _ = fs::remove_file(entry.path());
    }
}

fn truncate(s: &str, max_len: usize) -> String {
    if s.len() <= max_len {
        s.to_string()
    } else {
        let mut end = max_len;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}... [truncated]", &s[..end])
    }
}

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    chrono::DateTime::from_timestamp(secs, 0)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|| "unknown".to_string())
}

fn now_file_ts() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{secs}")
}

fn os_info() -> String {
    format!(
        "{} {} ({})",
        std::env::consts::OS,
        std::env::consts::ARCH,
        std::env::consts::FAMILY
    )
}

/// Synchronous write — used from panic hook (no async runtime).
pub fn write_crash_report_sync(
    dir: &PathBuf,
    error_type: &str,
    message: &str,
    stack_trace: &str,
    component: &str,
) {
    let ts = now_file_ts();
    let id = format!("{ts}_{}", rand_id());

    let report = CrashReport {
        id: id.clone(),
        timestamp: now_iso(),
        error_type: error_type.to_string(),
        message: truncate(message, 2000),
        stack_trace: truncate(stack_trace, 50_000),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        os_info: os_info(),
        memory_usage: String::new(),
        component: component.to_string(),
    };

    enforce_fifo(dir);

    let filename = format!("crash_{id}.json");
    let path = dir.join(&filename);

    if let Ok(json) = serde_json::to_string_pretty(&report) {
        let json = truncate(&json, MAX_FILE_SIZE);
        let _ = crate::ollama_db::write_and_sync(&path, json.as_bytes());
    }
}

fn rand_id() -> String {
    let mut buf = [0u8; 4];
    getrandom::getrandom(&mut buf).unwrap_or_default();
    format!(
        "{:02x}{:02x}{:02x}{:02x}",
        buf[0], buf[1], buf[2], buf[3]
    )
}

// ── Tauri commands ──

#[tauri::command]
pub fn write_crash_report(
    app: tauri::AppHandle,
    error_type: String,
    message: String,
    stack_trace: String,
    component: String,
) -> Result<String, String> {
    let dir = crash_dir(&app)?;
    write_crash_report_sync(&dir, &error_type, &message, &stack_trace, &component);
    Ok("ok".to_string())
}

#[tauri::command]
pub fn list_crash_reports(app: tauri::AppHandle) -> Result<Vec<CrashReport>, String> {
    let dir = crash_dir(&app)?;
    let mut reports: Vec<CrashReport> = Vec::new();

    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(report) = serde_json::from_str::<CrashReport>(&content) {
                    reports.push(report);
                }
            }
        }
    }

    // Sort by timestamp descending (newest first)
    reports.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(reports)
}

#[tauri::command]
pub fn delete_crash_report(app: tauri::AppHandle, id: String) -> Result<bool, String> {
    let dir = crash_dir(&app)?;
    let filename = format!("crash_{id}.json");
    let path = dir.join(&filename);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub fn clear_crash_reports(app: tauri::AppHandle) -> Result<u32, String> {
    let dir = crash_dir(&app)?;
    let mut count = 0u32;

    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false)
            && fs::remove_file(&path).is_ok()
        {
            count += 1;
        }
    }

    Ok(count)
}
