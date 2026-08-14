//! Facet/ozet sorgulari (TUMU salt-okuma — her rol): uzanti/metadata/etiket +
//! proje-durum facetleri (onay/musteri/versiyon/termin) + klasor ozeti + dashboard.

use crate::AppState;
use archivist_db::{ActivitySummary, DashboardStats, ExtSize, Facet, FolderSummary, MonthCount};
use serde::Serialize;
use tauri::State;

/// Uzantiya gore asset sayilari (tur filtre faceti).
#[tauri::command]
pub fn ext_facets(state: State<'_, AppState>) -> Result<Vec<Facet>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.ext_facets().map_err(|e| e.to_string())
}

/// Bir klasor (ust-dizin) ozeti — yol + altindaki dogrudan asset sayisi (IPC).
/// "Klasorler" gorunumunun kart verisi. `assets.path`'ten turetilir (`scanned_roots`
/// tablosu henuz yok). Frontend bir karta tiklayinca `ListOpts.path_prefix = path`
/// ayarlayarak liste o klasore filtrelenir.
#[derive(Debug, Serialize)]
pub struct FolderSummaryDto {
    pub path: String,
    pub file_count: i64,
    /// Klasor-basi EN YENI `indexed_at` (unix saniye); son-indeksleme siralamasi icin.
    /// `None` = klasordeki hicbir asset indekslenmemis (siralamada en eskiye/sona konur).
    /// Mevcut `file_count` snake_case konvansiyonuna uyar (frontend `folder.last_indexed`).
    pub last_indexed: Option<i64>,
}

impl From<FolderSummary> for FolderSummaryDto {
    fn from(f: FolderSummary) -> Self {
        Self { path: f.path, file_count: f.file_count, last_indexed: f.last_indexed }
    }
}

/// Klasor ozetleri (ust-dizine gore gruplu asset sayilari, en cok ilk; cap 1000).
/// Salt-okuma (her rol; `ext_facets` ile ayni desen — yetki gate yok).
#[tauri::command]
pub fn folder_summary(state: State<'_, AppState>) -> Result<Vec<FolderSummaryDto>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    Ok(db
        .folder_summary()
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(FolderSummaryDto::from)
        .collect())
}

// ── Dashboard ozeti (Faz 7.3): arsiv istatistikleri + basit grafik verileri ──

/// Bir ay kovasi (IPC) — "YYYY-MM" + o aydaki asset sayisi. `serde` snake_case alanlar.
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct MonthCountDto {
    pub month: String,
    pub count: i64,
}

impl From<MonthCount> for MonthCountDto {
    fn from(m: MonthCount) -> Self {
        Self { month: m.month, count: m.count }
    }
}

/// Dashboard ozet istatistikleri (IPC). `ext_counts` `Facet` tipini yeniden kullanir
/// (ext_facets ile ayni sekil → frontend tek tip). `month_counts`: SADECE verisi olan
/// son-12-ay kovalari (sifir-doldurma YOK — db katmaninda belgelendi). `approval_counts`
/// yalniz durum atanan dosyalari onay-kuyrugu sirasi ile tasir. snake_case alanlar.
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct DashboardStatsDto {
    pub total_assets: i64,
    pub total_size: i64,
    pub ext_counts: Vec<Facet>,
    /// Format-bazli boyut (H2 sizeByFormat) — `ExtSize` (value+size) yeniden kullanilir (Facet gibi).
    pub size_by_ext: Vec<ExtSize>,
    pub month_counts: Vec<MonthCountDto>,
    pub approval_counts: Vec<Facet>,
    /// Aktif (kullanilan) proje sayisi (H2 activeProjects).
    pub active_projects: i64,
    /// Metni cikarilmis asset sayisi (icerikten aranabilir) — frontend `total_assets` ile "N/M".
    pub indexed_assets: i64,
    pub architectural_styles: Vec<Facet>,
    pub material_groups: Vec<Facet>,
}

impl From<DashboardStats> for DashboardStatsDto {
    fn from(s: DashboardStats) -> Self {
        Self {
            total_assets: s.total_assets,
            total_size: s.total_size,
            ext_counts: s.ext_counts,
            size_by_ext: s.size_by_ext,
            month_counts: s.month_counts.into_iter().map(MonthCountDto::from).collect(),
            approval_counts: s.approval_counts,
            active_projects: s.active_projects,
            indexed_assets: s.indexed_assets,
            architectural_styles: s.architectural_styles,
            material_groups: s.material_groups,
        }
    }
}

