//! Faz 7.3 "Dashboard" gorunumu veri katmani testleri: `dashboard_stats` (toplam sayi/
//! boyut + uzanti dagilimi + son-12-ay zaman serisi). Renderer toplamaz → DB dogru
//! topluyor mu, burada dogrulanir.
//!
//! Zaman pencereleri "now"a baglidir; testler determinist olsun diye `modified_at`
//! degerleri o anki zamandan TURETILIR (pencere icine garanti dusen / disinda kalan
//! degerler) ve beklenen ay etiketi SQLite'in kendi `strftime`'iyle (kanonik) alinir —
//! Rust'ta takvim aritmetigi yeniden yazilmaz (kaymaya karsi).

use std::time::{SystemTime, UNIX_EPOCH};

use archivist_db::{AssetInput, AuditInput, Db, IngestData};
use rusqlite::params;

/// Su anki unix saniye (UTC). SQLite `strftime('%s','now')` ile ayni eksen.
fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("now").as_secs() as i64
}

/// Belirtilen boyut + modified_at ile minimal bir asset ingest et.
fn ingest_one(db: &mut Db, path: &str, ext: &str, size: i64, modified: i64) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: path,
            ext: Some(ext),
            size_bytes: size,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: modified,
            modified_at: modified,
        },
        &IngestData {
            fts_body: None,
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

/// Govde (assets_fts.body) DOLU asset ingest et — `indexed_assets` (metin-kapsam) testi icin.
fn ingest_body_one(db: &mut Db, path: &str, ext: &str, modified: i64, body: &str) -> i64 {
    db.ingest(
        &AssetInput {
            path,
            file_name: path,
            ext: Some(ext),
            size_bytes: 1,
            content_hash: None,
            mime: None,
            title: None,
            description: None,
            created_at: modified,
            modified_at: modified,
        },
        &IngestData {
            fts_body: Some(body),
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        },
    )
    .expect("ingest")
}

/// SQLite'in kanonik "YYYY-MM" cikisini al (verilen unix saniye icin) — testin
/// beklenen ay etiketini uretmek icin (Rust'ta takvim yeniden yazilmaz).
fn sqlite_month(db: &Db, secs: i64) -> String {
    db.connection()
        .query_row(
            "SELECT strftime('%Y-%m', ?1, 'unixepoch')",
            [secs],
            |r| r.get::<_, String>(0),
        )
        .expect("strftime")
}

/// Bos DB → her sey sifir/bos (panik yok).
#[test]
fn dashboard_empty_db_is_zeroed() {
    let db = Db::open_in_memory_migrated().unwrap();
    let stats = db.dashboard_stats(None).unwrap();
    assert_eq!(stats.total_assets, 0);
    assert_eq!(stats.total_size, 0, "bos DB → COALESCE(SUM)=0");
    assert!(stats.ext_counts.is_empty());
    assert!(stats.size_by_ext.is_empty());
    assert!(stats.month_counts.is_empty());
    assert!(stats.approval_counts.is_empty());
    assert_eq!(stats.active_projects, 0);
    assert_eq!(stats.indexed_assets, 0);
    assert!(stats.architectural_styles.is_empty());
    assert!(stats.material_groups.is_empty());

    // Aktivite ozeti de bos DB'de sifir/bos (panik yok).
    let act = db.activity_summary(7).unwrap();
    assert_eq!(act.total_ops, 0);
    assert!(act.top_users.is_empty());
    assert!(act.top_actions.is_empty());
}

/// Vision metadata'sindaki virgullu stil/malzeme listeleri asset bazinda tekil sayilir,
/// sayiya gore siralanir ve klasor kapsamina uyar.
#[test]
fn dashboard_ai_facets_are_counted_deduplicated_and_scoped() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    let a1 = ingest_one(&mut db, "/a/1.jpg", "jpg", 1, now);
    let a2 = ingest_one(&mut db, "/a/2.jpg", "jpg", 1, now);
    let b1 = ingest_one(&mut db, "/b/3.jpg", "jpg", 1, now);

    db.set_ai_metadata(a1, &[
        ("ai_mimari_stiller", "Modern, Modern, Minimalist".into()),
        ("ai_malzemeler", "Beton, Cam".into()),
    ]).unwrap();
    db.set_ai_metadata(a2, &[
        ("ai_mimari_stiller", "Modern".into()),
        ("ai_malzemeler", "Beton, Ahşap".into()),
    ]).unwrap();
    db.set_ai_metadata(b1, &[
        ("ai_mimari_stiller", "Osmanlı".into()),
        ("ai_malzemeler", "Taş".into()),
    ]).unwrap();

    let all = db.dashboard_stats(None).unwrap();
    assert_eq!(
        all.architectural_styles.iter().map(|f| (f.value.as_deref().unwrap(), f.count)).collect::<Vec<_>>(),
        vec![("Modern", 2), ("Minimalist", 1), ("Osmanlı", 1)]
    );
    assert_eq!(
        all.material_groups.iter().map(|f| (f.value.as_deref().unwrap(), f.count)).collect::<Vec<_>>(),
        vec![("Beton", 2), ("Ahşap", 1), ("Cam", 1), ("Taş", 1)]
    );

    let scoped = db.dashboard_stats(Some("/a")).unwrap();
    assert!(!scoped.architectural_styles.iter().any(|f| f.value.as_deref() == Some("Osmanlı")));
    assert!(!scoped.material_groups.iter().any(|f| f.value.as_deref() == Some("Taş")));
}

