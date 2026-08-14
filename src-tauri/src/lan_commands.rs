//! LAN salt-okuma dagitim/bildirim sunucusu — Tauri komutlari (S1-S2 MVP; admin-gated).
//!
//! `archivist-server` crate'i saf HTTP+guvenlik tasiyicisidir (DB'yi sahiplenmez). Burada:
//! - Sunucu **modul-global** tutulur (`LAN_SERVER`; indexer/folder_watcher deseni — tek sunucu/process).
//! - Bildirim kaynagi closure'i DB'yi **src-tauri** acar (kendi read-baglantisi; `db_path`'ten).
//! - 8-hane auth kodu **app_meta**'da kalici → host restart'inda kod SABIT (istemci yeniden eslesmez).
//! - Her komut `require_admin` ile gate'li + `audit::record_on` ile denetim izi (rbac.rs deseni).
//!
//! Default-KAPALI: sunucu yalniz `lan_start_server` cagrilinca calisir → offline-pure varsayilan
//! deneyim etkilenmez. Kapsam DISI (Faz 2+): istemci tarafi, dosya transferi, yazma geri-akisi.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::embed_commands::{ensure_embedder, resolve_model_dir};
use crate::rag_chat::{resolve_scope, retrieve_chunks, sensitivity_excluded, RagOptions};
use crate::{rbac, AppState};

/// Paylasilan metin-embedder tutamaci (LAN Faz 5): host closure'lari `AppState.embedder` Arc'inin
/// klonunu yakalar → yerel semantik islemlerle AYNI pahali modeli paylasir (tek yukleme).
type SharedEmbedder = Arc<Mutex<Option<archivist_embed::TextEmbedder>>>;

/// Calisan sunucu (modul-global). `Mutex::new(None)` const → statik baslatma (indexer deseni).
static LAN_SERVER: Mutex<Option<archivist_server::ServerHandle>> = Mutex::new(None);

/// Sunucu calisiyor mu — **kilitsiz** bayrak. ingest OTO-bildirim kancasi (`notify_scan_complete`)
/// bunu okur: `db` kilidi altindayken `LAN_SERVER` mutex'ini KILITLEMEMEK icin (start/stop LAN_SERVER→db
/// sirasiyla kilitler; ingest db→... sirasinda → ters sira = deadlock riski). Yalniz baslat/durdur yazar.
static LAN_RUNNING: AtomicBool = AtomicBool::new(false);

/// Calisan sunucu ORNEK (demo) arsivi mi sunuyor — durum DTO'su ("ÖRNEK arşiv" rozeti) bunu okur.
/// Yalniz baslat/durdur yazar (LAN_RUNNING ile ayni desen).
static LAN_DEMO: AtomicBool = AtomicBool::new(false);

/// Kalici auth kodu meta anahtari (restart'ta kod sabit kalsin → istemci yeniden eslesmesin).
const LAN_CODE_META: &str = "lan_auth_code";

/// Frontend'e donen sunucu durumu (camelCase — TS tarafi bunu okur).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanStatusDto {
    running: bool,
    port: Option<u16>,
    auth_code: Option<String>,
    local_ip: Option<String>,
    /// Calisan sunucu ORNEK (demo) arsivi mi sunuyor → UI "ÖRNEK arşiv" rozeti gosterir.
    demo: bool,
}

fn require_admin(state: &AppState) -> Result<(), String> {
    let role = rbac::current_role(state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())
}

fn status_from(handle: &archivist_server::ServerHandle) -> LanStatusDto {
    LanStatusDto {
        running: true,
        port: Some(handle.port()),
        auth_code: Some(handle.auth_code()),
        local_ip: Some(handle.local_ip().to_string()),
        demo: LAN_DEMO.load(Ordering::Relaxed),
    }
}

fn stopped() -> LanStatusDto {
    LanStatusDto { running: false, port: None, auth_code: None, local_ip: None, demo: false }
}

