//! Release kimligi tek kalmali: Rust'in `CARGO_PKG_VERSION` degeri sistem bilgisi, LAN ve
//! tasinabilir arsiv manifestlerine yazilir; Tauri/package surumunden saparsa kullaniciya ve
//! uyumluluk kontrollerine yanlis surum bildirilir.

#[test]
fn rust_tauri_and_frontend_versions_match() {
    let tauri: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).expect("valid tauri.conf.json");
    let package: serde_json::Value =
        serde_json::from_str(include_str!("../../package.json")).expect("valid package.json");
    let rust_version = env!("CARGO_PKG_VERSION");

    assert_eq!(
        tauri["version"].as_str(),
        Some(rust_version),
        "Tauri ve Rust surumu ayrismamali"
    );
    assert_eq!(
        package["version"].as_str(),
        Some(rust_version),
        "frontend ve Rust surumu ayrismamali"
    );
}
