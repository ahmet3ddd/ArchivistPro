//! Veri katmani entegrasyon testleri.
//!
//! En riskli katman → test-first (data-migration ajani kurali). Bu testler
//! migration framework'unu, FTS5 trigger senkronunu ve DB-ici sqlite-vec kNN'i
//! gercek (bellek-ici) bir SQLite uzerinde dogrular.

use archivist_db::{connection, health, migrations};
use rusqlite::params;

/// 384-boyutlu birim vektor (tek "sicak" boyut 1.0, gerisi 0.0) — JSON gosterimi.
/// Sema `FLOAT[384]` (migration 0009) oldugundan boyut tam 384 olmali.
fn unit_vec(hot: usize) -> String {
    let mut parts = vec!["0"; 384];
    parts[hot] = "1";
    format!("[{}]", parts.join(","))
}

#[test]
fn migrations_apply_from_scratch() {
    let mut conn = connection::open_in_memory().unwrap();
    let report = migrations::run(&mut conn).unwrap();
    let expected: Vec<i64> = migrations::MIGRATIONS.iter().map(|m| m.version).collect();
    assert_eq!(report.from_version, 0);
    assert_eq!(report.to_version, *expected.last().unwrap());
    assert_eq!(report.applied, expected);
}

#[test]
fn migrations_are_idempotent() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    let second = migrations::run(&mut conn).unwrap();
    let latest = migrations::MIGRATIONS.last().unwrap().version;
    assert!(second.applied.is_empty(), "ikinci kosu hicbir migration uygulamamali");
    assert_eq!(second.from_version, latest);
    assert_eq!(second.to_version, latest);
}

