//! Gorsel sekil cikarimi — yuklenen bir gorselden baskin kapali konturu cikarir
//! ([`archivist_extract::ShapeFeatures`]'e cevirir). Faz 4.3 sekil-aramasinin girdisi.
//!
//! H2 `shape_match.rs`'ten nakil. Pipeline: gri → Otsu esik → Moore kontur izleme →
//! RDP basitlestirme → core geometri (`shape_features`). **Extractor DEGIL** (dosya
//! indeksleme degil, sorgu-ani sekil arama yardimcisi).

use archivist_extract::{geometry, ShapeFeatures};
use image::DynamicImage;

/// Gorsel sekil cikarim sonucu.
#[derive(Debug, Clone)]
pub struct ImageShapeResult {
    /// core ShapeFeatures (alan, cevre, aspect, regularity, compactness, solidity, rect).
    pub features: ShapeFeatures,
    /// Basitlestirme oncesi piksel sayisi.
    pub contour_point_count: usize,
    /// RDP sonrasi vertex sayisi.
    pub simplified_point_count: usize,
    pub image_width: u32,
    pub image_height: u32,
}

/// Gorsel dosyadan sekil cikar.
pub fn extract_shape_from_path(path: &std::path::Path) -> Result<ImageShapeResult, String> {
    let img = image::open(path).map_err(|e| format!("gorsel yuklenemedi: {e}"))?;
    extract_shape(img)
}

/// Ham baytlardan sekil cikar (PNG/JPG/BMP/TIFF).
pub fn extract_shape_from_bytes(bytes: &[u8]) -> Result<ImageShapeResult, String> {
    let img = image::load_from_memory(bytes).map_err(|e| format!("gorsel decode edilemedi: {e}"))?;
    extract_shape(img)
}

/// Cekirdek pipeline: DynamicImage → kontur → RDP → ShapeFeatures.
pub fn extract_shape(img: DynamicImage) -> Result<ImageShapeResult, String> {
    let gray = img.to_luma8();
    let (w, h) = (gray.width(), gray.height());
    let pixels = gray.as_raw();

    let thresh = otsu_threshold(pixels);

    // Cizimler genelde acik zeminde koyu → esigin altindakiler on-plan; koyu zeminde tersi.
    let mean: f64 = pixels.iter().map(|&p| f64::from(p)).sum::<f64>() / pixels.len().max(1) as f64;
    let binary: Vec<u8> = if mean >= 128.0 {
        pixels.iter().map(|&p| u8::from(p <= thresh) * 255).collect()
    } else {
        pixels.iter().map(|&p| u8::from(p > thresh) * 255).collect()
    };

    let contour = trace_largest_contour(&binary, w, h);
    if contour.len() < 3 {
        return Err("gorselde yeterli kontur yok (en az 3 nokta)".into());
    }

    let epsilon = f64::from(w.max(h)) * 0.015;
    let simplified = rdp_simplify_closed(&contour, epsilon);
    if simplified.len() < 3 {
        return Err("basitlestirme sonrasi yeterli vertex kalmadi".into());
    }

    Ok(ImageShapeResult {
        features: geometry::shape_features(&simplified),
        contour_point_count: contour.len(),
        simplified_point_count: simplified.len(),
        image_width: w,
        image_height: h,
    })
}

