//! Office zengin metadata — OLE SummaryInformation + OOXML docProps.
//!
//! H2 `office_utils.rs`'ten nakil. **chrono bagimliligi kaldirildi:** FILETIME→ISO
//! kendi-kendine yeten civil-date algoritmasiyla (Howard Hinnant) hesaplanir.

use std::io::{Cursor, Read};

use cfb::CompoundFile;

/// Office dosyasindan cikan zengin metadata (alan torbasina aktarilir).
#[derive(Debug, Default, PartialEq)]
pub struct OfficeMeta {
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

/// Windows FILETIME (1601'den beri 100-ns) → ISO-8601 (UTC).
pub fn filetime_to_iso(ft: u64) -> Option<String> {
    if ft == 0 {
        return None;
    }
    // FILETIME epoch (1601) ile Unix epoch (1970) arasi fark, 100-ns biriminde.
    const EPOCH_DIFF: u64 = 116_444_736_000_000_000;
    if ft < EPOCH_DIFF {
        return None;
    }
    let unix_secs = (ft - EPOCH_DIFF) / 10_000_000;
    Some(unix_secs_to_iso(unix_secs))
}

/// Unix saniyesi → `YYYY-MM-DDTHH:MM:SS+00:00`.
fn unix_secs_to_iso(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let (y, mo, d) = civil_from_days(days);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}+00:00")
}

/// Gun sayisindan (1970-01-01 = 0) takvim tarihine — Howard Hinnant algoritmasi.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// OLE/CFB SummaryInformation stream'inden olusturma + son-kayit tarihlerini oku.
/// PIDSI_CREATE_DTM = 0x0C, PIDSI_LASTSAVE_DTM = 0x0D, ikisi de VT_FILETIME = 0x40.
pub fn parse_ole_summary_dates(stream_data: &[u8]) -> (Option<String>, Option<String>) {
    if stream_data.len() < 48 {
        return (None, None);
    }
    if stream_data[0] != 0xFE || stream_data[1] != 0xFF {
        return (None, None);
    }
    let c_sections =
        u32::from_le_bytes([stream_data[24], stream_data[25], stream_data[26], stream_data[27]])
            as usize;
    if c_sections == 0 {
        return (None, None);
    }
    let sec_offset =
        u32::from_le_bytes([stream_data[44], stream_data[45], stream_data[46], stream_data[47]])
            as usize;
    if sec_offset + 8 > stream_data.len() {
        return (None, None);
    }
    let c_props = u32::from_le_bytes([
        stream_data[sec_offset + 4],
        stream_data[sec_offset + 5],
        stream_data[sec_offset + 6],
        stream_data[sec_offset + 7],
    ]) as usize;
    if c_props == 0 || c_props > 1000 {
        return (None, None);
    }

    let mut create_date = None;
    let mut modify_date = None;
    for i in 0..c_props {
        let entry = sec_offset + 8 + i * 8;
        if entry + 8 > stream_data.len() {
            break;
        }
        let prop_id = u32::from_le_bytes([
            stream_data[entry],
            stream_data[entry + 1],
            stream_data[entry + 2],
            stream_data[entry + 3],
        ]);
        if prop_id != 0x0C && prop_id != 0x0D {
            continue;
        }
        let val_off = sec_offset
            + u32::from_le_bytes([
                stream_data[entry + 4],
                stream_data[entry + 5],
                stream_data[entry + 6],
                stream_data[entry + 7],
            ]) as usize;
        if val_off + 12 > stream_data.len() {
            continue;
        }
        let vtype = u32::from_le_bytes([
            stream_data[val_off],
            stream_data[val_off + 1],
            stream_data[val_off + 2],
            stream_data[val_off + 3],
        ]);
        if vtype != 0x0040 {
            continue;
        }
        let ft = u64::from_le_bytes([
            stream_data[val_off + 4],
            stream_data[val_off + 5],
            stream_data[val_off + 6],
            stream_data[val_off + 7],
            stream_data[val_off + 8],
            stream_data[val_off + 9],
            stream_data[val_off + 10],
            stream_data[val_off + 11],
        ]);
        if prop_id == 0x0C {
            create_date = filetime_to_iso(ft);
        } else {
            modify_date = filetime_to_iso(ft);
        }
    }
    (create_date, modify_date)
}

