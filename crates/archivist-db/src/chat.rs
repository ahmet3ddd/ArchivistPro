//! Kalici cok-oturumlu sohbet — `chat_sessions` + `chat_messages` CRUD (H2 chatStorage.ts porti).
//!
//! H3'te sohbet bugune dek TAMAMEN bellekteydi (ChatView `useState<Turn[]>`) → kapaninca uctu.
//! H2'nin oturum/mesaj yapisi (database.ts 1042-1064 + chatStorage.ts) native SQLite'a tasinir;
//! **Rust veriyi sahiplenir** → .db tasininca sohbet gecmisi birlikte gider.
//!
//! Tasarim (data-migration kurallari):
//! - **FK CASCADE ile tek DELETE:** `connection.rs` PRAGMA foreign_keys=ON → `delete_chat_session`
//!   tek `DELETE FROM chat_sessions` yeter; mesajlar CASCADE ile OTOMATIK gider (elle cascade
//!   GEREKMEZ; H2'de sql.js↔rusqlite ikili motorda pragma OFF oldugu icin manuel gerekiyordu —
//!   H3 tek motor + pragma ON → yapisal olarak yetim mesaj imkansiz). `append_chat_message` de
//!   var-olmayan session_id'ye FK ihlali ile calisMAZ → yetim mesaj yazilmaz.
//! - **Epoch ms (Rust now_ms):** created_at/updated_at sayisal (chrono'suz; H2 ISO yerine). Deger
//!   daima bu katmanda uretilir (SQL DEFAULT yok) → tek dogruluk kaynagi.
//! - **updated_at tazeleme:** `append`/`rename` oturumun `updated_at`'ini tazeler → liste (DESC)
//!   en aktif sohbeti one alir. `append` INSERT+UPDATE'i **tek TX**'te atomik yapar.
//!
//! COP-KUTUSU (v24, `deleted_at`): silme artik SOFT (geri-alinabilir). `delete_chat_session`
//! oturumu `deleted_at = now_ms` ile isaretler (mesajlara DOKUNMAZ → restore tam geri getirir);
//! `restore_chat_session` geri alir; `purge_chat_session` gercek DELETE (mesajlar FK CASCADE ile
//! gider). Aktif liste (`list_chat_sessions`) yalniz `deleted_at IS NULL`; cop
//! (`list_trashed_chat_sessions`) yalniz `IS NOT NULL`. `append`/`rename` cop'teki oturumda no-op
//! (hayalet aktivite yok). ⚠️ BIRIM: `deleted_at` = epoch **ms** (created_at/updated_at ile ayni;
//! assets trash'inin saniye deseni DEGIL).
//!
//! SAHIPLIK (v31, `user_id`): her oturum bir kullaniciya aittir ve **tum** sorgular sahibe gore
//! suzulur — liste, cop listesi/sayimi, rename/delete/restore/purge ve mesaj okuma/yazma. Once
//! sohbet arsiv-geneliydi (0023'te sahip alani yoktu) → cok-kullanicili arsivde herkes herkesin
//! sohbetini gorur ve KALICI silebilirdi; bkz `sql/0031_chat_session_owner.sql`.
//! - **Sahip cagirandan gelir, kayittan turetilmez:** komut katmani `user_id`'yi OTURUMDAN alir
//!   (0028 `user_messages` deseni) → istemci sahip secemez.
//! - **Baskasinin oturumu = YOK gibi davranir** (hata degil, no-op / bos sonuc). Kasitli: "yetkin
//!   yok" demek o id'nin VAR oldugunu sizdirirdi. Tek istisna `append_chat_message` — orada
//!   sessiz no-op mesaji kaybederdi, o yuzden hata doner; mesaj metni eksik-id ile AYNI
//!   ("oturum bulunamadi") → yine varlik sizmaz.
//!
//! ARSIV KAYNAGI (v26, `source` + `host_label`): oturum HANGI arsivle konustugunu tasir
//! ('local' | 'remote' + uzakta host etiketi). Atiflar asset **id**'sidir ve id uzayi kaynaga
//! gore degisir → kaynaksiz oturum, kaynak degistikten sonra acilinca YANLIS dosya acardi
//! (bkz `sql/0026_chat_session_source.sql`). Liste bu alanla suzulur; `list_chat_sessions`
//! HER kaynagi doner (bolme cagirana ait) — frontend hem aktif kaynagi hem "diger kaynak"
//! sayisini tek cagriyla cizer. ⚠️ `limit` bolmeden ONCE uygulanir (bugunku davranisla ayni).

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension, Row};

