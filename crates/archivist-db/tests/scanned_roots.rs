//! `scanned_roots` — Kaynak-klasor yonetimi entegrasyon testleri.
//!
//! EN riskli katman → **test-first** (data-migration kurali): bu testler koddan ONCE
//! yazildi ve sema/CRUD/iki-aksiyon (removed vs klasor-copu) sozlesmesini kelepceler.
//!
//! H2 DERSLERI dogrulanir:
//! - **Kardes-onek guvenligi:** `C:\Proj` ve `C:\Projeler` kok-alti sayimlari AYRISIR
//!   (denormalize-string tuzaginin yapisal onlemi).
//! - **Okuma+yazma AYNI anda sema-aware:** trash yazma yolu (soft-delete) ile list okuma
//!   yolu (file_count) AYNI sinir + AYNI soft-delete kuralini paylasir (kismi-bozulma yok).
//! - **Butunluk birinci sinif:** purge sonrasi `orphan_count=0` + `integrity_ok` (yetim yok).

use archivist_db::Db;
use rusqlite::params;

/// Bir aktif asset ekle (verilen `path`) → yeni id. `path`=`file_name` (basit); ext dwg.
fn seed(db: &Db, path: &str) -> i64 {
    db.connection()
        .execute(
            "INSERT INTO assets(path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (?1, ?1, 'dwg', 100, 1, 1)",
            params![path],
        )
        .unwrap();
    db.connection().last_insert_rowid()
}

/// Asset'i cop'e at (soft-delete) — bagimsiz (normal) cop; damga 999.
fn soft_delete(db: &Db, id: i64) {
    db.connection()
        .execute("UPDATE assets SET deleted_at = 999 WHERE id = ?1", params![id])
        .unwrap();
}

