//! DXF ENTITIES geometri cikarimi — LINE/CIRCLE/ARC/LWPOLYLINE/POLYLINE → sekil.
//!
//! H2 `dxf_parse.rs` shape kismi naklı. Sekil oznitelikleri core `geometry` ile
//! hesaplanir (DXF + gorsel shape-match ortak). Faz 4.3 sekil-aramasinin girdisi.

use archivist_extract::{geometry, ShapeFeatures};

/// DXF'ten cikan tek geometrik sekil.
#[derive(Debug, Clone)]
pub struct DxfShape {
    pub entity_type: String,
    pub layer_name: String,
    pub vertex_count: u32,
    pub is_closed: bool,
    pub features: ShapeFeatures,
    pub bbox_w: f64,
    pub bbox_h: f64,
    pub centroid_x: f64,
    pub centroid_y: f64,
}

fn parse_f64(s: &str) -> Option<f64> {
    s.trim().parse().ok()
}
fn parse_i32(s: &str) -> Option<i32> {
    s.trim().parse().ok()
}

fn empty_features() -> ShapeFeatures {
    ShapeFeatures {
        area: 0.0,
        perimeter: 0.0,
        aspect_ratio: 0.0,
        regularity: 0.0,
        compactness: 0.0,
        solidity: 0.0,
        rectangularity: 0.0,
    }
}

/// Kapali/acik poligondan DxfShape kur (core geometry ile).
fn build_polygon_shape(
    entity_type: &str,
    layer: String,
    verts: &[(f64, f64)],
    is_closed: bool,
) -> DxfShape {
    let (bbox_w, bbox_h) = geometry::polygon_bbox(verts);
    let (cx, cy) = geometry::polygon_centroid(verts);
    let features = if is_closed {
        geometry::shape_features(verts)
    } else {
        let perimeter = geometry::polygon_perimeter(verts, false);
        ShapeFeatures {
            area: 0.0,
            perimeter,
            aspect_ratio: if bbox_h > 1e-9 { bbox_w / bbox_h } else { 0.0 },
            regularity: 0.0,
            compactness: 0.0,
            solidity: 0.0,
            rectangularity: 0.0,
        }
    };
    DxfShape {
        entity_type: entity_type.to_string(),
        layer_name: layer,
        vertex_count: verts.len() as u32,
        is_closed,
        features,
        bbox_w,
        bbox_h,
        centroid_x: cx,
        centroid_y: cy,
    }
}

fn parse_line_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let (mut x1, mut y1, mut x2, mut y2) = (None, None, None, None);
    let mut idx = 1;
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 {
            break;
        }
        match *code {
            8 => layer = value.clone(),
            10 => x1 = parse_f64(value),
            20 => y1 = parse_f64(value),
            11 => x2 = parse_f64(value),
            21 => y2 = parse_f64(value),
            _ => {}
        }
        idx += 1;
    }
    let (x1, y1, x2, y2) = (x1?, y1?, x2?, y2?);
    let length = ((x2 - x1).powi(2) + (y2 - y1).powi(2)).sqrt();
    let (bbox_w, bbox_h) = ((x2 - x1).abs(), (y2 - y1).abs());
    let features = ShapeFeatures {
        area: 0.0,
        perimeter: length,
        aspect_ratio: if bbox_h > 1e-9 { bbox_w / bbox_h } else { 0.0 },
        ..empty_features()
    };
    Some((
        DxfShape {
            entity_type: "LINE".to_string(),
            layer_name: layer,
            vertex_count: 2,
            is_closed: false,
            features,
            bbox_w,
            bbox_h,
            centroid_x: (x1 + x2) / 2.0,
            centroid_y: (y1 + y2) / 2.0,
        },
        idx,
    ))
}

fn parse_circle_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let (mut cx, mut cy, mut r) = (None, None, None);
    let mut idx = 1;
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 {
            break;
        }
        match *code {
            8 => layer = value.clone(),
            10 => cx = parse_f64(value),
            20 => cy = parse_f64(value),
            40 => r = parse_f64(value),
            _ => {}
        }
        idx += 1;
    }
    let (cx, cy, r) = (cx?, cy?, r?);
    if r <= 0.0 {
        return None;
    }
    let features = ShapeFeatures {
        area: std::f64::consts::PI * r * r,
        perimeter: 2.0 * std::f64::consts::PI * r,
        aspect_ratio: 1.0,
        regularity: 1.0,
        compactness: 1.0,
        solidity: 1.0,
        rectangularity: std::f64::consts::FRAC_PI_4,
    };
    Some((
        DxfShape {
            entity_type: "CIRCLE".to_string(),
            layer_name: layer,
            vertex_count: 1,
            is_closed: true,
            features,
            bbox_w: 2.0 * r,
            bbox_h: 2.0 * r,
            centroid_x: cx,
            centroid_y: cy,
        },
        idx,
    ))
}

