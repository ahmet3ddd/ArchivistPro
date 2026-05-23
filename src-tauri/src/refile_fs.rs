//! Dosya yeniden düzenleme ve sistem dosya gezgini.
use serde::Deserialize;
use std::fs;
use std::path::Path;
use std::process::Command;

#[cfg(feature = "admin")]
#[derive(Debug, Deserialize)]
pub struct RefileOp {
    source_path: String,
    relative_dest_path: String,
}

#[cfg(feature = "admin")]
#[tauri::command]
pub fn refile_organize(
    dest_root: String,
    operations: Vec<RefileOp>,
    mode: String,
) -> Result<u32, String> {
    let dest_base = Path::new(&dest_root);
    let is_move = mode.eq_ignore_ascii_case("move");
    let mut done = 0u32;
    // Canonicalize dest_base once for path traversal checks
    let canonical_base = dest_base.canonicalize().map_err(|e| format!("Hedef kök dizin çözümlenemedi: {}", e))?;

    for op in operations {
        // Path traversal koruması: mutlak path ve ".." bileşenlerini reddet
        if Path::new(&op.relative_dest_path).is_absolute() {
            return Err(format!("Mutlak hedef yolu reddedildi: {}", op.relative_dest_path));
        }
        if op.relative_dest_path.contains("..") {
            return Err(format!("Yol geçişi (path traversal) reddedildi: {}", op.relative_dest_path));
        }

        let src = Path::new(&op.source_path);
        if !src.exists() {
            continue;
        }
        let dest = dest_base.join(&op.relative_dest_path);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        // Parent'i canonicalize et (dosya henüz yok, parent kesinlikle var)
        let canonical_parent = dest.parent()
            .ok_or_else(|| "Hedef dosyanın üst dizini yok".to_string())?
            .canonicalize()
            .map_err(|e| format!("Üst dizin doğrulanamadı: {} — {}", op.relative_dest_path, e))?;
        // Parent'in base altında kaldığını doğrula
        if !canonical_parent.starts_with(&canonical_base) {
            return Err(format!("Yol geçişi reddedildi: hedef dizin dışına çıkıyor — {}", op.relative_dest_path));
        }
        // Filename'i çıkar, canonical parent ile birleştir
        let file_name = Path::new(&op.relative_dest_path)
            .file_name()
            .ok_or_else(|| format!("Geçersiz dosya adı: {}", op.relative_dest_path))?;
        let canonical_dest = canonical_parent.join(file_name);
        // Canonical path ile kopyala/taşı
        fs::copy(src, &canonical_dest).map_err(|e| e.to_string())?;
        std::fs::File::open(&canonical_dest)
            .and_then(|f| f.sync_all())
            .map_err(|e| format!("fsync hatası: {}", e))?;
        if is_move {
            fs::remove_file(src).map_err(|e| {
                log::warn!("Kaynak dosya silinemedi (taşıma): {}", e);
                e.to_string()
            })?;
        }
        done += 1;
    }
    Ok(done)
}

#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Dosya bulunamadı".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let canonical = p.canonicalize().map_err(|e| format!("Yol çözümlenemedi: {}", e))?;
        let win_path = canonical.to_string_lossy().to_string().replace('/', "\\");
        if win_path.contains('"') {
            return Err("Geçersiz dosya yolu (tırnak karakteri içeriyor)".to_string());
        }
        Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", win_path))
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = p
            .parent()
            .ok_or_else(|| "Üst klasör bulunamadı".to_string())?
            .to_string_lossy()
            .to_string();
        Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn open_file_native(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("Dosya bulunamadı: {}", path));
    }
    opener::open(&path).map_err(|e| format!("Dosya açılamadı: {}", e))
}

#[cfg(test)]
#[cfg(feature = "admin")]
mod tests {
    use super::*;

    #[test]
    fn test_refile_rejects_absolute_dest_path() {
        let tmp = std::env::temp_dir();
        let dest_root = tmp.join("refile_test_abs");
        std::fs::create_dir_all(&dest_root).ok();

        #[cfg(target_os = "windows")]
        let abs_path = "C:\\Users\\secret\\file.txt";
        #[cfg(not(target_os = "windows"))]
        let abs_path = "/etc/passwd";

        let op = RefileOp {
            source_path: "dummy.txt".into(),
            relative_dest_path: abs_path.into(),
        };
        let result = refile_organize(dest_root.to_string_lossy().into(), vec![op], "copy".into());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("Mutlak hedef yolu reddedildi"), "Got: {}", err);

        std::fs::remove_dir_all(&dest_root).ok();
    }

    #[test]
    fn test_refile_rejects_path_traversal() {
        let tmp = std::env::temp_dir();
        let dest_root = tmp.join("refile_test_trav");
        std::fs::create_dir_all(&dest_root).ok();

        let op = RefileOp {
            source_path: "dummy.txt".into(),
            relative_dest_path: "../../etc/passwd".into(),
        };
        let result = refile_organize(dest_root.to_string_lossy().into(), vec![op], "copy".into());
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("path traversal") || err.contains("Yol geçişi"), "Got: {}", err);

        std::fs::remove_dir_all(&dest_root).ok();
    }
}
