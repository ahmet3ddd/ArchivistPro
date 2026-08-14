//! Prompt insasi + LLM cevap temizligi/bicimleme yardimcilari (H2 buildPrompt /
//! cleanupLlmAnswer pariti). Niyet tespiti (greeting/list), citation/liste uretimi,
//! celiski-reframe ve metin bos donunce gorsel (CLIP) fallback burada. Saf/test edilebilir;
//! orkestrator (`super::rag_chat`) bunlari cagirir.

use archivist_db::{normalize_tr, significant_tokens, AssetPage, AssetRow, ChunkHit, ListOpts};

use crate::AppState;

use super::{ChatMsg, CitationDto, LIST_FETCH_CHUNKS, LIST_MAX_FILES};

/// Citation snippet uzunlugu.
const SNIPPET_CHARS: usize = 180;
/// Metin RAG bos donunce gorsel-fallback'te gosterilecek en yakin gorsel sayisi.
const IMAGE_FALLBACK_K: i64 = 6;
/// Kapsam (scope) verildiginde gorsel-fallback aday havuzu: global en-yakin N gorsel cekilir, sonra
/// kapsam disi elenip IMAGE_FALLBACK_K'e inilir (kapsamsiz yol IMAGE_FALLBACK_K kullanir → regresyon
/// yok). Genis havuz, dar kapsamda post-filtreden sonra yeterli isabet kalmasini saglar (clamp_k tavani).
const IMAGE_FALLBACK_SCOPED_POOL: i64 = 200;
/// Gorsel-fallback ALAKA esigi (cosine). Altindaki "en yakin" gorseller ALAKASIZ kabul edilir →
/// gosterilmez. Esigi gecen yoksa "bulunamadi" + EN YAKIN skor mesajda gosterilir (seffaf
/// kalibrasyon). CLIP text-image olcegi dusuk (ilgili ~0.28-0.32, ilgisiz ~0.20-0.26) → 0.28
/// makul ayrim; gercek skorlar sohbette gorundugu icin kolayca ayarlanabilir (tek const).
const IMAGE_FALLBACK_MIN_COSINE: f32 = 0.28;
/// Gorsel-fallback "bahsetme" tabani: en yakin gorsel bunun da ALTINDAysa (tamamen alakasiz),
/// gorselden hic bahsetme → cagiran duz "bilgi bulamadim" doner (metinsel sorularda gorsel
/// gurultusu olmaz). Esik (0.28) ile taban (0.22) arasi: "bulunamadi + en yakin %X" (seffaf).
const IMAGE_FALLBACK_MENTION_FLOOR: f32 = 0.22;

/// LLM, KAYNAKLAR'i soruya "uygun degil" sayinca build_prompt talimatiyla urettigi sentinel.
/// Ayni dize hem bos-retrieval yolunda (citation YOK) hem celiski-reframe tespitinde kullanilir → DRY.
pub(super) const SENTINEL_NOT_FOUND: &str = "Bu konuda arşivde bilgi bulamadım.";
/// cleanup_llm_answer, model yalniz <think> sizdirip govde bos kalinca donen fallback.
const CLEANUP_EMPTY_FALLBACK: &str = "Bu soru için kaynaklardan net bir cevap üretilemedi.";

// ── Niyet tespiti (H2 detectGreeting / detectListIntent pariti) ──────────────

/// Selamlama/sohbet kalibi → sabit cevap (RAG'e gitmez). Normalize + sade eslesme.
pub(super) fn detect_greeting(query: &str) -> Option<&'static str> {
    let q = normalize_tr(query.trim()).trim_matches(|c: char| !c.is_alphanumeric()).to_string();
    match q.as_str() {
        "merhaba" | "selam" | "merhabalar" | "selamlar" | "hey" | "hi" | "hello" => {
            Some("Merhaba! Arşivde aradığınız bir şey var mı? Örneğin: \"merdiven hangi dwg dosyasında\".")
        }
        "gunaydin" | "iyi gunler" | "iyi aksamlar" => {
            Some("İyi günler! Arşivde aramak istediğiniz bir şey var mı?")
        }
        "tesekkurler" | "tesekkur ederim" | "sagol" | "sagolun" | "eyvallah" | "thanks" => {
            Some("Rica ederim. Başka sorunuz olursa buradayım.")
        }
        "nasilsin" | "naber" | "ne haber" => Some("İyiyim, teşekkürler. Sizin için ne bulabilirim?"),
        "kimsin" | "sen kimsin" | "ne yaparsin" | "yardim" => {
            Some("Bu ofisin mimari arşiv asistanıyım. Arşivdeki dosyalar hakkında bilgi verebilirim — Türkçe yazmanız yeterli.")
        }
        _ => None,
    }
}

