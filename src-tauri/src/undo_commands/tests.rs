//! Undo/redo cekirdek birim testleri (apply_moves · undo_meta_core · apply_curation · redo_meta_core).
//!
//! `undo_commands.rs` dizin-moduline bolundu (saf refactor): testler cekirdegi (`core`) cift-yonlu
//! (undo/redo) dogrular. Tauri komut sarmalayicilari `State` gerektirdiginden burada test edilmez.

use archivist_db::Db;
use rusqlite::params;

use super::core::{apply_curation, apply_moves, redo_meta_core, undo_meta_core};
use super::*;

/// Bellek-ici Db'ye gercek disk-yollu asset ekle → id (refile testleriyle ayni desen).
fn seed(db: &Db, path: &str, name: &str) -> i64 {
    db.connection()
        .execute(
            "INSERT INTO assets(path, file_name, ext, size_bytes, created_at, modified_at)
             VALUES (?1, ?2, 'dwg', 1, 1, 1)",
            params![path, name],
        )
        .unwrap();
    db.connection().last_insert_rowid()
}

// Undo yonu (backward) ince-sarmalayicilar — mevcut testler cift-yonlu cekirdegi undo modunda cagirir.
fn undo_mv(db: &Db, items: &[MoveItem]) -> UndoReport {
    apply_moves(db, items, false, |_, _, _| {})
}
fn undo_cur(db: &mut Db, kind: &str, payload: &str) -> Result<UndoReport, String> {
    apply_curation(db, kind, payload, false).map(|(r, _)| r)
}

#[test]
fn undo_moves_reverts_file_and_db() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("eski.dwg");
    let to = dir.path().join("org").join("eski.dwg");
    std::fs::create_dir_all(to.parent().unwrap()).unwrap();
    // Tasinmis durum: dosya `to`'da, DB yolu `to`.
    std::fs::write(&to, b"data").unwrap();

    let db = Db::open_in_memory_migrated().unwrap();
    let from_s = from.to_string_lossy().to_string();
    let to_s = to.to_string_lossy().to_string();
    let id = seed(&db, &to_s, "eski.dwg");

    let items = vec![MoveItem { id, from: from_s.clone(), to: to_s.clone() }];
    let report = undo_mv(&db, &items);

    assert_eq!(report.reverted, 1);
    assert!(report.skipped.is_empty() && report.failed.is_empty());
    assert!(from.exists(), "dosya eski konumuna dondu");
    assert!(!to.exists());
    let db_path: String = db
        .connection()
        .query_row("SELECT path FROM assets WHERE id=?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(db_path, from_s, "DB yolu senkron");
}

#[test]
fn undo_moves_skips_changed_since_and_missing() {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open_in_memory_migrated().unwrap();

    // Oge 1: DB yolu kayitli `to`dan FARKLI (sonradan baska islem tasimis) → changed_since.
    let elsewhere = dir.path().join("baska.dwg");
    std::fs::write(&elsewhere, b"x").unwrap();
    let id1 = seed(&db, &elsewhere.to_string_lossy(), "baska.dwg");

    // Oge 2: asset DB'de yok → not_found.
    let items = vec![
        MoveItem {
            id: id1,
            from: dir.path().join("a.dwg").to_string_lossy().to_string(),
            to: dir.path().join("b.dwg").to_string_lossy().to_string(),
        },
        MoveItem { id: 9999, from: "x".into(), to: "y".into() },
    ];
    let report = undo_mv(&db, &items);
    assert_eq!(report.reverted, 0);
    assert_eq!(report.skipped.len(), 2);
    let reasons: Vec<_> = report.skipped.iter().map(|s| s.reason.as_str()).collect();
    assert!(reasons.contains(&"changed_since"));
    assert!(reasons.contains(&"not_found"));
    assert!(elsewhere.exists(), "dokunulmadi");
}

#[test]
fn undo_moves_target_occupied_is_skip_not_fail() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("eski.dwg");
    let to = dir.path().join("yeni.dwg");
    std::fs::write(&to, b"tasinmis").unwrap();
    std::fs::write(&from, b"sonradan olusmus").unwrap(); // eski konum DOLU

    let db = Db::open_in_memory_migrated().unwrap();
    let id = seed(&db, &to.to_string_lossy(), "yeni.dwg");
    let items = vec![MoveItem {
        id,
        from: from.to_string_lossy().to_string(),
        to: to.to_string_lossy().to_string(),
    }];
    let report = undo_mv(&db, &items);
    assert_eq!(report.reverted, 0);
    assert_eq!(report.skipped.len(), 1, "ezme-yok → skip");
    assert_eq!(report.skipped[0].reason, "target_exists");
    assert_eq!(std::fs::read(&from).unwrap(), b"sonradan olusmus", "mevcut dosya EZILMEDI");
}

