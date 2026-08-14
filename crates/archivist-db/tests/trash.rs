//! §O cop kutusu (trash) entegrasyon testleri — soft-delete + restore + purge.
//!
//! Bu katman YIKICI (purge geri-alinamaz) + aktif-filtre EXHAUSTIVE olmali (cop'teki
//! bir asset HICBIR aktif gorunume sizmamali). Bu yuzden test-first: her aktif sayim/
//! liste yolunun cop'teki asset'i dislamasi tek tek dogrulanir.
//!
//! Migration 0007 (`deleted_at`) write/query/trash yollariyla birlikte dogrulanir.

use archivist_db::{AssetInput, Db, IngestData, ListOpts, MetaVal};
use rusqlite::params;

/// Minimal bir asset ingest et (metadata + auto-tag + thumbnail opsiyonel), id dondur.
fn ingest_one(db: &mut Db, path: &str, name: &str, ext: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some(ext),
            size_bytes: 100,
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

/// LAN Faz 3 — `active_asset_ids`: cope atilmis id'ler ELENIR.
///
/// **Neden bu test var (gercek bir sizinti kapatiyor):** `get_thumbnails` `asset_thumbnails`
/// tablosunu id ile DOGRUDAN okur, `assets` ile JOIN etmez ⇒ `deleted_at` suzgeci YOKTUR.
/// Yerelde zararsizdi (grid yalnizca gorunur id'leri ister) ama LAN'da istemci id UYDURABILIR
/// → cope atilmis bir dosyanin onizlemesi disari sizardi. Uzak thumbnail yolu id'leri once
/// buradan gecirir.
#[test]
fn active_asset_ids_copteki_id_leri_eler() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/x/a.pdf", "a.pdf", "pdf");
    let b = ingest_one(&mut db, "/x/b.pdf", "b.pdf", "pdf");
    let c = ingest_one(&mut db, "/x/c.pdf", "c.pdf", "pdf");

    // Hepsi aktifken hepsi doner.
    let mut all = db.active_asset_ids(&[a, b, c]).unwrap();
    all.sort_unstable();
    let mut expected = vec![a, b, c];
    expected.sort_unstable();
    assert_eq!(all, expected, "aktif id'ler aynen doner");

    // b cope atilinca ELENIR.
    assert_eq!(db.soft_delete(&[b]).unwrap(), 1);
    let mut left = db.active_asset_ids(&[a, b, c]).unwrap();
    left.sort_unstable();
    let mut expected2 = vec![a, c];
    expected2.sort_unstable();
    assert_eq!(left, expected2, "cop'teki id elenmeli");
    assert!(!left.contains(&b), "cop'teki id ASLA donmemeli");

    // Geri alinca yeniden doner (suzgec kalici damga degil, canli durum).
    assert_eq!(db.restore(&[b]).unwrap(), 1);
    assert!(db.active_asset_ids(&[b]).unwrap().contains(&b), "restore sonrasi geri gelir");

    // Var olmayan id sessizce elenir (uzak istemci uydurabilir → hata degil, bos sonuc).
    assert!(db.active_asset_ids(&[999_999]).unwrap().is_empty(), "olmayan id → bos");
    assert!(db.active_asset_ids(&[]).unwrap().is_empty(), "bos girdi → bos");
}

/// Bir asset'e vec0 embedding yaz (purge'un vektorleri temizledigini dogrulamak icin).
/// 384-boyutlu birim vektor (tek sicak boyut; migration 0009). `connection()` ham erisimi
/// crate-ici test koprusudur (lib.rs'te belgeli).
fn add_vector(db: &Db, id: i64, hot: usize) {
    let mut parts = vec!["0"; 384];
    parts[hot] = "1";
    let v = format!("[{}]", parts.join(","));
    db.connection()
        .execute("INSERT INTO asset_vectors(asset_id, embedding) VALUES (?1, ?2)", params![id, v])
        .expect("vektor yaz");
}

fn full_list(db: &Db) -> Vec<i64> {
    db.list_assets(&ListOpts { page_size: 500, ..Default::default() })
        .unwrap()
        .items
        .into_iter()
        .map(|r| r.id)
        .collect()
}

