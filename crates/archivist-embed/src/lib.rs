//! archivist-embed — metin embedding motoru (Rust ONNX Runtime + tokenizers).
//!
//! H3 mimarisi: embedding **tarayicida DEGIL**, Rust'ta uretilir (H2 dersi:
//! Transformers.js CSP/warmup/fp32/UI-thread cilesi). Model: sentence-transformers
//! `paraphrase-multilingual-MiniLM-L12-v2` (BertModel, multilingual → Turkce dostu,
//! 384-boyut). Cikti: mean-pooled (attention-mask agirlikli) + L2-normalize vektor.
//!
//! Tasarim: app-agnostik. Model dizinini cagiran cozer (src-tauri app-resource veya
//! `ARSIV_EMBED_MODEL_DIR`). Bu crate yalniz "dizin ver → embedder al → metin ver →
//! vektor al" sozlesmesini sunar.

use std::path::{Path, PathBuf};

use ort::session::{builder::GraphOptimizationLevel, Session};
use ort::value::Tensor;
use tokenizers::{TruncationDirection, TruncationParams, TruncationStrategy, Tokenizer};

mod mclip;
mod vision;
pub use mclip::MultilingualTextEmbedder;
pub use vision::{ImageEmbedder, IMAGE_EMBED_DIM, IMAGE_REGION_COUNT};

/// MiniLM-L12-v2 cikti boyutu (config.json hidden_size). sqlite-vec `asset_vectors`
/// tablosu bununla sabitlenir (migration 0009).
pub const TEXT_EMBED_DIM: usize = 384;

/// Tek metin icin maksimum token (model max_position_embeddings=512; arsiv metni
/// genelde kisa baslik/yol/ozet → 256 yeterli + hizli). Asan metin kirpilir.
const MAX_TOKENS: usize = 256;

