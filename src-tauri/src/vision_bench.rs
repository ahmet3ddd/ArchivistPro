//! Vision MODEL KARSILASTIRMASI — gercek arsiv gorselleri uzerinde, URETIM yoluyla.
//!
//! Amac: "hangi vision modeli?" karari TAHMINLE degil OLCUMLE verilsin (kullanici direktifi
//! 2026-08-07). 4 GB kartta model GPU'ya tam sigmazsa sure onlarca kat artiyor; ama kucuk model
//! daha yuzeysel betim uretiyor. Bu takas ancak GERCEK arsiv gorselleriyle degerlendirilebilir.
//!
//! **Uretim paritesi (kritik):** sentetik istem/gorsel KULLANMAZ —
//! `super::higher_res_preview` (768px kaynak onizleme), `super::build_binary_context`,
//! `vision::build_vision_prompt`, `ollama::analyze_image`, `vision::parse_vision_response`
//! ve baglam-tasmasi lean-retry dali gercek kosudaki ile AYNI.
//!
//! DB **KOPYASI** uzerinde salt-okuma calisir (canli arsive dokunmaz).
//!
//! `#[ignore]` — gercek DB + calisan Ollama + yuklu modeller gerektirir. Calistir:
//! ```text
//! cargo test --manifest-path C:\Arsiv-H3\Cargo.toml -p archivist --lib \
//!   vision_bench -- --ignored --nocapture
//! ```
//! Ayarlar (env): `ARSIV_BENCH_DB` (arsiv DB yolu) · `ARSIV_BENCH_MODELS` (virgullu, sirali —
//! ilk model once TUM gorsellerde kosar ki model yeniden-yukleme maliyeti tekrarlanmasin) ·
//! `ARSIV_BENCH_N` (gorsel sayisi) · `ARSIV_BENCH_OUT` (JSON rapor yolu).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Instant;

use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;

use crate::{ollama, vision};

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).ok().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| default.to_string())
}

/// Canli arsiv DB'sinin varsayilan yolu (Tauri identity: `com.archivistpro.h3`).
fn default_db_path() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    PathBuf::from(appdata).join("com.archivistpro.h3").join("archivist.db")
}

/// Canli DB'yi (WAL/SHM yandaslariyla) gecici bir KOPYAYA al → olcum canli arsivi kilitlemez.
fn copy_db(src: &Path) -> PathBuf {
    let dir = std::env::temp_dir().join("arsiv_vision_bench");
    std::fs::create_dir_all(&dir).expect("gecici dizin olusturulamadi");
    let dst = dir.join("bench_copy.db");
    let _ = std::fs::remove_file(&dst);
    std::fs::copy(src, &dst).expect("DB kopyalanamadi");
    // WAL'de bekleyen yazimlar kopyaya da gelsin (yoksa kopya bayat gorunebilir).
    for suffix in ["-wal", "-shm"] {
        let s = PathBuf::from(format!("{}{suffix}", src.display()));
        if s.exists() {
            let _ = std::fs::copy(&s, PathBuf::from(format!("{}{suffix}", dst.display())));
        }
    }
    dst
}

/// Havuzdan **cesitli** ornek sec: uzantiya gore grupla, her gruptan esit-aralikli (stride) al.
/// Amac tek klasorden/tek dosya tipinden ibaret yanli ornek olmasin (fotograf + cizim karisimi).
fn pick_diverse(paths: &[String], want: usize) -> Vec<usize> {
    let mut by_ext: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, p) in paths.iter().enumerate() {
        let ext = Path::new(p)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("(uzantisiz)")
            .to_ascii_lowercase();
        by_ext.entry(ext).or_default().push(i);
    }
    let mut out = Vec::new();
    let mut round = 0usize;
    while out.len() < want {
        let mut added = false;
        for idxs in by_ext.values() {
            let stride = (idxs.len() / want.max(1)).max(1);
            if let Some(&i) = idxs.get(round * stride) {
                out.push(i);
                added = true;
                if out.len() >= want {
                    break;
                }
            }
        }
        if !added {
            break;
        }
        round += 1;
    }
    out
}

