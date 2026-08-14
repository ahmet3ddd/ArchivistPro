//! Faz 4.3/4.3b kurasyon yazma-yolu entegrasyon testleri: kullanici etiketi, favori
//! ve koleksiyon. Migration 0004 (favorites/tags.color) ve 0005 (collections) write/
//! query yollariyla birlikte dogrulanir.

use archivist_db::{AssetInput, Db, IngestData, ListOpts};

/// Minimal bir asset ingest et, id dondur.
fn ingest_one(db: &mut Db, path: &str, name: &str) -> i64 {
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

fn opts_tag(tag: &str) -> ListOpts {
    ListOpts { page_size: 50, tag: vec![tag.to_string()], ..Default::default() }
}

#[test]
fn user_tags_add_remove_facet_and_filter() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/b.txt", "b.txt");

    db.add_user_tag(a, "villa").unwrap();
    db.add_user_tag(a, "villa").unwrap(); // idempotent
    db.add_user_tag(a, "  ").unwrap(); // bos → no-op
    db.add_user_tag(b, "villa").unwrap();
    db.add_user_tag(a, "2024").unwrap();

    // get_asset → TagRef (kind=user)
    let detail = db.get_asset(a).unwrap().unwrap();
    let names: Vec<&str> = detail.tags.iter().map(|t| t.name.as_str()).collect();
    assert!(names.contains(&"villa") && names.contains(&"2024"));
    assert!(detail.tags.iter().all(|t| t.kind == "user"));

    // Global rozet rengi: yalniz user etiketi, #RRGGBB veya temizleme.
    db.set_tag_color("villa", Some("#12aBcD")).unwrap();
    let detail = db.get_asset(a).unwrap().unwrap();
    assert_eq!(detail.tags.iter().find(|t| t.name == "villa").unwrap().color.as_deref(), Some("#12aBcD"));
    assert!(db.set_tag_color("villa", Some("red")).is_err());
    assert!(db.set_tag_color("villa", Some("#12345z")).is_err());
    db.set_tag_color("villa", None).unwrap();
    assert!(db.get_asset(a).unwrap().unwrap().tags.iter().find(|t| t.name == "villa").unwrap().color.is_none());
    assert!(db.set_tag_color("missing", Some("#112233")).is_err());

    // tag facet: villa=2, 2024=1
    let facets = db.tag_facets(10).unwrap();
    let villa = facets.iter().find(|f| f.value.as_deref() == Some("villa")).unwrap();
    assert_eq!(villa.count, 2);

    // tag filtresi
    assert_eq!(db.list_assets(&opts_tag("villa")).unwrap().total, 2);
    assert_eq!(db.list_assets(&opts_tag("2024")).unwrap().total, 1);

    // kaldir → idempotent + filtre guncellenir
    db.remove_tag(a, "villa").unwrap();
    db.remove_tag(a, "villa").unwrap();
    assert_eq!(db.list_assets(&opts_tag("villa")).unwrap().total, 1);
}

#[test]
fn favorites_toggle_count_and_filter() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/b.txt", "b.txt");

    db.set_favorite(a, true).unwrap();
    db.set_favorite(a, true).unwrap(); // idempotent
    db.set_favorite(b, true).unwrap();
    assert_eq!(db.favorite_count().unwrap(), 2);

    db.set_favorite(b, false).unwrap();
    db.set_favorite(b, false).unwrap(); // idempotent
    assert_eq!(db.favorite_count().unwrap(), 1);

    // favorites_only filtresi + AssetRow.favorite bayragi
    let favs = db
        .list_assets(&ListOpts { page_size: 50, favorites_only: true, ..Default::default() })
        .unwrap();
    assert_eq!(favs.total, 1);
    assert_eq!(favs.items[0].id, a);
    assert!(favs.items[0].favorite);

    // get_asset favorite bayragi
    assert!(db.get_asset(a).unwrap().unwrap().asset.favorite);
    assert!(!db.get_asset(b).unwrap().unwrap().asset.favorite);
}

fn opts_collection(id: i64) -> ListOpts {
    ListOpts { page_size: 50, collection: vec![id], ..Default::default() }
}

