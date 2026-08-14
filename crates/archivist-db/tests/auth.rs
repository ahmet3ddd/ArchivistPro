//! Faz 6 auth (yerel kullanici hesaplari + argon2id) entegrasyon testleri.
//!
//! Migration 0006 (users) ile birlikte `auth.rs` yazma/dogrulama yollarini test eder.
//! EN riskli (guvenlik) katman → test-first. Davranis sozlesmesi:
//! - create + verify (dogru/yanlis/yok-olan hepsi dogru davranir),
//! - UNIQUE kullanici adi reddedilir (buyuk/kucuk harf duyarsiz),
//! - esik kadar basarisiz denemeden sonra kilit ('locked'),
//! - set_password (eski parola gecmez, yeni gecer), set_user_role,
//! - **son-admin korumasi** (son admini silemez/dususuremez; 2. admin varken yapilabilir),
//! - must_change bayragi gidiş-dönüş, user_count / count_admins.

use archivist_db::{Db, DbError};

/// Bir DbError'in `Invalid` olup belirli mesaji tasidigini dogrula (anti-enumeration:
/// hata mesajlari dis kodlardir, ic detay sizdirmaz).
fn assert_invalid(err: DbError, expected: &str) {
    match err {
        DbError::Invalid(m) => assert_eq!(m, expected, "beklenen Invalid kodu uyusmadi"),
        other => panic!("Invalid('{expected}') bekleniyordu, gelen: {other:?}"),
    }
}

#[test]
fn create_then_verify_correct_wrong_and_nonexistent() {
    let mut db = Db::open_in_memory_migrated().unwrap();

    let id = db.create_user("alice", "admin", "p@ssw0rd-123", false).unwrap();
    assert!(id > 0);
    assert_eq!(db.user_count().unwrap(), 1);
    assert_eq!(db.count_admins().unwrap(), 1);

    // Dogru parola → UserAuth (id/username/role/must_change).
    let auth = db.verify_credentials("alice", "p@ssw0rd-123").unwrap();
    assert_eq!(auth.id, id);
    assert_eq!(auth.username, "alice");
    assert_eq!(auth.role, "admin");
    assert!(!auth.must_change);

    // Kullanici adi buyuk/kucuk harf duyarsiz cozulur (COLLATE NOCASE).
    assert!(db.verify_credentials("ALICE", "p@ssw0rd-123").is_ok());

    // Yanlis parola → bad_credentials.
    assert_invalid(db.verify_credentials("alice", "wrong").unwrap_err(), "bad_credentials");

    // Var olmayan kullanici → ayni dis kod (anti-enumeration; dummy verify).
    assert_invalid(db.verify_credentials("ghost", "whatever").unwrap_err(), "bad_credentials");
}

#[test]
fn create_user_validates_inputs() {
    let mut db = Db::open_in_memory_migrated().unwrap();

    // Bos kullanici adi / parola reddedilir.
    assert_invalid(db.create_user("", "viewer", "pw-1234", false).unwrap_err(), "username_required");
    assert_invalid(
        db.create_user("bob", "viewer", "", false).unwrap_err(),
        "password_required",
    );
    // Gecersiz rol reddedilir (DB CHECK'e gitmeden).
    assert_invalid(db.create_user("bob", "root", "pw-1234", false).unwrap_err(), "invalid_role");
}

/// **A4 — parola asgari uzunluk (H2 paritesi).** H2 `src/components/FirstRunSetup.tsx:46-47`
/// en az 6 karakter dayatiyordu; H3'te kural yalniz `is_empty()`'e dusmustu (gerileme).
/// Kural UC yazma yolunda da (create / set_password / admin_reset_password) gecerli olmali.
#[test]
fn password_min_length_enforced_on_all_write_paths() {
    let mut db = Db::open_in_memory_migrated().unwrap();

    // create_user: 5 karakter → reddedilir, 6 karakter → kabul (sinir tam 6'da).
    assert_invalid(db.create_user("hank", "viewer", "12345", false).unwrap_err(), "password_too_short");
    let id = db.create_user("hank", "viewer", "123456", false).unwrap();
    assert!(db.verify_credentials("hank", "123456").is_ok(), "6 karakter kabul edilmeli");

    // set_password: bos → password_required (mevcut kod korunur), kisa → password_too_short.
    assert_invalid(db.set_password(id, "").unwrap_err(), "password_required");
    assert_invalid(db.set_password(id, "abcde").unwrap_err(), "password_too_short");
    db.set_password(id, "abcdef").unwrap();
    assert!(db.verify_credentials("hank", "abcdef").is_ok());

    // admin_reset_password: ayni kural (yol atlanmasin).
    assert_invalid(db.admin_reset_password(id, "").unwrap_err(), "password_required");
    assert_invalid(db.admin_reset_password(id, "short").unwrap_err(), "password_too_short");
    db.admin_reset_password(id, "yenipw").unwrap();
    assert!(db.verify_credentials("hank", "yenipw").unwrap().must_change);
}

