//! DWG-sekil-arama veri katmani entegrasyon testleri (Dilim 1).
//!
//! **Model-bagimsiz / saf-SQL:** gercek DXF parser YOK; sentetik `ShapeInput`'larla
//! yazma (replace + CASCADE), benzerlik siralamasi (asset-basi dedup + cop dislama) ve
//! parametrik filtreleme dogrulanir. Skorlama cekirdegi ayrica shape.rs inline unit
//! testinde (H2 birebir port) dogrulanir.

use archivist_db::{Db, ShapeCriteria, ShapeInput, ShapeQuery};
use rusqlite::params;

/// Asset ekle (image_search.rs deseni; ext = "dwg").
fn seed_asset(db: &Db, id: i64, name: &str) {
    db.connection()
        .execute(
            "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (?1, ?2, ?3, 'dwg', 10, 1, 1)",
            params![id, format!("/a/{name}"), name],
        )
        .unwrap();
}

/// Sekil kur — anahtar skorlama alanlarini al, gerisini makul default'la.
#[allow(clippy::too_many_arguments)]
fn shape_in(
    entity: &str,
    layer: Option<&str>,
    vc: i64,
    closed: bool,
    ar: f64,
    reg: f64,
    compact: f64,
    solid: f64,
    rect: f64,
) -> ShapeInput {
    ShapeInput {
        entity_type: entity.to_string(),
        layer_name: layer.map(str::to_string),
        vertex_count: vc,
        is_closed: closed,
        area: 1.0,
        perimeter: 4.0,
        aspect_ratio: ar,
        regularity: reg,
        compactness: compact,
        solidity: solid,
        rectangularity: rect,
        bbox_w: 1.0,
        bbox_h: 1.0,
        centroid_x: 0.0,
        centroid_y: 0.0,
    }
}

/// Referans "kapali birim kare" (tum ozellikler 1.0) — ozdes sekil skoru ~1.0 verir.
fn ref_square() -> ShapeQuery {
    ShapeQuery {
        is_closed: true,
        vertex_count: 4,
        aspect_ratio: 1.0,
        regularity: 1.0,
        compactness: 1.0,
        solidity: 1.0,
        rectangularity: 1.0,
        ..Default::default()
    }
}

fn shape_count(db: &Db, asset_id: i64) -> i64 {
    db.connection()
        .query_row(
            "SELECT count(*) FROM asset_shapes WHERE asset_id = ?1",
            params![asset_id],
            |r| r.get(0),
        )
        .unwrap()
}

