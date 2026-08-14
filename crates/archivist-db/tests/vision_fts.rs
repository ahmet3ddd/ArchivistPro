//! Part A: AI vision-betim → ana-kutu FTS koprusu (migration 0021 + set_ai_metadata `ai` kolonu).
//!
//! TESPIT (kritik bosluk): `set_ai_metadata` yalniz `ai_*` EAV yaziyordu; ana kutu arama yolu
//! (`list_assets` → `assets_fts MATCH`) yalniz `assets_fts`'i tarar ve `body` bir gorselde ~= bos
//! → analiz edilen gorselin AI betimi ana aramada GORUNMUYORDU. Bu testler kapatilan bosluğu
//! ANA KUTUNUN GERCEK sorgu yoluyla (`list_assets`, query_tests.rs/hybrid.rs deseni) dogrular.
//!
//! Test-first: bu testler once yazildi (kirmizi), sonra 0021 + set_ai_metadata degisimi yesile getirdi.

use archivist_db::{AssetInput, Db, IngestData, ListOpts};

/// Bir gorsel-asset ingest et (gercek yol: assets INSERT → assets_fts_ai trigger fts satirini
/// kurar; write.rs body'yi gunceller). `body`=None → bos govde (gorsel gercekligi). id doner.
fn ingest(db: &mut Db, path: &str, name: &str, body: Option<&str>) -> i64 {
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
            fts_body: body,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

/// Ana kutunun kullandigi GERCEK sorgu yolu (`list_assets` + `query`); diakritiksiz tokenizer.
fn q(query: &str) -> ListOpts {
    ListOpts { page_size: 50, query: Some(query.to_string()), ..Default::default() }
}

/// set_ai_metadata ile yazilan AI betim, ANA KUTU aramasinda gorunur (bosluğun kapandigi kanit).
/// Dosya adi arama terimlerini ICERMEZ → tek eslesme kaynagi `ai` kolonudur.
#[test]
fn ai_description_findable_via_main_box() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest(&mut db, r"C:\arsiv\IMG_1234.jpg", "IMG_1234.jpg", None);

    // Analiz ONCESI: ana kutu "cami bulut" → 0 (betim yok).
    assert_eq!(db.list_assets(&q("cami bulut")).unwrap().total, 0, "analizsiz gorsel bulunmaz");

    db.set_ai_metadata(
        id,
        &[
            ("ai_aciklama", "cami avlusu ve bulut dolu gokyuzu".to_string()),
            ("ai_anahtar_kelimeler", "kubbe, minare, avlu".to_string()),
        ],
    )
    .unwrap();

    // Analiz SONRASI: ana kutu ("cami bulut") bu asset'i DONER.
    let page = db.list_assets(&q("cami bulut")).unwrap();
    assert_eq!(page.total, 1, "AI betim ana FTS'te (ai kolonu) gorunur");
    assert_eq!(page.items[0].id, id);
    // Anahtar-kelimeler alani da aranabilir (fields'in tum value'leri ai kolonuna girer).
    assert_eq!(db.list_assets(&q("minare")).unwrap().total, 1);
}

/// KOMPOZISYONEL / AND: iki terim de ai metninde varsa esler; biri eksikse esmez (FTS5 ortuk AND).
#[test]
fn compositional_and_match() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest(&mut db, r"C:\arsiv\IMG_1.jpg", "IMG_1.jpg", None);
    db.set_ai_metadata(
        id,
        &[("ai_aciklama", "cami avlusu bulut gokyuzu kubbe minare".to_string())],
    )
    .unwrap();

    // Iki terim de ai metninde → ESLESIR.
    assert_eq!(db.list_assets(&q("cami bulut")).unwrap().total, 1, "iki terim de var → AND gecer");
    assert_eq!(db.list_assets(&q("kubbe minare")).unwrap().total, 1);

    // "deniz" ai metninde YOK → kompozisyonel AND kirilir → ESLESMEZ (sessiz-yanlis degil).
    assert_eq!(db.list_assets(&q("cami deniz")).unwrap().total, 0, "eksik terim → AND fail");
    assert_eq!(db.list_assets(&q("deniz")).unwrap().total, 0);
}

/// RE-INGEST KORUNUMU: ayni asset yeni (dolu) extracted body ile tekrar ingest edilince AI betim
/// HALA aranabilir (ai kolonu re-ingest'te dusmez). write.rs'e DOKUNULMADI — assets ON CONFLICT
/// DO UPDATE → assets_fts_au (name/title/desc senkron, ai'ye DOKUNMAZ) + write.rs yalniz body
/// gunceller → ai KORUNUR; ai_* metadata da write.rs'in `NOT LIKE ai_` DELETE'i ile korunur.
#[test]
fn reingest_preserves_ai_search() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let path = r"C:\arsiv\IMG_9.jpg";
    let id = ingest(&mut db, path, "IMG_9.jpg", None);
    db.set_ai_metadata(id, &[("ai_aciklama", "cami avlusu bulut gokyuzu".to_string())]).unwrap();
    assert_eq!(db.list_assets(&q("cami bulut")).unwrap().total, 1);

    // Re-ingest AYNI path — yeni extracted body ile.
    let id2 = ingest(&mut db, path, "IMG_9.jpg", Some("bu dosyanin yeni cikarilmis govde metni"));
    assert_eq!(id2, id, "path UNIQUE → ayni asset (upsert)");

    // AI betim HALA aranabilir (ai kolonu korundu).
    assert_eq!(db.list_assets(&q("cami bulut")).unwrap().total, 1, "re-ingest AI aramasini dusurmedi");
    // Yeni body de indekslendi (body ayri yol; ai ile catismaz).
    assert_eq!(db.list_assets(&q("govde")).unwrap().total, 1, "yeni body aranabilir");

    // ai_* EAV metadata korundu (ai_aciklama + ai_analyzed).
    let ai_meta: i64 = db
        .connection()
        .query_row(
            r"SELECT count(*) FROM asset_metadata WHERE asset_id=?1 AND key LIKE 'ai\_%' ESCAPE '\'",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(ai_meta, 2, "ai_aciklama + ai_analyzed re-ingest'te korundu");
}

