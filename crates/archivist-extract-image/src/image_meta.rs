//! Gorsel metadata — boyut, EXIF, pHash (algisal hash), baskin renk (CIELAB k-means),
//! thumbnail. H2 `image_analysis.rs`'ten nakil (renk/phash matematigi aynen korundu).

use archivist_extract::{Color, ExtractError, ExtractInput, Extracted, Extractor};
use image::{DynamicImage, GenericImageView};

/// Gorsel ust boyut siniri: 256 MB (cok buyuk gorseller atlanir).
const MAX_IMAGE_SIZE: u64 = 256 * 1024 * 1024;
/// Render motoru imzalari (EXIF Software alani) — is_render tespiti.
const RENDER_KEYWORDS: &[&str] = &[
    "vray", "v-ray", "corona", "lumion", "enscape", "3ds max", "blender", "cinema 4d",
    "maya", "sketchup", "unreal", "unity", "octane", "redshift", "arnold", "cycles", "eevee",
    "keyshot", "twinmotion",
];

/// Raster gorsel cikaricisi.
pub struct ImageExtractor;

impl Extractor for ImageExtractor {
    fn id(&self) -> &'static str {
        "image"
    }
    /// ⚠️ Bu liste ile kok `Cargo.toml`'daki `image` **feature** listesi BIRLIKTE gider:
    /// `image` `default-features = false` ile derlenir → burada sayilan ama feature'i acik
    /// olmayan bir uzanti, decode edilemedigi icin ONIZLEMESIZ kalir (kullanici bulgusu
    /// 2026-08-16: `webp`/`ico` iki listede de yoktu → 54 dosya sessizce onizlemesizdi).
    /// `image_formats_cover_declared_extensions` testi ikisini birbirine baglar.
    fn extensions(&self) -> &'static [&'static str] {
        &["jpg", "jpeg", "png", "bmp", "tif", "tiff", "tga", "gif", "psd", "webp", "ico"]
    }
    fn max_size(&self) -> u64 {
        MAX_IMAGE_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let mut out = Extracted::new();
        out.set("format", input.ext.clone());

        if input.ext == "psd" {
            // image crate PSD decode edemez → boyut header'dan; ama composite'i (merged image data)
            // H2 portu ile (raw/RLE PackBits, CMYK/gri/RGB) elle cozup thumbnail + phash + baskin-renk
            // uretiriz (H2 PSD icin bunlari ATLIYORDU → H3 ileri: PSD artik dedup/renk-facet'e girer).
            let data =
                std::fs::read(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
            match psd_dimensions(&data) {
                Some((w, h)) => {
                    out.set("width", w);
                    out.set("height", h);
                    out.set("has_alpha", true);
                }
                None => return Err(ExtractError::Parse("gecersiz PSD header".to_string())),
            }
            match archivist_thumbnail::decode_psd_composite(&data) {
                Some(img) => {
                    out.phash = Some(compute_phash_bits(&img));
                    out.dominant_colors = dominant_colors(&img, 5);
                    out.thumbnail = archivist_thumbnail::encode_thumbnail(&img);
                }
                None => out
                    .warn("PSD: composite cozulemedi (depth!=8 / bilinmeyen sikistirma) — yalniz boyut"),
            }
            read_exif_into(&input.path, &mut out);
            return Ok(out);
        }

        // Raster: image crate ile decode.
        match image::open(&input.path) {
            Ok(img) => {
                let (w, h) = img.dimensions();
                out.set("width", w);
                out.set("height", h);
                out.phash = Some(compute_phash_bits(&img));
                out.dominant_colors = dominant_colors(&img, 5);
                out.thumbnail = archivist_thumbnail::encode_thumbnail(&img);
            }
            Err(e) => {
                out.warn(format!("gorsel decode edilemedi: {e}"));
                if let Ok((w, h)) = image::image_dimensions(&input.path) {
                    out.set("width", w);
                    out.set("height", h);
                }
            }
        }
        out.set(
            "has_alpha",
            matches!(input.ext.as_str(), "png" | "tga" | "tif" | "tiff" | "gif"),
        );

        read_exif_into(&input.path, &mut out);
        Ok(out)
    }
}

