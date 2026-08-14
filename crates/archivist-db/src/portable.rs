//! Cok-arsiv tasima (portable export/import) icin SAF DB yardimcilari — Dilim 1.
//!
//! Amac: bir arsivi (ham SQLite konteyner) BASKA bir makineye tasirken kaynak
//! dosya yollari degisir (or. `C:\Projeler\...` → `E:\Arsiv\...`). Import semantigi
//! **butun-DB REPLACE** (merge YOK; `Db::restore_from` — Dilim 2). Bu modul yalniz
//! REPLACE oncesi/sonrasi gereken SAF veri islemlerini saglar; komut/paketleme yok:
//!
//! - **remap_paths:** makine-arasi YOL-REMAP — bir kok on-ekiyle baslayan TUM asset
//!   yollarini yeni koke tasir (cop dahil; geri gelirse yol dogru kalsin).
//! - **scan_roots / count_active_assets:** manifest (`app_meta` `export_*` — Dilim 2)
//!   icin kaynak-kokler + aktif asset sayisi ozeti (sourceRoots).
//! - **path_root / common_prefix:** saf string yardimcilari (kok cikarma + H2
//!   samplePathPrefix geri-dusus mantigi); OS'tan bagimsiz, deterministik.
//!
//! Not (H2 dersi): yollar farkli OS'tan gelmis olabilir → `std::path` KULLANILMAZ
//! (calisan OS'a bagli). Ayrac cozumu her platformda tutarli olsun diye `\` ve `/`
//! elle ele alinir (query.rs::parent_dir ile ayni yaklasim).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::error::DbError;
use crate::query::escape_like_prefix;
use crate::Db;

/// Bir kaynak-kok (surucu/UNC + ilk klasor segmenti) altindaki AKTIF asset sayisi.
/// Dilim 2 bunu manifest `sourceRoots` alanina koyar. IC tip → `camelCase` gereksiz;
/// yine de manifest'e serilesip geri okunacagindan `Serialize` + `Deserialize` turer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RootStat {
    /// Kok yolu (or. `C:\Projeler`, `\\server\share`).
    pub path: String,
    /// Bu kok altindaki aktif (cop'te olmayan) asset sayisi.
    pub count: i64,
}

impl Db {
    /// Makine-arasi YOL-REMAP: `old_prefix` ile baslayan TUM asset yollarini yeni koke
    /// tasi. Yeni yol = `new_prefix` + (eski yolun on-ekten SONRAKI kismi). Etkilenen
    /// satir sayisini doner.
    ///
    /// **Cop dahil (`deleted_at` filtresi YOK):** cop'teki asset'in yolu da tasinir →
    /// geri yuklenirse yeni makinede dogru yola isaret eder.
    ///
    /// Uygulama ayrintilari:
    /// - `substr(path, old_len + 1)`: SQLite `substr` **1-tabanli KARAKTER** indeksidir
    ///   (bayt DEGIL). Bu yuzden `old_len` = `old_prefix.chars().count()` (kaydedilmis
    ///   yolun bayt uzunlugu degil) → ilk `old_len` KARAKTER atilir, suffix aynen kalir.
    /// - `pat` = `escape_like_prefix(old_prefix)` + `%`; `ESCAPE '\'` ile joker
    ///   (`%`/`_`/`\`) literal eslesir (query.rs ile ayni kacis + ayni escape karakteri).
    ///
    /// **Windows / LIKE case-INSENSITIVE notu:** SQLite `LIKE` ASCII icin varsayilan
    /// buyuk/kucuk-harf DUYARSIZ → `C:\Foo%` deseni `c:\foo...`'yu da yakalar. Ama
    /// `substr(path, old_len + 1)` gercek saklanan yolun karakter uzunlugundan BAGIMSIZ
    /// ilk `old_len` karakteri atar → case farki olsa bile (prefix uzunluklari esit
    /// oldugu surece) suffix dogru korunur; sonuca yalniz `new_prefix`'in verilen yazimi
    /// yansir. Kok-siniri (kardes on-ek karismasi) CAGIRANIN sorumlulugu: `old_prefix`'i
    /// gerekiyorsa ayracla bitir (or. `C:\Eski` yerine `C:\Eski\`).
    ///
    /// **UNIQUE:** `assets.path` UNIQUE. On-ek-remap suffix'leri korudugundan normalde
    /// cakisma olmaz; olasi bir UNIQUE ihlali `?` ile `DbError`'a yayilir (ozel ele alma yok).
    pub fn remap_paths(&self, old_prefix: &str, new_prefix: &str) -> Result<usize, DbError> {
        let old_len = old_prefix.chars().count() as i64;
        let pat = format!("{}%", escape_like_prefix(Some(old_prefix)).unwrap_or_default());
        let n = self.conn.execute(
            "UPDATE assets SET path = ?1 || substr(path, ?2 + 1)
             WHERE path LIKE ?3 ESCAPE '\\'",
            rusqlite::params![new_prefix, old_len, pat],
        )?;
        Ok(n)
    }

