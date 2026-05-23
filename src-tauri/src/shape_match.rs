//! Görsel Şekil Eşleştirme — Faz 4.3
//!
//! Kullanıcının yüklediği bir görselden dominant kapalı konturu çıkarır,
//! DxfShape özelliklerine dönüştürür ve `dwg_shapes` tablosundaki şekillerle
//! eşleştirmeye hazırlar.
//!
//! Pipeline: Load → Grayscale → Otsu Threshold → Border Trace → RDP Simplify → Features

use image::DynamicImage;
use serde::Serialize;
use crate::dxf_parse::DxfShape;

// ─── Otsu Threshold ──────────────────────────────────────────────────────────

/// Otsu's method — optimal threshold that maximizes inter-class variance.
fn otsu_threshold(gray: &[u8], width: u32, height: u32) -> u8 {
    let total = (width * height) as f64;
    if total == 0.0 { return 128; }

    let mut hist = [0u32; 256];
    for &px in gray.iter() {
        hist[px as usize] += 1;
    }

    let mut sum_all: f64 = 0.0;
    for (i, &count) in hist.iter().enumerate() {
        sum_all += i as f64 * count as f64;
    }

    let mut best_thresh: u8 = 0;
    let mut best_var: f64 = 0.0;
    let mut w_bg: f64 = 0.0;
    let mut sum_bg: f64 = 0.0;

    for (t, &count) in hist.iter().enumerate() {
        w_bg += count as f64;
        if w_bg == 0.0 { continue; }
        let w_fg = total - w_bg;
        if w_fg == 0.0 { break; }

        sum_bg += t as f64 * count as f64;
        let mean_bg = sum_bg / w_bg;
        let mean_fg = (sum_all - sum_bg) / w_fg;
        let between = w_bg * w_fg * (mean_bg - mean_fg).powi(2);

        if between > best_var {
            best_var = between;
            best_thresh = t as u8;
        }
    }
    best_thresh
}

// ─── Border Tracing (Moore Neighborhood) ─────────────────────────────────────

/// Simple contour tracer: finds the largest closed contour in a binary image.
/// Returns pixel coordinates of the contour boundary.
fn trace_largest_contour(binary: &[u8], w: u32, h: u32) -> Vec<(f64, f64)> {
    let w = w as usize;
    let h = h as usize;
    let is_fg = |x: usize, y: usize| -> bool {
        x < w && y < h && binary[y * w + x] > 0
    };

    // Moore neighborhood (clockwise from right)
    const DX: [i32; 8] = [1, 1, 0, -1, -1, -1, 0, 1];
    const DY: [i32; 8] = [0, 1, 1, 1, 0, -1, -1, -1];

    let mut visited = vec![false; w * h];
    let mut best_contour: Vec<(f64, f64)> = Vec::new();

    // Scan for starting points (top-to-bottom, left-to-right)
    for sy in 0..h {
        for sx in 0..w {
            if !is_fg(sx, sy) || visited[sy * w + sx] { continue; }
            // Must be a border pixel (has at least one bg neighbor or at image edge)
            let on_edge = sx == 0 || sy == 0 || sx == w - 1 || sy == h - 1;
            let has_bg_nbr = DX.iter().zip(DY.iter()).any(|(&dx, &dy)| {
                let nx = sx as i32 + dx;
                let ny = sy as i32 + dy;
                nx < 0 || ny < 0 || !is_fg(nx as usize, ny as usize)
            });
            if !on_edge && !has_bg_nbr { continue; }

            // Trace contour using Moore neighbor tracing
            let mut contour: Vec<(f64, f64)> = Vec::new();
            let mut cx = sx;
            let mut cy = sy;
            // Start direction: come from left (direction index 0 = right)
            let mut dir: usize = 6; // start scanning from "up" direction
            let start = (sx, sy);
            let mut steps = 0;
            let max_steps = w * h * 2; // safety limit

            loop {
                contour.push((cx as f64, cy as f64));
                visited[cy * w + cx] = true;
                let mut found = false;
                // Search clockwise starting from (dir + 5) % 8 (= dir - 3)
                let scan_start = (dir + 5) % 8;
                for k in 0..8 {
                    let d = (scan_start + k) % 8;
                    let nx = cx as i32 + DX[d];
                    let ny = cy as i32 + DY[d];
                    if nx >= 0 && ny >= 0 && is_fg(nx as usize, ny as usize) {
                        cx = nx as usize;
                        cy = ny as usize;
                        dir = d;
                        found = true;
                        break;
                    }
                }
                steps += 1;
                if !found || (cx == start.0 && cy == start.1) || steps > max_steps {
                    break;
                }
            }

            if contour.len() > best_contour.len() {
                best_contour = contour;
            }
        }
    }

    best_contour
}

