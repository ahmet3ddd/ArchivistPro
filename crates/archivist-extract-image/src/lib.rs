//! archivist-extract-image — Arsiv-H3 gorsel/video/sekil cikaricilari.
//!
//! H2'nin kanitlanmis gorsel analizleri (EXIF, pHash, CIELAB baskin renk, thumbnail),
//! MP4 metadata ve sekil-cikarim algoritmalari [`archivist_extract::Extractor`] trait'i
//! arkasinda. Agir `image` + `kamadak-exif` bagimliliklari bu crate'te izole.

pub mod eps;
pub mod image_meta;
pub mod shape;
pub mod video;

pub use eps::EpsExtractor;
pub use image_meta::{
    compute_phash_bits, dominant_colors, dominant_colors_from_bytes, hamming_distance, lab_dist_sq,
    srgb_to_lab, ImageExtractor,
};
pub use shape::{extract_shape, extract_shape_from_bytes, extract_shape_from_path, ImageShapeResult};
pub use video::VideoExtractor;

use archivist_extract::Registry;

/// Bu ailenin tum *dosya-indeksleme* extractor'larini kaydeder.
///
/// Not: [`shape`] sekil-cikarimi bir Extractor DEGIL (sorgu-ani yardimci) → kaydedilmez.
pub fn register(reg: &mut Registry) {
    reg.register(ImageExtractor);
    reg.register(VideoExtractor);
    reg.register(EpsExtractor);
}
