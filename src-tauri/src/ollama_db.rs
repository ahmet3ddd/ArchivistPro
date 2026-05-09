//! Ollama HTTP proxy ve uygulama veri dizini SQLite okuma/yazma.
use std::sync::Mutex;
use fs2::FileExt;
use tauri::Manager;
use base64::Engine;

/// DPAPI ile LAN auth-code şifreleme — config JSON'da plaintext yerine
/// `DPAPI:<base64>` format. Aynı kullanıcı + makine kombinasyonunda decrypt edilebilir;
/// başka kullanıcı/makine erişemez. crypt32.dll Windows'ta default sistem DLL.
#[cfg(windows)]
mod dpapi {
    use std::ptr;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DataBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut std::ffi::c_void,
            p_prompt_struct: *mut std::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;

        fn CryptUnprotectData(
            p_data_in: *const DataBlob,
            pp_sz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut std::ffi::c_void,
            p_prompt_struct: *mut std::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }

    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let input = DataBlob {
            cb_data: plaintext.len() as u32,
            pb_data: plaintext.as_ptr() as *mut u8,
        };
        let mut output = DataBlob { cb_data: 0, pb_data: ptr::null_mut() };
        let ok = unsafe {
            CryptProtectData(
                &input, ptr::null(), ptr::null(), ptr::null_mut(),
                ptr::null_mut(), 0, &mut output,
            )
        };
        if ok == 0 {
            return Err("CryptProtectData failed".to_string());
        }
        let result = unsafe {
            std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec()
        };
        unsafe { LocalFree(output.pb_data as *mut std::ffi::c_void); }
        Ok(result)
    }

    pub fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let input = DataBlob {
            cb_data: ciphertext.len() as u32,
            pb_data: ciphertext.as_ptr() as *mut u8,
        };
        let mut output = DataBlob { cb_data: 0, pb_data: ptr::null_mut() };
        let mut descr: *mut u16 = ptr::null_mut();
        let ok = unsafe {
            CryptUnprotectData(
                &input, &mut descr, ptr::null(), ptr::null_mut(),
                ptr::null_mut(), 0, &mut output,
            )
        };
        if ok == 0 {
            return Err("CryptUnprotectData failed".to_string());
        }
        let result = unsafe {
            std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec()
        };
        unsafe {
            LocalFree(output.pb_data as *mut std::ffi::c_void);
            if !descr.is_null() {
                LocalFree(descr as *mut std::ffi::c_void);
            }
        }
        Ok(result)
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        // Windows dışı platformlarda passthrough — proje şu an Windows-only,
        // ileride Linux/Mac için keyring/secret-service eklenecek.
        Ok(plaintext.to_vec())
    }
    pub fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(ciphertext.to_vec())
    }
}

const DPAPI_PREFIX: &str = "DPAPI:";

/// LAN auth-code'u DPAPI ile şifreleyip `DPAPI:<base64>` formatına çevirir.
fn encrypt_lan_auth_code(plain: &str) -> Result<String, String> {
    let ciphertext = dpapi::protect(plain.as_bytes())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&ciphertext);
    Ok(format!("{}{}", DPAPI_PREFIX, b64))
}

/// Stored value'yu çözer. `DPAPI:` prefix'i varsa decrypt eder; yoksa legacy
/// plaintext olarak kabul eder (eski format, ilk save'de upgrade edilir).
fn decrypt_lan_auth_code(stored: &str) -> Result<String, String> {
    if let Some(b64) = stored.strip_prefix(DPAPI_PREFIX) {
        let ciphertext = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Base64 decode hatası: {}", e))?;
        let plain = dpapi::unprotect(&ciphertext)?;
        String::from_utf8(plain).map_err(|e| format!("UTF-8 decode hatası: {}", e))
    } else {
        // Legacy plaintext — eski sürümden gelen değer
        Ok(stored.to_string())
    }
}

/// DB yazma işlemlerini serialize eden kilit.
static DB_WRITE_LOCK: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();

pub(crate) fn get_db_lock() -> &'static Mutex<()> {
    DB_WRITE_LOCK.get_or_init(|| Mutex::new(()))
}

/// Dosyayı atomik olarak yazıp `fsync` ile diske flush eder — power loss resilience.
///
/// Strateji: temp dosyaya yaz → fsync → rename (NTFS'te atomik).
/// Bu sayede orijinal dosya hiçbir zaman yarı-yazılmış durumda kalmaz.
pub(crate) fn write_and_sync(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    use std::io::Write;

    let tmp_path = path.with_extension("db.tmp");

    // 1. Temp dosyaya yaz + fsync
    {
        let mut file = std::fs::File::create(&tmp_path)?;
        file.write_all(data)?;
        file.sync_all()?;
    }

    // 2. Windows'ta rename hedef varsa sil (NTFS rename hedef-varsa hata verir)
    if path.exists() {
        std::fs::remove_file(path)?;
    }

    // 3. Atomik rename
    std::fs::rename(&tmp_path, path)?;

    Ok(())
}

/// DB dosyası için inter-process yazma kilidi al (fs2 exclusive lock).
/// Dönen File handle drop edilince kilit otomatik serbest kalır.
pub(crate) fn acquire_db_write_lock(db_path: &std::path::Path) -> std::io::Result<std::fs::File> {
    let lock_path = db_path.with_extension("db.lock");
    let lock_file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&lock_path)?;
    lock_file.lock_exclusive()?;
    Ok(lock_file)
}

/// DB dosyası için inter-process okuma kilidi dene (fs2 shared lock).
/// Başka process yazıyorsa None döner (bloklamaz).
pub(crate) fn try_acquire_db_read_lock(db_path: &std::path::Path) -> Option<std::fs::File> {
    let lock_path = db_path.with_extension("db.lock");
    let lock_file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .ok()?;
    #[allow(clippy::incompatible_msrv)]
    match lock_file.try_lock_shared() {
        Ok(()) => Some(lock_file),
        Err(_) => None, // başka process exclusive lock tutuyor
    }
}

