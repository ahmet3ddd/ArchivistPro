//! `projects` entity — GERCEK proje varligi + CRUD (H2 isim=kimlik hatasinin duzeltmesi).
//!
//! H2 DERSI: H2'de "proje" `assets.project_name` denormalize string'iydi → iki farkli
//! klasor ayni ustad ise istemeden birlesirdi. H3'te proje kimligi = `id` (FK); ad yalniz
//! gorunen etiket. Asset'ler opsiyonel `project_id` (0019 FK, ON DELETE SET NULL) ile
//! baglanir → proje silinince atanmis asset'ler KALIR (yalniz baglanti kopar).
//!
//! Sema: `migrations/sql/0019_projects.sql`. Bu modul yalniz `projects` tablosu +
//! `assets.project_id` uzerinde calisir; per-asset 0008 proje-durum alanlarina (write.rs
//! `set_project_meta`) DOKUNMAZ (MVP uzlastirmasi: iki katman bagimsiz).
//!
//! **Okuma+yazma AYNI anda sema-aware** (H2 kismi-bozulma dersi): asset_count / facet / filtre
//! hepsi `deleted_at IS NULL` (cop haric) + `project_id` uzerinden tutarli; yazma (assign)
//! ile okuma (list/facet) ayni FK/soft-delete kurallarini paylasir.

use std::collections::BTreeMap;

use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};

use crate::error::DbError;
use crate::query::{escape_like_prefix, Facet};
use crate::Db;

/// Oto proje atamasinda tek `UPDATE ... id IN (…)` icine konacak EN FAZLA id sayisi.
///
/// Neden var: yer tutucu sayisi SQLite'in `SQLITE_MAX_VARIABLE_NUMBER` sinirina tabidir —
/// eski surumlerde **999**, 3.32+'da **32.766**. Bir klasordeki asset sayisi ise sinirsizdir
/// (gercek arsivde olculdu: tek klasorde 60.377). 500 her iki sinirin de guvenle altinda ve
/// sorgu basina is yeterince kucuk kalir.
const ASSIGN_ID_CHUNK: usize = 500;

/// Bir proje satiri (liste/detay) — frontend'e giden gorunum. `asset_count` = bu projeye
/// atanmis **AKTIF** (`deleted_at IS NULL`) asset sayisi (cop haric). camelCase → IPC.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRow {
    pub id: i64,
    pub name: String,
    pub client_name: Option<String>,
    pub phase: Option<String>,
    pub status: Option<String>,
    pub description: Option<String>,
    pub deadline: Option<String>,
    pub created_at: i64,
    pub asset_count: i64,
}

/// Oto klasor→proje atamasi ozeti (tarama sonu post-pass). `assets_assigned` = bu kosuda
/// projesiz iken bir projeye baglanan asset sayisi; `projects_touched` = atama alan farkli
/// proje sayisi (yeni olusturulan + var olup yeniden kullanilan). camelCase → IPC.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoProjectReport {
    pub assets_assigned: i64,
    pub projects_touched: i64,
}

/// Proje olustur/guncelle girdisi (frontend'ten gelir). `name` zorunlu (trim sonrasi bos
/// olamaz — isim=kimlik disiplini: sessiz bos proje yok). Diger alanlar opsiyonel/serbest.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInput {
    pub name: String,
    #[serde(default)]
    pub client_name: Option<String>,
    #[serde(default)]
    pub phase: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub deadline: Option<String>,
}

/// `ProjectRow` satir esleyici — `list_projects` sutun sirasi (9 sutun; son = asset_count).
fn map_project_row(r: &Row) -> rusqlite::Result<ProjectRow> {
    Ok(ProjectRow {
        id: r.get(0)?,
        name: r.get(1)?,
        client_name: r.get(2)?,
        phase: r.get(3)?,
        status: r.get(4)?,
        description: r.get(5)?,
        deadline: r.get(6)?,
        created_at: r.get(7)?,
        asset_count: r.get(8)?,
    })
}

