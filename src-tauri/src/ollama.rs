//! Ollama HTTP istemcisi (YALNIZ localhost) — RAG sohbet uretimi. H2 ollamaService pariti.
//!
//! Adres cozumu (oncelik): `ARSIV_OLLAMA_BASE` env > kalici ayar (app_meta, `ollama_commands`) >
//! `OLLAMA_HOST` env (Ollama'nin kendi konvansiyonu) > varsayilan `http://127.0.0.1:11434`.
//! Hepsi localhost/operator-config (renderer/kullanici URL'i DEGIL — SSRF yuzeyi yok).
//! Rust cagriyi kendi yapar. `list_chat_models`: /api/tags (vision haric). `generate_stream`:
//! /api/generate (stream:true) NDJSON satirlarini okur → her token `on_token`'a → tam metin.

use std::cmp::Reverse;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

/// Varsayilan Ollama kok adresi. **`127.0.0.1`** (localhost DEGIL): Windows'ta `localhost` once
/// IPv6 `::1`'e cozulur, Ollama ise varsayilan IPv4 dinler → baglanti TIMEOUT (kullanici bulgusu
/// 2026-07-02). IPv4 loopback bu tuzagi atlar.
const DEFAULT_OLLAMA_BASE: &str = "http://127.0.0.1:11434";
/// Ollama'nin varsayilan portu (OLLAMA_HOST port belirtmezse).
const DEFAULT_OLLAMA_PORT: u16 = 11434;

/// Kalici Ollama adres ayari (`app_meta.ollama_base`) — acilista lib.rs setup doldurur,
/// `set_ollama_base` komutu gunceller. Modul-global (ollama fn'leri State'siz; models_root deseni).
static CONFIGURED_BASE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
fn configured_slot() -> &'static Mutex<Option<String>> {
    CONFIGURED_BASE.get_or_init(|| Mutex::new(None))
}

/// Kalici ayari set/temizle (bos → None → oto-cozume duser). Idempotent.
pub(crate) fn set_configured_base(v: Option<String>) {
    if let Ok(mut slot) = configured_slot().lock() {
        *slot = v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    }
}

/// Kalici ayarin su anki degeri (UI gosterimi + resolve).
pub(crate) fn configured_base() -> Option<String> {
    configured_slot().lock().ok().and_then(|s| s.clone())
}

/// Host bilesenini normalize et: bos / `0.0.0.0` / `localhost` / `::` → `127.0.0.1` (IPv4 loopback;
/// localhost→::1 timeout tuzagini ve "tum arayuzler" adresini baglanilabilir hale getirir).
fn rewrite_host(h: &str) -> String {
    match h.trim() {
        "" | "0.0.0.0" | "localhost" | "::" | "[::]" => "127.0.0.1".to_string(),
        other => other.to_string(),
    }
}

/// `authority`'yi (host, port)'a ayir. IPv6 literal `[..]:port` desteklenir. Port yoksa `default`.
fn split_host_port(authority: &str, default_port: u16) -> (String, u16) {
    if let Some(rest) = authority.strip_prefix('[') {
        // IPv6: "[::1]:port" veya "[::1]".
        if let Some((h, p)) = rest.split_once("]:") {
            return (format!("[{h}]"), p.parse().unwrap_or(default_port));
        }
        return (format!("[{}]", rest.trim_end_matches(']')), default_port);
    }
    match authority.rsplit_once(':') {
        Some((h, p)) => (h.to_string(), p.parse().unwrap_or(default_port)),
        None => (authority.to_string(), default_port),
    }
}

/// Serbest bir adres/host degerini `scheme://host:port` base URL'ye cevir (saf → test edilebilir).
/// Kabul: `127.0.0.1:11435`, `0.0.0.0:11435`, `:11435`, `localhost:11435`, `http://127.0.0.1:11435`,
/// `[::1]:11435`, port'suz `myhost`. Sema yoksa `http`. Port yoksa `default_port`. Bos → None.
fn to_base_url(raw: &str, default_port: u16) -> Option<String> {
    let s = raw.trim().trim_end_matches('/');
    if s.is_empty() {
        return None;
    }
    let (scheme, rest) = match s.split_once("://") {
        Some((sc, r)) => (sc.to_string(), r.to_string()),
        None => ("http".to_string(), s.to_string()),
    };
    let authority = rest.split('/').next().unwrap_or(&rest);
    let (host, port) = split_host_port(authority, default_port);
    Some(format!("{scheme}://{}:{}", rewrite_host(&host), port))
}

/// Etkin base URL + kaynagi (saf → test): ARSIV_OLLAMA_BASE > kalici ayar > OLLAMA_HOST > varsayilan.
fn pick_base(
    arsiv_env: Option<String>,
    configured: Option<String>,
    ollama_host: Option<String>,
) -> (String, &'static str) {
    if let Some(b) = arsiv_env.as_deref().and_then(|v| to_base_url(v, DEFAULT_OLLAMA_PORT)) {
        return (b, "env");
    }
    if let Some(b) = configured.as_deref().and_then(|v| to_base_url(v, DEFAULT_OLLAMA_PORT)) {
        return (b, "setting");
    }
    if let Some(b) = ollama_host.as_deref().and_then(|v| to_base_url(v, DEFAULT_OLLAMA_PORT)) {
        return (b, "ollama_host");
    }
    (DEFAULT_OLLAMA_BASE.to_string(), "default")
}

/// Etkin base URL + kaynak (canli: env + kalici-ayar-global + OLLAMA_HOST). UI durum'u kullanir.
pub(crate) fn base_and_source() -> (String, &'static str) {
    pick_base(
        std::env::var("ARSIV_OLLAMA_BASE").ok(),
        configured_base(),
        std::env::var("OLLAMA_HOST").ok(),
    )
}

