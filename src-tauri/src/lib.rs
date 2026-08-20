//! Arsiv-H3 Tauri kabugu (desktop). Komut kaydi + runtime RBAC + DB durumu.
//!
//! Kabuk ince: veriyi `archivist-db` (Rust) sahiplenir; burada yalniz opak `Db`
//! tutamaci yonetilir ve tipli komutlar IPC'ye acilir.

mod archive_commands;
mod archive_extract;
mod archive_merge;
mod archive_share;
mod archive_share_commands;
mod audit;
mod auth_commands;
mod backup_commands;
mod chat_commands;
mod commands;
mod crash;
mod crash_commands;
mod curation_commands;
mod dedup_commands;
mod demo_archive;
mod dpapi;
mod embed_commands;
mod folder_watcher;
mod gpu;
mod h2_import_commands;
mod image_commands;
mod indexer;
mod lan_client_commands;
mod lan_commands;
mod legacy_h2;
mod location;
mod model_commands;
mod message_commands;
mod ollama;
mod remote_archive;
mod ollama_commands;
mod open_commands;
mod organize_commands;
mod process_priority;
mod rag_chat;
mod rag_commands;
mod rbac;
mod recovery;
mod shutdown_marker;
mod xmp_commands;
mod refile_commands;
mod reindex_commands;
mod relation_commands;
mod scan_report_commands;
mod setup_check;
mod shape_commands;
mod system_info;
mod undo_commands;
mod vision;
mod vision_commands;
// `pub`: gorsel-arama TR→EN sozlugu (H2 porti). `has_specialized_arch_term` su an cagrilmiyor
// (Ollama-oncelik dali ertelendi) → modulu disa-acmak onu erisilebilir tutar (dead_code yok,
// `#[allow]` gerekmez); ileride sozluk-oncesi Ollama dali eklenince kullanilacak.
pub mod visual_dict;

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

/// DB dosya adi (dizinden bagimsiz sabit).
const DB_FILE_NAME: &str = "archivist.db";
/// Acik DB dizini override'i — gorunur kontrol + test/tasima kacis-kapisi. Ayarliysa dev/release
/// farketmeksizin bu dizin kullanilir (icinde `archivist.db`).
const DB_DIR_ENV: &str = "ARSIV_DB_DIR";

/// **Saf karar (P0.2):** DB dosyasinin tam yolu. Tauri App gerektirmez → birim-test edilebilir.
/// Oncelik: (1) `ARSIV_DB_DIR` override → `<dir>/archivist.db`; (2) release build → `app_data_dir`
/// (`<app_data>/archivist.db` — paketlenmis MSI icin yazilabilir kalici yer; cwd'ye bagimlilik
/// biter); (3) dev build **veya** app_data cozulemezse → `archivist.db` (cwd'ye goreli = mevcut
/// davranis; dev DB'si yerinde kalir, footgun yok).
fn choose_db_path(
    env_override: Option<OsString>,
    is_release: bool,
    app_data: Option<PathBuf>,
) -> PathBuf {
    if let Some(dir) = env_override {
        if !dir.is_empty() {
            return PathBuf::from(dir).join(DB_FILE_NAME);
        }
    }
    if is_release {
        if let Some(dir) = app_data {
            return dir.join(DB_FILE_NAME);
        }
        // app_data cozulemedi (nadir) → asla baslatmayi engelleme; goreli yola dus.
    }
    PathBuf::from(DB_FILE_NAME)
}

/// Uygulama genel durumu — Tauri `manage` ile paylasilir.
/// DB'yi yalniz Rust acar (tek motor sahipligi); kabuk opak `Db` tutamacini tutar.
/// `registry`: tum extractor aileleri (bir kez kurulur; `Extractor: Send+Sync` → paylasilir).
/// `session`: sunucu-tarafi kimlik-dogrulanmis oturum (B1 cozumu). None = giris yok;
/// bellek-ici (token/tablo YOK) → uygulama yeniden baslayinca yeniden-giris gerekir.
/// SU AN aktif olan yerel arsivin kimligi + dosya yolu. Cok-arsiv (izole yerel DB) icin:
/// `db`/`read_db` bu arsive baglidir ve `switch_archive` ile yerinde degistirilir. Ana arsiv
/// (`MAIN_ARCHIVE_ID`) daima `AppState.db_path`'tir → acilista buraya kurulur. Snapshot yolu
/// (arsiv-basina) bu `db_path`'ten turetilir; crash/LAN/registry ise sabit ana `db_path`'i kullanir.
#[derive(Debug, Clone)]
pub struct ArchiveHandle {
    pub id: String,
    pub db_path: std::path::PathBuf,
}

