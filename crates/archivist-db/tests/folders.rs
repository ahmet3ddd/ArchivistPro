//! Faz 7.2 "Klasorler" gorunumu veri katmani testleri: `folder_summary` (asset'leri
//! ust-dizine gore grupla + say) ve `ListOpts.path_prefix` (bir klasore filtre).
//! `scanned_roots` tablosu yok → klasorler `assets.path`'ten turetilir.

use archivist_db::{AssetInput, Db, IngestData, ListOpts};

/// Verilen tam yolda minimal bir asset ingest et, id dondur.
fn ingest_at(db: &mut Db, path: &str, name: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some("txt"),
            size_bytes: 1,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: 1,
            modified_at: 1,
        },
        &IngestData {
            fts_body: None,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

/// `path_prefix` filtreli ListOpts.
fn opts_prefix(prefix: &str) -> ListOpts {
    ListOpts { page_size: 50, path_prefix: Some(prefix.to_string()), ..Default::default() }
}

/// Bir asset'in `indexed_at`'ini deterministik degere zorla (ingest hepsine `now` yazar →
/// klasor-basi max'i test etmek icin farkli degerler gerek). `None` → NULL (indekslenmemis).
fn set_indexed_at(db: &Db, id: i64, val: Option<i64>) {
    let conn = db.connection();
    // Homojen dizi param (rusqlite test crate'inde import edilmez); NULL ayri SQL ile.
    match val {
        Some(v) => conn.execute("UPDATE assets SET indexed_at = ?1 WHERE id = ?2", [v, id]),
        None => conn.execute("UPDATE assets SET indexed_at = NULL WHERE id = ?1", [id]),
    }
    .expect("update indexed_at");
}

/// folder_summary: asset'leri ust-dizine gore gruplar, dogru dizin + sayilari doner,
/// file_count DESC sirali; hem POSIX hem Windows ayraci ele alinir; ayracsiz yol atlanir.
#[test]
fn folder_summary_groups_by_parent_dir() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // /proj/villa altinda 3, /proj/ofis altinda 1, C:\cad altinda 2 (Windows ayraci).
    ingest_at(&mut db, "/proj/villa/1.txt", "1.txt");
    ingest_at(&mut db, "/proj/villa/2.txt", "2.txt");
    ingest_at(&mut db, "/proj/villa/3.txt", "3.txt");
    ingest_at(&mut db, "/proj/ofis/4.txt", "4.txt");
    ingest_at(&mut db, r"C:\cad\5.txt", "5.txt");
    ingest_at(&mut db, r"C:\cad\6.txt", "6.txt");
    // Ayracsiz ciplak ad → ust-dizini yok → ozette gorunmemeli.
    ingest_at(&mut db, " rootless.txt", "rootless.txt");

    let folders = db.folder_summary().unwrap();
    // Uc farkli dizin (ayracsiz olan atlanir).
    assert_eq!(folders.len(), 3, "uc dizin (ayracsiz atlandi)");
    // file_count DESC: villa(3) ilk; sonra cad(2); en az ofis(1).
    assert_eq!(folders[0].path, "/proj/villa");
    assert_eq!(folders[0].file_count, 3);
    assert_eq!(folders[1].path, r"C:\cad");
    assert_eq!(folders[1].file_count, 2);
    assert_eq!(folders[2].path, "/proj/ofis");
    assert_eq!(folders[2].file_count, 1);

    // Bos DB → bos liste (panik yok).
    let empty = Db::open_in_memory_migrated().unwrap();
    assert!(empty.folder_summary().unwrap().is_empty());
}

/// folder_summary kok-ayrac (or. "/a.txt") icin koku ("/") dizin sayar.
#[test]
fn folder_summary_root_separator() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    ingest_at(&mut db, "/a.txt", "a.txt");
    ingest_at(&mut db, "/b.txt", "b.txt");
    let folders = db.folder_summary().unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].path, "/");
    assert_eq!(folders[0].file_count, 2);
}