/// Toplam sayi/boyut + uzanti dagilimi (count azalan, dogru uzanti+sayi).
#[test]
fn dashboard_totals_and_ext_counts() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    // 3 pdf (10+20+30=60), 1 dwg (100), 1 txt (5) → toplam 5 asset, 165 bayt.
    ingest_one(&mut db, "/a/1.pdf", "pdf", 10, now);
    ingest_one(&mut db, "/a/2.pdf", "pdf", 20, now);
    ingest_one(&mut db, "/a/3.pdf", "pdf", 30, now);
    ingest_one(&mut db, "/a/4.dwg", "dwg", 100, now);
    ingest_one(&mut db, "/a/5.txt", "txt", 5, now);

    let stats = db.dashboard_stats(None).unwrap();
    assert_eq!(stats.total_assets, 5);
    assert_eq!(stats.total_size, 165, "10+20+30+100+5");

    // ext_counts: en cok pdf(3) ilk; toplam tum asset'ler.
    assert_eq!(stats.ext_counts[0].value.as_deref(), Some("pdf"));
    assert_eq!(stats.ext_counts[0].count, 3);
    assert_eq!(stats.ext_counts.len(), 3, "pdf/dwg/txt");
    assert_eq!(stats.ext_counts.iter().map(|f| f.count).sum::<i64>(), 5);
}

/// ext_counts ust siniri: 12'den fazla farkli uzanti → en cok 12 doner (kuyruk kesilir).
#[test]
fn dashboard_ext_counts_capped_at_12() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    // 15 farkli uzanti (ext00..ext14), her biri tek asset.
    for i in 0..15 {
        let path = format!("/a/{i}.ext{i:02}");
        let ext = format!("ext{i:02}");
        ingest_one(&mut db, &path, &ext, 1, now);
    }
    let stats = db.dashboard_stats(None).unwrap();
    assert_eq!(stats.ext_counts.len(), 12, "ust sinir 12");
    assert_eq!(stats.total_assets, 15, "toplam yine 15 (cap yalniz ext listesinde)");
}

