use cfb::CompoundFile;
use serde::Serialize;
use std::fs;
use std::io::{Cursor, Read};

/// Converts a Windows FILETIME (100-ns intervals since Jan 1 1601) to ISO-8601 string.
pub fn filetime_to_iso(ft: u64) -> Option<String> {
    if ft == 0 { return None; }
    // Difference between FILETIME epoch (1601) and Unix epoch (1970) in 100-ns units
    const EPOCH_DIFF: u64 = 116_444_736_000_000_000;
    if ft < EPOCH_DIFF { return None; }
    let unix_secs = ((ft - EPOCH_DIFF) / 10_000_000) as i64;
    chrono::DateTime::from_timestamp(unix_secs, 0).map(|dt| dt.to_rfc3339())
}

/// Reads creation and last-saved dates from an OLE/CFB SummaryInformation stream.
/// PIDSI_CREATE_DTM = 0x0C, PIDSI_LASTSAVE_DTM = 0x0D, both VT_FILETIME = 0x40.
pub fn parse_ole_summary_dates(stream_data: &[u8]) -> (Option<String>, Option<String>) {
    if stream_data.len() < 48 { return (None, None); }
    // Validate byte-order mark
    if stream_data[0] != 0xFE || stream_data[1] != 0xFF { return (None, None); }

    // cSections at offset 24
    let c_sections = u32::from_le_bytes([
        stream_data[24], stream_data[25], stream_data[26], stream_data[27]
    ]) as usize;
    if c_sections == 0 { return (None, None); }

    // First section: FMTID (16 bytes) + offset (4 bytes) starting at offset 28
    if stream_data.len() < 48 { return (None, None); }
    let sec_offset = u32::from_le_bytes([
        stream_data[44], stream_data[45], stream_data[46], stream_data[47]
    ]) as usize;
    if sec_offset + 8 > stream_data.len() { return (None, None); }

    let c_props = u32::from_le_bytes([
        stream_data[sec_offset + 4], stream_data[sec_offset + 5],
        stream_data[sec_offset + 6], stream_data[sec_offset + 7]
    ]) as usize;
    if c_props == 0 || c_props > 1000 { return (None, None); }

    let mut create_date = None;
    let mut modify_date = None;

    for i in 0..c_props {
        let entry = sec_offset + 8 + i * 8;
        if entry + 8 > stream_data.len() { break; }
        let prop_id = u32::from_le_bytes([
            stream_data[entry], stream_data[entry+1],
            stream_data[entry+2], stream_data[entry+3]
        ]);
        if prop_id != 0x0C && prop_id != 0x0D { continue; }

        let val_off = sec_offset + u32::from_le_bytes([
            stream_data[entry+4], stream_data[entry+5],
            stream_data[entry+6], stream_data[entry+7]
        ]) as usize;

        if val_off + 12 > stream_data.len() { continue; }
        let vtype = u32::from_le_bytes([
            stream_data[val_off], stream_data[val_off+1],
            stream_data[val_off+2], stream_data[val_off+3]
        ]);
        if vtype != 0x0040 { continue; } // must be VT_FILETIME

        let ft = u64::from_le_bytes([
            stream_data[val_off+4], stream_data[val_off+5],
            stream_data[val_off+6], stream_data[val_off+7],
            stream_data[val_off+8], stream_data[val_off+9],
            stream_data[val_off+10], stream_data[val_off+11]
        ]);
        if prop_id == 0x0C { create_date = filetime_to_iso(ft); }
        else               { modify_date = filetime_to_iso(ft); }
    }

    (create_date, modify_date)
}

/// Reads creation and last-modified dates from OOXML (XLSX, DOCX, PPTX) docProps/core.xml.
/// Returns (created, modified) as ISO strings.
pub fn parse_ooxml_core_dates(zip_data: &[u8]) -> (Option<String>, Option<String>) {
    let cursor = Cursor::new(zip_data);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return (None, None),
    };
    let mut core_xml = match archive.by_name("docProps/core.xml") {
        Ok(f) => f,
        Err(_) => return (None, None),
    };
    let mut content = String::new();
    if core_xml.read_to_string(&mut content).is_err() { return (None, None); }

    let extract = |tag: &str| -> Option<String> {
        let open = format!("<{}", tag);
        let close = format!("</{}>", tag);
        let start = content.find(&open)?;
        let gt = content[start..].find('>')? + start + 1;
        let end = content[gt..].find(&close)? + gt;
        let raw = content[gt..end].trim().to_string();
        // Validate looks like a date (basic check)
        if raw.len() >= 10 { Some(raw) } else { None }
    };

    (
        extract("dcterms:created").or_else(|| extract("dc:date")),
        extract("dcterms:modified"),
    )
}

