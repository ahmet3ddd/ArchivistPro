//! H2 veritabanina SALT-OKUMA erisim + savunmacı okuyucular.
//!
//! Savunmacilik nedeni (olculdu): H2 DB'leri es-sekilli DEGIL. `user_version` 0-3 arasi
//! degisir (epoch); epoch<3 monolit DB'de embeddings/text_chunks de bulunur, epoch=3'te
//! bulunmaz; cok eski arsivlerde kimi tablolar hic yoktur. Biz o tablolari TASIMIYORUZ ama
//! okuma kodu "tablo yok" durumunda HATA degil bos-sonuc uretmelidir (`missing_tables` izi).
//!
//! `.lock` yandas dosyasi ENGEL DEGILDIR (olculdu, bu makinede: uc DB'de de bayat .lock
//! duruyordu, H2 kapaliydi). Kilit yalniz UI ipucudur; gercek karar `mode=ro` acilma
//! denemesindedir — SQLite salt-okuma baglantisi H2 acikken bile tutarli okur.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::pathkey::canonical_path_key;
use crate::time::parse_h2_timestamp;
use crate::H2ImportError;

/// H2 `assets` tablosunun okudugumuz alt-kumesi (38 kolonun tasima-ilgili kismi).
#[derive(Debug, Clone, Default)]
pub struct H2Asset {
    pub id: String,
    pub file_path: String,
    pub file_name: Option<String>,
    pub file_size: Option<i64>,
    /// ISO ya da `datetime('now')` bicimi — cagiran [`parse_h2_timestamp`] ile cevirir.
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    /// Unix SANIYE (H2'deki tek epoch alani) — zaman geri-dususunun en guvenilir kaynagi.
    pub fs_mtime: Option<i64>,
    pub is_deleted: bool,
    pub deleted_at: Option<String>,
    /// AI analiz alanlarini iceren JSON (dwgDrawingType/dwgDescription/...).
    pub metadata_json: Option<String>,
    /// `AITag[]` JSON — anahtar-kelime harmanina girer.
    pub ai_tags_json: Option<String>,
    /// `data:image/...;base64,...` inline thumbnail.
    pub thumbnail_url: Option<String>,
    pub extracted_at: Option<String>,
    // Proje-durum alanlari (yalniz-H3-bossa tasinir).
    pub client_name: Option<String>,
    pub approval_status: Option<String>,
    pub rejection_reason: Option<String>,
    pub version_label: Option<String>,
    pub deadline: Option<String>,
}

/// Kurasyon satirlari (hepsi opsiyonel tablolardan gelir).
#[derive(Debug, Clone)]
pub struct H2Tag {
    pub id: i64,
    pub name: String,
}
#[derive(Debug, Clone)]
pub struct H2Collection {
    pub id: i64,
    pub name: String,
    pub color: Option<String>,
}
#[derive(Debug, Clone)]
pub struct H2Root {
    pub id: String,
    pub path: String,
    pub label: Option<String>,
    pub group_id: Option<String>,
    pub is_favorite: bool,
    pub added_at: Option<String>,
}
#[derive(Debug, Clone)]
pub struct H2RootGroup {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
}
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct H2UserBrief {
    pub username: String,
    pub role: Option<String>,
}

/// Salt-okuma H2 kaynagi.
pub struct H2Source {
    conn: rusqlite::Connection,
    pub db_path: PathBuf,
}

