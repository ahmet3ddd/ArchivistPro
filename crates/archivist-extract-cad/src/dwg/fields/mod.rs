//! DWG alan cikaricilari — version, layer, block, text, xref, image, properties,
//! units, creation-date. H2 `dwg_parse.rs`'ten nakil.
//!
//! match-kolu + ic `if` (version → header-offset) deseni bilincli: guard'a cevirmek
//! fallthrough semantigini degistirebilir (H2 ile ayni karar) → collapsible_match kapali.
#![allow(clippy::collapsible_match)]

use std::collections::HashSet;

use archivist_extract::datetime;

use super::strings::extract_dwg_strings;

mod text;
pub use text::extract_dwg_texts;

/// Cizim dokuman ozellikleri (SummaryInfo).
#[derive(Default)]
pub struct DrawingProperties {
    pub title: Option<String>,
    pub subject: Option<String>,
    pub author: Option<String>,
    pub keywords: Option<String>,
    pub comments: Option<String>,
    pub last_saved_by: Option<String>,
}

/// DWG header ilk 6 baytindan version string. DXF de ($ACADVER) kullanir.
pub fn get_dwg_version(data: &[u8]) -> Option<String> {
    if data.len() < 6 {
        return None;
    }
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

fn is_valid_layer_name(s: &str) -> bool {
    if s.is_empty() || s.len() > 64 {
        return false;
    }
    if !s.chars().any(char::is_alphabetic) {
        return false;
    }
    if s.chars().any(|c| {
        matches!(c, '/' | '\\' | ':' | '<' | '>' | '"' | ';' | '?' | '*' | '|' | '=')
    }) {
        return false;
    }
    let skip_prefixes = ["AcDb", "AcCm", "AcGi", "AcGe", "AcPl", "AcXr", "AC1", "ACAD", "ObjectARX"];
    if skip_prefixes.iter().any(|p| s.starts_with(p)) {
        return false;
    }
    let skip_exact = [
        "continuous", "ByLayer", "ByBlock", "True", "False", "Model", "Layout", "Standard",
    ];
    !skip_exact.iter().any(|e| s.eq_ignore_ascii_case(e))
}

/// DWG layer adlari (AcDbLayerTableRecord marker taramasi + fallback).
pub fn extract_dwg_layers(data: &[u8]) -> Vec<String> {
    let mut layers = HashSet::new();
    let marker = b"AcDbLayerTableRecord";
    let mut i = 0;
    while i + marker.len() <= data.len() {
        if &data[i..i + marker.len()] == marker {
            let start = i.saturating_sub(128);
            for s in extract_dwg_strings(&data[start..i], 1, 64).iter().rev().take(10) {
                if is_valid_layer_name(s) {
                    layers.insert(s.clone());
                    break;
                }
            }
        }
        i += 1;
    }

    if layers.is_empty() {
        // min_len 3: ham-tarama 2-karakter cop ("Wc"/"wC") katman sanilmasin.
        for s in extract_dwg_strings(data, 3, 64) {
            if s.contains(' ') || !is_valid_layer_name(&s) {
                continue;
            }
            if !s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.') {
                continue;
            }
            layers.insert(s);
        }
    }

    let mut result: Vec<String> = layers.into_iter().collect();
    result.sort();
    result.truncate(500);
    result
}

/// Ham-tarama parcasi gercek bir blok ADI olmaya makul mu? (ikili gurultuyu ele).
/// Blok adlari harf/rakam + `_ - . ( )` icerir; bosluk/sembol/noktalama YOK. Bu, ham
/// DWG ikilisinden gelen "!WWc"/"@WC"/"BED2#n&"/"Gn wC" gibi cop parcalari eler.
fn is_plausible_block_name(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    let n = chars.len();
    if !(3..=80).contains(&n) {
        return false;
    }
    if !chars[0].is_alphanumeric() {
        return false; // basta noktalama (cop) → ele
    }
    if !chars.iter().all(|&c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '(' | ')')) {
        return false; // bosluk/sembol → ele
    }
    if !chars.iter().any(|c| c.is_alphabetic()) {
        return false; // en az bir harf
    }
    // Tekrar-hakimiyeti (or. "aaaa", kisa motif tekrari) → cop.
    let uniq = chars.iter().collect::<HashSet<_>>().len();
    (uniq as f32 / n as f32) >= 0.4
}

