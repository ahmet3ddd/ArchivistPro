//! Sorgu API'si testleri — birlesik list_assets (filtre + FTS) / get_asset.

use archivist_db::{AssetInput, AssetSort, Db, IngestData, ListOpts, MetaVal};

/// Test asset'i ingest et; id doner.
#[allow(clippy::too_many_arguments)]
fn seed(
    db: &mut Db,
    path: &str,
    file_name: &str,
    ext: &str,
    title: &str,
    body: &str,
    modified: i64,
    metadata: &[(String, MetaVal)],
    tags: &[String],
) -> i64 {
    let asset = AssetInput {
        path,
        file_name,
        ext: Some(ext),
        size_bytes: 100,
        content_hash: Some("h"),
        mime: None,
        title: Some(title),
        description: None,
        created_at: modified,
        modified_at: modified,
    };
    let data = IngestData { fts_body: Some(body), metadata, auto_tags: tags, phash: None, thumbnail: None };
    db.ingest(&asset, &data).unwrap()
}

fn seeded() -> Db {
    let mut db = Db::open_in_memory_migrated().unwrap();
    seed(
        &mut db,
        "/a/1.pdf",
        "1.pdf",
        "pdf",
        "Villa Projesi",
        "villa salon metni",
        100,
        &[("author".to_string(), MetaVal::Text("Ahmet".to_string()))],
        &["is_render".to_string()],
    );
    seed(&mut db, "/a/2.dwg", "2.dwg", "dwg", "Ofis Plani", "ofis kat metni", 200, &[], &[]);
    seed(&mut db, "/a/3.pdf", "3.pdf", "pdf", "Villa Bahce", "villa bahce metni", 300, &[], &[]);
    seed(&mut db, "/a/4.ifc", "4.ifc", "ifc", "Kule", "kule yapisi metni", 400, &[], &[]);
    seed(&mut db, "/a/5.txt", "5.txt", "txt", "Not", "villa notu metni", 500, &[], &[]);
    db
}

fn opts(page: i64, page_size: i64, sort: AssetSort, ext: Option<&str>) -> ListOpts {
    // Cok-degerli ext: Option<&str> → Vec (None → bos, Some → tek elemanli).
    ListOpts { page, page_size, sort, ext: ext.map(String::from).into_iter().collect(), ..Default::default() }
}

/// FTS sorgulu ListOpts (birlesik yol).
fn q_opts(query: &str, page: i64, page_size: i64) -> ListOpts {
    ListOpts { page, page_size, query: Some(query.to_string()), ..Default::default() }
}

#[test]
fn list_default_sort_modified_desc() {
    let db = seeded();
    let page = db.list_assets(&opts(0, 50, AssetSort::ModifiedDesc, None)).unwrap();
    assert_eq!(page.total, 5);
    assert_eq!(page.items.len(), 5);
    // En yeni (modified 500) ilk.
    assert_eq!(page.items[0].file_name, "5.txt");
    assert_eq!(page.items[4].file_name, "1.pdf");
}

#[test]
fn list_ext_filter() {
    let db = seeded();
    let page = db.list_assets(&opts(0, 50, AssetSort::ModifiedDesc, Some("pdf"))).unwrap();
    assert_eq!(page.total, 2, "yalniz 2 pdf");
    assert!(page.items.iter().all(|a| a.ext.as_deref() == Some("pdf")));
}

#[test]
fn list_pagination_and_name_sort() {
    let db = seeded();
    let p0 = db.list_assets(&opts(0, 2, AssetSort::NameAsc, None)).unwrap();
    assert_eq!(p0.total, 5);
    assert_eq!(p0.items.len(), 2);
    assert_eq!(p0.items[0].file_name, "1.pdf");
    assert_eq!(p0.items[1].file_name, "2.dwg");

    let p1 = db.list_assets(&opts(1, 2, AssetSort::NameAsc, None)).unwrap();
    assert_eq!(p1.items[0].file_name, "3.pdf");
    assert_eq!(p1.items[1].file_name, "4.ifc");

    let p2 = db.list_assets(&opts(2, 2, AssetSort::NameAsc, None)).unwrap();
    assert_eq!(p2.items.len(), 1, "son sayfa kismi");
    assert_eq!(p2.items[0].file_name, "5.txt");
}

