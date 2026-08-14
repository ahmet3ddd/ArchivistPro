//! Eski ikili Office formatlari — OLE/CFBF konteyner + BIFF/PPT opcode-dispatch.
//!
//! DOC (WordDocument stream), XLS (BIFF SST/LABEL), PPT (TextChars/TextBytesAtom).
//! Ortak OLE stream okuma + ham-bayt printable fallback burada. Metin decode
//! [`super::smart_decode_bytes`] (CP1254/Turkce farkinda) ile yapilir.

use std::fs;
use std::io::Read;
use std::path::Path;

use super::smart_decode_bytes;

/// OLE compound dosyasinin belirtilen stream'lerinden ham bayt oku; bos ise tum
/// stream'lerden fallback (4 MB tavan).
fn read_ole_streams(path: &Path, primary_streams: &[&str]) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut comp = cfb::CompoundFile::open(file).map_err(|e| format!("OLE parse hatasi: {e}"))?;

    let mut all_bytes: Vec<u8> = Vec::new();
    for name in primary_streams {
        let stream_path = format!("/{name}");
        if let Ok(mut stream) = comp.open_stream(&stream_path) {
            let mut buf = Vec::new();
            if stream.read_to_end(&mut buf).is_ok() {
                all_bytes.extend_from_slice(&buf);
            }
        }
    }

    if all_bytes.is_empty() {
        let entries: Vec<String> = comp
            .walk()
            .filter(|e| !e.is_storage())
            .map(|e| e.path().to_string_lossy().to_string())
            .collect();
        for entry_path in entries {
            if let Ok(mut stream) = comp.open_stream(&entry_path) {
                let mut buf = Vec::new();
                if stream.read_to_end(&mut buf).is_ok() {
                    all_bytes.extend_from_slice(&buf);
                    if all_bytes.len() > 4 * 1024 * 1024 {
                        break;
                    }
                }
            }
        }
    }

    if all_bytes.is_empty() {
        return Err("OLE: okunabilir stream bulunamadi".to_string());
    }
    Ok(all_bytes)
}

/// Ham baytlardan okunabilir metin (UTF-16LE dene, sonra yazdirilabilir run'lar).
fn extract_text_from_bytes(all_bytes: &[u8], format_label: &str) -> Result<String, String> {
    let mut text = String::new();

    if all_bytes.len() >= 2 {
        let mut i = 0;
        let mut utf16_buf: Vec<u16> = Vec::new();
        while i + 1 < all_bytes.len() {
            utf16_buf.push(u16::from_le_bytes([all_bytes[i], all_bytes[i + 1]]));
            i += 2;
        }
        if let Ok(decoded) = String::from_utf16(&utf16_buf) {
            let filtered: String = decoded
                .chars()
                .filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
                .collect();
            if filtered.len() > 50 {
                text = filtered;
            }
        }
    }

    if text.len() < 50 {
        let decoded = smart_decode_bytes(all_bytes);
        let mut cp_text = String::new();
        let mut run = String::new();
        for ch in decoded.chars() {
            let keep = ch.is_alphanumeric()
                || ch.is_whitespace()
                || matches!(
                    ch,
                    '.' | ',' | ';' | ':' | '!' | '?' | '-' | '_' | '(' | ')' | '[' | ']'
                        | '{' | '}' | '/' | '\\' | '&' | '%' | '"' | '\'' | '#' | '+' | '=' | '*'
                        | '@'
                );
            if keep {
                run.push(ch);
            } else {
                if run.chars().count() >= 4 {
                    cp_text.push_str(&run);
                    cp_text.push(' ');
                }
                run.clear();
            }
        }
        if run.chars().count() >= 4 {
            cp_text.push_str(&run);
        }
        if cp_text.len() > text.len() {
            text = cp_text;
        }
    }

    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.len() < 20 {
        return Err(format!("{format_label}: yeterli metin cikarilamadi"));
    }
    Ok(text)
}

/// Eski .doc (OLE) — WordDocument stream'inden printable metin.
pub fn extract_doc_text(path: &Path) -> Result<String, String> {
    let all_bytes = read_ole_streams(path, &["WordDocument", "1Table", "0Table"])?;
    extract_text_from_bytes(&all_bytes, "DOC")
}

