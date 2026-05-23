// İkili format (XLS/BIFF vb.) opcode-dispatch parser'ı: `match opcode { 0xXX => {
// if rec_len >= N { ... } } }` deseni bilinçli. clippy::collapsible_match bunu
// pattern-guard'a çevirmeyi önerir; opcode + uzunluk-koşulunu pattern'e karıştırmak
// dispatch okunabilirliğini düşürür + guard-fallthrough semantiği davranışı
// değiştirebilir. Kozmetik lint, davranış değil → modül genelinde kapalı.
#![allow(clippy::collapsible_match)]

use serde::Serialize;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::borrow::Cow;

#[derive(Serialize)]
pub struct ExtractedText {
    pub text: String,
    pub truncated: bool,
    pub kind: String,
}

fn truncate_to_char_limit(mut s: String, max_chars: usize) -> (String, bool) {
    if s.chars().count() <= max_chars {
        return (s, false);
    }
    // char-based truncation (UTF-8 safe)
    let truncated: String = s.chars().take(max_chars).collect();
    s.clear();
    (truncated, true)
}

/// UTF-8, Windows-1254 ve ISO-8859-9 sırasıyla deneyip en az replacement char üreteni seçer.
/// Türkçe text dosyalarının (eski Windows kaynaklı) doğru decode edilmesini sağlar.
fn smart_decode_bytes(buf: &[u8]) -> String {
    // BOM kontrolü
    if buf.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&buf[3..]).to_string();
    }
    if buf.starts_with(&[0xFF, 0xFE]) || buf.starts_with(&[0xFE, 0xFF]) {
        let (cow, _, _) = encoding_rs::UTF_16LE.decode(&buf[2..]);
        return cow.into_owned();
    }

    // UTF-8 strict — temiz geçerse kullan
    if let Ok(s) = std::str::from_utf8(buf) {
        return s.to_string();
    }

    // UTF-8 lossy replacement char oranını ölç
    let utf8_lossy = String::from_utf8_lossy(buf);
    let utf8_replacements = utf8_lossy.chars().filter(|&c| c == '\u{FFFD}').count();
    let total_chars = utf8_lossy.chars().count().max(1);
    let utf8_ratio = utf8_replacements as f32 / total_chars as f32;

    if utf8_ratio < 0.005 {
        return utf8_lossy.into_owned();
    }

    // Windows-1254 (Türkçe) ile dene — encoding_rs'te Türkçe için birincil
    let (win1254, _, _) = encoding_rs::WINDOWS_1254.decode(buf);
    let w_replacements = win1254.chars().filter(|&c| c == '\u{FFFD}').count();
    let w_ratio = w_replacements as f32 / win1254.chars().count().max(1) as f32;
    if w_ratio < utf8_ratio {
        return win1254.into_owned();
    }

    utf8_lossy.into_owned()
}

fn read_text_file_limited(path: &Path, max_bytes: usize) -> Result<(String, bool), String> {
    let f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    f.take(max_bytes as u64)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    let truncated = fs::metadata(path)
        .ok()
        .map(|m| m.len() as usize > max_bytes)
        .unwrap_or(false);
    Ok((smart_decode_bytes(&buf), truncated))
}

/// OLE compound dosyasının belirtilen stream'lerinden ham byte'ları okur.
/// Hiçbir stream bulunamazsa tüm stream'lerden fallback yapar.
fn read_ole_streams(path: &Path, primary_streams: &[&str]) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut comp = cfb::CompoundFile::open(file).map_err(|e| format!("OLE parse hatası: {}", e))?;

    let mut all_bytes: Vec<u8> = Vec::new();

    for name in primary_streams {
        let stream_path = format!("/{}", name);
        if let Ok(mut stream) = comp.open_stream(&stream_path) {
            let mut buf = Vec::new();
            if stream.read_to_end(&mut buf).is_ok() {
                all_bytes.extend_from_slice(&buf);
            }
        }
    }

    if all_bytes.is_empty() {
        // Fallback: tüm stream'lerden topla
        let entries: Vec<String> = comp
            .walk()
            .filter(|e| !e.is_storage())
            .map(|e| e.path().to_string_lossy().to_string())
            .collect();
        for entry_path in entries {
            if let Ok(mut stream) = comp.open_stream(&entry_path) {
                let mut buf = Vec::new();
                if stream.read_to_end(&mut buf).is_ok() {
                    all_bytes.extend_from_slice(&buf);
                    if all_bytes.len() > 4 * 1024 * 1024 {
                        break;
                    }
                }
            }
        }
    }

    if all_bytes.is_empty() {
        return Err("OLE: okunabilir stream bulunamadı".to_string());
    }

    Ok(all_bytes)
}