/// Teknik gorunum sutun-basligi siralamalari (yeni AssetSort variant'lari) — dogru ORDER BY.
#[test]
fn list_column_header_sorts() {
    let db = seeded();
    // name_desc: name_asc'in tersi.
    let nd = db.list_assets(&opts(0, 50, AssetSort::NameDesc, None)).unwrap();
    assert_eq!(nd.items[0].file_name, "5.txt");
    assert_eq!(nd.items[4].file_name, "1.pdf");
    // type_asc (ext ASC): dwg < ifc < pdf < txt; pdf esitligi id ASC (1.pdf, sonra 3.pdf).
    let ta = db.list_assets(&opts(0, 50, AssetSort::TypeAsc, None)).unwrap();
    let names: Vec<_> = ta.items.iter().map(|a| a.file_name.as_str()).collect();
    assert_eq!(names, vec!["2.dwg", "4.ifc", "1.pdf", "3.pdf", "5.txt"]);
    // created_asc: created_at (=modified) 100..500 artan.
    let ca = db.list_assets(&opts(0, 50, AssetSort::CreatedAsc, None)).unwrap();
    assert_eq!(ca.items[0].file_name, "1.pdf");
    assert_eq!(ca.items[4].file_name, "5.txt");
    // path_desc: /a/5.txt .. /a/1.pdf azalan.
    let pd = db.list_assets(&opts(0, 50, AssetSort::PathDesc, None)).unwrap();
    assert_eq!(pd.items[0].file_name, "5.txt");
    assert_eq!(pd.items[4].file_name, "1.pdf");
}

#[test]
fn search_fts_matches_title_and_body() {
    let db = seeded();
    let villa = db.list_assets(&q_opts("villa", 0, 50)).unwrap();
    // 1.pdf (baslik+body), 3.pdf (baslik+body), 5.txt (body) → 3.
    assert_eq!(villa.total, 3, "villa 3 asset");
    assert_eq!(villa.items.len(), 3);

    let ofis = db.list_assets(&q_opts("ofis", 0, 50)).unwrap();
    assert_eq!(ofis.total, 1);
    assert_eq!(ofis.items[0].file_name, "2.dwg");

    // Bos query → filtreli liste (5 asset); ozel-karakter girdi panik/hata vermez.
    assert_eq!(db.list_assets(&q_opts("   ", 0, 50)).unwrap().total, 5);
    assert!(db.list_assets(&q_opts("c++ :", 0, 50)).is_ok());
}

#[test]
fn search_pagination() {
    let db = seeded();
    let p0 = db.list_assets(&q_opts("villa", 0, 2)).unwrap();
    assert_eq!(p0.total, 3);
    assert_eq!(p0.items.len(), 2);
    let p1 = db.list_assets(&q_opts("villa", 1, 2)).unwrap();
    assert_eq!(p1.items.len(), 1);
}

#[test]
fn search_composes_with_filters() {
    // Birlesik yolun cekirdek kazanimi: FTS + facet birlikte (eskiden arama
    // filtreleri yok sayardi). "villa" + ext=pdf → 1.pdf, 3.pdf (5.txt haric).
    let db = seeded();
    let opts = ListOpts {
        page_size: 50,
        query: Some("villa".to_string()),
        ext: vec!["pdf".to_string()],
        ..Default::default()
    };
    let page = db.list_assets(&opts).unwrap();
    assert_eq!(page.total, 2, "villa + pdf → 2");
    assert!(page.items.iter().all(|a| a.ext.as_deref() == Some("pdf")));
}

#[test]
fn search_boolean_operators_and_phrase() {
    let db = seeded();
    // OR: villa(1,3,5) + ofis(2) = 4.
    assert_eq!(db.list_assets(&q_opts("villa OR ofis", 0, 50)).unwrap().total, 4);
    // NOT: villa(1,3,5) haric bahce(3) = 2.
    assert_eq!(db.list_assets(&q_opts("villa NOT bahce", 0, 50)).unwrap().total, 2);
    // AND (implicit/acik): yalniz 1.pdf (body "villa salon").
    assert_eq!(db.list_assets(&q_opts("villa AND salon", 0, 50)).unwrap().total, 1);
    // Tumce: "villa bahce" bitisik → yalniz 3.pdf.
    let phrase = db.list_assets(&q_opts("\"villa bahce\"", 0, 50)).unwrap();
    assert_eq!(phrase.total, 1);
    assert_eq!(phrase.items[0].file_name, "3.pdf");
    // Hatali sozdizimi (asili operator / dengesiz parantez) → zarif dusus, panik yok.
    assert!(db.list_assets(&q_opts("villa AND", 0, 50)).is_ok());
    assert!(db.list_assets(&q_opts("(villa", 0, 50)).is_ok());
}

