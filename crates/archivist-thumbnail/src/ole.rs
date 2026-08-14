//! OLE/CFB gomulu thumbnail (MAX/RVT/eski-Office ORTAK) + clipboard/DIB cozumu.
//!
//! H2 `parse_ole_thumbnail` sadik portu. `ole_thumbnail` `pub`; kok modul (`lib.rs`) onu
//! `pub use` ile re-export eder. Yardimcilar (`thumbnail_from_clip`/`dib_to_thumbnail`) yalniz
//! bu modul icinde kullanildigi icin private.

use image::ImageFormat;

use crate::{encode_thumbnail, Thumbnail};

/// Bir "clipboard" bayt bolgesinde gomulu JPEG/PNG/DIB ara → thumbnail (OLE prop 0x11 govdesi).
/// H2 `parse_ole_thumbnail` deseni: once JPEG (FF D8 FF), sonra PNG, sonra DIB (BITMAPINFOHEADER).
fn thumbnail_from_clip(clip: &[u8]) -> Option<Thumbnail> {
    if let Some(p) = clip.windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) {
        if let Ok(img) = image::load_from_memory_with_format(&clip[p..], ImageFormat::Jpeg) {
            return encode_thumbnail(&img);
        }
    }
    const PNG: [u8; 4] = [0x89, 0x50, 0x4E, 0x47];
    if let Some(p) = clip.windows(4).position(|w| w == PNG) {
        if let Ok(img) = image::load_from_memory_with_format(&clip[p..], ImageFormat::Png) {
            return encode_thumbnail(&img);
        }
    }
    // DIB: BITMAPINFOHEADER (biSize=40 → [0x28,0,0,0]); "BM" dosya basligi yok → ekle.
    if let Some(p) = clip.windows(4).position(|w| w == [0x28, 0, 0, 0]) {
        return dib_to_thumbnail(&clip[p..]);
    }
    None
}

/// Basliksiz DIB (BITMAPINFOHEADER + palet + piksel) → "BM" dosya basligi ekleyip BMP olarak coz
/// → thumbnail. `bfOffBits` (piksel ofseti) palet boyutundan hesaplanir (image crate onu okur).
fn dib_to_thumbnail(dib: &[u8]) -> Option<Thumbnail> {
    if dib.len() < 40 {
        return None;
    }
    let bi_size = u32::from_le_bytes([dib[0], dib[1], dib[2], dib[3]]);
    if bi_size != 40 {
        return None;
    }
    let bit_count = u16::from_le_bytes([dib[14], dib[15]]) as u32;
    let clr_used = u32::from_le_bytes([dib[32], dib[33], dib[34], dib[35]]);
    let palette = if bit_count <= 8 {
        if clr_used != 0 {
            clr_used
        } else {
            1u32 << bit_count
        }
    } else {
        clr_used
    };
    let pixel_offset = 14 + bi_size + palette.saturating_mul(4);
    let file_size = 14u32.saturating_add(dib.len() as u32);
    let mut bmp = Vec::with_capacity(file_size as usize);
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&file_size.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes()); // bfReserved
    bmp.extend_from_slice(&pixel_offset.to_le_bytes());
    bmp.extend_from_slice(dib);
    let img = image::load_from_memory_with_format(&bmp, ImageFormat::Bmp).ok()?;
    encode_thumbnail(&img)
}

