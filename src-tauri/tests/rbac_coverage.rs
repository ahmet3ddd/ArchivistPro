//! **RBAC kapsam nobetcisi** — her `#[tauri::command]` ya bir yetki kapisi tasir ya da BILINCLI
//! olarak asagidaki listede gerekcesiyle yazilidir. Sessiz ucuncu sik YOKTUR.
//!
//! ## Neden bu test var (2026-07-26)
//! O gunku analizde 213 komutun yetki kapilari **ELLE** tarandi; sonuc temizdi (acik bulunmadi).
//! Ama elle dogrulama tam olarak projenin 2026-07-25'te bedelini odedigi sinif: bir kez bakilir,
//! "yesil" sanilir, sonraki degisiklikte kimse fark etmez. `rbac.rs`'in kendi birim testleri
//! kapi FONKSIYONLARININ dogru calistigini kanitlar; **kapinin BAGLI olup olmadigini kanitlamaz.**
//! Bu test o boslugu kapatir: 214. komut eklendiginde derleme degil ama test kirmizi olur.
//!
//! ## Nasil calisir
//! Kaynak-tarama testi (calisan uygulama/DB gerektirmez): `src-tauri/src/**/*.rs` okunur, her
//! `#[tauri::command]` fonksiyonunun govdesi ayiklanir ve icinde `rbac::` kapi cagrisi aranir.
//!
//! ## Neden "mutasyon" otomatik tespit EDILMIYOR
//! Denendi ve CURUDU: `state.db` (yazma baglantisi) kullanimi mutasyon sinyali DEGIL — 37 salt-okuma
//! komutu da onu kullaniyor (`chat_list_sessions`, `db_health`, `check_fixity`...). Ad-onekine
//! (`set_`/`delete_`…) dayanmak da kirilgan. Bu yuzden karar makineye birakilmaz: kapisiz her komut
//! **insan tarafindan siniflandirilir** ve gerekcesi bu dosyada durur. Test, siniflandirmanin
//! GUNCEL kalmasini zorlar.
//!
//! ## Liste iki yonlu dogrulanir (bayatlamasin)
//! 2026-07-25 dersi: sabit liste (`vec![27,28]`) yeni migration gelince sessizce bayatlamisti.
//! Burada ayni tuzaga dusmemek icin liste **iki yonde** denetlenir: (1) kapisiz her komut listede
//! olmali, (2) listedeki her kayit hala var VE hala kapisiz olmali. Bir komuta kapi eklenirse ya da
//! komut silinirse, kaydi listede birakmak testi KIRAR.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

// ── Gerekce kategorileri ─────────────────────────────────────────────────────

/// Salt-okuma: veri okur/rapor uretir, DB'ye ya da diske yazmaz. Her rol okuyabilir
/// (yetki modeli okumayi kisitlamaz; kisitlanan YAZMA'dir).
const READ_ONLY: &str = "salt-okuma; her rol okur";

/// Kimlik akisinin KENDISI — kapinin arkasina konamaz (oturum daha yok). Kendi ic korumasi var:
/// `setup_admin` yalniz `user_count == 0` iken calisir, `login` kimlik dogrular.
const AUTH_BOOTSTRAP: &str = "kimlik akisinin kendisi; kapi ONUN urunudur";

/// Iptal/durdurma yollari: kasten kilitsiz ve rolsuz. `cancel_ingest` DB'ye dokunmadan atomik
/// bayrak yazar (uzun ingest sirasinda kilit beklemesin diye) — kapi eklemek kacis kapisini kapatir.
const CANCEL: &str = "iptal/durdurma; kasten kilitsiz-rolsuz kacis kapisi";

/// Renderer hata raporu — crash.log'a satir ekler. Her rol kendi hatasini bildirebilmeli;
/// aksi hâlde viewer'da olusan hata sessizce kaybolur. Uzunluk kelepceleri komut icinde.
const CRASH_REPORT: &str = "hata bildirimi; her rol kendi crash'ini raporlayabilmeli";

