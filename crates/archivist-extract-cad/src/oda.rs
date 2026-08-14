//! ODAFileConverter — opsiyonel harici DWG→DXF donusturucu (oto-tespit + zarif dusus).
//!
//! H2 `dwg_parse.rs` (tespit/donusum) + `oda_converter.rs` (cache) naklı.
//! [`DwgExtractor`](crate::DwgExtractor) ODA **kuruluysa** ONCE bunu dener (otoriter
//! layer/block/text/unit), yoksa saf raw-scan'e **zarif dusus** yapar (ikili tahmin).
//! ODA yoksa fonksiyonlar `Err` doner.
//!
//! # ⚠️ Es-zamanlilik kapisi ([`ODA_MAX_CONCURRENT`]) — H2 PARITESI
//! Bir ODA donusumu UCUZ DEGIL: dosyayi temp'e **kopyalar** (ag dosyasinda ikinci bir tam
//! okuma!) + **PowerShell** + **ODA (Qt GUI)** alt-sureci baslatir. 2026-07-16 olcumu
//! (gercek ofis DWG'si, 5.4 MB): raw-scan **1.09 sn** vs ODA **3.47 sn** (tek dosya,
//! cekismesiz — ve BASARILI).
//!
//! Bu kapi olmadan ingest her DWG icin ayri ODA baslatiyordu ve worker havuzu
//! `cores.min(16)` → 32-cekirdekli makinede **16 es-zamanli** PowerShell+Qt sureci →
//! cekisme → her biri `Registry`'nin **30 sn `EXTRACT_TIMEOUT`**'unu asiyor → cikarim
//! **atiliyordu**. Olculen etki: gercek DWG klasorlerinin **~%12'si metadata'siz** indeksleniyordu
//! (yalniz ad/hash/boyut → icerigi ARANAMAZ). Yani timeout, **cikarilabilir** veriyi cope atiyordu.
//!
//! H2 bunu yasamaz cunku: (1) `fileScanner.ts` `PREPARE_CONCURRENCY` **varsayilan 3**
//! (kullanici ayari 1-16; cekirdek sayisindan BAGIMSIZ) → ayni anda en fazla 3 ODA;
//! (2) `raceInvoke` timeout DEGIL, yalniz iptal yarisi → H2 gerekirse SURESIZ bekler, veriyi
//! asla atmaz. H3 daha korumaci davranir: kaynak diskin turu bilinmedigi ve birden cok gizli Qt
//! sureci WebView'i ac birakabildigi icin ODA es-zamanliligi **varsayilan 1**'de kapilanir
//! (Ayarlar'dan degistirilebilir — [`set_max_concurrent`]; cekirdek sayisiyla OLCEKLENMEZ). H3 (2)'yi
//! ALMAZ — 30 sn timeout gercek hang'lere karsi guvenlik agi olarak KALIR; kapi sayesinde normal isde
//! artik tetiklenmez (3 slot × ~3.5 sn → 16 dosyalik en kotu kuyruk ~21 sn < 30 sn).
//!
//! Kapi YALNIZ ODA alt-surecini sinirlar — hash/raw-scan/gorsel isleri havuzun tam
//! genisliginde kosmaya devam eder (H3'un H2'ye ustunlugu korunur).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::UNIX_EPOCH;

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor};

/// Es-zamanli ODA donusumu **VARSAYILANI**. Kaynak diskin turu bilinmedigi icin guvenli deger 1;
/// cekirdek sayisiyla OLCEKLENMEZ (darbogaz CPU degil, alt-surec + disk cekismesi).
/// Ayarlar'dan [`set_max_concurrent`] ile calisma-zamaninda degistirilebilir (makine-yerel;
/// DWG-agir arsivde kullanici artirir/azaltir). Bkz modul dokumani.
pub const ODA_MAX_CONCURRENT: usize = 1;

/// Kabul edilen ODA es-zamanlilik araligi (guvenli kelepceler). UI 1-8 sunar; kod H2
/// `PREPARE_CONCURRENCY` araligini (1-16) kabul eder — 0/asiri deger burada kelepcelenir.
const ODA_MIN: usize = 1;
const ODA_LIMIT: usize = 16;

