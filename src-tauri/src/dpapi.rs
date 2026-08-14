//! DPAPI (Windows Data Protection API) ile LAN auth-code sifreleme.
//!
//! app_meta'da kod artik **plaintext degil**, `DPAPI:<base64>` formatinda saklanir. DPAPI
//! ciktisi **ayni kullanici + ayni makine** kombinasyonunda cozulur; baska kullanici/makine
//! (veya kopyalanan DB) erisemez. `crypt32.dll` Windows'ta varsayilan sistem DLL'i.
//!
//! **H2 `src-tauri/src/ollama_db.rs` naklı — birebir port** (RATIONALE: H2'nin kanitli yapisi;
//! icat etme). H2'de sessizce kayip olan bir kazanimdi (H3 duz metin sakliyordu) → geri getirildi.
//!
//! Windows disi platformlarda `protect`/`unprotect` **passthrough** (proje su an Windows-only;
//! ileride Linux/Mac icin keyring/secret-service). Legacy plaintext (prefix'siz) deger okunur →
//! ilk yeniden-kaydetmede otomatik `DPAPI:` formatina yukseltilir (geriye-uyum).

use base64::Engine;

#[cfg(windows)]
mod sys {
    use std::ptr;

    #[repr(C)]
    struct DataBlob {
        cb_data: u32,
        pb_data: *mut u8,
    }

    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(
            p_data_in: *const DataBlob,
            sz_data_descr: *const u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut std::ffi::c_void,
            p_prompt_struct: *mut std::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;

        fn CryptUnprotectData(
            p_data_in: *const DataBlob,
            pp_sz_data_descr: *mut *mut u16,
            p_optional_entropy: *const DataBlob,
            pv_reserved: *mut std::ffi::c_void,
            p_prompt_struct: *mut std::ffi::c_void,
            dw_flags: u32,
            p_data_out: *mut DataBlob,
        ) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(h_mem: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }

    /// DPAPI ile sifrele (kullanici+makine bagli). Cikti Windows'un dondurdugu buffer'dan
    /// kopyalanir, ardindan `LocalFree` ile serbest birakilir.
    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        let input = DataBlob {
            cb_data: plaintext.len() as u32,
            pb_data: plaintext.as_ptr() as *mut u8,
        };
        let mut output = DataBlob { cb_data: 0, pb_data: ptr::null_mut() };
        let ok = unsafe {
            CryptProtectData(
                &input,
                ptr::null(),
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut output,
            )
        };
        if ok == 0 {
            return Err("CryptProtectData failed".to_string());
        }
        let result =
            unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec() };
        unsafe {
            LocalFree(output.pb_data as *mut std::ffi::c_void);
        }
        Ok(result)
    }

    /// DPAPI ile coz. Yanlis kullanici/makinede (veya bozuk veri) `Err` doner.
    pub fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        let input = DataBlob {
            cb_data: ciphertext.len() as u32,
            pb_data: ciphertext.as_ptr() as *mut u8,
        };
        let mut output = DataBlob { cb_data: 0, pb_data: ptr::null_mut() };
        let mut descr: *mut u16 = ptr::null_mut();
        let ok = unsafe {
            CryptUnprotectData(
                &input,
                &mut descr,
                ptr::null(),
                ptr::null_mut(),
                ptr::null_mut(),
                0,
                &mut output,
            )
        };
        if ok == 0 {
            return Err("CryptUnprotectData failed".to_string());
        }
        let result =
            unsafe { std::slice::from_raw_parts(output.pb_data, output.cb_data as usize).to_vec() };
        unsafe {
            LocalFree(output.pb_data as *mut std::ffi::c_void);
            if !descr.is_null() {
                LocalFree(descr as *mut std::ffi::c_void);
            }
        }
        Ok(result)
    }
}

#[cfg(not(windows))]
mod sys {
    /// Windows disi passthrough (proje Windows-only; ileride keyring/secret-service).
    pub fn protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(plaintext.to_vec())
    }
    pub fn unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
        Ok(ciphertext.to_vec())
    }
}

const DPAPI_PREFIX: &str = "DPAPI:";

/// LAN auth-code'u DPAPI ile sifreleyip `DPAPI:<base64>` formatina cevirir.
pub fn encrypt_lan_auth_code(plain: &str) -> Result<String, String> {
    let ciphertext = sys::protect(plain.as_bytes())?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&ciphertext);
    Ok(format!("{DPAPI_PREFIX}{b64}"))
}

/// Saklanan degeri cozer. `DPAPI:` on-eki varsa decrypt eder; yoksa **legacy plaintext** olarak
/// kabul eder (eski format; ilk yeniden-kaydetmede `DPAPI:` formatina yukseltilir).
pub fn decrypt_lan_auth_code(stored: &str) -> Result<String, String> {
    if let Some(b64) = stored.strip_prefix(DPAPI_PREFIX) {
        let ciphertext = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|e| format!("Base64 decode hatasi: {e}"))?;
        let plain = sys::unprotect(&ciphertext)?;
        String::from_utf8(plain).map_err(|e| format!("UTF-8 decode hatasi: {e}"))
    } else {
        // Legacy plaintext — eski surumden gelen prefix'siz deger.
        Ok(stored.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_encrypt_then_decrypt() {
        // Windows'ta gercek DPAPI'den, diger platformlarda passthrough'dan gecer — ikisinde de
        // sifrele→coz orijinali vermeli. Cikti `DPAPI:` on-ekli.
        let code = "48213097";
        let stored = encrypt_lan_auth_code(code).expect("encrypt");
        assert!(stored.starts_with(DPAPI_PREFIX), "sakli deger DPAPI: on-ekli olmali: {stored}");
        assert_ne!(stored, code, "sakli deger plaintext OLMAMALI");
        assert_eq!(decrypt_lan_auth_code(&stored).expect("decrypt"), code);
    }

    #[test]
    fn legacy_plaintext_is_read_as_is() {
        // Prefix'siz eski deger (H3'un onceki duz-metin formati) — oldugu gibi okunmali.
        assert_eq!(decrypt_lan_auth_code("48213097").expect("legacy"), "48213097");
    }

    #[test]
    fn empty_stays_empty() {
        // Client "eslesmeyi temizle" bos string yazar → coz de bos donmeli (prefix yok → legacy).
        assert_eq!(decrypt_lan_auth_code("").expect("empty"), "");
    }
}
