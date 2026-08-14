//! İngest orkestrasyonu — tara → fixity → extract → DB'ye yaz (senkron, artimsal).

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;

use archivist_db::Db;
use archivist_extract::Registry;

use crate::scan;

mod prepare;
mod priority;
mod reindex;

use prepare::{prepare_one, prune_missing, write_prepared, PrepResult, PruneOutcome};
use priority::BackgroundWorkGuard;

pub use reindex::{reindex_paths, ReindexReport};

/// İngest modu — **yikici** davranisi belirler. Varsayilan `Merge` (guvenli; silmez).
/// Yikici modlar (Replace/Reset) komut katmaninda **ADMIN**'e kisitlidir + UI onay ister.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum IngestMode {
    /// **Birlestir:** ekle/guncelle/atla; HICBIR SEY silinmez (varsayilan, geri-alinabilir).
    #[default]
    Merge,
    /// **Degistir:** birlestir + taranan kok altinda DB'de KAYITLI olup artik DISKTE
    /// olmayan dosyalari COPE at (soft-delete; geri-alinabilir). Kapsam YALNIZ taranan kok
    /// (diger klasorler dokunulmaz). Disk = dogruluk kaynagi → DB o klasorde diske eslenir.
    Replace,
    /// **Sifirla:** ONCE TUM arsivi KALICI sil (`purge_all`), sonra klasoru bastan indeksle.
    /// Temiz baslangic; GERI-ALINAMAZ. Purge basarisizsa indeksleme YAPILMAZ (atomik niyet).
    Reset,
}

/// İngest secenekleri.
pub struct IngestOpts {
    /// `true`: size+mtime degismemis & indekslenmis dosyalar hash'siz atlanir (artimsal).
    /// `Reset` modunda etkisiz (DB once tamamen silinir → her dosya yeni).
    pub skip_unchanged: bool,
    /// Tarama modu (birlestir/degistir/sifirla). Bkz [`IngestMode`].
    pub mode: IngestMode,
    /// **Es-zamanli cikarim** (kac dosya AYNI ANDA hash+extract edilsin). `0` → OTOMATIK
    /// (cekirdek sayisina gore; H2 paritesi). DB yazimi DAIMA seri (SQLite tek-yazici).
    pub concurrency: usize,
    /// **Oto klasor→proje atamasi:** `true` ise tarama sonu (ana dongu + prune BITTIKTEN
    /// sonra) `root` altindaki **projesiz** (`project_id IS NULL`) asset'ler klasor adindan
    /// turetilen projeye OTOMATIK baglanir (post-pass; NULL-only → elle atamayi EZMEZ; H3'un
    /// gercek `projects` entity'sine baglar, H2'nin denormalize string'ine DEGIL).
    /// **Varsayilan `false`** (geriye-uyum + acik opt-in); frontend varsayilani ACIK gonderir.
    pub auto_project: bool,
    /// Oto klasor→proje ile YENI olusan projeye yazilacak `status` degeri (yalniz olusturmada;
    /// var olan proje EZILMEZ). Kullanici-gorunur metin → frontend YERELLESTIRILMIS gonderir
    /// ("Aktif"/"Active"); `None` ise durum bos kalir. (`description` = klasor yolu backend'de
    /// hesaplanir — dilden bagimsiz veri.) `auto_project=false` iken onemsiz.
    pub auto_project_status: Option<String>,
}

impl Default for IngestOpts {
    fn default() -> Self {
        Self {
            skip_unchanged: true,
            mode: IngestMode::Merge,
            concurrency: 0,
            auto_project: false,
            auto_project_status: None,
        }
    }
}

/// Etkin worker sayisi: istek `>=1` ise o deger (32 tavan); `0` ise guvenli otomatik.
/// Kaynak diskin turunu bilmeden paralel buyuk dosya okumak HDD/USB depolamayi doyurup
/// WebView'i ac birakabildigi icin otomatik mod tek worker kullanir. Hiz isteyen kullanici
/// depolama turune uygun SSD/NVMe presetini acikca secebilir.
fn effective_concurrency(requested: usize) -> usize {
    if requested >= 1 {
        return requested.min(32);
    }
    1
}

