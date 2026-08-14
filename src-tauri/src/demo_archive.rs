//! ÖRNEK ("demo") ana arsiv — tek makinede LAN okumayi GOZLE dogrulamak icin ayri, ACIKCA
//! etiketli bir arsiv. Loopback'te "Ana arsiv" ile "Bu makine" ayni DB'ye baktigindan icerik
//! ozdes gorunur; demo bunu cozer: host, GERCEK LAN hattindan AYRI bir DB (`demo_archive.db`)
//! sunar → tum zincir (HTTP/auth/`remote_*`/kaynak degistirici) calisir, yalniz veri kumesi
//! farkli ve gorunur sekilde ayridir.
//!
//! 🔒 DURUSTLUK: icerik "ÖRNEK —" ile etiketli ve demo YALNIZ kullanici acikca "Ornek arsivle
//! baslat" derse devreye girer → gercek ofis arsiviyle karistirilamaz. Gercek bir host'a
//! baglaninca demo devre disi (istemci gercek adrese eslesir).

use std::path::{Path, PathBuf};

/// Demo arsiv DB dosyasinin yolu — gercek DB ile AYNI dizinde, ayri dosya (`demo_archive.db`).
pub fn demo_db_path(real_db_path: &Path) -> PathBuf {
    real_db_path
        .parent()
        .map(|d| d.join("demo_archive.db"))
        .unwrap_or_else(|| PathBuf::from("demo_archive.db"))
}

/// Demo arsivi (yoksa/bossa) tohumla — **idempotent**. Zaten tohumlanmissa dokunmaz.
pub fn ensure_seeded(path: &Path) -> Result<(), String> {
    let mut db = archivist_db::Db::open_and_migrate(path).map_err(|e| e.to_string())?;
    // Idempotent: en az bir asset varsa yeniden tohumlama (host restart / tekrar baslat).
    let existing = db.list_assets(&Default::default()).map_err(|e| e.to_string())?;
    if existing.total > 0 {
        return Ok(());
    }
    seed(&mut db)
}

/// ~12 belirgin asset, 4 klasor altinda — hepsi "ÖRNEK —" basligiyla. Turkce/UNC yollar gercek
/// bir ofis arsivini taklit eder ama etiket onu ACIKCA demo yapar.
fn seed(db: &mut archivist_db::Db) -> Result<(), String> {
    // (yol, dosya_adi, uzanti, baslik, fts_govdesi)
    const ITEMS: &[(&str, &str, &str, &str, &str)] = &[
        (
            r"\\ORNEK-ANA-ARSIV\Konut\Villa-Yesilvadi\zemin-kat-plani.dwg",
            "zemin-kat-plani.dwg",
            "dwg",
            "ÖRNEK — Villa Yeşilvadi Zemin Kat Planı",
            "villa yesilvadi zemin kat plani konut mimari cizim",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Konut\Villa-Yesilvadi\kesit-A-A.pdf",
            "kesit-A-A.pdf",
            "pdf",
            "ÖRNEK — Villa Yeşilvadi Kesit A-A",
            "villa yesilvadi kesit detay olcek",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Konut\Villa-Yesilvadi\on-cephe.jpg",
            "on-cephe.jpg",
            "jpg",
            "ÖRNEK — Villa Yeşilvadi Ön Cephe Görseli",
            "villa yesilvadi on cephe render gorsel",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Konut\Villa-Marmara\vaziyet-plani.dwg",
            "vaziyet-plani.dwg",
            "dwg",
            "ÖRNEK — Villa Marmara Vaziyet Planı",
            "villa marmara vaziyet plani arsa yerlesim",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Konut\Villa-Marmara\ruhsat.pdf",
            "ruhsat.pdf",
            "pdf",
            "ÖRNEK — Villa Marmara Ruhsat Belgesi",
            "villa marmara ruhsat belge resmi",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Ticari\Ofis-Kule-Levent\kat-plani-tip.dwg",
            "kat-plani-tip.dwg",
            "dwg",
            "ÖRNEK — Ofis Kule Tip Kat Planı",
            "ofis kule levent tip kat plani ticari",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Ticari\Ofis-Kule-Levent\statik-rapor.pdf",
            "statik-rapor.pdf",
            "pdf",
            "ÖRNEK — Ofis Kule Statik Raporu",
            "ofis kule statik rapor hesap betonarme",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Ticari\Ofis-Kule-Levent\giris-render.jpg",
            "giris-render.jpg",
            "jpg",
            "ÖRNEK — Ofis Kule Giriş Render",
            "ofis kule giris render gorsel sunum",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Ticari\Ofis-Kule-Levent\tesisat-sema.dwg",
            "tesisat-sema.dwg",
            "dwg",
            "ÖRNEK — Ofis Kule Tesisat Şeması",
            "ofis kule tesisat sema mekanik",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Kamu\Ilkokul-Bahcelievler\yerlesim.dwg",
            "yerlesim.dwg",
            "dwg",
            "ÖRNEK — İlkokul Yerleşim Planı",
            "ilkokul bahcelievler yerlesim plani kamu egitim",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Kamu\Ilkokul-Bahcelievler\metraj.pdf",
            "metraj.pdf",
            "pdf",
            "ÖRNEK — İlkokul Metraj Cetveli",
            "ilkokul metraj cetvel kesif yaklasik maliyet",
        ),
        (
            r"\\ORNEK-ANA-ARSIV\Kamu\Ilkokul-Bahcelievler\bahce-peyzaj.jpg",
            "bahce-peyzaj.jpg",
            "jpg",
            "ÖRNEK — İlkokul Bahçe Peyzaj",
            "ilkokul bahce peyzaj gorsel yesil alan",
        ),
    ];

    // Sabit taban zaman (Date::now yasak degil ama deterministik seed tercih edilir): her asset
    // bir gun arayla → siralama (ad/dosya-sayisi/tarih) anlamli calisir.
    const BASE_TS: i64 = 1_700_000_000;
    for (i, (path, name, ext, title, body)) in ITEMS.iter().enumerate() {
        let ts = BASE_TS + (i as i64) * 86_400;
        // content_hash yol-basina benzersiz (ingest yola gore upsert eder; yine de benzersiz tut).
        let hash = format!("demo-{path}");
        let asset = archivist_db::AssetInput {
            path,
            file_name: name,
            ext: Some(ext),
            size_bytes: 100_000 + (i as i64) * 4_096,
            content_hash: Some(&hash),
            mime: None,
            title: Some(title),
            description: None,
            created_at: ts,
            modified_at: ts,
        };
        let data = archivist_db::IngestData {
            fts_body: Some(body),
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        };
        db.ingest(&asset, &data).map_err(|e| e.to_string())?;
    }

    // Bir kac ornek bildirim → LanClientCard'da gorunur ("demo host'a baglisin" hissi pekistir).
    // Best-effort: bildirim eklenemezse demo yine de calisir (arsiv icerigi asil olan).
    let _ = db.add_notification(
        "index",
        "ÖRNEK — Ana arşive 12 çizim eklendi",
        Some("Bu bir demo ana arşivdir (gerçek ofis verisi değil)."),
    );
    Ok(())
}
