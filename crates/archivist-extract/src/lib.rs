//! archivist-extract — Arsiv-H3 cikarim cekirdegi (plugin/registry).
//!
//! Faz 2'nin omurgasi: H2'nin kanitlanmis dosya/format parser'lari bu cekirdegin
//! `Extractor` trait'i arkasinda aile crate'lerine (`archivist-extract-text`,
//! `-image`, `-cad`) tasinir ve bir [`Registry`]'ye kaydolur.
//!
//! ## Ilkeler
//! 1. **Cekirdek hafif** — sifir agir bagimlilik (yalniz serde + thiserror). Agir
//!    parse dep'leri (image, cfb, zip, pdf-extract) aile crate'lerinde kalir; boylece
//!    cekirdegi bagimsiz test edilir + H2'nin monolit-rlib cokusu tekrarlanmaz.
//! 2. **Panik-guvenli sinir** — [`Registry::extract`] her extractor cagrisini
//!    `catch_unwind` ile sarar: kotu-bicimli bir ikili dosya (ozellikle DWG) bir
//!    extractor'i paniklerse, tum ingest sureci dusmek yerine temiz
//!    [`ExtractError::Panicked`] alir. (Bunun calismasi icin workspace `panic = "abort"`
//!    AYARLAMAZ — varsayilan unwind korunur.)
//! 3. **Sidecar-hazir** — [`ExtractInput`]/[`Extracted`] serde-serileştirilebilir;
//!    ileride bir extractor out-of-process sidecar'a tasinirsa bu tipler IPC ile gecer.
//! 4. **Saf kutuphane (Faz 2 kapsami)** — extractor'lar tipli struct dondurur, DB'ye
//!    YAZMAZ. Kalicilastirma/ingest sonraki faza ait.

pub mod datetime;
pub mod decode;
pub mod error;
pub mod geometry;
pub mod golden;
pub mod registry;
pub mod types;

pub use decode::decode_bytes;
pub use error::ExtractError;
pub use registry::{Extractor, Registry, DEFAULT_EXTRACT_TIMEOUT, DEFAULT_MAX_SIZE};
pub use types::{
    Color, ExtractInput, Extracted, ExtractedShape, MetaValue, ShapeFeatures, Thumbnail,
};
