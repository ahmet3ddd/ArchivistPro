//! Test fixture'i: GERCEK H2 kolon adlariyla mini H2 arsivi kurar.
//!
//! Sema, H2 kaynagindan cikarilan okunan-alt-kumedir (C:\Arsiv-H2 src/services/database.ts
//! `_applySchema` — kesif raporu 2026-08-10). Satir seti, plan'in test matrisini tasir:
//! ISO + tam AI · `datetime('now')` bicimi + etiket/favori · silinmis · ayni-yol cifti ·
//! H3'te karsiligi olmayan yol · bozuk zaman · yalniz aiClassification · kelepce vakasi.

use std::path::{Path, PathBuf};

/// Mini H2 arsivi olustur; DB yolunu dondur.
pub fn build_h2_fixture(dir: &Path) -> PathBuf {
    let db_path = dir.join("archivist.db");
    let conn = rusqlite::Connection::open(&db_path).expect("fixture DB");
    conn.execute_batch(
        r#"
        CREATE TABLE assets (
            id TEXT PRIMARY KEY,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            file_type TEXT,
            category TEXT,
            created_at TEXT,
            modified_at TEXT,
            fs_mtime INTEGER,
            is_deleted INTEGER DEFAULT 0,
            deleted_at TEXT,
            metadata_json TEXT,
            ai_tags_json TEXT,
            color_palette_json TEXT,
            thumbnail_url TEXT,
            extracted_at TEXT,
            client_name TEXT,
            approval_status TEXT DEFAULT 'draft',
            rejection_reason TEXT,
            version_label TEXT,
            deadline TEXT
        );
        CREATE TABLE tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#6366f1',
            created_at TEXT
        );
        CREATE TABLE asset_tags (
            asset_id TEXT NOT NULL,
            tag_id INTEGER NOT NULL,
            created_at TEXT,
            PRIMARY KEY (asset_id, tag_id)
        );
        CREATE TABLE favorites (asset_id TEXT PRIMARY KEY, created_at TEXT);
        CREATE TABLE collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#a855f7',
            created_at TEXT
        );
        CREATE TABLE collection_items (
            collection_id INTEGER NOT NULL,
            asset_id TEXT NOT NULL,
            added_at TEXT,
            PRIMARY KEY (collection_id, asset_id)
        );
        CREATE TABLE scanned_roots (
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            label TEXT NOT NULL,
            added_at TEXT,
            last_scan TEXT,
            file_count INTEGER DEFAULT 0,
            status TEXT DEFAULT 'active',
            group_id TEXT,
            is_favorite INTEGER DEFAULT 0
        );
        CREATE TABLE root_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#6366f1',
            sort_order INTEGER,
            created_at TEXT
        );
        CREATE TABLE root_tags (root_id TEXT NOT NULL, tag_id INTEGER NOT NULL,
                                PRIMARY KEY (root_id, tag_id));
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'viewer'
        );
        CREATE TABLE chat_sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT);
        PRAGMA user_version = 3;
        "#,
    )
    .expect("fixture sema");

    // 1x1 PNG (gecerli base64 goruntu) — thumbnail tasima testi icin.
    const PNG_1PX: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    let ins = |id: &str, name: &str, path: &str, extra: &[(&str, &dyn rusqlite::ToSql)]| {
        let mut cols = vec!["id", "file_name", "file_path", "file_size", "fs_mtime"];
        let mut vals: Vec<&dyn rusqlite::ToSql> = vec![&id, &name, &path, &4096i64, &1_750_000_000i64];
        for (c, v) in extra {
            cols.push(c);
            vals.push(*v);
        }
        let ph: Vec<String> = (1..=vals.len()).map(|i| format!("?{i}")).collect();
        conn.execute(
            &format!("INSERT INTO assets ({}) VALUES ({})", cols.join(","), ph.join(",")),
            vals.as_slice(),
        )
        .expect("fixture asset");
    };

    // a1 — ISO zaman + TAM AI metadata (tur kelepcesi: "Kat Planı" birebir).
    let a1_meta = r#"{"dwgDrawingType":"Kat Planı","dwgDescription":"3. kat konut planı","dwgElements":["duvar","kapı"],"dwgSpaces":["salon"],"dwgKeywords":["konut","plan"],"dwgDomainTerms":["mukarnas"]}"#;
    let thumb = format!("data:image/png;base64,{PNG_1PX}");
    ins(
        "a1a1a1a1a1a1a1a1",
        "plan.dwg",
        "D:\\proje\\plan.dwg",
        &[
            ("created_at", &"2026-06-26T07:39:43.733Z"),
            ("modified_at", &"2026-06-26T07:39:43Z"),
            ("metadata_json", &a1_meta),
            ("extracted_at", &"2026-06-27T10:00:00Z"),
            ("thumbnail_url", &thumb),
        ],
    );

    // a2 — datetime('now') bicimi + etiket + favori + proje-meta + ai_tags.
    ins(
        "a2a2a2a2a2a2a2a2",
        "cephe.jpg",
        "D:\\proje\\cephe.jpg",
        &[
            ("created_at", &"2026-06-26 07:39:43"),
            ("modified_at", &"2026-06-26 07:39:43"),
            ("ai_tags_json", &r#"[{"label":"cami","confidence":0.9,"source":"clip"},{"label":"minare","confidence":0.8,"source":"clip"}]"#),
            ("client_name", &"Karpem"),
            ("approval_status", &"review"),
        ],
    );

    // a3 — H2 copunde.
    ins(
        "a3a3a3a3a3a3a3a3",
        "eski.psd",
        "D:\\proje\\eski.psd",
        &[("is_deleted", &1i64), ("deleted_at", &"2026-05-01T00:00:00Z")],
    );

    // a4/a5 — AYNI yol (kasa varyantli), farkli extracted_at → a5 kazanmali.
    ins(
        "a4a4a4a4a4a4a4a4",
        "kesit.dwg",
        "D:\\proje\\KESIT.dwg",
        &[
            ("extracted_at", &"2026-01-01T00:00:00Z"),
            ("metadata_json", &r#"{"dwgDrawingType":"Detay","dwgDescription":"ESKI analiz"}"#),
        ],
    );
    ins(
        "a5a5a5a5a5a5a5a5",
        "kesit.dwg",
        "d:\\proje\\kesit.dwg",
        &[
            ("extracted_at", &"2026-07-01T00:00:00Z"),
            ("metadata_json", &r#"{"dwgDrawingType":"Kesit","dwgDescription":"GUNCEL analiz"}"#),
        ],
    );

    // a6 — H3'te karsiligi olmayacak yol (CreateAsset dali) + bozuk zaman (a7 ile birlesik:
    // ayni satirda bozuk created_at → geri-dusus zinciri fs_mtime'a iner).
    ins(
        "a6a6a6a6a6a6a6a6",
        "kayip.max",
        "E:\\artik\\yok\\kayip.max",
        &[("created_at", &"bozuk-zaman"), ("modified_at", &"26/06/2026")],
    );

    // a8 — yalniz aiClassification (gorsel-turu dali).
    ins(
        "a8a8a8a8a8a8a8a8",
        "render.png",
        "D:\\proje\\render.png",
        &[("metadata_json", &r#"{"aiClassification":{"type":"Render","confidence":0.8}}"#)],
    );

    // a9 — kelepce vakasi: kucuk-harf/asci "kat plani" → kanonik "Kat Planı"na oturmali.
    ins(
        "a9a9a9a9a9a9a9a9",
        "taslak.dwg",
        "D:\\proje\\taslak.dwg",
        &[("metadata_json", &r#"{"dwgDrawingType":"kat plani","dwgDescription":"taslak"}"#)],
    );

    conn.execute_batch(
        r#"
        INSERT INTO tags (name, color) VALUES ('onemli', '#ff0000');
        INSERT INTO asset_tags (asset_id, tag_id) VALUES ('a2a2a2a2a2a2a2a2', 1);
        INSERT INTO favorites (asset_id) VALUES ('a2a2a2a2a2a2a2a2');
        INSERT INTO collections (name, color) VALUES ('Sunum Seti', '#00ff00');
        INSERT INTO collection_items (collection_id, asset_id) VALUES (1, 'a1a1a1a1a1a1a1a1');
        INSERT INTO root_groups (id, name, color) VALUES ('g-uuid-1', 'pasif', '#ff00c8');
        INSERT INTO scanned_roots (id, path, label, group_id, is_favorite, added_at)
            VALUES ('r-uuid-1', 'D:\proje', 'proje', 'g-uuid-1', 1, '2026-06-01T00:00:00Z');
        INSERT INTO root_tags (root_id, tag_id) VALUES ('r-uuid-1', 1);
        INSERT INTO users (username, password_hash, role) VALUES ('ahmet', 'salt:hash', 'admin');
        INSERT INTO chat_sessions (id, title) VALUES ('cs_1', 'test sohbeti');
        "#,
    )
    .expect("fixture kurasyon");

    db_path
}
