//! Birlesik liste / FTS arama / fuzzy + tek-asset detay + thumbnail + klasor ozeti +
//! yol yardimcilari + koleksiyon listesi (`impl Db`). Filtre baglama tek noktada
//! (`FilterBinds` + `FILTER_FRAG`); FTS ifadesi `fts` alt-modulunden gelir.

use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};

use crate::error::DbError;
use crate::Db;

use super::fts::{build_or_query, fuzzy_terms};
use super::{
    build_match_query, clamp_page_size, escape_like_prefix, fts_query, map_asset_row,
    map_collection_row, parent_dir, AssetDetail, AssetFsMeta, AssetPage, AssignedProject,
    CollectionRef, FilterBinds,
    FolderSummary, ListOpts, MatchSource, MetaEntry, ProjectMetaOut, TagRef, ThumbnailData, AI_A,
    AI_GORSEL_TURU_EXPR, COLS, COLS_A, DOMINANT_COLORS_EXPR, FAV_A, FILTER_FRAG,
};

/// Sozluk (ARCH_SYNONYMS) fallback FTS ifadesi: sorguda domain terimi VARSA base+sinonim token'lari
/// OR'lu ONEK MATCH ("kubbe" → kubbe/dome/tonoz...); yoksa None (fallback tetiklenmez → durust
/// 0-sonuc, AND→OR körüne DÜSMEZ). Yalniz birincil arama HIC sonuc vermeyince (list_assets total 0)
/// cagrilir → tam eslesmeleri KIRLETMEZ (destani dersi: kör genisletme yalniz "hicbir sey yok"ta).
fn synonym_fallback_query(q: &str) -> Option<String> {
    let base = crate::rag::significant_tokens(q);
    if base.is_empty() {
        return None;
    }
    let expanded = crate::query_expand::expand_query_tokens(q, &base);
    if expanded.len() <= base.len() {
        return None; // sinonim tetiklenmedi → genisletme yok
    }
    let mq = build_or_query(&expanded);
    if mq.is_empty() {
        None
    } else {
        Some(mq)
    }
}

impl Db {
    /// Birlesik liste/arama (H2 pariti: facet + tam-metin birlikte calisir).
    ///
    /// `opts.query` bossa filtreli liste (sort sirali); doluysa FTS5 tam-metin
    /// (rank sirali). Her iki durumda da ext/tag/collection/favori/tarih filtreleri
    /// uygulanir. Boolean (AND/OR/NOT) + "tumce" + ( ) gruplama desteklenir; FTS5
    /// sozdizimi hatasinda guvenli (hepsi-tirnakli) sorguya zarif duser.
    pub fn list_assets(&self, opts: &ListOpts) -> Result<AssetPage, DbError> {
        let page_size = clamp_page_size(opts.page_size);
        let offset = opts.page.max(0) * page_size;
        let q = opts.query.as_deref().map(str::trim).unwrap_or("");
        if q.is_empty() {
            return self.list_filtered(opts, None, page_size, offset);
        }

        // Bulanik mod (opt-in): FTS yerine Levenshtein-yakin kelime eslesmesi.
        if opts.fuzzy {
            let terms = fuzzy_terms(q);
            if terms.is_empty() {
                return Ok(AssetPage { total: 0, items: Vec::new() });
            }
            return self.list_fuzzy(opts, &terms, page_size, offset);
        }

        // Boolean/tumce sorgusu dene; FTS5 hata verirse (or. tek operator, kapanmamis
        // parantez) hepsi-tirnakli guvenli sorguya dus → kullanici "syntax error" gormez.
        let primary = build_match_query(q);
        if primary.is_empty() {
            return self.list_filtered(opts, None, page_size, offset);
        }
        // Birincil (onek+boolean) FTS; sozdizimi hatasinda hepsi-tirnakli guvenli sorguya dus.
        let page = match self.list_filtered(opts, Some(&primary), page_size, offset) {
            Err(DbError::Sqlite(_)) => {
                let safe = fts_query(q);
                if safe.is_empty() {
                    return Ok(AssetPage { total: 0, items: Vec::new() });
                }
                self.list_filtered(opts, Some(&safe), page_size, offset)?
            }
            other => other?,
        };
        // Sozluk (ARCH_SYNONYMS) FALLBACK: birincil arama HIC sonuc vermediyse (total 0) VE sorguda
        // domain terimi tetiklendiyse, base+sinonim OR'lu onek MATCH ile bir kez daha dene. Tam
        // eslesme varken DOKUNMAZ (kör genisletme yalniz "hicbir sey bulunamadi" halinde → destani-guvenli).
        if page.total == 0 {
            if let Some(expanded) = synonym_fallback_query(q) {
                if let Ok(exp) = self.list_filtered(opts, Some(&expanded), page_size, offset) {
                    if exp.total > 0 {
                        return Ok(exp);
                    }
                }
            }
        }
        Ok(page)
    }

