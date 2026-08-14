//! P0.4 — AI model bootstrap (H2 `fp32_models.rs` sadik port; **guided in-app import**).
//!
//! Modeller repoda YOK (~400MB, `.gitignore /models/`) → paketlenmis MSI'de fresh makinede AI
//! calismaz ("baska makinede AI calismiyor", STATUS 2026-06-23). H2 cozumu (MSI'ye GOMME →
//! "tamamen offline" koru): kullanici model klasorunu gosterir → app **`app_local_data_dir/
//! models/`**'a kopyalar (ilerlemeli) + dogrular. **Local** dizin (Roaming DEGIL — ~GB roaming
//! profile'a yazilmamali; H2 gerekcesi). Karar-kapisi: dagitim = guided import (kullanici sordu).
//!
//! Resolve zinciri (embed_commands/image_commands): (1) `ARSIV_*_MODEL_DIR` override, (2)
//! **`models_root()`** = app_local_data_dir/models (import hedefi; burada set edilir), (3) exe/cwd
//! `models/`, (4) yalniz DEV derlemede (`debug_assertions`): kaynak-makine fallback'i.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::{rbac, AppState};

/// Import hedefi = `app_local_data_dir/models`. Acilista bir kez set edilir (lib.rs setup);
/// `resolve_*_dir` bunu ILK aday yapar. App handle gerektirdiginden global (cagri yerleri App'siz).
static MODELS_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Acilista (setup) cagrilir — `app_local_data_dir/models`. Idempotent (ilk set kazanir).
pub(crate) fn set_models_root(dir: PathBuf) {
    let _ = MODELS_ROOT.set(dir);
}

/// Import edilen modellerin kok dizini. Setup'tan once (or. testte) None.
pub(crate) fn models_root() -> Option<PathBuf> {
    MODELS_ROOT.get().cloned()
}

/// Bir model dizininin altinda beklenen dosya: sabit (`File`) veya alternatiflerden EN AZ biri
/// (`AnyOf` — fp32 tercih / quantized varyantlar). Yollar ileri-egik ('/'); Windows kabul eder.
enum Marker {
    File(&'static str),
    AnyOf(&'static [&'static str]),
}

/// Gerekli bir AI modeli — frontend anahtari + dizin adi + tamlik marker'lari.
struct ModelSpec {
    key: &'static str,
    dir_name: &'static str,
    markers: &'static [Marker],
}

/// H3'un ihtiyac duydugu 3 model (archivist-embed `from_dir` gereksinimleriyle birebir).
const MODELS: &[ModelSpec] = &[
    ModelSpec {
        key: "text",
        dir_name: "paraphrase-multilingual-MiniLM-L12-v2",
        markers: &[
            Marker::File("tokenizer.json"),
            Marker::AnyOf(&["onnx/model.onnx", "onnx/model_quantized.onnx"]),
        ],
    },
    ModelSpec {
        key: "clip",
        dir_name: "clip-vit-base-patch32",
        markers: &[
            Marker::File("tokenizer.json"),
            Marker::AnyOf(&["onnx/vision_model.onnx", "onnx/vision_model_quantized.onnx"]),
            Marker::AnyOf(&["onnx/text_model.onnx", "onnx/text_model_quantized.onnx"]),
        ],
    },
    ModelSpec {
        key: "mclip",
        dir_name: "clip-ViT-B-32-multilingual-v1",
        markers: &[
            Marker::File("tokenizer.json"),
            Marker::File("2_Dense/model.safetensors"),
            Marker::AnyOf(&[
                "onnx/model.onnx",
                "onnx/model_quint8_avx2.onnx",
                "onnx/model_quantized.onnx",
                "onnx/model_qint8_avx512.onnx",
            ]),
        ],
    },
];

/// `dir` bu modeli TAM iceriyor mu (tum marker'lar saglanmali). Saf → birim-test edilebilir.
fn model_present_in(dir: &Path, spec: &ModelSpec) -> bool {
    spec.markers.iter().all(|m| match m {
        Marker::File(rel) => dir.join(rel).is_file(),
        Marker::AnyOf(alts) => alts.iter().any(|rel| dir.join(rel).is_file()),
    })
}

// ── Durum (status) ────────────────────────────────────────────────────────────

