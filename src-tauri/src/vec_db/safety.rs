//! DESIGN-LOCK §6/§7 backend güvenlik ağı.
//!
//! - **rollback** (§6, admin-only): başarısız/iptal migrasyondan dönüş —
//!   premigrate `.bak`'tan ana DB'yi geri yükle + vec.db'yi sil. epoch=0
//!   otomatik (restore edilen yedek migrasyon-öncesi, `user_version=0`).
//! - **purge_orphans** (§7): periyodik orphan-temizlik — vec.db'de referans
//!   edilen ama kaynak `assets`'te artık olmayan asset_id'leri temizler
//!   (cross-DB FK yok; `delete_assets` cascade'i yeniden kullanır).
//!
//! Saf çekirdek + Tauri wrapper (Sprint 0 deseni: auth + path resolve +
//! spawn_blocking → sync core; DB_WRITE_LOCK altında yazımlar serileşir).

use super::{
    delete_assets, open_vec_db, resolve_source_db_path, resolve_vec_db_path,
    CascadeDeleteReport,
};
use std::path::{Path, PathBuf};

/// Premigrate yedek path: `<parent>/<stem>_premigrate_v3.db.bak`
/// (DESIGN-LOCK §6 adlandırması; frontend cutover migrasyon başında üretir).
pub(crate) fn resolve_premigrate_bak_path(
    app: &tauri::AppHandle,
    archive_at: Option<&str>,
) -> Result<PathBuf, String> {
    let main = resolve_source_db_path(app, archive_at)?;
    let parent = main.parent().ok_or("Geçersiz ana DB path")?;
    let stem = main
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("Geçersiz ana DB dosya adı")?;
    Ok(parent.join(format!("{}_premigrate_v3.db.bak", stem)))
}

/// Rollback sonucu.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackReport {
    pub main_restored: bool,
    pub vec_db_deleted: bool,
}

/// Saf çekirdek (DESIGN-LOCK §6): premigrate `.bak` → ana DB (atomik
/// `write_db_at`) + vec.db sil. `.bak` YOKSA hata döner ve **vec.db'ye
/// DOKUNULMAZ** (güvenli durdurma — kanıtsız rollback veri kaybı riskidir).
pub fn rollback(
    main_db: &Path,
    vec_db: &Path,
    premigrate_bak: &Path,
) -> Result<RollbackReport, String> {
    if !premigrate_bak.exists() {
        return Err(format!(
            "premigrate yedek yok ({}); rollback güvenli değil — vec.db korundu",
            premigrate_bak.display()
        ));
    }
    let bytes = std::fs::read(premigrate_bak)
        .map_err(|e| format!("premigrate yedek okunamadı: {}", e))?;
    // Atomik tmp→rename + inter-process kilit (ollama_db deseni).
    crate::ollama_db::write_db_at(main_db, &bytes)?;

    let mut vec_db_deleted = false;
    if vec_db.exists() {
        std::fs::remove_file(vec_db)
            .map_err(|e| format!("vec.db silinemedi: {}", e))?;
        vec_db_deleted = true;
    }
    // Yan dosya temizliği (DELETE journal → genelde yok; lock 0-bayt olabilir).
    let _ = std::fs::remove_file(vec_db.with_extension("db.lock"));
    let _ = std::fs::remove_file(vec_db.with_extension("db-journal"));
    Ok(RollbackReport {
        main_restored: true,
        vec_db_deleted,
    })
}