/// "X hangi/nerede/listele/bul/goster/iceren..." → liste niyeti (LLM'siz dosya listesi).
const LIST_INTENT_MARKERS: &[&str] = &[
    "hangi", "hangisi", "hangilerinde", "nerede", "nerelerde", "listele", "liste", "bul",
    "bulunur", "bulunuyor", "goster", "gosterin", "iceren", "iceriyor", "olan", "olanlar",
    "ara", "arama", "gecer", "geciyor",
];

pub(super) fn detect_list_intent(query: &str) -> bool {
    let norm = normalize_tr(query);
    // "var mi"/"var mı" → "varmi" birlesik (soru-eki onceki kelimeye yapisir) da yakala.
    let glued = norm.replace(" mi", "mi").replace(" mu", "mu");
    let has = |s: &str| {
        s.split(|c: char| !c.is_alphanumeric())
            .any(|w| LIST_INTENT_MARKERS.contains(&w) || w == "varmi" || w == "varmu")
    };
    has(&norm) || has(&glued)
}

/// Sorguda bir dosya-turu ipucu ("pdf sartname", "dwg merdiven") → aramayi o ture SUZ + baslikta
/// goster (H2 `FILE_TYPE_HINTS` + `detectFileTypeHint` pariti, ⑤). normalize_tr + alnum-bol; ilk
/// eslesen anahtarin uzanti listesini doner (or. "doc" → ["doc","docx"]; ilki gosterim etiketi).
/// Eslesme yoksa None (tur filtresi yok). ⚠️ Dosya-turu sozcukleri `significant_tokens`'da STOP_WORD
/// oldugu icin tespit RAW normalize token'lardan yapilir (yoksa "pdf" hic gorunmez, aranan terim
/// olan "sartname" kalir → dogru: "pdf" turu SUZER, "sartname" arar).
pub(super) fn file_type_hint(query: &str) -> Option<Vec<String>> {
    let norm = normalize_tr(query);
    for w in norm.split(|c: char| !c.is_alphanumeric()) {
        let exts: &[&str] = match w {
            "dwg" => &["dwg"],
            "dxf" => &["dxf"],
            "max" => &["max"],
            "pdf" => &["pdf"],
            "skp" => &["skp"],
            "doc" => &["doc", "docx"],
            "docx" => &["docx", "doc"],
            "xls" => &["xls", "xlsx"],
            "xlsx" => &["xlsx", "xls"],
            "jpg" => &["jpg", "jpeg"],
            "jpeg" => &["jpeg", "jpg"],
            "png" => &["png"],
            "rvt" => &["rvt"],
            "ifc" => &["ifc"],
            _ => continue,
        };
        return Some(exts.iter().map(|s| (*s).to_string()).collect());
    }
    None
}

// ── Prompt + cevap temizligi (H2 buildPrompt / cleanupLlmAnswer pariti) ──────

/// Turkce-zorlamali, kaynak-atifli prompt (H2 buildPrompt). Kaynak yetersizse "bilmiyorum".
pub(super) fn build_prompt(query: &str, chunks: &[&ChunkHit], history: &[ChatMsg]) -> String {
    let citation_indices = citation_indices(chunks);
    let sources: String = chunks
        .iter()
        .map(|c| {
            let r#ref = match c.page {
                Some(p) => format!("{} (s.{p})", c.file_name),
                None => c.file_name.clone(),
            };
            format!("[{}] ({})\n{}", citation_indices[&c.asset_id], r#ref, c.text)
        })
        .collect::<Vec<_>>()
        .join("\n\n---\n\n");

    // Son 4 mesaj, her biri <=400 karakter (prompt sismesin).
    let hist: String = {
        let recent: Vec<&ChatMsg> = history.iter().rev().take(4).collect();
        if recent.is_empty() {
            String::new()
        } else {
            let lines: Vec<String> = recent
                .into_iter()
                .rev()
                .map(|m| {
                    let who = if m.role == "user" { "Kullanıcı" } else { "Asistan" };
                    let c = if m.content.chars().count() > 400 {
                        m.content.chars().take(400).collect::<String>() + "…"
                    } else {
                        m.content.clone()
                    };
                    format!("{who}: {c}")
                })
                .collect();
            format!("ÖNCEKİ KONUŞMA (yalnız bağlam için):\n{}\n\n", lines.join("\n"))
        }
    };

    format!(
        "/no_think\n\
         [KESIN KURAL] Cevabın TAMAMI TÜRKÇE olacak.\n\
         [KESIN KURAL] Düşünme akışı/önsöz yazma; DİREKT cevap ver.\n\n\
         Mimari arşiv asistanısın. Aşağıdaki KAYNAKLAR'dan DİREKT, KISA, TÜRKÇE cevap ver. \
         Format: \"[N] dosya_adı: bilgi\". KAYNAKLAR soruya uygun değilse: \
         \"Bu konuda arşivde bilgi bulamadım.\"\n\n\
         KAYNAKLAR:\n{sources}\n\n{hist}SORU: {query}\n\nCEVAP (Türkçe, direkt):"
    )
}

