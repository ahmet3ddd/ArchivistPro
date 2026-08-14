//! ② KURU KOSU ve ③ UYGULA — ortak karar cekirdegi.
//!
//! Iki mod AYNI `run_import` govdesini kosar; fark yalniz [`Sink`] uygulamasidir:
//! [`LiveSink`] gercek H3 yazicilarini cagirir, [`DrySink`] ayni "var mi" sorgularıyla
//! SIMULE eder (hicbir yazma yok) ve olusturacagi kayitlara sahte negatif id verir.
//! Boylece kuru kosu raporu ile uygula raporu yapisal olarak AYNI mantiktan dogar —
//! "kuru kosuda gordugum = uygulanan" guveni kod duzeyinde garanti edilir.
//!
//! TX modeli (bilincli): TEK mega-TX YOK — H3 yazicilari kendi TX'lerini acar
//! (`set_ai_metadata` unchecked_transaction, `add_user_tag` conn.transaction →
//! sarmalamak ic ice TX hatasi verir). Yazici-basi kucuk TX + IDEMPOTENT devam:
//! yarida kesilirse ikinci kosu kalani tamamlar; tam geri-donus pre-import yedektir
//! (komut katmani alir).

use std::collections::HashMap;

use archivist_db::import_h2::ImportAssetRow;
use archivist_db::write::ProjectMeta;
use archivist_db::Db;

use crate::h2read::{H2Asset, H2Source};
use crate::map::{decode_thumbnail, map_ai};
use crate::pathkey::{canonical_path_key, normalize_h2_path};
use crate::report::{H2ImportReport, ImportProgress};
use crate::time::parse_h2_timestamp;
use crate::H2ImportError;

/// Aktarim secenekleri (UI onay kutulari). Varsayilan: hepsi ACIK (kayipsizlik).
#[derive(Debug, Clone)]
pub struct ImportOptions {
    /// H2 copundeki kayitlar da tasinsin (H3 copunde dogarlar).
    pub include_deleted: bool,
    /// H2 inline thumbnail'lari gecici yer tutucu olarak tasinsin.
    pub include_thumbnails: bool,
}
impl Default for ImportOptions {
    fn default() -> Self {
        Self { include_deleted: true, include_thumbnails: true }
    }
}

/// ② Kuru kosu — H3'e HICBIR yazma yapmaz (DrySink; test `dry_run_writes_nothing` kilitler).
pub fn dry_run(
    h3: &Db,
    src: &H2Source,
    opts: &ImportOptions,
    drawing_types: &[&str],
    now: i64,
    progress: impl FnMut(ImportProgress),
) -> Result<H2ImportReport, H2ImportError> {
    let started = std::time::Instant::now();
    let mut sink = DrySink { db: h3, next_fake_id: -1, created: HashMap::new() };
    let mut report = run_import(&mut sink, src, opts, drawing_types, now, progress)?;
    report.dry_run = true;
    report.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(report)
}

/// ③ Uygula — gercek yazim. Cagiran (komut katmani) ONCE pre-import yedek alir.
pub fn apply(
    h3: &mut Db,
    src: &H2Source,
    opts: &ImportOptions,
    drawing_types: &[&str],
    now: i64,
    progress: impl FnMut(ImportProgress),
) -> Result<H2ImportReport, H2ImportError> {
    let started = std::time::Instant::now();
    let mut sink = LiveSink { db: h3 };
    let mut report = run_import(&mut sink, src, opts, drawing_types, now, progress)?;
    report.dry_run = false;
    report.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(report)
}

// ── Sink: iki modun tek sozlesmesi ──────────────────────────────────────────

