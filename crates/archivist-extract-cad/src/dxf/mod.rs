//! DXF (ASCII/UTF-8) — grup-kodu parser. H2 `dxf_parse.rs` naklı.
//!
//! DXF, DWG'nin ASCII halidir; CFBF/CLSID/OLE/version yardimcilarini [`crate::dwg`]
//! ile paylasir. Sekil geometrisi [`shapes`] modulunde (core geometry).
//! Grup-kodu ayristirma yardimcilari [`parse`] alt-modulunde.

pub mod shapes;

mod parse;

use archivist_extract::{ExtractError, ExtractInput, Extracted, ExtractedShape, Extractor};

use crate::dwg::fields::DrawingProperties;
use crate::dxf::shapes::DxfShape;

use parse::{
    extract_dxf_blocks, extract_dxf_creation_date, extract_dxf_image_refs, extract_dxf_layers,
    extract_dxf_ole_objects, extract_dxf_properties, extract_dxf_texts, extract_dxf_units,
    extract_dxf_version, extract_dxf_xrefs, read_dxf_pairs,
};

/// DXF ust boyut siniri (H2 ile ayni): 200 MB.
const MAX_DXF_SIZE: u64 = 200 * 1024 * 1024;
const JOIN_CAP: usize = 4000;

/// DXF dosyalari icin extractor.
pub struct DxfExtractor;

impl Extractor for DxfExtractor {
    fn id(&self) -> &'static str {
        "dxf"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["dxf"]
    }
    fn max_size(&self) -> u64 {
        MAX_DXF_SIZE
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let data = std::fs::read(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
        let pairs = read_dxf_pairs(&data).map_err(ExtractError::Parse)?;

        let layers = extract_dxf_layers(&pairs);
        let blocks = extract_dxf_blocks(&pairs);
        let texts = extract_dxf_texts(&pairs);
        let xrefs = extract_dxf_xrefs(&pairs);
        let image_refs = extract_dxf_image_refs(&pairs);
        let ole_objects = extract_dxf_ole_objects(&pairs);
        let props = extract_dxf_properties(&pairs);
        let (unit_type, scale) = extract_dxf_units(&pairs);
        let version = extract_dxf_version(&pairs);
        let creation_date = extract_dxf_creation_date(&pairs);
        // Aranabilir sekilleri HESAPLA + TUT (H2 gurultu elemesi: filter_searchable_shapes tekil
        // LINE'lari eler). Eskiden yalniz sayi tutuluyordu; artik `out.shapes`'e de akitiyoruz.
        let searchable_shapes =
            shapes::filter_searchable_shapes(shapes::parse_dxf_shapes(&pairs));

        let mut out = Extracted::new();
        if let Some(v) = version {
            out.set("version", v);
        }
        out.set("layer_count", layers.len());
        out.set("block_count", blocks.len());
        out.set("text_count", texts.len());
        out.set("xref_count", xrefs.len());
        out.set("image_ref_count", image_refs.len());
        out.set("ole_count", ole_objects.len());
        out.set("searchable_shape_count", searchable_shapes.len());
        // Coklu-sekil ciktisi: her aranabilir sekli duz `ExtractedShape`'e map'le → ingest bunu
        // `asset_shapes`'e akitir (Faz 4.3 Dilim 2). Sayi metadata'si (yukarida) KORUNUR.
        out.shapes = searchable_shapes.iter().map(dxf_shape_to_extracted).collect();

        set_props(&mut out, &props);
        if let Some(v) = unit_type {
            out.set("unit_type", v);
        }
        if let Some(v) = scale {
            out.set("scale", v);
        }
        if let Some(v) = creation_date {
            out.set("creation_date", v);
        }
        join_field(&mut out, "layers", &layers);
        join_field(&mut out, "blocks", &blocks);
        join_field(&mut out, "xrefs", &xrefs);
        join_field(&mut out, "image_refs", &image_refs);
        join_field(&mut out, "ole_objects", &ole_objects);

        let mut body: Vec<String> = Vec::new();
        body.extend(texts);
        body.extend(layers);
        body.extend(blocks);
        if !body.is_empty() {
            out.text = Some(body.join("\n"));
        }
        Ok(out)
    }
}

