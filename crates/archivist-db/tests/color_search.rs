//! Renk-yakınlığı araması ("bu renge yakın görselleri bul") — veri katmanı sözleşmesi.
//!
//! Katman kolorimetri BİLMEZ: skoru çağıran verir (`assets_near_color(opts, score, max_score)`).
//! Bu testler tam olarak o sözleşmeyi doğrular — sıralama, eşik, filtre korunumu, çöp elemesi,
//! bozuk JSON toleransı. Gerçek renk matematiği `archivist-extract-image` tarafında (tek kopya).

use archivist_db::{Db, DominantColor, ListOpts};
use rusqlite::params;

/// Asset + `dominant_colors` EAV'si ekle. Renkler `(r,g,b,yüzde)` üçlüleri.
fn seed(db: &Db, id: i64, name: &str, colors: &[(u8, u8, u8, f32)]) {
    db.connection()
        .execute(
            "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (?1, ?2, ?3, 'jpg', 10, 1, 1)",
            params![id, format!("/a/{name}"), name],
        )
        .unwrap();
    let json = serde_json::to_string(
        &colors
            .iter()
            .map(|(r, g, b, p)| DominantColor { r: *r, g: *g, b: *b, percentage: *p })
            .collect::<Vec<_>>(),
    )
    .unwrap();
    set_meta(db, id, &json);
}

fn set_meta(db: &Db, id: i64, value: &str) {
    db.connection()
        .execute(
            "INSERT INTO asset_metadata(asset_id, key, value_text)
             VALUES (?1, 'dominant_colors', ?2)",
            params![id, value],
        )
        .unwrap();
}

/// Basit kare-uzaklık skoru (test için; üretimde CIELAB — bkz `image_commands::assets_near_color`).
fn rgb_score(target: (u8, u8, u8)) -> impl Fn(&DominantColor) -> f64 {
    move |c: &DominantColor| {
        let dr = f64::from(c.r) - f64::from(target.0);
        let dg = f64::from(c.g) - f64::from(target.1);
        let db_ = f64::from(c.b) - f64::from(target.2);
        dr * dr + dg * dg + db_ * db_
    }
}

fn opts() -> ListOpts {
    ListOpts { page_size: 50, ..Default::default() }
}

#[test]
fn ranks_by_best_matching_color_and_applies_threshold() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed(&db, 1, "tam-kirmizi.jpg", &[(255, 0, 0, 90.0)]);
    seed(&db, 2, "kirmiziya-yakin.jpg", &[(240, 20, 10, 80.0)]);
    seed(&db, 3, "mavi.jpg", &[(0, 0, 255, 95.0)]);
    // Asset 4: baskın rengi mavi AMA ikincil rengi tam kırmızı → EN İYİ renkten eşleşmeli.
    seed(&db, 4, "mavi-kirmizili.jpg", &[(10, 10, 240, 70.0), (250, 5, 5, 30.0)]);

    let page = db.assets_near_color(&opts(), rgb_score((255, 0, 0)), 5_000.0).unwrap();
    let names: Vec<&str> = page.items.iter().map(|a| a.file_name.as_str()).collect();

    // Mavi eşiğin dışında kalır; kalanlar en yakından uzağa sıralanır.
    assert_eq!(names, vec!["tam-kirmizi.jpg", "mavi-kirmizili.jpg", "kirmiziya-yakin.jpg"]);
    assert_eq!(page.total, 3);
    // Mesafe benzerlik YÜZDESİ değildir → satıra skor işlenmez (yanlış % rozet çıkmasın).
    assert!(page.items.iter().all(|a| a.score.is_none()));
}

#[test]
fn respects_active_filters_and_trash() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    seed(&db, 1, "kirmizi-a.jpg", &[(255, 0, 0, 90.0)]);
    seed(&db, 2, "kirmizi-b.jpg", &[(250, 5, 5, 90.0)]);
    seed(&db, 3, "kirmizi-cop.jpg", &[(255, 0, 0, 90.0)]);
    db.soft_delete(&[3]).unwrap();

    // Çöptekiler ASLA dönmez (FILTER_FRAG paylaşımı).
    let all = db.assets_near_color(&opts(), rgb_score((255, 0, 0)), 5_000.0).unwrap();
    let names: Vec<&str> = all.items.iter().map(|a| a.file_name.as_str()).collect();
    assert_eq!(names, vec!["kirmizi-a.jpg", "kirmizi-b.jpg"]);

    // Aktif filtre (favori) renk aramasında da geçerli — arama filtreyi EZMEZ.
    db.set_favorite(2, true).unwrap();
    let fav = ListOpts { favorites_only: true, ..opts() };
    let only_fav = db.assets_near_color(&fav, rgb_score((255, 0, 0)), 5_000.0).unwrap();
    let fav_names: Vec<&str> = only_fav.items.iter().map(|a| a.file_name.as_str()).collect();
    assert_eq!(fav_names, vec!["kirmizi-b.jpg"]);
}

#[test]
fn caller_can_ignore_tiny_shares() {
    let db = Db::open_in_memory_migrated().unwrap();
    // Kırmızı yalnızca %2 → "bu görsel kırmızıdır" demek yanlış olurdu.
    seed(&db, 1, "kirmizi-kirinti.jpg", &[(10, 10, 10, 98.0), (255, 0, 0, 2.0)]);

    let ignoring_small = move |c: &DominantColor| {
        if c.percentage < 5.0 {
            return f64::INFINITY;
        }
        rgb_score((255, 0, 0))(c)
    };
    let page = db.assets_near_color(&opts(), ignoring_small, 5_000.0).unwrap();
    assert_eq!(page.total, 0, "pay eşiğinin altındaki renk eşleşme saymamalı");

    // Aynı asset, eşiksiz skorla BULUNUR → eleme kararı gerçekten çağıranda.
    let page2 = db.assets_near_color(&opts(), rgb_score((255, 0, 0)), 5_000.0).unwrap();
    assert_eq!(page2.total, 1);
}

