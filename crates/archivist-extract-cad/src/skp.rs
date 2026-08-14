//! SketchUp (SKP) — surum + zengin metadata. H2 `skp_version.rs`'ten nakil.
//!
//! Iki format: ZIP-tabanli (2021+; JSON icinde surum/bilesen/katman/malzeme) ve eski
//! ikili (ilk 8 KB'de "SketchUp" + yil/surum taramasi). Saf-Rust + zip.

use std::io::{Cursor, Read};

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor};

/// SketchUp dosyalari icin extractor.
pub struct SkpExtractor;

impl Extractor for SkpExtractor {
    fn id(&self) -> &'static str {
        "skp"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["skp"]
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let data = std::fs::read(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
        if data.len() < 4 {
            return Err(ExtractError::Parse("SKP cok kucuk".to_string()));
        }

        let version = skp_version(&data);
        let mut info = SkpInfo::default();
        if &data[0..4] == b"PK\x03\x04" {
            skp_zip_rich_metadata(&data, &mut info);
        } else {
            skp_binary_rich_metadata(&data, &mut info);
        }

        let mut out = Extracted::new();
        if let Some(v) = &version {
            out.set("version", v.clone());
        }
        out.set("component_count", info.component_names.len());
        out.set("layer_count", info.layer_names.len());
        out.set("material_count", info.material_names.len());
        if let Some(v) = &info.geo_location {
            out.set("geo_location", v.clone());
        }
        if let Some(v) = &info.description {
            out.set("description", v.clone());
        }
        if let Some(v) = &info.scene_unit {
            out.set("scene_unit", v.clone());
        }

        // FTS body: bilesen/katman/malzeme adlari + aciklama.
        let mut parts: Vec<String> = Vec::new();
        parts.extend(info.component_names);
        parts.extend(info.layer_names);
        parts.extend(info.material_names);
        if let Some(v) = info.description {
            parts.push(v);
        }
        if !parts.is_empty() {
            out.text = Some(parts.join("\n"));
        }
        // Thumbnail: gomulu en buyuk JPEG onizleme (ilk 4MB; H2 get_skp_thumbnail deseni).
        // ZIP-tabanli ve eski-ikili SKP'lerin ikisinde de gomulu JPEG bulunur.
        out.thumbnail = archivist_thumbnail::scan_largest_jpeg(&data, 4 * 1024 * 1024, 64);
        Ok(out)
    }
}

#[derive(Default)]
struct SkpInfo {
    component_names: Vec<String>,
    layer_names: Vec<String>,
    material_names: Vec<String>,
    geo_location: Option<String>,
    description: Option<String>,
    scene_unit: Option<String>,
}

/// Surum tespiti (ZIP 2021+ veya eski ikili).
fn skp_version(data: &[u8]) -> Option<String> {
    if data.len() < 4 {
        return None;
    }
    if &data[0..4] == b"PK\x03\x04" {
        return skp_zip_version(data);
    }

    let scan = &data[..data.len().min(8192)];
    let pat_ascii = b"SketchUp";
    let pat_utf16: Vec<u8> = "SketchUp".encode_utf16().flat_map(u16::to_le_bytes).collect();

    let mut i = 0;
    while i + pat_ascii.len() < scan.len() {
        if scan[i..].starts_with(pat_ascii) {
            let after = &scan[i + pat_ascii.len()..];
            let skip = after.iter().take_while(|&&b| b == b' ' || b == b'\0').count();
            let digits: String = after[skip..]
                .iter()
                .take(4)
                .take_while(|&&b| b.is_ascii_digit())
                .map(|&b| b as char)
                .collect();
            if let Some(label) = parse_skp_version_digits(&digits) {
                return Some(label);
            }
        }
        i += 1;
    }

    let mut j = 0;
    while j + pat_utf16.len() < scan.len() {
        if scan[j..].starts_with(pat_utf16.as_slice()) {
            let after = &scan[j + pat_utf16.len()..];
            let skip = after
                .chunks(2)
                .take_while(|c| c.len() == 2 && (c[0] == b' ' || c[0] == 0) && c[1] == 0)
                .count()
                * 2;
            let digits: String = after[skip..]
                .chunks_exact(2)
                .take(4)
                .take_while(|c| c[0].is_ascii_digit() && c[1] == 0)
                .map(|c| c[0] as char)
                .collect();
            if let Some(label) = parse_skp_version_digits(&digits) {
                return Some(label);
            }
        }
        j += 1;
    }
    None
}

