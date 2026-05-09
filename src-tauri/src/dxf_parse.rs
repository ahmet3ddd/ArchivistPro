use serde::Serialize;
use std::fs;
use crate::dwg_parse::{
    DwgExtractedMetadata, DwgDrawingProperties,
    detect_ole_progid, is_progid_shape,
    hex_decode, read_cfbf_root_clsid, known_clsids, clsid_to_guid_string,
};

/// Geometric shape extracted from DXF ENTITIES section.
/// Units are native DXF units (caller responsible for normalization).
#[derive(Debug, Clone, Serialize)]
pub struct DxfShape {
    pub entity_type: String,       // LINE | CIRCLE | ARC | LWPOLYLINE | POLYLINE
    pub layer_name: String,
    pub vertex_count: u32,
    pub is_closed: bool,
    pub area: f64,                 // 0 for open shapes
    pub perimeter: f64,
    pub aspect_ratio: f64,         // bbox_w / bbox_h (0 if bbox_h=0)
    pub regularity: f64,           // 0..1, 1 = regular N-gon (equal edges + equal angles)
    pub bbox_w: f64,
    pub bbox_h: f64,
    pub centroid_x: f64,
    pub centroid_y: f64,
    // Faz 4.4 — gelişmiş geometrik özellikler
    pub compactness: f64,          // 4π·area/perimeter² — circle=1, irregular<1 (0 for open)
    pub solidity: f64,             // area/convex_hull_area — convex=1, concave<1 (0 for open)
    pub rectangularity: f64,       // area/(bbox_w*bbox_h) — rectangle=1, sparse<1 (0 for open)
}

/// Reads a DXF file (ASCII or UTF-8) and returns group-code/value pairs.
/// Returns Err if the file appears to be binary DXF (R2010+ binary format).
fn read_dxf_pairs(path: &str) -> Result<Vec<(i32, String)>, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;

    // Binary DXF detection: starts with "AutoCAD Binary DXF\r\n\x1a\x00"
    if data.starts_with(b"AutoCAD Binary DXF") {
        log::warn!("Binary DXF formatı henüz desteklenmiyor (TODO): {}", path);
        return Err("Binary DXF format not yet supported".to_string());
    }

    // Try UTF-8 first, fall back to Latin-1
    let content = match std::str::from_utf8(&data) {
        Ok(s) => s.to_string(),
        Err(_) => {
            // Latin-1 / ISO-8859-1 fallback: every byte is a valid char
            data.iter().map(|&b| b as char).collect()
        }
    };

    let mut pairs = Vec::new();
    let mut lines = content.lines();

    while let Some(code_str) = lines.next() {
        let code_line = code_str.trim();
        if code_line.is_empty() {
            continue;
        }
        let code: i32 = match code_line.parse() {
            Ok(c) => c,
            Err(_) => continue,
        };

        // Value line
        let value_line = match lines.next() {
            Some(l) => l.trim().to_string(),
            None => break,
        };

        pairs.push((code, value_line));
    }

    Ok(pairs)
}

/// Extracts layer names from DXF group-code pairs.
/// TABLES section → LAYER entity → group code 2 (name).
fn extract_dxf_layers(pairs: &[(i32, String)]) -> Vec<String> {
    let mut layers = std::collections::HashSet::new();
    let mut in_tables = false;
    let mut in_layer_entry = false;

    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (0, "SECTION") => {}
            (2, "TABLES") => { in_tables = true; }
            (0, "ENDSEC") => { in_tables = false; in_layer_entry = false; }
            (0, "LAYER") if in_tables => { in_layer_entry = true; }
            (0, _) if in_tables => { in_layer_entry = false; }
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

/// Extracts block names from the BLOCKS section.
/// Skips *Model_Space, *Paper_Space and their variants.
fn extract_dxf_blocks(pairs: &[(i32, String)]) -> Vec<String> {
    let mut blocks = std::collections::HashSet::new();
    let mut in_blocks = false;
    let mut in_block_entry = false;

    let skip_patterns = ["*MODEL_SPACE", "*PAPER_SPACE", "*MODEL", "*PAPER"];

    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "BLOCKS") if !in_blocks => { in_blocks = true; }
            (0, "ENDSEC") if in_blocks => { in_blocks = false; in_block_entry = false; }
            (0, "BLOCK") if in_blocks => { in_block_entry = true; }
            (0, "ENDBLK") if in_blocks => { in_block_entry = false; }
            (0, v) if in_blocks && v != "BLOCK" && v != "ENDBLK" => {
                // Other entities inside a block — don't reset block_entry
            }
            (2, name) if in_block_entry && in_blocks => {
                let upper = name.to_uppercase();
                if !skip_patterns.iter().any(|p| upper.starts_with(p)) && !name.is_empty() {
                    blocks.insert(name.to_string());
                }
                in_block_entry = false; // name captured, reset
            }
            _ => {}
        }
    }

    let mut result: Vec<String> = blocks.into_iter().collect();
    result.sort();
    result
}

/// Extracts text contents from text-bearing entities in ENTITIES and BLOCKS sections.
/// Supported entity types: TEXT, MTEXT, ATTRIB, ATTDEF, LEADER, MULTILEADER (MLEADER),
/// DIMENSION, TABLE.
/// Group codes:
///   1, 3  — TEXT/MTEXT/ATTRIB/LEADER text value
///   304   — MULTILEADER MText label content (inside CONTEXT_DATA block)
fn extract_dxf_texts(pairs: &[(i32, String)]) -> Vec<String> {
    let mut texts = std::collections::HashSet::new();
    let mut in_section = false; // ENTITIES or BLOCKS section
    let mut in_text_entity = false;

    // Entity types that carry readable text in group code 1, 3, or 304
    const TEXT_ENTITIES: &[&str] = &[
        "TEXT", "MTEXT", "ATTRIB", "ATTDEF",
        "LEADER", "MULTILEADER", "MLEADER",
        "DIMENSION", "TABLE",
    ];

    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "ENTITIES") | (2, "BLOCKS") => { in_section = true; }
            (0, "ENDSEC") if in_section => { in_section = false; in_text_entity = false; }
            (0, entity_type) if in_section => {
                in_text_entity = TEXT_ENTITIES.contains(&entity_type);
            }
            // Group codes 1 and 3: TEXT, MTEXT, ATTRIB, LEADER text value
            // Group code 304: MULTILEADER MText label (CONTEXT_DATA block içindeki MText string)
            (1, text) | (3, text) | (304, text) if in_text_entity => {
                let t = text.trim();
                if !t.is_empty() && t.len() >= 2 && t.len() <= 512 {
                    // Strip MTEXT formatting codes like \P, \f{...}, etc.
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

/// Removes common MTEXT formatting escape sequences.
fn strip_mtext_codes(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.peek() {
                Some(&'P') | Some(&'p') | Some(&'n') | Some(&'N') => { chars.next(); out.push(' '); }
                Some(&'~') => { chars.next(); out.push(' '); }
                Some(&'{') | Some(&'}') => { chars.next(); }
                Some(&'f') | Some(&'F') | Some(&'H') | Some(&'Q') | Some(&'W') | Some(&'A') | Some(&'C') | Some(&'T') => {
                    // Skip up to ';'
                    chars.next();
                    for ch in chars.by_ref() { if ch == ';' { break; } }
                }
                _ => { out.push(c); }
            }
        } else if c == '{' || c == '}' {
            // MTEXT grouping braces
        } else {
            out.push(c);
        }
    }
    out.trim().to_string()
}

