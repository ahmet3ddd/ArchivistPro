//! `scanned_roots` — Kaynak-klasor yonetimi (H2 Faz-4 pariti): izlenen/taranan kok
//! klasor KAYDI + gruplar + kok-etiketleri. H2'de izlenen kokler localStorage'daydi
//! (watchSettings) → burada GERCEK entity'ye tasinir (Rust veriyi sahiplenir; .db
//! tasininca kokler birlikte gider). Sema: `migrations/sql/0020_scanned_roots.sql`.
//!
//! IKI AKSIYON SEMANTIGI (H2 modeli birebir — KRITIK):
//! - `status='removed'` = **LISTEDEN CIKAR:** kok kaynak listeden kalkar ama altindaki
//!   asset'ler ARSIVDE KALIR (DOKUNULMAZ); `reactivate` geri getirir.
//! - `is_deleted=1` = **KLASOR COPU:** kok cope + kok-alti AKTIF asset'ler de soft-delete
//!   (birlikte, `trash.rs` deseni); `restore` ikisini de dondurur; `purge` kalici siler.
//!
//! **Okuma+yazma AYNI anda sema-aware** (H2 kismi-bozulma dersi): `file_count` SAKLANMAZ,
//! `assets`'ten CANLI turetilir; yazma yolu (trash/restore) ile okuma yolu (list) AYNI
//! kardes-onek guvenli sinir + AYNI soft-delete kurallarini paylasir (sizinti yok).
//!
//! **Kardes-onek guvenligi** (H2 `project_name_from_path` ile ayni sinir): kok-alti sorgular
//! `kok + AYRAC + %` LIKE oruntusu kullanir → `C:\Proj` ve `C:\Projeler` ASLA eslesmez
//! (onekten hemen sonra ayrac zorunlu). Joker/ters-bolu kacisi `escape_like_prefix` ile.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;

use crate::error::DbError;
use crate::query::escape_like_prefix;
use crate::Db;

/// Grup varsayilan rengi (sema `root_groups.color` DEFAULT ile tutarli).
const DEFAULT_GROUP_COLOR: &str = "#6366f1";

/// `ScannedRootRow`'un SQL'den okunan 10 cekirdek sutunu (file_count/tags HARIC — onlar
/// ust katmanda CANLI hesaplanir). map_root_base bu sirada okur.
const ROOT_COLS: &str =
    "id, path, label, added_at, last_scan, status, is_favorite, group_id, is_deleted, deleted_at";

/// Kaynak-klasor grubu (sidebar gruplama). `root_count` = CANLI turetilen, gruptaki
/// **AKTIF** (`status='active' AND is_deleted=0`) kok sayisi. camelCase → IPC.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootGroupRow {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub root_count: i64,
}

/// Bir koke bagli etiket — `id` + `name`. Frontend etiket KALDIRMA icin `tag_id` gerektirir
/// (`remove_root_tag(root_id, tag_id)`) → duz ad yetmez, id de doner. camelCase → IPC.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RootTag {
    pub id: i64,
    pub name: String,
}

/// Bir izlenen kok satiri (liste/detay) — frontend gorunumu. `file_count` CANLI (assets'ten,
/// kok-alti kardes-onek guvenli sinir); `tags` root_tags∨tags join'inden. camelCase → IPC.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedRootRow {
    pub id: i64,
    pub path: String,
    pub label: String,
    pub added_at: i64,
    pub last_scan: Option<i64>,
    pub status: String,
    pub is_favorite: bool,
    pub group_id: Option<i64>,
    pub is_deleted: bool,
    pub deleted_at: Option<i64>,
    /// CANLI kok-alti asset sayimi (aktif listede `deleted_at IS NULL`; cop listesinde
    /// `deleted_at IS NOT NULL`). SAKLANMAZ → her okumada turetilir.
    pub file_count: i64,
    /// CANLI kok-alti **tarama bekleyen** sayimi: aktif ve `indexed_at IS NULL`.
    ///
    /// NEDEN VAR (2026-08-11, H2 aktarimi sonrasi kullanici bulgusu): aktarim kayitlari
    /// bilerek `indexed_at = NULL` birakir (tarama devralsin diye — `import_h2.rs`), ama
    /// kullanicinin HANGI kokun tarama bekledigini gorecegi hicbir yer yoktu; bilgi ancak
    /// elle SQL ile cikariliyordu. `last_scan` bunun yerine GECMEZ: taranmis bir koke sonradan
    /// aktarim/yeni dosya girebilir → "taranmis" gorunur ama bekleyeni vardir.
    ///
    /// Cop listesinde (`count_active=false`) daima 0 — cop'te "tarama bekleyen" anlamsiz.
    pub pending_count: i64,
    /// Koke bagli etiketler (`{id, name}`, ad ASC). Bos → `[]`.
    pub tags: Vec<RootTag>,
}

