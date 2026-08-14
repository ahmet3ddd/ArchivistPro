//! Tarama (ingest) raporu gecmisi (P2.5 ④) — her ingest kosusunun KALICI ozeti.
//!
//! Bu modul yalniz KAYIT deposudur (migration 0017 `scan_reports`): ingest komutu bir kosu
//! bittiginde bir satir yazar (`record_scan_report`; **best-effort** — kayit hatasi ingest'i
//! bozmaz), "Tarama Raporlari" paneli gecmisi `list_scan_report_summaries` (HAFIF: agir JSON
//! listeleri yuklemez, yalniz sayimlari) ile okur, tek rapor detayini `get_scan_report_detail`
//! (TAM: type_counts/warnings/errors JSON parse) ile acar, `clear_scan_reports` gecmisi bosaltir.
//!
//! `type_counts` / `warnings` / `errors` DB'de opak JSON metin olarak durur (`[[ext,count]]` /
//! `[[path,msg]]`); sema buraya sizmasin diye serilestirme/yorumlama bu modulde yapilir.
//!
//! Kayit sayisi `SCAN_REPORT_RETENTION` (50; undo-gecmisi pariteli) ile sinirlanir — her eklemede
//! fazlasi id-sirasina gore budanir (en eskiler silinir). Asset FK YOK: rapor bir olayin ozetidir,
//! asset silinse de anlamli kalir.

use rusqlite::{params, OptionalExtension};

use crate::error::DbError;
use crate::Db;

/// Tutulacak azami rapor (en yeni N; fazlasi eklemede budanir). Undo-gecmisi derinligi pariteli.
pub const SCAN_REPORT_RETENTION: i64 = 50;

/// Bir ingest kosusunun kaydedilecek girdisi (komut katmani `IngestReport`'tan kurar).
/// Sayaclar `usize`/`u64` (ingest tarafi tipleri) — kayitta `i64`'e daralir (SQLite tam sayi).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanReportInput {
    pub root_path: String,
    /// Kanonik mod: `"merge"` | `"replace"` | `"reset"`.
    pub mode: String,
    /// Kosu ani (unix saniye).
    pub ts: i64,
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub failed: usize,
    pub removed: usize,
    pub elapsed_ms: u64,
    /// Uzanti dagilimi (`[[ext,count]]` olarak saklanir).
    pub type_counts: Vec<(String, usize)>,
    /// Olumcul-olmayan uyarilar (`[[path,msg]]`).
    pub warnings: Vec<(String, String)>,
    /// Dosya-bazli olumcul hatalar (`[[path,msg]]`; `errors.len() == failed`).
    pub errors: Vec<(String, String)>,
    /// Walker seviyesinde ATLANAN girdiler (`[[path,code]]`; ④-C). code = hidden/unreadable/symlink.
    pub skipped_reasons: Vec<(String, String)>,
}

/// Liste satiri (panel) — HAFIF: agir JSON listeleri (type_counts/warnings/errors) TASINMAZ,
/// yalniz uzunluklari (`warning_count`/`error_count`) tasinir.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanReportSummary {
    pub id: i64,
    pub ts: i64,
    pub root_path: String,
    pub mode: String,
    pub added: i64,
    pub updated: i64,
    pub skipped: i64,
    pub failed: i64,
    pub removed: i64,
    pub elapsed_ms: i64,
    /// `warnings` JSON dizisinin uzunlugu (agir liste yuklenmeden).
    pub warning_count: i64,
    /// `errors` JSON dizisinin uzunlugu (agir liste yuklenmeden).
    pub error_count: i64,
    /// `skipped_reasons` JSON dizisinin uzunlugu — atlanan girdi sayisi (④-C; agir liste yuklenmeden).
    pub skipped_reason_count: i64,
}

/// Tam rapor (detay acilisinda) — ozet + parse edilmis agir listeler.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanReportDetail {
    pub summary: ScanReportSummary,
    pub type_counts: Vec<(String, usize)>,
    pub warnings: Vec<(String, String)>,
    pub errors: Vec<(String, String)>,
    /// Walker seviyesinde atlanan girdiler `(path, code)` (④-C).
    pub skipped_reasons: Vec<(String, String)>,
}

