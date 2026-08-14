//! Uygulama islem onceligi (Windows). Bu, tarama/AI gibi agir arka-plan isleri
//! surerken diger uygulamalara daha adil CPU zamani birakmak icin makine-yerel bir
//! tercihtir. "background" Windows'un BELOW_NORMAL priority class'ina eslenir;
//! NORMAL'a geri donus aninda uygulanir.
//!
//! Ayar yalniz admin tarafindan degistirilebilir. Renderer'daki localStorage yalniz
//! tercih saklar; gercek OS cagrisi Rust `set_process_priority` komutundadir,
//! dolayisiyla IPC ile rol taklidi edilemez.

use tauri::State;

use crate::rbac;
use crate::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProcessPriority {
    Normal,
    Background,
}

impl ProcessPriority {
    fn parse(raw: &str) -> Result<Self, String> {
        match raw {
            "normal" => Ok(Self::Normal),
            "background" => Ok(Self::Background),
            _ => Err("gecersiz islem onceligi; normal veya background beklenir".to_string()),
        }
    }
}

#[cfg(windows)]
const NORMAL_PRIORITY_CLASS: u32 = 0x0000_0020;
#[cfg(windows)]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" {
    fn GetCurrentProcess() -> *mut std::ffi::c_void;
    fn SetPriorityClass(process: *mut std::ffi::c_void, priority_class: u32) -> i32;
}

/// Secilen onceligi mevcut Arsiv-H3 islemine uygula. Windows API basarisiz olursa
/// hata doner; renderer tercihi ancak bu komut basarili olduktan sonra kalici yazar.
fn apply_priority(priority: ProcessPriority) -> Result<(), String> {
    #[cfg(windows)]
    {
        let class = match priority {
            ProcessPriority::Normal => NORMAL_PRIORITY_CLASS,
            ProcessPriority::Background => BELOW_NORMAL_PRIORITY_CLASS,
        };
        // Pseudo-handle sadece mevcut sureci hedefler; baska bir surece yetki vermez.
        let ok = unsafe { SetPriorityClass(GetCurrentProcess(), class) };
        if ok == 0 {
            return Err(format!(
                "Windows islem onceligi degistirilemedi (hata kodu {})",
                std::io::Error::last_os_error()
            ));
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = priority;
        Err("islem onceligi ayari yalniz Windows'ta desteklenir".to_string())
    }
}

/// Mevcut uygulamanin planlama sinifini degistir (**admin**). Yalniz `normal` ve
/// `background` kabul edilir; yuksek/gercek-zamanli siniflar bilerek yuzeye acilmaz.
#[tauri::command]
pub fn set_process_priority(mode: String, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let priority = ProcessPriority::parse(&mode)?;
    apply_priority(priority)
}

#[cfg(test)]
mod tests {
    use super::ProcessPriority;

    #[test]
    fn only_the_two_safe_priority_modes_are_accepted() {
        assert_eq!(
            ProcessPriority::parse("normal"),
            Ok(ProcessPriority::Normal)
        );
        assert_eq!(
            ProcessPriority::parse("background"),
            Ok(ProcessPriority::Background)
        );
        assert!(ProcessPriority::parse("high").is_err());
        assert!(ProcessPriority::parse("").is_err());
        assert!(ProcessPriority::parse("Background").is_err());
    }
}
