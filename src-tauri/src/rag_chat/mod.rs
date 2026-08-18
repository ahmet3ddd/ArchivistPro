//! RAG sohbet orkestratoru (Artim 4) — H2 ragService.askQuestion(Stream) pariti.
//!
//! Akis: selamlama bypass → soru embedle → hibrit retrieve (db.rag_search) → niyet. Liste
//! niyeti ("X hangi dosyada/listele") ise LLM'siz dogrudan dosya listesi (citation'li); aksi
//! halde buildPrompt (Turkce-zorlamali, kaynak-atifli) → Ollama generate (stream → Channel
//! token) → cleanupLlmAnswer → kaynak-atifli cevap. Ollama yoksa acik hata (retrieval yine
//! de calismisti). Sicaklik dusuk (tutarli/az-uydurma).
//!
//! Alt-moduller: `prompt` (prompt insasi + cevap temizligi + citation/liste + gorsel-fallback),
//! `retrieval` (hassasiyet/rerank/query-rewrite zenginlestirme). DTO'lar + 3 komut burada tutulur.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use archivist_db::{ChunkHit, RetrieveDiag};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::State;

use crate::embed_commands::{ensure_embedder, resolve_model_dir};
use crate::ollama;
use crate::AppState;

mod prompt;
mod retrieval;
mod retrieve;
mod title;

pub(crate) use retrieve::{resolve_scope, retrieve_chunks, sensitivity_excluded};

/// Sohbet-uretimini durdurma bayragi (vision `VISION_STOP` deseni). `stop_rag_chat` set eder;
/// `rag_chat` her uretim basinda sifirlar + generate_stream'e should_stop olarak verir. Tek
/// sohbet ayni anda kostugu icin (ChatView stream sirasinda gonderiyi kilitler) global yeter.
static CHAT_STOP: AtomicBool = AtomicBool::new(false);

/// Devam eden RAG sohbet uretimini DURDUR (uzun cevap iptali). `CHAT_STOP` set edilir →
/// `generate_stream` token'lar arasinda kesilir; `rag_chat` o ana kadarki kismi cevabi normalce
/// doner (frontend commit eder). Uretim yoksa zararsiz (sonraki rag_chat basta sifirlar). Rol
/// gate yok (kullanici kendi sohbetini durdurur).
#[tauri::command]
pub fn stop_rag_chat() {
    CHAT_STOP.store(true, Ordering::SeqCst);
}

use prompt::{
    build_citations, build_prompt, cleanup_llm_answer, detect_greeting, detect_list_intent,
    direct_file_list, file_type_hint, image_fallback, is_not_found_answer, list_answer,
    reframe_not_found, SENTINEL_NOT_FOUND,
};
use retrieval::{enrich_query, llm_rerank};

/// **RAG (LLM'li) yolda** retrieve edilen toplam chunk (H2 `DEFAULT_TOP_K`). Prompt'a girenden
/// fazla olabilir → sonra [`PROMPT_CHUNKS`]'e iner.
const RETRIEVE_K: i64 = 12;
/// LLM prompt'una konan en fazla kaynak chunk (prompt sismesin; H2 rerank-keep ~6).
const PROMPT_CHUNKS: usize = 6;
/// Rerank (A2) etkinken cekilen genis aday havuzu (H2 RERANK_POOL); sonra PROMPT_CHUNKS'e iner.
const RERANK_POOL: i64 = 20;

/// **Liste-niyeti yolunda** cekilen chunk havuzu (2026-07-26; kullanici bulgusu "sonuclar hep
/// max 12 cikiyor").
///
/// **Sorun neydi:** liste yolu da `RETRIEVE_K`(12) kullaniyordu — ama o yolun cevabi chunk degil
/// **DOSYA** listesidir. Tavan yanlis birimdeydi: tekillestirme kesimden SONRA yapildigi icin tek
/// bir PDF 3 chunk yiyince (bkz `MAX_CHUNKS_PER_ASSET`) kullanici 12 degil 8 dosya goruyordu ve
/// ustelik basliktaki "N dosya bulundu" bunu TAM liste gibi gosteriyordu.
///
/// **Neden tam 150:** `MAX_CHUNKS_PER_ASSET = 3` → 150 chunk **en kotu halde bile** 150/3 = 50
/// ayri dosya tasir. Yani [`LIST_MAX_FILES`] dolabilecegi garanti edilir; sayilar keyfi degil,
/// birbirine bagli (biri degisirse digeri de gozden gecirilmeli).
const LIST_FETCH_CHUNKS: i64 = 150;

