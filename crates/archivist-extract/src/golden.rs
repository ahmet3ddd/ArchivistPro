//! Golden-file test yardimcilari (aile crate testleri kullanir).
//!
//! Desen: extractor calistir → [`Extracted`]'i kararli pretty-JSON'a serileştir →
//! commit'li golden dosyayla karsilastir. `ARSIV_UPDATE_GOLDEN=1` ortam degiskeniyle
//! golden dosyalari yeniden uret (yeni fixture eklerken).

use std::path::Path;

use crate::types::Extracted;

/// `Extracted`'i kararli/pretty JSON'a serileştir (golden snapshot bicimi).
///
/// `BTreeMap` alan sirasi + pretty bicim → deterministik, diff-dostu cikti.
pub fn to_golden_json(extracted: &Extracted) -> String {
    serde_json::to_string_pretty(extracted).expect("Extracted serde-guvenli")
}

/// Snapshot'i golden dosyayla karsilastir.
///
/// - `ARSIV_UPDATE_GOLDEN=1` ise: golden dosyayi guncelle ve don (uretim modu).
/// - Aksi halde: golden'i oku ve esitligi `assert_eq!` ile dogrula.
///
/// # Panics
/// Golden dosya okunamaz (ve uretim modu kapali) ise veya snapshot uyusmazsa panikler
/// (test basarisizligi).
pub fn assert_golden(actual: &Extracted, golden_path: impl AsRef<Path>) {
    let path = golden_path.as_ref();
    let actual_json = to_golden_json(actual);

    if std::env::var("ARSIV_UPDATE_GOLDEN").as_deref() == Ok("1") {
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        std::fs::write(path, &actual_json)
            .unwrap_or_else(|e| panic!("golden yazilamadi {path:?}: {e}"));
        return;
    }

    let expected = std::fs::read_to_string(path).unwrap_or_else(|e| {
        panic!("golden okunamadi {path:?}: {e} (ARSIV_UPDATE_GOLDEN=1 ile uret)")
    });

    assert_eq!(actual_json.trim(), expected.trim(), "golden uyusmazligi: {path:?}");
}
