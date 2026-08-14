//! PDF — info-dictionary metadata (ham bayt taramasi) + metin (pdf-extract).
//!
//! H2 `pdf_metadata.rs`'ten nakil. Sayfa sayisi/baslik/yazar gibi alanlar ham bayt
//! taramasiyla (xref gerekmez, dayanikli) cikarilir; tam metin `pdf-extract` ile.
//!
//! **H2 hata duzeltmesi:** sayfa sayimi `/Type /Page` desenini ararken `/Type /Pages`
//! (sayfa-agaci dugumu) ile de eslesip sayiyi sisiriyordu. Artik `/Pages` dugumleri
//! cikarilir.

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor};

/// PDF ust boyut siniri (H2 ile ayni): 200 MB.
const MAX_PDF_SIZE: u64 = 200 * 1024 * 1024;

/// PDF dosyalari icin extractor.
pub struct PdfExtractor;

impl Extractor for PdfExtractor {
    fn id(&self) -> &'static str {
        "pdf"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["pdf"]
    }
    fn max_size(&self) -> u64 {
        MAX_PDF_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let data = std::fs::read(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;

        let mut out = Extracted::new();
        out.set("page_count", count_pages(&data));

        if let Some(v) = pdf_info_field(&data, b"/Title") {
            out.set("title", v);
        }
        if let Some(v) = pdf_info_field(&data, b"/Author") {
            out.set("author", v);
        }
        if let Some(v) = pdf_info_field(&data, b"/Creator") {
            out.set("creator", v);
        }
        if let Some(v) = pdf_info_field(&data, b"/Producer") {
            out.set("producer", v);
        }
        if let Some(v) = pdf_info_field(&data, b"/CreationDate").and_then(|s| parse_pdf_date(&s)) {
            out.set("created_at", v);
        }
        if let Some(v) = pdf_info_field(&data, b"/ModDate").and_then(|s| parse_pdf_date(&s)) {
            out.set("modified_at", v);
        }

        // Tam metin → FTS body. Basarisizlik olumcul degil (uyari + bos metin).
        match pdf_extract::extract_text(&input.path) {
            Ok(text) => {
                let trimmed_len = text.trim().len();
                out.set("text_length", trimmed_len);
                out.set("has_text", trimmed_len > 0);
                if trimmed_len > 0 {
                    out.text = Some(text);
                }
            }
            Err(e) => {
                out.set("text_length", 0_i64);
                out.set("has_text", false);
                out.warn(format!("PDF metin cikarma basarisiz: {e}"));
            }
        }

        // Thumbnail: gomulu ilk makul raster (mimari PDF'ler genelde raster icerir).
        // True sayfa-render degil; harici arac/pdfium gerektirmez. Metin-only → None.
        out.thumbnail = archivist_thumbnail::scan_embedded_raster(&data, 40);

        Ok(out)
    }
}

/// Bir bayt desenini (cakismayan) say.
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

/// Sayfa (`/Type /Page`) dugumlerini say — sayfa-agaci (`/Type /Pages`) HARIC.
///
/// `/Type /Page` deseni `/Type /Pages` icinde de gectigi icin H2 sayiyi sisiriyordu;
/// burada `/Pages` dugum sayisi cikarilir.
fn count_pages(data: &[u8]) -> usize {
    const PAGE: [&[u8]; 4] = [b"/Type /Page", b"/Type\n/Page", b"/Type\t/Page", b"/Type/Page"];
    const PAGES: [&[u8]; 4] =
        [b"/Type /Pages", b"/Type\n/Pages", b"/Type\t/Pages", b"/Type/Pages"];
    let raw: usize = PAGE.iter().map(|p| count_pattern(data, p)).sum();
    let trees: usize = PAGES.iter().map(|p| count_pattern(data, p)).sum();
    raw.saturating_sub(trees)
}

/// PDF tarih dizisini (`D:YYYYMMDDHHmmSS...`) ISO 8601'e cevir.
fn parse_pdf_date(s: &str) -> Option<String> {
    let s = s.trim().trim_matches('\0');
    let digits = s.strip_prefix("D:").unwrap_or(s);
    if digits.len() < 8 {
        return None;
    }
    let year = digits.get(0..4)?;
    let month = digits.get(4..6)?;
    let day = digits.get(6..8)?;
    if !year.bytes().all(|c| c.is_ascii_digit())
        || !month.bytes().all(|c| c.is_ascii_digit())
        || !day.bytes().all(|c| c.is_ascii_digit())
    {
        return None;
    }
    let hh = digits.get(8..10).unwrap_or("00");
    let mm = digits.get(10..12).unwrap_or("00");
    let ss = digits.get(12..14).unwrap_or("00");
    Some(format!("{year}-{month}-{day}T{hh}:{mm}:{ss}Z"))
}

