//! Undo gecmisi (P2.5 stabilite) — dosya-tasiyan / metadata-yazan islemlerin geri-alinabilir kaydi.
//!
//! Bu modul yalniz KAYIT deposudur (migration 0016 `undo_ops`): islem bittiginde komut katmani
//! bir satir yazar (`record_undo_op`); "Geri Al" once kaydi okur (`get_undo_op`), payload'daki
//! ogeleri TERSINE uygular (geri-tasima = `refile_one`; meta = per-asset patch restore — komut
//! katmaninda), sonra `mark_undone` cagirir. Payload JSON'unu komut katmani kurar/yorumlar
//! (kind'a ozgu; db katmani opak metin olarak saklar → sema buraya sizmasin).
//!
//! Kayit sayisi `UNDO_RETENTION` (50; H2'nin 50-derin undo pariteli) ile sinirlanir — her
//! eklemede fazlasi budanir (en eskiler silinir; geri-alinmis olsun olmasin).

use rusqlite::{params, OptionalExtension};

use crate::error::DbError;
use crate::Db;

/// Tutulacak azami kayit (en yeni N; fazlasi eklemede budanir). H2 undo-derinligi pariteli.
pub const UNDO_RETENTION: i64 = 50;

/// Liste satiri (panel) — payload TASINMAZ (buyuk olabilir; yalniz geri-alma aninda okunur).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndoOpRow {
    pub id: i64,
    /// Kayit ani (unix saniye).
    pub created_at: i64,
    /// Islem turu: `refile_move` | `rename` | `organize_move` | `project_meta_bulk`.
    pub kind: String,
    /// Insan-okur ozet (or. hedef kok ya da yeni ad) — i18n DEGIL, veri.
    pub label: String,
    pub item_count: i64,
    /// Geri alindi mi (listede soluk gosterilir; yeniden geri-alinamaz).
    pub undone: bool,
}

/// Geri-alma aninda okunan tam kayit (payload dahil).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UndoOpFull {
    pub id: i64,
    pub kind: String,
    pub payload: String,
    pub undone: bool,
}

impl Db {
    /// Yeni undo kaydi ekle → id. Ayni cagrida `UNDO_RETENTION` fazlasi budanir (en eski
    /// satirlar silinir). `now` cagirandan (unix saniye) — test-deterministik.
    pub fn record_undo_op(
        &self,
        kind: &str,
        label: &str,
        item_count: i64,
        payload: &str,
        now: i64,
    ) -> Result<i64, DbError> {
        self.conn.execute(
            "INSERT INTO undo_ops(created_at, kind, label, item_count, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![now, kind, label, item_count, payload],
        )?;
        let id = self.conn.last_insert_rowid();
        // Budama: en yeni RETENTION disindakileri sil (id monoton artar → id sirasi = zaman).
        self.conn.execute(
            "DELETE FROM undo_ops WHERE id NOT IN
                 (SELECT id FROM undo_ops ORDER BY id DESC LIMIT ?1)",
            params![UNDO_RETENTION],
        )?;
        Ok(id)
    }