/// Otsu yontemi — siniflar-arasi varyansi maksimize eden esik.
fn otsu_threshold(gray: &[u8]) -> u8 {
    let total = gray.len() as f64;
    if total == 0.0 {
        return 128;
    }
    let mut hist = [0u32; 256];
    for &px in gray {
        hist[px as usize] += 1;
    }
    let sum_all: f64 = hist.iter().enumerate().map(|(i, &c)| i as f64 * f64::from(c)).sum();

    let mut best_thresh = 0u8;
    let mut best_var = 0.0;
    let mut w_bg = 0.0;
    let mut sum_bg = 0.0;
    for (t, &count) in hist.iter().enumerate() {
        w_bg += f64::from(count);
        if w_bg == 0.0 {
            continue;
        }
        let w_fg = total - w_bg;
        if w_fg == 0.0 {
            break;
        }
        sum_bg += t as f64 * f64::from(count);
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

/// İkili gorseldeki en buyuk kapali konturu Moore-komsulukla izle.
fn trace_largest_contour(binary: &[u8], w: u32, h: u32) -> Vec<(f64, f64)> {
    let w = w as usize;
    let h = h as usize;
    let is_fg = |x: usize, y: usize| x < w && y < h && binary[y * w + x] > 0;

    const DX: [i32; 8] = [1, 1, 0, -1, -1, -1, 0, 1];
    const DY: [i32; 8] = [0, 1, 1, 1, 0, -1, -1, -1];

    let mut visited = vec![false; w * h];
    let mut best: Vec<(f64, f64)> = Vec::new();

    for sy in 0..h {
        for sx in 0..w {
            if !is_fg(sx, sy) || visited[sy * w + sx] {
                continue;
            }
            let on_edge = sx == 0 || sy == 0 || sx == w - 1 || sy == h - 1;
            let has_bg_nbr = DX.iter().zip(DY.iter()).any(|(&dx, &dy)| {
                let nx = sx as i32 + dx;
                let ny = sy as i32 + dy;
                nx < 0 || ny < 0 || !is_fg(nx as usize, ny as usize)
            });
            if !on_edge && !has_bg_nbr {
                continue;
            }

            let mut contour: Vec<(f64, f64)> = Vec::new();
            let (mut cx, mut cy) = (sx, sy);
            let mut dir = 6usize;
            let start = (sx, sy);
            let mut steps = 0;
            let max_steps = w * h * 2;
            loop {
                contour.push((cx as f64, cy as f64));
                visited[cy * w + cx] = true;
                let mut found = false;
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
            if contour.len() > best.len() {
                best = contour;
            }
        }
    }
    best
}

fn perpendicular_distance(px: f64, py: f64, lx1: f64, ly1: f64, lx2: f64, ly2: f64) -> f64 {
    let dx = lx2 - lx1;
    let dy = ly2 - ly1;
    let len_sq = dx * dx + dy * dy;
    if len_sq < 1e-12 {
        return ((px - lx1).powi(2) + (py - ly1).powi(2)).sqrt();
    }
    (dy * px - dx * py + lx2 * ly1 - ly2 * lx1).abs() / len_sq.sqrt()
}

fn rdp_simplify_open(points: &[(f64, f64)], epsilon: f64) -> Vec<(f64, f64)> {
    let n = points.len();
    if n <= 2 {
        return points.to_vec();
    }
    let (lx1, ly1) = points[0];
    let (lx2, ly2) = points[n - 1];

    let mut max_dist = 0.0;
    let mut max_idx = 0;
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
        left.pop();
        left.extend(right);
        left
    } else {
        vec![points[0], points[n - 1]]
    }
}

/// Kapali-kontur-farkindali RDP: en uzak iki noktada bol, her yariyi ayri
/// basitlestir, birlestir — acik RDP'nin sahte ilk/son vertex tekrarini onler.
fn rdp_simplify_closed(points: &[(f64, f64)], epsilon: f64) -> Vec<(f64, f64)> {
    let n = points.len();
    if n <= 3 {
        return points.to_vec();
    }
    let mut best_d = 0.0;
    let mut idx_a = 0;
    let mut idx_b = 0;
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
    if idx_a > idx_b {
        std::mem::swap(&mut idx_a, &mut idx_b);
    }

    let chain1: Vec<(f64, f64)> = points[idx_a..=idx_b].to_vec();
    let mut chain2: Vec<(f64, f64)> = points[idx_b..].to_vec();
    chain2.extend_from_slice(&points[..=idx_a]);

    let mut s1 = rdp_simplify_open(&chain1, epsilon);
    let mut s2 = rdp_simplify_open(&chain2, epsilon);
    if s1.len() > 1 {
        s1.pop();
    }
    if s2.len() > 1 {
        s2.pop();
    }
    s1.extend(s2);
    s1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn otsu_uniform_and_bimodal() {
        assert!(otsu_threshold(&[0u8; 100]) < 10);
        let mut px = vec![50u8; 50];
        px.extend(vec![200u8; 50]);
        let t = otsu_threshold(&px);
        assert!((50..=200).contains(&t));
    }

    #[test]
    fn rdp_open_line_and_square() {
        let line = [(0.0, 0.0), (1.0, 0.0), (2.0, 0.0), (3.0, 0.0)];
        assert_eq!(rdp_simplify_open(&line, 0.1).len(), 2);
        let sq = [(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)];
        assert_eq!(rdp_simplify_open(&sq, 0.5).len(), 4);
    }

    #[test]
    fn rdp_closed_triangle_and_square() {
        let mut tri: Vec<(f64, f64)> = Vec::new();
        for i in 0..=50 {
            tri.push((f64::from(i) * 2.0, 0.0));
        }
        for i in 1..=50 {
            let t = f64::from(i) / 50.0;
            tri.push((100.0 - 50.0 * t, 86.6 * t));
        }
        for i in 1..50 {
            let t = f64::from(i) / 50.0;
            tri.push((50.0 - 50.0 * t, 86.6 * (1.0 - t)));
        }
        assert_eq!(rdp_simplify_closed(&tri, 1.5).len(), 3);

        let mut sq: Vec<(f64, f64)> = Vec::new();
        for i in 0..=50 {
            sq.push((f64::from(i) * 2.0, 0.0));
        }
        for i in 1..=50 {
            sq.push((100.0, f64::from(i) * 2.0));
        }
        for i in 1..=50 {
            sq.push((100.0 - f64::from(i) * 2.0, 100.0));
        }
        for i in 1..50 {
            sq.push((0.0, 100.0 - f64::from(i) * 2.0));
        }
        assert_eq!(rdp_simplify_closed(&sq, 1.5).len(), 4);
    }

    #[test]
    fn trace_empty_and_filled_square() {
        assert!(trace_largest_contour(&[0u8; 25], 5, 5).is_empty());
        let mut binary = vec![0u8; 100];
        for y in 2..8 {
            for x in 2..8 {
                binary[y * 10 + x] = 255;
            }
        }
        assert!(trace_largest_contour(&binary, 10, 10).len() >= 4);
    }

    #[test]
    fn full_pipeline_on_synthetic_square() {
        // 40×40 beyaz zemin, ortada 20×20 siyah kare → kontur → ~kare ShapeFeatures.
        let mut img = image::GrayImage::from_pixel(40, 40, image::Luma([255]));
        for y in 10..30 {
            for x in 10..30 {
                img.put_pixel(x, y, image::Luma([0]));
            }
        }
        let res = extract_shape(DynamicImage::ImageLuma8(img)).unwrap();
        assert_eq!(res.simplified_point_count, 4, "kare 4 vertex vermeli");
        assert!(res.features.rectangularity > 0.85, "rect: {}", res.features.rectangularity);
        assert!((res.features.aspect_ratio - 1.0).abs() < 0.2);
    }
}
