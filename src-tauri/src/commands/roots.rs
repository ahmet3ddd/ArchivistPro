//! Kaynak-klasor yonetimi komutlari (H2 Faz-4 pariti): izlenen/taranan kok KAYDI, gruplar
//! ve kok-etiketleri. Izlenen kokler bugune dek localStorage'daydi; GERCEK `scanned_roots`
//! entity'sine tasindi (0020). Renderer DB gormez; yalniz bu komutlari cagirir.
//!
//! Yetki: YAZMA = **admin** (tarama/izleme alani zaten admin — `folder_watcher` start/stop +
//! ScanningTab admin-gated ile tutarli). OKUMA (list_*) gate'siz (ucuz; UI zaten gate'ler).
//! Iki aksiyon: `remove` = listeden cikar (asset'ler KALIR) · `trash` = klasor copu (asset'ler
//! de soft-delete) · `purge` = kalici sil. Yikici aksiyonlar denetim gunlugune islenir.

use std::time::{SystemTime, UNIX_EPOCH};

use archivist_db::{RootGroupRow, ScannedRootRow};
use serde::Serialize;
use tauri::State;

use crate::rbac;
use crate::undo_commands::{
    record_root_group_assign, record_root_group_life, record_root_group_scalar,
    KIND_ROOT_GROUP_CREATE, KIND_ROOT_GROUP_DELETE, KIND_ROOT_GROUP_RECOLOR, KIND_ROOT_GROUP_RENAME,
};
use crate::AppState;

/// Simdiki unix saniye (added_at/last_scan/deleted_at; DB katmani cagirandan bekler).
fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// `add_scanned_root` donusu (frontend camelCase). `newly_added` = yeni
/// satir mi olustu (false → mevcut kok reactivate edildi) — frontend bump karari icin.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddRootResult {
    pub id: i64,
    pub newly_added: bool,
}

/// `ScannedRootRow` + komut katmaninin ekledigi DOSYA-SISTEMI gercegi.
///
/// Neden DB katmaninda DEGIL: `archivist-db` diske BAKMAZ (saf veri katmani, bellek-ici
/// testlerle kosar). "Kok su an erisilebilir mi" bir IO sorusudur → komut katmani cevaplar.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedRootDto {
    #[serde(flatten)]
    pub root: ScannedRootRow,
    /// Kok yolu su an ERISILEBILIR bir klasor mu. `false` = takili olmayan surucu (cikarilmis
    /// USB / kopmus ag yolu) **ya da** silinmis klasor — ikisi ayirt EDILEMEZ, bu yuzden UI
    /// metni "erisilemiyor" der, "silinmis" demez (yanlis suclama olurdu).
    pub path_exists: bool,
}

/// Kok listesine "diskte erisilebilir mi" bilgisini ekle — **bloklayici havuzda**.
///
/// ⚠️ NEDEN `spawn_blocking` (2026-08-11): kopmus bir AG surucusunde `is_dir()` saniyelerce
/// bloklar. `#[tauri::command]` senkron yazilsaydi bu is UI is parcaciginda kosardi
/// (`tauri-macros` `async` olmayan komutu `ExecutionContext::Blocking` uretir) → pencere
/// yanit veremez, Windows `AppHang` ile uygulamayi oldurur. Tam da bu listenin isaretlemeye
/// calistigi durum (erisilemeyen surucu) donma sebebi olamaz.
async fn with_path_existence(rows: Vec<ScannedRootRow>) -> Result<Vec<ScannedRootDto>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        rows.into_iter()
            .map(|root| {
                let path_exists = std::path::Path::new(&root.path).is_dir();
                ScannedRootDto { root, path_exists }
            })
            .collect()
    })
    .await
    // Hata YUTULMAZ: bos liste dondurmek "hic kok yok" gibi okunurdu (sessiz veri kaybi
    // gorunumu) → cagirana gercek hata gider.
    .map_err(|e| format!("kok erisilebilirlik denetimi basarisiz: {e}"))
}

// ── Kokler: listeleme (okuma; gate'siz) ──────────────────────────────────────

/// AKTIF kokler (status='active' & cop degil) + CANLI file_count/pending_count + tags +
/// `path_exists`. "Kaynak Klasorler" paneli + watcher kaynagi (izlenen kok kumesi).
///
/// `async`: govde diske bakar (bkz `with_path_existence`) → UI is parcaciginda kosmamali.
/// DB kilidi `await` ONCESI birakilir (blok kapsami) — guard await'e tasinmaz.
#[tauri::command]
pub async fn list_scanned_roots(state: State<'_, AppState>) -> Result<Vec<ScannedRootDto>, String> {
    let rows = {
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.list_scanned_roots().map_err(|e| e.to_string())?
    };
    with_path_existence(rows).await
}

