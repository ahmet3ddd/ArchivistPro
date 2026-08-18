//! RAG retrieval (Artim 3) entegrasyon testleri — model-bagimsiz (unit vektor): keyword-gate
//! (birebir terim garanti), cop dislama, asset-basi cesitlilik kelepcesi.

use std::collections::HashSet;

use archivist_db::{AssetInput, ChunkWrite, Db, IngestData};

fn ingest(db: &mut Db, path: &str, name: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some("pdf"),
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

/// Govde metinli ingest (assets_fts dolu) — hassasiyet anahtar-kelime testi icin.
fn ingest_body(db: &mut Db, path: &str, name: &str, body: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some("pdf"),
            size_bytes: 10,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: 1,
            modified_at: 1,
        },
        &IngestData {
            fts_body: Some(body),
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

/// Govde + ext parametreli ingest (dosya-turu ipucu testi icin).
fn ingest_body_ext(db: &mut Db, path: &str, name: &str, ext: &str, body: &str) -> i64 {
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
            fts_body: Some(body),
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

/// Keyword-gate: sorgunun birebir terimini gecen chunk, semantik olarak UZAK olsa bile
/// sonuca (ust sira) GARANTI girer. Halusinasyon onleme kanIti.
#[test]
fn keyword_gate_guarantees_exact_term_chunk() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf");
    let b = ingest(&mut db, "/p/b.pdf", "b.pdf");
    db.set_asset_chunks(a, &[cw(0, "minare detayi cizimi", 0)]).unwrap();
    db.set_asset_chunks(b, &[cw(0, "zemin kat plani", 1)]).unwrap();

    // Sorgu vektoru her iki chunk'tan da UZAK (unit 9); ama metin "minare" iceriyor.
    let hits = db.rag_search("minare", &unit(9), 10).unwrap();
    assert!(!hits.is_empty(), "en az gated chunk donmeli");
    assert_eq!(hits[0].asset_id, a, "minare geceni gate ust siraya tasimali");
    assert_eq!(hits[0].score, 1.0, "gated isabet skoru 1.0 taban");
    assert!(hits[0].text.contains("minare"));
}

/// Cope atilmis asset'in chunk'lari retrieval'a sizmamali.
#[test]
fn trashed_asset_chunks_excluded() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf");
    db.set_asset_chunks(a, &[cw(0, "minare detayi", 0)]).unwrap();

    // Once bulunur.
    assert!(!db.rag_search("minare", &unit(0), 10).unwrap().is_empty());

    // Cope at → artik gelmemeli (FTS hem kNN dali aktif-filtreli).
    db.soft_delete(&[a]).unwrap();
    let hits = db.rag_search("minare", &unit(0), 10).unwrap();
    assert!(hits.iter().all(|h| h.asset_id != a), "cop'teki asset chunk'i sizmamali");
}

/// Asset-basi cesitlilik: tek asset'in cok chunk'i eslesir ama en fazla MAX_CHUNKS_PER_ASSET (3).
#[test]
fn diversity_cap_limits_chunks_per_asset() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf");
    // 6 chunk, hepsi "kolon" iceriyor (hepsi gated aday).
    let chunks: Vec<ChunkWrite> =
        (0..6).map(|i| cw(i, &format!("kolon detayi {i}"), i as usize)).collect();
    db.set_asset_chunks(a, &chunks).unwrap();

    let hits = db.rag_search("kolon", &unit(0), 10).unwrap();
    let from_a = hits.iter().filter(|h| h.asset_id == a).count();
    assert!(from_a <= 3, "asset basina en fazla 3 chunk ({from_a} dondu)");
    assert!(from_a >= 1);
}

