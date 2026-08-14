//! AI gorsel-analiz komutlari (vision pipeline) — H2'nin "zengin + isabetli" sirri: thumbnail'i
//! VISION modeline yollayip METIN betimleme cikar (`vision.rs`) → `ai_*` EAV → re-chunk → GORSEL-
//! icerik BIRLESIK metin aramasiyla bulunur (ayri CLIP modu/esigi GEREKMEZ) + OCR (METIN bolumu).
//!
//! Job deseni run_rag_indexing/run_image_embedding ile ayni (admin, resumable cursor, Channel).
//! FARK: her asset icin UZUN Ollama vision cagrisi → kilitler o cagri SIRASINDA tutulmaz.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use archivist_db::AnalysisScope;

use crate::embed_commands::{ensure_embedder, resolve_model_dir};
use crate::rag_commands::index_one;
use crate::{ollama, rbac, vision, AppState};

// Model-karsilastirma olcumu (`#[ignore]`, gercek arsiv + gercek Ollama). ALT-modul olarak
// baglanir cunku bu dosyanin OZEL yardimcilarini (`higher_res_preview`, `build_binary_context`,
// `is_ctx_overflow`) `super::` ile kullanir → olcum uretim yolunun AYNISINI kosar, kopyasini degil.
#[cfg(test)]
#[path = "vision_bench.rs"]
mod vision_bench;

/// Analiz batch boyu (resumable; her asset ayri uzun vision cagrisi → kucuk batch).
const BATCH: i64 = 16;

/// **Devre kesici** esigi: art arda bu kadar basarisizlik → kosu kendiliginden durur.
///
/// Gerekce (kullanici bulgusu 2026-08-07): model yuklenemedigi/uyumsuz oldugu ya da her cagriyi
/// zaman asimina ugrattigi durumda hata dosyaya OZGU degil KOSUYA ozgudur — sonraki her dosya ayni
/// hatayi, ustelik zaman asimi sinirini (120 sn) bekleyerek alir. 3.619 dosyalik bir kuyrukta bu
/// SAATLERCE bosa CPU/disk ve sonunda "3.619 basarisiz" raporu demekti. Ucte durup NEDENI soylemek
/// dogrusu: kullanici sorunu (or. surucu/model) cozup kaldigi yerden devam eder — elenen dosyalar
/// `ai_analyzed` damgasi YEMEDIGI icin bekleyen kalir (resumable).
const MAX_CONSECUTIVE_FAILURES: u32 = 3;

/// Gorsel-analiz kosusu SU AN aktif mi (eszamanli iki kosu onleme: Dashboard blanket + BatchToolbar
/// secim ayni anda basmasin). indexer'daki `ACTIVE` deseninin esi — ama AYRI statics (isim/kapsam
/// cakismasin; iki surucu bagimsiz durdurulur/aktiflenir).
static VISION_ACTIVE: AtomicBool = AtomicBool::new(false);
/// Durdur istegi ("Durdur"): kosu asset-arasi + batch-basi gorup erken cikar → kalan is bekleyen
/// kalir (resumable; `ai_analyzed` isareti sayesinde tekrar kosulunca kaldigi yerden). indexer `STOP` esi.
static VISION_STOP: AtomicBool = AtomicBool::new(false);

/// `VISION_ACTIVE`'i Drop'ta sifirlayan RAII muhafizi — async fn'de `?` erken-donusler + panik/
/// future-iptali durumlarinda bile "aktif" bayragi asili kalmasin (aksi halde ikinci kosu sonsuza
/// dek "zaten calisiyor" hatasi alirdi). indexer'daki elle `ACTIVE.store(false)` yerine RAII secildi
/// cunku bu komut async + coklu `?` erken-donus icerir → her donus yolunu elle kapatmak kirilgan.
struct ActiveGuard;
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        VISION_ACTIVE.store(false, Ordering::SeqCst);
        clear_live_progress();
    }
}

/// Frontend'ten gelen AI vision-analiz KAPSAMI (serde tagged enum, camelCase) → `archivist_db::
/// AnalysisScope`'a donusur. Frontend gonderimi (tag = "kind"):
/// - `{kind:"all"}`                          → tum uygun asset'ler (blanket; olcek: pahali).
/// - `{kind:"ids", ids:[1,2,3]}`             → yalniz secilen asset id'leri (BatchToolbar secimi).
/// - `{kind:"filter", filter:{...ListOpts...}}` → facet filtresine uyanlar (FTS `query` yok sayilir).
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AnalysisScopeDto {
    All,
    Ids { ids: Vec<i64> },
    // `ListOpts` buyuk (296B) → db katmani `AnalysisScope`'ta oldugu gibi burada da `Box`'la
    // (clippy large_enum_variant; kucuk All/Ids variantlarini sismesin). Serde icin seffaf:
    // frontend yine `{kind:"filter", filter:{...ListOpts...}}` gonderir (JSON sekli degismez).
    Filter { filter: Box<archivist_db::ListOpts> },
}

impl From<AnalysisScopeDto> for AnalysisScope {
    fn from(dto: AnalysisScopeDto) -> Self {
        match dto {
            AnalysisScopeDto::All => AnalysisScope::All,
            AnalysisScopeDto::Ids { ids } => AnalysisScope::Ids(ids),
            AnalysisScopeDto::Filter { filter } => AnalysisScope::Filter(filter),
        }
    }
}

/// Gorsel-analiz durumu (Dashboard "Gorsel Analizi" karti).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAnalysisStatusDto {
    /// AI-analizi olan aktif asset.
    pub analyzed: i64,
    /// Thumbnail'i olan ama analiz edilmemis aktif asset (kalan is).
    pub pending: i64,
    /// Bekleyenlerin **kucuk-dosya** kismi (`< SMALL_FILE_BYTES`) — ikon/logo/doku/ekran goruntusu
    /// olma ihtimali yuksek olanlar. GORUNURLUK icindir, eleme DEGIL (bkz
    /// `pending_analysis_small_count`). Kullanici kosuyu buna bakarak planlar.
    pub pending_small: i64,
    /// `pending_small`in esigi (bayt) — metni frontend'de sabitlemeyelim diye DTO ile gelir.
    pub small_file_bytes: i64,
    /// Embedlenebilir evren (analyzed + pending).
    pub total: i64,
    /// MiniLM (re-chunk) modeli hazir mi — analiz sonrasi yeniden-chunk icin gerekir.
    pub embed_ready: bool,
    pub active: bool,
    pub progress: Option<ImageAnalysisProgressDto>,
}

/// Analiz ilerlemesi (Channel; embed/rag deseni, camelCase).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAnalysisProgressDto {
    pub processed: i64,
    pub total: i64,
    pub current_path: String,
}

static VISION_LIVE_PROGRESS: OnceLock<Mutex<Option<ImageAnalysisProgressDto>>> = OnceLock::new();

fn live_progress_slot() -> &'static Mutex<Option<ImageAnalysisProgressDto>> {
    VISION_LIVE_PROGRESS.get_or_init(|| Mutex::new(None))
}

fn store_live_progress(progress: ImageAnalysisProgressDto) {
    let mut slot = live_progress_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *slot = Some(progress);
}

fn clear_live_progress() {
    let mut slot = live_progress_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *slot = None;
}

/// Analiz kosusu raporu.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAnalysisReportDto {
    pub analyzed: i64,
    pub failed: i64,
    pub elapsed_ms: u128,
    /// İlk basarisizligin nedeni (`dosya: hata`) — H2 vision hatayi yutmaz; UI'da goster ki
    /// "6 takildi" yerine NEDEN gorulsun (sessiz `failed` kor-nokta yaratiyordu).
    pub sample_error: Option<String>,
    /// Kullanici "Durdur" ile mi bitti (iptal). true → kalan is bekleyen kalir (resumable; tekrar
    /// kosulunca kaldigi yerden). false → kapsam tumuyle tarandi (dogal bitis).
    pub stopped: bool,
    /// İlk basarisizligin KARARLI sinif kodu (`gpu_driver` | `timeout` | `ollama_down` |
    /// `context_overflow` | `model_missing` | `out_of_memory` | `unusable_output` | `write_failed`
    /// | `other`). Frontend bunu i18n ile tek cumleye cevirir; `sample_error` ham detay olarak
    /// kalir (teknik iz kaybolmaz).
    pub error_kind: Option<String>,
    /// **Devre kesici**: art arda bu kadar hata gorulup kosu KENDILIGINDEN durdurulduysa dolu
    /// (`None` → devre kesici devreye girmedi). UI bunu "durduruldu, nedeni su" diye gosterir.
    pub aborted_after_consecutive_failures: Option<u32>,
}

/// Ollama'da yuklu VISION modelleri (gorsel-analiz model secici; UI). Ollama/vision yoksa Err.
#[tauri::command]
pub fn ollama_vision_models() -> Result<Vec<String>, String> {
    ollama::list_vision_models()
}

/// GPU'ya gore onerilen vision modeli (makine-yerel; her lokasyon kendi GPU'suna gore).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionRecommendationDto {
    /// Tespit edilen NVIDIA GPU adi; `None` → NVIDIA GPU yok (CPU).
    pub gpu_name: Option<String>,
    /// Toplam VRAM (MB); `None` → GPU yok.
    pub vram_mb: Option<u32>,
    /// Onerilen yuklu vision modeli; `None` → yuklu vision modeli yok.
    pub recommended: Option<String>,
    /// Onerilen modelin **olculmus kalite** sinifi: `proven` | `untested` | `unusable`
    /// (bkz `ollama::VisionQuality`). `unusable` → yuklu modellerin HICBIRI ise yarar cikti
    /// uretmiyor demektir; UI bunu uyariya cevirip [`Self::suggested_pull`]'u onerir.
    pub quality: Option<String>,
    /// Kalite `unusable` oldugunda kullaniciya onerilen model etiketi (`ollama pull <bu>`);
    /// aksi halde `None`. Sabit tek kaynaktan gelir → UI'da model adi kodlanmaz.
    pub suggested_pull: Option<String>,
}

