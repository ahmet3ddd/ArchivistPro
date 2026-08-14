//! Slice 2 — app_meta KV + lokasyon-ornek (sample_asset_paths) veri katmani testleri.

use archivist_db::Db;
use rusqlite::params;

#[test]
fn meta_get_set_roundtrip_and_overwrite() {
    let db = Db::open_in_memory_migrated().unwrap();
    // Yok → None.
    assert_eq!(db.get_meta("archive_host").unwrap(), None);
    // Yaz → oku.
    db.set_meta("archive_host", "HSOFIS").unwrap();
    assert_eq!(db.get_meta("archive_host").unwrap().as_deref(), Some("HSOFIS"));
    // Uzerine yaz (UPSERT).
    db.set_meta("archive_host", "EVPC").unwrap();
    assert_eq!(db.get_meta("archive_host").unwrap().as_deref(), Some("EVPC"));
    // Migration 0001'in koydugu schema_origin de okunur.
    assert_eq!(db.get_meta("schema_origin").unwrap().as_deref(), Some("h3"));
}

#[test]
fn sample_asset_paths_only_active_and_honors_limit() {
    let db = Db::open_in_memory_migrated().unwrap();
    let conn = db.connection();
    // 3 asset: 2 aktif + 1 soft-deleted.
    for (i, (path, del)) in
        [("C:/a/1.txt", None::<i64>), ("C:/a/2.txt", None), ("C:/a/3.txt", Some(99))]
            .iter()
            .enumerate()
    {
        conn.execute(
            "INSERT INTO assets(path, file_name, size_bytes, created_at, modified_at, deleted_at)
             VALUES (?1, ?2, 1, 1, 1, ?3)",
            params![path, format!("{i}.txt"), del],
        )
        .unwrap();
    }

    let paths = db.sample_asset_paths(10).unwrap();
    assert_eq!(paths.len(), 2, "yalniz aktif (deleted_at IS NULL) ornek alinmali");
    assert!(paths.iter().any(|p| p == "C:/a/1.txt"));
    assert!(paths.iter().any(|p| p == "C:/a/2.txt"));
    assert!(!paths.iter().any(|p| p == "C:/a/3.txt"), "soft-deleted ornek alinmamali");

    // limit uygulanir; limit<=0 → bos.
    assert_eq!(db.sample_asset_paths(1).unwrap().len(), 1);
    assert!(db.sample_asset_paths(0).unwrap().is_empty());

    // Bos arsiv (yeni DB) → bos.
    let empty = Db::open_in_memory_migrated().unwrap();
    assert!(empty.sample_asset_paths(10).unwrap().is_empty());
}
