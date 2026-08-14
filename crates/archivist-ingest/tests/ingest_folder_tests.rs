//! İngest hatti entegrasyon testi — temp klasor → temp DB, uctan uca.

use std::fs;
use std::time::Duration;

use archivist_db::{Db, ProjectInput};
use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor, Registry};
use archivist_ingest::{
    build_registry, ingest_folder, ingest_folder_with_progress, ingest_folders_with_progress,
    reindex_paths, IngestMode, IngestOpts, REPORT_MAX_ENTRIES,
};
use rusqlite::params;

const IFC: &str = "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n\
                   #1=IFCPROJECT('0Yv',#2,'Kule Projesi',$,$,$,$,(#10),#9);\nENDSEC;\n\
                   END-ISO-10303-21;\n";

struct SlowHeartbeatExtractor;

impl Extractor for SlowHeartbeatExtractor {
    fn id(&self) -> &'static str {
        "slow-heartbeat"
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["heartbeat"]
    }

    fn timeout(&self) -> Duration {
        Duration::from_secs(5)
    }

    fn extract(&self, _input: &ExtractInput) -> Result<Extracted, ExtractError> {
        std::thread::sleep(Duration::from_millis(1_300));
        Ok(Extracted::new())
    }
}

/// Kucuk gecerli DXF: ENTITIES icinde kapali kare (LWPOLYLINE, 4 vertex, flag=1) + CIRCLE.
/// Ikisi de `filter_searchable_shapes`'ten gecer (tekil LINE gurultusu yok) → 2 aranabilir sekil.
const DXF_PLAN: &str = "0\nSECTION\n2\nENTITIES\n\
0\nLWPOLYLINE\n8\nDUVAR\n90\n4\n70\n1\n\
10\n0.0\n20\n0.0\n10\n5.0\n20\n0.0\n10\n5.0\n20\n5.0\n10\n0.0\n20\n5.0\n\
0\nCIRCLE\n8\nPENCERE\n10\n5.0\n20\n10.0\n40\n2.0\n\
0\nENDSEC\n0\nEOF\n";

fn setup_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let r = dir.path();
    fs::write(r.join("rapor.txt"), b"mimari proje raporu villa metni").unwrap();
    fs::write(r.join("veriler.csv"), b"ad,sehir\nAhmet,Hatay").unwrap();
    fs::write(r.join("model.ifc"), IFC.as_bytes()).unwrap();
    fs::write(r.join("arsiv.bin"), [0u8, 1, 2, 3, 4, 5]).unwrap(); // bilinmeyen ext
    dir
}

/// İPTAL: `stop` bayragi set iken ingest hicbir dosya yazmaz + iptal uyarisi (post-pass'ler atlanir).
/// H2 `raceInvoke` pariteli iptal (src-tauri INGEST_STOP → pipeline erken cikis).
#[test]
fn ingest_cancelled_writes_nothing_and_warns() {
    use std::sync::atomic::{AtomicBool, Ordering};
    let dir = setup_dir();
    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    let stop = AtomicBool::new(false);
    let mut progress = Vec::new();
    let r = ingest_folder_with_progress(
        &mut db,
        &reg,
        dir.path(),
        &IngestOpts::default(),
        &mut |p| {
            progress.push(p.clone());
            if p.total > 0 && p.processed == 0 {
                stop.store(true, Ordering::SeqCst);
            }
        },
        &stop,
    );
    assert_eq!(r.added, 0, "iptal → hicbir dosya yazilmaz");
    assert!(r.cancelled, "rapor iptali tipli alanla tasimali");
    assert!(
        r.completed_roots.is_empty(),
        "kismi kosu kok tarandi diye kaydedilmemeli"
    );
    assert!(
        r.warnings.iter().any(|(_, m)| m.contains("iptal edildi")),
        "iptal uyarisi bulunmali: {:?}",
        r.warnings
    );
    let n: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM assets", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0, "DB gercekten bos (yazim olmadi)");
    let final_progress = progress.last().expect("iptal final ilerlemesi");
    assert!(final_progress.cancelled);
    assert_eq!(
        final_progress.processed, 0,
        "iptal %100 gibi gosterilmemeli"
    );
    assert_eq!(final_progress.total, 4);
}

#[test]
fn reset_cancelled_before_start_never_purges_archive() {
    use std::sync::atomic::AtomicBool;

    let existing = tempfile::tempdir().unwrap();
    fs::write(existing.path().join("koru.txt"), b"korunacak").unwrap();
    let replacement = tempfile::tempdir().unwrap();
    fs::write(replacement.path().join("yeni.txt"), b"yeni").unwrap();
    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    assert_eq!(
        ingest_folder(&mut db, &reg, existing.path(), &IngestOpts::default()).added,
        1
    );

    let stop = AtomicBool::new(true);
    let report = ingest_folder_with_progress(
        &mut db,
        &reg,
        replacement.path(),
        &IngestOpts {
            mode: IngestMode::Reset,
            ..Default::default()
        },
        &mut |_| {},
        &stop,
    );

    assert!(report.cancelled);
    assert_eq!(report.removed, 0, "stop set iken reset purge'e girmemeli");
    assert_eq!(db.asset_count().unwrap(), 1, "mevcut arsiv aynen korunmali");
}

