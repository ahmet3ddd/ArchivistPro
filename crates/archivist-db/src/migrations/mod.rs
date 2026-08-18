//! Versiyonlu, ileri-yonlu, idempotent migration runner.
//!
//! Tasarim (data-migration ajani kurallari):
//! - **Versiyonlu + ileri-yonlu:** her sema degisikligi artan numarali bir
//!   migration; gecmis migration'lar asla duzenlenmez/yeniden numaralandirilmaz.
//! - **Transactional:** her migration kendi TX'inde uygulanir; hata → rollback,
//!   `user_version` ilerlemez (kismi-uygulama imkansiz).
//! - **Idempotent:** tum migration'lar uygulanmissa tekrar kosmak no-op.
//! - **Denetlenebilir:** `schema_migrations` tablosu (versiyon/ad/zaman) audit izi.
//!
//! Mevcut sema versiyonu `PRAGMA user_version`'da tutulur (DB header'inda,
//! transactional). Bekleyen migration = `version > user_version`.

use crate::error::DbError;
use rusqlite::Connection;

/// Tek bir sema migration'i. `sql` derleme-zamani gomulur (`include_str!`).
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub sql: &'static str,
}

/// Tum migration'lar — **versiyon sirasinda, artan, benzersiz.**
pub const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        name: "initial_schema",
        sql: include_str!("sql/0001_initial.sql"),
    },
    Migration {
        version: 2,
        name: "asset_metadata",
        sql: include_str!("sql/0002_asset_metadata.sql"),
    },
    Migration {
        version: 3,
        name: "asset_thumbnails",
        sql: include_str!("sql/0003_asset_thumbnails.sql"),
    },
    Migration {
        version: 4,
        name: "tags_favorites",
        sql: include_str!("sql/0004_tags_favorites.sql"),
    },
    Migration {
        version: 5,
        name: "collections",
        sql: include_str!("sql/0005_collections.sql"),
    },
    Migration {
        version: 6,
        name: "users",
        sql: include_str!("sql/0006_users.sql"),
    },
    Migration {
        version: 7,
        name: "soft_delete",
        sql: include_str!("sql/0007_soft_delete.sql"),
    },
    Migration {
        version: 8,
        name: "project_status",
        sql: include_str!("sql/0008_project_status.sql"),
    },
    Migration {
        version: 9,
        name: "vector_dim",
        sql: include_str!("sql/0009_vector_dim.sql"),
    },
    Migration {
        version: 10,
        name: "image_vectors",
        sql: include_str!("sql/0010_image_vectors.sql"),
    },
    Migration {
        version: 11,
        name: "text_chunks",
        sql: include_str!("sql/0011_text_chunks.sql"),
    },
    Migration {
        version: 12,
        name: "rag_exclude",
        sql: include_str!("sql/0012_rag_exclude.sql"),
    },
    Migration {
        version: 13,
        name: "audit_log",
        sql: include_str!("sql/0013_audit_log.sql"),
    },
    Migration {
        version: 14,
        name: "index_skips",
        sql: include_str!("sql/0014_index_skips.sql"),
    },
    Migration {
        version: 15,
        name: "asset_shapes",
        sql: include_str!("sql/0015_asset_shapes.sql"),
    },
    Migration {
        version: 16,
        name: "undo_ops",
        sql: include_str!("sql/0016_undo_ops.sql"),
    },
    Migration {
        version: 17,
        name: "scan_reports",
        sql: include_str!("sql/0017_scan_reports.sql"),
    },
    Migration {
        version: 18,
        name: "scan_reports_skipped",
        sql: include_str!("sql/0018_scan_reports_skipped.sql"),
    },
    Migration {
        version: 19,
        name: "projects",
        sql: include_str!("sql/0019_projects.sql"),
    },
    Migration {
        version: 20,
        name: "scanned_roots",
        sql: include_str!("sql/0020_scanned_roots.sql"),
    },
    Migration {
        version: 21,
        name: "assets_fts_ai",
        sql: include_str!("sql/0021_assets_fts_ai.sql"),
    },
    Migration {
        version: 22,
        name: "image_region_vectors",
        sql: include_str!("sql/0022_image_region_vectors.sql"),
    },
    Migration {
        version: 23,
        name: "chat_sessions",
        sql: include_str!("sql/0023_chat_sessions.sql"),
    },
    Migration {
        version: 24,
        name: "chat_soft_delete",
        sql: include_str!("sql/0024_chat_soft_delete.sql"),
    },
    Migration {
        version: 25,
        name: "notifications",
        sql: include_str!("sql/0025_notifications.sql"),
    },
    Migration {
        version: 26,
        name: "chat_session_source",
        sql: include_str!("sql/0026_chat_session_source.sql"),
    },
    Migration {
        version: 27,
        name: "metadata_scale_software_cleanup",
        sql: include_str!("sql/0027_metadata_scale_software_cleanup.sql"),
    },
    Migration {
        version: 28,
        name: "founder_messages",
        sql: include_str!("sql/0028_founder_messages.sql"),
    },
    Migration {
        version: 29,
        name: "local_archives",
        sql: include_str!("sql/0029_local_archives.sql"),
    },
    Migration {
        version: 30,
        name: "approval_log",
        sql: include_str!("sql/0030_approval_log.sql"),
    },
    Migration {
        version: 31,
        name: "chat_session_owner",
        sql: include_str!("sql/0031_chat_session_owner.sql"),
    },
    Migration {
        version: 32,
        name: "assets_fts_au_scoped",
        sql: include_str!("sql/0032_assets_fts_au_scoped.sql"),
    },
    Migration {
        version: 33,
        name: "text_chunks_rules_version",
        sql: include_str!("sql/0033_text_chunks_rules_version.sql"),
    },
];

