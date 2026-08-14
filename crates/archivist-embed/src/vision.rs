//! CLIP gorsel + metin embedding (Faz 5.3) — gorsel/CLIP arama motoru.
//!
//! CLIP **cift-kodlayici**: (a) gorsel kodlayici thumbnail'i, (b) metin kodlayici sorgu
//! metnini AYNI 512-boyut uzaya projekte eder → cosine kIyaslanabilir (metin→gorsel +
//! gorsel→gorsel). Model: `openai/clip-vit-base-patch32` (Xenova ONNX yerlesimi:
//! `onnx/{vision,text}_model[_quantized].onnx` + `tokenizer.json`). Ingilizce model →
//! gorsel→gorsel dilden bagimsiz; metin→gorsel Ingilizce/teknik terimlerde guclu.
//!
//! `TextEmbedder` (MiniLM) deseni izlenir: bir kez yuklenir, cok kez embed. Cikti her
//! iki kolda da L2-normalize (CLIP projeksiyonu zaten tek vektor verir → mean-pool YOK).

use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::GenericImageView;
use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use tokenizers::{Tokenizer, TruncationDirection, TruncationParams, TruncationStrategy};

use crate::EmbedError;

type Result<T> = std::result::Result<T, EmbedError>;

/// CLIP ViT-B/32 paylasilan-uzay boyutu (config.json `projection_dim`). `asset_image_
/// vectors FLOAT[512]` (migration 0010) ve `archivist-db::IMAGE_EMBED_DIM` ile esit.
pub const IMAGE_EMBED_DIM: usize = 512;

/// Cok-bolge CLIP: bir gorsel icin uretilen uzamsal bolge sayisi (global + center + top-left +
/// top-right + bottom-center). `archivist-db::IMAGE_REGION_COUNT` ile AYNI olmali — orada asset
/// basina COK satir PK-kodlamasiyla (id = asset_id*8 + region, region 0..4) ayrilir.
pub const IMAGE_REGION_COUNT: usize = 5;

/// CLIP metin penceresi (config `max_position_embeddings=77`). Asan metin kirpilir.
const CLIP_MAX_TOKENS: usize = 77;

/// Gorsel kare boyu (preprocessor_config `crop_size`/`shortest_edge` = 224).
const IMAGE_SIZE: u32 = 224;
/// CLIP normalize ortalama/std (preprocessor_config `image_mean`/`image_std`; f32 round-
/// trip icin 7 anlamli basamak — kanonik degerlerle fark <1e-7, ihmal edilebilir).
const MEAN: [f32; 3] = [0.481_454_7, 0.457_827_5, 0.408_210_7];
const STD: [f32; 3] = [0.268_629_5, 0.261_302_6, 0.275_777_1];

/// CLIP gorsel+metin embedder. `Send`/`Sync` varsayilmaz → cagiran Mutex'le sarar
/// (semantik metin embedder ile ayni desen; AppState lazy-cache).
pub struct ImageEmbedder {
    vision: Session,
    text: Session,
    tokenizer: Tokenizer,
    text_inputs: Vec<String>,
    vision_input: String,
}

