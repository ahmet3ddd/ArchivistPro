//! Undo/redo Tauri komut sarmalayicilari (RBAC + audit + DB kilidi + progress).
//!
//! `undo_commands.rs` dizin-moduline bolundu (saf refactor). 3 `#[tauri::command(async)]`:
//! `list_undo_ops` · `undo_op` · `redo_op`. Yetki kind-bazli (tasima=admin · kurasyon/meta/cop=
//! editor); cekirdek uygula-mantigi `core.rs`'te. mod.rs `pub use commands::*` ile disari aktarir
//! → `undo_commands::list_undo_ops` vb. dis yollari AYNEN korunur (generate_handler degismez).

use tauri::ipc::Channel;
use tauri::State;

use crate::refile_commands::{emit_progress, RefileProgress};
use crate::{audit, rbac, AppState};

use super::core::{apply_curation, apply_moves, redo_meta_core, undo_meta_core};
use super::payload::{MetaPayload, MovePayload};
use super::{
    now_unix, UndoOpDto, UndoReport, KIND_ORGANIZE_MOVE, KIND_PROJECT_META, KIND_REFILE_MOVE,
    KIND_RENAME, KIND_ROOT_GROUP_ASSIGN, KIND_ROOT_GROUP_CREATE, KIND_ROOT_GROUP_DELETE,
    KIND_ROOT_GROUP_RECOLOR, KIND_ROOT_GROUP_RENAME,
};

// ── Komutlar ─────────────────────────────────────────────────────────────────────────────

/// Geri-al gecmisi (en yeni once). **Editor/Admin** (yazma gecmisi; viewer'a gerekmez).
#[tauri::command(async)]
pub fn list_undo_ops(limit: i64, state: State<'_, AppState>) -> Result<Vec<UndoOpDto>, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = db.list_undo_ops(limit).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| UndoOpDto {
            id: r.id,
            created_at: r.created_at,
            kind: r.kind,
            label: r.label,
            item_count: r.item_count,
            undone: r.undone,
        })
        .collect())
}

/// Bir kaydi geri al. Yetki kind-bazli (tasima=admin · proje-durumu=editor). Hata kodlari:
/// `not_found` · `already_undone` · `unknown_kind` · `corrupt_payload`. `failed` bos → kayit
/// `undone` isaretlenir; degilse aktif kalir (yeniden denenebilir). Denetim: `undo`.
#[tauri::command]
pub async fn undo_op(
    id: i64,
    on_progress: Channel<RefileProgress>,
    state: State<'_, AppState>,
) -> Result<UndoReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // kilit-oncesi snapshot

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let op = db
        .get_undo_op(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "not_found".to_string())?;
    if op.undone {
        return Err("already_undone".to_string());
    }

    // Yetki = islemin kendisiyle AYNI kademe: dosya-tasima admin, kurasyon/meta/cop editor.
    match op.kind.as_str() {
        // Dosya-tasima VE kaynak-klasor grup islemleri **admin** (roots.rs grup komutlari admin-gate).
        KIND_REFILE_MOVE
        | KIND_RENAME
        | KIND_ORGANIZE_MOVE
        | KIND_ROOT_GROUP_CREATE
        | KIND_ROOT_GROUP_DELETE
        | KIND_ROOT_GROUP_RENAME
        | KIND_ROOT_GROUP_RECOLOR
        | KIND_ROOT_GROUP_ASSIGN => rbac::require_admin(role).map_err(|e| e.to_string())?,
        _ => rbac::require_editor(role).map_err(|e| e.to_string())?,
    }

    let mut last_emit: Option<std::time::Instant> = None;
    let mut report = match op.kind.as_str() {
        KIND_REFILE_MOVE | KIND_RENAME | KIND_ORGANIZE_MOVE => {
            let payload: MovePayload =
                serde_json::from_str(&op.payload).map_err(|_| "corrupt_payload".to_string())?;
            apply_moves(&db, &payload.items, false, |processed, total, file| {
                emit_progress(&on_progress, processed, total, file.to_string(), &mut last_emit);
            })
        }
        KIND_PROJECT_META => {
            let payload: MetaPayload =
                serde_json::from_str(&op.payload).map_err(|_| "corrupt_payload".to_string())?;
            undo_meta_core(&db, &payload)
        }
        _ => {
            let (rep, new_payload) = apply_curation(&mut db, &op.kind, &op.payload, false)?;
            if let Some(np) = new_payload {
                let _ = db.update_undo_payload(id, &np);
            }
            rep
        }
    };

    // Kalici hata yoksa kayit kapanir (undone); varsa aktif kalir (yeniden dene).
    if report.failed.is_empty() {
        let _ = db.mark_undone(id, now_unix());
        report.undone = true;
    }

    audit::record_on(
        &db,
        &actor,
        "undo",
        Some("undo_op"),
        Some(&id.to_string()),
        Some(&format!(
            "{}: {} geri / {} atlandi / {} hata",
            op.kind,
            report.reverted,
            report.skipped.len(),
            report.failed.len()
        )),
    );

    Ok(report)
}

