//! Kalici cok-oturumlu sohbet komutlari (H2 chatStorage porti). H3'te sohbet bugune dek tamamen
//! bellekteydi (ChatView `useState<Turn[]>`) → kapaninca kayboluyordu; artik `archivist-db`
//! (chat_sessions + chat_messages) native SQLite'ta kalici.
//!
//! Renderer DB gormez; yalniz bu komutlari cagirir. DTO'lar camelCase serde (frontend
//! sozlesmesi): createdAt/updatedAt = **number (i64 epoch ms)**.
//!
//! ## Yetki modeli (v31'de DUZELTILDI)
//! Rol kapisi (`require_admin`/`require_editor`) YOKTUR — sohbet kisisel bir ozellik, her rol
//! kendi sohbetini yonetir. **Ama "kisisel" artik gercekten kisisel:** her komut oturumdaki
//! kullaniciyi bulur ve DB katmani TUM sorgulari o sahibe gore suzer.
//!
//! ⚠️ **Onceki hâl bir acikti** (2026-07-26, `rbac_coverage.rs` kurulurken bulundu): modul yorumu
//! "kisisel ozellik" diyordu ama `chat_sessions` semasinda sahip alani YOKTU ve listeleme
//! suzmuyordu → cok-kullanicili arsivde her rol (viewer dahil) baskasinin sohbetini gorur,
//! yeniden adlandirir, cope atar ve KALICI silerdi. Bkz `sql/0031_chat_session_owner.sql`.
//!
//! **Sahip IPC parametresi DEGILDIR** — daima oturumdan alinir (0028 `user_messages` +
//! `change_password` deseni): istemci baskasi adina yazamaz/okuyamaz. Oturum yoksa komut reddedilir.

use archivist_db::{ChatMessage, ChatSession};
use serde::Serialize;
use tauri::State;

use crate::rbac;
use crate::AppState;

/// Oturumdaki kullanicinin id'si — sohbet komutlarinin TEK sahiplik kaynagi.
/// (`message_commands::authenticated_session` deseni; rol bakilmaz — her rol kendi sohbetini yonetir.)
fn owner_id(state: &AppState) -> Result<i64, String> {
    rbac::current_session(state)
        .map(|s| s.user_id)
        .ok_or_else(|| "kimlik dogrulanmadi".to_string())
}

/// Sohbet oturumu DTO (frontend camelCase). scopeJson/model opsiyonel (null serbest).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatSessionDto {
    pub id: String,
    pub title: String,
    pub scope_json: Option<String>,
    pub model: Option<String>,
    /// epoch ms.
    pub created_at: i64,
    /// epoch ms.
    pub updated_at: i64,
    /// Cop-kutusu isareti (v24). null = AKTIF; sayi (epoch **ms**) = cop'te (soft-delete).
    pub deleted_at: Option<i64>,
    /// Oturumun konustugu arsiv (v26): `"local"` | `"remote"` — frontend `AssetSource` ile ayni.
    pub source: String,
    /// Uzak oturumda ana arsiv etiketi ("192.168.1.5:9471"); yerelde null.
    pub host_label: Option<String>,
}

impl From<ChatSession> for ChatSessionDto {
    fn from(s: ChatSession) -> Self {
        ChatSessionDto {
            id: s.id,
            title: s.title,
            scope_json: s.scope_json,
            model: s.model,
            created_at: s.created_at,
            updated_at: s.updated_at,
            deleted_at: s.deleted_at,
            source: s.source,
            host_label: s.host_label,
        }
    }
}

/// Sohbet mesaji DTO (frontend camelCase). citationsJson/tokensIn/tokensOut opsiyonel.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessageDto {
    pub id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub citations_json: Option<String>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    /// epoch ms.
    pub created_at: i64,
}

impl From<ChatMessage> for ChatMessageDto {
    fn from(m: ChatMessage) -> Self {
        ChatMessageDto {
            id: m.id,
            session_id: m.session_id,
            role: m.role,
            content: m.content,
            citations_json: m.citations_json,
            tokens_in: m.tokens_in,
            tokens_out: m.tokens_out,
            created_at: m.created_at,
        }
    }
}

