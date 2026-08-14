//! RAG chunk veri katmani entegrasyon testleri (migration 0011): set_asset_chunks (govde +
//! metadata), bekleyen/sayim takibi, re-index degistirme, FTS aranabilirlik, purge temizligi.

use archivist_db::{AssetInput, ChunkWrite, Db, IngestData, MetaVal, META_CHUNK_INDEX};

fn ingest_one(db: &mut Db, path: &str, name: &str, body: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some("pdf"),
            size_bytes: 100,
            content_hash: None,
            mime: None,
            title: Some(name),
            description: None,
            created_at: 1,
            modified_at: 1,
        },
        &IngestData {
            fts_body: Some(body),
            metadata: &[("author".to_string(), MetaVal::Text("Ada".to_string()))],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

fn unit(hot: usize) -> Vec<f32> {
    let mut v = vec![0f32; 384];
    v[hot] = 1.0;
    v
}

fn cw(index: i64, text: &str, hot: usize) -> ChunkWrite {
    ChunkWrite { chunk_index: index, page: None, text: text.to_string(), embedding: unit(hot) }
}

fn count(db: &Db, sql: &str) -> i64 {
    db.connection().query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn set_chunks_tracks_counts_indexes_fts_and_vectors() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/p/a.pdf", "a.pdf", "villa cephe raporu");
    let b = ingest_one(&mut db, "/p/b.pdf", "b.pdf", "mutfak plani");

    // Baslangic: ikisi de bekliyor; body assets_fts'ten geliyor.
    assert_eq!(db.pending_chunk_count().unwrap(), 2);
    let pending = db.assets_without_chunks(0, 10).unwrap();
    assert_eq!(pending.len(), 2);
    let pa = pending.iter().find(|p| p.id == a).unwrap();
    assert!(pa.body.contains("villa"), "body assets_fts'ten gelmeli");

    // a icin: govde chunk (0) + metadata chunk (-1).
    db.set_asset_chunks(
        a,
        &[cw(0, "villa cephe raporu metni", 0), cw(META_CHUNK_INDEX, "DOSYA: a.pdf PROJE: Konut", 1)],
    )
    .unwrap();

    assert_eq!(db.chunked_asset_count().unwrap(), 1);
    assert_eq!(db.chunk_count().unwrap(), 2);
    assert_eq!(db.pending_chunk_count().unwrap(), 1);
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_vectors"), 2, "her chunk bir vektor");
    // metadata chunk chunk_index=-1 ile ayrildi.
    assert_eq!(
        count(&db, "SELECT count(*) FROM text_chunks WHERE chunk_index = -1"),
        1,
        "tam bir metadata chunk olmali"
    );
    // chunk_fts aranabilir.
    assert_eq!(
        count(&db, "SELECT count(*) FROM chunk_fts WHERE chunk_fts MATCH 'villa'"),
        1,
        "chunk FTS body'de 'villa' bulunmali"
    );

    // Cursor: a islendi → assets_without_chunks yalniz b'yi getirir.
    let rest = db.assets_without_chunks(0, 10).unwrap();
    assert_eq!(rest.len(), 1);
    assert_eq!(rest[0].id, b);
}

#[test]
fn chunks_for_asset_orders_meta_first_then_body() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/p/a.pdf", "a.pdf", "govde metni");
    let b = ingest_one(&mut db, "/p/b.pdf", "b.pdf", "baska");

    // Kasten govde ONCE, metadata SONRA yaz → sorgu ARTAN chunk_index ile dondurmeli (META=-1 once).
    db.set_asset_chunks(
        a,
        &[
            cw(1, "ikinci govde", 2),
            cw(0, "ilk govde", 0),
            cw(META_CHUNK_INDEX, "DOSYA: a.pdf", 1),
        ],
    )
    .unwrap();
    db.set_asset_chunks(b, &[cw(0, "b govde", 3)]).unwrap();

    let chunks = db.chunks_for_asset(a).unwrap();
    assert_eq!(chunks.len(), 3, "yalniz a'nin parcalari (b dahil DEGIL)");
    assert_eq!(chunks[0].chunk_index, META_CHUNK_INDEX, "metadata chunk (-1) once gelmeli");
    assert_eq!(chunks[0].text, "DOSYA: a.pdf");
    assert_eq!(chunks[1].chunk_index, 0, "sonra govde 0");
    assert_eq!(chunks[2].chunk_index, 1, "sonra govde 1");

    // Chunk'i olmayan asset → bos liste.
    let c = ingest_one(&mut db, "/p/c.pdf", "c.pdf", "indekslenmemis");
    assert!(db.chunks_for_asset(c).unwrap().is_empty(), "indekslenmemis asset → bos");
}