/// Kucuk modellerin sizdirdigi <think>/no_think/prompt-iskeleti satirlarini temizle (H2
/// cleanupLlmAnswer cekirdegi; sentence-level Ingilizce filtre v1'de sade tutuldu).
pub(super) fn cleanup_llm_answer(raw: &str) -> String {
    let mut text = raw.trim().to_string();
    // <think>...</think> bloklarini cikar (stream filtre kacirdiysa).
    while let (Some(s), Some(e)) = (text.find("<think>"), text.find("</think>")) {
        if s < e {
            text.replace_range(s..e + "</think>".len(), "");
        } else {
            break;
        }
    }
    text = text.replace("/no_think", "").replace("/nothink", "");

    // Sizan prompt-iskeleti satirlarini at (sabit sablon → gercek cevapta gecmez).
    const SCAFFOLD: &[&str] = &[
        "[KESIN KURAL]",
        "KAYNAKLAR:",
        "KAYNAKLAR soruya",
        "FORMAT:",
        "Format:",
        "Mimari arşiv asistanısın",
        "ÖNCEKİ KONUŞMA",
        "SORU:",
        "CEVAP",
    ];
    let kept: Vec<&str> = text
        .lines()
        .filter(|ln| {
            let t = ln.trim_start();
            !SCAFFOLD.iter().any(|p| t.starts_with(p))
        })
        .collect();
    let result = kept.join("\n").trim().to_string();
    if result.is_empty() {
        CLEANUP_EMPTY_FALLBACK.to_string()
    } else {
        result
    }
}

/// Liste niyeti cevabi: hit'leri asset'e gore grupla (ilk gorulen sira korunur) → "N dosya
/// bulundu" + madde listesi + citation. LLM yok.
pub(super) fn direct_file_list(query: &str, hits: &[ChunkHit]) -> (String, Vec<CitationDto>) {
    let mut seen = std::collections::HashSet::new();
    let mut files: Vec<&ChunkHit> = Vec::new();
    for h in hits {
        if seen.insert(h.asset_id) {
            files.push(h);
        }
    }
    let sig = significant_tokens(query);
    let term = if sig.is_empty() { query.trim().to_string() } else { sig.join(", ") };

    if files.is_empty() {
        return (format!("\"{term}\" içeren dosya arşivde bulunamadı."), Vec::new());
    }

    // Liste KESILDI mi? Iki bagimsiz kaynak:
    //   (1) dosya tavani asildi (kesin),
    //   (2) chunk havuzu doydu → getirilmemis dosya OLABILIR (belirsiz ama gormezden gelinemez).
    // Ikisi de "daha fazlasi var" demek; ayirt etmek kullaniciya deger katmaz, susmak zarar verir.
    let file_cap_hit = files.len() > LIST_MAX_FILES;
    let pool_saturated = hits.len() >= LIST_FETCH_CHUNKS as usize;
    files.truncate(LIST_MAX_FILES);

    let citations: Vec<CitationDto> = files
        .iter()
        .enumerate()
        .map(|(i, h)| CitationDto {
            index: i as i64 + 1,
            asset_id: h.asset_id,
            file_name: h.file_name.clone(),
            path: h.path.clone(),
            page: h.page,
            snippet: snippet(&h.text),
        })
        .collect();
    let body: String =
        citations.iter().map(|c| format!("- [{}] {}", c.index, c.file_name)).collect::<Vec<_>>().join("\n");
    // ⚠️ Kesilmis listeyi "N dosya bulundu" diye sunmak, kullaniciya arsivde BASKA dosya olmadigini
    // soyler — 2026-07-26'da bildirilen "hep 12 cikiyor" sikayetinin asil zarari buydu.
    let header = if file_cap_hit || pool_saturated {
        format!(
            "\"{term}\" için ilk {} dosya (daha fazlası olabilir — tam liste için Gezgin'de arayın):\n\n",
            citations.len()
        )
    } else {
        format!("\"{term}\" için {} dosya bulundu:\n\n", citations.len())
    };
    (header + &body, citations)
}