/// month_counts: son-12-ay penceresi icindeki asset'ler dogru ay kovalarinda; pencere
/// disindaki (cok eski) asset kovalarda DEGIL (ama toplam sayida var); siralama artan.
#[test]
fn dashboard_month_counts_bucket_and_window() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    let day: i64 = 86_400;

    // Bu ay (now) 2 asset → kesin ayni takvim ayina duser.
    ingest_one(&mut db, "/m/now1.pdf", "pdf", 1, now);
    ingest_one(&mut db, "/m/now2.pdf", "pdf", 1, now);
    // ~40 ve ~70 gun once → genelde onceki takvim ay(lar)i, pencere ICINDE (12 ay).
    ingest_one(&mut db, "/m/prev1.pdf", "pdf", 1, now - 40 * day);
    ingest_one(&mut db, "/m/prev2.pdf", "pdf", 1, now - 70 * day);
    // ~2 yil once → pencere DISI: kovalarda gorunmez, ama toplam sayida var.
    let old = now - 730 * day;
    ingest_one(&mut db, "/m/old.pdf", "pdf", 1, old);

    let stats = db.dashboard_stats(None).unwrap();
    assert_eq!(stats.total_assets, 5, "eski asset toplam sayiya dahil");

    // Pencere-ici toplam = 4 (eski haric); kova sayilarinin toplami buna esit.
    let in_window: i64 = stats.month_counts.iter().map(|m| m.count).sum();
    assert_eq!(in_window, 4, "pencere-ici 4 asset (eski haric)");

    // Bu ayin kovasi (kanonik etiket) tam 2 olmali.
    let this_month = sqlite_month(&db, now);
    let cur = stats
        .month_counts
        .iter()
        .find(|m| m.month == this_month)
        .expect("bu ay kovasi olmali");
    assert_eq!(cur.count, 2, "bu ay 2 asset");

    // Eski ay (pencere disi) HICBIR kovada gorunmemeli.
    let old_month = sqlite_month(&db, old);
    assert!(
        !stats.month_counts.iter().any(|m| m.month == old_month),
        "pencere disi ay kovalarda olmamali"
    );

    // Etiketler "YYYY-MM" (7 karakter) ve ARTAN sirali.
    assert!(stats.month_counts.iter().all(|m| m.month.len() == 7));
    let sorted = {
        let mut v: Vec<&String> = stats.month_counts.iter().map(|m| &m.month).collect();
        v.sort();
        v
    };
    let actual: Vec<&String> = stats.month_counts.iter().map(|m| &m.month).collect();
    assert_eq!(actual, sorted, "aylar artan sirali olmali");
}

/// dashboard_stats `path_prefix`: verilince TUM sayimlar (toplam sayi/boyut + ext + ay
/// serisi) o klasor altina daraltilir (alt-dizin on-ek eslesmesiyle dahil); `None` → global
/// (geriye-uyumlu). Eslesmeyen on-ek → sifir (panik yok).
#[test]
fn dashboard_stats_scoped_by_path_prefix() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    // /a: 2 pdf (10+20=30, biri alt-dizinde). /b: 1 dwg (100).
    ingest_one(&mut db, "/a/1.pdf", "pdf", 10, now);
    ingest_one(&mut db, "/a/sub/2.pdf", "pdf", 20, now);
    ingest_one(&mut db, "/b/3.dwg", "dwg", 100, now);

    // Global (None) → 3 asset, 130 bayt (mevcut davranis korunur).
    let all = db.dashboard_stats(None).unwrap();
    assert_eq!(all.total_assets, 3);
    assert_eq!(all.total_size, 130);

    // Prefix "/a" → yalniz 2 pdf (alt-dizin dahil), 30 bayt; ext yalniz pdf.
    let scoped = db.dashboard_stats(Some("/a")).unwrap();
    assert_eq!(scoped.total_assets, 2, "yalniz /a altindaki (alt-dizin dahil)");
    assert_eq!(scoped.total_size, 30, "10+20");
    assert_eq!(scoped.ext_counts.len(), 1, "yalniz pdf");
    assert_eq!(scoped.ext_counts[0].value.as_deref(), Some("pdf"));
    assert_eq!(scoped.ext_counts[0].count, 2);
    // Ay serisi de daraltilir: pencere-ici toplam = 2 (yalniz /a).
    assert_eq!(scoped.month_counts.iter().map(|m| m.count).sum::<i64>(), 2);

    // Eslesmeyen on-ek → sifir (bos gibi, panik yok).
    let none = db.dashboard_stats(Some("/yok")).unwrap();
    assert_eq!(none.total_assets, 0);
    assert_eq!(none.total_size, 0);
    assert!(none.ext_counts.is_empty());
    assert!(none.month_counts.is_empty());
    assert!(none.approval_counts.is_empty());
}

