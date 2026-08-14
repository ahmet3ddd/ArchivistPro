//! Arsiv **birlestirme** (merge/join) veri katmani — bir `.archivistpro` (ham SQLite)
//! arsivinin asset'lerini CANLI arsive **EKLE** (additive; import = butun-DB REPLACE'in AKSINE).
//!
//! ## H2 dersleri (H3'e uyarlanmis)
//! - H2 motoru renderer'da asset-asset kopyalar + epoch-aware ayri vec.db + byte-snapshot
//!   rollback yapardi. **H3'te HEPSI ELENIR:** tek native DB → **tek transaction icinde
//!   ATTACH + INSERT…SELECT**; rollback = `BEGIN…COMMIT/ROLLBACK` (byte-snapshot YOK).
//!   Vektorler/chunk'lar/relations/collections AYNI TX'te tasinir → kismi-bozulma imkansiz.
//! - H2 cakismayi `id` ile bulurdu (UUID). H3'te id'ler per-DB autoincrement → **her merge
//!   asset DAIMA yeni id alir**; cakisma **content_hash** ile. Tag/collection **isimle** uzlas.
//!
//! ## Butunluk (data-migration ajani: "butunluk birinci sinif")
//! - **Okuma+yazma AYNI anda sema-aware** (H2 kismi-bozulma dersi): FTS `body`, vec0
//!   (asset/image/chunk) ve chunk_fts hepsi remap'li id ile tasinir → tasinan asset hem
//!   listede hem FTS'te hem semantik/RAG'de tutarli.
//! - **Boyuttan-bagimsiz** (H2 384*4 sahte-fail dersi): vektorler `INSERT…SELECT` ile ham
//!   blob olarak kopyalanir — boyut saglamasi YAPILMAZ (kaynak zaten gecerli); 384/512 ayrimi
//!   dogal olarak korunur.
//! - Merge SONRASI cagiran `orphan_count`/`integrity_check` ile dogrular (Doctor cekirdegi).
//!
//! ## Salt-okuma (kaynak korunur)
//! Kaynak `AS src` ATTACH edilir; TUM kaynak erisimi yalniz `SELECT`'tir (INSERT hep
//! `main.*`'a). Kaynak dosyaya asla yazilmaz. Eski-sema kaynak (`user_version` < canli) ise
//! kaynagin bir **kopyasi** ileri-migrate edilip o kopya ATTACH edilir (kaynak dosya yerinde
//! degistirilmez) → sema uyumsuzlugu "eksik kolon" hatasi vermez (H3 migration framework reuse).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::{params, OpenFlags};
use serde::{Deserialize, Serialize};

use crate::error::DbError;
use crate::Db;

/// Cakisma (ayni content_hash) durumunda ne yapilacagi.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MergeDisposition {
    /// content_hash'i hedefte AKTIF olan kaynak asset'i ATLA (yinelenen icerik gelmez).
    SkipDuplicates,
    /// Hash-dup DAHIL hepsini al (yeni id ile; iki kopya). Yalniz PATH cakismasi atlanir.
    ImportAll,
}

/// Merge onizlemesi (YAZMA YOK) — import diyalogunun gosterecegi sayimlar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    /// Kaynaktaki AKTIF (cop'te olmayan) asset sayisi.
    pub total_source: i64,
    /// content_hash'i hedefte AKTIF bir asset'le eslesen (VE path-cakismasi OLMAYAN) kaynak sayisi.
    pub duplicate_count: i64,
    /// Yolu (path UNIQUE) hedefte zaten var olan kaynak sayisi (dispozisyon ne olursa olsun atlanir).
    pub path_collision_count: i64,
}

/// Merge sonuc raporu (frontend'e doner). SkipDuplicates icin
/// `merged + skipped_duplicate + skipped_path_conflict == total_source`;
/// ImportAll icin `merged + skipped_path_conflict == total_source` (skipped_duplicate = 0).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub merged: i64,
    pub skipped_duplicate: i64,
    pub skipped_path_conflict: i64,
    pub tags_reconciled: i64,
    pub collections_reconciled: i64,
    pub total_source: i64,
}