/// GPU'yu (NVIDIA) tespit et + yuklu vision modelleri arasindan **en iyisini** oner (once olculmus
/// cikti kalitesi, sonra VRAM'e sigma — bkz [`ollama::recommend_vision`]).
/// Salt-oneri: hicbir seyi degistirmez/kaydetmez (UI gosterir; kullanici "Uygula" ile secer ya da
/// "Otomatik"te birakir → oneri kullanilir). Makine-yerel. Ollama calismiyorsa Err (UI sessiz gecer).
#[tauri::command]
pub fn recommend_vision_model() -> Result<VisionRecommendationDto, String> {
    let gpu = crate::gpu::detect_nvidia();
    let models = ollama::list_vision_models_with_size()?;
    let vram_mb = gpu.as_ref().map(|g| g.vram_mb);
    let recommended = ollama::recommend_vision(vram_mb, &models);
    let quality = recommended.as_deref().map(ollama::vision_quality);
    Ok(VisionRecommendationDto {
        gpu_name: gpu.map(|g| g.name),
        vram_mb,
        recommended,
        quality: quality.map(|q| q.code().to_string()),
        suggested_pull: (quality == Some(ollama::VisionQuality::Unusable))
            .then(|| ollama::DEFAULT_VISION_MODEL.to_string()),
    })
}

/// Bir basarisizlik **devre kesiciye** sayilir mi? (Bulgu 2026-08-09.)
///
/// Devre kesicinin gerekcesi "hata dosyaya degil KOSUYA aittir" idi — surucu cokmesi, model
/// eksikligi, servis kapali. `unusable_output` bu tanima UYMAZ: model'e ULASILDI ve yanit ALINDI,
/// yani servis saglikli; bicimin tutmamasi cogu zaman DOSYAYA ozgudur. Olculmus ornek: saglikli
/// `qwen2.5vl:3b` bir logo gorseline *"I'm sorry, but I can't assist with that request"* dedi.
/// Bir logo klasorunde art arda uc boyle dosya, 30.223'luk kuyrugu ucuncu dosyada durdurur ve
/// raporu "kosu arizasi" diye yazardi.
///
/// Koruma yine de kalkmaz — moondream'in HER gorsele `" [0"` demesi GERCEK bir kosu arizasiydi:
/// kosu **henuz bir kez bile** basarili analiz uretmediyse (`analyzed == 0`) bicim-tutmazlik
/// sayilir. Bir basari geldikten sonra model calisiyor demektir → sonraki elenmeler icerige aittir.
fn counts_as_run_fault(kind: &str, analyzed: i64) -> bool {
    kind != "unusable_output" || analyzed == 0
}

/// Deneme kacinci gorsele kadar surer. **Neden 1 degil (bulgu 2026-08-09):** ilk kurulum
/// denemesinde `qwen2.5vl:3b` (olculmus-saglikli model) ilk bekleyen gorsele — bir logoya —
/// *"I'm sorry, but I can't assist with that request"* dedi. Tek ornekle olculseydi saglikli
/// bir kurulum KALICI olarak "bozuk" raporlanirdi: ornek her zaman AYNI (en kucuk id'li bekleyen)
/// dosyadir, yani dugmeye tekrar basmak da ayni sonucu verirdi.
const TRIAL_SAMPLES: usize = 3;

/// Ornekler bu buyuklukteki bekleyen havuzundan **esit aralikli** secilir. Bastan uc dosyayi
/// almak yetmez: bekleyenler id sirasindadir, yani ucu de AYNI klasordendir. Kullanicinin ilk
/// denemesinde ucu de logo cikardi — arsivin geri kalanini hic temsil etmeyen bir olcum.
const TRIAL_POOL: i64 = 30;

/// "Kucuk dosya" esigi (bayt). 20 KB, gercek arsivde OLCULEN esiktir: bekleyen 28.048 gorselin
/// %90,6'si bu sinirin altindaydi ve orneklendiginde ikon/logo/ekran-goruntusu/malzeme dokusu
/// cikti (STATUS 2026-08-09). Yuvarlak ve aciklanabilir olmasi onemli — kullaniciya "20 KB alti"
/// diye gosterilir; sihirli bir ic-esik degil, ekranda YAZAN bir sayidir.
const SMALL_FILE_BYTES: i64 = 20 * 1024;

/// Denemenin toplam sure butcesi. Hizli makinede (gorsel basi saniyeler) uc ornek de kosar →
/// sure tahmini tek olcumun gurultusune degil ORTALAMAYA dayanir. Yavas makinede (olculdu:
/// 235 sn/gorsel) ilk ornekten sonra butce dolar ve deneme durur — orada zaten tek olcum
/// "bu makine yavas" demeye yeter, kullaniciyi 12 dakika bekletmenin anlami yok.
const TRIAL_BUDGET_MS: u128 = 60_000;

/// Havuzdan `want` kadar **esit aralikli** indeks (bastan ard arda DEGIL) — bkz [`TRIAL_POOL`].
fn spread_indices(len: usize, want: usize) -> Vec<usize> {
    if len == 0 || want == 0 {
        return Vec::new();
    }
    let want = want.min(len);
    (0..want).map(|i| i * len / want).collect()
}

/// Denemedeki TEK bir gorselin sonucu.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionTrialAttemptDto {
    /// Denenen dosyanin adi (hangi gorsel uzerinde olculdu).
    pub file_name: String,
    /// Cikti URETIMDE kabul edilir miydi (`is_usable`).
    pub usable: bool,
    /// Bu gorselin toplam suresi.
    pub elapsed_ms: u128,
    /// Ayristirilabilen icerik alani sayisi (`to_eav().len()`).
    pub field_count: usize,
    /// Hata sinifi (`vision::classify_vision_error`); model yanit verdiyse `None`.
    pub error_kind: Option<String>,
    /// Ham hata metni — teknik ayrinti olarak korunur (kaybolmaz).
    pub error_detail: Option<String>,
    /// Uretilen metinden kisa ornek. Basarisizlikta da DOLU olur — kullanicinin "model ne dedi"
    /// sorusuna tek cevap budur (reddetme mi, sacmalama mi, ayirt eden INSANDIR).
    pub sample: Option<String>,
    /// Baglam tasmasi olup context'siz tekrar denendi mi (uretim dali; gizlenmez).
    pub lean_retry: bool,
}

/// GERCEK deneme sonucu (kurulum kontrolu). Sayilar bu makineye aittir.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisionTrialDto {
    /// Denemede kullanilan model (istemci vermediyse oneri motorunun sectigi).
    pub model: String,
    /// Modelin OLCULMUS kalite sinifi (`proven` | `untested` | `unusable`). UI tavsiyeyi buna
    /// gore kurar: olculmus-saglikli bir model tek gorselde takilirsa dogru oneri "modeli degistir"
    /// DEGIL "baska gorsellerle dene"dir.
    pub model_quality: String,
    /// **En az bir** deneme kullanilabilir cikti verdi mi. Kurulumun gectigi/kaldigi karari budur.
    pub usable: bool,
    /// Denenen gorseller (ilk BASARIDA durur → saglikli makinede tek cagri).
    pub attempts: Vec<VisionTrialAttemptDto>,
    /// Kuyruk tahmininin dayandigi sure: BASARILI denemenin suresi (yoksa son denemenin).
    /// Basarisiz/reddedilen bir cagrinin suresiyle 30 bin gorsel carpmak yaniltici olurdu.
    pub elapsed_ms: u128,
}