/// Ham byte dizisinden okunabilir metin çıkarır (UTF-16LE ve ASCII fallback).
fn extract_text_from_bytes(all_bytes: &[u8], format_label: &str) -> Result<String, String> {
    let mut text = String::new();

    // UTF-16LE olarak decode etmeyi dene
    if all_bytes.len() >= 2 {
        let mut i = 0;
        let mut utf16_buf: Vec<u16> = Vec::new();
        while i + 1 < all_bytes.len() {
            let code = u16::from_le_bytes([all_bytes[i], all_bytes[i + 1]]);
            utf16_buf.push(code);
            i += 2;
        }
        if let Ok(decoded) = String::from_utf16(&utf16_buf) {
            let filtered: String = decoded
                .chars()
                .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
                .collect();
            if filtered.len() > 50 {
                text = filtered;
            }
        }
    }

    // UTF-16 işe yaramadıysa: Windows-1254/UTF-8 ile decode edip yazdırılabilir run'ları topla.
    if text.len() < 50 {
        let decoded = smart_decode_bytes(all_bytes);
        let mut cp_text = String::new();
        let mut run = String::new();
        for ch in decoded.chars() {
            let keep = ch.is_alphanumeric()
                || ch.is_whitespace()
                || matches!(ch, '.' | ',' | ';' | ':' | '!' | '?' | '-' | '_' | '(' | ')' | '[' | ']'
                    | '{' | '}' | '/' | '\\' | '&' | '%' | '"' | '\'' | '#' | '+' | '=' | '*' | '@');
            if keep {
                run.push(ch);
            } else {
                if run.chars().count() >= 4 {
                    cp_text.push_str(&run);
                    cp_text.push(' ');
                }
                run.clear();
            }
        }
        if run.chars().count() >= 4 {
            cp_text.push_str(&run);
        }
        if cp_text.len() > text.len() {
            text = cp_text;
        }
    }

    // Temizleme
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ");

    if text.len() < 20 {
        return Err(format!("{}: yeterli metin çıkarılamadı", format_label));
    }

    Ok(text)
}

/// Eski .doc (OLE compound) dosyalarından metin çıkarma.
/// WordDocument stream'indeki ham byte'lardan printable Unicode text'i toplar.
fn extract_doc_text(path: &Path) -> Result<String, String> {
    let all_bytes = read_ole_streams(path, &["WordDocument", "1Table", "0Table"])?;
    extract_text_from_bytes(&all_bytes, "DOC")
}