fn parse_arc_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let (mut cx, mut cy, mut r, mut s_deg, mut e_deg) = (None, None, None, None, None);
    let mut idx = 1;
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 {
            break;
        }
        match *code {
            8 => layer = value.clone(),
            10 => cx = parse_f64(value),
            20 => cy = parse_f64(value),
            40 => r = parse_f64(value),
            50 => s_deg = parse_f64(value),
            51 => e_deg = parse_f64(value),
            _ => {}
        }
        idx += 1;
    }
    let (cx, cy, r, s, e) = (cx?, cy?, r?, s_deg?, e_deg?);
    if r <= 0.0 {
        return None;
    }
    let sweep_deg = {
        let mut d = e - s;
        while d < 0.0 {
            d += 360.0;
        }
        while d > 360.0 {
            d -= 360.0;
        }
        d
    };
    let features = ShapeFeatures {
        perimeter: r * sweep_deg.to_radians(),
        aspect_ratio: 1.0,
        ..empty_features()
    };
    Some((
        DxfShape {
            entity_type: "ARC".to_string(),
            layer_name: layer,
            vertex_count: 1,
            is_closed: false,
            features,
            bbox_w: 2.0 * r,
            bbox_h: 2.0 * r,
            centroid_x: cx,
            centroid_y: cy,
        },
        idx,
    ))
}

fn parse_lwpolyline_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let mut flags = 0;
    let mut verts: Vec<(f64, f64)> = Vec::new();
    let mut pending_x: Option<f64> = None;
    let mut idx = 1;
    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 {
            break;
        }
        match *code {
            8 => layer = value.clone(),
            70 => flags = parse_i32(value).unwrap_or(0),
            10 => {
                if let Some(x) = pending_x.take() {
                    verts.push((x, 0.0));
                }
                pending_x = parse_f64(value);
            }
            20 => {
                if let (Some(x), Some(y)) = (pending_x.take(), parse_f64(value)) {
                    verts.push((x, y));
                }
            }
            _ => {}
        }
        idx += 1;
    }
    if verts.is_empty() {
        return None;
    }
    Some((build_polygon_shape("LWPOLYLINE", layer, &verts, (flags & 1) == 1), idx))
}

fn parse_polyline_entity(pairs: &[(i32, String)]) -> Option<(DxfShape, usize)> {
    let mut layer = String::from("0");
    let mut flags = 0;
    let mut verts: Vec<(f64, f64)> = Vec::new();
    let mut idx = 1;

    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 {
            if value == "VERTEX" || value == "SEQEND" {
                break;
            }
            return if verts.is_empty() {
                None
            } else {
                Some((build_polygon_shape("POLYLINE", layer, &verts, (flags & 1) == 1), idx))
            };
        }
        match *code {
            8 => layer = value.clone(),
            70 => flags = parse_i32(value).unwrap_or(0),
            _ => {}
        }
        idx += 1;
    }

    while idx < pairs.len() {
        let (code, value) = &pairs[idx];
        if *code == 0 {
            if value == "VERTEX" {
                let (mut vx, mut vy) = (None, None);
                idx += 1;
                while idx < pairs.len() {
                    let (c2, v2) = &pairs[idx];
                    if *c2 == 0 {
                        break;
                    }
                    match *c2 {
                        10 => vx = parse_f64(v2),
                        20 => vy = parse_f64(v2),
                        _ => {}
                    }
                    idx += 1;
                }
                if let (Some(x), Some(y)) = (vx, vy) {
                    verts.push((x, y));
                }
            } else if value == "SEQEND" {
                idx += 1;
                while idx < pairs.len() && pairs[idx].0 != 0 {
                    idx += 1;
                }
                break;
            } else {
                break;
            }
        } else {
            idx += 1;
        }
    }

    if verts.is_empty() {
        return None;
    }
    Some((build_polygon_shape("POLYLINE", layer, &verts, (flags & 1) == 1), idx))
}

/// ENTITIES bolumunu dolas, tum geometrik sekilleri cikar.
pub fn parse_dxf_shapes(pairs: &[(i32, String)]) -> Vec<DxfShape> {
    let mut shapes = Vec::new();
    let mut in_entities = false;
    let mut i = 0;
    while i < pairs.len() {
        let (code, value) = &pairs[i];
        if *code == 2 && value == "ENTITIES" {
            in_entities = true;
            i += 1;
            continue;
        }
        if *code == 0 && value == "ENDSEC" && in_entities {
            in_entities = false;
            i += 1;
            continue;
        }
        if !in_entities {
            i += 1;
            continue;
        }
        if *code == 0 {
            let result = match value.as_str() {
                "LINE" => parse_line_entity(&pairs[i..]),
                "CIRCLE" => parse_circle_entity(&pairs[i..]),
                "ARC" => parse_arc_entity(&pairs[i..]),
                "LWPOLYLINE" => parse_lwpolyline_entity(&pairs[i..]),
                "POLYLINE" => parse_polyline_entity(&pairs[i..]),
                _ => None,
            };
            if let Some((shape, consumed)) = result {
                shapes.push(shape);
                i += consumed;
                continue;
            }
        }
        i += 1;
    }
    shapes
}