/// LAN sunucusunu baslat (**Admin**). Zaten calisiyorsa mevcut durumu doner (idempotent).
/// Kalici kod varsa kullanilir; yoksa uretilip app_meta'ya kaydedilir.
#[tauri::command(async)]
pub fn lan_start_server(demo: bool, state: State<'_, AppState>) -> Result<LanStatusDto, String> {
    require_admin(&state)?;
    // LAN paylasim ANA arsivde yonetilir (host DAIMA ana arsivi sunar; kod/ayar ana DB'de).
    crate::archive_commands::require_main_archive(&state)?;
    let mut slot = LAN_SERVER.lock().map_err(|e| e.to_string())?;
    if let Some(h) = slot.as_ref() {
        return Ok(status_from(h)); // zaten calisiyor
    }
    // Kalici kod (varsa) oku — kisa kilit. app_meta'da DPAPI ile sifreli saklanir → coz
    // (legacy plaintext prefix'siz okunur, ilk yeniden-kaydetmede yukseltilir).
    let saved_code = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        match db.get_meta(LAN_CODE_META).map_err(|e| e.to_string())? {
            Some(stored) => Some(crate::dpapi::decrypt_lan_auth_code(&stored)?),
            None => None,
        }
    };
    // Host'un SUNACAGI DB: demo ise ayri seeded "ÖRNEK" dosya (`demo_archive.db`), degilse
    // uygulamanin GERCEK DB'si. Tek makinede bile "Ana arsiv" gorunur sekilde farkli icerik
    // gosterir; tum LAN hatti (HTTP/auth/remote_*) GERCEK calisir (client-mock DEGIL). Gercek bir
    // host'a baglaninca demo devreye GIRMEZ (kullanici acikca "Ornek arsivle baslat" der).
    let serve_path = if demo {
        let p = crate::demo_archive::demo_db_path(&state.db_path);
        crate::demo_archive::ensure_seeded(&p)?;
        p
    } else {
        state.db_path.clone()
    };
    // Bildirim kaynagi: sunucu thread'i kendi read-baglantisiyla okur (DB'yi sahiplenmez).
    let db_path = serve_path.clone();
    let notif_fn: archivist_server::NotificationFn = std::sync::Arc::new(move |since, limit| {
        let conn = archivist_db::open(&db_path).map_err(|e| e.to_string())?;
        let rows =
            archivist_db::notifications::list_since(&conn, since, limit).map_err(|e| e.to_string())?;
        Ok(rows
            .into_iter()
            .map(|r| archivist_server::Notification {
                id: r.id,
                created_at: r.created_at,
                kind: r.kind,
                title: r.title,
                body: r.body,
            })
            .collect())
    });
    // Arsiv sorgu kaynagi (LAN Faz 1): calisanin ana arsivde ARAYABILMESI/GOREBILMESI icin
    // `list_assets` HTTP'ye acilir. Yeni sorgu motoru YOK — mevcut sayfali sorgu yeniden kullanilir.
    //
    // 🔒 SALT-OKUMA IKI KATLI: (1) `open_readonly` → baglanti `query_only=ON` (yazma SQL'i aninda
    // hata verir), (2) sunucu yalniz GET kabul eder. H2'nin "tum DB'yi indir + uzerine yaz"
    // yolunun tersi: hicbir bayt uzak istemciye yazilamaz.
    //
    // Neden `state.read_db` DEGIL de istek basina yeni baglanti: `read_db` bir Mutex arkasinda ve
    // UI'in okuma yolu onu kullaniyor — LAN istekleri o kilide girseydi uzak bir istemci yerel
    // kullaniciyi bekletebilirdi. Bildirim closure'i da ayni deseni izliyor (satir ustu).
    let assets_db_path = serve_path.clone();
    let assets_fn: archivist_server::AssetQueryFn = std::sync::Arc::new(move |opts_json| {
        let db = archivist_db::Db::open_readonly(&assets_db_path)
            .map_err(|e| archivist_server::QueryError::Internal(e.to_string()))?;
        query_assets_json(&db, opts_json)
    });

    // Faz 3 — tek asset detayi. `get_asset` ZATEN `deleted_at IS NULL` guard'ini tasir
    // (2026-07-18'de eklendi) ⇒ cop'teki asset uzaktan da okunamaz; `None` → "null" → 404.
    let detail_db_path = serve_path.clone();
    let detail_fn: archivist_server::AssetDetailFn = std::sync::Arc::new(move |id| {
        let db = archivist_db::Db::open_readonly(&detail_db_path)
            .map_err(|e| archivist_server::QueryError::Internal(e.to_string()))?;
        query_asset_detail_json(&db, id)
    });

    // Faz 3 — kucuk resimler (BATCH; gerekce `/thumbs` yonlendirmesinde).
    let thumbs_db_path = serve_path.clone();
    let thumbs_fn: archivist_server::ThumbQueryFn = std::sync::Arc::new(move |ids| {
        let db = archivist_db::Db::open_readonly(&thumbs_db_path)
            .map_err(|e| archivist_server::QueryError::Internal(e.to_string()))?;
        query_thumbs_json(&db, ids)
    });

    // Faz 4 — klasor ozetleri (GIRDISIZ; host kendi assets.path'inden turetir → uzak "Klasorler").
    let folders_db_path = serve_path.clone();
    let folders_fn: archivist_server::FolderQueryFn = std::sync::Arc::new(move || {
        let db = archivist_db::Db::open_readonly(&folders_db_path)
            .map_err(|e| archivist_server::QueryError::Internal(e.to_string()))?;
        query_folders_json(&db)
    });

    // Faz 5 — uzak semantik + RAG retrieval + istatistik. Retrieval + embedding HOST'ta (host'un
    // ONCEDEN insa ettigi indeksi tuket); LLM uretimi ISTEMCIDE. Embedder Arc PAYLASILIR (state.
    // embedder klonu) → yerel semantik islemlerle ayni pahali modeli kullanir (tek yukleme).
    // rag/semantic closure'lari Arc'i yakalar; stats embedder GEREKMEZ (yalniz model_ready bayragi).
    let embedder_arc = state.embedder.clone();
    let rag_db_path = serve_path.clone();
    let rag_embedder = embedder_arc.clone();
    let rag_fn: archivist_server::RagRetrieveFn = std::sync::Arc::new(move |req_json| {
        let db = archivist_db::Db::open_readonly(&rag_db_path)
            .map_err(|e| archivist_server::QueryError::Internal(e.to_string()))?;
        query_rag_json(&db, &rag_embedder, req_json)
    });
    let sem_db_path = serve_path.clone();
    let sem_embedder = embedder_arc;
    let semantic_fn: archivist_server::SemanticQueryFn = std::sync::Arc::new(move |opts_json| {
        let db = archivist_db::Db::open_readonly(&sem_db_path)
            .map_err(|e| archivist_server::QueryError::Internal(e.to_string()))?;
        query_semantic_json(&db, &sem_embedder, opts_json)
    });
    let stats_db_path = serve_path.clone();
    let stats_fn: archivist_server::StatsQueryFn = std::sync::Arc::new(move || {
        let db = archivist_db::Db::open_readonly(&stats_db_path)
            .map_err(|e| archivist_server::QueryError::Internal(e.to_string()))?;
        query_stats_json(&db)
    });

    let config = archivist_server::ServerConfig {
        port: archivist_server::DEFAULT_LAN_PORT,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        notifications: notif_fn,
        archive: archivist_server::ArchiveApi {
            assets: assets_fn,
            detail: detail_fn,
            thumbs: thumbs_fn,
            folders: folders_fn,
            rag: rag_fn,
            semantic: semantic_fn,
            stats: stats_fn,
        },
    };
    let handle = archivist_server::ServerHandle::start(config, saved_code)?;
    // ÖRNEK arsiv modu bayragi — status_from bunu okur (asagida `let dto = status_from(...)`).
    LAN_DEMO.store(demo, Ordering::Relaxed);
    // Gercek kodu kalici yap (uretildiyse) + denetim izi.
    let code = handle.auth_code();
    {
        let actor = crate::audit::actor(&state);
        let db = state.db.lock().map_err(|e| e.to_string())?;
        // DPAPI ile sifreleyip sakla (kullanici+makine bagli; plaintext DEGIL).
        db.set_meta(LAN_CODE_META, &crate::dpapi::encrypt_lan_auth_code(&code)?)
            .map_err(|e| e.to_string())?;
        crate::audit::record_on(
            &db,
            &actor,
            "lan_start",
            Some("lan"),
            None,
            Some(&format!("port {}", handle.port())),
        );
    }
    let dto = status_from(&handle);
    *slot = Some(handle);
    LAN_RUNNING.store(true, Ordering::Relaxed); // ingest oto-bildirim kancasi icin "audience var" bayragi
    Ok(dto)
}

