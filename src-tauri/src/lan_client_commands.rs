//! LAN salt-okuma TUKETICI (istemci tarafi — Faz 2). Host korunan yuzeyini (Faz 1) poll eder.
//!
//! Simetrik tasarim: istemci de **admin-gated** — tek-kullanici-cok-makine modelinde ayni operator
//! host'u da istemciyi de yonetir (host'un `require_admin`'i ile tutarli). Baglanti bilgisi
//! (`host`/`port`/`code`) ve okundu-imleci (`seen_id`) **app_meta**'da kalicidir → uygulama
//! yeniden baslasa da eslesme + kaldigimiz yer korunur.
//!
//! Ag cagrilari `ureq` ile **senkron + kisa-timeout** (ollama.rs idiomu) — UI thread'ini
//! kelepcelemez (renderer kisa poll komutlari cagirir). `http_ping`/`http_fetch` AppState'siz **saf**
//! fonksiyonlardir → gercek sunucuya karsi izole test edilir. Kapsam DISI: yazma geri-akisi,
//! dosya transferi (host da salt-okuma).

use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::{rbac, AppState};

/// Eslesilen host adresi (IP/ad) — app_meta anahtari.
const META_HOST: &str = "lan_client_host";
/// Eslesilen host portu (metin; parse edilemezse [`DEFAULT_PORT`]).
const META_PORT: &str = "lan_client_port";
/// 8-hane auth kodu (host uretir; kullanici girer).
const META_CODE: &str = "lan_client_code";
/// Okundu imleci — gorulen en yuksek bildirim `id`'si (poll `since` degeri). Yoksa 0.
const META_SEEN_ID: &str = "lan_client_seen_id";

/// Host'un varsayilan portu — port kayitli degilse bununla denenir (host ile ayni sabit).
const DEFAULT_PORT: u16 = archivist_server::DEFAULT_LAN_PORT;

/// Istemci eslesme durumu (camelCase — TS tarafi bunu okur).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanClientConfig {
    configured: bool,
    host: Option<String>,
    port: u16,
    code: Option<String>,
    seen_id: i64,
}

/// `/ping` sonucu — host ulasilabilir mi + surumu.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanClientPing {
    ok: bool,
    app_version: Option<String>,
}

/// Istemciye donen tek bildirim (camelCase → `createdAt`). Tel tipinden (`Notification`) eslenir.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanClientNotif {
    id: i64,
    created_at: i64,
    kind: String,
    title: String,
    body: Option<String>,
}

/// Connect-timeout'lu agent (host kapaliysa hizli hata; poll UI'yi bekletmez — ollama.rs deseni).
fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(3)).build()
}

/// `GET /ping` (auth'suz — ag kesfi) → `appVersion` string (ulasilamaz/gecersiz → None). Saf/test'li.
pub fn http_ping(host: &str, port: u16) -> Option<String> {
    let url = format!("http://{host}:{port}/ping");
    let resp = agent().get(&url).timeout(Duration::from_secs(4)).call().ok()?;
    let json = resp.into_json::<serde_json::Value>().ok()?;
    json.get("appVersion").and_then(serde_json::Value::as_str).map(String::from)
}

/// `GET /notifications?since=` (auth'lu; `X-Auth-Code`) → `since`'ten yeni bildirimler. Saf/test'li.
/// Hata token'lari sabit (frontend bunlara gore mesaj gosterir): `unauthorized` (401) ·
/// `unreachable` (transport) · `bad_response` (diger HTTP durum / bozuk JSON).
pub fn http_fetch(
    host: &str,
    port: u16,
    code: &str,
    since: i64,
) -> Result<Vec<archivist_server::Notification>, String> {
    let url = format!("http://{host}:{port}/notifications?since={since}");
    match agent().get(&url).set("X-Auth-Code", code).timeout(Duration::from_secs(6)).call() {
        Ok(resp) => resp
            .into_json::<Vec<archivist_server::Notification>>()
            .map_err(|_| "bad_response".to_string()),
        Err(ureq::Error::Status(401, _)) => Err("unauthorized".to_string()),
        Err(ureq::Error::Status(_, _)) => Err("bad_response".to_string()),
        Err(ureq::Error::Transport(_)) => Err("unreachable".to_string()),
    }
}

/// Kayitli eslesme (host + port + COZULMUS kod). Yalniz crate ici — kod disari sizmaz.
pub(crate) struct Pairing {
    pub host: String,
    pub port: u16,
    pub code: String,
}

