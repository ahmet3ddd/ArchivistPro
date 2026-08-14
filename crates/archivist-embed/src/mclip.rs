//! Cok-dilli CLIP metin kodlayici (Faz 5.4) — Turkce metin→gorsel arama.
//!
//! `sentence-transformers/clip-ViT-B-32-multilingual-v1`: DistilBERT (cok-dilli, 50+ dil) →
//! mean-pool (attention-mask agirlikli) → **Dense(768→512, bias YOK, aktivasyon Identity)** →
//! L2-norm. Cikti, OpenAI **ViT-B/32 GORUNTU uzayina hizalidir** (Multilingual Knowledge
//! Distillation; ogretmen = clip-ViT-B-32). Yani: gorsel vektorler (Ingilizce CLIP vision
//! kodlayici) AYNEN gecerli kalir; yalniz SORGU metni bu modelle embedlenir → Turkce sorgu
//! da dogru calisir. Boyut 512 = `IMAGE_EMBED_DIM` (ayni uzay, cosine kIyaslanabilir).
//!
//! ONNX yalniz transformer'i (768) kapsar; pooling + Dense ST kutuphanesinde yapilir →
//! burada ELLE yapilir (Dense agirligi `2_Dense/model.safetensors`'tan okunur). DistilBERT
//! girdileri: input_ids + attention_mask (token_type_ids YOK).

use std::path::{Path, PathBuf};

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use tokenizers::{Tokenizer, TruncationDirection, TruncationParams, TruncationStrategy};

use crate::vision::IMAGE_EMBED_DIM;
use crate::EmbedError;

type Result<T> = std::result::Result<T, EmbedError>;

/// Transformer girdi penceresi (ST `clip-ViT-B-32-multilingual-v1` max_seq_length=128;
/// sorgular kisa → fazlasi kirpilir).
const MAX_TOKENS: usize = 128;
/// DistilBERT gizli boyutu (Dense girisi).
const HIDDEN: usize = 768;

/// Cok-dilli CLIP metin embedder. ViT-B/32 gorsel uzayina hizali 512-boyut uretir.
/// `Send`/`Sync` varsayilmaz → cagiran Mutex'le sarar (lazy-cache).
pub struct MultilingualTextEmbedder {
    session: Session,
    tokenizer: Tokenizer,
    input_names: Vec<String>,
    /// Dense projeksiyon agirligi, satir-bazli [out=512][in=768] (PyTorch Linear weight).
    dense_w: Vec<f32>,
}

impl MultilingualTextEmbedder {
    /// Model dizininden yukle. Beklenen: `tokenizer.json` + transformer onnx
    /// (`onnx/model.onnx` veya quantized) + `2_Dense/model.safetensors` (projeksiyon).
    pub fn from_dir(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref();
        let tok_path = dir.join("tokenizer.json");
        if !tok_path.exists() {
            return Err(EmbedError::ModelDir(tok_path.display().to_string()));
        }
        let model_path = find_onnx(
            dir,
            &[
                "onnx/model.onnx",
                "onnx/model_quint8_avx2.onnx",
                "onnx/model_quantized.onnx",
                "onnx/model_qint8_avx512.onnx",
            ],
        )?;
        let dense_w = load_dense_weight(&dir.join("2_Dense").join("model.safetensors"))?;

        let mut tokenizer =
            Tokenizer::from_file(&tok_path).map_err(|e| EmbedError::Tokenizer(e.to_string()))?;
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: MAX_TOKENS,
                strategy: TruncationStrategy::LongestFirst,
                direction: TruncationDirection::Right,
                stride: 0,
            }))
            .map_err(|e| EmbedError::Tokenizer(e.to_string()))?;

        let session = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .commit_from_file(&model_path)?;
        let input_names = session.inputs.iter().map(|i| i.name.clone()).collect();

        Ok(Self {
            session,
            tokenizer,
            input_names,
            dense_w,
        })
    }

    /// Sorgu metni → 512 f32 (ViT-B/32 uzayina hizali, L2-norm). DistilBERT → mean-pool →
    /// Dense → L2.
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
        // DistilBERT: yalniz input_ids + attention_mask (token_type_ids YOK).
        let mut feed: Vec<(String, Tensor<i64>)> = Vec::with_capacity(2);
        for name in &self.input_names {
            let data = match name.as_str() {
                "input_ids" => ids.clone(),
                "attention_mask" => mask.clone(),
                _ => continue,
            };
            feed.push((name.clone(), Tensor::from_array((shape, data))?));
        }
        let inputs: Vec<(&str, Tensor<i64>)> =
            feed.iter().map(|(n, t)| (n.as_str(), t.clone())).collect();
        let outputs = self.session.run(inputs)?;

        // last_hidden_state [1, seq, 768] (yoksa ilk cikti).
        let hidden: Vec<f32> = match outputs.get("last_hidden_state") {
            Some(v) => v.try_extract_tensor::<f32>()?.1.to_vec(),
            None => {
                let (_, v) = outputs.iter().next().ok_or(EmbedError::Output(0, HIDDEN))?;
                v.try_extract_tensor::<f32>()?.1.to_vec()
            }
        };
        let dim = hidden.len() / seq;
        if dim != HIDDEN {
            return Err(EmbedError::Output(dim, HIDDEN));
        }

        // 1) Mean-pool (attention-mask agirlikli) → [768].
        let mut pooled = vec![0f32; HIDDEN];
        let mut denom = 0f32;
        for t in 0..seq {
            let m = mask.get(t).copied().unwrap_or(0) as f32;
            if m == 0.0 {
                continue;
            }
            denom += m;
            let base = t * HIDDEN;
            for (p, &h) in pooled.iter_mut().zip(&hidden[base..base + HIDDEN]) {
                *p += h * m;
            }
        }
        if denom > 0.0 {
            for v in &mut pooled {
                *v /= denom;
            }
        }

        // 2) Dense projeksiyon (768→512, bias yok): y[o] = Σ_d W[o*768+d] * pooled[d].
        let mut out = vec![0f32; IMAGE_EMBED_DIM];
        for (o, y) in out.iter_mut().enumerate() {
            let wrow = &self.dense_w[o * HIDDEN..(o + 1) * HIDDEN];
            *y = wrow.iter().zip(&pooled).map(|(w, p)| w * p).sum();
        }

        // 3) L2-normalize (CLIP cosine).
        let norm = out.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for v in &mut out {
                *v /= norm;
            }
        }
        Ok(out)
    }

    pub fn dim(&self) -> usize {
        IMAGE_EMBED_DIM
    }
}

