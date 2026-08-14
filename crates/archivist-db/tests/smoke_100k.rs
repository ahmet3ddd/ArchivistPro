//! 100K (varsayilan) sentetik smoke testi — Faz 1 olcek hedefi dogrulamasi.
//!
//! H2'nin coktugu yer: ~1.13M satir tarayici/V8 heap'inde → "Aw Snap". H3 tezi:
//! veriyi Rust+native SQLite sahiplenir, renderer heap'i konu disi. Bu test o tezi
//! olcekte dogrular: 100K asset + FTS5 + DB-ici sqlite-vec, **process bellegi sabit**
//! (vektorler diske akar), temsili sorgular hizli.
//!
//! Normal `cargo test`'i yavaslatmamak icin `#[ignore]`. Calistir:
//!   cargo test --release -p archivist-db -- --ignored --nocapture
//! Olcek degistir (or. 1M):
//!   $env:ARSIV_SMOKE_N=1000000; cargo test --release -p archivist-db -- --ignored --nocapture

use archivist_db::{connection, health, migrations};
use rusqlite::params;
use std::time::Instant;

/// Embedding boyutu — sema (`asset_vectors FLOAT[384]`, migration 0009) ile ayni olmali.
const DIM: usize = 384;

fn smoke_n() -> i64 {
    std::env::var("ARSIV_SMOKE_N")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(100_000)
}

fn temp_db_path() -> std::path::PathBuf {
    std::env::temp_dir().join("arsiv_h3_smoke.db")
}

/// DB + WAL + SHM yan dosyalarini temizle.
fn cleanup(path: &std::path::Path) {
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{}", path.display(), suffix));
    }
}

