//! İngest yazma API'si — asset upsert + FTS body + metadata (EAV) + auto-tag + phash.
//!
//! Tek-motor sahipligi (ARCHITECTURE §1): DB'yi yalniz Rust yazar. Bu modul tipli,
//! transactional yazma primitifleri sunar; orkestrasyon (`archivist-ingest`) bunlari
//! cagirir. db, `archivist-extract`'a bagimli DEGIL — kendi girdi tiplerini tanimlar.

use rusqlite::{params, params_from_iter, types::Value, OptionalExtension};

use crate::error::DbError;
use crate::Db;

/// Bir asset satirinin cekirdek alanlari (dosya sisteminden + extractor terfisi).
pub struct AssetInput<'a> {
    /// Mutlak yol (tek dogruluk anahtari, UNIQUE).
    pub path: &'a str,
    pub file_name: &'a str,
    pub ext: Option<&'a str>,
    pub size_bytes: i64,
    /// İcerik fixity (BLAKE3 hex) — dedup/degisiklik tespiti.
    pub content_hash: Option<&'a str>,
    pub mime: Option<&'a str>,
    pub title: Option<&'a str>,
    pub description: Option<&'a str>,
    pub created_at: i64,
    pub modified_at: i64,
}

/// Tek bir metadata degeri — metin veya sayisal (aralik sorgusu icin ayri sutun).
pub enum MetaVal {
    Text(String),
    Num(f64),
}

/// Kucuk resim girdisi (kodlanmis baytlar + MIME + boyut).
pub struct ThumbnailInput<'a> {
    pub mime: &'a str,
    pub width: i64,
    pub height: i64,
    pub bytes: &'a [u8],
}

/// Bir asset'e yazilacak cikarim verisi.
pub struct IngestData<'a> {
    /// FTS `body` (tam metin). `None`/bos → body temizlenir.
    pub fts_body: Option<&'a str>,
    /// Format'a ozgu metadata (key → deger).
    pub metadata: &'a [(String, MetaVal)],
    /// Otomatik etiketler (kind='auto').
    pub auto_tags: &'a [String],
    /// Algisal hash (u64 bit-deseni i64 olarak). `None` = yok.
    pub phash: Option<i64>,
    /// Kucuk resim (varsa). `None` → varsa eski thumbnail silinir.
    pub thumbnail: Option<ThumbnailInput<'a>>,
}

/// Proje-durum alanlari (H2 pariti) — kullanici-tanimli, hepsi opsiyonel. İngest
/// bunlara DOKUNMAZ (re-ingest korur). `approval_status`: draft|review|approved|
/// rejected (None=ayarlanmamis). `set_project_meta` ile yazilir.
#[derive(Debug, Clone, Default)]
pub struct ProjectMeta {
    pub client_name: Option<String>,
    pub approval_status: Option<String>,
    pub rejection_reason: Option<String>,
    pub version_label: Option<String>,
    pub deadline: Option<String>,
}

/// TOPLU proje-durum yamasi — her alan **uc-durumlu**: `None` = DOKUNMA (UPDATE'e girmez);
/// `Some(None)` = NULL yaz (temizle); `Some(Some(v))` = deger yaz. Tek-asset `ProjectMeta`
/// 5 kolonu **full-replace** ederken (mevcut degerler formda gorunur), toplu modda per-asset
/// degerler gosterilemez → yalniz KULLANICININ isaretledigi alanlar yazilir; isaretlenmeyen
/// korunur (clobber yok). `bulk_update_project_meta` ile yazilir.
#[derive(Debug, Clone, Default)]
pub struct ProjectMetaPatch {
    pub client_name: Option<Option<String>>,
    pub approval_status: Option<Option<String>>,
    pub rejection_reason: Option<Option<String>>,
    pub version_label: Option<Option<String>>,
    pub deadline: Option<Option<String>>,
}

/// Bir asset'in mevcut parmak izi — artimsal "degismis mi?" kontrolu.
pub struct Fingerprint {
    pub size_bytes: i64,
    pub modified_at: i64,
    pub content_hash: Option<String>,
    /// `indexed_at` dolu mu (en az bir kez indekslendi mi)?
    pub indexed: bool,
}

