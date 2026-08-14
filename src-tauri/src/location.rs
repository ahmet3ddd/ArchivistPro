//! Slice 2 — lokasyon farkindaligi. Arsiv DB'si tasinabilir (thumbnail+metadata+YOL gomulu) ama
//! kaynak dosyalar belirli makinenin diskinde. Renderer acilista `location_status`'u cagirir;
//! kaynak dosyalar bu makinede erisilemiyorsa "uzak lokasyon / onizleme" banner gosterir.
//!
//! Yikici Replace/Reset zaten archivist-ingest kaynak-yokluk korumasiyla reddedilir (footgun-fix);
//! bu komut yalniz PROAKTIF bilgilendirme (kullanici denemeden once bilir). recovery_status deseni.

use serde::Serialize;
use tauri::State;

use crate::AppState;

/// Acilista erisilebilirlik icin bakilan asset yolu ornek sayisi.
const LOCATION_SAMPLE: i64 = 20;

/// Bu makinenin adi (Windows `COMPUTERNAME`; yoksa `HOSTNAME`; en son `"unknown"`).
pub fn current_hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown".to_string())
}

/// Lokasyon durumu (renderer banner'i icin). serde camelCase.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationStatusDto {
    /// Arsivi (ilk) indeksleyen makine (app_meta `archive_host`); `None` = hic ingest yok / eski arsiv.
    pub archive_host: Option<String>,
    /// Su anki makine adi.
    pub current_host: String,
    /// `archive_host` bilinir VE su anki makineden farkli.
    pub host_mismatch: bool,
    /// Ornek alinan aktif asset yolu sayisi (0 = bos arsiv → banner gosterilmez).
    pub sampled: usize,
    /// Ornekten kaci bu makinede erisilebilir (`Path::exists`).
    pub accessible: usize,
    /// Kaynak dosyalar bu makinede yok gibi: ornek VAR ama HICBIRI erisilemez → "onizleme" modu.
    pub likely_foreign: bool,
}

/// Lokasyon durumunu hesapla — renderer acilista cagirir; kaynak-yok ise banner gosterir.
/// Salt-okuma (rol gate yok; `db_health` gibi). DB kilidi yol-ornegi alindiktan SONRA birakilir;
/// `Path::exists` fs kontrolu kilitsiz yapilir (yavas/agi disk db'yi/UI'yi bloklamaz).
#[tauri::command(async)]
pub fn location_status(state: State<'_, AppState>) -> Result<LocationStatusDto, String> {
    let (archive_host, paths) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let host = db
            .get_meta(archivist_db::meta::META_ARCHIVE_HOST)
            .map_err(|e| e.to_string())?;
        let paths = db.sample_asset_paths(LOCATION_SAMPLE).map_err(|e| e.to_string())?;
        (host, paths)
    };

    let sampled = paths.len();
    let accessible = paths.iter().filter(|p| std::path::Path::new(p).exists()).count();
    let current_host = current_hostname();
    let host_mismatch = archive_host.as_deref().is_some_and(|h| h != current_host.as_str());
    // "uzak": ornek VAR ama hicbiri erisilemez (kaynak dosyalar bu makinede degil).
    let likely_foreign = sampled > 0 && accessible == 0;

    Ok(LocationStatusDto {
        archive_host,
        current_host,
        host_mismatch,
        sampled,
        accessible,
        likely_foreign,
    })
}
