//! Faz (H2 pariti) proje-durum alanlari entegrasyon testleri: set_project_meta →
//! get_asset round-trip, approval_status whitelist, None→NULL temizleme,
//! list_assets approval_status filtresi ve approval_facets sayimlari.
//! Migration 0008 (project_status) write/query yollariyla birlikte dogrulanir.

use archivist_db::{AssetInput, Db, IngestData, ListOpts, ProjectMeta, ProjectMetaPatch};

/// Minimal bir asset ingest et, id dondur (curation.rs ile ayni helper).
fn ingest_one(db: &mut Db, path: &str, name: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some("txt"),
            size_bytes: 1,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: 1,
            modified_at: 1,
        },
        &IngestData {
            fts_body: None,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

fn opts_approval(status: &str) -> ListOpts {
    ListOpts { page_size: 50, approval_status: vec![status.to_string()], ..Default::default() }
}

#[test]
fn set_project_meta_round_trips_through_get_asset() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");

    // Yeni asset → tum proje alanlari None (varsayilan NULL).
    let before = db.get_asset(a).unwrap().unwrap();
    assert_eq!(before.project.client_name, None);
    assert_eq!(before.project.approval_status, None);
    assert_eq!(before.project.rejection_reason, None);
    assert_eq!(before.project.version_label, None);
    assert_eq!(before.project.deadline, None);

    // 5 alani da ayarla → get_asset.project birebir okur.
    db.set_project_meta(
        a,
        &ProjectMeta {
            client_name: Some("Acme Mimarlik".into()),
            approval_status: Some("approved".into()),
            rejection_reason: None,
            version_label: Some("v2".into()),
            deadline: Some("2026-09-01".into()),
        },
    )
    .unwrap();

    let after = db.get_asset(a).unwrap().unwrap();
    assert_eq!(after.project.client_name.as_deref(), Some("Acme Mimarlik"));
    assert_eq!(after.project.approval_status.as_deref(), Some("approved"));
    assert_eq!(after.project.rejection_reason, None);
    assert_eq!(after.project.version_label.as_deref(), Some("v2"));
    assert_eq!(after.project.deadline.as_deref(), Some("2026-09-01"));
}

#[test]
fn invalid_approval_status_is_rejected() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");

    // Whitelist disi deger → Err (DbError::Invalid; SQL'e gitmeden reddedilir).
    let err = db
        .set_project_meta(
            a,
            &ProjectMeta { approval_status: Some("pending".into()), ..Default::default() },
        )
        .unwrap_err();
    assert!(matches!(err, archivist_db::DbError::Invalid(_)), "whitelist disi → Invalid");

    // Tum gecerli degerler kabul edilir.
    for status in ["draft", "review", "approved", "rejected"] {
        db.set_project_meta(
            a,
            &ProjectMeta { approval_status: Some(status.into()), ..Default::default() },
        )
        .unwrap_or_else(|_| panic!("gecerli status reddedildi: {status}"));
    }
}

#[test]
fn none_fields_clear_to_null() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");

    // Once doldur.
    db.set_project_meta(
        a,
        &ProjectMeta {
            client_name: Some("Acme".into()),
            approval_status: Some("review".into()),
            rejection_reason: Some("eksik".into()),
            version_label: Some("v1".into()),
            deadline: Some("2026-01-01".into()),
        },
    )
    .unwrap();
    assert!(db.get_asset(a).unwrap().unwrap().project.client_name.is_some());

    // Sonra tum-None ile yeniden ayarla → NULL'a temizlenir (UPDATE tum 5 kolonu yazar).
    db.set_project_meta(a, &ProjectMeta::default()).unwrap();
    let cleared = db.get_asset(a).unwrap().unwrap().project;
    assert_eq!(cleared.client_name, None);
    assert_eq!(cleared.approval_status, None);
    assert_eq!(cleared.rejection_reason, None);
    assert_eq!(cleared.version_label, None);
    assert_eq!(cleared.deadline, None);
}

#[test]
fn missing_asset_is_invalid() {
    let db = Db::open_in_memory_migrated().unwrap();
    // Olmayan asset id → etkilenen satir 0 → Invalid.
    let err = db.set_project_meta(9999, &ProjectMeta::default()).unwrap_err();
    assert!(matches!(err, archivist_db::DbError::Invalid(_)), "olmayan asset → Invalid");
}

