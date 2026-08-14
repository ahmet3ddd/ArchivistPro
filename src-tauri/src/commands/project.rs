//! Proje-durum alanlari (H2 pariti): musteri/onay/versiyon/teslim — tekil + toplu yazma.
//! Facetleri (onay/musteri/versiyon/termin) `facets` modulundedir.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::rbac;
use crate::AppState;
use archivist_db::{ApprovalLogRow, ProjectInput, ProjectMeta, ProjectMetaPatch, ProjectRow};
use serde::Deserialize;
use tauri::State;

// ── Proje-durum alanlari (H2 pariti): musteri/onay/versiyon/teslim ───────────

/// Proje-durum komut argumani (frontend camelCase gonderir). Bos/whitespace string
/// komut katmaninda None'a normalize edilir (alan temizleme). `approval_status`
/// whitelist db katmaninda zorlanir (draft|review|approved|rejected).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetaArg {
    pub client_name: Option<String>,
    pub approval_status: Option<String>,
    pub rejection_reason: Option<String>,
    pub version_label: Option<String>,
    pub deadline: Option<String>,
}

/// Bos/whitespace string'i None'a indir (alan temizleme); doluyu trim'li tut.
fn norm(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Bir asset'in proje-durum alanlarini ayarla. **Editor/Admin** (yazma; etiket/favori
/// ile AYNI gate). Bos/whitespace string → None (alan temizlenir). `approval_status`
/// whitelist disi → hata (db katmani zorlar).
#[tauri::command(async)]
pub fn set_project_meta(
    asset_id: i64,
    meta: ProjectMetaArg,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db_meta = ProjectMeta {
        client_name: norm(meta.client_name),
        approval_status: norm(meta.approval_status),
        rejection_reason: norm(meta.rejection_reason),
        version_label: norm(meta.version_label),
        deadline: norm(meta.deadline),
    };
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Onay gecis gecmisi: eski durumu yazmadan ONCE oku (undo-yakalama deseni).
    let old_status = db
        .project_meta_for(&[asset_id])
        .ok()
        .and_then(|v| v.into_iter().next())
        .and_then(|(_, m)| m.approval_status);
    db.set_project_meta(asset_id, &db_meta).map_err(|e| e.to_string())?;
    // Onay durumu GERCEKTEN degistiyse (from != to) gecis kaydi (best-effort; audit deseni).
    if db_meta.approval_status != old_status {
        let _ = db.record_approval_change(
            asset_id,
            old_status.as_deref(),
            db_meta.approval_status.as_deref(),
            db_meta.rejection_reason.as_deref(),
            &actor.username,
            now_secs(),
        );
    }
    Ok(())
}

/// TOPLU proje-durum arguman (frontend camelCase). Her alan icin `apply*` bayragi: yalniz
/// `true` olan alan yazilir (isaretlenmeyen KORUNUR). Deger bos/whitespace → None (temizle).
/// `approval_status` whitelist db katmaninda zorlanir. `rejection_reason` onaya baglidir (asagi).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkProjectMetaArg {
    #[serde(default)]
    pub apply_client: bool,
    pub client_name: Option<String>,
    #[serde(default)]
    pub apply_approval: bool,
    pub approval_status: Option<String>,
    pub rejection_reason: Option<String>,
    #[serde(default)]
    pub apply_version: bool,
    pub version_label: Option<String>,
    #[serde(default)]
    pub apply_deadline: bool,
    pub deadline: Option<String>,
}

