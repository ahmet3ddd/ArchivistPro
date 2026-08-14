//! Yerel kullanici hesaplari + parola dogrulama (Faz 6: auth + gercek RBAC).
//!
//! **B1 duzeltmesinin veri katmani.** Rol DB'de TEXT (CHECK ile kisitli); `Role` enum
//! eslemesi komut katmaninda yapilir → db, src-tauri'ye bagimli kalmaz (tek-yon bagimlilik).
//!
//! Guvenlik ilkeleri:
//! - **argon2id** ile parola ozetleme; tuz `OsRng` ile uretilir (asla duz parola).
//! - **Anti-enumeration:** var olmayan kullanicida da dummy bir argon2 dogrulama
//!   yapilir (sabite-yakin zamanlama) ve var-olan-yanlis-parola ile ayni dis kod
//!   (`bad_credentials`) doner; istemci kullanici-var-mi cikarimi yapamaz.
//! - **Kaba-kuvvet sinirlama:** esik kadar basarisiz denemeden sonra gecici kilit.
//! - **Son-admin korumasi:** sistemin yonetimsiz kalmasini onler (son admini
//!   silmek/dususurmek reddedilir).

use std::sync::OnceLock;

use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use rusqlite::{params, OptionalExtension};

use crate::error::DbError;
use crate::Db;

/// Kilit politikasinin izin verilen araligi (H2 Ayarlar→Guvenlik paritesi).
pub const LOCKOUT_THRESHOLD_MIN: i64 = 3;
pub const LOCKOUT_THRESHOLD_MAX: i64 = 20;
pub const LOCKOUT_DURATION_MINUTES_MIN: i64 = 1;
pub const LOCKOUT_DURATION_MINUTES_MAX: i64 = 120;

/// Varsayilan: 5 deneme / 5 dakika = **300 sn (H2 paritesi)**
/// (H2 `src/services/userService.ts:142-143`). H3'te bir ara 60 sn'ye dusmustu (gerileme);
/// ayni depoda LAN sunucusu H2 degerini korumustu
/// (`crates/archivist-server/src/security.rs:13` = 300s) → giris yolu onunla hizalidir.
pub const DEFAULT_LOCKOUT_THRESHOLD: i64 = 5;
pub const DEFAULT_LOCKOUT_DURATION_MINUTES: i64 = 5;

const META_LOCKOUT_THRESHOLD: &str = "auth_lockout_threshold";
const META_LOCKOUT_DURATION_MINUTES: &str = "auth_lockout_duration_minutes";

/// Arşiv-geneli giriş kaba-kuvvet politikası. `app_meta` bozuk/eksikse güvenli H2 varsayılanına
/// düşer; eski arşivler migration beklemeden aynı davranışı korur.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LockoutPolicy {
    pub threshold: i64,
    pub duration_minutes: i64,
}

impl LockoutPolicy {
    fn duration_secs(self) -> i64 {
        self.duration_minutes * 60
    }
}

/// Parola asgari uzunlugu — **H2 paritesi** (H2 `src/components/FirstRunSetup.tsx:46-47`
/// en az 6 karakter dayatiyordu). H3'te kural yalniz `is_empty()`'e dusmustu (gerileme).
/// Kullanici olusturma + parola degistirme + admin sifirlama yollarinin HEPSINDE gecerli.
const MIN_PASSWORD_LEN: usize = 6;

/// Parola uzunluk kurali — tek nokta (uc yolun sapmamasi icin). Bos → `password_required`
/// (mevcut dis kod korunur), kisa → `password_too_short`.
fn validate_password(password: &str) -> Result<(), DbError> {
    if password.is_empty() {
        return Err(DbError::Invalid("password_required".into()));
    }
    if password.chars().count() < MIN_PASSWORD_LEN {
        return Err(DbError::Invalid("password_too_short".into()));
    }
    Ok(())
}

/// Gecerli roller (DB CHECK ile ayni kume). Komut katmani `Role` enum'a esler.
const VALID_ROLES: [&str; 3] = ["admin", "editor", "viewer"];

