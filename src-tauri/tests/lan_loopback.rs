//! UCTAN UCA LOOPBACK TESTI — LAN Faz 1+2'nin TAM zinciri, TEK makinede.
//!
//! Bu test, birim testlerinin ATLADIGI seyi olcer: birim testlerinde sorgu kaynagi SAHTEYDI
//! (sabit JSON donuyordu). Burada zincirin HER HALKASI GERCEK:
//!
//!   gercek DB dosyasi (diskte, seed'li)
//!     → gercek `query_assets_json` (ListOpts ayristirma + `list_assets` + serilestirme)
//!       → gercek `archivist-server` (HTTP + auth + metot/hiz kapilari)
//!         → gercek `http_list_assets` istemcisi (kodlama + ureq + sekil dogrulama)
//!           → donen `AssetPage`
//!
//! ⚠️ **GUI'nin YERINI TUTMAZ.** Kanitladigi: tel zinciri calisiyor. Kanitlamadigi: kaynak
//! degistirici goruntusu, facet/detay panelinin gizlenmesi, hata mesajlarinin ekranda okunusu.
//! Onlar canli testte surulur (bkz `docs/design/LAN_ARCHIVE_READ.md` §12).
//!
//! Bu makinede kosar: `cargo test --manifest-path C:\Arsiv-H3\Cargo.toml -p archivist --test lan_loopback`

use std::sync::Arc;

use archivist_server::{ArchiveApi, AssetQueryFn, NotificationFn, ServerConfig, ServerHandle};

/// Gercek bir DB dosyasi olustur + seed'le. `open_readonly` bir YOL ister → bellek-ici olmaz.
fn seed_db_file(dir: &std::path::Path) -> std::path::PathBuf {
    let path = dir.join("loopback.db");
    let mut db = archivist_db::Db::open_and_migrate(&path).expect("DB acilmali");
    let mut seed = |p: &str, name: &str, ext: &str, title: &str, body: &str, t: i64| {
        let asset = archivist_db::AssetInput {
            path: p,
            file_name: name,
            ext: Some(ext),
            size_bytes: 100,
            content_hash: Some("h"),
            mime: None,
            title: Some(title),
            description: None,
            created_at: t,
            modified_at: t,
        };
        let data = archivist_db::IngestData {
            fts_body: Some(body),
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: None,
        };
        db.ingest(&asset, &data).expect("ingest");
    };
    seed("/a/1.pdf", "1.pdf", "pdf", "Villa Projesi", "villa salon metni", 100);
    seed("/a/2.dwg", "2.dwg", "dwg", "Ofis Plani", "ofis kat metni", 200);
    seed("/a/3.pdf", "3.pdf", "pdf", "Kule", "kule yapisi metni", 300);
    seed("/a/4.dwg", "4.dwg", "dwg", "Villa Bahce", "villa bahce metni", 400);
    path
}

/// Faz 3 icin seed: ayni 4 asset, ama `1.pdf`'e GERCEK bir thumbnail satiri eklenir.
/// (Ayri yardimci — Faz 1/2 testlerinin seed'i degismesin.)
fn seed_db_file_with_thumbs(dir: &std::path::Path) -> std::path::PathBuf {
    let path = seed_db_file(dir);
    let mut db = archivist_db::Db::open_and_migrate(&path).expect("DB acilmali");
    let page = db.list_assets(&Default::default()).expect("liste");
    let target = page.items.iter().find(|a| a.file_name == "1.pdf").expect("1.pdf").clone();
    // Ayni yolu yeniden ingest etmek satiri GUNCELLER (upsert) → thumbnail eklenir.
    db.ingest(
        &archivist_db::AssetInput {
            path: &target.path,
            file_name: &target.file_name,
            ext: target.ext.as_deref(),
            size_bytes: target.size_bytes,
            content_hash: Some("h"),
            mime: None,
            title: target.title.as_deref(),
            description: None,
            created_at: target.created_at,
            modified_at: target.modified_at,
        },
        &archivist_db::IngestData {
            fts_body: Some("villa salon metni"),
            metadata: &[],
            auto_tags: &[],
            phash: None,
            thumbnail: Some(archivist_db::ThumbnailInput {
                mime: "image/jpeg",
                width: 8,
                height: 8,
                // Gercek bayt olmasi sart degil; onemli olan satirin var olmasi ve
                // base64 kodlamasindan gecip istemciye dolu gelmesi.
                bytes: &[0xFF, 0xD8, 0xFF, 0xDB, 0x00, 0x01],
            }),
        },
    )
    .expect("thumbnail ingest");
    path
}

