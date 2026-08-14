//! Cok-arsiv tasima (portable export/import) — komut katmani (Dilim 2).
//!
//! Bir arsivi BASKA bir makineye tasima: **konteyner = ham SQLite dosyasi** (ZIP YOK).
//! Import semantigi **butun-DB REPLACE** (`Db::restore_from`; merge YOK). Manifest alanlari
//! export'ta kopyanin `app_meta`'sina `export_*` anahtarlariyla gomulur; `peek` onlari okur
//! (dis-crate/ZIP gerekmeden). Saf DB islemleri Dilim 1'de (`archivist-db::portable`):
//! `remap_paths` (YOL-REMAP), `scan_roots`, `common_prefix`, `backup_to`/`restore_from`.
//!
//! Desen kaynagi: `model_commands.rs` (saf-cekirdek `do_*`, ince `#[tauri::command]`
//! sarmalayici, Channel faz-ilerlemesi, inline test), `reindex_commands.rs` (async, kilit-oncesi
//! audit aktoru, `signal_index`), `backup_commands.rs` (snapshot güvenlik-agi = rollback).
//!
//! Cekirdek (`do_export`/`do_import`/`peek_manifest`) Tauri'siz → birim-test edilebilir;
//! ince `#[tauri::command]` sarmalayicilar (`require_admin` + kilit + Channel koprusu)
//! `archive_share_commands.rs`'te (500-satir sinir bolunmesi; saf refactor).

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};

use archivist_db::{Db, RootStat};

// ── Manifest anahtarlari (kopyanin app_meta'sina gomulur) ───────────────────────

const EXPORT_FORMAT_VERSION: &str = "export_format_version";
const EXPORT_APP_VERSION: &str = "export_app_version";
const EXPORT_CREATED_AT: &str = "export_created_at";
const EXPORT_SOURCE_HOST: &str = "export_source_host";
pub(crate) const EXPORT_ASSET_COUNT: &str = "export_asset_count";
pub(crate) const EXPORT_SOURCE_ROOTS: &str = "export_source_roots";
pub(crate) const EXPORT_SAMPLE_PREFIX: &str = "export_sample_prefix";

/// Import sonrasi dogrulamada denetlenecek ornek asset yolu sayisi (remap dogru mu sinyali).
const VERIFY_SAMPLE: i64 = 500;

// ── DTO'lar (camelCase — Dilim 3 frontend kontrati) ─────────────────────────────

/// Export ilerlemesi (Channel → frontend cubugu). `phase`:
/// `"preparing"` | `"copying"` | `"writingManifest"` | `"done"`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    phase: String,
}

/// Export sonucu (renderer'a doner).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    /// Aktif asset sayisi (kopyalanan arsivde).
    pub(crate) asset_count: i64,
    /// Olusan `.archivistpro` dosyasinin boyutu (bayt).
    size_bytes: u64,
    /// Yazilan dosyanin yolu.
    path: String,
}

/// Import ilerlemesi (Channel → frontend cubugu). `phase`:
/// `"validating"` | `"backingUp"` | `"restoring"` | `"remapping"` | `"verifying"` | `"done"`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    phase: String,
}

/// `.archivistpro` onizlemesi (peek) — import diyalogu bunu gosterir (salt-okuma).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveManifest {
    format_version: String,
    app_version: String,
    created_at: String,
    pub(crate) source_host: String,
    asset_count: i64,
    /// Kaynak-kokler (path/count) — remap satirlarini onermek icin. `RootStat` alanlari
    /// zaten tek-kelime kucuk-harf → camelCase ile birebir (`path`/`count`).
    source_roots: Vec<RootStat>,
    sample_prefix: String,
    schema_version: i64,
}

/// Tek bir YOL-REMAP kurali (frontend'ten gelir; `newRoot` bos → o kural atlanir).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Remap {
    pub old_root: String,
    pub new_root: String,
}

/// Import sonucu (renderer'a doner). `rolled_back=true` → REPLACE basarisizdi, güvenlik
/// yedeginden geri alindi (arsiv import-oncesi haliyle korundu).
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub(crate) asset_count: i64,
    pub(crate) remapped_rows: usize,
    files_checked: usize,
    files_found: usize,
    files_missing: usize,
    rolled_back: bool,
}

// ── Saf yardimcilar ─────────────────────────────────────────────────────────────