/// Bir `run()` cagrisinin sonucu — handoff/STATUS icin dogrulama kaniti.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct MigrationReport {
    pub from_version: i64,
    pub to_version: i64,
    pub applied: Vec<i64>,
}

fn current_version(conn: &Connection) -> Result<i64, DbError> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

fn ensure_meta(conn: &Connection) -> Result<(), DbError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            applied_at INTEGER NOT NULL
         );",
    )?;
    Ok(())
}

/// MIGRATIONS dizisinin gelistirme-zamani saglamasi: artan + benzersiz versiyon.
/// Yanlis siralanmis/duplike versiyon bir programlama hatasidir; erken yakala.
fn validate_sequence() -> Result<(), DbError> {
    for w in MIGRATIONS.windows(2) {
        if w[0].version >= w[1].version {
            return Err(DbError::Migration(format!(
                "migration versiyonlari artan ve benzersiz olmali: {} >= {}",
                w[0].version, w[1].version
            )));
        }
    }
    Ok(())
}

/// Tum bekleyen migration'lari uygular. Idempotent: bekleyen yoksa no-op.
pub fn run(conn: &mut Connection) -> Result<MigrationReport, DbError> {
    validate_sequence()?;
    ensure_meta(conn)?;

    let from = current_version(conn)?;
    let mut report = MigrationReport {
        from_version: from,
        to_version: from,
        applied: Vec::new(),
    };

    for m in MIGRATIONS.iter().filter(|m| m.version > from) {
        let tx = conn.transaction()?;
        tx.execute_batch(m.sql).map_err(|e| {
            DbError::Migration(format!("v{} ({}) uygulanamadi: {e}", m.version, m.name))
        })?;
        tx.execute(
            "INSERT INTO schema_migrations(version, name, applied_at)
             VALUES (?1, ?2, strftime('%s','now'))",
            rusqlite::params![m.version, m.name],
        )?;
        // user_version literal almali (parametrelenmez) → guvenli i64.
        tx.execute_batch(&format!("PRAGMA user_version = {};", m.version))?;
        tx.commit()?;

        report.applied.push(m.version);
        report.to_version = m.version;
    }

    Ok(report)
}
