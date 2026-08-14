//! **Onceki surum (H2 / ArchivistPro) tespiti — ALGILA ve SOYLE, DOKUNMA.**
//!
//! H3, H2'nin halefi; ama bugun Windows'un gozunde AYRI iki urun (paket kimlikleri farkli:
//! `com.archivistpro.desktop` ↔ `com.archivistpro.h3`). Kurulum H2'ye dokunmaz, yan yana dururlar.
//!
//! **Neden kaldirmiyoruz (kullanici karari 2026-08-09).** Kurulum H2'ye dokunmaz; veri tasima
//! artik VAR (`archivist-h2import`, kullanici karari 2026-08-10) ama tasima bitene ve kullanici
//! dogrulayana kadar H2 ve verisi yerinde durmalidir. Bu modul **hicbir sey degistirmez**:
//! yalnizca durumu bulur, UI duz cumleyle soyler; aktarim ayri komutlarla, ACIK kullanici
//! eylemiyle kosulur.
//!
//! **Tespit artik config yonlendirmesini de gorur (duzeltme 2026-08-10).** H2'nin arsiv kayit
//! defteri DB'de degil `archivist_config.json`'dadir ve `db_path` ana arsivi baska diske
//! tasiyabilir (bu makinede olculdu: `D:\DENEME_arşiv\archivist.db` 19 MB — eski tespit yalniz
//! AppData'yi taradigi icin bunu GORMUYORDU). Aday listesi: config yollari ∪ AppData taramasi.
//!
//! **Neden yalniz "kurulu mu" YETMEZ.** Bu makinede olculdu (2026-08-09): H2 kurulu DEGIL — ama
//! veri klasorunde **4 arsiv dosyasi, ~141 MB, ~475 dosya kaydi** duruyor. Yalnizca kurulum
//! kaydina bakan bir tespit "onceki surum yok" der ve tasinacak verinin varligini GIZLERDI. Bu
//! yuzden iki sinyal AYRI raporlanir: program kurulu mu · verisi duruyor mu.

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

/// H2'nin Tauri paket kimligi = veri klasoru adi (`%APPDATA%\<bu>`).
const H2_DATA_DIR: &str = "com.archivistpro.desktop";
/// Son basarili H2 aktariminin ozeti (`app_meta` anahtari; JSON `H2LastImportDto`).
/// Neden var (kullanici bulgusu 2026-08-13): kartin aktarim HAFIZASI yoktu — is bitmisken
/// kart "yapilmamis" pozisyonuyla ayni gorunuyordu ("sanki hic islem yapmamis gibi").
pub const META_H2_LAST_IMPORT: &str = "h2_last_import";
/// H2'nin kurulum kaydindaki gorunen adi. H3'un kendi adi ("Arsiv-H3") bunu ICERMEZ →
/// kendi kurulumumuzu "onceki surum" sanmayiz (bkz `our_own_entry_is_not_matched`).
const H2_DISPLAY_NAME: &str = "ArchivistPro";

/// Kurulum kaydinin tarandigi kokler (64-bit · 32-bit · kullanici bazli).
const UNINSTALL_KEYS: &[&str] = &[
    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
    r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
];

/// Onceki surumun bu makinedeki durumu. Hepsi salt-gozlem; hicbiri eylem onermez —
/// ne yapilacagini UI (ve kullanici) soyler.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyArchiveDto {
    /// H2 programi SU AN kurulu mu (kurulum kaydinda gorundu mu).
    pub installed: bool,
    /// Kurulu ise surumu (or. `3.2.2`); okunamadiysa `None`.
    pub version: Option<String>,
    /// H2 veri klasoru — yalniz VARSA dolu. Kurulum kaldirilmis olsa da veri burada kalir.
    pub data_dir: Option<String>,
    /// Klasordeki arsiv veritabani sayisi (yardimci/sidecar dosyalar HARIC).
    pub archive_count: usize,
    /// O veritabanlarinin toplam boyutu (bayt).
    pub total_bytes: u64,
    /// Toplam dosya kaydi — **en iyi caba**. Okunamayan DB atlanir; hicbiri okunamazsa `None`
    /// (0 DEGIL: "sayamadim" ile "hic kayit yok" ayni sey degildir).
    pub asset_count: Option<i64>,
    /// Son basarili aktarimin ozeti (yoksa/okunamazsa `None`) — kart "yapilmis is" modunu
    /// bununla acar.
    pub last_import: Option<H2LastImportDto>,
}

