//! DWG/DXF geometrik sekil indeksi + arama (Dilim 1: DB katmani).
//!
//! **Descriptor = surekli skaler ozellikler** (hash/vektor DEGIL). Metrik = agirlikli
//! fark + Gaussian(vertex σ), Rust brute-force. Skorlama cekirdegi H2
//! `scan_db.rs::compute_shape_similarity` (kapali↔kapali / acik↔acik / acik↔kapali 3 rejim)
//! ve `search_shapes_by_features` skorunun **birebir** portudur (bkz `sim` alt-modulu).
//!
//! **Bagimlilik izolasyonu:** bu modul `archivist-extract`'e BAGIMLI DEGIL — kendi girdi/
//! sorgu tiplerini (`ShapeInput`/`ShapeQuery`) tanimlar (alan adlari `ShapeFeatures`/`DxfShape`
//! ile uyumlu → Dilim 2 map'lemesi asikar). Veri Rust'ta: renderer sekilleri bellege almaz,
//! yalniz bu API'nin dondurdugu asset satiri + skoru gorur.
//!
//! **§O cop kutusu:** tum arama yollari `assets` ile JOIN + `deleted_at IS NULL` → cop'e
//! atilmis asset sekil sonucuna SIZMAZ (image.rs/semantic.rs FILTER_FRAG guvencesiyle ayni).

use std::collections::HashMap;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::error::DbError;
use crate::query::{
    map_asset_row, AssetRow, AI_A, AI_GORSEL_TURU_EXPR, COLS_A, DOMINANT_COLORS_EXPR, FAV_A,
};
use crate::Db;

mod sim;
// Saf skorlama cekirdegi `sim` alt-modulunde; `shape::<ad>` yolu korunur (lib.rs re-export'u).
pub use sim::{categorize_layer, compute_shape_similarity};
use sim::feature_score;
// Kompozit sekil-kumesi ortusmesi (dedup yapisal + kompozit arama paylasir) — crate-ici.
pub(crate) use sim::asset_shape_overlap;

/// Arama sonucunda asset basina donen ust sekil sayisi kelepcesi (H2 top_k pariti).
const TOP_K_MAX: i64 = 200;

// ─────────────────────────────────────────────────────────────────────────────
// Girdi / sorgu / sonuc tipleri
// ─────────────────────────────────────────────────────────────────────────────

/// Yazilacak tek sekil (Dilim 2 `DxfShape`'ten map'ler). `layer_category` DB'de
/// `categorize_layer` ile TURETILIR → bu tipte YOK (girdi ham layer'i verir).
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ShapeInput {
    pub entity_type: String,
    pub layer_name: Option<String>,
    pub vertex_count: i64,
    pub is_closed: bool,
    pub area: f64,
    pub perimeter: f64,
    pub aspect_ratio: f64,
    pub regularity: f64,
    pub compactness: f64,
    pub solidity: f64,
    pub rectangularity: f64,
    pub bbox_w: f64,
    pub bbox_h: f64,
    pub centroid_x: f64,
    pub centroid_y: f64,
}

/// Referans sekil (benzerlik aramasi) — `ShapeInput`'un layer'siz hali. Frontend/komut
/// verir (`Deserialize`); eksik alanlar `Default` (0/false/bos) → lenient. Skorlamada
/// yalniz `vertex_count`/`is_closed`/7 ozellik/`bbox` kullanilir (H2 pariti); `area`/
/// `centroid`/`entity_type` alanlari simetri icin var, skoru etkilemez.
///
/// **IPC sinirini gecer (camelCase):** frontend hem gonderir (`Deserialize`) hem alir
/// (`Serialize` — `extract_shape_from_image_bytes` komutu bunu `DetectedShape.shape` icinde
/// DONDURUR; frontend onizler sonra `search_shapes_by_similarity`'ye geri gonderir → roundtrip).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ShapeQuery {
    pub entity_type: String,
    pub vertex_count: i64,
    pub is_closed: bool,
    pub area: f64,
    pub perimeter: f64,
    pub aspect_ratio: f64,
    pub regularity: f64,
    pub compactness: f64,
    pub solidity: f64,
    pub rectangularity: f64,
    pub bbox_w: f64,
    pub bbox_h: f64,
    pub centroid_x: f64,
    pub centroid_y: f64,
}