/// LAN sunucusunu durdur (**Admin**). Calismiyorsa no-op. Thread join edilir (port serbest kalir).
#[tauri::command(async)]
pub fn lan_stop_server(state: State<'_, AppState>) -> Result<(), String> {
    require_admin(&state)?;
    // Handle'i slot'tan AL (kilidi birak) → join'i kilit tutmadan yap.
    let handle = {
        let mut slot = LAN_SERVER.lock().map_err(|e| e.to_string())?;
        slot.take()
    };
    if let Some(h) = handle {
        h.stop();
        LAN_RUNNING.store(false, Ordering::Relaxed); // audience yok → ingest artik oto-bildirim uretmez
        LAN_DEMO.store(false, Ordering::Relaxed); // demo bayragini temizle (sonraki baslatma yeniden belirler)
        let actor = crate::audit::actor(&state);
        let db = state.db.lock().map_err(|e| e.to_string())?;
        crate::audit::record_on(&db, &actor, "lan_stop", Some("lan"), None, None);
    }
    Ok(())
}

/// Sunucu durumu (**Admin** — kod'u icerir). Calismiyorsa `running:false`.
#[tauri::command(async)]
pub fn lan_get_server_status(state: State<'_, AppState>) -> Result<LanStatusDto, String> {
    require_admin(&state)?;
    let slot = LAN_SERVER.lock().map_err(|e| e.to_string())?;
    Ok(slot.as_ref().map(status_from).unwrap_or_else(stopped))
}

/// Auth kodunu YENILE (**Admin**; sunucu calisiyor olmali — yerinde degisir, restart gerekmez).
/// Yeni kod app_meta'ya kaydedilir. Mevcut istemciler yeni kodla yeniden eslesir.
#[tauri::command(async)]
pub fn lan_regenerate_auth_code(state: State<'_, AppState>) -> Result<String, String> {
    require_admin(&state)?;
    crate::archive_commands::require_main_archive(&state)?;
    let slot = LAN_SERVER.lock().map_err(|e| e.to_string())?;
    let Some(h) = slot.as_ref() else {
        return Err("sunucu calismiyor".to_string());
    };
    let code = h.regenerate_code()?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    // DPAPI ile sifreleyip sakla (kullanici+makine bagli; plaintext DEGIL).
    db.set_meta(LAN_CODE_META, &crate::dpapi::encrypt_lan_auth_code(&code)?)
        .map_err(|e| e.to_string())?;
    crate::audit::record_on(&db, &actor, "lan_regenerate_code", Some("lan"), None, None);
    Ok(code)
}

