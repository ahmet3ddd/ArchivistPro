//! **H2 → H3 kayipsiz veri aktarimi** (kullanici karari 2026-08-10; onceki
//! "goc araci yazilmaz" hukmunun tersine donusu icin bkz `docs/MIGRATION_PLAN.md`).
//!
//! Uc asamali akis — hicbiri atlanamaz:
//! 1. **Envanter**: H2 DB'sini `mode=ro` acar, ne var ne yok SAYAR. 2026-07-16
//!    "kuratorlu veri yok" olcumunu her makinede yeniden uretir; bos cikarsa UI soyler.
//! 2. **Kuru kosu**: H2 + H3'u okuyup NE YAPILACAGINI planlar — hicbir yazma yok.
//! 3. **Uygula**: plani H3 yazicilariyla isler; yazici-basi kucuk TX + idempotent devam.
//!    Tam geri-donus garantisi cagiranin aldigi pre-import yedektir.
//!
//! **Model: TAM AKTARIM.** Her H2 kaydi tasinir — diskte artik olmayanlar dahil;
//! H2 copu H3 copune eslenir. Anahtar `assets.path` upsert'idir; H3'te var olan satir
//! KAZANIR (dokunulmaz), olmayan H2 kaydi yeni satir olarak yazilir.
//!
//! ⚠️ **`Db::ingest` BILEREK kullanilmaz** (olculdu): ingest `indexed_at=now` yazar ve
//! artimsal tarayici "indexed + boyut/mtime ayni" dosyayi ATLAR (write.rs:106 +
//! prepare.rs:121-127) → import edilen kayitlar sonsuza dek gercek taramadan kacardi
//! (BLAKE3 yok, cikarim yok, H2'nin dusuk-kalite thumbnail'i kalici olurdu). Bunun yerine
//! archivist-db'nin import-primitifleri (`import_h2_asset` vb.) `indexed_at = NULL` birakir →
//! ilk gercek tarama dosyayi dogal olarak devralir.
//!
//! **Kayipsiz'in durust siniri:** content_hash (SHA-256≠BLAKE3), phash (TEXT≠INTEGER),
//! embedding/chunk/shape (turev — H3 yeniden uretir) TASINMAZ ama KAYIP DEGILDIR;
//! kullanici parolalari (PBKDF2≠argon2id) TASINAMAZ ve raporlanir.

mod discovery;
mod engine;
mod h2read;
mod inventory;
mod map;
mod pathkey;
mod report;
mod time;

pub use discovery::{
    discover_candidates, is_archive_db, parse_h2_config, H2CandidateDb, H2Config, H2ExtraArchive,
};
pub use engine::{apply, dry_run, ImportOptions};
pub use h2read::{H2Asset, H2Source, H2UserBrief};
pub use inventory::{inventory, H2Inventory};
pub use pathkey::{canonical_path_key, fold_name, normalize_h2_path};
pub use report::{H2ImportReport, ImportProgress, REPORT_MAX_ENTRIES};
pub use time::parse_h2_timestamp;

/// Aktarim hatalari. Siniflandirma komut katmaninda yapilir
/// (or. `Locked` → UI "H2'yi kapatip yeniden deneyin").
#[derive(Debug, thiserror::Error)]
pub enum H2ImportError {
    #[error("H2 veritabani acilamadi: {0}")]
    Open(String),
    /// `<db>.lock` yandas dosyasi var — H2 calisiyor olabilir.
    #[error("H2 kilit dosyasi mevcut: {0}")]
    Locked(String),
    #[error("gecersiz H2 config: {0}")]
    Config(String),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Db(#[from] archivist_db::DbError),
}