/// Bir asset'in su anki `deleted_at`'i (soft-delete durumu ispati).
fn deleted_at(db: &Db, id: i64) -> Option<i64> {
    db.connection()
        .query_row("SELECT deleted_at FROM assets WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

/// Toplam asset SATIR sayisi (cop dahil) — "hard-delete edildi mi" ispati.
fn asset_rows(db: &Db) -> i64 {
    db.connection().query_row("SELECT count(*) FROM assets", [], |r| r.get(0)).unwrap()
}

/// Bir kokun `status`'u.
fn status_of(db: &Db, id: i64) -> String {
    db.connection()
        .query_row("SELECT status FROM scanned_roots WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

/// Bir kokun `group_id`'si (FK SET NULL dogrulamasi).
fn group_id_of(db: &Db, id: i64) -> Option<i64> {
    db.connection()
        .query_row("SELECT group_id FROM scanned_roots WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

/// 384-boyutlu birim vektor (tek "sicak" boyut) — purge'un vec0 temizligini kanitlamak icin.
fn unit_vec() -> String {
    let mut parts = vec!["0"; 384];
    parts[0] = "1";
    format!("[{}]", parts.join(","))
}

/// v20 (scanned_roots): 3 tablo + indeksler + FK aksiyonlari (SET NULL / CASCADE); sema >= 20.
#[test]
fn migration_0020_scanned_roots_schema() {
    let db = Db::open_in_memory_migrated().unwrap();
    assert!(db.schema_version().unwrap() >= 20, "0020 uygulanmadi");
    let conn = db.connection();

    // Uc tablo mevcut.
    for t in ["root_groups", "scanned_roots", "root_tags"] {
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?1",
                params![t],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "tablo yok: {t}");
    }

    // Indeksler olusmus.
    for idx in [
        "idx_scanned_roots_path",
        "idx_scanned_roots_status",
        "idx_scanned_roots_deleted",
        "idx_root_tags_tag",
    ] {
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?1",
                params![idx],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "indeks yok: {idx}");
    }

    // FK: scanned_roots.group_id → root_groups ON DELETE SET NULL.
    let sr_ondelete: String = conn
        .query_row(
            "SELECT on_delete FROM pragma_foreign_key_list('scanned_roots') WHERE \"table\"='root_groups'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(sr_ondelete, "SET NULL", "group_id FK SET NULL olmali");

    // FK: root_tags iki FK (scanned_roots + tags), her ikisi de ON DELETE CASCADE.
    let rt_total: i64 = conn
        .query_row("SELECT count(*) FROM pragma_foreign_key_list('root_tags')", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rt_total, 2, "root_tags iki FK olmali (scanned_roots + tags)");
    let rt_cascade: i64 = conn
        .query_row(
            "SELECT count(*) FROM pragma_foreign_key_list('root_tags') WHERE on_delete='CASCADE'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rt_cascade, 2, "root_tags iki FK de ON DELETE CASCADE olmali");

    // foreign_keys gercekten ON (SET NULL/CASCADE enforce edilir).
    let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0)).unwrap();
    assert_eq!(fk, 1, "foreign_keys ON olmali");

    // Bos DB: hic kayit yok.
    assert!(db.list_scanned_roots().unwrap().is_empty());
    assert!(db.list_trashed_roots().unwrap().is_empty());
    assert!(db.list_removed_roots().unwrap().is_empty());
    assert!(db.list_root_groups().unwrap().is_empty());
}

/// add: ilk ekleme yeni; UNIQUE cakisma → ayni id + REACTIVATE (added_at/label DOKUNULMAZ);
/// removed sonrasi add reactivate eder; bos yol reddedilir.
#[test]
fn add_idempotent_and_unique_conflict_reactivates() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (id, newly) = db.add_scanned_root(r"C:\Projeler", "Projeler", 100).unwrap();
    assert!(newly, "ilk ekleme yeni satir");
    assert!(id > 0);

    // Ayni yol → ayni id, newly=false; added_at + label DOKUNULMAZ.
    let (id2, newly2) = db.add_scanned_root(r"C:\Projeler", "Farkli Etiket", 999).unwrap();
    assert_eq!(id2, id);
    assert!(!newly2, "var olan → newly false");
    let (added, label): (i64, String) = db
        .connection()
        .query_row(
            "SELECT added_at, label FROM scanned_roots WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(added, 100, "added_at reactivate'te DOKUNULMAZ");
    assert_eq!(label, "Projeler", "label reactivate'te DOKUNULMAZ");
    assert_eq!(db.list_scanned_roots().unwrap().len(), 1, "kopya kok olusmamali");

    // Listeden cikar (removed) → aktif listede yok; sonra add REACTIVATE eder.
    db.remove_scanned_root(id).unwrap();
    assert!(db.list_scanned_roots().unwrap().is_empty());
    let (id3, newly3) = db.add_scanned_root(r"C:\Projeler", "X", 555).unwrap();
    assert_eq!(id3, id);
    assert!(!newly3);
    assert_eq!(status_of(&db, id), "active", "add → status active (reactivate)");
    assert_eq!(db.list_scanned_roots().unwrap().len(), 1);

    // Bos yol reddedilir (satir yaratmaz).
    assert!(db.add_scanned_root("   ", "x", 1).is_err());
    assert_eq!(db.list_scanned_roots().unwrap().len(), 1);
}

/// record_root_scan: yeni → last_scan=now; tekrar → last_scan guncellenir; klasor-copu sonrasi
/// reactivate eder (is_deleted temizlenir). Ingest oto-tohum "son tarama" izleme senaryosu.
#[test]
fn record_root_scan_sets_last_scan_and_reactivates() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (id, newly) = db.record_root_scan(r"C:\Arsiv", "Arsiv", 1_000).unwrap();
    assert!(newly);
    let ls: Option<i64> = db
        .connection()
        .query_row("SELECT last_scan FROM scanned_roots WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(ls, Some(1_000), "yeni kayit last_scan=now");

    // Ikinci tarama → last_scan guncellenir, ayni id.
    let (id2, newly2) = db.record_root_scan(r"C:\Arsiv", "Arsiv", 2_000).unwrap();
    assert_eq!(id2, id);
    assert!(!newly2);
    let ls2: Option<i64> = db
        .connection()
        .query_row("SELECT last_scan FROM scanned_roots WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(ls2, Some(2_000));

    // Klasor-copu → record_root_scan REACTIVATE eder (is_deleted=0).
    db.trash_scanned_root(id, 3_000).unwrap();
    assert!(db.list_scanned_roots().unwrap().is_empty());
    let (_id3, newly3) = db.record_root_scan(r"C:\Arsiv", "Arsiv", 4_000).unwrap();
    assert!(!newly3);
    let rows = db.list_scanned_roots().unwrap();
    assert_eq!(rows.len(), 1, "record_root_scan reactivate (is_deleted temizlendi)");
    assert_eq!(rows[0].last_scan, Some(4_000));
    assert!(!rows[0].is_deleted);
}

/// list file_count: kok-alti AKTIF sayim; KARDES-ONEK (C:\Proj vs C:\Projeler / Projelerkiler)
/// AYRISIR; kok-disi + cop asset haric. (H2 denormalize-string tuzaginin yapisal onlemi.)
#[test]
fn list_file_count_is_sibling_prefix_safe_and_excludes_trash() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (a, _) = db.add_scanned_root(r"C:\Proj", "Proj", 1).unwrap();
    let (b, _) = db.add_scanned_root(r"C:\Projeler", "Projeler", 1).unwrap();

    // A (C:\Proj) alti: dogrudan dosya + alt-klasor (ikisi de sayilir).
    seed(&db, r"C:\Proj\a.dwg");
    seed(&db, r"C:\Proj\sub\b.dwg");
    // B (C:\Projeler) alti — A ile KARDES-ONEK (A'ya bulasmamali).
    seed(&db, r"C:\Projeler\c.dwg");
    seed(&db, r"C:\Projeler\Villa\d.dwg");
    let gone = seed(&db, r"C:\Projeler\Villa\gone.dwg");
    soft_delete(&db, gone); // cop → sayilmaz
    // Kok-disi (baska surucu) — hicbir koke bulasmamali.
    seed(&db, r"D:\Other\e.dwg");
    // B'nin kardes-oneki (B'ye bulasmamali).
    seed(&db, r"C:\Projelerkiler\x.dwg");

    let rows = db.list_scanned_roots().unwrap();
    let fc = |id: i64| rows.iter().find(|r| r.id == id).unwrap().file_count;
    assert_eq!(fc(a), 2, r"C:\Proj alti 2 (kardes C:\Projeler bulasmaz)");
    assert_eq!(fc(b), 2, r"C:\Projeler alti 2 (cop gone + kardes Projelerkiler haric)");
}

/// list siralamasi: is_favorite DESC once, sonra label ASC.
#[test]
fn list_orders_favorites_first_then_label() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (a, _) = db.add_scanned_root(r"C:\Alpha", "Alpha", 1).unwrap();
    let (z, _) = db.add_scanned_root(r"C:\Zeta", "Zeta", 1).unwrap();
    let (m, _) = db.add_scanned_root(r"C:\Mid", "Mid", 1).unwrap();
    db.set_root_favorite(z, true).unwrap(); // favori → basa

    let order: Vec<i64> = db.list_scanned_roots().unwrap().iter().map(|r| r.id).collect();
    // Zeta (favori) once; sonra label ASC: Alpha, Mid.
    assert_eq!(order, vec![z, a, m]);
}

/// remove (status='removed'): kok aktif listeden kalkar, removed listesinde gorunur; kok-alti
/// asset'ler DOKUNULMAZ (sayisi degismez). reactivate geri getirir.
#[test]
fn remove_hides_root_but_keeps_assets_reactivate_restores() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (id, _) = db.add_scanned_root(r"C:\Kok", "Kok", 1).unwrap();
    seed(&db, r"C:\Kok\a.dwg");
    seed(&db, r"C:\Kok\b.dwg");
    let before = asset_rows(&db);

    db.remove_scanned_root(id).unwrap();
    assert_eq!(status_of(&db, id), "removed");
    assert!(db.list_scanned_roots().unwrap().is_empty(), "removed kok aktif listede yok");
    // Asset'ler DOKUNULMAZ (status='removed' asset'e dokunmaz).
    assert_eq!(asset_rows(&db), before, "asset satirlari degismez");
    assert_eq!(db.asset_count().unwrap(), 2, "asset'ler aktif kalir");

    // removed listesinde gorunur; file_count = aktif (asset dokunulmadi).
    let removed = db.list_removed_roots().unwrap();
    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0].file_count, 2, "removed file_count = aktif kok-alti");

    db.reactivate_scanned_root(id).unwrap();
    assert_eq!(status_of(&db, id), "active");
    assert_eq!(db.list_scanned_roots().unwrap().len(), 1);
    assert!(db.list_removed_roots().unwrap().is_empty());
}