/// Ollama kok adresi (istemci cagrilari kullanir).
fn ollama_base() -> String {
    base_and_source().0
}

/// Yerel bir Ollama sunucusunun guvenle baslatilabilecegi `host:port`. Yalniz HTTP loopback
/// kabul edilir: uzak/HTTPS adresleri asla bu uygulama tarafindan baslatilmaz.
fn local_serve_authority(base: &str) -> Option<&str> {
    let authority = base.strip_prefix("http://")?;
    (authority.starts_with("127.0.0.1:") || authority.starts_with("[::1]:")).then_some(authority)
}

/// Windows kurucusunun standart yolu + PATH'teki olasi kurulum. Dosya sistemi yoklamasi yapar;
/// komut calistirmaz. Bulunamayan kurulum, UI'da "kurulu degil" olarak ayrilir.
fn installed_ollama_executable() -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        "ollama.exe"
    } else {
        "ollama"
    };
    let mut candidates = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local)
                .join("Programs")
                .join("Ollama")
                .join(exe),
        );
    }
    for key in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(dir) = std::env::var_os(key) {
            candidates.push(PathBuf::from(dir).join("Ollama").join(exe));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(exe)));
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// Ollama erisilemezken UI'nin ayirt edecegi durum + baslatma uygunlugu.
pub(crate) fn unavailable_service_state() -> (&'static str, bool) {
    if local_serve_authority(&ollama_base()).is_none() {
        return ("unreachable", false);
    }
    if installed_ollama_executable().is_some() {
        ("stopped", true)
    } else {
        ("not_installed", false)
    }
}

/// Yerel, kurulu Ollama hizmetini baslat. Yalniz loopback HTTP adresi kabul edilir; uygulama
/// uzaktaki bir Ollama'ya ya da HTTPS endpoint'ine islem yapmaz. Cagiran ayri ayri `ai_status`
/// yoklayarak hazirligi gorur; yeni surecin ayaga kalkmasi beklenmez.
pub(crate) fn start_local_ollama() -> Result<(), String> {
    let base = ollama_base();
    let authority = local_serve_authority(&base)
        .ok_or_else(|| "Yalniz yerel HTTP Ollama adresi baslatilabilir".to_string())?;
    let executable = installed_ollama_executable()
        .ok_or_else(|| "Bu bilgisayarda Ollama kurulumu bulunamadi".to_string())?;

    let mut command = Command::new(executable);
    command
        .arg("serve")
        // Kalici ayar/OLLAMA_HOST farkli yerel portu isaret ediyorsa yeni surec de AYNI portta
        // dinler; 11434'e sessizce donup UI'yi "kapali" birakmaz.
        .env("OLLAMA_HOST", authority)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // GUI uygulamasindan serve calisirken gecici bir konsol penceresi acilmasin.
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
        .spawn()
        .map_err(|e| format!("Ollama baslatilamadi: {e}"))?;
    Ok(())
}

/// `detect` icin aday base listesi: OLLAMA_HOST-turevi + `127.0.0.1:11434` + `127.0.0.1:11435` (dedup).
pub(crate) fn detect_candidates() -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    if let Some(b) =
        std::env::var("OLLAMA_HOST").ok().as_deref().and_then(|v| to_base_url(v, DEFAULT_OLLAMA_PORT))
    {
        out.push(b);
    }
    for p in [DEFAULT_OLLAMA_PORT, 11435] {
        let b = format!("http://127.0.0.1:{p}");
        if !out.contains(&b) {
            out.push(b);
        }
    }
    out
}

/// Bir base URL'yi yokla: `/api/tags` → Some(model_sayisi) erisilebilirse; yoksa None. Kisa timeout.
pub(crate) fn probe_base(base: &str) -> Option<usize> {
    let resp = agent().get(&format!("{base}/api/tags")).timeout(Duration::from_secs(2)).call().ok()?;
    let json: Value = resp.into_json().ok()?;
    Some(json.get("models").and_then(Value::as_array).map(|a| a.len()).unwrap_or(0))
}
/// Varsayilan sohbet modeli (H2 DEFAULT_CHAT_MODEL) — istemci secmezse.
pub const DEFAULT_CHAT_MODEL: &str = "qwen3:8b";

/// **Olculmus-iyi** vision modeli: hem "yuklu model listesi alinamadi" son-caresi hem de
/// kullaniciya gosterilen `ollama pull ...` onerisi bu tek kaynaktan gelir.
///
/// Eski deger `llava` idi (H2 paritesi). Olcum (2026-08-07, `vision_bench`) llava'nin istenen
/// etiket bicimini URETMEDIGINI gosterdi → `VisionAnalysis::is_usable()` elemesine takilir, yani
/// "varsayilan" her gorseli bosa harcardi. Bkz [`vision_quality`].
///
/// ⚠️ Normal calismada bu sabite DUSULMEZ: model [`recommend_vision`] ile yuklu modeller
/// arasindan SECILIR (`vision_commands::resolve_vision_model`).
pub const DEFAULT_VISION_MODEL: &str = "qwen2.5vl:3b";

/// Vision-only model on-ekleri (families bilgisi gelmezse fallback; chat listesinden eler).
const VISION_PREFIXES: &[&str] =
    &["llava", "moondream", "llama3.2-vision", "minicpm-v", "bakllava", "qwen2-vl", "qwen2.5vl"];

fn is_vision_model(name: &str) -> bool {
    let l = name.trim().to_ascii_lowercase();
    VISION_PREFIXES.iter().any(|p| l.starts_with(p))
}

