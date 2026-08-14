//! Arsiv guncellik (**staleness**) + **fixity** (bit-rot) denetimi — Doctor'un
//! dosya-sistemi ayagi (butunluk/orphan/purge `archivist-db::health`'in kardesi).
//!
//! Uc sinyal AYRI maliyet profilinde calisir (H2 dersi):
//! - **staleness** (ucuz/sik): yalniz `fs::metadata` stat — mtime/varlik farki.
//! - **fixity** (pahali/orneklem): dosyayi yeniden BLAKE3'le → ingest-ani baseline ile
//!   karsilastir (sessiz bit-rot suphesi). Tum arsivi degil, deterministik bir ORNEKLEM.
//!
//! **SONUC DB'ye YAZILMAZ** — bu on-demand bir rapordur (baseline'lar zaten `assets`'te).
//! Renderer DB tutmaz → tarama TEK Rust cagrisinda (Tauri komutu bu cekirdegi cagirir).
//!
//! **Kok-erisilebilirlik kapisi (H2 false-positive fix):** disk cikarilinca / ag yolu
//! dususunde naif kontrol TUM asset'i "missing" sanip alarm uretir. Burada asset'in
//! ust-dizini [`root_accessible`] ile bir kez denetlenir (kok basi cache) → erisilemezse
//! `Offline` (silinmis DEGIL; "dogrulanamadi"). Prune-koruma mantiginin (prepare.rs) esi.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use archivist_db::{AssetFsMeta, Db, DbError};

use crate::hash::blake3_file;
use crate::pipeline::root_accessible;

/// mtime karsilastirma tolerans penceresi (saniye). Dosya-sistemi/sync zaman dalgalanmasi
/// (kopyalama, FAT 2-sn cozunurluk, ag saat kaymasi) yanlis "stale" uretmesin → ±2 sn (H2 pariti).
const MTIME_TOLERANCE_SECS: i64 = 2;

/// Rapor ornek tavani — ilk ~200 problemli girdi (UI listesi; gurultuyu ve payload'i sinirlar).
const SAMPLE_CAP: usize = 200;
/// Office biçim denetiminde okunacak imza uzunluğu. Yalnız ilk baytlar yeterlidir;
/// büyük arşivde dosyanın tamamını/ZIP dizinini açmak kasıtlı olarak yapılmaz.
const OFFICE_MAGIC_LEN: usize = 8;

// ── Staleness (guncellik/varlik) ─────────────────────────────────────────────

/// Bir asset'in disk-vs-DB guncellik durumu.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum StaleKind {
    /// Disk'te var + mtime (±tolerans) DB ile ayni.
    Ok,
    /// Disk'te var ama mtime DB'den farkli (disk-disi degistirilmis → yeniden-indeks gerekir).
    Stale,
    /// Kok erisilebilir ama dosya yok/stat edilemiyor (gercekten silinmis/tasinmis).
    Missing,
    /// Asset'in kok'u (ust-dizini) erisilemez — disk cikarilmis/ag dususu. Silinmis DEGIL;
    /// "dogrulanamadi". Rapor orneklerine GIRMEZ (gurultu), yalniz sayilir.
    Offline,
}

/// Problemli tek asset girdisi (staleness ornegi).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleItem {
    pub id: i64,
    pub path: String,
    pub kind: StaleKind,
}

/// Kart/listede rozetlemek için tüm problemli kayıtların hafif kimlik+tür özeti. Yol taşımaz;
/// büyük arşivde örnek listesinin aksine eksiksiz görünürlük sağlar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleStatus {
    pub id: i64,
    pub kind: StaleKind,
}

/// Staleness denetim özeti — sayımlar + ilk ~200 yollu örnek + tüm problemli kimlik/türleri.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StalenessReport {
    /// Denetlenen aktif asset toplami (`ok + stale + missing + offline`).
    pub total: i64,
    pub ok: i64,
    pub stale: i64,
    pub missing: i64,
    pub offline: i64,
    /// İlk ~200 problemli ornek: **stale + missing** (offline HARIC — gurultu).
    pub samples: Vec<StaleItem>,
    /// Tüm problemli kayıtlar: stale + missing. Kart rozeti bu eksiksiz, yolsuz diziyi
    /// kullanır; offline belirsiz olduğu için bilerek dahil edilmez.
    pub problem_statuses: Vec<StaleStatus>,
}

// ── Office eski-biçim denetimi ──────────────────────────────────────────────