/// folder_summary `last_indexed`: klasor-basi EN YENI (max) `indexed_at` doner; NULL
/// indexed_at'ler yok sayilir. Iki klasor, her birinde farkli indexed_at degerleri.
#[test]
fn folder_summary_reports_last_indexed_per_folder() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_at(&mut db, "/proj/villa/1.txt", "1.txt");
    let b = ingest_at(&mut db, "/proj/villa/2.txt", "2.txt");
    let c = ingest_at(&mut db, "/proj/ofis/3.txt", "3.txt");
    // villa: {1000, 3000} → max 3000; ofis: {2000} → 2000.
    set_indexed_at(&db, a, Some(1000));
    set_indexed_at(&db, b, Some(3000));
    set_indexed_at(&db, c, Some(2000));

    let folders = db.folder_summary().unwrap();
    let villa = folders.iter().find(|f| f.path == "/proj/villa").expect("villa");
    assert_eq!(villa.file_count, 2);
    assert_eq!(villa.last_indexed, Some(3000), "villa klasorunun EN YENI indexed_at'i");
    let ofis = folders.iter().find(|f| f.path == "/proj/ofis").expect("ofis");
    assert_eq!(ofis.file_count, 1);
    assert_eq!(ofis.last_indexed, Some(2000));
}

/// folder_summary `last_indexed` NULL ele alma: bir klasorde bazi asset'ler NULL indexed_at
/// → NULL'lar yok sayilir (max non-null doner); TUM asset'ler NULL ise `None`.
#[test]
fn folder_summary_last_indexed_ignores_nulls() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // /n: bir NULL + bir 500 → non-null max 500. /m: hepsi NULL → None.
    let a = ingest_at(&mut db, "/n/1.txt", "1.txt");
    let b = ingest_at(&mut db, "/n/2.txt", "2.txt");
    let c = ingest_at(&mut db, "/m/3.txt", "3.txt");
    set_indexed_at(&db, a, None);
    set_indexed_at(&db, b, Some(500));
    set_indexed_at(&db, c, None);

    let folders = db.folder_summary().unwrap();
    let n = folders.iter().find(|f| f.path == "/n").expect("/n");
    assert_eq!(n.file_count, 2);
    assert_eq!(n.last_indexed, Some(500), "NULL yok sayilir → tek non-null 500");
    let m = folders.iter().find(|f| f.path == "/m").expect("/m");
    assert_eq!(m.last_indexed, None, "hepsi NULL → None");
}

/// list_assets + path_prefix: yalniz on-ekle baslayan asset'ler doner; alt-dizinler de
/// dahil (on-ek eslesmesi); diger klasorler haric.
#[test]
fn list_assets_filters_by_path_prefix() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let v1 = ingest_at(&mut db, "/proj/villa/1.txt", "1.txt");
    let v2 = ingest_at(&mut db, "/proj/villa/2.txt", "2.txt");
    let vsub = ingest_at(&mut db, "/proj/villa/sub/3.txt", "3.txt"); // alt-dizin
    ingest_at(&mut db, "/proj/ofis/4.txt", "4.txt"); // baska klasor

    // "/proj/villa" on-eki → 3 asset (alt-dizin dahil), ofis haric.
    let page = db.list_assets(&opts_prefix("/proj/villa")).unwrap();
    assert_eq!(page.total, 3, "villa + alt-dizin");
    let ids: Vec<i64> = page.items.iter().map(|a| a.id).collect();
    assert!(ids.contains(&v1) && ids.contains(&v2) && ids.contains(&vsub));
    assert!(page.items.iter().all(|a| a.path.starts_with("/proj/villa")));

    // Baska klasor on-eki → yalniz o.
    assert_eq!(db.list_assets(&opts_prefix("/proj/ofis")).unwrap().total, 1);
    // Eslesmeyen on-ek → bos.
    assert_eq!(db.list_assets(&opts_prefix("/yok")).unwrap().total, 0);
    // None (varsayilan) → filtre yok → 4 asset.
    assert_eq!(db.list_assets(&ListOpts { page_size: 50, ..Default::default() }).unwrap().total, 4);
}