/// Son H2 aktariminin kalici ozeti (`app_meta[h2_last_import]` JSON'u; camelCase IPC).
/// `apply` yazar, durum komutu okur — alan adlari serde uzerinden AYNI kaynaktan gelir.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct H2LastImportDto {
    /// Aktarim ani (unix saniye).
    pub ts: i64,
    /// Kaynak H2 veritabani yolu.
    pub source: String,
    pub inserted: i64,
    pub existing: i64,
    pub ai: i64,
    pub tags: i64,
}

/// `app_meta` JSON'unu tolerant coz: bozuk/eski bicim → `None` (durum komutu COKMEZ;
/// kart yalnizca "son aktarim" satirini gostermez).
pub(crate) fn parse_last_import(json: &str) -> Option<H2LastImportDto> {
    serde_json::from_str(json).ok()
}

/// Kurulum kaydindan ayiklanan bir aday girdi (ad eslesti; henuz "biz miyiz" suzgecinden gecmedi).
#[derive(Debug, Clone, PartialEq, Eq)]
struct UninstallEntry {
    name: String,
    version: Option<String>,
    install_location: Option<String>,
}

/// `reg query <kok> /s` ciktisindan `ArchivistPro` adli TUM girdileri ayikla.
///
/// Cikti bos satirla ayrilmis bloklardir: ilk satir anahtar, sonrakiler `  Ad    TUR    Deger`.
/// Deger ile tur arasinda **degisken sayida bosluk** olur → `split_whitespace` yerine tur
/// etiketinden SONRASINI aliriz (deger bosluk icerebilir: "ArchivistPro 3").
///
/// Saf fonksiyon: `reg` cagrisindan ayri → birim-testli (gpu.rs deseni).
fn parse_uninstall_dump(out: &str) -> Vec<UninstallEntry> {
    let mut found = Vec::new();
    for block in out.split("\r\n\r\n").flat_map(|b| b.split("\n\n")) {
        let mut name: Option<String> = None;
        let mut version: Option<String> = None;
        let mut install_location: Option<String> = None;
        for line in block.lines() {
            if let Some(v) = reg_value(line, "DisplayName") {
                name = Some(v);
            } else if let Some(v) = reg_value(line, "DisplayVersion") {
                version = Some(v);
            } else if let Some(v) = reg_value(line, "InstallLocation") {
                install_location = Some(v);
            }
        }
        if let Some(n) = name {
            if n.contains(H2_DISPLAY_NAME) {
                found.push(UninstallEntry { name: n, version, install_location });
            }
        }
    }
    found
}

/// Yol normalizasyonu — kayit degeri TIRNAKLI olabilir (NSIS oyle yazar; bu makinede olculdu:
/// `InstallLocation = "C:\...\ArchivistPro"`); ayrac/kucuk-buyuk farki esitligi bozmasin.
fn norm_dir(p: &str) -> String {
    // Cift-tirnak KARAKTER LITERALI yazilamaz: rbac_coverage kaynak-tarayicisinin string-maskesi
    // karakter literallerini islemez, icindeki tirnak dosyanin kalanini maskeler ve sonraki
    // komutlar taramadan kaybolurdu (2026-08-13'te yasandi). migration_tests deseni: char::from(34).
    let quote = char::from(34);
    p.trim().trim_matches(quote).replace('/', "\\").trim_end_matches('\\').to_lowercase()
}