#[test]
fn collections_crud_membership_facet_and_filter() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/b.txt", "b.txt");

    // find-or-create: ayni ad → ayni id; renk round-trip; bos ad → hata.
    let villa = db.create_collection("Villa", Some("#22aa55")).unwrap();
    assert_eq!(db.create_collection("  Villa  ", None).unwrap(), villa); // trim + idempotent
    assert!(db.create_collection("   ", None).is_err()); // bos → Invalid

    let ofis = db.create_collection("Ofis", None).unwrap();
    assert_ne!(villa, ofis);

    // uyelik: a,b → villa; a → ofis (ekleme idempotent)
    db.add_to_collection(villa, a).unwrap();
    db.add_to_collection(villa, a).unwrap(); // idempotent
    db.add_to_collection(villa, b).unwrap();
    db.add_to_collection(ofis, a).unwrap();

    // list_collections: ada gore sirali (Ofis, Villa), sayilar + renk
    let cols = db.list_collections().unwrap();
    assert_eq!(cols.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Ofis", "Villa"]);
    let villa_ref = cols.iter().find(|c| c.id == villa).unwrap();
    assert_eq!(villa_ref.count, 2);
    assert_eq!(villa_ref.color.as_deref(), Some("#22aa55"));
    assert_eq!(cols.iter().find(|c| c.id == ofis).unwrap().count, 1);

    // Yeniden adlandirma: kimlik/uyelik korunur; trim uygulanir; bos/cakisan/yok id reddedilir.
    db.rename_collection(ofis, "  Ofis Arsivi  ").unwrap();
    let cols = db.list_collections().unwrap();
    assert!(cols.iter().any(|c| c.id == ofis && c.name == "Ofis Arsivi" && c.count == 1));
    assert!(db.rename_collection(ofis, "   ").is_err());
    assert!(db.rename_collection(ofis, "Villa").is_err());
    assert!(db.rename_collection(999_999, "Yok").is_err());

    // Renk: yalniz #RRGGBB kabul edilir; nullable oldugu icin kaldirilabilir.
    db.set_collection_color(ofis, Some("#12aBcD")).unwrap();
    let cols = db.list_collections().unwrap();
    assert_eq!(cols.iter().find(|c| c.id == ofis).unwrap().color.as_deref(), Some("#12aBcD"));
    assert!(db.set_collection_color(ofis, Some("red")).is_err());
    assert!(db.set_collection_color(ofis, Some("#12345z")).is_err());
    db.set_collection_color(ofis, None).unwrap();
    assert!(db.list_collections().unwrap().iter().find(|c| c.id == ofis).unwrap().color.is_none());
    assert!(db.set_collection_color(999_999, Some("#112233")).is_err());

    // get_asset → uyelik koleksiyonlari (a: Ofis + Villa)
    let detail = db.get_asset(a).unwrap().unwrap();
    let names: Vec<&str> = detail.collections.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["Ofis Arsivi", "Villa"]);

    // koleksiyon filtresi
    assert_eq!(db.list_assets(&opts_collection(villa)).unwrap().total, 2);
    assert_eq!(db.list_assets(&opts_collection(ofis)).unwrap().total, 1);

    // uyelikten cikar → filtre + sayim guncellenir (koleksiyon ve asset durur)
    db.remove_from_collection(villa, a).unwrap();
    db.remove_from_collection(villa, a).unwrap(); // idempotent
    assert_eq!(db.list_assets(&opts_collection(villa)).unwrap().total, 1);
    assert!(db.get_asset(a).unwrap().is_some()); // asset silinmedi

    // koleksiyonu sil → liste kuculur, uyelikler CASCADE ile gider (asset durur)
    db.delete_collection(ofis).unwrap();
    db.delete_collection(ofis).unwrap(); // idempotent
    let cols = db.list_collections().unwrap();
    assert_eq!(cols.len(), 1);
    assert_eq!(cols[0].id, villa);
    assert!(db.get_asset(a).unwrap().unwrap().collections.is_empty()); // a artik hicbir koleksiyonda
    assert!(db.get_asset(a).unwrap().is_some());
}