#[derive(Serialize)]
pub struct OfficeDates {
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
}

/// Returns the internal document creation and last-saved dates for Office files.
/// For OOXML (xlsx/docx/pptx) reads docProps/core.xml from the ZIP.
/// For legacy OLE (xls/doc) reads \x05SummaryInformation via cfb.
#[tauri::command]
pub fn get_office_dates(path: String) -> Result<OfficeDates, String> {
    let data = fs::read(&path).map_err(|e| e.to_string())?;

    // Try OOXML (ZIP magic: PK\x03\x04)
    if data.len() >= 4 && &data[0..4] == b"PK\x03\x04" {
        let (created_at, modified_at) = parse_ooxml_core_dates(&data);
        return Ok(OfficeDates { created_at, modified_at });
    }

    // Try OLE/CFB (magic: D0 CF 11 E0 A1 B1 1A E1)
    if data.len() >= 8 && data[0] == 0xD0 && data[1] == 0xCF {
        let file = std::io::Cursor::new(&data);
        if let Ok(mut comp) = cfb::CompoundFile::open(file) {
            // Stream names with the property set indicator byte \x05
            let target = "\x05SummaryInformation";
            if let Ok(mut stream) = comp.open_stream(target) {
                let mut buf = Vec::new();
                if stream.read_to_end(&mut buf).is_ok() {
                    let (created_at, modified_at) = parse_ole_summary_dates(&buf);
                    return Ok(OfficeDates { created_at, modified_at });
                }
            }
        }
    }

    Ok(OfficeDates { created_at: None, modified_at: None })
}

/* ── Office Zengin Metadata ── */

#[derive(Serialize, Default)]
pub struct OfficeRichMetadata {
    pub file_size_bytes: u64,
    pub file_format: String,
    pub title: Option<String>,
    pub author: Option<String>,
    pub subject: Option<String>,
    pub keywords: Option<String>,
    pub last_modified_by: Option<String>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    pub page_count: Option<u32>,
    pub word_count: Option<u32>,
    pub slide_count: Option<u32>,
    pub sheet_names: Vec<String>,
}

/// Office dosyasından (DOC/XLS/PPT/DOCX/XLSX/PPTX) zengin metadata çıkarır.
#[tauri::command]
pub fn extract_office_metadata(path: String) -> Result<OfficeRichMetadata, String> {
    const MAX_FILE_SIZE: u64 = 200 * 1024 * 1024;
    let file_meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if file_meta.len() > MAX_FILE_SIZE {
        return Err(format!("Office dosyası çok büyük: {} bayt (max {} MB)", file_meta.len(), MAX_FILE_SIZE / 1024 / 1024));
    }
    let data = fs::read(&path).map_err(|e| e.to_string())?;

    let mut meta = OfficeRichMetadata {
        file_size_bytes: file_meta.len(),
        ..Default::default()
    };

    if data.len() >= 4 && &data[0..4] == b"PK\x03\x04" {
        meta.file_format = detect_zip_subtype_from_data(&data);
        extract_ooxml_metadata(&data, &mut meta);
    } else if data.len() >= 4 && data[0] == 0xD0 && data[1] == 0xCF {
        meta.file_format = detect_ole_subtype_str(&data);
        extract_ole_metadata(&data, &mut meta);
    }

    Ok(meta)
}

fn detect_zip_subtype_from_data(data: &[u8]) -> String {
    let cursor = Cursor::new(data);
    let archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return "zip".to_string(),
    };
    let names: Vec<String> = archive.file_names().map(|n| n.to_string()).collect();
    if names.iter().any(|n| n.contains("word/")) { return "docx".to_string(); }
    if names.iter().any(|n| n.contains("xl/")) { return "xlsx".to_string(); }
    if names.iter().any(|n| n.contains("ppt/")) { return "pptx".to_string(); }
    "zip".to_string()
}

