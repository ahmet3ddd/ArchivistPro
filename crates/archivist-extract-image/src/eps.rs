//! EPS (Encapsulated PostScript) cikaricisi — thumbnail (binary-EPS gomulu TIFF onizleme; H2
//! `get_eps_thumbnail` = [`archivist_thumbnail::eps_thumbnail`]) + DSC yorum metadata'si
//! (`%%BoundingBox` → boyut · `%%Creator` → software). ASCII EPS'te (binary onizleme yok)
//! thumbnail URETILEMEZ (PostScript render Ghostscript ister → offline-oncelik disi) → yalniz
//! metadata + uyari (zarif-dususluk). Boylece EPS de dosya-listesinde onizlemeli gorunur.

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor};

/// EPS ust boyut siniri (gomulu onizleme + PostScript govdesi).
const MAX_EPS_SIZE: u64 = 200 * 1024 * 1024;
/// DSC yorumlarini arayacagimiz prefix — onizleme+yorumlar dosya BASINDA; dev govdeyi cevirmeyiz.
const HEADER_SCAN: usize = 64 * 1024;

/// EPS cikaricisi.
pub struct EpsExtractor;

impl Extractor for EpsExtractor {
    fn id(&self) -> &'static str {
        "eps"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["eps"]
    }
    fn max_size(&self) -> u64 {
        MAX_EPS_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let mut out = Extracted::new();
        out.set("format", "eps");
        let data = std::fs::read(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;

        // DSC yorumlari (ASCII) — binary-EPS'te de PostScript govdesinde metin olarak bulunur.
        // Yalniz prefix taranir (yorumlar bastadir; dev dosyayi UTF-8'e cevirmeyiz).
        let head = &data[..data.len().min(HEADER_SCAN)];
        let text = String::from_utf8_lossy(head);
        for line in text.lines() {
            let l = line.trim_start();
            if let Some(bb) = l.strip_prefix("%%BoundingBox:") {
                if let Some((w, h)) = parse_bbox(bb) {
                    out.set("width", w);
                    out.set("height", h);
                }
            } else if let Some(v) = l.strip_prefix("%%Creator:") {
                let v = v.trim();
                if !v.is_empty() {
                    out.set("software", v);
                }
            }
        }

        // Thumbnail: yalniz binary-EPS gomulu TIFF onizleme (H2 get_eps_thumbnail portu).
        match archivist_thumbnail::eps_thumbnail(&data) {
            Some(t) => out.thumbnail = Some(t),
            None => out.warn(
                "EPS: gomulu onizleme yok (yalniz binary-EPS TIFF onizleme desteklenir; ASCII EPS Ghostscript ister)",
            ),
        }
        Ok(out)
    }
}

/// `%%BoundingBox: llx lly urx ury` → (genislik, yukseklik). `(atend)` / eksik / gecersiz → None.
fn parse_bbox(s: &str) -> Option<(u32, u32)> {
    let nums: Vec<f64> = s.split_whitespace().filter_map(|t| t.parse::<f64>().ok()).collect();
    if nums.len() < 4 {
        return None;
    }
    let w = (nums[2] - nums[0]).round();
    let h = (nums[3] - nums[1]).round();
    if w > 0.0 && h > 0.0 && w < 200_000.0 && h < 200_000.0 {
        Some((w as u32, h as u32))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bbox_valid_and_invalid() {
        assert_eq!(parse_bbox(" 0 0 612 792"), Some((612, 792)));
        assert_eq!(parse_bbox(" 10 20 110 70"), Some((100, 50)));
        // (atend) / eksik alan → None.
        assert_eq!(parse_bbox(" (atend)"), None);
        assert_eq!(parse_bbox(" 0 0 100"), None);
        // Sifir/negatif alan → None.
        assert_eq!(parse_bbox(" 5 5 5 5"), None);
    }

    #[test]
    fn ascii_eps_gives_dims_creator_and_warns_no_thumbnail() {
        let path = std::env::temp_dir().join("arsiv_h3_eps_extractor_test.eps");
        std::fs::write(
            &path,
            b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 200 100\n%%Creator: TestApp 1.0\n%%EndComments\nshowpage\n",
        )
        .unwrap();
        let input = ExtractInput::from_path(&path).unwrap();
        let out = EpsExtractor.extract(&input).unwrap();
        let _ = std::fs::remove_file(&path);

        assert_eq!(out.fields.get("width"), Some(&200u32.into()));
        assert_eq!(out.fields.get("height"), Some(&100u32.into()));
        assert_eq!(out.fields.get("software"), Some(&"TestApp 1.0".into()));
        assert!(out.thumbnail.is_none(), "ASCII EPS → gomulu onizleme yok");
        assert!(out.warnings.iter().any(|w| w.contains("onizleme yok")));
    }
}
