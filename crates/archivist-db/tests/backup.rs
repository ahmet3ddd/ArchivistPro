//! Yedekleme (snapshot) entegrasyon testleri: backup_to → mutasyon → restore_from round-trip.
//!
//! Online backup API canli baglantidan tutarli kopya alir; restore mevcut uzerine yazar.
//! Bu katman YIKICI (restore geri-alinamaz) → veri + iliskili + vektor + butunluk dogrulanir.

use archivist_db::{AssetInput, Db, IngestData, MetaVal};
use rusqlite::params;

fn ingest_one(db: &mut Db, path: &str, name: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some("txt"),
            size_bytes: 10,
            content_hash: None,
            mime: None,
            title: Some(name),
            description: None,
            created_at: 1,
            modified_at: 1,
        },
        &IngestData {
            fts_body: Some(name),
            metadata: &[("author".to_string(), MetaVal::Text("Ada".to_string()))],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

fn add_vector(db: &Db, id: i64, hot: usize) {
    let mut parts = vec!["0"; 384];
    parts[hot] = "1";
    let v = format!("[{}]", parts.join(","));
    db.connection()
        .execute("INSERT INTO asset_vectors(asset_id, embedding) VALUES (?1, ?2)", params![id, v])
        .expect("vektor yaz");
}

/// backup_to → tum arsivi sil → restore_from: veri (asset + etiket + vektor + FTS) geri gelir,
/// butunluk korunur, sema versiyonu eslesir. Yedek tutarli + geri yukleme tam.
#[test]
fn backup_then_wipe_then_restore_roundtrip() {
    let tmp = tempfile::tempdir().unwrap();
    let snap = tmp.path().join("yedek.db");

    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/proj/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/proj/b.txt", "b.txt");
    db.set_favorite(a, true).unwrap();
    db.add_user_tag(a, "villa").unwrap();
    add_vector(&db, a, 0);
    add_vector(&db, b, 1);
    let ver_before = db.schema_version().unwrap();

    // ── Yedek al ──
    db.backup_to(&snap).unwrap();
    assert!(snap.exists(), "yedek dosyasi olusmali");

    // ── Tum arsivi sil (felaket simulasyonu) ──
    db.purge_all().unwrap();
    assert_eq!(db.asset_count().unwrap(), 0);
    assert_eq!(
        db.connection().query_row("SELECT count(*) FROM asset_vectors", [], |r| r.get::<_, i64>(0)).unwrap(),
        0
    );

    // ── Geri yukle ──
    db.restore_from(&snap).unwrap();

    // Veri tam geri geldi.
    assert_eq!(db.asset_count().unwrap(), 2, "asset'ler geri gelmeli");
    let conn = db.connection();
    let total = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(total("SELECT count(*) FROM favorites"), 1, "favori geri gelmeli");
    assert_eq!(total("SELECT count(*) FROM asset_tags"), 1, "etiket-bagi geri gelmeli");
    assert_eq!(total("SELECT count(*) FROM asset_vectors"), 2, "vektorler geri gelmeli");
    // FTS aranabilir: "a.txt"/"b.txt" body'leri unicode61 ile [a/b, txt] token'larina ayrilir
    // → 'txt' her ikisini bulur (FTS golge tablolari restore ile geri geldi).
    assert_eq!(
        total("SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'txt'"),
        2,
        "FTS body geri gelmeli (aranabilir)"
    );

    // Butunluk + sema versiyonu korunur.
    assert!(db.integrity_ok().unwrap(), "restore sonrasi butunluk saglam olmali");
    assert_eq!(db.orphan_count().unwrap(), 0, "restore sonrasi yetim olmamali");
    assert_eq!(db.schema_version().unwrap(), ver_before, "sema versiyonu eslesmeli");
}

/// restore canli baglantiya yazar: yedek SONRASI eklenen veri geri-yuklemede KAYBOLUR
/// (yedek o anki durumu dondurur — beklenen davranis).
#[test]
fn restore_reverts_changes_made_after_backup() {
    let tmp = tempfile::tempdir().unwrap();
    let snap = tmp.path().join("yedek.db");

    let mut db = Db::open_in_memory_migrated().unwrap();
    ingest_one(&mut db, "/x/eski.txt", "eski.txt");
    db.backup_to(&snap).unwrap();

    // Yedekten SONRA yeni asset ekle.
    ingest_one(&mut db, "/x/yeni.txt", "yeni.txt");
    assert_eq!(db.asset_count().unwrap(), 2);

    // Geri yukle → yedek anindaki tek asset'e doner ("yeni" gider).
    db.restore_from(&snap).unwrap();
    assert_eq!(db.asset_count().unwrap(), 1, "yedek sonrasi eklenen kaybolmali");
    let has_new: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM assets WHERE file_name='yeni.txt'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(has_new, 0, "yedek sonrasi eklenen asset restore'da olmamali");
}
