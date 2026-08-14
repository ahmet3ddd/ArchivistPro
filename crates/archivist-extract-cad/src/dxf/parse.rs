//! DXF grup-kodu ayristirma yardimcilari (private modul-ici). `mod.rs` `impl Extractor`
//! bunlari cagirir (bu yuzden cagirilanlar `pub(super)`); sekil geometrisi
//! [`super::shapes`], CFBF/CLSID/OLE yardimcilari [`crate::dwg`] icindedir.

#![allow(clippy::collapsible_match)]

use std::collections::{HashMap, HashSet};

use crate::dwg::fields::DrawingProperties;
use crate::dwg::{
    clsid_to_guid_string, detect_ole_progid, get_dwg_version, hex_decode, is_progid_shape,
    known_clsids, read_cfbf_root_clsid,
};

/// DXF (ASCII/UTF-8) grup-kodu ciftleri. Binary DXF (R2010+) desteklenmiyor.
pub(super) fn read_dxf_pairs(data: &[u8]) -> Result<Vec<(i32, String)>, String> {
    if data.starts_with(b"AutoCAD Binary DXF") {
        return Err("Binary DXF formati desteklenmiyor".to_string());
    }
    // UTF-8 degilse Windows-1254 varsay (Latin-1 DEGIL → Turkce layer/title/author
    // dogru cozulur; eski `b as char` sessiz mojibake uretiyordu).
    let content = archivist_extract::decode_bytes(data);
    let mut pairs = Vec::new();
    let mut lines = content.lines();
    while let Some(code_str) = lines.next() {
        let code_line = code_str.trim();
        if code_line.is_empty() {
            continue;
        }
        let Ok(code) = code_line.parse::<i32>() else { continue };
        let Some(value_line) = lines.next() else { break };
        pairs.push((code, value_line.trim().to_string()));
    }
    Ok(pairs)
}

pub(super) fn extract_dxf_version(pairs: &[(i32, String)]) -> Option<String> {
    pairs
        .iter()
        .zip(pairs.iter().skip(1))
        .find(|((g, v), _)| *g == 9 && v == "$ACADVER")
        .and_then(|(_, (_, ver))| {
            let padded = format!("{ver:<6}");
            get_dwg_version(padded.as_bytes())
        })
}

pub(super) fn extract_dxf_layers(pairs: &[(i32, String)]) -> Vec<String> {
    let mut layers = HashSet::new();
    let mut in_tables = false;
    let mut in_layer_entry = false;
    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "TABLES") => in_tables = true,
            (0, "ENDSEC") => {
                in_tables = false;
                in_layer_entry = false;
            }
            (0, "LAYER") if in_tables => in_layer_entry = true,
            (0, _) if in_tables => in_layer_entry = false,
            (2, name) if in_layer_entry && in_tables => {
                let n = name.trim();
                if !n.is_empty() && n != "0" {
                    layers.insert(n.to_string());
                }
            }
            _ => {}
        }
    }
    let mut result: Vec<String> = layers.into_iter().collect();
    result.sort();
    result.truncate(500);
    result
}

pub(super) fn extract_dxf_blocks(pairs: &[(i32, String)]) -> Vec<String> {
    let mut blocks = HashSet::new();
    let mut in_blocks = false;
    let mut in_block_entry = false;
    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "BLOCKS") if !in_blocks => in_blocks = true,
            (0, "ENDSEC") if in_blocks => {
                in_blocks = false;
                in_block_entry = false;
            }
            (0, "BLOCK") if in_blocks => in_block_entry = true,
            (0, "ENDBLK") if in_blocks => in_block_entry = false,
            (2, name) if in_block_entry && in_blocks => {
                // `*` ile baslayanlar AutoCAD ANONIM/dahili bloklaridir (*MODEL_SPACE,
                // *PAPER_SPACE, *D131 hatch/boyut, *U/*X) — kullanici blogu degil → ele.
                if !name.starts_with('*') && !name.is_empty() {
                    blocks.insert(name.to_string());
                }
                in_block_entry = false;
            }
            _ => {}
        }
    }
    let mut result: Vec<String> = blocks.into_iter().collect();
    result.sort();
    result
}