/// Dosyayi/klasoru isletim sisteminde acar. Veri mutasyonu degil; goruntuleme eylemi.
const OS_OPEN: &str = "OS'ta acma/gosterme; veri mutasyonu degil";

/// Kullanicinin **kendi** kaydina self-servis erisimi — rol kapisi yerine DAHA DAR bir kapi var:
/// `change_password_inner` kimligi OTURUMDAN alir (istemci `user_id` secemez) ve eski parolayi
/// `verify_credentials` ile dogrular. Rol kapisi eklemek yanlis olurdu: her rol kendi parolasini
/// degistirebilmeli. `password_change` audit'e yazilir.
const SELF_SERVICE: &str = "kendi kaydi; kimlik oturumdan + eski parola dogrulanir";

/// Uygulamadan cikis — veri mutasyonu degil. Rol kapisi eklemek "viewer uygulamayi kapatamaz"
/// gibi anlamsiz bir sonuc verirdi. `quit_app` ayrica TEK temiz-cikis yolu (shutdown marker'ini
/// siler) → kisitlamak beklenmedik-kapanis yanlis-alarmi uretirdi.
const APP_LIFECYCLE: &str = "uygulama yasam dongusu; veri mutasyonu degil";

/// Sohbet: **ROL kapisi yok, SAHIPLIK kapisi var** (v31, migration 0031). Rol kapisi yanlis
/// olurdu — her rol kendi sohbetini yonetebilmeli. Bunun yerine her komut sahibi OTURUMDAN cozer
/// (`chat_commands::owner_id`) ve DB katmani tum sorgulari `user_id = ?` ile suzer.
///
/// *(Gecmis: 2026-07-26'ya kadar burada gercek bir acik vardi — modul "kisisel ozellik" diyordu
/// ama sema sahip tasimiyordu → cok-kullanicili arsivde herkes herkesin sohbetini gorur, yeniden
/// adlandirir ve KALICI silebilirdi. Kapatildi; regresyon kilidi `archivist-db/tests/chat.rs`
/// §v31 + asagidaki [`chat_commands_resolve_owner_from_session`].)*
const CHAT_OWNED: &str = "chat: rol degil SAHIPLIK kapisi (owner_id → oturumdan; DB user_id suzer)";

// ── Kapisiz komutlar (bilincli) ──────────────────────────────────────────────
//
// ⚠️ Buraya bir komut eklemek "kapi gerekmiyor" demektir. Once sunu sor: bu komut DB'ye, diske ya da
// ayara yaziyor mu? Yaziyorsa buraya DEGIL, `rbac::require_*` kapisina ihtiyaci var.

