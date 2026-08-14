//! İcerik fixity — BLAKE3 streaming hash (buyuk dosyalar icin O(1) bellek).

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

/// Dosya iceriginin BLAKE3 hash'ini hex string olarak hesaplar (64 KB parcalar).
pub fn blake3_file(path: &Path) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().to_hex().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn deterministic_and_known() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        f.write_all(b"merhaba arsiv").unwrap();
        f.flush().unwrap();
        let h1 = blake3_file(f.path()).unwrap();
        let h2 = blake3_file(f.path()).unwrap();
        assert_eq!(h1, h2, "ayni icerik ayni hash");
        assert_eq!(h1.len(), 64, "BLAKE3 = 32 bayt = 64 hex");
        // Referans: blake3 kutuphane API'siyle ayni.
        assert_eq!(h1, blake3::hash(b"merhaba arsiv").to_hex().to_string());
    }
}