pub struct AppState {
    pub db: Mutex<archivist_db::Db>,
    /// **Ayri SALT-OKUMA baglantisi** (donma fix'i). `ingest_folder` yazma-baglantisini (`db`)
    /// TUM tarama boyu kilitler → o sure `db`'ye giren her komut bekler (arama/gezinme DONAR).
    /// Gezinme/arama/facet gibi OKUMA komutlari bunu kullanir: yerel diskte WAL → yaziciyla
    /// eszamanli okur, donmaz. `query_only=ON` (yalniz okur; yanlislikla yazma → hata → tek
    /// yazici `db`'de kalir, iki-yazici BUSY riski dogmaz). Ayni dosyaya baglidir → `db`'nin
    /// commit'ledigi (ingest asset-basi auto-commit) veriyi aninda gorur.
    pub read_db: Mutex<archivist_db::Db>,
    /// **ANA arsivin** DB dosya yolu — sabit (acilista bir kez kurulur; degismez). Cok-arsivde
    /// bu DAIMA ana arsivdir (`MAIN_ARCHIVE_ID`): kimlik/kullanici/mesaj/LAN paylasim + arsiv
    /// registry'si burada tutulur; crash log da buradan turetilir. AKTIF arsivin yolu icin
    /// `active_db_path()` kullanilir (ana ile ayni ya da secili ek arsiv).
    pub db_path: std::path::PathBuf,
    /// SU AN aktif arsiv (id + yol). `db`/`read_db` buna baglidir; `switch_archive` degistirir.
    /// Acilista daima ana arsiv (`{ MAIN_ARCHIVE_ID, db_path }`). Snapshot yolu bundan turetilir.
    pub active_archive: Mutex<ArchiveHandle>,
    pub registry: archivist_extract::Registry,
    pub session: Mutex<Option<rbac::Session>>,
    /// Faz 5.1: metin embedding motoru (lazy — ilk semantik islemde yuklenir, onbellekli).
    /// Pahali (470MB ONNX) → tek seferlik yukleme; None = henuz yuklenmedi.
    /// **`Arc`** (LAN Faz 5): LAN host closure'i (uzak semantik/RAG retrieval) ayni motoru
    /// paylasir — istemci host'un ONCEDEN insa ettigi indeksi tuketir, host embed'i burada uretir.
    /// Arc klonu closure'a tasinir; `.lock()` cagrilari degismez (Arc deref eder).
    pub embedder: std::sync::Arc<Mutex<Option<archivist_embed::TextEmbedder>>>,
    /// Faz 5.3: gorsel (CLIP) embedding motoru (lazy — ilk gorsel islemde yuklenir).
    /// Iki ONNX (vision+text) → ayri lazy-cache; None = henuz yuklenmedi. Metin→gorsel sorgusu
    /// bu Ingilizce CLIP metin kodlayicisini kullanir (Turkce ONCE offline sozlukle cevrilir).
    pub image_embedder: Mutex<Option<archivist_embed::ImageEmbedder>>,
    /// P2.6: acilis kurtarma sonucu (bozuk-DB tespiti/onarimi). Acilista bir kez kurulur;
    /// `recovery_status` komutuyla renderer okur → bozulma olduysa toast'la bildirir.
    pub startup_recovery: recovery::RecoveryInfo,
    /// Gorsel-arama residual-ceviri yolunun (image_commands) Ollama hang-korumasi: son BASARISIZ
    /// Ollama TR→EN ceviri denemesinin zamani (UNIX epoch ms; `0` = hic basarisiz olmadi). Ollama
    /// down/yavas iken residual'li her sorgunun kisa timeout'u beklememesi icin — son basarisizliktan
    /// bu yana ~30sn gecmediyse Ollama ATLANIR, dogrudan offline sozluge dusulur (bkz
    /// `image_commands::translate_to_english_ollama`). Atomik → kilit gerektirmez.
    pub ollama_translate_fail_ms: std::sync::atomic::AtomicU64,
}

impl AppState {
    /// SU AN aktif arsivin DB dosya yolu (ana ile ayni ya da secili ek arsiv). Snapshot/yedek
    /// yolu bundan turetilir → yedekler AKTIF arsivin yaninda toplanir (arsiv-basi izolasyon).
    /// Kilit zehirlenirse (nadir) ana yola guvenle duser.
    pub fn active_db_path(&self) -> std::path::PathBuf {
        self.active_archive
            .lock()
            .map(|h| h.db_path.clone())
            .unwrap_or_else(|_| self.db_path.clone())
    }

    /// Aktif arsiv ANA arsiv mi (`MAIN_ARCHIVE_ID`)? Kimlik/yonetim komutlari (kullanici/mesaj/LAN)
    /// yalniz ana arsivde calisir → bu guard'i `require_main_archive` kullanir.
    pub fn active_is_main(&self) -> bool {
        self.active_archive
            .lock()
            .map(|h| h.id == archivist_db::MAIN_ARCHIVE_ID)
            .unwrap_or(true)
    }
}

