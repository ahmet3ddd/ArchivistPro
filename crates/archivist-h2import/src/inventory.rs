//! ① ENVANTER — H2 DB'sinde ne var ne yok, SAYILARLA (salt-okuma; H3'e hic dokunmaz).
//!
//! Iki isi var: (1) kullaniciya "tasinacak ne var" gercegini gostermek — 2026-07-16
//! "kuratorlu veri yok" olcumunu her makinede yeniden uretir (MIGRATION_PLAN'in
//! "yeniden olc, varsayma" sarti aracin icine gomulu); (2) sihirbazin sonraki
//! adimlarina beklenti vermek (kuru kosu raporuyla tutarlilik saglamasi).

use std::path::Path;

use serde::Serialize;

use crate::h2read::{H2Source, H2UserBrief};
use crate::H2ImportError;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct H2Inventory {
    pub db_path: String,
    pub file_bytes: u64,
    pub assets: i64,
    pub assets_deleted: i64,
    /// `metadata_json` icinde dwg* AI alani tasiyan satirlar (kaba LIKE sondasi — kesin
    /// ayristirma kuru kosunun isi; envanter hizli bir buyukluk hissi verir).
    pub assets_with_ai: i64,
    pub assets_with_thumbnail: i64,
    pub tags: i64,
    pub asset_tags: i64,
    pub favorites: i64,
    pub collections: i64,
    pub collection_items: i64,
    pub scanned_roots: i64,
    pub root_groups: i64,
    pub root_tags: i64,
    /// Proje-durum tasiyan satirlar (draft-disi status VEYA herhangi bir serbest alan).
    pub project_meta_rows: i64,
    /// Parolalar TASINAMAZ (PBKDF2≠argon2id) — liste yalniz rapor icindir.
    pub users: Vec<H2UserBrief>,
    /// v1 kapsami DISI — yalniz bilgi.
    pub chat_sessions: i64,
    /// Savunmaci okumada bulunamayan tablolar (cok eski sema izi).
    pub missing_tables: Vec<String>,
    /// Tek-bakis bayragi: tasimaya deger KURATORLU (insan-yapimi) veri var mi.
    pub has_curated_data: bool,
}

/// Envanteri cikar. `db_path` acilabilir bir H2 arsivi olmali.
pub fn inventory(db_path: &Path) -> Result<H2Inventory, H2ImportError> {
    let src = H2Source::open(db_path)?;
    inventory_from(&src)
}

pub(crate) fn inventory_from(src: &H2Source) -> Result<H2Inventory, H2ImportError> {
    let mut missing: Vec<String> = Vec::new();
    let count = |table: &str, missing: &mut Vec<String>| -> i64 {
        match src.count(table) {
            Some(n) => n,
            None => {
                missing.push(table.to_string());
                0
            }
        }
    };

    let assets = count("assets", &mut missing);
    let tags = count("tags", &mut missing);
    let asset_tags = count("asset_tags", &mut missing);
    let favorites = count("favorites", &mut missing);
    let collections = count("collections", &mut missing);
    let collection_items = count("collection_items", &mut missing);
    let scanned_roots = count("scanned_roots", &mut missing);
    let root_groups = count("root_groups", &mut missing);
    let root_tags = count("root_tags", &mut missing);
    let chat_sessions = count("chat_sessions", &mut missing);

    let assets_deleted = src.count_where("assets", "COALESCE(is_deleted,0) != 0").unwrap_or(0);
    // Kaba AI sondasi: dwg alan adlarindan biri metadata_json'da geciyor mu.
    let assets_with_ai = src
        .count_where(
            "assets",
            "metadata_json LIKE '%dwgDescription%' OR metadata_json LIKE '%dwgDrawingType%'",
        )
        .unwrap_or(0);
    let assets_with_thumbnail =
        src.count_where("assets", "thumbnail_url LIKE 'data:image%'").unwrap_or(0);
    let project_meta_rows = src
        .count_where(
            "assets",
            "(approval_status IS NOT NULL AND approval_status <> 'draft')
             OR client_name IS NOT NULL OR rejection_reason IS NOT NULL
             OR version_label IS NOT NULL OR deadline IS NOT NULL",
        )
        .unwrap_or(0);

    let users = src.users();
    let file_bytes = std::fs::metadata(&src.db_path).map(|m| m.len()).unwrap_or(0);

    // "Kuratorlu veri" = insan eliyle uretilmis olanlar (2026-07-16 olcumunun olcutu).
    let has_curated_data = tags > 0
        || favorites > 0
        || collections > 0
        || root_groups > 0
        || root_tags > 0
        || project_meta_rows > 0;

    Ok(H2Inventory {
        db_path: src.db_path.to_string_lossy().to_string(),
        file_bytes,
        assets,
        assets_deleted,
        assets_with_ai,
        assets_with_thumbnail,
        tags,
        asset_tags,
        favorites,
        collections,
        collection_items,
        scanned_roots,
        root_groups,
        root_tags,
        project_meta_rows,
        users,
        chat_sessions,
        missing_tables: missing,
        has_curated_data,
    })
}
