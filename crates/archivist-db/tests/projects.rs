//! `projects` entity — migration 0019 + CRUD + facet + ListOpts.project filtresi.
//!
//! EN riskli katman → **test-first** (data-migration kurali): bu testler koddan ONCE
//! yazildi ve sema/CRUD sozlesmesini kelepceler.
//!
//! H2 DERSI: H2'de `projects` tablosu OLUYDU; "proje" aslinda `assets.project_name`
//! denormalize string'iydi (isim=kimlik → iki farkli klasor ayni ustad ise istemeden
//! birlesirdi). H3 GERCEK entity + FK yapar; bu testler o sozlesmeyi dogrular:
//! - ayni ADA sahip iki proje AYRI kimliktir (birlesmez),
//! - asset'ler `project_id` (FK) ile baglanir; proje silinince FK SET NULL (asset KALIR),
//! - okuma+yazma AYNI anda sema-aware (list/facet/filter cop'e ve NULL'a tutarli davranir).

use archivist_db::{Db, ListOpts, ProjectInput};
use rusqlite::params;

/// Bir asset ekle (verilen `path`, `project_id` NULL, aktif) → yeni id. Oto-atama testleri
/// icin `path` gercek klasor yapisini yansitir (kok-alti klasor segmenti).
fn seed_path(db: &Db, path: &str) -> i64 {
    db.connection()
        .execute(
            "INSERT INTO assets(path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (?1, ?1, 'dwg', 100, 1, 1)",
            params![path],
        )
        .unwrap();
    db.connection().last_insert_rowid()
}

/// Yalniz `name` dolu bir girdi (digerleri None) — CRUD testlerinin cogu icin yeter.
fn proj(name: &str) -> ProjectInput {
    ProjectInput { name: name.to_string(), ..Default::default() }
}

/// Bir aktif asset ekle (verilen `ext`) → yeni id. `path`=`file_name` (basit).
fn seed(db: &Db, path: &str, ext: &str) -> i64 {
    db.connection()
        .execute(
            "INSERT INTO assets(path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (?1, ?1, ?2, 100, 1, 1)",
            params![path, ext],
        )
        .unwrap();
    db.connection().last_insert_rowid()
}

/// Asset'i cop'e at (soft-delete) — aktif sayim/filtre disi kalmali.
fn soft_delete(db: &Db, id: i64) {
    db.connection()
        .execute("UPDATE assets SET deleted_at = 999 WHERE id = ?1", params![id])
        .unwrap();
}