/// Liste-niyeti cevabi (YEREL, asset-seviyesi arama — `Db::list_intent_search`): **GERCEK TOPLAM**
/// ile baslik + rank-sirali ilk N dosya + citation. H2 `directFileListAnswer` davranis pariti:
/// toplam `page.total` (Gezgin ana arama kutusuyla AYNI sayim) → "kac dosya var" sorusu kesin
/// cevaplanir. Gosterim `page.items` ile kelepceli (sohbet bir ONIZLEME yuzeyidir); toplam bunu
/// asiyorsa baslik acikca soyler ve tam liste icin Gezgin'e yonlendirir (tukenmez liste orasidir).
/// `direct_file_list`'ten farki: sayi chunk-tekillestirmeden DEGIL, asset COUNT'undan gelir
/// (yaniltici "N dosya bulundu" — aslinda kesik — sorunu kokten biter).
pub(super) fn list_answer(
    query: &str,
    ext_hint: Option<&[String]>,
    page: &AssetPage,
) -> (String, Vec<CitationDto>) {
    let sig = significant_tokens(query);
    let term = if sig.is_empty() { query.trim().to_string() } else { sig.join(", ") };
    // Dosya-turu etiketi (⑤; H2 `fileTypeHint[0].toUpperCase()`) → baslikta " (PDF)".
    let type_str = match ext_hint {
        Some(exts) if !exts.is_empty() => format!(" ({})", exts[0].to_uppercase()),
        _ => String::new(),
    };

    // Eslesme yok (or. dosya-turu ipuclu sorgu o turde sonuc vermedi) → durust tur-kapsamli
    // "bulunamadi" (H2 `"{tokenList}"{typeStr} içeren dosya arşivde bulunamadı`). Cagiran bunu
    // gorsel-fallback YERINE dokuman-turu ipucunda secer (JPG'ler "pdf" sorgusuna cevap degil).
    if page.total == 0 {
        return (format!("\"{term}\"{type_str} içeren dosya arşivde bulunamadı."), Vec::new());
    }

    let citations: Vec<CitationDto> = page
        .items
        .iter()
        .enumerate()
        .map(|(i, a)| CitationDto {
            index: i as i64 + 1,
            asset_id: a.id,
            file_name: a.file_name.clone(),
            path: a.path.clone(),
            page: None,
            snippet: plain_snippet(a.snippet.as_deref()),
        })
        .collect();
    let body: String =
        citations.iter().map(|c| format!("- [{}] {}", c.index, c.file_name)).collect::<Vec<_>>().join("\n");

    let shown = citations.len();
    // Toplam gosterilenden fazlaysa: "ilk M gösteriliyor" + Gezgin yonlendirmesi (kesme SESSIZ degil).
    let header = if page.total as usize > shown {
        format!(
            "\"{term}\"{type_str} için {} dosya bulundu (ilk {shown} gösteriliyor — tam liste için Gezgin'de arayın):\n\n",
            page.total
        )
    } else {
        format!("\"{term}\"{type_str} için {} dosya bulundu:\n\n", page.total)
    };
    (header + &body, citations)
}

fn snippet(text: &str) -> String {
    let t = text.trim();
    if t.chars().count() <= SNIPPET_CHARS {
        t.to_string()
    } else {
        t.chars().take(SNIPPET_CHARS).collect::<String>() + "…"
    }
}

/// Asset-FTS snippet'ini sohbet kartina uygun DUZ metne cevir: `assets_fts` snippet'i eslesen
/// terimleri `\u{2}`..`\u{3}` (STX/ETX) ile isaretler (Gezgin vurgu bileseni bunu cozer); sohbet
/// citation karti duz metin bekledigi icin isaretleyiciler SOKULUR, sonra SNIPPET_CHARS'a kirpilir.
fn plain_snippet(s: Option<&str>) -> String {
    match s {
        Some(t) => snippet(&t.replace(['\u{2}', '\u{3}'], "")),
        None => String::new(),
    }
}

pub(super) fn build_citations(chunks: &[&ChunkHit]) -> Vec<CitationDto> {
    let mut seen = std::collections::HashSet::new();
    chunks
        .iter()
        .filter(|c| seen.insert(c.asset_id))
        .enumerate()
        .map(|(i, c)| CitationDto {
            index: i as i64 + 1,
            asset_id: c.asset_id,
            file_name: c.file_name.clone(),
            path: c.path.clone(),
            page: c.page,
            snippet: snippet(&c.text),
        })
        .collect()
}

/// Her asset'e ilk goruldugu sirada tek kaynak numarasi ver. Ayni dosyanin birden cok chunk'i
/// prompt'ta kalir (baglam kaybi yok), fakat hepsi ayni `[N]` atfini kullanir.
fn citation_indices(chunks: &[&ChunkHit]) -> std::collections::HashMap<i64, i64> {
    let mut indices = std::collections::HashMap::new();
    for c in chunks {
        let next = indices.len() as i64 + 1;
        indices.entry(c.asset_id).or_insert(next);
    }
    indices
}

