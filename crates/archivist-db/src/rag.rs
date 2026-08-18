//! RAG retrieval (Artim 3) — hibrit chunk arama + keyword-gate. H2 ragService.retrieve pariti.
//!
//! Soru → (a) FTS-chunk adaylari (anlamli token'lar, stop-word'siz) + (b) semantik kNN
//! (chunk_vectors) → **RRF** füzyon → **keyword-gate** (sorgunun TUM anlamli token'larini
//! birebir [TR-normalize, kelime-siniri] geceni GARANTI ust sira; halusinasyon onleme) →
//! asset-basi cesitlilik (MAX_CHUNKS_PER_ASSET) + top-k. Cope atilmis asset HARIC.
//!
//! Ollama'siz calisir (saf retrieval): pasajlar (chunk metni + kaynak) doner. Ust katman
//! (Artim 4) bunlari prompt'a koyar / liste-cevabi yapar.

use std::collections::{HashMap, HashSet};

use rusqlite::params;

use crate::error::DbError;
use crate::query::{
    build_and_query, build_or_query, map_asset_row, AssetPage, FilterBinds, AI_A,
    AI_GORSEL_TURU_EXPR, COLS_A, DOMINANT_COLORS_EXPR, FAV_A, FILTER_FRAG,
};
use crate::semantic::{vec_to_blob, TEXT_EMBED_DIM};
use crate::{AnalysisScope, Db};

/// Bir retrieval isabeti — LLM baglami + atif (citation) icin gereken her sey.
/// `Deserialize` (LAN Faz 5): uzak host retrieval'i chunk'lari tel uzerinden gonderir; istemci
/// bunlari geri ayristirip `build_prompt`'a verir (uretim istemcide). Serialize/Deserialize ayni
/// `camelCase` seklinde → round-trip kararli.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkHit {
    pub chunk_id: i64,
    pub asset_id: i64,
    pub file_name: String,
    pub path: String,
    /// Govde parcasi sirasi (0,1,...); metadata chunk icin -1.
    pub chunk_index: i64,
    pub page: Option<i64>,
    pub text: String,
    /// Birlesik skor (RRF; keyword-gate isabetleri 1.0 taban). Yuksek = daha iyi.
    pub score: f64,
}

/// Retrieval tani (A5) — sorgu NEDEN bu sonuclari verdi (UI gozlem; "neden bulamadim" seffaf).
/// H2 `RetrieveDiagnostics` pariti. Salt-bilgi; retrieval davranisini DEGISTIRMEZ.
/// `Deserialize` (LAN Faz 5): uzak host tani'yi tel uzerinden gonderir; istemci UI'a tasir.
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveDiag {
    /// Sorgudan cikarilan anlamli token'lar (keyword-gate temeli; bos → cok genel/kisa sorgu).
    pub query_tokens: Vec<String>,
    /// Mimari sozlukle (A3) eklenen EK aday token sayisi.
    pub expanded_tokens: i64,
    /// FTS aday chunk sayisi (anahtar-kelime on-eslesme).
    pub fts_candidates: i64,
    /// Semantik (kNN) aday chunk sayisi.
    pub knn_candidates: i64,
    /// Keyword-gate'i gecen (TUM anlamli token'i birebir iceren) chunk sayisi.
    pub gated: i64,
    /// Fuzyon sonrasi benzersiz aday (top-k + asset-cap ONCESI).
    pub fused: i64,
    /// Dondurulen (top-k + asset-cap SONRASI) chunk sayisi.
    pub returned: i64,
}

const RRF_K: f64 = 60.0;
const MAX_CHUNKS_PER_ASSET: usize = 3;
const FTS_CANDIDATES: i64 = 300;
const KNN_CANDIDATES: i64 = 200;
/// kNN aday havuzunun **ust** siniri. Sagkalan aday (silinmis/`rag_excluded`/kapsam disi
/// elendikten sonra) hedef `k`'nin altinda kalirsa havuz 4'er kat buyutulerek yeniden sorulur;
/// bu sinira ya da tukenise kadar. Bkz `rag_search_with_diag` §2.
const KNN_CANDIDATES_MAX: i64 = 3200;

/// top-k kelepce: <=0 → 12 (H2 DEFAULT_TOP_K), ust sinir 200.
///
/// ⚠️ Ust sinir bir **kacak-koruma**dir (kotu bir cagiran 10_000 istemesin), urun limiti DEGIL.
/// 2026-07-26'da 50 → 200'e cikarildi: liste-niyeti yolu ("hangi dosyalarda X var") cevabi
/// chunk degil **DOSYA** listesidir ve `MAX_CHUNKS_PER_ASSET` yuzunden her dosya 3 chunk'a kadar
/// yer kaplar → 50'lik tavan pratikte ~17 dosyaya kadar dusebiliyordu. Cagiranlar kendi
/// (daha dar) degerlerini verir; bu tavan onlari etkilemez.
fn clamp_top_k(n: i64) -> usize {
    if n <= 0 {
        12
    } else {
        n.min(200) as usize
    }
}