/// Arsiv ozet istatistikleri (Dashboard): toplam sayi/boyut + uzanti dagilimi + son 12
/// ayin zaman serisi. Tek sorgu kumesi — renderer TOPLAMAZ (DB toplar). Salt-okuma
/// (her rol; `ext_facets` ile ayni desen — yetki gate yok). `path_prefix` verilirse (klasor-
/// kapsamli pano) tum sayimlar o yol-onekiyle daraltilir; `None`/eksik → global (geriye-uyumlu).
#[tauri::command]
pub fn dashboard_stats(
    path_prefix: Option<String>,
    state: State<'_, AppState>,
) -> Result<DashboardStatsDto, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    Ok(db.dashboard_stats(path_prefix.as_deref()).map_err(|e| e.to_string())?.into())
}

/// Son 7 gunun audit_log aktivite ozeti (H2 AdminActivityPanel pariti): toplam islem + en aktif
/// kullanicilar (5) + islem turleri (6). **ADMIN-gate**: audit arsiv-genelidir ve "kim ne yapti"
/// gosterir → yalniz admin gorur (H2 `isAdmin` kosuluyla ayni). DB toplar (SQL GROUP BY; renderer
/// TOPLAMAZ — H2 500 kayit cekip JS'te grupluyordu). Arsiv-geneli (path-kapsamsiz; audit asset degil).
#[tauri::command]
pub fn dashboard_activity(state: State<'_, AppState>) -> Result<ActivitySummary, String> {
    let role = crate::rbac::current_role(&state).map_err(|e| e.to_string())?;
    crate::rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.activity_summary(ACTIVITY_WINDOW_DAYS).map_err(|e| e.to_string())
}

/// Aktivite ozeti penceresi (gun) — H2 AdminActivityPanel "son 7 gun".
const ACTIVITY_WINDOW_DAYS: i64 = 7;

/// Bir metadata key icin deger sayilari (or. 'author', 'version').
#[tauri::command]
pub fn metadata_facets(
    key: String,
    limit: i64,
    state: State<'_, AppState>,
) -> Result<Vec<Facet>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.metadata_facets(&key, limit).map_err(|e| e.to_string())
}

/// Kullanici etiketleri + sayilari (kurasyon faceti). Salt-okuma (her rol).
#[tauri::command]
pub fn tag_facets(limit: i64, state: State<'_, AppState>) -> Result<Vec<Facet>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.tag_facets(limit).map_err(|e| e.to_string())
}

/// Onay durumuna gore asset sayilari (proje-durum faceti). `ext_facets`/`tag_facets`
/// ile ayni `Facet` sekli. Salt-okuma (her rol — yetki gate yok).
#[tauri::command]
pub fn approval_facets(state: State<'_, AppState>) -> Result<Vec<Facet>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.approval_facets().map_err(|e| e.to_string())
}

/// Gorsel medya turune gore asset sayilari (`ai_gorsel_turu` EAV: Fotoğraf/Render/Doku).
/// `ext_facets`/`approval_facets` ile ayni `Facet` sekli. Salt-okuma (her rol — yetki gate yok).
#[tauri::command]
pub fn gorsel_turu_facets(state: State<'_, AppState>) -> Result<Vec<Facet>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.gorsel_turu_facets().map_err(|e| e.to_string())
}

/// Musteri adina gore asset sayilari (proje-durum faceti). Salt-okuma (her rol — gate yok).
#[tauri::command]
pub fn client_facets(limit: i64, state: State<'_, AppState>) -> Result<Vec<Facet>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.client_facets(limit).map_err(|e| e.to_string())
}

/// Versiyon etiketine gore asset sayilari (proje-durum faceti). Salt-okuma (her rol).
#[tauri::command]
pub fn version_facets(limit: i64, state: State<'_, AppState>) -> Result<Vec<Facet>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.version_facets(limit).map_err(|e| e.to_string())
}

/// Termin yilina gore asset sayilari (proje-durum faceti). Salt-okuma (her rol).
#[tauri::command]
pub fn deadline_year_facets(state: State<'_, AppState>) -> Result<Vec<Facet>, String> {
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    db.deadline_year_facets().map_err(|e| e.to_string())
}