/// Tek bir model icin durum (UI: hazir mi + hangi yoldan cozuldu).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    key: &'static str,
    dir_name: &'static str,
    /// Herhangi bir aday'dan resolve edilebiliyor mu (embedder'in gordugu gercek).
    ready: bool,
    /// `ready` ise resolve edilen dizin (teshis/gorunurluk).
    path: Option<String>,
}

/// Tum modellerin durumu + import hedef dizini (UI "AI Modelleri" bolumu).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelsStatusDto {
    all_ready: bool,
    models: Vec<ModelInfo>,
    /// `app_local_data_dir/models` — import buraya kopyalar (UI gosterir). Setup'tan once bos.
    import_root: String,
}

/// AI model durum ozeti — her modelin resolve edilebilirligi (embed/image resolve'unu kullanir →
/// dogruyu soyler) + import hedefi. Bilgilendirme (rol gate YOK; import'un kendisi admin).
#[tauri::command]
pub fn model_status() -> ModelsStatusDto {
    // MODELS registry'sinden don; her modelin resolve'unu (embed/image) yeniden kullan → durum
    // embedder'in gordugu gercekle birebir (tek dogruluk kaynagi).
    let models: Vec<ModelInfo> = MODELS
        .iter()
        .map(|spec| {
            let resolved = match spec.key {
                "text" => crate::embed_commands::resolve_model_dir(),
                "clip" => crate::image_commands::resolve_clip_dir(),
                "mclip" => crate::image_commands::resolve_mclip_dir(),
                _ => Err("bilinmeyen model".to_string()),
            };
            ModelInfo {
                key: spec.key,
                dir_name: spec.dir_name,
                ready: resolved.is_ok(),
                path: resolved.ok().map(|p| p.display().to_string()),
            }
        })
        .collect();
    let all_ready = models.iter().all(|m| m.ready);
    let import_root = models_root().map(|p| p.display().to_string()).unwrap_or_default();
    ModelsStatusDto { all_ready, models, import_root }
}

// ── Import (kopyalama) ──────────────────────────────────────────────────────────

/// Import ilerlemesi (Channel → frontend ilerleme cubugu). H2 fp32 progress deseni.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    /// `"scanning"` | `"copying"` | `"validating"` | `"done"`.
    phase: String,
    /// Su anki model/dosya etiketi.
    current: String,
    copied_bytes: u64,
    total_bytes: u64,
}

/// Import sonucu — hangi modeller kopyalandi / zaten vardi / kaynakta bulunamadi.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    imported: Vec<String>,
    already: Vec<String>,
    missing: Vec<String>,
    dest_root: String,
}

/// Kaynak agacinda bu modeli bul: (1) `<root>/<ad>`, (2) `<root>/Xenova/<ad>` (H2 yerlesimi),
/// (3) sinirli derinlikte (<=4) `<ad>` isimli + tam dogrulanan dizin. Bulamazsa None.
fn find_model_source(root: &Path, spec: &ModelSpec) -> Option<PathBuf> {
    let direct = root.join(spec.dir_name);
    if model_present_in(&direct, spec) {
        return Some(direct);
    }
    let xenova = root.join("Xenova").join(spec.dir_name);
    if model_present_in(&xenova, spec) {
        return Some(xenova);
    }
    find_named_dir(root, spec, 0, 4)
}

/// `dir` altinda (sinirli derinlik) `spec.dir_name` isimli + tam dogrulanan ilk dizin.
fn find_named_dir(dir: &Path, spec: &ModelSpec, depth: usize, max: usize) -> Option<PathBuf> {
    if depth > max {
        return None;
    }
    for e in std::fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        if p.file_name().and_then(|n| n.to_str()) == Some(spec.dir_name) && model_present_in(&p, spec)
        {
            return Some(p);
        }
        if let Some(found) = find_named_dir(&p, spec, depth + 1, max) {
            return Some(found);
        }
    }
    None
}

/// Bir dizin agacinin toplam dosya boyutu (progress toplami icin).
fn dir_size(dir: &Path) -> u64 {
    let mut sum = 0;
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            sum += if p.is_dir() { dir_size(&p) } else { e.metadata().map(|m| m.len()).unwrap_or(0) };
        }
    }
    sum
}