impl ImageEmbedder {
    /// Model dizininden yukle. Beklenen: `tokenizer.json` + `onnx/vision_model[_quantized].onnx`
    /// + `onnx/text_model[_quantized].onnx` (fp32 varsa tercih; yoksa quantized).
    pub fn from_dir(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref();
        let tok_path = dir.join("tokenizer.json");
        if !tok_path.exists() {
            return Err(EmbedError::ModelDir(tok_path.display().to_string()));
        }
        let vision_path = find_onnx(dir, &["vision_model.onnx", "vision_model_quantized.onnx"])?;
        let text_path = find_onnx(dir, &["text_model.onnx", "text_model_quantized.onnx"])?;

        let mut tokenizer =
            Tokenizer::from_file(&tok_path).map_err(|e| EmbedError::Tokenizer(e.to_string()))?;
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: CLIP_MAX_TOKENS,
                strategy: TruncationStrategy::LongestFirst,
                direction: TruncationDirection::Right,
                stride: 0,
            }))
            .map_err(|e| EmbedError::Tokenizer(e.to_string()))?;

        let vision = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .commit_from_file(&vision_path)?;
        let text = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .commit_from_file(&text_path)?;

        let text_inputs = text.inputs.iter().map(|i| i.name.clone()).collect();
        let vision_input = vision
            .inputs
            .first()
            .map(|i| i.name.clone())
            .ok_or_else(|| EmbedError::ModelDir("vision modelin girdisi yok".into()))?;

        Ok(Self {
            vision,
            text,
            tokenizer,
            text_inputs,
            vision_input,
        })
    }

    /// Thumbnail (kodlanmis bayt) → 512 f32 (L2-normalize). CLIP gorsel kodlayici (kisa-kenar
    /// 224 + merkez kare = region 0/global). Cok-bolge icin `embed_image_regions`.
    pub fn embed_image(&mut self, bytes: &[u8]) -> Result<Vec<f32>> {
        let pixels = preprocess_image(bytes)?; // NCHW [3,224,224] flat
        self.run_vision(pixels)
    }

    /// Thumbnail (kodlanmis bayt) → **5 uzamsal BOLGE** CLIP vektoru (H2 `generateImageEmbeddings
    /// Multi` porti; kompozisyon aramasi: "cami VE bulut birlikte"). Region 0 = GLOBAL (mevcut
    /// `embed_image` hatti: kisa-kenar 224 + MERKEZ kare → migration 0022 region-0 uyumu). Region
    /// 1-4 = ORIJINALDEN kare kirpim → 224x224 → AYNI CLIP hatti (H2 embeddings.ts 644-650):
    ///   1 CENTER (kenar=floor(0.8*min), merkez) · 2 TOP_LEFT · 3 TOP_RIGHT · 4 BOTTOM_CENTER.
    /// Donus: `(region-indeksi, 512 f32 L2-norm)` ciftleri, region ARTAN sirada. Bir bolge
    /// decode/on-isleme basarisiz olursa (cok kucuk vb.) o bolge ATLANIR (H2 gibi) ama cift kendi
    /// region-indeksini TASIR → cagiran PK-kodlamasi (id = asset_id*8 + region) icin dogru id kurar
    /// (atlanan bolge slotu bos birakilmaz; sira delik olabilir). Hicbir bolge cikmazsa Err.
    pub fn embed_image_regions(&mut self, bytes: &[u8]) -> Result<Vec<(usize, Vec<f32>)>> {
        let mut out: Vec<(usize, Vec<f32>)> = Vec::with_capacity(IMAGE_REGION_COUNT);

        // Region 0 = GLOBAL: mevcut embed_image hatti (kisa-kenar 224 + merkez kare). 0022 eski
        // tek-vektorleri region 0'a tasidi → yeniden-embed'de region 0 birebir AYNI hattir.
        if let Ok(v) = self.embed_image(bytes) {
            out.push((0, v));
        }

        // Region 1-4: orijinali bir kez decode → H2 geometrisiyle kare bolgeleri kirp.
        if let Ok(img) = image::load_from_memory(bytes) {
            let (w, h) = img.dimensions();
            if w > 0 && h > 0 {
                // H2: side = floor(min(w,h)*0.8); merkez kare kok noktalari.
                let side = ((f64::from(w.min(h)) * 0.8).floor() as u32).max(1);
                let cx = w.saturating_sub(side) / 2;
                let cy = h.saturating_sub(side) / 2;
                // (region, x, y, kenar) — embeddings.ts 644-650 (global HARIC; o region 0).
                let rects = [
                    (1_usize, cx, cy, side),              // CENTER
                    (2, 0, 0, side),                      // TOP_LEFT
                    (3, w.saturating_sub(side), 0, side), // TOP_RIGHT
                    (4, cx, h.saturating_sub(side), side), // BOTTOM_CENTER
                ];
                for &(region, x, y, s) in &rects {
                    let px = match preprocess_crop(&img, x, y, s) {
                        Ok(p) => p,
                        Err(_) => continue, // bolgeyi atla (H2: cok kucuk/gecersiz → skip)
                    };
                    if let Ok(v) = self.run_vision(px) {
                        out.push((region, v));
                    }
                }
            }
        }

        if out.is_empty() {
            return Err(EmbedError::Image("hicbir bolge embedlenemedi".into()));
        }
        Ok(out)
    }

    /// On-islenmis pixel_values [3,224,224] flat → 512 f32 (L2-normalize). `embed_image` +
    /// bolge embed'lerinin ORTAK CLIP vision oturum-kosusu (tek girdi hatti → region 0 = eski
    /// `embed_image` davranisiyla birebir; bolgeler ayni normalizasyon/cikti yolunu paylasir).
    fn run_vision(&mut self, pixels: Vec<f32>) -> Result<Vec<f32>> {
        let shape = [1_i64, 3, i64::from(IMAGE_SIZE), i64::from(IMAGE_SIZE)];
        let tensor = Tensor::from_array((shape, pixels))?;
        let inputs: Vec<(&str, Tensor<f32>)> = vec![(self.vision_input.as_str(), tensor)];
        let outputs = self.vision.run(inputs)?;
        // Adli cikti (`image_embeds`) varsa onu, yoksa ilk ciktiyi al (TextEmbedder deseni).
        let raw: Vec<f32> = match outputs.get("image_embeds") {
            Some(v) => v.try_extract_tensor::<f32>()?.1.to_vec(),
            None => {
                let (_, v) = outputs
                    .iter()
                    .next()
                    .ok_or(EmbedError::Output(0, IMAGE_EMBED_DIM))?;
                v.try_extract_tensor::<f32>()?.1.to_vec()
            }
        };
        finish(raw)
    }

    /// Sorgu metni → 512 f32 (L2-normalize). CLIP metin kodlayici (BPE; lowercase +
    /// `<|startoftext|>`/`<|endoftext|>` tokenizer.json post-processor'da).
    pub fn embed_text(&mut self, text: &str) -> Result<Vec<f32>> {
        let enc = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| EmbedError::Encode(e.to_string()))?;
        let ids: Vec<i64> = enc.get_ids().iter().map(|&x| i64::from(x)).collect();
        let mask: Vec<i64> = enc.get_attention_mask().iter().map(|&x| i64::from(x)).collect();
        let seq = ids.len();
        if seq == 0 {
            return Ok(vec![0.0; IMAGE_EMBED_DIM]);
        }
        let shape = [1_i64, seq as i64];
        // Yalniz modelin gercekten bildirdigi girdileri besle.
        let mut feed: Vec<(String, Tensor<i64>)> = Vec::with_capacity(2);
        for name in &self.text_inputs {
            let data = match name.as_str() {
                "input_ids" => ids.clone(),
                "attention_mask" => mask.clone(),
                _ => continue,
            };
            feed.push((name.clone(), Tensor::from_array((shape, data))?));
        }
        let inputs: Vec<(&str, Tensor<i64>)> =
            feed.iter().map(|(n, t)| (n.as_str(), t.clone())).collect();
        let outputs = self.text.run(inputs)?;
        let raw: Vec<f32> = match outputs.get("text_embeds") {
            Some(v) => v.try_extract_tensor::<f32>()?.1.to_vec(),
            None => {
                let (_, v) = outputs
                    .iter()
                    .next()
                    .ok_or(EmbedError::Output(0, IMAGE_EMBED_DIM))?;
                v.try_extract_tensor::<f32>()?.1.to_vec()
            }
        };
        finish(raw)
    }

    pub fn dim(&self) -> usize {
        IMAGE_EMBED_DIM
    }
}

