//! Oto-indeks kuyrugu — stage tanimi + skip (kalici-basarisiz) izleri (P1).
//!
//! Tasarim (docs/STATUS.md P1): tarama sonrasi AI indekslemeyi (metin/gorsel embedding ·
//! RAG chunk · vision) OTOMATIK ve app-restart'a dayanikli suren kuyruk. **"Kalan is" bu
//! modulde DEGIL** — o, urun tablolarindan turer (`pending_embed_count`/`pending_chunk_count`/
//! `pending_image_embed_count`/`pending_analysis_count`, hepsi `NOT EXISTS(cikti tablosu)`) →
//! tek dogruluk kaynagi. Bu modul yalniz verinin ifade edemedigi durumu tutar:
//! **"bu adim denendi ve KALICI basarisiz"** (aksi halde oto-surucu indekslenemez dosyayi
//! sonsuza dek yeniden dener; bekleyen-sayisi 0'a inmez). H2 `rag_status='skipped'` fikri,
//! per-stage genellestirilmis (bkz migration 0014).

use rusqlite::params;

use crate::error::DbError;
use crate::Db;

/// Oto-indeks adimi. `as_str()`, DB'de `index_skips.stage` ve bekleyen-sorgu filtreleri icin
/// TEK dogruluk kaynagi (SQL'e elle string yazilmaz → tipografi hatasi imkansiz).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IndexStage {
    /// Metin (MiniLM 384-boyut) embedding — `asset_vectors`.
    Text,
    /// Gorsel (CLIP 512-boyut) cok-bolge embedding — `asset_image_region_vectors` (thumbnail gerekir).
    Image,
    /// RAG metin parcalama (chunk) — `text_chunks`.
    Chunk,
    /// AI vision betim (Ollama) — `asset_metadata` `ai_analyzed` (thumbnail gerekir).
    Vision,
}

impl IndexStage {
    /// Tum adimlar (sayim/temizleme dongusu icin kume). **Orkestrasyon sirasi DEGIL** — kosum
    /// sirasi surucude tanimli (vision → chunk bagimliligi orada).
    pub const ALL: [IndexStage; 4] = [
        IndexStage::Text,
        IndexStage::Image,
        IndexStage::Chunk,
        IndexStage::Vision,
    ];

    /// DB'de saklanan stabil string (semada ve bekleyen-sorgu filtresinde de bu gecer).
    pub fn as_str(self) -> &'static str {
        match self {
            IndexStage::Text => "text",
            IndexStage::Image => "image",
            IndexStage::Chunk => "chunk",
            IndexStage::Vision => "vision",
        }
    }
}

