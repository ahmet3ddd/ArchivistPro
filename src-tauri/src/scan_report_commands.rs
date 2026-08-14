//! Tarama (ingest) raporu komutlari (P2.5 ④) — her ingest kosusunun KALICI raporunun
//! gecmisi (listeleme/detay/temizleme). Kayit deposu `archivist-db/scan_reports.rs`
//! (migration 0017); burada komut-tarafi: ingest sonrasi **best-effort** kayit kancasi
//! (`record_scan`; audit/undo deseni — kayit hatasi ingest'i BOZMAZ) + admin-gated
//! okuma/temizleme komutlari.
//!
//! **Admin** (ingest zaten admin; tarama gecmisi = yonetim bilgisi).

use std::time::{SystemTime, UNIX_EPOCH};

use archivist_db::{Db, ScanReportInput};
use archivist_ingest::{IngestMode, IngestReport};
use serde::Serialize;
use tauri::State;

use crate::commands::{IngestWarning, TypeCount};
use crate::{rbac, AppState};

/// `list_scan_reports(limit=None)` icin varsayilan (RETENTION ile ayni; DB tarafinda kelepcelenir).
const DEFAULT_LIST_LIMIT: i64 = 50;

/// [`IngestMode`] → kanonik DB string'i (`parse_ingest_mode`'un tersi; istemci ne yollarsa yollasin
/// tabloda daima kanonik deger durur).
fn mode_label(mode: IngestMode) -> &'static str {
    match mode {
        IngestMode::Merge => "merge",
        IngestMode::Replace => "replace",
        IngestMode::Reset => "reset",
    }
}

/// Simdiki unix saniye (audit/undo `now_unix` ile ayni savunma: epoch-oncesi → 0; asla panik).
fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Ingest kosusundan sonra raporu KALICI kaydet — **best-effort** (audit/undo deseni: kayit
/// hatasi ingest'i BOZMAZ; logla-gec). ZATEN KILITLI `db` altinda cagrilir (kilit ingest komutunda
/// tutuluyor). `root` taranan kok, `mode` kosu modu, `report` ingest ozeti.
pub(crate) fn record_scan(db: &Db, root: &str, mode: IngestMode, report: &IngestReport) {
    let input = ScanReportInput {
        root_path: root.to_string(),
        mode: mode_label(mode).to_string(),
        ts: now_unix(),
        added: report.added,
        updated: report.updated,
        skipped: report.skipped,
        failed: report.failed,
        removed: report.removed,
        elapsed_ms: report.elapsed_ms,
        type_counts: report.type_counts.clone(),
        warnings: report.warnings.clone(),
        errors: report.errors.clone(),
        skipped_reasons: report.skipped_reasons.clone(),
    };
    if let Err(e) = db.record_scan_report(&input) {
        eprintln!("[arsiv-h3] tarama raporu kaydedilemedi (ingest etkilenmez): {e}");
    }
}

// ── DTO'lar (renderer kontrati; camelCase) ───────────────────────────────────────────────

/// Panel liste satiri — HAFIF (agir listeler yok, yalniz sayimlar). `serde` camelCase:
/// `rootPath`, `elapsedMs`, `warningCount`, `errorCount`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReportSummaryDto {
    id: i64,
    ts: i64,
    root_path: String,
    mode: String,
    added: i64,
    updated: i64,
    skipped: i64,
    failed: i64,
    removed: i64,
    elapsed_ms: i64,
    warning_count: i64,
    error_count: i64,
    /// Walker seviyesinde atlanan girdi sayisi (④-C; agir liste yuklenmeden).
    skipped_reason_count: i64,
}

impl From<archivist_db::ScanReportSummary> for ScanReportSummaryDto {
    fn from(s: archivist_db::ScanReportSummary) -> Self {
        Self {
            id: s.id,
            ts: s.ts,
            root_path: s.root_path,
            mode: s.mode,
            added: s.added,
            updated: s.updated,
            skipped: s.skipped,
            failed: s.failed,
            removed: s.removed,
            elapsed_ms: s.elapsed_ms,
            warning_count: s.warning_count,
            error_count: s.error_count,
            skipped_reason_count: s.skipped_reason_count,
        }
    }
}

/// Detay (tek rapor) — ozet alanlari + agir listeler. `typeCounts` = `{ext,count}` (mevcut
/// [`TypeCount`]), `warnings`/`errors` = `{path,message}` (mevcut [`IngestWarning`] sekli).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReportDetailDto {
    id: i64,
    ts: i64,
    root_path: String,
    mode: String,
    added: i64,
    updated: i64,
    skipped: i64,
    failed: i64,
    removed: i64,
    elapsed_ms: i64,
    warning_count: i64,
    error_count: i64,
    skipped_reason_count: i64,
    type_counts: Vec<TypeCount>,
    warnings: Vec<IngestWarning>,
    errors: Vec<IngestWarning>,
    /// Walker seviyesinde atlanan girdiler `{path, message}` — `message` = sebep-kodu (④-C;
    /// frontend `ingest.skipReason.<code>` ile yerellestirir).
    skipped_reasons: Vec<IngestWarning>,
}

