//! Faz 5.1 — semantik (vektor) arama komutlari + embedding uretim koordinatoru.
//!
//! Mimari ayrim: `archivist-db` ONNX'ten BAGIMSIZ (yalniz vektor yazar/arar);
//! embedding URETIMI burada (`archivist-embed::TextEmbedder` ile) yapilir. Embedder
//! pahali (470MB model) → bir kez yuklenir, `AppState.embedder`'da onbelleklenir.
//!
//! Komutlar:
//!   - `embed_status`   : embedlenmis/bekleyen/toplam sayim + model hazir mi (UI rozeti).
//!   - `run_embedding`  : bekleyen asset'leri batch'le embedle (admin, resumable, Channel ilerleme).
//!   - `semantic_search`: sorgu metnini embedle → sqlite-vec kNN → filtreli sonuç.

use std::path::{Path, PathBuf};
use std::time::Instant;

use archivist_db::{AssetPage, ListOpts};
use archivist_embed::TextEmbedder;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::{rbac, AppState};

/// HF/Xenova model dizin adi (tokenizer.json + onnx/model.onnx icerir).
const MODEL_NAME: &str = "paraphrase-multilingual-MiniLM-L12-v2";
/// Embed batch boyu — her batch sonrasi ilerleme; her vektor ayri TX (resumable).
const BATCH: i64 = 64;

/// Model dizinini coz: (1) `ARSIV_EMBED_MODEL_DIR` override, (2) **app_local_data_dir/models**
/// (P0.4 import hedefi), (3) exe-yani/cwd `models/<ad>`, (4) yalniz DEV derleme: H2 kaynak-makine
/// fallback'i. `tokenizer.json` iceren ilk var olan dizin secilir.
pub(crate) fn resolve_model_dir() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(d) = archivist_embed::model_dir_from_env() {
        candidates.push(d);
    }
    // P0.4: import hedefi (app_local_data_dir/models) — override'dan sonra ILK aday.
    if let Some(root) = crate::model_commands::models_root() {
        candidates.push(root.join(MODEL_NAME));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("models").join(MODEL_NAME));
        }
    }
    candidates.push(PathBuf::from("models").join(MODEL_NAME));
    // Yalniz DEV derlemede: H2'nin offline model paketi (kaynak makine); prod'da footgun → haric.
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(r"C:\Arsiv-H2\public\models\Xenova").join(MODEL_NAME));

    for c in candidates {
        if c.join("tokenizer.json").exists() {
            return Ok(c);
        }
    }
    Err(format!(
        "embedding modeli bulunamadi — ARSIV_EMBED_MODEL_DIR ayarlayin ya da modeli \
         models/{MODEL_NAME}/ altina koyun (tokenizer.json + onnx/model.onnx)"
    ))
}

/// Embedder'i (gerekiyorsa) yukle ve mutable referans dondur. Pahali yukleme yalniz
/// ilk cagrida; sonra onbellekten. `guard`: `AppState.embedder` kilidi.
pub(crate) fn ensure_embedder<'a>(
    guard: &'a mut Option<TextEmbedder>,
    dir: &Path,
) -> Result<&'a mut TextEmbedder, String> {
    if guard.is_none() {
        let e = TextEmbedder::from_dir(dir).map_err(|e| e.to_string())?;
        *guard = Some(e);
    }
    Ok(guard.as_mut().expect("embedder yuklendi"))
}

/// Embedding durum ozeti (UI: "X / N embedlendi" + model hazir mi).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedStatusDto {
    /// Vektoru olan aktif asset (= total - pending).
    pub embedded: i64,
    /// Vektoru olmayan aktif asset.
    pub pending: i64,
    /// Toplam aktif asset (cop haric).
    pub total: i64,
    /// Model dosyalari cozulebiliyor mu (run_embedding/semantic_search calisabilir mi).
    pub model_ready: bool,
}

/// Embedding uretim ilerlemesi (Channel; ingest deseni, camelCase).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedProgressDto {
    pub processed: i64,
    pub total: i64,
    pub current_path: String,
}

