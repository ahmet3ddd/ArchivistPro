//! DWG (AutoCAD cizim) cikarici — **ODA varsa TEMIZ, yoksa raw-scan**.
//!
//! H2 `dwg_parse.rs` + `oda_converter.rs` naklı. **Tasarim (guncel — 2026-06-19):**
//! ODA File Converter kuruluysa DWG→DXF cevirip [`crate::dxf`] ile TEMIZ cikarim yapilir
//! (gercek layer/block/text/unit/scale) + ham DWG'den gomulu thumbnail. ODA yoksa veya
//! donusum basarisizsa deterministik ikili **raw-scan**'e zarif dusus (layer/text YAKLASIK;
//! Extracted'a uyari eklenir). ODA sonucu cache'lenir → yeniden-index aninda. Riskli ikili
//! parse `Registry`'nin `catch_unwind` siniriyla izole.
//!
//! NOT (perf): ODA harici bir surec acar → ilk indekslemede DWG basina ~saniyeler;
//! cache bunu yeniden-indexte amortize eder. Buyuk arsivlerde is-kuyrugu (Faz 5/6) ile
//! paralellestirilebilir.

pub mod fields;
pub mod ole;
pub mod strings;
pub mod thumb;

use std::path::PathBuf;
use std::sync::OnceLock;

// DXF'in paylastigi yardimcilar (H2'de dxf_parse, dwg_parse'tan import ediyordu).
pub use fields::get_dwg_version;
pub use ole::{
    clsid_to_guid_string, detect_ole_progid, hex_decode, is_progid_shape, known_clsids,
    read_cfbf_root_clsid,
};

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor};

/// DWG ust boyut siniri (H2 ile ayni): 200 MB.
const MAX_DWG_SIZE: u64 = 200 * 1024 * 1024;
/// Birlestirilmis liste alanlari icin karakter tavani.
const JOIN_CAP: usize = 4000;

/// ODA exe yolunu surec basina BIR kez tespit et (registry/PATH taramasi tekrarlanmaz).
fn oda_available() -> bool {
    static ODA: OnceLock<Option<PathBuf>> = OnceLock::new();
    ODA.get_or_init(crate::oda::detect).is_some()
}

/// DWG→DXF donusum cache dizini (kalici → yeniden-index aninda). LOCALAPPDATA, yoksa temp.
fn oda_cache_dir() -> PathBuf {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local).join("ArchivistPro").join("oda_dxf_cache");
    }
    std::env::temp_dir().join("archivist_oda_dxf_cache")
}

/// DWG dosyalari icin extractor (ODA varsa temiz DXF, yoksa raw binary scan).
pub struct DwgExtractor;