// ─── Ramer-Douglas-Peucker Simplification ────────────────────────────────────

fn perpendicular_distance(px: f64, py: f64, lx1: f64, ly1: f64, lx2: f64, ly2: f64) -> f64 {
    let dx = lx2 - lx1;
    let dy = ly2 - ly1;
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-12 {
        return ((px - lx1).powi(2) + (py - ly1).powi(2)).sqrt();
    }
    ((dy * px - dx * py + lx2 * ly1 - ly2 * lx1).abs()) / len_sq.sqrt()
}

fn rdp_simplify_open(points: &[(f64, f64)], epsilon: f64) -> Vec<(f64, f64)> {
    let n = points.len();
    if n <= 2 { return points.to_vec(); }

    let (lx1, ly1) = points[0];
    let (lx2, ly2) = points[n - 1];

    let mut max_dist: f64 = 0.0;
    let mut max_idx: usize = 0;
    for (i, pt) in points.iter().enumerate().skip(1).take(n - 2) {
        let d = perpendicular_distance(pt.0, pt.1, lx1, ly1, lx2, ly2);
        if d > max_dist {
            max_dist = d;
            max_idx = i;
        }
    }

    if max_dist > epsilon {
        let mut left = rdp_simplify_open(&points[..=max_idx], epsilon);
        let right = rdp_simplify_open(&points[max_idx..], epsilon);
        left.pop(); // remove duplicate junction point
        left.extend(right);
        left
    } else {
        vec![points[0], points[n - 1]]
    }
}

/// Closed-contour-aware RDP: splits the contour at the two farthest points,
/// simplifies each half independently, then merges — avoids the spurious
/// first/last vertex duplication that open RDP causes on closed polygons.
fn rdp_simplify_closed(points: &[(f64, f64)], epsilon: f64) -> Vec<(f64, f64)> {
    let n = points.len();
    if n <= 3 { return points.to_vec(); }

    // Find the two points farthest apart (diameter)
    let mut best_d: f64 = 0.0;
    let mut idx_a: usize = 0;
    let mut idx_b: usize = 0;
    // Sample for large contours to keep O(n)
    let step = if n > 2000 { n / 500 } else { 1 };
    for i in (0..n).step_by(step.max(1)) {
        for j in (i + 1..n).step_by(step.max(1)) {
            let dx = points[i].0 - points[j].0;
            let dy = points[i].1 - points[j].1;
            let d = dx * dx + dy * dy;
            if d > best_d {
                best_d = d;
                idx_a = i;
                idx_b = j;
            }
        }
    }
    if idx_a > idx_b { std::mem::swap(&mut idx_a, &mut idx_b); }

    // Split into two chains: a→b and b→a (wrapping)
    let chain1: Vec<(f64, f64)> = points[idx_a..=idx_b].to_vec();
    let mut chain2: Vec<(f64, f64)> = points[idx_b..].to_vec();
    chain2.extend_from_slice(&points[..=idx_a]);

    let mut s1 = rdp_simplify_open(&chain1, epsilon);
    let mut s2 = rdp_simplify_open(&chain2, epsilon);

    // Remove duplicate junction points
    if s1.len() > 1 { s1.pop(); } // last of s1 == first of s2
    if s2.len() > 1 { s2.pop(); } // last of s2 == first of s1

    s1.extend(s2);
    s1
}

// ─── Shape Feature Computation (shared with dxf_parse.rs logic) ──────────────

fn compute_area(verts: &[(f64, f64)]) -> f64 {
    let n = verts.len();
    if n < 3 { return 0.0; }
    let mut sum = 0.0;
    for i in 0..n {
        let (x1, y1) = verts[i];
        let (x2, y2) = verts[(i + 1) % n];
        sum += x1 * y2 - x2 * y1;
    }
    (sum / 2.0).abs()
}

fn compute_perimeter(verts: &[(f64, f64)]) -> f64 {
    let n = verts.len();
    if n < 2 { return 0.0; }
    let mut sum = 0.0;
    for i in 0..n {
        let (x1, y1) = verts[i];
        let (x2, y2) = verts[(i + 1) % n];
        sum += ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
    }
    sum
}