/// Cevap, "kaynaklarda eslesme yok" anlamina gelen sentinel mi? LLM, build_prompt talimatiyla
/// SENTINEL_NOT_FOUND'u; cleanup ise CLEANUP_EMPTY_FALLBACK'i uretebilir → kaynak VARKEN ikisi de
/// celiskidir. Uzun-gercek cevap bu ifadeyi gecerken icerebilir → kisa-cevap (<=80 char) sarti
/// yanlis-pozitifi onler (gercek bir cevap sentinel cumlesini bu kadar kisa yalniz-basina icermez).
pub(super) fn is_not_found_answer(answer: &str) -> bool {
    let a = answer.trim();
    if a == SENTINEL_NOT_FOUND || a == CLEANUP_EMPTY_FALLBACK {
        return true;
    }
    a.chars().count() <= 80
        && (a.contains("bilgi bulamadım") || a.contains("net bir cevap üretilemedi"))
}

/// Celiski-giderme cercevelemesi (kullanici karari 2026-06-23): LLM "bulamadim" sentinel'i uretti
/// AMA retrieval kaynak dondurdu → kartlari KORU, yaniti durust cercevele ("dogrudan eslesme yok;
/// ilgili olabilecek N kaynak"). Bilgi kaybi yok. Liste [N]'leri build_citations indeksleriyle
/// hizali (ayni prompt_chunks sirasi/sayisi → kart ile metin esler).
pub(super) fn reframe_not_found(chunks: &[&ChunkHit]) -> String {
    let citations = build_citations(chunks);
    let body: String = citations
        .iter()
        .map(|c| format!("- [{}] {}", c.index, c.file_name))
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "Soruya doğrudan eşleşen bir cevap bulamadım; ilgili olabilecek {} kaynak (kaynak kartından açın):\n\n{}",
        citations.len(),
        body
    )
}