impl Db {
    /// Bir ingest kosu raporunu ekle → id. Ayni cagrida `SCAN_REPORT_RETENTION` fazlasi budanir
    /// (en eski satirlar; id monoton artar → id sirasi = zaman). JSON serilestirme hatasi (pratikte
    /// imkansiz) → `Invalid` (best-effort cagiran yutar).
    pub fn record_scan_report(&self, input: &ScanReportInput) -> Result<i64, DbError> {
        let type_counts = serde_json::to_string(&input.type_counts)
            .map_err(|e| DbError::Invalid(format!("type_counts JSON: {e}")))?;
        let warnings = serde_json::to_string(&input.warnings)
            .map_err(|e| DbError::Invalid(format!("warnings JSON: {e}")))?;
        let errors = serde_json::to_string(&input.errors)
            .map_err(|e| DbError::Invalid(format!("errors JSON: {e}")))?;
        let skipped_reasons = serde_json::to_string(&input.skipped_reasons)
            .map_err(|e| DbError::Invalid(format!("skipped_reasons JSON: {e}")))?;

        self.conn.execute(
            "INSERT INTO scan_reports
                 (ts, root_path, mode, added, updated, skipped, failed, removed,
                  elapsed_ms, type_counts, warnings, errors, skipped_reasons)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                input.ts,
                input.root_path,
                input.mode,
                input.added as i64,
                input.updated as i64,
                input.skipped as i64,
                input.failed as i64,
                input.removed as i64,
                input.elapsed_ms as i64,
                type_counts,
                warnings,
                errors,
                skipped_reasons,
            ],
        )?;
        let id = self.conn.last_insert_rowid();
        // Budama: en yeni RETENTION disindakileri sil (id monoton → id sirasi = zaman; ts-esitliginde
        // de deterministik).
        self.conn.execute(
            "DELETE FROM scan_reports WHERE id NOT IN
                 (SELECT id FROM scan_reports ORDER BY id DESC LIMIT ?1)",
            params![SCAN_REPORT_RETENTION],
        )?;
        Ok(id)
    }

    /// Rapor ozetleri, en yeni once (ts DESC, id DESC — ts-esitliginde stabil). `limit`
    /// 1..=RETENTION'a kelepcelenir. HAFIF: warning/error sayilari `json_array_length` ile
    /// hesaplanir (agir JSON listeleri Rust'a yuklenmez).
    pub fn list_scan_report_summaries(&self, limit: i64) -> Result<Vec<ScanReportSummary>, DbError> {
        let limit = limit.clamp(1, SCAN_REPORT_RETENTION);
        let mut stmt = self.conn.prepare(
            "SELECT id, ts, root_path, mode, added, updated, skipped, failed, removed, elapsed_ms,
                    json_array_length(warnings), json_array_length(errors),
                    json_array_length(skipped_reasons)
             FROM scan_reports
             ORDER BY ts DESC, id DESC
             LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(ScanReportSummary {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    root_path: r.get(2)?,
                    mode: r.get(3)?,
                    added: r.get(4)?,
                    updated: r.get(5)?,
                    skipped: r.get(6)?,
                    failed: r.get(7)?,
                    removed: r.get(8)?,
                    elapsed_ms: r.get(9)?,
                    warning_count: r.get(10)?,
                    error_count: r.get(11)?,
                    skipped_reason_count: r.get(12)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Tek raporun TAM detayi (JSON listeleri parse edilmis). Yok → `None`. Bozuk/eksik JSON'a
    /// **graceful**: parse dusen liste bos kabul edilir (panik YOK; sayimlar parse sonucundan).
    pub fn get_scan_report_detail(&self, id: i64) -> Result<Option<ScanReportDetail>, DbError> {
        let row = self
            .conn
            .query_row(
                "SELECT id, ts, root_path, mode, added, updated, skipped, failed, removed,
                        elapsed_ms, type_counts, warnings, errors, skipped_reasons
                 FROM scan_reports WHERE id = ?1",
                params![id],
                |r| {
                    let summary = ScanReportSummary {
                        id: r.get(0)?,
                        ts: r.get(1)?,
                        root_path: r.get(2)?,
                        mode: r.get(3)?,
                        added: r.get(4)?,
                        updated: r.get(5)?,
                        skipped: r.get(6)?,
                        failed: r.get(7)?,
                        removed: r.get(8)?,
                        elapsed_ms: r.get(9)?,
                        // Sayimlar parse SONRASI doldurulur (asagida).
                        warning_count: 0,
                        error_count: 0,
                        skipped_reason_count: 0,
                    };
                    let type_counts_json: String = r.get(10)?;
                    let warnings_json: String = r.get(11)?;
                    let errors_json: String = r.get(12)?;
                    let skipped_json: String = r.get(13)?;
                    Ok((summary, type_counts_json, warnings_json, errors_json, skipped_json))
                },
            )
            .optional()?;

        let Some((mut summary, tc_json, w_json, e_json, sk_json)) = row else {
            return Ok(None);
        };

        // Graceful: bozuk/eksik JSON → bos liste (panik yok).
        let type_counts: Vec<(String, usize)> = serde_json::from_str(&tc_json).unwrap_or_default();
        let warnings: Vec<(String, String)> = serde_json::from_str(&w_json).unwrap_or_default();
        let errors: Vec<(String, String)> = serde_json::from_str(&e_json).unwrap_or_default();
        let skipped_reasons: Vec<(String, String)> =
            serde_json::from_str(&sk_json).unwrap_or_default();
        summary.warning_count = warnings.len() as i64;
        summary.error_count = errors.len() as i64;
        summary.skipped_reason_count = skipped_reasons.len() as i64;

        Ok(Some(ScanReportDetail { summary, type_counts, warnings, errors, skipped_reasons }))
    }

    /// Tum tarama raporu gecmisini sil → silinen satir sayisi.
    pub fn clear_scan_reports(&self) -> Result<usize, DbError> {
        Ok(self.conn.execute("DELETE FROM scan_reports", [])?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn sample_input(ts: i64, root: &str) -> ScanReportInput {
        ScanReportInput {
            root_path: root.to_string(),
            mode: "merge".into(),
            ts,
            added: 1,
            updated: 0,
            skipped: 0,
            failed: 0,
            removed: 0,
            elapsed_ms: 10,
            type_counts: vec![],
            warnings: vec![],
            errors: vec![],
            skipped_reasons: vec![],
        }
    }

    #[test]
    fn record_prunes_to_retention_oldest_dropped() {
        let db = Db::open_in_memory_migrated().unwrap();
        // RETENTION + 1 kayit → en eski (ts=0, root0) budanmis olmali.
        for i in 0..=SCAN_REPORT_RETENTION {
            db.record_scan_report(&sample_input(i, &format!("root{i}"))).unwrap();
        }
        // list limit RETENTION'a kelepcelenir → en fazla 50 doner.
        let list = db.list_scan_report_summaries(SCAN_REPORT_RETENTION + 100).unwrap();
        assert_eq!(list.len() as i64, SCAN_REPORT_RETENTION, "fazlasi budanir");
        // En yeni once (ts DESC).
        assert_eq!(list[0].root_path, format!("root{SCAN_REPORT_RETENTION}"));
        // En eski (root0) listede YOK.
        assert!(list.iter().all(|s| s.root_path != "root0"), "en eski budandi");
    }

    #[test]
    fn list_is_newest_first_with_issue_counts() {
        let db = Db::open_in_memory_migrated().unwrap();
        let mut a = sample_input(100, "A");
        a.warnings = vec![("p1".into(), "w1".into())];
        db.record_scan_report(&a).unwrap();

        let mut b = sample_input(200, "B");
        b.errors = vec![("e1".into(), "m1".into()), ("e2".into(), "m2".into())];
        b.skipped_reasons = vec![(".git".into(), "hidden".into())];
        db.record_scan_report(&b).unwrap();

        let list = db.list_scan_report_summaries(10).unwrap();
        assert_eq!(list.len(), 2);
        // B daha yeni (ts=200) → once.
        assert_eq!(list[0].root_path, "B");
        assert_eq!(list[0].warning_count, 0);
        assert_eq!(list[0].error_count, 2);
        assert_eq!(list[0].skipped_reason_count, 1);
        assert_eq!(list[1].root_path, "A");
        assert_eq!(list[1].warning_count, 1);
        assert_eq!(list[1].error_count, 0);
        assert_eq!(list[1].skipped_reason_count, 0);
    }

    #[test]
    fn get_detail_roundtrips_json_lists() {
        let db = Db::open_in_memory_migrated().unwrap();
        let mut input = sample_input(100, r"C:\proj");
        input.mode = "replace".into();
        input.added = 7;
        input.removed = 3;
        input.elapsed_ms = 4321;
        input.type_counts = vec![("dwg".into(), 5), ("pdf".into(), 2)];
        input.warnings = vec![("a.dwg".into(), "cikarim dustu".into())];
        input.errors = vec![("b.pdf".into(), "hash hatasi".into()), ("c".into(), "stat".into())];
        input.skipped_reasons = vec![
            (".git".into(), "hidden".into()),
            ("kilitli_klasor".into(), "unreadable".into()),
        ];
        let id = db.record_scan_report(&input).unwrap();

        let detail = db.get_scan_report_detail(id).unwrap().unwrap();
        assert_eq!(detail.summary.root_path, r"C:\proj");
        assert_eq!(detail.summary.mode, "replace");
        assert_eq!(detail.summary.added, 7);
        assert_eq!(detail.summary.removed, 3);
        assert_eq!(detail.summary.elapsed_ms, 4321);
        // JSON round-trip: aynen doner.
        assert_eq!(detail.type_counts, vec![("dwg".to_string(), 5), ("pdf".to_string(), 2)]);
        assert_eq!(detail.warnings, vec![("a.dwg".to_string(), "cikarim dustu".to_string())]);
        assert_eq!(
            detail.errors,
            vec![
                ("b.pdf".to_string(), "hash hatasi".to_string()),
                ("c".to_string(), "stat".to_string()),
            ]
        );
        // ④-C: skipped_reasons de round-trip eder.
        assert_eq!(
            detail.skipped_reasons,
            vec![
                (".git".to_string(), "hidden".to_string()),
                ("kilitli_klasor".to_string(), "unreadable".to_string()),
            ]
        );
        // Sayimlar parse'tan.
        assert_eq!(detail.summary.warning_count, 1);
        assert_eq!(detail.summary.error_count, 2);
        assert_eq!(detail.summary.skipped_reason_count, 2);

        // Olmayan id → None.
        assert!(db.get_scan_report_detail(9999).unwrap().is_none());
    }

    #[test]
    fn clear_removes_all_reports() {
        let db = Db::open_in_memory_migrated().unwrap();
        db.record_scan_report(&sample_input(1, "A")).unwrap();
        db.record_scan_report(&sample_input(2, "B")).unwrap();
        let removed = db.clear_scan_reports().unwrap();
        assert_eq!(removed, 2);
        assert!(db.list_scan_report_summaries(10).unwrap().is_empty());
    }

    #[test]
    fn get_detail_is_graceful_on_corrupt_json() {
        let db = Db::open_in_memory_migrated().unwrap();
        let id = db.record_scan_report(&sample_input(1, "A")).unwrap();
        // Sutunlari bozuk/eksik JSON ile ez (bir sekilde bozulmus kayit): panik ATMAMALI.
        db.connection()
            .execute(
                "UPDATE scan_reports
                    SET type_counts='', warnings='not json', errors='{bad', skipped_reasons='[oops'
                 WHERE id=?1",
                params![id],
            )
            .unwrap();
        let detail = db.get_scan_report_detail(id).unwrap().unwrap();
        assert!(detail.type_counts.is_empty(), "bozuk type_counts → bos");
        assert!(detail.warnings.is_empty(), "bozuk warnings → bos");
        assert!(detail.errors.is_empty(), "bozuk errors → bos");
        assert!(detail.skipped_reasons.is_empty(), "bozuk skipped_reasons → bos");
        assert_eq!(detail.summary.warning_count, 0);
        assert_eq!(detail.summary.error_count, 0);
        assert_eq!(detail.summary.skipped_reason_count, 0);
    }
}
