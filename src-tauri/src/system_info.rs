//! Makine/derleme teshisi — Ayarlar → Bakim icin salt-okuma durum bilgisi.
//!
//! Disk olcumu yalniz arsiv DB'sinin bulundugu birim icindir; kaynak klasorleri
//! farkli disklerde olabileceginden onlari yaniltici tek bir sayida birlestirmez.
//! IP/arsiv yolu gibi makine ayrintilari yalniz admin'e acilir.

use std::path::Path;

use serde::Serialize;
use tauri::State;

use crate::rbac;
use crate::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskSpaceDto {
    pub free_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfoDto {
    pub app_version: String,
    pub build_profile: String,
    pub target_os: String,
    pub target_arch: String,
    /// Derleme aninda etkin olan guvenli/tespit edilebilir isaretler. Cargo optional
    /// feature'i bu pakette tanimli degildir; burada etkin profil/masaustu niteligini
    /// acikca gosteririz, uydurma "feature" listesi degil.
    pub build_features: Vec<String>,
    pub hostname: String,
    pub local_ip: String,
    pub archive_path: String,
    pub disk: Option<DiskSpaceDto>,
    /// Disk API basarisiz olsa bile surum/IP gorunur kalir.
    pub disk_error: Option<String>,
}

#[cfg(windows)]
#[link(name = "Kernel32")]
extern "system" {
    fn GetDiskFreeSpaceExW(
        directory_name: *const u16,
        available_to_caller: *mut u64,
        total_bytes: *mut u64,
        total_free_bytes: *mut u64,
    ) -> i32;
}

fn build_profile() -> &'static str {
    if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    }
}

fn build_features() -> Vec<String> {
    let mut flags = vec!["tauri-desktop".to_string(), "offline-native".to_string()];
    flags.push(format!("profile:{}", build_profile()));
    flags.push(format!(
        "target:{}-{}",
        std::env::consts::OS,
        std::env::consts::ARCH
    ));
    flags
}

/// Windows birim istatistigi. API hem yerel surucu hem UNC/haritalanmis ag yolu icin
/// calisir; no-ops yerine OS hatasini renderer'a tanisal olarak tasir.
fn disk_space(path: &Path) -> Result<DiskSpaceDto, String> {
    #[cfg(windows)]
    {
        use std::iter::once;
        use std::os::windows::ffi::OsStrExt;

        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(once(0)).collect();
        let mut available = 0u64;
        let mut total = 0u64;
        let mut total_free = 0u64;
        let ok = unsafe {
            GetDiskFreeSpaceExW(wide.as_ptr(), &mut available, &mut total, &mut total_free)
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        Ok(DiskSpaceDto {
            free_bytes: available,
            total_bytes: total,
        })
    }

    #[cfg(not(windows))]
    {
        let _ = path;
        Err("disk alani teshisi yalniz Windows'ta desteklenir".to_string())
    }
}

/// Makine/derleme bilgisini getir (**admin**). Salt-okuma; disk API'si hatalansa bile
/// genel DTO basarili doner, boylece tanisal kartin geri kalani gorunur kalir.
#[tauri::command]
pub fn system_info(state: State<'_, AppState>) -> Result<SystemInfoDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;

    let archive_dir = state
        .db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_string_lossy()
        .into_owned();
    let (disk, disk_error) = match disk_space(Path::new(&archive_dir)) {
        Ok(space) => (Some(space), None),
        Err(e) => (None, Some(e)),
    };

    Ok(SystemInfoDto {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build_profile: build_profile().to_string(),
        target_os: std::env::consts::OS.to_string(),
        target_arch: std::env::consts::ARCH.to_string(),
        build_features: build_features(),
        hostname: crate::location::current_hostname(),
        local_ip: archivist_server::detect_local_ip(),
        archive_path: archive_dir,
        disk,
        disk_error,
    })
}

#[cfg(test)]
mod tests {
    use super::{build_features, build_profile, disk_space};
    use std::path::Path;

    #[test]
    fn build_flags_describe_the_actual_profile_and_target() {
        let flags = build_features();
        assert!(matches!(build_profile(), "debug" | "release"));
        assert!(flags.iter().any(|f| f == "tauri-desktop"));
        assert!(flags.iter().any(|f| f == "offline-native"));
        assert!(flags.iter().any(|f| f.starts_with("profile:")));
        assert!(flags.iter().any(|f| f.starts_with("target:")));
    }

    #[cfg(windows)]
    #[test]
    fn disk_api_reads_the_current_workspace_volume() {
        let disk = disk_space(Path::new(".")).expect("calisan dizinin diski okunmali");
        assert!(disk.total_bytes > 0);
        assert!(disk.free_bytes <= disk.total_bytes);
    }
}