/// Host'u GERCEK kaynaklarla ayaga kaldir (src-tauri'nin uretimde kurdugu closure'larin AYNISI).
/// Faz 5: rag/semantic/stats closure'lari da uretimdeki gibi (paylasilan lazy embedder Arc'i).
fn start_real_host(port: u16, db_path: std::path::PathBuf) -> ServerHandle {
    let notif: NotificationFn = Arc::new(|_since, _limit| Ok(vec![]));
    let open = move |p: std::path::PathBuf| {
        archivist_db::Db::open_readonly(&p)
            .map_err(|e| archivist_server::QueryError::Internal(e.to_string()))
    };
    let (p1, p2, p3, p4, p5, p6, p7) = (
        db_path.clone(),
        db_path.clone(),
        db_path.clone(),
        db_path.clone(),
        db_path.clone(),
        db_path.clone(),
        db_path,
    );
    let o1 = open;
    // Paylasilan embedder (uretimdeki AppState.embedder gibi; lazy → ilk rag/semantic isteginde yuklenir).
    let embedder: archivist_lib::SharedEmbedder = Arc::new(std::sync::Mutex::new(None));
    let rag_emb = embedder.clone();
    let sem_emb = embedder;
    let assets: AssetQueryFn =
        Arc::new(move |opts_json: &str| archivist_lib::lan_query_assets_json(&o1(p1.clone())?, opts_json));
    let detail: archivist_server::AssetDetailFn =
        Arc::new(move |id| archivist_lib::lan_query_asset_detail_json(&o1(p2.clone())?, id));
    let thumbs: archivist_server::ThumbQueryFn =
        Arc::new(move |ids| archivist_lib::lan_query_thumbs_json(&o1(p3.clone())?, ids));
    let folders: archivist_server::FolderQueryFn =
        Arc::new(move || archivist_lib::lan_query_folders_json(&o1(p4.clone())?));
    let rag: archivist_server::RagRetrieveFn =
        Arc::new(move |req_json| archivist_lib::lan_query_rag_json(&o1(p5.clone())?, &rag_emb, req_json));
    let semantic: archivist_server::SemanticQueryFn =
        Arc::new(move |opts_json| archivist_lib::lan_query_semantic_json(&o1(p6.clone())?, &sem_emb, opts_json));
    let stats: archivist_server::StatsQueryFn =
        Arc::new(move || archivist_lib::lan_query_stats_json(&o1(p7.clone())?));
    ServerHandle::start(
        ServerConfig {
            port,
            app_version: "loopback".into(),
            notifications: notif,
            archive: ArchiveApi { assets, detail, thumbs, folders, rag, semantic, stats },
        },
        Some("11112222".to_string()),
    )
    .expect("host baslamali")
}

/// Uzak semantik/RAG testleri host embedder'i gerektirir → modeli COZ. Bulunursa
/// `ARSIV_EMBED_MODEL_DIR`'i AYARLA (host `resolve_model_dir` bunu ILK aday yapar) + true; yoksa
/// false → cagiran test guard-skip eder (modelsiz makinede suite yesil kalir; #[ignore] degil ki
/// modelli makinede GERCEKTEN kossun). Env process-global; ayni yola set → paralel testlerde guvenli.
fn ensure_test_model() -> bool {
    use std::path::PathBuf;
    const NAME: &str = "paraphrase-multilingual-MiniLM-L12-v2";
    if let Some(d) = std::env::var_os("ARSIV_EMBED_MODEL_DIR") {
        if PathBuf::from(&d).join("tokenizer.json").exists() {
            return true;
        }
    }
    for base in [
        r"C:\Arsiv-H2\ArchivistPro\public\models\Xenova",
        r"C:\Arsiv-H2\public\models\Xenova",
    ] {
        let c = PathBuf::from(base).join(NAME);
        if c.join("tokenizer.json").exists() {
            std::env::set_var("ARSIV_EMBED_MODEL_DIR", &c);
            return true;
        }
    }
    false
}

