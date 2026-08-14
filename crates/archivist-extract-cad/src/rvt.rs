//! Revit (RVT/RFA) — OLE/CFB BasicFileInfo metadata. H2 `rvt_metadata.rs`'ten nakil.
//!
//! RVT dosyalari OLE/CFB compound; BasicFileInfo stream'i UTF-16LE `Key: Value`
//! satirlari icerir (Worksharing, Central Model Path, Revit Build, Format, ...).

use std::io::Read;

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor, Thumbnail};
use cfb::CompoundFile;

/// RVT ust boyut siniri (H2 ile ayni): 500 MB.
const MAX_RVT_SIZE: u64 = 500 * 1024 * 1024;

/// Revit dosyalari icin extractor.
pub struct RvtExtractor;

impl Extractor for RvtExtractor {
    fn id(&self) -> &'static str {
        "rvt"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["rvt", "rfa"]
    }
    fn max_size(&self) -> u64 {
        MAX_RVT_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let file =
            std::fs::File::open(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
        let mut comp =
            CompoundFile::open(file).map_err(|e| ExtractError::Parse(format!("OLE/CFB: {e}")))?;

        let mut info = RvtInfo::default();
        let mut summary_paths: Vec<std::path::PathBuf> = Vec::new();
        for entry in comp.walk() {
            if entry.is_storage() {
                info.storage_count += 1;
            } else if entry.is_stream() {
                info.stream_count += 1;
                if entry.path().to_string_lossy().contains("SummaryInformation") {
                    summary_paths.push(entry.path().to_path_buf());
                }
            }
        }

        // Thumbnail: OLE SummaryInformation prop 0x11 (Revit gomulu onizleme).
        let mut thumb: Option<Thumbnail> = None;
        for p in &summary_paths {
            let Ok(mut s) = comp.open_stream(p) else { continue };
            let mut buf = Vec::new();
            if s.read_to_end(&mut buf).is_ok() {
                if let Some(t) = archivist_thumbnail::ole_thumbnail(&buf) {
                    thumb = Some(t);
                    break;
                }
            }
        }

        if let Ok(mut stream) = comp.open_stream("/BasicFileInfo") {
            let mut buf = Vec::new();
            if stream.read_to_end(&mut buf).is_ok() {
                parse_basic_file_info(&buf, &mut info);
            }
        }
        if info.revit_version.is_none() {
            if let Ok(mut stream) = comp.open_stream("/TransmissionData") {
                let mut buf = Vec::new();
                if stream.read_to_end(&mut buf).is_ok() && buf.len() > 10 {
                    let text = String::from_utf8_lossy(&buf);
                    if let Some(ver) = extract_revit_version_from_text(&text) {
                        info.revit_version = Some(ver);
                    }
                }
            }
        }

        let mut out = Extracted::new();
        if let Some(v) = &info.revit_version {
            out.set("revit_version", v.clone());
        }
        if let Some(v) = &info.build {
            out.set("build", v.clone());
        }
        if let Some(v) = &info.project_name {
            out.set("project_name", v.clone());
        }
        if let Some(v) = &info.central_path {
            out.set("central_path", v.clone());
        }
        out.set("is_workshared", info.is_workshared);
        if let Some(v) = &info.document_guid {
            out.set("document_guid", v.clone());
        }
        if let Some(v) = &info.locale {
            out.set("locale", v.clone());
        }
        if let Some(v) = &info.format {
            out.set("format", v.clone());
        }
        out.set("stream_count", info.stream_count);
        out.set("storage_count", info.storage_count);

        // FTS body: proje adi + build (aranabilir).
        let mut parts = Vec::new();
        if let Some(v) = info.project_name {
            parts.push(v);
        }
        if let Some(v) = info.build {
            parts.push(v);
        }
        if !parts.is_empty() {
            out.text = Some(parts.join("\n"));
        }
        out.thumbnail = thumb;
        Ok(out)
    }
}

#[derive(Default)]
struct RvtInfo {
    revit_version: Option<String>,
    build: Option<String>,
    project_name: Option<String>,
    central_path: Option<String>,
    is_workshared: bool,
    document_guid: Option<String>,
    locale: Option<String>,
    format: Option<String>,
    stream_count: usize,
    storage_count: usize,
}

