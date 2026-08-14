//! Arsiv birlestirme (merge) veri katmani entegrasyon testleri — EN RISKLI KATMAN.
//!
//! Bir `.archivistpro` (ham SQLite) arsivinin asset'lerini CANLI arsive **EKLE** (import =
//! butun-DB REPLACE'in AKSINE, additive). H2 dersleri (H3'e uyarlanmis):
//!  - Tek native DB → **tek transaction icinde ATTACH + INSERT…SELECT**; rollback =
//!    `BEGIN…COMMIT/ROLLBACK` (byte-snapshot YOK).
//!  - Cakisma **content_hash** ile (id'ler per-DB autoincrement → her merge asset yeni id alir).
//!  - Tag/collection **isimle** uzlastirilir.
//!
//! Bu dosya SAF-SQL/model-bagimsiz: gercek DXF/ONNX yok; sentetik veri + gercek yazma API'leri
//! (ingest / set_vector / set_asset_shapes / set_asset_chunks) ile iki temp DB (kaynak+hedef)
//! kurulur, `merge_from` kosulur ve butunluk (yetim yok, capraz-baglanti yok) dogrulanir.

use archivist_db::{
    AssetInput, Db, IngestData, ListOpts, MergeDisposition, MetaVal, ShapeInput, TEXT_EMBED_DIM,
};
use rusqlite::params;
use std::path::Path;
use std::time::Instant;

// ── Seed yardimcilari (gercek yazma API'leri) ────────────────────────────────────

fn ingest(db: &mut Db, path: &str, name: &str, hash: Option<&str>, body: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: name,
            ext: Some("pdf"),
            size_bytes: 10,
            content_hash: hash,
            mime: None,
            title: Some(name),
            description: None,
            created_at: 1,
            modified_at: 1,
        },
        &IngestData {
            fts_body: Some(body),
            metadata: &[("author".to_string(), MetaVal::Text("Ada".to_string()))],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

fn unit_vec(hot: usize) -> Vec<f32> {
    let mut v = vec![0f32; TEXT_EMBED_DIM];
    v[hot] = 1.0;
    v
}

/// 512-boyut (CLIP/gorsel) birim vektor — gorsel BOLGE vektor merge testleri icin.
fn img_unit_vec(hot: usize) -> Vec<f32> {
    let mut v = vec![0f32; 512];
    v[hot] = 1.0;
    v
}

fn shape(closed: bool, vc: i64) -> ShapeInput {
    ShapeInput {
        entity_type: "LWPOLYLINE".into(),
        layer_name: Some("DUVAR".into()),
        vertex_count: vc,
        is_closed: closed,
        area: 1.0,
        perimeter: 4.0,
        aspect_ratio: 1.0,
        regularity: 1.0,
        compactness: 1.0,
        solidity: 1.0,
        rectangularity: 1.0,
        bbox_w: 1.0,
        bbox_h: 1.0,
        centroid_x: 0.0,
        centroid_y: 0.0,
    }
}

fn open_at(dir: &Path, name: &str) -> Db {
    Db::open_and_migrate(&dir.join(name)).unwrap()
}

fn new_id_for(db: &Db, path: &str) -> Option<i64> {
    db.connection()
        .query_row("SELECT id FROM assets WHERE path = ?1", params![path], |r| r.get(0))
        .ok()
}

fn count(db: &Db, sql: &str) -> i64 {
    db.connection().query_row(sql, [], |r| r.get(0)).unwrap()
}

// ── 1) SkipDuplicates: hash-dup atlanir, yeni icerik gelir ───────────────────────

#[test]
fn skip_duplicates_skips_hash_dup_imports_new() {
    let dir = tempfile::tempdir().unwrap();

    let mut dst = open_at(dir.path(), "dst.db");
    ingest(&mut dst, r"C:\Hedef\ortak.pdf", "ortak.pdf", Some("HASH_ORTAK"), "hedef ortak");

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        // Ayni content_hash (farkli yol) → SkipDuplicates'te atlanmali.
        ingest(&mut src, r"C:\Kaynak\kopya.pdf", "kopya.pdf", Some("HASH_ORTAK"), "kaynak kopya");
        // Yeni icerik → gelmeli.
        ingest(&mut src, r"C:\Kaynak\yeni.pdf", "yeni.pdf", Some("HASH_YENI"), "kaynak yeni villa");
    }

    let report = dst.merge_from(&src_path, MergeDisposition::SkipDuplicates, &[]).unwrap();

    assert_eq!(report.total_source, 2);
    assert_eq!(report.merged, 1, "yalniz yeni icerik gelir");
    assert_eq!(report.skipped_duplicate, 1, "hash-dup atlanir");
    assert_eq!(report.skipped_path_conflict, 0);
    // Invariant: merged + skipped_duplicate + skipped_path_conflict == total_source.
    assert_eq!(
        report.merged + report.skipped_duplicate + report.skipped_path_conflict,
        report.total_source
    );

    // Hedefte: eski ortak + yeni = 2 aktif asset.
    assert_eq!(dst.asset_count().unwrap(), 2);
    assert!(new_id_for(&dst, r"C:\Kaynak\yeni.pdf").is_some(), "yeni asset yeni id ile geldi");
    assert!(new_id_for(&dst, r"C:\Kaynak\kopya.pdf").is_none(), "hash-dup gelmedi");
    assert_eq!(dst.orphan_count().unwrap(), 0);
    assert!(dst.integrity_ok().unwrap());
}

