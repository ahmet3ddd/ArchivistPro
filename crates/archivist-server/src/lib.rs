//! archivist-server — LAN salt-okuma dagitim/bildirim sunucusu (S1-S2 MVP).
//!
//! Tasarim (docs/design/LAN_MESSAGING_SPIKE.md §9):
//! - **Host-otoriter, salt-okuma.** Host bir bildirim servisi kosar; istemciler `since` imleciyle
//!   poll eder. "Tum DB dokumu" (H2 `/download`) YOK → N-kopya cok-kaynak riski bastan olur.
//! - **Senkron** (`tiny_http`, kendi thread'inde doner; tokio GEREKMEZ) → H3'un senkron
//!   rusqlite/Tauri-komut modeliyle uyumlu. H2 `lan_server.rs`'in kanitli iskeleti portlandi.
//! - **DB'yi sahiplenmez.** Bildirimler enjekte edilen bir closure ([`NotificationFn`]) ile cekilir;
//!   DB'yi src-tauri acar (kendi read-baglantisi). Bu crate saf HTTP+guvenlik tasiyicisidir → izole test.
//!
//! Endpoint'ler:
//! - `GET /ping`                    — auth'suz (ag kesfi); `{"status":"ok","appVersion":"..."}`.
//! - `GET /notifications?since=<ts>` — auth'lu (`X-Auth-Code`); `since`'ten yeni bildirim JSON dizisi.
//! - `GET /assets?opts=<json>`      — auth'lu; sayfali arsiv sorgusu (`ListOpts` → `AssetPage`).
//!   **Arama AYRI bir uc DEGILDIR** — `opts.query` doluysa `list_assets` zaten FTS yoluna gecer
//!   (tek birlesik yol). Tasarimdaki (`docs/design/LAN_ARCHIVE_READ.md` §5) ayri `/search` ucu bu
//!   yuzden acilmadi: ayni sorguyu iki uctan sunmak, ikinci bir kod yolu ve kayma riski demekti.
//! - `GET /asset/{id}`              — auth'lu; tek asset detayi (`"null"` → 404). (Faz 3)
//! - `GET /thumbs?ids=1,2,3`        — auth'lu; kucuk resimler, BATCH. (Faz 3)
//! - `GET /folders`                 — auth'lu; klasor ozetleri (girdisiz; host `assets.path`'ten
//!   turetir). Uzak "Klasorler" gorunumunu besler. (Faz 4)
//!
//! Guvenlik: [`security`] (8-hane kod · IP rate-limit · constant-time · CORS). Kapsam DISI:
//! dosya baytlari (streaming), yazma geri-akisi.

/// Tel formatinin ORTAK katmani: `opts` parametresinin kodlanmasi (istemci) + cozulmesi (host).
/// **`pub` cunku iki yakasi da buradan beslenir** — istemci (src-tauri `remote_archive`) kodlar,
/// host bu crate icinde cozer. Ayni modulde durmalari kaymayi (drift) yapisal olarak engeller.
pub mod query_api;
mod security;

use std::net::{TcpStream, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub use security::generate_auth_code;

/// Varsayilan LAN portu (H2 pariti). Cakisirsa src-tauri farkli deger gecebilir.
pub const DEFAULT_LAN_PORT: u16 = 9471;

/// Tek bir bildirim — host DB'sinden gelir, `/notifications` JSON'unda serialize edilir.
/// Alan adlari tel formatidir (istemci Faz 2 bunlari okur; H3 snake_case DTO konvansiyonu).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: i64,
    pub created_at: i64,
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
}

/// Bildirim kaynagi: `(since_ts, limit) -> bildirimler`. src-tauri enjekte eder (DB read).
/// Sunucu DB'yi sahiplenmez; yalniz bu closure'i cagirir (kendi thread'inden).
pub type NotificationFn = Arc<dyn Fn(i64, i64) -> Result<Vec<Notification>, String> + Send + Sync>;

/// `/notifications` tek istekte en fazla kac bildirim doner (payload siniri).
const NOTIF_LIMIT: i64 = 500;

