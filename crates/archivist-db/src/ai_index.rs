//! Yerel AI indeks bakimi — yeniden uretilebilir indeksleri topluca sifirla.
//!
//! Kapsam kasitli olarak dardir: metin embeddingleri, CLIP gorsel embeddingleri ve RAG
//! parcalari silinir; kaynak asset, metadata, thumbnail, ana FTS ve istege bagli vision
//! analizleri korunur. Sonuc tablolarindaki "atlandi" izleri de temizlenir ki oto-indeks
//! yeniden uretimi baslatabilsin.

use crate::error::DbError;
use crate::Db;

/// Yerel AI indeks sifirlamasinin silinen turetilmis kayit sayilari.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct AiIndexResetReport {
    pub text_vectors: i64,
    pub image_vectors: i64,
    pub chunks: i64,
    pub skipped: i64,
}

impl Db {
    /// Uc yerel AI indeksini atomik olarak temizle.
    ///
    /// `asset_vectors` (semantik), `asset_image_region_vectors` (CLIP) ve RAG'in
    /// `text_chunks`/`chunk_vectors`/`chunk_fts` ciktisi silinir. `index_skips` yalniz
    /// text/image/chunk asamalari icin temizlenir; vision sonucu ve vision skip kayitlari
    /// kullanici tarafindan pahali/istege-bagli oldugu icin korunur.
    pub fn reset_local_ai_indexes(&self) -> Result<AiIndexResetReport, DbError> {
        let tx = self.conn.unchecked_transaction()?;
        let report = AiIndexResetReport {
            text_vectors: tx.query_row("SELECT count(*) FROM asset_vectors", [], |r| r.get(0))?,
            image_vectors: tx.query_row(
                "SELECT count(*) FROM asset_image_region_vectors",
                [],
                |r| r.get(0),
            )?,
            chunks: tx.query_row("SELECT count(*) FROM text_chunks", [], |r| r.get(0))?,
            skipped: tx.query_row(
                "SELECT count(*) FROM index_skips WHERE stage IN ('text', 'image', 'chunk')",
                [],
                |r| r.get(0),
            )?,
        };

        // vec0/FTS sanal tablolarinda FK/CASCADE yoktur; once bagli indeks satirlarini,
        // sonra chunk kaynak satirlarini sil. Tum adimlar tek transaction'da.
        tx.execute("DELETE FROM asset_vectors", [])?;
        tx.execute("DELETE FROM asset_image_region_vectors", [])?;
        tx.execute("DELETE FROM chunk_vectors", [])?;
        tx.execute("DELETE FROM chunk_fts", [])?;
        tx.execute("DELETE FROM text_chunks", [])?;
        tx.execute(
            "DELETE FROM index_skips WHERE stage IN ('text', 'image', 'chunk')",
            [],
        )?;
        tx.commit()?;
        Ok(report)
    }
}
