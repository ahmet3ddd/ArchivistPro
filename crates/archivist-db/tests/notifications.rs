//! LAN bildirimleri (0025) veri katmani testleri — ekleme + `since` (id imleci) poll.

use archivist_db::Db;

fn db() -> Db {
    Db::open_in_memory_migrated().expect("migrate")
}

#[test]
fn ekle_ve_since_ile_poll() {
    let db = db();
    let id1 = db.add_notification("index", "42 yeni cizim indekslendi", Some("H:\\proje")).unwrap();
    let id2 = db.add_notification("info", "Yeni surum", None).unwrap();
    let id3 = db.add_notification("project", "X projesi eklendi", None).unwrap();
    assert!(id1 < id2 && id2 < id3, "id kesin artan (poll imleci)");

    // since=0 -> hepsi, artan id.
    let all = db.notifications_since(0, 0).unwrap();
    assert_eq!(all.len(), 3);
    assert_eq!(all[0].id, id1);
    assert_eq!(all[0].kind, "index");
    assert_eq!(all[0].title, "42 yeni cizim indekslendi");
    assert_eq!(all[0].body.as_deref(), Some("H:\\proje"));
    assert_eq!(all[1].body, None, "body opsiyonel");

    // since=id2 -> yalniz id3 (imlecten YENI olanlar).
    let after = db.notifications_since(id2, 0).unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, id3);

    // since=son -> bos (yeni yok).
    assert!(db.notifications_since(id3, 0).unwrap().is_empty());

    assert_eq!(db.clear_notifications().unwrap(), 3);
    assert!(db.notifications_since(0, 0).unwrap().is_empty());
    assert_eq!(db.clear_notifications().unwrap(), 0);
}

#[test]
fn limit_uygulanir() {
    let db = db();
    for i in 0..10 {
        db.add_notification("info", &format!("b{i}"), None).unwrap();
    }
    let page = db.notifications_since(0, 3).unwrap();
    assert_eq!(page.len(), 3, "limit=3");
    // Baglanti-duzeyi serbest fonksiyon da ayni sonucu vermeli (sunucu bunu kullanir).
    let via_conn = archivist_db::notifications::list_since(db.connection(), 0, 3).unwrap();
    assert_eq!(via_conn.len(), 3);
    assert_eq!(via_conn[0].id, page[0].id);
}
