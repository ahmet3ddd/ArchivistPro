//! Refile komutlari (manuel tasi/yeniden-adlandir) — disk tasima + DB yol senkronu. **Admin.**
//!
//! Kritik akis (ARCHITECTURE + refile.rs): dosya diskte tasinir, sonra `Db::refile_asset`
//! yolu YERINDE gunceller (re-ingest DEGIL → asset id/etiket/thumbnail/vektor korunur;
//! content_hash re-hash EDILMEZ). Sira: on-kontrol → DISK tasi → DB guncelle → DB hata olursa
//! disk ROLLBACK. Hedef dosya varsa **sessiz ezme YOK** (H2 tuzagi). Kaynak bu makinede yoksa
//! graceful atlanir (cok-lokasyon gercegi). Tek-dosya cekirdegi (`refile_one`) tekil + batch
//! komutlarinca paylasilir; Tauri'siz → birim test edilebilir (bkz `fsops`).

mod fsops;

use std::fs;
use std::path::Path;
use std::time::Instant;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::{audit, rbac, AppState};

// Kardes modullerin (organize_commands, undo_commands) `crate::refile_commands::X` yoluyla
// ulastigi fs cekirdegi → re-export (bolme oncesi sozlesme korunur).
pub(crate) use fsops::{
    copy_file, emit_progress, join_path, refile_one, separator_of, RefileOutcome,
};
use fsops::{file_name_of, is_valid_new_name, parent_dir};

/// Tekil yeniden-adlandirma sonucu (renderer'a doner).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefileResult {
    old_path: String,
    new_path: String,
}

/// Batch tasima ilerlemesi (Channel → UI cubugu).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RefileProgress {
    processed: usize,
    total: usize,
    current_file: String,
}

/// Batch tasima ozeti (renderer'a doner). `skipped`/`failed` her ogenin yolu + nedeni/hatasi.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RefileBatchReport {
    pub(crate) moved: u32,
    pub(crate) skipped: Vec<RefileSkip>,
    pub(crate) failed: Vec<RefileFail>,
}

/// Atlanan oge (benign: zaten hedefte / kaynak yok / hedef dolu).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefileSkip {
    pub(crate) path: String,
    pub(crate) reason: String,
}

/// Basarisiz oge (gercek hata: db cakismasi / disk hatasi).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefileFail {
    pub(crate) path: String,
    pub(crate) error: String,
}

// ── Komutlar ─────────────────────────────────────────────────────────────────────────────

/// Bir asset'i AYNI klasorde yeniden adlandir (disk + DB). **Admin.**
/// Hata kodlari (Err): `invalid_name` · `not_found` · `source_missing` · `target_exists` ·
/// `db_conflict` · `disk_error: ...` · `db_error: ...`. Ayni ada yeniden-adlandirma zararsiz
/// no-op (basari).
#[tauri::command(async)]
pub fn rename_asset(
    id: i64,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<RefileResult, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // kilit-oncesi snapshot

    // Ad on-kontrolu (kilit almadan).
    if !is_valid_new_name(&new_name) {
        return Err("invalid_name".to_string());
    }

    let db = state.db.lock().map_err(|e| e.to_string())?;

    // Eski yolu oku (aktif). Yoksa → not_found (disk'e dokunmadan).
    let old_path = db
        .paths_for_ids(&[id])
        .map_err(|e| e.to_string())?
        .into_iter()
        .next()
        .ok_or_else(|| "not_found".to_string())?;

    // Yeni yol = ayni dizin + ESKI YOLDAN alinan ayrac + yeni ad.
    let dir = parent_dir(&old_path).unwrap_or("");
    let sep = separator_of(&old_path);
    let new_path = join_path(dir, sep, &new_name);

    match refile_one(&db, id, &old_path, &new_path) {
        Ok(RefileOutcome::Moved) => {
            audit::record_on(
                &db,
                &actor,
                "refile",
                Some("asset"),
                Some(&id.to_string()),
                Some(&format!("{old_path} → {new_path}")),
            );
            // Undo kaydi (best-effort): geri-al eski ada dondurur.
            crate::undo_commands::record_moves(
                &db,
                crate::undo_commands::KIND_RENAME,
                &new_name,
                vec![crate::undo_commands::MoveItem {
                    id,
                    from: old_path.clone(),
                    to: new_path.clone(),
                }],
            );
            Ok(RefileResult { old_path, new_path })
        }
        // Ayni ada → no-op basari (disk/db degismedi; audit yok).
        Ok(RefileOutcome::AlreadyInPlace) => {
            Ok(RefileResult { old_path: old_path.clone(), new_path: old_path })
        }
        Err(e) => Err(e.code()),
    }
}

