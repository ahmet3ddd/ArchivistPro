// CFB/OLE 3ds Max sürüm-tespit parser'ı: match kolu + iç `if` deseni bilinçli.
// clippy::collapsible_match pattern-guard'a çevirmeyi önerir; guard-fallthrough
// semantiği davranışı değiştirebilir, kozmetik lint → modül genelinde kapalı.
#![allow(clippy::collapsible_match)]

use cfb::CompoundFile;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::Read;

/// MAXScript path injection koruması: çift tırnak, null byte, satır sonu ve
/// kontrol karakterleri içeren yolları reddeder.
fn validate_maxscript_path(p: &str) -> Result<(), String> {
    if p.contains('"') {
        return Err(format!("Yol çift tırnak içeremez: {}", p));
    }
    if p.contains('\0') {
        return Err("Yol null byte içeremez".to_string());
    }
    if p.contains('\n') || p.contains('\r') {
        return Err("Yol satır sonu içeremez".to_string());
    }
    for ch in p.chars() {
        if ch.is_control() && ch != '\t' {
            return Err(format!("Yol kontrol karakteri içeremez: 0x{:02X}", ch as u32));
        }
    }
    Ok(())
}

/// Detects the 3ds Max version by searching all CFB streams for the ASCII
/// string "3ds Max Version: XX,00".  The integer XX maps to a product year
/// via: year = XX + 1998  (valid from V10/Max2008 onwards).
/// Example: "3ds Max Version: 21,00" → "2019 (V21)"
#[tauri::command]
pub fn get_max_version(path: String) -> Result<Option<String>, String> {
    const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024;
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_FILE_SIZE {
            return Err(format!("MAX dosyası çok büyük: {} bayt", meta.len()));
        }
    }
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut comp = CompoundFile::open(file).map_err(|e| e.to_string())?;

    // Collect stream paths first (walk borrows &self, open_stream needs &mut self)
    let streams: Vec<_> = comp
        .walk()
        .filter(|e| e.is_stream())
        .map(|e| e.path().to_path_buf())
        .collect();

    // ASCII pattern
    let pattern_ascii: &[u8] = b"3ds Max Version: ";
    // UTF-16LE pattern (3ds Max stores strings as UTF-16LE in some streams)
    let pattern_utf16: Vec<u8> = "3ds Max Version: "
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();

    for stream_path in &streams {
        let mut stream = match comp.open_stream(stream_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        const MAX_STREAM_SIZE: usize = 50 * 1024 * 1024;
        let mut buf = Vec::new();
        if let Err(e) = stream.read_to_end(&mut buf) {
            log::warn!("MAX stream read error in {:?}: {}", stream_path, e);
            continue;
        }
        if buf.len() > MAX_STREAM_SIZE {
            log::warn!("MAX stream too large: {:?} ({} bytes)", stream_path, buf.len());
            continue;
        }

        // Try ASCII pattern
        if let Some(pos) = buf.windows(pattern_ascii.len()).position(|w| w == pattern_ascii) {
            let after = &buf[pos + pattern_ascii.len()..];
            let digits: Vec<u8> = after.iter().take(10).take_while(|&&b| b.is_ascii_digit()).cloned().collect();
            if let Some(label) = max_version_label(&digits) {
                return Ok(Some(label));
            }
        }

        // Try UTF-16LE pattern
        if let Some(pos) = buf.windows(pattern_utf16.len()).position(|w| w == pattern_utf16.as_slice()) {
            let after = &buf[pos + pattern_utf16.len()..];
            // UTF-16LE digits: each digit is byte + 0x00
            let digits: Vec<u8> = after
                .chunks(2)
                .take_while(|c| c.len() == 2 && c[0].is_ascii_digit() && c[1] == 0)
                .map(|c| c[0])
                .collect();
            if let Some(label) = max_version_label(&digits) {
                return Ok(Some(label));
            }
        }
    }

    Ok(None)
}

pub fn max_version_label(digits: &[u8]) -> Option<String> {
    if digits.is_empty() { return None; }
    let s = std::str::from_utf8(digits).ok()?;
    let v: u32 = s.parse().ok()?;
    Some(if v >= 10 {
        format!("{} (V{})", v + 1998, v)
    } else {
        format!("3ds Max {} (V{})", v, v)
    })
}

