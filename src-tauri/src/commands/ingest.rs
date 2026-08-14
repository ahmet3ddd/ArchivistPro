//! Klasor indeksleme (ingest) komutu + rapor/ilerleme DTO'lari.
//!
//! `IngestWarning`/`TypeCount` PAYLASILAN DTO'lardir: `reindex_commands` ve
//! `scan_report_commands` bunlari `crate::commands::` yolundan kullanir
//! (mod.rs yeniden-disari-aktarimi yolu korur).

use crate::rbac;
use crate::AppState;
use archivist_ingest::{
    ingest_folders_with_progress as run_ingest, IngestMode, IngestOpts, IngestProgress,
    IngestReport,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

/// İngest IPTAL bayragi (modul-global; vision `VISION_STOP` deseni). `cancel_ingest` set eder →
/// pipeline worker'lari + ana dongu gorup erken cikar (kismi sonuc; yikici post-pass'ler atlanir).
/// `ingest_folder` BASLARKEN false'a sifirlar. **`cancel_ingest` DB'ye DOKUNMAZ / gate YOK**: ingest
/// tum sure `state.db` kilidini tutar → kilit-alan bir iptal ingest bitene kadar bloke olur (iptal
/// asla varmaz) → salt-atomic set ile aninda etkili.
static INGEST_STOP: AtomicBool = AtomicBool::new(false);

/// Kosu yasam dongusu + iptal yetenegi tek mutex altinda degisir. Boylece yeni kosunun eski stop
/// bayragini temizlemesi ile ayni anda gelen `cancel_ingest` arasinda sinyal-kaybi yarisi olmaz.
#[derive(Default)]
struct IngestControl {
    active: bool,
    cancellable: bool,
}

static INGEST_CONTROL: OnceLock<Mutex<IngestControl>> = OnceLock::new();

fn ingest_control() -> &'static Mutex<IngestControl> {
    INGEST_CONTROL.get_or_init(|| Mutex::new(IngestControl::default()))
}

/// Kosu hangi nedenle biterse bitsin aktiflik bayragini birakir.
struct IngestRunGuard;

fn begin_ingest(mode: IngestMode) -> Result<IngestRunGuard, String> {
    let mut control = ingest_control().lock().unwrap_or_else(|p| p.into_inner());
    if control.active {
        return Err("bir klasor taramasi zaten calisiyor".to_string());
    }
    // Stop temizligi control kilidi altinda: ayni anda `cancel_ingest` sinyali araya giremez.
    INGEST_STOP.store(false, Ordering::SeqCst);
    control.active = true;
    control.cancellable = mode != IngestMode::Reset;
    Ok(IngestRunGuard)
}

impl Drop for IngestRunGuard {
    fn drop(&mut self) {
        let mut control = ingest_control().lock().unwrap_or_else(|p| p.into_inner());
        control.active = false;
        control.cancellable = false;
    }
}

/// Bir ingest uyarisi (olumcul-olmayan) — IPC'ye serileştirilebilir bicim (`{path, message}`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestWarning {
    pub path: String,
    pub message: String,
}

/// Uzanti dagiliminda tek kova (`{ext, count}`). ext: kucuk-harf, noktasiz; uzantisiz → `""`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypeCount {
    pub ext: String,
    pub count: usize,
}