/// KLASOR COPUNDEKI kokler (is_deleted=1) — geri-yukle/kalici-sil icin. file_count = kok-alti
/// soft-deleted asset sayisi.
#[tauri::command(async)]
pub fn list_trashed_roots(state: State<'_, AppState>) -> Result<Vec<ScannedRootRow>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.list_trashed_roots().map_err(|e| e.to_string())
}

/// LISTEDEN CIKARILMIS kokler (status='removed') — yeniden-aktifle icin.
#[tauri::command(async)]
pub fn list_removed_roots(state: State<'_, AppState>) -> Result<Vec<ScannedRootRow>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.list_removed_roots().map_err(|e| e.to_string())
}

// ── Kokler: kayit / upsert (**admin**) ───────────────────────────────────────

/// Kok ELLE ekle (**admin**). `path` UNIQUE → varsa reactivate. `last_scan` DOKUNULMAZ
/// (henuz taranmadi). Doner: (id, newly). Audit (yalniz yeni).
#[tauri::command(async)]
pub fn add_scanned_root(
    path: String,
    label: String,
    state: State<'_, AppState>,
) -> Result<AddRootResult, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let (id, newly) = db.add_scanned_root(&path, &label, now_secs()).map_err(|e| e.to_string())?;
    if newly {
        crate::audit::record_on(&db, &actor, "root_add", Some("root"), Some(&id.to_string()), Some(&path));
    }
    Ok(AddRootResult { id, newly_added: newly })
}

// NOT: tarama-sonrasi kok kaydinin IPC komutu YOK ve olmamali. `Db::record_root_scan`'i
// `commands::ingest` dogrudan cagirir; yalniz `report.completed_roots` (eksiksiz biten,
// erisilebilir kokler) `last_scan=now` alir. Komut olarak durdugu surece renderer iptal/red
// edilen bir kosuyu "basarili tarama" diye kaydedebiliyordu — 2026-08-05'te (186eb33) kayit
// backend'e tasindi, sarmalayici 2026-08-12'de olu kod olarak kaldirildi.

// ── Kokler: duzenle (**admin**) ──────────────────────────────────────────────

/// Kok etiketini (gorunen ad) degistir (**admin**). Bos → hata (db zorlar).
#[tauri::command(async)]
pub fn rename_scanned_root(
    id: i64,
    label: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_scanned_root(id, &label).map_err(|e| e.to_string())
}

/// Kok favori bayragini ayarla (**admin**).
#[tauri::command(async)]
pub fn set_root_favorite(
    id: i64,
    is_favorite: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_root_favorite(id, is_favorite).map_err(|e| e.to_string())
}

/// Koku bir gruba ata / gruptan cikar (**admin**). `group_id=None` → gruptan cikar. Gecersiz
/// grup → FK hata.
#[tauri::command(async)]
pub fn assign_root_group(
    id: i64,
    group_id: Option<i64>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Undo: mutasyon ONCESI eski grubu yakala (assign geri-al eski gruba dondurur).
    let old_group = db.root_group_of(id).map_err(|e| e.to_string())?;
    db.assign_root_group(id, group_id)
        .map_err(|e| format!("gecersiz grup veya atama hatasi: {e}"))?;
    record_root_group_assign(&db, id, old_group, group_id, &format!("#{id}"));
    Ok(())
}

// ── Kokler: cikar / cop / geri / purge (**admin**) ───────────────────────────

/// Koku LISTEDEN CIKAR (**admin**; status='removed'). Asset'lere DOKUNULMAZ — yalniz kok
/// kaynak/izleme listesinden kalkar; reactivate geri getirir. Audit.
#[tauri::command(async)]
pub fn remove_scanned_root(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_scanned_root(id).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "root_remove", Some("root"), Some(&id.to_string()), None);
    Ok(())
}

/// Listeden cikarilmis koku YENIDEN AKTIFLE (**admin**; status='active').
#[tauri::command(async)]
pub fn reactivate_scanned_root(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.reactivate_scanned_root(id).map_err(|e| e.to_string())
}

/// Koku KLASOR COPUNE at (**admin**; is_deleted=1) + kok-alti AKTIF asset'leri soft-delete.
/// Doner: cope atilan asset sayisi. Audit (detay = asset sayisi).
#[tauri::command(async)]
pub fn trash_scanned_root(id: i64, state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db.trash_scanned_root(id, now_secs()).map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "root_trash",
        Some("root"),
        Some(&id.to_string()),
        Some(&format!("{n} asset")),
    );
    Ok(n)
}

/// Klasor copundeki koku GERI YUKLE (**admin**; is_deleted=0) + kok-alti soft-deleted asset'leri
/// restore. Doner: geri-alinan asset sayisi. Audit.
#[tauri::command(async)]
pub fn restore_scanned_root(id: i64, state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db.restore_scanned_root(id).map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "root_restore",
        Some("root"),
        Some(&id.to_string()),
        Some(&format!("{n} asset")),
    );
    Ok(n)
}