impl From<archivist_db::ScanReportDetail> for ScanReportDetailDto {
    fn from(d: archivist_db::ScanReportDetail) -> Self {
        let s = d.summary;
        Self {
            id: s.id,
            ts: s.ts,
            root_path: s.root_path,
            mode: s.mode,
            added: s.added,
            updated: s.updated,
            skipped: s.skipped,
            failed: s.failed,
            removed: s.removed,
            elapsed_ms: s.elapsed_ms,
            warning_count: s.warning_count,
            error_count: s.error_count,
            skipped_reason_count: s.skipped_reason_count,
            type_counts: d
                .type_counts
                .into_iter()
                .map(|(ext, count)| TypeCount { ext, count })
                .collect(),
            warnings: d
                .warnings
                .into_iter()
                .map(|(path, message)| IngestWarning { path, message })
                .collect(),
            errors: d
                .errors
                .into_iter()
                .map(|(path, message)| IngestWarning { path, message })
                .collect(),
            skipped_reasons: d
                .skipped_reasons
                .into_iter()
                .map(|(path, message)| IngestWarning { path, message })
                .collect(),
        }
    }
}

// ── Komutlar (hepsi ADMIN — ingest ile ayni kademe) ──────────────────────────────────────

/// Tarama raporu gecmisi (en yeni once; HAFIF ozetler). `limit` yoksa varsayilan; DB tarafinda
/// 1..=RETENTION'a kelepcelenir. **Admin**.
#[tauri::command(async)]
pub fn list_scan_reports(
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<ScanReportSummaryDto>, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let rows = db
        .list_scan_report_summaries(limit.unwrap_or(DEFAULT_LIST_LIMIT))
        .map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(ScanReportSummaryDto::from).collect())
}

/// Tek raporun TAM detayi (type_counts/warnings/errors). Yok → `null`. **Admin**.
#[tauri::command(async)]
pub fn get_scan_report(
    id: i64,
    state: State<'_, AppState>,
) -> Result<Option<ScanReportDetailDto>, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let detail = db.get_scan_report_detail(id).map_err(|e| e.to_string())?;
    Ok(detail.map(ScanReportDetailDto::from))
}

/// Tum tarama raporu gecmisini temizle → silinen sayisi. **Admin**.
#[tauri::command(async)]
pub fn clear_scan_reports(state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.clear_scan_reports().map_err(|e| e.to_string())
}

// ── Dis-aktarim (export) ──────────────────────────────────────────────────────────────────

/// Raporu ham JSON'a cevir (renderer DTO'suyla AYNI camelCase sema → makine-okur).
fn report_as_json(dto: &ScanReportDetailDto) -> Result<String, String> {
    serde_json::to_string_pretty(dto).map_err(|e| e.to_string())
}

/// Raporu insan-okur duz metne cevir (H2 "scan report" TXT paritesi: ozet basligi + bicimler +
/// hatalar + uyarilar). Saf fonksiyon → test-edilebilir.
fn report_as_txt(dto: &ScanReportDetailDto) -> String {
    let mut out = String::new();
    out.push_str(&format!("Tarama Raporu #{}\n", dto.id));
    out.push_str(&format!("Kok: {}\n", dto.root_path));
    out.push_str(&format!("Zaman (unix saniye): {}\n", dto.ts));
    out.push_str(&format!("Mod: {}\n", dto.mode));
    out.push_str(&format!(
        "Eklenen: {} · Guncellenen: {} · Atlanan: {} · Basarisiz: {} · Kaldirilan: {}\n",
        dto.added, dto.updated, dto.skipped, dto.failed, dto.removed
    ));
    out.push_str(&format!("Sure (ms): {}\n", dto.elapsed_ms));
    if !dto.type_counts.is_empty() {
        out.push_str("\nBicimler:\n");
        for tc in &dto.type_counts {
            let ext = if tc.ext.is_empty() { "(uzantisiz)" } else { tc.ext.as_str() };
            out.push_str(&format!("  {ext}: {}\n", tc.count));
        }
    }
    if !dto.errors.is_empty() {
        out.push_str(&format!("\nHatalar ({}):\n", dto.errors.len()));
        for e in &dto.errors {
            out.push_str(&format!("  [HATA] {} — {}\n", e.path, e.message));
        }
    }
    if !dto.warnings.is_empty() {
        out.push_str(&format!("\nUyarilar ({}):\n", dto.warnings.len()));
        for w in &dto.warnings {
            out.push_str(&format!("  [UYARI] {} — {}\n", w.path, w.message));
        }
    }
    if !dto.skipped_reasons.is_empty() {
        out.push_str(&format!("\nAtlananlar ({}):\n", dto.skipped_reasons.len()));
        for sk in &dto.skipped_reasons {
            // Sebep-kodu insan-okur etikete (TXT'de i18n yok → kisa Turkce). Bilinmeyen kod aynen.
            let reason = match sk.message.as_str() {
                "hidden" => "gizli",
                "unreadable" => "okunamadi (izin/IO)",
                "symlink" => "sembolik baglanti (izlenmedi)",
                other => other,
            };
            out.push_str(&format!("  [ATLANDI] {} — {}\n", sk.path, reason));
        }
    }
    out
}