/// `ROOT_COLS` sirasindaki satir esleyici (file_count=0, tags=[] — ust katman doldurur).
fn map_root_base(r: &Row) -> rusqlite::Result<ScannedRootRow> {
    Ok(ScannedRootRow {
        id: r.get(0)?,
        path: r.get(1)?,
        label: r.get(2)?,
        added_at: r.get(3)?,
        last_scan: r.get(4)?,
        status: r.get(5)?,
        is_favorite: r.get::<_, i64>(6)? != 0,
        group_id: r.get(7)?,
        is_deleted: r.get::<_, i64>(8)? != 0,
        deleted_at: r.get(9)?,
        file_count: 0,    // ust katmanda CANLI doldurulur (root_counts)
        pending_count: 0, // ust katmanda CANLI doldurulur (root_counts)
        tags: Vec::new(), // ust katmanda doldurulur (tags_by_root)
    })
}

/// Etkin etiket: `label` trim sonrasi doluysa onu; bossa `path`'in son klasor segmentini
/// (o da bossa `path`'in kendisini) kullan → sema `label NOT NULL` daima saglanir.
fn effective_label(label: &str, path: &str) -> String {
    let l = label.trim();
    if !l.is_empty() {
        return l.to_string();
    }
    let fname = folder_name(path);
    if fname.is_empty() {
        path.trim().to_string()
    } else {
        fname.to_string()
    }
}

/// Bir yolun son klasor segmenti (ust-dizin adi). Sondaki ayrac(lar) yok sayilir; ayrac
/// yoksa yolun tamami. Hem `\` hem `/` (cok-OS). `std::path` KULLANILMAZ (portable).
fn folder_name(path: &str) -> &str {
    let trimmed = path.trim_end_matches(['\\', '/']);
    match trimmed.rfind(['\\', '/']) {
        Some(i) => &trimmed[i + 1..],
        None => trimmed,
    }
}

/// Bir kok icin **kardes-onek guvenli** iki LIKE oruntusu (`\` ve `/` ayrac varyantlari):
/// `escape(kok + AYRAC) + '%'`. Onekten hemen sonra ayrac zorunlu → `C:\Proj`, `C:\Projeler`'i
/// ESLEMEZ (H2 denormalize-string tuzaginin yapisal onlemi; `project_name_from_path` ile ayni
/// sinir). Kok sonundaki ayrac(lar) once normalize edilir. `ESCAPE '\'` ile literal eslesme.
fn like_patterns_for_root(root: &str) -> (String, String) {
    let root_norm = root.trim_end_matches(['\\', '/']);
    let back = format!("{}%", escape_like_prefix(Some(&format!("{root_norm}\\"))).unwrap_or_default());
    let fwd = format!("{}%", escape_like_prefix(Some(&format!("{root_norm}/"))).unwrap_or_default());
    (back, fwd)
}

/// Kok-alti CANLI sayimlar → `(file_count, pending_count)` (kardes-onek guvenli sinir).
///
/// `active=true` → aktif satirlar (`deleted_at IS NULL`) sayilir ve `pending_count` bunlarin
/// `indexed_at IS NULL` olanidir. `active=false` → cop (`deleted_at IS NOT NULL`) sayilir ve
/// `pending_count` daima 0 (cop'te "tarama bekliyor" anlamsiz).
///
/// IKI sayim **TEK sorguda** cikar: `fetch_roots` bunu kok BASINA cagirir (N+1); ayri bir
/// sorgu daha acmak kok sayisi kadar gidis-donus EKLERDI.
///
/// Bos/gecersiz kok → `(0, 0)` (degenerate kok tum arsivi yanlislikla saymasin).
fn root_counts(conn: &Connection, root: &str, active: bool) -> Result<(i64, i64), DbError> {
    if root.trim_end_matches(['\\', '/']).is_empty() {
        return Ok((0, 0)); // degenerate kok → tum arsivi yanlislikla sayma
    }
    let (back, fwd) = like_patterns_for_root(root);
    let cond = if active { "deleted_at IS NULL" } else { "deleted_at IS NOT NULL" };
    // `sum(...)` bos kumede NULL doner → `coalesce` ile 0'a cekilir (i64 okumasi NULL'da patlar).
    let pending_expr = if active { "coalesce(sum(indexed_at IS NULL), 0)" } else { "0" };
    let sql = format!(
        "SELECT count(*), {pending_expr} FROM assets
         WHERE {cond} AND (path LIKE ?1 ESCAPE '\\' OR path LIKE ?2 ESCAPE '\\')"
    );
    Ok(conn.query_row(&sql, params![back, fwd], |r| Ok((r.get(0)?, r.get(1)?)))?)
}

