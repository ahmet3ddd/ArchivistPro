//! Acilis kurtarma (recovery-mode) — bozuk DB oto-tespit → snapshot'tan onarim (P2.6).
//!
//! **H2 pariti + iyilestirme.** H2 (sql.js): acilista magic-byte kontrolu → bozuksa dosyayi
//! `.corrupt.bak`'a tasi (SILMEZ) → temiz bos DB → modal bildirim; geri yukleme MANUEL. H3
//! (native SQLite) DAHA SAGLAM tespit (`PRAGMA integrity_check` hem non-SQLite hem sayfa-bozulmasi
//! yakalar) + backlog "snapshot'tan onarim": bozuksa **en yeni snapshot'tan OTO geri yukle**;
//! snapshot yoksa/restore basarisizsa temiz bos DB (H2 fallback). HER iki halde bozuk dosya
//! KARANTINAYA alinir (`<db>.corrupt-<ts>` — H2 gibi korunur, ASLA silinmez) ve sonuc
//! [`RecoveryInfo`]'da tutulur → `recovery_status` komutu → frontend toast'la bildirir.
//!
//! Akis `AppState`'ten ONCE (acilista) calisir; yalniz mevcut public API (`Db::open_and_migrate`
//! ve `integrity_ok`) ile dosya islemleri kullanir. Windows notu: `try_healthy` None donerken
//! `Db`'yi DROP eder (baglanti kapanir) → bozuk dosya rename edilebilir (acik handle kalmaz).

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use archivist_db::Db;
use serde::Serialize;
use tauri::State;

use crate::AppState;

/// Acilis kurtarma sonucu — `recovery_status` ile renderer'a doner (toast bildirimi).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryInfo {
    /// `"healthy"` (sorun yok) | `"restored"` (snapshot'tan geri yuklendi) | `"fresh"` (temiz bos).
    pub outcome: &'static str,
    /// `restored` ise: geri yuklemede kullanilan snapshot dosya adi.
    pub snapshot: Option<String>,
    /// Bozuk DB karantinaya alindiysa: yeni (korunan) dosya adi. `healthy` ise None.
    pub quarantined: Option<String>,
}

impl RecoveryInfo {
    /// Sorunsuz acilis (kurtarma gerekmedi). Test kuruculari da kullanir.
    pub(crate) fn healthy() -> Self {
        Self { outcome: "healthy", snapshot: None, quarantined: None }
    }
}

/// Su anki zaman (unix ms) — benzersiz karantina dosya adi icin.
fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// `snapshots/` klasoru — db dosyasinin ust-dizininde (backup_commands ile ayni yerlesim).
fn snapshots_dir_of(db_path: &Path) -> PathBuf {
    db_path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from(".")).join("snapshots")
}

/// `db_path`'in bir yan-dosyasi (sidecar) — dosya adina `suffix` eklenir (WAL/SHM/journal).
/// Or. `archivist.db` + `-wal` → `archivist.db-wal`.
fn sidecar(db_path: &Path, suffix: &str) -> PathBuf {
    let mut s: OsString = db_path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

/// Bir yola `.tag` ekle (uzanti olarak). Or. `archivist.db` + `corrupt-123` → `archivist.db.corrupt-123`.
fn with_tag(path: &Path, tag: &str) -> PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(".");
    s.push(tag);
    PathBuf::from(s)
}

/// DB'yi sağlıkli ac (open+migrate + integrity_check). Bozuk → None (ve `Db` DROP edilir →
/// baglanti kapanir → dosya tasinabilir). Sadece public API kullanir.
fn try_healthy(db_path: &Path) -> Option<Db> {
    let db = Db::open_and_migrate(db_path).ok()?;
    match db.integrity_ok() {
        Ok(true) => Some(db),
        _ => None, // db burada drop → baglanti kapanir
    }
}

/// Bozuk DB'yi (+ WAL/SHM/journal sidecar'lari) `<dosya>.corrupt-<ts>`'e tasi (korunur, SILINMEZ).
/// Doner: ana dosyanin yeni (karantina) adi (varsa). Tasima hatasi yutulur (best-effort).
fn quarantine(db_path: &Path) -> Option<String> {
    let ts = now_ms();
    let tag = format!("corrupt-{ts}");
    let mut moved_main: Option<String> = None;
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let src = sidecar(db_path, suffix);
        if !src.exists() {
            continue;
        }
        let dst = with_tag(&src, &tag);
        if fs::rename(&src, &dst).is_ok() && suffix.is_empty() {
            moved_main = dst.file_name().and_then(|n| n.to_str()).map(String::from);
        }
    }
    moved_main
}

/// Bir klasordeki EN YENI `.db` snapshot'i (mtime'a gore). Klasor yok/bos → None.
fn latest_snapshot(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().and_then(|x| x.to_str()) != Some("db") {
            continue;
        }
        let Ok(mtime) = entry.metadata().and_then(|m| m.modified()) else {
            continue;
        };
        if best.as_ref().is_none_or(|(t, _)| mtime > *t) {
            best = Some((mtime, path));
        }
    }
    best.map(|(_, p)| p)
}

