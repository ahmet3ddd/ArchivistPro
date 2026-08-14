//! Staleness + fixity cekirdek denetimi (Doctor'un FS ayagi) integrasyon testleri.
//!
//! GERCEK dosyalar (`tempfile`) + bellek-ici `Db` (gercek path'li asset) ile:
//! - staleness: Ok / Stale / Missing + ±2 sn tolerans + Offline (kok erisilemez) TETIKLENMEZ.
//! - **offline guard (H2 false-positive fix):** var-olmayan kok → hepsi Offline (missing DEGIL).
//! - fixity: Ok / Mismatch / Missing + NoBaseline on-filtre + sample_pct kelepceleme.
//!
//! mtime testleri `filetime` DEP'ine bagli DEGIL: dosyanin GERCEK disk mtime'i okunur, asset'in
//! `modified_at`'i ona gore (esit / +1sn / +1000sn / var-olmayan) tohumlanir → OS-agnostik.

use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

use archivist_db::Db;
use archivist_ingest::hash::blake3_file;
use archivist_ingest::{
    check_fixity, check_office_formats, check_staleness, FixityKind, OfficeFormatKind, StaleKind,
};

/// Aktif (deleted_at NULL) asset satiri ekle — path/modified_at/content_hash test-kontrollu.
fn insert_asset(db: &Db, path: &str, modified_at: i64, content_hash: Option<&str>) {
    let file_name = Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string());
    db.connection()
        .execute(
            "INSERT INTO assets(path, file_name, size_bytes, content_hash, created_at, modified_at)
             VALUES (?1, ?2, 0, ?3, 1, ?4)",
            rusqlite::params![path, file_name, content_hash, modified_at],
        )
        .unwrap();
}

/// Bir dosyanin GERCEK disk mtime'i (unix saniye) — check_staleness ile ayni donusum.
fn disk_mtime(path: &Path) -> i64 {
    fs::metadata(path)
        .unwrap()
        .modified()
        .unwrap()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

#[test]
fn staleness_ok_stale_missing_and_tolerance() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open_in_memory_migrated().unwrap();

    // (a) Ok: dosya var, modified_at = disk mtime (tam esit).
    let ok_path = dir.path().join("ok.txt");
    fs::write(&ok_path, b"guncel").unwrap();
    insert_asset(&db, ok_path.to_str().unwrap(), disk_mtime(&ok_path), None);

    // (b) Tolerans: modified_at disk'ten 1 sn farkli (±2 sn icinde) → hala Ok (Stale DEGIL).
    let tol_path = dir.path().join("tolerans.txt");
    fs::write(&tol_path, b"tolerans").unwrap();
    insert_asset(&db, tol_path.to_str().unwrap(), disk_mtime(&tol_path) + 1, None);

    // (c) Stale: modified_at disk'ten cok farkli (>2 sn) → disk-disi degistirilmis.
    let stale_path = dir.path().join("stale.txt");
    fs::write(&stale_path, b"eski").unwrap();
    insert_asset(&db, stale_path.to_str().unwrap(), disk_mtime(&stale_path) + 1000, None);

    // (d) Missing: asset kayitli ama dosya dizinde yok (kok=tempdir erisilebilir → Offline DEGIL).
    let missing_path = dir.path().join("yok.txt");
    insert_asset(&db, missing_path.to_str().unwrap(), 12_345, None);

    let rep = check_staleness(&db).unwrap();
    assert_eq!(rep.total, 4);
    assert_eq!(rep.ok, 2, "ok + tolerans(1sn) → 2 Ok");
    assert_eq!(rep.stale, 1);
    assert_eq!(rep.missing, 1);
    assert_eq!(rep.offline, 0, "gercek tempdir kok → Offline tetiklenmez");

    // Ornekler yalniz stale + missing (offline ve ok HARIC).
    assert_eq!(rep.samples.len(), 2);
    assert_eq!(rep.problem_statuses.len(), 2, "kart rozetleri için tüm sorunlu kimlikler gelmeli");
    assert!(rep.samples.iter().any(|s| s.kind == StaleKind::Stale));
    assert!(rep.samples.iter().any(|s| s.kind == StaleKind::Missing));
    assert!(rep.samples.iter().all(|s| s.kind != StaleKind::Offline && s.kind != StaleKind::Ok));
    assert!(
        rep.problem_statuses
            .iter()
            .all(|s| s.kind == StaleKind::Stale || s.kind == StaleKind::Missing)
    );
}

