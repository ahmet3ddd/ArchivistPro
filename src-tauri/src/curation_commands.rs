//! Toplu kurasyon komutlari (favori/etiket/koleksiyon) — **delta-bulk uygula + undo kaydet**.
//! **Editor+** (tekil kurasyonla AYNI gate). Frontend eski per-asset dongusu yerine bunlari cagirir
//! → tek kilit · tek undo kaydi · tek IPC gidis-donusu (geri-basinc + hiz). DB katmani yalniz
//! GERCEKTEN degisen alt-kumeyi uygular/dondurur (curation.rs) → undo hassas (zaten favoriliye/
//! etiketliye ikinci kez dokunmaz). Denetim: tekil kurasyon audit'lemedigi icin burada da yok —
//! undo kaydi izleme gorevini ustlenir.

use tauri::State;

use crate::undo_commands;
use crate::{rbac, AppState};

/// Secili asset'lere favori durumu TOPLU ayarla (delta). Doner: DEGISEN sayi. **Editor+**.
#[tauri::command(async)]
pub fn bulk_set_favorite(
    ids: Vec<i64>,
    on: bool,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let changed = db.bulk_set_favorite(&ids, on).map_err(|e| e.to_string())?;
    undo_commands::record_ids(
        &db,
        if on {
            undo_commands::KIND_FAVORITE_ADD
        } else {
            undo_commands::KIND_FAVORITE_REMOVE
        },
        "",
        &changed,
    );
    Ok(changed.len())
}

/// Secili asset'lere etiketi TOPLU ekle (delta). Doner: DEGISEN sayi. **Editor+**.
#[tauri::command(async)]
pub fn bulk_add_tag(
    ids: Vec<i64>,
    name: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let changed = db.bulk_add_tag(&ids, &name).map_err(|e| e.to_string())?;
    undo_commands::record_tag(&db, undo_commands::KIND_TAG_ADD, name.trim(), &changed);
    Ok(changed.len())
}

/// Secili asset'lerden etiketi TOPLU kaldir (delta). Doner: DEGISEN sayi. **Editor+**.
#[tauri::command(async)]
pub fn bulk_remove_tag(
    ids: Vec<i64>,
    name: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let changed = db.bulk_remove_tag(&ids, &name).map_err(|e| e.to_string())?;
    undo_commands::record_tag(&db, undo_commands::KIND_TAG_REMOVE, name.trim(), &changed);
    Ok(changed.len())
}

/// Secili asset'leri ada gore (find-or-create) bir koleksiyona TOPLU ekle. Doner: koleksiyon id.
/// Koleksiyon BU islemle olustuysa undo, uyelikleri kaldirir + bos kalirsa koleksiyonu siler
/// ("koleksiyon olusturdum → geri al → koleksiyon kaybolsun"). **Editor+**.
#[tauri::command(async)]
pub fn bulk_add_to_collection(
    ids: Vec<i64>,
    name: String,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    // find-or-create ONCESI "zaten var miydi" → created bayragi (yalniz yeni olusan geri-alinca silinir).
    let existed = db.collection_id_by_name(name.trim()).map_err(|e| e.to_string())?.is_some();
    let cid = db.create_collection(&name, None).map_err(|e| e.to_string())?;
    let changed = db.bulk_add_to_collection(cid, &ids).map_err(|e| e.to_string())?;
    undo_commands::record_collection(
        &db,
        undo_commands::KIND_COLLECTION_ADD,
        name.trim(),
        cid,
        !existed,
        &changed,
    );
    Ok(cid)
}

/// Secili asset'leri bir koleksiyondan TOPLU cikar (delta). `name` yalniz undo panel etiketi icin.
/// Doner: DEGISEN sayi. **Editor+**.
#[tauri::command(async)]
pub fn bulk_remove_from_collection(
    collection_id: i64,
    ids: Vec<i64>,
    name: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let changed = db.bulk_remove_from_collection(collection_id, &ids).map_err(|e| e.to_string())?;
    undo_commands::record_collection(
        &db,
        undo_commands::KIND_COLLECTION_REMOVE,
        name.trim(),
        collection_id,
        false,
        &changed,
    );
    Ok(changed.len())
}