/// Bir vision modelinin **olculmus cikti kalitesi**. Siralama ONEMLI (`Ord`): buyuk = daha iyi.
///
/// **Neden boyut degil kalite?** Olcum (2026-08-07, `vision_bench`; gercek arsiv gorselleri +
/// uretimin AYNI istemi): en KUCUK model (`moondream`, 1.7 GB) her gorsele `" [0"` dondu; en BUYUK
/// model (`llava`, 4.7 GB) istemin secenek menusunu tekrarladi, 9 etiketten 8'i eksikti. Ikisi de
/// `is_usable()` elemesine takilir → DB'ye HICBIR sey yazilmaz, kosu bosa gider. Ortadaki
/// `qwen2.5vl:3b` (3.2 GB) 9/9 etiketi duzgun Turkce ve dogal bitisle uretti.
///
/// Yani "buyuk = daha yetenekli" varsayimi olcumle CURUDU: boyuta gore siralamak listenin **her iki
/// ucunda da** ise yaramaz model seciyordu (yuksek VRAM → llava, dusuk VRAM/CPU → moondream).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum VisionQuality {
    /// Olculdu: istenen yapisal ciktiyi URETMEDI → analizi DB'ye yazilamaz. En son tercih.
    Unusable,
    /// Olculmedi. Varsayilan sinif — kanit yoklugu kotu kanit DEGILDIR: kanitlanmis-kotudan iyi,
    /// kanitlanmis-iyiden kotu sayilir.
    Untested,
    /// Olculdu: istenen etiket bicimini eksiksiz, dogal bitisle uretti.
    Proven,
}

impl VisionQuality {
    /// Kararli kod (DTO'da tasinir; UI i18n ile cumleye cevirir). Metin DEGISMEZ — UI'ya bagli.
    pub fn code(self) -> &'static str {
        match self {
            Self::Proven => "proven",
            Self::Untested => "untested",
            Self::Unusable => "unusable",
        }
    }
}

/// Olculmus-IYI model on-ekleri. ⚠️ Buraya bir aile eklemek icin `vision_bench` ile **gercek
/// olcum** gerekir — tahminle/itibarla eklenmez (bu listenin tum degeri olcume dayanmasidir).
const PROVEN_VISION_PREFIXES: &[&str] = &["qwen2.5vl"];

/// Olculmus-KOTU model on-ekleri. `llava`/`bakllava`: istemin secenek menusunu tekrarlar, istenen
/// etiketleri uretmez. `moondream`: her gorsele `" [0"` doner.
const UNUSABLE_VISION_PREFIXES: &[&str] = &["llava", "bakllava", "moondream"];

/// Model adindan olculmus kalite sinifi (aile on-eki; etiket/surum farki onemsiz → `starts_with`).
pub fn vision_quality(name: &str) -> VisionQuality {
    let l = name.trim().to_ascii_lowercase();
    if PROVEN_VISION_PREFIXES.iter().any(|p| l.starts_with(p)) {
        VisionQuality::Proven
    } else if UNUSABLE_VISION_PREFIXES.iter().any(|p| l.starts_with(p)) {
        VisionQuality::Unusable
    } else {
        VisionQuality::Untested
    }
}

/// Connect-timeout'lu agent (Ollama kapaliysa hizli hata; stream okumasi kelepcelenmez).
fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(5)).build()
}

/// Gorsel analizde **SESSIZLIK** tavani (saniye): iki token arasinda bu kadar sure hic veri
/// gelmezse cagri kesilir. Toplam sureyi SINIRLAMAZ.
///
/// Gerekce (olcum 2026-08-07): eski tasarim tek bir MUTLAK 120 sn duvariydi ve calisan tek model
/// (`qwen2.5vl:3b`, 235 sn/gorsel) bu duvarin ALTINDA kalamiyordu → saglikli model her gorselde
/// `timeout` veriyordu. Duvari buyutmek makineye baglidir (ayni model RTX 3060'ta hizli, GTX
/// 1050 Ti'de dakikalarca surer; CPU-only'de cok daha uzun) → hangi sabit secilse bir makinede
/// YANLIS olur. Dogru olcut sure DEGIL, **ilerleme**: `stream:true` ile model her token'i aninda
/// yollar; 2 jeton/sn ile uretim yapan model CANLIDIR, cokmus/asili bir `llama-server` ise hic
/// veri uretmez. Boylece yavas ama calisan model beklenir, gercekten asili kalan hizla elenir.
const VISION_IDLE_TIMEOUT_SECS: u64 = 90;

/// Gorsel analizde MUTLAK tavan (saniye) — yalniz emniyet supabi (patolojik dongu/bitmeyen uretim
/// kosuyu sonsuz kilitlemesin). Normal calismada devreye GIRMEZ; sinir pratikte `num_predict`tir.
const VISION_MAX_TOTAL_SECS: u64 = 1800;

/// Zaman asimi ayarlarinin env ile gecersiz kilinmasi (`vision_bench` ve saha teshisi icin;
/// gecersiz/0 deger → varsayilan). Kullanici-yuzu ayar DEGIL.
fn env_secs(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(default)
}

/// Vision akisi icin agent: baglanti kisa, **okuma** timeout'u = sessizlik tavani (her soket
/// okumasina ayri ayri uygulanir → token akarken saat sifirlanir; yalnizca SESSIZLIK biriktirir).
fn vision_agent(idle_secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout_read(Duration::from_secs(idle_secs))
        .build()
}

