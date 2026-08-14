//! archivist-thumbnail — paylasilan thumbnail uretim yardimcilari.
//!
//! image/text/cad aileleri kullanir: resize+JPEG encode (ortak cikti bicimi), ham
//! bayt → thumbnail (gomulu PNG/BMP/JPEG), PDF gibi konteyner'larda gomulu raster tarama.
//! Cikti her zaman core [`Thumbnail`] (JPEG baytlari).
//!
//! Format-ozel cozumler alt-modullerde: OLE/CFB gomulu ([`ole`]) ve PSD composite ([`psd`]).
//! Onlarin `pub` API'si asagida `pub use` ile re-export edilir (yol: `archivist_thumbnail::<ad>`).

use std::io::Cursor;

use archivist_extract::Thumbnail;
use image::{DynamicImage, GenericImageView, ImageFormat};

mod ole;
mod psd;

pub use ole::ole_thumbnail;
pub use psd::{decode_psd_composite, psd_thumbnail, psd_unpack_bits};

/// Thumbnail kenar tavani (en-boy korunur).
pub const THUMB_MAX: u32 = 256;
/// AI vision-analiz onizleme kenar tavani (H2 768px paritesi). Depolanan [`THUMB_MAX`] (256px)
/// thumbnail vision modeline AZ detay verir → yuzeysel betim / OCR-okunmaz (kullanici bulgusu
/// 2026-07-11); analiz aninda kaynak RASTER dosyadan bu boyda daha buyuk onizleme uretilir.
pub const VISION_PREVIEW_MAX: u32 = 768;
/// JPEG kalitesi.
const JPEG_QUALITY: u8 = 82;

/// Bir gorseli aspect-koruyan JPEG thumbnail'a (kenar ≤ [`THUMB_MAX`]) kodla. `img.thumbnail`
/// kutu-icine sigdirir (kucuk kaynagi UPSCALE de eder → depolanan thumb daima ~256 kutusunda).
pub fn encode_thumbnail(img: &DynamicImage) -> Option<Thumbnail> {
    let thumb = img.thumbnail(THUMB_MAX, THUMB_MAX);
    let (width, height) = thumb.dimensions();
    let rgb = DynamicImage::ImageRgb8(thumb.to_rgb8());
    let mut buf = Cursor::new(Vec::new());
    rgb.write_to(&mut buf, image::ImageOutputFormat::Jpeg(JPEG_QUALITY)).ok()?;
    Some(Thumbnail { bytes: buf.into_inner(), mime: "image/jpeg".to_string(), width, height })
}

/// Bir gorseli aspect-koruyan JPEG'e (kenar ≤ `max`) kodla — **yalniz KUCULT.** Kaynak zaten `max`
/// icindeyse ORIJINAL boyutta kodlar (upscale sahte detay ekler + gereksiz token/bayt → AI vision
/// onizlemesinde istenmez; `encode_thumbnail`'in kutu-doldurma davranisindan bilerek AYRI).
pub fn encode_sized(img: &DynamicImage, max: u32) -> Option<Thumbnail> {
    let (w, h) = img.dimensions();
    let scaled = if w > max || h > max { img.thumbnail(max, max) } else { img.clone() };
    let (width, height) = scaled.dimensions();
    let rgb = DynamicImage::ImageRgb8(scaled.to_rgb8());
    let mut buf = Cursor::new(Vec::new());
    rgb.write_to(&mut buf, image::ImageOutputFormat::Jpeg(JPEG_QUALITY)).ok()?;
    Some(Thumbnail { bytes: buf.into_inner(), mime: "image/jpeg".to_string(), width, height })
}

/// Kodlanmis gorsel baytlarindan (PNG/JPEG/BMP/...) thumbnail uret.
pub fn thumbnail_from_bytes(bytes: &[u8]) -> Option<Thumbnail> {
    let img = image::load_from_memory(bytes).ok()?;
    encode_thumbnail(&img)
}

/// Kodlanmis RASTER gorsel baytlarindan (JPEG/PNG/...) `max`-kenar onizleme (AI vision-analiz).
/// `image` crate cozemezse (raster degil / bozuk) `None` → cagiran depolanan thumb'a geri-duser.
pub fn image_preview_from_bytes(bytes: &[u8], max: u32) -> Option<Thumbnail> {
    let img = image::load_from_memory(bytes).ok()?;
    encode_sized(&img, max)
}

