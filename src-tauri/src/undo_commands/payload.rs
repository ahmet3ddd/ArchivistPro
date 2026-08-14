//! Undo kayit payload veri sekilleri (JSON; db katmani opak saklar) + serde.
//!
//! `undo_commands.rs` dizin-moduline bolundu (saf refactor). Modul-ici (yalniz undo alt
//! modulleri arasinda paylasilan) payload'lar `pub(super)`; disari (crate) acilan tipler
//! (`MoveItem` · `MetaItem` · `MetaPayload` · `AppliedMeta`) mod.rs uzerinden yeniden aktarilir.

use archivist_db::ProjectMetaPatch;
use serde::{Deserialize, Serialize};

// ── Payload tipleri (JSON; db katmani opak saklar) ───────────────────────────────────────

/// Tek tasima ogesi: `from` → `to` gerceklesti; geri-al `to` → `from` tasir.
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct MoveItem {
    pub id: i64,
    pub from: String,
    pub to: String,
}

#[derive(Serialize, Deserialize)]
pub(super) struct MovePayload {
    pub(super) items: Vec<MoveItem>,
}

/// Bir asset'in yazma ANINDAN ONCEKI proje-durum degerleri (tam 5 alan saklanir;
/// geri-al yalniz `MetaPayload.fields`'taki kolonlari geri yazar).
#[derive(Serialize, Deserialize)]
pub(crate) struct MetaItem {
    pub id: i64,
    pub client_name: Option<String>,
    pub approval_status: Option<String>,
    pub rejection_reason: Option<String>,
    pub version_label: Option<String>,
    pub deadline: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct MetaPayload {
    /// Islemin YAZDIGI kolon adlari (client_name/approval_status/rejection_reason/
    /// version_label/deadline) — geri-al yalniz bunlari eski degere dondurur.
    pub fields: Vec<String>,
    /// Per-asset ESKI degerler (undo → bunlari geri yazar).
    pub items: Vec<MetaItem>,
    /// Uygulanan YENI degerler (redo → bunlari yeniden yazar). Uc-durumlu (ProjectMetaPatch
    /// serilestirilmis hali). Eski kayitlarda yok → `default` (bos) → redo no-op (graceful).
    #[serde(default)]
    pub applied: AppliedMeta,
}

/// Bir toplu proje-durumu isleminin UYGULADIGI yama (redo icin). `ProjectMetaPatch`'in
/// serilestirilebilir esdegeri: her alan `None`=dokunulmadi · `Some(None)`=temizlendi ·
/// `Some(Some(v))`=v yazildi.
#[derive(Serialize, Deserialize, Default, Clone)]
pub(crate) struct AppliedMeta {
    #[serde(default)]
    pub client_name: Option<Option<String>>,
    #[serde(default)]
    pub approval_status: Option<Option<String>>,
    #[serde(default)]
    pub rejection_reason: Option<Option<String>>,
    #[serde(default)]
    pub version_label: Option<Option<String>>,
    #[serde(default)]
    pub deadline: Option<Option<String>>,
}

impl AppliedMeta {
    /// `ProjectMetaPatch`'ten kur (kayit ani; komut katmani `db_patch`'i verir).
    pub fn from_patch(p: &ProjectMetaPatch) -> Self {
        AppliedMeta {
            client_name: p.client_name.clone(),
            approval_status: p.approval_status.clone(),
            rejection_reason: p.rejection_reason.clone(),
            version_label: p.version_label.clone(),
            deadline: p.deadline.clone(),
        }
    }
    /// `ProjectMetaPatch`'e cevir (redo ani; yeniden uygulama).
    pub(super) fn to_patch(&self) -> ProjectMetaPatch {
        ProjectMetaPatch {
            client_name: self.client_name.clone(),
            approval_status: self.approval_status.clone(),
            rejection_reason: self.rejection_reason.clone(),
            version_label: self.version_label.clone(),
            deadline: self.deadline.clone(),
        }
    }
}

/// Kurasyon: sade id listesi (favorite_add/remove · trash). `ids` = islemin GERCEKTEN degistirdigi
/// alt-kume (delta-bulk'tan) → geri-al yalniz onlari tersine cevirir.
#[derive(Serialize, Deserialize)]
pub(super) struct IdsPayload {
    pub(super) ids: Vec<i64>,
}

/// Kurasyon: etiket adi + degisen id'ler (tag_add/remove).
#[derive(Serialize, Deserialize)]
pub(super) struct TagPayload {
    pub(super) name: String,
    pub(super) ids: Vec<i64>,
}

/// Etiket **VARLIK** silme anlik-goruntusu (tag_delete) — H2 `snapshotTag`/`restoreTag` pariteli.
/// Geri-al: etiketi ADIYLA yeniden kurar, **rengini** geri yazar ve silme anindaki TUM asset
/// baglarini yeniden baglar. (Etiket id'si degisir → payload id degil AD tasir; ad UNIQUE.)
#[derive(Serialize, Deserialize)]
pub(super) struct TagEntityPayload {
    pub(super) name: String,
    /// Silme anindaki renk (`#RRGGBB`); None = renksizdi.
    #[serde(default)]
    pub(super) color: Option<String>,
    /// Silme aninda bu etikete bagli asset id'leri (geri-al bunlari yeniden baglar).
    pub(super) ids: Vec<i64>,
}

/// Etiket **VARLIK** yeniden adlandirma (tag_rename). Geri-al `new → old`, redo `old → new`.
#[derive(Serialize, Deserialize)]
pub(super) struct TagRenamePayload {
    pub(super) old: String,
    pub(super) new: String,
}

/// Kurasyon: koleksiyon + degisen id'ler (collection_add/remove). `created` yalniz add'de anlamli:
/// koleksiyon BU islemle olustuysa geri-al uyelikleri kaldirir VE bos kalirsa koleksiyonu siler.
#[derive(Serialize, Deserialize)]
pub(super) struct CollectionPayload {
    pub(super) collection_id: i64,
    #[serde(default)]
    pub(super) created: bool,
    /// Koleksiyon adi — redo/re-add sirasinda koleksiyon silinmisse ada gore YENIDEN olusturulur
    /// (created-undo koleksiyonu silmisti). Eski kayitlarda yok → `default` (bos) → recreate atlanir.
    #[serde(default)]
    pub(super) name: String,
    pub(super) ids: Vec<i64>,
}

/// Kaynak-klasor GRUBU YASAM-DONGUSU (create ↔ delete; simetrik inverse — `favorite_add`/
/// `favorite_remove` deseni). Recreate SILINEN grubu ADIYLA+RENGIYLE yeniden kurar (yeni id → id
/// degisir) ve `root_ids` uyeligini yeniden baglar; delete grubu siler (FK SET NULL → kokler kalir).
/// `create` kaydinda `root_ids` bostur (yeni grup bos dogar); `delete` kaydinda silme anindaki uyeler.
#[derive(Serialize, Deserialize)]
pub(super) struct RootGroupLifePayload {
    /// Grubun GUNCEL id'si (recreate'te degisir → `update_undo_payload` ile guncellenir).
    pub(super) group_id: i64,
    pub(super) name: String,
    pub(super) color: String,
    /// Silme anindaki uye kok id'leri (recreate → yeniden atanir). `create` → bos.
    #[serde(default)]
    pub(super) root_ids: Vec<i64>,
}

/// Kaynak-klasor grubu SKALER alan degisimi (rename ↔ recolor; kind hangi alan oldugunu soyler).
/// Undo `old`, redo `new` yazar. `group_id` sabit (recreate yok → payload guncellenmez).
#[derive(Serialize, Deserialize)]
pub(super) struct RootGroupScalarPayload {
    pub(super) group_id: i64,
    pub(super) old: String,
    pub(super) new: String,
}

/// Kok → grup ATAMA degisimi. Undo `old_group`, redo `new_group` yazar (`None` = gruptan cikar).
#[derive(Serialize, Deserialize)]
pub(super) struct RootGroupAssignPayload {
    pub(super) root_id: i64,
    #[serde(default)]
    pub(super) old_group: Option<i64>,
    #[serde(default)]
    pub(super) new_group: Option<i64>,
}
