//! Part B: AI-analiz KAPSAMI (`AnalysisScope` + scoped bekleyen sorgulari).
//!
//! Olcek gerekcesi: arsiv milyonlara cikacak → blanket "hepsini analiz et" pahali. Kullanici
//! yalniz bir SECIM (`Ids`) veya FILTRE (`Filter`: klasor/proje/uzanti...) analiz edebilsin.
//! Bu testler: kapsam daraltmayi kanitlar + blanket kosullarin (thumbnail var · analizsiz ·
//! vision-skip'siz · cop disi) HER kapsamda korundugunu + count==enumerasyon tutarliligini dogrular.
//!
//! Test-first: once yazildi, sonra `*_scoped` metodlari + `AnalysisScope` yesile getirdi.

use archivist_db::{AnalysisScope, AssetInput, Db, IndexStage, IngestData, ListOpts, ThumbnailInput};
use rusqlite::params;

/// Thumbnail'i OLAN bir gorsel-asset ingest et (analiz kapsamina girer). id doner.
fn seed(db: &mut Db, path: &str, name: &str, ext: &str) -> i64 {
    let bytes = [1u8, 2, 3, 4];
    db.ingest(
        &AssetInput {
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
        },
        &IngestData {
            fts_body: None,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: Some(ThumbnailInput { mime: "image/jpeg", width: 8, height: 8, bytes: &bytes }),
        },
    )
    .expect("ingest")
}

/// Thumbnail'SIZ asset (analiz kapsami DISI — thumbnail gorsel-analizin girdisi).
fn seed_no_thumb(db: &mut Db, path: &str, name: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some("jpg"),
            size_bytes: 10,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: 1,
            modified_at: 1,
        },
        &IngestData { fts_body: None, metadata: &[], auto_tags: &[], phash: None, thumbnail: None },
    )
    .expect("ingest")
}

/// `Ids` kapsami: yalniz secili id'ler; digerleri (blanket'te uygun olsa da) haric. Bos → 0/bos.
#[test]
fn ids_scope_limits_to_selection() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&mut db, r"C:\p\a.jpg", "a.jpg", "jpg");
    let b = seed(&mut db, r"C:\p\b.jpg", "b.jpg", "jpg");
    let c = seed(&mut db, r"C:\p\c.jpg", "c.jpg", "jpg");

    // Blanket → 3.
    assert_eq!(db.pending_analysis_count().unwrap(), 3);

    // Ids([a,c]) → yalniz 2 (b haric).
    let scope = AnalysisScope::Ids(vec![a, c]);
    assert_eq!(db.pending_analysis_count_scoped(&scope).unwrap(), 2);
    let ids: Vec<i64> =
        db.assets_without_analysis_scoped(&scope, 0, 10).unwrap().iter().map(|p| p.id).collect();
    assert_eq!(ids, vec![a, c], "yalniz secili id'ler (ORDER BY a.id)");
    assert!(!ids.contains(&b));

    // Bos Ids → 0 / bos (bos `IN ()` SQL hatasi yok — erken don).
    let empty = AnalysisScope::Ids(vec![]);
    assert_eq!(db.pending_analysis_count_scoped(&empty).unwrap(), 0);
    assert!(db.assets_without_analysis_scoped(&empty, 0, 10).unwrap().is_empty());
}

/// `Filter` kapsami — yol-onek (path prefix), KARDES-onek guvenli: `C:\Proj` ile `C:\Projeler`
/// AYRISIR (ayracli onek kardes klasoru karistirmaz; folders test deseni).
#[test]
fn filter_scope_path_prefix_sibling_safe() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let v1 = seed(&mut db, r"C:\Proj\villa\1.jpg", "1.jpg", "jpg");
    let v2 = seed(&mut db, r"C:\Proj\villa\sub\2.jpg", "2.jpg", "jpg"); // alt-dizin de dahil
    let ofis = seed(&mut db, r"C:\Proj\ofis\3.jpg", "3.jpg", "jpg");
    let _sibling = seed(&mut db, r"C:\Projeler\x.jpg", "x.jpg", "jpg"); // KARDES → karismamali

    // "C:\Proj\villa" → yalniz villa alti (v1,v2); ofis + Projeler haric.
    let villa = AnalysisScope::Filter(Box::new(ListOpts {
        path_prefix: Some(r"C:\Proj\villa".to_string()),
        ..Default::default()
    }));
    assert_eq!(db.pending_analysis_count_scoped(&villa).unwrap(), 2);
    let mut ids: Vec<i64> =
        db.assets_without_analysis_scoped(&villa, 0, 10).unwrap().iter().map(|p| p.id).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec![v1, v2]);

    // Kardes-onek guvenligi: "C:\Proj\" (ayracli) → Proj alti (villa+sub+ofis = 3), Projeler HARIC.
    let proj_root = AnalysisScope::Filter(Box::new(ListOpts {
        path_prefix: Some(r"C:\Proj\".to_string()),
        ..Default::default()
    }));
    assert_eq!(
        db.pending_analysis_count_scoped(&proj_root).unwrap(),
        3,
        "Proj alti; kardes C:\\Projeler ayrisir"
    );
    let root_ids: Vec<i64> = db
        .assets_without_analysis_scoped(&proj_root, 0, 10)
        .unwrap()
        .iter()
        .map(|p| p.id)
        .collect();
    assert!(root_ids.contains(&ofis) && !root_ids.contains(&_sibling));
}