const UNGATED_BY_DESIGN: &[(&str, &str)] = &[
    // archive_commands.rs
    ("list_local_archives", READ_ONLY),
    // archive_share_commands.rs
    ("peek_archive_manifest", READ_ONLY),
    ("preview_extract_archive", READ_ONLY),
    ("preview_merge_archive", READ_ONLY),
    // assets.rs
    ("get_asset", READ_ONLY),
    ("get_thumbnails", READ_ONLY),
    ("list_assets", READ_ONLY),
    ("match_sources", READ_ONLY),
    ("prepare_media_source", READ_ONLY),
    // auth_commands.rs
    ("change_password", SELF_SERVICE),
    ("current_session", AUTH_BOOTSTRAP),
    ("login", AUTH_BOOTSTRAP),
    ("logout", AUTH_BOOTSTRAP),
    ("needs_setup", AUTH_BOOTSTRAP),
    ("setup_admin", AUTH_BOOTSTRAP),
    // chat_commands.rs — hepsi `owner_id` cagirmali; bkz chat_commands_resolve_owner_from_session
    ("chat_append_message", CHAT_OWNED),
    ("chat_create_session", CHAT_OWNED),
    ("chat_delete_session", CHAT_OWNED),
    ("chat_list_messages", CHAT_OWNED),
    ("chat_list_sessions", CHAT_OWNED),
    ("chat_list_trashed_sessions", CHAT_OWNED),
    ("chat_purge_session", CHAT_OWNED),
    ("chat_rename_session", CHAT_OWNED),
    ("chat_restore_session", CHAT_OWNED),
    ("chat_trash_count", CHAT_OWNED),
    ("export_chat_markdown", CHAT_OWNED),
    // crash_commands.rs
    ("quit_app", APP_LIFECYCLE),
    ("report_frontend_error", CRASH_REPORT),
    // curation.rs
    ("favorite_count", READ_ONLY),
    ("list_collections", READ_ONLY),
    // dedup_commands.rs
    ("find_duplicates", READ_ONLY),
    ("cancel_find_duplicates", CANCEL),
    // embed_commands.rs
    ("embed_status", READ_ONLY),
    ("semantic_search", READ_ONLY),
    // facets.rs
    ("approval_facets", READ_ONLY),
    ("client_facets", READ_ONLY),
    ("dashboard_stats", READ_ONLY),
    ("deadline_year_facets", READ_ONLY),
    ("ext_facets", READ_ONLY),
    ("folder_summary", READ_ONLY),
    ("gorsel_turu_facets", READ_ONLY),
    ("metadata_facets", READ_ONLY),
    ("tag_facets", READ_ONLY),
    ("version_facets", READ_ONLY),
    // folder_watcher.rs
    ("stop_all_watchers", CANCEL),
    ("watch_failures", READ_ONLY),
    // health.rs
    ("check_fixity", READ_ONLY),
    ("check_office_formats", READ_ONLY),
    ("check_staleness", READ_ONLY),
    ("db_health", READ_ONLY),
    // image_commands.rs
    ("assets_near_color", READ_ONLY),
    ("count_missing_dominant_colors", READ_ONLY),
    ("image_embed_status", READ_ONLY),
    ("image_search", READ_ONLY),
    ("similar_images", READ_ONLY),
    ("visual_search", READ_ONLY),
    // ingest.rs
    ("cancel_ingest", CANCEL),
    ("ingest_status", READ_ONLY),
    // legacy_h2.rs
    ("legacy_archive_status", READ_ONLY),
    // H2 aktarim aday listesi: salt-okuma kesif (yol/boyut/sayi; veri icerigi tasimaz).
    ("h2_import_candidates", READ_ONLY),
    // location.rs
    ("location_status", READ_ONLY),
    // rag_chat/mod.rs
    ("ai_status", READ_ONLY),
    ("auto_index_status", READ_ONLY),
    // Baslik onerisi: DB'ye/diske DOKUNMAZ (saf metin + opsiyonel Ollama cagrisi). Uretilen
    // baslik cagiran tarafindan `chat_rename_session` ile yazilir — YAZMA kapisi orada.
    ("chat_suggest_title", READ_ONLY),
    ("ollama_models", READ_ONLY),
    ("rag_chat", READ_ONLY),
    ("stop_rag_chat", CANCEL),
    // model_commands.rs
    ("model_status", READ_ONLY),
    // ollama_commands.rs
    ("detect_ollama", READ_ONLY),
    ("ollama_config", READ_ONLY),
    // open_commands.rs
    ("open_path_os", OS_OPEN),
    ("reveal_path_os", OS_OPEN),
    // project.rs
    ("list_approval_log", READ_ONLY),
    ("list_projects", READ_ONLY),
    // rag_commands.rs
    ("asset_chunks", READ_ONLY),
    ("rag_index_status", READ_ONLY),
    // recovery.rs
    ("recovery_status", READ_ONLY),
    // relation_commands.rs
    ("asset_relations", READ_ONLY),
    // remote_archive.rs — uzak (LAN) ana arsiv okumalari; yetki HOST tarafinda uygulanir
    ("geo_assets", READ_ONLY),
    ("version_timeline", READ_ONLY),
    ("remote_archive_status", READ_ONLY),
    ("remote_folder_summary", READ_ONLY),
    ("remote_get_asset", READ_ONLY),
    ("remote_list_assets", READ_ONLY),
    ("remote_rag_retrieve", READ_ONLY),
    ("remote_semantic_search", READ_ONLY),
    ("remote_stats", READ_ONLY),
    ("remote_thumbnails", READ_ONLY),
    // roots.rs
    ("folder_source_state", READ_ONLY),
    ("list_removed_roots", READ_ONLY),
    ("list_root_groups", READ_ONLY),
    ("list_scanned_roots", READ_ONLY),
    ("list_trashed_roots", READ_ONLY),
    // setup_check.rs
    ("setup_check", READ_ONLY),
    // shape_commands.rs
    ("extract_shape_from_image_bytes", READ_ONLY),
    ("search_shapes_by_features", READ_ONLY),
    ("search_shapes_by_similarity", READ_ONLY),
    ("search_shapes_composite", READ_ONLY),
    // trash.rs
    ("list_trash", READ_ONLY),
    ("trash_count", READ_ONLY),
    // vision_commands.rs
    ("count_pending_analysis", READ_ONLY),
    ("count_unusable_analyses", READ_ONLY),
    ("image_analysis_status", READ_ONLY),
    ("ollama_vision_models", READ_ONLY),
    ("recommend_vision_model", READ_ONLY),
    ("vision_run_state", READ_ONLY),
];

