//! Zorla yeniden-indeksleme — cikarici iyilesince (or. PSD/EPS thumbnail) mevcut asset backfill.

use std::collections::HashMap;
use std::path::Path;

use archivist_db::{Db, Fingerprint};
use archivist_extract::Registry;

use super::prepare::{prepare_one, write_prepared, PrepResult, Prepared};
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

/// Bir dosyanin **DB'siz** hazirlanmis cikarimi (stat + hash + extract sonucu). Icerigi OPAKTIR:
/// cagiran onu yalnizca [`reindex_write`] ile DB'ye yazar.
///
/// Neden var: cikarim YAVAS (buyuk PDF/DWG'de saniyeler—dakikalar), yazim ise KISA. Ikisi ayri
/// adim olunca cagiran yazma kilidini yalniz yazim boyunca tutar (bkz [`reindex_paths_with`]).
pub struct ReindexPrep(Box<Prepared>);

/// Hazirlanmis cikarimi DB'ye yaz (**KISA** adim — cagiran yazma kilidini yalniz burada tutmali).
/// Doner: olumcul-olmayan cikarim/yazim uyarilari (rapora akitilir).
pub fn reindex_write(db: &mut Db, prep: &mut ReindexPrep) -> Result<Vec<String>, String> {
    write_prepared(db, &mut prep.0)?;
    Ok(std::mem::take(&mut prep.0.warns))
}

/// Reindex'in sabit secenekleri: `skip_unchanged=false` → degismese bile yeniden cikar.
/// mode/concurrency/auto_project reindex'te onemsiz (per-yol yeniden-cikar; oto-proje
/// post-pass'i CALISMAZ).
fn reindex_opts() -> IngestOpts {
    IngestOpts {
        skip_unchanged: false,
        mode: IngestMode::Merge,
        concurrency: 0,
        auto_project: false,
        auto_project_status: None,
    }
}

/// Verilen YOLLARI **zorla yeniden-indeksle** (skip YOK) — cikarim burada, **yazim `write`
/// geri-cagrisinda** yapilir. Cagiran boylece DB kilidini yalniz `write` suresince tutar; yavas
/// cikarim kilitsiz kosar.
///
/// **Neden boyle (2026-08-20 kullanici bulgusu):** komut katmani eskiden kilidi TUM batch boyunca
/// tutuyordu → ayni anda kosan AI gorsel-analizi ilk kilit talebinde donuyor, "İptal" de cevapsiz
/// kaliyordu (bayrak set edilir ama dongu kilidi geri alamaz). Cikarim/yazim ayrimi bunu yapisal
/// olarak cozer.
///
/// `write` HATA dondururse o yol `failed` sayilir ve batch DEVAM EDER (tek dosya tum isi kesmez).
pub fn reindex_paths_with<W, E>(
    reg: &Registry,
    paths: &[String],
    mut write: W,
    mut emit: E,
) -> ReindexReport
where
    W: FnMut(&mut ReindexPrep) -> Result<Vec<String>, String>,
    E: FnMut(usize, usize),
{
    let opts = reindex_opts();
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
        // YAVAS kisim — kilitsiz (cagiran kilidi yalniz `write` icinde alir).
        match prepare_one(Path::new(path), &empty_fps, reg, &opts) {
            PrepResult::Ready(prepared) => {
                let mut prep = ReindexPrep(prepared);
                match write(&mut prep) {
                    Ok(warns) => {
                        report.reindexed += 1;
                        for w in warns {
                            push_capped(&mut report.warnings, &mut report.dropped_entries, (path.clone(), w));
                        }
                    }
                    Err(e) => {
                        report.failed += 1;
                        push_capped(&mut report.errors, &mut report.dropped_entries, (path.clone(), e));
                    }
                }
            }
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

/// [`reindex_paths_with`]'in tek-kilitli kolayligi: cagiranin ELINDE zaten `&mut Db` varken
/// (test/kitaplik kullanimi) her yol icin dogrudan yazar. Tauri komut katmani bunu KULLANMAZ —
/// orada kilit dosya-basi alinir (bkz `reindex_commands::reindex_assets`).
pub fn reindex_paths(
    db: &mut Db,
    reg: &Registry,
    paths: &[String],
    emit: impl FnMut(usize, usize),
) -> ReindexReport {
    reindex_paths_with(reg, paths, |prep| reindex_write(db, prep), emit)
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

    /// `reindex_paths_with` SOZLESMESI (kilit dosya-basi): `write` yalniz CIKARIMI BASARILI olan
    /// yollar icin ve yol basina TEK KEZ cagrilir (kilit tutma penceresi = bu cagri). Eksik dosya
    /// hic yazdirmaz. — Komut katmani kilidi tam bu geri-cagri icinde alir; cagri sayisi/yeri
    /// degisirse kilit davranisi da degisirdi.
    #[test]
    fn reindex_paths_with_calls_write_once_per_existing_path() {
        let dir = tempfile::tempdir().unwrap();
        let mut paths = Vec::new();
        for name in ["a.txt", "b.txt"] {
            let f = dir.path().join(name);
            std::fs::write(&f, b"icerik").unwrap();
            paths.push(f.to_string_lossy().to_string());
        }
        paths.push(dir.path().join("yok.txt").to_string_lossy().to_string());

        let mut db = Db::open_in_memory_migrated().unwrap();
        let reg = crate::build_registry();
        let mut writes = 0usize;
        let rep = reindex_paths_with(
            &reg,
            &paths,
            |prep| {
                writes += 1;
                reindex_write(&mut db, prep)
            },
            |_, _| {},
        );

        assert_eq!(writes, 2, "yalniz var olan iki dosya icin yazim cagrisi");
        assert_eq!(rep.reindexed, 2);
        assert_eq!(rep.missing, 1);
    }

    /// Tek yolun YAZIMI basarisiz olursa batch DURMAZ: o yol `failed` sayilir, kalan yollar
    /// islenmeye devam eder (komut katmaninda kilit alinamamasi da bu yola duser).
    #[test]
    fn reindex_paths_with_write_error_is_per_path_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let mut paths = Vec::new();
        for name in ["a.txt", "b.txt"] {
            let f = dir.path().join(name);
            std::fs::write(&f, b"icerik").unwrap();
            paths.push(f.to_string_lossy().to_string());
        }

        let mut db = Db::open_in_memory_migrated().unwrap();
        let reg = crate::build_registry();
        let mut first = true;
        let rep = reindex_paths_with(
            &reg,
            &paths,
            |prep| {
                if std::mem::take(&mut first) {
                    return Err("kilit alinamadi".to_string());
                }
                reindex_write(&mut db, prep)
            },
            |_, _| {},
        );

        assert_eq!(rep.failed, 1, "yazim hatasi o yola ait");
        assert_eq!(rep.reindexed, 1, "batch devam etmeli");
        assert!(rep.errors.iter().any(|(_, m)| m == "kilit alinamadi"));
    }
}
