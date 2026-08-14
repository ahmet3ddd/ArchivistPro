//! ① ENVANTER testleri — sayimlar fixture'la birebir + savunmaci okuma.

mod common;

use archivist_h2import::{inventory, H2ImportError};

#[test]
fn inventory_counts_fixture_exactly() {
    let dir = tempfile::tempdir().unwrap();
    let db = common::build_h2_fixture(dir.path());
    let inv = inventory(&db).unwrap();

    assert_eq!(inv.assets, 8, "fixture 8 asset icerir (a1..a6, a8, a9)");
    assert_eq!(inv.assets_deleted, 1, "a3 copte");
    assert_eq!(inv.assets_with_ai, 4, "a1 + a4 + a5 + a9 dwg* alani tasir");
    assert_eq!(inv.assets_with_thumbnail, 1, "yalniz a1");
    assert_eq!(inv.tags, 1);
    assert_eq!(inv.asset_tags, 1);
    assert_eq!(inv.favorites, 1);
    assert_eq!(inv.collections, 1);
    assert_eq!(inv.collection_items, 1);
    assert_eq!(inv.scanned_roots, 1);
    assert_eq!(inv.root_groups, 1);
    assert_eq!(inv.root_tags, 1);
    assert_eq!(inv.project_meta_rows, 1, "yalniz a2 (review + client_name)");
    assert_eq!(inv.users.len(), 1);
    assert_eq!(inv.users[0].username, "ahmet");
    assert_eq!(inv.chat_sessions, 1);
    assert!(inv.missing_tables.is_empty());
    assert!(inv.has_curated_data, "etiket+favori+koleksiyon var");
    assert!(inv.file_bytes > 0);
}

/// Cok eski H2 semasi: kimi tablolar hic yok → HATA degil, missing_tables izi.
#[test]
fn missing_tables_are_tolerated_and_reported() {
    let dir = tempfile::tempdir().unwrap();
    let db = common::build_h2_fixture(dir.path());
    {
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch("DROP TABLE collections; DROP TABLE collection_items; DROP TABLE root_groups;")
            .unwrap();
    }
    let inv = inventory(&db).unwrap();
    assert_eq!(inv.collections, 0);
    assert!(inv.missing_tables.contains(&"collections".to_string()));
    assert!(inv.missing_tables.contains(&"root_groups".to_string()));
    // Kurator sinyali kalanlardan hala dogru: etiket/favori duruyor.
    assert!(inv.has_curated_data);
}

/// `assets` tablosu olmayan dosya H2 arsivi DEGILDIR → acilista anlasilir hata.
#[test]
fn non_h2_database_is_rejected_at_open() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("baska.db");
    rusqlite::Connection::open(&db)
        .unwrap()
        .execute_batch("CREATE TABLE notlar (id INTEGER);")
        .unwrap();
    match inventory(&db) {
        Err(H2ImportError::Open(msg)) => assert!(msg.contains("assets"), "{msg}"),
        other => panic!("Open hatasi bekleniyordu: {other:?}"),
    }
}

/// Kurator verisi olmayan (bos-kurasyon) arsivde bayrak false — UI "tasinacak
/// kuratorlu veri yok" diyebilmeli (2026-07-16 olcumunun yeniden-uretimi).
#[test]
fn curated_flag_false_when_only_auto_data() {
    let dir = tempfile::tempdir().unwrap();
    let db = common::build_h2_fixture(dir.path());
    {
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "DELETE FROM asset_tags; DELETE FROM tags; DELETE FROM favorites;
             DELETE FROM collection_items; DELETE FROM collections;
             DELETE FROM root_tags; DELETE FROM root_groups;
             UPDATE assets SET client_name=NULL, approval_status='draft',
                    rejection_reason=NULL, version_label=NULL, deadline=NULL;",
        )
        .unwrap();
    }
    let inv = inventory(&db).unwrap();
    assert!(!inv.has_curated_data);
    // AI/asset sayilari hala gorunur — "tasinacak HIC bir sey yok" demek DEGIL.
    assert_eq!(inv.assets, 8);
    assert_eq!(inv.assets_with_ai, 4);
}
