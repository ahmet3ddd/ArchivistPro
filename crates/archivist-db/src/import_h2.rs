//! **H2 (ArchivistPro ≤3.2.2) veri aktariminin DB primitifleri** — `archivist-h2import`
//! crate'i H3'e YALNIZ bu kapilardan yazar (kullanici karari 2026-08-10, tam-aktarim modeli).
//!
//! ## Neden `Db::ingest` DEGIL (olculdu, varsayim degil)
//! `ingest` `indexed_at = now` yazar (`write.rs` upsert'i) ve artimsal tarayicinin atlama
//! kurali "indexed VE boyut/mtime ayni → dosyaya DOKUNMA"dir (`archivist-ingest
//! prepare.rs`). Import H2'nin boyut+mtime degerlerini yazacagi icin `ingest` kullanilsaydi
//! gercek tarama bu dosyalari SONSUZA DEK atlardi: BLAKE3 hash hic uretilmez, cikarim hic
//! kosmaz, H2'nin dusuk-kalite thumbnail'i kalicilasirdi. Buradaki primitifler
//! `indexed_at = NULL` birakir → ilk gercek tarama dosyayi dogal olarak devralir.
//!
//! ## Sozlesmeler
//! - **Var olan H3 satiri KAZANIR:** `import_h2_asset` var-olana DOKUNMAZ; H3'un kendi
//!   taramasindan dogmus satirlarin hicbir alani H2'nin bayat degerleriyle ezilmez.
//! - **Yalniz-yoksa yazicilar:** thumbnail / `ai_gorsel_turu` / proje-meta H3 tarafinda
//!   deger VARSA dokunmaz (kullanici verisi ezilmez; `set_project_meta` full-replace
//!   oldugundan burada ayri korumali primitif gerekir).
//! - **Idempotent:** ayni import ikinci kez kosuldugunda tum primitifler no-op'tur.

use rusqlite::params;

use crate::error::DbError;
use crate::write::{ProjectMeta, ThumbnailInput};
use crate::Db;