#[test]
fn list_assets_filters_by_approval_status() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/b.txt", "b.txt");
    let c = ingest_one(&mut db, "/c.txt", "c.txt");

    db.set_project_meta(
        a,
        &ProjectMeta { approval_status: Some("approved".into()), ..Default::default() },
    )
    .unwrap();
    db.set_project_meta(
        b,
        &ProjectMeta { approval_status: Some("approved".into()), ..Default::default() },
    )
    .unwrap();
    db.set_project_meta(
        c,
        &ProjectMeta { approval_status: Some("draft".into()), ..Default::default() },
    )
    .unwrap();

    // Filtre: approved=2, draft=1, hic ayarlanmamis filtre → tum 3.
    assert_eq!(db.list_assets(&opts_approval("approved")).unwrap().total, 2);
    assert_eq!(db.list_assets(&opts_approval("draft")).unwrap().total, 1);
    assert_eq!(db.list_assets(&opts_approval("rejected")).unwrap().total, 0);
    assert_eq!(db.list_assets(&ListOpts { page_size: 50, ..Default::default() }).unwrap().total, 3);

    // FTS yolu (query dolu) ile birlikte de calisir (filtre AND match).
    let fts = db
        .list_assets(&ListOpts {
            page_size: 50,
            query: Some("a.txt".into()),
            approval_status: vec!["approved".into()],
            ..Default::default()
        })
        .unwrap();
    assert_eq!(fts.total, 1);
    assert_eq!(fts.items[0].id, a);
}

#[test]
fn approval_facets_counts() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/b.txt", "b.txt");
    let c = ingest_one(&mut db, "/c.txt", "c.txt");
    let _d = ingest_one(&mut db, "/d.txt", "d.txt"); // ayarlanmamis (NULL) → facet'te yok

    db.set_project_meta(
        a,
        &ProjectMeta { approval_status: Some("approved".into()), ..Default::default() },
    )
    .unwrap();
    db.set_project_meta(
        b,
        &ProjectMeta { approval_status: Some("approved".into()), ..Default::default() },
    )
    .unwrap();
    db.set_project_meta(
        c,
        &ProjectMeta { approval_status: Some("draft".into()), ..Default::default() },
    )
    .unwrap();
    // d → ayarlanmamis (NULL) → facet'te GORUNMEMELI.

    let facets = db.approval_facets().unwrap();
    // Yalniz NOT NULL durumlar; count azalan → approved (2) once, draft (1) sonra.
    assert_eq!(facets.len(), 2, "yalniz ayarlanmis (NOT NULL) durumlar");
    assert_eq!(facets[0].value.as_deref(), Some("approved"));
    assert_eq!(facets[0].count, 2);
    assert_eq!(facets[1].value.as_deref(), Some("draft"));
    assert_eq!(facets[1].count, 1);

    // §O: cop'e atilan asset facet'ten dusmeli (deleted_at IS NULL).
    db.soft_delete(&[b]).unwrap();
    let after = db.approval_facets().unwrap();
    let approved = after.iter().find(|f| f.value.as_deref() == Some("approved")).unwrap();
    assert_eq!(approved.count, 1, "cop'teki asset facet sayisina girmemeli");

    // d hala etkisiz (NULL).
    assert!(after.iter().all(|f| f.value.is_some()));
}