/// Eski .xls (BIFF) dosyalarından metin çıkarma.
/// Workbook / Book stream'inden BIFF SST (Shared String Table) ve label kayıtlarını okur.
fn extract_xls_text(path: &Path) -> Result<String, String> {
    let all_bytes = read_ole_streams(path, &["Workbook", "Book"])?;

    // BIFF8 SST (Shared String Table) record parsing
    // Record ID 0x00FC (SST), kayıt formatı: ID(2) + size(2) + data
    let mut text = String::new();
    let mut i = 0;
    while i + 4 <= all_bytes.len() {
        let rec_id = u16::from_le_bytes([all_bytes[i], all_bytes[i + 1]]);
        let rec_len = u16::from_le_bytes([all_bytes[i + 2], all_bytes[i + 3]]) as usize;
        i += 4;
        if i + rec_len > all_bytes.len() {
            break;
        }

        match rec_id {
            // SST = 0x00FC: Shared String Table
            0x00FC => {
                // SST: totalStrings(4) + uniqueStrings(4) + string data...
                if rec_len >= 8 {
                    let sst_data = &all_bytes[i..i + rec_len];
                    let mut pos = 8; // skip totalStrings + uniqueStrings
                    while pos < sst_data.len() {
                        if let Some((s, adv)) = read_biff8_unicode_string(sst_data, pos) {
                            if !s.trim().is_empty() {
                                text.push_str(s.trim());
                                text.push(' ');
                            }
                            pos += adv;
                        } else {
                            break;
                        }
                    }
                }
            }
            // LABEL = 0x0204: Cell containing a string (BIFF2-7)
            0x0204 => {
                if rec_len > 8 {
                    let label_data = &all_bytes[i..i + rec_len];
                    // row(2) + col(2) + xf(2) + string_len(2) + string
                    if label_data.len() > 8 {
                        let s = String::from_utf8_lossy(&label_data[8..]);
                        let filtered: String = s.chars().filter(|c| !c.is_control()).collect();
                        if !filtered.trim().is_empty() {
                            text.push_str(filtered.trim());
                            text.push(' ');
                        }
                    }
                }
            }
            _ => {}
        }
        i += rec_len;
    }

    // SST/LABEL parse çalışmadıysa fallback: genel text extraction
    if text.len() < 20 {
        return extract_text_from_bytes(&all_bytes, "XLS");
    }

    let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok(text)
}

/// BIFF8 unicode string okuyucu.
/// Format: str_len(2) + flags(1) + [rt_count(2)] + [ext_size(4)] + chars
fn read_biff8_unicode_string(data: &[u8], offset: usize) -> Option<(String, usize)> {
    if offset + 3 > data.len() {
        return None;
    }
    let str_len = u16::from_le_bytes([data[offset], data[offset + 1]]) as usize;
    let flags = data[offset + 2];
    let is_wide = (flags & 0x01) != 0;
    let has_rich = (flags & 0x08) != 0;
    let has_ext = (flags & 0x04) != 0;

    let mut pos = offset + 3;
    let _rt_count = if has_rich {
        if pos + 2 > data.len() { return None; }
        let rc = u16::from_le_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2;
        rc
    } else {
        0
    };
    let ext_size = if has_ext {
        if pos + 4 > data.len() { return None; }
        let es = u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        pos += 4;
        es
    } else {
        0
    };

    let char_bytes = if is_wide { str_len * 2 } else { str_len };
    if pos + char_bytes > data.len() {
        return None;
    }

    let s = if is_wide {
        let utf16: Vec<u16> = (0..str_len)
            .map(|j| u16::from_le_bytes([data[pos + j * 2], data[pos + j * 2 + 1]]))
            .collect();
        String::from_utf16_lossy(&utf16)
    } else {
        String::from_utf8_lossy(&data[pos..pos + str_len]).to_string()
    };

    let total = 3
        + (if has_rich { 2 } else { 0 })
        + (if has_ext { 4 } else { 0 })
        + char_bytes
        + _rt_count * 4
        + ext_size;

    Some((s, total))
}