use crate::error::DbError;
use crate::Db;

/// Bir sohbet oturumu (H2 ChatSession pariti; scope opak JSON olarak tasinir).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatSession {
    pub id: String,
    pub title: String,
    /// Opak JSON (or. `{"type":"project","value":"X"}`) — db yorumlamaz; None = belirsiz.
    pub scope_json: Option<String>,
    pub model: Option<String>,
    /// epoch ms.
    pub created_at: i64,
    /// epoch ms; append/rename ile tazelenir.
    pub updated_at: i64,
    /// Cop-kutusu isareti (v24). None = AKTIF; Some(epoch **ms**) = cop'te (soft-delete).
    pub deleted_at: Option<i64>,
    /// Oturumun konustugu ARSIV (v26): `"local"` = bu makine · `"remote"` = LAN ana arsiv.
    /// DB kelepcelemez (role deseni) — cagiran `AssetSource` degerlerini AYNEN yazar.
    /// **Neden var:** atiflar (citations_json) asset id'sidir; id uzayi kaynaga gore degisir →
    /// kaynaksiz oturum yanlis dosya acardi (bkz migration 0026).
    pub source: String,
    /// Uzak oturumun konustugu ana arsiv etiketi ("192.168.1.5:9471"). None = yerel oturum.
    /// Baska host'a eslesilince id uzayi degisir → bu alan "ayni ana arsiv mi" sorusunu cevaplar.
    pub host_label: Option<String>,
    /// Oturumun SAHIBI (v31; `users.id`). None = sahipsiz — yalniz hic kullanicisi olmayan DB'de
    /// olusur (uretimde imkansiz: setup once kosar). Sahipsiz satir hicbir listeye dusmez.
    /// **IPC'ye acilmaz** — renderer sahibi bilmez, zaten yalniz kendi oturumlarini gorur.
    pub user_id: Option<i64>,
}

/// Bir sohbet mesaji (H2 ChatMessage pariti; citations opak JSON).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChatMessage {
    pub id: String,
    pub session_id: String,
    /// 'user' | 'assistant' | 'system' (db kelepcelemez; cagiran sozlesir).
    pub role: String,
    pub content: String,
    /// Opak JSON (RAG atif referanslari); None serbest.
    pub citations_json: Option<String>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    /// epoch ms.
    pub created_at: i64,
}

/// Kimlik uretimi icin process-ici monotonik sayac → ayni ms icinde bile benzersiz kimlik
/// (`cs_<ms>_<seq>` / `cm_<ms>_<seq>`). Restart'ta sifirlanir; farkli ms → carpisma pratikte yok.
static ID_SEQ: AtomicU64 = AtomicU64::new(0);

/// Su anki zaman (unix epoch **ms**) — H3 konvansiyonu (ai_analyzed_at ile tutarli; chrono'suz).
fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// `<prefix>_<epochms>_<atomik-seq>` benzersiz kimlik.
fn gen_id(prefix: &str, now: i64) -> String {
    let seq = ID_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}_{now}_{seq}")
}

