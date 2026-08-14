use std::collections::{HashMap, HashSet};

use crate::error::DbError;
use crate::Db;

/// Aynı-kök (same-stem) OTO-tespit raporu — `detect_same_stem_relations`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DetectRelationsReport {
    /// Aynı-kök + ≥2 farklı uzantılı aday grup sayısı.
    pub groups: usize,
    /// Yeni oluşturulan `derived` iliski sayısı (mevcut/manuel ciftler atlanir).
    pub created: usize,
}

/// Versiyon grubu uyesi: (id, dosya_adi_kucuk, ACIK-isaretli mi). `detect_version_relations`.
type VersionMember = (i64, String, bool);

/// Bir kok altindaki (kaynak-adaylari [(id, oncelik)], sidecar id'leri). `detect_backup_relations`.
type StemSources = (Vec<(i64, u8)>, Vec<i64>);

impl Db {
    /// Aktif + TANINAN-icerik-uzantili (`is_content_ext` allowlist) asset'ler: (id, file_name,
    /// ext_kucuk). İliski OTO-tespitinin ortak girdisi — sidecar/kilit/log/render-cache elenir.
    fn active_content_assets(&self) -> Result<Vec<(i64, String, String)>, DbError> {
        let rows: Vec<(i64, String, Option<String>)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id, file_name, ext FROM assets WHERE deleted_at IS NULL")?;
            let v = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, Option<String>>(2)?)))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            v
        };
        Ok(rows
            .into_iter()
            .filter_map(|(id, name, ext)| {
                let e = ext.unwrap_or_default().to_lowercase();
                is_content_ext(&e).then_some((id, name, e))
            })
            .collect())
    }

    /// Ortak insert: yildiz gruplarini (`(hub, [digerleri])`) tek TX'te `kind` ile bagla. Mevcut
    /// (herhangi yon/kind) cift ATLANIR → idempotent, manuel baglari EZMEZ. `groups.len()` aday grup.
    fn link_star_groups(
        &self,
        kind: &str,
        groups: &[(i64, Vec<i64>)],
    ) -> Result<DetectRelationsReport, DbError> {
        let mut existing: HashSet<(i64, i64)> = {
            let mut stmt = self.conn.prepare("SELECT src_id, dst_id FROM relations")?;
            let pairs = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
                .collect::<rusqlite::Result<Vec<(i64, i64)>>>()?;
            pairs.into_iter().map(|(a, b)| if a <= b { (a, b) } else { (b, a) }).collect()
        };
        let tx = self.conn.unchecked_transaction()?;
        let mut report = DetectRelationsReport { groups: groups.len(), created: 0 };
        for (hub, others) in groups {
            for other in others {
                let pair = if hub <= other { (*hub, *other) } else { (*other, *hub) };
                if !existing.insert(pair) {
                    continue; // zaten var (manuel/onceki tur) → ezme
                }
                if tx.execute(
                    "INSERT OR IGNORE INTO relations (src_id, dst_id, kind) VALUES (?1, ?2, ?3)",
                    rusqlite::params![hub, other, kind],
                )? > 0
                {
                    report.created += 1;
                }
            }
        }
        tx.commit()?;
        Ok(report)
    }

    /// Aynı köke sahip AKTIF asset'leri OTO-iliskilendir (`derived` — CAPRAZ-FORMAT: plan.dwg ↔
    /// plan.pdf ↔ plan.jpg). Yalnız ≥2 FARKLI uzantılı gruplar; ayni-uzanti uyeler (belirsiz:
    /// versiyon/kopya) cross-link EDILMEZ. Grup HUB'i kaynak-oncelikli uzanti (CAD/3D) → farkli-
    /// uzantili uyeler. Gurultu suzgeci: allowlist (`active_content_assets`) + sayisal-kok + >10-uye
    /// (gercek-arsiv 2026-07-07). İstek-uzeri admin; ingest'i degistirmez; idempotent.
    pub fn detect_same_stem_relations(&self) -> Result<DetectRelationsReport, DbError> {
        let assets = self.active_content_assets()?;
        let mut groups: HashMap<String, Vec<(i64, String)>> = HashMap::new();
        for (id, file_name, ext_lc) in &assets {
            let stem = stem_of(file_name, ext_lc).to_lowercase();
            if !stem.is_empty() {
                groups.entry(stem).or_default().push((*id, ext_lc.clone()));
            }
        }
        let mut star: Vec<(i64, Vec<i64>)> = Vec::new();
        for (stem, members) in &groups {
            if members.len() < 2 || members.len() > MAX_GROUP_MEMBERS {
                continue; // tek uye VEYA cok-uyeli (toplu-cikti gurultusu)
            }
            if stem.chars().all(|c| c.is_ascii_digit()) {
                continue; // sayisal kok (render karesi / genel ad)
            }
            if members.iter().map(|(_, e)| e.as_str()).collect::<HashSet<_>>().len() < 2 {
                continue; // ayni-uzanti grubu → belirsiz (derived degil)
            }
            // Hub: kaynak-oncelikli uzanti, esitlikte en kucuk id (kararli).
            let hub = members
                .iter()
                .min_by_key(|(id, ext)| (source_priority(ext), *id))
                .expect("bos-olmayan grup");
            let (hub_id, hub_ext) = (hub.0, hub.1.as_str());
            let others: Vec<i64> = members
                .iter()
                .filter(|(oid, oext)| *oid != hub_id && oext != hub_ext) // ayni-uzanti degil
                .map(|(oid, _)| *oid)
                .collect();
            if !others.is_empty() {
                star.push((hub_id, others));
            }
        }
        self.link_star_groups("derived", &star)
    }

    /// AYNI-FORMAT versiyon/revizyon/kopya zincirlerini OTO-iliskilendir (`version` — plan.dwg ↔
    /// plan_v2.dwg ↔ plan-rev3.dwg). Yalnız ACIK son-ek isaretleri (`_v2` · `-rev` · `_r3` · `- Kopya`;
    /// `(N)` Windows-kopya DAHIL DEGIL → gercek-arsivde web-dup gurultusu, 2026-07-07). Grup =
    /// (isaretsiz taban, AYNI uzanti); ≥1 ISARETLI uye + tum-adlar-farkli (ayni-ad tekrari = DUP,
    /// versiyon degil) + sayisal-taban/>10-uye suzgeci. HUB = isaretsiz "orijinal" (yoksa en kucuk
    /// id). İstek-uzeri admin; idempotent, manuel baglari ezmez.
    pub fn detect_version_relations(&self) -> Result<DetectRelationsReport, DbError> {
        let assets = self.active_content_assets()?;
        // (taban_kucuk, ext) → [(id, ad_kucuk, isaretli?)]
        let mut groups: HashMap<(String, String), Vec<VersionMember>> = HashMap::new();
        for (id, file_name, ext_lc) in &assets {
            let stem = stem_of(file_name, ext_lc);
            let (base, marked) = strip_version(&stem);
            if base.is_empty() {
                continue;
            }
            groups
                .entry((base.to_lowercase(), ext_lc.clone()))
                .or_default()
                .push((*id, file_name.to_lowercase(), marked));
        }
        let mut star: Vec<(i64, Vec<i64>)> = Vec::new();
        for ((base, _ext), members) in &groups {
            if members.len() < 2 || members.len() > MAX_GROUP_MEMBERS {
                continue;
            }
            if base.chars().all(|c| c.is_ascii_digit()) {
                continue; // sayisal taban
            }
            if !members.iter().any(|(_, _, m)| *m) {
                continue; // en az bir ACIK isaret yoksa versiyon degil (ayni-ad dup vb.)
            }
            let names: HashSet<&str> = members.iter().map(|(_, n, _)| n.as_str()).collect();
            if names.len() != members.len() {
                continue; // ayni-ad tekrari (farkli klasor) = DUP → dedup isi, versiyon degil
            }
            // Hub: isaretsiz "orijinal" varsa (marked=false once), yoksa en kucuk id.
            let hub_id = members
                .iter()
                .min_by_key(|(id, _, marked)| (*marked, *id))
                .map(|(id, _, _)| *id)
                .expect("bos-olmayan grup");
            let others: Vec<i64> =
                members.iter().filter(|(id, _, _)| *id != hub_id).map(|(id, _, _)| *id).collect();
            if !others.is_empty() {
                star.push((hub_id, others));
            }
        }
        self.link_star_groups("version", &star)
    }

    /// Yedek/kilit/otokayit SIDECAR dosyalarini (.bak/.dwl/.dwl2/.sv$) ayni-kok KAYNAK icerik
    /// dosyasina bagla (`backup` kind — kaynak=src, sidecar=dst). H2 §B "BAK kaynak-tespiti" pariti:
    /// `plan.dwl`/`plan.bak` → `plan.dwg`. Sidecar'lar content-DISI (allowlist'te yok) → AYRI pass.
    /// Kaynak yoksa yetim sidecar bagsiz kalir. HUB = en "kaynak" content dosyasi. İstek-uzeri admin;
    /// idempotent (link_star_groups; mevcut/manuel cift atlanir).
    pub fn detect_backup_relations(&self) -> Result<DetectRelationsReport, DbError> {
        let all: Vec<(i64, String, String)> = {
            let mut stmt = self
                .conn
                .prepare("SELECT id, file_name, ext FROM assets WHERE deleted_at IS NULL")?;
            let v = stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?.unwrap_or_default().to_lowercase(),
                    ))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?;
            v
        };
        // Kök → (kaynak-adaylari [(id, oncelik)], sidecar id'leri).
        let mut map: HashMap<String, StemSources> = HashMap::new();
        for (id, name, ext) in &all {
            let stem = stem_of(name, ext).to_lowercase();
            if stem.is_empty() {
                continue;
            }
            let entry = map.entry(stem).or_default();
            if is_sidecar_ext(ext) {
                entry.1.push(*id);
            } else if is_content_ext(ext) {
                entry.0.push((*id, source_priority(ext)));
            }
        }
        let mut star: Vec<(i64, Vec<i64>)> = Vec::new();
        for (sources, sidecars) in map.values() {
            if sidecars.is_empty() || sources.is_empty() {
                continue; // sidecar yok VEYA kaynak yok (yetim sidecar baglanmaz)
            }
            let hub = sources
                .iter()
                .min_by_key(|(id, p)| (*p, *id))
                .map(|(id, _)| *id)
                .expect("bos-olmayan kaynak");
            star.push((hub, sidecars.clone()));
        }
        self.link_star_groups("backup", &star)
    }
}