/// Koku KALICI SIL (**admin**; geri-alinamaz) — kok satiri + kok-alti asset'ler trash.rs `purge`
/// ile kalici gider. Doner: silinen asset sayisi. Audit.
#[tauri::command(async)]
pub fn purge_scanned_root(id: i64, state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let n = db.purge_scanned_root(id).map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "root_purge",
        Some("root"),
        Some(&id.to_string()),
        Some(&format!("{n} asset")),
    );
    Ok(n)
}

// ── Gruplar (**admin** yazma; liste gate'siz) ────────────────────────────────

/// Kaynak-klasor grubu OLUSTUR (**admin**). Bos ad → hata; bos renk → varsayilan (#6366f1).
/// Doner: yeni grup id. Audit.
#[tauri::command(async)]
pub fn create_root_group(
    name: String,
    color: String,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = db.create_root_group(&name, &color, now_secs()).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "root_group_create", Some("root_group"), Some(&id.to_string()), Some(&name));
    // Undo: yeni grup bos dogar → root_ids bos; geri-al grubu siler, ileri-al yeniden kurar.
    record_root_group_life(&db, KIND_ROOT_GROUP_CREATE, id, &name, &color, Vec::new());
    Ok(id)
}

/// Tum gruplar + canli root_count (aktif kok sayisi). Salt-okuma.
#[tauri::command(async)]
pub fn list_root_groups(state: State<'_, AppState>) -> Result<Vec<RootGroupRow>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.list_root_groups().map_err(|e| e.to_string())
}

/// Grup adini degistir (**admin**). Bos → hata.
#[tauri::command(async)]
pub fn rename_root_group(id: i64, name: String, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Undo: eski adi mutasyon ONCESI yakala; grup yoksa (None) kayit uretme.
    let old = db.root_group_name_color(id).map_err(|e| e.to_string())?;
    db.rename_root_group(id, &name).map_err(|e| e.to_string())?;
    if let Some((old_name, _)) = old {
        record_root_group_scalar(
            &db,
            KIND_ROOT_GROUP_RENAME,
            id,
            &old_name,
            &name,
            &format!("{old_name} → {name}"),
        );
    }
    Ok(())
}

/// Grup rengini degistir (**admin**).
#[tauri::command(async)]
pub fn recolor_root_group(id: i64, color: String, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // Undo: eski rengi mutasyon ONCESI yakala; grup yoksa kayit uretme. Panel etiketi = grup adi.
    let old = db.root_group_name_color(id).map_err(|e| e.to_string())?;
    db.recolor_root_group(id, &color).map_err(|e| e.to_string())?;
    if let Some((name, old_color)) = old {
        record_root_group_scalar(&db, KIND_ROOT_GROUP_RECOLOR, id, &old_color, &color, &name);
    }
    Ok(())
}

/// Grubu SIL (**admin**). FK SET NULL → o gruptaki kokler KALIR (group_id NULL). Audit.
#[tauri::command(async)]
pub fn delete_root_group(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    // Undo: silme ONCESI ad/renk + uye kokleri yakala (delete FK SET NULL uyeleri NULL'lar →
    // sonra okunamaz). Geri-al grubu ad+renkle yeniden kurar ve bu kokleri yeniden atar.
    let info = db.root_group_name_color(id).map_err(|e| e.to_string())?;
    let members = db.root_ids_in_group(id).map_err(|e| e.to_string())?;
    db.delete_root_group(id).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "root_group_delete", Some("root_group"), Some(&id.to_string()), None);
    if let Some((name, color)) = info {
        record_root_group_life(&db, KIND_ROOT_GROUP_DELETE, id, &name, &color, members);
    }
    Ok(())
}

// ── Kok etiketleri (**admin**) ───────────────────────────────────────────────

/// Koke etiket ekle (**admin**; ada gore upsert → mevcut `tags` tablosu). Doner: tag_id.
#[tauri::command(async)]
pub fn add_root_tag(
    root_id: i64,
    tag_name: String,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.add_root_tag(root_id, &tag_name).map_err(|e| e.to_string())
}

/// Kokten etiket kaldir (**admin**).
#[tauri::command(async)]
pub fn remove_root_tag(
    root_id: i64,
    tag_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.remove_root_tag(root_id, tag_id).map_err(|e| e.to_string())
}

// ── Kaynak-klasor DISK durumu (teshis sondasi) ───────────────────────────────