/// Faz 5 RAG seed: temel 4 asset + `2.dwg`'e "merdiven" gecen GERCEK bir RAG chunk'i (dummy 384
/// vektor; FTS anahtar-kelime eslesmesi retrieval'i tetikler → vektor benzerligi sart degil).
fn seed_db_file_with_chunks(dir: &std::path::Path) -> std::path::PathBuf {
    let path = seed_db_file(dir);
    let db = archivist_db::Db::open_and_migrate(&path).expect("DB acilmali");
    let page = db.list_assets(&Default::default()).expect("liste");
    let target = page.items.iter().find(|a| a.file_name == "2.dwg").expect("2.dwg").id;
    let mut emb = vec![0f32; 384];
    emb[0] = 1.0;
    db.set_asset_chunks(
        target,
        &[archivist_db::ChunkWrite {
            chunk_index: 0,
            page: Some(3),
            text: "merdiven detayi 1/20 olcekli ofis kat plani".into(),
            embedding: emb,
        }],
    )
    .expect("chunk yazilmali");
    path
}

/// Faz 5 semantik seed: temel 4 asset'in HER birine 384-boyut dummy vektor (kNN aday havuzu dolsun).
fn seed_db_file_with_vectors(dir: &std::path::Path) -> std::path::PathBuf {
    let path = seed_db_file(dir);
    let db = archivist_db::Db::open_and_migrate(&path).expect("DB acilmali");
    let page = db.list_assets(&Default::default()).expect("liste");
    for (i, a) in page.items.iter().enumerate() {
        let mut v = vec![0f32; 384];
        v[i % 384] = 1.0;
        db.set_vector(a.id, &v).expect("vektor yazilmali");
    }
    path
}

/// LAN Faz 5 — uzak RAG retrieval, GERCEK DB + GERCEK host embedder ile. Host embed+retrieve
/// KENDI yapar (indeksi ONCEDEN insa etti); istemci `{chunks, diag}` alir (LLM uretimi burada YOK).
#[test]
fn uzak_rag_retrieval_gercek_db_ile_chunk_doner() {
    if !ensure_test_model() {
        eprintln!("[atlandi] embedding modeli bulunamadi — uzak RAG pozitif yolu skip");
        return;
    }
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file_with_chunks(dir.path());
    let port = 19496;
    let handle = start_real_host(port, db_path);

    let req = r#"{"question":"merdiven hangi dosyada","scope":{"kind":"all"},"options":{}}"#;
    let v = archivist_lib::lan_remote_rag_retrieve("127.0.0.1", port, "11112222", req)
        .expect("uzak RAG retrieval basarili olmali");
    let chunks = v["chunks"].as_array().expect("chunks dizisi");
    assert!(!chunks.is_empty(), "'merdiven' chunk'i host'tan donmeli: {v}");
    assert!(
        chunks.iter().any(|c| c["text"].as_str().unwrap_or("").contains("merdiven")),
        "donen chunk 'merdiven' icermeli"
    );
    // Chunk tel-sekli (istemci build_prompt icin okur): fileName + chunkId + score (camelCase).
    assert!(chunks[0]["fileName"].is_string(), "chunk fileName tasimali");
    assert!(chunks[0]["score"].is_number(), "chunk score tasimali");
    assert!(v["diag"].is_object(), "retrieval tani (diag) donmeli");
    handle.stop();
}