/// OLE SummaryInformation'dan VT_LPSTR (0x1E) string property.
pub fn extract_ole_string_prop(stream_data: &[u8], prop_id: u32) -> Option<String> {
    if stream_data.len() < 48 || stream_data[0] != 0xFE || stream_data[1] != 0xFF {
        return None;
    }
    let sec_offset =
        u32::from_le_bytes([stream_data[44], stream_data[45], stream_data[46], stream_data[47]])
            as usize;
    if sec_offset + 8 > stream_data.len() {
        return None;
    }
    let c_props = u32::from_le_bytes([
        stream_data[sec_offset + 4],
        stream_data[sec_offset + 5],
        stream_data[sec_offset + 6],
        stream_data[sec_offset + 7],
    ]) as usize;

    for i in 0..c_props.min(200) {
        let entry = sec_offset + 8 + i * 8;
        if entry + 8 > stream_data.len() {
            break;
        }
        let pid = u32::from_le_bytes([
            stream_data[entry],
            stream_data[entry + 1],
            stream_data[entry + 2],
            stream_data[entry + 3],
        ]);
        if pid != prop_id {
            continue;
        }
        let val_off = sec_offset
            + u32::from_le_bytes([
                stream_data[entry + 4],
                stream_data[entry + 5],
                stream_data[entry + 6],
                stream_data[entry + 7],
            ]) as usize;
        if val_off + 8 > stream_data.len() {
            return None;
        }
        let vtype = u32::from_le_bytes([
            stream_data[val_off],
            stream_data[val_off + 1],
            stream_data[val_off + 2],
            stream_data[val_off + 3],
        ]);
        if vtype != 0x001E {
            return None;
        }
        let str_len = u32::from_le_bytes([
            stream_data[val_off + 4],
            stream_data[val_off + 5],
            stream_data[val_off + 6],
            stream_data[val_off + 7],
        ]) as usize;
        if val_off + 8 + str_len > stream_data.len() {
            return None;
        }
        let raw = &stream_data[val_off + 8..val_off + 8 + str_len];
        // VT_LPSTR ANSI kod sayfasidir (UTF-8 DEGIL): Turkce belgelerde CP1254.
        // `from_utf8_lossy` Turkce title/author'i � yapiyordu → decode_bytes (CP1254).
        let s = archivist_extract::decode_bytes(raw).trim_end_matches('\0').trim().to_string();
        return if s.is_empty() { None } else { Some(s) };
    }
    None
}

/// OLE SummaryInformation'dan VT_I4 (0x03) integer property.
pub fn extract_ole_int_prop(stream_data: &[u8], prop_id: u32) -> Option<u32> {
    if stream_data.len() < 48 || stream_data[0] != 0xFE || stream_data[1] != 0xFF {
        return None;
    }
    let sec_offset =
        u32::from_le_bytes([stream_data[44], stream_data[45], stream_data[46], stream_data[47]])
            as usize;
    if sec_offset + 8 > stream_data.len() {
        return None;
    }
    let c_props = u32::from_le_bytes([
        stream_data[sec_offset + 4],
        stream_data[sec_offset + 5],
        stream_data[sec_offset + 6],
        stream_data[sec_offset + 7],
    ]) as usize;

    for i in 0..c_props.min(200) {
        let entry = sec_offset + 8 + i * 8;
        if entry + 8 > stream_data.len() {
            break;
        }
        let pid = u32::from_le_bytes([
            stream_data[entry],
            stream_data[entry + 1],
            stream_data[entry + 2],
            stream_data[entry + 3],
        ]);
        if pid != prop_id {
            continue;
        }
        let val_off = sec_offset
            + u32::from_le_bytes([
                stream_data[entry + 4],
                stream_data[entry + 5],
                stream_data[entry + 6],
                stream_data[entry + 7],
            ]) as usize;
        if val_off + 8 > stream_data.len() {
            return None;
        }
        let vtype = u32::from_le_bytes([
            stream_data[val_off],
            stream_data[val_off + 1],
            stream_data[val_off + 2],
            stream_data[val_off + 3],
        ]);
        if vtype != 0x0003 {
            return None;
        }
        let val = u32::from_le_bytes([
            stream_data[val_off + 4],
            stream_data[val_off + 5],
            stream_data[val_off + 6],
            stream_data[val_off + 7],
        ]);
        return if val > 0 { Some(val) } else { None };
    }
    None
}

/// OOXML (DOCX/XLSX/PPTX) docProps/core.xml + app.xml + (xlsx) sheet adlari.
pub fn extract_ooxml_metadata(data: &[u8], meta: &mut OfficeMeta) {
    let cursor = Cursor::new(data);
    let Ok(mut archive) = zip::ZipArchive::new(cursor) else {
        return;
    };

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

    if let Ok(mut f) = archive.by_name("docProps/app.xml") {
        let mut content = String::new();
        if f.read_to_string(&mut content).is_ok() {
            meta.page_count = xml_tag_value(&content, "Pages").and_then(|v| v.parse().ok());
            meta.word_count = xml_tag_value(&content, "Words").and_then(|v| v.parse().ok());
            meta.slide_count = xml_tag_value(&content, "Slides").and_then(|v| v.parse().ok());
        }
    }

    if meta.file_format == "xlsx" {
        if let Ok(mut f) = archive.by_name("xl/workbook.xml") {
            let mut content = String::new();
            if f.read_to_string(&mut content).is_ok() {
                meta.sheet_names = extract_sheet_names(&content);
            }
        }
    }
}