/// Bir kaydi ILERI AL (redo) — undo'nun tersi: islemi YENIDEN uygular, kaydi tekrar aktif isaretler.
/// Yalniz `undone` kayit redo edilebilir. Yetki = undo ile ayni (tasima=admin, kurasyon/meta/cop=
/// editor). Hata kodlari: `not_found` · `not_undone` · `unknown_kind` · `corrupt_payload`. `failed`
/// bos → kayit yeniden aktif (`undone_at=NULL`); degilse `undone` kalir (yeniden denenebilir).
/// Guvenceler undo ile ayni (moves changed_since/ezme-yok; koleksiyon silinmisse ada gore recreate).
#[tauri::command]
pub async fn redo_op(
    id: i64,
    on_progress: Channel<RefileProgress>,
    state: State<'_, AppState>,
) -> Result<UndoReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state);

    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let op = db
        .get_undo_op(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "not_found".to_string())?;
    if !op.undone {
        return Err("not_undone".to_string());
    }
    match op.kind.as_str() {
        // Dosya-tasima VE kaynak-klasor grup islemleri **admin** (roots.rs grup komutlari admin-gate).
        KIND_REFILE_MOVE
        | KIND_RENAME
        | KIND_ORGANIZE_MOVE
        | KIND_ROOT_GROUP_CREATE
        | KIND_ROOT_GROUP_DELETE
        | KIND_ROOT_GROUP_RENAME
        | KIND_ROOT_GROUP_RECOLOR
        | KIND_ROOT_GROUP_ASSIGN => rbac::require_admin(role).map_err(|e| e.to_string())?,
        _ => rbac::require_editor(role).map_err(|e| e.to_string())?,
    }

    let mut last_emit: Option<std::time::Instant> = None;
    let mut report = match op.kind.as_str() {
        KIND_REFILE_MOVE | KIND_RENAME | KIND_ORGANIZE_MOVE => {
            let payload: MovePayload =
                serde_json::from_str(&op.payload).map_err(|_| "corrupt_payload".to_string())?;
            apply_moves(&db, &payload.items, true, |processed, total, file| {
                emit_progress(&on_progress, processed, total, file.to_string(), &mut last_emit);
            })
        }
        KIND_PROJECT_META => {
            let payload: MetaPayload =
                serde_json::from_str(&op.payload).map_err(|_| "corrupt_payload".to_string())?;
            redo_meta_core(&db, &payload)
        }
        _ => {
            let (rep, new_payload) = apply_curation(&mut db, &op.kind, &op.payload, true)?;
            if let Some(np) = new_payload {
                let _ = db.update_undo_payload(id, &np);
            }
            rep
        }
    };

    // Kalici hata yoksa kayit yeniden aktif (redone); varsa undone kalir (yeniden dene).
    if report.failed.is_empty() {
        let _ = db.mark_redone(id);
        report.undone = false;
    } else {
        report.undone = true;
    }

    audit::record_on(
        &db,
        &actor,
        "redo",
        Some("undo_op"),
        Some(&id.to_string()),
        Some(&format!(
            "{}: {} ileri / {} atlandi / {} hata",
            op.kind,
            report.reverted,
            report.skipped.len(),
            report.failed.len()
        )),
    );

    Ok(report)
}
