use serde::Serialize;
use std::fs;
use std::io::{Read, Seek, SeekFrom};

#[derive(Serialize, Default)]
pub struct VideoRichMetadata {
    pub file_size_bytes: u64,
    pub duration_hint: Option<String>,   // from moov/mvhd atom if MP4
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub codec_hint: Option<String>,      // from stsd atom or ftyp
    pub file_type_brand: Option<String>, // ftyp brand (mp41, isom, etc)
}

/// Read a big-endian u32 from a byte slice at offset.
fn read_u32_be(data: &[u8], offset: usize) -> Option<u32> {
    if offset + 4 > data.len() {
        return None;
    }
    Some(u32::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
    ]))
}

/// Read a big-endian u64 from a byte slice at offset.
fn read_u64_be(data: &[u8], offset: usize) -> Option<u64> {
    if offset + 8 > data.len() {
        return None;
    }
    Some(u64::from_be_bytes([
        data[offset],
        data[offset + 1],
        data[offset + 2],
        data[offset + 3],
        data[offset + 4],
        data[offset + 5],
        data[offset + 6],
        data[offset + 7],
    ]))
}

/// Read 4-byte atom type as a &str-compatible fixed array.
fn atom_type(data: &[u8], offset: usize) -> Option<[u8; 4]> {
    if offset + 4 > data.len() {
        return None;
    }
    Some([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
}

/// Convert a 4-byte atom type to a string (printable ASCII only).
fn type_to_str(t: &[u8; 4]) -> String {
    t.iter()
        .map(|&b| if b.is_ascii_graphic() || b == b' ' { b as char } else { '?' })
        .collect()
}

/// Format duration from mvhd timescale and duration fields.
fn format_duration(duration_units: u64, timescale: u32) -> String {
    if timescale == 0 {
        return format!("{} units", duration_units);
    }
    let total_secs = duration_units / timescale as u64;
    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let secs = total_secs % 60;
    if hours > 0 {
        format!("{:02}:{:02}:{:02}", hours, minutes, secs)
    } else {
        format!("{:02}:{:02}", minutes, secs)
    }
}

/// Iterate top-level MP4 atoms. Returns (atom_type_4bytes, data_start_offset, data_length).
fn iter_atoms(data: &[u8]) -> Vec<([u8; 4], usize, usize)> {
    let mut result = Vec::new();
    let mut offset = 0usize;
    while offset + 8 <= data.len() {
        let size = match read_u32_be(data, offset) {
            Some(s) => s,
            None => break,
        };
        let atype = match atom_type(data, offset + 4) {
            Some(t) => t,
            None => break,
        };
        let (data_offset, atom_end) = if size == 1 {
            // Extended size: 8-byte size follows the type
            if offset + 16 > data.len() { break; }
            let ext = match read_u64_be(data, offset + 8) {
                Some(s) => s as usize,
                None => break,
            };
            if ext < 16 { break; }
            (offset + 16, offset + ext)
        } else if size == 0 {
            // Atom extends to end of file
            (offset + 8, data.len())
        } else {
            if size < 8 { break; }
            (offset + 8, offset + size as usize)
        };
        let atom_end = atom_end.min(data.len());
        let data_len = atom_end.saturating_sub(data_offset);
        result.push((atype, data_offset, data_len));
        if atom_end <= offset { break; }
        offset = atom_end;
    }
    result
}

/// Parse a moov atom to extract duration, timescale, width, height, codec.
fn parse_moov(
    data: &[u8],
    duration_hint: &mut Option<String>,
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, data_off, data_len) in iter_atoms(data) {
        let atom_data = &data[data_off..data_off + data_len];
        match &atype {
            b"mvhd" => {
                parse_mvhd(atom_data, duration_hint);
            }
            b"trak" => {
                parse_trak(atom_data, width, height, codec_hint);
            }
            _ => {}
        }
    }
}

/// Parse mvhd atom for timescale and duration.
fn parse_mvhd(data: &[u8], duration_hint: &mut Option<String>) {
    if data.is_empty() {
        return;
    }
    let version = data[0];
    // version 0: timescale at offset 12, duration at offset 16 (both u32)
    // version 1: timescale at offset 20 (u32), duration at offset 24 (u64)
    let (timescale, duration) = if version == 1 {
        if data.len() < 32 { return; }
        let ts = read_u32_be(data, 20).unwrap_or(0);
        let dur = read_u64_be(data, 24).unwrap_or(0);
        (ts, dur)
    } else {
        if data.len() < 20 { return; }
        let ts = read_u32_be(data, 12).unwrap_or(0);
        let dur = read_u32_be(data, 16).unwrap_or(0) as u64;
        (ts, dur)
    };
    if timescale > 0 && duration > 0 {
        *duration_hint = Some(format_duration(duration, timescale));
    }
}

/// Parse trak atom to extract width, height, codec.
fn parse_trak(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, data_off, data_len) in iter_atoms(data) {
        let atom_data = &data[data_off..data_off + data_len];
        match &atype {
            b"mdia" => parse_mdia(atom_data, width, height, codec_hint),
            b"tkhd" => parse_tkhd(atom_data, width, height),
            _ => {}
        }
    }
}

