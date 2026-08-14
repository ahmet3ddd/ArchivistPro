//! ②+③ akis testleri: kuru kosu YAZMAZ · kuru kosu ≡ uygula (simetri) · tam aktarim ·
//! mevcut-AI ezilmez · idempotency (ikinci kosu tum sayaclar 0) · cop eslemesi ·
//! bozuk zaman kosuyu durdurmaz.

mod common;

use archivist_h2import::{apply, dry_run, H2Source, ImportOptions};

/// Uretim listesinin temsili alt-kumesi (vision.rs DRAWING_TYPES; komut katmani enjekte eder).
const TYPES: &[&str] = &["Kat Planı", "Cephe", "Kesit", "Detay", "Vaziyet Planı", "Diğer"];

/// H3 tohumu: fixture'in iki yoluna KASA-VARYANTLI karsiliklar + birinde onceden AI.
fn build_h3() -> archivist_db::Db {
    let mut db = archivist_db::Db::open_in_memory_migrated().unwrap();
    let ingest = |db: &mut archivist_db::Db, path: &str, name: &str, size: i64| {
        db.ingest(
            &archivist_db::write::AssetInput {
                path,
                file_name: name,
                ext: Some("jpg"),
                size_bytes: size,
                content_hash: Some("blake3-x"),
                mime: None,
                title: None,
                description: None,
                created_at: 100,
                modified_at: 200,
            },
            &archivist_db::write::IngestData {
                fts_body: None,
                metadata: &[],
                auto_tags: &[],
                phash: None,
                thumbnail: None,
            },
        )
        .unwrap()
    };
    // a2'nin kasa varyanti (ASCII — NOCASE eslesmeli) + a1'in birebir yolu (onceden AI'li).
    ingest(&mut db, "D:\\PROJE\\CEPHE.JPG", "CEPHE.JPG", 999);
    let y = ingest(&mut db, "D:\\proje\\plan.dwg", "plan.dwg", 555);
    db.set_ai_metadata(y, &[("ai_aciklama", "H3'un kendi taze analizi".into())]).unwrap();
    db
}

fn counts(db: &archivist_db::Db) -> Vec<(String, i64)> {
    // Yazma-yoklugu kaniti icin gozlemlenebilir sayimlar (pub API uzerinden).
    vec![
        ("analyzed".into(), db.analyzed_count().unwrap()),
        ("pending".into(), db.pending_analysis_count().unwrap()),
    ]
}

#[test]
fn dry_run_writes_nothing_and_matches_apply() {
    let dir = tempfile::tempdir().unwrap();
    let h2 = common::build_h2_fixture(dir.path());
    let src = H2Source::open(&h2).unwrap();
    let mut db = build_h3();

    let before = counts(&db);
    let dry = dry_run(&db, &src, &ImportOptions::default(), TYPES, 1_760_000_000, |_| {}).unwrap();
    assert!(dry.dry_run);
    assert_eq!(counts(&db), before, "kuru kosu HICBIR sey yazmamali");

    let live = apply(&mut db, &src, &ImportOptions::default(), TYPES, 1_760_000_000, |_| {}).unwrap();
    assert!(!live.dry_run);

    // SIMETRI: kuru kosunun soyledigi her sayi, uygulananla birebir ayni olmali.
    let pairs = [
        ("assets_inserted", dry.assets_inserted, live.assets_inserted),
        ("assets_existing", dry.assets_existing, live.assets_existing),
        ("assets_deleted_carried", dry.assets_deleted_carried, live.assets_deleted_carried),
        ("duplicate_h2_rows", dry.duplicate_h2_rows, live.duplicate_h2_rows),
        ("ai_written", dry.ai_written, live.ai_written),
        ("ai_skipped_existing", dry.ai_skipped_existing, live.ai_skipped_existing),
        ("gorsel_turu_written", dry.gorsel_turu_written, live.gorsel_turu_written),
        ("tags_written", dry.tags_written, live.tags_written),
        ("favorites_written", dry.favorites_written, live.favorites_written),
        ("collections_created", dry.collections_created, live.collections_created),
        ("collection_items_written", dry.collection_items_written, live.collection_items_written),
        ("project_meta_written", dry.project_meta_written, live.project_meta_written),
        ("roots_added", dry.roots_added, live.roots_added),
        ("groups_created", dry.groups_created, live.groups_created),
        ("root_tags_written", dry.root_tags_written, live.root_tags_written),
        ("thumbnails_carried", dry.thumbnails_carried, live.thumbnails_carried),
        ("unparsable_times", dry.unparsable_times, live.unparsable_times),
    ];
    for (name, d, l) in pairs {
        assert_eq!(d, l, "{name}: kuru kosu {d} ≠ uygula {l}");
    }
}

