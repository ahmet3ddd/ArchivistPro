//! Runtime RBAC — karar: **tek binary + runtime rol** (RATIONALE §5.6).
//!
//! Gercek yetki BURADA, Rust command icinde zorlanir (`require_admin` deseni).
//! Frontend'deki izin yalniz UI gorunurlugu icindir; guvenlik siniri degildir.
//!
//! SECURITY (Faz 6 / auth — B1 COZULDU): Rol artik istemci IPC argumani DEGIL.
//! Sunucu-tarafi kimlik-dogrulanmis oturumdan (`AppState.session`) gelir; renderer
//! `AppState`'i taklit edemez (tek-surec masaustu). `current_role(state)` oturumu
//! okur, yetki gate'leri rolu oradan alir. Bkz STATUS "B1", auth_commands.rs.

use crate::AppState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Admin,
    Editor,
    Viewer,
}

/// Rol metnini (`db` katmaninin dondurdugu TEXT) `Role`'a esle. Bilinmeyen → `None`.
/// DB CHECK kisiti gecerli degerleri zorlar; bu yine de savunma katmanidir.
pub fn parse_role(s: &str) -> Option<Role> {
    match s {
        "admin" => Some(Role::Admin),
        "editor" => Some(Role::Editor),
        "viewer" => Some(Role::Viewer),
        _ => None,
    }
}

/// Sunucu-tarafi kimlik-dogrulanmis oturum — kullanici girince `AppState.session`'a
/// yazilir, cikinca temizlenir. Rol BURADAN okunur (istemci argumanindan DEGIL).
#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub user_id: i64,
    pub username: String,
    pub role: Role,
    /// Bu arşivin tek ana yöneticisi mi? Rolü yine admin olmalıdır; bu ek işaret,
    /// yerel öneri gelen kutusu gibi ana-admina özel işlemler için kullanılır.
    pub is_founder: bool,
    /// Zorunlu parola degistirme bekliyor mu (admin sifirlamasi sonrasi `must_change_password=1`).
    ///
    /// NEDEN oturumda: `current_session` bu degeri sabit `false` donduruyordu → sayfa
    /// tazeleme/oturum-tazeleme yolundan zorunlu parola degistirme ATLATILABILIYORDU.
    /// Kaynak dogruluk `users.must_change_password`; oturum kurulurken `UserAuth`'tan
    /// doldurulur, parola basariyla degisince `false`'a cekilir (db'de de 0'lanir).
    pub must_change: bool,
}

/// O anki kimlik-dogrulanmis rolu oturumdan al. Oturum yoksa (giris yapilmamis) →
/// `Forbidden`. Tum yazma gate'leri once bunu cagirir (B1: rol sunucudan gelir).
pub fn current_role(state: &AppState) -> Result<Role, Forbidden> {
    let guard = state
        .session
        .lock()
        .map_err(|_| Forbidden("session_unreadable"))?;
    match guard.as_ref() {
        Some(s) => Ok(s.role),
        None => Err(Forbidden("no_session")),
    }
}

/// O anki oturumu (klonlanmis kopya) al — audit aktor snapshot'i vb. Oturum yoksa `None`.
/// Kilit yalniz kisa sure tutulur (klonlanir, birakilir) → db kilidiyle es-zamanli tutulmaz.
pub fn current_session(state: &AppState) -> Option<Session> {
    state.session.lock().ok().and_then(|g| g.clone())
}

/// `Role` → db/audit TEXT (lowercase). Tek dogruluk noktasi (sapma onleme).
pub fn role_str(role: Role) -> &'static str {
    match role {
        Role::Admin => "admin",
        Role::Editor => "editor",
        Role::Viewer => "viewer",
    }
}

/// Yetersiz yetki hatasi. Yuk **kararli bir koddur** (serbest metin DEGIL):
/// `no_session` · `session_unreadable` · `admin_required` · `founder_required` · `editor_required`.
///
/// ⚠️ `Display` bilerek ASCII/dil-notrdur. Bu deger `map_err(|e| e.to_string())` zinciriyle
/// dogrudan UI'a tasinabildiginden, onceki Turkce metin ("yetki reddedildi: bu islem admin
/// yetkisi gerektirir") EN/AR/JA/ZH oturumlarinda ekrana cikiyordu (2026-08-17 denetimi).
/// Kullaniciya gosterilecek metin frontend'de `authError.ts` → `auth.error.*` ile uretilir.
#[derive(Debug)]
pub struct Forbidden(pub &'static str);

impl std::fmt::Display for Forbidden {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "forbidden: {}", self.0)
    }
}

impl std::error::Error for Forbidden {}

/// Admin gerektiren komutlarin basinda cagrilir. Frontend'e ASLA guvenme.
pub fn require_admin(role: Role) -> Result<(), Forbidden> {
    match role {
        Role::Admin => Ok(()),
        _ => Err(Forbidden("admin_required")),
    }
}

/// Ana admin gerektiren komutları oturumdan zorla. Bu, normal admin rolünden ayrı
/// bir yetkidir; istemci tarafından seçilemez ve yalnız DB'deki is_founder alanından gelir.
pub fn require_founder(session: &Session) -> Result<(), Forbidden> {
    if session.is_founder && session.role == Role::Admin {
        Ok(())
    } else {
        Err(Forbidden("founder_required"))
    }
}

/// Editor veya admin gerektiren komutlar (kurasyon: etiket/favori). Viewer salt-okuma.
pub fn require_editor(role: Role) -> Result<(), Forbidden> {
    match role {
        Role::Admin | Role::Editor => Ok(()),
        Role::Viewer => Err(Forbidden("editor_required")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_admin_passes_require_admin() {
        assert!(require_admin(Role::Admin).is_ok());
        assert!(require_admin(Role::Editor).is_err());
        assert!(require_admin(Role::Viewer).is_err());
    }

    #[test]
    fn only_founder_admin_passes_require_founder() {
        let founder = Session {
            user_id: 1,
            username: "ana".into(),
            role: Role::Admin,
            is_founder: true,
            must_change: false,
        };
        let local_admin = Session {
            user_id: 2,
            username: "yerel".into(),
            role: Role::Admin,
            is_founder: false,
            must_change: false,
        };
        assert!(require_founder(&founder).is_ok());
        assert!(require_founder(&local_admin).is_err());
    }

    #[test]
    fn editor_and_admin_pass_require_editor() {
        assert!(require_editor(Role::Admin).is_ok());
        assert!(require_editor(Role::Editor).is_ok());
        assert!(require_editor(Role::Viewer).is_err());
    }

    #[test]
    fn parse_role_maps_known_and_rejects_unknown() {
        assert_eq!(parse_role("admin"), Some(Role::Admin));
        assert_eq!(parse_role("editor"), Some(Role::Editor));
        assert_eq!(parse_role("viewer"), Some(Role::Viewer));
        assert_eq!(parse_role("root"), None);
        assert_eq!(parse_role("Admin"), None); // tam-kucuk-harf beklenir
        assert_eq!(parse_role(""), None);
    }
}