/// Turkce-duyarli normalize: kucuk harf + aksanli/Turkce harf → ASCII (H2 normalizeTr pariti).
/// "İnşaat"→"insaat", "Mesut Akçan"→"mesut akcan". Turkce ozel harfler to_lowercase'den ONCE
/// elenir (or. 'İ'.to_lowercase() bilesik nokta uretir → istenmez).
pub fn normalize_tr(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'ı' | 'I' | 'İ' | 'i' => out.push('i'),
            'ç' | 'Ç' => out.push('c'),
            'ğ' | 'Ğ' => out.push('g'),
            'ö' | 'Ö' => out.push('o'),
            'ş' | 'Ş' => out.push('s'),
            'ü' | 'Ü' => out.push('u'),
            _ => out.extend(c.to_lowercase()),
        }
    }
    out
}

/// Yaygin/secici-olmayan kelimeler — keyword skorundan elenir (H2 STOP_WORDS pariti,
/// NORMALIZE edilmis: soru sozcukleri + arsiv meta-sozcukleri + dosya uzantilari + Ingilizce).
// ⚠️ H2 `ragService.ts:395 STOP_WORDS` SADIK PORTU (normalize/ASCII-folded biçim). significant_tokens
// TR-normalize edip len>=3 elediginden yalniz katlanmis (or. "nasıl"→"nasil", "dosyasında"→"dosyasinda")
// ve >=3 formlar anlamlidir; kisa formlar (mi/de/ki) zaten len suzgecinde duser. **2026-07-27 canli
// bulgu:** liste-cekim formlari eksikti — ozellikle "dosyalarda" (H2'de VARDI) → "minare hangi
// dosyalarda var" → `["minare","dosyalarda"]` → sohbet listesi Gezgin'den (3) sapip 37 aliyordu.
// Eksik port = H2'yi eksik inceleme dersi (bkz hafiza: prefer-h2-proven-structure).
const STOP_WORDS: &[&str] = &[
    // Soru sozcukleri (normalize)
    "kimdir", "nedir", "ne", "nerede", "nasil", "hangi", "hangisi", "var", "yok", "kac",
    "neden", "niye", "kim", "kimin",
    // Baglac/zamir
    "bir", "bu", "su", "ile", "icin", "olan", "icinde", "gecer", "bulunur", "ama", "fakat",
    "veya", "hem", "yani",
    // Arsiv meta-sozcukleri (her belgede gecer) — TUM cekim formlari (H2 pariti).
    "dosya", "dosyada", "dosyanin", "dosyalar", "dosyalarda", "dosyasinda", "dosyasinin",
    "belge", "belgede", "belgenin", "belgeler", "belgelerde", "dokuman", "dokumanda", "arsiv",
    "arsivde",
    // Dosya tipleri (filtre niyeti; her dosyayi cagirir) — H2 tam listesi.
    "dwg", "dxf", "dwf", "max", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "skp", "jpg",
    "jpeg", "png", "gif", "bmp", "tif", "tiff", "psd", "svg", "rvt", "ifc", "obj", "fbx", "3dm",
    "3ds", "stl", "mp4", "avi", "mov", "mkv",
    // Ingilizce
    "the", "and", "or", "of", "to", "in", "is", "are", "what", "who", "file", "files",
    "document", "documents",
];

/// Sorgudan anlamli token'lar: TR-normalize + alfanumerik-bol + len>=3 + stop-word disi + tekil.
pub fn significant_tokens(query: &str) -> Vec<String> {
    let norm = normalize_tr(query);
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for w in norm.split(|c: char| !c.is_alphanumeric()) {
        if w.chars().count() >= 3 && !STOP_WORDS.contains(&w) && seen.insert(w.to_string()) {
            out.push(w.to_string());
        }
    }
    out
}

/// Bir kelimenin BAS harfini Turkce dogru buyut ('i'→'İ', 'ı'→'I'). `to_uppercase` Turkce
/// bilmez ("izolasyon"→"Izolasyon" verirdi; dogrusu "İzolasyon").
fn capitalize_tr(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let upper = match first {
                'i' => "İ".to_string(),
                'ı' => "I".to_string(),
                c => c.to_uppercase().to_string(),
            };
            upper + chars.as_str()
        }
    }
}

/// Sorgudan **deterministik** oturum basligi (en cok 5 anlamli kelime).
///
/// H2 bunu LLM ile uretiyordu (`ragService.ts:2005 generateSessionTitle`) — H3 offline-first
/// oldugu icin **Ollama'siz da calisan** bir taban sart: ayni `STOP_WORDS` suzgeci, ama
/// normalize edilmis bicim DEGIL **orijinal** kelimeler korunur (baslik kullaniciya gorunur →
/// "yalitim" degil "yalıtım"). Boylece *"hangi dosyalarda yalıtım şartnamesi geçiyor"* →
/// **"Yalıtım şartnamesi"** (eski davranis: ilk 40 karakter → *"hangi dosyalarda yalıtım
/// şartnamesi ge…"*).
///
/// Anlamli kelime yoksa (yalniz stop-word/kisa sorgu) `None` → cagiran eski fallback'e duser.
pub fn session_title(query: &str) -> Option<String> {
    const MAX_WORDS: usize = 5;
    const MAX_CHARS: usize = 60;
    let mut seen = HashSet::new();
    let mut words: Vec<&str> = Vec::new();
    for w in query.split(|c: char| !c.is_alphanumeric()) {
        if w.is_empty() {
            continue;
        }
        let norm = normalize_tr(w);
        if norm.chars().count() >= 3 && !STOP_WORDS.contains(&norm.as_str()) && seen.insert(norm) {
            words.push(w);
            if words.len() == MAX_WORDS {
                break;
            }
        }
    }
    if words.is_empty() {
        return None;
    }
    let mut title = capitalize_tr(&words.join(" "));
    if title.chars().count() > MAX_CHARS {
        title = title.chars().take(MAX_CHARS).collect::<String>().trim_end().to_string() + "…";
    }
    Some(title)
}

