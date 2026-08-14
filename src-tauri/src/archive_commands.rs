//! Adlandirilmis eszamanli YEREL arsiv komutlari — gercek veri-izole coklu DB.
//!
//! Her yerel arsiv bagimsiz bir SQLite dosyasidir (`archives/<id>/archive.db`); `switch_archive`
//! `AppState.db`/`read_db`'yi o dosyaya yeniden baglar. **Kimlik merkezidir (ana arsivde):**
//! kullanici/mesaj/LAN paylasim yalniz ana arsivde calisir (bkz `require_main_archive`); ek arsivler
//! yalniz-icerik. Oturum rolu bellekte tutuldugundan gecis yeniden-giris gerektirmez.
//!
//! Registry (defter) DAIMA ANA arsivde (`AppState.db_path`) yasar → ek arsivdeki bos kopya
//! kullanilmaz; aktif ek arsivdeyken registry ana DB'den (on-demand salt-okuma) okunur.
//!
//! Yetki: olustur/adlandir/renk/sil/geri-yukle = **admin + ana arsiv**; `switch_archive` = admin
//! (her arsivden). Silme **non-destructive**: dosya `.trash`'e tasinir, registry `deleted_at`.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use archivist_db::{Db, MAIN_ARCHIVE_ID};
use serde::Serialize;
use tauri::State;

use crate::{rbac, recovery, AppState, ArchiveHandle};

const ARCHIVES_DIR: &str = "archives";
const TRASH_DIR: &str = ".trash";
const ARCHIVE_DB_FILE: &str = "archive.db";

/// Bir arsiv anahtari satiri (UI). `isMain`: implicit ana arsiv (ad i18n'de). `active`: su an
/// secili. `assetCount`: yalniz AKTIF arsiv icin dolu (digerlerini saymak dosya acmayi gerektirir).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveDto {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub is_main: bool,
    pub active: bool,
    pub asset_count: Option<i64>,
}

fn require_admin(state: &AppState) -> Result<(), String> {
    let role = rbac::current_role(state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())
}

/// Kimlik/yonetim komutlari (kullanici/mesaj/LAN + arsiv CRUD) YALNIZ ana arsivde. Aktif ek
/// arsivdeyken `archive_not_main` ile reddedilir → frontend "ana arsive gecin" der (sessizce
/// kaybolmaz). `switch_archive` bunu KULLANMAZ (her arsivden gecis serbest).
pub fn require_main_archive(state: &AppState) -> Result<(), String> {
    if state.active_is_main() {
        Ok(())
    } else {
        Err("archive_not_main".into())
    }
}

/// Ana arsivin ust-dizini (tum ek arsivler + `.trash` burada). db_path daima mutlak (setup).
fn db_dir(state: &AppState) -> PathBuf {
    state.db_path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."))
}

/// Bir ek arsivin klasoru: `<db_dir>/archives/<id>/`.
fn archive_dir(dir: &Path, id: &str) -> PathBuf {
    dir.join(ARCHIVES_DIR).join(id)
}

/// Bir ek arsivin DB dosyasi: `<db_dir>/archives/<id>/archive.db`. Duzen deterministik →
/// yol registry string'inden DEGIL, id'den turetilir (ayrac/tasima sorunlarina bagimsiz).
fn archive_db_path(dir: &Path, id: &str) -> PathBuf {
    archive_dir(dir, id).join(ARCHIVE_DB_FILE)
}

