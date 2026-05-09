mod thumb_util;
mod ollama_db;
mod refile_fs;
mod text_extract;
mod max_version;
mod skp_version;
mod thumbnails;
mod dwg_parse;
mod dxf_parse;
mod oda_converter;
mod shape_match;
mod image_analysis;
mod office_utils;
mod pdf_metadata;
mod video_metadata;
mod text_metadata;
mod archive_share;
mod lan_server;
mod crash_report;
mod rvt_metadata;
mod ifc_metadata;
mod trash;
mod os_events;
mod shutdown_marker;
mod scan_db;
mod folder_watcher;
mod process_priority;

use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

/// Tauri yönetilen oturum rolü durumu (login sonrası set edilir)
pub struct SessionRoleState(pub Mutex<Option<String>>);

/// Tauri yönetilen oturum geliştirici bayrağı (login sonrası set edilir)
pub struct SessionDeveloperState(pub Mutex<bool>);

/// Mevcut oturumun admin olup olmadığını doğrular; değilse hata döner.
/// ollama_db, archive_share, lan_server modüllerinden `crate::require_admin` ile çağrılır.
pub fn require_admin(state: &tauri::State<'_, SessionRoleState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "Rol durumu kilidi alınamadı".to_string())?;
    match guard.as_deref() {
        Some("admin") => Ok(()),
        Some(r) => Err(format!("Bu işlem admin yetkisi gerektirir (mevcut: {})", r)),
        None => Err("Oturum açılmamış veya rol belirsiz".to_string()),
    }
}

/// Mevcut oturumun en azından authenticated (admin veya viewer) olduğunu doğrular.
/// Giriş yapmamış çağrıları reddeder — XSS / enjekte edilmiş script için ek koruma.
pub fn require_authenticated(state: &tauri::State<'_, SessionRoleState>) -> Result<(), String> {
    let guard = state.0.lock().map_err(|_| "Rol durumu kilidi alınamadı".to_string())?;
    match guard.as_deref() {
        Some("admin") | Some("viewer") => Ok(()),
        Some(r) => Err(format!("Bu işlem için geçerli bir oturum gerekir (mevcut: {})", r)),
        None => Err("Oturum açılmamış".to_string()),
    }
}

/// Mevcut oturumun admin VEYA geliştirici olup olmadığını doğrular.
pub fn require_developer_or_admin(
    role_state: &tauri::State<'_, SessionRoleState>,
    dev_state: &tauri::State<'_, SessionDeveloperState>,
) -> Result<(), String> {
    let role_guard = role_state.0.lock().map_err(|_| "Rol durumu kilidi alınamadı".to_string())?;
    if role_guard.as_deref() == Some("admin") {
        return Ok(());
    }
    let dev_guard = dev_state.0.lock().map_err(|_| "Geliştirici durumu kilidi alınamadı".to_string())?;
    if *dev_guard {
        return Ok(());
    }
    Err("Bu işlem admin veya geliştirici yetkisi gerektirir".to_string())
}

/// Frontend login başarılı olduktan sonra çağrılır.
/// Rust taraf runtime rol durumunu set eder — admin-only komutlar bu değeri kontrol eder.
#[tauri::command]
fn tauri_set_session_role(
    role: String,
    state: tauri::State<'_, SessionRoleState>,
) -> Result<(), String> {
    if role != "admin" && role != "viewer" {
        return Err(format!("Geçersiz rol değeri: {}", role));
    }
    *state.0.lock().map_err(|_| "Rol durumu kilidi alınamadı".to_string())? = Some(role);
    Ok(())
}

/// Frontend login başarılı olduktan sonra çağrılır — geliştirici bayrağını set eder.
#[tauri::command]
fn tauri_set_session_developer(
    is_developer: bool,
    state: tauri::State<'_, SessionDeveloperState>,
) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Geliştirici durumu kilidi alınamadı".to_string())? = is_developer;
    Ok(())
}

pub use dwg_parse::{DwgExtractedMetadata, DwgDrawingProperties};
pub use image_analysis::ImageExifData;
pub use office_utils::OfficeDates;