/// `query_row` sonucunu `Option`a cevir (yok = None, baska hata = Err).
fn opt_row<T>(r: rusqlite::Result<T>) -> Result<Option<T>, DbError> {
    match r {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// H2'den tasinan bir asset satirinin H3 karsiligi. `content_hash`/`phash` BILEREK yok
/// (SHA-256≠BLAKE3, TEXT≠INTEGER — yanlis-bicim degerler fixity/dedup'i zehirler;
/// gercek tarama dogru degerleri uretir).
#[derive(Debug)]
pub struct ImportAssetRow<'a> {
    /// Normalize edilmis MUTLAK yol (ayraclar `\`, uzun-yol oneki soyulmus, kasa korunmus).
    pub path: &'a str,
    pub file_name: &'a str,
    /// Kucuk-harf uzanti (yoldan turetilmis) — H3 ingest paritesi.
    pub ext: Option<&'a str>,
    pub size_bytes: i64,
    pub created_at: i64,
    pub modified_at: i64,
    /// `Some(ts)` → satir dogrudan COPTE dogar (H2 `is_deleted=1` esleme).
    pub deleted_at: Option<i64>,
    /// H2'nin 16-hex kimligi → `asset_metadata['h2_id']` (izlenebilirlik; gercek re-ingest
    /// ai-disi EAV'yi tazeledigi icin KALICI degildir — bilincli, dokumante sinir).
    pub h2_id: Option<&'a str>,
}

/// Bir H3 asset'inin import kararlari icin mevcut-durum sondasi.
/// Kuru kosu ve uygula AYNI karari bu sondadan verir (tutarlilik tek kaynaktan).
#[derive(Debug, Clone, Default)]
pub struct ImportProbe {
    pub id: i64,
    pub deleted: bool,
    pub has_ai: bool,
    pub has_thumb: bool,
    pub has_gorsel_turu: bool,
    pub has_project_meta: bool,
}

impl Db {
    /// H2 asset satirini upsert et — var-olana dokunmadan.
    ///
    /// Var-olma yoklamasi `COLLATE NOCASE` iledir: `d:\x` ile `D:\x` ayni dosyadir (ASCII
    /// kasa) — kor INSERT ikinci satir acardi. NOCASE ASCII'dir; Turkce kasa farklari
    /// (`İ/ı`) katlanmaz — bilincli sinir; cagiran katman kanonik anahtarla gruplayarak
    /// (h2import `canonical_path_key`) genis katlamayi kendi yapar.
    ///
    /// Donen: `(asset_id, inserted)`. `inserted=false` → H3 satiri zaten vardi (KAZANDI).
    pub fn import_h2_asset(&mut self, a: &ImportAssetRow<'_>) -> Result<(i64, bool), DbError> {
        let tx = self.conn.transaction()?;

        // NOCASE yoklama (UNIQUE index kasa-duyarli oldugundan ON CONFLICT tek basina yetmez).
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM assets WHERE path = ?1 COLLATE NOCASE LIMIT 1",
                params![a.path],
                |r| r.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        if let Some(id) = existing {
            tx.commit()?;
            return Ok((id, false));
        }

        // indexed_at = NULL → "H3 hic cikarim yapmadi" gercegi; ilk tarama devralir.
        tx.execute(
            "INSERT INTO assets
                 (path, file_name, ext, size_bytes, created_at, modified_at,
                  indexed_at, deleted_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)",
            params![
                a.path,
                a.file_name,
                a.ext,
                a.size_bytes,
                a.created_at,
                a.modified_at,
                a.deleted_at,
            ],
        )?;
        let id = tx.last_insert_rowid();
        if let Some(h2_id) = a.h2_id {
            tx.execute(
                "INSERT OR IGNORE INTO asset_metadata(asset_id, key, value_text, value_num)
                 VALUES (?1, 'h2_id', ?2, NULL)",
                params![id, h2_id],
            )?;
        }
        tx.commit()?;
        Ok((id, true))
    }

    /// Yol icin mevcut-durum sondasi (NOCASE). `None` → H3'te satir yok.
    pub fn import_probe(&self, path: &str) -> Result<Option<ImportProbe>, DbError> {
        let row: Option<(i64, bool)> = self
            .conn
            .query_row(
                "SELECT id, deleted_at IS NOT NULL
                 FROM assets WHERE path = ?1 COLLATE NOCASE LIMIT 1",
                params![path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        let Some((id, deleted)) = row else { return Ok(None) };

        let has_key = |key: &str| -> Result<bool, rusqlite::Error> {
            self.conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM asset_metadata WHERE asset_id = ?1 AND key = ?2)",
                params![id, key],
                |r| r.get(0),
            )
        };
        let has_ai = has_key("ai_analyzed")?;
        let has_gorsel_turu = has_key("ai_gorsel_turu")?;
        let has_thumb: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM asset_thumbnails WHERE asset_id = ?1)",
            params![id],
            |r| r.get(0),
        )?;
        // Proje-meta "dolu" tanimi: 4 serbest alandan biri dolu VEYA status draft-disi.
        let has_project_meta: bool = self.conn.query_row(
            "SELECT client_name IS NOT NULL OR rejection_reason IS NOT NULL
                    OR version_label IS NOT NULL OR deadline IS NOT NULL
                    OR (approval_status IS NOT NULL AND approval_status <> 'draft')
             FROM assets WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        Ok(Some(ImportProbe { id, deleted, has_ai, has_thumb, has_gorsel_turu, has_project_meta }))
    }

    /// Thumbnail'i YALNIZ YOKSA yaz (PK=asset_id → `INSERT OR IGNORE`). Gercek tarama
    /// replace-eder (ingest thumbnail'i siler-yazar) → H2'ninki gecici yer tutucudur.
    /// Donen: yazildi mi.
    pub fn import_thumbnail_if_absent(
        &self,
        asset_id: i64,
        t: &ThumbnailInput<'_>,
    ) -> Result<bool, DbError> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO asset_thumbnails(asset_id, mime, width, height, bytes)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![asset_id, t.mime, t.width, t.height, t.bytes],
        )?;
        Ok(n == 1)
    }

    /// `ai_gorsel_turu`'nu YALNIZ YOKSA yaz. `set_ai_metadata` bu anahtari SILMEZ
    /// (bilincli istisna) ama kor INSERT PK cakismasi/mukerrer uretirdi → korumali kapi.
    pub fn set_ai_gorsel_turu_if_absent(&self, asset_id: i64, value: &str) -> Result<bool, DbError> {
        let n = self.conn.execute(
            "INSERT OR IGNORE INTO asset_metadata(asset_id, key, value_text, value_num)
             VALUES (?1, 'ai_gorsel_turu', ?2, NULL)",
            params![asset_id, value],
        )?;
        Ok(n == 1)
    }

    // ── Idempotent sayim icin "var mi / bul" yardimcilari ──
    // Hem canli yazim (import_*) hem kuru-kosu simulasyonu AYNI sorgulari kullanir;
    // ayri yazilsalardi kuru kosu ile uygula farkli sayilar uretirdi.

    pub fn find_collection_id(&self, name: &str) -> Result<Option<i64>, DbError> {
        opt_row(self.conn.query_row(
            "SELECT id FROM collections WHERE name = ?1",
            params![name.trim()],
            |r| r.get(0),
        ))
    }

    pub fn find_root_group_id(&self, name: &str) -> Result<Option<i64>, DbError> {
        opt_row(self.conn.query_row(
            "SELECT id FROM root_groups WHERE name = ?1",
            params![name.trim()],
            |r| r.get(0),
        ))
    }

    pub fn find_scanned_root_id(&self, path: &str) -> Result<Option<i64>, DbError> {
        opt_row(self.conn.query_row(
            "SELECT id FROM scanned_roots WHERE path = ?1",
            params![path],
            |r| r.get(0),
        ))
    }

    pub fn asset_has_user_tag(&self, asset_id: i64, name: &str) -> Result<bool, DbError> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM asset_tags at JOIN tags t ON t.id = at.tag_id
                           WHERE at.asset_id = ?1 AND t.name = ?2)",
            params![asset_id, name.trim()],
            |r| r.get(0),
        )?)
    }

    pub fn asset_is_favorite(&self, asset_id: i64) -> Result<bool, DbError> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM favorites WHERE asset_id = ?1)",
            params![asset_id],
            |r| r.get(0),
        )?)
    }

    pub fn collection_contains(&self, collection_id: i64, asset_id: i64) -> Result<bool, DbError> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM collection_items
                           WHERE collection_id = ?1 AND asset_id = ?2)",
            params![collection_id, asset_id],
            |r| r.get(0),
        )?)
    }

    /// Proje-meta dolu mu (kuru-kosu simulasyonu `import_project_meta_if_absent` ile
    /// AYNI olcutu kullansin diye ayri sorgu olarak da acik).
    pub fn asset_has_project_meta(&self, asset_id: i64) -> Result<bool, DbError> {
        Ok(self.conn.query_row(
            "SELECT client_name IS NOT NULL OR rejection_reason IS NOT NULL
                    OR version_label IS NOT NULL OR deadline IS NOT NULL
                    OR (approval_status IS NOT NULL AND approval_status <> 'draft')
             FROM assets WHERE id = ?1",
            params![asset_id],
            |r| r.get(0),
        )?)
    }

    pub fn root_has_tag(&self, root_id: i64, name: &str) -> Result<bool, DbError> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM root_tags rt JOIN tags t ON t.id = rt.tag_id
                           WHERE rt.root_id = ?1 AND t.name = ?2)",
            params![root_id, name.trim()],
            |r| r.get(0),
        )?)
    }

    // ── Idempotent canli yazicilar (donen bool/created = SAYACA girer) ──

    /// Kullanici etiketi: YOKSA ekle. Donen: eklendi mi (idempotent sayim).
    pub fn import_user_tag(&mut self, asset_id: i64, name: &str) -> Result<bool, DbError> {
        if self.asset_has_user_tag(asset_id, name)? {
            return Ok(false);
        }
        self.add_user_tag(asset_id, name)?;
        Ok(true)
    }

    /// Favori: YOKSA isaretle. Donen: eklendi mi.
    pub fn import_favorite(&self, asset_id: i64) -> Result<bool, DbError> {
        if self.asset_is_favorite(asset_id)? {
            return Ok(false);
        }
        self.set_favorite(asset_id, true)?;
        Ok(true)
    }

    /// Koleksiyon get-or-create (ad benzersiz). Donen: `(id, created)`.
    pub fn import_collection(
        &mut self,
        name: &str,
        color: Option<&str>,
    ) -> Result<(i64, bool), DbError> {
        if let Some(id) = self.find_collection_id(name)? {
            return Ok((id, false));
        }
        let id = self.create_collection(name, color)?;
        Ok((id, true))
    }

    /// Koleksiyon uyeligi: YOKSA ekle. Donen: eklendi mi.
    pub fn import_collection_item(
        &self,
        collection_id: i64,
        asset_id: i64,
    ) -> Result<bool, DbError> {
        if self.collection_contains(collection_id, asset_id)? {
            return Ok(false);
        }
        self.add_to_collection(collection_id, asset_id)?;
        Ok(true)
    }

    /// Kok grubu get-or-create (ad ile — H2 UUID kimligi H3'e tasinmaz).
    /// ⚠️ `create_root_group` duz INSERT'tir; get-or-create olmadan ikinci kosu
    /// MUKERRER grup uretirdi (idempotency kilidi).
    pub fn import_root_group(
        &self,
        name: &str,
        color: Option<&str>,
        now: i64,
    ) -> Result<(i64, bool), DbError> {
        if let Some(id) = self.find_root_group_id(name)? {
            return Ok((id, false));
        }
        let id = self.create_root_group(name, color.unwrap_or("#6366f1"), now)?;
        Ok((id, true))
    }

    /// Kok etiketi: YOKSA ekle. Donen: eklendi mi.
    pub fn import_root_tag(&mut self, root_id: i64, name: &str) -> Result<bool, DbError> {
        if self.root_has_tag(root_id, name)? {
            return Ok(false);
        }
        self.add_root_tag(root_id, name)?;
        Ok(true)
    }

    /// Proje-durum alanlarini YALNIZ H3 tarafi tamamen bos/draft ise yaz.
    /// (`set_project_meta` full-replace'tir → H3'te elle girilmis degeri ezerdi.)
    pub fn import_project_meta_if_absent(
        &self,
        asset_id: i64,
        meta: &ProjectMeta,
    ) -> Result<bool, DbError> {
        let occupied: bool = self.conn.query_row(
            "SELECT client_name IS NOT NULL OR rejection_reason IS NOT NULL
                    OR version_label IS NOT NULL OR deadline IS NOT NULL
                    OR (approval_status IS NOT NULL AND approval_status <> 'draft')
             FROM assets WHERE id = ?1",
            params![asset_id],
            |r| r.get(0),
        )?;
        if occupied {
            return Ok(false);
        }
        self.set_project_meta(asset_id, meta)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::{AssetInput, IngestData};

    fn db() -> Db {
        Db::open_in_memory_migrated().expect("bellek-ici DB")
    }

    fn row<'a>(path: &'a str, name: &'a str) -> ImportAssetRow<'a> {
        ImportAssetRow {
            path,
            file_name: name,
            ext: Some("jpg"),
            size_bytes: 1234,
            created_at: 1_700_000_000,
            modified_at: 1_700_000_000,
            deleted_at: None,
            h2_id: Some("abcd1234abcd1234"),
        }
    }

    /// Import edilen satir `indexed_at = NULL` birakmali — bu, artimsal taramanin dosyayi
    /// DEVRALMASININ on kosulu (ingest kullanilsaydi indexed_at dolar, tarama atlardi).
    #[test]
    fn imported_rows_leave_indexed_at_null_so_scan_takes_over() {
        let mut db = db();
        let (id, inserted) = db.import_h2_asset(&row("D:\\p\\a.jpg", "a.jpg")).unwrap();
        assert!(inserted);
        let indexed_at: Option<i64> = db
            .conn
            .query_row("SELECT indexed_at FROM assets WHERE id=?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(indexed_at, None, "indexed_at NULL kalmali (tarama devralsin)");
        // h2_id izlenebilirlik EAV'si yazildi.
        let h2id: String = db
            .conn
            .query_row(
                "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='h2_id'",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(h2id, "abcd1234abcd1234");
    }

    /// ASCII kasa farki ikinci satir ACMAMALI (NOCASE yoklama).
    #[test]
    fn nocase_probe_prevents_ascii_case_duplicates() {
        let mut db = db();
        let (id1, ins1) = db.import_h2_asset(&row("D:\\P\\A.JPG", "A.JPG")).unwrap();
        let (id2, ins2) = db.import_h2_asset(&row("d:\\p\\a.jpg", "a.jpg")).unwrap();
        assert!(ins1);
        assert!(!ins2, "kasa varyanti insert etmemeli");
        assert_eq!(id1, id2);
    }

    /// Var olan H3 satiri KAZANIR — hicbir alani ezilmez.
    #[test]
    fn existing_h3_row_wins_untouched() {
        let mut db = db();
        let id = db
            .ingest(
                &AssetInput {
                    path: "D:\\p\\real.jpg",
                    file_name: "real.jpg",
                    ext: Some("jpg"),
                    size_bytes: 999,
                    content_hash: Some("blake3-gercek"),
                    mime: None,
                    title: None,
                    description: None,
                    created_at: 1,
                    modified_at: 2,
                },
                &IngestData {
                    fts_body: None,
                    metadata: &[],
                    auto_tags: &[],
                    phash: None,
                    thumbnail: None,
                },
            )
            .unwrap();
        let (pid, inserted) = db.import_h2_asset(&row("D:\\p\\real.jpg", "real.jpg")).unwrap();
        assert!(!inserted);
        assert_eq!(pid, id);
        let (size, hash): (i64, Option<String>) = db
            .conn
            .query_row(
                "SELECT size_bytes, content_hash FROM assets WHERE id=?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(size, 999, "H3 boyutu korunmali (H2'nin 1234'u YAZILMAMALI)");
        assert_eq!(hash.as_deref(), Some("blake3-gercek"), "hash korunmali");
    }

    /// H2 copundeki satir H3'te dogrudan copte dogar.
    #[test]
    fn deleted_h2_row_is_born_in_trash() {
        let mut db = db();
        let mut r = row("D:\\p\\silinmis.jpg", "silinmis.jpg");
        r.deleted_at = Some(1_650_000_000);
        let (id, _) = db.import_h2_asset(&r).unwrap();
        let deleted_at: Option<i64> = db
            .conn
            .query_row("SELECT deleted_at FROM assets WHERE id=?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(deleted_at, Some(1_650_000_000));
    }

    /// Yalniz-yoksa yazicilar: ikinci yazim no-op; mevcut deger korunur.
    #[test]
    fn if_absent_writers_never_overwrite() {
        let mut db = db();
        let (id, _) = db.import_h2_asset(&row("D:\\p\\x.jpg", "x.jpg")).unwrap();

        // ai_gorsel_turu
        assert!(db.set_ai_gorsel_turu_if_absent(id, "Render").unwrap());
        assert!(!db.set_ai_gorsel_turu_if_absent(id, "Fotoğraf").unwrap());
        let v: String = db
            .conn
            .query_row(
                "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='ai_gorsel_turu'",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v, "Render");

        // thumbnail
        let t1 = ThumbnailInput { mime: "image/jpeg", width: 10, height: 10, bytes: &[1, 2, 3] };
        let t2 = ThumbnailInput { mime: "image/png", width: 5, height: 5, bytes: &[9] };
        assert!(db.import_thumbnail_if_absent(id, &t1).unwrap());
        assert!(!db.import_thumbnail_if_absent(id, &t2).unwrap());
        let mime: String = db
            .conn
            .query_row(
                "SELECT mime FROM asset_thumbnails WHERE asset_id=?1",
                params![id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(mime, "image/jpeg");

        // proje-meta: bos → yazilir; dolu → ikinci yazim no-op.
        let m1 = ProjectMeta {
            client_name: Some("Musteri".into()),
            approval_status: Some("review".into()),
            rejection_reason: None,
            version_label: None,
            deadline: None,
        };
        let m2 = ProjectMeta { client_name: Some("BASKA".into()), ..m1.clone() };
        assert!(db.import_project_meta_if_absent(id, &m1).unwrap());
        assert!(!db.import_project_meta_if_absent(id, &m2).unwrap());
        let client: String = db
            .conn
            .query_row("SELECT client_name FROM assets WHERE id=?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(client, "Musteri");
    }

    /// Sonda tum bayraklari dogru okur.
    #[test]
    fn probe_reflects_state() {
        let mut db = db();
        assert!(db.import_probe("D:\\yok\\boyle.jpg").unwrap().is_none());
        let (id, _) = db.import_h2_asset(&row("D:\\p\\probe.jpg", "probe.jpg")).unwrap();
        let p = db.import_probe("d:\\P\\PROBE.jpg").unwrap().expect("NOCASE bulmali");
        assert_eq!(p.id, id);
        assert!(!p.deleted && !p.has_ai && !p.has_thumb && !p.has_gorsel_turu && !p.has_project_meta);

        db.set_ai_metadata(id, &[("ai_aciklama", "test".into())]).unwrap();
        db.set_ai_gorsel_turu_if_absent(id, "Render").unwrap();
        let p = db.import_probe("D:\\p\\probe.jpg").unwrap().unwrap();
        assert!(p.has_ai && p.has_gorsel_turu);
    }
}