fn detect_ole_subtype_str(data: &[u8]) -> String {
    let cursor = Cursor::new(data);
    let comp = match CompoundFile::open(cursor) {
        Ok(c) => c,
        Err(_) => return "ole".to_string(),
    };
    let streams: Vec<String> = comp.walk().map(|e| e.path().to_string_lossy().to_string()).collect();
    let has = |needle: &str| streams.iter().any(|s| s.contains(needle));
    if has("WordDocument") { return "doc".to_string(); }
    if has("Workbook") || has("/Book") { return "xls".to_string(); }
    if has("PowerPoint Document") || has("PowerPoint") { return "ppt".to_string(); }
    "ole".to_string()
}

fn extract_ooxml_metadata(data: &[u8], meta: &mut OfficeRichMetadata) {
    let cursor = Cursor::new(data);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return,
    };

    // core.xml: title, author, dates
    if let Ok(mut f) = archive.by_name("docProps/core.xml") {
        let mut content = String::new();
        if f.read_to_string(&mut content).is_ok() {
            meta.title = xml_tag_value(&content, "dc:title");
            meta.author = xml_tag_value(&content, "dc:creator");
            meta.subject = xml_tag_value(&content, "dc:subject");
            meta.keywords = xml_tag_value(&content, "cp:keywords");
            meta.last_modified_by = xml_tag_value(&content, "cp:lastModifiedBy");
            meta.created_at = xml_tag_value(&content, "dcterms:created");
            meta.modified_at = xml_tag_value(&content, "dcterms:modified");
        }
    }

    // app.xml: page/word/slide counts
    if let Ok(mut f) = archive.by_name("docProps/app.xml") {
        let mut content = String::new();
        if f.read_to_string(&mut content).is_ok() {
            meta.page_count = xml_tag_value(&content, "Pages").and_then(|v| v.parse().ok());
            meta.word_count = xml_tag_value(&content, "Words").and_then(|v| v.parse().ok());
            meta.slide_count = xml_tag_value(&content, "Slides").and_then(|v| v.parse().ok());
        }
    }

    // XLSX: sheet isimleri
    if meta.file_format == "xlsx" {
        if let Ok(mut f) = archive.by_name("xl/workbook.xml") {
            let mut content = String::new();
            if f.read_to_string(&mut content).is_ok() {
                // <sheet name="Sheet1" .../>
                let mut pos = 0;
                while let Some(idx) = content[pos..].find("name=\"") {
                    let start = pos + idx + 6;
                    if let Some(end) = content[start..].find('"') {
                        // UTF-8 boundary safety: ensure slicing at valid char boundaries
                        if content.is_char_boundary(start) && content.is_char_boundary(start + end) {
                            if let Some(name) = content.get(start..start + end) {
                                let name = name.to_string();
                                if !name.is_empty() {
                                    meta.sheet_names.push(name);
                                }
                                pos = start + end + 1;
                            } else {
                                break;
                            }
                        } else {
                            // Invalid boundary — skip this match
                            pos = start + end + 1;
                        }
                    } else {
                        break;
                    }
                }
            }
        }
    }
}

fn extract_ole_metadata(data: &[u8], meta: &mut OfficeRichMetadata) {
    let cursor = Cursor::new(data);
    let mut comp = match CompoundFile::open(cursor) {
        Ok(c) => c,
        Err(_) => return,
    };

    // SummaryInformation: tarih + OLE property'ler
    if let Ok(mut stream) = comp.open_stream("\x05SummaryInformation") {
        let mut buf = Vec::new();
        if stream.read_to_end(&mut buf).is_ok() {
            let (created, modified) = parse_ole_summary_dates(&buf);
            meta.created_at = created;
            meta.modified_at = modified;
            meta.title = extract_ole_string_prop(&buf, 0x02);
            meta.subject = extract_ole_string_prop(&buf, 0x03);
            meta.author = extract_ole_string_prop(&buf, 0x04);
            meta.keywords = extract_ole_string_prop(&buf, 0x05);
            meta.page_count = extract_ole_int_prop(&buf, 0x0E);
            meta.word_count = extract_ole_int_prop(&buf, 0x0F);
        }
    }
}