/// Anti-enumeration dummy dogrulama icin **gercek** bir argon2id ozeti (bir kez,
/// gercek parametrelerle uretilir). Var-olmayan-kullanici dalinda buna karsi
/// dogrulama yapilir → zamanlama gercek dogrulamayla ayni is yukundedir (kullanici
/// sayimi/varlik sizmaz). Elle-yazili sabit yerine uretim: yanlis-kodlanmis ozet
/// `PasswordHash::new`'i bos-cevirip savunmayi etkisizlestirebilirdi.
fn dummy_hash() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| {
        // Hata olmasi beklenmez (sabit girdi); olursa bile guvenli, ABI-gecerli bir
        // yedek ozet kullanilir (dogrulama yine basarisiz olur, kod akisi bozulmaz).
        hash_password("anti-enumeration-dummy").unwrap_or_else(|_| {
            "$argon2id$v=19$m=19456,t=2,p=1$\
             c29tZXNhbHRzb21lc2FsdA$\
             aG9wZWZ1bGx5VGhpc05ldmVyUnVuc0F0QWxsAAAAAAA".to_string()
        })
    })
}

/// Kimlik-dogrulama sonucu — oturum kurmak icin gereken cekirdek (parola ozeti DISI).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserAuth {
    pub id: i64,
    pub username: String,
    /// Rol metni ('admin' | 'editor' | 'viewer'); komut katmani `Role`'a esler.
    pub role: String,
    /// İlk girişte parola degistirme zorunlu mu (admin sifirlamasi sonrasi).
    pub must_change: bool,
    /// Bu arşivin tek ana admini mi? Yalnız admin rolüyle birlikte anlamlıdır.
    pub is_founder: bool,
}

/// Kullanici listesi satiri (admin paneli) — hassas alanlar (ozet) yok.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserRef {
    pub id: i64,
    pub username: String,
    pub role: String,
    pub is_founder: bool,
    pub created_at: i64,
}

/// Rol metnini dogrula (gecersizse `Invalid("invalid_role")`).
fn validate_role(role: &str) -> Result<(), DbError> {
    if VALID_ROLES.contains(&role) {
        Ok(())
    } else {
        Err(DbError::Invalid("invalid_role".into()))
    }
}

/// argon2id ile parolayi ozetle (rastgele tuz, OsRng). Ozet PHC string olarak doner.
fn hash_password(password: &str) -> Result<String, DbError> {
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        // Ozetleme hatasi ic hatadir (parola degil) — Invalid yerine genel kodla sar.
        .map_err(|e| DbError::Invalid(format!("hash_error: {e}")))
}

