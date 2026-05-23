//! Ortak thumbnail JPEG (base64 data URL) kodlama ve renk yapıları.
use base64::{engine::general_purpose, Engine as _};
use image::imageops::FilterType;
use std::io::Cursor;

#[derive(serde::Serialize)]
pub struct DominantColor {
    pub hex: String,
    pub percentage: f32,
}

/// 200×200 JPEG base64 data URL üretir.
pub(crate) fn encode_thumb(img: image::DynamicImage) -> Option<String> {
    let thumb = img.resize(200, 200, FilterType::Triangle);
    let mut buf = Cursor::new(Vec::new());
    thumb.write_to(&mut buf, image::ImageFormat::Jpeg).ok()?;
    let b64 = general_purpose::STANDARD.encode(buf.get_ref());
    Some(format!("data:image/jpeg;base64,{}", b64))
}