/// Bir asset'in su anki `project_id`'si (FK SET NULL dogrulamasi icin).
fn project_id_of(db: &Db, id: i64) -> Option<i64> {
    db.connection()
        .query_row("SELECT project_id FROM assets WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

/// Toplam asset SATIR sayisi (cop dahil) — "silinmedi, sadece NULL'landi" ispati.
fn asset_rows(db: &Db) -> i64 {
    db.connection().query_row("SELECT count(*) FROM assets", [], |r| r.get(0)).unwrap()
}

fn project_names(db: &Db) -> Vec<String> {
    db.list_projects().unwrap().into_iter().map(|p| p.name).collect()
}

/// v19 (projects): projects tablosu + assets.project_id kolonu + indeksler var; sema >= 19.
#[test]
fn migration_0019_projects_schema() {
    let db = Db::open_in_memory_migrated().unwrap();
    assert!(db.schema_version().unwrap() >= 19, "0019 uygulanmadi");
    let conn = db.connection();

    // projects tablosu mevcut.
    let t: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='projects'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(t, 1, "projects tablosu yok");

    // assets.project_id kolonu mevcut.
    let has_col = {
        let mut stmt = conn.prepare("PRAGMA table_info(assets)").unwrap();
        let cols = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        cols.iter().any(|c| c == "project_id")
    };
    assert!(has_col, "assets.project_id kolonu yok");

    // Indeksler olusmus.
    for idx in ["idx_projects_name", "idx_assets_project"] {
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?1",
                params![idx],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "indeks yok: {idx}");
    }

    // Bos DB: hic proje yok, hic facet yok.
    assert!(db.list_projects().unwrap().is_empty());
    assert!(db.project_facets().unwrap().is_empty());
}

/// create → list: yeni proje 0 asset_count ile listelenir; alanlar korunur; created_at kaynaktan.
#[test]
fn create_then_list() {
    let db = Db::open_in_memory_migrated().unwrap();
    let input = ProjectInput {
        name: "Villa Ada".into(),
        client_name: Some("Musteri A".into()),
        phase: Some("Avan".into()),
        status: Some("aktif".into()),
        description: Some("deniz kenari".into()),
        deadline: Some("2026-09-01".into()),
    };
    let id = db.create_project(&input, 1_700_000_000).unwrap();
    assert!(id > 0);

    let rows = db.list_projects().unwrap();
    assert_eq!(rows.len(), 1);
    let p = &rows[0];
    assert_eq!(p.id, id);
    assert_eq!(p.name, "Villa Ada");
    assert_eq!(p.client_name.as_deref(), Some("Musteri A"));
    assert_eq!(p.phase.as_deref(), Some("Avan"));
    assert_eq!(p.status.as_deref(), Some("aktif"));
    assert_eq!(p.description.as_deref(), Some("deniz kenari"));
    assert_eq!(p.deadline.as_deref(), Some("2026-09-01"));
    assert_eq!(p.created_at, 1_700_000_000, "created_at cagirandan gelmeli");
    assert_eq!(p.asset_count, 0, "yeni proje bos");
}

/// Bos/yalniz-bosluk ad reddedilir (isim=kimlik disiplini; sessiz bos proje olusmaz).
#[test]
fn create_rejects_blank_name() {
    let db = Db::open_in_memory_migrated().unwrap();
    assert!(db.create_project(&proj("   "), 1).is_err());
    assert!(db.create_project(&proj(""), 1).is_err());
    assert!(db.list_projects().unwrap().is_empty(), "reddedilen ad satir yaratmamali");
}

/// H2 TUZAGI: ayni ADA sahip iki proje AYRI kimliktir (UNIQUE yok → birlesmez).
#[test]
fn same_name_two_distinct_identities() {
    let db = Db::open_in_memory_migrated().unwrap();
    let a = db.create_project(&proj("Ozturk Evi"), 1).unwrap();
    let b = db.create_project(&proj("Ozturk Evi"), 2).unwrap();
    assert_ne!(a, b, "ayni ad → ayri id (istemeden birlesme YOK)");
    assert_eq!(db.list_projects().unwrap().len(), 2);
}

/// assign → aktif asset_count artar; projesiz asset satir uretmez; cop haric sayilir.
#[test]
fn assign_counts_active_only_and_separates_unassigned() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let pid = db.create_project(&proj("P"), 1).unwrap();
    let a = seed(&db, "/a.dwg", "dwg");
    let b = seed(&db, "/b.dwg", "dwg");
    let c = seed(&db, "/c.dwg", "dwg"); // projesiz kalacak

    // a,b projeye; c projesiz.
    assert_eq!(db.assign_assets_to_project(&[a, b], Some(pid)).unwrap(), 2);
    let rows = db.list_projects().unwrap();
    assert_eq!(rows.len(), 1, "projesiz asset (c) fantom proje satiri URETMEZ");
    assert_eq!(rows[0].asset_count, 2);

    // b'yi cop'e at → aktif sayim 1'e duser (cop haric).
    soft_delete(&db, b);
    assert_eq!(db.list_projects().unwrap()[0].asset_count, 1, "cop'teki asset sayilmaz");
    assert_eq!(project_id_of(&db, c), None, "projesiz asset NULL kalir");
}

/// Toplu assign + unassign (None → project_id NULL); etkilenen sayi dogru.
#[test]
fn bulk_assign_and_unassign() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let pid = db.create_project(&proj("P"), 1).unwrap();
    let ids = [seed(&db, "/1", "dwg"), seed(&db, "/2", "dwg"), seed(&db, "/3", "dwg")];

    assert_eq!(db.assign_assets_to_project(&ids, Some(pid)).unwrap(), 3);
    assert_eq!(db.list_projects().unwrap()[0].asset_count, 3);

    // Ikisini geri al (None).
    assert_eq!(db.assign_assets_to_project(&ids[..2], None).unwrap(), 2);
    assert_eq!(db.list_projects().unwrap()[0].asset_count, 1);
    assert_eq!(project_id_of(&db, ids[0]), None);
    assert_eq!(project_id_of(&db, ids[1]), None);
    assert_eq!(project_id_of(&db, ids[2]), Some(pid));

    // Bos dilim → 0, no-op.
    assert_eq!(db.assign_assets_to_project(&[], Some(pid)).unwrap(), 0);
}