impl Db {
    /// Bir asset'i (yol UNIQUE) upsert et + FTS body + metadata + auto-tag + phash yaz —
    /// **TEK transaction**. Var olan asset guncellenir (re-ingest); olusturulan/guncellenen
    /// asset'in id'si doner. `indexed_at = now`.
    ///
    /// Kullanici etiketleri (kind!='auto') korunur — yalniz bu asset'in auto-tag'leri
    /// yenilenir. `created_at` ilk insert'te yazilir, re-ingest'te DEGISMEZ.
    pub fn ingest(&mut self, asset: &AssetInput, data: &IngestData) -> Result<i64, DbError> {
        let tx = self.conn.transaction()?;

        // 1. Asset upsert. FTS satiri assets trigger'lari ile senkronlanir (body HARIC).
        tx.execute(
            "INSERT INTO assets
                 (path, file_name, ext, size_bytes, content_hash, mime, title, description,
                  created_at, modified_at, indexed_at, phash)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10, strftime('%s','now'), ?11)
             ON CONFLICT(path) DO UPDATE SET
                 file_name    = excluded.file_name,
                 ext          = excluded.ext,
                 size_bytes   = excluded.size_bytes,
                 content_hash = excluded.content_hash,
                 mime         = excluded.mime,
                 title        = excluded.title,
                 description  = excluded.description,
                 modified_at  = excluded.modified_at,
                 indexed_at   = excluded.indexed_at,
                 phash        = excluded.phash",
            params![
                asset.path,
                asset.file_name,
                asset.ext,
                asset.size_bytes,
                asset.content_hash,
                asset.mime,
                asset.title,
                asset.description,
                asset.created_at,
                asset.modified_at,
                data.phash,
            ],
        )?;
        let id: i64 =
            tx.query_row("SELECT id FROM assets WHERE path = ?1", params![asset.path], |r| {
                r.get(0)
            })?;

        // 2. FTS body — trigger'lar body'yi BOS birakir; acik guncelleme sart.
        tx.execute(
            "UPDATE assets_fts SET body = ?1 WHERE asset_id = ?2",
            params![data.fts_body.unwrap_or(""), id],
        )?;

        // 3. Metadata (EAV) — replace (re-ingest temiz). `ai_*` (AI vision-analizi) KORUNUR:
        // extractor'dan gelmez, ayri admin job uretir → re-index onu silmemeli (rag_excluded deseni).
        tx.execute(
            r"DELETE FROM asset_metadata WHERE asset_id = ?1 AND key NOT LIKE 'ai\_%' ESCAPE '\'",
            params![id],
        )?;
        {
            let mut ins = tx.prepare(
                "INSERT INTO asset_metadata(asset_id, key, value_text, value_num)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for (key, val) in data.metadata {
                let (vt, vn): (Option<&str>, Option<f64>) = match val {
                    MetaVal::Text(s) => (Some(s.as_str()), None),
                    MetaVal::Num(n) => (None, Some(*n)),
                };
                ins.execute(params![id, key, vt, vn])?;
            }
        }

        // 4. Auto-tag'ler — yalniz bu asset'in auto-tag'lerini yenile (user tag korunur).
        tx.execute(
            "DELETE FROM asset_tags WHERE asset_id = ?1
               AND tag_id IN (SELECT id FROM tags WHERE kind = 'auto')",
            params![id],
        )?;
        {
            let mut ins_tag =
                tx.prepare("INSERT OR IGNORE INTO tags(name, kind) VALUES (?1, 'auto')")?;
            let mut link = tx.prepare(
                "INSERT OR IGNORE INTO asset_tags(asset_id, tag_id)
                 SELECT ?1, id FROM tags WHERE name = ?2",
            )?;
            for tag in data.auto_tags {
                ins_tag.execute(params![tag])?;
                link.execute(params![id, tag])?;
            }
        }

        // 5. Thumbnail — replace (re-ingest temiz).
        tx.execute("DELETE FROM asset_thumbnails WHERE asset_id = ?1", params![id])?;
        if let Some(thumb) = &data.thumbnail {
            tx.execute(
                "INSERT INTO asset_thumbnails(asset_id, mime, width, height, bytes)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![id, thumb.mime, thumb.width, thumb.height, thumb.bytes],
            )?;
        }

