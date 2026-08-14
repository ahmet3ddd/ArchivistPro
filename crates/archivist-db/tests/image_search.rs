//! Gorsel arama (Faz 5.3) veri katmani — kNN + filtre + benzer-gorseller dogrulamasi.
//! **Model-bagimsiz**: gercek CLIP YOK; sentetik birim-vektorler + sahte thumbnail baytlari
//! ile kNN/filtre/exclude mantigi saf SQL/Rust seviyesinde test edilir. (Gercek CLIP ile
//! uctan-uca dogrulama `archivist-embed` real-model `#[ignore]` testinde.)

use archivist_db::{Db, ListOpts, IMAGE_EMBED_DIM, IMAGE_REGION_COUNT};
use rusqlite::params;

/// Tek sicak boyutlu birim vektor (dim = IMAGE_EMBED_DIM=512). Farkli `hot` → ortogonal.
fn unit(hot: usize) -> Vec<f32> {
    let mut v = vec![0f32; IMAGE_EMBED_DIM];
    v[hot] = 1.0;
    v
}

/// Iki sicak boyutlu vektor (alaka esigi testi icin ara cosine uretir). `(a,va)+(b,vb)`.
fn vec2(a: usize, va: f32, b: usize, vb: f32) -> Vec<f32> {
    let mut v = vec![0f32; IMAGE_EMBED_DIM];
    v[a] = va;
    v[b] = vb;
    v
}

/// Tek bolge (region 0 = GLOBAL) vektor yaz — 0010 tek-vektor davranisiyla uyumlu kisa yol
/// (arama testleri; tam-bolge-seti gerektirmeyen). image_knn/image_search_scored tek region ile de
/// dogru calisir (max-over-region tek bolgede o bolgedir).
fn set_global(db: &Db, id: i64, v: Vec<f32>) {
    db.set_image_region_vectors(id, &[(0, v)]).unwrap();
}

/// Bir asset'i TAM embedle (5 bolge ayni vektorle) → pending'ten duser (son bolge = tam-set kaniti).
fn set_all_regions(db: &Db, id: i64, v: &[f32]) {
    let regions: Vec<(usize, Vec<f32>)> = (0..IMAGE_REGION_COUNT).map(|r| (r, v.to_vec())).collect();
    db.set_image_region_vectors(id, &regions).unwrap();
}

/// Asset ekle (opsiyonel ext). Thumbnail + vektor ayri eklenir.
fn seed_asset(db: &Db, id: i64, name: &str, ext: &str) {
    db.connection()
        .execute(
            "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (?1, ?2, ?3, ?4, 10, 1, 1)",
            params![id, format!("/a/{name}"), name, ext],
        )
        .unwrap();
}

/// Sahte thumbnail bayti ekle (db katmani baytlari decode ETMEZ → icerik onemsiz).
fn add_thumb(db: &Db, id: i64) {
    db.connection()
        .execute(
            "INSERT INTO asset_thumbnails(asset_id, mime, width, height, bytes)
             VALUES (?1, 'image/jpeg', 10, 10, ?2)",
            params![id, vec![1u8, 2, 3, 4]],
        )
        .unwrap();
}

/// metin→gorsel: en yakin vektorlu asset ilk; ext filtresi + cop dislama uygulanir.
#[test]
fn image_search_ranks_by_distance_and_filters() {
    let db = Db::open_in_memory_migrated().unwrap();
    for (id, name, ext) in [(1, "a.jpg", "jpg"), (2, "b.jpg", "jpg"), (3, "c.png", "png")] {
        seed_asset(&db, id, name, ext);
        add_thumb(&db, id);
    }
    set_global(&db, 1, unit(0));
    set_global(&db, 2, unit(1));
    set_global(&db, 3, unit(2));

    let opts = ListOpts { page_size: 10, ..Default::default() };
    // unit(0)'a hizali sorgu → en yakin asset 1.
    let page = db.image_search(&unit(0), &opts).unwrap();
    assert_eq!(page.items.first().map(|r| r.id), Some(1), "en yakin gorsel asset 1");
    assert_eq!(page.total, 3);

    // ext=png → yalniz 3.
    let opts_png = ListOpts { page_size: 10, ext: vec!["png".into()], ..Default::default() };
    let page_png = db.image_search(&unit(0), &opts_png).unwrap();
    assert_eq!(page_png.items.iter().map(|r| r.id).collect::<Vec<_>>(), vec![3], "ext filtresi");

    // Asset 1 cope → gorsel sonuctan da dislanir (ORTAK FILTER_FRAG).
    db.connection().execute("UPDATE assets SET deleted_at = 99 WHERE id = 1", []).unwrap();
    let page2 = db.image_search(&unit(0), &opts).unwrap();
    assert!(page2.items.iter().all(|r| r.id != 1), "cope atilmis asset gorsel sonuca sizmamali");
    assert_eq!(page2.total, 2);
}

