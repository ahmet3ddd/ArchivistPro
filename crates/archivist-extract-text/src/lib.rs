//! archivist-extract-text — Arsiv-H3 metin/dokuman cikaricilari.
//!
//! H2'nin kanitlanmis metin-tabanli parser'lari, [`archivist_extract::Extractor`]
//! trait'i arkasinda. Hepsi saf-Rust (DXF/IFC/metin) veya hafif-kutuphane (PDF);
//! harici arac yok.
//!
//! Aileyi tek cagri ile kaydetmek icin [`register`] kullanin.

pub mod ifc;
pub mod office;
pub mod pdf;
pub mod text;

pub use ifc::IfcExtractor;
pub use office::OfficeExtractor;
pub use pdf::PdfExtractor;
pub use text::TextExtractor;

use archivist_extract::Registry;

/// Bu ailenin tum extractor'larini verilen registry'ye kaydeder.
pub fn register(reg: &mut Registry) {
    reg.register(IfcExtractor);
    reg.register(TextExtractor);
    reg.register(PdfExtractor);
    reg.register(OfficeExtractor);
}
