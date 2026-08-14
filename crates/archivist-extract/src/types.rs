//! Cikarim cikti sozlesmesi — tum extractor'larin ortak tipleri.
//!
//! [`Extracted`] bilincli olarak iki katmanlidir:
//! - **Tipli alanlar** ([`Extracted::phash`], [`dominant_colors`](Extracted::dominant_colors),
//!   [`shape`](Extracted::shape)): DOWNSTREAM arama semantigi olanlar (dedup, shape-match)
//!   ilk-sinif tip alir.
//! - **Alan torbasi** ([`Extracted::fields`]): format'a ozgu serbest metadata
//!   (page_count, version, author...) tipli [`MetaValue`] olarak.
//!
//! Tum tipler serde-serileştirilebilir (golden snapshot + sidecar-hazirlik).

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Extractor'a verilen girdi.
///
/// **Serileştirilebilir** — ileride bir extractor out-of-process sidecar'a tasinirsa
/// bu yapi IPC ile gonderilir.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractInput {
    /// Dosyanin mutlak yolu.
    pub path: PathBuf,
    /// Normalize edilmis (kucuk harf, noktasiz) uzanti — registry dispatch anahtari.
    pub ext: String,
    /// Dosya boyutu (bayt) — registry boyut korumasi icin.
    pub size_bytes: u64,
}

impl ExtractInput {
    /// Yoldan girdi turet: uzanti + boyut dosya sisteminden okunur.
    pub fn from_path(path: impl Into<PathBuf>) -> std::io::Result<Self> {
        let path = path.into();
        let meta = std::fs::metadata(&path)?;
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        Ok(Self { path, ext, size_bytes: meta.len() })
    }
}

/// Tek bir tipli metadata degeri (format-bagimsiz alan torbasi icin).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MetaValue {
    Str(String),
    Int(i64),
    Float(f64),
    Bool(bool),
}

impl From<String> for MetaValue {
    fn from(v: String) -> Self {
        MetaValue::Str(v)
    }
}
impl From<&str> for MetaValue {
    fn from(v: &str) -> Self {
        MetaValue::Str(v.to_owned())
    }
}
impl From<i64> for MetaValue {
    fn from(v: i64) -> Self {
        MetaValue::Int(v)
    }
}
impl From<i32> for MetaValue {
    fn from(v: i32) -> Self {
        MetaValue::Int(i64::from(v))
    }
}
impl From<u32> for MetaValue {
    fn from(v: u32) -> Self {
        MetaValue::Int(i64::from(v))
    }
}
impl From<usize> for MetaValue {
    fn from(v: usize) -> Self {
        MetaValue::Int(v as i64)
    }
}
impl From<f64> for MetaValue {
    fn from(v: f64) -> Self {
        MetaValue::Float(v)
    }
}
impl From<bool> for MetaValue {
    fn from(v: bool) -> Self {
        MetaValue::Bool(v)
    }
}

/// Tum extractor'larin ortak cikti sozlesmesi.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Extracted {
    /// FTS `body` yakiti — tam metin (pdf/office/ifc/dxf/text). `None` = metin yok.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub text: Option<String>,
    /// Format'a ozgu tipli metadata (page_count, version, author, width...).
    #[serde(skip_serializing_if = "BTreeMap::is_empty", default)]
    pub fields: BTreeMap<String, MetaValue>,
    /// Uretilen kucuk resim (varsa). Cekirdek yalniz tasir; uretim aile crate'inde.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub thumbnail: Option<Thumbnail>,
    /// Algisal hash (gorseller) — Faz 6 dedup.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub phash: Option<u64>,
    /// Baskin renkler (gorseller).
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub dominant_colors: Vec<Color>,
    /// Geometrik sekil oznitelikleri (dxf-geom / gorsel shape-match) — Faz 4.3.
    ///
    /// **TEKIL** (or. bir gorselin tek maskesi). Coklu-sekil (DXF/DWG cizim basina 1:N)
    /// icin [`shapes`](Extracted::shapes) alanina bak — bu alandan AYRIDIR.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub shape: Option<ShapeFeatures>,
    /// Cikarilan TUM geometrik sekiller (**1:N** — DXF/DWG cizim basina cok sekil). Bos =
    /// sekilsiz (DWG raw-scan / geometri uretmeyen format). Tekil [`shape`](Extracted::shape)
    /// alanindan AYRI; sekil-aramasi (Faz 4.3 Dilim 2) bu listeyi `asset_shapes`'e akitir.
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub shapes: Vec<ExtractedShape>,
    /// Otomatik etiketler (or. "is_render").
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub auto_tags: Vec<String>,
    /// Zarif-dususluk izleri (or. "ODA yok: sinirli ikili tarama").
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub warnings: Vec<String>,
}

impl Extracted {
    /// Bos cikti.
    pub fn new() -> Self {
        Self::default()
    }

    /// `fields` torbasina tipli bir deger koy (ergonomik kisa yol).
    pub fn set(&mut self, key: impl Into<String>, val: impl Into<MetaValue>) {
        self.fields.insert(key.into(), val.into());
    }

    /// Bir zarif-dususluk uyarisi ekle.
    pub fn warn(&mut self, msg: impl Into<String>) {
        self.warnings.push(msg.into());
    }
}

/// Kucuk resim — ham kodlanmis baytlar + MIME.
///
/// Cekirdek goruntu ISLEMEZ (agir `image` dep'i aile crate'lerinde); yalniz sonucu
/// tasir. `bytes` zaten kodlanmis (genelde JPEG/PNG) thumbnail icerigidir.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Thumbnail {
    pub bytes: Vec<u8>,
    pub mime: String,
    pub width: u32,
    pub height: u32,
}

/// RGB renk + bu rengin gorseldeki yuzdesi (baskin renk analizi).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub percentage: f32,
}

/// Geometrik sekil oznitelikleri — DXF geometri ve gorsel shape-match ORTAK kullanir.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ShapeFeatures {
    pub area: f64,
    pub perimeter: f64,
    pub aspect_ratio: f64,
    pub regularity: f64,
    pub compactness: f64,
    pub solidity: f64,
    pub rectangularity: f64,
}

/// Cikarilan tek geometrik sekil — DB `ShapeInput` ile **BIREBIR duz alan kumesi**.
///
/// [`ShapeFeatures`] burada bilincli olarak **duzlestirilir** (area/perimeter/... alanlari
/// aciktan) + bbox/centroid eklenir → `archivist-ingest` bunu dogrudan `archivist_db::ShapeInput`'a
/// map'ler (crate kuplaji YOK: `archivist-db` extract'e bagimli DEGIL, kopru ingest'te).
/// `layer_category` DB tarafinda `categorize_layer` ile TURETILIR → burada YOK (ham `layer_name`).
///
/// `PartialEq`: [`Extracted`] `PartialEq` turetir → coklu-sekil alani da `PartialEq` olmali
/// (ayrica `ShapeFeatures`/`Color` ile tutarli; golden karsilastirma icin).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ExtractedShape {
    pub entity_type: String,
    pub layer_name: Option<String>,
    pub vertex_count: i64,
    pub is_closed: bool,
    pub area: f64,
    pub perimeter: f64,
    pub aspect_ratio: f64,
    pub regularity: f64,
    pub compactness: f64,
    pub solidity: f64,
    pub rectangularity: f64,
    pub bbox_w: f64,
    pub bbox_h: f64,
    pub centroid_x: f64,
    pub centroid_y: f64,
}