/// `s_upper` icinde bir gosterge KELIME-SINIRLI gecyor mu (alt-dizgi DEGIL — eski hata
/// `contains("WC")` ikili gurultuyle eslesip yuzlerce sahte blok uretiyordu). Token =
/// alfasayisal-olmayanla bolunmus parca; token gostergeye ESIT ya da gosterge + yalniz-
/// rakam son-eki ("WC-01"→"WC", "MASA2") olmali. "DR-"/"WN-" dash'li → dash atilir.
fn block_indicator_match(s_upper: &str, indicators: &[&str]) -> bool {
    let tokens: Vec<&str> =
        s_upper.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()).collect();
    indicators.iter().any(|ind| {
        let ind_clean = ind.trim_end_matches('-');
        tokens.iter().any(|tok| {
            *tok == ind_clean
                || tok
                    .strip_prefix(ind_clean)
                    .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
        })
    })
}

/// DWG block adlari (mobilya/yapi/MEP gostergelerine gore heuristik).
pub fn extract_dwg_blocks(data: &[u8]) -> Vec<String> {
    let all_strings = extract_dwg_strings(data, 3, 255);
    let mut blocks = HashSet::new();
    let indicators = [
        "CHAIR", "TABLE", "DESK", "BED", "SOFA", "COUCH", "CABINET", "SHELF", "WARDROBE",
        "ARMCHAIR", "BENCH", "STOOL", "DOOR", "WINDOW", "WIN", "DR-", "WN-", "GATE", "SINK",
        "WC", "TOILET", "BATHTUB", "SHOWER", "LAVABO", "COLUMN", "COL", "PILLAR", "BEAM",
        "LAMP", "LIGHT", "SWITCH", "OUTLET", "SOCKET", "PANEL", "SPRINKLER", "DIFFUSER",
        "VENT", "RADIATOR", "TREE", "PLANT", "BUSH", "GRASS", "CAR", "VEHICLE", "PARK",
        "ARROW", "NORTH", "SECTION", "DETAIL", "ELEV", "LEVEL", "GRID", "TITLE", "SCALE",
        "KAPI", "PENCERE", "MASA", "SANDALYE", "YATAK", "DOLAP", "KLOZET", "KUVET", "AGAC", "ARAC",
    ];
    let skip_patterns = ["*MODEL_SPACE", "*PAPER_SPACE", "*MODEL", "*PAPER"];

    for s in &all_strings {
        if !is_plausible_block_name(s) {
            continue;
        }
        let upper = s.to_uppercase();
        if skip_patterns.iter().any(|p| upper.contains(p)) {
            continue;
        }
        if block_indicator_match(&upper, &indicators) {
            blocks.insert(s.clone());
        }
    }

    let mut result: Vec<String> = blocks.into_iter().collect();
    result.sort();
    result.truncate(500);
    result
}

/// .dwg/.dxf ile biten xref yollari.
pub fn extract_dwg_xrefs(data: &[u8]) -> Vec<String> {
    let mut xrefs = HashSet::new();
    let exts = [".dwg", ".DWG", ".dxf", ".DXF"];
    for s in extract_dwg_strings(data, 5, 512) {
        if exts.iter().any(|e| s.ends_with(e) && s.len() > e.len() + 1) {
            xrefs.insert(s);
        }
    }
    let mut result: Vec<String> = xrefs.into_iter().collect();
    result.sort();
    result
}

