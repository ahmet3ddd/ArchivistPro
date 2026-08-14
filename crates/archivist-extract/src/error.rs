//! Cikarim hatalari.
//!
//! Her [`crate::Extractor::extract`] malformed/eksik girdide bu hatalardan birini
//! dondurur — **asla panic/crash etmez**. Yine de bir extractor paniklerse,
//! [`crate::Registry::extract`] sinirindaki `catch_unwind` onu [`ExtractError::Panicked`]'e
//! cevirir (host korunur).

use std::path::PathBuf;

/// Cikarim sirasinda olusabilecek hata sinifi.
#[derive(Debug, thiserror::Error)]
pub enum ExtractError {
    /// Bu uzanti icin kayitli extractor yok.
    #[error("desteklenmeyen uzanti: {0:?}")]
    Unsupported(String),

    /// Dosya, extractor'in `max_size` sinirini asiyor (agir-dosya/DoS korumasi).
    #[error("dosya cok buyuk: {size} bayt > sinir {limit} bayt")]
    TooLarge { size: u64, limit: u64 },

    /// Dosya okunamadi / IO hatasi.
    #[error("io hatasi ({path:?}): {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    /// Icerik beklenen formatta degil / ayristirilamadi.
    #[error("ayristirma hatasi: {0}")]
    Parse(String),

    /// Opsiyonel harici arac (ODA/Ghostscript/LibreOffice) bulunamadi → ozellik dustu.
    #[error("harici arac bulunamadi: {0}")]
    ExternalToolMissing(&'static str),

    /// Extractor panikledi; registry siniri yakaladi (host korunur).
    #[error("extractor panikledi (registry sinirinda yakalandi)")]
    Panicked,

    /// Extractor zaman asimina ugradi (riskli format korumasi).
    #[error("extractor zaman asimi")]
    Timeout,
}

impl ExtractError {
    /// Yol + io::Error'dan [`ExtractError::Io`] uretmek icin kisa yardimci.
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        ExtractError::Io { path: path.into(), source }
    }
}
