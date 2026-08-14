//! Per-dosya hazirlama/yazma + Replace-modu temizleme (prune).
//!
//! Worker thread'inde (db'siz) `prepare_one` bir dosyayi [`Prepared`]'e cevirir; ana thread'de
//! `write_prepared` onu DB'ye yazar. `prune_missing` Replace modunda kayip dosyalari cope atar.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use archivist_db::{
    classify_image_kind, is_raster_image_ext, AssetInput, Db, Fingerprint, ImageKind, IngestData,
    MetaVal, ShapeInput, ThumbnailInput, DOMINANT_COLORS_METADATA_KEY,
};
use archivist_extract::{Extracted, ExtractInput, ExtractedShape, MetaValue, Registry, Thumbnail};

use crate::{hash, mime};

use super::{root_accessible, root_prefix, IngestOpts};

/// Bir dosyanin DB'ye YAZIMA hazir tum verisi — worker thread'inde (db'siz) uretilir,
/// ana thread'e tasinir (owned: kanaldan gecer). `prepare_one` doldurur, `write_prepared` yazar.
pub(super) struct Prepared {
    pub(super) path: String,
    pub(super) file_name: String,
    pub(super) ext: Option<String>,
    pub(super) size: i64,
    pub(super) created: i64,
    pub(super) mtime: i64,
    pub(super) content_hash: String,
    pub(super) mime: Option<&'static str>,
    /// `true` → bu yol DB'de zaten var (guncelleme); `false` → yeni ekleme.
    pub(super) is_update: bool,
    pub(super) fts_body: Option<String>,
    pub(super) metadata: Vec<(String, MetaVal)>,
    pub(super) auto_tags: Vec<String>,
    pub(super) phash: Option<i64>,
    pub(super) title: Option<String>,
    pub(super) thumbnail: Option<Thumbnail>,
    /// Cikarilan geometrik sekiller (DXF/DWG-via-ODA). Bos → sekilsiz (no-op yazimda).
    pub(super) shapes: Vec<ExtractedShape>,
    /// Katman 1 gorsel-turu (raster gorsellerde cikarilan sinyallerden; `None` → yazilmaz).
    pub(super) image_kind: Option<ImageKind>,
    pub(super) warns: Vec<String>,
}

/// Worker'in tek dosya icin urettigi sonuc (db'siz). `Ready` buyuk → `Box`'la (enum sismesin).
pub(super) enum PrepResult {
    /// Degismemis & indeksli → hash/extract yapilmadi.
    Skip,
    /// Olumcul hata (stat/hash) — bu dosya indekslenemez.
    Error(String),
    /// Yazima hazir.
    Ready(Box<Prepared>),
}

/// [`prune_missing`] sonucu — `Blocked` guvenlik kapisinin silmeyi REDDETTIGINI ayirt eder
/// (hata DEGIL: arsiv BILINCLI korundu → cagiran uyari yazar, `removed` 0 kalir).
pub(super) enum PruneOutcome {
    /// N asset cope atildi (gercekten kaybolan dosyalar).
    Pruned(usize),
    /// Koruma devreye girdi — silme yapilmadi (sebep mesaji).
    Blocked(String),
}

