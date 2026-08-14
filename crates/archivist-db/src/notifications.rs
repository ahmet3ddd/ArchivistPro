//! LAN bildirimleri CRUD (host-otoriter S1-S2 MVP; `0025_notifications`).
//!
//! Host bildirim uretir (`add_notification`); istemciler `GET /notifications?since=<id>` ile poll
//! eder. `list_since` **baglanti-duzeyi** serbest fonksiyondur: `archivist-server` sunucu thread'i
//! DB'yi sahiplenmez → src-tauri'nin actigi kendi read-baglantisiyla bunu cagirir. `Db` metotlari
//! (AppState.db uzerinden) ekleme + yerel gorunum saglar.
//!
//! Poll imleci = `id` (kesin artan); created_at (epoch ms) yalniz goruntu/siralama.

use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Row};

use crate::error::DbError;
use crate::Db;

/// Tek bir bildirim satiri.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationRow {
    pub id: i64,
    /// epoch ms (goruntu/siralama; poll imleci DEGIL — imlec `id`).
    pub created_at: i64,
    /// 'info' | 'index' | 'project' ... (db yorumlamaz).
    pub kind: String,
    pub title: String,
    pub body: Option<String>,
}

fn map_row(r: &Row) -> rusqlite::Result<NotificationRow> {
    Ok(NotificationRow {
        id: r.get(0)?,
        created_at: r.get(1)?,
        kind: r.get(2)?,
        title: r.get(3)?,
        body: r.get(4)?,
    })
}

/// `since_id` SONRASI bildirimleri artan id ile getir (poll). Baglanti-duzeyi → sunucu thread'i
/// kendi read-baglantisiyla cagirir. `limit <= 0` -> 500.
pub fn list_since(
    conn: &Connection,
    since_id: i64,
    limit: i64,
) -> Result<Vec<NotificationRow>, DbError> {
    let lim = if limit <= 0 { 500 } else { limit };
    let mut stmt = conn.prepare(
        "SELECT id, created_at, kind, title, body FROM notifications
         WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
    )?;
    let rows =
        stmt.query_map(params![since_id, lim], map_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Su anki zaman (unix epoch **ms**) — H3 konvansiyonu (chat.rs now_ms ile ayni).
fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl Db {
    /// Bildirim ekle (host uretir). `created_at = now_ms` bu katmanda uretilir (tek dogruluk
    /// kaynagi; SQL DEFAULT yok). Olusan `id` doner (poll imleci degeri).
    pub fn add_notification(
        &self,
        kind: &str,
        title: &str,
        body: Option<&str>,
    ) -> Result<i64, DbError> {
        let now = now_ms();
        self.conn.execute(
            "INSERT INTO notifications (created_at, kind, title, body) VALUES (?1, ?2, ?3, ?4)",
            params![now, kind, title, body],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// `since_id` imlecinden yeni bildirimler (yerel gorunum/test). Sunucu bunun yerine
    /// [`list_since`]'i kendi read-baglantisiyla cagirir.
    pub fn notifications_since(
        &self,
        since_id: i64,
        limit: i64,
    ) -> Result<Vec<NotificationRow>, DbError> {
        list_since(&self.conn, since_id, limit)
    }

    /// Tum yerel LAN bildirimlerini temizler. Donen deger silinen satir sayisidir.
    pub fn clear_notifications(&self) -> Result<usize, DbError> {
        Ok(self.conn.execute("DELETE FROM notifications", [])?)
    }
}
