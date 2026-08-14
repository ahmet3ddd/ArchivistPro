//! Ana admin'e tek yonlu yerel oneriler icin Tauri komutlari.
//!
//! Alici UI/IPC parametresi degildir: gonderim DB'deki tek founder'a gider. Gelen
//! kutusu, okuma ve tamamlama ise normal admin degil yalniz founder oturumunda acilir.

use serde::Serialize;
use tauri::State;

use crate::rbac;
use crate::AppState;

/// Renderer'a donen onerinin camelCase IPC bicimi.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMessageDto {
    pub id: i64,
    pub sender_id: Option<i64>,
    pub sender_username: String,
    pub recipient_id: i64,
    pub body: String,
    pub created_at: i64,
    pub read_at: Option<i64>,
    pub resolved_at: Option<i64>,
    pub resolved_by: Option<i64>,
}

impl From<archivist_db::UserMessage> for UserMessageDto {
    fn from(message: archivist_db::UserMessage) -> Self {
        Self {
            id: message.id,
            sender_id: message.sender_id,
            sender_username: message.sender_username,
            recipient_id: message.recipient_id,
            body: message.body,
            created_at: message.created_at,
            read_at: message.read_at,
            resolved_at: message.resolved_at,
            resolved_by: message.resolved_by,
        }
    }
}

fn authenticated_session(state: &AppState) -> Result<rbac::Session, String> {
    rbac::current_session(state).ok_or_else(|| "kimlik dogrulanmadi".to_string())
}

fn founder_session(state: &AppState) -> Result<rbac::Session, String> {
    let session = authenticated_session(state)?;
    rbac::require_founder(&session).map_err(|error| error.to_string())?;
    Ok(session)
}

/// Oturumdaki herhangi bir yerel kullanici ana admin'e bir oneriyi gonderir.
/// Alici parametresi yoktur; metin audit loga yazilmaz.
#[tauri::command(async)]
pub fn send_user_message(body: String, state: State<'_, AppState>) -> Result<UserMessageDto, String> {
    let session = authenticated_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|error| error.to_string())?;
    let message = db
        .send_user_message(session.user_id, &session.username, &body)
        .map_err(|error| error.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "user_message_send",
        Some("user_message"),
        Some(&message.id.to_string()),
        None,
    );
    Ok(message.into())
}

/// Ana adminin gelen onerileri (en yeni once). Normal/local admin bu veriyi okuyamaz.
#[tauri::command(async)]
pub fn list_received_user_messages(
    state: State<'_, AppState>,
) -> Result<Vec<UserMessageDto>, String> {
    let session = founder_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let db = state.db.lock().map_err(|error| error.to_string())?;
    db.list_received_user_messages(session.user_id, 200)
        .map(|messages| messages.into_iter().map(UserMessageDto::from).collect())
        .map_err(|error| error.to_string())
}

/// Ana adminin kendi gelen kutusundaki bir oneriyi okundu isaretlemesi.
#[tauri::command(async)]
pub fn mark_user_message_read(
    message_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = founder_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let db = state.db.lock().map_err(|error| error.to_string())?;
    db.mark_user_message_read(message_id, session.user_id)
        .map_err(|error| error.to_string())
}

/// Ana adminin bir oneriyi tamamlandi olarak kapatmasi. Yanit/konu olusturmaz.
#[tauri::command(async)]
pub fn resolve_user_message(
    message_id: i64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let session = founder_session(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|error| error.to_string())?;
    db.resolve_user_message(message_id, session.user_id)
        .map_err(|error| error.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "user_message_resolve",
        Some("user_message"),
        Some(&message_id.to_string()),
        None,
    );
    Ok(())
}
