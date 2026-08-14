//! Arsiv EXTRACT (filtreli cikarma) — komut cekirdegi. Mevcut arsivin bir ALT-KUMESINI (facet
//! filtreleriyle) yeni bir `.archivistpro`'ya cikarir (import/merge/peek ile uyumlu — merge'in
//! dogal tamamlayicisi). Mekanizma: `do_export` (tam kopya + manifest) REUSE → KOPYADA
//! `retain_matching` (eslesmeyenleri sil + yetim temizle) → manifest'in budamadan etkilenen 3
//! anahtarini (asset_count/roots/prefix) budanmis kopyadan tazele → VACUUM (dosyayi kucult).
//! `move` modu: cikarilanlari KANITLANMIS kopyalama sonrasi kaynaktan soft-delete (cop; geri-alinabilir).
//! DB primitifleri `archivist-db::extract` (`ids_matching`/`retain_matching`).

use std::path::Path;

use archivist_db::{Db, ListOpts};
use serde::Serialize;

use crate::archive_share::{
    do_export, upsert_meta, EXPORT_ASSET_COUNT, EXPORT_SAMPLE_PREFIX, EXPORT_SOURCE_ROOTS,
};

/// Extract ilerlemesi (Channel → frontend). `phase`:
/// `"preparing"` | `"copying"` | `"pruning"` | `"removing"` | `"done"`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtractProgress {
    phase: String,
}

/// Extract sonucu (renderer'a doner).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractReport {
    /// Cikarilan (yeni arsivdeki) aktif asset sayisi.
    pub(crate) extracted: i64,
    /// `move` modunda kaynaktan soft-delete edilen (cope tasinan) sayi; `copy` modunda 0.
    pub(crate) removed: i64,
    /// `move` modu muydu.
    pub(crate) moved: bool,
    /// Olusan `.archivistpro` boyutu (bayt; VACUUM sonrasi).
    size_bytes: u64,
    /// Yazilan dosya yolu.
    path: String,
}

