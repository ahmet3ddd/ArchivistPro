//! §O Cop kutusu (trash) — geri-alinabilir silme (soft-delete) + geri-yukleme +
//! kalici silme (purge). H2 pariti: TrashModal.
//!
//! Tasarim (migration 0007): `assets.deleted_at` (NULL = aktif, unix-saniye = cop'te).
//! - **soft_delete:** `deleted_at = now` → asset TUM aktif gorunumlerden gizlenir
//!   (FILTER_FRAG + facet'ler + dashboard + asset_count `deleted_at IS NULL` filtreler).
//!   Geri-alinabilir; iliskili veri (etiket/favori/koleksiyon/thumbnail/vektor) DURUR.
//! - **restore:** `deleted_at = NULL` → asset yeniden aktif.
//! - **purge:** gercek `DELETE FROM assets` → FK CASCADE (asset_tags/asset_metadata/
//!   favorites/collection_items/asset_thumbnails/relations) + FTS silme-trigger'i
//!   (assets_fts) iliskili satirlari temizler. `asset_vectors` (vec0 sanal tablo) FK/
//!   trigger ile KORUNMAZ → ayni TX icinde elle silinir (yetim vektor dogmaz).
//!
//! Guvenli IN-cumlesi: `params_from_iter` (her id ayri parametre) → SQL-injection yok.
//! Cok-satirli yazmalar tek TX (atomik). Tum metotlar `&[i64]` alir; bos dilim → 0.

use rusqlite::params_from_iter;

use crate::error::DbError;
use crate::query::{AssetRow, COLS};
use crate::Db;

/// Verilen sayida `?,?,...` yer-tutucu dizgesi uret (her id ayri parametre; SQL-injection
/// yok). Cagiran bos dilimde erken doner (bos IN() SQL hatasidir). `get_thumbnails` ile
/// ayni desen (MSRV 1.77 uyumlu — `repeat_n` 1.82 gerektirir, kullanilmaz).
fn placeholders(n: usize) -> String {
    (0..n).map(|_| "?").collect::<Vec<_>>().join(",")
}

