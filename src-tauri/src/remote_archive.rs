//! Uzak (ana) arsiv OKUMA — LAN Faz 2, istemci tarafi. Tasarim: `docs/design/LAN_ARCHIVE_READ.md`.
//!
//! Calisanin kendi makinesinden ana arsivde **arayabilmesi/gorebilmesi** icin host'un Faz 1
//! `/assets` ucunu tuketir. Yerel DB'ye **HICBIR SEY YAZILMAZ** (H2'nin "indir + uzerine yaz"
//! davranisi bilincle terk edildi; tasarim §7).
//!
//! **YETKI MODELI (kullanici karari, 2026-07-19) — `lan_client_commands`'tan bilincli FARK:**
//! - *Eslesme* (host adresi + 8-hane kod kaydetme) **admin** isidir → `lan_client_save_config`.
//! - *Okuma* (arama/listeleme) **admin + editor**'e acik → makinenin asil calisani `editor`;
//!   admin-only olsaydi ozellik hedef kullanicisina hic ulasmazdi. `viewer` (makineyi gecici
//!   kullanan) uzak arsive ERISEMEZ — kullanicinin tarif ettigi guven merdiveni.
//!
//! 🔒 **Kod (`X-Auth-Code`) frontend'e HIC gecmez.** Komutlar host bilgisini app_meta'dan
//! KENDILERI okur. Boylece editor uzak arsivi okuyabilir ama eslesme sirrini goremez —
//! `lan_client_get_config` (kodu DONEN komut) admin-gate'li kalir.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::lan_client_commands::{read_pairing, Pairing};
use crate::{rbac, AppState};

/// Tipli uzak-arsiv hatasi (tasarim §7). H2'nin "hepsi tek jenerik mesaj" davranisi
/// tekrarlanmaz: kullanici "kod yanlis" ile "host kapali"yi ayirt edebilmeli.
/// [`token`](RemoteError::token) degerleri **tel/i18n sozlesmesidir** — frontend bunlara gore mesaj secer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RemoteError {
    /// Hic eslesme kaydedilmemis (host/kod yok) → UI "once ana arsive baglan" der.
    NotConfigured,
    /// 401 — kaydedilmis kod host'unkiyle uyusmuyor (host kodu yenilemis olabilir).
    AuthFailed,
    /// Istek zaman asimina ugradi (host acik ama yavas/asiri yuklu).
    Timeout,
    /// 429 — host hiz sinirina takildi (Faz 1 rate limit) VEYA IP lockout.
    ServerBusy,
    /// Baglanti kurulamadi (host kapali, ag yok, yanlis adres).
    NetworkError,
    /// Baglanildi ama yanit anlasilmadi (beklenmeyen durum kodu / bozuk JSON / yanlis sekil).
    BadResponse,
    /// 503 — host bu ozelligi SUNAMIYOR (LAN Faz 5): ana arsivde AI/RAG indeksi/modeli hazir DEGIL.
    /// "Sunucu hatasi" (500 → BadResponse) DEGIL; UI "ana arsivde once AI indeksi olusturun" der.
    NotIndexed,
}

impl RemoteError {
    /// Frontend'e giden STABIL token (i18n anahtari buna baglidir — degistirilirse 5 dil de degisir).
    pub fn token(self) -> &'static str {
        match self {
            RemoteError::NotConfigured => "not_configured",
            RemoteError::AuthFailed => "auth_failed",
            RemoteError::Timeout => "timeout",
            RemoteError::ServerBusy => "server_busy",
            RemoteError::NetworkError => "network_error",
            RemoteError::BadResponse => "bad_response",
            RemoteError::NotIndexed => "remote_not_indexed",
        }
    }
}

/// Uzak arsiv baglanti durumu (camelCase — TS tarafi okur).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    /// Eslesme kayitli mi (host + kod var mi). **Kod DEGERI donmez** — yalniz varligi.
    configured: bool,
    /// Host su an ulasilabilir mi (`/ping`).
    reachable: bool,
    /// Host'un uygulama surumu (ulasilabiliyorsa).
    app_version: Option<String>,
    /// Gorunur host etiketi (`ip:port`) — UI'da "Ana arsiv (192.168.1.5)" gibi. Kod ICERMEZ.
    host_label: Option<String>,
}

