//! Registry siniri testleri: dispatch, unsupported-ext, boyut korumasi, panik yakalama,
//! **format-basina sure siniri**.

use archivist_extract::{ExtractError, ExtractInput, Extracted, Extractor, MetaValue, Registry};
use std::path::PathBuf;
use std::time::Duration;

/// Varsayilandan (30sn) YAVAS ama kendi `timeout`'unu YUKSELTEN extractor.
///
/// REGRESYON NOBETI: sure siniri TEK-TIP 30sn iken ODA gibi alt-surec calistiran extractor'lar
/// asiliyordu → `Timeout` → **basarili ama yavas** cikarim cope gidiyordu (2026-07-16 olcumu:
/// 30MB DWG'de ODA 25.0sn; gercek DWG klasorlerinin ~%12'si metadata'siz indeksleniyordu).
/// `Extractor::timeout()` override'i GERCEKTEN uygulanmazsa bu test kirilir.
struct SlowButAllowed;
impl Extractor for SlowButAllowed {
    fn id(&self) -> &'static str {
        "slow-allowed"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["slow"]
    }
    fn timeout(&self) -> Duration {
        Duration::from_secs(60) // varsayilan 30sn'nin USTUNDE
    }
    fn extract(&self, _input: &ExtractInput) -> Result<Extracted, ExtractError> {
        // Kisa ama OLCULEBILIR: testi yavaslatmadan "is yapiliyor" temsili.
        std::thread::sleep(Duration::from_millis(150));
        let mut out = Extracted::new();
        out.text = Some("yavas ama bitti".into());
        Ok(out)
    }
}

/// `timeout()` override'i KISALTMA yonunde de calismali (hizli asim → Timeout).
struct TooSlow;
impl Extractor for TooSlow {
    fn id(&self) -> &'static str {
        "too-slow"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["tooslow"]
    }
    fn timeout(&self) -> Duration {
        Duration::from_millis(50) // kasten cok kisa → testi saniyelerce bekletmeden asilir
    }
    fn extract(&self, _input: &ExtractInput) -> Result<Extracted, ExtractError> {
        std::thread::sleep(Duration::from_secs(5));
        Ok(Extracted::new())
    }
}

fn input_for(ext: &str) -> ExtractInput {
    ExtractInput {
        path: PathBuf::from(format!("x.{ext}")),
        ext: ext.to_string(),
        size_bytes: 1,
    }
}

/// Kendi butcesini yukselten extractor, varsayilan 30sn'ye TAKILMADAN tamamlanir
/// **ve** butcesi asilirsa yine `Timeout` doner → override gercekten okunuyor.
#[test]
fn per_extractor_timeout_is_honored_in_both_directions() {
    let mut reg = Registry::new();
    reg.register(SlowButAllowed);
    reg.register(TooSlow);

    let ok = reg.extract(&input_for("slow"));
    assert!(ok.is_ok(), "yukseltilmis butce ile cikarim BASARILI olmali, bulunan: {ok:?}");

    let to = reg.extract(&input_for("tooslow"));
    assert!(
        matches!(to, Err(ExtractError::Timeout)),
        "kisaltilmis butce asilinca Timeout beklenir, bulunan: {to:?}"
    );
}

/// Basit, basarili bir extractor — `txt` icin; kucuk `max_size` (TooLarge testi).
struct DummyTxt;
impl Extractor for DummyTxt {
    fn id(&self) -> &'static str {
        "dummy-txt"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["txt", "log"]
    }
    fn max_size(&self) -> u64 {
        10 // kucuk sinir — TooLarge senaryosu icin
    }
    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let mut out = Extracted::new();
        out.set("ext", input.ext.clone());
        out.text = Some("merhaba".into());
        Ok(out)
    }
}

/// Kasten panikleyen extractor — registry sinirinin paniki yakaladigini test eder.
struct Panicker;
impl Extractor for Panicker {
    fn id(&self) -> &'static str {
        "panicker"
    }
    fn extensions(&self) -> &'static [&'static str] {
        &["bad"]
    }
    fn extract(&self, _input: &ExtractInput) -> Result<Extracted, ExtractError> {
        panic!("kasitli panik");
    }
}

fn input(ext: &str, size: u64) -> ExtractInput {
    ExtractInput { path: PathBuf::from(format!("x.{ext}")), ext: ext.into(), size_bytes: size }
}

#[test]
fn dispatch_routes_by_ext() {
    let mut reg = Registry::new();
    reg.register(DummyTxt);
    let out = reg.extract(&input("txt", 5)).expect("txt cikarilmali");
    assert_eq!(out.text.as_deref(), Some("merhaba"));
    assert_eq!(out.fields.get("ext"), Some(&MetaValue::Str("txt".into())));
}

#[test]
fn multi_extension_registration() {
    let mut reg = Registry::new();
    reg.register(DummyTxt);
    // Ayni extractor iki uzantida da gorunur.
    assert_eq!(reg.len(), 2);
    assert!(reg.extract(&input("log", 3)).is_ok());
}

#[test]
fn unsupported_ext_errors() {
    let mut reg = Registry::new();
    reg.register(DummyTxt);
    let err = reg.extract(&input("png", 1)).unwrap_err();
    assert!(matches!(err, ExtractError::Unsupported(ext) if ext == "png"));
}

#[test]
fn size_guard_blocks_large_files() {
    let mut reg = Registry::new();
    reg.register(DummyTxt); // max_size = 10
    let err = reg.extract(&input("txt", 11)).unwrap_err();
    assert!(matches!(err, ExtractError::TooLarge { size: 11, limit: 10 }));
}

#[test]
fn panic_is_caught_at_boundary() {
    // Panik hook'unu sustur ki test ciktisi temiz kalsin (catch_unwind yine de yakalar).
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));

    let mut reg = Registry::new();
    reg.register(Panicker);
    let res = reg.extract(&input("bad", 1));

    std::panic::set_hook(prev);
    assert!(matches!(res, Err(ExtractError::Panicked)));
}

#[test]
fn empty_registry_is_empty() {
    let reg = Registry::new();
    assert!(reg.is_empty());
    assert_eq!(reg.len(), 0);
}
