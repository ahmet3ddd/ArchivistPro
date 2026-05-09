use cfb::CompoundFile;
use serde::Serialize;
use std::fs;
use std::io::Read;

#[derive(Serialize, Default)]
pub struct RvtMetadata {
    /// Revit version string (e.g. "2024", "2021")
    pub revit_version: Option<String>,
    /// Revit build number
    pub build: Option<String>,
    /// Project name (from BasicFileInfo)
    pub project_name: Option<String>,
    /// Central model path (if workshared)
    pub central_path: Option<String>,
    /// Whether the file is workshared
    pub is_workshared: bool,
    /// Document GUID
    pub document_guid: Option<String>,
    /// Locale / language
    pub locale: Option<String>,
    /// Format string (e.g. "2024")
    pub format: Option<String>,
    /// File size in bytes
    pub file_size_bytes: u64,
    /// Number of OLE/CFB streams
    pub stream_count: usize,
    /// Names of OLE/CFB storages
    pub storage_names: Vec<String>,
}

/// Revit dosyasından (RVT/RFA) BasicFileInfo stream'ini okuyarak metadata çıkarır.
/// RVT dosyaları OLE/CFB compound file formatındadır.
/// BasicFileInfo stream'i UTF-16LE satırlar halinde:
///   - Worksharing: ...
///   - Username: ...
///   - Central Model Path: ...
///   - Revit Build: Autodesk Revit 2024 (Build: 24.0.0.XXX)
///   - Format: 2024
///   - etc.
#[tauri::command]
pub fn extract_rvt_metadata(path: String) -> Result<RvtMetadata, String> {
    const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;
    let file_meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if file_meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "RVT dosyası çok büyük: {} bayt (max {} MB)",
            file_meta.len(),
            MAX_FILE_SIZE / 1024 / 1024
        ));
    }

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut comp = CompoundFile::open(file).map_err(|e| format!("OLE/CFB parse hatası: {}", e))?;

    let mut meta = RvtMetadata {
        file_size_bytes: file_meta.len(),
        ..Default::default()
    };

    // Collect storage and stream info
    let entries: Vec<_> = comp.walk().collect();
    for entry in &entries {
        if entry.is_storage() {
            meta.storage_names.push(entry.path().to_string_lossy().to_string());
        }
        if entry.is_stream() {
            meta.stream_count += 1;
        }
    }

    // Read BasicFileInfo stream — primary source of RVT metadata
    if let Ok(mut stream) = comp.open_stream("/BasicFileInfo") {
        let mut buf = Vec::new();
        if stream.read_to_end(&mut buf).is_ok() {
            parse_basic_file_info(&buf, &mut meta);
        }
    }

    // Fallback: try to extract version from RevitPreview4.0 or other known streams
    if meta.revit_version.is_none() {
        // Some RVT files encode version in the TransmissionData stream
        if let Ok(mut stream) = comp.open_stream("/TransmissionData") {
            let mut buf = Vec::new();
            if stream.read_to_end(&mut buf).is_ok() && buf.len() > 10 {
                // Try to find Revit version pattern in ASCII
                let text = String::from_utf8_lossy(&buf);
                if let Some(ver) = extract_revit_version_from_text(&text) {
                    meta.revit_version = Some(ver);
                }
            }
        }
    }

    Ok(meta)
}

/// BasicFileInfo stream'ini parse eder.
/// Stream genelde UTF-16LE encoded satır çiftleri içerir.
fn parse_basic_file_info(data: &[u8], meta: &mut RvtMetadata) {
    // BasicFileInfo'da ilk birkaç byte sürüm bilgisi olabilir,
    // asıl metin UTF-16LE olarak key: value satırları halinde.
    // Birden fazla decode stratejisi dene.

    let text = decode_utf16le_text(data);
    if text.is_empty() {
        return;
    }

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // "Key: Value" veya "Key\tValue" formatı
        let (key, value) = if let Some(pos) = line.find(':') {
            (line[..pos].trim(), line[pos + 1..].trim())
        } else if let Some(pos) = line.find('\t') {
            (line[..pos].trim(), line[pos + 1..].trim())
        } else {
            continue;
        };

        let key_lower = key.to_lowercase();

        if key_lower.contains("worksharing") {
            meta.is_workshared = value.to_lowercase().contains("enabled")
                || !value.to_lowercase().contains("not enabled") && !value.is_empty();
            // More precise: "Worksharing: Enabled" vs "Worksharing: Not Enabled"
            meta.is_workshared = value.to_lowercase().contains("enabled")
                && !value.to_lowercase().contains("not enabled");
        } else if key_lower.contains("central model path") || key_lower.contains("central server") {
            if !value.is_empty() && value != "null" && value != "Not applicable" {
                meta.central_path = Some(value.to_string());
            }
        } else if key_lower.contains("revit build") || key_lower.contains("build") {
            // "Autodesk Revit 2024 (Build: 24.0.0.XXX)"
            meta.build = Some(value.to_string());
            if let Some(ver) = extract_revit_version_from_text(value) {
                meta.revit_version = Some(ver);
            }
        } else if key_lower == "format" {
            meta.format = Some(value.to_string());
            // Format often gives the year directly: "2024"
            if meta.revit_version.is_none() && value.len() == 4 {
                if let Ok(year) = value.parse::<u32>() {
                    if (2005..=2030).contains(&year) {
                        meta.revit_version = Some(format!("Revit {}", year));
                    }
                }
            }
        } else if key_lower.contains("locale") || key_lower.contains("language") {
            meta.locale = Some(value.to_string());
        } else if key_lower.contains("unique id") || key_lower.contains("document guid") {
            meta.document_guid = Some(value.to_string());
        } else if key_lower.contains("project") && key_lower.contains("name") {
            meta.project_name = Some(value.to_string());
        }
    }
}

/// UTF-16LE byte dizisini String'e decode eder.
/// BasicFileInfo bazen BOM ile başlar, bazen saf UTF-16LE'dir.
fn decode_utf16le_text(data: &[u8]) -> String {
    if data.len() < 2 {
        return String::new();
    }

    let start = if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xFE {
        2 // BOM atla
    } else {
        0
    };

    // UTF-16LE decode
    let remaining = &data[start..];
    if remaining.len() < 2 {
        return String::new();
    }

    let utf16: Vec<u16> = remaining
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();

    let decoded = String::from_utf16_lossy(&utf16);

    // Kontrol karakterlerini filtrele ama satır sonlarını koru
    decoded
        .chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
        .collect()
}

/// Metin içinde Revit versiyon yılını bulur.
/// "Autodesk Revit 2024" veya "Revit 2021" gibi kalıpları arar.
fn extract_revit_version_from_text(text: &str) -> Option<String> {
    // "Revit YYYY" kalıbını ara
    let lower = text.to_lowercase();
    if let Some(pos) = lower.find("revit") {
        let after = &text[pos + 5..];
        // Boşluk ve sayıları atla, yılı bul
        let year_str: String = after
            .chars()
            .skip_while(|c| !c.is_ascii_digit())
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if year_str.len() == 4 {
            if let Ok(year) = year_str.parse::<u32>() {
                if (2005..=2030).contains(&year) {
                    return Some(format!("Revit {}", year));
                }
            }
        }
    }
    None
}