// ── 2) ImportAll: hash-dup DE gelir; ayni PATH daima atlanir ─────────────────────

#[test]
fn import_all_brings_hash_dup_but_skips_path_conflict() {
    let dir = tempfile::tempdir().unwrap();

    let mut dst = open_at(dir.path(), "dst.db");
    ingest(&mut dst, r"C:\Ortak\dosya.pdf", "dosya.pdf", Some("H1"), "hedef");

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        // AYNI content_hash + FARKLI yol → ImportAll'da gelmeli (iki kopya).
        ingest(&mut src, r"C:\Kaynak\ayni-icerik.pdf", "ayni-icerik.pdf", Some("H1"), "kaynak dup");
        // AYNI YOL (path UNIQUE) → daima atlanir.
        ingest(&mut src, r"C:\Ortak\dosya.pdf", "dosya.pdf", Some("H2"), "kaynak path cakismasi");
    }

    let report = dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();

    assert_eq!(report.total_source, 2);
    assert_eq!(report.merged, 1, "hash-dup gelir; path-cakismasi gelmez");
    assert_eq!(report.skipped_duplicate, 0, "ImportAll → hash-dup atlanmaz");
    assert_eq!(report.skipped_path_conflict, 1, "ayni PATH atlanir");
    assert_eq!(report.merged + report.skipped_path_conflict, report.total_source);

    // Iki asset ayni content_hash 'H1' (hedef + kaynak kopyasi) → farkli id.
    assert_eq!(count(&dst, "SELECT count(*) FROM assets WHERE content_hash='H1'"), 2);
    assert_eq!(dst.asset_count().unwrap(), 2);
    assert_eq!(dst.orphan_count().unwrap(), 0);
    assert!(dst.integrity_ok().unwrap());
}

// ── 3) id-remap butunlugu: iliskiler YENI id'ye baglanir, capraz-baglanti yok ─────