/// `BulkProjectMetaArg` (apply* bayrakli) → DB `ProjectMetaPatch` (uc-durumlu). Saf/test-edilebilir
/// (Tauri'siz). Kural: yalniz `apply*=true` alan patch'e girer (bos → `Some(None)` = temizle; dolu →
/// `Some(Some(v))` trim'li). `rejection_reason` **onaya baglidir** — onay uygulanip 'rejected' ise
/// yaz; onay uygulanip degilse temizle (`Some(None)`); onay uygulanmadiysa red sebebine de dokunma
/// (`None`). Tek-asset `ProjectSection` kuplajiyla birebir ayni.
fn build_project_patch(arg: BulkProjectMetaArg) -> ProjectMetaPatch {
    let rejected = arg.approval_status.as_deref() == Some("rejected");
    ProjectMetaPatch {
        client_name: arg.apply_client.then(|| norm(arg.client_name)),
        approval_status: arg.apply_approval.then(|| norm(arg.approval_status)),
        rejection_reason: if arg.apply_approval {
            if rejected {
                Some(norm(arg.rejection_reason))
            } else {
                Some(None) // onay uygulandi ama reddedilme degil → red sebebini temizle
            }
        } else {
            None // onay uygulanmadi → red sebebine dokunma
        },
        version_label: arg.apply_version.then(|| norm(arg.version_label)),
        deadline: arg.apply_deadline.then(|| norm(arg.deadline)),
    }
}

/// Bir asset KUMESININ proje-durum alanlarini TOPLU ayarla. **Editor/Admin** (tek-asset
/// `set_project_meta` ile AYNI gate; bkz `set_project_meta_requires_editor`). Yalniz `apply*=true`
/// alanlar yazilir (isaretlenmeyen korunur); bos/whitespace → None (temizlenir). `approval_status`
/// whitelist disi → hata (db zorlar). Islem (>=1 satir) **denetim gunlugune** islenir
/// (`project_meta_bulk`, detay = etkilenen sayi). Doner: guncellenen satir sayisi.
#[tauri::command(async)]
pub fn bulk_set_project_meta(
    ids: Vec<i64>,
    patch: BulkProjectMetaArg,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;

    // Undo icin: bu islemin YAZACAGI kolonlar (apply bayraklari; red-sebebi onay kuplajina dahil).
    // build_project_patch arg'i tuketmeden ONCE cikarilir.
    let mut undo_fields: Vec<String> = Vec::new();
    if patch.apply_client {
        undo_fields.push("client_name".into());
    }
    if patch.apply_approval {
        undo_fields.push("approval_status".into());
        undo_fields.push("rejection_reason".into());
    }
    if patch.apply_version {
        undo_fields.push("version_label".into());
    }
    if patch.apply_deadline {
        undo_fields.push("deadline".into());
    }

    // Onay gecis gecmisi icin UYGULANAN yeni durumu build ONCESI yakala (build patch'i tuketir).
    // Bulk ayni durumu tum kumeye uygular → tekil yeni deger. Sebep yalniz 'rejected'ta anlamli.
    let approval_applied = patch.apply_approval;
    let new_status = norm(patch.approval_status.clone());
    let logged_reason = if new_status.as_deref() == Some("rejected") {
        norm(patch.rejection_reason.clone())
    } else {
        None
    };

    let db_patch = build_project_patch(patch);
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Eski degerleri YAZMADAN ONCE yakala (undo geri bunlari yazar; best-effort).
    let captured = if undo_fields.is_empty() {
        Vec::new()
    } else {
        db.project_meta_for(&ids).unwrap_or_default()
    };
    let n = db.bulk_update_project_meta(&ids, &db_patch).map_err(|e| e.to_string())?;
    if n > 0 {
        crate::audit::record_on(
            &db,
            &actor,
            "project_meta_bulk",
            Some("asset"),
            None,
            Some(&n.to_string()),
        );
        // Onay gecis gecmisi: apply_approval iken durumu GERCEKTEN degisen her asset icin kayit
        // (eski deger yukaridaki `captured`'ta). Undo item'lari captured'i tuketmeden ONCE (borrow).
        if approval_applied {
            let now = now_secs();
            for (id, old) in &captured {
                if old.approval_status != new_status {
                    let _ = db.record_approval_change(
                        *id,
                        old.approval_status.as_deref(),
                        new_status.as_deref(),
                        logged_reason.as_deref(),
                        &actor.username,
                        now,
                    );
                }
            }
        }
        // Undo kaydi (best-effort; yalniz fields'taki kolonlar geri yazilir).
        let items = captured
            .into_iter()
            .map(|(id, m)| crate::undo_commands::MetaItem {
                id,
                client_name: m.client_name,
                approval_status: m.approval_status,
                rejection_reason: m.rejection_reason,
                version_label: m.version_label,
                deadline: m.deadline,
            })
            .collect();
        crate::undo_commands::record_project_meta(
            &db,
            &crate::undo_commands::MetaPayload {
                fields: undo_fields,
                items,
                // Redo icin uygulanan YENI degerler (undo eski degerleri; redo bunlari).
                applied: crate::undo_commands::AppliedMeta::from_patch(&db_patch),
            },
        );
    }
    Ok(n)
}

