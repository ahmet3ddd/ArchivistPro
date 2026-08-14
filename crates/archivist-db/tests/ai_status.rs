//! AI-analiz durumu (`ai_analyzed`) — grid rozeti alani + tri-state filtre.
//!
//! Test-first: bu testler ONCE yazildi (kirmizi), sonra `AssetRow.ai_analyzed` +
//! `ListOpts.ai_analyzed` + `FILTER_FRAG` fragmani yesile getirdi. Iki eksen:
//!   1. `AssetRow.ai_analyzed` her okuma-yolunda (liste / get_asset / semantik / gorsel)
//!      DOGRU dolar — kolon-hizasi (map_asset_row index 12) regresyonunu yakalar
//!      (bir SELECT'te kolon eksik kalirsa runtime "no such column"/yanlis-index olur).
//!   2. `ListOpts.ai_analyzed` TRI-STATE filtre: None=hepsi · Some(true)=analizli ·
//!      Some(false)=analizsiz; facet-arasi AND (ext + ai_analyzed → kesisim).
//!
//! Marker `ai_analyzed`, `set_ai_metadata` (image.rs) ile yazilir → asset "analizli" sayilir.
//! Saf-SQL yollari (sqlite-vec kNN birim-vektorlerle) → ONNX/model gerekmez.

use archivist_db::{
    AssetInput, Db, ImageKind, IngestData, ListOpts, IMAGE_EMBED_DIM, TEXT_EMBED_DIM,
    DOMINANT_COLORS_METADATA_KEY,
};

/// Bir asset ingest et (ext kontrollu) → id. Gorsel gercekligi: bos-ish govde.
fn seed(db: &mut Db, path: &str, name: &str, ext: &str) -> i64 {
    let input = AssetInput {
        path,
        file_name: name,
        ext: Some(ext),
        size_bytes: 10,
        content_hash: None,
        mime: None,
        title: None,
        description: None,
        created_at: 1,
        modified_at: 1,
    };
    let data = IngestData {
        fts_body: Some("govde metni"),
        metadata: &[],
        auto_tags: &[],
        phash: None,
        thumbnail: None,
    };
    db.ingest(&input, &data).unwrap()
}

/// Bir asset'i AI-analizli isaretle (set_ai_metadata → `ai_analyzed` marker + `ai_*` betim).
fn mark_analyzed(db: &Db, id: i64) {
    db.set_ai_metadata(id, &[("ai_aciklama", "cami avlusu".to_string())]).unwrap();
}

/// Bir asset'e "Render" gorsel MEDYA turu yaz (write_image_kind → `ai_gorsel_turu` EAV = "Render").
fn mark_render(db: &Db, id: i64) {
    db.write_image_kind(id, ImageKind::Render).unwrap();
}

fn mark_colors(db: &Db, id: i64, json: &str) {
    db.connection()
        .execute(
            "INSERT INTO asset_metadata(asset_id,key,value_text) VALUES (?1,?2,?3)",
            rusqlite::params![id, DOMINANT_COLORS_METADATA_KEY, json],
        )
        .unwrap();
}

/// `hot`. boyutu 1 olan `dim`-boyutlu birim vektor (sqlite-vec saf-SQL kNN icin).
fn unit(dim: usize, hot: usize) -> Vec<f32> {
    let mut v = vec![0f32; dim];
    v[hot] = 1.0;
    v
}

/// list_assets → analizli olanin `ai_analyzed==true`, digerinin `false` (duz liste yolu).
#[test]
fn list_assets_reports_ai_analyzed_flag() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let analyzed = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_analyzed(&db, analyzed);

    let page = db.list_assets(&ListOpts { page_size: 50, ..Default::default() }).unwrap();
    let flag = |id: i64| page.items.iter().find(|r| r.id == id).unwrap().ai_analyzed;
    assert!(flag(analyzed), "analiz edilen asset → ai_analyzed=true");
    assert!(!flag(plain), "analiz edilmemis asset → ai_analyzed=false");
}

/// get_asset (COLS / assets.id yolu, alias'siz) da `ai_analyzed`'i DOGRU doldurur.
#[test]
fn get_asset_fills_ai_analyzed() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let analyzed = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_analyzed(&db, analyzed);

    assert!(db.get_asset(analyzed).unwrap().unwrap().asset.ai_analyzed);
    assert!(!db.get_asset(plain).unwrap().unwrap().asset.ai_analyzed);
}

