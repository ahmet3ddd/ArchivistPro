//! Parola kurtarma araci (forgot-password) — yerel hesabin parolasini DB'den sifirlar.
//! H2 dersi: self-servis parola kapsam-disiydi → bu offline kurtarma araci onun yerine.
//!
//! Kullanim:
//!   cargo run -p archivist-db --example reset_admin -- "<db_yolu>"
//!       → kullanicilari LISTELE (id / username / role / must_change)
//!   cargo run -p archivist-db --example reset_admin -- "<db_yolu>" <username> "<yeni_parola>"
//!       → o kullanicinin parolasini AYARLA (must_change=0; kilit + basarisiz-sayac sifirlanir)
//!
//! Uygulama ACIKKEN de calisir (WAL): yazimdan sonra giris ekranindan yeni parolayla
//! girilir (login DB'yi taze sorgular → yeniden baslatma gerekmez). `users` tablosuna
//! dokunur; arsiv verisi (assets vb.) etkilenmez.

use argon2::password_hash::{rand_core::OsRng, PasswordHasher, SaltString};
use argon2::Argon2;
use rusqlite::{params, Connection};
use std::time::Duration;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("kullanim: reset_admin <db_yolu> [username] [yeni_parola]");
        std::process::exit(2);
    }
    let db_path = &args[1];
    let conn = Connection::open(db_path).expect("DB acilamadi");
    // Uygulama acikken WAL kilidi cakisirsa kisa sure bekle.
    conn.busy_timeout(Duration::from_secs(5)).unwrap();

    // Yalniz db yolu → LISTE modu.
    if args.len() == 2 {
        let mut stmt = conn
            .prepare("SELECT id, username, role, must_change_password FROM users ORDER BY id")
            .expect("users sorgusu");
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            })
            .expect("query_map");
        println!("KULLANICILAR:");
        let mut n = 0;
        for row in rows {
            let (id, username, role, must) = row.expect("row");
            println!("  [{id}] {username}  ({role})  must_change={must}");
            n += 1;
        }
        if n == 0 {
            println!("  (yok — 0 kullanici → uygulama ilk-kurulum [setup] ekranini gosterir)");
        }
        return;
    }

    // username + parola → SIFIRLA modu.
    if args.len() < 4 {
        eprintln!("sifirlama icin: reset_admin <db_yolu> <username> <yeni_parola>");
        std::process::exit(2);
    }
    let username = &args[2];
    let new_pw = &args[3];
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(new_pw.as_bytes(), &salt)
        .expect("argon2 hash")
        .to_string();
    let affected = conn
        .execute(
            "UPDATE users
             SET password_hash = ?2, must_change_password = 0, failed_attempts = 0, locked_until = 0
             WHERE username = ?1 COLLATE NOCASE",
            params![username, hash],
        )
        .expect("UPDATE basarisiz");
    if affected == 0 {
        eprintln!("UYARI: '{username}' adli kullanici bulunamadi (degisiklik yok).");
        std::process::exit(1);
    }
    println!("OK: '{username}' parolasi sifirlandi ({affected} satir). Kilit + sayaclar temizlendi.");
    println!("Giris ekranindan YENI parolayla gir (uygulamayi yeniden baslatmaya gerek yok).");
}