/// chunk_fts MATCH sorgusu: anlamli token'lar `"tok" OR "tok2"...` (genis aday havuzu;
/// kesinlik keyword-gate + RRF'te). Token'lar ascii-alnum → tirnak guvenli.
fn build_chunk_fts_query(tokens: &[String]) -> String {
    tokens.iter().map(|t| format!("\"{t}\"")).collect::<Vec<_>>().join(" OR ")
}

/// Bir (normalize) metnin kelime kumesinde token TAM kelime olarak var mi (kelime-siniri:
/// "cam" → "camii" eslesMEZ, "cam profili" eslesir). H2 hasWordMatch pariti (regex'siz).
fn text_word_set(normalized: &str) -> HashSet<String> {
    normalized
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_string)
        .collect()
}

/// Hidrat verisi (chunk_id → satir alanlari).
#[derive(Clone)]
struct ChunkData {
    asset_id: i64,
    file_name: String,
    path: String,
    chunk_index: i64,
    page: Option<i64>,
    text: String,
}

impl Db {
    /// Hibrit RAG retrieval: `query` (metin; FTS + token) + `query_vec` (384, kNN) → en ilgili
    /// `top_k` chunk (keyword-gate + RRF + asset-cesitlilik; cope HARIC). Bos sorgu/sonuc → bos.
    /// Tani gerekmeyen cagiranlar icin ince sarmalayici (yalniz isabetleri doner).
    pub fn rag_search(
        &self,
        query: &str,
        query_vec: &[f32],
        top_k: i64,
    ) -> Result<Vec<ChunkHit>, DbError> {
        Ok(self.rag_search_with_diag(query, query_vec, top_k, &[], false, None)?.0)
    }