/// **Tek gorselle GERCEK deneme** (admin) — kurulum kontrolunun kalbi.
///
/// Gerekce: `recommend_vision_model` bir TABLOYA bakar (baska makinede yapilmis olcum). Tablo
/// makineler arasi tasinabilir bir kanit degildir — surucu, VRAM, Ollama derlemesi degisir. Bu komut
/// tahmin etmez: bir gorseli **URETIM yolunun aynisiyla** analiz eder (`higher_res_preview` →
/// `build_binary_context` → `build_vision_prompt` → `analyze_image` → lean-retry → `is_usable`) ve
/// sonucu duz sayilarla dondurur.
///
/// **HICBIR SEY YAZMAZ**: `set_ai_metadata` cagrilmaz, `ai_analyzed` damgasi basilmaz → denenen
/// gorsel bekleyen kalir (deneme, kuyrugu sessizce tuketmemeli).
// `async fn`: govde bloklayici ama `.await` yok → uzun Ollama cagrisi UI is parcacigini dondurmaz
// (run_image_analysis ile ayni desen).
#[tauri::command]
pub async fn vision_trial(
    model: String,
    state: State<'_, AppState>,
) -> Result<VisionTrialDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    // Suren bir kosunun ortasinda ikinci bir vision cagrisi acmak GPU'yu paylastirir → hem deneme
    // hem kosu yavaslar, olculen sure de yaniltici olur. Kararli token: UI cumleye cevirir.
    if VISION_ACTIVE.load(Ordering::SeqCst) {
        return Err("trial_busy".into());
    }
    let model_used = resolve_vision_model(&model);

    // Ornek gorseller + baglamlari (kisa db kilidi; uzun cagrilar kilit DISINDA kosar).
    let samples = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let pool = db.assets_without_analysis(0, TRIAL_POOL).map_err(|e| e.to_string())?;
        if pool.is_empty() {
            // Analiz bekleyen gorsel yok → denenecek gercek girdi de yok. Sentetik gorsel
            // URETMEYIZ: olcumun degeri tam da gercek arsiv gorseli olmasindan geliyor.
            return Err("trial_no_sample".into());
        }
        let picks = spread_indices(pool.len(), TRIAL_SAMPLES);
        picks
            .into_iter()
            .map(|i| {
                let p = &pool[i];
                (p.clone(), build_binary_context(&db, p.id))
            })
            .collect::<Vec<_>>()
    };

    let trial_start = Instant::now();
    let mut attempts: Vec<VisionTrialAttemptDto> = Vec::new();
    for (asset, ctx) in samples {
        // Butce doldu → yavas makinede kullaniciyi bekletme (ilk ornek zaten olctu).
        if !attempts.is_empty() && trial_start.elapsed().as_millis() >= TRIAL_BUDGET_MS {
            break;
        }
        let preview = higher_res_preview(&asset.path);
        let img: &[u8] = preview.as_deref().unwrap_or(&asset.thumb_bytes);
        // Cizim turu YALNIZ CAD dosyalarina sorulur (bkz `vision::asks_drawing_type`).
        let ask_type = vision::asks_drawing_type(&asset.path);
        let prompt = vision::build_vision_prompt(ctx.as_deref(), ask_type);

        let start = Instant::now();
        let mut outcome = ollama::analyze_image(&model_used, img, &prompt);
        let mut lean_retry = false;
        if ctx.is_some() && matches!(&outcome, Err(e) if is_ctx_overflow(e)) {
            lean_retry = true;
            outcome =
                ollama::analyze_image(&model_used, img, &vision::build_vision_prompt(None, ask_type));
        }
        let elapsed_ms = start.elapsed().as_millis();

        let attempt = match outcome {
            Ok(raw) => {
                let parsed = vision::parse_vision_response(&raw);
                let eav = parsed.to_eav();
                VisionTrialAttemptDto {
                    file_name: asset.file_name,
                    usable: parsed.is_usable(),
                    elapsed_ms,
                    field_count: eav.len(),
                    error_kind: None,
                    error_detail: None,
                    // Kullaniciya **ACIKLAMA** gosterilir; yoksa ilk dolu alan, o da yoksa HAM
                    // yanit. Gerekce (olculdu 2026-08-09): ilk alan `ai_cizim_turu` idi ve ekranda
                    // yalnizca *"Kat Planı ###"* goruluyordu — modelin gorseli ANLAYIP anlamadigini
                    // gostermeyen, karar verdirmeyen bir parca. Betim, insanin bakip "bu dogru mu"
                    // diyebilecegi TEK alandir; kartin varlik sebebi de bu.
                    sample: eav
                        .iter()
                        .find(|(k, _)| *k == "ai_aciklama")
                        .or_else(|| eav.first())
                        .map(|(_, v)| v.chars().take(200).collect::<String>())
                        .or_else(|| Some(raw.trim().chars().take(200).collect())),
                    lean_retry,
                }
            }
            Err(e) => VisionTrialAttemptDto {
                file_name: asset.file_name,
                usable: false,
                elapsed_ms,
                field_count: 0,
                error_kind: Some(vision::classify_vision_error(&e).to_string()),
                error_detail: Some(e),
                sample: None,
                lean_retry,
            },
        };
        // Servise hic ulasilamiyorsa (Ollama kapali/model yok/surucu) tekrar denemek anlamsiz:
        // ayni hatayi iki kez daha, ustelik zaman asimini bekleyerek alirdik.
        let service_down = matches!(
            attempt.error_kind.as_deref(),
            Some("ollama_down" | "model_missing" | "gpu_driver")
        );
        attempts.push(attempt);
        if service_down {
            break;
        }
    }

    let usable = attempts.iter().any(|a| a.usable);
    // Kuyruk tahmini BASARILI cagrilarin ORTALAMASINDAN turer. Tek olcum yeterli degildi:
    // kullanicinin ard arda iki denemesi 11 sn ve 17 sn verdi → ayni arsiv icin "91 saat" ve
    // "144 saat". Ortalama gurultuyu azaltir; UI ayrica tahminin kac olcume dayandigini yazar.
    let ok: Vec<u128> = attempts.iter().filter(|a| a.usable).map(|a| a.elapsed_ms).collect();
    let elapsed_ms = if ok.is_empty() {
        attempts.last().map(|a| a.elapsed_ms).unwrap_or(0)
    } else {
        ok.iter().sum::<u128>() / ok.len() as u128
    };

    Ok(VisionTrialDto {
        model_quality: ollama::vision_quality(&model_used).code().to_string(),
        model: model_used,
        usable,
        attempts,
        elapsed_ms,
    })
}

/// Kosuda kullanilacak vision modelini coz. Istemci acikca bir model verdiyse **ona dokunulmaz**
/// (kullanici secimi her zaman kazanir). Bos ise ("Otomatik") ayni oneri motoruyla SECILIR —
/// eskiden burada sabit `llava` kullaniliyordu, yani "Otomatik" olculmus-cop bir modele
/// dusuyordu. Ollama'ya ulasilamazsa son care sabit (o durumda kosu zaten hata verecek).
fn resolve_vision_model(requested: &str) -> String {
    let requested = requested.trim();
    if !requested.is_empty() {
        return requested.to_string();
    }
    let vram_mb = crate::gpu::detect_nvidia().map(|g| g.vram_mb);
    ollama::list_vision_models_with_size()
        .ok()
        .and_then(|models| ollama::recommend_vision(vram_mb, &models))
        .unwrap_or_else(|| ollama::DEFAULT_VISION_MODEL.to_string())
}

/// Mevcut analizlerin TEK BIR MODEL icin kirilimi (onizleme satiri).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisModelRowDto {
    /// Analizi yazan model adi; bos → `ai_model` yazilmamis eski kayit (UI "bilinmiyor" gosterir).
    pub model: String,
    /// Bu modelle yazilmis toplam analiz.
    pub total: i64,
    /// Bunlarin kaci bicim esiginin ALTINDA (sifirlama kapsami).
    pub unusable: i64,
    /// Modelin OLCULMUS kalite sinifi: `proven` | `untested` | `unusable` (`ollama::VisionQuality`).
    pub quality: String,
}

/// Kullanilamaz (esik-alti) analizlerin **onizlemesi** — hicbir sey degistirmez.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnusableAnalysisDto {
    /// Sifirlanmaya aday analiz sayisi (bugunku cop-korumasi esigini gecemeyecek olanlar).
    pub count: i64,
    /// Toplam analizli varlik — kullanici orani gorsun ("415'in 378'i").
    pub analyzed_total: i64,
    /// Model kirilimi (coktan aza). Her ofis KENDI tablosunu gorur — baska bir makinede olusmus
    /// tek bir sayiya guvenmek zorunda kalmaz (kullanici itirazi 2026-08-08).
    pub by_model: Vec<AnalysisModelRowDto>,
    /// **KOR NOKTA**: bicim esigini GECEN ama olculmus-kotu (`unusable`) bir modelle yazilmis
    /// analiz sayisi. Sifirlama bunlara DOKUNMAZ (bugunku cop-korumasi da gecirirdi — bicime
    /// bakar, icerige degil), ama yonetici varliklarindan haberdar olmali.
    pub suspect_but_kept: i64,
}

/// Sifirlama raporu.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResetAnalysesReportDto {
    /// Bekleyene geri alinan varlik sayisi.
    pub reset: i64,
    /// Temizlenemeyen (hata alan) varlik sayisi.
    pub failed: i64,
    /// Ilk hatanin ham metni (teshis; UI katlanabilir detayda gosterir).
    pub sample_error: Option<String>,
}

/// **Onizleme** (salt-okuma, rol gate yok): kac analiz bugunku cop-korumasi esigini gecemiyor.
///
/// Bu sayi, cop-korumasi eklenmeden ONCE yazilmis kayitlardan gelir (bkz `unusable_analysis_ids`).
/// Yikici hicbir sey yapmaz — kullanici once GORUR, sonra karar verir.
#[tauri::command]
pub fn count_unusable_analyses(state: State<'_, AppState>) -> Result<UnusableAnalysisDto, String> {
    // read_db: salt-okuma sayim; yazma kilidine baglanirsa tarama boyunca donar (ust nota bak).
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    let ids = db
        .unusable_analysis_ids(vision::VISION_EAV_KEYS, vision::MIN_FILLED_FIELDS)
        .map_err(|e| e.to_string())?;
    let analyzed_total = db.analyzed_count().map_err(|e| e.to_string())?;
    let rows = db
        .analysis_breakdown_by_model(vision::VISION_EAV_KEYS, vision::MIN_FILLED_FIELDS)
        .map_err(|e| e.to_string())?;

    // Kalite sinifi model ADINDAN gelir (olculmus tablo) — DB'de tutulmaz, burada eklenir.
    let by_model: Vec<AnalysisModelRowDto> = rows
        .into_iter()
        .map(|(model, total, unusable)| {
            let quality = ollama::vision_quality(&model).code().to_string();
            AnalysisModelRowDto { model, total, unusable, quality }
        })
        .collect();

    // Kor nokta: esigi GECMIS (total - unusable) ama modeli olculmus-kotu olan kayitlar.
    // Bos model adi (`ai_model` yok) `Untested` sayilir → burada sayilmaz; neyi bilmedigimizi
    // "kotu" diye raporlamak yaniltici olurdu.
    let suspect_but_kept = by_model
        .iter()
        .filter(|r| r.quality == ollama::VisionQuality::Unusable.code())
        .map(|r| r.total - r.unusable)
        .sum();

    Ok(UnusableAnalysisDto {
        count: ids.len() as i64,
        analyzed_total,
        by_model,
        suspect_but_kept,
    })
}

/// Kullanilamaz analizleri SIFIRLA → varliklar yeniden **bekleyen** olur (admin).
///
/// **Neden gerekli?** Cop-korumasi (`is_usable`) eklenmeden once yetersiz bir modelin etiketsiz
/// serbest metni `ai_aciklama` olarak yazilip `ai_analyzed=1` damgasi yiyordu. Damgali varlik
/// bekleyen sayilmaz → calisan bir modelle telafi EDILEMEZ. Bu komut damgayi kaldirir.
///
/// **Kapsam DAR (kullanici direktifi: fazla kapatma).** Yalnizca bugunku esigi gecemeyen kayitlara
/// dokunur; saglikli analizler (2+ icerik alani) oldugu gibi kalir, `ai_gorsel_turu` korunur.
/// Her varlik icin: `clear_ai_analysis` (EAV + `assets_fts.ai`) + **yeniden chunk** — chunk'lar
/// temizlenmezse cop metin RAG tarafinda aranabilir kalirdi.
///
/// Aktif bir analiz kosusu varken REDDEDILIR (ayni varliklar uzerinde yarisma olmasin).
#[tauri::command(async)]
pub fn reset_unusable_analyses(
    state: State<'_, AppState>,
) -> Result<ResetAnalysesReportDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    if VISION_ACTIVE.load(Ordering::SeqCst) {
        return Err("gorsel analiz calisiyor — once durdurun".into());
    }

    let dir = resolve_model_dir()?; // MiniLM (re-chunk) hazir mi — erken hata.
    let ids = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.unusable_analysis_ids(vision::VISION_EAV_KEYS, vision::MIN_FILLED_FIELDS)
            .map_err(|e| e.to_string())?
    };

    let (mut reset, mut failed) = (0i64, 0i64);
    let mut sample_error: Option<String> = None;
    for id in ids {
        // Kilit sirasi run_image_analysis ile AYNI (embedder → db) → kilit-tersleme/deadlock yok.
        let res: Result<(), String> = (|| {
            let mut emb_guard = state.embedder.lock().map_err(|e| e.to_string())?;
            let embedder = ensure_embedder(&mut emb_guard, &dir)?;
            let db = state.db.lock().map_err(|e| e.to_string())?;
            db.clear_ai_analysis(id).map_err(|e| e.to_string())?;
            // Yeniden chunk: metadata chunk'i hala eski `AI_ACIKLAMA: ...` metnini tasiyor.
            if let Some(pc) = db.pending_chunk_for(id).map_err(|e| e.to_string())? {
                index_one(&db, embedder, &pc)?;
            }
            Ok(())
        })();
        match res {
            Ok(()) => reset += 1,
            Err(e) => {
                failed += 1;
                if sample_error.is_none() {
                    sample_error = Some(e);
                }
            }
        }
    }
    Ok(ResetAnalysesReportDto { reset, failed, sample_error })
}