#[test]
fn migration_0027_removes_untrusted_scale_and_normalizes_software() {
    let mut conn = connection::open_in_memory().unwrap();
    for m in migrations::MIGRATIONS.iter().filter(|m| m.version <= 26) {
        conn.execute_batch(m.sql).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 26;").unwrap();
    conn.execute(
        "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
         VALUES (1, '/a/drawing.dwg', 'drawing.dwg', 'dwg', 10, 1, 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
         VALUES (2, '/a/image.jpg', 'image.jpg', 'jpg', 10, 1, 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO asset_metadata(asset_id, key, value_text) VALUES (?1, ?2, ?3)",
        params![1, "scale", "1/50"],
    )
    .unwrap();
    let quote = char::from(34);
    let quoted_software = format!("{quote}Adobe Photoshop CS4 Windows{quote}");
    let inner_quote_software = format!("Adobe {quote}Photoshop{quote}");
    conn.execute(
        "INSERT INTO asset_metadata(asset_id, key, value_text) VALUES (?1, ?2, ?3)",
        params![1, "software", quoted_software],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO asset_metadata(asset_id, key, value_text) VALUES (?1, ?2, ?3)",
        params![2, "software", inner_quote_software],
    )
    .unwrap();

    let report = migrations::run(&mut conn).unwrap();
    // Beklenen liste MIGRATIONS'tan TURETILIR (satir 22 deseni): yeni migration
    // eklendiginde test bayatlamaz ama "v26 sonrasi hicbiri atlanmadi" korunur.
    let expected: Vec<i64> =
        migrations::MIGRATIONS.iter().map(|m| m.version).filter(|v| *v > 26).collect();
    assert_eq!(report.applied, expected, "v26 sonrasi TUM bekleyen migration'lar uygulanmali");
    let scale_rows: i64 = conn
        .query_row("SELECT count(*) FROM asset_metadata WHERE key = 'scale'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(scale_rows, 0, "onceki guvenilmez scale degerleri silinmeli");
    let software: String = conn
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id = 1 AND key = 'software'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(software, "Adobe Photoshop CS4 Windows");
    let untouched: String = conn
        .query_row(
            "SELECT value_text FROM asset_metadata WHERE asset_id = 2 AND key = 'software'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(untouched, format!("Adobe {quote}Photoshop{quote}"));
}

#[test]
fn migration_0028_promotes_oldest_existing_admin_to_founder() {
    let mut conn = connection::open_in_memory().unwrap();
    for migration in migrations::MIGRATIONS.iter().filter(|migration| migration.version <= 27) {
        conn.execute_batch(migration.sql).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 27;").unwrap();
    conn.execute(
        "INSERT INTO users(id, username, role, password_hash)
         VALUES (4, 'later-admin', 'admin', 'hash')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO users(id, username, role, password_hash)
         VALUES (2, 'first-admin', 'admin', 'hash')",
        [],
    )
    .unwrap();

    let report = migrations::run(&mut conn).unwrap();
    let expected: Vec<i64> =
        migrations::MIGRATIONS.iter().map(|m| m.version).filter(|v| *v > 27).collect();
    assert_eq!(report.applied, expected, "v27 sonrasi TUM bekleyen migration'lar uygulanmali");
    let founder_id: i64 = conn
        .query_row("SELECT id FROM users WHERE is_founder = 1", [], |row| row.get(0))
        .unwrap();
    assert_eq!(founder_id, 2);
    let table_exists: bool = conn
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_messages'
             )",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(table_exists);
}

#[test]
fn schema_migrations_audit_recorded() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    let (version, name): (i64, String) = conn
        .query_row(
            "SELECT version, name FROM schema_migrations ORDER BY version DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    let latest = migrations::MIGRATIONS.last().unwrap();
    assert_eq!(version, latest.version);
    assert_eq!(name, latest.name);
}

#[test]
fn core_objects_exist() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    for obj in [
        "assets",
        "tags",
        "asset_tags",
        "relations",
        "assets_fts",
        "asset_vectors",
        "asset_image_region_vectors",
        "schema_migrations",
        "app_meta",
    ] {
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name = ?1",
                [obj],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "beklenen nesne yok: {obj}");
    }
}

#[test]
fn project_status_columns_and_index_present() {
    // v8 (project_status): assets'e 5 proje-durum kolonu + approval_status indeksi.
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    // Sema versiyonu en az 8 (project_status uygulandi).
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert!(version >= 8, "project_status (v8) uygulanmadi: user_version={version}");

    // 5 kolon assets tablosunda var (PRAGMA table_info).
    let mut have: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(assets)").unwrap();
        let cols = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        cols.into_iter()
            .filter(|c| {
                matches!(
                    c.as_str(),
                    "client_name"
                        | "approval_status"
                        | "rejection_reason"
                        | "version_label"
                        | "deadline"
                )
            })
            .collect()
    };
    have.sort();
    assert_eq!(
        have,
        vec![
            "approval_status",
            "client_name",
            "deadline",
            "rejection_reason",
            "version_label"
        ],
        "5 proje-durum kolonunun tamami olmali"
    );

    // approval_status indeksi olusmus olmali.
    let idx: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_assets_approval_status'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(idx, 1, "idx_assets_approval_status indeksi yok");
}

#[test]
fn projects_table_and_column_present() {
    // v19 (projects): GERCEK proje entity'si — projects tablosu + assets.project_id FK kolonu
    // + indeksler. (Ayrintili CRUD/FK-SET-NULL davranisi: tests/projects.rs.)
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert!(version >= 19, "projects (v19) uygulanmadi: user_version={version}");

    // projects tablosu var.
    let t: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='projects'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(t, 1, "projects tablosu yok");

    // assets.project_id kolonu var.
    let has_col = {
        let mut stmt = conn.prepare("PRAGMA table_info(assets)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
            .iter()
            .any(|c| c == "project_id")
    };
    assert!(has_col, "assets.project_id kolonu yok");

    // Indeksler olusmus.
    for idx in ["idx_projects_name", "idx_assets_project"] {
        let n: i64 = conn
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?1",
                [idx],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1, "indeks yok: {idx}");
    }
}

#[test]
fn assets_fts_has_ai_column_v21() {
    // v21 (assets_fts_ai): assets_fts YENIDEN kurulur + `ai` kolonu (AI vision-betim koprusu).
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert!(version >= 21, "assets_fts_ai (v21) uygulanmadi: user_version={version}");

    // Yeni asset → trigger fts satirini kurar (ai=''); ai kolonuna yaz + kolon-filtreli MATCH.
    conn.execute(
        "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
         VALUES (1, '/a/x.jpg', 'x.jpg', 'jpg', 10, 1, 1)",
        [],
    )
    .unwrap();
    conn.execute("UPDATE assets_fts SET ai = 'cami bulut gokyuzu' WHERE asset_id = 1", [])
        .unwrap();

    // `ai` kolonu var + aranabilir (kolon-filtreli MATCH → kolon gercekten mevcut).
    let col_hits: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'ai:bulut'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(col_hits, 1, "ai kolonu var + kolon-filtreli aranabilir");

    // Kolon-filtresiz (ana kutu) MATCH da ai metnini kapsar.
    let any_hits: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'gokyuzu'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(any_hits, 1, "kolon-filtresiz MATCH ai metnini tarar");
}

#[test]
fn migration_0021_backfills_analyzed_assets() {
    // 0021 ONCESI analiz edilmis asset'ler (ai_* metadata VAR, assets_fts.ai YOK) yukseltmede
    // backfill edilmeli. Pre-0021 durumu simule et: migration'lari 1..=20 elle uygula + user_version=20;
    // sonra migrations::run YALNIZ v21'i (backfill dahil) uygular.
    let mut conn = connection::open_in_memory().unwrap();
    for m in migrations::MIGRATIONS.iter().filter(|m| m.version <= 20) {
        conn.execute_batch(m.sql).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 20;").unwrap();

    // Analizli asset (ai_* metadata + ai_analyzed marker; assets_fts.ai bu semada YOK).
    conn.execute(
        "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
         VALUES (1, '/a/img.jpg', 'img.jpg', 'jpg', 10, 1, 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO asset_metadata(asset_id, key, value_text)
         VALUES (1, 'ai_aciklama', 'cami avlusu bulut gokyuzu')",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO asset_metadata(asset_id, key, value_text) VALUES (1, 'ai_analyzed', '1')",
        [],
    )
    .unwrap();
    // Analizsiz asset (ai_analyzed YOK) → backfill edilmemeli (ai bos kalmali).
    conn.execute(
        "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
         VALUES (2, '/a/other.jpg', 'other.jpg', 'jpg', 10, 1, 1)",
        [],
    )
    .unwrap();

    // v21+ uygula (v21 backfill hedefi; sonraki tum bekleyenler de kosar). Test v21'e odakli →
    // ilk uygulananin v21 oldugunu dogrula (yeni migration eklendikce kirilmayan iddia).
    let report = migrations::run(&mut conn).unwrap();
    assert_eq!(report.applied.first(), Some(&21), "v20 sonrasi ilk bekleyen v21 (backfill) olmali");

    // Analizli asset backfill edildi → ai kolonunda betim metni.
    let ai1: String =
        conn.query_row("SELECT ai FROM assets_fts WHERE asset_id = 1", [], |r| r.get(0)).unwrap();
    assert!(ai1.contains("cami") && ai1.contains("bulut"), "analizli asset backfill edildi: {ai1:?}");
    // Ana kutu MATCH artik bu asset'i bulur.
    let hits: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'cami bulut'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hits, 1, "backfill sonrasi ana kutu ai betimini bulur");

    // Analizsiz asset ai bos (backfill yalniz ai_analyzed'lari kapsar).
    let ai2: String =
        conn.query_row("SELECT ai FROM assets_fts WHERE asset_id = 2", [], |r| r.get(0)).unwrap();
    assert_eq!(ai2, "", "analizsiz asset backfill DISI");
}

/// 512-boyutlu birim vektor JSON gosterimi (gorsel/CLIP; `asset_image_region_vectors FLOAT[512]`).
fn img_unit_vec(hot: usize) -> String {
    let mut parts = vec!["0"; 512];
    parts[hot] = "1";
    format!("[{}]", parts.join(","))
}

#[test]
fn migration_0022_moves_image_vectors_to_region0() {
    // 0022: `asset_image_vectors` (tek-vektor) → `asset_image_region_vectors` (cok-bolge, PK-kodlama).
    // NON-DESTRUCTIVE: mevcut satirlar region 0'a (id = asset_id*8 + 0) tasinir; eski tablo dusurulur.
    // Pre-0022 durumu simule et: 1..=21 elle uygula + user_version=21; sonra run YALNIZ v22'yi uygular.
    let mut conn = connection::open_in_memory().unwrap();
    for m in migrations::MIGRATIONS.iter().filter(|m| m.version <= 21) {
        conn.execute_batch(m.sql).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 21;").unwrap();

    // Asset + eski tek-satir gorsel vektor (region kavrami oncesi; 0010 semasi).
    conn.execute(
        "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
         VALUES (5, '/a/img.jpg', 'img.jpg', 'jpg', 10, 1, 1)",
        [],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO asset_image_vectors(asset_id, embedding) VALUES (5, ?1)",
        params![img_unit_vec(3)],
    )
    .unwrap();

    // v22+ uygula (v22 region tasimasi hedefi; sonraki bekleyenler de kosar). Test v22'ye odakli
    // → ilk uygulananin v22 oldugunu dogrula (yeni migration eklendikce kirilmayan iddia).
    let report = migrations::run(&mut conn).unwrap();
    assert_eq!(report.applied.first(), Some(&22), "v21 sonrasi ilk bekleyen v22 (region tasimasi)");

    // Yeni region tablosu var; eski tek-vektor tablosu DUSURULDU.
    let has_new: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='asset_image_region_vectors'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(has_new, 1, "region tablosu olusmali");
    let has_old: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name='asset_image_vectors'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(has_old, 0, "eski tek-vektor tablosu dusurulmeli");

    // Tek eski satir region 0'a (id = 5*8 + 0 = 40) tasindi; embedding KORUNDU (MATCH ~0 mesafe).
    let total: i64 = conn
        .query_row("SELECT count(*) FROM asset_image_region_vectors", [], |r| r.get(0))
        .unwrap();
    assert_eq!(total, 1, "tek satir tasindi (region 0)");
    let moved_id: i64 = conn
        .query_row(
            "SELECT id FROM asset_image_region_vectors
             WHERE embedding MATCH ?1 ORDER BY distance LIMIT 1",
            params![img_unit_vec(3)],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(moved_id, 5 * 8, "eski vektor region 0 (id = asset_id*8) olarak, embedding intact");
}

#[test]
fn chat_tables_present_v23() {
    // v23 (chat_sessions): kalici sohbet — chat_sessions + chat_messages tablolari + indeksler
    // + FK CASCADE. Non-destructive (yalniz yeni tablo ekler). Ayrintili CRUD/CASCADE: tests/chat.rs.
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert!(version >= 23, "chat_sessions (v23) uygulanmadi: user_version={version}");

    // Iki tablo + uc indeks var.
    for obj in [
        "chat_sessions",
        "chat_messages",
        "idx_chat_sessions_updated",
        "idx_chat_messages_session",
        "idx_chat_messages_created",
    ] {
        let n: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", [obj], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "v23 sema nesnesi yok: {obj}");
    }

    // chat_messages.session_id → chat_sessions(id) FK CASCADE bildirimli (pragma foreign_keys ON
    // ile calisir). Standart `PRAGMA foreign_key_list` (kolonlar: ..., table=2, on_delete=6).
    let on_delete: String = {
        let mut stmt = conn.prepare("PRAGMA foreign_key_list(chat_messages)").unwrap();
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(2)?, r.get::<_, String>(6)?)))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        rows.into_iter()
            .find(|(t, _)| t == "chat_sessions")
            .map(|(_, d)| d)
            .expect("chat_messages → chat_sessions FK bildirimi olmali")
    };
    assert_eq!(on_delete, "CASCADE", "chat_messages FK ON DELETE CASCADE olmali");
}

#[test]
fn chat_soft_delete_column_present_v24() {
    // v24 (chat_soft_delete): chat_sessions.deleted_at kolonu (NULL=aktif, epoch ms=cop) +
    // idx_chat_sessions_deleted. Non-destructive ALTER (0023 tablosuna tek kolon). Ayrintili
    // soft-delete/restore/purge davranisi: tests/chat.rs.
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert!(version >= 24, "chat_soft_delete (v24) uygulanmadi: user_version={version}");

    // deleted_at kolonu chat_sessions'ta var.
    let has_col = {
        let mut stmt = conn.prepare("PRAGMA table_info(chat_sessions)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
            .iter()
            .any(|c| c == "deleted_at")
    };
    assert!(has_col, "chat_sessions.deleted_at kolonu yok");

    // Cop indeksi olustu.
    let idx: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_chat_sessions_deleted'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(idx, 1, "idx_chat_sessions_deleted indeksi yok");
}

#[test]
fn local_archives_table_present_v29() {
    // v29 (local_archives): adlandirilmis eszamanli yerel arsiv registry'si + aktif-ad partial
    // unique index. Ayrintili CRUD davranisi: src/local_archives.rs birim testleri.
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert!(version >= 29, "local_archives (v29) uygulanmadi: user_version={version}");

    // Tablo + beklenen kolonlar.
    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(local_archives)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    for want in ["id", "name", "color", "rel_path", "created_at", "deleted_at"] {
        assert!(cols.iter().any(|c| c == want), "local_archives.{want} kolonu yok: {cols:?}");
    }

    // Aktif-ad benzersizlik indeksi olustu.
    let idx: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_local_archives_active_name'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(idx, 1, "idx_local_archives_active_name indeksi yok");

    // 'main' id'si registry'ye yazilamaz (CHECK id <> 'main').
    let reserved = conn.execute(
        "INSERT INTO local_archives(id, name, rel_path, created_at) VALUES ('main','X','p',1)",
        [],
    );
    assert!(reserved.is_err(), "'main' rezerve id registry'ye yazilmamali");
}

#[test]
fn approval_log_table_present_v30() {
    // v30 (approval_log): onay durumu gecis gecmisi + asset/zaman indeksleri. Davranis testleri:
    // src/approval_log.rs birim testleri.
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
    assert!(version >= 30, "approval_log (v30) uygulanmadi: user_version={version}");

    let cols: Vec<String> = {
        let mut stmt = conn.prepare("PRAGMA table_info(approval_log)").unwrap();
        stmt.query_map([], |r| r.get::<_, String>(1))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    for want in ["id", "asset_id", "from_status", "to_status", "reason", "changed_by", "changed_at"] {
        assert!(cols.iter().any(|c| c == want), "approval_log.{want} kolonu yok: {cols:?}");
    }
    let idx: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='index'
             AND name IN ('idx_approval_log_asset','idx_approval_log_time')",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(idx, 2, "approval_log indeksleri (asset + time) yok");
}

#[test]
fn fts5_indexes_via_trigger() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    conn.execute(
        "INSERT INTO assets(path, file_name, ext, size_bytes, title, created_at, modified_at)
         VALUES ('/arsiv/villa_plan.dwg', 'villa_plan.dwg', 'dwg', 2048, 'Villa Plani', 100, 100)",
        [],
    )
    .unwrap();

    // AFTER INSERT trigger FTS'i doldurmali.
    let hits: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'villa'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(hits, 1, "FTS5 trigger ile indekslenmedi");

    // Silme trigger'i FTS satirini de temizlemeli.
    conn.execute("DELETE FROM assets WHERE file_name = 'villa_plan.dwg'", [])
        .unwrap();
    let after: i64 = conn
        .query_row("SELECT count(*) FROM assets_fts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(after, 0, "DELETE trigger FTS satirini temizlemedi");
}

#[test]
fn sqlite_vec_knn_in_db() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    for (id, hot) in [(1_i64, 0_usize), (2, 1), (3, 2)] {
        conn.execute(
            "INSERT INTO asset_vectors(asset_id, embedding) VALUES (?1, ?2)",
            params![id, unit_vec(hot)],
        )
        .unwrap();
    }

    // 0. boyuta hizalanmis sorgu → en yakin komsu asset_id = 1.
    let nearest: i64 = conn
        .query_row(
            "SELECT asset_id FROM asset_vectors
             WHERE embedding MATCH ?1 ORDER BY distance LIMIT 1",
            params![unit_vec(0)],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(nearest, 1, "DB-ici vektor kNN beklenen komsuyu dondurmedi");
}

#[test]
fn vector_shares_asset_transaction() {
    // Tek motor + DB-ici vektor: asset ve embedding ayni TX'te → ya ikisi de
    // yazilir ya hicbiri (yetim chunk dogmaz). Rollback ikisini de geri almali.
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();

    let tx = conn.transaction().unwrap();
    tx.execute(
        "INSERT INTO assets(id, path, file_name, size_bytes, created_at, modified_at)
         VALUES (7, '/a/x.skp', 'x.skp', 10, 1, 1)",
        [],
    )
    .unwrap();
    tx.execute(
        "INSERT INTO asset_vectors(asset_id, embedding) VALUES (7, ?1)",
        params![unit_vec(5)],
    )
    .unwrap();
    drop(tx); // commit edilmedi → rollback

    let assets: i64 = conn
        .query_row("SELECT count(*) FROM assets", [], |r| r.get(0))
        .unwrap();
    let vecs: i64 = conn
        .query_row("SELECT count(*) FROM asset_vectors", [], |r| r.get(0))
        .unwrap();
    assert_eq!(assets, 0);
    assert_eq!(vecs, 0);
}

#[test]
fn integrity_and_orphans_clean_on_fresh_db() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    assert!(health::integrity_ok(&conn).unwrap());
    assert_eq!(health::orphan_count(&conn).unwrap(), 0);
}

#[test]
fn db_handle_high_level_api() {
    // Kabuk/IPC katmaninin gordugu opak API: rusqlite sizmadan saglik sorgulari.
    let db = archivist_db::Db::open_in_memory_migrated().unwrap();
    assert_eq!(db.schema_version().unwrap(), migrations::MIGRATIONS.last().unwrap().version);
    assert!(db.integrity_ok().unwrap());
    assert_eq!(db.asset_count().unwrap(), 0);
    assert_eq!(db.orphan_count().unwrap(), 0);
}

/// **0031 (chat_session_owner) — geriye-donuk dolgu.** v30'da olusmus (sahipsiz) sohbet
/// oturumlari, migration sonrasi ana admin'e (founder) atanmali. Dolgu "tahmin" degil: bu
/// migration'dan ONCE sohbet arsiv-geneliydi ve arsivin sahibi founder'dir.
///
/// Kurulum 0027/0028 testlerinin deseniyle ayni: <=30 elle uygulanir, user_version 30'a
/// sabitlenir, ESKI veri yazilir, sonra `run()` cagrilir.
#[test]
fn migration_0031_backfills_existing_sessions_to_founder() {
    let mut conn = connection::open_in_memory().unwrap();
    for m in migrations::MIGRATIONS.iter().filter(|m| m.version <= 30) {
        conn.execute_batch(m.sql).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 30;").unwrap();

    // Iki kullanici: founder DEGIL olan once yazilir → dolgunun "en dusuk id" degil
    // "is_founder=1" secmesi kelepcelenir (yanlis sahip atamasi sessizce gecmesin).
    conn.execute(
        "INSERT INTO users(id, username, role, password_hash, is_founder)
         VALUES (1, 'eski', 'editor', 'x', 0), (2, 'patron', 'admin', 'x', 1)",
        [],
    )
    .unwrap();
    // v30 semasinda user_id kolonu YOK → sahipsiz oturum (gercek eski veri sekli).
    conn.execute(
        "INSERT INTO chat_sessions(id, title, created_at, updated_at, source)
         VALUES ('cs_eski', 'eski sohbet', 1, 1, 'local')",
        [],
    )
    .unwrap();

    let report = migrations::run(&mut conn).unwrap();
    assert!(report.applied.contains(&31), "0031 uygulanmali: {:?}", report.applied);

    let owner: Option<i64> = conn
        .query_row("SELECT user_id FROM chat_sessions WHERE id = 'cs_eski'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(owner, Some(2), "mevcut oturum FOUNDER'a (id=2) atanmali, en eski kullaniciya degil");
}

/// Hicbir kullanici yokken dolgu NULL birakir (taze/test DB) — ve sahipsiz satir hicbir
/// listeye dusmez. Sizinti yonu guvenli: fazladan gizler, fazladan GOSTERMEZ.
#[test]
fn migration_0031_leaves_null_when_no_users_exist() {
    let mut conn = connection::open_in_memory().unwrap();
    for m in migrations::MIGRATIONS.iter().filter(|m| m.version <= 30) {
        conn.execute_batch(m.sql).unwrap();
    }
    conn.execute_batch("PRAGMA user_version = 30;").unwrap();
    conn.execute(
        "INSERT INTO chat_sessions(id, title, created_at, updated_at, source)
         VALUES ('cs_sahipsiz', 'sahipsiz', 1, 1, 'local')",
        [],
    )
    .unwrap();

    migrations::run(&mut conn).unwrap();

    let owner: Option<i64> = conn
        .query_row("SELECT user_id FROM chat_sessions WHERE id = 'cs_sahipsiz'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(owner, None, "kullanici yoksa sahip NULL kalmali");
}

/// 0032 testlerinin ortak kurulumu: migrated DB + tek asset + FTS satirina NOBETCI.
/// Nobetci gozlemlenebilirlik hilesidir: `assets_fts.title`'a dogrudan yazilir — trigger
/// ateslenirse deger `assets.title`'dan yeniden senkronlanip nobetci SILINIR. Boylece
/// "trigger atesledi mi?" sorusu SELECT ile olculur (tahmin degil).
fn setup_0032(conn: &rusqlite::Connection) {
    conn.execute(
        "INSERT INTO assets(id, path, file_name, ext, size_bytes, title, created_at, modified_at)
         VALUES (1, '/a/plan.dwg', 'plan.dwg', 'dwg', 10, 'Vaziyet Plani', 1, 1)",
        [],
    )
    .unwrap();
    conn.execute("UPDATE assets_fts SET title = 'SENTINEL' WHERE asset_id = 1", []).unwrap();
}

fn fts_title(conn: &rusqlite::Connection) -> String {
    conn.query_row("SELECT title FROM assets_fts WHERE asset_id = 1", [], |r| r.get(0)).unwrap()
}

/// **0032 (assets_fts_au_scoped) — FTS-disi kolon guncellemesi trigger'i ATESLEMEMELI.**
/// Uretim vakasi (2026-08-12): oto proje atamasi 33 bin `SET project_id` ile ~6 dk surdu;
/// her UPDATE, FTS'te olmayan bir kolon icin tam FTS satir yenilemesi (body+ai dahil yeniden
/// tokenizasyon) tetikliyordu. Eski (0021) trigger'la bu test KIRILIR (yanlislanabilirlik).
#[test]
fn migration_0032_non_fts_updates_leave_fts_untouched() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    setup_0032(&conn);
    conn.execute("INSERT INTO projects(name, created_at) VALUES ('Villa-A', 1)", []).unwrap();

    // Gercek vaka: oto proje atamasi. Ardindan diger FTS-disi yollar: cop isareti + RAG bayragi
    // + geri-alma (trash restore deseni).
    conn.execute("UPDATE assets SET project_id = 1 WHERE id = 1", []).unwrap();
    conn.execute("UPDATE assets SET deleted_at = 99 WHERE id = 1", []).unwrap();
    conn.execute("UPDATE assets SET deleted_at = NULL, rag_excluded = 1 WHERE id = 1", []).unwrap();

    assert_eq!(fts_title(&conn), "SENTINEL", "FTS-disi kolon guncellemesi FTS satirina DOKUNMAMALI");
}

/// 0032 sonrasi FTS senkronu BOZULMAMALI: uc aynali kolonun gercek degisimi FTS'e yansir
/// (refile file_name senkronu dahil) ve yeni deger aranabilir kalir.
#[test]
fn migration_0032_fts_columns_still_sync() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    setup_0032(&conn);

    // title degisimi → nobetci ezilir, yeni deger kolon-filtreli MATCH ile bulunur.
    conn.execute("UPDATE assets SET title = 'Kesit Cizimi' WHERE id = 1", []).unwrap();
    assert_eq!(fts_title(&conn), "Kesit Cizimi", "title degisimi FTS'e senkronlanmali");
    let hits: i64 = conn
        .query_row("SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'title:kesit'", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(hits, 1, "yeni title aranabilir olmali");

    // refile deseni: path + file_name birlikte degisir → file_name senkronlanir.
    conn.execute(
        "UPDATE assets SET path = '/b/kesit.dwg', file_name = 'kesit.dwg' WHERE id = 1",
        [],
    )
    .unwrap();
    let fname: String = conn
        .query_row("SELECT file_name FROM assets_fts WHERE asset_id = 1", [], |r| r.get(0))
        .unwrap();
    assert_eq!(fname, "kesit.dwg", "file_name degisimi (refile) FTS'e senkronlanmali");
}

/// 0032 WHEN muhafizi: aynali kolon AYNI degerle SET edilirse (re-ingest upsert'in olagan hali:
/// icerik degisti ama ad/baslik degismedi) trigger ateslenMEZ; NULL↔'' gecisi de degisiklik
/// SAYILMAZ (FTS NULL'u '' olarak depolar — COALESCE muhafizi bu kurala birebir uyar).
#[test]
fn migration_0032_same_value_and_null_empty_transitions_skip() {
    let mut conn = connection::open_in_memory().unwrap();
    migrations::run(&mut conn).unwrap();
    setup_0032(&conn);

    // Ayni degerle SET (SET listesi uc kolonu da icerir — OF tek basina ateslerdi).
    conn.execute(
        "UPDATE assets SET file_name = file_name, title = title, description = description
         WHERE id = 1",
        [],
    )
    .unwrap();
    assert_eq!(fts_title(&conn), "SENTINEL", "deger degismeden SET → trigger ateslenmemeli");

    // NULL → '' gecisi (description INSERT'te NULL idi; FTS zaten '' depoluyor).
    conn.execute("UPDATE assets SET description = '' WHERE id = 1", []).unwrap();
    assert_eq!(fts_title(&conn), "SENTINEL", "NULL↔'' gecisi degisiklik sayilmamali");
}
