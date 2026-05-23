//! Ollama HTTP proxy ve uygulama veri dizini SQLite okuma/yazma.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
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

/// Arşiv (DB dosyası) başına in-process yazma kilidi registry'si.
///
/// Eski tasarımda tek global `Mutex<()>` TÜM arşivlerin yazmalarını
/// serileştiriyordu (main + local + ek arşivler birbirini bekliyordu).
/// Artık kilit **kanonik yol** anahtarlı: farklı arşivler paralel yazar,
/// aynı dosyaya farklı string ile erişen iki çağrı AYNI Mutex'e düşer.
///
/// Anahtar üretimi `canonical_lock_key` ile yapılır (var olmayan dosyada
/// `canonicalize(parent)/file_name`) — aksi halde aynı dosya iki ayrı
/// string → iki Mutex → veri yarışı olurdu.
///
/// Registry mutex'i YALNIZCA lookup/insert için kısa süre tutulur; dönen
/// `Arc<Mutex<()>>` çağırana verilir ve I/O bu Arc'ın guard'ı altında,
/// registry mutex'i serbestken yapılır.
static DB_WRITE_LOCKS: std::sync::OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    std::sync::OnceLock::new();

fn db_write_locks() -> &'static Mutex<HashMap<PathBuf, Arc<Mutex<()>>>> {
    DB_WRITE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Lock registry anahtarı: var olan dosyada `canonicalize`, yoksa
/// `canonicalize(parent)/file_name`. Hiçbiri olmuyorsa path'in kendisi
/// (en kötü durumda eski global-mutex davranışından kötü değil — yine
/// deterministik biçimde serileşir). `set_database_path` ile aynı desen.
fn canonical_lock_key(path: &std::path::Path) -> PathBuf {
    if let Ok(c) = path.canonicalize() {
        return c;
    }
    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if let Ok(cp) = parent.canonicalize() {
            return cp.join(name);
        }
    }
    path.to_path_buf()
}

/// Verilen DB yolu için kanonik-anahtarlı in-process yazma kilidini döndürür.
///
/// Çağrı deseni — Arc, MutexGuard'dan ÖNCE bağlanmalı (guard, Arc'tan
/// daha uzun yaşamamalı):
/// ```ignore
/// let archive_lock = get_db_lock_for(&db_path);
/// let _guard = archive_lock.lock().map_err(|e| format!("DB kilit hatası: {}", e))?;
/// ```
pub(crate) fn get_db_lock_for(path: &std::path::Path) -> Arc<Mutex<()>> {
    let key = canonical_lock_key(path);
    // Poison'a dayanıklı: registry yalnızca lookup/insert için tutulur;
    // burada panik olası değil, olsa bile tüm DB yazmalarını bricklemeyelim.
    let mut map = db_write_locks()
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    map.entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

// ── Sprint-3 / V3-3 Aşama 2: ortak yazma-bağlantısı + journal modu ──────────
//
// Tasarım: DE-RISK §3 (kademeli geçiş Aşama 2). Eskiden 14 yerde tekrarlanan
// `Connection::open + PRAGMA journal_mode=DELETE; foreign_keys=OFF;` bloğu
// tek kaynağa indirildi. Journal modu `ARCHIVIST_DB_JOURNAL` env ile seçilir.
//
// VARSAYILAN `delete` — DAVRANIŞ DEĞİŞMEZ. WAL yalnız opt-in ve Gate 0 +
// Gate #1 sonrası önerilir; ana DB'de blob-overwrite (sql.js export → rename)
// ile targeted-write çarpışması stale `-wal` yetimi → deterministik bozulma
// riski taşır (DE-RISK §0). Bu yüzden default'a ALINMAZ.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum JournalMode {
    Delete,
    Wal,
}

#[cfg(windows)]
mod drive_api {
    #[link(name = "kernel32")]
    extern "system" {
        pub fn GetDriveTypeW(lp_root_path_name: *const u16) -> u32;
    }
    pub const DRIVE_REMOTE: u32 = 4;
}

/// Ağ/UNC yolu mu? `-shm` paylaşımlı bellek SMB üzerinde çalışmadığından
/// WAL böyle yollarda zorla `delete`'e düşürülür (DE-RISK §3).
#[cfg(windows)]
fn is_network_path(path: &std::path::Path) -> bool {
    let s = path.to_string_lossy();
    // UNC: \\server\share veya \\?\UNC\... ; \\?\C:\ ise lokal (extended-length).
    if s.starts_with(r"\\?\UNC\") {
        return true;
    }
    if s.starts_with(r"\\") && !s.starts_with(r"\\?\") {
        return true;
    }
    // Sürücü harfi → GetDriveTypeW == DRIVE_REMOTE (eşlenmiş ağ sürücüsü).
    if let Some(std::path::Component::Prefix(p)) = path.components().next() {
        let disk = match p.kind() {
            std::path::Prefix::Disk(d) | std::path::Prefix::VerbatimDisk(d) => Some(d),
            _ => None,
        };
        if let Some(d) = disk {
            let root: Vec<u16> = format!("{}:\\", d as char)
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect();
            // SAFETY: `root` NUL-sonlandırılmış geçerli UTF-16; GetDriveTypeW
            // yalnız okur, yan etkisi yok.
            let t = unsafe { drive_api::GetDriveTypeW(root.as_ptr()) };
            return t == drive_api::DRIVE_REMOTE;
        }
    }
    false
}

