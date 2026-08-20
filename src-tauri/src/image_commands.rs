//! Faz 5.3 — gorsel (CLIP) arama komutlari + gorsel embedding uretim koordinatoru.
//!
//! Mimari ayrim (embed_commands ile ayni): `archivist-db` ONNX'ten BAGIMSIZ (yalniz vektor
//! yazar/arar); CLIP embedding URETIMI burada (`archivist-embed::ImageEmbedder`). Embedder
//! pahali (iki ONNX: vision+text) → `AppState.image_embedder` lazy-cache.
//!
//! Komutlar:
//!   - `image_embed_status` : embedlenmis/bekleyen/toplam + model hazir mi (Dashboard karti).
//!   - `run_image_embedding`: thumbnail'i olan asset'leri batch'le embedle (admin, resumable, Channel).
//!   - `image_search`       : sorgu metnini CLIP-text embedle → sqlite-vec kNN → filtreli sonuç (metin→gorsel).
//!   - `similar_images`     : bir asset'in gorseline en yakin asset'ler (gorsel→gorsel; model GEREKMEZ).

use std::path::{Path, PathBuf};
use std::time::Instant;

use archivist_db::{AssetPage, AssetRow, ListOpts};
use archivist_embed::ImageEmbedder;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::{ollama, rbac, AppState};

/// CLIP model dizin adi (Xenova yerlesimi: tokenizer.json + onnx/{vision,text}_model*.onnx).
const MODEL_NAME: &str = "clip-vit-base-patch32";
/// Cok-dilli CLIP metin modeli dizin adi (sentence-transformers; Faz 5.4 — Turkce metin→gorsel).
const MCLIP_NAME: &str = "clip-ViT-B-32-multilingual-v1";
/// Embed batch boyu — her batch sonrasi ilerleme; her vektor ayri TX (resumable).
const BATCH: i64 = 32;

/// CLIP model dizinini coz: (1) `ARSIV_CLIP_MODEL_DIR`, (2) **app_local_data_dir/models** (P0.4
/// import hedefi), (3) exe-yani/cwd `models/<ad>`, (4) yalniz DEV: H2 fallback. `tokenizer.json`
/// iceren ilk var olan dizin.
pub(crate) fn resolve_clip_dir() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(d) = std::env::var_os("ARSIV_CLIP_MODEL_DIR") {
        candidates.push(PathBuf::from(d));
    }
    if let Some(root) = crate::model_commands::models_root() {
        candidates.push(root.join(MODEL_NAME));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("models").join(MODEL_NAME));
        }
    }
    candidates.push(PathBuf::from("models").join(MODEL_NAME));
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(r"C:\Arsiv-H2\public\models\Xenova").join(MODEL_NAME));

    for c in candidates {
        if c.join("tokenizer.json").exists() {
            return Ok(c);
        }
    }
    Err(format!(
        "CLIP modeli bulunamadi — ARSIV_CLIP_MODEL_DIR ayarlayin ya da modeli models/{MODEL_NAME}/ \
         altina koyun (tokenizer.json + onnx/vision_model*.onnx + onnx/text_model*.onnx)"
    ))
}

/// CLIP embedder'i (gerekiyorsa) yukle ve mutable referans dondur (semantik metin deseni).
/// `pub(crate)`: oto-indeks surucusu (indexer.rs) gorsel-embed stage'inde yeniden kullanir.
pub(crate) fn ensure_image_embedder<'a>(
    guard: &'a mut Option<ImageEmbedder>,
    dir: &Path,
) -> Result<&'a mut ImageEmbedder, String> {
    if guard.is_none() {
        let e = ImageEmbedder::from_dir(dir).map_err(|e| e.to_string())?;
        *guard = Some(e);
    }
    Ok(guard.as_mut().expect("image embedder yuklendi"))
}

/// Cok-dilli CLIP metin modeli dizinini coz: (1) `ARSIV_MCLIP_MODEL_DIR`, (2) **app_local_data_dir/
/// models** (P0.4 import hedefi), (3) exe-yani/cwd `models/<ad>`, (4) yalniz DEV fallback.
/// `tokenizer.json` + `2_Dense/model.safetensors` iceren ilk var olan dizin.
///
/// NOT: mclip artik SORGU YOLUNDAN cikarildi (Turkce sorgu offline sozlukle Ingilizceye cevrilip
/// duz Ingilizce CLIP'e verilir; bkz `embed_query_text_clip`). Bu fonksiyon YALNIZ model-import
/// durumu icin kalir (`model_commands::model_status` "mclip" anahtarini bununla cozer).
pub(crate) fn resolve_mclip_dir() -> Result<PathBuf, String> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(d) = std::env::var_os("ARSIV_MCLIP_MODEL_DIR") {
        candidates.push(PathBuf::from(d));
    }
    if let Some(root) = crate::model_commands::models_root() {
        candidates.push(root.join(MCLIP_NAME));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("models").join(MCLIP_NAME));
        }
    }
    candidates.push(PathBuf::from("models").join(MCLIP_NAME));
    #[cfg(debug_assertions)]
    candidates.push(PathBuf::from(r"C:\Arsiv-H3\models").join(MCLIP_NAME));

    for c in candidates {
        if c.join("tokenizer.json").exists() && c.join("2_Dense").join("model.safetensors").exists()
        {
            return Ok(c);
        }
    }
    Err(format!(
        "cok-dilli CLIP modeli bulunamadi — ARSIV_MCLIP_MODEL_DIR ayarlayin ya da modeli \
         models/{MCLIP_NAME}/ altina koyun"
    ))
}

