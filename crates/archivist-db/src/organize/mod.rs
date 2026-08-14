//! Organize — kural-bazli oto-klasorleme siniflandirmasi (salt-veri; disk YOK).
//!
//! Refile'in devami: refile TEK dosyayi elle tasir; organize bir asset KUMESINI bir veya
//! DAHA COK kurala (`Structure`) gore hedef alt-klasorlere DAGITIR. Bu modul yalniz
//! **siniflandirma** yapar (asset → sirali klasor segmentleri); asil disk tasima/kopyalama +
//! DB senkronu komut katmanindadir. Ayni saf `relative_segments_for` hem ONIZLEME
//! (`plan_organize`) hem CALISTIRMA (`organize_assets`) tarafindan cagrilir → onizleme ile
//! calistirma birebir tutar (find_duplicates salt-okuma-rapor deseniyle ayni ruh).
//!
//! **Cok-seviye:** `structures` sirali bir dilim → her structure bir klasor SEVIYESI uretir
//! (`[ByYear, ByClient]` → `2026/Acme/...`). Bos dilim → segment yok (dosya dogrudan koke).
//!
//! Fiziksel klasor adlari **sabit TR** (`01-Cizimler`, `Onayli`, `00-Terminsiz` vb.) — UI diline
//! bagimli DEGIL (diskteki klasor dil degistirince kaymaz; H2 mantiginin devami).
//!
//! Saf klasor-adlandirma fonksiyonlari (`ext_category`, `relative_segments_for` vb.) `naming`
//! alt-modulunde; buradan re-export'lu (yol `organize::<ad>` AYNEN cozulur).

use std::str::FromStr;

use crate::error::DbError;
use crate::Db;

mod naming;

pub use naming::{
    approval_folder, ensure_trailing_sep, ext_category, relative_segments_for, sanitize_folder_name,
};

/// Bir asset'in siniflandirma girdisi — organize onizleme/calistirmasinin ihtiyac duydugu
/// minimal alanlar (yol DEGIL: yol komut katmaninda `paths_for_ids` ile ayrica okunur).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetClass {
    pub id: i64,
    pub file_name: String,
    /// Normalize uzanti (kucuk harf) — `byExt` kategorisi icin. `None` = uzantisiz.
    pub ext: Option<String>,
    /// Kullanici-tanimli musteri adi (0008) — `byClient` klasoru icin. `None` = ayarlanmamis.
    pub client_name: Option<String>,
    /// Ada gore alfabetik ILK etiket (`byTag` klasoru). `None` = etiketsiz.
    pub first_tag: Option<String>,
    /// Onay durumu (0008; `draft|review|approved|rejected`) — `byApproval` klasoru. `None` = ayarlanmamis.
    pub approval_status: Option<String>,
    /// Kullanici-tanimli versiyon etiketi (0008) — `byVersion` klasoru. `None` = ayarlanmamis.
    pub version_label: Option<String>,
    /// Termin (0008) — DB'de **TEXT, ISO `YYYY-MM-DD`** (frontend `type=date`). `byYear` klasoru
    /// bunun ilk 4-hane yilini kullanir. `None` = ayarlanmamis.
    pub deadline: Option<String>,
}

/// Klasorleme sablonu (frontend "structure" secimi). Cok-seviyede sirali kullanilir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Structure {
    /// Uzantiya gore kategori klasoru (`01-Cizimler`, `02-Gorseller`, ...).
    ByExt,
    /// Musteri adina gore klasor (`sanitize_folder_name`; bos/None → `00-Musterisiz`).
    ByClient,
    /// Ilk etikete gore klasor (`sanitize_folder_name`; bos/None → `00-Etiketsiz`).
    ByTag,
    /// Onay durumuna gore sabit-TR klasor (`Onayli`/`Bekleyen`/`Reddedilen`; None/bilinmeyen → `00-Belirsiz`).
    ByApproval,
    /// Versiyon etiketine gore klasor (`sanitize_folder_name`; bos/None → `00-Versiyonsuz`).
    ByVersion,
    /// Termin yilina gore klasor (`2026` vb.; termin yok/gecersiz → `00-Terminsiz`).
    ByYear,
}

/// Bilinmeyen `Structure` anahtari — komut katmani `"invalid_structure"`e cevirir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseStructureError(pub String);

impl std::fmt::Display for ParseStructureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "bilinmeyen structure: {}", self.0)
    }
}

impl std::error::Error for ParseStructureError {}

impl FromStr for Structure {
    type Err = ParseStructureError;

    /// Frontend anahtarlari → enum; bilinmeyen → hata.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "byExt" => Ok(Structure::ByExt),
            "byClient" => Ok(Structure::ByClient),
            "byTag" => Ok(Structure::ByTag),
            "byApproval" => Ok(Structure::ByApproval),
            "byVersion" => Ok(Structure::ByVersion),
            "byYear" => Ok(Structure::ByYear),
            other => Err(ParseStructureError(other.to_string())),
        }
    }
}

