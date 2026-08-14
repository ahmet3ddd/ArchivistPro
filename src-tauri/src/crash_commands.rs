//! Crash log komutlari (P2.5 stabilite) — panik hook'un (crash.rs) yazdigi JSONL crash log'unu
//! oku/temizle. **Admin** (saha teshis; salt-okuma + temizleme). Yol `state.db_path`'ten turetilir
//! (snapshots deseni; ayri saklama yok).

use tauri::State;

use crate::{crash, rbac, AppState};

/// Crash/panik raporlari (en yeni once; en cok `limit`). **Admin**.
#[tauri::command]
pub fn crash_reports(
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<crash::CrashReport>, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    Ok(crash::read_reports(&crash::crash_log_path(&state.db_path), limit))
}

/// Crash raporu sayisi (kart rozeti; hizli). **Admin**.
#[tauri::command]
pub fn crash_report_count(state: State<'_, AppState>) -> Result<usize, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    Ok(crash::read_reports(&crash::crash_log_path(&state.db_path), 500).len())
}

/// Uygulamayi temiz sekilde sonlandir (cikis onayi sonrasi). **Yetki gate'i YOK** — kullanici
/// zaten pencereyi kapatmaya calisiyordu; onay diyalogunu ONAYLADI.
///
/// ⚠️ NEDEN JS `getCurrentWindow().destroy()` DEGIL (2026-07-18'de CANLI YASANDI):
/// Tauri v2'de `core:window` **varsayilan izinleri SALT-OKUMA** (`allow-destroy`/`allow-close`
/// YOK — bkz `gen/schemas/acl-manifests.json`). JS'ten `destroy()` cagrisi izin reddine duser;
/// hata yakalanip yutulursa "Cik" dugmesi HICBIR SEY YAPMAZ ve kullanici uygulamayi Gorev
/// Yoneticisi'nden kapatmak zorunda kalir — tam olarak bu oldu. **Kendi komutlarimiz yetenek
/// (capability) izin sistemine TABI DEGILDIR** → Rust tarafindan cikmak hem calisir hem
/// capabilities dosyasini genisletmeye (ve boylece renderer'a pencere-yiketme yetkisi acmaya)
/// gerek birakmaz. H2 de aynisini yapiyordu (`lib.rs` `app_quit` → `app.exit(0)`).
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle, state: State<'_, AppState>) {
    // Graceful-shutdown marker'ini SIL → bir sonraki acilis bu kapanisi TEMIZ gorsun (beklenmedik
    // sonlanma sanmasin). `quit_app` tek temiz-cikis yolu (useExitGuard onay → ipc.quitApp). Sil,
    // sonra cik (fs::remove senkron; app.exit(0) sureci sonlandirir).
    crate::shutdown_marker::clear_marker(&crate::shutdown_marker::marker_path(&state.db_path));
    app.exit(0);
}

/// Renderer (React) tarafinda yakalanan hatayi crash log'a yaz — H2 `writeCrashReport('react_error')`
/// paritesi. **YETKI GATE'I YOK, bilerek:** (1) UI hatasi giris ekraninda da olabilir (oturum yok →
/// `current_role` reddederdi), (2) surec-ici renderer zaten bizim kodumuz, (3) rapor kanali
/// kapatilirsa hata IZSIZ kalir — H3'te tam olarak bu oluyordu (ErrorBoundary yoktu, beyaz ekran
/// crash paneline hic dusmuyordu). Panik hook'uyla AYNI dosyaya, ayni bicimde yazar; `thread`
/// alanina `renderer` yazilir ki saha teshisinde Rust panigiyle karistirilmasin.
#[tauri::command]
pub fn report_frontend_error(
    message: String,
    location: String,
    stack: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    // Dosya sismesine karsi kelepce (H2 backtrace kisaltmasiyla ayni gerekce).
    let report = crash::CrashReport {
        ts: crash::now_unix(),
        thread: "renderer".to_string(),
        message: message.chars().take(2000).collect(),
        location: location.chars().take(500).collect(),
        backtrace: stack.chars().take(4000).collect(),
    };
    crash::append_report(&crash::crash_log_path(&state.db_path), &report);
    Ok(())
}

/// Crash log dosyasini temizle (sil). **Admin**. Dosya yoksa no-op.
#[tauri::command]
pub fn clear_crash_reports(state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let path = crash::crash_log_path(&state.db_path);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}