/// trash (klasor-copu): kok is_deleted + kok-alti AKTIF asset'ler soft-delete; kok-DISI asset
/// DOKUNULMAZ; hicbir asset HARD-delete edilmez. restore ikisini de dondurur.
#[test]
fn trash_soft_deletes_under_root_only_and_restore_returns_them() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (id, _) = db.add_scanned_root(r"C:\Kok", "Kok", 1).unwrap();
    let a = seed(&db, r"C:\Kok\a.dwg");
    let b = seed(&db, r"C:\Kok\sub\b.dwg");
    let outside = seed(&db, r"D:\Other\c.dwg"); // kok-disi → DOKUNULMAZ
    let before = asset_rows(&db);

    // Klasor copu: kok is_deleted=1 + kok-alti AKTIF asset'ler soft-delete (now paylasilir).
    let trashed = db.trash_scanned_root(id, 5_000).unwrap();
    assert_eq!(trashed, 2, "kok-alti 2 aktif asset cope");
    assert_eq!(asset_rows(&db), before, "hicbir asset HARD-delete edilmedi");
    assert_eq!(deleted_at(&db, a), Some(5_000));
    assert_eq!(deleted_at(&db, b), Some(5_000));
    assert_eq!(deleted_at(&db, outside), None, "kok-DISI asset DOKUNULMAZ");

    // Aktif listede yok; cop listesinde var; cop file_count = soft-deleted 2.
    assert!(db.list_scanned_roots().unwrap().is_empty());
    let trash = db.list_trashed_roots().unwrap();
    assert_eq!(trash.len(), 1);
    assert!(trash[0].is_deleted);
    assert_eq!(trash[0].deleted_at, Some(5_000));
    assert_eq!(trash[0].file_count, 2, "cop file_count = kok-alti soft-deleted");

    // Restore: kok is_deleted=0 + kok-alti asset'ler geri.
    let restored = db.restore_scanned_root(id).unwrap();
    assert_eq!(restored, 2);
    assert_eq!(deleted_at(&db, a), None);
    assert_eq!(deleted_at(&db, b), None);
    assert_eq!(deleted_at(&db, outside), None);
    assert_eq!(db.list_scanned_roots().unwrap().len(), 1);
    assert!(db.list_trashed_roots().unwrap().is_empty());

    // trash idempotent: zaten aktif olmayan asset yeniden damgalanmaz (once biri elle cop).
    soft_delete(&db, a); // damga 999 (bagimsiz cop)
    let trashed2 = db.trash_scanned_root(id, 6_000).unwrap();
    assert_eq!(trashed2, 1, "yalniz aktif b cope (a zaten cop'te → dokunulmaz)");
    assert_eq!(deleted_at(&db, a), Some(999), "zaten cop'teki asset damgasi korunur");
}

