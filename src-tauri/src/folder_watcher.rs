//! Klasor watcher (canli izleme) — H2 `folder_watcher.rs` sadik portu (P2.5).
//!
//! **Kapsam (Faz 1 — tespit):** taranan kok klasorleri `notify` ile izle; bir degisiklik
//! (olustur/degis/sil) saptaninca debounce'lu tek bir `folder_changed` olayini renderer'a
//! YAYINLA. Renderer (useFolderWatcher) toast gosterir + opsiyonel oto-yeniden-tarama tetikler.
//!
//! Mimari: platform-optimal `RecommendedWatcher` (Windows `ReadDirectoryChangesW` / Linux
//! `inotify` / Mac `FSEvents`; UNC/SMB ag surucu Windows'ta destekli). Recursive (alt klasorler
//! dahil). Aktif watcher'lar modul-global bir haritada **yola gore** tutulur — yeni `start` ayni
//! yol icin eskisini DROP eder (notify drop = unwatch → sizinti yok). DB'ye DOKUNMAZ; yalniz
//! olay yayinlar (oto-yeniden-tarama renderer'dan `ingest_folder` admin-komutuyla gider).
//!
//! **Basarisizlik KAYDI (2026-08-09).** Izlenememek KALICI bir durumdur, oysa tek gorunurlugu olan
//! toast GECICIDIR: toast kaybolunca kullanici o kokun hala izlenmedigini hicbir yerden goremez ve
//! oradaki degisiklikler sessizce indeks disinda kalir. Bu yuzden her `start_watching_root` sonucu
//! ikinci bir haritaya (`FAILURES`) yazilir — basarida kayit SILINIR, hatada sinif+ham metin+yol
//! KALIR. `watch_failures` (salt-okuma) bunu dondurur → Kaynak Klasorler panelinde kok basina
//! kalici bir rozet cizilir. Durum bellekte tutulur (DB'ye YAZILMAZ): "su an izleniyor mu" sorusu
//! surece aittir; kalicilastirmak yeniden baslatmadan sonra bayat/yanlis bir rozet uretirdi.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use notify::{ErrorKind as NotifyErrorKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::rbac;
use crate::AppState;

/// FS olay seli onleme penceresi (ms): bir kok icin son yayindan bu sure gecmeden YENI yayin yok.
/// H2 pariti (1 sn). Tek dosya kopyasi bile onlarca FS olayi uretir → tek toast'a katlanir.
const DEBOUNCE_MS: u128 = 1000;

/// Aktif watcher'lar: yol → watcher. Drop = unwatch → harita tek dogruluk kaynagi.
static WATCHERS: OnceLock<Mutex<HashMap<String, RecommendedWatcher>>> = OnceLock::new();
/// Debounce izi: kok yol → son yayin ani.
static LAST_EMIT: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
/// KALICI hata kaydi: yol → son basarisiz izleme denemesi. Basarili `start` kaydi SILER.
static FAILURES: OnceLock<Mutex<HashMap<String, WatchError>>> = OnceLock::new();

fn watchers() -> &'static Mutex<HashMap<String, RecommendedWatcher>> {
    WATCHERS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn last_emit() -> &'static Mutex<HashMap<String, Instant>> {
    LAST_EMIT.get_or_init(|| Mutex::new(HashMap::new()))
}
fn failures() -> &'static Mutex<HashMap<String, WatchError>> {
    FAILURES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Izleme kurulamadi — **KARARLI sinif kodu + ham metin**.
///
/// Gerekce (kullanici bulgusu 2026-08-08): renderer `startWatchingRoot(...).catch(() => ...)` ile
/// hatayi TAMAMEN yutuyordu; kullaniciya yalnizca klasorun KISA adi kaliyordu ("1 klasor izlenemiyor
/// (silsil)"). Oysa neden bilinmeden yapilacak sey de bilinemez: klasor silinmis mi, ag surucusu
/// cevrimdisi mi, izin mi yok, sistemin izleme siniri mi doldu — dordu de TAMAMEN farkli eylem
/// gerektirir. Ustelik bu, bir dosya-degisikligini KACIRMA riski (sessiz veri bayatlamasi).
///
/// `vision::classify_vision_error` deseni: sinif kararli bir kod, ham metin KAYBOLMAZ; ayrica
/// burada siniflandirma hatanin DOGDUGU yerde yapilir → metin eslestirme YOK, `notify::ErrorKind`
/// dogrudan okunur.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchError {
    /// `folder_missing` | `permission` | `watch_limit` | `forbidden` | `other`.
    pub kind: &'static str,
    /// Ham hata metni (teshis; UI kisa cumleyi i18n'den kurar, bunu detay olarak tasir).
    pub message: String,
    /// Hangi kok — UI'da TAM YOL gosterilir: kisa ad ("silsil") hangi surucude oldugunu gizler,
    /// oysa `Z:\...` (ag) ile `D:\...` (harici) arasindaki fark tam da kullanicinin ihtiyaci.
    pub path: String,
}

