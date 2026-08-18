//! archivist-db — Arsiv-H3 native SQLite veri katmani.
//!
//! Cekirdek ilkeler (docs/ARCHITECTURE.md):
//! 1. **Rust veriyi sahiplenir** — DB'yi yalniz Rust acar/yazar (tek motor sahipligi).
//!    Renderer DB'yi asla bellekte tutmaz; tipli sayfali sorgu API'siyle okur.
//! 2. **Migration 1. gunden** — versiyonlu, ileri-yonlu, test'li framework.
//! 3. **Tek dosya, native SQLite** — FTS5 (anahtar-kelime) + sqlite-vec (vektor)
//!    ayni DB icinde, transactional. Heap limiti yok; epoch-migration destani dogmaz.
//!
//! H2'nin "iki motor (sql.js ↔ rusqlite) carpismasi → kismi bozulma" sinifi
//! burada yapisal olarak imkansizdir.

pub mod approval_log;
pub mod audit;
pub mod ai_index;
pub mod auth;
pub mod backup;
pub mod chat;
pub mod chunk;
pub mod connection;
pub mod curation;
pub mod dashboard;
pub mod dedup;
pub mod error;
pub mod extract;
pub mod health;
pub mod image;
pub mod image_kind;
pub mod import_h2;
pub mod index_skips;
pub mod local_archives;
pub mod merge;
pub mod messages;
pub mod meta;
pub mod migrations;
pub mod notifications;
pub mod organize;
pub mod portable;
pub mod projects;
pub mod query;
pub mod query_expand;
pub mod rag;
pub mod refile;
pub mod relations;
pub mod scan_reports;
pub mod scanned_roots;
pub mod search;
pub mod semantic;
pub mod shape;
pub mod trash;
pub mod undo;
pub mod write;

pub use approval_log::ApprovalLogRow;
pub use audit::{AuditInput, AuditRow};
pub use ai_index::AiIndexResetReport;
pub use auth::{UserAuth, UserRef};
pub use chat::{ChatMessage, ChatSession};
pub use chunk::{
    chunk_text, normalize_for_chunking, AssetChunk, ChunkWrite, PendingChunk, CHUNK_RULES_VERSION,
    DEFAULT_CHUNK_WORDS, DEFAULT_OVERLAP_WORDS, META_CHUNK_INDEX,
};
pub use connection::{open, open_in_memory};
pub use dashboard::{ActivityCount, ActivitySummary, DashboardStats, ExtSize, MonthCount};
pub use dedup::{DupGroup, DupKind, DupMember};
pub use error::DbError;
pub use merge::{MergeDisposition, MergePreview, MergeReport};
pub use messages::{UserMessage, USER_MESSAGE_MAX_BODY_CHARS};
pub use migrations::{run as run_migrations, Migration, MigrationReport, MIGRATIONS};
pub use local_archives::{LocalArchiveRow, MAIN_ARCHIVE_ID};
pub use notifications::NotificationRow;
pub use organize::{
    approval_folder, ensure_trailing_sep, relative_segments_for, AssetClass, Structure,
};
pub use portable::RootStat;
pub use projects::{project_name_from_path, AutoProjectReport, ProjectInput, ProjectRow};
pub use query::{
    AssetDetail, AssetFsMeta, AssetPage, AssetRow, AssetSort, AssignedProject, CollectionRef,
    DominantColor, Facet, FolderSummary, ListOpts, MatchSource, MetaEntry, MetaFilter,
    ProjectMetaOut, TagRef, ThumbnailData, DOMINANT_COLORS_METADATA_KEY,
};
pub use image::{
    AnalysisScope, PendingAnalysis, PendingImageEmbed, AI_ATTEMPT_FAILED_KEY, IMAGE_EMBED_DIM,
    IMAGE_REGION_COUNT, IMAGE_REGION_STRIDE,
};
pub use image_kind::{classify_image_kind, is_raster_image_ext, ImageKind, RASTER_IMAGE_EXTS};
pub use index_skips::IndexStage;
pub use rag::{normalize_tr, session_title, significant_tokens, ChunkHit, RetrieveDiag};
pub use refile::RefileError;
pub use relations::{DetectRelationsReport, RelationRow};
pub use scan_reports::{
    ScanReportDetail, ScanReportInput, ScanReportSummary, SCAN_REPORT_RETENTION,
};
pub use scanned_roots::{RootGroupRow, RootTag, ScannedRootRow};
pub use semantic::{PendingEmbed, TEXT_EMBED_DIM};
pub use shape::{
    categorize_layer, compute_shape_similarity, ShapeCriteria, ShapeHit, ShapeInput, ShapeQuery,
};
pub use undo::{UndoOpFull, UndoOpRow, UNDO_RETENTION};
pub use write::{
    AssetInput, Fingerprint, IngestData, MetaVal, ProjectMeta, ProjectMetaPatch, ThumbnailInput,
};