    /// Kayitlar, en yeni once (panel listesi). `limit` 1..=RETENTION'a kelepcelenir.
    pub fn list_undo_ops(&self, limit: i64) -> Result<Vec<UndoOpRow>, DbError> {
        let limit = limit.clamp(1, UNDO_RETENTION);
        let mut stmt = self.conn.prepare(
            "SELECT id, created_at, kind, label, item_count, undone_at
             FROM undo_ops ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(UndoOpRow {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    kind: r.get(2)?,
                    label: r.get(3)?,
                    item_count: r.get(4)?,
                    undone: r.get::<_, Option<i64>>(5)?.is_some(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Tek kayit (payload dahil) — geri-alma girisi. Yok → `None`.
    pub fn get_undo_op(&self, id: i64) -> Result<Option<UndoOpFull>, DbError> {
        Ok(self
            .conn
            .query_row(
                "SELECT id, kind, payload, undone_at FROM undo_ops WHERE id = ?1",
                params![id],
                |r| {
                    Ok(UndoOpFull {
                        id: r.get(0)?,
                        kind: r.get(1)?,
                        payload: r.get(2)?,
                        undone: r.get::<_, Option<i64>>(3)?.is_some(),
                    })
                },
            )
            .optional()?)
    }

    /// Kaydi geri-alindi olarak isaretle. Yok/zaten silinmis → `Invalid` (cagiran once
    /// `get_undo_op` ile varligini dogrulamis olmali; yaris kosulunda da guvenli).
    pub fn mark_undone(&self, id: i64, now: i64) -> Result<(), DbError> {
        let n = self.conn.execute(
            "UPDATE undo_ops SET undone_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        if n == 0 {
            return Err(DbError::Invalid(format!("undo kaydi bulunamadi: {id}")));
        }
        Ok(())
    }

    /// Kaydi yeniden AKTIF isaretle (ileri-al/redo sonrasi; `undone_at = NULL`). Boylece kayit
    /// tekrar geri-alinabilir olur (undo↔redo cift-yonlu). Yok → `Invalid`.
    pub fn mark_redone(&self, id: i64) -> Result<(), DbError> {
        let n = self
            .conn
            .execute("UPDATE undo_ops SET undone_at = NULL WHERE id = ?1", params![id])?;
        if n == 0 {
            return Err(DbError::Invalid(format!("undo kaydi bulunamadi: {id}")));
        }
        Ok(())
    }

    /// Kaydin payload'unu guncelle — yalniz **koleksiyon redo-recreate** icin (silinen koleksiyon
    /// ada gore yeniden olusunca yeni id payload'a yazilir → sonraki undo dogru koleksiyonu hedefler).
    pub fn update_undo_payload(&self, id: i64, payload: &str) -> Result<(), DbError> {
        self.conn
            .execute("UPDATE undo_ops SET payload = ?2 WHERE id = ?1", params![id, payload])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_list_get_mark_roundtrip() {
        let db = Db::open_in_memory_migrated().unwrap();
        let id = db
            .record_undo_op("refile_move", "D:/hedef", 3, r#"{"items":[]}"#, 100)
            .unwrap();

        let rows = db.list_undo_ops(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, id);
        assert_eq!(rows[0].kind, "refile_move");
        assert_eq!(rows[0].label, "D:/hedef");
        assert_eq!(rows[0].item_count, 3);
        assert_eq!(rows[0].created_at, 100);
        assert!(!rows[0].undone);

        let full = db.get_undo_op(id).unwrap().unwrap();
        assert_eq!(full.payload, r#"{"items":[]}"#);
        assert!(!full.undone);

        db.mark_undone(id, 200).unwrap();
        assert!(db.get_undo_op(id).unwrap().unwrap().undone);
        assert!(db.list_undo_ops(10).unwrap()[0].undone);

        // mark_redone → tekrar aktif (undo↔redo cift-yon).
        db.mark_redone(id).unwrap();
        assert!(!db.get_undo_op(id).unwrap().unwrap().undone);

        // update_undo_payload → payload degisir (koleksiyon redo-recreate).
        db.update_undo_payload(id, r#"{"x":1}"#).unwrap();
        assert_eq!(db.get_undo_op(id).unwrap().unwrap().payload, r#"{"x":1}"#);
    }

    #[test]
    fn list_is_newest_first_and_pruned_to_retention() {
        let db = Db::open_in_memory_migrated().unwrap();
        // RETENTION + 5 kayit → en eski 5 budanmis olmali.
        for i in 0..(UNDO_RETENTION + 5) {
            db.record_undo_op("rename", &format!("op{i}"), 1, "{}", i).unwrap();
        }
        let rows = db.list_undo_ops(UNDO_RETENTION + 10).unwrap();
        assert_eq!(rows.len() as i64, UNDO_RETENTION, "fazlasi budanir");
        // En yeni once; en eski 5 (op0..op4) listede YOK.
        assert_eq!(rows[0].label, format!("op{}", UNDO_RETENTION + 4));
        assert!(rows.iter().all(|r| r.label != "op0" && r.label != "op4"));
    }

    #[test]
    fn mark_missing_is_invalid_and_get_missing_is_none() {
        let db = Db::open_in_memory_migrated().unwrap();
        assert!(db.get_undo_op(999).unwrap().is_none());
        assert!(matches!(db.mark_undone(999, 1), Err(DbError::Invalid(_))));
    }
}
