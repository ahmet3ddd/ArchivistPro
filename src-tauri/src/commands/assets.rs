//! Asset okuma komutlari: liste/arama, tekil detay, thumbnail batch.

use crate::AppState;
use archivist_db::{AssetDetail, AssetPage, ListOpts, MatchSource};
use serde::Serialize;
use tauri::{Manager, State};

// ── Okuma sorgulari (rol gate yok — viewer da okur) ─────────────────────────

/// Birlesik liste/arama — `opts.query` doluysa FTS5 (rank), bossa filtreli liste
/// (sort). Tum filtreler (ext/tag/collection/favori/tarih) birlikte uygulanir.
#[tauri::command]
pub fn list_assets(opts: ListOpts, state: State<'_, AppState>) -> Result<AssetPage, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.list_assets(&opts).map_err(|e| e.to_string())
}

/// Tek asset'in tam detayi (satir + metadata + etiketler). Yoksa `null`.
#[tauri::command]
pub fn get_asset(id: i64, state: State<'_, AppState>) -> Result<Option<AssetDetail>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.get_asset(id).map_err(|e| e.to_string())
}

/// Bir arama isabetinin **alan-atfi** ("neden bu sonuc"): `query` asset'in hangi FTS
/// sutunlarinda eslesti (H2 `findMatchSources` pariti). Yalniz keyword (FTS) aramada
/// anlamli — semantik/gorsel modda "neden" zaten % rozetidir → frontend orada cagirmaz.
/// Bos/eslesmeyen sorgu → `[]`. Salt-okuma (her rol; yazma yok).
#[tauri::command]
pub fn match_sources(
    id: i64,
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<MatchSource>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.match_sources(id, &query).map_err(|e| e.to_string())
}

/// Kucuk resim (IPC) — baytlar base64 string olarak.
#[derive(Debug, Serialize)]
pub struct ThumbnailDto {
    pub asset_id: i64,
    pub mime: String,
    pub width: i64,
    pub height: i64,
    pub data_base64: String,
}

/// Verilen asset id'leri icin thumbnail'lar (batch; yalniz var olanlar). Renderer
/// `data:{mime};base64,{data_base64}` ile gosterir.
#[tauri::command]
pub fn get_thumbnails(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<ThumbnailDto>, String> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;

    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    let rows = db.get_thumbnails(&ids).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|t| ThumbnailDto {
            asset_id: t.asset_id,
            mime: t.mime,
            width: t.width,
            height: t.height,
            data_base64: STANDARD.encode(&t.bytes),
        })
        .collect())
}

/// Yerel detay paneli icin video kaynagini Tauri asset protokolune TEK-DOSYA olarak ac.
/// Renderer keyfi yol veremez: id aktif DB kaydindan cozulur, video uzantisi ve disk varligi
/// backend'de dogrulanir. Tauri'nin asset protokolu Range/HEAD'i kendi yonetir → ileri-geri sarma
/// tum videoyu bellekte/IPC'de tasimadan calisir.
#[tauri::command]
pub fn prepare_media_source(
    id: i64,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "mov", "avi", "mkv", "webm", "flv", "wmv"];

    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    let detail = db
        .get_asset(id)
        .map_err(|e| e.to_string())?
        .ok_or("not_found")?;
    let ext = detail
        .asset
        .ext
        .as_deref()
        .unwrap_or("")
        .to_ascii_lowercase();
    if !VIDEO_EXTS.contains(&ext.as_str()) {
        return Err("not_video".to_string());
    }
    let path = std::path::PathBuf::from(&detail.asset.path);
    if !path.is_file() {
        return Err("not_found".to_string());
    }
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    Ok(detail.asset.path)
}
