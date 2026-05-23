    use super::fixtures::{make_v249_db, DbProfile};
    use super::*;

    fn er(id: &str, asset: &str) -> EmbeddingRow {
        EmbeddingRow {
            id: id.to_string(),
            asset_id: asset.to_string(),
            ref_id: Some(format!("{}_ref", id)),
            vector_blob: vec![1u8, 2, 3, 4],
            source: "chunk_text".to_string(),
        }
    }

    /// PREP-KIT §B baseline-heap ölçümü için v2.4.9-format monolit `archivist.db`
    /// üretir (Large=100K emb, Huge=1.13M emb). CI'de KOŞMAZ (`#[ignore]`).
    ///
    /// Manuel:
    /// ```text
    /// $env:BASELINE_DB_OUT="C:\baseline-db"          # çıktı klasörü (zorunlu)
    /// $env:BASELINE_PROFILES="large"                 # large | huge | large,huge
    /// cargo test --manifest-path src-tauri/Cargo.toml --features admin `
    ///   emit_baseline_dbs -- --ignored --nocapture
    /// ```
    /// Sonra `baseline_large_100k.db` / `baseline_huge_1130k.db` dosyasını
    /// `%APPDATA%\com.archivistpro.desktop\archivist.db` olarak kopyala
    /// (detay: docs/v3/baseline-heap.md).
    #[test]
    #[ignore = "manuel baseline-heap üreteci — CI'de değil (süre/disk); --ignored ile koş"]
    fn emit_baseline_dbs() {
        use std::time::Instant;
        let out = std::env::var("BASELINE_DB_OUT").expect(
            "BASELINE_DB_OUT env (çıktı klasörü) ayarlı değil — bkz docs/v3/baseline-heap.md",
        );
        let out = std::path::Path::new(&out);
        std::fs::create_dir_all(out).expect("BASELINE_DB_OUT klasörü oluşturulamadı");
        let profiles = std::env::var("BASELINE_PROFILES").unwrap_or_else(|_| "large".into());

        // (etiket, dosya adı, asset sayısı) — emb sayısı = asset×2.
        let targets: &[(&str, &str, usize)] = &[
            ("large", "baseline_large_100k.db", 50_000),   // 100K embedding
            ("huge", "baseline_huge_1130k.db", 565_000),   // 1.13M embedding
        ];
        let want: Vec<&str> = profiles.split(',').map(|s| s.trim()).collect();
        let mut emitted = 0;
        for (label, fname, assets) in targets {
            if !want.contains(label) {
                continue;
            }
            let path = out.join(fname);
            let _ = std::fs::remove_file(&path);
            let t0 = Instant::now();
            make_v249_db(&path, DbProfile::Sized(*assets)).expect("make_v249_db başarısız");
            let secs = t0.elapsed().as_secs_f64();
            let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
            println!(
                "[baseline] {} -> {} | {} asset, {} embedding | {:.1} MB | {:.1} sn",
                label,
                path.display(),
                assets,
                assets * 2,
                bytes as f64 / 1_048_576.0,
                secs
            );
            emitted += 1;
        }
        assert!(
            emitted > 0,
            "BASELINE_PROFILES='{}' hiçbir profille eşleşmedi (large|huge bekleniyor)",
            profiles
        );
    }

    #[test]
    fn open_vec_db_creates_all_tables() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("archivist_vec.db");
        assert_eq!(vec_count(&db, "embeddings").unwrap(), 0);
        assert_eq!(vec_count(&db, "text_chunks").unwrap(), 0);
        assert_eq!(vec_count(&db, "asset_relations").unwrap(), 0);
        assert_eq!(vec_count(&db, "migration_progress").unwrap(), 0);
        assert!(vec_count(&db, "robert'); DROP TABLE--").is_err());
    }

    #[test]
    fn apply_embeddings_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("v.db");
        let rows = vec![er("e1", "a1"), er("e2", "a1")];
        assert_eq!(apply_embeddings(&db, &rows).unwrap(), 2);
        // Aynı batch tekrar (resume) → INSERT OR IGNORE, 0 yeni, toplam 2
        assert_eq!(apply_embeddings(&db, &rows).unwrap(), 0);
        assert_eq!(vec_count(&db, "embeddings").unwrap(), 2);
    }

    #[test]
    fn embedding_blob_roundtrips() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("v.db");
        let blob: Vec<u8> = (0..384 * 4).map(|i| (i % 251) as u8).collect();
        apply_embeddings(
            &db,
            &[EmbeddingRow {
                id: "e1".into(),
                asset_id: "a1".into(),
                ref_id: None,
                vector_blob: blob.clone(),
                source: "chunk_text".into(),
            }],
        )
        .unwrap();
        let conn = open_vec_db(&db).unwrap();
        let got: Vec<u8> = conn
            .query_row("SELECT vector_blob FROM embeddings WHERE id='e1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(got, blob, "blob byte-aynen korunmalı (dim*4)");
    }

    #[test]
    fn migration_progress_roundtrip_and_resume() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("v.db");
        assert_eq!(progress_get(&db, "embeddings").unwrap(), None);
        progress_set(&db, "embeddings", 5000, 100_000, false).unwrap();
        assert_eq!(progress_get(&db, "embeddings").unwrap(), Some((5000, 100_000, false)));
        // Resume checkpoint ilerler, henüz tamamlanmadı
        progress_set(&db, "embeddings", 10_000, 100_000, false).unwrap();
        assert_eq!(progress_get(&db, "embeddings").unwrap(), Some((10_000, 100_000, false)));
        // Tamamlandı işaretle
        progress_set(&db, "embeddings", 100_000, 100_000, true).unwrap();
        let (last, total, done) = progress_get(&db, "embeddings").unwrap().unwrap();
        assert_eq!((last, total), (100_000, 100_000));
        assert!(done, "completed_at set edilmeli");
    }

    #[test]
    fn separate_vec_dbs_are_isolated() {
        let tmp = tempfile::tempdir().unwrap();
        let main_v = tmp.path().join("archivist_vec.db");
        let local_v = tmp.path().join("archivist_local_vec.db");
        apply_embeddings(&main_v, &[er("e1", "a1")]).unwrap();
        apply_embeddings(&local_v, &[er("e2", "a2"), er("e3", "a3")]).unwrap();
        assert_eq!(vec_count(&main_v, "embeddings").unwrap(), 1);
        assert_eq!(vec_count(&local_v, "embeddings").unwrap(), 2);
        let conn = open_vec_db(&main_v).unwrap();
        let leaked: i64 = conn
            .query_row("SELECT COUNT(*) FROM embeddings WHERE id='e2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(leaked, 0, "local vektörü main vec.db'ye sızmamalı");
    }

    // ── Fixture üreteci (PREP-KIT §A) ────────────────────────────────────────

    #[test]
    fn fixture_empty_has_schema_no_rows_user_version_0() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("archivist.db");
        make_v249_db(&db, DbProfile::Empty).unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        let uv: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(uv, 0, "v2.4.9 monolit epoch=0");
        let a: i64 = conn.query_row("SELECT COUNT(*) FROM embeddings", [], |r| r.get(0)).unwrap();
        assert_eq!(a, 0);
    }

    #[test]
    fn fixture_sized_row_counts_match_profile() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("archivist.db");
        make_v249_db(&db, DbProfile::Sized(50)).unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        let assets: i64 = conn.query_row("SELECT COUNT(*) FROM assets", [], |r| r.get(0)).unwrap();
        let emb: i64 = conn.query_row("SELECT COUNT(*) FROM embeddings", [], |r| r.get(0)).unwrap();
        let ch: i64 = conn.query_row("SELECT COUNT(*) FROM text_chunks", [], |r| r.get(0)).unwrap();
        let rel: i64 = conn.query_row("SELECT COUNT(*) FROM asset_relations", [], |r| r.get(0)).unwrap();
        assert_eq!(assets, 50);
        assert_eq!(emb, 100, "asset başına 2 embedding");
        assert_eq!(ch, 50);
        assert_eq!(rel, 49, "ilk asset hariç her asset 1 ilişki");
        // Blob 384-dim f32 = 1536 bayt
        let len: i64 = conn
            .query_row("SELECT LENGTH(vector_blob) FROM embeddings LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(len, 384 * 4);
    }

    #[test]
    fn fixture_corrupt_has_bad_header() {
        let tmp = tempfile::tempdir().unwrap();
        let db = tmp.path().join("archivist.db");
        make_v249_db(&db, DbProfile::Corrupt).unwrap();
        // ollama_db::read_db_at bunu corrupted=true + backup ile yakalamalı
        let r = crate::ollama_db::read_db_at(&db).unwrap();
        assert!(r.corrupted, "bozuk header tespit edilmeli");
        assert!(db.with_extension("corrupt.bak").exists());
    }

    // ── Orkestratör: migrate + verify (DESIGN-LOCK §4/§5) ────────────────────

    #[test]
    fn migrate_then_verify_passes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("archivist_vec.db");
        make_v249_db(&src, DbProfile::Sized(30)).unwrap();

        let written = migrate_embeddings(&src, &vdb, 7).unwrap();
        assert_eq!(written, 60, "30 asset × 2 embedding");

        let rep = verify_embeddings(&src, &vdb).unwrap();
        assert_eq!(rep.source_count, 60);
        assert_eq!(rep.vec_count, 60);
        assert!(rep.count_match && rep.content_hash_match && rep.blob_sample_ok);
        assert!(rep.verified, "üç katman geçti → frontend DROP+epoch yapabilir");
        // İlerleme tamam işaretlenmese de (DROP frontend'de) son rowid kaydedildi
        let (last, total, _) = progress_get(&vdb, "embeddings").unwrap().unwrap();
        assert_eq!(total, 60);
        assert!(last > 0);
    }

    #[test]
    fn migrate_is_idempotent_and_resumable() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(25)).unwrap();

        // Tam taşıma
        assert_eq!(migrate_embeddings(&src, &vdb, 4).unwrap(), 50);
        // Yeniden çağrı (resume sonrası tekrar) → 0 yeni, çift yazmaz
        assert_eq!(migrate_embeddings(&src, &vdb, 4).unwrap(), 0);
        assert_eq!(vec_count(&vdb, "embeddings").unwrap(), 50);
        assert!(verify_embeddings(&src, &vdb).unwrap().verified);

        // Kesinti simülasyonu: vec.db'yi sıfırla ama progress'i ortada bırak
        std::fs::remove_file(&vdb).ok();
        progress_set(&vdb, "embeddings", 0, 50, false).unwrap(); // baştan
        assert_eq!(migrate_embeddings(&src, &vdb, 4).unwrap(), 50);
        assert!(verify_embeddings(&src, &vdb).unwrap().verified);
    }

    #[test]
    fn empty_source_migrates_and_verifies() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Empty).unwrap();
        assert_eq!(migrate_embeddings(&src, &vdb, 100).unwrap(), 0);
        let rep = verify_embeddings(&src, &vdb).unwrap();
        assert_eq!((rep.source_count, rep.vec_count), (0, 0));
        assert!(rep.verified, "boş↔boş geçerli");
    }

    /// Gate #1 §6 — GERÇEK anonim v2.4.9 db'ye karşı TAM v3 migrasyon hattı
    /// (epoch 1→2→3 migrate+verify + idempotent re-run). CI'de KOŞMAZ
    /// (`#[ignore]`); manuel — db `scripts/anonymize-db.py` ile üretilmiş olmalı:
    /// ```text
    /// $env:GATE1_DB="C:\Arsiv-H2\ArchivistPro\test-data\archivist_anon.db"
    /// cargo test --manifest-path src-tauri/Cargo.toml --features admin `
    ///   gate1_real_db_migration -- --ignored --nocapture
    /// ```
    #[test]
    #[ignore = "manuel Gate #1 — GATE1_DB env (anonim gerçek db) ister; bkz docs/v3/GATE1-ANONYMIZATION.md §6"]
    fn gate1_real_db_migration() {
        use std::time::Instant;
        let src = std::path::PathBuf::from(std::env::var("GATE1_DB").expect(
            "GATE1_DB env (anonim gerçek db yolu) gerekli — docs/v3/GATE1-ANONYMIZATION.md §6",
        ));
        assert!(src.exists(), "GATE1_DB bulunamadı: {}", src.display());
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("archivist_vec.db");

        // EPOCH 1 — embeddings
        let t = Instant::now();
        let n = migrate_embeddings(&src, &vdb, 5000).unwrap();
        let r = verify_embeddings(&src, &vdb).unwrap();
        println!(
            "[gate1] embeddings: {n} taşındı | src={} vec={} count={} hash={} blob={} verified={} | {:.1}sn",
            r.source_count, r.vec_count, r.count_match, r.content_hash_match,
            r.blob_sample_ok, r.verified, t.elapsed().as_secs_f64()
        );
        assert!(r.verified, "embeddings verify FAIL — Gate #1 geçemedi");

        // EPOCH 2 — text_chunks
        let t = Instant::now();
        let n = migrate_text_chunks(&src, &vdb, 5000).unwrap();
        let r = verify_text_chunks(&src, &vdb).unwrap();
        println!(
            "[gate1] text_chunks: {n} taşındı | src={} vec={} verified={} | {:.1}sn",
            r.source_count, r.vec_count, r.verified, t.elapsed().as_secs_f64()
        );
        assert!(r.verified, "text_chunks verify FAIL");

        // EPOCH 3 — asset_relations
        let n = migrate_asset_relations(&src, &vdb, 5000).unwrap();
        let r = verify_asset_relations(&src, &vdb).unwrap();
        println!(
            "[gate1] asset_relations: {n} taşındı | src={} vec={} verified={}",
            r.source_count, r.vec_count, r.verified
        );
        assert!(r.verified, "asset_relations verify FAIL");

        // İdempotent: yeniden çağrı 0 yeni satır (çift yazmaz)
        assert_eq!(
            migrate_embeddings(&src, &vdb, 5000).unwrap(),
            0,
            "idempotent değil — resume/çift-yazma riski"
        );
        println!(
            "[gate1] GEÇTİ — tam v3 migrasyon hattı GERÇEK anonim db'de doğrulandı (vec.db {} bayt)",
            std::fs::metadata(&vdb).map(|m| m.len()).unwrap_or(0)
        );
    }

    /// Gate #1 2026-05-19 regresyon: `embeddings` KARIŞIK boyut tutar
    /// (384-dim MiniLM metin + 512-dim CLIP görsel). Eski verify
    /// `len == 384*4` sabiti 512-dim satırı sahte-FAIL ediyordu. Round-trip
    /// düzeltmesi dim'den bağımsız geçmeli. (Sentetik fixture yalnız 384-dim
    /// ürettiği için bu boşluk ancak gerçek db'de görülmüştü.)
    #[test]
    fn verify_passes_with_mixed_dim_embeddings() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(5)).unwrap(); // 384-dim satırlar

        // Kaynağa 512-dim (2048B) CLIP görsel embedding'leri ekle; id'ler
        // sıralamada BAŞA düşsün ki örneklem offset 0 = 512-dim olsun
        // (eski sabit-384 sağlaması burada FAIL ederdi).
        {
            let c = rusqlite::Connection::open(&src).unwrap();
            let blob512: Vec<u8> = (0..2048u32).map(|i| (i % 256) as u8).collect();
            for k in 0..3 {
                c.execute(
                    "INSERT INTO embeddings (id, asset_id, ref_id, vector_json,
                       vector_blob, source, created_at)
                     VALUES (?1, 'asset-0', NULL, NULL, ?2, 'image_center',
                       '2026-01-01T00:00:00Z')",
                    rusqlite::params![format!("000_img_{k}"), blob512],
                )
                .unwrap();
            }
        }

        assert_eq!(migrate_embeddings(&src, &vdb, 100).unwrap(), 13); // 5×2 + 3
        let rep = verify_embeddings(&src, &vdb).unwrap();
        assert!(rep.count_match, "count: {:?}", rep);
        assert!(rep.content_hash_match, "hash: {:?}", rep);
        assert!(
            rep.blob_sample_ok,
            "512-dim round-trip blob örneklemi GEÇMELİ (Gate #1 regresyonu): {:?}",
            rep
        );
        assert!(rep.verified, "karışık-boyut verify geçmeli: {:?}", rep);
    }

    #[test]
    fn verify_detects_count_mismatch() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(10)).unwrap();
        migrate_embeddings(&src, &vdb, 100).unwrap();
        // vec.db'den bir satır sil → COUNT eşitsiz
        open_vec_db(&vdb)
            .unwrap()
            .execute("DELETE FROM embeddings WHERE id = 'asset-0_chunk_text'", [])
            .unwrap();
        let rep = verify_embeddings(&src, &vdb).unwrap();
        assert!(!rep.count_match);
        assert!(!rep.verified, "DROP ENGELLENMELİ — veri kaybı koruması");
    }

    #[test]
    fn verify_detects_content_tamper() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(8)).unwrap();
        migrate_embeddings(&src, &vdb, 100).unwrap();
        // Blob'u boz — COUNT aynı ama içerik-hash farklı
        open_vec_db(&vdb)
            .unwrap()
            .execute(
                "UPDATE embeddings SET vector_blob = X'00' WHERE id = 'asset-3_chunk_ocr'",
                [],
            )
            .unwrap();
        let rep = verify_embeddings(&src, &vdb).unwrap();
        assert!(rep.count_match, "satır sayısı hâlâ eşit");
        assert!(!rep.content_hash_match, "içerik bozulması yakalandı");
        assert!(!rep.verified);
    }

    // ─── EPOCH 2: text_chunks (fixture: Sized(n) → n chunk, 1/asset) ───

    #[test]
    fn text_chunks_migrate_then_verify_passes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(30)).unwrap();
        assert_eq!(migrate_text_chunks(&src, &vdb, 7).unwrap(), 30);
        let rep = verify_text_chunks(&src, &vdb).unwrap();
        assert_eq!((rep.source_count, rep.vec_count), (30, 30));
        assert!(rep.verified && rep.count_match && rep.content_hash_match);
        let (_, total, _) = progress_get(&vdb, "text_chunks").unwrap().unwrap();
        assert_eq!(total, 30);
    }

    #[test]
    fn text_chunks_idempotent_and_resumable() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(25)).unwrap();
        assert_eq!(migrate_text_chunks(&src, &vdb, 4).unwrap(), 25);
        assert_eq!(migrate_text_chunks(&src, &vdb, 4).unwrap(), 0, "çift yazmaz");
        std::fs::remove_file(&vdb).ok();
        progress_set(&vdb, "text_chunks", 0, 25, false).unwrap();
        assert_eq!(migrate_text_chunks(&src, &vdb, 4).unwrap(), 25);
        assert!(verify_text_chunks(&src, &vdb).unwrap().verified);
    }

    #[test]
    fn text_chunks_verify_detects_count_and_tamper() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(10)).unwrap();
        migrate_text_chunks(&src, &vdb, 100).unwrap();
        // İçerik bozulması: COUNT aynı, hash farklı
        open_vec_db(&vdb)
            .unwrap()
            .execute("UPDATE text_chunks SET text='X' WHERE id='asset-3_chunk_0'", [])
            .unwrap();
        let r1 = verify_text_chunks(&src, &vdb).unwrap();
        assert!(r1.count_match && !r1.content_hash_match && !r1.verified);
        // Satır sil → COUNT eşitsiz
        open_vec_db(&vdb)
            .unwrap()
            .execute("DELETE FROM text_chunks WHERE id='asset-0_chunk_0'", [])
            .unwrap();
        assert!(!verify_text_chunks(&src, &vdb).unwrap().count_match);
    }

    #[test]
    fn text_chunks_empty_source_ok() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Empty).unwrap();
        assert_eq!(migrate_text_chunks(&src, &vdb, 50).unwrap(), 0);
        assert!(verify_text_chunks(&src, &vdb).unwrap().verified);
    }

    // ─── EPOCH 3: asset_relations (fixture: Sized(n) → n-1 ilişki, i>0) ───

    #[test]
    fn asset_relations_migrate_then_verify_passes() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(30)).unwrap();
        assert_eq!(migrate_asset_relations(&src, &vdb, 7).unwrap(), 29);
        let rep = verify_asset_relations(&src, &vdb).unwrap();
        assert_eq!((rep.source_count, rep.vec_count), (29, 29));
        assert!(rep.verified && rep.count_match && rep.content_hash_match);
    }

    #[test]
    fn asset_relations_idempotent_and_resumable() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(20)).unwrap();
        assert_eq!(migrate_asset_relations(&src, &vdb, 5).unwrap(), 19);
        assert_eq!(migrate_asset_relations(&src, &vdb, 5).unwrap(), 0, "çift yazmaz");
        std::fs::remove_file(&vdb).ok();
        progress_set(&vdb, "asset_relations", 0, 19, false).unwrap();
        assert_eq!(migrate_asset_relations(&src, &vdb, 5).unwrap(), 19);
        assert!(verify_asset_relations(&src, &vdb).unwrap().verified);
    }

    #[test]
    fn asset_relations_verify_detects_count_and_tamper() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(10)).unwrap();
        migrate_asset_relations(&src, &vdb, 100).unwrap();
        open_vec_db(&vdb)
            .unwrap()
            .execute(
                "UPDATE asset_relations SET relation_type='x' WHERE id='rel-3'",
                [],
            )
            .unwrap();
        let r1 = verify_asset_relations(&src, &vdb).unwrap();
        assert!(r1.count_match && !r1.content_hash_match && !r1.verified);
        open_vec_db(&vdb)
            .unwrap()
            .execute("DELETE FROM asset_relations WHERE id='rel-1'", [])
            .unwrap();
        assert!(!verify_asset_relations(&src, &vdb).unwrap().count_match);
    }

    #[test]
    fn asset_relations_empty_source_ok() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Empty).unwrap();
        assert_eq!(migrate_asset_relations(&src, &vdb, 50).unwrap(), 0);
        assert!(verify_asset_relations(&src, &vdb).unwrap().verified);
    }

    #[test]
    fn precondition_blocks_null_blob_source() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("legacy.db");
        let vdb = tmp.path().join("v.db");
        // Legacy: vector_blob NULL (henüz _migrateEmbeddingsJsonToBlob koşmamış)
        let c = rusqlite::Connection::open(&src).unwrap();
        c.execute_batch(
            "CREATE TABLE embeddings (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL,
               ref_id TEXT, vector_json TEXT, vector_blob BLOB, source TEXT NOT NULL,
               created_at TEXT);
             INSERT INTO embeddings (id,asset_id,ref_id,vector_json,vector_blob,source,created_at)
               VALUES ('e1','a1',NULL,'[0.1,0.2]',NULL,'chunk_text','t');",
        )
        .unwrap();
        drop(c);
        assert!(embeddings_blob_precondition(&src).is_err());
        // migrate_embeddings ön-koşulu çağırır → Err, vec.db'ye hiç yazmaz
        assert!(migrate_embeddings(&src, &vdb, 10).is_err());
    }

    // ── Frontend çift-yol okuma: query_chunk_embeddings ──────────────────────

    #[test]
    fn blob_to_vec_f32_decodes_and_rejects_bad_len() {
        let v = blob_to_vec_f32(&1.5f32.to_le_bytes()).unwrap();
        assert_eq!(v, vec![1.5f32]);
        assert_eq!(blob_to_vec_f32(&[]), None);
        assert_eq!(blob_to_vec_f32(&[1, 2, 3]), None, "len % 4 != 0 → None");
    }

    #[test]
    fn query_chunk_embeddings_matches_migrated_contract() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(12)).unwrap();
        migrate_embeddings(&src, &vdb, 100).unwrap();

        // Fixture: her asset 1 chunk_text + 1 chunk_ocr, ref_id dolu
        let txt = query_chunk_embeddings(&vdb, "chunk_text").unwrap();
        let ocr = query_chunk_embeddings(&vdb, "chunk_ocr").unwrap();
        assert_eq!(txt.len(), 12, "source filtresi: chunk_text");
        assert_eq!(ocr.len(), 12, "source filtresi: chunk_ocr");
        // Kontrat şekli: assetId/chunkId/vector(384 f32)
        assert_eq!(txt[0].vector.len(), 384);
        assert!(txt[0].asset_id.starts_with("asset-"));
        assert!(!txt[0].chunk_id.is_empty());
    }

    #[test]
    fn query_chunk_embeddings_filters_null_empty_refid_and_bad_blob() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        // İyi satır
        apply_embeddings(
            &vdb,
            &[EmbeddingRow {
                id: "ok".into(),
                asset_id: "a1".into(),
                ref_id: Some("chunk-1".into()),
                vector_blob: vec![0u8; 384 * 4],
                source: "chunk_text".into(),
            }],
        )
        .unwrap();
        // ref_id NULL / '' ve bozuk blob (3 bayt) — doğrudan ekle
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO embeddings (id,asset_id,ref_id,vector_blob,source)
             VALUES ('n','a2',NULL,?1,'chunk_text'),
                    ('e','a3','',?1,'chunk_text'),
                    ('b','a4','chunk-b',X'010203','chunk_text')",
            rusqlite::params![vec![0u8; 384 * 4]],
        )
        .unwrap();
        drop(c);

        let rows = query_chunk_embeddings(&vdb, "chunk_text").unwrap();
        // Yalnız 'ok' kalmalı: NULL/'' ref_id elendi, bozuk blob (3 bayt) atlandı
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].chunk_id, "chunk-1");
        assert_eq!(rows[0].vector.len(), 384);
    }

    // ── Asset DELETE cascade (DESIGN-LOCK §7/T9) ─────────────────────────────

    #[test]
    fn delete_assets_cascades_all_three_tables_and_is_scoped() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        // Sized(10): asset-0..9; her asset 2 emb + 1 chunk; i>0 → 1 ilişki
        // (rel-i: source=asset-i, target=asset-(i-1))
        make_v249_db(&src, DbProfile::Sized(10)).unwrap();
        migrate_embeddings(&src, &vdb, 100).unwrap();
        // text_chunks fixture'da kaynakta var ama migrate yalnız embeddings
        // taşır (Sprint 1 sırası); chunk cascade'i izole test için elle ekle:
        {
            let c = open_vec_db(&vdb).unwrap();
            c.execute(
                "INSERT INTO text_chunks (id,asset_id,chunk_index,text)
                 VALUES ('c5','asset-5',0,'x'),('c6','asset-6',0,'y')",
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO asset_relations
                   (id,source_id,target_id,relation_type,created_at)
                 VALUES ('r1','asset-5','asset-2','related','t'),
                        ('r2','asset-9','asset-5','related','t')",
                [],
            )
            .unwrap();
        }
        let emb_before = vec_count(&vdb, "embeddings").unwrap();

        // asset-5 sil: 2 emb + 1 chunk + ilişki(source=5 VEYA target=5 → r1,r2)
        let rep = delete_assets(&vdb, &["asset-5".to_string()]).unwrap();
        assert_eq!(rep.embeddings_deleted, 2);
        assert_eq!(rep.chunks_deleted, 1);
        assert_eq!(rep.relations_deleted, 2, "source VEYA target = asset-5");

        // Kapsam: yalnız asset-5 etkilendi
        assert_eq!(vec_count(&vdb, "embeddings").unwrap(), emb_before - 2);
        let c = open_vec_db(&vdb).unwrap();
        let a6_chunk: i64 = c
            .query_row("SELECT COUNT(*) FROM text_chunks WHERE asset_id='asset-6'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(a6_chunk, 1, "asset-6 chunk'ı sağlam");

        // İdempotent: tekrar sil → hepsi 0
        let rep2 = delete_assets(&vdb, &["asset-5".to_string()]).unwrap();
        assert_eq!(rep2, CascadeDeleteReport::default());
        // Boş liste → no-op
        assert_eq!(delete_assets(&vdb, &[]).unwrap(), CascadeDeleteReport::default());
    }

    // ── V3 A6-PRE-3a: delete_chunks_for_assets — text_chunks tam, embeddings
    //    yalnız chunk-tipi (ref_id != '') silinir; asset-level (ref_id NULL/'')
    //    korunur. scan_db.rs `write_scan_batch_to_db` "delete_chunks_for"
    //    bloğunun vec.db karşılığı.
    #[test]
    fn delete_chunks_for_assets_preserves_asset_level_embeddings() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        // Sahne: asset-A iki embedding (1 asset-level NULL ref_id, 1 chunk),
        //        asset-A iki text_chunk.
        //        asset-B bir asset-level embedding (kontrol: dokunulmamalı).
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO embeddings (id,asset_id,ref_id,vector_blob,source)
             VALUES
               ('A_thumb','asset-A',NULL,X'01',          'clip'),
               ('A_chunk0','asset-A','chunk0',X'02',     'chunk_text'),
               ('B_thumb','asset-B',NULL,X'03',          'clip')",
            [],
        ).unwrap();
        c.execute(
            "INSERT INTO text_chunks (id,asset_id,chunk_index,text)
             VALUES ('A_tc0','asset-A',0,'t0'),
                    ('A_tc1','asset-A',1,'t1')",
            [],
        ).unwrap();
        drop(c);

        let n = delete_chunks_for_assets(&vdb, &["asset-A".to_string()]).unwrap();
        // 2 chunk + 1 chunk-embedding silindi; asset-level embedding korundu.
        assert_eq!(n, 3, "2 chunk + 1 chunk-emb = 3");

        let c = open_vec_db(&vdb).unwrap();
        let chunks_a: i64 = c
            .query_row("SELECT COUNT(*) FROM text_chunks WHERE asset_id='asset-A'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(chunks_a, 0, "asset-A chunk'ları tam silindi");

        let asset_level: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM embeddings WHERE asset_id='asset-A' AND ref_id IS NULL",
                [], |r| r.get(0),
            ).unwrap();
        assert_eq!(asset_level, 1, "asset-A asset-level embedding korundu");

        let b_intact: i64 = c
            .query_row("SELECT COUNT(*) FROM embeddings WHERE asset_id='asset-B'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(b_intact, 1, "asset-B etkilenmedi");

        // İdempotent
        assert_eq!(delete_chunks_for_assets(&vdb, &["asset-A".to_string()]).unwrap(), 0);
        // Boş liste → 0
        assert_eq!(delete_chunks_for_assets(&vdb, &[]).unwrap(), 0);
    }

    // ── V3 A6-PRE-3b: clear_all_v3_data — `scan_clear_assets` ALL modunun
    //    vec.db karşılığı; üç tablonun tümünü boşaltır.
    #[test]
    fn clear_all_v3_data_empties_all_three_tables() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(10)).unwrap();
        migrate_embeddings(&src, &vdb, 100).unwrap();
        // text_chunks + asset_relations'ı manuel ekle (fixture sadece embeddings migrate eder).
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO text_chunks (id,asset_id,chunk_index,text)
             VALUES ('c0','asset-0',0,'x'),('c1','asset-1',0,'y')",
            [],
        ).unwrap();
        c.execute(
            "INSERT INTO asset_relations (id,source_id,target_id,relation_type,created_at)
             VALUES ('r0','asset-0','asset-1','related','t')",
            [],
        ).unwrap();
        drop(c);

        let emb_before = vec_count(&vdb, "embeddings").unwrap();
        assert!(emb_before > 0, "fixture embedding üretmiş olmalı");

        let rep = clear_all_v3_data(&vdb).unwrap();
        assert_eq!(rep.embeddings_deleted as i64, emb_before);
        assert_eq!(rep.chunks_deleted, 2);
        assert_eq!(rep.relations_deleted, 1);

        assert_eq!(vec_count(&vdb, "embeddings").unwrap(), 0);
        assert_eq!(vec_count(&vdb, "text_chunks").unwrap(), 0);
        assert_eq!(vec_count(&vdb, "asset_relations").unwrap(), 0);

        // İdempotent — boş tablodan sil → 0
        let rep2 = clear_all_v3_data(&vdb).unwrap();
        assert_eq!(rep2, CascadeDeleteReport::default());
    }

    #[test]
    fn clear_all_v3_data_on_missing_vec_db_is_noop() {
        // vec.db dosyası hiç yoksa NOOP (open_vec_db oluşturur; ama biz erkenden
        // exists() check'i ile dosyayı bile yaratmadan dönüyoruz).
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("does_not_exist_vec.db");
        let rep = clear_all_v3_data(&vdb).unwrap();
        assert_eq!(rep, CascadeDeleteReport::default());
        assert!(!vdb.exists(), "var olmayan vec.db NOOP'ta yaratılmamalı");
    }

    // ── PRE-5a: FTS5 keyword index (epoch>=2 okuma yolu) ─────────────────────

    fn tc(id: &str, asset: &str, text: &str) -> TextChunkRow {
        TextChunkRow {
            id: id.to_string(),
            asset_id: asset.to_string(),
            chunk_index: 0,
            page: None,
            text: text.to_string(),
            lang: Some("tr".to_string()),
        }
    }

    #[test]
    fn fts_normalize_folds_turkish_to_ascii() {
        assert_eq!(fts_normalize("Şenay ÇAĞDAŞ"), "senay cagdas");
        assert_eq!(fts_normalize("İSTANBUL ışık"), "istanbul isik");
        assert_eq!(fts_normalize("Öğürtü ÜÇ"), "ogurtu uc");
        // 'I' → 'i' (sql.js toLocaleLowerCase('tr') 'I'→'ı'→'i' net sonucu)
        assert_eq!(fts_normalize("ILIK"), "ilik");
        // ASCII dokunulmaz, yalnız küçük harfe iner
        assert_eq!(fts_normalize("Hello-World 123"), "hello-world 123");
    }

    #[test]
    fn apply_text_chunks_populates_fts_index() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                tc("c1", "a1", "Şenay Hanım bina ruhsatı"),
                tc("c2", "a2", "merdiven detay paftası"),
            ],
        )
        .unwrap();
        assert_eq!(vec_count(&vdb, "fts_chunks").unwrap(), 2);
        // Türkçe terim normalize edilerek bulunur (Şenay → senay)
        let hits = fts_search_chunks(&vdb, "şenay", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk_id, "c1");
        assert_eq!(hits[0].asset_id, "a1");
    }

    #[test]
    fn fts_search_prefix_and_multi_token_or() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                tc("c1", "a1", "bina ruhsat projesi"),
                tc("c2", "a2", "merdiven detayı"),
                tc("c3", "a3", "elektrik tesisat planı"),
            ],
        )
        .unwrap();
        // Prefix: "proj" → "projesi"yi yakalar
        let p = fts_search_chunks(&vdb, "proj", 10).unwrap();
        assert_eq!(p.len(), 1);
        assert_eq!(p[0].chunk_id, "c1");
        // Çok-token OR: "merdiven elektrik" → c2 + c3
        let m = fts_search_chunks(&vdb, "merdiven elektrik", 10).unwrap();
        let ids: std::collections::HashSet<_> =
            m.iter().map(|h| h.chunk_id.as_str()).collect();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains("c2") && ids.contains("c3"));
    }

    #[test]
    fn fts_search_limit_and_short_query_rules() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                tc("c1", "a1", "bina ruhsat"),
                tc("c2", "a2", "bina kat"),
                tc("c3", "a3", "bina proje"),
            ],
        )
        .unwrap();
        // limit uygulanır
        assert_eq!(fts_search_chunks(&vdb, "bina", 2).unwrap().len(), 2);
        // 3 karakterden kısa token → anlamlı token yok → boş
        assert!(fts_search_chunks(&vdb, "ev", 10).unwrap().is_empty());
        // boşluk-only sorgu → boş
        assert!(fts_search_chunks(&vdb, "   ", 10).unwrap().is_empty());
    }

    #[test]
    fn fts_search_on_missing_vec_db_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("yok_vec.db");
        assert!(fts_search_chunks(&vdb, "bina", 10).unwrap().is_empty());
        assert!(!vdb.exists(), "arama vec.db dosyasını yaratmamalı");
    }

    #[test]
    fn apply_text_chunks_idempotent_does_not_double_fts() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        let rows = [tc("c1", "a1", "bina ruhsat"), tc("c2", "a1", "kat planı")];
        assert_eq!(apply_text_chunks(&vdb, &rows).unwrap(), 2);
        // Resume: aynı batch tekrar → INSERT OR IGNORE n=0 → FTS'e çift yazmaz
        assert_eq!(apply_text_chunks(&vdb, &rows).unwrap(), 0);
        assert_eq!(vec_count(&vdb, "fts_chunks").unwrap(), 2);
        assert_eq!(fts_search_chunks(&vdb, "bina", 10).unwrap().len(), 1);
    }

    #[test]
    fn delete_chunks_for_assets_also_clears_fts() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[tc("c1", "a1", "bina ruhsat"), tc("c2", "a2", "bina kat")],
        )
        .unwrap();
        assert_eq!(
            delete_chunks_for_assets(&vdb, &["a1".to_string()]).unwrap(),
            1
        );
        // a1 FTS'ten düştü, a2 sağlam (FTS sayıma dahil değildi → dönen 1)
        assert_eq!(vec_count(&vdb, "fts_chunks").unwrap(), 1);
        let hits = fts_search_chunks(&vdb, "bina", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].asset_id, "a2");
    }

    #[test]
    fn delete_assets_also_clears_fts() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[tc("c1", "a1", "bina ruhsat"), tc("c2", "a2", "bina kat")],
        )
        .unwrap();
        delete_assets(&vdb, &["a1".to_string()]).unwrap();
        assert_eq!(vec_count(&vdb, "fts_chunks").unwrap(), 1);
        assert!(fts_search_chunks(&vdb, "ruhsat", 10).unwrap().is_empty());
    }

    #[test]
    fn clear_all_v3_data_also_clears_fts() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(&vdb, &[tc("c1", "a1", "bina ruhsat")]).unwrap();
        clear_all_v3_data(&vdb).unwrap();
        assert_eq!(vec_count(&vdb, "fts_chunks").unwrap(), 0);
        assert!(fts_search_chunks(&vdb, "bina", 10).unwrap().is_empty());
    }

    #[test]
    fn migrate_text_chunks_populates_fts() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("archivist.db");
        let vdb = tmp.path().join("v.db");
        make_v249_db(&src, DbProfile::Sized(20)).unwrap();
        assert_eq!(migrate_text_chunks(&src, &vdb, 6).unwrap(), 20);
        // Migrate FTS'i de doldurdu (fixture metni "Lorem ipsum dolor sit amet.")
        assert_eq!(vec_count(&vdb, "fts_chunks").unwrap(), 20);
        assert_eq!(fts_search_chunks(&vdb, "lorem", 100).unwrap().len(), 20);
    }

    #[test]
    fn rebuild_fts_repopulates_from_text_chunks() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[tc("c1", "a1", "bina ruhsat"), tc("c2", "a2", "merdiven plan")],
        )
        .unwrap();
        // PRE-5a öncesi vec.db simülasyonu: FTS boş, text_chunks dolu
        open_vec_db(&vdb)
            .unwrap()
            .execute("DELETE FROM fts_chunks", [])
            .unwrap();
        assert_eq!(vec_count(&vdb, "fts_chunks").unwrap(), 0);
        assert!(fts_search_chunks(&vdb, "bina", 10).unwrap().is_empty());
        // rebuild: text_chunks'tan tam yeniden kurar
        assert_eq!(rebuild_fts(&vdb).unwrap(), 2);
        assert_eq!(vec_count(&vdb, "fts_chunks").unwrap(), 2);
        assert_eq!(fts_search_chunks(&vdb, "merdiven", 10).unwrap().len(), 1);
    }

    // ── PRE-5b: embeddings okuma yüzeyi (epoch>=1 okuma yolu) ────────────────

    #[test]
    fn embedding_stats_counts_total_and_distinct() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        // var olmayan vec.db → 0/0, dosya yaratılmaz
        let s0 = embedding_stats(&vdb).unwrap();
        assert_eq!((s0.total, s0.distinct_assets), (0, 0));
        assert!(!vdb.exists());
        apply_embeddings(&vdb, &[er("e1", "a1"), er("e2", "a1"), er("e3", "a2")])
            .unwrap();
        let s = embedding_stats(&vdb).unwrap();
        assert_eq!(s.total, 3);
        assert_eq!(s.distinct_assets, 2);
    }

    #[test]
    fn query_embeddings_by_source_exact_and_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO embeddings (id,asset_id,ref_id,vector_blob,source) VALUES
               ('1','a1',NULL,?1,'text'),
               ('2','a2',NULL,?1,'image_global'),
               ('3','a3',NULL,?1,'image_center'),
               ('4','a4','chunk0',?1,'chunk_text')",
            rusqlite::params![vec![0u8; 16]],
        )
        .unwrap();
        drop(c);
        // tam eşleşme (getAllEmbeddings)
        let txt = query_embeddings_by_source(&vdb, "text", false).unwrap();
        assert_eq!(txt.len(), 1);
        assert_eq!(txt[0].asset_id, "a1");
        assert_eq!(txt[0].vector.len(), 4, "16 bayt → 4 f32");
        // prefix (getEmbeddingsBySourcePrefix): 'image_' → 2 satır
        let img = query_embeddings_by_source(&vdb, "image_", true).unwrap();
        assert_eq!(img.len(), 2);
        // var olmayan vec.db → boş
        let missing = tmp.path().join("yok.db");
        assert!(query_embeddings_by_source(&missing, "text", false)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn query_chunk_embeddings_by_assets_filters_source_refid_and_scope() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO embeddings (id,asset_id,ref_id,vector_blob,source) VALUES
               ('1','a1','c1',?1,'chunk_text'),
               ('2','a1',NULL,?1,'text'),
               ('3','a2','c2',?1,'chunk_text'),
               ('4','a3','c3',?1,'chunk_text')",
            rusqlite::params![vec![0u8; 16]],
        )
        .unwrap();
        drop(c);
        let rows = query_chunk_embeddings_by_assets(
            &vdb,
            &["a1".to_string(), "a2".to_string()],
            "chunk_text",
        )
        .unwrap();
        // a1.c1 + a2.c2 = 2; a1 asset-level ('text', ref_id NULL) ve a3 HARİÇ
        assert_eq!(rows.len(), 2);
        let ids: std::collections::HashSet<_> =
            rows.iter().map(|r| r.chunk_id.as_str()).collect();
        assert!(ids.contains("c1") && ids.contains("c2"));
        // boş liste → boş
        assert!(query_chunk_embeddings_by_assets(&vdb, &[], "chunk_text")
            .unwrap()
            .is_empty());
        // var olmayan vec.db → boş
        let missing = tmp.path().join("yok.db");
        assert!(query_chunk_embeddings_by_assets(
            &missing,
            &["a1".to_string()],
            "chunk_text"
        )
        .unwrap()
        .is_empty());
    }

    // ── PRE-5c: text_chunks okuma yüzeyi (epoch>=2 okuma yolu) ───────────────

    #[test]
    fn query_chunks_by_ids_returns_matching_records() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                tc("c1", "a1", "ilk chunk"),
                tc("c2", "a1", "ikinci chunk"),
                tc("c3", "a2", "baska asset"),
            ],
        )
        .unwrap();
        let rows =
            query_chunks_by_ids(&vdb, &["c1".to_string(), "c3".to_string()]).unwrap();
        assert_eq!(rows.len(), 2);
        let ids: std::collections::HashSet<_> =
            rows.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains("c1") && ids.contains("c3"));
        // boş input → boş; var olmayan vec.db → boş
        assert!(query_chunks_by_ids(&vdb, &[]).unwrap().is_empty());
        let missing = tmp.path().join("yok.db");
        assert!(query_chunks_by_ids(&missing, &["c1".to_string()])
            .unwrap()
            .is_empty());
    }

    #[test]
    fn query_chunks_by_asset_ordered_and_limited() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        // chunk_index sırasını test için karışık ekle.
        apply_text_chunks(
            &vdb,
            &[
                TextChunkRow {
                    id: "c2".into(),
                    asset_id: "a1".into(),
                    chunk_index: 2,
                    page: None,
                    text: "üç".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "c0".into(),
                    asset_id: "a1".into(),
                    chunk_index: 0,
                    page: Some(1),
                    text: "bir".into(),
                    lang: Some("tr".into()),
                },
                TextChunkRow {
                    id: "c1".into(),
                    asset_id: "a1".into(),
                    chunk_index: 1,
                    page: None,
                    text: "iki".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "x0".into(),
                    asset_id: "a2".into(),
                    chunk_index: 0,
                    page: None,
                    text: "diger".into(),
                    lang: None,
                },
            ],
        )
        .unwrap();
        // chunk_index ASC sıralı, yalnız a1
        let all = query_chunks_by_asset(&vdb, "a1", 0).unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(
            all.iter().map(|r| r.chunk_index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(all[0].page, Some(1));
        assert_eq!(all[0].lang.as_deref(), Some("tr"));
        // limit uygulanır (ilk 2)
        let lim = query_chunks_by_asset(&vdb, "a1", 2).unwrap();
        assert_eq!(lim.len(), 2);
        assert_eq!(lim[0].id, "c0");
    }

    #[test]
    fn chunk_count_for_asset_counts_scoped() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[tc("c1", "a1", "x"), tc("c2", "a1", "y"), tc("c3", "a2", "z")],
        )
        .unwrap();
        assert_eq!(chunk_count_for_asset(&vdb, "a1").unwrap(), 2);
        assert_eq!(chunk_count_for_asset(&vdb, "a2").unwrap(), 1);
        assert_eq!(chunk_count_for_asset(&vdb, "yok").unwrap(), 0);
        // var olmayan vec.db → 0
        let missing = tmp.path().join("yok.db");
        assert_eq!(chunk_count_for_asset(&missing, "a1").unwrap(), 0);
    }

    // ── PRE-5e: asset_relations okuma yüzeyi (epoch>=3 okuma yolu) ───────────

    #[test]
    fn query_asset_relations_by_asset_and_all() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO asset_relations
               (id,source_id,target_id,relation_type,notes,created_at,created_by) VALUES
               ('r1','a1','a2','version_of',NULL,'t','auto'),
               ('r2','a3','a1','pdf_export','not','t','user'),
               ('r3','a2','a3','render_of',NULL,'t','auto')",
            [],
        )
        .unwrap();
        drop(c);
        // asset'li: a1 → r1 (source) + r2 (target) = 2
        let a1 = query_asset_relations(&vdb, Some("a1")).unwrap();
        assert_eq!(a1.len(), 2);
        let ids: std::collections::HashSet<_> =
            a1.iter().map(|r| r.id.as_str()).collect();
        assert!(ids.contains("r1") && ids.contains("r2"));
        // alan kontrolü
        let r2 = a1.iter().find(|r| r.id == "r2").unwrap();
        assert_eq!(r2.relation_type, "pdf_export");
        assert_eq!(r2.notes.as_deref(), Some("not"));
        assert_eq!(r2.created_by.as_deref(), Some("user"));
        // asset'siz: tümü = 3
        assert_eq!(query_asset_relations(&vdb, None).unwrap().len(), 3);
        // eşleşmeyen asset → boş
        assert!(query_asset_relations(&vdb, Some("yok")).unwrap().is_empty());
        // var olmayan vec.db → boş
        let missing = tmp.path().join("yok.db");
        assert!(query_asset_relations(&missing, None).unwrap().is_empty());
    }

    // ── PRE-5f: index durum/sayım okuma yüzeyi ───────────────────────────────

    #[test]
    fn rag_index_counts_groups_by_asset() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[tc("c1", "a1", "x"), tc("c2", "a1", "y"), tc("c3", "a2", "z")],
        )
        .unwrap();
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO embeddings (id,asset_id,ref_id,vector_blob,source) VALUES
               ('e1','a1','c1',X'01','chunk_text'),
               ('e2','a1',NULL,X'02','text'),
               ('e3','a2','c3',X'03','chunk_text')",
            [],
        )
        .unwrap();
        drop(c);
        let r = rag_index_counts(&vdb).unwrap();
        let cc: std::collections::HashMap<_, _> = r
            .chunk_counts
            .iter()
            .map(|x| (x.asset_id.as_str(), x.count))
            .collect();
        assert_eq!(cc.get("a1"), Some(&2));
        assert_eq!(cc.get("a2"), Some(&1));
        // embed: yalnız chunk_text + dolu ref_id (e2 'text'/NULL hariç)
        let ec: std::collections::HashMap<_, _> = r
            .embed_counts
            .iter()
            .map(|x| (x.asset_id.as_str(), x.count))
            .collect();
        assert_eq!(ec.get("a1"), Some(&1));
        assert_eq!(ec.get("a2"), Some(&1));
    }

    #[test]
    fn chunk_stats_counts_meta_and_content() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                TextChunkRow {
                    id: "m1".into(),
                    asset_id: "a1".into(),
                    chunk_index: -1,
                    page: None,
                    text: "meta".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "b1".into(),
                    asset_id: "a1".into(),
                    chunk_index: 0,
                    page: None,
                    text: "body".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "m2".into(),
                    asset_id: "a2".into(),
                    chunk_index: -1,
                    page: None,
                    text: "meta2".into(),
                    lang: None,
                },
            ],
        )
        .unwrap();
        let s = chunk_stats(&vdb).unwrap();
        assert_eq!(s.total, 3);
        assert_eq!(s.meta_total, 2);
        assert_eq!(s.meta_assets, 2);
        assert_eq!(s.content_assets, 1);
        // var olmayan vec.db → hepsi 0
        let missing = tmp.path().join("yok.db");
        let s0 = chunk_stats(&missing).unwrap();
        assert_eq!(
            (s0.total, s0.meta_total, s0.meta_assets, s0.content_assets),
            (0, 0, 0, 0)
        );
    }

    // ── PRE-6b: body_chunk_counts (purgeNonIndexableChunks epoch>=2) ─────────

    #[test]
    fn body_chunk_counts_excludes_metadata_chunks() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                // a1: 2 body chunk + 1 metadata chunk
                TextChunkRow {
                    id: "b1".into(),
                    asset_id: "a1".into(),
                    chunk_index: 0,
                    page: None,
                    text: "body1".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "b2".into(),
                    asset_id: "a1".into(),
                    chunk_index: 1,
                    page: None,
                    text: "body2".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "m1".into(),
                    asset_id: "a1".into(),
                    chunk_index: -1,
                    page: None,
                    text: "meta".into(),
                    lang: None,
                },
                // a2: yalnız metadata chunk → body_chunk_counts'ta GÖRÜNMEZ
                TextChunkRow {
                    id: "m2".into(),
                    asset_id: "a2".into(),
                    chunk_index: -1,
                    page: None,
                    text: "meta2".into(),
                    lang: None,
                },
            ],
        )
        .unwrap();
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO embeddings (id,asset_id,ref_id,vector_blob,source) VALUES
               ('e1','a1','b1',X'01','chunk_text'),
               ('e2','a1','m1',X'02','chunk_text'),
               ('e3','a2','m2',X'03','chunk_text')",
            [],
        )
        .unwrap();
        drop(c);
        let r = body_chunk_counts(&vdb).unwrap();
        let cc: std::collections::HashMap<_, _> = r
            .chunk_counts
            .iter()
            .map(|x| (x.asset_id.as_str(), x.count))
            .collect();
        // a1: 2 body chunk; a2: yalnız metadata → hiç görünmez
        assert_eq!(cc.get("a1"), Some(&2));
        assert_eq!(cc.get("a2"), None);
        let ec: std::collections::HashMap<_, _> = r
            .embed_counts
            .iter()
            .map(|x| (x.asset_id.as_str(), x.count))
            .collect();
        // e1 body chunk (b1) → sayılır; e2/e3 metadata chunk → sayılmaz
        assert_eq!(ec.get("a1"), Some(&1));
        assert_eq!(ec.get("a2"), None);
        // var olmayan vec.db → boş
        let missing = tmp.path().join("yok.db");
        let r0 = body_chunk_counts(&missing).unwrap();
        assert!(r0.chunk_counts.is_empty() && r0.embed_counts.is_empty());
    }

    // ── PRE-6c: metadata_chunk_asset_ids + delete_metadata_chunks ───────────

    #[test]
    fn metadata_chunk_asset_ids_lists_assets_with_meta_chunk() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                // a1: metadata chunk → listede
                TextChunkRow {
                    id: "m1".into(),
                    asset_id: "a1".into(),
                    chunk_index: -1,
                    page: None,
                    text: "meta".into(),
                    lang: None,
                },
                // a2: yalnız body chunk → listede DEĞİL
                TextChunkRow {
                    id: "b1".into(),
                    asset_id: "a2".into(),
                    chunk_index: 0,
                    page: None,
                    text: "body".into(),
                    lang: None,
                },
                // a3: hem metadata hem body → listede (DISTINCT, bir kez)
                TextChunkRow {
                    id: "m3".into(),
                    asset_id: "a3".into(),
                    chunk_index: -1,
                    page: None,
                    text: "meta3".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "b3".into(),
                    asset_id: "a3".into(),
                    chunk_index: 0,
                    page: None,
                    text: "body3".into(),
                    lang: None,
                },
            ],
        )
        .unwrap();
        let mut ids = metadata_chunk_asset_ids(&vdb).unwrap();
        ids.sort();
        assert_eq!(ids, vec!["a1".to_string(), "a3".to_string()]);
        // var olmayan vec.db → boş
        assert!(metadata_chunk_asset_ids(&tmp.path().join("yok.db"))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn delete_metadata_chunks_removes_meta_keeps_body() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                TextChunkRow {
                    id: "a1_meta_1".into(),
                    asset_id: "a1".into(),
                    chunk_index: -1,
                    page: None,
                    text: "meta".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "a1_body_1".into(),
                    asset_id: "a1".into(),
                    chunk_index: 0,
                    page: None,
                    text: "body".into(),
                    lang: None,
                },
                TextChunkRow {
                    id: "a2_meta_1".into(),
                    asset_id: "a2".into(),
                    chunk_index: -1,
                    page: None,
                    text: "meta2".into(),
                    lang: None,
                },
            ],
        )
        .unwrap();
        let c = open_vec_db(&vdb).unwrap();
        c.execute(
            "INSERT INTO embeddings (id,asset_id,ref_id,vector_blob,source) VALUES
               ('e_meta','a1','a1_meta_1',X'01','chunk_text'),
               ('e_body','a1','a1_body_1',X'02','chunk_text')",
            [],
        )
        .unwrap();
        drop(c);

        let n = delete_metadata_chunks(&vdb, "a1").unwrap();
        assert_eq!(n, 1); // a1'in 1 metadata chunk'ı silindi

        let c = open_vec_db(&vdb).unwrap();
        let q = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
        // a1 meta chunk gitti; a1 body chunk + a2 meta chunk KALDI
        assert_eq!(
            q("SELECT COUNT(*) FROM text_chunks WHERE asset_id='a1' AND chunk_index=-1"),
            0
        );
        assert_eq!(
            q("SELECT COUNT(*) FROM text_chunks WHERE asset_id='a1' AND chunk_index>=0"),
            1
        );
        assert_eq!(q("SELECT COUNT(*) FROM text_chunks WHERE asset_id='a2'"), 1);
        // meta embedding gitti (ref_id), body embedding kaldı
        assert_eq!(q("SELECT COUNT(*) FROM embeddings WHERE id='e_meta'"), 0);
        assert_eq!(q("SELECT COUNT(*) FROM embeddings WHERE id='e_body'"), 1);
        // meta FTS satırı gitti, body FTS kaldı
        assert_eq!(
            q("SELECT COUNT(*) FROM fts_chunks WHERE chunk_id='a1_meta_1'"),
            0
        );
        assert_eq!(
            q("SELECT COUNT(*) FROM fts_chunks WHERE chunk_id='a1_body_1'"),
            1
        );
        drop(c);

        // var olmayan vec.db → 0, hata yok
        assert_eq!(
            delete_metadata_chunks(&tmp.path().join("yok.db"), "a1").unwrap(),
            0
        );
    }

    // ── PRE-6d: export_assets + import_assets (klasör-sil undo) ──────────────

    #[test]
    fn export_import_round_trip_preserves_all_three_tables() {
        let tmp = tempfile::tempdir().unwrap();
        let vdb = tmp.path().join("v.db");
        apply_text_chunks(
            &vdb,
            &[
                tc("c1", "a1", "metin bir"),
                TextChunkRow {
                    id: "c2".into(),
                    asset_id: "a1".into(),
                    chunk_index: -1,
                    page: Some(3),
                    text: "meta".into(),
                    lang: Some("tr".into()),
                },
                tc("c3", "a2", "metin uc"),
            ],
        )
        .unwrap();
        apply_embeddings(
            &vdb,
            &[
                EmbeddingRow {
                    id: "e1".into(),
                    asset_id: "a1".into(),
                    ref_id: Some("c1".into()),
                    vector_blob: vec![1, 2, 3, 4],
                    source: "chunk_text".into(),
                },
                EmbeddingRow {
                    id: "e2".into(),
                    asset_id: "a1".into(),
                    ref_id: None,
                    vector_blob: vec![9, 9],
                    source: "text".into(),
                },
                EmbeddingRow {
                    id: "e3".into(),
                    asset_id: "a2".into(),
                    ref_id: Some("c3".into()),
                    vector_blob: vec![5, 6],
                    source: "chunk_text".into(),
                },
            ],
        )
        .unwrap();
        apply_asset_relations(
            &vdb,
            &[
                AssetRelationRow {
                    id: "r1".into(),
                    source_id: "a1".into(),
                    target_id: "a2".into(),
                    relation_type: "version_of".into(),
                    notes: Some("kullanici notu".into()),
                    created_at: "t".into(),
                    created_by: Some("user".into()),
                },
                AssetRelationRow {
                    id: "r2".into(),
                    source_id: "a3".into(),
                    target_id: "a3".into(),
                    relation_type: "x".into(),
                    notes: None,
                    created_at: "t".into(),
                    created_by: Some("auto".into()),
                },
            ],
        )
        .unwrap();

        // Export a1 + a2 — r1 (a1↔a2) yakalanır, r2 (a3) yakalanmaz
        let exp = export_assets(&vdb, &["a1".to_string(), "a2".to_string()]).unwrap();
        assert_eq!(exp.embeddings.len(), 3);
        assert_eq!(exp.text_chunks.len(), 3);
        assert_eq!(exp.asset_relations.len(), 1);
        assert_eq!(exp.asset_relations[0].id, "r1");
        assert_eq!(exp.asset_relations[0].notes.as_deref(), Some("kullanici notu"));

        // Boş vec.db'ye import → birebir geri gelir (notes + FTS dahil)
        let vdb2 = tmp.path().join("v2.db");
        import_assets(&vdb2, &exp).unwrap();
        let re = export_assets(&vdb2, &["a1".to_string(), "a2".to_string()]).unwrap();
        assert_eq!(re.embeddings.len(), 3);
        assert_eq!(re.text_chunks.len(), 3);
        assert_eq!(re.asset_relations.len(), 1);
        assert_eq!(re.asset_relations[0].notes.as_deref(), Some("kullanici notu"));
        // apply_text_chunks FTS'i de besledi
        let c = open_vec_db(&vdb2).unwrap();
        let fts: i64 = c
            .query_row("SELECT COUNT(*) FROM fts_chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(fts, 3);
        drop(c);

        // import idempotent — ikinci kez çift yazmaz (INSERT OR IGNORE)
        import_assets(&vdb2, &exp).unwrap();
        let re2 = export_assets(&vdb2, &["a1".to_string(), "a2".to_string()]).unwrap();
        assert_eq!(re2.embeddings.len(), 3);
        assert_eq!(re2.text_chunks.len(), 3);
        assert_eq!(re2.asset_relations.len(), 1);

        // var olmayan vec.db / boş asset listesi → boş export, hata yok
        let e0 = export_assets(&tmp.path().join("yok.db"), &["a1".to_string()]).unwrap();
        assert!(
            e0.embeddings.is_empty()
                && e0.text_chunks.is_empty()
                && e0.asset_relations.is_empty()
        );
        let e1 = export_assets(&vdb, &[]).unwrap();
        assert!(e1.embeddings.is_empty());
    }
