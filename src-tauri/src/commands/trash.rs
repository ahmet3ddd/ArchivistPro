//! Cop kutusu (§O trash): soft-delete + restore + purge komutlari.

use crate::rbac;
use crate::AppState;
use archivist_db::AssetRow;
use tauri::State;

// ── §O Cop kutusu (trash): soft-delete + restore + purge ─────────────────────
// Yetki kademesi: soft-delete/restore = editor+ (geri-alinabilir); purge = ADMIN
// (geri-alinamaz kalici silme). Liste/sayim = salt-okuma (her rol). Rol istemciden
// DEGIL, oturumdan (`current_role`) gelir (B1).

/// Verilen asset'leri cop kutusuna at (soft-delete; geri-alinabilir). Asset TUM aktif
/// gorunumlerden gizlenir ama iliskili veri (etiket/favori/koleksiyon) durur. Etkilenen
/// (su an aktif olup cop'e atilan) sayisi doner. **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn trash_assets(ids: Vec<i64>, state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db.soft_delete(&ids).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "trash", Some("asset"), None, Some(&format!("{n} asset")));
    // Undo kaydi (best-effort): geri-al = restore. UI aktif asset'ler yollar → ids birebir geri gelir.
    crate::undo_commands::record_ids(&db, crate::undo_commands::KIND_TRASH, "", &ids);
    Ok(n)
}

/// Verilen asset'leri cop kutusundan geri yukle (restore; yeniden aktif). Etkilenen
/// (cop'te olup geri donen) sayisi doner. **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn restore_assets(ids: Vec<i64>, state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db.restore(&ids).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "restore", Some("asset"), None, Some(&format!("{n} asset")));
    Ok(n)
}

/// Verilen asset'leri KALICI sil (purge; **geri-alinamaz**). Asset + tum iliskili veri
/// (etiket/favori/koleksiyon/metadata/thumbnail/FTS/vektor) silinir. Etkilenen sayisi
/// doner. **ADMIN** (geri-alinamaz → en yuksek yetki; `require_admin`).
#[tauri::command(async)]
pub fn purge_assets(ids: Vec<i64>, state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db.purge(&ids).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "purge", Some("asset"), None, Some(&format!("{n} asset")));
    Ok(n)
}

/// Cop kutusundaki asset'ler (en son atilan ilk). `list_assets` ile ayni `AssetRow`
/// sekli. Salt-okuma (her rol — TrashModal goruntuleme).
#[tauri::command]
pub fn list_trash(state: State<'_, AppState>) -> Result<Vec<AssetRow>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.list_trash().map_err(|e| e.to_string())
}

/// Cop kutusundaki asset sayisi (TrashModal rozeti). Salt-okuma (her rol).
#[tauri::command]
pub fn trash_count(state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.trash_count().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use crate::commands::test_support::{set_role, test_state};
    use crate::rbac::{self, Role};

    /// trash_assets / restore_assets GATE'i: editor+ (current_role → require_editor).
    /// Viewer cop'e atamaz/geri-yukleyemez; editor+ yapabilir; oturumsuz reddedilir.
    #[test]
    fn trash_and_restore_require_editor() {
        let state = test_state();
        // Oturum yok → kimlik dogrulanmadi (gate gecmez).
        assert!(rbac::current_role(&state).is_err());

        // Viewer → reddedilir (trash_assets/restore_assets gate'inin kullandigi yol).
        set_role(&state, Role::Viewer);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_editor(role).is_err(), "viewer cop'e atamamali");

        // Editor → gecer.
        set_role(&state, Role::Editor);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_editor(role).is_ok());

        // Admin → gecer.
        set_role(&state, Role::Admin);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_editor(role).is_ok());
    }

    /// purge_assets GATE'i: ADMIN (geri-alinamaz → current_role → require_admin).
    /// Viewer ve EDITOR purge edemez; yalniz admin.
    #[test]
    fn purge_requires_admin() {
        let state = test_state();

        // Viewer → reddedilir.
        set_role(&state, Role::Viewer);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_admin(role).is_err(), "viewer purge edememeli");

        // Editor → reddedilir (purge geri-alinamaz → editor yetmez).
        set_role(&state, Role::Editor);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_admin(role).is_err(), "editor purge edememeli (admin gerekir)");

        // Admin → gecer.
        set_role(&state, Role::Admin);
        let role = rbac::current_role(&state).unwrap();
        assert!(rbac::require_admin(role).is_ok());
    }
}