/// Gorsel embedding durum ozeti (Dashboard "Gorsel Indeks" karti).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEmbedStatusDto {
    /// Gorsel-vektoru olan asset sayisi (asset_image_region_vectors icinde DISTINCT asset; bolge
    /// satiri degil — asset basina 5 bolge).
    pub embedded: i64,
    /// Thumbnail'i olan ama gorsel-vektoru olmayan aktif asset (kalan is).
    pub pending: i64,
    /// Embedlenebilir evren (embedded + pending) — "X / N" gostergesi.
    pub total: i64,
    /// CLIP model dosyalari cozulebiliyor mu.
    pub model_ready: bool,
    /// (KULLANIMDAN KALDIRILDI) Eskiden cok-dilli CLIP metin modeli (mclip) mevcut mu bilgisini
    /// tasirdi. mclip sorgu yolundan cikarildi (Turkce artik offline sozlukle Ingilizceye cevrilir,
    /// H2 pariti). Frontend alani geriye-donuk okuyabildigi icin KORUNUR ama DAIMA `false` doner.
    pub multilingual: bool,
}

/// Gorsel embedding uretim ilerlemesi (Channel; ingest/semantik deseni, camelCase).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEmbedProgressDto {
    pub processed: i64,
    pub total: i64,
    pub current_path: String,
}

/// Gorsel embedding kosusu raporu.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageEmbedRunReportDto {
    pub embedded: i64,
    pub failed: i64,
    pub elapsed_ms: u128,
}

/// Gorsel embedding durumu (rol gate yok — okuma). `model_ready` dosya kontrolu (model yuklemez).
#[tauri::command(async)]
pub fn image_embed_status(state: State<'_, AppState>) -> Result<ImageEmbedStatusDto, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let pending = db.pending_image_embed_count().map_err(|e| e.to_string())?;
    let embedded = db.image_vector_count().map_err(|e| e.to_string())?;
    Ok(ImageEmbedStatusDto {
        embedded,
        pending,
        total: embedded + pending,
        model_ready: resolve_clip_dir().is_ok(),
        // mclip sorgu yolundan kaldirildi → alan geriye-donuk uyumluluk icin daima false.
        multilingual: false,
    })
}

/// Thumbnail'i olan asset'leri batch'le gorsel-embedle. **Admin-gated.** Resumable: her vektor
/// ayri TX; embed basarisiz olan asset cursor (`after_id`) ile atlanir (sonsuz dongu yok).
/// İlerleme Channel ile akar (~100ms throttle, ilk/son daima) — semantik metin ile ayni desen.
// `async fn`: ana iş parcacigi DISINDA kosar → uzun CLIP embed dongusu UI'yi dondurmez.
// Govde bloklayici, `.await` yok → guard'lar await sinirini gecmez (Send-future guvenli).
#[tauri::command]
pub async fn run_image_embedding(
    on_progress: Channel<ImageEmbedProgressDto>,
    state: State<'_, AppState>,
) -> Result<ImageEmbedRunReportDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    let dir = resolve_clip_dir()?;
    let mut emb_guard = state.image_embedder.lock().map_err(|e| e.to_string())?;
    let embedder = ensure_image_embedder(&mut emb_guard, &dir)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;

    let total = db.pending_image_embed_count().map_err(|e| e.to_string())?;
    let start = Instant::now();
    let (mut embedded, mut failed, mut processed, mut after_id) = (0i64, 0i64, 0i64, 0i64);
    let mut last_emit: Option<Instant> = None;

    loop {
        let batch = db
            .assets_without_image_vectors(after_id, BATCH)
            .map_err(|e| e.to_string())?;
        if batch.is_empty() {
            break;
        }
        for p in &batch {
            after_id = p.id; // cursor ilerlet → basarisiz embed tekrar getirilmez.
            // Cok-bolge (kompozisyon): 5 uzamsal bolge embedle → tum bolge satirlarini atomik yaz.
            match embedder.embed_image_regions(&p.thumb_bytes) {
                Ok(regions) => match db.set_image_region_vectors(p.id, &regions) {
                    Ok(()) => embedded += 1,
                    Err(_) => failed += 1,
                },
                Err(_) => failed += 1,
            }
            processed += 1;

            let now = Instant::now();
            let is_last = processed >= total;
            let due = last_emit.is_none_or(|t| now.duration_since(t).as_millis() >= 100);
            if processed == 1 || is_last || due {
                last_emit = Some(now);
                let _ = on_progress.send(ImageEmbedProgressDto {
                    processed,
                    total,
                    current_path: p.file_name.clone(),
                });
            }
        }
    }

    Ok(ImageEmbedRunReportDto {
        embedded,
        failed,
        elapsed_ms: start.elapsed().as_millis(),
    })
}