/// Replace semantigi: yaz → uzerine yaz (eski silinir) + `layer_category` turetilir;
/// asset hard-delete → CASCADE sekilleri temizler.
#[test]
fn set_asset_shapes_replace_semantics_and_cascade() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed_asset(&db, 1, "villa.dwg");

    // 3 sekil yaz.
    let first = [
        shape_in("LWPOLYLINE", Some("DUVAR-01"), 4, true, 1.0, 0.9, 0.8, 0.9, 0.9),
        shape_in("CIRCLE", Some("HAVUZ"), 1, true, 1.0, 1.0, 1.0, 1.0, 0.78),
        shape_in("LINE", Some("KAPI"), 2, false, 3.0, 0.0, 0.0, 0.0, 0.0),
    ];
    let n = db.set_asset_shapes(1, &first).unwrap();
    assert_eq!(n, 3);
    assert_eq!(shape_count(&db, 1), 3);

    // layer_category turetildi mi? (DUVAR-01 → DUVAR).
    let cat: Option<String> = db
        .connection()
        .query_row(
            "SELECT layer_category FROM asset_shapes WHERE asset_id=1 AND entity_type='LWPOLYLINE'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(cat.as_deref(), Some("DUVAR"));

    // Uzerine 2 sekil yaz → eskiler silinir (replace), toplam 2.
    let second = [
        shape_in("LWPOLYLINE", Some("DUVAR"), 4, true, 1.0, 0.95, 0.9, 0.9, 0.9),
        shape_in("LWPOLYLINE", None, 5, true, 1.2, 0.8, 0.8, 0.8, 0.8),
    ];
    assert_eq!(db.set_asset_shapes(1, &second).unwrap(), 2);
    assert_eq!(shape_count(&db, 1), 2);

    // None layer → layer_category NULL.
    let null_cat: i64 = db
        .connection()
        .query_row(
            "SELECT count(*) FROM asset_shapes WHERE asset_id=1 AND layer_category IS NULL",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(null_cat, 1, "layer'siz sekil → kategori NULL");

    // Asset hard-delete → CASCADE sekilleri temizler (foreign_keys=ON).
    db.connection().execute("DELETE FROM assets WHERE id = 1", []).unwrap();
    assert_eq!(shape_count(&db, 1), 0, "CASCADE ile sekiller temizlenmeli");
}

/// Benzerlik: referansa yakin asset ilk sirada; skor [0,1]; asset-basi TEK (dedup);
/// cop asset haric.
#[test]
fn search_by_similarity_ranks_and_dedupes_per_asset() {
    let db = Db::open_in_memory_migrated().unwrap();
    for (id, name) in [(1, "near.dwg"), (2, "far.dwg"), (3, "multi.dwg"), (4, "trash.dwg")] {
        seed_asset(&db, id, name);
    }

    // asset 1: referansa OZDES (skor ~1.0).
    db.set_asset_shapes(1, &[shape_in("LWPOLYLINE", Some("DUVAR"), 4, true, 1.0, 1.0, 1.0, 1.0, 1.0)])
        .unwrap();
    // asset 2: cok FARKLI kapali sekil (dusuk skor).
    db.set_asset_shapes(2, &[shape_in("LWPOLYLINE", Some("DIGER"), 40, true, 8.0, 0.1, 0.1, 0.3, 0.2)])
        .unwrap();
    // asset 3: iki sekil — biri yakin (vc=5, skor ~0.96) biri cok farkli. MAX alinmali.
    db.set_asset_shapes(
        3,
        &[
            shape_in("LWPOLYLINE", Some("DUVAR"), 5, true, 1.0, 1.0, 1.0, 1.0, 1.0),
            shape_in("LWPOLYLINE", Some("DIGER"), 40, true, 8.0, 0.1, 0.1, 0.3, 0.2),
        ],
    )
    .unwrap();
    // asset 4: referansa ozdes AMA cop'te → sonuca sizmamali.
    db.set_asset_shapes(4, &[shape_in("LWPOLYLINE", Some("DUVAR"), 4, true, 1.0, 1.0, 1.0, 1.0, 1.0)])
        .unwrap();
    db.connection().execute("UPDATE assets SET deleted_at = 99 WHERE id = 4", []).unwrap();

    let hits = db.search_shapes_by_similarity(&ref_square(), 10, false).unwrap();

    // Cop asset (4) yok.
    assert!(hits.iter().all(|h| h.asset.id != 4), "cop asset sizmamali");
    // Asset-basi TEK (dedup).
    let mut ids: Vec<i64> = hits.iter().map(|h| h.asset.id).collect();
    let mut uniq = ids.clone();
    uniq.sort_unstable();
    uniq.dedup();
    assert_eq!(ids.len(), uniq.len(), "her asset en fazla bir kez");
    // Siralama: asset 1 (ozdes) ilk, asset 3 (yakin) sonra, asset 2 (uzak) en son.
    ids.truncate(3);
    assert_eq!(ids, vec![1, 3, 2], "skor DESC siralama");
    // Skorlar [0,1]; asset1 en yuksek.
    assert!(hits.iter().all(|h| (0.0..=1.0).contains(&h.score)), "skor [0,1]");
    assert!(hits[0].score > hits[1].score, "asset1 asset3'ten yuksek");
    assert!(hits[0].score > 0.99, "ozdes sekil ~1.0");
}

/// include_open=false → yalniz kapali sekiller; acik-only asset elenir.
#[test]
fn search_by_similarity_excludes_open_when_requested() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed_asset(&db, 1, "closed.dwg");
    seed_asset(&db, 2, "open.dwg");
    db.set_asset_shapes(1, &[shape_in("LWPOLYLINE", Some("DUVAR"), 4, true, 1.0, 1.0, 1.0, 1.0, 1.0)])
        .unwrap();
    // Yalniz acik cizgi (is_closed=false) — on-filtre eler.
    db.set_asset_shapes(2, &[shape_in("LINE", Some("KAPI"), 2, false, 3.0, 0.0, 0.0, 0.0, 0.0)])
        .unwrap();

    let closed_only = db.search_shapes_by_similarity(&ref_square(), 10, false).unwrap();
    assert_eq!(closed_only.iter().map(|h| h.asset.id).collect::<Vec<_>>(), vec![1]);

    // include_open=true → acik sekil de aday (asset 2 gorunur).
    let with_open = db.search_shapes_by_similarity(&ref_square(), 10, true).unwrap();
    assert!(with_open.iter().any(|h| h.asset.id == 2), "acik dahil edilince asset 2 gelir");
}