/// `/assets` sorgusunun basarisizlik turu — HTTP durum kodunu bu ayirir.
/// H2'nin "her hata tek jenerik mesaj" davranisi tekrarlanmaz: istemci yanlis filtre
/// gonderdiyse (400) ile host DB'si okunamadiysa (500) ayni sey degildir.
#[derive(Debug)]
pub enum QueryError {
    /// Istemci hatasi — cozulemeyen/gecersiz `opts`/`req` (→ 400).
    BadRequest(String),
    /// Host tarafi hatasi — DB acilamadi/sorgu patladi (→ 500).
    Internal(String),
    /// Host su ozelligi SUNAMIYOR (→ 503): AI/RAG indeksi/modeli hazir DEGIL (uzak semantik/RAG).
    /// Bu bir arıza (500) DEGIL, "hazir degil" durumudur → istemci onu ayirt edip kullaniciya
    /// "ana arsivde indeks yok" der (500 "sunucu hatasi"ndan bambaska mesaj). Govde
    /// `{"error":"not_indexed"}`; DETAY (model yolu vb.) yalniz host konsoluna yazilir, sizmaz.
    Unavailable(String),
}

/// Arsiv sorgu kaynagi: `opts JSON -> AssetPage JSON`. src-tauri enjekte eder.
///
/// **Neden metin girip metin cikiyor:** bu crate DB'yi SAHIPLENMEZ ([`NotificationFn`] ile ayni
/// durus) — `archivist-db`'ye bagimlilik eklemek sunucuyu izole test edilemez hale getirirdi.
/// `ListOpts`/`AssetPage` serilestirmesi src-tauri tarafinda kalir; buradaki kod saf HTTP tasiyicidir.
pub type AssetQueryFn = Arc<dyn Fn(&str) -> Result<String, QueryError> + Send + Sync>;

/// Tek asset detayi: `id -> AssetDetail JSON` (`"null"` = bulunamadi/cop'te).
pub type AssetDetailFn = Arc<dyn Fn(i64) -> Result<String, QueryError> + Send + Sync>;

/// Thumbnail kaynagi: `id listesi -> ThumbnailDto[] JSON` (base64; yerel IPC ile AYNI sekil).
/// **BATCH** — gerekcesi `/thumbs` yonlendirmesinde.
pub type ThumbQueryFn = Arc<dyn Fn(&[i64]) -> Result<String, QueryError> + Send + Sync>;

/// Klasor ozeti kaynagi: `() -> FolderSummaryDto[] JSON`. **Girdi ALMAZ** — host klasorleri KENDI
/// `assets.path`'inden turetir (istemciden yol/id gelmez → sifir enjeksiyon yuzeyi). Uzak
/// "Klasorler" gorunumunu besler; `folder_summary` cap'i (1000) db katmaninda.
pub type FolderQueryFn = Arc<dyn Fn() -> Result<String, QueryError> + Send + Sync>;

/// RAG retrieval kaynagi (LAN Faz 5): `req JSON -> {chunks, diag} JSON`. **Alinan karar:** retrieval
/// ve embedding HOST'ta (host'un ONCEDEN insa ettigi indeksi tuketir), LLM uretimi ISTEMCIDE. Bu
/// crate DB'yi/embedder'i SAHIPLENMEZ — src-tauri closure'i enjekte eder (folders deseni). Model
/// veya chunk yoksa `Unavailable` (503) → istemci "indeks yok" der.
pub type RagRetrieveFn = Arc<dyn Fn(&str) -> Result<String, QueryError> + Send + Sync>;

/// Semantik arama kaynagi (LAN Faz 5): `opts JSON -> AssetPage JSON`. `opts.query` = semantik
/// sorgu metni; host embed'i uretip kNN kosar. `/assets` ile AYNI cikti sekli (AssetPage) →
/// istemci grid hook'u yeniden kullanir. Ayri uc: semantik `/assets`'ten FARKLI kod yolu.
pub type SemanticQueryFn = Arc<dyn Fn(&str) -> Result<String, QueryError> + Send + Sync>;