#[test]
fn multiple_roots_are_one_job_and_reset_only_once() {
    use std::sync::atomic::AtomicBool;

    let old = tempfile::tempdir().unwrap();
    fs::write(old.path().join("old.txt"), b"old").unwrap();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    fs::write(first.path().join("a.txt"), b"a").unwrap();
    fs::write(first.path().join("c.txt"), b"c").unwrap();
    fs::write(second.path().join("b.txt"), b"b").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    assert_eq!(
        ingest_folder(&mut db, &reg, old.path(), &IngestOpts::default()).added,
        1
    );

    let roots = vec![first.path().to_path_buf(), second.path().to_path_buf()];
    let stop = AtomicBool::new(false);
    let mut progress = Vec::new();
    let report = ingest_folders_with_progress(
        &mut db,
        &reg,
        &roots,
        &IngestOpts {
            mode: IngestMode::Reset,
            ..Default::default()
        },
        &mut |p| progress.push(p.clone()),
        &stop,
    );

    assert_eq!(report.removed, 1, "reset once removes the old archive");
    assert_eq!(
        report.added, 3,
        "both selected roots survive the same reset job"
    );
    assert!(!report.cancelled);
    assert_eq!(report.completed_roots.len(), 2);
    assert!(progress.iter().any(|p| p.total == 3 && p.root_total == 2));
    assert!(
        progress.iter().any(|p| !p.active_paths.is_empty()),
        "workers report files while preparation is still active"
    );
    let final_progress = progress.last().unwrap();
    assert_eq!((final_progress.processed, final_progress.total), (3, 3));
    assert_eq!(final_progress.root_index, 2);
    assert!(final_progress.active_paths.is_empty());

    fs::remove_file(first.path().join("a.txt")).unwrap();
    let replace = ingest_folders_with_progress(
        &mut db,
        &reg,
        &roots,
        &IngestOpts {
            mode: IngestMode::Replace,
            ..Default::default()
        },
        &mut |_| {},
        &stop,
    );
    assert_eq!(
        replace.removed, 1,
        "replace prunes missing files in each selected root"
    );

    let names: Vec<String> = db
        .connection()
        .prepare("SELECT file_name FROM assets WHERE deleted_at IS NULL ORDER BY file_name")
        .unwrap()
        .query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(names, vec!["b.txt", "c.txt"]);
}

#[test]
fn slow_preparation_emits_heartbeat_while_file_is_active() {
    use std::sync::atomic::AtomicBool;

    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("slow.heartbeat"), b"x").unwrap();
    let mut reg = Registry::new();
    reg.register(SlowHeartbeatExtractor);
    let mut db = Db::open_in_memory_migrated().unwrap();
    let stop = AtomicBool::new(false);
    let mut active_updates = 0usize;

    let report = ingest_folder_with_progress(
        &mut db,
        &reg,
        dir.path(),
        &IngestOpts::default(),
        &mut |p| {
            if !p.active_paths.is_empty() {
                active_updates += 1;
            }
        },
        &stop,
    );

    assert_eq!(report.added, 1);
    assert!(
        active_updates >= 2,
        "start event plus at least one native heartbeat should be visible"
    );
}