#[test]
fn undo_meta_restores_only_listed_fields() {
    let db = Db::open_in_memory_migrated().unwrap();
    let id = seed(&db, r"C:\a\x.dwg", "x.dwg");
    // Baslangic: draft + Acme. Toplu islem approval'i approved yapti (kayitli eski=draft).
    // Sonrasinda kullanici client'i elle "Beta" yapti — geri-al client'a DOKUNMAMALI.
    db.connection()
        .execute(
            "UPDATE assets SET approval_status='approved', client_name='Beta' WHERE id=?1",
            params![id],
        )
        .unwrap();

    let payload = MetaPayload {
        fields: vec!["approval_status".into(), "rejection_reason".into()],
        items: vec![MetaItem {
            id,
            client_name: Some("Acme".into()), // yakalanmis ama fields'ta yok → yazilmaz
            approval_status: Some("draft".into()),
            rejection_reason: None,
            version_label: None,
            deadline: None,
        }],
        applied: AppliedMeta::default(),
    };
    let report = undo_meta_core(&db, &payload);
    assert_eq!(report.reverted, 1);

    let (approval, client): (Option<String>, Option<String>) = db
        .connection()
        .query_row(
            "SELECT approval_status, client_name FROM assets WHERE id=?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(approval.as_deref(), Some("draft"), "approval eski degere dondu");
    assert_eq!(client.as_deref(), Some("Beta"), "fields disi alana DOKUNULMADI");

    // Olmayan asset → not_found atlanir.
    let missing = MetaPayload {
        fields: vec!["client_name".into()],
        items: vec![MetaItem {
            id: 9999,
            client_name: None,
            approval_status: None,
            rejection_reason: None,
            version_label: None,
            deadline: None,
        }],
        applied: AppliedMeta::default(),
    };
    let r2 = undo_meta_core(&db, &missing);
    assert_eq!(r2.reverted, 0);
    assert_eq!(r2.skipped.len(), 1);
}

// ── Kurasyon geri-alimi ──
fn is_fav(db: &Db, id: i64) -> bool {
    db.connection()
        .query_row("SELECT count(*) FROM favorites WHERE asset_id=?1", params![id], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap()
        > 0
}
fn has_tag(db: &Db, id: i64, name: &str) -> bool {
    db.connection()
        .query_row(
            "SELECT count(*) FROM asset_tags at JOIN tags t ON t.id=at.tag_id
             WHERE at.asset_id=?1 AND t.name=?2",
            params![id, name],
            |r| r.get::<_, i64>(0),
        )
        .unwrap()
        > 0
}
fn is_active(db: &Db, id: i64) -> bool {
    db.connection()
        .query_row("SELECT deleted_at FROM assets WHERE id=?1", params![id], |r| {
            r.get::<_, Option<i64>>(0)
        })
        .unwrap()
        .is_none()
}

#[test]
fn undo_curation_favorite_and_trash_reverse() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, r"C:\a.txt", "a.txt");
    db.set_favorite(a, true).unwrap();
    // Undo "favorite_add" → favori kaldirilir.
    let rep =
        undo_cur(&mut db, KIND_FAVORITE_ADD, &format!(r#"{{"ids":[{a}]}}"#)).unwrap();
    assert_eq!(rep.reverted, 1);
    assert!(!is_fav(&db, a));

    // Cop → undo "trash" → restore.
    db.soft_delete(&[a]).unwrap();
    assert!(!is_active(&db, a));
    let rep = undo_cur(&mut db, KIND_TRASH, &format!(r#"{{"ids":[{a}]}}"#)).unwrap();
    assert_eq!(rep.reverted, 1);
    assert!(is_active(&db, a), "restore edildi");
}

#[test]
fn undo_curation_tag_add_and_remove_reverse() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, r"C:\a.txt", "a.txt");
    db.add_user_tag(a, "villa").unwrap();
    // Undo "tag_add" → etiket kalkar.
    undo_cur(&mut db, KIND_TAG_ADD, &format!(r#"{{"name":"villa","ids":[{a}]}}"#))
        .unwrap();
    assert!(!has_tag(&db, a, "villa"));
    // Undo "tag_remove" → etiket geri gelir.
    undo_cur(&mut db, KIND_TAG_REMOVE, &format!(r#"{{"name":"villa","ids":[{a}]}}"#))
        .unwrap();
    assert!(has_tag(&db, a, "villa"));
}

#[test]
fn undo_curation_collection_add_deletes_created_empty() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, r"C:\a.txt", "a.txt");
    let cid = db.create_collection("Yeni", None).unwrap();
    db.add_to_collection(cid, a).unwrap();
    // created=true → undo uyelikleri kaldirir + bos kalan koleksiyonu SILER.
    let payload = format!(r#"{{"collection_id":{cid},"created":true,"ids":[{a}]}}"#);
    let rep = undo_cur(&mut db, KIND_COLLECTION_ADD, &payload).unwrap();
    assert_eq!(rep.reverted, 1);
    assert_eq!(db.collection_item_count(cid).unwrap(), 0);
    assert!(db.collection_id_by_name("Yeni").unwrap().is_none(), "bos-olusan koleksiyon silindi");

    // created=false olsaydi koleksiyon KALIRDI (ayri koleksiyon).
    let cid2 = db.create_collection("Kalici", None).unwrap();
    db.add_to_collection(cid2, a).unwrap();
    let p2 = format!(r#"{{"collection_id":{cid2},"created":false,"ids":[{a}]}}"#);
    undo_cur(&mut db, KIND_COLLECTION_ADD, &p2).unwrap();
    assert!(db.collection_id_by_name("Kalici").unwrap().is_some(), "onceden-var koleksiyon durur");
}

#[test]
fn redo_moves_reapplies_forward() {
    let dir = tempfile::tempdir().unwrap();
    let from = dir.path().join("eski.dwg");
    let to = dir.path().join("org").join("eski.dwg");
    std::fs::create_dir_all(to.parent().unwrap()).unwrap();
    // Undo yapilmis durum: dosya `from`'da, DB yolu `from`.
    std::fs::write(&from, b"data").unwrap();
    let db = Db::open_in_memory_migrated().unwrap();
    let from_s = from.to_string_lossy().to_string();
    let to_s = to.to_string_lossy().to_string();
    let id = seed(&db, &from_s, "eski.dwg");

    // REDO (forward): from→to yeniden uygulanir.
    let items = vec![MoveItem { id, from: from_s.clone(), to: to_s.clone() }];
    let report = apply_moves(&db, &items, true, |_, _, _| {});
    assert_eq!(report.reverted, 1);
    assert!(to.exists() && !from.exists(), "ileri: dosya hedefe dondu");
    let db_path: String = db
        .connection()
        .query_row("SELECT path FROM assets WHERE id=?1", params![id], |r| r.get(0))
        .unwrap();
    assert_eq!(db_path, to_s);
}

#[test]
fn redo_favorite_and_trash_reapply_forward() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, r"C:\a.txt", "a.txt");
    // favorite_add redo → favori EKLE (undo kaldirmisti).
    let (r, _) =
        apply_curation(&mut db, KIND_FAVORITE_ADD, &format!(r#"{{"ids":[{a}]}}"#), true).unwrap();
    assert_eq!(r.reverted, 1);
    assert!(is_fav(&db, a), "ileri: favori geri eklendi");
    // trash redo → yeniden cope at (undo restore etmisti).
    apply_curation(&mut db, KIND_TRASH, &format!(r#"{{"ids":[{a}]}}"#), true).unwrap();
    assert!(!is_active(&db, a), "ileri: yeniden cope atildi");
}

#[test]
fn redo_collection_add_recreates_deleted_collection() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, r"C:\a.txt", "a.txt");
    // Senaryo: koleksiyon olustur → undo sildi (bos). Simdi REDO ada gore yeniden olusturmali.
    // (Koleksiyon su an YOK; payload eski id + created + name tasir.)
    let payload = r#"{"collection_id":999,"created":true,"name":"Yeni","ids":[ID]}"#
        .replace("ID", &a.to_string());
    let (r, new_payload) =
        apply_curation(&mut db, KIND_COLLECTION_ADD, &payload, true).unwrap();
    assert_eq!(r.reverted, 1);
    let cid = db.collection_id_by_name("Yeni").unwrap().expect("koleksiyon yeniden olustu");
    assert_eq!(db.collection_item_count(cid).unwrap(), 1, "uye geri eklendi");
    // Yeni id != 999 → payload guncellendi (sonraki undo dogru hedefler).
    assert!(new_payload.is_some(), "id degisti → payload guncellenir");
    assert!(new_payload.unwrap().contains(&format!("\"collection_id\":{cid}")));
}

#[test]
fn redo_meta_reapplies_new_values() {
    let db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, r"C:\a.txt", "a.txt");
    // applied = approval'i "approved" yapan yama. redo_meta bunu uygular.
    let payload = MetaPayload {
        fields: vec!["approval_status".into()],
        items: vec![MetaItem {
            id: a,
            client_name: None,
            approval_status: Some("draft".into()),
            rejection_reason: None,
            version_label: None,
            deadline: None,
        }],
        applied: AppliedMeta {
            approval_status: Some(Some("approved".into())),
            ..Default::default()
        },
    };
    let rep = redo_meta_core(&db, &payload);
    assert_eq!(rep.reverted, 1);
    let approval: Option<String> = db
        .connection()
        .query_row("SELECT approval_status FROM assets WHERE id=?1", params![a], |r| r.get(0))
        .unwrap();
    assert_eq!(approval.as_deref(), Some("approved"), "ileri: yeni deger yeniden yazildi");
}

#[test]
fn undo_curation_rejects_corrupt_and_unknown() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    assert_eq!(
        undo_cur(&mut db, KIND_TRASH, "not json").unwrap_err(),
        "corrupt_payload"
    );
    assert_eq!(
        undo_cur(&mut db, "bogus", r#"{"ids":[]}"#).unwrap_err(),
        "unknown_kind"
    );
}

// ── Etiket VARLIK islemleri (2026-07-26; H2 commandDeleteTag/commandRenameTag pariteli) ──

/// Silme geri alininca etiket ADIYLA, RENGIYLE ve TUM baglariyla geri gelmeli
/// (H2 `snapshotTag`/`restoreTag`). Bu, silmeyi "yikici ama kurtarilabilir" yapan kilit.
#[test]
fn tag_delete_undo_restores_name_color_and_links() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, "/x/a.txt", "a.txt");
    let b = seed(&db, "/x/b.txt", "b.txt");
    db.add_user_tag(a, "gecici").unwrap();
    db.add_user_tag(b, "gecici").unwrap();
    db.set_tag_color("gecici", Some("#ff0000")).unwrap();

    let color = db.tag_color("gecici").unwrap();
    let ids = db.delete_user_tag("gecici").unwrap();
    assert!(!has_tag(&db, a, "gecici") && !has_tag(&db, b, "gecici"), "silindi");

    let payload = serde_json::json!({ "name": "gecici", "color": color, "ids": ids }).to_string();
    let report = undo_cur(&mut db, KIND_TAG_DELETE, &payload).unwrap();
    assert_eq!(report.failed.len(), 0, "geri-al hatasiz olmali: {report:?}");
    assert!(has_tag(&db, a, "gecici") && has_tag(&db, b, "gecici"), "baglar geri gelmeli");
    assert_eq!(db.tag_color("gecici").unwrap().as_deref(), Some("#ff0000"), "renk de geri gelmeli");
}

/// Bagsiz (hic asset'i olmayan) etiket de geri gelmeli — `add_user_tag` hic kosmadigi icin
/// `ensure_user_tag` yolu devrede. (Aksi hâlde "etiketi sil → geri al" sessizce hicbir sey yapmazdi.)
#[test]
fn tag_delete_undo_restores_orphan_tag() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    db.ensure_user_tag("bostag").unwrap();
    let ids = db.delete_user_tag("bostag").unwrap();
    assert!(ids.is_empty(), "bagsiz etiketin asset'i yok");

    let payload = serde_json::json!({ "name": "bostag", "color": null, "ids": [] }).to_string();
    undo_cur(&mut db, KIND_TAG_DELETE, &payload).unwrap();
    let exists: i64 = db
        .connection()
        .query_row("SELECT count(*) FROM tags WHERE name='bostag'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(exists, 1, "bagsiz etiket de geri gelmeli");
}

/// Yeniden adlandirma cift yonlu: undo `yeni → eski`, redo `eski → yeni`.
#[test]
fn tag_rename_undo_and_redo_are_symmetric() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, "/x/a.txt", "a.txt");
    db.add_user_tag(a, "cehpe").unwrap();
    db.rename_user_tag("cehpe", "cephe").unwrap();
    assert!(has_tag(&db, a, "cephe"));

    let payload = serde_json::json!({ "old": "cehpe", "new": "cephe" }).to_string();
    // Undo → eski ada don.
    undo_cur(&mut db, KIND_TAG_RENAME, &payload).unwrap();
    assert!(has_tag(&db, a, "cehpe"), "undo eski adi geri getirmeli");
    // Redo → yeni ada don.
    apply_curation(&mut db, KIND_TAG_RENAME, &payload, true).unwrap();
    assert!(has_tag(&db, a, "cephe"), "redo yeni adi yeniden uygulamali");
}

/// Hedef ad araya girip DOLDUYSA geri-al sessizce birlestirMEZ → `failed` raporlanir.
/// (Sessiz birlestirme geri-alinamaz veri karisimi olurdu.)
#[test]
fn tag_rename_undo_reports_failure_when_old_name_taken() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed(&db, "/x/a.txt", "a.txt");
    db.add_user_tag(a, "cehpe").unwrap();
    db.rename_user_tag("cehpe", "cephe").unwrap();
    // Kullanici bu arada ESKI adla yeni bir etiket olusturdu.
    db.add_user_tag(a, "cehpe").unwrap();

    let payload = serde_json::json!({ "old": "cehpe", "new": "cephe" }).to_string();
    let report = undo_cur(&mut db, KIND_TAG_RENAME, &payload).unwrap();
    assert_eq!(report.failed.len(), 1, "cakisma failed olarak raporlanmali: {report:?}");
    assert!(has_tag(&db, a, "cephe"), "hedef etiket DOKUNULMAMIS kalmali");
}