/// **Bu girdi BIZ miyiz?** (2026-08-13 saha bulgusu: urun adi `ArchivistPro` olunca kendi
/// kurulum kaydimiz da ada eslesiyor; kart kendi kendini "onceki surum 3.3.1 kurulu" sandi.
/// Eski koruma testi "Arsiv-H3" adina goreydi — ad degisince bayatladi.)
/// Iki bagimsiz kimlik sinyali: ① InstallLocation == bizim exe klasoru (asil sinyal) ·
/// ② DisplayVersion == derlenen surum (yedek; H2 hatti 3.2.2'de kaldi, bizim surum her
/// pakette degisir → esitlik ancak kendimiz oluruz).
fn is_self_entry(e: &UninstallEntry, our_dir: Option<&str>, our_version: &str) -> bool {
    if let (Some(loc), Some(ours)) = (e.install_location.as_deref(), our_dir) {
        if norm_dir(loc) == norm_dir(ours) {
            return true;
        }
    }
    e.version.as_deref() == Some(our_version)
}

/// `  DisplayName    REG_SZ    ArchivistPro` → `ArchivistPro`. Ad eslesmezse `None`.
fn reg_value(line: &str, key: &str) -> Option<String> {
    let t = line.trim();
    let rest = t.strip_prefix(key)?;
    // Ad tam eslesmeli: "DisplayNameXYZ" bu dali gecmemeli.
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    // Tur etiketini atla (REG_SZ / REG_EXPAND_SZ / REG_DWORD …), kalani deger say.
    let rest = rest.trim_start();
    let (_, value) = rest.split_once(char::is_whitespace)?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

// Arsiv-dosyasi suzgeci artik crate cekirdeginde (`archivist_h2import::is_archive_db`) —
// tespit ve aktarim AYNI suzgeci kullanir (ayri yazilsalardi biri degisip digeri bayatlar,
// tespit ile sihirbaz farkli listeler gosterirdi). Asagidaki testler davranisi kilitler.

/// Bir H2 veritabanindaki dosya kaydi sayisi — **salt-okuma, en iyi caba**.
/// Sema farkli oldugu icin yalniz `count(*)` denenir (kolon adlari H3'ten farkli; `path` bile yok).
/// Acilamayan/`assets` tablosu olmayan dosya sessizce atlanir.
fn count_assets(db: &Path) -> Option<i64> {
    let uri = format!("file:{}?mode=ro", db.to_string_lossy().replace('\\', "/"));
    let conn = rusqlite::Connection::open_with_flags(
        uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .ok()?;
    conn.query_row("SELECT count(*) FROM assets", [], |r| r.get::<_, i64>(0)).ok()
}

/// Aday H2 arsivleri: config yonlendirmesi ∪ AppData taramasi (crate cekirdegi yapar;
/// sayim geri-cagrisi buradaki `count_assets`). VAR OLMAYAN config kayitlari da doner
/// (UI "tasinmis/eksik" gosterebilsin) — ozet sayilara girmezler.
fn candidates(dir: Option<&Path>) -> Vec<archivist_h2import::H2CandidateDb> {
    archivist_h2import::discover_candidates(dir, count_assets)
}

/// Ozet sayilar: yalniz VAR OLAN aday DB'ler uzerinden (arsiv sayisi, toplam bayt, kayit).
fn summarize(cands: &[archivist_h2import::H2CandidateDb]) -> (usize, u64, Option<i64>) {
    let (mut count, mut bytes, mut assets) = (0usize, 0u64, None::<i64>);
    for c in cands.iter().filter(|c| c.exists) {
        count += 1;
        bytes += c.size_bytes;
        if let Some(n) = c.asset_count {
            assets = Some(assets.unwrap_or(0) + n);
        }
    }
    (count, bytes, assets)
}

/// Kurulum kaydinda H2'yi ara. `reg` yoksa/hata verirse "kurulu degil" sayilir — tespit
/// BASARISIZLIGI kullaniciya hata olarak gosterilmez (bu bir teshis, bir on kosul degil).
/// Kendi kurulumumuz (ayni gorunen ad!) `is_self_entry` ile elenir.
fn find_installed() -> Option<(String, Option<String>)> {
    let our_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().to_string()));
    for key in UNINSTALL_KEYS {
        let Ok(out) = Command::new("reg").args(["query", key, "/s"]).output() else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        if let Some(e) = parse_uninstall_dump(&String::from_utf8_lossy(&out.stdout))
            .into_iter()
            .find(|e| !is_self_entry(e, our_dir.as_deref(), env!("CARGO_PKG_VERSION")))
        {
            return Some((e.name, e.version));
        }
    }
    None
}

