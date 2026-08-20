//! Secilenleri yeniden-indeksle (P3) — cikarici iyilesince (or. PSD/EPS thumbnail) MEVCUT
//! asset'leri geri-doldur. Eski `reindex` stub'inin gercek karsiligi.
//!
//! Zorla re-extract (skip YOK); asset **id KORUNUR** (upsert `ON CONFLICT(path)` → etiket/favori/
//! koleksiyon/iliski/ai_ metadata sag kalir). Kaynak dosya baska makinedeyse graceful atlanir
//! (`missing`; cok-lokasyon gercegi). **Admin** (ingest gibi yazma/re-process). Best-effort audit.

use archivist_ingest::ReindexReport;
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::commands::IngestWarning;
use crate::{audit, indexer, rbac, AppState};

/// Yeniden-indeks ilerlemesi (Channel → UI cubugu).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReindexProgress {
    processed: usize,
    total: usize,
}

/// Yeniden-indeks ozeti (renderer'a doner).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReindexReportDto {
    reindexed: usize,
    /// Kaynak dosya bu makinede erisilemez (baska lokasyon).
    missing: usize,
    failed: usize,
    warnings: Vec<IngestWarning>,
    errors: Vec<IngestWarning>,
}

impl From<ReindexReport> for ReindexReportDto {
    fn from(r: ReindexReport) -> Self {
        let map = |v: Vec<(String, String)>| -> Vec<IngestWarning> {
            v.into_iter().map(|(path, message)| IngestWarning { path, message }).collect()
        };
        ReindexReportDto {
            reindexed: r.reindexed,
            missing: r.missing,
            failed: r.failed,
            warnings: map(r.warnings),
            errors: map(r.errors),
        }
    }
}

/// Secili asset'leri **zorla yeniden-indeksle** (id'ler → yollar → re-extract → upsert). **Admin**.
/// `async` — hash+extract yavas olabilir → UI donmaz (thread havuzu; govde bloklayici, `.await` yok).
/// Kaynak dosya bu makinede yoksa `missing`. Yeniden-cikarim yeni thumbnail/phash uretebilir →
/// sonrasinda oto-indeks tik'i (or. yeni thumbnail'li gorsel artik gorsel-embed'e uygun).
#[tauri::command]
pub async fn reindex_assets(
    ids: Vec<i64>,
    on_progress: Channel<ReindexProgress>,
    state: State<'_, AppState>,
) -> Result<ReindexReportDto, String> {
    let role = rbac::current_role(&state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())?;
    let actor = audit::actor(&state);

    // Yollari OKU — salt-okuma baglantisi (yazma kilidine hic dokunmaz).
    let paths = {
        let db = state.read_db.lock().map_err(|e| e.to_string())?;
        db.paths_for_ids(&ids).map_err(|e| e.to_string())?
    };

    // ⚠️ KILIT DOSYA-BASI (2026-08-20 kullanici bulgusu): eskiden `state.db` kilidi TUM batch
    // boyunca tutuluyordu → ayni anda kosan AI gorsel-analizi ilk kilit talebinde donuyor, "İptal"
    // de cevapsiz kaliyordu (bayrak set edilir ama dongu kilidi geri alamaz; DWG'de dosya basina
    // 300sn'e kadar). Artik YAVAS kisim (hash+extract) kilitsiz kosar, kilit yalniz KISA yazim
    // adiminda alinir → analiz/gezinme aradan gecebilir.
    let report = archivist_ingest::reindex_paths_with(
        &state.registry,
        &paths,
        |prep| {
            let mut db = state.db.lock().map_err(|e| e.to_string())?;
            archivist_ingest::reindex_write(&mut db, prep)
        },
        |processed, total| {
            let _ = on_progress.send(ReindexProgress { processed, total });
        },
    );

    // Ozet audit — TEK kisa kilit (batch bitti).
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        audit::record_on(
            &db,
            &actor,
            "reindex",
            Some("asset"),
            None,
            Some(&format!(
                "{} yeniden / {} eksik / {} hata ({} istendi)",
                report.reindexed,
                report.missing,
                report.failed,
                ids.len()
            )),
        );
    }

    // Yeni thumbnail'li gorsel → gorsel-embed bekleyeni olusabilir → oto-indeks surucusune tik.
    indexer::signal_index();
    Ok(report.into())
}
