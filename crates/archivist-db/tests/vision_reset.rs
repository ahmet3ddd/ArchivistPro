//! Kullanilamaz AI-analizlerinin tespiti ve SIFIRLANMASI (yeniden **bekleyen** yapma).
//!
//! TESPIT (saha bulgusu 2026-08-08, EV makinesi DB'si): cop-korumasi (`is_usable`) 2026-08-07'de
//! eklendi; ONCESINDE `llava` ile analiz edilen 415 varligin 378'i tek alanli (`ai_aciklama`,
//! etiketsiz serbest metin) yazilmis ve `ai_analyzed=1` damgasi yemisti. Damgali varlik
//! `pending_analysis_count`'ta GORUNMEZ → calisan bir modelle bir daha ASLA denenmez. Bu testler
//! sifirlama yolunu (tespit + temizlik + yeniden-bekleyen + arama kirliliginin kalkmasi) dogrular.
//!
//! Test-first: bu testler `unusable_analysis_ids` / `clear_ai_analysis` yazilmadan once yazildi.

use archivist_db::{AssetInput, Db, IngestData, ListOpts, ThumbnailInput};

/// `VISION_EAV_KEYS` (src-tauri/src/vision.rs) — bu crate onu import edemez (ters bagimlilik),
/// cagiran gecer. Drift, src-tauri tarafinda `to_eav_keys_match_this_list` testiyle kilitlidir.
const CONTENT_KEYS: &[&str] = &[
    "ai_cizim_turu",
    "ai_aciklama",
    "ai_elemanlar",
    "ai_mekanlar",
    "ai_ozel_terimler",
    "ai_anahtar_kelimeler",
    "ai_mimari_stiller",
    "ai_malzemeler",
    "ai_metin",
];
/// `MIN_FILLED_FIELDS` (src-tauri/src/vision.rs) ile ayni esik.
const MIN_FIELDS: usize = 2;

/// THUMBNAIL'LI gorsel-asset ingest et — `pending_analysis_count` thumbnail SART kosar, thumbnail'siz
/// asset sifirlansa bile "bekleyen" olmaz (testin yanlis-yesil vermemesi icin kritik).
fn ingest_with_thumb(db: &mut Db, path: &str, name: &str) -> i64 {
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
        &IngestData {
            fts_body: None,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: Some(ThumbnailInput {
                mime: "image/webp",
                width: 8,
                height: 8,
                bytes: &[0u8; 4],
            }),
        },
    )
    .expect("ingest")
}

fn q(query: &str) -> ListOpts {
    ListOpts { page_size: 50, query: Some(query.to_string()), ..Default::default() }
}

fn ai_key_count(db: &Db, id: i64) -> i64 {
    db.connection()
        .query_row(
            r"SELECT count(*) FROM asset_metadata WHERE asset_id=?1 AND key LIKE 'ai\_%' ESCAPE '\'",
            [id],
            |r| r.get(0),
        )
        .unwrap()
}

/// TESPIT: yalniz esigin ALTINDA kalan (tek icerik alanli) analizler secilir; 2+ alanli saglikli
/// analiz ve hic analiz edilmemis varlik SECILMEZ.
#[test]
fn only_sub_threshold_analyses_are_selected() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let junk = ingest_with_thumb(&mut db, r"C:\arsiv\junk.jpg", "junk.jpg");
    let good = ingest_with_thumb(&mut db, r"C:\arsiv\good.jpg", "good.jpg");
    let never = ingest_with_thumb(&mut db, r"C:\arsiv\never.jpg", "never.jpg");

    // COP (fallback dali): etiketsiz serbest metin → TEK icerik alani.
    db.set_ai_metadata(junk, &[("ai_aciklama", "bu gorsel bir seyler gosteriyor".into())]).unwrap();
    // SAGLIKLI: en az iki icerik alani (model istenen bicimi uretti).
    db.set_ai_metadata(
        good,
        &[
            ("ai_aciklama", "cami avlusu".into()),
            ("ai_anahtar_kelimeler", "kubbe, minare".into()),
        ],
    )
    .unwrap();
    // `never` hic analiz edilmedi (ai_analyzed damgasi YOK).

    let ids = db.unusable_analysis_ids(CONTENT_KEYS, MIN_FIELDS).unwrap();
    assert_eq!(ids, vec![junk], "yalniz esik-alti analiz secilmeli");
    assert!(!ids.contains(&good), "saglikli analize DOKUNULMAZ");
    assert!(!ids.contains(&never), "analiz edilmemis varlik zaten bekliyor, secilmez");
}