/// Tasinacak asset satirinin TUM kolonlari (id HARIC — autoincrement, her merge yeni id verir).
/// `deleted_at` dahil (kaynak aktif satirlarinda NULL); proje-alanlari + rag_excluded + phash
/// KORUNUR (kullanici verisi). Tek dogruluk noktasi: INSERT ve SELECT ayni listeyi kullanir.
const ASSET_COLS: &str = "path, file_name, ext, size_bytes, content_hash, mime, title, description, \
     created_at, modified_at, indexed_at, phash, deleted_at, client_name, approval_status, \
     rejection_reason, version_label, deadline, rag_excluded";

/// Ileri-migrate edilen kaynak kopyalari icin benzersiz ad sayaci (process-ici).
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

impl Db {
    /// **Merge onizlemesi (YAZMA YOK).** Kaynagi ATTACH (salt-okuma) + sayimlari cikar + DETACH.
    /// Sema-versiyon bakmaz (yalniz SELECT COUNT → yazma yok); asil merge `merge_from`'da.
    pub fn merge_preview(&self, src_path: &Path) -> Result<MergePreview, DbError> {
        if self.is_self_merge(src_path) {
            return Err(DbError::Invalid(
                "onizleme yapilamaz: kaynak, canli arsivin kendisi".into(),
            ));
        }
        self.conn
            .execute("ATTACH DATABASE ?1 AS src", params![path_str(src_path)])?;
        let result = self.preview_counts();
        let _ = self.conn.execute("DETACH DATABASE src", []);
        result
    }

    fn preview_counts(&self) -> Result<MergePreview, DbError> {
        let total_source: i64 = self.conn.query_row(
            "SELECT count(*) FROM src.assets WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        let path_collision_count: i64 = self.conn.query_row(
            "SELECT count(*) FROM src.assets s
             WHERE s.deleted_at IS NULL AND s.path IN (SELECT path FROM main.assets)",
            [],
            |r| r.get(0),
        )?;
        let duplicate_count: i64 = self.conn.query_row(
            "SELECT count(*) FROM src.assets s
             WHERE s.deleted_at IS NULL
               AND s.path NOT IN (SELECT path FROM main.assets)
               AND s.content_hash IS NOT NULL
               AND s.content_hash IN (
                   SELECT content_hash FROM main.assets
                   WHERE deleted_at IS NULL AND content_hash IS NOT NULL)",
            [],
            |r| r.get(0),
        )?;
        Ok(MergePreview {
            total_source,
            duplicate_count,
            path_collision_count,
        })
    }

    /// **Merge (TEK TRANSACTION, additive).** Kaynagi ATTACH → secilen asset'leri yeni id ile
    /// tasi → iliskili tablolari (metadata/thumbnail/favori/sekil/vektor/gorsel-vektor/FTS body/
    /// chunk+vektor+fts/tag/collection/relation) remap'li tasi → (ops.) yol-remap → COMMIT.
    /// Hata → ROLLBACK (atomik; hedef import-oncesi haliyle kalir). `remaps` bos → yol-remap yok.
    pub fn merge_from(
        &mut self,
        src_path: &Path,
        disposition: MergeDisposition,
        remaps: &[(String, String)],
    ) -> Result<MergeReport, DbError> {
        // 1) Self-merge guard'i (kaynak = canli DB dosyasi) — ATTACH'tan ONCE.
        if self.is_self_merge(src_path) {
            return Err(DbError::Invalid(
                "kaynak, canli arsivin kendisi olamaz (self-merge)".into(),
            ));
        }

        // 2) Kaynak sema versiyonu (salt-okuma throwaway baglanti). Canlidan YENIYSE → Err.
        let src_ver = read_src_schema_version(src_path)?;
        let live_ver = self.schema_version()?;
        if src_ver > live_ver {
            return Err(DbError::Invalid(
                "kaynak arsiv daha yeni bir uygulama surumuyle olusturulmus; once uygulamayi guncelle"
                    .into(),
            ));
        }

        // 3) ATTACH hedefi: sema esitse kaynagin kendisi; eskiyse ileri-migrate edilmis KOPYA
        //    (kaynak dosya yerinde degistirilmez → "eksik kolon" hatasi olusmaz).
        let migrated_copy: Option<PathBuf> = if src_ver == live_ver {
            None
        } else {
            Some(forward_migrated_copy(src_path)?)
        };
        let attach_target = migrated_copy.as_deref().unwrap_or(src_path);

        // 4) ATTACH (TX disinda — ATTACH transaction icinde calismaz) → merge → DETACH (her halde).
        //    ATTACH bile basarisiz olsa migrate-kopyasi (varsa) temizlenir (temp dosya sizmasin).
        if let Err(e) = self
            .conn
            .execute("ATTACH DATABASE ?1 AS src", params![path_str(attach_target)])
        {
            if let Some(tmp) = &migrated_copy {
                cleanup_temp(tmp);
            }
            return Err(e.into());
        }
        let result = self.run_merge_tx(disposition, remaps);
        let _ = self.conn.execute("DETACH DATABASE src", []);
        if let Some(tmp) = migrated_copy {
            cleanup_temp(&tmp);
        }
        result
    }

