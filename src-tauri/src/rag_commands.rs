//! RAG chunk indeksleme komutlari (Artim 2) — H2 textChunker.indexAssetForRag pariti.
//!
//! Her asset icin: (1) **metadata chunk** (chunk_index=-1: DOSYA/PROJE/ETIKET + EAV metadata
//! [DWG layers/blocks/unit/scale ...] → metni olmayan DWG/MAX bile aranabilir) + (2) **govde
//! chunk'lari** (yalniz BELGE turleri: pdf/doc(x)/xls(x)/ppt(x)/odt/txt/md/csv/rtf; assets_fts
//! body → chunk_text). Hepsi MiniLM ile embedlenir (embed_batch) → `set_asset_chunks` (tek TX).
//!
//! Mimari ayrim (embed_commands deseni): embedding URETIMI burada; archivist-db ONNX'ten
//! bagimsiz. Resumable (assets_without_chunks cursor) + admin-gated + Channel ilerleme.

use std::time::Instant;

use archivist_db::{
    chunk_text, AssetChunk, ChunkWrite, CollectionRef, MetaEntry, ProjectMetaOut, TagRef,
    DEFAULT_CHUNK_WORDS, DEFAULT_OVERLAP_WORDS, META_CHUNK_INDEX,
};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::embed_commands::{ensure_embedder, resolve_model_dir};
use crate::{rbac, AppState};

/// Govde metni cikarilan (chunk'lanan) belge turleri — H2 RAG_INDEXABLE_EXTENSIONS pariti.
/// Disindakiler (DWG/MAX/gorsel/...) yalniz **metadata chunk** alir (katman/proje/etiket).
const RAG_INDEXABLE_EXTENSIONS: &[&str] = &[
    "pdf", "doc", "docx", "xls", "xlsx", "xlsm", "xltx", "xltm", "ppt", "pptx", "odp", "ods",
    "odt", "txt", "md", "csv", "rtf",
];

/// İndeksleme batch boyu (resumable; her asset ayri set_asset_chunks TX).
const BATCH: i64 = 32;

fn is_rag_indexable(ext: Option<&str>) -> bool {
    ext.map(|e| RAG_INDEXABLE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Metadata chunk metni (H2 buildMetadataText pariti, H3 EAV jenerik): dosya-adi + baslik +
/// proje alanlari + etiket/koleksiyon + TUM EAV metadata ("ANAHTAR: deger" — DWG layers/blocks
/// dahil). DOSYA satiri daima var → metni olmayan asset bile en az 1 (aranabilir) chunk alir.
fn build_metadata_text(
    file_name: &str,
    title: Option<&str>,
    project: &ProjectMetaOut,
    tags: &[TagRef],
    collections: &[CollectionRef],
    metadata: &[MetaEntry],
) -> String {
    let mut lines = vec![format!("DOSYA: {file_name}")];
    if let Some(t) = title {
        if !t.is_empty() {
            lines.push(format!("BASLIK: {t}"));
        }
    }
    if let Some(c) = &project.client_name {
        lines.push(format!("MUSTERI: {c}"));
    }
    if let Some(v) = &project.version_label {
        lines.push(format!("VERSIYON: {v}"));
    }
    if let Some(d) = &project.deadline {
        lines.push(format!("TESLIM: {d}"));
    }
    if let Some(a) = &project.approval_status {
        lines.push(format!("ONAY: {a}"));
    }
    if !tags.is_empty() {
        let names = tags.iter().map(|t| t.name.as_str()).collect::<Vec<_>>().join(", ");
        lines.push(format!("ETIKETLER: {names}"));
    }
    if !collections.is_empty() {
        let names = collections.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", ");
        lines.push(format!("KOLEKSIYONLAR: {names}"));
    }
    // EAV metadata: layers/blocks/unit_type/scale/version/... → "ANAHTAR: deger".
    for m in metadata {
        let val = m.value_text.clone().or_else(|| m.value_num.map(|n| {
            // Tam sayilari ".0" olmadan yaz (layer_count=12.0 yerine 12).
            if n.fract() == 0.0 { format!("{}", n as i64) } else { n.to_string() }
        }));
        if let Some(v) = val {
            if !v.is_empty() {
                lines.push(format!("{}: {}", m.key.to_uppercase(), v));
            }
        }
    }
    lines.join("\n")
}

/// RAG indeks durum ozeti (UI: "X / N indekslendi" + model hazir mi).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexStatusDto {
    /// En az bir chunk'i olan aktif asset.
    pub indexed: i64,
    /// Hic chunk'i olmayan aktif asset.
    pub pending: i64,
    /// Toplam aktif asset.
    pub total: i64,
    /// Toplam chunk (govde + metadata).
    pub chunks: i64,
    /// Model dosyalari cozulebiliyor mu (run_rag_indexing calisabilir mi).
    pub model_ready: bool,
}

