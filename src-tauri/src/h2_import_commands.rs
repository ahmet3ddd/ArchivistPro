//! H2→H3 kayipsiz veri aktarimi — ince `#[tauri::command(async)]` sarmalayicilar.
//!
//! Saf cekirdek `archivist-h2import` crate'inde (envanter/kuru-kosu/uygula + testleri).
//! Burada yalniz IPC kabugu: `require_admin`, db kilidi, pre-import YEDEK, Channel
//! ilerleme-koprusu, best-effort audit, `signal_index` (archive_share_commands deseni).
//!
//! TOCTOU notu: kuru kosu ile uygula arasinda plan CACHE'LENMEZ — `apply` her karari
//! kendi kilidi altinda probe'lardan YENIDEN verir (motorun tasarimi). Kuru kosu yalniz
//! kullaniciya on-gosterimdir; bayat plan uygulanamaz.

use std::path::PathBuf;

use tauri::ipc::Channel;
use tauri::State;

use archivist_h2import::{
    apply, dry_run, inventory, H2Inventory, H2ImportReport, H2Source, ImportOptions,
    ImportProgress,
};

use crate::{audit, indexer, rbac, AppState};

/// UI onay kutulari (camelCase IPC). Varsayilanlar acik (kayipsizlik).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct H2ImportOptionsDto {
    pub include_deleted: bool,
    pub include_thumbnails: bool,
}
impl From<H2ImportOptionsDto> for ImportOptions {
    fn from(d: H2ImportOptionsDto) -> Self {
        Self { include_deleted: d.include_deleted, include_thumbnails: d.include_thumbnails }
    }
}

fn now_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// ① ENVANTER (ADMIN; H2 salt-okuma — H3'e hic dokunmaz). Kullanici adlari icerdigi
/// icin (parola-tasinamaz raporu) viewer/editor'a ACILMAZ.
#[tauri::command(async)]
pub fn h2_import_inventory(
    db_path: String,
    state: State<'_, AppState>,
) -> Result<H2Inventory, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    inventory(&PathBuf::from(db_path)).map_err(|e| e.to_string())
}

/// ② KURU KOSU (ADMIN; H3'e YAZMAZ — motor DrySink; test `dry_run_writes_nothing` kilitler).
/// `async`: 41k satirda saniyeler surebilir → UI donmasin (govde bloklayici, reindex deseni).
#[tauri::command]
pub async fn h2_import_dry_run(
    db_path: String,
    opts: H2ImportOptionsDto,
    on_progress: Channel<ImportProgress>,
    state: State<'_, AppState>,
) -> Result<H2ImportReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let src = H2Source::open(&PathBuf::from(&db_path)).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    dry_run(&db, &src, &opts.into(), crate::vision::DRAWING_TYPES, now_secs(), |p| {
        let _ = on_progress.send(p);
    })
    .map_err(|e| e.to_string())
}

/// ③ UYGULA (ADMIN). Sira: gate → actor (kilit ONCESI — nested-lock onleme) →
/// **PRE-IMPORT YEDEK** (snapshots/pre-h2-import-<ms>.db) → kilit altinda apply →
/// audit → kilit birak → `signal_index` (import edilen satirlar `indexed_at=NULL` →
/// metin/AI kuyrugu dogal devralir).
#[tauri::command]
pub async fn h2_import_apply(
    db_path: String,
    opts: H2ImportOptionsDto,
    on_progress: Channel<ImportProgress>,
    state: State<'_, AppState>,
) -> Result<H2ImportReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state); // db kilidi ONCESI (nested-lock onleme)
    let snapshots_dir = crate::backup_commands::snapshots_dir(&state)?;
    let src = H2Source::open(&PathBuf::from(&db_path)).map_err(|e| e.to_string())?;

    let report = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;

        // Tam geri-donus garantisi: uygulamadan ONCE yedek (Ayarlar > Yedekler'den donulur).
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let backup = snapshots_dir.join(format!("pre-h2-import-{ms}.db"));
        db.backup_to(&backup).map_err(|e| format!("pre-import yedek alinamadi: {e}"))?;

        let report = apply(&mut db, &src, &opts.into(), crate::vision::DRAWING_TYPES, now_secs(), |p| {
            let _ = on_progress.send(p);
        })
        .map_err(|e| e.to_string())?;

        audit::record_on(
            &db,
            &actor,
            "h2_import",
            None,
            None,
            Some(&format!(
                "{} yeni / {} mevcut / {} AI / {} etiket / kaynak: {}",
                report.assets_inserted, report.assets_existing, report.ai_written,
                report.tags_written, db_path
            )),
        );

        // Kalici "son aktarim" ozeti → LegacyArchiveCard "yapilmis is" modu (2026-08-13 kullanici
        // bulgusu: kartin hafizasi yoktu, bitmis is yapilmamis gibi gorunuyordu). Best-effort:
        // ozet yazilamazsa BASARILI aktarim hataya cevrilmez (audit deseniyle ayni tercih).
        let summary = crate::legacy_h2::H2LastImportDto {
            ts: now_secs(),
            source: db_path.clone(),
            inserted: report.assets_inserted as i64,
            existing: report.assets_existing as i64,
            ai: report.ai_written as i64,
            tags: report.tags_written as i64,
        };
        if let Ok(json) = serde_json::to_string(&summary) {
            let _ = db.set_meta(crate::legacy_h2::META_H2_LAST_IMPORT, &json);
        }
        report
    }; // kilit birakilir → signal_index kendi kilidini alabilir

    indexer::signal_index();
    Ok(report)
}