// ── Kaynak-klasor GRUP islemleri (2026-07-27; H2 commandCreateRootGroup..commandSetRootGroup) ──

fn group_name_color(db: &Db, id: i64) -> Option<(String, String)> {
    db.root_group_name_color(id).unwrap()
}

/// CREATE: undo grubu siler, redo ad+renkle yeniden kurar (yeni id → payload guncellenir).
#[test]
fn root_group_create_undo_deletes_redo_recreates() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let gid = db.create_root_group("Villa", "#123456", 1).unwrap();
    let payload =
        serde_json::json!({ "group_id": gid, "name": "Villa", "color": "#123456", "root_ids": [] })
            .to_string();

    // Undo(create) → sil.
    let (rep, _) = apply_curation(&mut db, KIND_ROOT_GROUP_CREATE, &payload, false).unwrap();
    assert_eq!(rep.reverted, 1);
    assert!(group_name_color(&db, gid).is_none(), "grup silindi");

    // Redo(create) → ad+renkle yeniden dogar. (Yeni id ESKI'yle ayni olabilir — SQLite bos tabloda
    // rowid'i yeniden kullanir; o hâlde payload zaten dogru → guncelleme gerekmez. `new_payload`
    // yalniz id GERCEKTEN degisince dolar; mekanizma koleksiyon testinde ayrica dogrulanir.)
    let (rep2, _np) = apply_curation(&mut db, KIND_ROOT_GROUP_CREATE, &payload, true).unwrap();
    assert_eq!(rep2.reverted, 1);
    let g = db.list_root_groups().unwrap();
    let created = g.iter().find(|g| g.name == "Villa").expect("yeniden olustu");
    assert_eq!(created.color, "#123456");
}