    /// Tek transaction icinde tum tasima. Hata → TX drop → ROLLBACK (atomik).
    fn run_merge_tx(
        &mut self,
        disposition: MergeDisposition,
        remaps: &[(String, String)],
    ) -> Result<MergeReport, DbError> {
        let skip_dup = matches!(disposition, MergeDisposition::SkipDuplicates);
        let tx = self.conn.transaction()?;

        // Onceki iptal-olmus merge'den kalan gecici tablolari temizle (savunma).
        tx.execute_batch(
            "DROP TABLE IF EXISTS _pre_paths;
             DROP TABLE IF EXISTS _pre_hashes;
             DROP TABLE IF EXISTS _merge_map;",
        )?;

        // Hedefin ONCEKI durumunun anlik-goruntuleri (secim yuklemi INSERT sonrasi da KARARLI
        // kalsin diye canli main yerine bu snapshot'lara bakilir — aksi halde yeni eklenen
        // yollar/hash'ler yuklemi kaydirir). Indeksli → 100K'da NOT IN/IN hizli.
        tx.execute_batch(
            "CREATE TEMP TABLE _pre_paths AS SELECT path FROM main.assets;
             CREATE INDEX _pre_paths_ix ON _pre_paths(path);
             CREATE TEMP TABLE _pre_hashes AS
                 SELECT content_hash FROM main.assets
                 WHERE deleted_at IS NULL AND content_hash IS NOT NULL;
             CREATE INDEX _pre_hashes_ix ON _pre_hashes(content_hash);
             CREATE TEMP TABLE _merge_map(src_id INTEGER PRIMARY KEY, new_id INTEGER);",
        )?;

        // Secim yuklemi (kaynak `src.assets s`): aktif + path-cakismasi HARIC (+ SkipDup: hash-dup HARIC).
        let sel = selection_predicate(skip_dup);

        // ── Sayimlar (INSERT'ten ONCE; snapshot'lar sabit) ──
        let total_source: i64 = tx.query_row(
            "SELECT count(*) FROM src.assets WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )?;
        let skipped_path_conflict: i64 = tx.query_row(
            "SELECT count(*) FROM src.assets s
             WHERE s.deleted_at IS NULL AND s.path IN (SELECT path FROM _pre_paths)",
            [],
            |r| r.get(0),
        )?;
        let skipped_duplicate: i64 = if skip_dup {
            tx.query_row(
                "SELECT count(*) FROM src.assets s
                 WHERE s.deleted_at IS NULL
                   AND s.path NOT IN (SELECT path FROM _pre_paths)
                   AND s.content_hash IS NOT NULL
                   AND s.content_hash IN (SELECT content_hash FROM _pre_hashes)",
                [],
                |r| r.get(0),
            )?
        } else {
            0
        };

        // ── asset satirlari (yeni id) + src_id→new_id haritasi ──
        let merged = tx.execute(
            &format!(
                "INSERT INTO main.assets ({ASSET_COLS})
                 SELECT {ASSET_COLS} FROM src.assets s WHERE {sel}"
            ),
            [],
        )? as i64;

        // Harita: yeni eklenen main satiri ile kaynagi PATH (UNIQUE) uzerinden esle. Secilen
        // satirlarin yolu hedefte YOKTU (path-cakismasi harici) → INSERT sonrasi birebir eslesir.
        tx.execute(
            &format!(
                "INSERT INTO _merge_map(src_id, new_id)
                 SELECT s.id, m.id FROM src.assets s
                 JOIN main.assets m ON m.path = s.path
                 WHERE {sel}"
            ),
            [],
        )?;

        // ── iliskili tablolar: INSERT…SELECT + _merge_map remap (yalniz tasinan asset'ler) ──
        move_related(&tx)?;
        let tags_reconciled = reconcile_tags(&tx)?;
        let collections_reconciled = reconcile_collections(&tx)?;
        move_relations(&tx)?;

        // ── (ops.) yol-remap: yalniz YENI gelen asset'lere uygula ──
        apply_remaps(&tx, remaps)?;

        // Gecici tablolar COMMIT'e sizmasin (baglanti uzun-omurlu).
        tx.execute_batch(
            "DROP TABLE _pre_paths; DROP TABLE _pre_hashes; DROP TABLE _merge_map;",
        )?;
        tx.commit()?;

        Ok(MergeReport {
            merged,
            skipped_duplicate,
            skipped_path_conflict,
            tags_reconciled,
            collections_reconciled,
            total_source,
        })
    }

    /// Kaynak dosya, canli DB dosyasinin KENDISI mi? (`PRAGMA database_list` + kanonik yol kiyasi).
    fn is_self_merge(&self, src_path: &Path) -> bool {
        let Some(main) = self.main_db_file() else {
            return false; // bellek-ici (dosyasiz) main → self-merge imkansiz
        };
        match (Path::new(&main).canonicalize(), src_path.canonicalize()) {
            (Ok(a), Ok(b)) => a == b,
            _ => false,
        }
    }

    /// `main` semasinin dosya yolu (`PRAGMA database_list`); bellek-ici ise `None`.
    fn main_db_file(&self) -> Option<String> {
        let mut stmt = self.conn.prepare("PRAGMA database_list").ok()?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(1)?, r.get::<_, String>(2)?)))
            .ok()?;
        for row in rows.flatten() {
            if row.0 == "main" {
                return if row.1.is_empty() { None } else { Some(row.1) };
            }
        }
        None
    }
}

