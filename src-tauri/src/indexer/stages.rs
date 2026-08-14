//! Yerel indeksleme asamalari (metin · gorsel · chunk) + asama-destek yardimcilari.
//!
//! `mod.rs`'teki `run_pass` bu uc asamayi sirayla surer; her asama best-effort'tur (modeli
//! yoksa graceful atlar) ve asset-arasi kilit birakir. Skip/ilerleme yardimcilari (`mark_skip`,
//! `emit_progress`) yalniz bu modul icinde kullanilir → private.

use std::sync::atomic::Ordering;
use std::time::Instant;

use tauri::{AppHandle, Emitter};

use archivist_db::IndexStage;

use crate::embed_commands::{ensure_embedder, resolve_model_dir};
use crate::image_commands::{ensure_image_embedder, resolve_clip_dir};
use crate::rag_commands::index_one;
use crate::AppState;

use super::{IndexProgress, IndexSummary, BATCH, EMIT_THROTTLE_MS, MAX_SKIP_REASON, STOP};

/// Bir asset'in bir stage'ini KALICI basarisiz isaretle (kisa db kilidi) + `sum.skipped++` + dev
/// konsolu (H2 vision deseni: hatayi yutma → gorunur). Pending sorgusu bunu dislar → terminlenir.
fn mark_skip(state: &AppState, id: i64, stage: IndexStage, reason: &str, sum: &mut IndexSummary) {
    let short: String = reason.chars().take(MAX_SKIP_REASON).collect();
    if let Ok(db) = state.db.lock() {
        let _ = db.record_index_skip(id, stage, &short);
    }
    sum.skipped += 1;
    eprintln!("[indexer] skip {} #{id}: {short}", stage.as_str());
}

/// İlerleme yayini (throttle: ilk + son + ~150ms arayla). Hicbir kilit tutulmadan cagrilir.
fn emit_progress(
    app: &AppHandle,
    stage: &'static str,
    processed: i64,
    total: i64,
    path: &str,
    last_emit: &mut Option<Instant>,
) {
    let now = Instant::now();
    let is_last = processed >= total;
    let due = last_emit.is_none_or(|t| now.duration_since(t).as_millis() >= EMIT_THROTTLE_MS);
    if processed == 1 || is_last || due {
        *last_emit = Some(now);
        let _ = app.emit(
            "index_progress",
            IndexProgress {
                stage,
                processed,
                total,
                current_path: path.to_string(),
            },
        );
    }
}

/// Metin (MiniLM 384) embedding stage'i. Model yoksa graceful atla. Asset-basina: embed (embedder
/// kilidi, kisa) → set_vector (db kilidi, kisa) → basarisiz ise skip. Kilitler asset-arasi birakilir.
pub(super) fn run_text_stage(app: &AppHandle, state: &AppState, sum: &mut IndexSummary) {
    let Ok(dir) = resolve_model_dir() else {
        return; // model yok → sessiz atla (P0.4 import edilene dek; semantik arama gibi graceful).
    };
    let total = {
        let Ok(db) = state.db.lock() else { return };
        db.pending_embed_count().unwrap_or(0)
    };
    if total == 0 {
        return;
    }
    let (mut processed, mut after_id) = (0i64, 0i64);
    let mut last_emit: Option<Instant> = None;
    loop {
        if STOP.load(Ordering::SeqCst) {
            return;
        }
        let batch = {
            let Ok(db) = state.db.lock() else { return };
            match db.assets_without_vectors(after_id, BATCH) {
                Ok(b) => b,
                Err(_) => return,
            }
        };
        if batch.is_empty() {
            return;
        }
        for p in &batch {
            if STOP.load(Ordering::SeqCst) {
                return;
            }
            after_id = p.id;
            // Embed — yalniz embedder kilidi (embed bittikten sonra db icin birakilir).
            let embedded = {
                let mut g = match state.embedder.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                ensure_embedder(&mut g, &dir).and_then(|e| e.embed(&p.embed_text()).map_err(|e| e.to_string()))
            };
            match embedded {
                Ok(v) => {
                    let w = {
                        let Ok(db) = state.db.lock() else { return };
                        db.set_vector(p.id, &v).map_err(|e| e.to_string())
                    };
                    match w {
                        Ok(()) => sum.embedded += 1,
                        Err(e) => mark_skip(state, p.id, IndexStage::Text, &e, sum),
                    }
                }
                Err(e) => mark_skip(state, p.id, IndexStage::Text, &e, sum),
            }
            processed += 1;
            emit_progress(app, "text", processed, total, &p.file_name, &mut last_emit);
        }
    }
}