/// OLE SummaryInformation'dan string property çıkarır
fn extract_ole_string_prop(stream_data: &[u8], prop_id: u32) -> Option<String> {
    if stream_data.len() < 48 { return None; }
    if stream_data[0] != 0xFE || stream_data[1] != 0xFF { return None; }

    let sec_offset = u32::from_le_bytes([
        stream_data[44], stream_data[45], stream_data[46], stream_data[47]
    ]) as usize;
    if sec_offset + 8 > stream_data.len() { return None; }

    let c_props = u32::from_le_bytes([
        stream_data[sec_offset + 4], stream_data[sec_offset + 5],
        stream_data[sec_offset + 6], stream_data[sec_offset + 7]
    ]) as usize;

    for i in 0..c_props.min(200) {
        let entry = sec_offset + 8 + i * 8;
        if entry + 8 > stream_data.len() { break; }
        let pid = u32::from_le_bytes([
            stream_data[entry], stream_data[entry+1], stream_data[entry+2], stream_data[entry+3]
        ]);
        if pid != prop_id { continue; }

        let val_off = sec_offset + u32::from_le_bytes([
            stream_data[entry+4], stream_data[entry+5], stream_data[entry+6], stream_data[entry+7]
        ]) as usize;

        if val_off + 8 > stream_data.len() { return None; }
        let vtype = u32::from_le_bytes([
            stream_data[val_off], stream_data[val_off+1], stream_data[val_off+2], stream_data[val_off+3]
        ]);
        if vtype != 0x001E { return None; } // VT_LPSTR

        let str_len = u32::from_le_bytes([
            stream_data[val_off+4], stream_data[val_off+5], stream_data[val_off+6], stream_data[val_off+7]
        ]) as usize;
        if val_off + 8 + str_len > stream_data.len() { return None; }

        let raw = &stream_data[val_off+8..val_off+8+str_len];
        let s = String::from_utf8_lossy(raw).trim_end_matches('\0').trim().to_string();
        return if s.is_empty() { None } else { Some(s) };
    }
    None
}

/// OLE SummaryInformation'dan integer property çıkarır
fn extract_ole_int_prop(stream_data: &[u8], prop_id: u32) -> Option<u32> {
    if stream_data.len() < 48 { return None; }
    if stream_data[0] != 0xFE || stream_data[1] != 0xFF { return None; }

    let sec_offset = u32::from_le_bytes([
        stream_data[44], stream_data[45], stream_data[46], stream_data[47]
    ]) as usize;
    if sec_offset + 8 > stream_data.len() { return None; }

    let c_props = u32::from_le_bytes([
        stream_data[sec_offset + 4], stream_data[sec_offset + 5],
        stream_data[sec_offset + 6], stream_data[sec_offset + 7]
    ]) as usize;

    for i in 0..c_props.min(200) {
        let entry = sec_offset + 8 + i * 8;
        if entry + 8 > stream_data.len() { break; }
        let pid = u32::from_le_bytes([
            stream_data[entry], stream_data[entry+1], stream_data[entry+2], stream_data[entry+3]
        ]);
        if pid != prop_id { continue; }

        let val_off = sec_offset + u32::from_le_bytes([
            stream_data[entry+4], stream_data[entry+5], stream_data[entry+6], stream_data[entry+7]
        ]) as usize;

        if val_off + 8 > stream_data.len() { return None; }
        let vtype = u32::from_le_bytes([
            stream_data[val_off], stream_data[val_off+1], stream_data[val_off+2], stream_data[val_off+3]
        ]);
        if vtype != 0x0003 { return None; } // VT_I4

        let val = u32::from_le_bytes([
            stream_data[val_off+4], stream_data[val_off+5], stream_data[val_off+6], stream_data[val_off+7]
        ]);
        return if val > 0 { Some(val) } else { None };
    }
    None
}

/// XML tag'inden basit değer çıkarır
fn xml_tag_value(content: &str, tag: &str) -> Option<String> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = content.find(&open)?;
    let gt = content[start..].find('>')? + start + 1;
    let end = content[gt..].find(&close)? + gt;
    let raw = content[gt..end].trim().to_string();
    if raw.is_empty() { None } else { Some(raw) }
}