// ── LAN loopback entegrasyon testi icin ince `pub` kopruler ───────────────────────────────
// `tests/lan_loopback.rs` ayri bir crate'tir → `pub(crate)` ic yollari goremez. Bu iki sarmalayici
// UYGULAMANIN KULLANDIGI KODUN TA KENDISINI disa acar (test icin AYRI bir kopya yazilmaz —
// yoksa test, uretimde kosan yolu degil kendi kopyasini dogrulardi).

/// Host tarafi: `opts` JSON → `AssetPage` JSON (LAN sunucusunun cagirdigi gercek fonksiyon).
pub fn lan_query_assets_json(
    db: &archivist_db::Db,
    opts_json: &str,
) -> Result<String, archivist_server::QueryError> {
    lan_commands::query_assets_json(db, opts_json)
}

/// Istemci tarafi: uzak `/assets` cagrisi. Hata, frontend'in gordugu STABIL token olarak doner.
pub fn lan_remote_list_assets(
    host: &str,
    port: u16,
    code: &str,
    opts_json: &str,
) -> Result<serde_json::Value, String> {
    remote_archive::http_list_assets(host, port, code, opts_json)
        .map_err(|e| e.token().to_string())
}

/// Host tarafi (Faz 3): tek asset detayi → JSON (`"null"` = yok/cop'te).
pub fn lan_query_asset_detail_json(
    db: &archivist_db::Db,
    id: i64,
) -> Result<String, archivist_server::QueryError> {
    lan_commands::query_asset_detail_json(db, id)
}

/// Host tarafi (Faz 3): kucuk resimler (batch) → JSON dizisi. Cop'teki id'ler ELENIR.
pub fn lan_query_thumbs_json(
    db: &archivist_db::Db,
    ids: &[i64],
) -> Result<String, archivist_server::QueryError> {
    lan_commands::query_thumbs_json(db, ids)
}

/// Istemci tarafi (Faz 3): uzak detay. `None` = 404 (yok/cop'te).
pub fn lan_remote_get_asset(
    host: &str,
    port: u16,
    code: &str,
    id: i64,
) -> Result<Option<serde_json::Value>, String> {
    remote_archive::http_get_detail(host, port, code, id).map_err(|e| e.token().to_string())
}

/// Istemci tarafi (Faz 3): uzak kucuk resimler (batch).
pub fn lan_remote_thumbs(
    host: &str,
    port: u16,
    code: &str,
    ids: &[i64],
) -> Result<serde_json::Value, String> {
    remote_archive::http_get_thumbs(host, port, code, ids).map_err(|e| e.token().to_string())
}

/// Host tarafi (Faz 4): klasor ozetleri → JSON dizisi (girdisiz; `assets.path`'ten turetir).
pub fn lan_query_folders_json(
    db: &archivist_db::Db,
) -> Result<String, archivist_server::QueryError> {
    lan_commands::query_folders_json(db)
}

/// Istemci tarafi (Faz 4): uzak klasor ozetleri (girdisiz).
pub fn lan_remote_folders(
    host: &str,
    port: u16,
    code: &str,
) -> Result<serde_json::Value, String> {
    remote_archive::http_get_folders(host, port, code).map_err(|e| e.token().to_string())
}

/// Paylasilan embedder tutamaci tipi (loopback testi host closure'larini uretim gibi kurar).
pub type SharedEmbedder = std::sync::Arc<Mutex<Option<archivist_embed::TextEmbedder>>>;

/// Host tarafi (Faz 5): uzak RAG retrieval → `{chunks, diag}` JSON. Model/chunk yoksa `Unavailable`.
pub fn lan_query_rag_json(
    db: &archivist_db::Db,
    embedder: &SharedEmbedder,
    req_json: &str,
) -> Result<String, archivist_server::QueryError> {
    lan_commands::query_rag_json(db, embedder, req_json)
}

/// Host tarafi (Faz 5): uzak semantik arama → `AssetPage` JSON.
pub fn lan_query_semantic_json(
    db: &archivist_db::Db,
    embedder: &SharedEmbedder,
    opts_json: &str,
) -> Result<String, archivist_server::QueryError> {
    lan_commands::query_semantic_json(db, embedder, opts_json)
}

/// Host tarafi (Faz 5): indeks/sayac ozeti → `RemoteStatsDto` JSON (girdisiz).
pub fn lan_query_stats_json(
    db: &archivist_db::Db,
) -> Result<String, archivist_server::QueryError> {
    lan_commands::query_stats_json(db)
}

