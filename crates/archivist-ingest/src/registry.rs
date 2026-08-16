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

    /// **Onizleme beklenen** her raster/video uzantisinin bir cikaricisi OLMALI.
    ///
    /// Kayit defterinde bulunmayan uzanti hicbir uyari uretmez: hat baslamaz, dosya sessizce
    /// onizlemesiz kalir ve — gorsel analizi onizleme uzerinden calistigi icin — AI taramasina da
    /// hic girmez. Kullanicinin arsivinde 45 webp + 9 ico dosyasi tam boyle kaybolmustu
    /// (2026-08-16). Yeni bir onizlenebilir format eklenirken bu liste de buyur.
    ///
    /// ⚠️ `svg` BILEREK disarida: vektor rasterlestirme yeni bir bagimlilik (resvg) demek —
    /// urun karari, sessiz bir eksiklik degil.
    #[test]
    fn preview_capable_extensions_have_an_extractor() {
        let reg = build_registry();
        for ext in [
            // raster gorseller
            "jpg", "jpeg", "png", "bmp", "tif", "tiff", "tga", "gif", "psd", "webp", "ico",
            // video / animasyon
            "mp4", "m4v", "mov", "avi", "mkv", "webm", "flv", "wmv",
        ] {
            assert!(
                reg.for_ext(ext).is_some(),
                "{ext}: onizleme beklenen bir uzanti ama hicbir cikarici sahiplenmiyor → \
                 dosyalar sessizce onizlemesiz ve AI-taramasi disi kalir"
            );
        }
    }
}
