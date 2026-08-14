//! Gercek DWG cikarim ciktisi dokumu — GUI'siz denetim araci.
//!
//! Kullanim:
//!   cargo run -p archivist-extract-cad --example dump_dwg -- <path.dwg>         # raw-scan
//!   cargo run -p archivist-extract-cad --example dump_dwg -- <path.dwg> --oda   # ODA→DXF (temiz)
//!
//! Panelde gorunecek metadata'nin BIREBIR aynisini yazar; raw-scan vs ODA kalitesini
//! gozle karsilastirmak icin.

use std::path::Path;

use archivist_extract::{ExtractInput, Extracted, Extractor, MetaValue};
use archivist_extract_cad::{oda, DwgExtractor};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let Some(path) = args.get(1) else {
        eprintln!("kullanim: dump_dwg <path.dwg> [--oda]");
        std::process::exit(2);
    };
    let use_oda = args.iter().any(|a| a == "--oda");

    let result: Result<Extracted, String> = if use_oda {
        let cache = std::env::temp_dir().join("archivist_oda_cache");
        oda::extract_dwg(path, &cache).map_err(|e| format!("{e:?}"))
    } else {
        let input = ExtractInput::from_path(Path::new(path)).expect("girdi olusturulamadi");
        DwgExtractor.extract(&input).map_err(|e| format!("{e:?}"))
    };

    match result {
        Ok(e) => print_extracted(if use_oda { "ODA→DXF" } else { "RAW-SCAN" }, &e),
        Err(err) => {
            println!("MODE: {}  → BASARISIZ: {err}", if use_oda { "ODA→DXF" } else { "RAW-SCAN" });
            std::process::exit(1);
        }
    }
}

fn print_extracted(mode: &str, e: &Extracted) {
    println!("==================== MODE: {mode} ====================");
    println!("text_len   : {}", e.text.as_ref().map_or(0, String::len));
    println!("thumbnail  : {}", e.thumbnail.is_some());
    println!("field_count: {}", e.fields.len());
    println!("-------------------- fields --------------------");
    for (k, v) in &e.fields {
        let s = match v {
            MetaValue::Str(s) => s.clone(),
            other => format!("{other:?}"),
        };
        let count = s.chars().count();
        let shown: String = s.chars().take(500).collect();
        let suffix = if count > 500 { format!(" …[+{} char kesildi]", count - 500) } else { String::new() };
        println!("  {k} = {shown}{suffix}");
    }
}