/// Ana arsivin indeks/sayac ozeti (LAN Faz 5; `/stats` tel-sozlesmesi). Host serilestirir, istemci
/// ayni sekilde ayristirir (Serialize + Deserialize) → kayma yok. camelCase (TS okur). "Ana arsiv ne
/// kadar AI-indeksli" gorunumunu besler; uzak semantik/RAG'in kullanilabilir olup olmadigini gosterir.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatsDto {
    /// Metin vektoru olan (semantik aranabilir) asset sayisi.
    pub vector_count: i64,
    /// Vektoru bekleyen (henuz embedlenmemis) aktif asset.
    pub pending_embed: i64,
    /// En az bir RAG chunk'i olan asset.
    pub chunked_assets: i64,
    /// Chunk'lanmayi bekleyen aktif asset.
    pub pending_chunk: i64,
    /// Toplam RAG chunk (govde + metadata).
    pub chunk_count: i64,
    /// Toplam aktif asset (cop haric).
    pub asset_count: i64,
    /// Klasor (ust-dizin) sayisi.
    pub folder_count: i64,
    /// Host'ta embedding modeli hazir mi (uzak semantik/RAG calisabilir mi).
    pub model_ready: bool,
}

/// Connect-timeout'lu agent (host kapaliysa hizli hata; UI'yi bekletmez — ollama.rs/lan_client idiomu).
fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(3)).build()
}

/// `ureq` transport hatasini tipli hataya cevir. Zaman asimi ile "host kapali" AYRILIR —
/// kullanici icin bambaska iki durum (biri bekle-tekrar-dene, digeri admin'in PC'si kapali).
fn classify_transport(err: &ureq::Transport) -> RemoteError {
    use std::error::Error;
    // Once gercek io hatasinin TURUNE bak (metin eslemesi kirilgan olurdu).
    if let Some(io) = err.source().and_then(|s| s.downcast_ref::<std::io::Error>()) {
        return match io.kind() {
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => RemoteError::Timeout,
            _ => RemoteError::NetworkError,
        };
    }
    // Kaynak io hatasi degilse: ureq bazi zaman asimlarini yalniz metinde tasir (son care).
    if err.to_string().to_ascii_lowercase().contains("timed out") {
        return RemoteError::Timeout;
    }
    RemoteError::NetworkError
}

/// `GET /assets?opts=<kodlanmis json>` → ham `AssetPage` JSON'u. **Saf/test'li** (AppState yok) →
/// gercek host'a karsi izole test edilir.
///
/// `opts_json` host'un `ListOpts`'una AYNEN gider (tel formati = yerel IPC formati). Kodlama
/// `archivist_server::query_api::encode_opts_param` ile — host'un cozucusuyle AYNI modulden.
pub fn http_list_assets(
    host: &str,
    port: u16,
    code: &str,
    opts_json: &str,
) -> Result<serde_json::Value, RemoteError> {
    let encoded = archivist_server::query_api::encode_opts_param(opts_json);
    let url = format!("http://{host}:{port}/assets?opts={encoded}");
    let resp = match agent().get(&url).set("X-Auth-Code", code).timeout(Duration::from_secs(10)).call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(401, _)) => return Err(RemoteError::AuthFailed),
        Err(ureq::Error::Status(429, _)) => return Err(RemoteError::ServerBusy),
        Err(ureq::Error::Status(_, _)) => return Err(RemoteError::BadResponse),
        Err(ureq::Error::Transport(t)) => return Err(classify_transport(&t)),
    };
    let value = resp.into_json::<serde_json::Value>().map_err(|_| RemoteError::BadResponse)?;
    // Sekil dogrulamasi: host beklenmedik bir sey donerse renderer'a SIZMASIN (yanlis/kotu niyetli
    // sunucuya karsi asgari savunma; grid `total`+`items` bekler).
    if !value.get("total").is_some_and(serde_json::Value::is_i64)
        || !value.get("items").is_some_and(serde_json::Value::is_array)
    {
        return Err(RemoteError::BadResponse);
    }
    Ok(value)
}

