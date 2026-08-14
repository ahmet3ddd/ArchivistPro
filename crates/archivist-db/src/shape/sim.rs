//! Saf (rusqlite'siz) sekil benzerlik/skor matematigi — H2 birebir port.
//!
//! DB'ye DOKUNMAZ: yalniz `ShapeQuery` skaler alanlarindan skalar skor uretir. DB-bagli
//! yardimcilar (`map_candidate`) + `impl Db` arama yollari `super` (mod.rs) icinde kalir.
//! Bu ayrim `shape` modulunu 500-satir kurali altina indirir (saf refactor, davranis degismez).

use super::ShapeQuery;

// ─────────────────────────────────────────────────────────────────────────────
// Saf yardimcilar: kategori + skorlama cekirdegi (H2 birebir port)
// ─────────────────────────────────────────────────────────────────────────────

/// Layer adindan kategori turet — H2 `shapes_db.rs::categorize_layer` (Turkce + Ingilizce
/// anahtar kelime → kategori) birebir portu. `None` layer → `None` (kategori yok); layer VAR
/// ama hicbir anahtar kelime eslesmez → `Some("DIGER")` (H2 davranisi: mevcut layer → daima
/// bir kategori dizgesi, eslesmeyende DIGER).
pub fn categorize_layer(layer_name: Option<&str>) -> Option<String> {
    let upper = layer_name?.to_uppercase();
    // (anahtar kelimeler, kategori) — H2 sirasiyla ayni (ilk eslesen kazanir).
    let patterns: &[(&[&str], &str)] = &[
        (&["HAVUZ", "POOL", "BASIN"], "HAVUZ"),
        (&["DUVAR", "WALL", "MURO"], "DUVAR"),
        (&["KAPI", "DOOR", "PORTA"], "KAPI"),
        (&["PENCERE", "WINDOW", "CAM"], "PENCERE"),
        (&["KOLON", "COLUMN"], "KOLON"),
        (&["KIRIS", "KIRIŞ", "BEAM"], "KIRIS"),
        (&["MERDIVEN", "MERDİVEN", "STAIR"], "MERDIVEN"),
        (&["DOSEME", "DÖŞEME", "SLAB", "FLOOR"], "DOSEME"),
        (&["CATI", "ÇATI", "ROOF"], "CATI"),
    ];
    for (keys, cat) in patterns {
        if keys.iter().any(|k| upper.contains(k)) {
            return Some((*cat).to_string());
        }
    }
    Some("DIGER".to_string())
}

/// Gaussian vertex-sayisi benzerligi: `exp(-Δvc²/(2σ²))`, `σ = max(0.3·maxVertex, 1.5)`
/// (H2 birebir). Vertex farki buyudukce hizla dusen yumusak benzerlik.
fn gaussian_vc_sim(a: i64, b: i64) -> f64 {
    let sigma = ((a.max(b) as f64) * 0.3).max(1.5);
    let d = a as f64 - b as f64;
    (-d * d / (2.0 * sigma * sigma)).exp()
}

/// Oran (aspect_ratio) benzerligi: `1 - |a-b| / max(a,b,0.01)` (H2 birebir).
fn ar_sim(a: f64, b: f64) -> f64 {
    let m = a.max(b).max(0.01);
    1.0 - (a - b).abs() / m
}