/// `ai_model` / `ai_analyzed_at` KAYIT-TUTMA alanlaridir, `ai_gorsel_turu` ise betimden degil
/// `image_kind` heuristiginden gelir → hicbiri "icerik" sayilmaz. Uretimde her analiz ai_model +
/// ai_analyzed_at da yazar; bunlar sayilsaydi TEK alanli cop kayit 3 alanli gorunur ve tespit
/// TAMAMEN kacirirdi (bu testin varlik sebebi).
#[test]
fn bookkeeping_and_media_type_keys_do_not_count_as_content() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest_with_thumb(&mut db, r"C:\arsiv\a.jpg", "a.jpg");
    db.set_ai_metadata(
        id,
        &[
            ("ai_aciklama", "serbest metin".into()),
            ("ai_model", "llava:latest".into()),
            ("ai_analyzed_at", "1785682564265".into()),
            ("ai_gorsel_turu", "fotograf".into()),
        ],
    )
    .unwrap();
    // 4 ai_* alani + ai_analyzed damgasi var ama ICERIK yalniz 1 → cop.
    assert!(ai_key_count(&db, id) >= 5);
    assert_eq!(db.unusable_analysis_ids(CONTENT_KEYS, MIN_FIELDS).unwrap(), vec![id]);
}

/// SIFIRLAMA: temizlik sonrasi varlik yeniden BEKLEYEN olur, `ai_*` icerik gider,
/// `ai_gorsel_turu` KORUNUR ve cop metin ana-kutu aramasindan DUSER.
#[test]
fn clearing_makes_asset_pending_again_and_unsearchable() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest_with_thumb(&mut db, r"C:\arsiv\IMG_7.jpg", "IMG_7.jpg");
    db.set_ai_metadata(
        id,
        &[
            ("ai_aciklama", "mimari veya mekanik projenin modelini gosterir".into()),
            ("ai_gorsel_turu", "render".into()),
        ],
    )
    .unwrap();

    // Once: analizli sayilir, bekleyen DEGIL, cop metin ana kutuda ESLESIYOR.
    assert_eq!(db.analyzed_count().unwrap(), 1);
    assert_eq!(db.pending_analysis_count().unwrap(), 0, "damgali → bekleyen degil");
    assert_eq!(db.list_assets(&q("mekanik")).unwrap().total, 1, "cop metin aramada gorunuyor");

    db.clear_ai_analysis(id).unwrap();

    // Sonra: damga gitti → yeniden BEKLEYEN (calisan modelle telafi edilebilir).
    assert_eq!(db.analyzed_count().unwrap(), 0, "ai_analyzed damgasi kalkti");
    assert_eq!(db.pending_analysis_count().unwrap(), 1, "varlik yeniden bekleyen");
    // Cop metin aranabilir govdeden DUSTU (assets_fts.ai bosaltildi).
    assert_eq!(db.list_assets(&q("mekanik")).unwrap().total, 0, "cop metin artik eslesmiyor");
    // `ai_gorsel_turu` KORUNDU (set_ai_metadata ile ayni istisna) — Katman 1 siniflandirmasi
    // silinseydi her sifirlama medya-turu etiketini de yok ederdi.
    let kept: String = db
        .connection()
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='ai_gorsel_turu'",
            [id],
            |r| r.get(0),
        )
        .expect("ai_gorsel_turu korunmali");
    assert_eq!(kept, "render");
    assert_eq!(ai_key_count(&db, id), 1, "yalniz ai_gorsel_turu kaldi");
}

/// Sifirlama IDEMPOTENT: zaten temiz bir varlikta ikinci cagri hata vermez, durumu bozmaz.
#[test]
fn clearing_is_idempotent() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest_with_thumb(&mut db, r"C:\arsiv\b.jpg", "b.jpg");
    db.set_ai_metadata(id, &[("ai_aciklama", "metin".into())]).unwrap();
    db.clear_ai_analysis(id).unwrap();
    db.clear_ai_analysis(id).unwrap();
    assert_eq!(db.pending_analysis_count().unwrap(), 1);
    assert_eq!(ai_key_count(&db, id), 0);
}