/// Liste cevabinda gosterilen EN FAZLA dosya. Asilirsa baslik bunu **acikca soyler** ve tam liste
/// icin Gezgin'e yonlendirir — sohbet bir onizleme yuzeyidir, tukenmez liste yuzeyi Gezgin'dir.
/// (Sessiz kesme, kullanicinin eksik listeyi tam sanmasina yol aciyordu.)
const LIST_MAX_FILES: usize = 50;

/// Sohbet gecmisi mesaji (frontend → prompt baglami).
#[derive(Debug, Deserialize)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

/// Bir kaynak atifi (citation) — UI tiklanabilir kaynak karti.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CitationDto {
    pub index: i64,
    pub asset_id: i64,
    pub file_name: String,
    pub path: String,
    pub page: Option<i64>,
    pub snippet: String,
}

/// RAG cevabi (tam). `kind`: greeting | list | rag | empty. `model`: kullanilan model/etiket.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RagAnswerDto {
    pub answer: String,
    pub citations: Vec<CitationDto>,
    pub model: String,
    pub kind: String,
    pub retrieved_chunks: i64,
    pub elapsed_ms: u128,
    /// Retrieval tani (A5) — UI gozlem ("neden bu/bos sonuc"). Greeting/bos-sorgu yolunda Default.
    pub diagnostics: RetrieveDiag,
}

/// Sohbet zenginlestirme secenekleri (frontend RAG ayarlari → komut). Hepsi varsayilan KAPALI →
/// mevcut davranis korunur. Ollama gerektirenler (rerank/query_rewrite) Ollama yoksa SESSIZCE
/// atlanir (graceful — retrieval/cevap yine calisir).
// `Serialize` (LAN Faz 5): uzak modda bu secenekler host'a `req.options` olarak JSON gider (host
// kendi retrieval'inda uygular). `Deserialize` yerel/host cozumu icin. camelCase iki yakada AYNI.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RagOptions {
    /// LLM rerank (A2): genis aday havuzunu LLM ile yeniden sirala → en yararli ust sira.
    pub rerank: bool,
    /// LLM query-rewrite (A3): kisa sorguyu mimari es-anlamli/EN terimlerle genislet (aday-recall).
    pub query_rewrite: bool,
    /// Hassasiyet oto-tespiti (A1): etkin kategoriler/kelimeler eslesen asset'ler retrieve'den
    /// dislanir (mali/kisisel/hukuki/IK icerik sohbette sizmasin). Manuel disla bundan AYRI (kalici
    /// bayrak, her zaman uygulanir).
    pub sensitivity_enabled: bool,
    /// Etkin hassasiyet kategorileri (financial/personal/legal/hr) → sunucu kelime listesine cevirir.
    pub sensitivity_categories: Vec<String>,
    /// Kullanici-tanimli ek hassasiyet kelimeleri.
    pub sensitivity_keywords: Vec<String>,
}

// ── Komutlar ────────────────────────────────────────────────────────────────

/// Ollama'da yuklu chat modelleri (oto-kesif; UI model secici). Ollama yoksa Err.
#[tauri::command]
pub fn ollama_models() -> Result<Vec<String>, String> {
    ollama::list_chat_models()
}

/// Sohbet oturumu icin **baslik onerisi** (H2 parite kalemi §3).
///
/// Eski davranis `q.slice(0, 40)` idi → oturum listesinde *"hangi dosyalarda yalıtım şartnamesi
/// ge…"* gibi kirik basliklar. Artik:
/// 1. **Taban (her zaman):** `archivist_db::session_title` — sorgunun stop-word'leri atilir,
///    kalan en cok 5 anlamli kelime (ORIJINAL yazimla) baslik olur. **Ollama gerekmez.**
/// 2. **Rafine (opsiyonel):** `answer` + `model` doluysa H2'nin LLM basligi denenir. Ollama
///    yoksa/hata verirse **sessizce** taban doner — baslik uretimi sohbeti asla bozmaz.
///
/// Anlamli kelime yoksa **bos string** doner → frontend `chat.untitled` gosterir.
///
/// `async`: uzun surebilen Ollama cagrisi ana is parcaciginda kosmasin (bkz `rag_chat`).
#[tauri::command]
pub async fn chat_suggest_title(
    query: String,
    answer: Option<String>,
    model: Option<String>,
) -> String {
    let base = archivist_db::session_title(&query);
    if let (Some(ans), Some(m)) = (answer.as_deref(), model.as_deref()) {
        if !ans.trim().is_empty() && !m.trim().is_empty() {
            if let Some(refined) = title::llm_title(m, &query, ans) {
                return refined;
            }
        }
    }
    base.unwrap_or_default()
}

