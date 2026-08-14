//! Auth + oturum + kullanici yonetimi Tauri komutlari (Faz 6 — B1 cozumu).
//!
//! Tasarim (onayli): **yerel kullanici hesaplari + argon2id**; oturum sunucu-tarafi
//! **bellek-ici** (`AppState.session`) — token YOK, sessions tablosu YOK (tek-surec
//! masaustu; renderer `AppState`'i taklit edemez). Uygulama yeniden baslayinca
//! yeniden-giris beklenir (oturum kalici degildir).
//!
//! Yetki: kullanici-yonetimi komutlari `current_role` → `require_admin` ile korunur
//! (rol oturumdan gelir, istemci argumanindan DEGIL).

use crate::rbac::{self, Role, Session};
use crate::AppState;
use serde::Serialize;
use tauri::State;

/// Renderer'a donen oturum/giris ozeti. `role` `Role` olarak ('admin'|'editor'|
/// 'viewer' lowercase serileşir). Alan adlari snake_case (serde varsayilani).
#[derive(Debug, Clone, Serialize)]
pub struct SessionDto {
    pub user_id: i64,
    pub username: String,
    pub role: Role,
    pub is_founder: bool,
    pub must_change: bool,
}

/// Kullanici listesi satiri (admin paneli) — IPC bicimi.
#[derive(Debug, Clone, Serialize)]
pub struct UserDto {
    pub id: i64,
    pub username: String,
    pub role: Role,
    pub is_founder: bool,
    pub created_at: i64,
}

/// Arşiv-geneli giriş kilidi ayarı. Alanlar snake_case kalır; admin IPC sözleşmesi.
#[derive(Debug, Clone, Serialize)]
pub struct LockoutPolicyDto {
    pub threshold: i64,
    pub duration_minutes: i64,
}

// ── Kurulum + oturum (kimlik-dogrulama gerektirmez) ──────────────────────────

/// Ilk kurulum gerekli mi? (hic kullanici yoksa true → kurulum ekrani gosterilir).
#[tauri::command(async)]
pub fn needs_setup(state: State<'_, AppState>) -> Result<bool, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    Ok(db.user_count().map_err(|e| e.to_string())? == 0)
}

/// Ilk admin hesabini olustur — **yalniz hic kullanici yokken** (else hata).
/// Acik kayit yok; ilk admini bu komut kurar. Oturum ACMAZ (ardindan login gerekir).
#[tauri::command(async)]
pub fn setup_admin(
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    if db.user_count().map_err(|e| e.to_string())? != 0 {
        return Err("kurulum zaten tamamlandi".into());
    }
    db.create_founder_user(&username, "admin", &password, false)
        .map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "setup_admin", Some("user"), None, Some(&username));
    Ok(())
}

/// Giris yap: kimlik dogrula → sunucu-tarafi oturumu kur. Basari → `SessionDto`.
/// Hatali kimlik/kilit dis kodlari (`bad_credentials`/`locked`) db'den gelir.
#[tauri::command(async)]
pub fn login(
    username: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<SessionDto, String> {
    login_inner(&username, &password, &state)
}

/// `login`'in `State` sarmalayicisindan arindirilmis govdesi — `&AppState` alir, boylece
/// oturum kurulumu (ozellikle `must_change` tasinmasi) birim testinden dogrudan surulebilir.
fn login_inner(username: &str, password: &str, state: &AppState) -> Result<SessionDto, String> {
    // 1) Kimlik dogrula (db kilidi). Kilidi oturumdan once birak (deadlock onleme).
    let auth = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        db.verify_credentials(username, password)
            .map_err(|e| e.to_string())?
    };
    // 2) Rolu esle (db TEXT → Role). Gecersizse veri bozulmasi → reddet.
    let role = rbac::parse_role(&auth.role).ok_or("gecersiz rol")?;
    // 3) Oturumu kur.
    let session = Session {
        user_id: auth.id,
        username: auth.username.clone(),
        role,
        is_founder: auth.is_founder,
        // must_change oturuma TASINIR (sabit false degil) → `current_session` tazelemesi
        // zorunlu parola degistirmeyi atlatamaz.
        must_change: auth.must_change,
    };
    *state.session.lock().map_err(|e| e.to_string())? = Some(session);
    // #8 audit — basarili giris (aktor = giren kullanici; oturum artik kurulu → db kilidi ayri alinir).
    crate::audit::record(state, "login", Some("user"), Some(&auth.id.to_string()), Some(&auth.username));

    Ok(SessionDto {
        user_id: auth.id,
        username: auth.username,
        role,
        is_founder: auth.is_founder,
        must_change: auth.must_change,
    })
}

