//! Plugin/registry — uzanti → extractor eslemesi + panik-guvenli cagri siniri.

use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{mpsc, Arc};
use std::time::Duration;

use crate::error::ExtractError;
use crate::types::{ExtractInput, Extracted};

/// **Varsayilan** azami cikarim suresi. Asilirsa [`ExtractError::Timeout`] doner; asan is AYRI
/// thread'de arka planda sessizce biter (ingest TIKANMAZ). Bazi 3.-parti extractor'lar (or.
/// `pdf_extract` 0.10 buyuk/karmasik PDF'te — OLCULDU: 35MB/39625-nesneli belgede 83s) on-
/// saniyelerce calisip taramayi "kilit" gibi gosterebilir; bu sinir TEK bir dosyanin tum ingest'i
/// tikamasini engeller. Saf-Rust cikarimlarin cogu <1s (olculdu: gorsel 31.7MP ~3s, rvt 88ms).
///
/// ⚠️ **Bu sinir TEK-TIP DEGILDIR** — [`Extractor::timeout`] ile format basina override edilir.
/// Gerekce (2026-07-16 olcumu): bu 30sn, 2026-07-15'te **PDF** vakasi icin secilmisti ve
/// "cogu cikarim <1s → bol pay" varsayimina dayaniyordu. Varsayim **DWG icin YANLISTI**:
/// ODA donusumu 30 MB'lik gercek bir ofis DWG'sinde **25.0 sn** suruyor (TEK dosya, cekismesiz,
/// ve BASARILI) → 30sn'de pay yok → en ufak cekismede asilip **cikarilabilir metadata cope
/// atiliyordu** (olculdu: gercek DWG klasorlerinin ~%12'si icerik cikarimi olmadan indeksleniyordu).
/// H2'de bu sinif YOK cunku H2'nin **hic timeout'u yok** (`raceInvoke` = yalnizca iptal yarisi,
/// timeout DEGIL) → H2 bekler ve veriyi alir. H3 timeout'u gercek hang'lere karsi KORUR ama
/// format basina gerceklestirir.
pub const DEFAULT_EXTRACT_TIMEOUT: Duration = Duration::from_secs(30);

/// Varsayilan azami dosya boyutu: 512 MB (H2 format sinirlarinin ust zarfi).
/// Tekil extractor'lar [`Extractor::max_size`]'i override edip daraltabilir.
pub const DEFAULT_MAX_SIZE: u64 = 512 * 1024 * 1024;

/// Bir dosya formati cikaricisi. Aile crate'leri bunu implemente eder; registry'ye
/// kaydolur.
///
/// **Sozlesme:** `extract`, malformed girdide `Err(ExtractError::Parse(..))` dondurmeli,
/// panic etmemeli. Yine de panik ederse [`Registry::extract`] siniri yakalar.
pub trait Extractor: Send + Sync {
    /// Kararli kimlik (tani + golden dosya adi). Or. `"dwg"`, `"pdf"`.
    fn id(&self) -> &'static str;

    /// Bu extractor'in sahiplendigi kucuk-harf uzantilar. Or. `&["doc", "docx"]`.
    fn extensions(&self) -> &'static [&'static str];

    /// Bu format icin kabul edilen azami dosya boyutu (bayt). Asimi = `TooLarge`.
    fn max_size(&self) -> u64 {
        DEFAULT_MAX_SIZE
    }

    /// Bu format icin azami cikarim suresi. Asimi = `Timeout` (cikarim ATILIR).
    ///
    /// Varsayilan [`DEFAULT_EXTRACT_TIMEOUT`] (30sn) saf-Rust ayristiricilar icindir. **Harici
    /// alt-surec calistiran** ya da dogasi geregi on-saniyeler suren extractor'lar bunu YUKSELTMELI —
    /// aksi halde timeout, basarisiz isi degil **basarili ama yavas** isi keser ve veri sessizce
    /// kaybolur (bkz [`DEFAULT_EXTRACT_TIMEOUT`] dokumanindaki DWG/ODA olcumu).
    ///
    /// Yukseltirken: bu bir **hang guvenlik agidir**, hiz hedefi degil. Olculen en kotu tekil
    /// sureye bol pay birak; kullanicinin kacis kapisi zaten ingest **iptali** (`INGEST_STOP`,
    /// H2 `raceInvoke` pariteli) → uzun ama ILERLEYEN is kullaniciyi hapsetmez.
    fn timeout(&self) -> Duration {
        DEFAULT_EXTRACT_TIMEOUT
    }

    /// Cikarimi yap. Malformed girdide `Err`, panik etme.
    fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError>;
}

/// Uzanti → extractor kayit merkezi.
#[derive(Default, Clone)]
pub struct Registry {
    by_ext: HashMap<&'static str, Arc<dyn Extractor>>,
}

impl Registry {
    /// Bos registry.
    pub fn new() -> Self {
        Self { by_ext: HashMap::new() }
    }

