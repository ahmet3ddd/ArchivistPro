//! Gorsel medya turu (`ai_gorsel_turu`) — facet sayimi + liste filtresi.
//!
//! Test-first: `gorsel_turu_facets` (EAV grupla-say, count DESC, §O cop haric) +
//! `ListOpts.gorsel_turu` TEKIL filtre (`FILTER_FRAG` `:gorsel_turu` dali; facet-arasi AND).
//! Seed: `write_image_kind` kanonik TR token yazar (Fotoğraf | Render | Doku).
//! `approval_facets` (count DESC) + `ai_analyzed` (tekil filtre) desenlerinin birlesimi.

use archivist_db::{AssetInput, Db, ImageKind, IngestData, ListOpts};

/// Bir asset ingest et (ext kontrollu; ortak "govde metni" body → FTS compose testi icin) → id.
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

/// Ingest + `ai_gorsel_turu` EAV yaz (write_image_kind, idempotent) → id.
fn seed_kind(db: &mut Db, path: &str, name: &str, ext: &str, kind: ImageKind) -> i64 {
    let id = seed(db, path, name, ext);
    assert!(db.write_image_kind(id, kind).unwrap(), "yeni asset → gorsel_turu yazilir");
    id
}

/// `gorsel_turu_facets`: dolu degerleri (Fotoğraf/Render/Doku) grupla-say (count DESC);
/// gorsel_turu'su olmayan asset facet'te GORUNMEZ; §O cop (soft-delete) sayima girmez.
#[test]
fn gorsel_turu_facets_counts_active_only() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let r1 = seed_kind(&mut db, "/a/1.jpg", "1.jpg", "jpg", ImageKind::Render);
    let _r2 = seed_kind(&mut db, "/a/2.jpg", "2.jpg", "jpg", ImageKind::Render);
    let _f = seed_kind(&mut db, "/a/3.jpg", "3.jpg", "jpg", ImageKind::Fotograf);
    let _d = seed_kind(&mut db, "/a/4.jpg", "4.jpg", "jpg", ImageKind::Doku);
    let _plain = seed(&mut db, "/a/5.jpg", "5.jpg", "jpg"); // gorsel_turu YOK → facet'te yok

    let facets = db.gorsel_turu_facets().unwrap();
    // Yalniz 3 dolu deger (plain haric). Render count DESC → ilk.
    assert_eq!(facets.len(), 3, "yalniz dolu gorsel_turu degerleri (plain sayilmaz)");
    assert_eq!(facets[0].value.as_deref(), Some("Render"), "en cok Render ilk (count DESC)");
    assert_eq!(facets[0].count, 2);
    let count_of =
        |v: &str| facets.iter().find(|f| f.value.as_deref() == Some(v)).unwrap().count;
    assert_eq!(count_of("Fotoğraf"), 1);
    assert_eq!(count_of("Doku"), 1);
    // Toplam = 4 (dolu asset'ler; plain girmez).
    assert_eq!(facets.iter().map(|f| f.count).sum::<i64>(), 4);
    assert!(facets.iter().all(|f| f.value.is_some()), "NULL/bos deger facet'te yok");

    // §O: cop'e atilan asset facet'ten duser (deleted_at IS NULL — metadata satiri silinmese de).
    db.soft_delete(&[r1]).unwrap();
    let after = db.gorsel_turu_facets().unwrap();
    let render = after.iter().find(|f| f.value.as_deref() == Some("Render")).unwrap();
    assert_eq!(render.count, 1, "cop'teki asset gorsel_turu sayisina girmez");
}

/// `ListOpts.gorsel_turu` tekil filtre: Some(token) → yalniz o tur; None → tum (regresyonsuz);
/// olmayan token → 0.
#[test]
fn list_assets_filters_by_gorsel_turu() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let r1 = seed_kind(&mut db, "/a/1.jpg", "1.jpg", "jpg", ImageKind::Render);
    let r2 = seed_kind(&mut db, "/a/2.png", "2.png", "png", ImageKind::Render);
    let _f = seed_kind(&mut db, "/a/3.jpg", "3.jpg", "jpg", ImageKind::Fotograf);
    let _d = seed_kind(&mut db, "/a/4.jpg", "4.jpg", "jpg", ImageKind::Doku);
    let _plain = seed(&mut db, "/a/5.jpg", "5.jpg", "jpg"); // gorsel_turu YOK

    // Some("Render") → yalniz iki render.
    let render =
        ListOpts { page_size: 50, gorsel_turu: Some("Render".into()), ..Default::default() };
    let page = db.list_assets(&render).unwrap();
    assert_eq!(page.total, 2, "yalniz Render");
    let mut ids: Vec<i64> = page.items.iter().map(|r| r.id).collect();
    ids.sort_unstable();
    let mut want = vec![r1, r2];
    want.sort_unstable();
    assert_eq!(ids, want, "yalniz render id'leri");

    // None → tum 5 (regresyonsuz; plain dahil).
    assert_eq!(
        db.list_assets(&ListOpts { page_size: 50, ..Default::default() }).unwrap().total,
        5,
        "gorsel_turu None → filtre yok → tum asset'ler"
    );

    // Diger token'lar + olmayan token.
    let total = |t: &str| {
        db.list_assets(&ListOpts {
            page_size: 50,
            gorsel_turu: Some(t.into()),
            ..Default::default()
        })
        .unwrap()
        .total
    };
    assert_eq!(total("Fotoğraf"), 1);
    assert_eq!(total("Doku"), 1);
    assert_eq!(total("Yok"), 0, "olmayan token → 0 (bos degil, sessiz-yanlis degil)");
}

/// Facet-arasi AND: gorsel_turu diger filtrelerle (ext, FTS) kompose olur — kesisim daraltir.
#[test]
fn gorsel_turu_composes_with_other_filters() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let r_jpg = seed_kind(&mut db, "/a/1.jpg", "1.jpg", "jpg", ImageKind::Render);
    let _r_png = seed_kind(&mut db, "/a/2.png", "2.png", "png", ImageKind::Render);
    let _f_jpg = seed_kind(&mut db, "/a/3.jpg", "3.jpg", "jpg", ImageKind::Fotograf);

    // ext=jpg AND gorsel_turu=Render → yalniz r_jpg (r_png ext ile, f_jpg tur ile elenir).
    let by_ext = ListOpts {
        page_size: 50,
        ext: vec!["jpg".into()],
        gorsel_turu: Some("Render".into()),
        ..Default::default()
    };
    let page = db.list_assets(&by_ext).unwrap();
    assert_eq!(page.total, 1, "ext(jpg) ∩ Render = 1");
    assert_eq!(page.items[0].id, r_jpg);

    // FTS "govde" (hepsi eslesir) AND gorsel_turu=Render → 2 (filtre FTS ile AND; :match + :gorsel_turu).
    let by_fts = ListOpts {
        page_size: 50,
        query: Some("govde".into()),
        gorsel_turu: Some("Render".into()),
        ..Default::default()
    };
    assert_eq!(db.list_assets(&by_fts).unwrap().total, 2, "FTS ∩ Render → 2");
}
