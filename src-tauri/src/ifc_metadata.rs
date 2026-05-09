use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};

#[derive(Serialize, Default)]
pub struct IfcMetadata {
    /// IFC schema version (e.g. "IFC2X3", "IFC4", "IFC4X3")
    pub schema: Option<String>,
    /// Organization name from FILE_DESCRIPTION/FILE_NAME
    pub organization: Option<String>,
    /// Originating system (e.g. "Revit", "ArchiCAD")
    pub originating_system: Option<String>,
    /// Author name
    pub author: Option<String>,
    /// File description text
    pub description: Option<String>,
    /// Project name (from IFCPROJECT entity)
    pub project_name: Option<String>,
    /// Site name (from IFCSITE)
    pub site_name: Option<String>,
    /// Building name (from IFCBUILDING)
    pub building_name: Option<String>,
    /// Total entity count
    pub total_entities: usize,
    /// Entity counts by type (top 20)
    pub entity_counts: Vec<EntityCount>,
    /// Number of building stories
    pub storey_count: usize,
    /// Storey names
    pub storey_names: Vec<String>,
    /// Number of spaces/rooms
    pub space_count: usize,
    /// File size in bytes
    pub file_size_bytes: u64,
}

#[derive(Serialize)]
pub struct EntityCount {
    pub entity_type: String,
    pub count: usize,
}