/// **Replace modu temizleme:** `root` altinda DB'de AKTIF olup `files` (taranan = diskte
/// var olan) kumesinde OLMAYAN asset'leri COPE at (soft-delete). Disk dogruluk kaynagi →
/// silinmis dosyalar arsivde de "cop"e duser (geri-alinabilir).
///
/// **KORUMA (footgun-fix):** kaynak kok erisilemez VEYA tarama 0 dosya buldu ama arsivde bu
/// kok altinda AKTIF kayit varsa → kaynak gecici/kalici erisilemez kabul edilir → `Blocked`
/// (SILME YOK). Bilincli toplu-silme icin cop kutusu UI'si vardir (bu yol sessiz mass-delete
/// yapmaz). Aksi halde `Pruned(n)` (n = cope atilan).
pub(super) fn prune_missing(db: &mut Db, root: &Path, files: &[PathBuf]) -> Result<PruneOutcome, String> {
    let prefix = root_prefix(root);
    let existing = db.active_paths_under(&prefix).map_err(|e| e.to_string())?;

    if !root_accessible(root) {
        return Ok(PruneOutcome::Blocked(format!(
            "kaynak kok erisilemez ({}) — kayip-dosya temizligi atlandi, arsiv korundu",
            root.display()
        )));
    }
    if files.is_empty() && !existing.is_empty() {
        return Ok(PruneOutcome::Blocked(format!(
            "kaynak kokte 0 dosya tarandi ama arsivde {} kayit var — kaynak erisilemez/bos olabilir; temizlik atlandi",
            existing.len()
        )));
    }

    let keep: HashSet<String> = files.iter().map(|p| p.to_string_lossy().to_string()).collect();
    let gone: Vec<i64> = existing
        .into_iter()
        .filter(|(_, path)| !keep.contains(path))
        .map(|(id, _)| id)
        .collect();
    let n = db.soft_delete(&gone).map_err(|e| e.to_string())?;
    Ok(PruneOutcome::Pruned(n))
}

/// **Worker (db'siz, paralel):** tek dosyayi yazima hazirla — stat + (parmak-izi haritasiyla)
/// atlama karari + hash + extract. DB'ye DOKUNMAZ (parmak izleri `fps` haritasindan; SQLite
/// worker thread'lerinde paylasilamaz). Sonuc owned [`Prepared`] → kanaldan ana thread'e gecer.
pub(super) fn prepare_one(
    path: &Path,
    fps: &HashMap<String, Fingerprint>,
    reg: &Registry,
    opts: &IngestOpts,
) -> PrepResult {
    let path_str = path.to_string_lossy().to_string();
    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(e) => return PrepResult::Error(e.to_string()),
    };
    let size = meta.len() as i64;
    let mtime = sys_secs(meta.modified().ok()).unwrap_or(0);
    let created = sys_secs(meta.created().ok()).unwrap_or(mtime);

    // Artimsal atlama: size+mtime ayni & indekslenmis → hash'siz atla (parmak-izi haritasindan).
    let existing = fps.get(&path_str);
    let is_update = existing.is_some();
    if opts.skip_unchanged {
        if let Some(fp) = existing {
            if fp.indexed && fp.size_bytes == size && fp.modified_at == mtime {
                return PrepResult::Skip;
            }
        }
    }

    let content_hash = match hash::blake3_file(path) {
        Ok(h) => h,
        Err(e) => return PrepResult::Error(e.to_string()),
    };
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase);
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
    let mime_type = ext.as_deref().and_then(mime::mime_from_ext);

    // Cikarim (ext registry'de varsa). Dususu olumcul DEGIL — asset yine indekslenir.
    let mut warns: Vec<String> = Vec::new();
    let mut fts_body: Option<String> = None;
    let mut metadata: Vec<(String, MetaVal)> = Vec::new();
    let mut auto_tags: Vec<String> = Vec::new();
    let mut phash: Option<i64> = None;
    let mut title: Option<String> = None;
    let mut thumbnail: Option<Thumbnail> = None;
    let mut shapes: Vec<ExtractedShape> = Vec::new();
    let mut image_kind: Option<ImageKind> = None;

    if let Some(ext_s) = &ext {
        if reg.for_ext(ext_s).is_some() {
            let input = ExtractInput {
                path: path.to_path_buf(),
                ext: ext_s.clone(),
                size_bytes: meta.len(),
            };
            match reg.extract(&input) {
                Ok(extracted) => {
                    // Katman 1: raster gorsellerde deterministik render/foto/doku (cikarilan
                    // sinyallerden; fields TUKETILMEDEN once). Kardes-uzanti katmani ingest'te
                    // atlanir (best-effort; bos).
                    if is_raster_image_ext(ext_s) {
                        image_kind = image_kind_from_extracted(&file_name, &path_str, &extracted);
                    }
                    // Baskin renkler extractor'un tipli ortak alaninda gelir; EAV'de tek JSON
                    // degeri olarak saklanir. Onceki hat, bu alani hic kopyalamadigi icin pahali
                    // CIELAB hesabi tarama sirasinda yapiliyor ama sonuc sessizce atiliyordu.
                    if !extracted.dominant_colors.is_empty() {
                        match serde_json::to_string(&extracted.dominant_colors) {
                            Ok(json) => metadata.push((
                                DOMINANT_COLORS_METADATA_KEY.to_string(),
                                MetaVal::Text(json),
                            )),
                            Err(e) => warns.push(format!("baskin renkler serilestirilemedi: {e}")),
                        }
                    }
                    fts_body = extracted.text;
                    for (k, v) in extracted.fields {
                        if k == "title" {
                            if let MetaValue::Str(s) = &v {
                                title = Some(s.clone());
                            }
                        }
                        metadata.push((k, map_val(v)));
                    }
                    auto_tags = extracted.auto_tags;
                    phash = extracted.phash.map(|h| h as i64);
                    thumbnail = extracted.thumbnail;
                    shapes = extracted.shapes;
                    warns.extend(extracted.warnings);
                }
                Err(e) => warns.push(format!("cikarim basarisiz: {e}")),
            }
        }
    }

    PrepResult::Ready(Box::new(Prepared {
        path: path_str,
        file_name,
        ext,
        size,
        created,
        mtime,
        content_hash,
        mime: mime_type,
        is_update,
        fts_body,
        metadata,
        auto_tags,
        phash,
        title,
        thumbnail,
        shapes,
        image_kind,
        warns,
    }))
}

