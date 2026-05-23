//! fp32 model harici import — WebGPU için fp32 ONNX modelleri kullanıcı-sağlamalı
//! bağımlılık (ODA FileConverter paterniyle aynı felsefe). MSI'ye gömülmez (~580MB+),
//! "tamamen offline" korunur. Kullanıcı `npm run models:download:fp32` ile dolan
//! `public/models` klasörünü gösterir; tüm `Xenova/` ağacı (q8 + fp32 + config)
//! app_local_data_dir/models/'a kopyalanır. Frontend fp32 mevcutsa localModelPath'i
//! oraya yönlendirir (asset protokol — bkz. embeddings.ts).
//!
//! Neden app_local_data_dir (Local) — app_data_dir (Roaming) değil: ~1GB model
//! Roaming profile'a yazılmamalı. Asset protokol scope'u `**` içerdiği için
//! (tauri.conf.json) Local dizin yine servis edilir (Phase 0'da doğrulandı).

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

/// fp32/q8 model ağacının app_local_data_dir altındaki kök dizini (`.../models`).
fn fp32_models_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("app_local_data_dir alınamadı: {}", e))?;
    Ok(base.join("models"))
}

/// fp32 onnx dosyalarının modeller köküne göreli yolları (kritik payload —
/// q8 ve config dosyaları aynı `models:download` ile her zaman yanında gelir).
const FP32_FILES: &[&str] = &[
    "Xenova/paraphrase-multilingual-MiniLM-L12-v2/onnx/model.onnx",
    "Xenova/clip-vit-base-patch32/onnx/vision_model.onnx",
    "Xenova/clip-vit-base-patch32/onnx/text_model.onnx",
];

#[derive(Serialize)]
pub struct Fp32Status {
    imported: bool,
    path: String,
    missing: Vec<String>,
}

/// fp32 modelleri import edilmiş mi — app_local_data_dir/models altında 3 fp32
/// onnx dosyasının varlığını (ve makul boyutta olduğunu) kontrol eder.
#[tauri::command]
pub fn fp32_models_status(app: AppHandle) -> Result<Fp32Status, String> {
    let root = fp32_models_root(&app)?;
    let mut missing = Vec::new();
    for rel in FP32_FILES {
        let p = root.join(rel);
        // >1MB: kısmi/bozuk kopyayı "var" sayma
        let ok = std::fs::metadata(&p)
            .map(|m| m.len() > 1024 * 1024)
            .unwrap_or(false);
        if !ok {
            missing.push((*rel).to_string());
        }
    }
    Ok(Fp32Status {
        imported: missing.is_empty(),
        path: root.to_string_lossy().to_string(),
        missing,
    })
}

#[derive(Serialize, Clone)]
struct Fp32Progress {
    phase: String, // "validating" | "copying" | "done"
    current_file: String,
    copied_bytes: u64,
    total_bytes: u64,
}

/// Kaynak kökü çözümle: doğrudan `Xenova/` içeren dizin veya `<dir>/models`.
fn resolve_source_root(source: &Path) -> Result<PathBuf, String> {
    for c in [source.to_path_buf(), source.join("models")] {
        if c.join(FP32_FILES[0]).is_file() {
            return Ok(c);
        }
    }
    Err("Seçilen klasörde fp32 modelleri bulunamadı. 'npm run models:download:fp32' \
         ile indirilen 'public/models' klasörünü (Xenova/ içeren) seçin."
        .to_string())
}

fn dir_size(root: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(m) = e.metadata() {
                total += m.len();
            }
        }
    }
    total
}

/// Ağacı recursive kopyalar; her dosya `.part` → atomik rename. İlerleme emit eder.
fn copy_tree(
    src: &Path,
    dst: &Path,
    app: &AppHandle,
    copied: &mut u64,
    total: u64,
) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|e| format!("Dizin oluşturulamadı {}: {}", dst.display(), e))?;
    for entry in std::fs::read_dir(src).map_err(|e| format!("Okunamadı {}: {}", src.display(), e))? {
        let entry = entry.map_err(|e| format!("Dizin girdisi hatası: {}", e))?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_tree(&from, &to, app, copied, total)?;
        } else {
            let tmp = to.with_extension("part");
            std::fs::copy(&from, &tmp)
                .map_err(|e| format!("Kopyalanamadı {}: {}", from.display(), e))?;
            if to.exists() {
                let _ = std::fs::remove_file(&to);
            }
            std::fs::rename(&tmp, &to)
                .map_err(|e| format!("Yeniden adlandırılamadı {}: {}", to.display(), e))?;
            *copied += entry.metadata().map(|m| m.len()).unwrap_or(0);
            let _ = app.emit(
                "fp32_import_progress",
                Fp32Progress {
                    phase: "copying".into(),
                    current_file: entry.file_name().to_string_lossy().to_string(),
                    copied_bytes: *copied,
                    total_bytes: total,
                },
            );
        }
    }
    Ok(())
}

/// Kullanıcının gösterdiği klasörden tüm `Xenova/` ağacını
/// app_local_data_dir/models/'a kopyalar. Admin-only.
#[tauri::command]
pub async fn import_fp32_models(
    app: AppHandle,
    source_dir: String,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<(), String> {
    crate::require_admin(&role_state)?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let src_root = resolve_source_root(Path::new(&source_dir))?;
        for rel in FP32_FILES {
            if !src_root.join(rel).is_file() {
                return Err(format!("Kaynakta eksik fp32 dosyası: {}", rel));
            }
        }
        let xen_src = src_root.join("Xenova");
        let dst_root = fp32_models_root(&app2)?;
        let xen_dst = dst_root.join("Xenova");
        std::fs::create_dir_all(&dst_root)
            .map_err(|e| format!("Hedef dizin oluşturulamadı: {}", e))?;

        let _ = app2.emit(
            "fp32_import_progress",
            Fp32Progress {
                phase: "validating".into(),
                current_file: String::new(),
                copied_bytes: 0,
                total_bytes: 0,
            },
        );
        let total = dir_size(&xen_src);
        let mut copied = 0u64;
        copy_tree(&xen_src, &xen_dst, &app2, &mut copied, total)?;

        let _ = app2.emit(
            "fp32_import_progress",
            Fp32Progress {
                phase: "done".into(),
                current_file: String::new(),
                copied_bytes: copied,
                total_bytes: total,
            },
        );
        log::info!(
            "fp32 modelleri import edildi: {} ({} bytes)",
            xen_dst.display(),
            copied
        );
        Ok(())
    })
    .await
    .map_err(|e| format!("Async runtime hatası: {}", e))?
}
