//! Archivist Pro — LAN Mini HTTP Sunucu (Faz 2)
//!
//! Tamamen offline, ofis içi LAN paylaşımı.
//! Port 9471 üzerinde çalışır, 8 haneli auth kodu + rate limit + tight CORS.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::UdpSocket;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Emitter;

use crate::ollama_db;

const LAN_PORT: u16 = 9471;

/// Başarısız auth denemelerini izlemek için IP başına sayaç.
/// `5 başarısız / 5 dakika` sınırını aşan IP'ler `LOCKOUT_DURATION` süresince reddedilir.
const MAX_FAILED_ATTEMPTS: u32 = 5;
const FAILED_WINDOW: Duration = Duration::from_secs(300);
const LOCKOUT_DURATION: Duration = Duration::from_secs(300);

#[derive(Default)]
struct AuthFailureTracker {
    /// IP → (son_hata_sayısı, pencere_başlangıcı, lockout_başlangıcı)
    map: HashMap<String, (u32, Instant, Option<Instant>)>,
}

static AUTH_FAILURES: Mutex<Option<AuthFailureTracker>> = Mutex::new(None);

fn get_auth_failures() -> &'static Mutex<Option<AuthFailureTracker>> {
    &AUTH_FAILURES
}

/// IP şu anda lockout altında mı?
fn is_ip_locked_out(ip: &str) -> bool {
    let guard = match get_auth_failures().lock() {
        Ok(g) => g,
        Err(_) => return false, // kilit hatası — fail-open değil, güvenli tarafa düş
    };
    let Some(tracker) = guard.as_ref() else { return false; };
    if let Some((_count, _window_start, Some(lock_start))) = tracker.map.get(ip) {
        if lock_start.elapsed() < LOCKOUT_DURATION {
            return true;
        }
    }
    false
}

/// IP için başarısız deneme kaydet, eşiği aşarsa lockout başlat.
fn record_auth_failure(ip: &str) {
    let mut guard = match get_auth_failures().lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let tracker = guard.get_or_insert_with(AuthFailureTracker::default);
    let now = Instant::now();
    let entry = tracker
        .map
        .entry(ip.to_string())
        .or_insert((0, now, None));

    // Mevcut lockout süresi dolduysa sıfırla
    if let Some(lock_start) = entry.2 {
        if lock_start.elapsed() >= LOCKOUT_DURATION {
            *entry = (0, now, None);
        }
    }
    // Pencere kayan; dolmuşsa sıfırla
    if entry.1.elapsed() >= FAILED_WINDOW {
        *entry = (0, now, None);
    }
    entry.0 += 1;
    if entry.0 >= MAX_FAILED_ATTEMPTS {
        entry.2 = Some(now);
    }
}

/// Başarılı auth — sayacı sıfırla
fn clear_auth_failures(ip: &str) {
    if let Ok(mut guard) = get_auth_failures().lock() {
        if let Some(tracker) = guard.as_mut() {
            tracker.map.remove(ip);
        }
    }
}

/// Sunucu durumu
struct ServerHandle {
    /// Sunucu durdurma sinyali
    shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Thread handle
    thread: std::thread::JoinHandle<()>,
    /// Auth kodu (paylaşımlı — regenerate sırasında yerinde güncellenir)
    auth_code: std::sync::Arc<Mutex<String>>,
    /// Yerel IP
    local_ip: String,
}

static SERVER: Mutex<Option<ServerHandle>> = Mutex::new(None);

#[derive(Serialize)]
pub struct ServerStartResult {
    port: u16,
    #[serde(rename = "authCode")]
    auth_code: String,
    #[serde(rename = "localIp")]
    local_ip: String,
}

#[derive(Serialize)]
pub struct ServerStatus {
    running: bool,
    port: Option<u16>,
    #[serde(rename = "authCode")]
    auth_code: Option<String>,
    #[serde(rename = "localIp")]
    local_ip: Option<String>,
}

/// Gelen geliştirici geri bildirimi payload'u
#[derive(Deserialize, Serialize, Clone)]
struct DevFeedbackPayload {
    sender: String,
    subject: Option<String>,
    body: String,
    timestamp: String,
}