/// PSD header'dan (width, height) oku (8BPS magic + big-endian boyutlar).
fn psd_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    if data.len() < 22 || &data[0..4] != b"8BPS" {
        return None;
    }
    let height = u32::from_be_bytes([data[14], data[15], data[16], data[17]]);
    let width = u32::from_be_bytes([data[18], data[19], data[20], data[21]]);
    Some((width, height))
}

// ── EXIF ────────────────────────────────────────────────────────────────────

/// EXIF alanlarini oku, `out`'a yaz; render imzasi varsa `is_render` etiketle.
fn read_exif_into(path: &std::path::Path, out: &mut Extracted) {
    let Ok(file) = std::fs::File::open(path) else {
        return;
    };
    let mut reader = std::io::BufReader::new(file);
    let Ok(exif) = exif::Reader::new().read_from_container(&mut reader) else {
        return;
    };

    if let Some(f) = exif.get_field(exif::Tag::Software, exif::In::PRIMARY) {
        let software = normalize_software(&f.display_value().to_string());
        if !software.is_empty() {
            out.set("software", software.clone());
        }
        if RENDER_KEYWORDS.iter().any(|kw| software.to_lowercase().contains(kw)) {
            out.set("is_render", true);
            out.auto_tags.push("is_render".to_string());
        }
    }

    let mut field = |tag: exif::Tag, key: &str| {
        if let Some(f) = exif.get_field(tag, exif::In::PRIMARY) {
            out.set(key, f.display_value().to_string());
        }
    };
    field(exif::Tag::Make, "camera_make");
    field(exif::Tag::Model, "camera_model");
    field(exif::Tag::DateTimeOriginal, "date_taken");
    field(exif::Tag::ColorSpace, "color_profile");
    field(exif::Tag::FocalLength, "focal_length");
    field(exif::Tag::ExposureTime, "exposure_time");

    if let Some(iso) = exif.get_field(exif::Tag::PhotographicSensitivity, exif::In::PRIMARY) {
        if let Some(val) = iso.value.get_uint(0) {
            out.set("iso_speed", val);
        }
    }

    if let (Some(lat), Some(lat_ref)) = (
        exif.get_field(exif::Tag::GPSLatitude, exif::In::PRIMARY),
        exif.get_field(exif::Tag::GPSLatitudeRef, exif::In::PRIMARY),
    ) {
        if let Some(v) = parse_gps_coord(&lat.value, &lat_ref.display_value().to_string()) {
            out.set("gps_lat", v);
        }
    }
    if let (Some(lon), Some(lon_ref)) = (
        exif.get_field(exif::Tag::GPSLongitude, exif::In::PRIMARY),
        exif.get_field(exif::Tag::GPSLongitudeRef, exif::In::PRIMARY),
    ) {
        if let Some(v) = parse_gps_coord(&lon.value, &lon_ref.display_value().to_string()) {
            out.set("gps_lon", v);
        }
    }

}

/// EXIF'in insan-okur gosterimi ASCII Software alanlarini dis cift tirnakla sarar.
/// Bu tirnaklar metadata'nin parcasi degildir; icteki gercek tirnaklar korunur.
fn normalize_software(value: &str) -> String {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value)
        .trim()
        .to_string()
}

