//! Asset iliski komutlari (§G / Faz-G) — detay paneli "Iliskiler" sekmesi.
//!
//! Yetki: oku (`asset_relations`) her rol (salt-okuma); ekle/kaldir editor+ (kurasyon yazma;
//! rol OTURUMDAN, B1). Yazmalar **best-effort audit'li** (#8). kind urun-kumesi dogrulanir
//! (bilinmeyen → hata; yikici moda sessizce dusmez deseni). Karsi asset cop'teyse listede cikmaz.

use archivist_db::relations::{GeoAssetRow, VersionTimelineRow};
use archivist_db::RelationRow;
use serde::Serialize;
use tauri::State;

use crate::{audit, rbac, AppState};

/// Gecerli iliski turleri (`relations.kind`; migration 0001 yorumu). Tek dogruluk noktasi.
const RELATION_KINDS: &[&str] = &["duplicate", "version", "xref", "derived", "backup"];

/// Iliski satiri — IPC bicimi (camelCase; detay "Iliskiler" sekmesi).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationDto {
    id: i64,
    kind: String,
    /// `true` → bu asset kaynak (→ karsi); `false` → karsi kaynak (← bu).
    outgoing: bool,
    other_id: i64,
    other_path: String,
    other_file_name: String,
}

impl From<RelationRow> for RelationDto {
    fn from(r: RelationRow) -> Self {
        RelationDto {
            id: r.id,
            kind: r.kind,
            outgoing: r.outgoing,
            other_id: r.other_id,
            other_path: r.other_path,
            other_file_name: r.other_file_name,
        }
    }
}

/// Bir asset'in iliskileri (her iki yon; karsi AKTIF asset'e cozulmus). Salt-okuma (her rol).
#[tauri::command(async)]
pub fn asset_relations(
    asset_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<RelationDto>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = db.relations_for(asset_id).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(RelationDto::from).collect())
}

/// Yerel arsivde GPS koordinati olan aktif varliklar. Harita gorunumu salt-okunurdur.
#[tauri::command(async)]
pub fn geo_assets(state: State<'_, AppState>) -> Result<Vec<GeoAssetRow>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.geo_assets().map_err(|e| e.to_string())
}

/// Secili varligin bagli `version` zinciri (recursive CTE; dongu-guvenli). Salt-okunur.
#[tauri::command(async)]
pub fn version_timeline(
    asset_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<VersionTimelineRow>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.version_timeline(asset_id).map_err(|e| e.to_string())
}

/// Iliski ekle (`src → dst`, kind). **Editor/Admin**. kind gecerli olmali; `src==dst` reddedilir.
/// Tekrar (UNIQUE) → no-op. Best-effort audit (`relation_add`).
#[tauri::command(async)]
pub fn add_relation(
    src_id: i64,
    dst_id: i64,
    kind: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    if !RELATION_KINDS.contains(&kind.as_str()) {
        return Err(format!("gecersiz iliski turu: {kind}"));
    }
    if src_id == dst_id {
        return Err("asset kendine iliskilendirilemez".into());
    }
    let actor = audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db
        .add_relation(src_id, dst_id, &kind)
        .map_err(|e| e.to_string())?;
    if n > 0 {
        audit::record_on(
            &db,
            &actor,
            "relation_add",
            Some("asset"),
            Some(&src_id.to_string()),
            Some(&format!("{kind} -> {dst_id}")),
        );
    }
    Ok(())
}

/// Iliskiyi id ile kaldir. **Editor/Admin**. Best-effort audit (`relation_remove`).
#[tauri::command(async)]
pub fn remove_relation(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db.remove_relation(id).map_err(|e| e.to_string())?;
    if n > 0 {
        audit::record_on(
            &db,
            &actor,
            "relation_remove",
            Some("relation"),
            Some(&id.to_string()),
            None,
        );
    }
    Ok(())
}

/// Aynı-kök OTO-tespit raporu (IPC; camelCase).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectRelationsDto {
    /// Aday grup sayısı (≥2 farklı uzantılı aynı-kök).
    groups: usize,
    /// Yeni oluşturulan `derived` iliski sayısı.
    created: usize,
}

/// Iliskileri OTO-tespit et — UC tur: (1) ayni-kok CAPRAZ-format (`plan.dwg` ↔ `plan.pdf`) →
/// `derived`; (2) ayni-format VERSIYON/kopya zinciri (`plan.dwg` ↔ `plan-rev2.dwg`) → `version`;
/// (3) SIDECAR yedek/kilit/otokayit (`plan.dwl`/`plan.bak`/`plan.sv$`) → kaynak (`plan.dwg`) `derived`.
/// **Admin** (toplu yazma bakim eylemi; ingest'i DEGISTIRMEZ, istek-uzeri, geri-alinabilir).
/// Mevcut/manuel baglari EZMEZ → idempotent. Best-effort audit (`relation_detect`).
#[tauri::command(async)]
pub fn detect_relations(state: State<'_, AppState>) -> Result<DetectRelationsDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let derived = db.detect_same_stem_relations().map_err(|e| e.to_string())?;
    let version = db.detect_version_relations().map_err(|e| e.to_string())?;
    let backup = db.detect_backup_relations().map_err(|e| e.to_string())?;
    let created = derived.created + version.created + backup.created;
    let groups = derived.groups + version.groups + backup.groups;
    if created > 0 {
        audit::record_on(
            &db,
            &actor,
            "relation_detect",
            Some("asset"),
            None,
            Some(&format!(
                "{created} iliski ({} derived / {} version / {} backup) / {groups} grup",
                derived.created, version.created, backup.created
            )),
        );
    }
    Ok(DetectRelationsDto { groups, created })
}
