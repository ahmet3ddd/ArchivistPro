//! Tarama sonrasi AI oto-indeks KALICI kuyrugu (P1) — arka-plan surucu.
//!
//! **H3'un en buyuk akis boslugu:** bugune dek ingest ile AI-indeks KOPUKTU (tarama sonrasi
//! embedding/chunk elle tetikleniyordu). Bu modul o boslugu kapatir: tarama biter → surucu
//! yerel 3 stage'i (metin embed · gorsel embed · RAG chunk) OTOMATIK surer; **app yeniden
//! baslasa kaldigi yerden devam eder** (H2'nin de kapatamadigi restart-boslugu).
//!
//! **Kalicilik (STATUS P1 karari):** "kalan is" burada TUTULMAZ — mevcut urun tablolarindan
//! turer (`pending_embed/chunk/image_count`, hepsi `NOT EXISTS`) → native SQLite TEK dogruluk
//! kaynagi. Surucu her tik'te bu sayimlari okur; >0 ise devam eder → durum diskte, bellekte
//! degil → restart-dayanikli. Verinin ifade edemedigi "denendi ve KALICI basarisiz" durumu
//! `index_skips` tablosunda (migration 0014); pending sorgulari onu dislar → surucu TERMINLENIR
//! (indekslenemez dosya sonsuza dek yeniden denenmez).
//!
//! **Kapsam (Q2 kullanici karari): yerel 3 OTO + vision opt-in.** Vision (Ollama, yavas) bu
//! surucude YOK — manuel karttan (vision_commands) tetiklenir; Ollama transient-hatasinda yanlis
//! skip riski + kullanici kontrolu bu ayrimI gerektirir.
//!
//! **Kilit stratejisi:** manuel `run_*` komutlari db kilidini TUM kosu boyunca tutar (indeksleme
//! sirasinda UI okumasi bloke). Arka-plan surucu bunu yapamaz → **asset-basina ince kilit**
//! (vision_commands deseni): her asset sonrasi kilit birakilir → liste/arama okumalari araya
//! girer. Kilit sirasi embedder→db (manuel komutlarla AYNI → deadlock yok).
//!
//! Kalicilik modeli folder_watcher deseni: modul-global `OnceLock` state (AppState'e dokunmaz →
//! test kurulumu etkilenmez); ilerleme `app.emit` (Channel degil — arka-plan, invocation yok).
//!
//! Uc indeksleme-asamasi (metin · gorsel · chunk) ve asama-destek yardimcilari `stages` alt-modulunde.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use archivist_db::IndexStage;

use crate::{rbac, AppState};

mod stages;
use stages::{run_chunk_stage, run_image_stage, run_text_stage};

/// `app_meta` anahtari: oto-indeks acik mi (yerel 3 stage). Yok/"true" → ACIK (varsayilan;
/// Q2 karari "yerel 3 oto"); "false" → kapali. Vision'i KAPSAMAZ (o manuel/opt-in).
pub const META_AUTO_INDEX_ENABLED: &str = "auto_index_enabled";

/// Batch boyu — kalan-is sorgusu bir seferde bu kadar asset ceker (kilit her asset'te birakildigi
/// icin bu yalniz db-fetch granuluk; manuel komutlarla ayni buyukluk sinifinda).
const BATCH: i64 = 32;

/// İlerleme yayin araligi (ms) — arka-plan; manuel komutlarin 100ms'inden biraz seyrek.
const EMIT_THROTTLE_MS: u128 = 150;

/// Skip nedeni azami uzunluk (DB'ye kisa/anlamli neden yazilir; patolojik hata mesajini kelepcele).
const MAX_SKIP_REASON: usize = 200;

/// Sinyal kanali: ingest sonrasi / acilis / "yeniden dene" → surucuye "yeni is olabilir" tik'i.
/// Coalesce edilir (birikmis tikler tek gecise iner).
static SIGNAL: OnceLock<Mutex<Option<Sender<()>>>> = OnceLock::new();
/// Surucu SU AN bir gecis kosuyor mu (UI durumu + manuel-komut cakisma bilgisi).
static ACTIVE: AtomicBool = AtomicBool::new(false);
/// Durdur istegi (banner "Durdur"): surucu asset-arasi kontrol eder, gecisi iptal eder.
static STOP: AtomicBool = AtomicBool::new(false);

