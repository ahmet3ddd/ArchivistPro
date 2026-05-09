// Windows process priority kontrolu — tarama/embedding sirasinda
// uygulamayi "iyi vatandas" yapar (kullanici diger programlari rahatca kullanir).
//
// Pattern: ollama_db.rs'deki dpapi modulu gibi raw FFI; ekstra crate eklemiyoruz.

#[cfg(windows)]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
#[cfg(windows)]
const NORMAL_PRIORITY_CLASS: u32 = 0x0000_0020;

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentProcess() -> *mut std::ffi::c_void;
    fn SetPriorityClass(h_process: *mut std::ffi::c_void, dw_priority_class: u32) -> i32;
}

#[cfg(windows)]
fn apply(class: u32) -> Result<(), String> {
    let ok = unsafe { SetPriorityClass(GetCurrentProcess(), class) };
    if ok == 0 {
        Err("SetPriorityClass failed".to_string())
    } else {
        Ok(())
    }
}

/// Tarama/embedding basliyorken cagir — process'i Below Normal'a dusurur.
#[tauri::command]
pub fn set_priority_background() -> Result<(), String> {
    #[cfg(windows)]
    {
        apply(BELOW_NORMAL_PRIORITY_CLASS)
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

/// Tarama bittikten sonra cagir — Normal'a geri doner.
#[tauri::command]
pub fn set_priority_normal() -> Result<(), String> {
    #[cfg(windows)]
    {
        apply(NORMAL_PRIORITY_CLASS)
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}
