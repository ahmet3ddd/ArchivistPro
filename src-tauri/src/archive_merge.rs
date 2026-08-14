//! Arsiv BIRLESTIRME (merge/join) — komut cekirdegi. Import (butun-DB REPLACE) AKSINE **additive**:
//! ikinci bir `.archivistpro`'nun asset'lerini CANLI arsive EKLER (kaynak degismez, hedef buyur).
//!
//! Veri cekirdegi `archivist-db::merge` (`Db::merge_from` = TEK transaction → atomik rollback;
//! content_hash disposition + id-remap + tag/collection isim-uzlastirma + FTS body). Bu modul
//! yalniz komut-katmani orkestrasyonu: guvenlik-yedegi (defense-in-depth), Channel faz-ilerlemesi
//! ve yol-remap ciftlerine cevirme. Ince `#[tauri::command]` sarmalayicilar
//! `archive_share_commands.rs`'te (import ile ayni desen: `require_admin`, kilit, audit).
//!
//! Cekirdek (`do_merge`/`do_merge_preview`) Tauri'siz → birim test edilebilir (archive_share deseni).

use std::path::Path;

use archivist_db::{Db, MergeDisposition, MergePreview, MergeReport};
use serde::Serialize;

use crate::archive_share::Remap;

/// Merge ilerlemesi (Channel → frontend cubugu). `phase`:
/// `"validating"` | `"backingUp"` | `"merging"` | `"done"`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MergeProgress {
    phase: String,
}

/// Disposition string'ini (frontend: `"skipDuplicates"` | `"importAll"`) enum'a cevir. Bilinmeyen
/// → guvenli varsayilan `SkipDuplicates` (yinelenen icerigi almaz; yikici olmayan taraf).
fn parse_disposition(s: &str) -> MergeDisposition {
    match s {
        "importAll" => MergeDisposition::ImportAll,
        _ => MergeDisposition::SkipDuplicates,
    }
}

/// **Preview cekirdegi (saf, YAZMA YOK).** Kaynak arsivi salt-okuma ATTACH edip sayimlari doner
/// (toplam / yinelenen / yol-cakismasi) — frontend merge oncesi kullaniciya gosterir.
pub(crate) fn do_merge_preview(db: &Db, src_path: &Path) -> Result<MergePreview, String> {
    db.merge_preview(src_path).map_err(|e| e.to_string())
}

/// **Merge cekirdegi (saf).** Guvenlik-yedegi → `merge_from` (tek TX, atomik) → rapor.
///
/// `merge_from` zaten atomiktir (hata → tam ROLLBACK, arsiv degismez); guvenlik-yedegi yine de
/// alinir (komut-disi/beklenmedik bir hata durumunda kullaniciya manuel geri-donus dosyasi kalir —
/// do_import ile ayni defense-in-depth). `disposition` string frontend'ten; `remaps` bos hedefli
/// kurallar atlanir (do_import ile ayni kural); bos liste → yollar aynen.
pub(crate) fn do_merge(
    db: &mut Db,
    src_path: &Path,
    disposition: &str,
    remaps: &[Remap],
    snapshots_dir: &Path,
    mut emit: impl FnMut(MergeProgress),
) -> Result<MergeReport, String> {
    emit(MergeProgress { phase: "validating".into() });

    // Guvenlik yedegi (rollback agi). Ad app-uretimli (kullanici girdisi yok) → yol-gezinme yok.
    emit(MergeProgress { phase: "backingUp".into() });
    let safety = snapshots_dir.join(format!("pre-merge-{}.db", crate::backup_commands::now_ms()));
    db.backup_to(&safety).map_err(|e| format!("guvenlik yedegi alinamadi: {e}"))?;

    // Yol-remap ciftleri (bos hedef → o kural atlanir; do_import ile ayni kural).
    let remap_pairs: Vec<(String, String)> = remaps
        .iter()
        .filter(|r| !r.new_root.is_empty())
        .map(|r| (r.old_root.clone(), r.new_root.clone()))
        .collect();

    emit(MergeProgress { phase: "merging".into() });
    let report = db
        .merge_from(src_path, parse_disposition(disposition), &remap_pairs)
        .map_err(|e| e.to_string())?;

    emit(MergeProgress { phase: "done".into() });
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Disposition string eslemesi: bilinen degerler + bilinmeyen → guvenli varsayilan.
    #[test]
    fn parse_disposition_maps_known_and_defaults_safe() {
        assert!(matches!(parse_disposition("importAll"), MergeDisposition::ImportAll));
        assert!(matches!(parse_disposition("skipDuplicates"), MergeDisposition::SkipDuplicates));
        // Bilinmeyen / bos → yikici-olmayan varsayilan (yinelenenleri almaz).
        assert!(matches!(parse_disposition("garbage"), MergeDisposition::SkipDuplicates));
        assert!(matches!(parse_disposition(""), MergeDisposition::SkipDuplicates));
    }
}