/// Ollama TR→EN ceviri istegi zaman asimi (sn). **KISA** (H2'nin 60sn'si COLD-START + warmup icindi;
/// H3'te warmup YOK + sozluk zaten aninda → uzun bekleme gereksiz). Sicak model ~1-2sn; asilirsa
/// (yavas/yuklenmemis model) graceful sozluge duser.
const OLLAMA_TRANSLATE_TIMEOUT_SECS: u64 = 7;
/// Ollama ceviri basarisizligindan sonra tekrar denemeden once beklenen sure (ms). Hang-koruma:
/// Ollama down/uzak-erisilemez iken residual'li HER sorgunun timeout'u beklememesi icin — son
/// basarisizliktan bu sure gecmeden Ollama ATLANIR (dogrudan sozluk). Cache: `AppState`.
const OLLAMA_FAIL_COOLDOWN_MS: u64 = 30_000;

/// Su anki zaman (UNIX epoch ms). Cooldown penceresi icin (30sn hassasiyeti icin epoch yeterli;
/// deger 0'a asla yakin degil → `0 = hic basarisiz olmadi` sentineli guvenli).
fn now_epoch_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Ollama ham ceviri yanitindan `<think>...</think>` dusunme bloklarini sil (dusunumlu modeller;
/// H2 pariti). Dusunme DAIMA basta uretilir → son `</think>`'ten SONRASI gercek cevaptir. Kapanmamis
/// `<think>` (num_predict kesildi) → kullanilabilir cevap YOK → bos ("" → cagiran None'a cevirir).
/// `<think>`/`</think>` ASCII + `to_ascii_lowercase` bayt uzunlugunu korur → lower'daki bayt konumu
/// `s`'de birebir gecerli (char siniri).
fn strip_think(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    if let Some(pos) = lower.rfind("</think>") {
        return s[pos + "</think>".len()..].to_string();
    }
    if lower.contains("<think>") {
        return String::new();
    }
    s.to_string()
}

/// Bastaki `EN:` / `English -` / `Translation:` etiketini sil (H2 `^(EN|English|Translation)\s*[:-]`).
/// Case-insensitive; etiketten sonra `:` VEYA `-` gelmezse SILME (or. "entrance", "energy" korunur).
/// Uzun etiket once denenir (kisa "en" onu yutmasin).
fn strip_translation_label(s: &str) -> String {
    let t = s.trim_start();
    for label in ["english", "translation", "en"] {
        if let Some(head) = t.get(..label.len()) {
            if head.eq_ignore_ascii_case(label) {
                let rest = t[label.len()..].trim_start();
                if let Some(after) = rest.strip_prefix(':').or(rest.strip_prefix('-')) {
                    return after.trim_start().to_string();
                }
            }
        }
    }
    t.to_string()
}

/// Ollama ham yanitini temiz Ingilizce sorguya indirge (H2 `translateToEnglish` yanit-parse porti):
/// (1) `<think>` bloklarini sil, (2) ilk BOS-OLMAYAN satiri al, (3) `EN:`/`English -` etiketini sil,
/// (4) bas/son tirnak + sondaki `.!?` kirp. Sonuc bos olabilir (→ cagiran sozluge duser).
fn clean_ollama_translation(raw: &str) -> String {
    let no_think = strip_think(raw);
    let first = no_think.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("");
    let unlabeled = strip_translation_label(first);
    unlabeled
        .trim_start_matches(['"', '\'', '`'])
        .trim_end_matches(['"', '\'', '`', '.', '!', '?'])
        .trim()
        .to_string()
}

/// Turkce sorguyu Ollama ile Ingilizceye cevir (H2 `translateToEnglish` porti; SOZLUK-SONRASI
/// residual dali icin). Basarisizlikta ASLA panik/Err yaymadan `None` (graceful → cagiran sozluge
/// duser). **Hang-koruma:** son basarisizliktan bu yana cooldown gecmediyse Ollama'ya HIC gidilmez
/// (Ollama down/yavas iken residual'li her sorgu 7sn beklemez). Ollama cagrisi mevcut
/// `ollama::generate` (stream:false; base+timeout o modulun deseninden) — yeni HTTP istemcisi YOK.
///
/// Model: `ollama::DEFAULT_CHAT_MODEL` (rag_chat'in de varsayilani). Kullanicinin sectigi sohbet
/// modeli frontend localStorage'da tutulur, bu backend yoluna henuz baglanmadi (DTO imzasi bu tur
/// degismiyor) → varsayilan kullanilir; model yoksa `generate` Err → graceful sozluk.
fn translate_to_english_ollama(state: &AppState, q: &str) -> Option<String> {
    use std::sync::atomic::Ordering;
    let trimmed = q.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Cooldown: son basarisizliktan bu yana OLLAMA_FAIL_COOLDOWN_MS gecmediyse Ollama'yi ATLA.
    let last = state.ollama_translate_fail_ms.load(Ordering::Relaxed);
    let now = now_epoch_ms();
    if last != 0 && now.saturating_sub(last) < OLLAMA_FAIL_COOLDOWN_MS {
        return None;
    }
    // H2 prompt (/no_think + 2 ornek + "sadece ceviri"). /no_think dusunumlu modellerde thinking'i
    // baskilar (H3 `ollama::generate` API-seviye think:false gondermez; retrieval.rs ile ayni desen).
    let prompt = format!(
        "/no_think\n\
         Görev: Aşağıdaki Türkçe görsel arama sorgusunu kısa ve doğal İngilizceye çevir. \
         Sadece çeviriyi yaz, başka açıklama yok.\n\n\
         ÖRNEKLER:\n\
         TR: merdiven planı\nEN: stair plan\n\n\
         TR: cephe çizimi\nEN: facade drawing\n\n\
         TR: {trimmed}\nEN:"
    );
    // temp 0.1 (H2), num_predict 40 (kucuk cikti; /no_think icin ufak marj). Kisa timeout.
    match ollama::generate(
        ollama::DEFAULT_CHAT_MODEL,
        &prompt,
        0.1,
        40,
        OLLAMA_TRANSLATE_TIMEOUT_SECS,
    ) {
        Ok(raw) => {
            let cleaned = clean_ollama_translation(&raw);
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned)
            }
        }
        Err(_) => {
            // Timeout/baglanti hatasi → cooldown penceresini baslat (sonraki sorgular Ollama'yi atlar).
            // Zaman asimindan SONRAKI an kaydedilir (generate 7sn surmus olabilir → dogru pencere).
            state.ollama_translate_fail_ms.store(now_epoch_ms(), Ordering::Relaxed);
            None
        }
    }
}