/// **H2 false-positive kapatma:** kok (ust-dizin) erisilemezse asset'ler `Offline` sayilir,
/// `Missing` DEGIL — disk cikarilinca "tum arsiv silinmis" alarmi olusmaz.
#[test]
fn offline_guard_marks_inaccessible_root_offline_not_missing() {
    let db = Db::open_in_memory_migrated().unwrap();

    // Platformda kesin var-olmayan bir kok (disk cikarilmis / tasinmis klasor simulasyonu).
    let fake_root = if cfg!(windows) {
        Path::new(r"C:\__arsiv_h3_yok_test__\proje")
    } else {
        Path::new("/__arsiv_h3_yok_test__/proje")
    };
    assert!(!fake_root.is_dir(), "on-kosul: kok gercekten erisilemez olmali");

    insert_asset(&db, fake_root.join("a.txt").to_str().unwrap(), 100, None);
    insert_asset(&db, fake_root.join("b.txt").to_str().unwrap(), 200, None);

    let rep = check_staleness(&db).unwrap();
    assert_eq!(rep.total, 2);
    assert_eq!(rep.offline, 2, "erisilemez kok → hepsi Offline");
    assert_eq!(rep.missing, 0, "H2 false-positive kapatildi: Missing'e SAYILMAZ");
    assert_eq!(rep.stale, 0);
    assert_eq!(rep.ok, 0);
    assert!(rep.samples.is_empty(), "offline ornege girmez (gurultu)");
    assert!(rep.problem_statuses.is_empty(), "offline kart rozeti de almaz");
}

#[test]
fn fixity_ok_mismatch_missing_and_baseline_filter() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open_in_memory_migrated().unwrap();

    // (a) Ok: gercek BLAKE3 baseline, dosya degismedi.
    let ok_path = dir.path().join("saglam.bin");
    fs::write(&ok_path, b"orijinal icerik").unwrap();
    let ok_hash = blake3_file(&ok_path).unwrap();
    insert_asset(&db, ok_path.to_str().unwrap(), 1, Some(&ok_hash));

    // (b) Mismatch: baseline eski icerige ait; dosya sonradan BOZULDU (bit-rot benzeri).
    let bad_path = dir.path().join("bozuk.bin");
    fs::write(&bad_path, b"orijinal").unwrap();
    let bad_hash = blake3_file(&bad_path).unwrap();
    fs::write(&bad_path, b"BOZULDU farkli icerik").unwrap();
    insert_asset(&db, bad_path.to_str().unwrap(), 1, Some(&bad_hash));

    // (c) Missing: baseline var ama dosya yok (rehash acilamaz).
    let gone_path = dir.path().join("kayip.bin");
    insert_asset(&db, gone_path.to_str().unwrap(), 1, Some("deadbeef"));

    // (d) NoBaseline: content_hash NULL → orneklem ON-FILTRE ile dislar (fixity anlamsiz).
    let nb_path = dir.path().join("baselinesiz.bin");
    fs::write(&nb_path, b"baseline yok").unwrap();
    insert_asset(&db, nb_path.to_str().unwrap(), 1, None);

    // %100 orneklem → tum baseline'li asset'ler (NoBaseline haric = 3).
    let rep = check_fixity(&db, 100).unwrap();
    assert_eq!(rep.sampled, 3, "yalniz baseline'li 3 asset orneklendi (NoBaseline haric)");
    assert_eq!(rep.ok, 1);
    assert_eq!(rep.mismatch, 1);
    assert_eq!(rep.missing, 1);
    assert_eq!(rep.no_baseline, 0, "baselinesiz on-filtre ile dislandi → sayilmadi");

    // Listelenen: mismatch + missing (ok listelenmez).
    assert_eq!(rep.mismatches.len(), 2);
    assert!(rep.mismatches.iter().any(|m| m.kind == FixityKind::Mismatch));
    assert!(rep.mismatches.iter().any(|m| m.kind == FixityKind::Missing));
    assert!(rep.mismatches.iter().all(|m| m.kind != FixityKind::Ok));
}

