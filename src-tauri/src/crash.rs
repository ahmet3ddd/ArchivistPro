//! Crash/panik raporlama (P2.5 stabilite) — panik hook panikleri bir JSONL dosyasina yazar
//! (`<db_parent>/logs/crash.log`). Panik aninda **DB'ye YAZILMAZ** (Mutex zehirlenebilir/kilitli →
//! yeniden-panik/deadlock riski); dosya-append kilitsiz + guvenli. Admin log-goruntuleyici bu
//! dosyayi okur → saha teshis kanali (bir sey kirildiginda "ne/nerede/ne zaman/hangi is parcacigi").
//!
//! Hook varsayilan (onceki) hook'u ZINCIRLER → stderr ciktisi + normal panik davranisi korunur.
//! `install_panic_hook` disinda her sey saf (yol/payload verilir) → birim test edilebilir.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Tek crash raporu (JSONL satiri + renderer kontrati; camelCase).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    /// Panik ani (unix saniye).
    pub ts: i64,
    /// Paniklerken calisan is parcacigi adi (bilinmiyorsa `<isimsiz>`).
    pub thread: String,
    /// Panik mesaji (payload metni).
    pub message: String,
    /// `dosya:satir` (panik konumu; yoksa bos).
    pub location: String,
    /// Yakalanan backtrace (ilk ~4000 karakter; bos olabilir).
    #[serde(default)]
    pub backtrace: String,
}

/// Crash log dosyasinin yolu — DB'nin ust-dizini altinda `logs/crash.log` (snapshots deseniyle
/// ayni koke goreli). Ust-dizin yoksa `.` (savunma; pratikte db_path daima mutlak).
pub fn crash_log_path(db_path: &Path) -> PathBuf {
    db_path.parent().unwrap_or_else(|| Path::new(".")).join("logs").join("crash.log")
}

/// Simdi (unix saniye). `crash_commands` renderer raporunda ayni zaman kaynagini kullanir.
pub fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Panik payload'ini (`Any`) metne cevir — `&str` / `String` cikarilir; digeri jenerik. Saf.
pub fn payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "<string olmayan panik>".to_string()
    }
}

/// Panik hook'unu kur — panikleri `log_path`'e JSONL olarak ekler, sonra ONCEKI hook'u cagirir
/// (varsayilan stderr davranisi korunur). Best-effort: yazma/dizin hatasi yutulur (zaten panikte).
/// `logs/` dizini onceden olusturulur. Acilista bir kez cagrilir (idempotent degil — tekrar kurma).
pub fn install_panic_hook(log_path: PathBuf) {
    if let Some(dir) = log_path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Backtrace char-guvenli kisaltilir (panik-dongusunde dosya sismesin; String::truncate
        // char-siniri panigini onlemek icin chars().take()).
        let backtrace: String =
            std::backtrace::Backtrace::force_capture().to_string().chars().take(4000).collect();
        let report = CrashReport {
            ts: now_unix(),
            thread: std::thread::current().name().unwrap_or("<isimsiz>").to_string(),
            message: payload_message(info.payload()),
            location: info
                .location()
                .map(|l| format!("{}:{}", l.file(), l.line()))
                .unwrap_or_default(),
            backtrace,
        };
        append_report(&log_path, &report);
        prev(info); // zincir: stderr + varsayilan davranis
    }));
}

/// Bir raporu crash log'a ekle (JSONL satiri). **Best-effort**: dizin/yazma hatasi YUTULUR
/// (cagiranlar ya panikte ya da hata yolunda — raporlama ikinci bir hataya yol acmamali).
/// Panik hook'u ve renderer hata komutu AYNI yolu kullanir (tek yazma noktasi).
/// `true` = yazildi (yalniz test/teshis icin; cagiranlar sonucu yok sayabilir).
pub fn append_report(log_path: &Path, report: &CrashReport) -> bool {
    if let Some(dir) = log_path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let Ok(json) = serde_json::to_string(report) else {
        return false;
    };
    let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path) else {
        return false;
    };
    writeln!(f, "{json}").is_ok()
}

/// Crash raporlarini oku (en yeni ONCE; en cok `limit`, 1..=500). Bozuk/yarim satirlar (dosya
/// panik aninda yazilir → son satir eksik olabilir) sessizce atlanir. Dosya yoksa bos. Saf.
pub fn read_reports(path: &Path, limit: usize) -> Vec<CrashReport> {
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut reports: Vec<CrashReport> = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    reports.reverse(); // dosya kronolojik → en yeni basa
    reports.truncate(limit.clamp(1, 500));
    reports
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `append_report` yazdigini `read_reports` geri okuyabilmeli ve `logs/` dizini yoksa
    /// KENDISI olusturmali (renderer hata komutu panik hook'undan ONCE calisabilir → dizin
    /// henuz kurulmamis olabilir).
    #[test]
    fn append_report_creates_dir_and_roundtrips() {
        let tmp = std::env::temp_dir().join(format!("arsiv_crash_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        let log = tmp.join("logs").join("crash.log"); // dizin BILEREK yok
        let report = CrashReport {
            ts: 1_700_000_000,
            thread: "renderer".to_string(),
            message: "render hatasi".to_string(),
            location: "AssetGrid.tsx".to_string(),
            backtrace: "stack".to_string(),
        };
        assert!(append_report(&log, &report), "dizin yokken de yazmali");

        let back = read_reports(&log, 10);
        assert_eq!(back.len(), 1);
        assert_eq!(back[0].thread, "renderer");
        assert_eq!(back[0].message, "render hatasi");
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn payload_message_extracts_str_string_and_generic() {
        let s: &str = "bir hata";
        assert_eq!(payload_message(&s), "bir hata");
        let owned: String = "sahipli".to_string();
        assert_eq!(payload_message(&owned), "sahipli");
        let n: i32 = 42;
        assert_eq!(payload_message(&n), "<string olmayan panik>");
    }

    #[test]
    fn crash_log_path_is_logs_subdir_of_db_parent() {
        let p = crash_log_path(Path::new(r"C:\data\archivist.db"));
        assert!(p.ends_with(Path::new("logs").join("crash.log")));
        assert!(p.to_string_lossy().contains("data"), "db ust-dizini korunur");
    }

    #[test]
    fn read_reports_newest_first_skips_garbage_and_respects_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("crash.log");
        // 3 gecerli + 1 bozuk (yarim satir) + bos satir.
        let mut lines = String::new();
        for (i, msg) in ["ilk", "ikinci", "ucuncu"].iter().enumerate() {
            let r = CrashReport {
                ts: i as i64,
                thread: "main".into(),
                message: (*msg).into(),
                location: "x.rs:1".into(),
                backtrace: String::new(),
            };
            lines.push_str(&serde_json::to_string(&r).unwrap());
            lines.push('\n');
        }
        lines.push_str("{bozuk json\n\n");
        std::fs::write(&path, lines).unwrap();

        let all = read_reports(&path, 500);
        assert_eq!(all.len(), 3, "bozuk + bos satir atlandi");
        assert_eq!(all[0].message, "ucuncu", "en yeni once");
        assert_eq!(all[2].message, "ilk");

        let limited = read_reports(&path, 1);
        assert_eq!(limited.len(), 1);
        assert_eq!(limited[0].message, "ucuncu");

        // Olmayan dosya → bos.
        assert!(read_reports(&dir.path().join("yok.log"), 10).is_empty());
    }
}
