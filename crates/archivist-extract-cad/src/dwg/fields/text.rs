//! DWG metin cikarma — MTEXT kacis temizligi + metin icerik cikaricisi.
//! `dwg/fields.rs`'ten saf refactor ile ayrildi (davranis degismedi).

use std::collections::HashSet;

use super::super::strings::{extract_dwg_strings, extract_dwg_strings_utf16_unicode};

/// MTEXT bicimlendirme kacis dizilerini temizle (UTF-8 guvenli; ASCII baytlarda dallanir).
fn strip_mtext_codes(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'{' || b == b'}' {
            i += 1;
            continue;
        }
        if b == b'\\' && i + 1 < bytes.len() {
            match bytes[i + 1] {
                b'L' | b'l' | b'O' | b'o' | b'K' | b'k' => {
                    i += 2;
                    continue;
                }
                b'P' | b'~' => {
                    out.push(b' ');
                    i += 2;
                    continue;
                }
                b'\\' => {
                    out.push(b'\\');
                    i += 2;
                    continue;
                }
                b'{' => {
                    out.push(b'{');
                    i += 2;
                    continue;
                }
                b'}' => {
                    out.push(b'}');
                    i += 2;
                    continue;
                }
                b'f' | b'F' | b'H' | b'W' | b'Q' | b'T' | b'A' | b'C' | b'p' | b'S' => {
                    i += 2;
                    while i < bytes.len() && bytes[i] != b';' {
                        i += 1;
                    }
                    if i < bytes.len() {
                        i += 1;
                    }
                    continue;
                }
                _ => {}
            }
        }
        out.push(b);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

/// DWG metin icerikleri (UTF-16 once, sonra UTF-8; gurultu filtreli).
pub fn extract_dwg_texts(data: &[u8]) -> Vec<String> {
    let mut all_strings = extract_dwg_strings_utf16_unicode(data, 4, 200);
    all_strings.extend(extract_dwg_strings(data, 4, 200));
    let mut texts: Vec<String> = Vec::new();
    let mut seen = HashSet::new();

    let skip_prefixes = [
        "AcDb", "AcCm", "AcGi", "AcGe", "AcPl", "AcXr", "AcRx", "AcEd", "AC1", "ACAD",
        "ObjectARX", "Autodesk", "IcArx", "LWPOLYLINE", "POLYLINE", "INSERT", "ATTRIB",
        "ATTDEF", "HATCH", "SOLID", "MLINE", "SPLINE", "VIEWPORT", "DIMENSION", "LEADER",
        "MLEADER", "TABLE", "TOLERANCE", "WIPEOUT", "IMAGE", "OLE2FRAME", "XLINE", "RAY",
        "REGION", "BODY", "3DSOLID", "3DFACE", "MESH", "SURFACE", "HELIX", "LIGHT", "SUN",
        "SECTION", "MTEXT{", "\\A1;", "\\P", "\\f", "\\H",
    ];
    let skip_exact = [
        "continuous", "ByLayer", "ByBlock", "True", "False", "Model", "Layout", "Standard",
        "*MODEL_SPACE", "*PAPER_SPACE", "*MODEL", "*PAPER", "ENTITIES", "OBJECTS", "BLOCKS",
        "HEADER", "CLASSES", "TABLES", "BLOCK_RECORD", "DICTIONARY", "DICTIONARYVAR",
        "XRECORD", "SCALE", "PLOTSTYLENAME", "LAYER_INDEX", "SPATIAL_INDEX",
    ];

    for s_raw in &all_strings {
        let has_mtext = ["\\f", "\\F", "\\H", "\\A", "\\P", "\\W", "\\Q", "\\C", "\\S"]
            .iter()
            .any(|m| s_raw.contains(m));
        let stripped = if has_mtext { strip_mtext_codes(s_raw) } else { s_raw.clone() };
        let s = stripped.trim();
        if s.is_empty() {
            continue;
        }
        let len = s.len();
        if !(4..=200).contains(&len) {
            continue;
        }
        if !s.chars().any(char::is_alphabetic) {
            continue;
        }
        let total_chars = s.chars().count();
        let letter_count = s.chars().filter(|c| c.is_alphabetic()).count();
        if (letter_count as f32 / total_chars as f32) < 0.6 {
            continue;
        }
        let unique_chars = s.chars().collect::<HashSet<_>>().len();
        if total_chars > 6 && (unique_chars as f32 / total_chars as f32) < 0.35 {
            continue;
        }
        if skip_prefixes.iter().any(|p| s.starts_with(p)) {
            continue;
        }
        if skip_exact.iter().any(|e| s.eq_ignore_ascii_case(e)) {
            continue;
        }
        if s.contains('\\') || s.contains(":/") || s.contains(":\\") {
            continue;
        }
        if s.contains('{') || s.contains('}') || s.contains("::") {
            continue;
        }
        if len <= 6 && s.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') {
            continue;
        }
        let owned = s.to_string();
        if seen.insert(owned.clone()) {
            texts.push(owned);
        }
    }
    texts.truncate(5000);
    texts
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mtext_strip() {
        assert_eq!(strip_mtext_codes("{\\fArial|b0|i0|c162;GİRESUN}"), "GİRESUN");
        assert_eq!(strip_mtext_codes("{\\H2.5;Line1\\PLine2}"), "Line1 Line2");
        assert_eq!(strip_mtext_codes("plain text"), "plain text");
    }

    #[test]
    fn texts_mleader_cp1254() {
        let mtext: Vec<u8> = b"{\\fArial|b0|i0|c162;G\xDDRESUN}".to_vec();
        assert!(extract_dwg_texts(&mtext).iter().any(|s| s == "GİRESUN"));
    }
}
