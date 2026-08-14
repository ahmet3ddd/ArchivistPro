//! H2 arsiv DB'lerinin KESFI — aday listesi.
//!
//! Neden var (olculdu, bu makinede): H2'nin arsiv kayit defteri DB'de DEGIL,
//! `%APPDATA%\com.archivistpro.desktop\archivist_config.json` dosyasindadir ve
//! `db_path` yonlendirmesi ana arsivi BAMBASKA bir diske tasiyabilir (or.
//! `D:\DENEME_arşiv\archivist.db`, 19 MB). Yalniz AppData klasorunu tarayan eski
//! tespit bu gercek DB'leri GORMUYORDU. Aday listesi iki kaynagin birlesimidir:
//! config yollari (main/local/extra) ∪ AppData klasor taramasi; kanonik yol
//! anahtariyla tekillestirilir (config kazanir — etiketi daha anlamlidir).

use std::path::Path;

use serde::Serialize;

use crate::pathkey::canonical_path_key;
use crate::H2ImportError;

/// `archivist_config.json`'un okudugumuz alt-kumesi. Alanlar tolerant/opsiyonel:
/// bozuk ya da eksik config KESIF hatasi degildir (tespit, on kosul degil).
#[derive(Debug, Default, Clone)]
pub struct H2Config {
    pub db_path: Option<String>,
    pub local_db_path: Option<String>,
    pub extra_archives: Vec<H2ExtraArchive>,
}

#[derive(Debug, Clone)]
pub struct H2ExtraArchive {
    pub name: Option<String>,
    pub db_path: String,
    /// H2 `trashed:true` isaretli ek arsivler LISTEDE kalir ama UI'da isaretlenir
    /// (kayipsizlik: cope atilmis arsivin verisi de kullanicinin verisidir).
    pub trashed: bool,
}

/// Saf JSON ayristirma (dosya IO yok → birim-testli). Bilinmeyen alanlar yok sayilir.
pub fn parse_h2_config(json: &str) -> Result<H2Config, H2ImportError> {
    let v: serde_json::Value = serde_json::from_str(json)
        .map_err(|e| H2ImportError::Config(format!("JSON ayristirilamadi: {e}")))?;
    let s = |v: &serde_json::Value, k: &str| -> Option<String> {
        v.get(k).and_then(|x| x.as_str()).map(str::trim).filter(|x| !x.is_empty()).map(String::from)
    };
    let mut cfg = H2Config {
        db_path: s(&v, "db_path"),
        local_db_path: s(&v, "local_db_path"),
        extra_archives: Vec::new(),
    };
    if let Some(arr) = v.get("extra_archives").and_then(|x| x.as_array()) {
        for e in arr {
            if let Some(db_path) = s(e, "db_path") {
                cfg.extra_archives.push(H2ExtraArchive {
                    name: s(e, "name"),
                    db_path,
                    trashed: e.get("trashed").and_then(|x| x.as_bool()).unwrap_or(false),
                });
            }
        }
    }
    Ok(cfg)
}

/// Bir aday H2 veritabani — UI secim listesinin satiri.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct H2CandidateDb {
    pub path: String,
    /// Kullaniciya gosterilecek ad: config `name` > dosya adi.
    pub label: String,
    /// "main" | "local" | "extra" | "scan" (AppData taramasindan, turu bilinmiyor)
    pub kind: String,
    /// "config" | "appdata"
    pub source: String,
    pub exists: bool,
    pub size_bytes: u64,
    /// `SELECT count(*) FROM assets` — en iyi caba (acilamazsa None; 0 DEGIL).
    pub asset_count: Option<i64>,
    /// Yaninda `<dosya>.lock` var — H2 acik olabilir (bilgi; kesin engel degil).
    pub locked_hint: bool,
    /// H2 tarafinda cope atilmis ek arsiv (veri hala tasinabilir).
    pub trashed: bool,
}