/// Dosya adindan KOK: son `.<ext>` soneki (case-insensitive) dusurulur; ext bilinmiyor/eslesmiyorsa
/// son nokta oncesi (yoksa tum ad). Cagiran ayrica kucuk-harfe cevirir (kok gruplama).
fn stem_of(file_name: &str, ext_lc: &str) -> String {
    if !ext_lc.is_empty() && file_name.len() > ext_lc.len() + 1 {
        let (head, tail) = file_name.split_at(file_name.len() - (ext_lc.len() + 1));
        if let Some(dot_ext) = tail.strip_prefix('.') {
            if dot_ext.eq_ignore_ascii_case(ext_lc) {
                return head.to_string();
            }
        }
    }
    match file_name.rfind('.') {
        Some(i) if i > 0 => file_name[..i].to_string(),
        _ => file_name.to_string(),
    }
}

/// Bir grupta izin verilen azami uye — daha buyugu toplu-cikti gurultusudur (atlanir).
const MAX_GROUP_MEMBERS: usize = 10;

/// İliski ucu olabilecek TANINAN icerik uzantilari (ALLOWLIST). Sidecar/kilit/log/render-cache
/// (dwl · vrmap/vrlmap · log · status · bak · tmp...) bilerek DISARIDA → gurultu yerine anlamli
/// baglar. Denylist "whack-a-mole" olurdu (her render motoru yeni sidecar uretir). Gercek-arsiv
/// dogrulamasi (2026-07-07, 2077 asset): naif ~207 aday → allowlist 18 TEMIZ bag. Kucuk-harf ext.
fn is_content_ext(ext: &str) -> bool {
    matches!(
        ext,
        // CAD / 3D kaynak
        "dwg" | "dxf" | "dwf" | "max" | "skp" | "rvt" | "ifc" | "3ds" | "obj" | "fbx" | "stl"
            | "step" | "stp" | "igs" | "iges" | "dgn"
        // tasarim
            | "psd" | "ai" | "indd" | "eps" | "cdr"
        // raster
            | "jpg" | "jpeg" | "png" | "bmp" | "gif" | "webp" | "tiff" | "tif" | "tga" | "exr" | "hdr"
        // vektor / cikti
            | "pdf" | "wmf" | "emf" | "svg"
        // office
            | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "odt" | "ods" | "odp"
        // video
            | "mp4" | "avi" | "mkv" | "webm" | "mov" | "flv"
        // metin
            | "txt" | "csv" | "rtf" | "md"
    )
}

