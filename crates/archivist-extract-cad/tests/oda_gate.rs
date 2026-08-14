//! ODA es-zamanlilik kapisi (H2 pariti) — davranis testi.
//!
//! Neden test edilir: kapi olmadan ingest 16 es-zamanli PowerShell+ODA(Qt) sureci baslatiyordu
//! → cekisme → 30sn `EXTRACT_TIMEOUT` → gercek DWG klasorlerinin **~%12'si metadata'siz**
//! indeksleniyordu (2026-07-16 olcumu). Kapi bu sinifi kapatir; sessizce geri gelmemeli.
//!
//! ODA kurulu OLMAYAN makinede de kosar: `convert_dwg_to_dxf` var-olmayan bir DWG icin
//! kapiya girmeden ONCE `Err` doner → sabit sinir + Err-yolunda izin sizmadigi dogrulanir.

use archivist_extract::{Extractor, DEFAULT_EXTRACT_TIMEOUT};
use archivist_extract_cad::oda::ODA_MAX_CONCURRENT;
use archivist_extract_cad::DwgExtractor;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Barrier};

/// DWG **ODA alt-sureci** calistirir → varsayilan 30sn butceyle KALMAMALI.
///
/// OLCUM (2026-07-16): 30 MB gercek ofis DWG'sinde ODA donusumu **25.0 sn** (tek dosya,
/// cekismesiz, BASARILI). 30sn varsayilanda pay yok → en ufak cekismede `Timeout` → **cikarilabilir
/// metadata cope**. Olculen etki: gercek DWG klasorlerinin ~%12'si icerik cikarimi olmadan
/// indeksleniyordu. Biri butceyi varsayilana dusurursa bu test kirilir.
#[test]
fn dwg_budget_exceeds_default_because_it_spawns_oda() {
    let dwg = DwgExtractor.timeout();
    assert!(
        dwg > DEFAULT_EXTRACT_TIMEOUT,
        "DWG butcesi ({dwg:?}) varsayilandan ({DEFAULT_EXTRACT_TIMEOUT:?}) BUYUK olmali — \
         ODA tek dosyada 25sn olculdu; varsayilanda kalirsa cikarilabilir metadata atilir"
    );
}

/// Guvenli varsayilan birden cok ODA/Qt surecinin kaynak diski ve renderer'i ayni anda
/// doyurmasini onler. Ayarlardan degistirilebilir ama cekirdek sayisina gore atlamaz.
#[test]
fn oda_gate_default_is_storage_safe_and_not_core_scaled() {
    assert_eq!(
        ODA_MAX_CONCURRENT, 1,
        "ODA varsayilani kaynak disk ve renderer icin guvenli olmali"
    );
    // Calisma-zamani baslangic degeri de varsayilanla ayni (henuz kimse ayarlamadi).
    assert_eq!(
        archivist_extract_cad::oda::max_concurrent(),
        ODA_MAX_CONCURRENT,
        "baslangicta calisma-zamani sinir varsayilana esit olmali"
    );
}

/// Hata yolunda (gecersiz DWG) izin SIZMAZ: kapi kapasitesi kadar cagri arka arkaya yapilsa
/// bile hicbiri kilitlenmez. Izin sizsaydi ODA_MAX_CONCURRENT+1'inci cagri SONSUZ beklerdi.
#[test]
fn oda_gate_does_not_leak_permit_on_error_path() {
    let fake_exe = Path::new("C:/yok/ODAFileConverter.exe");
    // Kapasitenin 3 katini kos — izin sizsaydi bu test asilirdi (hang → CI timeout).
    for i in 0..(ODA_MAX_CONCURRENT * 3) {
        let r = archivist_extract_cad::oda::convert_dwg_to_dxf("C:/yok/olmayan.dwg", fake_exe);
        assert!(r.is_err(), "var-olmayan DWG icin Err beklenir (cagri {i})");
    }
}

/// Es-zamanli cagrilar birbirini KILITLEMEZ (deadlock yok) ve hepsi tamamlanir.
/// Gecersiz yol → kapiya girmeden Err; kapi mantigi yine de coklu-thread altinda saglam olmali.
#[test]
fn oda_gate_is_deadlock_free_under_contention() {
    let threads = ODA_MAX_CONCURRENT * 4; // kapasiteden fazla → beklemeye zorlar
    let barrier = Arc::new(Barrier::new(threads));
    let done = Arc::new(AtomicUsize::new(0));
    let mut handles = Vec::new();
    for _ in 0..threads {
        let b = Arc::clone(&barrier);
        let d = Arc::clone(&done);
        handles.push(std::thread::spawn(move || {
            b.wait(); // hepsi ayni anda dalsin
            let _ = archivist_extract_cad::oda::convert_dwg_to_dxf(
                "C:/yok/olmayan.dwg",
                Path::new("C:/yok/ODAFileConverter.exe"),
            );
            d.fetch_add(1, Ordering::SeqCst);
        }));
    }
    for h in handles {
        h.join().expect("thread panik/deadlock olmamali");
    }
    assert_eq!(done.load(Ordering::SeqCst), threads, "tum cagrilar tamamlanmali (deadlock yok)");
}