    /// Manifest `sourceRoots` icin: AKTIF (`deleted_at IS NULL`) asset yollarini
    /// **kok** (surucu/UNC + ilk klasor segmenti) bazinda grupla + say. Deterministik,
    /// `path` ASC sirali (`BTreeMap` → siralama bedava).
    ///
    /// SQL'de karmasik gruplama YAPILMAZ (kok cikarma OS'a bagli olmayan saf string isi):
    /// yalniz `path` satirlari akitilir, `path_root` ile Rust'ta gruplanir. Yalniz string
    /// tutulur → asset sayisiyla degil, ayri-kok sayisiyla sinirli bellek. (1M smoke bunu
    /// CAGIRMAZ; export nadir ve etkilesimli bir islem.)
    pub fn scan_roots(&self) -> Result<Vec<RootStat>, DbError> {
        let mut counts: BTreeMap<String, i64> = BTreeMap::new();
        {
            let mut stmt = self
                .conn
                .prepare("SELECT path FROM assets WHERE deleted_at IS NULL")?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let path: String = row.get(0)?;
                *counts.entry(path_root(&path)).or_insert(0) += 1;
            }
        }
        Ok(counts
            .into_iter()
            .map(|(path, count)| RootStat { path, count })
            .collect())
    }

    /// AKTIF (`deleted_at IS NULL`) asset sayisi — manifest ozeti (Dilim 2). Ayni sorgu
    /// zaten `Db::asset_count` (lib.rs) ile TEK dogruluk noktasinda tanimli; burada export
    /// alan-adiyla ona delege edilir (SQL kopyalanmaz).
    pub fn count_active_assets(&self) -> Result<i64, DbError> {
        self.asset_count()
    }
}

/// Bir tam yoldan **kok**u cikar: surucu/UNC + ilk klasor segmenti. Windows-oncelikli
/// ama hem `\` hem `/` ayrac. Ayraclar normalize EDILMEZ; orijinal yazimi korumak icin
/// yolun uygun on-eki DILIMLENIR (karisik ayrac / case oldugu gibi kalir). Saf,
/// string-only, deterministik. Kurallar:
/// - **(a) UNC** (`\\server\share\...`) → `\\server\share` (iki lider ayrac + iki segment).
/// - **(b) surucu/segmentli** (`C:\ilk\...`) → `C:\ilk` (ilk klasor segmenti varsa).
/// - **(c) surucu-kok-only** (`C:\a.txt` — ilk ayractan sonra baska ayrac yok) → `C:\`
///   (ilk ayrac dahil; tek yaprak dosya klasor sayilmaz).
/// - **(d) ayracsiz** (`dosya.txt`) → yolun kendisi.
fn path_root(path: &str) -> String {
    const SEPS: [char; 2] = ['\\', '/'];
    let bytes = path.as_bytes();
    let is_sep = |b: u8| b == b'\\' || b == b'/';

    // (a) UNC: iki lider ayrac → kok = \\server\share (lider iki ayractan sonraki iki segment).
    if bytes.len() >= 2 && is_sep(bytes[0]) && is_sep(bytes[1]) {
        // server sonu = lider iki ayractan sonraki ilk ayrac.
        let Some(srv_rel) = path[2..].find(SEPS) else {
            return path.to_string(); // yalniz \\server (ayrac yok) → kendisi
        };
        let server_end = 2 + srv_rel;
        // share sonu = server ayracindan sonraki ilk ayrac.
        return match path[server_end + 1..].find(SEPS) {
            Some(shr_rel) => path[..server_end + 1 + shr_rel].to_string(),
            None => path.to_string(), // \\server\share (sonrasi yok) → kendisi
        };
    }

    // (b/c/d) surucu veya normal yol: ilk ayrac + (varsa) ikinci ayrac.
    let Some(first) = path.find(SEPS) else {
        return path.to_string(); // (d) ayrac yok → kendisi
    };
    match path[first + 1..].find(SEPS) {
        Some(rel) => path[..first + 1 + rel].to_string(), // (b) C:\ilk
        None => path[..=first].to_string(),               // (c) C:\  (ilk ayrac dahil)
    }
}

