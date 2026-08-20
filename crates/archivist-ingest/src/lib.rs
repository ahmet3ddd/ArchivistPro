//! archivist-ingest — Arsiv-H3 ingest hatti.
//!
//! Klasor tara → BLAKE3 fixity → `Registry.extract` → `Db::ingest`. **Senkron + artimsal**
//! (degismeyen dosyalar atlanir). ARCHITECTURE.md `archivist-jobs` (kalici/resumable
//! kuyruk) hedefinin cekirdegi; kuyruk/paralel/resume sonraki kesit.
//!
//! Tek-motor sahipligi korunur: DB yazimi `archivist-db` icindedir; bu crate yalniz
//! orkestrasyon (tara + hash + extract cagir + tipli yazma cagrisi).

pub mod hash;
pub mod mime;
pub mod pipeline;
pub mod registry;
pub mod scan;
pub mod staleness;

pub use pipeline::{
    ingest_folder, ingest_folder_with_progress, ingest_folders_with_progress, reindex_paths,
    reindex_paths_with, reindex_write, IngestMode, IngestOpts, IngestProgress, IngestReport,
    ReindexPrep, ReindexReport, REPORT_MAX_ENTRIES,
};
pub use registry::build_registry;
pub use staleness::{
    check_fixity, check_office_formats, check_staleness, check_staleness_rows, FixityItem,
    FixityKind, FixityReport,
    OfficeFormatItem, OfficeFormatKind, OfficeFormatReport, StaleItem, StaleKind, StaleStatus,
    StalenessReport,
};

/// ODA (DWG→DXF) es-zamanlilik ust sinirini ayarla — Ayarlar'daki ODA knob'unun backend girisi.
/// Her tarama basinda cagrilir (makine-yerel deger; gecerli araliga kelepcelenir). Bu crate ODA
/// kapisini iceren `archivist-extract-cad`'e zaten bagimli (bkz [`build_registry`]) → src-tauri
/// bunu ingest facade'i uzerinden cagirir, cad'e DOGRUDAN dep eklemeden.
pub fn set_oda_concurrency(n: usize) {
    archivist_extract_cad::oda::set_max_concurrent(n);
}
