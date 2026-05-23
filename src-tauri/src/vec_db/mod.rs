//! V3-2 — ağır tabloların sql.js (V8 heap) monolitinden ayrılması.
//!
//! `embeddings` / `text_chunks` / `asset_relations` tabloları ana arşiv
//! DB'sinden bağımsız tek bir `*_vec.db` dosyasında (rusqlite-only) tutulur.
//! Frontend sql.js bu tabloları HİÇ görmez → 1M+ asset'te V8 heap patlamaz.
//!
//! Bu dosya **iskelet**: path çözümü + şema + idempotent yazma çekirdekleri +
//! migration_progress (power-loss resume) + sentetik dataset üreteci.
//! Tauri komut wrapper'ları ve lib.rs invoke kaydı Sprint 1 ana işine aittir.
//!
//! Kararlar: `docs/v3/SPRINT1-DESIGN-LOCK.md`. Desen: `shapes_db.rs`
//! (rusqlite-only, ayrı dosya, sync-core + async-wrapper — Sprint 0).
//!
//! NOT: DESIGN-LOCK §1 — WAL **açılmaz** (DELETE journal). WAL geçişi
//! Gate 0 (V3-2 sonrası blob-overwrite izolasyonu) nedeniyle V3-3'e aittir.

// NOT: Tauri komut wrapper'ları lib.rs invoke_handler'a kaydedildi →
// tüm API erişilebilir; iskelet `#![allow(dead_code)]` KALDIRILDI.
// Frontend çift-yol (epoch>=1→invoke) + DROP+epoch atomik sql.js write
// Sprint 1'in kalan ana işidir.

use std::path::{Path, PathBuf};

/// vec.db şeması. v2.4.9 (`database.ts`) ile aynı yapı, FARKLAR:
/// - `vector_json` YOK (DESIGN-LOCK §9: yalnız `vector_blob`).
/// - FK YOK (cross-database FK SQLite'ta desteklenmez; orphan temizliği
///   asset-DELETE cascade invoke + periyodik temizlik ile — DESIGN-LOCK §7).
const VEC_DB_SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS embeddings (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    ref_id TEXT,
    vector_blob BLOB,
    source TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vec_embeddings_asset ON embeddings(asset_id);
CREATE INDEX IF NOT EXISTS idx_vec_embeddings_source ON embeddings(source);

CREATE TABLE IF NOT EXISTS text_chunks (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    page INTEGER,
    text TEXT NOT NULL,
    lang TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_vec_chunks_asset ON text_chunks(asset_id);

CREATE TABLE IF NOT EXISTS asset_relations (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT DEFAULT 'user'
);
CREATE INDEX IF NOT EXISTS idx_vec_rel_source ON asset_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_vec_rel_target ON asset_relations(target_id);

-- Power-loss resume (DESIGN-LOCK §3). completed_at IS NULL = devam/kesilmiş.
CREATE TABLE IF NOT EXISTS migration_progress (
    table_name     TEXT PRIMARY KEY,
    last_rowid     INTEGER NOT NULL DEFAULT 0,
    total_expected INTEGER NOT NULL DEFAULT 0,
    started_at     TEXT,
    completed_at   TEXT
);

-- V3 PRE-5a: keyword arama index'i. epoch>=2'de `text_chunks` sql.js'ten
-- DROP edilince frontend'in `fts_chunks` virtual table'ı da kaybolur;
-- `ftsSearchChunks` (database.ts:4457) okuma yolu burada yeniden kurulur.
-- İçerik = Türkçe→ASCII normalize edilmiş metin (`fts_normalize`, sql.js
-- `insertFtsChunk` ile BİREBİR), tokenize='ascii'. `text_chunks`'in
-- türevidir — apply/delete yolları senkron tutar (rebuild_fts güvenlik ağı).
CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
    chunk_id UNINDEXED,
    asset_id UNINDEXED,
    text,
    tokenize='ascii'
);
";

/// Path-only varyant: ana arşiv DB dosya yolundan vec.db yolunu türetir.
/// AppHandle'a ihtiyaç duymadan çalışır (scan_db gibi sync-core kodu için).
///
/// - `archivist.db` → `archivist_vec.db`
/// - `archivist_local.db` → `archivist_local_vec.db`
/// - `archive_<id>.db` → `archive_<id>_vec.db`
pub fn resolve_vec_db_path_from_main(main_path: &Path) -> Result<PathBuf, String> {
    let parent = main_path.parent().ok_or("Geçersiz ana DB path")?;
    let stem = main_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Geçersiz ana DB dosya adı")?;
    Ok(parent.join(format!("{}_vec.db", stem)))
}

/// Ana arşiv DB path'inin yanında `_vec.db` konumlu vec DB path'i.
/// `shapes_db::resolve_shapes_db_path` deseninin birebir kopyası (DESIGN-LOCK §1).
///
/// - `archivist.db` → `archivist_vec.db`
/// - `archivist_local.db` → `archivist_local_vec.db`
/// - `archive_<id>.db` → `archive_<id>_vec.db`
pub fn resolve_vec_db_path(
    app: &tauri::AppHandle,
    archive_at: Option<&str>,
) -> Result<PathBuf, String> {
    let main_path = match archive_at {
        Some("local") => crate::ollama_db::resolve_local_db_path(app)?,
        Some(id) if id != "main" && !id.is_empty() => {
            crate::ollama_db::resolve_archive_path(app, id)?
        }
        _ => crate::ollama_db::resolve_db_path(app)?,
    };
    resolve_vec_db_path_from_main(&main_path)
}

/// vec.db bağlantısı aç (yoksa oluştur, şema apply et).
/// DESIGN-LOCK §1: DELETE journal (WAL DEĞİL), synchronous=NORMAL,
/// temp_store=MEMORY, foreign_keys=OFF (zaten şemada FK yok).
pub fn open_vec_db(path: &Path) -> Result<rusqlite::Connection, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("vec.db dizini oluşturulamadı: {}", e))?;
    }
    let conn = rusqlite::Connection::open(path)
        .map_err(|e| format!("vec.db açılamadı: {}", e))?;
    conn.execute_batch(
        "PRAGMA journal_mode = DELETE; PRAGMA synchronous = NORMAL; \
         PRAGMA temp_store = MEMORY; PRAGMA foreign_keys = OFF;",
    )
    .map_err(|e| format!("vec.db PRAGMA hatası: {}", e))?;
    conn.execute_batch(VEC_DB_SCHEMA)
        .map_err(|e| format!("vec.db şema apply hatası: {}", e))?;
    Ok(conn)
}

/// Taşınacak embedding satırı (sql.js kaynaktan okunup vec.db'ye yazılır).
/// PRE-6d: snapshot/restore round-trip için serde.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct EmbeddingRow {
    pub id: String,
    pub asset_id: String,
    pub ref_id: Option<String>,
    pub vector_blob: Vec<u8>,
    pub source: String,
}

/// Embedding batch'i vec.db'ye yaz — `INSERT OR IGNORE` (PK=id) → idempotent
/// (DESIGN-LOCK §3: yarıda kesilen migrasyon resume'da çift yazmaz).
/// Yazılan (yeni) satır sayısını döner.
pub fn apply_embeddings(
    path: &Path,
    rows: &[EmbeddingRow],
) -> Result<usize, String> {
    let mut conn = open_vec_db(path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("TX başlatılamadı: {}", e))?;
    let mut written = 0usize;
    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT OR IGNORE INTO embeddings
                 (id, asset_id, ref_id, vector_blob, source)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .map_err(|e| format!("prepare hatası: {}", e))?;
        for r in rows {
            let n = stmt
                .execute(rusqlite::params![
                    &r.id,
                    &r.asset_id,
                    &r.ref_id,
                    &r.vector_blob,
                    &r.source
                ])
                .map_err(|e| format!("INSERT hatası: {}", e))?;
            written += n; // OR IGNORE: zaten varsa 0
        }
    }
    tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
    Ok(written)
}

/// Bir tablonun satır sayısı (doğrulama §5 COUNT eşitliği için temel).
pub fn vec_count(path: &Path, table: &str) -> Result<i64, String> {
    // table yalnız sabit literal'lerden gelir (test/iç kullanım); yine de
    // whitelist ile SQL-injection yüzeyini sıfırla.
    let t = match table {
        "embeddings" | "text_chunks" | "asset_relations" | "migration_progress"
        | "fts_chunks" => table,
        _ => return Err(format!("bilinmeyen tablo: {}", table)),
    };
    let conn = open_vec_db(path)?;
    conn.query_row(&format!("SELECT COUNT(*) FROM {}", t), [], |r| r.get(0))
        .map_err(|e| format!("COUNT hatası: {}", e))
}

/// migration_progress upsert (resume checkpoint).
pub fn progress_set(
    path: &Path,
    table_name: &str,
    last_rowid: i64,
    total_expected: i64,
    completed: bool,
) -> Result<(), String> {
    let conn = open_vec_db(path)?;
    conn.execute(
        "INSERT INTO migration_progress
           (table_name, last_rowid, total_expected, started_at, completed_at)
         VALUES (?1, ?2, ?3, datetime('now'), CASE WHEN ?4 THEN datetime('now') ELSE NULL END)
         ON CONFLICT(table_name) DO UPDATE SET
           last_rowid = excluded.last_rowid,
           total_expected = excluded.total_expected,
           completed_at = CASE WHEN ?4 THEN datetime('now') ELSE migration_progress.completed_at END",
        rusqlite::params![table_name, last_rowid, total_expected, completed],
    )
    .map_err(|e| format!("progress_set hatası: {}", e))?;
    Ok(())
}

/// migration_progress oku → (last_rowid, total_expected, completed?).
pub fn progress_get(
    path: &Path,
    table_name: &str,
) -> Result<Option<(i64, i64, bool)>, String> {
    let conn = open_vec_db(path)?;
    conn.query_row(
        "SELECT last_rowid, total_expected, completed_at IS NOT NULL
         FROM migration_progress WHERE table_name = ?1",
        rusqlite::params![table_name],
        |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? != 0)),
    )
    .optional()
    .map_err(|e| format!("progress_get hatası: {}", e))
}

use rusqlite::OptionalExtension;

// ═══════════════════════════════════════════════════════════════════════════════
// Migrasyon orkestratörü — copy → verify (DESIGN-LOCK §4/§5)
//
// Rust tarafı yalnız KAYNAK(sql.js v2.4.9 monolit) → vec.db kopya + doğrulama
// yapar. sql.js'ten `DROP TABLE` + `PRAGMA user_version=N` atomik adımı
// FRONTEND'e aittir (sql.js export → write_db_at) ve Sprint 1 ANA işidir.
// Orkestratör `verified=true` dönerse frontend güvenle DROP+epoch yapabilir.
// ═══════════════════════════════════════════════════════════════════════════════

