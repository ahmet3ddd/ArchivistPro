//! Tum extractor ailelerini tek registry'ye toplayan kurucu.

use archivist_extract::Registry;

/// text + image + cad ailelerinin tum extractor'larini kaydedip registry doner.
pub fn build_registry() -> Registry {
    let mut reg = Registry::new();
    archivist_extract_text::register(&mut reg);
    archivist_extract_image::register(&mut reg);
    archivist_extract_cad::register(&mut reg);
    reg
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_known_extensions() {
        let reg = build_registry();
        for ext in ["pdf", "ifc", "txt", "docx", "jpg", "mp4", "dwg", "dxf", "rvt", "skp", "max"] {
            assert!(reg.for_ext(ext).is_some(), "{ext} kayitli olmali");
        }
    }
}