#[test]
fn ingest_then_query_then_incremental() {
    let dir = setup_dir();
    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();

    // ── İlk ingest: 4 dosya eklenir ──
    let r1 = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());
    assert_eq!(r1.added, 4, "4 dosya eklenmeli ({:?})", r1.warnings);
    assert_eq!(r1.skipped, 0);
    assert_eq!(r1.failed, 0);
    assert!(
        r1.errors.is_empty(),
        "happy-path: olumcul hata yok → errors bos (#7)"
    );
    // type_counts: 4 farkli uzanti, her biri 1 (4 added). Tum sayilar esit → ext artan sirali.
    assert_eq!(
        r1.type_counts,
        vec![
            ("bin".to_string(), 1),
            ("csv".to_string(), 1),
            ("ifc".to_string(), 1),
            ("txt".to_string(), 1),
        ],
        "type_counts indekslenen 4 uzantiyi saymali (count azalan, ext artan)"
    );

    let conn = db.connection();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM assets", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );

    // FTS body: metin (txt) + IFC proje adi aranabilir.
    let villa: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'villa'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(villa, 1, "txt body 'villa' bulmali");
    let kule: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'kule'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kule, 1, "IFC proje adi 'Kule' FTS body'de");

    // Metadata (EAV): IFC asset'inde schema=IFC4.
    let ifc_id: i64 = conn
        .query_row(
            "SELECT id FROM assets WHERE file_name='model.ifc'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let schema: String = conn
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='schema'",
            params![ifc_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(schema, "IFC4");

    // İcerik hash dolduruldu (fixity).
    let hash: Option<String> = conn
        .query_row(
            "SELECT content_hash FROM assets WHERE id=?1",
            params![ifc_id],
            |r| r.get(0),
        )
        .unwrap();
    assert!(hash.is_some_and(|h| h.len() == 64), "BLAKE3 hash yazilmali");

    // Bilinmeyen ext (.bin) yine indekslendi (metadata'siz).
    let bin_meta: i64 = conn
        .query_row(
            "SELECT count(*) FROM asset_metadata m JOIN assets a ON a.id=m.asset_id
             WHERE a.file_name='arsiv.bin'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(bin_meta, 0, ".bin metadata'siz indekslenmeli");

    // ── İkinci ingest: degisiklik yok → hepsi atlanir ──
    let r2 = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());
    assert_eq!(r2.skipped, 4, "artimsal: degismeyen dosyalar atlanmali");
    assert_eq!(r2.added, 0);
    assert_eq!(r2.updated, 0);
    // Atlananlar type_counts'a girmez (yalniz added + updated).
    assert!(
        r2.type_counts.is_empty(),
        "atlanan dosyalar type_counts'a sayilmamali"
    );

    // ── Bir dosyayi degistir → yalniz o guncellenir ──
    // mtime saniye-cozunurlugu: icerik + (gerekirse) belirgin mtime degisikligi.
    std::thread::sleep(std::time::Duration::from_millis(1100));
    fs::write(dir.path().join("rapor.txt"), b"guncel mimari ofis metni").unwrap();
    let r3 = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());
    assert_eq!(r3.updated, 1, "yalniz degisen dosya guncellenmeli");
    assert_eq!(r3.skipped, 3);
    // Guncellenen dosya (.txt) type_counts'a sayilir; atlananlar sayilmaz.
    assert_eq!(
        r3.type_counts,
        vec![("txt".to_string(), 1)],
        "guncellenen (.txt) type_counts'a girmeli, atlananlar girmemeli"
    );

    // Eski body gitti, yeni body geldi.
    let conn = db.connection();
    let old: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'villa'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let new: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'ofis'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(old, 0, "eski body silinmeli");
    assert_eq!(new, 1, "yeni body aranabilir");
    // Hala 4 asset (cogalmadi).
    assert_eq!(
        conn.query_row("SELECT count(*) FROM assets", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
}

/// **DWG-sekil-arama Dilim 2 — ingest wiring:** DXF cikariminin urettigi sekiller
/// `asset_shapes`'e akitilir. Kapali kare + cember → 2 sekil persist; `searchable_shape_count`
/// metadata'si (2) KORUNUR. Ayni asset'i zorla reindex → replace semantigi (sayi sabit, cift YOK).
#[test]
fn dxf_ingest_persists_shapes_and_reindex_replaces() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("plan.dxf"), DXF_PLAN.as_bytes()).unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();

    let r = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());
    assert_eq!(r.added, 1, "DXF indekslenmeli ({:?})", r.warnings);
    assert_eq!(r.failed, 0);

    let asset_id: i64 = db
        .connection()
        .query_row(
            "SELECT id FROM assets WHERE file_name='plan.dxf'",
            [],
            |row| row.get(0),
        )
        .unwrap();

    // Sekiller asset_shapes'e yazildi (kapali kare + cember = 2).
    let n_shapes = |db: &Db| -> i64 {
        db.connection()
            .query_row(
                "SELECT count(*) FROM asset_shapes WHERE asset_id=?1",
                params![asset_id],
                |row| row.get(0),
            )
            .unwrap()
    };
    assert_eq!(
        n_shapes(&db),
        2,
        "kapali kare + cember → 2 sekil asset_shapes'e yazilmali"
    );

    // searchable_shape_count metadata'si de 2 (hem sayi hem sekiller korundu).
    let meta_count: f64 = db
        .connection()
        .query_row(
            "SELECT value_num FROM asset_metadata WHERE asset_id=?1 AND key='searchable_shape_count'",
            params![asset_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        meta_count as i64, 2,
        "searchable_shape_count metadata korunmali"
    );

    // layer_category DB'de turetildi: DUVAR → DUVAR, PENCERE → PENCERE.
    let cats: Vec<String> = db
        .connection()
        .prepare(
            "SELECT layer_category FROM asset_shapes WHERE asset_id=?1 ORDER BY layer_category",
        )
        .unwrap()
        .query_map(params![asset_id], |row| row.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        cats,
        vec!["DUVAR".to_string(), "PENCERE".to_string()],
        "layer_category turetilmeli"
    );

    // Zorla reindex (skip yok) → set_asset_shapes replace: sayi sabit, cift kayit YOK.
    let paths = vec![dir.path().join("plan.dxf").to_string_lossy().to_string()];
    let rr = reindex_paths(&mut db, &reg, &paths, |_, _| {});
    assert_eq!(rr.reindexed, 1, "DXF yeniden indekslenmeli");
    assert_eq!(
        n_shapes(&db),
        2,
        "reindex replace → sayi sabit (2), cift yok"
    );
}

#[test]
fn image_ingest_persists_thumbnail_and_dominant_colors() {
    let dir = tempfile::tempdir().unwrap();
    // 8×8 kirmizi PNG — ImageExtractor JPEG thumbnail uretmeli.
    let img = image::RgbImage::from_pixel(8, 8, image::Rgb([220, 30, 30]));
    img.save(dir.path().join("kirmizi.png")).unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    let r = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());
    assert_eq!(r.added, 1, "{:?}", r.warnings);

    let id: i64 = db
        .connection()
        .query_row(
            "SELECT id FROM assets WHERE file_name='kirmizi.png'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let thumbs = db.get_thumbnails(&[id]).unwrap();
    assert_eq!(thumbs.len(), 1, "gorsel thumbnail uretmeli");
    assert_eq!(thumbs[0].mime, "image/jpeg");
    assert!(
        !thumbs[0].bytes.is_empty(),
        "thumbnail baytlari dolu olmali"
    );

    // Renk sonucu artik hesaplanip atilmaz: EAV JSON'a yazilir ve AssetRow'da tipli palete doner.
    let raw: String = db
        .connection()
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='dominant_colors'",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    let stored: Vec<archivist_db::DominantColor> = serde_json::from_str(&raw).unwrap();
    assert!(!stored.is_empty(), "baskin renk JSON'u dolu olmali");
    assert!(stored[0].r > 180 && stored[0].g < 70 && stored[0].b < 70);

    let detail = db.get_asset(id).unwrap().unwrap();
    assert_eq!(
        detail.asset.dominant_colors, stored,
        "EAV -> AssetRow paleti tipli okunmali"
    );
}