/// Extracts xref file references from group code 1 values that end with .dwg or .dxf.
fn extract_dxf_xrefs(pairs: &[(i32, String)]) -> Vec<String> {
    let mut xrefs = std::collections::HashSet::new();
    let extensions = [".dwg", ".DWG", ".dxf", ".DXF"];

    for (code, value) in pairs {
        if *code == 1 {
            for ext in &extensions {
                if value.ends_with(ext) && value.len() > ext.len() {
                    xrefs.insert(value.to_string()); // tam yolu sakla
                    break;
                }
            }
        }
    }

    let mut result: Vec<String> = xrefs.into_iter().collect();
    result.sort();
    result
}

/// Extracts image reference file names from DXF.
/// Path 1: OBJECTS section → IMAGEDEF entity → group code 1 = file path.
/// Path 2: Scan all group code 1 values for raster image extensions (catches ENTITIES refs too).
fn extract_dxf_image_refs(pairs: &[(i32, String)]) -> Vec<String> {
    let mut image_refs = std::collections::HashSet::new();

    let image_extensions = [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".gif", ".pcx", ".ecw"];

    // Path 1: OBJECTS section → IMAGEDEF entity
    let mut in_objects = false;
    let mut in_imagedef = false;
    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "OBJECTS") => { in_objects = true; }
            (0, "ENDSEC") if in_objects => { in_objects = false; in_imagedef = false; }
            (0, "IMAGEDEF") if in_objects => { in_imagedef = true; }
            (0, _) if in_objects => { in_imagedef = false; }
            (1, path) if in_imagedef => {
                if !path.is_empty() {
                    image_refs.insert(path.to_string()); // tam yolu sakla
                }
                in_imagedef = false;
            }
            _ => {}
        }
    }

    // Path 2: Scan all group code 1 values for image extensions (broader catch)
    for (code, value) in pairs {
        if *code == 1 {
            let lower = value.to_lowercase();
            for ext in &image_extensions {
                if lower.ends_with(ext) && value.len() > ext.len() {
                    image_refs.insert(value.to_string()); // tam yolu sakla
                    break;
                }
            }
        }
    }

    let mut result: Vec<String> = image_refs.into_iter().collect();
    result.sort();
    result.truncate(100);
    result
}

/// Bir CFBF byte blob'unu analiz edip etiketini döner. Root CLSID'yi okur, bilinen
/// listeyle eşleştirir; bulunmazsa ham GUID döner.
fn identify_cfbf_blob(bytes: &[u8]) -> Option<String> {
    let magic: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    let pos = bytes.windows(8).position(|w| w == magic)?;
    let clsid = read_cfbf_root_clsid(bytes, pos)?;
    for (known_bytes, _, label) in known_clsids() {
        if known_bytes == &clsid {
            return Some(label.to_string());
        }
    }
    Some(format!("Bilinmeyen CLSID: {{{}}}", clsid_to_guid_string(&clsid)))
}

/// DXF içinde gömülü OLE objelerini per-entity sayar.
/// Her OLE2FRAME entity ayrı analiz edilir (class_name + hex data); aynı türden
/// birden çok obje varsa "Label × N" formatında gösterilir.
fn extract_dxf_ole_objects(pairs: &[(i32, String)]) -> Vec<String> {
    use std::collections::HashMap;

    struct OleEntity {
        class_name: Option<String>,
        hex_data: String,
    }

    // 1) OLE2FRAME entity'lerini izole et
    let mut entities: Vec<OleEntity> = Vec::new();
    let mut current: Option<OleEntity> = None;
    for (code, value) in pairs {
        if *code == 0 {
            if let Some(e) = current.take() { entities.push(e); }
            if value == "OLE2FRAME" || value == "OLEFRAME" {
                current = Some(OleEntity { class_name: None, hex_data: String::new() });
            }
        } else if let Some(e) = current.as_mut() {
            match *code {
                3 => { if e.class_name.is_none() { e.class_name = Some(value.trim().to_string()); } }
                310 => { e.hex_data.push_str(value); }
                _ => {}
            }
        }
    }
    if let Some(e) = current.take() { entities.push(e); }

    // 2) Her entity'yi ayrı ayrı tanı, türe göre say
    let mut type_counts: HashMap<String, usize> = HashMap::new();
    for entity in &entities {
        let mut label: Option<String> = None;

        // a) class_name → bilinen ProgID
        if let Some(cn) = &entity.class_name {
            if let Some((_, lbl)) = detect_ole_progid(cn) {
                label = Some(lbl);
            }
        }

        // b) 310 hex → CFBF root CLSID
        if label.is_none() && !entity.hex_data.is_empty() {
            let bytes = hex_decode(&entity.hex_data);
            if !bytes.is_empty() {
                label = identify_cfbf_blob(&bytes);
            }
        }

        // c) class_name → ProgID-şekli (bilinmeyen)
        if label.is_none() {
            if let Some(cn) = &entity.class_name {
                if is_progid_shape(cn) {
                    label = Some(format!("Bilinmeyen: {}", cn));
                }
            }
        }

        let final_label = label.unwrap_or_else(|| "Tanımlanamayan OLE objesi".to_string());
        *type_counts.entry(final_label).or_insert(0) += 1;
    }

    // 3) "Label × N" formatında çıktı
    let mut entries: Vec<String> = type_counts.iter().map(|(label, count)| {
        if *count > 1 { format!("{} × {}", label, count) } else { label.clone() }
    }).collect();
    entries.sort();
    entries.truncate(50);
    entries
}

