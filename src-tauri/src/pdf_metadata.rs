use serde::Serialize;
use std::fs;

#[derive(Serialize, Default)]
pub struct PdfRichMetadata {
    pub page_count: usize,
    pub file_size_bytes: u64,
    pub text_length: usize,
    pub has_text: bool,
    pub title: Option<String>,
    pub author: Option<String>,
    pub creator: Option<String>,
    pub producer: Option<String>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
}

/// Parse a PDF date string (D:YYYYMMDDHHmmSS...) into an ISO 8601 string.
/// Accepts variations: D:YYYYMMDD, D:YYYYMMDDHHmmSS, with optional timezone.
fn parse_pdf_date(s: &str) -> Option<String> {
    let s = s.trim().trim_matches('\0');
    let digits = if let Some(stripped) = s.strip_prefix("D:") { stripped } else { s };
    if digits.len() < 8 { return None; }
    let year  = digits.get(0..4)?;
    let month = digits.get(4..6)?;
    let day   = digits.get(6..8)?;
    // Validate numeric
    if !year.chars().all(|c| c.is_ascii_digit())
        || !month.chars().all(|c| c.is_ascii_digit())
        || !day.chars().all(|c| c.is_ascii_digit()) { return None; }
    let hh = digits.get(8..10).unwrap_or("00");
    let mm = digits.get(10..12).unwrap_or("00");
    let ss = digits.get(12..14).unwrap_or("00");
    Some(format!("{}-{}-{}T{}:{}:{}Z", year, month, day, hh, mm, ss))
}

/// Count occurrences of a byte pattern in a slice.
fn count_pattern(haystack: &[u8], needle: &[u8]) -> usize {
    if needle.is_empty() || haystack.len() < needle.len() {
        return 0;
    }
    let mut count = 0;
    let mut i = 0;
    while i + needle.len() <= haystack.len() {
        if haystack[i..].starts_with(needle) {
            count += 1;
            i += needle.len();
        } else {
            i += 1;
        }
    }
    count
}

/// Extract a PDF info dictionary string value for a given key.
/// Handles both literal strings (parentheses) and hex strings.
fn pdf_info_field(raw: &[u8], key: &[u8]) -> Option<String> {
    // Find key in raw bytes
    let pos = raw.windows(key.len()).position(|w| w == key)?;
    let after = &raw[pos + key.len()..];
    // Skip whitespace
    let start = after.iter().position(|&b| b != b' ' && b != b'\t' && b != b'\n' && b != b'\r')?;
    let rest = &after[start..];

    if rest.starts_with(b"(") {
        // Literal string – read until unescaped ')'
        let mut result = Vec::new();
        let mut j = 1usize;
        let mut depth = 1i32;
        while j < rest.len() && depth > 0 {
            match rest[j] {
                b'\\' => {
                    j += 1;
                    if j < rest.len() {
                        match rest[j] {
                            b'n' => result.push(b'\n'),
                            b'r' => result.push(b'\r'),
                            b't' => result.push(b'\t'),
                            b'b' => result.push(b'\x08'),
                            b'f' => result.push(b'\x0C'),
                            b'(' => result.push(b'('),
                            b')' => result.push(b')'),
                            b'\\' => result.push(b'\\'),
                            _ => result.push(rest[j]),
                        }
                        j += 1;
                    }
                }
                b'(' => { depth += 1; result.push(b'('); j += 1; }
                b')' => {
                    depth -= 1;
                    if depth > 0 { result.push(b')'); }
                    j += 1;
                }
                b => { result.push(b); j += 1; }
            }
        }
        // Strip UTF-16BE BOM if present
        if result.starts_with(&[0xFE, 0xFF]) {
            let utf16: Vec<u16> = result[2..]
                .chunks(2)
                .filter(|c| c.len() == 2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16(&utf16).ok()
        } else {
            String::from_utf8(result).ok()
        }
    } else if rest.starts_with(b"<") {
        // Hex string
        let end = rest.iter().position(|&b| b == b'>')?;
        let hex: String = rest[1..end]
            .iter()
            .filter(|&&b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
            .map(|&b| b as char)
            .collect();
        let bytes: Vec<u8> = hex
            .as_bytes()
            .chunks(2)
            .filter_map(|c| {
                if c.len() == 2 {
                    u8::from_str_radix(std::str::from_utf8(c).ok()?, 16).ok()
                } else {
                    None
                }
            })
            .collect();
        if bytes.starts_with(&[0xFE, 0xFF]) {
            let utf16: Vec<u16> = bytes[2..]
                .chunks(2)
                .filter(|c| c.len() == 2)
                .map(|c| u16::from_be_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16(&utf16).ok()
        } else {
            String::from_utf8(bytes).ok()
        }
    } else {
        None
    }
}

#[tauri::command]
pub fn extract_pdf_metadata(path: String) -> Result<PdfRichMetadata, String> {
    const MAX_FILE_SIZE: u64 = 200 * 1024 * 1024;
    let file_meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if file_meta.len() > MAX_FILE_SIZE {
        return Err(format!("PDF çok büyük: {} bayt (max {} MB)", file_meta.len(), MAX_FILE_SIZE / 1024 / 1024));
    }
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    let file_size_bytes = file_meta.len();

    // Page count: count /Type /Page entries (not /Pages) in raw bytes
    let type_page = b"/Type /Page";
    let type_page_nl = b"/Type\n/Page";
    let type_page_tab = b"/Type\t/Page";
    let page_count_raw = count_pattern(&data, type_page)
        + count_pattern(&data, type_page_nl)
        + count_pattern(&data, type_page_tab);
    // Fallback: count "endobj" if page detection gives 0
    let page_count = if page_count_raw > 0 {
        page_count_raw
    } else {
        // Try /Type/Page (no space)
        count_pattern(&data, b"/Type/Page")
    };

    // Extract info dict fields
    let title = pdf_info_field(&data, b"/Title");
    let author = pdf_info_field(&data, b"/Author");
    let creator = pdf_info_field(&data, b"/Creator");
    let producer = pdf_info_field(&data, b"/Producer");
    let created_at = pdf_info_field(&data, b"/CreationDate").and_then(|s| parse_pdf_date(&s));
    let modified_at = pdf_info_field(&data, b"/ModDate").and_then(|s| parse_pdf_date(&s));

    // Text extraction via pdf-extract
    let (text_length, has_text) = match pdf_extract::extract_text(&path) {
        Ok(text) => {
            let trimmed = text.trim().len();
            (trimmed, trimmed > 0)
        }
        Err(e) => {
            log::warn!("PDF metin çıkarma başarısız ({}): {}", path, e);
            (0, false)
        }
    };

    Ok(PdfRichMetadata {
        page_count,
        file_size_bytes,
        text_length,
        has_text,
        title,
        author,
        creator,
        producer,
        created_at,
        modified_at,
    })
}