/// DXF header `$TDCREATE` (Julian gun.kesir) → ISO tarih. Yoksa/gecersizse `None`.
/// H2 DWG metadata'sinda bu alan YOKTU → H3 bunu ekleyerek bir adim one gecer.
pub(super) fn extract_dxf_creation_date(pairs: &[(i32, String)]) -> Option<String> {
    let mut want_value = false;
    for (code, value) in pairs {
        match *code {
            9 => want_value = value == "$TDCREATE",
            40 if want_value => {
                let jd: f64 = value.parse().ok()?;
                if jd <= 0.0 {
                    return None;
                }
                let jd_day = jd.trunc() as u32;
                let ms = (jd.fract() * 86_400_000.0).round() as u32;
                return crate::dwg::fields::dwg_julian_to_iso(jd_day, ms);
            }
            _ => {}
        }
    }
    None
}

fn strip_mtext_codes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.peek() {
                Some('P' | 'p' | 'n' | 'N' | '~') => {
                    chars.next();
                    out.push(' ');
                }
                Some('{' | '}') => {
                    chars.next();
                }
                Some('f' | 'F' | 'H' | 'Q' | 'W' | 'A' | 'C' | 'T') => {
                    chars.next();
                    for ch in chars.by_ref() {
                        if ch == ';' {
                            break;
                        }
                    }
                }
                _ => out.push(c),
            }
        } else if c == '{' || c == '}' {
            // grouping braces atilir
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

pub(super) fn extract_dxf_texts(pairs: &[(i32, String)]) -> Vec<String> {
    let mut texts = HashSet::new();
    let mut in_section = false;
    let mut in_text_entity = false;
    const TEXT_ENTITIES: &[&str] = &[
        "TEXT", "MTEXT", "ATTRIB", "ATTDEF", "LEADER", "MULTILEADER", "MLEADER", "DIMENSION",
        "TABLE",
    ];
    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "ENTITIES" | "BLOCKS") => in_section = true,
            (0, "ENDSEC") if in_section => {
                in_section = false;
                in_text_entity = false;
            }
            (0, entity_type) if in_section => {
                in_text_entity = TEXT_ENTITIES.contains(&entity_type);
            }
            (1 | 3 | 304, text) if in_text_entity => {
                let t = text.trim();
                if !t.is_empty() && (2..=512).contains(&t.len()) {
                    let cleaned = strip_mtext_codes(t);
                    if cleaned.len() >= 2 {
                        texts.insert(cleaned);
                    }
                }
            }
            _ => {}
        }
    }
    let mut result: Vec<String> = texts.into_iter().collect();
    result.sort();
    result.truncate(300);
    result
}

pub(super) fn extract_dxf_xrefs(pairs: &[(i32, String)]) -> Vec<String> {
    let mut xrefs = HashSet::new();
    let exts = [".dwg", ".DWG", ".dxf", ".DXF"];
    for (code, value) in pairs {
        if *code == 1 && exts.iter().any(|e| value.ends_with(e) && value.len() > e.len()) {
            xrefs.insert(value.clone());
        }
    }
    let mut result: Vec<String> = xrefs.into_iter().collect();
    result.sort();
    result
}

pub(super) fn extract_dxf_image_refs(pairs: &[(i32, String)]) -> Vec<String> {
    let mut refs = HashSet::new();
    let exts = [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".gif", ".pcx", ".ecw"];

    let mut in_objects = false;
    let mut in_imagedef = false;
    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "OBJECTS") => in_objects = true,
            (0, "ENDSEC") if in_objects => {
                in_objects = false;
                in_imagedef = false;
            }
            (0, "IMAGEDEF") if in_objects => in_imagedef = true,
            (0, _) if in_objects => in_imagedef = false,
            (1, path) if in_imagedef => {
                if !path.is_empty() {
                    refs.insert(path.to_string());
                }
                in_imagedef = false;
            }
            _ => {}
        }
    }
    for (code, value) in pairs {
        if *code == 1 {
            let lower = value.to_lowercase();
            if exts.iter().any(|e| lower.ends_with(e) && value.len() > e.len()) {
                refs.insert(value.clone());
            }
        }
    }
    let mut result: Vec<String> = refs.into_iter().collect();
    result.sort();
    result.truncate(100);
    result
}

fn identify_cfbf_blob(bytes: &[u8]) -> Option<String> {
    const MAGIC: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    let pos = bytes.windows(8).position(|w| w == MAGIC)?;
    let clsid = read_cfbf_root_clsid(bytes, pos)?;
    for (known_bytes, _, label) in known_clsids() {
        if known_bytes == &clsid {
            return Some((*label).to_string());
        }
    }
    Some(format!("Bilinmeyen CLSID: {{{}}}", clsid_to_guid_string(&clsid)))
}