/// SSRF koruması: sadece localhost bağlantılarına izin ver.
fn validate_ollama_url(raw: &str) -> Result<(), String> {
    let parsed = url::Url::parse(raw)
        .map_err(|_| format!("Geçersiz URL: {}", raw))?;

    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("İzin verilmeyen şema: {}", s)),
    }

    match parsed.host_str() {
        Some("localhost") | Some("127.0.0.1") | Some("[::1]") | Some("::1") => Ok(()),
        Some(h) => Err(format!("Yalnızca localhost'a izin verilir, '{}' reddedildi", h)),
        None => Err("URL'de host bulunamadı".to_string()),
    }
}

/// Proxies a JSON POST request to a local Ollama server from the Rust backend.
#[tauri::command]
pub async fn ollama_proxy(url: String, body: String) -> Result<String, String> {
    validate_ollama_url(&url)?;

    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(10))
            .timeout_read(std::time::Duration::from_secs(900))
            .timeout_write(std::time::Duration::from_secs(60))
            .build();

        match agent
            .post(&url)
            .set("Content-Type", "application/json")
            .send_string(&body)
        {
            Ok(resp) => resp
                .into_string()
                .map_err(|e| format!("Yanıt okunamadı: {}", e)),
            Err(ureq::Error::Status(code, resp)) => {
                let error_body = resp.into_string().unwrap_or_default();
                Err(format!("Ollama HTTP {}: {}", code, error_body))
            }
            Err(ureq::Error::Transport(e)) => Err(format!("Ollama bağlantı hatası: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Ollama model çek (POST /api/pull, streaming). Büyük model indirmesi uzun sürebilir.
#[tauri::command]
pub async fn ollama_pull_model(model: String) -> Result<String, String> {
    // Model adı doğrulama — injection koruması
    if model.is_empty()
        || model.len() > 200
        || !model
            .chars()
            .all(|c| c.is_alphanumeric() || "-./:_".contains(c))
    {
        return Err("Geçersiz model adı".to_string());
    }

    let url = "http://localhost:11434/api/pull".to_string();
    validate_ollama_url(&url)?;

    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(10))
            .timeout_read(std::time::Duration::from_secs(300)) // chunk arası max 5 dk
            .timeout_write(std::time::Duration::from_secs(60))
            .build();

        let body = format!(r#"{{"name":"{}","stream":true}}"#, model);

        match agent
            .post(&url)
            .set("Content-Type", "application/json")
            .send_string(&body)
        {
            Ok(resp) => {
                // Streaming NDJSON yanıtını satır satır tüket, son satırı döndür
                let reader = std::io::BufReader::new(resp.into_reader());
                use std::io::BufRead;
                let mut last_line = String::new();
                for line in reader.lines() {
                    match line {
                        Ok(l) if !l.is_empty() => last_line = l,
                        Err(e) => return Err(format!("Okuma hatası: {}", e)),
                        _ => {}
                    }
                }
                Ok(last_line)
            }
            Err(ureq::Error::Status(code, resp)) => {
                let error_body = resp.into_string().unwrap_or_default();
                Err(format!("Ollama HTTP {}: {}", code, error_body))
            }
            Err(ureq::Error::Transport(e)) => Err(format!("Ollama bağlantı hatası: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// OLLAMA_HOST ortam değişkenini okur. Ollama'nın dinlediği host:port bilgisidir.
/// Set edilmemişse None döner → uygulama varsayılan `localhost:11434`'ü kullanır.
#[tauri::command]
pub fn get_ollama_host_env() -> Option<String> {
    std::env::var("OLLAMA_HOST").ok().and_then(|v| {
        let trimmed = v.trim();
        if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
    })
}

/// OLLAMA_ORIGINS kayıt defterinde tanımlı mı kontrol et (CORS).
#[tauri::command]
pub async fn check_ollama_cors() -> bool {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::HKEY_CURRENT_USER;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(env_key) = hkcu.open_subkey("Environment") {
            if let Ok(val) = env_key.get_value::<String, _>("OLLAMA_ORIGINS") {
                return !val.is_empty();
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        // Non-Windows: env var'dan oku
        !std::env::var("OLLAMA_ORIGINS").unwrap_or_default().is_empty()
    }
}

/// Windows'ta OLLAMA_ORIGINS ortam değişkenini "*" olarak ayarla (CORS izni).
#[tauri::command]
pub async fn set_ollama_cors() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let output = std::process::Command::new("setx")
                .args(["OLLAMA_ORIGINS", "*"])
                .output()
                .map_err(|e| format!("setx çalıştırılamadı: {}", e))?;

            if output.status.success() {
                Ok("OK".to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("setx hatası: {}", stderr))
            }
        })
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Bu özellik yalnızca Windows'ta desteklenir".to_string())
    }
}

/// Ollama sunucusunu başlat (ollama serve).
#[tauri::command]
pub async fn start_ollama() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            const DETACHED_PROCESS: u32 = 0x00000008;

            std::process::Command::new("ollama")
                .arg("serve")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)
                .spawn()
                .map_err(|e| format!("Ollama başlatılamadı: {}", e))?;

            Ok("started".to_string())
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::process::Command::new("ollama")
                .arg("serve")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .map_err(|e| format!("Ollama başlatılamadı: {}", e))?;

            Ok("started".to_string())
        }
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Ollama sunucusunu durdur.
#[tauri::command]
pub async fn stop_ollama() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        #[cfg(target_os = "windows")]
        {
            let output = std::process::Command::new("taskkill")
                .args(["/f", "/im", "ollama.exe"])
                .output()
                .map_err(|e| format!("Ollama durdurulamadı: {}", e))?;

            if output.status.success() {
                Ok("stopped".to_string())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!("Ollama durdurulamadı: {}", stderr.trim()))
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let output = std::process::Command::new("pkill")
                .args(["-f", "ollama serve"])
                .output()
                .map_err(|e| format!("Ollama durdurulamadı: {}", e))?;

            if output.status.success() {
                Ok("stopped".to_string())
            } else {
                Err("Ollama durdurulamadı veya zaten kapalı".to_string())
            }
        }
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Sistem seviyesinde NVIDIA GPU tespiti — nvidia-smi ile kontrol eder.
/// Model yüklü olmasa bile çalışır. Uygulama başlangıcında bir kere çağrılır.
#[tauri::command]
pub async fn detect_gpu() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let output = std::process::Command::new("nvidia-smi")
            .args(["--query-gpu=name", "--format=csv,noheader"])
            .output();
        match output {
            Ok(o) => Ok(o.status.success() && !o.stdout.is_empty()),
            Err(_) => Ok(false), // nvidia-smi yoksa GPU yok
        }
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// GET /api/tags — Ollama sunucu kontrolü.
#[tauri::command]
pub async fn ollama_ping(url: String) -> Result<String, String> {
    validate_ollama_url(&url)?;

    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(5))
            .timeout_read(std::time::Duration::from_secs(10))
            .build();

        match agent.get(&url).call() {
            Ok(resp) => resp
                .into_string()
                .map_err(|e| format!("Yanıt okunamadı: {}", e)),
            Err(ureq::Error::Status(code, resp)) => {
                let error_body = resp.into_string().unwrap_or_default();
                Err(format!("Ollama HTTP {}: {}", code, error_body))
            }
            Err(ureq::Error::Transport(e)) => Err(format!("Ollama bağlantı hatası: {}", e)),
        }
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize)]
pub struct DbReadResult {
    pub bytes: Vec<u8>,
    pub corrupted: bool,
    /// Başka bir işlem DB'ye yazıyorsa true — frontend uyarı göstermeli.
    #[serde(default)]
    pub locked_by_other: bool,
}