/// Parse tkhd atom for width and height (fixed-point 16.16).
fn parse_tkhd(data: &[u8], width: &mut Option<u32>, height: &mut Option<u32>) {
    if data.is_empty() { return; }
    let version = data[0];
    // version 0: width at offset 76, height at offset 80
    // version 1: width at offset 88, height at offset 92
    let (w_off, h_off) = if version == 1 { (88, 92) } else { (76, 80) };
    if let Some(w_fp) = read_u32_be(data, w_off) {
        let w = w_fp >> 16;
        if w > 0 && w <= 65535 {
            *width = Some(w);
        }
    }
    if let Some(h_fp) = read_u32_be(data, h_off) {
        let h = h_fp >> 16;
        if h > 0 && h <= 65535 {
            *height = Some(h);
        }
    }
}

/// Parse mdia atom.
fn parse_mdia(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, data_off, data_len) in iter_atoms(data) {
        let atom_data = &data[data_off..data_off + data_len];
        if &atype == b"minf" {
            parse_minf(atom_data, width, height, codec_hint);
        }
    }
}

/// Parse minf atom.
fn parse_minf(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, data_off, data_len) in iter_atoms(data) {
        let atom_data = &data[data_off..data_off + data_len];
        if &atype == b"stbl" {
            parse_stbl(atom_data, width, height, codec_hint);
        }
    }
}

/// Parse stbl atom to find stsd.
fn parse_stbl(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    for (atype, data_off, data_len) in iter_atoms(data) {
        let atom_data = &data[data_off..data_off + data_len];
        if &atype == b"stsd" {
            parse_stsd(atom_data, width, height, codec_hint);
        }
    }
}

/// Parse stsd (sample description) atom to get codec name and video dimensions.
fn parse_stsd(
    data: &[u8],
    width: &mut Option<u32>,
    height: &mut Option<u32>,
    codec_hint: &mut Option<String>,
) {
    // stsd: version(1) + flags(3) + entry_count(4) + entries
    if data.len() < 8 { return; }
    // entry_count at offset 4
    let entry_count = read_u32_be(data, 4).unwrap_or(0);
    if entry_count == 0 { return; }

    // First sample entry starts at offset 8
    // Each entry: size(4) + type(4) + reserved(6) + data_ref_index(2) + codec-specific
    let entry_offset = 8;
    if entry_offset + 8 > data.len() { return; }

    let entry_size = read_u32_be(data, entry_offset).unwrap_or(0) as usize;
    let entry_type = atom_type(data, entry_offset + 4);

    if let Some(et) = entry_type {
        let codec = type_to_str(&et);
        // Only set codec_hint for known video codec patterns, not audio
        let is_video = matches!(
            &et,
            b"avc1" | b"avc2" | b"avc3" | b"avc4"
            | b"hvc1" | b"hev1"
            | b"mp4v" | b"s263" | b"H263"
            | b"VP08" | b"VP09" | b"vp08" | b"vp09"
            | b"av01" | b"dvav" | b"dvhe"
        );
        if is_video && codec_hint.is_none() {
            *codec_hint = Some(codec);

            // Visual sample entry: reserved(6) + data_ref_index(2) + reserved(16) + width(2) + height(2)
            // That's at entry_offset + 8 (entry header) + 6 + 2 + 16 = entry_offset + 32
            let w_off = entry_offset + 8 + 6 + 2 + 16;
            let h_off = w_off + 2;
            let entry_end = match entry_offset.checked_add(entry_size) {
                Some(end) => end,
                None => return, // overflow: entry_size corrupt
            };
            let safe_end = entry_end.min(data.len());
            if h_off + 2 <= safe_end {
                if let (Some(w), Some(h)) = (
                    read_u16_be(data, w_off),
                    read_u16_be(data, h_off),
                ) {
                    if w > 0 { *width = Some(w as u32); }
                    if h > 0 { *height = Some(h as u32); }
                }
            }
        }
    }
}

