//! Zorla yeniden-indeksleme — cikarici iyilesince (or. PSD/EPS thumbnail) mevcut asset backfill.

use std::collections::HashMap;
use std::path::Path;

use archivist_db::{Db, Fingerprint};
use archivist_extract::Registry;

use super::prepare::{prepare_one, write_prepared, PrepResult};
use super::{push_capped, IngestMode, IngestOpts};

/// Zorla-yeniden-indeks raporu — cikarici iyilesince (or. PSD/EPS thumbnail) mevcut asset backfill.
#[derive(Debug, Default, Clone)]
pub struct ReindexReport {
    /// Basariyla yeniden-cikarilip yazilan asset sayisi.
    pub reindexed: usize,
    /// Kaynak dosya bu makinede erisilemez (baska lokasyon) → atlandi.
    pub missing: usize,
    /// Var olan dosyada cikarim/yazim hatasi.
    pub failed: usize,
    /// Olumcul-olmayan cikarim uyarilari `(path, mesaj)`.
    /// ⚠️ [`super::REPORT_MAX_ENTRIES`] ile KELEPCELI (bkz `dropped_entries`).
    pub warnings: Vec<(String, String)>,
    /// Eksik/hatali yollar `(path, mesaj)`.
    /// ⚠️ KELEPCELI → sayim icin `failed`/`missing` kullanilmali, `errors.len()` DEGIL.
    pub errors: Vec<(String, String)>,
    /// Tavan yuzunden kaydedilmeyen rapor girdisi sayisi (0 = liste tam).
    /// Bkz [`super::IngestReport::dropped_entries`] — ayni gerekce.
    pub dropped_entries: usize,
}

/// Verilen YOLLARI **zorla yeniden-indeksle** (skip YOK) — cikarici iyilesince (or. PSD/EPS
/// thumbnail) mevcut asset'leri geri-doldurmak icin. Her yol: extract → `Db::ingest` upsert
/// (`ON CONFLICT(path)` → **asset id KORUNUR** → etiket/favori/koleksiyon/iliski/ai_ metadata sag
/// kalir). Kaynak dosya erisilemezse (baska makine — cok-lokasyon) o yol ATLANIR (`missing`).
/// `emit(processed, total)` ilerleme. Seri (SQLite tek-yazici; cagiran db kilidini tutar).
pub fn reindex_paths(
    db: &mut Db,
    reg: &Registry,
    paths: &[String],
    mut emit: impl FnMut(usize, usize),
) -> ReindexReport {
    // skip_unchanged=false → degismese bile yeniden cikar. mode/concurrency/auto_project
    // reindex'te onemsiz (per-yol yeniden-cikar; oto-proje post-pass'i CALISMAZ).
    let opts = IngestOpts {
        skip_unchanged: false,
        mode: IngestMode::Merge,
        concurrency: 0,
        auto_project: false,
        auto_project_status: None,
    };
    let empty_fps: HashMap<String, Fingerprint> = HashMap::new();
    let total = paths.len();
    let mut report = ReindexReport::default();
    for (i, path) in paths.iter().enumerate() {
        emit(i, total);
        // Cok-lokasyon: DB burada ama kaynak dosyalar baska diskte olabilir → erisilemezse missing.
        if !Path::new(path).is_file() {
            report.missing += 1;
            push_capped(&mut report.errors, &mut report.dropped_entries, (path.clone(), "kaynak dosya bu makinede erisilemez".to_string()));
            continue;
        }
        match prepare_one(Path::new(path), &empty_fps, reg, &opts) {
            PrepResult::Ready(mut prepared) => match write_prepared(db, &mut prepared) {
                Ok(()) => {
                    report.reindexed += 1;
                    for w in &prepared.warns {
                        push_capped(&mut report.warnings, &mut report.dropped_entries, (path.clone(), w.clone()));
                    }
                }
                Err(e) => {
                    report.failed += 1;
                    push_capped(&mut report.errors, &mut report.dropped_entries, (path.clone(), e));
                }
            },
            PrepResult::Skip => {} // skip_unchanged=false → olusmaz
            PrepResult::Error(e) => {
                report.failed += 1;
                push_capped(&mut report.errors, &mut report.dropped_entries, (path.clone(), e));
            }
        }
    }
    emit(total, total);
    report
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `reindex_paths`: var olan dosya zorla yeniden-indekslenir (skip yok); bu makinede olmayan
    /// yol `missing` sayilir (cok-lokasyon: kaynak baska diskte). Ilerleme total/total ile biter.
    #[test]
    fn reindex_paths_writes_existing_and_reports_missing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("note.txt");
        std::fs::write(&file, b"merhaba reindex dunyasi").unwrap();
        let existing = file.to_string_lossy().to_string();
        let missing = dir.path().join("yok.txt").to_string_lossy().to_string();

        let mut db = Db::open_in_memory_migrated().unwrap();
        let reg = crate::build_registry();
        let mut progress: Vec<(usize, usize)> = Vec::new();
        let rep = reindex_paths(&mut db, &reg, &[existing, missing], |p, t| progress.push((p, t)));

        assert_eq!(rep.reindexed, 1, "var olan dosya yeniden-indekslenmeli");
        assert_eq!(rep.missing, 1, "olmayan dosya missing");
        assert_eq!(rep.failed, 0);
        assert_eq!(rep.errors.len(), 1); // yalniz missing yol
        assert_eq!(progress.last(), Some(&(2, 2)), "son ilerleme total/total");
    }
}