/// Retrieve tani (A5): token/aday/gate/donen sayilari + mimari sozluk genisletmesi.
#[test]
fn diag_reports_tokens_candidates_and_expansion() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf");
    let b = ingest(&mut db, "/p/b.pdf", "b.pdf");
    db.set_asset_chunks(a, &[cw(0, "merdiven detayi cizimi", 0)]).unwrap();
    // "stair" iceren chunk: merdiven SORGUSU sozluk genislemesiyle (merdiven→stair) aday olur.
    db.set_asset_chunks(b, &[cw(0, "concrete stair section", 5)]).unwrap();

    let (hits, diag) = db.rag_search_with_diag("merdiven", &unit(9), 10, &[], false, None).unwrap();
    assert_eq!(diag.query_tokens, vec!["merdiven".to_string()], "anlamli token raporlanir");
    assert!(diag.expanded_tokens > 0, "mimari sozluk merdiven→stair... eklemeli");
    assert!(diag.fts_candidates >= 1, "FTS aday sayisi raporlanir");
    assert_eq!(diag.returned, hits.len() as i64, "returned = donen isabet sayisi");
    assert!(diag.gated >= 1, "merdiven geceni keyword-gate'e girer");
    // Genisletme sayesinde 'stair'-li chunk da aday havuzuna girer (FTS adayi >= 2).
    assert!(diag.fts_candidates >= 2, "sozluk genislemesi 'stair' chunk'ini da aday yapar");
}

/// LLM query-rewrite (A3) ek terimleri YALNIZ FTS aday havuzunu buyutur; keyword-gate orijinal
/// token'da kalir. "asansor" sozlukte YOK → static genisleme yok → ek-terim etkisi izole edilir.
#[test]
fn extra_fts_terms_widen_candidates_not_gate() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf");
    let b = ingest(&mut db, "/p/b.pdf", "b.pdf");
    db.set_asset_chunks(a, &[cw(0, "asansor detayi", 0)]).unwrap();
    db.set_asset_chunks(b, &[cw(0, "freight lift shaft", 5)]).unwrap();

    let (_no, d_no) = db.rag_search_with_diag("asansor", &unit(9), 10, &[], false, None).unwrap();
    let (_yes, d_yes) =
        db.rag_search_with_diag("asansor", &unit(9), 10, &["lift".to_string()], false, None).unwrap();

    assert!(d_yes.fts_candidates > d_no.fts_candidates, "ek terim 'lift' aday havuzunu buyutur");
    assert_eq!(d_yes.query_tokens, vec!["asansor".to_string()], "gate yalniz orijinal token");
    assert_eq!(d_no.expanded_tokens, 0, "sozlukte olmayan terim → static genisleme yok");
}

/// Liste-niyeti (keyword_only): saf-semantik isabetler liste cevabina SIZMAZ. Anahtar-kelime
/// eslesmesi yoksa keyword_only bos doner (yaniltici "N dosya bulundu" onlenir — or. gorsel-icerik
/// sorusu metin RAG'de bos kalmali). Kullanici bulgusu: "bulutlu gorsel var mi" → 12 alakasiz gorsel.
#[test]
fn keyword_only_excludes_pure_semantic() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf");
    db.set_asset_chunks(a, &[cw(0, "deniz manzarasi", 0)]).unwrap();

    // "bulut" hicbir chunk metninde YOK ama sorgu vektoru 0. boyuta yakin → semantik aday gelir.
    let qvec = unit(0);
    // keyword_only KAPALI (rag yolu): semantik aday doner (>0).
    let (sem, _d1) = db.rag_search_with_diag("bulut", &qvec, 10, &[], false, None).unwrap();
    assert!(!sem.is_empty(), "keyword_only kapali → semantik aday doner (rag yolu)");
    // keyword_only ACIK (liste yolu): anahtar-kelime eslesmesi yok → BOS.
    let (kw, d2) = db.rag_search_with_diag("bulut", &qvec, 10, &[], true, None).unwrap();
    assert!(kw.is_empty(), "keyword_only → pure-semantik dislanir, liste bos doner");
    assert_eq!(d2.fts_candidates, 0, "'bulut' icin FTS adayi yok");
    assert!(d2.knn_candidates > 0, "ama semantik aday var (teshis bunu seffaf gosterir)");
}