#[test]
#[ignore = "100K olcek smoke; elle: cargo test --release -p archivist-db -- --ignored --nocapture"]
fn smoke_100k_scale() {
    let n = smoke_n();
    let path = temp_db_path();
    cleanup(&path);

    let total = Instant::now();
    let mut conn = connection::open(&path).expect("smoke: db acilamadi");
    migrations::run(&mut conn).expect("smoke: migration");

    // ── Ingest: asset + FTS(trigger) + vektor, TEK transaction (transactional). ──
    // Tek f32-blob buffer yeniden kullanilir → ingest bellegi O(1).
    let t_ingest = Instant::now();
    {
        let tx = conn.transaction().unwrap();
        {
            let mut ins_asset = tx
                .prepare(
                    "INSERT INTO assets(id, path, file_name, ext, size_bytes, title, created_at, modified_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                )
                .unwrap();
            let mut ins_vec = tx
                .prepare("INSERT INTO asset_vectors(asset_id, embedding) VALUES (?1, ?2)")
                .unwrap();

            let exts = ["dwg", "rvt", "pdf", "skp", "ifc"];
            let mut buf = vec![0u8; DIM * 4];
            let one = 1.0f32.to_le_bytes();
            let zero = 0.0f32.to_le_bytes();

            for id in 1..=n {
                let ext = exts[(id as usize) % exts.len()];
                // FTS icin aranabilir token: ciftler "villa", tekler "ofis".
                let kind = if id % 2 == 0 { "villa" } else { "ofis" };
                let path_s = format!("/arsiv/{}/dosya_{}.{}", id % 1000, id, ext);
                let fname = format!("dosya_{}.{}", id, ext);
                let title = format!("Proje {} {}", id, kind);
                ins_asset
                    .execute(params![id, path_s, fname, ext, (id * 11) % 1_000_000, title, id])
                    .unwrap();

                // Birim-baz vektor: dim (id % DIM) sicak → kNN deterministik.
                let off = ((id as usize) % DIM) * 4;
                buf[off..off + 4].copy_from_slice(&one);
                ins_vec.execute(params![id, buf.as_slice()]).unwrap();
                buf[off..off + 4].copy_from_slice(&zero);
            }
        }
        tx.commit().unwrap();
    }
    let ingest_s = t_ingest.elapsed().as_secs_f64();

    // ── Dogrulamalar: sayim ──
    let assets: i64 = conn
        .query_row("SELECT count(*) FROM assets", [], |r| r.get(0))
        .unwrap();
    let vecs: i64 = conn
        .query_row("SELECT count(*) FROM asset_vectors", [], |r| r.get(0))
        .unwrap();
    assert_eq!(assets, n, "asset sayisi");
    assert_eq!(vecs, n, "vektor sayisi");

    // ── FTS5: sayim + sayfali sorgu (renderer "yalniz o sayfa" deseni) ──
    let t_fts = Instant::now();
    let villa_hits: i64 = conn
        .query_row(
            "SELECT count(*) FROM assets_fts WHERE assets_fts MATCH 'villa'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(villa_hits, n / 2, "FTS 'villa' beklenen hit");
    let page: Vec<i64> = {
        let mut s = conn
            .prepare(
                "SELECT a.id FROM assets_fts JOIN assets a ON a.id = assets_fts.asset_id
                 WHERE assets_fts MATCH 'villa' ORDER BY a.id LIMIT 50",
            )
            .unwrap();
        let rows = s.query_map([], |r| r.get::<_, i64>(0)).unwrap();
        rows.map(Result::unwrap).collect()
    };
    assert_eq!(page.len(), 50, "sayfa boyu");
    let fts_ms = t_fts.elapsed().as_secs_f64() * 1000.0;

    // ── Vektor kNN (DB-ici, brute-force; dusuk-QPS arsiv app'i icin yeterli) ──
    let t_knn = Instant::now();
    let q_dim = 3usize;
    let mut qbuf = vec![0u8; DIM * 4];
    qbuf[q_dim * 4..q_dim * 4 + 4].copy_from_slice(&1.0f32.to_le_bytes());
    let nearest: i64 = conn
        .query_row(
            "SELECT asset_id FROM asset_vectors WHERE embedding MATCH ?1 ORDER BY distance LIMIT 1",
            params![qbuf.as_slice()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!((nearest as usize) % DIM, q_dim, "kNN en yakin komsu dim'i");
    let knn_ms = t_knn.elapsed().as_secs_f64() * 1000.0;

    // ── Butunluk ──
    let t_integrity = Instant::now();
    assert!(health::integrity_ok(&conn).unwrap(), "integrity_check");
    assert_eq!(health::orphan_count(&conn).unwrap(), 0, "yetim satir");
    let integrity_s = t_integrity.elapsed().as_secs_f64();
    assert_eq!(
        conn.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0)).unwrap(),
        migrations::MIGRATIONS.last().unwrap().version
    );

    let db_mb = std::fs::metadata(&path)
        .map(|m| m.len() as f64 / 1_048_576.0)
        .unwrap_or(0.0);
    let total_s = total.elapsed().as_secs_f64();

    println!("\n=== Arsiv-H3 smoke (N={n}) ===");
    println!("ingest (asset+FTS+vektor, tek TX): {ingest_s:>7.2}s  ({:.0} asset/s)", n as f64 / ingest_s);
    println!("FTS 'villa' sayim+sayfa(50):       {fts_ms:>7.1}ms (hit={villa_hits})");
    println!("vektor kNN top-1 ({DIM}-boyut):      {knn_ms:>7.1}ms");
    println!("butunluk (integrity+orphan):       {integrity_s:>7.2}s");
    println!("DB dosya boyutu:                   {db_mb:>7.1} MB");
    println!("TOPLAM:                            {total_s:>7.2}s");

    drop(conn);
    cleanup(&path);

    // Cokme/asilma korumasi (cok genis; performans esigi DEGIL) — olcekle ORANTILI:
    // varsayilan 100K'da 300s (gercegin ~8 kati), 1M'de 3000s. Sabit 300s parametrik
    // N'i (dok. ornegi ARSIV_SMOKE_N=1000000) yanlislikla dusururdu; oran bunu onler.
    let max_s = (n as f64 / 100_000.0 * 300.0).max(300.0);
    assert!(total_s < max_s, "smoke cok yavas/asili: {total_s:.1}s (N={n}, sinir={max_s:.0}s)");
}
