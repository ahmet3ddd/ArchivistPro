//! OS entegrasyonu — dosyayi varsayilan uygulamada AC / dosya yoneticisinde GOSTER.
//!
//! Neden ozel komut (tauri-plugin-opener yerine): plugin 2.5.4 Windows'ta Unicode/bosluk iceren
//! GECERLI yollarda (or. "D:\\...\\Ekran goruntusu ....jpg") acmayi beceremiyor (sessiz basarisizlik).
//! `opener` crate ShellExecuteW kullanir (PowerShell Invoke-Item ile ayni yol) → acar. Dosya yoksa
//! "not_found" doner (frontend yerellestirir). Her rol (okuma eylemi; RBAC yok — dis dosya sistemine
//! sadece VAR OLAN yolu acmak; yeni erisim genisletmez).
//!
//! ## Yol dogrulamasi (2026-08-17 denetimi, Y1)
//! Onceki hal renderer'dan gelen **keyfi** bir yolu yalniz `exists()` kontrolunden gecirip
//! ShellExecuteW'ye veriyordu → uzlasilmis bir renderer `C:\...\bir.bat` calistirabilirdi.
//! Simdi iki kapi var:
//! 1. **Arsiv kaydi** — yol aktif DB'de kayitli (ve copte olmayan) bir asset'e aitse gecer.
//!    Yerel arsivde normal kullanimin TAMAMI bu kapidan gecer.
//! 2. **Calistirilabilir reddi** — yol arsivde YOKSA (uzak/LAN modunda host'tan gelen yol bu
//!    makinede UNC ile acilabilir; bu bilincli bir yetenek, bkz `AssetDetailPanel`) yalniz
//!    calistirilabilir/betik olmayan turlere izin verilir. Kod yurutme primitifi boylece kapanir,
//!    uzak dosya acma yetenegi korunur.
//!
//! `reveal` (dosya yoneticisinde goster) her iki kapidan da muaf DEGIL ama zaten Explorer'i
//! `/select` ile acar — dosyayi CALISTIRMAZ; yine de ayni dogrulamadan gecirilir (tutarlilik).

use std::path::Path;

use tauri::State;

use crate::AppState;

/// ShellExecuteW ile acildiginda **kod yurutebilecek** turler. Arsiv varliklari (cizim, belge,
/// gorsel) bu listede degildir; liste yalniz arsivde KAYITLI OLMAYAN yollar icin uygulanir.
const EXECUTABLE_EXTS: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "ps1", "psm1", "vbs", "vbe", "js",
    "jse", "wsf", "wsh", "hta", "cpl", "reg", "lnk", "url", "inf", "jar", "msc", "gadget",
];

/// Dosyayi OS varsayilan uygulamasiyla ac.
#[tauri::command]
pub fn open_path_os(path: String, state: State<'_, AppState>) -> Result<(), String> {
    open_target(&state, &path, false)
}

/// Dosyayi dosya yoneticisinde goster/sec (klasoru acar, dosyayi secer).
#[tauri::command]
pub fn reveal_path_os(path: String, state: State<'_, AppState>) -> Result<(), String> {
    open_target(&state, &path, true)
}

/// Yol arsivde kayitli mi? DB okunamiyorsa (kilit/hata) `false` → 2. kapiya duser (fail-safe:
/// belirsizlikte daha DAR yetki, daha genis degil).
fn known_in_archive(state: &AppState, path: &str) -> bool {
    state
        .read_db
        .lock()
        .ok()
        .and_then(|db| db.asset_exists_at_path(path).ok())
        .unwrap_or(false)
}

/// Uzanti calistirilabilir/betik mi? (ASCII kucuk harfe indirgenerek karsilastirilir.)
fn is_executable_ext(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| EXECUTABLE_EXTS.contains(&e.as_str()))
}

/// Ortak: yetki + varlik kontrolu + opener (ShellExecuteW). `reveal` true → dosya yoneticisinde
/// sec, degilse ac. Hata KODDUR (frontend yerellestirir): "not_found" = yol yok;
/// "not_allowed" = arsiv disi + calistirilabilir tur; aksi = ham OS/opener hata metni.
fn open_target(state: &AppState, path: &str, reveal: bool) -> Result<(), String> {
    if !Path::new(path).exists() {
        return Err("not_found".into());
    }
    // Kapi 1 (arsiv kaydi) → serbest. Kapi 2 (arsiv disi) → calistirilabilir tur reddedilir.
    if !known_in_archive(state, path) && is_executable_ext(path) {
        return Err("not_allowed".into());
    }
    let res = if reveal {
        opener::reveal(path)
    } else {
        opener::open(path)
    };
    res.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_executable_ext;

    #[test]
    fn executable_extensions_are_detected_case_insensitively() {
        for p in [r"C:\x\a.bat", r"C:\x\a.BAT", r"C:\x\a.Exe", r"C:\x\a.ps1", r"C:\x\a.lnk"] {
            assert!(is_executable_ext(p), "{p} calistirilabilir sayilmali");
        }
    }

    #[test]
    fn archive_asset_types_are_not_executable() {
        for p in [r"C:\x\plan.dwg", r"C:\x\rapor.pdf", r"C:\x\foto.jpg", r"C:\x\model.max", "a.txt"]
        {
            assert!(!is_executable_ext(p), "{p} arsiv turu — reddedilmemeli");
        }
    }

    #[test]
    fn missing_extension_is_not_executable() {
        assert!(!is_executable_ext(r"C:\x\uzantisiz"));
    }
}
