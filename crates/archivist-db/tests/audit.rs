//! #8 audit_log veri katmani testleri (migration 0013): record + list (en yeni-once) +
//! count + sayfalama + tie-break (ts esit → id azalan) + target/detail nullable round-trip.

use archivist_db::{AuditInput, Db};

/// Minimal girdi (target/detail None) — ts + action ile.
fn input<'a>(ts: i64, action: &'a str) -> AuditInput<'a> {
    AuditInput {
        ts,
        user_id: 1,
        username: "ahmet",
        role: "admin",
        action,
        target_type: None,
        target_id: None,
        detail: None,
    }
}

#[test]
fn record_then_list_newest_first() {
    let db = Db::open_in_memory_migrated().unwrap();
    db.record_audit(&input(100, "ingest")).unwrap();
    db.record_audit(&input(200, "trash")).unwrap();
    db.record_audit(&input(150, "restore")).unwrap();

    assert_eq!(db.audit_count().unwrap(), 3);
    let rows = db.list_audit(10, 0).unwrap();
    assert_eq!(rows.len(), 3);
    // en yeni once: ts azalan → 200, 150, 100.
    assert_eq!(rows.iter().map(|r| r.ts).collect::<Vec<_>>(), vec![200, 150, 100]);
    assert_eq!(rows[0].action, "trash");
    assert_eq!(rows[0].username, "ahmet");
    assert_eq!(rows[0].role, "admin");
}

#[test]
fn same_ts_breaks_tie_by_id_desc() {
    let db = Db::open_in_memory_migrated().unwrap();
    let id1 = db.record_audit(&input(500, "a")).unwrap();
    let id2 = db.record_audit(&input(500, "b")).unwrap();
    assert!(id2 > id1, "AUTOINCREMENT artan id vermeli");
    let rows = db.list_audit(10, 0).unwrap();
    // ayni ts → id azalan → en son eklenen (id2 = "b") once.
    assert_eq!(rows[0].action, "b");
    assert_eq!(rows[1].action, "a");
}

#[test]
fn pagination_limit_offset() {
    let db = Db::open_in_memory_migrated().unwrap();
    for i in 0..5 {
        db.record_audit(&input(1000 + i, "x")).unwrap();
    }
    // en yeni once → ts: 1004,1003,1002,1001,1000.
    let page1 = db.list_audit(2, 0).unwrap();
    assert_eq!(page1.iter().map(|r| r.ts).collect::<Vec<_>>(), vec![1004, 1003]);
    let page2 = db.list_audit(2, 2).unwrap();
    assert_eq!(page2.iter().map(|r| r.ts).collect::<Vec<_>>(), vec![1002, 1001]);
    // limit<=0 → bos (savunma).
    assert!(db.list_audit(0, 0).unwrap().is_empty());
}

#[test]
fn target_and_detail_roundtrip_including_null() {
    let db = Db::open_in_memory_migrated().unwrap();
    db.record_audit(&AuditInput {
        ts: 1,
        user_id: 2,
        username: "editor1",
        role: "editor",
        action: "trash",
        target_type: Some("asset"),
        target_id: Some("42"),
        detail: Some("3 dosya cope tasindi"),
    })
    .unwrap();
    // Sonra: tum opsiyonel alanlar None olan bir kayit (en yeni → ts=2).
    db.record_audit(&input(2, "logout")).unwrap();

    let rows = db.list_audit(10, 0).unwrap();
    // en yeni (ts=2) once → None alanlar.
    assert_eq!(rows[0].action, "logout");
    assert_eq!(rows[0].user_id, 1);
    assert_eq!(rows[0].target_type, None);
    assert_eq!(rows[0].target_id, None);
    assert_eq!(rows[0].detail, None);
    // dolu kayit (ts=1).
    let r = &rows[1];
    assert_eq!(r.user_id, 2);
    assert_eq!(r.role, "editor");
    assert_eq!(r.target_type.as_deref(), Some("asset"));
    assert_eq!(r.target_id.as_deref(), Some("42"));
    assert_eq!(r.detail.as_deref(), Some("3 dosya cope tasindi"));
}

// ── Saklama suresi budamasi (2026-07-18: audit omur boyu buyuyordu) ──────────────

#[test]
fn prune_removes_only_records_older_than_cutoff() {
    let db = Db::open_in_memory_migrated().unwrap();
    db.record_audit(&input(100, "eski")).unwrap();
    db.record_audit(&input(199, "sinirin_hemen_altinda")).unwrap();
    db.record_audit(&input(200, "sinirda")).unwrap();
    db.record_audit(&input(300, "yeni")).unwrap();

    // cutoff = 200 → `ts < 200` silinir; ts == 200 KALIR (sinir dahil).
    assert_eq!(db.prune_audit_before(200).unwrap(), 2);
    assert_eq!(db.audit_count().unwrap(), 2);

    let kept: Vec<String> = db.list_audit(10, 0).unwrap().into_iter().map(|r| r.action).collect();
    assert_eq!(kept, vec!["yeni".to_string(), "sinirda".to_string()]);
}

#[test]
fn prune_is_noop_when_nothing_is_old_enough() {
    let db = Db::open_in_memory_migrated().unwrap();
    db.record_audit(&input(500, "a")).unwrap();
    assert_eq!(db.prune_audit_before(100).unwrap(), 0);
    assert_eq!(db.audit_count().unwrap(), 1);
}