/// Bu dosya bir H2 ARSIV veritabani mi? (`legacy_h2.rs` ile ayni suzgec.)
/// `*_shapes.db` / `*_vec.db` sidecar'lari ARSIV DEGILDIR — sayilirsa kullaniciya
/// sisirilmis rakam gider.
pub fn is_archive_db(file_name: &str) -> bool {
    let f = file_name.to_ascii_lowercase();
    if !f.ends_with(".db") || f.ends_with("_shapes.db") || f.ends_with("_vec.db") {
        return false;
    }
    f == "archivist.db" || f == "archivist_local.db" || f.starts_with("archive_")
}

/// Aday listesi: config yollari ∪ AppData taramasi (kanonik anahtarla tekil; config kazanir).
/// `appdata_dir` = `%APPDATA%\com.archivistpro.desktop` (test edilebilirlik icin parametre).
/// `count_assets`: sayim geri-cagrisi (IO'yu cagiran sec — testte sahte verilebilir).
pub fn discover_candidates(
    appdata_dir: Option<&Path>,
    count_assets: impl Fn(&Path) -> Option<i64>,
) -> Vec<H2CandidateDb> {
    let mut out: Vec<H2CandidateDb> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let push = |path: &str, label: String, kind: &str, source: &str, trashed: bool,
                    out: &mut Vec<H2CandidateDb>,
                    seen: &mut std::collections::HashSet<String>| {
        let key = canonical_path_key(path);
        if !seen.insert(key) {
            return; // config kazandi (once eklendi)
        }
        let p = Path::new(path);
        let exists = p.is_file();
        let size_bytes = if exists { std::fs::metadata(p).map(|m| m.len()).unwrap_or(0) } else { 0 };
        let locked_hint = exists && {
            let mut lock = path.to_string();
            lock.push_str(".lock");
            Path::new(&lock).exists()
        };
        out.push(H2CandidateDb {
            path: path.to_string(),
            label,
            kind: kind.into(),
            source: source.into(),
            exists,
            size_bytes,
            asset_count: if exists { count_assets(p) } else { None },
            locked_hint,
            trashed,
        });
    };

    // 1) Config yollari (varsa) — kesif kaynagi olarak oncelikli.
    if let Some(dir) = appdata_dir {
        let cfg_path = dir.join("archivist_config.json");
        if let Ok(json) = std::fs::read_to_string(&cfg_path) {
            if let Ok(cfg) = parse_h2_config(&json) {
                if let Some(p) = &cfg.db_path {
                    push(p, file_label(p), "main", "config", false, &mut out, &mut seen);
                }
                if let Some(p) = &cfg.local_db_path {
                    push(p, file_label(p), "local", "config", false, &mut out, &mut seen);
                }
                for e in &cfg.extra_archives {
                    let label = e.name.clone().unwrap_or_else(|| file_label(&e.db_path));
                    push(&e.db_path, label, "extra", "config", e.trashed, &mut out, &mut seen);
                }
            }
        }

        // 2) AppData klasor taramasi — config'te olmayan yerel dosyalar.
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if entry.path().is_file() && is_archive_db(&name) {
                    let p = entry.path().to_string_lossy().to_string();
                    let kind = match name.to_ascii_lowercase().as_str() {
                        "archivist.db" => "main",
                        "archivist_local.db" => "local",
                        _ => "scan",
                    };
                    push(&p, name, kind, "appdata", false, &mut out, &mut seen);
                }
            }
        }
    }

    // Var olanlar once, sonra buyukten kucuge — kullanicinin sececegi sey ustte dursun.
    out.sort_by(|a, b| b.exists.cmp(&a.exists).then(b.size_bytes.cmp(&a.size_bytes)));
    out
}

