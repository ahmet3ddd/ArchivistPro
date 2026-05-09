use base64::{engine::general_purpose, Engine as _};
use serde::Serialize;
use std::fs;
use std::io::{Read, BufReader};
use sha2::{Sha256, Digest};
use crate::thumb_util;

/// Dosya içeriğinin SHA-256 hash'ini hesaplar (büyük dosyalar için akış tabanlı).
/// İlk 32 hex karakteri döner (128-bit — çakışma olasılığı ihmal edilebilir).
#[tauri::command]
pub fn compute_file_hash(path: String) -> Result<String, String> {
    let file = std::fs::File::open(&path).map_err(|e| format!("Dosya açılamadı: {}", e))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536]; // 64 KB parça
    loop {
        let n = reader.read(&mut buffer).map_err(|e| format!("Okuma hatası: {}", e))?;
        if n == 0 { break; }
        hasher.update(&buffer[..n]);
    }
    let result = hasher.finalize();
    Ok(format!("{:x}", result)[..32].to_string())
}

#[derive(Serialize)]
pub struct ImageExifData {
    pub is_render: bool,
    pub software: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
}

#[tauri::command]
pub fn get_image_exif(path: String) -> Result<ImageExifData, String> {
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut bufreader = std::io::BufReader::new(file);

    let exif_reader = exif::Reader::new();
    let exif = match exif_reader.read_from_container(&mut bufreader) {
        Ok(e) => e,
        Err(_) => {
            return Ok(ImageExifData {
                is_render: false,
                software: None,
                camera_make: None,
                camera_model: None,
            });
        }
    };

    let mut software: Option<String> = None;
    let mut camera_make: Option<String> = None;
    let mut camera_model: Option<String> = None;

    for field in exif.fields() {
        match field.tag {
            exif::Tag::Software => {
                software = field.display_value().to_string().into();
            }
            exif::Tag::Make => {
                camera_make = field.display_value().to_string().into();
            }
            exif::Tag::Model => {
                camera_model = field.display_value().to_string().into();
            }
            _ => {}
        }
    }

    let render_keywords = [
        "vray", "v-ray", "corona", "lumion", "enscape", "3ds max", "blender",
        "cinema 4d", "maya", "sketchup", "unreal", "unity", "octane", "redshift",
        "arnold", "cycles", "eevee", "keyshot", "twinmotion"
    ];

    let is_render = if let Some(ref sw) = software {
        let sw_lower = sw.to_lowercase();
        render_keywords.iter().any(|kw| sw_lower.contains(kw))
    } else {
        false
    };

    Ok(ImageExifData {
        is_render,
        software,
        camera_make,
        camera_model,
    })
}

/// Returns the pixel dimensions (width, height) of a raster image without
/// fully decoding it.  Uses the image crate's fast header-only reader.
/// For PSD files, reads dimensions directly from the header.
#[tauri::command]
pub fn get_image_dimensions(path: String) -> Result<(u32, u32), String> {
    if path.to_lowercase().ends_with(".psd") {
        let data = fs::read(&path).map_err(|e| e.to_string())?;
        if data.len() < 22 || &data[0..4] != b"8BPS" {
            return Err("Geçersiz PSD dosyası".to_string());
        }
        let height = u32::from_be_bytes([data[14], data[15], data[16], data[17]]);
        let width = u32::from_be_bytes([data[18], data[19], data[20], data[21]]);
        return Ok((width, height));
    }

    image::image_dimensions(&path).map_err(|e| e.to_string())
}

/// sRGB u8 → CIELAB [L*, a*, b*]  (D65 illuminant)
fn srgb_to_lab(r: u8, g: u8, b: u8) -> [f64; 3] {
    // Step 1: sRGB → linear RGB  (IEC 61966-2-1)
    let lin = |c: f64| -> f64 {
        if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) }
    };
    let rl = lin(r as f64 / 255.0);
    let gl = lin(g as f64 / 255.0);
    let bl = lin(b as f64 / 255.0);

    // Step 2: linear RGB → XYZ  (D65 white point matrix)
    let x = rl * 0.412_456_4 + gl * 0.357_576_1 + bl * 0.180_437_5;
    let y = rl * 0.212_672_9 + gl * 0.715_152_2 + bl * 0.072_175_0;
    let z = rl * 0.019_333_9 + gl * 0.119_192_0 + bl * 0.950_304_1;

    // Step 3: XYZ → CIELAB  (D65 reference white: Xn=0.95047, Yn=1.0, Zn=1.08883)
    let f = |t: f64| -> f64 {
        if t > 0.008_856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 }
    };
    let fx = f(x / 0.95047);
    let fy = f(y);            // Yn = 1.0
    let fz = f(z / 1.08883);

    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// CIELAB [L*, a*, b*] → sRGB (u8, u8, u8)