/// delete_project → FK SET NULL: atanmis asset'ler KALIR (project_id NULL), SILINMEZ;
/// baska projenin sayimi etkilenmez; proje listeden cikar.
#[test]
fn delete_project_sets_null_keeps_assets() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let p1 = db.create_project(&proj("P1"), 1).unwrap();
    let p2 = db.create_project(&proj("P2"), 2).unwrap();
    let a = seed(&db, "/a", "dwg");
    let b = seed(&db, "/b", "dwg");
    let c = seed(&db, "/c", "dwg");
    db.assign_assets_to_project(&[a, b], Some(p1)).unwrap();
    db.assign_assets_to_project(&[c], Some(p2)).unwrap();

    let before = asset_rows(&db);
    db.delete_project(p1).unwrap();

    // Asset'ler DURUR (silinmedi) — FK SET NULL, CASCADE DEGIL.
    assert_eq!(asset_rows(&db), before, "asset satirlari silinmemeli");
    assert_eq!(project_id_of(&db, a), None, "p1 asset'i NULL'lanmali");
    assert_eq!(project_id_of(&db, b), None);
    assert_eq!(project_id_of(&db, c), Some(p2), "p2 asset'i etkilenmez");

    // Proje listeden cikar; p2 sayimi bozulmaz.
    assert_eq!(project_names(&db), vec!["P2".to_string()]);
    assert_eq!(db.list_projects().unwrap()[0].asset_count, 1);

    // Idempotent: olmayan/tekrar sil → hata yok.
    db.delete_project(p1).unwrap();
}

/// project_facets: aktif asset sayimi (cop haric); value = proje ID (ListOpts.project ile
/// tutarli — filtre id'ye baglanir). 0-asset proje de LEFT JOIN ile listelenir (count=0).
#[test]
fn project_facets_counts_active_and_value_is_id() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let p1 = db.create_project(&proj("P1"), 1).unwrap();
    let p2 = db.create_project(&proj("P2"), 2).unwrap();
    let a = seed(&db, "/a", "dwg");
    let b = seed(&db, "/b", "dwg");
    let d = seed(&db, "/d", "dwg");
    db.assign_assets_to_project(&[a, b, d], Some(p1)).unwrap();
    soft_delete(&db, d); // p1'de cop → sayima girmez

    let facets = db.project_facets().unwrap();
    // Her iki proje de gorunur (p2 count=0).
    let get = |pid: i64| {
        facets
            .iter()
            .find(|f| f.value.as_deref() == Some(pid.to_string().as_str()))
            .unwrap_or_else(|| panic!("facet yok: {pid}"))
            .count
    };
    assert_eq!(get(p1), 2, "aktif 2 (cop'teki d haric)");
    assert_eq!(get(p2), 0, "0-asset proje de listelenir");
    // value ID string olmali (name DEGIL) → filtreyle birebir.
    assert!(facets.iter().all(|f| f.value.as_deref().unwrap().parse::<i64>().is_ok()));
}

/// ListOpts.project filtresi: yalniz o projenin AKTIF asset'leri; cop haric; diger
/// facet'lerle AND (collection deseni birebir — json_each IN, facet-arasi AND).
#[test]
fn list_opts_project_filter() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let p1 = db.create_project(&proj("P1"), 1).unwrap();
    let p2 = db.create_project(&proj("P2"), 2).unwrap();
    let a = seed(&db, "/a.dwg", "dwg");
    let b = seed(&db, "/b.pdf", "pdf");
    let c = seed(&db, "/c.dwg", "dwg"); // cop olacak
    let e = seed(&db, "/e.dwg", "dwg"); // p2
    db.assign_assets_to_project(&[a, b, c], Some(p1)).unwrap();
    db.assign_assets_to_project(&[e], Some(p2)).unwrap();
    soft_delete(&db, c);

    // p1 filtresi → a,b (c cop haric, e baska proje).
    let page = db.list_assets(&ListOpts { project: vec![p1], ..Default::default() }).unwrap();
    let mut got: Vec<i64> = page.items.iter().map(|r| r.id).collect();
    got.sort();
    assert_eq!(got, vec![a, b]);
    assert_eq!(page.total, 2);

    // p1 AND ext=dwg → yalniz a (facet-arasi AND).
    let page2 = db
        .list_assets(&ListOpts { project: vec![p1], ext: vec!["dwg".into()], ..Default::default() })
        .unwrap();
    let ids: Vec<i64> = page2.items.iter().map(|r| r.id).collect();
    assert_eq!(ids, vec![a]);

    // Cok-degerli [p1,p2] → facet-ici OR (a,b,e).
    let page3 =
        db.list_assets(&ListOpts { project: vec![p1, p2], ..Default::default() }).unwrap();
    assert_eq!(page3.total, 3);

    // Bos project → filtre yok (tum aktif: a,b,e = 3; c cop).
    let page4 = db.list_assets(&ListOpts::default()).unwrap();
    assert_eq!(page4.total, 3);
}