/// 3ds Max dosyasının sürüm damgasını değiştirerek yeni bir dosya oluşturur.
/// Orijinal dosya korunur; yanına `_VYYYY.max` adıyla kaydedilir.
/// Döndürülen değer: yeni dosyanın tam yolu.
#[cfg(feature = "admin")]
#[tauri::command]
pub fn convert_max_version(path: String, target_version: u32) -> Result<String, String> {
    // target_version: internal version number (e.g. 23 for 2021)
    // Geçerli aralık: V10 (2008) – V27 (2025)
    if !(10..=27).contains(&target_version) {
        return Err(format!("Geçersiz hedef sürüm: V{}. Desteklenen aralık: V10 (2008) – V27 (2025).", target_version));
    }

    // Orijinal dosyayı oku
    let original_data = fs::read(&path).map_err(|e| format!("Dosya okunamadı: {}", e))?;

    // Hedef dosya adını oluştur: dosya_V2021.max
    let target_year = target_version + 1998;
    let src_path = std::path::Path::new(&path);
    let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let parent = src_path.parent().unwrap_or(std::path::Path::new("."));
    let dest_name = format!("{}_V{}.max", stem, target_year);
    let dest_path = parent.join(&dest_name);

    // Dosyayı kopyala
    fs::write(&dest_path, &original_data).map_err(|e| format!("Dosya yazılamadı: {}", e))?;

    // CFB olarak aç ve versiyon damgalarını değiştir
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&dest_path)
        .map_err(|e| format!("CFB dosyası açılamadı: {}", e))?;
    let mut comp = CompoundFile::open(file).map_err(|e| format!("CFB parse hatası: {}", e))?;

    // Stream yollarını topla
    let streams: Vec<_> = comp.walk()
        .filter(|e| e.is_stream())
        .map(|e| e.path().to_path_buf())
        .collect();

    let target_str = format!("{}", target_version);
    let mut patched_count = 0u32;

    // ASCII pattern: "3ds Max Version: XX"
    let pattern_ascii = b"3ds Max Version: ";
    // UTF-16LE pattern
    let pattern_utf16: Vec<u8> = "3ds Max Version: "
        .encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();

    for stream_path in &streams {
        let mut buf = Vec::new();
        {
            let mut stream = match comp.open_stream(stream_path) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if let Err(e) = stream.read_to_end(&mut buf) {
                log::warn!("MAX convert stream read error in {:?}: {}", stream_path, e);
                continue;
            }
        }

        let mut modified = false;

        // ASCII versiyon damgasını değiştir
        let mut offset = 0;
        while offset + pattern_ascii.len() < buf.len() {
            if let Some(pos) = buf[offset..].windows(pattern_ascii.len()).position(|w| w == pattern_ascii) {
                let abs_pos = offset + pos + pattern_ascii.len();
                // Mevcut versiyon rakamlarını bul
                let digit_end = buf[abs_pos..].iter()
                    .take_while(|&&b| b.is_ascii_digit())
                    .count();
                if digit_end > 0 {
                    // Eski rakamları yeni versiyon ile değiştir
                    let target_bytes = target_str.as_bytes();
                    let old_len = digit_end;
                    let new_len = target_bytes.len();
                    if old_len == new_len {
                        buf[abs_pos..abs_pos + new_len].copy_from_slice(target_bytes);
                    } else {
                        // Uzunluk farklıysa: sil ve ekle
                        buf.splice(abs_pos..abs_pos + old_len, target_bytes.iter().cloned());
                    }
                    modified = true;
                    patched_count += 1;
                    offset = abs_pos + new_len;
                } else {
                    offset = abs_pos;
                }
            } else {
                break;
            }
        }

        // UTF-16LE versiyon damgasını değiştir
        let target_utf16: Vec<u8> = target_str.encode_utf16()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        offset = 0;
        while offset + pattern_utf16.len() < buf.len() {
            if let Some(pos) = buf[offset..].windows(pattern_utf16.len()).position(|w| w == pattern_utf16.as_slice()) {
                let abs_pos = offset + pos + pattern_utf16.len();
                // UTF-16LE digit: byte + 0x00
                let mut digit_end = 0;
                while abs_pos + digit_end + 1 < buf.len()
                    && buf[abs_pos + digit_end].is_ascii_digit()
                    && buf[abs_pos + digit_end + 1] == 0
                {
                    digit_end += 2;
                }
                if digit_end > 0 {
                    let old_len = digit_end;
                    let new_len = target_utf16.len();
                    if old_len == new_len {
                        buf[abs_pos..abs_pos + new_len].copy_from_slice(&target_utf16);
                    } else {
                        buf.splice(abs_pos..abs_pos + old_len, target_utf16.iter().cloned());
                    }
                    modified = true;
                    patched_count += 1;
                    offset = abs_pos + new_len;
                } else {
                    offset = abs_pos;
                }
            } else {
                break;
            }
        }

        // Değişiklik varsa stream'i geri yaz
        if modified {
            if let Ok(mut writer) = comp.create_stream(stream_path) {
                let _ = std::io::Write::write_all(&mut writer, &buf);
            }
        }
    }

    // CFB'yi diske flush et
    comp.flush().map_err(|e| format!("CFB yazma hatası: {}", e))?;

    if patched_count == 0 {
        // Yama yapılamadıysa oluşturulan dosyayı sil
        let _ = fs::remove_file(&dest_path);
        return Err("Dosyada 3ds Max versiyon damgası bulunamadı. Dönüştürme yapılamadı.".to_string());
    }

    Ok(dest_path.to_string_lossy().to_string())
}

/// Sistemde kurulu 3ds Max sürümlerini tespit eder.
/// Registry (Autodesk\3dsMax\XX.0) ve Program Files taraması yapar.
/// Her bulunan kurulum için { version, year, exe_path } döndürür.
#[cfg(feature = "admin")]
#[derive(Serialize, Clone)]
pub struct MaxInstallation {
    pub version: u32,          // internal version (e.g. 23)
    pub year: u32,             // product year (e.g. 2021)
    pub exe_path: String,      // full path to 3dsmax.exe
    pub min_save_version: u32, // en düşük saveAsVersion desteği (version - 4)
}

