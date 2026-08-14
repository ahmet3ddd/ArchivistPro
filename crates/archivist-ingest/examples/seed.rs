//! Tohumlama yardimcisi — bir klasoru verilen DB'ye ingest eder (canli demo/test verisi).
//!
//! UI'nin `ingest_folder` komutuyla AYNI hatti kullanir.
//! Calistir: `cargo run -p archivist-ingest --example seed -- <db_yolu> <klasor>`

use std::path::Path;

use archivist_db::Db;
use archivist_ingest::{build_registry, ingest_folder, IngestOpts};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (Some(db_path), Some(folder)) = (args.get(1), args.get(2)) else {
        eprintln!("kullanim: seed <db_yolu> <klasor>");
        std::process::exit(2);
    };

    let mut db = Db::open_and_migrate(Path::new(db_path)).expect("db acilamadi");
    let reg = build_registry();
    let report = ingest_folder(&mut db, &reg, Path::new(folder), &IngestOpts::default());

    println!(
        "ingest tamam: +{} eklendi  ~{} guncellendi  ={} atlandi  !{} hata",
        report.added, report.updated, report.skipped, report.failed
    );
    for (path, msg) in &report.warnings {
        println!("  uyari: {path} — {msg}");
    }
}