/// `skip_unchanged=false`: onceden indekslenmis & degismemis bir dosya YENIDEN indekslenir
/// (updated), `=true` ise atlanir (skipped). Panelin "degismeyenleri atla" anahtari bunu yonetir.
#[test]
fn skip_unchanged_false_reindexes_unchanged_file() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("rapor.txt"), b"mimari proje raporu").unwrap();
    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();

    // İlk ingest → 1 added.
    let r1 = ingest_folder(
        &mut db,
        &reg,
        dir.path(),
        &IngestOpts {
            skip_unchanged: true,
            ..Default::default()
        },
    );
    assert_eq!(r1.added, 1, "{:?}", r1.warnings);

    // skip_unchanged=true & dosya degismedi → atlanir.
    let skip = ingest_folder(
        &mut db,
        &reg,
        dir.path(),
        &IngestOpts {
            skip_unchanged: true,
            ..Default::default()
        },
    );
    assert_eq!(
        skip.skipped, 1,
        "degismeyen dosya skip_unchanged=true ile atlanmali"
    );
    assert_eq!(skip.updated, 0);
    assert!(
        skip.type_counts.is_empty(),
        "atlanan dosya type_counts'a girmemeli"
    );

    // skip_unchanged=false & dosya degismedi → YINE yeniden indekslenir (updated).
    let force = ingest_folder(
        &mut db,
        &reg,
        dir.path(),
        &IngestOpts {
            skip_unchanged: false,
            ..Default::default()
        },
    );
    assert_eq!(
        force.updated, 1,
        "skip_unchanged=false degismeyen dosyayi da yeniden indekslemeli"
    );
    assert_eq!(
        force.skipped, 0,
        "skip_unchanged=false hicbir sey atlamamali"
    );
    assert_eq!(
        force.type_counts,
        vec![("txt".to_string(), 1)],
        "yeniden indekslenen dosya type_counts'a sayilmali"
    );

    // Cogalmadi — hala tek asset (re-index, kopya degil).
    assert_eq!(
        db.connection()
            .query_row("SELECT count(*) FROM assets", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
}

/// type_counts: karisik uzantilar (yinelenen ext + uzantisiz dosya → `""`) dogru toplanir;
/// siralama count azalan, esitlikte ext artan. Yalniz indekslenen (added) sayilir.
#[test]
fn type_counts_tally_mixed_extensions_including_no_ext() {
    let dir = tempfile::tempdir().unwrap();
    // 2× txt, 1× csv, 1× uzantisiz dosya ("README").
    fs::write(dir.path().join("a.txt"), b"birinci metin").unwrap();
    fs::write(dir.path().join("b.txt"), b"ikinci metin").unwrap();
    fs::write(dir.path().join("veriler.csv"), b"ad,sehir\nAhmet,Hatay").unwrap();
    fs::write(dir.path().join("README"), b"uzantisiz dosya icerigi").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    let r = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());
    assert_eq!(r.added, 4, "{:?}", r.warnings);

    // Beklenen siralama: txt(2) once (count azalan); sonra count=1 olanlar ext artan: "" < csv.
    assert_eq!(
        r.type_counts,
        vec![
            ("txt".to_string(), 2),
            (String::new(), 1),
            ("csv".to_string(), 1),
        ],
        "type_counts: txt=2 once, sonra count=1 olanlar ext artan (uzantisiz='' < csv)"
    );
}

/// warnings: olumcul-olmayan uyarilar `(yol, mesaj)` cifti olarak tasinir. `.png` uzantili
/// ama bozuk (decode edilemeyen) bir dosya cikarimda uyari uretir; asset yine indekslenir
/// (uyari olumcul DEGIL — ImageExtractor `out.warn(...)` + `Ok` doner).
#[test]
fn warnings_carry_path_and_message() {
    let dir = tempfile::tempdir().unwrap();
    // .png uzantisi → ImageExtractor secilir; icerik gecersiz → decode dusup uyari uretir.
    let bad = dir.path().join("bozuk.png");
    fs::write(&bad, b"BU GECERLI BIR PNG DEGIL").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    let r = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());

    // Asset olumcul-olmayan uyariya ragmen indekslenir (added=1, failed=0).
    assert_eq!(r.added, 1, "uyari olumcul degil — asset yine indekslenmeli");
    assert_eq!(r.failed, 0, "decode uyarisi olumcul olmamali");
    assert!(
        !r.warnings.is_empty(),
        "bozuk .png en az bir uyari uretmeli"
    );
    // #7 ayrim: indekslenen-ama-eksik dosya UYARI'dir, HATA degil → errors bos kalmali.
    assert!(
        r.errors.is_empty(),
        "olumcul-olmayan uyari errors'a girmemeli"
    );
    // Her uyari (yol, mesaj): yol bu dosyaya isaret eder, mesaj bos degil.
    let bad_str = bad.to_string_lossy().to_string();
    for (path, message) in &r.warnings {
        assert_eq!(path, &bad_str, "uyari yolu bozuk dosyaya isaret etmeli");
        assert!(!message.is_empty(), "uyari mesaji bos olmamali");
    }
}

