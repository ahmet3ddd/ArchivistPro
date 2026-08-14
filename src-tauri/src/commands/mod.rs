//! Tipli Tauri komut/sorgu kontrati (ARCHITECTURE.md "TAURI IPC" katmani).
//!
//! Renderer DB'yi gormez; yalniz bu komutlari cagirir. Gercek yetki burada
//! (runtime RBAC) zorlanir.
//!
//! Dizin-modulu (saf refactor, ~500 satir kurali): alan-bazli alt moduller +
//! `pub use ...::*` yeniden-disari-aktarimi — `commands::<fn>` dis yollari AYNEN
//! korunur, `lib.rs` `generate_handler![commands::x]` kaydi degismez.

// SECURITY (Faz 6 / auth — B1 COZULDU): Yazma komutlari rolu artik istemci
// argumanindan DEGIL, sunucu-tarafi kimlik-dogrulanmis oturumdan alir
// (`rbac::current_role(&state)` → `AppState.session`). Oturum yoksa "kimlik
// dogrulanmadi" ile reddedilir; istemci rol secemez. Bkz auth_commands.rs, STATUS "B1".

mod assets;
mod curation;
mod facets;
mod health;
mod ingest;
mod project;
mod roots;
mod trash;

pub use assets::*;
pub use curation::*;
pub use facets::*;
pub use health::*;
pub use ingest::*;
pub use project::*;
pub use roots::*;
pub use trash::*;

/// Alt modullerin yetki-GATE testleri icin ortak kurulum (yalniz test derlemesi).
#[cfg(test)]
pub(crate) mod test_support {
    use crate::rbac::{Role, Session};
    use crate::AppState;
    use std::sync::Mutex;

    /// Test icin gercek (bellek-ici) AppState — oturum None baslar.
    /// `#[tauri::command]` fonksiyonlari `State<'_, AppState>` (testte kurulamaz) aldigi
    /// icin auth_commands.rs deseniyle yetki GATE'i (oturum rolu → require_X) dogrulanir.
    pub(crate) fn test_state() -> AppState {
        AppState {
            db: Mutex::new(archivist_db::Db::open_in_memory_migrated().unwrap()),
            // Testte okuma komutlari cagrilmaz (yalniz yazma-gate testleri) → ayri bos in-memory
            // read_db zararsiz. (Uretimde ayni dosyaya baglanir; bkz AppState.read_db dokumani.)
            read_db: Mutex::new(archivist_db::Db::open_in_memory_migrated().unwrap()),
            db_path: std::path::PathBuf::from("archivist.db"),
            active_archive: Mutex::new(crate::ArchiveHandle {
                id: archivist_db::MAIN_ARCHIVE_ID.to_string(),
                db_path: std::path::PathBuf::from("archivist.db"),
            }),
            registry: archivist_extract::Registry::new(),
            session: Mutex::new(None),
            embedder: std::sync::Arc::new(Mutex::new(None)),
            image_embedder: Mutex::new(None),
            startup_recovery: crate::recovery::RecoveryInfo::healthy(),
            ollama_translate_fail_ms: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub(crate) fn set_role(state: &AppState, role: Role) {
        *state.session.lock().unwrap() =
            Some(Session {
                user_id: 1,
                username: "u".into(),
                role,
                is_founder: false,
                must_change: false,
            });
    }
}
