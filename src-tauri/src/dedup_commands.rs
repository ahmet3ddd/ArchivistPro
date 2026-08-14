//! Yinelenen/benzer dosya tespiti komutu (P3 dedup) — H2 "Kopya Bulucu" pariti, ama hesap
//! RENDERER'da DEGIL Rust+DB'de (H3 tezi). Modlar bayrakla secilir: birebir (content_hash) ·
//! ayni-ad (file_name) · gorsel-benzer (phash Hamming <= esik) · yapisal-benzer (DXF/DWG sekil
//! geometrisi Jaccard >= esik). Salt-okuma (her rol; silme kullanicinin ayri cop/purge
//! komutlariyla). `async` → uzun gorsel/yapisal tarama UI'yi dondurmez.

use std::sync::atomic::{AtomicBool, Ordering};

use archivist_db::{DbError, DupGroup, DupMember};
use serde::Serialize;
use tauri::State;

use crate::AppState;

/// Kopya taramasi IPTAL bayragi (modul-global; `INGEST_STOP` deseni).
///
/// **NEDEN (2026-07-28 UI/UX denetimi Y1):** gorsel/yapisal tarama O(n²) ve komut TUM SURE
/// `state.db` kilidini tutuyor. Iptal yolu YOKKEN kullanici paneli kapatsa bile hesap devam
/// ediyor, kilit suruyor ve **tum uygulama aciklamasiz doniyordu** ("program bozuldu").
///
/// ⚠️ `cancel_find_duplicates` **DB'ye DOKUNMAZ / gate YOK** — `INGEST_STOP` ile ayni gerekce:
/// kilit-alan bir iptal komutu tarama bitene kadar bloke olurdu (iptal asla varmazdi).
/// Salt-atomic set → aninda etkili.
static DEDUP_STOP: AtomicBool = AtomicBool::new(false);

/// Devam eden kopya taramasini DURDUR. Tarama yoksa zararsiz (sonraki tarama basta sifirlar).
/// Panel kapanisinda da cagrilir — arka planda "hayalet" tarama kalmasin.
#[tauri::command(async)]
pub fn cancel_find_duplicates() {
    DEDUP_STOP.store(true, Ordering::SeqCst);
}

/// Yineleme grubu uyesi — IPC bicimi (camelCase).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupMemberDto {
    id: i64,
    path: String,
    file_name: String,
    size_bytes: i64,
}

impl From<DupMember> for DupMemberDto {
    fn from(m: DupMember) -> Self {
        DupMemberDto { id: m.id, path: m.path, file_name: m.file_name, size_bytes: m.size_bytes }
    }
}

/// Yineleme grubu — IPC bicimi. `kind`: `exact_hash` | `same_name` | `visual_similar` |
/// `structural_similar`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupGroupDto {
    kind: String,
    score: u32,
    members: Vec<DupMemberDto>,
}

impl From<DupGroup> for DupGroupDto {
    fn from(g: DupGroup) -> Self {
        DupGroupDto {
            kind: g.kind.as_str().to_string(),
            score: g.score,
            members: g.members.into_iter().map(DupMemberDto::from).collect(),
        }
    }
}

/// Tarama raporu — gruplar + ozet sayimlar (UI rozet/bos-durum).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateReportDto {
    groups: Vec<DupGroupDto>,
    total_groups: usize,
    total_files: usize,
    /// Tarama kullanici tarafindan IPTAL edildi mi.
    ///
    /// Ayri bayrak SART: iptalde bos rapor dondurup `cancelled` demeseydik UI *"kopya
    /// bulunamadi"* gosterirdi — sessiz yanlis cevap (H3'un tekrar tekrar kacindigi sinif).
    /// `true` iken `groups` DAIMA bostur: yarim kalmis union-find'in kismi sonucu yaniltici
    /// olurdu (eksik gruplar "tam liste" gibi gorunurdu).
    cancelled: bool,
}

/// Yineleme taramasi (istek-uzeri). Secili modlari kosar; gorsel esigi Hamming mesafesi (0-64;
/// kucuk = daha kati); yapisal esigi `structural_min_score` (0-100 yuzde; buyuk = daha kati).
/// Salt-okuma (her rol). Buyuk arsivde gorsel/yapisal O(n^2) → `async` (thread havuzu).
#[tauri::command]
pub async fn find_duplicates(
    exact: bool,
    same_name: bool,
    visual: bool,
    visual_max_distance: u32,
    structural: bool,
    structural_min_score: u32,
    state: State<'_, AppState>,
) -> Result<DuplicateReportDto, String> {
    // Her tarama BASTA bayragi sifirlar (onceki kosunun iptali bu kosuyu oldurmesin) —
    // `ingest_folder` ile ayni desen.
    DEDUP_STOP.store(false, Ordering::SeqCst);
    let should_stop = || DEDUP_STOP.load(Ordering::Relaxed);

    let db = state.db.lock().map_err(|e| e.to_string())?;
    let mut groups: Vec<DupGroupDto> = Vec::new();

    /// Iptali hatadan ayirir: `Cancelled` → bos+iptal raporu, digerleri → hata.
    macro_rules! run_mode {
        ($call:expr) => {
            match $call {
                Ok(v) => groups.extend(v.into_iter().map(DupGroupDto::from)),
                Err(DbError::Cancelled) => {
                    return Ok(DuplicateReportDto {
                        groups: Vec::new(),
                        total_groups: 0,
                        total_files: 0,
                        cancelled: true,
                    })
                }
                Err(e) => return Err(e.to_string()),
            }
        };
    }

    // Ucuz (SQL-tarafi) modlar once — iptal yoklamasi gerektirmez, ama aralarinda bayrak
    // kontrolu var ki "yalniz gorsel secili degilse iptal calismaz" durumu olusmasin.
    if exact {
        run_mode!(db.duplicate_exact());
    }
    if same_name {
        run_mode!(db.duplicate_same_name());
    }
    if visual {
        run_mode!(db.duplicate_visual(visual_max_distance.min(64), &should_stop));
    }
    if structural {
        run_mode!(db.duplicate_structural(structural_min_score.min(100), &should_stop));
    }

    let total_files = groups.iter().map(|g| g.members.len()).sum();
    Ok(DuplicateReportDto {
        total_groups: groups.len(),
        total_files,
        groups,
        cancelled: false,
    })
}