/// Raster gorsel uzantili referans yollari.
pub fn extract_dwg_image_refs(data: &[u8]) -> Vec<String> {
    let mut refs = HashSet::new();
    let exts = [
        ".jpg", ".JPG", ".jpeg", ".JPEG", ".png", ".PNG", ".bmp", ".BMP", ".tif", ".TIF",
        ".tiff", ".TIFF", ".gif", ".GIF", ".pcx", ".PCX", ".ecw", ".ECW",
    ];
    for s in extract_dwg_strings(data, 5, 512) {
        if exts.iter().any(|e| s.ends_with(e) && s.len() > e.len() + 1) {
            refs.insert(s);
        }
    }
    let mut result: Vec<String> = refs.into_iter().collect();
    result.sort();
    result.truncate(100);
    result
}

/// SummaryInfo marker'lari yakininda okunabilir metin → cizim ozellikleri.
pub fn extract_dwg_properties(data: &[u8]) -> DrawingProperties {
    let mut props = DrawingProperties::default();
    #[allow(clippy::type_complexity)]
    let markers: &[(&str, fn(&mut DrawingProperties, String))] = &[
        ("Title", |p, v| p.title = Some(v)),
        ("Subject", |p, v| p.subject = Some(v)),
        ("Author", |p, v| p.author = Some(v)),
        ("Keywords", |p, v| p.keywords = Some(v)),
        ("Comments", |p, v| p.comments = Some(v)),
        ("LastSavedBy", |p, v| p.last_saved_by = Some(v)),
    ];

    for (marker, setter) in markers {
        let mb = marker.as_bytes();
        let upper = data.len().saturating_sub(mb.len());
        for i in 0..upper {
            if data.get(i..i + mb.len()) != Some(mb) {
                continue;
            }
            let search_start = i + mb.len();
            let search_end = (search_start + 256).min(data.len());
            if let Some(value) = extract_dwg_strings(&data[search_start..search_end], 2, 200).into_iter().next() {
                let is_marker = markers.iter().any(|(m, _)| *m == value);
                if !is_marker && value.len() >= 2 {
                    setter(&mut props, value);
                    break;
                }
            }
        }
    }
    props
}

/// Birim tespiti (string heuristik).
///
/// Raw DWG taramasinda aktif cizim olcegini ayirt edecek yapilandirilmis
/// baglam yoktur. 1:50 benzeri metinler hem cizim yazilarinda hem de ikili
/// copte gorulebildigi icin olcek yalniz ODA'nin uretdigi DXF $CANNOSCALE
/// basligindan gelir.
pub fn extract_dwg_units(data: &[u8]) -> (Option<String>, Option<String>) {
    let mut unit_type = None;
    for s in extract_dwg_strings(data, 3, 64) {
        let upper = s.to_uppercase();
        if upper == "MILLIMETERS" || upper == "MM" {
            unit_type = Some("Milimetre".to_string());
        }
        if upper == "CENTIMETERS" || upper == "CM" {
            unit_type = Some("Santimetre".to_string());
        }
        if upper == "METERS" || (upper == "M" && s.len() <= 2) {
            unit_type = Some("Metre".to_string());
        }
    }
    (unit_type, None)
}

/// DWG Julian (JD gun + ms) → ISO. Aralik ~1900-2132.
pub fn dwg_julian_to_iso(jd: u32, ms: u32) -> Option<String> {
    if !(2_415_021..=2_500_000).contains(&jd) || ms >= 86_400_000 {
        return None;
    }
    let days_since_epoch = i64::from(jd) - 2_440_588;
    let total_secs = days_since_epoch * 86400 + i64::from(ms / 1000);
    Some(datetime::unix_to_rfc3339(total_secs))
}

/// Bayt araliginda DWG Julian tarih cifti (JD + ms) ara, ilk gecerliyi don.
pub fn scan_dwg_julian(data: &[u8], from: usize, to: usize) -> Option<String> {
    let end = to.min(data.len().saturating_sub(7));
    for i in from..end {
        if i + 8 > data.len() {
            break;
        }
        let jd = u32::from_le_bytes([data[i], data[i + 1], data[i + 2], data[i + 3]]);
        let ms = u32::from_le_bytes([data[i + 4], data[i + 5], data[i + 6], data[i + 7]]);
        if (2_444_239..=2_466_161).contains(&jd) && ms < 86_400_000 {
            if let Some(iso) = dwg_julian_to_iso(jd, ms) {
                return Some(iso);
            }
        }
    }
    None
}

