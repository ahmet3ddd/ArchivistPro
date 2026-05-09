//! Metin dosyaları (TXT, CSV, RTF) için zengin metadata çıkarma

use serde::Serialize;
use std::fs;
use std::io::Read;

#[derive(Serialize, Default)]
pub struct TextRichMetadata {
    pub file_size_bytes: u64,
    pub line_count: usize,
    pub word_count: usize,
    pub char_count: usize,
    pub encoding_hint: String,
    pub is_utf8: bool,
    pub has_bom: bool,
    /// CSV: sütun sayısı (ilk satırdan)
    pub csv_column_count: Option<usize>,
    /// CSV: satır sayısı (veri satırları)
    pub csv_row_count: Option<usize>,
    /// RTF: belge dili ipucu
    pub rtf_language: Option<String>,
    /// İlk birkaç satır (önizleme)
    pub preview_lines: Vec<String>,
}

/// Metin dosyasından (TXT, CSV, RTF) zengin metadata çıkarır.
#[tauri::command]
pub fn extract_text_metadata(path: String, file_type: String) -> Result<TextRichMetadata, String> {
    let file_meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    let mut meta = TextRichMetadata {
        file_size_bytes: file_meta.len(),
        ..Default::default()
    };

    // Dosya çok büyükse sadece ilk 2MB oku
    let max_read = 2 * 1024 * 1024;
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    let _read_size = if file_meta.len() > max_read as u64 {
        file.take(max_read as u64).read_to_end(&mut buf).map_err(|e| e.to_string())?
    } else {
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?
    };

    // BOM tespiti
    if buf.len() >= 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF {
        meta.has_bom = true;
        meta.encoding_hint = "UTF-8 BOM".to_string();
    } else if buf.len() >= 2 && buf[0] == 0xFF && buf[1] == 0xFE {
        meta.has_bom = true;
        meta.encoding_hint = "UTF-16 LE".to_string();
    } else if buf.len() >= 2 && buf[0] == 0xFE && buf[1] == 0xFF {
        meta.has_bom = true;
        meta.encoding_hint = "UTF-16 BE".to_string();
    }

    // UTF-8 dene
    let content = match std::str::from_utf8(&buf) {
        Ok(s) => {
            meta.is_utf8 = true;
            if meta.encoding_hint.is_empty() {
                meta.encoding_hint = "UTF-8".to_string();
            }
            s.to_string()
        }
        Err(_) => {
            meta.is_utf8 = false;
            if meta.encoding_hint.is_empty() {
                meta.encoding_hint = "Latin-1/Windows-1254".to_string();
            }
            // Latin-1 olarak oku
            buf.iter().map(|&b| b as char).collect()
        }
    };

    // Satır / kelime / karakter sayısı
    let lines: Vec<&str> = content.lines().collect();
    meta.line_count = lines.len();
    meta.char_count = content.len();
    meta.word_count = content.split_whitespace().count();

    // Önizleme (ilk 5 satır, max 200 karakter)
    meta.preview_lines = lines.iter()
        .take(5)
        .map(|l| l.chars().take(200).collect())
        .collect();

    // CSV özel
    let ft = file_type.to_lowercase();
    if ft == "csv" {
        if let Some(first_line) = lines.first() {
            // Delimiter tespiti: virgül, noktalı virgül, tab
            let comma_count = first_line.matches(',').count();
            let semi_count = first_line.matches(';').count();
            let tab_count = first_line.matches('\t').count();
            let delimiter = if tab_count >= comma_count && tab_count >= semi_count {
                '\t'
            } else if semi_count > comma_count {
                ';'
            } else {
                ','
            };
            meta.csv_column_count = Some(first_line.split(delimiter).count());
            meta.csv_row_count = Some(lines.len().saturating_sub(1)); // header hariç
        }
    }

    // RTF özel
    if ft == "rtf" && content.starts_with("{\\rtf") {
        // Dil kodu: \deflang1055 (Türkçe), \deflang1033 (İngilizce)
        if let Some(pos) = content.find("\\deflang") {
            let after = &content[pos + 8..];
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(lang_code) = digits.parse::<u32>() {
                meta.rtf_language = Some(match lang_code {
                    1055 => "Türkçe".to_string(),
                    1033 => "English".to_string(),
                    1031 => "Deutsch".to_string(),
                    1036 => "Français".to_string(),
                    1049 => "Русский".to_string(),
                    2052 => "中文".to_string(),
                    1041 => "日本語".to_string(),
                    1025 => "العربية".to_string(),
                    _ => format!("LCID {}", lang_code),
                });
            }
        }
    }

    Ok(meta)
}
