//! **Kurulum kontrolu** — "bu bilgisayar gorsel analiz icin hazir mi?" sorusunu, kullanicidan
//! teknik bilgi ISTEMEDEN cevaplar.
//!
//! Gerekce (kullanici direktifi 2026-08-09): *"nvidia-smi ile surucu kontrolu programin kurulum
//! sirasinda bakacagi bir sey olsa daha iyi olur; kullanici bu islerden anlamiyor olabilir."*
//! Bugune kadar bir makinenin hazir olup olmadigi ancak analiz BASLATILIP coktukten sonra
//! anlasiliyordu — ustelik hata metni ham CUDA/PTX ciktisiydi.
//!
//! **Tasarim ilkesi: TAHMIN ETME, OLC ve OLGU SOYLE.**
//! - Kesin olarak bilinebilen seyler satir satir raporlanir (kart var mi, Ollama ayakta mi, yuklu
//!   vision modelinin OLCULMUS kalitesi ne, re-chunk modeli hazir mi).
//! - **Surucu surumu yargilanmaz.** "Bu surucu cok eski" kurali yok: 2026-08-07'de 561.17 CUDA/PTX
//!   hatasi verdi, ama bu makinede 560.94 sorunsuz calisiyor — belirleyen surucu degil, Ollama'nin
//!   hangi CUDA arac zinciriyle derlendigi. Sabit esik yanlis-alarm uretirdi. Sayi gosterilir;
//!   yargi, gercek `gpu_driver` hatasi olustugunda verilir (bkz `vision::classify_vision_error`).
//! - Kalan tek belirsizlik icin **gercek deneme** vardir: `vision_trial` (vision_commands.rs) tek
//!   gorseli URETIM yoluyla analiz eder. Tahmin eden kontrol degil, deneyen kontrol.
//!
//! Karar mantigi (satir → durum) burada **saf fonksiyonlar** olarak durur → birim-test edilebilir;
//! UI yalnizca kararli kodu i18n'e cevirir (metin Rust'ta kodlanmaz).

use serde::Serialize;
use tauri::State;

use crate::embed_commands::resolve_model_dir;
use crate::gpu::{self, GpuProbe};
use crate::ollama::{self, VisionQuality};
use crate::AppState;

/// Bir kontrol satirinin sonucu. `status`: `ok` | `warn` | `fail`.
/// `code` i18n anahtarina cevrilir (`setup_check.<code>`) — metin backend'de KODLANMAZ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRowDto {
    /// Satir kimligi (UI sirasi/ikonu icin): `gpu` | `ollama` | `vision_model` | `embed`.
    pub id: &'static str,
    pub status: &'static str,
    pub code: &'static str,
}

const OK: &str = "ok";
const WARN: &str = "warn";
const FAIL: &str = "fail";

/// GPU satiri. **Kart yok** ile **surucu okunamiyor** AYRI kodlar: ilkinde yapilacak sey "CPU ile
/// devam et ama cok yavas olacagini bil", ikincisinde "surucu kurulumunu kontrol et".
fn gpu_row(probe: &GpuProbe) -> CheckRowDto {
    let (status, code) = match probe {
        GpuProbe::Found(_) => (OK, "gpu_ok"),
        // Uyari (hata DEGIL): CPU ile analiz CALISIR, yalnizca cok yavastir. Bunu "fail" saymak
        // GPU'suz bir ofiste ozelligi kullanilamaz gosterirdi.
        GpuProbe::SmiMissing => (WARN, "gpu_none"),
        GpuProbe::Unreadable(_) => (WARN, "gpu_unreadable"),
    };
    CheckRowDto { id: "gpu", status, code }
}

/// Ollama satiri — vision analizinin ZORUNLU on kosulu (yoksa hicbir sey calismaz).
fn ollama_row(up: bool) -> CheckRowDto {
    let (status, code) = if up { (OK, "ollama_ok") } else { (FAIL, "ollama_down") };
    CheckRowDto { id: "ollama", status, code }
}