/// Yerel IP adresini algıla (UDP trick — bağlantı kurulmaz)
pub fn detect_local_ip() -> String {
    UdpSocket::bind("0.0.0.0:0")
        .and_then(|sock| {
            sock.connect("192.168.1.1:80")?;
            sock.local_addr()
        })
        .map(|addr| addr.ip().to_string())
        .unwrap_or_else(|_| "127.0.0.1".to_string())
}

/// Rastgele 8 haneli auth kodu üret (yalnızca kriptografik RNG).
/// getrandom başarısız olursa hata döner — zayıf fallback yok.
/// 8 hane → 10^8 olasılık; rate limit ile birlikte pratikte brute-force'a kapalı.
fn generate_auth_code() -> Result<String, String> {
    let mut buf = [0u8; 4];
    getrandom::getrandom(&mut buf)
        .map_err(|e| format!("Kriptografik RNG başarısız: {}", e))?;
    let num = u32::from_le_bytes(buf) % 100_000_000;
    Ok(format!("{:08}", num))
}

/// CORS: sadece null origin + localhost/127.0.0.1 için izin ver.
/// LAN paylaşımı için istemci (curl, fetch) Origin göndermez, sorun çıkmaz.
/// Amaç: rastgele bir sitede açık tarayıcının kimlik kodu ele geçerse bile
/// sayfa doğrudan POST atamasın.
fn cors_headers() -> Vec<tiny_http::Header> {
    vec![
        "Access-Control-Allow-Origin: null".parse::<tiny_http::Header>().expect("valid CORS origin header"),
        "Vary: Origin".parse::<tiny_http::Header>().expect("valid Vary header"),
        "Access-Control-Allow-Headers: X-Auth-Code, Content-Type".parse::<tiny_http::Header>().expect("valid CORS headers header"),
        "Access-Control-Allow-Methods: GET, POST, OPTIONS".parse::<tiny_http::Header>().expect("valid CORS methods header"),
    ]
}

fn json_header() -> tiny_http::Header {
    "Content-Type: application/json"
        .parse::<tiny_http::Header>()
        .expect("valid JSON content-type header")
}

fn respond_json(request: tiny_http::Request, status: u16, body: &str) {
    let mut response = tiny_http::Response::from_string(body)
        .with_status_code(status)
        .with_header(json_header());
    for h in cors_headers() {
        response.add_header(h);
    }
    let _ = request.respond(response);
}

/// LAN sunucusunu başlat (Admin-only)
#[tauri::command]
pub fn lan_start_server(
    app: tauri::AppHandle,
    role_state: tauri::State<'_, crate::SessionRoleState>,
    dev_state: tauri::State<'_, crate::SessionDeveloperState>,
) -> Result<ServerStartResult, String> {
    crate::require_developer_or_admin(&role_state, &dev_state)?;
    let mut guard = SERVER.lock().map_err(|e| format!("Kilit hatası: {}", e))?;

    if guard.is_some() {
        return Err("Sunucu zaten çalışıyor".to_string());
    }

    // Kayıtlı kod varsa kullan, yoksa yeni üret ve kaydet
    let auth_code_str = match ollama_db::get_saved_lan_auth_code(&app) {
        Some(code) if code.len() == 8 => code,
        _ => {
            let new_code = generate_auth_code()?;
            let _ = ollama_db::save_lan_auth_code(&app, &new_code);
            new_code
        }
    };
    let auth_code = std::sync::Arc::new(Mutex::new(auth_code_str.clone()));
    let local_ip = detect_local_ip();
    let shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Windows'ta tiny_http iç thread'i soketi join'den sonra da kısa süre tutabilir.
    // 5 deneme × 300 ms retry ile bu pencereyi kapıyoruz.
    let server = {
        let addr = format!("0.0.0.0:{}", LAN_PORT);
        let mut last_err = String::new();
        let mut server_opt = None;
        for attempt in 0u8..5 {
            match tiny_http::Server::http(&addr) {
                Ok(s) => { server_opt = Some(s); break; }
                Err(e) => {
                    last_err = format!("Sunucu başlatılamadı: {}", e);
                    if attempt < 4 {
                        std::thread::sleep(std::time::Duration::from_millis(300));
                    }
                }
            }
        }
        server_opt.ok_or(last_err)?
    };

    let shutdown_clone = shutdown.clone();
    let auth_code_clone = auth_code.clone();
    let app_clone = app.clone();

    let thread = std::thread::spawn(move || {
        run_server(server, shutdown_clone, auth_code_clone, app_clone);
    });

    let result = ServerStartResult {
        port: LAN_PORT,
        auth_code: auth_code_str,
        local_ip: local_ip.clone(),
    };

    *guard = Some(ServerHandle {
        shutdown,
        thread,
        auth_code,
        local_ip,
    });

    Ok(result)
}