#[test]
#[ignore = "gercek arsiv DB + calisan Ollama + yuklu vision modelleri gerektirir"]
fn compare_vision_models_on_real_archive() {
    let db_path = PathBuf::from(env_or("ARSIV_BENCH_DB", &default_db_path().to_string_lossy()));
    assert!(db_path.exists(), "arsiv DB bulunamadi: {}", db_path.display());
    let models: Vec<String> = env_or("ARSIV_BENCH_MODELS", "llava:latest,moondream:latest")
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let want: usize = env_or("ARSIV_BENCH_N", "6").parse().unwrap_or(6);
    let out_path = PathBuf::from(env_or(
        "ARSIV_BENCH_OUT",
        &std::env::temp_dir().join("arsiv_vision_bench.json").to_string_lossy(),
    ));

    let copy = copy_db(&db_path);
    let db = archivist_db::Db::open_readonly(&copy).expect("DB kopyasi acilamadi");
    let pending_total = db.pending_analysis_count().expect("bekleyen sayisi okunamadi");
    println!("== Arsiv: {} · AI-analizi bekleyen: {pending_total}", db_path.display());

    // URETIM sorgusu — gercek kosunun isleyecegi kume (thumbnail'i olan, analizsiz, skip'siz).
    let pool = db.assets_without_analysis(0, 400).expect("bekleyen varliklar okunamadi");
    assert!(
        !pool.is_empty(),
        "AI-analizi bekleyen gorsel YOK — karsilastirma icin analizsiz varlik gerekir"
    );
    let paths: Vec<String> = pool.iter().map(|p| p.path.clone()).collect();
    let chosen = pick_diverse(&paths, want);
    println!("== Havuz: {} · secilen: {}", pool.len(), chosen.len());

    // Gorsel baytlari + baglam BIR KEZ hazirlanir → her model AYNI girdiyi gorur (adil karsilastirma).
    let mut images = Vec::new();
    // `bool`: cizim turu SORULACAK mi (dosya turune gore — bkz `vision::asks_drawing_type`).
    // Girdiyle birlikte tasinir ki her model AYNI istemi gorsun (adil karsilastirma).
    let mut inputs: Vec<(Vec<u8>, Option<String>, bool)> = Vec::new();
    for &i in &chosen {
        let p = &pool[i];
        let preview = super::higher_res_preview(&p.path);
        let from_source = preview.is_some();
        let bytes = preview.unwrap_or_else(|| p.thumb_bytes.clone());
        let ctx = super::build_binary_context(&db, p.id);
        println!(
            "  #{:<7} {:<45} {:>7} KB {}",
            p.id,
            p.file_name.chars().take(45).collect::<String>(),
            bytes.len() / 1024,
            if from_source { "(768px kaynak)" } else { "(depolanan thumb)" }
        );
        images.push(serde_json::json!({
            "id": p.id,
            "file_name": p.file_name,
            "path": p.path,
            "preview_b64": STANDARD.encode(&bytes),
            "preview_kb": bytes.len() / 1024,
            "from_source_preview": from_source,
            "has_binary_context": ctx.is_some(),
            // URETIM istemi aynen rapora — zaman-asimisiz dis olcum ayni girdiyi kullanabilsin
            // (istemi elle yeniden kurmak parite kaybi olurdu).
            "prompt": vision::build_vision_prompt(ctx.as_deref(), vision::asks_drawing_type(&p.path)),
        }));
        let ask_type = vision::asks_drawing_type(&p.path);
        inputs.push((bytes, ctx, ask_type));
    }

    // Model BASINA tum gorseller (model-basi tek yukleme) — gorsel-basi model degistirmek her
    // adima 80-140 sn yeniden-yukleme eklerdi ve olcumu anlamsizlastirirdi.
    let mut results = serde_json::Map::new();
    for model in &models {
        println!("\n== MODEL: {model}");
        let mut per_model = Vec::new();
        for (n, (bytes, ctx, ask_type)) in inputs.iter().enumerate() {
            let prompt = vision::build_vision_prompt(ctx.as_deref(), *ask_type);
            let t = Instant::now();
            let mut outcome = ollama::analyze_image(model, bytes, &prompt);
            // URETIM dali: kucuk-pencereli model (moondream 2048) zengin istemi tasirir →
            // baglamsiz (lean) tekrar dener. Olcum bunu gizlemez, RAPORLAR.
            let mut lean_retry = false;
            if ctx.is_some() && matches!(&outcome, Err(e) if super::is_ctx_overflow(e)) {
                lean_retry = true;
                outcome =
                    ollama::analyze_image(model, bytes, &vision::build_vision_prompt(None, *ask_type));
            }
            let ms = t.elapsed().as_millis();
            let entry = match outcome {
                Ok(raw) => {
                    let parsed = vision::parse_vision_response(&raw);
                    let eav: BTreeMap<String, String> =
                        parsed.to_eav().into_iter().map(|(k, v)| (k.to_string(), v)).collect();
                    println!(
                        "  [{n}] {:>6} ms · {:>5} karakter · {} alan{}",
                        ms,
                        raw.chars().count(),
                        eav.len(),
                        if lean_retry { " · LEAN-RETRY (baglam dusuruldu)" } else { "" }
                    );
                    serde_json::json!({
                        "ms": ms, "ok": true, "raw": raw,
                        "raw_chars": raw.chars().count(),
                        "eav": eav, "lean_retry": lean_retry,
                    })
                }
                Err(e) => {
                    println!("  [{n}] {ms:>6} ms · HATA: {e}");
                    serde_json::json!({ "ms": ms, "ok": false, "error": e, "lean_retry": lean_retry })
                }
            };
            per_model.push(entry);
        }
        results.insert(model.clone(), serde_json::Value::Array(per_model));
    }

    let report = serde_json::json!({
        "db": db_path.to_string_lossy(),
        "pending_total": pending_total,
        "pool_size": pool.len(),
        "models": models,
        "images": images,
        "results": results,
    });
    std::fs::write(&out_path, serde_json::to_string_pretty(&report).expect("JSON serilestirilemedi"))
        .expect("rapor yazilamadi");
    println!("\n== Rapor: {}", out_path.display());
}