/// Bir tablo taşımasının doğrulama + ilerleme raporu (DESIGN-LOCK §5).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub source_count: i64,
    pub vec_count: i64,
    /// §5.1 — satır sayısı eşit.
    pub count_match: bool,
    /// §5.2 — `ORDER BY id` kanonik SHA-256 iki tarafta eşit.
    pub content_hash_match: bool,
    /// §5.3 — blob byte-len == dim*4 ve örneklem round-trip.
    pub blob_sample_ok: bool,
    /// Üçü de geçti → frontend DROP+epoch yapabilir.
    pub verified: bool,
}

/// Kaynak v2.4.9 monolitinde `embeddings.vector_blob` NULL satır var mı?
/// DESIGN-LOCK §9 ön-koşulu: epoch=1 öncesi `_migrateEmbeddingsJsonToBlob`
/// tüm legacy JSON'ı blob'a çevirmiş OLMALI. NULL varsa migrasyon başlamaz.
pub fn embeddings_blob_precondition(source_db: &Path) -> Result<(), String> {
    let conn = rusqlite::Connection::open(source_db)
        .map_err(|e| format!("kaynak DB açılamadı: {}", e))?;
    let nulls: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM embeddings WHERE vector_blob IS NULL",
            [],
            |r| r.get(0),
        )
        .map_err(|e| format!("ön-koşul sorgu hatası: {}", e))?;
    if nulls != 0 {
        return Err(format!(
            "ön-koşul ihlali: {} embedding satırında vector_blob NULL — \
             önce _migrateEmbeddingsJsonToBlob çalışmalı (DESIGN-LOCK §9)",
            nulls
        ));
    }
    Ok(())
}

/// `embeddings`'i kaynak monolitten vec.db'ye taşı — batch + resume.
/// `INSERT OR IGNORE` (apply_embeddings) → yarıda kesilirse yeniden
/// çağrıldığında `migration_progress.last_rowid`'den devam, çift yazmaz.
/// DROP YAPMAZ (frontend sorumluluğu). Yazılan toplam (yeni) satır döner.
pub fn migrate_embeddings(
    source_db: &Path,
    vec_db: &Path,
    batch_size: i64,
) -> Result<usize, String> {
    embeddings_blob_precondition(source_db)?;
    let src = rusqlite::Connection::open(source_db)
        .map_err(|e| format!("kaynak DB açılamadı: {}", e))?;
    let total: i64 = src
        .query_row("SELECT COUNT(*) FROM embeddings", [], |r| r.get(0))
        .map_err(|e| format!("kaynak COUNT hatası: {}", e))?;

    // Resume: kaldığı rowid'den devam (idempotent INSERT OR IGNORE güvenlik ağı).
    let mut after = progress_get(vec_db, "embeddings")?
        .map(|(last, _, _)| last)
        .unwrap_or(0);
    progress_set(vec_db, "embeddings", after, total, false)?;

    let mut total_written = 0usize;
    loop {
        let mut stmt = src
            .prepare(
                "SELECT rowid, id, asset_id, ref_id, vector_blob, source
                 FROM embeddings WHERE rowid > ?1 ORDER BY rowid LIMIT ?2",
            )
            .map_err(|e| format!("kaynak prepare hatası: {}", e))?;
        let rows: Vec<(i64, EmbeddingRow)> = stmt
            .query_map(rusqlite::params![after, batch_size], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    EmbeddingRow {
                        id: r.get(1)?,
                        asset_id: r.get(2)?,
                        ref_id: r.get(3)?,
                        vector_blob: r.get(4)?,
                        source: r.get(5)?,
                    },
                ))
            })
            .map_err(|e| format!("kaynak query hatası: {}", e))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("kaynak satır hatası: {}", e))?;
        if rows.is_empty() {
            break;
        }
        let max_rowid = rows.last().unwrap().0;
        let batch: Vec<EmbeddingRow> = rows.into_iter().map(|(_, e)| e).collect();
        total_written += apply_embeddings(vec_db, &batch)?;
        after = max_rowid;
        progress_set(vec_db, "embeddings", after, total, false)?;
    }
    Ok(total_written)
}

/// Asset silme cascade raporu (cross-DB FK yok → manuel temizlik, T9).
#[derive(Debug, Clone, PartialEq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CascadeDeleteReport {
    pub embeddings_deleted: usize,
    pub chunks_deleted: usize,
    pub relations_deleted: usize,
}

/// V3 A6-PRE-3b: `scan_clear_assets` "All" modunun vec.db karşılığı —
/// üç V3-eligible tablonun tümünü boşaltır. Tek TX, idempotent.
/// `CascadeDeleteReport` aynı tip kullanılır (3 sayım) — semantik aynı.
pub fn clear_all_v3_data(vec_db: &Path) -> Result<CascadeDeleteReport, String> {
    if !vec_db.exists() {
        return Ok(CascadeDeleteReport::default());
    }
    let mut conn = open_vec_db(vec_db)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("TX başlatılamadı: {}", e))?;
    let rep = {
        let emb = tx
            .execute("DELETE FROM embeddings", [])
            .map_err(|e| format!("embeddings delete: {}", e))?;
        let ch = tx
            .execute("DELETE FROM text_chunks", [])
            .map_err(|e| format!("text_chunks delete: {}", e))?;
        let rel = tx
            .execute("DELETE FROM asset_relations", [])
            .map_err(|e| format!("asset_relations delete: {}", e))?;
        // PRE-5a: FTS index'i de boşalt (text_chunks türevi).
        tx.execute("DELETE FROM fts_chunks", [])
            .map_err(|e| format!("fts_chunks delete: {}", e))?;
        CascadeDeleteReport {
            embeddings_deleted: emb,
            chunks_deleted: ch,
            relations_deleted: rel,
        }
    };
    tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
    Ok(rep)
}

/// V3 A6-PRE-3a: scan rescan deseninin vec.db karşılığı — verilen asset
/// id'leri için **text_chunks**'ı tam, **embeddings**'i yalnız chunk-embedding
/// (ref_id NOT NULL AND ref_id != '') olanları siler. Asset-level embedding
/// (ref_id NULL/'' — örn. thumbnail/CLIP) korunur. Bu, `scan_db.rs`'deki
/// `write_scan_batch_to_db` "DELETE delete_chunks_for" bloğunun birebir
/// vec.db karşılığı (epoch>=N routing'i için).
pub fn delete_chunks_for_assets(
    vec_db: &Path,
    asset_ids: &[String],
) -> Result<usize, String> {
    if asset_ids.is_empty() {
        return Ok(0);
    }
    let mut conn = open_vec_db(vec_db)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("TX başlatılamadı: {}", e))?;
    let mut total_deleted = 0usize;
    {
        let mut d_ch = tx
            .prepare_cached("DELETE FROM text_chunks WHERE asset_id = ?1")
            .map_err(|e| format!("prepare chunk: {}", e))?;
        let mut d_emb = tx
            .prepare_cached(
                "DELETE FROM embeddings WHERE asset_id = ?1 \
                 AND ref_id IS NOT NULL AND ref_id != ''",
            )
            .map_err(|e| format!("prepare chunk-emb: {}", e))?;
        // PRE-5a: FTS index'i text_chunks'in türevi — birlikte temizlenir.
        // Sayıma DAHİL DEĞİL (türev index; "silinen veri" değil).
        let mut d_fts = tx
            .prepare_cached("DELETE FROM fts_chunks WHERE asset_id = ?1")
            .map_err(|e| format!("prepare fts: {}", e))?;
        for aid in asset_ids {
            total_deleted += d_ch
                .execute(rusqlite::params![aid])
                .map_err(|e| format!("chunk sil: {}", e))?;
            total_deleted += d_emb
                .execute(rusqlite::params![aid])
                .map_err(|e| format!("chunk-emb sil: {}", e))?;
            d_fts
                .execute(rusqlite::params![aid])
                .map_err(|e| format!("fts sil: {}", e))?;
        }
    }
    tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
    Ok(total_deleted)
}

/// sql.js `assets` DELETE'i vec.db'ye yansıt — cross-DB FK olmadığından
/// (DESIGN-LOCK §7 / T9) embeddings + text_chunks (asset_id) ve
/// asset_relations (source_id VEYA target_id) manuel silinir. Tek TX,
/// idempotent (yoksa 0 siler). Orphan-temizlik komutu da bunu kullanır.
pub fn delete_assets(
    vec_db: &Path,
    asset_ids: &[String],
) -> Result<CascadeDeleteReport, String> {
    let mut rep = CascadeDeleteReport::default();
    if asset_ids.is_empty() {
        return Ok(rep);
    }
    let mut conn = open_vec_db(vec_db)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("TX başlatılamadı: {}", e))?;
    {
        let mut d_emb = tx
            .prepare_cached("DELETE FROM embeddings WHERE asset_id = ?1")
            .map_err(|e| format!("prepare emb: {}", e))?;
        let mut d_ch = tx
            .prepare_cached("DELETE FROM text_chunks WHERE asset_id = ?1")
            .map_err(|e| format!("prepare chunk: {}", e))?;
        let mut d_rel = tx
            .prepare_cached(
                "DELETE FROM asset_relations WHERE source_id = ?1 OR target_id = ?1",
            )
            .map_err(|e| format!("prepare rel: {}", e))?;
        // PRE-5a: FTS index'i text_chunks ile birlikte temizlenir (türev).
        let mut d_fts = tx
            .prepare_cached("DELETE FROM fts_chunks WHERE asset_id = ?1")
            .map_err(|e| format!("prepare fts: {}", e))?;
        for aid in asset_ids {
            rep.embeddings_deleted += d_emb
                .execute(rusqlite::params![aid])
                .map_err(|e| format!("emb sil: {}", e))?;
            rep.chunks_deleted += d_ch
                .execute(rusqlite::params![aid])
                .map_err(|e| format!("chunk sil: {}", e))?;
            rep.relations_deleted += d_rel
                .execute(rusqlite::params![aid])
                .map_err(|e| format!("rel sil: {}", e))?;
            d_fts
                .execute(rusqlite::params![aid])
                .map_err(|e| format!("fts sil: {}", e))?;
        }
    }
    tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
    Ok(rep)
}