/// TRI-STATE filtre: None=hepsi · Some(true)=yalniz analizli · Some(false)=yalniz analizsiz.
#[test]
fn ai_analyzed_filter_is_tri_state() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let analyzed = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_analyzed(&db, analyzed);

    let ids = |opt: Option<bool>| -> Vec<i64> {
        let mut v: Vec<i64> = db
            .list_assets(&ListOpts { page_size: 50, ai_analyzed: opt, ..Default::default() })
            .unwrap()
            .items
            .iter()
            .map(|r| r.id)
            .collect();
        v.sort_unstable();
        v
    };

    let mut both = vec![analyzed, plain];
    both.sort_unstable();
    assert_eq!(ids(None), both, "None → filtre yok (ikisi de)");
    assert_eq!(ids(Some(true)), vec![analyzed], "Some(true) → yalniz analizli");
    assert_eq!(ids(Some(false)), vec![plain], "Some(false) → yalniz analizsiz");
}

/// total sayimi da tri-state filtreye uyar (count + page SQL AYNI FILTER_FRAG → tutarli).
#[test]
fn ai_analyzed_filter_total_count_matches() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a1 = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let a2 = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    let _p = seed(&mut db, "/a/3.jpg", "3.jpg", "jpg");
    mark_analyzed(&db, a1);
    mark_analyzed(&db, a2);

    let only_yes = db
        .list_assets(&ListOpts { page_size: 50, ai_analyzed: Some(true), ..Default::default() })
        .unwrap();
    assert_eq!(only_yes.total, 2, "analizli total 2");
    assert_eq!(only_yes.items.len(), 2);

    let only_no = db
        .list_assets(&ListOpts { page_size: 50, ai_analyzed: Some(false), ..Default::default() })
        .unwrap();
    assert_eq!(only_no.total, 1, "analizsiz total 1");
}

/// Facet-arasi AND: ext + ai_analyzed birlikte → kesisim (baska facet'i bozmadan daraltir).
#[test]
fn ai_analyzed_filter_intersects_with_ext() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let jpg_analyzed = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let _jpg_plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    let pdf_analyzed = seed(&mut db, "/a/3.pdf", "3.pdf", "pdf");
    mark_analyzed(&db, jpg_analyzed);
    mark_analyzed(&db, pdf_analyzed);

    // ext=jpg AND ai_analyzed=true → yalniz jpg_analyzed (pdf_analyzed ext ile elenir).
    let opts = ListOpts {
        page_size: 50,
        ext: vec!["jpg".into()],
        ai_analyzed: Some(true),
        ..Default::default()
    };
    let page = db.list_assets(&opts).unwrap();
    assert_eq!(page.total, 1, "ext ∩ analizli = 1");
    assert_eq!(page.items[0].id, jpg_analyzed);
}

/// Semantik (kNN + FILTER_FRAG hidratlama; COLS_A/a. alias yolu) → `ai_analyzed` DOGRU dolar.
/// Kolon-hizasi (index 12) regresyonunu tam-metin-DISI bir yolda dogrular.
#[test]
fn semantic_search_fills_ai_analyzed() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let analyzed = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_analyzed(&db, analyzed);

    db.set_vector(analyzed, &unit(TEXT_EMBED_DIM, 0)).unwrap();
    db.set_vector(plain, &unit(TEXT_EMBED_DIM, 1)).unwrap();

    let page = db
        .semantic_search(&unit(TEXT_EMBED_DIM, 0), &ListOpts { page_size: 10, ..Default::default() })
        .unwrap();
    let a = page.items.iter().find(|r| r.id == analyzed).unwrap();
    let p = page.items.iter().find(|r| r.id == plain).unwrap();
    assert!(a.ai_analyzed, "semantik yol: analizli → true (kolon-hizasi 12)");
    assert!(!p.ai_analyzed, "semantik yol: analizsiz → false");

    // Filtre semantik yolda da gecerli (FILTER_FRAG :ai_analyzed param'i akiyor).
    let only_yes = db
        .semantic_search(
            &unit(TEXT_EMBED_DIM, 0),
            &ListOpts { page_size: 10, ai_analyzed: Some(true), ..Default::default() },
        )
        .unwrap();
    assert!(only_yes.items.iter().all(|r| r.ai_analyzed), "semantik + Some(true) → yalniz analizli");
    assert!(only_yes.items.iter().any(|r| r.id == analyzed));
    assert!(only_yes.items.iter().all(|r| r.id != plain));
}