fn compute_bbox(verts: &[(f64, f64)]) -> (f64, f64) {
    if verts.is_empty() { return (0.0, 0.0); }
    let min_x = verts.iter().map(|v| v.0).fold(f64::INFINITY, f64::min);
    let max_x = verts.iter().map(|v| v.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = verts.iter().map(|v| v.1).fold(f64::INFINITY, f64::min);
    let max_y = verts.iter().map(|v| v.1).fold(f64::NEG_INFINITY, f64::max);
    (max_x - min_x, max_y - min_y)
}

fn compute_regularity(verts: &[(f64, f64)]) -> f64 {
    let n = verts.len();
    if n < 3 { return 0.0; }
    let mut edges = Vec::with_capacity(n);
    for i in 0..n {
        let a = verts[i];
        let b = verts[(i + 1) % n];
        edges.push(((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt());
    }
    let edge_mean = edges.iter().sum::<f64>() / n as f64;
    if edge_mean < 1e-9 { return 0.0; }
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
    if angle_mean < 1e-9 { return 0.0; }
    let angle_var = angles.iter().map(|a| (a - angle_mean).powi(2)).sum::<f64>() / n as f64;
    let angle_cv = angle_var.sqrt() / angle_mean;

    (-2.0 * (edge_cv + angle_cv)).exp().clamp(0.0, 1.0)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/// Result returned by extract_shape_from_image.
#[derive(Debug, Clone, Serialize)]
pub struct ImageShapeResult {
    pub shape: DxfShape,
    pub contour_point_count: usize,   // pre-simplification pixel count
    pub simplified_point_count: usize, // post-RDP vertex count
    pub image_width: u32,
    pub image_height: u32,
}

/// Core pipeline: DynamicImage → contour → RDP simplify → shape features
fn extract_shape_from_dynamic_image(img: DynamicImage) -> Result<ImageShapeResult, String> {

    let gray = img.to_luma8();
    let (w, h) = (gray.width(), gray.height());
    let pixels = gray.as_raw();

    // Otsu threshold
    let thresh = otsu_threshold(pixels, w, h);

    // Binarize: foreground = dark pixels (drawings are typically dark on white)
    // If mean intensity < 128 (dark image), invert logic
    let mean_intensity: f64 = pixels.iter().map(|&p| p as f64).sum::<f64>() / pixels.len() as f64;
    let binary: Vec<u8> = if mean_intensity >= 128.0 {
        // Light background, dark shapes → below threshold = foreground
        pixels.iter().map(|&p| if p <= thresh { 255 } else { 0 }).collect()
    } else {
        // Dark background, light shapes → above threshold = foreground
        pixels.iter().map(|&p| if p > thresh { 255 } else { 0 }).collect()
    };

    // Trace largest contour
    let contour = trace_largest_contour(&binary, w, h);
    if contour.len() < 3 {
        return Err("Görselde yeterli kontur bulunamadı (en az 3 nokta gerekli)".into());
    }

    // RDP simplification — epsilon = %1.5 of max dimension
    // Use closed-contour-aware RDP to avoid spurious duplicate vertices
    let max_dim = w.max(h) as f64;
    let epsilon = max_dim * 0.015;
    let simplified = rdp_simplify_closed(&contour, epsilon);

    if simplified.len() < 3 {
        return Err("Kontur basitleştirme sonrası yeterli vertex kalmadı".into());
    }

    // Compute shape features
    let area = compute_area(&simplified);
    let perimeter = compute_perimeter(&simplified);
    let (bbox_w, bbox_h) = compute_bbox(&simplified);
    let aspect_ratio = if bbox_h > 1e-9 { bbox_w / bbox_h } else { 0.0 };
    let regularity = compute_regularity(&simplified);
    let n = simplified.len() as f64;
    let cx: f64 = simplified.iter().map(|v| v.0).sum::<f64>() / n;
    let cy: f64 = simplified.iter().map(|v| v.1).sum::<f64>() / n;

    // Faz 4.4 — gelişmiş geometrik özellikler
    let compactness = if perimeter > 1e-9 {
        (4.0 * std::f64::consts::PI * area / (perimeter * perimeter)).clamp(0.0, 1.0)
    } else { 0.0 };

    let hull = crate::dxf_parse::convex_hull(&simplified);
    let hull_area = crate::shape_match::compute_area(&hull);
    let solidity = if hull_area > 1e-9 { (area / hull_area).clamp(0.0, 1.0) } else { 0.0 };

    let bbox_area = bbox_w * bbox_h;
    let rectangularity = if bbox_area > 1e-9 { (area / bbox_area).clamp(0.0, 1.0) } else { 0.0 };

    let shape = DxfShape {
        entity_type: "IMAGE_CONTOUR".to_string(),
        layer_name: String::new(),
        vertex_count: simplified.len() as u32,
        is_closed: true,
        area,
        perimeter,
        aspect_ratio,
        regularity,
        bbox_w,
        bbox_h,
        centroid_x: cx,
        centroid_y: cy,
        compactness,
        solidity,
        rectangularity,
    };

    Ok(ImageShapeResult {
        contour_point_count: contour.len(),
        simplified_point_count: simplified.len(),
        image_width: w,
        image_height: h,
        shape,
    })
}

/// Extracts shape from an image file path.
#[tauri::command]
pub fn extract_shape_from_image(image_path: String) -> Result<ImageShapeResult, String> {
    let img = image::open(&image_path)
        .map_err(|e| format!("Görsel yüklenemedi: {e}"))?;
    extract_shape_from_dynamic_image(img)
}

/// Extracts shape from raw image bytes (PNG/JPG/BMP/TIFF).
#[tauri::command]
pub fn extract_shape_from_image_bytes(image_data: Vec<u8>) -> Result<ImageShapeResult, String> {
    let img = image::load_from_memory(&image_data)
        .map_err(|e| format!("Görsel decode edilemedi: {e}"))?;
    extract_shape_from_dynamic_image(img)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_otsu_uniform() {
        // All black → threshold should be 0
        let pixels = vec![0u8; 100];
        let t = otsu_threshold(&pixels, 10, 10);
        assert!(t < 10);
    }

    #[test]
    fn test_otsu_bimodal() {
        // Realistic bimodal: dark cluster ~50, light cluster ~200
        let mut pixels = Vec::with_capacity(100);
        for _ in 0..50 { pixels.push(50); }
        for _ in 0..50 { pixels.push(200); }
        let t = otsu_threshold(&pixels, 10, 10);
        // Threshold should fall between the two clusters
        assert!(t >= 50 && t <= 200, "Otsu threshold {t} should be between 50 and 200");
    }

    #[test]
    fn test_rdp_line() {
        // Collinear points → simplifies to 2
        let pts = vec![(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)];
        let result = rdp_simplify_open(&pts, 0.1);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_rdp_square() {
        // Square vertices → all kept (corners are far from line)
        let pts = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        let result = rdp_simplify_open(&pts, 0.5);
        assert_eq!(result.len(), 4);
    }

    #[test]
    fn test_rdp_closed_triangle() {
        // Simulate a closed triangle contour (many points along 3 edges)
        let mut pts: Vec<(f64, f64)> = Vec::new();
        // Edge 1: (0,0) → (100,0)
        for i in 0..=50 { pts.push((i as f64 * 2.0, 0.0)); }
        // Edge 2: (100,0) → (50,86)
        for i in 1..=50 { let t = i as f64 / 50.0; pts.push((100.0 - 50.0 * t, 86.6 * t)); }
        // Edge 3: (50,86) → (0,0)
        for i in 1..50 { let t = i as f64 / 50.0; pts.push((50.0 - 50.0 * t, 86.6 * (1.0 - t))); }
        let result = rdp_simplify_closed(&pts, 1.5);
        assert_eq!(result.len(), 3, "Closed triangle should have 3 vertices, got {}", result.len());
    }

    #[test]
    fn test_rdp_closed_square() {
        // Simulate a closed square contour
        let mut pts: Vec<(f64, f64)> = Vec::new();
        for i in 0..=50 { pts.push((i as f64 * 2.0, 0.0)); }       // bottom
        for i in 1..=50 { pts.push((100.0, i as f64 * 2.0)); }     // right
        for i in 1..=50 { pts.push((100.0 - i as f64 * 2.0, 100.0)); } // top
        for i in 1..50 { pts.push((0.0, 100.0 - i as f64 * 2.0)); }    // left
        let result = rdp_simplify_closed(&pts, 1.5);
        assert_eq!(result.len(), 4, "Closed square should have 4 vertices, got {}", result.len());
    }

    #[test]
    fn test_regularity_square() {
        let sq = vec![(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
        let r = compute_regularity(&sq);
        assert!(r > 0.95, "Square regularity should be near 1.0, got {r}");
    }

    #[test]
    fn test_regularity_rectangle() {
        // Elongated rectangle — edges differ, so regularity < square
        let rect = vec![(0.0, 0.0), (10.0, 0.0), (10.0, 1.0), (0.0, 1.0)];
        let r = compute_regularity(&rect);
        assert!(r < 0.8, "Elongated rectangle regularity should be lower, got {r}");
    }

    #[test]
    fn test_area_triangle() {
        let tri = vec![(0.0, 0.0), (4.0, 0.0), (2.0, 3.0)];
        let a = compute_area(&tri);
        assert!((a - 6.0).abs() < 0.01, "Triangle area should be 6, got {a}");
    }

    #[test]
    fn test_trace_empty_image() {
        let binary = vec![0u8; 25]; // 5x5 all black (no foreground)
        let contour = trace_largest_contour(&binary, 5, 5);
        assert!(contour.is_empty());
    }

    #[test]
    fn test_trace_filled_square() {
        // 10x10 image with 6x6 white square in center
        let mut binary = vec![0u8; 100];
        for y in 2..8 {
            for x in 2..8 {
                binary[y * 10 + x] = 255;
            }
        }
        let contour = trace_largest_contour(&binary, 10, 10);
        assert!(contour.len() >= 4, "Should trace square border, got {} points", contour.len());
    }
}