/// `embeddings` için kanonik SHA-256 — `ORDER BY id`, alanlar sabit sırada.
/// Kaynakta `vector_blob`, vec.db'de `vector_blob` aynı kolon; hex ile gömülür.
fn embeddings_canonical_hash(conn: &rusqlite::Connection) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, asset_id, IFNULL(ref_id,''), source, vector_blob
             FROM embeddings ORDER BY id",
        )
        .map_err(|e| format!("hash prepare hatası: {}", e))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("hash query hatası: {}", e))?;
    while let Some(row) = rows.next().map_err(|e| format!("hash satır hatası: {}", e))? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let asset_id: String = row.get(1).map_err(|e| e.to_string())?;
        let ref_id: String = row.get(2).map_err(|e| e.to_string())?;
        let source: String = row.get(3).map_err(|e| e.to_string())?;
        let blob: Vec<u8> = row.get(4).map_err(|e| e.to_string())?;
        // Alan ayıracı \x1f, satır ayıracı \x1e — veri içinde geçmez.
        hasher.update(id.as_bytes());
        hasher.update([0x1f]);
        hasher.update(asset_id.as_bytes());
        hasher.update([0x1f]);
        hasher.update(ref_id.as_bytes());
        hasher.update([0x1f]);
        hasher.update(source.as_bytes());
        hasher.update([0x1f]);
        hasher.update(&blob);
        hasher.update([0x1e]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// Frontend çift-yol okuma kontratı — `getAllChunkEmbeddings`
/// (`database.ts:2228`) ile aynı şekil: `{ assetId, chunkId, vector }`.
/// NOT: `allowedAssetTypes` (file_type) filtresi vec.db'de UYGULANMAZ —
/// `assets` tablosu sql.js'te kalır (DESIGN-LOCK); frontend dönen kümeyi
/// kendi `assets` metadata'sıyla filtreler.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkEmbedding {
    pub asset_id: String,
    pub chunk_id: String,
    pub vector: Vec<f32>,
}

/// Float32 little-endian blob → Vec<f32> (v2.4.9 `vectorToBlob` formatı).
/// Bozuk uzunluk (len % 4 != 0) → None (satır atlanır, sql.js
/// `parseVectorFromRow` null davranışıyla tutarlı).
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

/// Chunk embedding'leri kaynak yerine vec.db'den servis et (epoch>=1 yolu).
/// `getAllChunkEmbeddings` SQL'inin vec.db karşılığı: `source=?` +
/// `ref_id IS NOT NULL AND ref_id != ''`. Bozuk vektör satırı atlanır.
pub fn query_chunk_embeddings(
    vec_db: &Path,
    source: &str,
) -> Result<Vec<ChunkEmbedding>, String> {
    let conn = open_vec_db(vec_db)?;
    let mut stmt = conn
        .prepare(
            "SELECT asset_id, ref_id, vector_blob FROM embeddings
             WHERE source = ?1 AND ref_id IS NOT NULL AND ref_id != ''
             ORDER BY id",
        )
        .map_err(|e| format!("prepare hatası: {}", e))?;
    let mut rows = stmt
        .query(rusqlite::params![source])
        .map_err(|e| format!("query hatası: {}", e))?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().map_err(|e| format!("satır hatası: {}", e))? {
        let asset_id: String = r.get(0).map_err(|e| e.to_string())?;
        let chunk_id: String = r.get(1).map_err(|e| e.to_string())?;
        let blob: Vec<u8> = r.get(2).map_err(|e| e.to_string())?;
        if let Some(vector) = blob_to_vec_f32(&blob) {
            out.push(ChunkEmbedding { asset_id, chunk_id, vector });
        }
    }
    Ok(out)
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-5b — embeddings okuma yüzeyi (epoch>=1 okuma yolu). Sayım + asset-seviye
// + chunk-by-asset; `database.ts` sync okuyucularının vec.db karşılıkları.
// ═══════════════════════════════════════════════════════════════════════════════

/// `getEmbeddingCount` / `getEmbeddedAssetCount` / `hasAnyEmbeddings`
/// (`total>0`) vec.db karşılığı — tek sorguda iki sayım.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingStats {
    pub total: i64,
    pub distinct_assets: i64,
}

/// Embedding sayım istatistiği. vec.db yoksa 0/0 (dosyayı yaratmaz).
pub fn embedding_stats(vec_db: &Path) -> Result<EmbeddingStats, String> {
    if !vec_db.exists() {
        return Ok(EmbeddingStats {
            total: 0,
            distinct_assets: 0,
        });
    }
    let conn = open_vec_db(vec_db)?;
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM embeddings", [], |r| r.get(0))
        .map_err(|e| format!("embedding COUNT hatası: {}", e))?;
    let distinct_assets: i64 = conn
        .query_row("SELECT COUNT(DISTINCT asset_id) FROM embeddings", [], |r| {
            r.get(0)
        })
        .map_err(|e| format!("embedding DISTINCT COUNT hatası: {}", e))?;
    Ok(EmbeddingStats {
        total,
        distinct_assets,
    })
}

/// Asset-seviye embedding kontratı — `getEmbeddingsBySourcePrefix` ile aynı
/// şekil (`{assetId, source, vector}`). `getAllEmbeddings` `source`'u yok
/// sayar (frontend alanı düşürür).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEmbedding {
    pub asset_id: String,
    pub source: String,
    pub vector: Vec<f32>,
}

/// Embedding'leri `source` ile servis et — `prefix=false` tam eşleşme
/// (`getAllEmbeddings`), `prefix=true` `source LIKE 'arg%'`
/// (`getEmbeddingsBySourcePrefix`). Bozuk blob satırı atlanır.
pub fn query_embeddings_by_source(
    vec_db: &Path,
    source: &str,
    prefix: bool,
) -> Result<Vec<SourceEmbedding>, String> {
    if !vec_db.exists() {
        return Ok(Vec::new());
    }
    let conn = open_vec_db(vec_db)?;
    let (sql, pat) = if prefix {
        (
            "SELECT asset_id, source, vector_blob FROM embeddings \
             WHERE source LIKE ?1 ORDER BY id",
            format!("{}%", source),
        )
    } else {
        (
            "SELECT asset_id, source, vector_blob FROM embeddings \
             WHERE source = ?1 ORDER BY id",
            source.to_string(),
        )
    };
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("prepare hatası: {}", e))?;
    let mut rows = stmt
        .query(rusqlite::params![pat])
        .map_err(|e| format!("query hatası: {}", e))?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().map_err(|e| format!("satır hatası: {}", e))? {
        let asset_id: String = r.get(0).map_err(|e| e.to_string())?;
        let src: String = r.get(1).map_err(|e| e.to_string())?;
        let blob: Vec<u8> = r.get(2).map_err(|e| e.to_string())?;
        if let Some(vector) = blob_to_vec_f32(&blob) {
            out.push(SourceEmbedding {
                asset_id,
                source: src,
                vector,
            });
        }
    }
    Ok(out)
}

/// Verilen asset id'leri için chunk embedding'leri servis et —
/// `getChunkEmbeddingsByAssetIds` vec.db karşılığı (`source` filtreli,
/// `ref_id` dolu). SQLite bound-param limiti için 400'lük batch'lerle
/// sorgular; bozuk blob satırı atlanır.
pub fn query_chunk_embeddings_by_assets(
    vec_db: &Path,
    asset_ids: &[String],
    source: &str,
) -> Result<Vec<ChunkEmbedding>, String> {
    if !vec_db.exists() || asset_ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = open_vec_db(vec_db)?;
    let mut out = Vec::new();
    for batch in asset_ids.chunks(400) {
        let placeholders: String = (0..batch.len())
            .map(|i| format!("?{}", i + 2))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT asset_id, ref_id, vector_blob FROM embeddings \
             WHERE source = ?1 AND ref_id IS NOT NULL AND ref_id != '' \
               AND asset_id IN ({placeholders})"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("prepare hatası: {}", e))?;
        let mut params: Vec<&str> = Vec::with_capacity(batch.len() + 1);
        params.push(source);
        for a in batch {
            params.push(a.as_str());
        }
        let mut rows = stmt
            .query(rusqlite::params_from_iter(params))
            .map_err(|e| format!("query hatası: {}", e))?;
        while let Some(r) = rows.next().map_err(|e| format!("satır hatası: {}", e))? {
            let asset_id: String = r.get(0).map_err(|e| e.to_string())?;
            let chunk_id: String = r.get(1).map_err(|e| e.to_string())?;
            let blob: Vec<u8> = r.get(2).map_err(|e| e.to_string())?;
            if let Some(vector) = blob_to_vec_f32(&blob) {
                out.push(ChunkEmbedding {
                    asset_id,
                    chunk_id,
                    vector,
                });
            }
        }
    }
    Ok(out)
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-5c — text_chunks okuma yüzeyi (epoch>=2 okuma yolu).
// ═══════════════════════════════════════════════════════════════════════════════

/// `text_chunks` okuma satırı — `getChunkById`/`getChunksByAssetId` ile aynı
/// alanlar. `getChunksByIds` ayrıca `assets`'ten file_name/file_path ekler;
/// `assets` sql.js'te kaldığından o join frontend'de yapılır.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkRecord {
    pub id: String,
    pub asset_id: String,
    pub chunk_index: i64,
    pub page: Option<i64>,
    pub text: String,
    pub lang: Option<String>,
}

fn row_to_chunk_record(r: &rusqlite::Row) -> Result<ChunkRecord, String> {
    Ok(ChunkRecord {
        id: r.get(0).map_err(|e| e.to_string())?,
        asset_id: r.get(1).map_err(|e| e.to_string())?,
        chunk_index: r.get(2).map_err(|e| e.to_string())?,
        page: r.get(3).map_err(|e| e.to_string())?,
        text: r.get(4).map_err(|e| e.to_string())?,
        lang: r.get(5).map_err(|e| e.to_string())?,
    })
}

/// Verilen chunk id'leri için satırları servis et — `getChunksByIds`
/// (assets join'i hariç; frontend ekler). 400'lük batch.
pub fn query_chunks_by_ids(
    vec_db: &Path,
    ids: &[String],
) -> Result<Vec<ChunkRecord>, String> {
    if !vec_db.exists() || ids.is_empty() {
        return Ok(Vec::new());
    }
    let conn = open_vec_db(vec_db)?;
    let mut out = Vec::new();
    for batch in ids.chunks(400) {
        let placeholders: String = (0..batch.len())
            .map(|i| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, asset_id, chunk_index, page, text, lang FROM text_chunks \
             WHERE id IN ({placeholders})"
        );
        let mut stmt = conn
            .prepare(&sql)
            .map_err(|e| format!("prepare hatası: {}", e))?;
        let mut rows = stmt
            .query(rusqlite::params_from_iter(batch.iter().map(|s| s.as_str())))
            .map_err(|e| format!("query hatası: {}", e))?;
        while let Some(r) = rows.next().map_err(|e| format!("satır hatası: {}", e))? {
            out.push(row_to_chunk_record(r)?);
        }
    }
    Ok(out)
}