/// soft-delete bir asset'i TUM aktif sayim/liste yollarindan gizler; list_trash gosterir;
/// restore geri getirir. Aktif-filtrenin exhaustive oldugu burada tek tek dogrulanir.
#[test]
fn soft_delete_hides_from_all_active_views_then_restore_brings_back() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/proj/a.dwg", "a.dwg", "dwg");
    let b = ingest_one(&mut db, "/proj/b.dwg", "b.dwg", "dwg");

    // a'ya favori + kullanici-etiketi + koleksiyon-uyeligi ekle (cop'te bunlar DURMALI,
    // ama aktif sayimlardan dusmeli).
    db.set_favorite(a, true).unwrap();
    db.add_user_tag(a, "villa").unwrap();
    let col = db.create_collection("Set", None).unwrap();
    db.add_to_collection(col, a).unwrap();

    // ── Cop ONCESI taban sayimlar (a + b aktif) ──
    assert_eq!(db.asset_count().unwrap(), 2);
    assert_eq!(full_list(&db).len(), 2);
    assert_eq!(db.ext_facets().unwrap().iter().find(|f| f.value.as_deref() == Some("dwg")).unwrap().count, 2);
    assert_eq!(db.favorite_count().unwrap(), 1);
    assert_eq!(db.tag_facets(10).unwrap().iter().find(|f| f.value.as_deref() == Some("villa")).unwrap().count, 1);
    assert_eq!(db.metadata_facets("author", 10).unwrap().iter().find(|f| f.value.as_deref() == Some("Ada")).unwrap().count, 2);
    assert_eq!(db.folder_summary().unwrap().iter().find(|f| f.path == "/proj").unwrap().file_count, 2);
    let ds = db.dashboard_stats(None).unwrap();
    assert_eq!(ds.total_assets, 2);
    assert_eq!(ds.total_size, 200);
    assert_eq!(ds.ext_counts.iter().find(|f| f.value.as_deref() == Some("dwg")).unwrap().count, 2);
    assert_eq!(db.trash_count().unwrap(), 0);
    assert!(db.list_trash().unwrap().is_empty());

    // ── a'yi cop'e at (soft-delete) ──
    assert_eq!(db.soft_delete(&[a]).unwrap(), 1);
    // Idempotent: tekrar cop'e atmak 0 etkiler (zaten cop'te).
    assert_eq!(db.soft_delete(&[a]).unwrap(), 0);

    // ── Cop SONRASI: a HER aktif gorunumden dusmeli (yalniz b kalir) ──
    assert_eq!(db.asset_count().unwrap(), 1, "asset_count cop'teki a'yi saymamali");
    assert_eq!(full_list(&db), vec![b], "list_assets cop'teki a'yi listelememeli");
    // FTS tam-metin yolu da cop'teki a'yi dislamali (FILTER_FRAG MATCH yolunda da gecerli).
    // a'nin fts_body/title = "a.dwg" → "a" terimi a'yi MATCH ederdi; cop'te artik gelmez.
    let search_a = db
        .list_assets(&ListOpts { page_size: 50, query: Some("a".into()), ..Default::default() })
        .unwrap();
    assert!(search_a.items.iter().all(|r| r.id != a), "FTS arama cop'teki a'yi dondurmemeli");
    // Aktif b ise "b" aramasinda hala gelir (arama yolu calismaya devam eder).
    let search_b = db
        .list_assets(&ListOpts { page_size: 50, query: Some("b".into()), ..Default::default() })
        .unwrap();
    assert!(search_b.items.iter().any(|r| r.id == b), "FTS arama aktif b'yi dondurmeli");
    // a'ya ait dwg sayisi 2→1 dustu.
    assert_eq!(db.ext_facets().unwrap().iter().find(|f| f.value.as_deref() == Some("dwg")).unwrap().count, 1, "ext_facets cop'teki a'yi saymamali");
    // a favoriydi → favori sayisi 1→0.
    assert_eq!(db.favorite_count().unwrap(), 0, "favorite_count cop'teki favoriyi saymamali");
    // a 'villa' etiketliydi → tag faceti artik villa icermez (0 → bulunmaz).
    assert!(db.tag_facets(10).unwrap().iter().all(|f| f.value.as_deref() != Some("villa")), "tag_facets cop'teki etiketi saymamali");
    // a metadata 'author=Ada' → sayim 2→1.
    assert_eq!(db.metadata_facets("author", 10).unwrap().iter().find(|f| f.value.as_deref() == Some("Ada")).unwrap().count, 1, "metadata_facets cop'teki asset'i saymamali");
    // /proj klasor sayisi 2→1.
    assert_eq!(db.folder_summary().unwrap().iter().find(|f| f.path == "/proj").unwrap().file_count, 1, "folder_summary cop'teki a'yi saymamali");
    // dashboard: sayi 2→1, boyut 200→100, dwg 2→1.
    let ds = db.dashboard_stats(None).unwrap();
    assert_eq!(ds.total_assets, 1, "dashboard total_assets cop'teki a'yi saymamali");
    assert_eq!(ds.total_size, 100, "dashboard total_size cop'teki a'yi saymamali");
    assert_eq!(ds.ext_counts.iter().find(|f| f.value.as_deref() == Some("dwg")).unwrap().count, 1, "dashboard ext_counts cop'teki a'yi saymamali");

    // ── list_trash a'yi GOSTERMELI; trash_count = 1 ──
    assert_eq!(db.trash_count().unwrap(), 1);
    let trash = db.list_trash().unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].id, a);
    // get_asset cop'teki a'yi DONDURMEMELI (detay yolu da liste/facet yollariyla ayni
    // `deleted_at IS NULL` guard'ini uygular; guard'in eksikligi gerilemeydi).
    assert!(db.get_asset(a).unwrap().is_none(), "get_asset cop'teki asset'i dondurmemeli");

    // ── restore: a yeniden aktif → tum sayimlar geri ──
    assert_eq!(db.restore(&[a]).unwrap(), 1);
    // Idempotent: zaten aktif → 0.
    assert_eq!(db.restore(&[a]).unwrap(), 0);
    assert_eq!(db.asset_count().unwrap(), 2, "restore a'yi geri getirmeli");
    assert_eq!(full_list(&db).len(), 2);
    assert_eq!(db.favorite_count().unwrap(), 1, "restore favori sayimini geri getirmeli");
    assert_eq!(db.trash_count().unwrap(), 0);
    assert!(db.list_trash().unwrap().is_empty());
    // Iliskili veri soft-delete boyunca KORUNDU → restore sonrasi detay tam gelir
    // (bu iddia eskiden cop'teyken get_asset ile olculuyordu; guard sonrasi restore'a tasindi).
    let detail = db.get_asset(a).unwrap().expect("restore sonrasi asset detayi gelmeli");
    assert_eq!(detail.asset.id, a);
    assert!(detail.asset.favorite, "soft-delete favori isaretini silmemeli");
    assert!(detail.tags.iter().any(|t| t.name == "villa"), "soft-delete etiketi silmemeli");
    assert!(detail.collections.iter().any(|c| c.id == col), "soft-delete koleksiyon-uyeligini silmemeli");
}