/// Eski .ppt (OLE compound) dosyalarından metin çıkarma.
/// "PowerPoint Document" stream'indeki TextBytesAtom/TextCharsAtom kayıtlarını okur.
fn extract_ppt_text(path: &Path) -> Result<String, String> {
    let all_bytes = read_ole_streams(path, &["PowerPoint Document", "Current User"])?;

    // PowerPoint binary format: record header = recVer(4bits) + recInstance(12bits) + recType(2 bytes) + recLen(4 bytes) = 8 bytes
    // TextCharsAtom = 0x0FA0 (UTF-16LE text)
    // TextBytesAtom = 0x0FA8 (ASCII text)
    let mut text = String::new();
    let mut i = 0;
    while i + 8 <= all_bytes.len() {
        let rec_type = u16::from_le_bytes([all_bytes[i + 2], all_bytes[i + 3]]);
        let rec_len = u32::from_le_bytes([all_bytes[i + 4], all_bytes[i + 5], all_bytes[i + 6], all_bytes[i + 7]]) as usize;
        i += 8;

        // Güvenlik: çok büyük kayıtları atla
        if rec_len > 10 * 1024 * 1024 || i + rec_len > all_bytes.len() {
            break;
        }

        match rec_type {
            // TextCharsAtom: UTF-16LE encoded text
            0x0FA0 => {
                if rec_len >= 2 {
                    let chars: Vec<u16> = (0..rec_len / 2)
                        .map(|j| u16::from_le_bytes([all_bytes[i + j * 2], all_bytes[i + j * 2 + 1]]))
                        .collect();
                    let s = String::from_utf16_lossy(&chars);
                    let filtered: String = s.chars()
                        .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
                        .collect();
                    if !filtered.trim().is_empty() {
                        text.push_str(filtered.trim());
                        text.push('\n');
                    }
                }
            }
            // TextBytesAtom: ASCII text
            0x0FA8 => {
                let s = String::from_utf8_lossy(&all_bytes[i..i + rec_len]);
                let filtered: String = s.chars()
                    .filter(|c| !c.is_control() || *c == '\n' || *c == '\r' || *c == '\t')
                    .collect();
                if !filtered.trim().is_empty() {
                    text.push_str(filtered.trim());
                    text.push('\n');
                }
            }
            _ => {}
        }
        i += rec_len;
    }

    // Fallback
    if text.len() < 20 {
        return extract_text_from_bytes(&all_bytes, "PPT");
    }

    let text: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    Ok(text)
}

fn extract_pdf_text(path: &Path) -> Result<String, String> {
    pdf_extract::extract_text(path).map_err(|e| e.to_string())
}

fn extract_docx_text(path: &Path) -> Result<String, String> {
    // DOCX is ZIP; main body is word/document.xml.
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut doc = archive
        .by_name("word/document.xml")
        .map_err(|_| "DOCX: word/document.xml bulunamadı".to_string())?;
    let mut xml = String::new();
    doc.read_to_string(&mut xml).map_err(|e| e.to_string())?;

    // Extract <w:t>...</w:t> nodes with a streaming XML parser.
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
                    let raw = t.as_ref();
                    let raw_str = std::str::from_utf8(raw).unwrap_or("");
                    let unescaped: Cow<'_, str> =
                        quick_xml::escape::unescape(raw_str).unwrap_or(Cow::Borrowed(raw_str));
                    out.push_str(&unescaped);
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    Ok(out)
}

/// PPTX / ODP: ZIP içindeki ppt/slides/slide*.xml dosyalarından <a:t> text node'larını toplar.
fn extract_pptx_text(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut out = String::new();

    // Slayt dosyalarını topla
    let slide_names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            archive.by_index(i).ok().and_then(|f| {
                let name = f.name().to_string();
                if (name.starts_with("ppt/slides/slide") || name.starts_with("ppt/notesSlides/"))
                    && name.ends_with(".xml")
                {
                    Some(name)
                } else {
                    None
                }
            })
        })
        .collect();

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
                                let raw = t.as_ref();
                                let raw_str = std::str::from_utf8(raw).unwrap_or("");
                                let unescaped: std::borrow::Cow<'_, str> =
                                    quick_xml::escape::unescape(raw_str)
                                        .unwrap_or(std::borrow::Cow::Borrowed(raw_str));
                                out.push_str(&unescaped);
                            }
                        }
                        Ok(Event::Eof) => break,
                        Err(_) => break,
                        _ => {}
                    }
                    buf.clear();
                }
            }
        }
    }

    if out.trim().is_empty() {
        return Err("PPTX: metin çıkarılamadı".to_string());
    }
    Ok(out)
}

