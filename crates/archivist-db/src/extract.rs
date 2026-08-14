//! Arsiv EXTRACT (filtreli cikarma) — DB primitifleri.
//!
//! Extract = mevcut arsivin bir ALT-KUMESINI (facet filtreleriyle) yeni bir `.archivistpro`'ya
//! cikarma. Komut katmani (archive_share) akisi: `backup_to(dest)` (tam kopya) → KOPYADA
//! `retain_matching(opts)` (eslesmeyen asset'leri sil + yetim temizle) + VACUUM → manifest. Bu
//! modul yalniz iki saf DB primitifini saglar; paketleme/manifest/move (soft-delete) komut katmaninda.
//!
//! **Filtre = FACET (`FILTER_FRAG`): ext/tag/collection/favori/tarih/onay/proje/yol-prefix.**
//! Tam-metin (FTS `query`) UYGULANMAZ (extract facet-tabanli; DELETE-retain'de FTS MATCH gereksiz
//! karmasiklik olurdu — H3 karari). `ListOpts` reuse: frontend'in liste/facet icin zaten kurdugu
//! ayni filtre → "aktif filtrene uyanlari cikar".

use crate::error::DbError;
use crate::health;
use crate::query::{FilterBinds, ListOpts, FILTER_FRAG};
use crate::Db;