/// Secilecek kaynak asset yuklemi (alias `s` = `src.assets`; snapshot tablolarina bakar → KARARLI).
fn selection_predicate(skip_dup: bool) -> String {
    let mut p = String::from(
        "s.deleted_at IS NULL AND s.path NOT IN (SELECT path FROM _pre_paths)",
    );
    if skip_dup {
        p.push_str(
            " AND NOT (s.content_hash IS NOT NULL
                       AND s.content_hash IN (SELECT content_hash FROM _pre_hashes))",
        );
    }
    p
}

/// asset-duzeyi iliskili tablolar (1:1 / 1:N) + FTS body + vektorler + chunk'lar. Hepsi
/// `_merge_map` ile YENI id'ye baglanir. vec0 tablolari (asset_vectors/asset_image_region_vectors/
/// chunk_vectors) `INSERT…SELECT` ile ATTACH uzerinden ham blob kopyalanir (probe ile dogrulandi;
/// boyut saglamasi YOK → 384/512 dogal korunur). Gorsel BOLGE tablosu PK-kodlamali → id, kaynak
/// asset'ten (`id/STRIDE`) YENI asset'e remap edilir; region (`id%STRIDE`) KORUNUR. FTS body:
/// trigger'in olusturdugu bos satir silinip kaynagin tam FTS satiri (remap id) yazilir → aranabilir.
fn move_related(tx: &rusqlite::Transaction) -> Result<(), DbError> {
    tx.execute(
        "INSERT INTO main.asset_metadata(asset_id, key, value_text, value_num)
         SELECT mm.new_id, m.key, m.value_text, m.value_num
         FROM src.asset_metadata m JOIN _merge_map mm ON mm.src_id = m.asset_id",
        [],
    )?;
    tx.execute(
        "INSERT INTO main.asset_thumbnails(asset_id, mime, width, height, bytes)
         SELECT mm.new_id, t.mime, t.width, t.height, t.bytes
         FROM src.asset_thumbnails t JOIN _merge_map mm ON mm.src_id = t.asset_id",
        [],
    )?;
    tx.execute(
        "INSERT INTO main.favorites(asset_id, created_at)
         SELECT mm.new_id, f.created_at
         FROM src.favorites f JOIN _merge_map mm ON mm.src_id = f.asset_id",
        [],
    )?;
    tx.execute(
        "INSERT INTO main.asset_shapes(
             asset_id, entity_type, layer_name, layer_category, vertex_count, is_closed,
             area, perimeter, aspect_ratio, regularity, compactness, solidity,
             rectangularity, bbox_w, bbox_h, centroid_x, centroid_y)
         SELECT mm.new_id, s.entity_type, s.layer_name, s.layer_category, s.vertex_count, s.is_closed,
             s.area, s.perimeter, s.aspect_ratio, s.regularity, s.compactness, s.solidity,
             s.rectangularity, s.bbox_w, s.bbox_h, s.centroid_x, s.centroid_y
         FROM src.asset_shapes s JOIN _merge_map mm ON mm.src_id = s.asset_id",
        [],
    )?;

    // Vektorler (vec0) — ham blob, boyut-bagimsiz.
    tx.execute(
        "INSERT INTO main.asset_vectors(asset_id, embedding)
         SELECT mm.new_id, v.embedding
         FROM src.asset_vectors v JOIN _merge_map mm ON mm.src_id = v.asset_id",
        [],
    )?;
    // Gorsel BOLGE vektorleri (PK-kodlamali id = asset_id*STRIDE + region). Kaynak asset'i
    // `v.id / STRIDE` ile turet → _merge_map ile YENI asset'e coz → yeni id = new_id*STRIDE +
    // (v.id % STRIDE) (region KORUNUR). Ham blob (boyut-bagimsiz; migration 0022 halefi).
    let stride = crate::image::IMAGE_REGION_STRIDE;
    tx.execute(
        &format!(
            "INSERT INTO main.asset_image_region_vectors(id, embedding)
             SELECT mm.new_id * {stride} + (v.id % {stride}), v.embedding
             FROM src.asset_image_region_vectors v
             JOIN _merge_map mm ON mm.src_id = v.id / {stride}"
        ),
        [],
    )?;

    // FTS body: assets INSERT trigger'i (assets_fts_ai) her yeni asset icin body='' satir olusturdu.
    // Onu silip kaynagin TAM FTS satirini (remap id) yaz → body + tokenler aranabilir.
    tx.execute(
        "DELETE FROM main.assets_fts WHERE asset_id IN (SELECT new_id FROM _merge_map)",
        [],
    )?;
    // `ai` (migration 0021; AI vision-betim kolonu) da tasinir → merge edilen analizli gorsel
    // ana-kutu FTS'te aranabilir kalir (kaynak+hedef ayni sema: merge guard eski src'yi ileri
    // migrate eder → `sf.ai` mevcut). Bu olmadan merge betmi sessizce kaybederdi.
    tx.execute(
        "INSERT INTO main.assets_fts(asset_id, file_name, title, description, body, ai)
         SELECT mm.new_id, sf.file_name, sf.title, sf.description, sf.body, sf.ai
         FROM src.assets_fts sf JOIN _merge_map mm ON mm.src_id = sf.asset_id",
        [],
    )?;

    // text_chunks (bulk remap) → chunk_vectors ((new_asset_id, chunk_index) eslesme) → chunk_fts
    // (yeni eklenen text_chunks'tan yeniden uret). Yeni asset'lerin onceden chunk'i YOKTU →
    // yeni id altindaki her chunk bize aittir (kapsam net).
    tx.execute(
        "INSERT INTO main.text_chunks(asset_id, chunk_index, page, text, lang)
         SELECT mm.new_id, c.chunk_index, c.page, c.text, c.lang
         FROM src.text_chunks c JOIN _merge_map mm ON mm.src_id = c.asset_id",
        [],
    )?;
    tx.execute(
        "INSERT INTO main.chunk_vectors(chunk_id, embedding)
         SELECT mtc.id, cv.embedding
         FROM src.chunk_vectors cv
         JOIN src.text_chunks stc ON stc.id = cv.chunk_id
         JOIN _merge_map mm ON mm.src_id = stc.asset_id
         JOIN main.text_chunks mtc ON mtc.asset_id = mm.new_id AND mtc.chunk_index = stc.chunk_index",
        [],
    )?;
    tx.execute(
        "INSERT INTO main.chunk_fts(chunk_id, asset_id, text)
         SELECT tc.id, tc.asset_id, tc.text
         FROM main.text_chunks tc WHERE tc.asset_id IN (SELECT new_id FROM _merge_map)",
        [],
    )?;
    Ok(())
}