/// Onceki surumu (H2 / ArchivistPro) ALGILA — kurulu mu, verisi duruyor mu (salt-okuma; her rol).
/// **Hicbir seyi degistirmez, kaldirmayi onermez.** Karsiligi olan tek eylem kullanicinin
/// bilgilendirilmesidir: H3 bu veriyi henuz okuyamaz, dolayisiyla H2 KALDIRILMAMALIDIR.
#[tauri::command]
pub fn legacy_archive_status(state: State<'_, AppState>) -> LegacyArchiveDto {
    let installed = find_installed();
    let dir: Option<PathBuf> = std::env::var("APPDATA")
        .ok()
        .map(|a| PathBuf::from(a).join(H2_DATA_DIR))
        .filter(|p| p.is_dir());

    let (archive_count, total_bytes, asset_count) = summarize(&candidates(dir.as_deref()));

    // Son aktarim ozeti — en iyi caba (kilit/okuma hatasi teshisi COKERTMEZ, satir gizlenir).
    let last_import = state
        .read_db
        .lock()
        .ok()
        .and_then(|db| db.get_meta(META_H2_LAST_IMPORT).ok().flatten())
        .and_then(|j| parse_last_import(&j));

    LegacyArchiveDto {
        installed: installed.is_some(),
        version: installed.and_then(|(_, v)| v),
        // Veri klasoru VARSA bildir — arsiv dosyasi bulunmasa bile (yedek/rapor klasorleri
        // orada olabilir; kullanici yolun kendisini gormeli).
        data_dir: dir.map(|p| p.to_string_lossy().to_string()),
        archive_count,
        total_bytes,
        asset_count,
        last_import,
    }
}

