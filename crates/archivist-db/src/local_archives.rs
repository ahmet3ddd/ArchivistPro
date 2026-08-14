//! Adlandirilmis eszamanli YEREL arsiv REGISTRY'si (data katmani).
//!
//! Her yerel arsiv, birbirinden VERI-IZOLE tam bagimsiz bir SQLite dosyasidir (kendi
//! assets/tags/vektor/RAG'i). Bu modul, ANA arsivde (main) tutulan DEFTER uzerinde saf
//! CRUD sunar: hangi ek arsivler var, adlari/renkleri/goreli dosya yollari. **Arsiv
//! dosyalarini ACMA/GECIS/uretme ust katmandadir** (`src-tauri/archive_commands.rs`); bu
//! katman yalniz registry satirlarini yonetir (db ONNX/FS'ten bagimsiz, temiz katman).
//!
//! ANA arsiv IMPLICIT'tir → registry'de satiri YOKTUR (yolu sabit `db_path`, her zaman var).
//! Kimlik uretimi + yol cozumu ust katmanda; burada `id`/`rel_path` disaridan gelir → db saf.

use rusqlite::{params, OptionalExtension, Row};
use serde::Serialize;

use crate::error::DbError;
use crate::Db;

/// Rezerve ana-arsiv kimligi (implicit; registry'de satiri yok — yolu sabit `db_path`).
/// Sema CHECK'i `id <> 'main'` ile bunu registry'ye yazmayi yapisal olarak engeller.
pub const MAIN_ARCHIVE_ID: &str = "main";

/// Bir yerel arsiv registry satiri (yalniz EK arsivler; main implicit → burada yok).
/// camelCase → IPC (`relPath`, `createdAt`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalArchiveRow {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub rel_path: String,
    pub created_at: i64,
}

fn map_row(r: &Row) -> rusqlite::Result<LocalArchiveRow> {
    Ok(LocalArchiveRow {
        id: r.get(0)?,
        name: r.get(1)?,
        color: r.get(2)?,
        rel_path: r.get(3)?,
        created_at: r.get(4)?,
    })
}

/// Renk dogrulama (tag/koleksiyon deseniyle ayni): None → None; Some → `#RRGGBB` olmali.
/// Keyfi CSS degeri saklanmaz (injection/tema-kacisi yok).
fn validate_color(color: Option<&str>) -> Result<Option<String>, DbError> {
    match color {
        None => Ok(None),
        Some(v) => {
            let v = v.trim();
            let valid = v.len() == 7
                && v.starts_with('#')
                && v.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit);
            if valid {
                Ok(Some(v.to_string()))
            } else {
                Err(DbError::Invalid("arsiv rengi #RRGGBB olmali".into()))
            }
        }
    }
}

