//! Refile fs cekirdegi — saf yol yardimcilari + tek-dosya tasima/kopyalama + ilerleme yayini.
//! Tauri'siz (yalniz `&Db` + yollar/`Channel`) → birim test edilebilir. Komut katmani (`mod.rs`)
//! ve kardes moduller (organize/undo) buradaki `pub(crate)` cekirdegi paylasir.

use std::fs::{self, OpenOptions};
use std::path::Path;
use std::time::Instant;

use archivist_db::{Db, RefileError};
use tauri::ipc::Channel;

use super::RefileProgress;

// ── Saf yol yardimcilari (query.rs desenleriyle birebir; Tauri'siz → birim test) ─────────

/// Bir tam yoldan **ust-dizini** turet (son ayraca kadar). Her iki ayrac (`/`, `\`) — Windows +
/// POSIX; yol farkli OS'tan gelmis olabilir (query.rs `parent_dir` ile ayni gerekce). Ayrac yoksa
/// `None`. Tek-ayrac kok (or. `/x` → `/`) korunur.
pub(super) fn parent_dir(path: &str) -> Option<&str> {
    let last_sep = path.rfind(['/', '\\'])?;
    if last_sep == 0 {
        Some(&path[..1])
    } else {
        Some(&path[..last_sep])
    }
}

/// Bir tam yoldan **dosya adini** al (son ayractan sonrasi). Ayrac yoksa yol aynen.
pub(super) fn file_name_of(path: &str) -> &str {
    match path.rfind(['/', '\\']) {
        Some(i) => &path[i + 1..],
        None => path,
    }
}

/// Bir yolun kullandigi ayrac: `\` iceriyorsa `\` (Windows), yoksa `/` (POSIX). Yeni yolu ESKI
/// yolun/hedef dizinin ayracina uyumlu kurmak icin (karisik ayrac uretmeyiz).
pub(crate) fn separator_of(path: &str) -> char {
    if path.contains('\\') {
        '\\'
    } else {
        '/'
    }
}

/// `dir` + `sep` + `name` birlestir — dir zaten ayracla bitiyorsa ayraci ciftLEME (kok `/` veya
/// `C:\` gibi).
pub(crate) fn join_path(dir: &str, sep: char, name: &str) -> String {
    if dir.ends_with(['/', '\\']) {
        format!("{dir}{name}")
    } else {
        format!("{dir}{sep}{name}")
    }
}

/// Yeni ad gecerli mi: bos degil, path-ayraci (`/`/`\`) icermez, `..` (dizin-cikma) icermez.
/// Traversal savunmasi — yeni ad DAIMA duz bir dosya adi olmali (dizin degistirmemeli).
pub(super) fn is_valid_new_name(name: &str) -> bool {
    !name.is_empty() && !name.contains(['/', '\\']) && !name.contains("..")
}

// ── Tek-dosya tasima cekirdegi (tekil + batch paylasir) ──────────────────────────────────

/// Tek tasima sonucu.
#[derive(Debug)]
pub(crate) enum RefileOutcome {
    /// Diskte tasindi + DB guncellendi.
    Moved,
    /// Kaynak zaten hedefte (ayni yol) → dokunulmadi (no-op).
    AlreadyInPlace,
}

/// Tek tasima hatasi — komut katmani `code()` ile hata koduna, `is_skip()` ile skip/fail
/// kovasina cevirir.
#[derive(Debug)]
pub(crate) enum RefileOpError {
    /// Kaynak dosya bu makinede yok (cok-lokasyon) → skip.
    SourceMissing,
    /// Hedef dosya zaten var → sessiz ezme YOK → skip.
    TargetExists,
    /// DB UNIQUE(path) ihlali (hedef yol baska asset'te) → fail.
    Conflict,
    /// Disk tasima hatasi → fail.
    Disk(String),
    /// Diger DB hatasi → fail.
    Db(String),
}