/// **#7 tarama raporu — OLUMCUL hata `errors`'a (uyari DEGIL).** Windows'ta dosyayi paylasimsiz
/// (share_mode 0) acik tutarsak ingest'in stat/hash acisi "sharing violation" alir → dosya
/// indekslenEMEZ. Bu, uyari (indekslendi-ama-eksik) DEGIL, olumcul hatadir → `errors`'a yazilmali;
/// invariant `errors.len() == failed`; `warnings` bos kalir; DB'ye hicbir sey yazilmaz.
#[cfg(windows)]
#[test]
fn fatal_error_lands_in_errors_not_warnings() {
    use std::os::windows::fs::OpenOptionsExt;

    let dir = tempfile::tempdir().unwrap();
    let locked = dir.path().join("kilitli.txt");
    fs::write(&locked, b"icerik").unwrap();
    // Paylasimsiz ac (FILE_SHARE_* = 0) → ingest dosyayi acamaz; handle ingest boyunca canli kalir.
    let _lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&locked)
        .unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    let r = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());

    assert_eq!(r.added, 0, "kilitli dosya indekslenememeli");
    assert_eq!(r.failed, 1, "kilitli dosya olumcul hata saymali");
    // Invariant 2026-07-26'da KELEPCELENDI: `errors` artik `REPORT_MAX_ENTRIES` ile sinirli
    // ornek listesidir → dogru iddia `min(failed, TAVAN)`. `failed` GERCEK toplami tasir.
    assert_eq!(
        r.errors.len(),
        r.failed.min(REPORT_MAX_ENTRIES),
        "her olumcul hata bir errors kaydi (tavana kadar): errors.len()==min(failed,TAVAN)"
    );
    assert!(
        r.warnings.is_empty(),
        "olumcul hata UYARI degil → warnings bos olmali"
    );
    let (path, msg) = &r.errors[0];
    assert!(
        path.ends_with("kilitli.txt"),
        "hata yolu kilitli dosyaya isaret etmeli ({path})"
    );
    assert!(!msg.is_empty(), "hata mesaji bos olmamali");
    assert_eq!(
        db.asset_count().unwrap(),
        0,
        "olumcul hatada DB'ye hicbir sey yazilmamali"
    );
}

/// **Replace modu:** taranan kok yeniden indekslenir; o kok altinda DB'de KAYITLI olup
/// artik DISKTE olmayan dosya COPE atilir (soft-delete; geri-alinabilir). BASKA klasor
/// dokunulmaz (kapsam yalniz taranan kok). report.removed = cope atilan sayisi.
#[test]
fn replace_mode_trashes_missing_files_scoped_to_root() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    fs::write(dir_a.path().join("kalan.txt"), b"kalan dosya").unwrap();
    let gone = dir_a.path().join("silinecek.txt");
    fs::write(&gone, b"diskten silinecek").unwrap();
    fs::write(dir_b.path().join("baska.txt"), b"baska klasor").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();

    // Merge ile her iki klasoru indeksle → 3 aktif asset.
    assert_eq!(
        ingest_folder(&mut db, &reg, dir_a.path(), &IngestOpts::default()).added,
        2
    );
    assert_eq!(
        ingest_folder(&mut db, &reg, dir_b.path(), &IngestOpts::default()).added,
        1
    );
    assert_eq!(db.asset_count().unwrap(), 3);

    // dir_a'dan bir dosyayi DISKTEN sil.
    fs::remove_file(&gone).unwrap();

    // Replace ile YALNIZ dir_a yeniden indekslenir → kaybolan cope atilir.
    let r = ingest_folder(
        &mut db,
        &reg,
        dir_a.path(),
        &IngestOpts {
            skip_unchanged: true,
            mode: IngestMode::Replace,
            ..Default::default()
        },
    );
    assert_eq!(r.removed, 1, "kaybolan 1 dosya cope atilmali");
    assert_eq!(r.added, 0, "yeni dosya yok");
    assert_eq!(r.skipped, 1, "kalan degismeyen dosya atlanir");

    // Aktif = 2 (dir_a/kalan + dir_b/baska); cop = 1 (dir_a/silinecek).
    assert_eq!(db.asset_count().unwrap(), 2);
    assert_eq!(db.trash_count().unwrap(), 1);
    let trashed: Vec<String> = db
        .connection()
        .prepare("SELECT file_name FROM assets WHERE deleted_at IS NOT NULL")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert_eq!(
        trashed,
        vec!["silinecek.txt".to_string()],
        "yalniz silinen dosya cop'te"
    );

    // dir_b DOKUNULMADI (kapsam disinda).
    let b_active: i64 = db
        .connection()
        .query_row(
            "SELECT count(*) FROM assets WHERE deleted_at IS NULL AND file_name='baska.txt'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        b_active, 1,
        "baska klasor replace kapsaminda degil → durmali"
    );
}