/// M2: gecerli-ama-saskinlik-veren girdi sessiz-yanlis SONUC vermemeli. Edge/bitisik
/// operator ve literal rezerve-kelime yollari uctan-uca (gercek FTS5) dogrulanir.
#[test]
fn search_surprising_input_is_sane_not_silently_wrong() {
    let db = seeded();

    // Cift operator `villa OR OR ofis`: eskiden FTS5 "syntax error" → guvenli sorguya
    // duser; tum tokenlar literal AND olur → "OR" diye bir token olmadigindan 0 sonuc
    // (panik/hata yok, deterministik). "villa OR ofis" (4) ile KARISMAZ.
    assert_eq!(db.list_assets(&q_opts("villa OR OR ofis", 0, 50)).unwrap().total, 0);
    assert_eq!(db.list_assets(&q_opts("villa OR ofis", 0, 50)).unwrap().total, 4);

    // Basta/sonda operator → operandsiz → literal terim; "OR"/"AND" tokeni yok → 0.
    assert_eq!(db.list_assets(&q_opts("OR villa", 0, 50)).unwrap().total, 0);
    assert_eq!(db.list_assets(&q_opts("villa AND", 0, 50)).unwrap().total, 0);

    // Tek basina rezerve kelime literal aranir (sessizce her seyi getirmez):
    // body'lerde "and" tokeni yok → 0. (Eskiden bare `AND` → SQL error → guvenli sorgu.)
    assert_eq!(db.list_assets(&q_opts("and", 0, 50)).unwrap().total, 0);
}

/// M2: kucuk-harf rezerve kelime LITERAL aranabilmeli — `roof and beam` ile birlikte
/// `and` tokenini iceren bir dokuman bulunabilir (eskiden hicbir sinyal yoktu).
#[test]
fn search_literal_reserved_word_matches_document() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // Body literal "and" iceriyor.
    seed(&mut db, "/r.txt", "r.txt", "txt", "Roof", "roof and beam detail", 1, &[], &[]);
    // Body literal "and" YOK (sadece roof + beam).
    seed(&mut db, "/s.txt", "s.txt", "txt", "Steel", "steel roof beam frame", 2, &[], &[]);

    // `roof and beam`: `and` iki terim arasinda → operator (roof AND beam) → her ikisi de.
    assert_eq!(db.list_assets(&q_opts("roof and beam", 0, 50)).unwrap().total, 2);

    // Literal "and" arandiginda yalniz r.txt eslesmeli (kullanici sinyali artik var).
    let lit = db.list_assets(&q_opts("\"and\"", 0, 50)).unwrap();
    assert_eq!(lit.total, 1, "literal 'and' → yalniz iceren dokuman");
    assert_eq!(lit.items[0].file_name, "r.txt");
}

#[test]
fn fuzzy_search_tolerates_typos() {
    let db = seeded();
    // Tam FTS "vila" → 0 (boyle bir kelime yok; body'de "villa" var ama "vila" yok).
    assert_eq!(db.list_assets(&q_opts("vila", 0, 50)).unwrap().total, 0);

    // Fuzzy "vila" → baslikta "Villa" gecen 1.pdf + 3.pdf (fuzzy file_name/title'a bakar).
    let fz = ListOpts { page_size: 50, query: Some("vila".into()), fuzzy: true, ..Default::default() };
    let res = db.list_assets(&fz).unwrap();
    assert_eq!(res.total, 2, "fuzzy vila → 2 (baslik eslesmesi)");
    assert!(res.items.iter().all(|a| a.ext.as_deref() == Some("pdf")));

    // Fuzzy + filtre birlikte: ext=ifc → 0.
    let fz_ifc = ListOpts { ext: vec!["ifc".into()], ..fz.clone() };
    assert_eq!(db.list_assets(&fz_ifc).unwrap().total, 0);

    // Fuzzy ama yalniz operator → terim yok → bos.
    let fz_op = ListOpts { query: Some("AND".into()), ..fz };
    assert_eq!(db.list_assets(&fz_op).unwrap().total, 0);
}