/// Saf çekirdek (DESIGN-LOCK §6): cutover migrasyon BAŞINDA ana DB'nin
/// premigrate yedeğini üretir (`<stem>_premigrate_v3.db.bak`). `rollback`'in
/// eşi — verify FAIL olursa `rollback` bu yedekten ana DB'yi geri yükler.
/// Atomik (`write_db_at` tmp→rename); ana DB yoksa hata (kanıtsız yedek YOK).
pub fn premigrate_backup(main_db: &Path, bak: &Path) -> Result<u64, String> {
    if !main_db.exists() {
        return Err(format!(
            "ana DB yok ({}) — premigrate yedek alınamadı",
            main_db.display()
        ));
    }
    let bytes = std::fs::read(main_db)
        .map_err(|e| format!("ana DB okunamadı: {}", e))?;
    crate::ollama_db::write_db_at(bak, &bytes)?;
    Ok(bytes.len() as u64)
}

/// Saf çekirdek (DESIGN-LOCK §1.2): V3 cutover'ın SON adımı — ana DB'den
/// V3-eligible tabloları (`embeddings`/`text_chunks`/`asset_relations`) kalıcı
/// DROP + `VACUUM` (dosyayı gerçekten küçült) + `user_version=3`.
///
/// Frontend `db.export()`+`write_database` yolu büyük monolitte (~185 MB)
/// `RangeError: Invalid array length` veriyordu → bu adım Rust'a taşındı.
/// `tmp` kopya üzerinde çalışır; başarıda atomik `write_db_at` ile yerine
/// koyar → hata olursa ana DB bozulmadan kalır (premigrate `.bak` de durur).
/// Döner: yeni (küçülmüş) ana DB boyutu (bayt).
pub fn finalize_main_migration(main_db: &Path) -> Result<u64, String> {
    if !main_db.exists() {
        return Err(format!(
            "ana DB yok ({}) — finalize yapılamadı",
            main_db.display()
        ));
    }
    // WAL'i ana dosyaya flush et — tmp kopya güncel olsun.
    crate::ollama_db::checkpoint_wal_truncate(main_db);

    let tmp = main_db.with_extension("db.finalize-tmp");
    let _ = std::fs::remove_file(&tmp); // önceki yarım denemeden kalıntı
    std::fs::copy(main_db, &tmp)
        .map_err(|e| format!("finalize tmp kopya hatası: {}", e))?;

    // tmp üzerinde DROP + VACUUM + user_version. Hata → tmp temizle, ana DB
    // dokunulmamış kalır. (Atomiklik aşağıdaki write_db_at tmp→rename'den gelir.)
    let ddl = (|| -> Result<(), String> {
        let conn = rusqlite::Connection::open(&tmp)
            .map_err(|e| format!("finalize tmp açılamadı: {}", e))?;
        conn.execute_batch(
            "PRAGMA foreign_keys = OFF;\n\
             PRAGMA synchronous = FULL;\n\
             DROP TABLE IF EXISTS embeddings;\n\
             DROP TABLE IF EXISTS text_chunks;\n\
             DROP TABLE IF EXISTS asset_relations;\n\
             VACUUM;\n\
             PRAGMA user_version = 3;",
        )
        .map_err(|e| format!("finalize DDL hatası: {}", e))?;
        Ok(())
    })();
    if let Err(e) = ddl {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }

    // Atomik yerine koy: tmp → ana DB (write_db_at: inter-process kilit +
    // tmp→rename + stale WAL-sidecar temizlik / Gate 0).
    let bytes = std::fs::read(&tmp)
        .map_err(|e| format!("finalize tmp okunamadı: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    crate::ollama_db::write_db_at(main_db, &bytes)?;
    Ok(bytes.len() as u64)
}

/// Saf çekirdek (DESIGN-LOCK §7): vec.db'de referans edilen tüm asset_id'ler
/// (embeddings.asset_id, text_chunks.asset_id, asset_relations.source_id +
/// target_id) ile kaynak `assets`'i karşılaştır; kaynakta OLMAYANları
/// `delete_assets` cascade'i ile sil. Idempotent.
pub fn purge_orphans(
    source_db: &Path,
    vec_db: &Path,
) -> Result<CascadeDeleteReport, String> {
    use std::collections::HashSet;

    let src = rusqlite::Connection::open(source_db)
        .map_err(|e| format!("kaynak DB açılamadı: {}", e))?;
    let mut live: HashSet<String> = HashSet::new();
    {
        let mut s = src
            .prepare("SELECT id FROM assets")
            .map_err(|e| format!("assets prepare hatası: {}", e))?;
        let rows = s
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| format!("assets query hatası: {}", e))?;
        for r in rows {
            live.insert(r.map_err(|e| format!("assets satır hatası: {}", e))?);
        }
    }

    let mut referenced: HashSet<String> = HashSet::new();
    {
        let vec = open_vec_db(vec_db)?;
        for sql in [
            "SELECT DISTINCT asset_id FROM embeddings",
            "SELECT DISTINCT asset_id FROM text_chunks",
            "SELECT DISTINCT source_id FROM asset_relations",
            "SELECT DISTINCT target_id FROM asset_relations",
        ] {
            let mut s = vec
                .prepare(sql)
                .map_err(|e| format!("vec prepare hatası: {}", e))?;
            let rows = s
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| format!("vec query hatası: {}", e))?;
            for r in rows {
                referenced.insert(r.map_err(|e| format!("vec satır hatası: {}", e))?);
            }
        }
        // `vec` bağlantısı burada düşer → delete_assets kendi yazma TX'ini
        // ayrı bağlantıda alırken okuma kilidi çakışmaz.
    }

    let orphans: Vec<String> = referenced
        .into_iter()
        .filter(|a| !live.contains(a))
        .collect();
    delete_assets(vec_db, &orphans)
}