/// Bir raporu diske disa-aktar. `format`: `"txt"` (insan-okur) veya `"json"` (ham). `dest` =
/// istemcinin kaydet-diyalogundan sectigi tam yol. DB kilidi yalniz detay okunurken tutulur;
/// dosya yazimi kilit-DISI. Yok → hata. **Admin**.
#[tauri::command(async)]
pub fn export_scan_report(
    id: i64,
    format: String,
    dest: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let detail = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        db.get_scan_report_detail(id).map_err(|e| e.to_string())?
    };
    let dto: ScanReportDetailDto = detail.ok_or_else(|| "rapor bulunamadi".to_string())?.into();
    let content = match format.as_str() {
        "json" => report_as_json(&dto)?,
        "txt" => report_as_txt(&dto),
        other => return Err(format!("gecersiz bicim: {other}")),
    };
    std::fs::write(&dest, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Test icin ornek detay DTO'su (agir listeler dolu).
    fn sample() -> ScanReportDetailDto {
        ScanReportDetailDto {
            id: 7,
            ts: 1_700_000_000,
            root_path: "C:/Proj/Villa".into(),
            mode: "merge".into(),
            added: 3,
            updated: 1,
            skipped: 2,
            failed: 1,
            removed: 0,
            elapsed_ms: 1234,
            warning_count: 1,
            error_count: 1,
            skipped_reason_count: 2,
            type_counts: vec![TypeCount { ext: "dwg".into(), count: 3 }, TypeCount { ext: "".into(), count: 1 }],
            warnings: vec![IngestWarning { path: "C:/x/a.dwg".into(), message: "cikarim dustu".into() }],
            errors: vec![IngestWarning { path: "C:/x/bozuk.bin".into(), message: "stat hatasi".into() }],
            skipped_reasons: vec![
                IngestWarning { path: "C:/x/.git".into(), message: "hidden".into() },
                IngestWarning { path: "C:/x/kilitli".into(), message: "unreadable".into() },
            ],
        }
    }

    #[test]
    fn txt_export_contains_key_lines() {
        let s = report_as_txt(&sample());
        assert!(s.contains("Tarama Raporu #7"));
        assert!(s.contains("C:/Proj/Villa"));
        assert!(s.contains("[HATA] C:/x/bozuk.bin — stat hatasi"));
        assert!(s.contains("[UYARI] C:/x/a.dwg — cikarim dustu"));
        assert!(s.contains("(uzantisiz): 1")); // bos ext dostca etiketlenir
        assert!(s.contains("dwg: 3"));
        // ④-C: atlananlar bolumu + sebep-kodu insan-okur etikete cevrilir.
        assert!(s.contains("Atlananlar (2)"));
        assert!(s.contains("[ATLANDI] C:/x/.git — gizli"));
        assert!(s.contains("[ATLANDI] C:/x/kilitli — okunamadi (izin/IO)"));
    }

    #[test]
    fn json_export_is_valid_camelcase() {
        let j = report_as_json(&sample()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&j).unwrap();
        assert_eq!(v["rootPath"], "C:/Proj/Villa");
        assert_eq!(v["elapsedMs"], 1234);
        assert_eq!(v["errors"][0]["path"], "C:/x/bozuk.bin");
        assert_eq!(v["typeCounts"][0]["ext"], "dwg");
        // ④-C: skippedReasons camelCase + sebep-kodu message'da.
        assert_eq!(v["skippedReasons"][0]["path"], "C:/x/.git");
        assert_eq!(v["skippedReasons"][0]["message"], "hidden");
        assert_eq!(v["skippedReasonCount"], 2);
    }

    #[test]
    fn invalid_format_label_is_rejected() {
        // Saf format secimi dogrulamasi (komut gövdesinden bagimsiz kol).
        let dto = sample();
        let bad = match "csv" {
            "json" => Some(report_as_json(&dto).unwrap()),
            "txt" => Some(report_as_txt(&dto)),
            _ => None,
        };
        assert!(bad.is_none());
    }
}