/// **Reset modu:** ONCE tum arsiv kalici silinir, SONRA secilen klasor bastan indekslenir.
/// Baska klasorlerin asset'leri de gider (temiz baslangic). report.removed = silinen toplam.
#[test]
fn reset_mode_wipes_entire_archive_then_reingests() {
    let dir_a = tempfile::tempdir().unwrap();
    let dir_b = tempfile::tempdir().unwrap();
    fs::write(dir_a.path().join("a1.txt"), b"a bir").unwrap();
    fs::write(dir_a.path().join("a2.txt"), b"a iki").unwrap();
    fs::write(dir_b.path().join("b1.txt"), b"b bir").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    assert_eq!(
        ingest_folder(&mut db, &reg, dir_a.path(), &IngestOpts::default()).added,
        2
    );
    assert_eq!(
        ingest_folder(&mut db, &reg, dir_b.path(), &IngestOpts::default()).added,
        1
    );
    assert_eq!(db.asset_count().unwrap(), 3);

    // Reset ile dir_a indeksle → tum arsiv (3) silinir, dir_a (2) bastan eklenir.
    let r = ingest_folder(
        &mut db,
        &reg,
        dir_a.path(),
        &IngestOpts {
            skip_unchanged: true,
            mode: IngestMode::Reset,
            ..Default::default()
        },
    );
    assert_eq!(r.removed, 3, "reset oncesi 3 asset kalici silinmeli");
    assert_eq!(
        r.added, 2,
        "dir_a bastan indekslenir (skip_unchanged etkisiz — DB bos)"
    );

    // Aktif = 2 (yalniz dir_a); dir_b'nin asset'i GITTI; cop bos (purge, soft degil).
    assert_eq!(db.asset_count().unwrap(), 2);
    assert_eq!(db.trash_count().unwrap(), 0, "reset purge'tur, cop'e atmaz");
    let b_any: i64 = db
        .connection()
        .query_row(
            "SELECT count(*) FROM assets WHERE file_name='b1.txt'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(b_any, 0, "baska klasorun asset'i reset ile silinmeli");
    assert!(
        db.integrity_ok().unwrap(),
        "reset+reingest sonrasi butunluk korunmali"
    );
}

/// **Es-zamanli cikarim (P2.4):** acik yuksek `concurrency` ile cok dosyali tarama — TUM
/// dosyalar tek seferde dogru indekslenmeli (worker havuzu → seri DB yazimi). Ardindan
/// ikinci tarama HEPSINI atlamali (parmak-izi haritasi worker'larda dogru calismali).
#[test]
fn parallel_extraction_indexes_all_files_and_skips_on_reingest() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    // Worker sayisini asacak kadar dosya → kuyruk/atomik-sayac yolu gercekten denenir.
    const N: usize = 50;
    for i in 0..N {
        fs::write(
            root.join(format!("dosya_{i:03}.txt")),
            format!("mimari icerik {i}"),
        )
        .unwrap();
    }

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();

    // Acik yuksek es-zamanlilik (oto degil) → paralel yol zorlanir.
    let opts = IngestOpts {
        skip_unchanged: true,
        concurrency: 8,
        ..Default::default()
    };
    let r1 = ingest_folder(&mut db, &reg, root, &opts);
    assert_eq!(
        r1.added, N,
        "tum dosyalar paralel cikarimla eklenmeli ({:?})",
        r1.warnings
    );
    assert_eq!(r1.failed, 0, "paralel yolda hata olmamali");
    assert_eq!(
        db.asset_count().unwrap(),
        N as i64,
        "DB'de tam N asset olmali (kayip yok)"
    );
    assert!(
        db.integrity_ok().unwrap(),
        "paralel ingest sonrasi butunluk korunmali"
    );

    // Her dosya tekil (path UNIQUE) — cift-yazim/yaris olmadiginin kaniti.
    let distinct: i64 = db
        .connection()
        .query_row("SELECT count(DISTINCT path) FROM assets", [], |r| r.get(0))
        .unwrap();
    assert_eq!(distinct, N as i64, "her yol tam bir kez yazilmali");

    // Ikinci tarama (yine paralel): degisiklik yok → hepsi atlanir (worker skip karari dogru).
    let r2 = ingest_folder(&mut db, &reg, root, &opts);
    assert_eq!(
        r2.skipped, N,
        "degismeyen dosyalar paralel yolda da atlanmali"
    );
    assert_eq!(r2.added, 0);
    assert_eq!(r2.updated, 0);
}

/// **KAYNAK-YOKLUK KORUMASI (footgun-fix) — Replace, ERISILEMEZ kok:** Bir kok indekslendikten
/// SONRA diskten kaybolursa (yanlis makine / takilmamis disk), Replace prune'u TUM arsivi cope
/// ATMAMALI → REDDEDILMELI, arsiv korunmali. (H2'de yoktu; H3 stabilite kazanimi.)
#[test]
fn replace_on_inaccessible_root_preserves_archive() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("arsiv_kok");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("a.txt"), b"bir").unwrap();
    fs::write(root.join("b.txt"), b"iki").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    assert_eq!(
        ingest_folder(&mut db, &reg, &root, &IngestOpts::default()).added,
        2
    );
    assert_eq!(db.asset_count().unwrap(), 2);

    // Kok diskten kaybolur (baska makine / cikarilan disk simulasyonu).
    fs::remove_dir_all(&root).unwrap();
    assert!(!root.is_dir());

    let r = ingest_folder(
        &mut db,
        &reg,
        &root,
        &IngestOpts {
            skip_unchanged: true,
            mode: IngestMode::Replace,
            ..Default::default()
        },
    );
    assert_eq!(r.removed, 0, "erisilemez kokte prune YAPILMAMALI");
    assert_eq!(
        db.asset_count().unwrap(),
        2,
        "arsiv korunmali (footgun onlendi)"
    );
    assert!(!r.warnings.is_empty(), "koruma uyarisi yazilmali");
    assert!(
        r.warnings.iter().any(|(_, m)| m.contains("erisilemez")),
        "uyari erisilemezligi belirtmeli ({:?})",
        r.warnings
    );
}

/// **Replace, erisilebilir ama BOS kok (DB dolu):** Klasor var ama icindeki dosyalar gitmis +
/// arsivde altinda kayit var → 0-tarama sessiz mass-delete TETIKLEMEMELI (gecici erisim/yanlis
/// olabilir). REDDEDILMELI, arsiv korunmali (bilincli silme icin cop UI'si var).
#[test]
fn replace_empty_scan_with_db_assets_preserves_archive() {
    let base = tempfile::tempdir().unwrap();
    let root = base.path().join("arsiv_kok");
    fs::create_dir(&root).unwrap();
    fs::write(root.join("a.txt"), b"bir").unwrap();
    fs::write(root.join("b.txt"), b"iki").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    assert_eq!(
        ingest_folder(&mut db, &reg, &root, &IngestOpts::default()).added,
        2
    );

    // Dosyalar gider ama klasor erisilebilir kalir (0 dosya taranir).
    fs::remove_file(root.join("a.txt")).unwrap();
    fs::remove_file(root.join("b.txt")).unwrap();
    assert!(root.is_dir());

    let r = ingest_folder(
        &mut db,
        &reg,
        &root,
        &IngestOpts {
            skip_unchanged: true,
            mode: IngestMode::Replace,
            ..Default::default()
        },
    );
    assert_eq!(r.removed, 0, "0-tarama mass-delete tetiklememeli");
    assert_eq!(db.asset_count().unwrap(), 2, "arsiv korunmali");
    assert!(!r.warnings.is_empty(), "koruma uyarisi yazilmali");
}