/// `GET /asset/{id}` → tek asset detayi. **404 → `Ok(None)`** (asset yok VEYA cop'te) — bu bir
/// hata degildir: uzak arsivde silinmis bir dosyaya tikladiysak panel "bulunamadi" demeli.
/// Saf/test'li.
pub fn http_get_detail(
    host: &str,
    port: u16,
    code: &str,
    id: i64,
) -> Result<Option<serde_json::Value>, RemoteError> {
    let url = format!("http://{host}:{port}/asset/{id}");
    let resp = match agent().get(&url).set("X-Auth-Code", code).timeout(Duration::from_secs(10)).call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(ureq::Error::Status(401, _)) => return Err(RemoteError::AuthFailed),
        Err(ureq::Error::Status(429, _)) => return Err(RemoteError::ServerBusy),
        Err(ureq::Error::Status(_, _)) => return Err(RemoteError::BadResponse),
        Err(ureq::Error::Transport(t)) => return Err(classify_transport(&t)),
    };
    let value = resp.into_json::<serde_json::Value>().map_err(|_| RemoteError::BadResponse)?;
    // Sekil dogrulamasi: `AssetDetail` her zaman bir `asset` alani tasir (panel onu okur).
    if !value.get("asset").is_some_and(serde_json::Value::is_object) {
        return Err(RemoteError::BadResponse);
    }
    Ok(Some(value))
}

/// `GET /thumbs?ids=1,2,3` → kucuk resim dizisi (yerel IPC ile ayni sekil). Saf/test'li.
///
/// **BATCH cagri** — sayfa basina ~60 kart var; tek tek istek kendi hiz sinirimizi (30/sn)
/// asardi. Bos id listesi ag'a HIC cikmaz.
pub fn http_get_thumbs(
    host: &str,
    port: u16,
    code: &str,
    ids: &[i64],
) -> Result<serde_json::Value, RemoteError> {
    if ids.is_empty() {
        return Ok(serde_json::Value::Array(Vec::new()));
    }
    let list = ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
    let url = format!("http://{host}:{port}/thumbs?ids={list}");
    let resp = match agent().get(&url).set("X-Auth-Code", code).timeout(Duration::from_secs(15)).call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(401, _)) => return Err(RemoteError::AuthFailed),
        Err(ureq::Error::Status(429, _)) => return Err(RemoteError::ServerBusy),
        Err(ureq::Error::Status(_, _)) => return Err(RemoteError::BadResponse),
        Err(ureq::Error::Transport(t)) => return Err(classify_transport(&t)),
    };
    let value = resp.into_json::<serde_json::Value>().map_err(|_| RemoteError::BadResponse)?;
    if !value.is_array() {
        return Err(RemoteError::BadResponse);
    }
    Ok(value)
}

/// `GET /folders` → klasor ozeti dizisi (yerel `folder_summary` IPC ile AYNI sekil). **GIRDISIZ**
/// (host klasorleri kendi `assets.path`'inden turetir). Saf/test'li.
pub fn http_get_folders(host: &str, port: u16, code: &str) -> Result<serde_json::Value, RemoteError> {
    let url = format!("http://{host}:{port}/folders");
    let resp = match agent().get(&url).set("X-Auth-Code", code).timeout(Duration::from_secs(10)).call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(401, _)) => return Err(RemoteError::AuthFailed),
        Err(ureq::Error::Status(429, _)) => return Err(RemoteError::ServerBusy),
        Err(ureq::Error::Status(_, _)) => return Err(RemoteError::BadResponse),
        Err(ureq::Error::Transport(t)) => return Err(classify_transport(&t)),
    };
    let value = resp.into_json::<serde_json::Value>().map_err(|_| RemoteError::BadResponse)?;
    // Sekil dogrulamasi: FoldersView bir dizi bekler (`FolderSummaryDto[]`).
    if !value.is_array() {
        return Err(RemoteError::BadResponse);
    }
    Ok(value)
}

