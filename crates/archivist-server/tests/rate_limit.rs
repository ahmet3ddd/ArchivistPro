//! Hiz siniri BAGLANTI testi — `security::allow_request`'in gercekten istek dongusune bagli
//! oldugunu HTTP seviyesinde kanitlar (birim testi yalniz fonksiyonu olcer, kabloyu OLCMEZ).
//!
//! ⚠️ **NEDEN AYRI DOSYA:** hiz sayaci process-global ve IP basina. `endpoints.rs` ile ayni
//! binary'de olsaydi, iki test paralel kosarken ayni `127.0.0.1` sayacini paylasir ve birbirini
//! rastgele 429'a dusururdu. Ayri test dosyasi = ayri process = temiz sayac.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use archivist_server::{ArchiveApi, AssetQueryFn, NotificationFn, ServerConfig, ServerHandle};

fn get_status(port: u16, path: &str) -> String {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return "CONNECT_FAIL".to_string();
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
    let req = format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return "WRITE_FAIL".to_string();
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    buf.lines().next().unwrap_or("").to_string()
}

#[test]
fn sel_429_ile_kesilir_ve_pencere_dolunca_acilir() {
    let notif: NotificationFn = Arc::new(|_since, _limit| Ok(vec![]));
    let assets: AssetQueryFn = Arc::new(|_opts| Ok(r#"{"total":0,"items":[]}"#.to_string()));
    let port = 19479;
    let handle = ServerHandle::start(
        ServerConfig {
            port,
            app_version: "test".into(),
            notifications: notif,
            archive: ArchiveApi { assets, ..ArchiveApi::unavailable() },
        },
        Some("12345678".to_string()),
    )
    .expect("baslamali");

    // `/ping` AUTH'SUZ secildi bilincli olarak: hiz siniri auth'tan ONCE calisiyor mu, ancak
    // auth'un hic devreye girmedigi bir uc ile kanitlanabilir.
    let mut ok = 0;
    let mut limited = 0;
    for _ in 0..60 {
        let status = get_status(port, "/ping");
        if status.contains("200") {
            ok += 1;
        } else if status.contains("429") {
            limited += 1;
        }
    }

    assert!(ok > 0, "ilk istekler gecmeliydi (tavan altinda) — gecen: {ok}");
    assert!(limited > 0, "60 hizli istek tavani asmaliydi — 429 sayisi: {limited}");
    assert!(ok < 60, "hepsi gecmemeliydi (sinir etkisiz kalmis) — gecen: {ok}");

    // Pencere dolunca yeniden acilir → sinir KALICI ceza degil (mesru istemci kilitlenmez).
    std::thread::sleep(Duration::from_millis(1200));
    let status = get_status(port, "/ping");
    assert!(status.contains("200"), "pencere sonrasi yeniden kabul edilmeli: {status}");

    handle.stop();
}