/// Gorsel (CLIP 512) embedding stage'i. Model yoksa graceful atla. Asset-basina: embed_image_regions
/// (5 uzamsal bolge; image_embedder kilidi) → set_image_region_vectors (db) → basarisiz ise skip.
/// Yalniz thumbnail'i olanlar. Cok-bolge → metin→gorsel aramada asset basina BOLGE-MAX (kompozisyon).
pub(super) fn run_image_stage(app: &AppHandle, state: &AppState, sum: &mut IndexSummary) {
    let Ok(dir) = resolve_clip_dir() else {
        return; // CLIP yok → sessiz atla.
    };
    let total = {
        let Ok(db) = state.db.lock() else { return };
        db.pending_image_embed_count().unwrap_or(0)
    };
    if total == 0 {
        return;
    }
    let (mut processed, mut after_id) = (0i64, 0i64);
    let mut last_emit: Option<Instant> = None;
    loop {
        if STOP.load(Ordering::SeqCst) {
            return;
        }
        let batch = {
            let Ok(db) = state.db.lock() else { return };
            match db.assets_without_image_vectors(after_id, BATCH) {
                Ok(b) => b,
                Err(_) => return,
            }
        };
        if batch.is_empty() {
            return;
        }
        for p in &batch {
            if STOP.load(Ordering::SeqCst) {
                return;
            }
            after_id = p.id;
            let embedded = {
                let mut g = match state.image_embedder.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                ensure_image_embedder(&mut g, &dir)
                    .and_then(|e| e.embed_image_regions(&p.thumb_bytes).map_err(|e| e.to_string()))
            };
            match embedded {
                Ok(regions) => {
                    let w = {
                        let Ok(db) = state.db.lock() else { return };
                        db.set_image_region_vectors(p.id, &regions).map_err(|e| e.to_string())
                    };
                    match w {
                        Ok(()) => sum.image_embedded += 1,
                        Err(e) => mark_skip(state, p.id, IndexStage::Image, &e, sum),
                    }
                }
                Err(e) => mark_skip(state, p.id, IndexStage::Image, &e, sum),
            }
            processed += 1;
            emit_progress(app, "image", processed, total, &p.file_name, &mut last_emit);
        }
    }
}

/// RAG chunk stage'i (metadata + govde chunk → MiniLM). Model yoksa graceful atla. `index_one`
/// hem db hem embedder ister → asset-basina ikisi birlikte kilitlenir (sira embedder→db; manuel
/// komutlarla ayni → deadlock yok), asset-arasi birakilir.
pub(super) fn run_chunk_stage(app: &AppHandle, state: &AppState, sum: &mut IndexSummary) {
    let Ok(dir) = resolve_model_dir() else {
        return;
    };
    let total = {
        let Ok(db) = state.db.lock() else { return };
        db.pending_chunk_count().unwrap_or(0)
    };
    if total == 0 {
        return;
    }
    let (mut processed, mut after_id) = (0i64, 0i64);
    let mut last_emit: Option<Instant> = None;
    loop {
        if STOP.load(Ordering::SeqCst) {
            return;
        }
        let batch = {
            let Ok(db) = state.db.lock() else { return };
            match db.assets_without_chunks(after_id, BATCH) {
                Ok(b) => b,
                Err(_) => return,
            }
        };
        if batch.is_empty() {
            return;
        }
        for p in &batch {
            if STOP.load(Ordering::SeqCst) {
                return;
            }
            after_id = p.id;
            // index_one hem db.get_asset hem embedder.embed_batch hem db.set_asset_chunks yapar →
            // ikisi birlikte tutulur (embedder→db sirasi). Asset-arasi birakilir → UI okumasi akar.
            let res = {
                let mut g = match state.embedder.lock() {
                    Ok(g) => g,
                    Err(_) => return,
                };
                match ensure_embedder(&mut g, &dir) {
                    Ok(embedder) => {
                        let Ok(db) = state.db.lock() else { return };
                        index_one(&db, embedder, p)
                    }
                    Err(e) => Err(e),
                }
            };
            match res {
                Ok(_) => sum.chunked += 1,
                Err(e) => mark_skip(state, p.id, IndexStage::Chunk, &e, sum),
            }
            processed += 1;
            emit_progress(app, "chunk", processed, total, &p.file_name, &mut last_emit);
        }
    }
}
