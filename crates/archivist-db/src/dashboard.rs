//! Faz 7.3 "Dashboard" gorunumu veri katmani — arsiv ozet istatistikleri + basit grafik
//! verileri (H2 DashboardView pariti). Renderer TOPLAMA YAPMAZ; DB tek sorgu kumesinde
//! toplar, renderer yalniz hazir sayilari cizer (ARCHITECTURE: "Rust veriyi sahiplenir").
//!
//! `ext_facets` (query.rs) ile ayni `Facet` tipi yeniden kullanilir (IPC tutarliligi).

use rusqlite::params;
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};

use crate::error::DbError;
use crate::query::{escape_like_prefix, Facet};
use crate::Db;

/// Bir ay kovasi — "YYYY-MM" + o aydaki asset sayisi (zaman serisi grafigi).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MonthCount {
    /// Ay etiketi "YYYY-MM" (strftime cikisi; her zaman 7 karakter).
    pub month: String,
    pub count: i64,
}

/// Bir uzanti + o uzantinin TOPLAM boyutu (bayt). Format-bazli boyut karti (H2 sizeByFormat
/// pariti — donut). `ext_counts`'tan AYRI: siralama boyuta gore (en buyuk ilk), ust sinir 8.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ExtSize {
    /// Uzanti (`None` = uzantisiz asset'ler).
    pub value: Option<String>,
    /// Bu uzantidaki asset'lerin toplam boyutu (bayt).
    pub size: i64,
}

/// Dashboard ozet istatistikleri — tek sorgu kumesiyle toplanir (renderer toplamaz).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DashboardStats {
    /// Toplam asset sayisi (COUNT(*)).
    pub total_assets: i64,
    /// Toplam boyut (bayt; COALESCE(SUM(size_bytes),0) — bos DB'de 0).
    pub total_size: i64,
    /// En cok bulunan uzantilar (count azalan, en cok ~12). `ext_facets` aynasi.
    pub ext_counts: Vec<Facet>,
    /// Format-bazli boyut (toplam bayt azalan, en cok 8) — H2 sizeByFormat karti (donut).
    pub size_by_ext: Vec<ExtSize>,
    /// Son 12 takvim ayinin asset sayilari (artan, ay'a gore). Bkz fn dokumantasyonu
    /// — SADECE verisi olan aylar dondurulur (sifir-doldurma YOK).
    pub month_counts: Vec<MonthCount>,
    /// Onay-durumuna gore asset sayilari. Yalniz atanmış durumlar; kuyruk once
    /// "review", sonra diger kanonik durumlarla siralanir.
    pub approval_counts: Vec<Facet>,
    /// Bir projeye ATANMIS (project_id NOT NULL) aktif asset'lerdeki BENZERSIZ proje sayisi
    /// (H2 `activeProjects` = kullanilan proje sayisi). Projesiz asset'ler sayilmaz.
    pub active_projects: i64,
    /// Metni CIKARILMIS aktif asset sayisi (`assets_fts.body <> ''`) — icerikten aranabilir olanlar.
    /// H2 `isIndexed` sayacinin H3-anlamli karsiligi; recall gorunurlugu (kac dosya icerikle aranabilir).
    /// Frontend bunu `total_assets` ile "N / M" olarak gosterir.
    pub indexed_assets: i64,
    /// Vision analizinden gelen kanonik mimari stiller (asset sayisi azalan, en cok 8).
    pub architectural_styles: Vec<Facet>,
    /// Vision analizinden gelen kanonik malzemeler (asset sayisi azalan, en cok 8).
    pub material_groups: Vec<Facet>,
}

/// Son N gunun audit_log aktivite ozeti (H2 AdminActivityPanel pariti). DB toplar (H2 renderer'da
/// topluyordu — H3 mimarisi: SQL GROUP BY). Admin-gate KOMUT katmaninda (`dashboard_activity`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ActivitySummary {
    /// Penceredeki toplam islem sayisi.
    pub total_ops: i64,
    /// En aktif kullanicilar (islem sayisi azalan, en cok 5) — `username` (audit snapshot'i).
    pub top_users: Vec<ActivityCount>,
    /// En cok yapilan islem turleri (azalan, en cok 6) — `action` anahtari.
    pub top_actions: Vec<ActivityCount>,
}

/// Aktivite ozeti girdisi — ad (kullanici adi / islem anahtari) + sayi.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ActivityCount {
    pub name: String,
    pub count: i64,
}