/// Referans sekle benzerlik skoru `[0,1]` — H2 `compute_shape_similarity` birebir portu.
///
/// 3 rejim (referans + aday kapalilik durumuna gore):
/// - **kapali↔kapali:** `0.20 vc + 0.20 compact + 0.15 reg + 0.15 ar + 0.15 rect + 0.10 solid + 0.05`
/// - **acik↔acik:** `0.35 vc + 0.30 ar + 0.25 sinuosity + 0.10`
///   (`sinuosity = perimeter / hypot(bbox_w,bbox_h)`; referans "sinuosity"si H2'de
///   `vertex_count·0.5` ile yaklasik alinir — referansin perimeter/bbox'i skorda kullanilmaz)
/// - **acik↔kapali (uyumsuz):** `0.30 vc + 0.20 ar` (dusuk uyum)
///
/// Ozellik-farki terimleri (reg/compact/solid/rect) `1 - |Δ|` (0..1 aralikli ozellikler).
/// Aday kutusu (`candidate`) `ShapeQuery` sekilli — DB satirindan turer; skorlamada
/// yalniz vertex/kapalilik/7 ozellik/perimeter/bbox okunur.
pub fn compute_shape_similarity(reference: &ShapeQuery, candidate: &ShapeQuery) -> f64 {
    let vc_sim = gaussian_vc_sim(reference.vertex_count, candidate.vertex_count);
    let ar = ar_sim(reference.aspect_ratio, candidate.aspect_ratio);

    let score = if reference.is_closed && candidate.is_closed {
        let reg_sim = 1.0 - (reference.regularity - candidate.regularity).abs();
        let compact_sim = 1.0 - (reference.compactness - candidate.compactness).abs();
        let solid_sim = 1.0 - (reference.solidity - candidate.solidity).abs();
        let rect_sim = 1.0 - (reference.rectangularity - candidate.rectangularity).abs();
        0.20 * vc_sim
            + 0.20 * compact_sim
            + 0.15 * reg_sim
            + 0.15 * ar
            + 0.15 * rect_sim
            + 0.10 * solid_sim
            + 0.05
    } else if !reference.is_closed && !candidate.is_closed {
        // Aday sinuosity'si gercek perimeter/kosegen; referansinki vertex sayisindan yaklasik.
        let diag = candidate.bbox_w.hypot(candidate.bbox_h).max(1e-9);
        let sinuosity = candidate.perimeter / diag;
        let ref_sin = reference.vertex_count as f64 * 0.5;
        let sin_max = ref_sin.max(sinuosity).max(0.01);
        let sin_sim = 1.0 - (ref_sin - sinuosity).abs().min(sin_max) / sin_max;
        0.35 * vc_sim + 0.30 * ar + 0.25 * sin_sim + 0.10
    } else {
        0.30 * vc_sim + 0.20 * ar
    };
    score.clamp(0.0, 1.0)
}

/// Parametrik arama skoru (H2 `search_shapes_by_features` :2097 birebir) — SQL filtresini
/// gecen adaya "kalite" skoru verir. Kapali: `0.30 reg + 0.25 compact + 0.20 rect + 0.15 solid + 0.10`.
/// Acik: `0.40 reg + 0.30·(1/(1+|ar-1|)) + 0.20·min(vc/20,1) + 0.10`.
pub(super) fn feature_score(
    is_closed: bool,
    reg: f64,
    compact: f64,
    solid: f64,
    rect: f64,
    ar: f64,
    vc: i64,
) -> f64 {
    let score = if is_closed {
        0.30 * reg + 0.25 * compact + 0.20 * rect + 0.15 * solid + 0.10
    } else {
        0.40 * reg + 0.30 * (1.0 / (1.0 + (ar - 1.0).abs())) + 0.20 * (vc as f64 / 20.0).min(1.0)
            + 0.10
    };
    score.clamp(0.0, 1.0)
}

/// Iki seklin "ayni" sayilma esigi ([`compute_shape_similarity`] `[0,1]`). Yuksek → yalniz
/// neredeyse-ozdes sekiller eslesir (kopya/kompozit tespiti icin dogru; gurultu-kopya uydurmaz).
const SHAPE_MATCH_THRESHOLD: f64 = 0.9;