/// **Extract cekirdegi (saf).** Filtreye uyan asset'leri (+ iliskili veri) yeni `.archivistpro`'ya
/// cikarir. `opts` = facet filtresi (ext/tag/collection/tarih/onay/proje/yol; FTS `query` yok sayilir).
/// `move_mode=true` → kopyalama BASARILI olduktan sonra kaynaktan soft-delete (cop). Filtreye uyan
/// asset yoksa Err (bos arsiv uretmez; H2 pariti).
pub(crate) fn do_extract(
    live: &mut Db,
    dest_path: &Path,
    opts: &ListOpts,
    move_mode: bool,
    mut emit: impl FnMut(ExtractProgress),
) -> Result<ExtractReport, String> {
    emit(ExtractProgress { phase: "preparing".into() });
    // 1) Eslesen id kumesi (count guard + move-set). Bos → cikarilacak sey yok.
    let ids = live.ids_matching(opts).map_err(|e| e.to_string())?;
    if ids.is_empty() {
        return Err("filtreye uyan asset yok — cikarilacak bir sey yok".to_string());
    }

    // 2) Tam kopya + manifest (do_export REUSE; canli stats → 3) budama sonrasi tazelenir).
    emit(ExtractProgress { phase: "copying".into() });
    do_export(live, dest_path, |_| {})?;

    // 3) KOPYADA budama + manifest tazeleme + VACUUM (dosyayi kucult).
    emit(ExtractProgress { phase: "pruning".into() });
    let extracted = {
        let mut copy = Db::open_and_migrate(dest_path).map_err(|e| e.to_string())?;
        let n = copy.retain_matching(opts).map_err(|e| e.to_string())?;
        let roots_json = serde_json::to_string(&copy.scan_roots().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let paths = copy.sample_asset_paths(i64::MAX).map_err(|e| e.to_string())?;
        let prefix = archivist_db::portable::common_prefix(&paths);
        {
            let conn = copy.connection();
            // Manifest'in budamadan etkilenen 3 alanini KOPYADAN tazele (digerleri do_export'tan dogru).
            upsert_meta(conn, EXPORT_ASSET_COUNT, &n.to_string())?;
            upsert_meta(conn, EXPORT_SOURCE_ROOTS, &roots_json)?;
            upsert_meta(conn, EXPORT_SAMPLE_PREFIX, &prefix)?;
            // DELETE-journal (peek salt-okuma acilis icin) + serbest sayfalari geri kazan (alt-kume
            // kucuk → dosya kucuk). VACUUM autocommit'te (acik TX yok).
            conn.execute_batch("PRAGMA journal_mode = DELETE; VACUUM;")
                .map_err(|e| format!("kopya normalize/VACUUM edilemedi: {e}"))?;
        }
        n
    }; // copy drop → -wal temizlenir; boyut olcumu tutarli

    // 4) move: kaynaktan cikarilanlari soft-delete (cop; geri-alinabilir). Kopya BASARILI olduktan
    //    SONRA → veri once guvenle yeni arsivde, sonra kaynaktan tasinir (kayip penceresi yok).
    let removed = if move_mode {
        emit(ExtractProgress { phase: "removing".into() });
        live.soft_delete(&ids).map_err(|e| e.to_string())? as i64
    } else {
        0
    };

    emit(ExtractProgress { phase: "done".into() });
    let size_bytes = std::fs::metadata(dest_path).map(|m| m.len()).unwrap_or(0);
    Ok(ExtractReport {
        extracted,
        removed,
        moved: move_mode,
        size_bytes,
        path: dest_path.display().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cikan `.archivistpro`'daki aktif asset sayisi (Db olarak acip say).
    fn extracted_count(dest: &Path) -> i64 {
        Db::open_and_migrate(dest).unwrap().count_active_assets().unwrap()
    }

    fn add(db: &mut Db, path: &str, ext: &str) {
        let file_name = path.rsplit(['\\', '/']).next().unwrap_or(path);
        let input = archivist_db::AssetInput {
            path,
            file_name,
            ext: Some(ext),
            size_bytes: 1,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: 0,
            modified_at: 0,
        };
        let data = archivist_db::IngestData {
            fts_body: None,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        };
        db.ingest(&input, &data).unwrap();
    }

    fn opts_ext(exts: &[&str]) -> ListOpts {
        ListOpts { ext: exts.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }

    /// copy modu: cikan arsiv yalniz eslesen asset'leri icerir (peek); kaynak DEGISMEZ.
    #[test]
    fn extract_copy_filters_and_leaves_source() {
        let dir = tempfile::tempdir().unwrap();
        let mut live = Db::open_and_migrate(&dir.path().join("live.db")).unwrap();
        add(&mut live, r"C:\p\a.dwg", "dwg");
        add(&mut live, r"C:\p\b.dwg", "dwg");
        add(&mut live, r"C:\p\c.pdf", "pdf");

        let dest = dir.path().join("out.archivistpro");
        let report = do_extract(&mut live, &dest, &opts_ext(&["dwg"]), false, |_| {}).unwrap();
        assert_eq!(report.extracted, 2);
        assert_eq!(report.removed, 0);
        assert!(!report.moved);

        // Cikan arsiv gecerli `.archivistpro`; yalniz 2 eslesen dwg'i icerir (budama sonrasi).
        assert_eq!(extracted_count(&dest), 2, "cikan arsivde yalniz eslesen 2 dwg");

        // Kaynak DEGISMEDI (copy modu).
        assert_eq!(live.count_active_assets().unwrap(), 3);
    }

    /// move modu: cikarma sonrasi kaynaktan eslesenler cope tasinir (soft-delete).
    #[test]
    fn extract_move_prunes_source() {
        let dir = tempfile::tempdir().unwrap();
        let mut live = Db::open_and_migrate(&dir.path().join("live.db")).unwrap();
        add(&mut live, r"C:\p\a.dwg", "dwg");
        add(&mut live, r"C:\p\b.pdf", "pdf");

        let dest = dir.path().join("out.archivistpro");
        let report = do_extract(&mut live, &dest, &opts_ext(&["dwg"]), true, |_| {}).unwrap();
        assert_eq!(report.extracted, 1);
        assert_eq!(report.removed, 1);
        assert!(report.moved);
        // Cikan arsivde 1 dwg.
        assert_eq!(extracted_count(&dest), 1);
        // Kaynaktan dwg cope tasindi → yalniz pdf aktif kaldi.
        assert_eq!(live.count_active_assets().unwrap(), 1);
    }

    /// Filtreye uyan asset yoksa → Err (bos arsiv uretilmez; H2 pariti). Hedef dosya yazilmaz.
    #[test]
    fn extract_empty_filter_result_errors() {
        let dir = tempfile::tempdir().unwrap();
        let mut live = Db::open_and_migrate(&dir.path().join("live.db")).unwrap();
        add(&mut live, r"C:\p\a.pdf", "pdf");
        let dest = dir.path().join("out.archivistpro");
        let err = do_extract(&mut live, &dest, &opts_ext(&["dwg"]), false, |_| {}).unwrap_err();
        assert!(err.contains("cikarilacak"), "hata mesaji: {err}");
    }
}