#[test]
fn duplicate_username_rejected_case_insensitive() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    db.create_user("Carol", "editor", "pw-0001", false).unwrap();

    // Ayni ad → username_taken; farkli harf-buyuklugu de cakisir (NOCASE).
    assert_invalid(
        db.create_user("Carol", "viewer", "pw-0002", false).unwrap_err(),
        "username_taken",
    );
    assert_invalid(
        db.create_user("CAROL", "viewer", "pw-0002", false).unwrap_err(),
        "username_taken",
    );
    assert_eq!(db.user_count().unwrap(), 1);
}

#[test]
fn lockout_after_threshold_then_locked() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    db.create_user("dan", "viewer", "correct-horse", false).unwrap();

    // Esik = 5 basarisiz deneme → 5.'de kilit kurulur, sonraki cagri 'locked' doner.
    for _ in 0..5 {
        assert_invalid(db.verify_credentials("dan", "nope").unwrap_err(), "bad_credentials");
    }
    // Kilit aktif: dogru parola bile 'locked' doner (kilit suresi gecmeden).
    assert_invalid(db.verify_credentials("dan", "correct-horse").unwrap_err(), "locked");
    assert_invalid(db.verify_credentials("dan", "nope").unwrap_err(), "locked");
}

/// Kilit politikası arşivde kalıcıdır: H2'nin izin verdiği 3–20 deneme / 1–120 dakika
/// aralığında doğrulanır ve bir sonraki hatalı girişte uygulanır.
#[test]
fn lockout_policy_is_configurable_and_enforced() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    db.create_user("elif", "viewer", "correct-horse", false).unwrap();

    assert_eq!(db.auth_lockout_policy().unwrap().threshold, 5);
    assert_eq!(db.auth_lockout_policy().unwrap().duration_minutes, 5);
    db.set_auth_lockout_policy(3, 2).unwrap();
    let policy = db.auth_lockout_policy().unwrap();
    assert_eq!(policy.threshold, 3);
    assert_eq!(policy.duration_minutes, 2);

    for _ in 0..3 {
        assert_invalid(db.verify_credentials("elif", "nope").unwrap_err(), "bad_credentials");
    }
    assert_invalid(db.verify_credentials("elif", "correct-horse").unwrap_err(), "locked");
    let remaining: i64 = db
        .connection()
        .query_row(
            "SELECT locked_until - CAST(strftime('%s','now') AS INTEGER)
             FROM users WHERE username = 'elif'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!((115..=120).contains(&remaining), "2 dakika bekleniyordu, gelen: {remaining}");

    assert_invalid(
        db.set_auth_lockout_policy(2, 5).unwrap_err(),
        "lockout_threshold_out_of_range",
    );
    assert_invalid(
        db.set_auth_lockout_policy(3, 121).unwrap_err(),
        "lockout_duration_out_of_range",
    );
    assert_eq!(db.auth_lockout_policy().unwrap(), policy, "geçersiz yazım eski ayarı bozmaz");
}

/// **A3a — kilit suresi 300s (H2 paritesi).** H2 `src/services/userService.ts:142-143`
/// 5 deneme / 5 DAKIKA. H3'te 60s'e dusmustu (gerileme); ayni depoda LAN sunucusu H2
/// degerini korumustu (`crates/archivist-server/src/security.rs:13` = 300).
#[test]
fn lockout_duration_is_five_minutes() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    db.create_user("ida", "viewer", "correct-horse", false).unwrap();
    for _ in 0..5 {
        assert_invalid(db.verify_credentials("ida", "nope").unwrap_err(), "bad_credentials");
    }
    // locked_until - now varsayılan H2 süresidir (sabit doğrudan görünmez → DB'den ölçülür).
    let remaining: i64 = db
        .connection()
        .query_row(
            "SELECT locked_until - CAST(strftime('%s','now') AS INTEGER)
             FROM users WHERE username = 'ida'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert!(
        (295..=300).contains(&remaining),
        "kilit suresi ~300s olmali (H2 paritesi), gelen: {remaining}"
    );
}

/// **A3b — kayan pencere.** H2 `src/services/userService.ts:225-236` kilit dolunca deneme
/// KAYDINI SILIYORDU → sayac sifirdan basliyordu. H3'te sayac yalniz basarili giriste
/// sifirlaniyordu → gecmiste 5 hata yapmis kullanici, kilit coktan dolmusken tek yazim
/// hatasinda ANINDA yeniden kilitleniyordu. Dolmus kilit temiz sayfa acmali.
#[test]
fn expired_lock_resets_attempt_counter() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    db.create_user("jane", "viewer", "correct-horse", false).unwrap();
    for _ in 0..5 {
        assert_invalid(db.verify_credentials("jane", "nope").unwrap_err(), "bad_credentials");
    }
    assert_invalid(db.verify_credentials("jane", "correct-horse").unwrap_err(), "locked");

    // Kilidi "gecmiste dolmus" yap (300s beklemeden ayni durumu kur).
    db.connection()
        .execute(
            "UPDATE users SET locked_until = CAST(strftime('%s','now') AS INTEGER) - 1
             WHERE username = 'jane'",
            [],
        )
        .unwrap();

    // Dolmus kilit sonrasi TEK yazim hatasi ANINDA yeniden kilitlememeli (sayac 5 degil 1).
    assert_invalid(db.verify_credentials("jane", "nope").unwrap_err(), "bad_credentials");
    let attempts: i64 = db
        .connection()
        .query_row("SELECT failed_attempts FROM users WHERE username = 'jane'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(attempts, 1, "dolmus kilit sayaci sifirlamali → bu hata 1. hata olmali");

    // Ve dogru parola artik gecer (kilit yok).
    assert!(db.verify_credentials("jane", "correct-horse").is_ok(), "dolmus kilit sonrasi giris acilmali");
}

