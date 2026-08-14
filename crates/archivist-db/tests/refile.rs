//! Refile (yerinde tasima/yeniden-adlandirma) DB cekirdegi testleri.
//!
//! Kanit: yol/ad/uzanti guncellenir ama **asset id + content_hash + asset_id'ye bagli veri
//! (etiket) KORUNUR** (re-ingest tuzagi yok) · UNIQUE(path) ihlali → tipli hata · yok/cop'te
//! asset → NotFound · FTS `file_name` UPDATE trigger'i ile senkron (yeni ad bulunur, eski bulunmaz).

use archivist_db::{Db, RefileError};
use rusqlite::params;

/// Minimal asset ekle (path UNIQUE) → yeni id. `content_hash` sabit — refile'in ona
/// DOKUNMADIGINI dogrulamak icin bilinen bir deger.
fn seed(db: &Db, path: &str, file_name: &str, ext: &str, deleted: Option<i64>) -> i64 {
    db.connection()
        .execute(
            "INSERT INTO assets
                 (path, file_name, ext, size_bytes, content_hash, created_at, modified_at, deleted_at)
             VALUES (?1, ?2, ?3, 10, 'HASH_SABIT', 100, 100, ?4)",
            params![path, file_name, ext, deleted],
        )
        .unwrap();
    db.connection().last_insert_rowid()
}

/// (1) Yeniden-adlandir → path/file_name/ext guncellenir; id + content_hash + modified_at korunur.
#[test]
fn rename_updates_path_name_ext_but_preserves_id_and_hash() {
    let db = Db::open_in_memory_migrated().unwrap();
    let id = seed(&db, r"C:\proj\villa\eski.dwg", "eski.dwg", "dwg", None);

    let old = db.refile_asset(id, r"C:\proj\villa\yeni.PDF").unwrap();
    assert_eq!(old, r"C:\proj\villa\eski.dwg", "eski yol donmeli (rollback icin)");

    let (path, name, ext, hash, modified): (String, String, Option<String>, Option<String>, i64) = db
        .connection()
        .query_row(
            "SELECT path, file_name, ext, content_hash, modified_at FROM assets WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .unwrap();
    assert_eq!(path, r"C:\proj\villa\yeni.PDF");
    assert_eq!(name, "yeni.PDF"); // ad orijinal harf-kasasiyla saklanir
    assert_eq!(ext.as_deref(), Some("pdf"), "ext kucuk-harf normalize");
    assert_eq!(hash.as_deref(), Some("HASH_SABIT"), "content_hash DEGISMEMELI");
    assert_eq!(modified, 100, "modified_at DEGISMEMELI");

    // Tek satir kaldi (yeni id uretilmedi).
    let cnt: i64 =
        db.connection().query_row("SELECT count(*) FROM assets", [], |r| r.get(0)).unwrap();
    assert_eq!(cnt, 1);
}

/// (2) Tasi (yeni dizin, ayni ad) → yalniz path guncellenir; ad korunur.
#[test]
fn move_updates_path_keeps_name() {
    let db = Db::open_in_memory_migrated().unwrap();
    let id = seed(&db, r"C:\a\1.dwg", "1.dwg", "dwg", None);

    db.refile_asset(id, r"C:\b\1.dwg").unwrap();

    let (path, name): (String, String) = db
        .connection()
        .query_row("SELECT path, file_name FROM assets WHERE id = ?1", params![id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(path, r"C:\b\1.dwg");
    assert_eq!(name, "1.dwg");
}

/// (3) Hedef yol baska bir AKTIF asset'te → UNIQUE ihlali → tipli `Conflict`.
#[test]
fn refile_to_existing_active_path_conflicts() {
    let db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, r"C:\a\1.dwg", "1.dwg", "dwg", None);
    let _b = seed(&db, r"C:\a\2.dwg", "2.dwg", "dwg", None);

    let err = db.refile_asset(a, r"C:\a\2.dwg").unwrap_err();
    assert!(matches!(err, RefileError::Conflict), "hedef dolu → Conflict, ayni: {err:?}");

    // Cakisan asset tasinmadan durur (a hala eski yolunda).
    let a_path: String = db
        .connection()
        .query_row("SELECT path FROM assets WHERE id = ?1", params![a], |r| r.get(0))
        .unwrap();
    assert_eq!(a_path, r"C:\a\1.dwg", "cakisma sonrasi kaynak yolu degismemeli");
}

/// (4) Yok / cop'te (soft-delete) asset → `NotFound`.
#[test]
fn refile_missing_or_deleted_errors_not_found() {
    let db = Db::open_in_memory_migrated().unwrap();
    // Hic yok.
    assert!(matches!(
        db.refile_asset(999, r"C:\x\y.dwg").unwrap_err(),
        RefileError::NotFound
    ));
    // Cop'te (deleted_at dolu) → aktif degil → NotFound.
    let d = seed(&db, r"C:\a\del.dwg", "del.dwg", "dwg", Some(50));
    assert!(matches!(
        db.refile_asset(d, r"C:\a\yeni.dwg").unwrap_err(),
        RefileError::NotFound
    ));
}

/// (5) FTS senkron: yeniden-adlandirmadan sonra YENI ad ile FTS bulur, ESKI ad bulmaz
/// (assets_fts_au UPDATE trigger'i file_name'i senkronlar).
#[test]
fn rename_syncs_fts_file_name() {
    let db = Db::open_in_memory_migrated().unwrap();
    let id = seed(&db, r"C:\a\eskiadi.dwg", "eskiadi.dwg", "dwg", None);

    db.refile_asset(id, r"C:\a\yeniadi.dwg").unwrap();

    let found: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'yeniadi'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(found, 1, "yeni file_name FTS'te bulunmali");

    let old_found: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'eskiadi'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(old_found, 0, "eski file_name FTS'te kalmamali (trigger senkronladi)");
}

/// (6) id korunumu: asset'e etiket ekle → refile → etiket (asset_id bagi) sag kalir.
#[test]
fn refile_preserves_tags_via_stable_id() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = seed(&db, r"C:\a\1.dwg", "1.dwg", "dwg", None);
    db.add_user_tag(id, "villa").unwrap();

    db.refile_asset(id, r"C:\b\1.dwg").unwrap();

    let tag_cnt: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM asset_tags WHERE asset_id = ?1", params![id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(tag_cnt, 1, "etiket refile sonrasi sag kalmali (asset_id degismedi)");
}