/// update/rename: name + tum meta full-replace; list yeni degerleri yansitir; updated_at set.
#[test]
fn update_rename_and_meta() {
    let db = Db::open_in_memory_migrated().unwrap();
    let id = db
        .create_project(
            &ProjectInput { name: "Eski".into(), phase: Some("Konsept".into()), ..Default::default() },
            1,
        )
        .unwrap();

    db.update_project(
        id,
        &ProjectInput {
            name: "Yeni".into(),
            client_name: Some("M".into()),
            phase: None, // full-replace → temizlenir
            status: Some("arsiv".into()),
            description: None,
            deadline: Some("2027-01-01".into()),
        },
    )
    .unwrap();

    let p = db.list_projects().unwrap().into_iter().find(|p| p.id == id).unwrap();
    assert_eq!(p.name, "Yeni");
    assert_eq!(p.client_name.as_deref(), Some("M"));
    assert_eq!(p.phase, None, "full-replace: isaretlenmeyen alan temizlenir");
    assert_eq!(p.status.as_deref(), Some("arsiv"));
    assert_eq!(p.deadline.as_deref(), Some("2027-01-01"));

    // updated_at yazildi.
    let updated: Option<i64> = db
        .connection()
        .query_row("SELECT updated_at FROM projects WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert!(updated.is_some(), "updated_at set edilmeli");

    // Bos ad ile update reddedilir; olmayan id reddedilir.
    assert!(db.update_project(id, &proj("  ")).is_err());
    assert!(db.update_project(9999, &proj("X")).is_err());
}

/// FK ENFORCEMENT (yapisal): foreign_keys ON → olmayan projeye assign HATA verir;
/// SET NULL calisir (delete testinde). H2'nin "isim=kimlik → hayalet baglanti" sinifini
/// yapisal olarak imkansiz kilar (gecersiz FK reddedilir).
#[test]
fn foreign_keys_enforced() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // PRAGMA foreign_keys gercekten ON.
    let fk: i64 = db.connection().query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(fk, 1, "foreign_keys ON olmali (SET NULL/ref butunlugu icin)");

    let a = seed(&db, "/a", "dwg");
    // Olmayan proje id'sine assign → FK ihlali → hata (asset project_id degismez).
    assert!(
        db.assign_assets_to_project(&[a], Some(9999)).is_err(),
        "olmayan projeye atama FK ile reddedilmeli"
    );
    assert_eq!(project_id_of(&db, a), None, "basarisiz atama project_id'yi bozmamali");
}

/// get_asset ATANMIS projeyi (entity) verir → frontend `client_name` inheritance (proje→asset)
/// kurabilir: asset'in KENDI client'i NULL + proje-duzeyi client VAR → gorunumde devralinir.
/// Projesiz asset → `assigned_project` None.
#[test]
fn get_asset_exposes_assigned_project_for_client_inheritance() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let pid = db
        .create_project(
            &ProjectInput {
                name: "Villa-A".into(),
                client_name: Some("Acme".into()),
                ..Default::default()
            },
            1,
        )
        .unwrap();
    let a = seed(&db, r"C:\p\plan.dwg", "dwg"); // asset'in KENDI client'i yok
    db.assign_assets_to_project(&[a], Some(pid)).unwrap();

    let detail = db.get_asset(a).unwrap().unwrap();
    let ap = detail.assigned_project.expect("atanmis proje gelmeli");
    assert_eq!(ap.name, "Villa-A");
    assert_eq!(ap.client_name.as_deref(), Some("Acme"), "proje-duzeyi client (inheritance kaynagi)");
    assert_eq!(detail.project.client_name, None, "asset'in KENDI client'i yok → projeninki devralinir");

    // Projesiz asset → assigned_project None (inheritance yok).
    let b = seed(&db, r"C:\p\yalniz.dwg", "dwg");
    assert!(db.get_asset(b).unwrap().unwrap().assigned_project.is_none(), "projesiz → None");
}