/// Detects the original file type of a .bak file by reading its magic bytes and internal structure.
/// Returns the specific original format (e.g. "dwg", "max", "rvt", "psd", "docx", "xlsx") or empty string if unknown.
#[tauri::command]
pub fn detect_bak_source_type(path: String) -> Result<String, String> {
    let mut file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut header = [0u8; 16];
    let n = std::io::Read::read(&mut file, &mut header).unwrap_or(0);
    if n < 4 { return Ok(String::new()); }

    // DWG: starts with "AC" + version digits (AC1015, AC1018, etc.)
    if &header[0..2] == b"AC" && header[2].is_ascii_digit() && header[3].is_ascii_digit() {
        return Ok("dwg".to_string());
    }
    // PSD: starts with "8BPS"
    if n >= 4 && &header[0..4] == b"8BPS" {
        return Ok("psd".to_string());
    }
    // OLE/CFB (MAX, RVT, DOC, XLS, PPT): D0 CF 11 E0 — inspect streams to differentiate
    if n >= 4 && header[0] == 0xD0 && header[1] == 0xCF && header[2] == 0x11 && header[3] == 0xE0 {
        return detect_ole_subtype(&path);
    }
    // ZIP-based formats (DOCX, XLSX, PPTX, IFC): PK\x03\x04 — inspect entries to differentiate
    if n >= 4 && &header[0..4] == b"PK\x03\x04" {
        return detect_zip_subtype(&path);
    }
    // PDF: %PDF
    if n >= 4 && &header[0..4] == b"%PDF" {
        return Ok("pdf".to_string());
    }
    // BLEND: "BLENDER"
    if n >= 7 && &header[0..7] == b"BLENDER" {
        return Ok("blend".to_string());
    }
    // SKP: SketchUp files start with "SketchUp" marker in header
    if n >= 8 && &header[0..8] == b"SketchUp" {
        return Ok("skp".to_string());
    }
    // For generic text-based backups, check if it looks like plain text
    if header[..n.min(8)].iter().all(|&b| b.is_ascii() || b == 0x0A || b == 0x0D || b == 0x09) {
        return Ok("txt".to_string());
    }
    Ok(String::new())
}

/// Differentiates OLE/CFB-based formats by inspecting internal stream names.
pub fn detect_ole_subtype(path: &str) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let comp = match CompoundFile::open(file) {
        Ok(c) => c,
        Err(_) => return Ok("ole".to_string()),
    };

    let streams: Vec<String> = comp
        .walk()
        .map(|e| e.path().to_string_lossy().to_string())
        .collect();

    let has = |needle: &str| streams.iter().any(|s| s.contains(needle));

    // 3ds Max: contains "3ds Max" version string, "Config", "VideoPostQueue", "Scene" streams
    if has("3ds Max") || has("VideoPostQueue") || has("ClassData") || (has("Config") && has("Scene")) {
        return Ok("max".to_string());
    }
    // Revit: contains "BasicFileInfo", "RevitPreview4.0", "Revit" markers
    if has("BasicFileInfo") || has("RevitPreview") || has("Revit") {
        return Ok("rvt".to_string());
    }
    // MS Word: contains "WordDocument" stream
    if has("WordDocument") {
        return Ok("doc".to_string());
    }
    // MS Excel: contains "Workbook" or "Book" stream
    if has("Workbook") || has("/Book") {
        return Ok("xls".to_string());
    }
    // MS PowerPoint: contains "PowerPoint Document" stream
    if has("PowerPoint Document") || has("PowerPoint") {
        return Ok("ppt".to_string());
    }
    // Visio
    if has("VisioDocument") {
        return Ok("vsd".to_string());
    }
    // Unrecognized OLE
    Ok("ole".to_string())
}

