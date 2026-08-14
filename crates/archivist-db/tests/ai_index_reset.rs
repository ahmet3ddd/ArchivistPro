use archivist_db::{
    ChunkWrite, Db, IndexStage, IMAGE_EMBED_DIM, IMAGE_REGION_COUNT, TEXT_EMBED_DIM,
};
use rusqlite::params;

fn unit_vector(dim: usize) -> Vec<f32> {
    let mut vector = vec![0.0; dim];
    vector[0] = 1.0;
    vector
}

#[test]
fn reset_local_ai_indexes_keeps_sources_and_vision_state() {
    let db = Db::open_in_memory_migrated().unwrap();
    db.connection()
        .execute(
            "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (1, '/work/plan.jpg', 'plan.jpg', 'jpg', 10, 1, 1)",
            [],
        )
        .unwrap();
    db.connection()
        .execute(
            "INSERT INTO asset_thumbnails(asset_id, mime, width, height, bytes)
             VALUES (1, 'image/jpeg', 1, 1, ?1)",
            params![vec![1_u8]],
        )
        .unwrap();

    db.set_vector(1, &unit_vector(TEXT_EMBED_DIM)).unwrap();
    let regions: Vec<(usize, Vec<f32>)> = (0..IMAGE_REGION_COUNT)
        .map(|region| (region, unit_vector(IMAGE_EMBED_DIM)))
        .collect();
    db.set_image_region_vectors(1, &regions).unwrap();
    db.set_asset_chunks(
        1,
        &[ChunkWrite {
            chunk_index: -1,
            page: None,
            text: "PLAN: ornek".into(),
            embedding: unit_vector(TEXT_EMBED_DIM),
        }],
    )
    .unwrap();
    for stage in IndexStage::ALL {
        db.record_index_skip(1, stage, "test").unwrap();
    }

    let report = db.reset_local_ai_indexes().unwrap();

    assert_eq!(report.text_vectors, 1);
    assert_eq!(report.image_vectors, IMAGE_REGION_COUNT as i64);
    assert_eq!(report.chunks, 1);
    assert_eq!(report.skipped, 3);
    assert_eq!(db.asset_count().unwrap(), 1, "kaynak asset korunmali");
    assert_eq!(db.vector_count().unwrap(), 0);
    assert_eq!(db.image_vector_count().unwrap(), 0);
    assert_eq!(db.chunk_count().unwrap(), 0);
    assert_eq!(db.pending_embed_count().unwrap(), 1);
    assert_eq!(db.pending_image_embed_count().unwrap(), 1);
    assert_eq!(db.pending_chunk_count().unwrap(), 1);
    assert_eq!(
        db.index_skip_count(None).unwrap(),
        1,
        "vision skip kaydi pahali opt-in analiz oldugu icin korunmali"
    );
    assert_eq!(db.index_skip_count(Some(IndexStage::Vision)).unwrap(), 1);
}