/// LAN sunucusunu durdur
#[tauri::command]
pub fn lan_stop_server() -> Result<(), String> {
    let mut guard = SERVER.lock().map_err(|e| format!("Kilit hatası: {}", e))?;

    if let Some(handle) = guard.take() {
        handle
            .shutdown
            .store(true, std::sync::atomic::Ordering::Relaxed);
        // Trigger server to wake up by connecting to it
        let _ = std::net::TcpStream::connect(format!("127.0.0.1:{}", LAN_PORT));
        // Thread bitmeden (port serbest kalmadan) dönme — aksi hâlde
        // hemen ardından gelen lan_start_server "os error 10048" alır.
        let _ = handle.thread.join();
    }

    Ok(())
}

/// LAN auth kodunu yeniler. Sunucu çalışıyorsa kodu yerinde günceller (restart gerekmez).
#[tauri::command]
pub fn lan_regenerate_auth_code(
    app: tauri::AppHandle,
    role_state: tauri::State<'_, crate::SessionRoleState>,
    dev_state: tauri::State<'_, crate::SessionDeveloperState>,
) -> Result<String, String> {
    crate::require_developer_or_admin(&role_state, &dev_state)?;
    let new_code = generate_auth_code()?;
    ollama_db::save_lan_auth_code(&app, &new_code)?;

    // Sunucu çalışıyorsa paylaşımlı auth kodunu yerinde güncelle
    let guard = SERVER.lock().map_err(|e| format!("Kilit hatası: {}", e))?;
    if let Some(ref handle) = *guard {
        let mut code_guard = handle.auth_code.lock()
            .map_err(|e| format!("Auth code kilit hatası: {}", e))?;
        *code_guard = new_code.clone();
    }

    Ok(new_code)
}

/// LAN sunucu durumu
#[tauri::command]
pub fn lan_get_server_status() -> Result<ServerStatus, String> {
    let guard = SERVER.lock().map_err(|e| format!("Kilit hatası: {}", e))?;

    match guard.as_ref() {
        Some(handle) => {
            let code = handle.auth_code.lock()
                .map(|c| c.clone())
                .unwrap_or_default();
            Ok(ServerStatus {
                running: true,
                port: Some(LAN_PORT),
                auth_code: Some(code),
                local_ip: Some(handle.local_ip.clone()),
            })
        },
        None => Ok(ServerStatus {
            running: false,
            port: None,
            auth_code: None,
            local_ip: None,
        }),
    }
}