#[test]
fn id_remap_binds_relations_to_new_id_no_cross_link() {
    let dir = tempfile::tempdir().unwrap();

    // Hedef: mevcut bir asset + kendi iliskileri (bunlar BOZULMAMALI).
    let mut dst = open_at(dir.path(), "dst.db");
    let dst_a = ingest(&mut dst, r"C:\Hedef\mevcut.pdf", "mevcut.pdf", Some("HD"), "mevcut");
    dst.add_user_tag(dst_a, "hedefetiket").unwrap();
    dst.set_vector(dst_a, &unit_vec(5)).unwrap();

    let src_path = dir.path().join("src.db");
    let (src_id, src_meta_key);
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        // Kaynakta id = 1 olacak sekilde tek asset (hedefteki mevcut ile ayni ic id → capraz-risk).
        let s = ingest(&mut src, r"C:\Kaynak\tasinan.pdf", "tasinan.pdf", Some("HS"), "tasinan villa");
        src_id = s;
        src.add_user_tag(s, "kaynaketiket").unwrap();
        src.set_favorite(s, true).unwrap();
        src.set_vector(s, &unit_vec(0)).unwrap();
        src.set_asset_shapes(s, &[shape(true, 4)]).unwrap();
        src.set_asset_chunks(
            s,
            &[archivist_db::ChunkWrite {
                chunk_index: 0,
                page: None,
                text: "tasinan chunk metni".into(),
                embedding: unit_vec(1),
            }],
        )
        .unwrap();
        // metadata (ingest 'author' yazdi) — key kontrolu icin.
        src_meta_key = "author".to_string();
    }
    // Kaynak ic id'si hedefteki mevcut asset ile ayni olabilir (autoincrement) → capraz-baglanti tuzagi.
    assert_eq!(src_id, dst_a, "test kurgusu: kaynak ve hedef ic id'leri cakisiyor (capraz-risk)");

    let report = dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();
    assert_eq!(report.merged, 1);

    let new_id = new_id_for(&dst, r"C:\Kaynak\tasinan.pdf").expect("tasinan asset geldi");
    assert_ne!(new_id, dst_a, "tasinan asset YENI id almali (hedeftekiyle cakismamali)");

    // Tasinan asset'in iliskileri YENI id'ye bagli:
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM asset_tags WHERE asset_id={new_id}")),
        1,
        "etiket-bagi yeni id'de"
    );
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM favorites WHERE asset_id={new_id}")),
        1,
        "favori yeni id'de"
    );
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM asset_vectors WHERE asset_id={new_id}")),
        1,
        "vektor yeni id'de"
    );
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM asset_shapes WHERE asset_id={new_id}")),
        1,
        "sekil yeni id'de"
    );
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM text_chunks WHERE asset_id={new_id}")),
        1,
        "chunk yeni id'de"
    );
    assert_eq!(
        count(
            &dst,
            &format!("SELECT count(*) FROM asset_metadata WHERE asset_id={new_id} AND key='{src_meta_key}'")
        ),
        1,
        "metadata yeni id'de"
    );

    // Hedefin MEVCUT asset'inin iliskileri BOZULMADI (dst_a hala kendi etiketi+vektoruyle).
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM asset_tags WHERE asset_id={dst_a}")),
        1,
        "mevcut asset etiketi korunur"
    );
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM asset_vectors WHERE asset_id={dst_a}")),
        1,
        "mevcut asset vektoru korunur"
    );

    // Yetim / capraz-baglanti YOK.
    assert_eq!(dst.orphan_count().unwrap(), 0, "yetim satir olmamali");
    assert!(dst.integrity_ok().unwrap());
    // chunk vektoru + fts de tasindi (RAG butunlugu): chunk_vectors yetim degil.
    assert_eq!(
        count(&dst, "SELECT count(*) FROM chunk_vectors"),
        1,
        "chunk vektoru tasindi"
    );
}

// ── 4) Tag isim-uzlastirma: cift tag olusmaz, yeni tag olusur ─────────────────────

#[test]
fn tags_reconciled_by_name() {
    let dir = tempfile::tempdir().unwrap();

    let mut dst = open_at(dir.path(), "dst.db");
    let d = ingest(&mut dst, r"C:\Hedef\h.pdf", "h.pdf", Some("HD"), "hedef");
    dst.add_user_tag(d, "villa").unwrap(); // hedefte "villa" var

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        let s = ingest(&mut src, r"C:\Kaynak\s.pdf", "s.pdf", Some("HS"), "kaynak");
        src.add_user_tag(s, "villa").unwrap(); // ayni ad → tek tag'e uzlas
        src.add_user_tag(s, "cephe").unwrap(); // yeni ad → olustur
    }

    let report = dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();
    assert_eq!(report.merged, 1);
    assert_eq!(report.tags_reconciled, 2, "villa (eslesti) + cephe (olustu)");

    // "villa" TEK tag (cift olusmadi); iki asset ona bagli.
    assert_eq!(count(&dst, "SELECT count(*) FROM tags WHERE name='villa'"), 1, "cift villa yok");
    let villa_id: i64 =
        dst.connection().query_row("SELECT id FROM tags WHERE name='villa'", [], |r| r.get(0)).unwrap();
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM asset_tags WHERE tag_id={villa_id}")),
        2,
        "hedef + kaynak asset ayni villa tag'ine bagli"
    );
    // "cephe" olustu.
    assert_eq!(count(&dst, "SELECT count(*) FROM tags WHERE name='cephe'"), 1, "cephe olustu");
    assert_eq!(dst.orphan_count().unwrap(), 0);
}

// ── 5) Collection isim-uzlastirma ────────────────────────────────────────────────