#[test]
fn reingest_preserves_project_meta() {
    // Re-ingest (ON CONFLICT UPDATE) proje-durum kolonlarina DOKUNMAZ → kullanici
    // alanlari korunur (write.rs upsert kolon listesi dogrulamasi).
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = ingest_one(&mut db, "/a.txt", "a.txt");
    db.set_project_meta(
        a,
        &ProjectMeta {
            client_name: Some("Acme".into()),
            approval_status: Some("approved".into()),
            ..Default::default()
        },
    )
    .unwrap();

    // Ayni yolu yeniden ingest et (size degisti) → ayni asset guncellenir.
    db.ingest(
        &AssetInput {
            path: "/a.txt",
            file_name: "a.txt",
            ext: Some("txt"),
            size_bytes: 999,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: 1,
            modified_at: 2,
        },
        &IngestData {
            fts_body: None,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .unwrap();

    let detail = db.get_asset(a).unwrap().unwrap();
    assert_eq!(detail.asset.size_bytes, 999, "re-ingest cekirdek alani gunceller");
    assert_eq!(detail.project.client_name.as_deref(), Some("Acme"), "proje alani korunur");
    assert_eq!(detail.project.approval_status.as_deref(), Some("approved"));
}

// ── Toplu proje-durum (bulk_update_project_meta) — kismi-uygula semantigi ─────

/// Bir asset'i tam meta ile tohumla (bulk testleri icin baslangic durumu).
fn seed_full(db: &mut Db, path: &str, name: &str) -> i64 {
    let id = ingest_one(db, path, name);
    db.set_project_meta(
        id,
        &ProjectMeta {
            client_name: Some("Acme".into()),
            approval_status: Some("draft".into()),
            version_label: Some("v1".into()),
            deadline: Some("2026-01-01".into()),
            ..Default::default()
        },
    )
    .unwrap();
    id
}

#[test]
fn bulk_applies_only_selected_fields_and_preserves_rest() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed_full(&mut db, "/a.txt", "a.txt");
    let b = seed_full(&mut db, "/b.txt", "b.txt");

    // Yalniz approval'i "approved" yap; client/version/deadline'a DOKUNMA.
    let n = db
        .bulk_update_project_meta(
            &[a, b],
            &ProjectMetaPatch {
                approval_status: Some(Some("approved".into())),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(n, 2, "iki asset guncellendi");

    for id in [a, b] {
        let p = db.get_asset(id).unwrap().unwrap().project;
        assert_eq!(p.approval_status.as_deref(), Some("approved"), "approval yazildi");
        assert_eq!(p.client_name.as_deref(), Some("Acme"), "client KORUNDU (isaretsiz)");
        assert_eq!(p.version_label.as_deref(), Some("v1"), "version KORUNDU (isaretsiz)");
        assert_eq!(p.deadline.as_deref(), Some("2026-01-01"), "deadline KORUNDU (isaretsiz)");
    }
}

#[test]
fn bulk_clears_field_with_some_none() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed_full(&mut db, "/a.txt", "a.txt");

    // client_name = Some(None) → temizle (NULL); version'a dokunma.
    let n = db
        .bulk_update_project_meta(
            &[a],
            &ProjectMetaPatch { client_name: Some(None), ..Default::default() },
        )
        .unwrap();
    assert_eq!(n, 1);
    let p = db.get_asset(a).unwrap().unwrap().project;
    assert_eq!(p.client_name, None, "client temizlendi");
    assert_eq!(p.version_label.as_deref(), Some("v1"), "version KORUNDU");
    assert_eq!(p.approval_status.as_deref(), Some("draft"), "approval KORUNDU");
}

#[test]
fn bulk_rejects_invalid_approval_but_allows_clear() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed_full(&mut db, "/a.txt", "a.txt");

    // Whitelist disi deger → Invalid (SQL'e gitmeden reddedilir).
    let err = db
        .bulk_update_project_meta(
            &[a],
            &ProjectMetaPatch {
                approval_status: Some(Some("pending".into())),
                ..Default::default()
            },
        )
        .unwrap_err();
    assert!(matches!(err, archivist_db::DbError::Invalid(_)), "whitelist disi → Invalid");

    // Temizleme (Some(None)) whitelist'e takilmaz.
    db.bulk_update_project_meta(
        &[a],
        &ProjectMetaPatch { approval_status: Some(None), ..Default::default() },
    )
    .unwrap();
    assert_eq!(db.get_asset(a).unwrap().unwrap().project.approval_status, None, "temizlendi");
}

#[test]
fn bulk_noop_on_empty_ids_or_empty_patch() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed_full(&mut db, "/a.txt", "a.txt");

    // Bos ids → 0 (kolon secili olsa bile SQL kosmaz).
    assert_eq!(
        db.bulk_update_project_meta(&[], &ProjectMetaPatch { client_name: Some(None), ..Default::default() })
            .unwrap(),
        0
    );
    // Bos yama (hicbir alan) → 0.
    assert_eq!(db.bulk_update_project_meta(&[a], &ProjectMetaPatch::default()).unwrap(), 0);
    // Ikisinde de degisiklik olmamali.
    assert_eq!(
        db.get_asset(a).unwrap().unwrap().project.client_name.as_deref(),
        Some("Acme"),
        "no-op → korunur"
    );
}

#[test]
fn project_meta_for_captures_current_values() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed_full(&mut db, "/a.txt", "a.txt");
    let b = ingest_one(&mut db, "/b.txt", "b.txt"); // hic ayarlanmamis → hepsi None

    let mut got = db.project_meta_for(&[a, b, 9999]).unwrap();
    got.sort_by_key(|(id, _)| *id);
    assert_eq!(got.len(), 2, "eksik id sonuca girmez");
    assert_eq!(got[0].0, a);
    assert_eq!(got[0].1.client_name.as_deref(), Some("Acme"));
    assert_eq!(got[0].1.approval_status.as_deref(), Some("draft"));
    assert_eq!(got[0].1.version_label.as_deref(), Some("v1"));
    assert_eq!(got[0].1.deadline.as_deref(), Some("2026-01-01"));
    assert_eq!(got[1].0, b);
    assert_eq!(got[1].1.client_name, None);
    assert!(db.project_meta_for(&[]).unwrap().is_empty());
}