/// Cikis: sunucu-tarafi oturumu temizle (sonraki yazma islemleri reddedilir). Ayrica aktif
/// arsivi ANA'ya dondur → login daima ana users tablosuna gider (ek arsivde cikip login ekraninda
/// kilitlenme onlenir; cok-arsiv invariyanti).
#[tauri::command(async)]
pub fn logout(state: State<'_, AppState>) -> Result<(), String> {
    *state.session.lock().map_err(|e| e.to_string())? = None;
    crate::archive_commands::reset_to_main(&state);
    Ok(())
}

/// O anki oturum (yoksa `null`) — uygulama acilisinda durum tazeleme icin.
#[tauri::command(async)]
pub fn current_session(state: State<'_, AppState>) -> Result<Option<SessionDto>, String> {
    current_session_inner(&state)
}

/// `current_session`'in `&AppState` govdesi (test edilebilirlik — bkz `login_inner`).
fn current_session_inner(state: &AppState) -> Result<Option<SessionDto>, String> {
    let guard = state.session.lock().map_err(|e| e.to_string())?;
    Ok(guard.as_ref().map(|s| SessionDto {
        user_id: s.user_id,
        username: s.username.clone(),
        role: s.role,
        is_founder: s.is_founder,
        // GERCEK deger (oturumdan). Eskiden sabit `false` idi → tazeleme yolu zorunlu
        // parola degistirmeyi atlatiyordu (gerileme).
        must_change: s.must_change,
    }))
}

/// Giris yapmis kullanicinin **kendi** parolasini degistir (eski parola dogrulanir).
#[tauri::command(async)]
pub fn change_password(
    old_password: String,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    change_password_inner(&old_password, &new_password, &state)
}

/// `change_password`'in `&AppState` govdesi (test edilebilirlik — bkz `login_inner`).
fn change_password_inner(
    old_password: &str,
    new_password: &str,
    state: &AppState,
) -> Result<(), String> {
    // Oturumdaki kullanici kimligi (kim oldugunu istemci secemez).
    let user_id = {
        let guard = state.session.lock().map_err(|e| e.to_string())?;
        match guard.as_ref() {
            Some(s) => s.user_id,
            None => return Err("kimlik dogrulanmadi".into()),
        }
    };
    let username = {
        let guard = state.session.lock().map_err(|e| e.to_string())?;
        guard.as_ref().map(|s| s.username.clone()).unwrap_or_default()
    };
    let actor = crate::audit::actor(state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    // Eski parolayi dogrula (oturum varligi parola bilgisini ispatlamaz).
    db.verify_credentials(&username, old_password)
        .map_err(|e| e.to_string())?;
    db.set_password(user_id, new_password)
        .map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "password_change", Some("user"), Some(&user_id.to_string()), None);
    drop(db); // db kilidini oturum kilidinden ONCE birak (kilit-sirasi tutarli → deadlock yok).
    // Parola degisti → `set_password` db'de `must_change_password = 0` yapti; oturumdaki
    // kopyayi da temizle ki `current_session` bayat `true` dondurmesin (kullanici sonsuz
    // "parola degistir" ekraninda kalmasin).
    if let Ok(mut guard) = state.session.lock() {
        if let Some(s) = guard.as_mut() {
            s.must_change = false;
        }
    }
    Ok(())
}

// ── Kullanici yonetimi (admin-gated; rol OTURUMDAN) ──────────────────────────

/// Admin yetkisini oturumdan dogrula (ortak on-kosul).
fn require_admin_session(state: &AppState) -> Result<(), String> {
    let role = rbac::current_role(state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())
}