fn lab_to_srgb(lab: &[f64; 3]) -> (u8, u8, u8) {
    // Step 1: CIELAB → XYZ
    let fy = (lab[0] + 16.0) / 116.0;
    let fx = lab[1] / 500.0 + fy;
    let fz = fy - lab[2] / 200.0;

    let cube = |t: f64| -> f64 {
        let t3 = t * t * t;
        if t3 > 0.008_856 { t3 } else { (t - 16.0 / 116.0) / 7.787 }
    };

    let x = cube(fx) * 0.95047;
    let y = cube(fy);
    let z = cube(fz) * 1.08883;

    // Step 2: XYZ → linear RGB  (D65)
    let rl =  x * 3.240_454_2 - y * 1.537_138_5 - z * 0.498_531_4;
    let gl = -x * 0.969_266_0 + y * 1.876_010_8 + z * 0.041_556_0;
    let bl =  x * 0.055_643_4 - y * 0.204_025_9 + z * 1.057_225_2;

    // Step 3: linear RGB → sRGB  (gamma encode)
    let gamma = |c: f64| -> u8 {
        let c = c.clamp(0.0, 1.0);
        let s = if c <= 0.003_130_8 { 12.92 * c } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 };
        (s.clamp(0.0, 1.0) * 255.0).round() as u8
    };
    (gamma(rl), gamma(gl), gamma(bl))
}

/// Karesel CIELAB mesafesi (karekök atlanır — sadece karşılaştırma için)
#[inline]
fn lab_dist_sq(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let dl = a[0] - b[0];
    let da = a[1] - b[1];
    let db = a[2] - b[2];
    dl * dl + da * da + db * db
}