/// Bildirim yayinla (**Admin**) — host uretir, istemciler poll'la gorur. Bos baslik reddedilir;
/// baslik/govde savunma amaçli kirpilir (DoS/kirli-veri). Olusan `id` doner.
#[tauri::command(async)]
pub fn lan_add_notification(
    kind: String,
    title: String,
    body: Option<String>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    require_admin(&state)?;
    let title = title.trim();
    if title.is_empty() {
        return Err("baslik bos olamaz".to_string());
    }
    let kind = {
        let k = kind.trim();
        if k.is_empty() {
            "info"
        } else {
            k
        }
    };
    // Savunma amaçli kirpma (asiri-uzun payload).
    let title: String = title.chars().take(200).collect();
    let kind: String = kind.chars().take(40).collect();
    let body: Option<String> =
        body.map(|b| b.trim().chars().take(2000).collect::<String>()).filter(|s| !s.is_empty());

    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let id = db.add_notification(&kind, &title, body.as_deref()).map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "lan_notify",
        Some("notification"),
        Some(&id.to_string()),
        Some(&title),
    );
    Ok(id)
}

/// Host bildirim gecmisini temizle (**Admin**). Istemcilerdeki mevcut liste bir sonraki poll'da bosalir.
#[tauri::command(async)]
pub fn lan_clear_notifications(state: State<'_, AppState>) -> Result<usize, String> {
    require_admin(&state)?;
    let actor = crate::audit::actor(&state);
    let db = state.db.lock().map_err(|e| e.to_string())?;
    let deleted = db.clear_notifications().map_err(|e| e.to_string())?;
    crate::audit::record_on(
        &db,
        &actor,
        "lan_notifications_clear",
        Some("notification"),
        None,
        Some(&deleted.to_string()),
    );
    Ok(deleted)
}

/// Tel formatindaki `opts` JSON'unu `ListOpts`'a cozup sayfali sorguyu kosar; `AssetPage`
/// JSON'u doner. **Saf** (DB disaridan verilir) → gercek DB ile izole test edilebilir; asil
/// dikis burasidir (HTTP katmani sahte closure ile test edilir, bu fonksiyon SOZLESMEYI test eder).
///
/// Ayristirma hatasi `BadRequest` (istemcinin gonderdigi opts bozuk), sorgu hatasi `Internal`.
pub(crate) fn query_assets_json(
    db: &archivist_db::Db,
    opts_json: &str,
) -> Result<String, archivist_server::QueryError> {
    use archivist_server::QueryError;
    // Tel formati = yerel IPC formati (ayni `ListOpts`) → kontrat kaymasi yapisal olarak imkansiz.
    let opts: archivist_db::ListOpts =
        serde_json::from_str(opts_json).map_err(|e| QueryError::BadRequest(e.to_string()))?;
    // ⚠️ Sayfa boyu kelepcesi `list_assets` ICINDE (`clamp_page_size`, 1..=500) — uzak istemci
    // `page_size: 100000` gonderse bile sunucu 500'e indirir (payload/DoS tavani).
    let page = db.list_assets(&opts).map_err(|e| QueryError::Internal(e.to_string()))?;
    serde_json::to_string(&page).map_err(|e| QueryError::Internal(e.to_string()))
}

/// Tek asset detayi → JSON (`"null"` = yok veya cop'te; sunucu bunu 404'e cevirir).
/// **Saf** (DB disaridan) → gercek DB ile test edilir.
///
/// Guvenlik notu: ayri bir "cop'te mi" kontrolu YOK cunku `get_asset` guard'i KENDISI tasir
/// (`deleted_at IS NULL`). Burada ikinci bir kontrol koymak, guard'in asil yerinden kaymasi
/// riskini dogururdu — tek dogruluk noktasi DB katmaninda kalir.
pub(crate) fn query_asset_detail_json(
    db: &archivist_db::Db,
    id: i64,
) -> Result<String, archivist_server::QueryError> {
    use archivist_server::QueryError;
    let detail = db.get_asset(id).map_err(|e| QueryError::Internal(e.to_string()))?;
    serde_json::to_string(&detail).map_err(|e| QueryError::Internal(e.to_string()))
}

