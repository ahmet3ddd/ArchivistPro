//! Audit yardimcilari (#8) — eylem aktorunu oturumdan snapshot'lar + best-effort kayit +
//! log-viewer komutlari. Veri katmani `archivist-db/audit.rs` (append-only, migration 0013);
//! burada komut-tarafi: KIM (oturum) / NE ZAMAN (saat) doldurulur. Audit yazimi asil islemi
//! **BLOKLAMAZ** (hata yutulur) — denetim izi kayarsa bile urun islemi basarili sayilir.

use std::time::{SystemTime, UNIX_EPOCH};

use archivist_db::{AuditInput, AuditRow, Db};
use serde::Serialize;
use tauri::State;

use crate::{rbac, AppState};

/// Audit iz'i saklama suresi (gun). H2 varsayilani ile ayni (`SettingsSecurityTab.tsx:49-55`
/// `audit_retention_days` = **90**). `ARSIV_AUDIT_RETENTION_DAYS` ile gecersiz kilinabilir;
/// **`0` = budama KAPALI** (H2'nin "sinirsiz" secenegi).
///
/// Neden env (ayar tablosu degil): H3'te kullanici-ayarlari icin `app_settings` KV tablosu
/// HENUZ YOK (parite defteri §A'da ⏳). ODA cache tavani da ayni yolu izliyor
/// (`ARSIV_ODA_CACHE_MAX_MB`) → tutarli, gorunur, test-edilebilir kacis kapisi.
pub const DEFAULT_AUDIT_RETENTION_DAYS: i64 = 90;

/// Etkin saklama suresi (gun). Gecersiz/eksik env → varsayilan; negatif → varsayilan.
pub fn retention_days() -> i64 {
    match std::env::var("ARSIV_AUDIT_RETENTION_DAYS") {
        Ok(v) => v.trim().parse::<i64>().ok().filter(|n| *n >= 0).unwrap_or(DEFAULT_AUDIT_RETENTION_DAYS),
        Err(_) => DEFAULT_AUDIT_RETENTION_DAYS,
    }
}

/// Saklama suresi disindaki audit kayitlarini buda (acilista bir kez). `0` → no-op.
/// Silinen kayit sayisini doner.
pub fn prune_expired(db: &Db) -> Result<usize, archivist_db::DbError> {
    let days = retention_days();
    if days == 0 {
        return Ok(0); // budama kapali (H2 "sinirsiz")
    }
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    db.prune_audit_before(now - days * 86_400)
}

/// Eylem aktoru (oturumdan snapshot; oturumsuz → sistem). username/role OWNED → db kilidi
/// ALINMADAN once okunur, kilit altina tasinir (nested-lock/deadlock onleme deseni).
pub struct Actor {
    pub user_id: i64,
    pub username: String,
    pub role: String,
}

/// O anki oturumdan aktoru al (**db kilidi ALINMADAN once cagir**). Oturum yoksa sistem aktoru
/// (user_id=0) — or. ilk kurulum / oturumsuz baglam.
pub fn actor(state: &AppState) -> Actor {
    match rbac::current_session(state) {
        Some(s) => Actor {
            user_id: s.user_id,
            username: s.username,
            role: rbac::role_str(s.role).to_string(),
        },
        None => Actor { user_id: 0, username: "system".into(), role: "system".into() },
    }
}

/// Simdiki unix saniye (audit ts). Saat UNIX_EPOCH oncesine giderse 0 (savunma; asla panik).
fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Bir eylemi audit iz'ine yaz — **best-effort** (hata YUTULUR). ZATEN KILITLI `db` altinda
/// cagrilir; `actor` onceden [`actor`] ile alinmis olmali (session→db nested-lock yok).
pub fn record_on(
    db: &Db,
    actor: &Actor,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    detail: Option<&str>,
) {
    let _ = db.record_audit(&AuditInput {
        ts: now_unix(),
        user_id: actor.user_id,
        username: &actor.username,
        role: &actor.role,
        action,
        target_type,
        target_id,
        detail,
    });
}

/// Best-effort audit — db kilidini KENDI alir (cagiran db kilidi TUTMUYORKEN; or. login,
/// oturum kurulduktan sonra). Aktor oturumdan. Kilit alinamazsa sessiz atlar.
pub fn record(
    state: &AppState,
    action: &str,
    target_type: Option<&str>,
    target_id: Option<&str>,
    detail: Option<&str>,
) {
    let a = actor(state);
    if let Ok(db) = state.db.lock() {
        record_on(&db, &a, action, target_type, target_id, detail);
    }
}

/// Audit log satiri — IPC bicimi (camelCase; log viewer).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRowDto {
    id: i64,
    ts: i64,
    user_id: i64,
    username: String,
    role: String,
    action: String,
    target_type: Option<String>,
    target_id: Option<String>,
    detail: Option<String>,
}

impl From<AuditRow> for AuditRowDto {
    fn from(r: AuditRow) -> Self {
        AuditRowDto {
            id: r.id,
            ts: r.ts,
            user_id: r.user_id,
            username: r.username,
            role: r.role,
            action: r.action,
            target_type: r.target_type,
            target_id: r.target_id,
            detail: r.detail,
        }
    }
}

/// Audit kayitlari (en yeni once, sayfali). **Admin** (denetim = yonetim bilgisi). `limit` 1..=200.
#[tauri::command(async)]
pub fn audit_log(
    limit: i64,
    offset: i64,
    state: State<'_, AppState>,
) -> Result<Vec<AuditRowDto>, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = db.list_audit(limit.clamp(1, 200), offset).map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(AuditRowDto::from).collect())
}

/// Toplam audit kaydi sayisi (sayfalama / rozet). **Admin**.
#[tauri::command(async)]
pub fn audit_count(state: State<'_, AppState>) -> Result<i64, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.audit_count().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_on_writes_and_list_reads_newest_first() {
        let db = archivist_db::Db::open_in_memory_migrated().unwrap();
        let a = Actor { user_id: 3, username: "ahmet".into(), role: "admin".into() };
        record_on(&db, &a, "purge", Some("asset"), Some("42"), Some("1 asset"));
        record_on(&db, &a, "login", Some("user"), None, None);
        let rows = db.list_audit(10, 0).unwrap();
        assert_eq!(rows.len(), 2);
        // Ayni saniye ts → id azalan: son eklenen (login) once.
        assert_eq!(rows[0].action, "login");
        assert_eq!(rows[1].action, "purge");
        assert_eq!(rows[1].username, "ahmet");
        assert_eq!(rows[1].target_id.as_deref(), Some("42"));
        assert_eq!(db.audit_count().unwrap(), 2);
    }
}