impl Db {
    /// Bir asset'in bir adiminin **kalici basarisiz** oldugunu isaretle (upsert; ayni
    /// (asset,stage) tekrar → neden+zaman guncellenir, satir cogalmaz). Sonuc: o asset o adimin
    /// bekleyen sorgusundan dislanir → oto-surucu terminlenebilir (bekleyen 0'a iner). Kullanici
    /// `clear_index_skips` ("yeniden dene") ile geri alir.
    pub fn record_index_skip(
        &self,
        asset_id: i64,
        stage: IndexStage,
        reason: &str,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO index_skips(asset_id, stage, reason, created_at)
             VALUES (?1, ?2, ?3, strftime('%s','now'))
             ON CONFLICT(asset_id, stage)
               DO UPDATE SET reason = excluded.reason, created_at = excluded.created_at",
            params![asset_id, stage.as_str(), reason],
        )?;
        Ok(())
    }

    /// Bir asset'in bir adimindaki skip izini kaldir. Surucu, o adim yeniden BASARILI olunca
    /// cagirir → "atlandi" ve "basarili" kumeleri ayrik kalir (bayat skip birikmez). Iz yoksa no-op.
    pub fn clear_index_skip(&self, asset_id: i64, stage: IndexStage) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM index_skips WHERE asset_id = ?1 AND stage = ?2",
            params![asset_id, stage.as_str()],
        )?;
        Ok(())
    }

    /// Skip izlerini toplu temizle ("yeniden dene" — H2 `clearRagSkip` pariti). `stage=None` →
    /// tum adimlar; `Some(s)` → yalniz o adim. Silinen satir sayisini doner (kac asset yeniden
    /// bekleyen oldu → UI geri bildirimi).
    pub fn clear_index_skips(&self, stage: Option<IndexStage>) -> Result<usize, DbError> {
        let n = match stage {
            Some(s) => self.conn.execute(
                "DELETE FROM index_skips WHERE stage = ?1",
                params![s.as_str()],
            )?,
            None => self.conn.execute("DELETE FROM index_skips", [])?,
        };
        Ok(n)
    }

    /// Skip'lenmis (kalici-basarisiz) iz sayisi — durum/rapor gorunurlugu. `stage=None` → tum
    /// adimlar; `Some(s)` → yalniz o adim.
    pub fn index_skip_count(&self, stage: Option<IndexStage>) -> Result<i64, DbError> {
        let n = match stage {
            Some(s) => self.conn.query_row(
                "SELECT count(*) FROM index_skips WHERE stage = ?1",
                params![s.as_str()],
                |r| r.get(0),
            )?,
            None => self
                .conn
                .query_row("SELECT count(*) FROM index_skips", [], |r| r.get(0))?,
        };
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_db() -> Db {
        Db::open_in_memory_migrated().unwrap()
    }

    fn seed_asset(db: &Db, id: i64, name: &str) {
        db.connection()
            .execute(
                "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
                 VALUES (?1, ?2, ?3, 'txt', 10, 1, 1)",
                params![id, format!("/a/{name}"), name],
            )
            .unwrap();
    }

    fn seed_thumbnail(db: &Db, id: i64) {
        db.connection()
            .execute(
                "INSERT INTO asset_thumbnails(asset_id, mime, width, height, bytes)
                 VALUES (?1, 'image/jpeg', 4, 4, ?2)",
                params![id, vec![0u8, 1, 2, 3]],
            )
            .unwrap();
    }

    #[test]
    fn migration_creates_index_skips_at_v14() {
        let db = make_db();
        assert!(db.schema_version().unwrap() >= 14, "0014 uygulanmali");
        // Tablo var + bos.
        assert_eq!(db.index_skip_count(None).unwrap(), 0);
    }

    #[test]
    fn record_count_clear_roundtrip() {
        let db = make_db();
        seed_asset(&db, 1, "a.txt");
        seed_asset(&db, 2, "b.txt");

        db.record_index_skip(1, IndexStage::Text, "boom").unwrap();
        db.record_index_skip(2, IndexStage::Chunk, "nope").unwrap();
        assert_eq!(db.index_skip_count(None).unwrap(), 2);
        assert_eq!(db.index_skip_count(Some(IndexStage::Text)).unwrap(), 1);
        assert_eq!(db.index_skip_count(Some(IndexStage::Vision)).unwrap(), 0);

        // Upsert: ayni (asset,stage) tekrar → satir sayisi ARTMAZ (neden guncellenir).
        db.record_index_skip(1, IndexStage::Text, "boom-again").unwrap();
        assert_eq!(db.index_skip_count(Some(IndexStage::Text)).unwrap(), 1);

        // Stage-bazli temizleme yalniz o adimi kaldirir.
        let removed = db.clear_index_skips(Some(IndexStage::Text)).unwrap();
        assert_eq!(removed, 1);
        assert_eq!(db.index_skip_count(Some(IndexStage::Text)).unwrap(), 0);
        assert_eq!(db.index_skip_count(Some(IndexStage::Chunk)).unwrap(), 1);

        // Tumunu temizle.
        db.record_index_skip(1, IndexStage::Text, "x").unwrap();
        let removed_all = db.clear_index_skips(None).unwrap();
        assert_eq!(removed_all, 2);
        assert_eq!(db.index_skip_count(None).unwrap(), 0);
    }

    #[test]
    fn single_clear_removes_only_that_pair() {
        let db = make_db();
        seed_asset(&db, 1, "a.txt");
        db.record_index_skip(1, IndexStage::Text, "e").unwrap();
        db.record_index_skip(1, IndexStage::Chunk, "e").unwrap();
        db.clear_index_skip(1, IndexStage::Text).unwrap();
        assert_eq!(db.index_skip_count(Some(IndexStage::Text)).unwrap(), 0);
        assert_eq!(db.index_skip_count(Some(IndexStage::Chunk)).unwrap(), 1);
    }

    #[test]
    fn skip_excludes_from_pending_text_and_chunk() {
        let db = make_db();
        seed_asset(&db, 1, "a.txt");
        seed_asset(&db, 2, "b.txt");
        assert_eq!(db.pending_embed_count().unwrap(), 2);
        assert_eq!(db.pending_chunk_count().unwrap(), 2);

        // Asset 1'i TEXT icin skip'le → embed bekleyen 1'e duser, chunk DEGISMEZ (stage-ozel).
        db.record_index_skip(1, IndexStage::Text, "fail").unwrap();
        assert_eq!(db.pending_embed_count().unwrap(), 1);
        assert_eq!(db.pending_chunk_count().unwrap(), 2);
        // Batch getirici de asset 1'i atlar.
        let pend = db.assets_without_vectors(0, 10).unwrap();
        assert!(pend.iter().all(|p| p.id != 1), "skip'li asset batch'e gelmemeli");
        assert_eq!(pend.len(), 1);

        // Yeniden dene → tekrar bekleyen.
        db.clear_index_skips(Some(IndexStage::Text)).unwrap();
        assert_eq!(db.pending_embed_count().unwrap(), 2);
    }

    #[test]
    fn skip_excludes_from_pending_image_and_vision() {
        let db = make_db();
        seed_asset(&db, 1, "a.png");
        seed_asset(&db, 2, "b.png");
        seed_thumbnail(&db, 1);
        seed_thumbnail(&db, 2);
        assert_eq!(db.pending_image_embed_count().unwrap(), 2);
        assert_eq!(db.pending_analysis_count().unwrap(), 2);

        db.record_index_skip(1, IndexStage::Image, "decode").unwrap();
        db.record_index_skip(2, IndexStage::Vision, "ollama").unwrap();
        assert_eq!(db.pending_image_embed_count().unwrap(), 1);
        assert_eq!(db.pending_analysis_count().unwrap(), 1);
        assert!(db
            .assets_without_image_vectors(0, 10)
            .unwrap()
            .iter()
            .all(|p| p.id != 1));
        assert!(db
            .assets_without_analysis(0, 10)
            .unwrap()
            .iter()
            .all(|p| p.id != 2));
    }

    #[test]
    fn cascade_delete_cleans_skip() {
        let db = make_db();
        seed_asset(&db, 1, "a.txt");
        db.record_index_skip(1, IndexStage::Text, "e").unwrap();
        assert_eq!(db.index_skip_count(None).unwrap(), 1);
        // Asset hard-delete → FK CASCADE skip izini de kaldirir.
        db.connection()
            .execute("DELETE FROM assets WHERE id = 1", [])
            .unwrap();
        assert_eq!(
            db.index_skip_count(None).unwrap(),
            0,
            "CASCADE skip'i temizlemeli"
        );
    }
}
