//! Yinelenen/benzer dosya tespiti (P3 dedup; H2 `duplicateDetection.ts` modlarindan uyarlama).
//!
//! **H2 farki (H3 tezi):** H2 hesabi RENDERER'da tum asset bellek-ici uzerinde yapardi; burada
//! hesap Rust+DB'de (veri Rust'ta). 3 mod:
//! - **Birebir (`ExactHash`):** ayni `content_hash` (BLAKE3) → gercek kopya. SQL GROUP BY.
//! - **Ayni ad (`SameName`):** ayni `lower(file_name)` (farkli konum). SQL GROUP BY.
//! - **Gorsel benzer (`VisualSimilar`):** `phash` Hamming mesafesi <= esik → union-find grup.
//!   PSD dahil (yeni: PSD artik phash uretiyor).
//! - **Yapisal benzer (`StructuralSimilar`):** DXF/DWG cizim geometrisi — iki asset'in SEKIL
//!   KUMELERI Jaccard-benzeri ortusme ile karsilastirilir (`shape::compute_shape_similarity`
//!   cekirdegi reuse). Union-find grup. (Backlog "dedup-yapisal (Jaccard)"; onceden ERTELENDI.)
//!
//! Yalniz AKTIF asset (`deleted_at IS NULL`). Gorsel + yapisal O(n^2) (istek-uzeri; komut async).

use std::collections::HashMap;

use crate::error::DbError;
use crate::shape::{asset_shape_overlap, ShapeQuery};
use crate::Db;

/// Yineleme grubu turu.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DupKind {
    ExactHash,
    SameName,
    VisualSimilar,
    StructuralSimilar,
}

impl DupKind {
    /// Kararli anahtar (IPC/DTO).
    pub fn as_str(self) -> &'static str {
        match self {
            DupKind::ExactHash => "exact_hash",
            DupKind::SameName => "same_name",
            DupKind::VisualSimilar => "visual_similar",
            DupKind::StructuralSimilar => "structural_similar",
        }
    }
}

/// Bir yineleme grubunun uyesi (asset ozeti).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DupMember {
    pub id: i64,
    pub path: String,
    pub file_name: String,
    pub size_bytes: i64,
}

/// Bir yineleme grubu (>=2 uye).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DupGroup {
    pub kind: DupKind,
    /// 0-100 benzerlik (birebir/ayni-ad = 100; gorsel = Hamming'den turer).
    pub score: u32,
    pub members: Vec<DupMember>,
}

/// Gorsel karsilastirmaya giren uzantilar (ImageExtractor ile ayni; PSD dahil).
const IMAGE_EXTS: &[&str] = &["jpg", "jpeg", "png", "bmp", "tif", "tiff", "tga", "gif", "psd"];

/// Ardisik (key, uye) satirlarini >=2'li gruplara topla (SQL zaten key'e gore sirali doner).
fn group_consecutive(rows: Vec<(String, DupMember)>, kind: DupKind, score: u32) -> Vec<DupGroup> {
    let mut groups: Vec<DupGroup> = Vec::new();
    let mut key: Option<String> = None;
    let mut cur: Vec<DupMember> = Vec::new();
    for (k, m) in rows {
        if key.as_deref() != Some(k.as_str()) {
            if cur.len() >= 2 {
                groups.push(DupGroup { kind, score, members: std::mem::take(&mut cur) });
            } else {
                cur.clear();
            }
            key = Some(k);
        }
        cur.push(m);
    }
    if cur.len() >= 2 {
        groups.push(DupGroup { kind, score, members: cur });
    }
    groups
}

fn uf_find(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]]; // yol yaridi
        x = parent[x];
    }
    x
}