/// Parametrik: kriterlerle (kategori + min_regularity) yalniz eslesen asset doner.
#[test]
fn search_by_features_filters() {
    let db = Db::open_in_memory_migrated().unwrap();
    for (id, name) in [(1, "match.dwg"), (2, "wrongcat.dwg"), (3, "lowreg.dwg"), (4, "trash.dwg")] {
        seed_asset(&db, id, name);
    }
    // asset 1: DUVAR + reg 0.95 → eslesir.
    db.set_asset_shapes(1, &[shape_in("LWPOLYLINE", Some("DUVAR-01"), 4, true, 1.0, 0.95, 0.9, 0.9, 0.9)])
        .unwrap();
    // asset 2: KAPI (kategori uyumsuz) → elenir.
    db.set_asset_shapes(2, &[shape_in("LWPOLYLINE", Some("KAPI"), 4, true, 1.0, 0.95, 0.9, 0.9, 0.9)])
        .unwrap();
    // asset 3: DUVAR ama reg 0.5 (< min_regularity) → elenir.
    db.set_asset_shapes(3, &[shape_in("LWPOLYLINE", Some("DUVAR"), 4, true, 1.0, 0.5, 0.9, 0.9, 0.9)])
        .unwrap();
    // asset 4: DUVAR + reg 0.95 AMA cop'te → elenir.
    db.set_asset_shapes(4, &[shape_in("LWPOLYLINE", Some("DUVAR"), 4, true, 1.0, 0.95, 0.9, 0.9, 0.9)])
        .unwrap();
    db.connection().execute("UPDATE assets SET deleted_at = 99 WHERE id = 4", []).unwrap();

    let criteria = ShapeCriteria {
        layer_category: Some("DUVAR".to_string()),
        min_regularity: Some(0.8),
        include_open: false,
        top_k: 10,
        ..Default::default()
    };
    let hits = db.search_shapes_by_features(&criteria).unwrap();
    assert_eq!(hits.iter().map(|h| h.asset.id).collect::<Vec<_>>(), vec![1], "yalniz asset 1 eslesir");
    assert!((0.0..=1.0).contains(&hits[0].score));

    // vertex_count + tolerans: vc=4±1 → asset 1 (vc 4) eslesir.
    let by_vertex = ShapeCriteria {
        vertex_count: Some(4),
        vertex_tolerance: 1,
        include_open: false,
        top_k: 10,
        ..Default::default()
    };
    let vhits = db.search_shapes_by_features(&by_vertex).unwrap();
    // asset 1/2/3 hepsi vc=4 kapali → 3 aktif asset (4 cop'te).
    let mut vids: Vec<i64> = vhits.iter().map(|h| h.asset.id).collect();
    vids.sort_unstable();
    assert_eq!(vids, vec![1, 2, 3], "vc filtresi aktif asset'leri getirir, cop haric");

    // Bos sonuc: eslesmeyen kategori.
    let none = ShapeCriteria {
        layer_category: Some("MERDIVEN".to_string()),
        include_open: false,
        top_k: 10,
        ..Default::default()
    };
    assert!(db.search_shapes_by_features(&none).unwrap().is_empty());
}