/// Donen bool'lar "gercekten eklendi/yazildi" demektir — sayaclar bunlardan beslenir,
/// boylece IKINCI kosu (idempotency) tum sayaclari 0 dondurur.
trait Sink {
    fn probe(&self, path: &str) -> Result<Option<archivist_db::import_h2::ImportProbe>, H2ImportError>;
    fn upsert_asset(&mut self, row: &ImportAssetRow<'_>) -> Result<(i64, bool), H2ImportError>;
    fn set_ai(&mut self, id: i64, fields: &[(&str, String)]) -> Result<(), H2ImportError>;
    fn gorsel_turu(&mut self, id: i64, v: &str) -> Result<bool, H2ImportError>;
    fn thumb(&mut self, id: i64, mime: &str, w: i64, h: i64, bytes: &[u8]) -> Result<bool, H2ImportError>;
    fn tag(&mut self, id: i64, name: &str) -> Result<bool, H2ImportError>;
    fn favorite(&mut self, id: i64) -> Result<bool, H2ImportError>;
    fn project_meta(&mut self, id: i64, m: &ProjectMeta) -> Result<bool, H2ImportError>;
    fn collection(&mut self, name: &str, color: Option<&str>) -> Result<(i64, bool), H2ImportError>;
    fn collection_item(&mut self, cid: i64, id: i64) -> Result<bool, H2ImportError>;
    fn root_group(&mut self, name: &str, color: Option<&str>, now: i64) -> Result<(i64, bool), H2ImportError>;
    fn root(&mut self, path: &str, label: &str, added_at: i64) -> Result<(i64, bool), H2ImportError>;
    fn root_favorite(&mut self, id: i64) -> Result<(), H2ImportError>;
    fn root_assign_group(&mut self, id: i64, gid: i64) -> Result<(), H2ImportError>;
    fn root_tag(&mut self, id: i64, name: &str) -> Result<bool, H2ImportError>;
}

struct LiveSink<'a> {
    db: &'a mut Db,
}
impl Sink for LiveSink<'_> {
    fn probe(&self, path: &str) -> Result<Option<archivist_db::import_h2::ImportProbe>, H2ImportError> {
        Ok(self.db.import_probe(path)?)
    }
    fn upsert_asset(&mut self, row: &ImportAssetRow<'_>) -> Result<(i64, bool), H2ImportError> {
        Ok(self.db.import_h2_asset(row)?)
    }
    fn set_ai(&mut self, id: i64, fields: &[(&str, String)]) -> Result<(), H2ImportError> {
        Ok(self.db.set_ai_metadata(id, fields)?)
    }
    fn gorsel_turu(&mut self, id: i64, v: &str) -> Result<bool, H2ImportError> {
        Ok(self.db.set_ai_gorsel_turu_if_absent(id, v)?)
    }
    fn thumb(&mut self, id: i64, mime: &str, w: i64, h: i64, bytes: &[u8]) -> Result<bool, H2ImportError> {
        let t = archivist_db::write::ThumbnailInput { mime, width: w, height: h, bytes };
        Ok(self.db.import_thumbnail_if_absent(id, &t)?)
    }
    fn tag(&mut self, id: i64, name: &str) -> Result<bool, H2ImportError> {
        Ok(self.db.import_user_tag(id, name)?)
    }
    fn favorite(&mut self, id: i64) -> Result<bool, H2ImportError> {
        Ok(self.db.import_favorite(id)?)
    }
    fn project_meta(&mut self, id: i64, m: &ProjectMeta) -> Result<bool, H2ImportError> {
        Ok(self.db.import_project_meta_if_absent(id, m)?)
    }
    fn collection(&mut self, name: &str, color: Option<&str>) -> Result<(i64, bool), H2ImportError> {
        Ok(self.db.import_collection(name, color)?)
    }
    fn collection_item(&mut self, cid: i64, id: i64) -> Result<bool, H2ImportError> {
        Ok(self.db.import_collection_item(cid, id)?)
    }
    fn root_group(&mut self, name: &str, color: Option<&str>, now: i64) -> Result<(i64, bool), H2ImportError> {
        Ok(self.db.import_root_group(name, color, now)?)
    }
    fn root(&mut self, path: &str, label: &str, added_at: i64) -> Result<(i64, bool), H2ImportError> {
        Ok(self.db.add_scanned_root(path, label, added_at)?)
    }
    fn root_favorite(&mut self, id: i64) -> Result<(), H2ImportError> {
        Ok(self.db.set_root_favorite(id, true)?)
    }
    fn root_assign_group(&mut self, id: i64, gid: i64) -> Result<(), H2ImportError> {
        Ok(self.db.assign_root_group(id, Some(gid))?)
    }
    fn root_tag(&mut self, id: i64, name: &str) -> Result<bool, H2ImportError> {
        Ok(self.db.import_root_tag(id, name)?)
    }
}