/// SAF karar: sozluk ciktisi + (opsiyonel) Ollama ciktisindan hangi effective query kullanilir.
/// Ollama sonucu `Option` olarak enjekte edilir → AppState/ag olmadan test edilebilir.
///
/// - `residual_empty` (sozluk TAM kapsadi) → sozluk ciktisi; Ollama sonucu YOK SAYILIR.
/// - residual var + Ollama `Some(en)` (bos degil, TR-sinyali kalmamis) → `en`.
/// - aksi (Ollama None / bos / hala Turkce) → sozluk ciktisi (kismi ceviri de olsa).
///
/// Sozluk ciktisi bossa (nadir) → orijinal sorgu.
fn decide_effective(
    original: &str,
    translated: &str,
    residual_empty: bool,
    ollama: Option<String>,
) -> String {
    let dict_fallback = if translated.trim().is_empty() {
        original.to_string()
    } else {
        translated.to_string()
    };
    if residual_empty {
        return dict_fallback;
    }
    match ollama {
        Some(en) if !en.trim().is_empty() && !crate::visual_dict::has_turkish_signal(&en) => en,
        _ => dict_fallback,
    }
}

/// Sorguyu Ingilizce CLIP metnine coz (H2 `searchImagesByText` cozum akisi):
///  - Turkce sinyali YOK → `q` AYNEN (zaten Ingilizce → ceviri gerekmez).
///  - Var → once offline SOZLUK (aninda/cevrimdisi). Sozluk TAM kapsadi (residual bos) → sozluk
///    ciktisi; **Ollama'ya HIC gidilmez** → kapsanan sorgular ("cami", "bulutlu hava") GECIKMESIZ.
///  - Residual (cevrilemeyen TR kelime) varsa → Ollama cevirisi dene (kisa timeout + cooldown-koruma);
///    basarili/temiz Ingilizce → onu kullan, degilse sozluk ciktisina dus.
fn resolve_effective_query(state: &AppState, q: &str) -> String {
    if !crate::visual_dict::has_turkish_signal(q) {
        return q.to_string();
    }
    let (translated, residual) = crate::visual_dict::translate_with_dictionary(q);
    if residual.is_empty() {
        // Sozluk tam kapsadi → Ollama'ya HIC gitme (offline/hizli). Ollama None gecilir (kullanilmaz).
        return decide_effective(q, &translated, true, None);
    }
    let ollama = translate_to_english_ollama(state, q);
    decide_effective(q, &translated, false, ollama)
}