/// Vision modeli satiri — karar OLCULMUS kaliteye dayanir (`ollama::vision_quality`), tahmine degil.
///
/// `unusable` **fail**tir: model yuklu ve kosu baslar ama cop-korumasi her ciktiyi eler → saatler
/// harcanir, DB'ye tek satir yazilmaz. Bunu "uyari" saymak kullaniciyi bos bir kosuya yollardi.
/// `untested` yalnizca uyaridir: kanit yoklugu kotu kanit degildir (model ise yarayabilir).
fn vision_row(installed: usize, quality: Option<VisionQuality>) -> CheckRowDto {
    let (status, code) = match (installed, quality) {
        (0, _) => (FAIL, "vision_none"),
        (_, Some(VisionQuality::Unusable)) => (FAIL, "vision_unusable"),
        (_, Some(VisionQuality::Untested)) => (WARN, "vision_untested"),
        (_, Some(VisionQuality::Proven)) => (OK, "vision_ok"),
        // Model yuklu ama oneri motoru secim yapamadi (beklenmez) → sessiz gecme, uyar.
        (_, None) => (WARN, "vision_untested"),
    };
    CheckRowDto { id: "vision_model", status, code }
}

/// Yerel gomme (MiniLM) satiri: analiz sonrasi **yeniden-chunk** bunu gerektirir. Model yoksa
/// analiz kosusu zaten erken hata verir → uyari degil, engel.
fn embed_row(ready: bool) -> CheckRowDto {
    let (status, code) = if ready { (OK, "embed_ok") } else { (FAIL, "embed_missing") };
    CheckRowDto { id: "embed", status, code }
}

/// Genel sonuc: bir tane bile `fail` varsa `fail`; yoksa bir `warn` varsa `warn`; hepsi `ok` ise `ok`.
/// (En kotu satir kazanir — "3 yesil 1 kirmizi"yi yesil gostermek yanlis guven uretirdi.)
fn overall(rows: &[CheckRowDto]) -> &'static str {
    if rows.iter().any(|r| r.status == FAIL) {
        FAIL
    } else if rows.iter().any(|r| r.status == WARN) {
        WARN
    } else {
        OK
    }
}

/// Kurulum kontrolu sonucu — satirlar + UI'nin cumleye dolduracagi olgular.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupCheckDto {
    pub overall: &'static str,
    pub rows: Vec<CheckRowDto>,
    /// Kart adi (`None` → NVIDIA karti yok / okunamadi).
    pub gpu_name: Option<String>,
    pub vram_mb: Option<u32>,
    /// Surucu surumu — GOSTERILIR, yargilanmaz (bkz modul basligi).
    pub driver_version: Option<String>,
    /// `nvidia-smi` calisti ama okunamadiysa ham iz (teknik ayrinti; kaybolmaz).
    pub gpu_error: Option<String>,
    /// Etkin Ollama adresi (kullanici yanlis adrese bakmasin).
    pub ollama_base: String,
    /// Yuklu vision modeli sayisi.
    pub vision_model_count: usize,
    /// Kosuda kullanilacak model ("Otomatik"in cozdugu) — `None` → yuklu vision modeli yok.
    pub vision_model: Option<String>,
    /// `proven` | `untested` | `unusable`.
    pub vision_quality: Option<String>,
    /// Kullanilabilir model yoksa tek-komutluk cikis yolu (`ollama pull <bu>`).
    pub suggested_pull: Option<String>,
    /// AI analizi bekleyen gorsel sayisi (kullanici isin buyuklugunu gorsun).
    pub pending_images: i64,
}