impl Db {
    /// **Soft-delete:** verilen asset'leri cop kutusuna at (`deleted_at = unix now`).
    /// Yalniz su an AKTIF olanlar (`deleted_at IS NULL`) etkilenir → tekrar cagri
    /// idempotent (zaten cop'te olanin damgasi degismez). Etkilenen satir sayisi doner.
    ///
    /// Iliskili veri (etiket/favori/koleksiyon-uyeligi/thumbnail/vektor) korunur →
    /// restore tam geri-yukler. Tek TX (atomik). Bos dilim → 0 (no-op).
    pub fn soft_delete(&mut self, ids: &[i64]) -> Result<usize, DbError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let tx = self.conn.transaction()?;
        // now SQL tarafinda → cagiran saat sizmaz; yalniz aktif olanlar damgalanir.
        let sql = format!(
            "UPDATE assets SET deleted_at = strftime('%s','now')
             WHERE deleted_at IS NULL AND id IN ({})",
            placeholders(ids.len())
        );
        let affected = tx.execute(&sql, params_from_iter(ids))?;
        tx.commit()?;
        Ok(affected)
    }

    /// **Restore:** verilen asset'leri cop kutusundan geri al (`deleted_at = NULL`).
    /// Zaten aktif olan etkilenmez (WHERE deleted_at IS NOT NULL) → etkilenen sayisi
    /// gercekten geri-yuklenenlerdir. Tek TX. Bos dilim → 0 (no-op).
    pub fn restore(&mut self, ids: &[i64]) -> Result<usize, DbError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let tx = self.conn.transaction()?;
        let sql = format!(
            "UPDATE assets SET deleted_at = NULL
             WHERE deleted_at IS NOT NULL AND id IN ({})",
            placeholders(ids.len())
        );
        let affected = tx.execute(&sql, params_from_iter(ids))?;
        tx.commit()?;
        Ok(affected)
    }

    /// **Purge:** verilen asset'leri KALICI sil (geri-alinamaz). Gercek
    /// `DELETE FROM assets` → FK CASCADE iliskisel satirlari (asset_tags/asset_metadata/
    /// favorites/collection_items/asset_thumbnails/relations) + FTS silme-trigger'i
    /// (assets_fts) temizler. `asset_vectors` (vec0) FK/trigger ile temizlenMEZ → ayni
    /// TX icinde ONCE elle silinir (yetim vektor dogmaz). Etkilenen asset sayisi doner.
    ///
    /// NOT: cop'te olmayan (aktif) asset de bu cagriyla silinebilir — gate (komut
    /// katmani) purge'u ADMIN'e kisitlar; veri katmani id'lere gore calisir. Tek TX
    /// (atomik). Bos dilim → 0 (no-op).
    pub fn purge(&mut self, ids: &[i64]) -> Result<usize, DbError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let ph = placeholders(ids.len());
        let tx = self.conn.transaction()?;
        // 1. Vektorleri elle temizle (vec0 FK/CASCADE/trigger DESTEKLEMEZ; health.rs
        //    orphan_count bu yuzden vektor yetimlerini ayrica sayar). Hem METIN
        //    (asset_vectors, 384) hem GORSEL BOLGE (asset_image_region_vectors, 512-CLIP;
        //    PK-kodlamali id/STRIDE=asset_id) tablosu.
        tx.execute(
            &format!("DELETE FROM asset_vectors WHERE asset_id IN ({ph})"),
            params_from_iter(ids),
        )?;
        // Gorsel BOLGE vektorleri (PK-kodlamali id = asset_id*STRIDE + region) → asset'i id/STRIDE
        // ile turet; verilen asset id'lerine ait TUM bolge satirlari silinir.
        tx.execute(
            &format!(
                "DELETE FROM asset_image_region_vectors WHERE id / {stride} IN ({ph})",
                stride = crate::image::IMAGE_REGION_STRIDE
            ),
            params_from_iter(ids),
        )?;
        // 1b. RAG parca vektorleri + parca FTS (chunk_vectors/chunk_fts FK/trigger YOK →
        //     text_chunks CASCADE bunlari temizlemez). chunk_id'ler text_chunks'tan
        //     turetilir → assets DELETE'inden (CASCADE text_chunks'i siler) ONCE yapilmali.
        tx.execute(
            &format!(
                "DELETE FROM chunk_vectors WHERE chunk_id IN
                   (SELECT id FROM text_chunks WHERE asset_id IN ({ph}))"
            ),
            params_from_iter(ids),
        )?;
        tx.execute(
            &format!("DELETE FROM chunk_fts WHERE asset_id IN ({ph})"),
            params_from_iter(ids),
        )?;
        // 2. Asset'leri sil → FK CASCADE (iliskisel + text_chunks) + FTS silme-trigger'i.
        let affected = tx.execute(
            &format!("DELETE FROM assets WHERE id IN ({ph})"),
            params_from_iter(ids),
        )?;
        tx.commit()?;
        Ok(affected)
    }

    /// **Purge-all:** TUM asset'leri (aktif + cop) KALICI sil — **"Sifirla" (reset) ingest
    /// modunun** temiz-baslangic adimi. [`purge`](Self::purge) ile ayni desen ama tum tabloyu
    /// kapsar: once vektorler (vec0 — FK/trigger desteklemez), sonra `DELETE FROM assets`
    /// (FK CASCADE iliskisel satirlar + FTS silme-trigger'i assets_fts). `tags`/`collections`
    /// **tanim** satirlari (sozluk) KORUNUR — `purge(ids)` ile tutarli; uyelikler CASCADE ile
    /// gider. Silinen asset sayisi doner. Tek TX (atomik). GERI-ALINAMAZ → komut katmani
    /// ADMIN'e kisitlar (+ UI 'SIFIRLA' yazarak onay).
    pub fn purge_all(&mut self) -> Result<usize, DbError> {
        let tx = self.conn.transaction()?;
        // Vektorler + RAG parca tablolari once (vec0/FTS CASCADE/trigger desteklemez →
        // yetim dogmaz). chunk_fts/chunk_vectors text_chunks'a baglidir → onlardan once.
        tx.execute("DELETE FROM chunk_vectors", [])?;
        tx.execute("DELETE FROM chunk_fts", [])?;
        tx.execute("DELETE FROM asset_vectors", [])?;
        tx.execute("DELETE FROM asset_image_region_vectors", [])?;
        // Asset'ler → FK CASCADE (iliskisel + text_chunks) + FTS silme-trigger'i temizler.
        let affected = tx.execute("DELETE FROM assets", [])?;
        tx.commit()?;
        Ok(affected)
    }

    /// Cop kutusundaki asset'ler (yalniz `deleted_at IS NOT NULL`), en son atilan ilk
    /// (`deleted_at DESC`). `list_assets`'in dondurdugu `AssetRow` sekli yeniden kullanilir
    /// (favorite bayragi + snippet=NULL). Cop gorunumu/TrashModal verisi.
    pub fn list_trash(&self) -> Result<Vec<AssetRow>, DbError> {
        // COLS = AssetRow cekirdek 10 sutun (alias'siz); ardindan favorite (0/1) + NULL
        // snippet + ai_analyzed + ai_gorsel_turu + dominant_colors → map_asset_row 15 sutun bekler.
        // favorites/ai_analyzed/ai_gorsel_turu korelasyonu cop'te de anlamli (restore sonrasi durum
        // gosterilebilsin). ai_analyzed + ai_gorsel_turu `assets.id` ile INLINE (COLS yolu alias'siz
        // → AI_A / AI_GORSEL_TURU_EXPR `a.` kullanilamaz).
        let sql = format!(
            "SELECT {COLS},
                    EXISTS (SELECT 1 FROM favorites f WHERE f.asset_id = assets.id),
                    NULL,
                    EXISTS (SELECT 1 FROM asset_metadata m
                            WHERE m.asset_id = assets.id AND m.key = 'ai_analyzed'),
                    (SELECT value_text FROM asset_metadata m
                            WHERE m.asset_id = assets.id AND m.key = 'ai_gorsel_turu'),
                    (SELECT value_text FROM asset_metadata m
                            WHERE m.asset_id = assets.id AND m.key = 'dominant_colors')
             FROM assets
             WHERE deleted_at IS NOT NULL
             ORDER BY deleted_at DESC, id DESC"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map([], crate::query::map_asset_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Cop kutusundaki asset sayisi (TrashModal rozeti / "X ogeyi kalici sil" onayi).
    pub fn trash_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM assets WHERE deleted_at IS NOT NULL",
            [],
            |r| r.get(0),
        )?)
    }
}