/// IDEMPOTENT UZERINE-YAZMA: yeniden analiz (farkli betim) → eski ai terimleri DUSER, yenileri gelir
/// (ai kolonu her set_ai_metadata'da taze value'lerle ustune yazilir; bayat terim birikmez).
#[test]
fn reanalyze_overwrites_ai_column() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest(&mut db, r"C:\arsiv\IMG_x.jpg", "IMG_x.jpg", None);
    db.set_ai_metadata(id, &[("ai_aciklama", "cami avlusu bulut".to_string())]).unwrap();
    assert_eq!(db.list_assets(&q("cami")).unwrap().total, 1);

    // Yeniden analiz — tamamen farkli betim.
    db.set_ai_metadata(id, &[("ai_aciklama", "kopru nehir manzarasi".to_string())]).unwrap();
    assert_eq!(db.list_assets(&q("cami")).unwrap().total, 0, "eski ai terimi ustune yazildi");
    assert_eq!(db.list_assets(&q("nehir")).unwrap().total, 1, "yeni ai terimi aranabilir");
}

/// KAYNAK-IZI FTS-KIRLETME GUARD: `ai_model` (or. "llava:13b") ve `ai_analyzed_at` (epoch-ms)
/// EAV olarak asset_metadata'ya YAZILIR ama set_ai_metadata bunlari `assets_fts.ai`'ye SOKMAZ
/// (AI_FTS_EXCLUDED) → model adi/tarih ana kutu aramasinda ESLESMEZ (aranabilir govde kirlenmez).
/// Betim (ai_aciklama) YINE aranabilir (regresyon yok). STATUS: "AI FTS'ini KIRLETMEDEN ayri EAV".
#[test]
fn source_metadata_stored_but_excluded_from_fts() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest(&mut db, r"C:\arsiv\IMG_src.jpg", "IMG_src.jpg", None);
    db.set_ai_metadata(
        id,
        &[
            ("ai_aciklama", "cami avlusu bulut gokyuzu".to_string()),
            ("ai_model", "llava:13b".to_string()),
            ("ai_analyzed_at", "1783680000000".to_string()),
        ],
    )
    .unwrap();

    // (a) asset_metadata'da ai_model + ai_analyzed_at VAR (deger dogru; get_asset bunlari doner).
    let model: String = db
        .connection()
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='ai_model'",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(model, "llava:13b", "ai_model EAV olarak yazildi");
    let analyzed_at: String = db
        .connection()
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='ai_analyzed_at'",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(analyzed_at, "1783680000000", "ai_analyzed_at epoch-ms string olarak yazildi");

    // (b) FTS-KIRLETME GUARD: model adi/tarih ana kutuda ARANINCA asset ESLESMEZ (ai kolonuna girmedi).
    assert_eq!(db.list_assets(&q("llava")).unwrap().total, 0, "model adi FTS'e girmedi");
    assert_eq!(db.list_assets(&q("1783680000000")).unwrap().total, 0, "tarih FTS'e girmedi");

    // (c) REGRESYON: betim (ai_aciklama) HALA ana kutuda aranabilir (davranis degismedi).
    assert_eq!(db.list_assets(&q("cami bulut")).unwrap().total, 1, "betim FTS'te korundu");
}

/// Betim analizi (`set_ai_metadata`) Layer 1'in deterministik `ai_gorsel_turu` etiketini SILMEZ
/// (image.rs DELETE `ai_gorsel_turu`'yu haric tutar). Yoksa her yeniden-analiz Katman 1
/// heuristik siniflandirmasini yok ederdi.
#[test]
fn set_ai_metadata_preserves_image_kind_label() {
    use archivist_db::ImageKind;
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = ingest(&mut db, r"C:\arsiv\IMG_kind.jpg", "IMG_kind.jpg", None);

    // Katman 1 heuristik etiketi (EAV-only).
    assert!(db.write_image_kind(id, ImageKind::Render).unwrap(), "ilk yazim");

    // Betim analizi ai_aciklama vb. yazar (ai_gorsel_turu ICERMEZ).
    db.set_ai_metadata(id, &[("ai_aciklama", "cami avlusu bulut".to_string())]).unwrap();

    // ai_gorsel_turu KORUNDU (betim analizi silmedi).
    let kind: String = db
        .connection()
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id=?1 AND key='ai_gorsel_turu'",
            [id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(kind, "Render", "betim analizi Katman 1 etiketini silmemeli");
    // Betim de yazildi (ai kolonu aranabilir).
    assert_eq!(db.list_assets(&q("cami bulut")).unwrap().total, 1);
}
