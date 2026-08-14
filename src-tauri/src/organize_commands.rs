//! Kural-bazli oto-klasorleme komutlari (organize) — refile'in devami. **Admin.**
//!
//! Iki asama (find_duplicates salt-okuma-rapor + refile deseni):
//! 1. [`plan_organize`] → salt-okuma ONIZLEME: her asset → sirali hedef klasor segmentleri.
//!    Disk/DB'ye DOKUNULMAZ (kullanici onaylamadan tasima yok).
//! 2. [`organize_assets`] → CALISTIR: `dest_root + segments.. + file_name` → hedef alt-dizini
//!    olustur → moduna gore **tasi** (`refile_one`: disk + DB senkron + rollback + ezme-yok) ya da
//!    **kopyala** (`copy_file`: fsync'li kopya; DB'ye dokunulmaz, arsiv yerinde kalir). Batch ABORT
//!    ETMEZ (sorunlu oge skipped/failed'e yazilir, kalan devam eder).
//!
//! **Cok-seviye:** `structures` sirali → her structure bir klasor SEVIYESI (`[byYear, byClient]` →
//! `2026/Acme/dosya`). Bos → dosya dogrudan `dest_root`'a. Ikisi de AYNI saf `relative_segments_for`'u
//! cagirir → onizleme ile calistirma birebir tutar.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::Instant;

use archivist_db::{ensure_trailing_sep, relative_segments_for, AssetClass, Structure};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::refile_commands::{
    copy_file, emit_progress, join_path, refile_one, separator_of, RefileBatchReport, RefileFail,
    RefileOutcome, RefileProgress, RefileSkip,
};
use crate::{audit, rbac, AppState};

/// Onizleme ogesi — bir asset'in gidecegi sirali klasor segmentleri (dest_root'a goreli). Frontend
/// `dest_root + segments.join(sep) + fileName` ile tam yolu gosterebilir. Bos `segments` → dosya
/// dogrudan `dest_root`'ta.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizePlanItem {
    id: i64,
    file_name: String,
    segments: Vec<String>,
}

/// Tasima modu — frontend `"move"`/`"copy"`. Kopyala arsivi yerinde birakir (additive).
#[derive(Clone, Copy)]
enum OrganizeMode {
    Move,
    Copy,
}

impl OrganizeMode {
    /// Audit/anahtar yazimi (frontend anahtariyla ayni).
    fn key(self) -> &'static str {
        match self {
            OrganizeMode::Move => "move",
            OrganizeMode::Copy => "copy",
        }
    }
}

/// `classification_for` sonucunu id→kayit haritasina cevir (giris id sirasini korumak icin).
fn class_map(classes: Vec<AssetClass>) -> HashMap<i64, AssetClass> {
    classes.into_iter().map(|c| (c.id, c)).collect()
}

/// Frontend structure anahtarlarini parse et; herhangi biri gecersizse komut-geneli `"invalid_structure"`.
/// Bos dilim gecerli (→ segment yok; dosya dogrudan dest_root'a).
fn parse_structures(keys: &[String]) -> Result<Vec<Structure>, String> {
    keys.iter()
        .map(|k| k.parse::<Structure>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "invalid_structure".to_string())
}

/// Secili asset'lerin oto-klasorleme ONIZLEMESI (salt-okuma). **Admin.** `structures`'tan biri
/// gecersizse komut-geneli Err `"invalid_structure"`. Cop/eksik id planda yer almaz. Giris id sirasi
/// korunur. Her structure bir klasor seviyesi → `segments` (sirali).
#[tauri::command(async)]
pub fn plan_organize(
    ids: Vec<i64>,
    structures: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<OrganizePlanItem>, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    let structures = parse_structures(&structures)?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut by_id = class_map(db.classification_for(&ids).map_err(|e| e.to_string())?);

    let mut plan = Vec::with_capacity(ids.len());
    for id in &ids {
        if let Some(class) = by_id.remove(id) {
            let segments = relative_segments_for(&class, &structures);
            plan.push(OrganizePlanItem {
                id: class.id,
                file_name: class.file_name,
                segments,
            });
        }
    }
    Ok(plan)
}