/// **OLE/CFB gomulu thumbnail** (MAX/RVT/eski-Office ORTAK; H2 `parse_ole_thumbnail` sadik portu).
/// `stream` = `\x05SummaryInformation` bayt'lari. PIDSI_THUMBNAIL (prop 0x11, VT_CF) govdesinde
/// gomulu JPEG/PNG/DIB → thumbnail. Property-set basligi office/meta.rs deseniyle ayni.
pub fn ole_thumbnail(stream: &[u8]) -> Option<Thumbnail> {
    if stream.len() < 48 || stream[0] != 0xFE || stream[1] != 0xFF {
        return None;
    }
    let sec =
        u32::from_le_bytes([stream[44], stream[45], stream[46], stream[47]]) as usize;
    if sec + 8 > stream.len() {
        return None;
    }
    let c_props =
        u32::from_le_bytes([stream[sec + 4], stream[sec + 5], stream[sec + 6], stream[sec + 7]])
            as usize;
    for i in 0..c_props.min(1000) {
        let entry = sec + 8 + i * 8;
        if entry + 8 > stream.len() {
            break;
        }
        let pid = u32::from_le_bytes([
            stream[entry],
            stream[entry + 1],
            stream[entry + 2],
            stream[entry + 3],
        ]);
        if pid != 0x11 {
            continue;
        }
        let off = u32::from_le_bytes([
            stream[entry + 4],
            stream[entry + 5],
            stream[entry + 6],
            stream[entry + 7],
        ]) as usize;
        let val = sec + off;
        // VT_CF: vtype(4) + cbSize(4) + [clip-format(4) + gomulu gorsel]. cbSize'i guvenle al;
        // bozuksa stream sonuna kadar tara (image decoder fazlalik baytlari yutar).
        let start = val.saturating_add(8);
        let clip = stream.get(start..)?;
        return thumbnail_from_clip(clip);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    use image::DynamicImage;

    use crate::THUMB_MAX;

    /// Kucuk gorsel → kodlanmis bayt (test fixture'lari icin).
    fn img_bytes(w: u32, h: u32, fmt: image::ImageOutputFormat) -> Vec<u8> {
        let img = DynamicImage::ImageRgb8(image::RgbImage::from_pixel(w, h, image::Rgb([20, 120, 200])));
        let mut buf = Cursor::new(Vec::new());
        img.write_to(&mut buf, fmt).unwrap();
        buf.into_inner()
    }

    /// Minimal OLE SummaryInformation stream'i: tek prop (id) → val_off'ta vtype+cbSize+clip.
    fn ole_with_prop(prop_id: u32, vtype: u32, clip: &[u8]) -> Vec<u8> {
        let sec = 48usize; // section offset (header 48 bayt)
        let val_rel = 16usize; // prop value, section'a gore ofset
        let mut s = vec![0u8; sec];
        s[0] = 0xFE;
        s[1] = 0xFF;
        s[44..48].copy_from_slice(&(sec as u32).to_le_bytes()); // first section offset
        // section: cbSection(4) + cProperties(4) + [prop entry: id(4)+offset(4)]
        s.extend_from_slice(&0u32.to_le_bytes()); // cbSection (kullanilmaz)
        s.extend_from_slice(&1u32.to_le_bytes()); // cProperties = 1
        s.extend_from_slice(&prop_id.to_le_bytes());
        s.extend_from_slice(&(val_rel as u32).to_le_bytes());
        // value @ sec + val_rel: vtype(4) + cbSize(4) + clip
        while s.len() < sec + val_rel {
            s.push(0);
        }
        s.extend_from_slice(&vtype.to_le_bytes());
        s.extend_from_slice(&((clip.len() + 4) as u32).to_le_bytes()); // cbSize
        s.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes()); // clip-format tag
        s.extend_from_slice(clip);
        s
    }

    #[test]
    fn ole_thumbnail_extracts_embedded_jpeg() {
        let jpeg = img_bytes(120, 80, image::ImageOutputFormat::Jpeg(85));
        let stream = ole_with_prop(0x11, 0x0047, &jpeg);
        let t = ole_thumbnail(&stream).expect("prop 0x11 JPEG cikmali");
        assert_eq!(t.mime, "image/jpeg");
        assert!(t.width <= THUMB_MAX && t.height <= THUMB_MAX);
        // Yanlis prop id → None.
        assert!(ole_thumbnail(&ole_with_prop(0x02, 0x0047, &jpeg)).is_none());
        // Thumbnail prop yok / bozuk → None (panik yok).
        assert!(ole_thumbnail(&[0u8; 10]).is_none());
    }

    #[test]
    fn ole_thumbnail_extracts_dib() {
        // BMP encode → 14-bayt dosya basligini at → cipci DIB (BITMAPINFOHEADER + piksel).
        let bmp = img_bytes(40, 30, image::ImageOutputFormat::Bmp);
        let dib = &bmp[14..];
        let stream = ole_with_prop(0x11, 0x0047, dib);
        let t = ole_thumbnail(&stream).expect("DIB → thumbnail");
        assert_eq!(t.mime, "image/jpeg");
    }
}
