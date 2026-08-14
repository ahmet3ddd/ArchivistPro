//! Uzantidan basit MIME tipi tahmini (yaygin arsiv formatlari).

/// Kucuk-harf uzantidan MIME doner (bilinmiyorsa `None`).
pub fn mime_from_ext(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "pdf" => "application/pdf",
        "txt" | "text" | "log" => "text/plain",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "rtf" => "application/rtf",
        "md" => "text/markdown",
        "ifc" => "application/x-step",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        // Ofis (makro/sablon/ODF varyantlari — H2 EXTENSION_MAP genisligi).
        "xlsm" => "application/vnd.ms-excel.sheet.macroEnabled.12",
        "xlsb" => "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
        "xltx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
        "xltm" => "application/vnd.ms-excel.template.macroEnabled.12",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "webp" => "image/webp",
        "tga" => "image/x-tga",
        "svg" => "image/svg+xml",
        "psd" => "image/vnd.adobe.photoshop",
        // HDR / render cikti formatlari.
        "exr" => "image/x-exr",
        "hdr" => "image/vnd.radiance",
        "eps" => "application/postscript",
        "ai" => "application/illustrator",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "wmv" => "video/x-ms-wmv",
        "flv" => "video/x-flv",
        // ── CAD / BIM (H2 genis allowlist; onceden None → 📦/mime'siz) ──
        "dwg" => "image/vnd.dwg",
        "dxf" => "image/vnd.dxf",
        "dwf" => "model/vnd.dwf",
        "dwfx" => "model/vnd.dwfx",
        "dgn" => "image/vnd.dgn",
        "rvt" | "rfa" => "application/octet-stream",
        "ifczip" => "application/x-step",
        "step" | "stp" => "model/step",
        "igs" | "iges" => "model/iges",
        "pln" | "mod" | "plp" => "application/x-archicad",
        "vwx" => "application/x-vectorworks",
        "nwd" | "nwc" | "nwf" => "application/x-navisworks",
        // ── 3D mesh / sahne formatlari ──
        "skp" => "application/vnd.sketchup.skp",
        "max" => "application/octet-stream",
        "3ds" => "application/x-3ds",
        "blend" => "application/x-blender",
        "c4d" => "application/x-cinema4d",
        "3dm" => "application/x-rhino",
        "obj" => "model/obj",
        "mtl" => "model/mtl",
        "fbx" => "application/x-fbx",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "stl" => "model/stl",
        "ply" => "model/ply",
        "dae" => "model/vnd.collada+xml",
        // ── Nokta bulutu (lazer tarama) ──
        "e57" => "application/x-e57",
        "pts" | "ptx" => "application/x-pointcloud",
        // ── Yapisal analiz (SAP2000 / ETABS — CSi) ──
        "sdb" | "s2k" | "$2k" | "sap" => "application/x-sap2000",
        "e2k" | "edb" | "$et" => "application/x-etabs",
        // AutoCAD/DWG yardimci dosyalari — H2 §B "BAK kaynak-tespiti" (onceden None=taninmiyordu):
        // dwt/dws GERCEK DWG format; dwl/dwl2 kilit · sv$/$sv otokayit · bak yedek (DWG ailesi sidecar).
        "dwt" | "dws" => "image/vnd.dwg",
        "dwl" | "dwl2" | "dwl3" => "application/x-autocad-lock",
        "sv$" | "$sv" | "asv" => "application/x-autocad-autosave",
        "bak" | "~bak" => "application/x-backup",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::mime_from_ext;

    #[test]
    fn recognizes_common_and_autocad_sidecars() {
        assert_eq!(mime_from_ext("flv"), Some("video/x-flv"));
        assert_eq!(mime_from_ext("wmv"), Some("video/x-ms-wmv"));
        assert_eq!(mime_from_ext("dwg"), Some("image/vnd.dwg"));
        // §B BAK-kaynak tespiti: sidecar'lar artik None DEGIL (mime/scan taniyor).
        assert_eq!(mime_from_ext("dwl"), Some("application/x-autocad-lock"));
        assert_eq!(mime_from_ext("sv$"), Some("application/x-autocad-autosave"));
        assert_eq!(mime_from_ext("bak"), Some("application/x-backup"));
        assert_eq!(mime_from_ext("dwt"), Some("image/vnd.dwg"));
        assert_eq!(mime_from_ext("zzz"), None);
    }

    /// H2 genis allowlist paritesi: 3D/CAD/nokta-bulutu/yapisal/vektor/HDR formatlari artik
    /// mime tasir (onceden None → 📦/mime'siz "taninmiyor"du).
    #[test]
    fn recognizes_broad_3d_cad_formats() {
        // 3D mesh/sahne.
        for (ext, want) in [
            ("fbx", "application/x-fbx"),
            ("obj", "model/obj"),
            ("stl", "model/stl"),
            ("glb", "model/gltf-binary"),
            ("gltf", "model/gltf+json"),
            ("ply", "model/ply"),
            ("dae", "model/vnd.collada+xml"),
            ("3ds", "application/x-3ds"),
            ("blend", "application/x-blender"),
            ("3dm", "application/x-rhino"),
        ] {
            assert_eq!(mime_from_ext(ext), Some(want), "{ext}");
        }
        // CAD/BIM ek + muhendislik.
        assert_eq!(mime_from_ext("dgn"), Some("image/vnd.dgn"));
        assert_eq!(mime_from_ext("step"), Some("model/step"));
        assert_eq!(mime_from_ext("iges"), Some("model/iges"));
        assert_eq!(mime_from_ext("dwf"), Some("model/vnd.dwf"));
        // Nokta bulutu + yapisal analiz + vektor + HDR + raster ek.
        assert_eq!(mime_from_ext("e57"), Some("application/x-e57"));
        assert_eq!(mime_from_ext("sdb"), Some("application/x-sap2000"));
        assert_eq!(mime_from_ext("edb"), Some("application/x-etabs"));
        assert_eq!(mime_from_ext("svg"), Some("image/svg+xml"));
        assert_eq!(mime_from_ext("exr"), Some("image/x-exr"));
        assert_eq!(mime_from_ext("webp"), Some("image/webp"));
        assert_eq!(mime_from_ext("tga"), Some("image/x-tga"));
        // Yedek/otokayit ek.
        assert_eq!(mime_from_ext("asv"), Some("application/x-autocad-autosave"));
        assert_eq!(mime_from_ext("~bak"), Some("application/x-backup"));
    }
}