#[test]
fn fts_snippet_marks_matches() {
    let db = seeded();
    // 1.pdf body "villa salon metni" → snippet dolu, eslesme \u{2}..\u{3} ile isaretli.
    let res = db.list_assets(&q_opts("salon", 0, 50)).unwrap();
    assert_eq!(res.total, 1);
    let snip = res.items[0].snippet.as_deref().expect("FTS snippet dolu");
    assert!(snip.contains('\u{2}') && snip.contains('\u{3}'), "eslesme isaretlenmeli");
    assert!(snip.to_lowercase().contains("salon"));

    // Duz liste (query yok) → snippet None.
    let plain = db.list_assets(&opts(0, 50, AssetSort::ModifiedDesc, None)).unwrap();
    assert!(plain.items.iter().all(|a| a.snippet.is_none()), "liste yolunda snippet yok");
}

// ── #3: ONEK (kök/cekim) + SOZLUK (ARCH_SYNONYMS) FALLBACK — okuma-tarafi arama genisletme ──

#[test]
fn fts_prefix_matches_turkish_inflection() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    seed(&mut db, "/x/1.jpg", "1.jpg", "jpg", "Cami", "bulutlu gokyuzu ve minareler", 100, &[], &[]);
    // "bulut" (kök, 5 harf) → onek "bulut"* → "bulutlu"yu bulur (vision cekimli yazsa da okuma bulur).
    assert_eq!(db.list_assets(&q_opts("bulut", 0, 50)).unwrap().total, 1, "onek: bulut -> bulutlu");
    // "minare" → "minareler" (cekim).
    assert_eq!(db.list_assets(&q_opts("minare", 0, 50)).unwrap().total, 1, "onek: minare -> minareler");
    // Tam kelime de bulur (regresyon yok).
    assert_eq!(db.list_assets(&q_opts("bulutlu", 0, 50)).unwrap().total, 1);
}

#[test]
fn fts_prefix_length_gate_prevents_short_over_match() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    seed(&mut db, "/x/1.dwg", "1.dwg", "dwg", "Plan", "katman listesi", 100, &[], &[]);
    // "kat" 3 harf → onek YOK → yalniz TAM "kat"; body'de "katman" var ama "kat" token'i yok → 0.
    assert_eq!(
        db.list_assets(&q_opts("kat", 0, 50)).unwrap().total, 0,
        "3-harf onek yapmaz → 'katman' gurultusu onlenir"
    );
    // 4+ harf "katman" tam bulur.
    assert_eq!(db.list_assets(&q_opts("katman", 0, 50)).unwrap().total, 1);
}

#[test]
fn synonym_fallback_finds_domain_synonym_when_primary_empty() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // Icerik yalniz INGILIZCE sinonim "dome" icerir; "kubbe" GECMEZ.
    seed(&mut db, "/x/1.jpg", "1.jpg", "jpg", "Mosque", "large dome and courtyard", 100, &[], &[]);
    // "kubbe" birincil (onek) → 0 → ARCH_SYNONYMS fallback (kubbe → dome/tonoz/cupola) → bulur.
    assert_eq!(
        db.list_assets(&q_opts("kubbe", 0, 50)).unwrap().total, 1,
        "sozluk fallback: kubbe → dome (0-sonuc sonrasi)"
    );
}

#[test]
fn synonym_fallback_skipped_when_primary_has_results() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    seed(&mut db, "/x/1.jpg", "1.jpg", "jpg", "Cami", "kubbe ve avlu", 100, &[], &[]);
    seed(&mut db, "/x/2.jpg", "2.jpg", "jpg", "Mosque", "large dome only", 200, &[], &[]);
    // "kubbe" birincil → asset 1 (total>0) → fallback TETIKLENMEZ → "dome" asset'i (2) GELMEZ.
    let p = db.list_assets(&q_opts("kubbe", 0, 50)).unwrap();
    assert_eq!(p.total, 1, "birincil sonuc var → sozluk fallback devreye girmez (precision korunur)");
    assert_eq!(p.items[0].file_name, "1.jpg");
}

#[test]
fn no_fallback_preserves_and_semantics_for_non_domain() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    seed(&mut db, "/x/1.txt", "1.txt", "txt", "Villa", "villa salon manzara", 100, &[], &[]);
    // "villa helikopter": ikisi de ARCH_SYNONYMS anahtari DEGIL → sinonim yok → fallback yok;
    // birincil "villa"* AND "helikopter"* → helikopter yok → AND fail → 0 (körü OR'a DÜSMEZ).
    assert_eq!(
        db.list_assets(&q_opts("villa helikopter", 0, 50)).unwrap().total, 0,
        "domain-disi 0-sonuc: fallback yok, AND korunur"
    );
}