/// DELETE (§9 asil kalem): undo grubu ad+renkle YENIDEN KURAR ve silme-ani uye kokleri YENIDEN
/// ATAR; redo tekrar siler. Silme FK SET NULL → kokler grupsuz kalir, undo geri baglar.
#[test]
fn root_group_delete_undo_recreates_and_reassigns_members() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let gid = db.create_root_group("Proje", "#abcdef", 1).unwrap();
    let (r1, _) = db.add_scanned_root("/a", "a", 1).unwrap();
    let (r2, _) = db.add_scanned_root("/b", "b", 1).unwrap();
    db.assign_root_group(r1, Some(gid)).unwrap();
    db.assign_root_group(r2, Some(gid)).unwrap();

    let members = db.root_ids_in_group(gid).unwrap();
    assert_eq!(members.len(), 2);
    db.delete_root_group(gid).unwrap();
    assert_eq!(db.root_group_of(r1).unwrap(), None, "silinince grupsuz (FK SET NULL)");

    let payload = serde_json::json!({
        "group_id": gid, "name": "Proje", "color": "#abcdef", "root_ids": members
    })
    .to_string();

    // Undo(delete) → grup geri + kokler yeniden atanir (yeni id).
    let (rep, np) = apply_curation(&mut db, KIND_ROOT_GROUP_DELETE, &payload, false).unwrap();
    assert_eq!(rep.reverted, 1);
    let new_gid = db.list_root_groups().unwrap().iter().find(|g| g.name == "Proje").unwrap().id;
    assert_eq!(db.root_group_of(r1).unwrap(), Some(new_gid), "r1 yeniden atandi");
    assert_eq!(db.root_group_of(r2).unwrap(), Some(new_gid), "r2 yeniden atandi");
    // Payload guncel grup id'sini tasimali: id degisince `new_payload`; degismeyince (SQLite rowid
    // yeniden kullanimi → new_gid==eski) orijinal zaten dogru. Ikisinde de redo dogru grubu hedefler.
    let updated = np.unwrap_or(payload);

    // Redo(delete) → guncel payload'la tekrar sil → kokler yine grupsuz.
    let (rep2, _) = apply_curation(&mut db, KIND_ROOT_GROUP_DELETE, &updated, true).unwrap();
    assert_eq!(rep2.reverted, 1);
    assert_eq!(db.root_group_of(r1).unwrap(), None, "redo-delete grupsuz birakir");
}