/// Aktarim sihirbazinin ADAY listesi — salt-okuma kesif (`legacy_archive_status` sinifi;
/// RBAC kapisi bilincli yok: hicbir sey degistirmez, veri icerigi tasimaz, yalniz yol/boyut/sayi).
/// VAR OLMAYAN config kayitlari da doner (UI "bulunamadi" gosterebilsin).
#[tauri::command]
pub fn h2_import_candidates() -> Vec<archivist_h2import::H2CandidateDb> {
    let dir: Option<PathBuf> = std::env::var("APPDATA")
        .ok()
        .map(|a| PathBuf::from(a).join(H2_DATA_DIR))
        .filter(|p| p.is_dir());
    candidates(dir.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use archivist_h2import::is_archive_db;

    /// Gercek `reg query <kok> /s` ciktisinin sekli (2026-08-09'da bu makinede dogrulandi: HKLM
    /// altinda 192 anahtar, bloklar CRLF bos satirla ayrilmis). H2 ORTADA duruyor — sonda DEGIL:
    /// blok ayrimi calismazsa "son DisplayName kazanir" ve yanlis surum eslesir.
    const DUMP: &str = "HKEY_LOCAL_MACHINE\\SOFTWARE\\...\\Uninstall\\{AAA}\r\n    \
        DisplayName    REG_SZ    Google Chrome\r\n    DisplayVersion    REG_SZ    1.0\r\n\r\n\
        HKEY_LOCAL_MACHINE\\SOFTWARE\\...\\Uninstall\\{BBB}\r\n    \
        DisplayName    REG_SZ    ArchivistPro\r\n    \
        DisplayVersion    REG_SZ    3.2.2\r\n    Publisher    REG_SZ    archivistpro\r\n\r\n\
        HKEY_LOCAL_MACHINE\\SOFTWARE\\...\\Uninstall\\{CCC}\r\n    \
        DisplayName    REG_SZ    Arsiv-H3\r\n    DisplayVersion    REG_SZ    0.1.3\r\n";

    #[test]
    fn finds_h2_entry_with_version() {
        let found = parse_uninstall_dump(DUMP);
        assert_eq!(found.len(), 1, "yalniz ArchivistPro adli blok eslesmelidir");
        assert_eq!(found[0].name, "ArchivistPro");
        // 3.2.2 — SONRAKI blogun surumu (0.1.3) DEGIL. Bu iddia blok ayrimini kilitler:
        // bloklar birlesirse buraya komsu programin surumu sizardi.
        assert_eq!(found[0].version.as_deref(), Some("3.2.2"));
    }

    /// Yalniz LF ile ayrilmis cikti da (farkli kabuk/yonlendirme) ayni sonucu vermeli.
    #[test]
    fn lf_only_dump_parses_too() {
        let lf = DUMP.replace("\r\n", "\n");
        let found = parse_uninstall_dump(&lf);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].version.as_deref(), Some("3.2.2"));
    }

    /// KRITIK (saha bulgusu 2026-08-13): urun adi `ArchivistPro` olali kendi kurulum kaydimiz da
    /// ada ESLESIR — ayirt etme artik ad ile DEGIL `is_self_entry` ile yapilir. Kart bu hatayla
    /// kendi kendini "onceki surum 3.3.1 kurulu" gostermisti (bu makinede olculdu).
    #[test]
    fn our_own_entry_is_filtered_as_self() {
        // Bu makinede olculen gercek bicim: InstallLocation TIRNAKLI yazilir.
        let ours = UninstallEntry {
            name: "ArchivistPro".into(),
            version: Some("9.9.9".into()), // surum farkli olsa bile...
            install_location: Some("\"C:\\Users\\ahmet\\AppData\\Local\\ArchivistPro\"".into()),
        };
        // ...konum bizim exe klasorumuzse BIZIZ (tirnak/ayrac/kucuk-buyuk normalize).
        assert!(is_self_entry(&ours, Some(r"c:\users\ahmet\appdata\local\archivistpro\"), "1.0.0"));
        // Konum bilinmiyorsa surum esitligi yakalar (H2 hatti 3.2.2'de kaldi).
        let no_loc = UninstallEntry { install_location: None, ..ours.clone() };
        assert!(is_self_entry(&no_loc, None, "9.9.9"));
        // GERCEK H2 (3.2.2, baska konum) kendimiz SAYILMAZ — tespit calismaya devam etmeli.
        let h2 = UninstallEntry {
            name: "ArchivistPro".into(),
            version: Some("3.2.2".into()),
            install_location: Some(r"C:\Program Files\ArchivistPro".into()),
        };
        assert!(!is_self_entry(&h2, Some(r"C:\Users\ahmet\AppData\Local\ArchivistPro"), "3.3.1"));
        // Eski ad "Arsiv-H3" zaten ada eslesmez (parse listeye almaz).
        let old = "HKEY\\...\\{CCC}\r\n    DisplayName    REG_SZ    Arsiv-H3\r\n    \
                   DisplayVersion    REG_SZ    0.1.3\r\n";
        assert!(parse_uninstall_dump(old).is_empty());
    }

    /// Iki `ArchivistPro` girdisi yan yana (bizimki + gercek H2): suzgec bizimkini eler,
    /// H2 bulunur — `find_installed`'in cekirdek karari.
    #[test]
    fn self_is_skipped_but_real_h2_is_found() {
        let dump = "HKEY\\...\\{H3}\r\n    DisplayName    REG_SZ    ArchivistPro\r\n    \
            DisplayVersion    REG_SZ    3.3.1\r\n    InstallLocation    REG_SZ    \
            \"C:\\Users\\ahmet\\AppData\\Local\\ArchivistPro\"\r\n\r\n\
            HKEY\\...\\{H2}\r\n    DisplayName    REG_SZ    ArchivistPro\r\n    \
            DisplayVersion    REG_SZ    3.2.2\r\n    InstallLocation    REG_SZ    \
            C:\\Program Files\\ArchivistPro\r\n";
        let ours = Some(r"C:\Users\ahmet\AppData\Local\ArchivistPro");
        let found: Vec<_> = parse_uninstall_dump(dump)
            .into_iter()
            .filter(|e| !is_self_entry(e, ours, "3.3.1"))
            .collect();
        assert_eq!(found.len(), 1, "yalniz gercek H2 kalmali");
        assert_eq!(found[0].version.as_deref(), Some("3.2.2"));
    }

    #[test]
    fn no_match_and_garbage_are_empty() {
        assert!(parse_uninstall_dump("").is_empty());
        assert!(parse_uninstall_dump("bos gurultu\r\nbaska satir").is_empty());
    }

    /// Deger bosluk iceriyorsa kesilmemeli; benzer-adli anahtar ("DisplayNameEx") yakalanmamali.
    #[test]
    fn reg_value_handles_spaces_and_exact_names() {
        assert_eq!(
            reg_value("    DisplayName    REG_SZ    ArchivistPro 3 Pro", "DisplayName").as_deref(),
            Some("ArchivistPro 3 Pro")
        );
        assert_eq!(reg_value("    DisplayNameEx    REG_SZ    X", "DisplayName"), None);
        assert_eq!(reg_value("    DisplayName    REG_SZ    ", "DisplayName"), None);
    }

    /// `app_meta` ozet JSON'u gidis-donus korunmali; bozuk/eski bicim None (kart cokmez).
    #[test]
    fn last_import_roundtrip_and_tolerant_parse() {
        let dto = H2LastImportDto {
            ts: 1_786_611_584,
            source: r"D:\Archivist\archivist_local.db".into(),
            inserted: 2233,
            existing: 39_449,
            ai: 252,
            tags: 0,
        };
        let json = serde_json::to_string(&dto).unwrap();
        assert_eq!(parse_last_import(&json), Some(dto));
        // camelCase IPC alanlari — frontend tipiyle ayni adlar (rename_all kaniti).
        assert!(json.contains("\"inserted\"") && json.contains("\"source\""));
        // Bozuk/eski bicimler sessizce None: kart "son aktarim" satirini gostermez, COKMEZ.
        assert_eq!(parse_last_import("bozuk"), None);
        assert_eq!(parse_last_import("{\"ts\":\"metin\"}"), None);
    }

    /// Sidecar/yandas dosyalar arsiv SAYILMAZ — yoksa tek arsiv dort dosya gibi gorunur ve
    /// kullaniciya sisirilmis bir rakam gider.
    #[test]
    fn only_real_archive_databases_are_counted() {
        assert!(is_archive_db("archivist.db"));
        assert!(is_archive_db("archivist_local.db"));
        assert!(is_archive_db("archive_be4300bf-9086-4ec2-9f89-f2ff58ea41e3.db"));
        // Gercek klasorde olculen yandaslar (2026-08-09):
        assert!(!is_archive_db("archivist_local_shapes.db"));
        assert!(!is_archive_db("archive_be4300bf-9086-4ec2-9f89-f2ff58ea41e3_shapes.db"));
        assert!(!is_archive_db("archivist.db.lock"));
        assert!(!is_archive_db("archivist.db-wal"));
        assert!(!is_archive_db("archivist.db-shm"));
        assert!(!is_archive_db("archivist_config.json"));
    }
}
