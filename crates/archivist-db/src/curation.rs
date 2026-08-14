//! Toplu kurasyon — favori/etiket/koleksiyon **delta-bulk** (undo icin). Her metod, islemin
//! YALNIZ GERCEKTEN DEGISTIRDIGI asset alt-kumesini uygular VE dondurur; boylece undo yalniz o
//! alt-kumeyi tersine cevirir (or. zaten favorili olani un-favorite ETMEZ, zaten etiketliye
//! ikinci kez dokunmaz). Tekil yazma primitifleri (`set_favorite`/`add_user_tag`/... — write.rs)
//! yeniden kullanilir; bu modul delta hesabi (mevcut-uyelik sorgusu) + dongu sarar.
//!
//! Idempotentlik: temeldeki yazmalar zaten idempotent → undo turu da guvenli (ikinci kez geri-al
//! no-op). Non-atomik (per-id; frontend'in eski dongusuyle ayni davranis) ama TEK kilit altinda
//! (komut katmani) → cok daha az geri-basinc.

use std::collections::HashSet;

use rusqlite::{params, types::Value, OptionalExtension};

use crate::error::DbError;
use crate::Db;

/// `?,?,...` (n adet) — IN listesi.
fn placeholders(n: usize) -> String {
    (0..n).map(|_| "?").collect::<Vec<_>>().join(",")
}