#[test]
fn date_range_filter() {
    let db = seeded(); // modified: 100,200,300,400,500
    let mid = ListOpts { page_size: 50, modified_after: Some(250), modified_before: Some(450), ..Default::default() };
    let page = db.list_assets(&mid).unwrap();
    assert_eq!(page.total, 2, "250..=450 → 3.pdf(300) + 4.ifc(400)");

    // FTS + tarih birlikte: villa(1=100,3=300,5=500) & modified>=250 → 3,5 = 2.
    let q = ListOpts {
        page_size: 50,
        query: Some("villa".to_string()),
        modified_after: Some(250),
        ..Default::default()
    };
    assert_eq!(db.list_assets(&q).unwrap().total, 2);
}

#[test]
fn multi_value_facets() {
    // seeded(): ext pdf(1,3) dwg(2) ifc(4) txt(5); is_render auto-tag yalniz 1.pdf.
    let mut db = seeded();

    // ── ext facet-ici OR: [pdf, dwg] → 1,2,3 = 3. ──
    let or_ext =
        ListOpts { page_size: 50, ext: vec!["pdf".into(), "dwg".into()], ..Default::default() };
    assert_eq!(db.list_assets(&or_ext).unwrap().total, 3, "ext [pdf,dwg] OR → 3");

    // ── Bos ext = filtre yok → tum 5. ──
    let none = ListOpts { page_size: 50, ext: vec![], ..Default::default() };
    assert_eq!(db.list_assets(&none).unwrap().total, 5, "bos ext → filtre yok → 5");

    // ── ext OR + FTS "villa" (1,3,5 eslesir) → ext=[pdf,txt] → 1,3,5 = 3 (OR + AND match). ──
    let or_ext_fts = ListOpts {
        page_size: 50,
        query: Some("villa".into()),
        ext: vec!["pdf".into(), "txt".into()],
        ..Default::default()
    };
    assert_eq!(db.list_assets(&or_ext_fts).unwrap().total, 3, "villa & ext[pdf,txt] → 3");

    // ── Facet-arasi AND: ext-OR kumesini tag daraltir. ext=[pdf,dwg] (1,2,3) AND
    //    tag=[is_render] (yalniz 1.pdf) → 1. ──
    let cross = ListOpts {
        page_size: 50,
        ext: vec!["pdf".into(), "dwg".into()],
        tag: vec!["is_render".into()],
        ..Default::default()
    };
    let cross_page = db.list_assets(&cross).unwrap();
    assert_eq!(cross_page.total, 1, "ext-OR AND tag → facet-arasi AND → 1");
    assert_eq!(cross_page.items[0].file_name, "1.pdf");

    // ── tag facet-ici OR + json_each KACIS kaniti: 2.dwg'ye tirnak/virgul iceren bir
    //    kullanici etiketi ekle (JSON serileştirme dogru kacmazsa json_each saparsa). ──
    let dwg_id = db
        .list_assets(&ListOpts { page_size: 50, ext: vec!["dwg".into()], ..Default::default() })
        .unwrap()
        .items[0]
        .id;
    db.add_user_tag(dwg_id, "a\",b").unwrap();
    let or_tag = ListOpts {
        page_size: 50,
        tag: vec!["is_render".into(), "a\",b".into()],
        ..Default::default()
    };
    assert_eq!(db.list_assets(&or_tag).unwrap().total, 2, "tag OR (special-char dahil) → 2");
    let only_special =
        ListOpts { page_size: 50, tag: vec!["a\",b".into()], ..Default::default() };
    let sp = db.list_assets(&only_special).unwrap();
    assert_eq!(sp.total, 1, "yalniz special-char tag → json_each kacis dogru → 1");
    assert_eq!(sp.items[0].file_name, "2.dwg");

    // ── collection facet-ici OR (json_each i64 yolu): 4.ifc → A, 5.txt → B;
    //    collection=[A,B] → 2. ──
    let ifc_id = db
        .list_assets(&ListOpts { page_size: 50, ext: vec!["ifc".into()], ..Default::default() })
        .unwrap()
        .items[0]
        .id;
    let txt_id = db
        .list_assets(&ListOpts { page_size: 50, ext: vec!["txt".into()], ..Default::default() })
        .unwrap()
        .items[0]
        .id;
    let coll_a = db.create_collection("A", None).unwrap();
    let coll_b = db.create_collection("B", None).unwrap();
    db.add_to_collection(coll_a, ifc_id).unwrap();
    db.add_to_collection(coll_b, txt_id).unwrap();
    let or_coll =
        ListOpts { page_size: 50, collection: vec![coll_a, coll_b], ..Default::default() };
    assert_eq!(db.list_assets(&or_coll).unwrap().total, 2, "collection [A,B] OR → 2");
}