/// Bir ingest kosusunun ozeti.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct IngestReport {
    pub added: usize,
    pub updated: usize,
    pub skipped: usize,
    pub failed: usize,
    /// Yikici modda etkilenen asset sayisi: **Replace** → cope atilan (kaybolan);
    /// **Reset** → bastan kalici silinen toplam. `Merge` modunda daima 0.
    pub removed: usize,
    /// İngest dongusunun duvar-saati suresi (ms).
    pub elapsed_ms: u64,
    /// Gercekten indekslenen (added + updated) asset'lerin uzanti dagilimi.
    /// ext: kucuk-harf, noktasiz; uzantisiz → `""`. Siralama: count azalan, sonra ext artan.
    pub type_counts: Vec<(String, usize)>,
    /// (yol, mesaj) — **olumcul-olmayan** uyarilar: dosya INDEKSLENDI ama cikarim dustu / parser
    /// uyardi / operasyon-duzeyi temizleme uyarisi. Indekslemeyi engellemez. Olumcul (indekslenemedi)
    /// durumlar icin [`IngestReport::errors`]'a bak (#7 tarama raporu: hata ≠ uyari).
    /// ⚠️ [`REPORT_MAX_ENTRIES`] ile KELEPCELI (bkz [`IngestReport::dropped_entries`]).
    pub warnings: Vec<(String, String)>,
    /// (yol, mesaj) — **dosya-bazli OLUMCUL hatalar:** bu dosyalar indekslenEMEDI (stat/hash/yazim
    /// hatasi). UI "tarama raporu" bunlari uyarilardan AYRI gosterir (hata = indekslenemedi;
    /// uyari = indekslendi-eksik).
    ///
    /// ⚠️ **Invariant (2026-07-26'da kelepce ile guncellendi):**
    /// `errors.len() == min(failed, REPORT_MAX_ENTRIES)`. Onceden `errors.len() == failed` idi;
    /// [`REPORT_MAX_ENTRIES`] tavani geldikten sonra **`failed` GERCEK toplami tasir**, `errors`
    /// ise ornek listesidir. Sayim gereken her yerde `failed` kullanilmali (liste uzunlugu DEGIL).
    pub errors: Vec<(String, String)>,
    /// (yol, sebep-KODU) — **walker seviyesinde ATLANAN girdiler** (④-C: atlanan-sebep yakalama):
    /// gizli (`hidden`) · okunamayan/izin (`unreadable`) · sembolik baglanti (`symlink`). Bunlar
    /// `total`'a GIRMEZ, indekslenMEDI; H2'de tamamen gorunmezdi. Kod frontend'de yerellestirilir
    /// (`ingest.skipReason.<code>`). NOT: `skipped` (degismemis) sayisindan AYRI kavram — o
    /// beklenen/yuksek-hacimli (path'siz sayilir); bu ise anomalik/gorunmez girdiler.
    /// ⚠️ [`REPORT_MAX_ENTRIES`] ile KELEPCELI (bkz [`IngestReport::dropped_entries`]).
    pub skipped_reasons: Vec<(String, String)>,
    /// **Oto klasor→proje atamasiyla** bu kosuda bir projeye baglanan asset sayisi
    /// (`IngestOpts::auto_project` kapali → daima 0). Post-pass; per-asset yazimdan bagimsiz.
    /// UI tarama raporunda "N dosya otomatik projeye atandi" olarak gosterilebilir.
    pub auto_assigned: usize,
    /// **Tavan yuzunden KAYDEDILMEYEN** rapor girdisi sayisi (`warnings` + `errors` +
    /// `skipped_reasons` toplami). 0 = liste tam.
    ///
    /// Neden var: liste sessizce kesilirse kullanici eksik raporu TAM sanar — 2026-07-26'daki
    /// "sohbet listesi 12'de duruyordu ama tam liste gibi sunuluyordu" hatasinin ayni sinifi.
    /// H2 bu tavani uyguluyordu (`SCAN_REPORT_MAX_ENTRIES = 10000`) ama kac kaydin dustugunu
    /// SOYLEMIYORDU; H3 soyler.
    pub dropped_entries: usize,
    /// Kosu kullanici durdurmasiyla kismi bittiyse `true`. Basarili/tam kosuda `false`.
    /// UI ve kaynak-kok kaydi, uyari metnini yorumlamak yerine bu tipli sonucu kullanir.
    pub cancelled: bool,
    /// Eksiksiz tamamlanan ve gercekten erisilebilir kaynak kokler. Iptalde konservatif olarak
    /// bostur; boylece kismi/yarim kosu `last_scan=now` diye yanlis kaydedilmez.
    pub completed_roots: Vec<String>,
}