/// `<sheet name="...">` adlarini UTF-8 sinir-guvenli cikar.
fn extract_sheet_names(content: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut pos = 0;
    while let Some(idx) = content[pos..].find("name=\"") {
        let start = pos + idx + 6;
        let Some(end) = content[start..].find('"') else {
            break;
        };
        if content.is_char_boundary(start) && content.is_char_boundary(start + end) {
            if let Some(name) = content.get(start..start + end) {
                if !name.is_empty() {
                    names.push(name.to_string());
                }
            }
        }
        pos = start + end + 1;
    }
    names
}

/// OLE (DOC/XLS/PPT) SummaryInformation'dan tarih + property'leri doldur.
pub fn extract_ole_metadata(data: &[u8], meta: &mut OfficeMeta) {
    let cursor = Cursor::new(data);
    let Ok(mut comp) = CompoundFile::open(cursor) else {
        return;
    };
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

/// ZIP icerigine gore OOXML alt-turu (docx/xlsx/pptx/zip).
pub fn detect_zip_subtype(data: &[u8]) -> String {
    let cursor = Cursor::new(data);
    let Ok(archive) = zip::ZipArchive::new(cursor) else {
        return "zip".to_string();
    };
    let names: Vec<String> = archive.file_names().map(ToString::to_string).collect();
    if names.iter().any(|n| n.contains("word/")) {
        return "docx".to_string();
    }
    if names.iter().any(|n| n.contains("xl/")) {
        return "xlsx".to_string();
    }
    if names.iter().any(|n| n.contains("ppt/")) {
        return "pptx".to_string();
    }
    "zip".to_string()
}

/// OLE stream adlarina gore eski alt-tur (doc/xls/ppt/ole).
pub fn detect_ole_subtype(data: &[u8]) -> String {
    let cursor = Cursor::new(data);
    let Ok(comp) = CompoundFile::open(cursor) else {
        return "ole".to_string();
    };
    let streams: Vec<String> =
        comp.walk().map(|e| e.path().to_string_lossy().to_string()).collect();
    let has = |needle: &str| streams.iter().any(|s| s.contains(needle));
    if has("WordDocument") {
        return "doc".to_string();
    }
    if has("Workbook") || has("/Book") {
        return "xls".to_string();
    }
    if has("PowerPoint Document") || has("PowerPoint") {
        return "ppt".to_string();
    }
    "ole".to_string()
}

/// XML tag'inden basit deger cikar (`<tag ...>deger</tag>`).
pub fn xml_tag_value(content: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let start = content.find(&open)?;
    let gt = content[start..].find('>')? + start + 1;
    let end = content[gt..].find(&close)? + gt;
    let raw = content[gt..end].trim().to_string();
    if raw.is_empty() {
        None
    } else {
        Some(raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filetime_zero_and_before_epoch() {
        assert_eq!(filetime_to_iso(0), None);
        assert_eq!(filetime_to_iso(100), None);
    }

    #[test]
    fn filetime_unix_epoch() {
        let r = filetime_to_iso(116_444_736_000_000_000).unwrap();
        assert!(r.starts_with("1970-01-01"), "got {r}");
    }

    #[test]
    fn filetime_known_dates() {
        let ft_2024 = 1_704_067_200u64 * 10_000_000 + 116_444_736_000_000_000;
        assert!(filetime_to_iso(ft_2024).unwrap().starts_with("2024-01-01"));
        let ft_2000 = 946_684_800u64 * 10_000_000 + 116_444_736_000_000_000;
        assert!(filetime_to_iso(ft_2000).unwrap().starts_with("2000-01-01"));
    }

    #[test]
    fn ole_summary_guards() {
        assert_eq!(parse_ole_summary_dates(&[]), (None, None));
        assert_eq!(parse_ole_summary_dates(&[0xFE, 0xFF, 0x00]), (None, None));
        let mut wrong_bom = vec![0u8; 48];
        wrong_bom[0] = 0x00;
        assert_eq!(parse_ole_summary_dates(&wrong_bom), (None, None));
        let mut zero_sec = vec![0u8; 48];
        zero_sec[0] = 0xFE;
        zero_sec[1] = 0xFF;
        assert_eq!(parse_ole_summary_dates(&zero_sec), (None, None));
    }

    #[test]
    fn xml_tag_basic() {
        assert_eq!(
            xml_tag_value("<root><dc:title>Merhaba</dc:title></root>", "dc:title").as_deref(),
            Some("Merhaba")
        );
        assert_eq!(xml_tag_value("<root></root>", "dc:title"), None);
    }

    #[test]
    fn sheet_names_basic() {
        let xml = r#"<sheets><sheet name="Sayfa1" sheetId="1"/><sheet name="Bütçe" sheetId="2"/></sheets>"#;
        assert_eq!(extract_sheet_names(xml), vec!["Sayfa1", "Bütçe"]);
    }
}