/// Arama-degerli sekilleri tut (tekil LINE'lar haric; cok-segmentli/kapali/yay).
pub fn filter_searchable_shapes(shapes: Vec<DxfShape>) -> Vec<DxfShape> {
    shapes
        .into_iter()
        .filter(|s| {
            if s.is_closed {
                s.vertex_count >= 3 || s.entity_type == "CIRCLE"
            } else {
                match s.entity_type.as_str() {
                    "LWPOLYLINE" | "POLYLINE" => s.vertex_count >= 3,
                    "ARC" => true,
                    _ => false,
                }
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs_from_str(s: &str) -> Vec<(i32, String)> {
        let mut pairs = Vec::new();
        let mut lines = s.lines();
        while let Some(code_line) = lines.next() {
            let code_line = code_line.trim();
            if code_line.is_empty() {
                continue;
            }
            let Ok(code) = code_line.parse::<i32>() else { continue };
            let Some(value) = lines.next() else { break };
            pairs.push((code, value.trim().to_string()));
        }
        pairs
    }

    fn approx(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn line_parsing() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nWALLS\n10\n0.0\n20\n0.0\n11\n3.0\n21\n4.0\n0\nENDSEC\n";
        let shapes = parse_dxf_shapes(&pairs_from_str(dxf));
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].entity_type, "LINE");
        assert!(approx(shapes[0].features.perimeter, 5.0));
    }

    #[test]
    fn circle_parsing() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nCIRCLE\n8\nP\n10\n5.0\n20\n10.0\n40\n2.0\n0\nENDSEC\n";
        let shapes = parse_dxf_shapes(&pairs_from_str(dxf));
        assert_eq!(shapes.len(), 1);
        assert!(shapes[0].is_closed);
        assert!(approx(shapes[0].features.area, std::f64::consts::PI * 4.0));
        assert!(approx(shapes[0].features.regularity, 1.0));
    }

    #[test]
    fn lwpolyline_square_closed() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\nR\n90\n4\n70\n1\n10\n0.0\n20\n0.0\n10\n5.0\n20\n0.0\n10\n5.0\n20\n5.0\n10\n0.0\n20\n5.0\n0\nENDSEC\n";
        let shapes = parse_dxf_shapes(&pairs_from_str(dxf));
        assert_eq!(shapes.len(), 1);
        let s = &shapes[0];
        assert!(s.is_closed);
        assert_eq!(s.vertex_count, 4);
        assert!(approx(s.features.area, 25.0));
        assert!(s.features.regularity > 0.95);
    }

    #[test]
    fn polyline_classic_triangle() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nPOLYLINE\n8\nT\n70\n1\n0\nVERTEX\n8\nT\n10\n0.0\n20\n0.0\n0\nVERTEX\n8\nT\n10\n4.0\n20\n0.0\n0\nVERTEX\n8\nT\n10\n0.0\n20\n3.0\n0\nSEQEND\n0\nENDSEC\n";
        let shapes = parse_dxf_shapes(&pairs_from_str(dxf));
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].vertex_count, 3);
        assert!(approx(shapes[0].features.area, 6.0));
    }

    #[test]
    fn outside_entities_ignored() {
        let dxf = "0\nSECTION\n2\nBLOCKS\n0\nCIRCLE\n8\nL\n10\n0\n20\n0\n40\n1\n0\nENDSEC\n";
        assert!(parse_dxf_shapes(&pairs_from_str(dxf)).is_empty());
    }

    #[test]
    fn filter_drops_single_lines() {
        let dxf = "0\nSECTION\n2\nENTITIES\n0\nLINE\n8\nA\n10\n0\n20\n0\n11\n1\n21\n0\n0\nCIRCLE\n8\nB\n10\n5\n20\n5\n40\n1\n0\nENDSEC\n";
        let raw = parse_dxf_shapes(&pairs_from_str(dxf));
        assert_eq!(raw.len(), 2);
        let filtered = filter_searchable_shapes(raw);
        assert_eq!(filtered.len(), 1); // LINE elendi, CIRCLE kaldi
        assert_eq!(filtered[0].entity_type, "CIRCLE");
    }
}