#[cfg(feature = "admin")]
#[tauri::command]
pub fn detect_max_installations() -> Vec<MaxInstallation> {
    let mut installs: Vec<MaxInstallation> = Vec::new();
    let mut seen_versions = std::collections::HashSet::new();

    // Yöntem 1: Windows Registry
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;

        let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);

        // Autodesk kayıt defteri anahtarları — hem 64-bit hem WoW6432Node
        let registry_paths = [
            r"SOFTWARE\Autodesk\3dsMax",
            r"SOFTWARE\WOW6432Node\Autodesk\3dsMax",
        ];

        for reg_path in &registry_paths {
            if let Ok(max_key) = hklm.open_subkey_with_flags(reg_path, KEY_READ) {
                for subkey_name in max_key.enum_keys().filter_map(|k| k.ok()) {
                    // Subkey: "23.0", "24.0", etc.
                    let version_f: f32 = subkey_name.split('.').next()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(0.0);
                    let version = version_f as u32;
                    if !(10..=30).contains(&version) { continue; }

                    if let Ok(ver_key) = max_key.open_subkey_with_flags(&subkey_name, KEY_READ) {
                        // "Installdir" değerini oku
                        let install_dir: Option<String> = ver_key.get_value("Installdir").ok();
                        if let Some(dir) = install_dir {
                            let exe = std::path::Path::new(&dir).join("3dsmax.exe");
                            if exe.exists() && seen_versions.insert(version) {
                                installs.push(MaxInstallation {
                                    version,
                                    year: version + 1998,
                                    exe_path: exe.to_string_lossy().to_string(),
                                    min_save_version: if version > 3 { version - 3 } else { 10 },
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Yöntem 2: Program Files dizin taraması (Registry'de bulunamayanlar için)
    let program_dirs = [
        r"C:\Program Files\Autodesk",
        r"C:\Program Files (x86)\Autodesk",
    ];

    for base in &program_dirs {
        let base_path = std::path::Path::new(base);
        if !base_path.exists() { continue; }
        if let Ok(entries) = fs::read_dir(base_path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let name = entry.file_name().to_string_lossy().to_string();
                // "3ds Max 2021", "3ds Max 2024" vb.
                if !name.to_lowercase().contains("3ds max") { continue; }
                // Yılı çıkar
                let year: u32 = name.chars()
                    .collect::<String>()
                    .split_whitespace()
                    .filter_map(|w| w.parse::<u32>().ok())
                    .find(|&y| (2008..=2030).contains(&y))
                    .unwrap_or(0);
                if year == 0 { continue; }
                let version = year - 1998;

                let exe = entry.path().join("3dsmax.exe");
                if exe.exists() && seen_versions.insert(version) {
                    installs.push(MaxInstallation {
                        version,
                        year,
                        exe_path: exe.to_string_lossy().to_string(),
                        min_save_version: if version > 3 { version - 3 } else { 10 },
                    });
                }
            }
        }
    }

    installs.sort_by_key(|i| std::cmp::Reverse(i.year));
    installs
}

/// 3dsmax.exe process'inin çalışıp çalışmadığını kontrol eder.
#[cfg(feature = "admin")]
#[tauri::command]
pub fn is_max_running() -> bool {
    let output = std::process::Command::new("tasklist")
        .arg("/FI")
        .arg("IMAGENAME eq 3dsmax.exe")
        .arg("/NH")
        .output();
    match output {
        Ok(o) => {
            let stdout = String::from_utf8_lossy(&o.stdout);
            stdout.contains("3dsmax.exe")
        }
        Err(_) => false,
    }
}

/// 3ds Max MAXScript ile gerçek sürüm dönüştürme.
/// Kurulu Max'ı kullanarak dosyayı hedef sürümde yeniden kaydeder.
/// Bu işlem Max'ı arka planda (headless) başlatır.
#[cfg(feature = "admin")]
#[tauri::command]
pub fn convert_max_real(
    path: String,
    target_version: u32,
    max_exe_path: String,
) -> Result<String, String> {
    if !(10..=27).contains(&target_version) {
        return Err(format!("Geçersiz hedef sürüm: V{}", target_version));
    }

    // MAXScript injection koruması: yol doğrulama
    validate_maxscript_path(&path)?;
    validate_maxscript_path(&max_exe_path)?;

    let src_path = std::path::Path::new(&path);
    if !src_path.exists() {
        return Err("Kaynak dosya bulunamadı.".to_string());
    }

    let max_exe = std::path::Path::new(&max_exe_path);
    if !max_exe.exists() {
        return Err(format!("3ds Max bulunamadı: {}", max_exe_path));
    }

    // Hedef dosya adı
    let target_year = target_version + 1998;
    let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let parent = src_path.parent().unwrap_or(std::path::Path::new("."));
    let dest_name = format!("{}_V{}.max", stem, target_year);
    let dest_path = parent.join(&dest_name);

    // Forward slash — MAXScript path sorunlarını önler
    let src_fwd = path.replace('\\', "/");
    let dest_fwd = dest_path.to_string_lossy().replace('\\', "/");

    // Oluşturulan hedef yolu da doğrula
    validate_maxscript_path(&dest_fwd)?;

    // Log ve flag dosyaları — TEMP dizininde
    let temp_dir = std::env::temp_dir();
    let log_path = temp_dir.join("_archivist_convert_log.txt");
    let log_fwd = log_path.to_string_lossy().replace('\\', "/");
    let done_flag = temp_dir.join("_archivist_convert_done.flag");
    let done_fwd = done_flag.to_string_lossy().replace('\\', "/");
    // Eski flag'ı temizle
    let _ = fs::remove_file(&done_flag);
    let _ = fs::remove_file(&log_path);

    // Max'ın kullanıcı startup scripts dizinini bul
    // %LOCALAPPDATA%\Autodesk\3dsMax\{year} - 64bit\ENU\scripts\startup\
    let max_year = {
        // exe_path'ten yılı çıkar: "...\3ds Max 2020\3dsmax.exe"
        let exe_parent = std::path::Path::new(&max_exe_path)
            .parent().unwrap_or(std::path::Path::new("."))
            .to_string_lossy().to_string();
        let year: u32 = exe_parent.split(|c: char| !c.is_ascii_digit())
            .filter_map(|w| w.parse::<u32>().ok())
            .find(|&y| (2008..=2030).contains(&y))
            .unwrap_or(target_version + 1998);
        year
    };

    let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
    // Dil kodu: ENU, TRK, vb. — mevcut dizini tara
    let max_user_dir = std::path::Path::new(&local_app)
        .join("Autodesk")
        .join("3dsMax")
        .join(format!("{} - 64bit", max_year));

    // Dil klasörünü bul (ENU, TRK, vb.)
    let lang_dir = if max_user_dir.exists() {
        fs::read_dir(&max_user_dir).ok()
            .and_then(|entries| {
                entries.filter_map(|e| e.ok())
                    .find(|e| e.path().is_dir() && e.path().join("scripts").join("startup").exists())
                    .map(|e| e.path())
            })
    } else {
        None
    };

    let startup_dir = match lang_dir {
        Some(lang) => lang.join("scripts").join("startup"),
        None => {
            // Fallback: global startup scripts dizini
            std::path::Path::new(&max_exe_path)
                .parent().unwrap_or(std::path::Path::new("."))
                .join("scripts").join("startup")
        }
    };

    // Startup dizininin var olduğundan emin ol
    let _ = fs::create_dir_all(&startup_dir);
    let startup_script = startup_dir.join("_archivist_autorun.ms");

    // MAXScript: dosyayı yükle, kaydet, logla, kendini sil, Max'ı kapat
    // Her log yazısı kapatıp açarak flushleniyor (MAXScript buffer'ı yoktur)
    let script = format!(
        r#"(
    -- Archivist Pro: otomatik surum donusturme (tek seferlik)
    local scriptFile = @"{script_self}"
    local logFile = @"{log}"
    local doneFile = @"{done}"
    local srcFile = @"{src}"
    local destFile = @"{dest}"

    -- Her cagri flush icin kapatip aciyor
    fn wlog msg = (
        local lf = openFile logFile mode:"a"
        if lf != undefined then ( format "%" msg to:lf; close lf )
    )

    -- Ilk log olustur
    local initF = createFile logFile
    close initF
    wlog "archivist: started\n"

    -- Tum diyaloglari kapat
    SetQuietMode true

    try (
        wlog "archivist: loading file\n"
        local loadOk = loadMaxFile srcFile quiet:true useFileUnits:true missingFileFree:true
        wlog ("archivist: load = " + (loadOk as string) + "\n")

        if loadOk then (
            -- Max surumu logla
            local mv = maxVersion()
            wlog ("archivist: maxver = " + (mv[1] as string) + "\n")
            wlog "archivist: saving as year {year}\n"
            -- Once yil formatiyla dene (2017-2020), basarisiz olursa ic versiyon numarasiyla
            local saveOk = false
            try (
                setSaveRequired false
                saveOk = saveMaxFile destFile saveAsVersion:{year} quiet:true
                wlog ("archivist: save(year) = " + (saveOk as string) + "\n")
            ) catch (
                wlog ("archivist: save(year) FAILED: " + (getCurrentException() as string) + "\n")
                try (
                    saveOk = saveMaxFile destFile saveAsVersion:{ver} quiet:true
                    wlog ("archivist: save(ver) = " + (saveOk as string) + "\n")
                ) catch (
                    wlog ("archivist: save(ver) FAILED: " + (getCurrentException() as string) + "\n")
                )
            )
            wlog ("archivist: final saveOk = " + (saveOk as string) + "\n")
        ) else (
            wlog "archivist: load FAILED\n"
        )
    ) catch (
        wlog ("archivist: FATAL ERROR: " + (getCurrentException() as string) + "\n")
    )

    -- Done flag'i HEMEN yaz
    local df = createFile doneFile
    format "done" to:df
    close df

    -- Kendini sil
    deleteFile scriptFile

    -- Max'i kapatmaya calis
    try (
        setSaveRequired false
        quitMax #noPrompt
    ) catch ()
)"#,
        script_self = startup_script.to_string_lossy().replace('\\', "/"),
        log = log_fwd,
        done = done_fwd,
        src = src_fwd,
        dest = dest_fwd,
        ver = target_version,
        year = target_year,
    );

    fs::write(&startup_script, &script)
        .map_err(|e| format!("Startup script yazılamadı: {}", e))?;

    // Max'ı normal başlat — startup script otomatik çalışacak
    let mut child = std::process::Command::new(&max_exe_path)
        .spawn()
        .map_err(|e| format!("3ds Max başlatılamadı: {}", e))?;

    // Done flag dosyasının oluşmasını bekle (max 5 dakika)
    let start_time = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(300);

    loop {
        if done_flag.exists() {
            // Max kapanmasa da devam et — asağıda cleanup kapat
            break;
        }
        if let Ok(Some(_)) = child.try_wait() {
            std::thread::sleep(std::time::Duration::from_secs(2));
            break;
        }
        if start_time.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&startup_script);
            return Err("Zaman aşımı: 3ds Max 5 dakika içinde dönüştürmeyi tamamlayamadı.".to_string());
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
    }

    // Temizlik
    let _ = fs::remove_file(&startup_script);
    let _ = fs::remove_file(&done_flag);

    // Max hala aciksa kapat (quitMax basarisiz olmus olabilir)
    std::thread::sleep(std::time::Duration::from_secs(3));
    if let Ok(None) = child.try_wait() {
        // Process hala calisiyor — nazikce kapat
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &child.id().to_string()])
            .output();
        std::thread::sleep(std::time::Duration::from_secs(2));
        // Hala kapanmadiysa zorla kapat
        if let Ok(None) = child.try_wait() {
            let _ = child.kill();
        }
        let _ = child.wait();
    }

    // Log dosyasını oku
    let log_content = fs::read_to_string(&log_path).unwrap_or_default();
    let _ = fs::remove_file(&log_path);

    if dest_path.exists() {
        Ok(dest_path.to_string_lossy().to_string())
    } else if log_content.is_empty() {
        Err("Dönüştürme başarısız: MAXScript hiç çalışmadı. \
             Startup scripts dizini bulunamıyor olabilir. \
             Hızlı mod (damga değiştirme) ile deneyin.".to_string())
    } else {
        Err(format!(
            "Dönüştürme başarısız. MAXScript logu:\n{}",
            log_content.chars().take(1000).collect::<String>(),
        ))
    }
}

/* ── MAX Zengin Metadata Çıkarma ── */

#[derive(Serialize, Default)]
pub struct MaxRichMetadata {
    pub version: Option<String>,
    pub stream_count: usize,
    pub stream_names: Vec<String>,
    pub detected_strings: Vec<String>,
    pub plugin_names: Vec<String>,
    pub material_names: Vec<String>,
    pub object_names: Vec<String>,
    pub layer_names: Vec<String>,
    pub file_size_bytes: u64,
    pub cfb_storage_names: Vec<String>,
}

/// Byte dizisinden null-terminated UTF-16LE stringleri çıkarır.
/// MAX 2012+ versiyonlarında obje/katman isimleri UTF-16LE olarak saklanır.
fn extract_utf16le_strings(data: &[u8], min_len: usize, max_len: usize) -> Vec<String> {
    let mut results = Vec::new();
    if data.len() < 4 { return results; }

    let mut i = 0;
    while i + 4 < data.len() {
        // Null-terminated UTF-16LE: her karakter 2 byte, sonu 0x00 0x00
        // İlk karakterin ASCII printable range'de olmasını bekle
        let lo = data[i];
        let hi = data[i + 1];
        if (0x20..0x7F).contains(&lo) && hi == 0x00 {
            let mut chars: Vec<u16> = Vec::new();
            let mut j = i;
            while j + 2 <= data.len() {
                let c = u16::from_le_bytes([data[j], data[j + 1]]);
                if c == 0 { break; }
                // Kabul: printable ASCII, Latin ek karakterler, Türkçe/Kiril
                if (0x0020..=0x007E).contains(&c)
                    || (0x00C0..=0x024F).contains(&c)
                {
                    chars.push(c);
                } else {
                    break;
                }
                j += 2;
            }
            if chars.len() >= min_len && chars.len() <= max_len {
                if let Ok(s) = String::from_utf16(&chars) {
                    let trimmed = s.trim().to_string();
                    if !trimmed.is_empty() {
                        results.push(trimmed);
                    }
                }
                i = j + 2; // null terminator'ı atla
                continue;
            }
        }
        i += 1;
    }
    results.dedup();
    results
}

/// MAX chunk binary verisi içinde layer (0x1016) ve node (0x0960) adlarını tarar.
/// 3ds Max chunk format: [chunkID: u16 LE][chunkLen: i32 LE][data...]
/// String data: [len: u16 LE][UTF-16LE chars...][0x00 0x00]
fn scan_max_chunks(data: &[u8]) -> (Vec<String>, Vec<String>) {
    let mut objects: Vec<String> = Vec::new();
    let mut layers: Vec<String> = Vec::new();

    let mut i = 0;
    while i + 6 < data.len() {
        let chunk_id = u16::from_le_bytes([data[i], data[i + 1]]);
        let chunk_len = i32::from_le_bytes([data[i + 2], data[i + 3], data[i + 4], data[i + 5]]);

        let is_string_chunk = matches!(chunk_id, 0x0960 | 0x1016 | 0x3000 | 0x0440);
        if is_string_chunk {
            // String verisi chunk header'dan hemen sonra başlar
            let data_offset = i + 6;
            if data_offset + 2 < data.len() {
                // Önce length-prefixed UTF-16LE dene
                let str_char_count = u16::from_le_bytes([data[data_offset], data[data_offset + 1]]) as usize;
                let byte_end = data_offset + 2 + str_char_count * 2;
                if str_char_count > 0 && str_char_count <= 128 && byte_end <= data.len() {
                    let slice = &data[data_offset + 2..byte_end];
                    let chars: Vec<u16> = slice.chunks(2)
                        .map(|c| u16::from_le_bytes([c[0], if c.len() > 1 { c[1] } else { 0 }]))
                        .filter(|&c| c != 0)
                        .collect();
                    if !chars.is_empty() {
                        if let Ok(s) = String::from_utf16(&chars) {
                            let s = s.trim().to_string();
                            if !s.is_empty() && is_valid_max_name(&s) {
                                match chunk_id {
                                    0x1016 => { if !layers.contains(&s) { layers.push(s); } }
                                    0x0960 | 0x3000 => { if !objects.contains(&s) { objects.push(s); } }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
        }

        // Sonraki chunk'a geç
        let abs_len = chunk_len.unsigned_abs() as usize;
        i += if abs_len > 6 { abs_len } else { 6 }.min(data.len() - i);

        // Sonsuz döngü koruması: en az 1 ilerleme
        if abs_len < 6 { i += 1; }
    }
    (objects, layers)
}

/// String'in gerçek bir obje/katman adı olup olmadığını kontrol eder.
fn is_valid_max_name(s: &str) -> bool {
    if s.is_empty() || s.len() > 80 { return false; }
    // Yol karakterleri veya sistem gürültüsü içeriyorsa reddet
    if s.contains('/') || s.contains('\\') || s.contains(':') { return false; }
    // En az bir harf veya rakam içermeli
    s.chars().any(|c| c.is_alphanumeric())
}

/// 3ds Max dosyasından mümkün olan maksimum metadata çıkarır.
/// CFB stream'lerini tarar: versiyon, stream isimleri, içeriklerden
/// plugin/malzeme/obje isimlerini arar.
#[tauri::command]
pub fn extract_max_metadata(path: String) -> Result<MaxRichMetadata, String> {
    const MAX_FILE_SIZE: u64 = 500 * 1024 * 1024; // 500 MB
    let file_meta = fs::metadata(&path).map_err(|e| e.to_string())?;
    if file_meta.len() > MAX_FILE_SIZE {
        return Err(format!("MAX dosyası çok büyük: {} bayt (max {} MB)", file_meta.len(), MAX_FILE_SIZE / 1024 / 1024));
    }
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let comp = CompoundFile::open(file).map_err(|e| e.to_string())?;

    let mut meta = MaxRichMetadata {
        file_size_bytes: file_meta.len(),
        ..Default::default()
    };

    // Stream ve storage isimlerini topla
    let entries: Vec<_> = comp.walk().collect();
    for entry in &entries {
        let name = entry.path().to_string_lossy().to_string();
        if entry.is_stream() {
            meta.stream_names.push(name);
        } else {
            meta.cfb_storage_names.push(name);
        }
    }
    meta.stream_count = meta.stream_names.len();

    // Versiyon tespiti (mevcut fonksiyonu kullan)
    let file2 = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut comp2 = CompoundFile::open(file2).map_err(|e| e.to_string())?;
    let streams2: Vec<_> = comp2.walk()
        .filter(|e| e.is_stream())
        .map(|e| e.path().to_path_buf())
        .collect();

    // Stream içeriklerinden string çıkarma
    let mut all_strings: HashMap<String, bool> = HashMap::new();

    for stream_path in &streams2 {
        let mut stream = match comp2.open_stream(stream_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        const MAX_STREAM_SIZE: usize = 50 * 1024 * 1024;
        let mut buf = Vec::new();
        if let Err(e) = stream.read_to_end(&mut buf) {
            log::warn!("MAX stream read error in {:?}: {}", stream_path, e);
            continue;
        }
        if buf.len() > MAX_STREAM_SIZE {
            log::warn!("MAX stream too large: {:?} ({} bytes)", stream_path, buf.len());
            continue;
        }

        // Versiyon (ASCII)
        let pattern_ascii: &[u8] = b"3ds Max Version: ";
        if meta.version.is_none() {
            if let Some(pos) = buf.windows(pattern_ascii.len()).position(|w| w == pattern_ascii) {
                let after = &buf[pos + pattern_ascii.len()..];
                let digits: Vec<u8> = after.iter().take(10).take_while(|&&b| b.is_ascii_digit()).cloned().collect();
                if let Some(label) = max_version_label(&digits) {
                    meta.version = Some(label);
                }
            }
        }

        // ASCII stringlerden isim çıkarma (min 4, max 80 karakter)
        let extracted = extract_printable_strings(&buf, 4, 80);
        for s in extracted {
            let lower = s.to_lowercase();
            // Plugin isimleri
            if (lower.contains("plugin") || lower.contains(".dlr") || lower.contains(".dlo")
                || lower.contains(".dlm") || lower.contains(".dlu") || lower.contains(".gup"))
                && !meta.plugin_names.contains(&s)
            {
                meta.plugin_names.push(s.clone());
            }
            // Malzeme ipuçları
            if (lower.contains("material") || lower.contains("mtl") || lower.contains("shader")
                || lower.contains("vray") || lower.contains("corona") || lower.contains("arnold")
                || lower.contains("mental") || lower.contains("bitmap"))
                && !meta.material_names.contains(&s)
            {
                meta.material_names.push(s.clone());
            }
            all_strings.insert(s, true);
        }

        // UTF-16LE string çıkarma (obje/katman isimleri için)
        let utf16_strings = extract_utf16le_strings(&buf, 2, 80);
        for s in utf16_strings {
            if is_valid_max_name(&s) && !meta.object_names.contains(&s) {
                meta.object_names.push(s);
            }
        }

        // Scene stream'i ise chunk taraması yap (katman + node isimleri)
        let stream_name = stream_path.to_string_lossy().to_lowercase();
        if stream_name.contains("scene") || stream_name.contains("assembly") {
            let (chunk_objects, chunk_layers) = scan_max_chunks(&buf);
            for s in chunk_objects {
                if !meta.object_names.contains(&s) { meta.object_names.push(s); }
            }
            for s in chunk_layers {
                if !meta.layer_names.contains(&s) { meta.layer_names.push(s); }
            }
        }
    }

    // Belirli render motorlarını ara
    meta.detected_strings = all_strings.into_keys()
        .filter(|s| {
            let l = s.to_lowercase();
            l.contains("vray") || l.contains("corona") || l.contains("arnold")
                || l.contains("mental ray") || l.contains("scanline")
                || l.contains("octane") || l.contains("redshift")
        })
        .collect();

    // Limitle (çok fazla olmasın)
    meta.plugin_names.truncate(50);
    meta.material_names.truncate(100);
    meta.detected_strings.truncate(50);

    Ok(meta)
}

/// 3ds Max dosyasını FBX veya OBJ formatına export eder.
/// Kurulu Max'ı MAXScript ile headless modda başlatır.
/// `format`: "fbx" veya "obj"
#[cfg(feature = "admin")]
#[tauri::command]
pub fn export_max_to_format(
    path: String,
    format: String,
    max_exe_path: String,
) -> Result<String, String> {
    let fmt_lower = format.to_lowercase();
    if fmt_lower != "fbx" && fmt_lower != "obj" {
        return Err(format!("Desteklenmeyen format: {}. Sadece 'fbx' veya 'obj' desteklenir.", format));
    }

    validate_maxscript_path(&path)?;
    validate_maxscript_path(&max_exe_path)?;

    let src_path = std::path::Path::new(&path);
    if !src_path.exists() {
        return Err("Kaynak dosya bulunamadı.".to_string());
    }
    let max_exe = std::path::Path::new(&max_exe_path);
    if !max_exe.exists() {
        return Err(format!("3ds Max bulunamadı: {}", max_exe_path));
    }

    // Hedef dosya: aynı klasör, aynı stem, format uzantısı
    let stem = src_path.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    let parent = src_path.parent().unwrap_or(std::path::Path::new("."));
    let dest_name = format!("{}.{}", stem, fmt_lower);
    let dest_path = parent.join(&dest_name);
    let dest_fwd = dest_path.to_string_lossy().replace('\\', "/");
    validate_maxscript_path(&dest_fwd)?;

    let src_fwd = path.replace('\\', "/");

    // Log ve done flag dosyaları (TEMP)
    let temp_dir = std::env::temp_dir();
    let log_path = temp_dir.join("_archivist_export_log.txt");
    let log_fwd = log_path.to_string_lossy().replace('\\', "/");
    let done_flag = temp_dir.join("_archivist_export_done.flag");
    let done_fwd = done_flag.to_string_lossy().replace('\\', "/");
    let _ = fs::remove_file(&done_flag);
    let _ = fs::remove_file(&log_path);

    // Startup script dizini
    let max_year: u32 = {
        let exe_parent = std::path::Path::new(&max_exe_path)
            .parent().unwrap_or(std::path::Path::new("."))
            .to_string_lossy().to_string();
        exe_parent.split(|c: char| !c.is_ascii_digit())
            .filter_map(|w| w.parse::<u32>().ok())
            .find(|&y| (2008..=2030).contains(&y))
            .unwrap_or(2020)
    };
    let local_app = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let max_user_dir = std::path::Path::new(&local_app)
        .join("Autodesk").join("3dsMax")
        .join(format!("{} - 64bit", max_year));
    let lang_dir = if max_user_dir.exists() {
        fs::read_dir(&max_user_dir).ok()
            .and_then(|entries| {
                entries.filter_map(|e| e.ok())
                    .find(|e| e.path().is_dir() && e.path().join("scripts").join("startup").exists())
                    .map(|e| e.path())
            })
    } else {
        None
    };
    let startup_dir = match lang_dir {
        Some(lang) => lang.join("scripts").join("startup"),
        None => std::path::Path::new(&max_exe_path)
            .parent().unwrap_or(std::path::Path::new("."))
            .join("scripts").join("startup"),
    };
    let _ = fs::create_dir_all(&startup_dir);
    let startup_script = startup_dir.join("_archivist_export_autorun.ms");

    // Export plugin class name ve uzantı seçimi
    // FBX: FBXEXP (FBX Exporter); OBJ: ObjExp
    let (export_class, _export_ext) = match fmt_lower.as_str() {
        "fbx" => ("FBXEXP", "fbx"),
        "obj" => ("ObjExp", "obj"),
        _     => ("FBXEXP", "fbx"),
    };

    let script = format!(
        r#"(
    -- Archivist Pro: MAX export to {fmt} (tek seferlik)
    local scriptFile = @"{script_self}"
    local logFile = @"{log}"
    local doneFile = @"{done}"
    local srcFile = @"{src}"
    local destFile = @"{dest}"

    fn wlog msg = (
        local lf = openFile logFile mode:"a"
        if lf != undefined then ( format "%" msg to:lf; close lf )
    )
    local initF = createFile logFile
    close initF
    wlog "archivist-export: started\n"
    SetQuietMode true

    try (
        wlog "archivist-export: loading file\n"
        local loadOk = loadMaxFile srcFile quiet:true useFileUnits:true missingFileFree:true
        wlog ("archivist-export: load = " + (loadOk as string) + "\n")

        if loadOk then (
            wlog ("archivist-export: exporting to {fmt}\n")
            local exportOk = exportFile destFile #noPrompt using:{cls}
            wlog ("archivist-export: export = " + (exportOk as string) + "\n")
        ) else (
            wlog "archivist-export: load FAILED\n"
        )
    ) catch (
        wlog ("archivist-export: FATAL ERROR: " + (getCurrentException() as string) + "\n")
    )

    local df = createFile doneFile
    format "done" to:df
    close df

    deleteFile scriptFile
    try ( setSaveRequired false; quitMax #noPrompt ) catch ()
)"#,
        fmt = fmt_lower.to_uppercase(),
        script_self = startup_script.to_string_lossy().replace('\\', "/"),
        log = log_fwd,
        done = done_fwd,
        src = src_fwd,
        dest = dest_fwd,
        cls = export_class,
    );

    fs::write(&startup_script, &script)
        .map_err(|e| format!("Startup script yazılamadı: {}", e))?;

    let mut child = std::process::Command::new(&max_exe_path)
        .spawn()
        .map_err(|e| format!("3ds Max başlatılamadı: {}", e))?;

    // Done flag'i bekle (max 5 dakika)
    let start_time = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(300);
    loop {
        if done_flag.exists() { break; }
        if let Ok(Some(_)) = child.try_wait() {
            std::thread::sleep(std::time::Duration::from_secs(2));
            break;
        }
        if start_time.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            let _ = fs::remove_file(&startup_script);
            return Err("Zaman aşımı: export 5 dakika içinde tamamlanamadı.".to_string());
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
    }

    let _ = fs::remove_file(&startup_script);
    let _ = fs::remove_file(&done_flag);

    std::thread::sleep(std::time::Duration::from_secs(3));
    if let Ok(None) = child.try_wait() {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &child.id().to_string()])
            .output();
        std::thread::sleep(std::time::Duration::from_secs(2));
        if let Ok(None) = child.try_wait() { let _ = child.kill(); }
        let _ = child.wait();
    }

    let log_content = fs::read_to_string(&log_path).unwrap_or_default();
    let _ = fs::remove_file(&log_path);

    if dest_path.exists() {
        Ok(dest_path.to_string_lossy().to_string())
    } else if log_content.is_empty() {
        Err("Export başarısız: MAXScript çalışmadı. Startup scripts dizini bulunamıyor olabilir.".to_string())
    } else {
        Err(format!(
            "Export başarısız. MAXScript logu:\n{}",
            log_content.chars().take(1000).collect::<String>()
        ))
    }
}

/// Byte dizisinden yazdırılabilir ASCII stringleri çıkarır
fn extract_printable_strings(data: &[u8], min_len: usize, max_len: usize) -> Vec<String> {
    let mut results = Vec::new();
    let mut current = String::new();

    for &byte in data {
        if (0x20..0x7F).contains(&byte) {
            current.push(byte as char);
            if current.len() > max_len {
                results.push(current.clone());
                current.clear();
            }
        } else {
            if current.len() >= min_len {
                results.push(current.clone());
            }
            current.clear();
        }
    }
    if current.len() >= min_len {
        results.push(current);
    }
    results
}