/// AI (Ollama) durum ozeti — AI ayar paneli: Ollama erisilebilir mi + yuklu chat/vision modelleri
/// (tek `/api/tags` cagri). Rol gate yok (okuma). Ollama yoksa `ollama_up=false` + bos listeler.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiStatusDto {
    pub ollama_up: bool,
    /// `running` | `stopped` | `not_installed` | `unreachable`. Yalniz yerel HTTP adreste
    /// kurulum yoklamasi yapilir; uzak Ollama endpoint'i asla "kurulu degil" diye etiketlenmez.
    pub ollama_state: String,
    /// `stopped` ve yerel kurulum bulunduysa admin UI'nin baslat dugmesi gostermesi icin.
    pub can_start_ollama: bool,
    pub chat_models: Vec<String>,
    pub vision_models: Vec<String>,
}

#[tauri::command]
pub fn ai_status() -> AiStatusDto {
    match ollama::list_all_models() {
        Ok((chat_models, vision_models)) => AiStatusDto {
            ollama_up: true,
            ollama_state: "running".to_string(),
            can_start_ollama: false,
            chat_models,
            vision_models,
        },
        Err(_) => {
            let (ollama_state, can_start_ollama) = ollama::unavailable_service_state();
            AiStatusDto {
                ollama_up: false,
                ollama_state: ollama_state.to_string(),
                can_start_ollama,
                chat_models: Vec::new(),
                vision_models: Vec::new(),
            }
        }
    }
}

