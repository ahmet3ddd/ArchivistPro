//! V3-1 (Sprint 2) — O(n) cosine → HNSW ANN. Kararlar: `docs/v3/DE-RISK-STRATEGIES.md` §2.
//!
//! **INVARIANT-1 (Kanoniklik):** Vektörlerin tek doğruluk kaynağı her zaman
//! vec.db `embeddings.vector_blob` (rusqlite, V3-2). ANN index = deterministik
//! TÜREV: yanlış/bozuk/eski → sil → rebuild → sıfır kayıp. "Geri dönüşsüz
//! format" riski → "yeniden hesaplanabilir cache invalidation"a iner.
//!
//! Crate: `hnsw_rs` 0.3 (T8 ✅ — Rust 1.95/MSVC yeşil). `VectorIndex` trait
//! arkasına soyutlanır (swap maliyetsiz). Desen: `shapes_db.rs` (rusqlite-only,
//! ayrı dosya, sync-core).
//!
//! KAPSAM (Faz 1, gate'siz): trait + dondurulmuş `index_meta.json` şeması +
//! vec.db'den (kanonik) build + search + rebuild-tetikleri + atomik
//! `_ann.tmp/`→rename + `source_fingerprint`. Dump/meta/ids persist edilir.
//! NOT: disk'ten reload + `datamap` mmap, `hnsw_rs::load_hnsw`'nin Hnsw'yi
//! HnswIo'ya ömür-bağlaması (self-referential) + heap-tezi RAM ölçümü
//! nedeniyle **bench-gated Faz 2**'ye aittir (DE-RISK §2 "ann_bench RAM gate").
//! Faz 1 runtime index'i kanonik vec.db'den RAM'e kurulur.

use hnsw_rs::prelude::*;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

/// `index_meta.json` — DONDURULMUŞ sidecar şeması (DE-RISK §2). Alan
/// ekleme/çıkarma `SCHEMA_VERSION` artışı gerektirir (rebuild-tetiği).
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMeta {
    pub schema_version: u32,
    pub crate_name: String,
    pub crate_version: String,
    pub embedding_dim: usize,
    pub model_id: String,
    pub distance: String,
    pub vector_count: usize,
    /// Kaynak vec.db embeddings'ten deterministik parmak izi (stale tespiti).
    pub source_fingerprint: String,
}

pub const SCHEMA_VERSION: u32 = 1;
const CRATE_NAME: &str = "hnsw_rs";
const CRATE_VERSION: &str = "0.3";
const DISTANCE: &str = "cosine";
const META_FILE: &str = "index_meta.json";
const IDS_FILE: &str = "ids.tsv";
const HNSW_BASENAME: &str = "ann";

// HNSW parametreleri (SIFT1M recall ~0.99 referans; bench Faz 2 ayarlar).
const MAX_NB_CONNECTION: usize = 16;
const EF_CONSTRUCTION: usize = 200;
const MAX_LAYER: usize = 16;
/// Arama-anı ef (recall/latency dengesi). DE-RISK §2 gate recall@10≥0.98;
/// ef=64'te ~0.975 ölçüldü → 200 (EF_CONSTRUCTION ile tutarlı) gate'i geçer.
const SEARCH_EF: usize = 200;

/// Arama sonucu — `ragService` Stage 3'ün beklediği şekil (chunk + skor).
/// Tüketici Faz 3 (frontend çift-yol, DE-RISK §2 `:743-758`) — **gated**;
/// şu an yalnız testlerde inşa edilir (bilinçli, scan_db serde-wire gibi).
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnHit {
    pub asset_id: String,
    pub chunk_id: String,
    /// Kosinüs benzerliği [-1,1] (hnsw_rs DistCosine mesafesinden: 1 - d).
    pub score: f32,
}

/// Swap-maliyetsiz soyutlama (DE-RISK §2: crate değişirse trait sabit kalır).
/// `search` tüketicisi Faz 3 (ragService çift-yol) — gated; trait şimdi
/// dondurulur (API sözleşmesi), kullanım testlerde.
#[allow(dead_code)]
pub trait VectorIndex {
    /// Sorgu vektörü için en yakın `k` chunk (benzerliğe göre azalan).
    fn search(&self, query: &[f32], k: usize) -> Result<Vec<AnnHit>, String>;
    fn len(&self) -> usize;
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Float32 LE blob → Vec<f32> (v2.4.9 `vectorToBlob`; bozuk uzunluk → None).
fn blob_to_vec_f32(blob: &[u8]) -> Option<Vec<f32>> {
    if blob.is_empty() || blob.len() % 4 != 0 {
        return None;
    }
    Some(
        blob.chunks_exact(4)
            .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
            .collect(),
    )
}

/// Kaynak vec.db `embeddings`'ten deterministik parmak izi: `ORDER BY id`
/// kanonik (id + blob-bayt-uzunluğu) SHA-256 + satır sayısı. id-kümesi/dim
/// değişimini ucuza yakalar (içerik değişimi nadir; inkremental `add` +
/// periyodik compaction-rebuild kapsar — DE-RISK §2). vec_db içerik-hash'i
/// (tam blob) ağır; bu parmak izi stale-tespiti içindir, doğrulama değil.
fn source_fingerprint(
    conn: &rusqlite::Connection,
    source: &str,
) -> Result<(String, usize), String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut count = 0usize;
    let mut stmt = conn
        .prepare(
            "SELECT id, length(vector_blob) FROM embeddings
             WHERE source = ?1 AND ref_id IS NOT NULL AND ref_id != ''
             ORDER BY id",
        )
        .map_err(|e| format!("fingerprint prepare hatası: {}", e))?;
    let mut rows = stmt
        .query(rusqlite::params![source])
        .map_err(|e| format!("fingerprint query hatası: {}", e))?;
    while let Some(r) = rows.next().map_err(|e| format!("fingerprint satır: {}", e))? {
        let id: String = r.get(0).map_err(|e| e.to_string())?;
        let blen: i64 = r.get(1).map_err(|e| e.to_string())?;
        hasher.update(id.as_bytes());
        hasher.update([0x1f]);
        hasher.update(blen.to_le_bytes());
        hasher.update([0x1e]);
        count += 1;
    }
    Ok((format!("{:x}", hasher.finalize()), count))
}