fn signal_slot() -> &'static Mutex<Option<Sender<()>>> {
    SIGNAL.get_or_init(|| Mutex::new(None))
}

/// Surucu SU AN aktif mi (`auto_index_status` + banner).
pub fn is_active() -> bool {
    ACTIVE.load(Ordering::SeqCst)
}

/// Ingest sonrasi / acilis / "yeniden dene" → surucuye tik gonder (BLOKLAMAZ; coalesce).
/// Surucu kurulmamissa (test/erken) sessiz no-op.
pub fn signal_index() {
    if let Ok(slot) = signal_slot().lock() {
        if let Some(tx) = slot.as_ref() {
            let _ = tx.send(());
        }
    }
}

/// `app_meta` degerini oto-indeks-acik-mi'ya yorumla: "false" → kapali; yok/diger → ACIK
/// (varsayilan). Saf yardimci (string yorumu tek yerde; test edilebilir).
pub fn auto_enabled_from_meta(v: Option<String>) -> bool {
    !matches!(v.as_deref(), Some("false"))
}

/// Stage string'ini enum'a cevir ("yeniden dene" komutu; bilinmeyen/None → None = tum stage'ler).
fn parse_stage(s: &str) -> Option<IndexStage> {
    match s {
        "text" => Some(IndexStage::Text),
        "image" => Some(IndexStage::Image),
        "chunk" => Some(IndexStage::Chunk),
        "vision" => Some(IndexStage::Vision),
        _ => None,
    }
}

/// Surucuyu kur (setup'ta bir kez): tik kanalini ac + adli arka-plan iş parcacigi baslat.
pub fn init_driver(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    if let Ok(mut slot) = signal_slot().lock() {
        *slot = Some(tx);
    }
    let _ = std::thread::Builder::new()
        .name("arsiv-indexer".into())
        .spawn(move || driver_loop(app, rx));
}

/// Arka-plan surucu dongusu: tik bekle → coalesce → (acik ise) bir gecis kos. Kanal kapaninca
/// (uygulama cikisi) doner.
fn driver_loop(app: AppHandle, rx: Receiver<()>) {
    while rx.recv().is_ok() {
        // Coalesce: birikmis tum tikleri bosalt (tek gecis hepsini kapsar → gereksiz tekrar yok).
        while rx.try_recv().is_ok() {}
        if !enabled(&app) {
            continue; // kapali → gecisi atla; kullanici sonra acinca yeni tik gelir.
        }
        run_pass(&app);
    }
}

/// `app_meta`'dan acik-mi oku (kisa db kilidi). Hata → guvenli varsayilan: KAPALI (state yoksa
/// erken cagri; is yapma).
fn enabled(app: &AppHandle) -> bool {
    let Some(state) = app.try_state::<AppState>() else {
        return false;
    };
    let v = state
        .db
        .lock()
        .ok()
        .and_then(|db| db.get_meta(META_AUTO_INDEX_ENABLED).ok().flatten());
    auto_enabled_from_meta(v)
}

/// Yerel 3 stage'in toplam bekleyen (skip-haric) sayisi — gecis gerekli mi karari + banner "pending".
fn local_pending(state: &AppState) -> i64 {
    let Ok(db) = state.db.lock() else { return 0 };
    let e = db.pending_embed_count().unwrap_or(0);
    let i = db.pending_image_embed_count().unwrap_or(0);
    let c = db.pending_chunk_count().unwrap_or(0);
    e + i + c
}

/// Bir gecis: yerel 3 stage'i (text → gorsel → chunk) sirayla sur. Kalan is yoksa sessiz cikar
/// (bos banner/toast yok). Her stage best-effort: modeli yoksa graceful atlar. Durdur → kalan
/// stage'ler atlanir. Baslangic/ilerleme/bitis `app.emit`.
fn run_pass(app: &AppHandle) {
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let pending = local_pending(&state);
    if pending == 0 {
        return; // kalan is yok → sessiz (skip'lenenler pending'e girmez → burada terminlenir).
    }
    if ACTIVE.swap(true, Ordering::SeqCst) {
        return; // zaten aktif (tek-thread → normalde olmaz; guvenli).
    }
    STOP.store(false, Ordering::SeqCst);
    let start = Instant::now();
    let _ = app.emit("index_started", IndexStarted { pending });

    let mut sum = IndexSummary::default();
    run_text_stage(app, &state, &mut sum);
    if !STOP.load(Ordering::SeqCst) {
        run_image_stage(app, &state, &mut sum);
    }
    if !STOP.load(Ordering::SeqCst) {
        run_chunk_stage(app, &state, &mut sum);
    }

    sum.stopped = STOP.load(Ordering::SeqCst);
    sum.elapsed_ms = start.elapsed().as_millis() as u64;
    ACTIVE.store(false, Ordering::SeqCst);
    let _ = app.emit("index_done", &sum);
}