    /// Bir sohbet-KAPSAMINI (RAG scope) somut asset-id kumesine cevir (H2 `getScopeAssetIds` pariti).
    /// `All` → `None` (filtre yok = TUM arsiv; bugunku davranis, regresyon YOK). `Ids(ids)` →
    /// `Some(ids.clone())` (bos secim → `Some(bos)` → sonuc yok; dogru). `Filter(opts)` → `FILTER_FRAG`
    /// facet'ine (ext/tag/collection/favori/tarih/onay/proje/yol-onek) uyan **AKTIF** asset id'leri;
    /// FTS tam-metin `query` alani YOK SAYILIR (vision `AnalysisScope` semantigi — kapsam facet-tabanli).
    /// Donen kume `rag_search_with_diag(allowed)` + gorsel-fallback ile retrieval'in TUM yollarini sinirlar.
    pub fn scope_asset_ids(&self, scope: &AnalysisScope) -> Result<Option<Vec<i64>>, DbError> {
        match scope {
            AnalysisScope::All => Ok(None),
            AnalysisScope::Ids(ids) => Ok(Some(ids.clone())),
            AnalysisScope::Filter(opts) => {
                // list.rs deseni: FilterBinds::new(opts).params() adli param → FILTER_FRAG.
                let binds = FilterBinds::new(opts);
                let sql =
                    format!("SELECT a.id FROM assets a WHERE a.deleted_at IS NULL AND {FILTER_FRAG}");
                let mut stmt = self.conn.prepare(&sql)?;
                let ids = stmt
                    .query_map(binds.params().as_slice(), |r| r.get::<_, i64>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                Ok(Some(ids))
            }
        }
    }

    /// `rag_search` + retrieval tani (A5): isabetler **ve** `RetrieveDiag` (token/aday/gate/donen
    /// sayilari). Sohbet katmani tani'yi UI'a tasir ("neden bulamadim" seffaf). Davranis ayni.
    /// `extra_fts_terms`: LLM query-rewrite (A3) ile uretilen EK aday token'lar — yalniz FTS aday
    /// havuzunu buyutur (keyword-gate'e DOKUNMAZ, statik sozluk genislemesiyle ayni ilke).
    /// `keyword_only`: **liste-niyeti** ("X var mi / hangi dosyada") icin saf-semantik isabetleri
    /// ELE — yalniz FTS (anahtar-kelime/sozluk) eslesen dosyalar doner. Anahtar-kelime eslesmesi
    /// yoksa bos (yaniltici "N dosya bulundu" onlenir; or. gorsel-icerik sorusu → metin RAG bos).
    /// `allowed`: RAG **kapsam** filtresi (`scope_asset_ids` kumesi). `None` → sinirsiz (tum arsiv;
    /// bugunku davranis). `Some` → yalniz o asset id'leri: FTS aday SQL'inde JOIN kosuluna inline
    /// `IN (...)` (LIMIT'ten ONCE → recall dogru); kNN dalinda hidratasyon POST-filtresi (vec0
    /// MATCH once kosar — **brute-force kNN**, ANN DEGIL; bkz ROADMAP "Sirada"). Elenen aday
    /// recall'i dusurmesin diye havuz gerektiginde buyutulur (§2).
    /// `Some(bos)` → savunmaci `1=0` (bos `IN ()` SQL hatasi yok).
    pub fn rag_search_with_diag(
        &self,
        query: &str,
        query_vec: &[f32],
        top_k: i64,
        extra_fts_terms: &[String],
        keyword_only: bool,
        allowed: Option<&HashSet<i64>>,
    ) -> Result<(Vec<ChunkHit>, RetrieveDiag), DbError> {
        if query_vec.len() != TEXT_EMBED_DIM {
            return Err(DbError::Invalid(format!(
                "sorgu vektoru boyutu {} != {TEXT_EMBED_DIM}",
                query_vec.len()
            )));
        }
        let k = clamp_top_k(top_k);
        let sig = significant_tokens(query);
        // Aday-recall icin mimari sozluk genisletmesi (A3) + LLM query-rewrite ek token'lari.
        // Keyword-gate (§4) hala `sig`'i kullanir → genisleme sinonimleri ZORUNLU degil (yalniz
        // FTS aday havuzunu buyutur).
        let mut fts_tokens = crate::query_expand::expand_query_tokens(query, &sig);
        for t in extra_fts_terms {
            let nt = normalize_tr(t);
            if !nt.is_empty() && !fts_tokens.contains(&nt) {
                fts_tokens.push(nt);
            }
        }

        let mut diag = RetrieveDiag {
            query_tokens: sig.clone(),
            expanded_tokens: (fts_tokens.len() as i64 - sig.len() as i64).max(0),
            ..Default::default()
        };

        let mut data: HashMap<i64, ChunkData> = HashMap::new();

        // RAG kapsam SQL parcasi (FTS JOIN'ine, LIMIT'ten ONCE): `Some` → yalniz bu asset id'leri
        // (kendi i64'lerimiz → enjeksiyon yok; image.rs `where_frag` Ids deseni). `Some(bos)` →
        // savunmaci `1=0` (bos `IN ()` SQL hatasi yok). `None` → bos (sinirsiz; bugunku davranis).
        let scope_frag = match allowed {
            Some(ids) if !ids.is_empty() => {
                let list = ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
                format!(" AND a.id IN ({list})")
            }
            Some(_) => " AND 1=0".to_string(),
            None => String::new(),
        };

        // ── 1) FTS adaylari (rank sirali; aktif asset). Veriyi de buradan hidratla. ──
        let mut fts_order: Vec<i64> = Vec::new();
        if !sig.is_empty() {
            let mq = build_chunk_fts_query(&fts_tokens);
            // `{scope_frag}` JOIN kosuluna girer → kapsam LIMIT'ten ONCE uygulanir (recall dogru).
            let sql = format!(
                "SELECT cf.chunk_id, tc.asset_id, tc.chunk_index, tc.page, tc.text,
                        a.file_name, a.path
                 FROM chunk_fts cf
                 JOIN text_chunks tc ON tc.id = cf.chunk_id
                 JOIN assets a ON a.id = tc.asset_id AND a.deleted_at IS NULL AND a.rag_excluded = 0{scope_frag}
                 WHERE chunk_fts MATCH ?1
                 ORDER BY rank
                 LIMIT ?2"
            );
            // FTS5 sozdizimi guvenli (token'lar tirnakli) → hata beklenmiyor; yine de zarif dus
            // (hata → bos aday). stmt arm icinde yasar; rows.collect() ayni arm'da tuketir.
            let fts_rows: Vec<(i64, ChunkData)> = match self.conn.prepare(&sql) {
                Ok(mut stmt) => stmt
                    .query_map(params![mq, FTS_CANDIDATES], |r| {
                        Ok((
                            r.get::<_, i64>(0)?,
                            ChunkData {
                                asset_id: r.get(1)?,
                                chunk_index: r.get(2)?,
                                page: r.get(3)?,
                                text: r.get(4)?,
                                file_name: r.get(5)?,
                                path: r.get(6)?,
                            },
                        ))
                    })
                    .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
                    .unwrap_or_default(),
                Err(_) => Vec::new(),
            };
            for (cid, cd) in fts_rows {
                fts_order.push(cid);
                data.entry(cid).or_insert(cd);
            }
        }

        // ── 2) kNN adaylari (mesafe sirali). semantic.rs deseni: kNN AYRI, sonra hidratla. ──
        //
        // ⚠️ `chunk_vectors` bir vec0 sanal tablosudur: `deleted_at` / `rag_excluded` / kapsam
        // kosullari MATCH sorgusuna alinamaz → suzgec ancak hidratasyonda kosar. SABIT bir
        // `LIMIT`, cop ya da dislanmis chunk orani yuksek arsivde adaylarin buyuk kismini
        // eledigi icin **sessiz** geri-cagirim kaybi uretiyordu (2026-08-17 denetimi, Y4;
        // FTS dalinda ayni tuzak `scope_frag`'in LIMIT'ten ONCE baglanmasiyla zaten cozulmus).
        //
        // Cozum: sagkalan aday sayisi hedef `k`'nin altinda kaldigi surece havuzu 4'er kat
        // buyutup yeniden sor — ya yeterli aday birikir, ya havuz tukenir, ya da
        // `KNN_CANDIDATES_MAX` tavanina cikilir. Suzgecin hic elemedigi (temiz) arsivde ilk
        // tur yeterli oldugundan **ek sorgu maliyeti yoktur**; maliyet yalniz kaybin gercekten
        // yasandigi arsivde odenir.
        let qblob = vec_to_blob(query_vec);
        let mut knn_order: Vec<i64> = Vec::new();
        let mut knn_limit = KNN_CANDIDATES;
        loop {
            let knn_ids: Vec<i64> = {
                let mut stmt = self.conn.prepare(&format!(
                    "SELECT chunk_id FROM chunk_vectors WHERE embedding MATCH ?1
                     ORDER BY distance LIMIT {knn_limit}"
                ))?;
                // Ara `let` (tail-expression DEGIL) → stmt collect bitene kadar yasar (semantic.rs deseni).
                let ids = stmt
                    .query_map(params![&qblob], |r| r.get::<_, i64>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                ids
            };
            if knn_ids.is_empty() {
                break;
            }
            // Havuz istenen kadar dolmadiysa vektor tablosu tukenmistir → buyutmenin anlami yok.
            let exhausted = (knn_ids.len() as i64) < knn_limit;

            // kNN aday verilerini hidratla (aktif asset filtresi burada uygulanir).
            let id_list = knn_ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
            let sql = format!(
                "SELECT tc.id, tc.asset_id, tc.chunk_index, tc.page, tc.text, a.file_name, a.path
                 FROM text_chunks tc
                 JOIN assets a ON a.id = tc.asset_id AND a.deleted_at IS NULL AND a.rag_excluded = 0
                 WHERE tc.id IN ({id_list})"
            );
            let mut stmt = self.conn.prepare(&sql)?;
            let mut hydrated: HashMap<i64, ChunkData> = HashMap::new();
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    ChunkData {
                        asset_id: r.get(1)?,
                        chunk_index: r.get(2)?,
                        page: r.get(3)?,
                        text: r.get(4)?,
                        file_name: r.get(5)?,
                        path: r.get(6)?,
                    },
                ))
            })?;
            for row in rows {
                let (cid, cd) = row?;
                hydrated.insert(cid, cd);
            }
            // Yeniden sorguda onceki turun sirasi tekrarlanmasin (yeni tur eskinin ust-kumesi).
            knn_order.clear();
            // kNN sirasini koru, yalniz aktif (hidrat edilen) id'ler.
            for cid in &knn_ids {
                if let Some(cd) = hydrated.remove(cid) {
                    // Kapsam (scope) POST-filtresi: vec0 MATCH once kosar → kapsam disi asset'i burada ele.
                    if allowed.is_some_and(|s| !s.contains(&cd.asset_id)) {
                        continue;
                    }
                    knn_order.push(*cid);
                    data.entry(*cid).or_insert(cd);
                }
            }