/// Kuru kosu: AYNI "var mi" sorgulari + bellek-ici simulasyon. Olusturulacak kayitlara
/// SAHTE NEGATIF id verilir (gercek id'lerle catismaz) ve `created` haritasinda hatirlanir —
/// koleksiyon uyeligi gibi SONRAKI asamalarin probe'lari da onlari "var" gorsun (uygula ile
/// birebir ayni sayim; simetri testi kilitler).
struct DrySink<'a> {
    db: &'a Db,
    next_fake_id: i64,
    /// kanonik yol → bu kosuda "olusturulmus" sayilan kaydin sahte id'si.
    created: HashMap<String, i64>,
}
impl DrySink<'_> {
    fn fake_id(&mut self) -> i64 {
        let id = self.next_fake_id;
        self.next_fake_id -= 1;
        id
    }
}
impl Sink for DrySink<'_> {
    fn probe(&self, path: &str) -> Result<Option<archivist_db::import_h2::ImportProbe>, H2ImportError> {
        if let Some(p) = self.db.import_probe(path)? {
            return Ok(Some(p));
        }
        Ok(self
            .created
            .get(&canonical_path_key(path))
            .map(|&id| archivist_db::import_h2::ImportProbe { id, ..Default::default() }))
    }
    fn upsert_asset(&mut self, row: &ImportAssetRow<'_>) -> Result<(i64, bool), H2ImportError> {
        match self.db.import_probe(row.path)? {
            Some(p) => Ok((p.id, false)),
            None => {
                let id = self.fake_id();
                self.created.insert(canonical_path_key(row.path), id);
                Ok((id, true))
            }
        }
    }
    fn set_ai(&mut self, _id: i64, _fields: &[(&str, String)]) -> Result<(), H2ImportError> {
        Ok(())
    }
    fn gorsel_turu(&mut self, _id: i64, _v: &str) -> Result<bool, H2ImportError> {
        // Motor `!probe.has_gorsel_turu` on-kapisiyla cagirir → burada hep "yazilacak".
        Ok(true)
    }
    fn thumb(&mut self, _id: i64, _m: &str, _w: i64, _h: i64, _b: &[u8]) -> Result<bool, H2ImportError> {
        // Motor `!probe.has_thumb` on-kapisiyla cagirir.
        Ok(true)
    }
    fn tag(&mut self, id: i64, name: &str) -> Result<bool, H2ImportError> {
        if id < 0 {
            return Ok(true);
        }
        Ok(!self.db.asset_has_user_tag(id, name)?)
    }
    fn favorite(&mut self, id: i64) -> Result<bool, H2ImportError> {
        if id < 0 {
            return Ok(true);
        }
        Ok(!self.db.asset_is_favorite(id)?)
    }
    fn project_meta(&mut self, id: i64, _m: &ProjectMeta) -> Result<bool, H2ImportError> {
        if id < 0 {
            return Ok(true);
        }
        Ok(!self.db.asset_has_project_meta(id)?)
    }
    fn collection(&mut self, name: &str, _c: Option<&str>) -> Result<(i64, bool), H2ImportError> {
        match self.db.find_collection_id(name)? {
            Some(id) => Ok((id, false)),
            None => Ok((self.fake_id(), true)),
        }
    }
    fn collection_item(&mut self, cid: i64, id: i64) -> Result<bool, H2ImportError> {
        if cid < 0 || id < 0 {
            return Ok(true);
        }
        Ok(!self.db.collection_contains(cid, id)?)
    }
    fn root_group(&mut self, name: &str, _c: Option<&str>, _now: i64) -> Result<(i64, bool), H2ImportError> {
        match self.db.find_root_group_id(name)? {
            Some(id) => Ok((id, false)),
            None => Ok((self.fake_id(), true)),
        }
    }
    fn root(&mut self, path: &str, _label: &str, _added_at: i64) -> Result<(i64, bool), H2ImportError> {
        match self.db.find_scanned_root_id(path)? {
            Some(id) => Ok((id, false)),
            None => Ok((self.fake_id(), true)),
        }
    }
    fn root_favorite(&mut self, _id: i64) -> Result<(), H2ImportError> {
        Ok(())
    }
    fn root_assign_group(&mut self, _id: i64, _gid: i64) -> Result<(), H2ImportError> {
        Ok(())
    }
    fn root_tag(&mut self, id: i64, name: &str) -> Result<bool, H2ImportError> {
        if id < 0 {
            return Ok(true);
        }
        Ok(!self.db.root_has_tag(id, name)?)
    }
}

