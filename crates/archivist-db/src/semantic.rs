//! Semantik (vektor) arama veri katmani — Faz 5.1.
//!
//! sqlite-vec (DB-ici) uzerinde kNN + ortak `FILTER_FRAG` (cop/ext/tag/... dislama).
//! **Embedding URETIMI bu katmanda DEGIL** — `archivist-db` ONNX'ten bagimsiz kalir
//! (temiz katman): ust katman (src-tauri) `archivist-embed` ile vektoru uretir, burada
//! `set_vector` ile yazar. Bu modul yalniz: bekleyenleri listele · vektor yaz · ara.
//!
//! kNN + filtre **iki adim**: sqlite-vec kNN sorgusunda keyfi JOIN guvenilir degil →
//! once aday id+mesafe cekilir, sonra ayni `FILTER_FRAG` ile hidratlanir (cop'e atilmis
//! veya filtreye uymayan asset elenir), mesafe sirasinda ilk k doner.

use std::collections::HashMap;

use rusqlite::params;

use crate::error::DbError;
use crate::index_skips::IndexStage;
use crate::query::{
    map_asset_row, AssetPage, AssetRow, FilterBinds, ListOpts,
    AI_A, AI_GORSEL_TURU_EXPR, COLS_A, DOMINANT_COLORS_EXPR, FAV_A, FILTER_FRAG,
};
use crate::Db;

/// Metin embedding boyutu — `asset_vectors FLOAT[384]` (migration 0009) ile AYNI olmali.
/// `archivist-embed::TEXT_EMBED_DIM` ile esit; burada tekrar tanimli (db ONNX'e bagli degil).
pub const TEXT_EMBED_DIM: usize = 384;

/// kNN aday carpani: filtreler kNN SONRASI uygulandigindan, k sonuç garanti etmek icin
/// daha fazla aday cekilir (filtre bazilarini eler). Aday = (k * FETCH_MULT).min(FETCH_CAP).
pub(crate) const FETCH_MULT: i64 = 4;
pub(crate) const FETCH_CAP: i64 = 500;

/// Semantik sonuç sayisi kelepceleme: <=0 → 50, ust sinir 200 (top-k; derin sayfalama yok).
/// `pub(crate)`: gorsel arama (image.rs) ayni top-k kelepcesini paylasir.
pub(crate) fn clamp_k(n: i64) -> i64 {
    if n <= 0 {
        50
    } else {
        n.min(200)
    }
}

/// Embedlenmeyi bekleyen bir asset: id + embeddlenecek metin parcalari (title +
/// file_name + tam-metin govdesi). Ust katman bunlari birlestirip embedler.
#[derive(Debug, Clone)]
pub struct PendingEmbed {
    pub id: i64,
    pub file_name: String,
    pub title: Option<String>,
    /// assets_fts.body — tam cikarilan metin (bos olabilir).
    pub body: String,
}

impl PendingEmbed {
    /// Embeddlenecek temsil metni: baslik + dosya adi + govde (modele beslenir). Title/
    /// file_name once → govdesiz (kisa-metinli) asset'lerde bile anlamli vektor uretilir.
    pub fn embed_text(&self) -> String {
        let mut s = String::new();
        if let Some(t) = &self.title {
            if !t.is_empty() {
                s.push_str(t);
                s.push('\n');
            }
        }
        s.push_str(&self.file_name);
        if !self.body.is_empty() {
            s.push('\n');
            s.push_str(&self.body);
        }
        s
    }
}

/// f32 vektoru sqlite-vec'in bekledigi little-endian BLOB'a cevir (smoke_100k deseni).
/// `pub(crate)`: gorsel arama (image.rs) ayni kodlamayi paylasir.
pub(crate) fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    let mut b = Vec::with_capacity(v.len() * 4);
    for f in v {
        b.extend_from_slice(&f.to_le_bytes());
    }
    b
}

