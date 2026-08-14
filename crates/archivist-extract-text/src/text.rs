//! Duz metin dosyalari (TXT/CSV/TSV/RTF/LOG/MD/INI) — zengin metadata + FTS metni.
//!
//! H2 `text_metadata.rs`'ten nakil. Kucuk iyilestirme: `char_count` artik gercek
//! karakter sayisi (H2'de bayt uzunlugu idi).

use std::io::Read;

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor};

/// En cok bu kadar bayt okunur (H2 ile ayni): 2 MB (indeksleme icin yeterli).
const MAX_READ: u64 = 2 * 1024 * 1024;
/// Onizleme/text icin satir sinirlamasi yok; ham metin FTS body olur.
const PREVIEW_LINES: usize = 5;
const PREVIEW_LINE_CHARS: usize = 200;

/// Duz metin dosyalari icin extractor.
pub struct TextExtractor;

impl Extractor for TextExtractor {
    fn id(&self) -> &'static str {
        "text"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["txt", "text", "csv", "tsv", "rtf", "log", "md", "ini"]
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let mut file =
            std::fs::File::open(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
        let mut buf = Vec::new();
        if input.size_bytes > MAX_READ {
            file.by_ref()
                .take(MAX_READ)
                .read_to_end(&mut buf)
                .map_err(|e| ExtractError::io(&input.path, e))?;
        } else {
            file.read_to_end(&mut buf)
                .map_err(|e| ExtractError::io(&input.path, e))?;
        }

        let mut out = Extracted::new();

        // BOM + encoding ipucu.
        let mut encoding_hint = String::new();
        let mut has_bom = false;
        if buf.len() >= 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF {
            has_bom = true;
            encoding_hint = "UTF-8 BOM".to_string();
        } else if buf.len() >= 2 && buf[0] == 0xFF && buf[1] == 0xFE {
            has_bom = true;
            encoding_hint = "UTF-16 LE".to_string();
        } else if buf.len() >= 2 && buf[0] == 0xFE && buf[1] == 0xFF {
            has_bom = true;
            encoding_hint = "UTF-16 BE".to_string();
        }

        // UTF-8 dene; olmazsa Latin-1 fallback.
        let (content, is_utf8) = match std::str::from_utf8(&buf) {
            Ok(s) => {
                if encoding_hint.is_empty() {
                    encoding_hint = "UTF-8".to_string();
                }
                (s.to_string(), true)
            }
            Err(_) => {
                if encoding_hint.is_empty() {
                    encoding_hint = "Windows-1254".to_string();
                }
                // Latin-1 (`b as char`) DEGIL: CP1254 → Turkce dogru; UTF-16 BOM da cozulur.
                (archivist_extract::decode_bytes(&buf), false)
            }
        };

        let lines: Vec<&str> = content.lines().collect();
        let line_count = lines.len();
        let char_count = content.chars().count(); // H2: byte-len idi → karakter sayisi.
        let word_count = content.split_whitespace().count();

        out.set("line_count", line_count);
        out.set("word_count", word_count);
        out.set("char_count", char_count);
        out.set("encoding_hint", encoding_hint);
        out.set("is_utf8", is_utf8);
        out.set("has_bom", has_bom);

        let ext = input.ext.as_str();

        // CSV/TSV: delimiter tespiti + sutun/satir sayisi.
        if ext == "csv" || ext == "tsv" {
            if let Some(first_line) = lines.first() {
                let comma = first_line.matches(',').count();
                let semi = first_line.matches(';').count();
                let tab = first_line.matches('\t').count();
                let delimiter = if tab >= comma && tab >= semi {
                    '\t'
                } else if semi > comma {
                    ';'
                } else {
                    ','
                };
                out.set("csv_column_count", first_line.split(delimiter).count());
                out.set("csv_row_count", line_count.saturating_sub(1)); // header haric
            }
        }

        // RTF: dil kodu ipucu.
        if ext == "rtf" && content.starts_with("{\\rtf") {
            if let Some(pos) = content.find("\\deflang") {
                let after = &content[pos + 8..];
                let digits: String = after.chars().take_while(char::is_ascii_digit).collect();
                if let Ok(lang_code) = digits.parse::<u32>() {
                    out.set("rtf_language", rtf_language_name(lang_code));
                }
            }
        }

        // FTS body: ham metin (RTF'te kontrol kodlari kalir ama aranabilir icerik tasir).
        let preview: Vec<String> = lines
            .iter()
            .take(PREVIEW_LINES)
            .map(|l| l.chars().take(PREVIEW_LINE_CHARS).collect())
            .collect();
        if !preview.is_empty() {
            out.set("preview", preview.join("\n"));
        }
        if !content.trim().is_empty() {
            out.text = Some(content);
        }

        Ok(out)
    }
}

/// LCID → insan-okunur dil adi (H2 ile ayni harita).
fn rtf_language_name(lang_code: u32) -> String {
    match lang_code {
        1055 => "Türkçe".to_string(),
        1033 => "English".to_string(),
        1031 => "Deutsch".to_string(),
        1036 => "Français".to_string(),
        1049 => "Русский".to_string(),
        2052 => "中文".to_string(),
        1041 => "日本語".to_string(),
        1025 => "العربية".to_string(),
        _ => format!("LCID {lang_code}"),
    }
}