/// Hassasiyet (A1) MANUEL disla: isaretli asset'in parcalari rag_search'e GELMEZ; dahil edince
/// geri gelir. is_rag_excluded durumu yansitir.
#[test]
fn manual_rag_exclude_hides_and_restores() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf");
    db.set_asset_chunks(a, &[cw(0, "minare detayi", 0)]).unwrap();

    assert!(!db.rag_search("minare", &unit(0), 10).unwrap().is_empty(), "once bulunur");
    assert!(!db.is_rag_excluded(a).unwrap());

    assert_eq!(db.set_rag_excluded(&[a], true).unwrap(), 1);
    assert!(db.is_rag_excluded(a).unwrap());
    assert!(db.rag_search("minare", &unit(0), 10).unwrap().is_empty(), "dislanan asset gelmemeli");

    db.set_rag_excluded(&[a], false).unwrap();
    assert!(!db.rag_search("minare", &unit(0), 10).unwrap().is_empty(), "dahil edilince geri gelir");
}

/// Hassasiyet (A1) OTO-tespit: anahtar-kelime govde metninde gecen asset id'leri bulunur.
#[test]
fn keyword_match_finds_sensitive_assets() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let s = ingest_body(&mut db, "/p/s.pdf", "s.pdf", "bu belge gizli sozlesme metni icerir");
    let _o = ingest_body(&mut db, "/p/o.pdf", "o.pdf", "villa cephe plani");

    let hits = db.assets_matching_keywords(&["gizli".to_string()]).unwrap();
    assert_eq!(hits, vec![s], "yalniz 'gizli' iceren asset");
    // Cok-kelimeli kw (FTS phrase) + birden cok kw (OR).
    let multi = db
        .assets_matching_keywords(&["sozlesme".to_string(), "fatura".to_string()])
        .unwrap();
    assert!(multi.contains(&s), "phrase/OR eslesmesi");
    // Bos kw → bos (hicbir sey dislanmaz).
    assert!(db.assets_matching_keywords(&[]).unwrap().is_empty());
}

/// Bos sorgu / eslesmeyen → bos sonuc (panik yok). Yanlis vektor boyutu → hata.
#[test]
fn empty_and_dim_guard() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest(&mut db, "/p/a.pdf", "a.pdf");
    db.set_asset_chunks(a, &[cw(0, "minare", 0)]).unwrap();

    // Anlamli token yok + vektor hicbir s=eye yakin degil → kNN yine de adaylari getirir;
    // ama "xyz" hicbir chunk'ta yok → gated bos; kNN tek aday → donebilir. Sadece panik yok kontrolu.
    let _ = db.rag_search("", &unit(0), 10).unwrap();

    assert!(matches!(
        db.rag_search("minare", &[0.0; 10], 10),
        Err(archivist_db::DbError::Invalid(_))
    ));
}

// ── Liste-niyeti asset-seviyesi arama (GERCEK TOPLAM, H2 "toplam N" davranis pariti) ──────────

/// Toplam eslesme, gosterim tavanindan (limit) BAGIMSIZ dogru sayilir; `items` limit'te kelepceli.
/// H2 "…N dosya bulundu (ilk M gösteriliyor)" pariti — kesin sayi kesme oncesi COUNT'tan gelir.
#[test]
fn list_intent_search_reports_true_total_and_caps_display() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // 7 dosya, hepsi GOVDESINDE "kolon" (dosya adinda degil) — govde (assets_fts.body) taranmali.
    for i in 0..7 {
        ingest_body(&mut db, &format!("/p/f{i}.pdf"), &format!("f{i}.pdf"), "betonarme kolon detayi");
    }
    let page = db.list_intent_search("kolon nerede", None, None, &HashSet::new(), 3).unwrap().unwrap();
    assert_eq!(page.total, 7, "gercek toplam gosterim tavanindan bagimsiz");
    assert_eq!(page.items.len(), 3, "gosterim limit'te kelepceli");
}