/// `n`'i gecerli ODA es-zamanlilik araligina kelepcele (saf; birim-test edilebilir).
fn clamp_oda(n: usize) -> usize {
    n.clamp(ODA_MIN, ODA_LIMIT)
}

/// Su anki ODA es-zamanlilik ust siniri (calisma-zamani ayarlanabilir; varsayilan
/// [`ODA_MAX_CONCURRENT`]). Kapi `in_use < ODA_MAX` iken izin verir → siniri dusurmek yeni
/// izinleri bekletir, artirmak bekleyenleri uyandirir.
static ODA_MAX: AtomicUsize = AtomicUsize::new(ODA_MAX_CONCURRENT);
/// Su an calisan ODA donusumu sayisi (`Condvar` ile bekleme).
static ODA_IN_USE: Mutex<usize> = Mutex::new(0);
static ODA_SLOT_FREED: Condvar = Condvar::new();

/// ODA es-zamanlilik ust sinirini ayarla (Ayarlar'dan; her tarama basinda cagrilir). `n` gecerli
/// araliga kelepcelenir (`ODA_MIN..=ODA_LIMIT`). Sinir artirilinca bekleyen thread'ler uyandirilir
/// (yeni slot acilmis olabilir); dusurulunce calismakta olanlar biter, yenisi bekler.
pub fn set_max_concurrent(n: usize) {
    ODA_MAX.store(clamp_oda(n), Ordering::Relaxed);
    ODA_SLOT_FREED.notify_all(); // sinir arttiysa bekleyenler yeniden degerlendirsin
}

/// Su anki ODA es-zamanlilik ust siniri.
pub fn max_concurrent() -> usize {
    ODA_MAX.load(Ordering::Relaxed)
}

/// RAII izin: alinca calisan-sayaci artirir, `Drop`'ta azaltir.
///
/// `Drop` panik sirasinda da (unwinding) kosar → `Registry`'nin `catch_unwind` siniri slot
/// SIZDIRMAZ. Registry timeout'ta thread'i terk etse bile is bitince sayac dusurulur
/// (kalici tikanma yok). Kilit yalniz sayaci korur — ODA donusumu kilit DISINDA kosar.
struct OdaPermit;

impl OdaPermit {
    fn acquire() -> Self {
        let mut in_use = ODA_IN_USE.lock().unwrap_or_else(|e| e.into_inner());
        // Sinir calisma-zamaninda degisebilir → her uyaniste ODA_MAX'i yeniden oku.
        while *in_use >= ODA_MAX.load(Ordering::Relaxed) {
            in_use = ODA_SLOT_FREED.wait(in_use).unwrap_or_else(|e| e.into_inner());
        }
        *in_use += 1;
        OdaPermit
    }
}

impl Drop for OdaPermit {
    fn drop(&mut self) {
        let mut in_use = ODA_IN_USE.lock().unwrap_or_else(|e| e.into_inner());
        *in_use = in_use.saturating_sub(1);
        ODA_SLOT_FREED.notify_one();
    }
}

/// ODAFileConverter yolunu ara: registry → varsayilan yollar → PATH. Bulunamazsa `None`.
pub fn detect() -> Option<PathBuf> {
    find_in_registry().or_else(find_in_default_paths).or_else(find_in_path)
}

