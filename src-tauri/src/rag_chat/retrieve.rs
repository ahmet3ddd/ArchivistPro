//! Ortak chunk-retrieval cekirdegi — **yerel** RAG sohbeti + **uzak host** (LAN Faz 5) AYNI kodu
//! kullanir → retrieval mantigi TEK yerde, kayma (drift) yok.
//!
//! Ollama-BAGIMSIZ (saf DB + embedder): embed(soru) → `rag_search_with_diag` → hassasiyet retain.
//! Query-rewrite (A3) ve rerank (A2) Ollama gerektirir → BURADA YOK; onlar cagiran (yerel uretim)
//! tarafinda uygulanir. **Alinan karar:** retrieval + embedding HOST'ta, LLM uretimi ISTEMCIDE →
//! host bu cekirdegi cagirir (kendi indeksinden chunk uretir), istemci donen chunk'larla cevap uretir.
//!
//! Cozulmus `allowed` (kapsam) ve `sens_excluded` (hassasiyet) cagiran tarafindan verilir
//! ([`resolve_scope`] + [`sensitivity_excluded`] paylasimli yardimcilariyla): yerel yol bunlari
//! `image_fallback` ile de paylasir (tek cozum, cift-sorgu yok); host yalniz burada kullanir.
//! Paylasimli yardimcilar cozum-mantigini da tek yerde tutar.

use std::collections::HashSet;

use archivist_db::{AnalysisScope, ChunkHit, Db, RetrieveDiag};
use archivist_embed::TextEmbedder;

use super::prompt::detect_list_intent;
use super::retrieval::sensitivity_keyword_list;
use super::{RagOptions, LIST_FETCH_CHUNKS, RERANK_POOL, RETRIEVE_K};

/// Hassasiyet OTO-disla asset id kumesi (A1): etkin kategoriler/kelimeler govdesinde gecen
/// asset'ler retrieve'den elenir. Kapali (`sensitivity_enabled=false`) veya kelime yoksa bos.
/// **Paylasimli** (yerel retrieve + yerel image_fallback + host) → kelime-cozumu tek yerde.
pub(crate) fn sensitivity_excluded(
    db: &Db,
    options: &RagOptions,
) -> Result<HashSet<i64>, String> {
    if !options.sensitivity_enabled {
        return Ok(HashSet::new());
    }
    let kws =
        sensitivity_keyword_list(&options.sensitivity_categories, &options.sensitivity_keywords);
    if kws.is_empty() {
        return Ok(HashSet::new());
    }
    Ok(db.assets_matching_keywords(&kws).map_err(|e| e.to_string())?.into_iter().collect())
}

/// Sohbet KAPSAMINI (scope) somut allowed id kumesine cevir (`scope_asset_ids` sarmalayici).
/// `All` → `None` (sinirsiz = tum arsiv). `Ids`/`Filter` → `Some(kume)`; bos secim → `Some(bos)`
/// (retrieval bos doner). **Paylasimli** (yerel + host) → scope→id cozumu tek yerde.
pub(crate) fn resolve_scope(
    db: &Db,
    scope: &AnalysisScope,
) -> Result<Option<HashSet<i64>>, String> {
    Ok(db.scope_asset_ids(scope).map_err(|e| e.to_string())?.map(|v| v.into_iter().collect()))
}

/// Ortak retrieval cekirdegi: `embed(soru)` → `rag_search_with_diag` → hassasiyet retain.
///
/// Liste-niyeti (`detect_list_intent`) iceride belirlenir → `keyword_only` ve `top_k` yerel
/// davranisla BIREBIR: liste yolunda yalniz anahtar-kelime eslesme (`RETRIEVE_K`); RAG yolunda
/// semantik recall, rerank etkinse genis aday havuzu (`RERANK_POOL`). `extra_fts_terms` yerel
/// query-rewrite (A3) ek FTS token'laridir (host `&[]` gecirir — host retrieval saftir).
/// `allowed` ve `sens_excluded` cagiran tarafinca cozulur (bkz modul basligi).
pub(crate) fn retrieve_chunks(
    db: &Db,
    embedder: &mut TextEmbedder,
    question: &str,
    options: &RagOptions,
    extra_fts_terms: &[String],
    allowed: Option<&HashSet<i64>>,
    sens_excluded: &HashSet<i64>,
) -> Result<(Vec<ChunkHit>, RetrieveDiag), String> {
    let q = question.trim();
    let qvec = embedder.embed(q).map_err(|e| e.to_string())?;
    let list_intent = detect_list_intent(q);
    // Liste-niyeti (H2 pariti): keyword_only=true (saf-semantik gurultu girmesin) + dar top_k.
    // RAG yolu: keyword_only=false (semantik recall) + rerank ise genis havuz (sonra istemci indirir).
    let keyword_only = list_intent;
    // Liste yolu DOSYA listesi uretir → chunk havuzu genis olmali (LIST_FETCH_CHUNKS; bkz mod.rs
    // gerekce: tavan yanlis birimdeydi, 12 chunk pratikte ~8 dosyaya dusuyordu).
    let top_k = if list_intent {
        LIST_FETCH_CHUNKS
    } else if options.rerank {
        RERANK_POOL
    } else {
        RETRIEVE_K
    };
    // Liste yolunda ek FTS token uygulanmaz (yerel list yolu `&[]` gecerdi → birebir korunur).
    let terms: &[String] = if list_intent { &[] } else { extra_fts_terms };
    let (mut hits, diag) = db
        .rag_search_with_diag(q, &qvec, top_k, terms, keyword_only, allowed)
        .map_err(|e| e.to_string())?;
    // Hassasiyet OTO-disla (rag_search'un manuel `rag_excluded` kolon filtresinden AYRI).
    hits.retain(|h| !sens_excluded.contains(&h.asset_id));
    Ok((hits, diag))
}
