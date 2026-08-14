//! Ozyineli dosya taramasi — gizli (`.` ile baslayan) girdileri budar. Budanan/atlanan
//! girdiler **sebebiyle** kaydedilir ([`ScanResult::skipped`]) → tarama raporu "atlanan" bolumu
//! (④-C: atlanan-sebep yakalama). Bu girdiler `files`'a GIRMEZ (indekslenmez).

use std::cell::RefCell;
use std::path::{Path, PathBuf};

use walkdir::{DirEntry, WalkDir};

/// Bir girdinin neden ATLANDIGI (walker seviyesi; indekslenmedi). Frontend i18n'i icin
/// [`SkipReason::code`] kararli bir anahtar doner (`ingest.skipReason.<code>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// Gizli (`.` ile baslayan) dosya/dizin — budandi. Dizinse tum alt-agaci da atlanir
    /// (girdi bir kez kaydedilir, icerigi ayrica kaydedilmez).
    Hidden,
    /// Girdi okunamadi (izin reddi / IO hatasi). Bir DIZIN icin: o alt-agac taranAMAMIS
    /// olabilir → kullanici kapsam boslugunu gorur (H2'de tamamen gorunmezdi).
    Unreadable,
    /// Sembolik baglanti — izlenmez (WalkDir varsayilan `follow_links=false`; dongu/guvenlik)
    /// → hedefi indekslenmez.
    Symlink,
    /// **Isletim sistemi artigi** (`Thumbs.db`, `desktop.ini`) — arsiv icerigi degil, klasor
    /// gorunum/onizleme onbellegi. Bkz [`OS_JUNK_NAMES`].
    SystemFile,
}

impl SkipReason {
    /// Frontend i18n anahtari icin kararli kod (`ingest.skipReason.<code>`). Rust UI dilini
    /// bilmez → yalniz kod tasir; yerellestirme renderer'da (konvansiyon: i18n uzerinden).
    pub fn code(self) -> &'static str {
        match self {
            SkipReason::Hidden => "hidden",
            SkipReason::Unreadable => "unreadable",
            SkipReason::Symlink => "symlink",
            SkipReason::SystemFile => "system_file",
        }
    }
}

/// Indekslenmeyecek **isletim sistemi artiklari** (tam ad esleme, buyuk/kucuk harf duyarsiz).
///
/// **Neden (2026-07-28 §7 olcumu, kullanici karari):** gercek arsivde (52 671 dosya) 476 tanesi
/// bu ucluydu — `Thumbs.db` 326 · `Desktop_.ini` 148 · `desktop.ini` 2. Bunlar arsiv icerigi
/// degil; Windows'un klasor gorunum ayari ve onizleme onbellegi. Indekslenince arama/liste
/// sonuclarini kirletiyor, thumbnail/cikarim isi tuketiyorlardi.
///
/// ⚠️ **`Desktop_.ini`** (alt cizgili) ayni artefaktin bir varyantidir (kopyalama/yedekleme
/// araclarinin urettigi ad) — olcumde 148 adet cikti, bu yuzden listede.
///
/// ⚠️ **`.dwl` / `.dwl2` KASTEN LISTEDE DEGIL** (kullanici karari): bunlar AutoCAD kilit
/// dosyalari ama H3 onlari **bilerek** indeksler — `archivist-db/src/relations/detect.rs`
/// sidecar eslemesi (`plan.dwl` → `plan.dwg`) bu kayitlara dayanir. Elenirlerse o ozellik bozulur.
///
/// **Sessiz DEGIL:** elenen her girdi [`SkipReason::SystemFile`] ile rapora yazilir ve UI'da
/// `ingest.skipReason.system_file` ile yerellestirilir (H3 disiplini: kapsam daraltan her sapma
/// gorunur olur).
pub const OS_JUNK_NAMES: &[&str] = &["thumbs.db", "desktop.ini", "desktop_.ini"];