impl Db {
    /// Facet filtresine (`FILTER_FRAG`) uyan AKTIF asset id'leri (artan; FTS `query` yok sayilir).
    /// Extract count/onizleme + `move` modu (kaynaktan soft-delete) icin kaynak-tarafi id kumesi.
    pub fn ids_matching(&self, opts: &ListOpts) -> Result<Vec<i64>, DbError> {
        let binds = FilterBinds::new(opts);
        let sql = format!("SELECT a.id FROM assets a WHERE {FILTER_FRAG} ORDER BY a.id");
        let mut stmt = self.conn.prepare(&sql)?;
        let ids = stmt
            .query_map(binds.params().as_slice(), |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(ids)
    }

    /// **Extract cekirdegi (KOPYADA calisir):** facet filtresine uymayan (VE cop'teki) TUM
    /// asset'leri sil → yetim iliskili satirlari temizle → kalan (eslesen) AKTIF asset sayisini doner.
    ///
    /// DELETE, FK CASCADE (asset_tags/relations/asset_metadata/…) + FTS `AFTER DELETE` trigger'ini
    /// tetikler; `purge_orphans` FK'siz artiklari (vec0: asset/image/chunk vektorleri · chunk_fts ·
    /// diger yetimler) temizler → cikan arsiv tutarli (`orphan_count == 0`). Bos filtre → hepsi
    /// eslesir (silme yok). Kaynagin cop'teki asset'leri eslesme-disi → cikan arsive girmez.
    ///
    /// ⚠️ **YIKICI — YALNIZ export KOPYASI uzerinde cagrilmali (canli arsivde ASLA).** Cagiran
    /// (`do_extract`) once `backup_to` ile kopya alir, sonra bu metodu KOPYA'nin `Db`'sinde kosar.
    /// Kopya disposable → DELETE + purge ayri islemler (atomiklik gerekmez; hata → kopya silinir).
    pub fn retain_matching(&mut self, opts: &ListOpts) -> Result<i64, DbError> {
        let binds = FilterBinds::new(opts);
        // Eslesen id kumesi DISINDAKI (cop dahil) TUM asset'leri sil.
        let sql = format!(
            "DELETE FROM assets WHERE id NOT IN (SELECT a.id FROM assets a WHERE {FILTER_FRAG})"
        );
        self.conn.execute(&sql, binds.params().as_slice())?;
        // Yetim iliskili satirlar (vec0/chunk/metadata/…) — Doctor cekirdegi.
        health::purge_orphans(&mut self.conn)?;
        // Kalan (eslesen) AKTIF asset sayisi = cikarilan asset sayisi.
        self.asset_count()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::write::{AssetInput, IngestData, MetaVal};
    use rusqlite::params;

    /// Minimal asset ekle (ext + modified_at kontrollu) — her birine metadata + auto-tag + FTS
    /// body verilir (silininca yetim kalmamali → purge dogrulanabilir) → id.
    fn add(db: &mut Db, path: &str, ext: &str, modified_at: i64) -> i64 {
        let file_name = path.rsplit(['\\', '/']).next().unwrap_or(path);
        let input = AssetInput {
            path,
            file_name,
            ext: Some(ext),
            size_bytes: 1,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: 0,
            modified_at,
        };
        let meta = vec![("kaynak".to_string(), MetaVal::Text("x".to_string()))];
        let tags = vec!["auto".to_string()];
        let data = IngestData {
            fts_body: Some("govde metni"),
            metadata: &meta,
            auto_tags: &tags,
            phash: None,
            thumbnail: None,
        };
        db.ingest(&input, &data).unwrap();
        db.connection()
            .query_row("SELECT id FROM assets WHERE path = ?1", params![path], |r| r.get(0))
            .unwrap()
    }

    fn opts_ext(exts: &[&str]) -> ListOpts {
        ListOpts { ext: exts.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }

    /// retain_matching: yalniz eslesen ext kalir; digerleri + yetim iliskili satirlar temizlenir.
    #[test]
    fn retain_matching_keeps_only_filter_and_purges_orphans() {
        let mut db = Db::open_in_memory_migrated().unwrap();
        let dwg1 = add(&mut db, r"C:\p\a.dwg", "dwg", 100);
        let dwg2 = add(&mut db, r"C:\p\b.dwg", "dwg", 200);
        let pdf1 = add(&mut db, r"C:\p\c.pdf", "pdf", 150); // metadata+tag `add` icinde verildi

        // Yalniz dwg'leri tut.
        let kept = db.retain_matching(&opts_ext(&["dwg"])).unwrap();
        assert_eq!(kept, 2, "iki dwg kalmali");

        let remaining: Vec<i64> = {
            let conn = db.connection();
            let mut stmt = conn.prepare("SELECT id FROM assets ORDER BY id").unwrap();
            stmt.query_map([], |r| r.get::<_, i64>(0)).unwrap().map(Result::unwrap).collect()
        };
        assert_eq!(remaining, vec![dwg1, dwg2], "yalniz dwg id'leri kalmali");

        // pdf'in metadata/tag baglari yetim kalmadi (CASCADE + purge).
        assert_eq!(db.orphan_count().unwrap(), 0, "yetim kalmamali");
        let pdf_meta: i64 = db
            .connection()
            .query_row(
                "SELECT count(*) FROM asset_metadata WHERE asset_id = ?1",
                params![pdf1],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pdf_meta, 0, "silinen asset'in metadata'si CASCADE ile gitti");
    }

    /// ids_matching: facet filtresine uyan aktif id'ler (tarih araligi + ext AND).
    #[test]
    fn ids_matching_applies_facets() {
        let mut db = Db::open_in_memory_migrated().unwrap();
        let a = add(&mut db, r"C:\p\a.dwg", "dwg", 100);
        let _b = add(&mut db, r"C:\p\b.dwg", "dwg", 500); // tarih ust-siniri disinda
        let _c = add(&mut db, r"C:\p\c.pdf", "pdf", 100); // ext disinda

        let opts = ListOpts {
            ext: vec!["dwg".into()],
            modified_before: Some(200),
            ..Default::default()
        };
        assert_eq!(db.ids_matching(&opts).unwrap(), vec![a], "yalniz dwg + tarih<=200");

        // Bos filtre → tum aktif id'ler.
        assert_eq!(db.ids_matching(&ListOpts::default()).unwrap().len(), 3);
    }

    /// Bos filtre → retain hicbir seyi silmez (tam arsiv kopyasi = export).
    #[test]
    fn retain_empty_filter_keeps_all() {
        let mut db = Db::open_in_memory_migrated().unwrap();
        add(&mut db, r"C:\p\a.dwg", "dwg", 100);
        add(&mut db, r"C:\p\b.pdf", "pdf", 200);
        assert_eq!(db.retain_matching(&ListOpts::default()).unwrap(), 2);
        assert_eq!(db.orphan_count().unwrap(), 0);
    }
}