/// Bir asset'in ONAY GECIS gecmisi (en yeni once; H2 `approval_log` pariti). Salt-okuma (her rol;
/// detay panelindeki "Onay gecmisi"). En cok 100 gecis. `set_project_meta`/`bulk_set_project_meta`
/// onay durumu degistiginde bir satir yazar → burada okunur.
#[tauri::command(async)]
pub fn list_approval_log(
    asset_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<ApprovalLogRow>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.list_approval_log(asset_id, 100).map_err(|e| e.to_string())
}

// ── `projects` ENTITY (adli proje nesnesi + asset atama; H2'nin OLU tablosunun aksine gercek) ──
//
// Per-asset proje-durum alanlari (yukarida) BAGIMSIZ kalir (MVP; COALESCE/inheritance v2). Bu
// katman katkisal: proje CRUD + asset↔proje atama (FK; silme SET NULL → asset KALIR). Yazma =
// editor+ (set_project_meta ile ayni gate); okuma (list) gate'siz.

/// Simdiki unix saniye (proje `created_at`; DB katmani cagirandan bekler — H3 konvansiyonu).
fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Proje OLUSTUR (**editor+**). Bos ad → hata (db zorlar). Doner: yeni proje id. Audit.
#[tauri::command(async)]
pub fn create_project(input: ProjectInput, state: State<'_, AppState>) -> Result<i64, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = db.create_project(&input, now_secs()).map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "project_create",
        Some("project"),
        Some(&id.to_string()),
        Some(input.name.as_str()),
    );
    Ok(id)
}

/// TUM projeler + aktif asset sayisi (salt-okuma; her rol). "Projeler" gorunumu + proje-filtre kaynagi.
#[tauri::command(async)]
pub fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectRow>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.list_projects().map_err(|e| e.to_string())
}

/// Proje GUNCELLE (**editor+**; ad + meta full-replace). Bos ad / olmayan id → hata.
#[tauri::command(async)]
pub fn update_project(
    id: i64,
    input: ProjectInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.update_project(id, &input).map_err(|e| e.to_string())
}

/// Proje SIL (**editor+**). FK SET NULL → atanmis asset'ler KALIR (`project_id` NULL olur), SILINMEZ.
/// Audit.
#[tauri::command(async)]
pub fn delete_project(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_project(id).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "project_delete", Some("project"), Some(&id.to_string()), None);
    Ok(())
}