pub(super) fn extract_dxf_ole_objects(pairs: &[(i32, String)]) -> Vec<String> {
    struct OleEntity {
        class_name: Option<String>,
        hex_data: String,
    }
    let mut entities: Vec<OleEntity> = Vec::new();
    let mut current: Option<OleEntity> = None;
    for (code, value) in pairs {
        if *code == 0 {
            if let Some(e) = current.take() {
                entities.push(e);
            }
            if value == "OLE2FRAME" || value == "OLEFRAME" {
                current = Some(OleEntity { class_name: None, hex_data: String::new() });
            }
        } else if let Some(e) = current.as_mut() {
            match *code {
                3 => {
                    if e.class_name.is_none() {
                        e.class_name = Some(value.trim().to_string());
                    }
                }
                310 => e.hex_data.push_str(value),
                _ => {}
            }
        }
    }
    if let Some(e) = current.take() {
        entities.push(e);
    }

    let mut type_counts: HashMap<String, usize> = HashMap::new();
    for entity in &entities {
        let mut label: Option<String> = None;
        if let Some(cn) = &entity.class_name {
            if let Some((_, lbl)) = detect_ole_progid(cn) {
                label = Some(lbl);
            }
        }
        if label.is_none() && !entity.hex_data.is_empty() {
            let bytes = hex_decode(&entity.hex_data);
            if !bytes.is_empty() {
                label = identify_cfbf_blob(&bytes);
            }
        }
        if label.is_none() {
            if let Some(cn) = &entity.class_name {
                if is_progid_shape(cn) {
                    label = Some(format!("Bilinmeyen: {cn}"));
                }
            }
        }
        *type_counts.entry(label.unwrap_or_else(|| "Tanimlanamayan OLE objesi".to_string())).or_insert(0) += 1;
    }

    let mut entries: Vec<String> = type_counts
        .iter()
        .map(|(label, count)| if *count > 1 { format!("{label} × {count}") } else { label.clone() })
        .collect();
    entries.sort();
    entries.truncate(50);
    entries
}

pub(super) fn extract_dxf_properties(pairs: &[(i32, String)]) -> DrawingProperties {
    let mut props = DrawingProperties::default();
    let mut in_header = false;
    let mut last_var: Option<String> = None;
    let mut comments: Vec<String> = Vec::new();

    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "HEADER") => in_header = true,
            (0, "ENDSEC") if in_header => {
                in_header = false;
                last_var = None;
            }
            (9, var) if in_header => last_var = Some(var.to_string()),
            (1 | 2, v) if in_header => {
                if let Some(var) = &last_var {
                    let valid = *code == 1
                        || (v != "HEADER" && v != "ENTITIES" && v != "BLOCKS");
                    if valid {
                        match var.as_str() {
                            "$TITLE" if props.title.is_none() && !v.is_empty() => {
                                props.title = Some(v.to_string());
                            }
                            "$AUTHOR" if props.author.is_none() && !v.is_empty() => {
                                props.author = Some(v.to_string());
                            }
                            "$SUBJECT" if props.subject.is_none() && !v.is_empty() => {
                                props.subject = Some(v.to_string());
                            }
                            "$KEYWORDS" if props.keywords.is_none() && !v.is_empty() => {
                                props.keywords = Some(v.to_string());
                            }
                            _ => {}
                        }
                    }
                }
            }
            (999, comment) => {
                if !comment.is_empty() && comment.len() <= 200 {
                    comments.push(comment.to_string());
                }
            }
            _ => {}
        }
    }
    if !comments.is_empty() {
        props.comments = Some(comments.join(" | ").chars().take(500).collect());
    }
    props
}

pub(super) fn extract_dxf_units(pairs: &[(i32, String)]) -> (Option<String>, Option<String>) {
    let mut unit_type = None;
    let mut scale = None;
    let mut in_header = false;
    let mut last_var: Option<String> = None;

    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "HEADER") => in_header = true,
            (0, "ENDSEC") if in_header => in_header = false,
            (9, var) if in_header => last_var = Some(var.to_string()),
            (70, v) if in_header => {
                if last_var.as_deref() == Some("$INSUNITS") {
                    unit_type = match v.trim() {
                        "1" => Some("İnç".to_string()),
                        "2" => Some("Ayak".to_string()),
                        "4" => Some("Milimetre".to_string()),
                        "5" | "14" => Some("Santimetre".to_string()),
                        "6" => Some("Metre".to_string()),
                        "15" => Some("Desimetre".to_string()),
                        _ => None,
                    };
                }
            }
            // $CANNOSCALE is the active annotation scale stored in the DXF header.
            // Text entities and the AcDbScale table contain every scale available to
            // the drawing, not the scale it uses, so they must not become metadata.
            (300, v) if in_header && last_var.as_deref() == Some("$CANNOSCALE") => {
                scale = canonical_annotation_scale(v);
            }
            _ => {}
        }
    }
    (unit_type, scale)
}

