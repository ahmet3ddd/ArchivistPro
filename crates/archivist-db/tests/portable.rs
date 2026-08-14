//! Dilim 1 — cok-arsiv tasima (portable) DB cekirdegi testleri: YOL-REMAP
//! (yalniz eslesen on-ek + cop dahil) · scan_roots (kok bazli gruplama, deterministik) ·
//! count_active_assets (cop haric). Saf yardimcilar (path_root/common_prefix) portable.rs
//! ic unit testlerinde; burada yalniz DB'ye dokunanlar.

use archivist_db::{Db, RootStat};
use rusqlite::{params, Connection};

/// Test yardimcisi: minimal bir asset ekle (path UNIQUE; digerleri sabit yer-tutucu).
/// `deleted` = `deleted_at` (None → aktif, Some(ts) → cop'te). meta.rs test deseni.
fn ins(conn: &Connection, path: &str, deleted: Option<i64>) {
    conn.execute(
        "INSERT INTO assets(path, file_name, size_bytes, created_at, modified_at, deleted_at)
         VALUES (?1, 'f', 1, 1, 1, ?2)",
        params![path, deleted],
    )
    .unwrap();
}

/// Tum yollari `id` (ekleme) sirasinda dondur — remap sonrasi dogrulama icin.
fn all_paths(conn: &Connection) -> Vec<String> {
    // stmt fn-boyu yasar → tail-ifade borrow guvenli (let-and-return'den kacinilir).
    let mut stmt = conn.prepare("SELECT path FROM assets ORDER BY id").unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap()
}

#[test]
fn remap_updates_matching_prefix_only() {
    let db = Db::open_in_memory_migrated().unwrap();
    {
        let conn = db.connection();
        ins(conn, r"C:\Eski\a\1.dwg", None); // eslesir (aktif)
        ins(conn, r"C:\Eski\b\2.dwg", None); // eslesir (aktif)
        ins(conn, r"D:\Baska\3.dwg", None); // ESLESMEZ (farkli kok)
        ins(conn, r"C:\Eski\z\9.dwg", Some(99)); // eslesir (COP'te → yine de tasinir)
    }

    // 2 aktif + 1 cop = 3 satir etkilenir.
    let n = db.remap_paths(r"C:\Eski", r"E:\Yeni").unwrap();
    assert_eq!(n, 3, "yalniz C:\\Eski on-ekli 3 satir (cop dahil) tasinmali");

    let paths = all_paths(db.connection());
    assert_eq!(
        paths,
        vec![
            r"E:\Yeni\a\1.dwg".to_string(), // suffix korundu
            r"E:\Yeni\b\2.dwg".to_string(),
            r"D:\Baska\3.dwg".to_string(), // degismedi
            r"E:\Yeni\z\9.dwg".to_string(), // cop'teki de tasindi
        ]
    );
}

#[test]
fn scan_roots_groups_by_first_segment() {
    let db = Db::open_in_memory_migrated().unwrap();
    {
        let conn = db.connection();
        ins(conn, r"C:\Projeler\Arsiv\a.dwg", None); // kok C:\Projeler
        ins(conn, r"C:\Projeler\Foo\b.dwg", None); //   kok C:\Projeler
        ins(conn, r"D:\Yedek\x\c.pdf", None); //        kok D:\Yedek
        ins(conn, r"C:\Baska\y\d.dwg", None); //        kok C:\Baska
        ins(conn, r"E:\Cop\z\e.dwg", Some(1)); //       COP → sayilmaz
    }

    let roots = db.scan_roots().unwrap();
    // path ASC (deterministik): C:\Baska < C:\Projeler < D:\Yedek. Cop'teki E:\ yok.
    assert_eq!(
        roots,
        vec![
            RootStat { path: r"C:\Baska".to_string(), count: 1 },
            RootStat { path: r"C:\Projeler".to_string(), count: 2 },
            RootStat { path: r"D:\Yedek".to_string(), count: 1 },
        ]
    );
}

#[test]
fn count_active_assets_excludes_deleted() {
    let db = Db::open_in_memory_migrated().unwrap();
    {
        let conn = db.connection();
        // 3 aktif.
        ins(conn, r"C:\a\1.dwg", None);
        ins(conn, r"C:\a\2.dwg", None);
        ins(conn, r"C:\a\3.dwg", None);
        // 2 cop.
        ins(conn, r"C:\a\4.dwg", Some(10));
        ins(conn, r"C:\a\5.dwg", Some(20));
    }
    assert_eq!(db.count_active_assets().unwrap(), 3, "cop (deleted_at) sayilmamali");

    // Bos arsiv → 0.
    let empty = Db::open_in_memory_migrated().unwrap();
    assert_eq!(empty.count_active_assets().unwrap(), 0);
}