/// Kok-alti TUM asset id'leri (aktif + cop; kardes-onek guvenli sinir) — `purge_scanned_root`
/// icin (klasor tamamen yok olur). Bos/gecersiz kok → bos (guvenli: hicbir sey silinmez).
fn asset_ids_under_root(conn: &Connection, root: &str) -> Result<Vec<i64>, DbError> {
    if root.trim_end_matches(['\\', '/']).is_empty() {
        return Ok(Vec::new());
    }
    let (back, fwd) = like_patterns_for_root(root);
    let mut stmt = conn
        .prepare("SELECT id FROM assets WHERE path LIKE ?1 ESCAPE '\\' OR path LIKE ?2 ESCAPE '\\'")?;
    let ids = stmt
        .query_map(params![back, fwd], |r| r.get(0))?
        .collect::<rusqlite::Result<Vec<i64>>>()?;
    Ok(ids)
}

/// Tum kokler icin etiket haritasi (root_id → `{id, name}`, ad ASC). Tek sorgu → N+1 yok.
fn tags_by_root(conn: &Connection) -> Result<HashMap<i64, Vec<RootTag>>, DbError> {
    let mut stmt = conn.prepare(
        "SELECT rt.root_id, t.id, t.name
         FROM root_tags rt JOIN tags t ON t.id = rt.tag_id
         ORDER BY rt.root_id, t.name",
    )?;
    let mut map: HashMap<i64, Vec<RootTag>> = HashMap::new();
    let mut rows = stmt.query([])?;
    while let Some(r) = rows.next()? {
        let root_id: i64 = r.get(0)?;
        map.entry(root_id).or_default().push(RootTag { id: r.get(1)?, name: r.get(2)? });
    }
    Ok(map)
}

impl Db {
    /// Kok listesi cekirdegi: `where_sql`'e uyan kokleri cek + her satira CANLI `file_count`
    /// (`count_active`: aktif mi cop mu sayilacak) + `tags` ekle. list_* metotlari bunu paylasir
    /// (okuma yolu tek noktada tutarli).
    fn fetch_roots(
        &self,
        where_sql: &str,
        order_sql: &str,
        count_active: bool,
    ) -> Result<Vec<ScannedRootRow>, DbError> {
        let sql = format!("SELECT {ROOT_COLS} FROM scanned_roots WHERE {where_sql} ORDER BY {order_sql}");
        let mut rows: Vec<ScannedRootRow> = {
            let mut stmt = self.conn.prepare(&sql)?;
            // `stmt` blok sonunda düşmeden ÖNCE collect'i bir local'a bağla (E0597: aksi halde
            // MappedRows geçici degeri stmt'ten sonra düşer → borrow hatası).
            let collected = stmt.query_map([], map_root_base)?.collect::<rusqlite::Result<Vec<_>>>()?;
            collected
        };
        let tag_map = tags_by_root(&self.conn)?;
        for row in &mut rows {
            let (files, pending) = root_counts(&self.conn, &row.path, count_active)?;
            row.file_count = files;
            row.pending_count = pending;
            if let Some(tags) = tag_map.get(&row.id) {
                row.tags = tags.clone();
            }
        }
        Ok(rows)
    }

    // ── Kokler: kayit / upsert ───────────────────────────────────────────────

