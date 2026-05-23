    use rusqlite::Connection;
    use std::path::Path;

    /// v2.4.9 monolit profilleri (sql.js kaynak DB — taşımanın GİRDİSİ).
    #[derive(Clone, Copy)]
    pub enum DbProfile {
        Empty,
        /// `assets` sayısı; her asset 2 embedding + 1 chunk + ~1 ilişki.
        Sized(usize),
        /// Geçerli şema üret, sonra header'ı boz (read_db_at corrupt yolu).
        Corrupt,
    }

    /// Deterministik LCG — `rand` dev-dep eklemeden tekrarlanabilir sentetik
    /// vektör (PREP-KIT: gerçek üreteç Sprint 1'de `rand` ile; iskelet bağımsız).
    fn lcg(seed: &mut u64) -> f32 {
        *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((*seed >> 33) as f32 / (1u64 << 31) as f32) - 1.0
    }

    /// 384-dim f32 little-endian blob (v2.4.9 `vectorToBlob` formatı).
    fn synth_vector(mut seed: u64) -> Vec<u8> {
        let mut out = Vec::with_capacity(384 * 4);
        for _ in 0..384 {
            out.extend_from_slice(&lcg(&mut seed).to_le_bytes());
        }
        out
    }

    /// v2.4.9-format sql.js DB üret (assets + embeddings + text_chunks +
    /// asset_relations, `vector_json` + `vector_blob`, user_version=0).
    /// rusqlite ile yazılır — dosya standart SQLite, sql.js birebir okur.
    pub fn make_v249_db(path: &Path, profile: DbProfile) -> Result<(), String> {
        if let Some(p) = path.parent() {
            std::fs::create_dir_all(p).ok();
        }
        let mut conn = Connection::open(path).map_err(|e| e.to_string())?;
        // `assets` = v2.4.9 `database.ts` _applySchema BİREBİR (PREP-KIT §A: "şema
        // database.ts birebir"). 3-kolon iskelet, `CREATE TABLE IF NOT EXISTS`
        // ile gerçek app açılınca güncellenmediğinden UI sorgularını (file_path
        // NOT NULL, category, ...) kırıyordu → baseline-heap ölçümü için app'in
        // temiz açılması şart. embeddings/text_chunks/asset_relations zaten
        // satır-uyumlu (vec_db cascade testleri yalnız COUNT kullanır).
        conn.execute_batch(
            "PRAGMA user_version = 0;
             CREATE TABLE assets (
               id TEXT PRIMARY KEY, file_name TEXT NOT NULL, file_path TEXT NOT NULL,
               file_size INTEGER, file_type TEXT, category TEXT, created_at TEXT,
               modified_at TEXT, project_name TEXT, project_phase TEXT,
               material_group TEXT, color_theme TEXT, architectural_style TEXT,
               omniclass_code TEXT, is_indexed INTEGER DEFAULT 0, hash TEXT,
               phash TEXT, content_hash TEXT, metadata_json TEXT, ai_tags_json TEXT,
               color_palette_json TEXT, thumbnail_url TEXT, raw_metadata TEXT,
               metadata_version INTEGER DEFAULT 1, applied_extractors TEXT,
               extracted_at TEXT, rag_status TEXT, rag_status_reason TEXT,
               fs_mtime INTEGER);
             CREATE TABLE embeddings (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL,
               ref_id TEXT, vector_json TEXT, vector_blob BLOB, source TEXT NOT NULL,
               created_at TEXT,
               FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE);
             CREATE TABLE text_chunks (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL,
               chunk_index INTEGER NOT NULL, page INTEGER, text TEXT NOT NULL,
               lang TEXT, created_at TEXT,
               FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE);
             CREATE TABLE asset_relations (id TEXT PRIMARY KEY, source_id TEXT NOT NULL,
               target_id TEXT NOT NULL, relation_type TEXT NOT NULL, notes TEXT,
               created_at TEXT NOT NULL, created_by TEXT DEFAULT 'user');",
        )
        .map_err(|e| e.to_string())?;

        let n = match profile {
            DbProfile::Empty => 0,
            DbProfile::Sized(n) => n,
            DbProfile::Corrupt => 3,
        };
        // Tek transaction + prepared statement: satır-satır implicit-commit
        // (her INSERT = 1 fsync) 1.13M satırda saatler sürer; batch zorunlu.
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        {
            let mut ins_asset = tx
                .prepare(
                    "INSERT INTO assets (id, file_name, file_path, file_type, content_hash)
                     VALUES (?1,?2,?3,'pdf',?4)",
                )
                .map_err(|e| e.to_string())?;
            let mut ins_emb = tx
                .prepare(
                    "INSERT INTO embeddings (id, asset_id, ref_id, vector_json, vector_blob, source, created_at)
                     VALUES (?1,?2,?3,NULL,?4,?5,'2026-01-01T00:00:00Z')",
                )
                .map_err(|e| e.to_string())?;
            let mut ins_chunk = tx
                .prepare(
                    "INSERT INTO text_chunks (id, asset_id, chunk_index, page, text, lang, created_at)
                     VALUES (?1,?2,0,1,?3,'tr','2026-01-01T00:00:00Z')",
                )
                .map_err(|e| e.to_string())?;
            let mut ins_rel = tx
                .prepare(
                    "INSERT INTO asset_relations
                       (id, source_id, target_id, relation_type, notes, created_at, created_by)
                     VALUES (?1,?2,?3,'related',NULL,'2026-01-01T00:00:00Z','user')",
                )
                .map_err(|e| e.to_string())?;
            for i in 0..n {
                let aid = format!("asset-{}", i);
                ins_asset
                    .execute(rusqlite::params![
                        aid,
                        format!("f{}.pdf", i),
                        format!("C:\\arsiv\\f{}.pdf", i),
                        format!("h{}", i)
                    ])
                    .map_err(|e| e.to_string())?;
                // 2 embedding (chunk_text + chunk_ocr)
                for (k, src) in ["chunk_text", "chunk_ocr"].iter().enumerate() {
                    ins_emb
                        .execute(rusqlite::params![
                            format!("{}_{}", aid, src),
                            aid,
                            format!("{}_chunk_{}", aid, k),
                            synth_vector(i as u64 * 7 + k as u64),
                            src
                        ])
                        .map_err(|e| e.to_string())?;
                }
                ins_chunk
                    .execute(rusqlite::params![
                        format!("{}_chunk_0", aid),
                        aid,
                        "Lorem ipsum dolor sit amet."
                    ])
                    .map_err(|e| e.to_string())?;
                if i > 0 {
                    ins_rel
                        .execute(rusqlite::params![
                            format!("rel-{}", i),
                            aid,
                            format!("asset-{}", i - 1)
                        ])
                        .map_err(|e| e.to_string())?;
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);

        if matches!(profile, DbProfile::Corrupt) {
            // İlk 16 baytı boz — geçerli SQLite header'ı yok et.
            use std::io::{Seek, SeekFrom, Write};
            let mut f = std::fs::OpenOptions::new()
                .write(true)
                .open(path)
                .map_err(|e| e.to_string())?;
            f.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            f.write_all(b"CORRUPTEDHEADER!").map_err(|e| e.to_string())?;
        }
        Ok(())
    }
