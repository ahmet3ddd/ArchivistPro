//! 3ds Max (MAX) — CFB/OLE surum tespiti (read-only). H2 `max_version.rs` naklı.
//!
//! CFB stream'lerinde `"3ds Max Version: XX"` (ASCII + UTF-16LE) aranir; XX yili
//! `XX + 1998` ile verir (V10/Max2008+). **NOT:** H2'nin `convert_max_version`
//! (dosya damgasini MUTASYONA ugratir) ve `detect_max_installations` (sistem sorgusu)
//! KAPSAM DISI — cikarim degil; geri-alinamaz/araç islemleri (karar-kapisi).

use std::io::Read;

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor, Thumbnail};
use cfb::CompoundFile;

/// MAX ust boyut siniri (H2 ile ayni): 500 MB.
const MAX_MAX_SIZE: u64 = 500 * 1024 * 1024;
/// Tekil stream tavani.
const MAX_STREAM_SIZE: usize = 50 * 1024 * 1024;

/// 3ds Max dosyalari icin extractor.
pub struct MaxExtractor;

impl Extractor for MaxExtractor {
    fn id(&self) -> &'static str {
        "max"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["max"]
    }
    fn max_size(&self) -> u64 {
        MAX_MAX_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let file =
            std::fs::File::open(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
        let mut comp =
            CompoundFile::open(file).map_err(|e| ExtractError::Parse(format!("CFB: {e}")))?;

        let stream_paths: Vec<_> =
            comp.walk().filter(|e| e.is_stream()).map(|e| e.path().to_path_buf()).collect();

        let pattern_ascii: &[u8] = b"3ds Max Version: ";
        let pattern_utf16: Vec<u8> =
            "3ds Max Version: ".encode_utf16().flat_map(u16::to_le_bytes).collect();

        let mut version: Option<String> = None;
        let mut thumb: Option<Thumbnail> = None;
        for stream_path in &stream_paths {
            let Ok(mut stream) = comp.open_stream(stream_path) else { continue };
            let mut buf = Vec::new();
            if stream.read_to_end(&mut buf).is_err() || buf.len() > MAX_STREAM_SIZE {
                continue;
            }
            // Thumbnail: OLE SummaryInformation prop 0x11 (CF_DIB/JPEG/PNG). Diger stream'leri
            // taramayiz (50MB tavanli → pahali); standart konum SummaryInformation'dir.
            if thumb.is_none() && stream_path.to_string_lossy().contains("SummaryInformation") {
                thumb = archivist_thumbnail::ole_thumbnail(&buf);
            }
            if version.is_some() {
                if thumb.is_some() {
                    break;
                }
                continue;
            }
            if let Some(pos) = buf.windows(pattern_ascii.len()).position(|w| w == pattern_ascii) {
                let after = &buf[pos + pattern_ascii.len()..];
                let digits: Vec<u8> =
                    after.iter().take(10).take_while(|&&b| b.is_ascii_digit()).copied().collect();
                if let Some(label) = max_version_label(&digits) {
                    version = Some(label);
                }
            }
            if let Some(pos) =
                buf.windows(pattern_utf16.len()).position(|w| w == pattern_utf16.as_slice())
            {
                let after = &buf[pos + pattern_utf16.len()..];
                let digits: Vec<u8> = after
                    .chunks(2)
                    .take_while(|c| c.len() == 2 && c[0].is_ascii_digit() && c[1] == 0)
                    .map(|c| c[0])
                    .collect();
                if let Some(label) = max_version_label(&digits) {
                    version = Some(label);
                }
            }
        }

        let mut out = Extracted::new();
        if let Some(v) = version {
            out.set("version", v);
        }
        out.set("stream_count", stream_paths.len());
        out.thumbnail = thumb;
        Ok(out)
    }
}

/// Surum rakamlari → etiket. V>=10 → yil = V+1998; aksi `3ds Max V`.
pub fn max_version_label(digits: &[u8]) -> Option<String> {
    if digits.is_empty() {
        return None;
    }
    let v: u32 = std::str::from_utf8(digits).ok()?.parse().ok()?;
    Some(if v >= 10 {
        format!("{} (V{v})", v + 1998)
    } else {
        format!("3ds Max {v} (V{v})")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_label_mapping() {
        assert_eq!(max_version_label(b"21").as_deref(), Some("2019 (V21)"));
        assert_eq!(max_version_label(b"27").as_deref(), Some("2025 (V27)"));
        assert_eq!(max_version_label(b"8").as_deref(), Some("3ds Max 8 (V8)"));
        assert_eq!(max_version_label(b""), None);
        assert_eq!(max_version_label(b"xx"), None);
    }
}
