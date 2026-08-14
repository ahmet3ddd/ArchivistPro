//! OS entegrasyonu — dosyayi varsayilan uygulamada AC / dosya yoneticisinde GOSTER.
//!
//! Neden ozel komut (tauri-plugin-opener yerine): plugin 2.5.4 Windows'ta Unicode/bosluk iceren
//! GECERLI yollarda (or. "D:\\...\\Ekran goruntusu ....jpg") acmayi beceremiyor (sessiz basarisizlik).
//! `opener` crate ShellExecuteW kullanir (PowerShell Invoke-Item ile ayni yol) → acar. Dosya yoksa
//! "not_found" doner (frontend yerellestirir). Her rol (okuma eylemi; RBAC yok — dis dosya sistemine
//! sadece VAR OLAN yolu acmak; yeni erisim genisletmez).

use std::path::Path;

/// Dosyayi OS varsayilan uygulamasiyla ac.
#[tauri::command]
pub fn open_path_os(path: String) -> Result<(), String> {
    open_target(&path, false)
}

/// Dosyayi dosya yoneticisinde goster/sec (klasoru acar, dosyayi secer).
#[tauri::command]
pub fn reveal_path_os(path: String) -> Result<(), String> {
    open_target(&path, true)
}

/// Ortak: varlik kontrolu + opener (ShellExecuteW). `reveal` true → dosya yoneticisinde sec, degilse ac.
/// Hata KODDUR (frontend yerellestirir): "not_found" = yol yok; aksi = ham OS/opener hata metni.
fn open_target(path: &str, reveal: bool) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("not_found".into());
    }
    let res = if reveal {
        opener::reveal(path)
    } else {
        opener::open(path)
    };
    res.map_err(|e| e.to_string())
}