// Re-export all tauri command functions so macros can reference them directly
use max_version::*;
use skp_version::*;
use thumbnails::*;
use dwg_parse::*;
use dxf_parse::*;
use image_analysis::*;
use office_utils::*;
use pdf_metadata::*;
use video_metadata::*;
use text_metadata::*;
use crash_report::*;
use rvt_metadata::*;
use ifc_metadata::*;

#[derive(Serialize)]
pub struct FileMetadata {
    created_at: Option<String>,
    modified_at: Option<String>,
}

fn system_time_to_iso(time: SystemTime) -> Option<String> {
    let duration = time.duration_since(UNIX_EPOCH).ok()?;
    let secs = duration.as_secs() as i64;

    // Quick local UTC ISO string format
    let datetime = chrono::DateTime::from_timestamp(secs, 0)?;
    Some(datetime.to_rfc3339())
}

#[tauri::command]
fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;

    let created_at = metadata.created().ok().and_then(system_time_to_iso);
    let modified_at = metadata.modified().ok().and_then(system_time_to_iso);

    Ok(FileMetadata {
        created_at,
        modified_at,
    })
}

/// Yerel LAN IP adresini döner (admin ayar paneli için)
#[tauri::command]
fn get_local_ip() -> String {
    lan_server::detect_local_ip()
}

/// Verilen dosya yollarının diskte mevcut olup olmadığını kontrol eder.
/// Mevcut OLMAYAN yolları döndürür (yetim/orphan tespiti).
#[tauri::command]
fn check_files_exist(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().filter(|p| !std::path::Path::new(p).exists()).collect()
}

#[derive(Deserialize)]
pub struct StalenessCheckItem {
    pub path: String,
    #[serde(default)]
    pub known_mtime: Option<i64>,
}

#[derive(Serialize)]
pub struct StalenessResult {
    pub path: String,
    /// "ok" | "stale" | "missing" | "unknown"
    pub status: String,
    pub current_mtime: Option<i64>,
}

/// Dosya güncellik kontrolü: her item için path'in mtime'ı ile bilinen mtime karşılaştırılır.
/// - missing: dosya diskte yok
/// - stale:   current_mtime - known_mtime > tolerance_secs
/// - ok:      fark tolerans dahilinde
/// - unknown: known_mtime NULL veya current_mtime okunamadı
#[tauri::command]
async fn check_paths_staleness(
    items: Vec<StalenessCheckItem>,
    tolerance_secs: i64,
) -> Vec<StalenessResult> {
    tauri::async_runtime::spawn_blocking(move || {
        items
            .into_iter()
            .map(|item| {
                let meta = std::fs::metadata(&item.path).ok();
                match meta {
                    None => StalenessResult {
                        path: item.path,
                        status: "missing".into(),
                        current_mtime: None,
                    },
                    Some(m) => {
                        let current_mtime = m
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64);
                        let status = match (item.known_mtime, current_mtime) {
                            (Some(known), Some(curr)) => {
                                if (curr - known).abs() <= tolerance_secs {
                                    "ok"
                                } else {
                                    "stale"
                                }
                            }
                            _ => "unknown",
                        };
                        StalenessResult {
                            path: item.path,
                            status: status.into(),
                            current_mtime,
                        }
                    }
                }
            })
            .collect()
    })
    .await
    .unwrap_or_default()
}

/// Verilen yoldaki disk alanını kontrol eder.
/// (available_bytes, total_bytes) tuple döndürür.
#[tauri::command]
fn check_disk_space(path: String) -> Result<(u64, u64), String> {
    use fs2::available_space;
    use fs2::total_space;
    let p = std::path::Path::new(&path);
    // Dosya ise parent dizini kullan
    let dir = if p.is_file() { p.parent().unwrap_or(p) } else { p };
    let avail = available_space(dir).map_err(|e| format!("Disk alanı okunamadı: {}", e))?;
    let total = total_space(dir).map_err(|e| format!("Toplam alan okunamadı: {}", e))?;
    Ok((avail, total))
}