/// Differentiates ZIP-based formats by inspecting internal file entries.
pub fn detect_zip_subtype(path: &str) -> Result<String, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(_) => return Ok("zip".to_string()),
    };

    let names: Vec<&str> = archive.file_names().collect();
    let has = |needle: &str| names.iter().any(|n| n.contains(needle));

    // DOCX: contains word/ directory
    if has("word/") {
        return Ok("docx".to_string());
    }
    // XLSX: contains xl/ directory
    if has("xl/") {
        return Ok("xlsx".to_string());
    }
    // PPTX: contains ppt/ directory
    if has("ppt/") {
        return Ok("pptx".to_string());
    }
    // IFC (ifczip): contains .ifc file
    if names.iter().any(|n| n.to_lowercase().ends_with(".ifc")) {
        return Ok("ifc".to_string());
    }
    // ArchiCAD PLN: contains "ProjectData" or specific PLN markers
    if has("ProjectData") || has("Project/") {
        return Ok("pln".to_string());
    }
    // GLB/glTF in zip
    if names.iter().any(|n| n.to_lowercase().ends_with(".gltf") || n.to_lowercase().ends_with(".glb")) {
        return Ok("glb".to_string());
    }
    // Unrecognized ZIP
    Ok("zip".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ═══════════════════════════════════════════════════════════
    // filetime_to_iso
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_filetime_zero() {
        assert_eq!(filetime_to_iso(0), None);
    }

    #[test]
    fn test_filetime_before_unix_epoch() {
        // Value less than EPOCH_DIFF → None
        assert_eq!(filetime_to_iso(100), None);
    }

    #[test]
    fn test_filetime_unix_epoch() {
        // EPOCH_DIFF = 116_444_736_000_000_000
        // Unix epoch exactly → 1970-01-01T00:00:00+00:00
        let result = filetime_to_iso(116_444_736_000_000_000);
        assert!(result.is_some());
        assert!(result.unwrap().starts_with("1970-01-01"));
    }

    #[test]
    fn test_filetime_known_date() {
        // 2024-01-01 00:00:00 UTC
        // Unix timestamp = 1704067200
        // FILETIME = (1704067200 * 10_000_000) + 116_444_736_000_000_000
        let ft = 1704067200u64 * 10_000_000 + 116_444_736_000_000_000;
        let result = filetime_to_iso(ft);
        assert!(result.is_some());
        assert!(result.unwrap().starts_with("2024-01-01"));
    }

    #[test]
    fn test_filetime_year_2000() {
        // 2000-01-01 00:00:00 UTC
        // Unix timestamp = 946684800
        let ft = 946684800u64 * 10_000_000 + 116_444_736_000_000_000;
        let result = filetime_to_iso(ft);
        assert!(result.is_some());
        assert!(result.unwrap().starts_with("2000-01-01"));
    }

    // ═══════════════════════════════════════════════════════════
    // parse_ole_summary_dates
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_ole_summary_empty() {
        assert_eq!(parse_ole_summary_dates(&[]), (None, None));
    }

    #[test]
    fn test_ole_summary_too_short() {
        assert_eq!(parse_ole_summary_dates(&[0xFE, 0xFF, 0x00]), (None, None));
    }

    #[test]
    fn test_ole_summary_wrong_bom() {
        let mut data = vec![0x00u8; 48];
        data[0] = 0x00; // Wrong BOM
        data[1] = 0x00;
        assert_eq!(parse_ole_summary_dates(&data), (None, None));
    }

    #[test]
    fn test_ole_summary_zero_sections() {
        let mut data = vec![0u8; 48];
        data[0] = 0xFE;
        data[1] = 0xFF;
        // cSections at offset 24 = 0 → None
        assert_eq!(parse_ole_summary_dates(&data), (None, None));
    }

    // ═══════════════════════════════════════════════════════════
    // xml_tag_value
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_xml_tag_basic() {
        let xml = "<root><title>Hello World</title></root>";
        assert_eq!(xml_tag_value(xml, "title"), Some("Hello World".into()));
    }

    #[test]
    fn test_xml_tag_missing() {
        let xml = "<root><name>Test</name></root>";
        assert_eq!(xml_tag_value(xml, "title"), None);
    }

    #[test]
    fn test_xml_tag_empty() {
        // Boş tag None dönebilir — fonksiyon tasarımına bağlı
        let xml = "<root><title></title></root>";
        let result = xml_tag_value(xml, "title");
        // Boş içerik → ya None ya Some("")
        assert!(result.is_none() || result.as_deref() == Some(""));
    }

    #[test]
    fn test_xml_tag_nested_content() {
        let xml = "<cp:lastModifiedBy>Ahmet</cp:lastModifiedBy>";
        assert_eq!(xml_tag_value(xml, "cp:lastModifiedBy"), Some("Ahmet".into()));
    }
}