/// Sorgu metnini CLIP-text vektorune (512) embedle. **H2 pariti (`visualSearch.ts`):** CLIP metin
/// kodlayici YALNIZ Ingilizce anlar → Turkce sorgu Ingilizceye cozulur (`resolve_effective_query`):
/// once offline kuratorlu SOZLUK, sozluk kapsamazsa (residual) kisa-timeout Ollama, o da olmazsa
/// sozluk. Cikti gorsel vektorlerle (Ingilizce vision) ayni ViT-B/32 512 uzayinda → cosine-
/// kIyaslanabilir. Turkce sinyali yoksa sorgu AYNEN kullanilir.
///
/// **Offline-first garanti:** Ollama YOKKEN de bozulmadan calisir — kapsanan sorgular Ollama'ya HIC
/// gitmez; kapsanmayan + Ollama-down ise cooldown-cache ile hizlica sozluge duser (bkz
/// `translate_to_english_ollama`). (Cok-dilli CLIP [mclip] KALDIRILDI: Turkce'yi dogrudan mclip'e
/// vermek cop sonuc uretiyordu; H2 bunu YAPMAZ.)
///
/// Embedder kilidi blok sonunda birakilir (db kilidi cagiran tarafta sonra alinir → kilit-sira
/// dongusu yok). `image_search`/`visual_search` komutlari + sohbet **gorsel-fallback** (rag_chat)
/// paylasir. Hata → Err (cagiran graceful: arama bos sonuc, sohbet normal "bulunamadi").
pub(crate) fn embed_query_text_clip(state: &AppState, q: &str) -> Result<Vec<f32>, String> {
    let effective = resolve_effective_query(state, q);
    let dir = resolve_clip_dir()?;
    let mut g = state.image_embedder.lock().map_err(|e| e.to_string())?;
    ensure_image_embedder(&mut g, &dir)?
        .embed_text(&effective)
        .map_err(|e| e.to_string())
}

/// Metin→gorsel arama: sorgu metnini CLIP metin kodlayici ile embedle → sqlite-vec kNN →
/// filtreli sonuç. Rol gate yok (okuma). Bos sorgu → bos sonuç. Model ilk cagrida yuklenir.
#[tauri::command(async)]
pub fn image_search(
    query: String,
    opts: ListOpts,
    state: State<'_, AppState>,
) -> Result<AssetPage, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(AssetPage {
            total: 0,
            items: Vec::new(),
        });
    }
    let qvec = embed_query_text_clip(&state, q)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.image_search(&qvec, &opts).map_err(|e| e.to_string())
}

/// Bir gorsel-arama sonucu: asset + GERCEK cosine skoru. `asset` serde'si `AssetRow` ile birebir
/// (mevcut frontend tipi yeniden kullanilir); `score` UI'da rozet + eşik-slider filtresi icin.
#[derive(Serialize)]
pub struct VisualHit {
    pub asset: AssetRow,
    pub score: f32,
}

/// **Gorsel Arama (H2 "Görsel Arama" modali pariti):** sorgu metnini (Turkce ise ONCE offline
/// sozlukle Ingilizceye cevrilerek) duz Ingilizce CLIP metin kodlayici ile embedle → gorsel-vektor
/// kNN → **GERCEK cosine skorlu** sonuçlar (AZALAN). H2 gibi TR→EN sozluk kullanilir (CLIP yalniz
/// Ingilizce anlar; ceviri `embed_query_text_clip` icinde). **ESIK UYGULANMAZ** — skorlar UI'da GORUNUR,
/// kullanici eşik-slider ile filtreler ("hassasiyet" deseni; kor-kalibrasyon yerine seffaflik +
/// dogru "bulunamadi"). AYRI arac → ana FTS kutusunu KIRLETMEZ (H2 f625ebc dersi: gorsel/metin
/// harmani ayrildi). Model yoksa `embed_query_text_clip` Err (UI "modeli Pano'dan iceri aktar").
#[tauri::command(async)]
pub fn visual_search(
    query: String,
    opts: ListOpts,
    state: State<'_, AppState>,
) -> Result<Vec<VisualHit>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let qvec = embed_query_text_clip(&state, q)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let scored = db.image_search_scored(&qvec, &opts).map_err(|e| e.to_string())?;
    Ok(scored.into_iter().map(|(asset, score)| VisualHit { asset, score }).collect())
}