/// Tag'leri ISIMLE uzlastir: kaynak tag'leri hedefte yoksa olustur (INSERT OR IGNORE, name UNIQUE),
/// sonra asset_tags'i hedef tag id'siyle (name join) + remap id ile tasi. Donus: tasinan asset'lere
/// bagli AYRI tag adedi (eslesen + olusan).
fn reconcile_tags(tx: &rusqlite::Transaction) -> Result<i64, DbError> {
    tx.execute(
        "INSERT OR IGNORE INTO main.tags(name, kind, color) SELECT name, kind, color FROM src.tags",
        [],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO main.asset_tags(asset_id, tag_id)
         SELECT mm.new_id, mt.id
         FROM src.asset_tags sat
         JOIN _merge_map mm ON mm.src_id = sat.asset_id
         JOIN src.tags st ON st.id = sat.tag_id
         JOIN main.tags mt ON mt.name = st.name",
        [],
    )?;
    let n: i64 = tx.query_row(
        "SELECT count(DISTINCT st.name)
         FROM src.asset_tags sat
         JOIN _merge_map mm ON mm.src_id = sat.asset_id
         JOIN src.tags st ON st.id = sat.tag_id",
        [],
        |r| r.get(0),
    )?;
    Ok(n)
}

/// Koleksiyonlari ISIMLE uzlastir (tags deseni) → collection_items remap. Donus: tasinan asset'lerin
/// uye oldugu AYRI koleksiyon adedi.
fn reconcile_collections(tx: &rusqlite::Transaction) -> Result<i64, DbError> {
    tx.execute(
        "INSERT OR IGNORE INTO main.collections(name, color, created_at)
         SELECT name, color, created_at FROM src.collections",
        [],
    )?;
    tx.execute(
        "INSERT OR IGNORE INTO main.collection_items(collection_id, asset_id, added_at)
         SELECT mc.id, mm.new_id, sci.added_at
         FROM src.collection_items sci
         JOIN _merge_map mm ON mm.src_id = sci.asset_id
         JOIN src.collections sc ON sc.id = sci.collection_id
         JOIN main.collections mc ON mc.name = sc.name",
        [],
    )?;
    let n: i64 = tx.query_row(
        "SELECT count(DISTINCT sc.name)
         FROM src.collection_items sci
         JOIN _merge_map mm ON mm.src_id = sci.asset_id
         JOIN src.collections sc ON sc.id = sci.collection_id",
        [],
        |r| r.get(0),
    )?;
    Ok(n)
}