impl Db {
    /// Verilen id'lerin **aktif** (cop'te olmayan) siniflandirma alanlari — batch tek sorgu
    /// (`WHERE id IN (...)`; `paths_for_ids` deseni). Ilk-etiket ada-gore alfabetik korelasyonlu
    /// alt-sorgu ile getirilir (etiketsiz → NULL). Cop/eksik id sonuca girmez; donus sirasi GARANTI
    /// DEGIL (komut katmani id→kayit haritasiyla giris sirasini korur). Bos dilim → bos.
    pub fn classification_for(&self, ids: &[i64]) -> Result<Vec<AssetClass>, DbError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ph = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT a.id, a.file_name, a.ext, a.client_name,
                    (SELECT t.name FROM asset_tags at JOIN tags t ON t.id = at.tag_id
                     WHERE at.asset_id = a.id ORDER BY t.name LIMIT 1) AS first_tag,
                    a.approval_status, a.version_label, a.deadline
             FROM assets a
             WHERE a.deleted_at IS NULL AND a.id IN ({ph})"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(ids), |r| {
                Ok(AssetClass {
                    id: r.get(0)?,
                    file_name: r.get(1)?,
                    ext: r.get(2)?,
                    client_name: r.get(3)?,
                    first_tag: r.get(4)?,
                    approval_status: r.get(5)?,
                    version_label: r.get(6)?,
                    deadline: r.get(7)?,
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

    /// Aktif/cop asset ekle (proje-durum alanlariyla) → id. `deleted` Some → cop'te.
    #[allow(clippy::too_many_arguments)]
    fn seed(
        db: &Db,
        path: &str,
        name: &str,
        ext: Option<&str>,
        client: Option<&str>,
        approval: Option<&str>,
        version: Option<&str>,
        deadline: Option<&str>,
        deleted: Option<i64>,
    ) -> i64 {
        db.connection()
            .execute(
                "INSERT INTO assets
                     (path, file_name, ext, client_name, approval_status, version_label,
                      deadline, size_bytes, created_at, modified_at, deleted_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1, 1, ?8)",
                params![path, name, ext, client, approval, version, deadline, deleted],
            )
            .unwrap();
        db.connection().last_insert_rowid()
    }

    /// Basit asset (yalniz ext/client) — cok testte yeterli.
    fn seed_basic(db: &Db, path: &str, name: &str, ext: Option<&str>, client: Option<&str>) -> i64 {
        seed(db, path, name, ext, client, None, None, None, None)
    }

    /// Bir asset'e etiket bagla (varsa tag'i yeniden kullan).
    fn tag(db: &Db, asset_id: i64, name: &str) {
        db.connection()
            .execute("INSERT OR IGNORE INTO tags(name) VALUES (?1)", params![name])
            .unwrap();
        let tag_id: i64 = db
            .connection()
            .query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| r.get(0))
            .unwrap();
        db.connection()
            .execute(
                "INSERT INTO asset_tags(asset_id, tag_id) VALUES (?1, ?2)",
                params![asset_id, tag_id],
            )
            .unwrap();
    }

    #[test]
    fn classification_for_returns_active_only_with_new_fields() {
        let db = Db::open_in_memory_migrated().unwrap();
        let a = seed(
            &db,
            r"C:\a\villa.dwg",
            "villa.dwg",
            Some("dwg"),
            Some("Acme"),
            Some("approved"),
            Some("v2"),
            Some("2026-09-01"),
            None,
        );
        tag(&db, a, "villa"); // ikinci etiket alfabetik ilk gelmemeli
        tag(&db, a, "Acil"); // 'A' < 'v' → first_tag = "Acil"
        let b = seed_basic(&db, r"C:\a\rapor.pdf", "rapor.pdf", Some("pdf"), None);
        let trashed = seed(
            &db,
            r"C:\a\eski.dwg",
            "eski.dwg",
            Some("dwg"),
            Some("Acme"),
            None,
            None,
            None,
            Some(1),
        );

        let mut got = db.classification_for(&[a, b, trashed]).unwrap();
        got.sort_by_key(|c| c.id);
        assert_eq!(got.len(), 2, "cop'teki asset haric getirilmeli");

        assert_eq!(got[0].id, a);
        assert_eq!(got[0].file_name, "villa.dwg");
        assert_eq!(got[0].ext.as_deref(), Some("dwg"));
        assert_eq!(got[0].client_name.as_deref(), Some("Acme"));
        assert_eq!(got[0].first_tag.as_deref(), Some("Acil"), "alfabetik ilk etiket");
        assert_eq!(got[0].approval_status.as_deref(), Some("approved"));
        assert_eq!(got[0].version_label.as_deref(), Some("v2"));
        assert_eq!(got[0].deadline.as_deref(), Some("2026-09-01"));

        assert_eq!(got[1].id, b);
        assert_eq!(got[1].client_name, None);
        assert_eq!(got[1].first_tag, None, "etiketsiz asset → None");
        assert_eq!(got[1].approval_status, None);
        assert_eq!(got[1].deadline, None);
    }

    #[test]
    fn classification_for_empty_input_is_empty() {
        let db = Db::open_in_memory_migrated().unwrap();
        assert!(db.classification_for(&[]).unwrap().is_empty());
    }
}