impl RefileOpError {
    /// Renderer'in i18n'leyecegi hata kodu.
    pub(crate) fn code(&self) -> String {
        match self {
            RefileOpError::SourceMissing => "source_missing".into(),
            RefileOpError::TargetExists => "target_exists".into(),
            RefileOpError::Conflict => "db_conflict".into(),
            RefileOpError::Disk(m) => format!("disk_error: {m}"),
            RefileOpError::Db(m) => format!("db_error: {m}"),
        }
    }

    /// Benign (skipped) mi yoksa gercek hata (failed) mi? Kaynak-yok / hedef-dolu → skip.
    pub(crate) fn is_skip(&self) -> bool {
        matches!(self, RefileOpError::SourceMissing | RefileOpError::TargetExists)
    }
}

/// Dosyayi diskte tasi: once atomik `rename` (ayni birim → hizli); basarisizsa (surucu-arasi vb.)
/// `copy` + hedef `sync_all` (fsync) + kaynak-sil. fsync icin hedef YAZMA erisimiyle acilir
/// (Windows FlushFileBuffers read-only handle'i reddedebilir). Kaynak silinemezse yeni kopya
/// geri alinir (db henuz guncellenmedi → disk+db tutarli kalir).
fn move_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    if fs::rename(src, dst).is_ok() {
        return Ok(());
    }
    fs::copy(src, dst)?;
    let f = OpenOptions::new().write(true).open(dst)?;
    f.sync_all()?;
    drop(f);
    if let Err(e) = fs::remove_file(src) {
        let _ = fs::remove_file(dst); // kismi-tasima geri al
        return Err(e);
    }
    Ok(())
}

/// Dosyayi hedefe KOPYALA (kaynak yerinde kalir) + hedef `sync_all` (fsync) — organize "copy" modu.
/// `move_file`'in copy-branch'i ile ayni fsync deseni ama kaynak SILINMEZ (kopya additive; DB'ye
/// dokunulmaz). Ezme kontrolu CAGIRANA aittir (bu fonksiyon var olan hedefin uzerine yazabilir →
/// cagiran once `dst.exists()` bakip skip'ler; kopya modu ezme YOK ilkesini orada uygular).
pub(crate) fn copy_file(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::copy(src, dst)?;
    let f = OpenOptions::new().write(true).open(dst)?;
    f.sync_all()?;
    drop(f);
    Ok(())
}

/// DB katmani hatasi → komut katmani hatasi. `NotFound`: yol okunduktan sonra asset silinmis
/// (savunma amacli; cagiran rollback yapar).
pub(crate) fn map_refile_err(e: RefileError) -> RefileOpError {
    match e {
        RefileError::Conflict => RefileOpError::Conflict,
        RefileError::NotFound => RefileOpError::Db("not_found".into()),
        RefileError::Db(e) => RefileOpError::Db(e.to_string()),
    }
}

/// Bir asset'i `old_path`'ten `new_path`'e tasi — **DB senkronu `sync` geri-cagrisinda**.
/// On-kontrol → disk tasi (YAVAS; kilitsiz) → `sync` (KISA; cagiran kilidi yalniz burada tutar)
/// → `sync` hata verirse disk ROLLBACK.
///
/// **Neden ayrik (2026-08-20 kullanici bulgusu):** batch komutlari eskiden `AppState.db` kilidini
/// TUM batch boyunca tutuyordu; dosyalar diskte tasinirken (surucu-arasi kopyada saniyeler) ayni
/// anda kosan AI gorsel-analizi kilit talebinde donuyordu. Kilit artik dosya-basi ve yalniz DB
/// adiminda alinir.
pub(crate) fn refile_one_with<F>(
    id: i64,
    old_path: &str,
    new_path: &str,
    sync: F,
) -> Result<RefileOutcome, RefileOpError>
where
    F: FnOnce(i64, &str) -> Result<(), RefileOpError>,
{
    // Zaten hedefte → disk/db'ye dokunma.
    if new_path == old_path {
        return Ok(RefileOutcome::AlreadyInPlace);
    }
    let src = Path::new(old_path);
    let dst = Path::new(new_path);

    // Kaynak bu makinede yok → tasinamaz (cok-lokasyon gercegi).
    if !src.exists() {
        return Err(RefileOpError::SourceMissing);
    }
    // Hedef DOLU → SESSIZ EZME YOK (H2 tuzagi). Kullanici cozer.
    if dst.exists() {
        return Err(RefileOpError::TargetExists);
    }

    // Disk tasi.
    move_file(src, dst).map_err(|e| RefileOpError::Disk(e.to_string()))?;

    // DB yol senkronu. Hata → disk ROLLBACK (best-effort geri-tasi) → tipli hata.
    match sync(id, new_path) {
        Ok(()) => Ok(RefileOutcome::Moved),
        Err(e) => {
            let _ = move_file(dst, src);
            Err(e)
        }
    }
}

