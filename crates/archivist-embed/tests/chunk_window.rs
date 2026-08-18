//! Chunk penceresi nobetcisi (#[ignore] — gercek tokenizer gerektirir).
//!
//! Kilitledigi kusur (2026-08-18): parcalama **kelime** ile, kirpma **token** ile
//! yapiliyordu. Turkce cikarilmis arsiv metninde oran olculdu — **3,29 token/kelime**
//! (medyan 2,77 · p90 3,95 · max 13,3), yani 500 kelimelik parca ~1650 token ediyor ve
//! 256'lik pencerede ucte ikisi vektore HIC girmiyordu (olculen kapsama %33,8).
//! Kelime sayisi token butcesini garanti EDEMEZ → sinir tokenizer'in kendisiyle kurulur.
//!
//! Calistir:
//!   $env:ARSIV_EMBED_MODEL_DIR="...\paraphrase-multilingual-MiniLM-L12-v2"
//!   cargo test -p archivist-embed --test chunk_window -- --ignored --nocapture

use archivist_embed::{TextEmbedder, CHUNK_OVERLAP_TOKENS, CHUNK_TOKENS, MAX_TOKENS};

/// Token-agir Turkce metin (cikarilmis PDF/DWG dokusunu taklit eder: ek almis sozcukler,
/// olcu/kod parcalari) — kelime sayisi kucuk gorunse de token sayisi yuksektir.
fn turkish_corpus(reps: usize) -> String {
    let unit = "Zemin kat yerlesim planinda tasiyici perde duvarlarin kalinliklari \
        25 cm olarak belirlenmistir; yalitim detaylandirmalarinda XPS 5cm kullanilacaktir. \
        Paftalarda olcek 1/50 olup, kotlar +0.00 referansina goredir. Islak hacimlerdeki \
        su yalitimi surme esasli olacak, birlesim yerlerinde file kullanilacaktir. \
        Cephe kaplamasinda kompozit panel K-12/A3 tipi, ic bolme duvarlarda alcipan \
        sistemi uygulanacaktir. ";
    unit.repeat(reps)
}

fn ntok(emb: &TextEmbedder, s: &str) -> usize {
    emb.token_len(s).expect("tokenize")
}

#[test]
#[ignore = "gercek tokenizer gerektirir (ARSIV_EMBED_MODEL_DIR)"]
fn chunks_never_exceed_embed_window() {
    let dir = std::env::var("ARSIV_EMBED_MODEL_DIR").expect("ARSIV_EMBED_MODEL_DIR ayarli olmali");
    let emb = TextEmbedder::from_dir(&dir).expect("model yuklenmeli");

    let text = turkish_corpus(40);
    let words = text.split_whitespace().count();
    let tokens = ntok(&emb, &text);
    println!(
        "kaynak: {words} kelime / {tokens} token  (oran {:.2} token/kelime)",
        tokens as f64 / words as f64
    );
    assert!(
        tokens as f64 / words as f64 > 1.5,
        "bu nobetci token-agir metin ister; oran {:.2} ise ornek zayiflamis",
        tokens as f64 / words as f64
    );

    let chunks = emb
        .chunk_by_tokens(&text, CHUNK_TOKENS, CHUNK_OVERLAP_TOKENS)
        .expect("parcalanmali");
    assert!(chunks.len() > 1, "uzun metin birden cok parca vermeli");

    // ① Hicbir parca embed penceresini asmaz (ozel token payi dahil).
    for (i, c) in chunks.iter().enumerate() {
        let n = ntok(&emb, c);
        assert!(
            n <= CHUNK_TOKENS,
            "parca {i} butceyi asti: {n} > {CHUNK_TOKENS}"
        );
        assert!(
            n + 2 <= MAX_TOKENS,
            "parca {i} ozel token'larla birlikte kirpilir: {n}+2 > {MAX_TOKENS}"
        );
    }

    // ② KAPSAMA: kaynak metnin her kelimesi en az bir parcada gecmeli (kayip yok).
    // Eski kelime-bazli ayarda bu ozellik saglanmiyordu (metnin ~2/3'u dusuyordu).
    let joined = chunks.join(" ");
    let missing: Vec<&str> = text
        .split_whitespace()
        .filter(|w| w.len() > 3 && !joined.contains(*w))
        .collect();
    assert!(
        missing.is_empty(),
        "parcalar metni tam kapsamali; eksik ornek: {:?}",
        &missing[..missing.len().min(5)]
    );

    // ③ Ortusme sabiti anlamli aralikta olmali (0 < x < pencere) — derleme zamaninda.
    const { assert!(CHUNK_OVERLAP_TOKENS > 0 && CHUNK_OVERLAP_TOKENS < CHUNK_TOKENS) };

    println!(
        "parca sayisi: {} · en buyuk parca: {} token (pencere {CHUNK_TOKENS}, embed siniri {MAX_TOKENS})",
        chunks.len(),
        chunks.iter().map(|c| ntok(&emb, c)).max().unwrap_or(0)
    );
}

#[test]
#[ignore = "gercek tokenizer gerektirir (ARSIV_EMBED_MODEL_DIR)"]
fn short_text_stays_single_chunk_and_utf8_is_never_split() {
    let dir = std::env::var("ARSIV_EMBED_MODEL_DIR").expect("ARSIV_EMBED_MODEL_DIR ayarli olmali");
    let emb = TextEmbedder::from_dir(&dir).expect("model yuklenmeli");

    let short = "Çağrı Şişli'deki ofisin ıslak hacim detayı — ölçek 1/20.";
    let out = emb.chunk_by_tokens(short, CHUNK_TOKENS, CHUNK_OVERLAP_TOKENS).unwrap();
    assert_eq!(out, vec![short.to_string()], "kisa metin tek parca kalmali");

    assert!(
        emb.chunk_by_tokens("   ", CHUNK_TOKENS, CHUNK_OVERLAP_TOKENS).unwrap().is_empty(),
        "bos metin parca uretmemeli"
    );

    // Turkce cok-baytli harfler kesim noktasinda bolunmemeli (panik/bozuk karakter yok).
    let tr = "ığüşöçİĞÜŞÖÇ ".repeat(400);
    let parts = emb.chunk_by_tokens(&tr, 32, 8).unwrap();
    assert!(parts.len() > 1, "uzun metin bolunmeli");
    for p in &parts {
        assert!(p.chars().count() > 0);
        assert!(!p.contains('\u{FFFD}'), "bozuk karakter uretilmemeli");
    }
}