/// Extracts drawing properties from HEADER section ($TITLE/$AUTHOR/$SUBJECT/$KEYWORDS)
/// and group code 999 (comment lines).
fn extract_dxf_properties(pairs: &[(i32, String)]) -> DwgDrawingProperties {
    let mut props = DwgDrawingProperties::default();
    let mut in_header = false;
    let mut last_var: Option<String> = None;

    // group code 999 = comment — may contain title/project info
    let mut comments: Vec<String> = Vec::new();

    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "HEADER") => { in_header = true; }
            (0, "ENDSEC") if in_header => { in_header = false; last_var = None; }
            (9, var) if in_header => { last_var = Some(var.to_string()); }
            (1, v) if in_header => {
                if let Some(ref var) = last_var {
                    match var.as_str() {
                        "$TITLE"    => if props.title.is_none() && !v.is_empty() { props.title = Some(v.to_string()); }
                        "$AUTHOR"   => if props.author.is_none() && !v.is_empty() { props.author = Some(v.to_string()); }
                        "$SUBJECT"  => if props.subject.is_none() && !v.is_empty() { props.subject = Some(v.to_string()); }
                        "$KEYWORDS" => if props.keywords.is_none() && !v.is_empty() { props.keywords = Some(v.to_string()); }
                        _ => {}
                    }
                }
            }
            // Some editors store these in group code 2 under the var name
            (2, v) if in_header => {
                if let Some(ref var) = last_var {
                    match var.as_str() {
                        "$TITLE"    => if props.title.is_none() && !v.is_empty() && v != "HEADER" && v != "ENTITIES" && v != "BLOCKS" { props.title = Some(v.to_string()); }
                        "$AUTHOR"   => if props.author.is_none() && !v.is_empty() { props.author = Some(v.to_string()); }
                        "$SUBJECT"  => if props.subject.is_none() && !v.is_empty() { props.subject = Some(v.to_string()); }
                        "$KEYWORDS" => if props.keywords.is_none() && !v.is_empty() { props.keywords = Some(v.to_string()); }
                        _ => {}
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

    // Use first comment as fallback for comments field
    if !comments.is_empty() {
        let joined = comments.join(" | ");
        props.comments = Some(joined.chars().take(500).collect());
    }

    props
}

/// Attempts to detect scale and unit info from HEADER variables.
fn extract_dxf_units(pairs: &[(i32, String)]) -> (Option<String>, Option<String>) {
    let mut unit_type: Option<String> = None;
    let mut scale: Option<String> = None;
    let mut in_header = false;
    let mut last_var: Option<String> = None;

    for (code, value) in pairs {
        match (*code, value.as_str()) {
            (2, "HEADER") => { in_header = true; }
            (0, "ENDSEC") if in_header => { in_header = false; }
            (9, var) if in_header => { last_var = Some(var.to_string()); }
            (70, v) if in_header => {
                if let Some(ref var) = last_var {
                    if var == "$INSUNITS" {
                        // AutoCAD INSUNITS: 1=in, 2=ft, 4=mm, 5=cm, 6=m, 14=cm, 15=dm
                        unit_type = match v.trim() {
                            "1"  => Some("İnç".to_string()),
                            "2"  => Some("Ayak".to_string()),
                            "4"  => Some("Milimetre".to_string()),
                            "5"  => Some("Santimetre".to_string()),
                            "6"  => Some("Metre".to_string()),
                            "14" => Some("Santimetre".to_string()),
                            "15" => Some("Desimetre".to_string()),
                            _    => None,
                        };
                    }
                }
            }
            _ => {}
        }
    }

    // Scan group code 1 text values for scale patterns like "1/100", "1:50"
    for (code, value) in pairs {
        if *code == 1 || *code == 999 {
            let v = value.trim();
            if (v.starts_with("1/") || v.starts_with("1:")) && v.len() <= 8 {
                let rest = &v[2..];
                if rest.chars().all(|c| c.is_ascii_digit()) && !rest.is_empty() {
                    scale = Some(v.to_string());
                    break;
                }
            }
        }
    }

    (unit_type, scale)
}

// ────────────────────────────────────────────────────────────────────────────
// Shape (geometry) extraction — Faz 4.1
// ────────────────────────────────────────────────────────────────────────────

/// Shoelace formula; returns absolute polygon area. verts assumed closed (last != first).
fn compute_polygon_area(verts: &[(f64, f64)]) -> f64 {
    let n = verts.len();
    if n < 3 { return 0.0; }
    let mut sum = 0.0;
    for i in 0..n {
        let (x1, y1) = verts[i];
        let (x2, y2) = verts[(i + 1) % n];
        sum += x1 * y2 - x2 * y1;
    }
    (sum / 2.0).abs()
}

fn compute_polygon_perimeter(verts: &[(f64, f64)], closed: bool) -> f64 {
    let n = verts.len();
    if n < 2 { return 0.0; }
    let limit = if closed { n } else { n - 1 };
    let mut sum = 0.0;
    for i in 0..limit {
        let (x1, y1) = verts[i];
        let (x2, y2) = verts[(i + 1) % n];
        sum += ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
    }
    sum
}

fn compute_polygon_bbox(verts: &[(f64, f64)]) -> (f64, f64) {
    if verts.is_empty() { return (0.0, 0.0); }
    let min_x = verts.iter().map(|v| v.0).fold(f64::INFINITY, f64::min);
    let max_x = verts.iter().map(|v| v.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = verts.iter().map(|v| v.1).fold(f64::INFINITY, f64::min);
    let max_y = verts.iter().map(|v| v.1).fold(f64::NEG_INFINITY, f64::max);
    (max_x - min_x, max_y - min_y)
}

fn compute_polygon_centroid(verts: &[(f64, f64)]) -> (f64, f64) {
    let n = verts.len() as f64;
    if n < 1.0 { return (0.0, 0.0); }
    let sx: f64 = verts.iter().map(|v| v.0).sum();
    let sy: f64 = verts.iter().map(|v| v.1).sum();
    (sx / n, sy / n)
}

/// Regularity score 0..1. 1 = regular N-gon (all edges equal AND all interior angles equal).
/// Uses coefficient of variation of edge lengths + interior angles; low variation → high score.
fn compute_regularity(verts: &[(f64, f64)]) -> f64 {
    let n = verts.len();
    if n < 3 { return 0.0; }

    // Edge length coefficient of variation
    let mut edges = Vec::with_capacity(n);
    for i in 0..n {
        let a = verts[i];
        let b = verts[(i + 1) % n];
        edges.push(((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt());
    }
    let edge_mean = edges.iter().sum::<f64>() / n as f64;
    if edge_mean < 1e-9 { return 0.0; }
    let edge_var = edges.iter().map(|e| (e - edge_mean).powi(2)).sum::<f64>() / n as f64;
    let edge_cv = edge_var.sqrt() / edge_mean;

    // Interior angle coefficient of variation
    let mut angles = Vec::with_capacity(n);
    for i in 0..n {
        let prev = verts[(i + n - 1) % n];
        let curr = verts[i];
        let next = verts[(i + 1) % n];
        let v1 = (prev.0 - curr.0, prev.1 - curr.1);
        let v2 = (next.0 - curr.0, next.1 - curr.1);
        let dot = v1.0 * v2.0 + v1.1 * v2.1;
        let cross = v1.0 * v2.1 - v1.1 * v2.0;
        let a = cross.atan2(dot).abs();
        angles.push(a);
    }
    let angle_mean = angles.iter().sum::<f64>() / n as f64;
    if angle_mean < 1e-9 { return 0.0; }
    let angle_var = angles.iter().map(|a| (a - angle_mean).powi(2)).sum::<f64>() / n as f64;
    let angle_cv = angle_var.sqrt() / angle_mean;

    // Both CVs near 0 → regular. Exponential decay: CV=0 → 1, CV=0.5 → ~0.37
    let score = (-2.0 * (edge_cv + angle_cv)).exp();
    score.clamp(0.0, 1.0)
}

// ─── Faz 4.4 — Convex Hull (Andrew's monotone chain) ────────────────────────

/// Convex hull via Andrew's monotone chain — O(n log n).
/// Returns vertices in counter-clockwise order.
pub fn convex_hull(points: &[(f64, f64)]) -> Vec<(f64, f64)> {
    let mut pts = points.to_vec();
    pts.sort_by(|a, b|
        a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal)
            .then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
    );
    pts.dedup_by(|a, b| (a.0 - b.0).abs() < 1e-12 && (a.1 - b.1).abs() < 1e-12);

    let n = pts.len();
    if n <= 2 { return pts; }

    let cross = |o: &(f64, f64), a: &(f64, f64), b: &(f64, f64)| -> f64 {
        (a.0 - o.0) * (b.1 - o.1) - (a.1 - o.1) * (b.0 - o.0)
    };

    let mut hull: Vec<(f64, f64)> = Vec::with_capacity(2 * n);

    // Lower hull
    for p in &pts {
        while hull.len() >= 2 && cross(&hull[hull.len() - 2], &hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(*p);
    }

    // Upper hull
    let lower_len = hull.len() + 1;
    for p in pts.iter().rev() {
        while hull.len() >= lower_len && cross(&hull[hull.len() - 2], &hull[hull.len() - 1], p) <= 0.0 {
            hull.pop();
        }
        hull.push(*p);
    }

    hull.pop(); // Remove duplicate of first point
    hull
}

// ─── Faz 4.4 — Gelişmiş geometrik özellik hesaplamaları ────────────────────

/// Compactness (isoperimetric quotient): 4π·area/perimeter².
/// Circle = 1.0, irregular shapes < 1. Returns 0 for open shapes.
fn compute_compactness(area: f64, perimeter: f64) -> f64 {
    if perimeter < 1e-9 || area < 1e-9 { return 0.0; }
    let c = 4.0 * std::f64::consts::PI * area / (perimeter * perimeter);
    c.clamp(0.0, 1.0)
}

/// Solidity: area / convex_hull_area.
/// Convex shape = 1.0, concave shapes < 1. Returns 0 for open/degenerate shapes.
fn compute_solidity(verts: &[(f64, f64)], area: f64) -> f64 {
    if area < 1e-9 || verts.len() < 3 { return 0.0; }
    let hull = convex_hull(verts);
    if hull.len() < 3 { return 0.0; }
    let hull_area = compute_polygon_area(&hull);
    if hull_area < 1e-9 { return 0.0; }
    (area / hull_area).clamp(0.0, 1.0)
}

/// Rectangularity: area / (bbox_w × bbox_h).
/// Perfect rectangle = 1.0, sparse fills < 1. Returns 0 for open/degenerate shapes.
fn compute_rectangularity(area: f64, bbox_w: f64, bbox_h: f64) -> f64 {
    let bbox_area = bbox_w * bbox_h;
    if bbox_area < 1e-9 || area < 1e-9 { return 0.0; }
    (area / bbox_area).clamp(0.0, 1.0)
}

fn build_polygon_shape(entity_type: &str, layer: String, verts: &[(f64, f64)], is_closed: bool) -> DxfShape {
    let area = if is_closed { compute_polygon_area(verts) } else { 0.0 };
    let perimeter = compute_polygon_perimeter(verts, is_closed);
    let (bbox_w, bbox_h) = compute_polygon_bbox(verts);
    let aspect_ratio = if bbox_h > 1e-9 { bbox_w / bbox_h } else { 0.0 };
    let regularity = if is_closed { compute_regularity(verts) } else { 0.0 };
    let (cx, cy) = compute_polygon_centroid(verts);
    let compactness = if is_closed { compute_compactness(area, perimeter) } else { 0.0 };
    let solidity = if is_closed { compute_solidity(verts, area) } else { 0.0 };
    let rectangularity = if is_closed { compute_rectangularity(area, bbox_w, bbox_h) } else { 0.0 };
    DxfShape {
        entity_type: entity_type.to_string(),
        layer_name: layer,
        vertex_count: verts.len() as u32,
        is_closed,
        area, perimeter, aspect_ratio, regularity,
        bbox_w, bbox_h,
        centroid_x: cx, centroid_y: cy,
        compactness, solidity, rectangularity,
    }
}

fn parse_f64(s: &str) -> Option<f64> { s.trim().parse().ok() }
fn parse_i32(s: &str) -> Option<i32> { s.trim().parse().ok() }

/// Parses LINE entity. Returns (shape, consumed_pairs).
/// Starts at pairs[0] = (0, "LINE").
fn parse_line_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let mut x1 = None; let mut y1 = None;
    let mut x2 = None; let mut y2 = None;
    let mut idx = 1;
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 { break; }
        match *code {
            8 => layer = value.clone(),
            10 => x1 = parse_f64(value),
            20 => y1 = parse_f64(value),
            11 => x2 = parse_f64(value),
            21 => y2 = parse_f64(value),
            _ => {}
        }
        idx += 1;
    }
    let (x1, y1, x2, y2) = (x1?, y1?, x2?, y2?);
    let length = ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
    let bbox_w = (x2 - x1).abs();
    let bbox_h = (y2 - y1).abs();
    Some((DxfShape {
        entity_type: "LINE".to_string(),
        layer_name: layer,
        vertex_count: 2,
        is_closed: false,
        area: 0.0,
        perimeter: length,
        aspect_ratio: if bbox_h > 1e-9 { bbox_w / bbox_h } else { 0.0 },
        regularity: 0.0,
        bbox_w, bbox_h,
        centroid_x: (x1 + x2) / 2.0,
        centroid_y: (y1 + y2) / 2.0,
        compactness: 0.0, solidity: 0.0, rectangularity: 0.0,
    }, idx))
}

/// Parses CIRCLE entity. Treated as is_closed=true regular shape (regularity=1).
fn parse_circle_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let mut cx = None; let mut cy = None; let mut r = None;
    let mut idx = 1;
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 { break; }
        match *code {
            8 => layer = value.clone(),
            10 => cx = parse_f64(value),
            20 => cy = parse_f64(value),
            40 => r = parse_f64(value),
            _ => {}
        }
        idx += 1;
    }
    let (cx, cy, r) = (cx?, cy?, r?);
    if r <= 0.0 { return None; }
    let area = std::f64::consts::PI * r * r;
    let perim = 2.0 * std::f64::consts::PI * r;
    Some((DxfShape {
        entity_type: "CIRCLE".to_string(),
        layer_name: layer,
        vertex_count: 1,
        is_closed: true,
        area,
        perimeter: perim,
        aspect_ratio: 1.0,
        regularity: 1.0,
        bbox_w: 2.0 * r,
        bbox_h: 2.0 * r,
        centroid_x: cx,
        centroid_y: cy,
        compactness: 1.0,                                       // circle is perfectly compact
        solidity: 1.0,                                          // circle is perfectly convex
        rectangularity: std::f64::consts::FRAC_PI_4,            // π/4 ≈ 0.785
    }, idx))
}

/// Parses ARC entity. Area=0 (open), perimeter = arc length.
fn parse_arc_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let mut cx = None; let mut cy = None; let mut r = None;
    let mut start_deg: Option<f64> = None;
    let mut end_deg: Option<f64> = None;
    let mut idx = 1;
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 { break; }
        match *code {
            8  => layer = value.clone(),
            10 => cx = parse_f64(value),
            20 => cy = parse_f64(value),
            40 => r = parse_f64(value),
            50 => start_deg = parse_f64(value),
            51 => end_deg = parse_f64(value),
            _ => {}
        }
        idx += 1;
    }
    let (cx, cy, r, s, e) = (cx?, cy?, r?, start_deg?, end_deg?);
    if r <= 0.0 { return None; }
    let sweep_deg = {
        let mut d = e - s;
        while d < 0.0 { d += 360.0; }
        while d > 360.0 { d -= 360.0; }
        d
    };
    let arc_len = r * sweep_deg.to_radians();
    Some((DxfShape {
        entity_type: "ARC".to_string(),
        layer_name: layer,
        vertex_count: 1,
        is_closed: false,
        area: 0.0,
        perimeter: arc_len,
        aspect_ratio: 1.0,
        regularity: 0.0,
        bbox_w: 2.0 * r,
        bbox_h: 2.0 * r,
        centroid_x: cx,
        centroid_y: cy,
        compactness: 0.0, solidity: 0.0, rectangularity: 0.0,
    }, idx))
}