/// Verilen yollarin en uzun ORTAK **KARAKTER** on-eki (H2 samplePathPrefix geri-dusus).
/// Bos liste → `""`; tek eleman → kendisi. Char-tabanli (UTF-8 guvenli), saf, deterministik.
///
/// `pub`: manifest'in tek "ornek yol on-eki" alanini ureten Dilim 2 (AYRI komut crate'i)
/// bu saf yardimciyi cagirir → crate disina acik olmali. `path_root` (kok cikarma) `scan_roots`
/// tarafindan ic kullanilir → o modul-ozel kalir.
pub fn common_prefix(paths: &[String]) -> String {
    let Some(first) = paths.first() else {
        return String::new();
    };
    let mut common_chars = first.chars().count();
    for p in &paths[1..] {
        let shared = first
            .chars()
            .zip(p.chars())
            .take_while(|(a, b)| a == b)
            .count();
        if shared < common_chars {
            common_chars = shared;
        }
        if common_chars == 0 {
            break;
        }
    }
    first.chars().take(common_chars).collect::<String>()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `path_root`: UNC · surucu+segment · surucu-kok-only · ayracsiz · forward-slash.
    #[test]
    fn path_root_extracts_drive_or_unc_root() {
        // (a) UNC → \\server\share.
        assert_eq!(path_root(r"\\server\share\folder\file.dwg"), r"\\server\share");
        // UNC on-ek yalniz \\server\share (sonrasi yok) → kendisi.
        assert_eq!(path_root(r"\\server\share"), r"\\server\share");
        // (b) surucu + ilk segment.
        assert_eq!(path_root(r"C:\Projeler\Arsiv\a.dwg"), r"C:\Projeler");
        assert_eq!(path_root(r"C:\Projeler\Foo\b.dwg"), r"C:\Projeler");
        // (c) surucu-kok-only (ilk ayractan sonra ayrac yok) → C:\ (ilk ayrac dahil).
        assert_eq!(path_root(r"C:\a.txt"), r"C:\");
        // (d) ayracsiz → kendisi.
        assert_eq!(path_root("dosya.txt"), "dosya.txt");
        assert_eq!(path_root(""), "");
        // forward-slash (ayrac normalize edilmez, orijinal yazim korunur).
        assert_eq!(path_root("C:/Projeler/x/a.dwg"), "C:/Projeler");
        assert_eq!(path_root("/mnt/data/x.txt"), "/mnt");
        assert_eq!(path_root("/tek.txt"), "/");
    }

    /// `common_prefix`: ortak var · tek eleman · bos · hic-ortak-yok.
    #[test]
    fn common_prefix_longest_shared_chars() {
        // Ortak on-ek (yaprak isimden once).
        assert_eq!(
            common_prefix(&[r"C:\A\1".to_string(), r"C:\A\2".to_string()]),
            r"C:\A\"
        );
        // Tek eleman → kendisi.
        assert_eq!(common_prefix(&[r"C:\only\x".to_string()]), r"C:\only\x");
        // Bos liste → "".
        assert_eq!(common_prefix(&[]), "");
        // Hic ortak yok → "".
        assert_eq!(common_prefix(&["abc".to_string(), "xyz".to_string()]), "");
        // Kismi ortak (ilk karakter).
        assert_eq!(common_prefix(&["kar".to_string(), "kalem".to_string()]), "ka");
    }
}