#[test]
fn full_transfer_carries_everything_expected() {
    let dir = tempfile::tempdir().unwrap();
    let h2 = common::build_h2_fixture(dir.path());
    let src = H2Source::open(&h2).unwrap();
    let mut db = build_h3();

    let rep = apply(&mut db, &src, &ImportOptions::default(), TYPES, 1_760_000_000, |_| {}).unwrap();

    // Fixture: 8 satir; a4/a5 ayni yol → 1 mukerrer; a1+a2 H3'te var → existing 2;
    // a3(cop)+a5+a6+a8+a9 → 5 yeni, 1'i copte dogar.
    assert_eq!(rep.assets_seen, 8);
    assert_eq!(rep.duplicate_h2_rows, 1, "a4 kaybetmeli (extracted_at eski)");
    assert_eq!(rep.assets_existing, 2);
    assert_eq!(rep.assets_inserted, 5);
    assert_eq!(rep.assets_deleted_carried, 1);
    assert_eq!(rep.deleted_conflicts, 0);

    // AI: a1 → H3 AI'si var, ATLANDI; a5+a9 yazildi; a8 yalniz gorsel-turu.
    assert_eq!(rep.ai_skipped_existing, 1);
    assert_eq!(rep.ai_written, 2);
    assert_eq!(rep.gorsel_turu_written, 1);
    assert_eq!(rep.drawing_type_dropped, 0);
    assert_eq!(rep.unparsable_times, 1, "a6'nin bozuk zamanlari (tek satir = tek sayim)");

    // Kurasyon: etiket+favori (a2→mevcut satira), koleksiyon+uyelik, kok+grup+kok-etiketi.
    assert_eq!(rep.tags_written, 1);
    assert_eq!(rep.favorites_written, 1);
    assert_eq!(rep.collections_created, 1);
    assert_eq!(rep.collection_items_written, 1);
    assert_eq!(rep.project_meta_written, 1, "a2'nin review+musteri bilgisi");
    assert_eq!(rep.roots_added, 1);
    assert_eq!(rep.groups_created, 1, "'pasif' grubu");
    assert_eq!(rep.root_tags_written, 1);
    assert_eq!(rep.thumbnails_carried, 1, "a1'in PNG'si plan.dwg satirina");
    assert_eq!(rep.thumbnails_invalid, 0);

    // Tasinamayanlar raporda.
    assert_eq!(rep.users_not_migrated.len(), 1);
    assert_eq!(rep.chat_sessions_not_migrated, 1);

    // DB-duzeyi kanitlar: a6 (diskte olmayan dosya) gercek satir oldu.
    let probe = db.import_probe("E:\\artik\\yok\\kayip.max").unwrap().expect("a6 yazilmis olmali");
    assert!(!probe.deleted);
    // a3 copte dogdu; a5'in kelepceli AI'si yazildi (kanit: probe.has_ai).
    assert!(db.import_probe("D:\\proje\\eski.psd").unwrap().unwrap().deleted);
    assert!(db.import_probe("d:\\proje\\kesit.dwg").unwrap().unwrap().has_ai);
    // a8'in medya turu tasindi.
    assert!(db.import_probe("D:\\proje\\render.png").unwrap().unwrap().has_gorsel_turu);
    // a2'nin kasa-varyantli H3 satiri MUKERRER acilmadi (existing'e zenginlestirildi).
    assert!(db.import_probe("D:\\proje\\cephe.jpg").unwrap().unwrap().has_project_meta);
}

#[test]
fn second_apply_is_a_complete_noop() {
    let dir = tempfile::tempdir().unwrap();
    let h2 = common::build_h2_fixture(dir.path());
    let src = H2Source::open(&h2).unwrap();
    let mut db = build_h3();

    apply(&mut db, &src, &ImportOptions::default(), TYPES, 1_760_000_000, |_| {}).unwrap();
    let second = apply(&mut db, &src, &ImportOptions::default(), TYPES, 1_760_000_100, |_| {}).unwrap();

    assert_eq!(second.assets_inserted, 0);
    assert_eq!(second.assets_deleted_carried, 0);
    assert_eq!(second.ai_written, 0);
    assert_eq!(second.gorsel_turu_written, 0);
    assert_eq!(second.tags_written, 0);
    assert_eq!(second.favorites_written, 0);
    assert_eq!(second.collections_created, 0);
    assert_eq!(second.collection_items_written, 0);
    assert_eq!(second.project_meta_written, 0);
    assert_eq!(second.roots_added, 0);
    assert_eq!(second.groups_created, 0);
    assert_eq!(second.root_tags_written, 0);
    assert_eq!(second.thumbnails_carried, 0);
    // Ikinci kosuda atlananlar dogru siniflandirilir (yanlislikla "yazildi" DEGIL).
    assert_eq!(second.assets_existing, 7, "5 yeni + 2 mevcut → hepsi artik mevcut");
    assert_eq!(second.ai_skipped_existing, 3, "a1 + (artik AI'li) a5 + a9");
    assert_eq!(second.project_meta_skipped_existing, 1);
}

#[test]
fn deleted_h2_row_cannot_trash_active_h3_asset() {
    let dir = tempfile::tempdir().unwrap();
    let h2 = common::build_h2_fixture(dir.path());
    {
        // a2'yi H2 tarafinda cope tasi — H3'te ayni yol AKTIF (tohum).
        let conn = rusqlite::Connection::open(&h2).unwrap();
        conn.execute(
            "UPDATE assets SET is_deleted=1, deleted_at='2026-06-01T00:00:00Z'
             WHERE id='a2a2a2a2a2a2a2a2'",
            [],
        )
        .unwrap();
    }
    let src = H2Source::open(&h2).unwrap();
    let mut db = build_h3();
    let rep = apply(&mut db, &src, &ImportOptions::default(), TYPES, 1_760_000_000, |_| {}).unwrap();
    assert_eq!(rep.deleted_conflicts, 1, "H2 copu H3'un AKTIF satirini silemez");
    let p = db.import_probe("D:\\PROJE\\CEPHE.JPG").unwrap().unwrap();
    assert!(!p.deleted, "H3 satiri aktif kalmali");
}

#[test]
fn include_deleted_false_skips_trash_rows() {
    let dir = tempfile::tempdir().unwrap();
    let h2 = common::build_h2_fixture(dir.path());
    let src = H2Source::open(&h2).unwrap();
    let mut db = build_h3();
    let opts = ImportOptions { include_deleted: false, ..Default::default() };
    let rep = apply(&mut db, &src, &opts, TYPES, 1_760_000_000, |_| {}).unwrap();
    assert_eq!(rep.assets_deleted_carried, 0);
    assert!(db.import_probe("D:\\proje\\eski.psd").unwrap().is_none(), "a3 tasinmamali");
}
