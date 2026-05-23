// DWG/CFBF ikili parser'ı: match kolu + iç `if` (opcode/uzunluk koşulu) deseni
// bilinçli. clippy::collapsible_match pattern-guard'a çevirmeyi önerir; guard-
// fallthrough semantiği davranışı değiştirebilir, kozmetik → modül genelinde kapalı.
#![allow(clippy::collapsible_match)]

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Cached path to ODAFileConverter executable (None = not found / not searched yet with manual override).
/// The inner Option<PathBuf>: Some(path) = found, None = searched but not found.
static ODA_CONVERTER_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Manual override set from frontend settings. Stored separately so user can change it at runtime.
static ODA_CONVERTER_MANUAL: std::sync::Mutex<Option<Option<PathBuf>>> = std::sync::Mutex::new(None);

#[derive(Serialize)]
pub struct DwgExtractedMetadata {
    pub version: Option<String>,
    pub layers: Vec<String>,
    pub block_names: Vec<String>,
    pub text_contents: Vec<String>,
    pub xref_names: Vec<String>,
    pub image_refs: Vec<String>,
    pub ole_objects: Vec<String>,
    pub drawing_properties: DwgDrawingProperties,
    pub estimated_scale: Option<String>,
    pub unit_type: Option<String>,
}

/// Reads the DWG version string from the first 6 bytes of the file header.
pub fn get_dwg_version(data: &[u8]) -> Option<String> {
    if data.len() < 6 { return None; }
    let code = std::str::from_utf8(&data[0..6]).ok()?;
    let label = match code {
        "AC1006" => "R10",
        "AC1009" => "R11 / R12",
        "AC1012" => "R13",
        "AC1014" => "R14",
        "AC1015" => "AutoCAD 2000",
        "AC1018" => "AutoCAD 2004",
        "AC1021" => "AutoCAD 2007",
        "AC1024" => "AutoCAD 2010",
        "AC1027" => "AutoCAD 2013",
        "AC1032" => "AutoCAD 2018",
        "AC1035" => "AutoCAD 2023",
        "AC1036" => "AutoCAD 2024",
        _ => return None,
    };
    Some(label.to_string())
}

#[derive(Serialize, Default)]
pub struct DwgDrawingProperties {
    pub title: Option<String>,
    pub subject: Option<String>,
    pub author: Option<String>,
    pub keywords: Option<String>,
    pub comments: Option<String>,
    pub last_saved_by: Option<String>,
}

/// Maps a Windows-1254 (Turkish) byte to its UTF-8 encoding when the byte
/// appears in a context where it cannot form a valid UTF-8 sequence.
/// DWG files from Turkish AutoCAD installations often store MTEXT content
/// (MLEADER, MTEXT entities with TrueType fonts) using CP1254.
/// Returns None for bytes that are not CP1254 Turkish special characters.
#[inline]
fn cp1254_fallback(b: u8) -> Option<&'static [u8]> {
    match b {
        // Uppercase Turkish / Latin chars stored as CP1254 bytes
        0xC7 => Some(b"\xC3\x87"),  // Ç  → U+00C7
        0xD0 => Some(b"\xC4\x9E"),  // Ğ  → U+011E
        0xD6 => Some(b"\xC3\x96"),  // Ö  → U+00D6
        0xDC => Some(b"\xC3\x9C"),  // Ü  → U+00DC
        0xDD => Some(b"\xC4\xB0"),  // İ  → U+0130
        0xDE => Some(b"\xC5\x9E"),  // Ş  → U+015E
        // Lowercase Turkish / Latin chars
        0xE7 => Some(b"\xC3\xA7"),  // ç  → U+00E7
        0xF0 => Some(b"\xC4\x9F"),  // ğ  → U+011F
        0xF6 => Some(b"\xC3\xB6"),  // ö  → U+00F6
        0xFC => Some(b"\xC3\xBC"),  // ü  → U+00FC
        0xFD => Some(b"\xC4\xB1"),  // ı  → U+0131
        0xFE => Some(b"\xC5\x9F"),  // ş  → U+015F
        _ => None,
    }
}

/// Scans DWG binary data for readable ASCII/UTF-8 strings.
/// DWG stores many strings as length-prefixed UTF-8 or as null-terminated sequences.
/// Supports multibyte UTF-8 characters (Turkish İ,Ş,Ğ,Ü,Ö,Ç etc.).
///
/// Strategy: scan byte-by-byte with proper UTF-8 codepoint validation.
/// When a multibyte leading byte is found, consume the expected continuation
/// bytes only if they form a valid sequence. On failure, try a Windows-1254
/// (CP1254) fallback before treating the byte as a separator — this recovers
/// Turkish text from MLEADER/MTEXT entities that use the `\c162` charset hint.
pub fn extract_dwg_strings(data: &[u8], min_len: usize, max_len: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current = Vec::new();
    let len = data.len();
    let mut i = 0;

    while i < len {
        let b = data[i];

        if (0x20..=0x7E).contains(&b) {
            // ASCII printable
            current.push(b);
            i += 1;
        } else if (0xC2..=0xDF).contains(&b) && i + 1 < len {
            // 2-byte UTF-8: leading 110xxxxx + 1 continuation
            let b1 = data[i + 1];
            if (0x80..=0xBF).contains(&b1) {
                current.push(b);
                current.push(b1);
                i += 2;
            } else if let Some(utf8) = cp1254_fallback(b) {
                // Invalid UTF-8 continuation but byte is a CP1254 Turkish char
                current.extend_from_slice(utf8);
                i += 1;
            } else {
                // Invalid sequence — flush
                flush_buffer(&mut current, min_len, &mut strings);
                i += 1;
            }
        } else if (0xE0..=0xEF).contains(&b) && i + 2 < len {
            // 3-byte UTF-8: leading 1110xxxx + 2 continuation
            let b1 = data[i + 1];
            let b2 = data[i + 2];
            if (0x80..=0xBF).contains(&b1) && (0x80..=0xBF).contains(&b2) {
                current.push(b);
                current.push(b1);
                current.push(b2);
                i += 3;
            } else if let Some(utf8) = cp1254_fallback(b) {
                // e.g. ç = 0xE7 in CP1254, but no valid 3-byte UTF-8 continuation
                current.extend_from_slice(utf8);
                i += 1;
            } else {
                flush_buffer(&mut current, min_len, &mut strings);
                i += 1;
            }
        } else if (0xF0..=0xF4).contains(&b) && i + 3 < len {
            // 4-byte UTF-8: leading 11110xxx + 3 continuation
            let b1 = data[i + 1];
            let b2 = data[i + 2];
            let b3 = data[i + 3];
            if (0x80..=0xBF).contains(&b1)
                && (0x80..=0xBF).contains(&b2)
                && (0x80..=0xBF).contains(&b3)
            {
                current.push(b);
                current.push(b1);
                current.push(b2);
                current.push(b3);
                i += 4;
            } else if let Some(utf8) = cp1254_fallback(b) {
                // e.g. ğ = 0xF0 in CP1254, but no valid 4-byte UTF-8 continuation
                current.extend_from_slice(utf8);
                i += 1;
            } else {
                flush_buffer(&mut current, min_len, &mut strings);
                i += 1;
            }
        } else {
            // Byte is not a valid UTF-8 start — try CP1254 fallback before flushing.
            // Handles: ö=0xF6, ü=0xFC, ı=0xFD, ş=0xFE (above 0xF4 range).
            if let Some(utf8) = cp1254_fallback(b) {
                current.extend_from_slice(utf8);
            } else {
                flush_buffer(&mut current, min_len, &mut strings);
            }
            i += 1;
        }

        if current.len() > max_len {
            current.clear();
        }
    }
    flush_buffer(&mut current, min_len, &mut strings);
    strings
}

/// Flush accumulated bytes into a string if valid UTF-8 and meets minimum length.
fn flush_buffer(buf: &mut Vec<u8>, min_len: usize, out: &mut Vec<String>) {
    if buf.len() >= min_len {
        if let Ok(s) = std::str::from_utf8(buf) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                out.push(trimmed.to_string());
            }
        }
    }
    buf.clear();
}

/// Returns true if the string is a plausible AutoCAD layer name.
fn is_valid_layer_name(s: &str) -> bool {
    if s.is_empty() || s.len() > 64 { return false; }
    // Must have at least one letter
    if !s.chars().any(|c| c.is_alphabetic()) { return false; }
    // AutoCAD forbids these characters in layer names
    if s.chars().any(|c| matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | ';' | '?' | '*' | '|' | '=')) {
        return false;
    }
    // Skip AutoCAD internal class/system strings
    let skip_prefixes = ["AcDb", "AcCm", "AcGi", "AcGe", "AcPl", "AcXr", "AC1", "ACAD", "ObjectARX"];
    if skip_prefixes.iter().any(|p| s.starts_with(p)) { return false; }
    // Skip common linetype/color names that aren't layer names
    let skip_exact = [
        "continuous", "CONTINUOUS", "ByLayer", "BYLAYER", "ByBlock", "BYBLOCK",
        "True", "False", "Model", "Layout", "Standard", "STANDARD",
    ];
    if skip_exact.iter().any(|e| s.eq_ignore_ascii_case(e)) { return false; }
    true
}

/// Extracts layer names from DWG data.
///
/// Primary strategy: scan for "AcDbLayerTableRecord" class markers (R2000+).
/// In DWG binary the layer name string appears in the preceding ~128 bytes.
/// Fallback: broader ASCII string scan for older formats (R14 and earlier).
pub fn extract_dwg_layers(data: &[u8]) -> Vec<String> {
    let mut layers = std::collections::HashSet::new();

    // ── Primary: AcDbLayerTableRecord marker scan (R2000+) ──────────────────
    let marker = b"AcDbLayerTableRecord";
    let mut i = 0;
    while i + marker.len() <= data.len() {
        if &data[i..i + marker.len()] == marker {
            // Layer name is in the ~128 bytes before the marker
            let start = i.saturating_sub(128);
            let candidates = extract_dwg_strings(&data[start..i], 1, 64);
            // Walk candidates in reverse: the layer name is typically the last
            // meaningful identifier before the class marker
            for s in candidates.iter().rev().take(10) {
                if is_valid_layer_name(s) {
                    layers.insert(s.clone());
                    break;
                }
            }
        }
        i += 1;
    }

    // ── Fallback: scan for identifier-like strings that look like layer names ──
    if layers.is_empty() {
        let all_strings = extract_dwg_strings(data, 2, 64);
        for s in &all_strings {
            // Must not contain spaces (layer names rarely have spaces)
            if s.contains(' ') { continue; }
            if !is_valid_layer_name(s) { continue; }
            // Must look like an identifier: alphanumeric + underscore/hyphen/dot
            let valid = s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.');
            if !valid { continue; }
            // Filter out strings that look like hex/binary garbage (all uppercase single chars)
            if s.len() <= 2 && s.chars().all(|c| c.is_uppercase()) { continue; }
            layers.insert(s.clone());
        }
    }

    let mut result: Vec<String> = layers.into_iter().collect();
    result.sort();
    result.truncate(500);
    result
}