const DEFAULT_DB_NAME: &str = "archivist.db";
const LOCAL_DB_NAME: &str = "archivist_local.db";
const CONFIG_FILE_NAME: &str = "archivist_config.json";

#[derive(Serialize, Deserialize, Clone)]
pub struct ExtraArchiveConfig {
    pub id: String,
    pub name: String,
    pub db_path: String,
    pub archive_type: String, // "shared" | "personal"
}

#[derive(Serialize, Deserialize)]
struct ArchivistConfig {
    db_path: String,
    #[serde(default)]
    local_db_path: Option<String>,
    #[serde(default)]
    extra_archives: Vec<ExtraArchiveConfig>,
    #[serde(default)]
    pub lan_auth_code: Option<String>,
}

fn get_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?;
    Ok(dir.join(CONFIG_FILE_NAME))
}

fn load_config(app: &tauri::AppHandle) -> Option<ArchivistConfig> {
    let config_path = get_config_path(app).ok()?;
    if !config_path.exists() {
        return None;
    }
    let bytes = std::fs::read(config_path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Config'den kayıtlı LAN auth code'u okur. DPAPI ile şifreliyse çözer; legacy
/// plaintext değerleri olduğu gibi döner (sonraki save'de otomatik şifrelenir).
pub fn get_saved_lan_auth_code(app: &tauri::AppHandle) -> Option<String> {
    let stored = load_config(app).and_then(|c| c.lan_auth_code)?;
    match decrypt_lan_auth_code(&stored) {
        Ok(plain) => Some(plain),
        Err(e) => {
            log::warn!("LAN auth-code decrypt başarısız ({}). Legacy fallback denenecek.", e);
            // Bozulmuş ciphertext durumunda config'i kaybetmek yerine None dön
            None
        }
    }
}

/// LAN auth code'u DPAPI ile şifreleyip config'e yazar.
pub fn save_lan_auth_code(app: &tauri::AppHandle, code: &str) -> Result<(), String> {
    let default_db = get_default_db_path(app)?.to_string_lossy().to_string();
    let mut cfg = load_config(app).unwrap_or(ArchivistConfig {
        db_path: default_db,
        local_db_path: None,
        extra_archives: vec![],
        lan_auth_code: None,
    });
    let encrypted = encrypt_lan_auth_code(code)?;
    cfg.lan_auth_code = Some(encrypted);
    let cfg_bytes = serde_json::to_vec_pretty(&cfg)
        .map_err(|e| format!("Config serileştirilemedi: {}", e))?;
    let cfg_path = get_config_path(app)?;
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Config dizini oluşturulamadı: {}", e))?;
    }
    write_and_sync(&cfg_path, &cfg_bytes).map_err(|e| format!("Config yazılamadı: {}", e))
}

fn get_default_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?;
    Ok(dir.join(DEFAULT_DB_NAME))
}

pub(crate) fn resolve_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(cfg) = load_config(app) {
        let custom = PathBuf::from(cfg.db_path);
        if custom.exists() {
            return Ok(custom);
        }
    }
    get_default_db_path(app)
}

#[tauri::command]
pub async fn read_database(app: tauri::AppHandle) -> Result<DbReadResult, String> {
    let path = resolve_db_path(&app)?;
    if !path.exists() {
        return Ok(DbReadResult { bytes: vec![], corrupted: false, locked_by_other: false });
    }

    // Başka bir process yazma kilidi tutuyorsa uyar
    let locked_by_other = try_acquire_db_read_lock(&path).is_none();

    let bytes = std::fs::read(&path).map_err(|e| format!("DB okunamadı: {}", e))?;

    // SQLite magic header kontrolü: "SQLite format 3\0" (ilk 16 bayt)
    const SQLITE_MAGIC: &[u8] = b"SQLite format 3\x00";
    if bytes.len() < 16 || &bytes[..16] != SQLITE_MAGIC {
        // Bozuk dosyayı yedekle, corrupted=true ile boş döndür
        let backup = path.with_extension("corrupt.bak");
        let _ = std::fs::rename(&path, &backup);
        return Ok(DbReadResult { bytes: vec![], corrupted: true, locked_by_other: false });
    }

    Ok(DbReadResult { bytes, corrupted: false, locked_by_other })
}