/// Parametrik (kriter) arama filtresi — H2 `ShapeFeatureCriteria` pariti. Tum alanlar
/// opsiyonel (verilmeyen filtre uygulanmaz); `include_open=false` → yalniz kapali sekiller
/// (`is_closed=1 AND vertex_count>=3`). `top_k` = donen ASSET sayisi (1..=200 kelepce).
///
/// **IPC sinirini gecer (camelCase):** frontend yalniz GONDERIR (`Deserialize`).
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ShapeCriteria {
    pub vertex_count: Option<i64>,
    /// vertex_count etrafi tolerans (BETWEEN vc±tol). Negatif → 0.
    pub vertex_tolerance: i64,
    pub min_regularity: Option<f64>,
    pub layer_category: Option<String>,
    pub aspect_min: Option<f64>,
    pub aspect_max: Option<f64>,
    pub min_compactness: Option<f64>,
    pub min_rectangularity: Option<f64>,
    pub include_open: bool,
    pub top_k: i64,
}

/// Arama sonucu: asset satiri (mevcut `AssetRow` reuse) + benzerlik/uygunluk skoru `[0,1]`.
/// **Asset-duzeyi:** ayni asset'in birden cok sekli varsa EN IYI skorla TEK kez doner.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ShapeHit {
    pub asset: AssetRow,
    pub score: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// DB-bagli yardimcilar: aday sutunlari + satir → ShapeQuery map'i
// ─────────────────────────────────────────────────────────────────────────────

/// SELECT'te skorlama-icin-gerekli 11 sutun (asset_id + vc + kapalilik + 8 skaler). Aday
/// `ShapeQuery`'ye map'lenir; kullanilmayan alanlar (entity_type/area/centroid) default.
/// REAL sutunlar `COALESCE(...,0)` — sema NULL'a izin verir (portable-import kenar durumu);
/// tek NULL satir tum sorguyu dusurmesin (H2 skorlama SELECT'i de COALESCE kullanir).
const CAND_COLS: &str = "s.asset_id, s.vertex_count, s.is_closed,
     COALESCE(s.perimeter,0), COALESCE(s.aspect_ratio,0), COALESCE(s.regularity,0),
     COALESCE(s.compactness,0), COALESCE(s.solidity,0), COALESCE(s.rectangularity,0),
     COALESCE(s.bbox_w,0), COALESCE(s.bbox_h,0)";