/// Bir asset'in chunk'larını `chunk_index` sırasında servis et —
/// `getChunksByAssetId`. `limit<=0` → sınırsız.
pub fn query_chunks_by_asset(
    vec_db: &Path,
    asset_id: &str,
    limit: i64,
) -> Result<Vec<ChunkRecord>, String> {
    if !vec_db.exists() {
        return Ok(Vec::new());
    }
    let conn = open_vec_db(vec_db)?;
    let lim = if limit <= 0 { -1 } else { limit };
    let mut stmt = conn
        .prepare(
            "SELECT id, asset_id, chunk_index, page, text, lang FROM text_chunks \
             WHERE asset_id = ?1 ORDER BY chunk_index ASC LIMIT ?2",
        )
        .map_err(|e| format!("prepare hatası: {}", e))?;
    let mut rows = stmt
        .query(rusqlite::params![asset_id, lim])
        .map_err(|e| format!("query hatası: {}", e))?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().map_err(|e| format!("satır hatası: {}", e))? {
        out.push(row_to_chunk_record(r)?);
    }
    Ok(out)
}

/// Bir asset'in chunk sayısı — `getChunkCountByAssetId`. vec.db yoksa 0.
pub fn chunk_count_for_asset(vec_db: &Path, asset_id: &str) -> Result<i64, String> {
    if !vec_db.exists() {
        return Ok(0);
    }
    let conn = open_vec_db(vec_db)?;
    conn.query_row(
        "SELECT COUNT(*) FROM text_chunks WHERE asset_id = ?1",
        rusqlite::params![asset_id],
        |r| r.get(0),
    )
    .map_err(|e| format!("chunk COUNT hatası: {}", e))
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-5e — asset_relations okuma yüzeyi (epoch>=3 okuma yolu).
// ═══════════════════════════════════════════════════════════════════════════════

/// `asset_relations` okuma satırı — `getRelationsForAsset` (`database.ts`)
/// `AssetRelation` şekliyle aynı alanlar.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationRecord {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation_type: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub created_by: Option<String>,
}

fn row_to_relation_record(r: &rusqlite::Row) -> Result<RelationRecord, String> {
    Ok(RelationRecord {
        id: r.get(0).map_err(|e| e.to_string())?,
        source_id: r.get(1).map_err(|e| e.to_string())?,
        target_id: r.get(2).map_err(|e| e.to_string())?,
        relation_type: r.get(3).map_err(|e| e.to_string())?,
        notes: r.get(4).map_err(|e| e.to_string())?,
        created_at: r.get(5).map_err(|e| e.to_string())?,
        created_by: r.get(6).map_err(|e| e.to_string())?,
    })
}

/// İlişki satırlarını servis et — `asset_id` verilirse o asset'in ilişkileri
/// (`source_id` VEYA `target_id`), yoksa TÜM ilişkiler. `getRelationsForAsset`
/// (asset'li) ve `_getAllRelationIds` (asset'siz) vec.db karşılığı.
pub fn query_asset_relations(
    vec_db: &Path,
    asset_id: Option<&str>,
) -> Result<Vec<RelationRecord>, String> {
    if !vec_db.exists() {
        return Ok(Vec::new());
    }
    let conn = open_vec_db(vec_db)?;
    let base = "SELECT id, source_id, target_id, relation_type, notes, \
                created_at, created_by FROM asset_relations";
    let sql = match asset_id {
        Some(_) => format!("{base} WHERE source_id = ?1 OR target_id = ?1"),
        None => base.to_string(),
    };
    let mut stmt = conn
        .prepare(&sql)
        .map_err(|e| format!("prepare hatası: {}", e))?;
    let params: Vec<&str> = match asset_id {
        Some(a) => vec![a],
        None => vec![],
    };
    let mut rows = stmt
        .query(rusqlite::params_from_iter(params))
        .map_err(|e| format!("query hatası: {}", e))?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().map_err(|e| format!("satır hatası: {}", e))? {
        out.push(row_to_relation_record(r)?);
    }
    Ok(out)
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-5f — index durum/sayım okuma yüzeyi (analyzeRagIndex + ChatPanel rozeti
// + buildNoResultDiagnostic teşhisi).
// ═══════════════════════════════════════════════════════════════════════════════

/// asset-başına sayım satırı.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetCount {
    pub asset_id: String,
    pub count: i64,
}

/// `analyzeRagIndex` için asset-başına chunk + chunk-embedding sayımları
/// (GROUP BY asset_id). Frontend bunları asset listesiyle birleştirir.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagIndexCounts {
    pub chunk_counts: Vec<AssetCount>,
    pub embed_counts: Vec<AssetCount>,
}

/// `(asset_id, COUNT)` döndüren bir GROUP BY sorgusunu `Vec<AssetCount>`'a
/// topla. `rag_index_counts` + `body_chunk_counts` ortak yardımcısı.
fn collect_asset_counts(
    conn: &rusqlite::Connection,
    sql: &str,
) -> Result<Vec<AssetCount>, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("prepare hatası: {}", e))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("query hatası: {}", e))?;
    let mut out = Vec::new();
    while let Some(r) = rows.next().map_err(|e| format!("satır hatası: {}", e))? {
        out.push(AssetCount {
            asset_id: r.get(0).map_err(|e| e.to_string())?,
            count: r.get(1).map_err(|e| e.to_string())?,
        });
    }
    Ok(out)
}

pub fn rag_index_counts(vec_db: &Path) -> Result<RagIndexCounts, String> {
    if !vec_db.exists() {
        return Ok(RagIndexCounts {
            chunk_counts: Vec::new(),
            embed_counts: Vec::new(),
        });
    }
    let conn = open_vec_db(vec_db)?;
    let chunk_counts = collect_asset_counts(
        &conn,
        "SELECT asset_id, COUNT(*) FROM text_chunks GROUP BY asset_id",
    )?;
    let embed_counts = collect_asset_counts(
        &conn,
        "SELECT asset_id, COUNT(*) FROM embeddings \
         WHERE source = 'chunk_text' AND ref_id IS NOT NULL AND ref_id != '' \
         GROUP BY asset_id",
    )?;
    Ok(RagIndexCounts {
        chunk_counts,
        embed_counts,
    })
}

/// PRE-6b — yalnız BODY chunk (`chunk_index >= 0`) asset-başına chunk +
/// chunk-embedding sayımları. `purgeNonIndexableChunks` legacy çöp
/// temizliği için: frontend non-indexable file_type'ları sql.js'ten
/// süzüp bu map'le kesişir. Metadata chunk'ları (`chunk_index = -1`)
/// KORUNUR — onlar her tip için geçerli. `rag_index_counts`'in body-only
/// eşi. Salt-okunur.
pub fn body_chunk_counts(vec_db: &Path) -> Result<RagIndexCounts, String> {
    if !vec_db.exists() {
        return Ok(RagIndexCounts {
            chunk_counts: Vec::new(),
            embed_counts: Vec::new(),
        });
    }
    let conn = open_vec_db(vec_db)?;
    let chunk_counts = collect_asset_counts(
        &conn,
        "SELECT asset_id, COUNT(*) FROM text_chunks \
         WHERE chunk_index >= 0 GROUP BY asset_id",
    )?;
    let embed_counts = collect_asset_counts(
        &conn,
        "SELECT e.asset_id, COUNT(*) FROM embeddings e \
         JOIN text_chunks tc ON tc.id = e.ref_id \
         WHERE e.source = 'chunk_text' AND tc.chunk_index >= 0 \
         GROUP BY e.asset_id",
    )?;
    Ok(RagIndexCounts {
        chunk_counts,
        embed_counts,
    })
}

/// `ChatPanel` rozeti + `buildNoResultDiagnostic` için chunk sayım özeti.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkStats {
    pub total: i64,
    pub meta_total: i64,
    pub meta_assets: i64,
    pub content_assets: i64,
}

