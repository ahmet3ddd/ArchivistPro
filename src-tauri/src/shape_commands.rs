//! DWG/DXF geometrik sekil-arama komutlari (Dilim 3 — komut katmani).
//!
//! Veri Rust'ta: skorlama cekirdegi + brute-force tarama `archivist-db::shape` (Dilim 1);
//! bu modul yalniz IPC sinirini (DTO map + kilit) yonetir — renderer sekilleri bellege ALMAZ,
//! yalniz `ShapeHit` (asset satiri + skor) gorur.
//!
//! Komutlar:
//!   - `search_shapes_by_similarity`  : referans sekle en benzeyen asset'ler (benzerlik skoru).
//!   - `search_shapes_by_features`    : parametrik kriter filtresi + kalite skoru.
//!   - `extract_shape_from_image_bytes`: yuklenen gorselden baskin kapali konturu → `ShapeQuery`
//!     (frontend onizler → `search_shapes_by_similarity`'ye geri gonderir; roundtrip).
//!
//! Salt-okuma → rol gate YOK (`similar_images` deseni). Arama yollari brute-force O(n) →
//! **async** (dedup deseni): govde bloklayici ama ana iş parcacigi disinda kosar (buyuk arsivde
//! UI donmaz). Govdede `.await` yok → MutexGuard await sinirini gecmez (Send-future guvenli).

use archivist_db::{ShapeCriteria, ShapeHit, ShapeQuery};
use archivist_extract_image::ImageShapeResult;
use serde::Serialize;
use tauri::State;

use crate::AppState;

/// Yuklenen gorselden cikarilan sekil — IPC bicimi (camelCase). `shape` alani dogrudan
/// `search_shapes_by_similarity`'ye geri gonderilebilir (roundtrip; frontend once onizler).
/// Sayimlar/boyutlar (kontur/vertex/gorsel-en-boy) yalniz UI teshis/gosterge icin.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedShape {
    /// Benzerlik aramasina hazir referans sekil (kapali kontur → `is_closed=true`).
    pub shape: ShapeQuery,
    /// Basitlestirme oncesi ham kontur piksel sayisi.
    pub contour_point_count: usize,
    /// RDP sonrasi vertex sayisi (= `shape.vertex_count`).
    pub simplified_point_count: usize,
    pub image_width: u32,
    pub image_height: u32,
}

/// `ImageShapeResult` → `DetectedShape` saf map'lemesi (test edilebilir; komut yalniz sarar).
///
/// **Gorsel kontur DAIMA KAPALI sekil** → `is_closed=true`, `vertex_count=simplified_point_count`.
/// Kapali↔kapali skorlamasi (bkz `compute_shape_similarity`) yalniz vertex + compact/reg/ar/
/// rect/solid kullanir; `area`/`perimeter`/`bbox`/`centroid`'i OKUMAZ → `bbox_w/h` ve
/// `centroid_x/y` guvenle `0.0` (gorselden anlamli bbox/centroid uretilmez). `area`/`perimeter`
/// yine de `features`'tan tasinir (simetri + olasi ileri kullanim).
fn to_detected_shape(res: ImageShapeResult) -> DetectedShape {
    let f = &res.features;
    DetectedShape {
        shape: ShapeQuery {
            entity_type: String::new(),
            vertex_count: res.simplified_point_count as i64,
            is_closed: true,
            area: f.area,
            perimeter: f.perimeter,
            aspect_ratio: f.aspect_ratio,
            regularity: f.regularity,
            compactness: f.compactness,
            solidity: f.solidity,
            rectangularity: f.rectangularity,
            bbox_w: 0.0,
            bbox_h: 0.0,
            centroid_x: 0.0,
            centroid_y: 0.0,
        },
        contour_point_count: res.contour_point_count,
        simplified_point_count: res.simplified_point_count,
        image_width: res.image_width,
        image_height: res.image_height,
    }
}

/// **Benzerlik aramasi:** referans sekle (`query`) en benzeyen asset'ler (brute-force + top_k).
/// Salt-okuma (rol gate yok). `include_open=false` → yalniz kapali sekiller. Cop asset'ler
/// db katmaninda haric tutulur (`deleted_at IS NULL`).
#[tauri::command]
pub async fn search_shapes_by_similarity(
    query: ShapeQuery,
    top_k: i64,
    include_open: bool,
    state: State<'_, AppState>,
) -> Result<Vec<ShapeHit>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.search_shapes_by_similarity(&query, top_k, include_open)
        .map_err(|e| e.to_string())
}