    /// Kok ekle → `(id, newly)`. `path` UNIQUE cakismasi → mevcut satiri **REACTIVATE**
    /// (`status='active'`, `is_deleted=0`, `deleted_at=NULL`); `added_at`/`last_scan`/`label`
    /// DOKUNULMAZ (kullanici duzenlemesi korunur). `newly` = yeni satir mi. Bos yol reddedilir.
    /// Tek TX (check-then-act atomik; tek motor sahipligi → yaris yok).
    pub fn add_scanned_root(
        &mut self,
        path: &str,
        label: &str,
        added_at: i64,
    ) -> Result<(i64, bool), DbError> {
        let path = path.trim();
        if path.is_empty() {
            return Err(DbError::Invalid("kok yolu bos olamaz".into()));
        }
        let label = effective_label(label, path);
        let tx = self.conn.transaction()?;
        let existing: Option<i64> = tx
            .query_row("SELECT id FROM scanned_roots WHERE path = ?1", params![path], |r| r.get(0))
            .optional()?;
        let out = match existing {
            Some(id) => {
                tx.execute(
                    "UPDATE scanned_roots SET status = 'active', is_deleted = 0, deleted_at = NULL
                     WHERE id = ?1",
                    params![id],
                )?;
                (id, false)
            }
            None => {
                tx.execute(
                    "INSERT INTO scanned_roots(path, label, added_at) VALUES (?1, ?2, ?3)",
                    params![path, label, added_at],
                )?;
                (tx.last_insert_rowid(), true)
            }
        };
        tx.commit()?;
        Ok(out)
    }

    /// Tarama kaydi (ingest oto-tohum bunu cagirir → "son tarama" izlenir) → `(id, newly)`.
    /// Yeni ise olustur (`added_at=last_scan=now`); varsa `last_scan=now` + REACTIVATE
    /// (`status='active'`, `is_deleted=0`, `deleted_at=NULL`), `added_at`/`label` DOKUNULMAZ.
    /// Bos yol reddedilir. Tek TX (atomik upsert).
    pub fn record_root_scan(
        &mut self,
        path: &str,
        label: &str,
        now: i64,
    ) -> Result<(i64, bool), DbError> {
        let path = path.trim();
        if path.is_empty() {
            return Err(DbError::Invalid("kok yolu bos olamaz".into()));
        }
        let label = effective_label(label, path);
        let tx = self.conn.transaction()?;
        let existing: Option<i64> = tx
            .query_row("SELECT id FROM scanned_roots WHERE path = ?1", params![path], |r| r.get(0))
            .optional()?;
        let out = match existing {
            Some(id) => {
                tx.execute(
                    "UPDATE scanned_roots
                     SET last_scan = ?2, status = 'active', is_deleted = 0, deleted_at = NULL
                     WHERE id = ?1",
                    params![id, now],
                )?;
                (id, false)
            }
            None => {
                // ?3 iki kez: added_at = last_scan = now.
                tx.execute(
                    "INSERT INTO scanned_roots(path, label, added_at, last_scan)
                     VALUES (?1, ?2, ?3, ?3)",
                    params![path, label, now],
                )?;
                (tx.last_insert_rowid(), true)
            }
        };
        tx.commit()?;
        Ok(out)
    }

    // ── Kokler: listeleme ────────────────────────────────────────────────────

    /// Aktif izlenen kokler (`status='active' AND is_deleted=0`). Her satir CANLI aktif
    /// `file_count` + `group_id` + `tags`. Sirala: `is_favorite DESC, label ASC`.
    pub fn list_scanned_roots(&self) -> Result<Vec<ScannedRootRow>, DbError> {
        self.fetch_roots(
            "status = 'active' AND is_deleted = 0",
            "is_favorite DESC, label ASC, id ASC",
            true,
        )
    }

    /// Klasor-copundaki kokler (`is_deleted=1`). `file_count` = kok-alti **soft-deleted**
    /// asset sayisi. Sirala: `deleted_at DESC` (en son atilan once).
    pub fn list_trashed_roots(&self) -> Result<Vec<ScannedRootRow>, DbError> {
        self.fetch_roots("is_deleted = 1", "deleted_at DESC, id DESC", false)
    }

    /// "Listeden cikarilmis" kokler (`status='removed' AND is_deleted=0`) — reactivate paneli
    /// icin. Asset'ler DOKUNULMAMISTIR → `file_count` = kok-alti AKTIF asset sayisi.
    /// Sirala: `label ASC`.
    pub fn list_removed_roots(&self) -> Result<Vec<ScannedRootRow>, DbError> {
        self.fetch_roots("status = 'removed' AND is_deleted = 0", "label ASC, id ASC", true)
    }

    // ── Kokler: duzenleme (setter'lar; olmayan id → idempotent no-op) ─────────

    /// Kok etiketini degistir. Bos etiket reddedilir. Olmayan id → no-op (idempotent).
    pub fn rename_scanned_root(&self, id: i64, label: &str) -> Result<(), DbError> {
        let label = label.trim();
        if label.is_empty() {
            return Err(DbError::Invalid("kok etiketi bos olamaz".into()));
        }
        self.conn.execute("UPDATE scanned_roots SET label = ?2 WHERE id = ?1", params![id, label])?;
        Ok(())
    }

