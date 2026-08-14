//! Gomulu OLE objesi tespiti — ProgID, CFBF root CLSID, hex decode. H2 naklı.
//!
//! DWG/DXF icinde OLE2FRAME entity'leri Excel/Word/PDF gibi objeleri ProgID veya
//! CFBF (Compound File) CLSID ile saklar. Bu modul DXF tarafindan da paylasilir.

use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

use super::strings::{extract_dwg_strings, extract_dwg_strings_utf16};

/// Taninan OLE ProgID prefix'ine gore (kategori, etiket) dondurur.
pub fn detect_ole_progid(s: &str) -> Option<(&'static str, String)> {
    let trimmed = s.trim();
    if trimmed.is_empty() || trimmed.len() > 64 {
        return None;
    }
    let lower = trimmed.to_lowercase();
    let prefixes: &[(&str, &'static str, &str)] = &[
        ("excel.sheet", "EXCEL", "Microsoft Excel"),
        ("excel.workbook", "EXCEL", "Microsoft Excel"),
        ("excel.chart", "EXCEL_CHART", "Microsoft Excel Chart"),
        ("word.document", "WORD", "Microsoft Word"),
        ("word.picture", "WORD_PIC", "Microsoft Word Picture"),
        ("powerpoint.show", "PPT", "Microsoft PowerPoint"),
        ("powerpoint.slide", "PPT_SLIDE", "Microsoft PowerPoint Slide"),
        ("mspp.slide", "PPT_SLIDE", "Microsoft PowerPoint Slide"),
        ("msgraph.chart", "MSGRAPH", "Microsoft Graph Chart"),
        ("visio.drawing", "VISIO", "Microsoft Visio"),
        ("acrobat.document", "PDF", "Adobe Acrobat PDF"),
        ("acroexch.document", "PDF", "Adobe Acrobat PDF"),
        ("pdfxml.document", "PDF", "PDF Document"),
        ("photoshop.image", "PHOTOSHOP", "Adobe Photoshop Gorsel"),
        ("paintbrush.picture", "PBRUSH", "Paintbrush/Bitmap Gorsel"),
        ("paint.picture", "PBRUSH", "Paintbrush/Bitmap Gorsel"),
        ("pbrush", "PBRUSH", "Paintbrush/Bitmap Gorsel"),
        ("bitmap image", "BITMAP", "Bitmap Gorsel"),
        ("image document", "IMAGE", "Gomulu Gorsel"),
        ("coreldraw", "COREL", "CorelDRAW"),
        ("cdraw", "COREL", "CorelDRAW"),
        ("mspho", "MSPHOTO", "Microsoft Photo Editor Gorsel"),
        ("equation", "EQUATION", "Matematik Denklem"),
        ("package", "PACKAGE", "Gomulu Dosya (Package)"),
        ("staroffice", "STAROFFICE", "StarOffice/OpenOffice"),
        ("opendocument", "OPENDOC", "OpenDocument"),
        ("autocad.", "AUTOCAD", "AutoCAD Nesnesi"),
        ("staticmetafile", "STATIC_META", "Metafile Gorsel (Statik)"),
        ("staticdib", "STATIC_DIB", "Bitmap Gorsel (DIB, Statik)"),
        ("staticenhmetafile", "STATIC_EMF", "EMF Gorsel (Statik)"),
        ("metafilepict", "STATIC_META", "Metafile Gorsel"),
        ("picture (metafile", "STATIC_META", "Metafile Gorsel"),
        ("picture (device", "STATIC_DIB", "Bitmap Gorsel (DIB)"),
        ("picture (enhanced", "STATIC_EMF", "EMF Gorsel"),
    ];
    for (prefix, cat, label) in prefixes {
        if lower.starts_with(prefix) {
            let display = if label.contains('(') {
                (*label).to_string()
            } else {
                format!("{label} ({trimmed})")
            };
            return Some((cat, display));
        }
    }
    None
}

/// "Xxx.Yyy[.NN]" bicimindeki ProgID-sekilli string mi?
pub fn is_progid_shape(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.len() < 5 || trimmed.len() > 50 {
        return false;
    }
    let lower = trimmed.to_lowercase();
    let exts = [
        ".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".gif", ".dwg", ".dxf", ".exe",
        ".dll", ".txt", ".pdf", ".doc", ".xls", ".zip", ".rar", ".rfa", ".skp",
    ];
    if exts.iter().any(|e| lower.ends_with(e)) {
        return false;
    }
    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.len() < 2 || parts.len() > 4 {
        return false;
    }
    let seg_ok = |seg: &str| {
        let mut c = seg.chars();
        let Some(first) = c.next() else { return false };
        first.is_ascii_uppercase() && c.all(|ch| ch.is_ascii_alphanumeric())
    };
    if !(3..=24).contains(&parts[0].len()) || !seg_ok(parts[0]) {
        return false;
    }
    if !(3..=24).contains(&parts[1].len()) || !seg_ok(parts[1]) {
        return false;
    }
    for seg in &parts[2..] {
        if seg.is_empty() || seg.len() > 8 || !seg.chars().all(|c| c.is_ascii_alphanumeric()) {
            return false;
        }
    }
    true
}

/// Hex string → bayt (her tur ayraci tolere eder).
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
            Some(h) => {
                out.push(h | nibble);
                high = None;
            }
        }
    }
    out
}

