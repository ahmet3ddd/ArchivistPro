//! GENEL metadata (EAV) filtresi — `ListOpts.metadata` / `FILTER_FRAG` `:metadata` dali.
//!
//! Test-first (2026-07-19). Bu dal, anahtar-basina ayri `ListOpts` alani acmaya son verir
//! (`:gorsel_turu` deseni): anahtar adi SQL'e gomulmez, JSON'dan `json_extract` ile okunur.
//! Sinanan semantik — mevcut facet'lerin AYNISI:
//!   · anahtar-ici **OR** (secili degerlerden herhangi biri)
//!   · anahtarlar-arasi **AND** (her anahtar ayri kosul)
//!   · bos → filtre yok · §O cop (soft-delete) sizmaz
//!
//! Kapsanan gercek veri: `unit_type` (Metre/Santimetre/Milimetre) ve `version`
//! (AutoCAD 2007/2010) — dev DB'de olculen degerler (STATUS ⑧).

use archivist_db::{AssetInput, Db, IngestData, ListOpts, MetaFilter, MetaVal};

/// Ingest + verilen metadata ciftlerini yaz → asset id.
fn seed(db: &mut Db, path: &str, meta: &[(&str, &str)]) -> i64 {
    let input = AssetInput {
        path,
        file_name: path.rsplit('/').next().unwrap(),
        ext: Some("dwg"),
        size_bytes: 10,
        content_hash: None,
        mime: None,
        title: None,
        description: None,
        created_at: 1,
        modified_at: 1,
    };
    let owned: Vec<(String, MetaVal)> =
        meta.iter().map(|(k, v)| ((*k).to_string(), MetaVal::Text((*v).to_string()))).collect();
    let data = IngestData {
        fts_body: None,
        metadata: &owned,
        auto_tags: &[],
        phash: None,
        thumbnail: None,
    };
    db.ingest(&input, &data).unwrap()
}

/// Filtreyi kos → donen asset id'leri (sirali, karsilastirilabilir).
fn ids(db: &Db, filters: Vec<MetaFilter>) -> Vec<i64> {
    let opts = ListOpts { page_size: 100, metadata: filters, ..Default::default() };
    let mut got: Vec<i64> = db.list_assets(&opts).unwrap().items.iter().map(|a| a.id).collect();
    got.sort_unstable();
    got
}

fn mf(key: &str, values: &[&str]) -> MetaFilter {
    MetaFilter {
        key: key.to_string(),
        values: values.iter().map(|v| (*v).to_string()).collect(),
    }
}

/// Bos `metadata` → dal kisa-devre; TUM asset'ler doner (regresyon nobeti: yanlis kurulmus
/// bir `NOT EXISTS` burada listeyi sessizce bosaltirdi).
#[test]
fn bos_filtre_hicbir_seyi_elemez() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&mut db, "/a/1.dwg", &[("unit_type", "Metre")]);
    let b = seed(&mut db, "/a/2.dwg", &[]); // metadata'si HIC yok
    assert_eq!(ids(&db, vec![]), vec![a, b], "filtre yokken metadata'sizlar da gelmeli");
}

/// Tek anahtar, tek deger → yalniz eslesenler.
#[test]
fn tek_deger_eslesir() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let m = seed(&mut db, "/a/metre.dwg", &[("unit_type", "Metre")]);
    let _s = seed(&mut db, "/a/santim.dwg", &[("unit_type", "Santimetre")]);
    let _y = seed(&mut db, "/a/yok.dwg", &[]);
    assert_eq!(ids(&db, vec![mf("unit_type", &["Metre"])]), vec![m]);
}

/// **Anahtar-ici OR**: ayni anahtarda iki deger → ikisinden HERHANGI biri eslesir.
#[test]
fn anahtar_ici_or() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let m = seed(&mut db, "/a/metre.dwg", &[("unit_type", "Metre")]);
    let s = seed(&mut db, "/a/santim.dwg", &[("unit_type", "Santimetre")]);
    let _mm = seed(&mut db, "/a/mili.dwg", &[("unit_type", "Milimetre")]);
    assert_eq!(ids(&db, vec![mf("unit_type", &["Metre", "Santimetre"])]), vec![m, s]);
}

/// **Anahtarlar-arasi AND**: iki ayri anahtar → asset IKISINI DE karsilamali.
/// (Bu, cift `NOT EXISTS` kurgusunun asil sinavi.)
#[test]
fn anahtarlar_arasi_and() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let ikisi = seed(&mut db, "/a/ikisi.dwg", &[("unit_type", "Metre"), ("version", "AutoCAD 2007")]);
    let _yalniz_birim = seed(&mut db, "/a/birim.dwg", &[("unit_type", "Metre")]);
    let _yalniz_surum = seed(&mut db, "/a/surum.dwg", &[("version", "AutoCAD 2007")]);
    let _baska = seed(&mut db, "/a/baska.dwg", &[("unit_type", "Metre"), ("version", "AutoCAD 2010")]);

    let got = ids(&db, vec![mf("unit_type", &["Metre"]), mf("version", &["AutoCAD 2007"])]);
    assert_eq!(got, vec![ikisi], "yalniz her IKI anahtari da karsilayan asset");
}

