use base64::{engine::general_purpose, Engine as _};
use cfb::CompoundFile;
use image::imageops::FilterType;
use serde::Serialize;
use std::fs;
use std::io::{Cursor, Read};
use crate::thumb_util::encode_thumb;

/// Thumbnail extraction sonucu. data bos ise missing_reason doludur.
/// Reason kodlari (frontend i18n key'leri ile eslesir):
///   - "file_too_big" — dosya yapilandirilmis boyut sinirini asti
///   - "no_preview_in_file" — dosyanin kendisinde gomulu thumbnail yok
///   - "parse_failed" — format taninmadi veya bozuldu
///   - "format_unsupported" — bu uzantida thumbnail islemi yok
#[derive(Serialize, Clone)]
pub struct ThumbnailResult {
    pub data: String,
    pub missing_reason: Option<String>,
}

impl ThumbnailResult {
    pub fn ok(data: String) -> Self { Self { data, missing_reason: None } }
    pub fn missing(reason: &str) -> Self {
        Self { data: String::new(), missing_reason: Some(reason.to_string()) }
    }
}

/// Generates a JPEG thumbnail (max 200×200) for TGA and TIFF files.
/// Returns a base64-encoded "data:image/jpeg;base64,…" string.
/// For unsupported types, returns an empty string (frontend will use convertFileSrc).
#[tauri::command]
pub fn generate_thumbnail(path: String, asset_type: String) -> Result<String, String> {
    let upper = asset_type.to_uppercase();
    if upper != "TGA" && upper != "TIFF" {
        return Ok(String::new());
    }

    let img = image::open(&path).map_err(|e| format!("Görsel açılamadı: {}", e))?;
    let thumb = img.resize(200, 200, FilterType::Triangle);

    let mut buf = Cursor::new(Vec::new());
    thumb
        .write_to(&mut buf, image::ImageFormat::Jpeg)
        .map_err(|e| format!("JPEG encode hatası: {}", e))?;

    let b64 = general_purpose::STANDARD.encode(buf.get_ref());
    Ok(format!("data:image/jpeg;base64,{}", b64))
}

/// Decodes PSD PackBits (RLE) compressed data for one channel scanline.
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
            // no-op
        } else {
            let count = (1 - n as i16) as usize;
            if si < src.len() {
                let val = src[si];
                si += 1;
                let take = count.min(expected_len - written);
                dst.extend(std::iter::repeat(val).take(take));
                written += take;
            }
        }
    }
    si
}

