//! Gercek-model entegrasyon testi (#[ignore] — 470MB ONNX gerektirir).
//!
//! Calistir:
//!   $env:ARSIV_EMBED_MODEL_DIR="C:\Arsiv-H2\public\models\Xenova\paraphrase-multilingual-MiniLM-L12-v2"
//!   cargo test -p archivist-embed --test real_model -- --ignored --nocapture
//!
//! Kanit: (1) cikti 384-boyut + L2-norm ~1, (2) anlamsal yakinlik — ilgili tumce
//! cifti, ilgisizden daha yuksek cosine benzerligi verir (multilingual MiniLM calisiyor).

use archivist_embed::{TextEmbedder, TEXT_EMBED_DIM};

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[test]
#[ignore = "gercek ONNX modeli gerektirir (ARSIV_EMBED_MODEL_DIR)"]
fn real_minilm_embeds_and_ranks_semantically() {
    let dir = std::env::var("ARSIV_EMBED_MODEL_DIR")
        .expect("ARSIV_EMBED_MODEL_DIR ayarli olmali");
    let mut emb = TextEmbedder::from_dir(&dir).expect("model yuklenmeli");

    // 1) Boyut + normalize.
    let v = emb.embed("mimari proje cizimi").unwrap();
    assert_eq!(v.len(), TEXT_EMBED_DIM, "384-boyut beklenir");
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!((norm - 1.0).abs() < 1e-3, "L2-norm ~1 olmali, {norm}");

    // 2) Anlamsal siralama (Turkce, cok-dilli model).
    let q = emb.embed("banyo wc tesisat plani").unwrap();
    let related = emb.embed("islak hacim sihhi tesisat detayi").unwrap();
    let unrelated = emb.embed("yemek tarifi ve mutfak alisveris listesi").unwrap();

    let s_rel = cosine(&q, &related);
    let s_unrel = cosine(&q, &unrelated);
    println!("cosine ilgili={s_rel:.4}  ilgisiz={s_unrel:.4}");
    assert!(
        s_rel > s_unrel,
        "ilgili tumce ilgisizden yuksek benzerlik vermeli ({s_rel} > {s_unrel})"
    );
}