/// Eslesmeyi app_meta'dan oku (kod DPAPI ile cozulur). Eksikse `None`.
///
/// **Neden ayri yardimci:** `remote_archive` komutlari (editor'e acik) host bilgisini KENDILERI
/// okur — boylece 8-hane kod frontend'e HIC gecmez. Kodu DONEN `lan_client_get_config` ise
/// admin-gate'li kalir. Yetki ayrimi bu ayrimla mumkun oluyor.
pub(crate) fn read_pairing(state: &AppState) -> Result<Option<Pairing>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let Some(host) = db.get_meta(META_HOST).map_err(|e| e.to_string())?.filter(|s| !s.is_empty())
    else {
        return Ok(None);
    };
    let stored = db.get_meta(META_CODE).map_err(|e| e.to_string())?.filter(|s| !s.is_empty());
    let Some(stored) = stored else {
        return Ok(None);
    };
    let code = crate::dpapi::decrypt_lan_auth_code(&stored)?;
    let port = db
        .get_meta(META_PORT)
        .map_err(|e| e.to_string())?
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    Ok(Some(Pairing { host, port, code }))
}

/// Istemci komutlari da admin-gate'li (host ile simetri; lan_commands.rs'ten birebir desen).
fn require_admin(state: &AppState) -> Result<(), String> {
    let role = rbac::current_role(state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())
}

/// Kayitli eslesme durumu (**Admin**). Port/imlec parse edilemezse guvenli varsayilan
/// (DEFAULT_PORT / 0). `configured` = host+kod ikisi de dolu.
#[tauri::command(async)]
pub fn lan_client_get_config(state: State<'_, AppState>) -> Result<LanClientConfig, String> {
    require_admin(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let host = db.get_meta(META_HOST).map_err(|e| e.to_string())?.filter(|s| !s.is_empty());
    // Kod app_meta'da DPAPI ile sifreli → coz (frontend duz-metin kodu wire'da X-Auth-Code'a koyar;
    // sifreleme yalniz DISKTE). Legacy plaintext prefix'siz okunur, sonraki save'de yukseltilir.
    let code = match db.get_meta(META_CODE).map_err(|e| e.to_string())?.filter(|s| !s.is_empty()) {
        Some(stored) => Some(crate::dpapi::decrypt_lan_auth_code(&stored)?),
        None => None,
    };
    let port = db
        .get_meta(META_PORT)
        .map_err(|e| e.to_string())?
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let seen_id = db
        .get_meta(META_SEEN_ID)
        .map_err(|e| e.to_string())?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);
    let configured = host.is_some() && code.is_some();
    Ok(LanClientConfig { configured, host, port, code, seen_id })
}

/// Eslesmeyi kaydet (**Admin**). host trim'lenir (bos → Err); kod tam 8-hane rakam olmali.
/// Yeni eslesme → imlec sifirlanir (host'taki tum bildirimler "yeni" sayilir). Denetim izi.
#[tauri::command(async)]
pub fn lan_client_save_config(
    host: String,
    port: u16,
    code: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_admin(&state)?;
    let host = host.trim().to_string();
    if host.is_empty() {
        return Err("host bos olamaz".to_string());
    }
    let code = code.trim().to_string();
    if code.len() != 8 || !code.bytes().all(|b| b.is_ascii_digit()) {
        return Err("kod 8 haneli rakam olmali".to_string());
    }
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_meta(META_HOST, &host).map_err(|e| e.to_string())?;
    db.set_meta(META_PORT, &port.to_string()).map_err(|e| e.to_string())?;
    // DPAPI ile sifreleyip sakla (kullanici+makine bagli; plaintext DEGIL).
    db.set_meta(META_CODE, &crate::dpapi::encrypt_lan_auth_code(&code)?).map_err(|e| e.to_string())?;
    // Yeni eslesme: imleci sifirla → sonraki fetch tum gecmisi bir kez getirir.
    db.set_meta(META_SEEN_ID, "0").map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "lan_client_pair",
        Some("lan"),
        None,
        Some(&format!("{host}:{port}")),
    );
    Ok(())
}