/// Istemci tarafi (Faz 5): uzak RAG retrieval. 503 → `remote_not_indexed` token.
pub fn lan_remote_rag_retrieve(
    host: &str,
    port: u16,
    code: &str,
    req_json: &str,
) -> Result<serde_json::Value, String> {
    remote_archive::http_rag_retrieve(host, port, code, req_json).map_err(|e| e.token().to_string())
}

/// Istemci tarafi (Faz 5): uzak semantik arama.
pub fn lan_remote_semantic_search(
    host: &str,
    port: u16,
    code: &str,
    opts_json: &str,
) -> Result<serde_json::Value, String> {
    remote_archive::http_semantic_search(host, port, code, opts_json)
        .map_err(|e| e.token().to_string())
}

/// Istemci tarafi (Faz 5): uzak indeks/sayac ozeti.
pub fn lan_remote_stats(
    host: &str,
    port: u16,
    code: &str,
) -> Result<remote_archive::RemoteStatsDto, String> {
    remote_archive::http_stats(host, port, code).map_err(|e| e.token().to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // P0.2: DB yolunu acilista COZ. `app_data_dir` Tauri App handle'i gerektirdiginden
        // (paketlemede cwd'ye guvenilemez) cozum setup icinde yapilir; sonuc AppState'e islenir.
        .setup(|app| {
            let app_data = app.path().app_data_dir().ok();
            let db_path =
                choose_db_path(std::env::var_os(DB_DIR_ENV), !cfg!(debug_assertions), app_data);
            // Hedef dizini olustur (taze release kurulumu: app_data alt-dizini henuz yok olabilir).
            if let Some(parent) = db_path.parent() {
                if !parent.as_os_str().is_empty() {
                    let _ = std::fs::create_dir_all(parent);
                }
            }
            eprintln!("[arsiv-h3] DB yolu: {}", db_path.display());
            // P2.5 stabilite: panik hook — panikleri <db_parent>/logs/crash.log'a yaz (DB'ye
            // DEGIL; panikte Mutex riski). Onceki hook zincirlenir (stderr korunur). Buradan
            // sonrasi (recovery + tum komutlar) kapsanir. Admin log-goruntuleyici okur.
            crash::install_panic_hook(crash::crash_log_path(&db_path));
            // Graceful-shutdown marker (H2 pariti): onceki oturum DUZGUN mu kapandi? "Calisan-kilit"
            // → marker VARSA onceki oturum kendini temizleyememis = BEKLENMEDIK sonlanma (force-kill/
            // guc kaybi; panik hook'un yakalayamadigi). Bu oturumun marker'i yazilir; temiz cikista
            // (`quit_app`) silinir. Beklenmedik ise crash.log'a bir tani satiri → admin panelinde gorunur.
            {
                let mpath = shutdown_marker::marker_path(&db_path);
                let last = shutdown_marker::begin_session(
                    &mpath,
                    crash::now_unix(),
                    std::process::id(),
                );
                if last.unclean {
                    let detail = match last.prev {
                        Some(p) => format!("onceki oturum {} temiz kapanmadi (pid {})", p.started_at, p.pid),
                        None => "onceki oturum temiz kapanmadi".to_string(),
                    };
                    crash::append_report(
                        &crash::crash_log_path(&db_path),
                        &crash::CrashReport {
                            ts: crash::now_unix(),
                            thread: "shutdown".to_string(),
                            message: format!("Beklenmedik kapanis: {detail}"),
                            location: String::new(),
                            backtrace: String::new(),
                        },
                    );
                    eprintln!("[arsiv-h3] {detail}");
                }
            }
            // P0.4: AI model import hedefi = app_local_data_dir/models (Local — ~GB roaming'e
            // yazilmaz; H2 gerekcesi). resolve_*_dir bunu ILK aday yapar (override'dan sonra).
            if let Ok(local) = app.path().app_local_data_dir() {
                model_commands::set_models_root(local.join("models"));
            }
            // P2.6 acilis kurtarma: bozuk-DB oto-tespit → karantina + (en yeni) snapshot'tan onar;
            // olmazsa temiz bos DB. Depolama/izin sorunu taze DB'yi de engellerse setup kontrollu
            // hata doner (panic/crash-log yerine Tauri baslangic hatasi).
            let (db, startup_recovery) = recovery::open_with_recovery(&db_path)?;
            // Donma fix'i: gezinme/arama OKUMA komutlari icin AYRI salt-okuma baglantisi. `db`
            // (yazma) ingest tarafindan uzun sure kilitlense de bu WAL uzerinden eszamanli okur.
            // Acilamazsa (nadir) yazma-baglantisiyla ayni semaya rw-fallback (yine calisir; yalniz
            // donma korumasi zayiflar). `db` ayni yolda zaten acildigi icin fallback pratikte gerekmez.
            let read_db = match archivist_db::Db::open_readonly(&db_path) {
                Ok(read_db) => read_db,
                Err(read_err) => {
                    eprintln!("[arsiv-h3] salt-okuma baglantisi acilamadi ({read_err}); rw-fallback");
                    archivist_db::Db::open_and_migrate(&db_path).map_err(|write_err| {
                        std::io::Error::other(format!(
                            "DB okuma baglantisi acilamadi: readonly={read_err}; fallback={write_err}"
                        ))
                    })?
                }
            };
            // Audit iz'i saklama suresi: acilista BIR KEZ eski kayitlari buda (H2 deseni —
            // `useAppInitialization.ts:274-287` her acilista `clearAuditLogsBefore(cutoff)`).
            // Best-effort: budama basarisiz olsa da uygulama acilir (denetim izi urunu bloklamaz).
            match audit::prune_expired(&db) {
                Ok(0) => {}
                Ok(n) => eprintln!("[arsiv-h3] audit: {n} eski kayit budandi"),
                Err(e) => eprintln!("[arsiv-h3] audit budama basarisiz (yok sayildi): {e}"),
            }
            // Ollama adresi: kalici ayar (app_meta) → modul-global (ollama_base() okur). Oncelik:
            // ARSIV_OLLAMA_BASE env > bu ayar > OLLAMA_HOST env > varsayilan (bkz ollama_commands).
            if let Ok(Some(v)) = db.get_meta("ollama_base") {
                ollama::set_configured_base(Some(v));
            }
            let registry = archivist_ingest::build_registry();
            // Acilista daima ANA arsiv aktif (kalici "son aktif" YOK; gecis oturum-ici eylem).
            let active_archive = Mutex::new(ArchiveHandle {
                id: archivist_db::MAIN_ARCHIVE_ID.to_string(),
                db_path: db_path.clone(),
            });
            app.manage(AppState {
                db: Mutex::new(db),
                read_db: Mutex::new(read_db),
                db_path,
                active_archive,
                registry,
                session: Mutex::new(None),
                embedder: std::sync::Arc::new(Mutex::new(None)),
                image_embedder: Mutex::new(None),
                startup_recovery,
                ollama_translate_fail_ms: std::sync::atomic::AtomicU64::new(0),
            });
            // P1: tarama sonrasi AI oto-indeks surucusu (arka-plan iş parcacigi). Acilista bir tik →
            // enabled + kalan is varsa kaldigi yerden devam (restart-dayanikli kuyruk; H3'un en buyuk
            // akis boslugunu kapatir). AppState'e dokunmaz (folder_watcher gibi modul-global state).
            indexer::init_driver(app.handle().clone());
            indexer::signal_index();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_health,
            // P3 saglik/Doctor — yetim satir onarimi (admin).
            commands::repair_db,
            // Arsiv Sagligi FS-ayagi — staleness (dosya var/mtime) + fixity (bit-rot orneklem).
            commands::check_staleness,
            commands::check_fixity,
            commands::check_office_formats,
            // Makine/derleme teshisi (disk alani + IP + build bilgisi; admin, salt-okuma).
            system_info::system_info,
            // Makine-yerel uygulama onceligi (normal/background; admin).
            process_priority::set_process_priority,
            // P3 secilenleri yeniden-indeksle (cikarici iyilesince backfill; eski `reindex` stub'i degistirdi).
            reindex_commands::reindex_assets,
            // Refile (manuel tasi/yeniden-adlandir) — disk tasima + DB yol senkronu (admin).
            refile_commands::rename_asset,
            refile_commands::refile_assets,
            undo_commands::list_undo_ops,
            undo_commands::undo_op,
            undo_commands::redo_op,
            crash_commands::crash_reports,
            crash_commands::crash_report_count,
            crash_commands::report_frontend_error,
            crash_commands::quit_app,
            crash_commands::clear_crash_reports,
            // P2.5 ④ tarama raporu — her ingest kosusunun kalici gecmisi (admin; list/detay/temizle/export).
            scan_report_commands::list_scan_reports,
            scan_report_commands::get_scan_report,
            scan_report_commands::clear_scan_reports,
            scan_report_commands::export_scan_report,
            curation_commands::bulk_set_favorite,
            curation_commands::bulk_add_tag,
            curation_commands::bulk_remove_tag,
            curation_commands::bulk_add_to_collection,
            curation_commands::bulk_remove_from_collection,
            // Organize (kural-bazli oto-klasorleme) — onizleme (salt-okuma) + calistir (admin).
            organize_commands::plan_organize,
            organize_commands::organize_assets,
            organize_commands::asset_ids_under_folder,
            commands::ingest_folder,
            commands::ingest_folders,
            commands::ingest_status,
            commands::cancel_ingest,
            commands::list_assets,
            commands::get_asset,
            commands::match_sources,
            commands::get_thumbnails,
            commands::prepare_media_source,
            // Adlandirilmis eszamanli yerel arsivler (izole coklu DB).
            archive_commands::list_local_archives,
            archive_commands::create_local_archive,
            archive_commands::rename_local_archive,
            archive_commands::set_local_archive_color,
            archive_commands::delete_local_archive,
            archive_commands::restore_local_archive,
            archive_commands::switch_archive,
            commands::ext_facets,
            commands::folder_summary,
            commands::dashboard_stats,
            commands::dashboard_activity,
            commands::metadata_facets,
            commands::add_tag,
            commands::remove_tag,
            commands::set_tag_color,
            commands::rename_tag,
            commands::delete_tag,
            commands::set_favorite,
            commands::tag_facets,
            commands::favorite_count,
            commands::set_project_meta,
            commands::bulk_set_project_meta,
            commands::list_approval_log,
            xmp_commands::export_xmp_sidecars,
            // `projects` entity — CRUD + asset↔proje atama (editor+; FK SET NULL).
            commands::create_project,
            commands::list_projects,
            commands::update_project,
            commands::delete_project,
            commands::assign_assets_to_project,
            // Kaynak-klasor yonetimi (scanned_roots + gruplar + kok-etiketleri; 0020)
            commands::list_scanned_roots,
            commands::list_trashed_roots,
            commands::list_removed_roots,
            commands::add_scanned_root,
            commands::rename_scanned_root,
            commands::set_root_favorite,
            commands::assign_root_group,
            commands::remove_scanned_root,
            commands::reactivate_scanned_root,
            commands::trash_scanned_root,
            commands::restore_scanned_root,
            commands::purge_scanned_root,
            commands::create_root_group,
            commands::list_root_groups,
            commands::rename_root_group,
            commands::recolor_root_group,
            commands::delete_root_group,
            commands::add_root_tag,
            commands::remove_root_tag,
            // Kaynak-klasor disk sondasi (teshis): "bos" ile "kayip/erisilemez" ayrimi.
            commands::folder_source_state,
            commands::approval_facets,
            commands::gorsel_turu_facets,
            commands::client_facets,
            commands::version_facets,
            commands::deadline_year_facets,
            commands::list_collections,
            commands::create_collection,
            commands::delete_collection,
            commands::rename_collection,
            commands::set_collection_color,
            commands::add_to_collection,
            commands::remove_from_collection,
            // §O cop kutusu (trash): soft-delete + restore + purge.
            commands::trash_assets,
            commands::restore_assets,
            commands::purge_assets,
            commands::list_trash,
            commands::trash_count,
            // Faz 6 auth + oturum (B1 cozumu).
            auth_commands::needs_setup,
            auth_commands::setup_admin,
            auth_commands::login,
            auth_commands::logout,
            auth_commands::current_session,
            auth_commands::change_password,
            auth_commands::list_users,
            auth_commands::get_auth_lockout_policy,
            auth_commands::set_auth_lockout_policy,
            auth_commands::admin_create_user,
            auth_commands::admin_delete_user,
            auth_commands::admin_set_role,
            auth_commands::admin_reset_password,
            // Tek yonlu yerel oneriler — gonderim tum oturumlara, gelen kutusu yalniz ana admin'e.
            message_commands::send_user_message,
            message_commands::list_received_user_messages,
            message_commands::mark_user_message_read,
            message_commands::resolve_user_message,
            // LAN salt-okuma dagitim/bildirim sunucusu (S1-S2 MVP; admin-gated, default-KAPALI).
            lan_commands::lan_start_server,
            lan_commands::lan_stop_server,
            lan_commands::lan_get_server_status,
            lan_commands::lan_regenerate_auth_code,
            lan_commands::lan_add_notification,
            lan_commands::lan_clear_notifications,
            // LAN istemci tarafi (Faz 2) — host'a eslen + bildirim poll (admin-gated; salt-okuma tuketici).
            lan_client_commands::lan_client_get_config,
            lan_client_commands::lan_client_save_config,
            lan_client_commands::lan_client_clear_config,
            lan_client_commands::lan_client_ping,
            lan_client_commands::lan_client_fetch,
            lan_client_commands::lan_client_mark_seen,
            // Uzak ARSIV OKUMA (LAN Faz 2) — eslesme admin'in, OKUMA admin+editor'un
            // (makinenin asil calisani editor; admin-only olsaydi ozellik hedefine ulasmazdi).
            remote_archive::remote_list_assets,
            remote_archive::remote_archive_status,
            // Faz 3 — uzak detay + kucuk resimler (salt-okuma; yerel sekillerle ayni).
            remote_archive::remote_get_asset,
            remote_archive::remote_thumbnails,
            // Faz 4 — uzak klasor ozetleri ("Klasorler" gorunumu; girdisiz, salt-okuma).
            remote_archive::remote_folder_summary,
            // Faz 5 — uzak AI: host'un ONCEDEN insa ettigi indeksi tuket (retrieval+embedding HOST'ta,
            // LLM uretimi ISTEMCIDE). Uzak RAG retrieval · uzak semantik arama · indeks/sayac ozeti.
            remote_archive::remote_rag_retrieve,
            remote_archive::remote_semantic_search,
            remote_archive::remote_stats,
            // Faz 5.1 — semantik arama + embedding uretimi.
            embed_commands::embed_status,
            embed_commands::run_embedding,
            embed_commands::semantic_search,
            // Faz 5.3 — gorsel (CLIP) arama + gorsel embedding uretimi.
            image_commands::image_embed_status,
            image_commands::run_image_embedding,
            image_commands::image_search,
            image_commands::visual_search,
            image_commands::similar_images,
            image_commands::assets_near_color,
            image_commands::count_missing_dominant_colors,
            image_commands::backfill_dominant_colors,
            image_commands::backfill_image_kind,
            // Yedekleme (§O DB snapshot + restore) — yonetilen yedek paneli (admin).
            backup_commands::list_snapshots,
            backup_commands::create_snapshot,
            backup_commands::create_auto_snapshot,
            backup_commands::restore_snapshot,
            backup_commands::delete_snapshot,
            backup_commands::export_snapshot,
            backup_commands::import_snapshot,
            // RAG (Artim 2) — chunk indeksleme (govde + metadata chunk) durum + kosu.
            rag_commands::rag_index_status,
            rag_commands::run_rag_indexing,
            rag_commands::asset_chunks,
            rag_commands::set_rag_excluded,
            // RAG (Artim 4) — Ollama model kesfi + sohbet (niyet + retrieve + generate stream).
            rag_chat::ollama_models,
            rag_chat::ai_status,
            rag_chat::rag_chat,
            rag_chat::stop_rag_chat,
            rag_chat::chat_suggest_title,
            // Kalici cok-oturumlu sohbet (H2 chatStorage porti; chat_sessions + chat_messages).
            chat_commands::chat_create_session,
            chat_commands::chat_list_sessions,
            chat_commands::chat_delete_session,
            chat_commands::chat_rename_session,
            chat_commands::chat_append_message,
            chat_commands::chat_list_messages,
            // Sohbet cop kutusu (soft-delete geri-al / kalici sil / cop listesi+sayimi).
            chat_commands::chat_restore_session,
            chat_commands::chat_purge_session,
            chat_commands::chat_list_trashed_sessions,
            chat_commands::chat_trash_count,
            chat_commands::export_chat_markdown,
            // Ollama adres/port cozumu — kalici ayar (get/set) + otomatik tespit (2026-07-02).
            ollama_commands::ollama_config,
            ollama_commands::set_ollama_base,
            ollama_commands::detect_ollama,
            ollama_commands::start_ollama,
            // AI gorsel-analiz (vision pipeline) — thumbnail → AI metin betim → birlesik arama.
            vision_commands::ollama_vision_models,
            vision_commands::recommend_vision_model,
            vision_commands::image_analysis_status,
            vision_commands::run_image_analysis,
            vision_commands::stop_image_analysis,
            vision_commands::vision_run_state,
            vision_commands::count_pending_analysis,
            vision_commands::count_unusable_analyses,
            vision_commands::reset_unusable_analyses,
            vision_commands::clear_analysis_attempt_marks,
            // P1 tarama sonrasi AI oto-indeks (kalici kuyruk) — durum/ac-kapa/durdur/yeniden-dene.
            indexer::auto_index_status,
            indexer::set_auto_index_enabled,
            indexer::stop_auto_index,
            indexer::retry_skipped_index,
            indexer::reset_local_ai_indexes,
            indexer::reset_rag_chunks,
            // P2.5 klasor watcher (canli izleme) — tespit → folder_changed olayi (admin).
            folder_watcher::start_watching_root,
            folder_watcher::stop_watching_root,
            folder_watcher::stop_all_watchers,
            // Izlenemeyen kokler (salt-okuma) → Kaynak Klasorler panelinde KALICI rozet.
            folder_watcher::watch_failures,
            // Kurulum kontrolu: makine gorsel analize hazir mi (on-kontrol + gercek deneme).
            setup_check::setup_check,
            // Onceki surum (H2) tespiti — ALGILA ve SOYLE (kaldirma YOK).
            legacy_h2::legacy_archive_status,
            // H2→H3 aktarim: aday DB listesi (salt-okuma kesif; sihirbazin 1. adimi).
            legacy_h2::h2_import_candidates,
            // H2→H3 aktarim sihirbazi: envanter → kuru kosu → uygula (ADMIN; pre-import yedekli).
            h2_import_commands::h2_import_inventory,
            h2_import_commands::h2_import_dry_run,
            h2_import_commands::h2_import_apply,
            vision_commands::vision_trial,
            // P2.6 acilis kurtarma durumu — bozuk-DB tespit/onarim sonucu (renderer toast'lar).
            recovery::recovery_status,
            // Slice 2 lokasyon farkindaligi — kaynak dosyalar bu makinede mi (uzak-lokasyon banner).
            location::location_status,
            // OS'ta ac / dosya yoneticisinde goster — opener crate (ShellExecuteW; tauri-plugin-opener'in
            // Windows Unicode/bosluk yollarda basarisizligini asar). Her rol (okuma eylemi).
            open_commands::open_path_os,
            open_commands::reveal_path_os,
            // Cok-arsiv tasima (.archivistpro export/import + YOL-REMAP; makine-arasi) — admin.
            archive_share_commands::export_archive,
            archive_share_commands::peek_archive_manifest,
            archive_share_commands::import_archive,
            archive_share_commands::preview_merge_archive,
            archive_share_commands::merge_archive,
            archive_share_commands::preview_extract_archive,
            archive_share_commands::extract_archive,
            // P0.4 AI model bootstrap — durum + guided import (app_local_data_dir/models).
            model_commands::model_status,
            model_commands::import_models,
            // #8 audit-log — denetim izi goruntuleyici (admin; yazma komutlari record_audit yazar).
            audit::audit_log,
            audit::audit_count,
            // §G asset iliskileri — detay "Iliskiler" sekmesi (oku: her rol; ekle/kaldir editor+).
            relation_commands::asset_relations,
            relation_commands::geo_assets,
            relation_commands::version_timeline,
            relation_commands::add_relation,
            relation_commands::remove_relation,
            // Ayni-kok (plan.dwg <-> plan.pdf) OTO-iliski tespiti (admin; istek-uzeri bakim).
            relation_commands::detect_relations,
            // P3 dedup — yinelenen/benzer dosya bulucu (birebir/ayni-ad/gorsel-phash; istek-uzeri).
            dedup_commands::find_duplicates,
            dedup_commands::cancel_find_duplicates,
            // DWG sekil-arama (Dilim 3) — geometrik benzerlik + parametrik kriter + gorsel-sorgu cikarimi.
            shape_commands::search_shapes_by_similarity,
            shape_commands::search_shapes_by_features,
            shape_commands::search_shapes_composite,
            shape_commands::extract_shape_from_image_bytes
        ])
        .run(tauri::generate_context!())
        .expect("Arsiv-H3 Tauri uygulamasi baslatilamadi");
}

#[cfg(test)]
mod tests {
    use super::{choose_db_path, DB_FILE_NAME};
    use std::ffi::OsString;
    use std::path::PathBuf;

    #[test]
    fn db_path_override_wins_in_any_mode() {
        // Acik override dev'de de release'de de kazanir (app_data yok sayilir).
        let want = PathBuf::from("D:\\veri").join(DB_FILE_NAME);
        let rel = choose_db_path(
            Some(OsString::from("D:\\veri")),
            true,
            Some(PathBuf::from("C:\\appdata")),
        );
        let dev = choose_db_path(Some(OsString::from("D:\\veri")), false, None);
        assert_eq!(rel, want);
        assert_eq!(dev, want);
    }

    #[test]
    fn db_path_empty_override_ignored() {
        // Bos ARSIV_DB_DIR ("") ayarlanmamis gibi ele alinir → release'de app_data'ya duser.
        let p = choose_db_path(
            Some(OsString::from("")),
            true,
            Some(PathBuf::from("C:\\appdata")),
        );
        assert_eq!(p, PathBuf::from("C:\\appdata").join(DB_FILE_NAME));
    }

    #[test]
    fn db_path_release_uses_app_data() {
        // Release + app_data cozuldu → paketleme icin app_data/archivist.db.
        let p = choose_db_path(None, true, Some(PathBuf::from("C:\\appdata")));
        assert_eq!(p, PathBuf::from("C:\\appdata").join(DB_FILE_NAME));
    }

    #[test]
    fn db_path_release_without_app_data_falls_back_to_cwd() {
        // Release ama app_data cozulemedi (nadir) → baslatmayi engelleme, goreli yola dus.
        let p = choose_db_path(None, true, None);
        assert_eq!(p, PathBuf::from(DB_FILE_NAME));
    }

    #[test]
    fn db_path_dev_stays_relative_even_with_app_data() {
        // Dev build: app_data mevcut olsa bile cwd'ye goreli kalir → mevcut dev DB yerinde kalir.
        let p = choose_db_path(None, false, Some(PathBuf::from("C:\\appdata")));
        assert_eq!(p, PathBuf::from(DB_FILE_NAME));
    }
}