fn file_label(path: &str) -> String {
    Path::new(path).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_real_shaped_config() {
        // Gercek archivist_config.json sekli (ollama_db.rs:711-732 semasina gore).
        let json = r#"{
            "db_path": "D:\\DENEME_arşiv\\archivist.db",
            "local_db_path": "D:\\DENEME_arşiv\\archivist_local.db",
            "extra_archives": [
                {"id":"6d9beae7","name":"Ofis Ortak","db_path":"D:\\arsiv\\archive_6d9beae7.db","archive_type":"shared","trashed":false},
                {"id":"x","db_path":"D:\\arsiv\\archive_x.db","trashed":true}
            ],
            "lan_auth_code": "sifreli-veri"
        }"#;
        let cfg = parse_h2_config(json).unwrap();
        assert_eq!(cfg.db_path.as_deref(), Some("D:\\DENEME_arşiv\\archivist.db"));
        assert_eq!(cfg.local_db_path.as_deref(), Some("D:\\DENEME_arşiv\\archivist_local.db"));
        assert_eq!(cfg.extra_archives.len(), 2);
        assert_eq!(cfg.extra_archives[0].name.as_deref(), Some("Ofis Ortak"));
        assert!(cfg.extra_archives[1].trashed, "trashed ek arsiv listede KALIR (kayipsizlik)");
    }

    #[test]
    fn tolerates_partial_and_rejects_garbage() {
        let cfg = parse_h2_config("{}").unwrap();
        assert!(cfg.db_path.is_none() && cfg.extra_archives.is_empty());
        // Bos dizgeler yok sayilir.
        let cfg = parse_h2_config(r#"{"db_path":"  "}"#).unwrap();
        assert!(cfg.db_path.is_none());
        // Cop JSON → Config hatasi (kesif cagirani bos listeyle surdurur).
        assert!(parse_h2_config("bozuk{").is_err());
    }

    #[test]
    fn archive_db_filter_excludes_sidecars() {
        assert!(is_archive_db("archivist.db"));
        assert!(is_archive_db("archivist_local.db"));
        assert!(is_archive_db("archive_6d9beae7-b4a5.db"));
        for no in ["archivist_shapes.db", "archive_x_shapes.db", "archivist_vec.db",
                   "archive_x_vec.db", "archivist.db-wal", "archivist.db.lock", "notlar.txt"] {
            assert!(!is_archive_db(no), "{no} arsiv sayilmamali");
        }
    }

    #[test]
    fn discovery_merges_config_and_scan_dedup_by_canonical_key() {
        let dir = tempfile::tempdir().unwrap();
        // AppData'da fiziksel bir arsiv + config'in ayni dosyayi FARKLI kasayla gostermesi.
        let db = dir.path().join("archivist.db");
        std::fs::write(&db, b"x").unwrap();
        let config = format!(
            r#"{{"db_path":"{}","extra_archives":[{{"name":"Dis","db_path":"D:\\yok\\archive_dis.db"}}]}}"#,
            db.to_string_lossy().to_string().to_uppercase().replace('\\', "\\\\")
        );
        std::fs::write(dir.path().join("archivist_config.json"), config).unwrap();

        let got = discover_candidates(Some(dir.path()), |_| Some(42));
        // archivist.db TEK kez (config kazandi → source=config); dis arsiv exists=false.
        let mains: Vec<_> = got.iter().filter(|c| c.kind == "main").collect();
        assert_eq!(mains.len(), 1, "kasa varyanti tekillestirilmeli: {got:?}");
        assert_eq!(mains[0].source, "config");
        assert_eq!(mains[0].asset_count, Some(42));
        let dis = got.iter().find(|c| c.kind == "extra").unwrap();
        assert!(!dis.exists);
        assert_eq!(dis.asset_count, None, "olmayan dosyaya sayim denenmez");
        assert_eq!(dis.label, "Dis");
    }

    #[test]
    fn lock_sidecar_sets_hint() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("archivist.db");
        std::fs::write(&db, b"x").unwrap();
        std::fs::write(dir.path().join("archivist.db.lock"), b"").unwrap();
        let got = discover_candidates(Some(dir.path()), |_| None);
        assert!(got[0].locked_hint, "yandas .lock ipucu vermeli");
    }
}