/// İngest kosusu ozeti (renderer'a doner). `serde` camelCase: `elapsedMs`, `typeCounts`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestReportDto {
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub failed: usize,
    /// Yikici modda etkilenen sayisi: Replace → cope atilan; Reset → bastan silinen.
    pub removed: usize,
    /// Bu kosuda klasorden OTOMATIK projeye atanan asset sayisi (`auto_project` acikken; kapali → 0).
    pub auto_assigned: usize,
    /// İngest dongusunun duvar-saati suresi (ms; backend `Instant` ile olculur).
    pub elapsed_ms: u64,
    /// Gercekten indekslenen (added + updated) asset'lerin uzanti dagilimi
    /// (count azalan, sonra ext artan siralı).
    pub type_counts: Vec<TypeCount>,
    /// **Olumcul-olmayan** uyarilar (dosya indekslendi ama cikarim dustu / parser uyardi).
    pub warnings: Vec<IngestWarning>,
    /// **Dosya-bazli OLUMCUL hatalar** (indekslenEMEDI). `warnings` ile AYNI sekil ({path,message})
    /// ama AYRI alan → UI "tarama raporu" hata≠uyari ayrimini gosterir (#7).
    pub errors: Vec<IngestWarning>,
    /// **Walker seviyesinde ATLANAN girdiler** (④-C): `{path, message}` seklinde ama `message`
    /// bir sebep-KODU (`hidden`/`unreadable`/`symlink`) → frontend `ingest.skipReason.<code>` ile
    /// yerellestirir. `skipped` (degismemis) SAYISINDAN ayri: bunlar indekslenmedi + gorunmezdi.
    pub skipped_reasons: Vec<IngestWarning>,
    /// **Tavan (`REPORT_MAX_ENTRIES`) yuzunden LISTEYE ALINMAYAN** rapor girdisi sayisi.
    /// 0 = listeler tam. >0 ise UI "…ve N kayit daha" demeli — kesilmis listeyi TAM gibi
    /// gostermek 2026-07-26'da kapatilan hata sinifinin ta kendisi.
    /// ⚠️ Sayimlar (`failed`/`skipped`) tavandan ETKILENMEZ; kelepce yalniz ORNEK listelerdedir.
    pub dropped_entries: usize,
    /// Kullanici durdurmasiyla kismi bittiyse `true`.
    pub cancelled: bool,
    /// Eksiksiz biten kaynak kokler; yalniz bunlar `last_scan=now` olarak kaydedilir.
    pub completed_roots: Vec<String>,
    /// Tamamlanan koklerden en az biri watcher yapilandirmasina yeni eklendiyse `true`.
    pub watch_config_changed: bool,
}

impl From<IngestReport> for IngestReportDto {
    fn from(r: IngestReport) -> Self {
        Self {
            added: r.added,
            updated: r.updated,
            skipped: r.skipped,
            failed: r.failed,
            removed: r.removed,
            auto_assigned: r.auto_assigned,
            elapsed_ms: r.elapsed_ms,
            type_counts: r
                .type_counts
                .into_iter()
                .map(|(ext, count)| TypeCount { ext, count })
                .collect(),
            warnings: r
                .warnings
                .into_iter()
                .map(|(path, message)| IngestWarning { path, message })
                .collect(),
            errors: r
                .errors
                .into_iter()
                .map(|(path, message)| IngestWarning { path, message })
                .collect(),
            skipped_reasons: r
                .skipped_reasons
                .into_iter()
                .map(|(path, message)| IngestWarning { path, message })
                .collect(),
            dropped_entries: r.dropped_entries,
            cancelled: r.cancelled,
            completed_roots: r.completed_roots,
            watch_config_changed: false,
        }
    }
}

/// İngest canli ilerleme (Channel ile renderer'a akar). `serde` camelCase: `currentPath`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestProgressDto {
    pub processed: usize,
    pub total: usize,
    pub folders: usize,
    pub current_path: String,
    pub active_paths: Vec<String>,
    pub root_index: usize,
    pub root_total: usize,
    pub current_root: String,
    pub cancelled: bool,
}

/// Canli Channel renderer'da gecikse bile arayuzun sorgulayabilecegi son bilinen ilerleme.
/// Taramanin yazma kilidinden AYRI bir mutex'te tutulur; durum okuma komutu hicbir zaman SQLite
/// kilidini beklemez.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestStatusDto {
    pub active: bool,
    pub cancellable: bool,
    pub progress: Option<IngestProgressDto>,
}

static INGEST_LIVE_PROGRESS: OnceLock<Mutex<Option<IngestProgressDto>>> = OnceLock::new();

