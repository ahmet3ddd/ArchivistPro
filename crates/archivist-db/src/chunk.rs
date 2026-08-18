//! RAG metin parcalama (chunk) veri katmani — Faz: RAG sohbet (H2 textChunker/ragService pariti).
//!
//! Bu modul: parcalama (`chunk_text`, saf) · bekleyenleri listele · asset'in parcalarini
//! (govde + metadata) yaz/sil · sayim. **Embedding URETIMI bu katmanda DEGIL** (semantic.rs
//! ilkesi: archivist-db ONNX'ten bagimsiz) → ust katman (src-tauri) metni embedler, burada
//! `set_asset_chunks` ile vektoruyle birlikte yazilir.
//!
//! Tablolar (migration 0011): `text_chunks` (metin+kaynak) · `chunk_vectors` vec0 (384) ·
//! `chunk_fts` (keyword-gate). chunk_vectors/chunk_fts FK/trigger YOK → set/purge ELLE yonetir.

use rusqlite::{params, OptionalExtension};

use crate::error::DbError;
use crate::index_skips::IndexStage;
use crate::semantic::{vec_to_blob, TEXT_EMBED_DIM};
use crate::Db;

/// METADATA chunk'inin chunk_index'i — govde parcalarindan (0,1,2...) ayirir. Metni olmayan
/// asset'ler (DWG/MAX/gorsel) bile dosya-adi/proje/etiket/katman ozeti olarak aranabilir.
pub const META_CHUNK_INDEX: i64 = -1;

/// Parcalama kurallarinin GUNCEL surumu (`text_chunks.rules_version`, migration 0033).
///
/// - `1` = eski, KELIME-bazli (500 kelime / 50 ortusme).
/// - `2` = TOKEN-bazli (`archivist_embed::CHUNK_TOKENS` = 220 / 40 ortusme) — 2026-08-18.
///
/// Bu sayi arttiginda mevcut TUM parcalar kendiliginden "bekliyor" sayilir
/// (`assets_without_chunks`) ve normal indeksleme akisi onlari yeniden uretir.
/// ⚠️ Parcalama davranisi degistiginde BURAYI da artir; yoksa duzeltme mevcut
/// arsivlere hic ulasmaz ve UI "her sey indekslendi" demeye devam eder.
pub const CHUNK_RULES_VERSION: i64 = 2;

/// Varsayilan parca boyutu (kelime) — H2 pariti.
///
/// ⚠️ **URETIM YOLU ARTIK BUNU KULLANMIYOR** (2026-08-18). Eski yorum *"MiniLM 512-token
/// penceresine kendisi kirpar → kelime-bazli yaklasik boyut yeterli"* diyordu; ikisi de
/// yanlisti: gercek kirpma **256** token'da oluyordu ve Turkce cikarilmis metinde oran
/// **3,29 token/kelime** olculdu → 500 kelimelik parcanin ancak ~%34'u vektore giriyordu.
/// Kelime sayisi token butcesini garanti edemez (oran 2,7–13,3 arasi degisiyor).
/// Uretimde `archivist_embed::TextEmbedder::chunk_by_tokens` kullanilir (token butcesi).
/// Bu sabitler saf/testli kelime-bazli bolme icin durur (tokenizer'i olmayan cagiranlar).
pub const DEFAULT_CHUNK_WORDS: usize = 500;
/// Varsayilan komsu-parca ortusmesi (kelime) — baglam sinirinda kesilen cumleyi korur.
pub const DEFAULT_OVERLAP_WORDS: usize = 50;

/// Bir asset'in yazilacak tek parcasi (ust katman embedding'i uretip verir).
#[derive(Debug, Clone)]
pub struct ChunkWrite {
    pub chunk_index: i64,
    pub page: Option<i64>,
    pub text: String,
    /// 384-boyut MiniLM vektoru (TEXT_EMBED_DIM).
    pub embedding: Vec<f32>,
}

/// Bir asset'in TEK parcasi — gosterim icin (detay paneli "Parçalar" sekmesi). Vektor/FTS
/// dahil DEGIL (yalniz metin + kaynak). `chunk_index == META_CHUNK_INDEX` → metadata chunk.
#[derive(Debug, Clone, PartialEq)]
pub struct AssetChunk {
    pub chunk_id: i64,
    pub chunk_index: i64,
    pub page: Option<i64>,
    pub text: String,
}

