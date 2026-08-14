//! Facet (gruplama) sayimlari — kenar cubugu filtreleri: uzanti / metadata degeri /
//! kullanici etiketi / proje-durum alanlari (onay/musteri/versiyon/termin) + favori sayisi.
//! Hepsi §O kuralini paylasir: cop'teki (soft-delete) asset'ler sayima girmez.

use rusqlite::params;

use crate::error::DbError;
use crate::Db;

use super::Facet;

impl Db {
    /// Uzantiya gore asset sayilari (azalan). `value=None` → uzantisiz. Tur filtre faceti.
    /// §O: cop'teki asset'ler sayilmaz (`deleted_at IS NULL`).
    pub fn ext_facets(&self) -> Result<Vec<Facet>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT ext, count(*) FROM assets
             WHERE deleted_at IS NULL
             GROUP BY ext ORDER BY count(*) DESC, ext",
        )?;
        let rows = stmt
            .query_map([], |r| Ok(Facet { value: r.get(0)?, count: r.get(1)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Bir metadata key icin deger sayilari (azalan, en cok `limit`). Or. key='author'
    /// → yazarlar + sayilari. NULL degerler haric.
    pub fn metadata_facets(&self, key: &str, limit: i64) -> Result<Vec<Facet>, DbError> {
        let limit = limit.clamp(1, 200);
        // §O: soft-delete metadata satirlarini SILMEZ → cop'teki asset'in degerleri
        // sayima sizmasin diye sahip asset'in aktif (deleted_at IS NULL) oldugu
        // EXISTS ile dogrulanir.
        let mut stmt = self.conn.prepare(
            "SELECT m.value_text, count(*) FROM asset_metadata m
             WHERE m.key = ?1 AND m.value_text IS NOT NULL
               AND EXISTS (SELECT 1 FROM assets a
                           WHERE a.id = m.asset_id AND a.deleted_at IS NULL)
             GROUP BY m.value_text ORDER BY count(*) DESC, m.value_text LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![key, limit], |r| {
                Ok(Facet { value: r.get(0)?, count: r.get(1)? })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Kullanici etiketleri + asset sayilari (azalan, en cok `limit`). Kurasyon faceti
    /// (yalniz kind='user' — kullanicinin olusturduklari).
    pub fn tag_facets(&self, limit: i64) -> Result<Vec<Facet>, DbError> {
        let limit = limit.clamp(1, 200);
        // §O: soft-delete asset_tags baglarini SILMEZ → yalniz aktif (deleted_at IS NULL)
        // asset'lerin baglari sayilir (cop'teki asset etiket sayisini sismez).
        let mut stmt = self.conn.prepare(
            "SELECT t.name, count(*) FROM tags t
             JOIN asset_tags at ON at.tag_id = t.id
             JOIN assets a ON a.id = at.asset_id
             WHERE t.kind = 'user' AND a.deleted_at IS NULL
             GROUP BY t.id ORDER BY count(*) DESC, t.name LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(Facet { value: r.get(0)?, count: r.get(1)? })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Onay durumuna gore asset sayilari (azalan) — proje-durum faceti (H2 pariti).
    /// Yalniz `approval_status` ayarlanmis (NOT NULL) asset'ler; `value` = durum
    /// (draft|review|approved|rejected). §O: cop'teki asset'ler sayilmaz
    /// (`deleted_at IS NULL` — `ext_facets`/`tag_facets` ile ayni soft-delete kurali).
    pub fn approval_facets(&self) -> Result<Vec<Facet>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT approval_status, count(*) FROM assets
             WHERE deleted_at IS NULL AND approval_status IS NOT NULL
             GROUP BY approval_status ORDER BY count(*) DESC, approval_status",
        )?;
        let rows = stmt
            .query_map([], |r| Ok(Facet { value: r.get(0)?, count: r.get(1)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Gorsel MEDYA turune gore asset sayilari (azalan) — AI-turevi facet. Deger = `ai_gorsel_turu`
    /// EAV token'i (Katman 1 heuristik VEYA Katman 2 vision yazar): `Fotoğraf` | `Render` | `Doku`.
    /// Yalniz dolu (NOT NULL) degerler. `metadata_facets` ile ayni EAV + soft-delete deseni:
    /// soft-delete asset_metadata satirini SILMEZ → sahip asset'in aktif (`deleted_at IS NULL`)
    /// oldugu EXISTS ile dogrulanir (cop'teki asset sayima sizmaz). Sira: `approval_facets` gibi
    /// count azalan, esitlikte deger (deterministik).
    pub fn gorsel_turu_facets(&self) -> Result<Vec<Facet>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT m.value_text, count(*) FROM asset_metadata m
             WHERE m.key = 'ai_gorsel_turu' AND m.value_text IS NOT NULL
               AND EXISTS (SELECT 1 FROM assets a
                           WHERE a.id = m.asset_id AND a.deleted_at IS NULL)
             GROUP BY m.value_text ORDER BY count(*) DESC, m.value_text",
        )?;
        let rows = stmt
            .query_map([], |r| Ok(Facet { value: r.get(0)?, count: r.get(1)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Musteri adina gore asset sayilari (azalan, en cok `limit`) — proje-durum faceti.
    /// Yalniz `client_name` ayarlanmis (NOT NULL, bos-olmayan) asset'ler. §O: cop haric
    /// (`deleted_at IS NULL` — diger facet'lerle ayni soft-delete kurali).
    pub fn client_facets(&self, limit: i64) -> Result<Vec<Facet>, DbError> {
        let limit = limit.clamp(1, 200);
        let mut stmt = self.conn.prepare(
            "SELECT client_name, count(*) FROM assets
             WHERE deleted_at IS NULL AND client_name IS NOT NULL AND client_name != ''
             GROUP BY client_name ORDER BY count(*) DESC, client_name LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |r| Ok(Facet { value: r.get(0)?, count: r.get(1)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Versiyon etiketine gore asset sayilari (azalan, en cok `limit`) — proje-durum faceti.
    /// Yalniz `version_label` ayarlanmis (NOT NULL, bos-olmayan) asset'ler. §O: cop haric.
    pub fn version_facets(&self, limit: i64) -> Result<Vec<Facet>, DbError> {
        let limit = limit.clamp(1, 200);
        let mut stmt = self.conn.prepare(
            "SELECT version_label, count(*) FROM assets
             WHERE deleted_at IS NULL AND version_label IS NOT NULL AND version_label != ''
             GROUP BY version_label ORDER BY count(*) DESC, version_label LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |r| Ok(Facet { value: r.get(0)?, count: r.get(1)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Termin YILINA gore asset sayilari (yil azalan) — proje-durum faceti. Yil = `deadline`
    /// (ISO YYYY-MM-DD) ilk 4 hanesi; `value` = "2026" vb. Yalniz gecerli (>=4 uzunluk) termin.
    /// §O: cop'teki asset'ler sayilmaz. Yeni yil once (DESC).
    pub fn deadline_year_facets(&self) -> Result<Vec<Facet>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT substr(deadline, 1, 4) AS y, count(*) FROM assets
             WHERE deleted_at IS NULL AND deadline IS NOT NULL AND length(deadline) >= 4
             GROUP BY y ORDER BY y DESC",
        )?;
        let rows = stmt
            .query_map([], |r| Ok(Facet { value: r.get(0)?, count: r.get(1)? }))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Favori asset sayisi (Favoriler filtre rozeti icin).
    /// §O: soft-delete favorites satirini SILMEZ → yalniz aktif asset'lerin favorileri
    /// sayilir (cop'teki bir favori rozeti sismesin).
    pub fn favorite_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM favorites f
             WHERE EXISTS (SELECT 1 FROM assets a
                           WHERE a.id = f.asset_id AND a.deleted_at IS NULL)",
            [],
            |r| r.get(0),
        )?)
    }
}