/// Bir konteyner'da (PDF gibi) gomulu ilk makul raster'i bul → thumbnail.
///
/// Once JPEG (`FF D8 FF`), sonra PNG magic taranir; ilk `min_dim`'den buyuk gorsel
/// kullanilir. Mimari PDF'ler genelde gomulu CAD-export/scan raster icerir; bu, true
/// sayfa-render olmadan (harici arac/pdfium gerektirmeden) makul bir onizleme verir.
/// Metin-only PDF'lerde `None` (cagiran ikon fallback gosterir).
pub fn scan_embedded_raster(data: &[u8], min_dim: u32) -> Option<Thumbnail> {
    // JPEG taramasi.
    let mut i = 0;
    while i + 3 < data.len() {
        if data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF {
            if let Ok(img) = image::load_from_memory_with_format(&data[i..], image::ImageFormat::Jpeg)
            {
                if img.width() > min_dim && img.height() > min_dim {
                    if let Some(t) = encode_thumbnail(&img) {
                        return Some(t);
                    }
                }
            }
            i += 3;
        } else {
            i += 1;
        }
    }

    // PNG taramasi.
    const PNG_MAGIC: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    let mut j = 0;
    while j + 8 < data.len() {
        if data[j..j + 8] == PNG_MAGIC {
            if let Ok(img) = image::load_from_memory_with_format(&data[j..], image::ImageFormat::Png)
            {
                if img.width() > min_dim && img.height() > min_dim {
                    if let Some(t) = encode_thumbnail(&img) {
                        return Some(t);
                    }
                }
            }
        }
        j += 1;
    }
    None
}

/// **EPS gomulu TIFF onizleme** (H2 `get_eps_thumbnail` sadik portu). Binary-header magic
/// `0xC5D0D3C6`; TIFF ofset @20-23, uzunluk @24-27. Yoksa/sinir-disi → None.
pub fn eps_thumbnail(data: &[u8]) -> Option<Thumbnail> {
    if data.len() < 28 {
        return None;
    }
    let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    if magic != 0xC5D0_D3C6 {
        return None;
    }
    let off = u32::from_le_bytes([data[20], data[21], data[22], data[23]]) as usize;
    let len = u32::from_le_bytes([data[24], data[25], data[26], data[27]]) as usize;
    if off == 0 || len == 0 {
        return None;
    }
    let end = off.checked_add(len)?;
    if end > data.len() {
        return None;
    }
    let img = image::load_from_memory_with_format(&data[off..end], ImageFormat::Tiff).ok()?;
    encode_thumbnail(&img)
}