/// `GET /rag?req=<kodlanmis json>` → ham `{chunks, diag}` JSON (LAN Faz 5). **Saf/test'li.**
///
/// `req_json` = `{"question":...,"scope":...,"options":...}`; host embed+retrieve KENDI yapar
/// (indeksi ONCEDEN insa etti). Kodlama host'un cozucusuyle AYNI modulden (`encode_req_param`).
/// **503 → `NotIndexed`**: host indekssiz/modelsiz — "sunucu hatasi"ndan (500) AYRI kullanici mesaji.
pub(crate) fn http_rag_retrieve(
    host: &str,
    port: u16,
    code: &str,
    req_json: &str,
) -> Result<serde_json::Value, RemoteError> {
    let encoded = archivist_server::query_api::encode_req_param(req_json);
    let url = format!("http://{host}:{port}/rag?req={encoded}");
    let resp = match agent().get(&url).set("X-Auth-Code", code).timeout(Duration::from_secs(20)).call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(401, _)) => return Err(RemoteError::AuthFailed),
        Err(ureq::Error::Status(429, _)) => return Err(RemoteError::ServerBusy),
        Err(ureq::Error::Status(503, _)) => return Err(RemoteError::NotIndexed),
        Err(ureq::Error::Status(_, _)) => return Err(RemoteError::BadResponse),
        Err(ureq::Error::Transport(t)) => return Err(classify_transport(&t)),
    };
    let value = resp.into_json::<serde_json::Value>().map_err(|_| RemoteError::BadResponse)?;
    // Sekil dogrulamasi: host `{chunks:[], diag:{}}` dondurmeli (istemci ikisini de okur).
    if !value.get("chunks").is_some_and(serde_json::Value::is_array)
        || !value.get("diag").is_some_and(serde_json::Value::is_object)
    {
        return Err(RemoteError::BadResponse);
    }
    Ok(value)
}

/// `GET /search/semantic?opts=<kodlanmis json>` → ham `AssetPage` JSON (LAN Faz 5). `opts.query` =
/// semantik sorgu metni; host embed + kNN yapar. `/assets` ile AYNI cikti sekli. **Saf/test'li.**
pub(crate) fn http_semantic_search(
    host: &str,
    port: u16,
    code: &str,
    opts_json: &str,
) -> Result<serde_json::Value, RemoteError> {
    let encoded = archivist_server::query_api::encode_opts_param(opts_json);
    let url = format!("http://{host}:{port}/search/semantic?opts={encoded}");
    let resp = match agent().get(&url).set("X-Auth-Code", code).timeout(Duration::from_secs(20)).call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(401, _)) => return Err(RemoteError::AuthFailed),
        Err(ureq::Error::Status(429, _)) => return Err(RemoteError::ServerBusy),
        Err(ureq::Error::Status(503, _)) => return Err(RemoteError::NotIndexed),
        Err(ureq::Error::Status(_, _)) => return Err(RemoteError::BadResponse),
        Err(ureq::Error::Transport(t)) => return Err(classify_transport(&t)),
    };
    let value = resp.into_json::<serde_json::Value>().map_err(|_| RemoteError::BadResponse)?;
    // Sekil dogrulamasi: `/assets` ile ayni (`total`+`items`) → grid hook'u yeniden kullanir.
    if !value.get("total").is_some_and(serde_json::Value::is_i64)
        || !value.get("items").is_some_and(serde_json::Value::is_array)
    {
        return Err(RemoteError::BadResponse);
    }
    Ok(value)
}

/// `GET /stats` → `RemoteStatsDto` (LAN Faz 5; GIRDISIZ). **Saf/test'li.** Sekil, tiplenmis
/// deserialize ile dogrulanir (eksik/yanlis alan → `BadResponse`).
pub(crate) fn http_stats(
    host: &str,
    port: u16,
    code: &str,
) -> Result<RemoteStatsDto, RemoteError> {
    let url = format!("http://{host}:{port}/stats");
    let resp = match agent().get(&url).set("X-Auth-Code", code).timeout(Duration::from_secs(10)).call()
    {
        Ok(r) => r,
        Err(ureq::Error::Status(401, _)) => return Err(RemoteError::AuthFailed),
        Err(ureq::Error::Status(429, _)) => return Err(RemoteError::ServerBusy),
        Err(ureq::Error::Status(503, _)) => return Err(RemoteError::NotIndexed),
        Err(ureq::Error::Status(_, _)) => return Err(RemoteError::BadResponse),
        Err(ureq::Error::Transport(t)) => return Err(classify_transport(&t)),
    };
    resp.into_json::<RemoteStatsDto>().map_err(|_| RemoteError::BadResponse)
}