impl WatchError {
    /// `notify::Error` → sinif. **Metin eslestirme yok**: `ErrorKind` yapisal olarak okunur.
    fn from_notify(err: &notify::Error, path: &str) -> Self {
        let kind = match &err.kind {
            NotifyErrorKind::PathNotFound => "folder_missing",
            NotifyErrorKind::MaxFilesWatch => "watch_limit",
            NotifyErrorKind::Io(io) => match io.kind() {
                std::io::ErrorKind::PermissionDenied => "permission",
                std::io::ErrorKind::NotFound => "folder_missing",
                _ => "other",
            },
            // WatchNotFound / InvalidConfig / Generic → siniflandirilamaz; ham metin tasinir.
            _ => "other",
        };
        Self { kind, message: err.to_string(), path: path.to_string() }
    }
}

/// Bir izleme denemesinin sonucunu KALICI hata kaydina isle: basari → kayit silinir (rozet kalkar),
/// hata → kayit yazilir/tazelenir. Kilit zehirlenmesi sessizce yutulur: kayit tutmak izlemenin
/// KENDISINDEN daha az kritiktir, komutun sonucunu degistirmemeli.
fn record_watch_outcome(path: &str, outcome: &Result<(), WatchError>) {
    let Ok(mut map) = failures().lock() else { return };
    match outcome {
        Ok(()) => {
            map.remove(path);
        }
        Err(e) => {
            map.insert(path.to_string(), e.clone());
        }
    }
}

/// Kayitli tum izleme hatalari — yola gore deterministik sirali (UI listesi her cagrida ayni).
fn watch_failure_list() -> Vec<WatchError> {
    let Ok(map) = failures().lock() else { return Vec::new() };
    let mut out: Vec<WatchError> = map.values().cloned().collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Izleme kurulumunun ASIL isi (yetki kapisi HARIC — o komut govdesinde kalir): klasor erisilebilir
/// mi, watcher kurulabiliyor mu, haritaya yazilir mi.
fn spawn_watcher(app: AppHandle, path: &str) -> Result<(), WatchError> {
    let p = std::path::PathBuf::from(path);
    // `is_dir()` false = "yok" DEMEK DEGIL: cevrimdisi bir ag surucusu (Z:\ ...) veya takili olmayan
    // harici disk de burada duser. Sinif adi bu yuzden "eksik/erisilemez" olarak okunmali; UI ikisini
    // birden soyler (kullanicinin yapacagi sey ayni: surucuyu bagla ya da koku kaldir).
    if !p.is_dir() {
        return Err(WatchError {
            kind: "folder_missing",
            message: format!("klasor bulunamadi veya erisilemiyor: {path}"),
            path: path.to_string(),
        });
    }

    // Olay isleyici: AppHandle + kok yolu yakalar; debounce sonrasi tek olay yayinlar.
    let root_path = path.to_string();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return }; // FS hatasi → sessiz (gecici; sonraki olay yakalar)
        let Some(kind) = event_kind_str(&event.kind) else { return };
        if !should_emit(&root_path) {
            return;
        }
        let _ = app.emit("folder_changed", FolderChangePayload { root_path: root_path.clone(), kind });
    })
    .map_err(|e| WatchError::from_notify(&e, path))?;

    watcher.watch(&p, RecursiveMode::Recursive).map_err(|e| WatchError::from_notify(&e, path))?;

    // Eskiyi degistir (varsa) → drop ile unwatch; haritada tut → watcher canli kalir.
    watchers()
        .lock()
        .map_err(|e| WatchError { kind: "other", message: e.to_string(), path: path.to_string() })?
        .insert(path.to_string(), watcher);
    Ok(())
}

/// Renderer'a giden olay yuku — `folder_changed`. serde camelCase: `rootPath`, `kind`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderChangePayload {
    /// Izlenen kok (renderer bunu oto-yeniden-tarama hedefi olarak kullanir).
    root_path: String,
    /// Degisiklik turu: `created` | `modified` | `removed`.
    kind: &'static str,
}

/// İlgili olay turunu kararli bir etikete cevir; ilgisizleri (Access/Metadata/Other) ele.
fn event_kind_str(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => Some("removed"),
        _ => None, // Access/Other → gurultuden say, atla
    }
}