// ── Tauri komutları ───────────────────────────────────────────────────────────

/// DESIGN-LOCK §6 — **admin-only** rollback. DB_WRITE_LOCK altında (ana DB
/// üzerine atomik yazım + vec.db silme serileşmeli).
#[tauri::command]
pub async fn vec_db_rollback(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<RollbackReport, String> {
    crate::require_admin(&role_state)?;
    let main = resolve_source_db_path(&app, archive_at.as_deref())?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    let bak = resolve_premigrate_bak_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        // rollback ana DB'yi bak'tan geri yükler → ana-DB yazmalarıyla
        // mutual exclusion gerekir; bu yüzden anahtar `main`.
        let archive_lock = crate::ollama_db::get_db_lock_for(&main);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        rollback(&main, &vdb, &bak)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// DESIGN-LOCK §6 — **admin-only** premigrate yedek (cutover başında).
/// `vec_db_rollback`'in eşi. Ana-DB okunur + `.bak`'a atomik yazılır →
/// `main` anahtarlı kilit (ana-DB yazmalarıyla serileşsin). WAL açıksa
/// önce checkpoint (eksik yedek olmasın).
#[tauri::command]
pub async fn vec_db_premigrate_backup(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<u64, String> {
    crate::require_admin(&role_state)?;
    let main = resolve_source_db_path(&app, archive_at.as_deref())?;
    let bak = resolve_premigrate_bak_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&main);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        crate::ollama_db::checkpoint_wal_truncate(&main);
        premigrate_backup(&main, &bak)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// DESIGN-LOCK §1.2 — **admin-only** cutover finalize. V3 migrate+verify
/// adımları geçtikten SONRA çağrılır: ana DB'den V3-eligible tabloları DROP +
/// `VACUUM` + `user_version=3`. `main` anahtarlı kilit (ana-DB yazımı serileşsin).
/// Frontend'in `db.export()`+`write_database` yolu büyük monolitte patlıyordu →
/// bu finalize Rust-side, `db.export()` gerektirmez.
#[tauri::command]
pub async fn vec_db_finalize_main_migration(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<u64, String> {
    crate::require_admin(&role_state)?;
    let main = resolve_source_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&main);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        finalize_main_migration(&main)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

/// DESIGN-LOCK §7 — periyodik orphan-temizlik (authenticated yeterli;
/// yalnız zaten orphan olan satırları siler). DB_WRITE_LOCK altında.
#[tauri::command]
pub async fn vec_db_purge_orphans(
    app: tauri::AppHandle,
    archive_at: Option<String>,
    role_state: tauri::State<'_, crate::SessionRoleState>,
) -> Result<CascadeDeleteReport, String> {
    crate::require_authenticated(&role_state)?;
    let src = resolve_source_db_path(&app, archive_at.as_deref())?;
    let vdb = resolve_vec_db_path(&app, archive_at.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let archive_lock = crate::ollama_db::get_db_lock_for(&vdb);
        let _g = archive_lock
            .lock()
            .map_err(|e| format!("DB kilit hatası: {}", e))?;
        purge_orphans(&src, &vdb)
    })
    .await
    .map_err(|e| format!("İş parçacığı hatası: {}", e))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vec_db::fixtures::{make_v249_db, DbProfile};
    use crate::vec_db::{
        apply_embeddings, migrate_asset_relations, migrate_embeddings,
        migrate_text_chunks, vec_count, EmbeddingRow,
    };

    #[test]
    fn rollback_restores_main_and_deletes_vec_db() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("archivist_vec.db");
        let bak = tmp.path().join("archivist_premigrate_v3.db.bak");
        // main = 5 asset; bak = migrasyon-öncesi anlık (boş profil)
        make_v249_db(&main, DbProfile::Sized(5)).unwrap();
        make_v249_db(&bak, DbProfile::Empty).unwrap();
        migrate_embeddings(&main, &vdb, 100).unwrap();
        assert!(vdb.exists() && vec_count(&vdb, "embeddings").unwrap() == 10);

        let rep = rollback(&main, &vdb, &bak).unwrap();
        assert!(rep.main_restored && rep.vec_db_deleted);
        assert!(!vdb.exists(), "vec.db silinmeli");
        // main artık bak (boş) ile aynı → assets 0
        let restored = rusqlite::Connection::open(&main).unwrap();
        let n: i64 = restored
            .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "ana DB premigrate yedeğe döndü");
    }

    #[test]
    fn premigrate_backup_then_rollback_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("archivist_vec.db");
        let bak = tmp.path().join("archivist_premigrate_v3.db.bak");
        make_v249_db(&main, DbProfile::Sized(6)).unwrap();

        // Premigrate yedek = ana DB ile BİREBİR.
        let len = premigrate_backup(&main, &bak).unwrap();
        assert!(bak.exists());
        assert_eq!(std::fs::read(&main).unwrap(), std::fs::read(&bak).unwrap());
        assert_eq!(len as usize, std::fs::read(&main).unwrap().len());

        // Migrasyon + cutover sonrası main'in DEĞİŞTİĞİNİ simüle et:
        // dosyayı clobber et (make_v249_db tekrar çağrılamaz — fixture
        // `CREATE TABLE` IF NOT EXISTS değil; ayrıca gerçek senaryo da
        // "main artık farklı" demek). rollback bak'tan geri yüklemeli.
        migrate_embeddings(&main, &vdb, 100).unwrap();
        std::fs::write(&main, b"clobbered-after-migration").unwrap();

        // verify FAIL senaryosu → rollback premigrate yedekten geri yükler.
        let rep = rollback(&main, &vdb, &bak).unwrap();
        assert!(rep.main_restored);
        let c = rusqlite::Connection::open(&main).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 6, "premigrate yedek sayesinde 6 asset geri geldi");
    }

    #[test]
    fn premigrate_backup_missing_main_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let err = premigrate_backup(
            &tmp.path().join("yok.db"),
            &tmp.path().join("x_premigrate_v3.db.bak"),
        )
        .unwrap_err();
        assert!(err.contains("ana DB yok"));
    }

    #[test]
    fn rollback_without_backup_errors_and_preserves_vec_db() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("archivist_vec.db");
        let bak = tmp.path().join("yok_premigrate_v3.db.bak");
        make_v249_db(&main, DbProfile::Sized(3)).unwrap();
        migrate_embeddings(&main, &vdb, 100).unwrap();

        let err = rollback(&main, &vdb, &bak).unwrap_err();
        assert!(err.contains("premigrate yedek yok"));
        assert!(vdb.exists(), "yedek yokken vec.db KORUNMALI (güvenli durdurma)");
    }

    #[test]
    fn purge_orphans_removes_only_unreferenced_assets() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("archivist_vec.db");
        // Kaynak: asset-0..2 canlı. 3 tabloyu da taşı.
        make_v249_db(&src, DbProfile::Sized(3)).unwrap();
        migrate_embeddings(&src, &vdb, 100).unwrap();
        migrate_text_chunks(&src, &vdb, 100).unwrap();
        migrate_asset_relations(&src, &vdb, 100).unwrap();
        let live_emb = vec_count(&vdb, "embeddings").unwrap();
        // Orphan ekle: kaynakta olmayan 'ghost' asset'e embedding
        apply_embeddings(
            &vdb,
            &[EmbeddingRow {
                id: "ghost_e".into(),
                asset_id: "ghost".into(),
                ref_id: Some("ghost_c0".into()),
                vector_blob: vec![0u8; 1536],
                source: "chunk_text".into(),
            }],
        )
        .unwrap();
        assert_eq!(vec_count(&vdb, "embeddings").unwrap(), live_emb + 1);

        let rep = purge_orphans(&src, &vdb).unwrap();
        assert_eq!(rep.embeddings_deleted, 1, "yalnız ghost silindi");
        assert_eq!(
            vec_count(&vdb, "embeddings").unwrap(),
            live_emb,
            "canlı asset'lerin satırları korundu"
        );
        // İdempotent: ikinci çağrı 0 siler
        let rep2 = purge_orphans(&src, &vdb).unwrap();
        assert_eq!(rep2.embeddings_deleted, 0);
    }

    #[test]
    fn finalize_drops_v3_tables_vacuums_and_sets_epoch() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("archivist.db");
        make_v249_db(&main, DbProfile::Sized(30)).unwrap();
        let before = std::fs::metadata(&main).unwrap().len();

        let new_size = finalize_main_migration(&main).unwrap();

        let c = rusqlite::Connection::open(&main).unwrap();
        let epoch: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(epoch, 3, "user_version finalize sonrası 3 olmalı");
        for t in ["embeddings", "text_chunks", "asset_relations"] {
            let n: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [t],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 0, "{} tablosu DROP edilmeli", t);
        }
        let assets: i64 = c
            .query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0))
            .unwrap();
        assert_eq!(assets, 30, "assets korunmalı");
        // VACUUM sonrası dosya büyümemeli (genelde küçülür).
        assert_eq!(new_size, std::fs::metadata(&main).unwrap().len());
        assert!(new_size <= before, "finalize dosyayı büyütmemeli");
    }

    #[test]
    fn finalize_idempotent_on_already_migrated_db() {
        let tmp = tempfile::tempdir().unwrap();
        let main = tmp.path().join("archivist.db");
        make_v249_db(&main, DbProfile::Sized(10)).unwrap();
        finalize_main_migration(&main).unwrap();
        // İkinci çağrı: tablolar zaten yok (DROP IF EXISTS) → hata YOK, epoch 3.
        finalize_main_migration(&main).unwrap();
        let c = rusqlite::Connection::open(&main).unwrap();
        let epoch: i64 = c
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(epoch, 3);
    }

    #[test]
    fn finalize_missing_main_errors() {
        let tmp = tempfile::tempdir().unwrap();
        let err = finalize_main_migration(&tmp.path().join("yok.db")).unwrap_err();
        assert!(err.contains("ana DB yok"));
    }
}