/// Doctor'un Office dosya-imzası denetim sonucu. Bu kontrol salt tanıdır:
/// dosyayı dönüştürmez, yeniden adlandırmaz veya DB'ye yazmaz.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OfficeFormatKind {
    /// `.doc` / `.xls` / `.ppt` uzantılı gerçek OLE/CFB ikili Office belgesi.
    LegacyBinary,
    /// Uzantı ve imza ailesi çelişiyor (örn. `.docx` ama OLE ikili içerik).
    ExtensionMismatch,
    /// Office uzantısı var ama dosya ne OLE ne de ZIP/OOXML imzası taşıyor.
    Unknown,
}

/// Eski/uyuşmayan bir Office dosyasının yollu örneği.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeFormatItem {
    pub id: i64,
    pub path: String,
    pub kind: OfficeFormatKind,
}

/// Office biçim denetim özeti. `checked` yalnız desteklenen Microsoft Office
/// uzantılarını sayar; erişilemeyen dosyalar bu raporda yinelenmez, Staleness
/// bölümünün Missing/Offline sonucunda görünür.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeFormatReport {
    pub checked: i64,
    pub legacy_binary: i64,
    pub extension_mismatch: i64,
    pub unknown: i64,
    /// İlk ~200 tanı örneği (eski ikili + çelişen + tanımsız).
    pub items: Vec<OfficeFormatItem>,
}

// ── Fixity (bit-rot / icerik butunlugu) ──────────────────────────────────────

/// Bir asset'in yeniden-hash sonucu (baseline ile karsilastirma).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FixityKind {
    /// Yeniden hesaplanan BLAKE3 == ingest-ani baseline (icerik saglam).
    Ok,
    /// Hash farkli — icerik degismis (bit-rot suphesi veya disk-disi duzenleme).
    Mismatch,
    /// Dosya yok/acilamiyor (hash hesaplanamadi).
    Missing,
    /// Baseline (content_hash) yok — orneklemden ON-FILTRE ile dislanir; savunma degeri.
    NoBaseline,
}

/// Problemli tek asset girdisi (fixity ornegi).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixityItem {
    pub id: i64,
    pub path: String,
    pub kind: FixityKind,
}

/// Fixity denetim ozeti — orneklenen sayisi + sonuc sayimlari + mismatch/missing listesi.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixityReport {
    /// Gercekten yeniden-hash'lenen (orneklenen) asset sayisi (`ok + mismatch + missing + no_baseline`).
    pub sampled: i64,
    pub ok: i64,
    pub mismatch: i64,
    pub missing: i64,
    pub no_baseline: i64,
    /// Bit-rot/erisim suphesi girdileri: **mismatch + missing** (ilk ~200).
    pub mismatches: Vec<FixityItem>,
}

// ── Cekirdek fonksiyonlar ─────────────────────────────────────────────────────

/// **Staleness denetimi** (ucuz/sik — yalniz stat). Tum aktif asset icin: kok (ust-dizin)
/// erisilebilir mi (kok-basi cache) → hayirsa `Offline`; evetse `fs::metadata` → yok →
/// Missing, mtime ±2 sn farkli → Stale, degilse Ok. Sayimlar + ilk ~200 yollu örnek +
/// tüm stale/missing kimlikleri döner.
pub fn check_staleness(db: &Db) -> Result<StalenessReport, DbError> {
    check_staleness_rows(db.active_assets_fs_meta()?)
}

/// Cekirdek: onceden cekilmis satirlar uzerinde stat yuruyusu — **DB kilidi GEREKTIRMEZ**.
///
/// NEDEN AYRI (2026-08-11 donma dersi): cagiran `check_staleness(db)`'yi bir baglanti
/// mutex'i ALTINDA kosarsa, binlerce `fs::metadata` (kopuk ag surucusunde stat basina
/// saniyeler) o mutex'i tutarak yurur ve ayni baglantiyi bekleyen HER komutu asili birakir.
/// Komut katmani dogru kullanim: kisa kilitle satirlari cek → kilidi BIRAK → bunu cagir.
pub fn check_staleness_rows(assets: Vec<AssetFsMeta>) -> Result<StalenessReport, DbError> {
    let mut report = StalenessReport {
        total: assets.len() as i64,
        ok: 0,
        stale: 0,
        missing: 0,
        offline: 0,
        samples: Vec::new(),
        problem_statuses: Vec::new(),
    };
    // Kok-erisilebilirlik cache'i: ayni ust-dizin icin yalniz bir kez `is_dir` stat'la
    // (100K asset / birkac bin klasor → tekrar stat'lari eler; H2 false-positive kapisi).
    let mut root_cache: HashMap<String, bool> = HashMap::new();

    for a in &assets {
        match classify_staleness(a, &mut root_cache) {
            StaleKind::Ok => report.ok += 1,
            StaleKind::Offline => report.offline += 1, // ornege GIRMEZ (gurultu)
            kind @ StaleKind::Stale => {
                report.stale += 1;
                push_stale(&mut report.samples, a, kind);
                report.problem_statuses.push(StaleStatus { id: a.id, kind });
            }
            kind @ StaleKind::Missing => {
                report.missing += 1;
                push_stale(&mut report.samples, a, kind);
                report.problem_statuses.push(StaleStatus { id: a.id, kind });
            }
        }
    }
    Ok(report)
}