/// Uzak host'tan RAG chunk'lari cek + TIPLENMIS `(ChunkHit, RetrieveDiag)`'a coz (rag_chat uzak
/// dali kullanir). Eslesme + yetki kapisi burada (require_remote_read + pairing). `scope`/`options`
/// ham JSON `Value` (rag_chat kendi tiplerini once serilestirir) → bu modul RagOptions'a baglanmaz.
pub(crate) fn fetch_remote_chunks(
    state: &AppState,
    question: &str,
    scope: &serde_json::Value,
    options: &serde_json::Value,
) -> Result<(Vec<archivist_db::ChunkHit>, archivist_db::RetrieveDiag), String> {
    require_remote_read(state)?;
    let p = pairing_or_err(state)?;
    let req = serde_json::json!({ "question": question, "scope": scope, "options": options });
    let req_json = serde_json::to_string(&req).map_err(|e| e.to_string())?;
    let value = http_rag_retrieve(&p.host, p.port, &p.code, &req_json).map_err(|e| e.token().to_string())?;
    // Sekil http_rag_retrieve'de dogrulandi; tiplenmis cozum (bozuksa BadResponse token'i).
    let chunks = serde_json::from_value(value.get("chunks").cloned().unwrap_or_default())
        .map_err(|_| RemoteError::BadResponse.token().to_string())?;
    let diag = serde_json::from_value(value.get("diag").cloned().unwrap_or_default())
        .map_err(|_| RemoteError::BadResponse.token().to_string())?;
    Ok((chunks, diag))
}

/// Uzak okuma yetkisi: **admin VEYA editor** (viewer haric). Bkz modul basligi.
fn require_remote_read(state: &AppState) -> Result<(), String> {
    let role = rbac::current_role(state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())
}

/// Eslesmeyi oku; eksikse tipli hata. Kod DISARI verilmez (yalniz bu modul icinde kullanilir).
fn pairing_or_err(state: &AppState) -> Result<Pairing, String> {
    read_pairing(state)?.ok_or_else(|| RemoteError::NotConfigured.token().to_string())
}

/// Ana arsivde sayfali sorgu (**Admin + Editor**). `opts` yerel `list_assets` ile AYNI sekildir.
///
/// `serde_json::Value` olarak gecirilir cunku `ListOpts` yalniz `Deserialize` (Serialize DEGIL) —
/// ustelik bu sayede **ileri-uyumlu**: frontend yeni bir facet alani eklerse bu komut degismeden
/// host'a tasir (host bilmiyorsa yok sayar). Yeni facet = sifir LAN kodu, Faz 1'in ilkesiyle ayni.
#[tauri::command]
pub fn remote_list_assets(
    opts: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    require_remote_read(&state)?;
    let p = pairing_or_err(&state)?;
    let opts_json = serde_json::to_string(&opts).map_err(|_| "bad_opts".to_string())?;
    http_list_assets(&p.host, p.port, &p.code, &opts_json).map_err(|e| e.token().to_string())
}