/// Uygulamayı temiz bir şekilde sonlandırır (çıkış onayı sonrası).
#[tauri::command]
fn app_quit(app: tauri::AppHandle) {
    app.exit(0);
}

/// Build-time feature flag'lerini frontend'e bildirir.
/// Viewer-only build'inde admin=false döner ve UI bağlı butonları gizler.
#[tauri::command]
fn get_build_features() -> serde_json::Value {
    let admin = cfg!(feature = "admin");
    serde_json::json!({ "admin": admin })
}

/// Frontend'den gelen logları Rust tracing'e yönlendirir
#[tauri::command]
fn write_system_log(level: String, module: String, message: String) {
    match level.as_str() {
        "ERROR" => log::error!("[{}] {}", module, message),
        "WARN" => log::warn!("[{}] {}", module, message),
        "INFO" => log::info!("[{}] {}", module, message),
        "DEBUG" => log::debug!("[{}] {}", module, message),
        "TRACE" => log::trace!("[{}] {}", module, message),
        _ => log::info!("[{}] {}", module, message),
    }
}

/// Her iki rol için ortak Tauri komutları
#[allow(unused_macros)]
macro_rules! shared_handlers {
    () => {
        tauri::generate_handler![
            generate_thumbnail,
            get_psd_thumbnail,
            get_dwg_thumbnail,
            get_dwg_creation_date,
            get_max_thumbnail,
            get_file_metadata,
            get_max_version,
            extract_max_metadata,
            get_skp_version,
            get_skp_thumbnail,
            get_rvt_thumbnail,
            get_office_thumbnail,
            get_office_dates,
            get_pdf_thumbnail,
            get_text_thumbnail,
            get_doc_icon_thumbnail,
            get_eps_thumbnail,
            detect_bak_source_type,
            get_image_dimensions,
            get_image_exif,
            get_dominant_colors,
            compute_image_phash,
            compute_image_phash_from_bytes,
            hamming_distance,
            compute_file_hash,
            refile_fs::show_in_folder,
            refile_fs::open_file_native,
            extract_dwg_metadata,
            extract_dxf_metadata,
            extract_dxf_shapes,
            extract_dwg_shapes,
            shape_match::extract_shape_from_image,
            shape_match::extract_shape_from_image_bytes,
            scan_db::search_shapes_by_similarity,
            scan_db::search_shapes_by_features,
            scan_db::search_similar_dwg,
            oda_converter::clear_dxf_cache_cmd,
            set_oda_converter_path,
            get_oda_converter_path_cmd,
            detect_oda_converter,
            install_oda_converter,
            install_bundled_oda,
            check_bundled_oda,
            run_local_oda_installer,
            ollama_db::ollama_proxy,
            ollama_db::ollama_pull_model,
            ollama_db::set_ollama_cors,
            ollama_db::check_ollama_cors,
            ollama_db::get_ollama_host_env,
            ollama_db::ollama_ping,
            ollama_db::start_ollama,
            ollama_db::stop_ollama,
            ollama_db::detect_gpu,
            ollama_db::read_database,
            ollama_db::read_database_meta,
            ollama_db::read_database_binary,
            ollama_db::write_database,
            ollama_db::update_app_setting,
            ollama_db::db_upsert_user,
            ollama_db::db_delete_user_row,
            scan_db::scan_write_batch,
            scan_db::scan_clear_assets,
            scan_db::write_scan_report,
            scan_db::list_scan_reports,
            scan_db::read_scan_report_file,
            scan_db::open_scan_report_in_default_app,
            scan_db::soft_delete_root_in_trash,
            scan_db::restore_root_from_trash_disk,
            scan_db::update_asset_rag_status,
            scan_db::audit_log_apply_changes,
            scan_db::write_chat_mirror,
            scan_db::write_xmp_sidecar,
            os_events::query_os_events_for_crash,
            shutdown_marker::mark_graceful_shutdown,
            shutdown_marker::take_graceful_shutdown_marker,
            ollama_db::read_local_database,
            ollama_db::write_local_database,
            ollama_db::set_database_path,
            ollama_db::set_local_database_path,
            ollama_db::get_database_info,
            ollama_db::get_local_database_info,
            ollama_db::read_recovery_key,
            ollama_db::write_recovery_key,
            ollama_db::read_archive,
            ollama_db::write_archive,
            ollama_db::create_archive_file,
            ollama_db::delete_archive_file,
            ollama_db::get_archive_info,
            ollama_db::list_extra_archives,
            ollama_db::create_db_snapshot,
            ollama_db::list_db_snapshots,
            ollama_db::restore_db_snapshot,
            ollama_db::delete_db_snapshot,
            text_extract::extract_text_for_indexing,
            write_system_log,
            extract_skp_metadata,
            extract_pdf_metadata,
            extract_video_metadata,
            extract_office_metadata,
            extract_text_metadata,
            extract_image_metadata,
            archive_share::export_archive,
            archive_share::peek_archive_manifest,
            archive_share::import_archive,
            lan_server::lan_start_server,
            lan_server::lan_stop_server,
            lan_server::lan_get_server_status,
            lan_server::lan_regenerate_auth_code,
            write_crash_report,
            list_crash_reports,
            delete_crash_report,
            clear_crash_reports,
            extract_rvt_metadata,
            extract_ifc_metadata,
            tauri_set_session_role,
            tauri_set_session_developer,
            get_local_ip,
            check_files_exist,
            check_paths_staleness,
            check_disk_space,
            app_quit,
            trash::read_trash_manifest,
            trash::write_trash_manifest,
            trash::trash_move_file,
            trash::trash_restore_file,
            trash::trash_empty,
            trash::get_trash_dir,
            folder_watcher::start_watching_root,
            folder_watcher::stop_watching_root,
            folder_watcher::stop_all_watchers,
            process_priority::set_priority_background,
            process_priority::set_priority_normal,
            get_build_features
        ]
    };
}