#[test]
fn collections_reconciled_by_name() {
    let dir = tempfile::tempdir().unwrap();

    let mut dst = open_at(dir.path(), "dst.db");
    let d = ingest(&mut dst, r"C:\Hedef\h.pdf", "h.pdf", Some("HD"), "hedef");
    let dcol = dst.create_collection("Projeler", None).unwrap();
    dst.add_to_collection(dcol, d).unwrap();

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        let s = ingest(&mut src, r"C:\Kaynak\s.pdf", "s.pdf", Some("HS"), "kaynak");
        let sc = src.create_collection("Projeler", None).unwrap(); // ayni ad
        src.add_to_collection(sc, s).unwrap();
        let sc2 = src.create_collection("Arsiv", None).unwrap(); // yeni ad
        src.add_to_collection(sc2, s).unwrap();
    }

    let report = dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();
    assert_eq!(report.merged, 1);
    assert_eq!(report.collections_reconciled, 2, "Projeler (eslesti) + Arsiv (olustu)");

    // "Projeler" TEK koleksiyon; iki asset uye.
    assert_eq!(count(&dst, "SELECT count(*) FROM collections WHERE name='Projeler'"), 1);
    let pid: i64 =
        dst.connection().query_row("SELECT id FROM collections WHERE name='Projeler'", [], |r| r.get(0)).unwrap();
    assert_eq!(
        count(&dst, &format!("SELECT count(*) FROM collection_items WHERE collection_id={pid}")),
        2,
        "hedef + kaynak asset ayni koleksiyonda"
    );
    assert_eq!(count(&dst, "SELECT count(*) FROM collections WHERE name='Arsiv'"), 1, "Arsiv olustu");
    assert_eq!(dst.orphan_count().unwrap(), 0);
}

// ── 6) relations: iki-tarafi-da-merge tasinir; tek-tarafli atlanir ───────────────

#[test]
fn relations_moved_only_when_both_endpoints_merged() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");
    ingest(&mut dst, r"C:\Hedef\h.pdf", "h.pdf", Some("HD"), "hedef");

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        let a = ingest(&mut src, r"C:\Kaynak\a.pdf", "a.pdf", Some("HA"), "a");
        let b = ingest(&mut src, r"C:\Kaynak\b.pdf", "b.pdf", Some("HB"), "b");
        let c = ingest(&mut src, r"C:\Kaynak\c.pdf", "c.pdf", Some("HC"), "c");
        // a<->b: iki tarafi da merge edilecek → tasinmali.
        src.connection()
            .execute("INSERT INTO relations(src_id,dst_id,kind) VALUES (?1,?2,'version')", params![a, b])
            .unwrap();
        // a<->c: c'yi cop'e atacagiz (merge edilmeyecek) → tek-tarafli → ATLANMALI.
        src.connection()
            .execute("INSERT INTO relations(src_id,dst_id,kind) VALUES (?1,?2,'xref')", params![a, c])
            .unwrap();
        // c'yi cop'e at → merge disi (yalniz aktif tasinir) → a-c iliskisi tek-tarafli kalir.
        src.connection().execute("UPDATE assets SET deleted_at=99 WHERE id=?1", params![c]).unwrap();
    }

    let report = dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();
    assert_eq!(report.total_source, 2, "yalniz aktif a,b (c cop'te)");
    assert_eq!(report.merged, 2);

    // Yalniz a<->b iliskisi tasindi (version); a<->c (xref) atlandi.
    assert_eq!(count(&dst, "SELECT count(*) FROM relations WHERE kind='version'"), 1, "a-b tasindi");
    assert_eq!(count(&dst, "SELECT count(*) FROM relations WHERE kind='xref'"), 0, "tek-tarafli atlandi");
    assert_eq!(dst.orphan_count().unwrap(), 0, "yetim relation yok");
    assert!(dst.integrity_ok().unwrap());
}

// ── 7) FTS body: tasinan asset FTS ile aranabilir ───────────────────────────────

#[test]
fn fts_body_moves_and_is_searchable() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");
    ingest(&mut dst, r"C:\Hedef\h.pdf", "h.pdf", Some("HD"), "hedef icerik");

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        ingest(&mut src, r"C:\Kaynak\rapor.pdf", "rapor.pdf", Some("HS"), "kaynak yangin merdiveni detayi");
    }

    dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();

    // Tasinan asset'in govdesindeki nadir terim FTS ile bulunmali.
    let opts = ListOpts { page_size: 10, query: Some("merdiveni".into()), ..Default::default() };
    let page = dst.list_assets(&opts).unwrap();
    assert_eq!(page.total, 1, "tasinan asset FTS body ile aranabilir");
    assert_eq!(page.items[0].path, r"C:\Kaynak\rapor.pdf");
    assert_eq!(dst.orphan_count().unwrap(), 0);
}