impl Db {
    /// Aktif (silinmemis) yerel arsivler — `created_at` ASC (olusturma sirasi; ilk-eklenen ustte).
    /// ANA arsiv burada YOK (implicit; ust katman listeye implicit main'i ekler).
    pub fn list_local_archives(&self) -> Result<Vec<LocalArchiveRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, color, rel_path, created_at FROM local_archives
             WHERE deleted_at IS NULL ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map([], map_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// AKTIF bir arsivin kaydini getir (yol cozumu icin; silinmisler HARIC). Yoksa `None`.
    pub fn get_active_local_archive(&self, id: &str) -> Result<Option<LocalArchiveRow>, DbError> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, name, color, rel_path, created_at FROM local_archives
                 WHERE id = ?1 AND deleted_at IS NULL",
                params![id],
                map_row,
            )
            .optional()?)
    }

    /// Yeni arsiv kaydi ekle. `id`/`rel_path` ust katmanda uretilir (kararli kimlik + goreli yol).
    /// Ad trim'lenir + bos olamaz; AKTIF arsivler arasinda benzersiz olmali (silinmis ayni ad
    /// yeniden kullanilabilir — partial unique index). Renk `#RRGGBB` veya None.
    pub fn create_local_archive(
        &self,
        id: &str,
        name: &str,
        color: Option<&str>,
        rel_path: &str,
        now: i64,
    ) -> Result<(), DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("arsiv adi bos olamaz".into()));
        }
        let color = validate_color(color)?;
        // Erken + net cakisma hatasi (partial unique index de korur, ama mesaj daha yardimci).
        if self.active_name_exists(name, None)? {
            return Err(DbError::Invalid("bu adda bir arsiv zaten var".into()));
        }
        self.conn.execute(
            "INSERT INTO local_archives(id, name, color, rel_path, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, name, color, rel_path, now],
        )?;
        Ok(())
    }

    /// Arsivi yeniden adlandir (AKTIF olmali). Ad trim + bos olamaz + baska aktif arsivle cakisamaz.
    /// Yol/id korunur → dosya ve aktif secim guvenle yerinde kalir.
    pub fn rename_local_archive(&self, id: &str, name: &str) -> Result<(), DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("arsiv adi bos olamaz".into()));
        }
        if self.active_name_exists(name, Some(id))? {
            return Err(DbError::Invalid("bu adda bir arsiv zaten var".into()));
        }
        let updated = self.conn.execute(
            "UPDATE local_archives SET name = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![name, id],
        )?;
        if updated == 0 {
            return Err(DbError::Invalid("arsiv bulunamadi".into()));
        }
        Ok(())
    }

    /// Arsiv rengini ayarla (AKTIF olmali). `#RRGGBB` veya None (rozeti kaldirir).
    pub fn set_local_archive_color(&self, id: &str, color: Option<&str>) -> Result<(), DbError> {
        let color = validate_color(color)?;
        let updated = self.conn.execute(
            "UPDATE local_archives SET color = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![color, id],
        )?;
        if updated == 0 {
            return Err(DbError::Invalid("arsiv bulunamadi".into()));
        }
        Ok(())
    }

    /// Arsivi non-destructive SIL: registry satirini `deleted_at` ile isaretle (dosya tasimasi
    /// ust katmanda). Yalniz AKTIF satiri etkiler (idempotent-degil: olmayan/silinmis → Invalid).
    pub fn soft_delete_local_archive(&self, id: &str, now: i64) -> Result<(), DbError> {
        let updated = self.conn.execute(
            "UPDATE local_archives SET deleted_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id],
        )?;
        if updated == 0 {
            return Err(DbError::Invalid("arsiv bulunamadi".into()));
        }
        Ok(())
    }

    /// Silinmis arsivi GERI YUKLE: `deleted_at`'i temizle (dosya geri-tasimasi ust katmanda).
    /// Adi bu arada baska aktif arsivce alinmissa cakisma reddi (partial unique index korur).
    pub fn restore_local_archive(&self, id: &str) -> Result<(), DbError> {
        // Once adi cek + aktif cakisma kontrolu (net mesaj).
        let name: Option<String> = self
            .conn
            .query_row(
                "SELECT name FROM local_archives WHERE id = ?1 AND deleted_at IS NOT NULL",
                params![id],
                |r| r.get(0),
            )
            .optional()?;
        let Some(name) = name else {
            return Err(DbError::Invalid("silinmis arsiv bulunamadi".into()));
        };
        if self.active_name_exists(&name, None)? {
            return Err(DbError::Invalid("bu adda aktif bir arsiv var; once onu yeniden adlandirin".into()));
        }
        self.conn.execute(
            "UPDATE local_archives SET deleted_at = NULL WHERE id = ?1",
            params![id],
        )?;
        Ok(())
    }

    /// Verilen ad AKTIF arsivler arasinda var mi (opsiyonel `exclude_id` haric — rename self-check).
    fn active_name_exists(&self, name: &str, exclude_id: Option<&str>) -> Result<bool, DbError> {
        let found: Option<i64> = self
            .conn
            .query_row(
                "SELECT 1 FROM local_archives
                 WHERE name = ?1 AND deleted_at IS NULL AND (?2 IS NULL OR id <> ?2)",
                params![name, exclude_id],
                |r| r.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }
}

