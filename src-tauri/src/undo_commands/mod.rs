//! Undo komutlari (P2.5 stabilite) — geri-al gecmisi listeleme + geri-alma.
//!
//! Kayit: dosya-tasiyan komutlar (refile/rename/organize-tasi) ve toplu proje-durumu, islem
//! sonunda buradaki `record_*` yardimcilariyla bir `undo_ops` satiri yazar (**best-effort** —
//! audit gibi: kayit tutulamazsa urun islemi yine basarili). Kopyala modu KAYDEDILMEZ (additive;
//! geri-almak = olusan dosyalari silmek olurdu — yikici, kapsam disi).
//!
//! Geri-alma (`undo_op`): payload'daki ogeler TERSINE uygulanir —
//!   * tasima → `refile_one(to → from)` (disk + DB senkron + rollback + ezme-yok AYNEN gecerli);
//!     oge yalniz **mevcut DB yolu == kayitli `to`** ise geri tasinir (sonradan baska islem
//!     dokunduysa `changed_since` ile atlanir — eski konuma "cekip koparma" YOK).
//!   * toplu proje-durumu → yalniz o islemin YAZDIGI kolonlar (`fields`) eski degerlere doner
//!     (per-asset `ProjectMetaPatch`; sonradan elle degisen DIGER alanlara dokunulmaz).
//!
//! `failed` bos ise kayit `undone` isaretlenir; degilse AKTIF kalir (gecici hata — kilitli dosya
//! vb. — cozulunce yeniden denenebilir; zaten geri-alinanlar ikinci turda zarifce atlanir).
//!
//! Yetki kind-bazli: tasima turleri **admin** (refile/organize ile ayni), proje-durumu **editor**
//! (toplu-atama ile ayni) — geri-alma, islemin kendisinden daha genis yetki istemez/vermez.
//!
//! Dizin-modulu (saf refactor, ~500 satir kurali): `payload` (kayit veri sekilleri) · `record`
//! (kayit-kancalari) · `core` (undo/redo cekirdek uygula-mantigi) · `commands` (Tauri sarmalayici).
//! Yeniden-disari-aktarim ile `undo_commands::<fn>` dis yollari AYNEN korunur; `lib.rs`
//! `generate_handler![undo_commands::x]` kaydi degismez.

use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

mod commands;
mod core;
mod payload;
mod record;

pub use commands::*;
pub(crate) use payload::{AppliedMeta, MetaItem, MetaPayload, MoveItem};
pub(crate) use record::{
    record_collection, record_ids, record_moves, record_project_meta,
    record_root_group_assign, record_root_group_life, record_root_group_scalar, record_tag,
    record_tag_delete, record_tag_rename,
};

// ── Kind sabitleri (undo_ops.kind; i18n anahtari degil — veri) ───────────────────────────
pub(crate) const KIND_REFILE_MOVE: &str = "refile_move";
pub(crate) const KIND_RENAME: &str = "rename";
pub(crate) const KIND_ORGANIZE_MOVE: &str = "organize_move";
pub(crate) const KIND_PROJECT_META: &str = "project_meta_bulk";
// Kurasyon (DB-ici; disk yok) — geri-alma idempotent-guvenli (temeldeki yazmalar idempotent).
pub(crate) const KIND_FAVORITE_ADD: &str = "favorite_add";
pub(crate) const KIND_FAVORITE_REMOVE: &str = "favorite_remove";
pub(crate) const KIND_TAG_ADD: &str = "tag_add";
pub(crate) const KIND_TAG_REMOVE: &str = "tag_remove";
/// Etiket VARLIK islemleri (2026-07-26; H2 `commandDeleteTag`/`commandRenameTag` pariteli).
/// `tag_add`/`tag_remove` asset-BAGI islemidir — bunlar etiketin KENDISINI degistirir.
pub(crate) const KIND_TAG_DELETE: &str = "tag_delete";
pub(crate) const KIND_TAG_RENAME: &str = "tag_rename";
pub(crate) const KIND_COLLECTION_ADD: &str = "collection_add";
pub(crate) const KIND_COLLECTION_REMOVE: &str = "collection_remove";
pub(crate) const KIND_TRASH: &str = "trash";
/// Kaynak-klasor GRUP islemleri (2026-07-27; H2 `commandCreateRootGroup`/`commandDeleteRootGroup`/
/// `commandRenameRootGroup`/`commandUpdateRootGroupColor`/`commandSetRootGroup` pariteli). Yetki:
/// **admin** (roots.rs grup komutlari admin-gate → undo/redo de admin, commands.rs match'inde).
pub(crate) const KIND_ROOT_GROUP_CREATE: &str = "root_group_create";
pub(crate) const KIND_ROOT_GROUP_DELETE: &str = "root_group_delete";
pub(crate) const KIND_ROOT_GROUP_RENAME: &str = "root_group_rename";
pub(crate) const KIND_ROOT_GROUP_RECOLOR: &str = "root_group_recolor";
pub(crate) const KIND_ROOT_GROUP_ASSIGN: &str = "root_group_assign";

/// Simdiki unix saniye (audit `now_unix` ile ayni savunma: epoch-oncesi → 0).
fn now_unix() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

// ── DTO'lar (renderer kontrati; camelCase) ───────────────────────────────────────────────

/// Panel liste satiri.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoOpDto {
    id: i64,
    created_at: i64,
    kind: String,
    label: String,
    item_count: i64,
    undone: bool,
}

/// Sorunlu oge (atlanan/basarisiz) — yol + neden kodu (i18n frontend'de).
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UndoIssue {
    path: String,
    reason: String,
}

/// Geri-alma ozeti. `undone=false` → kayit aktif birakildi (gecici hatalar cozulunce
/// yeniden denenebilir).
#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UndoReport {
    reverted: u32,
    skipped: Vec<UndoIssue>,
    failed: Vec<UndoIssue>,
    undone: bool,
}

#[cfg(test)]
mod tests;
