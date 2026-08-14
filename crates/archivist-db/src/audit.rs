//! #8 Genel eylem audit'i (H2 pariti §A) — KIM / NE / NE ZAMAN / NEYE. RBAC tamamlayicisi.
//!
//! Append-only iz (migration 0013): yazma/yikici eylemler kaydedilir. Aktor alanlari
//! (username/role) eylem anindaki SNAPSHOT'tur (`users`'a FK YOK → kullanici silinse de iz
//! dogru kalir). `record_audit` tek INSERT; cagiran (Tauri komutu) bunu **best-effort** yapar
//! — audit yazimi asil islemi BLOKLAMAZ (hatasi komut katmaninda ele alinir/loglanir).
//! Sorgu: `list_audit` (en yeni-once, sayfali) + `audit_count`.

use crate::error::DbError;
use crate::Db;

/// Bir audit kaydi GIRDISI (yazim). Aktor alanlari oturumdan (rbac::Session) snapshot'lanir.
pub struct AuditInput<'a> {
    /// Eylem zamani (unix saniye). Cagiran verir (test'te sabit; uretimde gercek saat) →
    /// veri katmani saat tutmaz (deterministik test + tek dogruluk: komut katmani).
    pub ts: i64,
    /// Aktor kullanici id (0 = sistem/oturumsuz).
    pub user_id: i64,
    pub username: &'a str,
    pub role: &'a str,
    /// Ne yapildi — kararli kisa anahtar (or. "ingest", "trash", "reset", "user_create").
    pub action: &'a str,
    pub target_type: Option<&'a str>,
    pub target_id: Option<&'a str>,
    pub detail: Option<&'a str>,
}

/// Bir audit kaydi (okuma) — log viewer satiri.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuditRow {
    pub id: i64,
    pub ts: i64,
    pub user_id: i64,
    pub username: String,
    pub role: String,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub detail: Option<String>,
}

impl Db {
    /// Bir eylemi audit iz'ine yaz (append-only). Eklenen kaydin id'sini doner. Tek INSERT
    /// (rusqlite otomatik TX'i). `&self` yeter (transaction gerekmez) → komut katmani write'tan
    /// SONRA, ayni kilit altinda cagirir.
    pub fn record_audit(&self, a: &AuditInput) -> Result<i64, DbError> {
        self.conn.execute(
            "INSERT INTO audit_log
                (ts, user_id, username, role, action, target_type, target_id, detail)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                a.ts,
                a.user_id,
                a.username,
                a.role,
                a.action,
                a.target_type,
                a.target_id,
                a.detail,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Audit iz'ini SAKLAMA SURESINE gore buda — `cutoff_ts`'ten ESKI kayitlar silinir.
    /// Silinen satir sayisini doner.
    ///
    /// NEDEN VAR (2026-07-18 H2-gerileme taramasi bulgusu): H3'te audit tablosu **omur boyu
    /// buyuyordu** — `record_audit` yalniz yaziyordu, hicbir budama yoktu. Sik yazma eylemleri
    /// (ingest / proje-durumu / cop / koleksiyon) kaydedildigi icin DB ve her snapshot/yedek
    /// zamanla sisiyordu; kullanicinin temizleyecek bir araci da yoktu.
    /// ⚠️ Bunun bir GOZDEN KACMA oldugunun kaniti: "saklama" kavrami H3'te ZATEN vardi —
    /// `scan_reports.rs` (50 kayit) ve `undo.rs` (50 kayit) buduyor, audit atlanmisti.
    /// H2 karsiligi: `SettingsSecurityTab.tsx:49-55` `audit_retention_days` **varsayilan 90**
    /// + acilista `clearAuditLogsBefore(cutoff)`.
    ///
    /// SAYIYA degil TARIHE gore budanir (scan_reports/undo'dan farkli, bilerek): denetim izinin
    /// degeri "son N kayit" degil "son N gun" — yogun bir tarama gunu, aylar oncesinin
    /// guvenlik kayitlarini silmemeli.
    pub fn prune_audit_before(&self, cutoff_ts: i64) -> Result<usize, DbError> {
        let n = self.conn.execute("DELETE FROM audit_log WHERE ts < ?1", rusqlite::params![cutoff_ts])?;
        Ok(n)
    }

    /// Audit kayitlari **en yeni once** (ts azalan, esitlikte id azalan), sayfali (log viewer).
    /// `limit <= 0` → bos (savunma). `offset` negatifse 0'a kelepcelenir.
    pub fn list_audit(&self, limit: i64, offset: i64) -> Result<Vec<AuditRow>, DbError> {
        if limit <= 0 {
            return Ok(Vec::new());
        }
        let mut stmt = self.conn.prepare(
            "SELECT id, ts, user_id, username, role, action, target_type, target_id, detail
             FROM audit_log
             ORDER BY ts DESC, id DESC
             LIMIT ?1 OFFSET ?2",
        )?;
        let rows = stmt
            .query_map(rusqlite::params![limit, offset.max(0)], |r| {
                Ok(AuditRow {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    user_id: r.get(2)?,
                    username: r.get(3)?,
                    role: r.get(4)?,
                    action: r.get(5)?,
                    target_type: r.get(6)?,
                    target_id: r.get(7)?,
                    detail: r.get(8)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Toplam audit kaydi sayisi (log viewer sayfalama / rozet).
    pub fn audit_count(&self) -> Result<i64, DbError> {
        Ok(self
            .conn
            .query_row("SELECT count(*) FROM audit_log", [], |r| r.get(0))?)
    }
}