#[cfg(test)]
mod tests {
    use crate::Db;

    fn db() -> Db {
        Db::open_in_memory_migrated().unwrap()
    }

    #[test]
    fn create_list_rename_color_roundtrip() {
        let db = db();
        assert!(db.list_local_archives().unwrap().is_empty(), "bos baslar");

        db.create_local_archive("a1", "Kisisel", Some("#10b981"), "archives/a1/archive.db", 100)
            .unwrap();
        db.create_local_archive("a2", "Yedek", None, "archives/a2/archive.db", 200).unwrap();
        let list = db.list_local_archives().unwrap();
        assert_eq!(list.len(), 2);
        // created_at ASC → ilk eklenen ustte.
        assert_eq!(list[0].id, "a1");
        assert_eq!(list[0].name, "Kisisel");
        assert_eq!(list[0].color.as_deref(), Some("#10b981"));
        assert_eq!(list[0].rel_path, "archives/a1/archive.db");
        assert_eq!(list[1].color, None);

        db.rename_local_archive("a1", "  Taslaklar  ").unwrap();
        db.set_local_archive_color("a2", Some("#a855f7")).unwrap();
        let a1 = db.get_active_local_archive("a1").unwrap().unwrap();
        assert_eq!(a1.name, "Taslaklar", "trim'li yeni ad");
        let a2 = db.get_active_local_archive("a2").unwrap().unwrap();
        assert_eq!(a2.color.as_deref(), Some("#a855f7"));
    }

    #[test]
    fn active_name_uniqueness_and_reuse_after_delete() {
        let db = db();
        db.create_local_archive("a1", "Proje X", None, "archives/a1/archive.db", 1).unwrap();
        // Ayni ad (aktif) → reddedilir.
        assert!(db.create_local_archive("a2", "Proje X", None, "archives/a2/archive.db", 2).is_err());
        // a1 silinince ad yeniden kullanilabilir.
        db.soft_delete_local_archive("a1", 10).unwrap();
        assert!(db.get_active_local_archive("a1").unwrap().is_none(), "silinmis aktif listede yok");
        db.create_local_archive("a2", "Proje X", None, "archives/a2/archive.db", 20).unwrap();
        assert_eq!(db.list_local_archives().unwrap().len(), 1);
    }

    #[test]
    fn soft_delete_and_restore() {
        let db = db();
        db.create_local_archive("a1", "Arsiv", None, "archives/a1/archive.db", 1).unwrap();
        db.soft_delete_local_archive("a1", 5).unwrap();
        assert!(db.list_local_archives().unwrap().is_empty());
        // Ikinci silme → yok (Invalid).
        assert!(db.soft_delete_local_archive("a1", 6).is_err());
        db.restore_local_archive("a1").unwrap();
        let list = db.list_local_archives().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Arsiv");
    }

    #[test]
    fn restore_blocked_by_active_name_clash() {
        let db = db();
        db.create_local_archive("a1", "Ortak", None, "archives/a1/archive.db", 1).unwrap();
        db.soft_delete_local_archive("a1", 5).unwrap();
        // Ayni adla yeni bir aktif arsiv olustu → eskiyi geri yukleme cakisir.
        db.create_local_archive("a2", "Ortak", None, "archives/a2/archive.db", 6).unwrap();
        assert!(db.restore_local_archive("a1").is_err());
    }

    #[test]
    fn empty_name_and_bad_color_rejected() {
        let db = db();
        assert!(db.create_local_archive("a1", "   ", None, "archives/a1/archive.db", 1).is_err());
        assert!(db
            .create_local_archive("a1", "Ad", Some("red"), "archives/a1/archive.db", 1)
            .is_err());
        assert!(db
            .create_local_archive("a1", "Ad", Some("#zzz"), "archives/a1/archive.db", 1)
            .is_err());
    }
}
