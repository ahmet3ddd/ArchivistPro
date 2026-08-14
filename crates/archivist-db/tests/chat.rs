//! `chat` — Kalici cok-oturumlu sohbet (chat_sessions + chat_messages) entegrasyon testleri.
//!
//! EN riskli katman → **test-first** (data-migration kurali): bu testler koddan bagimsiz,
//! sema (0023) + CRUD + FK-CASCADE + updated_at-tazeleme + Option round-trip sozlesmesini
//! kelepceler. H2 chatStorage.ts semantigi birebir dogrulanir:
//!   createSession → listSessions(updated_at DESC) · appendMessage → listMessages(created_at ASC)
//!   · deleteSession(CASCADE) · renameSession(updated_at tazele → DESC sira degisir).
//!
//! **v31 SAHIPLIK:** sohbet artik kullanici-basi izole (`chat_sessions.user_id`). Her cagri sahibi
//! verir; baskasinin oturumu gorunmez/degistirilemez. Izolasyon testleri en altta (§v31) — o blok
//! 2026-07-26'da bulunan acigin regresyon kilidi: once sohbet arsiv-geneliydi ve viewer dahil her
//! rol baskasinin sohbetini gorup KALICI silebiliyordu.
//!
//! H3 DERSI: okuma+yazma AYNI sema-aware (list okur + append yazar; ayni epoch-ms sozlesmesi →
//! kismi-bozulma yok). FK CASCADE pragma ON ile yapisal (yetim mesaj imkansiz).

use archivist_db::Db;
use rusqlite::params;

/// Migrasyonlu bellek-ici DB + **tek test kullanicisi** → (db, user_id).
/// v31'den beri her oturumun bir sahibi olmali (sahipsiz satir hicbir listeye dusmez).
fn db_with_user() -> (Db, i64) {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let uid = db.create_user("tester", "admin", "pw-123456", false).unwrap();
    (db, uid)
}

/// Iki ayri kullanici → (db, a_id, b_id). Izolasyon testleri icin.
fn db_with_two_users() -> (Db, i64, i64) {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let a = db.create_user("ayse", "admin", "pw-123456", false).unwrap();
    let b = db.create_user("bora", "viewer", "pw-123456", false).unwrap();
    (db, a, b)
}