pub fn chunk_stats(vec_db: &Path) -> Result<ChunkStats, String> {
    if !vec_db.exists() {
        return Ok(ChunkStats {
            total: 0,
            meta_total: 0,
            meta_assets: 0,
            content_assets: 0,
        });
    }
    let conn = open_vec_db(vec_db)?;
    let one = |sql: &str| -> Result<i64, String> {
        conn.query_row(sql, [], |r| r.get(0))
            .map_err(|e| format!("COUNT hatası: {}", e))
    };
    Ok(ChunkStats {
        total: one("SELECT COUNT(*) FROM text_chunks")?,
        meta_total: one("SELECT COUNT(*) FROM text_chunks WHERE chunk_index = -1")?,
        meta_assets: one(
            "SELECT COUNT(DISTINCT asset_id) FROM text_chunks WHERE chunk_index = -1",
        )?,
        content_assets: one(
            "SELECT COUNT(DISTINCT asset_id) FROM text_chunks WHERE chunk_index >= 0",
        )?,
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-6c — `ChatPanel` B2 auto-metadata-sync yazma yüzeyi: metadata chunk'ı
// (chunk_index = -1) olan asset'leri listele + bir asset'in meta chunk'larını sil.
// ═══════════════════════════════════════════════════════════════════════════════

/// PRE-6c — metadata chunk'ı (`chunk_index = -1`) OLAN asset id'leri (DISTINCT).
/// `ChatPanel` B2 auto-metadata-sync: tüm asset'ler − bu küme = "meta chunk
/// eksik" asset'ler. Salt-okunur.
pub fn metadata_chunk_asset_ids(vec_db: &Path) -> Result<Vec<String>, String> {
    if !vec_db.exists() {
        return Ok(Vec::new());
    }
    let conn = open_vec_db(vec_db)?;
    let mut stmt = conn
        .prepare("SELECT DISTINCT asset_id FROM text_chunks WHERE chunk_index = -1")
        .map_err(|e| format!("prepare hatası: {}", e))?;
    let ids = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| format!("query hatası: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("satır hatası: {}", e))?;
    Ok(ids)
}

/// PRE-6c — bir asset'in metadata chunk'larını (`chunk_index = -1`) vec.db'den
/// sil: `text_chunks` + bunlara bağlı `embeddings` (`ref_id`) + FTS satırları.
/// Body chunk'lara (`chunk_index >= 0`) DOKUNMAZ — `indexAssetMetadata`
/// re-index akışının epoch>=2 eşi. Döner: silinen metadata chunk sayısı.
pub fn delete_metadata_chunks(vec_db: &Path, asset_id: &str) -> Result<usize, String> {
    if !vec_db.exists() {
        return Ok(0);
    }
    let mut conn = open_vec_db(vec_db)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("TX başlatılamadı: {}", e))?;
    let deleted;
    {
        // Önce meta chunk id'lerini topla — embeddings/FTS `ref_id`/`chunk_id`
        // ile bağlı; chunk satırı silinmeden önce gerekli.
        let chunk_ids: Vec<String> = {
            let mut stmt = tx
                .prepare(
                    "SELECT id FROM text_chunks \
                     WHERE asset_id = ?1 AND chunk_index = -1",
                )
                .map_err(|e| format!("prepare select: {}", e))?;
            let ids = stmt
                .query_map(rusqlite::params![asset_id], |r| r.get::<_, String>(0))
                .map_err(|e| format!("query: {}", e))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("satır: {}", e))?;
            ids
        };
        {
            let mut d_emb = tx
                .prepare_cached("DELETE FROM embeddings WHERE ref_id = ?1")
                .map_err(|e| format!("prepare emb: {}", e))?;
            let mut d_fts = tx
                .prepare_cached("DELETE FROM fts_chunks WHERE chunk_id = ?1")
                .map_err(|e| format!("prepare fts: {}", e))?;
            for cid in &chunk_ids {
                d_emb
                    .execute(rusqlite::params![cid])
                    .map_err(|e| format!("emb sil: {}", e))?;
                d_fts
                    .execute(rusqlite::params![cid])
                    .map_err(|e| format!("fts sil: {}", e))?;
            }
        }
        deleted = {
            let mut d_ch = tx
                .prepare_cached(
                    "DELETE FROM text_chunks \
                     WHERE asset_id = ?1 AND chunk_index = -1",
                )
                .map_err(|e| format!("prepare chunk: {}", e))?;
            d_ch
                .execute(rusqlite::params![asset_id])
                .map_err(|e| format!("chunk sil: {}", e))?
        };
    }
    tx.commit().map_err(|e| format!("commit: {}", e))?;
    Ok(deleted)
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-6d — snapshot/restore (klasör-sil undo) için vec.db asset dışa/içe-aktarımı.
// Dönen/alınan satırlar `apply_*` girdileriyle BİREBİR aynı → kayıpsız round-trip.
// ═══════════════════════════════════════════════════════════════════════════════

/// PRE-6d — `snapshotScannedRootWithAssets` undo snapshot'ı için vec.db'den
/// dışa-aktarılan V3-eligible satırlar. `import_assets` ile birebir geri yüklenir.
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetVecExport {
    pub embeddings: Vec<EmbeddingRow>,
    pub text_chunks: Vec<TextChunkRow>,
    pub asset_relations: Vec<AssetRelationRow>,
}

/// PRE-6d — verilen asset'lerin embeddings/text_chunks/asset_relations
/// satırlarını vec.db'den TAM (kayıpsız) oku. `IN` 400'lük batch'lenir;
/// ilişkiler iki uçtan da eşleşebildiği için id'ye göre tekilleştirilir.
pub fn export_assets(vec_db: &Path, asset_ids: &[String]) -> Result<AssetVecExport, String> {
    let mut out = AssetVecExport::default();
    if !vec_db.exists() || asset_ids.is_empty() {
        return Ok(out);
    }
    let conn = open_vec_db(vec_db)?;
    let mut seen_rel: std::collections::HashSet<String> = std::collections::HashSet::new();
    for batch in asset_ids.chunks(400) {
        let ph: String = (0..batch.len())
            .map(|i| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(",");

        // embeddings (asset-level + chunk-level — kaynak ne ise)
        {
            let sql = format!(
                "SELECT id, asset_id, ref_id, vector_blob, source \
                 FROM embeddings WHERE asset_id IN ({ph})"
            );
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("emb prepare: {}", e))?;
            let mut rows = stmt
                .query(rusqlite::params_from_iter(batch.iter().map(|s| s.as_str())))
                .map_err(|e| format!("emb query: {}", e))?;
            while let Some(r) = rows.next().map_err(|e| format!("emb satır: {}", e))? {
                out.embeddings.push(EmbeddingRow {
                    id: r.get(0).map_err(|e| e.to_string())?,
                    asset_id: r.get(1).map_err(|e| e.to_string())?,
                    ref_id: r.get(2).map_err(|e| e.to_string())?,
                    vector_blob: r.get(3).map_err(|e| e.to_string())?,
                    source: r.get(4).map_err(|e| e.to_string())?,
                });
            }
        }
        // text_chunks
        {
            let sql = format!(
                "SELECT id, asset_id, chunk_index, page, text, lang \
                 FROM text_chunks WHERE asset_id IN ({ph})"
            );
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("chunk prepare: {}", e))?;
            let mut rows = stmt
                .query(rusqlite::params_from_iter(batch.iter().map(|s| s.as_str())))
                .map_err(|e| format!("chunk query: {}", e))?;
            while let Some(r) = rows.next().map_err(|e| format!("chunk satır: {}", e))? {
                out.text_chunks.push(TextChunkRow {
                    id: r.get(0).map_err(|e| e.to_string())?,
                    asset_id: r.get(1).map_err(|e| e.to_string())?,
                    chunk_index: r.get(2).map_err(|e| e.to_string())?,
                    page: r.get(3).map_err(|e| e.to_string())?,
                    text: r.get(4).map_err(|e| e.to_string())?,
                    lang: r.get(5).map_err(|e| e.to_string())?,
                });
            }
        }
        // asset_relations — source_id VEYA target_id batch'te (?1..?N iki kez
        // aynı pozisyonel parametre → yalnız N bağlama). Batch'ler arası
        // çift olabilir → seen_rel ile tekille.
        {
            let sql = format!(
                "SELECT id, source_id, target_id, relation_type, notes, created_at, created_by \
                 FROM asset_relations WHERE source_id IN ({ph}) OR target_id IN ({ph})"
            );
            let mut stmt = conn
                .prepare(&sql)
                .map_err(|e| format!("rel prepare: {}", e))?;
            let mut rows = stmt
                .query(rusqlite::params_from_iter(batch.iter().map(|s| s.as_str())))
                .map_err(|e| format!("rel query: {}", e))?;
            while let Some(r) = rows.next().map_err(|e| format!("rel satır: {}", e))? {
                let id: String = r.get(0).map_err(|e| e.to_string())?;
                if !seen_rel.insert(id.clone()) {
                    continue;
                }
                out.asset_relations.push(AssetRelationRow {
                    id,
                    source_id: r.get(1).map_err(|e| e.to_string())?,
                    target_id: r.get(2).map_err(|e| e.to_string())?,
                    relation_type: r.get(3).map_err(|e| e.to_string())?,
                    notes: r.get(4).map_err(|e| e.to_string())?,
                    created_at: r.get(5).map_err(|e| e.to_string())?,
                    created_by: r.get(6).map_err(|e| e.to_string())?,
                });
            }
        }
    }
    Ok(out)
}

/// PRE-6d — `restoreScannedRootWithAssets` undo: snapshot'tan vec.db'ye
/// embeddings/text_chunks/asset_relations geri-yaz. `apply_*` `INSERT OR
/// IGNORE` → idempotent (zaten varsa atlar). FTS `apply_text_chunks` ile
/// otomatik beslenir.
pub fn import_assets(vec_db: &Path, data: &AssetVecExport) -> Result<(), String> {
    apply_embeddings(vec_db, &data.embeddings)?;
    apply_text_chunks(vec_db, &data.text_chunks)?;
    apply_asset_relations(vec_db, &data.asset_relations)?;
    Ok(())
}

/// DESIGN-LOCK §5 üç-katman doğrulama. `verified` true ise frontend
/// güvenle sql.js'ten DROP + epoch++ yapabilir.
pub fn verify_embeddings(
    source_db: &Path,
    vec_db: &Path,
) -> Result<MigrationReport, String> {
    let src = rusqlite::Connection::open(source_db)
        .map_err(|e| format!("kaynak DB açılamadı: {}", e))?;
    let vec = open_vec_db(vec_db)?;

    let source_count: i64 = src
        .query_row("SELECT COUNT(*) FROM embeddings", [], |r| r.get(0))
        .map_err(|e| format!("kaynak COUNT hatası: {}", e))?;
    let vec_cnt: i64 = vec
        .query_row("SELECT COUNT(*) FROM embeddings", [], |r| r.get(0))
        .map_err(|e| format!("vec COUNT hatası: {}", e))?;
    let count_match = source_count == vec_cnt;

    let content_hash_match =
        embeddings_canonical_hash(&src)? == embeddings_canonical_hash(&vec)?;

    // §5.3 — blob ROUND-TRIP örneklemi (ilk/orta/son): vec.db blob'u kaynakla
    // BİREBİR eşleşmeli + geçerli f32 vektör (boş değil, uzunluk 4'ün katı).
    //
    // NOT (Gate #1 2026-05-19 gerçek-db bulgusu): v2.4.9 `embeddings` tablosu
    // KARIŞIK boyut tutar — 384-dim MiniLM metin (1536B) + 512-dim CLIP görsel
    // (2048B, üretimde satırların ~%64'ü). Eski `len == 384*4` sabiti her
    // gerçek db'yi sahte-FAIL ediyordu. Round-trip dim'den bağımsızdır ve
    // gerçek değişmezi (migrasyon blob'u bozmadı) doğrudan sınar.
    let mut blob_sample_ok = true;
    if vec_cnt > 0 {
        let mut vstmt = vec
            .prepare(
                "SELECT id, vector_blob FROM embeddings ORDER BY id
                 LIMIT 1 OFFSET ?1",
            )
            .map_err(|e| format!("örneklem prepare hatası: {}", e))?;
        let mut sstmt = src
            .prepare("SELECT vector_blob FROM embeddings WHERE id = ?1")
            .map_err(|e| format!("kaynak örneklem prepare hatası: {}", e))?;
        for off in [0i64, vec_cnt / 2, vec_cnt - 1] {
            let (id, vblob): (String, Vec<u8>) = vstmt
                .query_row(rusqlite::params![off.max(0)], |r| {
                    Ok((r.get(0)?, r.get(1)?))
                })
                .map_err(|e| format!("örneklem hatası: {}", e))?;
            let sblob: Vec<u8> = sstmt
                .query_row(rusqlite::params![&id], |r| r.get(0))
                .map_err(|e| format!("kaynak örneklem hatası: {}", e))?;
            if vblob.is_empty() || vblob.len() % 4 != 0 || vblob != sblob {
                blob_sample_ok = false;
                break;
            }
        }
    }

    let verified = count_match && content_hash_match && blob_sample_ok;
    Ok(MigrationReport {
        source_count,
        vec_count: vec_cnt,
        count_match,
        content_hash_match,
        blob_sample_ok,
        verified,
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// EPOCH 2 — text_chunks (DESIGN-LOCK §2/§5). migrate_embeddings deseninin
// birebir kopyası; blob ön-koşulu YOK, blob round-trip YOK (metin tablosu).
// ═══════════════════════════════════════════════════════════════════════════════

/// Taşınacak text_chunk satırı (v2.4.9 `text_chunks` şeması, DESIGN-LOCK §0).
/// PRE-6d: snapshot/restore round-trip için serde.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct TextChunkRow {
    pub id: String,
    pub asset_id: String,
    pub chunk_index: i64,
    pub page: Option<i64>,
    pub text: String,
    pub lang: Option<String>,
}

/// Türkçe-aware ASCII normalizasyon — `database.ts` `insertFtsChunk` /
/// `ftsSearchChunks` ile BİREBİR sonuç: küçük harf + `I/İ/ı→i`, `ç/Ç→c`,
/// `ğ/Ğ→g`, `ö/Ö→o`, `ş/Ş→s`, `ü/Ü→u`. FTS5 index'i ve sorgu aynı
/// fonksiyondan geçer → tutarlı eşleşme (sql.js `fts_chunks` deseni).
/// NOT: sql.js `toLocaleLowerCase('tr')` 'I'→'ı'→'i' verir; burada 'I'
/// doğrudan 'i'ye eşlenir → net sonuç aynı.
pub(crate) fn fts_normalize(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            'I' | 'İ' | 'ı' => out.push('i'),
            'Ç' | 'ç' => out.push('c'),
            'Ğ' | 'ğ' => out.push('g'),
            'Ö' | 'ö' => out.push('o'),
            'Ş' | 'ş' => out.push('s'),
            'Ü' | 'ü' => out.push('u'),
            _ => out.extend(ch.to_lowercase()),
        }
    }
    out
}

/// text_chunks batch'i vec.db'ye yaz — `INSERT OR IGNORE` (PK=id) idempotent.
/// `created_at` şema DEFAULT'undan (embeddings deseni).
///
/// PRE-5a: gerçekten yeni eklenen (n==1) her satır için `fts_chunks` keyword
/// index'i de doldurulur. `fts_chunks` PK'siz virtual table olduğundan
/// idempotent resume'da (n==0) çift-index yazılmaz.
pub fn apply_text_chunks(path: &Path, rows: &[TextChunkRow]) -> Result<usize, String> {
    let mut conn = open_vec_db(path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("TX başlatılamadı: {}", e))?;
    let mut written = 0usize;
    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT OR IGNORE INTO text_chunks
                 (id, asset_id, chunk_index, page, text, lang)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| format!("prepare hatası: {}", e))?;
        let mut fts = tx
            .prepare_cached(
                "INSERT INTO fts_chunks (chunk_id, asset_id, text)
                 VALUES (?1, ?2, ?3)",
            )
            .map_err(|e| format!("fts prepare hatası: {}", e))?;
        for r in rows {
            let n = stmt
                .execute(rusqlite::params![
                    &r.id,
                    &r.asset_id,
                    &r.chunk_index,
                    &r.page,
                    &r.text,
                    &r.lang
                ])
                .map_err(|e| format!("INSERT hatası: {}", e))?;
            if n == 1 {
                fts.execute(rusqlite::params![
                    &r.id,
                    &r.asset_id,
                    fts_normalize(&r.text)
                ])
                .map_err(|e| format!("fts INSERT hatası: {}", e))?;
            }
            written += n;
        }
    }
    tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
    Ok(written)
}