/// Parses LWPOLYLINE entity. Vertices are inlined as repeated 10/20 pairs until next code=0.
fn parse_lwpolyline_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let mut flags: i32 = 0;
    let mut verts: Vec<(f64, f64)> = Vec::new();
    let mut pending_x: Option<f64> = None;
    let mut idx = 1;
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 { break; }
        match *code {
            8 => layer = value.clone(),
            70 => flags = parse_i32(value).unwrap_or(0),
            10 => {
                if let Some(x) = pending_x.take() {
                    verts.push((x, 0.0));
                }
                pending_x = parse_f64(value);
            }
            20 => {
                if let (Some(x), Some(y)) = (pending_x.take(), parse_f64(value)) {
                    verts.push((x, y));
                }
            }
            _ => {}
        }
        idx += 1;
    }
    if verts.is_empty() { return None; }
    let is_closed = (flags & 1) == 1;
    Some((build_polygon_shape("LWPOLYLINE", layer, &verts, is_closed), idx))
}

/// Parses classic POLYLINE: header → VERTEX entities → SEQEND terminator.
fn parse_polyline_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let mut flags: i32 = 0;
    let mut verts: Vec<(f64, f64)> = Vec::new();
    let mut idx = 1;

    // Header phase: until first 0= (VERTEX/SEQEND/other)
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 {
            if value == "VERTEX" || value == "SEQEND" { break; }
            // unexpected next entity — terminate without consuming it
            return if verts.is_empty() { None } else {
                let is_closed = (flags & 1) == 1;
                Some((build_polygon_shape("POLYLINE", layer, &verts, is_closed), idx))
            };
        }
        match *code {
            8 => layer = value.clone(),
            70 => flags = parse_i32(value).unwrap_or(0),
            _ => {}
        }
        idx += 1;
    }

    // VERTEX phase
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 {
            if value == "VERTEX" {
                let mut vx: Option<f64> = None;
                let mut vy: Option<f64> = None;
                idx += 1;
                while idx < pairs.len() {
                    let (c2, v2) = &pairs[idx];
                    if *c2 == 0 { break; }
                    match *c2 {
                        10 => vx = parse_f64(v2),
                        20 => vy = parse_f64(v2),
                        _ => {}
                    }
                    idx += 1;
                }
                if let (Some(x), Some(y)) = (vx, vy) { verts.push((x, y)); }
            } else if value == "SEQEND" {
                idx += 1;
                while idx < pairs.len() && pairs[idx].0 != 0 { idx += 1; }
                break;
            } else {
                // unexpected next entity, stop without consuming it
                break;
            }
        } else {
            idx += 1;
        }
    }

    if verts.is_empty() { return None; }
    let is_closed = (flags & 1) == 1;
    Some((build_polygon_shape("POLYLINE", layer, &verts, is_closed), idx))
}