/// PDF info-dictionary string degerini (literal `(...)` veya hex `<...>`) cikar.
fn pdf_info_field(raw: &[u8], key: &[u8]) -> Option<String> {
    let pos = raw.windows(key.len()).position(|w| w == key)?;
    let after = &raw[pos + key.len()..];
    let start = after
        .iter()
        .position(|&b| b != b' ' && b != b'\t' && b != b'\n' && b != b'\r')?;
    let rest = &after[start..];

    if rest.starts_with(b"(") {
        // Literal string — kacisli ')' kapanisina kadar oku.
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
                            b'b' => result.push(0x08),
                            b'f' => result.push(0x0C),
                            b'(' => result.push(b'('),
                            b')' => result.push(b')'),
                            b'\\' => result.push(b'\\'),
                            other => result.push(other),
                        }
                        j += 1;
                    }
                }
                b'(' => {
                    depth += 1;
                    result.push(b'(');
                    j += 1;
                }
                b')' => {
                    depth -= 1;
                    if depth > 0 {
                        result.push(b')');
                    }
                    j += 1;
                }
                b => {
                    result.push(b);
                    j += 1;
                }
            }
        }
        decode_pdf_string_bytes(result)
    } else if rest.starts_with(b"<") {
        // Hex string.
        let end = rest.iter().position(|&b| b == b'>')?;
        let hex: Vec<u8> = rest[1..end]
            .iter()
            .copied()
            .filter(|b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r'))
            .collect();
        let bytes: Vec<u8> = hex
            .chunks(2)
            .filter_map(|c| {
                if c.len() == 2 {
                    u8::from_str_radix(std::str::from_utf8(c).ok()?, 16).ok()
                } else {
                    None
                }
            })
            .collect();
        decode_pdf_string_bytes(bytes)
    } else {
        None
    }
}

/// Ham PDF string baytlarini cozumle: UTF-16BE BOM varsa UTF-16, yoksa UTF-8.
fn decode_pdf_string_bytes(bytes: Vec<u8>) -> Option<String> {
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_count_excludes_pages_tree_node() {
        let data = b"<< /Type /Catalog >> << /Type /Pages /Count 1 >> << /Type /Page >>";
        // raw "/Type /Page" eslesir: "/Type /Pages"(1) + "/Type /Page"(1) = 2;
        // "/Type /Pages" cikarilir → 1.
        assert_eq!(count_pages(data), 1);
    }

    #[test]
    fn page_count_two_pages() {
        let data = b"/Type /Pages /Type /Page /Type /Page";
        assert_eq!(count_pages(data), 2);
    }

    #[test]
    fn date_parses_full_and_short() {
        assert_eq!(
            parse_pdf_date("D:20260617120000Z").as_deref(),
            Some("2026-06-17T12:00:00Z")
        );
        assert_eq!(parse_pdf_date("D:20260617").as_deref(), Some("2026-06-17T00:00:00Z"));
        assert_eq!(parse_pdf_date("D:99").as_deref(), None);
        assert_eq!(parse_pdf_date("garbage").as_deref(), None);
    }

    #[test]
    fn info_field_literal_string() {
        let data = b"/Title (Test Belgesi) /Author (Ahmet)";
        assert_eq!(pdf_info_field(data, b"/Title").as_deref(), Some("Test Belgesi"));
        assert_eq!(pdf_info_field(data, b"/Author").as_deref(), Some("Ahmet"));
        assert_eq!(pdf_info_field(data, b"/Yok"), None);
    }

    #[test]
    fn info_field_nested_parens_and_escape() {
        let data = br"/Title (Proje \(2026\) Final)";
        assert_eq!(
            pdf_info_field(data, b"/Title").as_deref(),
            Some("Proje (2026) Final")
        );
    }

    #[test]
    fn info_field_utf16be_hex() {
        // <FEFF0041> → "A"
        let data = b"/Title <FEFF0041>";
        assert_eq!(pdf_info_field(data, b"/Title").as_deref(), Some("A"));
    }
}
