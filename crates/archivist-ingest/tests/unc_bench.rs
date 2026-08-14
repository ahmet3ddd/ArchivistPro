//! **UNC / ag-paylasimi ingest bench'i** — "DB YERELDE + DOSYALAR AGDA" modeli.
//!
//! GEREKCE (2026-07-16 denetimi): gercek ofis arsivi bir UNC paylasiminda yasiyor
//! (`\\DEPO\...\AKTIF`, guncel isler) + `D:\HASSA-ISLER\PASIF` (arsiv). Ama H3 bugune
//! dek **yalniz yerel diskte** suruldu — 1M smoke dahil TUM olcumler yerel. ⇒ ARCHITECTURE'daki
//! "WAL (yerel) / DELETE (UNC-ag)" ayrimi teorik bir satir olarak kaldi; **ag davranisi
//! (hiz/kilit/journal/kopma) HIC OLCULMEDI.** Bu bench o boslugu kapatir.
//!
//! **Olculen model (kullanici karari 2026-07-16):** DB **yerel** temp'te (→ `is_network_path`
//! false → WAL), taranan kok **parametrik** (agda veya yerelde). H2'nin fiili modeli de budur
//! (`D:\Archivist\*.db` yerel, kokler agda).
//!
//! `#[ignore]` — gercek veri + ag gerektirir, normal `cargo test`'i yavaslatmaz. Calistir:
//! ```powershell
//! $env:ARSIV_BENCH_ROOT='\\DEPO\Yedekler\...\SEYIR KOSKU'
//! cargo test --release -p archivist-ingest --test unc_bench -- --ignored --nocapture
//! ```
//! **KONTROLLU DENEY:** ayni klasoru yerele kopyalayip `ARSIV_BENCH_ROOT`'u oraya cevir →
//! ag/yerel ORANI cikar (tek basina "45 sn surdu" bir sey soylemez; oran soyler).
//! Opsiyonel: `ARSIV_BENCH_CONCURRENCY` (0=oto cekirdek-bazli). Agda gecikme baskin olabilir
//! → yuksek es-zamanlilik yerelden FARKLI davranabilir; olcmek icin buradan degistir.
//!
//! ⚠️ SALT-OKUMA: taranan klasore YAZMAZ (ingest dosyalari yalniz okur/hash'ler).
//! DB her kosuda TEMIZ temp → her dosya "added" sayilir (skip-unchanged devrede degil).

use archivist_db::Db;
use archivist_ingest::{build_registry, ingest_folder, IngestOpts};
use std::path::{Path, PathBuf};
use std::time::Instant;

fn bench_root() -> Option<PathBuf> {
    std::env::var("ARSIV_BENCH_ROOT").ok().filter(|s| !s.trim().is_empty()).map(PathBuf::from)
}

fn concurrency() -> usize {
    std::env::var("ARSIV_BENCH_CONCURRENCY").ok().and_then(|s| s.parse().ok()).unwrap_or(0)
}

/// Klasordeki dosya sayisi + toplam bayt (ingest'ten BAGIMSIZ olcum tabani).
/// Ayrica saf **listeleme (enumeration)** suresini de verir → agda bu tek basina pahalidir.
fn folder_stats(root: &Path) -> (usize, u64, f64) {
    let t = Instant::now();
    let mut n = 0usize;
    let mut bytes = 0u64;
    for e in walkdir::WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if e.file_type().is_file() {
            n += 1;
            if let Ok(m) = e.metadata() {
                bytes += m.len();
            }
        }
    }
    (n, bytes, t.elapsed().as_secs_f64())
}

fn mb(bytes: u64) -> f64 {
    bytes as f64 / 1_048_576.0
}

