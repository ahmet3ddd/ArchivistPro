//! Uctan-uca semantik arama dogrulamasi (#[ignore] — gercek 470MB ONNX gerektirir).
//!
//! Uretim kod yolunu birebir kosar: assets_without_vectors → embed_text → TextEmbedder
//! → set_vector → semantic_search. Tauri katmani YOK (komut sarmasi disinda her sey ayni).
//!
//! Calistir:
//!   $env:ARSIV_EMBED_MODEL_DIR="C:\Arsiv-H2\public\models\Xenova\paraphrase-multilingual-MiniLM-L12-v2"
//!   cargo test -p archivist-db --test semantic_real -- --ignored --nocapture

use archivist_db::{Db, ListOpts};
use archivist_embed::TextEmbedder;
use rusqlite::params;

/// Asset + FTS govdesi ekle (ingest deseni: trigger fts satirini olusturur, body UPDATE).
fn seed(db: &Db, id: i64, file_name: &str, title: &str, body: &str) {
    let conn = db.connection();
    conn.execute(
        "INSERT INTO assets(id, path, file_name, ext, size_bytes, title, created_at, modified_at)
         VALUES (?1, ?2, ?3, 'pdf', 100, ?4, 1, 1)",
        params![id, format!("/proje/{file_name}"), file_name, title],
    )
    .unwrap();
    conn.execute(
        "UPDATE assets_fts SET body = ?1 WHERE asset_id = ?2",
        params![body, id],
    )
    .unwrap();
}

#[test]
#[ignore = "gercek ONNX modeli gerektirir (ARSIV_EMBED_MODEL_DIR)"]
fn end_to_end_semantic_search_ranks_relevant_first() {
    let dir = std::env::var("ARSIV_EMBED_MODEL_DIR").expect("ARSIV_EMBED_MODEL_DIR ayarli olmali");
    let mut emb = TextEmbedder::from_dir(&dir).expect("model yuklenmeli");
    let db = Db::open_in_memory_migrated().unwrap();

    // Gercekci mimari arsiv icerigi (Turkce).
    seed(&db, 1, "banyo_wc_tesisat.dwg", "Banyo WC Tesisat Plani",
        "islak hacim sihhi tesisat su gideri lavabo klozet dusakabin");
    seed(&db, 2, "elektrik_aydinlatma.dwg", "Elektrik Aydinlatma Projesi",
        "priz anahtar tablo kablo aydinlatma armatur");
    seed(&db, 3, "cephe_gorunus.dwg", "Bina Cephe Gorunusu",
        "dis cephe kaplama pencere kapi mimari gorunus");

    // Uretim yolu: bekleyenleri al, embed_text ile embedle, set_vector ile yaz.
    let pending = db.assets_without_vectors(0, 100).unwrap();
    let docs: Vec<(i64, Vec<f32>)> = pending
        .iter()
        .map(|p| (p.id, emb.embed(&p.embed_text()).unwrap()))
        .collect();
    for (id, v) in &docs {
        db.set_vector(*id, v).unwrap();
    }
    assert_eq!(db.pending_embed_count().unwrap(), 0, "hepsi embedlenmeli");

    // (1) PIPELINE SADAKATI (model-bagimsiz dogruluk): semantic_search'in dondurdugu
    //     siralama, ayni vektorlerle elde-hesaplanan cosine sirasiyla BIREBIR olmali —
    //     yani depolama (BLOB), mesafe (kNN) ve hidratlama dogru.
    let qvec = emb.embed("banyo tesisat").unwrap();
    let mut expected: Vec<(i64, f32)> = docs
        .iter()
        .map(|(id, v)| (*id, qvec.iter().zip(v).map(|(a, b)| a * b).sum::<f32>()))
        .collect();
    expected.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let exp_ids: Vec<i64> = expected.iter().map(|(id, _)| *id).collect();
    let page = db
        .semantic_search(&qvec, &ListOpts { page_size: 10, ..Default::default() })
        .unwrap();
    let got: Vec<i64> = page.items.iter().map(|r| r.id).collect();
    println!("semantik={got:?}  beklenen(manuel cosine)={exp_ids:?}");
    assert_eq!(got, exp_ids, "semantic_search manuel-cosine sirasini birebir vermeli");

    // (2) GERCEK SEMANTIK SIRALAMA (normal, kelime-ortusumlu sorgu): "banyo tesisat"
    //     banyo/tesisat belgesini (1) ilk siraya koymali. (Saf-sinonim sorgular —
    //     or. "musluk ariza" — MiniLM'de zayiftir; hibrit FTS+semantik sonraki artim.)
    assert_eq!(got.first(), Some(&1), "kelime-ortusumlu sorgu ilgili belgeyi ilk vermeli");
}