/// Extracts block names from DWG data. Blocks are reusable drawing components
/// like doors, windows, furniture, fixtures, etc.
pub fn extract_dwg_blocks(data: &[u8]) -> Vec<String> {
    let all_strings = extract_dwg_strings(data, 3, 255);
    let mut blocks = std::collections::HashSet::new();

    let block_indicators = [
        // Furniture
        "CHAIR", "TABLE", "DESK", "BED", "SOFA", "COUCH", "CABINET", "SHELF",
        "WARDROBE", "ARMCHAIR", "BENCH", "STOOL",
        // Fixtures
        "DOOR", "WINDOW", "WIN", "DR-", "WN-", "GATE",
        "SINK", "WC", "TOILET", "BATHTUB", "SHOWER", "LAVABO",
        // Structure
        "COLUMN", "COL", "PILLAR", "BEAM",
        // MEP
        "LAMP", "LIGHT", "SWITCH", "OUTLET", "SOCKET", "PANEL",
        "SPRINKLER", "DIFFUSER", "VENT", "RADIATOR",
        // Landscape
        "TREE", "PLANT", "BUSH", "GRASS",
        // Vehicles
        "CAR", "VEHICLE", "PARK",
        // Symbols
        "ARROW", "NORTH", "SECTION", "DETAIL", "ELEV",
        "LEVEL", "GRID", "TITLE", "SCALE",
        // Turkish
        "KAPI", "PENCERE", "MASA", "SANDALYE", "YATAK", "DOLAP",
        "KLOZET", "LAVABO", "KUVET", "AGAC", "ARAC",
    ];

    // Pattern: *MODEL_SPACE and *PAPER_SPACE are internal blocks, skip them
    let skip_patterns = ["*MODEL_SPACE", "*PAPER_SPACE", "*MODEL", "*PAPER"];

    for s in &all_strings {
        let upper = s.to_uppercase();
        // Skip internal blocks
        if skip_patterns.iter().any(|p| upper.contains(p)) {
            continue;
        }
        // Skip if looks like a file path
        if s.contains('\\') || s.contains('/') || s.contains(':') {
            continue;
        }
        for indicator in &block_indicators {
            if upper.contains(indicator) && s.len() <= 80 {
                blocks.insert(s.clone());
                break;
            }
        }
    }

    let mut result: Vec<String> = blocks.into_iter().collect();
    result.sort();
    result
}

/// Strip MTEXT formatting codes from a string, leaving plain text.
/// MTEXT wraps text like `{\fArial|b0|i0|c162;GİRESUN}` or `{\H2.5x;Title\PSubtitle}`;
/// without stripping, such strings get dropped later by the brace filter.
/// Safe for UTF-8: we only branch on ASCII bytes (<0x80); multibyte chars pass through.
fn strip_mtext_codes(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'{' || b == b'}' {
            i += 1;
            continue;
        }
        if b == b'\\' && i + 1 < bytes.len() {
            let next = bytes[i + 1];
            match next {
                b'L' | b'l' | b'O' | b'o' | b'K' | b'k' => { i += 2; continue; }
                b'P' | b'~' => { out.push(b' '); i += 2; continue; }
                b'\\' => { out.push(b'\\'); i += 2; continue; }
                b'{'  => { out.push(b'{');  i += 2; continue; }
                b'}'  => { out.push(b'}');  i += 2; continue; }
                b'f' | b'F' | b'H' | b'W' | b'Q' | b'T' | b'A' | b'C' | b'p' | b'S' => {
                    i += 2;
                    while i < bytes.len() && bytes[i] != b';' { i += 1; }
                    if i < bytes.len() { i += 1; }
                    continue;
                }
                _ => {}
            }
        }
        out.push(b);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| s.to_string())
}

pub fn extract_dwg_texts(data: &[u8]) -> Vec<String> {
    // UTF-16LE (MTEXT/Arial-TTF entity'leri, R2007+) önce — daha dar aralıkla tarandığı
    // için daha temiz. UTF-8 (TEXT/SHX entity'leri) sonra. Bu sıra insertion order
    // korunduğunda meaningful MTEXT etiketlerinin truncate cap'i tarafından kesilmemesini sağlar.
    let mut all_strings = extract_dwg_strings_utf16_unicode(data, 4, 200);
    all_strings.extend(extract_dwg_strings(data, 4, 200));
    let mut texts: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // AutoCAD internal prefixes to skip
    let skip_prefixes = [
        "AcDb", "AcCm", "AcGi", "AcGe", "AcPl", "AcXr", "AcRx", "AcEd",
        "AC1", "ACAD", "ObjectARX", "Autodesk", "IcArx",
        "LWPOLYLINE", "POLYLINE", "INSERT", "ATTRIB", "ATTDEF",
        "HATCH", "SOLID", "MLINE", "SPLINE", "VIEWPORT",
        "DIMENSION", "LEADER", "MLEADER", "TABLE", "TOLERANCE",
        "WIPEOUT", "IMAGE", "OLE2FRAME", "XLINE", "RAY",
        "REGION", "BODY", "3DSOLID", "3DFACE", "MESH",
        "SURFACE", "HELIX", "LIGHT", "SUN", "SECTION",
        "MTEXT{", "\\A1;", "\\P", "\\f", "\\H",
    ];

    // Exact strings to skip
    let skip_exact = [
        "continuous", "CONTINUOUS", "ByLayer", "BYLAYER", "ByBlock", "BYBLOCK",
        "True", "False", "Model", "Layout", "Standard", "STANDARD",
        "*MODEL_SPACE", "*PAPER_SPACE", "*MODEL", "*PAPER",
        "ENTITIES", "OBJECTS", "BLOCKS", "HEADER", "CLASSES", "TABLES",
        "BLOCK_RECORD", "DICTIONARY", "DICTIONARYVAR", "XRECORD",
        "SCALE", "PLOTSTYLENAME", "LAYER_INDEX", "SPATIAL_INDEX",
    ];

    for s_raw in &all_strings {
        // MTEXT control-code stripping: sadece GERÇEK MTEXT işaretleri varsa uygula.
        // Aksi halde rastgele binary stream'de scattered `{`/`}` karakterleri kaldırılıp
        // gürültü stringleri brace filter'ını geçerdi.
        let has_mtext_markers = s_raw.contains("\\f") || s_raw.contains("\\F")
            || s_raw.contains("\\H") || s_raw.contains("\\A")
            || s_raw.contains("\\P") || s_raw.contains("\\W")
            || s_raw.contains("\\Q") || s_raw.contains("\\C")
            || s_raw.contains("\\S");
        let stripped = if has_mtext_markers {
            strip_mtext_codes(s_raw)
        } else {
            s_raw.clone()
        };
        let s = stripped.trim();
        if s.is_empty() { continue; }
        let len = s.len();

        // Length filter (min 4 — 3-char tokens are mostly binary noise)
        if !(4..=200).contains(&len) { continue; }

        // Must have at least one letter (Unicode-aware)
        if !s.chars().any(|c| c.is_alphabetic()) { continue; }

        // Reject strings that are mostly non-letter noise (hex, binary artifacts)
        let letter_count = s.chars().filter(|c| c.is_alphabetic()).count();
        let total_chars = s.chars().count();
        if (letter_count as f32 / total_chars as f32) < 0.6 { continue; }

        // Reject strings with very low character diversity (binary stream artifacts
        // decode to "aaaaaa"-like garbage when interpreted as ASCII/UTF-16)
        let unique_chars = {
            let mut set = std::collections::HashSet::new();
            for c in s.chars() { set.insert(c); }
            set.len()
        };
        if total_chars > 6 && (unique_chars as f32 / total_chars as f32) < 0.35 { continue; }

        if skip_prefixes.iter().any(|p| s.starts_with(p)) { continue; }
        if skip_exact.iter().any(|e| s.eq_ignore_ascii_case(e)) { continue; }
        if s.contains('\\') || s.contains(":/") || s.contains(":\\") { continue; }
        if s.contains('{') || s.contains('}') || s.contains("::") { continue; }

        if len <= 6 && s.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_') {
            continue;
        }

        let owned = s.to_string();
        if seen.insert(owned.clone()) {
            texts.push(owned);
        }
    }

    // UTF-16 önce geldiği için mimari MTEXT etiketleri listenin başında.
    // UI tarafı FilterableTextList ile filtre + "tümünü göster" toggle sunuyor.
    texts.truncate(5000);
    texts
}

/// Extracts xref (external reference) file names from DWG data.
pub fn extract_dwg_xrefs(data: &[u8]) -> Vec<String> {
    let all_strings = extract_dwg_strings(data, 5, 512);
    let mut xrefs = std::collections::HashSet::new();

    let dwg_extensions = [".dwg", ".DWG", ".dxf", ".DXF"];

    for s in &all_strings {
        for ext in &dwg_extensions {
            if s.ends_with(ext) && s.len() > ext.len() + 1 {
                xrefs.insert(s.to_string()); // tam yolu sakla
                break;
            }
        }
    }

    let mut result: Vec<String> = xrefs.into_iter().collect();
    result.sort();
    result
}

/// Extracts image reference file names from DWG data.
/// Scans for strings ending with common raster image extensions
/// (JPEG, PNG, BMP, TIFF, GIF, PCX, ECW) that may be attached via IMAGE/IMAGEATTACH.
pub fn extract_dwg_image_refs(data: &[u8]) -> Vec<String> {
    let all_strings = extract_dwg_strings(data, 5, 512);
    let mut image_refs = std::collections::HashSet::new();

    let image_extensions = [
        ".jpg", ".JPG", ".jpeg", ".JPEG",
        ".png", ".PNG",
        ".bmp", ".BMP",
        ".tif", ".TIF", ".tiff", ".TIFF",
        ".gif", ".GIF",
        ".pcx", ".PCX",
        ".ecw", ".ECW",
    ];

    for s in &all_strings {
        for ext in &image_extensions {
            if s.ends_with(ext) && s.len() > ext.len() + 1 {
                image_refs.insert(s.to_string()); // tam yolu sakla
                break;
            }
        }
    }

    let mut result: Vec<String> = image_refs.into_iter().collect();
    result.sort();
    result.truncate(100);
    result
}