/// **Reset, ERISILEMEZ kok:** Reset TUM arsivi purge edip koku indeksler. Kok erisilemezse
/// purge sonrasi indeksleme BOS kalir → tum arsiv kaybi. REDDEDILMELI (purge YAPILMAMALI).
#[test]
fn reset_on_inaccessible_root_refuses_and_preserves() {
    let base = tempfile::tempdir().unwrap();
    let live = base.path().join("canli");
    fs::create_dir(&live).unwrap();
    fs::write(live.join("x.txt"), b"veri").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    assert_eq!(
        ingest_folder(&mut db, &reg, &live, &IngestOpts::default()).added,
        1
    );
    assert_eq!(db.asset_count().unwrap(), 1);

    // Reset'i ERISILEMEZ (var olmayan) bir kokle calistir.
    let ghost = base.path().join("yok_olan_kok");
    assert!(!ghost.is_dir());
    let r = ingest_folder(
        &mut db,
        &reg,
        &ghost,
        &IngestOpts {
            skip_unchanged: true,
            mode: IngestMode::Reset,
            ..Default::default()
        },
    );
    assert_eq!(r.removed, 0, "erisilemez kokte purge YAPILMAMALI");
    assert_eq!(
        db.asset_count().unwrap(),
        1,
        "arsiv korunmali (purge reddedildi)"
    );
    assert!(!r.warnings.is_empty(), "REDDEDILDI uyarisi yazilmali");
}

/// **④-C atlanan-sebep yakalama:** walker seviyesinde budanan/atlanan girdiler `skipped_reasons`'a
/// `(yol, kod)` olarak yazilir. Gizli dosya + gizli dizin (alt-agac budandi → bir kez) → 2 kayit,
/// kod `hidden`; budanan dizinin icerigi NE indekslenir NE de ayrica kaydedilir. `skipped`
/// (degismemis) sayisindan AYRI kavram (bu 0 kalir — hicbir dosya "degismemis" degil).
#[test]
fn skipped_reasons_capture_hidden_entries_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::write(root.join("normal.txt"), b"mimari icerik").unwrap();
    fs::write(root.join(".gizli"), b"h").unwrap(); // gizli DOSYA
    fs::create_dir(root.join(".alt")).unwrap(); // gizli DIZIN
    fs::write(root.join(".alt/icerik.txt"), b"z").unwrap(); // budanan alt-agac

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    let r = ingest_folder(&mut db, &reg, root, &IngestOpts::default());

    assert_eq!(
        r.added, 1,
        "yalniz normal.txt indekslenmeli ({:?})",
        r.warnings
    );
    assert_eq!(
        r.skipped, 0,
        "atlanan-sebep, degismemis (skipped) sayisindan ayri"
    );

    let hidden: Vec<&String> = r
        .skipped_reasons
        .iter()
        .filter(|(_, c)| c == "hidden")
        .map(|(p, _)| p)
        .collect();
    assert_eq!(
        hidden.len(),
        2,
        "gizli dosya + gizli dizin yakalanmali (dizin bir kez): {:?}",
        r.skipped_reasons
    );
    assert!(
        r.skipped_reasons.iter().all(|(_, c)| c == "hidden"),
        "tumu 'hidden' kodu olmali"
    );
    assert!(
        !r.skipped_reasons
            .iter()
            .any(|(p, _)| p.ends_with("icerik.txt")),
        "budanan gizli dizinin icerigi ayrica kaydedilmemeli (alt-agac budandi)"
    );
    // Atlananlar total'a girmez → indekslenmedi; DB'de yalniz normal.txt.
    assert_eq!(
        db.asset_count().unwrap(),
        1,
        "atlanan girdiler DB'ye yazilmamali"
    );
}

/// **Oto klasor→proje atamasi — `auto_project=true`:** alt-klasorlu dosyalar klasor adindan
/// turetilen projelere atanir (Villa-A, Ofis-B); ayni klasordekiler AYNI projeye; dogrudan
/// kok-alti dosya PROJESIZ kalir; rapor `auto_assigned` atanan asset sayisini tasir.
#[test]
fn auto_project_assigns_subfolder_files_to_projects() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir(root.join("Villa-A")).unwrap();
    fs::create_dir(root.join("Ofis-B")).unwrap();
    fs::write(root.join("Villa-A/plan.txt"), b"villa plan").unwrap();
    fs::write(root.join("Villa-A/detay.txt"), b"villa detay").unwrap();
    fs::write(root.join("Ofis-B/vaziyet.txt"), b"ofis vaziyet").unwrap();
    fs::write(root.join("okubeni.txt"), b"kok dosya").unwrap(); // dogrudan kok-alti → projesiz

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    let opts = IngestOpts {
        auto_project: true,
        ..Default::default()
    };
    let r = ingest_folder(&mut db, &reg, root, &opts);
    assert_eq!(r.added, 4, "4 dosya eklenmeli ({:?})", r.warnings);
    assert_eq!(r.auto_assigned, 3, "Villa-A(2)+Ofis-B(1)=3 asset atanmali");

    // Iki proje olustu.
    let mut names: Vec<String> = db
        .list_projects()
        .unwrap()
        .into_iter()
        .map(|p| p.name)
        .collect();
    names.sort();
    assert_eq!(names, vec!["Ofis-B".to_string(), "Villa-A".to_string()]);

    // file_name → project_id yardimcisi.
    let pid = |fname: &str| -> Option<i64> {
        db.connection()
            .query_row(
                "SELECT project_id FROM assets WHERE file_name = ?1",
                params![fname],
                |r| r.get(0),
            )
            .unwrap()
    };
    let va = pid("plan.txt");
    assert!(va.is_some(), "Villa-A dosyasi atanmali");
    assert_eq!(pid("detay.txt"), va, "ayni klasor → ayni proje");
    assert!(pid("vaziyet.txt").is_some());
    assert_ne!(pid("vaziyet.txt"), va, "farkli klasor → farkli proje");
    assert_eq!(
        pid("okubeni.txt"),
        None,
        "dogrudan kok-alti dosya projesiz kalmali"
    );
}