/// `Extracted.fields`'ten `MetaValue::Str` degeri (aksi → None).
fn mv_str<'a>(e: &'a Extracted, key: &str) -> Option<&'a str> {
    match e.fields.get(key) {
        Some(MetaValue::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}
/// `Extracted.fields`'ten sayisal deger (Int/Float → f64; aksi → None).
fn mv_num(e: &Extracted, key: &str) -> Option<f64> {
    match e.fields.get(key) {
        Some(MetaValue::Int(i)) => Some(*i as f64),
        Some(MetaValue::Float(f)) => Some(*f),
        _ => None,
    }
}
/// Alan dolu (bos-olmayan metin) mi?
fn mv_str_present(e: &Extracted, key: &str) -> bool {
    mv_str(e, key).is_some_and(|s| !s.trim().is_empty())
}
/// Alan bos/`"0"` olmayan metin mi? (H2 focal/exposure kontrolu).
fn mv_text_nonzero(e: &Extracted, key: &str) -> bool {
    mv_str(e, key).is_some_and(|s| {
        let t = s.trim();
        !t.is_empty() && t != "0"
    })
}
/// `f64` boyut → `u32` (negatif/tasan/NaN → None).
fn u32_of(v: f64) -> Option<u32> {
    if v.is_finite() && v >= 0.0 && v <= f64::from(u32::MAX) {
        Some(v as u32)
    } else {
        None
    }
}

/// Cikarilan gorsel metadata'sindan (EXIF/boyut/render-bayrak) Katman 1 gorsel-turunu tayin et.
/// `Extracted.fields` TUKETILMEDEN once cagrilir; saf `classify_image_kind`'e duz sinyaller verir.
/// H3 alan adlari (image_meta.rs): camera_make/camera_model · gps_lat/gps_lon · focal_length ·
/// exposure_time · iso_speed · is_render (Bool) / auto_tag "is_render" · software · width/height.
fn image_kind_from_extracted(file_name: &str, path: &str, e: &Extracted) -> Option<ImageKind> {
    let has_camera = mv_str_present(e, "camera_make") || mv_str_present(e, "camera_model");
    let has_gps =
        mv_num(e, "gps_lat").is_some_and(|v| v != 0.0) || mv_num(e, "gps_lon").is_some_and(|v| v != 0.0);
    let has_iso = mv_num(e, "iso_speed").is_some_and(|v| v != 0.0) || mv_text_nonzero(e, "iso_speed");
    let is_render = matches!(e.fields.get("is_render"), Some(MetaValue::Bool(true)))
        || e.auto_tags.iter().any(|t| t == "is_render");

    classify_image_kind(
        file_name,
        path,
        is_render,
        mv_str(e, "software"),
        has_camera,
        has_gps,
        mv_text_nonzero(e, "focal_length"),
        mv_text_nonzero(e, "exposure_time"),
        has_iso,
        mv_num(e, "width").and_then(u32_of),
        mv_num(e, "height").and_then(u32_of),
        &[],
    )
}

/// **Ana thread (seri, SQLite tek-yazici):** hazirlanmis veriyi DB'ye yaz.
///
/// `&mut Prepared`: sekil-persist HATASI olumcul DEGIL (asil ingest zaten yazildi) → uyari
/// olarak `p.warns`'a eklenir, cagiran onu `report.warnings`'a akitir (thumbnail/metadata
/// hata-toleransiyla ayni desen). `db.ingest` HATASI ise olumcul kalir (`Err` doner).
pub(super) fn write_prepared(db: &mut Db, p: &mut Prepared) -> Result<(), String> {
    let thumb_input = p.thumbnail.as_ref().map(|t| ThumbnailInput {
        mime: &t.mime,
        width: i64::from(t.width),
        height: i64::from(t.height),
        bytes: &t.bytes,
    });

    let asset = AssetInput {
        path: &p.path,
        file_name: &p.file_name,
        ext: p.ext.as_deref(),
        size_bytes: p.size,
        content_hash: Some(&p.content_hash),
        mime: p.mime,
        title: p.title.as_deref(),
        description: None,
        created_at: p.created,
        modified_at: p.mtime,
    };
    let data = IngestData {
        fts_body: p.fts_body.as_deref(),
        metadata: &p.metadata,
        auto_tags: &p.auto_tags,
        phash: p.phash,
        thumbnail: thumb_input,
    };
    let asset_id = db.ingest(&asset, &data).map_err(|e| e.to_string())?;

    // Katman 1 gorsel-turu (raster) — EN-IYI-CABA (asil ingest yazildi). `write_image_kind` YALNIZ
    // yoksa yazar (ON CONFLICT DO NOTHING) → re-ingest'te mevcut (heuristik/vision) deger KORUNUR.
    if let Some(kind) = p.image_kind {
        if let Err(e) = db.write_image_kind(asset_id, kind) {
            p.warns.push(format!("ai_gorsel_turu yazilamadi (asset indekslendi): {e}"));
        }
    }

    // Sekilleri EN-IYI-CABA ile yaz (asil ingest'i BLOKLAMAZ). `set_asset_shapes` replace
    // semantigi → reindex idempotent (cift kayit olmaz). Sekilsiz (bos) → cagirma (no-op:
    // DWG raw-scan / geometri uretmeyen format). Sema/yazim hatasi → uyari (asset yazildi).
    if !p.shapes.is_empty() {
        let inputs: Vec<ShapeInput> = p.shapes.iter().map(to_shape_input).collect();
        if let Err(e) = db.set_asset_shapes(asset_id, &inputs) {
            p.warns.push(format!("sekil indeksi yazilamadi (asset indekslendi): {e}"));
        }
    }
    Ok(())
}

/// Cikarim sozlesmesi [`ExtractedShape`] → db [`ShapeInput`] (**birebir duz alan**). `layer_category`
/// DB icinde `categorize_layer` ile turetilir → burada YOK (ham `layer_name` gecirilir).
fn to_shape_input(s: &ExtractedShape) -> ShapeInput {
    ShapeInput {
        entity_type: s.entity_type.clone(),
        layer_name: s.layer_name.clone(),
        vertex_count: s.vertex_count,
        is_closed: s.is_closed,
        area: s.area,
        perimeter: s.perimeter,
        aspect_ratio: s.aspect_ratio,
        regularity: s.regularity,
        compactness: s.compactness,
        solidity: s.solidity,
        rectangularity: s.rectangularity,
        bbox_w: s.bbox_w,
        bbox_h: s.bbox_h,
        centroid_x: s.centroid_x,
        centroid_y: s.centroid_y,
    }
}

/// SystemTime → unix saniye (epoch oncesi/gecersiz → `None`).
fn sys_secs(t: Option<std::time::SystemTime>) -> Option<i64> {
    t?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
}

/// `MetaValue` → db `MetaVal` (Int/Float → sayisal; Str/Bool → metin).
fn map_val(v: MetaValue) -> MetaVal {
    match v {
        MetaValue::Str(s) => MetaVal::Text(s),
        MetaValue::Bool(b) => MetaVal::Text(b.to_string()),
        MetaValue::Int(i) => MetaVal::Num(i as f64),
        MetaValue::Float(f) => MetaVal::Num(f),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #7 tarama raporu: olmayan dosya → `prepare_one` OLUMCUL hata uretir (stat basarisiz).
    /// Loop bunu `report.errors`'a yazar (uyari DEGIL). Cross-platform: olmayan yolun metadata'si
    /// her zaman patlar.
    #[test]
    fn prepare_one_missing_file_is_fatal_error() {
        let reg = crate::build_registry();
        let opts = IngestOpts::default();
        let res = prepare_one(
            Path::new("Z:/___arsiv_h3_olmayan___/olmayan_dosya_xyz.txt"),
            &HashMap::new(),
            &reg,
            &opts,
        );
        assert!(matches!(res, PrepResult::Error(_)), "olmayan dosya olumcul hata olmali");
    }

    /// `to_shape_input`: ExtractedShape → db ShapeInput alan-alan birebir (layer_name Option
    /// aynen tasinir; layer_category burada YOK — DB'de turetilir). Kopru sozlesmesinin kaniti.
    #[test]
    fn to_shape_input_maps_fieldwise() {
        let e = ExtractedShape {
            entity_type: "CIRCLE".to_string(),
            layer_name: Some("PENCERE".to_string()),
            vertex_count: 1,
            is_closed: true,
            area: 12.566,
            perimeter: 12.566,
            aspect_ratio: 1.0,
            regularity: 1.0,
            compactness: 1.0,
            solidity: 1.0,
            rectangularity: 0.785,
            bbox_w: 4.0,
            bbox_h: 4.0,
            centroid_x: 5.0,
            centroid_y: 10.0,
        };
        let si = to_shape_input(&e);
        assert_eq!(si.entity_type, "CIRCLE");
        assert_eq!(si.layer_name.as_deref(), Some("PENCERE"));
        assert_eq!(si.vertex_count, 1);
        assert!(si.is_closed);
        assert_eq!(si.area, 12.566);
        assert_eq!(si.perimeter, 12.566);
        assert_eq!(si.aspect_ratio, 1.0);
        assert_eq!(si.regularity, 1.0);
        assert_eq!(si.compactness, 1.0);
        assert_eq!(si.solidity, 1.0);
        assert_eq!(si.rectangularity, 0.785);
        assert_eq!(si.bbox_w, 4.0);
        assert_eq!(si.bbox_h, 4.0);
        assert_eq!(si.centroid_x, 5.0);
        assert_eq!(si.centroid_y, 10.0);
    }
}
