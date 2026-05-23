use std::io::Read;
use std::io::Cursor;
use serde::Serialize;

/// Extracts the SketchUp version from a .skp file.
/// Supports ZIP-based format (SketchUp 2021+) and old binary format.
/// For old binary: scans the first 8 KB for an ASCII "SketchUp" string
/// followed by a 4-digit year (20xx) or a version number (3–25).
#[tauri::command]
pub fn get_skp_version(path: String) -> Result<Option<String>, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    if data.len() < 4 {
        return Ok(None);
    }

    // ZIP-based format (SketchUp 2021+): starts with PK magic bytes
    if &data[0..4] == b"PK\x03\x04" {
        return skp_zip_version(&data);
    }

    // Old binary format: scan first 8 KB for "SketchUp" in ASCII or UTF-16LE
    let scan = &data[..data.len().min(8192)];

    // ASCII pattern
    let pat_ascii = b"SketchUp";
    // UTF-16LE pattern
    let pat_utf16: Vec<u8> = "SketchUp"
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();

    // ASCII scan
    let mut i = 0;
    while i + pat_ascii.len() < scan.len() {
        if scan[i..].starts_with(pat_ascii) {
            let after = &scan[i + pat_ascii.len()..];
            let skip = after.iter().take_while(|&&b| b == b' ' || b == b'\0').count();
            let rest = &after[skip..];
            let digits: String = rest
                .iter()
                .take(4)
                .take_while(|&&b| b.is_ascii_digit())
                .map(|&b| b as char)
                .collect();
            if let Some(label) = parse_skp_version_digits(&digits) {
                return Ok(Some(label));
            }
        }
        i += 1;
    }

    // UTF-16LE scan
    let mut j = 0;
    while j + pat_utf16.len() < scan.len() {
        if scan[j..].starts_with(pat_utf16.as_slice()) {
            let after = &scan[j + pat_utf16.len()..];
            // Skip UTF-16LE spaces (0x20 0x00) or nulls
            let skip = after.chunks(2)
                .take_while(|c| c.len() == 2 && (c[0] == b' ' || c[0] == 0) && c[1] == 0)
                .count() * 2;
            let rest = &after[skip..];
            if rest.len() % 2 != 0 {
                log::warn!("SKP: UTF-16LE data misaligned ({} bytes)", rest.len());
            }
            // Read up to 4 UTF-16LE digit characters
            let digits: String = rest.chunks_exact(2)
                .take(4)
                .take_while(|c| c[0].is_ascii_digit() && c[1] == 0)
                .map(|c| c[0] as char)
                .collect();
            if let Some(label) = parse_skp_version_digits(&digits) {
                return Ok(Some(label));
            }
        }
        j += 1;
    }

    Ok(None)
}

pub fn parse_skp_version_digits(digits: &str) -> Option<String> {
    if digits.len() == 4 && digits.starts_with("20") {
        return Some(format!("SketchUp {}", digits));
    }
    if !digits.is_empty() {
        let v: u32 = digits.parse().ok()?;
        if (3..=30).contains(&v) {
            return Some(match v {
                3..=8 => format!("SketchUp {}", v),
                _ => format!("SketchUp 20{:02}", v),
            });
        }
    }
    None
}

pub fn skp_zip_version(data: &[u8]) -> Result<Option<String>, String> {
    let cursor = Cursor::new(data);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return Ok(None),
    };

    // Collect JSON/XML filenames first (can't borrow archive mutably twice)
    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let f = archive.by_index(i).ok()?;
            let name = f.name().to_string();
            if name.ends_with(".json") || name.ends_with(".xml") { Some(name) } else { None }
        })
        .collect();

    for name in &names {
        let mut file = match archive.by_name(name) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let mut content = String::new();
        if file.read_to_string(&mut content).is_err() {
            continue;
        }
        for key in &["sketchupVersion", "applicationVersion", "su_version", "sketchUpVersion"] {
            if let Some(v) = json_extract_str_field(&content, key) {
                if !v.is_empty() {
                    return Ok(Some(if v.to_lowercase().contains("sketchup") {
                        v
                    } else {
                        format!("SketchUp {}", v)
                    }));
                }
            }
        }
    }

    Ok(None)
}

/// Minimal JSON field extractor (no full parse needed for a single string field).
pub fn json_extract_str_field(json: &str, key: &str) -> Option<String> {
    let search = format!("\"{}\"", key);
    let pos = json.find(&search)?;
    let after = json[pos + search.len()..].trim_start_matches([' ', '\t', '\n', '\r', ':'].as_slice()).trim_start();
    if let Some(content) = after.strip_prefix('"') {
        let end = content.find('"')?;
        Some(content[..end].to_string())
    } else {
        // Numeric value
        let val: String = after
            .chars()
            .take_while(|c| c.is_ascii_digit() || *c == '.')
            .collect();
        if val.is_empty() { None } else { Some(val) }
    }
}

// ─── Rich metadata ────────────────────────────────────────────────────────────