/// purge (klasor-copu kalici sil): kok-alti asset'ler + vektorleri KALICI silinir (orphan 0),
/// kok satiri + root_tags CASCADE gider; kok-disi asset korunur; butunluk saglam.
#[test]
fn purge_permanently_deletes_root_and_under_root_assets_no_orphans() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (id, _) = db.add_scanned_root(r"C:\Kok", "Kok", 1).unwrap();
    let a = seed(&db, r"C:\Kok\a.dwg");
    seed(&db, r"C:\Kok\sub\b.dwg");
    let outside = seed(&db, r"D:\Other\c.dwg");
    // Kok-alti asset'e vektor → purge vec0 temizligini de kapsasin (yetim vektor DOGMASIN).
    db.connection()
        .execute(
            "INSERT INTO asset_vectors(asset_id, embedding) VALUES (?1, ?2)",
            params![a, unit_vec()],
        )
        .unwrap();
    // Koke etiket → root_tags CASCADE kanitlansin.
    db.add_root_tag(id, "onemli").unwrap();

    // Gercek akis: once klasor-copu, sonra kalici sil.
    db.trash_scanned_root(id, 5_000).unwrap();
    let before = asset_rows(&db);
    let purged = db.purge_scanned_root(id).unwrap();
    assert_eq!(purged, 2, "kok-alti 2 asset KALICI silindi");
    assert_eq!(asset_rows(&db), before - 2, "asset'ler HARD-delete");

    // Kok satiri gitti (hicbir listede yok) + root_tags CASCADE ile temizlendi.
    assert!(db.list_scanned_roots().unwrap().is_empty());
    assert!(db.list_trashed_roots().unwrap().is_empty());
    let rt: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM root_tags WHERE root_id = ?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(rt, 0, "kok DELETE → root_tags CASCADE");
    // Kok-disi asset korunur.
    assert_eq!(deleted_at(&db, outside), None);

    // BUTUNLUK (H2 kismi-bozulma dersi): yetim yok (vektor dahil), integrity ok.
    assert_eq!(db.orphan_count().unwrap(), 0, "purge sonrasi yetim 0 (vec0 dahil)");
    assert!(db.integrity_ok().unwrap());
}

