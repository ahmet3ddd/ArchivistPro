//! Katman 1 DB entegrasyonu — `ai_gorsel_turu` EAV yazimi (idempotent) + mevcut asset backfill.

use rusqlite::params;

use super::{classify_image_kind, ImageKind, RASTER_IMAGE_EXTS};
use crate::error::DbError;
use crate::Db;

/// Bir asset'in EXIF/boyut EAV'sinden turetilen ham sinyaller (backfill okur → saf fonksiyona verir).
#[derive(Default)]
struct ImageSignals {
    is_render: bool,
    render_software: Option<String>,
    has_camera: bool,
    has_gps: bool,
    has_focal: bool,
    has_exposure: bool,
    has_iso: bool,
    width: Option<u32>,
    height: Option<u32>,
}

/// Bos/`"0"` olmayan metin mi? (H2: `.trim().length>0 && .trim() !== '0'`).
fn is_nonzero_text(v: Option<&str>) -> bool {
    match v {
        Some(s) => {
            let t = s.trim();
            !t.is_empty() && t != "0"
        }
        None => false,
    }
}

/// `value_num` → `u32` (negatif/tasan/NaN → `None`).
fn u32_from_num(v: f64) -> Option<u32> {
    if v.is_finite() && v >= 0.0 && v <= f64::from(u32::MAX) {
        Some(v as u32)
    } else {
        None
    }
}

impl Db {
    /// `ai_gorsel_turu` EAV'yi **yalniz YOKSA** yaz (idempotent, YIKICI DEGIL). `ai_*` alanlarinin
    /// re-ingest davranisina (KORU) uyar: mevcut deger (onceki heuristik VEYA Katman 2 vision) EZILMEZ.
    /// FTS'e (assets_fts.ai) DOKUNMAZ → vision betim metnini kirletmez. Doner: gercekten yazildi mi.
    pub fn write_image_kind(&self, asset_id: i64, kind: ImageKind) -> Result<bool, DbError> {
        let n = self.conn.execute(
            "INSERT INTO asset_metadata(asset_id, key, value_text, value_num)
             VALUES (?1, 'ai_gorsel_turu', ?2, NULL)
             ON CONFLICT(asset_id, key) DO NOTHING",
            params![asset_id, kind.as_token()],
        )?;
        Ok(n == 1)
    }

    /// Bir asset'in EXIF/boyut EAV satirlarini oku → siniflandirici sinyallerine cevir. H3 alan
    /// adlari (image_meta.rs): camera_make/camera_model · gps_lat/gps_lon (value_num) · focal_length ·
    /// exposure_time (value_text) · iso_speed (value_num) · is_render (value_text "true") · software ·
    /// width/height (value_num).
    fn read_image_signals(&self, asset_id: i64) -> Result<ImageSignals, DbError> {
        let mut sig = ImageSignals::default();
        let mut stmt = self
            .conn
            .prepare("SELECT key, value_text, value_num FROM asset_metadata WHERE asset_id = ?1")?;
        let rows = stmt.query_map(params![asset_id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, Option<f64>>(2)?,
            ))
        })?;
        for row in rows {
            let (key, vt, vn) = row?;
            match key.as_str() {
                // clippy(1.95) collapsible_match: bos-`if` arm'lari match GUARD'ina cevrildi
                // (davranis AYNI — kosul saglanmazsa arm alinmaz → `_ => {}` no-op'a duser; her
                // key benzersiz tek arm, tek fallthrough `_`).
                "camera_make" | "camera_model"
                    if vt.as_deref().is_some_and(|s| !s.trim().is_empty()) =>
                {
                    sig.has_camera = true;
                }
                "gps_lat" | "gps_lon" if vn.is_some_and(|v| v != 0.0) => {
                    sig.has_gps = true;
                }
                "focal_length" if is_nonzero_text(vt.as_deref()) => {
                    sig.has_focal = true;
                }
                "exposure_time" if is_nonzero_text(vt.as_deref()) => {
                    sig.has_exposure = true;
                }
                "iso_speed" if vn.is_some_and(|v| v != 0.0) || is_nonzero_text(vt.as_deref()) => {
                    sig.has_iso = true;
                }
                "is_render" if vt.as_deref() == Some("true") => {
                    sig.is_render = true;
                }
                "software" => sig.render_software = vt,
                "width" => sig.width = vn.and_then(u32_from_num),
                "height" => sig.height = vn.and_then(u32_from_num),
                _ => {}
            }
        }
        Ok(sig)
    }

    /// **Backfill (mevcut asset'ler; YENIDEN TARAMA YOK):** `ai_gorsel_turu` OLMAYAN raster gorsel
    /// asset'leri gez, her biri icin EXIF/boyut EAV + yol/ad oku → saf siniflandiriciyi cagir →
    /// dolu ise `ai_gorsel_turu` yaz. **Idempotent** (yalniz eksik olanlar; ikinci kosu 0 yazar).
    /// `ai_gorsel_turu` olan asset'e DOKUNMAZ. Kardes-uzanti katmani BURADA atlanir (bos). Doner:
    /// gercekten yazilan asset sayisi.
    pub fn backfill_image_kind(&self) -> Result<usize, DbError> {
        let ext_list =
            RASTER_IMAGE_EXTS.iter().map(|e| format!("'{e}'")).collect::<Vec<_>>().join(",");
        // ext_list yalniz kendi sabitlerimizden → enjeksiyon yok.
        let sql = format!(
            "SELECT a.id, a.path, a.file_name FROM assets a
             WHERE a.deleted_at IS NULL
               AND a.ext IS NOT NULL AND lower(a.ext) IN ({ext_list})
               AND NOT EXISTS (SELECT 1 FROM asset_metadata m
                               WHERE m.asset_id = a.id AND m.key = 'ai_gorsel_turu')
             ORDER BY a.id"
        );
        let candidates: Vec<(i64, String, String)> = {
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()?
        };
        let mut written = 0usize;
        for (id, path, file_name) in candidates {
            let sig = self.read_image_signals(id)?;
            if let Some(kind) = classify_image_kind(
                &file_name,
                &path,
                sig.is_render,
                sig.render_software.as_deref(),
                sig.has_camera,
                sig.has_gps,
                sig.has_focal,
                sig.has_exposure,
                sig.has_iso,
                sig.width,
                sig.height,
                &[],
            ) {
                if self.write_image_kind(id, kind)? {
                    written += 1;
                }
            }
        }
        Ok(written)
    }
}
