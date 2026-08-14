//! Modern zip/xml Office formatlari — OOXML (DOCX/PPTX/XLSX) + ODF (ODS).
//!
//! Zip konteyner icindeki hedef XML parcalarindan (`word/document.xml`,
//! `ppt/slides/*`, `sharedStrings.xml`/`worksheets/*`, `content.xml`) metin toplar.
//! Paylasilan XML yardimcilari ([`extract_all_text_nodes`], [`extract_all_tag_text`])
//! bu modulun icindedir (yalniz OOXML/ODF tarafinda kullaniliyor).

use std::borrow::Cow;
use std::fs;
use std::io::Read;
use std::path::Path;

/// DOCX — word/document.xml icindeki `<w:t>` metin dugumleri.
pub fn extract_docx_text(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut doc = archive
        .by_name("word/document.xml")
        .map_err(|_| "DOCX: word/document.xml bulunamadi".to_string())?;
    let mut xml = String::new();
    doc.read_to_string(&mut xml).map_err(|e| e.to_string())?;

    use quick_xml::events::Event;
    use quick_xml::Reader;
    let mut reader = Reader::from_str(&xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out = String::new();
    let mut in_text = false;
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                if e.name().as_ref() == b"w:t" {
                    in_text = true;
                }
            }
            Ok(Event::End(e)) => {
                if e.name().as_ref() == b"w:t" {
                    in_text = false;
                    out.push(' ');
                }
                if e.name().as_ref() == b"w:p" {
                    out.push('\n');
                }
            }
            Ok(Event::Text(t)) => {
                if in_text {
                    let raw_str = std::str::from_utf8(t.as_ref()).unwrap_or("");
                    let unescaped: Cow<'_, str> =
                        quick_xml::escape::unescape(raw_str).unwrap_or(Cow::Borrowed(raw_str));
                    out.push_str(&unescaped);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    Ok(out)
}

/// PPTX — ppt/slides/slide*.xml + notesSlides icindeki `<a:t>` metni.
pub fn extract_pptx_text(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    let slide_names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            archive.by_index(i).ok().and_then(|f| {
                let name = f.name().to_string();
                if (name.starts_with("ppt/slides/slide")
                    || name.starts_with("ppt/notesSlides/"))
                    && name.ends_with(".xml")
                {
                    Some(name)
                } else {
                    None
                }
            })
        })
        .collect();

    let mut out = String::new();
    for slide_name in slide_names {
        if let Ok(mut f) = archive.by_name(&slide_name) {
            let mut xml = String::new();
            if f.read_to_string(&mut xml).is_ok() {
                use quick_xml::events::Event;
                use quick_xml::Reader;
                let mut reader = Reader::from_str(&xml);
                reader.config_mut().trim_text(false);
                let mut buf = Vec::new();
                let mut in_text = false;
                loop {
                    match reader.read_event_into(&mut buf) {
                        Ok(Event::Start(e)) => {
                            let name = e.name();
                            if name.as_ref() == b"a:t" || name.as_ref() == b"a:r" {
                                in_text = true;
                            }
                        }
                        Ok(Event::End(e)) => {
                            let name = e.name();
                            if name.as_ref() == b"a:t" {
                                in_text = false;
                                out.push(' ');
                            }
                            if name.as_ref() == b"a:p" {
                                out.push('\n');
                            }
                        }
                        Ok(Event::Text(t)) => {
                            if in_text {
                                let raw_str = std::str::from_utf8(t.as_ref()).unwrap_or("");
                                let unescaped: Cow<'_, str> = quick_xml::escape::unescape(raw_str)
                                    .unwrap_or(Cow::Borrowed(raw_str));
                                out.push_str(&unescaped);
                            }
                        }
                        Ok(Event::Eof) | Err(_) => break,
                        _ => {}
                    }
                    buf.clear();
                }
            }
        }
    }

    if out.trim().is_empty() {
        return Err("PPTX: metin cikarilamadi".to_string());
    }
    Ok(out)
}

/// XLSX — sharedStrings.xml + xl/worksheets/sheet*.xml icindeki `<v>` degerleri.
pub fn extract_xlsx_text(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;

    let mut shared: Vec<String> = Vec::new();
    if let Ok(mut ss) = archive.by_name("xl/sharedStrings.xml") {
        let mut xml = String::new();
        ss.read_to_string(&mut xml).map_err(|e| e.to_string())?;
        shared = extract_all_text_nodes(&xml);
    }

    let mut out = String::new();
    for i in 0..archive.len() {
        let name = {
            let f = archive.by_index(i).map_err(|e| e.to_string())?;
            f.name().to_string()
        };
        if !name.starts_with("xl/worksheets/") || !name.ends_with(".xml") {
            continue;
        }
        let mut sheet = archive.by_name(&name).map_err(|e| e.to_string())?;
        let mut xml = String::new();
        sheet.read_to_string(&mut xml).map_err(|e| e.to_string())?;
        for v in extract_all_tag_text(&xml, "v") {
            if let Ok(idx) = v.trim().parse::<usize>() {
                if idx < shared.len() {
                    out.push_str(&shared[idx]);
                    out.push(' ');
                    continue;
                }
            }
            out.push_str(v.trim());
            out.push(' ');
        }
        out.push('\n');
    }
    Ok(out)
}

/// ODS — content.xml icindeki tum metin dugumleri.
pub fn extract_ods_text(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut content = archive
        .by_name("content.xml")
        .map_err(|_| "ODS: content.xml bulunamadi".to_string())?;
    let mut xml = String::new();
    content.read_to_string(&mut xml).map_err(|e| e.to_string())?;
    let out = extract_all_text_nodes(&xml).join(" ");
    if out.trim().is_empty() {
        return Err("ODS: metin cikarilamadi".to_string());
    }
    Ok(out)
}

/// Tum `Event::Text` dugumlerini topla (unescape edilmis, trim'li, bos olmayan).
fn extract_all_text_nodes(xml: &str) -> Vec<String> {
    use quick_xml::events::Event;
    use quick_xml::Reader;
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut out: Vec<String> = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Text(t)) => {
                let raw_str = std::str::from_utf8(t.as_ref()).unwrap_or("");
                let unescaped: Cow<'_, str> =
                    quick_xml::escape::unescape(raw_str).unwrap_or(Cow::Borrowed(raw_str));
                let s = unescaped.trim();
                if !s.is_empty() {
                    out.push(s.to_string());
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

/// `<tag>...</tag>` icerikleri (DOM kurmadan, hafif). XLSX gibi ongorulebilir XML icin.
fn extract_all_tag_text<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let open_tag = format!("<{tag}>");
    let close_tag = format!("</{tag}>");
    let mut start = 0usize;
    while let Some(pos) = xml[start..].find(&open_tag) {
        let a = start + pos + open_tag.len();
        if let Some(end_pos) = xml[a..].find(&close_tag) {
            let b = a + end_pos;
            out.push(&xml[a..b]);
            start = b + close_tag.len();
        } else {
            break;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tag_text_extraction() {
        let xml = "<row><v>0</v><v>merhaba</v></row>";
        assert_eq!(extract_all_tag_text(xml, "v"), vec!["0", "merhaba"]);
    }
}