/// Makinenin gorsel-analize hazir olup olmadigini TEK cagriyla raporla (salt-okuma; her rol).
/// Model CALISTIRMAZ — hizli on-kontroldur; gercek deneme ayri komuttur (`vision_trial`).
#[tauri::command]
pub fn setup_check(state: State<'_, AppState>) -> Result<SetupCheckDto, String> {
    let probe = gpu::probe();
    let gpu_info = match &probe {
        GpuProbe::Found(g) => Some(g.clone()),
        _ => None,
    };
    let gpu_error = match &probe {
        GpuProbe::Unreadable(raw) => Some(raw.clone()),
        _ => None,
    };

    // Tek `/api/tags` yoklamasi: ayakta mi + yuklu vision modelleri (boyutlariyla — oneri motoru
    // icin gerekli). Ollama yoksa Err → satirlar buna gore kurulur, komut yine BASARIYLA doner
    // (kurulum kontrolunun kendisi cokmemeli; zaten rapor edecegi sey "Ollama yok").
    let vision_models = ollama::list_vision_models_with_size().ok();
    let ollama_up = vision_models.is_some();
    let models = vision_models.unwrap_or_default();
    let vram_mb = gpu_info.as_ref().map(|g| g.vram_mb);
    let vision_model = ollama::recommend_vision(vram_mb, &models);
    let quality = vision_model.as_deref().map(ollama::vision_quality);

    // MiniLM (re-chunk) hazir mi — analiz yazimi bunu gerektirir.
    let embed_ready = resolve_model_dir().is_ok();

    let pending_images = {
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.pending_analysis_count().map_err(|e| e.to_string())?
    };

    let rows = vec![
        gpu_row(&probe),
        ollama_row(ollama_up),
        vision_row(models.len(), quality),
        embed_row(embed_ready),
    ];

    Ok(SetupCheckDto {
        overall: overall(&rows),
        rows,
        gpu_name: gpu_info.as_ref().map(|g| g.name.clone()),
        vram_mb,
        driver_version: gpu_info.and_then(|g| g.driver_version),
        gpu_error,
        ollama_base: ollama::base_and_source().0,
        vision_model_count: models.len(),
        vision_model,
        vision_quality: quality.map(|q| q.code().to_string()),
        suggested_pull: (quality != Some(VisionQuality::Proven))
            .then(|| ollama::DEFAULT_VISION_MODEL.to_string()),
        pending_images,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gpu::GpuInfo;

    fn info() -> GpuInfo {
        GpuInfo {
            name: "NVIDIA GeForce RTX 3060".into(),
            vram_mb: 12288,
            driver_version: Some("560.94".into()),
        }
    }

    /// GPU'nun UC durumu UC ayri koda gider — "kart yok" ile "surucu okunamiyor" ayni cumleye
    /// dusseydi kullanici yanlis yerde cozum ararrdi. Ikisi de `warn`: CPU ile analiz CALISIR.
    #[test]
    fn gpu_states_map_to_distinct_actionable_codes() {
        assert_eq!(gpu_row(&GpuProbe::Found(info())), CheckRowDto { id: "gpu", status: OK, code: "gpu_ok" });
        assert_eq!(gpu_row(&GpuProbe::SmiMissing).code, "gpu_none");
        assert_eq!(gpu_row(&GpuProbe::Unreadable("x".into())).code, "gpu_unreadable");
        assert_eq!(gpu_row(&GpuProbe::SmiMissing).status, WARN);
        assert_eq!(gpu_row(&GpuProbe::Unreadable("x".into())).status, WARN);
    }

    /// Vision karari OLCULMUS kaliteye dayanir. `unusable` **fail**: kosu baslar ama cop-korumasi
    /// her ciktiyi eler → saatlerce is, sifir kayit. `untested` yalnizca uyari (kanit yoklugu
    /// kotu kanit degil).
    #[test]
    fn vision_verdict_follows_measured_quality_not_presence() {
        assert_eq!(vision_row(0, None).status, FAIL);
        assert_eq!(vision_row(0, None).code, "vision_none");
        assert_eq!(vision_row(2, Some(VisionQuality::Unusable)).status, FAIL);
        assert_eq!(vision_row(2, Some(VisionQuality::Untested)).status, WARN);
        assert_eq!(vision_row(2, Some(VisionQuality::Proven)).status, OK);
        // Yuklu model VAR ama secim yapilamadi → sessiz "ok" DEGIL, uyari.
        assert_eq!(vision_row(2, None).status, WARN);
    }

    #[test]
    fn ollama_and_embed_are_hard_requirements() {
        assert_eq!(ollama_row(true).status, OK);
        assert_eq!(ollama_row(false).status, FAIL);
        assert_eq!(embed_row(true).status, OK);
        assert_eq!(embed_row(false).status, FAIL);
    }

    /// Genel sonuc = EN KOTU satir. Uc yesilin yanindaki tek kirmiziyi yesil gostermek, kurulum
    /// kontrolunu tam da guvenilmez kilan sey olurdu.
    #[test]
    fn overall_is_the_worst_row() {
        let ok = vec![ollama_row(true), embed_row(true)];
        assert_eq!(overall(&ok), OK);
        let warn = vec![ollama_row(true), gpu_row(&GpuProbe::SmiMissing)];
        assert_eq!(overall(&warn), WARN);
        let fail = vec![ollama_row(true), gpu_row(&GpuProbe::SmiMissing), embed_row(false)];
        assert_eq!(overall(&fail), FAIL, "tek fail tum sonucu fail yapmali");
        assert_eq!(overall(&[]), OK);
    }
}