/// Toplam <= limit → kesin sayi + tum satirlar; hem dosya-ADI hem belge-GOVDESI eslesir (assets_fts
/// tek MATCH ikisini de kapsar); alakasiz dosya sayilmaz.
#[test]
fn list_intent_search_counts_name_and_body_excludes_unrelated() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    ingest(&mut db, "/p/cephe_detay.pdf", "cephe_detay.pdf"); // ADINDA "cephe"
    ingest_body(&mut db, "/p/x.pdf", "x.pdf", "on cephe kaplamasi"); // GOVDESINDE "cephe"
    ingest_body(&mut db, "/p/y.pdf", "y.pdf", "zemin kat plani"); // alakasiz
    let page =
        db.list_intent_search("cephe hangi dosyada", None, None, &HashSet::new(), 50).unwrap().unwrap();
    assert_eq!(page.total, 2, "ad + govde eslesmeleri sayilir, alakasiz haric");
    assert_eq!(page.items.len(), 2);
}

/// Kapsam (allowed) toplami sinirlar; kapsam disi dosya sayilmaz. Bos kapsam → savunmaci 0-sonuc.
#[test]
fn list_intent_search_scope_restricts_total() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_body(&mut db, "/p/a.pdf", "a.pdf", "villa cephe");
    let _b = ingest_body(&mut db, "/p/b.pdf", "b.pdf", "villa bahce");
    let allowed: HashSet<i64> = [a].into_iter().collect();
    let page =
        db.list_intent_search("villa nerede", None, Some(&allowed), &HashSet::new(), 50).unwrap().unwrap();
    assert_eq!(page.total, 1, "yalniz kapsam-ici dosya");
    assert_eq!(page.items[0].id, a);
    // Bos kapsam → `1=0` → sonuc yok (bos `IN ()` SQL hatasi degil).
    let empty = HashSet::new();
    let none = db.list_intent_search("villa", None, Some(&empty), &HashSet::new(), 50).unwrap().unwrap();
    assert_eq!(none.total, 0);
}

/// `rag_excluded` (manuel disla) + hassasiyet (oto-disla) dosyalar liste toplamina GIRMEZ.
#[test]
fn list_intent_search_excludes_rag_excluded_and_sensitive() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_body(&mut db, "/p/a.pdf", "a.pdf", "gizli sozlesme metni");
    let b = ingest_body(&mut db, "/p/b.pdf", "b.pdf", "gizli rapor metni");
    // Ikisi de "gizli" → normalde total 2.
    let all = db.list_intent_search("gizli", None, None, &HashSet::new(), 50).unwrap().unwrap();
    assert_eq!(all.total, 2);
    // a'yi RAG'den manuel disla → total 1 (b kalir).
    db.set_rag_excluded(&[a], true).unwrap();
    let after = db.list_intent_search("gizli", None, None, &HashSet::new(), 50).unwrap().unwrap();
    assert_eq!(after.total, 1);
    assert_eq!(after.items[0].id, b);
    // b'yi hassasiyetle disla → total 0 (a zaten rag_excluded).
    let sens: HashSet<i64> = [b].into_iter().collect();
    let sensitive = db.list_intent_search("gizli", None, None, &sens, 50).unwrap().unwrap();
    assert_eq!(sensitive.total, 0);
}

/// Anlamli token yoksa (yalniz stop-word / <3 harf) → `None` (cagiran chunk/RAG yoluna duser;
/// H2 da `null` donerdi). "var mı" / "hangi dosyada" gibi salt niyet-isaretcileri.
#[test]
fn list_intent_search_none_without_significant_tokens() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    ingest_body(&mut db, "/p/a.pdf", "a.pdf", "villa");
    assert!(db.list_intent_search("var mı", None, None, &HashSet::new(), 50).unwrap().is_none());
    assert!(db.list_intent_search("hangi dosyada", None, None, &HashSet::new(), 50).unwrap().is_none());
}

