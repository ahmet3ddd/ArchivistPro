//! DWG ikili veriden string cikarimi — UTF-8 (+CP1254 Turkce fallback) ve UTF-16LE.
//!
//! H2 `dwg_parse.rs`'ten nakil. DWG string'leri uzunluk-onekli UTF-8 veya null-sonlu
//! olabilir; Turkce AutoCAD MTEXT/MLEADER icerigi CP1254 saklayabilir.

/// CP1254 (Turkce) baytini, gecerli UTF-8 dizisi olusturamadigi baglamlarda
/// UTF-8'e esler. Turkce ozel karakterler disindaki baytlar icin `None`.
#[inline]
fn cp1254_fallback(b: u8) -> Option<&'static [u8]> {
    match b {
        0xC7 => Some(b"\xC3\x87"), // Ç
        0xD0 => Some(b"\xC4\x9E"), // Ğ
        0xD6 => Some(b"\xC3\x96"), // Ö
        0xDC => Some(b"\xC3\x9C"), // Ü
        0xDD => Some(b"\xC4\xB0"), // İ
        0xDE => Some(b"\xC5\x9E"), // Ş
        0xE7 => Some(b"\xC3\xA7"), // ç
        0xF0 => Some(b"\xC4\x9F"), // ğ
        0xF6 => Some(b"\xC3\xB6"), // ö
        0xFC => Some(b"\xC3\xBC"), // ü
        0xFD => Some(b"\xC4\xB1"), // ı
        0xFE => Some(b"\xC5\x9F"), // ş
        _ => None,
    }
}

/// DWG ikili verisinden ASCII/UTF-8 string'leri tara (CP1254 Turkce fallback'li).
pub fn extract_dwg_strings(data: &[u8], min_len: usize, max_len: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = Vec::new();
    let len = data.len();
    let mut i = 0;

    while i < len {
        let b = data[i];
        if (0x20..=0x7E).contains(&b) {
            current.push(b);
            i += 1;
        } else if (0xC2..=0xDF).contains(&b) && i + 1 < len {
            let b1 = data[i + 1];
            if (0x80..=0xBF).contains(&b1) {
                current.push(b);
                current.push(b1);
                i += 2;
            } else if let Some(utf8) = cp1254_fallback(b) {
                current.extend_from_slice(utf8);
                i += 1;
            } else {
                flush_buffer(&mut current, min_len, &mut strings);
                i += 1;
            }
        } else if (0xE0..=0xEF).contains(&b) && i + 2 < len {
            let (b1, b2) = (data[i + 1], data[i + 2]);
            if (0x80..=0xBF).contains(&b1) && (0x80..=0xBF).contains(&b2) {
                current.push(b);
                current.push(b1);
                current.push(b2);
                i += 3;
            } else if let Some(utf8) = cp1254_fallback(b) {
                current.extend_from_slice(utf8);
                i += 1;
            } else {
                flush_buffer(&mut current, min_len, &mut strings);
                i += 1;
            }
        } else if (0xF0..=0xF4).contains(&b) && i + 3 < len {
            let (b1, b2, b3) = (data[i + 1], data[i + 2], data[i + 3]);
            if (0x80..=0xBF).contains(&b1)
                && (0x80..=0xBF).contains(&b2)
                && (0x80..=0xBF).contains(&b3)
            {
                current.extend_from_slice(&[b, b1, b2, b3]);
                i += 4;
            } else if let Some(utf8) = cp1254_fallback(b) {
                current.extend_from_slice(utf8);
                i += 1;
            } else {
                flush_buffer(&mut current, min_len, &mut strings);
                i += 1;
            }
        } else {
            if let Some(utf8) = cp1254_fallback(b) {
                current.extend_from_slice(utf8);
            } else {
                flush_buffer(&mut current, min_len, &mut strings);
            }
            i += 1;
        }

        if current.len() > max_len {
            current.clear();
        }
    }
    flush_buffer(&mut current, min_len, &mut strings);
    strings
}

/// Ham-tarama ile yakalanan dizi GERCEK metin mi (ikili copten gelen sembol-corbasi
/// gurultusunu ele). Olcut: en az 1 harf/rakam VE izinli-karakter orani >= %60.
/// Boylece "}|{~^@#" / ">>><<<" gibi cop reddedilir; "0", "A-WALL-01", "C:\proj\a.dwg",
/// "Ø25" gibi gercek katman/ad/yol degerleri korunur. Raw-scan bir yaklasimdir →
/// hafif agresif suzme kabul edilebilir (yetkili kaynak ODA donusumudur).
fn looks_like_text(s: &str) -> bool {
    let mut alnum = 0usize;
    let mut allowed = 0usize;
    let mut total = 0usize;
    for c in s.chars() {
        total += 1;
        if c.is_alphanumeric() {
            alnum += 1;
            allowed += 1;
        } else if c.is_whitespace() || "._-/\\:;,()#+%&'\"°".contains(c) {
            allowed += 1;
        }
    }
    total > 0 && alnum >= 1 && (allowed as f32 / total as f32) >= 0.6
}

fn flush_buffer(buf: &mut Vec<u8>, min_len: usize, out: &mut Vec<String>) {
    if buf.len() >= min_len {
        if let Ok(s) = std::str::from_utf8(buf) {
            let trimmed = s.trim();
            if !trimmed.is_empty() && looks_like_text(trimmed) {
                out.push(trimmed.to_string());
            }
        }
    }
    buf.clear();
}

