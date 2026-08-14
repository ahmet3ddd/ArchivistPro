//! Undo/redo cekirdek uygula-mantigi (Tauri'siz → birim test edilebilir).
//!
//! `undo_commands.rs` dizin-moduline bolundu (saf refactor). Cift-yonlu (`forward` bayragi:
//! false=undo · true=redo) cekirdekler; komut sarmalayicilari (`commands.rs`) bunlari cagirir,
//! testler (`tests.rs`) dogrudan dogrular. Guvenceler (changed_since/ezme-yok/rollback) AYNEN.

use archivist_db::{Db, ProjectMetaPatch};

use crate::refile_commands::{refile_one, RefileOutcome};

use super::payload::{
    CollectionPayload, IdsPayload, MetaPayload, MoveItem, RootGroupAssignPayload,
    RootGroupLifePayload, RootGroupScalarPayload, TagEntityPayload, TagPayload, TagRenamePayload,
};
use super::{
    now_unix, UndoIssue, UndoReport, KIND_COLLECTION_ADD, KIND_COLLECTION_REMOVE, KIND_FAVORITE_ADD,
    KIND_FAVORITE_REMOVE, KIND_ROOT_GROUP_ASSIGN, KIND_ROOT_GROUP_CREATE, KIND_ROOT_GROUP_DELETE,
    KIND_ROOT_GROUP_RECOLOR, KIND_ROOT_GROUP_RENAME, KIND_TAG_ADD, KIND_TAG_DELETE, KIND_TAG_REMOVE,
    KIND_TAG_RENAME, KIND_TRASH,
};

// ── Cekirdekler (Tauri'siz → birim test) ─────────────────────────────────────────────────

/// Tasima ogelerini TERS sirayla geri tasi. Oge-basi guvenlik: mevcut DB yolu kayitli `to`
/// ile ayni DEGILSE (baska islem dokunmus / cop'e gitmis) `changed_since`/`not_found` ile
/// atlanir. Geri-tasima `refile_one` (ezme-yok + rollback) ile — undo da ayni guvenceleri tasir.
pub(crate) fn apply_moves(
    db: &Db,
    items: &[MoveItem],
    forward: bool,
    mut progress: impl FnMut(usize, usize, &str),
) -> UndoReport {
    let total = items.len();
    let mut report = UndoReport::default();
    // Undo: son-tasinani ILK geri al (reverse). Redo: ilk-tasinani ILK yeniden uygula (normal sira).
    let order: Vec<&MoveItem> =
        if forward { items.iter().collect() } else { items.iter().rev().collect() };
    for (i, item) in order.into_iter().enumerate() {
        let processed = i + 1;
        // forward (redo): from→to (su an `from`'da olmali). backward (undo): to→from (su an `to`'da).
        let (src, dst) = if forward {
            (item.from.as_str(), item.to.as_str())
        } else {
            (item.to.as_str(), item.from.as_str())
        };

        // Mevcut aktif yol — yok (cop/silinmis) → atla.
        let current = db.paths_for_ids(&[item.id]).ok().and_then(|v| v.into_iter().next());
        let Some(current) = current else {
            report.skipped.push(UndoIssue { path: dst.to_string(), reason: "not_found".into() });
            progress(processed, total, dst);
            continue;
        };
        // Beklenen konumda degil (sonradan baska islem dokundu) → atla ("cekip koparma" yok).
        if current != src {
            report.skipped.push(UndoIssue { path: dst.to_string(), reason: "changed_since".into() });
            progress(processed, total, dst);
            continue;
        }

        match refile_one(db, item.id, src, dst) {
            Ok(RefileOutcome::Moved) => report.reverted += 1,
            Ok(RefileOutcome::AlreadyInPlace) => {
                report.skipped.push(UndoIssue { path: dst.to_string(), reason: "same_dir".into() });
            }
            Err(e) if e.is_skip() => {
                report.skipped.push(UndoIssue { path: dst.to_string(), reason: e.code() });
            }
            Err(e) => {
                report.failed.push(UndoIssue { path: dst.to_string(), reason: e.code() });
            }
        }
        progress(processed, total, dst);
    }
    report
}

/// Proje-durum ogelerini eski degerlere dondur — yalniz `fields`'taki kolonlar (per-asset
/// `ProjectMetaPatch`; DIGER alanlara dokunulmaz). Silinmis asset → `not_found` atlanir.
pub(crate) fn undo_meta_core(db: &Db, payload: &MetaPayload) -> UndoReport {
    let mut report = UndoReport::default();
    for item in &payload.items {
        let mut patch = ProjectMetaPatch::default();
        for f in &payload.fields {
            match f.as_str() {
                "client_name" => patch.client_name = Some(item.client_name.clone()),
                "approval_status" => patch.approval_status = Some(item.approval_status.clone()),
                "rejection_reason" => patch.rejection_reason = Some(item.rejection_reason.clone()),
                "version_label" => patch.version_label = Some(item.version_label.clone()),
                "deadline" => patch.deadline = Some(item.deadline.clone()),
                _ => {} // bilinmeyen alan (ileri surum) → yoksay
            }
        }
        match db.bulk_update_project_meta(&[item.id], &patch) {
            Ok(1) => report.reverted += 1,
            Ok(_) => report
                .skipped
                .push(UndoIssue { path: format!("#{}", item.id), reason: "not_found".into() }),
            Err(e) => report
                .failed
                .push(UndoIssue { path: format!("#{}", item.id), reason: e.to_string() }),
        }
    }
    report
}