// ── 7b) AI vision-betim kolonu (assets_fts.ai; migration 0021) tasinir → merge edilen
//        analizli gorsel ANA-KUTU FTS'te aranabilir kalir. merge.rs `ai`-kolon boslugu regresyonu:
//        ai eklenmeden once merge betmi sessizce kaybediyordu (INSERT eski kolon listesiyleydi). ──
#[test]
fn merged_ai_description_is_searchable() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        // Govde BOS (gorselde extractor metni ~= yok); betim yalniz vision-analizden gelir.
        let s = ingest(&mut src, r"C:\Kaynak\gorsel.jpg", "gorsel.jpg", Some("AIH"), "");
        // Vision-analiz: betim ai_ EAV + assets_fts.ai kolonuna yazilir (set_ai_metadata).
        // Tokenlar KESIN (FTS5 unicode61 stemsiz; "bulut" tokeni "bulutlu"yu ESLESTIRMEZ).
        src.set_ai_metadata(s, &[("ai_aciklama", "cami bulut gokyuzu kubbe".to_string())])
            .unwrap();
    }

    dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();

    // `ai` kolonu tasindi → ana kutu (list_assets FTS) KOMPOZISYONEL "cami bulut" (ortuk AND) bulur.
    let opts = ListOpts { page_size: 10, query: Some("cami bulut".into()), ..Default::default() };
    let page = dst.list_assets(&opts).unwrap();
    assert_eq!(page.total, 1, "merge edilen AI-betim ana-kutu FTS'te aranabilir");
    assert_eq!(page.items[0].path, r"C:\Kaynak\gorsel.jpg");
    // "cami deniz" (deniz betimde YOK) eslesmemeli → kompozisyonel AND dogru tasindi.
    let neg = ListOpts { page_size: 10, query: Some("cami deniz".into()), ..Default::default() };
    assert_eq!(dst.list_assets(&neg).unwrap().total, 0, "eslesmeyen terim ai kolonunda bulunmaz");
    assert_eq!(dst.orphan_count().unwrap(), 0);
}

// ── 8) Vektor tasindi → semantik/similarity'de bulunur (indexed_at KORUNUR) ──────

#[test]
fn moved_vector_is_searchable() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        let s = ingest(&mut src, r"C:\Kaynak\v.pdf", "v.pdf", Some("HS"), "vektorlu");
        src.set_vector(s, &unit_vec(3)).unwrap();
    }

    dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();

    // Vektor tasindi → semantik arama sorgu vektorune (unit 3) yakin asset'i bulur.
    let opts = ListOpts { page_size: 10, ..Default::default() };
    let page = dst.semantic_search(&unit_vec(3), &opts).unwrap();
    assert_eq!(page.total, 1, "tasinan vektor semantik aramada bulunur");
    assert_eq!(page.items[0].path, r"C:\Kaynak\v.pdf");
    // indexed_at KORUNDU (yeniden-embed gerektirmez) → pending_embed 0.
    assert_eq!(dst.pending_embed_count().unwrap(), 0, "tasinan asset embed bekleyeni degil");
    assert_eq!(dst.orphan_count().unwrap(), 0);
}

// ── 8b) Gorsel BOLGE vektorleri remap: kaynak asset'in 5 bolgesi YENI asset id'sine (region
//        KORUNARAK) tasinir → metin→gorsel arama (BOLGE-MAX) tasinan asset'i bulur. PK-kodlama
//        (id = asset_id*8 + region) remap regresyonu — id/8 kaynak-asset, id%8 region. ──
#[test]
fn moved_image_region_vectors_are_remapped_and_searchable() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        let s = ingest(&mut src, r"C:\Kaynak\g.jpg", "g.jpg", Some("IMG"), "");
        // 5 bolge: region 2 sorguya (unit 7) TAM eslesir, digerleri ortogonal → BOLGE-MAX kaniti.
        src.set_image_region_vectors(
            s,
            &[
                (0, img_unit_vec(0)),
                (1, img_unit_vec(1)),
                (2, img_unit_vec(7)),
                (3, img_unit_vec(3)),
                (4, img_unit_vec(4)),
            ],
        )
        .unwrap();
    }

    dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();
    let new_id = new_id_for(&dst, r"C:\Kaynak\g.jpg").expect("gorsel asset geldi");

    // 5 bolge satiri YENI asset id altinda (id/8 = new_id); region indeksleri (id%8) KORUNDU.
    let regions: Vec<i64> = {
        let mut stmt = dst
            .connection()
            .prepare("SELECT id % 8 FROM asset_image_region_vectors WHERE id / 8 = ?1 ORDER BY id % 8")
            .unwrap();
        stmt.query_map(params![new_id], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap()
    };
    assert_eq!(regions, vec![0, 1, 2, 3, 4], "5 bolge remap edildi, region indeksleri korundu");
    assert_eq!(dst.image_vector_count().unwrap(), 1, "tasinan asset embedlenmis sayilir");

    // BOLGE-MAX: region 2 (unit 7) sorgusu tasinan asset'i skor ~1.0 ile bulur (remap saglam).
    let q = img_unit_vec(7);
    let scored = dst
        .image_search_scored(&q, &ListOpts { page_size: 10, ..Default::default() })
        .unwrap();
    assert_eq!(scored.first().map(|(r, _)| r.id), Some(new_id), "tasinan bolge aramada bulunur");
    assert!((scored[0].1 - 1.0).abs() < 1e-5, "region 2 tam eslesme → cos ~1.0, gercek: {}", scored[0].1);
    assert_eq!(dst.orphan_count().unwrap(), 0, "yetim yok (remap tam)");
}