/// Extracts the composite/flattened image from a PSD file.
/// Supports both uncompressed (0) and RLE/PackBits (1) compression.
/// PSD stores channels in planar order (all R, then all G, then all B).
#[tauri::command]
pub fn get_psd_thumbnail(path: String) -> Result<String, String> {
    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if file_size > 200 * 1024 * 1024 {
        return Ok(String::new());
    }

    let data = fs::read(&path).map_err(|e| e.to_string())?;

    if data.len() < 26 || &data[0..4] != b"8BPS" {
        log::warn!("Geçersiz PSD magic: {}", path);
        return Ok(String::new());
    }

    let channels = u16::from_be_bytes([data[12], data[13]]) as usize;
    let height   = u32::from_be_bytes([data[14], data[15], data[16], data[17]]) as usize;
    let width    = u32::from_be_bytes([data[18], data[19], data[20], data[21]]) as usize;
    let depth    = u16::from_be_bytes([data[22], data[23]]) as usize;
    let color_mode = u16::from_be_bytes([data[24], data[25]]);

    if width == 0 || height == 0 || width > 30000 || height > 30000 || depth != 8 {
        log::warn!("PSD boyut/derinlik desteklenmiyor: {}x{} depth={}", width, height, depth);
        return Ok(String::new());
    }

    let mut off = 26;
    if off + 4 > data.len() { return Ok(String::new()); }
    let color_mode_len = u32::from_be_bytes([data[off], data[off+1], data[off+2], data[off+3]]) as usize;
    off += 4 + color_mode_len;

    if off + 4 > data.len() { return Ok(String::new()); }
    let img_res_len = u32::from_be_bytes([data[off], data[off+1], data[off+2], data[off+3]]) as usize;
    off += 4 + img_res_len;

    if off + 4 > data.len() { return Ok(String::new()); }
    let layer_len = u32::from_be_bytes([data[off], data[off+1], data[off+2], data[off+3]]) as usize;
    off += 4 + layer_len;

    if off + 2 > data.len() { return Ok(String::new()); }
    let compression = u16::from_be_bytes([data[off], data[off+1]]);
    off += 2;

    log::info!("PSD: {}x{} ch={} comp={} mode={} - {}", width, height, channels, compression, color_mode, path);

    let plane_size = width.checked_mul(height)
        .ok_or_else(|| format!("PSD boyut taşması ({}x{})", width, height))?;
    let mut channel_data: Vec<Vec<u8>> = Vec::new();

    if compression == 0 {
        for ch in 0..channels {
            let ch_offset = ch.checked_mul(plane_size)
                .ok_or_else(|| format!("PSD kanal taşması ch={}", ch))?;
            let start = off.checked_add(ch_offset)
                .ok_or_else(|| "PSD ofset taşması".to_string())?;
            let end = start.checked_add(plane_size)
                .ok_or_else(|| "PSD ofset taşması".to_string())?;
            if end > data.len() {
                log::warn!("PSD raw data yetersiz ch={}", ch);
                return Ok(String::new());
            }
            channel_data.push(data[start..end].to_vec());
        }
    } else if compression == 1 {
        let row_count_bytes = channels.checked_mul(height)
            .and_then(|v| v.checked_mul(2))
            .ok_or_else(|| "PSD RLE boyut taşması".to_string())?;
        if off + row_count_bytes > data.len() {
            log::warn!("PSD RLE row counts yetersiz");
            return Ok(String::new());
        }
        let total_rows = channels.checked_mul(height)
            .ok_or_else(|| "PSD satır sayısı taşması".to_string())?;
        // Read the per-row byte counts so we can navigate compressed data reliably
        let mut row_sizes: Vec<u16> = Vec::with_capacity(total_rows);
        for i in 0..total_rows {
            let idx = off + i.checked_mul(2).ok_or_else(|| "PSD RLE index taşması".to_string())?;
            if idx + 1 >= data.len() { break; }
            row_sizes.push(u16::from_be_bytes([data[idx], data[idx + 1]]));
        }
        off += row_count_bytes;

        for ch in 0..channels {
            let mut plane = Vec::with_capacity(plane_size);
            for row in 0..height {
                let row_bytes = row_sizes[ch * height + row] as usize;
                if off + row_bytes > data.len() {
                    log::warn!("PSD RLE data yetersiz ch={} row={}", ch, row);
                    break;
                }
                psd_unpack_bits(&data[off..off + row_bytes], &mut plane, width);
                off += row_bytes;
            }
            // Pad if decompression yielded fewer bytes than expected
            plane.resize(plane_size, 0);
            channel_data.push(plane);
        }
    } else {
        log::warn!("PSD desteklenmeyen sıkıştırma: {}", compression);
        return Ok(String::new());
    }

    if channel_data.is_empty() {
        return Ok(String::new());
    }

    let mut rgb = Vec::with_capacity(width * height * 3);

    if color_mode == 4 && channel_data.len() >= 4 {
        // CMYK → RGB conversion
        for i in 0..plane_size {
            let c = channel_data[0].get(i).copied().unwrap_or(0) as f32;
            let m = channel_data[1].get(i).copied().unwrap_or(0) as f32;
            let y = channel_data[2].get(i).copied().unwrap_or(0) as f32;
            let k = channel_data[3].get(i).copied().unwrap_or(0) as f32;
            // PSD stores CMYK inverted: 0=full ink, 255=no ink
            let r = ((255.0 - c) * (255.0 - k) / 255.0) as u8;
            let g = ((255.0 - m) * (255.0 - k) / 255.0) as u8;
            let b = ((255.0 - y) * (255.0 - k) / 255.0) as u8;
            rgb.push(r);
            rgb.push(g);
            rgb.push(b);
        }
    } else if color_mode == 1 || channels == 1 {
        // Grayscale
        for i in 0..plane_size {
            let v = channel_data[0].get(i).copied().unwrap_or(0);
            rgb.push(v);
            rgb.push(v);
            rgb.push(v);
        }
    } else {
        // RGB (mode 3) — use first 3 channels
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

    let img = image::RgbImage::from_raw(width as u32, height as u32, rgb)
        .ok_or_else(|| "PSD RGB buffer hatası".to_string())?;

    encode_thumb(image::DynamicImage::ImageRgb8(img))
        .ok_or_else(|| "PSD thumbnail encode hatası".to_string())
}

/// Extracts the embedded BMP preview from an AutoCAD DWG file (R2000+).
///
/// The image section offset is stored as a 4-byte LE value at 0x0D.
/// After a 16-byte sentinel the section layout differs by version:
///
///   R2000 (AC1015):  sentinel(16) + count(1) + [type(1)+start(4)+size(4)]×N
///   R2004+ (AC1018+): sentinel(16) + overall_size(4) + count(1) + [...]×N
///
/// Type 2 = BMP DIB (BITMAPINFOHEADER, no BITMAPFILEHEADER prepended).
#[tauri::command]
pub fn get_dwg_thumbnail(path: String) -> Result<ThumbnailResult, String> {
    log::info!("DWG thumbnail extraction başladı: {}", path);

    let file_size = fs::metadata(&path).map_err(|e| {
        log::warn!("DWG metadata okunamadı: {} - {}", path, e);
        e.to_string()
    })?.len();

    log::debug!("DWG dosya boyutu: {} bytes", file_size);

    // 500 MB limit — DWG byte-array olarak okunur (CFB degil), buyuk dosya RAM'i sisirir.
    if file_size > 500 * 1024 * 1024 {
        log::info!("DWG çok büyük (>500MB), thumbnail atlandı: {}", path);
        return Ok(ThumbnailResult::missing("file_too_big"));
    }

    let data = fs::read(&path).map_err(|e| {
        log::error!("DWG dosya okunamadı: {} - {}", path, e);
        e.to_string()
    })?;

    if data.len() < 0x12 || &data[0..2] != b"AC" {
        log::warn!("Geçersiz DWG magic bytes: {}", path);
        return Ok(ThumbnailResult::missing("parse_failed"));
    }

    let version_str = std::str::from_utf8(&data[0..6]).unwrap_or("??????");
    log::info!("DWG versiyonu: {} - {}", version_str, path);

    let seeker = u32::from_le_bytes([data[0x0D], data[0x0E], data[0x0F], data[0x10]]) as usize;
    log::debug!("Image seeker offset: 0x{:X}", seeker);

    if seeker == 0 {
        log::warn!("Image seeker sıfır (preview yok): {}", path);
        return Ok(ThumbnailResult::missing("no_preview_in_file"));
    }

    if seeker + 21 >= data.len() {
        log::warn!("seeker bölgesi dosya boyutunu aşıyor: {}", path);
        return Ok(ThumbnailResult::missing("parse_failed"));
    }

    // Try to read descriptors, validating that they make sense.
    // Layout A = sentinel(16) + count(1) + descriptors  (R2000 AC1015)
    // Layout B = sentinel(16) + overall_size(4) + count(1) + descriptors  (R13/R14, R2004+)
    fn read_descriptors(data: &[u8], count_off: usize, desc_off: usize, _file_len: usize) -> Vec<(u8, usize, usize)> {
        if count_off >= data.len() { return Vec::new(); }
        let count = data[count_off] as usize;
        if count == 0 || count > 20 { return Vec::new(); }
        let mut result = Vec::new();
        let mut cur = desc_off;
        for _ in 0..count {
            // Bounds check: cur..cur+8 (inclusive) = 9 bytes needed
            if cur + 9 > data.len() { break; }
            let t = data[cur];
            let s = u32::from_le_bytes([data[cur+1], data[cur+2], data[cur+3], data[cur+4]]) as usize;
            let z = u32::from_le_bytes([data[cur+5], data[cur+6], data[cur+7], data[cur+8]]) as usize;
            cur += 9;
            result.push((t, s, z));
        }
        result
    }
    fn descriptors_valid(descs: &[(u8, usize, usize)], file_len: usize) -> bool {
        if descs.is_empty() { return false; }
        descs.iter().any(|&(t, s, z)| {
            (t == 2 || t == 3 || t == 6) && z > 8 && s + z <= file_len
        })
    }

    // Try Layout B first (more common overall), then Layout A
    let layout_b = (seeker + 20, seeker + 21); // with overall_size
    let layout_a = (seeker + 16, seeker + 17); // without overall_size

    let descs_b = read_descriptors(&data, layout_b.0, layout_b.1, data.len());
    let descs_a = read_descriptors(&data, layout_a.0, layout_a.1, data.len());

    let (descriptors, layout_name) = if descriptors_valid(&descs_b, data.len()) {
        (descs_b, "B (with overall_size)")
    } else if descriptors_valid(&descs_a, data.len()) {
        (descs_a, "A (no overall_size)")
    } else if !descs_b.is_empty() {
        (descs_b, "B (fallback)")
    } else {
        (descs_a, "A (fallback)")
    };

    log::info!("Layout {} kullanılıyor, {} descriptor bulundu - {}", layout_name, descriptors.len(), path);
    for (i, &(t, s, z)) in descriptors.iter().enumerate() {
        log::debug!("Image {}: type={}, start=0x{:X}, size={}", i, t, s, z);
    }
    let _count = descriptors.len();

    // Try Type 6 or 3 (PNG) first — higher quality than BMP
    for &(img_type, img_start, img_size) in &descriptors {
        if (img_type == 6 || img_type == 3) && img_size > 8 && img_start + img_size <= data.len() {
            let png_data = &data[img_start..img_start + img_size];
            // Verify PNG magic bytes
            if png_data.len() >= 8 && png_data[0..4] == [0x89, 0x50, 0x4E, 0x47] {
                log::debug!("PNG image bulundu (type={})", img_type);
                match image::load_from_memory_with_format(png_data, image::ImageFormat::Png) {
                    Ok(img) => {
                        log::info!("DWG PNG thumbnail decode edildi: {}", path);
                        if let Some(result) = encode_thumb(img) {
                            return Ok(ThumbnailResult::ok(result));
                        }
                    }
                    Err(e) => log::warn!("PNG decode hatası: {}", e),
                }
            }
            // Some DWG store raw PNG without the magic — try loading anyway
            if let Ok(img) = image::load_from_memory(png_data) {
                log::info!("DWG generic image decode edildi (type={}): {}", img_type, path);
                if let Some(result) = encode_thumb(img) {
                    return Ok(ThumbnailResult::ok(result));
                }
            }
        }
    }

    // Then try Type 2 (BMP DIB)
    for &(img_type, img_start, img_size) in &descriptors {
        if img_type != 2 || img_size < 40 || img_start + img_size > data.len() {
            continue;
        }

        let dib = &data[img_start..img_start + img_size];

        let header_size = u32::from_le_bytes([dib[0], dib[1], dib[2], dib[3]]);
        let bit_count   = u16::from_le_bytes([dib[14], dib[15]]) as u32;
        let clr_used    = u32::from_le_bytes([dib[32], dib[33], dib[34], dib[35]]);
        let num_colors  = if bit_count <= 8 {
            if clr_used > 0 { clr_used } else { 1u32 << bit_count }
        } else { 0 };
        let pixel_offset = 14u32 + header_size + num_colors * 4;

        log::debug!("DIB header: size={}, bits={}, colors={}", header_size, bit_count, num_colors);

        let mut bmp = Vec::with_capacity(14 + dib.len());
        bmp.extend_from_slice(b"BM");
        bmp.extend_from_slice(&((14 + dib.len()) as u32).to_le_bytes());
        bmp.extend_from_slice(&0u32.to_le_bytes());
        bmp.extend_from_slice(&pixel_offset.to_le_bytes());
        bmp.extend_from_slice(dib);

        match image::load_from_memory_with_format(&bmp, image::ImageFormat::Bmp) {
            Ok(img) => {
                log::info!("DWG BMP thumbnail decode edildi: {}", path);
                if let Some(result) = encode_thumb(img) {
                    return Ok(ThumbnailResult::ok(result));
                }
            }
            Err(e) => {
                log::warn!("BMP decode hatası: {} - {}", path, e);
            }
        }
    }

    // Last resort: scan for BITMAPINFOHEADER near the seeker region
    let scan_start = seeker.saturating_sub(64);
    let scan_end = (seeker + 2048).min(data.len());
    if scan_end > scan_start + 44 {
        for pos in scan_start..scan_end.saturating_sub(40) {
            let hs = u32::from_le_bytes([data[pos], data[pos+1], data[pos+2], data[pos+3]]);
            // BITMAPINFOHEADER = 40 bytes, BITMAPV4/V5 = 108/124
            if (hs == 40 || hs == 108 || hs == 124) && pos + (hs as usize) < data.len() {
                let w = i32::from_le_bytes([data[pos+4], data[pos+5], data[pos+6], data[pos+7]]);
                let h = i32::from_le_bytes([data[pos+8], data[pos+9], data[pos+10], data[pos+11]]);
                if w > 10 && w < 2000 && h.abs() > 10 && h.abs() < 2000 {
                    let bc = u16::from_le_bytes([data[pos+14], data[pos+15]]) as u32;
                    if bc == 8 || bc == 24 || bc == 32 {
                        let cu = u32::from_le_bytes([data[pos+32], data[pos+33], data[pos+34], data[pos+35]]);
                        let nc = if bc <= 8 { if cu > 0 { cu } else { 1u32 << bc } } else { 0 };
                        let po = 14u32 + hs + nc * 4;
                        let estimated_size = (hs as usize) + (nc as usize) * 4 +
                            (((w as usize) * (bc as usize)).div_ceil(32) * 4) * (h.unsigned_abs() as usize);
                        let avail = data.len() - pos;
                        let take = estimated_size.min(avail);
                        if take > 40 {
                            let dib = &data[pos..pos + take];
                            let mut bmp = Vec::with_capacity(14 + take);
                            bmp.extend_from_slice(b"BM");
                            bmp.extend_from_slice(&((14 + take) as u32).to_le_bytes());
                            bmp.extend_from_slice(&0u32.to_le_bytes());
                            bmp.extend_from_slice(&po.to_le_bytes());
                            bmp.extend_from_slice(dib);
                            if let Ok(img) = image::load_from_memory_with_format(&bmp, image::ImageFormat::Bmp) {
                                log::info!("DWG brute-force BMP bulundu pos=0x{:X}: {}", pos, path);
                                if let Some(result) = encode_thumb(img) {
                                    return Ok(ThumbnailResult::ok(result));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    log::warn!("DWG thumbnail bulunamadı: {}", path);
    Ok(ThumbnailResult::missing("parse_failed"))
}

/// Parses an OLE SummaryInformation property stream to extract the thumbnail
/// stored in property ID 0x11 (VT_CF).  3ds Max stores a DIB (BMP without file
/// header), JPEG, or PNG inside this property.  Returns a complete BMP byte
/// vector (with BITMAPFILEHEADER) or raw JPEG/PNG bytes ready for the image
/// crate to decode.
pub fn parse_ole_thumbnail(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < 0x30 { return None; }
    // Byte-order mark must be FE FF (little-endian property set)
    if data[0] != 0xFE || data[1] != 0xFF { return None; }

    // Number of property sets at 0x18
    let num_sets = u32::from_le_bytes([data[0x18], data[0x19], data[0x1A], data[0x1B]]);
    if num_sets == 0 { return None; }

    // Offset of first property set header (after 16-byte FMTID at 0x1C)
    let ps_offset = u32::from_le_bytes([data[0x2C], data[0x2D], data[0x2E], data[0x2F]]) as usize;
    if ps_offset + 8 > data.len() { return None; }

    // Property set: [size(4)] [count(4)] [(id(4) offset(4)) * count]
    let count = u32::from_le_bytes([data[ps_offset+4], data[ps_offset+5],
                                    data[ps_offset+6], data[ps_offset+7]]) as usize;

    let mut thumb_prop_offset: Option<usize> = None;
    for i in 0..count {
        let eo = ps_offset + 8 + i * 8;
        if eo + 8 > data.len() { break; }
        let pid  = u32::from_le_bytes([data[eo],   data[eo+1], data[eo+2], data[eo+3]]);
        let poff = u32::from_le_bytes([data[eo+4], data[eo+5], data[eo+6], data[eo+7]]) as usize;
        if pid == 0x11 { thumb_prop_offset = Some(ps_offset + poff); break; }
    }

    let toff = thumb_prop_offset?;
    if toff + 12 > data.len() { return None; }

    // Property value: VT(4) cbSize(4) ulClipFmt(4) pClipData[cbSize-4]
    let vt = u32::from_le_bytes([data[toff], data[toff+1], data[toff+2], data[toff+3]]);
    if vt != 71 { return None; } // VT_CF

    let cb_size = u32::from_le_bytes([data[toff+4], data[toff+5],
                                      data[toff+6], data[toff+7]]) as usize;
    let clip_start = toff + 12; // skip VT + cbSize + ulClipFmt
    let clip_end   = (toff + 4 + cb_size).min(data.len());
    if clip_start >= clip_end { return None; }
    let clip = &data[clip_start..clip_end];

    // 1. JPEG
    if let Some(pos) = clip.windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) {
        return Some(clip[pos..].to_vec());
    }
    // 2. PNG
    if let Some(pos) = clip.windows(4).position(|w| w == [0x89, 0x50, 0x4E, 0x47]) {
        return Some(clip[pos..].to_vec());
    }
    // 3. DIB (BITMAPINFOHEADER, biSize=40, no BM file header)
    for i in 0..clip.len().saturating_sub(40) {
        if clip[i..i+4] != [40, 0, 0, 0] { continue; }
        let w     = i32::from_le_bytes([clip[i+4],  clip[i+5],  clip[i+6],  clip[i+7]]);
        let h     = i32::from_le_bytes([clip[i+8],  clip[i+9],  clip[i+10], clip[i+11]]);
        let planes = u16::from_le_bytes([clip[i+12], clip[i+13]]);
        let bits   = u16::from_le_bytes([clip[i+14], clip[i+15]]);
        let comp   = u32::from_le_bytes([clip[i+16], clip[i+17], clip[i+18], clip[i+19]]);

        if w <= 0 || w > 4000 { continue; }
        if h == 0 || h.abs() > 4000 { continue; }
        if planes != 1 { continue; }
        if !matches!(bits, 8 | 16 | 24 | 32) { continue; }
        if comp > 1 { continue; }

        let clr_used = u32::from_le_bytes([clip[i+32], clip[i+33], clip[i+34], clip[i+35]]);
        let num_colors: u32 = if bits <= 8 {
            if clr_used > 0 { clr_used } else { 1u32 << bits }
        } else { 0 };
        let pixel_offset = 14u32 + 40 + num_colors * 4;
        let dib = &clip[i..];

        let mut bmp = Vec::with_capacity(14 + dib.len());
        bmp.extend_from_slice(b"BM");
        bmp.extend_from_slice(&((14u32 + dib.len() as u32).to_le_bytes()));
        bmp.extend_from_slice(&0u32.to_le_bytes());
        bmp.extend_from_slice(&pixel_offset.to_le_bytes());
        bmp.extend_from_slice(dib);
        return Some(bmp);
    }
    None
}

/// Extracts the thumbnail from a 3ds Max .max (CFB/OLE) file.
/// Strategy:
///   1. Parse the \x05SummaryInformation OLE property stream for property 0x11
///      (VT_CF thumbnail) – handles DIB/BMP, JPEG, PNG.
///   2. Fallback: scan all other streams for JPEG / PNG magic bytes.
#[tauri::command]
pub fn get_max_thumbnail(path: String) -> Result<ThumbnailResult, String> {
    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    // 2 GB ust limit — 3ds Max sahneleri sik sik 200 MB'i asar; CFB seek-based
    // oldugu icin tum dosya RAM'e yuklenmez, sadece ilgili stream okunur.
    if file_size > 2 * 1024 * 1024 * 1024 {
        return Ok(ThumbnailResult::missing("file_too_big"));
    }

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut comp = match CompoundFile::open(file) {
        Ok(c) => c,
        Err(_) => return Ok(ThumbnailResult::missing("parse_failed")),
    };

    // Collect stream paths (walk borrows &self, open_stream needs &mut self)
    // 50 MB ust limit — uzun history iceren MAX'larda SummaryInformation 10 MB'i asabilir.
    let streams: Vec<_> = comp
        .walk()
        .filter(|e| e.is_stream())
        .map(|e| (e.path().to_path_buf(), e.len() as usize))
        .filter(|(_, len)| *len > 40 && *len < 50_000_000)
        .collect();

    for (stream_path, _) in &streams {
        let mut stream = match comp.open_stream(stream_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut buf = Vec::new();
        if stream.read_to_end(&mut buf).is_err() {
            continue;
        }

        // ── Strategy 1: OLE SummaryInformation property 0x11 ──────────────
        let name = stream_path.to_str().unwrap_or("");
        if name.contains('\u{0005}') && name.contains("SummaryInformation")
            && !name.contains("Document")
        {
            if let Some(img_bytes) = parse_ole_thumbnail(&buf) {
                let load_result = if img_bytes.starts_with(b"BM") {
                    image::load_from_memory_with_format(&img_bytes, image::ImageFormat::Bmp)
                } else {
                    image::load_from_memory(&img_bytes)
                };
                if let Ok(img) = load_result {
                    if let Some(result) = encode_thumb(img) {
                        return Ok(ThumbnailResult::ok(result));
                    }
                }
            }
            continue; // don't do the generic scan on this stream
        }

        // ── Strategy 2: generic JPEG / PNG scan in other streams ──────────
        if let Some(pos) = buf.windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) {
            if let Ok(img) = image::load_from_memory(&buf[pos..]) {
                if let Some(result) = encode_thumb(img) {
                    return Ok(ThumbnailResult::ok(result));
                }
            }
        }
        if let Some(pos) = buf.windows(4).position(|w| w == [0x89, 0x50, 0x4E, 0x47]) {
            if let Ok(img) = image::load_from_memory(&buf[pos..]) {
                if let Some(result) = encode_thumb(img) {
                    return Ok(ThumbnailResult::ok(result));
                }
            }
        }
    }

    Ok(ThumbnailResult::missing("no_preview_in_file"))
}

/// Extracts the embedded thumbnail from Office Open XML files (DOCX, XLSX, PPTX)
/// and legacy OLE Office files (DOC, XLS).
///
/// - DOCX/XLSX/PPTX: ZIP archive → `docProps/thumbnail.jpeg` or `.png`
/// - DOC/XLS: OLE/CFB compound file → `\x05SummaryInformation` property 0x11
#[tauri::command]
pub fn get_office_thumbnail(path: String) -> Result<String, String> {
    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if file_size > 100 * 1024 * 1024 {
        return Ok(String::new());
    }

    // ── Strategy 1: ZIP-based formats (DOCX, XLSX, PPTX) ──────────────────
    if let Ok(data) = fs::read(&path) {
        // ZIP magic: PK\x03\x04
        if data.len() >= 4 && data[0] == 0x50 && data[1] == 0x4B
            && data[2] == 0x03 && data[3] == 0x04
        {
            let cursor = Cursor::new(&data);
            if let Ok(mut archive) = zip::ZipArchive::new(cursor) {
                // Try common thumbnail entry names
                for name in &[
                    "docProps/thumbnail.jpeg",
                    "docProps/thumbnail.jpg",
                    "docProps/thumbnail.png",
                    "docProps/thumbnail.emf",
                ] {
                    if let Ok(mut entry) = archive.by_name(name) {
                        let mut buf = Vec::new();
                        if entry.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                            // EMF not supported by image crate — skip
                            if name.ends_with(".emf") { continue; }
                            if let Ok(img) = image::load_from_memory(&buf) {
                                if let Some(result) = encode_thumb(img) {
                                    return Ok(result);
                                }
                            }
                        }
                    }
                }
            }
        }

        // ── Strategy 2: OLE/CFB formats (DOC, XLS) ────────────────────────
        if data.len() >= 8 && data[0] == 0xD0 && data[1] == 0xCF {
            let cursor = Cursor::new(&data);
            if let Ok(mut comp) = CompoundFile::open(cursor) {
                let streams: Vec<_> = comp
                    .walk()
                    .filter(|e| e.is_stream())
                    .filter(|e| {
                        let n = e.path().to_str().unwrap_or("");
                        n.contains('\u{0005}') && n.contains("SummaryInformation")
                            && !n.contains("Document")
                    })
                    .map(|e| e.path().to_path_buf())
                    .collect();

                for stream_path in &streams {
                    let mut stream = match comp.open_stream(stream_path) {
                        Ok(s) => s,
                        Err(_) => continue,
                    };
                    let mut buf = Vec::new();
                    if stream.read_to_end(&mut buf).is_err() { continue; }
                    if let Some(img_bytes) = parse_ole_thumbnail(&buf) {
                        let load_result = if img_bytes.starts_with(b"BM") {
                            image::load_from_memory_with_format(&img_bytes, image::ImageFormat::Bmp)
                        } else {
                            image::load_from_memory(&img_bytes)
                        };
                        if let Ok(img) = load_result {
                            if let Some(result) = encode_thumb(img) {
                                return Ok(result);
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(String::new())
}

/// Extracts the first suitable embedded JPEG or PNG image from a PDF file.
/// Many PDFs embed page images as raw DCT (JPEG) or Flate (PNG) streams.
#[tauri::command]
pub fn get_pdf_thumbnail(path: String) -> Result<String, String> {
    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if file_size > 150 * 1024 * 1024 {
        return Ok(String::new());
    }
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    if data.len() < 4 || &data[0..4] != b"%PDF" {
        return Ok(String::new());
    }

    // Tüm dosyayı tara (150MB sınırı zaten yukarıda).
    // Mimari PDF'ler genellikle büyük gömülü görseller içerir (CAD export).
    let scan_limit = data.len();
    let min_dim = 40; // küçük ikonları/logoları atla, ama küçük thumbnail'leri yakala

    // Scan for JPEG (FF D8 FF) magic bytes
    let mut i = 0;
    while i + 3 < scan_limit {
        if data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF {
            if let Ok(img) = image::load_from_memory_with_format(&data[i..], image::ImageFormat::Jpeg) {
                if img.width() > min_dim && img.height() > min_dim {
                    if let Some(result) = encode_thumb(img) {
                        return Ok(result);
                    }
                }
            }
            i += 3;
        } else {
            i += 1;
        }
    }

    // Scan for PNG (89 50 4E 47 0D 0A 1A 0A) magic bytes
    let png_magic = [0x89u8, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    for j in 0..scan_limit.saturating_sub(8) {
        if data[j..j + 8] == png_magic {
            if let Ok(img) = image::load_from_memory_with_format(&data[j..], image::ImageFormat::Png) {
                if img.width() > min_dim && img.height() > min_dim {
                    if let Some(result) = encode_thumb(img) {
                        return Ok(result);
                    }
                }
            }
        }
    }

    Ok(String::new())
}

/// Extracts the embedded JPEG preview from a SketchUp (.skp) file.
/// SketchUp 7+ embeds a JPEG thumbnail inside the binary file data.
/// We scan the first 4 MB for JPEG magic bytes and return the largest valid image found.
#[tauri::command]
pub fn get_skp_thumbnail(path: String) -> Result<String, String> {
    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if file_size > 200 * 1024 * 1024 {
        return Ok(String::new());
    }
    let data = fs::read(&path).map_err(|e| e.to_string())?;

    // SketchUp files start with a version-specific header; we don't validate it
    // strictly — just scan for the embedded JPEG preview.
    let scan_limit = (4 * 1024 * 1024).min(data.len());

    let mut best: Option<(u32, String)> = None; // (pixel area, data url)
    let mut i = 0;
    while i + 3 < scan_limit {
        if data[i] == 0xFF && data[i + 1] == 0xD8 && data[i + 2] == 0xFF {
            if let Ok(img) = image::load_from_memory_with_format(&data[i..], image::ImageFormat::Jpeg) {
                let area = img.width() * img.height();
                if area > 64 * 64 {
                    if let Some(result) = encode_thumb(img) {
                        match &best {
                            None => { best = Some((area, result)); }
                            Some((prev_area, _)) if area > *prev_area => { best = Some((area, result)); }
                            _ => {}
                        }
                    }
                }
            }
            i += 3;
        } else {
            i += 1;
        }
    }

    Ok(best.map(|(_, url)| url).unwrap_or_default())
}

/// Reads the first ~500 chars of a text file and renders them as an SVG thumbnail.
/// Returned as a `data:image/svg+xml;base64,...` URL suitable for <img src>.
#[tauri::command]
pub fn get_text_thumbnail(path: String) -> Result<String, String> {
    use std::io::BufReader;

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file);
    let mut raw = vec![0u8; 1024];
    let n = reader.read(&mut raw).unwrap_or(0);
    raw.truncate(n);

    let text = String::from_utf8_lossy(&raw);
    let lines: Vec<&str> = text.lines().take(12).collect();

    let mut text_rows = String::new();
    for (i, line) in lines.iter().enumerate() {
        let y = 24 + i * 15;
        let escaped = line
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;");
        let chars: Vec<char> = escaped.chars().collect();
        let display: String = if chars.len() > 34 {
            format!("{}…", chars[..34].iter().collect::<String>())
        } else {
            chars.iter().collect()
        };
        let opacity = if i == 0 { "0.85" } else { "0.6" };
        text_rows.push_str(&format!(
            r##"<text x="10" y="{}" font-family="monospace" font-size="8.5" fill="#9999bb" opacity="{}">{}</text>"##,
            y, opacity, display
        ));
    }

    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <rect width="200" height="200" fill="#0f0f1e"/>
  <rect x="6" y="6" width="188" height="188" rx="6" fill="#14142a" stroke="#252545" stroke-width="1"/>
  <rect x="6" y="6" width="188" height="18" rx="6" fill="#1e1e3a"/>
  <rect x="6" y="18" width="188" height="6" fill="#1e1e3a"/>
  <text x="10" y="19" font-family="sans-serif" font-size="9" fill="#5555aa" font-weight="bold">TXT</text>
  {}
</svg>"##,
        text_rows
    );

    let b64 = general_purpose::STANDARD.encode(svg.as_bytes());
    Ok(format!("data:image/svg+xml;base64,{}", b64))
}

/// Generates a styled SVG thumbnail for any document type.
/// Shows the file extension as a large label, a document icon shape, and the filename.
#[tauri::command]
pub fn get_doc_icon_thumbnail(file_type: String, file_name: String) -> Result<String, String> {
    let default_label = file_type.clone();
    let (bg_color, accent, label): (&str, &str, &str) = match file_type.as_str() {
        "PDF"   => ("#1a0a0a", "#e04040", "PDF"),
        "DOC"   => ("#0a0a1a", "#4080e0", "DOC"),
        "XLS"   => ("#0a1a0a", "#30a050", "XLS"),
        "PPT"   => ("#1a0a0a", "#e07030", "PPT"),
        "TXT"   => ("#0f0f1e", "#8888aa", "TXT"),
        "CSV"   => ("#0a1a0a", "#40b060", "CSV"),
        "RTF"   => ("#0a0a1a", "#5090d0", "RTF"),
        "SAP2K" => ("#1a1a0a", "#c0a030", "SAP"),
        "BAK"   => ("#1a1a1a", "#707070", "BAK"),
        "MTL"   => ("#0f1a0f", "#60a070", "MTL"),
        "EPS"   => ("#1a0a1a", "#b050d0", "EPS"),
        "SKP"   => ("#0a1218", "#e8a020", "SKP"),
        _       => ("#10101a", "#6070a0", &default_label),
    };

    let name_escaped = file_name
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");
    let chars: Vec<char> = name_escaped.chars().collect();
    let short_name: String = if chars.len() > 22 {
        format!("{}…", chars[..22].iter().collect::<String>())
    } else {
        chars.iter().collect()
    };

    let svg = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
  <rect width="200" height="200" rx="4" fill="{bg}"/>
  <!-- Document shape -->
  <g transform="translate(55,25)">
    <path d="M0 0 h65 l25 25 v95 h-90 z" fill="#181828" stroke="{ac}" stroke-width="1.2" opacity="0.85"/>
    <path d="M65 0 v25 h25" fill="none" stroke="{ac}" stroke-width="1.2" opacity="0.6"/>
    <!-- Lines inside doc -->
    <line x1="12" y1="42" x2="75" y2="42" stroke="{ac}" stroke-width="1" opacity="0.18"/>
    <line x1="12" y1="54" x2="70" y2="54" stroke="{ac}" stroke-width="1" opacity="0.14"/>
    <line x1="12" y1="66" x2="65" y2="66" stroke="{ac}" stroke-width="1" opacity="0.12"/>
    <line x1="12" y1="78" x2="58" y2="78" stroke="{ac}" stroke-width="1" opacity="0.10"/>
  </g>
  <!-- Extension badge -->
  <rect x="10" y="140" width="56" height="24" rx="5" fill="{ac}" opacity="0.9"/>
  <text x="38" y="157" font-family="sans-serif" font-weight="bold" font-size="13" fill="#fff" text-anchor="middle">{lbl}</text>
  <!-- File name -->
  <text x="100" y="186" font-family="sans-serif" font-size="8.5" fill="#aaaacc" text-anchor="middle" opacity="0.7">{name}</text>
</svg>"##,
        bg = bg_color, ac = accent, lbl = label, name = short_name
    );

    let b64 = general_purpose::STANDARD.encode(svg.as_bytes());
    Ok(format!("data:image/svg+xml;base64,{}", b64))
}

/// Extracts embedded TIFF preview from EPS binary header (if present).
/// EPS binary header magic: 0xC5D0D3C6
/// Offsets 20-23: TIFF preview offset (u32 LE)
/// Offsets 24-27: TIFF preview length (u32 LE)
/// Returns base64 JPEG data URL or empty string (fallback icon'a düşer).
#[tauri::command]
pub fn get_eps_thumbnail(path: String) -> Result<String, String> {
    let data = fs::read(&path).map_err(|e| format!("EPS okunamadı: {}", e))?;

    // Minimum 28 bytes for binary header
    if data.len() < 28 {
        return Ok(String::new());
    }

    // Check EPS binary header magic
    let magic = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    if magic != 0xC5D0_D3C6 {
        return Ok(String::new());
    }

    let tiff_offset = u32::from_le_bytes([data[20], data[21], data[22], data[23]]) as usize;
    let tiff_length = u32::from_le_bytes([data[24], data[25], data[26], data[27]]) as usize;

    if tiff_offset == 0 || tiff_length == 0 {
        return Ok(String::new());
    }

    let tiff_end = tiff_offset.checked_add(tiff_length).ok_or("TIFF boyut taşması")?;
    if tiff_end > data.len() {
        return Ok(String::new());
    }

    let tiff_data = &data[tiff_offset..tiff_end];
    let img = image::load_from_memory_with_format(tiff_data, image::ImageFormat::Tiff)
        .map_err(|e| format!("TIFF decode hatası: {}", e))?;

    encode_thumb(img).ok_or_else(|| "JPEG encode hatası".to_string())
}

/// Extracts an embedded thumbnail from a Revit (RVT/RFA) file.
///
/// RVT files are OLE/CFB compound files. This function uses the same strategy
/// as get_max_thumbnail:
///   1. Primary: OLE `\x05SummaryInformation` property 0x11 (thumbnail)
///   2. Fallback: scan all streams for JPEG / PNG magic bytes
#[tauri::command]
pub fn get_rvt_thumbnail(path: String) -> Result<String, String> {
    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if file_size > 500 * 1024 * 1024 {
        return Ok(String::new());
    }

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut comp = CompoundFile::open(file).map_err(|e| e.to_string())?;

    // Collect stream paths first (walk borrows &self, open_stream needs &mut self)
    let streams: Vec<_> = comp
        .walk()
        .filter(|e| e.is_stream())
        .map(|e| (e.path().to_path_buf(), e.len() as usize))
        .filter(|(_, len)| *len > 40 && *len < 10_000_000)
        .collect();

    for (stream_path, _) in &streams {
        let mut stream = match comp.open_stream(stream_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let mut buf = Vec::new();
        if stream.read_to_end(&mut buf).is_err() {
            continue;
        }

        // ── Strategy 1: OLE SummaryInformation property 0x11 ──
        let name = stream_path.to_str().unwrap_or("");
        if name.contains('\u{0005}') && name.contains("SummaryInformation")
            && !name.contains("Document")
        {
            if let Some(img_bytes) = parse_ole_thumbnail(&buf) {
                let load_result = if img_bytes.starts_with(b"BM") {
                    image::load_from_memory_with_format(&img_bytes, image::ImageFormat::Bmp)
                } else {
                    image::load_from_memory(&img_bytes)
                };
                if let Ok(img) = load_result {
                    if let Some(result) = encode_thumb(img) {
                        return Ok(result);
                    }
                }
            }
            continue;
        }

        // ── Strategy 2: generic JPEG / PNG scan ──
        if let Some(pos) = buf.windows(3).position(|w| w == [0xFF, 0xD8, 0xFF]) {
            if let Ok(img) = image::load_from_memory(&buf[pos..]) {
                if let Some(result) = encode_thumb(img) {
                    return Ok(result);
                }
            }
        }
        if let Some(pos) = buf.windows(4).position(|w| w == [0x89, 0x50, 0x4E, 0x47]) {
            if let Ok(img) = image::load_from_memory(&buf[pos..]) {
                if let Some(result) = encode_thumb(img) {
                    return Ok(result);
                }
            }
        }
    }

    Ok(String::new())
}