/// Gercek cosine skoru (sohbet gorsel-fallback): adaylar GERCEK cosine ile (vec0 mesafe-metriginden
/// bagimsiz) AZALAN sirali + skoruyla doner; alaka esigi ust katmanda (skor gorunur → kalibrasyon).
#[test]
fn image_search_scored_returns_real_cosine_sorted() {
    let db = Db::open_in_memory_migrated().unwrap();
    for (id, name) in [(1, "a.jpg"), (2, "b.jpg"), (3, "c.jpg")] {
        seed_asset(&db, id, name, "jpg");
        add_thumb(&db, id);
    }
    set_global(&db, 1, unit(0)); // sorgu unit(0) ile cos = 1.0
    set_global(&db, 2, vec2(0, 0.6, 1, 0.8)); // cos = 0.6 (birim)
    set_global(&db, 3, unit(1)); // cos = 0.0

    let opts = ListOpts { page_size: 10, ..Default::default() };
    let scored = db.image_search_scored(&unit(0), &opts).unwrap();
    assert_eq!(scored.iter().map(|(r, _)| r.id).collect::<Vec<_>>(), vec![1, 2, 3], "cosine azalan");
    assert!((scored[0].1 - 1.0).abs() < 1e-5, "asset1 cosine ~1.0");
    assert!((scored[1].1 - 0.6).abs() < 1e-5, "asset2 cosine ~0.6");
    assert!(scored[2].1.abs() < 1e-5, "asset3 cosine ~0.0");

    // Cope atilmis asset FILTER_FRAG ile skorlu sonuctan da elenir.
    db.connection().execute("UPDATE assets SET deleted_at = 99 WHERE id = 1", []).unwrap();
    let s2 = db.image_search_scored(&unit(0), &opts).unwrap();
    assert!(s2.iter().all(|(r, _)| r.id != 1), "cope atilmis asset elenir");
}

/// gorsel→gorsel: sorgu asset'inin KENDISI sonuctan elenir; en benzer once.
#[test]
fn similar_images_excludes_self() {
    let db = Db::open_in_memory_migrated().unwrap();
    for (id, name) in [(1, "a.jpg"), (2, "b.jpg"), (3, "c.jpg")] {
        seed_asset(&db, id, name, "jpg");
        add_thumb(&db, id);
    }
    set_global(&db, 1, unit(0)); // sorgu (region 0 = global; similar_images bunu okur)
    set_global(&db, 2, unit(0)); // ozdes → en benzer
    set_global(&db, 3, unit(9)); // uzak

    let opts = ListOpts { page_size: 10, ..Default::default() };
    let page = db.similar_images(1, &opts).unwrap();
    let ids: Vec<i64> = page.items.iter().map(|r| r.id).collect();
    assert!(!ids.contains(&1), "sorgu asset'inin kendisi elenmeli");
    assert_eq!(page.items.first().map(|r| r.id), Some(2), "ozdes vektor en benzer");
    assert_eq!(page.total, 2, "kalan 2 asset (kendisi haric)");

    // Gorsel-vektoru olmayan asset icin benzer-gorseller bos.
    seed_asset(&db, 4, "d.jpg", "jpg");
    add_thumb(&db, 4);
    assert_eq!(db.similar_images(4, &opts).unwrap().total, 0, "vektorsuz asset → bos");
}