/// IFC (Industry Foundation Classes) dosyasından metadata çıkarır.
/// IFC, metin tabanlı STEP formatıdır.
/// Her satırda #NNN=IFCWALL(...); veya HEADER bilgileri bulunur.
#[tauri::command]
pub fn extract_ifc_metadata(path: String) -> Result<IfcMetadata, String> {
    const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;
    let file_meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if file_meta.len() > MAX_FILE_SIZE {
        return Err(format!(
            "IFC dosyası çok büyük: {} bayt (max {} MB)",
            file_meta.len(),
            MAX_FILE_SIZE / 1024 / 1024
        ));
    }

    let file = fs::File::open(&path).map_err(|e| e.to_string())?;
    let reader = BufReader::new(file);

    let mut meta = IfcMetadata {
        file_size_bytes: file_meta.len(),
        ..Default::default()
    };

    let mut entity_map: HashMap<String, usize> = HashMap::new();
    let mut in_header = false;
    let mut header_buf = String::new();

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };
        let trimmed = line.trim();

        // Track HEADER vs DATA sections
        if trimmed == "HEADER;" {
            in_header = true;
            continue;
        }
        if trimmed == "ENDSEC;" {
            if in_header {
                // Process accumulated header
                parse_ifc_header(&header_buf, &mut meta);
                in_header = false;
                header_buf.clear();
            }
            continue;
        }
        if trimmed == "DATA;" {
            in_header = false;
            continue;
        }

        if in_header {
            header_buf.push_str(trimmed);
            header_buf.push('\n');
            continue;
        }

        // DATA section: entity lines start with #NNN=IFCTYPE(...)
        if let Some(eq_pos) = trimmed.find('=') {
            let before_eq = &trimmed[..eq_pos];
            // Verify it starts with # followed by digits
            if before_eq.starts_with('#') && before_eq[1..].chars().all(|c| c.is_ascii_digit()) {
                let after_eq = &trimmed[eq_pos + 1..];
                // Extract entity type: everything before '('
                if let Some(paren_pos) = after_eq.find('(') {
                    let entity_type = after_eq[..paren_pos].trim().to_uppercase();
                    if !entity_type.is_empty() {
                        *entity_map.entry(entity_type.clone()).or_insert(0) += 1;
                        meta.total_entities += 1;

                        // Extract named entities inline
                        let args = &after_eq[paren_pos + 1..];
                        match entity_type.as_str() {
                            "IFCPROJECT" => {
                                if let Some(name) = extract_ifc_name_arg(args) {
                                    meta.project_name = Some(name);
                                }
                            }
                            "IFCSITE" => {
                                if let Some(name) = extract_ifc_name_arg(args) {
                                    meta.site_name = Some(name);
                                }
                            }
                            "IFCBUILDING" => {
                                if let Some(name) = extract_ifc_name_arg(args) {
                                    meta.building_name = Some(name);
                                }
                            }
                            "IFCBUILDINGSTOREY" => {
                                meta.storey_count += 1;
                                if let Some(name) = extract_ifc_name_arg(args) {
                                    meta.storey_names.push(name);
                                }
                            }
                            "IFCSPACE" => {
                                meta.space_count += 1;
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    // Sort entity counts and take top 20
    let mut counts: Vec<_> = entity_map.into_iter().collect();
    counts.sort_by(|a, b| b.1.cmp(&a.1));
    meta.entity_counts = counts
        .into_iter()
        .take(20)
        .map(|(entity_type, count)| EntityCount { entity_type, count })
        .collect();

    // Storey names limit
    meta.storey_names.truncate(50);

    Ok(meta)
}

/// IFC HEADER bölümünden metadata çıkarır.
fn parse_ifc_header(header: &str, meta: &mut IfcMetadata) {
    // FILE_SCHEMA(('IFC2X3'));  veya  FILE_SCHEMA(('IFC4'));
    if let Some(pos) = header.find("FILE_SCHEMA") {
        let after = &header[pos..];
        if let Some(start) = after.find('\'') {
            let rest = &after[start + 1..];
            if let Some(end) = rest.find('\'') {
                meta.schema = Some(rest[..end].to_string());
            }
        }
    }

    // FILE_DESCRIPTION((...), '2;1');
    if let Some(pos) = header.find("FILE_DESCRIPTION") {
        let after = &header[pos..];
        if let Some(start) = after.find('\'') {
            let rest = &after[start + 1..];
            if let Some(end) = rest.find('\'') {
                let desc = rest[..end].to_string();
                if !desc.is_empty() && desc.len() < 500 {
                    meta.description = Some(desc);
                }
            }
        }
    }

    // FILE_NAME('file.ifc', '2024-01-01', ('Author'), ('Organization'), 'Preprocessor', 'OriginatingSystem', 'Authorization');
    if let Some(pos) = header.find("FILE_NAME") {
        let after = &header[pos..];
        // Extract all single-quoted strings
        let strings = extract_quoted_strings(after);
        // strings[0] = filename, [1] = date, [2] = author, [3] = organization,
        // [4] = preprocessor, [5] = originating system, [6] = authorization
        if strings.len() > 2 && !strings[2].is_empty() {
            meta.author = Some(strings[2].clone());
        }
        if strings.len() > 3 && !strings[3].is_empty() {
            meta.organization = Some(strings[3].clone());
        }
        if strings.len() > 5 && !strings[5].is_empty() {
            meta.originating_system = Some(strings[5].clone());
        }
    }
}

/// Tek tırnak içindeki stringleri sırayla çıkarır.
fn extract_quoted_strings(text: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\'' {
            let mut s = String::new();
            for ch2 in chars.by_ref() {
                if ch2 == '\'' {
                    break;
                }
                s.push(ch2);
            }
            result.push(s);
        }
        if result.len() >= 10 {
            break;
        }
    }
    result
}

/// IFC entity argümanlarından name (2. argüman, STEP encoding) çıkarır.
/// IFC root entity formatı: (GlobalId, OwnerHistory, Name, Description, ...)
/// Name genelde 3. argümandır (#id, #id, 'Name', ...)
fn extract_ifc_name_arg(args: &str) -> Option<String> {
    // Basit argüman parse: virgülle ayır, tek tırnaktaki 3. değeri bul
    let mut depth = 0i32;
    let mut arg_idx = 0usize;
    let mut current_arg = String::new();

    for ch in args.chars() {
        match ch {
            '(' => depth += 1,
            ')' => {
                if depth > 0 {
                    depth -= 1;
                } else {
                    // End of entity args
                    break;
                }
            }
            ',' if depth == 0 => {
                arg_idx += 1;
                current_arg.clear();
                continue;
            }
            _ => {}
        }
        if arg_idx == 2 && depth == 0 {
            // 3rd argument (0-indexed: 2) = Name
            current_arg.push(ch);
        }
    }

    let name = current_arg.trim();
    if name == "$" || name == "*" || name.is_empty() {
        return None;
    }

    // Remove surrounding single quotes
    let name = name.trim_matches('\'');
    if name.is_empty() {
        return None;
    }

    // Decode IFC string encoding (\X2\00E9\X0\ → é etc.)
    Some(decode_ifc_string(name))
}

/// IFC STEP string encoding'i decode eder.
/// \X2\XXXX\X0\ → UTF-16 karakter
/// \S\X → extended ASCII
fn decode_ifc_string(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch == '\\' {
            // Check escape sequence
            if chars.peek() == Some(&'X') {
                chars.next(); // consume X
                if chars.peek() == Some(&'2') {
                    chars.next(); // consume 2
                    if chars.peek() == Some(&'\\') {
                        chars.next(); // consume \
                        // Read hex pairs until \X0\
                        let mut hex = String::new();
                        loop {
                            match chars.next() {
                                Some('\\') => {
                                    // Check for X0\
                                    if chars.peek() == Some(&'X') {
                                        chars.next();
                                        if chars.peek() == Some(&'0') {
                                            chars.next();
                                            if chars.peek() == Some(&'\\') {
                                                chars.next();
                                            }
                                        }
                                    }
                                    break;
                                }
                                Some(c) => hex.push(c),
                                None => break,
                            }
                        }
                        // Parse hex as UTF-16 code points (4 hex digits each)
                        let mut i = 0;
                        while i + 4 <= hex.len() {
                            if let Ok(cp) = u16::from_str_radix(&hex[i..i + 4], 16) {
                                if let Some(c) = char::from_u32(cp as u32) {
                                    result.push(c);
                                }
                            }
                            i += 4;
                        }
                        continue;
                    }
                }
                // \S\ escape (ISO 8859-1 extended)
                if chars.peek() == Some(&'\\') {
                    // Not \X2, just push back
                    result.push('\\');
                    result.push('X');
                    continue;
                }
                result.push('\\');
                result.push('X');
                continue;
            } else if chars.peek() == Some(&'S') {
                chars.next(); // consume S
                if chars.peek() == Some(&'\\') {
                    chars.next(); // consume \
                    if let Some(c) = chars.next() {
                        // ISO 8859-1: char + 128
                        let code = (c as u32) + 128;
                        if let Some(decoded) = char::from_u32(code) {
                            result.push(decoded);
                        }
                        continue;
                    }
                }
                result.push('\\');
                result.push('S');
                continue;
            }
            result.push('\\');
        } else {
            result.push(ch);
        }
    }
    result
}