/// `src` agacini `dst`'ye kopyala; her dosyada `copied`'i buyut + `emit` ile ilerleme bildir.
fn copy_dir(
    src: &Path,
    dst: &Path,
    label: &str,
    copied: &mut u64,
    total: u64,
    emit: &mut dyn FnMut(ImportProgress),
) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for e in std::fs::read_dir(src)? {
        let e = e?;
        let from = e.path();
        let to = dst.join(e.file_name());
        if from.is_dir() {
            copy_dir(&from, &to, label, copied, total, emit)?;
        } else {
            std::fs::copy(&from, &to)?;
            *copied += e.metadata().map(|m| m.len()).unwrap_or(0);
            emit(ImportProgress {
                phase: "copying".into(),
                current: format!("{label} / {}", e.file_name().to_string_lossy()),
                copied_bytes: *copied,
                total_bytes: total,
            });
        }
    }
    Ok(())
}

/// **Import cekirdegi (saf; Tauri'siz → test edilebilir).** `source` altindaki modelleri bul,
/// `dest_root/<ad>`'e kopyala; `emit` ilerleme. Zaten dest'te tam olan atlanir (idempotent).
fn do_import(
    source: &Path,
    dest_root: &Path,
    mut emit: impl FnMut(ImportProgress),
) -> Result<ImportReport, String> {
    if !source.is_dir() {
        return Err("kaynak klasor bulunamadi".to_string());
    }
    std::fs::create_dir_all(dest_root).map_err(|e| e.to_string())?;

    let mut report = ImportReport { dest_root: dest_root.display().to_string(), ..Default::default() };

    // 1) Tarama: her model icin dest'te var mi / kaynakta nerede → kopyalanacaklar + toplam boyut.
    emit(ImportProgress {
        phase: "scanning".into(),
        current: String::new(),
        copied_bytes: 0,
        total_bytes: 0,
    });
    let mut jobs: Vec<(&ModelSpec, PathBuf)> = Vec::new();
    for spec in MODELS {
        let dest = dest_root.join(spec.dir_name);
        if model_present_in(&dest, spec) {
            report.already.push(spec.dir_name.to_string());
            continue;
        }
        match find_model_source(source, spec) {
            Some(src) => jobs.push((spec, src)),
            None => report.missing.push(spec.dir_name.to_string()),
        }
    }

    let total: u64 = jobs.iter().map(|(_, src)| dir_size(src)).sum();
    let mut copied: u64 = 0;

    // 2) Kopyala.
    for (spec, src) in &jobs {
        let dest = dest_root.join(spec.dir_name);
        copy_dir(src, &dest, spec.dir_name, &mut copied, total, &mut emit)
            .map_err(|e| format!("{} kopyalanamadi: {e}", spec.dir_name))?;
        // 3) Kopya sonrasi dogrula (kismi/bozuk kopyayi "import edildi" sayma).
        emit(ImportProgress {
            phase: "validating".into(),
            current: spec.dir_name.to_string(),
            copied_bytes: copied,
            total_bytes: total,
        });
        if !model_present_in(&dest, spec) {
            return Err(format!("{} kopyalandi ama dogrulama basarisiz (eksik dosya)", spec.dir_name));
        }
        report.imported.push(spec.dir_name.to_string());
    }

    emit(ImportProgress {
        phase: "done".into(),
        current: String::new(),
        copied_bytes: copied,
        total_bytes: total,
    });
    Ok(report)
}