/// LAN Faz 5 — uzak semantik (vektor) arama, GERCEK DB + host embedder ile → `AssetPage` (skorlu).
#[test]
fn uzak_semantik_gercek_db_ile_assetpage_doner() {
    if !ensure_test_model() {
        eprintln!("[atlandi] embedding modeli bulunamadi — uzak semantik pozitif yolu skip");
        return;
    }
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file_with_vectors(dir.path());
    let port = 19497;
    let handle = start_real_host(port, db_path);

    let opts = r#"{"query":"ofis kat plani","page_size":10}"#;
    let v = archivist_lib::lan_remote_semantic_search("127.0.0.1", port, "11112222", opts)
        .expect("uzak semantik arama basarili olmali");
    assert!(v["total"].is_i64(), "AssetPage.total gelmeli: {v}");
    let items = v["items"].as_array().expect("items dizisi");
    assert!(!items.is_empty(), "vektorlu asset donmeli");
    // Skor tel-sozlesmesi (koordinator eklemesi): semantik yol her item'a `score` (cosine) isler.
    assert!(items[0]["score"].is_number(), "semantik item `score` (benzerlik) tasimali: {}", items[0]);
    // AssetRow snake_case (grid ile AYNI sekil; `/assets` ile birebir) → `file_name`.
    assert!(items[0]["file_name"].is_string(), "item file_name gelmeli (grid ile ayni sekil)");
    handle.stop();
}

/// LAN Faz 5 — uzak indeks/sayac ozeti (GIRDISIZ). Model GEREKMEZ (yalniz sayimlar + model_ready).
#[test]
fn uzak_stats_gercek_db_ile_sayac_doner() {
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file_with_chunks(dir.path()); // 4 asset + 1 chunk
    let port = 19498;
    let handle = start_real_host(port, db_path);

    let stats = archivist_lib::lan_remote_stats("127.0.0.1", port, "11112222").expect("stats donmeli");
    assert_eq!(stats.asset_count, 4, "seed'lenen 4 asset");
    assert!(stats.chunk_count >= 1, "en az 1 chunk sayilmali");
    assert!(stats.folder_count >= 1, "en az 1 klasor");
    assert_eq!(stats.chunked_assets, 1, "chunk'i olan tek asset");
    handle.stop();
}

/// 🔒 LAN Faz 5 TIPLI HATA — host RAG indeksi YOKKEN 503 → istemci `remote_not_indexed` (500 DEGIL).
/// Sabotaj hedefi acik: query_rag_json'daki chunk_count/model kapisi kalkarsa bu iddia duser
/// (istemci "sunucu hatasi"ni "indeks yok"tan ayirt EDEMEZ olur).
#[test]
fn uzak_rag_host_indekssizken_tipli_hata_doner() {
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file(dir.path()); // hic chunk YOK
    let port = 19500;
    let handle = start_real_host(port, db_path);

    let req = r#"{"question":"merdiven","scope":{"kind":"all"},"options":{}}"#;
    let err = archivist_lib::lan_remote_rag_retrieve("127.0.0.1", port, "11112222", req)
        .expect_err("indekssiz host tipli hata vermeli");
    assert_eq!(err, "remote_not_indexed", "503 → tipli token (bad_response/query DEGIL): {err}");
    handle.stop();
}

