//! Slice 2 — `app_meta` KV erisimi + lokasyon-farkindalik yardimcilari.
//!
//! `app_meta` (migration 0001: `key PK, value NOT NULL`) basit anahtar/deger. Lokasyon
//! farkindaligi icin `archive_host` (arsivi indeksleyen makine adi) burada tutulur.
//! `sample_asset_paths`: acilista "kaynak dosyalar bu makinede mi" kontrolu icin birkac asset
//! yolu ornegi (komut katmani `Path::exists` ile dogrular → "uzak lokasyon / onizleme" banner).

use rusqlite::OptionalExtension;

use crate::error::DbError;
use crate::Db;

/// `app_meta` anahtari: arsivi (ilk) indeksleyen makine adi (kaynak dosyalarin "evi").
pub const META_ARCHIVE_HOST: &str = "archive_host";

impl Db {
    /// `app_meta`'dan bir deger oku (yoksa `None`).
    pub fn get_meta(&self, key: &str) -> Result<Option<String>, DbError> {
        Ok(self
            .conn
            .query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| r.get(0))
            .optional()?)
    }

    /// `app_meta`'ya bir deger yaz — varsa UZERINE yaz (UPSERT; `key` PRIMARY KEY).
    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO app_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    /// En fazla `limit` AKTIF (`deleted_at IS NULL`) asset yolu ornegi — lokasyon-erisim
    /// kontrolu icin (cagiran `Path::exists` ile bakar). `id` sirasi yeter (deterministik
    /// gereksiz). `limit <= 0` veya bos arsiv → bos vec.
    pub fn sample_asset_paths(&self, limit: i64) -> Result<Vec<String>, DbError> {
        if limit <= 0 {
            return Ok(Vec::new());
        }
        let mut stmt = self
            .conn
            .prepare("SELECT path FROM assets WHERE deleted_at IS NULL ORDER BY id LIMIT ?1")?;
        let rows = stmt
            .query_map([limit], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}