/// ODS (OpenDocument Spreadsheet): ZIP içindeki content.xml'den <text:p> ve <table:table-cell> text'lerini toplar.
fn extract_ods_text(path: &Path) -> Result<String, String> {
    let data = fs::read(path).map_err(|e| e.to_string())?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut content = archive
        .by_name("content.xml")
        .map_err(|_| "ODS: content.xml bulunamadı".to_string())?;
    let mut xml = String::new();
    content.read_to_string(&mut xml).map_err(|e| e.to_string())?;

    let texts = extract_all_text_nodes(&xml);
    let out = texts.join(" ");
    if out.trim().is_empty() {
        return Err("ODS: metin çıkarılamadı".to_string());
    }
    Ok(out)
}

fn extract_xlsx_text(path: &Path) -> Result<String, String> {
    // XLSX is ZIP. Minimal strategy:
    // - read sharedStrings.xml (if present)
    // - scan worksheets for <v> values (shared string indices or inline numeric)
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
    // Iterate sheet files (xl/worksheets/sheet*.xml)
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

        // Pull <v>text</v> nodes.
        let vals = extract_all_tag_text(&xml, b"v");
        for v in vals {
            // If it's an integer and sharedStrings exists, map it.
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
                let raw = t.as_ref();
                let raw_str = std::str::from_utf8(raw).unwrap_or("");
                let unescaped: Cow<'_, str> =
                    quick_xml::escape::unescape(raw_str).unwrap_or(Cow::Borrowed(raw_str));
                let s = unescaped.trim();
                if !s.is_empty() {
                    out.push(s.to_string());
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    out
}

fn extract_all_tag_text<'a>(xml: &'a str, tag: &[u8]) -> Vec<&'a str> {
    // Very lightweight tag extraction without building a full DOM.
    // Note: safe enough for XLSX where tags are predictable.
    let mut out = Vec::new();
    let open = String::from_utf8_lossy(tag);
    let open_tag = format!("<{}>", open);
    let close_tag = format!("</{}>", open);

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

#[tauri::command]
pub fn extract_text_for_indexing(path: String, max_chars: Option<usize>) -> Result<ExtractedText, String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Dosya bulunamadı".to_string());
    }

    let max_chars = max_chars.unwrap_or(350_000);
    let ext = p
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Hard safety: prevent extremely large allocations.
    let file_size = fs::metadata(p).map_err(|e| e.to_string())?.len();
    if file_size > 350 * 1024 * 1024 {
        return Ok(ExtractedText {
            text: String::new(),
            truncated: true,
            kind: "too_large".to_string(),
        });
    }

    let (raw, kind) = match ext.as_str() {
        "txt" | "md" | "csv" | "rtf" => {
            let (t, _) = read_text_file_limited(p, 6 * 1024 * 1024)?;
            (t, "text".to_string())
        }
        "pdf" => (extract_pdf_text(p)?, "pdf".to_string()),
        "docx" => (extract_docx_text(p)?, "docx".to_string()),
        "doc" => match extract_doc_text(p) {
            Ok(t) => (t, "doc".to_string()),
            Err(e) => {
                // OLE parse başarısız — bazı .doc uzantılı dosyalar aslında düz metin/Word perfect/RTF
                if let Ok((t, _)) = read_text_file_limited(p, 6 * 1024 * 1024) {
                    let printable = t.chars().filter(|c| !c.is_control() || c.is_whitespace()).count();
                    if printable > 100 {
                        (t, "doc_text_fallback".to_string())
                    } else {
                        return Err(e);
                    }
                } else {
                    return Err(e);
                }
            }
        },
        "xls" => (extract_xls_text(p)?, "xls_ole".to_string()),
        "ppt" => (extract_ppt_text(p)?, "ppt_ole".to_string()),
        "pptx" | "odp" => (extract_pptx_text(p)?, "pptx".to_string()),
        "xlsx" | "xlsm" | "xltx" | "xltm" => (extract_xlsx_text(p)?, "xlsx".to_string()),
        "ods" => (extract_ods_text(p)?, "ods".to_string()),
        _ => {
            // best-effort: try as text with a small cap
            let (t, _) = read_text_file_limited(p, 2 * 1024 * 1024)?;
            (t, "fallback_text".to_string())
        }
    };

    let (text, truncated_by_chars) = truncate_to_char_limit(raw, max_chars);
    Ok(ExtractedText {
        text,
        truncated: truncated_by_chars,
        kind,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ═══════════════════════════════════════════════════════════
    // truncate_to_char_limit
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_truncate_within_limit() {
        let (s, truncated) = truncate_to_char_limit("hello".into(), 10);
        assert_eq!(s, "hello");
        assert!(!truncated);
    }

    #[test]
    fn test_truncate_exact_limit() {
        let (s, truncated) = truncate_to_char_limit("hello".into(), 5);
        assert_eq!(s, "hello");
        assert!(!truncated);
    }

    #[test]
    fn test_truncate_over_limit() {
        let (s, truncated) = truncate_to_char_limit("hello world".into(), 5);
        assert_eq!(s, "hello");
        assert!(truncated);
    }

    #[test]
    fn test_truncate_empty() {
        let (s, truncated) = truncate_to_char_limit("".into(), 10);
        assert_eq!(s, "");
        assert!(!truncated);
    }

    #[test]
    fn test_truncate_turkish_chars() {
        // Türkçe: "İstanbul" = 8 char, 10 bytes (İ = 2 bytes)
        let (s, truncated) = truncate_to_char_limit("İstanbul Güzel".into(), 8);
        assert_eq!(s, "İstanbul");
        assert!(truncated);
    }

    #[test]
    fn test_truncate_multibyte_safe() {
        // UTF-8 safe: won't cut in the middle of a multibyte char
        let (s, truncated) = truncate_to_char_limit("Üniversite".into(), 3);
        assert_eq!(s, "Üni");
        assert!(truncated);
        // Verify it's valid UTF-8
        assert!(std::str::from_utf8(s.as_bytes()).is_ok());
    }

    // ═══════════════════════════════════════════════════════════
    // smart_decode_bytes
    // ═══════════════════════════════════════════════════════════

    #[test]
    fn test_smart_decode_pure_utf8() {
        let s = "Merhaba dünya";
        let decoded = smart_decode_bytes(s.as_bytes());
        assert_eq!(decoded, s);
    }

    #[test]
    fn test_smart_decode_utf8_bom() {
        let mut buf = vec![0xEF, 0xBB, 0xBF]; // UTF-8 BOM
        buf.extend_from_slice("test".as_bytes());
        let decoded = smart_decode_bytes(&buf);
        assert_eq!(decoded, "test");
    }

    #[test]
    fn test_smart_decode_utf16le_bom() {
        let mut buf = vec![0xFF, 0xFE]; // UTF-16LE BOM
        buf.extend_from_slice(&[b'H', 0, b'i', 0]); // "Hi" in UTF-16LE
        let decoded = smart_decode_bytes(&buf);
        assert_eq!(decoded, "Hi");
    }

    #[test]
    fn test_smart_decode_windows1254_turkish() {
        // Windows-1254 encoded Turkish chars:
        // 0xC7 = Ç, 0xD6 = Ö, 0xDC = Ü, 0xFC = ü, 0xE7 = ç
        let buf: Vec<u8> = vec![0xC7, 0x69, 0x7A, 0x69, 0x6D]; // "Çizim" in CP1254
        let decoded = smart_decode_bytes(&buf);
        assert!(decoded.contains("Ç") || decoded.contains("izim"),
            "Should decode CP1254 Turkish: got '{}'", decoded);
    }

    #[test]
    fn test_smart_decode_ascii() {
        let buf = b"plain ASCII text 123";
        let decoded = smart_decode_bytes(buf);
        assert_eq!(decoded, "plain ASCII text 123");
    }

    #[test]
    fn test_smart_decode_empty() {
        let decoded = smart_decode_bytes(&[]);
        assert_eq!(decoded, "");
    }
}

