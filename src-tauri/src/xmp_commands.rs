//! XMP sidecar EXPORT (H2 `xmpSidecar.ts` + `write_xmp_sidecar` pariti).
//!
//! Arsivin kurate metadata'sini (baslik, etiketler, proje-durum) Adobe XMP standardinda bir
//! `.xmp` sidecar dosyasina yazar → Adobe Bridge/Lightroom + diger DAM araclari okuyabilir.
//! **XML uretimi RUST'ta** (H2 renderer'da uretiyordu; H3 renderer DB tutmaz → backend veriyi
//! sahiplenir, tek komut hem okur hem yazar; batch icin per-asset IPC yok).
//!
//! Yazma: dosyanin YANINA (`<path>.xmp`); yazilamazsa `<db_parent>/xmp-sidecar/<mirror>` fallback
//! (H2 deseni). Sistem dizinleri deny-list'te. **Admin** (toplu FS-yazma) + **yalniz yerel**
//! (uzak arsivde path HOST'undur → yerelde yanlis yere yazardi; secim kaynak degisiminde temizlenir).
//!
//! Additive (yeni `.xmp` dosyasi; kaynak dosyaya DOKUNMAZ) → non-destructive.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use archivist_db::AssetDetail;
use serde::Serialize;
use tauri::State;

use crate::archive_share::unix_to_iso_utc;
use crate::{rbac, AppState};

/// ArchivistPro'ya ozel XMP namespace (proje-durum alanlari icin).
const ARCHPRO_NS: &str = "http://archivist.pro/ns/1.0/";

/// Bir XMP export kosusunun ozeti (IPC). `written` dosya yanina, `fallback` xmp-sidecar/ altina.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XmpExportSummary {
    pub written: usize,
    pub fallback: usize,
    pub errors: Vec<XmpError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct XmpError {
    pub file_name: String,
    pub error: String,
}

/// XML metin/attribute kacisi (`& < > "`).
fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// `archpro:<name>="<val>"` attribute'unu (deger dolu ise) ekle.
fn push_attr(out: &mut String, name: &str, val: &Option<String>) {
    if let Some(v) = val {
        let v = v.trim();
        if !v.is_empty() {
            out.push_str(&format!("   archpro:{name}=\"{}\"\n", esc(v)));
        }
    }
}

/// Bir asset detayindan XMP XML uret (**saf**; test edilebilir). dc:title = baslik∨dosya adi;
/// dc:subject = kullanici+auto etiketleri (Bag); dc:format = mime∨uzanti; archpro:* = proje-durum
/// + gorsel turu + atanmis proje adi. xmp:CreateDate/ModifyDate ISO-UTC (chrono'suz).
pub fn generate_xmp(d: &AssetDetail) -> String {
    let a = &d.asset;
    let mut out = String::new();
    out.push_str("<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n");
    out.push_str("<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\n");
    out.push_str(" <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n");
    out.push_str("  <rdf:Description\n");
    out.push_str("   xmlns:dc=\"http://purl.org/dc/elements/1.1/\"\n");
    out.push_str("   xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n");
    out.push_str(&format!("   xmlns:archpro=\"{ARCHPRO_NS}\"\n"));
    out.push_str("   xmp:CreatorTool=\"ArchivistPro\"\n");
    out.push_str(&format!("   xmp:CreateDate=\"{}\"\n", unix_to_iso_utc(a.created_at)));
    out.push_str(&format!("   xmp:ModifyDate=\"{}\"\n", unix_to_iso_utc(a.modified_at)));
    if let Some(ap) = &d.assigned_project {
        push_attr(&mut out, "ProjectName", &Some(ap.name.clone()));
    }
    push_attr(&mut out, "ClientName", &d.project.client_name);
    push_attr(&mut out, "ApprovalStatus", &d.project.approval_status);
    push_attr(&mut out, "RejectionReason", &d.project.rejection_reason);
    push_attr(&mut out, "VersionLabel", &d.project.version_label);
    push_attr(&mut out, "Deadline", &d.project.deadline);
    push_attr(&mut out, "GorselTuru", &a.ai_gorsel_turu);
    out.push_str("  >\n");

    // dc:title (baslik yoksa dosya adi).
    let title = a
        .title
        .as_ref()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| a.file_name.clone());
    out.push_str("   <dc:title>\n    <rdf:Alt>\n");
    out.push_str(&format!("     <rdf:li xml:lang=\"x-default\">{}</rdf:li>\n", esc(&title)));
    out.push_str("    </rdf:Alt>\n   </dc:title>\n");

    // dc:subject — kullanici + auto etiketleri (sistem etiketleri haric).
    let subjects: Vec<&str> = d
        .tags
        .iter()
        .filter(|t| t.kind == "user" || t.kind == "auto")
        .map(|t| t.name.as_str())
        .collect();
    if !subjects.is_empty() {
        out.push_str("   <dc:subject>\n    <rdf:Bag>\n");
        for s in subjects {
            out.push_str(&format!("     <rdf:li>{}</rdf:li>\n", esc(s)));
        }
        out.push_str("    </rdf:Bag>\n   </dc:subject>\n");
    }

    // dc:format — mime yoksa uzanti.
    if let Some(f) = a.mime.clone().or_else(|| a.ext.clone()) {
        out.push_str(&format!("   <dc:format>{}</dc:format>\n", esc(&f)));
    }

    out.push_str("  </rdf:Description>\n </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end=\"w\"?>\n");
    out
}