fn live_progress_slot() -> &'static Mutex<Option<IngestProgressDto>> {
    INGEST_LIVE_PROGRESS.get_or_init(|| Mutex::new(None))
}

fn store_live_progress(progress: IngestProgressDto) {
    let mut slot = live_progress_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *slot = Some(progress);
}

/// Aktif taramanin son ilerlemesini döndürür. Channel kaybi/gecikmesi icin renderer bu komutu
/// kisa araliklarla yoklar; SQLite'a dokunmadigi icin ana taramayi bloke etmez.
#[tauri::command]
pub fn ingest_status() -> IngestStatusDto {
    let progress = live_progress_slot()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let control = ingest_control().lock().unwrap_or_else(|p| p.into_inner());
    IngestStatusDto {
        active: control.active,
        cancellable: control.cancellable,
        progress,
    }
}

impl From<&IngestProgress> for IngestProgressDto {
    fn from(p: &IngestProgress) -> Self {
        Self {
            processed: p.processed,
            total: p.total,
            folders: p.folders,
            current_path: p.current_path.clone(),
            active_paths: p.active_paths.clone(),
            root_index: p.root_index,
            root_total: p.root_total,
            current_root: p.current_root.clone(),
            cancelled: p.cancelled,
        }
    }
}

/// İngest modu string'ini (`"merge"`/`"replace"`/`"reset"`) [`IngestMode`]'a cevir.
/// **Bilinmeyen → HATA** (yikici moda SESSIZCE dusmez — guvenlik: kotu/eski istemci
/// kazara `reset` tetikleyemez, ama bilinmeyen de `merge`'e dusup veri kaybi gizlemez).
fn parse_ingest_mode(s: &str) -> Result<IngestMode, String> {
    match s {
        "merge" => Ok(IngestMode::Merge),
        "replace" => Ok(IngestMode::Replace),
        "reset" => Ok(IngestMode::Reset),
        other => Err(format!("bilinmeyen ingest modu: {other}")),
    }
}

fn root_compare_key(path: &str) -> String {
    let mut key = path.trim().replace('\\', "/");
    while key.len() > 1 && key.ends_with('/') && !key.ends_with(":/") {
        key.pop();
    }
    if cfg!(windows) {
        key.make_ascii_lowercase();
    }
    key
}

fn is_same_or_ancestor(parent: &str, child: &str) -> bool {
    if parent == child {
        return true;
    }
    if parent.ends_with('/') {
        child.starts_with(parent)
    } else {
        child
            .strip_prefix(parent)
            .is_some_and(|rest| rest.starts_with('/'))
    }
}

/// Bos/ayni/ic-ice secimleri ayikla. Bir ust kok secilmisse alt kok ayrica taranmaz; dosyalarin
/// iki kez hazirlanmasi ve Replace post-pass'inin ayni kapsama iki kez uygulanmasi onlenir.
fn normalize_root_paths(paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    let candidates: Vec<(String, PathBuf)> = paths
        .into_iter()
        .filter_map(|raw| {
            let trimmed = raw.trim();
            (!trimmed.is_empty()).then(|| (root_compare_key(trimmed), PathBuf::from(trimmed)))
        })
        .collect();

    let mut roots = Vec::new();
    for (index, (key, path)) in candidates.iter().enumerate() {
        let covered = candidates
            .iter()
            .enumerate()
            .any(|(other_index, (other, _))| {
                other_index != index
                    && is_same_or_ancestor(other, key)
                    && (other != key || other_index < index)
            });
        if !covered {
            roots.push(path.clone());
        }
    }
    if roots.is_empty() {
        Err("indekslenecek kaynak klasor secilmedi".to_string())
    } else {
        Ok(roots)
    }
}