/// upsert_project_by_name: ilk cagri OLUSTURUR, ikinci cagri AYNI id'yi dondurur (kopya YOK);
/// var olan ada denk gelirse ILK (id ASC) projeyi kullanir; bos ad reddedilir.
#[test]
fn upsert_project_by_name_idempotent_and_creates() {
    let db = Db::open_in_memory_migrated().unwrap();

    let id1 = db.upsert_project_by_name("Villa-A", 100).unwrap();
    assert!(id1 > 0);
    // Ikinci cagri → ayni id, yeni satir YOK.
    let id2 = db.upsert_project_by_name("Villa-A", 200).unwrap();
    assert_eq!(id1, id2, "ayni ad → ayni id (idempotent)");
    assert_eq!(db.list_projects().unwrap().len(), 1, "kopya proje olusmamali");

    // Farkli ad → farkli proje.
    let id3 = db.upsert_project_by_name("Ofis-B", 300).unwrap();
    assert_ne!(id1, id3);
    assert_eq!(db.list_projects().unwrap().len(), 2);

    // Var olan ELLE (create_project ile) olusturulmus AYNI adli projeye upsert → onu bulur
    // (yeni olusturmaz); id ASC → ilk olan.
    let manual = db.create_project(&proj("Kule-C"), 1).unwrap();
    let up = db.upsert_project_by_name("  Kule-C  ", 2).unwrap(); // trim
    assert_eq!(up, manual, "trim sonrasi var olan projeyi bulmali");
    assert_eq!(db.list_projects().unwrap().len(), 3);

    // Bos ad → hata; satir yaratmaz.
    assert!(db.upsert_project_by_name("   ", 1).is_err());
    assert_eq!(db.list_projects().unwrap().len(), 3);
}

/// auto_assign_projects_under: farkli klasorlerdeki asset'ler dogru projelere gruplanir;
/// dogrudan kok-alti dosya PROJESIZ kalir; kok-disi dosya dokunulmaz; rapor sayilari dogru.
#[test]
fn auto_assign_groups_by_folder_and_skips_root_files() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let root = r"C:\Projeler";

    // Villa-A: 2 dosya (alt-klasor dahil); Ofis-B: 1 dosya; kok-alti: 1 dosya (projesiz);
    // kok-DISI: 1 dosya (baska surucu — dokunulmaz).
    let va1 = seed_path(&db, r"C:\Projeler\Villa-A\plan.dwg");
    let va2 = seed_path(&db, r"C:\Projeler\Villa-A\detay\kesit.dwg");
    let ob1 = seed_path(&db, r"C:\Projeler\Ofis-B\vaziyet.dwg");
    let root_file = seed_path(&db, r"C:\Projeler\okubeni.txt");
    let outside = seed_path(&db, r"D:\Baska\X\y.dwg");

    let rep = db.auto_assign_projects_under(root, 1_700_000_000, Some("Aktif")).unwrap();
    assert_eq!(rep.assets_assigned, 3, "Villa-A(2)+Ofis-B(1)=3 asset atanmali");
    assert_eq!(rep.projects_touched, 2, "2 farkli proje (Villa-A, Ofis-B)");

    // Iki proje olustu; adlari dogru.
    assert_eq!(project_names(&db), vec!["Ofis-B".to_string(), "Villa-A".to_string()]);

    // YENI olusan projeler oto-meta tasir: status = verilen "aktif", description = klasor yolu
    // (provenance). client_name/phase/deadline NULL kalir (sade-ad klasorden turetilemez).
    let va = db.list_projects().unwrap().into_iter().find(|p| p.name == "Villa-A").unwrap();
    assert_eq!(va.status.as_deref(), Some("Aktif"), "oto-proje durumu 'aktif' olmali");
    assert_eq!(
        va.description.as_deref(),
        Some(r"C:\Projeler\Villa-A"),
        "aciklama kaynak klasor yolu olmali"
    );
    assert_eq!(va.client_name, None, "sade-ad → musteri bos");
    assert_eq!(va.phase, None, "sade-ad → faz bos");
    assert_eq!(va.deadline, None, "sade-ad → termin bos");
    let ob = db.list_projects().unwrap().into_iter().find(|p| p.name == "Ofis-B").unwrap();
    assert_eq!(ob.description.as_deref(), Some(r"C:\Projeler\Ofis-B"));

    // Villa-A'nin iki asset'i AYNI projeye baglandi.
    let va_pid = project_id_of(&db, va1);
    assert!(va_pid.is_some());
    assert_eq!(project_id_of(&db, va2), va_pid, "ayni klasor → ayni proje");
    // Ofis-B ayri proje.
    assert!(project_id_of(&db, ob1).is_some());
    assert_ne!(project_id_of(&db, ob1), va_pid);

    // Kok-alti dogrudan dosya + kok-disi dosya PROJESIZ kalir.
    assert_eq!(project_id_of(&db, root_file), None, "dogrudan kok-alti dosya projesiz");
    assert_eq!(project_id_of(&db, outside), None, "kok-disi dosya dokunulmaz");

    // Villa-A projesinin aktif asset_count = 2.
    let va = db.list_projects().unwrap().into_iter().find(|p| p.name == "Villa-A").unwrap();
    assert_eq!(va.asset_count, 2);
}