#[test]
fn get_asset_detail_and_missing() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = seed(
        &mut db,
        "/x.pdf",
        "x.pdf",
        "pdf",
        "Kule Projesi",
        "metin",
        100,
        &[
            ("author".to_string(), MetaVal::Text("Ahmet".to_string())),
            ("page_count".to_string(), MetaVal::Num(12.0)),
        ],
        &["is_render".to_string()],
    );

    let detail = db.get_asset(id).unwrap().expect("var olmali");
    assert_eq!(detail.asset.title.as_deref(), Some("Kule Projesi"));
    assert_eq!(detail.tags.len(), 1);
    assert_eq!(detail.tags[0].name, "is_render");
    assert_eq!(detail.tags[0].kind, "auto"); // ingest auto_tags → kind=auto
    // Metadata key'e gore sirali: author, page_count.
    assert_eq!(detail.metadata.len(), 2);
    assert_eq!(detail.metadata[0].key, "author");
    assert_eq!(detail.metadata[0].value_text.as_deref(), Some("Ahmet"));
    assert_eq!(detail.metadata[1].key, "page_count");
    assert_eq!(detail.metadata[1].value_num, Some(12.0));

    assert!(db.get_asset(9999).unwrap().is_none(), "olmayan id → None");

    // **A1 gerileme kilidi:** cop'e atilan asset detay yolundan SIZMAMALI. Liste/facet
    // yollari `deleted_at IS NULL` filtreliyordu (query/facets.rs:18,38); `get_asset`'te
    // guard eksikti → soft-deleted satir donuyordu. Cop UI'i `list_trash()` kullanir.
    assert_eq!(db.soft_delete(&[id]).unwrap(), 1);
    assert!(db.get_asset(id).unwrap().is_none(), "cop'teki asset get_asset ile GELMEMELI");
    // restore → detay yine gelir (guard kalici bir kayip degil, yalniz cop filtresi).
    assert_eq!(db.restore(&[id]).unwrap(), 1);
    assert!(db.get_asset(id).unwrap().is_some(), "restore sonrasi detay geri gelmeli");
}

#[test]
fn ext_facets_grouped_and_sorted() {
    let db = seeded(); // 2 pdf, 1 dwg, 1 ifc, 1 txt
    let facets = db.ext_facets().unwrap();
    assert_eq!(facets[0].value.as_deref(), Some("pdf"), "en cok pdf ilk");
    assert_eq!(facets[0].count, 2);
    assert_eq!(facets.iter().map(|f| f.count).sum::<i64>(), 5, "tum asset'ler");
    assert_eq!(facets.len(), 4, "4 farkli uzanti");
}

#[test]
fn metadata_facets_by_key() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let ahmet = vec![("author".to_string(), MetaVal::Text("Ahmet".to_string()))];
    let mehmet = vec![("author".to_string(), MetaVal::Text("Mehmet".to_string()))];
    seed(&mut db, "/a.pdf", "a.pdf", "pdf", "A", "x", 1, &ahmet, &[]);
    seed(&mut db, "/b.pdf", "b.pdf", "pdf", "B", "y", 2, &mehmet, &[]);
    seed(&mut db, "/c.pdf", "c.pdf", "pdf", "C", "z", 3, &ahmet, &[]);

    let facets = db.metadata_facets("author", 10).unwrap();
    assert_eq!(facets[0].value.as_deref(), Some("Ahmet"), "Ahmet 2 → ilk");
    assert_eq!(facets[0].count, 2);
    assert_eq!(facets[1].value.as_deref(), Some("Mehmet"));
    assert_eq!(facets[1].count, 1);
    assert!(db.metadata_facets("yok", 10).unwrap().is_empty(), "olmayan key → bos");
}