/// Gorsel→gorsel ("benzer gorseller"): asset'in KENDI gorsel-vektorune en yakin asset'ler
/// (kendisi haric). Model GEREKMEZ (depolanan vektor kullanilir) → vektor varsa offline calisir.
/// Rol gate yok (okuma).
#[tauri::command(async)]
pub fn similar_images(
    asset_id: i64,
    opts: ListOpts,
    state: State<'_, AppState>,
) -> Result<AssetPage, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.similar_images(asset_id, &opts).map_err(|e| e.to_string())
}

/// **"Bu renge yakin gorselleri bul"** — hedef sRGB rengine algisal olarak yakin asset'ler.
///
/// Model/vektor GEREKMEZ: cikarim sirasinda zaten yazilan `dominant_colors` EAV'si taranir.
/// Siralama en yakindan uzaga; aktif filtreler (klasor/etiket/proje/cop…) KORUNUR.
///
/// **Kopya kod yok (2026-08-20 kullanici direktifi):** renk uzayi donusumu ve uzaklik
/// `archivist_extract_image`ten gelir (baskin renkleri URETEN kodun ta kendisi) — arama ile
/// cikarim boylece AYNI uzayda olcer. DB katmani kolorimetri bilmez; kapanis buradan enjekte
/// edilir (`assets_near_color`). Sayfa hidratlamasi da uc arama yolunun paylastigi
/// `query::hydrate_ordered` ile yapilir.
///
/// ⚠️ ΔE76 (Lab Oklid) kullanilir — CIEDE2000 DEGIL. Gerekce: burada is SIRALAMA + geniş bir
/// esik; ΔE76 bunun icin yeterli ve cikarimin k-means'iyle AYNI olcut. (Detay panelindeki RAL
/// eslesmesi kucuk farklarla ugrastigi icin orada CIEDE2000 kullanilir.)
///
/// `max_delta`: kabul esigi (ΔE76; ~10 cok yakin · ~25 ayni renk ailesi · 40+ gevsek).
/// `min_share`: bu yuzdenin altinda kalan baskin renkler SAYILMAZ (bir kac piksellik kume
/// yuzunden gorsel "kirmizi" sayilmasin). Salt-okuma → rol gate yok (`similar_images` deseni).
#[tauri::command(async)]
pub fn assets_near_color(
    r: u8,
    g: u8,
    b: u8,
    max_delta: f64,
    min_share: f64,
    opts: ListOpts,
    state: State<'_, AppState>,
) -> Result<AssetPage, String> {
    let target = archivist_extract_image::srgb_to_lab(r, g, b);
    // Esik KARE uzayda karsilastirilir (`lab_dist_sq` karekok almaz).
    let max_sq = max_delta * max_delta;
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.assets_near_color(
        &opts,
        |color| {
            if f64::from(color.percentage) < min_share {
                return f64::INFINITY; // paysiz renk eslesme sayilmaz
            }
            let lab = archivist_extract_image::srgb_to_lab(color.r, color.g, color.b);
            archivist_extract_image::lab_dist_sq(&target, &lab)
        },
        max_sq,
    )
    .map_err(|e| e.to_string())
}

/// Geri-doldurma ilerlemesi (Channel → kart + global banner). `reindex`/`analiz` ile ayni sekil.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ColorBackfillProgress {
    processed: usize,
    total: usize,
}

/// **Renk verisi eksik asset sayisi** (thumbnail'i olan ama `dominant_colors` EAV'si olmayan).
/// Geri-doldurma kartinin gosterdigi sayi. Salt-okuma → rol gate yok.
#[tauri::command(async)]
pub fn count_missing_dominant_colors(state: State<'_, AppState>) -> Result<i64, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.count_missing_dominant_colors().map_err(|e| e.to_string())
}