fn parse_skp_version_digits(digits: &str) -> Option<String> {
    if digits.len() == 4 && digits.starts_with("20") {
        return Some(format!("SketchUp {digits}"));
    }
    if !digits.is_empty() {
        let v: u32 = digits.parse().ok()?;
        if (3..=30).contains(&v) {
            return Some(match v {
                3..=8 => format!("SketchUp {v}"),
                _ => format!("SketchUp 20{v:02}"),
            });
        }
    }
    None
}

fn skp_zip_version(data: &[u8]) -> Option<String> {
    let cursor = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).ok()?;
    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let f = archive.by_index(i).ok()?;
            let name = f.name().to_string();
            (name.ends_with(".json") || name.ends_with(".xml")).then_some(name)
        })
        .collect();

    for name in &names {
        let Ok(mut file) = archive.by_name(name) else { continue };
        let mut content = String::new();
        if file.read_to_string(&mut content).is_err() {
            continue;
        }
        for key in ["sketchupVersion", "applicationVersion", "su_version", "sketchUpVersion"] {
            if let Some(v) = json_extract_str_field(&content, key) {
                if !v.is_empty() {
                    return Some(if v.to_lowercase().contains("sketchup") {
                        v
                    } else {
                        format!("SketchUp {v}")
                    });
                }
            }
        }
    }
    None
}

/// Minimal JSON string-alan cikaricisi (tek alan icin tam parse gereksiz).
fn json_extract_str_field(json: &str, key: &str) -> Option<String> {
    let search = format!("\"{key}\"");
    let pos = json.find(&search)?;
    let after = json[pos + search.len()..]
        .trim_start_matches([' ', '\t', '\n', '\r', ':'].as_slice())
        .trim_start();
    if let Some(content) = after.strip_prefix('"') {
        let end = content.find('"')?;
        Some(content[..end].to_string())
    } else {
        let val: String = after.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
        (!val.is_empty()).then_some(val)
    }
}

/// JSON dizisi icindeki bir alanin tum string degerlerini topla.
fn json_collect_array_field(json: &str, array_key: &str, value_key: &str) -> Vec<String> {
    let mut results = Vec::new();
    let array_search = format!("\"{array_key}\"");
    let Some(arr_start) = json.find(&array_search) else { return results };
    let after_key = &json[arr_start + array_search.len()..];
    let Some(bracket_off) = after_key.find('[') else { return results };
    let array_content = &after_key[bracket_off + 1..];

    let mut depth = 1i32;
    let mut end = array_content.len();
    for (i, ch) in array_content.char_indices() {
        match ch {
            '[' => depth += 1,
            ']' => {
                depth -= 1;
                if depth == 0 {
                    end = i;
                    break;
                }
            }
            _ => {}
        }
    }
    let array_str = &array_content[..end];

    let vkey_search = format!("\"{value_key}\"");
    let mut search_from = array_str;
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

/// İkili veriden en az `min_len` uzunlukta yazdirilabilir ASCII run'lari cikar.
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

fn skp_zip_rich_metadata(data: &[u8], info: &mut SkpInfo) {
    let cursor = Cursor::new(data);
    let Ok(mut archive) = zip::ZipArchive::new(cursor) else { return };
    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            let f = archive.by_index(i).ok()?;
            let name = f.name().to_string();
            name.ends_with(".json").then_some(name)
        })
        .collect();

    for name in &names {
        let Ok(mut file) = archive.by_name(name) else { continue };
        let mut content = String::new();
        if file.read_to_string(&mut content).is_err() {
            continue;
        }
        if info.component_names.is_empty() {
            let v = json_collect_array_field(&content, "components", "name");
            if !v.is_empty() {
                info.component_names = v;
            }
        }
        if info.layer_names.is_empty() {
            let v = json_collect_array_field(&content, "layers", "name");
            let v2 = if v.is_empty() {
                json_collect_array_field(&content, "tags", "name")
            } else {
                v
            };
            if !v2.is_empty() {
                info.layer_names = v2;
            }
        }
        if info.material_names.is_empty() {
            let v = json_collect_array_field(&content, "materials", "name");
            if !v.is_empty() {
                info.material_names = v;
            }
        }
        if info.geo_location.is_none() {
            info.geo_location = json_extract_str_field(&content, "geoLocation")
                .or_else(|| json_extract_str_field(&content, "geo_location"))
                .or_else(|| json_extract_str_field(&content, "location"));
        }
        if info.description.is_none() {
            info.description = json_extract_str_field(&content, "description");
        }
        if info.scene_unit.is_none() {
            info.scene_unit = json_extract_str_field(&content, "units")
                .or_else(|| json_extract_str_field(&content, "sceneUnit"))
                .or_else(|| json_extract_str_field(&content, "unit"));
        }
    }
}

