//! Kullanici kurasyonu: etiket + favori (Faz 4.3) ve koleksiyonlar (Faz 4.3b).
//! Yazma = editor+; sayim/liste salt-okuma (her rol).

use crate::rbac;
use crate::AppState;
use archivist_db::CollectionRef;
use tauri::State;

// ── Kullanici kurasyonu (Faz 4.3): etiket + favori (editor+ gate) ────────────

/// Bir asset'e kullanici etiketi ekle. **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn add_tag(
    asset_id: i64,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_user_tag(asset_id, &name).map_err(|e| e.to_string())
}

/// Bir asset'ten etiket bagini kaldir. **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn remove_tag(
    asset_id: i64,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_tag(asset_id, &name).map_err(|e| e.to_string())
}

/// Kullanici etiketinin global rengini ayarla veya temizle. **Editor/Admin**.
#[tauri::command(async)]
pub fn set_tag_color(
    name: String,
    color: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_tag_color(&name, color.as_deref()).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "tag_recolor", Some("tag"), Some(name.trim()), color.as_deref());
    Ok(())
}

/// Etiketi **yeniden adlandir** (varlik duzeyinde; tum asset'lerde birden). **Editor/Admin**.
///
/// H2 `commandRenameTag` pariteli (2026-07-26 davranis-sadakati turu §8). Hedef ad zaten
/// kullanimdaysa DB katmani reddeder (sessiz birlestirme YOK). Geri-alinabilir.
#[tauri::command(async)]
pub fn rename_tag(
    old_name: String,
    new_name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_user_tag(&old_name, &new_name).map_err(|e| e.to_string())?;
    crate::undo_commands::record_tag_rename(&db, old_name.trim(), new_name.trim());
    crate::audit::record_on(
        &db,
        &actor,
        "tag_rename",
        Some("tag"),
        Some(old_name.trim()),
        Some(new_name.trim()),
    );
    Ok(())
}

/// Etiketi **sil** (varlik duzeyinde; tum asset'lerden kalkar) → doner: etkilenen dosya sayisi.
/// **Editor/Admin**. H2 `commandDeleteTag` pariteli.
///
/// Yikici ama **geri-alinabilir**: silmeden ONCE renk + bagli asset id'leri anlik-goruntulenir ve
/// `undo_ops`'a yazilir → "Geri Al" etiketi rengiyle ve tum baglariyla geri kurar (H2 `restoreTag`).
/// UI ayrica onay diyalogu gosterir (kac dosyadan kalkacagi yazili).
#[tauri::command(async)]
pub fn delete_tag(name: String, state: State<'_, AppState>) -> Result<i64, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Anlik-goruntu SILMEDEN ONCE (sonra okunamaz).
    let color = db.tag_color(&name).map_err(|e| e.to_string())?;
    let ids = db.delete_user_tag(&name).map_err(|e| e.to_string())?;
    crate::undo_commands::record_tag_delete(&db, name.trim(), color.as_deref(), &ids);
    crate::audit::record_on(
        &db,
        &actor,
        "tag_delete",
        Some("tag"),
        Some(name.trim()),
        Some(&ids.len().to_string()),
    );
    Ok(ids.len() as i64)
}

/// Favori durumunu ayarla (true=ekle, false=kaldir). **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn set_favorite(
    asset_id: i64,
    on: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_favorite(asset_id, on).map_err(|e| e.to_string())
}

/// Favori asset sayisi (filtre rozeti). Salt-okuma (her rol).
#[tauri::command(async)]
pub fn favorite_count(state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.favorite_count().map_err(|e| e.to_string())
}

// ── Koleksiyonlar (Faz 4.3b): adli asset gruplari (yazma = editor+) ──────────

/// Tum koleksiyonlar + uye sayilari. Salt-okuma (her rol).
#[tauri::command(async)]
pub fn list_collections(state: State<'_, AppState>) -> Result<Vec<CollectionRef>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.list_collections().map_err(|e| e.to_string())
}

/// Koleksiyon olustur (find-or-create; id doner). **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn create_collection(name: String, state: State<'_, AppState>) -> Result<i64, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.create_collection(&name, None).map_err(|e| e.to_string())
}

/// Koleksiyonu sil (uyelikler CASCADE; asset'lere dokunmaz). **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn delete_collection(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_collection(id).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "collection_delete", Some("collection"), Some(&id.to_string()), None);
    Ok(())
}

/// Koleksiyonu yeniden adlandirir. Uyelikler koleksiyon kimligiyle bagli oldugu icin korunur.
/// **Editor/Admin** gerekir; audit kaydina yeni ad yazilir.
#[tauri::command(async)]
pub fn rename_collection(id: i64, name: String, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_collection(id, &name).map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "collection_rename",
        Some("collection"),
        Some(&id.to_string()),
        Some(name.trim()),
    );
    Ok(())
}

/// Koleksiyonun renk rozetini ayarlar veya kaldirir. **Editor/Admin** gerekir.
#[tauri::command(async)]
pub fn set_collection_color(
    id: i64,
    color: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_collection_color(id, color.as_deref()).map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "collection_recolor",
        Some("collection"),
        Some(&id.to_string()),
        color.as_deref(),
    );
    Ok(())
}

/// Bir asset'i koleksiyona ekle. **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn add_to_collection(
    collection_id: i64,
    asset_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_to_collection(collection_id, asset_id).map_err(|e| e.to_string())
}

/// Bir asset'i koleksiyondan cikar. **Editor/Admin** (yazma).
#[tauri::command(async)]
pub fn remove_from_collection(
    collection_id: i64,
    asset_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_from_collection(collection_id, asset_id).map_err(|e| e.to_string())
}