/// dashboard_stats `path_prefix` LIKE joker (`_` `%`) LITERAL eslesir (list_assets ile ayni
/// `escape_like_prefix`) → "/a_b" on-eki "/aXb"yi yanlislikla saymaz.
#[test]
fn dashboard_stats_prefix_escapes_wildcards() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    ingest_one(&mut db, "/a_b/1.pdf", "pdf", 10, now); // literal alt-cizgi
    ingest_one(&mut db, "/aXb/2.pdf", "pdf", 20, now); // joker eslesirse yanlislikla gelir

    let scoped = db.dashboard_stats(Some("/a_b")).unwrap();
    assert_eq!(scoped.total_assets, 1, "alt-cizgi literal (joker degil)");
    assert_eq!(scoped.total_size, 10);
}

/// Onay kuyrugu, silinmemis ve durum atanmis asset'leri kanonik oncelikte sayar;
/// path_prefix verildiginde diger dashboard istatistikleri gibi ayni kapsama daralir.
#[test]
fn dashboard_approval_queue_is_scoped_and_prioritized() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    let a_review = ingest_one(&mut db, "/a/review.pdf", "pdf", 1, now);
    let a_approved = ingest_one(&mut db, "/a/approved.pdf", "pdf", 1, now);
    let b_draft = ingest_one(&mut db, "/b/draft.pdf", "pdf", 1, now);
    let b_rejected = ingest_one(&mut db, "/b/rejected.pdf", "pdf", 1, now);
    ingest_one(&mut db, "/a/unset.pdf", "pdf", 1, now);

    let conn = db.connection();
    conn.execute(
        "UPDATE assets SET approval_status = ?1 WHERE id = ?2",
        params!["review", a_review],
    )
    .unwrap();
    conn.execute(
        "UPDATE assets SET approval_status = ?1 WHERE id = ?2",
        params!["approved", a_approved],
    )
    .unwrap();
    conn.execute(
        "UPDATE assets SET approval_status = ?1 WHERE id = ?2",
        params!["draft", b_draft],
    )
    .unwrap();
    conn.execute(
        "UPDATE assets SET approval_status = ?1 WHERE id = ?2",
        params!["rejected", b_rejected],
    )
    .unwrap();

    let all = db.dashboard_stats(None).unwrap();
    let all_statuses: Vec<(&str, i64)> = all
        .approval_counts
        .iter()
        .map(|f| (f.value.as_deref().unwrap(), f.count))
        .collect();
    assert_eq!(
        all_statuses,
        vec![("review", 1), ("draft", 1), ("rejected", 1), ("approved", 1)]
    );

    let scoped = db.dashboard_stats(Some("/a")).unwrap();
    let scoped_statuses: Vec<(&str, i64)> = scoped
        .approval_counts
        .iter()
        .map(|f| (f.value.as_deref().unwrap(), f.count))
        .collect();
    assert_eq!(scoped_statuses, vec![("review", 1), ("approved", 1)]);
}

/// size_by_ext: TOPLAM boyuta gore azalan (count degil) — tek buyuk dwg, cok kucuk pdf'in ustunde.
#[test]
fn dashboard_size_by_ext_ordered_by_total_size() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    // pdf 3 dosya toplam 60; dwg TEK dosya ama 100 (en buyuk); txt 5.
    ingest_one(&mut db, "/a/1.pdf", "pdf", 10, now);
    ingest_one(&mut db, "/a/2.pdf", "pdf", 20, now);
    ingest_one(&mut db, "/a/3.pdf", "pdf", 30, now);
    ingest_one(&mut db, "/a/4.dwg", "dwg", 100, now);
    ingest_one(&mut db, "/a/5.txt", "txt", 5, now);

    let stats = db.dashboard_stats(None).unwrap();
    let by: Vec<(&str, i64)> =
        stats.size_by_ext.iter().map(|e| (e.value.as_deref().unwrap(), e.size)).collect();
    // Boyuta gore: dwg(100) > pdf(60) > txt(5) — count sirasi (pdf ilk) DEGIL.
    assert_eq!(by, vec![("dwg", 100), ("pdf", 60), ("txt", 5)]);
}

/// size_by_ext ust siniri 8 (12 farkli uzanti → en buyuk 8 doner).
#[test]
fn dashboard_size_by_ext_capped_at_8() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    for i in 0..12 {
        let size = (i as i64 + 1) * 10; // ext11 en buyuk (120)
        ingest_one(&mut db, &format!("/a/{i}.ext{i:02}"), &format!("ext{i:02}"), size, now);
    }
    let stats = db.dashboard_stats(None).unwrap();
    assert_eq!(stats.size_by_ext.len(), 8, "boyut karti ust siniri 8");
    assert_eq!(stats.size_by_ext[0].size, 120, "en buyuk ilk");
}