// ── Renderer'a giden olay yukleri (camelCase) ───────────────────────────────

/// Gecis basladi — banner hemen gorunsun (ilk model yuklemesi saniyeler surebilir).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexStarted {
    /// Yerel 3 stage'in toplam bekleyen sayisi (kaba ilerleme paydasi).
    pending: i64,
}

/// Stage ilerlemesi (banner "Metin/Gorsel/Chunk: X/N").
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IndexProgress {
    /// "text" | "image" | "chunk".
    stage: &'static str,
    processed: i64,
    total: i64,
    current_path: String,
}

/// Gecis bitti — banner gizle + ozet toast.
#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct IndexSummary {
    /// Metin vektoru uretilen asset.
    embedded: i64,
    /// Gorsel vektoru uretilen asset.
    image_embedded: i64,
    /// RAG chunk'lanan asset.
    chunked: i64,
    /// Kalici-basarisiz isaretlenen (skip; "yeniden dene" ile geri alinir).
    skipped: i64,
    /// Kullanici "Durdur" ile mi bitti.
    stopped: bool,
    elapsed_ms: u64,
}

// ── Komutlar (kontrol + durum) ──────────────────────────────────────────────

/// Oto-indeks durumu (banner + ayar). Rol gate yok — okuma.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoIndexStatusDto {
    /// Oto-indeks acik mi (yerel 3 stage; app_meta).
    pub enabled: bool,
    /// Surucu SU AN calisiyor mu.
    pub active: bool,
    /// Kalici-basarisiz (skip) toplam iz sayisi — "N atlandi · yeniden dene" gorunurlugu.
    pub skipped: i64,
}

/// Yerel AI indeksleri sifirlama raporu. Kaynak dosyalar ve vision sonucu bu kapsama girmez.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiIndexResetReportDto {
    pub text_vectors: i64,
    pub image_vectors: i64,
    pub chunks: i64,
    pub skipped: i64,
}

/// Oto-indeks durumu — enabled (app_meta) + active (surucu) + skipped (index_skips). Salt-okuma.
#[tauri::command(async)]
pub fn auto_index_status(state: State<'_, AppState>) -> Result<AutoIndexStatusDto, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let enabled = auto_enabled_from_meta(
        db.get_meta(META_AUTO_INDEX_ENABLED).map_err(|e| e.to_string())?,
    );
    let skipped = db.index_skip_count(None).map_err(|e| e.to_string())?;
    Ok(AutoIndexStatusDto {
        enabled,
        active: is_active(),
        skipped,
    })
}

/// Oto-indeksi ac/kapa (app_meta). **Admin.** Acildiginda hemen bir tik gonderir → surucu
/// birikmis kalan isi devraldir (kullanici acar acmaz calisma baslar).
#[tauri::command(async)]
pub fn set_auto_index_enabled(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.set_meta(META_AUTO_INDEX_ENABLED, if enabled { "true" } else { "false" })
            .map_err(|e| e.to_string())?;
    }
    if enabled {
        signal_index();
    }
    Ok(())
}

/// Aktif oto-indeks gecisini durdur (banner "Durdur"). **Admin.** Surucu asset-arasi gorup
/// gecisi sonlandirir (kalan is bekleyen kalir → sonraki tik/tarama devam eder).
#[tauri::command(async)]
pub fn stop_auto_index(state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    STOP.store(true, Ordering::SeqCst);
    Ok(())
}

/// Skip (kalici-basarisiz) izlerini temizle → asset'ler yeniden bekleyen olur + surucuye tik.
/// **Admin.** `stage` None/"" → tum stage'ler; "text"/"image"/"chunk"/"vision" → yalniz o stage
/// (H2 "yine de dene" pariti). Temizlenen iz sayisini doner.
#[tauri::command(async)]
pub fn retry_skipped_index(
    stage: Option<String>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let stage_enum = stage.as_deref().filter(|s| !s.is_empty()).and_then(parse_stage);
    let cleared = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.clear_index_skips(stage_enum).map_err(|e| e.to_string())?
    };
    signal_index();
    Ok(cleared)
}