use rusqlite::Connection;
use std::path::Path;

/// IPC/Tauri katmaninin tutacagi **opak DB tutamaci.**
///
/// rusqlite detayini ust katmanlara sizdirmaz: kabuk yalniz bu yuksek-seviye
/// API'yi gorur (tek motor sahipligi ilkesini API duzeyinde de uygular).
pub struct Db {
    conn: Connection,
}

impl Db {
    /// Dosya tabanli DB ac + tum bekleyen migration'lari uygula.
    pub fn open_and_migrate(path: &Path) -> Result<Self, DbError> {
        let mut conn = connection::open(path)?;
        migrations::run(&mut conn)?;
        Ok(Self { conn })
    }

    /// Bellek-ici, migrate edilmis DB (testler/gecici kullanim).
    pub fn open_in_memory_migrated() -> Result<Self, DbError> {
        let mut conn = connection::open_in_memory()?;
        migrations::run(&mut conn)?;
        Ok(Self { conn })
    }

    /// **Salt-okuma** DB tutamaci — ayni dosyayi acar, `PRAGMA query_only=ON` ile YAZIMI reddeder.
    ///
    /// Amac (donma fix'i): bir YAZMA-baglantisi (or. `ingest_folder`) tarama boyu `Mutex<Db>`'yi
    /// kilitlerken, gezinme/arama/facet gibi OKUMA komutlari AYRI bu baglanti uzerinden kosar →
    /// yerel diskte WAL sayesinde **eszamanli okuyucu** (yazicidan bloke OLMAZ). Migrate ETMEZ
    /// (yazma-baglantisi zaten en son semaya gunceller; salt-okuma migrate edemez zaten).
    /// `query_only` yalniz SQL-duzeyinde yazimi engeller (baglanti WAL -shm'ye erisebilir →
    /// `SQLITE_OPEN_READ_ONLY`'nin WAL-shm sorunu YOK). Yanlislikla bu tutamaca yazma → aninda hata.
    pub fn open_readonly(path: &Path) -> Result<Self, DbError> {
        let conn = connection::open(path)?;
        conn.pragma_update(None, "query_only", "ON")?;
        Ok(Self { conn })
    }

    /// Aktif sema versiyonu (`PRAGMA user_version`).
    pub fn schema_version(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
    }

    /// Veritabani butunlugu saglam mi?
    pub fn integrity_ok(&self) -> Result<bool, DbError> {
        health::integrity_ok(&self.conn)
    }

    /// Yetim satir sayisi (Doctor cekirdegi).
    pub fn orphan_count(&self) -> Result<i64, DbError> {
        health::orphan_count(&self.conn)
    }

    /// Yetim satirlari temizle (Doctor onarim) — silinen sayisini doner. `orphan_count` ile ayni
    /// 7 kaynak (5 asset-duzeyi + chunk_vectors/chunk_fts; tutarli). Tek TX (atomik).
    pub fn purge_orphans(&mut self) -> Result<u64, DbError> {
        health::purge_orphans(&mut self.conn)
    }

    /// Kayitli **aktif** asset sayisi. §O: cop'teki (soft-delete) asset'ler sayilmaz
    /// (`deleted_at IS NULL`) — saglik/Doctor sayimi aktif arsivi yansitir. Cop sayisi
    /// ayri `trash_count()` ile alinir.
    pub fn asset_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM assets WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?)
    }

    /// Alt-katman fonksiyonlari icin ham baglantiya (yalniz okuma amacli) erisim.
    /// Ust katmanlar bunu kullanmaz; crate-ici/test koprusudur.
    pub fn connection(&self) -> &Connection {
        &self.conn
    }
}

/// Uygulama girisi (serbest fonksiyon biçimi): baglanti ac + migrate et.
pub fn open_and_migrate(path: &Path) -> Result<Connection, DbError> {
    let mut conn = connection::open(path)?;
    migrations::run(&mut conn)?;
    Ok(conn)
}