/// Dashboard `ext_counts` ust siniri — kart/grafikte makul sayida uzanti gosterilir;
/// kuyruk ("digerleri") UI'da toplanabilir. `ext_facets` (limitsiz) ile ayni siralama.
const EXT_LIMIT: i64 = 12;
/// Format-bazli boyut karti ust siniri (H2 donut top-8).
const SIZE_EXT_LIMIT: i64 = 8;
/// Aktivite ozeti: en aktif kullanici / islem turu ust sinirlari (H2 pariti: 5 / 6).
const ACTIVITY_TOP_USERS: i64 = 5;
const ACTIVITY_TOP_ACTIONS: i64 = 6;
const AI_FACET_LIMIT: usize = 8;

impl Db {
    /// Arsiv ozet istatistikleri (Dashboard). Tek cagri → toplam sayi/boyut + uzanti
    /// dagilimi + son 12 ayin zaman serisi. Renderer yalniz cizer (DB toplar).
    ///
    /// `month_counts` PENCERESI: "son 12 takvim ayi" = icinde bulunulan ay + onceki 11
    /// ay. Alt sinir SQLite ile turetilir: `date('now','start of month','-11 months')`
    /// → bu ayin 11 ay oncesinin 1'i (gece yarisi, yerel-olmayan/UTC). `modified_at`
    /// (unix saniye) bu sinirdan buyuk-esitse sayilir. `strftime('%Y-%m', …,'unixepoch')`
    /// ile ay'a grupla, ARTAN sirala. **Sifir-doldurma YOK** — yalniz verisi olan aylar
    /// doner (bos aylar atlanir); frontend istenirse aradaki bosluklari kendi doldurur.
    /// Bu, SQL'i saf tutar ve "now"a bagli sentetik satir uretmez.
    ///
    /// `path_prefix` (klasor-kapsamli pano): `Some` verildiginde TUM sayimlar/istatistikler
    /// yalniz o yol-onekiyle baslayan asset'lere daraltilir — `list_assets`'in `path_prefix`
    /// filtresiyle AYNI escape (`escape_like_prefix`) + `LIKE … ESCAPE '\'` deseni (joker
    /// karakterler literal eslesir, injection yok: deger PARAMETRE olarak baglanir). `None` →
    /// global (geriye-uyumlu; mevcut davranis). Alt-dizinler on-ek eslesmesiyle dahildir.
    pub fn dashboard_stats(&self, path_prefix: Option<&str>) -> Result<DashboardStats, DbError> {
        // list_assets ile ayni escape; None → filtre yok (global). SQL parcasi prefix varsa
        // `AND path LIKE :prefix || '%' ESCAPE '\'`, yoksa bos. `:prefix` her sorguda ayni.
        let prefix = escape_like_prefix(path_prefix);
        let path_filter =
            if prefix.is_some() { " AND path LIKE :prefix || '%' ESCAPE '\\'" } else { "" };

        // 1. Toplam sayi + boyut — tek satir (bos DB'de 0/0).
        //    §O: cop'teki asset'ler dashboard sayim/boyutuna girmez (deleted_at IS NULL).
        let total_sql = format!(
            "SELECT count(*), COALESCE(SUM(size_bytes), 0) FROM assets
             WHERE deleted_at IS NULL{path_filter}"
        );
        let mut total_params: Vec<(&str, &dyn rusqlite::ToSql)> = Vec::new();
        if let Some(p) = &prefix {
            total_params.push((":prefix", p));
        }
        let (total_assets, total_size): (i64, i64) =
            self.conn.query_row(&total_sql, total_params.as_slice(), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?;

        // 2. Uzanti dagilimi — `ext_facets` aynasi, ust sinirli (en cok EXT_LIMIT).
        //    Geciciyi local'e bagla → stmt'ten ONCE dussun (blok-kuyruk borrow tuzagi,
        //    bkz query.rs get_asset).
        let ext_limit: i64 = EXT_LIMIT;
        let ext_sql = format!(
            "SELECT ext, count(*) FROM assets
             WHERE deleted_at IS NULL{path_filter}
             GROUP BY ext ORDER BY count(*) DESC, ext LIMIT :ext_limit"
        );
        let ext_counts = {
            let mut stmt = self.conn.prepare(&ext_sql)?;
            let mut ext_params: Vec<(&str, &dyn rusqlite::ToSql)> = vec![(":ext_limit", &ext_limit)];
            if let Some(p) = &prefix {
                ext_params.push((":prefix", p));
            }
            let rows = stmt
                .query_map(ext_params.as_slice(), |r| {
                    Ok(Facet { value: r.get(0)?, count: r.get(1)? })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        // 3. Son 12 takvim ayinin zaman serisi (artan). Alt sinir SQLite tarafinda
        //    turetilir → "now"a bagli deger Rust'a sizmaz, tek parametre (:prefix, varsa).
        let month_sql = format!(
            "SELECT strftime('%Y-%m', modified_at, 'unixepoch') AS m, count(*)
             FROM assets
             WHERE deleted_at IS NULL{path_filter}
               AND modified_at >= strftime('%s', date('now','start of month','-11 months'))
             GROUP BY m
             ORDER BY m ASC"
        );
        let month_counts = {
            let mut stmt = self.conn.prepare(&month_sql)?;
            let mut month_params: Vec<(&str, &dyn rusqlite::ToSql)> = Vec::new();
            if let Some(p) = &prefix {
                month_params.push((":prefix", p));
            }
            let rows = stmt
                .query_map(month_params.as_slice(), |r| {
                    Ok(MonthCount { month: r.get(0)?, count: r.get(1)? })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        // 4. Onay kuyrugu ozeti. Onay durumu NULL olan asset'ler bilincli olarak
        // disaridadir: bunlar bir kuyruk asamasina henuz alinmamistir. Siralama
        // operatorun once "incelemede" isleri gormesini saglar; beklenmeyen eski
        // degerler yine gorunur kalir ve en sona duser.
        let approval_sql = format!(
            "SELECT approval_status, count(*) FROM assets
             WHERE deleted_at IS NULL
               AND approval_status IS NOT NULL{path_filter}
             GROUP BY approval_status
             ORDER BY CASE approval_status
                WHEN 'review' THEN 0
                WHEN 'draft' THEN 1
                WHEN 'rejected' THEN 2
                WHEN 'approved' THEN 3
                ELSE 4
             END, approval_status"
        );
        let approval_counts = {
            let mut stmt = self.conn.prepare(&approval_sql)?;
            let mut approval_params: Vec<(&str, &dyn rusqlite::ToSql)> = Vec::new();
            if let Some(p) = &prefix {
                approval_params.push((":prefix", p));
            }
            let rows = stmt
                .query_map(approval_params.as_slice(), |r| {
                    Ok(Facet {
                        value: r.get(0)?,
                        count: r.get(1)?,
                    })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        // 5. Format-bazli boyut (H2 sizeByFormat donut) — toplam bayt azalan, en cok 8. ext_counts'tan
        //    AYRI sorgu: farkli siralama (boyut) + limit. §O: cop haric (deleted_at IS NULL).
        let size_ext_limit: i64 = SIZE_EXT_LIMIT;
        let size_sql = format!(
            "SELECT ext, COALESCE(SUM(size_bytes), 0) AS s FROM assets
             WHERE deleted_at IS NULL{path_filter}
             GROUP BY ext ORDER BY s DESC, ext LIMIT :size_ext_limit"
        );
        let size_by_ext = {
            let mut stmt = self.conn.prepare(&size_sql)?;
            let mut size_params: Vec<(&str, &dyn rusqlite::ToSql)> =
                vec![(":size_ext_limit", &size_ext_limit)];
            if let Some(p) = &prefix {
                size_params.push((":prefix", p));
            }
            let rows = stmt
                .query_map(size_params.as_slice(), |r| {
                    Ok(ExtSize { value: r.get(0)?, size: r.get(1)? })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };

        // 6. Aktif proje sayisi (H2 activeProjects) — bir projeye ATANMIS (project_id NOT NULL) aktif
        //    asset'lerdeki BENZERSIZ proje sayisi. Projesiz asset'ler sayilmaz.
        let active_sql = format!(
            "SELECT count(DISTINCT project_id) FROM assets
             WHERE deleted_at IS NULL AND project_id IS NOT NULL{path_filter}"
        );
        let mut active_params: Vec<(&str, &dyn rusqlite::ToSql)> = Vec::new();
        if let Some(p) = &prefix {
            active_params.push((":prefix", p));
        }
        let active_projects: i64 =
            self.conn.query_row(&active_sql, active_params.as_slice(), |r| r.get(0))?;

        // 7. Metni CIKARILMIS asset sayisi (`assets_fts.body <> ''`) — icerikten aranabilir olanlar
        //    (recall gorunurlugu). `path` uzantisiz (yalniz assets'te var → JOIN'de tekil). ⚠️ 1M
        //    olcekte body taramasi maliyetli olabilir ama Pano on-demand (her-kare degil) → kabul.
        let indexed_sql = format!(
            "SELECT count(*) FROM assets a JOIN assets_fts f ON f.asset_id = a.id
             WHERE a.deleted_at IS NULL AND f.body <> ''{path_filter}"
        );
        let mut indexed_params: Vec<(&str, &dyn rusqlite::ToSql)> = Vec::new();
        if let Some(p) = &prefix {
            indexed_params.push((":prefix", p));
        }
        let indexed_assets: i64 =
            self.conn.query_row(&indexed_sql, indexed_params.as_slice(), |r| r.get(0))?;

        let architectural_styles =
            self.dashboard_metadata_list_facets("ai_mimari_stiller", path_prefix, AI_FACET_LIMIT)?;
        let material_groups =
            self.dashboard_metadata_list_facets("ai_malzemeler", path_prefix, AI_FACET_LIMIT)?;

        Ok(DashboardStats {
            total_assets,
            total_size,
            ext_counts,
            size_by_ext,
            month_counts,
            approval_counts,
            active_projects,
            indexed_assets,
            architectural_styles,
            material_groups,
        })
    }

    /// Virgulle saklanan kanonik AI metadata listesini asset sayisina gore toplar.
    /// Ayni asset'te yinelenen token yalniz bir kez sayilir. Toplama DB katmaninda kalir;
    /// renderer hazir `Facet` listesini cizer.
    fn dashboard_metadata_list_facets(
        &self,
        key: &str,
        path_prefix: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Facet>, DbError> {
        let prefix = escape_like_prefix(path_prefix);
        let path_filter =
            if prefix.is_some() { " AND a.path LIKE :prefix || '%' ESCAPE '\\'" } else { "" };
        let sql = format!(
            "SELECT m.asset_id, m.value_text
             FROM asset_metadata m
             JOIN assets a ON a.id = m.asset_id
             WHERE m.key = :key AND m.value_text IS NOT NULL
               AND a.deleted_at IS NULL{path_filter}"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let mut query_params: Vec<(&str, &dyn rusqlite::ToSql)> = vec![(":key", &key)];
        if let Some(p) = &prefix {
            query_params.push((":prefix", p));
        }
        let rows = stmt.query_map(query_params.as_slice(), |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
        })?.collect::<rusqlite::Result<Vec<_>>>()?;

        let mut counts: BTreeMap<String, i64> = BTreeMap::new();
        for (_, value) in rows {
            let mut per_asset = HashSet::new();
            for token in value.split(',').map(str::trim).filter(|v| !v.is_empty()) {
                if per_asset.insert(token.to_owned()) {
                    *counts.entry(token.to_owned()).or_default() += 1;
                }
            }
        }
        let mut facets: Vec<Facet> = counts.into_iter()
            .map(|(value, count)| Facet { value: Some(value), count })
            .collect();
        facets.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.value.cmp(&b.value)));
        facets.truncate(limit);
        Ok(facets)
    }

    /// Son `days` gunun audit_log aktivite ozeti (H2 AdminActivityPanel pariti): toplam islem +
    /// en aktif kullanicilar (5) + en cok islem turleri (6). **DB toplar** (H2 renderer'da 500 kayit
    /// cekip JS'te grupluyordu → H3 SQL GROUP BY, milyon-kayit-guvenli). Pencere alt-siniri SQLite
    /// tarafinda turetilir (`strftime('%s','now', :cutoff)` + baglanan `-N days` modifier'i → "now"a
    /// bagli deger Rust'a sizmaz). Admin-gate KOMUT katmanindadir (audit arsiv-genelidir, path-kapsamsiz).
    pub fn activity_summary(&self, days: i64) -> Result<ActivitySummary, DbError> {
        // `-N days` SQLite modifier'i (deger baglanir → injection yok; days negatifse 0'a kelepcele).
        let cutoff_modifier = format!("-{} days", days.max(0));
        // strftime('%s',…) METIN doner → CAST INTEGER (aksi halde i64 okuma tip hatasi verir).
        let cutoff: i64 = self.conn.query_row(
            "SELECT CAST(strftime('%s','now',?1) AS INTEGER)",
            params![cutoff_modifier],
            |r| r.get(0),
        )?;

        let total_ops: i64 = self.conn.query_row(
            "SELECT count(*) FROM audit_log WHERE ts >= ?1",
            params![cutoff],
            |r| r.get(0),
        )?;

        let top = |group_col: &str, limit: i64| -> Result<Vec<ActivityCount>, DbError> {
            let sql = format!(
                "SELECT {group_col} AS name, count(*) AS c FROM audit_log
                 WHERE ts >= ?1 GROUP BY {group_col} ORDER BY c DESC, name LIMIT ?2"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params![cutoff, limit], |r| {
                    Ok(ActivityCount { name: r.get(0)?, count: r.get(1)? })
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            Ok(rows)
        };
        // `group_col` sabit-string (kullanici girdisi DEGIL) → injection yok.
        let top_users = top("username", ACTIVITY_TOP_USERS)?;
        let top_actions = top("action", ACTIVITY_TOP_ACTIONS)?;

        Ok(ActivitySummary { total_ops, top_users, top_actions })
    }
}