impl Extractor for DwgExtractor {
    fn id(&self) -> &'static str {
        "dwg"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["dwg"]
    }
    fn max_size(&self) -> u64 {
        MAX_DWG_SIZE
    }

    /// **ODA yolu harici alt-surec calistirir → 30sn varsayilan YETMEZ.**
    ///
    /// OLCUM (2026-07-16, gercek ofis DWG'si, UNC uzerinden, TEK dosya/cekismesiz):
    /// 30 MB DWG → `oda::extract_dwg` **25.0 sn** (raw-scan 5.7 sn) — ve BASARILI.
    /// Varsayilan 30sn'de pay yoktu → en ufak cekismede asiliyor, `Timeout` doniyor ve
    /// **cikarilabilir metadata cope gidiyordu** (olculdu: gercek DWG klasorlerinin ~%12'si
    /// icerik cikarimi OLMADAN indeksleniyordu → o cizimler ARANAMAZ hale geliyordu).
    /// H2'de bu sinif yok: H2'nin timeout'u YOK, gerekirse bekler (`raceInvoke` = iptal yarisi).
    ///
    /// 300sn = **hang guvenlik agi**, hiz hedefi DEGIL: olculen en kotu (25sn) uzerine bol pay
    /// (ODA es-zamanliligi zaten `oda::ODA_MAX_CONCURRENT`=3 ile kapili → kuyruk beklemesi de
    /// bu butceden yer; 512MB'lik `MAX_DWG_SIZE` ust siniri da kaba bir tavan koyar).
    /// Kullanicinin kacis kapisi ingest **iptali** (`INGEST_STOP`).
    fn timeout(&self) -> std::time::Duration {
        std::time::Duration::from_secs(300)
    }

    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let data = std::fs::read(&input.path).map_err(|e| ExtractError::io(&input.path, e))?;
        if data.len() < 0x20 || &data[0..2] != b"AC" {
            return Err(ExtractError::Parse("gecersiz DWG dosyasi (AC imzasi yok)".to_string()));
        }

        // ODA File Converter kuruluysa: DWG→DXF TEMIZ cikarim (gercek layer/block/text/
        // unit/scale). Raw-scan ikili tahminidir → ODA otoriter. Cache'li (yeniden-index
        // hizli). ODA yok ya da donusum basarisizsa asagidaki raw-scan'e zarif dusus.
        if oda_available() {
            if let Ok(mut out) = crate::oda::extract_dwg(&input.path.to_string_lossy(), &oda_cache_dir())
            {
                // DXF'te gomulu onizleme yoktur → thumbnail'i ham DWG ikilisinden ekle.
                if out.thumbnail.is_none() {
                    out.thumbnail = thumb::dwg_preview_thumbnail(&data);
                }
                return Ok(out);
            }
        }

        let version = get_dwg_version(&data);
        let layers = fields::extract_dwg_layers(&data);
        let blocks = fields::extract_dwg_blocks(&data);
        let texts = fields::extract_dwg_texts(&data);
        let xrefs = fields::extract_dwg_xrefs(&data);
        let image_refs = fields::extract_dwg_image_refs(&data);
        let ole_objects = ole::extract_dwg_ole_objects(&data);
        let props = fields::extract_dwg_properties(&data);
        let (unit_type, scale) = fields::extract_dwg_units(&data);
        let creation_date = fields::get_dwg_creation_date(&data);

        let mut out = Extracted::new();
        if let Some(v) = &version {
            out.set("version", v.clone());
        }
        out.set("layer_count", layers.len());
        out.set("block_count", blocks.len());
        out.set("text_count", texts.len());
        out.set("xref_count", xrefs.len());
        out.set("image_ref_count", image_refs.len());
        out.set("ole_count", ole_objects.len());

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

        // Gomulu onizleme bitmap'inden thumbnail (saf-Rust; yoksa None).
        out.thumbnail = thumb::dwg_preview_thumbnail(&data);

        // FTS body: cizim metni + layer + block adlari (aranabilir).
        let mut body: Vec<String> = Vec::new();
        body.extend(texts);
        body.extend(layers);
        body.extend(blocks);
        if !body.is_empty() {
            out.text = Some(body.join("\n"));
        }
        // Buraya yalniz ODA yok/basarisizken gelinir → veri ikili-tahmin (layer/text yaklasik).
        out.warn(
            "ODA File Converter yok ya da donusum basarisiz → sinirli ikili tarama \
             (layer/metin adlari yaklasik olabilir; temiz cikarim icin ODA kurun)",
        );
        Ok(out)
    }
}

fn set_props(out: &mut Extracted, props: &fields::DrawingProperties) {
    if let Some(v) = &props.title {
        out.set("title", v.clone());
    }
    if let Some(v) = &props.subject {
        out.set("subject", v.clone());
    }
    if let Some(v) = &props.author {
        out.set("author", v.clone());
    }
    if let Some(v) = &props.keywords {
        out.set("keywords", v.clone());
    }
    if let Some(v) = &props.comments {
        out.set("comments", v.clone());
    }
    if let Some(v) = &props.last_saved_by {
        out.set("last_saved_by", v.clone());
    }
}

/// Bir liste alanini "; " ile birlestir, [`JOIN_CAP`] karakterde kes.
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