/// **Acilis kurtarma giris noktasi.** DB'yi ac; bozuksa karantina + (en yeni) snapshot'tan onar;
/// olmazsa temiz bos DB. Depolama/izin sorunu nedeniyle taze DB de acilamazsa paniklemek yerine
/// hatayi setup katmanina tasir; uygulama kontrollu bir baslangic hatasiyla kapanir.
pub fn open_with_recovery(db_path: &Path) -> Result<(Db, RecoveryInfo), archivist_db::DbError> {
    // Mutlu yol: saglikli → oldugu gibi kullan.
    if let Some(db) = try_healthy(db_path) {
        return Ok((db, RecoveryInfo::healthy()));
    }

    // Bozuk: bozuk dosyayi KARANTINAYA al (try_healthy baglanti kapatti → rename guvenli).
    let quarantined = quarantine(db_path);

    // En yeni snapshot'tan OTO geri yukle (varsa). Dosya-duzeyi kopya → taze ac → dogrula.
    if let Some(snap) = latest_snapshot(&snapshots_dir_of(db_path)) {
        if fs::copy(&snap, db_path).is_ok() {
            if let Some(db) = try_healthy(db_path) {
                let snapshot = snap.file_name().and_then(|n| n.to_str()).map(String::from);
                return Ok((db, RecoveryInfo { outcome: "restored", snapshot, quarantined }));
            }
            // Geri yuklenen kopya da bozuk → onu da karantinaya al, taze'ye dus.
            let _ = quarantine(db_path);
        }
    }

    // Snapshot yok / restore basarisiz → temiz bos DB (bozuk dosya korundu).
    let db = Db::open_and_migrate(db_path)?;
    Ok((db, RecoveryInfo { outcome: "fresh", snapshot: None, quarantined }))
}

/// Acilis kurtarma durumu (renderer toast'la bildirir). Salt-okuma, rol gate YOK (bilgilendirme;
/// gercek geri-yukleme eylemi admin-gated yedek panelinde).
#[tauri::command]
pub fn recovery_status(state: State<'_, AppState>) -> RecoveryInfo {
    state.startup_recovery.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use archivist_db::Db;

    /// Gecerli bir DB'yi `path`'e olustur (migrate'li, bos).
    fn make_valid_db(path: &Path) {
        let _db = Db::open_and_migrate(path).unwrap();
        // _db drop → baglanti kapanir (Windows: sonraki dosya islemleri serbest).
    }

    #[test]
    fn healthy_db_opens_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("archivist.db");
        make_valid_db(&db_path);

        let (_db, info) = open_with_recovery(&db_path).unwrap();
        assert_eq!(info.outcome, "healthy");
        assert!(info.quarantined.is_none());
        assert!(info.snapshot.is_none());
    }

    #[test]
    fn corrupt_db_restored_from_latest_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("archivist.db");
        let snaps = dir.path().join("snapshots");
        fs::create_dir_all(&snaps).unwrap();

        // Gecerli bir snapshot olustur (snapshots/ icine).
        let snap_path = snaps.join("auto-sched-1.db");
        make_valid_db(&snap_path);

        // Bozuk ana DB: SQLite olmayan cop bytes.
        fs::write(&db_path, b"this is definitely not a sqlite database file").unwrap();

        let (db, info) = open_with_recovery(&db_path).unwrap();
        assert_eq!(info.outcome, "restored", "en yeni snapshot'tan geri yuklenmeli");
        assert_eq!(info.snapshot.as_deref(), Some("auto-sched-1.db"));
        assert!(info.quarantined.is_some(), "bozuk dosya karantinaya alinmali");
        assert!(db.integrity_ok().unwrap(), "geri yuklenen DB saglikli olmali");
        // Karantina dosyasi GERCEKTEN var (korundu, silinmedi).
        let q = dir.path().join(info.quarantined.unwrap());
        assert!(q.is_file(), "karantina dosyasi diskte korunmali");
    }

    #[test]
    fn corrupt_db_no_snapshot_starts_fresh() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("archivist.db");
        // snapshots/ yok → onarim imkani yok.
        fs::write(&db_path, b"garbage not-a-db").unwrap();

        let (db, info) = open_with_recovery(&db_path).unwrap();
        assert_eq!(info.outcome, "fresh", "snapshot yoksa temiz bos DB");
        assert!(info.quarantined.is_some(), "bozuk dosya yine de karantinaya alinmali");
        assert!(db.integrity_ok().unwrap(), "taze DB saglikli");
        assert_eq!(db.asset_count().unwrap(), 0, "taze DB bos olmali");
        // Bozuk dosya korundu.
        assert!(dir.path().join(info.quarantined.unwrap()).is_file());
    }
}
