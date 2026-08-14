//! PSD (Photoshop) composite/flattened gorsel cozumu + PackBits (RLE) satir cozucu.
//!
//! `image` crate PSD decode edemez → merged image data'yi elle coz (H2 sadik portu).
//! Fn'ler `pub`; kok modul (`lib.rs`) bunlari `pub use` ile re-export eder.

use image::DynamicImage;

use crate::{encode_thumbnail, Thumbnail};

/// **PSD composite/flattened gorseli coz** (H2 `get_psd_thumbnail` sadik portu). `image` crate PSD
/// decode edemez → merged image data'yi (dosya sonu) elle coz: raw (comp=0) veya RLE/PackBits
/// (comp=1) planar kanallar → RGB (renk-modu: 4=CMYK · 1/tek-kanal=gri · digeri=RGB ilk 3 kanal).
/// `depth != 8` / boyut 0 veya >30000 / bilinmeyen sikistirma / yetersiz veri → None (panik yok).
/// Cagiran bundan thumbnail + phash + baskin-renk turetebilir (tam gorsel donunce).
pub fn decode_psd_composite(data: &[u8]) -> Option<DynamicImage> {
    if data.len() < 26 || &data[0..4] != b"8BPS" {
        return None;
    }
    let channels = u16::from_be_bytes([data[12], data[13]]) as usize;
    let height = u32::from_be_bytes([data[14], data[15], data[16], data[17]]) as usize;
    let width = u32::from_be_bytes([data[18], data[19], data[20], data[21]]) as usize;
    let depth = u16::from_be_bytes([data[22], data[23]]) as usize;
    let color_mode = u16::from_be_bytes([data[24], data[25]]);

    if width == 0 || height == 0 || width > 30000 || height > 30000 || depth != 8 || channels == 0 {
        return None;
    }

    // Uc degisken-uzunluklu bolumu atla: Color Mode Data · Image Resources · Layer&Mask.
    let mut off = 26usize;
    for _ in 0..3 {
        if off + 4 > data.len() {
            return None;
        }
        let len =
            u32::from_be_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]]) as usize;
        off = off.checked_add(4)?.checked_add(len)?;
    }
    // Merged image data: compression(2) + planar kanallar.
    if off + 2 > data.len() {
        return None;
    }
    let compression = u16::from_be_bytes([data[off], data[off + 1]]);
    off += 2;

    let plane_size = width.checked_mul(height)?;
    let mut channel_data: Vec<Vec<u8>> = Vec::with_capacity(channels);

    if compression == 0 {
        for ch in 0..channels {
            let start = off.checked_add(ch.checked_mul(plane_size)?)?;
            let end = start.checked_add(plane_size)?;
            if end > data.len() {
                return None;
            }
            channel_data.push(data[start..end].to_vec());
        }
    } else if compression == 1 {
        let total_rows = channels.checked_mul(height)?;
        let row_count_bytes = total_rows.checked_mul(2)?;
        if off + row_count_bytes > data.len() {
            return None;
        }
        let mut row_sizes: Vec<u16> = Vec::with_capacity(total_rows);
        for i in 0..total_rows {
            let idx = off + i * 2;
            if idx + 1 >= data.len() {
                break;
            }
            row_sizes.push(u16::from_be_bytes([data[idx], data[idx + 1]]));
        }
        off += row_count_bytes;
        for ch in 0..channels {
            let mut plane = Vec::with_capacity(plane_size);
            for row in 0..height {
                let Some(&row_bytes) = row_sizes.get(ch * height + row) else {
                    break;
                };
                let row_bytes = row_bytes as usize;
                if off + row_bytes > data.len() {
                    break;
                }
                psd_unpack_bits(&data[off..off + row_bytes], &mut plane, width);
                off += row_bytes;
            }
            plane.resize(plane_size, 0); // eksik cozulduyse doldur
            channel_data.push(plane);
        }
    } else {
        return None; // bilinmeyen sikistirma (ZIP vb.)
    }

    if channel_data.is_empty() {
        return None;
    }

    let mut rgb = Vec::with_capacity(plane_size.checked_mul(3)?);
    if color_mode == 4 && channel_data.len() >= 4 {
        // CMYK → RGB (PSD ters saklar: 0=tam murekkep, 255=murekkep yok).
        for i in 0..plane_size {
            let c = channel_data[0].get(i).copied().unwrap_or(0) as f32;
            let m = channel_data[1].get(i).copied().unwrap_or(0) as f32;
            let y = channel_data[2].get(i).copied().unwrap_or(0) as f32;
            let k = channel_data[3].get(i).copied().unwrap_or(0) as f32;
            rgb.push(((255.0 - c) * (255.0 - k) / 255.0) as u8);
            rgb.push(((255.0 - m) * (255.0 - k) / 255.0) as u8);
            rgb.push(((255.0 - y) * (255.0 - k) / 255.0) as u8);
        }
    } else if color_mode == 1 || channels == 1 {
        // Grayscale → 3 kanala kopyala.
        for i in 0..plane_size {
            let v = channel_data[0].get(i).copied().unwrap_or(0);
            rgb.push(v);
            rgb.push(v);
            rgb.push(v);
        }
    } else {
        // RGB (mode 3) — ilk 3 kanal (alpha vb. atlanir).
        let use_ch = channels.min(3);
        for i in 0..plane_size {
            for ch_data in &channel_data[..use_ch] {
                rgb.push(ch_data.get(i).copied().unwrap_or(0));
            }
            for _ in use_ch..3 {
                rgb.push(channel_data[0].get(i).copied().unwrap_or(0));
            }
        }
    }

    let img = image::RgbImage::from_raw(width as u32, height as u32, rgb)?;
    Some(DynamicImage::ImageRgb8(img))
}