/// Metin RAG bos donunce **GORSEL (CLIP) fallback** — kullanici karari (2026-06-22): "sohbet
/// gorseli de arasin; mod sectirme yok". Sorguyu CLIP/cok-dilli ile embedle → en yakin gorseller.
/// YALNIZ metin bos sonucta cagrilir → metin eslesen sorgularda gorsel gurultusu OLMAZ. Model/
/// gorsel-indeks/embed yoksa None (graceful → cagiran normal "bulunamadi"). Hassasiyet (sens_
/// excluded) burada da uygulanir. ("bulutlu gorsel var mi" → metin bos → bulutlu gorseller gelir.)
pub(super) fn image_fallback(
    state: &AppState,
    q: &str,
    sens_excluded: &std::collections::HashSet<i64>,
    allowed: Option<&std::collections::HashSet<i64>>,
) -> Option<(String, Vec<CitationDto>)> {
    let qvec = crate::image_commands::embed_query_text_clip(state, q).ok()?;
    // Kapsam (scope) verildiyse (Some) genis aday havuzu cek → post-filtre (kapsam disi elenince)
    // yeterli isabet kalsin; sonra IMAGE_FALLBACK_K'e in. Kapsamsiz (None) davranis AYNEN korunur.
    let page_size = if allowed.is_some() { IMAGE_FALLBACK_SCOPED_POOL } else { IMAGE_FALLBACK_K };
    let opts = ListOpts { page_size, ..Default::default() };
    let scored: Vec<(AssetRow, f32)> = {
        let db = state.db.lock().ok()?;
        db.image_search_scored(&qvec, &opts).ok()?
    }
    .into_iter()
    .filter(|(a, _)| !sens_excluded.contains(&a.id))
    // RAG kapsami: Some ise kapsam disi asset'leri ele (cosine sirasi korunur → ilk K en yakin).
    .filter(|(a, _)| allowed.is_none_or(|s| s.contains(&a.id)))
    .take(IMAGE_FALLBACK_K as usize)
    .collect();

    // Hic aday yok (gorsel-indeks bos / embed yok) → None (cagiran normal "bulunamadi").
    let best = scored.first()?.1;

    // Alaka esigini gecen gorseller (gercek cosine; skor sohbette gosterilir → seffaf).
    let pct = |c: f32| (c * 100.0).round() as i64;
    let mut citations: Vec<CitationDto> = Vec::new();
    let mut body_lines: Vec<String> = Vec::new();
    for (a, cos) in &scored {
        if *cos >= IMAGE_FALLBACK_MIN_COSINE {
            let idx = citations.len() as i64 + 1;
            citations.push(CitationDto {
                index: idx,
                asset_id: a.id,
                file_name: a.file_name.clone(),
                path: a.path.clone(),
                page: None,
                snippet: format!("görsel benzerlik %{}", pct(*cos)),
            });
            body_lines.push(format!("- [{}] {} (%{} benzerlik)", idx, a.file_name, pct(*cos)));
        }
    }

    if citations.is_empty() {
        // En yakin gorsel "bahsetme tabani"nin da altinda → tamamen alakasiz; gorselden bahsetme
        // (metinsel sorularda gorsel gurultusu olmaz) → cagiran duz "bilgi bulamadim" doner.
        if best < IMAGE_FALLBACK_MENTION_FLOOR {
            return None;
        }
        // Taban ile esik arasi → "bulunamadi" + EN YAKIN skor (kalibrasyon + seffaflik).
        let msg = format!(
            "Bu konuda görsel bulamadım. (En yakın görsel %{} benzerlikte; alaka eşiği %{}'nin altında.)",
            pct(best),
            pct(IMAGE_FALLBACK_MIN_COSINE)
        );
        return Some((msg, Vec::new()));
    }
    let header = format!(
        "Metinde eşleşme bulamadım; görsele göre en yakın {} dosya (benzerlik %; kaynak kartından açın):\n\n",
        citations.len()
    );
    Some((header + &body_lines.join("\n"), citations))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn greeting_detection() {
        assert!(detect_greeting("Merhaba").is_some());
        assert!(detect_greeting("teşekkürler!").is_some());
        assert!(detect_greeting("merdiven hangi dosyada").is_none());
    }

    #[test]
    fn list_intent_detection() {
        assert!(detect_list_intent("merdiven hangi dosyada"));
        assert!(detect_list_intent("villa projelerini listele"));
        assert!(detect_list_intent("cephe içeren dwg var mı"));
        assert!(!detect_list_intent("bu sözleşmenin garanti süresi nedir"));
    }

    #[test]
    fn cleanup_strips_think_and_scaffold() {
        let raw = "<think>plan</think>\n/no_think\n[KESIN KURAL] Türkçe\nCevap: merdiven A.dwg'de.";
        let out = cleanup_llm_answer(raw);
        assert!(!out.contains("<think>"));
        assert!(!out.contains("/no_think"));
        assert!(!out.contains("[KESIN KURAL]"));
        assert!(out.contains("merdiven A.dwg"));
    }

    #[test]
    fn cleanup_empty_falls_back() {
        assert_eq!(cleanup_llm_answer("<think>only thinking</think>"), CLEANUP_EMPTY_FALLBACK);
    }

    #[test]
    fn not_found_answer_detection() {
        // LLM sentinel'i + cleanup bos-fallback'i (kaynak varken celiski).
        assert!(is_not_found_answer(SENTINEL_NOT_FOUND));
        assert!(is_not_found_answer(CLEANUP_EMPTY_FALLBACK));
        assert!(is_not_found_answer("  Bu konuda arşivde bilgi bulamadım.  ")); // trim
        // Gercek/uzun cevap "bilgi bulamadım" ifadesini gecerken icerse bile reframe EDILMEZ (>80 char).
        assert!(!is_not_found_answer(
            "Merdiven detayı A.dwg'de bulundu; ayrıca bilgi bulamadım dediğim ikinci konu için B.pdf'e bakın."
        ));
        assert!(!is_not_found_answer("[1] A.dwg: merdiven detayı 1/20 ölçekli."));
    }

    #[test]
    fn repeated_chunks_share_one_citation_without_losing_prompt_context() {
        let hit = |chunk_id: i64, asset_id: i64, name: &str, text: &str| ChunkHit {
            chunk_id,
            asset_id,
            file_name: name.into(),
            path: format!("/x/{name}"),
            chunk_index: chunk_id,
            page: None,
            text: text.into(),
            score: 1.0,
        };
        let a1 = hit(1, 10, "ayni.dwg", "birinci parca");
        let a2 = hit(2, 10, "ayni.dwg", "ikinci parca");
        // Ad ayni olsa bile farkli asset kimligi farkli arsiv kaydidir; birlestirilmemeli.
        let b = hit(3, 20, "ayni.dwg", "baska kayit");
        let chunks = vec![&a1, &a2, &b];

        let prompt = build_prompt("soru", &chunks, &[]);
        assert!(prompt.contains("[1] (ayni.dwg)\nbirinci parca"));
        assert!(prompt.contains("[1] (ayni.dwg)\nikinci parca"));
        assert!(prompt.contains("[2] (ayni.dwg)\nbaska kayit"));

        let citations = build_citations(&chunks);
        assert_eq!(citations.len(), 2);
        assert_eq!(citations[0].asset_id, 10);
        assert_eq!(citations[0].index, 1);
        assert_eq!(citations[1].asset_id, 20);
        assert_eq!(citations[1].index, 2);

        let reframe = reframe_not_found(&chunks);
        assert!(reframe.contains("ilgili olabilecek 2 kaynak"));
        assert_eq!(reframe.matches("ayni.dwg").count(), 2);
    }

    /// Liste yolu icin ChunkHit uretici (asset_id = dosya kimligi).
    fn list_hit(chunk_id: i64, asset_id: i64) -> ChunkHit {
        ChunkHit {
            chunk_id,
            asset_id,
            file_name: format!("dosya{asset_id}.dwg"),
            path: format!("/x/dosya{asset_id}.dwg"),
            chunk_index: chunk_id,
            page: None,
            text: "metin".into(),
            score: 1.0,
        }
    }

    /// **Tam liste** (kesme yok) → baslik "N dosya bulundu" demeli; tekillestirme calismali.
    /// *(Regresyon: 2026-07-26'ya kadar tavan chunk biriminde oldugu icin ayni dosyanin 3 parcasi
    /// listeden 2 dosya YERDI — burada tekillestirmenin sayimi bozmadigini da kelepceliyoruz.)*
    #[test]
    fn direct_list_reports_exact_count_when_not_truncated() {
        // 3 dosya, biri 3 parcayla temsil ediliyor → 5 hit, 3 dosya.
        let hits = vec![
            list_hit(1, 10),
            list_hit(2, 10),
            list_hit(3, 10),
            list_hit(4, 20),
            list_hit(5, 30),
        ];
        let (answer, citations) = direct_file_list("hangi dosyada merdiven var", &hits);
        assert_eq!(citations.len(), 3, "ayni asset'in parcalari tek dosya sayilmali");
        assert!(answer.contains("3 dosya bulundu"), "kesilmeyen liste tam sayiyi vermeli: {answer}");
        assert!(!answer.contains("ilk"), "kesme yokken 'ilk N' denmemeli: {answer}");
    }

    /// **Dosya tavani asildi** → sessizce kesme YOK; baslik "ilk N" der ve Gezgin'e yonlendirir.
    #[test]
    fn direct_list_marks_truncation_when_file_cap_exceeded() {
        // LIST_MAX_FILES + 5 ayri dosya (her biri tek parca).
        let hits: Vec<ChunkHit> =
            (0..(LIST_MAX_FILES + 5)).map(|i| list_hit(i as i64, 1000 + i as i64)).collect();
        let (answer, citations) = direct_file_list("hangi dosyalarda beton var", &hits);
        assert_eq!(citations.len(), LIST_MAX_FILES, "gosterilen dosya tavanda kelepcelenmeli");
        assert!(
            answer.contains(&format!("ilk {LIST_MAX_FILES} dosya")),
            "kesilen liste 'ilk N dosya' demeli: {answer}"
        );
        assert!(answer.contains("Gezgin"), "tam liste icin yonlendirme olmali: {answer}");
        assert!(!answer.contains("dosya bulundu"), "kesik liste tam liste gibi sunulmamali");
    }

    /// **Havuz doydu** (chunk tavanina dayandik) → dosya sayisi tavanin ALTINDA olsa bile
    /// "daha fazlasi olabilir" denmeli: getirilmemis dosya olabilir, susmak yaniltir.
    #[test]
    fn direct_list_marks_truncation_when_chunk_pool_saturated() {
        // LIST_FETCH_CHUNKS parca, ama yalniz 3 ayri dosya → dosya tavani asilmadi.
        let hits: Vec<ChunkHit> =
            (0..LIST_FETCH_CHUNKS).map(|i| list_hit(i, 10 + (i % 3))).collect();
        let (answer, citations) = direct_file_list("hangi dosyalarda kolon var", &hits);
        assert_eq!(citations.len(), 3);
        assert!(
            answer.contains("ilk 3 dosya") && answer.contains("daha fazlası olabilir"),
            "havuz doyduysa belirsizlik soylenmeli: {answer}"
        );
    }

    /// Liste yolu icin AssetRow uretici (asset-seviyesi arama sonucu satiri).
    fn asset_row(id: i64, name: &str) -> AssetRow {
        AssetRow {
            id,
            path: format!("/x/{name}"),
            file_name: name.to_string(),
            ext: Some("pdf".into()),
            size_bytes: 10,
            mime: None,
            title: None,
            created_at: 1,
            modified_at: 1,
            indexed_at: None,
            favorite: false,
            snippet: None,
            ai_analyzed: false,
            ai_gorsel_turu: None,
            dominant_colors: Vec::new(),
            score: None,
        }
    }

    /// `list_answer`: toplam gosterilenden BUYUKSE baslik GERCEK TOPLAMI verir + "ilk M gösteriliyor"
    /// + Gezgin yonlendirmesi (kesme sessiz degil). H2 "toplam N" davranis pariti.
    #[test]
    fn list_answer_reports_true_total_with_truncation_notice() {
        let items: Vec<AssetRow> = (0..3).map(|i| asset_row(100 + i, &format!("f{i}.pdf"))).collect();
        let page = AssetPage { total: 137, items };
        let (answer, citations) = list_answer("kolon hangi dosyada", None, &page);
        assert_eq!(citations.len(), 3, "gosterim item sayisiyla sinirli");
        assert!(answer.contains("137 dosya bulundu"), "kesin TOPLAM basliga girer: {answer}");
        assert!(answer.contains("ilk 3 gösteriliyor"), "kesme acikca soylenir: {answer}");
        assert!(answer.contains("Gezgin"), "tam liste icin yonlendirme olmali: {answer}");
        assert!(answer.contains("- [1] f0.pdf"));
    }

    /// `list_answer`: toplam <= gosterilen → kesin sayi, kesme uyarisi YOK.
    #[test]
    fn list_answer_exact_count_when_not_truncated() {
        let items: Vec<AssetRow> = (0..2).map(|i| asset_row(10 + i, &format!("g{i}.pdf"))).collect();
        let page = AssetPage { total: 2, items };
        let (answer, _c) = list_answer("cephe nerede", None, &page);
        assert!(answer.contains("2 dosya bulundu"), "kesin sayi: {answer}");
        assert!(!answer.contains("ilk"), "kesme yokken 'ilk N' denmemeli: {answer}");
        assert!(!answer.contains("Gezgin"), "kesme yokken yonlendirme olmamali: {answer}");
    }

    /// Dosya-turu ipucu (⑤): `file_type_hint` H2 FILE_TYPE_HINTS pariti + `list_answer` basliginda
    /// tur etiketi. "pdf" → suzme uzantisi; "doc" → [doc,docx]; tur yoksa None + etiketsiz baslik.
    #[test]
    fn file_type_hint_detects_and_labels() {
        // Tespit: dosya-turu sozcugu (significant_tokens'da stop-word olsa da) RAW token'dan yakalanir.
        assert_eq!(file_type_hint("pdf şartname hangi dosyada"), Some(vec!["pdf".to_string()]));
        assert_eq!(
            file_type_hint("şartname hangi docx dosyasında"),
            Some(vec!["docx".to_string(), "doc".to_string()])
        );
        assert_eq!(file_type_hint("merdiven hangi dosyada"), None, "tur yoksa None");
        // Baslik etiketi: ext_hint verilince " (PDF)"; verilmeyince etiketsiz.
        let page = AssetPage { total: 2, items: vec![asset_row(1, "a.pdf"), asset_row(2, "b.pdf")] };
        let hint = vec!["pdf".to_string()];
        let (labeled, _c) = list_answer("şartname hangi pdf dosyasında", Some(&hint), &page);
        assert!(labeled.contains("(PDF)"), "baslikta tur etiketi olmali: {labeled}");
        let (plain, _c2) = list_answer("şartname hangi dosyada", None, &page);
        assert!(!plain.contains("(PDF)"), "ipucsuz baslikta etiket olmamali: {plain}");
    }

    /// 0-sonuc + dosya-turu ipucu → durust tur-kapsamli "bulunamadi" (gorsel fallback metni DEGIL).
    /// Regresyon: "pdf şartname" hicbir pdf'de bulunmayinca sistem gorsel (CLIP) fallback'e düşüp
    /// alakasiz JPG'ler donduruyordu (2026-07-27 canli bulgu); dokuman-turu ipucunda bu YANLIS.
    #[test]
    fn list_answer_zero_results_is_type_scoped_not_found() {
        let page = AssetPage { total: 0, items: Vec::new() };
        let hint = vec!["pdf".to_string()];
        let (answer, citations) = list_answer("şartname hangi pdf dosyasında", Some(&hint), &page);
        assert!(citations.is_empty());
        assert!(answer.contains("bulunamadı"), "durust bulunamadi: {answer}");
        assert!(answer.contains("(PDF)"), "tur etiketi korunmali: {answer}");
        assert!(!answer.contains("görsel"), "gorsel fallback metni OLMAMALI: {answer}");
    }

    #[test]
    fn reframe_keeps_sources_with_aligned_indices() {
        let h = |id: i64, name: &str| ChunkHit {
            chunk_id: id,
            asset_id: id,
            file_name: name.into(),
            path: format!("/x/{name}"),
            chunk_index: -1,
            page: None,
            text: "...".into(),
            score: 1.0,
        };
        let a = h(1, "villa.dwg");
        let b = h(2, "cephe.pdf");
        let chunks: Vec<&ChunkHit> = vec![&a, &b];
        let out = reframe_not_found(&chunks);
        // Sert "bulamadim" yerine durust cerceveleme + kaynak sayisi + hizali [N].
        assert!(!out.trim().eq(SENTINEL_NOT_FOUND));
        assert!(out.contains("ilgili olabilecek 2 kaynak"));
        assert!(out.contains("[1] villa.dwg"));
        assert!(out.contains("[2] cephe.pdf"));
        // Reframe edilmis metin artik "bulamadim sentinel'i" sayilmaz → tekrar tetiklenmez.
        assert!(!is_not_found_answer(&out));
    }
}