#[test]
fn fixity_sample_pct_is_clamped() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open_in_memory_migrated().unwrap();

    // 4 baseline'li saglam dosya (path ASC deterministik → STRIDE ornekleme sabit).
    for i in 0..4 {
        let p = dir.path().join(format!("f{i}.bin"));
        fs::write(&p, format!("icerik-{i}")).unwrap();
        let h = blake3_file(&p).unwrap();
        insert_asset(&db, p.to_str().unwrap(), 1, Some(&h));
    }

    // pct=0 → 1'e kelepce → stride=100 → 4 asset icinden yalniz 1 (indeks 0).
    let low = check_fixity(&db, 0).unwrap();
    assert_eq!(low.sampled, 1, "pct 0→1: stride 100 → 1 orneklendi");
    assert_eq!(low.ok, 1);

    // pct=200 → 100'e kelepce → stride=1 → hepsi (4).
    let high = check_fixity(&db, 200).unwrap();
    assert_eq!(high.sampled, 4, "pct 200→100: stride 1 → hepsi");
    assert_eq!(high.ok, 4, "hepsi saglam");
}

#[test]
fn office_format_check_reports_legacy_and_extension_mismatches() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open_in_memory_migrated().unwrap();
    let ole = b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1";
    let zip = b"PK\x03\x04rest";

    // Gerçek eski ikili belge → tanı görünür ama uzantısı doğru.
    let legacy = dir.path().join("eski.doc");
    fs::write(&legacy, ole).unwrap();
    insert_asset(&db, legacy.to_str().unwrap(), 1, None);

    // Modern uzantı + ikili içerik ve eski uzantı + OOXML ZIP içerik: ikisi de çelişki.
    let modern_named_binary = dir.path().join("yanlis.docx");
    fs::write(&modern_named_binary, ole).unwrap();
    insert_asset(&db, modern_named_binary.to_str().unwrap(), 1, None);
    let legacy_named_zip = dir.path().join("yeniden_adlandir.xls");
    fs::write(&legacy_named_zip, zip).unwrap();
    insert_asset(&db, legacy_named_zip.to_str().unwrap(), 1, None);

    // Normal OOXML görünmez; Office olmayan dosya denetim dışıdır.
    let modern = dir.path().join("guncel.xlsx");
    fs::write(&modern, zip).unwrap();
    insert_asset(&db, modern.to_str().unwrap(), 1, None);
    let text = dir.path().join("not.txt");
    fs::write(&text, b"not").unwrap();
    insert_asset(&db, text.to_str().unwrap(), 1, None);

    let unknown = dir.path().join("bozuk.pptx");
    fs::write(&unknown, b"not-office").unwrap();
    insert_asset(&db, unknown.to_str().unwrap(), 1, None);

    // Boş modern uzantılı dosya erişilebilir olduğu halde geçerli Office imzası
    // taşımaz; görünmez kalmamalıdır.
    let empty = dir.path().join("bos.docx");
    fs::write(&empty, b"").unwrap();
    insert_asset(&db, empty.to_str().unwrap(), 1, None);

    let report = check_office_formats(&db).unwrap();
    assert_eq!(report.checked, 6);
    assert_eq!(report.legacy_binary, 1);
    assert_eq!(report.extension_mismatch, 2);
    assert_eq!(report.unknown, 2);
    assert_eq!(report.items.len(), 5);
    assert!(report.items.iter().any(|item| item.kind == OfficeFormatKind::LegacyBinary));
    assert_eq!(
        report
            .items
            .iter()
            .filter(|item| item.kind == OfficeFormatKind::ExtensionMismatch)
            .count(),
        2
    );
    assert_eq!(
        report
            .items
            .iter()
            .filter(|item| item.kind == OfficeFormatKind::Unknown)
            .count(),
        2
    );
}