    /// Bir extractor'i tum uzantilari icin kaydet. Ayni uzanti tekrar kaydedilirse
    /// **sonraki kazanir** (aile crate register sirasi bilincli).
    pub fn register<E: Extractor + 'static>(&mut self, extractor: E) {
        let arc: Arc<dyn Extractor> = Arc::new(extractor);
        for &ext in arc.extensions() {
            self.by_ext.insert(ext, arc.clone());
        }
    }

    /// Bu uzanti icin kayitli extractor (varsa).
    pub fn for_ext(&self, ext: &str) -> Option<&dyn Extractor> {
        self.by_ext.get(ext).map(AsRef::as_ref)
    }

    /// Kayitli uzanti sayisi.
    pub fn len(&self) -> usize {
        self.by_ext.len()
    }

    /// Hic extractor kayitli degil mi?
    pub fn is_empty(&self) -> bool {
        self.by_ext.is_empty()
    }

    /// Girdiyi uygun extractor'a yonlendir. **Guvenlik siniri:**
    /// 1. uzanti kaydi yoksa [`ExtractError::Unsupported`],
    /// 2. boyut siniri asilirsa [`ExtractError::TooLarge`] (extractor hic cagrilmaz),
    /// 3. extractor panic ederse [`ExtractError::Panicked`]'e (`catch_unwind`),
    /// 4. extractor kendi [`Extractor::timeout`]'unu asarsa [`ExtractError::Timeout`]'a cevrilir
    ///    (format basina; varsayilani [`DEFAULT_EXTRACT_TIMEOUT`]).
    ///
    /// (3)+(4) kritiktir: kotu-bicimli/agir bir dosya (DWG panik, buyuk PDF yavaslik) tum ingest'i
    /// DUSURMEMELI/TIKAMAMALI. Extractor AYRI thread'de kosar: panik `catch_unwind` ile izole edilir,
    /// sure asimi `recv_timeout` ile sinirlanir (asan is arka planda sessizce sonlanir). catch_unwind'in
    /// calismasi icin workspace `panic = "abort"` AYARLAMAZ (varsayilan unwind).
    pub fn extract(&self, input: &ExtractInput) -> Result<Extracted, ExtractError> {
        let extractor = self
            .by_ext
            .get(input.ext.as_str())
            .cloned()
            .ok_or_else(|| ExtractError::Unsupported(input.ext.clone()))?;

        let limit = extractor.max_size();
        if input.size_bytes > limit {
            return Err(ExtractError::TooLarge { size: input.size_bytes, limit });
        }

        // Sure siniri FORMAT BASINA (bkz `Extractor::timeout`) — tek-tip 30sn, ODA gibi
        // alt-surec calistiran extractor'larda basarili isi keserdi.
        let budget = extractor.timeout();
        run_bounded(extractor, input.clone(), budget)
    }
}

/// Extractor'i AYRI thread'de + ZAMAN ASIMLI cagir → panik [`ExtractError::Panicked`]'e, sure asimi
/// [`ExtractError::Timeout`]'a cevrilir. Asimda asan thread arka planda kosmaya DEVAM eder (senkron +
/// iptal-edilemez 3.-parti kod iptal edilemez) ama sonucunu dusmus kanala yollayip sessizce sonlanir;
/// icteki `catch_unwind` panigi yutar → stderr-spam / cokme yok. Cogu cikarim <1s → thread hizli doner.
fn run_bounded(
    extractor: Arc<dyn Extractor>,
    input: ExtractInput,
    timeout: Duration,
) -> Result<Extracted, ExtractError> {
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let result = catch_unwind(AssertUnwindSafe(|| extractor.extract(&input)))
            .unwrap_or(Err(ExtractError::Panicked));
        let _ = tx.send(result); // rx dusmusse (zaman asimi) send sessizce basarisiz olur
    });
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(mpsc::RecvTimeoutError::Timeout) => Err(ExtractError::Timeout),
        Err(mpsc::RecvTimeoutError::Disconnected) => Err(ExtractError::Panicked),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Belirtilen sure kadar uyuyan extractor (zaman asimi testi).
    struct SleepyExtractor(Duration);
    impl Extractor for SleepyExtractor {
        fn id(&self) -> &'static str {
            "sleepy"
        }
        fn extensions(&self) -> &'static [&'static str] {
            &["sleepy"]
        }
        fn extract(&self, _: &ExtractInput) -> Result<Extracted, ExtractError> {
            std::thread::sleep(self.0);
            Ok(Extracted::new())
        }
    }

    /// Panikleyen extractor (izolasyon testi).
    struct PanicExtractor;
    impl Extractor for PanicExtractor {
        fn id(&self) -> &'static str {
            "boom"
        }
        fn extensions(&self) -> &'static [&'static str] {
            &["boom"]
        }
        fn extract(&self, _: &ExtractInput) -> Result<Extracted, ExtractError> {
            panic!("kasitli panik (test)");
        }
    }

    fn input(ext: &str) -> ExtractInput {
        ExtractInput { path: "x".into(), ext: ext.into(), size_bytes: 0 }
    }

    #[test]
    fn slow_extractor_times_out() {
        let ex: Arc<dyn Extractor> = Arc::new(SleepyExtractor(Duration::from_millis(500)));
        let r = run_bounded(ex, input("sleepy"), Duration::from_millis(50));
        assert!(matches!(r, Err(ExtractError::Timeout)), "yavas extractor Timeout dondurmeli");
    }

    #[test]
    fn fast_extractor_returns_ok() {
        let ex: Arc<dyn Extractor> = Arc::new(SleepyExtractor(Duration::from_millis(1)));
        let r = run_bounded(ex, input("sleepy"), Duration::from_secs(5));
        assert!(r.is_ok(), "hizli extractor normal donmeli");
    }

    #[test]
    fn panicking_extractor_is_caught() {
        let ex: Arc<dyn Extractor> = Arc::new(PanicExtractor);
        let r = run_bounded(ex, input("boom"), Duration::from_secs(5));
        assert!(matches!(r, Err(ExtractError::Panicked)), "panik Panicked'e cevrilmeli");
    }
}