/// Gorsel-analiz durumu (rol gate yok — okuma).
#[tauri::command]
pub fn image_analysis_status(
    state: State<'_, AppState>,
) -> Result<ImageAnalysisStatusDto, String> {
    // ⚠️ read_db (2026-08-11 donma kaniti): bu komut Dashboard kartinca SANIYEDE BIR yoklanir
    // ve senkron oldugu icin UI is parcaciginda kosar. `state.db` (yazma) kullanirken, yazma
    // kilidini TUM kosu boyunca tutan klasor taramasi basladigi anda UI kilitte parklaniyor ve
    // pencere taramanin sonuna dek donuyordu (Windows AppHang 12:22/12:39/18:31). Salt-okuma →
    // okuma baglantisi; WAL'da okuyucu yaziciyi beklemez.
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    let analyzed = db.analyzed_count().map_err(|e| e.to_string())?;
    let pending = db.pending_analysis_count().map_err(|e| e.to_string())?;
    let pending_small = db
        .pending_analysis_small_count(&archivist_db::AnalysisScope::All, SMALL_FILE_BYTES)
        .map_err(|e| e.to_string())?;
    Ok(ImageAnalysisStatusDto {
        analyzed,
        pending,
        pending_small,
        small_file_bytes: SMALL_FILE_BYTES,
        total: analyzed + pending,
        embed_ready: resolve_model_dir().is_ok(),
        active: VISION_ACTIVE.load(Ordering::SeqCst),
        progress: live_progress_slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone(),
    })
}

/// Asset'in (ai_ OLMAYAN) text metadata'sindan AI prompt baglami (H2 binaryMeta paritesi):
/// "KEY: deger" satirlari (ilk 15) → vision modeli layer/blok/baslik gibi teknik veriyle daha
/// isabetli analiz yapar. Metadata yoksa None.
fn build_binary_context(db: &archivist_db::Db, asset_id: i64) -> Option<String> {
    let detail = db.get_asset(asset_id).ok()??;
    let lines: Vec<String> = detail
        .metadata
        .iter()
        .filter(|m| !m.key.starts_with("ai_"))
        .filter_map(|m| m.value_text.as_ref().map(|v| format!("{}: {}", m.key.to_uppercase(), v)))
        .take(15)
        .collect();
    if lines.is_empty() {
        None
    } else {
        // num_ctx 8192 olsa da pathalojik DWG (cok layer/blok metadata) prompt'u asabilir →
        // toplami sinirla (UTF-8 char-sinirinda kes; tipik DWG ~4700 kar → etkilenmez).
        const MAX_CTX_CHARS: usize = 6000;
        Some(lines.join("\n").chars().take(MAX_CTX_CHARS).collect())
    }
}