/// Yeni sohbet oturumu olustur → olusan satir (frontend hemen aktif sohbet yapar).
///
/// `source` (v26): oturumun konustugu arsiv — `"local"` | `"remote"`. Taninmayan deger REDDEDILIR
/// (sessiz kabul, "yanlis dosya" hatasini geri getirirdi: kaynak etiketi guvenilmezse liste
/// suzmesi ve atif kapisi da guvenilmez olur). `host_label` yalniz uzakta anlamli.
#[tauri::command(async)]
pub fn chat_create_session(
    title: String,
    scope_json: Option<String>,
    model: Option<String>,
    source: String,
    host_label: Option<String>,
    state: State<'_, AppState>,
) -> Result<ChatSessionDto, String> {
    let user_id = owner_id(&state)?;
    create_session_inner(&state, user_id, &title, scope_json, model, source, host_label)
}

/// `chat_create_session`'in govdesi (test edilebilirlik — `login_inner` deseni; sahip cozumu
/// KOMUTTA kalir, nobetci `chat_commands_resolve_owner_from_session` onu orada arar).
///
/// EK ARSIV FK CAPASI (saha bulgusu 2026-08-13): kimlik ANA arsivde merkezidir → ek arsivin
/// `users` tablosu BOStur; 0031'in `user_id REFERENCES users(id)` FK'si oturum olusturmayi
/// dusuruyordu (frontend hatayi yutunca "sohbet kaydedilmiyor" gorunuyordu; birincil arsivde
/// calisiyordu). Ek arsivde once sahibin FK capasi garanti edilir. **Ana arsivde ASLA** — orada
/// `users` gercek kimliktir; kullanici satiri yoksa (or. oturum acikken silinmis) hata dogru
/// davranistir, capa onu MASKELERDI.
fn create_session_inner(
    state: &AppState,
    user_id: i64,
    title: &str,
    scope_json: Option<String>,
    model: Option<String>,
    source: String,
    host_label: Option<String>,
) -> Result<ChatSessionDto, String> {
    if source != "local" && source != "remote" {
        return Err(format!("gecersiz kaynak: {source}"));
    }
    let db = state.db.lock().map_err(|e| e.to_string())?;
    if !state.active_is_main() {
        db.ensure_chat_owner_anchor(user_id).map_err(|e| e.to_string())?;
    }
    db.create_chat_session(
        user_id,
        title,
        scope_json.as_deref(),
        model.as_deref(),
        &source,
        host_label.as_deref(),
    )
    .map(ChatSessionDto::from)
    .map_err(|e| e.to_string())
}