/// GUID string → 16 bayt (Data1-3 little-endian, Data4 as-is).
fn guid_to_bytes(guid: &str) -> [u8; 16] {
    let hex: String = guid.chars().filter(char::is_ascii_hexdigit).collect();
    let mut bytes = [0u8; 16];
    if hex.len() == 32 {
        for i in 0..16 {
            bytes[i] = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(0);
        }
        bytes[0..4].reverse();
        bytes[4..6].reverse();
        bytes[6..8].reverse();
    }
    bytes
}

static KNOWN_CLSID_MAP: OnceLock<Vec<([u8; 16], &'static str, &'static str)>> = OnceLock::new();

/// Taninan CLSID'ler: (binary_guid, kategori, etiket).
pub fn known_clsids() -> &'static [([u8; 16], &'static str, &'static str)] {
    KNOWN_CLSID_MAP.get_or_init(|| {
        let raw: &[(&str, &str, &str)] = &[
            ("00020820-0000-0000-C000-000000000046", "EXCEL", "Microsoft Excel"),
            ("00020821-0000-0000-C000-000000000046", "EXCEL_CHART", "Microsoft Excel Chart"),
            ("00020810-0000-0000-C000-000000000046", "EXCEL", "Microsoft Excel (legacy)"),
            ("00020906-0000-0000-C000-000000000046", "WORD", "Microsoft Word"),
            ("00020900-0000-0000-C000-000000000046", "WORD", "Microsoft Word (legacy)"),
            ("64818D10-4F9B-11CF-86EA-00AA00B929E8", "PPT", "Microsoft PowerPoint"),
            ("64818D11-4F9B-11CF-86EA-00AA00B929E8", "PPT_SLIDE", "Microsoft PowerPoint Slide"),
            ("F20DA720-C02F-11CE-927B-0800095AE340", "PACKAGE", "Gomulu Dosya (Package)"),
            ("B801CA65-A1FC-11D0-85AD-444553540000", "PDF", "Adobe Acrobat PDF"),
            ("0003000A-0000-0000-C000-000000000046", "PBRUSH", "Paintbrush/Bitmap Gorsel"),
            ("0002CE02-0000-0000-C000-000000000046", "EQUATION", "Matematik Denklem (Equation 3)"),
            ("00020803-0000-0000-C000-000000000046", "MSGRAPH", "Microsoft Graph Chart"),
            ("00021A14-0000-0000-C000-000000000046", "VISIO", "Microsoft Visio"),
            ("00021A20-0000-0000-C000-000000000046", "VISIO", "Microsoft Visio"),
            ("00030002-0000-0000-C000-000000000046", "WORDART", "Microsoft WordArt"),
            ("22D6F31E-B0F6-11D0-94AB-0080C74C7E95", "MSPHOTO", "Microsoft Photo Editor Gorsel"),
            ("00000315-0000-0000-C000-000000000046", "STATIC_META", "Metafile Gorsel (Statik)"),
            ("00000316-0000-0000-C000-000000000046", "STATIC_DIB", "Bitmap Gorsel (DIB, Statik)"),
            ("00000319-0000-0000-C000-000000000046", "STATIC_EMF", "EMF Gorsel (Statik)"),
        ];
        raw.iter().map(|(g, c, l)| (guid_to_bytes(g), *c, *l)).collect()
    })
}

/// CLSID bayt dizisi → insan-okunur GUID string.
pub fn clsid_to_guid_string(clsid: &[u8; 16]) -> String {
    format!(
        "{:02X}{:02X}{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        clsid[3], clsid[2], clsid[1], clsid[0],
        clsid[5], clsid[4],
        clsid[7], clsid[6],
        clsid[8], clsid[9],
        clsid[10], clsid[11], clsid[12], clsid[13], clsid[14], clsid[15]
    )
}

/// CFBF blob'unun root directory entry'sinden CLSID'yi cikar (checked aritmetik).
pub fn read_cfbf_root_clsid(data: &[u8], cfbf_start: usize) -> Option<[u8; 16]> {
    if cfbf_start + 52 > data.len() {
        return None;
    }
    let sector_shift =
        u16::from_le_bytes([data[cfbf_start + 30], data[cfbf_start + 31]]) as usize;
    if !(9..=14).contains(&sector_shift) {
        return None;
    }
    let sector_size = 1usize << sector_shift;
    let dir_sect = u32::from_le_bytes([
        data[cfbf_start + 48],
        data[cfbf_start + 49],
        data[cfbf_start + 50],
        data[cfbf_start + 51],
    ]) as usize;

    let root_off = cfbf_start.checked_add(dir_sect.checked_add(1)?.checked_mul(sector_size)?)?;
    let clsid_off = root_off.checked_add(80)?;
    if clsid_off + 16 > data.len() {
        return None;
    }
    let mut clsid = [0u8; 16];
    clsid.copy_from_slice(&data[clsid_off..clsid_off + 16]);
    if clsid.iter().all(|&b| b == 0) {
        return None;
    }
    Some(clsid)
}