/// Eslesmeyi temizle (**Admin**). delete_meta yok → host/kod "" + imlec "0" (get_config bos host'u
/// configured=false sayar). Denetim izi.
#[tauri::command(async)]
pub fn lan_client_clear_config(state: State<'_, AppState>) -> Result<(), String> {
    require_admin(&state)?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_meta(META_HOST, "").map_err(|e| e.to_string())?;
    db.set_meta(META_CODE, "").map_err(|e| e.to_string())?;
    db.set_meta(META_SEEN_ID, "0").map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "lan_client_unpair", Some("lan"), None, None);
    Ok(())
}

/// Bir host'u yokla (**Admin**) — eslesmeden once "ulasilabilir mi + surum" testi. Auth gerekmez.
#[tauri::command(async)]
pub fn lan_client_ping(
    host: String,
    port: u16,
    state: State<'_, AppState>,
) -> Result<LanClientPing, String> {
    require_admin(&state)?;
    let v = http_ping(&host, port);
    Ok(LanClientPing { ok: v.is_some(), app_version: v })
}

/// Bildirimleri poll et (**Admin**). `since`'ten yeni bildirimleri getirir. Ag/auth hatasi token'i
/// (`unauthorized`/`unreachable`/`bad_response`) frontend'e Err olarak yansir.
#[tauri::command(async)]
pub fn lan_client_fetch(
    host: String,
    port: u16,
    code: String,
    since: i64,
    state: State<'_, AppState>,
) -> Result<Vec<LanClientNotif>, String> {
    require_admin(&state)?;
    let rows = http_fetch(&host, port, &code, since)?;
    Ok(rows
        .into_iter()
        .map(|n| LanClientNotif {
            id: n.id,
            created_at: n.created_at,
            kind: n.kind,
            title: n.title,
            body: n.body,
        })
        .collect())
}

/// Okundu imlecini ilerlet (**Admin**) — gorulen en yuksek `id`. Sonraki poll bunun ustunu getirir.
#[tauri::command(async)]
pub fn lan_client_mark_seen(seen_id: i64, state: State<'_, AppState>) -> Result<(), String> {
    require_admin(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_meta(META_SEEN_ID, &seen_id.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use archivist_server::{
        ArchiveApi, AssetQueryFn, Notification, NotificationFn, ServerConfig, ServerHandle,
    };

    use super::{http_fetch, http_ping};

    /// Gercek host sunucusu (izole; DB'siz closure) — since<5 → id:5 tek satir, else bos.
    fn start_test_host() -> ServerHandle {
        let notif: NotificationFn = Arc::new(|since, _limit| {
            if since < 5 {
                Ok(vec![Notification {
                    id: 5,
                    created_at: 1_700_000_000_000,
                    kind: "index".into(),
                    title: "yeni cizim".into(),
                    body: None,
                }])
            } else {
                Ok(vec![]) // imlecten yeni yok
            }
        });
        let assets: AssetQueryFn = Arc::new(|_opts| Ok(r#"{"total":0,"items":[]}"#.to_string()));
        ServerHandle::start(
            ServerConfig {
                port: 19481,
                app_version: "1.2.3".into(),
                notifications: notif,
                archive: ArchiveApi { assets, ..ArchiveApi::unavailable() },
            },
            Some("11112222".to_string()),
        )
        .expect("test host'u baslamali")
    }

    #[test]
    fn lan_client_ping_fetch_auth_and_unreachable() {
        let handle = start_test_host();

        // /ping (auth'suz) → surum yansir.
        assert_eq!(http_ping("127.0.0.1", 19481), Some("1.2.3".to_string()));

        // Dogru kod + since=0 → id:5 tek satir (Notification snake_case wire'i deserialize edildi).
        let rows = http_fetch("127.0.0.1", 19481, "11112222", 0).expect("fetch basarili olmali");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 5);

        // since=5 → bos (imlecten yeni yok).
        let rows = http_fetch("127.0.0.1", 19481, "11112222", 5).expect("fetch basarili olmali");
        assert!(rows.is_empty(), "since=5 bos olmali");

        // Yanlis kod → unauthorized token'i.
        let err = http_fetch("127.0.0.1", 19481, "00000000", 0).unwrap_err();
        assert_eq!(err, "unauthorized");

        handle.stop();

        // Hic bind edilmemis port (19482) → transport hatasi = unreachable / ping None.
        let err = http_fetch("127.0.0.1", 19482, "11112222", 0).unwrap_err();
        assert_eq!(err, "unreachable");
        assert_eq!(http_ping("127.0.0.1", 19482), None);
    }
}