/// EXIF GPS rational (derece/dakika/saniye) → ondalik derece; S/W negatif.
fn parse_gps_coord(value: &exif::Value, reference: &str) -> Option<f64> {
    match value {
        exif::Value::Rational(rationals) if rationals.len() >= 3 => {
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

// ── pHash (algisal hash) ──────────────────────────────────────────────────────

/// 32×32 grayscale → 2D-DCT → sol-ust 8×8 (DC haric) median esik → 64-bit hash.
#[allow(clippy::needless_range_loop)]
pub fn compute_phash_bits(img: &DynamicImage) -> u64 {
    let gray = img.resize_exact(32, 32, image::imageops::FilterType::CatmullRom).to_luma8();
    if gray.width() < 32 || gray.height() < 32 {
        return 0;
    }

    let mut data = [[0.0_f64; 32]; 32];
    for y in 0..32 {
        for x in 0..32 {
            data[y][x] = f64::from(gray.get_pixel(x as u32, y as u32)[0]);
        }
    }

    let mut cos_table = [[0.0_f64; 32]; 32];
    for u in 0..32 {
        for x in 0..32 {
            cos_table[u][x] =
                (((2 * x + 1) as f64 * u as f64 * std::f64::consts::PI) / 64.0).cos();
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

/// İki pHash arasi Hamming mesafesi (farkli bit sayisi).
pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

// ── Baskin renk (CIELAB k-means) ──────────────────────────────────────────────

/// 100×100'e kuculterek deterministik k-means++ ile baskin renkleri cikar.
pub fn dominant_colors(img: &DynamicImage, num_colors: usize) -> Vec<Color> {
    let n = num_colors.clamp(1, 16);
    let small = img.resize(100, 100, image::imageops::FilterType::Triangle);
    let rgb = small.to_rgb8();
    let total = (rgb.width() * rgb.height()) as usize;
    if total == 0 {
        return vec![];
    }

    let pixels: Vec<[f64; 3]> =
        rgb.pixels().map(|p| srgb_to_lab(p[0], p[1], p[2])).collect();

    let k = n.min(total);
    let mut centroids: Vec<[f64; 3]> = Vec::with_capacity(k);
    centroids.push(pixels[0]);
    for _ in 1..k {
        let max_idx = pixels
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| {
                let da = centroids.iter().map(|c| lab_dist_sq(a, c)).fold(f64::MAX, f64::min);
                let db = centroids.iter().map(|c| lab_dist_sq(b, c)).fold(f64::MAX, f64::min);
                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            })
            .map(|(i, _)| i)
            .unwrap_or(centroids.len() % total);
        centroids.push(pixels[max_idx]);
    }

    let mut assignments = vec![0usize; total];
    for _ in 0..20 {
        let mut changed = false;
        for (i, px) in pixels.iter().enumerate() {
            let nearest = centroids
                .iter()
                .enumerate()
                .min_by(|(_, ca), (_, cb)| {
                    lab_dist_sq(px, ca)
                        .partial_cmp(&lab_dist_sq(px, cb))
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|(j, _)| j)
                .unwrap_or(0);
            if assignments[i] != nearest {
                assignments[i] = nearest;
                changed = true;
            }
        }
        if !changed {
            break;
        }

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

    let mut cluster_counts = vec![0usize; k];
    for &c in &assignments {
        cluster_counts[c] += 1;
    }
    let mut indexed: Vec<(usize, usize)> = cluster_counts
        .iter()
        .enumerate()
        .filter(|(_, &cnt)| cnt > 0)
        .map(|(i, &cnt)| (i, cnt))
        .collect();
    indexed.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    indexed
        .iter()
        .take(n)
        .map(|(i, cnt)| {
            let (r, g, b) = lab_to_srgb(&centroids[*i]);
            Color { r, g, b, percentage: (*cnt as f64 / total as f64 * 100.0) as f32 }
        })
        .collect()
}

/// sRGB u8 → CIELAB [L*, a*, b*] (D65).
fn srgb_to_lab(r: u8, g: u8, b: u8) -> [f64; 3] {
    let lin = |c: f64| if c <= 0.04045 { c / 12.92 } else { ((c + 0.055) / 1.055).powf(2.4) };
    let rl = lin(f64::from(r) / 255.0);
    let gl = lin(f64::from(g) / 255.0);
    let bl = lin(f64::from(b) / 255.0);

    let x = rl * 0.412_456_4 + gl * 0.357_576_1 + bl * 0.180_437_5;
    let y = rl * 0.212_672_9 + gl * 0.715_152_2 + bl * 0.072_175_0;
    let z = rl * 0.019_333_9 + gl * 0.119_192_0 + bl * 0.950_304_1;

    let f = |t: f64| if t > 0.008_856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 };
    let fx = f(x / 0.95047);
    let fy = f(y);
    let fz = f(z / 1.08883);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// CIELAB → sRGB (u8, u8, u8).
fn lab_to_srgb(lab: &[f64; 3]) -> (u8, u8, u8) {
    let fy = (lab[0] + 16.0) / 116.0;
    let fx = lab[1] / 500.0 + fy;
    let fz = fy - lab[2] / 200.0;

    let cube = |t: f64| {
        let t3 = t * t * t;
        if t3 > 0.008_856 { t3 } else { (t - 16.0 / 116.0) / 7.787 }
    };
    let x = cube(fx) * 0.95047;
    let y = cube(fy);
    let z = cube(fz) * 1.08883;

    let rl = x * 3.240_454_2 - y * 1.537_138_5 - z * 0.498_531_4;
    let gl = -x * 0.969_266_0 + y * 1.876_010_8 + z * 0.041_556_0;
    let bl = x * 0.055_643_4 - y * 0.204_025_9 + z * 1.057_225_2;

    let gamma = |c: f64| -> u8 {
        let c = c.clamp(0.0, 1.0);
        let s = if c <= 0.003_130_8 { 12.92 * c } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 };
        (s.clamp(0.0, 1.0) * 255.0).round() as u8
    };
    (gamma(rl), gamma(gl), gamma(bl))
}

/// Karesel CIELAB mesafesi (karekoksuz — yalniz karsilastirma icin).
#[inline]
fn lab_dist_sq(a: &[f64; 3], b: &[f64; 3]) -> f64 {
    let dl = a[0] - b[0];
    let da = a[1] - b[1];
    let db = a[2] - b[2];
    dl * dl + da * da + db * db
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srgb_lab_black_white() {
        let [l, a, b] = srgb_to_lab(0, 0, 0);
        assert!(l.abs() < 0.01 && a.abs() < 0.01 && b.abs() < 0.01);
        let [l, a, b] = srgb_to_lab(255, 255, 255);
        assert!((l - 100.0).abs() < 0.01 && a.abs() < 0.01 && b.abs() < 0.01);
    }

    #[test]
    fn lab_roundtrip_primaries() {
        for (r, g, b) in [(255, 0, 0), (0, 255, 0), (0, 0, 255)] {
            let (rr, gg, bb) = lab_to_srgb(&srgb_to_lab(r, g, b));
            assert_eq!((rr, gg, bb), (r, g, b));
        }
        let (r, g, b) = lab_to_srgb(&srgb_to_lab(128, 128, 128));
        assert!((i32::from(r) - 128).abs() <= 1);
        assert!((i32::from(g) - 128).abs() <= 1);
        assert!((i32::from(b) - 128).abs() <= 1);
    }

    #[test]
    fn lab_dist_known() {
        assert_eq!(lab_dist_sq(&[50.0, 10.0, -5.0], &[50.0, 10.0, -5.0]), 0.0);
        assert!((lab_dist_sq(&[0.0, 0.0, 0.0], &[3.0, 4.0, 0.0]) - 25.0).abs() < 1e-10);
    }

    /// **Regresyon kilidi (kullanici bulgusu 2026-08-16).** `image` kok `Cargo.toml`'da
    /// `default-features = false` ile derlenir. `webp`/`ico` uzantilari `extensions()`'ta da
    /// feature listesinde de yoktu → kullanicinin arsivindeki 45 webp + 9 ico dosyasi
    /// ONIZLEMESIZ kaliyor, hicbir uyari da cikmiyordu (cikarici bulunamadigi icin hat hic
    /// baslamiyordu). Iki liste birbirine BAGLI: burada sayilan her uzantinin decoder'i
    /// derlemede acik olmali. Feature kapatilirsa asagidaki tip referanslari DERLENMEZ.
    #[test]
    fn image_formats_cover_declared_extensions() {
        // psd elle cozulur (image crate PSD bilmez) → format eslesmesi aranmaz.
        for ext in ImageExtractor.extensions().iter().filter(|e| **e != "psd") {
            assert!(
                image::ImageFormat::from_extension(ext).is_some(),
                "{ext}: `image` bu uzantiyi bir formata eslemiyor"
            );
        }
        // Decoder'lar gercekten derlemede mi? (feature kapaliysa bu tipler YOKTUR → derleme hatasi)
        #[allow(dead_code)]
        fn decoders_are_compiled_in() {
            type _Webp<'a> = image::codecs::webp::WebPDecoder<&'a [u8]>;
            type _Ico<'a> = image::codecs::ico::IcoDecoder<&'a [u8]>;
            type _Gif<'a> = image::codecs::gif::GifDecoder<&'a [u8]>;
        }
    }

    /// ICO ucu uctan uca: gercek bir .ico yazilir → `ImageExtractor` onu decode edip
    /// thumbnail + boyut uretmeli. (webp decoder'i 0.24'te encode edemedigimiz icin yalniz
    /// yukaridaki derleme-kilidi ile korunur; ico tam tur atabildigi icin burada kanitlanir.)
    #[test]
    fn ico_files_get_a_thumbnail() {
        use image::codecs::ico::IcoEncoder;
        use image::{ColorType, ImageEncoder};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("simge.ico");
        let pixels: Vec<u8> = (0..16 * 16).flat_map(|i| [i as u8, 40, 200, 255]).collect();
        let file = std::fs::File::create(&path).unwrap();
        IcoEncoder::new(file)
            .write_image(&pixels, 16, 16, ColorType::Rgba8)
            .unwrap();

        let out = ImageExtractor
            .extract(&ExtractInput {
                path: path.clone(),
                ext: "ico".to_string(),
                size_bytes: std::fs::metadata(&path).unwrap().len(),
            })
            .unwrap();

        assert!(out.thumbnail.is_some(), "ico onizlemesi uretilmeli: {:?}", out.warnings);
        assert!(out.phash.is_some(), "ico icin phash (dedup) da uretilmeli");
    }

    #[test]
    fn hamming_basic() {
        assert_eq!(hamming_distance(0, 0), 0);
        assert_eq!(hamming_distance(0, u64::MAX), 64);
        assert_eq!(hamming_distance(0, 1), 1);
    }

    #[test]
    fn gps_parse() {
        let v = exif::Value::Rational(vec![
            exif::Rational { num: 40, denom: 1 },
            exif::Rational { num: 26, denom: 1 },
            exif::Rational { num: 46, denom: 1 },
        ]);
        let coord = parse_gps_coord(&v, "N").unwrap();
        assert!((coord - (40.0 + 26.0 / 60.0 + 46.0 / 3600.0)).abs() < 1e-9);
        assert!(parse_gps_coord(&v, "S").unwrap() < 0.0);

        let bad = exif::Value::Rational(vec![exif::Rational { num: 40, denom: 0 }]);
        assert!(parse_gps_coord(&bad, "N").is_none());
    }

    #[test]
    fn software_display_wrappers_and_padding_are_removed() {
        let quote = char::from(34);
        assert_eq!(
            normalize_software(&format!("{quote}Adobe Photoshop CS4 Windows{quote}")),
            "Adobe Photoshop CS4 Windows"
        );
        assert_eq!(
            normalize_software(&format!(" {quote}COOLPIX P100V1.2               {quote} ")),
            "COOLPIX P100V1.2"
        );
        assert_eq!(
            normalize_software(&format!("Adobe {quote}Photoshop{quote}")),
            format!("Adobe {quote}Photoshop{quote}")
        );
    }

    #[test]
    fn psd_dims() {
        let mut data = vec![0u8; 26];
        data[0..4].copy_from_slice(b"8BPS");
        data[14..18].copy_from_slice(&600u32.to_be_bytes());
        data[18..22].copy_from_slice(&800u32.to_be_bytes());
        assert_eq!(psd_dimensions(&data), Some((800, 600)));
        assert_eq!(psd_dimensions(b"nope"), None);
    }

    #[test]
    fn phash_deterministic_and_discriminates() {
        // Dikey gradyan vs duz gri → farkli phash; ayni gorsel → ayni phash.
        let mut grad = image::RgbImage::new(64, 64);
        for (x, _y, px) in grad.enumerate_pixels_mut() {
            let v = (x * 4) as u8;
            *px = image::Rgb([v, v, v]);
        }
        let grad = DynamicImage::ImageRgb8(grad);
        let solid = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(64, 64, image::Rgb([128, 128, 128])));

        let h1 = compute_phash_bits(&grad);
        let h2 = compute_phash_bits(&grad);
        assert_eq!(h1, h2, "ayni gorsel ayni phash uretmeli");
        assert_ne!(h1, compute_phash_bits(&solid), "farkli gorsel farkli phash");
    }

    #[test]
    fn dominant_colors_solid_red() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(50, 50, image::Rgb([255, 0, 0])));
        let colors = dominant_colors(&img, 5);
        assert!(!colors.is_empty());
        let top = &colors[0];
        assert!(top.r > 200 && top.g < 60 && top.b < 60, "baskin renk kirmizi olmali: {top:?}");
        assert!((top.percentage - 100.0).abs() < 1.0);
    }
}