/// Tanınan OLE ProgID prefix'lerine göre string'ler içinde gömülü OLE objesi tespit eder.
/// DWG/DXF içinde OLE2FRAME entity'si Excel/Word/PDF gibi objeleri ProgID ile saklar.
/// Bulunursa (category_key, formatted_label) döner — category_key dedupe için kullanılır.
pub fn detect_ole_progid(s: &str) -> Option<(&'static str, String)> {
    let trimmed = s.trim();
    if trimmed.is_empty() || trimmed.len() > 64 { return None; }
    let lower = trimmed.to_lowercase();
    // (prefix, category_key, display_label)
    let prefixes = [
        ("excel.sheet",        "EXCEL",        "Microsoft Excel"),
        ("excel.workbook",     "EXCEL",        "Microsoft Excel"),
        ("excel.chart",        "EXCEL_CHART",  "Microsoft Excel Chart"),
        ("word.document",      "WORD",         "Microsoft Word"),
        ("word.picture",       "WORD_PIC",     "Microsoft Word Picture"),
        ("powerpoint.show",    "PPT",          "Microsoft PowerPoint"),
        ("powerpoint.slide",   "PPT_SLIDE",    "Microsoft PowerPoint Slide"),
        ("mspp.slide",         "PPT_SLIDE",    "Microsoft PowerPoint Slide"),
        ("msgraph.chart",      "MSGRAPH",      "Microsoft Graph Chart"),
        ("visio.drawing",      "VISIO",        "Microsoft Visio"),
        ("acrobat.document",   "PDF",          "Adobe Acrobat PDF"),
        ("acroexch.document",  "PDF",          "Adobe Acrobat PDF"),
        ("pdfxml.document",    "PDF",          "PDF Document"),
        ("photoshop.image",    "PHOTOSHOP",    "Adobe Photoshop Görsel"),
        ("paintbrush.picture", "PBRUSH",       "Paintbrush/Bitmap Görsel"),
        ("paint.picture",      "PBRUSH",       "Paintbrush/Bitmap Görsel"),
        ("pbrush",             "PBRUSH",       "Paintbrush/Bitmap Görsel"),
        ("bitmap image",       "BITMAP",       "Bitmap Görsel"),
        ("image document",     "IMAGE",        "Gömülü Görsel"),
        ("coreldraw",          "COREL",        "CorelDRAW"),
        ("cdraw",              "COREL",        "CorelDRAW"),
        ("mspho",              "MSPHOTO",      "Microsoft Photo Editor Görsel"),
        ("equation",           "EQUATION",     "Matematik Denklem"),
        ("package",            "PACKAGE",      "Gömülü Dosya (Package)"),
        ("staroffice",         "STAROFFICE",   "StarOffice/OpenOffice"),
        ("opendocument",       "OPENDOC",      "OpenDocument"),
        ("autocad.",           "AUTOCAD",      "AutoCAD Nesnesi"),
        // Clipboard'dan yapıştırılmış statik görsel OLE'ler
        ("staticmetafile",     "STATIC_META",  "Metafile Görsel (Statik)"),
        ("staticdib",          "STATIC_DIB",   "Bitmap Görsel (DIB, Statik)"),
        ("staticenhmetafile",  "STATIC_EMF",   "EMF Görsel (Statik)"),
        ("metafilepict",       "STATIC_META",  "Metafile Görsel"),
        ("picture (metafile",  "STATIC_META",  "Metafile Görsel"),
        ("picture (device",    "STATIC_DIB",   "Bitmap Görsel (DIB)"),
        ("picture (enhanced",  "STATIC_EMF",   "EMF Görsel"),
    ];
    for (prefix, cat, label) in &prefixes {
        if lower.starts_with(prefix) {
            // Label zaten parantez içeriyorsa ham ProgID'yi tekrar ekleme (çirkin
            // "... (DIB, Statik) (StaticDib)" çıktısını önle). Aksi halde ham ProgID
            // kullanıcıya ek ipucu olsun diye parantez içinde eklenir.
            let display = if label.contains('(') {
                label.to_string()
            } else {
                format!("{} ({})", label, trimmed)
            };
            return Some((cat, display));
        }
    }
    None
}

/// GUID string ("00020820-0000-0000-C000-000000000046") → 16 byte binary (LE Data1-3, Data4 as-is).
fn guid_to_bytes(guid: &str) -> [u8; 16] {
    let hex: String = guid.chars().filter(|c| c.is_ascii_hexdigit()).collect();
    let mut bytes = [0u8; 16];
    if hex.len() == 32 {
        for i in 0..16 {
            bytes[i] = u8::from_str_radix(&hex[i*2..i*2+2], 16).unwrap_or(0);
        }
        bytes[0..4].reverse();
        bytes[4..6].reverse();
        bytes[6..8].reverse();
    }
    bytes
}

static KNOWN_CLSID_MAP: OnceLock<Vec<([u8; 16], &'static str, &'static str)>> = OnceLock::new();

/// (binary_guid, category_key, display_label)
pub fn known_clsids() -> &'static [([u8; 16], &'static str, &'static str)] {
    KNOWN_CLSID_MAP.get_or_init(|| {
        let raw: &[(&str, &str, &str)] = &[
            ("00020820-0000-0000-C000-000000000046", "EXCEL",      "Microsoft Excel"),
            ("00020821-0000-0000-C000-000000000046", "EXCEL_CHART","Microsoft Excel Chart"),
            ("00020810-0000-0000-C000-000000000046", "EXCEL",      "Microsoft Excel (legacy)"),
            ("00020906-0000-0000-C000-000000000046", "WORD",       "Microsoft Word"),
            ("00020900-0000-0000-C000-000000000046", "WORD",       "Microsoft Word (legacy)"),
            ("64818D10-4F9B-11CF-86EA-00AA00B929E8", "PPT",        "Microsoft PowerPoint"),
            ("64818D11-4F9B-11CF-86EA-00AA00B929E8", "PPT_SLIDE",  "Microsoft PowerPoint Slide"),
            ("F20DA720-C02F-11CE-927B-0800095AE340", "PACKAGE",    "Gömülü Dosya (Package)"),
            ("B801CA65-A1FC-11D0-85AD-444553540000", "PDF",        "Adobe Acrobat PDF"),
            ("0003000A-0000-0000-C000-000000000046", "PBRUSH",     "Paintbrush/Bitmap Görsel"),
            ("0002CE02-0000-0000-C000-000000000046", "EQUATION",   "Matematik Denklem (Equation 3)"),
            ("00020803-0000-0000-C000-000000000046", "MSGRAPH",    "Microsoft Graph Chart"),
            ("00021A14-0000-0000-C000-000000000046", "VISIO",      "Microsoft Visio"),
            ("00021A20-0000-0000-C000-000000000046", "VISIO",      "Microsoft Visio"),
            ("00030002-0000-0000-C000-000000000046", "WORDART",    "Microsoft WordArt"),
            ("22D6F31E-B0F6-11D0-94AB-0080C74C7E95", "MSPHOTO",    "Microsoft Photo Editor Görsel"),
            // Clipboard'dan yapıştırılmış statik görsel OLE'ler
            ("00000315-0000-0000-C000-000000000046", "STATIC_META","Metafile Görsel (Statik)"),
            ("00000316-0000-0000-C000-000000000046", "STATIC_DIB", "Bitmap Görsel (DIB, Statik)"),
            ("00000319-0000-0000-C000-000000000046", "STATIC_EMF", "EMF Görsel (Statik)"),
        ];
        raw.iter().map(|(g, c, l)| (guid_to_bytes(g), *c, *l)).collect()
    })
}

/// DWG binary'de bilinen CLSID (GUID) byte pattern'lerini arar.
fn find_clsid_matches_binary(data: &[u8]) -> Vec<(&'static str, &'static str)> {
    let clsids = known_clsids();
    let mut matches = Vec::new();
    for (bytes, cat, label) in clsids {
        if data.windows(16).any(|w| w == bytes.as_slice()) {
            matches.push((*cat, *label));
        }
    }
    matches
}

/// "Xxx.Yyy" veya "Xxx.Yyy.NN" biçimindeki ProgID-şekilli string mi kontrol eder.
/// Gerçek ProgID olmasa da kullanıcıya ham string'i gösterebilmek için kullanılır.
pub fn is_progid_shape(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.len() < 5 || trimmed.len() > 50 { return false; }

    // Dosya uzantısı ile biten şeyler ProgID değildir
    let lower = trimmed.to_lowercase();
    let exts = [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".gif", ".dwg",
                ".dxf", ".exe", ".dll", ".txt", ".pdf", ".doc", ".xls", ".zip",
                ".rar", ".rfa", ".skp"];
    if exts.iter().any(|e| lower.ends_with(e)) { return false; }

    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.len() < 2 || parts.len() > 4 { return false; }

    // İlk segment: uppercase ile başlar, 3-24 alfa-numerik
    let first = parts[0];
    if first.len() < 3 || first.len() > 24 { return false; }
    let mut fc = first.chars();
    let f0 = fc.next().unwrap();
    if !f0.is_ascii_uppercase() { return false; }
    if !fc.all(|c| c.is_ascii_alphanumeric()) { return false; }

    // İkinci segment: uppercase başlar, 3-24 alfa-numerik
    let second = parts[1];
    if second.len() < 3 || second.len() > 24 { return false; }
    let mut sc = second.chars();
    let s0 = sc.next().unwrap();
    if !s0.is_ascii_uppercase() { return false; }
    if !sc.all(|c| c.is_ascii_alphanumeric()) { return false; }

    // 3. ve 4. segmentler (versiyon): alfa-numerik, 1-8 char
    for seg in &parts[2..] {
        if seg.is_empty() || seg.len() > 8 { return false; }
        if !seg.chars().all(|c| c.is_ascii_alphanumeric()) { return false; }
    }
    true
}

/// DWG binary'de OLE2FRAME entity string'inin kaç kez geçtiğini sayar (kaba üst sınır).
fn count_ole_frames_binary(data: &[u8]) -> usize {
    let needle = b"OLE2FRAME";
    data.windows(needle.len()).filter(|w| *w == needle).count()
}

/// Gömülü OLE Compound File (CFBF) imza sayısı — her OLE objesi bir CFBF ile başlar.
/// Genelde OLE2FRAME string sayımından daha güvenilirdir.
#[allow(dead_code)]
pub fn count_cfbf_headers(data: &[u8]) -> usize {
    let magic: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    data.windows(magic.len()).filter(|w| *w == magic).count()
}

/// UTF-16LE Unicode string tarayıcı — tüm BMP yazdırılabilir karakterleri kabul eder
/// (ASCII, Latin Extended, Türkçe İŞĞÜÖÇ dahil CJK-öncesi tüm yazı sistemleri).
/// DWG payload'ları her iki byte hizalamasında da başlayabildiği için offset=0 ve
/// offset=1 olmak üzere iki geçiş yapar. Max-len'e ulaşıldığında mevcut buffer
/// atılmak yerine flush edilir — kısmen yakalanan metinler kaybolmaz.
pub fn extract_dwg_strings_utf16_unicode(data: &[u8], min_len: usize, max_len: usize) -> Vec<String> {
    let mut out = scan_utf16_at_offset(data, 0, min_len, max_len);
    out.extend(scan_utf16_at_offset(data, 1, min_len, max_len));
    out
}