/// K-means clustering (CIELAB uzayında) ile baskın renkleri çıkarır.
/// Başlangıç merkezleri: ilk merkez pixel[0], sonrakiler mevcut merkezlerden
/// en uzak piksel (deterministik K-means++ benzeri).
#[tauri::command]
pub fn get_dominant_colors(
    path: String,
    num_colors: Option<usize>,
) -> Result<Vec<thumb_util::DominantColor>, String> {
    let n = num_colors.unwrap_or(5).clamp(1, 16);

    let img = image::open(&path).map_err(|e| e.to_string())?;
    // 100×100 → 10 000 piksel, K=5, 20 iter = ~1M işlem (< 5 ms)
    let img = img.resize(100, 100, image::imageops::FilterType::Triangle);
    let rgb = img.to_rgb8();
    let total = (rgb.width() * rgb.height()) as usize;
    if total == 0 {
        return Ok(vec![]);
    }

    // Tüm pikselleri CIELAB'a dönüştür
    let pixels: Vec<[f64; 3]> = rgb.pixels()
        .map(|p| srgb_to_lab(p[0], p[1], p[2]))
        .collect();

    // Başlangıç merkezleri: deterministik K-means++ (en büyük D² seçimi)
    let k = n.min(total);
    let mut centroids: Vec<[f64; 3]> = Vec::with_capacity(k);
    centroids.push(pixels[0]);
    for _ in 1..k {
        let max_idx = pixels.iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| {
                let da = centroids.iter()
                    .map(|c| lab_dist_sq(a, c))
                    .fold(f64::MAX, f64::min);
                let db = centroids.iter()
                    .map(|c| lab_dist_sq(b, c))
                    .fold(f64::MAX, f64::min);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
            .unwrap_or(centroids.len() % total);
        centroids.push(pixels[max_idx]);
    }

    // K-means iterasyonu (maks 20 iterasyon veya yakınsama)
    let mut assignments = vec![0usize; total];
    for _iter in 0..20 {
        // Atama adımı
        let mut changed = false;
        for (i, px) in pixels.iter().enumerate() {
            let nearest = centroids.iter()
                .enumerate()
                .min_by(|(_, ca), (_, cb)| {
                    lab_dist_sq(px, ca).partial_cmp(&lab_dist_sq(px, cb))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(j, _)| j)
                .unwrap_or(0);
            if assignments[i] != nearest {
                assignments[i] = nearest;
                changed = true;
            }
        }
        if !changed { break; }

        // Güncelleme adımı: yeni merkezleri hesapla
        let mut sums = vec![[0.0_f64; 3]; k];
        let mut counts = vec![0usize; k];
        for (px, &cluster) in pixels.iter().zip(assignments.iter()) {
            sums[cluster][0] += px[0];
            sums[cluster][1] += px[1];
            sums[cluster][2] += px[2];
            counts[cluster] += 1;
        }
        for j in 0..k {
            if counts[j] > 0 {
                centroids[j][0] = sums[j][0] / counts[j] as f64;
                centroids[j][1] = sums[j][1] / counts[j] as f64;
                centroids[j][2] = sums[j][2] / counts[j] as f64;
            }
        }
    }

    // Küme büyüklüklerini say ve büyükten küçüğe sırala
    let mut cluster_counts = vec![0usize; k];
    for &c in &assignments {
        cluster_counts[c] += 1;
    }
    let mut indexed: Vec<(usize, usize)> = cluster_counts.iter()
        .enumerate()
        .filter(|(_, &cnt)| cnt > 0)
        .map(|(i, &cnt)| (i, cnt))
        .collect();
    indexed.sort_by(|a, b| b.1.cmp(&a.1));

    let result = indexed.iter().take(n).map(|(i, cnt)| {
        let (r, g, b) = lab_to_srgb(&centroids[*i]);
        thumb_util::DominantColor {
            hex: format!("#{:02X}{:02X}{:02X}", r, g, b),
            percentage: (*cnt as f64 / total as f64 * 100.0) as f32,
        }
    }).collect();

    Ok(result)
}

#[allow(clippy::needless_range_loop)]
pub fn compute_phash_bits_from_image(img: image::DynamicImage) -> u64 {
    // pHash pipeline: grayscale -> 32x32 -> 2D-DCT -> top-left 8x8 (DC hariç) median threshold
    let gray = img.resize_exact(32, 32, image::imageops::FilterType::CatmullRom).to_luma8();
    if gray.width() < 32 || gray.height() < 32 {
        return 0; // corrupt/incomplete image — fallback hash
    }

    let mut data = [[0.0_f64; 32]; 32];
    for y in 0..32 {
        for x in 0..32 {
            data[y][x] = gray.get_pixel(x as u32, y as u32)[0] as f64;
        }
    }

    let mut cos_table = [[0.0_f64; 32]; 32];
    for u in 0..32 {
        for x in 0..32 {
            cos_table[u][x] = (((2 * x + 1) as f64 * u as f64 * std::f64::consts::PI) / 64.0).cos();
        }
    }

    let mut dct = [[0.0_f64; 32]; 32];
    for u in 0..32 {
        let cu = if u == 0 { (1.0_f64 / 2.0).sqrt() } else { 1.0 };
        for v in 0..32 {
            let cv = if v == 0 { (1.0_f64 / 2.0).sqrt() } else { 1.0 };
            let mut sum = 0.0_f64;
            for y in 0..32 {
                for x in 0..32 {
                    sum += data[y][x] * cos_table[u][x] * cos_table[v][y];
                }
            }
            dct[u][v] = 0.25 * cu * cv * sum;
        }
    }

    let mut coeffs = Vec::with_capacity(63);
    for u in 0..8 {
        for v in 0..8 {
            if u == 0 && v == 0 {
                continue;
            }
            coeffs.push(dct[u][v]);
        }
    }
    let mut sorted = coeffs.clone();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = sorted[sorted.len() / 2];

    let mut bits = 0u64;
    for (i, val) in coeffs.iter().enumerate() {
        if *val > median {
            bits |= 1u64 << i;
        }
    }
    bits
}

#[tauri::command]
pub fn compute_image_phash(path: String) -> Result<String, String> {
    let img = image::open(&path).map_err(|e| format!("Görsel açılamadı: {}", e))?;
    let bits = compute_phash_bits_from_image(img);
    Ok(format!("{:016x}", bits))
}

#[tauri::command]
pub fn compute_image_phash_from_bytes(base64_data: String) -> Result<String, String> {
    let bytes = general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| format!("Base64 decode hatası: {}", e))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("Görsel decode hatası: {}", e))?;
    let bits = compute_phash_bits_from_image(img);
    Ok(format!("{:016x}", bits))
}

#[tauri::command]
pub fn hamming_distance(hash_a: String, hash_b: String) -> Result<u32, String> {
    if hash_a.len() != 16 || hash_b.len() != 16 {
        return Err("Hash uzunluğu 16 hex karakter olmalı".to_string());
    }
    let a = u64::from_str_radix(&hash_a, 16).map_err(|e| format!("hash_a parse hatası: {}", e))?;
    let b = u64::from_str_radix(&hash_b, 16).map_err(|e| format!("hash_b parse hatası: {}", e))?;
    Ok((a ^ b).count_ones())
}