impl Db {
    /// `ids` icinden su an FAVORILI olanlarin kumesi.
    fn favorited_set(&self, ids: &[i64]) -> Result<HashSet<i64>, DbError> {
        if ids.is_empty() {
            return Ok(HashSet::new());
        }
        let sql = format!(
            "SELECT asset_id FROM favorites WHERE asset_id IN ({})",
            placeholders(ids.len())
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let set = stmt
            .query_map(rusqlite::params_from_iter(ids), |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<HashSet<i64>>>()?;
        Ok(set)
    }

    /// `ids` icinden `name` etiketine SAHIP olanlarin kumesi.
    fn tagged_set(&self, ids: &[i64], name: &str) -> Result<HashSet<i64>, DbError> {
        if ids.is_empty() {
            return Ok(HashSet::new());
        }
        let sql = format!(
            "SELECT at.asset_id FROM asset_tags at JOIN tags t ON t.id = at.tag_id
             WHERE t.name = ? AND at.asset_id IN ({})",
            placeholders(ids.len())
        );
        let mut vals: Vec<Value> = Vec::with_capacity(ids.len() + 1);
        vals.push(Value::Text(name.to_string()));
        vals.extend(ids.iter().map(|&i| Value::Integer(i)));
        let mut stmt = self.conn.prepare(&sql)?;
        let set = stmt
            .query_map(rusqlite::params_from_iter(vals), |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<HashSet<i64>>>()?;
        Ok(set)
    }

    /// `ids` icinden `collection_id` UYESI olanlarin kumesi.
    fn collection_member_set(&self, collection_id: i64, ids: &[i64]) -> Result<HashSet<i64>, DbError> {
        if ids.is_empty() {
            return Ok(HashSet::new());
        }
        let sql = format!(
            "SELECT asset_id FROM collection_items WHERE collection_id = ? AND asset_id IN ({})",
            placeholders(ids.len())
        );
        let mut vals: Vec<Value> = Vec::with_capacity(ids.len() + 1);
        vals.push(Value::Integer(collection_id));
        vals.extend(ids.iter().map(|&i| Value::Integer(i)));
        let mut stmt = self.conn.prepare(&sql)?;
        let set = stmt
            .query_map(rusqlite::params_from_iter(vals), |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<HashSet<i64>>>()?;
        Ok(set)
    }

    /// Favori durumunu TOPLU ayarla → yalniz DEGISEN id'ler (on ise: favorili-olmayanlar; off ise:
    /// favorililer). Uygulanir + dondurulur (undo bunlari tersine cevirir).
    pub fn bulk_set_favorite(&self, ids: &[i64], on: bool) -> Result<Vec<i64>, DbError> {
        let fav = self.favorited_set(ids)?;
        // on != fav.contains → durumun degisecegi id (add: !fav, remove: fav).
        let changed: Vec<i64> = ids.iter().copied().filter(|id| on != fav.contains(id)).collect();
        for &id in &changed {
            self.set_favorite(id, on)?;
        }
        Ok(changed)
    }

    /// Etiketi TOPLU ekle → yalniz o etikete SAHIP OLMAYAN id'ler (undo bunlardan kaldirir).
    pub fn bulk_add_tag(&mut self, ids: &[i64], name: &str) -> Result<Vec<i64>, DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(Vec::new());
        }
        let have = self.tagged_set(ids, name)?;
        let changed: Vec<i64> = ids.iter().copied().filter(|id| !have.contains(id)).collect();
        for &id in &changed {
            self.add_user_tag(id, name)?;
        }
        Ok(changed)
    }

    /// Etiketi TOPLU kaldir → yalniz o etikete SAHIP id'ler (undo bunlara geri ekler).
    pub fn bulk_remove_tag(&self, ids: &[i64], name: &str) -> Result<Vec<i64>, DbError> {
        let name = name.trim();
        if name.is_empty() {
            return Ok(Vec::new());
        }
        let have = self.tagged_set(ids, name)?;
        let changed: Vec<i64> = ids.iter().copied().filter(|id| have.contains(id)).collect();
        for &id in &changed {
            self.remove_tag(id, name)?;
        }
        Ok(changed)
    }

    /// Koleksiyona TOPLU ekle → yalniz UYE OLMAYAN id'ler (undo bunlari cikarir).
    pub fn bulk_add_to_collection(
        &self,
        collection_id: i64,
        ids: &[i64],
    ) -> Result<Vec<i64>, DbError> {
        let members = self.collection_member_set(collection_id, ids)?;
        let changed: Vec<i64> = ids.iter().copied().filter(|id| !members.contains(id)).collect();
        for &id in &changed {
            self.add_to_collection(collection_id, id)?;
        }
        Ok(changed)
    }

    /// Koleksiyondan TOPLU cikar → yalniz UYE id'ler (undo bunlari geri ekler).
    pub fn bulk_remove_from_collection(
        &self,
        collection_id: i64,
        ids: &[i64],
    ) -> Result<Vec<i64>, DbError> {
        let members = self.collection_member_set(collection_id, ids)?;
        let changed: Vec<i64> = ids.iter().copied().filter(|id| members.contains(id)).collect();
        for &id in &changed {
            self.remove_from_collection(collection_id, id)?;
        }
        Ok(changed)
    }

    /// Ada gore koleksiyon id (find-or-create ONCESI "zaten var miydi" kontrolu — undo'da
    /// SADECE bu islemin olusturdugu koleksiyon, bos kalirsa silinir). Yoksa `None`.
    pub fn collection_id_by_name(&self, name: &str) -> Result<Option<i64>, DbError> {
        Ok(self
            .conn
            .query_row("SELECT id FROM collections WHERE name = ?1", params![name.trim()], |r| {
                r.get(0)
            })
            .optional()?)
    }

    /// Koleksiyondaki uye sayisi (undo'da "bos-ise-sil" kontrolu).
    pub fn collection_item_count(&self, collection_id: i64) -> Result<i64, DbError> {
        Ok(self.conn.query_row(
            "SELECT count(*) FROM collection_items WHERE collection_id = ?1",
            params![collection_id],
            |r| r.get(0),
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    fn seed(db: &Db, path: &str) -> i64 {
        db.connection()
            .execute(
                "INSERT INTO assets(path, file_name, ext, size_bytes, created_at, modified_at)
                 VALUES (?1, ?1, 'txt', 1, 1, 1)",
                params![path],
            )
            .unwrap();
        db.connection().last_insert_rowid()
    }

    #[test]
    fn bulk_favorite_returns_only_changed() {
        let db = Db::open_in_memory_migrated().unwrap();
        let (a, b, c) = (seed(&db, "/a"), seed(&db, "/b"), seed(&db, "/c"));
        db.set_favorite(a, true).unwrap(); // a zaten favori

        // ADD [a,b,c] → yalniz b,c degisir (a atlanir).
        let mut changed = db.bulk_set_favorite(&[a, b, c], true).unwrap();
        changed.sort();
        assert_eq!(changed, vec![b, c]);
        assert_eq!(db.favorited_set(&[a, b, c]).unwrap().len(), 3);

        // REMOVE [b,c] → ikisi de degisir.
        let mut rem = db.bulk_set_favorite(&[b, c], false).unwrap();
        rem.sort();
        assert_eq!(rem, vec![b, c]);
        assert_eq!(db.favorited_set(&[a, b, c]).unwrap(), HashSet::from([a]));
    }

    #[test]
    fn bulk_tag_delta_add_and_remove() {
        let mut db = Db::open_in_memory_migrated().unwrap();
        let (a, b) = (seed(&db, "/a"), seed(&db, "/b"));
        db.add_user_tag(a, "villa").unwrap(); // a zaten "villa"

        // ADD "villa" [a,b] → yalniz b.
        assert_eq!(db.bulk_add_tag(&[a, b], "villa").unwrap(), vec![b]);
        assert_eq!(db.tagged_set(&[a, b], "villa").unwrap().len(), 2);

        // REMOVE "villa" [a,b] → ikisi de (ikisi de sahip).
        let mut rem = db.bulk_remove_tag(&[a, b], "villa").unwrap();
        rem.sort();
        assert_eq!(rem, vec![a, b]);
        assert!(db.tagged_set(&[a, b], "villa").unwrap().is_empty());
        // Bos ad → no-op.
        assert!(db.bulk_add_tag(&[a, b], "  ").unwrap().is_empty());
    }

    #[test]
    fn bulk_collection_delta_and_helpers() {
        let mut db = Db::open_in_memory_migrated().unwrap();
        let (a, b) = (seed(&db, "/a"), seed(&db, "/b"));
        assert!(db.collection_id_by_name("Proje X").unwrap().is_none(), "henuz yok");
        let cid = db.create_collection("Proje X", None).unwrap();
        assert_eq!(db.collection_id_by_name("Proje X").unwrap(), Some(cid), "artik var");
        db.add_to_collection(cid, a).unwrap(); // a zaten uye

        // ADD [a,b] → yalniz b.
        assert_eq!(db.bulk_add_to_collection(cid, &[a, b]).unwrap(), vec![b]);
        assert_eq!(db.collection_item_count(cid).unwrap(), 2);

        // REMOVE [a,b] → ikisi de → bos.
        let mut rem = db.bulk_remove_from_collection(cid, &[a, b]).unwrap();
        rem.sort();
        assert_eq!(rem, vec![a, b]);
        assert_eq!(db.collection_item_count(cid).unwrap(), 0);
    }
}