#[derive(Debug, thiserror::Error)]
pub enum EmbedError {
    #[error("model dizini bulunamadi/eksik: {0}")]
    ModelDir(String),
    #[error("tokenizer yuklenemedi: {0}")]
    Tokenizer(String),
    #[error("onnx oturum hatasi: {0}")]
    Session(#[from] ort::Error),
    #[error("tokenize hatasi: {0}")]
    Encode(String),
    #[error("model ciktisi beklenmedik (last_hidden_state yok / boyut {0} != {1})")]
    Output(usize, usize),
    #[error("gorsel cozulemedi/on-islenemedi: {0}")]
    Image(String),
    #[error("Dense projeksiyon agirligi (safetensors) okunamadi: {0}")]
    Dense(String),
}

type Result<T> = std::result::Result<T, EmbedError>;

/// Metin → 384-boyut embedding. Bir kez yuklenir (tokenizer + onnx oturumu),
/// cok kez `embed` cagrilir. `Send`/`Sync` degil varsayilmaz → cagiran Mutex'le sarar.
pub struct TextEmbedder {
    session: Session,
    tokenizer: Tokenizer,
    input_names: Vec<String>,
}

impl TextEmbedder {
    /// Model dizininden yukle. Dizin icinde beklenenler:
    ///   `tokenizer.json`  ve  `onnx/model.onnx` (fp32 tercih) — yoksa
    ///   `onnx/model_quantized.onnx` (int8 dususluk; CLIP/mclip ile ayni desen).
    pub fn from_dir(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref();
        let tok_path = dir.join("tokenizer.json");
        if !tok_path.exists() {
            return Err(EmbedError::ModelDir(tok_path.display().to_string()));
        }
        // fp32 (`model.onnx`) once: en yuksek kalite. Yoksa int8 quantized'a dus
        // (bazi lokasyonlarda H2 yalniz `model_quantized.onnx` varyantini tasir).
        let model_path = ["model.onnx", "model_quantized.onnx"]
            .iter()
            .map(|n| dir.join("onnx").join(n))
            .find(|p| p.exists())
            .ok_or_else(|| {
                EmbedError::ModelDir(
                    dir.join("onnx").join("model[_quantized].onnx").display().to_string(),
                )
            })?;

        let mut tokenizer =
            Tokenizer::from_file(&tok_path).map_err(|e| EmbedError::Tokenizer(e.to_string()))?;
        // Kirpma: model penceresine sigdir (uzun metin → ilk MAX_TOKENS token).
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
        })
    }

    /// Tek metni embedle → 384 f32 (L2-normalize).
    pub fn embed(&mut self, text: &str) -> Result<Vec<f32>> {
        let enc = self
            .tokenizer
            .encode(text, true)
            .map_err(|e| EmbedError::Encode(e.to_string()))?;

        let ids: Vec<i64> = enc.get_ids().iter().map(|&x| x as i64).collect();
        let mask: Vec<i64> = enc.get_attention_mask().iter().map(|&x| x as i64).collect();
        let types: Vec<i64> = enc.get_type_ids().iter().map(|&x| x as i64).collect();
        let seq = ids.len();
        if seq == 0 {
            return Ok(vec![0.0; TEXT_EMBED_DIM]);
        }

        let shape = [1_i64, seq as i64];
        // Yalniz modelin gercekten bildirdigi girdileri besle (kimi export'ta
        // token_type_ids yok).
        let mut feed: Vec<(String, Tensor<i64>)> = Vec::with_capacity(3);
        for name in &self.input_names {
            let data = match name.as_str() {
                "input_ids" => ids.clone(),
                "attention_mask" => mask.clone(),
                "token_type_ids" => types.clone(),
                _ => continue,
            };
            feed.push((name.clone(), Tensor::from_array((shape, data))?));
        }

        let inputs: Vec<(&str, Tensor<i64>)> =
            feed.iter().map(|(n, t)| (n.as_str(), t.clone())).collect();
        let outputs = self.session.run(inputs)?;

        // last_hidden_state: [1, seq, 384]. Yoksa ilk ciktiyi dene. Her iki kol da
        // Vec<f32>'e kopyalar → tip birlesir (Value vs ValueRef lifetime farki cozulur).
        let data: Vec<f32> = match outputs.get("last_hidden_state") {
            Some(v) => v.try_extract_tensor::<f32>()?.1.to_vec(),
            None => {
                let (_, v) = outputs
                    .iter()
                    .next()
                    .ok_or(EmbedError::Output(0, TEXT_EMBED_DIM))?;
                v.try_extract_tensor::<f32>()?.1.to_vec()
            }
        };
        // Cikti [1, seq, dim] → dim = uzunluk / seq (sekil-tipinden bagimsiz).
        let dim = data.len() / seq;
        if dim != TEXT_EMBED_DIM {
            return Err(EmbedError::Output(dim, TEXT_EMBED_DIM));
        }

        Ok(mean_pool_normalize(&data, &mask, seq, dim))
    }

    /// Coklu metin (basit dongu; ileride gercek batch tensoru ile hizlandirilabilir).
    pub fn embed_batch(&mut self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        texts.iter().map(|t| self.embed(t)).collect()
    }

    pub fn dim(&self) -> usize {
        TEXT_EMBED_DIM
    }
}

/// Mean-pool (attention-mask agirlikli) + L2-normalize.
fn mean_pool_normalize(hidden: &[f32], mask: &[i64], seq: usize, dim: usize) -> Vec<f32> {
    let mut out = vec![0f32; dim];
    let mut denom = 0f32;
    for t in 0..seq {
        let m = mask.get(t).copied().unwrap_or(0) as f32;
        if m == 0.0 {
            continue;
        }
        denom += m;
        let base = t * dim;
        for d in 0..dim {
            out[d] += hidden[base + d] * m;
        }
    }
    if denom > 0.0 {
        for v in &mut out {
            *v /= denom;
        }
    }
    let norm = out.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for v in &mut out {
            *v /= norm;
        }
    }
    out
}

/// Cevre degiskeninden model dizini (`ARSIV_EMBED_MODEL_DIR`). Cagiran (src-tauri)
/// uygulama-kaynak dizinine de bakar; bu yalniz gelistirme/ override yolu.
pub fn model_dir_from_env() -> Option<PathBuf> {
    std::env::var_os("ARSIV_EMBED_MODEL_DIR").map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pool_normalizes_to_unit_length() {
        // 2 token, dim 3; ikinci token maskeli (0) → yalniz ilk token sayilir.
        let hidden = vec![3.0, 0.0, 4.0, /*token2*/ 9.0, 9.0, 9.0];
        let mask = vec![1_i64, 0];
        let v = mean_pool_normalize(&hidden, &mask, 2, 3);
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5, "L2-norm ~1 olmali, {norm}");
        // 3-4-5 ucgeni → normalize (0.6, 0, 0.8)
        assert!((v[0] - 0.6).abs() < 1e-5);
        assert!((v[2] - 0.8).abs() < 1e-5);
    }
}