fn map_session(r: &Row) -> rusqlite::Result<ChatSession> {
    Ok(ChatSession {
        id: r.get(0)?,
        title: r.get(1)?,
        scope_json: r.get(2)?,
        model: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
        deleted_at: r.get(6)?,
        source: r.get(7)?,
        host_label: r.get(8)?,
        user_id: r.get(9)?,
    })
}

/// Oturum listeleyen sorgularin ortak sutun listesi — sira `map_session` ile BIREBIR bagli.
/// Tek yerde durur ki yeni bir kolon eklenince iki SELECT arasinda kayma olmasin.
const SESSION_COLUMNS: &str = "id, title, scope_json, model, created_at, updated_at, deleted_at, \
                               source, host_label, user_id";

fn map_message(r: &Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: r.get(0)?,
        session_id: r.get(1)?,
        role: r.get(2)?,
        content: r.get(3)?,
        citations_json: r.get(4)?,
        tokens_in: r.get(5)?,
        tokens_out: r.get(6)?,
        created_at: r.get(7)?,
    })
}

impl Db {
    /// Yeni sohbet oturumu olustur. `id = cs_<nowms>_<seq>`; `created_at = updated_at = now`.
    /// `scope_json`/`model` opak (None → NULL). Olusan satiri doner (frontend hemen kullanir).
    ///
    /// `source` (v26): `"local"` | `"remote"` — oturumun HANGI arsivle konustugu. Parametre
    /// **zorunlu** (varsayilani yok) cunku atif id'lerinin hangi uzaya ait oldugu sonradan
    /// turetilemez; cagiranin bunu bilincli soylemesi gerekir. `host_label` yalniz uzak oturumda
    /// anlamli (hangi ana arsiv) — yerelde None.
    /// `user_id` (v31): oturumun SAHIBI. Komut katmani bunu OTURUMDAN verir — IPC parametresi
    /// DEGILDIR (0028 `user_messages` deseni: "alici UI/IPC parametresi degildir").
    pub fn create_chat_session(
        &self,
        user_id: i64,
        title: &str,
        scope_json: Option<&str>,
        model: Option<&str>,
        source: &str,
        host_label: Option<&str>,
    ) -> Result<ChatSession, DbError> {
        let now = now_ms();
        let id = gen_id("cs", now);
        // created_at ve updated_at ayni deger (?5 iki kez) → olusum aninda esit.
        self.conn.execute(
            "INSERT INTO chat_sessions
               (id, title, scope_json, model, created_at, updated_at, source, host_label, user_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7, ?8)",
            params![id, title, scope_json, model, now, source, host_label, user_id],
        )?;
        Ok(ChatSession {
            id,
            title: title.to_string(),
            scope_json: scope_json.map(str::to_string),
            model: model.map(str::to_string),
            created_at: now,
            updated_at: now,
            deleted_at: None,
            source: source.to_string(),
            host_label: host_label.map(str::to_string),
            user_id: Some(user_id),
        })
    }

