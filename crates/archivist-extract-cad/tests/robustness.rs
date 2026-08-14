//! Dayaniklilik testi — bozuk/cop girdi panic/crash etmemeli.
//!
//! Plan gerektirimi (Faz 2.3): CAD ailesi (ozellikle riskli DWG ikili-parser) cop
//! girdide `ExtractError` dondurur, ASLA `ExtractError::Panicked` (= extractor panikledi)
//! veya process crash. Registry `catch_unwind` siniri paniki yakalardi; bu test
//! extractor'larin ZATEN panic etmedigini (Panicked donmedigini) dogrular.

use std::io::Write;

use archivist_extract::{ExtractError, ExtractInput, Registry};

/// Deterministik sozde-rastgele bayt (LCG; test tekrar-uretilebilir olsun).
fn garbage(seed: u64, len: usize) -> Vec<u8> {
    let mut state = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
    (0..len)
        .map(|_| {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (state >> 33) as u8
        })
        .collect()
}

fn temp_with(ext: &str, bytes: &[u8]) -> tempfile::TempPath {
    let mut f = tempfile::Builder::new().suffix(&format!(".{ext}")).tempfile().unwrap();
    f.write_all(bytes).unwrap();
    f.flush().unwrap();
    f.into_temp_path()
}

/// Registry uzerinden cop-girdi cikarimi panic etmemeli (Panicked donmemeli).
#[test]
fn cad_family_survives_garbage() {
    let mut reg = Registry::new();
    archivist_extract_cad::register(&mut reg);

    // (ext, fabrika): bazi cop-baytlari format-makul oneklerle (parser'i gercekten calistir).
    let mut dwg = b"AC1015".to_vec(); // gecerli imza → raw-scan'i tetikle
    dwg.extend_from_slice(&garbage(1, 8192));

    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("dwg", dwg),
        ("dwg", garbage(2, 4096)), // imzasiz → temiz Parse hatasi
        ("dxf", garbage(3, 4096)),
        ("dxf", b"0\nSECTION\n2\nENTITIES\n".iter().chain(garbage(4, 2048).iter()).copied().collect()),
        ("rvt", garbage(5, 4096)),
        ("skp", garbage(6, 4096)),
        ("skp", b"PK\x03\x04".iter().chain(garbage(7, 2048).iter()).copied().collect()),
        ("max", garbage(8, 4096)),
    ];

    for (ext, bytes) in cases {
        let path = temp_with(ext, &bytes);
        let input = ExtractInput::from_path(&path).expect("temp okunmali");
        let result = reg.extract(&input);
        // Ok veya (Unsupported disi) bir ExtractError olabilir; ama ASLA Panicked olmamali.
        assert!(
            !matches!(result, Err(ExtractError::Panicked)),
            "{ext} cop girdide panikledi (extractor panic-guvenli degil)"
        );
    }
}

/// Bos dosya da panik etmemeli.
#[test]
fn empty_files_survive() {
    let mut reg = Registry::new();
    archivist_extract_cad::register(&mut reg);
    for ext in ["dwg", "dxf", "rvt", "skp", "max"] {
        let path = temp_with(ext, &[]);
        let input = ExtractInput::from_path(&path).expect("temp okunmali");
        let result = reg.extract(&input);
        assert!(!matches!(result, Err(ExtractError::Panicked)), "{ext} bos dosyada panikledi");
    }
}