/// Bir kaynak klasorun DISKTEKI durumu. Yalniz TESHIS icin — hicbir yikici karar buna
/// dayanmaz (silme koruması ingest tarafinda, bagimsiz olarak durur).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FolderSourceState {
    /// Yol YOK (silinmis/tasinmis/yeniden adlandirilmis, ya da ag surucusu bagli degil).
    Missing,
    /// Yol VAR ama okunamiyor (izin reddi / IO hatasi / bozuk baglanti).
    Unreadable,
    /// Yol var ve okunabiliyor → hicbir dosya bulunamadiysa klasor GERCEKTEN bos.
    Ok,
}

/// Yolu sonda ile yokla. **`exists()` KULLANILMAZ**: o, izin hatasinda da `false` doner →
/// "kayip" ile "erisilemez" ayrimini tam da kurmak istedigimiz yerde yok ederdi. Bunun yerine
/// `metadata` hatasinin TURU okunur (`NotFound` → kayip, digeri → erisilemez).
///
/// ⚠️ Windows'ta kopmus AG SURUCUSU platforma gore `NotFound` yerine baska bir hata verebilir →
/// `Unreadable`'a duser. Ikisi de ALARM sinifi oldugu icin mesaj yine dogru tarafta kalir
/// (yalnizca hangi alarm oldugu degisir) — sessiz "bos" yanilgisina DUSMEZ.
pub(crate) fn probe_folder_source(path: &std::path::Path) -> FolderSourceState {
    match std::fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => FolderSourceState::Missing,
        Err(_) => FolderSourceState::Unreadable,
        // Yol var ama artik KLASOR degil (yerine dosya konmus) → kullanici acisindan klasor kayip.
        Ok(m) if !m.is_dir() => FolderSourceState::Missing,
        // Klasor var: listelenebiliyor mu? (izin klasor duzeyinde reddedilebilir)
        Ok(_) => match std::fs::read_dir(path) {
            Ok(_) => FolderSourceState::Ok,
            Err(_) => FolderSourceState::Unreadable,
        },
    }
}

/// Kaynak klasorun disk durumunu bildir (salt-okuma TESHIS; gate'siz — modul basligindaki
/// "OKUMA gate'siz" kuralı. Icerik DONDURMEZ, yalnizca uc-durumlu bir isaret).
///
/// NEDEN VAR (2026-07-19): "yeniden tara → hicbir dosya islenmedi" durumu iki BAMBASKA
/// gercegi tek mesajda topluyordu — *"klasor bos"* (onemsiz) ve *"klasor kayip/erisilemez"*
/// (ALARM: arsivin bir kismi diskle bagini kopardi). Kullanici canli testte tam da bu yuzden
/// kayip-klasoru "ici bos" diye okudu. Ollama'nin *"kurulu degil"* vs *"kurulu ama kapali"*
/// bulgusuyla ayni sinif. Frontend bunu YALNIZ o belirsiz dalda cagirir (rapor bos donunce).
#[tauri::command]
pub fn folder_source_state(path: String) -> FolderSourceState {
    probe_folder_source(std::path::Path::new(&path))
}

#[cfg(test)]
mod source_probe_tests {
    use super::{probe_folder_source, FolderSourceState};

    #[test]
    fn var_olan_klasor_ok() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(probe_folder_source(dir.path()), FolderSourceState::Ok);
    }

    /// Asil regresyon nobeti: SILINEN klasor "bos" DEGIL "kayip" olarak bildirilmeli.
    #[test]
    fn silinen_klasor_missing() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().to_path_buf();
        drop(dir); // klasor artik yok
        assert_eq!(probe_folder_source(&p), FolderSourceState::Missing);
    }

    /// Yeniden adlandirma = eski yol icin silinmeyle AYNI (kullanicinin canli testte yaptigi sey).
    #[test]
    fn yeniden_adlandirilan_klasor_eski_yolda_missing() {
        let parent = tempfile::tempdir().unwrap();
        let eski = parent.path().join("proje");
        let yeni = parent.path().join("proje-yedek");
        std::fs::create_dir(&eski).unwrap();
        std::fs::rename(&eski, &yeni).unwrap();
        assert_eq!(probe_folder_source(&eski), FolderSourceState::Missing);
        assert_eq!(probe_folder_source(&yeni), FolderSourceState::Ok);
    }

    /// Yol var ama klasor DEGIL (yerine dosya konmus) → kullanici acisindan klasor kayip.
    #[test]
    fn dosyayla_degistirilen_klasor_missing() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("artik-dosya");
        std::fs::write(&p, b"x").unwrap();
        assert_eq!(probe_folder_source(&p), FolderSourceState::Missing);
    }

    /// Serilestirme kontrati: frontend union tipi ("missing"|"unreadable"|"ok") ile birebir.
    #[test]
    fn lowercase_serilestirilir() {
        let j = |s| serde_json::to_value(s).unwrap();
        assert_eq!(j(FolderSourceState::Missing), "missing");
        assert_eq!(j(FolderSourceState::Unreadable), "unreadable");
        assert_eq!(j(FolderSourceState::Ok), "ok");
    }
}