/// `text_chunks`'i kaynak monolitten vec.db'ye taşı — batch + resume
/// (`migrate_embeddings` deseni; blob ön-koşulu yok).
pub fn migrate_text_chunks(
    source_db: &Path,
    vec_db: &Path,
    batch_size: i64,
) -> Result<usize, String> {
    let src = rusqlite::Connection::open(source_db)
        .map_err(|e| format!("kaynak DB açılamadı: {}", e))?;
    let total: i64 = src
        .query_row("SELECT COUNT(*) FROM text_chunks", [], |r| r.get(0))
        .map_err(|e| format!("kaynak COUNT hatası: {}", e))?;
    let mut after = progress_get(vec_db, "text_chunks")?
        .map(|(last, _, _)| last)
        .unwrap_or(0);
    progress_set(vec_db, "text_chunks", after, total, false)?;

    let mut total_written = 0usize;
    loop {
        let mut stmt = src
            .prepare(
                "SELECT rowid, id, asset_id, chunk_index, page, text, lang
                 FROM text_chunks WHERE rowid > ?1 ORDER BY rowid LIMIT ?2",
            )
            .map_err(|e| format!("kaynak prepare hatası: {}", e))?;
        let rows: Vec<(i64, TextChunkRow)> = stmt
            .query_map(rusqlite::params![after, batch_size], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    TextChunkRow {
                        id: r.get(1)?,
                        asset_id: r.get(2)?,
                        chunk_index: r.get(3)?,
                        page: r.get(4)?,
                        text: r.get(5)?,
                        lang: r.get(6)?,
                    },
                ))
            })
            .map_err(|e| format!("kaynak query hatası: {}", e))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("kaynak satır hatası: {}", e))?;
        if rows.is_empty() {
            break;
        }
        let max_rowid = rows.last().unwrap().0;
        let batch: Vec<TextChunkRow> = rows.into_iter().map(|(_, c)| c).collect();
        total_written += apply_text_chunks(vec_db, &batch)?;
        after = max_rowid;
        progress_set(vec_db, "text_chunks", after, total, false)?;
    }
    // PRE-5a: `apply_text_chunks` her batch'te FTS'i besler; fakat PRE-5a
    // öncesi migrate edilmiş (fts_chunks boş) bir vec.db'de resume edilirse
    // satırlar n==0 döner → FTS dolmaz. Güvenlik ağı: sayım tutmuyorsa
    // FTS'i text_chunks'tan tam yeniden kur.
    if vec_count(vec_db, "fts_chunks")? != vec_count(vec_db, "text_chunks")? {
        rebuild_fts(vec_db)?;
    }
    Ok(total_written)
}

