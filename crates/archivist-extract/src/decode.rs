//! Kaynak baytlari metne cevir — UTF-8 → Windows-1254 (Turkce) fallback.
//!
//! **Hafif cekirdek prensibi** (lib.rs §1): harici charset bagimliligi YOK
//! (`encoding_rs` cekirdege girmez). Windows-1254 tablosu el-yapimi/std-only.
//!
//! Neden CP1254: Turkce eski CAD/Office/metin dosyalari UTF-8 olmadiginda neredeyse
//! her zaman Windows-1254'tur. Yaygin hata "Latin-1 varsay" (`b as char`) → CP1254'un
//! Turkce konumlari (Ğ/İ/Ş/ğ/ı/ş) yanlis cozulur (sessiz mojibake). Bu modul dogru
//! cozer. Alan-degeri (title/author/layer) gibi KISA tek-deger metinleri icindir:
//! gecerli UTF-8 ise dokunmaz, degilse butunuyle CP1254 sayar.

/// Baytlari metne cevir. Oncelik: BOM (UTF-8/UTF-16) → gecerli UTF-8 → Windows-1254.
pub fn decode_bytes(buf: &[u8]) -> String {
    if let Some(rest) = buf.strip_prefix(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(rest).into_owned();
    }
    if let Some(rest) = buf.strip_prefix(&[0xFF, 0xFE]) {
        return decode_utf16(rest, true);
    }
    if let Some(rest) = buf.strip_prefix(&[0xFE, 0xFF]) {
        return decode_utf16(rest, false);
    }
    // Gecerli UTF-8 → oldugu gibi (en yaygin, kayipsiz).
    if let Ok(s) = std::str::from_utf8(buf) {
        return s.to_string();
    }
    // UTF-8 degil → Windows-1254 varsay (Latin-1 DEGIL → Turkce dogru).
    decode_windows_1254(buf)
}

/// Windows-1254 (Turkce) baytlarini metne cevir. 0x00-0x7F ASCII; 0xA0-0xFF Latin-1
/// ile ayni, sadece 6 Turkce konum farkli; 0x80-0x9F Windows ozel bolgesi.
pub fn decode_windows_1254(buf: &[u8]) -> String {
    buf.iter().map(|&b| cp1254_char(b)).collect()
}

fn cp1254_char(b: u8) -> char {
    match b {
        // 0x80-0x9F: Windows ozel (ISO kontrol bolgesi yerine). Tanimsizlar → U+FFFD.
        0x80 => '\u{20AC}', // €
        0x82 => '\u{201A}',
        0x83 => '\u{0192}', // ƒ
        0x84 => '\u{201E}',
        0x85 => '\u{2026}', // …
        0x86 => '\u{2020}', // †
        0x87 => '\u{2021}', // ‡
        0x88 => '\u{02C6}', // ˆ
        0x89 => '\u{2030}', // ‰
        0x8A => '\u{0160}', // Š
        0x8B => '\u{2039}',
        0x8C => '\u{0152}', // Œ
        0x91 => '\u{2018}',
        0x92 => '\u{2019}',
        0x93 => '\u{201C}',
        0x94 => '\u{201D}',
        0x95 => '\u{2022}', // •
        0x96 => '\u{2013}', // –
        0x97 => '\u{2014}', // —
        0x98 => '\u{02DC}', // ˜
        0x99 => '\u{2122}', // ™
        0x9A => '\u{0161}', // š
        0x9B => '\u{203A}',
        0x9C => '\u{0153}', // œ
        0x9F => '\u{0178}', // Ÿ
        0x81 | 0x8D | 0x8E | 0x8F | 0x90 | 0x9D | 0x9E => '\u{FFFD}',
        // Turkce farkli konumlar (Latin-1'den ayrildigi yerler).
        0xD0 => '\u{011E}', // Ğ
        0xDD => '\u{0130}', // İ
        0xDE => '\u{015E}', // Ş
        0xF0 => '\u{011F}', // ğ
        0xFD => '\u{0131}', // ı
        0xFE => '\u{015F}', // ş
        // Geri kalan (0x00-0x7F + 0xA0-0xFF\Turkce) Latin-1 = Unicode kod noktasi.
        _ => b as char,
    }
}

/// UTF-16 (le=true → little-endian) → String (eksik son bayt yok sayilir).
fn decode_utf16(buf: &[u8], le: bool) -> String {
    let units: Vec<u16> = buf
        .chunks_exact(2)
        .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
        .collect();
    String::from_utf16_lossy(&units)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_utf8_passthrough() {
        assert_eq!(decode_bytes("merhaba çğşıöü".as_bytes()), "merhaba çğşıöü");
        assert_eq!(decode_bytes(b"A-WALL-0"), "A-WALL-0");
        assert_eq!(decode_bytes(b""), "");
    }

    #[test]
    fn cp1254_turkish_fallback() {
        // Windows-1254 Turkce baytlari (gecersiz UTF-8) → dogru Turkce.
        // 0xD0=Ğ 0xDD=İ 0xDE=Ş 0xF0=ğ 0xFD=ı 0xFE=ş 0xE7=ç 0xFC=ü 0xF6=ö
        assert_eq!(decode_bytes(&[0x47, 0xDD, 0x52, 0x45, 0x53, 0x55, 0x4E]), "GİRESUN");
        assert_eq!(decode_bytes(&[0x6B, 0xFD, 0x6C, 0xFE]), "kılş");
        assert_eq!(decode_bytes(&[0xE7, 0xF0, 0xFE]), "çğş");
        // Latin-1 ortak bolge (0xFC=ü, 0xF6=ö).
        assert_eq!(decode_bytes(&[0x67, 0xFC, 0x6E]), "gün");
    }

    #[test]
    fn cp1254_not_latin1() {
        // Kritik: 0xDE Latin-1'de 'Þ', Windows-1254'te 'Ş' olmali (mojibake testi).
        assert_eq!(decode_windows_1254(&[0xDE]), "Ş");
        assert_ne!(decode_windows_1254(&[0xDE]), "Þ");
    }

    #[test]
    fn utf16_bom() {
        // UTF-16LE BOM + "Şç"
        let mut le = vec![0xFF, 0xFE];
        for u in "Şç".encode_utf16() {
            le.extend_from_slice(&u.to_le_bytes());
        }
        assert_eq!(decode_bytes(&le), "Şç");
    }
}