/// Walks ENTITIES section and extracts all geometric shapes.
/// Skips TEXT/MTEXT/INSERT/HATCH/DIMENSION/etc — only LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE.
fn parse_dxf_shapes(pairs: &[(i32, String)]) -> Vec<DxfShape> {
    let mut shapes = Vec::new();
    let mut in_entities = false;
    let mut i = 0;
    while i < pairs.len() {
        let (code, value) = &pairs[i];

        if *code == 2 && value == "ENTITIES" { in_entities = true; i += 1; continue; }
        if *code == 0 && value == "ENDSEC" && in_entities { in_entities = false; i += 1; continue; }
        if !in_entities { i += 1; continue; }

        if *code == 0 {
            let result = match value.as_str() {
                "LINE"       => parse_line_entity(&pairs[i..]),
                "CIRCLE"     => parse_circle_entity(&pairs[i..]),
                "ARC"        => parse_arc_entity(&pairs[i..]),
                "LWPOLYLINE" => parse_lwpolyline_entity(&pairs[i..]),
                "POLYLINE"   => parse_polyline_entity(&pairs[i..]),
                _ => None,
            };
            if let Some((shape, consumed)) = result {
                shapes.push(shape);
                i += consumed;
                continue;
            }
        }
        i += 1;
    }
    shapes
}