/// Silinen arsivin cop klasoru: `<db_dir>/archives/.trash/<id>/`.
fn trash_dir(dir: &Path, id: &str) -> PathBuf {
    dir.join(ARCHIVES_DIR).join(TRASH_DIR).join(id)
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Kararli, dosya-adi-guvenli arsiv kimligi uret (`a<unix_ms>`). Ayni ms cakismasinda (nadir)
/// klasor zaten varsa son-ek arttirilir → benzersiz + var-olan dizinin uzerine yazmaz.
fn gen_archive_id(dir: &Path) -> String {
    let base = format!("a{}", now_ms());
    if !archive_dir(dir, &base).exists() {
        return base;
    }
    for n in 1.. {
        let cand = format!("{base}-{n}");
        if !archive_dir(dir, &cand).exists() {
            return cand;
        }
    }
    base
}

/// Registry'yi (ek arsiv listesi) ANA DB'den oku. Aktif ana arsivdeyse `read_db`; degilse ana
/// DB'ye on-demand salt-okuma baglantisi (aktif ek arsivin `read_db`'si ana registry'yi tasimaz).
fn read_registry(state: &AppState) -> Result<Vec<archivist_db::LocalArchiveRow>, String> {
    if state.active_is_main() {
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.list_local_archives().map_err(|e| e.to_string())
    } else {
        let db = Db::open_readonly(&state.db_path).map_err(|e| e.to_string())?;
        db.list_local_archives().map_err(|e| e.to_string())
    }
}

/// Hedef arsivin DB dosya yolu: `main` → ana `db_path`; ek → deterministik `archives/<id>/archive.db`
/// (yalniz registry'de AKTIF kayitli id'ler). Bulunamazsa `archive_missing`.
fn resolve_archive_path(state: &AppState, id: &str) -> Result<PathBuf, String> {
    if id == MAIN_ARCHIVE_ID {
        return Ok(state.db_path.clone());
    }
    let exists = read_registry(state)?.iter().any(|a| a.id == id);
    if exists {
        Ok(archive_db_path(&db_dir(state), id))
    } else {
        Err("archive_missing".into())
    }
}

/// AKTIF arsivin id'si (kilit zehirlenmesinde ana varsayimi).
fn active_id(state: &AppState) -> String {
    state
        .active_archive
        .lock()
        .map(|h| h.id.clone())
        .unwrap_or_else(|_| MAIN_ARCHIVE_ID.to_string())
}

// ── Komutlar ────────────────────────────────────────────────────────────────

/// Tum yerel arsivler (implicit ANA + ek registry satirlari). Aktif olan `active=true`; ANA daima
/// ilk. `assetCount` yalniz aktif arsiv icin dolu. Salt-okuma (her rol; UI arsiv anahtari).
#[tauri::command(async)]
pub fn list_local_archives(state: State<'_, AppState>) -> Result<Vec<ArchiveDto>, String> {
    let active = active_id(&state);
    // Aktif arsivin asset sayimi (izole; kendi read_db'sinden).
    let active_count = {
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.asset_count().map_err(|e| e.to_string())?
    };

    let mut out = vec![ArchiveDto {
        id: MAIN_ARCHIVE_ID.to_string(),
        name: String::new(), // ANA adi i18n'de (isMain=true) — backend metin uretmez.
        color: None,
        is_main: true,
        active: active == MAIN_ARCHIVE_ID,
        asset_count: (active == MAIN_ARCHIVE_ID).then_some(active_count),
    }];

    for a in read_registry(&state)? {
        let is_active = a.id == active;
        out.push(ArchiveDto {
            id: a.id,
            name: a.name,
            color: a.color,
            is_main: false,
            active: is_active,
            asset_count: is_active.then_some(active_count),
        });
    }
    Ok(out)
}

/// Yeni yerel arsiv olustur (admin + ana arsiv). Kararli id uret → `archives/<id>/` klasoru +
/// migre edilmis bos `archive.db` → registry satirini ANA DB'ye yaz. Ad bos/cakisik → hata.
#[tauri::command(async)]
pub fn create_local_archive(
    name: String,
    color: Option<String>,
    state: State<'_, AppState>,
) -> Result<ArchiveDto, String> {
    require_admin(&state)?;
    require_main_archive(&state)?;

    let dir = db_dir(&state);
    let id = gen_archive_id(&dir);
    let adir = archive_dir(&dir, &id);
    fs::create_dir_all(&adir).map_err(|e| e.to_string())?;

    // Bos + tam-semali arsiv DB'si olustur (migration seti uygulanir).
    let db_file = archive_db_path(&dir, &id);
    Db::open_and_migrate(&db_file).map_err(|e| {
        // Yaridan olusan klasoru temizle (kismi durum birakma).
        let _ = fs::remove_dir_all(&adir);
        e.to_string()
    })?;

    let rel_path = format!("{ARCHIVES_DIR}/{id}/{ARCHIVE_DB_FILE}");
    {
        let db = state.db.lock().map_err(|e| e.to_string())?; // aktif == ana (require_main)
        if let Err(e) =
            db.create_local_archive(&id, name.trim(), color.as_deref(), &rel_path, now_ms())
        {
            drop(db);
            let _ = fs::remove_dir_all(&adir); // registry yazilamadi → dosyayi da geri al
            return Err(e.to_string());
        }
    }
    Ok(ArchiveDto {
        id,
        name: name.trim().to_string(),
        color,
        is_main: false,
        active: false,
        asset_count: None,
    })
}

/// Arsivi yeniden adlandir (admin + ana arsiv). Yol/id korunur → aktif secim ve dosyalar yerinde.
#[tauri::command(async)]
pub fn rename_local_archive(
    id: String,
    name: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_admin(&state)?;
    require_main_archive(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_local_archive(&id, name.trim()).map_err(|e| e.to_string())
}

/// Arsiv rengini ayarla (admin + ana arsiv). `#RRGGBB` veya null (rozeti kaldirir).
#[tauri::command(async)]
pub fn set_local_archive_color(
    id: String,
    color: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_admin(&state)?;
    require_main_archive(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_local_archive_color(&id, color.as_deref()).map_err(|e| e.to_string())
}

/// Arsivi non-destructive SIL (admin + ana arsiv): dosya klasorunu `.trash`'e tasi + registry
/// `deleted_at`. ANA ve AKTIF arsiv silinemez. Once dosyayi tasi, sonra registry'yi isaretle;
/// registry yazimi duserse dosyayi geri tasi (tutarlilik).
#[tauri::command(async)]
pub fn delete_local_archive(id: String, state: State<'_, AppState>) -> Result<(), String> {
    require_admin(&state)?;
    require_main_archive(&state)?;
    if id == MAIN_ARCHIVE_ID {
        return Err("archive_protected".into());
    }
    if id == active_id(&state) {
        return Err("archive_active".into());
    }
    let dir = db_dir(&state);
    let src = archive_dir(&dir, &id);
    let dst = trash_dir(&dir, &id);

    // Dosya klasorunu cope tasi (varsa). Idempotent degil: kaynak yoksa yalniz registry isaretlenir.
    if src.exists() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let _ = fs::remove_dir_all(&dst); // eski cop kalintisi varsa temizle
        fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if let Err(e) = db.soft_delete_local_archive(&id, now_ms()) {
        drop(db);
        let _ = fs::rename(&dst, &src); // registry yazilamadi → dosyayi geri al
        return Err(e.to_string());
    }
    Ok(())
}

/// Silinmis arsivi GERI YUKLE (admin + ana arsiv): `.trash`'ten geri tasi + registry `deleted_at`
/// temizle. Ad bu arada baska aktif arsivce alinmissa reddedilir (registry katmani).
#[tauri::command(async)]
pub fn restore_local_archive(id: String, state: State<'_, AppState>) -> Result<(), String> {
    require_admin(&state)?;
    require_main_archive(&state)?;
    // Once registry'de geri-yukle (ad-cakismasi burada yakalanir); sonra dosyayi geri tasi.
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.restore_local_archive(&id).map_err(|e| e.to_string())?;
    }
    let dir = db_dir(&state);
    let src = trash_dir(&dir, &id);
    let dst = archive_dir(&dir, &id);
    if src.exists() {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// AKTIF arsivi degistir (admin): `db`/`read_db`'yi hedef arsive yeniden bagla. Ingest/oto-indeks
/// kosarken (`archive_busy`) reddedilir — yazma-baglantisi mesguldur, degistirmek veriyi bozardi.
/// Hedef acilirken bozuksa recovery devreye girer (arsiv-basi snapshot'tan). No-op geciste mevcut
/// arsiv doner. Frontend gecis sonrasi tum sorgu/secimi sifirlar (yeni arsivin verisi).
#[tauri::command]
pub fn switch_archive(id: String, state: State<'_, AppState>) -> Result<ArchiveDto, String> {
    require_admin(&state)?;
    let target = id.trim().to_string();

    if target == active_id(&state) {
        return current_archive_dto(&state, &target);
    }
    // Uzun-yazici (folder ingest / oto-indeks) kosarken gecis YOK — yazma baglantisi mesgul.
    if crate::indexer::is_active() {
        return Err("archive_busy".into());
    }
    let path = resolve_archive_path(&state, &target)?;
    if !path.exists() {
        return Err("archive_missing".into());
    }

    // Hedefi kilit TUTMADAN ac (recovery yavas olabilir); sonra hizli takas.
    let (new_write, _recovery) =
        recovery::open_with_recovery(&path).map_err(|e| e.to_string())?;
    let new_read = Db::open_readonly(&path).map_err(|e| e.to_string())?;

    // Takas: active_archive → db → read_db. `try_lock`: bir yazici (ingest) araya girdiyse bloke
    // olmadan `archive_busy` don (asilma yerine hizli, yeniden-denenebilir hata).
    let mut ah = state.active_archive.lock().map_err(|e| e.to_string())?;
    let mut wdb = state.db.try_lock().map_err(|_| "archive_busy".to_string())?;
    let mut rdb = state.read_db.try_lock().map_err(|_| "archive_busy".to_string())?;
    *wdb = new_write;
    *rdb = new_read;
    *ah = ArchiveHandle { id: target.clone(), db_path: path };
    drop((wdb, rdb));
    drop(ah);

    // Onceki arsivin klasor-watcher'larini durdur → gecis sonrasi onlarin olayi YENI (aktif)
    // arsive yanlislikla ingest tetiklemesin (watcher renderer'a olay yayar; renderer state.db'ye
    // yazar). Yeni arsivin watcher'larini renderer, arsiv-degisimini gorup kendi ayarina gore
    // yeniden kurar (folder-watch acik ise). Best-effort: durdurma dusse de veri-butunlugu icin
    // kritik degil (ingest yine admin-komutuyla ve aktif arsive gider).
    let _ = crate::folder_watcher::stop_all_watchers();

    current_archive_dto(&state, &target)
}

/// Aktif arsivi ANA'ya dondur — **cikista** cagrilir: ek arsivde cikilirsa login ekrani ek
/// arsivin (bos) users tablosuna bakip kilitlenirdi; bu, login'i daima ANA'ya baglar. Zaten ana
/// ise no-op. En-iyi-caba: ingest kosuyor (try_lock dusuk) ya da acilis basarisizsa sessizce birak
/// (bir sonraki uygulama acilisi zaten ana ile baslar → guvenli). Cikis nadir + genelde bostadir.
pub fn reset_to_main(state: &AppState) {
    if state.active_is_main() {
        return;
    }
    let main_path = state.db_path.clone();
    let Ok((new_write, _)) = recovery::open_with_recovery(&main_path) else {
        return;
    };
    let Ok(new_read) = Db::open_readonly(&main_path) else {
        return;
    };
    let (Ok(mut ah), Ok(mut wdb), Ok(mut rdb)) =
        (state.active_archive.lock(), state.db.try_lock(), state.read_db.try_lock())
    else {
        return;
    };
    *wdb = new_write;
    *rdb = new_read;
    *ah = ArchiveHandle { id: MAIN_ARCHIVE_ID.to_string(), db_path: main_path };
    drop((ah, wdb, rdb));
    // Ek arsivin watcher'larini durdur (bkz switch_archive gerekcesi).
    let _ = crate::folder_watcher::stop_all_watchers();
}

/// Verilen (aktif olmasi beklenen) id icin DTO kur — ad/renk registry'den (ana → i18n).
fn current_archive_dto(state: &AppState, id: &str) -> Result<ArchiveDto, String> {
    let count = {
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.asset_count().map_err(|e| e.to_string())?
    };
    if id == MAIN_ARCHIVE_ID {
        return Ok(ArchiveDto {
            id: MAIN_ARCHIVE_ID.to_string(),
            name: String::new(),
            color: None,
            is_main: true,
            active: true,
            asset_count: Some(count),
        });
    }
    let row = read_registry(state)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "archive_missing".to_string())?;
    Ok(ArchiveDto {
        id: row.id,
        name: row.name,
        color: row.color,
        is_main: false,
        active: true,
        asset_count: Some(count),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::test_support::test_state;

    /// `require_main_archive`: aktif ANA arsivde Ok; ek arsivde `archive_not_main`. Komut fn'leri
    /// `State` aldigindan (testte kurulamaz) kimlik-guard'i bu &AppState yardimcisiyla dogrulanir
    /// (auth_commands deseni). FS/gecis yollari manuel (tauri dev) dogrulanir — bkz plan.
    #[test]
    fn require_main_archive_gates_on_active() {
        let state = test_state();
        // test_state acilisi ANA arsivdir.
        assert!(state.active_is_main());
        assert!(require_main_archive(&state).is_ok());

        // Aktifi ek arsive cevir → guard reddeder (net token).
        *state.active_archive.lock().unwrap() = ArchiveHandle {
            id: "a1".to_string(),
            db_path: std::path::PathBuf::from("archives/a1/archive.db"),
        };
        assert!(!state.active_is_main());
        assert_eq!(require_main_archive(&state).unwrap_err(), "archive_not_main");
    }

    /// `active_db_path`: ANA'da db_path; ek arsivde o arsivin yolu (snapshot yolu bundan turer).
    #[test]
    fn active_db_path_follows_active_archive() {
        let state = test_state();
        assert_eq!(state.active_db_path(), state.db_path);
        *state.active_archive.lock().unwrap() = ArchiveHandle {
            id: "a1".to_string(),
            db_path: std::path::PathBuf::from("archives/a1/archive.db"),
        };
        assert_eq!(state.active_db_path(), std::path::PathBuf::from("archives/a1/archive.db"));
    }

    /// Yol yardimcilari deterministik duzeni verir (registry string'inden bagimsiz cozum).
    #[test]
    fn path_helpers_layout() {
        let dir = std::path::Path::new("C:/data");
        assert_eq!(archive_db_path(dir, "a1"), std::path::Path::new("C:/data/archives/a1/archive.db"));
        assert_eq!(trash_dir(dir, "a1"), std::path::Path::new("C:/data/archives/.trash/a1"));
    }
}