/// RENAME cift yonlu: undo eski ad, redo yeni ad.
#[test]
fn root_group_rename_undo_redo_symmetric() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let gid = db.create_root_group("Eski", "#111111", 1).unwrap();
    db.rename_root_group(gid, "Yeni").unwrap();
    let payload = serde_json::json!({ "group_id": gid, "old": "Eski", "new": "Yeni" }).to_string();

    apply_curation(&mut db, KIND_ROOT_GROUP_RENAME, &payload, false).unwrap();
    assert_eq!(group_name_color(&db, gid).unwrap().0, "Eski", "undo eski ad");
    apply_curation(&mut db, KIND_ROOT_GROUP_RENAME, &payload, true).unwrap();
    assert_eq!(group_name_color(&db, gid).unwrap().0, "Yeni", "redo yeni ad");
}

/// RECOLOR cift yonlu: undo eski renk, redo yeni renk.
#[test]
fn root_group_recolor_undo_redo_symmetric() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let gid = db.create_root_group("G", "#aaaaaa", 1).unwrap();
    db.recolor_root_group(gid, "#bbbbbb").unwrap();
    let payload =
        serde_json::json!({ "group_id": gid, "old": "#aaaaaa", "new": "#bbbbbb" }).to_string();

    apply_curation(&mut db, KIND_ROOT_GROUP_RECOLOR, &payload, false).unwrap();
    assert_eq!(group_name_color(&db, gid).unwrap().1, "#aaaaaa", "undo eski renk");
    apply_curation(&mut db, KIND_ROOT_GROUP_RECOLOR, &payload, true).unwrap();
    assert_eq!(group_name_color(&db, gid).unwrap().1, "#bbbbbb", "redo yeni renk");
}