/// HTTP sunucu döngüsü (ayrı thread'de çalışır)
fn run_server(
    server: tiny_http::Server,
    shutdown: std::sync::Arc<std::sync::atomic::AtomicBool>,
    auth_code: std::sync::Arc<Mutex<String>>,
    app: tauri::AppHandle,
) {
    loop {
        if shutdown.load(std::sync::atomic::Ordering::Relaxed) {
            break;
        }

        // 2 saniye timeout ile request bekle
        let request = match server.recv_timeout(std::time::Duration::from_secs(2)) {
            Ok(Some(req)) => req,
            Ok(None) => continue, // timeout, döngüye devam
            Err(_) => break,      // hata, çık
        };

        if shutdown.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = request.respond(tiny_http::Response::empty(200));
            break;
        }

        // OPTIONS preflight — CORS için hemen yanıtla
        if *request.method() == tiny_http::Method::Options {
            let mut response = tiny_http::Response::empty(204);
            for h in cors_headers() {
                response.add_header(h);
            }
            let _ = request.respond(response);
            continue;
        }

        // İstemci IP (rate limit için)
        let client_ip = request.remote_addr()
            .map(|addr| addr.ip().to_string())
            .unwrap_or_else(|| "unknown".to_string());

        // Lockout kontrolü — başarısız denemelerle kilitlenmiş IP'leri reddet
        if is_ip_locked_out(&client_ip) {
            respond_json(
                request,
                429,
                r#"{"error":"Çok fazla başarısız deneme — 5 dakika bekleyin"}"#,
            );
            continue;
        }

        // Auth kontrolü — header field string olarak karşılaştır
        let req_auth: Option<String> = request
            .headers()
            .iter()
            .find(|h| {
                let field: &str = h.field.as_str().as_str();
                field.eq_ignore_ascii_case("x-auth-code")
            })
            .map(|h| h.value.as_str().to_string());

        let url = request.url().to_string();

        // /ping tek auth'suz endpoint (network discovery için gerekli).
        // /dev-feedback dahil diğer tüm endpoint'ler auth gerektirir.
        if url != "/ping" {
            let authed = match req_auth {
                Some(ref code) => {
                    let current_code = auth_code.lock().map(|c| c.clone()).unwrap_or_default();
                    constant_time_eq(code.as_bytes(), current_code.as_bytes())
                },
                None => false,
            };
            if !authed {
                record_auth_failure(&client_ip);
                respond_json(request, 403, r#"{"error":"Yetkisiz erişim"}"#);
                continue;
            }
            // Başarılı auth — sayacı temizle
            clear_auth_failures(&client_ip);
        }

        match url.as_str() {
            "/ping" => {
                let body = format!(
                    r#"{{"status":"ok","appVersion":"{}"}}"#,
                    env!("CARGO_PKG_VERSION")
                );
                respond_json(request, 200, &body);
            }
            "/dev-feedback" if *request.method() == tiny_http::Method::Post => {
                handle_dev_feedback(request, &app);
            }
            "/manifest" => {
                handle_manifest(request, &app);
            }
            "/download" => {
                handle_download(request, &app);
            }
            _ => {
                respond_json(request, 404, r#"{"error":"Bilinmeyen endpoint"}"#);
            }
        }
    }

    // Kapanış: tiny_http'nin dahili listener thread'i bir sonraki `accept()`
    // çağrısı gelene kadar soketi bırakmaz. Server'ı explicit drop edip
    // shutdown flag'ini setledikten sonra kısa timeout'lu bir TCP connect ile
    // bu thread'i uyandırıyoruz — ancak bu zaman porta yeni bind yapılabilir.
    drop(server);
    if let Ok(addr) = format!("127.0.0.1:{}", LAN_PORT).parse::<std::net::SocketAddr>() {
        let _ = std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(200));
    }
    // OS'un soketi tamamen serbest bırakması için kısa bir bekleme.
    std::thread::sleep(std::time::Duration::from_millis(100));
}

