//! Guvenlik iskeleti — H2 `lan_server.rs`'ten BIREBIR portlanmis (kanitli desen; yeni yontem
//! icat edilmedi). 8-hane kriptografik kod · IP basina rate-limit/lockout · constant-time
//! karsilastirma · siki CORS. Testler bu modulu izole eder.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Basarisiz auth: `5 hata / 5 dk` -> IP `LOCKOUT_DURATION` boyunca reddedilir (brute-force savunmasi;
/// 10^8 kod uzayi + rate-limit = pratikte kapali). H2 sabitleriyle ayni.
const MAX_FAILED_ATTEMPTS: u32 = 5;
const FAILED_WINDOW: Duration = Duration::from_secs(300);
const LOCKOUT_DURATION: Duration = Duration::from_secs(300);

#[derive(Default)]
struct AuthFailureTracker {
    /// IP -> (hata_sayisi, pencere_baslangici, Some(lockout_baslangici)?)
    map: HashMap<String, (u32, Instant, Option<Instant>)>,
}

// Process-global (tek sunucu/process). H2 deseni.
static AUTH_FAILURES: Mutex<Option<AuthFailureTracker>> = Mutex::new(None);

/// IP su anda lockout altinda mi? Kilit hatasinda guvenli tarafa (kilitli-degil DEGIL, ama
/// fail-open olmamak icin `false` doner; auth yine de kodu dogrular).
pub fn is_ip_locked_out(ip: &str) -> bool {
    let guard = match AUTH_FAILURES.lock() {
        Ok(g) => g,
        Err(_) => return false,
    };
    let Some(tracker) = guard.as_ref() else {
        return false;
    };
    if let Some((_count, _window_start, Some(lock_start))) = tracker.map.get(ip) {
        if lock_start.elapsed() < LOCKOUT_DURATION {
            return true;
        }
    }
    false
}

/// IP icin basarisiz deneme kaydet; esigi asarsa lockout baslat. Kayan pencere/dolmus lockout sifirlanir.
pub fn record_auth_failure(ip: &str) {
    let mut guard = match AUTH_FAILURES.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    let tracker = guard.get_or_insert_with(AuthFailureTracker::default);
    let now = Instant::now();
    let entry = tracker.map.entry(ip.to_string()).or_insert((0, now, None));
    if let Some(lock_start) = entry.2 {
        if lock_start.elapsed() >= LOCKOUT_DURATION {
            *entry = (0, now, None);
        }
    }
    if entry.1.elapsed() >= FAILED_WINDOW {
        *entry = (0, now, None);
    }
    entry.0 += 1;
    if entry.0 >= MAX_FAILED_ATTEMPTS {
        entry.2 = Some(now);
    }
}

/// Basarili auth -> IP sayacini sifirla.
pub fn clear_auth_failures(ip: &str) {
    if let Ok(mut guard) = AUTH_FAILURES.lock() {
        if let Some(tracker) = guard.as_mut() {
            tracker.map.remove(ip);
        }
    }
}

// ── Istek hizi siniri (TUM istekler — basarili olanlar DAHIL) ─────────────────────────────
//
// ⚠️ Yukaridaki `AUTH_FAILURES` yalniz BASARISIZ auth'u sayar. H2'nin acigi tam buydu
// (docs/design/LAN_ARCHIVE_READ.md §3, tasinmayacaklar #5): **dogru kodu bilen** bir istemci
// sinirsiz sayida agir istek atabiliyordu. `/assets` sorgu calistirdigi (ve Faz 3-4'te
// thumbnail/dosya baytlari donecegi) icin bu artik gercek bir amplifikasyon riski.
// Cozum: IP basina sabit-pencere sayaci — auth'tan ONCE, her istekte.

/// Pencere basina IP basina en fazla istek. Gercek kullanimin cok ustunde: bir grid sayfasi
/// = 1 istek, bildirim yoklamasi = dakikada birkac istek. Amac normal kullanimi degil,
/// otomatik/kotu-niyetli seli kesmek.
const MAX_REQUESTS_PER_WINDOW: u32 = 30;
const REQUEST_WINDOW: Duration = Duration::from_secs(1);

#[derive(Default)]
struct RequestRateTracker {
    /// IP -> (pencere_icindeki_sayac, pencere_baslangici)
    map: HashMap<String, (u32, Instant)>,
}

static REQUEST_RATES: Mutex<Option<RequestRateTracker>> = Mutex::new(None);

/// Bu istek isleme alinsin mi? IP'nin pencere sayacini artirir; tavan asilirsa `false`
/// (cagiran 429 doner). Kilit hatasinda `true` (fail-open) — kilit sorunu yuzunden mesru
/// istemciyi kesmek, hiz sinirinin engellemek istedigi seyden daha kotu olurdu.
///
/// **Auth'tan ONCE cagrilir** → yanlis kodla sel de, dogru kodla sel de ayni tavana tabidir.
pub fn allow_request(ip: &str) -> bool {
    let mut guard = match REQUEST_RATES.lock() {
        Ok(g) => g,
        Err(_) => return true,
    };
    let tracker = guard.get_or_insert_with(RequestRateTracker::default);
    let now = Instant::now();
    let entry = tracker.map.entry(ip.to_string()).or_insert((0, now));
    if entry.1.elapsed() >= REQUEST_WINDOW {
        *entry = (0, now); // pencere doldu → sifirla
    }
    entry.0 += 1;
    entry.0 <= MAX_REQUESTS_PER_WINDOW
}