impl Db {
    /// **Birebir kopya:** ayni `content_hash` (>=2 aktif asset). Score 100. Alt-sorgu yalniz
    /// yinelenen hash'leri getirir → tekil dosyalar taranmaz.
    pub fn duplicate_exact(&self) -> Result<Vec<DupGroup>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT content_hash, id, path, file_name, size_bytes FROM assets
             WHERE deleted_at IS NULL AND content_hash IS NOT NULL AND content_hash <> ''
               AND content_hash IN (
                 SELECT content_hash FROM assets
                 WHERE deleted_at IS NULL AND content_hash IS NOT NULL AND content_hash <> ''
                 GROUP BY content_hash HAVING count(*) >= 2)
             ORDER BY content_hash, id",
        )?;
        let rows = stmt
            .query_map([], row_to_keyed)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(group_consecutive(rows, DupKind::ExactHash, 100))
    }

    /// **Ayni ad, farkli konum:** ayni `lower(file_name)` (>=2 aktif asset). Score 100.
    pub fn duplicate_same_name(&self) -> Result<Vec<DupGroup>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT lower(file_name), id, path, file_name, size_bytes FROM assets
             WHERE deleted_at IS NULL AND file_name <> ''
               AND lower(file_name) IN (
                 SELECT lower(file_name) FROM assets
                 WHERE deleted_at IS NULL AND file_name <> ''
                 GROUP BY lower(file_name) HAVING count(*) >= 2)
             ORDER BY lower(file_name), id",
        )?;
        let rows = stmt
            .query_map([], row_to_keyed)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(group_consecutive(rows, DupKind::SameName, 100))
    }

    /// **Gorsel benzer:** `phash` Hamming mesafesi <= `max_distance` olan gorseller union-find ile
    /// gruplanir (PSD dahil). Score grup icindeki EN KOTU (en buyuk) kenar mesafesinden turer
    /// (muhafazakar; H2 min-score deseni). O(n^2) — istek-uzeri; cagiran async kosar.
    ///
    /// `should_stop`: DIS iptal yoklamasi — her SATIRDA (i dongusu basi) bir kez cagrilir.
    /// `true` donerse [`DbError::Cancelled`] ile erken cikilir. Neden satir basi: ic dongu
    /// (j) cok sik doner, her adimda atomic okumak olcum edilebilir yavaslatir; satir basi
    /// yoklama 40K gorselde bile ~milisaniye tepki verir.
    pub fn duplicate_visual(
        &self,
        max_distance: u32,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<Vec<DupGroup>, DbError> {
        let ph = IMAGE_EXTS.iter().map(|e| format!("'{e}'")).collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, path, file_name, size_bytes, phash FROM assets
             WHERE deleted_at IS NULL AND phash IS NOT NULL AND ext IN ({ph})
             ORDER BY id"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let items = stmt
            .query_map([], |r| {
                Ok((
                    DupMember {
                        id: r.get(0)?,
                        path: r.get(1)?,
                        file_name: r.get(2)?,
                        size_bytes: r.get(3)?,
                    },
                    r.get::<_, i64>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;

        let n = items.len();
        if n < 2 {
            return Ok(Vec::new());
        }
        let mut parent: Vec<usize> = (0..n).collect();
        let mut edges: Vec<(usize, u32)> = Vec::new(); // (i, dist) — union sonrasi kok-skoru icin
        for i in 0..n {
            if should_stop() {
                return Err(DbError::Cancelled);
            }
            for j in (i + 1)..n {
                let dist = (items[i].1 ^ items[j].1).count_ones();
                if dist <= max_distance {
                    let (ri, rj) = (uf_find(&mut parent, i), uf_find(&mut parent, j));
                    if ri != rj {
                        parent[ri] = rj;
                    }
                    edges.push((i, dist));
                }
            }
        }

        // Kok → uyeler + en kotu kenar mesafesi.
        let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
        for idx in 0..n {
            let r = uf_find(&mut parent, idx);
            members.entry(r).or_default().push(idx);
        }
        let mut worst: HashMap<usize, u32> = HashMap::new();
        for &(i, dist) in &edges {
            let r = uf_find(&mut parent, i);
            let e = worst.entry(r).or_insert(0);
            *e = (*e).max(dist);
        }

        let mut groups: Vec<DupGroup> = Vec::new();
        for (root, idxs) in members {
            if idxs.len() < 2 {
                continue;
            }
            let d = *worst.get(&root).unwrap_or(&max_distance);
            let score = 100u32.saturating_sub((d * 100 + 32) / 64); // round(d/64*100)
            let mut mem: Vec<DupMember> = idxs.into_iter().map(|k| items[k].0.clone()).collect();
            mem.sort_by_key(|m| m.id);
            groups.push(DupGroup { kind: DupKind::VisualSimilar, score, members: mem });
        }
        // Kararli sira: score azalan, sonra ilk uye id.
        groups.sort_by(|a, b| {
            b.score.cmp(&a.score).then_with(|| a.members[0].id.cmp(&b.members[0].id))
        });
        Ok(groups)
    }

    /// **Yapisal benzer (DXF/DWG):** cizim geometrisi ortusmesi. Sekli olan (`asset_shapes`'te
    /// kaydi olan) aktif asset'ler yuklenir; her asset-cifti [`asset_shape_overlap`] (Jaccard-
    /// benzeri; `shape::compute_shape_similarity` cekirdegi reuse) ile skorlanir; `>= min_score`
    /// olanlar union-find ile gruplanir. Grup score = grup icindeki EN KOTU (en dusuk) kenar skoru
    /// (muhafazakar; visual deseni). `min_score` 0..=100. `asset_shapes` yalniz DXF/DWG'den
    /// uretilir → ext filtresi gereksiz. O(n^2·m^2) — istek-uzeri; komut async kosar.
    ///
    /// `should_stop`: bkz [`Db::duplicate_visual`] — satir basi iptal yoklamasi. Bu yol daha da
    /// pahali (O(n²·m²), her cift icin sekil ortusmesi) → iptal burada daha kritiktir.
    pub fn duplicate_structural(
        &self,
        min_score: u32,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<Vec<DupGroup>, DbError> {
        let min_score = min_score.min(100);
        // compute_shape_similarity'nin okudugu alanlar yuklenir; area/centroid/entity_type skoru
        // etkilemez → default. ORDER BY asset_id → deterministik indeks sirasi.
        let mut by_asset: Vec<(DupMember, Vec<ShapeQuery>)> = Vec::new();
        let mut idx_of: HashMap<i64, usize> = HashMap::new();
        {
            let mut stmt = self.conn.prepare(
                "SELECT s.asset_id, a.path, a.file_name, a.size_bytes,
                        s.vertex_count, s.is_closed,
                        COALESCE(s.perimeter,0), COALESCE(s.aspect_ratio,0), COALESCE(s.regularity,0),
                        COALESCE(s.compactness,0), COALESCE(s.solidity,0), COALESCE(s.rectangularity,0),
                        COALESCE(s.bbox_w,0), COALESCE(s.bbox_h,0)
                 FROM asset_shapes s JOIN assets a ON a.id = s.asset_id
                 WHERE a.deleted_at IS NULL
                 ORDER BY s.asset_id",
            )?;
            let mut rows = stmt.query([])?;
            while let Some(r) = rows.next()? {
                let asset_id: i64 = r.get(0)?;
                let shape = ShapeQuery {
                    entity_type: String::new(),
                    vertex_count: r.get(4)?,
                    is_closed: r.get::<_, i64>(5)? != 0,
                    area: 0.0,
                    perimeter: r.get(6)?,
                    aspect_ratio: r.get(7)?,
                    regularity: r.get(8)?,
                    compactness: r.get(9)?,
                    solidity: r.get(10)?,
                    rectangularity: r.get(11)?,
                    bbox_w: r.get(12)?,
                    bbox_h: r.get(13)?,
                    centroid_x: 0.0,
                    centroid_y: 0.0,
                };
                match idx_of.get(&asset_id) {
                    Some(&i) => by_asset[i].1.push(shape),
                    None => {
                        idx_of.insert(asset_id, by_asset.len());
                        let member = DupMember {
                            id: asset_id,
                            path: r.get(1)?,
                            file_name: r.get(2)?,
                            size_bytes: r.get(3)?,
                        };
                        by_asset.push((member, vec![shape]));
                    }
                }
            }
        }

        let n = by_asset.len();
        if n < 2 {
            return Ok(Vec::new());
        }
        let mut parent: Vec<usize> = (0..n).collect();
        let mut edges: Vec<(usize, u32)> = Vec::new();
        for i in 0..n {
            if should_stop() {
                return Err(DbError::Cancelled);
            }
            for j in (i + 1)..n {
                let score = asset_shape_overlap(&by_asset[i].1, &by_asset[j].1);
                if score >= min_score && score > 0 {
                    let (ri, rj) = (uf_find(&mut parent, i), uf_find(&mut parent, j));
                    if ri != rj {
                        parent[ri] = rj;
                    }
                    edges.push((i, score));
                }
            }
        }

        // Kok → uyeler + en KOTU (en dusuk) kenar skoru (muhafazakar grup skoru).
        let mut members: HashMap<usize, Vec<usize>> = HashMap::new();
        for idx in 0..n {
            let r = uf_find(&mut parent, idx);
            members.entry(r).or_default().push(idx);
        }
        let mut worst: HashMap<usize, u32> = HashMap::new();
        for &(i, score) in &edges {
            let r = uf_find(&mut parent, i);
            let e = worst.entry(r).or_insert(100);
            *e = (*e).min(score);
        }

        let mut groups: Vec<DupGroup> = Vec::new();
        for (root, idxs) in members {
            if idxs.len() < 2 {
                continue;
            }
            let score = *worst.get(&root).unwrap_or(&min_score);
            let mut mem: Vec<DupMember> = idxs.into_iter().map(|k| by_asset[k].0.clone()).collect();
            mem.sort_by_key(|m| m.id);
            groups.push(DupGroup { kind: DupKind::StructuralSimilar, score, members: mem });
        }
        groups.sort_by(|a, b| {
            b.score.cmp(&a.score).then_with(|| a.members[0].id.cmp(&b.members[0].id))
        });
        Ok(groups)
    }
}

/// `(key, DupMember)` satir eslesme yardimcisi (exact/same-name paylasir).
fn row_to_keyed(r: &rusqlite::Row) -> rusqlite::Result<(String, DupMember)> {
    Ok((
        r.get::<_, String>(0)?,
        DupMember { id: r.get(1)?, path: r.get(2)?, file_name: r.get(3)?, size_bytes: r.get(4)? },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    /// Iptal ETMEYEN yoklama — mevcut testlerin davranisi degismesin.
    fn never_stop() -> bool {
        false
    }

    fn seed(db: &Db, id: i64, name: &str, hash: Option<&str>, ext: &str, phash: Option<i64>) {
        db.connection()
            .execute(
                "INSERT INTO assets(id, path, file_name, ext, size_bytes, content_hash, phash, created_at, modified_at)
                 VALUES (?1, ?2, ?3, ?4, 10, ?5, ?6, 1, 1)",
                params![id, format!("/a/{id}/{name}"), name, ext, hash, phash],
            )
            .unwrap();
    }

    #[test]
    fn exact_hash_groups_only_duplicates() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed(&db, 1, "a.jpg", Some("H1"), "jpg", None);
        seed(&db, 2, "b.jpg", Some("H1"), "jpg", None); // 1&2 ayni icerik
        seed(&db, 3, "c.jpg", Some("H2"), "jpg", None); // tekil
        let g = db.duplicate_exact().unwrap();
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].kind, DupKind::ExactHash);
        assert_eq!(g[0].score, 100);
        assert_eq!(g[0].members.iter().map(|m| m.id).collect::<Vec<_>>(), vec![1, 2]);
    }

    #[test]
    fn same_name_case_insensitive() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed(&db, 1, "Plan.dwg", Some("X"), "dwg", None);
        seed(&db, 2, "plan.dwg", Some("Y"), "dwg", None); // farkli icerik, ayni ad
        seed(&db, 3, "other.dwg", None, "dwg", None);
        let g = db.duplicate_same_name().unwrap();
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].members.len(), 2);
    }

    #[test]
    fn visual_similar_groups_by_hamming() {
        let db = Db::open_in_memory_migrated().unwrap();
        // 1 & 2: 1 bit fark (Hamming 1) → esik 5 icinde grup. 3: cok uzak.
        seed(&db, 1, "x.jpg", None, "jpg", Some(0b0));
        seed(&db, 2, "y.jpg", None, "jpg", Some(0b1));
        seed(&db, 3, "z.jpg", None, "jpg", Some(-1)); // tum 64 bit set → 1&2'ye Hamming 63-64
        // phash'siz gorsel + gorsel-disi eslenmez.
        seed(&db, 4, "doc.pdf", None, "pdf", Some(0b0));
        let g = db.duplicate_visual(5, &never_stop).unwrap();
        assert_eq!(g.len(), 1, "yalniz 1&2 grubu");
        assert_eq!(g[0].kind, DupKind::VisualSimilar);
        assert_eq!(g[0].members.iter().map(|m| m.id).collect::<Vec<_>>(), vec![1, 2]);
        // Hamming 1 → score 100 - round(1/64*100)=98.
        assert_eq!(g[0].score, 98);
        // Esik 0 → hicbir grup (birebir ayni phash yok).
        assert!(db.duplicate_visual(0, &never_stop).unwrap().is_empty());
    }

    /// Y1: iptal yoklamasi `true` donunce tarama ERKEN cikar ve **Cancelled** dondurur.
    ///
    /// ⚠️ Bos `Ok(vec![])` DEGIL: iptal edilen tarama "kopya bulunamadi" gibi gorunmemeli
    /// (sessiz yanlis cevap). Bu ayrim UI'nin dogru mesaji secmesinin tek dayanagidir.
    #[test]
    fn visual_scan_is_cancellable() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed(&db, 1, "x.jpg", None, "jpg", Some(0b0));
        seed(&db, 2, "y.jpg", None, "jpg", Some(0b1));
        let err = db.duplicate_visual(5, &|| true).unwrap_err();
        assert!(matches!(err, DbError::Cancelled), "iptal Cancelled dondurmeli, aldim: {err:?}");
    }


    /// Test sekli (kapali/acik + ozellikler). area/perimeter/bbox sabit; skorlama vc/kapalilik/
    /// ar/reg/compact/solid/rect kullanir.
    fn shape(
        vc: i64,
        closed: bool,
        ar: f64,
        reg: f64,
        compact: f64,
        solid: f64,
        rect: f64,
    ) -> crate::shape::ShapeInput {
        crate::shape::ShapeInput {
            entity_type: "LWPOLYLINE".into(),
            layer_name: None,
            vertex_count: vc,
            is_closed: closed,
            area: 25.0,
            perimeter: 20.0,
            aspect_ratio: ar,
            regularity: reg,
            compactness: compact,
            solidity: solid,
            rectangularity: rect,
            bbox_w: 5.0,
            bbox_h: 5.0,
            centroid_x: 0.0,
            centroid_y: 0.0,
        }
    }

    #[test]
    fn structural_groups_by_shape_overlap() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed(&db, 1, "plan_a.dwg", None, "dwg", None);
        seed(&db, 2, "plan_b.dwg", None, "dwg", None);
        seed(&db, 3, "farkli.dwg", None, "dwg", None);
        // 1 & 2: OZDES sekil kumesi → tam ortusme (score 100).
        let sq = shape(4, true, 1.0, 0.9, 0.8, 0.95, 0.9);
        db.set_asset_shapes(1, std::slice::from_ref(&sq)).unwrap();
        db.set_asset_shapes(2, std::slice::from_ref(&sq)).unwrap();
        // 3: cok farkli (acik, 50 vertex, dusuk ozellik) → 1/2 ile eslesmez (acik↔kapali rejimi <0.9).
        db.set_asset_shapes(3, &[shape(50, false, 5.0, 0.1, 0.1, 0.1, 0.1)]).unwrap();

        let g = db.duplicate_structural(80, &never_stop).unwrap();
        assert_eq!(g.len(), 1, "yalniz 1&2 grubu: {g:?}");
        assert_eq!(g[0].kind, DupKind::StructuralSimilar);
        assert_eq!(g[0].members.iter().map(|m| m.id).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(g[0].score, 100, "ozdes sekil kumeleri → tam ortusme");

        // Tek sekilli asset → grup yok (< 2 sekilli asset).
        let db2 = Db::open_in_memory_migrated().unwrap();
        seed(&db2, 1, "x.dwg", None, "dwg", None);
        db2.set_asset_shapes(1, std::slice::from_ref(&sq)).unwrap();
        assert!(db2.duplicate_structural(80, &never_stop).unwrap().is_empty(), "tek sekilli asset → grup yok");
    }

    /// Y1: ayni iptal yoklamasi YAPISAL yolda da gecerli — asil pahali dal (O(n²·m²)).
    #[test]
    fn structural_scan_is_cancellable() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed(&db, 1, "a.dwg", None, "dwg", None);
        seed(&db, 2, "b.dwg", None, "dwg", None);
        let sq = shape(4, true, 1.0, 0.9, 0.8, 0.95, 0.9);
        db.set_asset_shapes(1, std::slice::from_ref(&sq)).unwrap();
        db.set_asset_shapes(2, std::slice::from_ref(&sq)).unwrap();
        let err = db.duplicate_structural(80, &|| true).unwrap_err();
        assert!(matches!(err, DbError::Cancelled), "iptal Cancelled dondurmeli, aldim: {err:?}");
    }
}