    /// Filtreli sayfa cek. `match_q=Some` → FTS5 JOIN + MATCH (rank sirali); `None` →
    /// duz filtreli liste (sort sirali). Filtreler `FILTER_FRAG` ile (adli param) ortak.
    fn list_filtered(
        &self,
        opts: &ListOpts,
        match_q: Option<&str>,
        page_size: i64,
        offset: i64,
    ) -> Result<AssetPage, DbError> {
        // Tum filtre baglari tek noktada (FilterBinds); referanslar fn boyu yasar.
        let binds = FilterBinds::new(opts);
        let m_str = match_q.unwrap_or(""); // fn boyu yasar → &dyn ToSql guvenli

        // FTS yolunda assets_fts JOIN + MATCH on-eki + rank + snippet ("neden"); aksi
        // halde duz + sort + NULL snippet. snippet: en iyi sutundan parca, eslesenler
        // \u{2}..\u{3} ile isaretli (frontend vurgular).
        let (from_sql, match_pred, order_sql, snippet_col) = if match_q.is_some() {
            (
                "assets_fts JOIN assets a ON a.id = assets_fts.asset_id",
                "assets_fts MATCH :match AND ",
                "rank",
                "snippet(assets_fts, -1, char(2), char(3), '…', 12)",
            )
        } else {
            ("assets a", "", opts.sort.order_by(), "NULL")
        };

        // Ortak adli parametreler (FilterBinds). :match yalniz FTS yolunda eklenir
        // (kullanilmayan adli param rusqlite'ta hata verir).
        let mut common = binds.params();
        if match_q.is_some() {
            common.push((":match", &m_str));
        }

        let total: i64 = self.conn.query_row(
            &format!("SELECT count(*) FROM {from_sql} WHERE {match_pred}{FILTER_FRAG}"),
            common.as_slice(),
            |r| r.get(0),
        )?;

        let sql = format!(
            "SELECT {COLS_A}, {FAV_A}, {snippet_col}, {AI_A}, {AI_GORSEL_TURU_EXPR}, {DOMINANT_COLORS_EXPR} FROM {from_sql}
             WHERE {match_pred}{FILTER_FRAG}
             ORDER BY {order_sql} LIMIT :limit OFFSET :offset"
        );
        let mut page_params = common;
        page_params.push((":limit", &page_size));
        page_params.push((":offset", &offset));

        let mut stmt = self.conn.prepare(&sql)?;
        let items = stmt
            .query_map(page_params.as_slice(), map_asset_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(AssetPage { total, items })
    }

    /// Bulanik (fuzzy) liste — her terim file_name veya title icinde Levenshtein-yakin
    /// bir kelimeyle eslesmeli (terimler AND). Filtreler + sort uygulanir; snippet yok
    /// (FTS degil). `fuzzy_match` UDF'si (search.rs) ile **tam-tarama** → opt-in.
    fn list_fuzzy(
        &self,
        opts: &ListOpts,
        terms: &[String],
        page_size: i64,
        offset: i64,
    ) -> Result<AssetPage, DbError> {
        let binds = FilterBinds::new(opts);

        // Her terim icin adli param (:ft0..) + kosul; tum terimler (AND).
        let keys: Vec<String> = (0..terms.len()).map(|i| format!(":ft{i}")).collect();
        let conds = keys
            .iter()
            .map(|k| {
                format!(
                    "(fuzzy_match(a.file_name, {k}) = 1 OR fuzzy_match(COALESCE(a.title,''), {k}) = 1)"
                )
            })
            .collect::<Vec<_>>()
            .join(" AND ");

        let mut common = binds.params();
        for (k, term) in keys.iter().zip(terms.iter()) {
            common.push((k.as_str(), term as &dyn rusqlite::ToSql));
        }

        let total: i64 = self.conn.query_row(
            &format!("SELECT count(*) FROM assets a WHERE {conds} AND {FILTER_FRAG}"),
            common.as_slice(),
            |r| r.get(0),
        )?;

        let sql = format!(
            "SELECT {COLS_A}, {FAV_A}, NULL, {AI_A}, {AI_GORSEL_TURU_EXPR}, {DOMINANT_COLORS_EXPR} FROM assets a
             WHERE {conds} AND {FILTER_FRAG}
             ORDER BY {} LIMIT :limit OFFSET :offset",
            opts.sort.order_by()
        );
        let mut page_params = common;
        page_params.push((":limit", &page_size));
        page_params.push((":offset", &offset));

        let mut stmt = self.conn.prepare(&sql)?;
        let items = stmt
            .query_map(page_params.as_slice(), map_asset_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(AssetPage { total, items })
    }

    /// Tek asset'in tam detayi (satir + metadata + etiketler). Yoksa `None`.
    pub fn get_asset(&self, id: i64) -> Result<Option<AssetDetail>, DbError> {
        // COLS (alias'siz) yol → ai_analyzed + ai_gorsel_turu'yu `assets.id` ile INLINE (AI_A /
        // AI_GORSEL_TURU_EXPR `a.` alias'lidir). map_asset_row 14 sutun bekler: COLS(0..9),
        // favorite(10), snippet=NULL(11), ai_analyzed(12), ai_gorsel_turu(13), renkler(14).
        //
        // NEDEN `deleted_at IS NULL`: cop'teki (soft-deleted) asset detay yolundan SIZMAMALI.
        // Liste/facet yollari zaten filtreliyor (query/facets.rs:18,38 · FILTER_FRAG); guard
        // eksik oldugu icin get_asset cop'teki satiri donduruyordu (gerileme). Cop UI'i
        // `list_trash()` kullanir, `get_asset` DEGIL → guard cop panelini kirmaz; restore/purge
        // id-tabanlidir (trash.rs), get_asset'e bagli degildir.
        let sql = format!(
            "SELECT {COLS}, EXISTS (SELECT 1 FROM favorites f WHERE f.asset_id = assets.id), NULL,
                    EXISTS (SELECT 1 FROM asset_metadata m
                            WHERE m.asset_id = assets.id AND m.key = 'ai_analyzed'),
                    (SELECT value_text FROM asset_metadata m
                            WHERE m.asset_id = assets.id AND m.key = 'ai_gorsel_turu'),
                    (SELECT value_text FROM asset_metadata m
                            WHERE m.asset_id = assets.id AND m.key = 'dominant_colors')
             FROM assets WHERE id = ?1 AND deleted_at IS NULL"
        );
        let asset = self.conn.query_row(&sql, params![id], map_asset_row).optional()?;
        let Some(asset) = asset else {
            return Ok(None);
        };

        let metadata = {
            let mut stmt = self.conn.prepare(
                "SELECT key, value_text, value_num FROM asset_metadata
                 WHERE asset_id = ?1 ORDER BY key",
            )?;
            // Geciciyi local'e bagla → stmt'ten ONCE dussun (blok-kuyruk borrow tuzagi).
            let rows = stmt
                .query_map(params![id], |r| {
                    Ok(MetaEntry { key: r.get(0)?, value_text: r.get(1)?, value_num: r.get(2)? })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        let tags = {
            let mut stmt = self.conn.prepare(
                "SELECT t.name, t.kind, t.color FROM tags t
                 JOIN asset_tags at ON at.tag_id = t.id
                 WHERE at.asset_id = ?1 ORDER BY t.kind, t.name",
            )?;
            let rows = stmt
                .query_map(params![id], |r| {
                    Ok(TagRef { name: r.get(0)?, kind: r.get(1)?, color: r.get(2)? })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        let collections = {
            let mut stmt = self.conn.prepare(
                "SELECT c.id, c.name, c.color,
                        (SELECT count(*) FROM collection_items ci2 WHERE ci2.collection_id = c.id)
                 FROM collections c
                 JOIN collection_items ci ON ci.collection_id = c.id
                 WHERE ci.asset_id = ?1 ORDER BY c.name",
            )?;
            let rows = stmt
                .query_map(params![id], map_collection_row)?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        // Proje-durum alanlari (H2 pariti) — ayri sorgu (paylasilan COLS/map_asset_row
        // sozlesmesini, dolayisiyla trash::list_trash'i etkilemez).
        let project = self.conn.query_row(
            "SELECT client_name, approval_status, rejection_reason, version_label, deadline
             FROM assets WHERE id = ?1",
            params![id],
            |r| {
                Ok(ProjectMetaOut {
                    client_name: r.get(0)?,
                    approval_status: r.get(1)?,
                    rejection_reason: r.get(2)?,
                    version_label: r.get(3)?,
                    deadline: r.get(4)?,
                })
            },
        )?;

        // Atanmis proje (entity, 0019) — client_name inheritance icin proje-duzeyi client de gelir.
        // `.optional()`: project_id NULL veya proje silinmis (FK SET NULL) → None (projesiz).
        let assigned_project = self
            .conn
            .query_row(
                "SELECT p.id, p.name, p.client_name FROM assets a
                 JOIN projects p ON p.id = a.project_id
                 WHERE a.id = ?1",
                params![id],
                |r| Ok(AssignedProject { id: r.get(0)?, name: r.get(1)?, client_name: r.get(2)? }),
            )
            .optional()?;

        // RAG manuel-disla bayragi (A1) — ayri kucuk sorgu (COLS/map_asset_row sozlesmesine dokunmaz).
        let rag_excluded: bool = self
            .conn
            .query_row("SELECT rag_excluded FROM assets WHERE id = ?1", params![id], |r| {
                r.get::<_, i64>(0)
            })?
            != 0;

        Ok(Some(AssetDetail {
            asset,
            metadata,
            tags,
            collections,
            project,
            assigned_project,
            rag_excluded,
        }))
    }

    /// Bir asset icin sorgunun **alan-atfi** (`MatchSource` listesi): sorgu hangi FTS
    /// sutunlarinda eslesti → "neden bu sonuc" (H2 `findMatchSources` pariti). Atif, arama
    /// yolunun (list_assets) kullandigi AYNI `build_match_query` ifadesiyle (FTS5 hatasinda
    /// `fts_query` guvenli geri-dususu) uretilir → gosterilen alanlar, asset'i sonuca sokan
    /// gercek eslesmeyle tutarli (yeniden yorumlama yok). Asset sorguyla eslesmiyorsa (veya
    /// sorgu bos) → bos liste. Yalniz keyword (FTS) yolunda cagrilir; semantik/gorsel modda
    /// "neden" zaten % benzerlik rozeti oldugu icin cagiran atif istemez.
    pub fn match_sources(&self, asset_id: i64, query: &str) -> Result<Vec<MatchSource>, DbError> {
        let q = query.trim();
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let primary = build_match_query(q);
        if primary.is_empty() {
            return Ok(Vec::new());
        }
        match self.match_sources_for(asset_id, &primary) {
            // FTS5 sozdizimi hatasi → arama yoluyla AYNI hepsi-tirnakli guvenli geri-dusus.
            Err(DbError::Sqlite(_)) => {
                let safe = fts_query(q);
                if safe.is_empty() {
                    Ok(Vec::new())
                } else {
                    self.match_sources_for(asset_id, &safe)
                }
            }
            other => other,
        }
    }

    /// `match_sources` ic yordami: verilen FTS MATCH ifadesiyle tek asset'in her INDEKSLI
    /// sutununda snippet uret; `\u{2}` (STX) isareti tasiyan sutun ESLESTI demektir (eslesmeyen
    /// sutunun snippet'i isaretsiz doner). Asset MATCH'i karsilamiyorsa satir hic donmez → bos.
    /// Sutun sirasi 0021 semasiyla sabit: 1=file_name, 2=title, 3=description, 4=body, 5=ai
    /// (0=asset_id UNINDEXED, atlanir). body=cikarilan dosya icerigi (file grubu), ai=vision-betim
    /// (ai grubu), digerleri asset-turevi (meta grubu).
    fn match_sources_for(
        &self,
        asset_id: i64,
        match_q: &str,
    ) -> Result<Vec<MatchSource>, DbError> {
        // (field, group) — snippet sutun sirasiyla (1..=5) hizali.
        const FIELDS: [(&str, &str); 5] = [
            ("file_name", "meta"),
            ("title", "meta"),
            ("description", "meta"),
            ("body", "file"),
            ("ai", "ai"),
        ];
        // Her indeksli sutun icin 10-token snippet; eslesenler char(2)/char(3) arasi isaretli.
        let sql = "SELECT
                snippet(assets_fts, 1, char(2), char(3), '…', 10),
                snippet(assets_fts, 2, char(2), char(3), '…', 10),
                snippet(assets_fts, 3, char(2), char(3), '…', 10),
                snippet(assets_fts, 4, char(2), char(3), '…', 10),
                snippet(assets_fts, 5, char(2), char(3), '…', 10)
             FROM assets_fts WHERE asset_id = ?1 AND assets_fts MATCH ?2";
        let cols: Option<[String; 5]> = self
            .conn
            .query_row(sql, params![asset_id, match_q], |r| {
                Ok([r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?])
            })
            .optional()?;
        let Some(cols) = cols else {
            return Ok(Vec::new());
        };
        let mut out = Vec::new();
        for (text, (field, group)) in cols.iter().zip(FIELDS.iter()) {
            // STX (char 2) YALNIZ eslesen sutunun snippet'inde bulunur → o sutun eslesti.
            if text.contains('\u{2}') {
                out.push(MatchSource {
                    field: (*field).to_string(),
                    group: (*group).to_string(),
                    snippet: text.clone(),
                });
            }
        }
        Ok(out)
    }

    /// Verilen asset id'leri icin mevcut thumbnail'lari getir (yalniz var olanlar).
    /// Batch: grid bir sayfanin tum id'lerini tek cagriyla ister.
    pub fn get_thumbnails(&self, ids: &[i64]) -> Result<Vec<ThumbnailData>, DbError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT asset_id, mime, width, height, bytes
             FROM asset_thumbnails WHERE asset_id IN ({placeholders})",
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(ids), |r| {
                Ok(ThumbnailData {
                    asset_id: r.get(0)?,
                    mime: r.get(1)?,
                    width: r.get(2)?,
                    height: r.get(3)?,
                    bytes: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Verilen id'lerden **AKTIF** (cop'te olmayan) olanlari dondur. Sira/tekillik garanti YOK.
    ///
    /// **NEDEN VAR (LAN Faz 3):** [`get_thumbnails`](Self::get_thumbnails) `asset_thumbnails`
    /// tablosunu id ile dogrudan okur — `assets` ile JOIN etmez, dolayisiyla `deleted_at`
    /// SUZGECI YOKTUR. Yerelde bu zararsizdi: grid yalnizca zaten gorunur olan id'leri ister.
    /// **Uzaktan ise istemci id UYDURABILIR** → cope atilmis bir dosyanin onizlemesi disari
    /// sizardi. LAN yolu bu yuzden id'leri ONCE buradan gecirir.
    ///
    /// (`get_asset` zaten `deleted_at IS NULL` guard'ini tasiyor — bu, thumbnail yolunun
    /// ayni guvenceyi kazanmasi icin.)
    pub fn active_asset_ids(&self, ids: &[i64]) -> Result<Vec<i64>, DbError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id FROM assets WHERE id IN ({placeholders}) AND deleted_at IS NULL",
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(ids), |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<i64>>>()?;
        Ok(rows)
    }

    /// Klasor ozetleri — asset'leri **ust-dizinine** gore grupla + say ("Klasorler"
    /// gorunumu, H2 FoldersView pariti). H3'te `scanned_roots` tablosu henuz YOK; bu yuzden
    /// klasorler `assets.path` (tam dosya yolu) satirlarindan TURETILIR.
    ///
    /// Ust-dizin TURETME: `path` satirlari akitilir (stream), her yolun son ayracina
    /// (`/` veya `\` — **ikisi de**, Windows + POSIX) kadarki on-eki ust-dizin sayilir.
    /// Sayim bir `HashMap`'te toplanir → bellek **ayri-dizin sayisiyla** sinirli (asset
    /// sayisiyla DEGIL; 100K+ asset, az dizin → sabit bellek). Ayraci olmayan yol (or.
    /// ciplak "a.txt") atlanir (ust-dizini yok).
    ///
    /// Siralama: `file_count DESC`, esitlikte `path` (deterministik). En cok ilk.
    /// **Ust sinir (cap): 1000 dizin** — UI kart listesi icin makul ust sinir; ASIRI
    /// dizin (her asset ayri klasorde) durumunda en kalabaliklarini doner, sonsuz
    /// kart uretmez.
    pub fn folder_summary(&self) -> Result<Vec<FolderSummary>, DbError> {
        /// Cikti ust siniri — bkz fn dokumantasyonu (UI kart listesi makul ust sinir).
        const CAP: usize = 1000;

        // Klasor-basi (dogrudan asset sayisi, en yeni indexed_at). `Option<i64>`'nin
        // dogal Ord'unda `None < Some(_)` → `.max()` NULL'lari yok sayip max non-null verir
        // (hepsi NULL ise None kalir), tam istenen "son indeksleme" semantigi.
        let mut counts: HashMap<String, (i64, Option<i64>)> = HashMap::new();
        {
            // §O: cop'teki asset'ler klasor sayimina girmez (`deleted_at IS NULL`).
            let mut stmt =
                self.conn.prepare("SELECT path, indexed_at FROM assets WHERE deleted_at IS NULL")?;
            let mut rows = stmt.query([])?;
            // Satir-satir ak: yalniz `path` String'i + HashMap girdisi bellekte; tum
            // asset'leri Vec'e toplamayiz (100K+ olcekte bellek-sinirli).
            while let Some(row) = rows.next()? {
                let path: String = row.get(0)?;
                let indexed_at: Option<i64> = row.get(1)?;
                if let Some(dir) = parent_dir(&path) {
                    let entry = counts.entry(dir.to_string()).or_insert((0, None));
                    entry.0 += 1;
                    entry.1 = entry.1.max(indexed_at);
                }
            }
        }

        let mut folders: Vec<FolderSummary> = counts
            .into_iter()
            .map(|(path, (file_count, last_indexed))| FolderSummary {
                path,
                file_count,
                last_indexed,
            })
            .collect();
        // file_count DESC, sonra path ASC (deterministik tie-break).
        folders.sort_by(|a, b| {
            b.file_count.cmp(&a.file_count).then_with(|| a.path.cmp(&b.path))
        });
        folders.truncate(CAP);
        Ok(folders)
    }

    /// Bir yol-on-eki altindaki AKTIF (cop'te olmayan) asset'lerin `(id, path)` listesi.
    /// **"Degistir" (replace) ingest modu** kullanir: taranan kok altinda DB'de KAYITLI olup
    /// artik DISKTE olmayan dosyalari saptamak icin (taranan kume ile fark → cope atilir).
    ///
    /// `prefix` joker (`%`/`_`/`\`) **kacisli** eslesir — `path_prefix`/`folder_summary` ile
    /// ayni `escape_like_prefix` + `ESCAPE '\'` deseni (literal alt-cizgi/yuzde dizinler
    /// yanlis eslesmez). Cagiran on-eki kok + ayrac olarak verir → kardes-on-ek karismaz.
    pub fn active_paths_under(&self, prefix: &str) -> Result<Vec<(i64, String)>, DbError> {
        let pattern = escape_like_prefix(Some(prefix)).unwrap_or_default();
        let mut stmt = self.conn.prepare(
            "SELECT id, path FROM assets
             WHERE deleted_at IS NULL AND path LIKE ?1 || '%' ESCAPE '\\'",
        )?;
        let rows = stmt
            .query_map([pattern], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// TUM aktif (`deleted_at IS NULL`) asset'in dosya-sistemi denetim meta'si — staleness
    /// (mtime/varlik) + fixity (rehash) girdisi (Doctor'un FS ayagi). `{id, path, modified_at,
    /// size_bytes, content_hash}`, **path ASC** (deterministik; fixity STRIDE ornekleme buna
    /// baglanir). On-demand rapor icin → sonuc DB'ye YAZILMAZ; 1M smoke bunu cagirmaz
    /// (agir FS I/O denetim katmaninda, sorgu yolunda degil).
    pub fn active_assets_fs_meta(&self) -> Result<Vec<AssetFsMeta>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT id, path, modified_at, size_bytes, content_hash
             FROM assets WHERE deleted_at IS NULL ORDER BY path ASC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok(AssetFsMeta {
                    id: r.get(0)?,
                    path: r.get(1)?,
                    modified_at: r.get(2)?,
                    size_bytes: r.get(3)?,
                    content_hash: r.get(4)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Verilen id'lerin AKTIF yollari (yeniden-indeks: kaynak yol → zorla re-extract). Bos dilim
    /// → bos. `params_from_iter` (her id ayri param → SQL-injection yok). Sira id artan.
    pub fn paths_for_ids(&self, ids: &[i64]) -> Result<Vec<String>, DbError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let ph = (0..ids.len()).map(|_| "?").collect::<Vec<_>>().join(",");
        let sql =
            format!("SELECT path FROM assets WHERE deleted_at IS NULL AND id IN ({ph}) ORDER BY id");
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(ids), |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Tum koleksiyonlar + uye sayilari (ada gore sirali). Kenar cubugu faceti +
    /// detay editoru datalist'i. Bos koleksiyonlar da listelenir (count=0).
    pub fn list_collections(&self) -> Result<Vec<CollectionRef>, DbError> {
        let mut stmt = self.conn.prepare(
            "SELECT c.id, c.name, c.color,
                    (SELECT count(*) FROM collection_items ci WHERE ci.collection_id = c.id)
             FROM collections c ORDER BY c.name",
        )?;
        let rows = stmt
            .query_map([], map_collection_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    }
}

#[cfg(test)]
mod tests {
    use crate::Db;

    /// `active_assets_fs_meta`: yalniz aktif (cop'te olmayan) asset'ler, path ASC, tum FS-meta
    /// alanlari (content_hash NULL → None korunur). Staleness/fixity denetiminin girdisi.
    #[test]
    fn active_assets_fs_meta_returns_active_sorted_with_optional_hash() {
        let db = Db::open_in_memory_migrated().unwrap();
        let conn = db.connection();
        // Iki aktif (biri hash'li, biri hash'siz) + bir cop'e atilmis (deleted_at dolu).
        conn.execute(
            "INSERT INTO assets(path, file_name, size_bytes, content_hash, created_at, modified_at)
             VALUES ('/z/b.txt', 'b.txt', 20, 'hashB', 1, 100)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assets(path, file_name, size_bytes, content_hash, created_at, modified_at)
             VALUES ('/a/x.txt', 'x.txt', 10, NULL, 1, 50)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO assets(path, file_name, size_bytes, content_hash, created_at, modified_at, deleted_at)
             VALUES ('/a/gone.txt', 'gone.txt', 5, 'hashG', 1, 40, 999)",
            [],
        )
        .unwrap();

        let rows = db.active_assets_fs_meta().unwrap();
        // Cop'teki '/a/gone.txt' dislanir → 2 satir.
        assert_eq!(rows.len(), 2, "yalniz aktif asset'ler");
        // path ASC: '/a/x.txt' < '/z/b.txt'.
        assert_eq!(rows[0].path, "/a/x.txt");
        assert_eq!(rows[0].size_bytes, 10);
        assert_eq!(rows[0].modified_at, 50);
        assert_eq!(rows[0].content_hash, None, "NULL content_hash → None");
        assert_eq!(rows[1].path, "/z/b.txt");
        assert_eq!(rows[1].content_hash.as_deref(), Some("hashB"));
    }

    /// `match_sources`: sorgu HANGI FTS sutununda eslesti dogru atfedilir; eslesme snippet'i
    /// STX isaretli; grup (meta/file/ai) sutuna gore; eslesmeyen/bos sorgu → bos.
    #[test]
    fn match_sources_attributes_matched_fts_columns() {
        let db = Db::open_in_memory_migrated().unwrap();
        let conn = db.connection();
        // file_name + title assets_fts'e INSERT trigger'iyla akar; body/ai'yi elle doldur
        // (ingest/vision yollarinin karsiligi — testte dogrudan).
        conn.execute(
            "INSERT INTO assets(id, path, file_name, title, size_bytes, created_at, modified_at)
             VALUES (1, '/a/villa_plan.dwg', 'villa_plan.dwg', 'Villa Projesi', 10, 1, 1)",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE assets_fts SET body = 'zemin kat mutfak salon', ai = 'bulutlu gokyuzu kubbe'
             WHERE asset_id = 1",
            [],
        )
        .unwrap();

        // 'villa' → dosya adi (ve baslik) eslesir; snippet isaretli; grup meta.
        let s = db.match_sources(1, "villa").unwrap();
        let fields: Vec<&str> = s.iter().map(|m| m.field.as_str()).collect();
        assert!(fields.contains(&"file_name"), "villa dosya adinda eslesmeli: {fields:?}");
        let fn_src = s.iter().find(|m| m.field == "file_name").unwrap();
        assert!(fn_src.snippet.contains('\u{2}'), "eslesen terim isaretli olmali");
        assert_eq!(fn_src.group, "meta");

        // 'mutfak' → yalniz body (cikarilan dosya icerigi); grup file.
        let s2 = db.match_sources(1, "mutfak").unwrap();
        let f2: Vec<&str> = s2.iter().map(|m| m.field.as_str()).collect();
        assert_eq!(f2, vec!["body"], "mutfak yalniz body'de eslesmeli: {f2:?}");
        assert_eq!(s2[0].group, "file");

        // 'kubbe' → yalniz ai (vision-betim); grup ai.
        let s3 = db.match_sources(1, "kubbe").unwrap();
        let f3: Vec<&str> = s3.iter().map(|m| m.field.as_str()).collect();
        assert_eq!(f3, vec!["ai"], "kubbe yalniz ai'de eslesmeli: {f3:?}");
        assert_eq!(s3[0].group, "ai");

        // Eslesmeyen sorgu → bos; bos/yalniz-bosluk sorgu → bos.
        assert!(db.match_sources(1, "helikopter").unwrap().is_empty());
        assert!(db.match_sources(1, "   ").unwrap().is_empty());
    }
}