/// Vision akisinin TEK NDJSON satirini isle: metni `out`'a ekle, `done` ise `Ok(true)`.
/// Ollama akis ORTASINDA da hata yollayabilir (`{"error": "..."}`) — o zaman `Err` (cagiran bunu
/// siniflandirir: `gpu_driver` / `context_overflow` / ...). Ayristirilamayan satir SESSIZCE atlanir
/// (kesik/kismi satir akisi bozmasin). Saf fonksiyon → birim testli.
fn consume_vision_stream_line(line: &str, out: &mut String) -> Result<bool, String> {
    let line = line.trim();
    if line.is_empty() {
        return Ok(false);
    }
    let Ok(v) = serde_json::from_str::<Value>(line) else { return Ok(false) };
    // Akis-ici hata: cokme/baglam tasmasi burada da gelebilir → ham govdeyi yuzeye cikar.
    if let Some(err) = v.get("error").and_then(Value::as_str) {
        return Err(format!("Ollama vision hatasi: {err}"));
    }
    if let Some(tok) = v.get("message").and_then(|m| m.get("content")).and_then(Value::as_str) {
        out.push_str(tok);
    }
    Ok(v.get("done").and_then(Value::as_bool).unwrap_or(false))
}

/// `/api/tags` → yuklu (model-adi, vision-mi, boyut-bayt) listesi. chat/vision/all listeleyiciler
/// paylasir (tek HTTP cagri). Ollama calismiyorsa Err. Vision tespit: families 'clip' VEYA ad on-eki.
/// `size`: model dosya boyutu (bayt; vision oto-onerisinde VRAM'e sigma karari icin — bkz
/// [`recommend_vision`]). Alan yoksa 0.
fn fetch_models() -> Result<Vec<(String, bool, u64)>, String> {
    let base = ollama_base();
    let resp = agent()
        .get(&format!("{base}/api/tags"))
        .timeout(Duration::from_secs(5))
        .call()
        .map_err(|e| format!("Ollama'ya baglanilamadi: {e}"))?;
    let json: Value = resp.into_json().map_err(|e| e.to_string())?;
    let models = json.get("models").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut out = Vec::new();
    for m in models {
        let Some(name) = m.get("name").and_then(Value::as_str) else { continue };
        let families: Vec<String> = m
            .get("details")
            .and_then(|d| d.get("families"))
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_ascii_lowercase)).collect())
            .unwrap_or_default();
        let is_vision = families.iter().any(|f| f == "clip") || is_vision_model(name);
        let size = m.get("size").and_then(Value::as_u64).unwrap_or(0);
        out.push((name.to_string(), is_vision, size));
    }
    Ok(out)
}

/// Ollama'da yuklu **chat** modelleri (vision haric). Ollama calismiyorsa Err (UI uyarir).
pub fn list_chat_models() -> Result<Vec<String>, String> {
    Ok(fetch_models()?.into_iter().filter(|(_, v, _)| !v).map(|(n, _, _)| n).collect())
}

/// Hem chat hem vision modelleri tek cagrida (AI ayar paneli durum'u). `(chat, vision)`.
pub fn list_all_models() -> Result<(Vec<String>, Vec<String>), String> {
    let all = fetch_models()?;
    let chat = all.iter().filter(|(_, v, _)| !*v).map(|(n, _, _)| n.clone()).collect();
    let vision = all.into_iter().filter(|(_, v, _)| *v).map(|(n, _, _)| n).collect();
    Ok((chat, vision))
}

/// Yuklu **vision** modelleri BOYUTLARIYLA (ad, boyut-bayt) — GPU'ya gore oto-oneri icin
/// ([`recommend_vision`]). Ollama calismiyorsa Err.
pub fn list_vision_models_with_size() -> Result<Vec<(String, u64)>, String> {
    Ok(fetch_models()?.into_iter().filter(|(_, v, _)| *v).map(|(n, _, s)| (n, s)).collect())
}

/// VRAM (MB) + yuklu vision modelleri (ad, boyut-bayt) → **onerilen model adi**. Model yoksa `None`.
///
/// **Siralama olcutu (sirayla):**
/// 1. **Olculmus KALITE** ([`vision_quality`]) — ise yaramaz cikti ureten model, ne kadar hizli
///    olursa olsun, kullanilabilir cikti uretenden ONCE gelmez.
/// 2. **VRAM'e sigma** — butce = `VRAM - 1536MB` (ekran + KV cache + compute buffer payi).
/// 3. Sigan modeller arasinda **en BUYUK** (ayni kalite siniginda daha yetenekli sayilir); hicbiri
///    sigmiyorsa **en KUCUK** (en az tasan → en hizli calisan).
///
/// **Kalite neden VRAM'in ONUNDE?** Eskiden olcut yalniz boyuttu ("sigan en buyuk") ve bu, olcume
/// gore listenin her iki ucunda da ise yaramaz model seciyordu: 12 GB'ta `llava` (cop), 4 GB ve
/// CPU'da `moondream` (cop). Oysa VRAM'e SIGMAYAN saglikli bir model yalnizca **yavastir**
/// (agirliklarin bir kismi CPU'ya taser) — `qwen2.5vl:3b` 4 GB'lik GTX 1050 Ti'de 235 sn/gorsel
/// surdu ama 9/9 etiketi DOGRU uretti. Zaman asimi artik mutlak duvar degil sessizlik olcusu
/// oldugundan (bkz `VISION_IDLE_TIMEOUT_SECS`) yavas model artik hata vermez → "yavas ama dogru",
/// "hizli ama cop"tan kesin olarak iyidir. Once kalite ele, sonra hiz.
pub fn recommend_vision(vram_mb: Option<u32>, models: &[(String, u64)]) -> Option<String> {
    // Model agirliklarina ayrilan butce. VRAM bilinmiyorsa (NVIDIA yok / CPU) butce 0 → hicbir
    // model "sigmis" sayilmaz, karar kaliteye ve kucukluge duser (CPU'da kucuk daha kullanilir).
    let budget = vram_mb.map_or(0, |v| u64::from(v.saturating_sub(1536)) * 1024 * 1024);
    let mut ranked: Vec<&(String, u64)> = models.iter().collect();
    // Artan siralama, en iyi BASTA: her bilesen "kucuk = daha iyi" olacak sekilde ters cevrilir.
    ranked.sort_by_cached_key(|(name, size)| {
        let fits = budget > 0 && *size <= budget;
        (
            Reverse(vision_quality(name)), // 1) olculmus kalite (buyuk iyi → ters)
            Reverse(fits),                 // 2) VRAM'e sigan once (true iyi → ters)
            if fits { u64::MAX - *size } else { *size }, // 3) siganda buyuk, sigmayanda kucuk
            name.clone(),                  // 4) tam esitlikte deterministik (alfabetik ilk)
        )
    });
    ranked.first().map(|(n, _)| n.clone())
}