/// TDCREATE (cizim olusturma tarihi) — version'a gore header offset + Julian tarama.
pub fn get_dwg_creation_date(data: &[u8]) -> Option<String> {
    if data.len() < 0x20 || &data[0..2] != b"AC" {
        return None;
    }
    let scan_start = match &data[2..6] {
        b"1015" | b"1014" => {
            if data.len() > 0x1A {
                let seek = u32::from_le_bytes([data[0x16], data[0x17], data[0x18], data[0x19]])
                    as usize;
                if seek > 0 && seek + 20 < data.len() {
                    seek + 20
                } else {
                    0x100
                }
            } else {
                0x100
            }
        }
        _ => 0x100,
    };
    scan_dwg_julian(data, scan_start, scan_start + 65536)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_all_codes() {
        for (code, exp) in [
            (b"AC1015", "AutoCAD 2000"),
            (b"AC1032", "AutoCAD 2018"),
            (b"AC1036", "AutoCAD 2024"),
        ] {
            let mut d = code.to_vec();
            d.extend_from_slice(&[0u8; 100]);
            assert_eq!(get_dwg_version(&d).as_deref(), Some(exp));
        }
        assert_eq!(get_dwg_version(b"AC9999______"), None);
        assert_eq!(get_dwg_version(b"AC10"), None);
    }

    #[test]
    fn blocks_reject_binary_noise_keep_real() {
        // Ham-tarama copu (sembol/kelime-disi/bosluklu) vs gercek blok adlari.
        // Eski hata: upper.contains("WC") → "!WWc"/"xwc"/"@WC" hepsi blok sanilirdi.
        let data = b"!WWc\x00xwc\x00@WC\x00BED2#n&\x00Gn wC\x005G0WC\x008WCT!0G\x00\
                     WC-01\x00MASA-02\x00DOOR_90\x00COLUMN\x00";
        let blocks = extract_dwg_blocks(data);
        // Gercek blok adlari korunmali:
        for real in ["WC-01", "MASA-02", "DOOR_90", "COLUMN"] {
            assert!(blocks.iter().any(|b| b == real), "gercek blok dustu {real}: {blocks:?}");
        }
        // Ikili cop reddedilmeli:
        for junk in ["WWc", "xwc", "@WC", "BED2", "Gn", "5G0WC", "8WCT"] {
            assert!(!blocks.iter().any(|b| b.contains(junk)), "cop sizdi '{junk}': {blocks:?}");
        }
    }

    #[test]
    fn block_indicator_word_boundary() {
        // Kelime-sinirli: token gostergeye esit ya da gosterge+rakam.
        assert!(block_indicator_match("WC-01", &["WC"]));
        assert!(block_indicator_match("MASA2", &["MASA"]));
        assert!(block_indicator_match("DR-12", &["DR-"])); // dash atilir → "DR"
        // Alt-dizgi DEGIL: "XWC"/"WCX" gosterge "WC" ile eslesmemeli.
        assert!(!block_indicator_match("XWC", &["WC"]));
        assert!(!block_indicator_match("WCX", &["WC"]));
        assert!(!block_indicator_match("5G0WC", &["WC"]));
    }

    #[test]
    fn julian_dates() {
        assert!(dwg_julian_to_iso(2_440_588, 0).unwrap().starts_with("1970-01-01"));
        assert!(dwg_julian_to_iso(2_440_588, 43_200_000).unwrap().contains("12:00:00"));
        assert_eq!(dwg_julian_to_iso(0, 0), None);
        assert_eq!(dwg_julian_to_iso(2_440_588, 86_400_000), None);
    }

    #[test]
    fn raw_dwg_text_never_becomes_scale_metadata() {
        let (unit, scale) =
            extract_dwg_units(b"MILLIMETERS\x00SCALE\x001:50\x00MODEL\x001/100\x00");
        assert_eq!(unit.as_deref(), Some("Milimetre"));
        assert_eq!(scale, None);
    }
}