/// Gorsel (image_search kNN; COLS_A/a. alias yolu) → `ai_analyzed` DOGRU dolar (image.rs projeksiyonu).
#[test]
fn image_search_fills_ai_analyzed() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let analyzed = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_analyzed(&db, analyzed);

    db.set_image_region_vectors(analyzed, &[(0, unit(IMAGE_EMBED_DIM, 0))]).unwrap();
    db.set_image_region_vectors(plain, &[(0, unit(IMAGE_EMBED_DIM, 1))]).unwrap();

    let page = db
        .image_search(&unit(IMAGE_EMBED_DIM, 0), &ListOpts { page_size: 10, ..Default::default() })
        .unwrap();
    let a = page.items.iter().find(|r| r.id == analyzed).unwrap();
    let p = page.items.iter().find(|r| r.id == plain).unwrap();
    assert!(a.ai_analyzed, "gorsel yol: analizli → true");
    assert!(!p.ai_analyzed, "gorsel yol: analizsiz → false");
}

// --- ai_gorsel_turu (skaler MEDYA turu; map_asset_row index 13) — ai_analyzed deseninin analogu.
// Iki eksen DEGIL: yalniz OKUMA/kolon-hizasi (filtre `:gorsel_turu` ayri katmanda test'li). Tur
// yazilan asset TUM okuma yollarinda `Some("Render")`, yazilmayan `None` doldurmali (index 13
// regresyonunu her SELECT'te yakalar — bir projeksiyon kolon eksik/yanlis-hizali kalirsa runtime
// "no such column"/kaymis-deger olur).

/// list_assets → tur yazilan asset `ai_gorsel_turu==Some("Render")`, digeri `None` (duz liste yolu).
#[test]
fn list_assets_reports_ai_gorsel_turu() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let render = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_render(&db, render);

    let page = db.list_assets(&ListOpts { page_size: 50, ..Default::default() }).unwrap();
    let kind = |id: i64| page.items.iter().find(|r| r.id == id).unwrap().ai_gorsel_turu.clone();
    assert_eq!(kind(render).as_deref(), Some("Render"), "tur yazilan → Some(\"Render\")");
    assert_eq!(kind(plain), None, "tur yazilmayan → None");
}

/// get_asset (COLS / assets.id yolu, alias'siz) da `ai_gorsel_turu`'yu DOGRU doldurur.
#[test]
fn get_asset_fills_ai_gorsel_turu() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let render = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_render(&db, render);

    assert_eq!(
        db.get_asset(render).unwrap().unwrap().asset.ai_gorsel_turu.as_deref(),
        Some("Render")
    );
    assert_eq!(db.get_asset(plain).unwrap().unwrap().asset.ai_gorsel_turu, None);
}

/// Semantik (kNN + FILTER_FRAG hidratlama; COLS_A/a. alias yolu) → `ai_gorsel_turu` DOGRU dolar.
/// Kolon-hizasi (index 13) regresyonunu tam-metin-DISI bir yolda dogrular.
#[test]
fn semantic_search_fills_ai_gorsel_turu() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let render = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_render(&db, render);

    db.set_vector(render, &unit(TEXT_EMBED_DIM, 0)).unwrap();
    db.set_vector(plain, &unit(TEXT_EMBED_DIM, 1)).unwrap();

    let page = db
        .semantic_search(&unit(TEXT_EMBED_DIM, 0), &ListOpts { page_size: 10, ..Default::default() })
        .unwrap();
    let r = page.items.iter().find(|r| r.id == render).unwrap();
    let p = page.items.iter().find(|r| r.id == plain).unwrap();
    assert_eq!(r.ai_gorsel_turu.as_deref(), Some("Render"), "semantik yol: tur (kolon-hizasi 13)");
    assert_eq!(p.ai_gorsel_turu, None, "semantik yol: tursuz → None");
}