/// Bir klasoru tara → BLAKE3 fixity → extract → DB'ye yaz (senkron, artimsal).
/// **Admin-gated** (yazma ayricalikli; `mode` replace/reset YIKICI → admin zaten en yuksek
/// kademe). `skip_unchanged`: size+mtime degismemis & indekslenmis dosyalari hash'siz atla.
/// `mode`: birlestir (silmez) / degistir (kayip→cop) / sifirla (TUM arsiv→purge, sonra
/// indeksle). Yikici modlarda UI ayrica onay ister (replace uyari, reset 'SIFIRLA' yazma).
/// Zengin rapor doner (`removed` = etkilenen).
///
/// `on_progress`: canli ilerleme Channel'i (tarama → her dosya → son). IPC seli onlemek
/// icin **~100ms throttle** edilir; ilk (tarama bitti) ve son (hepsi bitti) daima yollanir.
// `async fn`: ana iş parcacigi DISINDA kosar → buyuk klasor taramasi/indeksleme UI'yi dondurmez
// (ilerleme modali canli kalir). Govde bloklayici, `.await` yok → Send-future guvenli.
#[tauri::command]
// Tauri komutu adli-argumanlarla cagrilir (frontend her alani ismiyle gonderir → struct'a
// paketlemek IPC kontratini bozar). 9 arg bilincli; `oda_concurrency` (ODA es-zamanlilik knob'u)
// son eklenendi — genel `concurrency`'nin yaninda gruplandi.
#[allow(clippy::too_many_arguments)]
pub async fn ingest_folders(
    paths: Vec<String>,
    skip_unchanged: bool,
    mode: String,
    concurrency: Option<usize>,
    // ODA (DWG→DXF) es-zamanlilik ust siniri (Ayarlar; makine-yerel). `None` → mevcut/varsayilan
    // (1) korunur. Genel `concurrency`'den AYRI: ODA alt-surec+disk-bagli → ayri kapilanir.
    oda_concurrency: Option<usize>,
    auto_project: bool,
    auto_project_status: Option<String>,
    on_progress: Channel<IngestProgressDto>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IngestReportDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let paths = normalize_root_paths(paths)?;
    let mode = parse_ingest_mode(&mode)?;

    // Aktiflik, stop sifirlama ve iptal-yetenegi AYNI kilit altinda yayinlanir. Reset purge ile
    // basladiktan sonra guvenle yarida birakilamadigi icin backend seviyesinde iptal edilemez;
    // UI da bu modda Durdur sunmaz. Merge/Replace gercek kismi-sonuc iptalini korur.
    let run_guard = begin_ingest(mode)?;
    // Yeni bir kosu eski ekranin/poll'un ilerlemesini tasimaz.
    {
        let mut slot = live_progress_slot()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *slot = None;
    }

    tauri::async_runtime::spawn_blocking(move || {
        let _run_guard = run_guard;
        let state = app.state::<AppState>();
        let root_label = paths
            .iter()
            .map(|p| p.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" | ");
        let ingest_actor = crate::audit::actor(&state);
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        // RESET geri-alinamaz → ONCE otomatik guvenlik yedegi al. Basarisizsa reset IPTAL
        // (yedeksiz yikici islem yapilmaz). Yedek arsivin yanindaki `snapshots/` klasorune;
        // `auto-` on-eki panelde "otomatik" rozeti kazandirir.
        if mode == IngestMode::Reset {
            let dir = crate::backup_commands::snapshots_dir(&state)
                .map_err(|e| format!("otomatik yedek hazirlanamadi, sifirlama iptal: {e}"))?;
            let auto = dir.join(format!(
                "auto-reset-{}.db",
                crate::backup_commands::now_ms()
            ));
            db.backup_to(&auto)
                .map_err(|e| format!("otomatik yedek alinamadi, sifirlama iptal edildi: {e}"))?;
        }
        // `concurrency`: es-zamanli cikarim worker sayisi (None/0 → OTOMATIK cekirdek-bazli).
        // DB yazimi DAIMA seri kalir (SQLite tek-yazici); bu yalniz hash+extract'i paralellestirir.
        let opts = IngestOpts {
            skip_unchanged,
            mode,
            concurrency: concurrency.unwrap_or(0),
            auto_project,
            auto_project_status,
        };

        // Throttle: en fazla ~100ms'de bir gonder (100K dosyada IPC sel olmasin).
        // İlk (processed=0, tarama bitti) ve son (processed=total) daima yollanir.
        let mut last_emit: Option<Instant> = None;
        let mut emit = |p: &IngestProgress| {
            // Her dosyada guncelle; Channel'a gonderme ise IPC yukunu sinirlamak icin throttle'li
            // kalir. Renderer polling yolu boylece gercek sayaci asla kaybetmez.
            let dto = IngestProgressDto::from(p);
            store_live_progress(dto.clone());
            let now = Instant::now();
            let is_first = p.processed == 0;
            let is_last = p.cancelled || (p.total > 0 && p.processed >= p.total);
            let due = last_emit.is_none_or(|t| now.duration_since(t).as_millis() >= 100);
            if is_first || is_last || due {
                last_emit = Some(now);
                let _ = on_progress.send(dto);
            }
        };

        // ODA (DWG→DXF) kapisi genel havuzdan ayridir. Guvenli otomatik tarama ODA'yi da tek
        // surece indirir; acik bir SSD/NVMe preseti secildiyse kullanicinin ODA ayari uygulanir.
        // Deger cad crate'inde gecerli araliga kelepcelenir.
        if opts.concurrency == 0 {
            archivist_ingest::set_oda_concurrency(1);
        } else if let Some(n) = oda_concurrency {
            archivist_ingest::set_oda_concurrency(n);
        }

        let report = run_ingest(
            &mut db,
            &state.registry,
            &paths,
            &opts,
            &mut emit,
            &INGEST_STOP,
        );

        // #8 audit — yalniz YIKICI ingest modlari (Replace kayiplari cope; Reset tum arsivi siler).
        // Merge rutin (gurultu) → izlenmez. db hala kilitli; ingest_actor kilit oncesi alindi.
        if matches!(opts.mode, IngestMode::Replace | IngestMode::Reset) {
            let action = if opts.mode == IngestMode::Reset {
                "ingest_reset"
            } else {
                "ingest_replace"
            };
            crate::audit::record_on(
                &db,
                &ingest_actor,
                action,
                Some("folder"),
                Some(&root_label),
                Some(&format!(
                    "eklendi {} guncellendi {} silindi {}",
                    report.added, report.updated, report.removed
                )),
            );
        }

        // Slice 2 (lokasyon farkindaligi): ILK gercek indeksleme bu makineyi arsivin "evi" (kaynak
        // dosyalarin diski) olarak isaretler — `archive_host` YOKSA su anki makine adini yaz. Sonraki
        // lokasyonlar farki gorur → `location_status` "uzak lokasyon / onizleme" banner'i. Best-effort:
        // hatasi indekslemeyi gecersiz KILMAZ (yalniz banner etiketi).
        if report.added > 0
            && matches!(db.get_meta(archivist_db::meta::META_ARCHIVE_HOST), Ok(None))
        {
            let _ = db.set_meta(
                archivist_db::meta::META_ARCHIVE_HOST,
                &crate::location::current_hostname(),
            );
        }

        // P1: yeni/degismis asset varsa oto-indeks surucusune tik (tarama→AI oto-indeks; H3'un en
        // buyuk akis boslugunu kapatir). Bloklamaz (kanal send; db'ye dokunmaz); surucu enabled +
        // kalan-is kontrolunu kendi yapar. Bu fn'in db kilidi cikista birakilir → surucu sonra alir.
        if report.added > 0 || report.updated > 0 {
            crate::indexer::signal_index();
        }

        // P2.5 ④ tarama raporu — bu kosunun ozetini KALICI kaydet (her mod; "Tarama Raporlari"
        // gecmisi buradan okur). BEST-EFFORT: kayit hatasi ingest'i BOZMAZ (audit/undo deseni).
        // db hala kilitli; `report` henuz DTO'ya cevrilmedi (asagida tuketilir).
        crate::scan_report_commands::record_scan(&db, &root_label, opts.mode, &report);

        // LAN OTO-bildirim (Faz 2): indeksleme tamamlaninca "N yeni dosya" bildirimi — manuel "Yayinla"nin
        // otomatigi. YALNIZ yeni dosya var (added>0) VE LAN host calisiyorsa uretir → LAN kapaliyken hicbir
        // sey degismez. Best-effort (kilitsiz LAN_RUNNING bayragi → deadlock yok; db zaten kilitli).
        crate::lan_commands::notify_scan_complete(&db, &root_label, report.added, report.updated);

        // Kaynak-kok gercegi backend sonucundan turetilir: yalniz eksiksiz biten, erisilebilir
        // kokler `last_scan=now` kazanir. Renderer artik iptal/red raporunu basarili tarama diye
        // kaydedemez. Kayıt best-effort; asil ingest sonucunu gecersiz kilmaz.
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let mut watch_config_changed = false;
        for root in &report.completed_roots {
            let label = std::path::Path::new(root)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(root);
            match db.record_root_scan(root, label, now_secs) {
                Ok((_, newly_added)) => watch_config_changed |= newly_added,
                Err(e) => eprintln!("[arsiv-h3] tamamlanan kaynak kok kaydedilemedi ({root}): {e}"),
            }
        }

        let mut dto: IngestReportDto = report.into();
        dto.watch_config_changed = watch_config_changed;
        Ok(dto)
    })
    .await
    .map_err(|e| format!("tarama gorevi beklenmedik bicimde sonlandi: {e}"))?
}