/// Indeks/sayac ozeti kaynagi (LAN Faz 5): `() -> RemoteStatsDto JSON`. **Girdi ALMAZ** (folders
/// deseni). Vektor/chunk/asset/klasor sayilari + `model_ready` → istemci "ana arsiv ne kadar
/// indeksli" gorunumu. Embedder GEREKMEZ (yalniz dosya-varlik bayragi).
pub type StatsQueryFn = Arc<dyn Fn() -> Result<String, QueryError> + Send + Sync>;

/// Arsiv okuma yuzeyi — LAN'a acilan tum DB kaynaklari tek yapida.
/// (Faz 3'te ikiden fazla closure olunca `ServerConfig` duz alanlarla sisiyordu.)
pub struct ArchiveApi {
    /// `/assets` — sayfali liste + arama (`ListOpts` → `AssetPage`).
    pub assets: AssetQueryFn,
    /// `/asset/{id}` — tek asset detayi (metadata + etiket + koleksiyon + proje).
    pub detail: AssetDetailFn,
    /// `/thumbs?ids=` — kucuk resimler (batch).
    pub thumbs: ThumbQueryFn,
    /// `/folders` — klasor ozetleri (ust-dizine gore asset sayilari; salt-okuma, girdisiz).
    pub folders: FolderQueryFn,
    /// `/rag?req=` — RAG retrieval (host embed + retrieve; uretim istemcide). (Faz 5)
    pub rag: RagRetrieveFn,
    /// `/search/semantic?opts=` — semantik (vektor) arama (host embed + kNN). (Faz 5)
    pub semantic: SemanticQueryFn,
    /// `/stats` — indeks/sayac ozeti (girdisiz). (Faz 5)
    pub stats: StatsQueryFn,
}

impl ArchiveApi {
    /// TUM arsiv uclarinin "kullanilamaz" dondugu yuzey.
    ///
    /// Amaci **testler**: yalniz ilgilendigi ucu doldurup gerisini
    /// `ArchiveApi { assets, ..ArchiveApi::unavailable() }` ile birakmak. Uretimde
    /// KULLANILMAZ — dolduruldugunda uc 500 doner ve host konsoluna sebep yazilir,
    /// yani sessizce bos sonuc DEGIL, gorulur bir arıza olur.
    pub fn unavailable() -> Self {
        fn err<T>(what: &str) -> Result<T, QueryError> {
            Err(QueryError::Internal(format!("{what} bu sunucuda saglanmadi")))
        }
        ArchiveApi {
            assets: Arc::new(|_| err("assets")),
            detail: Arc::new(|_| err("detail")),
            thumbs: Arc::new(|_| err("thumbs")),
            folders: Arc::new(|| err("folders")),
            rag: Arc::new(|_| err("rag")),
            semantic: Arc::new(|_| err("semantic")),
            stats: Arc::new(|| err("stats")),
        }
    }
}

/// Sunucu baslatma yapilandirmasi.
pub struct ServerConfig {
    pub port: u16,
    /// `/ping` yanitindaki surum (host uygulama surumu).
    pub app_version: String,
    /// Bildirim kaynagi (DB'den okur).
    pub notifications: NotificationFn,
    /// Arsiv okuma yuzeyi (hepsi DB'den SALT-OKUR).
    pub archive: ArchiveApi,
}

/// Calisan sunucunun tutamaci. `stop()` ile temiz kapanir (port serbest kalana kadar bekler).
pub struct ServerHandle {
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    auth_code: Arc<Mutex<String>>,
    port: u16,
    local_ip: String,
}