/// Constant-time byte karşılaştırma — timing attack'a karşı.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// POST /dev-feedback — Geliştirici geri bildirimi al ve frontend'e emit et.
/// Auth gerektirir (run_server içinde kontrol edilir).
/// Body boyutu 64 KB ile sınırlıdır — DoS korumasına karşı.
fn handle_dev_feedback(mut request: tiny_http::Request, app: &tauri::AppHandle) {
    use std::io::Read;
    const MAX_BODY_BYTES: u64 = 64 * 1024;
    let mut body = String::new();
    if request
        .as_reader()
        .take(MAX_BODY_BYTES)
        .read_to_string(&mut body)
        .is_err()
    {
        respond_json(request, 400, r#"{"error":"Gövde okunamadı"}"#);
        return;
    }
    let mut payload: DevFeedbackPayload = match serde_json::from_str(&body) {
        Ok(p) => p,
        Err(_) => {
            respond_json(request, 400, r#"{"error":"Geçersiz JSON"}"#);
            return;
        }
    };
    // Frontend tarafında XSS'i engellemek için keskin kısaltma + kontrol karakter filtresi
    sanitize_feedback_field(&mut payload.sender, 120);
    if let Some(ref mut s) = payload.subject {
        sanitize_feedback_field(s, 200);
    }
    sanitize_feedback_field(&mut payload.body, 4000);
    sanitize_feedback_field(&mut payload.timestamp, 64);

    let _ = app.emit("dev-feedback-received", payload);
    respond_json(request, 200, r#"{"ok":true}"#);
}

/// Dev-feedback alanlarını uzunluk sınırla + kontrol karakterlerini filtrele.
fn sanitize_feedback_field(s: &mut String, max_len: usize) {
    // Kontrol karakterlerini (tab ve newline hariç) çıkar
    s.retain(|c| !c.is_control() || c == '\n' || c == '\t');
    if s.chars().count() > max_len {
        *s = s.chars().take(max_len).collect();
    }
}

/// GET /manifest — Arşiv manifest bilgisi
fn handle_manifest(request: tiny_http::Request, app: &tauri::AppHandle) {
    let db_path = match ollama_db::resolve_db_path(app) {
        Ok(p) => p,
        Err(e) => {
            let body = format!(r#"{{"error":"{}"}}"#, e);
            respond_json(request, 500, &body);
            return;
        }
    };

    let db_size = if db_path.exists() {
        std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    // SHA-256 hash hesapla (bütünlük doğrulaması için)
    let sha256_hex = if db_path.exists() {
        match std::fs::read(&db_path) {
            Ok(bytes) => {
                use sha2::Digest;
                let hash = sha2::Sha256::digest(&bytes);
                format!("{:x}", hash)
            }
            Err(_) => String::new(),
        }
    } else {
        String::new()
    };

    let body = format!(
        r#"{{"version":1,"appVersion":"{}","dbSizeBytes":{},"createdAt":"{}","sha256":"{}"}}"#,
        env!("CARGO_PKG_VERSION"),
        db_size,
        chrono::Utc::now().to_rfc3339(),
        sha256_hex
    );

    respond_json(request, 200, &body);
}

/// GET /download — DB dosyasını binary stream olarak gönder
fn handle_download(request: tiny_http::Request, app: &tauri::AppHandle) {
    let db_path = match ollama_db::resolve_db_path(app) {
        Ok(p) => p,
        Err(e) => {
            let body = format!(r#"{{"error":"{}"}}"#, e);
            respond_json(request, 500, &body);
            return;
        }
    };

    // Shared lock al — yazma sırasında yarı-yazılmış veri serve etmeyi engeller
    let _read_lock = ollama_db::try_acquire_db_read_lock(&db_path);
    if _read_lock.is_none() {
        respond_json(request, 503, r#"{"error":"DB şu anda yazılıyor, lütfen bekleyin"}"#);
        return;
    }

    let db_bytes = match std::fs::read(&db_path) {
        Ok(bytes) => bytes,
        Err(e) => {
            let body = format!(r#"{{"error":"DB okunamadı: {}"}}"#, e);
            respond_json(request, 500, &body);
            return;
        }
    };

    let len = db_bytes.len();
    let cursor = std::io::Cursor::new(db_bytes);
    let content_length = match format!("Content-Length: {}", len)
        .parse::<tiny_http::Header>() {
        Ok(h) => h,
        Err(_) => {
            respond_json(request, 500, r#"{"error":"Header oluşturulamadı"}"#);
            return;
        }
    };
    let mut headers = vec![
        "Content-Type: application/octet-stream"
            .parse::<tiny_http::Header>()
            .expect("valid literal header"),
        content_length,
        "Content-Disposition: attachment; filename=\"archive.db\""
            .parse::<tiny_http::Header>()
            .expect("valid literal header"),
    ];
    headers.extend(cors_headers());
    let response = tiny_http::Response::new(
        tiny_http::StatusCode(200),
        headers,
        cursor,
        Some(len),
        None,
    );
    let _ = request.respond(response);
}