/// Cok-token: TUM anlamli token'lar gecmeli (implicit AND, Gezgin birincil aramasiyla ayni) —
/// yalniz birini iceren dosya sayilmaz.
#[test]
fn list_intent_search_requires_all_tokens() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let both = ingest_body(&mut db, "/p/both.pdf", "both.pdf", "merdiven korkuluk detayi");
    let _one = ingest_body(&mut db, "/p/one.pdf", "one.pdf", "merdiven basamak");
    let page = db
        .list_intent_search("merdiven korkuluk hangi dosyada", None, None, &HashSet::new(), 50)
        .unwrap()
        .unwrap();
    assert_eq!(page.total, 1, "yalniz her iki terimi de iceren dosya");
    assert_eq!(page.items[0].id, both);
}

/// ⚠️ REGRESYON (2026-07-27 canli bulgu): dogal-dil soru, bare kelimeyle AYNI toplami vermeli
/// (Gezgin ile tutarli). Onceden "dosyalarda" anlamli token sanildigi icin `"minare" AND
/// "dosyalarda"` → 0 → sozluk fallback geniş OR → alakasiz dosyalar sayiliyordu (sohbet 37,
/// Gezgin 3). Decoy: yalniz "dosyalarda" iceren alakasiz dosya — eski hatada nat toplamina girerdi.
#[test]
fn list_intent_search_natural_language_matches_bare_keyword() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    ingest(&mut db, "/p/oxford-minare.dwg", "oxford-minare.dwg"); // minare (dosya adi)
    ingest_body(&mut db, "/p/x.pdf", "x.pdf", "minare kesit detayi"); // minare (govde)
    // Decoy: "dosyalarda" gecen ama "minare" GECMEYEN alakasiz dosya.
    let _d = ingest_body(&mut db, "/p/decoy.pdf", "decoy.pdf", "bu bilgi birden cok dosyalarda gecer");
    let bare = db.list_intent_search("minare", None, None, &HashSet::new(), 50).unwrap().unwrap();
    let nat =
        db.list_intent_search("minare hangi dosyalarda var", None, None, &HashSet::new(), 50).unwrap().unwrap();
    assert_eq!(bare.total, 2, "yalniz 2 minare dosyasi (decoy haric)");
    assert_eq!(
        nat.total, bare.total,
        "dogal-dil soru = bare kelime; soru/meta sozcukleri anlamli token OLMAMALI (Gezgin tutarli)"
    );
}

/// Sozluk (ARCH_SYNONYMS) fallback: kesin terim HIC yoksa (total 0) es-anlamli ile bulunur — ama
/// yalniz o zaman (tam eslesmeleri kirletmez). "merdiven" govdede yok, "stair" var → fallback bulur.
#[test]
fn list_intent_search_synonym_fallback_only_when_zero() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let s = ingest_body(&mut db, "/p/s.pdf", "s.pdf", "concrete stair section");
    // Kesin "merdiven" yok → primary 0 → sozluk fallback (merdiven→stair) bulur.
    let page = db.list_intent_search("merdiven nerede", None, None, &HashSet::new(), 50).unwrap().unwrap();
    assert_eq!(page.total, 1, "kesin eslesme yoksa sozluk fallback devreye girer");
    assert_eq!(page.items[0].id, s);
}

