//! Naming — saf klasor-adlandirma fonksiyonlari (salt-veri; disk YOK, DB YOK).
//!
//! `organize`in siniflandirma cekirdegi: bir `AssetClass` + `Structure`(ler) → sirali,
//! sanitize'li klasor segment adlari. Tum fonksiyonlar saf (yan-etkisiz) → hem onizleme
//! (`plan_organize`) hem calistirma (`organize_assets`) birebir ayni sonucu uretir.
//! Fiziksel klasor adlari **sabit TR** (UI-dil bagimsiz; H2 mantiginin devami).

use super::{AssetClass, Structure};

/// Uzantiyi (ASCII-kucuk normalize edilerek) sabit kategori klasorune esle. Bilinmeyen ext
/// **veya** `None` (uzantisiz) → `00-Diger`. Harita H2 mantigindan; adlar sabit TR (UI-dil
/// bagimsiz). Donen `&'static str` — tahsis yok.
pub fn ext_category(ext: Option<&str>) -> &'static str {
    let Some(ext) = ext else {
        return "00-Diger";
    };
    match ext.to_ascii_lowercase().as_str() {
        "dwg" | "dxf" | "dwf" | "dgn" | "dwt" => "01-Cizimler",
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "tif" | "tiff" | "webp" | "psd" | "eps"
        | "svg" | "heic" => "02-Gorseller",
        "pdf" | "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx" | "txt" | "rtf" | "odt"
        | "ods" | "csv" => "03-Dokumanlar",
        "skp" | "3ds" | "max" | "obj" | "fbx" | "blend" | "rvt" | "ifc" | "stl" | "dae" => {
            "04-Modeller"
        }
        "mp4" | "mov" | "avi" | "mkv" | "wmv" | "flv" | "webm" => "05-Video",
        "mp3" | "wav" | "flac" | "aac" | "ogg" | "m4a" => "06-Ses",
        "zip" | "rar" | "7z" | "tar" | "gz" => "07-Arsivler",
        _ => "00-Diger",
    }
}

/// Onay durumu (stored `draft|review|approved|rejected`) → sabit-TR klasor adi. `approved`→`Onayli`,
/// `rejected`→`Reddedilen`, `draft`/`review` (henuz karara baglanmamis)→`Bekleyen`; `None` veya
/// beklenmeyen deger → `00-Belirsiz`. Fiziksel ad UI-dil bagimsiz (`byApproval`). Adlar zaten
/// FS-guvenli → ek sanitize gerekmez. Donen `&'static str` — tahsis yok.
pub fn approval_folder(status: Option<&str>) -> &'static str {
    match status {
        Some("approved") => "Onayli",
        Some("rejected") => "Reddedilen",
        Some("draft") | Some("review") => "Bekleyen",
        _ => "00-Belirsiz",
    }
}

/// Termin metninden (ISO `YYYY-MM-DD`; DB'de TEXT) **4-hane yil** klasoru. Yil = ilk ayraca
/// (`-`/`/`) kadarki parca; tam 4 ASCII-rakam degilse veya `None`/bos → `00-Terminsiz`. Chrono/time
/// bagimliligi YOK (saf metin — deadline zaten ISO uretiliyor; frontend `type=date`).
fn year_folder(deadline: Option<&str>) -> String {
    let Some(raw) = deadline else {
        return "00-Terminsiz".to_string();
    };
    let head = raw.trim().split(['-', '/']).next().unwrap_or("");
    if head.len() == 4 && head.bytes().all(|b| b.is_ascii_digit()) {
        head.to_string()
    } else {
        "00-Terminsiz".to_string()
    }
}