fn scan_utf16_at_offset(data: &[u8], start: usize, min_len: usize, max_len: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current: Vec<u16> = Vec::new();
    let mut i = start;
    while i + 1 < data.len() {
        let code = u16::from_le_bytes([data[i], data[i + 1]]);
        // Yalnızca ASCII + Latin Ext-A/B (Türkçe İŞĞÜÖÇ dahil).
        // CJK ve diğer yazı sistemleri dar tutuldu: DWG'nin şifreli bölümleri
        // rastgele BMP karakterlerine decode oluyor; geniş aralık temiz metni
        // gürültü içinde boğuyordu. Bu aralık Türkçe mimari DWG'ler için yeterli.
        let is_printable = matches!(code,
            0x0020..=0x007E | 0x00A0..=0x024F
        );
        if is_printable {
            current.push(code);
            if current.len() >= max_len {
                flush_utf16(&mut current, min_len, &mut strings);
            }
        } else {
            flush_utf16(&mut current, min_len, &mut strings);
        }
        i += 2;
    }
    flush_utf16(&mut current, min_len, &mut strings);
    strings
}

fn flush_utf16(buf: &mut Vec<u16>, min_len: usize, out: &mut Vec<String>) {
    if buf.len() >= min_len {
        if let Ok(s) = String::from_utf16(buf) {
            let t = s.trim();
            if !t.is_empty() { out.push(t.to_string()); }
        }
    }
    buf.clear();
}

/// UTF-16LE ile kodlanmış ASCII-yazdırılabilir string'leri çıkarır.
/// DWG R2007+ (AC1021+) dosyalarında ProgID/class name genelde UTF-16LE'dir.
pub fn extract_dwg_strings_utf16(data: &[u8], min_len: usize, max_len: usize) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current: Vec<u8> = Vec::new();
    let mut i = 0;
    while i + 1 < data.len() {
        let a = data[i];
        let b = data[i + 1];
        // UTF-16LE içinde ASCII karakter: printable byte + 0x00
        if b == 0 && (a.is_ascii_graphic() || a == b' ' || a == b'_' || a == b'-') {
            current.push(a);
            if current.len() > max_len { current.clear(); }
            i += 2;
        } else {
            if current.len() >= min_len {
                if let Ok(s) = std::str::from_utf8(&current) {
                    let t = s.trim();
                    if !t.is_empty() { strings.push(t.to_string()); }
                }
            }
            current.clear();
            i += 1;
        }
    }
    if current.len() >= min_len {
        if let Ok(s) = std::str::from_utf8(&current) {
            let t = s.trim();
            if !t.is_empty() { strings.push(t.to_string()); }
        }
    }
    strings
}

/// Bir CFBF blob'unun root directory entry'sinden OLE objesinin CLSID'sini çıkarır.
/// CFBF spec: header[30..32] = sector shift (2^shift = sector_size),
/// header[48..52] = first directory sector #. Root entry directory sector'un ilk
/// 128 byte'ı, CLSID offset 80'de 16 byte.
pub fn read_cfbf_root_clsid(data: &[u8], cfbf_start: usize) -> Option<[u8; 16]> {
    if cfbf_start + 52 > data.len() { return None; }
    let ss_bytes = [data[cfbf_start + 30], data[cfbf_start + 31]];
    let sector_shift = u16::from_le_bytes(ss_bytes) as usize;
    if !(9..=14).contains(&sector_shift) { return None; }
    let sector_size = 1usize << sector_shift;

    let dir_bytes = [
        data[cfbf_start + 48], data[cfbf_start + 49],
        data[cfbf_start + 50], data[cfbf_start + 51],
    ];
    let dir_sect = u32::from_le_bytes(dir_bytes) as usize;

    let root_off = cfbf_start.checked_add(dir_sect.checked_add(1)?.checked_mul(sector_size)?)?;
    let clsid_off = root_off.checked_add(80)?;
    if clsid_off + 16 > data.len() { return None; }

    let mut clsid = [0u8; 16];
    clsid.copy_from_slice(&data[clsid_off..clsid_off + 16]);
    if clsid.iter().all(|&b| b == 0) { return None; }
    Some(clsid)
}

/// Her gömülü CFBF'nin root CLSID'sini toplar.
fn extract_cfbf_root_clsids(data: &[u8]) -> Vec<[u8; 16]> {
    let magic: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    let mut result = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        let Some(rel) = data[pos..].windows(8).position(|w| w == magic) else { break; };
        let start = pos + rel;
        if let Some(c) = read_cfbf_root_clsid(data, start) {
            result.push(c);
        }
        pos = start + 8;
    }
    result
}

/// Hex-encoded string'i (boşluk/CR/LF dahil her tür ayraç tolere eder) byte dizisine çevirir.
/// DXF'te group code 310 değerleri hex olarak OLE binary'sini saklar.
pub fn hex_decode(s: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(s.len() / 2);
    let mut high: Option<u8> = None;
    for c in s.chars() {
        let nibble = match c {
            '0'..='9' => c as u8 - b'0',
            'a'..='f' => c as u8 - b'a' + 10,
            'A'..='F' => c as u8 - b'A' + 10,
            _ => continue,
        };
        match high {
            None => high = Some(nibble << 4),
            Some(h) => { out.push(h | nibble); high = None; }
        }
    }
    out
}

/// CLSID byte dizisini insan-okunabilir GUID string'ine çevirir ("00020820-0000-0000-C000-000000000046").
pub fn clsid_to_guid_string(clsid: &[u8; 16]) -> String {
    // İlk 3 grup little-endian, Data4 as-is
    format!(
        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        clsid[3], clsid[2], clsid[1], clsid[0],
        clsid[5], clsid[4],
        clsid[7], clsid[6],
        clsid[8], clsid[9],
        clsid[10], clsid[11], clsid[12], clsid[13], clsid[14], clsid[15]
    )
}

/// DWG binary verisi içinde gömülü OLE objelerini (Excel, Word, PDF, görsel vb.) tespit eder.
/// Her CFBF bir OLE entity olarak sayılır; aynı tür birden fazlaysa "Label × N" gösterilir.
pub fn extract_dwg_ole_objects(data: &[u8]) -> Vec<String> {
    use std::collections::{HashMap, HashSet};

    let ascii_strings = extract_dwg_strings(data, 5, 64);
    let utf16_strings = extract_dwg_strings_utf16(data, 5, 64);

    // ProgID → kategori eşlemesi (detaylı etiket için)
    let mut progid_by_cat: HashMap<&'static str, String> = HashMap::new();
    for s in ascii_strings.iter().chain(utf16_strings.iter()) {
        if let Some((cat, label)) = detect_ole_progid(s) {
            progid_by_cat.insert(cat, label);
        }
    }

    let cfbf_clsids = extract_cfbf_root_clsids(data);
    let mut type_counts: HashMap<String, usize> = HashMap::new();

    if !cfbf_clsids.is_empty() {
        // CFBF yolu — her CFBF bir entity, CLSID'sine göre etiketle
        for cfbf_clsid in &cfbf_clsids {
            let mut label: Option<String> = None;
            for (known_bytes, cat, lbl) in known_clsids() {
                if known_bytes == cfbf_clsid {
                    // Kategoriye denk gelen detaylı ProgID varsa onu tercih et
                    label = Some(progid_by_cat.get(cat).cloned().unwrap_or_else(|| lbl.to_string()));
                    break;
                }
            }
            let display = label.unwrap_or_else(||
                format!("Bilinmeyen CLSID: {{{}}}", clsid_to_guid_string(cfbf_clsid))
            );
            *type_counts.entry(display).or_insert(0) += 1;
        }
    } else {
        // CFBF yok — string + CLSID pattern tabanlı fallback (her kategori 1 entity varsayımı)
        for label in progid_by_cat.values() {
            *type_counts.entry(label.clone()).or_insert(0) += 1;
        }
        let mut matched_cats: HashSet<&'static str> = progid_by_cat.keys().copied().collect();
        for (cat, label) in find_clsid_matches_binary(data) {
            if matched_cats.insert(cat) {
                *type_counts.entry(label.to_string()).or_insert(0) += 1;
            }
        }
        let mut unknown_progids: HashSet<String> = HashSet::new();
        for s in ascii_strings.iter().chain(utf16_strings.iter()) {
            let trimmed = s.trim();
            if detect_ole_progid(trimmed).is_some() { continue; }
            if is_progid_shape(trimmed) {
                unknown_progids.insert(trimmed.to_string());
            }
        }
        for p in &unknown_progids {
            *type_counts.entry(format!("Bilinmeyen: {}", p)).or_insert(0) += 1;
        }
    }

    // "Label × N" formatında satırlara çevir
    let mut entries: Vec<String> = type_counts.iter().map(|(label, count)| {
        if *count > 1 { format!("{} × {}", label, count) } else { label.clone() }
    }).collect();

    // Açıklanamayan entity: OLE2FRAME string sayısı > CFBF sayısı (compressed/wrapped OLE)
    let represented: usize = type_counts.values().sum();
    let ole2frame_count = count_ole_frames_binary(data);
    let total_ole = cfbf_clsids.len().max(ole2frame_count);
    let unaccounted = total_ole.saturating_sub(represented);
    if unaccounted > 0 {
        entries.push(format!("{} Tanımlanamayan OLE objesi", unaccounted));
    }

    entries.sort();
    entries.truncate(50);
    entries
}

/// Extracts drawing properties from DWG's SummaryInfo section.
/// DWG files (R2004+) store document properties in a structured section
/// that contains title, subject, author, keywords, etc.
pub fn extract_dwg_properties(data: &[u8]) -> DwgDrawingProperties {
    let mut props = DwgDrawingProperties::default();

    // SummaryInfo is stored as a sequence of:
    //   codepage(2) + count(4) + [tag(4) + len(4) + string(len)]×N
    // But the exact layout varies by version. We use heuristic scanning:
    // look for known property indicator bytes followed by readable text.

    // Look for strings that appear near "Title", "Subject", "Author", "Keywords" markers
    #[allow(clippy::type_complexity)]
    let markers: &[(&str, fn(&mut DwgDrawingProperties, String))] = &[
        ("Title", |p, v| p.title = Some(v)),
        ("Subject", |p, v| p.subject = Some(v)),
        ("Author", |p, v| p.author = Some(v)),
        ("Keywords", |p, v| p.keywords = Some(v)),
        ("Comments", |p, v| p.comments = Some(v)),
        ("LastSavedBy", |p, v| p.last_saved_by = Some(v)),
    ];

    // Scan for property markers in the binary data
    for (marker, setter) in markers {
        let marker_bytes = marker.as_bytes();
        let upper = data.len().saturating_sub(marker_bytes.len());
        for i in 0..upper {
            if data.get(i..i + marker_bytes.len()) != Some(marker_bytes) {
                continue;
            }
            {
                // Look for the next readable string after the marker
                let search_start = i + marker_bytes.len();
                let search_end = (search_start + 256).min(data.len());
                let nearby_strings = extract_dwg_strings(&data[search_start..search_end], 2, 200);
                if let Some(value) = nearby_strings.into_iter().next() {
                    // Skip if it's another marker name
                    let is_marker = markers.iter().any(|(m, _)| *m == value);
                    if !is_marker && value.len() >= 2 {
                        setter(&mut props, value);
                        break;
                    }
                }
            }
        }
    }

    props
}