// ── Ortak govde ─────────────────────────────────────────────────────────────

fn run_import(
    sink: &mut dyn Sink,
    src: &H2Source,
    opts: &ImportOptions,
    drawing_types: &[&str],
    now: i64,
    mut progress: impl FnMut(ImportProgress),
) -> Result<H2ImportReport, H2ImportError> {
    let mut rep = H2ImportReport::default();

    // 1. gecis: cift-yol kazananlari (aktif > silinmis; sonra extracted_at/fs_mtime/rowid).
    let winners = src.winner_map()?;
    let asset_tags = src.asset_tags();
    let favorites: std::collections::HashSet<String> = src.favorites().into_iter().collect();
    let total = winners.len();

    // 2. gecis: satirlari akisla isle.
    let mut done = 0usize;
    src.for_each_asset(|row| {
        rep.assets_seen += 1;
        if row.id.is_empty() || row.file_path.is_empty() {
            rep.push_error("bos-kimlik", format!("rowid'siz satir atlandi: {:?}", row.file_path));
            return Ok(());
        }
        let key = canonical_path_key(&row.file_path);
        if winners.get(&key).map(|w| w != &row.id).unwrap_or(true) {
            rep.duplicate_h2_rows += 1;
            return Ok(());
        }
        if row.is_deleted && !opts.include_deleted {
            return Ok(());
        }
        if let Err(e) = import_one(sink, &row, drawing_types, opts, now, &asset_tags, &favorites, &mut rep) {
            // Satir hatasi kosuyu DURDURMAZ (kayipsizlik: kalanlar tasinir) — rapora islenir.
            rep.push_error(row.file_path.clone(), e.to_string());
        }
        done += 1;
        if done.is_multiple_of(200) {
            progress(ImportProgress { stage: "assets".into(), done, total });
        }
        Ok(())
    })?;
    progress(ImportProgress { stage: "assets".into(), done, total });

    // Kokler + gruplar + kok etiketleri.
    let groups: HashMap<String, (String, Option<String>)> =
        src.root_groups().into_iter().map(|g| (g.id, (g.name, g.color))).collect();
    let root_tags = src.root_tags();
    let roots = src.scanned_roots();
    let rtotal = roots.len();
    for (i, r) in roots.iter().enumerate() {
        let path = normalize_h2_path(&r.path);
        if path.is_empty() {
            continue;
        }
        let label = r.label.clone().unwrap_or_default();
        let added_at = r.added_at.as_deref().and_then(parse_h2_timestamp).unwrap_or(now);
        let (rid, newly) = sink.root(&path, &label, added_at)?;
        if newly {
            rep.roots_added += 1;
            // Grup/favori yalniz YENI kokte yazilir — var olan kokun kullanici duzeni ezilmez.
            if r.is_favorite {
                sink.root_favorite(rid)?;
            }
            if let Some((gname, gcolor)) = r.group_id.as_ref().and_then(|gid| groups.get(gid)) {
                let (gid, created) = sink.root_group(gname, gcolor.as_deref(), now)?;
                if created {
                    rep.groups_created += 1;
                }
                sink.root_assign_group(rid, gid)?;
            }
        } else {
            rep.roots_existing += 1;
        }
        if let Some(tags) = root_tags.get(&r.id) {
            for t in tags {
                if sink.root_tag(rid, t)? {
                    rep.root_tags_written += 1;
                }
            }
        }
        progress(ImportProgress { stage: "roots".into(), done: i + 1, total: rtotal });
    }

    // Koleksiyonlar + uyelikler (H2 asset id → H3 id eslemesi asset gecisinde toplandi mi?
    // Hayir — uyelik yolu H2 id uzerindendir; H3 id'ye ceviri icin kazanan yol anahtari →
    // probe. Uyelik sayisi kucuktur (kurasyon), satir-basi probe kabul edilebilir).
    let collections = src.collections();
    let items = src.collection_items();
    let ctotal = collections.len();
    // H2 id → kanonik yol (uyelik cevirisi icin; yalniz kazananlar).
    let mut id_to_path: HashMap<String, String> = HashMap::new();
    src.for_each_asset(|row| {
        let key = canonical_path_key(&row.file_path);
        if winners.get(&key).map(|w| w == &row.id).unwrap_or(false) {
            id_to_path.insert(row.id.clone(), normalize_h2_path(&row.file_path));
        }
        Ok(())
    })?;
    for (i, c) in collections.iter().enumerate() {
        let (cid, created) = sink.collection(&c.name, c.color.as_deref())?;
        if created {
            rep.collections_created += 1;
        }
        if let Some(aids) = items.get(&c.id) {
            for h2id in aids {
                let Some(path) = id_to_path.get(h2id) else { continue };
                let Some(p) = sink.probe(path)? else { continue };
                if sink.collection_item(cid, p.id)? {
                    rep.collection_items_written += 1;
                }
            }
        }
        progress(ImportProgress { stage: "collections".into(), done: i + 1, total: ctotal });
    }

    // Tasinamayanlar (bilgi).
    rep.users_not_migrated = src.users();
    rep.chat_sessions_not_migrated = src.count("chat_sessions").unwrap_or(0);

    Ok(rep)
}