// ── 9) Guard'lar: self-merge + schema-newer → Err (hedef degismez) ───────────────

#[test]
fn self_merge_is_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("live.db");
    let mut db = Db::open_and_migrate(&db_path).unwrap();
    ingest(&mut db, r"C:\X\a.pdf", "a.pdf", Some("H"), "x");

    // Kaynak = canli DB dosyasinin KENDISI → reddedilmeli.
    let err = db.merge_from(&db_path, MergeDisposition::ImportAll, &[]).unwrap_err();
    let msg = err.to_string().to_lowercase();
    assert!(msg.contains("kendi") || msg.contains("ayni") || msg.contains("self"), "hata: {msg}");
    assert_eq!(db.asset_count().unwrap(), 1, "hedef degismedi");
}

#[test]
fn schema_newer_is_rejected_target_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");
    ingest(&mut dst, r"C:\Hedef\h.pdf", "h.pdf", Some("HD"), "hedef");
    let before = dst.asset_count().unwrap();

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        ingest(&mut src, r"C:\Kaynak\s.pdf", "s.pdf", Some("HS"), "kaynak");
    }
    // Kaynak semasini canlidan cok yukseğe cek → "daha yeni surum".
    {
        let conn = rusqlite::Connection::open(&src_path).unwrap();
        conn.execute_batch("PRAGMA user_version = 999999;").unwrap();
    }

    let err = dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap_err();
    assert!(err.to_string().to_lowercase().contains("yeni"), "hata mesaji: {err}");
    assert_eq!(dst.asset_count().unwrap(), before, "hedef DEGISMEDI");
    assert!(new_id_for(&dst, r"C:\Kaynak\s.pdf").is_none());
}

// ── 10) Bos kaynak → merged=0, hata yok ─────────────────────────────────────────

#[test]
fn empty_source_merges_zero() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");
    ingest(&mut dst, r"C:\Hedef\h.pdf", "h.pdf", Some("HD"), "hedef");

    let src_path = dir.path().join("src.db");
    {
        Db::open_and_migrate(&src_path).unwrap(); // bos (asset yok)
    }

    let report = dst.merge_from(&src_path, MergeDisposition::SkipDuplicates, &[]).unwrap();
    assert_eq!(report.total_source, 0);
    assert_eq!(report.merged, 0);
    assert_eq!(report.skipped_duplicate, 0);
    assert_eq!(report.skipped_path_conflict, 0);
    assert_eq!(dst.asset_count().unwrap(), 1, "hedef degismedi");
    assert_eq!(dst.orphan_count().unwrap(), 0);
}

// ── 11) merge_preview: write-free sayimlar dogru; hedef degismez ─────────────────

