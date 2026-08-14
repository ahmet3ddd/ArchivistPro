//! Butunluk + onarim cekirdegi — Faz 6 "Doctor" panelinin acilacagi komutlar.
//! (data-migration ajani: "butunluk birinci sinif".)

use crate::error::DbError;
use rusqlite::Connection;

/// `PRAGMA integrity_check` — saglamsa true. Hizli varyant (ilk hatada durur).
pub fn integrity_ok(conn: &Connection) -> Result<bool, DbError> {
    let result: String = conn.query_row("PRAGMA integrity_check(1)", [], |r| r.get(0))?;
    Ok(result == "ok")
}

/// Hicbir ust-kayda baglanmayan yetim satir sayisi — 7 kaynak. **Asset-duzeyi** (asset'i olmayan):
/// assets_fts · asset_vectors · asset_image_region_vectors · asset_tags · relations. **Chunk-duzeyi**
/// (parent text_chunks / asset'i olmayan): chunk_vectors · chunk_fts. FK CASCADE iliskisel
/// tablolari korur; FTS/vektor sanal tablolari korumaz → asil yetim riski oralarda. chunk_vectors/
/// chunk_fts FK/trigger YOK, elle yonetilir → hard-delete/kismi-yazim/cokme strand birakabilir.
/// Doctor "purge" bunun uzerine kurulur. Gorsel bolge tablosu PK-kodlamali (`id = asset_id*8 +
/// region`) → asset'i `id / 8` ile turetilir (kodlama image.rs IMAGE_REGION_STRIDE).
pub fn orphan_count(conn: &Connection) -> Result<i64, DbError> {
    let n: i64 = conn.query_row(
        "SELECT
            (SELECT count(*) FROM assets_fts
                WHERE asset_id NOT IN (SELECT id FROM assets)) +
            (SELECT count(*) FROM asset_vectors
                WHERE asset_id NOT IN (SELECT id FROM assets)) +
            (SELECT count(*) FROM asset_image_region_vectors
                WHERE id / 8 NOT IN (SELECT id FROM assets)) +
            (SELECT count(*) FROM asset_tags
                WHERE asset_id NOT IN (SELECT id FROM assets)) +
            (SELECT count(*) FROM relations
                WHERE src_id NOT IN (SELECT id FROM assets)
                   OR dst_id NOT IN (SELECT id FROM assets)) +
            (SELECT count(*) FROM chunk_vectors
                WHERE chunk_id NOT IN (SELECT id FROM text_chunks)) +
            (SELECT count(*) FROM chunk_fts
                WHERE chunk_id NOT IN (SELECT id FROM text_chunks)
                   OR asset_id NOT IN (SELECT id FROM assets))",
        [],
        |r| r.get(0),
    )?;
    Ok(n)
}

/// Yetim satirlari (ust-kaydi olmayan) SIL — Doctor **onarim** cekirdegi. [`orphan_count`] ile AYNI 7
/// kaynak (assets_fts · asset_vectors · asset_image_region_vectors · asset_tags · relations ·
/// chunk_vectors · chunk_fts) → "N yetim sayildi" ile "N silindi" tutarli. Silinen toplam satir doner.
/// Tek TX (atomik). vec0/FTS sanal tablolari FK/trigger korumaz (asil yetim orada); asset_tags/
/// relations FK CASCADE'li ama savunma icin dahil (idempotent: yetim yoksa 0). chunk_vectors/
/// chunk_fts: parent text_chunks (asset'e CASCADE ile bagli) gidince ELLE temizlenmezse strand
/// kalir (RAG indeks yetimi) → burada toplanir.
pub fn purge_orphans(conn: &mut Connection) -> Result<u64, DbError> {
    let tx = conn.transaction()?;
    let mut removed: u64 = 0;
    for sql in [
        "DELETE FROM assets_fts WHERE asset_id NOT IN (SELECT id FROM assets)",
        "DELETE FROM asset_vectors WHERE asset_id NOT IN (SELECT id FROM assets)",
        "DELETE FROM asset_image_region_vectors WHERE id / 8 NOT IN (SELECT id FROM assets)",
        "DELETE FROM asset_tags WHERE asset_id NOT IN (SELECT id FROM assets)",
        "DELETE FROM relations
            WHERE src_id NOT IN (SELECT id FROM assets)
               OR dst_id NOT IN (SELECT id FROM assets)",
        "DELETE FROM chunk_vectors WHERE chunk_id NOT IN (SELECT id FROM text_chunks)",
        "DELETE FROM chunk_fts
            WHERE chunk_id NOT IN (SELECT id FROM text_chunks)
               OR asset_id NOT IN (SELECT id FROM assets)",
    ] {
        removed += tx.execute(sql, [])? as u64;
    }
    tx.commit()?;
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use crate::Db;

    #[test]
    fn purge_orphans_on_clean_db_is_valid_and_removes_nothing() {
        // Temiz DB'de yetim yok → 0; ama 7 DELETE'in de SQL-gecerli oldugunu (dogru tablo/kolon)
        // dogrular (asil risk yanlis tablo adi). orphan_count sonrasi hala calisir.
        let mut db = Db::open_in_memory_migrated().unwrap();
        assert_eq!(db.purge_orphans().unwrap(), 0);
        assert_eq!(db.orphan_count().unwrap(), 0);
        assert!(db.integrity_ok().unwrap());
    }

    #[test]
    fn orphan_count_and_purge_cover_chunk_vectors_and_fts() {
        use crate::chunk::ChunkWrite;
        use crate::semantic::TEXT_EMBED_DIM;

        let mut db = Db::open_in_memory_migrated().unwrap();
        // Gercek yazma yolu: asset + chunk → text_chunks + chunk_vectors + chunk_fts (saglikli).
        db.connection()
            .execute(
                "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
                 VALUES (1, '/a/x.txt', 'x.txt', 'txt', 10, 1, 1)",
                [],
            )
            .unwrap();
        db.set_asset_chunks(
            1,
            &[ChunkWrite {
                chunk_index: 0,
                page: None,
                text: "govde metni".into(),
                embedding: vec![0.0f32; TEXT_EMBED_DIM],
            }],
        )
        .unwrap();
        assert_eq!(db.orphan_count().unwrap(), 0, "saglikli chunk yetim degil");

        // Yetim uret: text_chunks + asset'i ELLE sil (chunk_vectors/chunk_fts elle temizlenmedi →
        // strand). text_chunks silinince chunk_vectors.chunk_id parentsiz; asset silinince
        // chunk_fts.asset_id parentsiz. (assets_fts trigger'i asset silinince kendi satirini
        // temizler → tek yetim kaynagi chunk_* olur.)
        db.connection().execute("DELETE FROM text_chunks WHERE asset_id = 1", []).unwrap();
        db.connection().execute("DELETE FROM assets WHERE id = 1", []).unwrap();

        assert_eq!(
            db.orphan_count().unwrap(),
            2,
            "chunk_vectors + chunk_fts yetimleri sayilmali (7-kaynak kapsami)"
        );
        assert_eq!(db.purge_orphans().unwrap(), 2, "ikisi de tek TX'te silinmeli");
        assert_eq!(db.orphan_count().unwrap(), 0, "onarim sonrasi temiz");
        assert!(db.integrity_ok().unwrap());
    }
}