impl IndexMeta {
    fn read(dir: &Path) -> Option<Self> {
        let bytes = std::fs::read(dir.join(META_FILE)).ok()?;
        serde_json::from_slice(&bytes).ok()
    }
    fn write(&self, dir: &Path) -> Result<(), String> {
        let json = serde_json::to_vec_pretty(self)
            .map_err(|e| format!("meta serialize hatası: {}", e))?;
        std::fs::write(dir.join(META_FILE), json)
            .map_err(|e| format!("meta yazılamadı: {}", e))
    }
}

/// Rebuild tetik nedeni (DE-RISK §2). `None` = mevcut index taze.
pub fn needs_rebuild(
    dir: &Path,
    conn: &rusqlite::Connection,
    source: &str,
    model_id: &str,
) -> Result<Option<String>, String> {
    let meta = match IndexMeta::read(dir) {
        None => return Ok(Some("meta yok / okunamadı".into())),
        Some(m) => m,
    };
    if meta.schema_version != SCHEMA_VERSION {
        return Ok(Some(format!(
            "şema-versiyon {} != {}",
            meta.schema_version, SCHEMA_VERSION
        )));
    }
    // crate-major uyuşmazlığı (0.3 → "0"+"3"; major = ilk segment).
    let cur_major = CRATE_VERSION.split('.').next().unwrap_or("");
    let meta_major = meta.crate_version.split('.').next().unwrap_or("");
    if meta.crate_name != CRATE_NAME || meta_major != cur_major {
        return Ok(Some(format!(
            "crate {}@{} → {}@{}",
            meta.crate_name, meta.crate_version, CRATE_NAME, CRATE_VERSION
        )));
    }
    if meta.model_id != model_id {
        return Ok(Some(format!(
            "model_id {} != {}",
            meta.model_id, model_id
        )));
    }
    let (fp, count) = source_fingerprint(conn, source)?;
    if meta.embedding_dim == 0 && count > 0 {
        return Ok(Some("dim=0 ama kaynak dolu".into()));
    }
    if fp != meta.source_fingerprint {
        return Ok(Some("source_fingerprint uyuşmazlığı".into()));
    }
    // Sayı sapması > %1 (inkremental kaçaklara karşı emniyet).
    let drift = (meta.vector_count as i64 - count as i64).unsigned_abs() as usize;
    if count > 0 && drift * 100 > count {
        return Ok(Some(format!(
            "vector_count sapması {} (meta {}, kaynak {})",
            drift, meta.vector_count, count
        )));
    }
    Ok(None)
}

/// RAM'deki HNSW index + DataId→(chunk,asset) eşlemesi.
pub struct HnswIndex {
    hnsw: Hnsw<'static, f32, DistCosine>,
    /// DataId (insert sırası ordinali) → (chunk_id, asset_id).
    ids: Vec<(String, String)>,
    dim: usize,
}

impl VectorIndex for HnswIndex {
    fn search(&self, query: &[f32], k: usize) -> Result<Vec<AnnHit>, String> {
        if self.ids.is_empty() {
            return Ok(vec![]); // boş index: sorgu dim'inden bağımsız sonuç yok
        }
        if query.len() != self.dim {
            return Err(format!(
                "sorgu dim {} != index dim {}",
                query.len(),
                self.dim
            ));
        }
        let ef = SEARCH_EF.max(k);
        let neighbours = self.hnsw.search(query, k, ef);
        let mut hits = Vec::with_capacity(neighbours.len());
        for n in neighbours {
            if let Some((chunk_id, asset_id)) = self.ids.get(n.d_id) {
                hits.push(AnnHit {
                    asset_id: asset_id.clone(),
                    chunk_id: chunk_id.clone(),
                    // DistCosine mesafesi d ∈ [0,2] → benzerlik 1 - d.
                    score: 1.0 - n.distance,
                });
            }
        }
        Ok(hits)
    }
    fn len(&self) -> usize {
        self.ids.len()
    }
}

/// Kanonik vec.db `embeddings`'ten RAM'e HNSW kur (deterministik `ORDER BY id`
/// → DataId = ordinal; `query_chunk_embeddings` ile aynı filtre). `cancel`
/// set'lenirse erken çıkış (rebuild iptali — fallback çağıranda).
fn build_in_ram(
    conn: &rusqlite::Connection,
    source: &str,
    cancel: &AtomicBool,
) -> Result<(HnswIndex, usize), String> {
    let mut stmt = conn
        .prepare(
            "SELECT asset_id, ref_id, vector_blob FROM embeddings
             WHERE source = ?1 AND ref_id IS NOT NULL AND ref_id != ''
             ORDER BY id",
        )
        .map_err(|e| format!("build prepare hatası: {}", e))?;
    let mut rows = stmt
        .query(rusqlite::params![source])
        .map_err(|e| format!("build query hatası: {}", e))?;

    let mut vectors: Vec<Vec<f32>> = Vec::new();
    let mut ids: Vec<(String, String)> = Vec::new();
    let mut dim = 0usize;
    while let Some(r) = rows.next().map_err(|e| format!("build satır: {}", e))? {
        if cancel.load(Ordering::Relaxed) {
            return Err("rebuild iptal edildi".into());
        }
        let asset_id: String = r.get(0).map_err(|e| e.to_string())?;
        let chunk_id: String = r.get(1).map_err(|e| e.to_string())?;
        let blob: Vec<u8> = r.get(2).map_err(|e| e.to_string())?;
        let v = match blob_to_vec_f32(&blob) {
            Some(v) => v,
            None => continue, // bozuk vektör atlanır (sql.js davranışıyla tutarlı)
        };
        if dim == 0 {
            dim = v.len();
        } else if v.len() != dim {
            continue; // dim-mismatch satırı atla (fallback üst katmanda)
        }
        vectors.push(v);
        ids.push((chunk_id, asset_id));
    }

    let count = ids.len();
    let hnsw = build_hnsw_from_vectors(&vectors, cancel)?;
    Ok((HnswIndex { hnsw, ids, dim }, count))
}