/// Bir [`DxfShape`]'i cikarim-sozlesmesi [`ExtractedShape`]'e **duzlestir** (features alanlari
/// aciktan; bbox/centroid dogrudan). Saf + test-edilebilir (DB'ye bagimsiz). `layer_name` her
/// zaman doludur (parser varsayilani "0") → `Some(...)`; DB tarafinda `layer_category` turetilir.
fn dxf_shape_to_extracted(s: &DxfShape) -> ExtractedShape {
    let f = &s.features;
    ExtractedShape {
        entity_type: s.entity_type.clone(),
        layer_name: Some(s.layer_name.clone()),
        vertex_count: i64::from(s.vertex_count),
        is_closed: s.is_closed,
        area: f.area,
        perimeter: f.perimeter,
        aspect_ratio: f.aspect_ratio,
        regularity: f.regularity,
        compactness: f.compactness,
        solidity: f.solidity,
        rectangularity: f.rectangularity,
        bbox_w: s.bbox_w,
        bbox_h: s.bbox_h,
        centroid_x: s.centroid_x,
        centroid_y: s.centroid_y,
    }
}

fn set_props(out: &mut Extracted, props: &DrawingProperties) {
    for (key, val) in [
        ("title", &props.title),
        ("subject", &props.subject),
        ("author", &props.author),
        ("keywords", &props.keywords),
        ("comments", &props.comments),
        ("last_saved_by", &props.last_saved_by),
    ] {
        if let Some(v) = val {
            out.set(key, v.clone());
        }
    }
}

fn join_field(out: &mut Extracted, key: &str, items: &[String]) {
    if items.is_empty() {
        return;
    }
    let mut joined = items.join("; ");
    if joined.chars().count() > JOIN_CAP {
        joined = joined.chars().take(JOIN_CAP).collect();
    }
    out.set(key, joined);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `dxf_shape_to_extracted`: DxfShape → ExtractedShape alan-alan birebir (features duzlestirilir,
    /// bbox/centroid/layer/vertex/is_closed dogrudan). Kuplaj-serbest map'in sozlesmesi.
    #[test]
    fn dxf_shape_maps_to_extracted_fieldwise() {
        let s = DxfShape {
            entity_type: "LWPOLYLINE".to_string(),
            layer_name: "DUVAR".to_string(),
            vertex_count: 4,
            is_closed: true,
            features: archivist_extract::ShapeFeatures {
                area: 25.0,
                perimeter: 20.0,
                aspect_ratio: 1.0,
                regularity: 0.98,
                compactness: 0.9,
                solidity: 1.0,
                rectangularity: 1.0,
            },
            bbox_w: 5.0,
            bbox_h: 5.0,
            centroid_x: 2.5,
            centroid_y: 2.5,
        };
        let e = dxf_shape_to_extracted(&s);
        assert_eq!(e.entity_type, "LWPOLYLINE");
        assert_eq!(e.layer_name.as_deref(), Some("DUVAR"));
        assert_eq!(e.vertex_count, 4);
        assert!(e.is_closed);
        assert_eq!(e.area, 25.0);
        assert_eq!(e.perimeter, 20.0);
        assert_eq!(e.aspect_ratio, 1.0);
        assert_eq!(e.regularity, 0.98);
        assert_eq!(e.compactness, 0.9);
        assert_eq!(e.solidity, 1.0);
        assert_eq!(e.rectangularity, 1.0);
        assert_eq!(e.bbox_w, 5.0);
        assert_eq!(e.bbox_h, 5.0);
        assert_eq!(e.centroid_x, 2.5);
        assert_eq!(e.centroid_y, 2.5);
    }
}