/// Arama-değerli şekilleri tut — Faz 4.4 güncelleme:
///   - Kapalı: vertex_count >= 3 (üçgen ve üstü) + CIRCLE (vertex_count=1)
///   - Açık: LWPOLYLINE/POLYLINE vertex_count >= 3 (anlamlı çok-segmentli yollar)
///   - Açık: ARC (eğri elemanlar — mimari detay)
///   - Hariç: Tek LINE entity'leri (çok fazla, ayırt edici değil)
///
/// Tipik mimari DXF'de 30K+ ham şekil → ~800-1500 aranabilir şekil.
fn filter_searchable_shapes(shapes: Vec<DxfShape>) -> Vec<DxfShape> {
    shapes.into_iter()
        .filter(|s| {
            if s.is_closed {
                // Kapalı: üçgen+, daire, kapalı polyline
                s.vertex_count >= 3 || s.entity_type == "CIRCLE"
            } else {
                // Açık: çok-segmentli polyline (≥3 vertex) veya yay
                match s.entity_type.as_str() {
                    "LWPOLYLINE" | "POLYLINE" => s.vertex_count >= 3,
                    "ARC" => true,
                    _ => false, // LINE hariç
                }
            }
        })
        .collect()
}

/// Tauri command: parse DXF and return geometric shapes for shape-index building.
#[tauri::command]
pub fn extract_dxf_shapes(path: String) -> Result<Vec<DxfShape>, String> {
    log::info!("DXF shape extraction başladı: {}", path);
    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if file_size > 200 * 1024 * 1024 {
        log::info!("DXF çok büyük (>200MB), shape extraction atlandı: {}", path);
        return Ok(vec![]);
    }
    let pairs = read_dxf_pairs(&path)?;
    let raw = parse_dxf_shapes(&pairs);
    let raw_count = raw.len();
    let shapes = filter_searchable_shapes(raw);
    log::info!("DXF shapes extracted: {} searchable / {} raw - {}", shapes.len(), raw_count, path);
    Ok(shapes)
}

/// Tauri command: DWG → (cached) DXF → shapes. ODA kurulu değilse Err döner.
/// Faz 4.2 — DWG için ODA wiring.
#[tauri::command]
pub fn extract_dwg_shapes(path: String, app_handle: tauri::AppHandle) -> Result<Vec<DxfShape>, String> {
    use tauri::Manager;
    log::info!("DWG shape extraction başladı: {}", path);

    let app_data = app_handle.path().app_data_dir()
        .map_err(|e| format!("app_data_dir alınamadı: {}", e))?;

    let dxf_path = crate::oda_converter::convert_dwg_to_dxf_cached(&path, &app_data)?;
    let dxf_str = dxf_path.to_string_lossy().to_string();

    let pairs = read_dxf_pairs(&dxf_str)?;
    let raw = parse_dxf_shapes(&pairs);
    let raw_count = raw.len();
    let shapes = filter_searchable_shapes(raw);
    log::info!("DWG shapes extracted: {} searchable / {} raw - {}", shapes.len(), raw_count, path);
    Ok(shapes)
}

