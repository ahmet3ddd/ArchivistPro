//! archivist-extract-cad — Arsiv-H3 CAD/3D cikaricilari.
//!
//! H2'nin DWG/DXF/Revit/SketchUp/3ds-Max parser'lari. DWG ve DXF tek crate'te
//! (DXF, DWG'nin CFBF/CLSID/OLE/version yardimcilarini paylasir; ASCII halidir).
//! Riskli DWG ikili-parser'i `Registry`'nin `catch_unwind` siniriyla izole; ODA
//! harici donusturucu opsiyonel + zarif dusus.

pub mod dwg;
pub mod dxf;
pub mod max;
pub mod oda;
pub mod rvt;
pub mod skp;

pub use dwg::DwgExtractor;
pub use dxf::DxfExtractor;
pub use max::MaxExtractor;
pub use rvt::RvtExtractor;
pub use skp::SkpExtractor;

use archivist_extract::Registry;

/// Bu ailenin tum *dosya-indeksleme* extractor'larini kaydeder.
///
/// Not: [`oda`] DWG→DXF donusumu bir Extractor DEGIL (opsiyonel opt-in yardimci) →
/// kaydedilmez; ODA varsa daha zengin cikarim icin `oda::extract_dwg` cagrilir.
pub fn register(reg: &mut Registry) {
    reg.register(DwgExtractor);
    reg.register(DxfExtractor);
    reg.register(RvtExtractor);
    reg.register(SkpExtractor);
    reg.register(MaxExtractor);
}
