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

/// UNC/ag yolu mu? WAL ag paylasiminda guvenilmez → orada DELETE journal kullanilir;
/// yerel diskte WAL.
///
/// İki yol da yakalanir:
/// 1. **Duz UNC** — `\\sunucu\paylasim\...` (metin on-eki).
/// 2. **Eslenmis surucu** — `net use Z: \\sunucu\paylasim` sonrasi `Z:\...`. Bu, metin
///    olarak yerel goründügü icin 2026-08-17 denetimine kadar YEREL sayiliyor ve ag
///    paylasiminda WAL aciliyordu (tam da kacinilmak istenen durum). Windows'ta
///    `GetDriveTypeW` ile cozulur; Windows disinda 1. madde yeterlidir.
fn is_network_path(path: &Path) -> bool {
    let s = path.to_string_lossy();
    if s.starts_with(r"\\") || s.starts_with("//") {
        return true;
    }
    is_mapped_network_drive(&s)
}

/// `Z:\...` gibi bir surucu harfi ag paylasimina mi eslenmis? (Windows disinda daima `false`.)
#[cfg(windows)]
fn is_mapped_network_drive(path: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;

    /// `DRIVE_REMOTE` (winbase.h). windows 0.61 bu sabiti disa acmadigindan degeri
    /// dogrudan yaziliyor; Win32 ABI sabiti oldugu icin degismez.
    const DRIVE_REMOTE: u32 = 4;

    // "Z:\..." → kok "Z:\". Surucu harfi yoksa (goreli yol vb.) karar veremeyiz.
    let mut chars = path.chars();
    let (Some(letter), Some(colon)) = (chars.next(), chars.next()) else {
        return false;
    };
    if colon != ':' || !letter.is_ascii_alphabetic() {
        return false;
    }
    let root: Vec<u16> = format!("{letter}:\\").encode_utf16().chain(std::iter::once(0)).collect();
    // SAFETY: `root` NUL-sonlu, gecerli UTF-16 ve cagri suresince yasiyor.
    let kind = unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) };
    kind == DRIVE_REMOTE
}

#[cfg(not(windows))]
fn is_mapped_network_drive(_path: &str) -> bool {
    false
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

#[cfg(test)]
mod tests {
    use super::is_network_path;
    use std::path::Path;

    #[test]
    fn unc_prefixes_are_network() {
        assert!(is_network_path(Path::new(r"\\sunucu\arsiv\archivist.db")));
        assert!(is_network_path(Path::new("//sunucu/arsiv/archivist.db")));
    }

    #[test]
    fn plain_local_paths_are_not_network() {
        // Goreli yol ve surucu-harfsiz yollar karar disi → yerel (WAL) kalir.
        assert!(!is_network_path(Path::new("archivist.db")));
        assert!(!is_network_path(Path::new(r"veri\archivist.db")));
    }

    #[cfg(windows)]
    #[test]
    fn system_drive_is_not_network() {
        // Windows'ta sistem surucusu daima DRIVE_FIXED → yerel. Bu test eslenmis-surucu
        // tespitinin yanlis-pozitif vermedigini kilitler (dogru-pozitif yalniz gercek bir
        // `net use` eslemesiyle olculebilir; CI'da varsayilamaz).
        let sys = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
        assert!(!is_network_path(Path::new(&format!("{sys}\\archivist.db"))));
    }
}
