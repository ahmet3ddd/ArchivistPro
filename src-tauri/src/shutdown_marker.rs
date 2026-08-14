//! Graceful-shutdown marker (H2 `shutdown_marker.rs` pariti — "calisan-kilit" varyanti).
//!
//! Amac: bir oturumun DUZGUN mu (kullanici cikisi) yoksa BEKLENMEDIK mi (force-kill / guc kaybi
//! / OOM) sonlandigini tespit etmek. `crash.rs` panik hook'u yalniz Rust PANIKLERINI yakalar;
//! surec disaridan oldurulurse ya da guc giderse hicbir sey yazilamaz → bu bosluğu marker kapatir.
//!
//! **Neden "calisan-kilit" (H2'nin tersi):** H2 temiz cikista bir dosya YAZIP acilista tuketiyordu;
//! bu, ILK CALISTIRMADA (dosya hic yok) yanlislikla "beklenmedik kapanis" der. Burada tersi:
//!   - Acilista marker VARSA → onceki oturum kendini temizleyememis = BEKLENMEDIK sonlanma.
//!   - Acilista marker YOKSA → onceki kapanis temiz (ya da ilk calistirma) = sorun yok.
//!   - Her acilista bu oturumun marker'i (yeniden) yazilir; TEMIZ cikista (`quit_app`) SILINIR.
//!
//! Boylece ilk calistirma yanlis-alarm vermez ve tespit saglamdir.
//!
//! Tespit sonucu acilista `crash.rs` log'una islenir (admin "Crash Raporlari" panelinde gorunur →
//! ekstra UI/gurultu yok; badge sayaci artar). Saf fonksiyonlar (yol/deger verilir) → test edilebilir.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Marker dosya adi (ANA db dosyasinin ust-dizininde; uygulama-yasam-dongusu global → aktif
/// arsivden bagimsiz).
const MARKER_FILE: &str = "last_session.json";

/// Bir oturum marker'i — baslangic zamani + surec kimligi (tani icin).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionMarker {
    pub started_at: i64,
    pub pid: u32,
}

/// `begin_session` sonucu: onceki kapanis temiz miydi + (varsa) onceki oturum marker'i (tani).
#[derive(Debug, Clone, PartialEq)]
pub struct LastSession {
    /// `true` = onceki oturum kendini temizleyememis (marker kalmis) = BEKLENMEDIK sonlanma.
    pub unclean: bool,
    /// Beklenmedik kapanista onceki oturumun marker'i (okunabildiyse); tani mesaji icin.
    pub prev: Option<SessionMarker>,
}

/// Marker dosya yolu — ANA db dosyasinin ust-dizininde. Ust-dizin yoksa `.` (savunma).
pub fn marker_path(db_path: &Path) -> PathBuf {
    db_path.parent().unwrap_or_else(|| Path::new(".")).join(MARKER_FILE)
}

/// Oturum baslangici: onceki marker'i TESPIT et (varsa = beklenmedik kapanis; oku), sonra bu
/// oturumun marker'ini yaz. Yazma best-effort (dusse de yalniz bir sonraki tespit calismaz;
/// kritik degil). Doner: `LastSession`.
pub fn begin_session(path: &Path, started_at: i64, pid: u32) -> LastSession {
    let unclean = path.exists();
    // Beklenmedik kapanista onceki marker'i (tani icin) oku — bozuk/parse-edilemezse None
    // (ama unclean yine true: dosyanin VARLIGI temizlenmedigini gosterir).
    let prev = if unclean {
        std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<SessionMarker>(&b).ok())
    } else {
        None
    };
    // Bu oturumun marker'ini yaz (onceki uzerine).
    if let Ok(json) = serde_json::to_string(&SessionMarker { started_at, pid }) {
        let _ = std::fs::write(path, json);
    }
    LastSession { unclean, prev }
}

/// Temiz kapanis: marker'i sil → bir sonraki acilis "temiz" gorsun. Best-effort (`quit_app`).
pub fn clear_marker(path: &Path) {
    let _ = std::fs::remove_file(path);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_marker() -> PathBuf {
        // Test-yerel benzersiz yol (paralel testler carpismasin) — pid + fonksiyon adi degil,
        // cagiran verir. Burada tek dosya yeter; her test ONCE temizler.
        std::env::temp_dir().join(format!("arsiv_test_{}_last_session.json", std::process::id()))
    }

    #[test]
    fn first_run_is_clean_then_lock_persists() {
        let p = tmp_marker();
        let _ = std::fs::remove_file(&p); // temiz baslangic

        // Ilk calistirma: marker yok → temiz (yanlis-alarm YOK); marker yazilir.
        let first = begin_session(&p, 100, 111);
        assert!(!first.unclean, "ilk calistirma temiz sayilmali");
        assert!(p.exists(), "oturum marker'i yazilmali");

        // Temizlenmeden ikinci acilis (=beklenmedik kapanis) → unclean, onceki marker okunur.
        let second = begin_session(&p, 200, 222);
        assert!(second.unclean, "temizlenmemis marker beklenmedik kapanis demektir");
        assert_eq!(second.prev, Some(SessionMarker { started_at: 100, pid: 111 }));

        // Temiz kapanis → marker silinir; sonraki acilis temiz.
        clear_marker(&p);
        assert!(!p.exists());
        let third = begin_session(&p, 300, 333);
        assert!(!third.unclean, "temiz kapanis sonrasi acilis temiz olmali");

        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn corrupt_marker_still_flags_unclean() {
        let p = std::env::temp_dir()
            .join(format!("arsiv_test_{}_corrupt_session.json", std::process::id()));
        std::fs::write(&p, b"{not valid json").unwrap();
        let r = begin_session(&p, 400, 444);
        assert!(r.unclean, "bozuk marker DA beklenmedik kapanis (dosya varligı yeter)");
        assert_eq!(r.prev, None, "parse edilemeyen marker → prev None");
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn marker_path_is_sibling_of_db() {
        assert_eq!(
            marker_path(Path::new(r"C:\data\archivist.db")),
            Path::new(r"C:\data\last_session.json")
        );
    }
}