/// Kucuk resimler (batch) → yerel IPC ile AYNI sekilde JSON dizisi
/// (`asset_id`/`mime`/`width`/`height`/`data_base64`) ⇒ istemci hook'u degismeden calisir.
///
/// 🔒 **SIZINTI KAPISI:** `get_thumbnails` `asset_thumbnails`'i id ile DOGRUDAN okur, `assets`
/// ile JOIN etmez ⇒ `deleted_at` suzgeci YOKTUR. Yerelde zararsizdi (grid yalnizca gorunur
/// id'leri ister) ama uzaktan istemci id UYDURABILIR → cope atilmis bir dosyanin onizlemesi
/// disari sizardi. Bu yuzden id'ler ONCE `active_asset_ids`'ten gecirilir.
pub(crate) fn query_thumbs_json(
    db: &archivist_db::Db,
    ids: &[i64],
) -> Result<String, archivist_server::QueryError> {
    use archivist_server::QueryError;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;

    let active = db.active_asset_ids(ids).map_err(|e| QueryError::Internal(e.to_string()))?;
    let rows = db.get_thumbnails(&active).map_err(|e| QueryError::Internal(e.to_string()))?;
    let dtos: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|t| {
            serde_json::json!({
                "asset_id": t.asset_id,
                "mime": t.mime,
                "width": t.width,
                "height": t.height,
                "data_base64": STANDARD.encode(&t.bytes),
            })
        })
        .collect();
    serde_json::to_string(&dtos).map_err(|e| QueryError::Internal(e.to_string()))
}

/// Klasor ozetleri → JSON dizisi (`{path, file_count, last_indexed}` — yerel `folder_summary` IPC
/// ile AYNI sekil ⇒ istemci FoldersView hook'u degismeden yeniden kullanir). **Saf** (DB disaridan).
///
/// GIRDISIZ: `folder_summary` istemciden hicbir deger almaz — klasorler host'un `assets.path`'inden
/// turetilir (`deleted_at IS NULL` suzgeci db katmaninda ⇒ cop'teki dosyalar sayima girmez).
pub(crate) fn query_folders_json(
    db: &archivist_db::Db,
) -> Result<String, archivist_server::QueryError> {
    use archivist_server::QueryError;
    let folders = db.folder_summary().map_err(|e| QueryError::Internal(e.to_string()))?;
    serde_json::to_string(&folders).map_err(|e| QueryError::Internal(e.to_string()))
}

// ── LAN Faz 5: uzak semantik + RAG (host retrieval + embedding; uretim istemcide) ─────────────────
// **Alinan karar (degismez):** istemci host'un ONCEDEN insa ettigi AI/RAG indeksini TUKETIR —
// retrieval + embedding HOST'ta, LLM uretimi ISTEMCIDE. Bu fonksiyonlar **saf** (DB + paylasilan
// embedder disaridan) → gercek DB ile izole test edilir; asil dikis (sozlesme) burasi.

/// `/rag?req=` govdesi: soru + kapsam + secenekler (+ opsiyonel top_k payload kelepcesi). Alanlar
/// tel formatidir; `scope`/`options` yerel IPC tipleriyle AYNI (AnalysisScopeDto/RagOptions) →
/// kayma yok. Eksik alanlar serde varsayilaniyla (scope yok → All; options yok → hepsi kapali).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RagReq {
    question: String,
    #[serde(default)]
    scope: Option<crate::vision_commands::AnalysisScopeDto>,
    #[serde(default)]
    options: RagOptions,
    /// Tel uzerinde donen EN FAZLA chunk (payload kelepcesi). Yok → retrieve_chunks ic tavani.
    #[serde(default)]
    top_k: Option<i64>,
}

/// `req` JSON → `{chunks, diag}` JSON (uzak RAG retrieval). Host embed+retrieve KENDI yapar; istemci
/// donen chunk'larla LLM uretir. **Saf** (DB + paylasilan embedder disaridan). Retrieval cekirdegi
/// yerel sohbetle AYNI (`retrieve_chunks`) → mantik kaymasi yok; host tarafi Ollama-BAGIMSIZ
/// (query-rewrite/rerank istemcide → `extra_fts_terms=&[]`).
///
/// Model YOKSA veya hic chunk YOKSA `Unavailable` (503, `not_indexed`) — istemci bunu "sunucu
/// hatasi" (500) yerine "ana arsivde AI indeksi olusturun" olarak gosterir.
pub(crate) fn query_rag_json(
    db: &archivist_db::Db,
    embedder: &SharedEmbedder,
    req_json: &str,
) -> Result<String, archivist_server::QueryError> {
    use archivist_server::QueryError;
    let req: RagReq =
        serde_json::from_str(req_json).map_err(|e| QueryError::BadRequest(e.to_string()))?;
    let dir = resolve_model_dir().map_err(QueryError::Unavailable)?;
    if db.chunk_count().map_err(|e| QueryError::Internal(e.to_string()))? == 0 {
        return Err(QueryError::Unavailable("host RAG indeksi bos (chunk yok)".to_string()));
    }
    let scope: archivist_db::AnalysisScope =
        req.scope.map(Into::into).unwrap_or(archivist_db::AnalysisScope::All);
    let allowed = resolve_scope(db, &scope).map_err(QueryError::Internal)?;
    let sens = sensitivity_excluded(db, &req.options).map_err(QueryError::Internal)?;
    let (mut hits, diag) = {
        let mut g = embedder.lock().map_err(|e| QueryError::Internal(e.to_string()))?;
        let emb = ensure_embedder(&mut g, &dir).map_err(QueryError::Internal)?;
        retrieve_chunks(db, emb, &req.question, &req.options, &[], allowed.as_ref(), &sens)
            .map_err(QueryError::Internal)?
    };
    if let Some(k) = req.top_k {
        if k >= 0 {
            hits.truncate(k as usize);
        }
    }
    let dto = serde_json::json!({ "chunks": hits, "diag": diag });
    serde_json::to_string(&dto).map_err(|e| QueryError::Internal(e.to_string()))
}