/// Parcalanmayi bekleyen bir asset: id + uzanti + govde metni (assets_fts.body). Ust katman
/// bunu kullanarak (govde parcalari + metadata chunk) uretir ve `set_asset_chunks` ile yazar.
#[derive(Debug, Clone)]
pub struct PendingChunk {
    pub id: i64,
    pub file_name: String,
    pub ext: Option<String>,
    pub title: Option<String>,
    /// assets_fts.body — tam cikarilan metin (bos olabilir → yalniz metadata chunk).
    pub body: String,
}

/// Bir metni ~`chunk_words` kelimelik, `overlap` kelimelik ortusmeli parcalara boler (H2
/// `chunkText` pariti). Sus/ayrac karakterleri (kutu-cizim, replacement char) bosluga indirir
/// (DOCX/PDF tablo/imza gurultusu → anlamsiz chunk olusturmasin). Bos/tek-parca: en fazla 1
/// eleman. Saf fonksiyon (test edilebilir).
pub fn chunk_text(text: &str, chunk_words: usize, overlap: usize) -> Vec<String> {
    let chunk_words = chunk_words.max(1);
    let normalized = normalize_for_chunking(text);
    if normalized.is_empty() {
        return Vec::new();
    }
    let words: Vec<&str> = normalized.split(' ').collect();
    if words.len() <= chunk_words {
        return vec![normalized];
    }

    let step = chunk_words.saturating_sub(overlap).max(1);
    let mut chunks = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let end = (i + chunk_words).min(words.len());
        chunks.push(words[i..end].join(" "));
        if end >= words.len() {
            break;
        }
        i += step;
    }
    chunks
}