/// Bir asset yolundan **oto-proje adi** cikar: `root` on-ekinden SONRAKI **ilk klasor
/// segmenti** (H2 `guessProjectName` paritesi, ama gercek entity'ye baglanmak icin).
///
/// Kurallar (saf, deterministik; `std::path` KULLANILMAZ — cok-OS, portable.rs deseni):
/// - `root` sonundaki ayrac(lar) normalize edilir → `C:\Projeler` ve `C:\Projeler\` ayni.
/// - `path`, `root` on-ekiyle baslamiyorsa → `None`.
/// - On-ekten hemen sonra tam bir ayrac (`\` veya `/`) YOKSA → `None` (kardes-on-ek koruma:
///   root `C:\Proj`, path `C:\Projeler\...` ESLESMEZ).
/// - Ayractan sonraki ILK segment, ardindan BASKA bir ayrac geliyorsa = klasor → `Some(seg)`.
///   Ornek: root=`C:\Projeler`, path=`C:\Projeler\Villa-A\plan.dwg` → `Some("Villa-A")`.
/// - Segmentten sonra ayrac YOKSA, yani dosya dogrudan kok altinda (`C:\Projeler\readme.txt`)
///   → `None` (projesiz kalir; tek yaprak dosya klasor sayilmaz).
/// - Bos segment (cift-ayrac) → `None`.
///
/// Ayrac (`\` ve `/`) tek-bayt ASCII → bayt-dilimleme UTF-8 sinirinda guvenli.
pub fn project_name_from_path(path: &str, root: &str) -> Option<String> {
    let root_norm = root.trim_end_matches(['\\', '/']);
    if root_norm.is_empty() {
        return None;
    }
    let rest = path.strip_prefix(root_norm)?;
    // On-ekten hemen sonra ayrac olmali (tam yol-siniri) — yoksa kardes-on-ek eslesmesi.
    match rest.as_bytes().first() {
        Some(b'\\') | Some(b'/') => {}
        _ => return None, // path == root, ya da `root`+devam-eden-isim (kardes)
    }
    let after = &rest[1..]; // lider ayrac tek-bayt
    let seg_end = after.find(['\\', '/'])?; // sonraki ayrac yoksa → dogrudan kok-alti dosya
    let seg = &after[..seg_end];
    if seg.is_empty() {
        return None; // cift-ayrac / bos segment
    }
    Some(seg.to_string())
}

/// `upsert_project_by_name` cekirdegi — ham `Connection` uzerinde (hem dogrudan hem TX-ici
/// cagirilabilsin diye serbest fn). `name`'e sahip ILK projeyi (id ASC) bulur; yoksa `name` +
/// `created_at` + verilen `status`/`description` ile olusturur (diger alanlar NULL). Bos ad →
/// `Invalid`.
///
/// **Meta yalniz YENI olusturmada yazilir:** var olan proje bulununca `status`/`description`'a
/// DOKUNULMAZ (idempotent — re-scan'de kullanicinin elle duzenledigi meta EZILMEZ). Oto
/// klasor→proje: `status` = yerellestirilmis "aktif" (frontend'ten), `description` = klasor yolu.
fn upsert_project_by_name_conn(
    conn: &Connection,
    name: &str,
    created_at: i64,
    status: Option<&str>,
    description: Option<&str>,
) -> Result<i64, DbError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(DbError::Invalid("proje adi bos olamaz".into()));
    }
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM projects WHERE name = ?1 ORDER BY id ASC LIMIT 1",
            params![name],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
    {
        return Ok(id); // var olan proje → meta'ya DOKUNULMAZ (idempotent)
    }
    conn.execute(
        "INSERT INTO projects(name, status, description, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![name, status, description, created_at],
    )?;
    Ok(conn.last_insert_rowid())
}

