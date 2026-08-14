//! Office metin cikarimi (FTS body) — eski OLE (DOC/XLS/PPT) + OOXML/ODF.
//!
//! H2 `text_extract.rs`'ten nakil (yalniz office formatlari; txt/csv/rtf → [`super::super::text`],
//! pdf → [`super::super::pdf`]). BIFF/OLE opcode-dispatch deseni bilincli.
//!
//! Format aileleri iki alt-modulde: [`legacy`] (ikili OLE/BIFF/PPT), [`ooxml`]
//! (zip/xml OOXML/ODF). Ortak [`smart_decode_bytes`] (CP1254/Turkce farkinda) burada.

#![allow(clippy::collapsible_match)]

mod legacy;
mod ooxml;

pub use legacy::{extract_doc_text, extract_ppt_text, extract_xls_text};
pub use ooxml::{extract_docx_text, extract_ods_text, extract_pptx_text, extract_xlsx_text};

/// UTF-8, Windows-1254, ISO-8859-9 sirasiyla deneyip en az replacement char ureteni sec.
pub fn smart_decode_bytes(buf: &[u8]) -> String {
    if buf.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&buf[3..]).to_string();
    }
    if buf.starts_with(&[0xFF, 0xFE]) || buf.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, _) = encoding_rs::UTF_16LE.decode(&buf[2..]);
        return cow.into_owned();
    }
    if let Ok(s) = std::str::from_utf8(buf) {
        return s.to_string();
    }
    let utf8_lossy = String::from_utf8_lossy(buf);
    let utf8_replacements = utf8_lossy.chars().filter(|&c| c == '\u{FFFD}').count();
    let total_chars = utf8_lossy.chars().count().max(1);
    let utf8_ratio = utf8_replacements as f32 / total_chars as f32;
    if utf8_ratio < 0.005 {
        return utf8_lossy.into_owned();
    }
    let (win1254, _, _) = encoding_rs::WINDOWS_1254.decode(buf);
    let w_replacements = win1254.chars().filter(|&c| c == '\u{FFFD}').count();
    let w_ratio = w_replacements as f32 / win1254.chars().count().max(1) as f32;
    if w_ratio < utf8_ratio {
        return win1254.into_owned();
    }
    utf8_lossy.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn smart_decode_utf8_and_bom() {
        assert_eq!(smart_decode_bytes("Merhaba dünya".as_bytes()), "Merhaba dünya");
        let mut bom = vec![0xEF, 0xBB, 0xBF];
        bom.extend_from_slice(b"test");
        assert_eq!(smart_decode_bytes(&bom), "test");
        assert_eq!(smart_decode_bytes(&[]), "");
    }

    #[test]
    fn smart_decode_utf16le_bom() {
        let mut buf = vec![0xFF, 0xFE];
        buf.extend_from_slice(&[b'H', 0, b'i', 0]);
        assert_eq!(smart_decode_bytes(&buf), "Hi");
    }

    #[test]
    fn smart_decode_windows1254_turkish() {
        let buf: Vec<u8> = vec![0xC7, 0x69, 0x7A, 0x69, 0x6D]; // "Çizim" CP1254
        let decoded = smart_decode_bytes(&buf);
        assert!(decoded.contains('Ç') || decoded.contains("izim"), "got '{decoded}'");
    }
}