#[cfg(target_os = "windows")]
fn find_in_registry() -> Option<PathBuf> {
    use winreg::enums::{HKEY_LOCAL_MACHINE, KEY_READ};
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let reg_paths = [
        r"SOFTWARE\Open Design Alliance\ODAFileConverter",
        r"SOFTWARE\WOW6432Node\Open Design Alliance\ODAFileConverter",
        r"SOFTWARE\ODA\ODAFileConverter",
        r"SOFTWARE\WOW6432Node\ODA\ODAFileConverter",
    ];
    for reg_path in &reg_paths {
        let Ok(key) = hklm.open_subkey_with_flags(reg_path, KEY_READ) else { continue };
        for value_name in ["InstallPath", "Path", "InstallDir", "InstallLocation", ""] {
            if let Ok(val) = key.get_value::<String, _>(value_name) {
                let candidate = PathBuf::from(&val).join("ODAFileConverter.exe");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
        for subkey_name in key.enum_keys().filter_map(Result::ok) {
            if let Ok(subkey) = key.open_subkey_with_flags(&subkey_name, KEY_READ) {
                for value_name in ["InstallPath", "Path", "InstallDir", "InstallLocation", ""] {
                    if let Ok(val) = subkey.get_value::<String, _>(value_name) {
                        let candidate = PathBuf::from(&val).join("ODAFileConverter.exe");
                        if candidate.is_file() {
                            return Some(candidate);
                        }
                    }
                }
            }
        }
    }

    // Uninstall kayitlari (cogu installer buraya yazar).
    let uninstall_roots = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];
    for root in &uninstall_roots {
        let Ok(root_key) = hklm.open_subkey_with_flags(root, KEY_READ) else { continue };
        for subkey_name in root_key.enum_keys().filter_map(Result::ok) {
            if !subkey_name.to_lowercase().contains("oda") {
                continue;
            }
            let Ok(subkey) = root_key.open_subkey_with_flags(&subkey_name, KEY_READ) else {
                continue;
            };
            let dn: String = subkey.get_value("DisplayName").unwrap_or_default();
            let dn_lower = dn.to_lowercase();
            if !dn_lower.contains("oda") && !dn_lower.contains("file converter") {
                continue;
            }
            if let Ok(loc) = subkey.get_value::<String, _>("InstallLocation") {
                let candidate = PathBuf::from(&loc).join("ODAFileConverter.exe");
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
            if let Ok(icon) = subkey.get_value::<String, _>("DisplayIcon") {
                let icon_path = icon.split(',').next().unwrap_or("").trim();
                let p = PathBuf::from(icon_path);
                if p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
                    return Some(p);
                }
            }
        }
    }
    None
}

#[cfg(not(target_os = "windows"))]
fn find_in_registry() -> Option<PathBuf> {
    None
}

fn find_in_default_paths() -> Option<PathBuf> {
    let roots = [r"C:\Program Files\ODA", r"C:\Program Files (x86)\ODA"];
    for root_str in &roots {
        let root = PathBuf::from(root_str);
        if let Ok(entries) = std::fs::read_dir(&root) {
            let mut subdirs: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .filter(|e| e.file_type().is_ok_and(|ft| ft.is_dir()))
                .map(|e| e.path())
                .collect();
            subdirs.sort_by(|a, b| b.cmp(a)); // en yeni surum once
            for subdir in &subdirs {
                let exe = subdir.join("ODAFileConverter.exe");
                if exe.is_file() {
                    return Some(exe);
                }
            }
        }
        let direct = root.join("ODAFileConverter.exe");
        if direct.is_file() {
            return Some(direct);
        }
    }
    None
}

fn find_in_path() -> Option<PathBuf> {
    let path_var = std::env::var("PATH").ok()?;
    let sep = if cfg!(windows) { ';' } else { ':' };
    for dir in path_var.split(sep) {
        for name in ["ODAFileConverter.exe", "ODAFileConverter"] {
            let candidate = PathBuf::from(dir).join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// DWG'yi ODA ile DXF'e cevir; (dxf_yolu, temizlenecek_temp_dizin) doner.
///
/// Cagiran, donen temp dizini parse sonrasi silmeli.
pub fn convert_dwg_to_dxf(dwg_path: &str, oda_exe: &Path) -> Result<(PathBuf, PathBuf), String> {
    use std::process::Command;
    use std::time::SystemTime;

    let dwg = Path::new(dwg_path);
    if !dwg.is_file() {
        return Err(format!("DWG dosyasi bulunamadi: {dwg_path}"));
    }

    // ── ES-ZAMANLILIK KAPISI (H2 pariti; bkz modul dokumani) ───────────────────────────
    // Bu noktadan sonrasi PAHALI: temp kopya + PowerShell + ODA(Qt) alt-sureci. En fazla
    // ODA_MAX_CONCURRENT tane es-zamanli calisir; fazlasi burada BEKLER. Izin fonksiyon
    // cikisinda (Drop) iade edilir → hata/panik yolunda da sizmaz.
    // Kapi var-olmadiginda 16 es-zamanli ODA → 30sn EXTRACT_TIMEOUT → ~%12 DWG metadata'siz.
    let _oda_permit = OdaPermit::acquire();
    let suffix: u64 = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let temp_base = std::env::temp_dir();
    let input_dir = temp_base.join(format!("oda_in_{suffix}"));
    let output_dir = temp_base.join(format!("oda_out_{suffix}"));
    std::fs::create_dir_all(&input_dir).map_err(|e| format!("temp input: {e}"))?;
    std::fs::create_dir_all(&output_dir).map_err(|e| format!("temp output: {e}"))?;

    let dwg_filename = dwg.file_name().ok_or("DWG dosya adi alinamadi")?;
    std::fs::copy(dwg, input_dir.join(dwg_filename)).map_err(|e| format!("DWG kopyalanamadi: {e}"))?;

    // ODA Qt GUI uygulamasi — Windows'ta gizli pencere ile cagrilir.
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let q = |s: &str| format!("'{}'", s.replace('\'', "''"));
        let ps_cmd = format!(
            "$p = Start-Process -FilePath {} -ArgumentList {},{},{},{},{},{} -WindowStyle Hidden -PassThru; try {{ $p.PriorityClass = 'BelowNormal' }} catch {{}}; $p.WaitForExit(); exit $p.ExitCode",
            q(&oda_exe.to_string_lossy()),
            q(&input_dir.to_string_lossy()),
            q(&output_dir.to_string_lossy()),
            q("ACAD2018"),
            q("DXF"),
            q("0"),
            q("1"),
        );
        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
    };
    #[cfg(not(windows))]
    let result = Command::new(oda_exe)
        .arg(input_dir.to_string_lossy().as_ref())
        .arg(output_dir.to_string_lossy().as_ref())
        .args(["ACAD2018", "DXF", "0", "1"])
        .output();

    let result = result.map_err(|e| format!("ODAFileConverter calistirilamadi: {e}"))?;
    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        let _ = std::fs::remove_dir_all(&input_dir);
        let _ = std::fs::remove_dir_all(&output_dir);
        return Err(format!("ODAFileConverter hata: {} — {stderr}", result.status));
    }

    let dxf_path = std::fs::read_dir(&output_dir)
        .map_err(|e| format!("output okunamadi: {e}"))?
        .filter_map(Result::ok)
        .find(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("dxf")))
        .map(|e| e.path());
    let _ = std::fs::remove_dir_all(&input_dir);

    match dxf_path {
        Some(dxf) => Ok((dxf, output_dir)),
        None => {
            let _ = std::fs::remove_dir_all(&output_dir);
            Err("ODA ciktisinda DXF bulunamadi".to_string())
        }
    }
}

/// DXF cache toplam-boyut TAVANI (MB). Asilinca en-eski-kullanilan (LRU) girisler silinir.
/// Gozlem (2026-07-16): cache 260 dosya / **2.4 GB**'ye ulasmisti — tavan/temizlik YOKTU.
/// Varsayilan 2 GB: gozlenen 2.4 GB'nin altinda ama tipik bir aktif arsivin calisma-kumesini
/// tutacak kadar genis (cok kucuk tavan → thrash: her yeniden-tarama ODA'yi tekrar kosar).
/// `ARSIV_ODA_CACHE_MAX_MB` ile gecersiz kilinabilir (0 → sinirsiz/kapali; test ufak deger verir).
const ODA_CACHE_MAX_MB: u64 = 2048;

/// Yururlukteki cache tavani (bayt); env override ile. 0 → kapali.
fn cache_max_bytes() -> u64 {
    let mb = std::env::var("ARSIV_ODA_CACHE_MAX_MB")
        .ok()
        .and_then(|s| s.trim().parse::<u64>().ok())
        .unwrap_or(ODA_CACHE_MAX_MB);
    mb.saturating_mul(1024 * 1024)
}

/// Bir DWG yolunun cache-anahtar oneki: yola bagli 16-hex hash + `_`. Ayni kaynagin tum
/// surumleri bu oneki paylasir (yalniz mtime/size sonek farkli) → yetim temizligi bununla eler.
fn path_hash_hex(dwg_path: &Path) -> String {
    let mut h = DefaultHasher::new();
    dwg_path.to_string_lossy().to_lowercase().hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Cache anahtari: path-hash + mtime_ms + size (dosya degisince anahtar farklilasir).
fn compute_cache_key(dwg_path: &Path) -> Result<String, String> {
    let meta = std::fs::metadata(dwg_path).map_err(|e| format!("DWG metadata: {e}"))?;
    let mtime_ms = meta
        .modified()
        .map_err(|e| format!("DWG mtime: {e}"))?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("sistem saati: {e}"))?
        .as_millis();
    let size = meta.len();
    Ok(format!("{}_{mtime_ms}_{size}.dxf", path_hash_hex(dwg_path)))
}

/// Cache-hit'te dosyanin mtime'ini simdiye tazele → LRU siralamasinda "yeni kullanildi" olur
/// (tavan asiminda sicak girisler en son silinir). Best-effort: hata yok sayilir.
fn touch(path: &Path) {
    if let Ok(f) = std::fs::OpenOptions::new().write(true).open(path) {
        let _ = f.set_modified(std::time::SystemTime::now());
    }
}

/// Ayni kaynak DWG'nin ESKI (bayat) cache girislerini sil. Dosya degisince yeni anahtar olusur
/// → eski giris (eski mtime/size soneki) ARTIK asla hit almaz = yetim. `keep_name` (yeni yazilan)
/// korunur. Boylece dosya basina cache girisi 1'de sabitlenir → yetim birikimi (2.4 GB gozlemi)
/// engellenir. `prefix` = [`path_hash_hex`] + `_`.
fn prune_stale_for_key(cache_dir: &Path, prefix: &str, keep_name: &std::ffi::OsStr) {
    let Ok(rd) = std::fs::read_dir(cache_dir) else {
        return;
    };
    for e in rd.flatten() {
        let name = e.file_name();
        if name == keep_name {
            continue;
        }
        if name.to_string_lossy().starts_with(prefix) {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Cache toplam boyutu `max_bytes`'i asarsa en-eski-degistirilen (LRU; hit'te [`touch`] tazeler)
/// girisleri tavan altina inene dek sil. `max_bytes == 0` → sinir yok (kapali). Best-effort:
/// okunamayan/silinemeyen giris atlanir (bir sonraki miss'te yeniden denenir).
fn enforce_cache_cap(cache_dir: &Path, max_bytes: u64) {
    if max_bytes == 0 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(cache_dir) else {
        return;
    };
    let mut files: Vec<(std::time::SystemTime, u64, PathBuf)> = Vec::new();
    let mut total: u64 = 0;
    for e in rd.flatten() {
        let Ok(m) = e.metadata() else { continue };
        if !m.is_file() {
            continue;
        }
        let len = m.len();
        total += len;
        let mtime = m.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        files.push((mtime, len, e.path()));
    }
    if total <= max_bytes {
        return;
    }
    files.sort_by_key(|(mtime, _, _)| *mtime); // en eski once
    for (_, len, path) in files {
        if total <= max_bytes {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

/// Cache'te varsa DXF yolunu don; yoksa ODA ile cevirip cache'e koy. ODA yoksa `Err`.
pub fn convert_dwg_to_dxf_cached(dwg_path: &str, cache_dir: &Path) -> Result<PathBuf, String> {
    let dwg = Path::new(dwg_path);
    if !dwg.is_file() {
        return Err(format!("DWG bulunamadi: {dwg_path}"));
    }
    std::fs::create_dir_all(cache_dir).map_err(|e| format!("cache dizini: {e}"))?;
    let cached = cache_dir.join(compute_cache_key(dwg)?);
    if cached.is_file() {
        touch(&cached); // LRU: hit → "yeni kullanildi"
        return Ok(cached);
    }
    let oda = detect().ok_or("ODAFileConverter kurulu degil")?;
    let (dxf_temp, output_dir) = convert_dwg_to_dxf(dwg_path, &oda)?;
    std::fs::copy(&dxf_temp, &cached).map_err(|e| format!("cache yazilamadi: {e}"))?;
    let _ = std::fs::remove_dir_all(&output_dir);

    // ── TAVAN/TEMIZLIK (2026-07-17; "sinirsiz buyume" acik-kalemi) ─────────────────────────
    // (1) Bu kaynagin bayat girislerini ele → dosya basina 1 giris (yetim birikimi biter).
    // (2) Toplam boyutu LRU ile kelepcele → cache disk-sisirmez (gozlem: 2.4 GB tavansiz).
    if let Some(name) = cached.file_name() {
        prune_stale_for_key(cache_dir, &format!("{}_", path_hash_hex(dwg)), name);
    }
    enforce_cache_cap(cache_dir, cache_max_bytes());
    Ok(cached)
}

/// DXF donusum cache'ini temizle; silinen toplam bayt doner.
pub fn clear_cache(cache_dir: &Path) -> Result<u64, String> {
    if !cache_dir.is_dir() {
        return Ok(0);
    }
    let mut total = 0u64;
    for e in std::fs::read_dir(cache_dir).map_err(|e| e.to_string())?.flatten() {
        if let Ok(m) = e.metadata() {
            total += m.len();
        }
        let _ = std::fs::remove_file(e.path());
    }
    Ok(total)
}

/// **Opt-in yuksek-kalite DWG cikarimi:** ODA ile DXF'e cevir + [`DxfExtractor`] calistir.
///
/// ODA yoksa veya donusum basarisizsa `Err` — cagiran [`DwgExtractor`] raw-scan'e dusebilir.
pub fn extract_dwg(dwg_path: &str, cache_dir: &Path) -> Result<Extracted, ExtractError> {
    let dxf_path = convert_dwg_to_dxf_cached(dwg_path, cache_dir).map_err(ExtractError::Parse)?;
    let input = ExtractInput::from_path(&dxf_path)
        .map_err(|e| ExtractError::io(&dxf_path, e))?;
    let mut out = crate::dxf::DxfExtractor.extract(&input)?;
    // Orijinal DWG header'indan version'i enjekte et (DXF'in $ACADVER'i kaybolabilir).
    if let Ok(data) = std::fs::read(dwg_path) {
        if let Some(v) = crate::dwg::get_dwg_version(&data) {
            out.set("version", v);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_stability_and_change() {
        let base = std::env::temp_dir();
        let tmp = base.join(format!("oda_h3_{}.dwg", std::process::id()));
        std::fs::write(&tmp, b"stable").unwrap();
        let k1 = compute_cache_key(&tmp).unwrap();
        let k2 = compute_cache_key(&tmp).unwrap();
        assert_eq!(k1, k2);
        assert!(k1.ends_with(".dxf"));

        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&tmp, b"stable-modified-longer").unwrap();
        let k3 = compute_cache_key(&tmp).unwrap();
        assert_ne!(k1, k3, "mtime/size degisince anahtar farklilasmali");
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn detect_is_graceful_when_absent() {
        // ODA kurulu olmayabilir → None veya Some, ikisi de gecerli (panik etmemeli).
        let _ = detect();
    }

    #[test]
    fn default_max_is_storage_safe_one() {
        assert_eq!(ODA_MAX_CONCURRENT, 1);
    }

    #[test]
    fn clamp_oda_keeps_within_bounds() {
        assert_eq!(clamp_oda(0), ODA_MIN, "0 → alt sinir (gecersiz/kapali degil, en az 1)");
        assert_eq!(clamp_oda(1), 1);
        assert_eq!(clamp_oda(3), 3);
        assert_eq!(clamp_oda(8), 8);
        assert_eq!(clamp_oda(999), ODA_LIMIT, "asiri deger → ust sinir (16)");
    }

    #[test]
    fn enforce_cache_cap_evicts_oldest_until_under_limit() {
        use std::time::{Duration, SystemTime};
        let dir = std::env::temp_dir().join(format!("oda_cap_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        // 4 dosya × 100 bayt = 400; tavan 250 → en eski 2 silinmeli (kalan 200 ≤ 250).
        let base = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        let names = [
            "aaaa000000000000_1_100.dxf",
            "bbbb000000000000_2_100.dxf",
            "cccc000000000000_3_100.dxf",
            "dddd000000000000_4_100.dxf",
        ];
        for (i, n) in names.iter().enumerate() {
            let p = dir.join(n);
            std::fs::write(&p, vec![0u8; 100]).unwrap();
            let f = std::fs::OpenOptions::new().write(true).open(&p).unwrap();
            f.set_modified(base + Duration::from_secs(i as u64)).unwrap(); // i=0 en eski
        }
        enforce_cache_cap(&dir, 250);
        let remaining: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(remaining.len(), 2, "en eski 2 silinmeli, en yeni 2 kalmali: {remaining:?}");
        assert!(remaining.contains(&"cccc000000000000_3_100.dxf".to_string()));
        assert!(remaining.contains(&"dddd000000000000_4_100.dxf".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn enforce_cache_cap_noop_when_under_limit_or_disabled() {
        let dir = std::env::temp_dir().join(format!("oda_cap2_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("aaaa000000000000_1_100.dxf"), vec![0u8; 100]).unwrap();
        std::fs::write(dir.join("bbbb000000000000_2_100.dxf"), vec![0u8; 100]).unwrap();
        enforce_cache_cap(&dir, 10_000); // tavan uzerinde bosluk → dokunma
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
        enforce_cache_cap(&dir, 0); // 0 → kapali → dokunma
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_stale_for_key_removes_only_same_source_orphans() {
        let dir = std::env::temp_dir().join(format!("oda_prune_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // Ayni kaynak (abcd... oneki) 3 surum + baska kaynak (ef01...).
        let keep = "abcd0000abcd0000_300_50.dxf";
        for n in [
            "abcd0000abcd0000_100_50.dxf",
            "abcd0000abcd0000_200_50.dxf",
            keep,
            "ef01ef01ef01ef01_100_50.dxf",
        ] {
            std::fs::write(dir.join(n), b"x").unwrap();
        }
        prune_stale_for_key(&dir, "abcd0000abcd0000_", std::ffi::OsStr::new(keep));
        let remaining: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(remaining.len(), 2, "keep + baska-kaynak kalmali: {remaining:?}");
        assert!(remaining.contains(&keep.to_string()));
        assert!(remaining.contains(&"ef01ef01ef01ef01_100_50.dxf".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn touch_advances_mtime_for_lru() {
        use std::time::{Duration, SystemTime};
        let dir = std::env::temp_dir().join(format!("oda_touch_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("aaaa000000000000_1_10.dxf");
        std::fs::write(&p, b"xxxxxxxxxx").unwrap();
        let old = SystemTime::UNIX_EPOCH + Duration::from_secs(1000);
        std::fs::OpenOptions::new().write(true).open(&p).unwrap().set_modified(old).unwrap();
        touch(&p);
        let after = std::fs::metadata(&p).unwrap().modified().unwrap();
        assert!(after > old, "touch mtime'i ilerletmeli (LRU tazeleme icin)");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn path_hash_hex_is_stable_16_hex_and_case_insensitive() {
        let a = path_hash_hex(Path::new(r"C:\Cizim\Plan.dwg"));
        let b = path_hash_hex(Path::new(r"c:\cizim\plan.DWG"));
        assert_eq!(a.len(), 16);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(a, b, "yol karsilastirmasi kucuk-harfe indirgenir (Windows)");
    }

    #[test]
    fn set_and_get_max_concurrent_roundtrips_and_clamps() {
        let original = max_concurrent();
        set_max_concurrent(6);
        assert_eq!(max_concurrent(), 6);
        set_max_concurrent(0); // kelepce → alt sinir
        assert_eq!(max_concurrent(), ODA_MIN);
        set_max_concurrent(1000); // kelepce → ust sinir
        assert_eq!(max_concurrent(), ODA_LIMIT);
        set_max_concurrent(original); // paylasilan global → digerlerini etkilememek icin geri yukle
        assert_eq!(max_concurrent(), original);
    }
}