/// Kompozit (cizim-cizim): referansin sekil KUMESINE ortusme ile diger asset'ler siralanir.
/// Referansin kendisi haric; ozdes kume → 1.0; kismi ortusme → ara skor; ortusmez → elenir;
/// cop haric; min_score esigi; sekilsiz referans → bos.
#[test]
fn search_composite_ranks_by_shape_set_overlap() {
    let db = Db::open_in_memory_migrated().unwrap();
    for (id, name) in [
        (1, "ref.dwg"),
        (2, "identical.dwg"),
        (3, "partial.dwg"),
        (4, "different.dwg"),
        (5, "trash.dwg"),
    ] {
        seed_asset(&db, id, name);
    }

    // Iki belirgin sekil + bir cok-farkli sekil (esik altinda kalir).
    let square = shape_in("LWPOLYLINE", Some("DUVAR"), 4, true, 1.0, 1.0, 1.0, 1.0, 1.0);
    let tri = shape_in("LWPOLYLINE", Some("CATI"), 3, true, 1.0, 0.9, 0.85, 0.95, 0.8);
    let blob = shape_in("LWPOLYLINE", Some("DIGER"), 40, true, 8.0, 0.1, 0.1, 0.3, 0.2);

    // Referans (asset 1): {kare, ucgen}.
    db.set_asset_shapes(1, &[square.clone(), tri.clone()]).unwrap();
    // asset 2: OZDES kume → tam ortusme (1.0).
    db.set_asset_shapes(2, &[square.clone(), tri.clone()]).unwrap();
    // asset 3: {kare, blob} → yalniz kare eslesir (kismi ortusme).
    db.set_asset_shapes(3, &[square.clone(), blob.clone()]).unwrap();
    // asset 4: {blob} → hic ortusme (0 → elenir).
    db.set_asset_shapes(4, std::slice::from_ref(&blob)).unwrap();
    // asset 5: OZDES kume AMA cop'te → sizmamali.
    db.set_asset_shapes(5, &[square.clone(), tri.clone()]).unwrap();
    db.connection().execute("UPDATE assets SET deleted_at = 99 WHERE id = 5", []).unwrap();

    let hits = db.search_shapes_composite(1, 10, 1).unwrap();
    let ids: Vec<i64> = hits.iter().map(|h| h.asset.id).collect();

    assert!(!ids.contains(&1), "referans kendisi haric");
    assert!(!ids.contains(&5), "cop asset sizmamali");
    assert!(!ids.contains(&4), "hic ortusmeyen asset elenir");
    assert_eq!(ids, vec![2, 3], "ozdes once, kismi sonra");
    assert!(hits[0].score > 0.99, "ozdes kume skoru ~1.0");
    assert!(hits[0].score > hits[1].score, "ozdes > kismi");
    assert!(hits.iter().all(|h| (0.0..=1.0).contains(&h.score)), "skor [0,1]");

    // Yuksek min_score esigi → yalniz ozdes (asset 2) kalir.
    let strict = db.search_shapes_composite(1, 10, 90).unwrap();
    assert_eq!(
        strict.iter().map(|h| h.asset.id).collect::<Vec<_>>(),
        vec![2],
        "yuksek esikte yalniz ozdes kume"
    );

    // Sekilsiz referans → bos.
    seed_asset(&db, 6, "noshapes.dwg");
    assert!(db.search_shapes_composite(6, 10, 1).unwrap().is_empty(), "sekilsiz referans → bos");
}
