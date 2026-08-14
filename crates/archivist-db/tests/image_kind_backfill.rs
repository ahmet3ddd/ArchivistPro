//! Katman 1 backfill (`Db::backfill_image_kind`) entegrasyon testi.
//!
//! Test-first: seed asset'lere EXIF/boyut EAV yaz → backfill → `ai_gorsel_turu` dogru + idempotent
//! (ikinci kosu 0, degerler sabit) + mevcut `ai_gorsel_turu`'na DOKUNMAZ + non-raster ATLANIR.

use archivist_db::Db;
use rusqlite::{params, Connection, OptionalExtension};

fn add_asset(conn: &Connection, path: &str, name: &str, ext: &str) -> i64 {
    conn.execute(
        "INSERT INTO assets(path, file_name, ext, size_bytes, created_at, modified_at, indexed_at)
         VALUES (?1, ?2, ?3, 1, 1, 1, 1)",
        params![path, name, ext],
    )
    .unwrap();
    conn.last_insert_rowid()
}

fn meta_text(conn: &Connection, id: i64, key: &str, val: &str) {
    conn.execute(
        "INSERT INTO asset_metadata(asset_id, key, value_text, value_num) VALUES (?1, ?2, ?3, NULL)",
        params![id, key, val],
    )
    .unwrap();
}

fn meta_num(conn: &Connection, id: i64, key: &str, val: f64) {
    conn.execute(
        "INSERT INTO asset_metadata(asset_id, key, value_text, value_num) VALUES (?1, ?2, NULL, ?3)",
        params![id, key, val],
    )
    .unwrap();
}

fn kind(conn: &Connection, id: i64) -> Option<String> {
    conn.query_row(
        "SELECT value_text FROM asset_metadata WHERE asset_id = ?1 AND key = 'ai_gorsel_turu'",
        params![id],
        |r| r.get(0),
    )
    .optional()
    .unwrap()
}

#[test]
fn backfill_classifies_and_is_idempotent_and_preserving() {
    let db = Db::open_in_memory_migrated().unwrap();
    let conn = db.connection();

    // A1: notr ad + kamera EXIF (camera_make) → Fotograf (read_image_signals yolunu dogrular).
    let a1 = add_asset(conn, "C:/arsiv/kayit/n1.jpg", "n1.jpg", "jpg");
    meta_text(conn, a1, "camera_make", "Canon EOS R");

    // A2: notr ad + 512x512 (value_num) → Doku (boyut sezgisi).
    let a2 = add_asset(conn, "C:/arsiv/kayit/n2.png", "n2.png", "png");
    meta_num(conn, a2, "width", 512.0);
    meta_num(conn, a2, "height", 512.0);

    // A3: notr ad + render motoru software → Render.
    let a3 = add_asset(conn, "C:/arsiv/kayit/n3.png", "n3.png", "png");
    meta_text(conn, a3, "software", "Corona Renderer 8");

    // A4: ZATEN ai_gorsel_turu='Render' + kamera EXIF (Fotograf olurdu) → DOKUNULMAMALI.
    let a4 = add_asset(conn, "C:/arsiv/kayit/n4.jpg", "n4.jpg", "jpg");
    meta_text(conn, a4, "ai_gorsel_turu", "Render");
    meta_text(conn, a4, "camera_make", "Nikon Z6");

    // A5: NON-raster (dwg) + kamera-ish → raster kapisinda ATLANIR.
    let a5 = add_asset(conn, "C:/arsiv/kayit/n5.dwg", "n5.dwg", "dwg");
    meta_text(conn, a5, "camera_make", "X");

    // A6: 1920x1080 (Full HD) + baska sinyal yok → belirsiz → yazilmaz (None).
    let a6 = add_asset(conn, "C:/arsiv/kayit/n6.jpg", "n6.jpg", "jpg");
    meta_num(conn, a6, "width", 1920.0);
    meta_num(conn, a6, "height", 1080.0);

    // ── Backfill kosusu 1 ──
    let written = db.backfill_image_kind().unwrap();
    assert_eq!(written, 3, "yalniz A1/A2/A3 yazilmali (A4 mevcut, A5 non-raster, A6 belirsiz)");

    assert_eq!(kind(conn, a1).as_deref(), Some("Fotoğraf"));
    assert_eq!(kind(conn, a2).as_deref(), Some("Doku"));
    assert_eq!(kind(conn, a3).as_deref(), Some("Render"));
    assert_eq!(kind(conn, a4).as_deref(), Some("Render"), "mevcut deger EZILMEMELI");
    assert_eq!(kind(conn, a5), None, "non-raster asset'e yazilmamali");
    assert_eq!(kind(conn, a6), None, "belirsiz (1080p) asset'e yazilmamali");

    // Toplam ai_gorsel_turu satiri = 3 yeni + 1 mevcut.
    let total: i64 = conn
        .query_row("SELECT count(*) FROM asset_metadata WHERE key = 'ai_gorsel_turu'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(total, 4);

    // ── Backfill kosusu 2 (idempotent) ──
    let again = db.backfill_image_kind().unwrap();
    assert_eq!(again, 0, "ikinci kosu hicbir sey yazmamali");
    // Degerler sabit.
    assert_eq!(kind(conn, a1).as_deref(), Some("Fotoğraf"));
    assert_eq!(kind(conn, a2).as_deref(), Some("Doku"));
    assert_eq!(kind(conn, a3).as_deref(), Some("Render"));
    assert_eq!(kind(conn, a4).as_deref(), Some("Render"));
}