/// İndeksleme ilerlemesi (Channel; embed deseni, camelCase).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagProgressDto {
    pub processed: i64,
    pub total: i64,
    pub current_path: String,
}

/// İndeksleme kosusu raporu.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagRunReportDto {
    pub indexed: i64,
    pub chunks: i64,
    pub failed: i64,
    pub elapsed_ms: u128,
}

/// Gosterim icin bir parca (detay "Parçalar" sekmesi DTO; camelCase). `chunkIndex == -1` →
/// metadata chunk (dosya/proje/etiket/EAV ozeti); 0,1,2... govde parcasi.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetChunkDto {
    pub chunk_id: i64,
    pub chunk_index: i64,
    pub page: Option<i64>,
    pub text: String,
}

/// Bir asset'in RAG parcalari (detay "Parçalar" sekmesi). Salt-okuma (her rol). Chunk yoksa
/// (henuz indekslenmemis) bos liste → UI "Pano → RAG İndeksi" yonlendirmesi gosterir.
#[tauri::command(async)]
pub fn asset_chunks(
    asset_id: i64,
    state: State<'_, AppState>,
) -> Result<Vec<AssetChunkDto>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows: Vec<AssetChunk> = db.chunks_for_asset(asset_id).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|c| AssetChunkDto {
            chunk_id: c.chunk_id,
            chunk_index: c.chunk_index,
            page: c.page,
            text: c.text,
        })
        .collect())
}