/// LE f32 BLOB → vektor ([`vec_to_blob`] tersi; depolanmis embedding'i geri okur).
fn blob_to_vec(blob: &[u8]) -> Vec<f32> {
    blob.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect()
}

/// Iki vektorun cosine benzerligi (dot / (|a|·|b|)). Vektorler birim olmasa bile dogru → vec0
/// mesafe-metriginden BAGIMSIZ (image.rs `cosine` deseni; MiniLM vektorleri zaten L2-normal ama
/// guard'li). `[-1, 1]`; yuksek = daha benzer. Bos/sifir vektor → 0.
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let (mut dot, mut na, mut nb) = (0f32, 0f32, 0f32);
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
        na += a[i] * a[i];
        nb += b[i] * b[i];
    }
    if na == 0.0 || nb == 0.0 {
        0.0
    } else {
        dot / (na.sqrt() * nb.sqrt())
    }
}

impl Db {
    /// Embedlenmeyi bekleyen (vektoru olmayan, cope atilmamis) asset sayisi. UI ilerleme
    /// gostergesi (X / N) ve "embedding gerekli mi" karari icin.
    pub fn pending_embed_count(&self) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM assets a
             WHERE a.deleted_at IS NULL
               AND NOT EXISTS (SELECT 1 FROM asset_vectors v WHERE v.asset_id = a.id)
               AND NOT EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = ?1)",
            params![IndexStage::Text.as_str()],
            |r| r.get(0),
        )?)
    }

    /// Toplam vektor (embedlenmis asset) sayisi.
    pub fn vector_count(&self) -> Result<i64, DbError> {
        Ok(self
            .conn
            .query_row("SELECT count(*) FROM asset_vectors", [], |r| r.get(0))?)
    }

    /// Vektoru olmayan, `after_id`'den buyuk id'li ilk `limit` asset'i embeddlenecek
    /// metniyle getir (resumable batch). **Cursor (`id > after_id`):** ust katmandaki
    /// embed dongusu `after_id`'yi son islenen id'ye tasiyarak ILERLER → embed'i basarisiz
    /// olan asset (vektoru hala yok) ayni kosuda tekrar getirilmez (sonsuz dongu onlenir).
    /// Yeni bir kosuda `after_id=0` → onceki basarisizlar yeniden denenir (vektoru olmayan
    /// + cope atilmamis filtresi korunur). `id` artan → kararli ilerleme.
    pub fn assets_without_vectors(
        &self,
        after_id: i64,
        limit: i64,
    ) -> Result<Vec<PendingEmbed>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT a.id, a.file_name, a.title, COALESCE(fts.body, '')
             FROM assets a
             LEFT JOIN assets_fts fts ON fts.asset_id = a.id
             WHERE a.deleted_at IS NULL
               AND a.id > ?1
               AND NOT EXISTS (SELECT 1 FROM asset_vectors v WHERE v.asset_id = a.id)
               AND NOT EXISTS (SELECT 1 FROM index_skips s
                               WHERE s.asset_id = a.id AND s.stage = ?2)
             ORDER BY a.id
             LIMIT ?3",
        )?;
        let rows = stmt.query_map(params![after_id, IndexStage::Text.as_str(), limit], |r| {
            Ok(PendingEmbed {
                id: r.get(0)?,
                file_name: r.get(1)?,
                title: r.get(2)?,
                body: r.get(3)?,
            })
        })?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(Into::into)
    }

    /// Bir asset'in metin vektorunu yaz (upsert). `vec.len()` 384 (TEXT_EMBED_DIM) olmali;
    /// degilse `Invalid` (vec0 zaten reddederdi ama erken + net hata).
    pub fn set_vector(&self, asset_id: i64, vec: &[f32]) -> Result<(), DbError> {
        if vec.len() != TEXT_EMBED_DIM {
            return Err(DbError::Invalid(format!(
                "vektor boyutu {} != {TEXT_EMBED_DIM}",
                vec.len()
            )));
        }
        let blob = vec_to_blob(vec);
        // vec0 sanal tablosu UPSERT (ON CONFLICT) DESTEKLEMEZ → DELETE + INSERT. Tek
        // TX'te atomik (yeniden-embedlemede eski vektor silinip yenisi yazilir).
        // `unchecked_transaction`: &self ile TX (Db API'si yalniz &self verir).
        let tx = self.conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM asset_vectors WHERE asset_id = ?1",
            params![asset_id],
        )?;
        tx.execute(
            "INSERT INTO asset_vectors(asset_id, embedding) VALUES (?1, ?2)",
            params![asset_id, blob],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Semantik arama: `query` vektorune en yakin `k` asset, **mesafe artan** (en benzer
    /// once). `k = clamp_k(opts.page_size)`. Filtreler (cop/ext/tag/collection/favori/
    /// tarih/onay/yol) ortak `FILTER_FRAG` ile kNN sonrasi uygulanir. `AssetPage.total` =
    /// dondurulen sonuç sayisi (top-k; gercek toplam degil — derin sayfalama yok).
    pub fn semantic_search(&self, query: &[f32], opts: &ListOpts) -> Result<AssetPage, DbError> {
        if query.len() != TEXT_EMBED_DIM {
            return Err(DbError::Invalid(format!(
                "sorgu vektoru boyutu {} != {TEXT_EMBED_DIM}",
                query.len()
            )));
        }
        let k = clamp_k(opts.page_size);
        let fetch = (k * FETCH_MULT).min(FETCH_CAP);
        let qblob = vec_to_blob(query);

        // 1) kNN adaylari (mesafe artan). LIMIT literal (sqlite-vec planlayici parametreli
        //    LIMIT'i her zaman kNN olarak tanimaz; `fetch` kendi i64'umuz → guvenli inline).
        //    `embedding` de cekilir → asset basina GERCEK cosine hesaplanir (vec0 mesafe-metriginden
        //    BAGIMSIZ skor; frontend "% benzerlik rozeti"ni bundan uretir — image_search_scored deseni).
        //    Birim-normal MiniLM vektorlerinde cosine sirasi = mesafe sirasi → yeniden siralamaya
        //    gerek yok; skor yalniz kNN sirasina EKLENIR.
        let mut knn = self.conn.prepare(&format!(
            "SELECT asset_id, embedding FROM asset_vectors
             WHERE embedding MATCH ?1 ORDER BY distance LIMIT {fetch}"
        ))?;
        let candidates: Vec<(i64, f32)> = knn
            .query_map(params![qblob], |r| {
                let id: i64 = r.get(0)?;
                let blob: Vec<u8> = r.get(1)?;
                Ok((id, cosine(query, &blob_to_vec(&blob))))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        if candidates.is_empty() {
            return Ok(AssetPage {
                total: 0,
                items: Vec::new(),
            });
        }

        // 2) Filtreyle hidratla. id IN (<inline>): id'ler kendi kNN sorgumuzdan gelen i64
        //    → SQL-injection yok; FILTER_FRAG adli parametreleri list_filtered ile birebir.
        let id_list = candidates
            .iter()
            .map(|(id, _cos)| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let binds = FilterBinds::new(opts);
        let common = binds.params();

        let sql = format!(
            "SELECT {COLS_A}, {FAV_A}, NULL, {AI_A}, {AI_GORSEL_TURU_EXPR}, {DOMINANT_COLORS_EXPR} FROM assets a
             WHERE a.id IN ({id_list}) AND {FILTER_FRAG}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut by_id: HashMap<i64, AssetRow> = HashMap::new();
        let rows = stmt.query_map(common.as_slice(), map_asset_row)?;
        for row in rows {
            let row = row?;
            by_id.insert(row.id, row);
        }

        // 3) Mesafe sirasinda hayatta kalanlari ilk k al (kNN sirasi korunur). Her satira o asset'in
        //    GERCEK cosine skoru islenir (yalniz bu yolda; diger okuma yollari `score=None` birakir).
        let mut items = Vec::with_capacity(k as usize);
        for (id, cos) in &candidates {
            if let Some(mut row) = by_id.remove(id) {
                row.score = Some(*cos);
                items.push(row);
                if items.len() >= k as usize {
                    break;
                }
            }
        }
        let total = items.len() as i64;
        Ok(AssetPage { total, items })
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    fn unit(hot: usize) -> Vec<f32> {
        let mut v = vec![0f32; TEXT_EMBED_DIM];
        v[hot] = 1.0;
        v
    }

    fn seed_asset(db: &Db, id: i64, name: &str) {
        db.connection()
            .execute(
                "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
                 VALUES (?1, ?2, ?3, 'txt', 10, 1, 1)",
                params![id, format!("/a/{name}"), name],
            )
            .unwrap();
    }

    fn make_db() -> Db {
        Db::open_in_memory_migrated().unwrap()
    }

    #[test]
    fn search_ranks_by_distance_and_excludes_trash() {
        let db = make_db();
        for (id, name) in [(1, "a.txt"), (2, "b.txt"), (3, "c.txt")] {
            seed_asset(&db, id, name);
        }
        db.set_vector(1, &unit(0)).unwrap();
        db.set_vector(2, &unit(1)).unwrap();
        db.set_vector(3, &unit(2)).unwrap();

        let opts = ListOpts {
            page_size: 10,
            ..Default::default()
        };
        // 0. boyuta hizali sorgu → en yakin asset 1.
        let page = db.semantic_search(&unit(0), &opts).unwrap();
        assert_eq!(page.items.first().map(|r| r.id), Some(1), "en yakin asset 1 olmali");
        assert_eq!(page.total, 3);
        // Skor tel-sozlesmesi: en yakin asset (birebir vektor) cosine ~1.0; skor DOLU + azalan.
        let s0 = page.items[0].score.expect("semantik yol skor doldurmali");
        assert!(s0 > 0.99, "birebir eslesme skoru ~1.0 olmali: {s0}");
        // Diklemesine (orthogonal) vektorler → sonraki skorlar ~0 (kesinlikle ilk skordan kucuk).
        for w in page.items.windows(2) {
            let (a, b) = (w[0].score.unwrap(), w[1].score.unwrap());
            assert!(a >= b, "skorlar mesafe sirasinda azalmali: {a} < {b}");
        }

        // Asset 1 cope → semantik sonuctan da dislanmali (FILTER_FRAG paylasimi).
        db.connection()
            .execute(
                "UPDATE assets SET deleted_at = 99 WHERE id = 1",
                [],
            )
            .unwrap();
        let page2 = db.semantic_search(&unit(0), &opts).unwrap();
        assert!(
            page2.items.iter().all(|r| r.id != 1),
            "cope atilmis asset semantik sonuca sizmamali"
        );
        assert_eq!(page2.total, 2);
    }

    #[test]
    fn set_vector_rejects_wrong_dim() {
        let db = make_db();
        seed_asset(&db, 1, "a.txt");
        assert!(matches!(
            db.set_vector(1, &[0.0; 10]),
            Err(DbError::Invalid(_))
        ));
    }

    #[test]
    fn pending_and_without_vectors_track_progress() {
        let db = make_db();
        for (id, name) in [(1, "a.txt"), (2, "b.txt")] {
            seed_asset(&db, id, name);
        }
        assert_eq!(db.pending_embed_count().unwrap(), 2);
        assert_eq!(db.assets_without_vectors(0, 10).unwrap().len(), 2);
        db.set_vector(1, &unit(0)).unwrap();
        assert_eq!(db.pending_embed_count().unwrap(), 1);
        let pending = db.assets_without_vectors(0, 10).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].id, 2);
        // Cursor: after_id=2 → 2'den buyuk id yok → bos (ilerleme garantisi).
        assert!(db.assets_without_vectors(2, 10).unwrap().is_empty());
    }
}