/// `opts` JSON → `AssetPage` JSON (uzak semantik/vektor arama). `opts.query` = semantik sorgu metni;
/// host embed + kNN → `/assets` ile AYNI cikti sekli. **Saf.** Bos sorgu → bos sonuc. Model yoksa
/// `Unavailable` (503). Filtreler (ext/tag/tarih...) `semantic_search` icinde `FILTER_FRAG` ile.
pub(crate) fn query_semantic_json(
    db: &archivist_db::Db,
    embedder: &SharedEmbedder,
    opts_json: &str,
) -> Result<String, archivist_server::QueryError> {
    use archivist_server::QueryError;
    let opts: archivist_db::ListOpts =
        serde_json::from_str(opts_json).map_err(|e| QueryError::BadRequest(e.to_string()))?;
    let q = opts.query.as_deref().unwrap_or("").trim().to_string();
    if q.is_empty() {
        return serde_json::to_string(&archivist_db::AssetPage { total: 0, items: Vec::new() })
            .map_err(|e| QueryError::Internal(e.to_string()));
    }
    let dir = resolve_model_dir().map_err(QueryError::Unavailable)?;
    let qvec = {
        let mut g = embedder.lock().map_err(|e| QueryError::Internal(e.to_string()))?;
        let emb = ensure_embedder(&mut g, &dir).map_err(QueryError::Internal)?;
        emb.embed(&q).map_err(|e| QueryError::Internal(e.to_string()))?
    };
    let page = db.semantic_search(&qvec, &opts).map_err(|e| QueryError::Internal(e.to_string()))?;
    serde_json::to_string(&page).map_err(|e| QueryError::Internal(e.to_string()))
}

/// `() -> RemoteStatsDto` JSON (indeks/sayac ozeti; GIRDISIZ). **Saf.** Embedder GEREKMEZ — yalniz
/// `model_ready` bir dosya-varlik bayragidir (model YUKLENMEZ). "Ana arsiv ne kadar AI-indeksli"
/// gorunumunu besler.
pub(crate) fn query_stats_json(
    db: &archivist_db::Db,
) -> Result<String, archivist_server::QueryError> {
    use archivist_server::QueryError;
    let internal = |e: archivist_db::DbError| QueryError::Internal(e.to_string());
    let dto = crate::remote_archive::RemoteStatsDto {
        vector_count: db.vector_count().map_err(internal)?,
        pending_embed: db.pending_embed_count().map_err(internal)?,
        chunked_assets: db.chunked_asset_count().map_err(internal)?,
        pending_chunk: db.pending_chunk_count().map_err(internal)?,
        chunk_count: db.chunk_count().map_err(internal)?,
        asset_count: db.asset_count().map_err(internal)?,
        folder_count: db.folder_summary().map_err(internal)?.len() as i64,
        model_ready: resolve_model_dir().is_ok(),
    };
    serde_json::to_string(&dto).map_err(|e| QueryError::Internal(e.to_string()))
}

// ── İndeksleme OTO-bildirim (Faz 2 iyilestirme) ───────────────────────────────────────────
// Manuel "Yayinla"nin otomatik esdegeri: bir ingest kosusu bittiginde (YENI dosya varsa) VE LAN
// host CALISIYORSA bir "index" bildirimi uretilir → istemciler poll'la gorur. LAN kapaliyken
// HICBIR yeni satir yazilmaz (offline-pure varsayilan deneyim degismez). `commands/ingest.rs`
// `record_scan`'den hemen sonra cagirir (db KILITLI; best-effort — hata ingest'i bozmaz).

/// Oto-bildirim uretilsin mi: yalniz YENI dosya var (`added>0`) VE LAN host calisiyorsa. Saf/test'li.
fn should_emit_scan_notification(added: usize, lan_running: bool) -> bool {
    added > 0 && lan_running
}

/// Bildirim (baslik, govde) metnini uret. Host tarafinda TR uretilir (backend'de i18n yok → DB'de
/// literal metin durur). `updated>0` ise govdeye "N dosya guncellendi" eklenir. Saf/test'li.
fn scan_notification_text(added: usize, updated: usize, root_path: &str) -> (String, String) {
    let title = format!("{added} yeni dosya indekslendi");
    let body = if updated > 0 {
        format!("{root_path} · {updated} dosya guncellendi")
    } else {
        root_path.to_string()
    };
    (title, body)
}