/// `text_chunks` kanonik SHA-256 — `ORDER BY id`, sabit alan sırası
/// (`embeddings_canonical_hash` ayıraç deseni: \x1f alan, \x1e satır).
fn text_chunks_canonical_hash(conn: &rusqlite::Connection) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, asset_id, chunk_index, IFNULL(CAST(page AS TEXT),''),
                    text, IFNULL(lang,'')
             FROM text_chunks ORDER BY id",
        )
        .map_err(|e| format!("hash prepare hatası: {}", e))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("hash query hatası: {}", e))?;
    while let Some(row) = rows.next().map_err(|e| format!("hash satır hatası: {}", e))? {
        let id: String = row.get(0).map_err(|e| e.to_string())?;
        let asset_id: String = row.get(1).map_err(|e| e.to_string())?;
        let chunk_index: i64 = row.get(2).map_err(|e| e.to_string())?;
        let page: String = row.get(3).map_err(|e| e.to_string())?;
        let text: String = row.get(4).map_err(|e| e.to_string())?;
        let lang: String = row.get(5).map_err(|e| e.to_string())?;
        for f in [
            id.as_bytes(),
            asset_id.as_bytes(),
            chunk_index.to_string().as_bytes(),
            page.as_bytes(),
            text.as_bytes(),
            lang.as_bytes(),
        ] {
            hasher.update(f);
            hasher.update([0x1f]);
        }
        hasher.update([0x1e]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// §5 doğrulama — text_chunks (COUNT + içerik-hash; blob round-trip N/A → true).
pub fn verify_text_chunks(
    source_db: &Path,
    vec_db: &Path,
) -> Result<MigrationReport, String> {
    let src = rusqlite::Connection::open(source_db)
        .map_err(|e| format!("kaynak DB açılamadı: {}", e))?;
    let vec = open_vec_db(vec_db)?;
    let source_count: i64 = src
        .query_row("SELECT COUNT(*) FROM text_chunks", [], |r| r.get(0))
        .map_err(|e| format!("kaynak COUNT hatası: {}", e))?;
    let vec_cnt: i64 = vec
        .query_row("SELECT COUNT(*) FROM text_chunks", [], |r| r.get(0))
        .map_err(|e| format!("vec COUNT hatası: {}", e))?;
    let count_match = source_count == vec_cnt;
    let content_hash_match =
        text_chunks_canonical_hash(&src)? == text_chunks_canonical_hash(&vec)?;
    let verified = count_match && content_hash_match;
    Ok(MigrationReport {
        source_count,
        vec_count: vec_cnt,
        count_match,
        content_hash_match,
        blob_sample_ok: true, // metin tablosu — blob round-trip uygulanmaz
        verified,
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRE-5a — FTS5 keyword arama (epoch>=2 okuma yolu). `ftsSearchChunks`
// (database.ts:4457) vec.db karşılığı.
// ═══════════════════════════════════════════════════════════════════════════════

/// `fts_chunks` keyword araması dönüş satırı — `ftsSearchChunks` Map
/// kontratı (`chunkId → {assetId, score}`). Skor frontend'de dönüş dizin
/// sırasından üretilir (`1/(idx+1)`); satırlar bm25 sırasında gelir.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FtsHit {
    pub chunk_id: String,
    pub asset_id: String,
}

/// `fts_chunks`'i `text_chunks`'tan tam yeniden kurar. PRE-5a öncesi
/// (fts_chunks boş) migrate edilmiş vec.db'ler için güvenlik ağı —
/// `migrate_text_chunks` sayım tutmuyorsa çağırır. Yazılan satır sayısını döner.
pub fn rebuild_fts(vec_db: &Path) -> Result<usize, String> {
    let mut conn = open_vec_db(vec_db)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("fts rebuild TX hatası: {}", e))?;
    tx.execute("DELETE FROM fts_chunks", [])
        .map_err(|e| format!("fts rebuild temizleme hatası: {}", e))?;
    let mut written = 0usize;
    {
        let mut sel = tx
            .prepare("SELECT id, asset_id, text FROM text_chunks")
            .map_err(|e| format!("fts rebuild select hatası: {}", e))?;
        let mut ins = tx
            .prepare_cached(
                "INSERT INTO fts_chunks (chunk_id, asset_id, text)
                 VALUES (?1, ?2, ?3)",
            )
            .map_err(|e| format!("fts rebuild insert prepare: {}", e))?;
        let mut rows = sel
            .query([])
            .map_err(|e| format!("fts rebuild query hatası: {}", e))?;
        while let Some(row) = rows
            .next()
            .map_err(|e| format!("fts rebuild satır hatası: {}", e))?
        {
            let id: String = row.get(0).map_err(|e| e.to_string())?;
            let asset_id: String = row.get(1).map_err(|e| e.to_string())?;
            let text: String = row.get(2).map_err(|e| e.to_string())?;
            ins.execute(rusqlite::params![id, asset_id, fts_normalize(&text)])
                .map_err(|e| format!("fts rebuild INSERT hatası: {}", e))?;
            written += 1;
        }
    }
    tx.commit()
        .map_err(|e| format!("fts rebuild commit hatası: {}", e))?;
    Ok(written)
}

/// `fts_chunks` keyword araması — `database.ts` `ftsSearchChunks` vec.db
/// karşılığı. Sorgu `fts_normalize`'dan geçer; 3+ karakterli token'lar
/// prefix-wildcard (`tok*`) + `OR` ile MATCH'lenir, bm25 sırasında döner.
/// vec.db yoksa veya anlamlı token yoksa boş liste.
///
/// NOT: sql.js `ftsSearchChunks` ayrıca bir LIKE fallback'i içerir — o,
/// **sql.js WASM** FTS5 build'inin `tokenize='ascii'` quirk'i içindir
/// (yorum database.ts:4491). rusqlite'ın bundled SQLite FTS5'i bu
/// quirk'ten muaftır; fallback gereksiz → MATCH otoriter.
pub fn fts_search_chunks(
    vec_db: &Path,
    query: &str,
    limit: i64,
) -> Result<Vec<FtsHit>, String> {
    if !vec_db.exists() {
        return Ok(Vec::new());
    }
    let tokens: Vec<String> = fts_normalize(query)
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() >= 3)
        .map(|t| format!("{}*", t))
        .collect();
    if tokens.is_empty() {
        return Ok(Vec::new());
    }
    let match_expr = tokens.join(" OR ");
    let lim = limit.clamp(1, 100_000);
    let conn = open_vec_db(vec_db)?;
    let mut stmt = conn
        .prepare(
            "SELECT chunk_id, asset_id FROM fts_chunks
             WHERE fts_chunks MATCH ?1 ORDER BY bm25(fts_chunks) LIMIT ?2",
        )
        .map_err(|e| format!("fts prepare hatası: {}", e))?;
    let hits = stmt
        .query_map(rusqlite::params![match_expr, lim], |r| {
            Ok(FtsHit {
                chunk_id: r.get(0)?,
                asset_id: r.get(1)?,
            })
        })
        .map_err(|e| format!("fts query hatası: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("fts satır hatası: {}", e))?;
    Ok(hits)
}

// ═══════════════════════════════════════════════════════════════════════════════
// EPOCH 3 — asset_relations (DESIGN-LOCK §2/§5). FK-yoğun kullanıcı verisi;
// `created_at` NOT NULL (şema DEFAULT yok) → taşınmalı.
// ═══════════════════════════════════════════════════════════════════════════════

/// Taşınacak asset_relations satırı (v2.4.9 şeması, DESIGN-LOCK §0).
/// PRE-6d: snapshot/restore round-trip için serde.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AssetRelationRow {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relation_type: String,
    pub notes: Option<String>,
    pub created_at: String,
    pub created_by: Option<String>,
}

/// asset_relations batch'i vec.db'ye yaz — `INSERT OR IGNORE` (PK=id) idempotent.
pub fn apply_asset_relations(
    path: &Path,
    rows: &[AssetRelationRow],
) -> Result<usize, String> {
    let mut conn = open_vec_db(path)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("TX başlatılamadı: {}", e))?;
    let mut written = 0usize;
    {
        let mut stmt = tx
            .prepare_cached(
                "INSERT OR IGNORE INTO asset_relations
                 (id, source_id, target_id, relation_type, notes, created_at, created_by)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| format!("prepare hatası: {}", e))?;
        for r in rows {
            written += stmt
                .execute(rusqlite::params![
                    &r.id,
                    &r.source_id,
                    &r.target_id,
                    &r.relation_type,
                    &r.notes,
                    &r.created_at,
                    &r.created_by
                ])
                .map_err(|e| format!("INSERT hatası: {}", e))?;
        }
    }
    tx.commit().map_err(|e| format!("commit hatası: {}", e))?;
    Ok(written)
}

/// `asset_relations`'i kaynak monolitten vec.db'ye taşı — batch + resume.
pub fn migrate_asset_relations(
    source_db: &Path,
    vec_db: &Path,
    batch_size: i64,
) -> Result<usize, String> {
    let src = rusqlite::Connection::open(source_db)
        .map_err(|e| format!("kaynak DB açılamadı: {}", e))?;
    let total: i64 = src
        .query_row("SELECT COUNT(*) FROM asset_relations", [], |r| r.get(0))
        .map_err(|e| format!("kaynak COUNT hatası: {}", e))?;
    let mut after = progress_get(vec_db, "asset_relations")?
        .map(|(last, _, _)| last)
        .unwrap_or(0);
    progress_set(vec_db, "asset_relations", after, total, false)?;

    let mut total_written = 0usize;
    loop {
        let mut stmt = src
            .prepare(
                "SELECT rowid, id, source_id, target_id, relation_type, notes,
                        created_at, created_by
                 FROM asset_relations WHERE rowid > ?1 ORDER BY rowid LIMIT ?2",
            )
            .map_err(|e| format!("kaynak prepare hatası: {}", e))?;
        let rows: Vec<(i64, AssetRelationRow)> = stmt
            .query_map(rusqlite::params![after, batch_size], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    AssetRelationRow {
                        id: r.get(1)?,
                        source_id: r.get(2)?,
                        target_id: r.get(3)?,
                        relation_type: r.get(4)?,
                        notes: r.get(5)?,
                        created_at: r.get(6)?,
                        created_by: r.get(7)?,
                    },
                ))
            })
            .map_err(|e| format!("kaynak query hatası: {}", e))?
            .collect::<Result<_, _>>()
            .map_err(|e| format!("kaynak satır hatası: {}", e))?;
        if rows.is_empty() {
            break;
        }
        let max_rowid = rows.last().unwrap().0;
        let batch: Vec<AssetRelationRow> = rows.into_iter().map(|(_, r)| r).collect();
        total_written += apply_asset_relations(vec_db, &batch)?;
        after = max_rowid;
        progress_set(vec_db, "asset_relations", after, total, false)?;
    }
    Ok(total_written)
}