/// **Baskin renk geri-doldurma (mevcut asset'ler; YENIDEN TARAMA YOK).** **Admin.**
///
/// Neden gerekli (olculdu 2026-08-20, gercek arsiv): renk cikarimi arsiv kurulduktan SONRA
/// eklendi → daha once indekslenen raster gorsellerde `dominant_colors` EAV'si hic olusmadi
/// (dev arsivinde saf raster dosyalarin %68'i). O dosyalar renk kartelasinda ve renk aramasinda
/// GORUNMUYORDU.
///
/// **Kaynak dosyaya DOKUNMAZ**: renk, DB'de duran THUMBNAIL baytlarindan hesaplanir
/// (`dominant_colors_from_bytes`). Uc kazanci var: (a) kaynagi baska makinede olan dosyalar da
/// kapsanir (cok-lokasyon), (b) yeniden tarama/IO yok → saniyeler, (c) cikarim zaten goruntuyu
/// 100x100'e kuculttugu icin 256px thumbnail yeterli.
///
/// **Idempotent**: yalniz EKSIK olanlara yazar, mevcut degeri EZMEZ (cikarimdan gelen — kaynak
/// dosyadan hesaplanmis — deger her zaman onceliklidir). Ikinci kosu 0 doner.
/// Kilit PARTI BASI alinir (tarama/analiz donmasin; 2026-08-20 dersi).
///
/// **Hiz:** decode + k-means dosya basina ~25ms ve dosyalar birbirinden BAGIMSIZ → parti icinde
/// cekirdeklere dagitilir (ingest worker deseni). Olcum 2026-08-20: 1.231 dosya tek is parcaciginda
/// ~30sn suruyordu. Ilerleme ana thread'de toplanir → sayac monoton, yaris yok.
#[tauri::command(async)]
pub fn backfill_dominant_colors(
    on_progress: Channel<ColorBackfillProgress>,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    // Toplam ONCE olculur: ilerleme "N/M" olarak gosterilebilsin. (Olculdu 2026-08-20: dosya
    // basina ~25ms — 1.231 dosya ≈ 30sn. Sessiz bekleme kabul edilemez; kullanici bulgusu.)
    let total = {
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.count_missing_dominant_colors().map_err(|e| e.to_string())? as usize
    };
    let _ = on_progress.send(ColorBackfillProgress { processed: 0, total });

    const BATCH: i64 = 200;
    let mut after_id = 0i64;
    let mut written = 0usize;
    let mut processed = 0usize;
    let mut last_emit: Option<Instant> = None;
    loop {
        // Parti CEK (kisa kilit).
        let batch = {
            let db = state.read_db.lock().map_err(|e| e.to_string())?;
            db.assets_missing_dominant_colors(after_id, BATCH).map_err(|e| e.to_string())?
        };
        if batch.is_empty() {
            break;
        }
        // Kursor: sorgu `ORDER BY a.id` → partinin SON id'si bir sonraki partinin baslangici.
        // (Paralel isleme sirayi bozdugu icin id'yi dongude ilerletemeyiz.)
        after_id = batch.last().map(|(id, _)| *id).unwrap_or(after_id);

        // Decode + k-means: KILITSIZ ve **PARALEL** (ingest'in worker deseni: `thread::scope` +
        // paylasik `AtomicUsize` indeksi → is-calma; sonuclar mpsc ile ANA THREAD'e). Is tamamen
        // CPU-bagimli: baytlar zaten bellekte (thumbnail), disk okumasi YOK.
        //
        // ⚠️ Neden `effective_concurrency` (ingest) DEGIL: o fonksiyon otomatik modda 1 worker
        // secer, cunku ingest paralel BUYUK DOSYA OKUR ve bilinmeyen bir HDD/USB'yi doyurabilir.
        // Burada disk hic okunmuyor → cekirdek sayisi dogru varsayilan.
        //
        // Ilerleme ANA THREAD'de, sonuc geldikce yayilir (~100ms kisma) → worker'lar arasi
        // yaris/kilitlenme yok, sayac monoton artar.
        let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).clamp(1, 8);
        let next = std::sync::atomic::AtomicUsize::new(0);
        let (tx, rx) = std::sync::mpsc::channel::<(i64, Vec<archivist_db::DominantColor>)>();
        let mut computed: Vec<(i64, Vec<archivist_db::DominantColor>)> =
            Vec::with_capacity(batch.len());
        std::thread::scope(|scope| {
            for _ in 0..workers {
                let tx = tx.clone();
                let next = &next;
                let batch = &batch;
                scope.spawn(move || {
                    loop {
                        let i = next.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        let Some((id, bytes)) = batch.get(i) else {
                            break;
                        };
                        let colors = archivist_extract_image::dominant_colors_from_bytes(bytes, 5)
                            .into_iter()
                            .map(|c| archivist_db::DominantColor {
                                r: c.r,
                                g: c.g,
                                b: c.b,
                                percentage: c.percentage,
                            })
                            .collect();
                        if tx.send((*id, colors)).is_err() {
                            break; // alici gitti (olmamali) → sessizce bit
                        }
                    }
                });
            }
            drop(tx); // ana thread'in kopyasi kapanmali ki `rx` dongusu bitebilsin
            for item in rx {
                computed.push(item);
                processed += 1;
                let now = Instant::now();
                let due = last_emit.is_none_or(|t| now.duration_since(t).as_millis() >= 100);
                if due || processed == total {
                    last_emit = Some(now);
                    let _ = on_progress.send(ColorBackfillProgress { processed, total });
                }
            }
        });
        // Yaz (kisa kilit).
        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            for (id, colors) in &computed {
                // Cozulemeyen thumbnail → bos liste → yazilmaz (yalan EAV uretme).
                if db.write_dominant_colors(*id, colors).map_err(|e| e.to_string())? {
                    written += 1;
                }
            }
        }
    }
    // Bitis: cubuk %100'e otursun (son parti kisildiysa yakalanmamis olabilir).
    let _ = on_progress.send(ColorBackfillProgress { processed, total });
    Ok(written)
}