#[test]
fn tolerates_missing_and_broken_color_data() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed(&db, 1, "saglam.jpg", &[(255, 0, 0, 90.0)]);
    // Renk EAV'si HİÇ olmayan asset (eski kayıt) — taramaya girmez.
    db.connection()
        .execute(
            "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (2, '/a/renksiz.jpg', 'renksiz.jpg', 'jpg', 10, 1, 1)",
            [],
        )
        .unwrap();
    // Bozuk JSON — çökertmez, o asset atlanır (map_asset_row ile aynı tolerans).
    db.connection()
        .execute(
            "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (3, '/a/bozuk.jpg', 'bozuk.jpg', 'jpg', 10, 1, 1)",
            [],
        )
        .unwrap();
    set_meta(&db, 3, "{bozuk-json");

    let page = db.assets_near_color(&opts(), rgb_score((255, 0, 0)), 5_000.0).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].file_name, "saglam.jpg");
}

#[test]
fn empty_archive_returns_empty_page() {
    let db = Db::open_in_memory_migrated().unwrap();
    let page = db.assets_near_color(&opts(), rgb_score((255, 0, 0)), 5_000.0).unwrap();
    assert_eq!(page.total, 0);
    assert!(page.items.is_empty());
}

// ── Geri-doldurma (eksik renk verisi) ────────────────────────────────────────────────────

/// Thumbnail ekle (baytlarin ICERIGI db katmaninda onemsiz — decode CAGIRANDA yapilir).
fn add_thumb(db: &Db, id: i64) {
    db.connection()
        .execute(
            "INSERT INTO asset_thumbnails(asset_id, mime, width, height, bytes)
             VALUES (?1, 'image/jpeg', 8, 8, ?2)",
            params![id, vec![1u8, 2, 3, 4]],
        )
        .unwrap();
}

fn seed_bare(db: &Db, id: i64, name: &str) {
    db.connection()
        .execute(
            "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (?1, ?2, ?3, 'jpg', 10, 1, 1)",
            params![id, format!("/a/{name}"), name],
        )
        .unwrap();
}

#[test]
fn backfill_targets_only_thumbed_assets_without_colors() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // 1: thumbnail VAR + renk YOK  → aday
    seed_bare(&db, 1, "eski.jpg");
    add_thumb(&db, 1);
    // 2: thumbnail VAR + renk VAR  → aday DEGIL (cikarimdan gelen deger korunur)
    seed(&db, 2, "yeni.jpg", &[(1, 2, 3, 100.0)]);
    add_thumb(&db, 2);
    // 3: thumbnail YOK             → aday DEGIL (renk hesaplanacak bir goruntu yok)
    seed_bare(&db, 3, "onizlemesiz.dwg");
    // 4: thumbnail VAR + renk YOK ama COPTE → aday DEGIL
    seed_bare(&db, 4, "cop.jpg");
    add_thumb(&db, 4);
    db.soft_delete(&[4]).unwrap();

    assert_eq!(db.count_missing_dominant_colors().unwrap(), 1);
    let batch = db.assets_missing_dominant_colors(0, 100).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].0, 1);
    assert_eq!(batch[0].1, vec![1u8, 2, 3, 4], "thumbnail baytlari cagirana verilir");
}

#[test]
fn backfill_write_is_idempotent_and_never_overwrites() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed_bare(&db, 1, "eski.jpg");
    add_thumb(&db, 1);

    let colors = vec![DominantColor { r: 10, g: 20, b: 30, percentage: 80.0 }];
    assert!(db.write_dominant_colors(1, &colors).unwrap(), "ilk yazim");
    assert_eq!(db.count_missing_dominant_colors().unwrap(), 0);

    // Ikinci kosu: yazmaz (idempotent) ve MEVCUT degeri EZMEZ.
    let other = vec![DominantColor { r: 200, g: 200, b: 200, percentage: 90.0 }];
    assert!(!db.write_dominant_colors(1, &other).unwrap(), "ikinci kosu yazmamali");
    let stored: String = db
        .connection()
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=1 AND key='dominant_colors'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(stored.contains("\"r\":10"), "cikarimdan gelen deger korunmali: {stored}");
}

#[test]
fn backfill_write_rejects_empty_colors() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed_bare(&db, 1, "cozulemeyen.jpg");
    add_thumb(&db, 1);
    // Thumbnail decode edilemediyse cagiran bos liste verir → "hesaplandi, renk yok" YALANI
    // yazilmamali (aksi halde asset bir daha hic denenmezdi).
    assert!(!db.write_dominant_colors(1, &[]).unwrap());
    assert_eq!(db.count_missing_dominant_colors().unwrap(), 1, "aday olarak KALMALI");
}

#[test]
fn backfill_batch_is_resumable_by_cursor() {
    let db = Db::open_in_memory_migrated().unwrap();
    for id in 1..=5 {
        seed_bare(&db, id, &format!("a{id}.jpg"));
        add_thumb(&db, id);
    }
    let first = db.assets_missing_dominant_colors(0, 2).unwrap();
    assert_eq!(first.iter().map(|(id, _)| *id).collect::<Vec<_>>(), vec![1, 2]);
    let second = db.assets_missing_dominant_colors(2, 2).unwrap();
    assert_eq!(second.iter().map(|(id, _)| *id).collect::<Vec<_>>(), vec![3, 4]);
}