/// Bildirimi DB'ye yaz (gating YOK — cagiran gate eder). Best-effort: `add_notification` hatasi
/// ingest'i BOZMAZ (record_scan deseni: logla-gec).
fn emit_scan_notification(db: &archivist_db::Db, root_path: &str, added: usize, updated: usize) {
    let (title, body) = scan_notification_text(added, updated, root_path);
    if let Err(e) = db.add_notification("index", &title, Some(&body)) {
        eprintln!("[arsiv-h3] LAN oto-bildirim yazilamadi (ingest etkilenmez): {e}");
    }
}

/// İngest tamamlaninca OTO-bildirim kancasi (ingest.rs cagirir). Gate: `added>0` + LAN calisiyor.
/// ZATEN KILITLI `db` altinda cagrilir; `LAN_RUNNING` kilitsiz bayrak → mutex kilitlemez (deadlock yok).
pub(crate) fn notify_scan_complete(
    db: &archivist_db::Db,
    root_path: &str,
    added: usize,
    updated: usize,
) {
    if should_emit_scan_notification(added, LAN_RUNNING.load(Ordering::Relaxed)) {
        emit_scan_notification(db, root_path, added, updated);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gating_yeni_ve_lan_acik_ister() {
        assert!(!should_emit_scan_notification(0, true), "yeni dosya yok → uretme");
        assert!(!should_emit_scan_notification(5, false), "LAN kapali → uretme");
        assert!(should_emit_scan_notification(5, true), "yeni + LAN acik → uret");
        assert!(!should_emit_scan_notification(0, false));
    }

    #[test]
    fn metin_added_ve_updated() {
        let (t, b) = scan_notification_text(3, 0, r"C:\Proj");
        assert_eq!(t, "3 yeni dosya indekslendi");
        assert_eq!(b, r"C:\Proj", "updated=0 → govde yalniz yol");
        let (t2, b2) = scan_notification_text(3, 2, r"C:\Proj");
        assert_eq!(t2, "3 yeni dosya indekslendi");
        assert!(b2.contains(r"C:\Proj") && b2.contains("2 dosya guncellendi"));
    }

    /// Test arsivi: 3 asset (2 pdf + 1 dwg), biri "Villa" basligi/metniyle.
    fn seeded_db() -> archivist_db::Db {
        let mut db = archivist_db::Db::open_in_memory_migrated().unwrap();
        let mut seed = |path: &str, name: &str, ext: &str, title: &str, body: &str, t: i64| {
            let asset = archivist_db::AssetInput {
                path,
                file_name: name,
                ext: Some(ext),
                size_bytes: 100,
                content_hash: Some("h"),
                mime: None,
                title: Some(title),
                description: None,
                created_at: t,
                modified_at: t,
            };
            let data = archivist_db::IngestData {
                fts_body: Some(body),
                metadata: &[],
                auto_tags: &[],
                phash: None,
                thumbnail: None,
            };
            db.ingest(&asset, &data).unwrap();
        };
        seed("/a/1.pdf", "1.pdf", "pdf", "Villa Projesi", "villa salon metni", 100);
        seed("/a/2.dwg", "2.dwg", "dwg", "Ofis Plani", "ofis kat metni", 200);
        seed("/a/3.pdf", "3.pdf", "pdf", "Kule", "kule yapisi metni", 300);
        db
    }

    #[test]
    fn lan_sorgu_bos_opts_tum_arsivi_doner() {
        let db = seeded_db();
        let json = query_assets_json(&db, "{}").expect("bos opts gecerli olmali");
        let page: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(page["total"], 3, "varsayilan opts tum arsivi sayar");
        assert_eq!(page["items"].as_array().unwrap().len(), 3);
    }

    #[test]
    fn lan_sorgu_filtre_ve_fts_telden_gecer() {
        let db = seeded_db();

        // Uzanti filtresi (cok-degerli facet) tel uzerinden calisir.
        let json = query_assets_json(&db, r#"{"ext":["pdf"]}"#).unwrap();
        let page: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(page["total"], 2, "yalniz pdf'ler");

        // 🔑 ARAMA AYRI UC DEGIL: `query` dolu → list_assets FTS yoluna gecer.
        // (`/search` ucunun neden acilmadiginin kaniti.)
        let json = query_assets_json(&db, r#"{"query":"villa"}"#).unwrap();
        let page: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(page["total"], 1, "FTS 'villa' tek sonuc");
        assert_eq!(page["items"][0]["file_name"], "1.pdf");
    }

    #[test]
    fn lan_sorgu_sayfa_boyu_kelepcelenir() {
        let db = seeded_db();
        // Uzak istemci asiri buyuk sayfa isterse sunucu 500'e indirir (payload tavani).
        // Sabotaj kontrolu: kelepce kalksaydi 100000 satirlik bir sayfa vaadi olurdu.
        let json = query_assets_json(&db, r#"{"page_size":100000}"#).unwrap();
        let page: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(page["items"].as_array().unwrap().len(), 3, "arsivde 3 var → 3 doner");

        // page_size=1 → sayfalama gercekten uygulanir (kelepce ust sinir, sabit deger DEGIL).
        let json = query_assets_json(&db, r#"{"page_size":1,"page":0}"#).unwrap();
        let page: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(page["total"], 3, "total TUM eslesme (sayfa degil)");
        assert_eq!(page["items"].as_array().unwrap().len(), 1, "sayfa boyu 1 uygulandi");
    }

    #[test]
    fn lan_sorgu_bozuk_opts_bad_request_doner() {
        let db = seeded_db();
        // Tur uyusmazligi (page bir metin) → istemci hatasi, host hatasi DEGIL.
        let err = query_assets_json(&db, r#"{"page":"iki"}"#).unwrap_err();
        assert!(
            matches!(err, archivist_server::QueryError::BadRequest(_)),
            "bozuk opts BadRequest olmali (400), Internal (500) DEGIL"
        );
        // Hic JSON olmayan govde de ayni sinifta.
        let err = query_assets_json(&db, "bu json degil").unwrap_err();
        assert!(matches!(err, archivist_server::QueryError::BadRequest(_)));
    }

    #[test]
    fn lan_sorgu_bilinmeyen_alani_yok_sayar() {
        // İleri-uyumluluk: yeni surum istemci bilmedigimiz bir alan gonderirse istek DUSMEZ
        // (ListOpts serde varsayilanlari). Aksi halde her facet eklemesi eski hostlari kirardi.
        let db = seeded_db();
        let json = query_assets_json(&db, r#"{"gelecek_facet":["x"],"ext":["dwg"]}"#).unwrap();
        let page: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(page["total"], 1, "bilinen filtre uygulandi, bilinmeyen alan yok sayildi");
    }

    #[test]
    fn emit_index_bildirimi_yazar() {
        let db = archivist_db::Db::open_in_memory_migrated().unwrap();
        emit_scan_notification(&db, r"C:\Proj\Villa", 4, 1);
        let rows = db.notifications_since(0, 100).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].kind, "index");
        assert_eq!(rows[0].title, "4 yeni dosya indekslendi");
        assert!(rows[0].body.as_deref().unwrap().contains(r"C:\Proj\Villa"));
    }

    // ── Faz 5 saf host yardimcilari (embedder gerektirmeyen yollar; pozitif yollar loopback'te) ──

    /// Bos (yuklu olmayan) paylasilan embedder — model gerektirmeyen kod yollari icin yeterli.
    fn empty_embedder() -> SharedEmbedder {
        Arc::new(Mutex::new(None))
    }

    #[test]
    fn stats_json_gercek_sayaclari_uretir() {
        let db = seeded_db(); // 3 asset, chunk/vektor YOK
        let json = query_stats_json(&db).expect("stats");
        let dto: serde_json::Value = serde_json::from_str(&json).unwrap();
        // camelCase tel-sozlesmesi (RemoteStatsDto): frontend bu anahtarlari okur.
        assert_eq!(dto["assetCount"], 3, "3 aktif asset");
        assert_eq!(dto["vectorCount"], 0, "henuz embedlenmemis");
        assert_eq!(dto["chunkCount"], 0, "henuz chunk yok");
        assert!(dto["folderCount"].as_i64().unwrap() >= 1, "en az bir klasor");
        assert!(dto["modelReady"].is_boolean(), "model_ready bayragi bool");
    }

    #[test]
    fn rag_json_bozuk_req_bad_request() {
        let db = seeded_db();
        let emb = empty_embedder();
        // Gecersiz JSON → istemci hatasi (400), host hatasi (500) DEGIL. Model'e HIC ulasilmaz.
        let err = query_rag_json(&db, &emb, "bu json degil").unwrap_err();
        assert!(matches!(err, archivist_server::QueryError::BadRequest(_)));
    }

    #[test]
    fn rag_json_chunk_yoksa_unavailable() {
        let db = seeded_db(); // chunk YOK
        let emb = empty_embedder();
        // Model yok VEYA chunk yok → "hazir degil" (503 → not_indexed), Internal (500) DEGIL.
        let err = query_rag_json(&db, &emb, r#"{"question":"merdiven"}"#).unwrap_err();
        assert!(
            matches!(err, archivist_server::QueryError::Unavailable(_)),
            "indekssiz host Unavailable (503) donmeli, Internal DEGIL"
        );
    }

    #[test]
    fn semantic_json_bozuk_ve_bos_sorgu() {
        let db = seeded_db();
        let emb = empty_embedder();
        // Bozuk opts → BadRequest.
        let err = query_semantic_json(&db, &emb, "{bozuk").unwrap_err();
        assert!(matches!(err, archivist_server::QueryError::BadRequest(_)));
        // Bos sorgu → bos AssetPage (hata DEGIL; model'e ulasmadan doner → embedder gerektirmez).
        let json = query_semantic_json(&db, &emb, r#"{"query":"   "}"#).expect("bos sorgu hatasiz");
        let page: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(page["total"], 0);
        assert!(page["items"].as_array().unwrap().is_empty());
    }
}