            if exhausted || knn_order.len() >= k || knn_limit >= KNN_CANDIDATES_MAX {
                break;
            }
            knn_limit = (knn_limit * 4).min(KNN_CANDIDATES_MAX);
        }

        diag.fts_candidates = fts_order.len() as i64;
        diag.knn_candidates = knn_order.len() as i64;

        if data.is_empty() {
            return Ok((Vec::new(), diag));
        }

        // ── 3) RRF füzyon: chunk_id → skor (FTS sirasi + kNN sirasi). ──
        let mut score: HashMap<i64, f64> = HashMap::new();
        for (rank, cid) in fts_order.iter().enumerate() {
            *score.entry(*cid).or_insert(0.0) += 1.0 / (RRF_K + rank as f64 + 1.0);
        }
        for (rank, cid) in knn_order.iter().enumerate() {
            *score.entry(*cid).or_insert(0.0) += 1.0 / (RRF_K + rank as f64 + 1.0);
        }
        diag.fused = score.len() as i64;

        // ── 4) Keyword-gate: TUM anlamli token'lari birebir gecen FTS chunk'lari ust sira. ──
        let mut gated: Vec<i64> = Vec::new();
        if !sig.is_empty() {
            for cid in &fts_order {
                if let Some(cd) = data.get(cid) {
                    let words = text_word_set(&normalize_tr(&cd.text));
                    if sig.iter().all(|t| words.contains(t)) {
                        gated.push(*cid);
                    }
                }
            }
        }
        let gated_set: HashSet<i64> = gated.iter().copied().collect();
        diag.gated = gated.len() as i64;

        // ── 5) Sirala: once gated (FTS sirasinda), sonra RRF skor azalan; asset-basi cap + top-k. ──
        let mut ranked: Vec<i64> = score.keys().copied().collect();
        ranked.sort_by(|a, b| {
            let sa = score.get(a).copied().unwrap_or(0.0);
            let sb = score.get(b).copied().unwrap_or(0.0);
            sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(b))
        });
        // keyword_only (liste-niyeti): saf-semantik (FTS'te olmayan) adaylari ELE → yalniz
        // anahtar-kelime/sozluk eslesen dosyalar. gated zaten FTS-kaynakli (subset).
        let fts_set: HashSet<i64> = fts_order.iter().copied().collect();
        let ordered = gated.iter().copied().chain(
            ranked
                .into_iter()
                .filter(|c| !gated_set.contains(c) && (!keyword_only || fts_set.contains(c))),
        );

        let mut per_asset: HashMap<i64, usize> = HashMap::new();
        let mut out: Vec<ChunkHit> = Vec::with_capacity(k);
        let mut taken: HashSet<i64> = HashSet::new();
        for cid in ordered {
            if out.len() >= k {
                break;
            }
            if !taken.insert(cid) {
                continue;
            }
            let Some(cd) = data.get(&cid) else { continue };
            let cnt = per_asset.entry(cd.asset_id).or_insert(0);
            if *cnt >= MAX_CHUNKS_PER_ASSET {
                continue;
            }
            *cnt += 1;
            let hit_score = if gated_set.contains(&cid) {
                1.0
            } else {
                score.get(&cid).copied().unwrap_or(0.0)
            };
            out.push(ChunkHit {
                chunk_id: cid,
                asset_id: cd.asset_id,
                file_name: cd.file_name.clone(),
                path: cd.path.clone(),
                chunk_index: cd.chunk_index,
                page: cd.page,
                text: cd.text.clone(),
                score: hit_score,
            });
        }
        diag.returned = out.len() as i64;
        Ok((out, diag))
    }

    /// Liste-niyeti ("hangi dosyalarda X var / X nerede") ASSET-seviyesi FTS arama + **GERCEK TOPLAM**.
    ///
    /// ⚠️ H2 `directFileListAnswer` DAVRANIS pariti (*"…N dosya bulundu (ilk M gösteriliyor, toplam N)"*)
    /// ama H2'nin YONTEMI (`getAllAssets` → renderer-bellekte tam tarama) DEGIL: `assets_fts` uzerinde
    /// SQL `COUNT` + `LIMIT` (renderer DB tutmaz + milyon-olcek — H2'den ders). `assets_fts.body`
    /// cikarilan belge icerigini de tasidigindan tek MATCH hem dosya-adi/baslik/betim (meta+ai) hem
    /// belge-govdesini (file) kapsar → Gezgin ana arama kutusuyla **AYNI indeks + AYNI ifade**, boylece
    /// *"tam liste icin Gezgin'de arayin"* birebir tutarli (kullanici ayni terimi Gezgin'e yazinca ayni
    /// toplami gorur).
    ///
    /// **Iki katman (Gezgin `list_assets` ile ayni desen):**
    /// 1. Birincil: anlamli token'lar implicit-AND onek MATCH (`build_and_query`) — KESIN, Gezgin
    ///    birincil aramasiyla ayni.
    /// 2. Toplam 0 ise mimari-sozluk (ARCH_SYNONYMS) OR fallback (`build_or_query`) — yalniz kesin
    ///    eslesme HIC yoksa (tam eslesmeleri kirletmez; `list.rs::synonym_fallback_query` ilkesi).
    ///
    /// `total` = eslesen AKTIF + **rag-dahil** (rag_excluded=0), kapsam-ici, hassasiyet-disi asset
    /// sayisi. `items` = FTS `rank` sirali ilk `limit` asset (snippet dolu → "neden" onizlemesi).
    /// Anlamli token yoksa `Ok(None)` → cagiran chunk/RAG yoluna duser (H2 da `null` donerdi).
    ///
    /// `ext_hint`: dosya-turu suzgeci (⑤; H2 FILE_TYPE_HINTS) — `Some(["pdf"])` → yalniz o uzanti(lar);
    /// `None`/bos → tur filtresi yok. `allowed`: RAG kapsam kumesi (`scope_asset_ids`). `None` → sinirsiz
    /// (tum arsiv). `Some(bos)` → savunmaci `1=0` (kapsam bos → sonuc yok). `sens_excluded`: hassasiyet
    /// OTO-disla id kumesi (A1).
    pub fn list_intent_search(
        &self,
        query: &str,
        ext_hint: Option<&[String]>,
        allowed: Option<&HashSet<i64>>,
        sens_excluded: &HashSet<i64>,
        limit: i64,
    ) -> Result<Option<AssetPage>, DbError> {
        let sig = significant_tokens(query);
        if sig.is_empty() {
            return Ok(None);
        }
        let limit = limit.clamp(1, 500);

        // Kapsam + hassasiyet SQL parcasi (rag_search_with_diag scope_frag deseni; kendi
        // i64'lerimiz → enjeksiyon yok). Some(bos) → `1=0` (bos `IN ()` SQL hatasi yerine sonuc yok).
        let scope_frag = match allowed {
            Some(ids) if !ids.is_empty() => {
                let list = ids.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
                format!(" AND a.id IN ({list})")
            }
            Some(_) => " AND 1=0".to_string(),
            None => String::new(),
        };
        let sens_frag = if sens_excluded.is_empty() {
            String::new()
        } else {
            let list = sens_excluded.iter().map(i64::to_string).collect::<Vec<_>>().join(",");
            format!(" AND a.id NOT IN ({list})")
        };
        // Dosya-turu ipucu (⑤, H2 FILE_TYPE_HINTS): sorguda tur gecerse yalniz o uzanti(lar) —
        // `lower(a.ext)` ile buyuk/kucuk fark etmez. Uzanti listesi sabit FILE_TYPE_HINTS'ten gelir
        // (ascii-alnum) → guvenli; yine de tirnak-kacisi defansif. Bos/None → filtre yok.
        let ext_frag = match ext_hint {
            Some(exts) if !exts.is_empty() => {
                let list = exts
                    .iter()
                    .map(|e| format!("'{}'", e.to_lowercase().replace('\'', "''")))
                    .collect::<Vec<_>>()
                    .join(",");
                format!(" AND lower(a.ext) IN ({list})")
            }
            _ => String::new(),
        };
        let extra = format!("{scope_frag}{sens_frag}{ext_frag}");

        // Birincil: kesin (implicit-AND onek). Anlamli token'lar ascii-alnum → FTS5 sozdizimi guvenli.
        let primary = build_and_query(&sig);
        let mut page = self.fts_asset_page(&primary, &extra, limit)?;

        // Sozluk (ARCH_SYNONYMS) FALLBACK: yalniz kesin eslesme HIC yoksa (total 0) VE genisleme
        // tetiklendiyse OR'lu onek ile bir kez daha dene (recall; tam eslesmeleri kirletmez).
        if page.total == 0 {
            let expanded = crate::query_expand::expand_query_tokens(query, &sig);
            if expanded.len() > sig.len() {
                let mq = build_or_query(&expanded);
                if !mq.is_empty() {
                    let alt = self.fts_asset_page(&mq, &extra, limit)?;
                    if alt.total > 0 {
                        page = alt;
                    }
                }
            }
        }
        Ok(Some(page))
    }

    /// `list_intent_search` ic yordami: verilen FTS MATCH ifadesiyle `assets_fts` uzerinde
    /// COUNT (gercek toplam) + rank-sirali ilk `limit` satir. `extra_where`: aktif+rag-dahil'e EK
    /// (kapsam + hassasiyet + dosya-turu) — cagiran birlestirip verir. Gezgin `list_filtered` FTS
    /// JOIN'i + ek `rag_excluded=0` suzgeci. `map_asset_row` 14 sutun bekler (COLS_A 0..9, favorite
    /// 10, snippet 11, ai_analyzed 12, ai_gorsel_turu 13).
    fn fts_asset_page(
        &self,
        match_q: &str,
        extra_where: &str,
        limit: i64,
    ) -> Result<AssetPage, DbError> {
        let where_sql = format!(
            "assets_fts MATCH ?1 AND a.deleted_at IS NULL AND a.rag_excluded = 0{extra_where}"
        );
        let total: i64 = self.conn.query_row(
            &format!(
                "SELECT count(*) FROM assets_fts JOIN assets a ON a.id = assets_fts.asset_id
                 WHERE {where_sql}"
            ),
            params![match_q],
            |r| r.get(0),
        )?;
        if total == 0 {
            return Ok(AssetPage { total: 0, items: Vec::new() });
        }
        let sql = format!(
            "SELECT {COLS_A}, {FAV_A}, snippet(assets_fts, -1, char(2), char(3), '…', 12), {AI_A},
                    {AI_GORSEL_TURU_EXPR}, {DOMINANT_COLORS_EXPR}
             FROM assets_fts JOIN assets a ON a.id = assets_fts.asset_id
             WHERE {where_sql}
             ORDER BY rank LIMIT ?2"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let items = stmt
            .query_map(params![match_q, limit], map_asset_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(AssetPage { total, items })
    }

    /// Asset'leri RAG'den MANUEL disla / dahil et (hassasiyet filtresi manuel istisnasi, A1).
    /// Editor+ (komut katmaninda gate). `excluded=true` → rag_search artik bu asset'in parcalarini
    /// getirmez. Etkilenen satir sayisi doner. Bos ids → 0.
    pub fn set_rag_excluded(&self, ids: &[i64], excluded: bool) -> Result<usize, DbError> {
        if ids.is_empty() {
            return Ok(0);
        }
        let ph = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("UPDATE assets SET rag_excluded = ? WHERE id IN ({ph})");
        let flag: i64 = i64::from(excluded);
        let mut p: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(ids.len() + 1);
        p.push(&flag);
        for id in ids {
            p.push(id);
        }
        Ok(self.conn.execute(&sql, p.as_slice())?)
    }

    /// Bir asset'in RAG'den manuel dislanip dislanmadigi (detay "Parçalar" sekmesi toggle durumu).
    pub fn is_rag_excluded(&self, id: i64) -> Result<bool, DbError> {
        Ok(self
            .conn
            .query_row("SELECT rag_excluded FROM assets WHERE id = ?1", params![id], |r| {
                r.get::<_, i64>(0)
            })?
            != 0)
    }

    /// Verilen anahtar-kelimelerden HERHANGI biri govde metninde (assets_fts) gecen AKTIF asset
    /// id'leri (hassasiyet OTO-tespiti, A1). Cok-kelimeli kw → FTS phrase. Bos kw → bos sonuc.
    /// FTS sozdizimi hatasinda zarif dus (bos → hicbir sey dislanmaz; hata sohbeti bozmaz).
    pub fn assets_matching_keywords(&self, keywords: &[String]) -> Result<Vec<i64>, DbError> {
        let phrases: Vec<String> = keywords
            .iter()
            .map(|k| k.trim())
            .filter(|k| !k.is_empty())
            .map(|k| format!("\"{}\"", k.replace('"', "\"\"")))
            .collect();
        if phrases.is_empty() {
            return Ok(Vec::new());
        }
        let mq = phrases.join(" OR ");
        let sql = "SELECT DISTINCT fts.asset_id FROM assets_fts fts
                   JOIN assets a ON a.id = fts.asset_id AND a.deleted_at IS NULL
                   WHERE assets_fts MATCH ?1";
        match self.conn.prepare(sql) {
            Ok(mut stmt) => Ok(stmt
                .query_map(params![mq], |r| r.get::<_, i64>(0))
                .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
                .unwrap_or_default()),
            Err(_) => Ok(Vec::new()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_tr_folds_turkish() {
        assert_eq!(normalize_tr("İnşaat ÇÖĞÜŞ"), "insaat cogus");
        assert_eq!(normalize_tr("Mesut Akçan"), "mesut akcan");
        assert_eq!(normalize_tr("MERDİVEN"), "merdiven");
    }

    #[test]
    fn significant_tokens_drops_stopwords_and_short() {
        // "merdiven hangi dwg dosyasinda" → yalniz "merdiven" (hangi/dwg stop, dosyasinda? len>=3
        // ama stop degil → kalir; "dosyada" stop ama "dosyasinda" listede degil). Test sade tutuldu.
        let toks = significant_tokens("Merdiven hangi DWG dosyada");
        assert!(toks.contains(&"merdiven".to_string()));
        assert!(!toks.contains(&"hangi".to_string()), "soru sozcugu elenmeli");
        assert!(!toks.contains(&"dwg".to_string()), "dosya tipi elenmeli");
        assert!(!toks.contains(&"dosyada".to_string()), "arsiv meta-sozcugu elenmeli");
    }

    /// H2 STOP_WORDS pariti (regresyon): dogal-dil liste sorusundaki TUM soru/arsiv-meta
    /// sozcukleri elenmeli → geriye yalniz gercek arama terimi kalmali. **2026-07-27 canli bulgu:**
    /// "dosyalarda" H3'un listesinde YOKTU (H2'de vardi) → "minare hangi dosyalarda var" →
    /// `["minare","dosyalarda"]` → sohbet listesi Gezgin'den (3) sapip 37 aliyordu.
    #[test]
    fn significant_tokens_strip_all_question_and_meta_forms() {
        assert_eq!(significant_tokens("minare hangi dosyalarda var"), vec!["minare".to_string()]);
        assert_eq!(significant_tokens("cephe hangi belgelerde geçer"), vec!["cephe".to_string()]);
        assert_eq!(significant_tokens("villa hangi dosyasında bulunur"), vec!["villa".to_string()]);
        // Cok-degerli dogru sonuc korunur (sadece gurultu elenir, gercek terim degil).
        assert_eq!(
            significant_tokens("minare korkuluk hangi dosyalarda"),
            vec!["minare".to_string(), "korkuluk".to_string()]
        );
    }

    /// §3: baslik ORIJINAL yazimi korur (normalize edilmis bicim kullaniciya gosterilmez) ve
    /// stop-word gurultusunu atar. Eski davranis `q.slice(0,40)` kirik basliklar uretiyordu.
    #[test]
    fn session_title_keeps_original_spelling_and_drops_noise() {
        assert_eq!(
            session_title("hangi dosyalarda yalıtım şartnamesi geçiyor"),
            Some("Yalıtım şartnamesi geçiyor".to_string())
        );
        // Tur sozcugu (pdf) + soru sozcukleri elenir; gercek terim kalir.
        assert_eq!(session_title("pdf şartname hangi dosyada"), Some("Şartname".to_string()));
    }

    /// Turkce buyuk-harf tuzagi: 'i'→'İ' (to_uppercase "Izolasyon" verirdi).
    #[test]
    fn session_title_capitalizes_turkish_i() {
        assert_eq!(session_title("izolasyon detayı"), Some("İzolasyon detayı".to_string()));
        assert_eq!(session_title("ısı yalıtımı"), Some("Isı yalıtımı".to_string()));
    }

    /// Anlamli kelime yoksa None → cagiran fallback'e duser (bos baslik URETILMEZ).
    #[test]
    fn session_title_none_when_only_stopwords() {
        assert_eq!(session_title("hangi dosyada var"), None);
        assert_eq!(session_title("   "), None);
    }

    /// En cok 5 kelime + 60 karakter tavani (oturum listesi kirilmasin).
    #[test]
    fn session_title_caps_word_and_char_count() {
        let t = session_title("merdiven korkuluk cephe kaplama zemin tavan kolon").unwrap();
        assert_eq!(t, "Merdiven korkuluk cephe kaplama zemin", "en cok 5 kelime");
        let long = session_title(
            "olağanüstü uzunlukta bir terim daha uzun devam ediyor",
        )
        .unwrap();
        assert!(long.chars().count() <= 61, "60 karakter + elips tavani: {long}");
    }
}