/// `Filter` kapsami — uzanti (ext) ve proje (project_id) facet'leri; FTS `query` yok sayilir.
#[test]
fn filter_scope_ext_and_project() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let jpg = seed(&mut db, r"C:\a\1.jpg", "1.jpg", "jpg");
    let png = seed(&mut db, r"C:\a\2.png", "2.png", "png");
    let _dwg = seed(&mut db, r"C:\a\3.dwg", "3.dwg", "dwg");

    // ext=[jpg,png] → 2 (dwg haric).
    let ext_scope = AnalysisScope::Filter(Box::new(ListOpts {
        ext: vec!["jpg".into(), "png".into()],
        // FTS query dolu olsa bile YOK SAYILIR (facet-tabanli kapsam) — sonucu degistirmez.
        query: Some("alakasiz-arama-terimi".into()),
        ..Default::default()
    }));
    assert_eq!(db.pending_analysis_count_scoped(&ext_scope).unwrap(), 2, "ext facet; FTS query yok sayilir");
    let mut ids: Vec<i64> = db
        .assets_without_analysis_scoped(&ext_scope, 0, 10)
        .unwrap()
        .iter()
        .map(|p| p.id)
        .collect();
    ids.sort_unstable();
    assert_eq!(ids, vec![jpg, png]);

    // Proje filtresi: proje olustur + jpg'yi ata → project=[pid] → yalniz jpg.
    db.connection()
        .execute("INSERT INTO projects(id, name, created_at) VALUES (1, 'Villa', 1)", [])
        .unwrap();
    db.connection()
        .execute("UPDATE assets SET project_id = 1 WHERE id = ?1", params![jpg])
        .unwrap();
    let proj_scope =
        AnalysisScope::Filter(Box::new(ListOpts { project: vec![1], ..Default::default() }));
    assert_eq!(db.pending_analysis_count_scoped(&proj_scope).unwrap(), 1);
    assert_eq!(db.assets_without_analysis_scoped(&proj_scope, 0, 10).unwrap()[0].id, jpg);
}

/// Blanket kosullar HER kapsamda korunur: analizli / thumbnail'siz / vision-skip'li asset,
/// kapsam onlari ISTESE bile, bekleyen kumesine GIRMEZ (kapsam yalniz DARALTIR, gevsetmez).
#[test]
fn analyzed_thumbless_skipped_excluded_in_all_scopes() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let analyzed = seed(&mut db, r"C:\a\1.jpg", "1.jpg", "jpg");
    let skipped = seed(&mut db, r"C:\a\2.jpg", "2.jpg", "jpg");
    let ok = seed(&mut db, r"C:\a\3.jpg", "3.jpg", "jpg");
    let thumbless = seed_no_thumb(&mut db, r"C:\a\4.jpg", "4.jpg");

    db.set_ai_metadata(analyzed, &[("ai_aciklama", "x".to_string())]).unwrap(); // ai_analyzed marker
    db.record_index_skip(skipped, IndexStage::Vision, "ollama").unwrap(); // vision-skip

    // Blanket: yalniz `ok` (analyzed/skipped/thumbless haric).
    assert_eq!(db.pending_analysis_count().unwrap(), 1);
    assert_eq!(db.assets_without_analysis(0, 10).unwrap()[0].id, ok);

    // Ids kapsami DORDUNU de istese bile blanket kosullar korunur → yalniz `ok`.
    let scope = AnalysisScope::Ids(vec![analyzed, skipped, ok, thumbless]);
    assert_eq!(
        db.pending_analysis_count_scoped(&scope).unwrap(),
        1,
        "kapsam blanket kosullari GEVSETMEZ"
    );
    let ids: Vec<i64> =
        db.assets_without_analysis_scoped(&scope, 0, 10).unwrap().iter().map(|p| p.id).collect();
    assert_eq!(ids, vec![ok]);
}

/// count == batch-enumerasyon sayisi (ayni WHERE → tutarlilik); cursor sayfalama dogru ilerler.
#[test]
fn scoped_count_matches_enumeration() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let mut all = Vec::new();
    for i in 0..5 {
        all.push(seed(&mut db, &format!(r"C:\a\{i}.jpg"), &format!("{i}.jpg"), "jpg"));
    }
    // Birini analiz et → pending < total (kapsam ve blanket kosulun BIRLIKTE calistigi kanit).
    db.set_ai_metadata(all[1], &[("ai_aciklama", "x".to_string())]).unwrap();

    let scope =
        AnalysisScope::Filter(Box::new(ListOpts { ext: vec!["jpg".into()], ..Default::default() }));
    let count = db.pending_analysis_count_scoped(&scope).unwrap();

    // Cursor ile 2'serli batch enumerasyon.
    let (mut enumerated, mut after) = (0i64, 0i64);
    loop {
        let batch = db.assets_without_analysis_scoped(&scope, after, 2).unwrap();
        if batch.is_empty() {
            break;
        }
        enumerated += batch.len() as i64;
        after = batch.last().unwrap().id;
    }
    assert_eq!(count, enumerated, "count == batch enumerasyon (tutarlilik)");
    assert_eq!(count, 4, "5 - 1 analizli = 4");
}