/// Kaynak-uzanti onceligi (kucuk = daha "kaynak"/orijinal → HUB adayi). CAD/3D once; tasarim
/// sonra; digerleri (pdf/jpg/png...) turetilmis sayilir.
fn source_priority(ext: &str) -> u8 {
    match ext {
        "dwg" | "dxf" | "dwf" | "max" | "skp" | "rvt" | "ifc" | "3ds" | "obj" | "fbx" | "stl"
        | "step" | "stp" | "igs" | "iges" | "dgn" => 0,
        "psd" | "ai" | "indd" | "cdr" => 1,
        _ => 2,
    }
}

/// Yedek/kilit/otokayit SIDECAR uzantisi mi (content DEGIL; `detect_backup_relations` hedefi).
/// AutoCAD ailesi: bak(yedek) · dwl/dwl2/dwl3(kilit) · sv$/$sv(otokayit).
fn is_sidecar_ext(ext: &str) -> bool {
    matches!(ext, "bak" | "dwl" | "dwl2" | "dwl3" | "sv$" | "$sv")
}

/// Stem sonundaki ACIK versiyon/revizyon/kopya isaretini soy → (taban, isaretli?). Isaret yoksa
/// (stem, false). Ayirici (bosluk/_/-) ZORUNLU; `(N)` Windows-kopya DAHIL DEGIL (web-dup gurultusu).
/// Regex'siz (H2 manual-parser deseni). Or. "plan-rev2"→("plan",true) · "plan"→("plan",false).
fn strip_version(stem: &str) -> (String, bool) {
    let is_sep = |c: char| c == ' ' || c == '_' || c == '-';
    if let Some(pos) = stem.rfind(is_sep) {
        let last = &stem[pos + 1..];
        let base = stem[..pos].trim_end_matches(is_sep);
        if !base.is_empty() && is_version_token(last) {
            return (base.to_string(), true);
        }
    }
    (stem.to_string(), false)
}