/// Kapi sayilan cagrilar. `current_role` tek basina yeter: rolu OKUMAK icin gecerli bir oturum
/// sart (`Forbidden` doner) → komut anonim cagriya kapalidir; hangi rolun gectigi komutun kendi
/// karari. **Not:** bu liste `rbac.rs`'teki `pub fn` kapilariyla senkron tutulur; oradaki
/// `only_admin_passes_require_admin` vb. testler kapilarin DOGRU calistigini ayrica kanitlar.
const GUARD_CALLS: &[&str] = &[
    "require_admin",
    "require_founder",
    "require_editor",
    "require_main_archive",
    "current_role",
];

/// Bulunmasi beklenen ASGARI komut sayisi. Tarayici bozulur/regex tutmazsa test sessizce
/// "0 kapisiz komut buldum" deyip YESIL gecerdi — bu esik o bos-gecisi imkansiz kilar.
const MIN_EXPECTED_COMMANDS: usize = 200;

// ── Kaynak tarayici ──────────────────────────────────────────────────────────

/// Bir `#[tauri::command]` fonksiyonu: adi + govdesi (suslu parantez ici).
struct Command {
    name: String,
    body: String,
    file: String,
}

/// `src-tauri/src` altindaki tum `.rs` dosyalari (alt dizinler dahil).
fn source_files() -> Vec<PathBuf> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    collect(&root, &mut out);
    out.sort();
    out
}

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let entries = fs::read_dir(dir).unwrap_or_else(|e| panic!("dizin okunamadi {dir:?}: {e}"));
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// Yorum ve string govdelerini BOSLUKLA maskele; **bayt uzunlugu korunur** (indeksler orijinal
/// kaynakla birebir ortusur → govdeyi orijinalden dilimleyebiliriz).
///
/// Neden gerekli: bu kod tabaninda `#[tauri::command]` metni doc-comment'lerin ICINDE de geciyor
/// (or. `commands/mod.rs`: "`#[tauri::command]` fonksiyonlari `State<'_, AppState>` aldigi icin…").
/// Maskesiz arama bunlari GERCEK oznitelik sanip komut olmayan yardimcilari (`test_state`,
/// `now_unix`, `parse_disposition`) komut diye raporluyordu — testin ilk kosusunda yakalandi.
/// Ayni maske suslu-parantez sayimini da guvenli kilar (`format!("{q}")`, `// }`).
///
/// Maskelenen: `//` satir yorumu, `/* */` blok yorumu (ic ice), `"..."` (kacisli),
/// `r"..."` / `r#"..."#` (istenen sayida `#`).
/// Maskelenmeyen: karakter literalleri — `'a` omur-etiketi (`State<'_, AppState>`) ile ayirt
/// etmek gerekirdi. Guvenli: bu agacta `'{'` / `'}'` literali YOK (0 eslesme, 2026-07-26).
fn mask_comments_and_strings(src: &str) -> String {
    let b = src.as_bytes();
    let mut out = b.to_vec();
    let mut i = 0usize;
    // `n` bayti bosluga cevir.
    let blank = |out: &mut Vec<u8>, from: usize, to: usize| {
        for x in out.iter_mut().take(to.min(b.len())).skip(from) {
            if *x != b'\n' {
                *x = b' '; // satir sonlari korunur (hata mesajlarinda satir sayimi bozulmasin)
            }
        }
    };

    while i < b.len() {
        // Satir yorumu
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'/' {
            let start = i;
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            blank(&mut out, start, i);
            continue;
        }
        // Blok yorumu (ic ice olabilir — Rust'ta gecerli)
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            let start = i;
            let mut nest = 1usize;
            i += 2;
            while i + 1 < b.len() && nest > 0 {
                if b[i] == b'/' && b[i + 1] == b'*' {
                    nest += 1;
                    i += 2;
                } else if b[i] == b'*' && b[i + 1] == b'/' {
                    nest -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            blank(&mut out, start, i);
            continue;
        }
        // Ham string: r"..." / r#"..."# / r##"..."## …
        if b[i] == b'r' && i + 1 < b.len() && (b[i + 1] == b'"' || b[i + 1] == b'#') {
            let mut j = i + 1;
            let mut hashes = 0usize;
            while j < b.len() && b[j] == b'#' {
                hashes += 1;
                j += 1;
            }
            if j < b.len() && b[j] == b'"' {
                let start = i;
                let mut k = j + 1;
                loop {
                    if k >= b.len() {
                        k = b.len();
                        break;
                    }
                    if b[k] == b'"' && b[k + 1..].iter().take(hashes).all(|c| *c == b'#') {
                        k = k + 1 + hashes;
                        break;
                    }
                    k += 1;
                }
                blank(&mut out, start, k);
                i = k;
                continue;
            }
            // `r` bir tanimlayicinin parcasiymis (or. `role`) → normal ilerle.
        }
        // Normal string
        if b[i] == b'"' {
            let start = i;
            i += 1;
            while i < b.len() && b[i] != b'"' {
                i += if b[i] == b'\\' { 2 } else { 1 };
            }
            i = (i + 1).min(b.len());
            blank(&mut out, start, i);
            continue;
        }
        i += 1;
    }
    String::from_utf8(out).expect("maskeleme yalniz ASCII bosluk yazar → UTF-8 bozulmaz")
}

/// `start` konumundaki `{`'ten baslayarak esleseni bulur. **Maskelenmis** metin uzerinde
/// calisir → string/yorum icindeki suslular zaten yok olmustur.
fn matching_brace(masked: &str, start: usize) -> Option<usize> {
    let b = masked.as_bytes();
    debug_assert_eq!(b[start], b'{');
    let mut depth = 0usize;
    for (i, ch) in b.iter().enumerate().skip(start) {
        match ch {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

/// Dosyadaki tum `#[tauri::command]` fonksiyonlarini ayikla.
fn commands_in(path: &Path) -> Vec<Command> {
    let src = fs::read_to_string(path).unwrap_or_else(|e| panic!("okunamadi {path:?}: {e}"));
    let masked = mask_comments_and_strings(&src);
    let file = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let mut out = Vec::new();
    let mut search_from = 0usize;

    // Arama MASKELENMIS metinde (yorum icindeki oznitelik metnine takilmamak icin);
    // govde ise ayni indekslerle ORIJINALDEN dilimlenir.
    // ⚠️ `]` ARANMAZ: oznitelik `#[tauri::command]` da olabilir `#[tauri::command(async)]` da
    // (2026-08-11: yazma-kilidi alan komutlar UI is parcacigindan havuza tasindi — donma sinifi).
    // Tam-metin `#[tauri::command]` aransaydi `(async)` bicimindekiler SESSIZCE kapsam disina
    // duser, nobetci kor kalirdi.
    while let Some(rel) = masked[search_from..].find("#[tauri::command") {
        let attr = search_from + rel;
        search_from = attr + "#[tauri::command".len();
        // Yalniz gercek iki bicim kabul: `]` (senkron/async fn) ya da `(...)]` (or. `(async)`).
        if !masked[search_from..].starts_with(']') && !masked[search_from..].starts_with('(') {
            continue;
        }

        // Oznitelikten sonraki ilk `fn <ad>` — arada `pub`, `pub(crate)`, `async` ya da
        // baska oznitelikler olabilir.
        let Some(fn_rel) = masked[search_from..].find("fn ") else { continue };
        let fn_at = search_from + fn_rel + 3;
        let name: String =
            src[fn_at..].chars().take_while(|c| c.is_alphanumeric() || *c == '_').collect();
        if name.is_empty() {
            continue;
        }

        // Govde: imza sonrasindaki ilk `{` (imzada `{` yok — jenerik sinirlar `<>` ile yazilir).
        let Some(brace_rel) = masked[fn_at..].find('{') else { continue };
        let brace_at = fn_at + brace_rel;
        let end = matching_brace(&masked, brace_at)
            .unwrap_or_else(|| panic!("{file}: `{name}` govdesinin kapanisi bulunamadi"));
        search_from = end + 1;
        out.push(Command { name, body: src[brace_at..=end].to_string(), file: file.clone() });
    }
    out
}

fn all_commands() -> Vec<Command> {
    source_files().iter().flat_map(|p| commands_in(p)).collect()
}

fn is_gated(body: &str) -> bool {
    GUARD_CALLS.iter().any(|g| body.contains(g))
}

// ── Testler ──────────────────────────────────────────────────────────────────

/// **Sohbet: rol kapisi yerine SAHIPLIK kapisi.** `chat_commands.rs`'teki her komut sahibi
/// oturumdan cozmeli (`owner_id`) — cunku bu dosyanin komutlari `UNGATED_BY_DESIGN`'da
/// `CHAT_OWNED` gerekcesiyle duruyor ve o gerekce ancak kapi FIILEN varsa dogru.
///
/// Aksi hâlde 2026-07-26'da kapatilan acik geri gelirdi: rol kapisi olmayan + sahip cozmeyen bir
/// chat komutu, arsivdeki HERKESIN sohbetine erisirdi. Liste-tabanli nobet burada yetmez (yeni
/// komutu listeye eklemek testi susturur) → dosya-ozel bu ek kilit gerekli.
#[test]
fn chat_commands_resolve_owner_from_session() {
    let cmds: Vec<Command> =
        all_commands().into_iter().filter(|c| c.file == "chat_commands.rs").collect();
    assert!(
        cmds.len() >= 10,
        "chat_commands.rs'te {} komut bulundu (>=10 bekleniyordu) — tarayici ya da dosya adi degismis",
        cmds.len()
    );

    let missing: Vec<String> = cmds
        .iter()
        .filter(|c| !c.body.contains("owner_id(") && !is_gated(&c.body))
        .map(|c| format!("  · {}", c.name))
        .collect();

    assert!(
        missing.is_empty(),
        "\nSahibi OTURUMDAN cozmeyen {} sohbet komutu:\n{}\n\n\
         Her chat komutu `let user_id = owner_id(&state)?;` ile sahibi cozmeli ve DB cagrisina \
         ILK argüman olarak vermeli. Sahip IPC parametresi OLAMAZ (istemci baskasi adina islem \
         yapamamali). Bkz migration 0031 + archivist-db/tests/chat.rs §v31.\n",
        missing.len(),
        missing.join("\n")
    );
}

/// Tarayici gercekten calisiyor mu — bos-gecis nobetcisi.
#[test]
fn scanner_finds_the_command_surface() {
    let cmds = all_commands();
    assert!(
        cmds.len() >= MIN_EXPECTED_COMMANDS,
        "Yalniz {} komut bulundu (>= {} bekleniyordu). Tarayici bozulmus olabilir — bu esik \
         olmasa test 'kapisiz komut yok' deyip YANLIS-YESIL gecerdi.",
        cmds.len(),
        MIN_EXPECTED_COMMANDS
    );
    // Kapi cagrisi hic bulunamiyorsa `GUARD_CALLS` ya da tarayici bozuktur.
    assert!(
        cmds.iter().any(|c| is_gated(&c.body)),
        "Hicbir komutta yetki kapisi bulunamadi — GUARD_CALLS ya da govde ayiklama bozuk."
    );
}

/// Ayni komut adi iki kez tanimlanmis olmamali (tauri handler'i da kaldirmaz);
/// listede de tekrar olmamali.
#[test]
fn no_duplicate_command_names() {
    let cmds = all_commands();
    let mut seen = BTreeSet::new();
    for c in &cmds {
        assert!(seen.insert(c.name.clone()), "`{}` komutu birden fazla tanimli ({})", c.name, c.file);
    }
    let mut listed = BTreeSet::new();
    for (name, _) in UNGATED_BY_DESIGN {
        assert!(listed.insert(*name), "`{name}` UNGATED_BY_DESIGN listesinde iki kez yazili");
    }
}

/// ① Kapisiz her komut listede olmali. **Yeni komut eklendiginde kirilan test budur.**
#[test]
fn every_ungated_command_is_listed_with_a_reason() {
    let listed: BTreeSet<&str> = UNGATED_BY_DESIGN.iter().map(|(n, _)| *n).collect();
    let missing: Vec<String> = all_commands()
        .iter()
        .filter(|c| !is_gated(&c.body) && !listed.contains(c.name.as_str()))
        .map(|c| format!("  · {} ({})", c.name, c.file))
        .collect();

    assert!(
        missing.is_empty(),
        "\nYETKI KAPISI OLMAYAN ve gerekcesi YAZILMAMIS {} komut:\n{}\n\n\
         Iki seceneginiz var:\n\
         (a) Komut DB'ye/diske/ayara YAZIYORSA → `rbac::require_admin|require_editor|...` kapisi ekleyin.\n\
         (b) Kapi gercekten gereksizse → `UNGATED_BY_DESIGN` listesine gerekce kategorisiyle yazin.\n\
         Ucuncu bir sik (sessizce birakmak) yok: yetki modeli Rust'ta gercek, frontend izni yalniz UI.\n",
        missing.len(),
        missing.join("\n")
    );
}

/// ② Listedeki her kayit hala VAR ve hala KAPISIZ olmali — liste bayatlamasin.
/// *(2026-07-25 dersi: sabit liste yeni migration gelince sessizce bayatlamisti.)*
#[test]
fn ungated_list_has_no_stale_entries() {
    let cmds = all_commands();
    let mut stale = Vec::new();

    for (name, _) in UNGATED_BY_DESIGN {
        match cmds.iter().find(|c| c.name == *name) {
            None => stale.push(format!(
                "  · `{name}` — boyle bir komut YOK (silindi/yeniden adlandirildi) → listeden cikarin"
            )),
            Some(c) if is_gated(&c.body) => stale.push(format!(
                "  · `{name}` ({}) — artik yetki kapisi TASIYOR → listeden cikarin (iyi haber)",
                c.file
            )),
            Some(_) => {}
        }
    }

    assert!(
        stale.is_empty(),
        "\nUNGATED_BY_DESIGN listesinde {} BAYAT kayit:\n{}\n",
        stale.len(),
        stale.join("\n")
    );
}