/// Tarama raporu listelerinin (uyari/hata/atlanan) **girdi tavani** — H2 `fileScanner.ts`
/// `SCAN_REPORT_MAX_ENTRIES` pariteli.
///
/// **Neden gerekli (2026-07-26 davranis-sadakati turu §6):** bu listeler sinirsiz `Vec`'lerdi ve
/// tarama sonunda TEK bir JSON kolonuna yaziliyordu → milyon-dosyali bir agacta bellek sisiyor,
/// dev bir JSON blob'u DB'ye giriyor ve rapor detayi acilirken agir parse ediliyordu. H3 **1M
/// olcegi hedefliyor**; koruma H2'de vardi, burada yoktu.
///
/// Tavan **ornekleme**dir, sayim degil: gercek toplamlar sayaclarda durur (`failed` · `skipped`)
/// ve dusen girdi sayisi [`IngestReport::dropped_entries`]'de raporlanir.
pub const REPORT_MAX_ENTRIES: usize = 10_000;

/// Rapor listesine kelepceli ekleme: tavana kadar ekler, sonrasinda yalniz sayar.
/// (H2 `pushReport` erken-donus deseni + H3'un "kac tane dustu" ilavesi.)
pub(crate) fn push_capped(
    list: &mut Vec<(String, String)>,
    dropped: &mut usize,
    entry: (String, String),
) {
    if list.len() < REPORT_MAX_ENTRIES {
        list.push(entry);
    } else {
        *dropped += 1;
    }
}

/// İngest sirasinda canli ilerleme (renderer'a callback ile akar). Tauri-agnostik:
/// bu crate IPC bilmez; cagiran (Tauri komutu) bir closure verir → Channel'a iter.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IngestProgress {
    /// Hazirligi tamamlanan dosya sayisi (tarama biter bitmez 0).
    pub processed: usize,
    /// Toplam dosya (tarama sonucu). `processed` bunu asmaz.
    pub total: usize,
    /// Dosya iceren farkli klasor (ust-dizin) sayisi.
    pub folders: usize,
    /// Son tamamlanan dosyanin tam yolu (baslangic/son ozetinde bos).
    pub current_path: String,
    /// Su anki kaynak-kokun 1-bazli sirasi. Tarama baslangicinda hangi kokun gezildigini,
    /// isleme sirasinda `current_path`in hangi secime ait oldugunu bildirir.
    pub root_index: usize,
    /// Bu kosudaki kaynak-kok sayisi (tek-klasor eski akista 1).
    pub root_total: usize,
    /// Su an taranan/islenen kaynak-kok. Kosu sonu ozetinde bos.
    pub current_root: String,
    /// Worker havuzunda su anda hash/cikarim islemi suren dosyalar.
    pub active_paths: Vec<String>,
    /// Son bildirim kismi bir kullanici iptalini temsil ediyorsa `true`.
    pub cancelled: bool,
}

/// `root` altindaki dosyalari tara ve DB'ye ingest et. Hatalar dosya-bazli izole edilir
/// (tarama durmaz); ozet [`IngestReport`] doner. İlerleme bildirimsiz (geriye-donuk imza).
pub fn ingest_folder(db: &mut Db, reg: &Registry, root: &Path, opts: &IngestOpts) -> IngestReport {
    // İptalsiz yol (basit cagirim / testler): asla-durmayan bayrak.
    let never_stop = AtomicBool::new(false);
    ingest_folder_with_progress(db, reg, root, opts, &mut |_| {}, &never_stop)
}