#[test]
fn tam_zincir_gercek_db_ile_calisir() {
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file(dir.path());
    let port = 19491;
    let handle = start_real_host(port, db_path);

    // ── 1. Bos opts → tum arsiv (varsayilan sayfa) ───────────────────────────────────────
    let page = archivist_lib::lan_remote_list_assets("127.0.0.1", port, "11112222", "{}")
        .expect("bos opts calismali");
    assert_eq!(page["total"], 4, "seed'lenen 4 asset");
    assert_eq!(page["items"].as_array().unwrap().len(), 4);
    // AssetRow alanlari telden GECMIS olmali (grid bunlari okur).
    let first = &page["items"][0];
    assert!(first["file_name"].is_string(), "file_name gelmeli: {first}");
    assert!(first["id"].is_i64(), "id gelmeli");

    // ── 2. FTS: arama AYRI UC DEGIL, ayni `/assets` (Faz 1'in tasarim sapmasi) ────────────
    let page =
        archivist_lib::lan_remote_list_assets("127.0.0.1", port, "11112222", r#"{"query":"villa"}"#)
            .expect("FTS calismali");
    assert_eq!(page["total"], 2, "'villa' 2 kayitta geciyor");

    // ── 3. Facet filtresi telden gecer ───────────────────────────────────────────────────
    let page =
        archivist_lib::lan_remote_list_assets("127.0.0.1", port, "11112222", r#"{"ext":["dwg"]}"#)
            .expect("filtre calismali");
    assert_eq!(page["total"], 2, "2 dwg");

    // ── 4. Sayfalama: `total` TUM eslesme, `items` yalniz o sayfa ────────────────────────
    let page = archivist_lib::lan_remote_list_assets(
        "127.0.0.1",
        port,
        "11112222",
        r#"{"page":0,"page_size":2}"#,
    )
    .expect("sayfalama calismali");
    assert_eq!(page["total"], 4, "total tum eslesme");
    assert_eq!(page["items"].as_array().unwrap().len(), 2, "sayfa boyu 2");

    // ── 5. UTF-8 sorgu bozulmadan gidiyor (kodlama/cozme zinciri) ────────────────────────
    // Sonuc 0 olmali ama HATA olmamali: Turkce karakter tasiyan sorgu tel boyunca saglam gecti.
    let page = archivist_lib::lan_remote_list_assets(
        "127.0.0.1",
        port,
        "11112222",
        r#"{"query":"Fotoğraf ölçü"}"#,
    )
    .expect("UTF-8 sorgu HATA vermemeli");
    assert_eq!(page["total"], 0, "eslesme yok ama zincir saglam");

    handle.stop();
}

/// LAN Faz 3 — detay + kucuk resim uclari, GERCEK DB ile uctan uca.
#[test]
fn detay_ve_thumbnail_uclari_gercek_db_ile_calisir() {
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file_with_thumbs(dir.path());
    let port = 19493;
    let handle = start_real_host(port, db_path.clone());

    // Listeden gercek id'leri al (id'leri varsayma — DB ne verdiyse o).
    let page = archivist_lib::lan_remote_list_assets("127.0.0.1", port, "11112222", "{}").unwrap();
    let items = page["items"].as_array().unwrap().clone();
    let id0 = items[0]["id"].as_i64().unwrap();
    let name0 = items[0]["file_name"].as_str().unwrap().to_string();

    // ── Detay: yerel `AssetDetail` sekli (panel bunu okur) ──────────────────────────────
    let detail = archivist_lib::lan_remote_get_asset("127.0.0.1", port, "11112222", id0)
        .expect("detay cagrisi basarili")
        .expect("asset var");
    assert_eq!(detail["asset"]["file_name"], name0.as_str(), "detay dogru asset'i getirdi");
    assert!(detail["tags"].is_array(), "etiketler alani gelmeli");
    assert!(detail["metadata"].is_array(), "metadata alani gelmeli");
    assert!(detail["collections"].is_array(), "koleksiyonlar alani gelmeli");

    // Olmayan id → 404 → None (hata DEGIL).
    let missing = archivist_lib::lan_remote_get_asset("127.0.0.1", port, "11112222", 999_999)
        .expect("404 hata olmamali");
    assert!(missing.is_none(), "olmayan asset → None");

    // ── Kucuk resimler: BATCH, yerel IPC ile ayni sekil ─────────────────────────────────
    // ⚠️ Thumbnail YALNIZ `1.pdf`'te var; listenin ilk ogesi o DEGIL (varsayilan siralama
    // id'ye gore degil) → id'yi ada gore bul, siraya guvenme.
    let thumb_owner_id = items
        .iter()
        .find(|i| i["file_name"] == "1.pdf")
        .and_then(|i| i["id"].as_i64())
        .expect("1.pdf listede olmali");
    let all_ids: Vec<i64> = items.iter().map(|i| i["id"].as_i64().unwrap()).collect();
    let thumbs = archivist_lib::lan_remote_thumbs("127.0.0.1", port, "11112222", &all_ids).unwrap();
    let arr = thumbs.as_array().expect("dizi");
    assert_eq!(arr.len(), 1, "yalniz thumbnail'i OLAN asset doner");
    assert_eq!(arr[0]["asset_id"], thumb_owner_id);
    assert_eq!(arr[0]["mime"], "image/jpeg");
    assert!(
        arr[0]["data_base64"].as_str().is_some_and(|s| !s.is_empty()),
        "base64 govde dolu olmali"
    );

    // Bos id listesi → bos dizi (ag'a cikmadan).
    let empty = archivist_lib::lan_remote_thumbs("127.0.0.1", port, "11112222", &[]).unwrap();
    assert!(empty.as_array().unwrap().is_empty());

    handle.stop();
}

/// 🔒 LAN Faz 3 GUVENLIK — cope atilmis asset uzaktan OKUNAMAZ (ne detay ne onizleme).
///
/// Bu testin sabotaj hedefi acik: `active_asset_ids` suzgeci kaldirilirsa thumbnail iddiasi
/// duser; `get_asset`'in `deleted_at` guard'i kalkarsa detay iddiasi duser.
#[test]
fn copteki_asset_uzaktan_sizmaz() {
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file_with_thumbs(dir.path());
    let port = 19494;

    // Thumbnail'i OLAN asset'i cope at (sizinti riski en yuksek olan).
    let trashed_id = {
        let mut db = archivist_db::Db::open_and_migrate(&db_path).unwrap();
        let page = db.list_assets(&Default::default()).unwrap();
        let id = page.items.iter().find(|a| a.file_name == "1.pdf").unwrap().id;
        assert_eq!(db.soft_delete(&[id]).unwrap(), 1, "cope atilmali");
        id
    };

    let handle = start_real_host(port, db_path);

    // Detay: 404 → None (var ama cop'te ⇒ yok sayilir).
    let detail = archivist_lib::lan_remote_get_asset("127.0.0.1", port, "11112222", trashed_id)
        .expect("cagri basarili");
    assert!(detail.is_none(), "cop'teki asset'in DETAYI uzaktan gelmemeli");

    // Onizleme: id acikca istense bile bos doner (thumbnail satiri DB'de HALA duruyor —
    // `asset_thumbnails` soft-delete'te silinmez; koruma yalnizca suzgecten geliyor).
    let thumbs =
        archivist_lib::lan_remote_thumbs("127.0.0.1", port, "11112222", &[trashed_id]).unwrap();
    assert!(
        thumbs.as_array().unwrap().is_empty(),
        "cop'teki asset'in ONIZLEMESI uzaktan gelmemeli"
    );

    // Listede de gorunmemeli (mevcut `deleted_at` filtresi — regresyon agi).
    let page = archivist_lib::lan_remote_list_assets("127.0.0.1", port, "11112222", "{}").unwrap();
    assert_eq!(page["total"], 3, "cop'teki asset listede yok");

    handle.stop();
}

/// LAN Faz 4 — klasor ozeti ucu, GERCEK DB ile uctan uca. Seed'deki 4 asset de `/a/` altinda
/// ⇒ tek ust-dizin, 4 dosya. (Girdisiz uc: istemci hicbir yol/id gondermez.)
#[test]
fn klasor_ozeti_gercek_db_ile_calisir() {
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file(dir.path());
    let port = 19495;
    let handle = start_real_host(port, db_path);

    let folders = archivist_lib::lan_remote_folders("127.0.0.1", port, "11112222")
        .expect("klasor ozeti calismali");
    let arr = folders.as_array().expect("dizi");
    assert_eq!(arr.len(), 1, "tek ust-dizin (/a)");
    assert_eq!(arr[0]["file_count"], 4, "klasorde 4 dosya");
    assert!(
        arr[0]["path"].as_str().is_some_and(|p| p.contains("/a")),
        "yol /a icermeli: {arr:?}"
    );

    handle.stop();
}

#[test]
fn yanlis_kod_gercek_db_ile_de_reddedilir() {
    // Yetki kapisi sahte closure'a degil, GERCEK sunucuya karsi da tutmali.
    let dir = tempfile::tempdir().expect("temp dir");
    let db_path = seed_db_file(dir.path());
    let port = 19492;
    let handle = start_real_host(port, db_path);

    let err = archivist_lib::lan_remote_list_assets("127.0.0.1", port, "00000000", "{}")
        .expect_err("yanlis kod reddedilmeli");
    assert_eq!(err, "auth_failed", "401 → tipli token");

    handle.stop();
}