/// **PSD thumbnail** — composite'i coz ([`decode_psd_composite`]) → JPEG thumbnail'a kodla.
pub fn psd_thumbnail(data: &[u8]) -> Option<Thumbnail> {
    encode_thumbnail(&decode_psd_composite(data)?)
}

/// PSD PackBits (RLE) satir cozucu (H2 `psd_unpack_bits` sadik portu). `expected_len` = satir
/// piksel genisligi (asma korumasi). Cozulen bayt sayisini `dst`'ye ekler + doner.
pub fn psd_unpack_bits(src: &[u8], dst: &mut Vec<u8>, expected_len: usize) -> usize {
    let mut si = 0;
    let mut written = 0;
    while si < src.len() && written < expected_len {
        let n = src[si] as i8;
        si += 1;
        if n >= 0 {
            let count = (n as usize) + 1;
            let end = (si + count).min(src.len());
            let take = (end - si).min(expected_len - written);
            dst.extend_from_slice(&src[si..si + take]);
            si += count;
            written += take;
        } else if n == -128 {
            // no-op (PackBits sentinel)
        } else {
            let count = (1 - n as i16) as usize;
            if si < src.len() {
                let val = src[si];
                si += 1;
                let take = count.min(expected_len - written);
                dst.resize(dst.len() + take, val);
                written += take;
            }
        }
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    #[test]
    fn psd_unpack_bits_literal_run_and_cap() {
        // Literal: n=2 → sonraki 3 baytı kopyala.
        let mut out = Vec::new();
        assert_eq!(psd_unpack_bits(&[2u8, 10, 20, 30], &mut out, 10), 3);
        assert_eq!(out, vec![10, 20, 30]);
        // Run: n=-3 (253) → sonraki bayti (1-(-3))=4 kez tekrarla.
        let mut run = Vec::new();
        psd_unpack_bits(&[253u8, 99], &mut run, 10);
        assert_eq!(run, vec![99, 99, 99, 99]);
        // expected_len ciktiyi kelepceler (asma korumasi).
        let mut capped = Vec::new();
        psd_unpack_bits(&[253u8, 7], &mut capped, 2);
        assert_eq!(capped, vec![7, 7]);
    }

    /// Minimal PSD (26-bayt header + 3 bos bolum + compression + `plane_data`). depth=8 sabit.
    fn minimal_psd(channels: u16, mode: u16, compression: u16, plane_data: &[u8], w: u32, h: u32) -> Vec<u8> {
        let mut d = Vec::new();
        d.extend_from_slice(b"8BPS");
        d.extend_from_slice(&[0, 1]); // version
        d.extend_from_slice(&[0; 6]); // reserved
        d.extend_from_slice(&channels.to_be_bytes());
        d.extend_from_slice(&h.to_be_bytes());
        d.extend_from_slice(&w.to_be_bytes());
        d.extend_from_slice(&8u16.to_be_bytes()); // depth
        d.extend_from_slice(&mode.to_be_bytes());
        d.extend_from_slice(&0u32.to_be_bytes()); // color mode data len
        d.extend_from_slice(&0u32.to_be_bytes()); // image resources len
        d.extend_from_slice(&0u32.to_be_bytes()); // layer & mask len
        d.extend_from_slice(&compression.to_be_bytes());
        d.extend_from_slice(plane_data);
        d
    }

    #[test]
    fn psd_composite_raw_rgb_thumbnail() {
        // 2×2 RGB, uncompressed; R/G/B planar (kanal-kanal ardisik).
        let mut planes = Vec::new();
        planes.extend_from_slice(&[255, 0, 0, 255]); // R plane
        planes.extend_from_slice(&[0, 255, 0, 0]); // G plane
        planes.extend_from_slice(&[0, 0, 255, 0]); // B plane
        let d = minimal_psd(3, 3, 0, &planes, 2, 2);
        let img = decode_psd_composite(&d).expect("composite cozulmeli");
        assert_eq!(img.dimensions(), (2, 2));
        let t = psd_thumbnail(&d).expect("PSD thumbnail");
        assert_eq!(t.mime, "image/jpeg");
        assert!(t.bytes.starts_with(&[0xFF, 0xD8, 0xFF]), "JPEG magic");
        // Gecersiz magic → None; depth!=8 → None (panik yok).
        assert!(psd_thumbnail(b"nope").is_none());
        let mut bad_depth = minimal_psd(3, 3, 0, &planes, 2, 2);
        bad_depth[22..24].copy_from_slice(&16u16.to_be_bytes());
        assert!(decode_psd_composite(&bad_depth).is_none(), "depth!=8 → None");
    }

    #[test]
    fn psd_composite_rle_grayscale() {
        // 4×1 grayscale, RLE. Bolum: row-count tablosu (channels*height u16) + satir verisi.
        // Satir = run: n=-3 (253) → sonraki bayt (1-(-3))=4 kez → 0xAA ×4.
        let row: [u8; 2] = [253, 0xAA];
        let mut planes = Vec::new();
        planes.extend_from_slice(&(row.len() as u16).to_be_bytes()); // satir byte sayisi
        planes.extend_from_slice(&row);
        let d = minimal_psd(1, 1, 1, &planes, 4, 1);
        let img = decode_psd_composite(&d).expect("RLE gri composite");
        assert_eq!(img.dimensions(), (4, 1));
        // Tum pikseller 0xAA (gri → 3 kanal ayni).
        let px = img.to_rgb8();
        assert_eq!(px.get_pixel(0, 0)[0], 0xAA);
        assert_eq!(px.get_pixel(3, 0)[2], 0xAA);
    }
}