fn skp_binary_rich_metadata(data: &[u8], info: &mut SkpInfo) {
    let scan = &data[..data.len().min(512 * 1024)];
    let strings = extract_printable_strings(scan, 4);

    let layer_markers = ["Layer", "layer", "TAG", "Tag"];
    let material_markers = ["Material", "material", "mat_"];
    let component_markers = ["Component", "component", "comp_", "group_"];

    for s in &strings {
        push_marked(s, &layer_markers, &mut info.layer_names);
        push_marked(s, &material_markers, &mut info.material_names);
        push_marked(s, &component_markers, &mut info.component_names);
    }
    info.layer_names.truncate(100);
    info.material_names.truncate(100);
    info.component_names.truncate(100);
}

/// `s`, `markers`'tan biriyle baslıyorsa kalanini `out`'a ekle (dedup).
fn push_marked(s: &str, markers: &[&str], out: &mut Vec<String>) {
    for &m in markers {
        if s.starts_with(m) && s.len() > m.len() + 1 {
            let candidate = s[m.len()..].trim().to_string();
            if candidate.len() >= 2 && !out.contains(&candidate) {
                out.push(candidate);
            }
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_digits() {
        assert_eq!(parse_skp_version_digits("2021").as_deref(), Some("SketchUp 2021"));
        assert_eq!(parse_skp_version_digits("8").as_deref(), Some("SketchUp 8"));
        assert_eq!(parse_skp_version_digits("21").as_deref(), Some("SketchUp 2021"));
        assert_eq!(parse_skp_version_digits("30").as_deref(), Some("SketchUp 2030"));
        assert_eq!(parse_skp_version_digits("2"), None);
        assert_eq!(parse_skp_version_digits("31"), None);
        assert_eq!(parse_skp_version_digits("1999"), None);
        assert_eq!(parse_skp_version_digits(""), None);
    }

    #[test]
    fn json_field_extraction() {
        assert_eq!(
            json_extract_str_field(r#"{"sketchupVersion": "2024.1"}"#, "sketchupVersion").as_deref(),
            Some("2024.1")
        );
        assert_eq!(json_extract_str_field(r#"{"version": 2021}"#, "version").as_deref(), Some("2021"));
        assert_eq!(json_extract_str_field(r#"{ "v" :  "23" }"#, "v").as_deref(), Some("23"));
        assert_eq!(json_extract_str_field(r#"{"name":"x"}"#, "version"), None);
    }

    #[test]
    fn array_field_collection() {
        let json = r#"{"components":[{"name":"Kapi"},{"name":"Pencere"}]}"#;
        assert_eq!(json_collect_array_field(json, "components", "name"), vec!["Kapi", "Pencere"]);
    }

    #[test]
    fn printable_strings() {
        let data = b"ab\x00MerhabaDunya\x01xy";
        let strings = extract_printable_strings(data, 4);
        assert!(strings.iter().any(|s| s == "MerhabaDunya"));
    }
}
