//! Cok-arsiv tasima — ince `#[tauri::command(async)]` sarmalayicilar (Dilim 2).
//!
//! Saf cekirdek `archive_share.rs`'te (`do_export`/`do_import`/`peek_manifest` + DTO'lar).
//! Burada yalniz IPC kabugu: `require_admin` yetki-gate, db kilidi, Channel ilerleme-koprusu,
//! best-effort audit. Ayrim `model_commands`/`reindex_commands` deseniyle ayni (test-edilebilir
//! saf cekirdek, Tauri'ye bagimli ince sarmalayici).

use std::path::{Path, PathBuf};

use tauri::ipc::Channel;
use tauri::State;

use archivist_db::ListOpts;

use crate::archive_extract::{do_extract, ExtractProgress, ExtractReport};
use crate::archive_merge::{do_merge, do_merge_preview, MergeProgress};
use crate::archive_share::{
    do_export, do_import, peek_manifest, ArchiveManifest, ExportProgress, ExportReport,
    ImportProgress, ImportReport, Remap,
};
use crate::{audit, indexer, rbac, AppState};

/// Arsivi bir `.archivistpro` (ham SQLite) dosyasina **disa aktar** (ADMIN; ilerlemeli).
#[tauri::command(async)]
pub fn export_archive(
    dest: String,
    on_progress: Channel<ExportProgress>,
    state: State<'_, AppState>,
) -> Result<ExportReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // db kilidi ONCESI (nested-lock onleme)
    let dest_path = PathBuf::from(dest);

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let report = do_export(&db, &dest_path, |p| {
        let _ = on_progress.send(p);
    })?;
    audit::record_on(
        &db,
        &actor,
        "archive_export",
        None,
        None,
        Some(&format!("{} asset → {}", report.asset_count, dest_path.display())),
    );
    Ok(report)
}

/// Bir `.archivistpro` dosyasinin manifestini **onizle** (gate YOK — salt-okuma).
#[tauri::command(async)]
pub fn peek_archive_manifest(path: String) -> Result<ArchiveManifest, String> {
    peek_manifest(Path::new(&path))
}

/// Bir `.archivistpro` arsivini **ice aktar** (ADMIN; butun-DB REPLACE + YOL-REMAP; ilerlemeli).
/// `async` — kopya/restore yavas olabilir → UI donmaz (govde bloklayici, `.await` yok; reindex deseni).
#[tauri::command]
pub async fn import_archive(
    src: String,
    remaps: Vec<Remap>,
    on_progress: Channel<ImportProgress>,
    state: State<'_, AppState>,
) -> Result<ImportReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // db kilidi ONCESI (nested-lock onleme)
    let snapshots_dir = crate::backup_commands::snapshots_dir(&state)?;
    let host = crate::location::current_hostname();
    let src_path = PathBuf::from(src);

    let report = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let report = do_import(&mut db, &src_path, &remaps, &snapshots_dir, &host, |p| {
            let _ = on_progress.send(p);
        })?;
        // Best-effort audit (kilit altinda; actor onceden alindi). Kaynak host manifest'ten
        // (src degismedi → yeniden peek ucuz + dogru).
        let src_host = peek_manifest(&src_path).map(|m| m.source_host).unwrap_or_default();
        audit::record_on(
            &db,
            &actor,
            "archive_import",
            None,
            None,
            Some(&format!(
                "{} asset / {} remap / kaynak host: {}",
                report.asset_count, report.remapped_rows, src_host
            )),
        );
        report
    }; // db kilidi burada birakilir → signal_index kendi kilidini alabilir

    // Ice aktarilan arsivin eksik AI indeksini tetikle (kaldigi yerden devam eden kuyruk).
    indexer::signal_index();
    Ok(report)
}

/// Bir `.archivistpro`'nun **birlestirme onizlemesi** (sayimlar; YAZMA YOK; gate YOK — salt-okuma
/// sayim). Frontend merge oncesi "kac asset / kac yinelenen / kac yol-cakismasi" gosterir.
#[tauri::command(async)]
pub fn preview_merge_archive(
    src: String,
    state: State<'_, AppState>,
) -> Result<archivist_db::MergePreview, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    do_merge_preview(&db, Path::new(&src))
}

/// Bir `.archivistpro` arsivini CANLI arsive **BIRLESTIR** (ADMIN; additive — import REPLACE'in
/// aksine; ilerlemeli). Kaynak degismez, hedef buyur. `disposition`: `"skipDuplicates"` (yinelenen
/// icerik atlanir) | `"importAll"` (yinelenenler de yeni id ile gelir; yalniz yol-cakismasi atlanir).
/// `async` — merge yavas olabilir → UI donmaz (govde bloklayici, `.await` yok; import deseni).
#[tauri::command]
pub async fn merge_archive(
    src: String,
    disposition: String,
    remaps: Vec<Remap>,
    on_progress: Channel<MergeProgress>,
    state: State<'_, AppState>,
) -> Result<archivist_db::MergeReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // db kilidi ONCESI (nested-lock onleme)
    let snapshots_dir = crate::backup_commands::snapshots_dir(&state)?;
    let src_path = PathBuf::from(src);

    let report = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let report = do_merge(&mut db, &src_path, &disposition, &remaps, &snapshots_dir, |p| {
            let _ = on_progress.send(p);
        })?;
        audit::record_on(
            &db,
            &actor,
            "archive_merge",
            None,
            None,
            Some(&format!(
                "{} birlestirildi / {} yinelenen atlandi / {} yol-cakismasi (kaynak: {})",
                report.merged,
                report.skipped_duplicate,
                report.skipped_path_conflict,
                src_path.display()
            )),
        );
        report
    }; // db kilidi burada birakilir → signal_index kendi kilidini alabilir

    // Birlesen arsivin eksik AI indeksini (indexed_at=NULL kalanlar) tetikle.
    indexer::signal_index();
    Ok(report)
}

/// Facet filtresine (`opts`) uyan asset SAYISI (extract onizleme; salt-okuma; gate YOK). FTS
/// `query` yok sayilir (extract facet-tabanli).
#[tauri::command(async)]
pub fn preview_extract_archive(opts: ListOpts, state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db.ids_matching(&opts).map_err(|e| e.to_string())?.len() as i64)
}

/// Filtreli arsiv **CIKAR** (ADMIN; yeni `.archivistpro` = alt-kume). `opts` facet filtresi;
/// `move_mode=true` → kopyalama basarili olduktan SONRA kaynaktan soft-delete (cop; geri-alinabilir).
/// `async` — kopya/budama/VACUUM yavas olabilir → UI donmaz (import deseni; govde bloklayici).
#[tauri::command]
pub async fn extract_archive(
    dest: String,
    opts: ListOpts,
    move_mode: bool,
    on_progress: Channel<ExtractProgress>,
    state: State<'_, AppState>,
) -> Result<ExtractReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // db kilidi ONCESI (nested-lock onleme)
    let dest_path = PathBuf::from(dest);

    let report = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        let report = do_extract(&mut db, &dest_path, &opts, move_mode, |p| {
            let _ = on_progress.send(p);
        })?;
        let moved_note = if report.moved {
            format!(" / {} kaynaktan cope tasindi", report.removed)
        } else {
            String::new()
        };
        audit::record_on(
            &db,
            &actor,
            "archive_extract",
            None,
            None,
            Some(&format!("{} asset cikarildi{moved_note} → {}", report.extracted, dest_path.display())),
        );
        report
    };
    Ok(report)
}