/// Metin/CLIP/RAG ciktisini atomik temizle ve oto-indekse yeniden uretim sinyali ver.
///
/// Yalniz admin. Aktif oto-indeks gecisi varsa durdurma istegi once verilir; mevcut asset
/// tamamlanabilir ama sonraki gecis, temiz durumdan yeniden baslar. Vision analizleri kasitli
/// olarak korunur: bunlar vektor degil, pahali ve kullanicinin istege bagli urettigi metadata'dir.
#[tauri::command(async)]
pub fn reset_local_ai_indexes(state: State<'_, AppState>) -> Result<AiIndexResetReportDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);

    // Ince-kilitli surucu bir sonraki asset sinirinda durur; manuel uzun kosu ise DB kilidi
    // serbest kalana dek beklenir. Her iki durumda da reset DB transaction'i atomiktir.
    STOP.store(true, Ordering::SeqCst);
    let report = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let report = db.reset_local_ai_indexes().map_err(|e| e.to_string())?;
        let detail = format!(
            "text_vectors={} image_vectors={} chunks={} skips={}",
            report.text_vectors, report.image_vectors, report.chunks, report.skipped
        );
        crate::audit::record_on(
            &db,
            &actor,
            "ai_index_reset",
            Some("ai_index"),
            None,
            Some(&detail),
        );
        report
    };
    signal_index();
    Ok(AiIndexResetReportDto {
        text_vectors: report.text_vectors,
        image_vectors: report.image_vectors,
        chunks: report.chunks,
        skipped: report.skipped,
    })
}

/// YALNIZ RAG parcalarini temizle (semantik + CLIP gorsel indeksleri KORUNUR) ve yeniden
/// uretim sinyali ver. Silinen parca sayisini doner.
///
/// Ne zaman gerekir: **parcalama kurallari degistiginde** mevcut parcalar bayatlar ama
/// vektor indeksleri gecerli kalir. Ilk ornek 2026-08-18: parcalama kelime yerine token
/// butcesine gecti (eski ayarda metnin ancak ~%26'si vektore giriyordu). Tam sifirlama
/// (`reset_local_ai_indexes`) burada gereksiz olurdu — CLIP gorsel indeksini de yikar.
///
/// Yalniz admin. Aktif oto-indeks gecisine once durdurma istegi verilir; DB islemi atomiktir.
#[tauri::command(async)]
pub fn reset_rag_chunks(state: State<'_, AppState>) -> Result<i64, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);

    STOP.store(true, Ordering::SeqCst);
    let cleared = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let cleared = db.reset_rag_chunks().map_err(|e| e.to_string())?;
        crate::audit::record_on(
            &db,
            &actor,
            "rag_chunks_reset",
            Some("ai_index"),
            None,
            Some(&format!("chunks={cleared}")),
        );
        cleared
    };
    signal_index();
    Ok(cleared)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_enabled_default_true_only_false_disables() {
        // Yok → ACIK (varsayilan; Q2 "yerel 3 oto").
        assert!(auto_enabled_from_meta(None));
        // "false" → kapali (tek kapatan deger).
        assert!(!auto_enabled_from_meta(Some("false".into())));
        // "true" / diger → acik.
        assert!(auto_enabled_from_meta(Some("true".into())));
        assert!(auto_enabled_from_meta(Some("1".into())));
        assert!(auto_enabled_from_meta(Some("".into())));
    }

    #[test]
    fn parse_stage_maps_known_and_rejects_unknown() {
        assert_eq!(parse_stage("text"), Some(IndexStage::Text));
        assert_eq!(parse_stage("image"), Some(IndexStage::Image));
        assert_eq!(parse_stage("chunk"), Some(IndexStage::Chunk));
        assert_eq!(parse_stage("vision"), Some(IndexStage::Vision));
        assert_eq!(parse_stage("bogus"), None);
        assert_eq!(parse_stage(""), None);
    }

    #[test]
    fn signal_before_init_is_silent_noop() {
        // Surucu kurulmadan sinyal → panik yok (test/erken cagri guvenli).
        signal_index();
    }
}
