//! Asset iliskileri (§G / Faz-G) — assets arasi yonlu baglar. Tablo `relations` (migration 0001):
//! `(id, src_id→assets, dst_id→assets, kind, UNIQUE(src,dst,kind))`, FK CASCADE (purge iliskiyi de
//! siler). kind: duplicate | version | xref | derived | backup (urun-tanimli; dogrulama komut katmaninda).
//!
//! `relations_for` bir asset'in HER IKI yondeki (src VEYA dst) iliskilerini, KARSI AKTIF asset'in
//! (`deleted_at IS NULL` → cop'tekiler haric) bilgisiyle doner → detay paneli "Iliskiler" sekmesi.

use crate::error::DbError;
use crate::Db;
use serde::Serialize;

mod detect;

pub use detect::DetectRelationsReport;

/// Bir asset icin tek iliski satiri (detay paneli) — karsi (bagli) asset'e cozulmus.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelationRow {
    /// Iliski id (kaldirma icin).
    pub id: i64,
    pub kind: String,
    /// Bu asset KAYNAK mi (src)? `true` → yon `→` (bu→karsi); `false` → `←` (karsi→bu).
    pub outgoing: bool,
    /// Bagli (karsi) asset id — tiklaninca acilir.
    pub other_id: i64,
    pub other_path: String,
    pub other_file_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GeoAssetRow {
    pub id: i64,
    pub file_name: String,
    pub path: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VersionTimelineRow {
    pub id: i64,
    pub file_name: String,
    pub path: String,
    pub modified_at: i64,
}
impl Db {
    pub fn geo_assets(&self) -> Result<Vec<GeoAssetRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.file_name, a.path, lat.value_num, lon.value_num
             FROM assets a
             JOIN asset_metadata lat ON lat.asset_id = a.id AND lat.key = 'gps_lat'
             JOIN asset_metadata lon ON lon.asset_id = a.id AND lon.key = 'gps_lon'
             WHERE a.deleted_at IS NULL
               AND lat.value_num BETWEEN -90.0 AND 90.0
               AND lon.value_num BETWEEN -180.0 AND 180.0
             ORDER BY a.file_name COLLATE NOCASE, a.id",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(GeoAssetRow {
                    id: r.get(0)?,
                    file_name: r.get(1)?,
                    path: r.get(2)?,
                    latitude: r.get(3)?,
                    longitude: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn version_timeline(&self, asset_id: i64) -> Result<Vec<VersionTimelineRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "WITH RECURSIVE chain(id) AS (
                SELECT ?1
                UNION
                SELECT CASE WHEN r.src_id = chain.id THEN r.dst_id ELSE r.src_id END
                FROM relations r
                JOIN chain ON r.src_id = chain.id OR r.dst_id = chain.id
                WHERE r.kind = 'version'
             )
             SELECT a.id, a.file_name, a.path, a.modified_at
             FROM assets a JOIN chain ON chain.id = a.id
             WHERE a.deleted_at IS NULL
             ORDER BY a.modified_at ASC, a.id ASC",
        )?;
        let rows = stmt
            .query_map([asset_id], |r| {
                Ok(VersionTimelineRow {
                    id: r.get(0)?,
                    file_name: r.get(1)?,
                    path: r.get(2)?,
                    modified_at: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
    /// Iliski ekle (`src → dst`, kind). `UNIQUE(src,dst,kind)` → tekrar NO-OP (`INSERT OR IGNORE`).
    /// Eklenen satir sayisi doner (0 = zaten vardi). src==dst / kind dogrulamasi KOMUT katmaninda.
    pub fn add_relation(&self, src_id: i64, dst_id: i64, kind: &str) -> Result<usize, DbError> {
        Ok(self.conn.execute(
            "INSERT OR IGNORE INTO relations (src_id, dst_id, kind) VALUES (?1, ?2, ?3)",
            rusqlite::params![src_id, dst_id, kind],
        )?)
    }

    /// Iliskiyi id ile kaldir. Etkilenen satir sayisi doner (0 = yoktu).
    pub fn remove_relation(&self, id: i64) -> Result<usize, DbError> {
        Ok(self
            .conn
            .execute("DELETE FROM relations WHERE id = ?1", [id])?)
    }

    /// Bir asset'in TUM iliskileri (src VEYA dst yon), karsi AKTIF asset'e cozulmus (cop'tekiler
    /// `deleted_at IS NULL` ile haric). Kind'a, sonra karsi dosya adina gore siralanir.
    pub fn relations_for(&self, asset_id: i64) -> Result<Vec<RelationRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT r.id, r.kind, (r.src_id = ?1) AS outgoing, a.id, a.path, a.file_name
             FROM relations r
             JOIN assets a
               ON a.id = CASE WHEN r.src_id = ?1 THEN r.dst_id ELSE r.src_id END
             WHERE (r.src_id = ?1 OR r.dst_id = ?1)
               AND a.deleted_at IS NULL
             ORDER BY r.kind, a.file_name",
        )?;
        let rows = stmt
            .query_map([asset_id], |r| {
                Ok(RelationRow {
                    id: r.get(0)?,
                    kind: r.get(1)?,
                    outgoing: r.get::<_, i64>(2)? != 0,
                    other_id: r.get(3)?,
                    other_path: r.get(4)?,
                    other_file_name: r.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn seed_asset(db: &Db, id: i64, name: &str) {
        db.connection()
            .execute(
                "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
                 VALUES (?1, ?2, ?3, 'txt', 10, 1, 1)",
                params![id, format!("/a/{name}"), name],
            )
            .unwrap();
    }

    #[test]
    fn add_list_both_directions_dedup_remove_and_deleted_excluded() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed_asset(&db, 1, "a.dwg");
        seed_asset(&db, 2, "b.pdf");
        seed_asset(&db, 3, "c.png");

        // 1 → 2 (version), 3 → 1 (xref).
        assert_eq!(db.add_relation(1, 2, "version").unwrap(), 1);
        assert_eq!(db.add_relation(3, 1, "xref").unwrap(), 1);
        // Tekrar (UNIQUE) → no-op.
        assert_eq!(db.add_relation(1, 2, "version").unwrap(), 0);

        // Asset 1: hem GIDEN (1→2) hem GELEN (3→1) gorunur.
        let r1 = db.relations_for(1).unwrap();
        assert_eq!(r1.len(), 2);
        let out = r1.iter().find(|r| r.kind == "version").unwrap();
        assert!(out.outgoing); // 1 kaynak
        assert_eq!(out.other_id, 2);
        assert_eq!(out.other_file_name, "b.pdf");
        let inc = r1.iter().find(|r| r.kind == "xref").unwrap();
        assert!(!inc.outgoing); // 1 hedef (3→1)
        assert_eq!(inc.other_id, 3);

        // Karsi asset cop'e → iliski listede GORUNMEZ (aktif filtre).
        db.connection()
            .execute("UPDATE assets SET deleted_at = 1 WHERE id = 2", [])
            .unwrap();
        let r1b = db.relations_for(1).unwrap();
        assert_eq!(r1b.len(), 1); // yalniz xref (3→1) kaldi
        assert_eq!(r1b[0].kind, "xref");

        // Kaldir (idempotent).
        let rid = r1b[0].id;
        assert_eq!(db.remove_relation(rid).unwrap(), 1);
        assert_eq!(db.remove_relation(rid).unwrap(), 0);
        assert!(db.relations_for(1).unwrap().is_empty());
    }

    #[test]
    fn geo_assets_returns_only_active_valid_coordinate_pairs() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed_asset(&db, 1, "valid.jpg");
        seed_asset(&db, 2, "outside.jpg");
        seed_asset(&db, 3, "partial.jpg");
        db.connection()
            .execute(
                "INSERT INTO asset_metadata(asset_id, key, value_num) VALUES
             (1, 'gps_lat', 41.0082), (1, 'gps_lon', 28.9784),
             (2, 'gps_lat', 99.0), (2, 'gps_lon', 10.0), (3, 'gps_lat', 40.0)",
                [],
            )
            .unwrap();

        let points = db.geo_assets().unwrap();
        assert_eq!(points.len(), 1);
        assert_eq!(points[0].id, 1);
        assert_eq!(points[0].file_name, "valid.jpg");
        assert_eq!(
            (points[0].latitude, points[0].longitude),
            (41.0082, 28.9784)
        );
    }

    #[test]
    fn version_timeline_walks_full_component_orders_time_and_skips_trashed() {
        let db = Db::open_in_memory_migrated().unwrap();
        for (id, name, modified) in [
            (1, "v1.dwg", 30),
            (2, "v2.dwg", 10),
            (3, "v3.dwg", 20),
            (4, "xref.pdf", 40),
        ] {
            seed_asset(&db, id, name);
            db.connection()
                .execute(
                    "UPDATE assets SET modified_at = ?1 WHERE id = ?2",
                    params![modified, id],
                )
                .unwrap();
        }
        db.add_relation(1, 2, "version").unwrap();
        db.add_relation(2, 3, "version").unwrap();
        db.add_relation(3, 1, "version").unwrap();
        db.add_relation(3, 4, "xref").unwrap();

        let full = db.version_timeline(1).unwrap();
        assert_eq!(
            full.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![2, 3, 1]
        );
        db.connection()
            .execute("UPDATE assets SET deleted_at = 1 WHERE id = 3", [])
            .unwrap();
        let active = db.version_timeline(1).unwrap();
        assert_eq!(
            active.iter().map(|row| row.id).collect::<Vec<_>>(),
            vec![2, 1]
        );
    }
}