/// Bir oturumun su anki updated_at'i (tazeleme ispati).
fn updated_at(db: &Db, id: &str) -> i64 {
    db.connection()
        .query_row("SELECT updated_at FROM chat_sessions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

/// Bir oturumun updated_at'ini ELLE ayarla (deterministik siralama/tazeleme testi icin — API
/// zaman enjekte etmez; ham SQL ile bilinen degere sabitle).
fn force_updated_at(db: &Db, id: &str, value: i64) {
    db.connection()
        .execute("UPDATE chat_sessions SET updated_at = ?1 WHERE id = ?2", params![value, id])
        .unwrap();
}

/// Bir oturumun deleted_at'ini oku (soft-delete ispati; None = aktif, Some = cop'te).
fn deleted_at(db: &Db, id: &str) -> Option<i64> {
    db.connection()
        .query_row("SELECT deleted_at FROM chat_sessions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

/// Bir oturumun deleted_at'ini ELLE ayarla (deterministik idempotent/guard testi icin — API zaman
/// enjekte etmez; ham SQL ile bilinen degere sabitle, now_ms carpismasini eler).
fn force_deleted_at(db: &Db, id: &str, value: i64) {
    db.connection()
        .execute("UPDATE chat_sessions SET deleted_at = ?1 WHERE id = ?2", params![value, id])
        .unwrap();
}

/// Bir oturuma ait mesaj SATIR sayisi (CASCADE ispati). **Sahiplik suzgecinden gecmez** — ham
/// satir sayimi (izolasyon testlerinde "gercekten silindi mi / gercekten duruyor mu" icin sart).
fn message_rows(db: &Db, session_id: &str) -> i64 {
    db.connection()
        .query_row(
            "SELECT count(*) FROM chat_messages WHERE session_id = ?1",
            params![session_id],
            |r| r.get(0),
        )
        .unwrap()
}

/// Bir oturumun HAM satir sayisi (0 = yok). Sahiplikten bagimsiz.
fn session_rows(db: &Db, id: &str) -> i64 {
    db.connection()
        .query_row("SELECT count(*) FROM chat_sessions WHERE id = ?1", params![id], |r| r.get(0))
        .unwrap()
}

#[test]
fn migration_0023_creates_chat_tables_and_indexes() {
    // 0023 uygulandi: tablolar + indeksler var, user_version >= 23 (non-destructive).
    let db = Db::open_in_memory_migrated().unwrap();
    assert!(db.schema_version().unwrap() >= 23, "0023 uygulanmadi");
    let conn = db.connection();
    for obj in [
        "chat_sessions",
        "chat_messages",
        "idx_chat_sessions_updated",
        "idx_chat_messages_session",
        "idx_chat_messages_created",
    ] {
        let n: i64 = conn
            .query_row("SELECT count(*) FROM sqlite_master WHERE name = ?1", params![obj], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(n, 1, "beklenen sema nesnesi yok: {obj}");
    }
}

#[test]
fn empty_db_has_no_sessions_or_messages() {
    // Taze DB: oturum listesi bos; olmayan oturumun mesaj listesi bos.
    let (db, u) = db_with_user();
    assert!(db.list_chat_sessions(u, 0).unwrap().is_empty(), "taze DB'de oturum olmamali");
    assert!(
        db.list_chat_messages(u, "yok").unwrap().is_empty(),
        "olmayan oturumda mesaj olmamali"
    );
}

#[test]
fn create_then_list_desc_and_fields_round_trip() {
    // create A,B,C → listeleme son-eklenen ilk (updated_at DESC, esitte rowid DESC → C,B,A).
    let (db, u) = db_with_user();
    let a =
        db.create_chat_session(u, "A", Some(r#"{"type":"all"}"#), Some("llama3"), "local", None)
            .unwrap();
    let b = db.create_chat_session(u, "B", None, None, "local", None).unwrap();
    let c = db
        .create_chat_session(u, "C", Some(r#"{"type":"tag","value":"villa"}"#), None, "local", None)
        .unwrap();

    // Alanlar dondugu gibi (create donusu): created==updated, id 'cs_' onekli, sahip yazili.
    assert!(a.id.starts_with("cs_"), "session id 'cs_' onekli olmali: {}", a.id);
    assert_eq!(a.created_at, a.updated_at, "olusumda created==updated");
    assert_eq!(a.model.as_deref(), Some("llama3"));
    assert_eq!(a.user_id, Some(u), "create donusunde sahip yazili olmali");
    assert_eq!(b.scope_json, None);
    assert_eq!(b.model, None);

    let list = db.list_chat_sessions(u, 0).unwrap();
    let ids: Vec<&str> = list.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, vec![c.id.as_str(), b.id.as_str(), a.id.as_str()], "DESC (en yeni ilk)");

    // scope_json/model round-trip (Some ve None) listeden okundugunda korunur.
    let read_a = list.iter().find(|s| s.id == a.id).unwrap();
    assert_eq!(read_a.scope_json.as_deref(), Some(r#"{"type":"all"}"#));
    assert_eq!(read_a.title, "A");
    assert_eq!(read_a.user_id, Some(u), "listeden okurken de sahip korunur");
    let read_b = list.iter().find(|s| s.id == b.id).unwrap();
    assert_eq!(read_b.scope_json, None);
    assert_eq!(read_b.model, None);
}

#[test]
fn list_respects_limit() {
    // limit>0 → en yeni N; limit<=0 → 100 (varsayilan).
    let (db, u) = db_with_user();
    let _a = db.create_chat_session(u, "A", None, None, "local", None).unwrap();
    let b = db.create_chat_session(u, "B", None, None, "local", None).unwrap();
    let c = db.create_chat_session(u, "C", None, None, "local", None).unwrap();

    let two = db.list_chat_sessions(u, 2).unwrap();
    assert_eq!(two.len(), 2, "limit=2 → 2 satir");
    assert_eq!(
        two.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
        vec![c.id.clone(), b.id.clone()],
        "en yeni 2 (C,B)"
    );

    assert_eq!(db.list_chat_sessions(u, 0).unwrap().len(), 3, "limit=0 → varsayilan (hepsi)");
    assert_eq!(db.list_chat_sessions(u, -5).unwrap().len(), 3, "limit<0 → varsayilan");
}

#[test]
fn append_then_list_messages_asc_with_round_trip() {
    // append 3 mesaj → listeleme eskiden yeniye (created_at ASC, esitte rowid ASC → ekleme sirasi).
    let (mut db, u) = db_with_user();
    let s = db.create_chat_session(u, "S", None, None, "local", None).unwrap();

    let m1 = db.append_chat_message(u, &s.id, "user", "merhaba", None, None, None).unwrap();
    let m2 = db
        .append_chat_message(
            u,
            &s.id,
            "assistant",
            "selam",
            Some(r#"[{"index":1,"assetId":"a1"}]"#),
            Some(12),
            Some(34),
        )
        .unwrap();
    let m3 = db.append_chat_message(u, &s.id, "system", "not", None, Some(5), None).unwrap();

    assert!(m1.id.starts_with("cm_"), "message id 'cm_' onekli olmali: {}", m1.id);

    let msgs = db.list_chat_messages(u, &s.id).unwrap();
    assert_eq!(
        msgs.iter().map(|m| m.id.clone()).collect::<Vec<_>>(),
        vec![m1.id.clone(), m2.id.clone(), m3.id.clone()],
        "ASC (ekleme sirasi)"
    );

    // Round-trip: citations_json/tokens (Some ve None) korunur.
    let r2 = &msgs[1];
    assert_eq!(r2.role, "assistant");
    assert_eq!(r2.content, "selam");
    assert_eq!(r2.citations_json.as_deref(), Some(r#"[{"index":1,"assetId":"a1"}]"#));
    assert_eq!(r2.tokens_in, Some(12));
    assert_eq!(r2.tokens_out, Some(34));
    assert_eq!(r2.session_id, s.id);

    let r1 = &msgs[0];
    assert_eq!(r1.citations_json, None, "None citations round-trip");
    assert_eq!(r1.tokens_in, None);
    assert_eq!(r1.tokens_out, None);
    let r3 = &msgs[2];
    assert_eq!(r3.tokens_in, Some(5));
    assert_eq!(r3.tokens_out, None, "kismi token (yalniz in) None-out round-trip");
}

#[test]
fn append_refreshes_session_updated_at() {
    // append oturumun updated_at'ini tazeler (liste DESC'i etkiler). Deterministik: once eski
    // bir degere sabitle → append sonrasi gercek now_ms (cok daha buyuk) olmali.
    let (mut db, u) = db_with_user();
    let s = db.create_chat_session(u, "S", None, None, "local", None).unwrap();
    force_updated_at(&db, &s.id, 1000);
    assert_eq!(updated_at(&db, &s.id), 1000);

    db.append_chat_message(u, &s.id, "user", "x", None, None, None).unwrap();
    assert!(updated_at(&db, &s.id) > 1000, "append updated_at'i tazelemeli (gercek now_ms)");
    assert_eq!(message_rows(&db, &s.id), 1, "mesaj eklendi");
}

#[test]
fn delete_soft_hides_but_keeps_messages() {
    // v24 SOFT-DELETE: delete oturumu aktif listeden GIZLER ama satir + mesajlari KORUR (restore
    // tam geri getirebilsin). deleted_at epoch **ms** ile dolar (birim tuzagi: saniye DEGIL).
    let (mut db, u) = db_with_user();
    let s = db.create_chat_session(u, "S", None, None, "local", None).unwrap();
    db.append_chat_message(u, &s.id, "user", "a", None, None, None).unwrap();
    db.append_chat_message(u, &s.id, "assistant", "b", None, None, None).unwrap();
    assert_eq!(message_rows(&db, &s.id), 2);

    db.delete_chat_session(u, &s.id).unwrap();

    // Aktif listede YOK (deleted_at IS NULL filtresi gizler).
    assert!(
        db.list_chat_sessions(u, 0).unwrap().iter().all(|x| x.id != s.id),
        "soft-delete sonrasi oturum aktif listede olmamali"
    );
    // Satir DURUYOR + deleted_at epoch MS (> 1e12 → saniye degil ms; birim tuzagi kilidi).
    let del = deleted_at(&db, &s.id);
    assert!(
        del.is_some_and(|v| v > 1_000_000_000_000),
        "deleted_at epoch MS ile dolmali (saniye DEGIL): {del:?}"
    );
    // Mesajlar KORUNDU (soft-delete mesajlara DOKUNMAZ → restore tam getirir).
    assert_eq!(message_rows(&db, &s.id), 2, "soft-delete mesajlari KORUMALI");
}

#[test]
fn restore_brings_back() {
    // restore: deleted_at → NULL → aktif listede tekrar; mesajlar tam (hic kaybolmadi).
    let (mut db, u) = db_with_user();
    let s = db.create_chat_session(u, "S", None, None, "local", None).unwrap();
    db.append_chat_message(u, &s.id, "user", "merhaba", None, None, None).unwrap();
    db.delete_chat_session(u, &s.id).unwrap();
    assert!(db.list_chat_sessions(u, 0).unwrap().iter().all(|x| x.id != s.id), "once cop'te");

    db.restore_chat_session(u, &s.id).unwrap();

    let list = db.list_chat_sessions(u, 0).unwrap();
    let back = list.iter().find(|x| x.id == s.id).expect("restore sonrasi aktif listede olmali");
    assert_eq!(back.deleted_at, None, "restore deleted_at'i NULL yapmali");
    assert_eq!(deleted_at(&db, &s.id), None, "ham satirda da deleted_at NULL");
    // Mesajlar tam geri geldi.
    assert_eq!(message_rows(&db, &s.id), 1, "mesajlar restore sonrasi tam");
    assert_eq!(db.list_chat_messages(u, &s.id).unwrap().len(), 1);
    assert_eq!(db.chat_trash_count(u).unwrap(), 0, "restore sonrasi cop bos");
}

#[test]
fn list_trashed_returns_only_deleted_and_count() {
    // list_trashed + chat_trash_count: yalniz cop'tekiler (deleted_at DESC); aktif liste ayrilir.
    let (db, u) = db_with_user();
    let a =
        db.create_chat_session(u, "A", Some(r#"{"type":"all"}"#), Some("llama3"), "local", None)
            .unwrap();
    let b = db.create_chat_session(u, "B", None, None, "local", None).unwrap();
    let c = db.create_chat_session(u, "C", None, None, "local", None).unwrap();

    // Baslangicta cop bos.
    assert_eq!(db.chat_trash_count(u).unwrap(), 0);
    assert!(db.list_trashed_chat_sessions(u).unwrap().is_empty());

    db.delete_chat_session(u, &a.id).unwrap();
    db.delete_chat_session(u, &c.id).unwrap();

    // Cop yalniz a + c. Siralama deleted_at DESC, esitte rowid DESC → c (sonra olusan), sonra a.
    let trashed = db.list_trashed_chat_sessions(u).unwrap();
    let ids: Vec<&str> = trashed.iter().map(|s| s.id.as_str()).collect();
    assert_eq!(ids, vec![c.id.as_str(), a.id.as_str()], "cop deleted_at DESC (esitte rowid DESC)");
    assert_eq!(db.chat_trash_count(u).unwrap(), 2, "cop sayimi 2");

    // Cop satirlarinda deleted_at dolu + round-trip alanlar (scope/model) korunur.
    let ta = trashed.iter().find(|s| s.id == a.id).unwrap();
    assert!(ta.deleted_at.is_some(), "cop satirinda deleted_at dolu");
    assert_eq!(ta.scope_json.as_deref(), Some(r#"{"type":"all"}"#));
    assert_eq!(ta.model.as_deref(), Some("llama3"));

    // Aktif liste yalniz b (deleted_at IS NULL).
    let active = db.list_chat_sessions(u, 0).unwrap();
    assert_eq!(active.len(), 1, "aktif liste yalniz b");
    assert_eq!(active[0].id, b.id);
}

#[test]
fn purge_removes_session_and_cascades_messages() {
    // Yasam dongusu: soft-delete (mesajlar KORUNUR) → purge (gercek DELETE + FK CASCADE → mesajlar
    // gider, yetim YOK). CASCADE iddiasi (eski delete testinden) buraya tasindi.
    let (mut db, u) = db_with_user();
    let s = db.create_chat_session(u, "S", None, None, "local", None).unwrap();
    db.append_chat_message(u, &s.id, "user", "a", None, None, None).unwrap();
    db.append_chat_message(u, &s.id, "assistant", "b", None, None, None).unwrap();

    db.delete_chat_session(u, &s.id).unwrap();
    assert_eq!(message_rows(&db, &s.id), 2, "soft-delete mesajlari korur");

    db.purge_chat_session(u, &s.id).unwrap();

    // Oturum satiri gitti (ne aktif ne cop) + mesajlar CASCADE ile gitti (yetim yok).
    assert!(db.list_chat_sessions(u, 0).unwrap().is_empty(), "aktif liste bos");
    assert!(db.list_trashed_chat_sessions(u).unwrap().is_empty(), "cop bos (purge satiri sildi)");
    assert_eq!(db.chat_trash_count(u).unwrap(), 0);
    assert_eq!(message_rows(&db, &s.id), 0, "CASCADE mesajlari silmeli");
    let total_msgs: i64 =
        db.connection().query_row("SELECT count(*) FROM chat_messages", [], |r| r.get(0)).unwrap();
    assert_eq!(total_msgs, 0, "hicbir yetim mesaj kalmamali");
    assert_eq!(session_rows(&db, &s.id), 0, "purge oturum satirini silmeli");
}

#[test]
fn soft_delete_idempotent() {
    // 2. soft-delete deleted_at'i DEGISTIRMEZ (WHERE deleted_at IS NULL guard → 0 satir). Deterministik
    // ispat: 1. delete sonrasi deleted_at'i bilinen kucuk degere sabitle; 2. delete now_ms (cok buyuk)
    // ile USTUNE YAZMAMALI.
    let (db, u) = db_with_user();
    let s = db.create_chat_session(u, "S", None, None, "local", None).unwrap();
    db.delete_chat_session(u, &s.id).unwrap();
    assert!(deleted_at(&db, &s.id).is_some(), "ilk delete cop'e atmali");

    force_deleted_at(&db, &s.id, 1000);
    db.delete_chat_session(u, &s.id).unwrap();
    assert_eq!(deleted_at(&db, &s.id), Some(1000), "2. soft-delete idempotent (deleted_at sabit)");
    assert_eq!(db.chat_trash_count(u).unwrap(), 1, "tek cop satiri kalmali");
}

#[test]
fn append_and_rename_noop_on_deleted_session() {
    // GUARD kilidi: cop'teki oturuma append/rename → "hayalet aktivite" engellenir (tam no-op).
    let (mut db, u) = db_with_user();
    let s = db.create_chat_session(u, "S", None, None, "local", None).unwrap();
    db.append_chat_message(u, &s.id, "user", "ilk", None, None, None).unwrap();
    db.delete_chat_session(u, &s.id).unwrap();
    force_deleted_at(&db, &s.id, 1000); // deterministik: tazeleme olsaydi deleted_at/updated_at degisirdi
    let updated_before = updated_at(&db, &s.id);

    // append → reddedilir + mesaj EKLENMEZ + updated_at tazelenmez.
    let res = db.append_chat_message(u, &s.id, "user", "hayalet", None, None, None);
    assert!(res.is_err(), "silinmis oturuma append reddedilmeli");
    assert_eq!(message_rows(&db, &s.id), 1, "silinmis oturuma mesaj eklenmemeli");
    assert_eq!(updated_at(&db, &s.id), updated_before, "append updated_at'i tazelememeli");

    // rename → no-op: baslik DEGISMEZ (guard AND deleted_at IS NULL → 0 satir).
    db.rename_chat_session(u, &s.id, "yeni-ad").unwrap();
    let title: String = db
        .connection()
        .query_row("SELECT title FROM chat_sessions WHERE id = ?1", params![s.id], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "S", "silinmis oturum yeniden adlandirilmamali");
    // Guard'lar deleted_at'e dokunmadi (hala 1000) → cop'te kaldi.
    assert_eq!(deleted_at(&db, &s.id), Some(1000), "guard'lar deleted_at'e dokunmamali");
    assert_eq!(db.chat_trash_count(u).unwrap(), 1);
}

#[test]
fn migration_0024_adds_deleted_at_column() {
    // v24 (chat_soft_delete): chat_sessions.deleted_at kolonu + idx_chat_sessions_deleted; sema >= 24.
    let (db, u) = db_with_user();
    assert!(db.schema_version().unwrap() >= 24, "0024 uygulanmadi");
    let conn = db.connection();

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

    // Taze sema: hicbir oturum yok → cop de bos.
    assert_eq!(db.chat_trash_count(u).unwrap(), 0);
}

#[test]
fn delete_missing_session_is_noop() {
    let (db, u) = db_with_user();
    // Yok-olan id → hata degil, no-op.
    db.delete_chat_session(u, "cs_yok").unwrap();
}

#[test]
fn append_to_missing_session_is_rejected() {
    // Var-olmayan session_id → mesaj YAZILMAZ. v31'e kadar bunu FK ihlali saglardi; artik
    // sahiplik on-kontrolu daha erken reddeder (ayni sonuc: yetim mesaj imkansiz). Hata metni
    // yabanci-oturum halindekiyle AYNI → id'nin var olup olmadigi sizmaz.
    let (mut db, u) = db_with_user();
    let err = db.append_chat_message(u, "cs_yok", "user", "x", None, None, None);
    assert!(err.is_err(), "var-olmayan oturuma mesaj reddedilmeli");
    let total: i64 =
        db.connection().query_row("SELECT count(*) FROM chat_messages", [], |r| r.get(0)).unwrap();
    assert_eq!(total, 0, "basarisiz append satir birakmamali");
}

#[test]
fn rename_refreshes_updated_at_and_reorders() {
    // rename basligi degistirir + updated_at tazeler → liste DESC sirasi degisir.
    let (db, u) = db_with_user();
    let a = db.create_chat_session(u, "A", None, None, "local", None).unwrap();
    let b = db.create_chat_session(u, "B", None, None, "local", None).unwrap();
    // Deterministik baslangic: A=1000, B=2000 → liste [B, A].
    force_updated_at(&db, &a.id, 1000);
    force_updated_at(&db, &b.id, 2000);
    let before: Vec<String> =
        db.list_chat_sessions(u, 0).unwrap().into_iter().map(|s| s.id).collect();
    assert_eq!(before, vec![b.id.clone(), a.id.clone()], "baslangic [B, A]");

    // A'yi yeniden adlandir → A.updated_at = gercek now_ms (>> 2000) → A one gelir.
    db.rename_chat_session(u, &a.id, "A-yeni").unwrap();
    assert!(updated_at(&db, &a.id) > 2000, "rename updated_at'i tazelemeli");

    let after = db.list_chat_sessions(u, 0).unwrap();
    assert_eq!(after[0].id, a.id, "rename sonrasi A liste basina gelmeli");
    assert_eq!(after[0].title, "A-yeni", "baslik guncellendi");
    assert_eq!(after[1].id, b.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// v26 — ARSIV KAYNAGI etiketi (source + host_label).
//
// Neden test'li: atiflar asset **id**'sidir ve id uzayi kaynaga gore degisir. Etiket kaybolur
// ya da yanlis yazilirsa, uzak sohbetin atifi yerel modda BASKA dosyayi acar (sessizce) —
// projenin Faz 2'de kapattigi "yanlis dosya" sinifi. Sema + round-trip burada kelepcelenir.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn migration_0026_adds_source_columns_and_index() {
    let db = Db::open_in_memory_migrated().unwrap();
    assert!(db.schema_version().unwrap() >= 26, "0026 uygulanmadi");
    let conn = db.connection();

    // Iki yeni kolon var mi (PRAGMA table_info).
    let cols: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('chat_sessions')")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(cols.iter().any(|c| c == "source"), "source kolonu yok: {cols:?}");
    assert!(cols.iter().any(|c| c == "host_label"), "host_label kolonu yok: {cols:?}");

    let n: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'idx_chat_sessions_source'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "kaynak indeksi olusmadi");
}

#[test]
fn source_and_host_label_round_trip() {
    // Yerel oturum: source='local', host_label=None. Uzak: source='remote' + etiket korunur.
    let (db, u) = db_with_user();
    let yerel = db.create_chat_session(u, "Yerel", None, None, "local", None).unwrap();
    let uzak = db
        .create_chat_session(u, "Uzak", None, Some("llama3"), "remote", Some("192.168.1.5:9471"))
        .unwrap();

    assert_eq!(yerel.source, "local");
    assert_eq!(yerel.host_label, None);
    assert_eq!(uzak.source, "remote");
    assert_eq!(uzak.host_label.as_deref(), Some("192.168.1.5:9471"));

    // Listeden okundugunda da korunur (map_session sutun sirasi kilidi).
    let list = db.list_chat_sessions(u, 0).unwrap();
    let r_uzak = list.iter().find(|s| s.id == uzak.id).unwrap();
    assert_eq!(r_uzak.source, "remote");
    assert_eq!(r_uzak.host_label.as_deref(), Some("192.168.1.5:9471"));
    let r_yerel = list.iter().find(|s| s.id == yerel.id).unwrap();
    assert_eq!(r_yerel.source, "local");
    assert_eq!(r_yerel.host_label, None);
}

#[test]
fn trashed_list_keeps_source_fields() {
    // Cop listesi de ayni sutun setini doner (iki SELECT arasinda kayma olmamali).
    let (db, u) = db_with_user();
    let uzak = db
        .create_chat_session(u, "Uzak", None, None, "remote", Some("10.0.0.2:9471"))
        .unwrap();
    db.delete_chat_session(u, &uzak.id).unwrap();

    let trashed = db.list_trashed_chat_sessions(u).unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].source, "remote");
    assert_eq!(trashed[0].host_label.as_deref(), Some("10.0.0.2:9471"));
}

// ─────────────────────────────────────────────────────────────────────────────
// §v31 — SAHIPLIK / KULLANICI-BASI IZOLASYON.
//
// 2026-07-26 bulgusunun regresyon kilidi: sohbet "kisisel ozellik" diye RBAC'siz birakilmisti ama
// sema sahip tasimiyordu → cok-kullanicili arsivde herkes herkesin sohbetini gorur, yeniden
// adlandirir, cope atar ve KALICI silerdi. Asagidaki testler her ucunu de kapatir.
//
// Davranis sozlesmesi: baskasinin oturumu **yok gibi** davranir (no-op / bos sonuc) — "yetkin yok"
// demek o id'nin VAR oldugunu sizdirirdi. Tek istisna append (sessiz no-op mesaji kaybederdi) →
// hata doner, ama metin eksik-id ile ayni.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn migration_0031_adds_user_id_column_and_index() {
    let db = Db::open_in_memory_migrated().unwrap();
    assert!(db.schema_version().unwrap() >= 31, "0031 uygulanmadi");
    let conn = db.connection();

    let cols: Vec<String> = conn
        .prepare("SELECT name FROM pragma_table_info('chat_sessions')")
        .unwrap()
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(cols.iter().any(|c| c == "user_id"), "user_id kolonu yok: {cols:?}");

    let n: i64 = conn
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE name = 'idx_chat_sessions_user'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(n, 1, "sahip indeksi olusmadi");
}

#[test]
fn sessions_are_isolated_per_user() {
    // A'nin oturumu B'nin listesinde YOK ve tersi. Liste + cop listesi + cop sayimi.
    let (db, a, b) = db_with_two_users();
    let sa = db.create_chat_session(a, "A-oturum", None, None, "local", None).unwrap();
    let sb = db.create_chat_session(b, "B-oturum", None, None, "local", None).unwrap();

    let list_a = db.list_chat_sessions(a, 0).unwrap();
    assert_eq!(list_a.len(), 1, "A yalniz kendi oturumunu gormeli");
    assert_eq!(list_a[0].id, sa.id);

    let list_b = db.list_chat_sessions(b, 0).unwrap();
    assert_eq!(list_b.len(), 1, "B yalniz kendi oturumunu gormeli");
    assert_eq!(list_b[0].id, sb.id);

    // Cop de izole: A kendi oturumunu cope atinca B'nin cop sayimi degismez.
    db.delete_chat_session(a, &sa.id).unwrap();
    assert_eq!(db.chat_trash_count(a).unwrap(), 1, "A'nin cop'unde 1");
    assert_eq!(db.chat_trash_count(b).unwrap(), 0, "B'nin cop'u ETKILENMEMELI");
    assert!(db.list_trashed_chat_sessions(b).unwrap().is_empty(), "B baskasinin cop'unu gormez");
}

#[test]
fn foreign_session_cannot_be_read() {
    // B, A'nin oturumunun mesajlarini OKUYAMAZ (bos liste — "yok" ile ayni).
    let (mut db, a, b) = db_with_two_users();
    let sa = db.create_chat_session(a, "gizli", None, None, "local", None).unwrap();
    db.append_chat_message(a, &sa.id, "user", "gizli soru", None, None, None).unwrap();

    assert_eq!(db.list_chat_messages(a, &sa.id).unwrap().len(), 1, "sahibi okuyabilir");
    assert!(
        db.list_chat_messages(b, &sa.id).unwrap().is_empty(),
        "B baskasinin mesajlarini OKUYAMAMALI"
    );
    // Ham satir hala duruyor → bos liste "silindi" degil, "gorunmuyor" demek.
    assert_eq!(message_rows(&db, &sa.id), 1);
}

#[test]
fn foreign_session_cannot_be_written() {
    // B, A'nin oturumuna mesaj EKLEYEMEZ. Kritik: FK yalniz "satir var mi" bakar → sahiplik
    // suzgeci olmasaydi bu INSERT BASARILI olurdu.
    let (mut db, a, b) = db_with_two_users();
    let sa = db.create_chat_session(a, "A-oturum", None, None, "local", None).unwrap();

    let res = db.append_chat_message(b, &sa.id, "user", "sizinti", None, None, None);
    assert!(res.is_err(), "B baskasinin oturumuna mesaj EKLEYEMEMELI");
    assert_eq!(message_rows(&db, &sa.id), 0, "yabanci append satir birakmamali");

    // Hata metni eksik-id ile AYNI SEKILDE olmali (varlik sizmaz). Metin cagiranin KENDI verdigi
    // id'yi yankilar — o zaten bilinen bilgi; sizinti olur mu diye bakilan sey mesajin AYRIMI:
    // "yok" ile "senin degil" ayirt edilememeli.
    let foreign_msg = format!("{}", res.unwrap_err());
    let missing_msg = format!(
        "{}",
        db.append_chat_message(b, "cs_yok", "user", "x", None, None, None).unwrap_err()
    );
    let strip = |m: String, id: &str| m.replace(id, "<id>");
    assert_eq!(
        strip(foreign_msg, &sa.id),
        strip(missing_msg, "cs_yok"),
        "yabanci-id ve eksik-id AYNI sekilde hata vermeli (yetki/varlik ayrimi sizmasin)"
    );
}

#[test]
fn foreign_session_cannot_be_renamed_or_deleted_or_purged() {
    // B, A'nin oturumunu yeniden adlandiramaz / cope atamaz / KALICI silemez. Ucu de no-op.
    let (mut db, a, b) = db_with_two_users();
    let sa = db.create_chat_session(a, "A-oturum", None, None, "local", None).unwrap();
    db.append_chat_message(a, &sa.id, "user", "veri", None, None, None).unwrap();

    // rename → baslik degismez.
    db.rename_chat_session(b, &sa.id, "ele-gecirildi").unwrap();
    let title: String = db
        .connection()
        .query_row("SELECT title FROM chat_sessions WHERE id = ?1", params![sa.id], |r| r.get(0))
        .unwrap();
    assert_eq!(title, "A-oturum", "B baskasinin oturumunu yeniden adlandiramaz");

    // delete → cop'e atilmaz (A'nin aktif listesinde kalir).
    db.delete_chat_session(b, &sa.id).unwrap();
    assert_eq!(deleted_at(&db, &sa.id), None, "B baskasinin oturumunu cope atamaz");
    assert_eq!(db.list_chat_sessions(a, 0).unwrap().len(), 1, "A'nin oturumu aktif kalmali");

    // purge → satir DURMALI (en yikici yol; eskiden mumkundu).
    db.purge_chat_session(b, &sa.id).unwrap();
    assert_eq!(session_rows(&db, &sa.id), 1, "B baskasinin oturumunu KALICI silememeli");
    assert_eq!(message_rows(&db, &sa.id), 1, "mesajlar da durmali");

    // restore de yabanciya kapali: once A cope atar, B geri yukleyemez.
    db.delete_chat_session(a, &sa.id).unwrap();
    db.restore_chat_session(b, &sa.id).unwrap();
    assert!(deleted_at(&db, &sa.id).is_some(), "B baskasinin oturumunu cop'ten cikaramaz");
    // Sahibi yapinca calisir (kontrol grubu — no-op'lar "her sey bozuk" yuzunden degil).
    db.restore_chat_session(a, &sa.id).unwrap();
    assert_eq!(deleted_at(&db, &sa.id), None, "sahibi geri yukleyebilmeli");
}

#[test]
fn deleting_user_cascades_their_sessions() {
    // ON DELETE CASCADE (0031 karari): kullanici silinince kisisel sohbetleri de gider —
    // kimsenin goremedigi oksuz satir birakilmaz. B'nin verisi ETKILENMEZ.
    let (mut db, a, b) = db_with_two_users();
    let sa = db.create_chat_session(a, "A-oturum", None, None, "local", None).unwrap();
    db.append_chat_message(a, &sa.id, "user", "veri", None, None, None).unwrap();
    let sb = db.create_chat_session(b, "B-oturum", None, None, "local", None).unwrap();
    db.append_chat_message(b, &sb.id, "user", "veri", None, None, None).unwrap();

    db.connection().execute("DELETE FROM users WHERE id = ?1", params![a]).unwrap();

    assert_eq!(session_rows(&db, &sa.id), 0, "silinen kullanicinin oturumu CASCADE ile gitmeli");
    assert_eq!(message_rows(&db, &sa.id), 0, "mesajlari da (oturum CASCADE) gitmeli");
    assert_eq!(session_rows(&db, &sb.id), 1, "B'nin oturumu ETKILENMEMELI");
    assert_eq!(db.list_chat_sessions(b, 0).unwrap().len(), 1, "B listesi saglam");
}

// ─────────────────────────────────────────────────────────────────────────────
// §EK-ARSIV FK CAPASI (saha bulgusu 2026-08-13): ek arsivin users tablosu BOS
// (kimlik ana arsivde merkezi) → 0031 FK'si oturum olusturmayi dusuruyordu ve
// frontend hatayi yutunca "sohbet kaydedilmiyor" gorunuyordu.
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn create_session_without_user_row_fails_fk() {
    // KOK NEDEN kilidi: users BOS (ek arsiv esdegeri) → FK ihlali. Bu test capanin
    // NEDEN gerekli oldugunu kelepceler; gecmezse ya FK dusmus ya pragma kapanmistir
    // (ikisi de v31 sahiplik guvencesini deler).
    let db = Db::open_in_memory_migrated().unwrap();
    assert!(
        db.create_chat_session(1, "sahipsiz", None, None, "local", None).is_err(),
        "bos users tablosuyla olusturma FK ihlaliyle DUSMELI (capa bunun icin var)"
    );
}

#[test]
fn owner_anchor_enables_sessions_in_content_only_archive() {
    // Ek arsiv senaryosu: users BOS + ana-arsiv kullanicisi 7 → capa sonrasi olusturma,
    // listeleme, mesaj yazma/okuma CALISIR; capa idempotenttir.
    let mut db = Db::open_in_memory_migrated().unwrap();
    db.ensure_chat_owner_anchor(7).unwrap();
    db.ensure_chat_owner_anchor(7).unwrap(); // idempotent — ikinci cagri no-op

    let s = db.create_chat_session(7, "ek arsiv sohbeti", None, None, "local", None).unwrap();
    let listed = db.list_chat_sessions(7, 0).unwrap();
    assert_eq!(listed.len(), 1, "capali sahip kendi oturumunu gormeli");
    assert_eq!(listed[0].id, s.id);

    db.append_chat_message(7, &s.id, "user", "soru", None, None, None).unwrap();
    assert_eq!(db.list_chat_messages(7, &s.id).unwrap().len(), 1, "mesaj round-trip");

    // Capa GIRIS YAPAMAZ: hash gecerli PHC dizesi degil (argon2 parse daima duser) ve
    // must_change=1. Sizinti yonu guvenli: satir yalniz FK hedefi.
    let (name, hash): (String, String) = db
        .connection()
        .query_row(
            "SELECT username, password_hash FROM users WHERE id = 7",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(name, "~sohbet-sahibi-7", "capa adi deterministik + '~' onekli");
    assert!(!hash.starts_with("$argon2"), "capa parolasi ASLA gecerli ozet olmamali");
}

#[test]
fn owner_anchor_never_clobbers_real_user() {
    // Ana-arsiv benzeri DB'de (gercek kullanici var) capa cagrisi mevcut satira DOKUNMAZ.
    let (db, u) = db_with_user();
    db.ensure_chat_owner_anchor(u).unwrap();
    let (name, role): (String, String) = db
        .connection()
        .query_row("SELECT username, role FROM users WHERE id = ?1", params![u], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(name, "tester", "gercek kullanici adi degismemeli");
    assert_eq!(role, "admin", "gercek kullanici rolu degismemeli");
}

#[test]
fn owner_anchor_isolation_matches_real_users() {
    // Capali sahipler arasinda da v31 izolasyonu aynen gecerli (7 ile 9 birbirini gormez).
    let db = Db::open_in_memory_migrated().unwrap();
    db.ensure_chat_owner_anchor(7).unwrap();
    db.ensure_chat_owner_anchor(9).unwrap();
    db.create_chat_session(7, "yedinin sohbeti", None, None, "local", None).unwrap();
    assert_eq!(db.list_chat_sessions(7, 0).unwrap().len(), 1);
    assert!(db.list_chat_sessions(9, 0).unwrap().is_empty(), "9 baskasininkini gormez");
}