/// [`refile_one_with`]'in elinde ZATEN `&Db` olan cagiran icin kolaylik hali (tekil yeniden
/// adlandirma + birim testler). Batch komutlari `refile_one_with` kullanir (kilit dosya-basi).
pub(crate) fn refile_one(
    db: &Db,
    id: i64,
    old_path: &str,
    new_path: &str,
) -> Result<RefileOutcome, RefileOpError> {
    refile_one_with(id, old_path, new_path, |id, path| {
        db.refile_asset(id, path).map(|_| ()).map_err(map_refile_err)
    })
}

/// İlerleme yayini (throttle: ilk + son + ~100ms arayla; reindex/rag deseni).
pub(crate) fn emit_progress(
    ch: &Channel<RefileProgress>,
    processed: usize,
    total: usize,
    current_file: String,
    last_emit: &mut Option<Instant>,
) {
    let now = Instant::now();
    let is_last = processed >= total;
    let due = last_emit.is_none_or(|t| now.duration_since(t).as_millis() >= 100);
    if processed == 1 || is_last || due {
        *last_emit = Some(now);
        let _ = ch.send(RefileProgress { processed, total, current_file });
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_valid_new_name, join_path, parent_dir, refile_one, separator_of, RefileOpError,
        RefileOutcome,
    };
    use rusqlite::params;

    /// Bellek-ici Db'ye gercek disk-yollu asset ekle → id.
    fn seed(db: &archivist_db::Db, path: &str, name: &str) -> i64 {
        db.connection()
            .execute(
                "INSERT INTO assets(path, file_name, ext, size_bytes, created_at, modified_at)
                 VALUES (?1, ?2, 'dwg', 4, 1, 1)",
                params![path, name],
            )
            .unwrap();
        db.connection().last_insert_rowid()
    }

    #[test]
    fn parent_dir_and_join_roundtrip() {
        assert_eq!(parent_dir(r"C:\a\b\1.dwg"), Some(r"C:\a\b"));
        assert_eq!(parent_dir("/a/b/1.dwg"), Some("/a/b"));
        assert_eq!(parent_dir("/1.dwg"), Some("/")); // kok
        assert_eq!(parent_dir("ciplak"), None);
        // join: kok ayraci ciftlenmez.
        assert_eq!(join_path(r"C:\a\b", '\\', "2.dwg"), r"C:\a\b\2.dwg");
        assert_eq!(join_path("/", '/', "2.dwg"), "/2.dwg");
        assert_eq!(join_path("/a/b", '/', "2.dwg"), "/a/b/2.dwg");
    }

    #[test]
    fn separator_of_prefers_backslash() {
        assert_eq!(separator_of(r"C:\a\b"), '\\');
        assert_eq!(separator_of("/a/b"), '/');
        assert_eq!(separator_of("nosep"), '/');
    }

    #[test]
    fn is_valid_new_name_rejects_traversal_and_seps() {
        assert!(is_valid_new_name("villa-yeni.dwg"));
        assert!(!is_valid_new_name(""));
        assert!(!is_valid_new_name("a/b.dwg"));
        assert!(!is_valid_new_name(r"a\b.dwg"));
        assert!(!is_valid_new_name(".."));
        assert!(!is_valid_new_name("../evil"));
    }

    #[test]
    fn refile_one_moves_file_and_updates_db() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("eski.dwg");
        let dst = dir.path().join("yeni.dwg");
        std::fs::write(&src, b"data").unwrap();

        let db = archivist_db::Db::open_in_memory_migrated().unwrap();
        let src_str = src.to_string_lossy().to_string();
        let dst_str = dst.to_string_lossy().to_string();
        let id = seed(&db, &src_str, "eski.dwg");

        let out = refile_one(&db, id, &src_str, &dst_str).unwrap();
        assert!(matches!(out, RefileOutcome::Moved));
        assert!(!src.exists() && dst.exists(), "dosya diskte tasinmali");

        let db_path: String = db
            .connection()
            .query_row("SELECT path FROM assets WHERE id=?1", params![id], |r| r.get(0))
            .unwrap();
        assert_eq!(db_path, dst_str, "DB yolu yeni yola guncellenmeli");
    }

    #[test]
    fn refile_one_same_path_is_noop() {
        let db = archivist_db::Db::open_in_memory_migrated().unwrap();
        // Ayni yol → db'ye hic dokunmadan AlreadyInPlace (id var olmasa da).
        let out = refile_one(&db, 1, r"C:\a\1.dwg", r"C:\a\1.dwg").unwrap();
        assert!(matches!(out, RefileOutcome::AlreadyInPlace));
    }

    #[test]
    fn refile_one_source_missing() {
        let db = archivist_db::Db::open_in_memory_migrated().unwrap();
        let id = seed(&db, r"C:\yok\eski.dwg", "eski.dwg");
        let err = refile_one(&db, id, r"C:\yok\eski.dwg", r"C:\yok\yeni.dwg").unwrap_err();
        assert!(matches!(err, RefileOpError::SourceMissing));
    }

    #[test]
    fn refile_one_target_exists_no_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("a.dwg");
        let dst = dir.path().join("b.dwg");
        std::fs::write(&src, b"src").unwrap();
        std::fs::write(&dst, b"dst").unwrap();

        let db = archivist_db::Db::open_in_memory_migrated().unwrap();
        let src_str = src.to_string_lossy().to_string();
        let dst_str = dst.to_string_lossy().to_string();
        let id = seed(&db, &src_str, "a.dwg");

        let err = refile_one(&db, id, &src_str, &dst_str).unwrap_err();
        assert!(matches!(err, RefileOpError::TargetExists));
        // Sessiz ezme YOK: hedef icerigi korunur, kaynak yerinde.
        assert_eq!(std::fs::read(&dst).unwrap(), b"dst");
        assert!(src.exists());
    }

    #[test]
    fn refile_one_db_conflict_rolls_back_disk() {
        let dir = tempfile::tempdir().unwrap();
        let src = dir.path().join("kaynak.dwg");
        let dst = dir.path().join("hedef.dwg"); // diskte YOK (baska asset db'de bu yolu tutuyor)
        std::fs::write(&src, b"data").unwrap();

        let db = archivist_db::Db::open_in_memory_migrated().unwrap();
        let src_str = src.to_string_lossy().to_string();
        let dst_str = dst.to_string_lossy().to_string();
        let id = seed(&db, &src_str, "kaynak.dwg");
        // Baska asset ZATEN dst yolunu tutuyor (disk'te yok) → UPDATE UNIQUE ihlali.
        seed(&db, &dst_str, "hedef.dwg");

        let err = refile_one(&db, id, &src_str, &dst_str).unwrap_err();
        assert!(matches!(err, RefileOpError::Conflict));
        // Disk rollback: kaynak geri geldi, gecici hedef kopyasi silindi.
        assert!(src.exists(), "db cakismasi sonrasi kaynak diske geri tasinmali");
        assert!(!dst.exists(), "gecici hedef kopyasi rollback'te silinmeli");
    }
}