/// Ana arsivde TEK asset detayi (**Admin + Editor**). Yoksa/cop'teyse `null`.
///
/// Sekil yerel `get_asset` ile AYNI (`AssetDetail`) ⇒ detay paneli yeniden kullanilir.
/// ⚠️ Panel uzak modda SALT-OKUMA acilir: yazma komutlari (etiket/proje/favori) yerel DB'ye
/// gider ve uzak id'lerle YANLIS dosyayi vururdu — o yuzden frontend duzenlemeyi kapatir.
#[tauri::command]
pub fn remote_get_asset(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>, String> {
    require_remote_read(&state)?;
    let p = pairing_or_err(&state)?;
    http_get_detail(&p.host, p.port, &p.code, id).map_err(|e| e.token().to_string())
}

/// Ana arsivden kucuk resimler (**Admin + Editor**, BATCH). Yerel `get_thumbnails` ile ayni sekil.
#[tauri::command]
pub fn remote_thumbnails(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    require_remote_read(&state)?;
    let p = pairing_or_err(&state)?;
    http_get_thumbs(&p.host, p.port, &p.code, &ids).map_err(|e| e.token().to_string())
}

/// Ana arsivin klasor ozetleri (**Admin + Editor**, GIRDISIZ). Yerel `folder_summary` ile AYNI
/// sekil ⇒ FoldersView yeniden kullanilir. Uzak modda salt-okuma: yazma eylemleri (yeniden tara/
/// indeksle/cop) frontend'de kapatilir — yerel-yol/yerel-id'ye dokunurlardi.
#[tauri::command]
pub fn remote_folder_summary(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    require_remote_read(&state)?;
    let p = pairing_or_err(&state)?;
    http_get_folders(&p.host, p.port, &p.code).map_err(|e| e.token().to_string())
}

/// Ana arsivde uzak RAG retrieval (**Admin + Editor**; LAN Faz 5). Host embed+retrieve KENDI yapar
/// (indeksi ONCEDEN insa etti) → `{chunks, diag}` doner; LLM uretimi ISTEMCIDE (bkz `rag_chat`).
/// `scope`/`options` ham `Value` (ileri-uyumlu: frontend yeni alan eklerse degismeden host'a tasir;
/// remote_list_assets ilkesi). Host indekssiz/modelsiz → `remote_not_indexed` token.
#[tauri::command]
pub fn remote_rag_retrieve(
    question: String,
    scope: serde_json::Value,
    options: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    require_remote_read(&state)?;
    let p = pairing_or_err(&state)?;
    let req = serde_json::json!({ "question": question, "scope": scope, "options": options });
    let req_json = serde_json::to_string(&req).map_err(|_| "bad_request".to_string())?;
    http_rag_retrieve(&p.host, p.port, &p.code, &req_json).map_err(|e| e.token().to_string())
}

/// Ana arsivde uzak semantik (vektor) arama (**Admin + Editor**; LAN Faz 5). `opts.query` = semantik
/// sorgu metni; host embed + kNN yapar → `AssetPage` (yerel `semantic_search`/grid ile AYNI sekil).
/// `opts` ham `Value` (remote_list_assets ilkesi). Host modelsiz → `remote_not_indexed` token.
#[tauri::command]
pub fn remote_semantic_search(
    opts: serde_json::Value,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    require_remote_read(&state)?;
    let p = pairing_or_err(&state)?;
    let opts_json = serde_json::to_string(&opts).map_err(|_| "bad_opts".to_string())?;
    http_semantic_search(&p.host, p.port, &p.code, &opts_json).map_err(|e| e.token().to_string())
}

/// Ana arsivin indeks/sayac ozeti (**Admin + Editor**, GIRDISIZ; LAN Faz 5). "Ana arsiv ne kadar
/// AI-indeksli / uzak semantik-RAG kullanilabilir mi" gorunumunu besler.
#[tauri::command]
pub fn remote_stats(state: State<'_, AppState>) -> Result<RemoteStatsDto, String> {
    require_remote_read(&state)?;
    let p = pairing_or_err(&state)?;
    http_stats(&p.host, p.port, &p.code).map_err(|e| e.token().to_string())
}

/// Uzak arsiv durumu (**Admin + Editor**) — kaynak degistiricinin ve acilista OTO-BAGLANMANIN
/// dayanagi. Eslesme yoksa `configured:false` (hata DEGIL → UI sessizce yerelde kalir).
///
/// ⚠️ Auth kodu DONMEZ; yalniz `configured` bayragi + gorunur `host:port` etiketi.
#[tauri::command]
pub fn remote_archive_status(state: State<'_, AppState>) -> Result<RemoteStatus, String> {
    require_remote_read(&state)?;
    let Some(p) = read_pairing(&state)? else {
        return Ok(RemoteStatus {
            configured: false,
            reachable: false,
            app_version: None,
            host_label: None,
        });
    };
    // `/ping` auth'suz — yalniz "acik mi" sorusu. Kapaliysa hata DEGIL, `reachable:false`
    // (admin'in PC'si kapali olabilir; bu her acilista kirmizi uyari uretmemeli).
    let app_version = crate::lan_client_commands::http_ping(&p.host, p.port);
    Ok(RemoteStatus {
        configured: true,
        reachable: app_version.is_some(),
        app_version,
        host_label: Some(format!("{}:{}", p.host, p.port)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use archivist_server::{
        ArchiveApi, AssetDetailFn, AssetQueryFn, FolderQueryFn, NotificationFn, ServerConfig,
        ServerHandle, ThumbQueryFn,
    };

    /// Gercek host sunucusu (izole; sahte kaynaklar) — gelen istegi yansitir.
    fn start_host(port: u16) -> ServerHandle {
        let notif: NotificationFn = Arc::new(|_since, _limit| Ok(vec![]));
        let assets: AssetQueryFn = Arc::new(|opts: &str| {
            // Gelen opts'u `items` icine gomup geri yolla → istemci ne gonderdi, olculebilir.
            Ok(format!(r#"{{"total":1,"items":[{{"echo":{opts}}}]}}"#))
        });
        // id 404 → "null" (yok/cop'te); digerleri sahte detay.
        let detail: AssetDetailFn = Arc::new(|id: i64| {
            if id == 404 {
                Ok("null".to_string())
            } else {
                Ok(format!(r#"{{"asset":{{"id":{id},"file_name":"x.dwg"}},"tags":[]}}"#))
            }
        });
        let thumbs: ThumbQueryFn = Arc::new(|ids: &[i64]| {
            let items: Vec<String> = ids
                .iter()
                .map(|i| format!(r#"{{"asset_id":{i},"mime":"image/jpeg","data_base64":"AA=="}}"#))
                .collect();
            Ok(format!("[{}]", items.join(",")))
        });
        // Girdisiz klasor ozeti — iki sahte klasor doner (istemci sekli olcer).
        let folders: FolderQueryFn = Arc::new(|| {
            Ok(r#"[{"path":"C:\\A","file_count":3,"last_indexed":1700000000},{"path":"C:\\B","file_count":1,"last_indexed":null}]"#.to_string())
        });
        ServerHandle::start(
            ServerConfig {
                port,
                app_version: "1.2.3".into(),
                notifications: notif,
                archive: ArchiveApi { assets, detail, thumbs, folders, ..ArchiveApi::unavailable() },
            },
            Some("11112222".to_string()),
        )
        .expect("test host'u baslamali")
    }

    #[test]
    fn uzak_sorgu_opts_bozulmadan_gider() {
        let handle = start_host(19483);
        // Turkce + bosluk + `+` iceren gercekci bir sorgu: kodlama/cozme zincirinin uctan uca sinavi.
        let opts = r#"{"query":"Fotoğraf a+b","ext":["dwg"],"page":2}"#;
        let page = http_list_assets("127.0.0.1", 19483, "11112222", opts).expect("basarili olmali");
        let echoed = page["items"][0]["echo"].clone();
        assert_eq!(echoed["query"], "Fotoğraf a+b", "UTF-8 ve + bozulmamali");
        assert_eq!(echoed["ext"][0], "dwg");
        assert_eq!(echoed["page"], 2);
        handle.stop();
    }

    #[test]
    fn yanlis_kod_auth_failed() {
        let handle = start_host(19484);
        let err = http_list_assets("127.0.0.1", 19484, "00000000", "{}").unwrap_err();
        assert_eq!(err, RemoteError::AuthFailed, "401 → AuthFailed (jenerik hata DEGIL)");
        handle.stop();
    }

    #[test]
    fn kapali_host_network_error() {
        // Hicbir sey dinlemeyen port → baglanti reddi. Timeout ile AYRI sinif olmali.
        let err = http_list_assets("127.0.0.1", 19485, "11112222", "{}").unwrap_err();
        assert_eq!(err, RemoteError::NetworkError, "host kapali → NetworkError");
        assert_ne!(err, RemoteError::Timeout, "baglanti reddi zaman asimi DEGILDIR");
    }

    #[test]
    fn bozuk_sekil_bad_response() {
        // Beklenen `{total, items}` seklini DONDURMEYEN host → renderer'a sizmamali.
        let notif: NotificationFn = Arc::new(|_since, _limit| Ok(vec![]));
        let assets: AssetQueryFn = Arc::new(|_opts| Ok(r#"{"beklenmedik":true}"#.to_string()));
        let handle = ServerHandle::start(
            ServerConfig {
                port: 19486,
                app_version: "1.2.3".into(),
                notifications: notif,
                archive: ArchiveApi { assets, ..ArchiveApi::unavailable() },
            },
            Some("11112222".to_string()),
        )
        .expect("baslamali");
        let err = http_list_assets("127.0.0.1", 19486, "11112222", "{}").unwrap_err();
        assert_eq!(err, RemoteError::BadResponse, "sekil dogrulamasi tutmali");
        handle.stop();
    }

    #[test]
    fn uzak_detay_ve_404_ayrimi() {
        let handle = start_host(19487);
        // Var olan asset → detay doner.
        let d = http_get_detail("127.0.0.1", 19487, "11112222", 7)
            .expect("cagri basarili")
            .expect("asset var");
        assert_eq!(d["asset"]["id"], 7);

        // 404 → Ok(None). ⚠️ HATA DEGIL: uzakta silinmis dosyaya tiklamak "bulunamadi"dir,
        // "baglanti koptu" degil — ikisi kullanici icin bambaska.
        let missing = http_get_detail("127.0.0.1", 19487, "11112222", 404).expect("404 hata degil");
        assert!(missing.is_none());
        handle.stop();
    }

    #[test]
    fn uzak_thumbnail_batch_ve_bos_liste() {
        let handle = start_host(19488);
        let t = http_get_thumbs("127.0.0.1", 19488, "11112222", &[1, 2, 3]).expect("basarili");
        let arr = t.as_array().expect("dizi");
        assert_eq!(arr.len(), 3, "batch: tek istekte hepsi");
        assert_eq!(arr[0]["asset_id"], 1);

        // Bos liste AG'A CIKMAZ (sunucu kapali olsa bile calisir → bunu kanitla).
        handle.stop();
        let empty = http_get_thumbs("127.0.0.1", 19488, "11112222", &[]).expect("bos → hatasiz");
        assert!(empty.as_array().unwrap().is_empty(), "bos girdi ag turu yapmadan bos doner");
    }

    #[test]
    fn uzak_folders_dizi_ve_auth() {
        let handle = start_host(19489);
        // Girdisiz uc → klasor dizisi (yerel FolderSummaryDto ile ayni sekil).
        let f = http_get_folders("127.0.0.1", 19489, "11112222").expect("basarili");
        let arr = f.as_array().expect("dizi");
        assert_eq!(arr.len(), 2, "iki klasor doner");
        assert_eq!(arr[0]["path"], "C:\\A");
        assert_eq!(arr[0]["file_count"], 3);
        assert!(arr[1]["last_indexed"].is_null(), "null last_indexed sekli korunur");

        // Girdisiz olsa da auth ister: yanlis kod → AuthFailed (jenerik hata DEGIL).
        let err = http_get_folders("127.0.0.1", 19489, "00000000").unwrap_err();
        assert_eq!(err, RemoteError::AuthFailed);
        handle.stop();
    }

    #[test]
    fn hata_token_lari_stabil() {
        // i18n anahtarlari bunlara bagli — sessizce degismemeli.
        assert_eq!(RemoteError::NotConfigured.token(), "not_configured");
        assert_eq!(RemoteError::AuthFailed.token(), "auth_failed");
        assert_eq!(RemoteError::Timeout.token(), "timeout");
        assert_eq!(RemoteError::ServerBusy.token(), "server_busy");
        assert_eq!(RemoteError::NetworkError.token(), "network_error");
        assert_eq!(RemoteError::BadResponse.token(), "bad_response");
        assert_eq!(RemoteError::NotIndexed.token(), "remote_not_indexed");
    }
}