/// Bir klasor yolunun altindaki (alt klasorler DAHIL) **aktif** asset id'lerini coz. **Admin.**
/// "Klasor sec → icindekileri organize et" akisini besler (salt-okuma; organize komutlarini
/// degistirmez). Yolu ayracla bitir (`ensure_trailing_sep`) → LIKE-onek eslesmesinde kardes klasor
/// sizintisini onle (`Villa` oneki `Villa2`'yi eslestirmez); prefix eslesme oldugu icin alt klasorler
/// dogal olarak DAHIL. Cop'teki (`deleted_at`) asset'ler yok sayilir.
#[tauri::command(async)]
pub fn asset_ids_under_folder(
    folder: String,
    state: State<'_, AppState>,
) -> Result<Vec<i64>, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    let pref = ensure_trailing_sep(&folder);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let ids = db
        .active_paths_under(&pref)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, _)| id)
        .collect();
    Ok(ids)
}

/// Secili asset'leri kurala gore hedef alt-klasorlere yerlestir (`dest_root/segments../file_name`).
/// **Admin.** Batch ABORT ETMEZ. `structures`'tan biri gecersiz → Err `"invalid_structure"`;
/// `mode` gecersiz (`move`/`copy` disi) → Err `"invalid_mode"`; `dest_root` gecersiz (mutlak degil /
/// `..` / olusturulamaz) → Err `"invalid_dest"`/`"dest_create_failed: .."`. `async` — disk islemi
/// yavas olabilir (govde bloklayici, `.await` yok → UI donmaz).
#[tauri::command]
pub async fn organize_assets(
    ids: Vec<i64>,
    dest_root: String,
    structures: Vec<String>,
    mode: String,
    on_progress: Channel<RefileProgress>,
    state: State<'_, AppState>,
) -> Result<RefileBatchReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // kilit-oncesi snapshot

    let structures = parse_structures(&structures)?;
    let mode = match mode.as_str() {
        "move" => OrganizeMode::Move,
        "copy" => OrganizeMode::Copy,
        _ => return Err("invalid_mode".to_string()),
    };

    // Hedef kok dogrula (mutlak + `..` yok) → yoksa olustur (refile_assets ile ayni desen).
    let root = Path::new(&dest_root);
    if dest_root.trim().is_empty() || !root.is_absolute() || dest_root.contains("..") {
        return Err("invalid_dest".to_string());
    }
    fs::create_dir_all(root).map_err(|e| format!("dest_create_failed: {e}"))?;
    let sep = separator_of(&dest_root);

    let total = ids.len();
    let mut report = RefileBatchReport::default();
    let mut last_emit: Option<Instant> = None;
    // Basarili TASINANLAR → tek undo kaydi (yalniz Move; Copy additive → kayit yok).
    let mut undo_items: Vec<crate::undo_commands::MoveItem> = Vec::new();

    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut by_id = class_map(db.classification_for(&ids).map_err(|e| e.to_string())?);

        for (i, &id) in ids.iter().enumerate() {
            let processed = i + 1;

            // Siniflandirma yok (cop/eksik id) → skip.
            let Some(class) = by_id.remove(&id) else {
                report.skipped.push(RefileSkip { path: format!("#{id}"), reason: "not_found".into() });
                emit_progress(&on_progress, processed, total, format!("#{id}"), &mut last_emit);
                continue;
            };

            // Kaynak yolu id-basi oku (aktif filtre classification ile ayni; cop/eksik → skip).
            let old_path = db.paths_for_ids(&[id]).ok().and_then(|v| v.into_iter().next());
            let Some(old_path) = old_path else {
                report.skipped.push(RefileSkip { path: format!("#{id}"), reason: "not_found".into() });
                emit_progress(&on_progress, processed, total, format!("#{id}"), &mut last_emit);
                continue;
            };

            // Hedef = dest_root + sirali segmentler + KAYNAK ADI (ad korunur; onizleme ile ayni kural).
            // join_path her seviyede kok-ayraci ciftlemeyi onler → karisik ayrac uretmeyiz.
            let segments = relative_segments_for(&class, &structures);
            let mut target_dir = dest_root.clone();
            for seg in &segments {
                target_dir = join_path(&target_dir, sep, seg);
            }
            let new_path = join_path(&target_dir, sep, &class.file_name);
            let display = class.file_name.clone();

            // Hedef alt-dizinini olustur (tum seviyeler). Hata → failed (tasima/kopya denenmez).
            if let Err(e) = fs::create_dir_all(&target_dir) {
                report
                    .failed
                    .push(RefileFail { path: new_path, error: format!("dir_create_failed: {e}") });
                emit_progress(&on_progress, processed, total, display, &mut last_emit);
                continue;
            }

            match mode {
                // TASI — mevcut cekirdek: disk + DB senkron + rollback + ezme-yok.
                OrganizeMode::Move => match refile_one(&db, id, &old_path, &new_path) {
                    Ok(RefileOutcome::Moved) => {
                        report.moved += 1;
                        undo_items.push(crate::undo_commands::MoveItem {
                            id,
                            from: old_path.clone(),
                            to: new_path.clone(),
                        });
                    }
                    Ok(RefileOutcome::AlreadyInPlace) => {
                        report.skipped.push(RefileSkip { path: old_path, reason: "same_dir".into() });
                    }
                    Err(e) if e.is_skip() => {
                        report.skipped.push(RefileSkip { path: old_path, reason: e.code() });
                    }
                    Err(e) => {
                        report.failed.push(RefileFail { path: old_path, error: e.code() });
                    }
                },
                // KOPYALA — additive: DB'ye DOKUNMA, rollback YOK, arsiv yerinde kalir. Ezme YOK
                // (hedef doluysa skip). Kaynak bu makinede yoksa graceful skip (cok-lokasyon).
                OrganizeMode::Copy => {
                    if !Path::new(&old_path).exists() {
                        report.skipped.push(RefileSkip { path: old_path, reason: "source_missing".into() });
                    } else if Path::new(&new_path).exists() {
                        report.skipped.push(RefileSkip { path: old_path, reason: "target_exists".into() });
                    } else {
                        match copy_file(Path::new(&old_path), Path::new(&new_path)) {
                            Ok(()) => report.moved += 1,
                            Err(e) => {
                                report.failed.push(RefileFail {
                                    path: old_path,
                                    error: format!("disk_error: {e}"),
                                });
                            }
                        }
                    }
                }
            }
            emit_progress(&on_progress, processed, total, display, &mut last_emit);
        }

        // Tek ozet audit (mode + structures + dest_root + N).
        let structure_keys = structures
            .iter()
            .map(|&s| structure_key(s))
            .collect::<Vec<_>>()
            .join(",");
        audit::record_on(
            &db,
            &actor,
            "organize",
            Some("asset"),
            None,
            Some(&format!(
                "{} · {}/{} → {} [{}]",
                mode.key(),
                report.moved,
                total,
                dest_root,
                structure_keys
            )),
        );
        // Undo kaydi (best-effort; yalniz Move'da dolu — Copy toplamaz).
        crate::undo_commands::record_moves(
            &db,
            crate::undo_commands::KIND_ORGANIZE_MOVE,
            &dest_root,
            undo_items,
        );
    } // db kilidi birak

    Ok(report)
}

/// Audit detayi icin structure anahtari (frontend anahtarlariyla ayni yazim).
fn structure_key(structure: Structure) -> &'static str {
    match structure {
        Structure::ByExt => "byExt",
        Structure::ByClient => "byClient",
        Structure::ByTag => "byTag",
        Structure::ByApproval => "byApproval",
        Structure::ByVersion => "byVersion",
        Structure::ByYear => "byYear",
    }
}