#[test]
fn reingest_preserves_ai_metadata() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/p/a.pdf", "a.pdf", "ilk metin");
    db.set_ai_metadata(a, &[("ai_aciklama", "AI gorsel betimi".to_string())]).unwrap();

    // Re-ingest (ayni path → upsert; extractor metadata yeniden yazilir).
    let a2 = ingest_one(&mut db, "/p/a.pdf", "a.pdf", "guncel metin");
    assert_eq!(a, a2, "ayni asset (path upsert)");

    // ai_ KORUNUR (re-index AI-analizini silmemeli); extractor metadata (author) yine yazilir.
    let ai = count(&db, r"SELECT count(*) FROM asset_metadata WHERE key LIKE 'ai\_%' ESCAPE '\'");
    assert_eq!(ai, 2, "ai_aciklama + ai_analyzed re-ingest'te korunur");
    assert_eq!(count(&db, "SELECT count(*) FROM asset_metadata WHERE key = 'author'"), 1, "extractor metadata yine yazilir");
}

#[test]
fn set_chunks_replaces_old_on_reindex() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/p/a.pdf", "a.pdf", "ilk metin");

    db.set_asset_chunks(a, &[cw(0, "ilk", 0), cw(1, "ikinci", 1), cw(2, "ucuncu", 2)]).unwrap();
    assert_eq!(db.chunk_count().unwrap(), 3);
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_vectors"), 3);

    // Re-index: 1 chunk → eskiler (3) silinmeli, yalniz yeni kalmali.
    db.set_asset_chunks(a, &[cw(0, "yeni tek metin", 5)]).unwrap();
    assert_eq!(db.chunk_count().unwrap(), 1, "eski chunk'lar silinmeli");
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_vectors"), 1, "eski vektorler silinmeli");
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_fts"), 1, "eski FTS satirlari silinmeli");
    // Eski body FTS'te kalmamali, yeni gelmeli.
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_fts WHERE chunk_fts MATCH 'ucuncu'"), 0);
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_fts WHERE chunk_fts MATCH 'yeni'"), 1);
}

#[test]
fn set_chunks_rejects_wrong_embedding_dim() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/p/a.pdf", "a.pdf", "metin");
    let bad = ChunkWrite { chunk_index: 0, page: None, text: "x".into(), embedding: vec![0.0; 10] };
    assert!(matches!(
        db.set_asset_chunks(a, &[bad]),
        Err(archivist_db::DbError::Invalid(_))
    ));
    // Reddedilen yazma DB'yi kirletmemeli (TX rollback).
    assert_eq!(db.chunk_count().unwrap(), 0);
}

#[test]
fn purge_cleans_chunks_vectors_and_fts() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/p/a.pdf", "a.pdf", "a metni");
    let b = ingest_one(&mut db, "/p/b.pdf", "b.pdf", "b metni");
    db.set_asset_chunks(a, &[cw(0, "a govde", 0), cw(META_CHUNK_INDEX, "a meta", 1)]).unwrap();
    db.set_asset_chunks(b, &[cw(0, "b govde", 2)]).unwrap();

    // purge(a): a'nin tum chunk izleri gitmeli, b durmali.
    assert_eq!(db.purge(&[a]).unwrap(), 1);
    assert_eq!(
        db.connection()
            .query_row("SELECT count(*) FROM text_chunks WHERE asset_id = ?1", [a], |r| r.get::<_, i64>(0))
            .unwrap(),
        0,
        "a'nin text_chunks'lari CASCADE ile gitmeli"
    );
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_vectors"), 1, "yalniz b'nin vektoru kalmali");
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_fts"), 1, "yalniz b'nin FTS satiri kalmali");
    assert_eq!(db.orphan_count().unwrap(), 0, "purge sonrasi yetim olmamali");

    // purge_all: hepsi gitmeli.
    db.purge_all().unwrap();
    assert_eq!(db.chunk_count().unwrap(), 0);
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_vectors"), 0);
    assert_eq!(count(&db, "SELECT count(*) FROM chunk_fts"), 0);
    assert!(db.integrity_ok().unwrap());
}