impl H2Source {
    /// `mode=ro` URI ile ac. `.lock` ENGEL DEGIL (bayat kilitler olculdu); acilamayan
    /// dosya `Open` hatasi doner — cagiran "H2'yi kapatip deneyin" onerir.
    pub fn open(db_path: &Path) -> Result<Self, H2ImportError> {
        let uri = format!("file:{}?mode=ro", db_path.to_string_lossy().replace('\\', "/"));
        let conn = rusqlite::Connection::open_with_flags(
            &uri,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        )
        .map_err(|e| H2ImportError::Open(format!("{}: {e}", db_path.display())))?;
        conn.busy_timeout(std::time::Duration::from_millis(2000))
            .map_err(|e| H2ImportError::Open(e.to_string()))?;
        // "Bu gercekten bir H2 arsivi mi" hizli sondasi: assets tablosu sart.
        let has_assets: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='assets')",
                [],
                |r| r.get(0),
            )
            .map_err(|e| H2ImportError::Open(e.to_string()))?;
        if !has_assets {
            return Err(H2ImportError::Open(format!(
                "{}: 'assets' tablosu yok — H2 arsivi degil",
                db_path.display()
            )));
        }
        Ok(Self { conn, db_path: db_path.to_path_buf() })
    }

    pub fn table_exists(&self, name: &str) -> bool {
        self.conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
                [name],
                |r| r.get(0),
            )
            .unwrap_or(false)
    }

    /// Bir kolonun varligini yokla — cok eski H2 semalari kimi kolonlari icermez
    /// (imperatif ALTER-migration'lar). Eksik kolon HATA degil, NULL okunur.
    fn column_exists(&self, table: &str, col: &str) -> bool {
        let Ok(mut stmt) = self.conn.prepare(&format!("PRAGMA table_info({table})")) else {
            return false;
        };
        let cols: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(1))
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default();
        cols.iter().any(|c| c.eq_ignore_ascii_case(col))
    }

    /// `SELECT count(*)` — tablo yoksa `None` (0 DEGIL: "yok" ile "bos" ayri seyler).
    pub fn count(&self, table: &str) -> Option<i64> {
        if !self.table_exists(table) {
            return None;
        }
        self.conn.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0)).ok()
    }

    /// Kosul'lu sayim (tablo yoksa None).
    pub fn count_where(&self, table: &str, cond: &str) -> Option<i64> {
        if !self.table_exists(table) {
            return None;
        }
        self.conn
            .query_row(&format!("SELECT count(*) FROM {table} WHERE {cond}"), [], |r| r.get(0))
            .ok()
    }

    /// Asset satirlarini AKIS halinde gez (41k satir bellekte TUTULMAZ; thumbnail/metadata
    /// JSON'lari satir basina okunup cagirana verilir, o isini bitirince düşer).
    /// Eksik kolonlar NULL okunur (savunmaci SELECT kurulumu).
    pub fn for_each_asset(
        &self,
        mut f: impl FnMut(H2Asset) -> Result<(), H2ImportError>,
    ) -> Result<(), H2ImportError> {
        // Kolon listesi savunmaci kurulur: var olan kolon adi, olmayana NULL.
        let sel = |c: &str| -> String {
            if self.column_exists("assets", c) {
                c.to_string()
            } else {
                format!("NULL AS {c}")
            }
        };
        let sql = format!(
            "SELECT {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}
             FROM assets",
            sel("id"),
            sel("file_path"),
            sel("file_name"),
            sel("file_size"),
            sel("created_at"),
            sel("modified_at"),
            sel("fs_mtime"),
            sel("is_deleted"),
            sel("deleted_at"),
            sel("metadata_json"),
            sel("ai_tags_json"),
            sel("thumbnail_url"),
            sel("extracted_at"),
            sel("client_name"),
            sel("approval_status"),
            sel("rejection_reason"),
            sel("version_label"),
        );
        // deadline ayri eklenir (17 kolonluk format! okunakliligi icin).
        let sql = sql.replace(" FROM assets", &format!(", {} FROM assets", sel("deadline")));

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| {
            Ok(H2Asset {
                id: r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                file_path: r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                file_name: r.get(2)?,
                file_size: r.get(3)?,
                created_at: r.get(4)?,
                modified_at: r.get(5)?,
                fs_mtime: r.get(6)?,
                is_deleted: r.get::<_, Option<i64>>(7)?.unwrap_or(0) != 0,
                deleted_at: r.get(8)?,
                metadata_json: r.get(9)?,
                ai_tags_json: r.get(10)?,
                thumbnail_url: r.get(11)?,
                extracted_at: r.get(12)?,
                client_name: r.get(13)?,
                approval_status: r.get(14)?,
                rejection_reason: r.get(15)?,
                version_label: r.get(16)?,
                deadline: r.get(17)?,
            })
        })?;
        for row in rows {
            f(row?)?;
        }
        Ok(())
    }

    /// **Cift-yol cozumu, 1. gecis:** kanonik yol anahtari → KAZANAN H2 id.
    /// H2 `file_path` UNIQUE degildir (id path+size+mtime turevi; dosya degisince yeni id
    /// dogar, eski satir kalir). Kazanan: en guncel `extracted_at`, esitse en guncel
    /// `fs_mtime`, o da esitse en buyuk rowid. Silinmis satirlar ANCAK ayni yolda aktif
    /// satir yoksa kazanabilir (aktif kayit her zaman silinmise yeglenir).
    pub fn winner_map(&self) -> Result<HashMap<String, String>, H2ImportError> {
        struct Cand {
            id: String,
            active: bool,
            extracted: i64,
            mtime: i64,
            rowid: i64,
        }
        let mut winners: HashMap<String, Cand> = HashMap::new();

        let has_deleted = self.column_exists("assets", "is_deleted");
        let has_extracted = self.column_exists("assets", "extracted_at");
        let has_mtime = self.column_exists("assets", "fs_mtime");
        let sql = format!(
            "SELECT id, file_path, rowid, {}, {}, {} FROM assets",
            if has_deleted { "COALESCE(is_deleted,0)" } else { "0" },
            if has_extracted { "extracted_at" } else { "NULL" },
            if has_mtime { "fs_mtime" } else { "NULL" },
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?.unwrap_or_default(),
                r.get::<_, Option<String>>(1)?.unwrap_or_default(),
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)? != 0,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, Option<i64>>(5)?,
            ))
        })?;
        for row in rows {
            let (id, file_path, rowid, deleted, extracted_at, fs_mtime) = row?;
            if id.is_empty() || file_path.is_empty() {
                continue;
            }
            let key = canonical_path_key(&file_path);
            let cand = Cand {
                id,
                active: !deleted,
                extracted: extracted_at.as_deref().and_then(parse_h2_timestamp).unwrap_or(0),
                mtime: fs_mtime.unwrap_or(0),
                rowid,
            };
            match winners.get(&key) {
                None => {
                    winners.insert(key, cand);
                }
                Some(cur) => {
                    // Aktif > silinmis; sonra extracted_at, fs_mtime, rowid.
                    let newer = (cand.active, cand.extracted, cand.mtime, cand.rowid)
                        > (cur.active, cur.extracted, cur.mtime, cur.rowid);
                    if newer {
                        winners.insert(key, cand);
                    }
                }
            }
        }
        Ok(winners.into_iter().map(|(k, c)| (k, c.id)).collect())
    }

    // ── Kurasyon okuyuculari — tablo yoksa BOS (savunmaci) ──

    pub fn tags(&self) -> Vec<H2Tag> {
        self.read_all("SELECT id, name FROM tags", |r| {
            Ok(H2Tag { id: r.get(0)?, name: r.get(1)? })
        })
    }

    /// `asset_id → tag adlari` (JOIN tek gecis; 0-satir tablolarda bos).
    pub fn asset_tags(&self) -> HashMap<String, Vec<String>> {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        if !self.table_exists("asset_tags") || !self.table_exists("tags") {
            return map;
        }
        let Ok(mut stmt) = self
            .conn
            .prepare("SELECT at.asset_id, t.name FROM asset_tags at JOIN tags t ON t.id = at.tag_id")
        else {
            return map;
        };
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        }) {
            for (aid, name) in rows.flatten() {
                map.entry(aid).or_default().push(name);
            }
        }
        map
    }

    pub fn favorites(&self) -> Vec<String> {
        self.read_all("SELECT asset_id FROM favorites", |r| r.get(0))
    }

    pub fn collections(&self) -> Vec<H2Collection> {
        self.read_all("SELECT id, name, color FROM collections", |r| {
            Ok(H2Collection { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? })
        })
    }

    /// `collection_id → asset_id listesi`.
    pub fn collection_items(&self) -> HashMap<i64, Vec<String>> {
        let mut map: HashMap<i64, Vec<String>> = HashMap::new();
        for (cid, aid) in self.read_all::<(i64, String)>(
            "SELECT collection_id, asset_id FROM collection_items",
            |r| Ok((r.get(0)?, r.get(1)?)),
        ) {
            map.entry(cid).or_default().push(aid);
        }
        map
    }

    pub fn scanned_roots(&self) -> Vec<H2Root> {
        // group_id/is_favorite gec eklenen kolonlar — savunmaci SELECT.
        let gid = if self.column_exists("scanned_roots", "group_id") { "group_id" } else { "NULL" };
        let fav =
            if self.column_exists("scanned_roots", "is_favorite") { "is_favorite" } else { "0" };
        let sql = format!(
            "SELECT id, path, label, {gid}, COALESCE({fav},0), added_at FROM scanned_roots"
        );
        self.read_all(&sql, |r| {
            Ok(H2Root {
                id: r.get(0)?,
                path: r.get(1)?,
                label: r.get(2)?,
                group_id: r.get(3)?,
                is_favorite: r.get::<_, i64>(4)? != 0,
                added_at: r.get(5)?,
            })
        })
    }

    pub fn root_groups(&self) -> Vec<H2RootGroup> {
        self.read_all("SELECT id, name, color FROM root_groups", |r| {
            Ok(H2RootGroup { id: r.get(0)?, name: r.get(1)?, color: r.get(2)? })
        })
    }

    /// `root_id → tag adlari`.
    pub fn root_tags(&self) -> HashMap<String, Vec<String>> {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        if !self.table_exists("root_tags") || !self.table_exists("tags") {
            return map;
        }
        for (rid, name) in self.read_all::<(String, String)>(
            "SELECT rt.root_id, t.name FROM root_tags rt JOIN tags t ON t.id = rt.tag_id",
            |r| Ok((r.get(0)?, r.get(1)?)),
        ) {
            map.entry(rid).or_default().push(name);
        }
        map
    }

    pub fn users(&self) -> Vec<H2UserBrief> {
        self.read_all("SELECT username, role FROM users", |r| {
            Ok(H2UserBrief { username: r.get(0)?, role: r.get(1)? })
        })
    }

    /// Ortak okuma kalibi: SQL'deki ANA tablo yoksa/istatement kurulamazsa BOS liste.
    fn read_all<T>(
        &self,
        sql: &str,
        map: impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
    ) -> Vec<T> {
        let Ok(mut stmt) = self.conn.prepare(sql) else {
            return Vec::new();
        };
        stmt.query_map([], map).map(|rows| rows.flatten().collect()).unwrap_or_default()
    }
}
