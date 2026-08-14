//! DWG gomulu onizleme bitmap'i → thumbnail. H2 `thumbnails.rs::get_dwg_thumbnail` naklı.
//!
//! Saf-Rust, harici arac yok: DWG header'inda (offset 0x0D) onizleme bolumunun seeker'i
//! var; orada descriptor'lar (tip/baslangic/boyut) PNG (tip 3/6) veya BMP-DIB (tip 2)
//! gosterir. Decode + JPEG encode [`archivist_thumbnail`] ile. Checked-indexing.

use archivist_extract::Thumbnail;

/// DWG baytlarindan gomulu onizleme thumbnail'i (yoksa `None`).
pub fn dwg_preview_thumbnail(data: &[u8]) -> Option<Thumbnail> {
    if data.len() < 0x12 || &data[0..2] != b"AC" {
        return None;
    }
    let seeker =
        u32::from_le_bytes([data[0x0D], data[0x0E], data[0x0F], data[0x10]]) as usize;
    if seeker == 0 || seeker + 21 >= data.len() {
        return None;
    }

    let descriptors = read_descriptors_best(data, seeker);

    // Once tip 6/3 (PNG) — daha yuksek kalite.
    for &(t, start, size) in &descriptors {
        if (t == 6 || t == 3) && size > 8 && start.checked_add(size).is_some_and(|e| e <= data.len())
        {
            if let Some(thumb) = archivist_thumbnail::thumbnail_from_bytes(&data[start..start + size])
            {
                return Some(thumb);
            }
        }
    }

    // Sonra tip 2 (BMP DIB) — BMP dosya basligi onune eklenip decode edilir.
    for &(t, start, size) in &descriptors {
        if t == 2 && size >= 40 && start.checked_add(size).is_some_and(|e| e <= data.len()) {
            if let Some(bmp) = dib_to_bmp(&data[start..start + size]) {
                if let Some(thumb) = archivist_thumbnail::thumbnail_from_bytes(&bmp) {
                    return Some(thumb);
                }
            }
        }
    }
    None
}

/// (tip, baslangic, boyut) descriptor'lari oku. Layout B (overall_size'li) once.
fn read_descriptors_best(data: &[u8], seeker: usize) -> Vec<(u8, usize, usize)> {
    let descs_b = read_descriptors(data, seeker + 20, seeker + 21); // overall_size'li
    let descs_a = read_descriptors(data, seeker + 16, seeker + 17); // overall_size'siz
    if descriptors_valid(&descs_b, data.len()) {
        descs_b
    } else if descriptors_valid(&descs_a, data.len()) {
        descs_a
    } else if !descs_b.is_empty() {
        descs_b
    } else {
        descs_a
    }
}

fn read_descriptors(data: &[u8], count_off: usize, desc_off: usize) -> Vec<(u8, usize, usize)> {
    if count_off >= data.len() {
        return Vec::new();
    }
    let count = data[count_off] as usize;
    if count == 0 || count > 20 {
        return Vec::new();
    }
    let mut result = Vec::new();
    let mut cur = desc_off;
    for _ in 0..count {
        if cur + 9 > data.len() {
            break;
        }
        let t = data[cur];
        let s = u32::from_le_bytes([data[cur + 1], data[cur + 2], data[cur + 3], data[cur + 4]])
            as usize;
        let z = u32::from_le_bytes([data[cur + 5], data[cur + 6], data[cur + 7], data[cur + 8]])
            as usize;
        cur += 9;
        result.push((t, s, z));
    }
    result
}

fn descriptors_valid(descs: &[(u8, usize, usize)], file_len: usize) -> bool {
    descs.iter().any(|&(t, s, z)| {
        (t == 2 || t == 3 || t == 6) && z > 8 && s.checked_add(z).is_some_and(|e| e <= file_len)
    })
}

/// BITMAPINFOHEADER + piksel verisinden (DIB) onune BMP dosya basligi ekleyerek BMP kur.
fn dib_to_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let header_size = u32::from_le_bytes([dib[0], dib[1], dib[2], dib[3]]);
    let bit_count = u32::from(u16::from_le_bytes([dib[14], dib[15]]));
    let clr_used = u32::from_le_bytes([dib[32], dib[33], dib[34], dib[35]]);
    // num_colors yalniz bit_count<=8 icin (shift guvenli: <= 1<<8).
    let num_colors = if bit_count <= 8 {
        if clr_used > 0 {
            clr_used
        } else {
            1u32 << bit_count
        }
    } else {
        0
    };
    let pixel_offset = 14u32.checked_add(header_size)?.checked_add(num_colors.checked_mul(4)?)?;

    let mut bmp = Vec::with_capacity(14 + dib.len());
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&((14 + dib.len()) as u32).to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&pixel_offset.to_le_bytes());
    bmp.extend_from_slice(dib);
    Some(bmp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn extracts_embedded_png_preview() {
        // Kucuk PNG uret.
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(8, 8, image::Rgb([50, 150, 250])))
            .write_to(&mut png, image::ImageOutputFormat::Png)
            .unwrap();
        let png = png.into_inner();

        // Sentetik DWG: AC1015 + seeker@0x0D + Layout A (count@seeker+16, desc@seeker+17).
        let seeker = 0x40usize;
        let png_start = 0x80usize;
        let mut data = vec![0u8; png_start + png.len()];
        data[0..6].copy_from_slice(b"AC1015");
        data[0x0D..0x11].copy_from_slice(&(seeker as u32).to_le_bytes());
        data[seeker + 16] = 1; // count
        data[seeker + 17] = 6; // tip = PNG
        data[seeker + 18..seeker + 22].copy_from_slice(&(png_start as u32).to_le_bytes());
        data[seeker + 22..seeker + 26].copy_from_slice(&(png.len() as u32).to_le_bytes());
        data[png_start..png_start + png.len()].copy_from_slice(&png);

        let thumb = dwg_preview_thumbnail(&data).expect("DWG preview thumbnail");
        assert_eq!(thumb.mime, "image/jpeg");
        assert!(!thumb.bytes.is_empty());
    }

    #[test]
    fn garbage_and_no_preview_return_none() {
        assert!(dwg_preview_thumbnail(&[]).is_none());
        assert!(dwg_preview_thumbnail(b"not a dwg").is_none());
        // AC imzasi var ama seeker=0 (preview yok).
        let mut data = vec![0u8; 0x40];
        data[0..6].copy_from_slice(b"AC1015");
        assert!(dwg_preview_thumbnail(&data).is_none());
    }
}