/// purge bir asset'i KALICI siler + tum iliskili veriyi (etiket-bagi/favori/koleksiyon-
/// uyeligi/metadata/thumbnail/FTS/vektor) temizler. FK CASCADE + FTS trigger + elle
/// vektor temizligi birlikte dogrulanir (yetim kalmaz).
#[test]
fn purge_permanently_removes_and_cleans_all_related() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/proj/a.dwg", "a.dwg", "dwg");
    let b = ingest_one(&mut db, "/proj/b.dwg", "b.dwg", "dwg");

    // a'ya: favori + etiket + koleksiyon + thumbnail + vektor + FTS body.
    db.set_favorite(a, true).unwrap();
    db.add_user_tag(a, "villa").unwrap();
    let col = db.create_collection("Set", None).unwrap();
    db.add_to_collection(col, a).unwrap();
    db.ingest(
        &AssetInput {
            path: "/proj/a.dwg",
            file_name: "a.dwg",
            ext: Some("dwg"),
            size_bytes: 100,
            content_hash: None,
            mime: None,
            title: Some("a.dwg"),
            description: None,
            created_at: 1,
            modified_at: 1,
        },
        &IngestData {
            fts_body: Some("villa plani"),
            metadata: &[("author".to_string(), MetaVal::Text("Ada".to_string()))],
            auto_tags: &[],
            phash: None,
            thumbnail: Some(archivist_db::ThumbnailInput {
                mime: "image/jpeg",
                width: 10,
                height: 10,
                bytes: &[1, 2, 3],
            }),
        },
    )
    .unwrap();
    add_vector(&db, a, 0);
    add_vector(&db, b, 1);

    // Purge oncesi: a'nin iliskili satirlari var.
    let conn = db.connection();
    let count = |sql: &str, id: i64| -> i64 {
        conn.query_row(sql, params![id], |r| r.get(0)).unwrap()
    };
    assert_eq!(count("SELECT count(*) FROM favorites WHERE asset_id=?1", a), 1);
    assert_eq!(count("SELECT count(*) FROM asset_tags WHERE asset_id=?1", a), 1);
    assert_eq!(count("SELECT count(*) FROM collection_items WHERE asset_id=?1", a), 1);
    assert_eq!(count("SELECT count(*) FROM asset_metadata WHERE asset_id=?1", a), 1);
    assert_eq!(count("SELECT count(*) FROM asset_thumbnails WHERE asset_id=?1", a), 1);
    assert_eq!(count("SELECT count(*) FROM asset_vectors WHERE asset_id=?1", a), 1);
    assert_eq!(count("SELECT count(*) FROM assets_fts WHERE asset_id=?1", a), 1);

    // ── purge a (b'yi kalici sile karistirmadan) ──
    assert_eq!(db.purge(&[a]).unwrap(), 1);
    // Idempotent: zaten yok → 0.
    assert_eq!(db.purge(&[a]).unwrap(), 0);

    // ── a ARTIK her yerde yok (yetim kalmadi) ──
    let conn = db.connection();
    let count = |sql: &str, id: i64| -> i64 {
        conn.query_row(sql, params![id], |r| r.get(0)).unwrap()
    };
    assert_eq!(count("SELECT count(*) FROM assets WHERE id=?1", a), 0, "asset silinmeli");
    assert_eq!(count("SELECT count(*) FROM favorites WHERE asset_id=?1", a), 0, "favori CASCADE temizlenmeli");
    assert_eq!(count("SELECT count(*) FROM asset_tags WHERE asset_id=?1", a), 0, "etiket-bagi CASCADE temizlenmeli");
    assert_eq!(count("SELECT count(*) FROM collection_items WHERE asset_id=?1", a), 0, "koleksiyon-uyeligi CASCADE temizlenmeli");
    assert_eq!(count("SELECT count(*) FROM asset_metadata WHERE asset_id=?1", a), 0, "metadata CASCADE temizlenmeli");
    assert_eq!(count("SELECT count(*) FROM asset_thumbnails WHERE asset_id=?1", a), 0, "thumbnail CASCADE temizlenmeli");
    assert_eq!(count("SELECT count(*) FROM assets_fts WHERE asset_id=?1", a), 0, "FTS satiri silme-trigger ile temizlenmeli");
    assert_eq!(count("SELECT count(*) FROM asset_vectors WHERE asset_id=?1", a), 0, "vektor ELLE temizlenmeli (vec0 FK/trigger yok)");

    // b ve b'nin vektoru DURMALI (purge yalniz verilen id'leri etkiler).
    assert_eq!(count("SELECT count(*) FROM assets WHERE id=?1", b), 1, "b silinmemeli");
    assert_eq!(count("SELECT count(*) FROM asset_vectors WHERE asset_id=?1", b), 1, "b'nin vektoru durmali");

    // Butunluk: hicbir yetim satir kalmadi (orphan_count = 0).
    assert_eq!(db.orphan_count().unwrap(), 0, "purge sonrasi yetim satir olmamali");
    assert_eq!(db.asset_count().unwrap(), 1);
}