/// "Gorseller + thumbnail'lar" kapsami: yalniz thumbnail'i OLAN asset'ler bekleyen sayilir;
/// cursor ilerler; vektor yazilinca dusulur.
#[test]
fn pending_scope_is_thumbnail_bound_and_resumable() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed_asset(&db, 1, "a.jpg", "jpg");
    add_thumb(&db, 1);
    seed_asset(&db, 2, "b.pdf", "pdf");
    add_thumb(&db, 2); // PDF on-izleme thumbnail'i da kapsama girer
    seed_asset(&db, 3, "c.txt", "txt"); // thumbnail YOK → kapsam disi

    assert_eq!(db.pending_image_embed_count().unwrap(), 2, "yalniz thumbnail'li 2 asset");
    let pending = db.assets_without_image_vectors(0, 10).unwrap();
    assert_eq!(pending.iter().map(|p| p.id).collect::<Vec<_>>(), vec![1, 2]);
    assert_eq!(pending[0].thumb_bytes, vec![1u8, 2, 3, 4], "thumbnail baytlari getirilir");

    // TAM bolge seti (5 bolge) yaz → asset 1 "embedlenmis" (son bolge = tam-set kaniti) → pending duser.
    set_all_regions(&db, 1, &unit(0));
    assert_eq!(db.pending_image_embed_count().unwrap(), 1);
    assert_eq!(db.image_vector_count().unwrap(), 1, "DISTINCT asset (bolge satiri degil)");
    let pending2 = db.assets_without_image_vectors(0, 10).unwrap();
    assert_eq!(pending2.iter().map(|p| p.id).collect::<Vec<_>>(), vec![2]);
    // Cursor: after_id=2 → 2'den buyuk thumbnail'li asset yok.
    assert!(db.assets_without_image_vectors(2, 10).unwrap().is_empty());

    // EKSIK bolge seti (yalniz region 0 — migration 0022 tasima durumu) → HALA bekleyen (son bolge yok).
    set_global(&db, 2, unit(1));
    assert_eq!(db.pending_image_embed_count().unwrap(), 1, "yalniz region 0 → tam degil → hala bekliyor");
    assert_eq!(db.image_vector_count().unwrap(), 2, "region 0'li asset de embedlenmis sayilir (DISTINCT)");
    assert_eq!(
        db.assets_without_image_vectors(0, 10).unwrap().iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![2],
        "eksik-bolgeli asset 2 yeniden-embed icin listelenir"
    );
}

/// AI vision-metadata: set_ai_metadata (ai_ EAV + marker, idempotent) + analyzed/pending sayim +
/// assets_without_analysis cursor (thumbnail-bound). Gorsel-analizi job'unun veri katmani.
#[test]
fn ai_metadata_set_counts_and_pending() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed_asset(&db, 1, "a.jpg", "jpg");
    add_thumb(&db, 1);
    seed_asset(&db, 2, "b.jpg", "jpg");
    add_thumb(&db, 2);
    seed_asset(&db, 3, "c.txt", "txt"); // thumbnail YOK → analiz kapsami disi

    assert_eq!(db.pending_analysis_count().unwrap(), 2, "yalniz thumbnail'li 2 asset");
    assert_eq!(db.analyzed_count().unwrap(), 0);
    assert_eq!(
        db.assets_without_analysis(0, 10).unwrap().iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![1, 2]
    );

    db.set_ai_metadata(
        1,
        &[
            ("ai_aciklama", "bulutlu gokyuzu manzarasi".to_string()),
            ("ai_anahtar_kelimeler", "bulut, gokyuzu".to_string()),
        ],
    )
    .unwrap();
    assert_eq!(db.analyzed_count().unwrap(), 1);
    assert_eq!(db.pending_analysis_count().unwrap(), 1);
    // Cursor: 1 analiz edildi → assets_without_analysis yalniz 2'yi getirir.
    assert_eq!(
        db.assets_without_analysis(0, 10).unwrap().iter().map(|p| p.id).collect::<Vec<_>>(),
        vec![2]
    );

    let ai_cnt = |id: i64| -> i64 {
        db.connection()
            .query_row(
                r"SELECT count(*) FROM asset_metadata WHERE asset_id=?1 AND key LIKE 'ai\_%' ESCAPE '\'",
                [id],
                |r| r.get(0),
            )
            .unwrap()
    };
    assert_eq!(ai_cnt(1), 3, "2 ai alani + ai_analyzed marker");

    // Re-analiz idempotent: eski ai_ silinir, yeni yazilir.
    db.set_ai_metadata(1, &[("ai_aciklama", "yeni betim".to_string())]).unwrap();
    assert_eq!(ai_cnt(1), 2, "1 ai alani + marker (eskiler silindi)");
}

