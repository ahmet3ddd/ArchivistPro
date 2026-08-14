//! Geometri yardimcilari — DXF geometri (cad ailesi) ve gorsel shape-match (image
//! ailesi) ORTAK kullanir. Saf math, sifir bagimlilik. Kapali poligondan
//! [`ShapeFeatures`] uretir.
//!
//! Modüler-aritmetik indexleme (`verts[(i+1) % n]`) bilincli; iterator'a cevirmek
//! okunabilirligi dusurur → needless_range_loop kapali.
#![allow(clippy::needless_range_loop)]

use crate::types::ShapeFeatures;

/// Shoelace ile mutlak poligon alani (kapali varsayilir; son != ilk).
pub fn polygon_area(verts: &[(f64, f64)]) -> f64 {
    let n = verts.len();
    if n < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..n {
        let (x1, y1) = verts[i];
        let (x2, y2) = verts[(i + 1) % n];
        sum += x1 * y2 - x2 * y1;
    }
    (sum / 2.0).abs()
}

/// Poligon cevresi. `closed` ise son→ilk kenari da ekler.
pub fn polygon_perimeter(verts: &[(f64, f64)], closed: bool) -> f64 {
    let n = verts.len();
    if n < 2 {
        return 0.0;
    }
    let limit = if closed { n } else { n - 1 };
    let mut sum = 0.0;
    for i in 0..limit {
        let (x1, y1) = verts[i];
        let (x2, y2) = verts[(i + 1) % n];
        sum += ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
    }
    sum
}