impl Db {
    /// Yeni proje olustur → yeni `id`. `created_at` cagirandan (unix saniye; H3 konvansiyonu —
    /// ingest/asset gibi zaman kaynagi ust katmanda). `name` trim sonrasi bos ise reddedilir
    /// (`DbError::Invalid`). `updated_at` olusturmada NULL (henuz guncellenmedi).
    pub fn create_project(&self, input: &ProjectInput, created_at: i64) -> Result<i64, DbError> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("proje adi bos olamaz".into()));
        }
        self.conn.execute(
            "INSERT INTO projects(name, client_name, phase, status, description, deadline, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                name,
                input.client_name,
                input.phase,
                input.status,
                input.description,
                input.deadline,
                created_at,
            ],
        )?;
        Ok(self.conn.last_insert_rowid())
    }

    /// Tum projeler + **AKTIF** asset sayimi (`name` ASC, esitlikte `id`). Projesiz asset'ler
    /// satir URETMEZ (yalniz `projects` satirlari). `asset_count` LEFT JOIN + `deleted_at IS NULL`
    /// (cop haric) → 0-asset proje de count=0 ile listelenir (list_collections deseni).
    pub fn list_projects(&self) -> Result<Vec<ProjectRow>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, p.name, p.client_name, p.phase, p.status, p.description, p.deadline,
                    p.created_at,
                    count(a.id)
             FROM projects p
             LEFT JOIN assets a ON a.project_id = p.id AND a.deleted_at IS NULL
             GROUP BY p.id
             ORDER BY p.name ASC, p.id ASC",
        )?;
        let rows = stmt
            .query_map([], map_project_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Projeyi guncelle — name + meta **full-replace** (isaretlenmeyen alan NULL'lanir;
    /// PATCH degil). `updated_at` = simdi. `name` bos ise reddedilir; proje yoksa `Invalid`.
    pub fn update_project(&self, id: i64, input: &ProjectInput) -> Result<(), DbError> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(DbError::Invalid("proje adi bos olamaz".into()));
        }
        let affected = self.conn.execute(
            "UPDATE projects SET
                 name        = ?2,
                 client_name = ?3,
                 phase       = ?4,
                 status      = ?5,
                 description = ?6,
                 deadline    = ?7,
                 updated_at  = strftime('%s','now')
             WHERE id = ?1",
            params![
                id,
                name,
                input.client_name,
                input.phase,
                input.status,
                input.description,
                input.deadline,
            ],
        )?;
        if affected == 0 {
            return Err(DbError::Invalid(format!("proje bulunamadi: {id}")));
        }
        Ok(())
    }

    /// Projeyi sil. FK `ON DELETE SET NULL` (0019) → atanmis asset'ler **KALIR** (yalniz
    /// `project_id` NULL olur; asset asla proje ile silinmez — CASCADE DEGIL). Idempotent
    /// (olmayan id → no-op). `&mut self`: FK yan-etkisi (asset satirlarini degistirir).
    pub fn delete_project(&mut self, id: i64) -> Result<(), DbError> {
        self.conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Asset'leri bir projeye (ata) veya `None` ise atamayi kaldir (project_id NULL). Etkilenen
    /// satir sayisini doner. **Tek TX** (atomik). Bos `ids` → 0 (no-op). Gecersiz `project_id`
    /// (olmayan proje) FK ON ile REDDEDILIR (`DbError::Sqlite`) → hayalet baglanti imkansiz.
    pub fn assign_assets_to_project(
        &mut self,
        ids: &[i64],
        project_id: Option<i64>,
    ) -> Result<usize, DbError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let placeholders = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("UPDATE assets SET project_id = ? WHERE id IN ({placeholders})");
        // Ilk param = hedef project_id (None → NULL), sonra id'ler (her biri ayri param →
        // SQL-injection yok). Value ile tek homojen dizi.
        let mut vals: Vec<Value> = Vec::with_capacity(ids.len() + 1);
        vals.push(project_id.map_or(Value::Null, Value::Integer));
        vals.extend(ids.iter().map(|&i| Value::Integer(i)));

        let tx = self.conn.transaction()?;
        let affected = tx.execute(&sql, rusqlite::params_from_iter(vals))?;
        tx.commit()?;
        Ok(affected)
    }

    /// Proje faceti (kenar cubugu filtresi) — her proje + **AKTIF** atanmis asset sayisi.
    /// `value` = proje **ID** (string): `ListOpts.project` filtresi id'ye baglandigindan
    /// (`collection` deseni gibi) facet degeri de id olmali → secilen facet dogrudan filtreye
    /// gider. Gorunen ADi frontend `list_projects`'ten alir (id→name). §O: cop haric
    /// (`deleted_at IS NULL`). LEFT JOIN → 0-asset proje de gorunur (count=0). Cok-atanan once.
    pub fn project_facets(&self) -> Result<Vec<Facet>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT p.id, count(a.id)
             FROM projects p
             LEFT JOIN assets a ON a.project_id = p.id AND a.deleted_at IS NULL
             GROUP BY p.id
             ORDER BY count(a.id) DESC, p.name ASC, p.id ASC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                let id: i64 = r.get(0)?;
                Ok(Facet { value: Some(id.to_string()), count: r.get(1)? })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// `name`'e sahip ILK projeyi (id ASC) dondur; yoksa `created_at` ile olustur (diger
    /// alanlar NULL). **Idempotent** (ayni ad → ayni id; kopya URETMEZ). Bos ad → `Invalid`.
    /// Oto klasor→proje atamasinin cekirdegi (re-scan'de ayni klasor ayni projeye baglanir).
    pub fn upsert_project_by_name(&self, name: &str, created_at: i64) -> Result<i64, DbError> {
        upsert_project_by_name_conn(&self.conn, name, created_at, None, None)
    }

    /// **Oto klasor→proje atamasi** (tarama sonu post-pass): `root` altindaki AKTIF
    /// (`deleted_at IS NULL`) + **henuz projesiz** (`project_id IS NULL`) asset'leri klasor
    /// adindan turetilen projeye baglar. Tek TX (atomik).
    ///
    /// Adimlar: (1) `root` on-ekli projesiz-aktif asset'leri cek → her biri icin
    /// [`project_name_from_path`]; `Some(name)` olanlari ada gore grupla (kok-alti dogrudan
    /// dosyalar `None` → atlanir). (2) Her ad icin [`upsert_project_by_name`] (bul/olustur) →
    /// o asset'leri `UPDATE ... SET project_id` — **`WHERE project_id IS NULL` guvencesi ile**
    /// (elle yapilmis atamayi ASLA ezmez; NULL-only).
    ///
    /// **Idempotent:** ikinci kosuda tum asset'ler zaten atanmis → SELECT bos → kopya proje
    /// olusmaz, yeni atama olmaz. Rapor: atanan asset + dokunulan proje sayisi.
    ///
    /// **Olcek:** bir klasordeki asset sayisi sinirsizdir → UPDATE'ler [`ASSIGN_ID_CHUNK`]
    /// buyuklugunde parcalara bolunur (SQLite degisken siniri; bkz govdedeki not).
    /// TX **tek** kalir: pass idempotent oldugu icin geri alma guvenlidir, yarim atama degil.
    pub fn auto_assign_projects_under(
        &mut self,
        root: &str,
        created_at: i64,
        default_status: Option<&str>,
    ) -> Result<AutoProjectReport, DbError> {
        let root_norm = root.trim_end_matches(['\\', '/']);
        if root_norm.is_empty() {
            return Ok(AutoProjectReport::default());
        }
        // Kok on-ekli aday satirlari daralt (LIKE `root%`, joker-escape'li). Windows LIKE
        // case-INSENSITIVE + kardes-on-ek over-match olabilir → kesin sinir/segment karari
        // Rust'ta `project_name_from_path` ile verilir (yanlis eslesme None → atlanir).
        let pat = format!("{}%", escape_like_prefix(Some(root_norm)).unwrap_or_default());

        let tx = self.conn.transaction()?;

        // (1) Aday asset'leri (id, path) topla → ada gore grupla. Her ad icin TEMSILI klasor
        // yolunu da sakla (ilk gorulen asset'ten; yeni proje `description`'i = provenance).
        // Statement bu blokta biter (asagidaki UPDATE'ler ayni TX'i odunc alabilsin diye).
        let mut by_name: BTreeMap<String, (String, Vec<i64>)> = BTreeMap::new();
        {
            let mut stmt = tx.prepare(
                "SELECT id, path FROM assets
                 WHERE deleted_at IS NULL AND project_id IS NULL AND path LIKE ?1 ESCAPE '\\'",
            )?;
            let mut rows = stmt.query(params![pat])?;
            while let Some(r) = rows.next()? {
                let id: i64 = r.get(0)?;
                let path: String = r.get(1)?;
                if let Some(name) = project_name_from_path(&path, root_norm) {
                    // Klasor yolu = root + ayrac + segment. `project_name_from_path` path'i
                    // root_norm ile CASE-SENSITIVE strip_prefix ile eslestirdi → bu dilim tam
                    // olarak `root_norm\name`; segment sonrasi daima ayrac (fn oyle bulur) →
                    // dilim siniri UTF-8 guvenli (ayrac ASCII tek-bayt).
                    let folder = path[..root_norm.len() + 1 + name.len()].to_string();
                    by_name.entry(name).or_insert_with(|| (folder, Vec::new())).1.push(id);
                }
            }
        }

        // (2) Her ad: upsert proje (yeniyse status="aktif"+description=klasor) + o asset'leri
        // ata (yalniz hala NULL olanlar).
        let mut assets_assigned: i64 = 0;
        let mut projects_touched: i64 = 0;
        for (name, (folder, ids)) in &by_name {
            let pid =
                upsert_project_by_name_conn(&tx, name, created_at, default_status, Some(folder))?;
            // ⚠️ Id listesi PARCALANIR. Tek UPDATE'te asset basina bir yer tutucu uretmek
            // SQLite'in degisken ust sinirina (surume gore 999 / 32.766) carpar; gercek
            // arsivde olculdu: `H:\PRJ\PRJ-Python` = 60.377 varlik → "too many SQL variables".
            // Hata `?` ile firlayip `tx.commit()` oncesi TUM islemi geri aldigi icin zarar o
            // klasorle SINIRLI KALMIYORDU — sinirin altindaki klasorlerin atamasi da yok
            // oluyordu (uretimde sonuc: 0 proje, 0 atama, ~23 dakika bosa is).
            for chunk in ids.chunks(ASSIGN_ID_CHUNK) {
                let placeholders = (0..chunk.len()).map(|_| "?").collect::<Vec<_>>().join(",");
                let sql = format!(
                    "UPDATE assets SET project_id = ? \
                     WHERE project_id IS NULL AND id IN ({placeholders})"
                );
                let mut vals: Vec<Value> = Vec::with_capacity(chunk.len() + 1);
                vals.push(Value::Integer(pid));
                vals.extend(chunk.iter().map(|&i| Value::Integer(i)));
                assets_assigned += tx.execute(&sql, params_from_iter(vals))? as i64;
            }
            projects_touched += 1;
        }

        tx.commit()?;
        Ok(AutoProjectReport { assets_assigned, projects_touched })
    }
}