/// **Parametrik arama:** kriterlerle (`criteria`) SQL on-filtre + kalite skoru. Salt-okuma
/// (rol gate yok). `top_k` db katmaninda 1..=200 kelepcelenir.
#[tauri::command]
pub async fn search_shapes_by_features(
    criteria: ShapeCriteria,
    state: State<'_, AppState>,
) -> Result<Vec<ShapeHit>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.search_shapes_by_features(&criteria).map_err(|e| e.to_string())
}

/// **Kompozit (cizim-cizim) arama:** referans asset'e (`ref_asset_id`) sekil-kumesi olarak en cok
/// ortusen diger DXF/DWG asset'ler (ortusme skoru sirali). Salt-okuma (rol gate yok). `top_k`
/// 1..=200, `min_score` 0..=100 db katmaninda kelepcelenir. Referansin sekli yoksa bos doner.
/// **async** (brute-force O(n·m²); UI donmaz — govde bloklayici ama `.await` yok).
#[tauri::command]
pub async fn search_shapes_composite(
    ref_asset_id: i64,
    top_k: i64,
    min_score: u32,
    state: State<'_, AppState>,
) -> Result<Vec<ShapeHit>, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.search_shapes_composite(ref_asset_id, top_k, min_score)
        .map_err(|e| e.to_string())
}

/// Yuklenen gorsel baytlarindan (PNG/JPG/BMP/TIFF) baskin kapali konturu cikar → `DetectedShape`.
/// DB gerekmez → **sync** (goruntu isleme CPU-baglidir ama tek gorsel; ingest'teki toplu is
/// degil). Basarisiz decode/kontur → Err (frontend hata gosterir). Donen `shape`, frontend
/// onizledikten sonra `search_shapes_by_similarity`'ye aynen geri gonderilir.
#[tauri::command]
pub fn extract_shape_from_image_bytes(bytes: Vec<u8>) -> Result<DetectedShape, String> {
    let res = archivist_extract_image::extract_shape_from_bytes(&bytes)?;
    Ok(to_detected_shape(res))
}

#[cfg(test)]
mod tests {
    use super::*;
    use archivist_extract::ShapeFeatures;

    /// Sabit `ImageShapeResult` → `DetectedShape` alan eslemesi: kapali bayrak, vertex=simplified,
    /// ozellik duz kopyasi, bbox/centroid=0 (kapali↔kapali skorlamada kullanilmaz).
    #[test]
    fn image_result_maps_to_detected_shape() {
        let res = ImageShapeResult {
            features: ShapeFeatures {
                area: 400.0,
                perimeter: 80.0,
                aspect_ratio: 1.25,
                regularity: 0.95,
                compactness: 0.78,
                solidity: 0.99,
                rectangularity: 0.97,
            },
            contour_point_count: 240,
            simplified_point_count: 4,
            image_width: 40,
            image_height: 32,
        };
        let d = to_detected_shape(res);

        // Gorsel kontur DAIMA kapali → is_closed=true, vertex_count=simplified.
        assert!(d.shape.is_closed, "gorsel kontur kapali olmali");
        assert_eq!(d.shape.vertex_count, 4);
        assert_eq!(d.shape.entity_type, "");

        // 7 ozellik features'tan duz kopyalanir (exact copy → epsilon karsilastir).
        let near = |a: f64, b: f64| (a - b).abs() < 1e-9;
        assert!(near(d.shape.area, 400.0));
        assert!(near(d.shape.perimeter, 80.0));
        assert!(near(d.shape.aspect_ratio, 1.25));
        assert!(near(d.shape.regularity, 0.95));
        assert!(near(d.shape.compactness, 0.78));
        assert!(near(d.shape.solidity, 0.99));
        assert!(near(d.shape.rectangularity, 0.97));

        // bbox/centroid kapali↔kapali skorlamada kullanilmaz → 0.0.
        assert!(near(d.shape.bbox_w, 0.0));
        assert!(near(d.shape.bbox_h, 0.0));
        assert!(near(d.shape.centroid_x, 0.0));
        assert!(near(d.shape.centroid_y, 0.0));

        // Ust-duzey teshis alanlari aynen tasinir.
        assert_eq!(d.contour_point_count, 240);
        assert_eq!(d.simplified_point_count, 4);
        assert_eq!(d.image_width, 40);
        assert_eq!(d.image_height, 32);
    }
}