/// Asset'leri RAG'den manuel disla / dahil et (A1 hassasiyet manuel istisnasi). **Editor+.**
/// `excluded=true` → sohbet retrieve'i artik bu asset'in parcalarini getirmez (kalici; re-index
/// korur). Etkilenen asset sayisi doner.
#[tauri::command(async)]
pub fn set_rag_excluded(
    ids: Vec<i64>,
    excluded: bool,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_editor(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.set_rag_excluded(&ids, excluded).map_err(|e| e.to_string())
}

/// RAG indeks durumu (rol gate yok — okuma). `model_ready` dosya kontrolu (model yuklemez).
#[tauri::command(async)]
pub fn rag_index_status(state: State<'_, AppState>) -> Result<RagIndexStatusDto, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let total = db.asset_count().map_err(|e| e.to_string())?;
    let pending = db.pending_chunk_count().map_err(|e| e.to_string())?;
    Ok(RagIndexStatusDto {
        indexed: total - pending,
        pending,
        total,
        chunks: db.chunk_count().map_err(|e| e.to_string())?,
        model_ready: resolve_model_dir().is_ok(),
    })
}

/// Bekleyen asset'leri RAG icin indeksle (metadata + govde chunk → MiniLM embed). **Admin.**
/// Resumable: her asset ayri TX, cursor (after_id) basarisizi atlar. İlerleme Channel (~100ms).
// `async fn`: ana iş parcacigi DISINDA kosar → uzun chunk-indeksleme dongusu UI'yi dondurmez.
// Govde bloklayici, `.await` yok → guard'lar await sinirini gecmez (Send-future guvenli).
#[tauri::command]
pub async fn run_rag_indexing(
    on_progress: Channel<RagProgressDto>,
    state: State<'_, AppState>,
) -> Result<RagRunReportDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    let dir = resolve_model_dir()?;
    let mut emb_guard = state.embedder.lock().map_err(|e| e.to_string())?;
    let embedder = ensure_embedder(&mut emb_guard, &dir)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let total = db.pending_chunk_count().map_err(|e| e.to_string())?;
    let start = Instant::now();
    let (mut indexed, mut chunk_total, mut failed, mut processed, mut after_id) =
        (0i64, 0i64, 0i64, 0i64, 0i64);
    let mut last_emit: Option<Instant> = None;

    loop {
        let batch = db.assets_without_chunks(after_id, BATCH).map_err(|e| e.to_string())?;
        if batch.is_empty() {
            break;
        }
        for p in &batch {
            after_id = p.id; // cursor ilerlet → basarisiz indeks tekrar getirilmez.

            match index_one(&db, embedder, p) {
                Ok(n) => {
                    indexed += 1;
                    chunk_total += n;
                }
                Err(_) => failed += 1,
            }
            processed += 1;

            let now = Instant::now();
            let is_last = processed >= total;
            let due = last_emit.is_none_or(|t| now.duration_since(t).as_millis() >= 100);
            if processed == 1 || is_last || due {
                last_emit = Some(now);
                let _ = on_progress.send(RagProgressDto {
                    processed,
                    total,
                    current_path: p.file_name.clone(),
                });
            }
        }
    }

    Ok(RagRunReportDto {
        indexed,
        chunks: chunk_total,
        failed,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

/// Tek asset'i indeksle: metadata chunk (daima) + govde chunk'lari (belge turunde) → embed →
/// set_asset_chunks. Yazilan chunk sayisini doner. Hata → cagiran failed sayar (resumable).
/// `pub(crate)`: gorsel-analiz job'u (vision_commands) ai_ metadata yazdiktan sonra re-chunk icin
/// cagirir → AI betimleri metadata chunk'ina girer.
pub(crate) fn index_one(
    db: &archivist_db::Db,
    embedder: &mut archivist_embed::TextEmbedder,
    p: &archivist_db::PendingChunk,
) -> Result<i64, String> {
    // Metadata chunk: detay (EAV/tag/proje) get_asset'ten. (file_name/title PendingChunk'ta da var.)
    let detail = db.get_asset(p.id).map_err(|e| e.to_string())?;
    let meta_text = match &detail {
        Some(d) => build_metadata_text(
            &d.asset.file_name,
            d.asset.title.as_deref(),
            &d.project,
            &d.tags,
            &d.collections,
            &d.metadata,
        ),
        // get_asset None (yaris/silinme) → en az dosya adi.
        None => format!("DOSYA: {}", p.file_name),
    };

    // (chunk_index, page, text) listesi: metadata (-1) + govde (0,1,...).
    let mut specs: Vec<(i64, Option<i64>, String)> = Vec::new();
    if !meta_text.trim().is_empty() {
        specs.push((META_CHUNK_INDEX, None, meta_text));
    }
    if is_rag_indexable(p.ext.as_deref()) && !p.body.trim().is_empty() {
        for (i, piece) in chunk_text(&p.body, DEFAULT_CHUNK_WORDS, DEFAULT_OVERLAP_WORDS)
            .into_iter()
            .enumerate()
        {
            specs.push((i as i64, None, piece));
        }
    }
    if specs.is_empty() {
        // DOSYA satiri daima var → normalde olmaz; guvenli atlama (chunk yazma).
        return Ok(0);
    }

    let texts: Vec<&str> = specs.iter().map(|(_, _, t)| t.as_str()).collect();
    let embeddings = embedder.embed_batch(&texts).map_err(|e| e.to_string())?;
    if embeddings.len() != specs.len() {
        return Err("embed_batch boyut uyumsuz".to_string());
    }
    let chunks: Vec<ChunkWrite> = specs
        .into_iter()
        .zip(embeddings)
        .map(|((chunk_index, page, text), embedding)| ChunkWrite {
            chunk_index,
            page,
            text,
            embedding,
        })
        .collect();
    let n = chunks.len() as i64;
    db.set_asset_chunks(p.id, &chunks).map_err(|e| e.to_string())?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexable_extension_check() {
        assert!(is_rag_indexable(Some("pdf")));
        assert!(is_rag_indexable(Some("DOCX"))); // buyuk-harf normalize
        assert!(!is_rag_indexable(Some("dwg")));
        assert!(!is_rag_indexable(Some("max")));
        assert!(!is_rag_indexable(None));
    }

    #[test]
    fn metadata_text_includes_filename_project_tags_and_eav() {
        let project = ProjectMetaOut {
            client_name: Some("Acme".into()),
            approval_status: Some("approved".into()),
            rejection_reason: None,
            version_label: Some("v2".into()),
            deadline: None,
        };
        let tags = vec![TagRef { name: "villa".into(), kind: "user".into(), color: None }];
        let meta = vec![
            MetaEntry {
                key: "layers".into(),
                value_text: Some("duvar, kapi, minare".into()),
                value_num: None,
            },
            MetaEntry { key: "layer_count".into(), value_text: None, value_num: Some(12.0) },
        ];
        let text = build_metadata_text("plan.dwg", Some("Zemin Kat"), &project, &tags, &[], &meta);

        assert!(text.contains("DOSYA: plan.dwg"));
        assert!(text.contains("BASLIK: Zemin Kat"));
        assert!(text.contains("MUSTERI: Acme"));
        assert!(text.contains("VERSIYON: v2"));
        assert!(text.contains("ONAY: approved"));
        assert!(text.contains("ETIKETLER: villa"));
        // EAV: DWG katmanlari metadata chunk'a girer (sidebar paritesi — "minare" aranabilir).
        assert!(text.contains("LAYERS: duvar, kapi, minare"), "DWG katmanlari girmeli");
        assert!(text.contains("LAYER_COUNT: 12"), "sayisal deger .0 olmadan");
    }

    #[test]
    fn metadata_text_minimal_is_just_filename() {
        let empty = ProjectMetaOut {
            client_name: None,
            approval_status: None,
            rejection_reason: None,
            version_label: None,
            deadline: None,
        };
        let text = build_metadata_text("a.txt", None, &empty, &[], &[], &[]);
        assert_eq!(text, "DOSYA: a.txt", "en az dosya adi → asla bos chunk yok");
    }
}
