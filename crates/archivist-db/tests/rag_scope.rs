//! RAG KAPSAM (scope) filtresi — `scope_asset_ids` + `rag_search_with_diag(allowed)` (H2 `RagScope`
//! porti). Sohbet retrieval'i kapsam asset-id kumesine sinirlanir: `All`/None → sinirsiz (tum arsiv,
//! REGRESYONSUZ) · `Ids` → yalniz secili id'ler · `Filter` → FILTER_FRAG facet'ine uyanlar (FTS
//! `query` yok sayilir; vision `AnalysisScope` semantigi). Test-first: kapsam daraltmayi + kapsamsiz
//! yolun degismedigini + facet→id cevirimini + bos-kapsam guvenligini (bos `IN ()` SQL hatasi yok) kanitlar.

use std::collections::HashSet;

use archivist_db::{AnalysisScope, AssetInput, ChunkWrite, Db, IngestData, ListOpts};

fn ingest(db: &mut Db, path: &str, name: &str, ext: &str) -> i64 {
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
            thumbnail: None,
        },
    )
    .expect("ingest")
}

fn unit(hot: usize) -> Vec<f32> {
    let mut v = vec![0f32; 384];
    v[hot] = 1.0;
    v
}

fn cw(index: i64, text: &str, hot: usize) -> ChunkWrite {
    ChunkWrite { chunk_index: index, page: None, text: text.to_string(), embedding: unit(hot) }
}

fn set(ids: &[i64]) -> HashSet<i64> {
    ids.iter().copied().collect()
}

/// `allowed` (Ids kapsami): retrieval yalniz kapsamdaki asset'lerin chunk'larini dondurur. Kapsamsiz
/// (None) her iki asset de gelir → kapsam GERCEKTEN daraltir (FTS JOIN `IN (...)` + kNN post-filtre).
#[test]
fn allowed_limits_retrieval_to_scope() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf", "pdf");
    let b = ingest(&mut db, "/p/b.pdf", "b.pdf", "pdf");
    db.set_asset_chunks(a, &[cw(0, "minare detayi cizimi", 0)]).unwrap();
    db.set_asset_chunks(b, &[cw(0, "minare kesit cizimi", 1)]).unwrap();

    // Kapsamsiz (None): ikisi de gelir (mevcut davranis).
    let (all_hits, _) = db.rag_search_with_diag("minare", &unit(0), 10, &[], false, None).unwrap();
    let all_assets: HashSet<i64> = all_hits.iter().map(|h| h.asset_id).collect();
    assert!(all_assets.contains(&a) && all_assets.contains(&b), "kapsamsiz → ikisi de");

    // Kapsam = {a}: yalniz a'nin chunk'lari (b elenir).
    let scope = set(&[a]);
    let (hits, _) =
        db.rag_search_with_diag("minare", &unit(0), 10, &[], false, Some(&scope)).unwrap();
    assert!(!hits.is_empty(), "kapsamda eslesme var");
    assert!(hits.iter().all(|h| h.asset_id == a), "yalniz kapsam asset'i (b kapsam disi)");
}

/// kNN POST-filtresi izole: sorgu HICBIR chunk metniyle anahtar-kelime eslesmez (saf-semantik) →
/// yalniz kNN dali aday getirir; kapsam o dalda da uygulanir (kapsam disi asset elenir).
#[test]
fn allowed_filters_pure_semantic_knn_path() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf", "pdf");
    let b = ingest(&mut db, "/p/b.pdf", "b.pdf", "pdf");
    // "bulut" hicbir metinde YOK → FTS bos; sorgu vektoru (unit 0) her iki chunk'a da yakin → kNN aday.
    db.set_asset_chunks(a, &[cw(0, "deniz manzarasi", 0)]).unwrap();
    db.set_asset_chunks(b, &[cw(0, "orman yolu", 0)]).unwrap();

    // Kapsamsiz: kNN her iki asset'i de aday yapar.
    let (all_hits, d0) = db.rag_search_with_diag("bulut", &unit(0), 10, &[], false, None).unwrap();
    assert_eq!(d0.fts_candidates, 0, "'bulut' icin FTS adayi yok (saf-semantik)");
    assert!(all_hits.len() >= 2, "kNN kapsamsiz iki asset'i getirir");

    // Kapsam = {a}: kNN post-filtresi b'yi eler.
    let scope = set(&[a]);
    let (hits, _) =
        db.rag_search_with_diag("bulut", &unit(0), 10, &[], false, Some(&scope)).unwrap();
    assert!(hits.iter().all(|h| h.asset_id == a), "kNN dalinda da kapsam disi elenir");
}