/// Yanlis boyut + gecersiz region reddedilir (erken + net hata).
#[test]
fn set_image_region_vectors_rejects_wrong_dim_and_region() {
    let db = Db::open_in_memory_migrated().unwrap();
    seed_asset(&db, 1, "a.jpg", "jpg");
    assert!(
        db.set_image_region_vectors(1, &[(0, vec![0.0; 10])]).is_err(),
        "512 olmayan vektor reddedilmeli"
    );
    assert!(
        db.set_image_region_vectors(1, &[(8, unit(0))]).is_err(),
        "region >= STRIDE(8) reddedilmeli (asset-cakismasi onlenir)"
    );
}

/// **BOLGE-MAX kaniti** (kompozisyon): bir asset'in SADECE BIR bolgesi sorguya cok yakinsa (diger
/// bolgeler uzak) o asset UST sirada gelir + skoru o bolgenin cosine'i (max-over-region). Global-
/// tek-vektor bunu KACIRIRDI (tek vektor tum sahneyi ortalar → yakin bolge seyrelir). H2 tezi.
#[test]
fn image_search_scored_takes_max_over_regions() {
    let db = Db::open_in_memory_migrated().unwrap();
    for (id, name) in [(1, "a.jpg"), (2, "b.jpg")] {
        seed_asset(&db, id, name, "jpg");
        add_thumb(&db, id);
    }
    // Sorgu unit(0). Asset A (id=1): YALNIZ region 2 sorguya cok yakin (cos 0.9); digerleri ortogonal.
    let near = vec2(0, 0.9, 1, 0.435_889_9); // |near|=1, cos(unit0) = 0.9
    db.set_image_region_vectors(
        1,
        &[
            (0, unit(30)),      // global: uzak
            (1, unit(31)),      // center: uzak
            (2, near.clone()),  // top-left: YAKIN (cos 0.9)
            (3, unit(33)),      // top-right: uzak
            (4, unit(34)),      // bottom-center: uzak
        ],
    )
    .unwrap();
    // Asset B (id=2): HICBIR bolge yakin degil (hepsi ortogonal → cos ~0).
    db.set_image_region_vectors(
        2,
        &[(0, unit(40)), (1, unit(41)), (2, unit(42)), (3, unit(43)), (4, unit(44))],
    )
    .unwrap();

    let opts = ListOpts { page_size: 10, ..Default::default() };
    let scored = db.image_search_scored(&unit(0), &opts).unwrap();

    // A, B'den YUKARIDA (tek yakin bolge yeter → kompozisyon yakalanir).
    assert_eq!(scored.first().map(|(r, _)| r.id), Some(1), "tek-yakin-bolgeli asset ust sirada");
    // A'nin skoru = o TEK bolgenin cosine'i (MAX), digerlerinin ~0'i degil.
    assert!(
        (scored[0].1 - 0.9).abs() < 1e-4,
        "A skoru bolge-MAX = 0.9 olmali, gercek: {}",
        scored[0].1
    );
    // B de aday (ortogonal bolgeler de kNN'e girer) ama cok daha dusuk skorla.
    let b = scored.iter().find(|(r, _)| r.id == 2).expect("B de sonuçta");
    assert!(b.1 < scored[0].1, "B skoru A'dan dusuk (yakin bolgesi yok): B={} A={}", b.1, scored[0].1);
}

/// purge bir asset'in TUM bolge satirlarini temizler (PK-kodlama `id/STRIDE IN` yolu); digerini
/// birakmaz + yetim dogurmaz.
#[test]
fn purge_removes_all_region_vectors() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    for id in [1, 2] {
        seed_asset(&db, id, &format!("{id}.jpg"), "jpg");
        add_thumb(&db, id);
        set_all_regions(&db, id, &unit(id as usize)); // her asset 5 bolge
    }
    let region_rows = |db: &Db| -> i64 {
        db.connection()
            .query_row("SELECT count(*) FROM asset_image_region_vectors", [], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(db.image_vector_count().unwrap(), 2, "iki asset embedlenmis");
    assert_eq!(region_rows(&db), 10, "2 asset x 5 bolge");

    assert_eq!(db.purge(&[1]).unwrap(), 1);
    assert_eq!(db.image_vector_count().unwrap(), 1, "asset 1 purge → yalniz asset 2 kalir");
    assert_eq!(region_rows(&db), 5, "asset 1'in 5 bolge satiri temizlendi");
    let stray: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM asset_image_region_vectors WHERE id / 8 <> 2", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(stray, 0, "asset 1'e ait bolge satiri kalmadi");
    assert_eq!(db.orphan_count().unwrap(), 0, "purge sonrasi yetim yok");
}