/// Degeri BOS olan girdi elenmeli → "anahtari sec, deger secme" = o anahtarda filtre YOK.
/// Elenmezse ic `IN (...)` hicbir seyle eslesmez ve liste sessizce bosalirdi.
#[test]
fn bos_deger_listesi_o_anahtari_filtre_disi_birakir() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let m = seed(&mut db, "/a/metre.dwg", &[("unit_type", "Metre")]);
    let s = seed(&mut db, "/a/santim.dwg", &[("unit_type", "Santimetre")]);

    assert_eq!(ids(&db, vec![mf("unit_type", &[])]), vec![m, s], "bos deger → filtre yok");
    // Dolu bir anahtarla birlikte gelirse: bos olan yok sayilir, dolu olan uygulanir.
    let got = ids(&db, vec![mf("version", &[]), mf("unit_type", &["Metre"])]);
    assert_eq!(got, vec![m], "bos girdi elenir, dolu girdi uygulanir");
}

/// Bilinmeyen anahtar / bilinmeyen deger → bos sonuc (sessiz "hepsini goster"e DUSMEZ).
#[test]
fn bilinmeyen_anahtar_ve_deger_bos_doner() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    seed(&mut db, "/a/1.dwg", &[("unit_type", "Metre")]);
    assert!(ids(&db, vec![mf("boyle_bir_anahtar_yok", &["x"])]).is_empty());
    assert!(ids(&db, vec![mf("unit_type", &["Parsek"])]).is_empty());
}

/// §O cop kutusu: soft-delete'lenmis asset filtreye SIZMAZ (FILTER_FRAG ilk kosulu).
#[test]
fn cop_sizmaz() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let kalan = seed(&mut db, "/a/kalan.dwg", &[("unit_type", "Metre")]);
    let atilan = seed(&mut db, "/a/atilan.dwg", &[("unit_type", "Metre")]);
    db.soft_delete(&[atilan]).unwrap();
    assert_eq!(ids(&db, vec![mf("unit_type", &["Metre"])]), vec![kalan]);
}

/// Tirnak/ters-bolu/Unicode iceren anahtar ve deger PARAMETRE olarak baglanir → SQL'e gomulmez.
/// (Anahtar adi da JSON'dan geldigi icin injection yuzeyi degil; test bunun nobeti.)
#[test]
fn tirnakli_ve_unicode_degerler_guvenli() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let tuhaf = seed(&mut db, "/a/tuhaf.dwg", &[("ölçü'birim", "1\" x 2\\ Ölçek")]);
    let _duz = seed(&mut db, "/a/duz.dwg", &[("unit_type", "Metre")]);
    assert_eq!(ids(&db, vec![mf("ölçü'birim", &["1\" x 2\\ Ölçek"])]), vec![tuhaf]);
    // Klasik injection denemesi bir DEGER olarak kalir, sozdizimi olmaz.
    assert!(ids(&db, vec![mf("unit_type", &["Metre') OR 1=1 --"])]).is_empty());
}

/// Diger facet'lerle birlikte AND'lenir (uzanti + metadata) — facet-arasi kesisim korunur.
#[test]
fn diger_facetlerle_and() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let dwg = seed(&mut db, "/a/1.dwg", &[("unit_type", "Metre")]);
    // Ayni metadata'ya sahip ama farkli uzantili bir asset.
    let input = AssetInput {
        path: "/a/2.max",
        file_name: "2.max",
        ext: Some("max"),
        size_bytes: 10,
        content_hash: None,
        mime: None,
        title: None,
        description: None,
        created_at: 1,
        modified_at: 1,
    };
    let owned = vec![("unit_type".to_string(), MetaVal::Text("Metre".to_string()))];
    let data =
        IngestData { fts_body: None, metadata: &owned, auto_tags: &[], phash: None, thumbnail: None };
    db.ingest(&input, &data).unwrap();

    let opts = ListOpts {
        page_size: 100,
        ext: vec!["dwg".to_string()],
        metadata: vec![mf("unit_type", &["Metre"])],
        ..Default::default()
    };
    let got: Vec<i64> = db.list_assets(&opts).unwrap().items.iter().map(|a| a.id).collect();
    assert_eq!(got, vec![dwg], "uzanti VE metadata birlikte daraltir");
}