/// Modele gonderilecek gorsel baytlari: kaynak RASTER dosyadan daha yuksek-cozunurluk (~768px)
/// onizleme uret (H2 768px paritesi; depolanan 256px thumb vision modeline AZ detay verir →
/// yuzeysel betim / OCR-okunmaz, kullanici bulgusu 2026-07-11). `None` → cagiran depolanan
/// `thumb_bytes`'a geri-duser. Uzanti-geciti: yalniz `image` crate'in guvenle cozdugu raster'lar
/// (DWG/PDF/Office gibi buyuk dosyalari bosuna bellege okumaktan kacinir; onlarin thumb'i zaten
/// gomulu-onizlemeden gelir → daha buyuk raster kaynagi yok).
fn higher_res_preview(path: &str) -> Option<Vec<u8>> {
    const RASTER_EXT: &[&str] = &["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "ico"];
    let ext = std::path::Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    if !RASTER_EXT.contains(&ext.as_str()) {
        return None;
    }
    // Pathalojik-buyuk kaynagi bellege alma (64MB tavani; tipik foto cok altinda) → thumb yeter.
    const MAX_SRC_BYTES: u64 = 64 * 1024 * 1024;
    if std::fs::metadata(path).ok()?.len() > MAX_SRC_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let preview = archivist_thumbnail::image_preview_from_bytes(
        &bytes,
        archivist_thumbnail::VISION_PREVIEW_MAX,
    )?;
    Some(preview.bytes)
}

/// Ollama baglam-penceresi ASIMI hatasi mi? (moondream gibi kucuk-pencereli modeller num_ctx'i YOK
/// SAYAR → 2048'i asan zengin prompt HTTP 400 doner.) Lean-retry tetikleyicisi; `analyze_image`
/// Ollama'nin ACIKLAYICI govdesini yuzeye cikardigi icin metin "exceed_context_size" / "context
/// size" / "context length" icerir.
fn is_ctx_overflow(err: &str) -> bool {
    // Olcut `vision` modulunde tek yerde durur → lean-retry tetigi ile hata SINIFLANDIRMASI
    // (`classify_vision_error`) ayrisamaz.
    vision::is_context_overflow_text(&err.to_ascii_lowercase())
}

/// Thumbnail'i olan asset'leri AI vision ile analiz et → `ai_*` EAV → re-chunk. **Admin.**
/// Resumable (cursor: basarisiz analiz ayni kosuda tekrar gelmez). Her asset: UZUN Ollama vision
/// cagrisi (kilitsiz) → kisa db+embedder kilidi (yaz + re-chunk). İlerleme Channel (~100ms).
// `async fn`: ana iş parcacigi DISINDA (async runtime) kosar. KRITIK — her gorsel icin UZUN (yavas
// GPU'da DAKIKALARCA suren; sinir mutlak duvar degil SESSIZLIK — bkz `ollama::analyze_image`)
// Ollama vision cagrisi var; senkron olsaydi tum analiz boyunca UI DONARDI (kullanici bulgusu 2026-06-22).
// Govde bloklayici, `.await` yok → MutexGuard'lar await sinirini gecmez (Send-future guvenli).
#[tauri::command]
pub async fn run_image_analysis(
    model: String,
    scope: AnalysisScopeDto,
    on_progress: Channel<ImageAnalysisProgressDto>,
    state: State<'_, AppState>,
) -> Result<ImageAnalysisReportDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    // Eszamanli iki kosu onle (Dashboard blanket + BatchToolbar secim cakismasin): ACTIVE'i atomik
    // swap ile devral; zaten aktifse hata don. Basarili devirdan SONRA Drop guard kur → sonraki her
    // donus yolunda (`?` erken-donus / panik / future iptali) ACTIVE mutlaka sifirlanir.
    if VISION_ACTIVE.swap(true, Ordering::SeqCst) {
        return Err("gorsel analiz zaten calisiyor".into());
    }
    let _active = ActiveGuard;
    VISION_STOP.store(false, Ordering::SeqCst);
    let scope: AnalysisScope = scope.into();

    let dir = resolve_model_dir()?; // MiniLM (re-chunk) hazir mi — erken hata.
    let model_used = resolve_vision_model(&model);

    let total = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.pending_analysis_count_scoped(&scope).map_err(|e| e.to_string())?
    };
    let start = Instant::now();
    let (mut analyzed, mut failed, mut processed, mut after_id) = (0i64, 0i64, 0i64, 0i64);
    let mut last_emit: Option<Instant> = None;
    let mut sample_error: Option<String> = None;
    let mut error_kind: Option<String> = None;
    let mut stopped = false;
    // Devre kesici sayaci: her basarisizlikta artar, her BASARIDA sifirlanir → yalniz ARD ARDA
    // gelen hatalar kosuyu durdurur (dagilmis tekil hatalar taramayi kesmez).
    let mut consecutive_failures: u32 = 0;
    let mut aborted_after: Option<u32> = None;
    let initial_progress = ImageAnalysisProgressDto {
        processed: 0,
        total,
        current_path: String::new(),
    };
    store_live_progress(initial_progress.clone());
    let _ = on_progress.send(initial_progress);

    loop {
        // Batch-basi durdur kontrolu (uzun bir batch bittikten sonra yeni batch cekmeden cik).
        if VISION_STOP.load(Ordering::SeqCst) {
            stopped = true;
            break;
        }
        let batch = {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            db.assets_without_analysis_scoped(&scope, after_id, BATCH).map_err(|e| e.to_string())?
        };
        if batch.is_empty() {
            break;
        }
        for p in &batch {
            // Asset-basi durdur kontrolu (UZUN vision cagrisina GIRMEDEN once) → hizli iptal.
            if VISION_STOP.load(Ordering::SeqCst) {
                stopped = true;
                break;
            }
            after_id = p.id; // cursor ilerlet → basarisiz analiz tekrar getirilmez.

            let active_progress = ImageAnalysisProgressDto {
                processed,
                total,
                current_path: p.file_name.clone(),
            };
            store_live_progress(active_progress.clone());
            let _ = on_progress.send(active_progress);

            // Baglam (kisa db kilidi).
            let ctx = {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                build_binary_context(&db, p.id)
            };
            // Modele gonderilecek gorsel: kaynak RASTER dosyadan ~768px onizleme (H2 paritesi);
            // yoksa/raster degilse depolanan 256px thumb'a geri-dus (daha az detay ama en azindan
            // analiz olur). Tek kez hesapla → iki analiz cagrisi (ilk + lean-retry) paylasir.
            let preview = higher_res_preview(&p.path);
            let img: &[u8] = preview.as_deref().unwrap_or(&p.thumb_bytes);

            // UZUN Ollama vision cagrisi — KILIT YOK. Ilk deneme: zengin prompt (binary_context'li).
            // Cizim turu YALNIZ CAD dosyalarina sorulur (bkz `vision::asks_drawing_type`).
            let ask_type = vision::asks_drawing_type(&p.path);
            let prompt = vision::build_vision_prompt(ctx.as_deref(), ask_type);
            let mut outcome = ollama::analyze_image(&model_used, img, &prompt);
            // Baglam-penceresi TASMASI + binary_context vardi → context'SIZ (lean) prompt'la TEKRAR
            // DENE. Kucuk-pencereli modelde (moondream 2048; num_ctx yok sayilir) base prompt + gorsel
            // tek basina siga; tasmayi yapan binary_context → onu atinca dosya YINE analiz edilir
            // (zengin baglam kaybi > hic analiz olmamasi). Buyuk-pencereli modelde bu dal calismaz.
            if ctx.is_some() && matches!(&outcome, Err(e) if is_ctx_overflow(e)) {
                eprintln!("[vision] baglam tasmasi → context'siz tekrar: {}", p.file_name);
                let lean = vision::build_vision_prompt(None, ask_type);
                outcome = ollama::analyze_image(&model_used, img, &lean);
            }

            // Tek cikis: basarisizlik `(kullanici-metni, kararli-sinif)` olarak toplanir → sayac /
            // ornek-hata / devre kesici TEK yerde islenir (uc ayri dalda tekrarlanmaz).
            let mut failure: Option<(String, &'static str)> = None;
            match outcome {
                Ok(raw) => {
                    let parsed = vision::parse_vision_response(&raw);
                    if parsed.is_usable() {
                        let mut eav = parsed.to_eav();
                        // Kaynak izi: hangi model + ne zaman analiz edildi. asset_metadata'ya EAV olarak
                        // yazilir (get_asset metadata listesinde frontend'e doner) ama set_ai_metadata
                        // bunlari `assets_fts.ai`'ye SOKMAZ (AI_FTS_EXCLUDED) → model adi/tarih aranabilir
                        // govdeyi KIRLETMEZ. Timestamp asset-basi (analiz aninda; epoch-ms string).
                        eav.push(("ai_model", model_used.clone()));
                        eav.push(("ai_analyzed_at", crate::backup_commands::now_ms().to_string()));
                        // Yaz + re-chunk (embedder→db kilit sirasi; run_rag_indexing deseni).
                        let res: Result<(), String> = (|| {
                            let mut emb_guard = state.embedder.lock().map_err(|e| e.to_string())?;
                            let embedder = ensure_embedder(&mut emb_guard, &dir)?;
                            let db = state.db.lock().map_err(|e| e.to_string())?;
                            db.set_ai_metadata(p.id, &eav).map_err(|e| e.to_string())?;
                            if let Some(pc) = db.pending_chunk_for(p.id).map_err(|e| e.to_string())?
                            {
                                index_one(&db, embedder, &pc)?;
                            }
                            Ok(())
                        })();
                        match res {
                            Ok(()) => analyzed += 1,
                            // H2 vision hatayi YUTMAZ; biz de yuzeye cikar: hangi dosya neden
                            // basarisiz -> dev konsolu + rapor (sessiz "failed" kor-nokta yerine).
                            Err(e) => {
                                failure = Some((format!("{}: {e}", p.file_name), "write_failed"));
                            }
                        }
                    } else {
                        // **COP-KORUMASI**: model istenen bicimi uretemedi (olculdu: moondream
                        // `" [0"`, llava serbest-metin). YAZMA YOK → `ai_analyzed` damgasi da YOK →
                        // varlik BEKLEYEN kalir ve calisan bir modelle sonradan analiz edilebilir.
                        // (Onceden: cop `ai_aciklama` olarak yazilir, damga basilir, aranabilir
                        // govdeye girerdi → kalici kirlilik + telafisiz.)
                        failure = Some((
                            format!("{}: model anlamli bir analiz uretmedi", p.file_name),
                            "unusable_output",
                        ));
                    }
                }
                Err(e) => {
                    let kind = vision::classify_vision_error(&e);
                    failure = Some((format!("{}: {e}", p.file_name), kind));
                }
            }
            if let Some((msg, kind)) = failure {
                failed += 1;
                // **DEVRE KESICI SAYIMI — `unusable_output` AYRI TUTULUR (bulgu 2026-08-09).**
                //
                // Devre kesicinin gerekcesi "hata dosyaya degil KOSUYA aittir" idi. `unusable_output`
                // bu tanima UYMAZ: model'e ULASILDI ve yanit ALINDI — servis saglikli. Uretilen
                // metnin istenen bicimde olmamasi cogu zaman DOSYAYA ozgudur. Gercek ornek: kurulum
                // denemesinde `qwen2.5vl:3b` (olculmus-saglikli model) bir logo gorseline
                // *"I'm sorry, but I can't assist with that request"* dedi — model reddetti. Bir
                // logo klasorunde art arda uc boyle dosya, 30.223'luk kuyrugu ucuncu dosyada
                // durdururdu ve rapor "kosu arizasi" derdi. Yoktu.
                //
                // Yine de koruma tamamen kaldirilmaz (moondream'in HER gorsele `" [0"` demesi
                // gercek bir kosu arizasiydi): esik yalnizca **hic basari yokken** islerdi.
                // Kosu bir kez bile saglikli analiz uretmisse model calisiyor demektir → sonraki
                // bicim-tutmazliklar icerige aittir, tarama SURER.
                if counts_as_run_fault(kind, analyzed) {
                    consecutive_failures += 1;
                } else {
                    consecutive_failures = 0;
                }
                eprintln!("[vision] BASARISIZ ({kind}) {msg}");
                if sample_error.is_none() {
                    sample_error = Some(msg);
                    error_kind = Some(kind.to_string());
                }
            } else {
                consecutive_failures = 0;
            }
            processed += 1;
            let completed_progress = ImageAnalysisProgressDto {
                processed,
                total,
                current_path: p.file_name.clone(),
            };
            store_live_progress(completed_progress.clone());

            let now = Instant::now();
            let is_last = processed >= total;
            let due = last_emit.is_none_or(|t| now.duration_since(t).as_millis() >= 100);
            if processed == 1 || is_last || due {
                last_emit = Some(now);
                let _ = on_progress.send(completed_progress);
            }

            // **DEVRE KESICI**: ard arda esik kadar hata → sorun bu dosyaya degil KOSUYA ait
            // (surucu/model/servis). Sonraki her dosya da ayni hatayi, ustelik zaman asimini
            // bekleyerek alacak → burada dur, nedeni raporla. Kalan is bekleyen kalir.
            if consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
                aborted_after = Some(consecutive_failures);
                break;
            }
        }
        if stopped || aborted_after.is_some() {
            break; // for-icinde durdur/devre-kesici gorulmustu → dis dongu de cikmali.
        }
    }

    Ok(ImageAnalysisReportDto {
        analyzed,
        failed,
        elapsed_ms: start.elapsed().as_millis(),
        sample_error,
        stopped,
        error_kind,
        aborted_after_consecutive_failures: aborted_after,
    })
}

/// Aktif gorsel-analiz kosusunu durdur ("Durdur"). **Admin.** Kosu batch-basi + asset-basi
/// `VISION_STOP` gorup erken cikar (kalan is bekleyen kalir → resumable). stop_auto_index deseni:
/// yalniz bayrak set eder; kosunun kendisi araya girip sonlanir (senkron beklemez).
#[tauri::command]
pub fn stop_image_analysis(state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    VISION_STOP.store(true, Ordering::SeqCst);
    Ok(())
}

