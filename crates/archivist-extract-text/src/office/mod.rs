//! Office belgeleri — DOC/DOCX, XLS/XLSX, PPT/PPTX, ODS/ODP.
//!
//! Tek [`OfficeExtractor`] hem metin (FTS body, [`text`] modulu) hem zengin metadata
//! ([`meta`] modulu) cikarir. Eski OLE (magic `D0 CF`) ve OOXML/ODF (magic `PK`) ayrimi
//! ilk baytlardan yapilir.

pub mod meta;
pub mod text;

use std::io::{Cursor, Read};

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor, Thumbnail};

use meta::OfficeMeta;

/// Office ust boyut siniri (H2 ile ayni): 200 MB.
const MAX_OFFICE_SIZE: u64 = 200 * 1024 * 1024;
/// FTS body icin azami karakter (H2 indeksleme tavani).
const MAX_TEXT_CHARS: usize = 350_000;

/// Office belge cikaricisi.
pub struct OfficeExtractor;

impl Extractor for OfficeExtractor {
    fn id(&self) -> &'static str {
        "office"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["doc", "docx", "xls", "xlsx", "xlsm", "xltx", "xltm", "ppt", "pptx", "ods", "odp"]
    }
    fn max_size(&self) -> u64 {
        MAX_OFFICE_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let data = std::fs::read(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;

        let mut out = Extracted::new();

        // ── Zengin metadata (magic'e gore OOXML vs OLE) ──
        let mut m = OfficeMeta::default();
        if data.len() >= 4 && &data[0..4] == b"PK\x03\x04" {
            m.file_format = meta::detect_zip_subtype(&data);
            meta::extract_ooxml_metadata(&data, &mut m);
        } else if data.len() >= 4 && data[0] == 0xD0 && data[1] == 0xCF {
            m.file_format = meta::detect_ole_subtype(&data);
            meta::extract_ole_metadata(&data, &mut m);
        } else {
            m.file_format = input.ext.clone();
        }
        apply_meta(&mut out, &m);

        // ── Metin (FTS body) — uzantiya gore dispatch ──
        let p = input.path.as_path();
        let result: Result<String, String> = match input.ext.as_str() {
            "doc" => text::extract_doc_text(p),
            "docx" => text::extract_docx_text(p),
            "xls" => text::extract_xls_text(p),
            "xlsx" | "xlsm" | "xltx" | "xltm" => text::extract_xlsx_text(p),
            "ppt" => text::extract_ppt_text(p),
            "pptx" | "odp" => text::extract_pptx_text(p),
            "ods" => text::extract_ods_text(p),
            other => Err(format!("desteklenmeyen office uzantisi: {other}")),
        };
        match result {
            Ok(t) => {
                let trimmed = t.trim();
                if !trimmed.is_empty() {
                    out.set("has_text", true);
                    out.text = Some(truncate_chars(trimmed, MAX_TEXT_CHARS));
                } else {
                    out.set("has_text", false);
                }
            }
            Err(e) => {
                out.set("has_text", false);
                out.warn(format!("office metin cikarma basarisiz: {e}"));
            }
        }

        // ── Thumbnail: OOXML docProps/thumbnail.* (zip) veya OLE SummaryInformation prop 0x11 ──
        out.thumbnail = office_thumbnail(&data);

        Ok(out)
    }
}

/// Office gomulu thumbnail (H2 get_office_thumbnail sadik portu). OOXML (PK): zip icinde
/// `docProps/thumbnail.{jpeg,jpg,png}`. Eski OLE (D0 CF): `\x05SummaryInformation` prop 0x11
/// (ortak `ole_thumbnail`). EMF/WMF (vektor) atlanir — `image` crate cozmez.
fn office_thumbnail(data: &[u8]) -> Option<Thumbnail> {
    if data.len() >= 4 && &data[0..4] == b"PK\x03\x04" {
        let mut archive = zip::ZipArchive::new(Cursor::new(data)).ok()?;
        for name in ["docProps/thumbnail.jpeg", "docProps/thumbnail.jpg", "docProps/thumbnail.png"] {
            if let Ok(mut f) = archive.by_name(name) {
                let mut buf = Vec::new();
                if f.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                    if let Some(t) = archivist_thumbnail::thumbnail_from_bytes(&buf) {
                        return Some(t);
                    }
                }
            }
        }
        None
    } else if data.len() >= 4 && data[0] == 0xD0 && data[1] == 0xCF {
        let mut comp = cfb::CompoundFile::open(Cursor::new(data)).ok()?;
        let mut stream = comp.open_stream("\u{5}SummaryInformation").ok()?;
        let mut buf = Vec::new();
        stream.read_to_end(&mut buf).ok()?;
        archivist_thumbnail::ole_thumbnail(&buf)
    } else {
        None
    }
}

/// OfficeMeta → Extracted.fields (yalniz dolu alanlar).
fn apply_meta(out: &mut Extracted, m: &OfficeMeta) {
    if !m.file_format.is_empty() {
        out.set("file_format", m.file_format.clone());
    }
    if let Some(v) = &m.title {
        out.set("title", v.clone());
    }
    if let Some(v) = &m.author {
        out.set("author", v.clone());
    }
    if let Some(v) = &m.subject {
        out.set("subject", v.clone());
    }
    if let Some(v) = &m.keywords {
        out.set("keywords", v.clone());
    }
    if let Some(v) = &m.last_modified_by {
        out.set("last_modified_by", v.clone());
    }
    if let Some(v) = &m.created_at {
        out.set("created_at", v.clone());
    }
    if let Some(v) = &m.modified_at {
        out.set("modified_at", v.clone());
    }
    if let Some(v) = m.page_count {
        out.set("page_count", v);
    }
    if let Some(v) = m.word_count {
        out.set("word_count", v);
    }
    if let Some(v) = m.slide_count {
        out.set("slide_count", v);
    }
    if !m.sheet_names.is_empty() {
        out.set("sheet_names", m.sheet_names.join("; "));
    }
}

/// Karakter-guvenli kesme (UTF-8 ortasindan kesmez).
fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}