/// Admin rolüne özel komutlar dahil tüm Tauri komutları
#[cfg(feature = "admin")]
macro_rules! all_handlers {
    () => {
        tauri::generate_handler![
            generate_thumbnail,
            get_psd_thumbnail,
            get_dwg_thumbnail,
            get_dwg_creation_date,
            get_max_thumbnail,
            get_file_metadata,
            get_max_version,
            extract_max_metadata,
            get_skp_version,
            get_skp_thumbnail,
            get_rvt_thumbnail,
            convert_max_version,
            detect_max_installations,
            is_max_running,
            convert_max_real,
            export_max_to_format,
            get_office_thumbnail,
            get_office_dates,
            get_pdf_thumbnail,
            get_text_thumbnail,
            get_doc_icon_thumbnail,
            get_eps_thumbnail,
            detect_bak_source_type,
            get_image_dimensions,
            get_image_exif,
            get_dominant_colors,
            compute_image_phash,
            compute_image_phash_from_bytes,
            hamming_distance,
            compute_file_hash,
            refile_fs::show_in_folder,
            refile_fs::open_file_native,
            refile_fs::refile_organize,
            extract_dwg_metadata,
            extract_dxf_metadata,
            extract_dxf_shapes,
            extract_dwg_shapes,
            shape_match::extract_shape_from_image,
            shape_match::extract_shape_from_image_bytes,
            scan_db::search_shapes_by_similarity,
            scan_db::search_shapes_by_features,
            scan_db::search_similar_dwg,
            oda_converter::clear_dxf_cache_cmd,
            set_oda_converter_path,
            get_oda_converter_path_cmd,
            detect_oda_converter,
            install_oda_converter,
            install_bundled_oda,
            check_bundled_oda,
            run_local_oda_installer,
            ollama_db::ollama_proxy,
            ollama_db::ollama_pull_model,
            ollama_db::set_ollama_cors,
            ollama_db::check_ollama_cors,
            ollama_db::get_ollama_host_env,
            ollama_db::ollama_ping,
            ollama_db::start_ollama,
            ollama_db::stop_ollama,
            ollama_db::detect_gpu,
            ollama_db::read_database,
            ollama_db::read_database_meta,
            ollama_db::read_database_binary,
            ollama_db::write_database,
            ollama_db::update_app_setting,
            ollama_db::db_upsert_user,
            ollama_db::db_delete_user_row,
            scan_db::scan_write_batch,
            scan_db::scan_clear_assets,
            scan_db::write_scan_report,
            scan_db::list_scan_reports,
            scan_db::read_scan_report_file,
            scan_db::open_scan_report_in_default_app,
            scan_db::soft_delete_root_in_trash,
            scan_db::restore_root_from_trash_disk,
            scan_db::update_asset_rag_status,
            scan_db::audit_log_apply_changes,
            scan_db::write_chat_mirror,
            scan_db::write_xmp_sidecar,
            os_events::query_os_events_for_crash,
            shutdown_marker::mark_graceful_shutdown,
            shutdown_marker::take_graceful_shutdown_marker,
            ollama_db::read_local_database,
            ollama_db::write_local_database,
            ollama_db::set_database_path,
            ollama_db::set_local_database_path,
            ollama_db::get_database_info,
            ollama_db::get_local_database_info,
            ollama_db::read_recovery_key,
            ollama_db::write_recovery_key,
            ollama_db::read_archive,
            ollama_db::write_archive,
            ollama_db::create_archive_file,
            ollama_db::delete_archive_file,
            ollama_db::get_archive_info,
            ollama_db::list_extra_archives,
            ollama_db::create_db_snapshot,
            ollama_db::list_db_snapshots,
            ollama_db::restore_db_snapshot,
            ollama_db::delete_db_snapshot,
            text_extract::extract_text_for_indexing,
            write_system_log,
            extract_skp_metadata,
            extract_pdf_metadata,
            extract_video_metadata,
            extract_office_metadata,
            extract_text_metadata,
            extract_image_metadata,
            archive_share::export_archive,
            archive_share::peek_archive_manifest,
            archive_share::import_archive,
            lan_server::lan_start_server,
            lan_server::lan_stop_server,
            lan_server::lan_get_server_status,
            lan_server::lan_regenerate_auth_code,
            write_crash_report,
            list_crash_reports,
            delete_crash_report,
            clear_crash_reports,
            extract_rvt_metadata,
            extract_ifc_metadata,
            tauri_set_session_role,
            tauri_set_session_developer,
            get_local_ip,
            check_files_exist,
            check_paths_staleness,
            check_disk_space,
            app_quit,
            trash::read_trash_manifest,
            trash::write_trash_manifest,
            trash::trash_move_file,
            trash::trash_restore_file,
            trash::trash_empty,
            trash::get_trash_dir,
            folder_watcher::start_watching_root,
            folder_watcher::stop_watching_root,
            folder_watcher::stop_all_watchers,
            process_priority::set_priority_background,
            process_priority::set_priority_normal,
            get_build_features
        ]
    };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(SessionRoleState(Mutex::new(None)))
        .manage(SessionDeveloperState(Mutex::new(false)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(feature = "admin")]
    let builder = builder.invoke_handler(all_handlers!());

    #[cfg(not(feature = "admin"))]
    let builder = builder.invoke_handler(shared_handlers!());

    builder
        .setup(|app| {
            // Panic hook: write crash report on Rust panics
            let crash_dir = app
                .path()
                .app_data_dir()
                .map(|p: std::path::PathBuf| p.join("crash_logs"))
                .ok();
            if let Some(dir) = crash_dir {
                let _ = std::fs::create_dir_all(&dir);
                std::panic::set_hook(Box::new(move |info| {
                    let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
                        s.to_string()
                    } else if let Some(s) = info.payload().downcast_ref::<String>() {
                        s.clone()
                    } else {
                        "Unknown panic".to_string()
                    };
                    let location = info
                        .location()
                        .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                        .unwrap_or_default();
                    log::error!("[PANIC] {} at {}", message, location);
                    crash_report::write_crash_report_sync(
                        &dir,
                        "rust_panic",
                        &message,
                        &location,
                        "rust_runtime",
                    );
                }));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