/* ── Görsel Zengin Metadata ── */

#[derive(Serialize, Default)]
pub struct ImageRichMetadata {
    pub file_size_bytes: u64,
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub color_profile: Option<String>,
    pub bit_depth: Option<u32>,
    pub has_alpha: bool,
    pub software: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub date_taken: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub iso_speed: Option<u32>,
    pub focal_length: Option<String>,
    pub exposure_time: Option<String>,
    pub is_render: bool,
}

/// Görsel dosyadan (JPEG, PNG, BMP, WEBP, TIFF, TGA, EXR, HDR) zengin metadata çıkarır.
#[tauri::command]
pub fn extract_image_metadata(path: String) -> Result<ImageRichMetadata, String> {
    let file_meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let mut meta = ImageRichMetadata {
        file_size_bytes: file_meta.len(),
        ..Default::default()
    };

    // Boyutlar
    if let Ok((w, h)) = get_image_dimensions(path.clone()) {
        meta.width = w;
        meta.height = h;
    }

    // Format tespiti (uzantıdan)
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    meta.format = ext.clone();
    meta.has_alpha = matches!(ext.as_str(), "png" | "webp" | "tga" | "tiff" | "exr");

    // EXIF
    let file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return Ok(meta),
    };
    let mut bufreader = std::io::BufReader::new(file);
    let exif_reader = exif::Reader::new();
    if let Ok(exif) = exif_reader.read_from_container(&mut bufreader) {
        meta.software = exif.get_field(exif::Tag::Software, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string());
        meta.camera_make = exif.get_field(exif::Tag::Make, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string());
        meta.camera_model = exif.get_field(exif::Tag::Model, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string());
        meta.date_taken = exif.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string());
        meta.color_profile = exif.get_field(exif::Tag::ColorSpace, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string());
        meta.focal_length = exif.get_field(exif::Tag::FocalLength, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string());
        meta.exposure_time = exif.get_field(exif::Tag::ExposureTime, exif::In::PRIMARY)
            .map(|f| f.display_value().to_string());

        // ISO
        if let Some(iso_field) = exif.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY) {
            if let Some(val) = iso_field.value.get_uint(0) {
                meta.iso_speed = Some(val);
            }
        }

        // GPS
        if let (Some(lat_field), Some(lat_ref)) = (
            exif.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY),
            exif.get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY),
        ) {
            if let Some(lat) = parse_gps_coord(&lat_field.value, &lat_ref.display_value().to_string()) {
                meta.gps_lat = Some(lat);
            }
        }
        if let (Some(lon_field), Some(lon_ref)) = (
            exif.get_field(exif::Tag::GPSLongitude, exif::In::PRIMARY),
            exif.get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY),
        ) {
            if let Some(lon) = parse_gps_coord(&lon_field.value, &lon_ref.display_value().to_string()) {
                meta.gps_lon = Some(lon);
            }
        }

        // Render tespiti
        let sw = meta.software.as_deref().unwrap_or("").to_lowercase();
        meta.is_render = sw.contains("vray") || sw.contains("corona") || sw.contains("arnold")
            || sw.contains("blender") || sw.contains("3ds max") || sw.contains("cinema 4d")
            || sw.contains("keyshot") || sw.contains("lumion") || sw.contains("enscape")
            || sw.contains("octane") || sw.contains("redshift") || sw.contains("unreal");
    }

    Ok(meta)
}