    /// Favori bayragini ayarla. Olmayan id → no-op.
    pub fn set_root_favorite(&self, id: i64, favorite: bool) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE scanned_roots SET is_favorite = ?2 WHERE id = ?1",
            params![id, i64::from(favorite)],
        )?;
        Ok(())
    }

    /// Koku bir gruba ata (veya `None` → gruptan cikar, group_id NULL). Gecersiz `group_id`
    /// (olmayan grup) FK ile REDDEDILIR (`foreign_keys=ON`) → hayalet baglanti imkansiz.
    pub fn assign_root_group(&self, id: i64, group_id: Option<i64>) -> Result<(), DbError> {
        self.conn.execute(
            "UPDATE scanned_roots SET group_id = ?2 WHERE id = ?1",
            params![id, group_id],
        )?;
        Ok(())
    }

    /// **LISTEDEN CIKAR** (`status='removed'`): kok aktif listeden kalkar; kok-alti asset'ler
    /// DOKUNULMAZ (arsivde kalir). Geri-alinabilir ([`reactivate_scanned_root`]). Olmayan id → no-op.
    pub fn remove_scanned_root(&self, id: i64) -> Result<(), DbError> {
        self.conn
            .execute("UPDATE scanned_roots SET status = 'removed' WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Listeden-cikarilmis koku geri getir (`status='active'`). Olmayan id → no-op.
    pub fn reactivate_scanned_root(&self, id: i64) -> Result<(), DbError> {
        self.conn
            .execute("UPDATE scanned_roots SET status = 'active' WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Kokler: klasor copu (trash / restore / purge) ────────────────────────

    /// **KLASOR COPU** (tek TX): kok `is_deleted=1`, `deleted_at=now` + kok-alti AKTIF asset'leri
    /// soft-delete (trash.rs `soft_delete` deseni; `deleted_at IS NULL` guvencesi → zaten cop'te
    /// olan yeniden damgalanmaz, idempotent). `now` cagirandan → kok ve asset'ler AYNI zaman
    /// damgasini paylasir (atomik). Kok-DISI asset DOKUNULMAZ. Doner: cope atilan asset sayisi.
    /// Olmayan id → 0 (no-op).
    pub fn trash_scanned_root(&mut self, id: i64, now: i64) -> Result<usize, DbError> {
        let path: Option<String> = self
            .conn
            .query_row("SELECT path FROM scanned_roots WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?;
        let Some(path) = path else { return Ok(0) };
        let empty = path.trim_end_matches(['\\', '/']).is_empty();
        let (back, fwd) = like_patterns_for_root(&path);

        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE scanned_roots SET is_deleted = 1, deleted_at = ?2 WHERE id = ?1",
            params![id, now],
        )?;
        // Degenerate kok (bos yol) → asset'e DOKUNMA (tum arsivi yanlislikla cope atma).
        let affected = if empty {
            0
        } else {
            tx.execute(
                "UPDATE assets SET deleted_at = ?1
                 WHERE deleted_at IS NULL AND (path LIKE ?2 ESCAPE '\\' OR path LIKE ?3 ESCAPE '\\')",
                params![now, back, fwd],
            )?
        };
        tx.commit()?;
        Ok(affected)
    }

    /// **KLASOR COPU GERI-AL** (tek TX): kok `is_deleted=0`, `deleted_at=NULL` + kok-alti
    /// soft-deleted asset'leri restore. Doner: geri-alinan asset sayisi. Olmayan id → 0.
    ///
    /// EDGE (kabul edilen davranis): kok-alti TUM soft-deleted asset'ler geri gelir — folder-trash
    /// ile atilanlar ile bireysel (normal cop) atilanlar AYIRT EDILMEZ. `trash_scanned_root`
    /// `status`'a dokunmaz → restore kokun onceki `status`'unu ('active'/'removed') korur.
    pub fn restore_scanned_root(&mut self, id: i64) -> Result<usize, DbError> {
        let path: Option<String> = self
            .conn
            .query_row("SELECT path FROM scanned_roots WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?;
        let Some(path) = path else { return Ok(0) };
        let empty = path.trim_end_matches(['\\', '/']).is_empty();
        let (back, fwd) = like_patterns_for_root(&path);

        let tx = self.conn.transaction()?;
        tx.execute(
            "UPDATE scanned_roots SET is_deleted = 0, deleted_at = NULL WHERE id = ?1",
            params![id],
        )?;
        let affected = if empty {
            0
        } else {
            tx.execute(
                "UPDATE assets SET deleted_at = NULL
                 WHERE deleted_at IS NOT NULL AND (path LIKE ?1 ESCAPE '\\' OR path LIKE ?2 ESCAPE '\\')",
                params![back, fwd],
            )?
        };
        tx.commit()?;
        Ok(affected)
    }

    /// **KLASOR COPU KALICI SIL** (geri-alinamaz): kok-alti TUM asset'leri (aktif + cop) trash.rs
    /// [`purge`](Self::purge) ile KALICI sil (vec0/FTS/chunk yetim-guvenli — yeniden ICAT EDILMEZ;
    /// H2 kismi-bozulma dersi) + kok satirini DELETE (`root_tags` CASCADE). Doner: silinen asset
    /// sayisi. Olmayan id → 0.
    ///
    /// NOT: `purge` kendi atomik TX'inde orphan-0 garantiler; ardindan kok satiri DELETE ayri
    /// (onemsiz) adimdir. Kok satiri hala varsa yeniden cagri kurtarir (0 asset → yalniz satiri siler).
    pub fn purge_scanned_root(&mut self, id: i64) -> Result<usize, DbError> {
        let path: Option<String> = self
            .conn
            .query_row("SELECT path FROM scanned_roots WHERE id = ?1", params![id], |r| r.get(0))
            .optional()?;
        let Some(path) = path else { return Ok(0) };
        let ids = asset_ids_under_root(&self.conn, &path)?;
        let purged = self.purge(&ids)?; // trash.rs — orphan-guvenli silme YENIDEN KULLANILIR
        self.conn.execute("DELETE FROM scanned_roots WHERE id = ?1", params![id])?; // root_tags CASCADE
        Ok(purged)
    }

    // ── Gruplar ──────────────────────────────────────────────────────────────

    /// Grup olustur → yeni id. Bos ad reddedilir. Bos renk → varsayilan (`#6366f1`).
    /// `sort_order` sema varsayilani (0). `now` cagirandan (unix saniye).
    pub fn create_root_group(&self, name: &str, color: &str, now: i64) -> Result<i64, DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("grup adi bos olamaz".into()));
        }
        let color = color.trim();
        let color = if color.is_empty() { DEFAULT_GROUP_COLOR } else { color };
        self.conn.execute(
            "INSERT INTO root_groups(name, color, created_at) VALUES (?1, ?2, ?3)",
            params![name, color, now],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Tum gruplar + CANLI `root_count` (gruptaki AKTIF `status='active' AND is_deleted=0` kok
    /// sayisi — `list_scanned_roots` uyeligiyle tutarli). Sirala: `sort_order ASC, name ASC`.
    pub fn list_root_groups(&self) -> Result<Vec<RootGroupRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT g.id, g.name, g.color, g.sort_order, g.created_at,
                    (SELECT count(*) FROM scanned_roots r
                      WHERE r.group_id = g.id AND r.status = 'active' AND r.is_deleted = 0)
             FROM root_groups g
             ORDER BY g.sort_order ASC, g.name ASC, g.id ASC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(RootGroupRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    sort_order: r.get(3)?,
                    created_at: r.get(4)?,
                    root_count: r.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Grup adini degistir. Bos ad reddedilir. Olmayan id → no-op.
    pub fn rename_root_group(&self, id: i64, name: &str) -> Result<(), DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("grup adi bos olamaz".into()));
        }
        self.conn.execute("UPDATE root_groups SET name = ?2 WHERE id = ?1", params![id, name])?;
        Ok(())
    }

    /// Grup rengini degistir. Bos renk reddedilir. Olmayan id → no-op.
    pub fn recolor_root_group(&self, id: i64, color: &str) -> Result<(), DbError> {
        let color = color.trim();
        if color.is_empty() {
            return Err(DbError::Invalid("grup rengi bos olamaz".into()));
        }
        self.conn.execute("UPDATE root_groups SET color = ?2 WHERE id = ?1", params![id, color])?;
        Ok(())
    }

    /// Grubu sil. FK `ON DELETE SET NULL` → gruba bagli kokler **KALIR** (`group_id` NULL olur;
    /// CASCADE DEGIL). Idempotent (olmayan id → no-op). `&mut self`: FK yan-etkisi (kok satirlarini degistirir).
    pub fn delete_root_group(&mut self, id: i64) -> Result<(), DbError> {
        self.conn.execute("DELETE FROM root_groups WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Grup ESKI-durum yakalayicilari (geri-al kaydi icin; komut katmani mutasyon ONCESI okur) ──

    /// Bir grubun `(name, color)`'i — rename/recolor/delete undo'su eski degeri saklasin diye
    /// mutasyon ONCESI okunur. Olmayan grup → `None`.
    pub fn root_group_name_color(&self, id: i64) -> Result<Option<(String, String)>, DbError> {
        Ok(self
            .conn
            .query_row("SELECT name, color FROM root_groups WHERE id = ?1", params![id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .optional()?)
    }

    /// Bir gruba bagli TUM kok id'leri (status/silinme fark etmez) — grup-SILME undo'su uyelikleri
    /// yeniden kurabilsin diye silme ANINDA yakalanir. Bos grup → bos vec. Sira `id` (deterministik).
    pub fn root_ids_in_group(&self, group_id: i64) -> Result<Vec<i64>, DbError> {
        let mut stmt =
            self.conn.prepare("SELECT id FROM scanned_roots WHERE group_id = ?1 ORDER BY id")?;
        let ids = stmt
            .query_map(params![group_id], |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(ids)
    }

    /// Bir kokun MEVCUT grup id'si (`assign` undo'su eski grubu geri koyabilsin). Grupsuz **veya**
    /// olmayan kok → `None` (ayrim gerekmez: ikisi de undo'da "gruptan cikar" ile ayni sonucu verir).
    pub fn root_group_of(&self, root_id: i64) -> Result<Option<i64>, DbError> {
        Ok(self
            .conn
            .query_row("SELECT group_id FROM scanned_roots WHERE id = ?1", params![root_id], |r| {
                r.get::<_, Option<i64>>(0)
            })
            .optional()?
            .flatten())
    }

    // ── Kok etiketleri (paylasilan `tags` tablosu; asset tag deseni) ─────────

    /// Koke etiket ekle → `tag_id`. Tag'i ada gore upsert (`INSERT OR IGNORE` + SELECT; var olan
    /// auto/system tag ile ad cakisirsa mevcut `kind` korunur — ad UNIQUE), sonra `root_tags`'e
    /// bagla (idempotent). Bos ad reddedilir. Olmayan kok → `Invalid` (`INSERT OR IGNORE` FK
    /// ihlalini yutar → varlik ELLE kontrol edilir). Tek TX (atomik).
    pub fn add_root_tag(&mut self, root_id: i64, tag_name: &str) -> Result<i64, DbError> {
        let name = tag_name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("etiket adi bos olamaz".into()));
        }
        let tx = self.conn.transaction()?;
        let root_exists = tx
            .query_row("SELECT 1 FROM scanned_roots WHERE id = ?1", params![root_id], |_| Ok(()))
            .optional()?
            .is_some();
        if !root_exists {
            return Err(DbError::Invalid(format!("kok bulunamadi: {root_id}")));
        }
        tx.execute("INSERT OR IGNORE INTO tags(name, kind) VALUES (?1, 'user')", params![name])?;
        let tag_id: i64 =
            tx.query_row("SELECT id FROM tags WHERE name = ?1", params![name], |r| r.get(0))?;
        tx.execute(
            "INSERT OR IGNORE INTO root_tags(root_id, tag_id) VALUES (?1, ?2)",
            params![root_id, tag_id],
        )?;
        tx.commit()?;
        Ok(tag_id)
    }

    /// Kokten etiket bagini kaldir (tag TANIMI durur — yalniz bag gider). Idempotent.
    pub fn remove_root_tag(&self, root_id: i64, tag_id: i64) -> Result<(), DbError> {
        self.conn.execute(
            "DELETE FROM root_tags WHERE root_id = ?1 AND tag_id = ?2",
            params![root_id, tag_id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::params;

    use super::{effective_label, folder_name, like_patterns_for_root};
    use crate::Db;

    /// Test asset'i: `indexed_at` cagirandan (NULL = tarama bekliyor, aktarim satirlarinin hali).
    fn asset(db: &Db, path: &str, indexed_at: Option<i64>, deleted: bool) {
        db.conn
            .execute(
                "INSERT INTO assets(path, file_name, size_bytes, created_at, modified_at,
                                    indexed_at, deleted_at)
                 VALUES (?1, 'f', 0, 0, 0, ?2, ?3)",
                params![path, indexed_at, if deleted { Some(1_i64) } else { None }],
            )
            .unwrap();
    }

    /// `pending_count` = kok-alti AKTIF + `indexed_at IS NULL`. Bu, H2 aktarimi sonrasi
    /// "hangi kok tarama bekliyor" sorusunun TEK dogru kaynagi (aktarim satirlari bilerek
    /// `indexed_at=NULL` gelir). Ayrica: cop'teki satir bekleyene SAYILMAZ.
    #[test]
    fn pending_count_tracks_unindexed_active_assets_under_root() {
        let mut db = Db::open_in_memory_migrated().unwrap();
        db.add_scanned_root(r"C:\Proj", "", 0).unwrap();

        asset(&db, r"C:\Proj\a.jpg", None, false); // bekliyor
        asset(&db, r"C:\Proj\alt\b.dwg", None, false); // bekliyor (alt klasor)
        asset(&db, r"C:\Proj\c.pdf", Some(123), false); // indekslenmis
        asset(&db, r"C:\Proj\d.tmp", None, true); // cop → bekleyene sayilmaz

        let rows = db.list_scanned_roots().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_count, 3, "aktif kok-alti sayimi (cop haric)");
        assert_eq!(rows[0].pending_count, 2, "yalniz AKTIF + indexed_at NULL");
    }

    /// Bekleyen sayimi kok sinirina uymali: kardes-onek (`C:\Projeler`) SIZMAMALI —
    /// `file_count` ile AYNI sinir (iki sayim tek sorgudan cikar, ayrisamazlar).
    #[test]
    fn pending_count_is_sibling_prefix_safe() {
        let mut db = Db::open_in_memory_migrated().unwrap();
        db.add_scanned_root(r"C:\Proj", "", 0).unwrap();

        asset(&db, r"C:\Proj\a.jpg", None, false); // ICERIDE
        asset(&db, r"C:\Projeler\b.jpg", None, false); // KARDES — sayilmamali
        asset(&db, r"C:\Proj", None, false); // kokun KENDISI (ayrac yok) — sayilmamali

        let rows = db.list_scanned_roots().unwrap();
        assert_eq!(rows[0].file_count, 1);
        assert_eq!(rows[0].pending_count, 1, "kardes-onek bekleyen sayimina sizmamali");
    }

    /// Cop listesinde `pending_count` daima 0 — orada "tarama bekliyor" anlamsizdir
    /// (`file_count` ise kok-alti soft-deleted sayimini gostermeye devam eder).
    #[test]
    fn trashed_roots_report_zero_pending() {
        let mut db = Db::open_in_memory_migrated().unwrap();
        let (id, _) = db.add_scanned_root(r"C:\Proj", "", 0).unwrap();
        asset(&db, r"C:\Proj\a.jpg", None, false);
        db.trash_scanned_root(id, 999).unwrap();

        let rows = db.list_trashed_roots().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].file_count, 1, "cop listesinde soft-deleted sayilir");
        assert_eq!(rows[0].pending_count, 0, "cop'te bekleyen kavrami yok");
    }

    /// `folder_name`: son klasor segmenti; sondaki ayrac normalize; ayracsiz → tam ad.
    #[test]
    fn folder_name_extracts_last_segment() {
        assert_eq!(folder_name(r"C:\Projeler\Villa-A"), "Villa-A");
        assert_eq!(folder_name(r"C:\Projeler\Villa-A\"), "Villa-A"); // sondaki ayrac normalize
        assert_eq!(folder_name("C:/Projeler/Ofis"), "Ofis");
        assert_eq!(folder_name(r"C:\Projeler"), "Projeler");
        assert_eq!(folder_name("Tek"), "Tek"); // ayracsiz
    }

    /// `effective_label`: dolu label trim'lenir; bos label → klasor adi; o da bossa yol.
    #[test]
    fn effective_label_falls_back_to_folder_name() {
        assert_eq!(effective_label("  Etiket  ", r"C:\X\Y"), "Etiket");
        assert_eq!(effective_label("   ", r"C:\Projeler\Villa-A"), "Villa-A");
        assert_eq!(effective_label("", "C:/a/b/Kok"), "Kok");
    }

    /// `like_patterns_for_root`: kok + ayrac (escape'li) + `%`; kardes-onek guvenli.
    /// `\` → `\\` (LIKE ESCAPE '\'); sonda daima ayrac zorunlu (onek eslesmez).
    #[test]
    fn like_patterns_are_sibling_prefix_safe() {
        let (back, fwd) = like_patterns_for_root(r"C:\Proj");
        assert_eq!(back, r"C:\\Proj\\%");
        assert_eq!(fwd, r"C:\\Proj/%");
        // Sondaki ayrac normalize → ayni oruntu (idempotent).
        assert_eq!(like_patterns_for_root(r"C:\Proj\"), (r"C:\\Proj\\%".into(), r"C:\\Proj/%".into()));
    }
}
