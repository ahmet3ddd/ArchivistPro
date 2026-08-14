//! Katman 1 ingest entegrasyonu — gercek gorsel dosyalari tara → `ai_gorsel_turu` EAV dolar.
//!
//! Uctan uca: scan → extract (image_meta: boyut/EXIF) → classify_image_kind → write_image_kind.
//! Ayrica re-ingest'in mevcut degeri EZMEDIGINI (vision override senaryosu) dogrular.

use std::fs;

use archivist_db::Db;
use archivist_ingest::{build_registry, ingest_folder, IngestOpts};
use image::{Rgb, RgbImage};
use rusqlite::{params, Connection, OptionalExtension};

fn kind(conn: &Connection, name: &str) -> Option<String> {
    conn.query_row(
        "SELECT m.value_text FROM asset_metadata m JOIN assets a ON a.id = m.asset_id
         WHERE a.file_name = ?1 AND m.key = 'ai_gorsel_turu'",
        params![name],
        |r| r.get(0),
    )
    .optional()
    .unwrap()
}

#[test]
fn ingest_writes_image_kind_and_reingest_preserves() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();

    // Cihaz-adi (IMG_2001) → Fotograf (boyuttan bagimsiz; isim pattern'i once).
    RgbImage::from_pixel(16, 16, Rgb([120, 120, 120]))
        .save(root.join("IMG_2001.png"))
        .unwrap();
    // Notr ad + 1024x1024 (kare 2^n) → boyut sezgisi → Doku.
    RgbImage::from_pixel(1024, 1024, Rgb([90, 90, 90]))
        .save(root.join("flat.png"))
        .unwrap();
    // Kontrol: DWG degil ama metin — raster olmayan dosyaya ai_gorsel_turu yazilmamali.
    fs::write(root.join("notlar.txt"), b"mimari proje notu").unwrap();

    let mut db = Db::open_in_memory_migrated().unwrap();
    let reg = build_registry();

    let r = ingest_folder(&mut db, &reg, root, &IngestOpts::default());
    assert_eq!(r.added, 3, "3 dosya eklenmeli ({:?})", r.warnings);

    {
        let conn = db.connection();
        assert_eq!(kind(conn, "IMG_2001.png").as_deref(), Some("Fotoğraf"), "cihaz adi → Fotograf");
        assert_eq!(kind(conn, "flat.png").as_deref(), Some("Doku"), "1024x1024 → Doku");
        assert_eq!(kind(conn, "notlar.txt"), None, "raster olmayan → ai_gorsel_turu yok");
    }

    // ── Re-ingest KORUR: mevcut degeri (vision override taklidi) EZME ──
    db.connection()
        .execute(
            "UPDATE asset_metadata SET value_text = 'Render'
             WHERE key = 'ai_gorsel_turu'
               AND asset_id = (SELECT id FROM assets WHERE file_name = 'IMG_2001.png')",
            [],
        )
        .unwrap();

    // skip_unchanged=false → dosya yeniden islenir (extract + write tekrar kosar).
    let opts = IngestOpts { skip_unchanged: false, ..Default::default() };
    let r2 = ingest_folder(&mut db, &reg, root, &opts);
    assert_eq!(r2.updated, 3, "re-ingest 3 dosyayi guncellemeli");

    let conn = db.connection();
    assert_eq!(
        kind(conn, "IMG_2001.png").as_deref(),
        Some("Render"),
        "re-ingest mevcut ai_gorsel_turu'nu EZMEMELI (write-if-absent)"
    );
    assert_eq!(kind(conn, "flat.png").as_deref(), Some("Doku"), "digeri stabil kalir");
}