/// /api/generate (stream:true) → NDJSON satir-satir; her `response` token'i `on_token`'a verir,
/// tam metni dondur. `num_ctx` prompt uzunluguna gore kabaca (char/4 + tampon). Sicaklik dusuk
/// (0.2 — arsiv asistani: tutarli/az-uydurma). `done:true` satirinda biter.
pub fn generate_stream(
    model: &str,
    prompt: &str,
    on_token: &mut dyn FnMut(&str),
    // Iptal: her satirdan once cagirilir; `true` donerse akis erken kesilir (o ana kadarki
    // kismi metin dondurulur). Cagiran (rag_chat) global CHAT_STOP bayragini kontrol eder.
    should_stop: &dyn Fn() -> bool,
) -> Result<String, String> {
    let num_ctx = ((prompt.len() / 4) + 1024).clamp(2048, 8192);
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": true,
        "options": { "num_ctx": num_ctx, "temperature": 0.2 }
    });
    let base = ollama_base();
    let resp = agent()
        .post(&format!("{base}/api/generate"))
        .send_json(body)
        .map_err(|e| format!("Ollama uretim hatasi: {e}"))?;

    let reader = BufReader::new(resp.into_reader());
    let mut full = String::new();
    for line in reader.lines() {
        // Kullanici "Durdur" dediyse akisi kes → o ana kadarki kismi cevabi dondur (uzun uretim
        // iptali; token'lar arasi kontrol edilir → akan uretimde aninda etki eder).
        if should_stop() {
            break;
        }
        let line = line.map_err(|e| e.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
        if let Some(tok) = v.get("response").and_then(Value::as_str) {
            if !tok.is_empty() {
                on_token(tok);
                full.push_str(tok);
            }
        }
        if v.get("done").and_then(Value::as_bool).unwrap_or(false) {
            break;
        }
    }
    Ok(full)
}

/// Ollama'da yuklu **VISION** modelleri (yalniz; list_chat_models'in TERSI). Gorsel-analiz
/// model secici. Ollama calismiyorsa Err. families 'clip' VEYA ad on-eki → vision.
pub fn list_vision_models() -> Result<Vec<String>, String> {
    Ok(fetch_models()?.into_iter().filter(|(_, v, _)| *v).map(|(n, _, _)| n).collect())
}

/// Bir gorseli VISION modeline yolla → metin yanit (H2 analyzeDWGContent `/api/chat` paritesi).
/// `image` ham thumbnail baytlari → base64. Cagri UZUNDUR (yavas GPU'da dakikalar) → `stream:true`
/// ile NDJSON okunur ve sinir **sessizlik** olarak uygulanir ([`VISION_IDLE_TIMEOUT_SECS`]); toplam
/// sureye mutlak duvar yoktur (yalniz [`VISION_MAX_TOTAL_SECS`] emniyet supabi). Kilit TUTULMAZ
/// (cagiran kisa db kilidini ayri alir). Bos/eksik model → Err (cagiran failed sayar).
pub fn analyze_image(model: &str, image: &[u8], prompt: &str) -> Result<String, String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    let b64 = STANDARD.encode(image);
    // num_predict: cikti tokenlarini sinirla → CPU'da (GPU'ya sigmayan model) her token yavas →
    // kisa cikti = hizlanma. Prompt sirasinda METİN (OCR) EN SONDA → kesilirse yalniz OCR kuyrugu
    // gider, yapisal arama sinyalleri (tur/aciklama/elemanlar) tam kalir. **1024** (512 degil):
    // kullanici geri-bildirimi (2026-07-11) "analiz cikti yeterince KAPSAMLI degil" → 512 zengin
    // DETAYLI aciklama + 12-20 anahtar-kelime + OCR'i kesiyordu; 1024 tam betme yer acar (analiz
    // KAPSAMLI/istek-uzeri, blanket degil → ekstra token maliyeti kabul edilebilir). temp dusuk (tutarli).
    // num_ctx 8192: num_ctx'i ONURLANDIRAN modellerde (llava vb.) buyuk DWG promptuna (sablon + ~66
    // terim + binary_context) pay verir. AMA kucuk-pencereli modeller (moondream = 2048) num_ctx'i
    // YOK SAYAR → zengin prompt 2048'i asinca Ollama "exceed_context_size" (HTTP 400) doner; bu durum
    // CAGIRANDA (vision_commands) context'siz lean-retry ile ele alinir. (Bulgular 2026-06-22 / 2026-07-07.)
    // stream:true → token'lar geldikce akar. Sonuc metni ayni (parcalar birlestirilir), ama artik
    // "model calisiyor mu" sorusu ILERLEME ile yanitlanabilir (bkz VISION_IDLE_TIMEOUT_SECS).
    let body = serde_json::json!({
        "model": model,
        "stream": true,
        "messages": [{ "role": "user", "content": prompt, "images": [b64] }],
        "options": { "temperature": 0.2, "num_predict": 1024, "num_ctx": 8192 }
    });
    let idle_secs = env_secs("ARSIV_VISION_IDLE_TIMEOUT_SECS", VISION_IDLE_TIMEOUT_SECS);
    let max_total_secs = env_secs("ARSIV_VISION_MAX_SECS", VISION_MAX_TOTAL_SECS);
    post_vision_chat(&ollama_base(), body, idle_secs, max_total_secs)
}