#[cfg(not(windows))]
fn is_network_path(_path: &std::path::Path) -> bool {
    false
}

/// `ARCHIVIST_DB_JOURNAL` bir kez okunur (process ömrü boyunca sabit).
///
/// 2026-05-20 default'u **`wal`** olarak çevrildi (Sprint-3 Aşama 2 kapanışı:
/// Gate #1 ✅ + 2-process duman testi ✅). Geri-uyumluluk için açık opt-out
/// `ARCHIVIST_DB_JOURNAL=delete` ile davranış v2.4.10 öncesine döner.
/// Ağ/UNC yolları her durumda `delete`'e düşer (`resolve_journal_mode`).
fn wal_requested() -> bool {
    static FLAG: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *FLAG.get_or_init(|| {
        std::env::var("ARCHIVIST_DB_JOURNAL")
            // Yalnız açık `delete` opt-out kapatır; aksi (yokluk dahil) WAL.
            .map(|v| !v.trim().eq_ignore_ascii_case("delete"))
            .unwrap_or(true)
    })
}

/// Bu DB yolu için etkin journal modu.
///
/// 2026-05-20 itibariyle default WAL'dir (`wal_requested()` default-true).
/// Ağ/UNC yolu (`is_network_path`) → her durumda DELETE (WAL paylaşımlı
/// dosya sistemlerinde güvenli değil; SQLite resmî öneri).
/// Açık opt-out `ARCHIVIST_DB_JOURNAL=delete` → DELETE.
fn resolve_journal_mode(path: &std::path::Path) -> JournalMode {
    if wal_requested() && !is_network_path(path) {
        JournalMode::Wal
    } else {
        JournalMode::Delete
    }
}

/// Ana-DB rusqlite **yazma** bağlantısı için ortak hazırlık (tek kaynak).
///
/// - `journal_mode`: `resolve_journal_mode` (2026-05-20 itibariyle default **WAL**;
///   ağ/UNC ve `ARCHIVIST_DB_JOURNAL=delete` opt-out → DELETE).
/// - `synchronous = FULL`: power-loss dayanıklılığı (DE-RISK §3 "FULL başla";
///   DELETE'te SQLite varsayılanı, WAL'de açıkça istenir).
/// - `foreign_keys = OFF`: mevcut davranış (sql.js şeması FK'siz taşınıyor).
/// - `busy_timeout = 5000`: 2-process/çok-instance dayanıklılığı (DE-RISK §3).
pub(crate) fn prepare_write_conn(
    path: &std::path::Path,
) -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open(path)
        .map_err(|e| format!("rusqlite açma hatası: {}", e))?;
    let jm = match resolve_journal_mode(path) {
        JournalMode::Wal => "WAL",
        JournalMode::Delete => "DELETE",
    };
    conn.execute_batch(&format!(
        "PRAGMA journal_mode = {jm}; PRAGMA synchronous = FULL; \
         PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;"
    ))
    .map_err(|e| format!("PRAGMA hatası: {}", e))?;
    Ok(conn)
}

/// SQLite WAL yan-dosya yolları: `foo.db` → `foo.db-wal` / `foo.db-shm`
/// (uzantı DEĞİŞTİRMEZ, sonek EKLER — `with_extension` yanlış olurdu).
fn wal_sidecar_paths(path: &std::path::Path) -> (PathBuf, PathBuf) {
    let mut wal = path.as_os_str().to_os_string();
    wal.push("-wal");
    let mut shm = path.as_os_str().to_os_string();
    shm.push("-shm");
    (PathBuf::from(wal), PathBuf::from(shm))
}