/// relations: yalniz **her iki** ucu da tasinan (INNER JOIN → tek-tarafli otomatik ATLAnir) satirlar;
/// kind korunur; UNIQUE(src,dst,kind) cakismasi INSERT OR IGNORE.
fn move_relations(tx: &rusqlite::Transaction) -> Result<(), DbError> {
    tx.execute(
        "INSERT OR IGNORE INTO main.relations(src_id, dst_id, kind)
         SELECT ms.new_id, md.new_id, r.kind
         FROM src.relations r
         JOIN _merge_map ms ON ms.src_id = r.src_id
         JOIN _merge_map md ON md.src_id = r.dst_id",
        [],
    )?;
    Ok(())
}

/// Yol-remap (opsiyonel): `old`→`new` on-eki ile baslayan YENI gelen asset yollarini yeni koke tasi.
/// `new` bos → o kural atlanir (dosyalar yerinde). `portable::remap_paths` ile ayni escape/`substr`
/// mantigi, ama YALNIZ tasinan id'lere (`_merge_map`) sinirli. UNIQUE ihlali → hata → ROLLBACK.
fn apply_remaps(tx: &rusqlite::Transaction, remaps: &[(String, String)]) -> Result<(), DbError> {
    for (old, new) in remaps {
        if new.is_empty() {
            continue;
        }
        let old_len = old.chars().count() as i64;
        let pat = format!(
            "{}%",
            crate::query::escape_like_prefix(Some(old)).unwrap_or_default()
        );
        tx.execute(
            "UPDATE main.assets SET path = ?1 || substr(path, ?2 + 1)
             WHERE id IN (SELECT new_id FROM _merge_map)
               AND path LIKE ?3 ESCAPE '\\'",
            params![new, old_len, pat],
        )?;
    }
    Ok(())
}