/// purge cop'te OLMAYAN (aktif) asset'i de silebilir; ayrica cop'ten purge yolu
/// (soft-delete → purge) calisir + trash_count gunceller.
#[test]
fn purge_from_trash_and_direct_active() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/x/a.txt", "a.txt", "txt");
    let b = ingest_one(&mut db, "/x/b.txt", "b.txt", "txt");
    let c = ingest_one(&mut db, "/x/c.txt", "c.txt", "txt");

    // a → cop, sonra cop'ten kalici sil.
    db.soft_delete(&[a]).unwrap();
    assert_eq!(db.trash_count().unwrap(), 1);
    assert_eq!(db.purge(&[a]).unwrap(), 1);
    assert_eq!(db.trash_count().unwrap(), 0, "cop'ten purge trash_count'u dusurmeli");

    // b → dogrudan (cop'e ugramadan) kalici sil; toplu (b ve c birlikte).
    assert_eq!(db.purge(&[b, c]).unwrap(), 2);
    assert_eq!(db.asset_count().unwrap(), 0);
}

/// Toplu (batch) soft-delete/restore: cok id tek TX'te + sadece uygun satirlari etkiler.
#[test]
fn batch_soft_delete_and_restore_counts() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/y/a.txt", "a.txt", "txt");
    let b = ingest_one(&mut db, "/y/b.txt", "b.txt", "txt");
    let c = ingest_one(&mut db, "/y/c.txt", "c.txt", "txt");

    // a + b cop'e (toplu). c aktif kalir.
    assert_eq!(db.soft_delete(&[a, b]).unwrap(), 2);
    assert_eq!(db.trash_count().unwrap(), 2);
    assert_eq!(db.asset_count().unwrap(), 1);

    // list_trash en son atilan ilk (deleted_at DESC, id DESC) → a+b var.
    let trash_ids: Vec<i64> = db.list_trash().unwrap().into_iter().map(|r| r.id).collect();
    assert_eq!(trash_ids.len(), 2);
    assert!(trash_ids.contains(&a) && trash_ids.contains(&b));

    // Karisik dilim: [a (cop'te), c (aktif)] restore → yalniz a geri (1 etkiler).
    assert_eq!(db.restore(&[a, c]).unwrap(), 1);
    assert_eq!(db.trash_count().unwrap(), 1, "yalniz a geri donmeli (b hala cop'te)");
    assert_eq!(db.asset_count().unwrap(), 2);

    // Bos dilim → no-op (0), hata yok.
    assert_eq!(db.soft_delete(&[]).unwrap(), 0);
    assert_eq!(db.restore(&[]).unwrap(), 0);
    assert_eq!(db.purge(&[]).unwrap(), 0);
}