#[derive(Serialize)]
pub struct DbMetaResult {
    pub exists: bool,
    #[serde(rename = "sizeBytes")]
    pub size_bytes: u64,
    pub corrupted: bool,
    #[serde(rename = "lockedByOther")]
    pub locked_by_other: bool,
}

/// Ana DB'nin meta bilgisi (corruption / lock / boyut). Bytes içermez — binary IPC için ayrı komut.
/// Bozuk dosyayı yedekleyip silen yan etkiyi de tetikler (read_database ile aynı semantik).
#[tauri::command]
pub async fn read_database_meta(app: tauri::AppHandle) -> Result<DbMetaResult, String> {
    let path = resolve_db_path(&app)?;
    if !path.exists() {
        return Ok(DbMetaResult { exists: false, size_bytes: 0, corrupted: false, locked_by_other: false });
    }

    let locked_by_other = try_acquire_db_read_lock(&path).is_none();

    // Magic byte kontrolü için sadece ilk 16 bayt oku — full-file read'e gerek yok
    use std::io::Read;
    let mut header = [0u8; 16];
    let read_count = std::fs::File::open(&path)
        .and_then(|mut f| f.read(&mut header))
        .map_err(|e| format!("DB açılamadı: {}", e))?;

    const SQLITE_MAGIC: &[u8] = b"SQLite format 3\x00";
    if read_count < 16 || &header[..16] != SQLITE_MAGIC {
        let backup = path.with_extension("corrupt.bak");
        let _ = std::fs::rename(&path, &backup);
        return Ok(DbMetaResult { exists: false, size_bytes: 0, corrupted: true, locked_by_other: false });
    }

    let metadata = std::fs::metadata(&path).map_err(|e| format!("Metadata okunamadı: {}", e))?;
    Ok(DbMetaResult {
        exists: true,
        size_bytes: metadata.len(),
        corrupted: false,
        locked_by_other,
    })
}