/// BasicFileInfo (UTF-16LE `Key: Value` satirlari) parse.
fn parse_basic_file_info(data: &[u8], info: &mut RvtInfo) {
    let text = decode_utf16le_text(data);
    if text.is_empty() {
        return;
    }
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (key, value) = if let Some(pos) = line.find(':') {
            (line[..pos].trim(), line[pos + 1..].trim())
        } else if let Some(pos) = line.find('\t') {
            (line[..pos].trim(), line[pos + 1..].trim())
        } else {
            continue;
        };
        let key_lower = key.to_lowercase();
        let val_lower = value.to_lowercase();

        if key_lower.contains("worksharing") {
            // H2 duzeltmesi: is_workshared iki kez ataniyordu (ilki olu kod).
            info.is_workshared = val_lower.contains("enabled") && !val_lower.contains("not enabled");
        } else if key_lower.contains("central model path") || key_lower.contains("central server") {
            if !value.is_empty() && value != "null" && value != "Not applicable" {
                info.central_path = Some(value.to_string());
            }
        } else if key_lower.contains("revit build") || key_lower.contains("build") {
            info.build = Some(value.to_string());
            if let Some(ver) = extract_revit_version_from_text(value) {
                info.revit_version = Some(ver);
            }
        } else if key_lower == "format" {
            info.format = Some(value.to_string());
            if info.revit_version.is_none() && value.len() == 4 {
                if let Ok(year) = value.parse::<u32>() {
                    if (2005..=2030).contains(&year) {
                        info.revit_version = Some(format!("Revit {year}"));
                    }
                }
            }
        } else if key_lower.contains("locale") || key_lower.contains("language") {
            info.locale = Some(value.to_string());
        } else if key_lower.contains("unique id") || key_lower.contains("document guid") {
            info.document_guid = Some(value.to_string());
        } else if key_lower.contains("project") && key_lower.contains("name") {
            info.project_name = Some(value.to_string());
        }
    }
}

/// UTF-16LE (opsiyonel BOM) → String; kontrol karakterleri (satir-sonu haric) atilir.
fn decode_utf16le_text(data: &[u8]) -> String {
    if data.len() < 2 {
        return String::new();
    }
    let start = if data[0] == 0xFF && data[1] == 0xFE { 2 } else { 0 };
    let remaining = &data[start..];
    if remaining.len() < 2 {
        return String::new();
    }
    let utf16: Vec<u16> =
        remaining.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&utf16)
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\r' | '\t'))
        .collect()
}

/// "Autodesk Revit 2024" / "Revit 2021" kalibindan yili cikar.
fn extract_revit_version_from_text(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    let pos = lower.find("revit")?;
    let after = &text[pos + 5..];
    let year_str: String = after
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(char::is_ascii_digit)
        .collect();
    if year_str.len() == 4 {
        if let Ok(year) = year_str.parse::<u32>() {
            if (2005..=2030).contains(&year) {
                return Some(format!("Revit {year}"));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(s: &str) -> Vec<u8> {
        let mut v = vec![0xFF, 0xFE]; // BOM
        for u in s.encode_utf16() {
            v.extend_from_slice(&u.to_le_bytes());
        }
        v
    }

    #[test]
    fn parse_basic_info_fields() {
        let raw = utf16le(
            "Worksharing: Enabled\r\n\
             Central Model Path: \\\\server\\proje.rvt\r\n\
             Revit Build: Autodesk Revit 2024 (Build: 24.0.0.123)\r\n\
             Format: 2024\r\n\
             Project Name: Kule Projesi\r\n",
        );
        let mut info = RvtInfo::default();
        parse_basic_file_info(&raw, &mut info);
        assert_eq!(info.revit_version.as_deref(), Some("Revit 2024"));
        assert!(info.is_workshared);
        assert_eq!(info.central_path.as_deref(), Some("\\\\server\\proje.rvt"));
        assert_eq!(info.format.as_deref(), Some("2024"));
        assert_eq!(info.project_name.as_deref(), Some("Kule Projesi"));
    }

    #[test]
    fn worksharing_not_enabled_is_false() {
        let raw = utf16le("Worksharing: Not Enabled\r\n");
        let mut info = RvtInfo::default();
        parse_basic_file_info(&raw, &mut info);
        assert!(!info.is_workshared);
    }

    #[test]
    fn revit_version_from_text() {
        assert_eq!(extract_revit_version_from_text("Autodesk Revit 2021").as_deref(), Some("Revit 2021"));
        assert_eq!(extract_revit_version_from_text("no version here"), None);
        assert_eq!(extract_revit_version_from_text("Revit 1999"), None); // aralik disi
    }
}