/// Dosya-turu ipucu (⑤, H2 FILE_TYPE_HINTS): `ext_hint` verilince yalniz o uzanti(lar) sayilir.
/// Ipucsuz → tum turler. `doc/docx` gibi cok-uzantili ipucu ikisini de yakalar.
#[test]
fn list_intent_search_ext_hint_filters_by_type() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    ingest_body_ext(&mut db, "/p/a.pdf", "a.pdf", "pdf", "yalitim sartnamesi");
    ingest_body_ext(&mut db, "/p/b.pdf", "b.pdf", "pdf", "beton sartnamesi");
    ingest_body_ext(&mut db, "/p/c.dwg", "c.dwg", "dwg", "sartname notu");
    ingest_body_ext(&mut db, "/p/d.docx", "d.docx", "docx", "sartname raporu");
    // Ipucsuz → tum turler (4).
    let all =
        db.list_intent_search("sartname hangi dosyada", None, None, &HashSet::new(), 50).unwrap().unwrap();
    assert_eq!(all.total, 4);
    // pdf ipucu → yalniz 2 pdf.
    let pdf = ["pdf".to_string()];
    let only_pdf = db
        .list_intent_search("sartname hangi dosyada", Some(&pdf), None, &HashSet::new(), 50)
        .unwrap()
        .unwrap();
    assert_eq!(only_pdf.total, 2, "yalniz pdf");
    assert!(only_pdf.items.iter().all(|a| a.ext.as_deref() == Some("pdf")));
    // doc/docx cok-uzantili ipucu → docx dosyayi yakalar (H2 doc→[doc,docx]).
    let word = ["doc".to_string(), "docx".to_string()];
    let only_word = db
        .list_intent_search("sartname hangi dosyada", Some(&word), None, &HashSet::new(), 50)
        .unwrap()
        .unwrap();
    assert_eq!(only_word.total, 1, "docx dosya doc/docx ipucuyla gelir");
    assert_eq!(only_word.items[0].ext.as_deref(), Some("docx"));
}

/// Iki-bilesenli birim vektor: `a` buyudukce sorgu vektorune (unit(0)) YAKINLASIR.
/// kNN aday havuzu testlerinde mesafe siralamasini kontrollu kurmak icin.
fn near(a: f32) -> Vec<f32> {
    let mut v = vec![0f32; 384];
    v[0] = a;
    v[1] = (1.0 - a * a).max(0.0).sqrt();
    v
}

/// **Regresyon (2026-08-17 denetimi, Y4):** kNN aday havuzu `LIMIT`'i suzgecten ONCE kosar
/// (vec0 sanal tablosunda `deleted_at`/`rag_excluded` kosulu SQL'e alinamaz). Sabit 200'luk
/// havuzun tamami cope atilmis chunk'larla dolarsa, GERCEKTEN alakali ama biraz daha uzak olan
/// chunk sessizce kaybolurdu. Havuz artik sagkalan aday yeterli olana dek buyutulur.
#[test]
fn knn_pool_widens_when_candidates_are_filtered_out() {
    let mut db = Db::open_in_memory_migrated().unwrap();

    // 250 "gurultu" asset (sabit 200'luk havuzdan fazla), hepsi sorguya COK yakin — ve hepsi copte.
    let mut noise_ids = Vec::new();
    for i in 0..250 {
        let path = format!("/p/n{i}.pdf");
        let id = ingest(&mut db, &path, &format!("n{i}.pdf"));
        let a = 1.0 - (i as f32) * 1e-4; // i buyudukce hafifce uzaklasir; hepsi hedeften yakin
        db.set_asset_chunks(
            id,
            &[ChunkWrite { chunk_index: 0, page: None, text: "deniz manzarasi".into(), embedding: near(a) }],
        )
        .unwrap();
        noise_ids.push(id);
    }
    db.soft_delete(&noise_ids).unwrap();

    // Hedef: aktif, ama vektor olarak gurultunun TAMAMINDAN daha uzak.
    let target = ingest(&mut db, "/p/hedef.pdf", "hedef.pdf");
    db.set_asset_chunks(
        target,
        &[ChunkWrite { chunk_index: 0, page: None, text: "avlu kesiti".into(), embedding: near(0.5) }],
    )
    .unwrap();

    // "bulut" hicbir chunk metninde YOK → FTS dali bos; isabet YALNIZ kNN dalindan gelebilir.
    let (hits, diag) = db.rag_search_with_diag("bulut", &near(1.0), 10, &[], false, None).unwrap();
    assert_eq!(diag.fts_candidates, 0, "FTS eslesmesi olmamali — kNN dali izole edilir");
    assert!(
        hits.iter().any(|h| h.asset_id == target),
        "cop adaylar havuzu doldurdugunda bile aktif chunk bulunmali (havuz buyutulur)"
    );
    assert!(hits.iter().all(|h| h.asset_id != 0), "cop asset chunk'i sizmamali");
}