/// path_prefix + diger filtreler AND: prefix + tag birlikte daraltir.
#[test]
fn path_prefix_composes_with_other_filters() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_at(&mut db, "/proj/villa/1.txt", "1.txt");
    ingest_at(&mut db, "/proj/villa/2.txt", "2.txt");
    let ofis = ingest_at(&mut db, "/proj/ofis/3.txt", "3.txt");
    // a (villa) ve ofis/3 ikisi de "onemli" etiketli; prefix sonra ofis'i eler.
    db.add_user_tag(a, "onemli").unwrap();
    db.add_user_tag(ofis, "onemli").unwrap();

    // prefix=villa + tag=onemli → yalniz a (ofis/3 tag'li ama prefix disinda).
    let opts = ListOpts {
        page_size: 50,
        path_prefix: Some("/proj/villa".to_string()),
        tag: vec!["onemli".to_string()],
        ..Default::default()
    };
    let page = db.list_assets(&opts).unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].id, a);
}

/// GUVENLIK: LIKE joker karakterleri (`%` `_`) on-ekte LITERAL eslesir, joker DEGIL.
/// Boylece "/a_" gibi bir on-ek "/aXb"yi (joker `_` herhangi tek karakter) getirmez.
#[test]
fn path_prefix_escapes_like_wildcards() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let lit = ingest_at(&mut db, "/a_b/1.txt", "1.txt"); // literal alt-cizgi iceren dizin
    ingest_at(&mut db, "/aXb/2.txt", "2.txt"); // joker eslesirse YANLISLIKLA gelir

    // "/a_b" → escape sayesinde yalniz literal "/a_b/..." eslesir, "/aXb/..." HARIC.
    let page = db.list_assets(&opts_prefix("/a_b")).unwrap();
    assert_eq!(page.total, 1, "alt-cizgi literal (joker degil)");
    assert_eq!(page.items[0].id, lit);

    // Yuzde de literal: "/100%" iceren bir yol kurup test et.
    let mut db2 = Db::open_in_memory_migrated().unwrap();
    let p = ingest_at(&mut db2, "/100%/x.txt", "x.txt");
    ingest_at(&mut db2, "/100ABC/y.txt", "y.txt");
    let page2 = db2.list_assets(&opts_prefix("/100%")).unwrap();
    assert_eq!(page2.total, 1, "yuzde literal (joker degil)");
    assert_eq!(page2.items[0].id, p);
}

/// `active_paths_under` ("Degistir"/replace ingest modu): bir kok on-eki altindaki AKTIF
/// asset'lerin (id,path) listesi — cop'tekiler HARIC, baska klasorler HARIC, kardes-on-ek
/// (or. "/proj/villa" → "/proj/villa2") karismaz.
#[test]
fn active_paths_under_lists_active_under_prefix_only() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_at(&mut db, "/proj/villa/1.txt", "1.txt");
    let b = ingest_at(&mut db, "/proj/villa/sub/2.txt", "2.txt"); // alt-dizin de dahil
    let trashed = ingest_at(&mut db, "/proj/villa/3.txt", "3.txt");
    ingest_at(&mut db, "/proj/villa2/x.txt", "x.txt"); // KARDES on-ek → karismamali
    ingest_at(&mut db, "/proj/ofis/y.txt", "y.txt"); // baska klasor → haric

    db.soft_delete(&[trashed]).unwrap(); // cop'teki → listede gorunmemeli

    // Kok = "/proj/villa/" (kok + ayrac → kardes-on-ek karismaz).
    let mut ids: Vec<i64> =
        db.active_paths_under("/proj/villa/").unwrap().into_iter().map(|(id, _)| id).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec![a, b], "yalniz villa altindaki AKTIF asset'ler (cop + kardes + diger haric)");

    // Donen path'ler tam DB degeri (cagiran keep-set ile karsilastirir).
    let paths: Vec<String> =
        db.active_paths_under("/proj/villa/").unwrap().into_iter().map(|(_, p)| p).collect();
    assert!(paths.contains(&"/proj/villa/1.txt".to_string()));
    assert!(paths.contains(&"/proj/villa/sub/2.txt".to_string()));
}