/// `dir/onnx/<ad>` adaylarindan ilk var olani dondur (fp32 tercih, yoksa quantized).
fn find_onnx(dir: &Path, names: &[&str]) -> Result<PathBuf> {
    for n in names {
        let p = dir.join("onnx").join(n);
        if p.exists() {
            return Ok(p);
        }
    }
    Err(EmbedError::ModelDir(format!(
        "{}/onnx/[{}]",
        dir.display(),
        names.join("|")
    )))
}

/// Ham model ciktisini sonlandir: boyut 512 degilse net hata, dogruysa L2-normalize.
fn finish(data: Vec<f32>) -> Result<Vec<f32>> {
    if data.len() != IMAGE_EMBED_DIM {
        return Err(EmbedError::Output(data.len(), IMAGE_EMBED_DIM));
    }
    Ok(normalize(data))
}

/// L2-normalize (CLIP cosine icin). Sifir-norm → oldugu gibi.
fn normalize(mut v: Vec<f32>) -> Vec<f32> {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in &mut v {
            *x /= norm;
        }
    }
    v
}

/// Thumbnail baytlari → CLIP `pixel_values` [3,224,224] NCHW flat f32. preprocessor_config:
/// RGB → kisa-kenar 224 oranli resize (bicubic ≈ CatmullRom) → 224×224 merkez-kirp →
/// /255 → (x − mean) / std (kanal bazli).
fn preprocess_image(bytes: &[u8]) -> Result<Vec<f32>> {
    let img = image::load_from_memory(bytes).map_err(|e| EmbedError::Image(e.to_string()))?;
    let (w, h) = img.dimensions();
    if w == 0 || h == 0 {
        return Err(EmbedError::Image("bos goruntu".into()));
    }
    // Kisa kenar = 224 olacak sekilde oranli yeniden boyutla.
    let (nw, nh) = if w < h {
        (IMAGE_SIZE, ((h as f32) * (IMAGE_SIZE as f32) / (w as f32)).round() as u32)
    } else {
        (((w as f32) * (IMAGE_SIZE as f32) / (h as f32)).round() as u32, IMAGE_SIZE)
    };
    let resized = img
        .resize_exact(nw.max(IMAGE_SIZE), nh.max(IMAGE_SIZE), FilterType::CatmullRom)
        .to_rgb8();
    // 224×224 merkez kirp (crop_imm → to_image: pixel (x,y) = resized(left+x, top+y); eski
    // get_pixel dongusuyle birebir ayni cikti → region 0 / migration uyumu korunur).
    let left = (resized.width() - IMAGE_SIZE) / 2;
    let top = (resized.height() - IMAGE_SIZE) / 2;
    let crop = image::imageops::crop_imm(&resized, left, top, IMAGE_SIZE, IMAGE_SIZE).to_image();
    Ok(to_pixel_values(&crop))
}

