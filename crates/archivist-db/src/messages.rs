//! Ana admin'e tek yonlu yerel oneriler.
//!
//! Mesajlar ayni yerel veritabanindaki kullanicilar arasindadir; LAN'a cikarilmaz ve
//! yanit/konu modeli yoktur. Alici istemci tarafindan secilmez: DB'deki tek founder
//! kullanici otomatik hedef olur. Okuma kaydi ayri message_reads tablosundadir; bu,
//! ileride ana admin devrinde ortak bir read_at alaninin yanlis paylasilmasini onler.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, OptionalExtension, Row};

use crate::error::DbError;
use crate::Db;

/// Tek bir onerinin izin verilen en uzun metni (Unicode karakter sayisi).
pub const USER_MESSAGE_MAX_BODY_CHARS: usize = 2_000;

/// Ana admin gelen kutusunda ve gonderim sonucunda kullanilan mesaj satiri.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserMessage {
    pub id: i64,
    /// Gonderen sonradan silinirse NULL olur; gonderim-anindaki ad her zaman korunur.
    pub sender_id: Option<i64>,
    pub sender_username: String,
    pub recipient_id: i64,
    pub body: String,
    /// Unix saniye.
    pub created_at: i64,
    /// Yalniz alici icin message_reads'ten gelen okuma zamani.
    pub read_at: Option<i64>,
    /// Ana admin "tamamlandi" dediyse zamani ve yapan kullanici.
    pub resolved_at: Option<i64>,
    pub resolved_by: Option<i64>,
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn validate_body(body: &str) -> Result<&str, DbError> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(DbError::Invalid("message_body_required".into()));
    }
    if trimmed.chars().count() > USER_MESSAGE_MAX_BODY_CHARS {
        return Err(DbError::Invalid("message_body_too_long".into()));
    }
    Ok(trimmed)
}

fn map_user_message(row: &Row) -> rusqlite::Result<UserMessage> {
    Ok(UserMessage {
        id: row.get(0)?,
        sender_id: row.get(1)?,
        sender_username: row.get(2)?,
        recipient_id: row.get(3)?,
        body: row.get(4)?,
        created_at: row.get(5)?,
        read_at: row.get(6)?,
        resolved_at: row.get(7)?,
        resolved_by: row.get(8)?,
    })
}

impl Db {
    /// Tekil ana admin kullanicisinin kimligi. Eski bir arşiv bozuk/eksik işaretle
    /// açılırsa sessizce rastgele bir alıcı seçmek yerine açık hata döner.
    pub fn founder_id(&self) -> Result<i64, DbError> {
        self.conn
            .query_row(
                "SELECT id FROM users WHERE is_founder = 1 AND role = 'admin'",
                [],
                |row| row.get(0),
            )
            .optional()?
            .ok_or_else(|| DbError::Invalid("founder_not_configured".into()))
    }