/// Ana DB'yi binary IPC üzerinden döndürür — JSON `Vec<u8>` serialize yok.
/// Önce `read_database_meta` ile corruption/lock kontrolü yapılmalı.
#[tauri::command]
pub async fn read_database_binary(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = resolve_db_path(&app)?;
    if !path.exists() {
        return Ok(tauri::ipc::Response::new(Vec::<u8>::new()));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("DB okunamadı: {}", e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn write_database(
    app: tauri::AppHandle,
    data: Vec<u8>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    // Güvenlik: oturum açılmamış çağrıları reddet (XSS / enjekte script koruması).
    // Mesaj ve kullanıcı tablosu viewer için write gerektirdiğinden admin zorunlu değil.
    crate::require_authenticated(&role_state)?;
    let _guard = get_db_lock()
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;
    let path = resolve_db_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
    }
    // Inter-process file lock — başka instance yazmasını engeller
    let _file_lock = acquire_db_write_lock(&path)
        .map_err(|e| format!("DB dosya kilidi alınamadı (başka instance açık olabilir): {}", e))?;
    write_and_sync(&path, &data).map_err(|e| format!("DB yazılamadı: {}", e))
}

#[tauri::command]
pub async fn get_local_database_info(app: tauri::AppHandle) -> Result<(String, u64), String> {
    let path = resolve_local_db_path(&app)?;
    let path_str = path.to_string_lossy().to_string();
    let size = if path.exists() {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    Ok((path_str, size))
}

pub(crate) fn resolve_local_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(cfg) = load_config(app) {
        if let Some(ref custom) = cfg.local_db_path {
            let custom_path = PathBuf::from(custom);
            if custom_path.exists() {
                return Ok(custom_path);
            }
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?;
    Ok(dir.join(LOCAL_DB_NAME))
}

#[tauri::command]
pub async fn read_local_database(app: tauri::AppHandle) -> Result<Vec<u8>, String> {
    let path = resolve_local_db_path(&app)?;
    if path.exists() {
        std::fs::read(&path).map_err(|e| format!("Local DB okunamadı: {}", e))
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
pub async fn write_local_database(
    app: tauri::AppHandle,
    data: Vec<u8>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;
    let _guard = get_db_lock()
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;
    let path = resolve_local_db_path(&app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
    }
    let _file_lock = acquire_db_write_lock(&path)
        .map_err(|e| format!("Local DB dosya kilidi alınamadı: {}", e))?;
    write_and_sync(&path, &data).map_err(|e| format!("Local DB yazılamadı: {}", e))
}

fn normalize_db_target(path: &str) -> PathBuf {
    normalize_db_target_with_name(path, DEFAULT_DB_NAME)
}

fn normalize_db_target_with_name(path: &str, db_name: &str) -> PathBuf {
    let p = PathBuf::from(path);
    if path.to_lowercase().ends_with(".db") {
        p
    } else {
        p.join(db_name)
    }
}

#[tauri::command]
pub async fn set_database_path(
    app: tauri::AppHandle,
    path: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_admin(&role_state)?;
    // Path traversal koruması
    if path.contains("..") {
        return Err("Yol geçişi (path traversal) reddedildi: '..' içeremez".to_string());
    }
    let target = normalize_db_target(&path);

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Hedef dizin oluşturulamadı: {}", e))?;
    }

    // Canonicalize ile çözümlenmiş yolun ".." içermediğini doğrula
    let canonical_target = if target.exists() {
        target.canonicalize()
            .map_err(|e| format!("Yol doğrulanamadı: {}", e))?
    } else {
        let parent = target.parent()
            .ok_or_else(|| "Hedef yolun parent dizini yok".to_string())?;
        let file_name = target.file_name()
            .ok_or_else(|| "Hedef yolda dosya adı yok".to_string())?;
        let canonical_parent = parent.canonicalize()
            .map_err(|e| format!("Parent dizin doğrulanamadı: {}", e))?;
        canonical_parent.join(file_name)
    };
    let canonical_str = canonical_target.to_string_lossy();
    if canonical_str.contains("..") {
        return Err("Yol geçişi reddedildi: çözümlenmiş yol hâlâ '..' içeriyor".to_string());
    }

    // Eski varsayılan DB varsa ve hedefte dosya yoksa kopyala (mevcut veriyi taşımak için)
    let default_path = get_default_db_path(&app)?;
    if default_path.exists() && !target.exists() {
        std::fs::copy(&default_path, &target)
            .map_err(|e| format!("DB kopyalanamadı: {}", e))?;
    }

    let mut cfg = load_config(&app).unwrap_or(ArchivistConfig {
        db_path: String::new(),
        local_db_path: None,
        extra_archives: vec![],
        lan_auth_code: None,
    });
    cfg.db_path = target.to_string_lossy().to_string();
    let cfg_bytes = serde_json::to_vec_pretty(&cfg)
        .map_err(|e| format!("Config serileştirilemedi: {}", e))?;
    let cfg_path = get_config_path(&app)?;
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Config dizini oluşturulamadı: {}", e))?;
    }
    write_and_sync(&cfg_path, &cfg_bytes).map_err(|e| format!("Config yazılamadı: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn set_local_database_path(
    app: tauri::AppHandle,
    path: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_admin(&role_state)?;
    if path.contains("..") {
        return Err("Yol geçişi (path traversal) reddedildi: '..' içeremez".to_string());
    }
    let target = normalize_db_target_with_name(&path, LOCAL_DB_NAME);

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Hedef dizin oluşturulamadı: {}", e))?;
    }

    let canonical_target = if target.exists() {
        target.canonicalize()
            .map_err(|e| format!("Yol doğrulanamadı: {}", e))?
    } else {
        let parent = target.parent()
            .ok_or_else(|| "Hedef yolun parent dizini yok".to_string())?;
        let file_name = target.file_name()
            .ok_or_else(|| "Hedef yolda dosya adı yok".to_string())?;
        let canonical_parent = parent.canonicalize()
            .map_err(|e| format!("Parent dizin doğrulanamadı: {}", e))?;
        canonical_parent.join(file_name)
    };
    let canonical_str = canonical_target.to_string_lossy();
    if canonical_str.contains("..") {
        return Err("Yol geçişi reddedildi: çözümlenmiş yol hâlâ '..' içeriyor".to_string());
    }

    // Mevcut local DB varsa ve hedefte dosya yoksa kopyala
    let default_local = app.path().app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?
        .join(LOCAL_DB_NAME);
    if default_local.exists() && !target.exists() {
        std::fs::copy(&default_local, &target)
            .map_err(|e| format!("Local DB kopyalanamadı: {}", e))?;
    }

    // Mevcut config'i oku (main db_path'i korumak için)
    let mut cfg = load_config(&app).unwrap_or(ArchivistConfig {
        db_path: get_default_db_path(&app)?.to_string_lossy().to_string(),
        local_db_path: None,
        extra_archives: vec![],
        lan_auth_code: None,
    });
    cfg.local_db_path = Some(target.to_string_lossy().to_string());

    let cfg_bytes = serde_json::to_vec_pretty(&cfg)
        .map_err(|e| format!("Config serileştirilemedi: {}", e))?;
    let cfg_path = get_config_path(&app)?;
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Config dizini oluşturulamadı: {}", e))?;
    }
    write_and_sync(&cfg_path, &cfg_bytes).map_err(|e| format!("Config yazılamadı: {}", e))?;

    Ok(())
}

/// Aktif veritabanı yolunu döndürür (frontend bilgilendirme için).
#[tauri::command]
pub async fn get_database_info(app: tauri::AppHandle) -> Result<(String, u64), String> {
    let path = resolve_db_path(&app)?;
    let path_str = path.to_string_lossy().to_string();
    let size = if path.exists() {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    Ok((path_str, size))
}

/* ── Çoklu Arşiv Komutları ── */

pub(crate) fn resolve_archive_path(app: &tauri::AppHandle, archive_id: &str) -> Result<PathBuf, String> {
    if let Some(cfg) = load_config(app) {
        if let Some(extra) = cfg.extra_archives.iter().find(|a| a.id == archive_id) {
            return Ok(PathBuf::from(&extra.db_path));
        }
    }
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?;
    Ok(dir.join(format!("archive_{}.db", archive_id)))
}

#[tauri::command]
pub async fn read_archive(app: tauri::AppHandle, archive_id: String) -> Result<Vec<u8>, String> {
    let path = resolve_archive_path(&app, &archive_id)?;
    if path.exists() {
        std::fs::read(&path).map_err(|e| format!("Archive DB okunamadı: {}", e))
    } else {
        Ok(vec![])
    }
}

#[tauri::command]
pub async fn write_archive(
    app: tauri::AppHandle,
    archive_id: String,
    data: Vec<u8>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;
    // Ek koruma: sadece configure edilmiş archive_id'lere yazmaya izin ver.
    // Bu, frontend'ten gelen rastgele string ile keyfi klasör oluşturmayı engeller.
    if !archive_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Geçersiz archive_id (sadece harf/rakam/_/-)".to_string());
    }
    let _guard = get_db_lock()
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;
    let path = resolve_archive_path(&app, &archive_id)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
    }
    let _file_lock = acquire_db_write_lock(&path)
        .map_err(|e| format!("Archive DB dosya kilidi alınamadı: {}", e))?;
    write_and_sync(&path, &data).map_err(|e| format!("Archive DB yazılamadı: {}", e))
}

/// Verilen bir hedef yolun güvenli bir konuma düştüğünü doğrular.
/// İzin verilen kökler: AppDataDir, Documents, Desktop, Downloads, kullanıcı ev dizini.
fn validate_archive_target_path(app: &tauri::AppHandle, target: &std::path::Path) -> Result<(), String> {
    // Literal path traversal kontrolü
    let target_str = target.to_string_lossy();
    if target_str.contains("..") {
        return Err("Yol geçişi reddedildi: '..' içeremez".to_string());
    }

    // Parent'ı kanonikleştir (dosya henüz yoksa parent üzerinden)
    let parent = target
        .parent()
        .ok_or_else(|| "Hedef yolun parent dizini yok".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Hedef dizin oluşturulamadı: {}", e))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| format!("Parent dizin doğrulanamadı: {}", e))?;

    // İzin verilen köklerin kanonikleştirilmiş listesi
    let mut allowed_roots: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(d) = app.path().app_data_dir() { if let Ok(c) = d.canonicalize() { allowed_roots.push(c); } }
    if let Ok(d) = app.path().app_local_data_dir() { if let Ok(c) = d.canonicalize() { allowed_roots.push(c); } }
    if let Ok(d) = app.path().document_dir() { if let Ok(c) = d.canonicalize() { allowed_roots.push(c); } }
    if let Ok(d) = app.path().desktop_dir() { if let Ok(c) = d.canonicalize() { allowed_roots.push(c); } }
    if let Ok(d) = app.path().download_dir() { if let Ok(c) = d.canonicalize() { allowed_roots.push(c); } }
    if let Ok(d) = app.path().home_dir() { if let Ok(c) = d.canonicalize() { allowed_roots.push(c); } }

    if allowed_roots.is_empty() {
        return Err("İzin verilen kök dizinlerin hiçbiri çözümlenemedi".to_string());
    }
    let allowed = allowed_roots.iter().any(|root| canonical_parent.starts_with(root));
    if !allowed {
        return Err(format!(
            "Arşiv hedef yolu izin verilen dizinlerin dışında: {}",
            canonical_parent.to_string_lossy()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn create_archive_file(
    app: tauri::AppHandle,
    archive_id: String,
    db_path: String,
    name: String,
    archive_type: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_admin(&role_state)?;

    // archive_id sanitize: sadece alfanümerik + _ + -
    if archive_id.is_empty()
        || !archive_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("Geçersiz archive_id (sadece harf/rakam/_/-)".to_string());
    }
    // archive_type doğrulama
    if archive_type != "shared" && archive_type != "personal" {
        return Err(format!("Geçersiz archive_type: {}", archive_type));
    }

    let target = if db_path.is_empty() {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("AppDataDir alınamadı: {}", e))?;
        dir.join(format!("archive_{}.db", archive_id))
    } else {
        // K-2: db_path'in izin verilen kökler içinde olduğunu doğrula
        if db_path.contains("..") {
            return Err("Yol geçişi (path traversal) reddedildi: '..' içeremez".to_string());
        }
        let candidate = normalize_db_target_with_name(&db_path, &format!("archive_{}.db", archive_id));
        validate_archive_target_path(&app, &candidate)?;
        candidate
    };

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
    }

    let mut cfg = load_config(&app).unwrap_or_else(|| {
        let default_path = get_default_db_path(&app)
            .unwrap_or_else(|_| PathBuf::from("archivist.db"));
        ArchivistConfig {
            db_path: default_path.to_string_lossy().to_string(),
            local_db_path: None,
            extra_archives: vec![],
            lan_auth_code: None,
        }
    });
    cfg.extra_archives.push(ExtraArchiveConfig {
        id: archive_id,
        name,
        db_path: target.to_string_lossy().to_string(),
        archive_type,
    });

    let cfg_bytes = serde_json::to_vec_pretty(&cfg)
        .map_err(|e| format!("Config serileştirilemedi: {}", e))?;
    let cfg_path = get_config_path(&app)?;
    write_and_sync(&cfg_path, &cfg_bytes).map_err(|e| format!("Config yazılamadı: {}", e))
}

#[tauri::command]
pub async fn delete_archive_file(
    app: tauri::AppHandle,
    archive_id: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_admin(&role_state)?;

    let path = resolve_archive_path(&app, &archive_id)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Arşiv silinemedi: {}", e))?;
    }

    if let Some(mut cfg) = load_config(&app) {
        cfg.extra_archives.retain(|a| a.id != archive_id);
        let cfg_bytes = serde_json::to_vec_pretty(&cfg)
            .map_err(|e| format!("Config serileştirilemedi: {}", e))?;
        let cfg_path = get_config_path(&app)?;
        write_and_sync(&cfg_path, &cfg_bytes).map_err(|e| format!("Config yazılamadı: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_archive_info(
    app: tauri::AppHandle,
    archive_id: String,
) -> Result<(String, u64), String> {
    let path = resolve_archive_path(&app, &archive_id)?;
    let path_str = path.to_string_lossy().to_string();
    let size = if path.exists() {
        std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };
    Ok((path_str, size))
}

#[tauri::command]
pub async fn list_extra_archives(app: tauri::AppHandle) -> Result<Vec<ExtraArchiveConfig>, String> {
    let cfg = load_config(&app).unwrap_or_else(|| ArchivistConfig {
        db_path: String::new(),
        local_db_path: None,
        extra_archives: vec![],
        lan_auth_code: None,
    });
    Ok(cfg.extra_archives)
}

const RECOVERY_KEY_FILE: &str = "recovery.key";

/// Mevcut kurtarma anahtarını okur. Dosya yoksa None döner.
/// Login gerektirmez: ForgotPassword akışında kullanılır (henüz oturum yok).
/// Güvenlik notu: anahtar dosyası yalnızca aynı makineye fiziksel/ayrıcalıklı
/// erişimi olan bir saldırganın elde edebileceği AppData içindedir.
#[tauri::command]
pub async fn read_recovery_key(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?;
    let path = dir.join(RECOVERY_KEY_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("recovery.key okunamadı: {}", e))?;
    Ok(Some(content.trim().to_string()))
}

/// Kurtarma anahtarını AppData dizinine yazar.
/// Yalnızca dosya henüz yoksa yazar — tek-sefer yazma, yetkisiz rotasyona karşı koruma.
/// Login gerektirmez: ilk bootstrap sırasında çağrılır (henüz oturum yok).
#[tauri::command]
pub async fn write_recovery_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
    let path = dir.join(RECOVERY_KEY_FILE);
    // Anahtar zaten varsa üzerine yazmayı reddet — yetkisiz rotasyona karşı koruma.
    if path.exists() {
        return Err("Kurtarma anahtarı zaten var; üzerine yazılamaz".to_string());
    }
    // Ek sağlamlık: yeni anahtar formatı doğrulaması (hex, 32-128 karakter)
    let trimmed = key.trim();
    if trimmed.len() < 32 || trimmed.len() > 128 {
        return Err("Kurtarma anahtarı uzunluğu geçersiz".to_string());
    }
    if !trimmed.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Kurtarma anahtarı yalnızca hex karakterleri içermelidir".to_string());
    }
    write_and_sync(&path, trimmed.as_bytes())
        .map_err(|e| format!("recovery.key yazılamadı: {}", e))
}

// ── Snapshot Yönetimi ──

#[derive(Serialize)]
pub struct SnapshotInfo {
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
}

/// Arşiv tipine göre backup dizinini döndürür.
/// "main" → backups/, "local" → backups-local/
fn get_backup_dir_for_archive(app: &tauri::AppHandle, archive_type: &str) -> Result<PathBuf, String> {
    let subdir = match archive_type {
        "local" => "backups-local",
        _ => "backups",
    };
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("AppDataDir alınamadı: {}", e))?
        .join(subdir);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Backup dizini oluşturulamadı: {}", e))?;
    Ok(dir)
}

/// Dosya adı sanitizasyonu: `..`, `/`, `\` içeriyorsa reddeder.
fn sanitize_snapshot_name(name: &str) -> Result<(), String> {
    if name.contains("..") || name.contains('/') || name.contains('\\') {
        return Err("Geçersiz dosya adı".to_string());
    }
    Ok(())
}

/// Mevcut veritabanının snapshot'ını oluşturur. Dosya boyutunu döndürür.
/// archive_type: "main" (varsayılan) veya "local"
#[tauri::command]
pub async fn create_db_snapshot(
    app: tauri::AppHandle,
    file_name: String,
    archive_type: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<u64, String> {
    let at = archive_type.as_deref().unwrap_or("main");
    if at == "local" {
        crate::require_authenticated(&role_state)?;
    } else {
        crate::require_admin(&role_state)?;
    }
    sanitize_snapshot_name(&file_name)?;

    let db_path = if at == "local" {
        resolve_local_db_path(&app)?
    } else {
        resolve_db_path(&app)?
    };
    if !db_path.exists() {
        return Err("Veritabanı dosyası bulunamadı".to_string());
    }

    let db_bytes = std::fs::read(&db_path)
        .map_err(|e| format!("DB okunamadı: {}", e))?;
    let file_size = db_bytes.len() as u64;

    let backup_dir = get_backup_dir_for_archive(&app, at)?;
    let dest = backup_dir.join(&file_name);

    write_and_sync(&dest, &db_bytes)
        .map_err(|e| format!("Snapshot yazılamadı: {}", e))?;

    Ok(file_size)
}

/// Mevcut snapshot listesini döndürür (en yeni ilk sırada).
#[tauri::command]
pub async fn list_db_snapshots(
    app: tauri::AppHandle,
    archive_type: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<Vec<SnapshotInfo>, String> {
    crate::require_authenticated(&role_state)?;

    let at = archive_type.as_deref().unwrap_or("main");
    let backup_dir = get_backup_dir_for_archive(&app, at)?;
    let mut snapshots: Vec<SnapshotInfo> = Vec::new();

    let entries = std::fs::read_dir(&backup_dir)
        .map_err(|e| format!("Backup dizini okunamadı: {}", e))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.starts_with("snapshot-") || !name.ends_with(".db") {
            continue;
        }
        let meta = entry.metadata().ok();
        let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
        let created_at = meta
            .and_then(|m| m.created().ok())
            .and_then(|t| {
                let secs = t.duration_since(std::time::UNIX_EPOCH).ok()?.as_secs() as i64;
                chrono::DateTime::from_timestamp(secs, 0).map(|dt| dt.to_rfc3339())
            })
            .unwrap_or_default();

        snapshots.push(SnapshotInfo {
            file_name: name,
            created_at,
            file_size,
        });
    }

    // En yeni ilk sırada (dosya adı tarih içeriyor, reverse sort yeterli)
    snapshots.sort_by(|a, b| b.file_name.cmp(&a.file_name));

    Ok(snapshots)
}

/// Belirli bir snapshot'tan veritabanını geri yükler.
#[tauri::command]
pub async fn restore_db_snapshot(
    app: tauri::AppHandle,
    file_name: String,
    archive_type: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<bool, String> {
    let at = archive_type.as_deref().unwrap_or("main");
    if at == "local" {
        crate::require_authenticated(&role_state)?;
    } else {
        crate::require_admin(&role_state)?;
    }
    sanitize_snapshot_name(&file_name)?;

    let backup_dir = get_backup_dir_for_archive(&app, at)?;
    let snapshot_path = backup_dir.join(&file_name);

    if !snapshot_path.exists() {
        return Err("Snapshot bulunamadı".to_string());
    }

    let snapshot_bytes = std::fs::read(&snapshot_path)
        .map_err(|e| format!("Snapshot okunamadı: {}", e))?;

    let _guard = get_db_lock()
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;

    let db_path = if at == "local" {
        resolve_local_db_path(&app)?
    } else {
        resolve_db_path(&app)?
    };
    write_and_sync(&db_path, &snapshot_bytes)
        .map_err(|e| format!("DB geri yüklenemedi: {}", e))?;

    Ok(true)
}

/// Belirli bir snapshot'ı siler.
#[tauri::command]
pub async fn delete_db_snapshot(
    app: tauri::AppHandle,
    file_name: String,
    archive_type: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<bool, String> {
    let at = archive_type.as_deref().unwrap_or("main");
    if at == "local" {
        crate::require_authenticated(&role_state)?;
    } else {
        crate::require_admin(&role_state)?;
    }
    sanitize_snapshot_name(&file_name)?;

    let backup_dir = get_backup_dir_for_archive(&app, at)?;
    let snapshot_path = backup_dir.join(&file_name);

    if !snapshot_path.exists() {
        return Ok(false);
    }

    std::fs::remove_file(&snapshot_path)
        .map_err(|e| format!("Snapshot silinemedi: {}", e))?;

    Ok(true)
}

/// Tek bir app_settings satırını ana DB dosyasına yazar — tüm DB'yi export etmeden.
///
/// sql.js'in `db.export()` çağrısı büyük DB'lerde 100-500ms+ ana thread'i bloklar.
/// Bu komut rusqlite ile direkt UPDATE yapar (~1ms), UI tıkanmaz.
/// Frontend ayrıca sql.js belleğini de güncellemeli (UI tutarlılığı için).
#[tauri::command]
pub async fn update_app_setting(
    app: tauri::AppHandle,
    key: String,
    value: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _guard = get_db_lock()
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("rusqlite açma hatası: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = OFF;")
            .map_err(|e| format!("PRAGMA hatası: {}", e))?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)",
            [],
        )
        .map_err(|e| format!("Tablo oluşturma hatası: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .map_err(|e| format!("UPDATE hatası: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Async runtime hatası: {}", e))?
}

/// Kullanıcı satırını rusqlite ile doğrudan diske yazar (INSERT OR REPLACE).
/// SQL.js export yolunun başarısız olduğu durumlarda güvenilir kalıcılık sağlar.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn db_upsert_user(
    app: tauri::AppHandle,
    id: i64,
    username: String,
    password_hash: String,
    display_name: Option<String>,
    role: String,
    avatar: Option<String>,
    is_blocked: bool,
    is_developer: bool,
    is_founder: bool,
    created_at: String,
    updated_at: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _guard = get_db_lock()
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("rusqlite açma hatası: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = OFF;")
            .map_err(|e| format!("PRAGMA hatası: {}", e))?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                display_name TEXT,
                role TEXT NOT NULL DEFAULT 'viewer',
                avatar TEXT,
                is_blocked INTEGER NOT NULL DEFAULT 0,
                is_developer INTEGER NOT NULL DEFAULT 0,
                is_founder INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        ).map_err(|e| format!("Tablo oluşturma hatası: {}", e))?;
        conn.execute(
            "INSERT OR REPLACE INTO users
             (id, username, password_hash, display_name, role, avatar,
              is_blocked, is_developer, is_founder, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                id, username, password_hash, display_name, role, avatar,
                is_blocked as i64, is_developer as i64, is_founder as i64,
                created_at, updated_at
            ],
        ).map_err(|e| format!("Kullanıcı yazma hatası: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Async runtime hatası: {}", e))?
}

/// Kullanıcı satırını rusqlite ile doğrudan diskten siler.
#[tauri::command]
pub async fn db_delete_user_row(
    app: tauri::AppHandle,
    id: i64,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;
    let db_path = resolve_db_path(&app)?;

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let _guard = get_db_lock()
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

        let conn = rusqlite::Connection::open(&db_path)
            .map_err(|e| format!("rusqlite açma hatası: {}", e))?;
        conn.execute_batch("PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = OFF;")
            .map_err(|e| format!("PRAGMA hatası: {}", e))?;
        conn.execute("DELETE FROM users WHERE id = ?1", rusqlite::params![id])
            .map_err(|e| format!("Kullanıcı silme hatası: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| format!("Async runtime hatası: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_write_and_sync_creates_and_persists_file() {
        let dir = std::env::temp_dir().join("archivistpro_sync_test");
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("test_sync.db");

        let data = b"hello fsync";
        write_and_sync(&file_path, data).expect("write_and_sync should succeed");

        let read_back = std::fs::read(&file_path).expect("file should be readable");
        assert_eq!(read_back, data);

        // Temp dosya kalmamalı
        assert!(!file_path.with_extension("db.tmp").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_write_and_sync_overwrites_existing() {
        let dir = std::env::temp_dir().join("archivistpro_sync_test2");
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("overwrite.db");

        write_and_sync(&file_path, b"first").unwrap();
        write_and_sync(&file_path, b"second").unwrap();

        let read_back = std::fs::read(&file_path).unwrap();
        assert_eq!(read_back, b"second");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_write_and_sync_fails_on_invalid_path() {
        let bad_path = std::path::Path::new("/nonexistent_root_abc123/file.db");
        let result = write_and_sync(bad_path, b"data");
        assert!(result.is_err());
    }

    #[test]
    fn test_write_and_sync_atomic_no_corruption() {
        // Orijinal dosya, yazma sırasında bozulmamalı
        let dir = std::env::temp_dir().join("archivistpro_atomic_test");
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("atomic.db");

        let original = b"original data";
        write_and_sync(&file_path, original).unwrap();

        // İkinci yazma başarılı olmalı ve orijinali değiştirmeli
        let updated = b"updated data";
        write_and_sync(&file_path, updated).unwrap();
        assert_eq!(std::fs::read(&file_path).unwrap(), updated);

        // Temp dosya kalmamalı
        assert!(!file_path.with_extension("db.tmp").exists());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_acquire_db_write_lock() {
        let dir = std::env::temp_dir().join("archivistpro_lock_test");
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("locktest.db");

        // Yazma kilidi alınabilmeli
        let lock = acquire_db_write_lock(&db_path);
        assert!(lock.is_ok());

        // Lock dosyası oluşmuş olmalı
        assert!(db_path.with_extension("db.lock").exists());

        // Lock'u bırak
        drop(lock);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn test_read_lock_when_no_write_lock() {
        let dir = std::env::temp_dir().join("archivistpro_readlock_test");
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("readlocktest.db");

        // Yazma kilidi yokken okuma kilidi alınabilmeli
        let read_lock = try_acquire_db_read_lock(&db_path);
        assert!(read_lock.is_some());

        drop(read_lock);
        std::fs::remove_dir_all(&dir).ok();
    }
}