/// Vision `/api/chat` akisini kur ve TUKET (base + sinirlar disaridan → testte sahte sunucuya
/// yonlendirilebilir; env/global durum okumaz). Donus: birlestirilmis yanit metni.
fn post_vision_chat(
    base: &str,
    body: Value,
    idle_secs: u64,
    max_total_secs: u64,
) -> Result<String, String> {
    let resp = match vision_agent(idle_secs).post(&format!("{base}/api/chat")).send_json(body) {
        Ok(r) => r,
        // HTTP hatasinda Ollama'nin ACIKLAYICI govdesini yuzeye cikar (yalniz "status code 400" opak
        // kalmasin; caginin lean-retry tetigi de bu metin — "exceed_context_size").
        Err(ureq::Error::Status(code, r)) => {
            let detail = r.into_string().unwrap_or_default();
            return Err(format!("Ollama vision hatasi: status {code}: {detail}"));
        }
        Err(e) => return Err(format!("Ollama vision hatasi: {e}")),
    };

    let started = Instant::now();
    let reader = BufReader::new(resp.into_reader());
    let mut full = String::new();
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            // Soket okuma timeout'u = idle_secs boyunca HIC veri gelmedi. Metin "timed out" icerir
            // → `classify_vision_error` bunu `timeout` sinifina koyar (UI tek cumleye cevirir).
            Err(e) if is_timeout_io(&e) => {
                return Err(format!(
                    "Ollama vision hatasi: model {idle_secs} sn boyunca hic yanit uretmedi (timed out)"
                ));
            }
            Err(e) => return Err(format!("Ollama vision hatasi: akis kesildi: {e}")),
        };
        if consume_vision_stream_line(&line, &mut full)? {
            break;
        }
        // Emniyet supabi — normalde devreye girmez (bkz VISION_MAX_TOTAL_SECS).
        if started.elapsed() > Duration::from_secs(max_total_secs) {
            return Err(format!(
                "Ollama vision hatasi: analiz mutlak sinirini asti ({max_total_secs} sn; timed out)"
            ));
        }
    }
    Ok(full)
}

/// Bir akis okuma hatasi ZAMAN ASIMI mi? Windows'ta soket okuma timeout'u `TimedOut` YERINE
/// `WouldBlock` olarak da yuzeye cikabilir → ikisi de sayilir.
fn is_timeout_io(e: &std::io::Error) -> bool {
    matches!(e.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock)
}