/// Simdiki unix saniye (manifest `created_at` icin). Saat epoch oncesine giderse 0.
fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Unix saniyeyi okunur UTC ISO-benzeri damgaya cevir (`YYYY-MM-DDTHH:MM:SSZ`). DIS crate YOK
/// (chrono/humantime yasak) → Howard Hinnant `civil_from_days` algoritmasi (saf tamsayi
/// aritmetigi, deterministik). Kesin RFC3339 sart degil; okunur + siralanabilir yeter.
pub(crate) fn unix_to_iso_utc(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (hh, mm, ss) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil_from_days: 1970-01-01'den itibaren gun sayisi → (yil, ay, gun).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097; // [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = doy - (153 * mp + 2) / 5 + 1; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 }; // [1, 12]
    let year = if m <= 2 { y + 1 } else { y };
    format!("{year:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// `app_meta`'ya UPSERT (meta.rs `set_meta` ile ayni SQL) — ham baglanti uzerinden.
pub(crate) fn upsert_meta(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO app_meta(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map(|_| ())
    .map_err(|e| format!("manifest anahtari yazilamadi ({key}): {e}"))
}

/// `app_meta`'dan bir deger oku (yoksa / tablo yoksa `None`).
fn read_meta_opt(conn: &rusqlite::Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM app_meta WHERE key = ?1", [key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
}

// ── Saf cekirdek: peek / export / import ────────────────────────────────────────

/// Bir `.archivistpro` (ham SQLite) dosyasindan manifest onizlemesi cikar — **salt-okuma**.
/// `export_format_version` yoksa gecersiz dosya (kullanici yanlis dosya sectiyse).
pub(crate) fn peek_manifest(path: &Path) -> Result<ArchiveManifest, String> {
    let conn = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|e| format!("arsiv dosyasi acilamadi: {e}"))?;

    // PRAGMA user_version hem sema versiyonunu verir hem "SQLite mi?" dogrular (degilse hata).
    let schema_version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|_| "gecersiz .archivistpro dosyasi (SQLite degil)".to_string())?;

    let format_version = read_meta_opt(&conn, EXPORT_FORMAT_VERSION)
        .ok_or_else(|| "gecersiz .archivistpro dosyasi (disa-aktarim manifesti yok)".to_string())?;

    let app_version = read_meta_opt(&conn, EXPORT_APP_VERSION).unwrap_or_default();
    let created_at = read_meta_opt(&conn, EXPORT_CREATED_AT).unwrap_or_default();
    let source_host = read_meta_opt(&conn, EXPORT_SOURCE_HOST).unwrap_or_default();
    let asset_count =
        read_meta_opt(&conn, EXPORT_ASSET_COUNT).and_then(|s| s.parse::<i64>().ok()).unwrap_or(0);
    let sample_prefix = read_meta_opt(&conn, EXPORT_SAMPLE_PREFIX).unwrap_or_default();
    // Bozuk JSON → bos vec (onizleme yine acilir; roots yalniz oneri).
    let source_roots = read_meta_opt(&conn, EXPORT_SOURCE_ROOTS)
        .and_then(|s| serde_json::from_str::<Vec<RootStat>>(&s).ok())
        .unwrap_or_default();

    Ok(ArchiveManifest {
        format_version,
        app_version,
        created_at,
        source_host,
        asset_count,
        source_roots,
        sample_prefix,
        schema_version,
    })
}

/// **Export cekirdegi (saf).** Canli db'den manifest derle → temiz SQLite kopyasi yaz →
/// kopyanin `app_meta`'sina `export_*` gom. `emit` faz-ilerlemesi.
pub(crate) fn do_export(
    db: &Db,
    dest_path: &Path,
    mut emit: impl FnMut(ExportProgress),
) -> Result<ExportReport, String> {
    // 1) Hazirla: manifest verisini CANLI db'den derle.
    emit(ExportProgress { phase: "preparing".into() });
    let asset_count = db.count_active_assets().map_err(|e| e.to_string())?;
    let source_roots = db.scan_roots().map_err(|e| e.to_string())?;
    // Tum aktif yollar → en uzun ortak on-ek (samplePrefix). Export nadir/etkilesimli (bkz
    // portable.rs scan_roots notu) → i64::MAX ile hepsini cek.
    let paths = db.sample_asset_paths(i64::MAX).map_err(|e| e.to_string())?;
    let sample_prefix = archivist_db::portable::common_prefix(&paths);
    // Not: sema versiyonu manifest'e AYRI yazilmaz — peek dogrudan `PRAGMA user_version` okur.
    let source_host = crate::location::current_hostname();
    let created_at = unix_to_iso_utc(now_unix());
    let app_version = env!("CARGO_PKG_VERSION");
    let roots_json = serde_json::to_string(&source_roots).map_err(|e| e.to_string())?;

    // 2) Kopyala: online-backup ile tutarli SQLite kopyasi (WAL-guvenli, vec0 dahil).
    emit(ExportProgress { phase: "copying".into() });
    db.backup_to(dest_path).map_err(|e| format!("arsiv kopyalanamadi: {e}"))?;

    // 3) Manifest yaz: kopyayi HAM ac, app_meta'ya export_* UPSERT et.
    emit(ExportProgress { phase: "writingManifest".into() });
    {
        let conn = rusqlite::Connection::open(dest_path)
            .map_err(|e| format!("kopya manifest yazimi icin acilamadi: {e}"))?;
        // Konteyneri rollback (DELETE) journal moduna normalize et: online-backup ciktisi WAL
        // header'i tasiyabilir (-wal/-shm yan-dosyalari); onlarsiz SALT-OKUMA acilis (peek)
        // basarisiz olabilir (read-only'de -shm uretilemez). DELETE → header surumu 1, yan-dosya
        // yok → `.archivistpro` tek kendine-yeter dosya + peek READ_ONLY kesin acilir. Zaten
        // rollback ise no-op. restore_from sayfa-duzeyi oldugundan bu modu sorunsuz tuketir.
        conn.execute_batch("PRAGMA journal_mode = DELETE;")
            .map_err(|e| format!("kopya journal modu normalize edilemedi: {e}"))?;
        upsert_meta(&conn, EXPORT_FORMAT_VERSION, "1")?;
        upsert_meta(&conn, EXPORT_APP_VERSION, app_version)?;
        upsert_meta(&conn, EXPORT_CREATED_AT, &created_at)?;
        upsert_meta(&conn, EXPORT_SOURCE_HOST, &source_host)?;
        upsert_meta(&conn, EXPORT_ASSET_COUNT, &asset_count.to_string())?;
        upsert_meta(&conn, EXPORT_SOURCE_ROOTS, &roots_json)?;
        upsert_meta(&conn, EXPORT_SAMPLE_PREFIX, &sample_prefix)?;
    } // conn drop → varsa -wal temizlenir; boyut olcumu tutarli

    // 4) Bitti.
    emit(ExportProgress { phase: "done".into() });
    let size_bytes = std::fs::metadata(dest_path).map(|m| m.len()).unwrap_or(0);
    Ok(ExportReport { asset_count, size_bytes, path: dest_path.display().to_string() })
}

/// **Import cekirdegi (saf).** Dogrula → güvenlik yedegi → butun-DB REPLACE → host sifirla +
/// manifest temizle + YOL-REMAP → ornek dosya-varlik dogrula. Hata → güvenlik yedeginden ROLLBACK.
pub(crate) fn do_import(
    db: &mut Db,
    src_path: &Path,
    remaps: &[Remap],
    snapshots_dir: &Path,
    host: &str,
    mut emit: impl FnMut(ImportProgress),
) -> Result<ImportReport, String> {
    // 1) Dogrula: kaynak manifest + sema uyumu. Kaynak DAHA YENI ise HICBIR SEY yapmadan cik.
    emit(ImportProgress { phase: "validating".into() });
    let manifest = peek_manifest(src_path)?;
    let live_schema = db.schema_version().map_err(|e| e.to_string())?;
    if manifest.schema_version > live_schema {
        return Err(
            "kaynak arsiv daha yeni bir uygulama surumuyle olusturulmus; once uygulamayi guncelle"
                .to_string(),
        );
    }

    // 2) Güvenlik yedegi (rollback agi) — backup_commands zaman-damga helper'i; ad app-uretimli
    // (kullanici girdisi yok) → yol-gezinme riski yok.
    emit(ImportProgress { phase: "backingUp".into() });
    let safety_path =
        snapshots_dir.join(format!("pre-import-{}.db", crate::backup_commands::now_ms()));
    db.backup_to(&safety_path).map_err(|e| format!("guvenlik yedegi alinamadi: {e}"))?;

    // 3) Butun-DB REPLACE (+ ileri-migration). Hata → güvenlik yedeginden ROLLBACK dene.
    emit(ImportProgress { phase: "restoring".into() });
    if let Err(e) = db.restore_from(src_path) {
        return match db.restore_from(&safety_path) {
            Ok(()) => Ok(ImportReport { rolled_back: true, ..Default::default() }),
            Err(re) => Err(format!(
                "ice aktarim basarisiz ({e}) VE geri alma basarisiz ({re}); guvenlik yedegi: {}",
                safety_path.display()
            )),
        };
    }

    // 4) Post-import duzeltmeler: host'u BU makineye sifirla, manifest izlerini sil, YOL-REMAP.
    emit(ImportProgress { phase: "remapping".into() });
    db.set_meta(archivist_db::meta::META_ARCHIVE_HOST, host).map_err(|e| e.to_string())?;
    // Bu artik canli arsiv → disa-aktarim manifesti kalmasin (execute yalniz &Connection ister).
    db.connection()
        .execute("DELETE FROM app_meta WHERE key LIKE 'export_%'", [])
        .map_err(|e| format!("manifest temizlenemedi: {e}"))?;
    let mut remapped_rows = 0usize;
    for r in remaps {
        if r.new_root.is_empty() {
            continue; // bos hedef → o kok remap edilmez (dosyalar ayni yerde kaliyor)
        }
        remapped_rows += db.remap_paths(&r.old_root, &r.new_root).map_err(|e| e.to_string())?;
    }

    // 5) Dogrula (H3 iyilestirmesi; H2'de YOK): ornek asset yollari bu makinede var mi →
    // "remap dogru mu" sinyali. Ornekleme; tum arsivi taramaz.
    emit(ImportProgress { phase: "verifying".into() });
    let sample = db.sample_asset_paths(VERIFY_SAMPLE).map_err(|e| e.to_string())?;
    let files_checked = sample.len();
    let files_found = sample.iter().filter(|p| Path::new(p).exists()).count();
    let files_missing = files_checked - files_found;

    // 6) Bitti.
    emit(ImportProgress { phase: "done".into() });
    let asset_count = db.count_active_assets().map_err(|e| e.to_string())?;
    Ok(ImportReport {
        asset_count,
        remapped_rows,
        files_checked,
        files_found,
        files_missing,
        rolled_back: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Temp db'ye minimal bir asset ekle (ingest yazma API'si; icerik onemsiz).
    fn add_asset(db: &mut Db, path: &str) {
        let file_name = path.rsplit(['\\', '/']).next().unwrap_or(path);
        let input = archivist_db::AssetInput {
            path,
            file_name,
            ext: None,
            size_bytes: 1,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: 0,
            modified_at: 0,
        };
        let data = archivist_db::IngestData {
            fts_body: None,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        };
        db.ingest(&input, &data).unwrap();
    }

    /// civil_from_days damgasi bilinen epoch degerleri icin dogru.
    #[test]
    fn iso_utc_known_instants() {
        assert_eq!(unix_to_iso_utc(0), "1970-01-01T00:00:00Z");
        // 2021-01-01T00:00:00Z = 1609459200.
        assert_eq!(unix_to_iso_utc(1_609_459_200), "2021-01-01T00:00:00Z");
    }

    /// export → peek round-trip: manifest alanlari canli db'yi yansitir.
    #[test]
    fn export_then_peek_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let mut db = Db::open_and_migrate(&dir.path().join("src.db")).unwrap();
        add_asset(&mut db, r"C:\Proj\A\1.dwg");
        add_asset(&mut db, r"C:\Proj\A\2.dwg");
        add_asset(&mut db, r"C:\Proj\B\3.pdf");

        let dest = dir.path().join("out.archivistpro");
        let report = do_export(&db, &dest, |_| {}).unwrap();
        assert_eq!(report.asset_count, 3);
        assert!(report.size_bytes > 0);

        let m = peek_manifest(&dest).unwrap();
        assert_eq!(m.format_version, "1");
        assert_eq!(m.app_version, env!("CARGO_PKG_VERSION"));
        assert_eq!(m.asset_count, 3);
        assert_eq!(m.schema_version, db.schema_version().unwrap());
        assert_eq!(m.source_host, crate::location::current_hostname());
        // Tek kok C:\Proj (3 asset).
        assert_eq!(m.source_roots.len(), 1);
        assert_eq!(m.source_roots[0].path, r"C:\Proj");
        assert_eq!(m.source_roots[0].count, 3);
        // Ortak on-ek yaprak-oncesine kadar.
        assert!(m.sample_prefix.starts_with(r"C:\Proj\"), "prefix: {}", m.sample_prefix);
    }

    /// import: REPLACE + host sifirlama + YOL-REMAP + manifest temizligi + dosya-varlik dogrulamasi.
    #[test]
    fn import_replaces_and_resets_host_and_remaps() {
        // Kaynak: asset'ler C:\Eski\... altinda; farkli host ile isaretli.
        let src_dir = tempfile::tempdir().unwrap();
        let mut src_db = Db::open_and_migrate(&src_dir.path().join("src.db")).unwrap();
        add_asset(&mut src_db, r"C:\Eski\a.dwg");
        add_asset(&mut src_db, r"C:\Eski\alt\b.pdf");
        src_db.set_meta(archivist_db::meta::META_ARCHIVE_HOST, "ESKI-PC").unwrap();
        let export_path = src_dir.path().join("out.archivistpro");
        do_export(&src_db, &export_path, |_| {}).unwrap();
        drop(src_db);

        // Remap hedefi: GERCEK var-olan temp dosyalar (filesFound>0 dogrulanabilsin).
        let new_root = src_dir.path().join("Yeni");
        std::fs::create_dir_all(new_root.join("alt")).unwrap();
        std::fs::write(new_root.join("a.dwg"), b"x").unwrap();
        std::fs::write(new_root.join("alt").join("b.pdf"), b"x").unwrap();

        // Hedef: ayri, dolu bir db (REPLACE ile eski icerigi gitmeli) + snapshots dizini.
        let dst_dir = tempfile::tempdir().unwrap();
        let mut dst_db = Db::open_and_migrate(&dst_dir.path().join("dst.db")).unwrap();
        add_asset(&mut dst_db, r"Z:\Onceki\eski.dwg");
        let snaps = dst_dir.path().join("snapshots");
        std::fs::create_dir_all(&snaps).unwrap();

        let remap = Remap {
            old_root: r"C:\Eski".to_string(),
            new_root: new_root.to_string_lossy().to_string(),
        };
        let report =
            do_import(&mut dst_db, &export_path, std::slice::from_ref(&remap), &snaps, "YENI-PC", |_| {})
                .unwrap();

        assert!(!report.rolled_back);
        assert_eq!(report.asset_count, 2, "REPLACE: kaynagin 2 asset'i geldi");
        assert_eq!(report.remapped_rows, 2, "iki asset de remap edildi");
        assert_eq!(report.files_checked, 2);
        assert_eq!(report.files_found, 2, "remap gercek var-olan dosyalara → hepsi bulundu");
        assert_eq!(report.files_missing, 0);

        // Host BU makineye sifirlandi.
        assert_eq!(
            dst_db.get_meta(archivist_db::meta::META_ARCHIVE_HOST).unwrap().as_deref(),
            Some("YENI-PC")
        );
        // export_* anahtarlari temizlendi.
        assert!(dst_db.get_meta(EXPORT_FORMAT_VERSION).unwrap().is_none());
        assert!(dst_db.get_meta(EXPORT_ASSET_COUNT).unwrap().is_none());

        // Yollar remap'li (yeni kok altinda); eski hedef asset'i (Z:\Onceki) yok.
        let mut paths = dst_db.sample_asset_paths(10).unwrap();
        paths.sort();
        let mut want = vec![
            new_root.join("a.dwg").to_string_lossy().to_string(),
            new_root.join("alt").join("b.pdf").to_string_lossy().to_string(),
        ];
        want.sort();
        assert_eq!(paths, want);
    }

    /// import: kaynak sema CANLI db'den yeniyse → reddedilir, hedef DEGISMEZ.
    #[test]
    fn import_rejects_newer_schema() {
        // Kaynak export (normal).
        let src_dir = tempfile::tempdir().unwrap();
        let mut src_db = Db::open_and_migrate(&src_dir.path().join("src.db")).unwrap();
        add_asset(&mut src_db, r"C:\Eski\a.dwg");
        let export_path = src_dir.path().join("out.archivistpro");
        do_export(&src_db, &export_path, |_| {}).unwrap();
        drop(src_db);

        // Sema versiyonunu (user_version) canlidan cok yukseğe cek → "daha yeni surum".
        {
            let conn = rusqlite::Connection::open(&export_path).unwrap();
            conn.execute_batch("PRAGMA user_version = 999999;").unwrap();
        }

        // Hedef: dolu db (degismemeli).
        let dst_dir = tempfile::tempdir().unwrap();
        let mut dst_db = Db::open_and_migrate(&dst_dir.path().join("dst.db")).unwrap();
        add_asset(&mut dst_db, r"D:\Mevcut\b.dwg");
        let before = dst_db.count_active_assets().unwrap();
        let snaps = dst_dir.path().join("snapshots");
        std::fs::create_dir_all(&snaps).unwrap();

        let err = do_import(&mut dst_db, &export_path, &[], &snaps, "HOST", |_| {}).unwrap_err();
        assert!(err.contains("daha yeni"), "hata mesaji: {err}");

        // Hedef DEGISMEDI.
        assert_eq!(dst_db.count_active_assets().unwrap(), before);
        assert_eq!(dst_db.sample_asset_paths(10).unwrap(), vec![r"D:\Mevcut\b.dwg".to_string()]);
    }
}
