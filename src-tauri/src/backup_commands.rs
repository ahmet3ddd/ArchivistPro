//! Yedekleme komutlari (H2 pariti §O "DB snapshot + restore") — yonetilen yedek paneli.
//!
//! Yedekler **arsivin yaninda** bir `snapshots/` klasorunde tutulur (db dosyasinin ust-dizini).
//! Tum komutlar **ADMIN** (yikici/hassas yonetim — `current_role` → `require_admin`). Yedek alma
//! online backup API (archivist-db `backup_to`); geri yukleme `restore_from` (UZERINE YAZAR →
//! UI onay ister). Dosya adi disaridan gelince **yol-gezinme (traversal) reddedilir** (yalniz
//! managed klasor icinde duz dosya adi).

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;

use crate::{rbac, AppState};

/// Bir yedek (snapshot) IPC kaydi. `created_at`: unix ms (dosya mtime; frontend formatlar).
/// `auto`: reset-oncesi OTOMATIK yedek mi (ad on-eki `auto-`) — panelde rozetlenir.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDto {
    pub name: String,
    pub created_at: u64,
    pub size_bytes: u64,
    pub auto: bool,
}

/// `snapshots/` klasoru — AKTIF arsivin DB dosyasinin ust-dizininde (o arsivin yaninda). Yoksa
/// olusturulur. Cok-arsivde her arsiv kendi klasorunde yasadigindan (`archives/<id>/`) yedekler de
/// arsiv-basina ayrisir; ana arsivde davranis aynidir (db ust-dizini). `active_db_path` kilit
/// zehirlenmesinde ana yola duser (savunma).
pub(crate) fn snapshots_dir(state: &AppState) -> Result<PathBuf, String> {
    let active = state.active_db_path();
    let parent = active.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let dir = parent.join("snapshots");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Su anki zaman (unix ms) — benzersiz yedek dosya adi icin.
pub(crate) fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn require_admin(state: &AppState) -> Result<(), String> {
    let role = rbac::current_role(state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())
}

/// Disaridan gelen yedek adini managed klasor icinde **guvenli** bir yola cevir: ayrac/`..`
/// iceren ad reddedilir (path-traversal onleme); `.db` uzantisi zorunlu.
fn safe_snapshot_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty()
        || name.contains('/')
        || name.contains('\\')
        || name.contains("..")
        || !name.ends_with(".db")
    {
        return Err("gecersiz yedek adi".to_string());
    }
    Ok(dir.join(name))
}

/// Retention: OTOMATIK (`auto-` on-ekli) yedeklerden en yeni `keep` tanesini KORU; gerisini
/// silinecekler olarak dondur. Manuel (`archivist-`) / ice-aktarilan (`imported-`) yedekler
/// ASLA budanmaz. `snaps`: (ad, created_at). Saf fonksiyon (test edilebilir).
fn auto_snapshots_to_prune(snaps: &[(String, u64)], keep: usize) -> Vec<String> {
    let mut autos: Vec<&(String, u64)> =
        snaps.iter().filter(|(n, _)| n.starts_with("auto-")).collect();
    autos.sort_by_key(|(_, ts)| std::cmp::Reverse(*ts)); // en yeni once
    autos.into_iter().skip(keep).map(|(n, _)| n.clone()).collect()
}

/// Bir dosyayi `SnapshotDto`'ya cevir (yoksa/erisilemezse None).
fn to_dto(path: &Path) -> Option<SnapshotDto> {
    let name = path.file_name()?.to_str()?.to_string();
    let meta = fs::metadata(path).ok()?;
    let created_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    Some(SnapshotDto { auto: name.starts_with("auto-"), name, created_at, size_bytes: meta.len() })
}