fn extract_cfbf_root_clsids(data: &[u8]) -> Vec<[u8; 16]> {
    const MAGIC: &[u8] = &[0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    let mut result = Vec::new();
    let mut pos = 0;
    while pos < data.len() {
        let Some(rel) = data[pos..].windows(8).position(|w| w == MAGIC) else { break };
        let start = pos + rel;
        if let Some(c) = read_cfbf_root_clsid(data, start) {
            result.push(c);
        }
        pos = start + 8;
    }
    result
}

fn find_clsid_matches_binary(data: &[u8]) -> Vec<(&'static str, &'static str)> {
    let mut matches = Vec::new();
    for (bytes, cat, label) in known_clsids() {
        if data.windows(16).any(|w| w == bytes.as_slice()) {
            matches.push((*cat, *label));
        }
    }
    matches
}

fn count_ole_frames_binary(data: &[u8]) -> usize {
    let needle = b"OLE2FRAME";
    data.windows(needle.len()).filter(|w| *w == needle).count()
}

/// DWG ikili verisinde gomulu OLE objelerini tespit et ("Label × N" formatinda).
pub fn extract_dwg_ole_objects(data: &[u8]) -> Vec<String> {
    let ascii_strings = extract_dwg_strings(data, 5, 64);
    let utf16_strings = extract_dwg_strings_utf16(data, 5, 64);

    let mut progid_by_cat: HashMap<&'static str, String> = HashMap::new();
    for s in ascii_strings.iter().chain(utf16_strings.iter()) {
        if let Some((cat, label)) = detect_ole_progid(s) {
            progid_by_cat.insert(cat, label);
        }
    }

    let cfbf_clsids = extract_cfbf_root_clsids(data);
    let mut type_counts: HashMap<String, usize> = HashMap::new();

    if cfbf_clsids.is_empty() {
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
            if detect_ole_progid(trimmed).is_some() {
                continue;
            }
            if is_progid_shape(trimmed) {
                unknown_progids.insert(trimmed.to_string());
            }
        }
        for p in &unknown_progids {
            *type_counts.entry(format!("Bilinmeyen: {p}")).or_insert(0) += 1;
        }
    } else {
        for cfbf_clsid in &cfbf_clsids {
            let mut label: Option<String> = None;
            for (known_bytes, cat, lbl) in known_clsids() {
                if known_bytes == cfbf_clsid {
                    label = Some(progid_by_cat.get(cat).cloned().unwrap_or_else(|| (*lbl).to_string()));
                    break;
                }
            }
            let display = label.unwrap_or_else(|| {
                format!("Bilinmeyen CLSID: {{{}}}", clsid_to_guid_string(cfbf_clsid))
            });
            *type_counts.entry(display).or_insert(0) += 1;
        }
    }

    let mut entries: Vec<String> = type_counts
        .iter()
        .map(|(label, count)| if *count > 1 { format!("{label} × {count}") } else { label.clone() })
        .collect();

    let represented: usize = type_counts.values().sum();
    let total_ole = cfbf_clsids.len().max(count_ole_frames_binary(data));
    let unaccounted = total_ole.saturating_sub(represented);
    if unaccounted > 0 {
        entries.push(format!("{unaccounted} Tanimlanamayan OLE objesi"));
    }

    entries.sort();
    entries.truncate(50);
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_decode_cases() {
        assert_eq!(hex_decode("48656c6c6f"), b"Hello");
        assert_eq!(hex_decode("aAbBcC"), vec![0xAA, 0xBB, 0xCC]);
        assert_eq!(hex_decode("4F-4B"), vec![0x4F, 0x4B]); // ayraclari atla
        assert_eq!(hex_decode(""), Vec::<u8>::new());
    }

    #[test]
    fn clsid_guid_string() {
        assert_eq!(clsid_to_guid_string(&[0u8; 16]), "00000000-0000-0000-0000-000000000000");
        let clsid: [u8; 16] = [
            0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E,
            0x0F, 0x10,
        ];
        assert_eq!(clsid_to_guid_string(&clsid), "04030201-0605-0807-090A-0B0C0D0E0F10");
    }

    #[test]
    fn progid_detection() {
        let (cat, label) = detect_ole_progid("Excel.Sheet.12").unwrap();
        assert_eq!(cat, "EXCEL");
        assert!(label.contains("Excel"));
        assert_eq!(detect_ole_progid("Word.Document.12").unwrap().0, "WORD");
        assert!(detect_ole_progid("").is_none());
        assert!(detect_ole_progid(&"a".repeat(65)).is_none());
    }

    #[test]
    fn progid_shape_rejects_files() {
        assert!(!is_progid_shape("test.jpg"));
        assert!(!is_progid_shape("ab"));
        assert!(is_progid_shape("Excel.Sheet"));
    }
}