/// Verilen parolayi PHC-string ozete karsi dogrula. Hatali ozet/parola → `false`.
fn verify_password(password: &str, phc: &str) -> bool {
    match PasswordHash::new(phc) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Sabit-zamanlamali dummy dogrulama — var-olmayan-kullanici dalinda cagrilir.
/// Sonucu yok sayilir; amac yalniz gercek dogrulamaya yakin is yuku uretmek.
fn dummy_verify() {
    let _ = verify_password("anti-enumeration-dummy-input", dummy_hash());
}

impl Db {
    /// Etkin giriş kilidi politikasını döndürür. Ayar hiç yazılmamışsa veya saklanan değer
    /// geçersizse H2 varsayılanına döner; eski/bozuk meta kaydı login yolunu zayıflatamaz.
    pub fn auth_lockout_policy(&self) -> Result<LockoutPolicy, DbError> {
        let threshold = self
            .get_meta(META_LOCKOUT_THRESHOLD)?
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| (LOCKOUT_THRESHOLD_MIN..=LOCKOUT_THRESHOLD_MAX).contains(value))
            .unwrap_or(DEFAULT_LOCKOUT_THRESHOLD);
        let duration_minutes = self
            .get_meta(META_LOCKOUT_DURATION_MINUTES)?
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| {
                (LOCKOUT_DURATION_MINUTES_MIN..=LOCKOUT_DURATION_MINUTES_MAX).contains(value)
            })
            .unwrap_or(DEFAULT_LOCKOUT_DURATION_MINUTES);
        Ok(LockoutPolicy { threshold, duration_minutes })
    }

    /// Arşiv-geneli giriş kilidi eşiğini günceller. Yalnız doğrulanmış H2 aralığı kalıcı olur:
    /// 3–20 deneme ve 1–120 dakika. Devam eden kilitler yeniden hesaplanmaz; ayar sonraki
    /// başarısız girişte uygulanır.
    pub fn set_auth_lockout_policy(
        &mut self,
        threshold: i64,
        duration_minutes: i64,
    ) -> Result<(), DbError> {
        if !(LOCKOUT_THRESHOLD_MIN..=LOCKOUT_THRESHOLD_MAX).contains(&threshold) {
            return Err(DbError::Invalid("lockout_threshold_out_of_range".into()));
        }
        if !(LOCKOUT_DURATION_MINUTES_MIN..=LOCKOUT_DURATION_MINUTES_MAX)
            .contains(&duration_minutes)
        {
            return Err(DbError::Invalid("lockout_duration_out_of_range".into()));
        }
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT INTO app_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_LOCKOUT_THRESHOLD, threshold.to_string()],
        )?;
        tx.execute(
            "INSERT INTO app_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_LOCKOUT_DURATION_MINUTES, duration_minutes.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Yeni kullanici olustur (argon2id ozet). Rol {admin,editor,viewer}; kullanici-adi
    /// bos olmamali; parola >= `MIN_PASSWORD_LEN` (bos → `password_required`, kisa →
    /// `password_too_short`). UNIQUE ihlali →
    /// `Invalid("username_taken")`. Yeni kullanici id'si doner.
    pub fn create_user(
        &mut self,
        username: &str,
        role: &str,
        password: &str,
        must_change: bool,
    ) -> Result<i64, DbError> {
        self.create_user_inner(username, role, password, must_change, false)
    }

    /// İlk kurulumdaki tek ana admini oluştur. Bu ek işaret normal admin rolünü
    /// değiştirmez; yalnız ana-admina özel komutlar için kullanılır.
    pub fn create_founder_user(
        &mut self,
        username: &str,
        role: &str,
        password: &str,
        must_change: bool,
    ) -> Result<i64, DbError> {
        if role != "admin" {
            return Err(DbError::Invalid("founder_must_be_admin".into()));
        }
        let founder_exists: bool = self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM users WHERE is_founder = 1)",
            [],
            |row| row.get(0),
        )?;
        if founder_exists {
            return Err(DbError::Invalid("founder_exists".into()));
        }
        self.create_user_inner(username, role, password, must_change, true)
    }

    fn create_user_inner(
        &mut self,
        username: &str,
        role: &str,
        password: &str,
        must_change: bool,
        is_founder: bool,
    ) -> Result<i64, DbError> {
        let username = username.trim();
        if username.is_empty() {
            return Err(DbError::Invalid("username_required".into()));
        }
        validate_password(password)?;
        validate_role(role)?;

        let hash = hash_password(password)?;
        let tx = self.conn.transaction()?;
        // UNIQUE (COLLATE NOCASE) ihlalini dis koda cevir; baska hatalar sizar.
        let inserted = tx.execute(
            "INSERT INTO users(username, role, password_hash, must_change_password, is_founder)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![username, role, hash, must_change as i64, is_founder as i64],
        );
        match inserted {
            Ok(_) => {}
            Err(rusqlite::Error::SqliteFailure(e, _))
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                return Err(DbError::Invalid("username_taken".into()));
            }
            Err(e) => return Err(DbError::Sqlite(e)),
        }
        let id = tx.last_insert_rowid();
        tx.commit()?;
        Ok(id)
    }

    /// Kullanici adi + parola dogrula. Basari → `UserAuth`.
    ///
    /// Anti-enumeration: kullanici yoksa dummy argon2 dogrulama + `bad_credentials`.
    /// Hesap kilitliyse (`locked_until > now`) → `locked`. Kilit SURESI DOLMUSSA sayac
    /// sifirlanir (kayan pencere — H2 `src/services/userService.ts:225-236` paritesi). Yanlis
    /// parola → `failed_attempts++`, esikte etkin politikanın süresiyle `locked_until`,
    /// `bad_credentials`. Basari → `failed_attempts`/`locked_until` sifirlanir.
    pub fn verify_credentials(
        &mut self,
        username: &str,
        password: &str,
    ) -> Result<UserAuth, DbError> {
        let username = username.trim();

        // Kullaniciyi cek (kilit/ozet alanlariyla). Yoksa: dummy verify + ortak kod.
        let row: Option<(i64, String, String, String, bool, i64, bool)> = self
            .conn
            .query_row(
                "SELECT id, username, role, password_hash, must_change_password, locked_until, is_founder
                 FROM users WHERE username = ?1",
                params![username],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get::<_, i64>(4)? != 0,
                        r.get(5)?,
                        r.get::<_, i64>(6)? != 0,
                    ))
                },
            )
            .optional()?;

        let (id, uname, role, hash, must_change, locked_until, is_founder) = match row {
            Some(v) => v,
            None => {
                dummy_verify();
                return Err(DbError::Invalid("bad_credentials".into()));
            }
        };

        let now = now_secs(&self.conn)?;
        if locked_until > now {
            return Err(DbError::Invalid("locked".into()));
        }
        // **Kayan pencere (H2 paritesi).** H2 `src/services/userService.ts:225-236` kilit
        // dolunca deneme KAYDINI SILIYORDU → sayac sifirdan basliyordu. H3'te sayac yalniz
        // basarili giriste sifirlaniyordu → omur boyu 5 hata yapmis kullanici aylar sonra tek
        // yazim hatasinda ANINDA (ve kalici olarak) kilitleniyordu. Dolmus kilidi burada
        // temizleyerek kullanici temiz sayfayla baslar.
        if locked_until != 0 {
            self.conn.execute(
                "UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?1",
                params![id],
            )?;
        }

        if verify_password(password, &hash) {
            // Basari → sayaclari sifirla.
            self.conn.execute(
                "UPDATE users SET failed_attempts = 0, locked_until = 0 WHERE id = ?1",
                params![id],
            )?;
            Ok(UserAuth { id, username: uname, role, must_change, is_founder })
        } else {
            // Basarisiz → sayaci artir; esige ulasinca kilitle.
            let attempts: i64 = self.conn.query_row(
                "UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?1
                 RETURNING failed_attempts",
                params![id],
                |r| r.get(0),
            )?;
            let policy = self.auth_lockout_policy()?;
            if attempts >= policy.threshold {
                self.conn.execute(
                    "UPDATE users SET locked_until = ?2 WHERE id = ?1",
                    params![id, now + policy.duration_secs()],
                )?;
            }
            Err(DbError::Invalid("bad_credentials".into()))
        }
    }

    /// Kullanicinin parolasini degistir (argon2id yeniden-ozet). Parola kurali:
    /// `validate_password` (bos → `password_required`, < 6 → `password_too_short`).
    /// Sayaclar sifirlanir; `must_change_password` temizlenir (kullanici kendi sectiyse).
    pub fn set_password(&mut self, id: i64, new: &str) -> Result<(), DbError> {
        validate_password(new)?;
        let hash = hash_password(new)?;
        self.conn.execute(
            "UPDATE users
             SET password_hash = ?2, must_change_password = 0, failed_attempts = 0, locked_until = 0
             WHERE id = ?1",
            params![id, hash],
        )?;
        Ok(())
    }

    /// Admin'in bir kullanicinin parolasini sifirlamasi — `must_change_password = 1`
    /// (kullanici ilk girişte yeni parola sectirilir). Parola kurali: `validate_password`.
    pub fn admin_reset_password(&mut self, id: i64, new: &str) -> Result<(), DbError> {
        let target_is_founder: bool = self
            .conn
            .query_row(
                "SELECT is_founder = 1 FROM users WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(false);
        if target_is_founder {
            return Err(DbError::Invalid("founder_password".into()));
        }
        validate_password(new)?;
        let hash = hash_password(new)?;
        self.conn.execute(
            "UPDATE users
             SET password_hash = ?2, must_change_password = 1, failed_attempts = 0, locked_until = 0
             WHERE id = ?1",
            params![id, hash],
        )?;
        Ok(())
    }

    /// Kullanicinin rolunu degistir. Gecersiz rol → `Invalid`. **Son-admin korumasi:**
    /// son admini admin-disi role dususurmek reddedilir (`Invalid("last_admin")`).
    pub fn set_user_role(&mut self, id: i64, role: &str) -> Result<(), DbError> {
        validate_role(role)?;
        // Ana admin asla admin-disi role dusurulemez. Hedef su an admin ve yeni rol
        // admin degilse son-admin korumasi da ayrica uygulanir.
        if role != "admin" {
            let target: (bool, bool) = self
                .conn
                .query_row(
                    "SELECT role = 'admin', is_founder = 1 FROM users WHERE id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
                .unwrap_or((false, false));
            if target.1 {
                return Err(DbError::Invalid("founder_role".into()));
            }
            if target.0 && self.count_admins()? <= 1 {
                return Err(DbError::Invalid("last_admin".into()));
            }
        }
        self.conn
            .execute("UPDATE users SET role = ?2 WHERE id = ?1", params![id, role])?;
        Ok(())
    }

    /// Kullaniciyi sil. **Son-admin korumasi:** son admin silinemez (`last_admin`).
    pub fn delete_user(&mut self, id: i64) -> Result<(), DbError> {
        let target: (bool, bool) = self
            .conn
            .query_row(
                "SELECT role = 'admin', is_founder = 1 FROM users WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .unwrap_or((false, false));
        if target.1 {
            return Err(DbError::Invalid("founder_delete".into()));
        }
        if target.0 && self.count_admins()? <= 1 {
            return Err(DbError::Invalid("last_admin".into()));
        }
        self.conn
            .execute("DELETE FROM users WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Tum kullanicilar (ada gore sirali) — admin paneli icin. Ozet alani DONMEZ.
    pub fn list_users(&self) -> Result<Vec<UserRef>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, username, role, is_founder, created_at
             FROM users ORDER BY username COLLATE NOCASE",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(UserRef {
                id: r.get(0)?,
                username: r.get(1)?,
                role: r.get(2)?,
                is_founder: r.get::<_, i64>(3)? != 0,
                created_at: r.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    /// Toplam kullanici sayisi (ilk-kurulum tespiti: 0 → setup gerekir).
    pub fn user_count(&self) -> Result<i64, DbError> {
        Ok(self
            .conn
            .query_row("SELECT count(*) FROM users", [], |r| r.get(0))?)
    }

    /// Admin rolundeki kullanici sayisi (son-admin korumasinin temeli).
    pub fn count_admins(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM users WHERE role = 'admin'",
            [],
            |r| r.get(0),
        )?)
    }
}

/// DB saatine gore simdiki unix saniye (kilit hesaplari icin tek kaynak).
/// `strftime` metin doner → INTEGER'a CAST (locked_until sutunu ile ayni tip).
fn now_secs(conn: &rusqlite::Connection) -> Result<i64, DbError> {
    Ok(conn.query_row("SELECT CAST(strftime('%s','now') AS INTEGER)", [], |r| r.get(0))?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Anti-enumeration savunmasi ancak dummy ozet GERCEK argon2 isi yaptirirsa
    /// gecerli; ozet parse edilemezse `verify` ucuz no-op olur (zamanlama sizar).
    /// Bu test, uretilen dummy ozetin gecerli PHC oldugunu garanti eder.
    #[test]
    fn dummy_hash_is_valid_argon2_phc() {
        let phc = dummy_hash();
        assert!(PasswordHash::new(phc).is_ok(), "dummy ozet gecerli argon2 PHC olmali: {phc}");
        // Yanlis parola → false (gercek dogrulama kosuyor, no-op degil).
        assert!(!verify_password("wrong-input", phc));
    }

    /// hash → verify gidiş-dönüş (dogru parola gecer, yanlis gecmez).
    #[test]
    fn hash_then_verify_roundtrip() {
        let phc = hash_password("correct horse battery staple").unwrap();
        assert!(verify_password("correct horse battery staple", &phc));
        assert!(!verify_password("nope", &phc));
    }
}
