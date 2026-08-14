//! GERCEK H2 arsiviyle duman testi: envanter → kuru kosu → uygula → idempotency.
//! Kaynak SALT-OKUMA acilir (H2 dosyasina dokunulmaz); hedef GECICI H3 DB'dir.
//!
//! Kosum: cargo run -p archivist-h2import --example smoke_import -- <h2.db yolu>

// Uretim listesiyle ayni (src-tauri vision.rs DRAWING_TYPES; dairesel bagimlilik
// olmasin diye burada kopya — yalniz duman testi, uretim yolu komut katmanindan enjekte).
const DRAWING_TYPES: &[&str] = &[
    "Kat Planı", "Cephe", "Kesit", "Detay", "Vaziyet Planı", "Tesisat", "Elektrik",
    "Strüktür", "Mobilya Layout", "Çatı Planı", "Süsleme Detayı", "Restorasyon", "Diğer",
];

fn main() {
    let h2_path = std::env::args().nth(1).expect("kullanim: smoke_import <h2.db>");
    let h2_path = std::path::PathBuf::from(h2_path);

    // ① ENVANTER
    let inv = archivist_h2import::inventory(&h2_path).expect("envanter");
    println!("=== ENVANTER: {} ===", inv.db_path);
    println!(
        "  asset={} silinmis={} AI'li={} thumb'li={} etiket={} favori={} koleksiyon={} kok={} grup={} proje-meta={} kullanici={} chat={} eksik-tablo={:?} kuratorlu={}",
        inv.assets, inv.assets_deleted, inv.assets_with_ai, inv.assets_with_thumbnail,
        inv.asset_tags, inv.favorites, inv.collections, inv.scanned_roots, inv.root_groups,
        inv.project_meta_rows, inv.users.len(), inv.chat_sessions, inv.missing_tables,
        inv.has_curated_data
    );

    // Hedef: gecici H3 DB (bos — "ofiste ilk kurulum" senaryosu).
    let dir = std::env::temp_dir().join("arsiv_h2_smoke");
    std::fs::create_dir_all(&dir).expect("temp dizin");
    let h3_path = dir.join("h3_smoke.db");
    let _ = std::fs::remove_file(&h3_path);
    let mut h3 = archivist_db::Db::open_and_migrate(&h3_path).expect("H3 DB");

    let src = archivist_h2import::H2Source::open(&h2_path).expect("H2 kaynagi");
    let opts = archivist_h2import::ImportOptions::default();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let dump = |ad: &str, r: &archivist_h2import::H2ImportReport| {
        println!(
            "=== {ad} ({} ms) ===\n  yeni={} mevcut={} cop={} cop-cakisma={} mukerrer={} \
             AI={} AI-atla={} AI-zayif={} tur-dusen={} gorsel-turu={} etiket={} favori={} \
             koleksiyon={} uyelik={} proje-meta={} (atla={}) kok={} grup={} kok-etiket={} \
             thumb={} (bozuk={}) bozuk-zaman={} hata={} (+{} kirpik)",
            r.elapsed_ms, r.assets_inserted, r.assets_existing, r.assets_deleted_carried,
            r.deleted_conflicts, r.duplicate_h2_rows, r.ai_written, r.ai_skipped_existing,
            r.ai_skipped_thin, r.drawing_type_dropped, r.gorsel_turu_written, r.tags_written,
            r.favorites_written, r.collections_created, r.collection_items_written,
            r.project_meta_written, r.project_meta_skipped_existing, r.roots_added,
            r.groups_created, r.root_tags_written, r.thumbnails_carried, r.thumbnails_invalid,
            r.unparsable_times, r.errors.len(), r.dropped_errors
        );
        for (what, detail) in r.errors.iter().take(5) {
            println!("    HATA {what}: {detail}");
        }
    };

    // ② KURU KOSU
    let dry = archivist_h2import::dry_run(&h3, &src, &opts, DRAWING_TYPES, now, |_| {})
        .expect("kuru kosu");
    dump("KURU KOSU", &dry);

    // ③ UYGULA
    let live = archivist_h2import::apply(&mut h3, &src, &opts, DRAWING_TYPES, now, |p| {
        if p.done % 1000 == 0 {
            eprintln!("  [{}] {}/{}", p.stage, p.done, p.total);
        }
    })
    .expect("uygula");
    dump("UYGULA", &live);

    // SIMETRI kontrolu (kuru kosu = uygula).
    assert_eq!(dry.assets_inserted, live.assets_inserted, "SIMETRI KIRILDI: inserted");
    assert_eq!(dry.ai_written, live.ai_written, "SIMETRI KIRILDI: ai");
    assert_eq!(dry.thumbnails_carried, live.thumbnails_carried, "SIMETRI KIRILDI: thumb");

    // ④ IDEMPOTENCY: ikinci uygula tum sayaclar 0.
    let second = archivist_h2import::apply(&mut h3, &src, &opts, DRAWING_TYPES, now, |_| {})
        .expect("ikinci uygula");
    dump("IKINCI UYGULA (idempotency)", &second);
    assert_eq!(second.assets_inserted, 0, "IDEMPOTENCY KIRILDI: yeni satir");
    assert_eq!(second.ai_written, 0, "IDEMPOTENCY KIRILDI: AI");
    assert_eq!(second.tags_written, 0, "IDEMPOTENCY KIRILDI: etiket");
    assert_eq!(second.thumbnails_carried, 0, "IDEMPOTENCY KIRILDI: thumb");

    println!("\nSONUC: duman testi GECTI. Hedef: {}", h3_path.display());
}