/// `scope_asset_ids(Filter)`: FILTER_FRAG facet'ine (ext) uyan aktif id'ler; FTS `query` YOK SAYILIR.
/// Donen kume retrieval'i o facet'e sinirlar.
#[test]
fn filter_scope_maps_to_ids_and_limits_retrieval() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let pdf = ingest(&mut db, "/p/a.pdf", "a.pdf", "pdf");
    let dwg = ingest(&mut db, "/p/b.dwg", "b.dwg", "dwg");
    db.set_asset_chunks(pdf, &[cw(0, "kolon detayi", 0)]).unwrap();
    db.set_asset_chunks(dwg, &[cw(0, "kolon plani", 1)]).unwrap();

    let scope = AnalysisScope::Filter(Box::new(ListOpts {
        ext: vec!["pdf".into()],
        // FTS query dolu olsa bile YOK SAYILIR (facet-tabanli kapsam) — sonucu degistirmez.
        query: Some("alakasiz-arama-terimi".into()),
        ..Default::default()
    }));
    let ids = db.scope_asset_ids(&scope).unwrap().expect("Filter → Some(id kumesi)");
    assert_eq!(ids, vec![pdf], "yalniz pdf facet'e uyar (FTS query yok sayilir)");

    let scope_set: HashSet<i64> = ids.into_iter().collect();
    let (hits, _) =
        db.rag_search_with_diag("kolon", &unit(0), 10, &[], false, Some(&scope_set)).unwrap();
    assert!(!hits.is_empty());
    assert!(hits.iter().all(|h| h.asset_id == pdf), "dwg kapsam disi (facet)");
}

/// `Filter` kapsami cop'teki (soft-delete) asset'i DISLAR (FILTER_FRAG `deleted_at IS NULL`).
#[test]
fn filter_scope_excludes_trashed() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf", "pdf");
    let b = ingest(&mut db, "/p/b.pdf", "b.pdf", "pdf");
    db.soft_delete(&[b]).unwrap();

    let scope =
        AnalysisScope::Filter(Box::new(ListOpts { ext: vec!["pdf".into()], ..Default::default() }));
    let ids = db.scope_asset_ids(&scope).unwrap().unwrap();
    assert_eq!(ids, vec![a], "cop'teki b dislanir");
}

/// `All` → `None` (sinirsiz); None gecildiginde retrieval bugunku davranisla AYNI (regresyonsuz).
#[test]
fn all_scope_is_none_and_regressionless() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf", "pdf");
    let b = ingest(&mut db, "/p/b.pdf", "b.pdf", "pdf");
    db.set_asset_chunks(a, &[cw(0, "merdiven detayi", 0)]).unwrap();
    db.set_asset_chunks(b, &[cw(0, "merdiven kesiti", 1)]).unwrap();

    assert!(db.scope_asset_ids(&AnalysisScope::All).unwrap().is_none(), "All → None (sinirsiz)");

    let (hits, _) = db.rag_search_with_diag("merdiven", &unit(0), 10, &[], false, None).unwrap();
    let assets: HashSet<i64> = hits.iter().map(|h| h.asset_id).collect();
    assert!(assets.contains(&a) && assets.contains(&b), "None → tum arsiv (regresyonsuz)");
}

/// Bos kapsam guvenligi: `Ids([])` → `Some(bos)` (cagiran erken doner); `rag_search_with_diag` bos
/// kume gecilse bile bos `IN ()` SQL hatasi ATMADAN bos doner (savunmaci `1=0` + kNN post-filtre).
#[test]
fn empty_scope_returns_no_hits_without_sql_error() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf", "pdf");
    db.set_asset_chunks(a, &[cw(0, "minare detayi", 0)]).unwrap();

    // Ids([]) → Some(bos).
    assert_eq!(db.scope_asset_ids(&AnalysisScope::Ids(vec![])).unwrap(), Some(vec![]));

    // Bos kume → hicbir chunk; SQL hatasi yok.
    let empty: HashSet<i64> = HashSet::new();
    let (hits, _) =
        db.rag_search_with_diag("minare", &unit(0), 10, &[], false, Some(&empty)).unwrap();
    assert!(hits.is_empty(), "bos kapsam → hicbir chunk (SQL hatasi yok)");
}