/// Bu kok icin SU AN yayin yapilmali mi? (debounce) — son yayindan `DEBOUNCE_MS` gectiyse evet.
/// İlk olayda (kayit yok) daima evet. Yan etki: yayinlanacaksa `LAST_EMIT`'i gunceller.
fn should_emit(root: &str) -> bool {
    let mut map = match last_emit().lock() {
        Ok(m) => m,
        Err(_) => return false, // kilit zehirlendi → guvenli taraf: yayinlama
    };
    let now = Instant::now();
    let due = map
        .get(root)
        .is_none_or(|last| now.duration_since(*last).as_millis() >= DEBOUNCE_MS);
    if due {
        map.insert(root.to_string(), now);
    }
    due
}

/// Bir kok klasoru izlemeye basla (**admin**). Recursive; olay → debounce → `folder_changed`.
/// Ayni yol icin tekrar cagrilirsa eski watcher degistirilir (drop → unwatch; cift-izleme yok).
/// Klasor yoksa hata. Renderer bunu yalniz `folder_watch_enabled` + admin oturumda cagirir.
///
/// Sonuc — basari da hata da — `FAILURES` kaydina islenir (bkz modul basligi): rozet toast'tan
/// bagimsiz olarak, durum duzelene kadar ayakta kalir.
#[tauri::command]
pub fn start_watching_root(
    app: AppHandle,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), WatchError> {
    // Yetki kapisi komut GOVDESINDE durur (rbac_coverage kaynak-taramasi burayi okur).
    let gate = rbac::current_role(&state)
        .map_err(|e| WatchError { kind: "other", message: e.to_string(), path: path.clone() })
        .and_then(|role| {
            rbac::require_admin(role).map_err(|e| WatchError {
                kind: "forbidden",
                message: e.to_string(),
                path: path.clone(),
            })
        });

    let outcome = gate.and_then(|()| spawn_watcher(app, &path));
    record_watch_outcome(&path, &outcome);
    outcome
}

/// Bir kok izlemesini durdur (haritadan cikar → drop → unwatch). Yoksa sessiz (idempotent).
/// Hata kaydi da silinir: kasten izlenmeyen bir kok icin rozet gostermek YANILTIRDI.
#[tauri::command]
pub fn stop_watching_root(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    watchers().lock().map_err(|e| e.to_string())?.remove(&path);
    last_emit().lock().map_err(|e| e.to_string())?.remove(&path);
    failures().lock().map_err(|e| e.to_string())?.remove(&path);
    Ok(())
}

/// TUM watcher'lari durdur (cikis/ayar-kapama/oturum-sonu). Debounce izi ve hata kaydi da temizlenir.
/// Rol kontrolu YOK — temizlik her zaman guvenli (yalniz izlemeyi durdurur, veri degismez).
///
/// Hata kaydinin da silinmesi KASITLI: izleme kapatildiginda (ayar kapali / admin degil) hicbir kok
/// izlenmiyordur; eski hatalari rozet olarak birakmak, kullaniciya kapattigi bir ozelligin arizasini
/// gosterirdi. Renderer effect'i yeniden kurarken once bunu cagirir, ardindan denemeler kaydi TAZE
/// doldurur → kisa bir "rozet yok" penceresi olusur, kendini duzeltir.
#[tauri::command]
pub fn stop_all_watchers() -> Result<(), String> {
    watchers().lock().map_err(|e| e.to_string())?.clear();
    last_emit().lock().map_err(|e| e.to_string())?.clear();
    failures().lock().map_err(|e| e.to_string())?.clear();
    Ok(())
}