/// Saf HNSW kurucu (DataId = vektör ordinali). `build_in_ram` + bench/recall
/// testleri ortak kullanır (tek kaynak; bench gerçek kurucu yolunu ölçer).
fn build_hnsw_from_vectors(
    vectors: &[Vec<f32>],
    cancel: &AtomicBool,
) -> Result<Hnsw<'static, f32, DistCosine>, String> {
    let hnsw: Hnsw<'static, f32, DistCosine> = Hnsw::new(
        MAX_NB_CONNECTION,
        vectors.len().max(1),
        MAX_LAYER,
        EF_CONSTRUCTION,
        DistCosine {},
    );
    // Paralel insert (rayon, hnsw_rs first-class — DE-RISK §2 `insert_parallel`
    // gerekçesi). Sequential döngü 1M'de ~114 dk → pratik değil (kanıt:
    // baseline-heap.md §7). Chunk'lar arası `cancel` kontrolü KORUNUR →
    // rebuild-iptal granülaritesi (önceki per-insert ile eşdeğer pratikte).
    // DataId = global ordinal (chunk_base + j) → `ORDER BY id` ordinaliyle
    // birebir (INVARIANT: search d_id → ids[] eşlemesi bozulmaz).
    const PAR_CHUNK: usize = 16_384;
    for (ci, chunk) in vectors.chunks(PAR_CHUNK).enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("rebuild iptal edildi".into());
        }
        let base = ci * PAR_CHUNK;
        let batch: Vec<(&Vec<f32>, usize)> =
            chunk.iter().enumerate().map(|(j, v)| (v, base + j)).collect();
        hnsw.parallel_insert(&batch);
    }
    Ok(hnsw)
}

/// Index dizinine atomik persist (DE-RISK §2): `<dir>.tmp/`'a dump+ids+meta →
/// başarıda `<dir>` ile değiştir (rename). Yarı-yazılmış index diskte kalmaz.
fn persist_atomic(
    index: &HnswIndex,
    dir: &Path,
    meta: &IndexMeta,
) -> Result<(), String> {
    let tmp = dir.with_extension("ann.tmp");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp)
        .map_err(|e| format!("tmp dizin oluşturulamadı: {}", e))?;

    // hnsw_rs 0 noktada dump edemez ("unexpected error"). Boş index =
    // geçerli durum (kaynak boş); dump dosyaları atlanır, meta vector_count=0
    // ile rebuild/reload mantığı boşu zaten tanır.
    if !index.ids.is_empty() {
        index
            .hnsw
            .file_dump(&tmp, HNSW_BASENAME)
            .map_err(|e| format!("hnsw dump hatası: {}", e))?;
    }

    let ids_buf: String = index
        .ids
        .iter()
        .map(|(c, a)| format!("{}\t{}", c, a))
        .collect::<Vec<_>>()
        .join("\n");
    std::fs::write(tmp.join(IDS_FILE), ids_buf)
        .map_err(|e| format!("ids yazılamadı: {}", e))?;
    meta.write(&tmp)?;

    // Atomik takas: eski dizini kaldır, tmp'yi yerine al.
    let _ = std::fs::remove_dir_all(dir);
    std::fs::rename(&tmp, dir)
        .map_err(|e| format!("atomik rename hatası: {}", e))?;
    Ok(())
}

/// INVARIANT-1: gerekirse rebuild eden tek giriş. Index'i RAM'e kurar, taze
/// değilse kanonik vec.db'den yeniden kurup atomik persist eder, döndürür.
/// `model_id` = embedding modeli kimliği (uyuşmazlık → rebuild).
pub fn ensure_index(
    vec_db: &Path,
    index_dir: &Path,
    source: &str,
    model_id: &str,
    cancel: &AtomicBool,
) -> Result<HnswIndex, String> {
    let conn = rusqlite::Connection::open(vec_db)
        .map_err(|e| format!("vec.db açılamadı: {}", e))?;
    let reason = needs_rebuild(index_dir, &conn, source, model_id)?;
    let (index, count) = build_in_ram(&conn, source, cancel)?;
    // Faz 1: runtime index daima RAM'den (reload Faz 2). Persist yalnız meta
    // tazeliği/bench için; rebuild gerekiyorsa veya hiç yoksa yeniden yaz.
    if reason.is_some() || IndexMeta::read(index_dir).is_none() {
        let (fp, _) = source_fingerprint(&conn, source)?;
        let meta = IndexMeta {
            schema_version: SCHEMA_VERSION,
            crate_name: CRATE_NAME.into(),
            crate_version: CRATE_VERSION.into(),
            embedding_dim: index.dim,
            model_id: model_id.into(),
            distance: DISTANCE.into(),
            vector_count: count,
            source_fingerprint: fp,
        };
        persist_atomic(&index, index_dir, &meta)?;
    }
    Ok(index)
}

// ── Tauri komutu (gate'siz bakım: index'i kanonikten yeniden kur) ─────────────

