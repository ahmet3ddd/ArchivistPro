//! Uctan-uca HTTP testi — sunucuyu gercekten baslat, ham soketle `/ping` + `/notifications` +
//! auth akisini dogrula (GUI/Tauri gerekmez). tiny_http `Connection: close` ile yanit sonrasi
//! soketi kapatir → EOF'a kadar okuma tam yaniti verir.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use archivist_server::{
    ArchiveApi, AssetQueryFn, Notification, NotificationFn, QueryError, ServerConfig, ServerHandle,
};

/// Basit HTTP/1.1 istek → (durum satiri, tam yanit). `auth` verilirse `X-Auth-Code` eklenir.
fn http_req(port: u16, method: &str, path: &str, auth: Option<&str>) -> (String, String) {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).expect("connect");
    stream.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    let mut req =
        format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n");
    if let Some(a) = auth {
        req.push_str(&format!("X-Auth-Code: {a}\r\n"));
    }
    req.push_str("\r\n");
    stream.write_all(req.as_bytes()).unwrap();
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf); // EOF (Connection: close) → tam yanit
    let status = buf.lines().next().unwrap_or("").to_string();
    (status, buf)
}

fn http_get(port: u16, path: &str, auth: Option<&str>) -> (String, String) {
    http_req(port, "GET", path, auth)
}

