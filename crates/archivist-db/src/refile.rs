//! Refile — yerinde tasima/yeniden-adlandirma icin DB yol senkronu.
//!
//! **Kritik: refile RE-INGEST DEGIL.** İngest `ON CONFLICT(path)` ile anahtarlandigindan
//! tasinmis/yeniden-adlandirilmis bir dosyayi naif re-ingest **YENI asset id** yaratir →
//! etiket/iliski/thumbnail/vektor/metadata hepsi kopar. Cozum: yerinde
//! `UPDATE assets SET path/file_name/ext WHERE id=?`. `content_hash` (BLAKE3) DEGISMEZ
//! (yalniz yol degisir, icerik degil → re-hash YOK). `asset_id`'ye bagli her sey
//! (thumbnail/vektor/etiket/iliski/metadata) DOKUNULMAZ. FTS `file_name`'i UPDATE
//! trigger'i (`assets_fts_au`) otomatik senkronlar. `modified_at` da dokunulmaz (yol
//! tasimasi dosyanin icerik-degisiklik zamani degildir).

use rusqlite::{params, ErrorCode, OptionalExtension};

use crate::error::DbError;
use crate::Db;

/// Refile'a ozgu tipli hata — komut katmani bunlari ayri hata koduna cevirir
/// (`NotFound` → `not_found`, `Conflict` → `db_conflict`).
#[derive(Debug)]
pub enum RefileError {
    /// Asset yok veya cop'te (`deleted_at` dolu) → refile edilemez.
    NotFound,
    /// Hedef yol zaten baska bir asset'e (aktif VEYA cop) ait → UNIQUE(path) ihlali.
    Conflict,
    /// Diger DB hatasi (sqlite/io).
    Db(DbError),
}

impl std::fmt::Display for RefileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RefileError::NotFound => write!(f, "asset bulunamadi"),
            RefileError::Conflict => write!(f, "hedef yol zaten kayitli"),
            RefileError::Db(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for RefileError {}

impl From<DbError> for RefileError {
    fn from(e: DbError) -> Self {
        RefileError::Db(e)
    }
}

impl Db {
    /// Bir asset'in yolunu **yerinde** guncelle (tasima/yeniden-adlandirma sonrasi DB senkronu).
    /// Donen `String` = **eski yol** (komut katmani disk-rollback icin kullanir).
    ///
    /// `new_path`'ten `file_name` + `ext` ingest ile AYNI sekilde turetilir (dosya adi = son
    /// yol-ayracindan sonrasi; ext = adin son noktasindan sonrasi, ASCII-kucuk-harf; gizli
    /// dosya/noktasi olmayan → ext yok). `content_hash`/`modified_at` DOKUNULMAZ.
    ///
    /// Hatalar: asset yok/cop'te → [`RefileError::NotFound`]; hedef yol baska asset'te
    /// (UNIQUE ihlali) → [`RefileError::Conflict`].
    pub fn refile_asset(&self, id: i64, new_path: &str) -> Result<String, RefileError> {
        // 1. Eski yolu oku (yalniz aktif asset). Yoksa → NotFound (disk'e dokunmadan once).
        let old_path: Option<String> = self
            .conn
            .query_row(
                "SELECT path FROM assets WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                |r| r.get(0),
            )
            .optional()
            .map_err(DbError::from)?;
        let old_path = old_path.ok_or(RefileError::NotFound)?;

        // 2. Yeni yoldan ad + uzanti turet (ingest normalize deseniyle birebir).
        let file_name = file_name_of(new_path);
        let ext = derive_ext(file_name);

        // 3. Yerinde UPDATE — content_hash/modified_at'e DOKUNMA. UNIQUE(path) ihlali → Conflict.
        match self.conn.execute(
            "UPDATE assets SET path = ?1, file_name = ?2, ext = ?3
             WHERE id = ?4 AND deleted_at IS NULL",
            params![new_path, file_name, ext, id],
        ) {
            Ok(_) => Ok(old_path),
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.code == ErrorCode::ConstraintViolation =>
            {
                Err(RefileError::Conflict)
            }
            Err(e) => Err(RefileError::Db(DbError::Sqlite(e))),
        }
    }
}

/// Bir tam yoldan **dosya adini** al (son `/` veya `\` ayracindan sonrasi). Her iki ayraci da
/// ele alir (Windows + POSIX; yollar farkli OS'tan gelmis olabilir → `std::path` KULLANILMAZ,
/// query.rs `parent_dir` ile ayni gerekce). Ayrac yoksa yol aynen (ciplak ad).
fn file_name_of(path: &str) -> &str {
    match path.rfind(['/', '\\']) {
        Some(i) => &path[i + 1..],
        None => path,
    }
}

/// Dosya adindan **normalize uzanti** turet — ingest (`pipeline.rs`: `Path::extension()` +
/// `to_ascii_lowercase`) ile ayni semantik: son noktadan sonrasi, ASCII-kucuk-harf. Nokta yok
/// VEYA yalniz basta nokta (gizli dosya, or. `.gitignore`) → uzanti yok (`None`).
fn derive_ext(file_name: &str) -> Option<String> {
    match file_name.rfind('.') {
        Some(dot) if dot > 0 => Some(file_name[dot + 1..].to_ascii_lowercase()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{derive_ext, file_name_of};

    #[test]
    fn file_name_of_handles_both_separators() {
        assert_eq!(file_name_of(r"C:\a\b\1.dwg"), "1.dwg");
        assert_eq!(file_name_of("/a/b/2.pdf"), "2.pdf");
        assert_eq!(file_name_of(r"C:\a/b\3.dxf"), "3.dxf"); // karisik ayrac
        assert_eq!(file_name_of("ciplak.txt"), "ciplak.txt"); // ayrac yok
        assert_eq!(file_name_of("/kok.txt"), "kok.txt");
    }

    #[test]
    fn derive_ext_matches_ingest_normalize() {
        // Son noktadan sonrasi, kucuk-harf.
        assert_eq!(derive_ext("villa.DWG").as_deref(), Some("dwg"));
        assert_eq!(derive_ext("plan.tar.GZ").as_deref(), Some("gz"));
        // Nokta yok → uzanti yok.
        assert_eq!(derive_ext("README"), None);
        // Gizli dosya (basta nokta, baska yok) → uzanti yok (Path::extension semantigi).
        assert_eq!(derive_ext(".gitignore"), None);
        // Basta nokta ama icte de nokta var → son parca uzanti.
        assert_eq!(derive_ext(".env.local").as_deref(), Some("local"));
        // Sonda nokta → bos uzanti (Path::extension parite).
        assert_eq!(derive_ext("foo.").as_deref(), Some(""));
    }
}