/// Girdi adi bir isletim sistemi artigi mi (bkz [`OS_JUNK_NAMES`]). Windows dosya adlari
/// buyuk/kucuk harf duyarsiz → karsilastirma da oyle.
fn is_os_junk(entry: &DirEntry) -> bool {
    entry
        .file_name()
        .to_str()
        .is_some_and(|s| OS_JUNK_NAMES.contains(&s.to_ascii_lowercase().as_str()))
}

/// [`scan_files`] sonucu: indekslenecek dosyalar + walker seviyesinde ATLANAN girdiler (sebep).
pub struct ScanResult {
    /// Indekslenecek duz dosyalar (ozyineli; gizli/sembolik/okunamayan HARIC).
    pub files: Vec<PathBuf>,
    /// Atlanan girdiler `(yol, sebep)` — indekslenMEDI. Tarama raporunda yuzeye cikar.
    pub skipped: Vec<(PathBuf, SkipReason)>,
}

/// `.` ile baslayan girdi mi (gizli dosya/dizin — `.git`, `.DS_Store`...).
fn is_hidden(entry: &DirEntry) -> bool {
    entry.file_name().to_str().is_some_and(|s| s.starts_with('.'))
}

/// `root` altindaki tum dosyalari (ozyineli) topla; gizli dizinler budanir. Budanan/atlanan
/// girdiler sebebiyle [`ScanResult::skipped`]'a yazilir (④-C).
///
/// Kok (depth 0) ASLA budanmaz — kullanicinin sectigi klasor `.` ile baslasa bile
/// (or. temp dizinleri) icindeki dosyalar taranir.
///
/// **Gizli budama davranisi KORUNUR:** orijinal `filter_entry(depth==0 || !is_hidden)`
/// predikati AYNEN kullanilir (gizli dizin → alt-agac inilmez); ek olarak budanan girdi
/// bir kez kaydedilir (icerigi budandigi icin ayrica kaydedilmez). Sembolik baglanti ve
/// walker hatasi (okunamayan) dongu govdesinde yakalanir.
pub fn scan_files(root: &Path) -> ScanResult {
    let mut files: Vec<PathBuf> = Vec::new();
    let mut skipped: Vec<(PathBuf, SkipReason)> = Vec::new();

    // Gizli budama (kok haric): orijinal filter_entry davranisi + budanan girdiyi kaydet.
    // filter_entry predikati budanan (false donen) girdinin ALTINA inmez → gizli dizin BIR KEZ
    // kaydedilir, icerigi ziyaret edilmez. RefCell: predikat yan-etkiyle yol biriktirir (borrow
    // yalniz iterasyon boyu; reentrant degil).
    let pruned: RefCell<Vec<(PathBuf, SkipReason)>> = RefCell::new(Vec::new());
    let walker = WalkDir::new(root).into_iter().filter_entry(|e| {
        if e.depth() > 0 && is_hidden(e) {
            pruned.borrow_mut().push((e.path().to_path_buf(), SkipReason::Hidden));
            false
        } else {
            true
        }
    });

    for entry in walker {
        match entry {
            Ok(e) => {
                let ft = e.file_type();
                if ft.is_file() {
                    // Isletim sistemi artigi (Thumbs.db / desktop.ini) → indekslenmez ama
                    // SESSIZ degil: sebebiyle rapora yazilir.
                    if is_os_junk(&e) {
                        skipped.push((e.into_path(), SkipReason::SystemFile));
                    } else {
                        files.push(e.into_path());
                    }
                } else if ft.is_symlink() {
                    // WalkDir sembolik baglantiyi izlemez → is_file()==false, is_symlink()==true.
                    skipped.push((e.into_path(), SkipReason::Symlink));
                }
                // Duz dizin: normal gezinme (atlanan degil) → kayit yok.
            }
            Err(err) => {
                // Okunamayan girdi (izin/IO). Yolu varsa onu, yoksa kok'u kaydet (walkdir hata
                // yolu tasiyabilir); tarama DURMAZ (sonraki girdilerle devam eder).
                let path = err.path().map(Path::to_path_buf).unwrap_or_else(|| root.to_path_buf());
                skipped.push((path, SkipReason::Unreadable));
            }
        }
    }

    // Gizli budamalar (predikat) + walker skip'lerini birlestir. Deterministik: once gizli.
    let mut all_skipped = pruned.into_inner();
    all_skipped.append(&mut skipped);
    ScanResult { files, skipped: all_skipped }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_files_skips_hidden() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("a.txt"), b"x").unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/b.csv"), b"y").unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::write(root.join(".git/cfg"), b"z").unwrap();
        fs::write(root.join(".hidden"), b"h").unwrap();

        let res = scan_files(root);
        let names: Vec<String> =
            res.files.iter().filter_map(|p| p.file_name()?.to_str().map(String::from)).collect();
        assert!(names.contains(&"a.txt".to_string()));
        assert!(names.contains(&"b.csv".to_string()));
        assert!(!names.iter().any(|n| n == "cfg"), "gizli dizin budanmali");
        assert!(!names.iter().any(|n| n == ".hidden"), "gizli dosya atlanmali");

        // ④-C: budanan gizli girdiler sebebiyle kaydedilmeli (gizli dosya + gizli dizin = 2).
        let hidden: Vec<&PathBuf> = res
            .skipped
            .iter()
            .filter(|(_, r)| *r == SkipReason::Hidden)
            .map(|(p, _)| p)
            .collect();
        assert_eq!(hidden.len(), 2, "gizli dosya + gizli dizin kaydedilmeli: {:?}", res.skipped);
        // Alt-agac budandi: .git/cfg ne files'ta ne de skipped'ta ayrica kaydedilmemeli.
        assert!(
            !res.skipped.iter().any(|(p, _)| p.file_name().is_some_and(|n| n == "cfg")),
            "budanan gizli dizinin icerigi ayrica kaydedilmemeli"
        );
        assert!(res.skipped.iter().all(|(_, r)| *r == SkipReason::Hidden), "tumu hidden olmali");
    }

    /// §7 (2026-07-28 kullanici karari): OS artiklari indekslenmez ama SESSIZ de dusmez.
    #[test]
    fn skips_os_junk_but_reports_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("plan.dwg"), b"cad").unwrap();
        fs::write(root.join("Thumbs.db"), b"t").unwrap();
        fs::write(root.join("desktop.ini"), b"d").unwrap();
        fs::write(root.join("Desktop_.ini"), b"d2").unwrap();
        // Buyuk/kucuk harf duyarsiz olmali (Windows dosya adi semantigi).
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/THUMBS.DB"), b"t2").unwrap();

        let res = scan_files(root);
        let names: Vec<String> =
            res.files.iter().filter_map(|p| p.file_name()?.to_str().map(String::from)).collect();
        assert_eq!(names, vec!["plan.dwg".to_string()], "yalniz gercek icerik indekslenmeli");

        let junk: Vec<&PathBuf> = res
            .skipped
            .iter()
            .filter(|(_, r)| *r == SkipReason::SystemFile)
            .map(|(p, _)| p)
            .collect();
        assert_eq!(junk.len(), 4, "4 artik da sebebiyle raporlanmali: {:?}", res.skipped);
    }

    /// AutoCAD kilit dosyalari KASTEN elenmez — relations sidecar eslemesi onlara dayanir.
    #[test]
    fn keeps_autocad_lock_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::write(root.join("plan.dwg"), b"cad").unwrap();
        fs::write(root.join("plan.dwl"), b"lock").unwrap();
        fs::write(root.join("plan.dwl2"), b"lock2").unwrap();

        let res = scan_files(root);
        let names: Vec<String> =
            res.files.iter().filter_map(|p| p.file_name()?.to_str().map(String::from)).collect();
        assert!(names.contains(&"plan.dwl".to_string()), ".dwl indekslenmeye devam etmeli");
        assert!(names.contains(&"plan.dwl2".to_string()), ".dwl2 indekslenmeye devam etmeli");
        assert!(res.skipped.is_empty(), "hicbiri atlanmamali: {:?}", res.skipped);
    }
}