/// ANN index'i kanonik vec.db'den yeniden kur (admin bakım / rebuild-trigger
/// teşhisi). `ragService` çift-yol araması Faz 3 (frontend/gated). archive_at
/// = aktif arşiv (vec.db çözümü vec_db modülüyle aynı).
#[tauri::command]
pub async fn vector_index_rebuild(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    source: Option<String>,
    model_id: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<IndexMeta, String> {
    crate::require_authenticated(&role_state)?;
    let vec_db = crate::vec_db::resolve_vec_db_path(&app, archive_at.as_deref())?;
    let index_dir = vec_db.with_extension("ann");
    let src = source.unwrap_or_else(|| "chunk_text".to_string());
    let model = model_id.unwrap_or_else(|| "unknown".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&vec_db);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        let cancel = AtomicBool::new(false);
        ensure_index(&vec_db, &index_dir, &src, &model, &cancel)?;
        IndexMeta::read(&index_dir).ok_or_else(|| "meta yazılamadı".to_string())
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vec_db::fixtures::{make_v249_db, DbProfile};
    use crate::vec_db::migrate_embeddings;
    use std::path::PathBuf;

    /// vec.db'yi sentetik kaynaktan kur (embeddings dolu).
    fn synth_vec_db(tmp: &Path, assets: usize) -> PathBuf {
        let src = tmp.join("archivist.db");
        let vdb = tmp.join("archivist_vec.db");
        make_v249_db(&src, DbProfile::Sized(assets)).unwrap();
        migrate_embeddings(&src, &vdb, 5000).unwrap();
        vdb
    }

    fn first_vector(vdb: &Path, source: &str) -> Vec<f32> {
        let c = rusqlite::Connection::open(vdb).unwrap();
        let blob: Vec<u8> = c
            .query_row(
                "SELECT vector_blob FROM embeddings WHERE source=?1
                 AND ref_id IS NOT NULL AND ref_id != '' ORDER BY id LIMIT 1",
                rusqlite::params![source],
                |r| r.get(0),
            )
            .unwrap();
        blob_to_vec_f32(&blob).unwrap()
    }

    #[test]
    fn build_then_search_finds_self_and_persists_atomically() {
        let t = tempfile::tempdir().unwrap();
        let vdb = synth_vec_db(t.path(), 40);
        let dir = t.path().join("archivist_vec.ann");
        let cancel = AtomicBool::new(false);

        let idx = ensure_index(&vdb, &dir, "chunk_text", "minilm-384", &cancel).unwrap();
        assert_eq!(idx.len(), 40, "40 asset × 1 chunk_text embedding");

        // Kendi vektörünü ara → ilk komşu kendisi (recall sağlığı).
        let q = first_vector(&vdb, "chunk_text");
        let hits = idx.search(&q, 5).unwrap();
        assert!(!hits.is_empty());
        assert!(
            hits[0].score > 0.99,
            "kendi vektörü ~1.0 benzerlik (skor={})",
            hits[0].score
        );

        // Atomik persist: final dizin var, tmp yok, meta+ids+dump mevcut.
        assert!(dir.join(META_FILE).exists());
        assert!(dir.join(IDS_FILE).exists());
        assert!(!dir.with_extension("ann.tmp").exists(), "tmp temizlenmeli");
        let meta = IndexMeta::read(&dir).unwrap();
        assert_eq!(meta.schema_version, SCHEMA_VERSION);
        assert_eq!(meta.vector_count, 40);
        assert_eq!(meta.embedding_dim, 384);
    }

    #[test]
    fn needs_rebuild_detects_triggers() {
        let t = tempfile::tempdir().unwrap();
        let vdb = synth_vec_db(t.path(), 10);
        let dir = t.path().join("v.ann");
        let cancel = AtomicBool::new(false);
        ensure_index(&vdb, &dir, "chunk_text", "minilm-384", &cancel).unwrap();
        let conn = rusqlite::Connection::open(&vdb).unwrap();

        // Taze → None
        assert!(needs_rebuild(&dir, &conn, "chunk_text", "minilm-384")
            .unwrap()
            .is_none());
        // model_id değişti → Some
        assert!(needs_rebuild(&dir, &conn, "chunk_text", "BAŞKA")
            .unwrap()
            .is_some());
        // meta yok → Some
        let empty = t.path().join("yok.ann");
        assert!(needs_rebuild(&empty, &conn, "chunk_text", "minilm-384")
            .unwrap()
            .is_some());
        // schema_version bozulması → Some
        let mut m = IndexMeta::read(&dir).unwrap();
        m.schema_version = 999;
        m.write(&dir).unwrap();
        assert!(needs_rebuild(&dir, &conn, "chunk_text", "minilm-384")
            .unwrap()
            .is_some());
    }

    #[test]
    fn fingerprint_changes_when_source_changes() {
        let t = tempfile::tempdir().unwrap();
        let vdb = synth_vec_db(t.path(), 8);
        let conn = rusqlite::Connection::open(&vdb).unwrap();
        let (fp1, c1) = source_fingerprint(&conn, "chunk_text").unwrap();
        assert_eq!(c1, 8);
        // Bir embedding sil → fingerprint + sayı değişir
        conn.execute(
            "DELETE FROM embeddings WHERE id = (SELECT id FROM embeddings
             WHERE source='chunk_text' ORDER BY id LIMIT 1)",
            [],
        )
        .unwrap();
        let (fp2, c2) = source_fingerprint(&conn, "chunk_text").unwrap();
        assert_ne!(fp1, fp2);
        assert_eq!(c2, 7);
    }

    #[test]
    fn empty_source_builds_empty_index() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("archivist.db");
        let vdb = t.path().join("archivist_vec.db");
        make_v249_db(&src, DbProfile::Empty).unwrap();
        migrate_embeddings(&src, &vdb, 100).unwrap();
        let dir = t.path().join("v.ann");
        let cancel = AtomicBool::new(false);
        let idx = ensure_index(&vdb, &dir, "chunk_text", "m", &cancel).unwrap();
        assert!(idx.is_empty());
        assert!(idx.search(&[0.0f32; 384], 5).unwrap().is_empty());
    }

    // ── Faz 2: recall gate + bench harness ────────────────────────────────────

    /// Deterministik LCG (vec_db fixtures deseni; rand dep'siz tekrarlanabilir).
    fn lcg(seed: &mut u64) -> f32 {
        *seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        ((*seed >> 33) as f32 / (1u64 << 31) as f32) - 1.0
    }

    /// n adet L2-normalize edilmiş dim-boyutlu vektör (kosinüs = nokta çarpımı).
    fn gen_unit_vectors(n: usize, dim: usize, mut seed: u64) -> Vec<Vec<f32>> {
        (0..n)
            .map(|_| {
                let mut v: Vec<f32> = (0..dim).map(|_| lcg(&mut seed)).collect();
                let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
                for x in &mut v {
                    *x /= norm;
                }
                v
            })
            .collect()
    }

    fn cosine(a: &[f32], b: &[f32]) -> f32 {
        a.iter().zip(b).map(|(x, y)| x * y).sum()
    }

    /// Brute-force kosinüs ground-truth (DE-RISK §2: cosineSimilarity referansı).
    fn brute_topk(vecs: &[Vec<f32>], q: &[f32], k: usize) -> Vec<usize> {
        let mut scored: Vec<(usize, f32)> = vecs
            .iter()
            .enumerate()
            .map(|(i, v)| (i, cosine(v, q)))
            .collect();
        scored.sort_by(|a, b| b.1.total_cmp(&a.1));
        scored.into_iter().take(k).map(|(i, _)| i).collect()
    }

    fn mk_index(vecs: &[Vec<f32>], dim: usize) -> HnswIndex {
        let cancel = AtomicBool::new(false);
        let hnsw = build_hnsw_from_vectors(vecs, &cancel).unwrap();
        let ids = (0..vecs.len())
            .map(|i| (i.to_string(), "a".to_string()))
            .collect();
        HnswIndex { hnsw, ids, dim }
    }

    /// recall@k — **mesafe-tabanlı** (ANN-benchmark standardı; Gate #1 ile
    /// AYNI metrik). Dönen komşunun gerçek mesafesi `dk + tol(dk)` içindeyse
    /// (k'ıncı doğru mesafe artı tolerans) "tutuldu" sayılır. Set-intersection
    /// metriği `parallel_insert` nondeterminizminin eşitlik-bağı boundary'sinde
    /// sahte FAIL üretirdi (sentetik LCG verisinde 10. ile 11. komşu mesafeleri
    /// pratikte eş). f64 truth ve görece tolerans birlikte, f32 hesabın 384-
    /// boyutlu toplama hatasını (≈1e-5) absorbe eder; DE-RISK §2 0.98 eşiği
    /// KORUNUR.
    fn measure_recall(
        idx: &HnswIndex,
        base: &[Vec<f32>],
        queries: &[Vec<f32>],
        k: usize,
    ) -> (f64, f64) {
        let cos_dist = |a: &[f32], b: &[f32]| -> f64 {
            let (mut dot, mut na, mut nb) = (0f64, 0f64, 0f64);
            for i in 0..a.len() {
                let (x, y) = (a[i] as f64, b[i] as f64);
                dot += x * y;
                na += x * x;
                nb += y * y;
            }
            1.0 - dot / (na.sqrt() * nb.sqrt()).max(1e-12)
        };
        let tol = |d: f64| d.abs() * 1e-4 + 1e-6;
        let (mut sum_k, mut sum_1) = (0.0f64, 0.0f64);
        for q in queries {
            // f64 truth: tüm mesafeleri hesapla, sırala → k'ıncı yarıçap.
            let mut d: Vec<(f64, usize)> = base
                .iter()
                .enumerate()
                .map(|(i, v)| (cos_dist(q, v), i))
                .collect();
            d.sort_by(|a, b| a.0.total_cmp(&b.0));
            let kk = k.min(d.len());
            let dk = d[kk - 1].0;
            let d1 = d[0].0;

            let hits = idx.search(q, k).unwrap();
            // Mesafe-recall@k: ANN'nin k komşusundan kaçı ≤ dk + tol(dk).
            let hit_k = hits
                .iter()
                .filter_map(|h| h.chunk_id.parse::<usize>().ok())
                .filter(|&i| cos_dist(q, &base[i]) <= dk + tol(dk))
                .count();
            sum_k += hit_k as f64 / k as f64;
            // Mesafe-recall@1: ANN'nin ilk komşusu ≤ d1 + tol(d1) mi.
            if let Some(first) = hits.first() {
                if let Ok(i) = first.chunk_id.parse::<usize>() {
                    if cos_dist(q, &base[i]) <= d1 + tol(d1) {
                        sum_1 += 1.0;
                    }
                }
            }
        }
        let m = queries.len() as f64;
        (sum_k / m, sum_1 / m)
    }

    /// CI recall regresyon gate (DE-RISK §2: recall@10 ≥ 0.98, recall@1 ≥ 0.97).
    /// Küçük N → CI'de hızlı; gerçek kurucu yolu (`build_hnsw_from_vectors`).
    /// **Metrik**: mesafe-tabanlı recall (Gate #1 ile aynı; `parallel_insert`
    /// nondeterminizmine ve set-intersection ties'larına dayanıklı).
    #[test]
    fn recall_gate_meets_design_lock_thresholds() {
        let dim = 48;
        let base = gen_unit_vectors(1500, dim, 0xA11CE);
        let queries = gen_unit_vectors(120, dim, 0xB0B); // ayrı sorgu kümesi
        let idx = mk_index(&base, dim);
        let (r10, r1) = measure_recall(&idx, &base, &queries, 10);
        assert!(
            r10 >= 0.98,
            "recall@10 {:.4} < 0.98 (DE-RISK §2 gate; mesafe-tabanlı)",
            r10
        );
        assert!(
            r1 >= 0.97,
            "recall@1 {:.4} < 0.97 (DE-RISK §2 gate; mesafe-tabanlı)",
            r1
        );
    }

    /// Manuel 1M harness (DE-RISK §2 "ann_bench" — recall+latency+RAM gate).
    /// CI'de KOŞMAZ. `emit_baseline_dbs` precedent'i.
    ///
    /// ```text
    /// $env:ANN_BENCH_N="1000000"; $env:ANN_BENCH_DIM="384"
    /// cargo test --manifest-path src-tauri/Cargo.toml --features admin `
    ///   ann_bench -- --ignored --nocapture
    /// ```
    /// Doğrular: build → file_dump → **datamap mmap reload** (Faz 1'den
    /// ertelenen self-ref'siz yol, harness scope'unda) → search recall/latency.
    /// RAM: dataset baytı + reload süresi yazılır; RSS'i baseline-heap.md
    /// prosedürüyle (Görev Yöneticisi/Perf Monitor) MANUEL oku (S1-PREP-C gibi).
    #[test]
    #[ignore = "manuel ANN bench — CI'de değil (1M süre/RAM); --ignored ile koş"]
    fn ann_bench() {
        use std::time::Instant;
        let n: usize = std::env::var("ANN_BENCH_N")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(50_000);
        let dim: usize = std::env::var("ANN_BENCH_DIM")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(384);
        let m_q = 50usize;
        println!("[ann_bench] N={} dim={} dataset≈{:.1} MB", n, dim,
            (n * dim * 4) as f64 / 1_048_576.0);

        let base = gen_unit_vectors(n, dim, 0xDA7A);
        let queries = gen_unit_vectors(m_q, dim, 0x9_E11);
        let cancel = AtomicBool::new(false);

        let t = Instant::now();
        let hnsw = build_hnsw_from_vectors(&base, &cancel).unwrap();
        println!("[ann_bench] build: {:.1} sn", t.elapsed().as_secs_f64());

        // GATE METODOLOJİSİ (baseline-heap.md §7): mutlak recall@10, synthetic
        // LCG + yüksek-boyut (384) rastgele veride GEÇERSİZ sinyaldir (boyut
        // laneti → noktalar ~eşit-uzak; in-RAM index bile düşük, reload değil).
        // Gerçek-embedding recall doğrulaması Gate #1 (gerçek anonim db) işi —
        // DE-RISK SIFT1M ~0.99 + `recall_gate_*` (dim=48) zaten regresyonu
        // korur. Bu 1M harness'in GEÇERLİ gate'i: (1) reload SADAKATİ
        // in-RAM≈reload, (2) latency, (3) RAM. in-RAM recall = parity referansı.
        let k = 10usize;
        let inram_recall = {
            let mut s = 0.0f64;
            for q in &queries {
                let got: std::collections::HashSet<usize> = hnsw
                    .search(q, k, SEARCH_EF.max(k))
                    .iter()
                    .map(|nb| nb.d_id)
                    .collect();
                let truth = brute_topk(&base, q, k);
                s += truth.iter().filter(|i| got.contains(i)).count() as f64
                    / k as f64;
            }
            s / m_q as f64
        };

        let tmp = tempfile::tempdir().unwrap();
        let t = Instant::now();
        hnsw.file_dump(tmp.path(), "ann").unwrap();
        let dump_bytes: u64 = std::fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum();
        println!("[ann_bench] dump: {:.1} sn, {:.1} MB",
            t.elapsed().as_secs_f64(), dump_bytes as f64 / 1_048_576.0);

        // Faz 1'den ertelenen: datamap mmap reload (scope-local → self-ref yok).
        // DEFEKT FIX (baseline-heap.md §7): `load_hnsw_with_dist` (&self) datamap'i
        // ASLA doldurmaz (hnsw_rs 0.3.4 hnswio.rs:533) ama load_point_indexation
        // mmap kararını ReloadOptions'tan alır → datamap=true ile None.unwrap()
        // panik (:828). Doğru mmap API'si `load_hnsw` (&mut self): use_mmap ise
        // self.datamap'i doldurur (:496-504). DistCosine: Default → uygun.
        let t = Instant::now();
        let mut hio = HnswIo::new_with_options(
            tmp.path(),
            "ann",
            ReloadOptions::new(true), // datamap = mmap (heap-tezi)
        );
        let reloaded: Hnsw<f32, DistCosine> =
            hio.load_hnsw::<f32, DistCosine>().unwrap();
        println!(
            "[ann_bench] mmap reload: {:.2} sn — RSS'i baseline-heap.md \
             prosedürüyle (Görev Yön./Perf Monitor) MANUEL oku; datamap vs \
             in-RAM farkı bu gate'in konusu (S1-PREP-C gibi manuel)",
            t.elapsed().as_secs_f64()
        );

        // Latency + reloaded recall (reload edilen mmap index üzerinde).
        let mut lat: Vec<f64> = Vec::with_capacity(m_q);
        let mut sum_k = 0.0f64;
        for q in &queries {
            let s = Instant::now();
            let res = reloaded.search(q, k, SEARCH_EF.max(k));
            lat.push(s.elapsed().as_secs_f64() * 1000.0);
            let got: std::collections::HashSet<usize> =
                res.iter().map(|nb| nb.d_id).collect();
            let truth = brute_topk(&base, q, k);
            sum_k += truth.iter().filter(|i| got.contains(i)).count() as f64
                / k as f64;
        }
        lat.sort_by(|a, b| a.total_cmp(b));
        let reload_recall = sum_k / m_q as f64;
        let p50 = lat[lat.len() / 2];
        let p99 = lat[(lat.len() * 99 / 100).min(lat.len() - 1)];
        let parity_delta = (inram_recall - reload_recall).abs();
        println!(
            "[ann_bench] search p50={:.3} ms p99={:.3} ms | recall@10 \
             in-RAM={:.4} reload={:.4} delta={:.4} (n={}) — mutlak deger \
             synthetic veride gecersiz; SINYAL = delta~0 reload sadakati \
             (baseline-heap.md §7)",
            p50, p99, inram_recall, reload_recall, parity_delta, n
        );
        // GATE 1/3 — reload SADAKATI: reloaded index in-RAM ile ~birebir
        // (datamap mmap doğruluğu; tani reload_recall_parity: delta=0.0000).
        // Bozulursa GERÇEK defekt (orijinal panik buradaydı, artık fix'li).
        assert!(
            parity_delta <= 0.01,
            "reload PARITY bozuk: in-RAM={:.4} reload={:.4} delta={:.4} > 0.01 \
             — mmap/datamap reload sadakatsiz (GERÇEK defekt)",
            inram_recall, reload_recall, parity_delta
        );
        // GATE 2/3 — latency sağlığı (ANN'in varlık sebebi: O(n) brute değil).
        assert!(
            p99 < 100.0,
            "p99 {:.3} ms > 100 ms — ANN latency beklenenden kötü",
            p99
        );
        // GATE 3/3 — RAM: RSS harici prosedürle MANUEL okunur (§7).
        // NOT: mutlak recall@10 BİLİNÇLİ assert edilmez — synthetic LCG/384-dim
        // veride geçersiz (in-RAM bile düşük); gerçek-embedding recall = Gate #1.
    }

    /// TANI (geçici, baseline-heap.md §7 recall=0.20 kök neden): in-RAM vs
    /// reload(mmap=false) vs reload(mmap=true) recall karşılaştırır. mmap=true
    /// düşük + diğerleri yüksek ise → hnsw_rs 0.3.4 datamap bozuk (üst-akım).
    #[test]
    #[ignore = "tani — `--ignored --nocapture` ile koş"]
    fn reload_recall_parity_diagnostic() {
        fn rc(
            h: &Hnsw<f32, DistCosine>,
            base: &[Vec<f32>],
            qs: &[Vec<f32>],
            k: usize,
        ) -> f64 {
            let mut s = 0.0f64;
            for q in qs {
                let got: std::collections::HashSet<usize> = h
                    .search(q, k, SEARCH_EF.max(k))
                    .iter()
                    .map(|nb| nb.d_id)
                    .collect();
                let t = brute_topk(base, q, k);
                s += t.iter().filter(|i| got.contains(i)).count() as f64 / k as f64;
            }
            s / qs.len() as f64
        }

        let (n, dim, k, mq) = (20_000usize, 384usize, 10usize, 40usize);
        let base = gen_unit_vectors(n, dim, 0xD1A6);
        let queries = gen_unit_vectors(mq, dim, 0x5EED);
        let cancel = AtomicBool::new(false);
        let hnsw = build_hnsw_from_vectors(&base, &cancel).unwrap();
        let r_inram = rc(&hnsw, &base, &queries, k);

        let tmp = tempfile::tempdir().unwrap();
        hnsw.file_dump(tmp.path(), "ann").unwrap();

        let mut hio_f =
            HnswIo::new_with_options(tmp.path(), "ann", ReloadOptions::new(false));
        let rl_f: Hnsw<f32, DistCosine> =
            hio_f.load_hnsw::<f32, DistCosine>().unwrap();
        let r_false = rc(&rl_f, &base, &queries, k);

        let mut hio_t =
            HnswIo::new_with_options(tmp.path(), "ann", ReloadOptions::new(true));
        let rl_t: Hnsw<f32, DistCosine> =
            hio_t.load_hnsw::<f32, DistCosine>().unwrap();
        let r_true = rc(&rl_t, &base, &queries, k);

        println!(
            "[DIAG-RANDOM] n={} dim={} | in-RAM={:.4} reload(mmap=false)={:.4} \
             reload(mmap=true)={:.4}",
            n, dim, r_inram, r_false, r_true
        );

        // Senaryo B: YAPILANDIRILMIŞ veri. Sorgu = base[idx] + küçük gürültü →
        // gerçek en-yakın = idx (planted). Index sağlamsa recall@10 ~1.0.
        let mut seed = 0x7E57u64;
        let mut planted_q = Vec::with_capacity(mq);
        let mut planted_truth = Vec::with_capacity(mq);
        for j in 0..mq {
            let idx = (j * (n / mq)).min(n - 1);
            let mut v = base[idx].clone();
            for x in &mut v {
                *x += lcg(&mut seed) * 0.02; // ~%2 gürültü
            }
            let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-12);
            for x in &mut v {
                *x /= norm;
            }
            planted_q.push(v);
            planted_truth.push(idx);
        }
        let planted_recall = |h: &Hnsw<f32, DistCosine>| -> f64 {
            let mut hit = 0.0f64;
            for (qi, q) in planted_q.iter().enumerate() {
                let got: std::collections::HashSet<usize> = h
                    .search(q, k, SEARCH_EF.max(k))
                    .iter()
                    .map(|nb| nb.d_id)
                    .collect();
                if got.contains(&planted_truth[qi]) {
                    hit += 1.0;
                }
            }
            hit / planted_q.len() as f64
        };
        println!(
            "[DIAG-PLANTED] n={} dim={} | in-RAM={:.4} reload(mmap=true)={:.4} \
             (gerçek en-yakın top-10'da mı; index sağlığı)",
            n,
            dim,
            planted_recall(&hnsw),
            planted_recall(&rl_t)
        );
    }

    /// Gate #1 SON AYAĞI — GERÇEK anonim db'nin embedding'leriyle mutlak
    /// `recall@10`. `ann_bench` synthetic LCG'de mutlak recall'ı bilinçle
    /// assert etmiyordu (boyut laneti → geçersiz sinyal, baseline-heap.md §7);
    /// gerçek-embedding recall = Gate #1 işi. DE-RISK §2 eşiği: recall@10≥0.98.
    ///
    /// Dim-tutarlılık şart: yalnız `source='chunk_text'` (384-dim MiniLM —
    /// ragService Stage 3 retrieval vektörü) alınır; image (512-dim CLIP)
    /// AYNI indekse karışTIRILMAZ. CI'de KOŞMAZ (#[ignore]); manuel:
    /// ```text
    /// $env:GATE1_DB="C:\...\archivist_local_anon.db"
    /// cargo test --manifest-path src-tauri/Cargo.toml --features admin `
    ///   gate1_real_recall -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "manuel Gate #1 — GATE1_DB env; gerçek-embedding recall@10 (DE-RISK §2 ≥0.98)"]
    fn gate1_real_recall() {
        use std::time::Instant;
        let src = PathBuf::from(std::env::var("GATE1_DB").expect(
            "GATE1_DB env (anonim gerçek db) gerekli — docs/v3/GATE1-ANONYMIZATION.md §6",
        ));
        assert!(src.exists(), "GATE1_DB yok: {}", src.display());
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("archivist_vec.db");
        migrate_embeddings(&src, &vdb, 5000).unwrap();

        // chunk_text (384-dim) blob'larını yükle — dim-tutarlı tek küme.
        let conn = rusqlite::Connection::open(&vdb).unwrap();
        let mut stmt = conn
            .prepare("SELECT vector_blob FROM embeddings WHERE source='chunk_text' ORDER BY id")
            .unwrap();
        let base: Vec<Vec<f32>> = stmt
            .query_map([], |r| r.get::<_, Vec<u8>>(0))
            .unwrap()
            .filter_map(|b| b.ok())
            .filter_map(|b| super::blob_to_vec_f32(&b))
            .collect();
        if base.len() < 200 {
            println!(
                "[gate1_recall] ATLANDI — yalnız {} chunk_text vektörü (<200); \
                 anlamlı recall için yetersiz (bu db için diğer kaynak gerek)",
                base.len()
            );
            return;
        }
        let dim = base[0].len();
        assert!(
            base.iter().all(|v| v.len() == dim),
            "dim tutarsız — karışık boyut indekse girmemeli"
        );

        // Sorgu = deterministik örneklem (≤100), base ⊂ üzerinde brute-force
        // exact top-10 ile ANN top-10 karşılaştır.
        let step = (base.len() / 100).max(1);
        let queries: Vec<&Vec<f32>> = base.iter().step_by(step).take(100).collect();
        let cancel = AtomicBool::new(false);
        let t = Instant::now();
        let hnsw = build_hnsw_from_vectors(&base, &cancel).unwrap();
        let build_s = t.elapsed().as_secs_f64();

        let k = 10usize;
        let ef = std::env::var("GATE1_EF")
            .ok()
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(SEARCH_EF);

        // Cosine mesafe (indeks DistCosine). Gerçek-embedding'lerde %~40
        // BİREBİR yinelenme var → index-küme örtüşmesi recall'ı eşitlik-bağı
        // yüzünden yapay düşürür (ANN eş-mesafede FARKLI ama eşit-geçerli
        // dup index'i döndürür). MESAFE-recall (dönen komşu mesafesi ≤
        // k-ıncı gerçek mesafe) eşitlik-bağına dayanıklı — ANN-benchmark
        // standardı; DE-RISK §2 0.98 eşiği KORUNUR, yalnız metrik düzeltilir.
        // f64 birikim: f32'de 384-terim toplama görece-hata ~1e-5 →
        // indeksin iç DistCosine'iyle uyuşmazlık eş-mesafeli (dup) komşuyu
        // yapay "ıska" sayardı. f64 truth + GÖRECE eps bu ölçüm-precision
        // artefaktını giderir; DE-RISK §2 0.98 eşiği KORUNUR (metrik
        // sadıklaştırılır, gevşetilmez).
        let cos_dist = |a: &[f32], b: &[f32]| -> f64 {
            let (mut dot, mut na, mut nb) = (0f64, 0f64, 0f64);
            for i in 0..a.len() {
                let (x, y) = (a[i] as f64, b[i] as f64);
                dot += x * y;
                na += x * x;
                nb += y * y;
            }
            1.0 - dot / (na.sqrt() * nb.sqrt()).max(1e-12)
        };
        // Görece tolerans: indeks içte f32 hesaplar → f64 truth'a karşı
        // ~1e-4 görece sapma normaldir (gevşek değil, f32↔f64 köprüsü).
        let tol = |dk: f64| dk.abs() * 1e-4 + 1e-6;
        let (mut idx10, mut dr10, mut dr1) = (0.0f64, 0.0f64, 0.0f64);
        for q in &queries {
            let mut d: Vec<(f64, usize)> = base
                .iter()
                .enumerate()
                .map(|(i, v)| (cos_dist(q, v), i))
                .collect();
            d.sort_by(|a, b| a.0.total_cmp(&b.0));
            let kk = k.min(d.len());
            let dk = d[kk - 1].0; // k-ıncı en küçük mesafe = gerçek top-k yarıçapı
            let d1 = d[0].0;
            let truth_idx: std::collections::HashSet<usize> =
                d[..kk].iter().map(|x| x.1).collect();

            let ann = hnsw.search(q, k, ef.max(k));
            let got_idx: std::collections::HashSet<usize> =
                ann.iter().map(|nb| nb.d_id).collect();
            idx10 += truth_idx.iter().filter(|i| got_idx.contains(i)).count()
                as f64
                / k as f64;
            let hit = ann
                .iter()
                .filter(|nb| cos_dist(q, &base[nb.d_id]) <= dk + tol(dk))
                .count();
            dr10 += hit as f64 / k as f64;
            if let Some(f) = ann.first() {
                if cos_dist(q, &base[f.d_id]) <= d1 + tol(d1) {
                    dr1 += 1.0;
                }
            }
        }
        let m = queries.len() as f64;
        let (idx10, dr10, dr1) = (idx10 / m, dr10 / m, dr1 / m);
        println!(
            "[gate1_recall] n={} dim={} q={} ef={} build={:.1}sn | \
             DIST recall@10={:.4} recall@1={:.4} | index-recall@10={:.4} \
             (yinelenme artefaktı, yalnız bilgi) — DE-RISK §2 eşik @10≥0.98",
            base.len(), dim, queries.len(), ef, build_s, dr10, dr1, idx10
        );
        assert!(
            dr10 >= 0.98,
            "GERÇEK-embedding MESAFE-recall@10 {:.4} < 0.98 — Gate #1 FAIL \
             (ef={}, dup-bağımsız metrik; GATE1_EF ile artır)",
            dr10, ef
        );
        assert!(dr1 >= 0.97, "MESAFE-recall@1 {:.4} < 0.97", dr1);
        println!(
            "[gate1_recall] GEÇTİ — gerçek-embedding mesafe-recall@10={:.4} \
             Gate #1 ayağı doğrulandı (ef={})",
            dr10, ef
        );
    }
}