/// **En BUYUK gomulu JPEG'i tara** (SKP; H2 `get_skp_thumbnail` sadik portu). `scan_limit` ilk N
/// bayt (or. 4MB); `min_dim`'den buyuk JPEG'ler arasinda en genis alanli secilir.
pub fn scan_largest_jpeg(data: &[u8], scan_limit: usize, min_dim: u32) -> Option<Thumbnail> {
    let limit = scan_limit.min(data.len());
    let mut best: Option<(u32, DynamicImage)> = None;
    let mut i = 0;
    while i + 3 < limit {
        if data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF {
            if let Ok(img) = image::load_from_memory_with_format(&data[i..], ImageFormat::Jpeg) {
                if img.width() > min_dim && img.height() > min_dim {
                    let area = img.width() * img.height();
                    if best.as_ref().is_none_or(|(a, _)| area > *a) {
                        best = Some((area, img));
                    }
                }
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    best.and_then(|(_, img)| encode_thumbnail(&img))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Kucuk gorsel → kodlanmis bayt (test fixture'lari icin).
    fn img_bytes(w: u32, h: u32, fmt: image::ImageOutputFormat) -> Vec<u8> {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(w, h, image::Rgb([20, 120, 200])));
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, fmt).unwrap();
        buf.into_inner()
    }

    #[test]
    fn eps_thumbnail_validates_header() {
        // Yanlis magic → None.
        assert!(eps_thumbnail(&[0u8; 64]).is_none());
        // Dogru magic ama ofset 0 → None.
        let mut d = vec![0u8; 64];
        d[0..4].copy_from_slice(&0xC5D0_D3C6u32.to_le_bytes());
        assert!(eps_thumbnail(&d).is_none(), "ofset 0 → None");
        // Ofset sinir-disi → None.
        d[20..24].copy_from_slice(&9999u32.to_le_bytes());
        d[24..28].copy_from_slice(&100u32.to_le_bytes());
        assert!(eps_thumbnail(&d).is_none(), "sinir-disi ofset → None");
    }

    #[test]
    fn scan_largest_jpeg_picks_biggest() {
        let small = img_bytes(70, 70, image::ImageOutputFormat::Jpeg(80));
        let big = img_bytes(180, 140, image::ImageOutputFormat::Jpeg(80));
        let mut blob = vec![0u8; 32];
        blob.extend_from_slice(&small);
        blob.extend_from_slice(&[0u8; 16]);
        blob.extend_from_slice(&big);
        let t = scan_largest_jpeg(&blob, blob.len(), 64).unwrap();
        // En buyuk JPEG (180x140) secilir → thumbnail en-boy ~180:140.
        assert!((t.width as f32 / t.height as f32 - 180.0 / 140.0).abs() < 0.15, "{}x{}", t.width, t.height);
        // min_dim cok yuksek → hicbiri gecmez.
        assert!(scan_largest_jpeg(&blob, blob.len(), 500).is_none());
    }

    #[test]
    fn encode_produces_jpeg() {
        // 300×150 (>256) → downscale; 2:1 en-boy korunur (thumbnail kucukleri upscale eder,
        // bu yuzden buyuk kaynak secilir).
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(300, 150, image::Rgb([10, 200, 50])));
        let t = encode_thumbnail(&img).unwrap();
        assert_eq!(t.mime, "image/jpeg");
        assert!(t.width <= THUMB_MAX && t.height <= THUMB_MAX, "{}x{}", t.width, t.height);
        assert!((t.width as f32 / t.height as f32 - 2.0).abs() < 0.1, "en-boy ~2:1: {}x{}", t.width, t.height);
        assert!(t.bytes.starts_with(&[0xFF, 0xD8, 0xFF]), "JPEG magic");
    }

    #[test]
    fn large_image_downscaled() {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1000, 500, image::Rgb([0, 0, 0])));
        let t = encode_thumbnail(&img).unwrap();
        assert!(t.width <= THUMB_MAX && t.height <= THUMB_MAX, "{}x{}", t.width, t.height);
    }

    #[test]
    fn encode_sized_respects_max_without_upscale() {
        // 1000x500 → VISION_PREVIEW_MAX (768) ile downscale; 256'dan BUYUK kalir (vision onizleme).
        let big = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(1000, 500, image::Rgb([1, 2, 3])));
        let t = encode_sized(&big, VISION_PREVIEW_MAX).unwrap();
        assert!(t.width <= VISION_PREVIEW_MAX && t.height <= VISION_PREVIEW_MAX, "{}x{}", t.width, t.height);
        assert!(t.width > THUMB_MAX, "vision onizleme depolanan 256px'ten buyuk olmali: {}", t.width);
        // Kaynak zaten kucukse UPSCALE etme (bosuna detay uydurmayiz).
        let small = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(120, 90, image::Rgb([1, 2, 3])));
        let t2 = encode_sized(&small, VISION_PREVIEW_MAX).unwrap();
        assert_eq!((t2.width, t2.height), (120, 90), "kucuk kaynak upscale edilmez");
    }

    #[test]
    fn image_preview_decodes_raster_else_none() {
        let png = img_bytes(400, 300, image::ImageOutputFormat::Png);
        let t = image_preview_from_bytes(&png, VISION_PREVIEW_MAX).unwrap();
        assert_eq!(t.mime, "image/jpeg");
        assert!(t.width <= VISION_PREVIEW_MAX && t.height <= VISION_PREVIEW_MAX, "{}x{}", t.width, t.height);
        // Raster degil → None (cagiran depolanan thumb'a geri-duser).
        assert!(image_preview_from_bytes(b"bu bir gorsel degil", VISION_PREVIEW_MAX).is_none());
    }

    #[test]
    fn scan_finds_embedded_png() {
        // Gomulu PNG'yi cop oncesi/sonrasi arasina koy.
        let mut png_bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(image::RgbImage::from_pixel(60, 60, image::Rgb([200, 30, 30])))
            .write_to(&mut png_bytes, image::ImageOutputFormat::Png)
            .unwrap();
        let mut container = vec![0xAAu8; 100];
        container.extend_from_slice(&png_bytes.into_inner());
        container.extend_from_slice(&[0xBB; 50]);

        let t = scan_embedded_raster(&container, 40).unwrap();
        assert_eq!(t.mime, "image/jpeg");
        // Kucuk gomulu (60>40) bulunmali; 40-altini ele.
        assert!(scan_embedded_raster(&vec![0u8; 500], 40).is_none(), "raster yoksa None");
    }
}
