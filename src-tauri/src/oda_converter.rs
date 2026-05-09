//! DWG → DXF dönüşüm cache'i (Faz 4.2).
//!
//! `dwg_parse::convert_dwg_to_dxf` ham dönüşümü sağlıyor (her çağrıda temp dizin
//! yaratıp siliyor). Bu modül üzerine persistent cache koyar:
//!
//!   `<app_data>/cache/dxf_conversions/<path_hash>_<mtime_ms>_<size>.dxf`
//!
//! Aynı DWG dosyası değişmediği sürece sonraki tarama kopyalanmış DXF'i yeniden
//! kullanır — ODA'yı tekrar çalıştırmaz. mtime veya size değişince anahtar
//! farklılaşır → otomatik invalidation (Karar 2 — hibrit regen).

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::dwg_parse::{convert_dwg_to_dxf, get_oda_converter_path};

const CACHE_SUBDIR_A: &str = "cache";
const CACHE_SUBDIR_B: &str = "dxf_conversions";

fn cache_dir(app_data: &Path) -> PathBuf {
    app_data.join(CACHE_SUBDIR_A).join(CACHE_SUBDIR_B)
}

/// Cache anahtarı üretir: path hash + mtime_ms + size. Dosya değişirse anahtar değişir.
fn compute_cache_key(dwg_path: &Path) -> Result<String, String> {
    let meta = fs::metadata(dwg_path)
        .map_err(|e| format!("DWG metadata okunamadı: {}", e))?;
    let mtime_ms = meta.modified()
        .map_err(|e| format!("DWG mtime okunamadı: {}", e))?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Sistem saati geçersiz: {}", e))?
        .as_millis();
    let size = meta.len();

    let mut h = DefaultHasher::new();
    dwg_path.to_string_lossy().to_lowercase().hash(&mut h);
    let path_hash = h.finish();

    Ok(format!("{:016x}_{}_{}.dxf", path_hash, mtime_ms, size))
}

/// Cache'te varsa mevcut DXF yolunu döner; yoksa ODA ile çevirip cache'e koyar.
/// ODA kurulu değilse `Err` — çağıran UI uyarısı gösterir.
pub fn convert_dwg_to_dxf_cached(dwg_path: &str, app_data: &Path) -> Result<PathBuf, String> {
    let dwg = Path::new(dwg_path);
    if !dwg.is_file() {
        return Err(format!("DWG dosyası bulunamadı: {}", dwg_path));
    }

    let dir = cache_dir(app_data);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Cache dizini oluşturulamadı: {}", e))?;

    let key = compute_cache_key(dwg)?;
    let cached = dir.join(&key);

    if cached.is_file() {
        log::info!("DXF cache hit: {}", cached.display());
        return Ok(cached);
    }

    let oda = get_oda_converter_path()
        .ok_or_else(|| "ODAFileConverter kurulu değil — DWG geometrik arama için gerekli".to_string())?;

    log::info!("DXF cache miss, ODA çalıştırılıyor: {}", dwg_path);
    let (dxf_temp, output_dir) = convert_dwg_to_dxf(dwg_path, &oda)?;

    // Cache'e kopyala, sonra temp output'u temizle
    fs::copy(&dxf_temp, &cached)
        .map_err(|e| format!("DXF cache'e yazılamadı: {}", e))?;
    let _ = fs::remove_dir_all(&output_dir);

    log::info!("DXF cached: {}", cached.display());
    Ok(cached)
}

/// Cache'i tamamen temizler (manuel "Tüm geometrik indeksi yeniden kur" butonu için — Karar 2).
pub fn clear_dxf_cache(app_data: &Path) -> Result<u64, String> {
    let dir = cache_dir(app_data);
    if !dir.is_dir() { return Ok(0); }
    let mut total: u64 = 0;
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for e in entries.flatten() {
        if let Ok(m) = e.metadata() { total += m.len(); }
        let _ = fs::remove_file(e.path());
    }
    Ok(total)
}

#[tauri::command]
pub fn clear_dxf_cache_cmd(app_handle: tauri::AppHandle) -> Result<u64, String> {
    use tauri::Manager;
    let app_data = app_handle.path().app_data_dir()
        .map_err(|e| format!("app_data_dir alınamadı: {}", e))?;
    clear_dxf_cache(&app_data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_changes_with_mtime() {
        use std::time::Duration;
        let tmp = std::env::temp_dir().join(format!("oda_test_{}.dwg", std::process::id()));
        fs::write(&tmp, b"dummy").unwrap();
        let k1 = compute_cache_key(&tmp).unwrap();

        // Modify file (content + implicit mtime)
        std::thread::sleep(Duration::from_millis(20));
        fs::write(&tmp, b"dummy-modified").unwrap();
        let k2 = compute_cache_key(&tmp).unwrap();

        assert_ne!(k1, k2, "cache key mtime/size değişince farklılaşmalı");
        let _ = fs::remove_file(&tmp);
    }

    #[test]
    fn cache_key_stable_for_same_file() {
        let tmp = std::env::temp_dir().join(format!("oda_test_stable_{}.dwg", std::process::id()));
        fs::write(&tmp, b"stable-content").unwrap();
        let k1 = compute_cache_key(&tmp).unwrap();
        let k2 = compute_cache_key(&tmp).unwrap();
        assert_eq!(k1, k2);
        let _ = fs::remove_file(&tmp);
    }

    #[test]
    fn cache_key_ends_with_dxf() {
        let tmp = std::env::temp_dir().join(format!("oda_test_ext_{}.dwg", std::process::id()));
        fs::write(&tmp, b"x").unwrap();
        let k = compute_cache_key(&tmp).unwrap();
        assert!(k.ends_with(".dxf"));
        let _ = fs::remove_file(&tmp);
    }
}