#[test]
fn bulk_updates_only_given_ids() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed_full(&mut db, "/a.txt", "a.txt");
    let b = seed_full(&mut db, "/b.txt", "b.txt");

    // Yalniz a'yi hedefle → b etkilenmez.
    let n = db
        .bulk_update_project_meta(
            &[a],
            &ProjectMetaPatch {
                approval_status: Some(Some("approved".into())),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(n, 1);
    assert_eq!(db.get_asset(a).unwrap().unwrap().project.approval_status.as_deref(), Some("approved"));
    assert_eq!(db.get_asset(b).unwrap().unwrap().project.approval_status.as_deref(), Some("draft"), "b etkilenmedi");
}

// ── Musteri / Versiyon / Termin-yili facet + filtre (proje-durum, non-destructive UI) ──

/// Bir asset'e musteri/versiyon/termin ata (facet/filtre testleri icin).
fn seed_pm(db: &mut Db, path: &str, name: &str, client: &str, version: &str, deadline: &str) -> i64 {
    let id = ingest_one(db, path, name);
    db.set_project_meta(
        id,
        &ProjectMeta {
            client_name: Some(client.into()),
            version_label: Some(version.into()),
            deadline: Some(deadline.into()),
            ..Default::default()
        },
    )
    .unwrap();
    id
}

#[test]
fn client_version_year_facets_count_active_only() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed_pm(&mut db, "/a.txt", "a.txt", "Acme", "v2", "2026-09-01");
    let _b = seed_pm(&mut db, "/b.txt", "b.txt", "Acme", "v1", "2026-01-01");
    let _c = seed_pm(&mut db, "/c.txt", "c.txt", "Beta", "v2", "2025-05-05");
    let _d = ingest_one(&mut db, "/d.txt", "d.txt"); // ayarsiz → hicbir facet'te yok

    // Musteri: Acme 2, Beta 1 (count DESC).
    let cf = db.client_facets(50).unwrap();
    assert_eq!(cf.len(), 2, "yalniz ayarli musteriler");
    assert_eq!(cf[0].value.as_deref(), Some("Acme"));
    assert_eq!(cf[0].count, 2);
    assert_eq!(cf[1].value.as_deref(), Some("Beta"));

    // Versiyon: v2 2, v1 1.
    let vf = db.version_facets(50).unwrap();
    assert_eq!(vf.len(), 2);
    assert_eq!(vf[0].value.as_deref(), Some("v2"));
    assert_eq!(vf[0].count, 2);

    // Termin yili: 2026 (2), 2025 (1) — yil DESC.
    let yf = db.deadline_year_facets().unwrap();
    assert_eq!(yf.len(), 2);
    assert_eq!(yf[0].value.as_deref(), Some("2026"));
    assert_eq!(yf[0].count, 2);
    assert_eq!(yf[1].value.as_deref(), Some("2025"));

    // §O: cop → facet'ten duser (deleted_at IS NULL).
    db.soft_delete(&[a]).unwrap();
    let acme = db.client_facets(50).unwrap().into_iter().find(|f| f.value.as_deref() == Some("Acme")).unwrap();
    assert_eq!(acme.count, 1, "cop'teki asset musteri sayisina girmez");
    let y2026 = db.deadline_year_facets().unwrap().into_iter().find(|f| f.value.as_deref() == Some("2026")).unwrap();
    assert_eq!(y2026.count, 1, "cop'teki asset yil sayisina girmez");
}

#[test]
fn list_assets_filters_by_client_version_and_year() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = seed_pm(&mut db, "/a.txt", "a.txt", "Acme", "v2", "2026-09-01");
    let _b = seed_pm(&mut db, "/b.txt", "b.txt", "Acme", "v1", "2025-01-01");
    let _c = seed_pm(&mut db, "/c.txt", "c.txt", "Beta", "v2", "2026-03-03");

    let by_client = ListOpts { page_size: 50, client_name: vec!["Acme".into()], ..Default::default() };
    assert_eq!(db.list_assets(&by_client).unwrap().total, 2);

    let by_version = ListOpts { page_size: 50, version_label: vec!["v2".into()], ..Default::default() };
    assert_eq!(db.list_assets(&by_version).unwrap().total, 2);

    let by_year = ListOpts { page_size: 50, deadline_year: vec!["2026".into()], ..Default::default() };
    assert_eq!(db.list_assets(&by_year).unwrap().total, 2);

    // Facet-ARASI AND: Acme + 2026 → yalniz a.
    let both = ListOpts {
        page_size: 50,
        client_name: vec!["Acme".into()],
        deadline_year: vec!["2026".into()],
        ..Default::default()
    };
    let r = db.list_assets(&both).unwrap();
    assert_eq!(r.total, 1);
    assert_eq!(r.items[0].id, a);

    // Facet-ICI OR: v1 veya v2 → 3.
    let or = ListOpts {
        page_size: 50,
        version_label: vec!["v1".into(), "v2".into()],
        ..Default::default()
    };
    assert_eq!(db.list_assets(&or).unwrap().total, 3);

    // Bos filtre → tum 3 (geriye-uyum).
    assert_eq!(db.list_assets(&ListOpts { page_size: 50, ..Default::default() }).unwrap().total, 3);
}