/// Iki cizimin sekil KUMELERI arasinda Jaccard-benzeri ortusme skoru (`0..=100`). Her sekil-cifti
/// [`compute_shape_similarity`] ile skorlanir; `>= SHAPE_MATCH_THRESHOLD` "eslesme" sayilir.
/// Skor = (A'da eslesen + B'de eslesen) / (|A| + |B|) × 100 → iki taraf da tam ortusuyorsa 100,
/// hic ortusme yoksa 0. Simetrik. O(|A|·|B|). **dedup (yapisal) + kompozit sekil aramasi paylasir.**
pub(crate) fn asset_shape_overlap(a: &[ShapeQuery], b: &[ShapeQuery]) -> u32 {
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    let matched_a = a
        .iter()
        .filter(|sa| b.iter().any(|sb| compute_shape_similarity(sa, sb) >= SHAPE_MATCH_THRESHOLD))
        .count();
    let matched_b = b
        .iter()
        .filter(|sb| a.iter().any(|sa| compute_shape_similarity(sa, sb) >= SHAPE_MATCH_THRESHOLD))
        .count();
    let overlap = (matched_a + matched_b) as f64 / (a.len() + b.len()) as f64;
    (overlap * 100.0).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `categorize_layer`: Turkce + Ingilizce anahtar kelimeler + bilinmeyen + None.
    #[test]
    fn categorize_layer_matches_keywords() {
        assert_eq!(categorize_layer(Some("DUVAR-01")).as_deref(), Some("DUVAR"));
        assert_eq!(categorize_layer(Some("wall_ext")).as_deref(), Some("DUVAR"));
        assert_eq!(categorize_layer(Some("A-KAPI")).as_deref(), Some("KAPI"));
        assert_eq!(categorize_layer(Some("WINDOW glass")).as_deref(), Some("PENCERE"));
        assert_eq!(categorize_layer(Some("HAVUZ")).as_deref(), Some("HAVUZ"));
        assert_eq!(categorize_layer(Some("çatı_katı")).as_deref(), Some("CATI"));
        assert_eq!(categorize_layer(Some("DÖŞEME")).as_deref(), Some("DOSEME"));
        // Layer VAR ama eslesmez → DIGER (H2 davranisi).
        assert_eq!(categorize_layer(Some("0")).as_deref(), Some("DIGER"));
        assert_eq!(categorize_layer(Some("random_layer")).as_deref(), Some("DIGER"));
        // Layer YOK → None.
        assert_eq!(categorize_layer(None), None);
    }

    /// Ozdes kapali sekil → skor ~1.0; cok farkli → dusuk; acik↔kapali → dusuk uyum.
    #[test]
    fn compute_shape_similarity_regimes() {
        // Ozdes kapali kare benzeri sekil → ~1.0.
        let square = ShapeQuery {
            is_closed: true,
            vertex_count: 4,
            aspect_ratio: 1.0,
            regularity: 1.0,
            compactness: 1.0,
            solidity: 1.0,
            rectangularity: 1.0,
            ..Default::default()
        };
        let s = compute_shape_similarity(&square, &square);
        assert!(s > 0.99, "ozdes kapali sekil skoru ~1.0, got {s}");

        // Cok farkli kapali sekil → belirgin dusuk.
        let blob = ShapeQuery {
            is_closed: true,
            vertex_count: 40,
            aspect_ratio: 8.0,
            regularity: 0.1,
            compactness: 0.1,
            solidity: 0.3,
            rectangularity: 0.2,
            ..Default::default()
        };
        let d = compute_shape_similarity(&square, &blob);
        assert!(d < s, "farkli sekil ozdesten dusuk olmali");
        assert!((0.0..=1.0).contains(&d), "skor [0,1] icinde");

        // Acik↔kapali rejimi (uyumsuz) → tavan 0.30 vc + 0.20 ar = 0.5 → dusuk.
        let open = ShapeQuery { is_closed: false, vertex_count: 4, aspect_ratio: 1.0, ..Default::default() };
        let mixed = compute_shape_similarity(&open, &square);
        assert!(mixed <= 0.5 + 1e-9, "acik↔kapali dusuk uyum (<=0.5), got {mixed}");
    }
}