#[derive(Serialize, Default)]
pub struct SkpRichMetadata {
    pub version: Option<String>,
    pub file_size_bytes: u64,
    pub component_names: Vec<String>,
    pub layer_names: Vec<String>,
    pub material_names: Vec<String>,
    pub geo_location: Option<String>,
    pub description: Option<String>,
    pub scene_unit: Option<String>,
}

/// Extract all string values for an array key from a JSON string.
/// e.g. `"name": "Foo"` entries inside objects in a JSON array.
fn json_collect_array_field(json: &str, array_key: &str, value_key: &str) -> Vec<String> {
    let mut results = Vec::new();
    let array_search = format!("\"{}\"", array_key);
    let Some(arr_start) = json.find(&array_search) else { return results };
    // Find the '[' after the key
    let after_key = &json[arr_start + array_search.len()..];
    let Some(bracket_off) = after_key.find('[') else { return results };
    let array_content = &after_key[bracket_off + 1..];
    // Find matching ']'
    let mut depth = 1i32;
    let mut end = array_content.len();
    for (i, ch) in array_content.char_indices() {
        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 { end = i; break; }
            }
            _ => {}
        }
    }
    let array_str = &array_content[..end];
    // Collect all occurrences of value_key within this array string
    let mut search_from = array_str;
    let vkey_search = format!("\"{}\"", value_key);
    while let Some(pos) = search_from.find(&vkey_search) {
        let after = search_from[pos + vkey_search.len()..]
            .trim_start_matches([' ', '\t', '\n', '\r', ':'].as_slice())
            .trim_start();
        if let Some(content) = after.strip_prefix('"') {
            if let Some(end_q) = content.find('"') {
                let val = content[..end_q].to_string();
                if !val.is_empty() {
                    results.push(val);
                }
            }
        }
        search_from = &search_from[pos + vkey_search.len()..];
    }
    results
}

/// Extract printable ASCII strings of at least `min_len` characters from binary data.
fn extract_printable_strings(data: &[u8], min_len: usize) -> Vec<String> {
    let mut results = Vec::new();
    let mut current = Vec::new();
    for &b in data {
        if (0x20..0x7F).contains(&b) {
            current.push(b as char);
        } else {
            if current.len() >= min_len {
                results.push(current.iter().collect());
            }
            current.clear();
        }
    }
    if current.len() >= min_len {
        results.push(current.iter().collect());
    }
    results
}

/// Parse rich metadata from a ZIP-based (2021+) SKP file.
fn skp_zip_rich_metadata(data: &[u8], meta: &mut SkpRichMetadata) {
    let cursor = Cursor::new(data);
    let mut archive = match zip::ZipArchive::new(cursor) {
        Ok(a) => a,
        Err(_) => return,
    };

    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let f = archive.by_index(i).ok()?;
            let name = f.name().to_string();
            if name.ends_with(".json") { Some(name) } else { None }
        })
        .collect();

    for name in &names {
        let mut file = match archive.by_name(name) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let mut content = String::new();
        if file.read_to_string(&mut content).is_err() {
            continue;
        }

        // Components
        if meta.component_names.is_empty() {
            let v = json_collect_array_field(&content, "components", "name");
            if !v.is_empty() { meta.component_names = v; }
        }
        // Layers / tags
        if meta.layer_names.is_empty() {
            let v = json_collect_array_field(&content, "layers", "name");
            let v2 = if v.is_empty() { json_collect_array_field(&content, "tags", "name") } else { v };
            if !v2.is_empty() { meta.layer_names = v2; }
        }
        // Materials
        if meta.material_names.is_empty() {
            let v = json_collect_array_field(&content, "materials", "name");
            if !v.is_empty() { meta.material_names = v; }
        }
        // document.json fields
        if meta.geo_location.is_none() {
            meta.geo_location = json_extract_str_field(&content, "geoLocation")
                .or_else(|| json_extract_str_field(&content, "geo_location"))
                .or_else(|| json_extract_str_field(&content, "location"));
        }
        if meta.description.is_none() {
            meta.description = json_extract_str_field(&content, "description");
        }
        if meta.scene_unit.is_none() {
            meta.scene_unit = json_extract_str_field(&content, "units")
                .or_else(|| json_extract_str_field(&content, "sceneUnit"))
                .or_else(|| json_extract_str_field(&content, "unit"));
        }
    }
}

