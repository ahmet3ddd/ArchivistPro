//! IFC (Industry Foundation Classes) — metin tabanli STEP formati metadata cikarici.
//!
//! H2 `ifc_metadata.rs`'ten nakil. IFC her satirda `#NNN=IFCTYPE(...);` entity'leri
//! veya HEADER bilgileri icerir. Parse saf-Rust, harici arac yok.

use std::collections::HashMap;
use std::io::{BufRead, BufReader};

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor};

/// IFC ust boyut siniri (H2 ile ayni): 500 MB.
const MAX_IFC_SIZE: u64 = 500 * 1024 * 1024;
/// En cok bu kadar storey adi tutulur (H2 ile ayni).
const MAX_STOREY_NAMES: usize = 50;
/// Entity sayim tablosunda tutulacak ust tur sayisi.
const TOP_ENTITY_TYPES: usize = 20;

/// IFC dosyalari icin extractor.
pub struct IfcExtractor;

impl Extractor for IfcExtractor {
    fn id(&self) -> &'static str {
        "ifc"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["ifc"]
    }
    fn max_size(&self) -> u64 {
        MAX_IFC_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let file =
            std::fs::File::open(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
        let reader = BufReader::new(file);

        let mut schema: Option<String> = None;
        let mut organization: Option<String> = None;
        let mut originating_system: Option<String> = None;
        let mut author: Option<String> = None;
        let mut description: Option<String> = None;
        let mut project_name: Option<String> = None;
        let mut site_name: Option<String> = None;
        let mut building_name: Option<String> = None;
        let mut total_entities: usize = 0;
        let mut storey_count: usize = 0;
        let mut space_count: usize = 0;
        let mut storey_names: Vec<String> = Vec::new();
        let mut entity_map: HashMap<String, usize> = HashMap::new();

        let mut in_header = false;
        let mut header_buf = String::new();

        for line_result in reader.lines() {
            // Bozuk satir (gecersiz UTF-8 vb.) → atla, devam et (dayaniklilik).
            let Ok(line) = line_result else { continue };
            let trimmed = line.trim();

            if trimmed == "HEADER;" {
                in_header = true;
                continue;
            }
            if trimmed == "ENDSEC;" {
                if in_header {
                    parse_ifc_header(
                        &header_buf,
                        &mut schema,
                        &mut description,
                        &mut author,
                        &mut organization,
                        &mut originating_system,
                    );
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

            // DATA bolumu: `#NNN=IFCTYPE(...)`
            let Some(eq_pos) = trimmed.find('=') else { continue };
            let before_eq = &trimmed[..eq_pos];
            if !before_eq.starts_with('#') || !before_eq[1..].chars().all(|c| c.is_ascii_digit()) {
                continue;
            }
            let after_eq = &trimmed[eq_pos + 1..];
            let Some(paren_pos) = after_eq.find('(') else { continue };
            let entity_type = after_eq[..paren_pos].trim().to_uppercase();
            if entity_type.is_empty() {
                continue;
            }
            *entity_map.entry(entity_type.clone()).or_insert(0) += 1;
            total_entities += 1;

            let args = &after_eq[paren_pos + 1..];
            match entity_type.as_str() {
                "IFCPROJECT" => {
                    if let Some(name) = extract_ifc_name_arg(args) {
                        project_name = Some(name);
                    }
                }
                "IFCSITE" => {
                    if let Some(name) = extract_ifc_name_arg(args) {
                        site_name = Some(name);
                    }
                }
                "IFCBUILDING" => {
                    if let Some(name) = extract_ifc_name_arg(args) {
                        building_name = Some(name);
                    }
                }
                "IFCBUILDINGSTOREY" => {
                    storey_count += 1;
                    if let Some(name) = extract_ifc_name_arg(args) {
                        storey_names.push(name);
                    }
                }
                "IFCSPACE" => space_count += 1,
                _ => {}
            }
        }

        storey_names.truncate(MAX_STOREY_NAMES);

        // Entity sayimlarini azalan sirada (kararli: esitlikte tur adina gore) sirala.
        let mut counts: Vec<(String, usize)> = entity_map.into_iter().collect();
        counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
        let top_entities: String = counts
            .iter()
            .take(TOP_ENTITY_TYPES)
            .map(|(t, c)| format!("{t}:{c}"))
            .collect::<Vec<_>>()
            .join(", ");

        // ── Extracted'e esle ──
        let mut out = Extracted::new();
        if let Some(v) = &schema {
            out.set("schema", v.clone());
        }
        if let Some(v) = &organization {
            out.set("organization", v.clone());
        }
        if let Some(v) = &originating_system {
            out.set("originating_system", v.clone());
        }
        if let Some(v) = &author {
            out.set("author", v.clone());
        }
        if let Some(v) = &description {
            out.set("description", v.clone());
        }
        if let Some(v) = &project_name {
            out.set("project_name", v.clone());
        }
        if let Some(v) = &site_name {
            out.set("site_name", v.clone());
        }
        if let Some(v) = &building_name {
            out.set("building_name", v.clone());
        }
        out.set("total_entities", total_entities);
        out.set("storey_count", storey_count);
        out.set("space_count", space_count);
        if !top_entities.is_empty() {
            out.set("top_entities", top_entities);
        }
        if !storey_names.is_empty() {
            out.set("storey_names", storey_names.join("; "));
        }

        // FTS body: insan-anlamli aranabilir metin.
        let mut text_parts: Vec<String> = Vec::new();
        for v in [
            &project_name,
            &site_name,
            &building_name,
            &author,
            &organization,
            &originating_system,
            &description,
        ]
        .into_iter()
        .flatten()
        {
            text_parts.push(v.clone());
        }
        text_parts.extend(storey_names);
        if !text_parts.is_empty() {
            out.text = Some(text_parts.join("\n"));
        }

        Ok(out)
    }
}

/// IFC HEADER bolumunden metadata cikarir (FILE_SCHEMA / FILE_DESCRIPTION / FILE_NAME).
fn parse_ifc_header(
    header: &str,
    schema: &mut Option<String>,
    description: &mut Option<String>,
    author: &mut Option<String>,
    organization: &mut Option<String>,
    originating_system: &mut Option<String>,
) {
    // FILE_SCHEMA(('IFC2X3')); → IFC2X3
    if let Some(pos) = header.find("FILE_SCHEMA") {
        let after = &header[pos..];
        if let Some(start) = after.find('\'') {
            let rest = &after[start + 1..];
            if let Some(end) = rest.find('\'') {
                *schema = Some(rest[..end].to_string());
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
                    *description = Some(desc);
                }
            }
        }
    }

    // FILE_NAME('file', 'date', ('Author'), ('Org'), 'Pre', 'OrigSystem', 'Auth');
    if let Some(pos) = header.find("FILE_NAME") {
        let after = &header[pos..];
        let strings = extract_quoted_strings(after);
        if strings.len() > 2 && !strings[2].is_empty() {
            *author = Some(strings[2].clone());
        }
        if strings.len() > 3 && !strings[3].is_empty() {
            *organization = Some(strings[3].clone());
        }
        if strings.len() > 5 && !strings[5].is_empty() {
            *originating_system = Some(strings[5].clone());
        }
    }
}

/// Tek tirnak icindeki stringleri sirayla (en cok 10) cikarir.
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

/// IFC entity argumanlarindan 3. argumani (Name, 0-index 2) cikarir + STEP decode.
///
/// IFC root entity formati: `(GlobalId, OwnerHistory, Name, Description, ...)`.
/// **H2 duzeltmesi:** H2'de arg2 toplandiktan sonra kapanis virgulu
/// `current_arg.clear()` ile icerigi siliyordu → isim hep `None` cikiyordu. Burada
/// arg2, virgul VEYA kapanis `)` ile dogru sekilde sonlandirilir.
fn extract_ifc_name_arg(args: &str) -> Option<String> {
    let mut depth = 0i32;
    let mut idx = 0usize;
    let mut current = String::new();
    let mut found: Option<String> = None;

    for ch in args.chars() {
        match ch {
            '(' => {
                depth += 1;
                if idx == 2 {
                    current.push(ch);
                }
            }
            ')' => {
                if depth > 0 {
                    depth -= 1;
                    if idx == 2 {
                        current.push(ch);
                    }
                } else {
                    break; // entity arguman listesi bitti
                }
            }
            ',' if depth == 0 => {
                if idx == 2 {
                    found = Some(current.clone());
                    break;
                }
                idx += 1;
                current.clear();
            }
            _ => {
                if idx == 2 {
                    current.push(ch);
                }
            }
        }
    }

    // arg2 virgulle degil de kapanis/dosya-sonu ile bittiyse `current`'tan al.
    let raw = found.unwrap_or(current);
    let name = raw.trim();
    if name == "$" || name == "*" || name.is_empty() {
        return None;
    }
    let name = name.trim_matches('\'');
    if name.is_empty() {
        return None;
    }
    Some(decode_ifc_string(name))
}

/// IFC STEP string encoding decode: `\X2\XXXX\X0\` → UTF-16; `\S\X` → ISO-8859-1 ext.
fn decode_ifc_string(s: &str) -> String {
    let mut result = String::new();
    let mut chars = s.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '\\' {
            result.push(ch);
            continue;
        }
        // '\' gordu — escape dizisi cozumle.
        if chars.peek() == Some(&'X') {
            chars.next(); // X
            if chars.peek() == Some(&'2') {
                chars.next(); // 2
                if chars.peek() == Some(&'\\') {
                    chars.next(); // \
                    let mut hex = String::new();
                    loop {
                        match chars.next() {
                            Some('\\') => {
                                // \X0\ kapanisini ye.
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
                    let mut i = 0;
                    while i + 4 <= hex.len() {
                        if let Ok(cp) = u16::from_str_radix(&hex[i..i + 4], 16) {
                            if let Some(c) = char::from_u32(u32::from(cp)) {
                                result.push(c);
                            }
                        }
                        i += 4;
                    }
                    continue;
                }
            }
            result.push('\\');
            result.push('X');
            continue;
        } else if chars.peek() == Some(&'S') {
            chars.next(); // S
            if chars.peek() == Some(&'\\') {
                chars.next(); // \
                if let Some(c) = chars.next() {
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
    }
    result
}