/// Yedekleri listele (en yeni ilk). **Admin.**
#[tauri::command]
pub fn list_snapshots(state: State<'_, AppState>) -> Result<Vec<SnapshotDto>, String> {
    require_admin(&state)?;
    let dir = snapshots_dir(&state)?;
    let mut out: Vec<SnapshotDto> = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|x| x.to_str()) != Some("db") {
            continue;
        }
        if let Some(dto) = to_dto(&path) {
            out.push(dto);
        }
    }
    out.sort_by_key(|s| std::cmp::Reverse(s.created_at)); // en yeni ilk
    Ok(out)
}

/// Yeni yedek al (online backup API). **Admin.** Olusan yedegin kaydini doner.
#[tauri::command]
pub async fn create_snapshot(state: State<'_, AppState>) -> Result<SnapshotDto, String> {
    require_admin(&state)?;
    let dir = snapshots_dir(&state)?;
    let name = format!("archivist-{}.db", now_ms());
    let path = dir.join(&name);
    {
        // read_db + async (2026-08-11): tum DB kopyasi senkron komutta UI is parcaciginda
        // kosuyordu VE yazma kilidini istiyordu — tarama sirasinda tetiklenirse pencere
        // taramanin sonuna dek donardi. SQLite backup API okuma baglantisindan tutarli
        // kopya alir; yazma kilidiyle yarismaz.
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.backup_to(&path).map_err(|e| e.to_string())?;
    }
    to_dto(&path).ok_or_else(|| "yedek olusturuldu ama okunamadi".to_string())
}

/// Zamanlanmis OTOMATIK yedek al (`auto-sched-*.db`) + retention uygula (otomatik yedeklerden
/// en yeni `keep` tut; `keep` en az 1'e kelepcelenir). **Admin.** Renderer scheduler cagirir;
/// budama hatasi olumcul DEGIL (yedek yine alindi). Olusan yedegi doner.
#[tauri::command]
pub async fn create_auto_snapshot(
    keep: u32,
    state: State<'_, AppState>,
) -> Result<SnapshotDto, String> {
    require_admin(&state)?;
    let dir = snapshots_dir(&state)?;
    let name = format!("auto-sched-{}.db", now_ms());
    let path = dir.join(&name);
    {
        // read_db + async — gerekce create_snapshot'taki notta. Zamanlayici bunu KENDILIGINDEN
        // tetikler (acilista aralik dolmussa hemen): kullanici hicbir seye tiklamadan bile
        // donma uretebilirdi — latent hata, 2026-08-11 taramasinda olculen sinifla ayni.
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.backup_to(&path).map_err(|e| e.to_string())?;
    }
    // Retention: otomatik yedekleri buda (en yeni keep tut; manuel/ice-aktarilan korunur).
    let keep = keep.max(1) as usize;
    let snaps: Vec<(String, u64)> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("db"))
        .filter_map(|p| to_dto(&p))
        .map(|d| (d.name, d.created_at))
        .collect();
    for victim in auto_snapshots_to_prune(&snaps, keep) {
        let _ = fs::remove_file(dir.join(victim)); // budama hatasi yutulur (olumcul degil)
    }
    to_dto(&path).ok_or_else(|| "otomatik yedek olusturuldu ama okunamadi".to_string())
}

/// Bir yedekten geri yukle (UZERINE YAZAR — GERI-ALINAMAZ). **Admin.** UI onay ister.
#[tauri::command(async)]
pub fn restore_snapshot(name: String, state: State<'_, AppState>) -> Result<(), String> {
    require_admin(&state)?;
    let dir = snapshots_dir(&state)?;
    let path = safe_snapshot_path(&dir, &name)?;
    if !path.is_file() {
        return Err("yedek bulunamadi".to_string());
    }
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.restore_from(&path).map_err(|e| e.to_string())
}

/// Bir yedegi sil. **Admin.**
#[tauri::command]
pub fn delete_snapshot(name: String, state: State<'_, AppState>) -> Result<(), String> {
    require_admin(&state)?;
    let dir = snapshots_dir(&state)?;
    let path = safe_snapshot_path(&dir, &name)?;
    fs::remove_file(&path).map_err(|e| e.to_string())
}