#[test]
#[ignore = "UNC/ag bench; elle: ARSIV_BENCH_ROOT=<klasor> cargo test --release -p archivist-ingest --test unc_bench -- --ignored --nocapture"]
fn unc_ingest_bench() {
    let Some(root) = bench_root() else {
        eprintln!(
            "ATLANDI: ARSIV_BENCH_ROOT verilmedi.\n\
             Ornek: $env:ARSIV_BENCH_ROOT='\\\\DEPO\\...\\SEYIR KOSKU'"
        );
        return;
    };
    assert!(root.is_dir(), "ARSIV_BENCH_ROOT bir klasor degil / erisilemiyor: {}", root.display());

    let is_unc = root.to_string_lossy().starts_with(r"\\");
    println!("\n=== UNC INGEST BENCH — DB yerel + dosyalar {} ===", if is_unc { "AGDA (UNC)" } else { "YERELDE" });
    println!("Kok         : {}", root.display());

    // --- 1) Taban olcum: listeleme + boyut (ingest'ten bagimsiz) ---
    let (n_files, bytes, enum_s) = folder_stats(&root);
    println!("Dosya       : {n_files}  |  Toplam: {:.1} MB", mb(bytes));
    println!("Listeleme   : {enum_s:.2} sn (saf enumeration — agda tek basina pahali)");
    assert!(n_files > 0, "klasorde dosya yok: {}", root.display());

    // --- 2) DB YERELDE (model geregi): temiz temp → her dosya 'added' ---
    let tmp = tempfile::tempdir().expect("temp dir");
    let db_path = tmp.path().join("bench.db");
    assert!(
        !db_path.to_string_lossy().starts_with(r"\\"),
        "DB YEREL olmali (model: DB yerelde + dosyalar agda), bulunan: {}",
        db_path.display()
    );
    let mut db = Db::open_and_migrate(&db_path).expect("DB ac + migrate");
    let reg = build_registry();
    let opts = IngestOpts { concurrency: concurrency(), ..Default::default() };
    println!("Es-zamanlilik: {} (0=oto cekirdek-bazli)", opts.concurrency);

    // --- 3) INGEST (hash + extract + DB yazimi) ---
    let t = Instant::now();
    let rep = ingest_folder(&mut db, &reg, &root, &opts);
    let secs = t.elapsed().as_secs_f64();

    println!("\n--- SONUC ---");
    println!("Sure        : {secs:.2} sn");
    println!("added={} updated={} skipped={} failed={}", rep.added, rep.updated, rep.skipped, rep.failed);
    println!("Verim       : {:.1} dosya/s  |  {:.1} MB/s (hash tum baytlari okur)", n_files as f64 / secs, mb(bytes) / secs);
    // --- UYARI KIRILIMI (kategori bazli) ---
    // KRITIK: "extractor zaman asimi" = o dosya METADATA'SIZ indekslenir (yalniz ad/hash/boyut).
    // Agda gecikme cikarimi yavaslatir → yerelde 30s'yi geciren dosya sayisi AGDA ARTAR
    // ⇒ ayni arsiv agdan tarandiginda DAHA AZ metadata cikar. Bu bir HIZ degil KALITE sorunudur.
    if !rep.warnings.is_empty() {
        let timeout = rep.warnings.iter().filter(|(_, m)| m.contains("zaman asimi")).count();
        let oda = rep.warnings.iter().filter(|(_, m)| m.contains("ODA")).count();
        let other = rep.warnings.len() - timeout - oda;
        println!("\nUyari toplam : {}", rep.warnings.len());
        println!("   ZAMAN ASIMI : {timeout}  <-- METADATA KAYBI (dosya ad/hash ile indekslendi, icerik cikarilmadi)");
        println!("   ODA yok     : {oda}  (DWG sinirli ikili tarama — ODA kurulu degil)");
        println!("   diger       : {other}");
        if timeout > 0 {
            println!(
                "   ⇒ indekslenen {} asset'in {}'i ({:.0}%) icerik cikarimi OLMADAN girdi",
                rep.added,
                timeout,
                100.0 * timeout as f64 / rep.added.max(1) as f64
            );
        }
    }

    // --- 4) DOGRULUK: UNC yolu DB'ye nasil yazildi? ---
    // Rust'ta `canonicalize` UNC'de `\\?\UNC\...` VERBATIM yol dondurur → DB'ye o sizarsa
    // open/reveal ve yol-eslestirme sessizce bozulur. Ingest yolunda canonicalize YOK
    // (yalniz merge.rs kullanir) → burada REGRESYON NOBETI olarak dogrulanir.
    let verbatim: i64 = db
        .connection()
        .query_row(r"SELECT count(*) FROM assets WHERE path LIKE '\\?\%'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(verbatim, 0, "DB'ye VERBATIM (\\\\?\\) yol sizmis — open/reveal bozulur");

    let indexed: i64 =
        db.connection().query_row("SELECT count(*) FROM assets", [], |r| r.get(0)).unwrap();
    println!("DB'de asset : {indexed}  (desteklenmeyen uzantilar indekslenmez → n_files'tan az olabilir)");

    if is_unc {
        let unc_rows: i64 = db
            .connection()
            .query_row(r"SELECT count(*) FROM assets WHERE path LIKE '\\%'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(unc_rows, indexed, "UNC kokte TUM yollar \\\\sunucu\\... formunda kalmali");
        println!("UNC yol     : {unc_rows}/{indexed} dogru formda (\\\\sunucu\\paylasim\\...)");
    }

    // Ornek yol (gozle dogrulama: Turkce karakterler bozulmamis olmali)
    if let Ok(p) = db.connection().query_row::<String, _, _>(
        "SELECT path FROM assets ORDER BY id LIMIT 1",
        [],
        |r| r.get(0),
    ) {
        println!("Ornek yol   : {p}");
    }

    assert_eq!(rep.failed, 0, "ag uzerinde okuma hatasi olmamali (failed>0 → kararsiz baglanti)");
    println!("=== BENCH BITTI ===\n");
}