/// auto_assign: NULL-ONLY (elle atanmis asset EZILMEZ), idempotent (2. cagri kopya proje +
/// yeni atama URETMEZ), cop asset atlanir.
#[test]
fn auto_assign_null_only_idempotent_and_skips_trash() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let root = r"C:\Projeler";

    // Villa-A klasorunde 3 asset; birini ELLE baska projeye ata (korunmali).
    let a1 = seed_path(&db, r"C:\Projeler\Villa-A\a.dwg");
    let a2 = seed_path(&db, r"C:\Projeler\Villa-A\b.dwg");
    let a3 = seed_path(&db, r"C:\Projeler\Villa-A\c.dwg");
    // Cop asset (soft-delete) — atanmamali.
    let trashed = seed_path(&db, r"C:\Projeler\Villa-A\silinen.dwg");
    db.connection()
        .execute("UPDATE assets SET deleted_at = 999 WHERE id = ?1", params![trashed])
        .unwrap();

    // a3'u ELLE ayri bir projeye ata (manuel atama).
    let manual_pid = db.create_project(&proj("Manuel"), 1).unwrap();
    db.assign_assets_to_project(&[a3], Some(manual_pid)).unwrap();

    // 1. oto-atama kosusu.
    let rep = db.auto_assign_projects_under(root, 1, Some("Aktif")).unwrap();
    assert_eq!(rep.assets_assigned, 2, "yalniz projesiz a1,a2 atanmali (a3 elle, trashed cop)");
    assert_eq!(rep.projects_touched, 1, "yalniz Villa-A");

    // a3'un manuel atamasi KORUNDU (ezilmedi).
    assert_eq!(project_id_of(&db, a3), Some(manual_pid), "elle atama EZILMEMELI");
    // Cop asset projesiz kaldi.
    assert_eq!(project_id_of(&db, trashed), None, "cop asset atanmamali");
    // a1,a2 Villa-A'ya baglandi (Manuel DEGIL).
    let va_pid = project_id_of(&db, a1);
    assert!(va_pid.is_some());
    assert_ne!(va_pid, Some(manual_pid));
    assert_eq!(project_id_of(&db, a2), va_pid);

    let projects_before = db.list_projects().unwrap().len();

    // Kullanici Villa-A durumunu ELLE degistirir → re-scan bunu EZMEMELI (meta yalniz
    // olusturmada yazilir; var olan proje idempotent korunur).
    let va_id = project_id_of(&db, a1).unwrap();
    db.connection()
        .execute("UPDATE projects SET status = 'Arsiv' WHERE id = ?1", params![va_id])
        .unwrap();

    // 2. kosu → IDEMPOTENT: kopya proje YOK, yeni atama YOK, elle-duzenlenen meta KORUNUR.
    let rep2 = db.auto_assign_projects_under(root, 2, Some("Aktif")).unwrap();
    assert_eq!(rep2.assets_assigned, 0, "hepsi zaten atanmis → yeni atama yok");
    assert_eq!(rep2.projects_touched, 0, "dokunulan proje yok");
    assert_eq!(db.list_projects().unwrap().len(), projects_before, "kopya proje olusmamali");
    let va = db.list_projects().unwrap().into_iter().find(|p| p.id == va_id).unwrap();
    assert_eq!(va.status.as_deref(), Some("Arsiv"), "elle-duzenlenen durum re-scan'de EZILMEMELI");
}