/// Tum kullanicilar (admin paneli). **Admin** gerekir.
#[tauri::command(async)]
pub fn list_users(state: State<'_, AppState>) -> Result<Vec<UserDto>, String> {
    require_admin_session(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = db.list_users().map_err(|e| e.to_string())?;
    rows.into_iter()
        .map(|u| {
            let role = rbac::parse_role(&u.role).ok_or_else(|| "gecersiz rol".to_string())?;
            Ok(UserDto {
                id: u.id,
                username: u.username,
                role,
                is_founder: u.is_founder,
                created_at: u.created_at,
            })
        })
        .collect()
}

/// Etkin giriş kilidi politikasını oku. **Admin** gerekir.
#[tauri::command(async)]
pub fn get_auth_lockout_policy(state: State<'_, AppState>) -> Result<LockoutPolicyDto, String> {
    require_admin_session(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let policy = db.auth_lockout_policy().map_err(|e| e.to_string())?;
    Ok(LockoutPolicyDto {
        threshold: policy.threshold,
        duration_minutes: policy.duration_minutes,
    })
}

/// Giriş kilidi eşiğini güncelle. **Admin** gerekir; db 3–20 deneme ve 1–120 dakika dışında
/// bir değeri reddeder. Devam eden kilitler korunur, politika sonraki başarısız girişte uygulanır.
#[tauri::command(async)]
pub fn set_auth_lockout_policy(
    threshold: i64,
    duration_minutes: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_admin_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_auth_lockout_policy(threshold, duration_minutes)
        .map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "auth_lockout_policy",
        Some("security"),
        None,
        Some(&format!("{threshold} attempts / {duration_minutes} min")),
    );
    Ok(())
}

/// Yeni kullanici olustur (rol + parola). **Admin** gerekir. id doner.
#[tauri::command(async)]
pub fn admin_create_user(
    username: String,
    role: Role,
    password: String,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    require_admin_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let role_str = role_text(role);
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let id = db
        .create_user(&username, role_str, &password, false)
        .map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "user_create",
        Some("user"),
        Some(&id.to_string()),
        Some(&format!("{username} ({role_str})")),
    );
    Ok(id)
}

/// Kullaniciyi sil. **Admin** gerekir. Son admin silinemez (db korumasi → `last_admin`).
#[tauri::command(async)]
pub fn admin_delete_user(id: i64, state: State<'_, AppState>) -> Result<(), String> {
    require_admin_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_user(id).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "user_delete", Some("user"), Some(&id.to_string()), None);
    Ok(())
}

/// Kullanicinin rolunu degistir. **Admin** gerekir. Son admin dususurulemez.
#[tauri::command(async)]
pub fn admin_set_role(id: i64, role: Role, state: State<'_, AppState>) -> Result<(), String> {
    require_admin_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let role_str = role_text(role);
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_user_role(id, role_str).map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "user_set_role", Some("user"), Some(&id.to_string()), Some(role_str));
    Ok(())
}

/// Kullanicinin parolasini sifirla → `must_change_password=1`. **Admin** gerekir.
#[tauri::command(async)]
pub fn admin_reset_password(
    id: i64,
    new_password: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_admin_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.admin_reset_password(id, &new_password)
        .map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "user_reset_password", Some("user"), Some(&id.to_string()), None);
    drop(db); // db kilidini oturum kilidinden ONCE birak (kilit-sirasi tutarli).
    // Admin KENDI parolasini sifirladiysa db'de `must_change_password = 1` oldu → acik
    // oturumdaki kopya da bunu yansitmali (aksi halde oturum bayat `false` ile zorunlu
    // degistirmeyi atlatir). Baska kullanici sifirlandiginda onun oturumu zaten yok/ayri.
    if let Ok(mut guard) = state.session.lock() {
        if let Some(s) = guard.as_mut() {
            if s.user_id == id {
                s.must_change = true;
            }
        }
    }
    Ok(())
}