/// UTF-16LE ASCII-yazdirilabilir string tarayici (R2007+ ProgID/class adlari).
pub fn extract_dwg_strings_utf16(data: &[u8], min_len: usize, max_len: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current: Vec<u8> = Vec::new();
    let mut i = 0;
    while i + 1 < data.len() {
        let (a, b) = (data[i], data[i + 1]);
        if b == 0 && (a.is_ascii_graphic() || a == b' ' || a == b'_' || a == b'-') {
            current.push(a);
            if current.len() > max_len {
                current.clear();
            }
            i += 2;
        } else {
            flush_utf8(&mut current, min_len, &mut strings);
            i += 1;
        }
    }
    flush_utf8(&mut current, min_len, &mut strings);
    strings
}

fn flush_utf8(buf: &mut Vec<u8>, min_len: usize, out: &mut Vec<String>) {
    if buf.len() >= min_len {
        if let Ok(s) = std::str::from_utf8(buf) {
            let t = s.trim();
            if !t.is_empty() && looks_like_text(t) {
                out.push(t.to_string());
            }
        }
    }
    buf.clear();
}

/// UTF-16LE Unicode tarayici (BMP yazdirilabilir; Turkce dahil). Iki bayt-hizasi.
pub fn extract_dwg_strings_utf16_unicode(data: &[u8], min_len: usize, max_len: usize) -> Vec<String> {
    let mut out = scan_utf16_at_offset(data, 0, min_len, max_len);
    out.extend(scan_utf16_at_offset(data, 1, min_len, max_len));
    out
}

fn scan_utf16_at_offset(data: &[u8], start: usize, min_len: usize, max_len: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current: Vec<u16> = Vec::new();
    let mut i = start;
    while i + 1 < data.len() {
        let code = u16::from_le_bytes([data[i], data[i + 1]]);
        // ASCII + Latin Ext-A/B (Turkce dahil); CJK haric (gurultu azaltma).
        if matches!(code, 0x0020..=0x007E | 0x00A0..=0x024F) {
            current.push(code);
            if current.len() >= max_len {
                flush_utf16(&mut current, min_len, &mut strings);
            }
        } else {
            flush_utf16(&mut current, min_len, &mut strings);
        }
        i += 2;
    }
    flush_utf16(&mut current, min_len, &mut strings);
    strings
}

fn flush_utf16(buf: &mut Vec<u16>, min_len: usize, out: &mut Vec<String>) {
    if buf.len() >= min_len {
        if let Ok(s) = String::from_utf16(buf) {
            let t = s.trim();
            if !t.is_empty() && looks_like_text(t) {
                out.push(t.to_string());
            }
        }
    }
    buf.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_basic_and_minlen() {
        assert_eq!(extract_dwg_strings(b"Hello World\x00Test", 3, 256), vec!["Hello World", "Test"]);
        assert_eq!(extract_dwg_strings(b"AB\x00CDEF\x00", 3, 256), vec!["CDEF"]);
    }

    #[test]
    fn cp1254_turkish_chars() {
        let cases: &[(&[u8], &str)] = &[
            (b"G\xDDRESUN", "GİRESUN"),
            (b"\xD0EVRE", "ĞEVRE"),
            (b"MA\xE7", "MAç"),
            (b"k\xFDl\xFE", "kılş"),
        ];
        for (bytes, expected) in cases {
            let raw = extract_dwg_strings(bytes, 2, 200);
            assert!(raw.iter().any(|s| s.contains(expected)), "{expected}: {raw:?}");
        }
    }

    #[test]
    fn rejects_symbol_soup_keeps_real_names() {
        // Ikili copten yakalanan sembol dizileri reddedilmeli; gercek adlar korunmali.
        let data = b"}|{~^@#\x00A-WALL-01\x00>>><<<\x00C:\\proj\\plan.dwg\x00\x01\x02";
        let got = extract_dwg_strings(data, 3, 256);
        assert!(got.iter().any(|s| s == "A-WALL-01"), "gercek katman adi korunmali: {got:?}");
        assert!(got.iter().any(|s| s.contains("plan.dwg")), "gercek yol korunmali: {got:?}");
        assert!(!got.iter().any(|s| s.contains("}|{")), "sembol corbasi reddedilmeli: {got:?}");
        assert!(!got.iter().any(|s| s.contains(">>>")), "sembol corbasi reddedilmeli: {got:?}");
    }

    #[test]
    fn looks_like_text_basic() {
        assert!(looks_like_text("0")); // gercek varsayilan DWG katmani
        assert!(looks_like_text("A-WALL"));
        assert!(looks_like_text("Defpoints"));
        assert!(!looks_like_text("}|{~^@#"));
        assert!(!looks_like_text(">>><<<"));
        assert!(!looks_like_text("________")); // alnum yok
    }

    #[test]
    fn utf16_unicode_odd_offset() {
        let mut data = vec![0xFFu8, 0x00];
        for c in "GİRESUN".encode_utf16() {
            data.extend_from_slice(&c.to_le_bytes());
        }
        data.extend_from_slice(&[0x00, 0x00, 0xFF]);
        let result = extract_dwg_strings_utf16_unicode(&data, 4, 200);
        assert!(result.iter().any(|s| s.contains("GİRESUN")), "{result:?}");
    }
}