/// Asset'leri projeye ATA / atamayi kaldir (**editor+**). `project_id=None` → atamayi kaldir.
/// Olmayan projeye atama → FK hata ("gecersiz proje"). Audit. Doner: etkilenen satir sayisi.
#[tauri::command(async)]
pub fn assign_assets_to_project(
    ids: Vec<i64>,
    project_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db
        .assign_assets_to_project(&ids, project_id)
        .map_err(|e| format!("gecersiz proje veya atama hatasi: {e}"))?;
    if n > 0 {
        let detail = match project_id {
            Some(pid) => format!("{n} asset → proje #{pid}"),
            None => format!("{n} asset proje atamasi kaldirildi"),
        };
        crate::audit::record_on(&db, &actor, "project_assign", Some("asset"), None, Some(&detail));
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use crate::commands::test_support::{set_role, test_state};
    use crate::rbac::{self, Role};

    /// set_project_meta GATE'i: editor+ (current_role → require_editor; etiket/favori
    /// ile AYNI kademe). Viewer reddedilir; editor ve admin gecer; oturumsuz reddedilir.
    #[test]
    fn set_project_meta_requires_editor() {
        let state = test_state();
        // Oturum yok → kimlik dogrulanmadi (gate gecmez).
        assert!(rbac::current_role(&state).is_err());

        // Viewer → reddedilir.
        set_role(&state, Role::Viewer);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_editor(role).is_err(), "viewer proje-durum yazamamali");

        // Editor → gecer.
        set_role(&state, Role::Editor);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_editor(role).is_ok());

        // Admin → gecer.
        set_role(&state, Role::Admin);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_editor(role).is_ok());
    }

    /// `norm`: bos/whitespace → None (alan temizleme); dolu → trim'li Some.
    #[test]
    fn norm_empties_to_none_and_trims() {
        use super::norm;
        assert_eq!(norm(None), None);
        assert_eq!(norm(Some("".into())), None);
        assert_eq!(norm(Some("   ".into())), None);
        assert_eq!(norm(Some("  Villa  ".into())).as_deref(), Some("Villa"));
    }

    /// `build_project_patch`: apply* bayragi → uc-durum eslesmesi + `rejection_reason` onay
    /// kuplaji (tek-asset ProjectSection kuralinin toplu karsiligi). Saf, State gerekmez.
    #[test]
    fn build_project_patch_maps_flags_and_rejection_coupling() {
        use super::{build_project_patch, BulkProjectMetaArg};

        // Yalniz onay uygulanir (approved). Diger alanlar isaretsiz → None (dokunma).
        // Onay 'rejected' DEGIL → red sebebi temizlenir (Some(None)), eski deger gitmis olsa da.
        let p = build_project_patch(BulkProjectMetaArg {
            apply_client: false,
            client_name: Some("X".into()),
            apply_approval: true,
            approval_status: Some("approved".into()),
            rejection_reason: Some("eski".into()),
            apply_version: false,
            version_label: None,
            apply_deadline: false,
            deadline: None,
        });
        assert_eq!(p.client_name, None, "isaretsiz alan → dokunma");
        assert_eq!(p.approval_status, Some(Some("approved".to_string())));
        assert_eq!(p.rejection_reason, Some(None), "onay var + reddedilme degil → red sebebi temizlenir");
        assert_eq!(p.version_label, None);
        assert_eq!(p.deadline, None);

        // Reddedilme → red sebebi trim'li yazilir.
        let p = build_project_patch(BulkProjectMetaArg {
            apply_client: false,
            client_name: None,
            apply_approval: true,
            approval_status: Some("rejected".into()),
            rejection_reason: Some("  eksik olcu  ".into()),
            apply_version: false,
            version_label: None,
            apply_deadline: false,
            deadline: None,
        });
        assert_eq!(p.approval_status, Some(Some("rejected".to_string())));
        assert_eq!(p.rejection_reason, Some(Some("eksik olcu".to_string())), "reddedilme → red sebebi yazilir");

        // Onay UYGULANMADI → red sebebine dokunulmaz (None). Uygulanan client trim'li.
        let p = build_project_patch(BulkProjectMetaArg {
            apply_client: true,
            client_name: Some("  Acme  ".into()),
            apply_approval: false,
            approval_status: Some("approved".into()),
            rejection_reason: Some("x".into()),
            apply_version: false,
            version_label: None,
            apply_deadline: false,
            deadline: None,
        });
        assert_eq!(p.client_name, Some(Some("Acme".to_string())), "uygulanan alan trim'li");
        assert_eq!(p.approval_status, None, "onay uygulanmadi → dokunma");
        assert_eq!(p.rejection_reason, None, "onay uygulanmadi → red sebebine dokunma");

        // Uygulanan ama bos deger → temizle (Some(None)).
        let p = build_project_patch(BulkProjectMetaArg {
            apply_client: true,
            client_name: Some("   ".into()),
            apply_approval: false,
            approval_status: None,
            rejection_reason: None,
            apply_version: true,
            version_label: Some(String::new()),
            apply_deadline: true,
            deadline: None,
        });
        assert_eq!(p.client_name, Some(None), "uygulanan + bos → temizle");
        assert_eq!(p.version_label, Some(None), "uygulanan + bos → temizle");
        assert_eq!(p.deadline, Some(None), "uygulanan + None → temizle");
    }
}
