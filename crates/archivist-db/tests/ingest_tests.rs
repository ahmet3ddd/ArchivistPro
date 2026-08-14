//! İngest yazma API'si testleri — asset upsert + FTS body + metadata + auto-tag + phash.

use archivist_db::{AssetInput, Db, IngestData, MetaVal, ThumbnailInput};
use rusqlite::params;

fn asset(path: &str) -> AssetInput<'_> {
    AssetInput {
        path,
        file_name: "dosya.pdf",
        ext: Some("pdf"),
        size_bytes: 1234,
        content_hash: Some("blake3hex"),
        mime: Some("application/pdf"),
        title: Some("Kule Projesi"),
        description: None,
        created_at: 1_700_000_000,
        modified_at: 1_700_000_500,
    }
}

#[test]
fn ingest_roundtrip_persists_all() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let meta = vec![
        ("author".to_string(), MetaVal::Text("Ahmet".to_string())),
        ("page_count".to_string(), MetaVal::Num(12.0)),
    ];
    let tags = vec!["is_render".to_string()];
    let thumb_bytes = vec![0xFFu8, 0xD8, 0xAA, 0xBB]; // sahte JPEG baytlari
    let data = IngestData {
        fts_body: Some("mimari arsiv villa projesi metni"),
        metadata: &meta,
        auto_tags: &tags,
        phash: Some(0x0123_4567_89AB_CDEF),
        thumbnail: Some(ThumbnailInput {
            mime: "image/jpeg",
            width: 256,
            height: 192,
            bytes: &thumb_bytes,
        }),
    };
    let id = db.ingest(&asset("/arsiv/a.pdf"), &data).unwrap();

    let conn = db.connection();
    // Asset satiri + phash + indexed_at.
    let (ext, title, indexed, phash): (String, String, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT ext, title, indexed_at, phash FROM assets WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap();
    assert_eq!(ext, "pdf");
    assert_eq!(title, "Kule Projesi");
    assert!(indexed.is_some(), "indexed_at dolu olmali");
    assert_eq!(phash, Some(0x0123_4567_89AB_CDEF));

    // FTS body aranabilir.
    let hits: i64 = conn
        .query_row("SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'villa'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(hits, 1, "FTS body 'villa' bulmali");

    // Metadata (EAV): text + num.
    let author: String = conn
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='author'",
            params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(author, "Ahmet");
    let pages: f64 = conn
        .query_row(
            "SELECT value_num FROM asset_metadata WHERE asset_id=?1 AND key='page_count'",
            params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert!((pages - 12.0).abs() < 1e-9);

    // Auto-tag baglandi (kind='auto').
    let kind: String = conn
        .query_row(
            "SELECT t.kind FROM tags t JOIN asset_tags at ON at.tag_id=t.id
             WHERE at.asset_id=?1 AND t.name='is_render'",
            params![id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kind, "auto");

    // Parmak izi.
    let fp = db.asset_fingerprint("/arsiv/a.pdf").unwrap().unwrap();
    assert_eq!(fp.size_bytes, 1234);
    assert_eq!(fp.modified_at, 1_700_000_500);
    assert_eq!(fp.content_hash.as_deref(), Some("blake3hex"));
    assert!(fp.indexed);
    assert!(db.asset_fingerprint("/yok").unwrap().is_none());

    // Thumbnail kalicilastirildi (batch get).
    let thumbs = db.get_thumbnails(&[id]).unwrap();
    assert_eq!(thumbs.len(), 1);
    assert_eq!(thumbs[0].asset_id, id);
    assert_eq!(thumbs[0].mime, "image/jpeg");
    assert_eq!(thumbs[0].width, 256);
    assert_eq!(thumbs[0].height, 192);
    assert_eq!(thumbs[0].bytes, vec![0xFF, 0xD8, 0xAA, 0xBB]);
    assert!(db.get_thumbnails(&[]).unwrap().is_empty(), "bos id → bos");
}

#[test]
fn reingest_updates_not_duplicates_and_keeps_user_tags() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let m1 = vec![("author".to_string(), MetaVal::Text("Ahmet".to_string()))];
    let t1 = vec!["draft".to_string()];
    let id1 = db
        .ingest(
            &asset("/arsiv/x.pdf"),
            &IngestData { fts_body: Some("eski metin"), metadata: &m1, auto_tags: &t1, phash: None, thumbnail: None },
        )
        .unwrap();

    // Kullanici etiketi ekle (kind='user') — re-ingest'te korunmali.
    db.connection()
        .execute_batch(
            "INSERT INTO tags(name, kind) VALUES ('favori', 'user');
             INSERT INTO asset_tags(asset_id, tag_id)
               SELECT (SELECT id FROM assets WHERE path='/arsiv/x.pdf'), id FROM tags WHERE name='favori';",
        )
        .unwrap();

    // Re-ingest: yeni metin/metadata/auto-tag.
    let m2 = vec![("author".to_string(), MetaVal::Text("Mehmet".to_string()))];
    let t2 = vec!["final".to_string()];
    let id2 = db
        .ingest(
            &asset("/arsiv/x.pdf"),
            &IngestData { fts_body: Some("yeni metin"), metadata: &m2, auto_tags: &t2, phash: None, thumbnail: None },
        )
        .unwrap();
    assert_eq!(id1, id2, "ayni yol → ayni id (upsert)");

    let conn = db.connection();
    // Tek asset satiri.
    let n: i64 = conn.query_row("SELECT count(*) FROM assets", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);

    // Metadata degisti (Ahmet → Mehmet), tek satir.
    let author: String = conn
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='author'",
            params![id2],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(author, "Mehmet");
    let meta_n: i64 = conn
        .query_row("SELECT count(*) FROM asset_metadata WHERE asset_id=?1", params![id2], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(meta_n, 1, "metadata replace edilmeli (cogalmamali)");

    // FTS body guncellendi.
    let old_hits: i64 = conn
        .query_row("SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'eski'", [], |r| r.get(0))
        .unwrap();
    let new_hits: i64 = conn
        .query_row("SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'yeni'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(old_hits, 0, "eski body silinmeli");
    assert_eq!(new_hits, 1, "yeni body aranabilir");

    // Auto-tag yenilendi (draft gitti, final geldi); user tag 'favori' KORUNDU.
    let has_draft: i64 = conn
        .query_row(
            "SELECT count(*) FROM asset_tags at JOIN tags t ON t.id=at.tag_id
             WHERE at.asset_id=?1 AND t.name='draft'",
            params![id2],
            |r| r.get(0),
        )
        .unwrap();
    let has_final: i64 = conn
        .query_row(
            "SELECT count(*) FROM asset_tags at JOIN tags t ON t.id=at.tag_id
             WHERE at.asset_id=?1 AND t.name='final'",
            params![id2],
            |r| r.get(0),
        )
        .unwrap();
    let has_user: i64 = conn
        .query_row(
            "SELECT count(*) FROM asset_tags at JOIN tags t ON t.id=at.tag_id
             WHERE at.asset_id=?1 AND t.name='favori'",
            params![id2],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(has_draft, 0, "eski auto-tag temizlenmeli");
    assert_eq!(has_final, 1, "yeni auto-tag eklenmeli");
    assert_eq!(has_user, 1, "kullanici etiketi korunmali");
}

#[test]
fn metadata_facet_query_by_key() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    for (path, who) in [("/a.pdf", "Ahmet"), ("/b.pdf", "Mehmet")] {
        let m = vec![("author".to_string(), MetaVal::Text(who.to_string()))];
        db.ingest(
            &asset(path),
            &IngestData { fts_body: None, metadata: &m, auto_tags: &[], phash: None, thumbnail: None },
        )
        .unwrap();
    }
    let count: i64 = db
        .connection()
        .query_row(
            "SELECT count(*) FROM asset_metadata WHERE key='author' AND value_text='Ahmet'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(count, 1, "faceting: author='Ahmet' tek asset");
}

/// `fingerprints_under` (paralel ingest on-cek'i): bir kok on-eki altindaki AKTIF asset'lerin
/// parmak izini yol→Fingerprint olarak doner. (1) on-ek kapsami (kardes klasor SIZMAZ),
/// (2) soft-delete'li haric, (3) alanlar dolu, (4) Windows yol-ayraci LIKE'ta literal eslesir.
#[test]
fn fingerprints_under_scopes_to_prefix_and_excludes_deleted() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let empty =
        || IngestData { fts_body: None, metadata: &[], auto_tags: &[], phash: None, thumbnail: None };

    // Kok altinda 2 (biri alt-klasor) + silinecek 1; KARDES on-ek "C:\proj2" sizmamali.
    db.ingest(&asset(r"C:\proj\a.txt"), &empty()).unwrap();
    db.ingest(&asset(r"C:\proj\sub\b.txt"), &empty()).unwrap();
    let gone = db.ingest(&asset(r"C:\proj\silinecek.txt"), &empty()).unwrap();
    db.ingest(&asset(r"C:\proj2\c.txt"), &empty()).unwrap(); // kardes — kapsam disi
    db.soft_delete(&[gone]).unwrap();

    let fps = db.fingerprints_under(r"C:\proj\").unwrap();
    assert_eq!(fps.len(), 2, "yalniz kok altindaki 2 AKTIF asset (kardes+silinen haric)");
    assert!(fps.contains_key(r"C:\proj\a.txt"));
    assert!(fps.contains_key(r"C:\proj\sub\b.txt"));
    assert!(!fps.contains_key(r"C:\proj\silinecek.txt"), "soft-delete'li haric");
    assert!(!fps.contains_key(r"C:\proj2\c.txt"), "kardes on-ek SIZMAMALI");

    // Alanlar dolu (asset() sabitleri): boyut/mtime/hash/indexed.
    let fp = &fps[r"C:\proj\a.txt"];
    assert_eq!(fp.size_bytes, 1234);
    assert_eq!(fp.modified_at, 1_700_000_500);
    assert_eq!(fp.content_hash.as_deref(), Some("blake3hex"));
    assert!(fp.indexed, "ingest sonrasi indexed_at dolu → indexed=true");
}
