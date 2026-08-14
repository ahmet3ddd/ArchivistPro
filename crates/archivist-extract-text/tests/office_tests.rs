//! Office entegrasyon testleri.
//!
//! Minimal DOCX/XLSX ZIP'leri bellekte/temp'te kurulur (ikili fixture commit'lenmez);
//! OfficeExtractor uctan uca calistirilir. OLE (doc/xls/ppt) bayt-seviyesi mantigi
//! `office::meta`/`office::text` birim testleriyle kapsanir.

use std::io::Write;

use archivist_extract::{ExtractInput, Extractor, MetaValue};
use archivist_extract_text::OfficeExtractor;

/// Verilen (ad, icerik) girdilerinden STORED (sikistirmasiz) bir ZIP kur.
fn build_zip(entries: &[(&str, &str)]) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let cursor = std::io::Cursor::new(&mut buf);
        let mut zw = zip::ZipWriter::new(cursor);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, content) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(content.as_bytes()).unwrap();
        }
        zw.finish().unwrap();
    }
    buf
}

/// Baytlari `.{ext}` uzantili bir temp dosyaya yaz, yolunu dondur.
fn temp_with(ext: &str, bytes: &[u8]) -> tempfile::TempPath {
    let mut f = tempfile::Builder::new().suffix(&format!(".{ext}")).tempfile().unwrap();
    f.write_all(bytes).unwrap();
    f.flush().unwrap();
    f.into_temp_path()
}

fn extract(ext: &str, bytes: &[u8]) -> archivist_extract::Extracted {
    let path = temp_with(ext, bytes);
    let input = ExtractInput::from_path(&path).expect("temp okunmali");
    OfficeExtractor.extract(&input).expect("cikarim basarili")
}

fn str_field<'a>(out: &'a archivist_extract::Extracted, key: &str) -> Option<&'a str> {
    match out.fields.get(key) {
        Some(MetaValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

#[test]
fn docx_text_and_metadata() {
    let document = r#"<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Merhaba Arsiv H3</w:t></w:r></w:p>
<w:p><w:r><w:t>ikinci paragraf</w:t></w:r></w:p></w:body></w:document>"#;
    let core = r#"<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
<dc:title>Test Belge</dc:title><dc:creator>Ahmet Candoken</dc:creator>
<dcterms:created>2026-06-17T12:00:00Z</dcterms:created></cp:coreProperties>"#;

    let docx = build_zip(&[("word/document.xml", document), ("docProps/core.xml", core)]);
    let out = extract("docx", &docx);

    let text = out.text.as_deref().unwrap_or("");
    assert!(text.contains("Merhaba Arsiv H3"), "metin: {text}");
    assert!(text.contains("ikinci paragraf"), "metin: {text}");
    assert_eq!(str_field(&out, "file_format"), Some("docx"));
    assert_eq!(str_field(&out, "title"), Some("Test Belge"));
    assert_eq!(str_field(&out, "author"), Some("Ahmet Candoken"));
    assert_eq!(str_field(&out, "created_at"), Some("2026-06-17T12:00:00Z"));
    assert_eq!(out.fields.get("has_text"), Some(&MetaValue::Bool(true)));
}

#[test]
fn xlsx_shared_strings_and_sheet_names() {
    let workbook = r#"<workbook><sheets><sheet name="Sayfa1" sheetId="1"/><sheet name="Gelir" sheetId="2"/></sheets></workbook>"#;
    let shared = r#"<sst><si><t>Toplam</t></si><si><t>Gelir Tablosu</t></si></sst>"#;
    let sheet1 = r#"<worksheet><sheetData><row><c><v>0</v></c><c><v>1</v></c></row></sheetData></worksheet>"#;

    let xlsx = build_zip(&[
        ("xl/workbook.xml", workbook),
        ("xl/sharedStrings.xml", shared),
        ("xl/worksheets/sheet1.xml", sheet1),
    ]);
    let out = extract("xlsx", &xlsx);

    let text = out.text.as_deref().unwrap_or("");
    assert!(text.contains("Toplam"), "metin: {text}");
    assert!(text.contains("Gelir Tablosu"), "metin: {text}");
    assert_eq!(str_field(&out, "file_format"), Some("xlsx"));
    assert_eq!(str_field(&out, "sheet_names"), Some("Sayfa1; Gelir"));
}

#[test]
fn office_registered_in_family() {
    let mut reg = archivist_extract::Registry::new();
    archivist_extract_text::register(&mut reg);
    for ext in ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "ods", "odp"] {
        assert!(reg.for_ext(ext).is_some(), "{ext} kayitli olmali");
    }
}