/// Sinirlayici kutu (genislik, yukseklik).
pub fn polygon_bbox(verts: &[(f64, f64)]) -> (f64, f64) {
    if verts.is_empty() {
        return (0.0, 0.0);
    }
    let min_x = verts.iter().map(|v| v.0).fold(f64::INFINITY, f64::min);
    let max_x = verts.iter().map(|v| v.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = verts.iter().map(|v| v.1).fold(f64::INFINITY, f64::min);
    let max_y = verts.iter().map(|v| v.1).fold(f64::NEG_INFINITY, f64::max);
    (max_x - min_x, max_y - min_y)
}

/// Aritmetik ortalama merkez (centroid yaklasimi).
pub fn polygon_centroid(verts: &[(f64, f64)]) -> (f64, f64) {
    let n = verts.len() as f64;
    if n < 1.0 {
        return (0.0, 0.0);
    }
    let sx: f64 = verts.iter().map(|v| v.0).sum();
    let sy: f64 = verts.iter().map(|v| v.1).sum();
    (sx / n, sy / n)
}

/// Duzenlilik skoru 0..1 (1 = duzgun N-gen: esit kenar + esit aci).
pub fn regularity(verts: &[(f64, f64)]) -> f64 {
    let n = verts.len();
    if n < 3 {
        return 0.0;
    }
    let mut edges = Vec::with_capacity(n);
    for i in 0..n {
        let a = verts[i];
        let b = verts[(i + 1) % n];
        edges.push(((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt());
    }
    let edge_mean = edges.iter().sum::<f64>() / n as f64;
    if edge_mean < 1e-9 {
        return 0.0;
    }
    let edge_var = edges.iter().map(|e| (e - edge_mean).powi(2)).sum::<f64>() / n as f64;
    let edge_cv = edge_var.sqrt() / edge_mean;

    let mut angles = Vec::with_capacity(n);
    for i in 0..n {
        let prev = verts[(i + n - 1) % n];
        let curr = verts[i];
        let next = verts[(i + 1) % n];
        let v1 = (prev.0 - curr.0, prev.1 - curr.1);
        let v2 = (next.0 - curr.0, next.1 - curr.1);
        let dot = v1.0 * v2.0 + v1.1 * v2.1;
        let cross = v1.0 * v2.1 - v1.1 * v2.0;
        angles.push(cross.atan2(dot).abs());
    }
    let angle_mean = angles.iter().sum::<f64>() / n as f64;
    if angle_mean < 1e-9 {
        return 0.0;
    }
    let angle_var = angles.iter().map(|a| (a - angle_mean).powi(2)).sum::<f64>() / n as f64;
    let angle_cv = angle_var.sqrt() / angle_mean;

    (-2.0 * (edge_cv + angle_cv)).exp().clamp(0.0, 1.0)
}

/// Tikizlik (izoperimetrik oran): 4π·alan/cevre². Daire=1, duzensiz<1.
pub fn compactness(area: f64, perimeter: f64) -> f64 {
    if perimeter < 1e-9 || area < 1e-9 {
        return 0.0;
    }
    (4.0 * std::f64::consts::PI * area / (perimeter * perimeter)).clamp(0.0, 1.0)
}

/// Convex hull — Andrew monotone chain, O(n log n), saat-yonu-tersi sira.
pub fn convex_hull(points: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut pts = points.to_vec();
    pts.sort_by(|a, b| {
        a.0.partial_cmp(&b.0)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
    });
    pts.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-12 && (a.1 - b.1).abs() < 1e-12);

    let n = pts.len();
    if n <= 2 {
        return pts;
    }
    let cross = |o: &(f64, f64), a: &(f64, f64), b: &(f64, f64)| -> f64 {
        (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
    };

    let mut hull: Vec<(f64, f64)> = Vec::with_capacity(2 * n);
    for p in &pts {
        while hull.len() >= 2 && cross(&hull[hull.len() - 2], &hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(*p);
    }
    let lower_len = hull.len() + 1;
    for p in pts.iter().rev() {
        while hull.len() >= lower_len && cross(&hull[hull.len() - 2], &hull[hull.len() - 1], p) <= 0.0
        {
            hull.pop();
        }
        hull.push(*p);
    }
    hull.pop();
    hull
}

/// Doluluk: alan / convex_hull_alani. Convex=1, concave<1.
pub fn solidity(verts: &[(f64, f64)], area: f64) -> f64 {
    if area < 1e-9 || verts.len() < 3 {
        return 0.0;
    }
    let hull = convex_hull(verts);
    if hull.len() < 3 {
        return 0.0;
    }
    let hull_area = polygon_area(&hull);
    if hull_area < 1e-9 {
        return 0.0;
    }
    (area / hull_area).clamp(0.0, 1.0)
}

/// Dikdortgensellik: alan / (bbox_w × bbox_h). Tam dikdortgen=1.
pub fn rectangularity(area: f64, bbox_w: f64, bbox_h: f64) -> f64 {
    let bbox_area = bbox_w * bbox_h;
    if bbox_area < 1e-9 || area < 1e-9 {
        return 0.0;
    }
    (area / bbox_area).clamp(0.0, 1.0)
}

/// Kapali poligonun [`ShapeFeatures`]'ini hesapla (DXF + shape-match ortak cikti).
pub fn shape_features(verts: &[(f64, f64)]) -> ShapeFeatures {
    let area = polygon_area(verts);
    let perimeter = polygon_perimeter(verts, true);
    let (bbox_w, bbox_h) = polygon_bbox(verts);
    let aspect_ratio = if bbox_h > 1e-9 { bbox_w / bbox_h } else { 0.0 };
    ShapeFeatures {
        area,
        perimeter,
        aspect_ratio,
        regularity: regularity(verts),
        compactness: compactness(area, perimeter),
        solidity: solidity(verts, area),
        rectangularity: rectangularity(area, bbox_w, bbox_h),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn area_triangle_and_winding() {
        let tri = [(0.0, 0.0), (4.0, 0.0), (2.0, 3.0)];
        assert!(approx(polygon_area(&tri), 6.0));
        // CCW vs CW → ayni mutlak alan.
        let ccw = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)];
        let cw = [(0.0, 0.0), (0.0, 2.0), (2.0, 2.0), (2.0, 0.0)];
        assert!(approx(polygon_area(&ccw), 4.0));
        assert!(approx(polygon_area(&cw), 4.0));
    }

    #[test]
    fn regularity_square_vs_rectangle() {
        let sq = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        let rect = [(0.0, 0.0), (10.0, 0.0), (10.0, 1.0), (0.0, 1.0)];
        assert!(regularity(&sq) > 0.95);
        assert!(regularity(&rect) < 0.8);
    }

    #[test]
    fn convex_hull_of_square_with_inner_point() {
        let pts = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0), (1.0, 1.0)];
        let hull = convex_hull(&pts);
        assert_eq!(hull.len(), 4, "ic nokta hull'a girmemeli");
        assert!(approx(polygon_area(&hull), 4.0));
    }

    #[test]
    fn shape_features_square() {
        let sq = [(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)];
        let f = shape_features(&sq);
        assert!(approx(f.area, 4.0));
        assert!(approx(f.aspect_ratio, 1.0));
        assert!(approx(f.rectangularity, 1.0)); // tam dikdortgen
        assert!(approx(f.solidity, 1.0)); // convex
        assert!(f.compactness > 0.7 && f.compactness <= 1.0);
    }
}