/// Bir klasor adini dosya-sistemi-guvenli hale getir: yol-ayraci (`/ \`) + FS-yasak karakterler
/// (`: * ? " < > |`) ve kontrol karakterlerini bosluga cevir, cok-boslugu tek boslukta sadelestir,
/// bastaki/sondaki nokta+bosluk trimle. Sonuc **bos olabilir** → cagiran fallback verir
/// (or. byClient icin `00-Musterisiz`).
pub fn sanitize_folder_name(s: &str) -> String {
    // 1. Yasak/kontrol karakterleri → bosluk.
    let replaced: String = s
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    // 2. Cok-bosluk → tek bosluk (split_whitespace kenar boslugu da atar).
    let collapsed = replaced.split_whitespace().collect::<Vec<_>>().join(" ");
    // 3. Bas/son nokta + bosluk trimle (gizli/uzanti-taklidi klasor onleme).
    collapsed.trim_matches(|c: char| c == '.' || c == ' ').to_string()
}

/// Bir klasor yolunu **yol-ayraciyla bittiginden** emin ol — LIKE-onek eslesmesinde kardes klasor
/// sizintisini onler. Ayracsiz `C:\a\Villa` oneki LIKE ile `C:\a\Villa2\...`'yi de yanlislikla
/// eslestirir; `C:\a\Villa\` ile yalniz o klasorun icerigi eslesir (`escape_like_prefix` sondaki
/// `\`'i dogru escape'ler → sorun yok). Zaten `/` ya da `\` ile bitiyorsa aynen dondurur; degilse
/// yol `\` iceriyorsa `\`, aksi halde `/` ekler (Windows/POSIX ayraci tutarli sec).
pub fn ensure_trailing_sep(path: &str) -> String {
    if path.ends_with('/') || path.ends_with('\\') {
        return path.to_string();
    }
    let sep = if path.contains('\\') { '\\' } else { '/' };
    format!("{path}{sep}")
}

/// Kullanici-metnini sanitize et; bos kalirsa `fallback` ver (client/tag/version ortak deseni).
fn sanitized_or(value: Option<&str>, fallback: &str) -> String {
    let name = sanitize_folder_name(value.unwrap_or(""));
    if name.is_empty() {
        fallback.to_string()
    } else {
        name
    }
}

/// Bir asset icin TEK structure'in klasor adi (dest_root'a goreli, tek seviye; daima ayracsiz).
/// Dinamik (client/tag/version) adlar sanitize'li; sabit (ext/approval/year) adlar zaten guvenli.
fn folder_for(class: &AssetClass, structure: Structure) -> String {
    match structure {
        Structure::ByExt => ext_category(class.ext.as_deref()).to_string(),
        Structure::ByClient => sanitized_or(class.client_name.as_deref(), "00-Musterisiz"),
        Structure::ByTag => sanitized_or(class.first_tag.as_deref(), "00-Etiketsiz"),
        Structure::ByApproval => approval_folder(class.approval_status.as_deref()).to_string(),
        Structure::ByVersion => sanitized_or(class.version_label.as_deref(), "00-Versiyonsuz"),
        Structure::ByYear => year_folder(class.deadline.as_deref()),
    }
}