/// **`auto_project=false` (varsayilan):** hicbir asset projeye atanmaz, hic proje olusmaz,
/// rapor `auto_assigned=0`. Geriye-uyum: mevcut cagiranlar davranisini korur.
#[test]
fn auto_project_false_assigns_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir(root.join("Villa-A")).unwrap();
    fs::write(root.join("Villa-A/plan.txt"), b"villa plan").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    // Varsayilan opts → auto_project = false.
    let r = ingest_folder(&mut db, &reg, root, &IngestOpts::default());
    assert_eq!(r.added, 1);
    assert_eq!(r.auto_assigned, 0, "auto_project kapali → atama YOK");
    assert!(db.list_projects().unwrap().is_empty(), "proje olusmamali");
    let p: Option<i64> = db
        .connection()
        .query_row(
            "SELECT project_id FROM assets WHERE file_name='plan.txt'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(p, None, "asset projesiz kalmali");
}

/// **Re-scan idempotent + manuel atama korunur:** ilk tarama oto-atar; bir asset ELLE baska
/// projeye tasinir; ikinci tarama (auto_project=true) → kopya proje URETMEZ, yeni atama YAPMAZ
/// (`auto_assigned=0`), elle atamayi EZMEZ.
#[test]
fn auto_project_rescan_idempotent_and_preserves_manual() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    fs::create_dir(root.join("Villa-A")).unwrap();
    fs::write(root.join("Villa-A/a.txt"), b"a icerik").unwrap();
    fs::write(root.join("Villa-A/b.txt"), b"b icerik").unwrap();

    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();
    let opts = IngestOpts {
        auto_project: true,
        ..Default::default()
    };

    let r1 = ingest_folder(&mut db, &reg, root, &opts);
    assert_eq!(r1.auto_assigned, 2, "iki asset Villa-A'ya atanmali");
    assert_eq!(db.list_projects().unwrap().len(), 1, "tek proje (Villa-A)");

    // b.txt'yi ELLE ayri projeye ata.
    let b_id: i64 = db
        .connection()
        .query_row("SELECT id FROM assets WHERE file_name='b.txt'", [], |r| {
            r.get(0)
        })
        .unwrap();
    let manual = db
        .create_project(
            &ProjectInput {
                name: "Manuel".into(),
                ..Default::default()
            },
            1,
        )
        .unwrap();
    db.assign_assets_to_project(&[b_id], Some(manual)).unwrap();

    // Re-scan (auto_project=true) → idempotent + manuel korunur.
    let r2 = ingest_folder(&mut db, &reg, root, &opts);
    assert_eq!(r2.auto_assigned, 0, "hepsi zaten atanmis → yeni atama yok");
    assert_eq!(
        db.list_projects().unwrap().len(),
        2,
        "kopya proje olusmamali (Villa-A + Manuel)"
    );

    let b_pid: Option<i64> = db
        .connection()
        .query_row(
            "SELECT project_id FROM assets WHERE file_name='b.txt'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(b_pid, Some(manual), "elle atama re-scan'de EZILMEMELI");
}

/// **Rapor tavani (§6, 2026-07-26).** Atlanan-girdi listesi `REPORT_MAX_ENTRIES` ile kelepcelenir
/// ve dusen kayit sayisi `dropped_entries`'de RAPORLANIR (sessiz kesme YOK).
///
/// Neden test'li: bu listeler sinirsizdi → milyon-dosyali agacta bellek + dev JSON blob riski
/// (H2'de `SCAN_REPORT_MAX_ENTRIES = 10000` korumasi VARDI, H3'te yoktu). Gercek 10K dosya
/// yaratmak yavas olurdu → tavani DOGRUDAN dogrulamak yerine, kelepcenin **sayaci bozmadigini**
/// ve tam listede `dropped_entries == 0` kaldigini kelepceliyoruz; tavan mantiginin kendisi
/// `push_capped` birim testinde (pipeline modulu) kanitlanir.
#[test]
fn report_lists_are_capped_and_report_dropped_count() {
    let dir = setup_dir();
    let reg = build_registry();
    let mut db = Db::open_in_memory_migrated().unwrap();

    let r = ingest_folder(&mut db, &reg, dir.path(), &IngestOpts::default());
    // Kucuk klasor → tavan ASILMADI: listeler tam, dusen kayit YOK.
    assert_eq!(r.dropped_entries, 0, "tavan asilmadan dusen kayit olmamali");
    assert!(r.warnings.len() <= REPORT_MAX_ENTRIES);
    assert!(r.errors.len() <= REPORT_MAX_ENTRIES);
    assert!(r.skipped_reasons.len() <= REPORT_MAX_ENTRIES);
    // Tavan bir URUN limiti degil ORNEKLEME limiti: gercek sayimlar sayaclarda.
    assert_eq!(r.added, 4, "kelepce sayimi bozmamali");
}