/// Su an izlenemeyen kokler (salt-okuma; her rol okur — yalniz durum bildirir, hicbir sey degistirmez).
///
/// Kaynak Klasorler paneli bunu kok basina rozet olarak cizer. Kayit KALICIDIR (surec omru boyunca):
/// izlenememek gecici bir bildirim degil, surekli bir durumdur — o klasordeki her degisiklik indekse
/// girmeden gecer. Bos liste = izlenemeyen kok yok VEYA izleme hic kurulmadi (ayar kapali / admin
/// degil); ikisi de rozet gerektirmez.
#[tauri::command]
pub fn watch_failures() -> Vec<WatchError> {
    watch_failure_list()
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RemoveKind};

    #[test]
    fn event_kind_mapping_filters_noise() {
        // İlgili turler kararli etikete eslenmeli.
        assert_eq!(event_kind_str(&EventKind::Create(CreateKind::File)), Some("created"));
        assert_eq!(event_kind_str(&EventKind::Modify(ModifyKind::Any)), Some("modified"));
        assert_eq!(event_kind_str(&EventKind::Remove(RemoveKind::File)), Some("removed"));
        // İlgisizler (Access/Other) → None (yayinlanmaz; gurultu).
        assert_eq!(event_kind_str(&EventKind::Access(notify::event::AccessKind::Read)), None);
        assert_eq!(event_kind_str(&EventKind::Other), None);
    }

    /// Siniflandirma `notify::ErrorKind`'dan YAPISAL okunur — metin eslestirmeye baglI DEGIL
    /// (notify'in hata METINLERI surum/platform ile degisir; sinif kodu degismemeli).
    #[test]
    fn notify_errors_map_to_actionable_classes() {
        let at = |e: notify::Error| WatchError::from_notify(&e, r"Z:\proje\silsil");

        // Yol yok → kullanicinin yapacagi: surucuyu bagla ya da koku kaldir.
        assert_eq!(at(notify::Error::path_not_found()).kind, "folder_missing");
        // io::NotFound de ayni sinifa duser (platforma gore ikisi de gelebilir).
        let io_nf = notify::Error::io(std::io::Error::from(std::io::ErrorKind::NotFound));
        assert_eq!(at(io_nf).kind, "folder_missing");
        // Izin → yapacak sey TAMAMEN farkli (yetki/klasor izinleri).
        let io_perm = notify::Error::io(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert_eq!(at(io_perm).kind, "permission");
        // Sistem izleme siniri (Linux inotify) → sinir yukseltilmeli.
        assert_eq!(at(notify::Error::new(NotifyErrorKind::MaxFilesWatch)).kind, "watch_limit");
        // Siniflandirilamayan → "other"; ham metin KAYBOLMAZ.
        let generic = at(notify::Error::generic("bilinmeyen surucu hatasi"));
        assert_eq!(generic.kind, "other");
        assert!(
            generic.message.contains("bilinmeyen surucu hatasi"),
            "ham metin korunmali: {}",
            generic.message
        );

        // TAM YOL tasinir — kisa ad ("silsil") hangi surucude oldugunu gizlerdi.
        assert_eq!(at(notify::Error::path_not_found()).path, r"Z:\proje\silsil");
    }

    /// Hata kaydinin YASAM DONGUSU — rozetin dogrulugu tamamen buna bagli.
    ///
    /// Uc iddia: (1) hata KALICI (toast'in aksine, okunmakla tukenmiyor — ayni kayit tekrar tekrar
    /// okunur), (2) sonraki BASARILI deneme kaydi siler (duzelen klasor rozet BIRAKMAZ; yoksa
    /// kullanici olmayan bir arizayi kovalardi), (3) `stop_all` her seyi temizler (izleme kapaliyken
    /// rozet gosterilmez). Tum harita iddialari TEK testte: kayit modul-global, paralel kosan ikinci
    /// bir test `clear()`'i gorup kirilirdi.
    #[test]
    fn failures_persist_until_a_later_attempt_succeeds() {
        let path = r"Z:\proje\silsil";
        let err = WatchError::from_notify(&notify::Error::path_not_found(), path);

        record_watch_outcome(path, &Err(err));
        // (1) KALICI: iki ayri okuma AYNI kaydi verir (sinif + ham metin + TAM yol korunur).
        for _ in 0..2 {
            let list = watch_failure_list();
            let found = list.iter().find(|f| f.path == path).expect("kayit kalici olmali");
            assert_eq!(found.kind, "folder_missing");
            assert!(!found.message.is_empty(), "ham metin kaybolmamali");
        }

        // (2) Duzelme: basarili deneme kaydi SILER → rozet kalkar.
        record_watch_outcome(path, &Ok(()));
        assert!(
            !watch_failure_list().iter().any(|f| f.path == path),
            "basarili denemeden sonra rozet birakilmamali"
        );

        // (3) Izleme tamamen kapatilinca kayit da gider (kapali ozelligin arizasi gosterilmez).
        record_watch_outcome(path, &Err(WatchError::from_notify(&notify::Error::path_not_found(), path)));
        assert!(!watch_failure_list().is_empty());
        failures().lock().unwrap().clear(); // stop_all_watchers'in yaptigi (Tauri State gerektirmeden)
        assert!(watch_failure_list().is_empty(), "stop_all sonrasi kayit kalmamali");
    }

    #[test]
    fn should_emit_debounces_within_window() {
        // Benzersiz kok (global state'i diger testlerden izole et).
        let root = "C:/__watch_test_debounce__";
        assert!(should_emit(root), "ilk olay daima yayinlanir");
        assert!(!should_emit(root), "1 sn icindeki ikinci olay debounce edilir");
        // Temizlik (global haritayi kirletme).
        last_emit().lock().unwrap().remove(root);
    }
}