/// "Son parca" ACIK versiyon isareti mi? `v\d+` | `r\d+` | `rev`(+ops. `.`/rakam) | `kopya`/`copy`
/// (+ops. rakam). Buyuk/kucuk duyarsiz. (`rev` once denenir — `r`+rakam ile karismasin.)
fn is_version_token(tok: &str) -> bool {
    let t = tok.to_ascii_lowercase();
    for w in ["kopya", "copy"] {
        if let Some(rest) = t.strip_prefix(w) {
            if rest.chars().all(|c| c.is_ascii_digit()) {
                return true; // kopya · copy · copy2
            }
        }
    }
    if let Some(rest) = t.strip_prefix("rev") {
        let rest = rest.strip_prefix('.').unwrap_or(rest);
        if rest.chars().all(|c| c.is_ascii_digit()) {
            return true; // rev · rev2 · rev.3
        }
    }
    for p in ['v', 'r'] {
        if let Some(rest) = t.strip_prefix(p) {
            if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
                return true; // v2 · r3
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    /// Kok'e gore seed (ext dogru — detect `ext` kolonunu kullanir).
    fn seed_ext(db: &Db, id: i64, name: &str, ext: &str) {
        db.connection()
            .execute(
                "INSERT INTO assets(id, path, file_name, ext, size_bytes, created_at, modified_at)
                 VALUES (?1, ?2, ?3, ?4, 10, 1, 1)",
                params![id, format!("/a/{id}-{name}"), name, ext],
            )
            .unwrap();
    }

    #[test]
    fn detect_links_same_stem_cross_ext_star_from_source_and_idempotent() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed_ext(&db, 1, "plan.pdf", "pdf");
        seed_ext(&db, 2, "PLAN.dwg", "dwg"); // farkli-buyuk/kucuk kok → ayni grup ("plan")
        seed_ext(&db, 3, "plan.jpg", "jpg");
        seed_ext(&db, 4, "solo.txt", "txt"); // tek uye → aday degil

        let rep = db.detect_same_stem_relations().unwrap();
        assert_eq!(rep.groups, 1, "yalniz 'plan' grubu (solo tek uye)");
        assert_eq!(rep.created, 2, "hub(dwg) → pdf + jpg");

        // HUB = dwg (kaynak-oncelik); iki `derived` GIDEN (dwg → pdf, dwg → jpg).
        let r = db.relations_for(2).unwrap();
        assert_eq!(r.len(), 2);
        assert!(r.iter().all(|x| x.kind == "derived" && x.outgoing));
        let others: HashSet<i64> = r.iter().map(|x| x.other_id).collect();
        assert_eq!(others, HashSet::from([1, 3]));

        // Idempotent: yeniden calistir → yeni yok.
        let rep2 = db.detect_same_stem_relations().unwrap();
        assert_eq!(rep2.created, 0);
        assert_eq!(rep2.groups, 1);
    }

    #[test]
    fn detect_skips_same_ext_trashed_and_existing_manual() {
        let db = Db::open_in_memory_migrated().unwrap();
        // "rapor" grubu: dwg + pdf aktif, jpg COP'te; ayrica dwg-pdf MANUEL "version" bagli.
        seed_ext(&db, 1, "rapor.dwg", "dwg");
        seed_ext(&db, 2, "rapor.pdf", "pdf");
        seed_ext(&db, 3, "rapor.jpg", "jpg");
        db.connection().execute("UPDATE assets SET deleted_at = 1 WHERE id = 3", []).unwrap();
        db.add_relation(1, 2, "version").unwrap(); // manuel bag → derived EKLENMEZ
        // "kroki" grubu: iki AYNI uzanti (dwg) → belirsiz, cross-link yok, grup SAYILMAZ.
        seed_ext(&db, 4, "kroki.dwg", "dwg");
        seed_ext(&db, 5, "kroki.dwg", "dwg");
        // "villa" grubu: temiz farkli-uzanti → 1 derived olusur (pozitif kontrol).
        seed_ext(&db, 6, "villa.dxf", "dxf");
        seed_ext(&db, 7, "villa.png", "png");

        let rep = db.detect_same_stem_relations().unwrap();
        // rapor (jpg cop dislandi → dwg+pdf) SAYILIR ama manuel bag → created 0; villa +1.
        assert_eq!(rep.groups, 2, "rapor + villa (kroki ayni-uzanti → sayilmaz)");
        assert_eq!(rep.created, 1, "yalniz villa(dxf→png); rapor manuel bag nedeniyle atlanir");

        // rapor: hala yalniz manuel "version" (derived eklenmedi).
        let r1 = db.relations_for(1).unwrap();
        assert_eq!(r1.len(), 1);
        assert_eq!(r1[0].kind, "version");
        // villa: dxf(6) → png(7) derived.
        let r6 = db.relations_for(6).unwrap();
        assert_eq!(r6.len(), 1);
        assert_eq!(r6[0].kind, "derived");
        assert_eq!(r6[0].other_id, 7);
    }

    #[test]
    fn detect_noise_filters_allowlist_numeric_stem_and_group_cap() {
        let db = Db::open_in_memory_migrated().unwrap();
        // (a) ALLOWLIST: plan.dwg (content) + plan.dwl (kilit) + plan.log (log) → yalniz dwg
        //     content sayilir → grup tek-uye → aday DEGIL.
        seed_ext(&db, 1, "plan.dwg", "dwg");
        seed_ext(&db, 2, "plan.dwl", "dwl");
        seed_ext(&db, 3, "plan.log", "log");
        // (b) SAYISAL KOK: 1.tga + 1.png (ikisi content, farkli uzanti) ama kok "1" → atla.
        seed_ext(&db, 4, "1.tga", "tga");
        seed_ext(&db, 5, "1.png", "png");
        // (c) BOYUT TAVANI: "seri" koku altinda 11 farkli-content-uzantili dosya (>10) → atla.
        for (i, ext) in ["dwg", "dxf", "pdf", "jpg", "png", "bmp", "tga", "tif", "gif", "webp", "svg"]
            .iter()
            .enumerate()
        {
            seed_ext(&db, 100 + i as i64, &format!("seri.{ext}"), ext);
        }

        let rep = db.detect_same_stem_relations().unwrap();
        assert_eq!(rep.groups, 0, "hepsi gurultu suzgecine takilir");
        assert_eq!(rep.created, 0);
        assert!(db.relations_for(1).unwrap().is_empty());
        assert!(db.relations_for(4).unwrap().is_empty());
    }

    #[test]
    fn detect_version_links_marked_chain_from_original_and_idempotent() {
        let db = Db::open_in_memory_migrated().unwrap();
        // orijinal + rev + rev2 (ayni ext) → 'version' zincir; HUB = isaretsiz orijinal.
        seed_ext(&db, 1, "proje.dwg", "dwg");
        seed_ext(&db, 2, "proje-rev.dwg", "dwg");
        seed_ext(&db, 3, "proje-rev2.dwg", "dwg");
        seed_ext(&db, 4, "proje-final.dwg", "dwg"); // "final" isaret DEGIL → ayri taban, katilmaz

        let rep = db.detect_version_relations().unwrap();
        assert_eq!(rep.groups, 1);
        assert_eq!(rep.created, 2, "orijinal(1) → rev(2) + rev2(3)");
        // HUB = orijinal (isaretsiz, id 1) → iki GIDEN 'version'.
        let r1 = db.relations_for(1).unwrap();
        assert_eq!(r1.len(), 2);
        assert!(r1.iter().all(|x| x.kind == "version" && x.outgoing));
        // proje-final iliskisiz.
        assert!(db.relations_for(4).unwrap().is_empty());
        // idempotent.
        assert_eq!(db.detect_version_relations().unwrap().created, 0);
    }

    #[test]
    fn detect_version_needs_marker_skips_dup_names_and_cross_ext() {
        let db = Db::open_in_memory_migrated().unwrap();
        // (a) ayni-ad tekrari (farkli klasor), ISARETSIZ → DUP degil versiyon.
        seed_ext(&db, 1, "logo.png", "png");
        seed_ext(&db, 2, "logo.png", "png");
        // (b) isaret var ama eslesecek taban yok (tek uye).
        seed_ext(&db, 3, "yalniz-v2.dwg", "dwg");
        // (c) capraz-ext: ayni isaretli ad farkli uzantida → AYNI version grubuna girmez
        //     (bunlar 'derived'; version ayni-ext ister).
        seed_ext(&db, 4, "plan-v1.dwg", "dwg");
        seed_ext(&db, 5, "plan-v1.pdf", "pdf");

        let rep = db.detect_version_relations().unwrap();
        assert_eq!(rep.groups, 0);
        assert_eq!(rep.created, 0);
    }

    #[test]
    fn detect_backup_links_sidecars_to_source_orphan_skipped_idempotent() {
        let db = Db::open_in_memory_migrated().unwrap();
        seed_ext(&db, 1, "plan.dwg", "dwg"); // KAYNAK
        seed_ext(&db, 2, "plan.dwl", "dwl"); // kilit
        seed_ext(&db, 3, "plan.dwl2", "dwl2"); // kilit2
        seed_ext(&db, 4, "plan.bak", "bak"); // yedek
        seed_ext(&db, 5, "yetim.dwl", "dwl"); // KAYNAKSIZ sidecar → baglanmaz

        let rep = db.detect_backup_relations().unwrap();
        assert_eq!(rep.created, 3, "plan.dwg → dwl + dwl2 + bak");
        // HUB = kaynak (dwg, id 1) → uc GIDEN 'derived'.
        let r1 = db.relations_for(1).unwrap();
        assert_eq!(r1.len(), 3);
        assert!(r1.iter().all(|x| x.kind == "backup" && x.outgoing));
        assert!(db.relations_for(5).unwrap().is_empty()); // yetim kilit bagsiz
        assert_eq!(db.detect_backup_relations().unwrap().created, 0); // idempotent
    }
}