/// Parcalama oncesi metin normalizasyonu (saf) — `chunk_text` ve **token-bazli** parcalama
/// (`archivist_embed::TextEmbedder::chunk_by_tokens`) AYNI girdiyi gorsun diye ayri fonksiyon.
///
/// Sus/ayrac bloklari (>=2 ardisik) bosluga iner: Unicode kutu-cizim/geometrik/dingbat
/// araliklari ile replacement char (U+FFFD). Ardindan bosluklar tek bosluga inip kirpilir.
/// Amac: DOCX/PDF tablo/imza gurultusunun anlamsiz chunk uretmesini onlemek.
pub fn normalize_for_chunking(text: &str) -> String {
    let cleaned: String = {
        let mut out = String::with_capacity(text.len());
        let mut run: Vec<char> = Vec::new();
        // Kutu-cizim + blok + geometrik sekil + cesitli sembol araliklari (bitisik → tek aralik).
        // H2 regex [─-╿▀-▟■-◿☀-⛿ + tek glifler] paritesi;
        // listelenen tek glifler (■□●○◆▬─═▓...) zaten bu aralikta → ayri arm gereksiz.
        let is_deco = |c: char| -> bool { matches!(c as u32, 0x2500..=0x26FF) };
        let flush = |run: &mut Vec<char>, out: &mut String| {
            if run.len() >= 2 {
                out.push(' '); // >=2 ardisik dekoratif → tek bosluk
            } else {
                for &c in run.iter() {
                    out.push(c);
                }
            }
            run.clear();
        };
        for c in text.chars() {
            if c == '\u{FFFD}' {
                flush(&mut run, &mut out);
                out.push(' ');
            } else if is_deco(c) {
                run.push(c);
            } else {
                flush(&mut run, &mut out);
                out.push(c);
            }
        }
        flush(&mut run, &mut out);
        out
    };

    // Bosluklari tek bosluga indir + kirp.
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

impl Db {
    /// Parcalanmayi bekleyen (hic chunk'i olmayan, cope atilmamis) asset sayisi. UI ilerleme +
    /// "RAG indeksleme gerekli mi" karari. (assets_without_vectors deseni; chunk-bazli.)
    pub fn pending_chunk_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM assets a
             WHERE a.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM text_chunks c
                               WHERE c.asset_id = a.id AND c.rules_version >= ?2)
               AND NOT EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = ?1)",
            params![IndexStage::Chunk.as_str(), CHUNK_RULES_VERSION],
            |r| r.get(0),
        )?)
    }

    /// Indekslenmis asset sayisi — **guncel kuralla** en az bir chunk'i olanlar.
    /// Bayat kuralli (eski `rules_version`) parcalar indekslenmis SAYILMAZ; aksi halde UI
    /// "hepsi indekslendi" der ve duzeltmenin ulasmadigi gorulmezdi (migration 0033).
    pub fn chunked_asset_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(DISTINCT asset_id) FROM text_chunks WHERE rules_version >= ?1",
            params![CHUNK_RULES_VERSION],
            |r| r.get(0),
        )?)
    }

    /// Bayat kuralla uretilmis parca sayisi (yeniden uretilmeyi bekleyenler). UI'da
    /// "parcalar guncel kuralla yeniden kuruluyor" bilgisini gostermek icin.
    pub fn stale_chunk_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM text_chunks WHERE rules_version < ?1",
            params![CHUNK_RULES_VERSION],
            |r| r.get(0),
        )?)
    }

    /// Toplam chunk sayisi (govde + metadata).
    pub fn chunk_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row("SELECT count(*) FROM text_chunks", [], |r| r.get(0))?)
    }

    /// Bir asset'in TUM parcalari (govde + metadata), gosterim icin (detay "Parçalar" sekmesi).
    /// Sira: **once metadata** (-1, -2, -3... dogal okuma sirasi), sonra govde (0, 1, 2...).
    /// Metadata birden cok parca olabilir (uzun DWG katman listeleri token butcesine bolunur),
    /// bu yuzden duz `ORDER BY chunk_index` yetmez — negatifleri ters cevirirdi.
    /// Salt-okuma; vektor/FTS dondurulmez. Cope/aktiflik filtresi YOK (detay zaten asset'i acti).
    pub fn chunks_for_asset(&self, asset_id: i64) -> Result<Vec<AssetChunk>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, chunk_index, page, text FROM text_chunks
             WHERE asset_id = ?1
             ORDER BY (chunk_index >= 0),
                      CASE WHEN chunk_index < 0 THEN -chunk_index ELSE chunk_index END,
                      id",
        )?;
        let rows = stmt.query_map(params![asset_id], |r| {
            Ok(AssetChunk {
                chunk_id: r.get(0)?,
                chunk_index: r.get(1)?,
                page: r.get(2)?,
                text: r.get(3)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    /// Chunk'i olmayan, `after_id`'den buyuk id'li ilk `limit` asset'i (govde metniyle) getir
    /// (resumable batch; cursor → basarisiz asset sonsuz donguye sokmaz — assets_without_vectors
    /// deseni). Cope atilmis HARIC.
    pub fn assets_without_chunks(
        &self,
        after_id: i64,
        limit: i64,
    ) -> Result<Vec<PendingChunk>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.file_name, a.ext, a.title, COALESCE(fts.body, '')
             FROM assets a
             LEFT JOIN assets_fts fts ON fts.asset_id = a.id
             WHERE a.deleted_at IS NULL
               AND a.id > ?1
               AND NOT EXISTS (SELECT 1 FROM text_chunks c
                               WHERE c.asset_id = a.id AND c.rules_version >= ?4)
               AND NOT EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = ?2)
             ORDER BY a.id
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(
            params![after_id, IndexStage::Chunk.as_str(), limit, CHUNK_RULES_VERSION],
            |r| {
                Ok(PendingChunk {
                    id: r.get(0)?,
                    file_name: r.get(1)?,
                    ext: r.get(2)?,
                    title: r.get(3)?,
                    body: r.get(4)?,
                })
            },
        )?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    /// Tek bir asset'i (id) `PendingChunk` olarak getir — re-chunk icin. `assets_without_chunks`
    /// ile ayni alanlar ama "chunk'i yok" kosulu YOK (zorla yeniden chunk'lar). Gorsel-analiz
    /// job'u `ai_*` metadata yazdiktan SONRA bu asset'i yeniden chunk'lamak icin kullanir → AI
    /// betimleri metadata chunk'ina girer. Cope/yok → None.
    pub fn pending_chunk_for(&self, asset_id: i64) -> Result<Option<PendingChunk>, DbError> {
        self.conn
            .query_row(
                "SELECT a.id, a.file_name, a.ext, a.title, COALESCE(fts.body, '')
                 FROM assets a
                 LEFT JOIN assets_fts fts ON fts.asset_id = a.id
                 WHERE a.id = ?1 AND a.deleted_at IS NULL",
                params![asset_id],
                |r| {
                    Ok(PendingChunk {
                        id: r.get(0)?,
                        file_name: r.get(1)?,
                        ext: r.get(2)?,
                        title: r.get(3)?,
                        body: r.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    /// Bir asset'in TUM parcalarini (govde + metadata) yaz — eskileri ONCE siler (re-index).
    /// Tek TX (atomik): text_chunks + chunk_vectors (384 dogrulanir) + chunk_fts birlikte.
    /// chunk_vectors/chunk_fts FK/trigger YOK → text_chunks silinmeden ONCE chunk_id ile elle
    /// silinir (yetim onleme). Bos dilim → yalniz temizlik (asset'in chunk'larini kaldirir).
    pub fn set_asset_chunks(&self, asset_id: i64, chunks: &[ChunkWrite]) -> Result<(), DbError> {
        for c in chunks {
            if c.embedding.len() != TEXT_EMBED_DIM {
                return Err(DbError::Invalid(format!(
                    "chunk vektor boyutu {} != {TEXT_EMBED_DIM}",
                    c.embedding.len()
                )));
            }
        }
        let tx = self.conn.unchecked_transaction()?;
        // Eski parcalari temizle: once chunk_vectors + chunk_fts (chunk_id ile), sonra text_chunks.
        tx.execute(
            "DELETE FROM chunk_vectors WHERE chunk_id IN (SELECT id FROM text_chunks WHERE asset_id = ?1)",
            params![asset_id],
        )?;
        tx.execute(
            "DELETE FROM chunk_fts WHERE asset_id = ?1",
            params![asset_id],
        )?;
        tx.execute("DELETE FROM text_chunks WHERE asset_id = ?1", params![asset_id])?;

        for c in chunks {
            tx.execute(
                // rules_version: bu parcayi ureten parcalama kuralinin surumu (migration 0033).
                // Bekleyen-is sorgusu buna bakar → kurallar degisince yeniden uretim kendiliginden
                // tetiklenir ve UI "indekslendi" demeyi birakir.
                "INSERT INTO text_chunks(asset_id, chunk_index, page, text, rules_version)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![asset_id, c.chunk_index, c.page, c.text, CHUNK_RULES_VERSION],
            )?;
            let chunk_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO chunk_vectors(chunk_id, embedding) VALUES (?1, ?2)",
                params![chunk_id, vec_to_blob(&c.embedding)],
            )?;
            tx.execute(
                "INSERT INTO chunk_fts(chunk_id, asset_id, text) VALUES (?1, ?2, ?3)",
                params![chunk_id, asset_id, c.text],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_text_short_returns_single() {
        let out = chunk_text("kisa bir metin", DEFAULT_CHUNK_WORDS, DEFAULT_OVERLAP_WORDS);
        assert_eq!(out, vec!["kisa bir metin".to_string()]);
    }

    #[test]
    fn chunk_text_empty_or_decorative_only() {
        assert!(chunk_text("", 500, 50).is_empty());
        assert!(chunk_text("   \n\t  ", 500, 50).is_empty());
        // Yalniz dekoratif (>=2 ardisik) → bosluga iner → bos.
        assert!(chunk_text("─────  ═══", 500, 50).is_empty());
    }

    #[test]
    fn chunk_text_splits_with_overlap() {
        // 10 kelime, chunk=4, overlap=1 → step=3 → 0..4, 3..7, 6..10, 9..10? son sinir.
        let words: Vec<String> = (1..=10).map(|n| format!("w{n}")).collect();
        let text = words.join(" ");
        let out = chunk_text(&text, 4, 1);
        assert_eq!(out[0], "w1 w2 w3 w4");
        assert_eq!(out[1], "w4 w5 w6 w7", "ortusme: her parca oncekinin son kelimesiyle baslar");
        // Son parca son kelimeyi icermeli; ardisik parcalar 1 kelime ortusur.
        assert!(out.last().unwrap().contains("w10"), "son kelime kapsanmali");
        assert!(out.len() >= 3);
    }

    #[test]
    fn chunk_text_cleans_decorative_runs() {
        let out = chunk_text("baslik ▬▬▬▬ icerik", 500, 50);
        assert_eq!(out, vec!["baslik icerik".to_string()], "dekoratif blok bosluga inmeli");
    }
}
