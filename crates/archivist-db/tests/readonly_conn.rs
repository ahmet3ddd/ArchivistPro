//! `Db::open_readonly` sozlesmesi: ayni dosyayi OKUR ama `query_only` ile YAZIMI reddeder.
//! Donma-fix'inin temeli — okuma komutlari bu ayri baglantidan (WAL eszamanli okuyucu) kosar.

use archivist_db::Db;

/// Yazma-baglantisi bir deger yazar → salt-okuma baglantisi onu GORUR; ama salt-okuma
/// baglantisina yazma denemesi HATA verir (koruma: yanlislikla ikinci-yazici olusmaz).
#[test]
fn open_readonly_reads_but_rejects_writes() {
    let path = std::env::temp_dir().join(format!("arsiv_ro_{}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);

    // Yazma-baglantisi: migrate + bir meta yaz, sonra kapat (WAL → checkpoint).
    {
        let w = Db::open_and_migrate(&path).unwrap();
        w.set_meta("ro_test_key", "deger-42").unwrap();
    }

    // Salt-okuma baglantisi: yazilan degeri okuyabilmeli.
    let ro = Db::open_readonly(&path).unwrap();
    assert_eq!(ro.get_meta("ro_test_key").unwrap().as_deref(), Some("deger-42"));

    // Yazma denemesi query_only ile reddedilmeli (aksi halde iki-yazici BUSY riski dogardi).
    assert!(
        ro.set_meta("baska", "x").is_err(),
        "salt-okuma baglantisi yazimi reddetmeli (query_only)"
    );

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));
}

/// Donma-fix'inin OZU: bir YAZICI baglanti surekli yazarken, AYRI salt-okuma baglanti ES
/// ZAMANLI okuyabilmeli — yerel WAL'de okuyucu yazicidan BLOKE OLMAZ (BUSY almaz). Bu, uretimde
/// "ingest yazma-baglantisini kilitlerken gezinme/arama donmaz" davranisinin DB-katmani kaniti.
#[test]
fn readonly_reads_concurrently_while_writer_active() {
    use std::thread;

    let path = std::env::temp_dir().join(format!("arsiv_ro_conc_{}.db", std::process::id()));
    let _ = std::fs::remove_file(&path);
    // WAL kur + baslangic verisi (seed daima gorunur olmali).
    {
        let w = Db::open_and_migrate(&path).unwrap();
        w.set_meta("seed", "1").unwrap();
    }

    // Yazici thread: AYRI baglanti ile 300 yazim (asset-basi auto-commit deseni).
    let wpath = path.clone();
    let writer = thread::spawn(move || {
        let w = Db::open_and_migrate(&wpath).unwrap();
        for i in 0..300 {
            w.set_meta(&format!("k{i}"), "v").unwrap();
        }
    });

    // Yazici kosarken salt-okuma baglanti ile 500 okuma — HER biri bloke/BUSY olmadan donmeli.
    let ro = Db::open_readonly(&path).unwrap();
    for _ in 0..500 {
        assert_eq!(
            ro.get_meta("seed").unwrap().as_deref(),
            Some("1"),
            "yazici aktifken salt-okuma bloke/BUSY olmamali"
        );
    }
    writer.join().unwrap();
    // Yazici bitti → son commit salt-okuma baglantida gorunur (WAL commit-gorunurlugu).
    assert_eq!(ro.get_meta("k299").unwrap().as_deref(), Some("v"));

    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));
}