/// Eski .xls (BIFF) — SST (0x00FC) + LABEL (0x0204) kayitlari.
pub fn extract_xls_text(path: &Path) -> Result<String, String> {
    let all_bytes = read_ole_streams(path, &["Workbook", "Book"])?;

    let mut text = String::new();
    let mut i = 0;
    while i + 4 <= all_bytes.len() {
        let rec_id = u16::from_le_bytes([all_bytes[i], all_bytes[i + 1]]);
        let rec_len = u16::from_le_bytes([all_bytes[i + 2], all_bytes[i + 3]]) as usize;
        i += 4;
        if i + rec_len > all_bytes.len() {
            break;
        }
        match rec_id {
            0x00FC => {
                // SST: totalStrings(4) + uniqueStrings(4) + string data...
                if rec_len >= 8 {
                    let sst_data = &all_bytes[i..i + rec_len];
                    let mut pos = 8;
                    while pos < sst_data.len() {
                        if let Some((s, adv)) = read_biff8_unicode_string(sst_data, pos) {
                            if !s.trim().is_empty() {
                                text.push_str(s.trim());
                                text.push(' ');
                            }
                            pos += adv;
                        } else {
                            break;
                        }
                    }
                }
            }
            0x0204 => {
                // LABEL: row(2)+col(2)+xf(2)+len(2)+string
                if rec_len > 8 {
                    let label_data = &all_bytes[i..i + rec_len];
                    let s = smart_decode_bytes(&label_data[8..]); // CP1254-aware (Turkce)
                    let filtered: String = s.chars().filter(|c| !c.is_control()).collect();
                    if !filtered.trim().is_empty() {
                        text.push_str(filtered.trim());
                        text.push(' ');
                    }
                }
            }
            _ => {}
        }
        i += rec_len;
    }

    if text.len() < 20 {
        return extract_text_from_bytes(&all_bytes, "XLS");
    }
    Ok(text.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// BIFF8 unicode string: str_len(2)+flags(1)+[rt_count(2)]+[ext_size(4)]+chars.
fn read_biff8_unicode_string(data: &[u8], offset: usize) -> Option<(String, usize)> {
    if offset + 3 > data.len() {
        return None;
    }
    let str_len = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
    let flags = data[offset + 2];
    let is_wide = (flags & 0x01) != 0;
    let has_rich = (flags & 0x08) != 0;
    let has_ext = (flags & 0x04) != 0;

    let mut pos = offset + 3;
    let rt_count = if has_rich {
        if pos + 2 > data.len() {
            return None;
        }
        let rc = u16::from_le_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2;
        rc
    } else {
        0
    };
    let ext_size = if has_ext {
        if pos + 4 > data.len() {
            return None;
        }
        let es = u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]])
            as usize;
        pos += 4;
        es
    } else {
        0
    };

    let char_bytes = if is_wide { str_len * 2 } else { str_len };
    if pos + char_bytes > data.len() {
        return None;
    }
    let s = if is_wide {
        let utf16: Vec<u16> = (0..str_len)
            .map(|j| u16::from_le_bytes([data[pos + j * 2], data[pos + j * 2 + 1]]))
            .collect();
        String::from_utf16_lossy(&utf16)
    } else {
        // BIFF8 "compressed" (8-bit) = kod sayfasi (CP1254 Turkce), UTF-8 DEGIL.
        smart_decode_bytes(&data[pos..pos + str_len])
    };

    let total = 3
        + (if has_rich { 2 } else { 0 })
        + (if has_ext { 4 } else { 0 })
        + char_bytes
        + rt_count * 4
        + ext_size;
    Some((s, total))
}

/// Eski .ppt (OLE) — TextCharsAtom (0x0FA0, UTF-16LE) + TextBytesAtom (0x0FA8, ASCII).
pub fn extract_ppt_text(path: &Path) -> Result<String, String> {
    let all_bytes = read_ole_streams(path, &["PowerPoint Document", "Current User"])?;

    let mut text = String::new();
    let mut i = 0;
    while i + 8 <= all_bytes.len() {
        let rec_type = u16::from_le_bytes([all_bytes[i + 2], all_bytes[i + 3]]);
        let rec_len = u32::from_le_bytes([
            all_bytes[i + 4],
            all_bytes[i + 5],
            all_bytes[i + 6],
            all_bytes[i + 7],
        ]) as usize;
        i += 8;
        if rec_len > 10 * 1024 * 1024 || i + rec_len > all_bytes.len() {
            break;
        }
        match rec_type {
            0x0FA0 => {
                if rec_len >= 2 {
                    let chars: Vec<u16> = (0..rec_len / 2)
                        .map(|j| u16::from_le_bytes([all_bytes[i + j * 2], all_bytes[i + j * 2 + 1]]))
                        .collect();
                    let s = String::from_utf16_lossy(&chars);
                    let filtered: String = s
                        .chars()
                        .filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
                        .collect();
                    if !filtered.trim().is_empty() {
                        text.push_str(filtered.trim());
                        text.push('\n');
                    }
                }
            }
            0x0FA8 => {
                // TextBytesAtom 8-bit kod sayfasi (CP1254 Turkce), UTF-8 DEGIL.
                let s = smart_decode_bytes(&all_bytes[i..i + rec_len]);
                let filtered: String = s
                    .chars()
                    .filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
                    .collect();
                if !filtered.trim().is_empty() {
                    text.push_str(filtered.trim());
                    text.push('\n');
                }
            }
            _ => {}
        }
        i += rec_len;
    }

    if text.len() < 20 {
        return extract_text_from_bytes(&all_bytes, "PPT");
    }
    Ok(text.split_whitespace().collect::<Vec<_>>().join(" "))
}