#[test]
fn merge_preview_counts_are_correct_and_write_free() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");
    ingest(&mut dst, r"C:\Ortak\dosya.pdf", "dosya.pdf", Some("H_ORTAK"), "hedef"); // hash+path referansi
    let before_assets = dst.asset_count().unwrap();
    let before_ver = dst.schema_version().unwrap();

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        // 1) hash-dup (farkli yol) → duplicate
        ingest(&mut src, r"C:\Kaynak\hashdup.pdf", "hashdup.pdf", Some("H_ORTAK"), "dup");
        // 2) path-cakismasi (ayni yol) → path_collision
        ingest(&mut src, r"C:\Ortak\dosya.pdf", "dosya.pdf", Some("H_FARKLI"), "path collision");
        // 3) tamamen yeni
        ingest(&mut src, r"C:\Kaynak\yeni.pdf", "yeni.pdf", Some("H_YENI"), "yeni");
    }

    let preview = dst.merge_preview(&src_path).unwrap();
    assert_eq!(preview.total_source, 3);
    assert_eq!(preview.duplicate_count, 1, "hash-dup (path-cakismasi haric)");
    assert_eq!(preview.path_collision_count, 1);

    // Write-free: hedef hic degismedi (asset sayisi + sema).
    assert_eq!(dst.asset_count().unwrap(), before_assets);
    assert_eq!(dst.schema_version().unwrap(), before_ver);
    assert!(new_id_for(&dst, r"C:\Kaynak\yeni.pdf").is_none(), "preview yazmadi");
}

// ── 12) Yol-remap (opsiyonel): tasinan asset yollari yeni koke tasinir ───────────

#[test]
fn path_remap_applies_only_to_merged_assets() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");
    ingest(&mut dst, r"C:\Hedef\mevcut.pdf", "mevcut.pdf", Some("HD"), "hedef");

    let src_path = dir.path().join("src.db");
    {
        let mut src = Db::open_and_migrate(&src_path).unwrap();
        ingest(&mut src, r"C:\Eski\alt\x.pdf", "x.pdf", Some("HS"), "kaynak");
    }

    let remaps = vec![(r"C:\Eski".to_string(), r"D:\Yeni".to_string())];
    let report = dst.merge_from(&src_path, MergeDisposition::ImportAll, &remaps).unwrap();
    assert_eq!(report.merged, 1);

    // Tasinan asset yeni kok altinda; hedefin mevcut asset'i DOKUNULMADI.
    assert!(new_id_for(&dst, r"D:\Yeni\alt\x.pdf").is_some(), "kaynak asset remap edildi");
    assert!(new_id_for(&dst, r"C:\Eski\alt\x.pdf").is_none(), "eski yol kalmadi");
    assert!(new_id_for(&dst, r"C:\Hedef\mevcut.pdf").is_some(), "hedefin mevcut yolu korundu");
    assert_eq!(dst.orphan_count().unwrap(), 0);
}

// ── 13) Eski-sema kaynak → ileri-migrate edilip birlestirilir ────────────────────

#[test]
fn older_schema_source_is_forward_migrated_and_merged() {
    let dir = tempfile::tempdir().unwrap();
    let mut dst = open_at(dir.path(), "dst.db");
    // Once vec/pragma auto-extension kaydini garanti et (dst zaten Db actigi icin kayitli).
    let _ = dst.asset_count();

    // Kaynagi ELLE eski-sema kur: yalniz 0001..0007 migration'larini uygula (deleted_at var,
    // proje-alanlari/rag_excluded/asset_shapes/text_chunks YOK → sonraki migration'lar getirir).
    let src_path = dir.path().join("old_src.db");
    {
        let mut conn = rusqlite::Connection::open(&src_path).unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        {
            let tx = conn.transaction().unwrap();
            for m in archivist_db::MIGRATIONS.iter().filter(|m| m.version <= 7) {
                tx.execute_batch(m.sql).unwrap();
            }
            tx.execute_batch("PRAGMA user_version = 7;").unwrap();
            tx.commit().unwrap();
        }
        // Eski semada bir asset ekle (yalniz o surumde var olan kolonlar).
        conn.execute(
            "INSERT INTO assets(path,file_name,ext,size_bytes,content_hash,created_at,modified_at,indexed_at)
             VALUES ('C:\\Eski\\eski.pdf','eski.pdf','pdf',10,'HOLD',1,1,1)",
            [],
        )
        .unwrap();
    }
    // Kaynak semasi (7) canlidan (18) ESKI → reddedilmemeli, ileri-migrate edilip birlestirilmeli.
    let report = dst.merge_from(&src_path, MergeDisposition::ImportAll, &[]).unwrap();
    assert_eq!(report.merged, 1, "eski-sema asset ileri-migrate edilip geldi");
    assert!(new_id_for(&dst, r"C:\Eski\eski.pdf").is_some());
    assert_eq!(dst.orphan_count().unwrap(), 0);
    assert!(dst.integrity_ok().unwrap());
    // Kaynak dosya DEGISMEDI (in-place migrate edilmedi; kopya migrate edildi).
    let src_ver: i64 = rusqlite::Connection::open(&src_path)
        .unwrap()
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(src_ver, 7, "kaynak dosya yerinde degistirilmedi");
}