/// Bir asset'in **sirali relative segment listesi** — her `structure` bir klasor seviyesi (sanitize'li).
/// Saf: hem onizleme hem calistirma bunu cagirir → ikisi birebir tutarli. Bos `structures` → bos
/// dilim (segment yok; komut katmani dosyayi dogrudan dest_root'a koyar). Her segment ayracsiz tek
/// klasor; komut katmani `join(sep)` ile birlestirir.
pub fn relative_segments_for(class: &AssetClass, structures: &[Structure]) -> Vec<String> {
    structures.iter().map(|&s| folder_for(class, s)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AssetClass fixture (belirtilmeyen alanlar None) — folder testleri icin.
    fn cls(ext: Option<&str>, client: Option<&str>) -> AssetClass {
        AssetClass {
            id: 1,
            file_name: "x".into(),
            ext: ext.map(Into::into),
            client_name: client.map(Into::into),
            first_tag: None,
            approval_status: None,
            version_label: None,
            deadline: None,
        }
    }

    #[test]
    fn ext_category_maps_known_and_falls_back() {
        assert_eq!(ext_category(Some("dwg")), "01-Cizimler");
        assert_eq!(ext_category(Some("DXF")), "01-Cizimler"); // buyuk-harf normalize
        assert_eq!(ext_category(Some("png")), "02-Gorseller");
        assert_eq!(ext_category(Some("pdf")), "03-Dokumanlar");
        assert_eq!(ext_category(Some("skp")), "04-Modeller");
        assert_eq!(ext_category(Some("mp4")), "05-Video");
        assert_eq!(ext_category(Some("mp3")), "06-Ses");
        assert_eq!(ext_category(Some("zip")), "07-Arsivler");
        assert_eq!(ext_category(Some("xyz")), "00-Diger"); // bilinmeyen
        assert_eq!(ext_category(None), "00-Diger"); // uzantisiz
    }

    #[test]
    fn approval_folder_maps_and_falls_back() {
        assert_eq!(approval_folder(Some("approved")), "Onayli");
        assert_eq!(approval_folder(Some("rejected")), "Reddedilen");
        assert_eq!(approval_folder(Some("draft")), "Bekleyen");
        assert_eq!(approval_folder(Some("review")), "Bekleyen");
        assert_eq!(approval_folder(None), "00-Belirsiz"); // ayarlanmamis
        assert_eq!(approval_folder(Some("pending")), "00-Belirsiz"); // beklenmeyen deger
    }

    #[test]
    fn year_folder_extracts_and_falls_back() {
        assert_eq!(year_folder(Some("2026-09-01")), "2026");
        assert_eq!(year_folder(Some("2026-01-01")), "2026");
        assert_eq!(year_folder(Some("2026")), "2026"); // ayracsiz da olsa 4-hane
        assert_eq!(year_folder(Some("  2026-12-31  ")), "2026"); // trim
        assert_eq!(year_folder(None), "00-Terminsiz");
        assert_eq!(year_folder(Some("")), "00-Terminsiz");
        assert_eq!(year_folder(Some("26-01-01")), "00-Terminsiz"); // 4 hane degil
        assert_eq!(year_folder(Some("20xy-01-01")), "00-Terminsiz"); // rakam degil
    }

    #[test]
    fn sanitize_strips_forbidden_and_trims() {
        assert_eq!(sanitize_folder_name("Villa/Proje"), "Villa Proje");
        assert_eq!(
            sanitize_folder_name(r#"a:b*c?d"e<f>g|h\i"#),
            "a b c d e f g h i"
        );
        assert_eq!(sanitize_folder_name("cok    bosluk"), "cok bosluk");
        assert_eq!(sanitize_folder_name("  .Ahmet Bey.  "), "Ahmet Bey");
        // Yalniz yasak/nokta/bosluk → bos (cagiran fallback verir).
        assert!(sanitize_folder_name("   ").is_empty());
        assert!(sanitize_folder_name("...").is_empty());
        assert!(sanitize_folder_name("/\\:").is_empty());
    }

    #[test]
    fn ensure_trailing_sep_adds_when_missing_and_keeps_when_present() {
        // Ayracsiz Windows yolu → `\` eklenir (kardes-onek sizintisini onler).
        assert_eq!(ensure_trailing_sep(r"C:\a\Villa"), r"C:\a\Villa\");
        // Zaten ayracli → aynen (ciftlenmez).
        assert_eq!(ensure_trailing_sep(r"C:\a\Villa\"), r"C:\a\Villa\");
        assert_eq!(ensure_trailing_sep("/a/b/"), "/a/b/");
        // POSIX ayracsiz → `/` eklenir (yol `\` icermiyor).
        assert_eq!(ensure_trailing_sep("/a/b"), "/a/b/");
    }

    #[test]
    fn folder_for_by_ext_and_by_client() {
        let dwg = AssetClass {
            client_name: Some("Acme".into()),
            ..cls(Some("dwg"), None)
        };
        assert_eq!(folder_for(&dwg, Structure::ByExt), "01-Cizimler");
        assert_eq!(folder_for(&dwg, Structure::ByClient), "Acme");

        // Client None → fallback; ext None → Diger.
        let none = cls(None, None);
        assert_eq!(folder_for(&none, Structure::ByClient), "00-Musterisiz");
        assert_eq!(folder_for(&none, Structure::ByExt), "00-Diger");

        // Client sadece bosluk → sanitize bos → fallback.
        let blank = cls(Some("txt"), Some("   "));
        assert_eq!(folder_for(&blank, Structure::ByClient), "00-Musterisiz");
    }

    #[test]
    fn folder_for_tag_version_and_fallbacks() {
        let full = AssetClass {
            first_tag: Some("Villa".into()),
            version_label: Some("v2".into()),
            ..cls(None, None)
        };
        assert_eq!(folder_for(&full, Structure::ByTag), "Villa");
        assert_eq!(folder_for(&full, Structure::ByVersion), "v2");

        // None → fallback'lar.
        let none = cls(None, None);
        assert_eq!(folder_for(&none, Structure::ByTag), "00-Etiketsiz");
        assert_eq!(folder_for(&none, Structure::ByVersion), "00-Versiyonsuz");

        // Yalniz-bosluk / yasak karakter → sanitize bos → fallback.
        let blank = AssetClass {
            first_tag: Some("   ".into()),
            version_label: Some("/\\".into()),
            ..cls(None, None)
        };
        assert_eq!(folder_for(&blank, Structure::ByTag), "00-Etiketsiz");
        assert_eq!(folder_for(&blank, Structure::ByVersion), "00-Versiyonsuz");
    }

    #[test]
    fn folder_for_approval_and_year() {
        let a = AssetClass {
            approval_status: Some("approved".into()),
            deadline: Some("2026-09-01".into()),
            ..cls(None, None)
        };
        assert_eq!(folder_for(&a, Structure::ByApproval), "Onayli");
        assert_eq!(folder_for(&a, Structure::ByYear), "2026");

        let none = cls(None, None);
        assert_eq!(folder_for(&none, Structure::ByApproval), "00-Belirsiz");
        assert_eq!(folder_for(&none, Structure::ByYear), "00-Terminsiz");
    }

    #[test]
    fn relative_segments_multi_level_ordered() {
        let c = AssetClass {
            approval_status: Some("approved".into()),
            deadline: Some("2026-09-01".into()),
            client_name: Some("Acme".into()),
            ..cls(Some("dwg"), Some("Acme"))
        };
        // 2 seviye: yil / musteri — SIRA korunur.
        assert_eq!(
            relative_segments_for(&c, &[Structure::ByYear, Structure::ByClient]),
            vec!["2026".to_string(), "Acme".to_string()]
        );
        // 3 seviye: uzanti / onay / musteri.
        assert_eq!(
            relative_segments_for(
                &c,
                &[Structure::ByExt, Structure::ByApproval, Structure::ByClient]
            ),
            vec!["01-Cizimler".to_string(), "Onayli".to_string(), "Acme".to_string()]
        );
        // Ters sira farkli sonuc verir (sira anlamli).
        assert_eq!(
            relative_segments_for(&c, &[Structure::ByClient, Structure::ByYear]),
            vec!["Acme".to_string(), "2026".to_string()]
        );
    }

    #[test]
    fn relative_segments_empty_structures_is_empty() {
        let c = cls(Some("dwg"), Some("Acme"));
        assert!(relative_segments_for(&c, &[]).is_empty());
    }

    #[test]
    fn structure_parse_rejects_unknown() {
        assert_eq!("byExt".parse::<Structure>().unwrap(), Structure::ByExt);
        assert_eq!("byClient".parse::<Structure>().unwrap(), Structure::ByClient);
        assert_eq!("byTag".parse::<Structure>().unwrap(), Structure::ByTag);
        assert_eq!("byApproval".parse::<Structure>().unwrap(), Structure::ByApproval);
        assert_eq!("byVersion".parse::<Structure>().unwrap(), Structure::ByVersion);
        assert_eq!("byYear".parse::<Structure>().unwrap(), Structure::ByYear);
        assert!("byFoo".parse::<Structure>().is_err());
        assert!("".parse::<Structure>().is_err());
    }
}