/// Geriye uyumlu tek-kok IPC girisi (watcher ve kaynak-klasor kartlari bunu kullanir).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn ingest_folder(
    path: String,
    skip_unchanged: bool,
    mode: String,
    concurrency: Option<usize>,
    oda_concurrency: Option<usize>,
    auto_project: bool,
    auto_project_status: Option<String>,
    on_progress: Channel<IngestProgressDto>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IngestReportDto, String> {
    // Uyumluluk girisi de kendi basina acik bir Tauri guvenlik siniridir. Asagidaki coklu-kok
    // komutu ayni kapıyı tekrar uygulasa da dogrudan gate, RBAC yuzey taramasini ve gelecekte bu
    // delegasyon degisirse endpoint guvenligini korur.
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    ingest_folders(
        vec![path],
        skip_unchanged,
        mode,
        concurrency,
        oda_concurrency,
        auto_project,
        auto_project_status,
        on_progress,
        state,
        app,
    )
    .await
}

/// Calisan bir ingest'i IPTAL et (H2 `raceInvoke` pariteli — kullanici uzun taramayi durdurabilsin).
/// `INGEST_STOP`'u set eder → pipeline worker'lari + ana dongu bir sonraki dosyada gorur → KISMI
/// sonucla erken doner (yazilmis asset'ler DB'de kalir; YIKICI post-pass'ler [REPLACE prune +
/// oto-proje atama] atlanir). **DB'ye DOKUNMAZ / gate YOK** — ingest tum sure db kilidini tutar,
/// kilit-alan bir iptal komutu bloke olurdu (bkz [`INGEST_STOP`]). Aninda etkili + idempotent.
#[tauri::command]
pub fn cancel_ingest() {
    let control = ingest_control().lock().unwrap_or_else(|p| p.into_inner());
    if control.active && control.cancellable {
        INGEST_STOP.store(true, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn cancellation_control_is_race_free_and_reset_safe() {
        use super::{begin_ingest, cancel_ingest, ingest_status, INGEST_STOP};
        use archivist_ingest::IngestMode;
        use std::sync::atomic::Ordering;

        let merge_guard = begin_ingest(IngestMode::Merge).unwrap();
        assert!(ingest_status().active);
        assert!(ingest_status().cancellable);
        cancel_ingest();
        assert!(INGEST_STOP.load(Ordering::SeqCst), "merge stop sinyalini kabul etmeli");
        drop(merge_guard);

        let reset_guard = begin_ingest(IngestMode::Reset).unwrap();
        assert!(!INGEST_STOP.load(Ordering::SeqCst), "yeni kosu eski stop'u atomik temizlemeli");
        assert!(!ingest_status().cancellable);
        cancel_ingest();
        assert!(!INGEST_STOP.load(Ordering::SeqCst), "reset purge sonrasi iptal edilememeli");
        drop(reset_guard);
        assert!(!ingest_status().active);
    }

    /// FROZEN CONTRACT dogrulamasi: IngestReportDto serileştirilmis JSON alan-alan eslesir
    /// (camelCase): added/updated/skipped/failed/elapsedMs/typeCounts[{ext,count}]/
    /// warnings[{path,message}]/errors[{path,message}]. Gecici kontrat-kilidi testi.
    #[test]
    fn ingest_report_dto_serializes_frozen_contract() {
        use super::IngestReportDto;
        use archivist_ingest::IngestReport;

        let report = IngestReport {
            added: 2,
            updated: 1,
            skipped: 3,
            failed: 1,
            removed: 5,
            auto_assigned: 4,
            elapsed_ms: 1234,
            type_counts: vec![("txt".into(), 2), ("csv".into(), 1)],
            warnings: vec![("C:/x/a.dwg".into(), "uyari".into())],
            errors: vec![("C:/x/bozuk.bin".into(), "stat hatasi".into())],
            skipped_reasons: vec![("C:/x/.git".into(), "hidden".into())],
            dropped_entries: 7, // tavan asilmis kosu → DTO'ya AYNEN gecmeli (UI uyariyi gosterir)
            cancelled: true,
            completed_roots: vec!["C:/x".into()],
        };
        let dto: IngestReportDto = report.into();
        let v = serde_json::to_value(&dto).unwrap();

        // Ust seviye alanlar camelCase, dogru degerler.
        assert_eq!(v["added"], 2);
        assert_eq!(v["updated"], 1);
        assert_eq!(v["skipped"], 3);
        assert_eq!(v["failed"], 1);
        assert_eq!(v["removed"], 5);
        assert_eq!(v["autoAssigned"], 4);
        assert_eq!(v["elapsedMs"], 1234);
        assert_eq!(v["cancelled"], true);
        assert_eq!(v["completedRoots"][0], "C:/x");
        assert_eq!(v["watchConfigChanged"], false);
        // Tavan bilgisi UI'ya ULASMALI: kirpilmis rapor "tam" gibi gosterilemez (§6).
        assert_eq!(
            v["droppedEntries"], 7,
            "dusen kayit sayisi DTO'da tasinmali"
        );
        // Yalin (snake_case) anahtar SIZMAMALI.
        assert!(v.get("elapsed_ms").is_none(), "snake_case sizmamali");
        assert!(v.get("dropped_entries").is_none(), "snake_case sizmamali");
        assert!(v.get("type_counts").is_none(), "snake_case sizmamali");

        // typeCounts: [{ext,count}] sira korunur.
        assert_eq!(v["typeCounts"][0]["ext"], "txt");
        assert_eq!(v["typeCounts"][0]["count"], 2);
        assert_eq!(v["typeCounts"][1]["ext"], "csv");
        assert_eq!(v["typeCounts"][1]["count"], 1);

        // warnings: [{path,message}].
        assert_eq!(v["warnings"][0]["path"], "C:/x/a.dwg");
        assert_eq!(v["warnings"][0]["message"], "uyari");
        // errors: [{path,message}] — uyaridan AYRI alan (#7 hata≠uyari).
        assert_eq!(v["errors"][0]["path"], "C:/x/bozuk.bin");
        assert_eq!(v["errors"][0]["message"], "stat hatasi");
        // skippedReasons: [{path,message}] — message = sebep-kodu (④-C); ayri alan.
        assert_eq!(v["skippedReasons"][0]["path"], "C:/x/.git");
        assert_eq!(v["skippedReasons"][0]["message"], "hidden");

        // Tam anahtar kumesi (fazla/eksik alan yok).
        let obj = v.as_object().unwrap();
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "added",
                "autoAssigned",
                "cancelled",
                "completedRoots",
                "droppedEntries", // §6 rapor tavani (2026-07-26): kirpilma UI'ya bildirilir
                "elapsedMs",
                "errors",
                "failed",
                "removed",
                "skipped",
                "skippedReasons",
                "typeCounts",
                "updated",
                "warnings",
                "watchConfigChanged"
            ]
        );
    }

    /// `parse_ingest_mode`: bilinen modlar dogru cevrilir; bilinmeyen → HATA (yikici moda
    /// sessizce dusulmez). Yikici davranis-paritesinin guvenlik kapisi.
    #[test]
    fn parse_ingest_mode_maps_known_and_rejects_unknown() {
        use super::parse_ingest_mode;
        use archivist_ingest::IngestMode;
        assert_eq!(parse_ingest_mode("merge").unwrap(), IngestMode::Merge);
        assert_eq!(parse_ingest_mode("replace").unwrap(), IngestMode::Replace);
        assert_eq!(parse_ingest_mode("reset").unwrap(), IngestMode::Reset);
        assert!(parse_ingest_mode("").is_err(), "bos mod reddedilmeli");
        assert!(
            parse_ingest_mode("RESET").is_err(),
            "buyuk-harf eslesmemeli (kesin string)"
        );
        assert!(
            parse_ingest_mode("destroy").is_err(),
            "bilinmeyen mod reddedilmeli"
        );
    }

    /// FROZEN CONTRACT dogrulamasi: IngestProgressDto (canli ilerleme Channel'i) JSON
    /// alan-alan eslesir (camelCase): processed/total/folders/currentPath. Frontend
    /// `IngestProgress` (ipc/client.ts) ile birebir.
    #[test]
    fn ingest_progress_dto_serializes_frozen_contract() {
        use super::IngestProgressDto;
        use archivist_ingest::IngestProgress;

        let progress = IngestProgress {
            processed: 3,
            total: 10,
            folders: 2,
            current_path: "C:/x/a.txt".into(),
            active_paths: vec!["C:/x/b.tga".into()],
            root_index: 2,
            root_total: 3,
            current_root: "C:/x".into(),
            cancelled: true,
        };
        let dto = IngestProgressDto::from(&progress);
        let v = serde_json::to_value(&dto).unwrap();

        assert_eq!(v["processed"], 3);
        assert_eq!(v["total"], 10);
        assert_eq!(v["folders"], 2);
        assert_eq!(v["currentPath"], "C:/x/a.txt");
        assert_eq!(v["activePaths"][0], "C:/x/b.tga");
        assert_eq!(v["rootIndex"], 2);
        assert_eq!(v["rootTotal"], 3);
        assert_eq!(v["currentRoot"], "C:/x");
        assert_eq!(v["cancelled"], true);
        // Yalin (snake_case) anahtar SIZMAMALI.
        assert!(v.get("current_path").is_none(), "snake_case sizmamali");

        // Tam anahtar kumesi (fazla/eksik alan yok).
        let obj = v.as_object().unwrap();
        let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            vec![
                "activePaths",
                "cancelled",
                "currentPath",
                "currentRoot",
                "folders",
                "processed",
                "rootIndex",
                "rootTotal",
                "total",
            ]
        );
    }

    #[test]
    fn root_selection_removes_duplicates_and_nested_paths() {
        let roots = super::normalize_root_paths(vec![
            r"C:\Arsiv\Projeler".into(),
            r"C:\Arsiv".into(),
            r"c:/arsiv/Projeler".into(),
            r"D:\Diger".into(),
            r"D:\Diger".into(),
        ])
        .unwrap();
        assert_eq!(
            roots,
            vec![
                std::path::PathBuf::from(r"C:\Arsiv"),
                std::path::PathBuf::from(r"D:\Diger")
            ]
        );
    }

    #[test]
    fn root_selection_rejects_empty_input() {
        assert!(super::normalize_root_paths(vec![" ".into()]).is_err());
    }
}