/// Rastgele 8 haneli auth kodu (yalniz kriptografik RNG; zayif fallback YOK — RNG hatasi -> Err).
/// 8 hane = 10^8 uzay; rate-limit ile birlikte brute-force'a kapali.
pub fn generate_auth_code() -> Result<String, String> {
    let mut buf = [0u8; 4];
    getrandom::getrandom(&mut buf).map_err(|e| format!("kriptografik RNG basarisiz: {e}"))?;
    let num = u32::from_le_bytes(buf) % 100_000_000;
    Ok(format!("{num:08}"))
}

/// Constant-time byte karsilastirma — timing-attack savunmasi (once uzunluk, sonra XOR-akumulasyon).
pub fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// CORS: yalniz `null` origin. LAN istemcisi (curl/fetch/ureq) Origin gondermez → sorun cikmaz.
/// Amac: rastgele bir sitede acik tarayici kodu ele gecirse bile dogrudan istek atamasin.
pub fn cors_headers() -> Vec<tiny_http::Header> {
    vec![
        parse_header("Access-Control-Allow-Origin: null"),
        parse_header("Vary: Origin"),
        parse_header("Access-Control-Allow-Headers: X-Auth-Code, Content-Type"),
        parse_header("Access-Control-Allow-Methods: GET, OPTIONS"),
    ]
}

pub fn json_header() -> tiny_http::Header {
    parse_header("Content-Type: application/json")
}

fn parse_header(raw: &str) -> tiny_http::Header {
    raw.parse::<tiny_http::Header>().expect("gecerli sabit header")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kod_8_hane_ve_sayisal() {
        let code = generate_auth_code().expect("RNG");
        assert_eq!(code.len(), 8, "8 hane olmali");
        assert!(code.chars().all(|c| c.is_ascii_digit()), "yalniz rakam");
    }

    #[test]
    fn constant_time_esitlik() {
        assert!(constant_time_eq(b"12345678", b"12345678"));
        assert!(!constant_time_eq(b"12345678", b"12345679"));
        assert!(!constant_time_eq(b"1234", b"12345678"), "farkli uzunluk -> false");
        assert!(constant_time_eq(b"", b""));
    }

    #[test]
    fn rate_limit_5_hata_sonrasi_kilit() {
        // Izole IP (process-global tracker; benzersiz anahtar test kirlenmesini onler).
        let ip = "10.0.0.201";
        assert!(!is_ip_locked_out(ip), "baslangicta kilit yok");
        for _ in 0..MAX_FAILED_ATTEMPTS {
            record_auth_failure(ip);
        }
        assert!(is_ip_locked_out(ip), "5 hata -> kilit");
        clear_auth_failures(ip);
        assert!(!is_ip_locked_out(ip), "basarili auth -> kilit temizlenir");
    }

    #[test]
    fn rate_limit_esik_altinda_kilit_yok() {
        let ip = "10.0.0.202";
        for _ in 0..(MAX_FAILED_ATTEMPTS - 1) {
            record_auth_failure(ip);
        }
        assert!(!is_ip_locked_out(ip), "4 hata (esik alti) -> kilit yok");
        clear_auth_failures(ip);
    }

    #[test]
    fn istek_hizi_tavani_basarililari_da_sayar() {
        // Izole IP (process-global tracker; benzersiz anahtar test kirlenmesini onler).
        let ip = "10.0.0.210";
        for n in 1..=MAX_REQUESTS_PER_WINDOW {
            assert!(allow_request(ip), "{n}. istek tavan altinda gecmeli");
        }
        assert!(!allow_request(ip), "tavani asan istek reddedilir");
        // ⚠️ Asil nokta: hicbir auth HATASI olmadi — H2'nin limiteri burada sessiz kalirdi.
        assert!(!is_ip_locked_out(ip), "hiz siniri auth-lockout'u TETIKLEMEZ (ayri mekanizma)");
    }

    #[test]
    fn istek_hizi_penceresi_dolunca_sifirlanir() {
        let ip = "10.0.0.211";
        for _ in 0..MAX_REQUESTS_PER_WINDOW {
            assert!(allow_request(ip));
        }
        assert!(!allow_request(ip), "pencere doldu");
        std::thread::sleep(REQUEST_WINDOW + Duration::from_millis(50));
        assert!(allow_request(ip), "yeni pencere → yeniden kabul");
    }

    #[test]
    fn istek_hizi_ip_basina_ayri() {
        let (a, b) = ("10.0.0.212", "10.0.0.213");
        for _ in 0..MAX_REQUESTS_PER_WINDOW {
            assert!(allow_request(a));
        }
        assert!(!allow_request(a), "A tavana vurdu");
        assert!(allow_request(b), "B ayri IP → etkilenmez");
    }
}