/// Embedding kosusu raporu.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedRunReportDto {
    pub embedded: i64,
    pub failed: i64,
    pub elapsed_ms: u128,
}

/// Embedding durumu (rol gate yok — okuma). `model_ready` dosya kontrolu (model yuklemez).
#[tauri::command(async)]
pub fn embed_status(state: State<'_, AppState>) -> Result<EmbedStatusDto, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let total = db.asset_count().map_err(|e| e.to_string())?;
    let pending = db.pending_embed_count().map_err(|e| e.to_string())?;
    Ok(EmbedStatusDto {
        embedded: total - pending,
        pending,
        total,
        model_ready: resolve_model_dir().is_ok(),
    })
}

/// Bekleyen asset'leri batch'le embedle. **Admin-gated.** Resumable: her vektor ayri TX;
/// embed basarisiz olan asset cursor (`after_id`) ile atlanir (sonsuz dongu yok), sonraki
/// kosuda yeniden denenir. İlerleme Channel ile akar (~100ms throttle, ilk/son daima).
// `async fn` → Tauri bunu ana iş parcacigi DISINDA (async runtime) kosturur; senkron olsaydi
// uzun embedleme dongusu UI'yi DONDURURDU. Govde tamamen bloklayici (`.await` yok) → MutexGuard
// hicbir await sinirini gecmez (Send-future guvenli); ana thread serbest, ilerleme Channel akar.
#[tauri::command]
pub async fn run_embedding(
    on_progress: Channel<EmbedProgressDto>,
    state: State<'_, AppState>,
) -> Result<EmbedRunReportDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    let dir = resolve_model_dir()?;
    let mut emb_guard = state.embedder.lock().map_err(|e| e.to_string())?;
    let embedder = ensure_embedder(&mut emb_guard, &dir)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let total = db.pending_embed_count().map_err(|e| e.to_string())?;
    let start = Instant::now();
    let (mut embedded, mut failed, mut processed, mut after_id) = (0i64, 0i64, 0i64, 0i64);
    let mut last_emit: Option<Instant> = None;

    loop {
        let batch = db
            .assets_without_vectors(after_id, BATCH)
            .map_err(|e| e.to_string())?;
        if batch.is_empty() {
            break;
        }
        for p in &batch {
            after_id = p.id; // cursor ilerlet → basarisiz embed tekrar getirilmez.
            match embedder.embed(&p.embed_text()) {
                Ok(v) => match db.set_vector(p.id, &v) {
                    Ok(()) => embedded += 1,
                    Err(_) => failed += 1,
                },
                Err(_) => failed += 1,
            }
            processed += 1;

            let now = Instant::now();
            let is_last = processed >= total;
            let due = last_emit.is_none_or(|t| now.duration_since(t).as_millis() >= 100);
            if processed == 1 || is_last || due {
                last_emit = Some(now);
                let _ = on_progress.send(EmbedProgressDto {
                    processed,
                    total,
                    current_path: p.file_name.clone(),
                });
            }
        }
    }

    Ok(EmbedRunReportDto {
        embedded,
        failed,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

/// Semantik arama: sorgu metnini embedle → sqlite-vec kNN → filtreli sonuç (mesafe artan).
/// Rol gate yok (okuma). Bos sorgu → bos sonuç. Model ilk cagrida yuklenir (onbelleklenir).
#[tauri::command(async)]
pub fn semantic_search(
    query: String,
    opts: ListOpts,
    state: State<'_, AppState>,
) -> Result<AssetPage, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(AssetPage {
            total: 0,
            items: Vec::new(),
        });
    }
    let dir = resolve_model_dir()?;
    let mut emb_guard = state.embedder.lock().map_err(|e| e.to_string())?;
    let embedder = ensure_embedder(&mut emb_guard, &dir)?;
    let qvec = embedder.embed(q).map_err(|e| e.to_string())?;

    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.semantic_search(&qvec, &opts).map_err(|e| e.to_string())
}