/// Gorsel (image_search kNN; COLS_A/a. alias yolu) → `ai_gorsel_turu` DOGRU dolar (image.rs projeksiyonu).
#[test]
fn image_search_fills_ai_gorsel_turu() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let render = seed(&mut db, "/a/1.jpg", "1.jpg", "jpg");
    let plain = seed(&mut db, "/a/2.jpg", "2.jpg", "jpg");
    mark_render(&db, render);

    db.set_image_region_vectors(render, &[(0, unit(IMAGE_EMBED_DIM, 0))]).unwrap();
    db.set_image_region_vectors(plain, &[(0, unit(IMAGE_EMBED_DIM, 1))]).unwrap();

    let page = db
        .image_search(&unit(IMAGE_EMBED_DIM, 0), &ListOpts { page_size: 10, ..Default::default() })
        .unwrap();
    let r = page.items.iter().find(|r| r.id == render).unwrap();
    let p = page.items.iter().find(|r| r.id == plain).unwrap();
    assert_eq!(r.ai_gorsel_turu.as_deref(), Some("Render"), "gorsel yol: tur → Some(\"Render\")");
    assert_eq!(p.ai_gorsel_turu, None, "gorsel yol: tursuz → None");
}

/// Baskin renk JSON'u tum AssetRow projeksiyonlarinda tipli okunur; bozuk/eski veri listeyi
/// dusurmez, bos palete iner. Liste + FTS + fuzzy + alias'siz detay + semantik + gorsel yollarini
/// tek testte gezerek 15. kolon hizasini korur.
#[test]
fn dominant_colors_survive_all_asset_row_paths() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let colored = seed(&mut db, "/a/kirmizi.jpg", "kirmizi.jpg", "jpg");
    let malformed = seed(&mut db, "/a/bozuk.jpg", "bozuk.jpg", "jpg");
    mark_colors(
        &db,
        colored,
        r#"[{"r":220,"g":30,"b":30,"percentage":100.0}]"#,
    );
    mark_colors(&db, malformed, "bu-json-degil");

    let assert_palette = |row: &archivist_db::AssetRow| {
        assert_eq!(row.dominant_colors.len(), 1);
        assert_eq!(row.dominant_colors[0].r, 220);
    };

    let list = db.list_assets(&ListOpts { page_size: 50, ..Default::default() }).unwrap();
    assert_palette(list.items.iter().find(|row| row.id == colored).unwrap());
    assert!(
        list.items.iter().find(|row| row.id == malformed).unwrap().dominant_colors.is_empty(),
        "bozuk JSON zarifce bos palete inmeli"
    );

    let fts = db
        .list_assets(&ListOpts {
            page_size: 50,
            query: Some("govde".into()),
            ..Default::default()
        })
        .unwrap();
    assert_palette(fts.items.iter().find(|row| row.id == colored).unwrap());

    let fuzzy = db
        .list_assets(&ListOpts {
            page_size: 50,
            query: Some("kirmiz".into()),
            fuzzy: true,
            ..Default::default()
        })
        .unwrap();
    assert_palette(fuzzy.items.iter().find(|row| row.id == colored).unwrap());

    assert_palette(&db.get_asset(colored).unwrap().unwrap().asset);

    db.set_vector(colored, &unit(TEXT_EMBED_DIM, 0)).unwrap();
    db.set_vector(malformed, &unit(TEXT_EMBED_DIM, 1)).unwrap();
    let semantic = db
        .semantic_search(&unit(TEXT_EMBED_DIM, 0), &ListOpts { page_size: 10, ..Default::default() })
        .unwrap();
    assert_palette(semantic.items.iter().find(|row| row.id == colored).unwrap());

    db.set_image_region_vectors(colored, &[(0, unit(IMAGE_EMBED_DIM, 0))]).unwrap();
    db.set_image_region_vectors(malformed, &[(0, unit(IMAGE_EMBED_DIM, 1))]).unwrap();
    let image = db
        .image_search(&unit(IMAGE_EMBED_DIM, 0), &ListOpts { page_size: 10, ..Default::default() })
        .unwrap();
    assert_palette(image.items.iter().find(|row| row.id == colored).unwrap());
}
