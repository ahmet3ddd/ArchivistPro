//! Kayit yardimcilari (islem komutlarindan cagrilir; BEST-EFFORT).
//!
//! `undo_commands.rs` dizin-moduline bolundu (saf refactor). Bu `record_*` fonksiyonlari
//! urun islemi sonunda `undo_ops` satiri yazar — audit gibi best-effort (kayit tutulamazsa
//! urun islemi yine basarili). Disari (crate) `undo_commands::record_*` yoluyla mod.rs'ten aktarilir.

use archivist_db::Db;

use super::payload::{
    CollectionPayload, IdsPayload, MetaPayload, MoveItem, MovePayload, RootGroupAssignPayload,
    RootGroupLifePayload, RootGroupScalarPayload, TagEntityPayload, TagPayload, TagRenamePayload,
};
use super::{now_unix, KIND_PROJECT_META, KIND_ROOT_GROUP_ASSIGN, KIND_TAG_DELETE, KIND_TAG_RENAME};

// ── Kayit yardimcilari (islem komutlarindan cagrilir; BEST-EFFORT) ───────────────────────

/// Tasima islemini kaydet. `items` bos → kayit yok (hicbir sey tasinmadi). `label` dil-notr
/// VERI (hedef klasor / yeni ad) — i18n paneli kind'i cevirir, label'i aynen gosterir.
pub(crate) fn record_moves(db: &Db, kind: &str, label: &str, items: Vec<MoveItem>) {
    if items.is_empty() {
        return;
    }
    let count = items.len() as i64;
    if let Ok(payload) = serde_json::to_string(&MovePayload { items }) {
        let _ = db.record_undo_op(kind, label, count, &payload, now_unix());
    }
}

/// Toplu proje-durumu islemini kaydet (eski degerler + yazilan kolonlar). Bos → kayit yok.
pub(crate) fn record_project_meta(db: &Db, payload: &MetaPayload) {
    if payload.items.is_empty() || payload.fields.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(payload) {
        let _ =
            db.record_undo_op(KIND_PROJECT_META, "", payload.items.len() as i64, &json, now_unix());
    }
}

/// Sade id-listesi kaydi (favorite_add/remove · trash). Bos → kayit yok.
pub(crate) fn record_ids(db: &Db, kind: &str, label: &str, ids: &[i64]) {
    if ids.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(&IdsPayload { ids: ids.to_vec() }) {
        let _ = db.record_undo_op(kind, label, ids.len() as i64, &json, now_unix());
    }
}

/// Etiket kaydi (tag_add/remove); `label` = etiket adi. Bos → kayit yok.
pub(crate) fn record_tag(db: &Db, kind: &str, name: &str, ids: &[i64]) {
    if ids.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(&TagPayload { name: name.to_string(), ids: ids.to_vec() })
    {
        let _ = db.record_undo_op(kind, name, ids.len() as i64, &json, now_unix());
    }
}

/// Etiket VARLIK silme kaydi — `ids` BOS OLSA BILE yazilir (bagsiz etiket de geri gelmeli;
/// `record_tag`'in "bos → kayit yok" kurali burada GECERSIZ). `item_count` = etkilenen dosya.
pub(crate) fn record_tag_delete(db: &Db, name: &str, color: Option<&str>, ids: &[i64]) {
    if let Ok(json) = serde_json::to_string(&TagEntityPayload {
        name: name.to_string(),
        color: color.map(str::to_string),
        ids: ids.to_vec(),
    }) {
        let _ = db.record_undo_op(KIND_TAG_DELETE, name, ids.len() as i64, &json, now_unix());
    }
}

/// Etiket VARLIK yeniden adlandirma kaydi. `label` = "eski → yeni" (dil-notr VERI).
pub(crate) fn record_tag_rename(db: &Db, old: &str, new: &str) {
    if let Ok(json) =
        serde_json::to_string(&TagRenamePayload { old: old.to_string(), new: new.to_string() })
    {
        let _ = db.record_undo_op(
            KIND_TAG_RENAME,
            &format!("{old} → {new}"),
            1,
            &json,
            now_unix(),
        );
    }
}

/// Kaynak-klasor grubu YASAM-DONGUSU kaydi (create/delete). `kind` yonu belirler; `label` = grup
/// adi (panelde). `root_ids` delete'te silme-ani uyeleri, create'te bos. Grup daima kayit uretir
/// (bos grup da geri gelmeli — `record_tag_delete` deseni; "bos → kayit yok" kurali burada YOK).
pub(crate) fn record_root_group_life(
    db: &Db,
    kind: &str,
    group_id: i64,
    name: &str,
    color: &str,
    root_ids: Vec<i64>,
) {
    let count = root_ids.len() as i64;
    if let Ok(json) = serde_json::to_string(&RootGroupLifePayload {
        group_id,
        name: name.to_string(),
        color: color.to_string(),
        root_ids,
    }) {
        let _ = db.record_undo_op(kind, name, count, &json, now_unix());
    }
}

/// Kaynak-klasor grubu SKALER alan kaydi (rename/recolor). `kind` alani belirler; `label` panelde
/// gorunur (rename → "eski → yeni"). Deger DEGISMEDIYSE (`old == new`) kayit YOK (no-op undo uretme).
pub(crate) fn record_root_group_scalar(
    db: &Db,
    kind: &str,
    group_id: i64,
    old: &str,
    new: &str,
    label: &str,
) {
    if old == new {
        return;
    }
    if let Ok(json) = serde_json::to_string(&RootGroupScalarPayload {
        group_id,
        old: old.to_string(),
        new: new.to_string(),
    }) {
        let _ = db.record_undo_op(kind, label, 1, &json, now_unix());
    }
}

/// Kok → grup ATAMA kaydi. `label` = kok etiketi (panelde). Atama DEGISMEDIYSE kayit YOK.
pub(crate) fn record_root_group_assign(
    db: &Db,
    root_id: i64,
    old_group: Option<i64>,
    new_group: Option<i64>,
    label: &str,
) {
    if old_group == new_group {
        return;
    }
    if let Ok(json) =
        serde_json::to_string(&RootGroupAssignPayload { root_id, old_group, new_group })
    {
        let _ = db.record_undo_op(KIND_ROOT_GROUP_ASSIGN, label, 1, &json, now_unix());
    }
}

/// Koleksiyon kaydi (collection_add/remove); `label` = koleksiyon adi. Bos → kayit yok.
pub(crate) fn record_collection(
    db: &Db,
    kind: &str,
    label: &str,
    collection_id: i64,
    created: bool,
    ids: &[i64],
) {
    if ids.is_empty() {
        return;
    }
    if let Ok(json) = serde_json::to_string(&CollectionPayload {
        collection_id,
        created,
        name: label.to_string(),
        ids: ids.to_vec(),
    }) {
        let _ = db.record_undo_op(kind, label, ids.len() as i64, &json, now_unix());
    }
}