/// ASSIGN cift yonlu (gruptan cikarma = `None` dahil): undo eski grup, redo yeni grup.
#[test]
fn root_group_assign_undo_redo_including_ungroup() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let g1 = db.create_root_group("G1", "#111111", 1).unwrap();
    let g2 = db.create_root_group("G2", "#222222", 1).unwrap();
    let (r, _) = db.add_scanned_root("/a", "a", 1).unwrap();
    db.assign_root_group(r, Some(g1)).unwrap();
    db.assign_root_group(r, Some(g2)).unwrap(); // islem: g1 → g2

    let payload =
        serde_json::json!({ "root_id": r, "old_group": g1, "new_group": g2 }).to_string();
    apply_curation(&mut db, KIND_ROOT_GROUP_ASSIGN, &payload, false).unwrap();
    assert_eq!(db.root_group_of(r).unwrap(), Some(g1), "undo eski gruba dondu");
    apply_curation(&mut db, KIND_ROOT_GROUP_ASSIGN, &payload, true).unwrap();
    assert_eq!(db.root_group_of(r).unwrap(), Some(g2), "redo yeni gruba dondu");

    // Gruptan cikarma: new=None (forward → grupsuz), undo → eski grup (g2).
    let p2 = serde_json::json!({ "root_id": r, "old_group": g2, "new_group": null }).to_string();
    apply_curation(&mut db, KIND_ROOT_GROUP_ASSIGN, &p2, true).unwrap();
    assert_eq!(db.root_group_of(r).unwrap(), None, "forward gruptan cikardi");
    apply_curation(&mut db, KIND_ROOT_GROUP_ASSIGN, &p2, false).unwrap();
    assert_eq!(db.root_group_of(r).unwrap(), Some(g2), "undo eski gruba dondu");
}