/// `Role` → db'nin bekledigi TEXT (lowercase). Tek nokta (sapma onleme).
fn role_text(role: Role) -> &'static str {
    match role {
        Role::Admin => "admin",
        Role::Editor => "editor",
        Role::Viewer => "viewer",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AppState;
    use std::sync::Mutex;

    /// Test icin gercek (bellek-ici) AppState — oturum None baslar.
    fn test_state() -> AppState {
        AppState {
            db: Mutex::new(archivist_db::Db::open_in_memory_migrated().unwrap()),
            // Auth testleri okuma komutu cagirmaz → ayri bos in-memory read_db zararsiz.
            read_db: Mutex::new(archivist_db::Db::open_in_memory_migrated().unwrap()),
            db_path: std::path::PathBuf::from("archivist.db"),
            active_archive: Mutex::new(crate::ArchiveHandle {
                id: archivist_db::MAIN_ARCHIVE_ID.to_string(),
                db_path: std::path::PathBuf::from("archivist.db"),
            }),
            registry: archivist_extract::Registry::new(),
            session: Mutex::new(None),
            embedder: std::sync::Arc::new(Mutex::new(None)),
            image_embedder: Mutex::new(None),
            startup_recovery: crate::recovery::RecoveryInfo::healthy(),
            ollama_translate_fail_ms: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// **A2 gerileme kilidi.** `current_session` sabit `must_change: false` donduruyordu →
    /// oturum-tazeleme yolundan zorunlu parola degistirme ATLATILABILIYORDU. Deger artik
    /// `Session`'da tasinir: login'de `UserAuth`'tan dolar, parola degisince temizlenir.
    #[test]
    fn must_change_survives_session_and_clears_after_password_change() {
        let state = test_state();
        // Zorunlu-degistirme bayrakli kullanici (admin sifirlamasi sonrasi durumu).
        state
            .db
            .lock()
            .unwrap()
            .create_user("greg", "editor", "temp-pw", true)
            .unwrap();

        // login → DTO must_change=true VE oturum kopyasi da true.
        let dto = login_inner("greg", "temp-pw", &state).unwrap();
        assert!(dto.must_change, "login must_change'i dondurmeli");
        // Asil gerileme: tazeleme yolu. Sabit false DEGIL, gercek deger gelmeli.
        let refreshed = current_session_inner(&state).unwrap().expect("oturum kurulu olmali");
        assert!(refreshed.must_change, "current_session gercek must_change'i dondurmeli");

        // Parola degisince zorunluluk kalkar (db'de de, oturum kopyasinda da).
        change_password_inner("temp-pw", "yeni-parola", &state).unwrap();
        let after = current_session_inner(&state).unwrap().expect("oturum durmali");
        assert!(!after.must_change, "parola degisince must_change temizlenmeli");

        // Yeniden giris de temiz gelir (db kaynak-dogrulugu ile tutarli).
        let relogin = login_inner("greg", "yeni-parola", &state).unwrap();
        assert!(!relogin.must_change);
    }

    /// Bayraksiz kullanici hicbir asamada `must_change` gormemeli (yanlis-pozitif yok).
    #[test]
    fn normal_login_reports_no_must_change() {
        let state = test_state();
        state
            .db
            .lock()
            .unwrap()
            .create_user("hana", "viewer", "duz-parola", false)
            .unwrap();

        assert!(!login_inner("hana", "duz-parola", &state).unwrap().must_change);
        assert!(!current_session_inner(&state).unwrap().unwrap().must_change);
    }

    /// Oturum yokken tazeleme `None` doner (kimlik dogrulanmamis durum korunur).
    #[test]
    fn current_session_is_none_without_login() {
        let state = test_state();
        assert!(current_session_inner(&state).unwrap().is_none());
    }

    #[test]
    fn admin_gate_rejects_when_no_session() {
        let state = test_state();
        // Oturum yok → kimlik dogrulanmadi (admin gate gecmez).
        assert!(require_admin_session(&state).is_err());
    }

    #[test]
    fn admin_gate_rejects_viewer_and_editor_but_allows_admin() {
        let state = test_state();

        // Viewer → reddedilir.
        *state.session.lock().unwrap() = Some(Session {
            user_id: 1,
            username: "v".into(),
            role: Role::Viewer,
            is_founder: false,
            must_change: false,
        });
        assert!(require_admin_session(&state).is_err());

        // Editor → reddedilir (yetersiz).
        *state.session.lock().unwrap() = Some(Session {
            user_id: 2,
            username: "e".into(),
            role: Role::Editor,
            is_founder: false,
            must_change: false,
        });
        assert!(require_admin_session(&state).is_err());

        // Admin → gecer.
        *state.session.lock().unwrap() = Some(Session {
            user_id: 3,
            username: "a".into(),
            role: Role::Admin,
            is_founder: false,
            must_change: false,
        });
        assert!(require_admin_session(&state).is_ok());
    }

    #[test]
    fn current_role_reflects_session_state() {
        let state = test_state();
        assert!(rbac::current_role(&state).is_err()); // None → Forbidden

        *state.session.lock().unwrap() = Some(Session {
            user_id: 1,
            username: "e".into(),
            role: Role::Editor,
            is_founder: false,
            must_change: false,
        });
        assert_eq!(rbac::current_role(&state).unwrap(), Role::Editor);
        // Editor require_editor'i gecer, require_admin'i gecmez (viewer yazma denemesi
        // gibi yetersiz-rol durumu burada da dogrulanir).
        assert!(rbac::require_editor(Role::Editor).is_ok());
        assert!(rbac::require_admin(Role::Editor).is_err());
    }
}