/// [`ingest_folder`] + canli ilerleme. `on_progress` tarama bitince, her worker bir dosyaya
/// baslayip bitirdiginde ve son ozette cagrilir. Cagiran gerekirse kisitlar (throttle).
pub fn ingest_folder_with_progress(
    db: &mut Db,
    reg: &Registry,
    root: &Path,
    opts: &IngestOpts,
    on_progress: &mut dyn FnMut(&IngestProgress),
    // İPTAL bayragi (src-tauri INGEST_STOP enjekte eder): set edilince worker'lar yeni dosya
    // ALMAZ + ana dongu yazmayi DURDURUR → kismi sonuc doner. YIKICI/post-pass adimlar (REPLACE
    // "diskte-olmayani-sil" prune + oto-proje atama) iptalde ATLANIR — yarim taramada silme/atama
    // yanlis olur. Zaten yazilmis (added/updated) asset'ler DB'de kalir (artimsal, geri-alinabilir).
    stop: &AtomicBool,
) -> IngestReport {
    ingest_folders_with_progress(db, reg, &[root.to_path_buf()], opts, on_progress, stop)
}

/// Birden fazla bagimsiz kaynak-koku **tek ingest kosusu** olarak tara. Butun kokler once
/// gezilir; boylece ilerleme toplami bastan dogrudur ve yuzde kok gecislerinde gerilemez.
/// `Reset` tum arsivi yalniz BIR KEZ temizler; `Replace`/oto-proje post-pass'leri kok basina
/// uygulanir. Cagiran, ic ice/ayni kokleri onceden ayiklamalidir.
pub fn ingest_folders_with_progress(
    db: &mut Db,
    reg: &Registry,
    roots: &[PathBuf],
    opts: &IngestOpts,
    on_progress: &mut dyn FnMut(&IngestProgress),
    stop: &AtomicBool,
) -> IngestReport {
    // Windows'ta bu koordinatör thread tarama + seri DB yazimini yapar. CPU/I/O arka-plan
    // modu WebView'in animasyon ve zamanlayicilarini agir arsivlerde yanitli tutar.
    let _priority_guard = BackgroundWorkGuard::enter();
    let mut report = IngestReport::default();
    // Yalniz gercekten indekslenen (added + updated) asset'leri uzantiya gore say.
    let mut type_tally: HashMap<String, usize> = HashMap::new();
    let started = Instant::now();

    if roots.is_empty() {
        report
            .warnings
            .push((String::new(), "indekslenecek kaynak klasor yok".to_string()));
        report.elapsed_ms = started.elapsed().as_millis() as u64;
        return report;
    }

    // Savunma-katmani: Tauri reset kosusunu iptal-edilemez yayinlar; yine de kutuphane dogrudan
    // onceden set edilmis bir stop bayragiyla cagrilirsa purge'e ASLA girme.
    if stop.load(Ordering::Relaxed) {
        report.cancelled = true;
        report.warnings.push((
            roots
                .iter()
                .map(|p| p.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" | "),
            "tarama baslamadan iptal edildi; arsiv degistirilmedi".to_string(),
        ));
        report.elapsed_ms = started.elapsed().as_millis() as u64;
        return report;
    }

    // RESET: temiz baslangic — ONCE tum arsivi kalici sil. Basarisizsa indeksleme
    // YAPILMAZ (yarim-silinmis duruma indekslemek yanlis olur) → uyari + erken don.
    if opts.mode == IngestMode::Reset {
        // KAYNAK-YOKLUK KORUMASI (H3 footgun-fix; H2'de YOK): Reset TUM arsivi purge edip
        // SONRA bu koku indeksler. Kok erisilemezse (yanlis makine / takilmamis disk) →
        // purge sonrasi indeksleme BOS kalir → tum arsiv kaybi. REDDET (purge YAPILMAZ).
        if let Some(root) = roots.iter().find(|root| !root_accessible(root)) {
            report.warnings.push((
                root.to_string_lossy().to_string(),
                format!(
                    "sifirla REDDEDILDI (koruma): kaynak kok erisilemez ({}); arsiv korundu",
                    root.display()
                ),
            ));
            report.elapsed_ms = started.elapsed().as_millis() as u64;
            return report;
        }
        match db.purge_all() {
            Ok(n) => report.removed = n,
            Err(e) => {
                report.warnings.push((
                    roots
                        .iter()
                        .map(|p| p.to_string_lossy())
                        .collect::<Vec<_>>()
                        .join(" | "),
                    format!("sifirla basarisiz: {e}"),
                ));
                report.elapsed_ms = started.elapsed().as_millis() as u64;
                return report;
            }
        }
    }

    // Tarama: scan_files indekslenecek dosyalari + walker seviyesinde ATLANAN girdileri (sebep)
    // birlikte doner → toplam + klasor sayisi bedava; atlananlar rapora tasinir (④-C).
    struct ScannedRoot {
        root: PathBuf,
        start: usize,
        end: usize,
    }

    let root_total = roots.len();
    let mut files: Vec<PathBuf> = Vec::new();
    let mut scanned_roots: Vec<ScannedRoot> = Vec::with_capacity(root_total);
    for (root_zero, root) in roots.iter().enumerate() {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        on_progress(&IngestProgress {
            processed: 0,
            total: 0,
            folders: 0,
            current_path: String::new(),
            root_index: root_zero + 1,
            root_total,
            current_root: root.to_string_lossy().to_string(),
            active_paths: Vec::new(),
            cancelled: false,
        });
        let scanned = scan::scan_files(root);
        let start = files.len();
        files.extend(scanned.files);
        let end = files.len();
        scanned_roots.push(ScannedRoot {
            root: root.clone(),
            start,
            end,
        });

        let room = REPORT_MAX_ENTRIES.saturating_sub(report.skipped_reasons.len());
        let skipped_total = scanned.skipped.len();
        report.skipped_reasons.extend(
            scanned
                .skipped
                .into_iter()
                .take(room)
                .map(|(p, r)| (p.to_string_lossy().to_string(), r.code().to_string())),
        );
        report.dropped_entries += skipped_total.saturating_sub(room);
    }
    let total = files.len();
    let folders = count_folders(&files);
    // Atlanan girdileri (gizli/okunamayan/sembolik) rapora yaz: (yol, sebep-kodu). `total`'a
    // katilmaz (bunlar islenmedi); UI tarama raporunda ayri "atlanan" bolumunde gorunur.
    // ⚠️ Tavan burada EN KRITIK: walker'in atlanan-listesi tek seferde gelir ve buyuk bir agacta
    // (or. binlerce gizli girdi) tek basina milyonluk olabilir → once kelepcele, dusen sayilir.
    // Tarama bitti: baslangic ozeti (processed=0) → renderer determinate moda gecer.
    let mut progress = IngestProgress {
        processed: 0,
        total,
        folders,
        current_path: String::new(),
        root_index: 1,
        root_total,
        current_root: roots
            .first()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        active_paths: Vec::new(),
        cancelled: false,
    };
    on_progress(&progress);

    // Paralel cikarim ON-CEK'i: mevcut parmak izleri (skip-unchanged karari worker'larda, db'siz).
    // Reset SONRASI (purge_all → map bos) + scan sonrasi cekilir. Hata → bos map (her dosya yeni
    // islenir; correctness korunur, yalniz skip optimizasyonu kaybolur).
    let mut fingerprints = HashMap::new();
    for root in roots {
        if let Ok(root_fingerprints) = db.fingerprints_under(&root_prefix(root)) {
            fingerprints.extend(root_fingerprints);
        }
    }

    let n_workers = effective_concurrency(opts.concurrency);
    let next = AtomicUsize::new(0);
    enum WorkerEvent {
        Started(usize),
        Finished(usize, PrepResult),
    }
    let (tx, rx) = mpsc::channel::<WorkerEvent>();

    // Worker havuzu (paralel HASH+EXTRACT, db'siz) → kanal → ANA THREAD seri DB yazimi (SQLite
    // tek-yazici). std::thread::scope: yerel veriyi (&files/&fingerprints/&reg) odunc verir.
    std::thread::scope(|s| {
        for _ in 0..n_workers {
            let tx = tx.clone();
            let next = &next;
            let files = &files;
            let fps = &fingerprints;
            let reg_ref = reg;
            let opts_ref = opts;
            s.spawn(move || {
                // Hash, tam-cozunurluk decode ve cikarim en pahali kisimdir. Her isciyi ayri
                // arka-plan CPU/I/O moduna al; Tauri/WebView thread'lerine dokunma.
                let _priority_guard = BackgroundWorkGuard::enter();
                loop {
                    if stop.load(Ordering::Relaxed) {
                        break; // iptal → yeni dosya alma (bekleyen kalir → resumable)
                    }
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    if i >= files.len() {
                        break;
                    }
                    if tx.send(WorkerEvent::Started(i)).is_err() {
                        break;
                    }
                    let res = prepare_one(&files[i], fps, reg_ref, opts_ref);
                    if tx.send(WorkerEvent::Finished(i, res)).is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx); // tum worker tx klonlari bitince rx kapanir.

        let mut done = 0usize;
        let mut active = BTreeSet::new();
        loop {
            let event = match rx.recv_timeout(Duration::from_secs(1)) {
                Ok(event) => event,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if stop.load(Ordering::Relaxed) {
                        break;
                    }
                    if !active.is_empty() {
                        on_progress(&progress);
                    }
                    continue;
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            };
            if stop.load(Ordering::Relaxed) {
                break; // iptal → kalan dosyalari yazma; asagidaki post-pass'ler atlanir
            }
            let (i, res) = match event {
                WorkerEvent::Started(i) => {
                    active.insert(i);
                    progress.active_paths = active
                        .iter()
                        .map(|&active_i| files[active_i].to_string_lossy().to_string())
                        .collect();
                    on_progress(&progress);
                    continue;
                }
                WorkerEvent::Finished(i, res) => {
                    active.remove(&i);
                    progress.active_paths = active
                        .iter()
                        .map(|&active_i| files[active_i].to_string_lossy().to_string())
                        .collect();
                    (i, res)
                }
            };
            done += 1;
            progress.processed = done;
            progress.current_path = files[i].to_string_lossy().to_string();
            if let Some((root_zero, scanned)) = scanned_roots
                .iter()
                .enumerate()
                .find(|(_, scanned)| i >= scanned.start && i < scanned.end)
            {
                progress.root_index = root_zero + 1;
                progress.current_root = scanned.root.to_string_lossy().to_string();
            }
            on_progress(&progress);

            match res {
                PrepResult::Skip => report.skipped += 1,
                PrepResult::Error(e) => {
                    report.failed += 1;
                    push_capped(
                        &mut report.errors,
                        &mut report.dropped_entries,
                        (files[i].to_string_lossy().to_string(), e),
                    );
                }
                PrepResult::Ready(boxed) => {
                    let mut p = *boxed;
                    match write_prepared(db, &mut p) {
                        Ok(()) => {
                            if p.is_update {
                                report.updated += 1;
                            } else {
                                report.added += 1;
                            }
                            *type_tally
                                .entry(p.ext.clone().unwrap_or_default())
                                .or_insert(0) += 1;
                            for w in p.warns {
                                push_capped(
                                    &mut report.warnings,
                                    &mut report.dropped_entries,
                                    (p.path.clone(), w),
                                );
                            }
                        }
                        Err(e) => {
                            report.failed += 1;
                            push_capped(
                                &mut report.errors,
                                &mut report.dropped_entries,
                                (p.path.clone(), e),
                            );
                        }
                    }
                }
            }
        }
    });

    // İptal edildi mi: bayrak run boyunca herhangi bir anda set edilmis olabilir (run BASINDA
    // false'a sifirlanir → sadece BU kosuya ait). true → YIKICI/POST-PASS adimlar atlanir.
    let stopped = stop.load(Ordering::Relaxed);
    // İPTAL: kismi tarama → bilgilendir + YIKICI/POST-PASS adimlarini ATLA (silme + proje-atama
    // yapma; yarim taramada bunlar yanlis). Yazilmis asset'ler DB'de kalir (artimsal).
    if stopped {
        report.cancelled = true;
        report.warnings.push((
            roots
                .iter()
                .map(|p| p.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" | "),
            "tarama iptal edildi (kismi sonuc; silme + proje-atama adimlari atlandi)".to_string(),
        ));
    }

    if !stopped {
        report.completed_roots = scanned_roots
            .iter()
            .filter(|scanned| root_accessible(&scanned.root))
            .map(|scanned| scanned.root.to_string_lossy().to_string())
            .collect();
    }

    // REPLACE: taranan kok altinda DB'de KAYITLI olup artik DISKTE olmayan dosyalari
    // COPE at (soft-delete; geri-alinabilir). Hata olumcul DEGIL (indeks zaten yazildi)
    // → uyari olarak kaydedilir; report.removed = cope atilan sayisi. İPTALDE ATLANIR.
    if !stopped && opts.mode == IngestMode::Replace {
        for scanned in &scanned_roots {
            match prune_missing(db, &scanned.root, &files[scanned.start..scanned.end]) {
                Ok(PruneOutcome::Pruned(n)) => report.removed += n,
                // Koruma silmeyi REDDETTI (kaynak yok/bos) → arsiv korundu; bilgilendirici uyari.
                Ok(PruneOutcome::Blocked(reason)) => {
                    report
                        .warnings
                        .push((scanned.root.to_string_lossy().to_string(), reason));
                }
                Err(e) => report.warnings.push((
                    scanned.root.to_string_lossy().to_string(),
                    format!("temizleme uyarisi: {e}"),
                )),
            }
        }
    }

    // OTO KLASOR→PROJE ATAMASI (post-pass): ana dongu + prune BITTIKTEN sonra, `root` altindaki
    // projesiz asset'leri klasor adindan turetilen projeye bagla (NULL-only → elle atamayi ezmez).
    // HATA POLITIKASI = BEST-EFFORT: asil indeksleme (per-asset yazim) zaten tamamlandi; bu
    // gruplama kolayligi bir post-pass'tir → hatasi basarili indeksi COPE ATMAMALI. Replace-prune
    // + sekil-persist ile ayni "post-pass hatasi = UYARI, olumcul degil" deseni. Hata YUTULMAZ:
    // uyari olarak rapora yazilir (sessiz kaybolmaz).
    if !stopped && opts.auto_project {
        let now_secs = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        for root in roots {
            let root_str = root.to_string_lossy();
            match db.auto_assign_projects_under(
                &root_str,
                now_secs,
                opts.auto_project_status.as_deref(),
            ) {
                Ok(rep) => report.auto_assigned += rep.assets_assigned as usize,
                Err(e) => report.warnings.push((
                    root_str.to_string(),
                    format!("oto proje atamasi uyarisi: {e}"),
                )),
            }
        }
    }

    // Son ozet: tam kosuda hepsi bitti; iptalde gercek tamamlanan sayac korunur.
    if !stopped {
        progress.processed = total;
    }
    progress.current_path = String::new();
    progress.active_paths.clear();
    if !stopped {
        progress.root_index = root_total;
    }
    progress.current_root = String::new();
    progress.cancelled = stopped;
    on_progress(&progress);

    report.elapsed_ms = started.elapsed().as_millis() as u64;
    // Deterministik goruntuleme sirasi: count azalan, esitlikte ext artan.
    let mut type_counts: Vec<(String, usize)> = type_tally.into_iter().collect();
    type_counts.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    report.type_counts = type_counts;
    report
}

/// Dosya iceren farkli klasor (ust-dizin) sayisi.
fn count_folders(files: &[PathBuf]) -> usize {
    files
        .iter()
        .filter_map(|p| p.parent())
        .collect::<HashSet<_>>()
        .len()
}

/// **Kaynak-yokluk koruması (H3 footgun-fix; H2'de YOK — RATIONALE: H2 hatalarini tekrarlama).**
/// Yikici tarama (Replace prune / Reset purge) bir kokun DISK durumuna gore arsiv kaydi siler.
/// Kok ERISILEMEZSE (yanlis makine / takilmamis disk / tasinmis klasor) tarama 0 dosya bulur →
/// naif silme "hepsi kaybolmus" sanip arsivi cope/purge edebilir. Kok bir DIZIN olarak
/// erisilebilir degilse `false` → cagiran yikici islemi REDDEDER (arsiv korunur).
/// `pub(crate)`: `staleness` modulu ayni **kok-erisilebilirlik kapisini** yeniden kullanir
/// (disk cikarilinca TUM asset "missing" false-positive'ini kapatir → "offline").
pub(crate) fn root_accessible(root: &Path) -> bool {
    root.is_dir()
}

/// Kok yolundan LIKE on-eki: sondaki ayrac(lar) atilir + tam bir `MAIN_SEPARATOR` eklenir
/// → yalniz bu klasorun ALTINDAKI yollar eslesir, kardes-on-ek DEGIL (or. "C:\proj"
/// "C:\projeler"i etkilemez). Taranan dosya yollari `root.join(...)` → ayni on-ekle baslar.
/// `pub(crate)`: `staleness` modulu de (gerekirse) kok on-eki turetimini paylasabilsin.
pub(crate) fn root_prefix(root: &Path) -> String {
    let s = root.to_string_lossy();
    let trimmed = s.trim_end_matches(['/', '\\']);
    format!("{trimmed}{}", std::path::MAIN_SEPARATOR)
}

#[cfg(test)]
mod concurrency_tests {
    use super::effective_concurrency;

    #[test]
    fn explicit_request_is_honored_and_capped_at_32() {
        assert_eq!(effective_concurrency(1), 1);
        assert_eq!(effective_concurrency(4), 4);
        assert_eq!(effective_concurrency(8), 8); // NVMe preset
        assert_eq!(effective_concurrency(16), 16);
        assert_eq!(effective_concurrency(100), 32, "tavan 32");
    }

    #[test]
    fn auto_is_storage_safe_and_deterministic() {
        assert_eq!(effective_concurrency(0), 1);
    }
}

#[cfg(test)]
mod cap_tests {
    use super::{push_capped, REPORT_MAX_ENTRIES};

    /// Tavana kadar EKLER, sonrasinda yalniz SAYAR — ve sayac dogru artar.
    /// (§6: sessiz kesme yerine "kac kayit dustu" bilgisi.)
    #[test]
    fn push_capped_stops_at_ceiling_and_counts_dropped() {
        let mut list: Vec<(String, String)> = Vec::new();
        let mut dropped = 0usize;
        let extra = 25usize;
        for i in 0..(REPORT_MAX_ENTRIES + extra) {
            push_capped(&mut list, &mut dropped, (format!("/p/{i}"), "x".into()));
        }
        assert_eq!(list.len(), REPORT_MAX_ENTRIES, "liste tavanda durmali");
        assert_eq!(dropped, extra, "tavan sonrasi her girdi SAYILMALI");
        // Ilk kayitlar korunur (ornekleme bastan alinir → en erken/temsili hatalar gorunur).
        assert_eq!(list[0].0, "/p/0");
        assert_eq!(
            list[REPORT_MAX_ENTRIES - 1].0,
            format!("/p/{}", REPORT_MAX_ENTRIES - 1)
        );
    }

    /// Tavan altinda hicbir sey dusmez (yaygin hâl bozulmamali).
    #[test]
    fn push_capped_is_transparent_below_ceiling() {
        let mut list: Vec<(String, String)> = Vec::new();
        let mut dropped = 0usize;
        for i in 0..5 {
            push_capped(&mut list, &mut dropped, (format!("/p/{i}"), "x".into()));
        }
        assert_eq!(list.len(), 5);
        assert_eq!(dropped, 0);
    }
}