/// Blob-overwrite (sql.js export → rename) SONRASI stale `-wal`/`-shm`
/// yetimlerini siler. Aksi halde bir sonraki açılışta stale WAL, yeni ve
/// tam `.db`'ye replay edilir → **deterministik sessiz veri bozulması**
/// (DE-RISK §0, sqlite.org/howtocorrupt). Gate 0 güvenlik ağı.
fn remove_wal_sidecars(path: &std::path::Path) -> std::io::Result<()> {
    let (wal, shm) = wal_sidecar_paths(path);
    for p in [wal, shm] {
        match std::fs::remove_file(&p) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}

/// Backup/export ÖNCESİ: WAL'de duran commit'li veriyi ana `.db`'ye katla
/// (TRUNCATE → `-wal` boşaltılır). Best-effort: WAL değilse / dosya yoksa
/// no-op. DELETE modunda zaten `-wal` üretilmediği için etkisizdir.
pub(crate) fn checkpoint_wal_truncate(path: &std::path::Path) {
    if !path.exists() {
        return;
    }
    let (wal, _shm) = wal_sidecar_paths(path);
    if !wal.exists() {
        return; // WAL yan-dosyası yok → checkpoint gereksiz
    }
    if let Ok(conn) = rusqlite::Connection::open(path) {
        let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
        let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    }
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

    // 4. Gate 0: blob-overwrite tam yeni bir dosya koydu — önceki targeted
    //    WAL yazmasından kalan stale `-wal`/`-shm` artık bu dosyaya AİT
    //    DEĞİL; replay edilirse deterministik bozulma. Yetimleri sil.
    remove_wal_sidecars(path)?;

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

/// SQLite magic header'ı: "SQLite format 3\0" (ilk 16 bayt).
pub(crate) const SQLITE_MAGIC: &[u8] = b"SQLite format 3\x00";

/// Bayt dizisinin geçerli bir SQLite dosyası başlığı taşıyıp taşımadığı — saf, test edilebilir.
pub(crate) fn has_sqlite_magic(bytes: &[u8]) -> bool {
    bytes.len() >= 16 && &bytes[..16] == SQLITE_MAGIC
}

/// `read_database`'in saf çekirdeği — AppHandle gerektirmez, doğrudan path alır.
/// Bozuk dosyayı `.corrupt.bak`'a taşıyan yan etkiyi de uygular (komutla aynı semantik).
pub(crate) fn read_db_at(path: &std::path::Path) -> Result<DbReadResult, String> {
    if !path.exists() {
        return Ok(DbReadResult { bytes: vec![], corrupted: false, locked_by_other: false });
    }

    // Başka bir process yazma kilidi tutuyorsa uyar
    let locked_by_other = try_acquire_db_read_lock(path).is_none();

    let bytes = std::fs::read(path).map_err(|e| format!("DB okunamadı: {}", e))?;

    if !has_sqlite_magic(&bytes) {
        // Bozuk dosyayı yedekle, corrupted=true ile boş döndür
        let backup = path.with_extension("corrupt.bak");
        let _ = std::fs::rename(path, &backup);
        return Ok(DbReadResult { bytes: vec![], corrupted: true, locked_by_other: false });
    }

    Ok(DbReadResult { bytes, corrupted: false, locked_by_other })
}

#[tauri::command]
pub async fn read_database(app: tauri::AppHandle) -> Result<DbReadResult, String> {
    let path = resolve_db_path(&app)?;
    read_db_at(&path)
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

    if read_count < 16 || !has_sqlite_magic(&header) {
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
    let path = resolve_db_path(&app)?;
    let archive_lock = get_db_lock_for(&path);
    let _guard = archive_lock
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;
    write_db_at(&path, &data)
}

/// `write_database`'in saf çekirdeği — AppHandle/auth/global-mutex gerektirmez.
/// Dizin oluşturma + inter-process dosya kilidi + atomik yaz. Test edilebilir.
/// NOT: process-içi `get_db_lock_for(path)` serileştirmesi ÇAĞIRANIN
/// sorumluluğundadır (komut bunu tutar); burada yalnızca dosyalar-arası
/// kilit alınır.
pub(crate) fn write_db_at(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Dizin oluşturulamadı: {}", e))?;
    }
    // Inter-process file lock — başka instance yazmasını engeller
    let _file_lock = acquire_db_write_lock(path)
        .map_err(|e| format!("DB dosya kilidi alınamadı (başka instance açık olabilir): {}", e))?;
    write_and_sync(path, data).map_err(|e| format!("DB yazılamadı: {}", e))
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

/// Binary IPC varyantı — `read_local_database`'in JSON serialize ettiği Vec<u8>
/// büyük DB'lerde V8 motorunu çakıyor (Empty MaybeLocal). Bu komut raw bytes
/// gönderir, frontend ArrayBuffer olarak alır.
#[tauri::command]
pub async fn read_local_database_binary(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = resolve_local_db_path(&app)?;
    if !path.exists() {
        return Ok(tauri::ipc::Response::new(Vec::<u8>::new()));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Local DB okunamadı: {}", e))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn write_local_database(
    app: tauri::AppHandle,
    data: Vec<u8>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;
    let path = resolve_local_db_path(&app)?;
    let archive_lock = get_db_lock_for(&path);
    let _guard = archive_lock
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;
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

/// Binary IPC varyantı — `read_archive`'in JSON Vec<u8> serializasyonu büyük
/// DB'lerde V8'i çakıyor (Empty MaybeLocal). Bu komut raw bytes gönderir.
#[tauri::command]
pub async fn read_archive_binary(app: tauri::AppHandle, archive_id: String) -> Result<tauri::ipc::Response, String> {
    let path = resolve_archive_path(&app, &archive_id)?;
    if !path.exists() {
        return Ok(tauri::ipc::Response::new(Vec::<u8>::new()));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Archive DB okunamadı: {}", e))?;
    Ok(tauri::ipc::Response::new(bytes))
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
    let path = resolve_archive_path(&app, &archive_id)?;
    let archive_lock = get_db_lock_for(&path);
    let _guard = archive_lock
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;
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

    // WAL'de duran commit'li veriyi ana dosyaya katla — aksi halde ham
    // okuma eksik snapshot üretir (DELETE modunda no-op).
    checkpoint_wal_truncate(&db_path);
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

    let db_path = if at == "local" {
        resolve_local_db_path(&app)?
    } else {
        resolve_db_path(&app)?
    };
    let archive_lock = get_db_lock_for(&db_path);
    let _guard = archive_lock
        .lock()
        .map_err(|e| format!("DB kilit hatası: {}", e))?;
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
        let archive_lock = get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

        let conn = prepare_write_conn(&db_path)?;
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
        let archive_lock = get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

        let conn = prepare_write_conn(&db_path)?;
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
        let archive_lock = get_db_lock_for(&db_path);
        let _guard = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let _file_lock = acquire_db_write_lock(&db_path)
            .map_err(|e| format!("DB dosya kilidi alınamadı: {}", e))?;

        let conn = prepare_write_conn(&db_path)?;
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
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("test_sync.db");

        let data = b"hello fsync";
        write_and_sync(&file_path, data).expect("write_and_sync should succeed");

        let read_back = std::fs::read(&file_path).expect("file should be readable");
        assert_eq!(read_back, data);

        // Temp dosya kalmamalı
        assert!(!file_path.with_extension("db.tmp").exists());
    }

    #[test]
    fn test_write_and_sync_overwrites_existing() {
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("overwrite.db");

        write_and_sync(&file_path, b"first").unwrap();
        write_and_sync(&file_path, b"second").unwrap();

        let read_back = std::fs::read(&file_path).unwrap();
        assert_eq!(read_back, b"second");
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
        let tmp = tempfile::tempdir().unwrap();
        let file_path = tmp.path().join("atomic.db");

        let original = b"original data";
        write_and_sync(&file_path, original).unwrap();

        // İkinci yazma başarılı olmalı ve orijinali değiştirmeli
        let updated = b"updated data";
        write_and_sync(&file_path, updated).unwrap();
        assert_eq!(std::fs::read(&file_path).unwrap(), updated);

        // Temp dosya kalmamalı
        assert!(!file_path.with_extension("db.tmp").exists());
    }

    #[test]
    fn test_acquire_db_write_lock() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("locktest.db");

        // Yazma kilidi alınabilmeli
        let lock = acquire_db_write_lock(&db_path);
        assert!(lock.is_ok());

        // Lock dosyası oluşmuş olmalı
        assert!(db_path.with_extension("db.lock").exists());

        // Lock'u bırak
        drop(lock);
    }

    // ── Sprint-3 / V3-3 Aşama 1: per-arşiv (canonical-path) yazma kilidi ──

    #[test]
    fn test_db_lock_same_path_returns_same_arc() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("a.db");
        std::fs::write(&db_path, b"x").unwrap();

        let l1 = get_db_lock_for(&db_path);
        let l2 = get_db_lock_for(&db_path);
        // Aynı dosya → aynı Mutex instance (Arc clone) olmalı.
        assert!(Arc::ptr_eq(&l1, &l2));
    }

    #[test]
    fn test_db_lock_canonical_collation_distinct_strings_same_file() {
        // Aynı dosyaya iki FARKLI string ile erişim AYNI kilide düşmeli;
        // aksi halde iki Mutex → veri yarışı (DE-RISK §3 kanonik-anahtar).
        let tmp = tempfile::tempdir().unwrap();
        let sub = tmp.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let db_path = sub.join("arch.db");
        std::fs::write(&db_path, b"x").unwrap();

        // İkinci string: ".../sub/../sub/arch.db" — farklı string, aynı dosya.
        let weird = sub.join("..").join("sub").join("arch.db");

        let l1 = get_db_lock_for(&db_path);
        let l2 = get_db_lock_for(&weird);
        assert!(
            Arc::ptr_eq(&l1, &l2),
            "kanonikleştirme sonrası aynı dosya tek Mutex'e düşmeli"
        );
    }

    #[test]
    fn test_db_lock_different_archives_distinct_arcs() {
        // Farklı arşivler (farklı dosya) → ayrı Mutex → paralel yazabilmeli
        // (eski tek-global-mutex darboğazının kaldırıldığının kanıtı).
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("main.db");
        let local = tmp.path().join("local.db");
        std::fs::write(&main, b"m").unwrap();
        std::fs::write(&local, b"l").unwrap();

        let lm = get_db_lock_for(&main);
        let ll = get_db_lock_for(&local);
        assert!(!Arc::ptr_eq(&lm, &ll));

        // main kilidi tutulurken local kilidi BLOKLANMADAN alınabilmeli.
        let _gm = lm.lock().unwrap();
        let gl = ll.try_lock();
        assert!(
            gl.is_ok(),
            "farklı arşiv kilidi, başka arşiv kilitliyken alınabilmeli"
        );
    }

    #[test]
    fn test_db_lock_nonexistent_file_stable_key() {
        // Henüz var olmayan DB (ilk yazma öncesi) — canonicalize başarısız
        // olsa bile parent+filename ile kararlı/aynı anahtar üretilmeli.
        let tmp = tempfile::tempdir().unwrap();
        let not_yet = tmp.path().join("brand-new.db");
        assert!(!not_yet.exists());

        let l1 = get_db_lock_for(&not_yet);
        let l2 = get_db_lock_for(&not_yet);
        assert!(Arc::ptr_eq(&l1, &l2));
    }

    // ── Sprint-3 / V3-3 Aşama 2: journal modu + Gate 0 güvenlik ağı ─────────

    #[test]
    fn test_wal_sidecar_paths_suffix_not_extension() {
        // `foo.db` → `foo.db-wal` / `foo.db-shm` (sonek; `foo.wal` DEĞİL).
        let p = std::path::Path::new("/tmp/archivist.db");
        let (wal, shm) = wal_sidecar_paths(p);
        assert_eq!(wal, std::path::Path::new("/tmp/archivist.db-wal"));
        assert_eq!(shm, std::path::Path::new("/tmp/archivist.db-shm"));
    }

    #[cfg(windows)]
    #[test]
    fn test_is_network_path_unc_detection() {
        // Literal UNC formları:
        assert!(is_network_path(std::path::Path::new(r"\\server\share\db.sqlite")));
        assert!(is_network_path(std::path::Path::new(r"\\?\UNC\server\share\db")));
        // Loopback UNC (kendi makineye paylaşımla erişim — multi-process simulation):
        assert!(is_network_path(std::path::Path::new(r"\\localhost\share\db")));
        assert!(is_network_path(std::path::Path::new(r"\\LOCALHOST\Share\db")));
        // IP literal UNC:
        assert!(is_network_path(std::path::Path::new(r"\\127.0.0.1\share\db")));
        assert!(is_network_path(std::path::Path::new(r"\\192.168.1.10\arsiv\archivist.db")));
        // Extended UNC alt-formları:
        assert!(is_network_path(std::path::Path::new(r"\\?\UNC\localhost\share\db")));
        assert!(is_network_path(std::path::Path::new(r"\\.\UNC\server\share\db")));
        // Extended-length lokal yol ağ DEĞİL:
        assert!(!is_network_path(std::path::Path::new(r"\\?\C:\data\db")));
        // Saf lokal yol:
        assert!(!is_network_path(std::path::Path::new(r"C:\test_arsiv_DB\archivist.db")));
        // EDGE CASE NOT: NTFS junction veya symbolic link → bu fonksiyon path
        // STRING'ini inceler, hedefi dereference ETMEZ. Lokal görünen `C:\link`
        // aslında `\\server\share\...`'a junction ise WAL açılabilir. Kullanıcı
        // ağ DB'sini DOĞRUDAN UNC yolla ya da eşlenmiş sürücüyle açmalı.
    }

    #[cfg(windows)]
    #[test]
    fn test_resolve_journal_mode_unc_forces_delete() {
        // `wal_requested()` default-true (2026-05-20 flip); ama UNC yollar her
        // durumda DELETE'e düşmeli. Test env'e dokunmaz — sadece path kararını
        // kontrol eder.
        let local = std::path::Path::new(r"C:\test_arsiv_DB\archivist.db");
        let unc_server = std::path::Path::new(r"\\server\share\archivist.db");
        let unc_local = std::path::Path::new(r"\\localhost\Arsiv\archivist.db");
        let unc_ip = std::path::Path::new(r"\\10.0.0.5\paylasim\db");
        let unc_ext = std::path::Path::new(r"\\?\UNC\server\share\db");
        // Lokal: WAL (bayrak default-true ve ağ değil).
        assert!(matches!(resolve_journal_mode(local), JournalMode::Wal));
        // Tüm UNC varyantları: DELETE (ağ tespiti baskın).
        assert!(matches!(resolve_journal_mode(unc_server), JournalMode::Delete));
        assert!(matches!(resolve_journal_mode(unc_local), JournalMode::Delete));
        assert!(matches!(resolve_journal_mode(unc_ip), JournalMode::Delete));
        assert!(matches!(resolve_journal_mode(unc_ext), JournalMode::Delete));
    }

    #[test]
    fn test_prepare_write_conn_default_is_wal() {
        // 2026-05-20: ARCHIVIST_DB_JOURNAL set değilken default WAL'dir
        // (Gate #1 ✅ + 2-process duman ✅ sonrası flip). Opt-out
        // `ARCHIVIST_DB_JOURNAL=delete` ile davranış v2.4.10 öncesine döner.
        // NOT: `wal_requested()` OnceLock — diğer testler de aynı süreçte
        // koşar; test koşumunda env unset → default WAL beklenir.
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("d.db");
        let conn = prepare_write_conn(&db).unwrap();
        let mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode.to_lowercase(), "wal");
        let bt: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
            .unwrap();
        assert_eq!(bt, 5000);
    }

    #[test]
    fn test_checkpoint_truncate_noop_when_no_wal() {
        // Dosya yok / WAL yan-dosyası yok → panik/yan-etki olmamalı.
        let tmp = tempfile::tempdir().unwrap();
        checkpoint_wal_truncate(&tmp.path().join("yok.db")); // no-op
        let db = tmp.path().join("plain.db");
        let c = rusqlite::Connection::open(&db).unwrap();
        c.execute_batch("CREATE TABLE t(v)").unwrap();
        drop(c);
        checkpoint_wal_truncate(&db); // -wal yok → no-op
        assert!(db.exists());
    }

    /// Üretici: `t(v)` tablosu olan, verilen değeri tutan geçerli (DELETE
    /// journal) SQLite db'sini bayt olarak döndürür — blob-overwrite girdisi.
    #[cfg(test)]
    fn make_db_bytes(dir: &std::path::Path, val: &str) -> Vec<u8> {
        let p = dir.join(format!("seed-{val}.db"));
        let c = rusqlite::Connection::open(&p).unwrap();
        c.execute_batch(&format!(
            "PRAGMA journal_mode=DELETE; CREATE TABLE t(v TEXT); \
             INSERT INTO t VALUES('{val}');"
        ))
        .unwrap();
        drop(c);
        std::fs::read(&p).unwrap()
    }

    /// Orphan senaryosunu kurar: `db` yerinde, yanında OLD frame'leri içeren
    /// GEÇERLİ ve commit'li ama checkpoint'lenmemiş bir `-wal`. (Ana `.db`
    /// OLD'u içermez — tıpkı targeted-writer commit edip checkpoint etmeden
    /// blob-overwrite'a yarıştığı an gibi.)
    #[cfg(test)]
    fn stage_orphan_wal(db: &std::path::Path) {
        use rusqlite::Connection;
        let c = Connection::open(db).unwrap();
        c.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; \
             CREATE TABLE IF NOT EXISTS t(v TEXT); DELETE FROM t; \
             INSERT INTO t VALUES('OLD');",
        )
        .unwrap();
        // conn AÇIKKEN üç dosyayı yakala: -wal şu an OLD frame'lerini içerir,
        // ana .db içermez. (Kapanışta SQLite checkpoint'leyebilir.)
        let (wal, shm) = wal_sidecar_paths(db);
        let snap_db = std::fs::read(db).unwrap();
        let snap_wal = std::fs::read(&wal).unwrap();
        let snap_shm = std::fs::read(&shm).ok();
        assert!(!snap_wal.is_empty(), "-wal boş — orphan senaryosu kurulamadı");
        drop(c);
        // Orphan durumu birebir geri yaz.
        std::fs::write(db, &snap_db).unwrap();
        std::fs::write(&wal, &snap_wal).unwrap();
        if let Some(s) = snap_shm {
            std::fs::write(&shm, &s).unwrap();
        }
    }

    #[test]
    fn test_gate0_stale_wal_vector_is_real() {
        // KANIT: sidecar temizliği OLMADAN (naif WAL), blob-overwrite +
        // stale -wal → açılışta stale WAL replay → veri NEW DEĞİL.
        // Bu test fix'in anlamlı olduğunu gösterir (DE-RISK §0).
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("archivist.db");
        let new_bytes = make_db_bytes(tmp.path(), "NEW");

        stage_orphan_wal(&db);
        // Naif blob-overwrite: temizlik YOK — sadece dosyayı değiştir,
        // -wal/-shm yerinde kalsın (eski hatalı davranışın taklidi).
        std::fs::write(&db, &new_bytes).unwrap();

        let c = rusqlite::Connection::open(&db).unwrap();
        let v: String = c.query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap();
        // Stale -wal replay edildi → 'NEW' yerine 'OLD' (veya bozulma).
        assert_ne!(
            v, "NEW",
            "naif WAL'de stale -wal replay edilmedi → senaryo geçersiz"
        );
    }

    #[test]
    fn test_gate0_blob_overwrite_removes_stale_wal_1000_iter() {
        // GATE 0 REGRESYON: write_and_sync (blob-overwrite) stale -wal/-shm
        // yetimini siler → açılış temiz, integrity ok, veri NEW. 1000 iter.
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("archivist.db");
        let new_bytes = make_db_bytes(tmp.path(), "NEW");
        let (wal, shm) = wal_sidecar_paths(&db);

        for i in 0..1000 {
            stage_orphan_wal(&db);

            // Blob-overwrite (FIX dahili: remove_wal_sidecars).
            write_and_sync(&db, &new_bytes).unwrap();

            assert!(!wal.exists(), "iter {i}: -wal yetim (Gate 0 ihlali)");
            assert!(!shm.exists(), "iter {i}: -shm yetim (Gate 0 ihlali)");

            let c = rusqlite::Connection::open(&db).unwrap();
            let integ: String = c
                .query_row("PRAGMA integrity_check", [], |r| r.get(0))
                .unwrap();
            assert_eq!(integ, "ok", "iter {i}: integrity bozuldu");
            let v: String =
                c.query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap();
            assert_eq!(v, "NEW", "iter {i}: stale WAL replay → veri bozulması");
            drop(c);

            std::fs::remove_file(&db).ok();
        }
    }

    // ── Sprint-3 / V3-3: GERÇEK 2-process WAL duman testi (manuel gate) ─────
    //
    // DE-RISK §3 "Kademeli geçiş Aşama 2": WAL default'a alınmadan ÖNCE bu
    // testin geçmesi şart (Gate #1'den BAĞIMSIZ — gerçek db gerektirmez).
    //
    // Per-arşiv in-process kilit süreçler ARASI iş görmez; süreç-arası
    // serileştirme YALNIZ fs2 dosya kilidi (`acquire_db_write_lock`) +
    // WAL semantiği + Gate 0 sidecar temizliğiyle sağlanır. Bu test iki
    // GERÇEK OS süreciyle (test binary'sini yeniden çağırarak) ana DB'ye
    // eşzamanlı targeted (WAL UPDATE) + blob-overwrite yaptırır; sonda
    // `integrity_check`==ok ve yetim `-wal`/`-shm` yok beklenir.
    //
    // Koşum:
    //   $env:ARCHIVIST_DB_JOURNAL="wal"
    //   cargo test --manifest-path src-tauri/Cargo.toml --features admin `
    //     wal_smoke_2proc -- --ignored --nocapture
    #[test]
    #[ignore = "manuel 2-process WAL duman testi (alt-süreç spawn eder) — --ignored ile koş"]
    fn wal_smoke_2proc() {
        use rusqlite::Connection;
        use std::process::Command;

        let role = std::env::var("WAL_SMOKE_ROLE").unwrap_or_default();
        let db = std::env::var("WAL_SMOKE_DB")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("wal_smoke_2proc.db"));
        let iters: usize = std::env::var("WAL_SMOKE_ITERS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(300);

        // ---- WORKER dalları (alt-süreç) ----
        if role == "targeted" {
            // App'in targeted yolu: acquire_db_write_lock (fs2, süreç-arası)
            // + prepare_write_conn (ARCHIVIST_DB_JOURNAL=wal → WAL).
            for i in 0..iters {
                let _fl = acquire_db_write_lock(&db)
                    .expect("targeted: fs2 kilidi alınamadı");
                let conn =
                    prepare_write_conn(&db).expect("targeted: conn açılamadı");
                conn.execute(
                    "UPDATE t SET v = ?1 WHERE id = 1",
                    rusqlite::params![format!("targeted-{i}")],
                )
                .expect("targeted: UPDATE başarısız");
                drop(conn);
                drop(_fl);
            }
            return; // worker testi: panic yoksa süreç 0 ile çıkar
        }
        if role == "blob" {
            // App'in blob-overwrite yolu = write_db_at: acquire_db_write_lock
            // + write_and_sync (Gate 0: stale -wal/-shm siler).
            let blob = std::env::var("WAL_SMOKE_BLOB").expect("WAL_SMOKE_BLOB yok");
            let bytes = std::fs::read(&blob).expect("blob kaynağı okunamadı");
            for _ in 0..iters {
                write_db_at(&db, &bytes).expect("blob: write_db_at başarısız");
            }
            return;
        }

        // ---- ORCHESTRATOR ----
        let _ = std::fs::remove_file(&db);
        let (wal, shm) = wal_sidecar_paths(&db);
        let _ = std::fs::remove_file(&wal);
        let _ = std::fs::remove_file(&shm);
        let _ = std::fs::remove_file(db.with_extension("db.lock"));

        // DB'yi kur (şema + 1 satır), WAL'e geç.
        {
            let c = Connection::open(&db).unwrap();
            c.execute_batch(
                "PRAGMA journal_mode=WAL; \
                 CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); \
                 INSERT INTO t(id, v) VALUES (1, 'init');",
            )
            .unwrap();
        }
        // Blob worker'ın her iter yazacağı tam-geçerli kaynak db.
        let blob_src = db.with_extension("blobsrc.db");
        {
            let c = Connection::open(&blob_src).unwrap();
            c.execute_batch(
                "PRAGMA journal_mode=DELETE; \
                 CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); \
                 INSERT INTO t(id, v) VALUES (1, 'blob');",
            )
            .unwrap();
        }

        let exe = std::env::current_exe().expect("current_exe");
        let spawn = |r: &str| {
            Command::new(&exe)
                .args([
                    "--exact",
                    "ollama_db::tests::wal_smoke_2proc",
                    "--ignored",
                    "--nocapture",
                ])
                .env("WAL_SMOKE_ROLE", r)
                .env("WAL_SMOKE_DB", &db)
                .env("WAL_SMOKE_BLOB", &blob_src)
                .env("WAL_SMOKE_ITERS", iters.to_string())
                .env("ARCHIVIST_DB_JOURNAL", "wal")
                .spawn()
                .expect("alt-süreç başlatılamadı")
        };
        let mut c_t = spawn("targeted");
        let mut c_b = spawn("blob");
        let st_t = c_t.wait().expect("targeted wait");
        let st_b = c_b.wait().expect("blob wait");
        assert!(st_t.success(), "targeted süreç başarısız: {st_t:?}");
        assert!(st_b.success(), "blob süreç başarısız: {st_b:?}");

        // Son bir blob-overwrite → Gate 0 invariant'ı deterministik kontrol
        // edilebilsin (sidecar temizliği bu yoldadır).
        {
            let bytes = std::fs::read(&blob_src).unwrap();
            write_db_at(&db, &bytes).unwrap();
        }
        assert!(!wal.exists(), "yetim -wal kaldı (Gate 0 ihlali, 2-process)");
        assert!(!shm.exists(), "yetim -shm kaldı (Gate 0 ihlali, 2-process)");

        let c = Connection::open(&db).unwrap();
        let integ: String = c
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(integ, "ok", "2-process sonrası integrity bozuldu");
        let v: String = c
            .query_row("SELECT v FROM t WHERE id=1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, "blob", "son blob-overwrite içeriği görünmüyor");
        drop(c);

        let _ = std::fs::remove_file(&db);
        let _ = std::fs::remove_file(&blob_src);
        let _ = std::fs::remove_file(&wal);
        let _ = std::fs::remove_file(&shm);
        let _ = std::fs::remove_file(db.with_extension("db.lock"));
        println!("[wal_smoke_2proc] GEÇTİ — {iters} iter ×2 süreç, integrity=ok, yetim yan-dosya yok");
    }

    #[test]
    fn test_read_lock_when_no_write_lock() {
        let tmp = tempfile::tempdir().unwrap();
        let db_path = tmp.path().join("readlocktest.db");

        // Yazma kilidi yokken okuma kilidi alınabilmeli
        let read_lock = try_acquire_db_read_lock(&db_path);
        assert!(read_lock.is_some());

        drop(read_lock);
    }

    // ── Sync core: has_sqlite_magic / read_db_at / write_db_at (Sprint 0.3) ──

    #[test]
    fn test_has_sqlite_magic_valid_and_invalid() {
        assert!(has_sqlite_magic(b"SQLite format 3\x00rest of file"));
        assert!(!has_sqlite_magic(b"not a sqlite file at all"));
        assert!(!has_sqlite_magic(b"short")); // < 16 bayt
        assert!(!has_sqlite_magic(b"")); // boş
        // Tam 16 bayt sınır
        assert!(has_sqlite_magic(b"SQLite format 3\x00"));
        assert!(!has_sqlite_magic(b"SQLite format 3")); // 15 bayt — eksik NUL
    }

    #[test]
    fn test_read_db_at_nonexistent_returns_empty_not_corrupt() {
        let tmp = tempfile::tempdir().unwrap();
        let r = read_db_at(&tmp.path().join("yok.db")).unwrap();
        assert!(r.bytes.is_empty());
        assert!(!r.corrupted);
        assert!(!r.locked_by_other);
    }

    #[test]
    fn test_read_db_at_corrupt_file_is_backed_up() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("bozuk.db");
        std::fs::write(&db, b"GARBAGE not sqlite header here").unwrap();

        let r = read_db_at(&db).unwrap();
        assert!(r.corrupted, "geçersiz header corrupted=true vermeli");
        assert!(r.bytes.is_empty());
        // Bozuk dosya .corrupt.bak'a taşınmış, orijinal yok
        assert!(!db.exists(), "bozuk dosya taşınmalı");
        assert!(db.with_extension("corrupt.bak").exists(), "yedek oluşmalı");
    }

    #[test]
    fn test_write_db_at_creates_parent_dirs_and_roundtrips_read_db_at() {
        let tmp = tempfile::tempdir().unwrap();
        // Var olmayan iç içe dizin — write_db_at oluşturmalı
        let db = tmp.path().join("a").join("b").join("data.db");

        // Geçerli SQLite header'lı içerik
        let mut payload = b"SQLite format 3\x00".to_vec();
        payload.extend_from_slice(b"...gercek veri...");

        write_db_at(&db, &payload).expect("write_db_at başarılı olmalı");
        assert!(db.exists());

        let r = read_db_at(&db).unwrap();
        assert!(!r.corrupted);
        assert_eq!(r.bytes, payload, "round-trip baytları korumalı");
    }

    #[test]
    fn test_write_db_at_overwrites_atomically() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("ow.db");
        write_db_at(&db, b"SQLite format 3\x00first").unwrap();
        write_db_at(&db, b"SQLite format 3\x00second").unwrap();
        assert_eq!(std::fs::read(&db).unwrap(), b"SQLite format 3\x00second");
        // .db.tmp artığı kalmamalı
        assert!(!db.with_extension("db.tmp").exists());
    }
}