/// Oturumlari son-guncellenen ilk (updated_at DESC) listele. `limit <= 0` → 100.
#[tauri::command(async)]
pub fn chat_list_sessions(
    limit: i64,
    state: State<'_, AppState>,
) -> Result<Vec<ChatSessionDto>, String> {
    let user_id = owner_id(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.list_chat_sessions(user_id, limit)
        .map(|v| v.into_iter().map(ChatSessionDto::from).collect())
        .map_err(|e| e.to_string())
}

/// Oturumu cop kutusuna at (**soft-delete**; geri-alinabilir). Mesajlara dokunmaz → restore tam
/// geri getirir. Idempotent (zaten cop'te olanin damgasi degismez).
#[tauri::command(async)]
pub fn chat_delete_session(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let user_id = owner_id(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.delete_chat_session(user_id, &session_id).map_err(|e| e.to_string())
}

/// Oturum basligini degistir + updated_at tazele.
#[tauri::command(async)]
pub fn chat_rename_session(
    session_id: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let user_id = owner_id(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.rename_chat_session(user_id, &session_id, &title).map_err(|e| e.to_string())
}

/// Mesaj ekle + oturum updated_at tazele (tek TX) → olusan mesaj.
#[tauri::command(async)]
pub fn chat_append_message(
    session_id: String,
    role: String,
    content: String,
    citations_json: Option<String>,
    tokens_in: Option<i64>,
    tokens_out: Option<i64>,
    state: State<'_, AppState>,
) -> Result<ChatMessageDto, String> {
    let user_id = owner_id(&state)?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    db.append_chat_message(
        user_id,
        &session_id,
        &role,
        &content,
        citations_json.as_deref(),
        tokens_in,
        tokens_out,
    )
    .map(ChatMessageDto::from)
    .map_err(|e| e.to_string())
}

/// Oturum mesajlarini eskiden yeniye (created_at ASC) listele.
#[tauri::command(async)]
pub fn chat_list_messages(
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ChatMessageDto>, String> {
    let user_id = owner_id(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.list_chat_messages(user_id, &session_id)
        .map(|v| v.into_iter().map(ChatMessageDto::from).collect())
        .map_err(|e| e.to_string())
}

// ── Cop kutusu (soft-delete geri-al / kalici sil / cop listesi+sayimi) ────────
// Mevcut chat komut deseni: rol kapisi yok, **sahiplik kapisi var** (v31 — sahip oturumdan).
// `purge_confirm` UI'da yapilir; backend sahibi dogrulayip siler. ⚠️ Arg adi `id` (JS: `{ id }`) —
// frontend sabit sozlesmesiyle birebir (bkz src/ipc/chat-sessions.ts: invoke("chat_restore_session", { id })).

/// Oturumu cop kutusundan geri yukle (soft-delete geri-al; `deleted_at → NULL` → aktif liste).
#[tauri::command(async)]
pub fn chat_restore_session(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let user_id = owner_id(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.restore_chat_session(user_id, &id).map_err(|e| e.to_string())
}

/// Oturumu KALICI sil (**purge**; geri-alinamaz). Mesajlar FK CASCADE ile gider. UI onay ('purge
/// confirm') sonrasi cagrilir; backend dogrudan siler.
#[tauri::command(async)]
pub fn chat_purge_session(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let user_id = owner_id(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.purge_chat_session(user_id, &id).map_err(|e| e.to_string())
}

/// Cop kutusundaki oturumlar (en son atilan ilk; `deleted_at DESC`). `chat_list_sessions` ile ayni
/// `ChatSessionDto` sekli — cop gorunumu.
#[tauri::command(async)]
pub fn chat_list_trashed_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<ChatSessionDto>, String> {
    let user_id = owner_id(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.list_trashed_chat_sessions(user_id)
        .map(|v| v.into_iter().map(ChatSessionDto::from).collect())
        .map_err(|e| e.to_string())
}

/// Cop kutusundaki oturum sayisi (cop rozeti / onay metni). Salt-okuma.
#[tauri::command(async)]
pub fn chat_trash_count(state: State<'_, AppState>) -> Result<i64, String> {
    let user_id = owner_id(&state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?;
    db.chat_trash_count(user_id).map_err(|e| e.to_string())
}

// ── Markdown disa-aktarma (H2 chatExport pariti) ─────────────────────────────────────────────

/// Bir citation'in disa-aktarma icin gereken alt kumesi (`citations_json` = frontend'in
/// serilestirdigi `CitationDto[]`, camelCase). Yalniz baslikta gorunen alanlar cozulur.
#[derive(serde::Deserialize)]
struct ExportCitation {
    index: i64,
    #[serde(rename = "fileName")]
    file_name: String,
    #[serde(default)]
    page: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatExportLabels {
    date: String,
    model: String,
    scope: String,
    all_archive: String,
    custom_scope: String,
    user: String,
    assistant: String,
    sources: String,
    unknown: String,
    page_prefix: String,
    page_suffix: String,
}

/// Sohbet kapsamini (opak `scope_json`) insan-okur etikete cevir. Sema-bagimsiz: `kind`/`type`
/// alanina bakar — `all`/yok → "Tüm Arşiv", digeri → "Özel kapsam"; parse edilemezse "Tüm Arşiv".
fn scope_description(scope_json: Option<&str>, labels: &ChatExportLabels) -> String {
    let Some(s) = scope_json else {
        return labels.all_archive.clone();
    };
    match serde_json::from_str::<serde_json::Value>(s) {
        Ok(v) => match v
            .get("kind")
            .or_else(|| v.get("type"))
            .and_then(|k| k.as_str())
        {
            Some("all") | None => labels.all_archive.clone(),
            Some(_) => labels.custom_scope.clone(),
        },
        Err(_) => labels.all_archive.clone(),
    }
}

/// Tek mesaji Markdown'a cevir (H2 renderMessage pariti): `## Kullanıcı`/`## Asistan` + icerik +
/// (asistan + citation varsa) "**Kaynaklar:**" listesi. Bozuk citations_json → sessizce atlanir.
fn render_message(m: &ChatMessage, labels: &ChatExportLabels) -> String {
    let role = if m.role == "user" {
        &labels.user
    } else {
        &labels.assistant
    };
    let header = format!("## {role}");
    let mut out = format!("{header}\n\n{}", m.content);
    if m.role != "user" {
        if let Some(cits) = m
            .citations_json
            .as_deref()
            .and_then(|c| serde_json::from_str::<Vec<ExportCitation>>(c).ok())
        {
            if !cits.is_empty() {
                out.push_str(&format!("\n\n**{}:**", labels.sources));
                for c in &cits {
                    let page = c
                        .page
                        .map(|p| format!(" ({}{p}{})", labels.page_prefix, labels.page_suffix))
                        .unwrap_or_default();
                    out.push_str(&format!("\n- [{}] {}{page}", c.index, c.file_name));
                }
            }
        }
    }
    out
}

/// Oturum + mesajlar → Markdown (H2 `exportSessionToMarkdown` pariti). **system** mesajlari HARIC.
/// Saf/test-edilebilir: `date_str` cagiran tarafindan bicimlenir (SQLite strftime; chrono'suz).
fn format_chat_markdown(
    session: &ChatSession,
    date_str: &str,
    messages: &[ChatMessage],
    labels: &ChatExportLabels,
) -> String {
    let model = session.model.as_deref().unwrap_or(&labels.unknown);
    let scope = scope_description(session.scope_json.as_deref(), labels);
    let header = format!(
        "# {}\n\n**{}:** {date_str}\n**{}:** {model}\n**{}:** {scope}\n\n---\n\n",
        session.title, labels.date, labels.model, labels.scope
    );
    let body = messages
        .iter()
        .filter(|m| m.role != "system")
        .map(|message| render_message(message, labels))
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");
    format!("{header}{body}\n")
}

/// Bir sohbet oturumunu Markdown olarak `dest_path`'e yaz (H2 chatExport pariti). **Owner-scoped:**
/// yalniz sahibin AKTIF oturumu (yabanci/yok-olan/cop → "oturum bulunamadı"; sahiplik sizdirmaz).
/// Rust DB'den okur + bicimler + `std::fs::write` ile yazar (H3: veri Rust'ta). `dest_path` frontend
/// `save()` diyalogundan gelir. Rol gate YOK (kendi sohbetini disa aktarir; owner_id yeterli kapi).
#[tauri::command]
pub fn export_chat_markdown(
    session_id: String,
    dest_path: String,
    labels: ChatExportLabels,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let user_id = owner_id(&state)?;
    let db = state.read_db.lock().map_err(|e| e.to_string())?;
    let session = db
        .get_chat_session(user_id, &session_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "oturum bulunamadı".to_string())?;
    let messages = db.list_chat_messages(user_id, &session_id).map_err(|e| e.to_string())?;
    // Tarih: epoch ms → yerel "YYYY-MM-DD HH:MM" (SQLite strftime; chat.rs "chrono'suz" ilkesi).
    let date_str: String = db
        .connection()
        .query_row(
            "SELECT strftime('%Y-%m-%d %H:%M', ?1 / 1000, 'unixepoch', 'localtime')",
            [session.created_at],
            |r| r.get(0),
        )
        .unwrap_or_default();
    let md = format_chat_markdown(&session, &date_str, &messages, &labels);
    std::fs::write(&dest_path, md).map_err(|e| format!("dosya yazılamadı: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod create_session_tests {
    use super::*;
    use crate::commands::test_support::{set_role, test_state};
    use crate::rbac::Role;

    /// Aktif arsivi EK arsive cevir (users tablosu bos in-memory DB zaten ek-arsiv esdegeri:
    /// `create_local_archive` da bos+migre DB uretir; fark yalniz dosya yolu).
    fn switch_to_additional(state: &crate::AppState) {
        *state.active_archive.lock().unwrap() = crate::ArchiveHandle {
            id: "a1".to_string(),
            db_path: std::path::PathBuf::from("archives/a1/archive.db"),
        };
        assert!(!state.active_is_main());
    }

    /// Komutun kullandigi sahiplik kapisi: oturum yoksa `owner_id` reddeder (komut fn'i `State`
    /// aldigindan dogrudan cagrilamaz; kapinin kendisi sinanir — auth_commands deseni).
    #[test]
    fn owner_gate_rejects_without_login() {
        let state = test_state();
        assert!(owner_id(&state).is_err(), "oturumsuz owner_id reddetmeli");
    }

    /// SAHA BULGUSU (2026-08-13) regresyon kilidi: aktif arsiv EK (users BOS) + ana-arsiv
    /// kullanicisi → onceden FK ihlaliyle dusuyordu, frontend yutuyordu ("sohbet kaydedilmiyor").
    #[test]
    fn create_succeeds_in_additional_archive_via_anchor() {
        let state = test_state();
        set_role(&state, Role::Admin); // test_state DB'sinde users BOS (ek arsiv esdegeri)
        switch_to_additional(&state);
        let user_id = owner_id(&state).unwrap();

        let dto =
            create_session_inner(&state, user_id, "ek arsiv sohbeti", None, None, "local".into(), None)
                .expect("ek arsivde olusturma CAPA ile calismali");
        let listed = state.db.lock().unwrap().list_chat_sessions(user_id, 0).unwrap();
        assert_eq!(listed.len(), 1, "olusan oturum sahibin listesinde olmali");
        assert_eq!(listed[0].id, dto.id);
    }

    /// Ana arsivde capa ACILMAZ: gercek kullaniciyla olusturma calisir ve users'a satir EKLENMEZ.
    #[test]
    fn create_in_main_archive_uses_real_user_no_anchor() {
        let state = test_state();
        let uid =
            state.db.lock().unwrap().create_user("u", "admin", "pw-123456", false).unwrap();
        assert_eq!(uid, 1, "set_role user_id=1 varsayimi ilk kullaniciya oturmali");
        set_role(&state, Role::Admin);
        let user_id = owner_id(&state).unwrap();

        create_session_inner(&state, user_id, "ana arsiv sohbeti", None, None, "local".into(), None)
            .expect("ana arsivde gercek kullaniciyla olusturma calismali");
        let users: i64 = state
            .db
            .lock()
            .unwrap()
            .connection()
            .query_row("SELECT count(*) FROM users", [], |r| r.get(0))
            .unwrap();
        assert_eq!(users, 1, "ana arsivde CAPA satiri ACILMAMALI");
    }

    /// Ana arsivde kullanici satiri YOKSA hata AYNEN kalir (capa maskelemez) — kimlik butunlugu.
    #[test]
    fn create_in_main_archive_without_user_row_still_fails() {
        let state = test_state();
        set_role(&state, Role::Admin); // users tablosu bos AMA aktif arsiv ANA
        assert!(
            create_session_inner(&state, 1, "t", None, None, "local".into(), None).is_err(),
            "ana arsivde eksik kullanici satiri FK hatasi VERMELI (capa yalniz ek arsivde)"
        );
    }
}

#[cfg(test)]
mod export_tests {
    use super::*;

    fn labels() -> ChatExportLabels {
        ChatExportLabels {
            date: "Tarih".into(),
            model: "Model".into(),
            scope: "Kapsam".into(),
            all_archive: "Tüm Arşiv".into(),
            custom_scope: "Özel kapsam".into(),
            user: "Kullanıcı".into(),
            assistant: "Asistan".into(),
            sources: "Kaynaklar".into(),
            unknown: "Bilinmiyor".into(),
            page_prefix: "s.".into(),
            page_suffix: String::new(),
        }
    }

    fn msg(role: &str, content: &str, citations_json: Option<&str>) -> ChatMessage {
        ChatMessage {
            id: "m".into(),
            session_id: "s".into(),
            role: role.into(),
            content: content.into(),
            citations_json: citations_json.map(str::to_string),
            tokens_in: None,
            tokens_out: None,
            created_at: 0,
        }
    }

    fn session(title: &str, model: Option<&str>, scope_json: Option<&str>) -> ChatSession {
        ChatSession {
            id: "s".into(),
            title: title.into(),
            scope_json: scope_json.map(str::to_string),
            model: model.map(str::to_string),
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
            source: "local".into(),
            host_label: None,
            user_id: Some(1),
        }
    }

    #[test]
    fn scope_description_maps_kinds() {
        let labels = labels();
        assert_eq!(scope_description(None, &labels), "Tüm Arşiv");
        assert_eq!(
            scope_description(Some(r#"{"kind":"all"}"#), &labels),
            "Tüm Arşiv"
        );
        assert_eq!(
            scope_description(Some(r#"{"kind":"filter","ext":["pdf"]}"#), &labels),
            "Özel kapsam"
        );
        assert_eq!(
            scope_description(Some(r#"{"type":"project","value":"X"}"#), &labels),
            "Özel kapsam"
        );
        assert_eq!(scope_description(Some("bozuk json"), &labels), "Tüm Arşiv");
    }

    /// H2 exportSessionToMarkdown pariti: baslik (tarih/model/kapsam) + rol basliklari + icerik +
    /// asistan citation'lari; **system** mesaji HARIC.
    #[test]
    fn format_produces_h2_parity_markdown() {
        let s = session("Cami sohbeti", Some("qwen3:8b"), Some(r#"{"kind":"all"}"#));
        let msgs = vec![
            msg("system", "gizli sistem promptu", None),
            msg("user", "cami hangi dosyalarda var", None),
            msg(
                "assistant",
                "3 dosya bulundu",
                Some(
                    r#"[{"index":1,"assetId":5,"fileName":"cami.dwg","page":2},{"index":2,"assetId":6,"fileName":"minare.pdf","page":null}]"#,
                ),
            ),
        ];
        let md = format_chat_markdown(&s, "2026-07-27 14:30", &msgs, &labels());

        assert!(
            md.starts_with("# Cami sohbeti\n"),
            "baslik oturum adi: {md}"
        );
        assert!(md.contains("**Tarih:** 2026-07-27 14:30"));
        assert!(md.contains("**Model:** qwen3:8b"));
        assert!(md.contains("**Kapsam:** Tüm Arşiv"));
        assert!(md.contains("## Kullanıcı\n\ncami hangi dosyalarda var"));
        assert!(md.contains("## Asistan\n\n3 dosya bulundu"));
        assert!(md.contains("**Kaynaklar:**"));
        assert!(
            md.contains("- [1] cami.dwg (s.2)"),
            "sayfali citation: {md}"
        );
        assert!(md.contains("- [2] minare.pdf"), "sayfasiz citation: {md}");
        assert!(
            !md.contains("(s.null)") && !md.contains("minare.pdf (s."),
            "sayfasiz → parantez yok"
        );
        assert!(
            !md.contains("gizli sistem promptu"),
            "system mesaji HARIC olmali"
        );
    }

    /// Model yoksa "Bilinmiyor"; kullanici mesajinda (bozuk) citation → "**Kaynaklar:**" YOK.
    #[test]
    fn format_handles_missing_model_and_user_citations() {
        let s = session("Boş", None, None);
        let msgs = vec![msg(
            "user",
            "selam",
            Some(r#"[{"index":1,"fileName":"x"}]"#),
        )];
        let md = format_chat_markdown(&s, "d", &msgs, &labels());
        assert!(md.contains("**Model:** Bilinmiyor"));
        assert!(
            !md.contains("**Kaynaklar:**"),
            "kullanici mesajinda citation gosterilmez"
        );
    }

    #[test]
    fn format_uses_caller_language_labels() {
        let mut labels = labels();
        labels.date = "Date".into();
        labels.model = "Model".into();
        labels.scope = "Scope".into();
        labels.all_archive = "Entire archive".into();
        labels.user = "User".into();
        labels.assistant = "Assistant".into();
        labels.sources = "Sources".into();
        labels.unknown = "Unknown".into();
        labels.page_prefix = "p.".into();

        let s = session("Chat", None, None);
        let msgs = vec![
            msg("user", "question", None),
            msg(
                "assistant",
                "answer",
                Some(r#"[{"index":1,"fileName":"plan.pdf","page":4}]"#),
            ),
        ];
        let md = format_chat_markdown(&s, "date", &msgs, &labels);

        assert!(md.contains("**Date:** date"));
        assert!(md.contains("**Model:** Unknown"));
        assert!(md.contains("**Scope:** Entire archive"));
        assert!(md.contains("## User\n\nquestion"));
        assert!(md.contains("## Assistant\n\nanswer"));
        assert!(md.contains("**Sources:**"));
        assert!(md.contains("plan.pdf (p.4)"));
    }
}
