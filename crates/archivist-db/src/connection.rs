//! Baglanti acma + pragma politikasi + sqlite-vec uzanti kaydi.
//!
//! Cekirdek ilke (ARCHITECTURE.md §1): **tek motor sahipligi** — DB'yi yalniz
//! Rust acar/yazar. Renderer asla dogrudan DB acmaz; yalniz tipli sorgu API'siyle okur.

use crate::error::DbError;
use rusqlite::Connection;
use std::path::Path;
use std::sync::Once;
use std::time::Duration;

static VEC_INIT: Once = Once::new();

/// sqlite-vec uzantisini process-genelinde **bir kez** auto-extension olarak kaydeder.
/// Bundan sonra acilan her baglanti `vec0` sanal tablolarini gorur.
fn register_sqlite_vec() {
    // sqlite-vec'in init imzasi kendi bindgen tipleriyle yazili; ABI-ozdes ama
    // nominal farkli oldugundan rusqlite'in bekledigi auto-extension imzasina
    // transmute edilir (sqlite-vec'in belgeledigi kayit deseni).
    type AutoExtFn = unsafe extern "C" fn(
        *mut rusqlite::ffi::sqlite3,
        *mut *mut std::os::raw::c_char,
        *const rusqlite::ffi::sqlite3_api_routines,
    ) -> std::os::raw::c_int;

    VEC_INIT.call_once(|| {
        // SAFETY: standart C-ABI uzanti giris noktasi; auto_extension her yeni
        // baglantida cagirir → vec0 sanal tablolari kullanilabilir olur.
        unsafe {
            let init = std::mem::transmute::<*const (), AutoExtFn>(
                sqlite_vec::sqlite3_vec_init as *const (),
            );
            rusqlite::ffi::sqlite3_auto_extension(Some(init));
        }
    });
}

/// UNC/ag yolu mu? (`\\sunucu\paylasim\...`). WAL ag paylasiminda guvenilmez →
/// orada DELETE journal kullanilir; yerel diskte WAL.
fn is_network_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    s.starts_with(r"\\") || s.starts_with("//")
}

/// Dosya tabanli DB acar (yoksa olusturur) ve pragma politikasini uygular.
pub fn open(path: &Path) -> Result<Connection, DbError> {
    register_sqlite_vec();
    let conn = Connection::open(path)?;
    apply_pragmas(&conn, is_network_path(path))?;
    crate::search::register_functions(&conn)?; // fuzzy_match UDF (bulanik arama)
    Ok(conn)
}

/// Bellek-ici DB acar (testler icin). WAL/DELETE ayrimi gecersiz.
pub fn open_in_memory() -> Result<Connection, DbError> {
    register_sqlite_vec();
    let conn = Connection::open_in_memory()?;
    apply_pragmas(&conn, false)?;
    crate::search::register_functions(&conn)?; // fuzzy_match UDF (bulanik arama)
    Ok(conn)
}

fn apply_pragmas(conn: &Connection, network: bool) -> Result<(), DbError> {
    // Referans butunlugu (asset_tags/relations ON DELETE CASCADE icin sart).
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // journal_mode deger dondurur → execute_batch ile (pragma_update deger-donduren
    // pragma'lar icin uygun degil).
    let journal = if network { "DELETE" } else { "WAL" };
    conn.execute_batch(&format!(
        "PRAGMA journal_mode = {journal}; PRAGMA synchronous = NORMAL;"
    ))?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(())
}