/// Parse what we can from old binary SKP files using printable string extraction.
fn skp_binary_rich_metadata(data: &[u8], meta: &mut SkpRichMetadata) {
    let scan = &data[..data.len().min(512 * 1024)];
    let strings = extract_printable_strings(scan, 4);

    // Heuristic: look for layer/material/component markers near known strings
    let layer_markers = ["Layer", "layer", "TAG", "Tag"];
    let material_markers = ["Material", "material", "mat_"];
    let component_markers = ["Component", "component", "comp_", "group_"];

    for s in &strings {
        for &m in &layer_markers {
            if s.starts_with(m) && s.len() > m.len() + 1 {
                let candidate = s[m.len()..].trim().to_string();
                if candidate.len() >= 2 && !meta.layer_names.contains(&candidate) {
                    meta.layer_names.push(candidate);
                }
                break;
            }
        }
        for &m in &material_markers {
            if s.starts_with(m) && s.len() > m.len() + 1 {
                let candidate = s[m.len()..].trim().to_string();
                if candidate.len() >= 2 && !meta.material_names.contains(&candidate) {
                    meta.material_names.push(candidate);
                }
                break;
            }
        }
        for &m in &component_markers {
            if s.starts_with(m) && s.len() > m.len() + 1 {
                let candidate = s[m.len()..].trim().to_string();
                if candidate.len() >= 2 && !meta.component_names.contains(&candidate) {
                    meta.component_names.push(candidate);
                }
                break;
            }
        }
    }

    // Limit to reasonable counts
    meta.layer_names.truncate(100);
    meta.material_names.truncate(100);
    meta.component_names.truncate(100);
}

#[tauri::command]
pub fn extract_skp_metadata(path: String) -> Result<SkpRichMetadata, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let file_size_bytes = data.len() as u64;

    let version = get_skp_version(path.clone()).ok().flatten();

    let mut meta = SkpRichMetadata {
        version,
        file_size_bytes,
        ..Default::default()
    };

    if data.len() >= 4 && &data[0..4] == b"PK\x03\x04" {
        skp_zip_rich_metadata(&data, &mut meta);
    } else {
        skp_binary_rich_metadata(&data, &mut meta);
    }

    Ok(meta)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ═══════════════════════════════════════════════════════════
    // parse_skp_version_digits
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_skp_version_4digit_year() {
        assert_eq!(parse_skp_version_digits("2021"), Some("SketchUp 2021".into()));
        assert_eq!(parse_skp_version_digits("2024"), Some("SketchUp 2024".into()));
        assert_eq!(parse_skp_version_digits("2017"), Some("SketchUp 2017".into()));
    }

    #[test]
    fn test_skp_version_low_numbers() {
        assert_eq!(parse_skp_version_digits("3"), Some("SketchUp 3".into()));
        assert_eq!(parse_skp_version_digits("8"), Some("SketchUp 8".into()));
    }

    #[test]
    fn test_skp_version_high_numbers_become_20xx() {
        assert_eq!(parse_skp_version_digits("14"), Some("SketchUp 2014".into()));
        assert_eq!(parse_skp_version_digits("21"), Some("SketchUp 2021".into()));
        assert_eq!(parse_skp_version_digits("30"), Some("SketchUp 2030".into()));
    }

    #[test]
    fn test_skp_version_out_of_range() {
        assert_eq!(parse_skp_version_digits("0"), None);
        assert_eq!(parse_skp_version_digits("1"), None);
        assert_eq!(parse_skp_version_digits("2"), None);
        assert_eq!(parse_skp_version_digits("31"), None);
        assert_eq!(parse_skp_version_digits("100"), None);
    }

    #[test]
    fn test_skp_version_empty() {
        assert_eq!(parse_skp_version_digits(""), None);
    }

    #[test]
    fn test_skp_version_non_numeric() {
        assert_eq!(parse_skp_version_digits("abc"), None);
        // "20xx" → 4 char, starts with "20" → "SketchUp 20xx" (format dönüşü)
        assert_eq!(parse_skp_version_digits("20xx"), Some("SketchUp 20xx".into()));
    }

    #[test]
    fn test_skp_version_non_20xx_4digit() {
        // 4 digit but not starting with "20"
        assert_eq!(parse_skp_version_digits("1999"), None);
        assert_eq!(parse_skp_version_digits("3000"), None);
    }

    // ═══════════════════════════════════════════════════════════
    // json_extract_str_field
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_json_extract_string_value() {
        let json = r#"{"sketchupVersion": "2024.1"}"#;
        assert_eq!(json_extract_str_field(json, "sketchupVersion"), Some("2024.1".into()));
    }

    #[test]
    fn test_json_extract_numeric_value() {
        let json = r#"{"version": 2021}"#;
        assert_eq!(json_extract_str_field(json, "version"), Some("2021".into()));
    }

    #[test]
    fn test_json_extract_float_value() {
        let json = r#"{"version": 24.1}"#;
        assert_eq!(json_extract_str_field(json, "version"), Some("24.1".into()));
    }

    #[test]
    fn test_json_extract_missing_key() {
        let json = r#"{"name": "test"}"#;
        assert_eq!(json_extract_str_field(json, "version"), None);
    }

    #[test]
    fn test_json_extract_empty_string() {
        let json = r#"{"version": ""}"#;
        assert_eq!(json_extract_str_field(json, "version"), Some("".into()));
    }

    #[test]
    fn test_json_extract_with_whitespace() {
        let json = r#"{ "version" :   "2023" }"#;
        assert_eq!(json_extract_str_field(json, "version"), Some("2023".into()));
    }

    #[test]
    fn test_json_extract_nested() {
        let json = r#"{"meta": {"su_version": "22.0"}, "su_version": "23.0"}"#;
        // Should find first occurrence
        assert_eq!(json_extract_str_field(json, "su_version"), Some("22.0".into()));
    }
}