// ─────────────────────────────────────────────────────────────────────────────
// Etiket VARLIK yonetimi (yeniden adlandir / sil) — 2026-07-26 davranis-sadakati
// turu §8: H2'de TagManagerModal ile vardi, H3'te HIC YOKTU (yalniz renk vardi)
// → yanlis yazilmis bir etiket ne duzeltilebiliyor ne silinebiliyordu.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn rename_user_tag_changes_name_everywhere() {
    // Yeniden adlandirma VARLIK duzeyindedir: etikete bagli TUM asset'lerde birden degisir.
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/x/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/x/b.txt", "b.txt");
    db.add_user_tag(a, "cehpe").unwrap(); // kasitli yazim hatasi
    db.add_user_tag(b, "cehpe").unwrap();

    db.rename_user_tag("cehpe", "cephe").unwrap();

    let facets = db.tag_facets(50).unwrap();
    let names: Vec<&str> = facets.iter().filter_map(|f| f.value.as_deref()).collect();
    assert!(names.contains(&"cephe"), "yeni ad facet'te olmali: {names:?}");
    assert!(!names.contains(&"cehpe"), "eski ad kalmamali: {names:?}");
    let count = facets.iter().find(|f| f.value.as_deref() == Some("cephe")).unwrap().count;
    assert_eq!(count, 2, "iki asset de yeni ada bagli kalmali");
}

#[test]
fn rename_user_tag_rejects_existing_name_and_protects_auto() {
    // Hedef ad ZATEN varsa reddedilir (sessiz BIRLESTIRME yok — geri-alinamaz veri karisimi olurdu).
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/x/a.txt", "a.txt");
    db.add_user_tag(a, "cephe").unwrap();
    db.add_user_tag(a, "kesit").unwrap();

    let err = db.rename_user_tag("cephe", "kesit").unwrap_err();
    assert!(format!("{err}").contains("zaten var"), "cakisma reddedilmeli: {err}");
    // Iki etiket de DURUYOR (yarim islem yok).
    let names: Vec<String> =
        db.tag_facets(50).unwrap().into_iter().filter_map(|f| f.value).collect();
    assert!(names.contains(&"cephe".to_string()) && names.contains(&"kesit".to_string()));

    // Ayni ad → no-op (hata degil; H2 "if (oldName === newName) return").
    db.rename_user_tag("cephe", "cephe").unwrap();
    // Olmayan etiket → acik hata.
    assert!(db.rename_user_tag("yok", "yeni").is_err());
    // Bos ad → reddedilir.
    assert!(db.rename_user_tag("cephe", "   ").is_err());
}

#[test]
fn delete_user_tag_returns_affected_assets_and_cascades() {
    // Silme, bagli asset id'lerini DONER (komut katmani "N dosyadan kaldirildi" + geri-al icin)
    // ve asset_tags baglari FK CASCADE ile gider.
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/x/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/x/b.txt", "b.txt");
    db.add_user_tag(a, "gecici").unwrap();
    db.add_user_tag(b, "gecici").unwrap();
    db.add_user_tag(a, "kalici").unwrap();
    db.set_tag_color("gecici", Some("#ff0000")).unwrap();

    // Renk silmeden ONCE okunabilmeli (geri-al rengi de geri getirir).
    assert_eq!(db.tag_color("gecici").unwrap().as_deref(), Some("#ff0000"));

    let affected = db.delete_user_tag("gecici").unwrap();
    assert_eq!(affected, vec![a, b], "etiketin bagli oldugu asset'ler donmeli");

    let names: Vec<String> =
        db.tag_facets(50).unwrap().into_iter().filter_map(|f| f.value).collect();
    assert!(!names.contains(&"gecici".to_string()), "silinen etiket facet'te olmamali");
    assert!(names.contains(&"kalici".to_string()), "diger etiket ETKILENMEMELI");
    // Asset'ler duruyor (yalniz etiket bagi gitti) — silme asset'e dokunmaz.
    assert_eq!(db.get_asset(a).unwrap().unwrap().tags.len(), 1, "a'da yalniz 'kalici' kalmali");
    assert!(db.get_asset(b).unwrap().unwrap().tags.is_empty(), "b'de etiket kalmamali");
}

#[test]
fn delete_user_tag_rejects_missing_and_non_user_kind() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/x/a.txt", "a.txt");
    db.add_user_tag(a, "cephe").unwrap();

    assert!(db.delete_user_tag("yok").is_err(), "olmayan etiket → hata");
    assert!(db.delete_user_tag("  ").is_err(), "bos ad → hata");
    // Silme sonrasi ayni etiket yeniden kurulabilir (geri-al yolunun on kosulu).
    let ids = db.delete_user_tag("cephe").unwrap();
    db.add_user_tag(ids[0], "cephe").unwrap();
    db.set_tag_color("cephe", Some("#00ff00")).unwrap();
    assert_eq!(db.tag_color("cephe").unwrap().as_deref(), Some("#00ff00"));
}