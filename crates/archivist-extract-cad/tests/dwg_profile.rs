//! **DWG cikarim profili** — hangi alt-adim ne kadar suruyor?
//!
//! GEREKCE (2026-07-16 UNC bench'i): gercek ofis DWG'lerinin **~%12'si** `Registry`'nin
//! 30sn `EXTRACT_TIMEOUT`'una carpip **metadata'siz** indeksleniyor (yalniz ad/hash/boyut →
//! icerik aranamaz). Dosyalar 7-13 MB — lineer bir bayt taramasi icin 30sn ANLAMSIZ.
//! H2 KONTROL: H2 `dwg_parse.rs`'te **timeout YOK** (dogrulandi) → H2 ayni dosyanin
//! metadata'sini (yavas da olsa) CIKARIR, H3 ATAR ⇒ potansiyel **gerileme**.
//! Bu profil, yavasligin KAYNAGINI olcer (tahmin degil).
//!
//! `#[ignore]` — gercek DWG gerektirir. Calistir:
//! ```powershell
//! $env:ARSIV_DWG='D:\...\Seyir Kosku.dwg'
//! cargo test --release -p archivist-extract-cad --test dwg_profile -- --ignored --nocapture
//! ```

use archivist_extract_cad::dwg::{fields, ole, strings, thumb};
use std::time::Instant;

macro_rules! timed {
    ($label:expr, $total:expr, $body:expr) => {{
        let t = Instant::now();
        let r = $body;
        let ms = t.elapsed().as_secs_f64() * 1000.0;
        $total += ms;
        println!("   {:<26} {:>10.1} ms", $label, ms);
        r
    }};
}

#[test]
#[ignore = "DWG profili; elle: ARSIV_DWG=<dosya> cargo test --release -p archivist-extract-cad --test dwg_profile -- --ignored --nocapture"]
fn dwg_extract_profile() {
    let Ok(path) = std::env::var("ARSIV_DWG") else {
        eprintln!("ATLANDI: ARSIV_DWG verilmedi (ornek: $env:ARSIV_DWG='D:\\...\\x.dwg')");
        return;
    };
    let data = std::fs::read(&path).expect("DWG okunamadi");
    println!("\n=== DWG PROFIL ===");
    println!("Dosya: {path}");
    println!("Boyut: {:.1} MB\n", data.len() as f64 / 1_048_576.0);

    let mut total = 0.0f64;
    let layers = timed!("extract_dwg_layers", total, fields::extract_dwg_layers(&data));
    let blocks = timed!("extract_dwg_blocks", total, fields::extract_dwg_blocks(&data));
    let texts = timed!("extract_dwg_texts", total, fields::extract_dwg_texts(&data));
    let xrefs = timed!("extract_dwg_xrefs", total, fields::extract_dwg_xrefs(&data));
    let imgs = timed!("extract_dwg_image_refs", total, fields::extract_dwg_image_refs(&data));
    let oles = timed!("ole::extract_dwg_ole_objects", total, ole::extract_dwg_ole_objects(&data));
    let _props = timed!("extract_dwg_properties", total, fields::extract_dwg_properties(&data));
    let _units = timed!("extract_dwg_units", total, fields::extract_dwg_units(&data));
    let _date = timed!("get_dwg_creation_date", total, fields::get_dwg_creation_date(&data));
    let thumb = timed!("thumb::dwg_preview_thumbnail", total, thumb::dwg_preview_thumbnail(&data));

    // Ham string taramasi tek basina (karsilastirma tabani): yukaridakilerin cogu bunu cagirir.
    let raw = timed!("[taban] extract_dwg_strings", total, strings::extract_dwg_strings(&data, 2, 255));

    println!("\n   {:<26} {:>10.1} ms  <= TOPLAM", "", total);
    println!(
        "\nSonuc: layers={} blocks={} texts={} xrefs={} imgs={} ole={} thumb={} ham_string={}",
        layers.len(),
        blocks.len(),
        texts.len(),
        xrefs.len(),
        imgs.len(),
        oles.len(),
        thumb.is_some(),
        raw.len()
    );
    println!(
        "MB/s (toplam): {:.1}\n",
        (data.len() as f64 / 1_048_576.0) / (total / 1000.0)
    );

    // --- ASIL SUPHELI: ODA yolu (DwgExtractor ODA kuruluysa ONCE bunu dener) ---
    // `DwgExtractor::extract` ilk is olarak `if oda_available() { oda::extract_dwg(..) }` yapar
    // → PowerShell + ODAFileConverter ALT-SURECI. Yukaridaki raw-scan bu yola HIC girmez.
    // Ingest'te 16 worker AYNI ANDA bunu yapiyor → cekisme → 30s timeout → metadata kaybi.
    // Burada TEK BASINA (cekismesiz) maliyeti olculur → surdurulebilir es-zamanlilik buradan cikar.
    match archivist_extract_cad::oda::detect() {
        Some(exe) => {
            println!("ODA KURULU: {}", exe.display());
            let cache = std::env::temp_dir().join("arsiv_oda_profile_cache");
            let t = Instant::now();
            let r = archivist_extract_cad::oda::extract_dwg(&path, &cache);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            println!("   {:<26} {:>10.1} ms  (TEK dosya, cekismesiz)", "oda::extract_dwg", ms);
            match &r {
                Ok(_) => println!("   ODA donusumu BASARILI"),
                Err(e) => println!("   ODA donusumu HATA: {e:?}"),
            }
            println!(
                "\n   ⇒ raw-scan {:.0} ms vs ODA {:.0} ms  =>  ODA {:.1}x PAHALI",
                total,
                ms,
                ms / total.max(1.0)
            );
            println!(
                "   ⇒ 16 worker AYNI ANDA bunu yaparsa 30s EXTRACT_TIMEOUT'a carpmasi beklenir."
            );
        }
        None => println!("ODA KURULU DEGIL → DwgExtractor raw-scan yolunu kullanir (yukaridaki sureler)"),
    }
}