/// /api/generate (stream:false) — KISA yardimci uretim (rerank / query-enrich). Cagiran
/// `temperature`, `num_predict` (uretim ust siniri) ve `timeout_secs` belirler. Tek JSON yanit →
/// `response` (kirpilmis). Streaming gerekmez (cikti kucuk + tani/sira icin tam metin yeterli).
pub fn generate(
    model: &str,
    prompt: &str,
    temperature: f64,
    num_predict: i64,
    timeout_secs: u64,
) -> Result<String, String> {
    let num_ctx = ((prompt.len() / 4) + 1024).clamp(2048, 8192);
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "options": { "num_ctx": num_ctx, "temperature": temperature, "num_predict": num_predict }
    });
    let base = ollama_base();
    let resp = agent()
        .post(&format!("{base}/api/generate"))
        .timeout(Duration::from_secs(timeout_secs))
        .send_json(body)
        .map_err(|e| format!("Ollama uretim hatasi: {e}"))?;
    let json: Value = resp.into_json().map_err(|e| e.to_string())?;
    Ok(json.get("response").and_then(Value::as_str).unwrap_or("").trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::{
        consume_vision_stream_line, is_vision_model, local_serve_authority, pick_base,
        post_vision_chat, recommend_vision, to_base_url, vision_quality, VisionQuality,
    };

    /// 200 + akis basliklari doner, sonra **hic govde yollamaz** (asili `llama-server` benzetimi).
    /// Testin sonunda dinleyici dusurulur. Donus: base URL.
    fn spawn_silent_ollama() -> String {
        use std::io::Write;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("dinleyici acilamadi");
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            if let Ok((mut sock, _)) = listener.accept() {
                let _ = sock.write_all(
                    b"HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\n\
                      Transfer-Encoding: chunked\r\n\r\n",
                );
                let _ = sock.flush();
                // Bilerek SESSIZ kal: istemcinin sessizlik tavani devreye girmeli.
                std::thread::sleep(std::time::Duration::from_secs(20));
            }
        });
        format!("http://127.0.0.1:{port}")
    }

    /// Baglanti KURULUR ve HTTP 200 gelir, ama tek token uretilmez → sessizlik tavani cagriyi
    /// kesmeli ve hata `timeout` sinifina girmeli. (Eski tasarimda bu ayrim YOKTU: sinir mutlak
    /// sureydi, calisan yavas model de asili sunucu da ayni sekilde kesiliyordu.)
    #[test]
    fn silent_server_trips_idle_timeout() {
        let base = spawn_silent_ollama();
        let started = std::time::Instant::now();
        let err = post_vision_chat(&base, serde_json::json!({"model": "x"}), 1, 30).unwrap_err();
        assert!(err.contains("timed out"), "timeout metni bekleniyordu: {err}");
        assert_eq!(crate::vision::classify_vision_error(&err), "timeout");
        // Sessizlik tavani (1 sn) uygulandi → mutlak tavani (30 sn) BEKLEMEDI.
        assert!(started.elapsed().as_secs() < 15, "cok gec kesildi: {:?}", started.elapsed());
    }

    /// Akis parcalari birlestirilir; `done` satiri okumayi bitirir. (stream:false donemindeki tek
    /// govdeli yanit ile AYNI metin cikmali — degisen yalniz tasima.)
    #[test]
    fn vision_stream_lines_accumulate_until_done() {
        let mut out = String::new();
        for (line, expect_done) in [
            (r#"{"message":{"content":"TUR: "},"done":false}"#, false),
            (r#"{"message":{"content":"plan"},"done":false}"#, false),
            (r#"{"message":{"content":""},"done":true}"#, true),
        ] {
            assert_eq!(consume_vision_stream_line(line, &mut out).unwrap(), expect_done);
        }
        assert_eq!(out, "TUR: plan");
    }

    /// Kesik/bos satir akisi BOZMAZ (atlanir) — kismi NDJSON satiri analizi dusurmesin.
    #[test]
    fn vision_stream_skips_unparsable_lines() {
        let mut out = String::new();
        assert!(!consume_vision_stream_line("", &mut out).unwrap());
        assert!(!consume_vision_stream_line(r#"{"message":{"conte"#, &mut out).unwrap());
        assert!(!consume_vision_stream_line(r#"{"message":{"content":"A"}}"#, &mut out).unwrap());
        assert_eq!(out, "A");
    }

    /// Akis ORTASINDA gelen hata (llama-server cokmesi / baglam tasmasi) Err olur ve ham govdeyi
    /// tasir → `classify_vision_error` sinifi (gpu_driver / context_overflow) bulabilsin.
    #[test]
    fn vision_stream_surfaces_mid_stream_error() {
        let mut out = String::new();
        let err = consume_vision_stream_line(
            r#"{"error":"llama-server ... CUDA error: unsupported PTX"}"#,
            &mut out,
        )
        .unwrap_err();
        assert!(err.contains("CUDA"), "ham govde kaybolmamali: {err}");
        assert_eq!(crate::vision::classify_vision_error(&err), "gpu_driver");
    }

    #[test]
    fn only_local_http_bases_can_be_started() {
        assert_eq!(
            local_serve_authority("http://127.0.0.1:11434"),
            Some("127.0.0.1:11434")
        );
        assert_eq!(
            local_serve_authority("http://[::1]:11434"),
            Some("[::1]:11434")
        );
        assert_eq!(local_serve_authority("http://localhost:11434"), None);
        assert_eq!(local_serve_authority("https://127.0.0.1:11434"), None);
        assert_eq!(local_serve_authority("http://ollama.example:11434"), None);
    }

    #[test]
    fn vision_model_detection() {
        assert!(is_vision_model("llava:13b"));
        assert!(is_vision_model("LLaVA"));
        assert!(is_vision_model("moondream"));
        assert!(!is_vision_model("qwen3:8b"));
        assert!(!is_vision_model("llama3.1"));
    }

    #[test]
    fn vision_quality_classes_follow_measurement() {
        // Olculmus-iyi: aile on-eki yeter (etiket/surum farki onemsiz).
        assert_eq!(vision_quality("qwen2.5vl:3b"), VisionQuality::Proven);
        assert_eq!(vision_quality("qwen2.5vl:7b"), VisionQuality::Proven);
        // Olculmus-kotu: llava (istem menusunu tekrarlar) + bakllava + moondream (`" [0"`).
        assert_eq!(vision_quality("llava:latest"), VisionQuality::Unusable);
        assert_eq!(vision_quality("LLaVA:13b"), VisionQuality::Unusable);
        assert_eq!(vision_quality("bakllava"), VisionQuality::Unusable);
        assert_eq!(vision_quality("moondream"), VisionQuality::Unusable);
        // Olculmemis: kanit yoklugu kotu kanit degil → ortada.
        assert_eq!(vision_quality("minicpm-v"), VisionQuality::Untested);
        assert_eq!(vision_quality("llama3.2-vision"), VisionQuality::Untested);
        // Sinif sirasi: Proven > Untested > Unusable (siralamanin dayanagi).
        assert!(VisionQuality::Proven > VisionQuality::Untested);
        assert!(VisionQuality::Untested > VisionQuality::Unusable);
    }

    #[test]
    fn recommend_vision_prefers_measured_quality_over_size() {
        // Gercek boyutlar (bayt): moondream 1.7GB, qwen2.5vl:3b 3.2GB, llava 4.7GB.
        let gb = |g: f64| (g * 1_000_000_000.0) as u64;
        let models = vec![
            ("moondream".to_string(), gb(1.7)),
            ("qwen2.5vl:3b".to_string(), gb(3.2)),
            ("llava:latest".to_string(), gb(4.7)),
        ];
        // Model yoksa → None.
        assert_eq!(recommend_vision(Some(8192), &[]), None);
        // 12 GB (3060, bu makine): hepsi sigar → ESKIDEN en buyuk (llava, cop) secilirdi;
        // artik olculmus-iyi olan kazanir.
        assert_eq!(recommend_vision(Some(12288), &models).as_deref(), Some("qwen2.5vl:3b"));
        // 8 GB (3070): ayni — llava sigsa da kalite once gelir.
        assert_eq!(recommend_vision(Some(8192), &models).as_deref(), Some("qwen2.5vl:3b"));
        // 4 GB (1050 Ti): butce ~2.56GB → yalniz moondream sigar, ama moondream cop uretiyor.
        // Sigmayan qwen SECILIR: yalnizca yavaslar (olculdu: 235 sn/gorsel) ama DOGRU calisir —
        // zaman asimi artik sessizlik olcusu oldugu icin yavaslik hata degil.
        assert_eq!(recommend_vision(Some(4096), &models).as_deref(), Some("qwen2.5vl:3b"));
        // Hicbiri sigmaz (2 GB) → yine kalite once.
        assert_eq!(recommend_vision(Some(2048), &models).as_deref(), Some("qwen2.5vl:3b"));
        // NVIDIA yok / CPU (None) → ESKIDEN en kucuk (moondream, cop); artik qwen.
        assert_eq!(recommend_vision(None, &models).as_deref(), Some("qwen2.5vl:3b"));
    }

    #[test]
    fn recommend_vision_falls_back_within_quality_class() {
        let gb = |g: f64| (g * 1_000_000_000.0) as u64;
        // Olculmus-iyi model YOKLUGUNDA: olculmemis (minicpm-v) olculmus-kotuyu (llava) yener,
        // boyutu kucuk olsa bile.
        let no_proven = vec![
            ("llava:latest".to_string(), gb(4.7)),
            ("minicpm-v".to_string(), gb(5.5)),
            ("moondream".to_string(), gb(1.7)),
        ];
        assert_eq!(recommend_vision(Some(12288), &no_proven).as_deref(), Some("minicpm-v"));
        // minicpm-v (5.5) butceye sigmasa bile (6 GB → butce ~4.5GB) kalite once gelir.
        assert_eq!(recommend_vision(Some(6144), &no_proven).as_deref(), Some("minicpm-v"));

        // YALNIZ olculmus-kotular kurulu: eski boyut heuristigi devreye girer (hicbiri iyi degil,
        // ama en azindan duzyazi ureten buyugu). Kullaniciya UI uyarisi bundan tetiklenir.
        let only_bad =
            vec![("llava:latest".to_string(), gb(4.7)), ("moondream".to_string(), gb(1.7))];
        assert_eq!(recommend_vision(Some(12288), &only_bad).as_deref(), Some("llava:latest"));
        // Dusuk VRAM'de hicbiri sigmiyorsa: ayni siniftalar → en KUCUK (en az tasan).
        assert_eq!(recommend_vision(Some(2048), &only_bad).as_deref(), Some("moondream"));
    }

    #[test]
    fn recommend_vision_is_deterministic_on_full_tie() {
        // Ayni kalite + ayni boyut → giris SIRASINDAN bagimsiz, alfabetik ilk (kararli oneri:
        // ayni makinede her acilista ayni model onerilmeli).
        let a = vec![("minicpm-v".to_string(), 100), ("llama3.2-vision".to_string(), 100)];
        let b = vec![("llama3.2-vision".to_string(), 100), ("minicpm-v".to_string(), 100)];
        assert_eq!(recommend_vision(Some(12288), &a), recommend_vision(Some(12288), &b));
        assert_eq!(recommend_vision(Some(12288), &a).as_deref(), Some("llama3.2-vision"));
    }

    #[test]
    fn to_base_url_normalizes_forms() {
        let b = |s: &str| to_base_url(s, 11434);
        assert_eq!(b("127.0.0.1:11435").as_deref(), Some("http://127.0.0.1:11435"));
        // localhost / 0.0.0.0 / bos-host → 127.0.0.1 (IPv6 tuzagi + tum-arayuz baglanilabilir).
        assert_eq!(b("localhost:11435").as_deref(), Some("http://127.0.0.1:11435"));
        assert_eq!(b("0.0.0.0:11435").as_deref(), Some("http://127.0.0.1:11435"));
        assert_eq!(b(":11435").as_deref(), Some("http://127.0.0.1:11435"));
        // Port yok → default_port; sondaki '/' kirpilir; sema korunur.
        assert_eq!(b("127.0.0.1").as_deref(), Some("http://127.0.0.1:11434"));
        assert_eq!(b("http://127.0.0.1:11435/").as_deref(), Some("http://127.0.0.1:11435"));
        assert_eq!(b("https://ollama.local:443").as_deref(), Some("https://ollama.local:443"));
        // IPv6 literal korunur.
        assert_eq!(b("[::1]:11435").as_deref(), Some("http://[::1]:11435"));
        // Bos → None.
        assert_eq!(b("   "), None);
    }

    #[test]
    fn pick_base_precedence_env_setting_host_default() {
        // env > setting > ollama_host > default.
        let (base, src) =
            pick_base(Some("http://127.0.0.1:9".into()), Some("127.0.0.1:8".into()), Some("127.0.0.1:7".into()));
        assert_eq!((base.as_str(), src), ("http://127.0.0.1:9", "env"));
        let (base, src) = pick_base(None, Some("127.0.0.1:8".into()), Some("127.0.0.1:7".into()));
        assert_eq!((base.as_str(), src), ("http://127.0.0.1:8", "setting"));
        // OLLAMA_HOST (bu makine deseni) — localhost tuzagi 127.0.0.1'e cevrilir.
        let (base, src) = pick_base(None, None, Some("localhost:11435".into()));
        assert_eq!((base.as_str(), src), ("http://127.0.0.1:11435", "ollama_host"));
        // Hicbiri → default (127.0.0.1:11434); bos env/setting atlanir.
        let (base, src) = pick_base(Some("  ".into()), Some(String::new()), None);
        assert_eq!((base.as_str(), src), ("http://127.0.0.1:11434", "default"));
    }
}