/// **REGRESYON KILIDI (gercek vaka, 2026-08-12).** Bir klasordeki asset sayisi SQLite'in
/// degisken ust sinirini asarsa oto-atama COKMEMELI.
///
/// Uretimde olculdu: `H:\PRJ` taramasinin tek uyarisi *"oto proje atamasi uyarisi: sqlite:
/// too many SQL variables in UPDATE assets SET project_id = ? WHERE project_id IS NULL AND
/// id IN (?,?,…)"* idi. Sebep: UPDATE **asset basina bir yer tutucu** uretiyordu ve
/// `PRJ-Python` klasorunde 60.377 varlik vardi.
///
/// ⚠️ Zarar tek klasorle SINIRLI DEGILDI: hata `?` ile firlayip `tx.commit()` oncesi TUM
/// islemi geri aliyordu → sinirin ALTINDAki klasorler de atanmamis kaliyordu. Uretim sonucu:
/// `projects` 0 satir, atanmis asset 0, ustelik ~23 dakika bosa is.
///
/// **Yontem:** 33 bin satir uretmek yerine baglantinin `SQLITE_LIMIT_VARIABLE_NUMBER` degeri
/// gecici olarak dusurulur. Sinir GERCEKTEN sinanir ama test saniyenin altinda kalir —
/// gercek-olcekli uretim (33 bin satir) `assets_fts_au` tetikleyicisi yuzunden 6 dk suruyordu
/// (her UPDATE tam bir FTS satir yenilemesi tetikliyordu; `project_id` FTS'te olmasa bile —
/// 0032 `assets_fts_au_scoped` bu maliyeti kesti, bkz tests/migration_tests.rs).
#[test]
fn auto_assign_handles_folder_larger_than_sqlite_variable_limit() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let root = r"C:\Buyuk";

    // Sinir 600'e cekilir. Secim onemli: **parca boyutunun (500) USTUNDE** olmali, yoksa
    // duzeltilmis kod da patlar ve test kendi tuzagina duser (ilk denemede tam bu oldu:
    // sinir 100 iken 500'luk parca da siniri asiyordu). 900 dosya → eski kod TEK sorguda 901
    // degisken ister (>600, PATLAR); yeni kod 500+400'e boler (501/401 ≤ 600, GECER).
    db.connection().set_limit(rusqlite::limits::Limit::SQLITE_LIMIT_VARIABLE_NUMBER, 600);

    const BIG: i64 = 900;
    for i in 0..BIG {
        seed_path(&db, &format!(r"C:\Buyuk\Kalabalik\f{i}.dwg"));
    }
    // Sinirin ALTINDA kalan komsu klasor — rollback olursa bu da kaybolurdu.
    let kucuk = seed_path(&db, r"C:\Buyuk\Kucuk\plan.dwg");

    let rep = db.auto_assign_projects_under(root, 1_700_000_000, Some("Aktif")).unwrap();

    assert_eq!(rep.assets_assigned, BIG + 1, "buyuk klasorun TAMAMI + kucuk klasor atanmali");
    assert_eq!(rep.projects_touched, 2, "Kalabalik + Kucuk");
    assert!(project_id_of(&db, kucuk).is_some(), "kucuk klasor rollback'e kurban gitmemeli");
    let names = project_names(&db);
    assert!(names.contains(&"Kalabalik".to_string()), "buyuk klasorun projesi olusmali");
    assert!(names.contains(&"Kucuk".to_string()));
    let kalan: i64 = db
        .connection()
        .query_row(
            r"SELECT COUNT(*) FROM assets WHERE project_id IS NULL AND path LIKE 'C:\Buyuk\%'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kalan, 0, "kok altinda projesiz asset kalmamali");
}