/// active_projects: yalniz projeye ATANMIS aktif asset'lerdeki benzersiz proje; path_prefix daraltir.
#[test]
fn dashboard_active_projects_counts_distinct_assigned() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    let a1 = ingest_one(&mut db, "/a/1.pdf", "pdf", 1, now);
    let a2 = ingest_one(&mut db, "/a/2.pdf", "pdf", 1, now);
    let b1 = ingest_one(&mut db, "/b/1.pdf", "pdf", 1, now);
    let _unassigned = ingest_one(&mut db, "/a/3.pdf", "pdf", 1, now); // projesiz → sayilmaz

    let p1 = db.upsert_project_by_name("P1", now).unwrap();
    let p2 = db.upsert_project_by_name("P2", now).unwrap();
    db.assign_assets_to_project(&[a1, a2], Some(p1)).unwrap(); // 2 asset → 1 proje
    db.assign_assets_to_project(&[b1], Some(p2)).unwrap(); // 1 asset → 1 proje

    let all = db.dashboard_stats(None).unwrap();
    assert_eq!(all.active_projects, 2, "P1 + P2 (atanmamis sayilmaz)");
    // Kapsam /a → yalniz P1 (b1/P2 /b altinda).
    let scoped = db.dashboard_stats(Some("/a")).unwrap();
    assert_eq!(scoped.active_projects, 1, "yalniz /a altindaki projeye atanmis");
}

/// indexed_assets: yalniz govdesi (assets_fts.body) DOLU asset'ler (icerikten aranabilir) sayilir.
#[test]
fn dashboard_indexed_assets_counts_body_nonempty() {
    let mut db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    ingest_one(&mut db, "/a/1.pdf", "pdf", 1, now); // body YOK (metin cikmamis)
    ingest_body_one(&mut db, "/a/2.pdf", "pdf", now, "beton kolon detayi"); // body VAR
    ingest_body_one(&mut db, "/a/3.pdf", "pdf", now, "cephe plani"); // body VAR

    let stats = db.dashboard_stats(None).unwrap();
    assert_eq!(stats.total_assets, 3);
    assert_eq!(stats.indexed_assets, 2, "yalniz govdesi dolu 2 asset icerikten aranabilir");
}

/// activity_summary: son N gun penceresi + en aktif kullanici/islem siralamasi (H2 pariti).
/// Pencere disi kayit sayilmaz; siralama azalan; kullanici=username (audit snapshot).
#[test]
fn dashboard_activity_summary_window_and_top() {
    let db = Db::open_in_memory_migrated().unwrap();
    let now = now_secs();
    let day: i64 = 86_400;
    let rec = |ts: i64, user: &str, action: &str| {
        db.record_audit(&AuditInput {
            ts,
            user_id: 1,
            username: user,
            role: "admin",
            action,
            target_type: None,
            target_id: None,
            detail: None,
        })
        .unwrap();
    };
    // Pencere ICI (son 7 gun): admin 3 (ingest, ingest, trash), editor 1 (ingest).
    rec(now, "admin", "ingest");
    rec(now - day, "admin", "ingest");
    rec(now - 2 * day, "admin", "trash");
    rec(now - 3 * day, "editor", "ingest");
    // Pencere DISI (10 gun once) → sayilmamali.
    rec(now - 10 * day, "admin", "reset");

    let act = db.activity_summary(7).unwrap();
    assert_eq!(act.total_ops, 4, "pencere-ici 4 islem (10-gun-onceki haric)");
    // En aktif kullanici: admin(3) > editor(1).
    assert_eq!(act.top_users[0].name, "admin");
    assert_eq!(act.top_users[0].count, 3);
    assert_eq!(act.top_users[1].name, "editor");
    // En cok islem: ingest(3 = admin2+editor1) > trash(1); reset pencere disi → YOK.
    assert_eq!(act.top_actions[0].name, "ingest");
    assert_eq!(act.top_actions[0].count, 3);
    assert!(act.top_actions.iter().all(|a| a.name != "reset"), "pencere disi islem sayilmamali");
}