/// Tek bir KARE bolge kirpimini CLIP `pixel_values` [3,224,224] NCHW flat f32'e cevir (region
/// 1-4). Orijinalden `(x,y,side)` kare bolge kirpilir → 224×224'e olcekle (H2 `cropBlob`:
/// drawImage(crop → 224×224)) → `to_pixel_values`. Kirpim sinir disi/cok kucuk ise Err (cagiran
/// o bolgeyi atlar). preprocess_image (region 0) kisa-kenar+merkez yolunu izler; bu crop-sonra-
/// olcekle yolunu (H2 multi-crop geometrisi) izler.
fn preprocess_crop(img: &image::DynamicImage, x: u32, y: u32, side: u32) -> Result<Vec<f32>> {
    let (w, h) = img.dimensions();
    if side == 0 || x >= w || y >= h {
        return Err(EmbedError::Image("gecersiz bolge kirpimi".into()));
    }
    // Kirpim sinir icinde kalsin (kenar bolgeleri tasmasin) → gecerli kare.
    let side = side.min(w - x).min(h - y);
    if side == 0 {
        return Err(EmbedError::Image("bos bolge kirpimi".into()));
    }
    let cropped = img.crop_imm(x, y, side, side);
    let resized = cropped
        .resize_exact(IMAGE_SIZE, IMAGE_SIZE, FilterType::CatmullRom)
        .to_rgb8();
    Ok(to_pixel_values(&resized))
}

/// 224×224 RGB → CLIP `pixel_values` [3,224,224] NCHW flat f32: `(kanal/255 − mean)/std`.
/// preprocess_image (region 0, merkez-kirp) + preprocess_crop (region 1-4) ORTAK son adimi.
fn to_pixel_values(img: &image::RgbImage) -> Vec<f32> {
    let side = IMAGE_SIZE as usize;
    let plane = side * side;
    let mut out = vec![0f32; 3 * plane];
    for y in 0..IMAGE_SIZE {
        for x in 0..IMAGE_SIZE {
            let px = img.get_pixel(x, y);
            let idx = (y as usize) * side + (x as usize);
            for c in 0..3 {
                let val = f32::from(px[c]) / 255.0;
                out[c * plane + idx] = (val - MEAN[c]) / STD[c];
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// preprocess_crop: gecerli kare bolge → tam CLIP pixel_values uzunlugu (3×224×224). Model
    /// GEREKMEZ (saf goruntu-islemi). Region 1-4 geometrisinin decode/olcekleme hattini dogrular.
    #[test]
    fn preprocess_crop_produces_full_pixel_values() {
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(300, 200, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        }));
        let (w, h) = img.dimensions();
        let side = (f64::from(w.min(h)) * 0.8).floor() as u32; // 160
        // Dort H2 bolgesi de sinir icinde → hepsi tam uzunlukta pixel_values.
        for (x, y) in [
            (w.saturating_sub(side) / 2, h.saturating_sub(side) / 2), // center
            (0, 0),                                                    // top-left
            (w.saturating_sub(side), 0),                               // top-right
            (w.saturating_sub(side) / 2, h.saturating_sub(side)),      // bottom-center
        ] {
            let px = preprocess_crop(&img, x, y, side).unwrap();
            assert_eq!(px.len(), 3 * (IMAGE_SIZE as usize).pow(2), "3×224×224 pixel_values");
        }
    }

    /// Sinir-disi / sifir-kenar kirpim → Err (bolge atlanir; embed_image_regions bunu yutar,
    /// kalan bolgelerle devam eder → en az 1 vektor sozlesmesi korunur).
    #[test]
    fn preprocess_crop_rejects_invalid() {
        let img =
            image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(10, 10, image::Rgb([1, 2, 3])));
        assert!(preprocess_crop(&img, 20, 0, 5).is_err(), "x>=w → Err");
        assert!(preprocess_crop(&img, 0, 0, 0).is_err(), "side 0 → Err");
    }
}