    /// Sohbet sahibi icin **FK capasi** garanti et — yalniz EK arsivlerde cagrilir (komut katmani
    /// karar verir; ana arsivde ASLA).
    ///
    /// NEDEN (saha bulgusu 2026-08-13): kimlik ANA arsivde merkezidir (ek arsivler yalniz-icerik,
    /// bkz `archive_commands.rs`) → ek arsivin `users` tablosu BOStur. 0031'in
    /// `user_id REFERENCES users(id)` FK'si + `foreign_keys=ON` bileşimi ek arsivde oturum
    /// olusturmayi FK ihlaliyle dusuruyordu; frontend hatayi yutunca sohbet "kaydedilmiyor"
    /// gorunuyordu. Bu satir bir GOLGE capadir: giris yapamaz (`password_hash` gecerli PHC dizesi
    /// DEGIL — argon2 parse'i daima duser; login zaten yalniz ana arsive bakar), hicbir listede
    /// gorunmez (kullanici yonetimi ana-arsiv-kapili), tek isi FK hedefi olmaktir.
    /// Idempotent: id'li satir varsa (gercek kullanici DAHIL) `ON CONFLICT(id) DO NOTHING` ile
    /// DOKUNULMAZ. Kullanici adi `~sohbet-sahibi-<id>` deterministik + '~' onekiyle gercek
    /// adlardan ayrisir (UNIQUE NOCASE carpismasi pratikte imkansiz; olursa hata SIZAR — sessiz
    /// yutma yok).
    pub fn ensure_chat_owner_anchor(&self, user_id: i64) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT INTO users (id, username, role, password_hash, must_change_password)
             VALUES (?1, '~sohbet-sahibi-' || ?1, 'viewer', '!capa-giris-yok', 1)
             ON CONFLICT(id) DO NOTHING",
            params![user_id],
        )?;
        Ok(())
    }

    /// AKTIF oturumlari **son-guncellenen ilk** (updated_at DESC) listele. `limit <= 0` → 100.
    /// Esit updated_at'ta `rowid DESC` (ekleme sirasi) ile kararli (id TEXT → sozluksel siralama
    /// kronolojik degil; rowid guvenilir tie-break). **Cop'tekiler (`deleted_at IS NOT NULL`)
    /// gizlenir** — cop icin [`list_trashed_chat_sessions`](Self::list_trashed_chat_sessions).
    /// **Yalniz `user_id`'nin KENDI oturumlari** (v31) — baskasininki hic gorunmez.
    pub fn list_chat_sessions(
        &self,
        user_id: i64,
        limit: i64,
    ) -> Result<Vec<ChatSession>, DbError> {
        let lim = if limit <= 0 { 100 } else { limit };
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {SESSION_COLUMNS}
             FROM chat_sessions
             WHERE deleted_at IS NULL AND user_id = ?1
             ORDER BY updated_at DESC, rowid DESC
             LIMIT ?2"
        ))?;
        let rows = stmt
            .query_map(params![user_id, lim], map_session)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Tek AKTIF oturumu getir (owner-scoped; Markdown disa-aktarma icin). Baskasinin / yok-olan /
    /// cop'teki (`deleted_at IS NOT NULL`) oturum → `None` (sahiplik sizdirmaz; v31 deseni).
    pub fn get_chat_session(&self, user_id: i64, id: &str) -> Result<Option<ChatSession>, DbError> {
        let sql = format!(
            "SELECT {SESSION_COLUMNS} FROM chat_sessions
             WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL"
        );
        Ok(self.conn.query_row(&sql, params![id, user_id], map_session).optional()?)
    }

    /// **Soft-delete:** oturumu cop kutusuna at (`deleted_at = now_ms`; epoch **ms**). Mesajlara
    /// DOKUNMAZ → [`restore_chat_session`](Self::restore_chat_session) tam geri getirir. Yalniz
    /// AKTIF olan (`deleted_at IS NULL`) etkilenir → **idempotent** (zaten cop'te olanin damgasi
    /// degismez). Yok-olan id → no-op (0 satir). Kalici silme: [`purge_chat_session`].
    /// **Sahiplik (v31):** `AND user_id = ?` → baskasinin oturumu **no-op** (0 satir), hata degil
    /// — "yetkin yok" demek o id'nin var oldugunu sizdirirdi (yok-olan id ile ayni davranis).
    pub fn delete_chat_session(&self, user_id: i64, id: &str) -> Result<(), DbError> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE chat_sessions SET deleted_at = ?1
             WHERE id = ?2 AND user_id = ?3 AND deleted_at IS NULL",
            params![now, id, user_id],
        )?;
        Ok(())
    }

    /// **Restore:** oturumu cop kutusundan geri al (`deleted_at = NULL` → yeniden aktif). Yalniz
    /// cop'te olan (`deleted_at IS NOT NULL`) etkilenir. Yok-olan/zaten-aktif id → no-op (0 satir).
    /// **Sahiplik (v31):** baskasinin oturumu no-op (bkz [`delete_chat_session`]).
    pub fn restore_chat_session(&self, user_id: i64, id: &str) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE chat_sessions SET deleted_at = NULL
             WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NOT NULL",
            params![id, user_id],
        )?;
        Ok(())
    }

    /// **Purge:** oturumu KALICI sil (geri-alinamaz). Gercek `DELETE FROM chat_sessions` → mesajlar
    /// FK CASCADE (pragma ON) ile OTOMATIK gider (yetim mesaj imkansiz). Cop'te olsun ya da olmasin
    /// id'ye gore siler (komut katmani UI onayiyla cagirir). Yok-olan id → no-op.
    /// **Sahiplik (v31):** `AND user_id = ?` → baskasinin oturumunu KALICI silmek imkansiz
    /// (eskiden mumkundu — bkz migration 0031 gerekcesi). Yabanci id → no-op.
    pub fn purge_chat_session(&self, user_id: i64, id: &str) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM chat_sessions WHERE id = ?1 AND user_id = ?2",
            params![id, user_id],
        )?;
        Ok(())
    }

    /// Cop kutusundaki oturumlar (`deleted_at IS NOT NULL`), **en son atilan ilk** (deleted_at
    /// DESC; esitte rowid DESC → kararli). [`list_chat_sessions`] ile AYNI sutun/donus sekli
    /// (`ChatSession`) — cop gorunumu / TrashModal verisi.
    /// **Yalniz `user_id`'nin KENDI cop'u** (v31).
    pub fn list_trashed_chat_sessions(
        &self,
        user_id: i64,
    ) -> Result<Vec<ChatSession>, DbError> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {SESSION_COLUMNS}
             FROM chat_sessions
             WHERE deleted_at IS NOT NULL AND user_id = ?1
             ORDER BY deleted_at DESC, rowid DESC"
        ))?;
        let rows = stmt
            .query_map(params![user_id], map_session)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Cop kutusundaki oturum sayisi — **yalniz `user_id`'nin kendi cop'u** (v31). Rozet baskasinin
    /// sildigi sohbetle sismez (eskiden siserdi).
    pub fn chat_trash_count(&self, user_id: i64) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM chat_sessions WHERE deleted_at IS NOT NULL AND user_id = ?1",
            params![user_id],
            |r| r.get(0),
        )?)
    }

    /// Oturum basligini degistir + `updated_at`'i tazele (liste DESC'te one gelir). Yok-olan id
    /// → no-op (0 satir). **Guard `AND deleted_at IS NULL`:** cop'teki oturum yeniden adlandirilmaz
    /// (hayalet aktivite yok — cop'te olan aktif listeye geri sizmaz).
    /// **Sahiplik (v31):** baskasinin oturumu no-op (bkz [`delete_chat_session`]).
    pub fn rename_chat_session(
        &self,
        user_id: i64,
        id: &str,
        title: &str,
    ) -> Result<(), DbError> {
        let now = now_ms();
        self.conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = ?2
             WHERE id = ?3 AND user_id = ?4 AND deleted_at IS NULL",
            params![title, now, id, user_id],
        )?;
        Ok(())
    }

    /// Mesaj ekle + oturumun `updated_at`'ini tazele — **tek TX** (atomik; ya ikisi de ya hicbiri).
    /// `id = cm_<nowms>_<seq>`. Var-olmayan `session_id` → FK ihlali (yetim mesaj yazilmaz). Olusan
    /// mesaji doner.
    ///
    /// **Sahiplik (v31) — burada no-op YETMEZ, hata sart:** on-kontrol artik `AND user_id = ?` ile
    /// kosar. Baskasinin oturumu icin sessiz no-op mesaji KAYBEDERDI (cagiran yazildi sanardi);
    /// ayrica FK yalniz "satir var mi" bakar → sahiplik suzgeci olmadan yabanci bir oturuma mesaj
    /// EKLENIRDI. Bu yuzden eksik-id ve yabanci-id AYNI hatayi doner ("oturum bulunamadi") →
    /// varlik bilgisi sizmaz.
    // v31'de `user_id` eklenince 7 → 8 argüman oldu. Parametreleri bir struct'a sarmak yerine
    // duz birakildi (mevcut `ingest_folder`/`rag_chat` deseni): hepsi chat_messages'in KENDI
    // sutunlari, cagiran tek yerde (komut katmani) ve struct ara-katmani sozlesmeyi degistirmeden
    // yalnizca dolayli hale getirirdi.
    #[allow(clippy::too_many_arguments)]
    pub fn append_chat_message(
        &mut self,
        user_id: i64,
        session_id: &str,
        role: &str,
        content: &str,
        citations_json: Option<&str>,
        tokens_in: Option<i64>,
        tokens_out: Option<i64>,
    ) -> Result<ChatMessage, DbError> {
        let now = now_ms();
        let id = gen_id("cm", now);
        let tx = self.conn.transaction()?;
        // Guard: (a) oturum CAGIRANA ait ve VAR mi, (b) cop'te mi. Cop'teki oturuma yazma
        // "hayalet aktivite" olurdu → reddedilir.
        let owned_deleted: Option<Option<i64>> = tx
            .query_row(
                "SELECT deleted_at FROM chat_sessions WHERE id = ?1 AND user_id = ?2",
                params![session_id, user_id],
                |r| r.get(0),
            )
            .optional()?;
        match owned_deleted {
            // Yok VEYA baskasinin → ayni mesaj (varlik sizdirmaz).
            None => {
                return Err(DbError::Invalid(format!("oturum bulunamadi: {session_id}")));
            }
            Some(Some(_)) => {
                return Err(DbError::Invalid(format!(
                    "silinmis (cop'teki) oturuma mesaj eklenemez: {session_id}"
                )));
            }
            Some(None) => {}
        }
        tx.execute(
            "INSERT INTO chat_messages
               (id, session_id, role, content, citations_json, tokens_in, tokens_out, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![id, session_id, role, content, citations_json, tokens_in, tokens_out, now],
        )?;
        // `AND deleted_at IS NULL` + `user_id` guard: savunma-derinligi (yukaridaki on-kontrol
        // zaten sahiplik+aktiflik garantiler → burada pratikte hep eslesir).
        tx.execute(
            "UPDATE chat_sessions SET updated_at = ?1
             WHERE id = ?2 AND user_id = ?3 AND deleted_at IS NULL",
            params![now, session_id, user_id],
        )?;
        tx.commit()?;
        Ok(ChatMessage {
            id,
            session_id: session_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            citations_json: citations_json.map(str::to_string),
            tokens_in,
            tokens_out,
            created_at: now,
        })
    }

    /// Bir oturumun mesajlarini **eskiden yeniye** (created_at ASC) listele. Esit created_at'ta
    /// `rowid ASC` (ekleme sirasi) ile kararli.
    ///
    /// **Sahiplik (v31):** mesajlar oturumun altindadir → `EXISTS` ile oturum sahibi dogrulanir.
    /// Baskasinin oturumu icin **bos liste** (yok-olan id ile ayni; varlik sizmaz).
    pub fn list_chat_messages(
        &self,
        user_id: i64,
        session_id: &str,
    ) -> Result<Vec<ChatMessage>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT m.id, m.session_id, m.role, m.content, m.citations_json,
                    m.tokens_in, m.tokens_out, m.created_at
             FROM chat_messages m
             WHERE m.session_id = ?1
               AND EXISTS (SELECT 1 FROM chat_sessions s
                           WHERE s.id = m.session_id AND s.user_id = ?2)
             ORDER BY m.created_at ASC, m.rowid ASC",
        )?;
        let rows = stmt
            .query_map(params![session_id, user_id], map_message)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}