fn require_admin(state: &AppState) -> Result<(), String> {
    let role = rbac::current_role(state).map_err(|e| e.to_string())?;
    rbac::require_admin(role).map_err(|e| e.to_string())
}

/// Sistem dizini mi (deny-list; Windows) — sidecar oraya yazilmaz.
fn is_denied(path: &Path) -> bool {
    let c = path.to_string_lossy().replace('\\', "/").to_lowercase();
    ["c:/windows/", "c:/program files/", "c:/program files (x86)/"]
        .iter()
        .any(|d| c.starts_with(d))
}

/// Fallback yol: `<db_parent>/xmp-sidecar/<ayna>` (or. `C:\P\x.dwg.xmp` → `.../xmp-sidecar/C/P/x.dwg.xmp`).
fn fallback_path(db_parent: &Path, target: &Path) -> PathBuf {
    let mirror = target
        .to_string_lossy()
        .replace('\\', "/")
        .replace("://", "/") // UNC
        .replacen(":/", "/", 1); // C:/ → C/
    db_parent.join("xmp-sidecar").join(mirror)
}

/// Dosyayi yaz + fsync (ust dizinleri olustur).
fn write_synced(target: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut f = fs::File::create(target)?;
    f.write_all(data)?;
    f.sync_all()?;
    Ok(())
}