/// `dir/onnx/<ad>` adaylarindan ilk var olani (fp32 tercih, sonra quantized).
fn find_onnx(dir: &Path, names: &[&str]) -> Result<PathBuf> {
    for n in names {
        let p = dir.join(n);
        if p.exists() {
            return Ok(p);
        }
    }
    Err(EmbedError::ModelDir(format!(
        "{}/[{}]",
        dir.display(),
        names.join("|")
    )))
}

/// `2_Dense/model.safetensors`'tan `linear.weight` [512,768] f32 tensorunu oku.
/// safetensors: 8-bayt LE baslik-uzunlugu + JSON baslik + ham veri. Tek tensor (bias yok).
fn load_dense_weight(path: &Path) -> Result<Vec<f32>> {
    let bytes = std::fs::read(path).map_err(|e| EmbedError::Dense(e.to_string()))?;
    if bytes.len() < 8 {
        return Err(EmbedError::Dense("dosya cok kisa".into()));
    }
    let hlen = u64::from_le_bytes(bytes[0..8].try_into().expect("8 bayt")) as usize;
    let header_end = 8 + hlen;
    if bytes.len() < header_end {
        return Err(EmbedError::Dense("baslik tasiyor".into()));
    }
    let json: serde_json::Value =
        serde_json::from_slice(&bytes[8..header_end]).map_err(|e| EmbedError::Dense(e.to_string()))?;
    let t = json
        .get("linear.weight")
        .ok_or_else(|| EmbedError::Dense("linear.weight yok".into()))?;
    let dtype = t.get("dtype").and_then(|v| v.as_str()).unwrap_or("");
    if dtype != "F32" {
        return Err(EmbedError::Dense(format!("beklenmedik dtype {dtype} (F32 lazim)")));
    }
    let offs = t
        .get("data_offsets")
        .and_then(|v| v.as_array())
        .ok_or_else(|| EmbedError::Dense("data_offsets yok".into()))?;
    let a = offs[0].as_u64().unwrap_or(0) as usize;
    let b = offs[1].as_u64().unwrap_or(0) as usize;
    let data = bytes
        .get(header_end + a..header_end + b)
        .ok_or_else(|| EmbedError::Dense("veri araligi disinda".into()))?;
    let expected = IMAGE_EMBED_DIM * HIDDEN * 4;
    if data.len() != expected {
        return Err(EmbedError::Dense(format!(
            "agirlik boyutu {} != {expected} (512x768 f32)",
            data.len()
        )));
    }
    Ok(data
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}