#[test]
fn set_password_old_fails_new_works() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let id = db.create_user("erin", "editor", "old-secret", false).unwrap();

    db.set_password(id, "new-secret").unwrap();

    assert_invalid(db.verify_credentials("erin", "old-secret").unwrap_err(), "bad_credentials");
    assert!(db.verify_credentials("erin", "new-secret").is_ok());

    // Bos yeni parola reddedilir.
    assert_invalid(db.set_password(id, "").unwrap_err(), "password_required");
}

#[test]
fn set_user_role_changes_role() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    // Tek admin korunmasi karismasin diye iki admin kur.
    db.create_user("root", "admin", "pw-root", false).unwrap();
    let fb = db.create_user("frank", "viewer", "pw-frank", false).unwrap();

    db.set_user_role(fb, "editor").unwrap();
    assert_eq!(db.verify_credentials("frank", "pw-frank").unwrap().role, "editor");

    // Gecersiz rol reddedilir.
    assert_invalid(db.set_user_role(fb, "superuser").unwrap_err(), "invalid_role");
}

#[test]
fn last_admin_guard_delete_and_demote() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let admin1 = db.create_user("admin1", "admin", "pw-0001", false).unwrap();
    db.create_user("viewer1", "viewer", "pw-view", false).unwrap();
    assert_eq!(db.count_admins().unwrap(), 1);

    // Son admin → silinemez ve dususurulemez.
    assert_invalid(db.delete_user(admin1).unwrap_err(), "last_admin");
    assert_invalid(db.set_user_role(admin1, "viewer").unwrap_err(), "last_admin");

    // 2. admin gelince koruma kalkar.
    let admin2 = db.create_user("admin2", "admin", "pw-0002", false).unwrap();
    assert_eq!(db.count_admins().unwrap(), 2);
    db.set_user_role(admin1, "viewer").unwrap(); // artik dususurulebilir
    assert_eq!(db.count_admins().unwrap(), 1);

    // Simdi admin2 yine son admin → silinemez.
    assert_invalid(db.delete_user(admin2).unwrap_err(), "last_admin");

    // viewer1 her zaman silinebilir (admin degil).
    let users = db.list_users().unwrap();
    let viewer1 = users.iter().find(|u| u.username == "viewer1").unwrap();
    db.delete_user(viewer1.id).unwrap();
    assert!(db.list_users().unwrap().iter().all(|u| u.username != "viewer1"));
}

#[test]
fn must_change_flag_round_trips() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    db.create_user("greg", "viewer", "temp-pw", true).unwrap();

    let auth = db.verify_credentials("greg", "temp-pw").unwrap();
    assert!(auth.must_change, "must_change_password=1 verify'da yansimali");
}

#[test]
fn list_users_count_and_admins() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    assert_eq!(db.user_count().unwrap(), 0);
    assert_eq!(db.count_admins().unwrap(), 0);

    db.create_user("a", "admin", "pw-1234", false).unwrap();
    db.create_user("b", "editor", "pw-1234", false).unwrap();
    db.create_user("c", "viewer", "pw-1234", false).unwrap();

    assert_eq!(db.user_count().unwrap(), 3);
    assert_eq!(db.count_admins().unwrap(), 1);

    // list_users: id/username/role/created_at; ada gore sirali.
    let users = db.list_users().unwrap();
    assert_eq!(users.len(), 3);
    assert_eq!(users.iter().map(|u| u.username.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
    let a = users.iter().find(|u| u.username == "a").unwrap();
    assert_eq!(a.role, "admin");
    assert!(a.created_at > 0);
}

#[test]
fn founder_cannot_be_deleted_demoted_or_admin_reset() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let founder = db
        .create_founder_user("ana", "admin", "ana-parola", false)
        .unwrap();
    db.create_user("yerel", "admin", "yerel-parola", false).unwrap();

    assert_invalid(db.delete_user(founder).unwrap_err(), "founder_delete");
    assert_invalid(db.set_user_role(founder, "viewer").unwrap_err(), "founder_role");
    assert_invalid(
        db.admin_reset_password(founder, "yeni-parola").unwrap_err(),
        "founder_password",
    );
    assert!(db.verify_credentials("ana", "ana-parola").is_ok());
}