/// **Eski Office biçimi denetimi:** aktif Microsoft Office dosyalarının yalnız
/// ilk 8 baytını okur. OLE/CFB (`D0 CF 11 E0 A1 B1 1A E1`) eski ikili
/// DOC/XLS/PPT ailesidir; ZIP (`PK`) OOXML ailesidir. Böylece hem gerçek eski
/// belgeler hem de modern/legacy uzantı-içerik çelişkileri görünür olur.
///
/// Bu bilerek dönüşüm önerisi/otomasyonu değildir: H3 eski dosyaları zaten
/// indeksleyebilir; Doctor yalnız sahibine modern OOXML'e yeniden kaydetmek
/// isteyebileceği kayıtları gösterir. Dosya okunamıyorsa Staleness sonucu esas
/// doğruluk kaynağıdır; burada ikinci bir Missing alarmı üretilmez.
pub fn check_office_formats(db: &Db) -> Result<OfficeFormatReport, DbError> {
    let assets = db.active_assets_fs_meta()?;
    let mut report = OfficeFormatReport {
        checked: 0,
        legacy_binary: 0,
        extension_mismatch: 0,
        unknown: 0,
        items: Vec::new(),
    };

    for asset in &assets {
        let Some(family) = office_extension_family(Path::new(&asset.path)) else {
            continue;
        };
        let Some(signature) = read_office_signature(Path::new(&asset.path)) else {
            continue;
        };
        report.checked += 1;
        let kind = match (family, office_magic_kind(&signature)) {
            (OfficeExtensionFamily::Legacy, OfficeMagicKind::Ole) => {
                Some(OfficeFormatKind::LegacyBinary)
            }
            (OfficeExtensionFamily::Modern, OfficeMagicKind::Zip) => None,
            (OfficeExtensionFamily::Legacy, OfficeMagicKind::Zip)
            | (OfficeExtensionFamily::Modern, OfficeMagicKind::Ole) => {
                Some(OfficeFormatKind::ExtensionMismatch)
            }
            (_, OfficeMagicKind::Unknown) => Some(OfficeFormatKind::Unknown),
        };
        let Some(kind) = kind else {
            continue;
        };
        match kind {
            OfficeFormatKind::LegacyBinary => report.legacy_binary += 1,
            OfficeFormatKind::ExtensionMismatch => report.extension_mismatch += 1,
            OfficeFormatKind::Unknown => report.unknown += 1,
        }
        if report.items.len() < SAMPLE_CAP {
            report.items.push(OfficeFormatItem {
                id: asset.id,
                path: asset.path.clone(),
                kind,
            });
        }
    }

    Ok(report)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OfficeExtensionFamily {
    Legacy,
    Modern,
}

/// H3 extractor'ünün desteklediği Microsoft Office uzantıları. ODF ayrı bir
/// aile olduğundan bu binary→OOXML denetiminin dışında tutulur.
fn office_extension_family(path: &Path) -> Option<OfficeExtensionFamily> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "doc" | "xls" | "ppt" => Some(OfficeExtensionFamily::Legacy),
        "docx" | "xlsx" | "xlsm" | "xltx" | "xltm" | "pptx" => {
            Some(OfficeExtensionFamily::Modern)
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum OfficeMagicKind {
    Ole,
    Zip,
    Unknown,
}

fn read_office_signature(path: &Path) -> Option<[u8; OFFICE_MAGIC_LEN]> {
    let mut file = fs::File::open(path).ok()?;
    let mut signature = [0_u8; OFFICE_MAGIC_LEN];
    // Boş/kısa dosya da Unknown olarak raporlanmalı; read_exact kullanmak onu
    // erişilemeyen dosyayla aynı sepete atıp görünmez kılardı.
    let _ = file.read(&mut signature).ok()?;
    Some(signature)
}

fn office_magic_kind(signature: &[u8; OFFICE_MAGIC_LEN]) -> OfficeMagicKind {
    // Compound File Binary (DOC/XLS/PPT legacy) imzası.
    if signature == b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" {
        OfficeMagicKind::Ole
    } else if signature.starts_with(b"PK") {
        // ZIP local-header / empty-archive / spanning archive varyantları.
        OfficeMagicKind::Zip
    } else {
        OfficeMagicKind::Unknown
    }
}

/// Tek asset'in staleness sinifi. Kok-erisilebilirlik kapisi (offline-guard) ust-dizin
/// bazinda; erisilebilir kok altinda dosya stat'i mtime/varlik belirler.
fn classify_staleness(a: &AssetFsMeta, root_cache: &mut HashMap<String, bool>) -> StaleKind {
    let path = Path::new(&a.path);
    // Kok = asset'in ust-dizini. Erisilemezse (disk cikarilmis/ag dususu) → Offline; boylece
    // "hepsi missing" false-positive'i olusmaz. Ust-dizin yoksa (ciplak kok yol) kapiyi atla.
    if let Some(parent) = path.parent() {
        let key = parent.to_string_lossy().into_owned();
        let accessible =
            *root_cache.entry(key).or_insert_with(|| root_accessible(parent));
        if !accessible {
            return StaleKind::Offline;
        }
    }
    match fs::metadata(path) {
        Err(_) => StaleKind::Missing, // kok erisilebilir ama dosya yok → gercekten silinmis
        Ok(meta) => {
            let disk_mtime = sys_secs(meta.modified().ok()).unwrap_or(0);
            if (disk_mtime - a.modified_at).abs() > MTIME_TOLERANCE_SECS {
                StaleKind::Stale
            } else {
                StaleKind::Ok
            }
        }
    }
}

/// **Fixity denetimi** (pahali/orneklem — rehash). Aktif + baseline'li (`content_hash`
/// dolu) asset'lerden `sample_pct`%'ini deterministik STRIDE ile sec (rand YOK), her birini
/// yeniden BLAKE3'le: dosya yok → `Missing`, hash == baseline → `Ok`, degilse `Mismatch`.
/// `sample_pct` 1..=100'e kelepcelenir (0→1, 200→100). Sayimlar + mismatch/missing listesi.
pub fn check_fixity(db: &Db, sample_pct: u8) -> Result<FixityReport, DbError> {
    let pct = sample_pct.clamp(1, 100) as usize;
    let assets = db.active_assets_fs_meta()?;
    // ON-FILTRE: yalniz baseline'li asset'ler orneklenebilir → ornek "bosa" harcanmaz
    // (baseline'siz asset icin fixity anlamsiz). path ASC korunur (deterministik STRIDE).
    let with_hash: Vec<&AssetFsMeta> =
        assets.iter().filter(|a| a.content_hash.is_some()).collect();

    // STRIDE = ceil(100/pct): pct=10 → her 10.; pct=100 → her 1. (hepsi); pct=1 → her 100.
    // Deterministik (indeks 0'dan baslar) → tekrar-calistirmada ayni ornek (izlenebilir).
    let stride = 100usize.div_ceil(pct).max(1);

    let mut report = FixityReport {
        sampled: 0,
        ok: 0,
        mismatch: 0,
        missing: 0,
        no_baseline: 0,
        mismatches: Vec::new(),
    };

    for &a in with_hash.iter().step_by(stride) {
        report.sampled += 1;
        match a.content_hash.as_deref() {
            // Savunma: on-filtre bunu dislamali; yine de guvenli say (asla panik/atla degil).
            None => {
                report.no_baseline += 1;
                push_fixity(&mut report.mismatches, a, FixityKind::NoBaseline);
            }
            Some(baseline) => match blake3_file(Path::new(&a.path)) {
                Err(_) => {
                    report.missing += 1;
                    push_fixity(&mut report.mismatches, a, FixityKind::Missing);
                }
                Ok(h) if h == baseline => report.ok += 1,
                Ok(_) => {
                    report.mismatch += 1;
                    push_fixity(&mut report.mismatches, a, FixityKind::Mismatch);
                }
            },
        }
    }
    Ok(report)
}

/// SystemTime → unix saniye (epoch oncesi/gecersiz → `None`). prepare.rs ile ayni desen.
fn sys_secs(t: Option<SystemTime>) -> Option<i64> {
    t?.duration_since(UNIX_EPOCH).ok().map(|d| d.as_secs() as i64)
}

/// Staleness ornegini tavana kadar biriktir (ilk ~200; sonrasi sayilir ama listelenmez).
fn push_stale(samples: &mut Vec<StaleItem>, a: &AssetFsMeta, kind: StaleKind) {
    if samples.len() < SAMPLE_CAP {
        samples.push(StaleItem { id: a.id, path: a.path.clone(), kind });
    }
}

/// Fixity ornegini tavana kadar biriktir (ilk ~200).
fn push_fixity(items: &mut Vec<FixityItem>, a: &AssetFsMeta, kind: FixityKind) {
    if items.len() < SAMPLE_CAP {
        items.push(FixityItem { id: a.id, path: a.path.clone(), kind });
    }
}
