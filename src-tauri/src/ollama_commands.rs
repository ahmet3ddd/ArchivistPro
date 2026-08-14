//! Ollama adres/port cozumu — kalici ayar + otomatik tespit (kullanici talebi 2026-07-02).
//!
//! Cok-makine gercegi: Ollama farkli portta/adreste olabilir (or. bu makinede
//! `OLLAMA_HOST=127.0.0.1:11435`). Cozum zinciri (bkz `ollama.rs`): `ARSIV_OLLAMA_BASE` env >
//! kalici ayar (bu komutlar, app_meta) > `OLLAMA_HOST` env > varsayilan `http://127.0.0.1:11434`.
//! "Tespit et" kisa/kurali aday listesini yoklar → erisen ilkini ONERIR (kor port-taramasi DEGIL;
//! yanit `models` dizisiyle dogrulanir → yanlis servise baglanmaz). Ayar = gorunur/yonetilebilir.

use serde::Serialize;
use tauri::State;

use crate::{ollama, rbac, AppState};

/// `app_meta` anahtari — kalici Ollama base URL (bos/yok → oto-cozume duser).
const META_OLLAMA_BASE: &str = "ollama_base";

/// Mevcut Ollama adres yapilandirmasi (UI: etkin adres + kaynak + kalici ayar + OLLAMA_HOST).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaConfigDto {
    /// Etkin (cozulmus) base URL — istemci cagrilarinin gittigi adres.
    base: String,
    /// Nereden geldi: `"env"` | `"setting"` | `"ollama_host"` | `"default"`.
    source: String,
    /// Kalici ayar (app_meta) — kullanicinin elle girdigi; yoksa `null` (oto).
    setting: Option<String>,
    /// Ham `OLLAMA_HOST` env (gorunurluk; Ollama'nin kendi konvansiyonu).
    ollama_host_env: Option<String>,
}

/// Ollama adres yapilandirmasini oku (ag cagrisi YOK; salt yapilandirma). Rol gate yok (okuma).
#[tauri::command(async)]
pub fn ollama_config(state: State<'_, AppState>) -> Result<OllamaConfigDto, String> {
    let (base, source) = ollama::base_and_source();
    let setting = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_meta(META_OLLAMA_BASE)
            .map_err(|e| e.to_string())?
            .filter(|s| !s.trim().is_empty())
    };
    Ok(OllamaConfigDto {
        base,
        source: source.to_string(),
        setting,
        ollama_host_env: std::env::var("OLLAMA_HOST").ok().filter(|s| !s.trim().is_empty()),
    })
}

/// Kalici Ollama adresini AYARLA/temizle (**admin**). Bos/None → ayar temizlenir (oto-cozume duser).
/// `app_meta`'ya yazar + modul-global gunceller → aninda etkin (yeniden baslatma gerekmez).
#[tauri::command(async)]
pub fn set_ollama_base(base: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let cleaned = base.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.set_meta(META_OLLAMA_BASE, cleaned.as_deref().unwrap_or(""))
            .map_err(|e| e.to_string())?;
    }
    ollama::set_configured_base(cleaned);
    Ok(())
}

/// Tespit adayi — base + erisilebilir mi + model sayisi (seffaflik: denenen hepsini goster).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaCandidate {
    base: String,
    reachable: bool,
    model_count: usize,
}

/// Tespit sonucu — erisen ilk aday (`best`) + denenen tum adaylar.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectDto {
    best: Option<String>,
    candidates: Vec<OllamaCandidate>,
}

/// Ollama'yi OTOMATIK TESPIT et: aday adresleri (OLLAMA_HOST-turevi + `127.0.0.1:11434/11435`)
/// `/api/tags` ile yoklar → erisen ILKINI `best` doner. Ag cagrisi; rol gate yok (okuma/kesif).
/// Kor port-taramasi DEGIL — kisa kurali aday listesi + yanit dogrulama (`models` dizisi).
#[tauri::command]
pub fn detect_ollama() -> DetectDto {
    let mut candidates = Vec::new();
    let mut best = None;
    for base in ollama::detect_candidates() {
        let count = ollama::probe_base(&base);
        let reachable = count.is_some();
        if reachable && best.is_none() {
            best = Some(base.clone());
        }
        candidates.push(OllamaCandidate { base, reachable, model_count: count.unwrap_or(0) });
    }
    DetectDto { best, candidates }
}

/// Yerel Ollama hizmetini baslat (**admin**). Yalniz `http://127.0.0.1:*` / `http://[::1]:*`
/// hedefleri ve disk uzerinde bulunan bir Ollama kurulumu kabul edilir; uzak adreslere dokunmaz.
/// Komut sureci baslatir, hazirlik icin UI ardindan `ai_status` yoklar.
#[tauri::command]
pub fn start_ollama(state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    ollama::start_local_ollama()
}