fn parse_gps_coord(value: &exif::Value, reference: &str) -> Option<f64> {
    match value {
        exif::Value::Rational(ref rationals) if rationals.len() >= 3 => {
            if rationals[0].denom == 0 || rationals[1].denom == 0 || rationals[2].denom == 0 {
                return None;
            }
            let deg = rationals[0].num as f64 / rationals[0].denom as f64;
            let min = rationals[1].num as f64 / rationals[1].denom as f64;
            let sec = rationals[2].num as f64 / rationals[2].denom as f64;
            let mut coord = deg + min / 60.0 + sec / 3600.0;
            if reference.contains('S') || reference.contains('W') {
                coord = -coord;
            }
            Some(coord)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Renk dönüşüm testleri ──────────────────────────────────────────────

    #[test]
    fn test_srgb_to_lab_black() {
        let [l, a, b] = srgb_to_lab(0, 0, 0);
        assert!(l.abs() < 0.01, "Siyah L*≈0, got {l}");
        assert!(a.abs() < 0.01, "Siyah a*≈0, got {a}");
        assert!(b.abs() < 0.01, "Siyah b*≈0, got {b}");
    }

    #[test]
    fn test_srgb_to_lab_white() {
        let [l, a, b] = srgb_to_lab(255, 255, 255);
        assert!((l - 100.0).abs() < 0.01, "Beyaz L*≈100, got {l}");
        assert!(a.abs() < 0.01, "Beyaz a*≈0, got {a}");
        assert!(b.abs() < 0.01, "Beyaz b*≈0, got {b}");
    }

    #[test]
    fn test_lab_roundtrip_red() {
        let lab = srgb_to_lab(255, 0, 0);
        let (r, g, b) = lab_to_srgb(&lab);
        assert_eq!(r, 255);
        assert_eq!(g, 0);
        assert_eq!(b, 0);
    }

    #[test]
    fn test_lab_roundtrip_green() {
        let lab = srgb_to_lab(0, 255, 0);
        let (r, g, b) = lab_to_srgb(&lab);
        assert_eq!(r, 0);
        assert_eq!(g, 255);
        assert_eq!(b, 0);
    }

    #[test]
    fn test_lab_roundtrip_blue() {
        let lab = srgb_to_lab(0, 0, 255);
        let (r, g, b) = lab_to_srgb(&lab);
        assert_eq!(r, 0);
        assert_eq!(g, 0);
        assert_eq!(b, 255);
    }

    #[test]
    fn test_lab_roundtrip_midgray() {
        let lab = srgb_to_lab(128, 128, 128);
        let (r, g, b) = lab_to_srgb(&lab);
        // Gri: R=G=B, ±1 hata payı kabul edilebilir
        assert!((r as i32 - 128).abs() <= 1, "r={r}");
        assert!((g as i32 - 128).abs() <= 1, "g={g}");
        assert!((b as i32 - 128).abs() <= 1, "b={b}");
    }

    #[test]
    fn test_lab_dist_sq_identical() {
        let a = [50.0, 10.0, -5.0];
        assert_eq!(lab_dist_sq(&a, &a), 0.0);
    }

    #[test]
    fn test_lab_dist_sq_known() {
        let a = [0.0, 0.0, 0.0];
        let b = [3.0, 4.0, 0.0];
        assert!((lab_dist_sq(&a, &b) - 25.0).abs() < 1e-10);
    }

    // ── Mevcut testler ────────────────────────────────────────────────────

    #[test]
    fn test_hamming_distance_identical() {
        let result = hamming_distance("abcdef0123456789".into(), "abcdef0123456789".into());
        assert_eq!(result.unwrap(), 0);
    }

    #[test]
    fn test_hamming_distance_opposite() {
        let result = hamming_distance("0000000000000000".into(), "ffffffffffffffff".into());
        assert_eq!(result.unwrap(), 64);
    }

    #[test]
    fn test_hamming_distance_single_bit() {
        let result = hamming_distance("0000000000000000".into(), "0000000000000001".into());
        assert_eq!(result.unwrap(), 1);
    }

    #[test]
    fn test_hamming_distance_invalid_length() {
        let result = hamming_distance("short".into(), "short".into());
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_gps_coord_valid() {
        let value = exif::Value::Rational(vec![
            exif::Rational { num: 40, denom: 1 },
            exif::Rational { num: 26, denom: 1 },
            exif::Rational { num: 46, denom: 1 },
        ]);
        let coord = parse_gps_coord(&value, "N").unwrap();
        let expected = 40.0 + 26.0 / 60.0 + 46.0 / 3600.0;
        assert!((coord - expected).abs() < 1e-9);
    }

    #[test]
    fn test_parse_gps_coord_south_negates() {
        let value = exif::Value::Rational(vec![
            exif::Rational { num: 33, denom: 1 },
            exif::Rational { num: 51, denom: 1 },
            exif::Rational { num: 54, denom: 1 },
        ]);
        let coord = parse_gps_coord(&value, "S").unwrap();
        assert!(coord < 0.0);
    }

    #[test]
    fn test_parse_gps_coord_zero_denom_returns_none() {
        let value = exif::Value::Rational(vec![
            exif::Rational { num: 40, denom: 0 },
            exif::Rational { num: 26, denom: 1 },
            exif::Rational { num: 46, denom: 1 },
        ]);
        assert!(parse_gps_coord(&value, "N").is_none());
    }

    #[test]
    fn test_parse_gps_coord_insufficient_rationals() {
        let value = exif::Value::Rational(vec![
            exif::Rational { num: 40, denom: 1 },
        ]);
        assert!(parse_gps_coord(&value, "N").is_none());
    }
}