// ── 14) Sentetik 100K olcek smoke (#[ignore], release) — additive merge olcekte butun ──
//
// Persona mandati: "sentetik 100K smoke". H2 dersi: merge katmani (asset-asset kopya + ayri
// vec.db) olcekte cokuyordu. H3 tezi: tek native DB, tek TX, ATTACH+INSERT…SELECT → olcekte
// sabit bellek + butunluk. Bu test o tezi merge yolunda dogrular.
//   cargo test --release -p archivist-db --test merge -- --ignored --nocapture
//   $env:ARSIV_SMOKE_N=1000000; ...  (olcek)
#[test]
#[ignore = "100K merge olcek smoke; elle: cargo test --release -p archivist-db --test merge -- --ignored --nocapture"]
fn smoke_100k_merge_scale() {
    let n: i64 = std::env::var("ARSIV_SMOKE_N").ok().and_then(|s| s.parse().ok()).unwrap_or(100_000);
    let dir = tempfile::tempdir().unwrap();

    // Hedef: N/10 mevcut asset (bir kismi kaynakla ayni content_hash → dedup denenir).
    let dst_path = dir.path().join("dst.db");
    let src_path = dir.path().join("src.db");
    let seed = |path: &Path, start: i64, cnt: i64, hash_prefix: &str| {
        let mut conn = archivist_db::connection::open(path).unwrap();
        archivist_db::migrations::run(&mut conn).unwrap();
        let tx = conn.transaction().unwrap();
        {
            let mut ia = tx.prepare(
                "INSERT INTO assets(id,path,file_name,ext,size_bytes,content_hash,created_at,modified_at,indexed_at)
                 VALUES (?1,?2,?3,'pdf',10,?4,1,1,1)").unwrap();
            let mut iv = tx.prepare("INSERT INTO asset_vectors(asset_id,embedding) VALUES (?1,?2)").unwrap();
            let mut buf = vec![0u8; TEXT_EMBED_DIM * 4];
            for id in start..start + cnt {
                let p = format!(r"C:\{hash_prefix}\f{id}.pdf");
                let h = format!("{hash_prefix}_{}", id % (cnt.max(1)));
                ia.execute(params![id, p, format!("f{id}.pdf"), h]).unwrap();
                let hot = (id as usize) % TEXT_EMBED_DIM;
                buf.iter_mut().for_each(|b| *b = 0);
                buf[hot * 4..hot * 4 + 4].copy_from_slice(&1.0f32.to_le_bytes());
                iv.execute(params![id, buf]).unwrap();
            }
        }
        tx.commit().unwrap();
    };
    seed(&dst_path, 1, n / 10, "Hedef");
    seed(&src_path, 1, n, "Kaynak"); // farkli kok/hash uzayi → cogu yeni

    let mut dst = Db::open_and_migrate(&dst_path).unwrap();
    let before = dst.asset_count().unwrap();

    let t = Instant::now();
    let report = dst.merge_from(&src_path, MergeDisposition::SkipDuplicates, &[]).unwrap();
    let dur = t.elapsed();

    println!(
        "SMOKE merge N={n}: merged={} skipped_dup={} skipped_path={} total_src={} sure={:?}",
        report.merged, report.skipped_duplicate, report.skipped_path_conflict, report.total_source, dur
    );
    assert_eq!(report.total_source, n);
    assert_eq!(report.merged + report.skipped_duplicate + report.skipped_path_conflict, n);
    assert_eq!(dst.asset_count().unwrap(), before + report.merged);
    // Vektorlar da tasindi (her kaynak asset'in vektoru vardi).
    let vc: i64 = dst.connection().query_row("SELECT count(*) FROM asset_vectors", [], |r| r.get(0)).unwrap();
    assert_eq!(vc, before + report.merged, "her tasinan asset'in vektoru geldi");

    // Butunluk birinci sinif (Doctor cekirdegi): yetim yok + integrity ok.
    let t2 = Instant::now();
    assert_eq!(dst.orphan_count().unwrap(), 0, "olcekte yetim satir olmamali");
    assert!(dst.integrity_ok().unwrap(), "olcekte butunluk saglam");
    println!("SMOKE dogrulama (orphan+integrity) sure={:?}", t2.elapsed());
}