/// $CANNOSCALE names are user-editable. Accept only a finite numeric ratio
/// and return one canonical representation so facet values do not split
/// between 1/50 and 1:50.
fn canonical_annotation_scale(value: &str) -> Option<String> {
    let value = value.trim();
    let separator = value.find([':', '/'])?;
    let numerator = value[..separator].trim().parse::<u32>().ok()?;
    let denominator = value[separator + 1..].trim().parse::<u32>().ok()?;
    if numerator == 0 || denominator == 0 {
        return None;
    }
    Some(format!("{numerator}:{denominator}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(s: &str) -> Vec<(i32, String)> {
        read_dxf_pairs(s.as_bytes()).unwrap()
    }

    #[test]
    fn layers_basic() {
        let p = pairs("0\nSECTION\n2\nTABLES\n0\nLAYER\n2\nWALLS\n0\nLAYER\n2\nDOORS\n0\nENDSEC\n");
        let layers = extract_dxf_layers(&p);
        assert!(layers.contains(&"WALLS".to_string()));
        assert!(layers.contains(&"DOORS".to_string()));
    }

    #[test]
    fn blocks_skip_internal() {
        let p = pairs("0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\n*Model_Space\n0\nBLOCK\n2\nDOOR_01\n0\nENDSEC\n");
        let blocks = extract_dxf_blocks(&p);
        assert!(!blocks.iter().any(|b| b.contains("Model_Space")));
        assert!(blocks.contains(&"DOOR_01".to_string()));
    }

    #[test]
    fn texts_multileader_304() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nMULTILEADER\n300\nCONTEXT_DATA{\n304\n{\\fArial|b0|i0|c162;G\u{0130}RESUN}\n302\n}\n0\nENDSEC\n";
        let texts = extract_dxf_texts(&pairs(dxf));
        assert!(texts.iter().any(|s| s == "GİRESUN"), "{texts:?}");
    }

    #[test]
    fn xref_detection() {
        let p = vec![(1_i32, "C:\\Projects\\base.dwg".to_string()), (1, "notes.txt".to_string())];
        let xrefs = extract_dxf_xrefs(&p);
        assert!(xrefs.contains(&"C:\\Projects\\base.dwg".to_string()));
        assert!(!xrefs.iter().any(|x| x.contains("notes")));
    }

    #[test]
    fn binary_dxf_rejected() {
        assert!(read_dxf_pairs(b"AutoCAD Binary DXF\r\n").is_err());
    }

    #[test]
    fn units_and_active_annotation_scale_come_from_header() {
        let p = pairs(
            "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n9\n$CANNOSCALE\n300\n1/50\n0\nENDSEC\n",
        );
        assert_eq!(extract_dxf_units(&p), (Some("Milimetre".to_string()), Some("1:50".to_string())));
    }

    #[test]
    fn scale_list_and_unstructured_text_do_not_report_a_scale() {
        let p = pairs(
            "0\nSECTION\n2\nHEADER\n9\n$DIMSCALE\n40\n1.0\n0\nENDSEC\n0\nSECTION\n2\nTABLES\n0\nSCALE\n100\nAcDbScale\n300\n1:50\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n1\n1/100\n999\n1:25\n0\nENDSEC\n",
        );
        assert_eq!(extract_dxf_units(&p).1, None);
    }

    #[test]
    fn annotation_scale_requires_a_positive_numeric_ratio() {
        for invalid in ["1:0", "0:50", "1:50:2", "custom", "1:abc"] {
            assert_eq!(canonical_annotation_scale(invalid), None, "{invalid}");
        }
        assert_eq!(canonical_annotation_scale(" 2 : 1 ").as_deref(), Some("2:1"));
    }

    #[test]
    fn mtext_strip() {
        assert!(!strip_mtext_codes("\\PMutfak\\PBanyo").contains('\\'));
    }
}