impl ServerHandle {
    /// Sunucuyu baslat: 8-hane kod uret, yerel IP tespit et, `0.0.0.0:port`'a bind et (Windows
    /// port-serbestlesme yarisina karsi retry), kendi thread'inde istek dongusunu kos.
    /// `initial_code` verilirse (kalici kod) o kullanilir; yoksa yeni uretilir.
    pub fn start(config: ServerConfig, initial_code: Option<String>) -> Result<ServerHandle, String> {
        let code = match initial_code {
            Some(c) if c.len() == 8 && c.bytes().all(|b| b.is_ascii_digit()) => c,
            _ => generate_auth_code()?,
        };
        let auth_code = Arc::new(Mutex::new(code));
        let local_ip = detect_local_ip();
        let server = bind_with_retry(config.port)?;
        let shutdown = Arc::new(AtomicBool::new(false));

        let loop_shutdown = shutdown.clone();
        let loop_code = auth_code.clone();
        let app_version = config.app_version;
        let notifications = config.notifications;
        let archive = config.archive;
        let port = config.port;
        let thread = std::thread::Builder::new()
            .name("archivist-lan".into())
            .spawn(move || {
                let ctx = LoopCtx { app_version, notifications, archive, port };
                run_loop(server, loop_shutdown, loop_code, ctx);
            })
            .map_err(|e| format!("sunucu thread'i baslatilamadi: {e}"))?;

        Ok(ServerHandle { shutdown, thread: Some(thread), auth_code, port, local_ip })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn local_ip(&self) -> &str {
        &self.local_ip
    }

    /// Gecerli 8-hane auth kodu.
    pub fn auth_code(&self) -> String {
        self.auth_code.lock().map(|c| c.clone()).unwrap_or_default()
    }

    /// Kodu YERINDE yenile (restart GEREKMEZ; calisan dongu bir sonraki istekte yeni kodu gorur).
    pub fn regenerate_code(&self) -> Result<String, String> {
        let fresh = generate_auth_code()?;
        if let Ok(mut c) = self.auth_code.lock() {
            *c = fresh.clone();
        }
        Ok(fresh)
    }

    /// Temiz kapat: shutdown bayragi + kendine TCP connect ile dongu thread'ini uyandir + join
    /// (port "os error 10048" olmadan serbest kalir).
    pub fn stop(mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
        // recv_timeout(2s) beklemesini uyandir.
        if let Ok(addr) = format!("127.0.0.1:{}", self.port).parse::<std::net::SocketAddr>() {
            let _ = TcpStream::connect_timeout(&addr, Duration::from_millis(200));
        }
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

/// `0.0.0.0:port`'a bind (Windows'ta onceki bind'in serbest kalmasi icin 5×300ms retry).
fn bind_with_retry(port: u16) -> Result<tiny_http::Server, String> {
    let addr = format!("0.0.0.0:{port}");
    let mut last = String::new();
    for _ in 0..5 {
        match tiny_http::Server::http(addr.as_str()) {
            Ok(s) => return Ok(s),
            Err(e) => {
                last = e.to_string();
                std::thread::sleep(Duration::from_millis(300));
            }
        }
    }
    Err(format!("port {port} bind edilemedi: {last}"))
}

/// Yerel IP tespiti (UDP trick — gercek baglanti kurulmaz). LAN sunucusu ve
/// uygulama teshis karti AYNI kurala gore adres gostersin diye disari aciktir.
pub fn detect_local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|sock| {
            sock.connect("192.168.1.1:80")?;
            sock.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Istek dongusunun degismeyen baglami (parametre sayisini tek yerde tutar).
struct LoopCtx {
    app_version: String,
    notifications: NotificationFn,
    archive: ArchiveApi,
    port: u16,
}

fn run_loop(
    server: tiny_http::Server,
    shutdown: Arc<AtomicBool>,
    auth_code: Arc<Mutex<String>>,
    ctx: LoopCtx,
) {
    let LoopCtx { app_version, notifications, archive, port } = ctx;
    let ArchiveApi { assets, detail, thumbs, folders, rag, semantic, stats } = archive;
    loop {
        if shutdown.load(Ordering::Relaxed) {
            break;
        }
        let request = match server.recv_timeout(Duration::from_secs(2)) {
            Ok(Some(req)) => req,
            Ok(None) => continue, // timeout — dongu (shutdown kontrolu)
            Err(_) => break,
        };
        if shutdown.load(Ordering::Relaxed) {
            let _ = request.respond(tiny_http::Response::empty(200));
            break;
        }

        // OPTIONS preflight — CORS ile hemen yanitla.
        if *request.method() == tiny_http::Method::Options {
            let mut response = tiny_http::Response::empty(204);
            for h in security::cors_headers() {
                response.add_header(h);
            }
            let _ = request.respond(response);
            continue;
        }

        // Metot kapisi — yalniz GET (OPTIONS yukarida yanitlandi). Yazma yollari HIC acilmaz;
        // H2'de `/manifest`+`/download` metoda BAKMADAN eslesiyordu (tasarim §3, #6).
        if *request.method() != tiny_http::Method::Get {
            respond_method_not_allowed(request);
            continue;
        }

        let client_ip = request
            .remote_addr()
            .map(|addr| addr.ip().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        if security::is_ip_locked_out(&client_ip) {
            respond_json(request, 429, r#"{"error":"too_many_attempts"}"#);
            continue;
        }

        // Hiz siniri — auth'tan ONCE, BASARILI istekleri de sayar (H2'nin acigi: yalniz
        // basarisiz auth sayiliyordu ⇒ dogru kodu bilen istemci sinirsiz agir istek atabiliyordu).
        if !security::allow_request(&client_ip) {
            respond_json(request, 429, r#"{"error":"rate_limited"}"#);
            continue;
        }

        let req_auth: Option<String> = request
            .headers()
            .iter()
            .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("x-auth-code"))
            .map(|h| h.value.as_str().to_string());

        let url = request.url().to_string();
        let path = url.split('?').next().unwrap_or("").to_string();

        // `/ping` tek auth'suz endpoint (ag kesfi). Digerleri X-Auth-Code ister.
        if path != "/ping" {
            let authed = match req_auth {
                Some(ref code) => {
                    let current = auth_code.lock().map(|c| c.clone()).unwrap_or_default();
                    security::constant_time_eq(code.as_bytes(), current.as_bytes())
                }
                None => false,
            };
            if !authed {
                security::record_auth_failure(&client_ip);
                respond_json(request, 401, r#"{"error":"unauthorized"}"#);
                continue;
            }
            security::clear_auth_failures(&client_ip);
        }

        match path.as_str() {
            "/ping" => {
                let body = format!(r#"{{"status":"ok","appVersion":"{app_version}"}}"#);
                respond_json(request, 200, &body);
            }
            "/notifications" => {
                let since = parse_since(&url);
                match notifications(since, NOTIF_LIMIT) {
                    Ok(list) => match serde_json::to_string(&list) {
                        Ok(json) => respond_json(request, 200, &json),
                        Err(_) => respond_json(request, 500, r#"{"error":"serialize"}"#),
                    },
                    Err(_) => respond_json(request, 500, r#"{"error":"query"}"#),
                }
            }
            "/assets" => {
                match query_api::opts_from_url(&url) {
                    Err(e) => {
                        let body = format!(r#"{{"error":"{}"}}"#, e.code());
                        respond_json(request, 400, &body);
                    }
                    // Basarili yanit ZATEN JSON metni (AssetPage) — yeniden serilestirilmez.
                    // Basarili yanit ZATEN JSON metni (AssetPage) — yeniden serilestirilmez.
                    // Hata DETAYI uzak istemciye SIZDIRILMAZ (yol/sema bilgisi verir), ama host
                    // konsoluna yazilir — sessiz yutma teshisi imkansiz kilar (2026-07-19
                    // "cikis calismiyor" bug'inin dersi).
                    Ok(opts_json) => match assets(&opts_json) {
                        Ok(page_json) => respond_json(request, 200, &page_json),
                        Err(e) => respond_query_error(request, "/assets", e),
                    },
                }
            }
            // `/thumbs?ids=1,2,3` — kucuk resimler, BATCH.
            //
            // ⚠️ Tasarim §5'te `/asset/{id}/thumb` (tek tek) yaziyordu — BATCH'e cevrildi.
            // Gerekce OLCUM: grid bir sayfada ~60 kart gosterir; tek-tek uc, sayfa basina 60
            // istek demekti ve KENDI hiz sinirimiz (30 istek/sn) bunu 429'a dusururdu. Ustelik
            // yerel `get_thumbnails(ids)` ZATEN batch → ayni sekli korumak istemci hook'unu
            // degistirmeden yeniden kullanmayi saglar.
            "/thumbs" => match query_api::ids_from_url(&url) {
                Err(e) => {
                    let body = format!(r#"{{"error":"{}"}}"#, e.code());
                    respond_json(request, 400, &body);
                }
                Ok(ids) => match thumbs(&ids) {
                    Ok(json) => respond_json(request, 200, &json),
                    Err(e) => respond_query_error(request, "/thumbs", e),
                },
            },
            // `/folders` — klasor ozetleri. GIRDISIZ: host klasorleri kendi `assets.path`'inden
            // turetir (istemciden yol/id gelmez → yol-gecisi/enjeksiyon yuzeyi YOK).
            "/folders" => match folders() {
                Ok(json) => respond_json(request, 200, &json),
                Err(e) => respond_query_error(request, "/folders", e),
            },
            // `/rag?req=<encoded json>` — RAG retrieval (LAN Faz 5). Host embed'i + retrieve'i
            // KENDI yapar (indeksi ONCEDEN insa etti); istemci donen chunk'larla LLM uretir.
            // Model/chunk yoksa 503 (`not_indexed`) → istemci "sunucu hatasi"ndan ayirir.
            "/rag" => match query_api::req_from_url(&url) {
                Err(e) => {
                    let body = format!(r#"{{"error":"{}"}}"#, e.code());
                    respond_json(request, 400, &body);
                }
                Ok(req_json) => match rag(&req_json) {
                    Ok(json) => respond_json(request, 200, &json),
                    Err(e) => respond_query_error(request, "/rag", e),
                },
            },
            // `/search/semantic?opts=<encoded ListOpts>` — semantik (vektor) arama (LAN Faz 5).
            // `opts` tel-sozlesmesi `/assets` ile AYNI (opts.query = sorgu metni); host embed +
            // kNN → AssetPage (grid ile ayni sekil). AYRI uc: `/assets`'ten FARKLI kod yolu.
            "/search/semantic" => match query_api::opts_from_url(&url) {
                Err(e) => {
                    let body = format!(r#"{{"error":"{}"}}"#, e.code());
                    respond_json(request, 400, &body);
                }
                Ok(opts_json) => match semantic(&opts_json) {
                    Ok(json) => respond_json(request, 200, &json),
                    Err(e) => respond_query_error(request, "/search/semantic", e),
                },
            },
            // `/stats` — indeks/sayac ozeti (LAN Faz 5; GIRDISIZ, folders deseni).
            "/stats" => match stats() {
                Ok(json) => respond_json(request, 200, &json),
                Err(e) => respond_query_error(request, "/stats", e),
            },
            // `/asset/{id}` — tek asset detayi. Govde `"null"` ise 404 (yok veya cop'te).
            path if path.starts_with("/asset/") => match query_api::asset_id_from_path(path) {
                None => respond_json(request, 400, r#"{"error":"bad_asset_id"}"#),
                Some(id) => match detail(id) {
                    // Kaynak "null" dondururse asset yok/cop'te → 404 (bos govde 200 DEGIL:
                    // istemci "bulunamadi" ile "bos detay"i ayirt edebilmeli).
                    Ok(json) if json.trim() == "null" => {
                        respond_json(request, 404, r#"{"error":"not_found"}"#)
                    }
                    Ok(json) => respond_json(request, 200, &json),
                    Err(e) => respond_query_error(request, "/asset", e),
                },
            },
            _ => respond_json(request, 404, r#"{"error":"unknown_endpoint"}"#),
        }
    }

    // Kapanis: tiny_http listener thread'ini uyandirmak icin server'i drop + kendine kisa TCP connect;
    // sonra OS'un soketi tam birakmasi icin kisa bekleme (yeniden bind "os error 10048" onlemi).
    drop(server);
    if let Ok(addr) = format!("127.0.0.1:{port}").parse::<std::net::SocketAddr>() {
        let _ = TcpStream::connect_timeout(&addr, Duration::from_millis(200));
    }
    std::thread::sleep(Duration::from_millis(100));
}

/// `?since=<ts>` degerini ayristir (yoksa/gecersizse 0 → tum bildirimler).
fn parse_since(url: &str) -> i64 {
    url.split('?')
        .nth(1)
        .and_then(|q| q.split('&').find_map(|kv| kv.strip_prefix("since=")))
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0)
}

/// 405 + `Allow` basligi (istemci hangi metotlarin gecerli oldugunu ogrenir).
fn respond_method_not_allowed(request: tiny_http::Request) {
    let mut response = tiny_http::Response::from_string(r#"{"error":"method_not_allowed"}"#)
        .with_status_code(405)
        .with_header(security::json_header());
    if let Ok(h) = "Allow: GET, OPTIONS".parse::<tiny_http::Header>() {
        response.add_header(h);
    }
    for h in security::cors_headers() {
        response.add_header(h);
    }
    let _ = request.respond(response);
}

/// [`QueryError`] → HTTP yaniti (LAN Faz 5 uclari icin ORTAK esleme). Hata DETAYI yalniz host
/// konsoluna yazilir (yol/sema sizmasin — 2026-07-19 sessiz-yutma dersi); istemciye STABIL kisa
/// govde gider. `BadRequest`→400 · `Internal`→500 · `Unavailable`→503 (`not_indexed`).
fn respond_query_error(request: tiny_http::Request, endpoint: &str, err: QueryError) {
    match err {
        QueryError::BadRequest(detail) => {
            eprintln!("[arsiv-h3] LAN {endpoint} gecersiz istek: {detail}");
            respond_json(request, 400, r#"{"error":"bad_request"}"#);
        }
        QueryError::Internal(detail) => {
            eprintln!("[arsiv-h3] LAN {endpoint} sorgu hatasi: {detail}");
            respond_json(request, 500, r#"{"error":"query"}"#);
        }
        QueryError::Unavailable(detail) => {
            eprintln!("[arsiv-h3] LAN {endpoint} hazir degil (indeks/model yok): {detail}");
            respond_json(request, 503, r#"{"error":"not_indexed"}"#);
        }
    }
}

fn respond_json(request: tiny_http::Request, status: u16, body: &str) {
    let mut response =
        tiny_http::Response::from_string(body).with_status_code(status).with_header(security::json_header());
    for h in security::cors_headers() {
        response.add_header(h);
    }
    let _ = request.respond(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn since_ayristirma() {
        assert_eq!(parse_since("/notifications?since=123"), 123);
        assert_eq!(parse_since("/notifications"), 0, "since yok -> 0");
        assert_eq!(parse_since("/notifications?since=abc"), 0, "gecersiz -> 0");
        assert_eq!(parse_since("/notifications?foo=1&since=42"), 42, "coklu param");
    }

    #[test]
    fn baslat_durdur_yasam_dongusu() {
        // Bos bildirim kaynagi ile baslat/durdur (port bind + thread + temiz kapanis).
        let notif: NotificationFn = Arc::new(|_since, _limit| Ok(vec![]));
        let assets: AssetQueryFn = Arc::new(|_opts| Ok(r#"{"total":0,"items":[]}"#.to_string()));
        let cfg = ServerConfig {
            port: 19471, // testte varsayilandan farkli port (cakisma onlemi)
            app_version: "test".into(),
            notifications: notif,
            archive: ArchiveApi { assets, ..ArchiveApi::unavailable() },
        };
        let handle = ServerHandle::start(cfg, Some("00000000".to_string())).expect("baslamali");
        assert_eq!(handle.port(), 19471);
        assert_eq!(handle.auth_code(), "00000000", "verilen kalici kod kullanilir");
        let fresh = handle.regenerate_code().expect("yenilenmeli");
        assert_eq!(fresh.len(), 8);
        assert_ne!(fresh, "00000000", "kod degismis olmali");
        handle.stop();
    }
}