/// Attempts to detect the drawing unit and scale from DWG header variables.
pub fn extract_dwg_units(data: &[u8]) -> (Option<String>, Option<String>) {
    let all_strings = extract_dwg_strings(data, 3, 64);

    let mut unit_type = None;
    let mut scale = None;

    // Look for INSUNITS value indicators
    for s in &all_strings {
        let upper = s.to_uppercase();
        // Scale patterns
        if upper.starts_with("1/") || upper.starts_with("1:") {
            scale = Some(s.clone());
        }
        // Unit patterns
        if upper == "MILLIMETERS" || upper == "MM" { unit_type = Some("Milimetre".to_string()); }
        if upper == "CENTIMETERS" || upper == "CM" { unit_type = Some("Santimetre".to_string()); }
        if upper == "METERS" || upper == "M" && s.len() <= 2 { unit_type = Some("Metre".to_string()); }
    }

    (unit_type, scale)
}

// ─────────────────────────────────────────────────────────────────────────────
// ODAFileConverter discovery & DWG→DXF conversion
// ─────────────────────────────────────────────────────────────────────────────

/// Searches the Windows registry for ODAFileConverter installation path.
#[cfg(target_os = "windows")]
fn find_oda_in_registry() -> Option<PathBuf> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

    // 1. ODA'nın kendi registry anahtarları
    let reg_paths = [
        r"SOFTWARE\Open Design Alliance\ODAFileConverter",
        r"SOFTWARE\WOW6432Node\Open Design Alliance\ODAFileConverter",
        r"SOFTWARE\ODA\ODAFileConverter",
        r"SOFTWARE\WOW6432Node\ODA\ODAFileConverter",
    ];

    for reg_path in &reg_paths {
        if let Ok(key) = hklm.open_subkey_with_flags(reg_path, KEY_READ) {
            for value_name in &["InstallPath", "Path", "InstallDir", "InstallLocation", ""] {
                if let Ok(val) = key.get_value::<String, _>(value_name) {
                    let candidate = PathBuf::from(&val).join("ODAFileConverter.exe");
                    if candidate.is_file() {
                        return Some(candidate);
                    }
                    let direct = PathBuf::from(&val);
                    if direct.is_file() && direct.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
                        return Some(direct);
                    }
                }
            }
            // Sürüm numarası içeren alt anahtarlar (ör. "25.12")
            for subkey_name in key.enum_keys().filter_map(Result::ok) {
                if let Ok(subkey) = key.open_subkey_with_flags(&subkey_name, KEY_READ) {
                    for value_name in &["InstallPath", "Path", "InstallDir", "InstallLocation", ""] {
                        if let Ok(val) = subkey.get_value::<String, _>(value_name) {
                            let candidate = PathBuf::from(&val).join("ODAFileConverter.exe");
                            if candidate.is_file() {
                                return Some(candidate);
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. Windows Uninstall kayıtları — çoğu installer buraya yazar
    let uninstall_roots = [
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    for uninstall_root in &uninstall_roots {
        if let Ok(root_key) = hklm.open_subkey_with_flags(uninstall_root, KEY_READ) {
            for subkey_name in root_key.enum_keys().filter_map(Result::ok) {
                // ODA veya ODAFileConverter içeren kayıtlar
                let name_lower = subkey_name.to_lowercase();
                if !name_lower.contains("oda") {
                    continue;
                }
                if let Ok(subkey) = root_key.open_subkey_with_flags(&subkey_name, KEY_READ) {
                    // DisplayName ile de doğrula
                    let display_name: String = subkey
                        .get_value("DisplayName")
                        .unwrap_or_default();
                    let dn_lower = display_name.to_lowercase();
                    if !dn_lower.contains("oda") && !dn_lower.contains("file converter") {
                        continue;
                    }
                    // InstallLocation → doğrudan klasör
                    if let Ok(loc) = subkey.get_value::<String, _>("InstallLocation") {
                        let candidate = PathBuf::from(&loc).join("ODAFileConverter.exe");
                        if candidate.is_file() {
                            return Some(candidate);
                        }
                    }
                    // DisplayIcon → genellikle exe yolu içerir
                    if let Ok(icon) = subkey.get_value::<String, _>("DisplayIcon") {
                        // "C:\Program Files\ODA\...\ODAFileConverter.exe,0" formatı olabilir
                        let icon_path = icon.split(',').next().unwrap_or("").trim();
                        let p = PathBuf::from(icon_path);
                        if p.is_file() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")) {
                            return Some(p);
                        }
                    }
                }
            }
        }
    }

    None
}

#[cfg(not(target_os = "windows"))]
fn find_oda_in_registry() -> Option<PathBuf> {
    None
}

/// Searches known default installation paths for ODAFileConverter.
/// First dynamically scans Program Files\ODA\ for any version subdirectory,
/// then falls back to hardcoded version-specific paths.
fn find_oda_in_default_paths() -> Option<PathBuf> {
    // Dynamic scan: look inside C:\Program Files\ODA\ and C:\Program Files (x86)\ODA\
    // for any subdirectory that contains ODAFileConverter.exe.
    // This handles any version without hardcoding year numbers.
    let oda_roots = [
        r"C:\Program Files\ODA",
        r"C:\Program Files (x86)\ODA",
    ];

    for root_str in &oda_roots {
        let root = PathBuf::from(root_str);
        if let Ok(entries) = std::fs::read_dir(&root) {
            // Collect and sort descending so the newest version wins
            let mut subdirs: Vec<PathBuf> = entries
                .filter_map(Result::ok)
                .filter(|e| e.file_type().is_ok_and(|ft| ft.is_dir()))
                .map(|e| e.path())
                .collect();
            subdirs.sort_by(|a, b| b.cmp(a));

            for subdir in &subdirs {
                let exe = subdir.join("ODAFileConverter.exe");
                if exe.is_file() {
                    return Some(exe);
                }
            }
        }

        // Also check root itself (some installers place exe directly under ODA\)
        let direct = root.join("ODAFileConverter.exe");
        if direct.is_file() {
            return Some(direct);
        }
    }

    // Hardcoded fallback for versions not covered by directory scan
    let candidates = [
        r"C:\Program Files\ODA\ODAFileConverter\ODAFileConverter.exe",
        r"C:\Program Files (x86)\ODA\ODAFileConverter\ODAFileConverter.exe",
    ];
    for path_str in &candidates {
        let p = PathBuf::from(path_str);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

/// Searches PATH environment variable for ODAFileConverter.
fn find_oda_in_path() -> Option<PathBuf> {
    if let Ok(path_var) = std::env::var("PATH") {
        let separator = if cfg!(windows) { ';' } else { ':' };
        for dir in path_var.split(separator) {
            let candidate = PathBuf::from(dir).join("ODAFileConverter.exe");
            if candidate.is_file() {
                return Some(candidate);
            }
            // Also try without .exe (Linux/macOS)
            let candidate2 = PathBuf::from(dir).join("ODAFileConverter");
            if candidate2.is_file() {
                return Some(candidate2);
            }
        }
    }
    None
}

/// Returns the path to ODAFileConverter, using cached result.
/// Checks manual override first, then auto-detected path.
pub(crate) fn get_oda_converter_path() -> Option<PathBuf> {
    // Check manual override first
    if let Ok(guard) = ODA_CONVERTER_MANUAL.lock() {
        if let Some(ref manual) = *guard {
            return manual.clone();
        }
    }

    // Auto-detect (cached)
    let cached = ODA_CONVERTER_PATH.get_or_init(|| {
        log::info!("ODAFileConverter otomatik aranıyor...");

        // 1. Registry
        if let Some(p) = find_oda_in_registry() {
            log::info!("ODAFileConverter registry'de bulundu: {}", p.display());
            return Some(p);
        }

        // 2. Default paths
        if let Some(p) = find_oda_in_default_paths() {
            log::info!("ODAFileConverter varsayılan yolda bulundu: {}", p.display());
            return Some(p);
        }

        // 3. PATH environment
        if let Some(p) = find_oda_in_path() {
            log::info!("ODAFileConverter PATH'te bulundu: {}", p.display());
            return Some(p);
        }

        log::info!("ODAFileConverter bulunamadı — raw binary scan fallback kullanılacak");
        None
    });

    cached.clone()
}

/// Converts a DWG file to DXF using ODAFileConverter, returns path to the temporary DXF file.
/// Caller is responsible for cleaning up the returned temp directory.
pub(crate) fn convert_dwg_to_dxf(dwg_path: &str, oda_exe: &Path) -> Result<(PathBuf, PathBuf), String> {
    use std::process::Command;

    let dwg = Path::new(dwg_path);
    if !dwg.is_file() {
        return Err(format!("DWG dosyası bulunamadı: {}", dwg_path));
    }

    // Create unique temp directories for input and output
    let temp_base = std::env::temp_dir();
    let random_suffix: u64 = {
        use std::time::{SystemTime, UNIX_EPOCH};
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0)
    };
    let input_dir = temp_base.join(format!("oda_in_{}", random_suffix));
    let output_dir = temp_base.join(format!("oda_out_{}", random_suffix));

    fs::create_dir_all(&input_dir).map_err(|e| format!("Temp input dizini oluşturulamadı: {}", e))?;
    fs::create_dir_all(&output_dir).map_err(|e| format!("Temp output dizini oluşturulamadı: {}", e))?;

    // Copy DWG to input dir
    let dwg_filename = dwg.file_name().ok_or("DWG dosya adı alınamadı")?;
    let temp_dwg = input_dir.join(dwg_filename);
    fs::copy(dwg, &temp_dwg).map_err(|e| format!("DWG kopyalanamadı: {}", e))?;

    // Run ODAFileConverter
    // Args: input_folder output_folder output_version output_type recurse audit
    //
    // ODA File Converter Qt tabanlı bir GUI uygulamasıdır; komut satırı argümanlarıyla
    // çağrılsa bile penceresini açar ve odak çalar. Kullanıcı için "panik" yaratıyor.
    // Windows'ta PowerShell Start-Process ile -WindowStyle Hidden kullanarak ODA'yı tamamen
    // görünmez (taskbar'da bile yok) başlatıyoruz. -PassThru + -Wait + exit $p.ExitCode
    // child sürecin exit code'unu PowerShell'in (ve dolayısıyla bizim status check'imizin)
    // exit code'una propaga ediyor.
    #[cfg(windows)]
    let result = {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // PowerShell tek tırnaklı string literal: ' karakterini '' ile escape et
        let q = |s: &str| format!("'{}'", s.replace('\'', "''"));
        let ps_cmd = format!(
            "$p = Start-Process -FilePath {} -ArgumentList {},{},{},{},{},{} -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode",
            q(&oda_exe.to_string_lossy()),
            q(&input_dir.to_string_lossy()),
            q(&output_dir.to_string_lossy()),
            q("ACAD2018"),
            q("DXF"),
            q("0"),
            q("1"),
        );

        Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &ps_cmd])
            .creation_flags(CREATE_NO_WINDOW) // PowerShell wrapper'ın konsol penceresini de gizle
            .output()
    };

    #[cfg(not(windows))]
    let result = Command::new(oda_exe)
        .arg(input_dir.to_string_lossy().as_ref())
        .arg(output_dir.to_string_lossy().as_ref())
        .arg("ACAD2018")
        .arg("DXF")
        .arg("0")
        .arg("1")
        .output();

    let result = result.map_err(|e| format!("ODAFileConverter çalıştırılamadı: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        // Clean up input dir
        let _ = fs::remove_dir_all(&input_dir);
        let _ = fs::remove_dir_all(&output_dir);
        return Err(format!("ODAFileConverter hata kodu: {} — {}", result.status, stderr));
    }

    // Find .dxf file in output directory
    let dxf_path = fs::read_dir(&output_dir)
        .map_err(|e| format!("Output dizini okunamadı: {}", e))?
        .filter_map(Result::ok)
        .find(|entry| {
            entry.path().extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("dxf"))
        })
        .map(|entry| entry.path());

    // Clean up input dir (output dir will be cleaned up by caller after parsing)
    let _ = fs::remove_dir_all(&input_dir);

    match dxf_path {
        Some(dxf) => Ok((dxf, output_dir)),
        None => {
            let _ = fs::remove_dir_all(&output_dir);
            Err("ODAFileConverter çıktısında DXF dosyası bulunamadı".to_string())
        }
    }
}

/// Raw binary scan fallback for DWG metadata extraction.
fn extract_dwg_metadata_raw(data: &[u8], path: &str) -> DwgExtractedMetadata {
    let version = get_dwg_version(data);
    let layers = extract_dwg_layers(data);
    let block_names = extract_dwg_blocks(data);
    let text_contents = extract_dwg_texts(data);
    let xref_names = extract_dwg_xrefs(data);
    let image_refs = extract_dwg_image_refs(data);
    let ole_objects = extract_dwg_ole_objects(data);
    let drawing_properties = extract_dwg_properties(data);
    let (unit_type, estimated_scale) = extract_dwg_units(data);

    log::info!(
        "DWG metadata extracted (raw scan): {:?} version, {} layers, {} blocks, {} texts, {} xrefs, {} imgs, {} ole - {}",
        version, layers.len(), block_names.len(), text_contents.len(), xref_names.len(), image_refs.len(), ole_objects.len(), path
    );

    DwgExtractedMetadata {
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
    }
}

/// Tauri command: set ODA converter path from frontend settings.
#[tauri::command]
pub fn set_oda_converter_path(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if let Ok(mut guard) = ODA_CONVERTER_MANUAL.lock() {
        if trimmed.is_empty() {
            // Clear manual override → fall back to auto-detect
            *guard = None;
            log::info!("ODA converter manual path temizlendi");
        } else {
            let p = PathBuf::from(trimmed);
            if p.is_file() {
                log::info!("ODA converter manual path set edildi: {}", p.display());
                *guard = Some(Some(p));
            } else {
                return Err(format!("Dosya bulunamadı: {}", trimmed));
            }
        }
        Ok(())
    } else {
        Err("ODA converter kilit alınamadı".to_string())
    }
}

/// Tauri command: get current ODA converter path (manual or auto-detected).
#[tauri::command]
pub fn get_oda_converter_path_cmd() -> Option<String> {
    get_oda_converter_path().map(|p| p.to_string_lossy().to_string())
}

/// Tauri command: auto-detect ODA converter and return path if found.
#[tauri::command]
pub fn detect_oda_converter() -> Option<String> {
    // Force fresh detection ignoring cache — check registry, paths, PATH
    if let Some(p) = find_oda_in_registry() {
        return Some(p.to_string_lossy().to_string());
    }
    if let Some(p) = find_oda_in_default_paths() {
        return Some(p.to_string_lossy().to_string());
    }
    if let Some(p) = find_oda_in_path() {
        return Some(p.to_string_lossy().to_string());
    }
    None
}

/// Tauri command: attempt to install ODA FileConverter from bundled installer, then winget, then download page.
/// Returns "installed_bundled" | "installed_winget" | "opened_download_page".
#[tauri::command]
pub async fn install_oda_converter(app_handle: tauri::AppHandle) -> Result<String, String> {
    // 1. Try bundled installer first
    match install_bundled_oda_inner(&app_handle).await {
        Ok(_) => {
            log::info!("ODA FileConverter bundled installer ile başarıyla kuruldu");
            refresh_oda_path_cache();
            return Ok("installed_bundled".into());
        }
        Err(e) => {
            log::info!("Bundled ODA installer kullanılamadı: {}", e);
        }
    }

    // 2. Try winget (available by default on Windows 10/11)
    let winget_result = tauri::async_runtime::spawn_blocking(|| {
        std::process::Command::new("winget")
            .args([
                "install",
                "--id",
                "OpenDesignAlliance.ODAFileConverter",
                "--silent",
                "--accept-package-agreements",
                "--accept-source-agreements",
            ])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?;

    match winget_result {
        Ok(output) if output.status.success() => {
            log::info!("ODA FileConverter winget ile başarıyla kuruldu");
            refresh_oda_path_cache();
            Ok("installed_winget".into())
        }
        _ => {
            // winget failed — caller should prompt user to select installer locally
            log::info!("winget kurulumu başarısız, yerel yükleyici seçimi gerekiyor");
            Ok("no_installer".into())
        }
    }
}

/// Kurulum sonrası ODA yolunu yeniden ara ve ODA_CONVERTER_MANUAL'a yaz.
/// ODA_CONVERTER_PATH bir OnceLock olduğundan kurulum sonrası güncellenmez;
/// bu fonksiyon manual override'ı set ederek app yeniden başlatmadan ODA'nın
/// kullanılmasını sağlar.
fn refresh_oda_path_cache() {
    // msiexec kısa gecikmeli tamamlanabileceğinden önce kısa süre bekle
    std::thread::sleep(std::time::Duration::from_millis(1500));

    let found = find_oda_in_registry()
        .or_else(find_oda_in_default_paths)
        .or_else(find_oda_in_path);

    if let Ok(mut guard) = ODA_CONVERTER_MANUAL.lock() {
        if let Some(ref p) = found {
            log::info!("ODA yolu cache güncellendi: {}", p.display());
            *guard = Some(Some(p.clone()));
        } else {
            log::warn!("Kurulum sonrası ODA hâlâ bulunamadı — kullanıcı yeniden başlatmalı");
        }
    }

    // ODA installer masaüstü kısayolu oluşturur — kurulum sonrası temizle
    cleanup_oda_desktop_shortcuts();
}

/// ODA installer'ın masaüstüne bıraktığı kısayolları siler.
fn cleanup_oda_desktop_shortcuts() {
    let desktop_dirs: Vec<PathBuf> = [
        std::env::var("USERPROFILE").ok().map(|p| PathBuf::from(p).join("Desktop")),
        std::env::var("PUBLIC").ok().map(|p| PathBuf::from(p).join("Desktop")),
    ]
    .into_iter()
    .flatten()
    .filter(|p| p.is_dir())
    .collect();

    for desktop in &desktop_dirs {
        if let Ok(entries) = std::fs::read_dir(desktop) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                let name = path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_lowercase();
                if name.contains("odafileconverter") || name.contains("oda file converter") {
                    match std::fs::remove_file(&path) {
                        Ok(_) => log::info!("ODA masaüstü kısayolu silindi: {}", path.display()),
                        Err(e) => log::warn!("ODA kısayolu silinemedi: {} — {}", path.display(), e),
                    }
                }
            }
        }
    }
}

/// Internal helper: try to run the bundled ODA installer from the app resources directory.
async fn install_bundled_oda_inner(app_handle: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let resource_dir = app_handle.path().resource_dir()
        .map_err(|e| format!("Resource dizini alınamadı: {}", e))?;

    // Look for oda_installer.msi first, then oda_installer.exe in resources/
    let resources = resource_dir.join("resources");
    let installer_path = {
        let msi = resources.join("oda_installer.msi");
        let exe = resources.join("oda_installer.exe");
        if msi.exists() {
            msi
        } else if exe.exists() {
            exe
        } else {
            return Err("Bundled ODA installer bulunamadı".into());
        }
    };

    log::info!("Bundled ODA installer bulundu: {:?}", installer_path);

    let is_msi = installer_path.extension()
        .map(|e| e.eq_ignore_ascii_case("msi"))
        .unwrap_or(false);
    let path = installer_path.clone();

    let output = tauri::async_runtime::spawn_blocking(move || {
        if is_msi {
            // MSI formatı: msiexec ile sessiz kurulum
            std::process::Command::new("msiexec")
                .args(["/i", path.to_str().unwrap_or(""), "/quiet", "/norestart"])
                .output()
        } else {
            // EXE formatı: NSIS veya InnoSetup
            let result = std::process::Command::new(&path)
                .arg("/S")
                .output();
            match result {
                Ok(o) if o.status.success() => Ok(o),
                _ => {
                    log::info!("NSIS /S başarısız, InnoSetup /VERYSILENT deneniyor");
                    std::process::Command::new(&path)
                        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
                        .output()
                }
            }
        }
    })
    .await
    .map_err(|e| format!("Spawn hatası: {}", e))?
    .map_err(|e| format!("Installer çalıştırılamadı: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        Err(format!("Installer başarısız: exit code {:?}", output.status.code()))
    }
}

/// Tauri command: install ODA FileConverter from bundled installer only.
/// Returns "installed_bundled" on success.
#[tauri::command]
pub async fn install_bundled_oda(app_handle: tauri::AppHandle) -> Result<String, String> {
    install_bundled_oda_inner(&app_handle).await?;
    log::info!("ODA FileConverter bundled installer ile başarıyla kuruldu");
    Ok("installed_bundled".into())
}

/// Tauri command: run a locally selected ODA installer.
/// Supports both .exe (NSIS /S → InnoSetup /VERYSILENT fallback) and .msi (msiexec /passive).
/// Returns "installed" on success or an error string.
#[tauri::command]
pub async fn run_local_oda_installer(path: String) -> Result<String, String> {
    let path_clone = path.clone();
    let is_msi = path.to_lowercase().ends_with(".msi");

    let output = tauri::async_runtime::spawn_blocking(move || {
        if is_msi {
            // /passive = progress bar gösterir + UAC yükseltme tetikler
            // /quiet ile UAC tetiklenmez ve kurulum sessizce başarısız olur
            log::info!("MSI installer çalıştırılıyor (msiexec /passive): {}", path_clone);
            std::process::Command::new("msiexec")
                .args(["/i", &path_clone, "/passive", "/norestart"])
                .output()
        } else {
            // EXE: önce NSIS (/S), başarısız olursa InnoSetup (/VERYSILENT) dene
            log::info!("EXE installer çalıştırılıyor (NSIS /S): {}", path_clone);
            let result = std::process::Command::new(&path_clone)
                .arg("/S")
                .output();
            match result {
                Ok(o) if o.status.success() => Ok(o),
                _ => {
                    log::info!("NSIS /S başarısız, InnoSetup /VERYSILENT deneniyor: {}", path_clone);
                    std::process::Command::new(&path_clone)
                        .args(["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"])
                        .output()
                }
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("Yükleyici çalıştırılamadı: {}", e))?;

    if output.status.success() {
        log::info!("ODA FileConverter yerel yükleyici ile başarıyla kuruldu: {}", path);
        refresh_oda_path_cache();
        Ok("installed".into())
    } else {
        let code = output.status.code().unwrap_or(-1);
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        log::error!("ODA installer başarısız — exit: {}, stderr: {}, stdout: {}", code, stderr, stdout);
        Err(format!("Kurulum başarısız (exit code: {}): {}", code, stderr))
    }
}

/// Tauri command: check if bundled ODA installer exists in resources.
#[tauri::command]
pub fn check_bundled_oda(app_handle: tauri::AppHandle) -> bool {
    use tauri::Manager;
    app_handle.path().resource_dir()
        .map(|d| {
            let r = d.join("resources");
            r.join("oda_installer.msi").exists() || r.join("oda_installer.exe").exists()
        })
        .unwrap_or(false)
}

#[tauri::command]
pub fn extract_dwg_metadata(path: String) -> Result<DwgExtractedMetadata, String> {
    log::info!("DWG deep metadata extraction başladı: {}", path);

    let file_size = fs::metadata(&path).map_err(|e| e.to_string())?.len();

    // Read first 6 bytes for version detection (works for any file size)
    let dwg_version = {
        let mut hdr = [0u8; 6];
        if let Ok(mut f) = fs::File::open(&path) {
            use std::io::Read;
            let _ = f.read_exact(&mut hdr);
        }
        get_dwg_version(&hdr)
    };

    // Skip very large files (>200MB) to avoid memory issues
    if file_size > 200 * 1024 * 1024 {
        log::info!("DWG çok büyük (>200MB), metadata atlandı: {}", path);
        return Ok(DwgExtractedMetadata {
            version: dwg_version,
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

    // Try ODA converter first (DWG → DXF → parse)
    if let Some(oda_exe) = get_oda_converter_path() {
        log::info!("ODAFileConverter ile DWG→DXF dönüşümü deneniyor: {}", path);
        match convert_dwg_to_dxf(&path, &oda_exe) {
            Ok((dxf_path, output_dir)) => {
                let dxf_str = dxf_path.to_string_lossy().to_string();
                let result = crate::dxf_parse::extract_dxf_metadata(dxf_str);
                // Clean up temp output directory
                let _ = fs::remove_dir_all(&output_dir);
                match result {
                    Ok(mut metadata) => {
                        metadata.version = dwg_version;  // inject version from original DWG header
                        log::info!(
                            "DWG metadata extracted (ODA→DXF): {:?} version, {} layers, {} blocks, {} texts, {} xrefs - {}",
                            metadata.version, metadata.layers.len(), metadata.block_names.len(),
                            metadata.text_contents.len(), metadata.xref_names.len(), path
                        );
                        return Ok(metadata);
                    }
                    Err(e) => {
                        log::warn!("ODA DXF parse başarısız, raw scan'e düşülüyor: {} — {}", path, e);
                    }
                }
            }
            Err(e) => {
                log::warn!("ODA dönüşüm başarısız, raw scan'e düşülüyor: {} — {}", path, e);
            }
        }
    }

    // Fallback: raw binary scan
    let data = fs::read(&path).map_err(|e| e.to_string())?;

    if data.len() < 0x20 || &data[0..2] != b"AC" {
        return Err("Geçersiz DWG dosyası".to_string());
    }

    Ok(extract_dwg_metadata_raw(&data, &path))
}

/// Converts a DWG Julian Day Number (u32 days + u32 ms since midnight) to ISO date string.
pub fn dwg_julian_to_iso(jd: u32, ms: u32) -> Option<String> {
    // Julian Day 2440588 = Unix epoch (Jan 1, 1970 00:00:00 UTC)
    if !(2415021..=2500000).contains(&jd) { return None; } // sanity: year range ~1900-2132
    if ms >= 86_400_000 { return None; }
    let days_since_epoch = (jd as i64) - 2_440_588;
    let total_secs = days_since_epoch * 86400 + (ms as i64 / 1000);
    chrono::DateTime::from_timestamp(total_secs, 0)
        .map(|dt| dt.to_rfc3339())
}

/// Scans a byte slice for DWG Julian Date pairs (u32 JD + u32 ms), returns first valid date.
/// DWG stores TDCREATE/TDUPDATE as two consecutive LE u32 values.
pub fn scan_dwg_julian(data: &[u8], from: usize, to: usize) -> Option<String> {
    let end = to.min(data.len().saturating_sub(7));
    for i in from..end {
        if i + 8 > data.len() { break; }
        let jd = u32::from_le_bytes([data[i], data[i+1], data[i+2], data[i+3]]);
        let ms = u32::from_le_bytes([data[i+4], data[i+5], data[i+6], data[i+7]]);
        // Valid JD range: Jan 1 1980 – Jan 1 2040 (2444239 – 2466161)
        if (2_444_239..=2_466_161).contains(&jd) && ms < 86_400_000 {
            if let Some(iso) = dwg_julian_to_iso(jd, ms) {
                return Some(iso);
            }
        }
    }
    None
}

/// Extracts the internal drawing creation date (TDCREATE) from a DWG file.
/// The variable is stored as two LE u32 values (Julian Day + ms since midnight)
/// inside the header variables section.
#[tauri::command]
pub fn get_dwg_creation_date(path: String) -> Result<Option<String>, String> {
    let data = fs::read(&path).map_err(|e| e.to_string())?;
    if data.len() < 0x20 || &data[0..2] != b"AC" { return Ok(None); }

    let version_code = &data[2..6];

    // For R2000 (AC1015): section locators start at 0x15.
    // Locator layout: type(1) + seek(4) + size(4) = 9 bytes.
    // Type 0 = header variables section → its seek is at bytes 0x16–0x19.
    let scan_start = match version_code {
        b"1015" => {
            if data.len() > 0x1A {
                let seek = u32::from_le_bytes([data[0x16], data[0x17], data[0x18], data[0x19]]) as usize;
                // Header section starts with 16-byte sentinel + 4-byte size, then bitcoded vars
                if seek > 0 && seek + 20 < data.len() { seek + 20 } else { 0x100 }
            } else { 0x100 }
        }
        // For R14 (AC1014) the layout is similar to R2000
        b"1014" => {
            if data.len() > 0x1A {
                let seek = u32::from_le_bytes([data[0x16], data[0x17], data[0x18], data[0x19]]) as usize;
                if seek > 0 && seek + 20 < data.len() { seek + 20 } else { 0x100 }
            } else { 0x100 }
        }
        // R2004+ (AC1018+): use a general scan from 0x100
        _ => 0x100,
    };

    let scan_end = scan_start + 65536;
    log::debug!("DWG creation date scan: version={}, from=0x{:X}", std::str::from_utf8(&data[0..6]).unwrap_or("?"), scan_start);
    Ok(scan_dwg_julian(&data, scan_start, scan_end))
}

// ─────────────────────────────────────────────────────────────────────────────
// DWG R2004 (AC1018+) LZ77 Decompression
// ─────────────────────────────────────────────────────────────────────────────

// TODO: R2004+ (AC1018+) DWG layer extraction — LibreDWG entegrasyonu gerekiyor.
// Mevcut binary scan R2004+ dosyalarda layer isimlerini çıkaramaz çünkü
// section verileri şifreli (XOR+LCG) ve sıkıştırılmış (LZ77 variant).

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_strings_basic() {
        let data = b"Hello World\x00Test";
        let result = extract_dwg_strings(data, 3, 256);
        assert_eq!(result, vec!["Hello World".to_string(), "Test".to_string()]);
    }

    #[test]
    fn test_extract_strings_min_length() {
        let data = b"AB\x00CDEF\x00";
        let result = extract_dwg_strings(data, 3, 256);
        // "AB" is too short (min_len=3), "CDEF" passes
        assert_eq!(result, vec!["CDEF".to_string()]);
    }

    #[test]
    fn test_extract_strings_max_length() {
        let data = b"ABCDEFGHIJ\x00Short\x00";
        let result = extract_dwg_strings(data, 2, 5);
        // When current exceeds max_len=5, it gets cleared. But remaining chars
        // after clear may form new strings. "Short" definitely passes.
        assert!(result.contains(&"Short".to_string()));
        // No single string should exceed max_len
        for s in &result {
            assert!(s.len() <= 5, "String '{}' exceeds max_len", s);
        }
    }

    #[test]
    fn test_extract_strings_non_ascii_terminates() {
        let data = b"Good\x80Bad\x00OK";
        let result = extract_dwg_strings(data, 2, 256);
        // 0x80 terminates "Good", "Bad" starts after, null terminates "Bad", "OK" at end
        assert!(result.contains(&"Good".to_string()));
        assert!(result.contains(&"Bad".to_string()));
    }

    #[test]
    fn test_extract_strings_empty_input() {
        let data = b"";
        let result = extract_dwg_strings(data, 1, 256);
        assert!(result.is_empty());
    }

    #[test]
    fn test_extract_strings_allows_dash_underscore_space() {
        let data = b"hello-world_test foo\x00";
        let result = extract_dwg_strings(data, 3, 256);
        assert_eq!(result, vec!["hello-world_test foo".to_string()]);
    }

    #[test]
    fn test_utf16_unicode_extracts_turkish_at_odd_offset() {
        // DWG R2007+ MTEXT'leri UTF-16LE olarak ve bazen odd offset'te saklar.
        // "GİRESUN" tam olarak şu pattern — encoding önemsenmeli.
        let mut data = vec![0xFFu8, 0x00]; // odd offset'e it
        let text = "GİRESUN";
        for c in text.encode_utf16() {
            data.extend_from_slice(&c.to_le_bytes());
        }
        data.extend_from_slice(&[0x00, 0x00, 0xFF]);
        let result = extract_dwg_strings_utf16_unicode(&data, 4, 200);
        assert!(result.iter().any(|s| s.contains("GİRESUN")),
            "GİRESUN should be extracted at odd offset, got: {:?}", result);
    }

    #[test]
    fn test_utf16_mleader_mtext_format_extracted() {
        // MLEADER entity'leri (Arial/TrueType font) metni DWG R2007+'da UTF-16LE olarak
        // MTEXT format string ile saklar: {\fArial|b0|i0|c162;GİRESUN}
        // scan_utf16_at_offset bu formatı bütün olarak yakalayıp strip_mtext_codes
        // ile "GİRESUN"'a indirgeyebilmeli.
        let text = "{\\fArial|b0|i0|c162;G\u{0130}RESUN}";
        let mut data = vec![0x00u8; 4]; // DWG length-prefix benzeri non-printable önek
        for c in text.encode_utf16() {
            data.extend_from_slice(&c.to_le_bytes());
        }
        data.extend_from_slice(&[0x00, 0x00]); // terminator
        let texts = extract_dwg_texts(&data);
        assert!(texts.iter().any(|s| s == "GİRESUN"),
            "MLEADER MTEXT format (UTF-16LE) should yield GİRESUN, got: {:?}", texts);
    }

    #[test]
    fn test_extract_strings_cp1254_giresun() {
        // CP1254 (Windows-1254) kodlamalı MTEXT: İ = 0xDD.
        // Bu encoding MLEADER/MTEXT entity'lerinde \c162 (Turkish charset) belirtilince görülür.
        // extract_dwg_strings cp1254_fallback ile İ'yi doğru decode etmeli.
        let mtext_cp1254: Vec<u8> = b"{\\fArial|b0|i0|c162;G\xDDRESUN}".to_vec();
        let raw = extract_dwg_strings(&mtext_cp1254, 4, 200);
        // Ham string bölünmeden tek parça olarak alınmalı
        let full = raw.iter().any(|s| s.contains("GİRESUN") || (s.contains('G') && s.contains("RESUN")));
        assert!(full, "CP1254 İ (0xDD) string'i bölmemeli, got: {:?}", raw);

        // extract_dwg_texts de MTEXT stripping ile GİRESUN vermeli
        let texts = extract_dwg_texts(&mtext_cp1254);
        assert!(texts.iter().any(|s| s == "GİRESUN"),
            "CP1254 MTEXT GİRESUN extract_dwg_texts'ten çıkmalı, got: {:?}", texts);
    }

    #[test]
    fn test_extract_strings_cp1254_all_turkish_chars() {
        // Tüm sorunlu CP1254 Türkçe karakterler: İ Ş Ğ ğ ı ş Ç Ö Ü ç ö ü
        // ASCII bağlamında (non-continuation byte ile yanyana) doğru decode edilmeli.
        let cases: &[(&[u8], &str)] = &[
            (b"G\xDDRESUN",  "GİRESUN"),   // İ=0xDD
            (b"KO\xDEEY",    "KOŞEY"),     // Ş=0xDE  (KÖŞEY)
            (b"\xD0EVRE",    "ĞEVRE"),     // Ğ=0xD0
            (b"MA\xE7",      "MAç"),       // ç=0xE7 (küçük)
            (b"ba\xF0",      "bağ"),       // ğ=0xF0  (bağ)
            (b"k\xFDl\xFE",  "kılş"),      // ı=0xFD, ş=0xFE
        ];
        for (bytes, expected) in cases {
            let raw = extract_dwg_strings(bytes, 2, 200);
            let found = raw.iter().any(|s| s.contains(expected) || s == expected);
            assert!(found, "CP1254 '{}' tespit edilemedi, got: {:?}", expected, raw);
        }
    }

    #[test]
    fn test_strip_mtext_codes_preserves_turkish() {
        let input = "{\\fArial|b0|i0|c162;GİRESUN}";
        assert_eq!(strip_mtext_codes(input), "GİRESUN");
    }

    #[test]
    fn test_strip_mtext_codes_paragraph_break() {
        let input = "{\\H2.5;Line1\\PLine2}";
        assert_eq!(strip_mtext_codes(input), "Line1 Line2");
    }

    #[test]
    fn test_strip_mtext_codes_no_codes_unchanged() {
        let input = "plain text";
        assert_eq!(strip_mtext_codes(input), "plain text");
    }

    // ═══════════════════════════════════════════════════════════
    // get_dwg_version — Tüm DWG versiyon kodları
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_get_dwg_version_all_codes() {
        let cases = [
            (b"AC1006", "R10"),
            (b"AC1009", "R11 / R12"),
            (b"AC1012", "R13"),
            (b"AC1014", "R14"),
            (b"AC1015", "AutoCAD 2000"),
            (b"AC1018", "AutoCAD 2004"),
            (b"AC1021", "AutoCAD 2007"),
            (b"AC1024", "AutoCAD 2010"),
            (b"AC1027", "AutoCAD 2013"),
            (b"AC1032", "AutoCAD 2018"),
            (b"AC1035", "AutoCAD 2023"),
            (b"AC1036", "AutoCAD 2024"),
        ];
        for (code, expected) in &cases {
            let mut data = code.to_vec();
            data.extend_from_slice(&[0u8; 100]); // padding
            assert_eq!(
                get_dwg_version(&data).as_deref(),
                Some(*expected),
                "Code {:?} should map to {}",
                std::str::from_utf8(*code).unwrap(),
                expected
            );
        }
    }

    #[test]
    fn test_get_dwg_version_unknown_code() {
        assert_eq!(get_dwg_version(b"AC9999______"), None);
    }

    #[test]
    fn test_get_dwg_version_too_short() {
        assert_eq!(get_dwg_version(b"AC10"), None);
        assert_eq!(get_dwg_version(b""), None);
    }

    #[test]
    fn test_get_dwg_version_non_utf8() {
        assert_eq!(get_dwg_version(&[0xFF, 0xFE, 0x00, 0x01, 0x02, 0x03]), None);
    }

    // ═══════════════════════════════════════════════════════════
    // hex_decode
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_hex_decode_basic() {
        assert_eq!(hex_decode("48656c6c6f"), b"Hello");
    }

    #[test]
    fn test_hex_decode_uppercase() {
        assert_eq!(hex_decode("4F4B"), vec![0x4F, 0x4B]);
    }

    #[test]
    fn test_hex_decode_mixed_case() {
        assert_eq!(hex_decode("aAbBcC"), vec![0xAA, 0xBB, 0xCC]);
    }

    #[test]
    fn test_hex_decode_empty() {
        assert_eq!(hex_decode(""), Vec::<u8>::new());
    }

    #[test]
    fn test_hex_decode_ignores_non_hex() {
        // Non-hex chars are skipped
        assert_eq!(hex_decode("4F-4B"), vec![0x4F, 0x4B]);
    }

    // ═══════════════════════════════════════════════════════════
    // clsid_to_guid_string
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_clsid_to_guid_string_zero() {
        let clsid = [0u8; 16];
        assert_eq!(clsid_to_guid_string(&clsid), "00000000-0000-0000-0000-000000000000");
    }

    #[test]
    fn test_clsid_to_guid_string_le_byte_order() {
        // First 3 groups are little-endian
        let clsid: [u8; 16] = [
            0x01, 0x02, 0x03, 0x04, // Data1 LE → 04030201
            0x05, 0x06,             // Data2 LE → 0605
            0x07, 0x08,             // Data3 LE → 0807
            0x09, 0x0A,             // Data4[0..2] as-is
            0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x10, // Data4[2..8] as-is
        ];
        assert_eq!(
            clsid_to_guid_string(&clsid),
            "04030201-0605-0807-090A-0B0C0D0E0F10"
        );
    }

    // ═══════════════════════════════════════════════════════════
    // dwg_julian_to_iso
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_dwg_julian_unix_epoch() {
        // JD 2440588 = Jan 1, 1970, ms=0
        let result = dwg_julian_to_iso(2440588, 0);
        assert!(result.is_some());
        assert!(result.unwrap().starts_with("1970-01-01"));
    }

    #[test]
    fn test_dwg_julian_known_date() {
        // JD 2460000 ≈ 2023-02-xx
        let result = dwg_julian_to_iso(2460000, 0);
        assert!(result.is_some());
        let s = result.unwrap();
        assert!(s.starts_with("2023-02"), "Expected 2023-02-xx, got {}", s);
    }

    #[test]
    fn test_dwg_julian_with_milliseconds() {
        // ms = 43200000 → 12 saat = öğlen
        let result = dwg_julian_to_iso(2440588, 43_200_000);
        assert!(result.is_some());
        assert!(result.unwrap().contains("12:00:00"));
    }

    #[test]
    fn test_dwg_julian_out_of_range() {
        assert_eq!(dwg_julian_to_iso(0, 0), None);
        assert_eq!(dwg_julian_to_iso(1000000, 0), None);  // Too old
        assert_eq!(dwg_julian_to_iso(2440588, 86_400_000), None); // ms too large
    }

    // ═══════════════════════════════════════════════════════════
    // detect_ole_progid & is_progid_shape
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_detect_ole_progid_excel() {
        let result = detect_ole_progid("Excel.Sheet.12");
        assert!(result.is_some());
        let (cat, label) = result.unwrap();
        assert_eq!(cat, "EXCEL");
        assert!(label.contains("Excel"));
    }

    #[test]
    fn test_detect_ole_progid_word() {
        let result = detect_ole_progid("Word.Document.12");
        assert!(result.is_some());
        let (cat, _) = result.unwrap();
        assert_eq!(cat, "WORD");
    }

    #[test]
    fn test_detect_ole_progid_empty() {
        assert!(detect_ole_progid("").is_none());
    }

    #[test]
    fn test_detect_ole_progid_too_long() {
        let long_str = "a".repeat(65);
        assert!(detect_ole_progid(&long_str).is_none());
    }

    #[test]
    fn test_is_progid_shape_false_for_file_ext() {
        assert!(!is_progid_shape("test.jpg"));
        assert!(!is_progid_shape("file.dwg"));
        assert!(!is_progid_shape("doc.pdf"));
    }

    #[test]
    fn test_is_progid_shape_false_short() {
        assert!(!is_progid_shape("ab"));
        assert!(!is_progid_shape(""));
    }
}