/// Tek asset satirinin tam islemi (upsert + zenginlestirme).
#[allow(clippy::too_many_arguments)]
fn import_one(
    sink: &mut dyn Sink,
    row: &H2Asset,
    drawing_types: &[&str],
    opts: &ImportOptions,
    now: i64,
    asset_tags: &HashMap<String, Vec<String>>,
    favorites: &std::collections::HashSet<String>,
    rep: &mut H2ImportReport,
) -> Result<(), H2ImportError> {
    let path = normalize_h2_path(&row.file_path);
    let file_name = row
        .file_name
        .clone()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| path.rsplit('\\').next().unwrap_or(&path).to_string());
    let ext = std::path::Path::new(&file_name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());

    // Zaman geri-dusus zinciri: parse(ISO/`datetime`) → fs_mtime → simdi (+sayac).
    // "Deger VARDI ama parse edilemedi" durumu sayaca girer; hic deger yoksa sessiz dusulur.
    let mut unparsable = false;
    let mut resolve = |s: &Option<String>| -> Option<i64> {
        match s.as_deref() {
            None => None,
            Some(v) => match parse_h2_timestamp(v) {
                Some(t) => Some(t),
                None => {
                    unparsable = true;
                    None
                }
            },
        }
    };
    let created_at = resolve(&row.created_at).or(row.fs_mtime).unwrap_or(now);
    let modified_at = row.fs_mtime.or_else(|| resolve(&row.modified_at)).unwrap_or(created_at);
    let deleted_at =
        if row.is_deleted { Some(resolve(&row.deleted_at).unwrap_or(now)) } else { None };
    if unparsable {
        rep.unparsable_times += 1;
    }

    // Mevcut-durum sondasi TEK kez — tum kararlar bundan.
    let probe = sink.probe(&path)?;
    let (id, probe) = match probe {
        Some(p) => {
            rep.assets_existing += 1;
            if row.is_deleted && !p.deleted {
                // H3'te AKTIF duran dosyayi H2'nin copu SILEMEZ (H3 kazanir).
                rep.deleted_conflicts += 1;
            }
            (p.id, p)
        }
        None => {
            let (id, inserted) = sink.upsert_asset(&ImportAssetRow {
                path: &path,
                file_name: &file_name,
                ext: ext.as_deref(),
                size_bytes: row.file_size.unwrap_or(0),
                created_at,
                modified_at,
                deleted_at,
                h2_id: Some(&row.id),
            })?;
            debug_assert!(inserted, "probe None iken upsert insert etmeli");
            rep.assets_inserted += 1;
            if deleted_at.is_some() {
                rep.assets_deleted_carried += 1;
            }
            (id, archivist_db::import_h2::ImportProbe { id, ..Default::default() })
        }
    };

    // AI.
    if let Some(ai) = map_ai(
        row.metadata_json.as_deref(),
        row.ai_tags_json.as_deref(),
        drawing_types,
        row.extracted_at.as_deref(),
    ) {
        if ai.drawing_type_dropped {
            rep.drawing_type_dropped += 1;
        }
        if !ai.fields.is_empty() {
            if probe.has_ai {
                rep.ai_skipped_existing += 1;
            } else {
                let borrowed: Vec<(&str, String)> =
                    ai.fields.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
                sink.set_ai(id, &borrowed)?;
                rep.ai_written += 1;
            }
        } else if ai.too_thin {
            rep.ai_skipped_thin += 1;
        }
        if let Some(g) = &ai.gorsel_turu {
            if !probe.has_gorsel_turu && sink.gorsel_turu(id, g)? {
                rep.gorsel_turu_written += 1;
            }
        }
    }

    // Thumbnail (gecici yer tutucu; yalniz H3'te yokken).
    if opts.include_thumbnails && !probe.has_thumb {
        if let Some(url) = row.thumbnail_url.as_deref() {
            if url.starts_with("data:image") {
                match decode_thumbnail(url) {
                    Some((mime, w, h, bytes)) => {
                        if sink.thumb(id, &mime, w, h, &bytes)? {
                            rep.thumbnails_carried += 1;
                        }
                    }
                    None => {
                        rep.thumbnails_invalid += 1;
                    }
                }
            }
        }
    }

    // Etiketler + favori.
    if let Some(tags) = asset_tags.get(&row.id) {
        for t in tags {
            if sink.tag(id, t)? {
                rep.tags_written += 1;
            }
        }
    }
    if favorites.contains(&row.id) && sink.favorite(id)? {
        rep.favorites_written += 1;
    }

    // Proje-durum (draft-gurultusu tasinmaz; H3 dolu ise ezilmez).
    let status = row.approval_status.as_deref().filter(|s| *s != "draft").map(String::from);
    let has_meta = status.is_some()
        || row.client_name.is_some()
        || row.rejection_reason.is_some()
        || row.version_label.is_some()
        || row.deadline.is_some();
    if has_meta {
        let meta = ProjectMeta {
            client_name: row.client_name.clone(),
            approval_status: status,
            rejection_reason: row.rejection_reason.clone(),
            version_label: row.version_label.clone(),
            deadline: row.deadline.clone(),
        };
        if sink.project_meta(id, &meta)? {
            rep.project_meta_written += 1;
        } else {
            rep.project_meta_skipped_existing += 1;
        }
    }

    Ok(())
}