/// **Katman 1 backfill (Doctor/bakim):** `ai_gorsel_turu` OLMAYAN raster gorsel asset'leri, mevcut
/// EXIF/boyut EAV'sinden deterministik olarak render/foto/doku siniflandirir → dolu ise yazar.
/// **Admin-gated** (yazma). **Idempotent** (yalniz eksikler; ikinci kosu 0). YENIDEN TARAMA YOK
/// (yalniz DB okur/yazar; model GEREKMEZ). Doner: yeni yazilan asset sayisi.
#[tauri::command(async)]
pub fn backfill_image_kind(state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.backfill_image_kind().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Akis karari (decide_effective): AppState/ag GEREKMEZ → Ollama sonucu enjekte edilir. ──

    #[test]
    fn covered_query_uses_dictionary_and_ignores_ollama() {
        // Sozluk tam kapsadi (residual bos) → sozluk ciktisi; Ollama Some verilse bile YOK SAYILIR
        // (bu yolda cagiran Ollama'ya HIC gitmez → "cami"/"bulutlu hava" gecikmesiz).
        assert_eq!(decide_effective("cami", "mosque", true, None), "mosque");
        assert_eq!(decide_effective("bulutlu hava", "cloudy sky", true, None), "cloudy sky");
        assert_eq!(
            decide_effective("cami", "mosque", true, Some("some ollama junk".into())),
            "mosque"
        );
    }

    #[test]
    fn residual_ollama_unreachable_falls_back_to_dictionary() {
        // Residual var + Ollama erisilemez (None) → sozluk ciktisi (kismi ceviri) kullanilir.
        assert_eq!(decide_effective("büyük cami", "büyük mosque", false, None), "büyük mosque");
    }

    #[test]
    fn residual_ollama_success_used_when_clean_english() {
        // Ollama temiz Ingilizce ceviri dondu → o kullanilir (sozluk fallback'inin yerine).
        assert_eq!(
            decide_effective("büyük cami", "büyük mosque", false, Some("large mosque".into())),
            "large mosque"
        );
    }

    #[test]
    fn residual_ollama_still_turkish_is_rejected() {
        // Ollama ciktisi hala TR sinyali iceriyor (echo/ceviremedi) → sozluge dus.
        assert_eq!(
            decide_effective("büyük cami", "büyük mosque", false, Some("büyük cami".into())),
            "büyük mosque"
        );
        // Bos Ollama ciktisi → sozluge dus.
        assert_eq!(
            decide_effective("büyük cami", "büyük mosque", false, Some("   ".into())),
            "büyük mosque"
        );
    }

    #[test]
    fn empty_dictionary_output_falls_back_to_original() {
        assert_eq!(decide_effective("xyz", "  ", true, None), "xyz");
    }

    // ── Ollama yanit temizligi (clean_ollama_translation / yardimcilari; H2 parse pariti). ──

    #[test]
    fn clean_strips_label_think_and_quotes() {
        assert_eq!(clean_ollama_translation("stair plan"), "stair plan");
        assert_eq!(clean_ollama_translation("EN: stair plan"), "stair plan");
        assert_eq!(clean_ollama_translation("English - facade drawing"), "facade drawing");
        assert_eq!(clean_ollama_translation("Translation: red armchair."), "red armchair");
        assert_eq!(clean_ollama_translation("\"stair plan\""), "stair plan");
        // <think> blogu silinir, ardindan gelen cevap alinir.
        assert_eq!(
            clean_ollama_translation("<think>hmm let me think</think>\nstair plan"),
            "stair plan"
        );
        // Bastaki bos satirlar atlanir → ilk bos-olmayan satir.
        assert_eq!(clean_ollama_translation("\n\nstair plan\nextra line"), "stair plan");
    }

    #[test]
    fn clean_unclosed_think_yields_empty() {
        // num_predict kesilmis kapanmamis <think> → kullanilabilir cevap yok → bos (cagiran → None).
        assert_eq!(clean_ollama_translation("<think>reasoning cut off mid"), "");
    }

    #[test]
    fn strip_label_requires_colon_or_dash() {
        // "en"/"english" ardindan :/- yoksa etiket DEGIL → kelime korunur.
        assert_eq!(strip_translation_label("entrance hall"), "entrance hall");
        assert_eq!(strip_translation_label("english garden"), "english garden");
        assert_eq!(strip_translation_label("EN: door"), "door");
        assert_eq!(strip_translation_label("Translation - window"), "window");
    }
}