#[test]
fn ping_ve_notifications_auth_akisi() {
    // Sabit bir bildirim donen kaynak (DB'siz — sunucu izole test edilir).
    let notif: NotificationFn = Arc::new(|since, _limit| {
        if since < 7 {
            Ok(vec![Notification {
                id: 7,
                created_at: 1_700_000_000_000,
                kind: "index".into(),
                title: "42 yeni cizim".into(),
                body: Some("H:/proje".into()),
            }])
        } else {
            Ok(vec![]) // since >= 7 -> yeni yok
        }
    });
    let assets: AssetQueryFn = Arc::new(|_opts| Ok(r#"{"total":0,"items":[]}"#.to_string()));
    let port = 19477;
    let handle = ServerHandle::start(
        ServerConfig {
            port,
            app_version: "9.9.9".into(),
            notifications: notif,
            archive: ArchiveApi { assets, ..ArchiveApi::unavailable() },
        },
        Some("12345678".to_string()),
    )
    .expect("baslamali");

    // /ping — AUTH'SUZ, 200 + surum.
    let (status, body) = http_get(port, "/ping", None);
    assert!(status.contains("200"), "ping 200 olmali: {status}");
    assert!(body.contains("\"appVersion\":\"9.9.9\""), "surum yansimali: {body}");

    // /notifications AUTH'SUZ -> 401.
    let (status, _) = http_get(port, "/notifications?since=0", None);
    assert!(status.contains("401"), "auth'suz notifications 401 olmali: {status}");

    // /notifications YANLIS kod -> 401.
    let (status, _) = http_get(port, "/notifications?since=0", Some("00000000"));
    assert!(status.contains("401"), "yanlis kod 401 olmali: {status}");

    // /notifications DOGRU kod -> 200 + bildirim JSON'u (basarili auth rate-limit sayacini temizler).
    let (status, body) = http_get(port, "/notifications?since=0", Some("12345678"));
    assert!(status.contains("200"), "dogru kod 200 olmali: {status}");
    assert!(body.contains("\"id\":7"), "bildirim id: {body}");
    assert!(body.contains("42 yeni cizim"), "bildirim basligi: {body}");

    // since=7 -> bos dizi (imlecten yeni yok).
    let (status, body) = http_get(port, "/notifications?since=7", Some("12345678"));
    assert!(status.contains("200"));
    assert!(body.trim_end().ends_with("[]"), "since=7 bos dizi: {body}");

    // Bilinmeyen endpoint (auth'lu) -> 404.
    let (status, _) = http_get(port, "/nope", Some("12345678"));
    assert!(status.contains("404"), "bilinmeyen endpoint 404: {status}");

    handle.stop();
}

#[test]
fn assets_sorgu_auth_metot_ve_hata_ayrimi() {
    // Sorgu kaynagi: gelen `opts` JSON'unu AYNEN geri yansitan sahte host (DB'siz izole test).
    // Boylece "sunucu istemcinin opts'unu bozulmadan iletti mi" HTTP seviyesinde olculur.
    let assets: AssetQueryFn = Arc::new(|opts: &str| {
        if opts.contains("\"patla\"") {
            return Err(QueryError::Internal("DB acilamadi (sahte)".into()));
        }
        if opts.contains("\"gecersiz\"") {
            return Err(QueryError::BadRequest("bilinmeyen alan (sahte)".into()));
        }
        Ok(format!(r#"{{"total":1,"items":[],"echo":{opts}}}"#))
    });
    let notif: NotificationFn = Arc::new(|_since, _limit| Ok(vec![]));
    let port = 19478;
    let handle = ServerHandle::start(
        ServerConfig {
            port,
            app_version: "9.9.9".into(),
            notifications: notif,
            archive: ArchiveApi { assets, ..ArchiveApi::unavailable() },
        },
        Some("12345678".to_string()),
    )
    .expect("baslamali");

    // AUTH'SUZ -> 401 (arsiv icerigi kodsuz sizmaz).
    let (status, _) = http_get(port, "/assets", None);
    assert!(status.contains("401"), "auth'suz /assets 401 olmali: {status}");

    // Parametresiz + dogru kod -> 200, opts varsayilani `{}` (ListOpts::default → ilk sayfa).
    let (status, body) = http_get(port, "/assets", Some("12345678"));
    assert!(status.contains("200"), "dogru kod 200: {status}");
    assert!(body.contains(r#""echo":{}"#), "opts yoksa varsayilan {{}}: {body}");

    // Percent-encoded JSON uctan uca BOZULMADAN gecer (Turkce + i̇c ice tirnak dahil).
    // encodeURIComponent('{"page":2,"query":"Fotoğraf"}')
    let url = "/assets?opts=%7B%22page%22%3A2%2C%22query%22%3A%22Foto%C4%9Fraf%22%7D";
    let (status, body) = http_get(port, url, Some("12345678"));
    assert!(status.contains("200"), "kodlu opts 200: {status}");
    assert!(body.contains(r#""page":2"#), "sayfa iletilmeli: {body}");
    assert!(body.contains("Fotoğraf"), "UTF-8 sorgu bozulmamali: {body}");

    // Bozuk percent-kacisi -> 400 (sunucu kirli metni sorgu katmanina HIC vermez).
    let (status, body) = http_get(port, "/assets?opts=%ZZ", Some("12345678"));
    assert!(status.contains("400"), "bozuk kacis 400: {status}");
    assert!(body.contains("opts_decode"), "stabil hata kodu: {body}");

    // Asiri uzun opts -> 400 + ayri kod (ayristirmadan once kesilir).
    let long = "a".repeat(9000);
    let (status, body) = http_get(port, &format!("/assets?opts={long}"), Some("12345678"));
    assert!(status.contains("400"), "uzun opts 400: {status}");
    assert!(body.contains("opts_too_long"), "uzunluk hatasi ayri kod: {body}");

    // 🔑 Istemci hatasi (400) ile host hatasi (500) AYRILIR — H2'nin "hepsi tek jenerik mesaj"
    // davranisi tekrarlanmaz. Ikisi de ayni ucta, yalniz sorgu kaynaginin dondugu tur farkli.
    let (status, _) = http_get(port, "/assets?opts=%7B%22gecersiz%22%3A1%7D", Some("12345678"));
    assert!(status.contains("400"), "sorgu kaynagi BadRequest -> 400: {status}");
    let (status, _) = http_get(port, "/assets?opts=%7B%22patla%22%3A1%7D", Some("12345678"));
    assert!(status.contains("500"), "sorgu kaynagi Internal -> 500: {status}");

    // Metot kapisi: yalniz GET. POST/DELETE -> 405 + Allow basligi (H2'de metot HIC kontrol
    // edilmiyordu). Auth'lu istekte de gecerli → yazma yolu kodu bilene bile acilmaz.
    for method in ["POST", "DELETE", "PUT"] {
        let (status, body) = http_req(port, method, "/assets", Some("12345678"));
        assert!(status.contains("405"), "{method} -> 405 olmali: {status}");
        assert!(body.contains("Allow: GET, OPTIONS"), "{method} Allow basligi: {body}");
    }

    handle.stop();
}