fn read_u16_be(data: &[u8], offset: usize) -> Option<u16> {
    if offset + 2 > data.len() { return None; }
    Some(u16::from_be_bytes([data[offset], data[offset + 1]]))
}

/// Try to parse ftyp atom for brand info.
fn parse_ftyp(data: &[u8]) -> Option<String> {
    // ftyp data: major_brand(4) + minor_version(4) + compatible_brands...
    if data.len() < 4 { return None; }
    let brand = &data[0..4];
    let s: String = brand
        .iter()
        .map(|&b| if b.is_ascii_graphic() || b == b' ' { b as char } else { '?' })
        .collect();
    Some(s)
}

/// Try to detect video codec from raw AVI/MKV/WebM headers for non-MP4 files.
fn detect_non_mp4_codec(data: &[u8]) -> Option<String> {
    if data.len() < 12 { return None; }
    // AVI: RIFF....AVI
    if data.starts_with(b"RIFF") && data.len() >= 12 && &data[8..12] == b"AVI " {
        return Some("AVI".to_string());
    }
    // Matroska/WebM: EBML header magic 0x1A 0x45 0xDF 0xA3
    if data[0] == 0x1A && data[1] == 0x45 && data[2] == 0xDF && data[3] == 0xA3 {
        // Check for WebM marker further in
        if data.windows(4).any(|w| w == b"webm") {
            return Some("WebM".to_string());
        }
        return Some("Matroska".to_string());
    }
    // FLV: FLV header
    if data.starts_with(b"FLV") {
        return Some("FLV".to_string());
    }
    None
}

#[tauri::command]
pub fn extract_video_metadata(path: String) -> Result<VideoRichMetadata, String> {
    let file_size_bytes = fs::metadata(&path)
        .map_err(|e| e.to_string())?
        .len();

    // Read up to 32 MB for parsing (most MP4 moov atoms are near the start)
    const MAX_READ: u64 = 32 * 1024 * 1024;
    let f = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    f.take(MAX_READ).read_to_end(&mut data).map_err(|e| e.to_string())?;

    let mut meta = VideoRichMetadata {
        file_size_bytes,
        ..Default::default()
    };

    // Check for non-MP4 container first
    meta.codec_hint = detect_non_mp4_codec(&data);
    if meta.codec_hint.is_some() {
        return Ok(meta);
    }

    // Parse MP4 atoms at top level
    for (atype, data_off, data_len) in iter_atoms(&data) {
        let atom_data = &data[data_off..data_off + data_len];
        match &atype {
            b"ftyp" => {
                meta.file_type_brand = parse_ftyp(atom_data);
                // Use brand as initial codec hint if none set yet
                if meta.codec_hint.is_none() {
                    if let Some(ref brand) = meta.file_type_brand {
                        meta.codec_hint = Some(brand.trim().to_string());
                    }
                }
            }
            b"moov" => {
                parse_moov(
                    atom_data,
                    &mut meta.duration_hint,
                    &mut meta.width,
                    &mut meta.height,
                    &mut meta.codec_hint,
                );
            }
            _ => {}
        }
    }

    // If moov was not found near start, try seeking near end of file (common for streaming MP4)
    if meta.duration_hint.is_none() && file_size_bytes > MAX_READ {
        let tail_size = (512 * 1024).min(file_size_bytes as usize);
        let seek_pos = file_size_bytes - tail_size as u64;
        if let Ok(mut f2) = fs::File::open(&path) {
            if f2.seek(SeekFrom::Start(seek_pos)).is_ok() {
                let mut tail = Vec::new();
                if f2.take(tail_size as u64).read_to_end(&mut tail).is_ok() {
                    for (atype, data_off, data_len) in iter_atoms(&tail) {
                        let atom_data = &tail[data_off..data_off + data_len];
                        if &atype == b"moov" {
                            parse_moov(
                                atom_data,
                                &mut meta.duration_hint,
                                &mut meta.width,
                                &mut meta.height,
                                &mut meta.codec_hint,
                            );
                        }
                    }
                }
            }
        }
    }

    Ok(meta)
}