/// Bir KAPSAMDA AI-analizi bekleyen asset sayisi (frontend onizleme: "N gorsel analiz edilecek").
/// Rol gate yok — okuma. Her kapsamda calisir (secimde frontend `ids.length` de kullanabilir ama
/// tutarlilik + skip/thumbnail suzgeci dogru yansisin diye kapsam-farketmez tek yol bu komut).
#[tauri::command]
pub fn count_pending_analysis(
    scope: AnalysisScopeDto,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    // read_db: salt-okuma sayim (bkz image_analysis_status notu).
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.pending_analysis_count_scoped(&scope.into()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        counts_as_run_fault, is_ctx_overflow, ImageAnalysisProgressDto, ImageAnalysisStatusDto,
    };

    /// Ornekler havuza YAYILMALI — bastan ard arda alinsaydi ucu de ayni klasorden gelirdi
    /// (kullanicinin ilk denemesinde ucu de logo olurdu; arsivi temsil etmeyen bir olcum).
    #[test]
    fn trial_samples_are_spread_across_the_pool() {
        assert_eq!(super::spread_indices(30, 3), vec![0, 10, 20]);
        // Havuz istenenden kucukse hepsi alinir (tekrar YOK).
        assert_eq!(super::spread_indices(2, 3), vec![0, 1]);
        assert_eq!(super::spread_indices(1, 3), vec![0]);
        // Bozuk girdiler panik uretmemeli.
        assert!(super::spread_indices(0, 3).is_empty());
        assert!(super::spread_indices(30, 0).is_empty());
        // Secilen indeksler benzersiz ve sinir icinde olmali.
        let idx = super::spread_indices(7, 3);
        assert_eq!(idx.len(), 3);
        assert!(idx.iter().all(|&i| i < 7));
        assert!(idx.windows(2).all(|w| w[0] < w[1]));
    }

    /// **Devre kesici, DOSYAYA ozgu elenmeleri kosu arizasi saymamali** (bulgu 2026-08-09).
    ///
    /// Gercek senaryo: olculmus-saglikli `qwen2.5vl:3b` bir logoyu betimlemeyi reddetti
    /// ("I'm sorry, but I can't assist…") → `unusable_output`. Art arda uc boyle dosya, 30 binlik
    /// kuyrugu ucuncu dosyada durdururdu. Model bir kez calistigini KANITLADIKTAN sonra (analyzed>0)
    /// bicim-tutmazlik icerige aittir; tarama surmelidir.
    #[test]
    fn circuit_breaker_ignores_per_file_rejections_once_the_model_has_proven_itself() {
        // Hic basari yokken: model TAMAMEN ise yaramiyor olabilir (moondream `" [0"`) → sayilir.
        assert!(counts_as_run_fault("unusable_output", 0));
        // Bir kez basarili analiz uretildiyse model calisiyor → elenme dosyaya aittir, SAYILMAZ.
        assert!(!counts_as_run_fault("unusable_output", 1));
        assert!(!counts_as_run_fault("unusable_output", 500));

        // Gercek KOSU arizalari her durumda sayilir — basari sayisi ne olursa olsun.
        for kind in ["gpu_driver", "ollama_down", "timeout", "model_missing", "write_failed"] {
            assert!(counts_as_run_fault(kind, 0), "{kind}");
            assert!(counts_as_run_fault(kind, 999), "{kind} (basaridan sonra da kosu arizasidir)");
        }
    }

    #[test]
    fn status_contract_exposes_active_run_and_progress() {
        let status = ImageAnalysisStatusDto {
            analyzed: 12,
            pending: 8,
            // Kirilim bekleyenin ALT kumesidir — toplama eklenmez, `pending` icinden sayilir.
            pending_small: 5,
            small_file_bytes: 20 * 1024,
            total: 20,
            embed_ready: true,
            active: true,
            progress: Some(ImageAnalysisProgressDto {
                processed: 3,
                total: 8,
                current_path: "C:/x/a.jpg".into(),
            }),
        };
        let value = serde_json::to_value(status).unwrap();
        assert_eq!(value["active"], true);
        assert_eq!(value["progress"]["processed"], 3);
        assert_eq!(value["progress"]["currentPath"], "C:/x/a.jpg");
        assert!(value.get("embedReady").is_some());
        assert!(value.get("embed_ready").is_none());
    }

    #[test]
    fn ctx_overflow_detected_from_real_ollama_body() {
        // analyze_image'in yuzeye cikardigi GERCEK Ollama 400 govdesi (kullanici bulgusu 2026-07-07).
        assert!(is_ctx_overflow(
            "Ollama vision hatasi: status 400: {\"error\":{\"type\":\"exceed_context_size_error\",\
             \"message\":\"request (4062 tokens) exceeds the available context size (2048 tokens)\"}}"
        ));
        assert!(is_ctx_overflow("... the available CONTEXT SIZE ..."), "buyuk-harf duyarsiz");
        assert!(is_ctx_overflow("context length exceeded"));
    }

    #[test]
    fn unrelated_errors_not_overflow() {
        assert!(!is_ctx_overflow("Ollama vision hatasi: status 500: internal error"));
        assert!(!is_ctx_overflow("connection refused"));
        assert!(!is_ctx_overflow(""));
    }

    #[test]
    fn higher_res_preview_gates_non_raster_and_missing() {
        // Raster OLMAYAN uzanti → dosyaya bakmadan None (DWG/PDF/Office bosuna okunmaz → thumb'a duser).
        assert!(super::higher_res_preview("C:/yok/cizim.dwg").is_none());
        assert!(super::higher_res_preview("C:/yok/belge.pdf").is_none());
        assert!(super::higher_res_preview("uzantisiz-dosya").is_none());
        // Raster uzanti AMA dosya YOK → None (metadata basarisiz → cagiran depolanan thumb'a duser).
        assert!(super::higher_res_preview("C:/yok/olmayan-foto.jpg").is_none());
    }

    // Kapsam DTO — frontend JSON sekli (tag="kind", camelCase) → `archivist_db::AnalysisScope`
    // eslemesi. Frontend sozlesmesini kilitler: {kind:"all"} | {kind:"ids"} | {kind:"filter"}.
    #[test]
    fn scope_dto_all_round_trip() {
        let dto: super::AnalysisScopeDto =
            serde_json::from_str(r#"{"kind":"all"}"#).expect("all cozulmeli");
        assert!(matches!(
            archivist_db::AnalysisScope::from(dto),
            archivist_db::AnalysisScope::All
        ));
    }

    #[test]
    fn scope_dto_ids_round_trip_preserves_order() {
        let dto: super::AnalysisScopeDto =
            serde_json::from_str(r#"{"kind":"ids","ids":[3,1,2]}"#).expect("ids cozulmeli");
        match archivist_db::AnalysisScope::from(dto) {
            // Sira KORUNUR (siralanmaz) — cursor mantigi id-artan olsa da giris siralanmadan gecer.
            archivist_db::AnalysisScope::Ids(ids) => assert_eq!(ids, vec![3, 1, 2]),
            other => panic!("Ids bekleniyordu, {other:?} geldi"),
        }
    }

    #[test]
    fn scope_dto_filter_round_trip() {
        // filter govdesi ListOpts (snake_case alanlar) — camelCase yalniz DTO'nun DIS zarfinda.
        let dto: super::AnalysisScopeDto = serde_json::from_str(
            r#"{"kind":"filter","filter":{"ext":["dwg"],"favorites_only":true}}"#,
        )
        .expect("filter cozulmeli");
        match archivist_db::AnalysisScope::from(dto) {
            archivist_db::AnalysisScope::Filter(opts) => {
                assert_eq!(opts.ext, vec!["dwg".to_string()]);
                assert!(opts.favorites_only);
            }
            other => panic!("Filter bekleniyordu, {other:?} geldi"),
        }
    }

    /// **Bolunmus istem GERCEKTEN duzeltiyor mu? — DOGRULAMA** (2026-08-10).
    ///
    /// Menu-sirasi deneyi sorunu teshis etti; bu test duzeltmeyi SINAR. Uretim istemi
    /// (`build_vision_prompt`) aynen kosulur — varyant yok — ve secilen asset'ler yer-gercegi
    /// INSAN tarafindan dogrulanmis dosyalardir (gorsellere bakildi, 2026-08-10):
    ///   #3  Carrera mermer DOKUSU (`.fbm` malzeme klasoru) → beklenen: sinif **Diğer**, tur BOS
    ///   #33 cami dis RENDER'i                              → beklenen: **Görselleştirme**, tur BOS
    ///   #34 ustten bakan render + altta vaziyet cizgileri  → SINIR VAKA (ikisi de savunulabilir)
    ///   #14 gercek CAD dosyasi (`…cami alanı.dwg`)         → beklenen: **Teknik Çizim** + bir tur
    ///
    /// ⚠️ Basari olcutu "hepsi dogru" DEGIL: kritik olan **cizim olmayanlarda tur URETILMEMESI**
    /// (facet kirliligi) ve **gercek cizimde tur KAYBEDILMEMESI** (gerileme). Sinir vaka bilgi icin.
    ///
    /// ```text
    /// cargo test --manifest-path C:\Arsiv-H3\Cargo.toml -p archivist --lib \
    ///   split_prompt_verification -- --ignored --nocapture
    /// ```
    /// `ARSIV_EXP_IDS` (vars. "3,33,34,14") · `ARSIV_EXP_OUT` (repo DISI sonuc dosyasi).
    #[test]
    #[ignore = "gercek Ollama + gercek arsiv gorseli gerektirir; elle kosulur"]
    fn split_prompt_verification() {
        let model = std::env::var("ARSIV_EXP_MODEL").unwrap_or_else(|_| "qwen2.5vl:3b".into());
        let ids: Vec<i64> = std::env::var("ARSIV_EXP_IDS")
            .unwrap_or_else(|_| "3,33,34,14".into())
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect();
        let db_path = std::env::var("ARSIV_EXP_DB").unwrap_or_else(|_| "archivist.db".into());
        let db = archivist_db::Db::open_readonly(std::path::Path::new(&db_path)).expect("DB");
        let pool = db.assets_without_analysis(0, super::TRIAL_POOL).expect("havuz");

        let mut log: Option<std::fs::File> =
            std::env::var("ARSIV_EXP_OUT").ok().and_then(|p| std::fs::File::create(p).ok());
        fn emit(log: &mut Option<std::fs::File>, line: &str) {
            use std::io::Write as _;
            println!("{line}");
            if let Some(f) = log {
                let _ = writeln!(f, "{line}");
                let _ = f.flush();
            }
        }

        emit(&mut log, "\n=== BOLUNMUS ISTEM — DOGRULAMA ===");
        emit(&mut log, &format!("model: {model} · uretim istemi (varyant YOK)\n"));

        for id in ids {
            let Some(p) = pool.iter().find(|p| p.id == id) else {
                emit(&mut log, &format!("#{id} → havuzda YOK (atlandi)"));
                continue;
            };
            let bytes =
                super::higher_res_preview(&p.path).unwrap_or_else(|| p.thumb_bytes.clone());
            let prompt = crate::vision::build_vision_prompt(
                super::build_binary_context(&db, p.id).as_deref(),
                crate::vision::asks_drawing_type(&p.path),
            );
            let t0 = std::time::Instant::now();
            let out = crate::ollama::analyze_image(&model, &bytes, &prompt);
            let ms = t0.elapsed().as_millis();
            match out {
                Ok(raw) => {
                    let a = crate::vision::parse_vision_response(&raw);
                    let tur =
                        if a.drawing_type.is_empty() { "(BOŞ)" } else { a.drawing_type.as_str() };
                    let sorulan = if crate::vision::asks_drawing_type(&p.path) {
                        "CAD→tur soruldu"
                    } else {
                        "raster→sorulmadi"
                    };
                    emit(
                        &mut log,
                        &format!(
                            "#{id:<4} {}\n     {sorulan:<18} tur={tur:<16} \
                             kullanilabilir={} alan={} {ms} ms",
                            p.file_name,
                            a.is_usable(),
                            a.to_eav().len()
                        ),
                    );
                    let head: String =
                        a.description.chars().take(140).collect::<String>().replace('\n', " ");
                    emit(&mut log, &format!("     betim: {head}"));
                    // HAM bas: kapi ateslenmediginde nedenini gormenin TEK yolu (etiketi hic mi
                    // yazmadi, yoksa deger mi eslesmedi). Teshis olmadan duzeltme tahmine doner.
                    let raw_head: String =
                        raw.chars().take(320).collect::<String>().replace('\n', " ⏎ ");
                    emit(&mut log, &format!("     HAM: {raw_head}"));
                }
                Err(e) => emit(&mut log, &format!("#{id:<4} {} → HATA ({ms} ms): {e}", p.file_name)),
            }
        }
        emit(&mut log, "\n(cizim OLMAYANDA tur BOŞ olmali; gercek cizimde tur DOLU kalmali)\n");
    }

    /// **UYDURMA BETIM: tarafsiz acilis ise yariyor mu? — A/B OLCUM** (2026-08-10).
    ///
    /// A = `ARSIV_VISION_RASTER_LEAD` ile ESKI (iddiali) acilis · B = yeni tarafsiz acilis.
    /// Ayni gorsel, ayni istem, yalniz ILK CUMLE degisir. Olcum setinde **gerileme kontrolu**
    /// vardir: gercek bir cami render'inda betim BOZULMAMALI (tarafsizlik, gercek mimariyi
    /// anlatmayi engellememeli). Karar betimlere INSAN bakarak verilir — bu test sayı degil
    /// METIN uretir.
    ///
    /// ```text
    /// cargo test --manifest-path C:\Arsiv-H3\Cargo.toml -p archivist --lib \
    ///   fabrication_prompt_experiment -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "gercek Ollama + gercek arsiv gorseli gerektirir; elle kosulur"]
    fn fabrication_prompt_experiment() {
        const OLD_LEAD: &str =
            "Bu bir mimari görsel (fotoğraf, render, taranmış belge ya da başka bir görsel) olabilir.";

        let model = std::env::var("ARSIV_EXP_MODEL").unwrap_or_else(|_| "qwen2.5vl:3b".into());
        let ids: Vec<i64> = std::env::var("ARSIV_EXP_IDS")
            .unwrap_or_else(|_| "3,33".into())
            .split(',')
            .filter_map(|s| s.trim().parse().ok())
            .collect();
        let db_path = std::env::var("ARSIV_EXP_DB").unwrap_or_else(|_| "archivist.db".into());
        let db = archivist_db::Db::open_readonly(std::path::Path::new(&db_path)).expect("DB");
        let pool = db.assets_without_analysis(0, 200).expect("havuz");

        let mut log: Option<std::fs::File> =
            std::env::var("ARSIV_EXP_OUT").ok().and_then(|p| std::fs::File::create(p).ok());
        fn emit(log: &mut Option<std::fs::File>, line: &str) {
            use std::io::Write as _;
            println!("{line}");
            if let Some(f) = log {
                let _ = writeln!(f, "{line}");
                let _ = f.flush();
            }
        }

        emit(&mut log, "\n=== UYDURMA BETIM: ACILIS CUMLESI A/B ===");
        emit(&mut log, &format!("model: {model}\n"));

        for id in ids {
            let Some(p) = pool.iter().find(|p| p.id == id) else {
                emit(&mut log, &format!("#{id} → havuzda YOK"));
                continue;
            };
            let bytes = super::higher_res_preview(&p.path).unwrap_or_else(|| p.thumb_bytes.clone());
            let ctx = super::build_binary_context(&db, p.id);
            emit(&mut log, &format!("--- #{id} {} ---", p.file_name));
            for (name, lead) in [("A ESKI    ", Some(OLD_LEAD)), ("B TARAFSIZ", None)] {
                // SAFETY-yok: tek is parcacikli test; env uretim fonksiyonunu besler (tek kaynak).
                match lead {
                    Some(l) => std::env::set_var("ARSIV_VISION_RASTER_LEAD", l),
                    None => std::env::remove_var("ARSIV_VISION_RASTER_LEAD"),
                }
                let prompt = crate::vision::build_vision_prompt(
                    ctx.as_deref(),
                    crate::vision::asks_drawing_type(&p.path),
                );
                let t0 = std::time::Instant::now();
                match crate::ollama::analyze_image(&model, &bytes, &prompt) {
                    Ok(raw) => {
                        let a = crate::vision::parse_vision_response(&raw);
                        let d: String =
                            a.description.chars().take(300).collect::<String>().replace('\n', " ");
                        emit(
                            &mut log,
                            &format!(
                                "  {name} ({} ms, alan={})\n    {d}",
                                t0.elapsed().as_millis(),
                                a.to_eav().len()
                            ),
                        );
                    }
                    Err(e) => emit(&mut log, &format!("  {name} → HATA: {e}")),
                }
            }
        }
        std::env::remove_var("ARSIV_VISION_RASTER_LEAD");
        emit(&mut log, "\n(BITTI — betimlere INSAN bakar: bina uyduruyor mu, gercek mimariyi hala anlatiyor mu)\n");
    }

    /// **LLM'siz siniflandirici bu arsivde neyi yakaliyor? — OLCUM** (uydurma-betim isi).
    ///
    /// Sorun: cizim/bina OLMAYAN dosyalarda (mermer dokusu, ikon, ekran goruntusu) vision modeli
    /// olmayan bir bina betimliyor ("tarihi yapi… kubbe… avlu") ve bu metin `assets_fts.ai`
    /// aranabilir govdesine yaziliyor → arama kirlenir. Cozum istem DEGIL (olculdu: modele
    /// "emin degilsen bos birak" demek calismiyor), **boyle dosyalari hic analiz etmemek**.
    ///
    /// Bu test, o kararin verilebilmesi icin gereken tek veriyi uretir: H3'un zaten var olan
    /// LLM'siz `classify_image_kind` sezgiseli (H2 `refineCategory` portu) bu arsivde ne diyor?
    /// **DB KOPYASI uzerinde** uretim backfill'i kosulur (orijinal DEGISMEZ), sonra dagilim
    /// ve dosya-basi karar yazdirilir. Model cagrisi YOK → saniyeler surer.
    ///
    /// ```text
    /// cargo test --manifest-path C:\Arsiv-H3\Cargo.toml -p archivist --lib \
    ///   image_kind_coverage -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "gercek DB gerektirir; elle kosulur"]
    fn image_kind_coverage() {
        let src = std::path::PathBuf::from(
            std::env::var("ARSIV_EXP_DB").unwrap_or_else(|_| "archivist.db".into()),
        );
        // Kopya: orijinale YAZMAYIZ. WAL/SHM de kopyalanir yoksa kopya bayat gorunur.
        let dir = std::env::temp_dir().join("arsiv_image_kind");
        std::fs::create_dir_all(&dir).expect("gecici dizin");
        let dst = dir.join("kind_copy.db");
        let _ = std::fs::remove_file(&dst);
        std::fs::copy(&src, &dst).expect("DB kopyalanamadi");
        for suffix in ["-wal", "-shm"] {
            let s = std::path::PathBuf::from(format!("{}{suffix}", src.display()));
            if s.exists() {
                let _ = std::fs::copy(&s, std::path::PathBuf::from(format!("{}{suffix}", dst.display())));
            }
        }

        let db = archivist_db::Db::open_and_migrate(&dst).expect("kopya acilamadi");
        let written = db.backfill_image_kind().expect("backfill");
        println!("\n=== LLM'SIZ GORSEL-TURU KAPSAMI (DB KOPYASI) ===");
        println!("backfill yazdi: {written} kayit\n");

        // Bekleyen havuzunun tamami: hangi dosyaya ne dendi, hangisi BOS kaldi.
        let pool = db.assets_without_analysis(0, 200).expect("havuz");
        let mut tally: std::collections::BTreeMap<String, usize> = Default::default();
        for p in &pool {
            let kind = db
                .get_asset(p.id)
                .ok()
                .flatten()
                .and_then(|d| {
                    d.metadata
                        .iter()
                        .find(|m| m.key == "ai_gorsel_turu")
                        .and_then(|m| m.value_text.clone())
                })
                .unwrap_or_else(|| "(BOŞ)".into());
            *tally.entry(kind.clone()).or_insert(0) += 1;
            let short: String = p.path.chars().rev().take(58).collect::<Vec<_>>().into_iter().rev().collect();
            println!("  {kind:<10} …{short}");
        }
        println!("\n=== DAGILIM (bekleyen {} dosya) ===", pool.len());
        for (k, n) in &tally {
            println!("  {k:<10} {n}");
        }
        println!(
            "\nYORUM: '(BOŞ)' kalanlar sezgiselin KACIRDIKLARI — uydurma betim riski tam onlarda.\n"
        );
    }

    /// Deneyde kullanilan ornekleri **KIMLIKLENDIR**: tam yol + ingest'in LLM'siz hesapladigi
    /// `ai_gorsel_turu` + modele hangi baytlarin gittigi (768px onizleme mi, depolanan 256px thumb mu).
    ///
    /// **Neden ayri bir test?** Menu-sirasi deneyi "cevap DEGISTI" der ama "cevap DOGRULASTI"
    /// diyemez — bunun icin gorselin gercekte ne oldugunu bilmek gerekir. Bu dokum yollari verir
    /// (insan bakip karar verir) ve ayni dosyalar icin bagimsiz `ai_gorsel_turu` degerini yan yana
    /// koyar → STATUS'taki ③ "capraz-tutarlilik" fikri veriyle sinanabilir hale gelir.
    /// Model CAGRISI YOK → saniyeler surer, GPU gerekmez.
    ///
    /// ```text
    /// cargo test --manifest-path C:\Arsiv-H3\Cargo.toml -p archivist --lib \
    ///   pending_sample_identity -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "gercek DB gerektirir; elle kosulur"]
    fn pending_sample_identity() {
        let db_path = std::env::var("ARSIV_EXP_DB").unwrap_or_else(|_| "archivist.db".into());
        let db = archivist_db::Db::open_readonly(std::path::Path::new(&db_path)).expect("DB");
        let want: usize =
            std::env::var("ARSIV_EXP_N").ok().and_then(|v| v.parse().ok()).unwrap_or(3);
        let pool = db.assets_without_analysis(0, super::TRIAL_POOL).expect("havuz");
        println!("\n=== BEKLEYEN HAVUZ (ilk {} kayit) ===", pool.len());
        // Deneyle AYNI secim kurali → ayni uc dosya (yoksa dokum baska seyi anlatir).
        let picked = super::spread_indices(pool.len(), want);
        for (i, p) in pool.iter().enumerate() {
            let star = if picked.contains(&i) { "*" } else { " " };
            let kind = db
                .get_asset(p.id)
                .ok()
                .flatten()
                .and_then(|d| {
                    d.metadata
                        .iter()
                        .find(|m| m.key == "ai_gorsel_turu")
                        .and_then(|m| m.value_text.clone())
                })
                .unwrap_or_else(|| "-".into());
            let hi = super::higher_res_preview(&p.path);
            let src = match &hi {
                Some(b) => format!("onizleme {} KB", b.len() / 1024),
                None => format!("THUMB {} KB", p.thumb_bytes.len() / 1024),
            };
            let exists = std::path::Path::new(&p.path).exists();
            println!(
                "{star} #{:<6} gorsel_turu={kind:<10} {src:<18} disk={} {}",
                p.id,
                if exists { "var" } else { "YOK" },
                p.path
            );
        }
        println!("\n(* = menu-sirasi deneyinde kullanilan ornek)\n");
    }

    /// **`ÇİZİM_TÜRÜ` neden hep listenin ILK maddesine demirliyor? — OLCUM** (STATUS 2026-08-09).
    ///
    /// Bes ayri gorselde bes kez `ÇİZİM_TÜRÜ` = "Kat Planı" cikti; betim icerigi ise saglikliydi
    /// (bir dis cephe render'inde "NBG" tabelasi DOGRU okundu ama tur "Kat Planı" dendi). Iki
    /// rakip aciklama var ve ikisi FARKLI duzeltme gerektirir:
    ///   (H1) **Konum yanliligi** — model menunun ILK maddesini seciyor, icerik onemsiz.
    ///   (H2) **Anlamsal on-yargi** — model gercekten "Kat Planı" diyor (sira degisse de degismez).
    ///
    /// Deney bunlari ayirir: AYNI gorsel, AYNI uretim istemi, yalniz menu degisir.
    ///   A = uretim menusu (Kat Planı ilk)   · B = TERS menu (Diğer ilk, Kat Planı son)
    ///   C = uretim sirasi + ACIK secim kurali · D = ters sira + acik kural
    /// H1 dogruysa B'de cevaplar "Diğer"e (yeni ilk madde) kayar. H2 dogruysa B'de yine
    /// "Kat Planı" cikar. C/D ise yonlendirmenin hangisini duzelttigini gosterir.
    ///
    /// Salt-okuma DB tutamaci kullanir → uygulama ACIKKEN kosulabilir, kuyruga hicbir sey yazmaz.
    ///
    /// ```text
    /// cargo test --manifest-path C:\Arsiv-H3\Cargo.toml -p archivist --lib \
    ///   cizim_turu_menu_order_experiment -- --ignored --nocapture
    /// ```
    /// Ayarlar: `ARSIV_EXP_MODEL` (vars. qwen2.5vl:3b) · `ARSIV_EXP_N` ornek sayisi (vars. 3) ·
    /// `ARSIV_EXP_DB` DB yolu · `ARSIV_EXP_IMAGES` noktali-virgullu dosya listesi (havuz yerine
    /// dogruluğu BILINEN gorseller vermek icin).
    #[test]
    #[ignore = "gercek Ollama + gercek arsiv gorseli gerektirir; elle kosulur"]
    fn cizim_turu_menu_order_experiment() {
        use crate::vision::{build_vision_prompt_with, drawing_type_spec, DRAWING_TYPES};

        let model = std::env::var("ARSIV_EXP_MODEL").unwrap_or_else(|_| "qwen2.5vl:3b".into());
        let want: usize =
            std::env::var("ARSIV_EXP_N").ok().and_then(|v| v.parse().ok()).unwrap_or(3);

        // Ters menu: ayni KUME, farkli SIRA (kelepceleme ve menu-tekrari tespiti etkilenmez).
        let reversed: Vec<&str> = DRAWING_TYPES.iter().rev().copied().collect();
        // Acik secim kurali: "tek tane sec" + perspektif/render yonlendirmesi + emin degilsen Diğer.
        let guided = |types: &[&str]| -> String {
            format!(
                "{} — bu listeden TAM OLARAK BİR tanesini seç ve YALNIZ onu yaz; listeyi tekrarlama. \
                 Kural: fotogerçekçi bir dış/iç görünüş, perspektif ya da üç boyutlu görselleştirme \
                 ise Render; çekilmiş bir fotoğraf ise Fotoğraf yaz. Kat Planı YALNIZCA yukarıdan \
                 bakan, ölçekli, çizgisel bir kat düzeni görüyorsan geçerlidir. Emin değilsen Diğer yaz",
                drawing_type_spec(types)
            )
        };
        let variants: [(&str, String); 4] = [
            ("A uretim   ", drawing_type_spec(DRAWING_TYPES)),
            ("B ters     ", drawing_type_spec(&reversed)),
            ("C yonlendir", guided(DRAWING_TYPES)),
            ("D ters+yon ", guided(&reversed)),
        ];

        // Girdiler: ya ACIK dosya listesi (dogrulugu bilinen gorseller) ya bekleyen havuzu.
        struct Sample {
            label: String,
            bytes: Vec<u8>,
            ctx: Option<String>,
        }
        let samples: Vec<Sample> = match std::env::var("ARSIV_EXP_IMAGES") {
            Ok(list) if !list.trim().is_empty() => list
                .split(';')
                .map(str::trim)
                .filter(|p| !p.is_empty())
                .map(|p| Sample {
                    label: p.rsplit(['\\', '/']).next().unwrap_or(p).to_string(),
                    bytes: super::higher_res_preview(p)
                        .or_else(|| std::fs::read(p).ok())
                        .unwrap_or_else(|| panic!("gorsel okunamadi: {p}")),
                    ctx: None,
                })
                .collect(),
            _ => {
                let db_path = std::env::var("ARSIV_EXP_DB").unwrap_or_else(|_| "archivist.db".into());
                let db = archivist_db::Db::open_readonly(std::path::Path::new(&db_path))
                    .expect("DB acilmali (ARSIV_EXP_DB ile yol verilebilir)");
                let pool = db.assets_without_analysis(0, super::TRIAL_POOL).expect("havuz");
                assert!(!pool.is_empty(), "bekleyen gorsel yok → olculecek gercek girdi de yok");
                super::spread_indices(pool.len(), want)
                    .into_iter()
                    .map(|i| {
                        let p = &pool[i];
                        let bytes = super::higher_res_preview(&p.path)
                            .unwrap_or_else(|| p.thumb_bytes.clone());
                        Sample {
                            label: p.file_name.clone(),
                            bytes,
                            ctx: super::build_binary_context(&db, p.id),
                        }
                    })
                    .collect()
            }
        };

        // Sonuclar HER CAGRIDAN SONRA diske yazilir + flush edilir. Gerekce (bedeli odendi
        // 2026-08-10): yonlendirilmis stdout blok-tamponludur → surec yarida olurse ~45 dakikalik
        // GPU emegi izsiz kaybolur. Dosya yolu `ARSIV_EXP_OUT` (repo DISI bir yer verilmeli).
        let mut log: Option<std::fs::File> =
            std::env::var("ARSIV_EXP_OUT").ok().and_then(|p| std::fs::File::create(p).ok());
        fn emit(log: &mut Option<std::fs::File>, line: &str) {
            use std::io::Write as _;
            println!("{line}");
            if let Some(f) = log {
                let _ = writeln!(f, "{line}");
                let _ = f.flush();
            }
        }

        emit(&mut log, "\n=== CIZIM_TURU MENU-SIRASI DENEYI ===");
        emit(&mut log, &format!("model: {model} · ornek: {} · varyant: 4\n", samples.len()));

        // Ozet: varyant → (secilen tur → kac kez). Demirleme varsa tek kovada yigilir.
        let mut tally: Vec<(String, std::collections::BTreeMap<String, usize>)> =
            variants.iter().map(|(n, _)| ((*n).to_string(), Default::default())).collect();

        for s in &samples {
            emit(&mut log, &format!("--- {} ({} KB) ---", s.label, s.bytes.len() / 1024));
            for (vi, (name, spec)) in variants.iter().enumerate() {
                let prompt = build_vision_prompt_with(s.ctx.as_deref(), Some(spec.as_str()));
                let t0 = std::time::Instant::now();
                let out = crate::ollama::analyze_image(&model, &s.bytes, &prompt);
                let ms = t0.elapsed().as_millis();
                match out {
                    Ok(raw) => {
                        let parsed = crate::vision::parse_vision_response(&raw);
                        // HAM satir da yazilir: kelepceleme ONCESI model ne dedi (menu-tekrari,
                        // bos, liste disi bir tur… hepsi burada gorunur).
                        let raw_line = raw
                            .lines()
                            .find(|l| l.contains("ÇİZİM_TÜRÜ"))
                            .map(|l| l.trim().chars().take(90).collect::<String>())
                            .unwrap_or_else(|| "(etiket yok)".into());
                        let picked = if parsed.drawing_type.is_empty() {
                            "(bos)".to_string()
                        } else {
                            parsed.drawing_type.clone()
                        };
                        *tally[vi].1.entry(picked.clone()).or_insert(0) += 1;
                        let usable = parsed.is_usable();
                        emit(
                            &mut log,
                            &format!(
                                "  {name} → {picked:<16} kullanilabilir={usable} {ms} ms\n              ham: {raw_line}"
                            ),
                        );
                    }
                    Err(e) => {
                        *tally[vi].1.entry(format!("HATA:{e}")).or_insert(0) += 1;
                        emit(&mut log, &format!("  {name} → HATA ({ms} ms): {e}"));
                    }
                }
            }
        }

        emit(&mut log, "\n=== OZET (varyant → tur dagilimi) ===");
        for (name, counts) in &tally {
            let line: Vec<String> = counts.iter().map(|(k, v)| format!("{k}×{v}")).collect();
            emit(&mut log, &format!("  {name} → {}", line.join(", ")));
        }
        emit(
            &mut log,
            "\nYORUM: B'de cevaplar yeni ILK maddeye (Diğer) kaydiysa KONUM yanliligi; \
             hala Kat Planı ise ANLAMSAL on-yargi. C/D yonlendirmenin etkisini gosterir.\n",
        );
    }
}