    /// Oturumdaki kullanicinin ana admin'e onerisi. Alici parametresi yoktur ve
    /// degistirilemez; sender_username gonderim aninda snapshot olarak yazilir.
    pub fn send_user_message(
        &self,
        sender_id: i64,
        sender_username: &str,
        body: &str,
    ) -> Result<UserMessage, DbError> {
        let body = validate_body(body)?;
        let recipient_id = self.founder_id()?;
        if sender_id == recipient_id {
            return Err(DbError::Invalid("message_self_send".into()));
        }
        let now = now_secs();
        self.conn.execute(
            "INSERT INTO user_messages
               (sender_id, sender_username, recipient_id, body, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![sender_id, sender_username, recipient_id, body, now],
        )?;
        Ok(UserMessage {
            id: self.conn.last_insert_rowid(),
            sender_id: Some(sender_id),
            sender_username: sender_username.to_string(),
            recipient_id,
            body: body.to_string(),
            created_at: now,
            read_at: None,
            resolved_at: None,
            resolved_by: None,
        })
    }

    /// Ana adminin gelen kutusu, yeniler önce. read_at yalnız ilgili alıcının
    /// message_reads satırından gelir; başka bir kullanıcının okuması görünmez.
    /// Önceki sürümün yanlışlıkla oluşturmuş olabileceği kendine-gönderilmiş kayıtlar
    /// görünmez; yeni gönderim yolu bunları zaten reddeder.
    pub fn list_received_user_messages(
        &self,
        recipient_id: i64,
        limit: i64,
    ) -> Result<Vec<UserMessage>, DbError> {
        let limit = limit.clamp(1, 200);
        let mut statement = self.conn.prepare(
            "SELECT m.id, m.sender_id, m.sender_username, m.recipient_id, m.body, m.created_at,
                    r.read_at, m.resolved_at, m.resolved_by
             FROM user_messages AS m
             LEFT JOIN message_reads AS r
               ON r.message_id = m.id AND r.user_id = m.recipient_id
             WHERE m.recipient_id = ?1
               AND (m.sender_id IS NULL OR m.sender_id != m.recipient_id)
             ORDER BY m.created_at DESC, m.id DESC
             LIMIT ?2",
        )?;
        let messages = statement
            .query_map(params![recipient_id, limit], map_user_message)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(DbError::from)?;
        Ok(messages)
    }

    /// Ana adminin kendi gelen kutusundaki mesaji okundu isaretle. Baska kullanicinin
    /// mesajini veya olmayan kaydi sessizce basarili saymaz.
    pub fn mark_user_message_read(&self, message_id: i64, reader_id: i64) -> Result<(), DbError> {
        let is_recipient: bool = self
            .conn
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM user_messages WHERE id = ?1 AND recipient_id = ?2
                 )",
                params![message_id, reader_id],
                |row| row.get(0),
            )?;
        if !is_recipient {
            return Err(DbError::Invalid("message_not_found".into()));
        }
        self.conn.execute(
            "INSERT INTO message_reads(message_id, user_id, read_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(message_id, user_id) DO NOTHING",
            params![message_id, reader_id, now_secs()],
        )?;
        Ok(())
    }

    /// Ana admin gelen kutusundaki oneriyi tamamlandi olarak kapatir. Yalnız alıcı
    /// kapatabilir; resolved_at/resolved_by birlikte güncellenir.
    pub fn resolve_user_message(&self, message_id: i64, actor_id: i64) -> Result<(), DbError> {
        let changed = self.conn.execute(
            "UPDATE user_messages
             SET resolved_at = ?1, resolved_by = ?2
             WHERE id = ?3 AND recipient_id = ?2 AND resolved_at IS NULL",
            params![now_secs(), actor_id, message_id],
        )?;
        if changed == 0 {
            let exists_for_recipient: bool = self
                .conn
                .query_row(
                    "SELECT EXISTS(
                        SELECT 1 FROM user_messages WHERE id = ?1 AND recipient_id = ?2
                     )",
                    params![message_id, actor_id],
                    |row| row.get(0),
                )?;
            if !exists_for_recipient {
                return Err(DbError::Invalid("message_not_found".into()));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (Db, i64, i64) {
        let mut db = Db::open_in_memory_migrated().unwrap();
        let founder = db
            .create_founder_user("ana", "admin", "ana-parola", false)
            .unwrap();
        let sender = db.create_user("deniz", "viewer", "deniz-parola", false).unwrap();
        (db, founder, sender)
    }

    #[test]
    fn sends_only_to_founder_and_keeps_sender_snapshot() {
        let (db, founder, sender) = setup();
        let created = db
            .send_user_message(sender, "Deniz", "  Katalog filtresi ekleyelim.  ")
            .unwrap();
        assert_eq!(created.recipient_id, founder);
        assert_eq!(created.body, "Katalog filtresi ekleyelim.");

        let inbox = db.list_received_user_messages(founder, 20).unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].sender_username, "Deniz");
        assert_eq!(inbox[0].read_at, None);
        assert_eq!(inbox[0].resolved_at, None);
    }

    #[test]
    fn body_is_required_and_bounded() {
        let (db, _, sender) = setup();
        assert!(matches!(
            db.send_user_message(sender, "Deniz", "   "),
            Err(DbError::Invalid(code)) if code == "message_body_required"
        ));
        let too_long = "x".repeat(USER_MESSAGE_MAX_BODY_CHARS + 1);
        assert!(matches!(
            db.send_user_message(sender, "Deniz", &too_long),
            Err(DbError::Invalid(code)) if code == "message_body_too_long"
        ));
    }

    #[test]
    fn founder_cannot_send_a_message_to_themself() {
        let (db, founder, _) = setup();
        assert!(matches!(
            db.send_user_message(founder, "Ana", "Kendime yazamam"),
            Err(DbError::Invalid(code)) if code == "message_self_send"
        ));
    }

    #[test]
    fn legacy_self_sent_messages_are_hidden_from_founder_inbox() {
        let (db, founder, _) = setup();
        db.conn
            .execute(
                "INSERT INTO user_messages
                   (sender_id, sender_username, recipient_id, body, created_at)
                 VALUES (?1, 'Ana', ?1, 'Eski test mesaji', 1)",
                params![founder],
            )
            .unwrap();
        assert!(db.list_received_user_messages(founder, 20).unwrap().is_empty());
    }

    #[test]
    fn only_recipient_can_read_or_resolve() {
        let (db, founder, sender) = setup();
        let message = db.send_user_message(sender, "Deniz", "Bunu inceleyelim").unwrap();

        assert!(matches!(
            db.mark_user_message_read(message.id, sender),
            Err(DbError::Invalid(code)) if code == "message_not_found"
        ));
        db.mark_user_message_read(message.id, founder).unwrap();
        db.resolve_user_message(message.id, founder).unwrap();

        let inbox = db.list_received_user_messages(founder, 20).unwrap();
        assert!(inbox[0].read_at.is_some());
        assert!(inbox[0].resolved_at.is_some());
        assert_eq!(inbox[0].resolved_by, Some(founder));
    }

    #[test]
    fn sender_deletion_keeps_message_and_name() {
        let (mut db, founder, sender) = setup();
        db.send_user_message(sender, "Deniz", "Silinse de kalsin").unwrap();
        db.delete_user(sender).unwrap();

        let inbox = db.list_received_user_messages(founder, 20).unwrap();
        assert_eq!(inbox[0].sender_id, None);
        assert_eq!(inbox[0].sender_username, "Deniz");
    }
}