/// Bir aday satirini `(asset_id, ShapeQuery)`'ye map'le (CAND_COLS sirasinda). `ShapeQuery`
/// hem referans hem aday tarafinda kullanilir (skorlama alanlari ayni).
fn map_candidate(r: &rusqlite::Row) -> rusqlite::Result<(i64, ShapeQuery)> {
    Ok((
        r.get::<_, i64>(0)?,
        ShapeQuery {
            entity_type: String::new(),
            vertex_count: r.get(1)?,
            is_closed: r.get::<_, i64>(2)? != 0,
            area: 0.0,
            perimeter: r.get(3)?,
            aspect_ratio: r.get(4)?,
            regularity: r.get(5)?,
            compactness: r.get(6)?,
            solidity: r.get(7)?,
            rectangularity: r.get(8)?,
            bbox_w: r.get(9)?,
            bbox_h: r.get(10)?,
            centroid_x: 0.0,
            centroid_y: 0.0,
        },
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// Db API: yazma + iki arama yolu
// ─────────────────────────────────────────────────────────────────────────────

impl Db {
    /// Bir asset'in TUM sekillerini (yeniden) yaz — **replace semantigi**: tek TX icinde
    /// once `DELETE FROM asset_shapes WHERE asset_id=?` sonra hepsini INSERT. Reindex
    /// idempotent (ayni asset iki kez indekslenirse cift kayit olmaz). `layer_category`
    /// yazimda `categorize_layer` ile turetilir. Donus = yazilan satir sayisi.
    pub fn set_asset_shapes(
        &self,
        asset_id: i64,
        shapes: &[ShapeInput],
    ) -> Result<usize, DbError> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM asset_shapes WHERE asset_id = ?1", params![asset_id])?;
        {
            let mut ins = tx.prepare(
                "INSERT INTO asset_shapes(
                     asset_id, entity_type, layer_name, layer_category, vertex_count, is_closed,
                     area, perimeter, aspect_ratio, regularity, compactness, solidity,
                     rectangularity, bbox_w, bbox_h, centroid_x, centroid_y)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            )?;
            for s in shapes {
                let category = categorize_layer(s.layer_name.as_deref());
                ins.execute(params![
                    asset_id,
                    s.entity_type,
                    s.layer_name,
                    category,
                    s.vertex_count,
                    i64::from(s.is_closed),
                    s.area,
                    s.perimeter,
                    s.aspect_ratio,
                    s.regularity,
                    s.compactness,
                    s.solidity,
                    s.rectangularity,
                    s.bbox_w,
                    s.bbox_h,
                    s.centroid_x,
                    s.centroid_y,
                ])?;
            }
        }
        tx.commit()?;
        Ok(shapes.len())
    }

    /// **Benzerlik aramasi:** referans sekle en benzeyen asset'ler (brute-force + top_k).
    ///
    /// Aday sekiller cekilir (`!include_open` → SQL on-filtre `is_closed=1 AND vertex_count>=3`),
    /// **cop asset'ler haric** (JOIN assets, `deleted_at IS NULL`). Her aday icin
    /// `compute_shape_similarity` → asset basina MAX skor (asset-duzeyi dedup) → skor DESC
    /// (esitlikte asset id ASC, deterministik) → ilk `top_k` asset. `top_k` 1..=200 kelepce.
    pub fn search_shapes_by_similarity(
        &self,
        q: &ShapeQuery,
        top_k: i64,
        include_open: bool,
    ) -> Result<Vec<ShapeHit>, DbError> {
        let top_k = top_k.clamp(1, TOP_K_MAX);
        let filter = if include_open {
            ""
        } else {
            "AND s.is_closed = 1 AND s.vertex_count >= 3"
        };
        let sql = format!(
            "SELECT {CAND_COLS}
             FROM asset_shapes s JOIN assets a ON a.id = s.asset_id
             WHERE a.deleted_at IS NULL {filter}"
        );

        let mut best: HashMap<i64, f64> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(&sql)?;
            let mut rows = stmt.query([])?;
            while let Some(row) = rows.next()? {
                let (asset_id, cand) = map_candidate(row)?;
                let score = compute_shape_similarity(q, &cand);
                let e = best.entry(asset_id).or_insert(f64::MIN);
                if score > *e {
                    *e = score;
                }
            }
        }
        self.rank_and_hydrate(best, top_k)
    }

    /// **Parametrik arama:** kriterlerle SQL on-filtre + kalite skoru (H2 `feature_score`).
    ///
    /// Dinamik WHERE (vertex BETWEEN vc±tol · min_regularity · layer_category · aspect
    /// BETWEEN · min_compactness · min_rectangularity · include_open) + **cop haric**
    /// (`deleted_at IS NULL`). Adaylar skorlanir → asset basina MAX → skor DESC → `top_k`
    /// (1..=200). Filtre degerleri her zaman PARAMETRE olarak baglanir (SQL-injection yok).
    pub fn search_shapes_by_features(&self, c: &ShapeCriteria) -> Result<Vec<ShapeHit>, DbError> {
        let top_k = c.top_k.clamp(1, TOP_K_MAX);

        let mut conds: Vec<String> = vec!["a.deleted_at IS NULL".to_string()];
        let mut binds: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if !c.include_open {
            conds.push("s.is_closed = 1 AND s.vertex_count >= 3".to_string());
        }
        if let Some(vc) = c.vertex_count {
            let tol = c.vertex_tolerance.max(0);
            conds.push(format!("s.vertex_count BETWEEN ?{} AND ?{}", binds.len() + 1, binds.len() + 2));
            binds.push(Box::new((vc - tol).max(1)));
            binds.push(Box::new(vc + tol));
        }
        if let Some(v) = c.min_regularity {
            conds.push(format!("s.regularity >= ?{}", binds.len() + 1));
            binds.push(Box::new(v));
        }
        // Kategori filtresi: bos veya "TUMU" (tumu) → filtre yok (H2 pariti).
        if let Some(cat) =
            c.layer_category.as_deref().filter(|s| !s.is_empty() && *s != "TUMU")
        {
            conds.push(format!("s.layer_category = ?{}", binds.len() + 1));
            binds.push(Box::new(cat.to_string()));
        }
        if let Some(v) = c.aspect_min {
            conds.push(format!("s.aspect_ratio >= ?{}", binds.len() + 1));
            binds.push(Box::new(v));
        }
        if let Some(v) = c.aspect_max {
            conds.push(format!("s.aspect_ratio <= ?{}", binds.len() + 1));
            binds.push(Box::new(v));
        }
        if let Some(v) = c.min_compactness {
            conds.push(format!("s.compactness >= ?{}", binds.len() + 1));
            binds.push(Box::new(v));
        }
        if let Some(v) = c.min_rectangularity {
            conds.push(format!("s.rectangularity >= ?{}", binds.len() + 1));
            binds.push(Box::new(v));
        }

        let sql = format!(
            "SELECT s.asset_id, s.vertex_count, s.is_closed,
                    COALESCE(s.regularity,0), COALESCE(s.compactness,0),
                    COALESCE(s.solidity,0), COALESCE(s.rectangularity,0), COALESCE(s.aspect_ratio,0)
             FROM asset_shapes s JOIN assets a ON a.id = s.asset_id
             WHERE {}",
            conds.join(" AND ")
        );

        let mut best: HashMap<i64, f64> = HashMap::new();
        {
            let refs: Vec<&dyn rusqlite::types::ToSql> = binds.iter().map(|b| b.as_ref()).collect();
            let mut stmt = self.conn.prepare(&sql)?;
            let mut rows = stmt.query(refs.as_slice())?;
            while let Some(row) = rows.next()? {
                let asset_id: i64 = row.get(0)?;
                let vc: i64 = row.get(1)?;
                let is_closed = row.get::<_, i64>(2)? != 0;
                let score = feature_score(
                    is_closed,
                    row.get(3)?, // regularity
                    row.get(4)?, // compactness
                    row.get(5)?, // solidity
                    row.get(6)?, // rectangularity
                    row.get(7)?, // aspect_ratio
                    vc,
                );
                let e = best.entry(asset_id).or_insert(f64::MIN);
                if score > *e {
                    *e = score;
                }
            }
        }
        self.rank_and_hydrate(best, top_k)
    }

    /// **Kompozit (cizim-cizim) arama:** referans asset'in (`ref_asset_id`) TUM sekil kumesine
    /// en cok ortusen DIGER aktif asset'ler ([`asset_shape_overlap`] Jaccard-benzeri; dedup
    /// yapisal cekirdegi reuse). Referansin kendisi haric; cop haric (`deleted_at IS NULL`).
    /// Her aday icin ortusme `0..=100` → `>= min_score && >0` olanlar `[0,1]`'e olceklenip skor
    /// DESC (esitlikte asset id ASC) siralanir, ilk `top_k`. Referansin sekli yoksa bos.
    /// `top_k` 1..=200, `min_score` 0..=100 kelepce. O(n·m^2) — istek-uzeri; komut async kosar.
    pub fn search_shapes_composite(
        &self,
        ref_asset_id: i64,
        top_k: i64,
        min_score: u32,
    ) -> Result<Vec<ShapeHit>, DbError> {
        let top_k = top_k.clamp(1, TOP_K_MAX);
        let min_score = min_score.min(100);

        // Referans asset'in sekilleri (cop/sekilsiz → bos → referans gecersiz, erken cik).
        let ref_shapes = self.load_asset_shapes(ref_asset_id)?;
        if ref_shapes.is_empty() {
            return Ok(Vec::new());
        }

        // Diger aktif asset'lerin sekilleri asset basina gruplanir (referansin kendisi haric).
        let sql = format!(
            "SELECT {CAND_COLS}
             FROM asset_shapes s JOIN assets a ON a.id = s.asset_id
             WHERE a.deleted_at IS NULL AND s.asset_id <> ?1"
        );
        let mut by_asset: HashMap<i64, Vec<ShapeQuery>> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(&sql)?;
            let mut rows = stmt.query(params![ref_asset_id])?;
            while let Some(row) = rows.next()? {
                let (asset_id, cand) = map_candidate(row)?;
                by_asset.entry(asset_id).or_default().push(cand);
            }
        }

        // Kompozit ortusme → asset basina tek skor ([0,1]); esik-alti / sifir elenir.
        let mut best: HashMap<i64, f64> = HashMap::new();
        for (asset_id, shapes) in &by_asset {
            let score = asset_shape_overlap(&ref_shapes, shapes);
            if score >= min_score && score > 0 {
                best.insert(*asset_id, f64::from(score) / 100.0);
            }
        }
        self.rank_and_hydrate(best, top_k)
    }

    /// Bir asset'in TUM sekillerini `ShapeQuery` olarak yukle (skorlama alanlari; cop/sekilsiz →
    /// bos). Kompozit aramanin referans tarafi — `CAND_COLS` + [`map_candidate`] reuse (asset_id atilir).
    fn load_asset_shapes(&self, asset_id: i64) -> Result<Vec<ShapeQuery>, DbError> {
        let sql = format!(
            "SELECT {CAND_COLS}
             FROM asset_shapes s JOIN assets a ON a.id = s.asset_id
             WHERE a.deleted_at IS NULL AND s.asset_id = ?1"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut rows = stmt.query(params![asset_id])?;
        let mut out = Vec::new();
        while let Some(row) = rows.next()? {
            let (_id, cand) = map_candidate(row)?;
            out.push(cand);
        }
        Ok(out)
    }

    /// `asset_id → max_skor` haritasini `ShapeHit`'e cevir: asset satirlarini hidratla
    /// (`AssetRow` reuse; §O cop tekrar dogrulanir), skoru bagla, skor DESC (esitlikte asset
    /// id ASC) sirala, ilk `top_k` asset'i dondur. image.rs kNN hidratlama deseniyle ayni.
    fn rank_and_hydrate(
        &self,
        best: HashMap<i64, f64>,
        top_k: i64,
    ) -> Result<Vec<ShapeHit>, DbError> {
        if best.is_empty() {
            return Ok(Vec::new());
        }
        let id_list =
            best.keys().map(i64::to_string).collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT {COLS_A}, {FAV_A}, NULL, {AI_A}, {AI_GORSEL_TURU_EXPR}, {DOMINANT_COLORS_EXPR} FROM assets a
             WHERE a.id IN ({id_list}) AND a.deleted_at IS NULL"
        );
        let mut hits: Vec<ShapeHit> = {
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt.query_map([], map_asset_row)?;
            let mut v = Vec::new();
            for row in rows {
                let asset = row?;
                let score = *best.get(&asset.id).unwrap_or(&0.0);
                v.push(ShapeHit { asset, score });
            }
            v
        };
        // Skor DESC, esitlikte asset id ASC (deterministik).
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| a.asset.id.cmp(&b.asset.id))
        });
        hits.truncate(top_k as usize);
        Ok(hits)
    }
}
