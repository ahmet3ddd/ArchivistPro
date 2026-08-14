//! Veri katmani hata tipi. Harici hata-makrosu bagimliligi yok (deps minimal).

use std::fmt;

#[derive(Debug)]
pub enum DbError {
    /// rusqlite/SQLite kaynakli hata.
    Sqlite(rusqlite::Error),
    /// Migration runner kaynakli hata (versiyon/uygulama/dogrulama).
    Migration(String),
    /// Dosya/yol kaynakli hata.
    Io(std::io::Error),
    /// Gecersiz cagiran girdisi (or. bos koleksiyon adi) — SQL'e gitmeden reddedilir.
    Invalid(String),
    /// Uzun hesap KULLANICI TARAFINDAN iptal edildi (hata DEGIL, ama "sonuc yok" da degil).
    ///
    /// Ayri varyant olmasi sart: iptal edilen tarama bos liste dondurseydi UI bunu *"kopya
    /// bulunamadi"* diye gosterirdi — sessiz yanlis cevap. Cagiran bunu ayirir ve kullaniciya
    /// "iptal edildi" der. (2026-07-28 UI/UX denetimi Y1.)
    Cancelled,
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Sqlite(e) => write!(f, "sqlite: {e}"),
            DbError::Migration(m) => write!(f, "migration: {m}"),
            DbError::Io(e) => write!(f, "io: {e}"),
            DbError::Invalid(m) => write!(f, "gecersiz: {m}"),
            DbError::Cancelled => write!(f, "iptal edildi"),
        }
    }
}

impl std::error::Error for DbError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DbError::Sqlite(e) => Some(e),
            DbError::Io(e) => Some(e),
            DbError::Migration(_) | DbError::Invalid(_) | DbError::Cancelled => None,
        }
    }
}

impl From<rusqlite::Error> for DbError {
    fn from(e: rusqlite::Error) -> Self {
        DbError::Sqlite(e)
    }
}

impl From<std::io::Error> for DbError {
    fn from(e: std::io::Error) -> Self {
        DbError::Io(e)
    }
}