/// Secili asset'ler icin XMP sidecar dosyalari yaz (**admin**; yalniz yerel — path aktif yerel
/// arsivden okunur). Her asset: detay oku → XMP uret → dosya yanina yaz, olmazsa fallback.
/// Doner: `{written, fallback, errors}`. Kaynak dosyaya DOKUNMAZ (additive).
#[tauri::command]
pub fn export_xmp_sidecars(
    ids: Vec<i64>,
    state: State<'_, AppState>,
) -> Result<XmpExportSummary, String> {
    require_admin(&state)?;
    let db_parent =
        state.db_path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    let db = state.read_db.lock().map_err(|e| e.to_string())?;

    let mut summary = XmpExportSummary { written: 0, fallback: 0, errors: Vec::new() };
    for id in ids {
        let detail = match db.get_asset(id) {
            Ok(Some(d)) => d,
            Ok(None) => {
                summary
                    .errors
                    .push(XmpError { file_name: format!("#{id}"), error: "asset bulunamadi".into() });
                continue;
            }
            Err(e) => {
                summary
                    .errors
                    .push(XmpError { file_name: format!("#{id}"), error: e.to_string() });
                continue;
            }
        };
        let xml = generate_xmp(&detail);
        let target = PathBuf::from(format!("{}.xmp", detail.asset.path));
        if is_denied(&target) {
            summary.errors.push(XmpError {
                file_name: detail.asset.file_name.clone(),
                error: "sistem dizinine yazilamaz".into(),
            });
            continue;
        }
        // 1) Dosyanin yanina.
        if write_synced(&target, xml.as_bytes()).is_ok() {
            summary.written += 1;
            continue;
        }
        // 2) Fallback: xmp-sidecar/ ayna.
        let fb = fallback_path(&db_parent, &target);
        match write_synced(&fb, xml.as_bytes()) {
            Ok(()) => summary.fallback += 1,
            Err(e) => summary
                .errors
                .push(XmpError { file_name: detail.asset.file_name.clone(), error: e.to_string() }),
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;
    use archivist_db::Db;

    fn seed_detail() -> AssetDetail {
        let db = Db::open_in_memory_migrated().unwrap();
        let conn = db.connection();
        conn.execute(
            "INSERT INTO assets(id, path, file_name, ext, mime, title, size_bytes, created_at, modified_at,
                                client_name, approval_status, version_label)
             VALUES (1, 'C:/proj/villa.dwg', 'villa.dwg', 'dwg', 'image/vnd.dwg', 'Villa Plani', 10,
                     0, 86400, 'Acme', 'approved', 'v2')",
            [],
        )
        .unwrap();
        // Bir kullanici etiketi + bir sistem etiketi (sistem dc:subject'e GIRMEMELI).
        conn.execute("INSERT INTO tags(name, kind) VALUES ('kat-plani', 'user')", []).unwrap();
        conn.execute("INSERT INTO tags(name, kind) VALUES ('sys-x', 'system')", []).unwrap();
        conn.execute("INSERT INTO asset_tags(asset_id, tag_id) SELECT 1, id FROM tags", []).unwrap();
        db.get_asset(1).unwrap().unwrap()
    }

    #[test]
    fn generate_xmp_includes_core_and_project_fields() {
        let xml = generate_xmp(&seed_detail());
        assert!(xml.contains("xmp:CreatorTool=\"ArchivistPro\""));
        // ISO tarih (modified_at=86400 → 1970-01-02).
        assert!(xml.contains("xmp:ModifyDate=\"1970-01-02T00:00:00Z\""), "{xml}");
        assert!(xml.contains("archpro:ClientName=\"Acme\""));
        assert!(xml.contains("archpro:ApprovalStatus=\"approved\""));
        assert!(xml.contains("archpro:VersionLabel=\"v2\""));
        // dc:title = baslik.
        assert!(xml.contains(">Villa Plani</rdf:li>"));
        // dc:subject: kullanici etiketi VAR, sistem etiketi YOK.
        assert!(xml.contains("<rdf:li>kat-plani</rdf:li>"));
        assert!(!xml.contains("sys-x"), "sistem etiketi dc:subject'e girmemeli");
        // dc:format = mime.
        assert!(xml.contains("<dc:format>image/vnd.dwg</dc:format>"));
    }

    #[test]
    fn generate_xmp_escapes_xml() {
        let mut d = seed_detail();
        d.asset.title = Some("A & B <plan>".into());
        let xml = generate_xmp(&d);
        assert!(xml.contains("A &amp; B &lt;plan&gt;"));
        assert!(!xml.contains("A & B <plan>"));
    }

    #[test]
    fn deny_list_blocks_system_dirs() {
        assert!(is_denied(Path::new(r"C:\Windows\x.dwg.xmp")));
        assert!(is_denied(Path::new(r"C:\Program Files\app\y.xmp")));
        assert!(!is_denied(Path::new(r"C:\Projeler\villa.dwg.xmp")));
    }

    #[test]
    fn fallback_path_mirrors_drive() {
        let fb = fallback_path(Path::new(r"D:\data"), Path::new(r"C:\P\x.dwg.xmp"));
        let s = fb.to_string_lossy().replace('\\', "/");
        assert!(s.ends_with("xmp-sidecar/C/P/x.dwg.xmp"), "{s}");
    }
}