/// RAG sohbet: selamlama/liste-bypass + retrieve + (gerekirse) Ollama generate (stream).
/// Token'lar `on_token` Channel'i ile akar (UI canli). Tam (temiz) cevap + citation doner.
/// Rol gate yok (okuma; embedder/retrieve salt-okuma). Ollama uretimi yalniz "rag" yolunda.
/// `options`: zenginlestirme (A2 rerank · A3 query-rewrite); varsayilan kapali → eski davranis.
// `async fn`: ana iş parcacigi DISINDA kosar → uzun Ollama generate-stream sirasinda UI donmaz
// (token'lar akarken pencere yanit verir). Govde bloklayici, `.await` yok → Send-future guvenli.
// `scope`: RAG KAPSAMI (H2 RagScope pariti) — sohbetin hangi asset kumesinde arayacagi. `{kind:"all"}`
// (varsayilan) = tum arsiv. `ids`/`filter` retrieval'in TUM yollarini (FTS + kNN + gorsel-fallback +
// liste-niyeti) kapsam asset-id kumesine sinirlar. **`serde_json::Value`** cunku uzak modda scope
// host'a JSON olarak AYNEN gecer (`AnalysisScopeDto`'nun `Filter` varyanti `ListOpts` icerir ve o
// yalniz `Deserialize` → yeniden-serilestirilemez; ham Value tasimak tek yol). Yerelde
// `AnalysisScopeDto`'ya cozulur. Tauri arg sirasi invoke icin onemsiz (isimle eslenir).
//
// `remote`: uzak (ana) arsiv modu (varsayilan false; frontend `assetSource`'tan gecirir — SONRAKI
// dalga). true → retrieval host'ta (host'un ONCEDEN insa ettigi indeksi tuket: embed+retrieve HOST'ta,
// LLM uretimi ISTEMCIDE). citations/diag/on_token sozlesmesi degismez.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn rag_chat(
    question: String,
    model: String,
    history: Vec<ChatMsg>,
    options: RagOptions,
    scope: serde_json::Value,
    remote: Option<bool>,
    on_token: Channel<String>,
    state: State<'_, AppState>,
) -> Result<RagAnswerDto, String> {
    let t0 = Instant::now();
    let q = question.trim().to_string();
    let elapsed = |t0: Instant| t0.elapsed().as_millis();
    // Yeni uretim baslarken onceki "Durdur"u sifirla (bayat stop bu kosuyu erkenden kesmesin).
    CHAT_STOP.store(false, Ordering::SeqCst);

    if q.is_empty() {
        return Ok(RagAnswerDto {
            answer: String::new(),
            citations: Vec::new(),
            model: String::new(),
            kind: "empty".into(),
            retrieved_chunks: 0,
            elapsed_ms: elapsed(t0),
            diagnostics: RetrieveDiag::default(),
        });
    }

    // Selamlama → sabit cevap (RAG yok).
    if let Some(reply) = detect_greeting(&q) {
        let _ = on_token.send(reply.to_string());
        return Ok(RagAnswerDto {
            answer: reply.to_string(),
            citations: Vec::new(),
            model: "greeting".into(),
            kind: "greeting".into(),
            retrieved_chunks: 0,
            elapsed_ms: elapsed(t0),
            diagnostics: RetrieveDiag::default(),
        });
    }

    let remote = remote.unwrap_or(false);

    // Enrich/rerank/generate'in ortak modeli (istemci secmezse varsayilan).
    let model_used = if model.trim().is_empty() {
        ollama::DEFAULT_CHAT_MODEL.to_string()
    } else {
        model.trim().to_string()
    };
    let list_intent = detect_list_intent(&q);

    // ── RETRIEVE: yerel VEYA uzak host ──────────────────────────────────────────────────────────
    // Uzak modda retrieval + embedding HOST'ta (host'un ONCEDEN insa ettigi indeksi tuket); yerelde
    // `retrieve_chunks` cekirdegi (AYNI kod → kayma yok). `fb_allowed`/`fb_sens` yalniz YEREL gorsel
    // (CLIP) fallback icin saklanir — host'ta gorsel-fallback yok (host image aramasi disari acilmadi).
    let mut fb_allowed: Option<std::collections::HashSet<i64>> = None;
    let mut fb_sens: std::collections::HashSet<i64> = std::collections::HashSet::new();
    let (mut hits, diagnostics): (Vec<ChunkHit>, RetrieveDiag) = if remote {
        // scope/options host'a JSON olarak AYNEN gider; host embed+scope+sens+retrieve yapar
        // (require_remote_read + eslesme kapisi fetch_remote_chunks icinde).
        let options_json = serde_json::to_value(&options).map_err(|e| e.to_string())?;
        crate::remote_archive::fetch_remote_chunks(&state, &q, &scope, &options_json)?
    } else {
        // Yerel: scope → allowed (bos kapsam → "kapsamda dosya yok" erken don; UX korunur),
        // hassasiyet, embed. `image_fallback` ile paylasilan allowed/sens tek kez cozulur.
        let scope: archivist_db::AnalysisScope =
            serde_json::from_value::<crate::vision_commands::AnalysisScopeDto>(scope.clone())
                .map_err(|e| e.to_string())?
                .into();
        let dir = resolve_model_dir()?;
        // Kapsam cozumu salt-okuma → `read_db` (ingest'in yazma kilidini beklemez).
        let allowed = {
            let db = state.read_db.lock().map_err(|e| e.to_string())?;
            resolve_scope(&db, &scope)?
        };
        if allowed.as_ref().is_some_and(|s| s.is_empty()) {
            return Ok(RagAnswerDto {
                answer: String::new(),
                citations: Vec::new(),
                model: String::new(),
                kind: "empty".into(),
                retrieved_chunks: 0,
                elapsed_ms: elapsed(t0),
                diagnostics: RetrieveDiag::default(),
            });
        }
        // Hassasiyet sorgusu salt-okuma → `read_db`.
        let sens = {
            let db = state.read_db.lock().map_err(|e| e.to_string())?;
            sensitivity_excluded(&db, &options)?
        };
        // A3 LLM query-rewrite (opt, yalniz RAG yolu): EK FTS aday token'lari (Ollama; graceful).
        let extra_terms = if !list_intent && options.query_rewrite {
            enrich_query(&model_used, &q)
        } else {
            Vec::new()
        };
        // Kilit sirasi embedder→db (`run_embedding` ile AYNI → ters-sira deadlock riski yok).
        // Chunk retrieval salt-okuma → `read_db`: ingest yazarken sohbet beklemez.
        let hd = {
            let mut eg = state.embedder.lock().map_err(|e| e.to_string())?;
            let emb = ensure_embedder(&mut eg, &dir)?;
            let db = state.read_db.lock().map_err(|e| e.to_string())?;
            retrieve_chunks(&db, emb, &q, &options, &extra_terms, allowed.as_ref(), &sens)?
        };
        fb_allowed = allowed;
        fb_sens = sens;
        hd
    };

    // Liste niyeti → LLM'siz dosya listesi (host da list-intent'i keyword_only ile uygular →
    // uzak/yerel liste yolu tutarli). Ollama'siz calisir.
    if list_intent {
        // YEREL: asset-seviyesi FTS arama → GERCEK TOPLAM ("… N dosya bulundu", H2 pariti). Gezgin
        // ana arama kutusuyla AYNI indeks (`assets_fts`, body dahil) → "tam liste icin Gezgin'de
        // arayin" birebir tutarli. Kapsam (fb_allowed) + hassasiyet (fb_sens) retrieve blogunda
        // zaten cozuldu. ⚠️ UZAK modda ATLANIR: host chunk doner, ucuz asset-COUNT LAN'da yok →
        // uzak yol chunk-tabanli/"daha fazlasi olabilir" davranisini korur (asagidaki mevcut yol).
        // Dosya-turu ipucu (⑤): "pdf sartname" → yalniz o turde ara + baslikta "(PDF)". DOKUMAN-turu
        // (pdf/dwg/doc…) ipucu ayrica gorsel (CLIP) fallback'i BASKILAR (asagida) — JPG'ler bir "pdf"
        // sorgusuna cevap degil + fallback ext'i yok sayar (2026-07-27 canli bulgu). GORSEL-turu
        // (jpg/png) ipucu ya da ipucsuz → gorsel fallback KORUNUR (or. "bulutlu gorsel var mi").
        let hint = file_type_hint(&q);
        let hint_non_image = hint
            .as_deref()
            .is_some_and(|e| !e.iter().any(|x| matches!(x.as_str(), "jpg" | "jpeg" | "png")));
        if !remote {
            let found = {
                // Liste-niyeti aramasi salt-okuma → `read_db`.
                let db = state.read_db.lock().map_err(|e| e.to_string())?;
                db.list_intent_search(&q, hint.as_deref(), fb_allowed.as_ref(), &fb_sens, LIST_MAX_FILES as i64)
                    .map_err(|e| e.to_string())?
            };
            // Eslesme var → gercek toplamli cevap. Eslesme YOK + dokuman-turu ipucu → durust
            // tur-kapsamli "bulunamadi" (list_answer 0-sonucu boyle doner; gorsel fallback DEGIL).
            // Eslesme YOK + (ipucsuz veya gorsel-turu ipucu) → asagidaki gorsel/chunk yoluna dus.
            if let Some(page) = found {
                if !page.items.is_empty() || hint_non_image {
                    let (answer, citations) = list_answer(&q, hint.as_deref(), &page);
                    let _ = on_token.send(answer.clone());
                    return Ok(RagAnswerDto {
                        answer,
                        citations,
                        model: "direct-list".into(),
                        kind: "list".into(),
                        retrieved_chunks: page.items.len() as i64,
                        elapsed_ms: elapsed(t0),
                        diagnostics,
                    });
                }
            }
        }

        // Metinde eslesme yoksa YEREL gorsel (CLIP) fallback (uzakta ATLANIR — host image yok).
        // ⚠️ DOKUMAN-turu ipucu (pdf/dwg/doc…) varken BASKILANIR: kullanici acikca dosya turu istedi,
        // gorsel benzerlik JPG'leri o soruya cevap degildir (yukarida durust "bulunamadi" dondu).
        if hits.is_empty() && !remote && !hint_non_image {
            if let Some((answer, citations)) =
                image_fallback(&state, &q, &fb_sens, fb_allowed.as_ref())
            {
                let _ = on_token.send(answer.clone());
                return Ok(RagAnswerDto {
                    answer,
                    citations,
                    model: "image-fallback".into(),
                    kind: "image".into(),
                    retrieved_chunks: 0,
                    elapsed_ms: elapsed(t0),
                    diagnostics,
                });
            }
        }
        let (answer, citations) = direct_file_list(&q, &hits);
        let _ = on_token.send(answer.clone());
        return Ok(RagAnswerDto {
            answer,
            citations,
            model: "direct-list".into(),
            kind: "list".into(),
            retrieved_chunks: hits.len() as i64,
            elapsed_ms: elapsed(t0),
            diagnostics,
        });
    }

    // ── RAG yolu (LLM cevabi) ──
    if hits.is_empty() {
        // Metinde eslesme yoksa YEREL gorsel (CLIP) fallback (uzakta ATLANIR).
        if !remote {
            if let Some((answer, citations)) =
                image_fallback(&state, &q, &fb_sens, fb_allowed.as_ref())
            {
                let _ = on_token.send(answer.clone());
                return Ok(RagAnswerDto {
                    answer,
                    citations,
                    model: "image-fallback".into(),
                    kind: "image".into(),
                    retrieved_chunks: 0,
                    elapsed_ms: elapsed(t0),
                    diagnostics,
                });
            }
        }
        let msg = SENTINEL_NOT_FOUND.to_string();
        let _ = on_token.send(msg.clone());
        return Ok(RagAnswerDto {
            answer: msg,
            citations: Vec::new(),
            model: "empty".into(),
            kind: "empty".into(),
            retrieved_chunks: 0,
            elapsed_ms: elapsed(t0),
            diagnostics,
        });
    }

    // A2 LLM rerank (opt): aday sirasini LLM ile yeniden duzenle (Ollama yoksa orijinal sira). Uzak
    // modda da gecerli: host rerank etkinken genis aday havuzu (RERANK_POOL) dondurur, istemci kendi
    // Ollama'siyla yeniden siralar → yerel RAG yoluyla tutarli.
    if options.rerank && hits.len() > PROMPT_CHUNKS {
        let order = llm_rerank(&model_used, &q, &hits, PROMPT_CHUNKS);
        let reordered: Vec<ChunkHit> = order.into_iter().map(|i| hits[i].clone()).collect();
        hits = reordered;
    }

    // Prompt'a en fazla PROMPT_CHUNKS kaynak (sismesin); citation'lar da bunlardan.
    let prompt_chunks: Vec<&ChunkHit> = hits.iter().take(PROMPT_CHUNKS).collect();
    let prompt = build_prompt(&q, &prompt_chunks, &history);

    // Ollama generate (stream → her token Channel'a). Kilit YOK (uzun cagri). Kullanici "Durdur"
    // derse (stop_rag_chat → CHAT_STOP) akis token'lar arasinda kesilir → o ana kadarki kismi cevap.
    let raw = ollama::generate_stream(
        &model_used,
        &prompt,
        &mut |tok| {
            let _ = on_token.send(tok.to_string());
        },
        &|| CHAT_STOP.load(Ordering::SeqCst),
    )?;

    let citations = build_citations(&prompt_chunks);
    let answer = cleanup_llm_answer(&raw);
    // CELISKI GIDERME (kullanici karari 2026-06-23): retrieval kaynak DONDURDU ama LLM, KAYNAKLAR'i
    // soruya "uygun degil" sayip "bulamadim" sentinel'i uretti → metin "bulamadim" derken alttaki
    // kaynak kartlari KALIYORDU (celiski). Karar: kartlari KORU, yaniti durust cercevele. Frontend
    // committed turn'u DTO.answer'dan alir (ChatView: stream'deki ham sentinel atilir) → ekstra
    // on_token GEREKMEZ (yoksa stream'de sentinel+reframe birlesir). Bilgi kaybi YOK.
    let answer = if !citations.is_empty() && is_not_found_answer(&answer) {
        reframe_not_found(&prompt_chunks)
    } else {
        answer
    };

    Ok(RagAnswerDto {
        answer,
        citations,
        model: model_used,
        kind: "rag".into(),
        retrieved_chunks: hits.len() as i64,
        elapsed_ms: elapsed(t0),
        diagnostics,
    })
}