/// group: create → list root_count (AKTIF kok, removed haric); rename/recolor; delete → FK
/// SET NULL (kokler KALIR, group_id NULL); bos ad reddedilir; bos renk → varsayilan.
#[test]
fn groups_create_list_count_and_delete_sets_null() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let g = db.create_root_group("Villalar", "#ff0000", 100).unwrap();
    assert!(g > 0);

    let (r1, _) = db.add_scanned_root(r"C:\V1", "V1", 1).unwrap();
    let (r2, _) = db.add_scanned_root(r"C:\V2", "V2", 1).unwrap();
    let (r3, _) = db.add_scanned_root(r"C:\V3", "V3", 1).unwrap();
    db.assign_root_group(r1, Some(g)).unwrap();
    db.assign_root_group(r2, Some(g)).unwrap();
    // r3 gruba atanmaz.
    db.remove_scanned_root(r2).unwrap(); // removed → canli root_count'a girmez

    let groups = db.list_root_groups().unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].name, "Villalar");
    assert_eq!(groups[0].color, "#ff0000");
    assert_eq!(groups[0].root_count, 1, "canli root_count: yalniz aktif r1 (removed r2 haric)");

    // Aktif liste r1'in group_id'sini yansitir.
    let r1row = db.list_scanned_roots().unwrap().into_iter().find(|r| r.id == r1).unwrap();
    assert_eq!(r1row.group_id, Some(g));

    // rename + recolor.
    db.rename_root_group(g, "Konutlar").unwrap();
    db.recolor_root_group(g, "#00ff00").unwrap();
    let grp = db.list_root_groups().unwrap();
    assert_eq!(grp[0].name, "Konutlar");
    assert_eq!(grp[0].color, "#00ff00");

    // delete → FK SET NULL: kokler KALIR, group_id NULL.
    db.delete_root_group(g).unwrap();
    assert!(db.list_root_groups().unwrap().is_empty());
    assert_eq!(group_id_of(&db, r1), None, "grup silinince kok group_id NULL (SET NULL)");
    assert!(db.list_scanned_roots().unwrap().iter().any(|r| r.id == r1), "kok KALIR");
    let _ = r3;

    // Bos renk → varsayilan; bos ad reddedilir.
    let g2 = db.create_root_group("Bos-Renk", "   ", 1).unwrap();
    let x = db.list_root_groups().unwrap().into_iter().find(|gr| gr.id == g2).unwrap();
    assert_eq!(x.color, "#6366f1", "bos renk → varsayilan");
    assert!(db.create_root_group("  ", "#fff", 1).is_err(), "bos ad reddedilir");
}

/// assign_root_group: olmayan gruba atama FK ile REDDEDILIR (hayalet baglanti imkansiz);
/// None → gruptan cikar (NULL).
#[test]
fn assign_root_group_rejects_invalid_group_fk() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (r, _) = db.add_scanned_root(r"C:\K", "K", 1).unwrap();
    assert!(db.assign_root_group(r, Some(9999)).is_err(), "olmayan gruba atama FK ile reddedilmeli");
    db.assign_root_group(r, None).unwrap();
    assert_eq!(group_id_of(&db, r), None);
}