/// MODEL KIRILIMI: her model icin toplam + esik-alti sayilir; toplamlar `analyzed_count` ile TUTAR
/// (hicbir kayit sessizce dusmez) ve **kor nokta** (esigi gecen ama X modeliyle yazilmis) turetilir.
#[test]
fn breakdown_groups_by_model_and_exposes_blind_spot() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // llava: biri cop (tek alan), biri esigi GECEN (iki alan) → kor nokta orneği.
    let l1 = ingest_with_thumb(&mut db, r"C:\a\l1.jpg", "l1.jpg");
    let l2 = ingest_with_thumb(&mut db, r"C:\a\l2.jpg", "l2.jpg");
    db.set_ai_metadata(l1, &[("ai_aciklama", "cop".into()), ("ai_model", "llava:latest".into())])
        .unwrap();
    db.set_ai_metadata(
        l2,
        &[
            ("ai_aciklama", "duzgun".into()),
            ("ai_anahtar_kelimeler", "kubbe".into()),
            ("ai_model", "llava:latest".into()),
        ],
    )
    .unwrap();
    // qwen: saglikli.
    let q1 = ingest_with_thumb(&mut db, r"C:\a\q1.jpg", "q1.jpg");
    db.set_ai_metadata(
        q1,
        &[
            ("ai_cizim_turu", "Kat Planı".into()),
            ("ai_aciklama", "ofis katı".into()),
            ("ai_model", "qwen2.5vl:3b".into()),
        ],
    )
    .unwrap();
    // ai_model YAZILMAMIS eski kayit → bos ad altinda toplanmali (sessizce DUSMEMELI).
    let old = ingest_with_thumb(&mut db, r"C:\a\old.jpg", "old.jpg");
    db.set_ai_metadata(old, &[("ai_aciklama", "model bilgisi yok".into())]).unwrap();

    let rows = db.analysis_breakdown_by_model(CONTENT_KEYS, MIN_FIELDS).unwrap();
    // `(toplam, esik_alti)` — model adiyla ara.
    let get = |m: &str| {
        let (_, total, sub) =
            rows.iter().find(|(n, _, _)| n == m).expect("model kiriliminda bulunmali");
        (*total, *sub)
    };

    assert_eq!(get("llava:latest"), (2, 1), "llava: 2 analiz, 1'i esik alti");
    assert_eq!(get("qwen2.5vl:3b"), (1, 0), "qwen: 1 analiz, hicbiri esik alti degil");
    assert_eq!(get(""), (1, 1), "ai_model'siz eski kayit bos ad altinda gorunur");

    // Toplamlar TUTAR: kirilim hicbir analizli varligi kaybetmez.
    let sum_total: i64 = rows.iter().map(|(_, t, _)| t).sum();
    assert_eq!(sum_total, db.analyzed_count().unwrap(), "kirilim toplami = analizli toplam");
    let sum_sub: i64 = rows.iter().map(|(_, _, s)| s).sum();
    assert_eq!(
        sum_sub,
        db.unusable_analysis_ids(CONTENT_KEYS, MIN_FIELDS).unwrap().len() as i64,
        "esik-alti toplami = sifirlanacak kume"
    );

    // KOR NOKTA: llava'nin esigi GECEN 1 analizi sifirlama kapsamina girmez.
    let (llava_total, llava_sub) = get("llava:latest");
    assert_eq!(llava_total - llava_sub, 1, "esigi gecen ama llava ile yazilmis kayit gorunur");
}

/// COPTEKI (silinmis) varlik secilmez — sifirlama canli arsivi hedefler.
#[test]
fn trashed_assets_are_not_selected() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest_with_thumb(&mut db, r"C:\arsiv\c.jpg", "c.jpg");
    db.set_ai_metadata(id, &[("ai_aciklama", "metin".into())]).unwrap();
    assert_eq!(db.unusable_analysis_ids(CONTENT_KEYS, MIN_FIELDS).unwrap(), vec![id]);

    db.connection()
        .execute("UPDATE assets SET deleted_at = 1 WHERE id = ?1", [id])
        .unwrap();
    assert!(
        db.unusable_analysis_ids(CONTENT_KEYS, MIN_FIELDS).unwrap().is_empty(),
        "copteki varlik sifirlama kapsaminda degil"
    );
}
