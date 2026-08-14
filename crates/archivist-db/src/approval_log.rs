//! Onay durumu GECIS gecmisi (data katmani) — H2 `approval_log` pariti.
//!
//! Bir asset'in onay durumu (`draft|review|approved|rejected` ya da atanmamis) her degistiginde
//! bir satir: eski→yeni + sebep + kim + ne zaman. **Kayit KOMUT katmanindadir** (set/bulk
//! project-meta): eski durum yazmadan once okunur, degistiyse (`from != to`) `record_approval_change`
//! cagrilir (mevcut audit deseni; yazma sonrasi ayni db kilidi altinda). Bu modul yalniz insert +
//! asset-bazli okuma sunar (saf katman; whitelist/degisim karari ust katmanda).

use rusqlite::{params, Row};
use serde::Serialize;

use crate::error::DbError;
use crate::Db;

/// Tek bir onay gecisi (asset-bazli gecmis; en yeni once). `fromStatus`/`toStatus` NULL olabilir
/// (durum atanmamis). camelCase → IPC.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalLogRow {
    pub id: i64,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub reason: Option<String>,
    pub changed_by: String,
    pub changed_at: i64,
}

fn map_row(r: &Row) -> rusqlite::Result<ApprovalLogRow> {
    Ok(ApprovalLogRow {
        id: r.get(0)?,
        from_status: r.get(1)?,
        to_status: r.get(2)?,
        reason: r.get(3)?,
        changed_by: r.get(4)?,
        changed_at: r.get(5)?,
    })
}

impl Db {
    /// Bir onay gecisini kaydet (eski→yeni). Cagiran YALNIZ gercek degisimde (`from != to`)
    /// cagirir; bu yordam kosul denetlemez (saf insert). `reason` yalniz reddedilmede anlamli.
    pub fn record_approval_change(
        &self,
        asset_id: i64,
        from_status: Option<&str>,
        to_status: Option<&str>,
        reason: Option<&str>,
        changed_by: &str,
        changed_at: i64,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO approval_log(asset_id, from_status, to_status, reason, changed_by, changed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![asset_id, from_status, to_status, reason, changed_by, changed_at],
        )?;
        Ok(())
    }

    /// Bir asset'in onay gecis gecmisi (en yeni once; `limit` ile kelepceli). Detay panelindeki
    /// "Onay gecmisi" bunu okur. Bos → bos vektor.
    pub fn list_approval_log(
        &self,
        asset_id: i64,
        limit: i64,
    ) -> Result<Vec<ApprovalLogRow>, DbError> {
        let lim = limit.clamp(1, 500);
        let mut stmt = self.conn.prepare(
            "SELECT id, from_status, to_status, reason, changed_by, changed_at
             FROM approval_log WHERE asset_id = ?1
             ORDER BY changed_at DESC, id DESC LIMIT ?2",
        )?;
        let rows =
            stmt.query_map(params![asset_id, lim], map_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use crate::Db;

    fn db_with_asset() -> Db {
        let db = Db::open_in_memory_migrated().unwrap();
        db.connection()
            .execute(
                "INSERT INTO assets(id, path, file_name, size_bytes, created_at, modified_at)
                 VALUES (1, '/a/x.dwg', 'x.dwg', 10, 1, 1)",
                [],
            )
            .unwrap();
        db
    }

    #[test]
    fn record_and_list_newest_first() {
        let db = db_with_asset();
        db.record_approval_change(1, None, Some("review"), None, "ali", 100).unwrap();
        db.record_approval_change(1, Some("review"), Some("rejected"), Some("eksik olcu"), "veli", 200)
            .unwrap();
        db.record_approval_change(1, Some("rejected"), Some("approved"), None, "ali", 300).unwrap();

        let log = db.list_approval_log(1, 50).unwrap();
        assert_eq!(log.len(), 3);
        // En yeni once.
        assert_eq!(log[0].to_status.as_deref(), Some("approved"));
        assert_eq!(log[0].from_status.as_deref(), Some("rejected"));
        assert_eq!(log[0].changed_by, "ali");
        // Reddedilme satiri sebep tasir.
        assert_eq!(log[1].to_status.as_deref(), Some("rejected"));
        assert_eq!(log[1].reason.as_deref(), Some("eksik olcu"));
        // Ilk gecis: durumsuz → review.
        assert_eq!(log[2].from_status, None);
        assert_eq!(log[2].to_status.as_deref(), Some("review"));
    }

    #[test]
    fn cascade_delete_removes_history() {
        let db = db_with_asset();
        db.record_approval_change(1, None, Some("approved"), None, "ali", 100).unwrap();
        assert_eq!(db.list_approval_log(1, 50).unwrap().len(), 1);
        // Asset fiziksel silinince (purge) gecmis de gitmeli (FK CASCADE).
        db.connection().execute("DELETE FROM assets WHERE id = 1", []).unwrap();
        assert!(db.list_approval_log(1, 50).unwrap().is_empty());
    }

    #[test]
    fn empty_for_unknown_asset() {
        let db = db_with_asset();
        assert!(db.list_approval_log(999, 50).unwrap().is_empty());
    }
}