/// Modelleri bir kaynak klasorden `app_local_data_dir/models/`'a **import et** (ADMIN; ilerlemeli).
/// Offline korunur (internet yok — kullanici klasoru getirir). Zaten var olan model atlanir.
#[tauri::command]
pub fn import_models(
    state: State<'_, AppState>,
    source_dir: String,
    on_progress: Channel<ImportProgress>,
) -> Result<ImportReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    let dest_root = models_root().ok_or("model kok dizini hazir degil (app_local_data_dir)")?;
    let source = PathBuf::from(source_dir);
    let report = do_import(&source, &dest_root, |p| {
        let _ = on_progress.send(p);
    })?;
    // Model(ler) iceri alindi → oto-indeksi DURT: bekleyen gorsel/metin embedleri artik modeli
    // bulunca KENDILIGINDEN uretilsin (kullanici ayrica "Embedle" tiklamasin — H2-vari otomatik akis;
    // oto-indeks varsayilan ACIK, kapaliysa tik yok sayilir). Yalniz gercekten yeni model geldiyse.
    if !report.imported.is_empty() {
        crate::indexer::signal_index();
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Bir modeli temp dizinde olustur (marker dosyalari; icerik onemsiz — sadece varlik).
    fn make_model(base: &Path, dir_name: &str, files: &[&str]) -> PathBuf {
        let root = base.join(dir_name);
        for rel in files {
            let p = root.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, b"x").unwrap();
        }
        root
    }

    fn text_spec() -> &'static ModelSpec {
        MODELS.iter().find(|m| m.key == "text").unwrap()
    }

    #[test]
    fn present_requires_all_markers_anyof_picks_variant() {
        let tmp = tempfile::tempdir().unwrap();
        let spec = text_spec();
        // Yalniz tokenizer → eksik (onnx yok).
        let only_tok = make_model(tmp.path(), "only_tok", &["tokenizer.json"]);
        assert!(!model_present_in(&only_tok, spec));
        // tokenizer + quantized onnx (AnyOf ikinci alternatif) → tam.
        let full = make_model(
            tmp.path(),
            "paraphrase-multilingual-MiniLM-L12-v2",
            &["tokenizer.json", "onnx/model_quantized.onnx"],
        );
        assert!(model_present_in(&full, spec));
    }

    #[test]
    fn find_source_direct_xenova_and_nested() {
        let tmp = tempfile::tempdir().unwrap();
        let spec = text_spec();
        let files = ["tokenizer.json", "onnx/model.onnx"];
        // Xenova-nested yerlesim (H2).
        let xdir = tmp.path().join("Xenova");
        std::fs::create_dir_all(&xdir).unwrap();
        make_model(&xdir, spec.dir_name, &files);
        let found = find_model_source(tmp.path(), spec).expect("Xenova altinda bulunmali");
        assert!(model_present_in(&found, spec));

        // Derin (sinir icinde) yerlesim.
        let deep = tempfile::tempdir().unwrap();
        let nested = deep.path().join("a").join("b");
        std::fs::create_dir_all(&nested).unwrap();
        make_model(&nested, spec.dir_name, &files);
        assert!(find_model_source(deep.path(), spec).is_some(), "derinde bulunmali");

        // Yok → None.
        let empty = tempfile::tempdir().unwrap();
        assert!(find_model_source(empty.path(), spec).is_none());
    }

    #[test]
    fn do_import_copies_missing_skips_already_reports_missing() {
        let src = tempfile::tempdir().unwrap();
        let dst = tempfile::tempdir().unwrap();
        // Kaynakta yalniz 'text' modeli tam (Xenova yerlesimi).
        let xdir = src.path().join("Xenova");
        std::fs::create_dir_all(&xdir).unwrap();
        make_model(&xdir, "paraphrase-multilingual-MiniLM-L12-v2", &["tokenizer.json", "onnx/model.onnx"]);

        let mut phases = Vec::new();
        let report = do_import(src.path(), dst.path(), |p| phases.push(p.phase)).unwrap();

        assert_eq!(report.imported, vec!["paraphrase-multilingual-MiniLM-L12-v2"]);
        // clip + mclip kaynakta yok → missing.
        assert!(report.missing.contains(&"clip-vit-base-patch32".to_string()));
        assert!(report.missing.contains(&"clip-ViT-B-32-multilingual-v1".to_string()));
        assert!(report.already.is_empty());
        // Gercekten kopyalandi + dogrulandi.
        assert!(model_present_in(&dst.path().join("paraphrase-multilingual-MiniLM-L12-v2"), text_spec()));
        assert!(phases.contains(&"done".to_string()));

        // 2. import → artik dest'te var → 'already', kopya yok.
        let report2 = do_import(src.path(), dst.path(), |_| {}).unwrap();
        assert_eq!(report2.already, vec!["paraphrase-multilingual-MiniLM-L12-v2"]);
        assert!(report2.imported.is_empty());
    }
}