/// ATTACH icin yol metni (bound parametre → tirnak/kacis derdi yok; `\`/UNC guvenli).
fn path_str(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

/// Kaynagin sema versiyonunu SALT-OKUMA bir throwaway baglanti ile oku + gecerlilik dogrula
/// (assets tablosu var mi). Kaynak dosyaya YAZILMAZ (READ_ONLY flag).
fn read_src_schema_version(path: &Path) -> Result<i64, DbError> {
    let conn = rusqlite::Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let has_assets: i64 = conn.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='assets'",
        [],
        |r| r.get(0),
    )?;
    if has_assets == 0 {
        return Err(DbError::Invalid(
            "gecersiz kaynak arsiv (assets tablosu yok — .archivistpro degil)".into(),
        ));
    }
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

/// Eski-sema kaynagi ileri-migrate et: kaynagin SALT-OKUMA bir kopyasini (online backup API,
/// WAL/vec0-guvenli) gecici dosyaya al → o kopyayi `open_and_migrate` ile canli semaya tasi →
/// yolunu dondur. **Kaynak dosya yerinde degistirilmez** (kopya migrate edilir). Migration
/// framework reuse → 0009 (vec boyut) gibi adimlar guvenle uygulanir (eski kaynakta vektor bos).
fn forward_migrated_copy(src: &Path) -> Result<PathBuf, DbError> {
    let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = std::env::temp_dir().join(format!("arsiv-merge-{}-{}.db", std::process::id(), seq));
    {
        let ro = rusqlite::Connection::open_with_flags(src, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        ro.backup(rusqlite::DatabaseName::Main, &tmp, None)?;
    }
    // Kopyayi canli semaya tasi (vec/pragma kaydi + tum bekleyen migration). Donen baglanti
    // dusurulur (dosya kapanir) → ATTACH temiz.
    crate::open_and_migrate(&tmp)?;
    Ok(tmp)
}

/// Gecici migrate-kopyasini + yan-dosyalarini (-wal/-shm/-journal) sil (best-effort).
fn cleanup_temp(tmp: &Path) {
    let _ = std::fs::remove_file(tmp);
    let base = tmp.to_string_lossy();
    for suffix in ["-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(PathBuf::from(format!("{base}{suffix}")));
    }
}