/// `asset_relations` kanonik SHA-256 — `ORDER BY id`, sabit alan sırası.
fn asset_relations_canonical_hash(
    conn: &rusqlite::Connection,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut stmt = conn
        .prepare(
            "SELECT id, source_id, target_id, relation_type, IFNULL(notes,''),
                    created_at, IFNULL(created_by,'')
             FROM asset_relations ORDER BY id",
        )
        .map_err(|e| format!("hash prepare hatası: {}", e))?;
    let mut rows = stmt
        .query([])
        .map_err(|e| format!("hash query hatası: {}", e))?;
    while let Some(row) = rows.next().map_err(|e| format!("hash satır hatası: {}", e))? {
        for i in 0..7 {
            let v: String = row.get(i).map_err(|e| e.to_string())?;
            hasher.update(v.as_bytes());
            hasher.update([0x1f]);
        }
        hasher.update([0x1e]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

/// §5 doğrulama — asset_relations (COUNT + içerik-hash; blob round-trip N/A).
pub fn verify_asset_relations(
    source_db: &Path,
    vec_db: &Path,
) -> Result<MigrationReport, String> {
    let src = rusqlite::Connection::open(source_db)
        .map_err(|e| format!("kaynak DB açılamadı: {}", e))?;
    let vec = open_vec_db(vec_db)?;
    let source_count: i64 = src
        .query_row("SELECT COUNT(*) FROM asset_relations", [], |r| r.get(0))
        .map_err(|e| format!("kaynak COUNT hatası: {}", e))?;
    let vec_cnt: i64 = vec
        .query_row("SELECT COUNT(*) FROM asset_relations", [], |r| r.get(0))
        .map_err(|e| format!("vec COUNT hatası: {}", e))?;
    let count_match = source_count == vec_cnt;
    let content_hash_match = asset_relations_canonical_hash(&src)?
        == asset_relations_canonical_hash(&vec)?;
    let verified = count_match && content_hash_match;
    Ok(MigrationReport {
        source_count,
        vec_count: vec_cnt,
        count_match,
        content_hash_match,
        blob_sample_ok: true, // ilişki tablosu — blob round-trip uygulanmaz
        verified,
    })
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tauri komut wrapper'ları (Sprint 0 deseni: auth + path resolve +
// spawn_blocking → sync core). Frontend çift-yol + DROP+epoch atomik
// sql.js write'ı Sprint 1'in KALAN ana işidir; bu wrapper'lar onun
// çağıracağı backend yüzeyidir.
// ═══════════════════════════════════════════════════════════════════════════════

/// archive_at → KAYNAK (v2.4.9 sql.js monolit) ana DB path'i.
pub(crate) fn resolve_source_db_path(
    app: &tauri::AppHandle,
    archive_at: Option<&str>,
) -> Result<PathBuf, String> {
    match archive_at {
        Some("local") => crate::ollama_db::resolve_local_db_path(app),
        Some(id) if id != "main" && !id.is_empty() => {
            crate::ollama_db::resolve_archive_path(app, id)
        }
        _ => crate::ollama_db::resolve_db_path(app),
    }
}

/// `embeddings`'i kaynak monolitten vec.db'ye taşı (batch+resume). DROP YOK.
/// Global DB_WRITE_LOCK tutulur — migrasyon süresince diğer yazımlar serileşir
/// (DESIGN-LOCK §7: _migrationInProgress mantığının backend karşılığı).
#[tauri::command]
pub async fn vec_db_migrate_embeddings(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<usize, String> {
    crate::require_authenticated(&role_state)?;
    let src = resolve_source_db_path(&app, archive_at.as_deref())?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&vdb);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        migrate_embeddings(&src, &vdb, 5000)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// §5 üç-katman doğrulama. verified=true → frontend güvenle sql.js'ten
/// DROP + epoch++ yapabilir (salt-okunur; kilit gerekmez).
#[tauri::command]
pub async fn vec_db_verify_embeddings(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<MigrationReport, String> {
    crate::require_authenticated(&role_state)?;
    let src = resolve_source_db_path(&app, archive_at.as_deref())?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || verify_embeddings(&src, &vdb))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// migration_progress oku (resume/UI ilerleme göstergesi).
#[tauri::command]
pub async fn vec_db_progress(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    table: Option<String>,
) -> Result<Option<(i64, i64, bool)>, String> {
    // Varsayılan "embeddings" (epoch-1 geriye-uyumluluğu); whitelist (SQL
    // injection yüzeyi yok ama bilinmeyen tablo erken reddedilsin).
    let t = match table.as_deref().unwrap_or("embeddings") {
        t @ ("embeddings" | "text_chunks" | "asset_relations") => t.to_string(),
        other => return Err(format!("bilinmeyen tablo: {}", other)),
    };
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || progress_get(&vdb, &t))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// vec.db tablo satır sayısı (frontend doğrulama/teşhis paneli için).
#[tauri::command]
pub async fn vec_db_count(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    table: String,
) -> Result<i64, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || vec_count(&vdb, &table))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Frontend çift-yol (epoch>=1) okuma komutu — `getRagCachedEmbeddings`
/// (`ragService.ts:104`) bu komuta yönlenir. PERF NOTU: 1M satırda
/// JSON serialize maliyetli; production cutover'da binary-IPC varyantına
/// geçiş DESIGN-LOCK T10 / strateji kapsamında ertelendi (iskelet doğru
/// ama optimize değil — bilinçli, izlenen teknik borç).
#[tauri::command]
pub async fn vec_db_chunk_embeddings(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    source: Option<String>,
) -> Result<Vec<ChunkEmbedding>, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    let src = source.unwrap_or_else(|| "chunk_text".to_string());
    tauri::async_runtime::spawn_blocking(move || query_chunk_embeddings(&vdb, &src))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5b — embedding sayım istatistiği (epoch>=1 okuma yolu). `getEmbedding
/// Count`/`getEmbeddedAssetCount`/`hasAnyEmbeddings`. Salt-okunur.
#[tauri::command]
pub async fn vec_db_embedding_stats(
    app: tauri::AppHandle,
    archive_at: Option<String>,
) -> Result<EmbeddingStats, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || embedding_stats(&vdb))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5b — asset-seviye embedding'leri source ile servis et (epoch>=1).
/// `prefix=true` → `source LIKE arg%` (`getEmbeddingsBySourcePrefix`);
/// `prefix=false/None` → tam eşleşme (`getAllEmbeddings`). Salt-okunur.
#[tauri::command]
pub async fn vec_db_embeddings_by_source(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    source: String,
    prefix: Option<bool>,
) -> Result<Vec<SourceEmbedding>, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    let pref = prefix.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        query_embeddings_by_source(&vdb, &source, pref)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5b — verilen asset id'leri için chunk embedding'leri servis et
/// (epoch>=1 okuma yolu). `getChunkEmbeddingsByAssetIds`. Salt-okunur.
#[tauri::command]
pub async fn vec_db_chunk_embeddings_by_assets(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    asset_ids: Vec<String>,
    source: Option<String>,
) -> Result<Vec<ChunkEmbedding>, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    let src = source.unwrap_or_else(|| "chunk_text".to_string());
    tauri::async_runtime::spawn_blocking(move || {
        query_chunk_embeddings_by_assets(&vdb, &asset_ids, &src)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5c — verilen chunk id'leri için satırları servis et (epoch>=2 okuma
/// yolu). `getChunksByIds`. Salt-okunur (assets join'i frontend'de).
#[tauri::command]
pub async fn vec_db_chunks_by_ids(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    ids: Vec<String>,
) -> Result<Vec<ChunkRecord>, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || query_chunks_by_ids(&vdb, &ids))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5c — bir asset'in chunk'ları (`chunk_index` sıralı, epoch>=2).
/// `getChunksByAssetId`. `limit` yoksa/<=0 → sınırsız. Salt-okunur.
#[tauri::command]
pub async fn vec_db_chunks_by_asset(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    asset_id: String,
    limit: Option<i64>,
) -> Result<Vec<ChunkRecord>, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    let lim = limit.unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || {
        query_chunks_by_asset(&vdb, &asset_id, lim)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5c — bir asset'in chunk sayısı (epoch>=2). `getChunkCountByAssetId`.
/// Salt-okunur.
#[tauri::command]
pub async fn vec_db_chunk_count(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    asset_id: String,
) -> Result<i64, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || chunk_count_for_asset(&vdb, &asset_id))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5e — asset ilişkilerini servis et (epoch>=3 okuma yolu). `asset_id`
/// verilirse o asset'in ilişkileri, yoksa tümü. Salt-okunur.
#[tauri::command]
pub async fn vec_db_asset_relations(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    asset_id: Option<String>,
) -> Result<Vec<RelationRecord>, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        query_asset_relations(&vdb, asset_id.as_deref())
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5f — `analyzeRagIndex` için asset-başına chunk + chunk-emb sayımları
/// (epoch>=1 okuma yolu). Salt-okunur.
#[tauri::command]
pub async fn vec_db_rag_index_counts(
    app: tauri::AppHandle,
    archive_at: Option<String>,
) -> Result<RagIndexCounts, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || rag_index_counts(&vdb))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5f — `ChatPanel` rozeti + teşhis için chunk sayım özeti
/// (epoch>=2 okuma yolu). Salt-okunur.
#[tauri::command]
pub async fn vec_db_chunk_stats(
    app: tauri::AppHandle,
    archive_at: Option<String>,
) -> Result<ChunkStats, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || chunk_stats(&vdb))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-6b — body-only (`chunk_index >= 0`) chunk sayımları
/// (`purgeNonIndexableChunks` epoch>=2 okuma yolu). Salt-okunur.
#[tauri::command]
pub async fn vec_db_body_chunk_counts(
    app: tauri::AppHandle,
    archive_at: Option<String>,
) -> Result<RagIndexCounts, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || body_chunk_counts(&vdb))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-6c — metadata chunk'ı olan asset id'leri (`ChatPanel` B2 auto-sync
/// epoch>=2 okuma yolu). Salt-okunur.
#[tauri::command]
pub async fn vec_db_metadata_chunk_asset_ids(
    app: tauri::AppHandle,
    archive_at: Option<String>,
) -> Result<Vec<String>, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || metadata_chunk_asset_ids(&vdb))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-6c — bir asset'in metadata chunk'larını vec.db'den sil
/// (`indexAssetMetadata` re-index, epoch>=2). DB_WRITE_LOCK altında.
#[tauri::command]
pub async fn vec_db_delete_metadata_chunks(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    asset_id: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<usize, String> {
    crate::require_authenticated(&role_state)?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&vdb);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        delete_metadata_chunks(&vdb, &asset_id)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-6d — klasör-sil undo snapshot'ı: verilen asset'lerin vec.db'deki
/// embeddings/text_chunks/asset_relations satırlarını dışa-aktar. Salt-okunur.
#[tauri::command]
pub async fn vec_db_export_assets(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    asset_ids: Vec<String>,
) -> Result<AssetVecExport, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || export_assets(&vdb, &asset_ids))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-6d — klasör-sil undo restore: snapshot'taki V3-eligible satırları
/// vec.db'ye geri-yaz (idempotent `apply_*`). DB_WRITE_LOCK altında.
#[tauri::command]
pub async fn vec_db_import_assets(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    data: AssetVecExport,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_authenticated(&role_state)?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&vdb);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        import_assets(&vdb, &data)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// Asset DELETE cascade — sql.js asset silme yolundan çağrılır (DESIGN-LOCK
/// §7/T9). Global DB_WRITE_LOCK altında (yazma serileştirme).
#[tauri::command]
pub async fn vec_db_cascade_delete(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    asset_ids: Vec<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<CascadeDeleteReport, String> {
    crate::require_authenticated(&role_state)?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&vdb);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        delete_assets(&vdb, &asset_ids)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// EPOCH 2 — `text_chunks`'i kaynak monolitten vec.db'ye taşı (batch+resume).
/// DROP YOK (frontend sorumluluğu). DB_WRITE_LOCK altında.
#[tauri::command]
pub async fn vec_db_migrate_text_chunks(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<usize, String> {
    crate::require_authenticated(&role_state)?;
    let src = resolve_source_db_path(&app, archive_at.as_deref())?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&vdb);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        migrate_text_chunks(&src, &vdb, 5000)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// EPOCH 2 — §5 doğrulama (COUNT + içerik-hash). verified=true → frontend
/// güvenle DROP + epoch=2 yapabilir (salt-okunur).
#[tauri::command]
pub async fn vec_db_verify_text_chunks(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<MigrationReport, String> {
    crate::require_authenticated(&role_state)?;
    let src = resolve_source_db_path(&app, archive_at.as_deref())?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || verify_text_chunks(&src, &vdb))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// PRE-5a — Frontend çift-yol (epoch>=2) keyword araması. `ftsSearchChunks`
/// (`database.ts:4457`) bu komuta yönlenir. Salt-okunur → kilit gerekmez.
/// Skor frontend'de dönüş dizin sırasından üretilir (satırlar bm25 sıralı).
#[tauri::command]
pub async fn vec_db_fts_search(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<FtsHit>, String> {
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    let lim = limit.unwrap_or(300);
    tauri::async_runtime::spawn_blocking(move || fts_search_chunks(&vdb, &query, lim))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// EPOCH 3 — `asset_relations`'i kaynak monolitten vec.db'ye taşı
/// (batch+resume). DROP YOK. DB_WRITE_LOCK altında.
#[tauri::command]
pub async fn vec_db_migrate_asset_relations(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<usize, String> {
    crate::require_authenticated(&role_state)?;
    let src = resolve_source_db_path(&app, archive_at.as_deref())?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&vdb);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        migrate_asset_relations(&src, &vdb, 5000)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// EPOCH 3 — §5 doğrulama (COUNT + içerik-hash). verified=true → frontend
/// güvenle DROP + epoch=3 yapabilir (salt-okunur).
#[tauri::command]
pub async fn vec_db_verify_asset_relations(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<MigrationReport, String> {
    crate::require_authenticated(&role_state)?;
    let src = resolve_source_db_path(&app, archive_at.as_deref())?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || verify_asset_relations(&src, &vdb))
        .await
        .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

// ═══════════════════════════════════════════════════════════════════════════════
// Sentetik dataset üreteci + testler (SPRINT1-PREP-KIT §A)
// ═══════════════════════════════════════════════════════════════════════════════

// DESIGN-LOCK §6/§7 backend güvenlik ağı (rollback + orphan-temizlik).
// Ayrı dosya: mod.rs şişirilmez (kullanıcı direktifi).
pub mod safety;

#[cfg(test)]
pub(crate) mod fixtures;
#[cfg(test)]
mod tests;