#[cfg(test)]
mod tests {
    use super::project_name_from_path;

    /// `project_name_from_path`: kok-alti ilk klasor segmenti dogru cikar; kenar durumlar.
    #[test]
    fn project_name_from_path_rules() {
        // Kok-alti ILK klasor segmenti (sonrasinda dosya var → klasor).
        assert_eq!(
            project_name_from_path(r"C:\Projeler\Villa-A\plan.dwg", r"C:\Projeler").as_deref(),
            Some("Villa-A")
        );
        // Derin yol → yine yalniz ILK segment.
        assert_eq!(
            project_name_from_path(r"C:\Projeler\Villa-A\alt\kat\a.dwg", r"C:\Projeler").as_deref(),
            Some("Villa-A")
        );

        // Dosya DOGRUDAN kok altinda (ilk segment yok) → None (projesiz).
        assert_eq!(project_name_from_path(r"C:\Projeler\readme.txt", r"C:\Projeler"), None);

        // Path root ile BASLAMIYOR → None.
        assert_eq!(project_name_from_path(r"D:\Baska\x\y.dwg", r"C:\Projeler"), None);

        // Kardes-on-ek KORUMA: root "C:\Proj" path "C:\Projeler\..." ESLESMEZ (on-ekten
        // hemen sonra ayrac yok → None). H2 denormalize-string tuzaginin yapisal onlemi.
        assert_eq!(project_name_from_path(r"C:\Projeler\V\a.dwg", r"C:\Proj"), None);

        // Kok sonu ayracli VE ayracsiz ikisi de calismali (normalize).
        assert_eq!(
            project_name_from_path(r"C:\Projeler\Villa-A\p.dwg", r"C:\Projeler\").as_deref(),
            Some("Villa-A")
        );

        // Forward-slash ayrac (cok-OS) — hem path hem root.
        assert_eq!(
            project_name_from_path("C:/Projeler/Villa-A/plan.dwg", "C:/Projeler").as_deref(),
            Some("Villa-A")
        );
        // Karisik ayrac (root `\`, path `/`) — ayrac normalize edilmez ama segment sinirinda
        // her iki ayrac da taninir.
        assert_eq!(
            project_name_from_path(r"C:\Projeler/Villa-A/plan.dwg", r"C:\Projeler").as_deref(),
            Some("Villa-A")
        );

        // UNC yol → surucu-koku gibi calisir (ilk segment).
        assert_eq!(
            project_name_from_path(r"\\server\share\Villa-A\p.dwg", r"\\server\share").as_deref(),
            Some("Villa-A")
        );
        // UNC kok-alti dogrudan dosya → None.
        assert_eq!(project_name_from_path(r"\\server\share\p.dwg", r"\\server\share"), None);

        // path == root (dosya degil, koke esit) → None.
        assert_eq!(project_name_from_path(r"C:\Projeler", r"C:\Projeler"), None);
        // Bos root → None (guard).
        assert_eq!(project_name_from_path(r"C:\Projeler\V\a.dwg", ""), None);
        // Cift-ayrac → bos segment → None.
        assert_eq!(project_name_from_path(r"C:\Projeler\\a.dwg", r"C:\Projeler"), None);
    }
}