/// root_tags: add (idempotent + paylasilan tags tablosu) / list (ad ASC) / remove; kok DELETE
/// → root_tags CASCADE (tag TANIMI durur); tag DELETE → root_tags CASCADE; kenar durumlar.
#[test]
fn root_tags_add_remove_and_cascade() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (r1, _) = db.add_scanned_root(r"C:\A", "A", 1).unwrap();
    let (r2, _) = db.add_scanned_root(r"C:\B", "B", 1).unwrap();

    let t1 = db.add_root_tag(r1, "onemli").unwrap();
    let _t2 = db.add_root_tag(r1, "2026").unwrap();
    // Idempotent: ayni tag tekrar → ayni id (kopya bag yok).
    assert_eq!(db.add_root_tag(r1, "onemli").unwrap(), t1);
    // Paylasilan `tags` tablosu: r2'ye AYNI ad → AYNI tag id.
    assert_eq!(db.add_root_tag(r2, "onemli").unwrap(), t1);

    // list tags (ad ASC). tags = {id, name} → adlari cikar.
    let tag_names = |row: &archivist_db::ScannedRootRow| -> Vec<String> {
        row.tags.iter().map(|t| t.name.clone()).collect()
    };
    let r1row = db.list_scanned_roots().unwrap().into_iter().find(|r| r.id == r1).unwrap();
    assert_eq!(tag_names(&r1row), vec!["2026".to_string(), "onemli".to_string()]);
    // tag_id de gelmeli (frontend kaldirma icin) → t1 adli 'onemli' etiketi r1row'da.
    assert!(r1row.tags.iter().any(|t| t.id == t1 && t.name == "onemli"));

    // remove yalniz r1'in bagini kaldirir (r2'ninki durur).
    db.remove_root_tag(r1, t1).unwrap();
    let r1row = db.list_scanned_roots().unwrap().into_iter().find(|r| r.id == r1).unwrap();
    assert_eq!(tag_names(&r1row), vec!["2026".to_string()]);
    let r2row = db.list_scanned_roots().unwrap().into_iter().find(|r| r.id == r2).unwrap();
    assert_eq!(tag_names(&r2row), vec!["onemli".to_string()]);

    // Kok kalici silinince root_tags CASCADE (r2'nin bagi gider) — ama tag TANIMI korunur.
    db.purge_scanned_root(r2).unwrap();
    let rt_r2: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM root_tags WHERE root_id = ?1", params![r2], |r| r.get(0))
        .unwrap();
    assert_eq!(rt_r2, 0, "kok DELETE → root_tags CASCADE");
    let tag_exists: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM tags WHERE id = ?1", params![t1], |r| r.get(0))
        .unwrap();
    assert_eq!(tag_exists, 1, "tag TANIMI (sozluk) korunur — yalniz bag gitti");

    // Tag DELETE → root_tags CASCADE (tag_id tarafi).
    let tg = db.add_root_tag(r1, "gecici").unwrap();
    db.connection().execute("DELETE FROM tags WHERE id = ?1", params![tg]).unwrap();
    let rt: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM root_tags WHERE tag_id = ?1", params![tg], |r| r.get(0))
        .unwrap();
    assert_eq!(rt, 0, "tag DELETE → root_tags CASCADE (tag_id tarafi)");

    // Kenar: olmayan koke etiket → hata; bos ad → hata.
    assert!(db.add_root_tag(99999, "x").is_err(), "olmayan kok reddedilir");
    assert!(db.add_root_tag(r1, "   ").is_err(), "bos ad reddedilir");
}

/// setter kenar durumlari: rename bos label reddeder; favori flip; olmayan id setter'lar no-op.
#[test]
fn rename_and_setters_edge_cases() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let (id, _) = db.add_scanned_root(r"C:\K", "Eski", 1).unwrap();

    db.rename_scanned_root(id, "Yeni").unwrap();
    assert_eq!(db.list_scanned_roots().unwrap()[0].label, "Yeni");
    assert!(db.rename_scanned_root(id, "   ").is_err(), "bos label reddedilir");

    db.set_root_favorite(id, true).unwrap();
    assert!(db.list_scanned_roots().unwrap()[0].is_favorite);
    db.set_root_favorite(id, false).unwrap();
    assert!(!db.list_scanned_roots().unwrap()[0].is_favorite);

    // Olmayan id → setter'lar no-op (idempotent, hata yok).
    db.rename_scanned_root(99999, "z").unwrap();
    db.set_root_favorite(99999, true).unwrap();
    db.remove_scanned_root(99999).unwrap();
    db.reactivate_scanned_root(99999).unwrap();
    assert_eq!(db.trash_scanned_root(99999, 1).unwrap(), 0, "olmayan kok trash → 0");
    assert_eq!(db.restore_scanned_root(99999).unwrap(), 0, "olmayan kok restore → 0");
    assert_eq!(db.purge_scanned_root(99999).unwrap(), 0, "olmayan kok purge → 0");
}
