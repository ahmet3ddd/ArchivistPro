//! DB saglik + Doctor onarim komutlari (Faz 6 "Doctor" paneli; P3 onarim).
//!
//! Iki ayak: **DB-butunlugu** (integrity/orphan/purge — `archivist-db::health`) + **dosya-sistemi**
//! (staleness/fixity — `archivist-ingest`; asagida). Staleness = dosya diskte var mi / mtime degismis
//! mi (ucuz); fixity = icerik BLAKE3 yeniden-hash ↔ baseline (bit-rot; orneklem). Sonuc DB'ye
//! YAZILMAZ (on-demand rapor). Salt-okuma (db_health deseni; UI zaten admin-only kart).

use archivist_ingest::{FixityReport, OfficeFormatReport, StalenessReport};

use crate::rbac;
use crate::AppState;
use serde::Serialize;
use tauri::State;

/// Veri katmani saglik ozeti — Faz 6 "Doctor" panelinin cekirdek sorgusu.
#[derive(Debug, Serialize)]
pub struct HealthReport {
    pub schema_version: i64,
    pub integrity_ok: bool,
    pub asset_count: i64,
    pub orphan_count: i64,
}

/// DB saglik durumu (her rol cagirabilir; salt-okuma).
#[tauri::command(async)]
pub fn db_health(state: State<'_, AppState>) -> Result<HealthReport, String> {
    // read_db (2026-08-11): salt-okuma rapor; HealthBadge her dataVersion sicramasinda cagirir
    // ve senkron → UI is parcacigi. Yazma kilidi tarama boyunca dolu → read_db sart.
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    Ok(HealthReport {
        schema_version: db.schema_version().map_err(|e| e.to_string())?,
        integrity_ok: db.integrity_ok().map_err(|e| e.to_string())?,
        asset_count: db.asset_count().map_err(|e| e.to_string())?,
        orphan_count: db.orphan_count().map_err(|e| e.to_string())?,
    })
}

/// Doctor onarim raporu — silinen yetim + onarim SONRASI butunluk/yetim durumu.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairReport {
    /// Silinen yetim satir sayisi.
    removed: u64,
    /// Onarim SONRASI butunluk saglam mi.
    integrity_ok: bool,
    /// Onarim SONRASI kalan yetim (0 beklenir).
    orphan_count_after: i64,
}

/// **Doctor onarim:** yetim satirlari temizle (asset'i olmayan FTS/vektor/etiket/iliski +
/// parentsiz RAG chunk vektor/FTS). **Admin** (bakim/yazma). `db_health.orphan_count` ile ayni 7
/// kaynak → "N sayildi" ⇒ "N silindi". Best-effort audit (`db_repair`).
#[tauri::command(async)]
pub fn repair_db(state: State<'_, AppState>) -> Result<RepairReport, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = crate::audit::actor(&state);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let removed = db.purge_orphans().map_err(|e| e.to_string())?;
    let report = RepairReport {
        removed,
        integrity_ok: db.integrity_ok().map_err(|e| e.to_string())?,
        orphan_count_after: db.orphan_count().map_err(|e| e.to_string())?,
    };
    crate::audit::record_on(
        &db,
        &actor,
        "db_repair",
        Some("db"),
        None,
        Some(&format!("{removed} yetim satir silindi")),
    );
    Ok(report)
}

/// **Arsiv guncellik denetimi (staleness):** her AKTIF asset'in dosyasi diskte hala var mi /
/// mtime tarama-anindan farkli mi (±2sn tolerans). Salt-okuma (her rol; db_health deseni). Kok
/// erisilemezse (disk cikarilmis) o asset'ler `offline` sayilir — `missing` false-positive'i
/// onlenir. fs-tarama govde-bloklayici olabilir → **async** (UI donmaz; govdede `.await` yok).
#[tauri::command]
pub async fn check_staleness(state: State<'_, AppState>) -> Result<StalenessReport, String> {
    // read_db + KISA kilit (2026-08-11): satirlar kilit ALTINDA cekilir, stat yuruyusu kilit
    // BIRAKILDIKTAN sonra kosar. Eski hal (yazma kilidi, tum yuruyus boyunca) taramayla
    // yarisiyordu; ara hal (okuma kilidi, tum yuruyus boyunca) bu kez TUM okuma komutlarini
    // asili birakirdi — kopuk ag surucusunde stat basina saniyeler. Kilit yalniz DB okumasi
    // kadar tutulur; dosya sistemine kilitle GIRILMEZ.
    let rows = {
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.active_assets_fs_meta().map_err(|e| e.to_string())?
    };
    archivist_ingest::check_staleness_rows(rows).map_err(|e| e.to_string())
}

/// **Fixity (bit-rot) kontrolu:** aktif + content_hash'li asset'lerin `sample_pct` (1..=100)
/// kadarini BLAKE3 ile yeniden-hash'leyip baseline ile karsilastir → uyusmazlik = icerik bozulma
/// suphesi. Pahali (rehash) → orneklem + **async**. Salt-okuma; rapor-only (DB'ye yazmaz).
#[tauri::command]
pub async fn check_fixity(
    sample_pct: u8,
    state: State<'_, AppState>,
) -> Result<FixityReport, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    archivist_ingest::check_fixity(&db, sample_pct).map_err(|e| e.to_string())
}

/// **Eski Office biçim denetimi:** aktif DOC/XLS/PPT ailesinin yalnız dosya
/// imzasını okur; gerçek OLE ikili belgeleri ve uzantı-içerik çelişkilerini
/// raporlar. Salt-okuma ve rapor-only'dir; dosyaya/DB'ye yazmaz. Erişilemeyen
/// dosyalar yinelenmez, Staleness denetimi bunların doğruluk kaynağıdır.
#[tauri::command]
pub async fn check_office_formats(
    state: State<'_, AppState>,
) -> Result<OfficeFormatReport, String> {
    let db = state.db.lock().map_err(|e| e.to_string())?;
    archivist_ingest::check_office_formats(&db).map_err(|e| e.to_string())
}