/// Kurasyon geri-alimi (favorite/tag/collection/trash) — kind'a gore payload TERSINE uygulanir.
/// DB-ici (disk yok); temeldeki yazmalar idempotent → yeniden geri-al no-op (guvenli). Corrupt
/// payload → Err (komut katmani cevirir). Trash → `restore` (toplu tek cagri).
pub(crate) fn apply_curation(
    db: &mut Db,
    kind: &str,
    payload: &str,
    forward: bool,
) -> Result<(UndoReport, Option<String>), String> {
    // Tek oge sonucunu rapora isle (nested fn — closure &mut yakalama tuzagindan kacin).
    fn note(res: Result<(), archivist_db::DbError>, id: i64, report: &mut UndoReport) {
        match res {
            Ok(_) => report.reverted += 1,
            Err(e) => report.failed.push(UndoIssue { path: format!("#{id}"), reason: e.to_string() }),
        }
    }
    let corrupt = || "corrupt_payload".to_string();
    let mut report = UndoReport::default();
    // Koleksiyon redo-recreate id degistirirse guncel payload (komut update_undo_payload ile yazar).
    let mut new_payload: Option<String> = None;
    match kind {
        KIND_FAVORITE_ADD | KIND_FAVORITE_REMOVE => {
            let p: IdsPayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            // forward (redo) = kaydin yonu; backward (undo) = tersi.
            let on = forward == (kind == KIND_FAVORITE_ADD);
            for id in p.ids {
                note(db.set_favorite(id, on), id, &mut report);
            }
        }
        KIND_TAG_ADD | KIND_TAG_REMOVE => {
            let p: TagPayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            let do_add = forward == (kind == KIND_TAG_ADD);
            for id in p.ids {
                let r = if do_add { db.add_user_tag(id, &p.name) } else { db.remove_tag(id, &p.name) };
                note(r, id, &mut report);
            }
        }
        // Etiket VARLIK silme: geri-al → etiketi ADIYLA yeniden kur + rengini geri yaz + TUM
        // baglari yeniden bagla (H2 `restoreTag`). Redo → yeniden sil.
        KIND_TAG_DELETE => {
            let p: TagEntityPayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            if forward {
                // Redo: etiketi tekrar sil. Zaten yoksa (kullanici elle sildi) sessiz gec.
                if db.delete_user_tag(&p.name).is_ok() {
                    report.reverted += 1;
                }
            } else {
                // Undo: `add_user_tag` etiketi yoksa OLUSTURUR (kind='user') → id yeni ama ad ayni.
                // Silinmis asset varsa o baglanti atlanir (note → skipped/failed).
                for id in &p.ids {
                    note(db.add_user_tag(*id, &p.name), *id, &mut report);
                }
                // Bagsiz etiket de geri gelmeli (hic asset'i yoktuysa `add_user_tag` hic kosmaz).
                if p.ids.is_empty() {
                    let _ = db.ensure_user_tag(&p.name);
                    report.reverted += 1;
                }
                // Renk anlik-goruntusu (H2 snapshot'inda vardi) — best-effort.
                if let Some(color) = p.color.as_deref() {
                    let _ = db.set_tag_color(&p.name, Some(color));
                }
            }
        }
        // Etiket VARLIK yeniden adlandirma: undo `new → old`, redo `old → new`. Hedef ad
        // araya girip dolduysa `rename_user_tag` reddeder → islem "failed" olarak raporlanir
        // (sessizce birlestirme YOK).
        KIND_TAG_RENAME => {
            let p: TagRenamePayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            let (from, to) = if forward { (&p.old, &p.new) } else { (&p.new, &p.old) };
            match db.rename_user_tag(from, to) {
                Ok(()) => report.reverted += 1,
                Err(e) => report
                    .failed
                    .push(UndoIssue { path: from.clone(), reason: e.to_string() }),
            }
        }
        KIND_COLLECTION_ADD | KIND_COLLECTION_REMOVE => {
            let mut p: CollectionPayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            let do_add = forward == (kind == KIND_COLLECTION_ADD);
            if do_add {
                // Ada gore find-or-create: koleksiyon silinmisse (created-undo) yeniden dogar; hala
                // varsa AYNI id doner. Id degisirse payload guncellenir → sonraki undo dogru hedefler.
                let cid = if p.name.is_empty() {
                    p.collection_id // eski isimsiz kayit — mevcut id ile dene
                } else {
                    db.create_collection(&p.name, None).map_err(|e| e.to_string())?
                };
                if cid != p.collection_id {
                    p.collection_id = cid;
                    new_payload = serde_json::to_string(&p).ok();
                }
                for id in &p.ids {
                    note(db.add_to_collection(cid, *id), *id, &mut report);
                }
            } else {
                for id in &p.ids {
                    note(db.remove_from_collection(p.collection_id, *id), *id, &mut report);
                }
                // Bu islemle OLUSAN koleksiyon bos kaldiysa sil ("koleksiyon olusturdum→geri al→kaybolsun").
                if p.created && db.collection_item_count(p.collection_id).unwrap_or(1) == 0 {
                    let _ = db.delete_collection(p.collection_id);
                }
            }
        }
        KIND_TRASH => {
            let p: IdsPayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            // forward (redo) = yeniden cope at; backward (undo) = restore.
            let res = if forward { db.soft_delete(&p.ids) } else { db.restore(&p.ids) };
            match res {
                Ok(n) => report.reverted = n as u32,
                Err(e) => {
                    report.failed.push(UndoIssue { path: String::new(), reason: e.to_string() });
                }
            }
        }
        // Kaynak-klasor grubu YASAM-DONGUSU (create ↔ delete; simetrik). do_delete: CREATE-undo /
        // DELETE-redo → sil; CREATE-redo / DELETE-undo → recreate (ad+renk yeni id + uyeleri yeniden
        // bagla; id degistigi icin payload guncellenir → sonraki redo/undo dogru grubu hedefler).
        KIND_ROOT_GROUP_CREATE | KIND_ROOT_GROUP_DELETE => {
            let mut p: RootGroupLifePayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            let do_delete = forward == (kind == KIND_ROOT_GROUP_DELETE);
            if do_delete {
                match db.delete_root_group(p.group_id) {
                    Ok(()) => report.reverted += 1,
                    Err(e) => report
                        .failed
                        .push(UndoIssue { path: p.name.clone(), reason: e.to_string() }),
                }
            } else {
                match db.create_root_group(&p.name, &p.color, now_unix()) {
                    Ok(new_id) => {
                        // Uyeleri yeniden bagla; silinmis/gitmis kok → skipped (FK/satir yok).
                        for rid in &p.root_ids {
                            if let Err(e) = db.assign_root_group(*rid, Some(new_id)) {
                                report.skipped.push(UndoIssue {
                                    path: format!("#{rid}"),
                                    reason: e.to_string(),
                                });
                            }
                        }
                        report.reverted += 1;
                        if new_id != p.group_id {
                            p.group_id = new_id;
                            new_payload = serde_json::to_string(&p).ok();
                        }
                    }
                    Err(e) => report
                        .failed
                        .push(UndoIssue { path: p.name.clone(), reason: e.to_string() }),
                }
            }
        }
        // Skaler alan (rename ↔ recolor): forward=new, backward=old; kind hangi alan oldugunu secer.
        KIND_ROOT_GROUP_RENAME | KIND_ROOT_GROUP_RECOLOR => {
            let p: RootGroupScalarPayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            let val = if forward { &p.new } else { &p.old };
            let r = if kind == KIND_ROOT_GROUP_RENAME {
                db.rename_root_group(p.group_id, val)
            } else {
                db.recolor_root_group(p.group_id, val)
            };
            note(r, p.group_id, &mut report);
        }
        // Kok → grup atama: forward=new_group, backward=old_group (`None` = gruptan cikar).
        KIND_ROOT_GROUP_ASSIGN => {
            let p: RootGroupAssignPayload = serde_json::from_str(payload).map_err(|_| corrupt())?;
            let target = if forward { p.new_group } else { p.old_group };
            note(db.assign_root_group(p.root_id, target), p.root_id, &mut report);
        }
        _ => return Err("unknown_kind".to_string()),
    }
    Ok((report, new_payload))
}

/// Toplu proje-durumu REDO — kaydin `applied` (YENI) degerlerini yeniden yaz (undo ESKI degerleri
/// yazar). Eski kayitlarda `applied` bos → 0 (graceful; o kayitlar redo oncesinden).
pub(crate) fn redo_meta_core(db: &Db, payload: &MetaPayload) -> UndoReport {
    let patch = payload.applied.to_patch();
    let ids: Vec<i64> = payload.items.iter().map(|i| i.id).collect();
    let mut report = UndoReport::default();
    match db.bulk_update_project_meta(&ids, &patch) {
        Ok(n) => report.reverted = n as u32,
        Err(e) => report.failed.push(UndoIssue { path: String::new(), reason: e.to_string() }),
    }
    report
}