/// Main entry point: parse a DXF file and return extracted metadata.
#[tauri::command]
pub fn extract_dxf_metadata(path: String) -> Result<DwgExtractedMetadata, String> {
    log::info!("DXF metadata extraction başladı: {}", path);

    // Size check
    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if file_size > 200 * 1024 * 1024 {
        log::info!("DXF çok büyük (>200MB), metadata atlandı: {}", path);
        return Ok(DwgExtractedMetadata {
            version: None,
            layers: vec![],
            block_names: vec![],
            text_contents: vec![],
            xref_names: vec![],
            image_refs: vec![],
            ole_objects: vec![],
            drawing_properties: DwgDrawingProperties::default(),
            estimated_scale: None,
            unit_type: None,
        });
    }

    let pairs = read_dxf_pairs(&path)?;

    let layers           = extract_dxf_layers(&pairs);
    let block_names      = extract_dxf_blocks(&pairs);
    let text_contents    = extract_dxf_texts(&pairs);
    let xref_names       = extract_dxf_xrefs(&pairs);
    let image_refs       = extract_dxf_image_refs(&pairs);
    let ole_objects      = extract_dxf_ole_objects(&pairs);
    let drawing_properties = extract_dxf_properties(&pairs);
    let (unit_type, estimated_scale) = extract_dxf_units(&pairs);

    // DXF has its own $ACADVER variable — extract it if present
    let version = pairs.iter()
        .zip(pairs.iter().skip(1))
        .find(|((g, v), _)| *g == 9 && v == "$ACADVER")
        .and_then(|(_, (_, ver))| {
            use crate::dwg_parse::get_dwg_version;
            // $ACADVER stores codes like "AC1015", pad to 6 chars
            let padded = format!("{:<6}", ver);
            get_dwg_version(padded.as_bytes())
        });

    log::info!(
        "DXF metadata extracted: {:?} version, {} layers, {} blocks, {} texts, {} xrefs, {} imgs, {} ole - {}",
        version, layers.len(), block_names.len(), text_contents.len(), xref_names.len(), image_refs.len(), ole_objects.len(), path
    );

    Ok(DwgExtractedMetadata {
        version,
        layers,
        block_names,
        text_contents,
        xref_names,
        image_refs,
        ole_objects,
        drawing_properties,
        estimated_scale,
        unit_type,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs_from_str(s: &str) -> Vec<(i32, String)> {
        let mut pairs = Vec::new();
        let mut lines = s.lines();
        loop {
            let code_line = match lines.next() { Some(l) => l.trim(), None => break };
            if code_line.is_empty() { continue; }
            let code: i32 = match code_line.parse() { Ok(c) => c, Err(_) => continue };
            let value = match lines.next() { Some(l) => l.trim().to_string(), None => break };
            pairs.push((code, value));
        }
        pairs
    }

    #[test]
    fn test_extract_dxf_texts_multileader_group_304() {
        // MULTILEADER entity'lerinde metin grup kodu 304'te saklanır (CONTEXT_DATA bloğu).
        // Grup kodu 1 veya 3 yoktur — 304 yakalanmazsa GİRESUN gibi metinler kaybolur.
        let dxf = "0\nSECTION\n2\nENTITIES\n\
                   0\nMULTILEADER\n\
                   300\nCONTEXT_DATA{\n\
                   304\n{\\fArial|b0|i0|c162;G\u{0130}RESUN}\n\
                   302\n}\n\
                   0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let texts = extract_dxf_texts(&pairs);
        assert!(texts.iter().any(|s| s == "GİRESUN"),
            "MULTILEADER grup kodu 304 metni çıkarılmalı, got: {:?}", texts);
    }

    #[test]
    fn test_extract_dxf_texts_mtext_group_1() {
        // MTEXT entity'si grup kodu 1 kullanır — mevcut davranış korunmalı.
        let dxf = "0\nSECTION\n2\nENTITIES\n\
                   0\nMTEXT\n\
                   1\n{\\fISOCPEUR|b0|i0|c162;Ç\u{0130}NTENAN\u{0130}}\n\
                   0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let texts = extract_dxf_texts(&pairs);
        assert!(texts.iter().any(|s| s.contains("ÇİNTEMANİ") || s.contains("NTENAN")),
            "MTEXT grup kodu 1 metni çıkarılmalı, got: {:?}", texts);
    }

    #[test]
    fn test_extract_layers_basic() {
        let dxf = "0\nSECTION\n2\nTABLES\n0\nLAYER\n2\nWALLS\n0\nLAYER\n2\nDOORS\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let layers = extract_dxf_layers(&pairs);
        assert!(layers.contains(&"WALLS".to_string()));
        assert!(layers.contains(&"DOORS".to_string()));
    }

    #[test]
    fn test_skip_internal_blocks() {
        let dxf = "0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n2\n*Model_Space\n0\nBLOCK\n2\nDOOR_01\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let blocks = extract_dxf_blocks(&pairs);
        assert!(!blocks.iter().any(|b| b.contains("Model_Space")));
        assert!(blocks.contains(&"DOOR_01".to_string()));
    }

    #[test]
    fn test_mtext_strip() {
        let cleaned = strip_mtext_codes("\\PMutfak\\PBanyo");
        assert!(!cleaned.contains('\\'));
    }

    #[test]
    fn test_dxf_xref_detection() {
        // extract_dxf_xrefs saklar: tam yol (bkz. dxf_parse.rs yorumu "tam yolu sakla")
        let pairs = vec![
            (1_i32, "C:\\Projects\\base.dwg".to_string()),
            (1, "notes.txt".to_string()),
        ];
        let xrefs = extract_dxf_xrefs(&pairs);
        assert!(xrefs.contains(&"C:\\Projects\\base.dwg".to_string()));
        assert!(!xrefs.iter().any(|x| x.contains("notes.txt")));
    }

    #[test]
    fn test_dxf_imagedef_detection() {
        // Simulate OBJECTS section with IMAGEDEF entities. Kod tam yolu saklıyor.
        let dxf = "0\nSECTION\n2\nOBJECTS\n0\nIMAGEDEF\n1\nC:\\Projects\\photo.jpg\n0\nIMAGEDEF\n1\n..\\renders\\facade.png\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let refs = extract_dxf_image_refs(&pairs);
        assert!(refs.contains(&"C:\\Projects\\photo.jpg".to_string()), "Should extract full path for photo.jpg");
        assert!(refs.contains(&"..\\renders\\facade.png".to_string()), "Should extract full path for facade.png");
    }

    #[test]
    fn test_dxf_image_ref_from_group_code_1() {
        // Image references found via broad group code 1 scan (not in OBJECTS). Tam yol saklanır.
        let pairs = vec![
            (1_i32, "C:\\Textures\\brick.bmp".to_string()),
            (1, "some_text_value".to_string()),
            (1, "aerial.tiff".to_string()),
        ];
        let refs = extract_dxf_image_refs(&pairs);
        assert!(refs.contains(&"C:\\Textures\\brick.bmp".to_string()));
        assert!(refs.contains(&"aerial.tiff".to_string()));
        assert!(!refs.contains(&"some_text_value".to_string()));
    }

    // ── Shape (geometry) parsing tests — Faz 4.1 ────────────────────────────

    fn approx(a: f64, b: f64, tol: f64) -> bool { (a - b).abs() <= tol }

    #[test]
    fn test_line_parsing() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0.0\n20\n0.0\n11\n3.0\n21\n4.0\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert_eq!(shapes.len(), 1);
        let s = &shapes[0];
        assert_eq!(s.entity_type, "LINE");
        assert_eq!(s.layer_name, "WALLS");
        assert!(approx(s.perimeter, 5.0, 1e-6));
        assert!(!s.is_closed);
        assert!(approx(s.centroid_x, 1.5, 1e-6));
        assert!(approx(s.centroid_y, 2.0, 1e-6));
    }

    #[test]
    fn test_circle_parsing() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nPOOL\n10\n5.0\n20\n10.0\n40\n2.0\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert_eq!(shapes.len(), 1);
        let s = &shapes[0];
        assert_eq!(s.entity_type, "CIRCLE");
        assert_eq!(s.layer_name, "POOL");
        assert!(s.is_closed);
        assert!(approx(s.area, std::f64::consts::PI * 4.0, 1e-6));
        assert!(approx(s.regularity, 1.0, 1e-9));
        assert!(approx(s.bbox_w, 4.0, 1e-9));
        assert!(approx(s.aspect_ratio, 1.0, 1e-9));
    }

    #[test]
    fn test_arc_parsing_quarter_circle() {
        // Radius 10, 0° → 90° = quarter circle, arc length = 10*π/2
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nARC\n8\nDETAIL\n10\n0.0\n20\n0.0\n40\n10.0\n50\n0.0\n51\n90.0\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert_eq!(shapes.len(), 1);
        let s = &shapes[0];
        assert_eq!(s.entity_type, "ARC");
        assert!(!s.is_closed);
        assert!(approx(s.perimeter, 10.0 * std::f64::consts::FRAC_PI_2, 1e-6));
        assert!(approx(s.area, 0.0, 1e-9));
    }

    #[test]
    fn test_lwpolyline_regular_octagon() {
        // Regular 8-gon around origin, radius 10
        let mut dxf = String::from("0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nHAVUZ\n90\n8\n70\n1\n");
        for i in 0..8 {
            let theta = (i as f64) * std::f64::consts::FRAC_PI_4;
            let x = 10.0 * theta.cos();
            let y = 10.0 * theta.sin();
            dxf.push_str(&format!("10\n{}\n20\n{}\n", x, y));
        }
        dxf.push_str("0\nENDSEC\n");
        let pairs = pairs_from_str(&dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert_eq!(shapes.len(), 1);
        let s = &shapes[0];
        assert_eq!(s.entity_type, "LWPOLYLINE");
        assert_eq!(s.layer_name, "HAVUZ");
        assert_eq!(s.vertex_count, 8);
        assert!(s.is_closed, "flag 1 should mean closed");
        assert!(s.regularity > 0.95, "regular 8-gon should score >0.95, got {}", s.regularity);
        assert!(s.area > 0.0);
    }

    #[test]
    fn test_lwpolyline_rectangle_low_regularity() {
        // 10×2 rectangle — angles equal but edges unequal → regularity < octagon
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nROOM\n90\n4\n70\n1\n10\n0.0\n20\n0.0\n10\n10.0\n20\n0.0\n10\n10.0\n20\n2.0\n10\n0.0\n20\n2.0\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert_eq!(shapes.len(), 1);
        let s = &shapes[0];
        assert_eq!(s.vertex_count, 4);
        assert!(s.is_closed);
        assert!(approx(s.area, 20.0, 1e-6));
        assert!(approx(s.bbox_w, 10.0, 1e-9));
        assert!(approx(s.bbox_h, 2.0, 1e-9));
        assert!(approx(s.aspect_ratio, 5.0, 1e-9));
        assert!(s.regularity < 0.8, "rectangle regularity should be < square's, got {}", s.regularity);
    }

    #[test]
    fn test_lwpolyline_square_high_regularity() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nROOM\n90\n4\n70\n1\n10\n0.0\n20\n0.0\n10\n5.0\n20\n0.0\n10\n5.0\n20\n5.0\n10\n0.0\n20\n5.0\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert_eq!(shapes.len(), 1);
        let s = &shapes[0];
        assert!(approx(s.area, 25.0, 1e-6));
        assert!(approx(s.aspect_ratio, 1.0, 1e-9));
        assert!(s.regularity > 0.95, "square should score >0.95, got {}", s.regularity);
    }

    #[test]
    fn test_polyline_classic_with_vertex_seqend() {
        // Classic POLYLINE with 3 VERTEX sub-entities + SEQEND (closed triangle)
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nPOLYLINE\n8\nTRIS\n70\n1\n0\nVERTEX\n8\nTRIS\n10\n0.0\n20\n0.0\n0\nVERTEX\n8\nTRIS\n10\n4.0\n20\n0.0\n0\nVERTEX\n8\nTRIS\n10\n0.0\n20\n3.0\n0\nSEQEND\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert_eq!(shapes.len(), 1);
        let s = &shapes[0];
        assert_eq!(s.entity_type, "POLYLINE");
        assert_eq!(s.vertex_count, 3);
        assert!(s.is_closed);
        assert!(approx(s.area, 6.0, 1e-6));
    }

    #[test]
    fn test_entities_outside_section_ignored() {
        // ENTITIES markers missing → nothing returned
        let dxf = "0\nSECTION\n2\nBLOCKS\n0\nCIRCLE\n8\nL\n10\n0\n20\n0\n40\n1\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert!(shapes.is_empty());
    }

    #[test]
    fn test_multiple_entities_in_section() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nA\n10\n0\n20\n0\n11\n1\n21\n0\n0\nCIRCLE\n8\nB\n10\n5\n20\n5\n40\n1\n0\nLINE\n8\nC\n10\n0\n20\n0\n11\n0\n21\n1\n0\nENDSEC\n";
        let pairs = pairs_from_str(dxf);
        let shapes = parse_dxf_shapes(&pairs);
        assert_eq!(shapes.len(), 3);
        assert_eq!(shapes[0].entity_type, "LINE");
        assert_eq!(shapes[1].entity_type, "CIRCLE");
        assert_eq!(shapes[2].entity_type, "LINE");
    }

    #[test]
    fn test_shoelace_area_ccw_and_cw_equal() {
        // Same square, CCW vs CW winding → abs area equal
        let ccw = vec![(0.0, 0.0), (2.0, 0.0), (2.0, 2.0), (0.0, 2.0)];
        let cw = vec![(0.0, 0.0), (0.0, 2.0), (2.0, 2.0), (2.0, 0.0)];
        assert!(approx(compute_polygon_area(&ccw), 4.0, 1e-9));
        assert!(approx(compute_polygon_area(&cw), 4.0, 1e-9));
    }
}
