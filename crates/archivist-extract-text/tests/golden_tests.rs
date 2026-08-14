//! Golden-file testleri — text ailesi extractor'lari.
//!
//! Yeni fixture eklerken golden'lari uretmek/yenilemek icin:
//! `ARSIV_UPDATE_GOLDEN=1 cargo test -p archivist-extract-text`

use std::path::{Path, PathBuf};

use archivist_extract::golden::assert_golden;
use archivist_extract::{ExtractInput, Extracted, Extractor, Registry};
use archivist_extract_text::{IfcExtractor, TextExtractor};

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures")
}
fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("golden")
}

fn run(extractor: &dyn Extractor, fixture: &str) -> Extracted {
    let path = fixtures_dir().join(fixture);
    let input = ExtractInput::from_path(&path).expect("fixture okunmali");
    extractor.extract(&input).expect("cikarim basarili olmali")
}

#[test]
fn ifc_golden() {
    let out = run(&IfcExtractor, "sample.ifc");
    assert_golden(&out, golden_dir().join("ifc.json"));
}

#[test]
fn text_txt_golden() {
    let out = run(&TextExtractor, "sample.txt");
    assert_golden(&out, golden_dir().join("text_txt.json"));
}

#[test]
fn text_csv_golden() {
    let out = run(&TextExtractor, "sample.csv");
    assert_golden(&out, golden_dir().join("text_csv.json"));
}

#[test]
fn family_registers_all_extensions() {
    let mut reg = Registry::new();
    archivist_extract_text::register(&mut reg);
    for ext in ["ifc", "txt", "csv", "tsv", "rtf", "log", "md", "ini", "pdf"] {
        assert!(reg.for_ext(ext).is_some(), "{ext} kayitli olmali");
    }
}
