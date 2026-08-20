//! Baskın renk çıkarımının PARALELLEŞME kazancı — `#[ignore]` ölçüm testi.
//!
//! Neden var: renk geri-doldurma (`backfill_dominant_colors`) partiyi çekirdeklere dağıtıyor.
//! "Paralel yaptım, hızlandı" bir TAHMİNDİR; bu test onu bu makinede SAYIYA çevirir. Ölçülen şey
//! tam olarak paralelleştirilen iş: thumbnail baytları → decode → 100×100 → k-means.
//!
//! Çalıştırma:
//!   cargo test --release -p archivist-extract-image --test dominant_colors_bench -- --ignored --nocapture
//!
//! ⚠️ `--release` şart: debug'da decode/k-means 20-30x yavaş (kayıtlı ders) → oran anlamlı olmaz.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::Instant;

use archivist_extract_image::dominant_colors_from_bytes;

/// Gerçekçi bir thumbnail: 256×256, yumuşak geçişli bloklar (tek renk olsaydı k-means erken
/// yakınsar, ölçüm iyimser çıkardı).
fn synthetic_thumbnail_jpeg() -> Vec<u8> {
    let mut img = image::RgbImage::new(256, 256);
    for (x, y, px) in img.enumerate_pixels_mut() {
        let bx = (x / 32) as u8;
        let by = (y / 32) as u8;
        *px = image::Rgb([
            bx.wrapping_mul(29).wrapping_add((y % 32) as u8),
            by.wrapping_mul(37).wrapping_add((x % 32) as u8),
            bx.wrapping_add(by).wrapping_mul(19),
        ]);
    }
    let mut bytes = Vec::new();
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut std::io::Cursor::new(&mut bytes), image::ImageFormat::Jpeg)
        .expect("jpeg encode");
    bytes
}

#[test]
#[ignore = "olcum testi; elle: cargo test --release ... -- --ignored --nocapture"]
fn parallel_backfill_is_faster_than_serial() {
    const N: usize = 200; // bir geri-doldurma partisi
    let one = synthetic_thumbnail_jpeg();
    let batch: Vec<Vec<u8>> = (0..N).map(|_| one.clone()).collect();
    println!("thumbnail: {} bayt · parti: {N} dosya", one.len());

    // ── SERI (eski davranis) ──
    let t0 = Instant::now();
    let mut serial_out = 0usize;
    for bytes in &batch {
        serial_out += dominant_colors_from_bytes(bytes, 5).len();
    }
    let serial = t0.elapsed();

    // ── PARALEL (komuttaki desen: thread::scope + paylasik AtomicUsize + mpsc) ──
    let workers = std::thread::available_parallelism().map_or(1, |n| n.get()).clamp(1, 8);
    let next = AtomicUsize::new(0);
    let (tx, rx) = mpsc::channel::<usize>();
    let t1 = Instant::now();
    let mut par_out = 0usize;
    std::thread::scope(|scope| {
        for _ in 0..workers {
            let tx = tx.clone();
            let next = &next;
            let batch = &batch;
            scope.spawn(move || loop {
                let i = next.fetch_add(1, Ordering::Relaxed);
                let Some(bytes) = batch.get(i) else { break };
                let n = dominant_colors_from_bytes(bytes, 5).len();
                if tx.send(n).is_err() {
                    break;
                }
            });
        }
        drop(tx);
        for n in rx {
            par_out += n;
        }
    });
    let parallel = t1.elapsed();

    let speedup = serial.as_secs_f64() / parallel.as_secs_f64().max(f64::EPSILON);
    println!("worker: {workers}");
    println!("seri   : {:>8.0} ms  ({:.1} ms/dosya)", serial.as_secs_f64() * 1000.0, serial.as_secs_f64() * 1000.0 / N as f64);
    println!("paralel: {:>8.0} ms  ({:.1} ms/dosya)", parallel.as_secs_f64() * 1000.0, parallel.as_secs_f64() * 1000.0 / N as f64);
    println!("hizlanma: {speedup:.1}x");

    // Sozlesme: ayni is yapildi (cikti sayisi ozdes) ve cok cekirdekte paralel DAHA HIZLI.
    assert_eq!(serial_out, par_out, "paralel kosu ayni sonucu uretmeli");
    if workers > 1 {
        assert!(
            speedup > 1.2,
            "cok cekirdekte anlamli hizlanma beklenir (olculen {speedup:.2}x)"
        );
    }
}