/// Secili asset'leri hedef klasore tasi (adlari korunur). **Admin.** Batch ABORT ETMEZ — sorunlu
/// oge `skipped`/`failed`'e yazilir; kalan devam eder. `async` — disk tasima yavas olabilir → UI
/// donmaz (govde bloklayici, `.await` yok). `dest_dir` gecersizse (mutlak degil / `..` / olusturulamaz)
/// komut-geneli Err.
#[tauri::command]
pub async fn refile_assets(
    ids: Vec<i64>,
    dest_dir: String,
    on_progress: Channel<RefileProgress>,
    state: State<'_, AppState>,
) -> Result<RefileBatchReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // kilit-oncesi snapshot

    // Hedef dizin dogrula (mutlak + `..` yok) → yoksa olustur.
    let dest = Path::new(&dest_dir);
    if dest_dir.trim().is_empty() || !dest.is_absolute() || dest_dir.contains("..") {
        return Err("invalid_dest".to_string());
    }
    fs::create_dir_all(dest).map_err(|e| format!("dest_create_failed: {e}"))?;
    let sep = separator_of(&dest_dir);

    let total = ids.len();
    let mut report = RefileBatchReport::default();
    let mut last_emit: Option<Instant> = None;
    // Basarili tasinanlar → tek undo kaydi (dongu sonunda; best-effort).
    let mut undo_items: Vec<crate::undo_commands::MoveItem> = Vec::new();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;

        for (i, &id) in ids.iter().enumerate() {
            let processed = i + 1;

            // Bu asset'in aktif yolu (id↔yol eslemesi refile_asset icin gerekli → id-basi
            // paths_for_ids; cop/eksik id → bos → skip).
            let old_path = db.paths_for_ids(&[id]).ok().and_then(|v| v.into_iter().next());
            let Some(old_path) = old_path else {
                report.skipped.push(RefileSkip { path: format!("#{id}"), reason: "not_found".into() });
                emit_progress(&on_progress, processed, total, format!("#{id}"), &mut last_emit);
                continue;
            };

            // Hedef = dest_dir + ayrac + KAYNAK ADI (ad korunur).
            let name = file_name_of(&old_path);
            let new_path = join_path(&dest_dir, sep, name);
            let display = name.to_string();

            match refile_one(&db, id, &old_path, &new_path) {
                Ok(RefileOutcome::Moved) => {
                    report.moved += 1;
                    undo_items.push(crate::undo_commands::MoveItem {
                        id,
                        from: old_path.clone(),
                        to: new_path.clone(),
                    });
                }
                // Zaten hedefte → skip (same_dir).
                Ok(RefileOutcome::AlreadyInPlace) => {
                    report.skipped.push(RefileSkip { path: old_path, reason: "same_dir".into() });
                }
                Err(e) if e.is_skip() => {
                    report.skipped.push(RefileSkip { path: old_path, reason: e.code() });
                }
                Err(e) => {
                    report.failed.push(RefileFail { path: old_path, error: e.code() });
                }
            }
            emit_progress(&on_progress, processed, total, display, &mut last_emit);
        }

        // Tek ozet audit.
        audit::record_on(
            &db,
            &actor,
            "refile",
            Some("asset"),
            None,
            Some(&format!(
                "{} tasindi / {} atlandi / {} hata → {}",
                report.moved,
                report.skipped.len(),
                report.failed.len(),
                dest_dir
            )),
        );
        // Undo kaydi (best-effort; yalniz fiilen tasinanlar).
        crate::undo_commands::record_moves(
            &db,
            crate::undo_commands::KIND_REFILE_MOVE,
            &dest_dir,
            undo_items,
        );
    } // db kilidi birak

    Ok(report)
}