        tx.commit()?;
        Ok(id)
    }

    /// Bir yol icin mevcut parmak izi (yoksa `None`) — artimsal atlama karari icin.
    pub fn asset_fingerprint(&self, path: &str) -> Result<Option<Fingerprint>, DbError> {
        let row = self
            .conn
            .query_row(
                "SELECT size_bytes, modified_at, content_hash, indexed_at
                 FROM assets WHERE path = ?1",
                params![path],
                |r| {
                    Ok(Fingerprint {
                        size_bytes: r.get(0)?,
                        modified_at: r.get(1)?,
                        content_hash: r.get(2)?,
                        indexed: r.get::<_, Option<i64>>(3)?.is_some(),
                    })
                },
            )
            .optional()?;
        Ok(row)
    }

    /// Bir kok on-eki altindaki AKTIF asset'lerin parmak izi (yol → [`Fingerprint`]) — TEK sorgu.
    /// **Paralel ingest ON-CEK'i:** worker'lar her dosya icin db'ye gitmeden skip-unchanged karari
    /// verir (SQLite tek-baglanti → es-zamanli okuma yok). `active_paths_under` ile ayni escape deseni
    /// (`%`/`_`/`\` kacisli → Windows yol-ayraci yanlis eslesmez).
    pub fn fingerprints_under(
        &self,
        prefix: &str,
    ) -> Result<std::collections::HashMap<String, Fingerprint>, DbError> {
        let pattern = crate::query::escape_like_prefix(Some(prefix)).unwrap_or_default();
        let mut stmt = self.conn.prepare(
            "SELECT path, size_bytes, modified_at, content_hash, indexed_at
             FROM assets WHERE deleted_at IS NULL AND path LIKE ?1 || '%' ESCAPE '\\'",
        )?;
        let rows = stmt.query_map([pattern], |r| {
            Ok((
                r.get::<_, String>(0)?,
                Fingerprint {
                    size_bytes: r.get(1)?,
                    modified_at: r.get(2)?,
                    content_hash: r.get(3)?,
                    indexed: r.get::<_, Option<i64>>(4)?.is_some(),
                },
            ))
        })?;
        let mut map = std::collections::HashMap::new();
        for row in rows {
            let (p, f) = row?;
            map.insert(p, f);
        }
        Ok(map)
    }

    // ── Kullanici kurasyonu (Faz 4.3): etiket + favori ───────────────────────

    /// Bir asset'e **kullanici** etiketi ekle (kind='user'). Ad trim'lenir; bos →
    /// no-op. Idempotent (tekrarli ekleme zararsiz). Var olan auto/system tag adi
    /// ile cakisirsa mevcut kind korunur (ad UNIQUE) — yalniz bag eklenir.
    pub fn add_user_tag(&mut self, asset_id: i64, name: &str) -> Result<(), DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(());
        }
        let tx = self.conn.transaction()?;
        tx.execute("INSERT OR IGNORE INTO tags(name, kind) VALUES (?1, 'user')", params![name])?;
        tx.execute(
            "INSERT OR IGNORE INTO asset_tags(asset_id, tag_id)
             SELECT ?1, id FROM tags WHERE name = ?2",
            params![asset_id, name],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Bir asset'ten etiket bagini kaldir (tag tanimi durur). Idempotent.
    pub fn remove_tag(&self, asset_id: i64, name: &str) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM asset_tags
             WHERE asset_id = ?1 AND tag_id = (SELECT id FROM tags WHERE name = ?2)",
            params![asset_id, name.trim()],
        )?;
        Ok(())
    }

    /// Kullanici etiketini **yoksa olustur** (bagsiz). Idempotent; var olan `kind` korunur.
    /// Kullanim: etiket-silme geri-alinirken etiketin HIC asset'i yoktuysa (`add_user_tag`
    /// hic kosmaz) etiketin kendisi yine de geri gelmeli.
    pub fn ensure_user_tag(&self, name: &str) -> Result<(), DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("etiket adi bos olamaz".into()));
        }
        self.conn
            .execute("INSERT OR IGNORE INTO tags(name, kind) VALUES (?1, 'user')", params![name])?;
        Ok(())
    }

    /// **Etiketi YENIDEN ADLANDIR** (varlik duzeyinde; tum asset'lerde birden degisir).
    /// H2 `commandRenameTag` pariteli — H3'te bugune dek YOKTU (2026-07-26 davranis-sadakati
    /// turu §8: yanlis yazilmis bir etiket duzeltilemiyordu).
    ///
    /// Kurallar: yalniz `kind='user'` (auto/system turetilmis → dokunulmaz) · yeni ad bos olamaz ·
    /// **hedef ad zaten varsa REDDEDILIR** (birlestirme YAPILMAZ). Gerekce: `tags.name` UNIQUE ve
    /// sessiz birlestirme geri-alinamaz veri karisimi olurdu → kullanici once hedefi silmeli/
    /// tasimali. Ayni ad → no-op (H2: `if (oldName === newName) return`).
    pub fn rename_user_tag(&self, old: &str, new: &str) -> Result<(), DbError> {
        let (old, new) = (old.trim(), new.trim());
        if old.is_empty() || new.is_empty() {
            return Err(DbError::Invalid("etiket adi bos olamaz".into()));
        }
        if old == new {
            return Ok(());
        }
        let taken: i64 = self.conn.query_row(
            "SELECT count(*) FROM tags WHERE name = ?1",
            params![new],
            |r| r.get(0),
        )?;
        if taken > 0 {
            return Err(DbError::Invalid("bu adda bir etiket zaten var".into()));
        }
        let updated = self.conn.execute(
            "UPDATE tags SET name = ?1 WHERE name = ?2 AND kind = 'user'",
            params![new, old],
        )?;
        if updated == 0 {
            return Err(DbError::Invalid("kullanici etiketi bulunamadi".into()));
        }
        Ok(())
    }

    /// **Etiketi SIL** (varlik duzeyinde) → doner: etiketin BAGLI OLDUGU asset id'leri
    /// (silmeden ONCE okunur). H2 `commandDeleteTag` pariteli.
    ///
    /// `asset_tags` FK'si `ON DELETE CASCADE` → baglar otomatik gider (elle silme GEREKMEZ).
    /// Donen id listesi iki ise yarar: (1) komut katmani "N dosyadan kaldirildi" diyebilir,
    /// (2) **geri-al** etiketi ayni asset'lere yeniden baglayabilir (H2 `snapshotTag`/`restoreTag`).
    /// Yalniz `kind='user'`; auto/system reddedilir (turetilmis veri elle silinmez).
    pub fn delete_user_tag(&self, name: &str) -> Result<Vec<i64>, DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("etiket adi bos olamaz".into()));
        }
        let tag_id: Option<i64> = self
            .conn
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 AND kind = 'user'",
                params![name],
                |r| r.get(0),
            )
            .optional()?;
        let Some(tag_id) = tag_id else {
            return Err(DbError::Invalid("kullanici etiketi bulunamadi".into()));
        };
        let mut stmt =
            self.conn.prepare("SELECT asset_id FROM asset_tags WHERE tag_id = ?1 ORDER BY asset_id")?;
        let ids: Vec<i64> =
            stmt.query_map(params![tag_id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        drop(stmt);
        self.conn.execute("DELETE FROM tags WHERE id = ?1", params![tag_id])?;
        Ok(ids)
    }

    /// Bir etiketin rengini oku (silmeden ONCE anlik-goruntu icin; geri-al rengi de geri getirir).
    /// Etiket yoksa `Ok(None)`.
    pub fn tag_color(&self, name: &str) -> Result<Option<String>, DbError> {
        Ok(self
            .conn
            .query_row("SELECT color FROM tags WHERE name = ?1", params![name.trim()], |r| r.get(0))
            .optional()?
            .flatten())
    }

    /// Kullanici etiketinin global rozet rengini ayarlar veya temizler.
    /// Yalniz `kind='user'` etiketleri degistirilebilir; auto/system reddedilir.
    pub fn set_tag_color(&self, name: &str, color: Option<&str>) -> Result<(), DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("etiket adi bos olamaz".into()));
        }
        let color = match color {
            Some(value) => {
                let value = value.trim();
                let valid = value.len() == 7
                    && value.starts_with('#')
                    && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit);
                if !valid {
                    return Err(DbError::Invalid("etiket rengi #RRGGBB olmali".into()));
                }
                Some(value)
            }
            None => None,
        };
        let updated = self.conn.execute(
            "UPDATE tags SET color = ?1 WHERE name = ?2 AND kind = 'user'",
            params![color, name],
        )?;
        if updated == 0 {
            return Err(DbError::Invalid("kullanici etiketi bulunamadi".into()));
        }
        Ok(())
    }

    /// Favori durumunu ayarla (true=ekle, false=kaldir). Idempotent.
    pub fn set_favorite(&self, asset_id: i64, on: bool) -> Result<(), DbError> {
        if on {
            self.conn.execute(
                "INSERT OR IGNORE INTO favorites(asset_id) VALUES (?1)",
                params![asset_id],
            )?;
        } else {
            self.conn
                .execute("DELETE FROM favorites WHERE asset_id = ?1", params![asset_id])?;
        }
        Ok(())
    }

    /// Proje-durum alanlarini (H2 pariti) ayarla — 5 kolon TEK UPDATE ile yazilir.
    /// `approval_status` whitelist: None ya da {draft,review,approved,rejected} disi
    /// → `DbError::Invalid`. None'lar NULL yazilir (alani temizler). Asset yoksa
    /// (etkilenen satir 0) → `DbError::Invalid`. Bos-string normalizasyonu cagirana
    /// (komut katmani) aittir; burada None → NULL kabul edilir.
    pub fn set_project_meta(&self, asset_id: i64, meta: &ProjectMeta) -> Result<(), DbError> {
        if let Some(status) = meta.approval_status.as_deref() {
            if !matches!(status, "draft" | "review" | "approved" | "rejected") {
                return Err(DbError::Invalid(format!("gecersiz approval_status: {status}")));
            }
        }
        let affected = self.conn.execute(
            "UPDATE assets SET
                 client_name      = ?2,
                 approval_status  = ?3,
                 rejection_reason = ?4,
                 version_label    = ?5,
                 deadline         = ?6
             WHERE id = ?1",
            params![
                asset_id,
                meta.client_name,
                meta.approval_status,
                meta.rejection_reason,
                meta.version_label,
                meta.deadline,
            ],
        )?;
        if affected == 0 {
            return Err(DbError::Invalid(format!("asset bulunamadi: {asset_id}")));
        }
        Ok(())
    }

    /// Verilen id'lerin MEVCUT proje-durum alanlari (undo-yakalama: toplu yazmadan ONCE eski
    /// degerler okunur → geri-al bu degerleri geri yazar). `bulk_update_project_meta` ile ayni
    /// kapsam: cop filtresi YOK (yazma neyi hedefliyorsa yakalama da onu okur). Eksik id sonuca
    /// girmez; donus sirasi garanti degil (cagiran id ile esler). Bos → bos.
    pub fn project_meta_for(&self, ids: &[i64]) -> Result<Vec<(i64, ProjectMeta)>, DbError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ph = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, client_name, approval_status, rejection_reason, version_label, deadline
             FROM assets WHERE id IN ({ph})"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(ids), |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    ProjectMeta {
                        client_name: r.get(1)?,
                        approval_status: r.get(2)?,
                        rejection_reason: r.get(3)?,
                        version_label: r.get(4)?,
                        deadline: r.get(5)?,
                    },
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Proje-durum alanlarini bir asset KUMESINE **toplu** yaz — yalniz `patch`'te `Some` olan
    /// kolonlar TEK `UPDATE ... WHERE id IN (...)` ile guncellenir; isaretlenmemis (`None`) alanlar
    /// KORUNUR (tek-asset `set_project_meta` full-replace'inden kasitli fark). `approval_status`
    /// deger yazarken (`Some(Some(v))`) whitelist zorlanir (draft|review|approved|rejected); temizleme
    /// (`Some(None)`) muaf. Bos `ids` **veya** hicbir alan secilmemis → `Ok(0)` (no-op; SQL kosmaz).
    /// Aktif/cop filtresi YOK (tek-asset ile ayni; secim zaten aktif asset'lerden gelir). Kolon adlari
    /// sabit literal, yalniz degerler baglanir → enjeksiyon yok. Doner: guncellenen satir sayisi.
    pub fn bulk_update_project_meta(
        &self,
        ids: &[i64],
        patch: &ProjectMetaPatch,
    ) -> Result<usize, DbError> {
        if ids.is_empty() {
            return Ok(0);
        }
        // approval whitelist — yalniz deger yazarken (Some(Some)); temizleme (Some(None)) muaf.
        if let Some(Some(status)) = patch.approval_status.as_ref().map(|o| o.as_deref()) {
            if !matches!(status, "draft" | "review" | "approved" | "rejected") {
                return Err(DbError::Invalid(format!("gecersiz approval_status: {status}")));
            }
        }

        // Uc-durum → SQL degeri: Some(s) → Text; None → NULL.
        fn value_of(inner: &Option<String>) -> Value {
            inner.as_ref().map_or(Value::Null, |s| Value::Text(s.clone()))
        }
        // Yalniz `Some(_)` alanlari SET'e ekle (isaretlenmemis kolona dokunma).
        let mut set_cols: Vec<&str> = Vec::new();
        let mut vals: Vec<Value> = Vec::new();
        for (col, field) in [
            ("client_name", &patch.client_name),
            ("approval_status", &patch.approval_status),
            ("rejection_reason", &patch.rejection_reason),
            ("version_label", &patch.version_label),
            ("deadline", &patch.deadline),
        ] {
            if let Some(inner) = field {
                set_cols.push(col);
                vals.push(value_of(inner));
            }
        }
        if set_cols.is_empty() {
            return Ok(0); // hicbir alan secilmemis → no-op
        }

        let set_clause = set_cols.iter().map(|c| format!("{c} = ?")).collect::<Vec<_>>().join(", ");
        let id_ph = vec!["?"; ids.len()].join(",");
        let sql = format!("UPDATE assets SET {set_clause} WHERE id IN ({id_ph})");
        vals.extend(ids.iter().map(|&id| Value::Integer(id)));
        let n = self.conn.execute(&sql, params_from_iter(vals))?;
        Ok(n)
    }

    // ── Koleksiyonlar (Faz 4.3b): adli asset gruplari ────────────────────────

    /// Koleksiyon olustur (ad UNIQUE → **find-or-create**). Ad trim'lenir; bos →
    /// `DbError::Invalid`. Var olan ad mevcut id'yi doner (idempotent ekleme akisi).
    /// Yeni veya var olan koleksiyonun id'si doner.
    pub fn create_collection(&mut self, name: &str, color: Option<&str>) -> Result<i64, DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("koleksiyon adi bos olamaz".into()));
        }
        let tx = self.conn.transaction()?;
        tx.execute(
            "INSERT OR IGNORE INTO collections(name, color) VALUES (?1, ?2)",
            params![name, color],
        )?;
        let id: i64 =
            tx.query_row("SELECT id FROM collections WHERE name = ?1", params![name], |r| {
                r.get(0)
            })?;
        tx.commit()?;
        Ok(id)
    }

    /// Koleksiyonu sil (uyelikler CASCADE ile gider; asset'lere dokunmaz). Idempotent.
    pub fn delete_collection(&self, id: i64) -> Result<(), DbError> {
        self.conn
            .execute("DELETE FROM collections WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Koleksiyon adini degistirir. Ad trim'lenir; bos veya olmayan id Invalid hatasidir.
    /// Ad UNIQUE oldugu icin mevcut baska adla cakisma SQLite tarafindan reddedilir;
    /// uyelikler id uzerinden oldugundan koleksiyondaki asset'ler OLDUGU GIBI kalir.
    pub fn rename_collection(&self, id: i64, name: &str) -> Result<(), DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("koleksiyon adi bos olamaz".into()));
        }
        let updated = self
            .conn
            .execute("UPDATE collections SET name = ?1 WHERE id = ?2", params![name, id])?;
        if updated == 0 {
            return Err(DbError::Invalid("koleksiyon bulunamadi".into()));
        }
        Ok(())
    }

    /// Koleksiyon rengini ayarlar. Renk #RRGGBB olmalidir; None renk rozetini kaldirir.
    /// Olmayan id → Invalid; keyfi CSS degeri saklanmaz.
    pub fn set_collection_color(&self, id: i64, color: Option<&str>) -> Result<(), DbError> {
        let color = match color {
            Some(value) => {
                let value = value.trim();
                let valid = value.len() == 7
                    && value.starts_with('#')
                    && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit);
                if !valid {
                    return Err(DbError::Invalid("koleksiyon rengi #RRGGBB olmali".into()));
                }
                Some(value)
            }
            None => None,
        };
        let updated = self
            .conn
            .execute("UPDATE collections SET color = ?1 WHERE id = ?2", params![color, id])?;
        if updated == 0 {
            return Err(DbError::Invalid("koleksiyon bulunamadi".into()));
        }
        Ok(())
    }

    /// Bir asset'i koleksiyona ekle. Idempotent (tekrarli ekleme zararsiz).
    pub fn add_to_collection(&self, collection_id: i64, asset_id: i64) -> Result<(), DbError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO collection_items(collection_id, asset_id) VALUES (?1, ?2)",
            params![collection_id, asset_id],
        )?;
        Ok(())
    }

    /// Bir asset'i koleksiyondan cikar (koleksiyon ve asset durur). Idempotent.
    pub fn remove_from_collection(
        &self,
        collection_id: i64,
        asset_id: i64,
    ) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM collection_items WHERE collection_id = ?1 AND asset_id = ?2",
            params![collection_id, asset_id],
        )?;
        Ok(())
    }
}