/// `purge_all` ("Sifirla" ingest modu): TUM asset'leri (aktif + cop) kalici siler,
/// vektorler dahil; iliskili veri CASCADE temizlenir; yetim kalmaz. tags/collections
/// TANIM satirlari (sozluk) korunur (purge ile tutarli). Bos DB'de no-op (0).
#[test]
fn purge_all_wipes_active_and_trashed_with_vectors() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/x/a.txt", "a.txt", "txt"); // aktif kalacak
    let b = ingest_one(&mut db, "/x/b.txt", "b.txt", "txt"); // cop'e atilacak
    let c = ingest_one(&mut db, "/y/c.txt", "c.txt", "txt"); // baska klasor

    // Iliskili veri + vektor (purge_all hepsini temizlemeli).
    db.set_favorite(a, true).unwrap();
    db.add_user_tag(a, "villa").unwrap();
    let col = db.create_collection("Set", None).unwrap();
    db.add_to_collection(col, a).unwrap();
    add_vector(&db, a, 0);
    add_vector(&db, c, 1);

    // b cop'te (aktif + cop birlikte silinmeli).
    db.soft_delete(&[b]).unwrap();
    assert_eq!(db.trash_count().unwrap(), 1);

    // ── purge_all: 3 asset de (aktif a/c + cop b) silinir ──
    assert_eq!(db.purge_all().unwrap(), 3, "aktif + cop TUM asset'ler silinmeli");

    let conn = db.connection();
    let total = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(total("SELECT count(*) FROM assets"), 0, "hic asset kalmamali");
    assert_eq!(total("SELECT count(*) FROM asset_vectors"), 0, "vektorler temizlenmeli (vec0)");
    assert_eq!(total("SELECT count(*) FROM favorites"), 0, "favori CASCADE");
    assert_eq!(total("SELECT count(*) FROM asset_tags"), 0, "etiket-bagi CASCADE");
    assert_eq!(total("SELECT count(*) FROM collection_items"), 0, "koleksiyon-uyeligi CASCADE");
    assert_eq!(total("SELECT count(*) FROM asset_metadata"), 0, "metadata CASCADE");
    assert_eq!(total("SELECT count(*) FROM assets_fts"), 0, "FTS silme-trigger");

    // Sozluk satirlari KORUNUR (purge ile tutarli; etiket/koleksiyon adlari yasar).
    assert_eq!(total("SELECT count(*) FROM tags"), 1, "tag TANIMI korunmali");
    assert_eq!(total("SELECT count(*) FROM collections"), 1, "collection TANIMI korunmali");

    // Butunluk + sayaclar.
    assert_eq!(db.orphan_count().unwrap(), 0, "purge_all sonrasi yetim olmamali");
    assert!(db.integrity_ok().unwrap(), "butunluk korunmali");
    assert_eq!(db.asset_count().unwrap(), 0);
    assert_eq!(db.trash_count().unwrap(), 0);

    // Bos DB'de tekrar → no-op (0).
    assert_eq!(db.purge_all().unwrap(), 0, "bos DB purge_all no-op");
}