/// Bir yedegi managed klasor disina (kullanici sectigi `dest`) kopyala — felaket-yedegi
/// (harici disk). **Admin.** `dest` frontend kaydet-diyalogundan gelir.
#[tauri::command]
pub fn export_snapshot(
    name: String,
    dest: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    require_admin(&state)?;
    let dir = snapshots_dir(&state)?;
    let src = safe_snapshot_path(&dir, &name)?;
    if !src.is_file() {
        return Err("yedek bulunamadi".to_string());
    }
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// Harici bir `.db` yedegi managed klasore al (ice aktar) → listede gorunur, geri yuklenebilir.
/// **Admin.** `src` frontend ac-diyalogundan gelir. Olusan kaydi doner.
#[tauri::command]
pub fn import_snapshot(src: String, state: State<'_, AppState>) -> Result<SnapshotDto, String> {
    require_admin(&state)?;
    let src_path = Path::new(&src);
    if !src_path.is_file() {
        return Err("kaynak dosya bulunamadi".to_string());
    }
    let dir = snapshots_dir(&state)?;
    let name = format!("imported-{}.db", now_ms());
    let dest = dir.join(&name);
    fs::copy(src_path, &dest).map_err(|e| e.to_string())?;
    to_dto(&dest).ok_or_else(|| "ice aktarildi ama okunamadi".to_string())
}

#[cfg(test)]
mod tests {
    use super::{auto_snapshots_to_prune, safe_snapshot_path};
    use std::path::Path;

    /// Retention: yalniz `auto-` yedekler budanir (en yeni `keep` tutulur); manuel
    /// (`archivist-`) / ice-aktarilan (`imported-`) ASLA budanmaz.
    #[test]
    fn prune_keeps_newest_auto_and_never_touches_manual() {
        let snaps = vec![
            ("auto-sched-100.db".to_string(), 100),
            ("auto-sched-300.db".to_string(), 300),
            ("auto-reset-200.db".to_string(), 200),
            ("archivist-50.db".to_string(), 50), // manuel — korunur
            ("imported-999.db".to_string(), 999), // ice-aktarilan — korunur
        ];
        // keep=2 → en yeni 2 auto (300, 200) tutulur; 100 silinir.
        let prune = auto_snapshots_to_prune(&snaps, 2);
        assert_eq!(prune, vec!["auto-sched-100.db".to_string()], "yalniz en eski auto budanmali");

        // keep=1 → en yeni auto (300) tutulur; 200 + 100 budanir (manuel/import haric).
        let mut prune1 = auto_snapshots_to_prune(&snaps, 1);
        prune1.sort();
        assert_eq!(prune1, vec!["auto-reset-200.db".to_string(), "auto-sched-100.db".to_string()]);

        // keep >= auto sayisi → budama yok.
        assert!(auto_snapshots_to_prune(&snaps, 10).is_empty());
    }

    /// safe_snapshot_path: ayrac/`..`/yanlis-uzanti reddedilir; duz `.db` adi kabul.
    #[test]
    fn safe_snapshot_path_rejects_traversal_and_bad_names() {
        let dir = Path::new("/data/snapshots");
        assert!(safe_snapshot_path(dir, "archivist-1.db").is_ok());
        assert!(safe_snapshot_path(dir, "").is_err(), "bos ad");
        assert!(safe_snapshot_path(dir, "yok.txt").is_err(), ".db disi uzanti");
        assert!(safe_snapshot_path(dir, "../gizli.db").is_err(), "ust-dizin gezinme");
        assert!(safe_snapshot_path(dir, "alt/x.db").is_err(), "POSIX ayrac");
        assert!(safe_snapshot_path(dir, "alt\\x.db").is_err(), "Windows ayrac");
    }
}
