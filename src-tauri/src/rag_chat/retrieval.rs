//! Retrieval-zenginlestirme (opsiyonel, Ollama gerektirir): hassasiyet oto-disla kelime
//! listesi (A1), LLM query-rewrite (A3) ve LLM rerank (A2). Ollama yoksa cagiranlar graceful
//! atlar (retrieval/cevap yine calisir). Parse yardimcisi saf/test edilebilir.

use archivist_db::{significant_tokens, ChunkHit};

use crate::ollama;

/// Rerank aday-listesi snippet uzunlugu (H2 RERANK_SNIPPET).
const RERANK_SNIPPET: usize = 280;
/// Query-rewrite (A3 LLM) bypass esigi: bu kadar cok anlamli token → sorgu zaten spesifik,
/// genisletme atlanir (H2 QUERY_REWRITE_MAX_SIGTOKENS).
const QUERY_REWRITE_MAX_SIGTOKENS: usize = 5;

/// Hassasiyet kategorileri → anahtar-kelime listeleri (H2 SENSITIVITY_CATEGORIES sadik port).
/// Kelimeler sunucu-tarafi (frontend yalniz kategori adlarini + ozel kelimeleri yollar).
const SENSITIVITY_CATEGORIES: &[(&str, &[&str])] = &[
    (
        "financial",
        &[
            "maaş", "fatura", "teklif", "bütçe", "ödeme", "maliyet", "hakediş", "keşif", "gelir",
            "gider", "banka", "iban",
        ],
    ),
    ("personal", &["tc kimlik", "nüfus", "telefon", "adres", "doğum", "ehliyet", "pasaport"]),
    (
        "legal",
        &["sözleşme", "nda", "gizlilik", "mahkeme", "ihtarname", "vekaletname", "noter", "dava"],
    ),
    ("hr", &["özlük", "izin", "sicil", "performans", "disiplin", "işe alım", "mülakat"]),
];

/// Etkin kategorilerin kelimeleri + kullanici-ozel kelimeler → tek hassasiyet kelime listesi.
pub(super) fn sensitivity_keyword_list(categories: &[String], custom: &[String]) -> Vec<String> {
    let mut kws: Vec<String> = Vec::new();
    for (cat, words) in SENSITIVITY_CATEGORIES {
        if categories.iter().any(|c| c.eq_ignore_ascii_case(cat)) {
            kws.extend(words.iter().map(|w| (*w).to_string()));
        }
    }
    for k in custom {
        let t = k.trim();
        if !t.is_empty() {
            kws.push(t.to_string());
        }
    }
    kws
}

/// H2 enrichQuery (A3 LLM) sadik port: KISA/genel sorguda Ollama ile mimari es-anlamli + EN
/// karsilik uret → EK FTS aday token'lari (orijinal sorgu korunur; keyword-gate'e GITMEZ). Spesifik
/// sorgu (sig > esik) / Ollama hata / bos sonuc → bos vec (genisleme yok). Yalniz aday-recall.
pub(super) fn enrich_query(model: &str, query: &str) -> Vec<String> {
    let sig = significant_tokens(query);
    if sig.is_empty() || sig.len() > QUERY_REWRITE_MAX_SIGTOKENS {
        return Vec::new();
    }
    let prompt = format!(
        "/no_think\n\
         Görev: Aşağıdaki Türkçe arama sorgusunu, mimari/inşaat arşivinde arama için zenginleştir. \
         Eş anlamlılar, ilgili teknik terimler ve varsa İngilizce karşılıklarını ekle. Orijinal \
         kelimeleri MUTLAKA koru.\n\
         KURALLAR: Sadece zenginleştirilmiş arama metnini yaz. En fazla 12 kelime. Kelimeleri \
         boşlukla ayır; virgül/tırnak/açıklama yok.\n\n\
         ÖRNEKLER:\n\
         Sorgu: merdiven\nCevap: merdiven basamak korkuluk stair staircase\n\
         Sorgu: zemin kat planı\nCevap: zemin kat planı kat planı plan ground floor plan\n\n\
         Sorgu: {query}\nCevap:"
    );
    let raw = match ollama::generate(model, &prompt, 0.2, 40, 15) {
        Ok(r) if !r.trim().is_empty() => r,
        _ => return Vec::new(),
    };
    // Yeni anlamli token'lar (orijinal sig HARIC) → ek aday terimler.
    significant_tokens(&raw).into_iter().filter(|t| !sig.contains(t)).collect()
}

/// H2 llmRerank (A2) sadik port: aday chunk'lari numarali liste olarak LLM'e ver → "en yararli
/// {keep}" numarayi CSV iste → o sira. Parse/Ollama hata → ORIJINAL sira (graceful). Donen: `hits`
/// icin yeniden sirali INDEKS listesi (TUM adaylari kapsar; cagiran ilk `keep`'i alir).
pub(super) fn llm_rerank(model: &str, query: &str, hits: &[ChunkHit], keep: usize) -> Vec<usize> {
    let n = hits.len();
    let identity: Vec<usize> = (0..n).collect();
    if n <= keep {
        return identity;
    }
    let list_block: String = hits
        .iter()
        .enumerate()
        .map(|(i, h)| {
            let snip: String = h.text.chars().take(RERANK_SNIPPET).collect();
            format!("[{}] {}", i + 1, snip)
        })
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!(
        "/no_think\n\
         Görevin: Aşağıdaki soruyu cevaplamak için EN YARARLI {keep} METİN PARÇASINI seç ve \
         numaralarını alakadan çok-aza doğru sırala.\n\n\
         SORU: {query}\n\n\
         PARÇALAR:\n{list_block}\n\n\
         Cevap BİÇİMİ: Sadece virgülle ayrılmış parça numaraları (en fazla {keep}), tek satır. \
         Açıklama yok. Örnek: 3,1,7\n\n\
         CEVAP:"
    );
    let raw = match ollama::generate(model, &prompt, 0.1, 80, 25) {
        Ok(r) => r,
        Err(_) => return identity,
    };
    parse_rerank_order(&raw, n)
}

/// LLM rerank yanitindan 0-indeks sira uret (saf; test edilebilir). Yanittan sayilari SIRAYLA
/// cikar (1-indeks), gecerli/benzersiz olanlari al; eksik kalan indeksleri orijinal sirada sona
/// ekle (H2: kalan slotlar orijinal sirayla). Sayi yoksa → identite (0..n).
fn parse_rerank_order(raw: &str, n: usize) -> Vec<usize> {
    let mut order: Vec<usize> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for part in raw.split(|c: char| !c.is_ascii_digit()) {
        if let Ok(num) = part.parse::<usize>() {
            if (1..=n).contains(&num) && seen.insert(num - 1) {
                order.push(num - 1);
            }
        }
    }
    if order.is_empty() {
        return (0..n).collect();
    }
    for i in 0..n {
        if !seen.contains(&i) {
            order.push(i);
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rerank_order_parses_csv_and_fills_remaining() {
        // n=5, yanit "3,1,7" → 3,1 gecerli (7>5 elendi) → [2,0]; kalan 1,3,4 orijinal sirada eklenir.
        assert_eq!(parse_rerank_order("3,1,7", 5), vec![2, 0, 1, 3, 4]);
        // Aciklamali yanit → yine sayilar cikar.
        assert_eq!(parse_rerank_order("Cevap: 2, 4", 4), vec![1, 3, 0, 2]);
        // Tekrar eden sayi bir kez alinir.
        assert_eq!(parse_rerank_order("1,1,2", 3), vec![0, 1, 2]);
    }

    #[test]
    fn rerank_order_empty_or_garbage_is_identity() {
        assert_eq!(parse_rerank_order("", 3), vec![0, 1, 2]);
        assert_eq!(parse_rerank_order("hiç sayı yok", 3), vec![0, 1, 2]);
    }

    #[test]
    fn sensitivity_keywords_resolve_categories_and_custom() {
        let cats = vec!["financial".to_string(), "legal".to_string()];
        let custom = vec!["proje gizli".to_string(), "  ".to_string()];
        let kws = sensitivity_keyword_list(&cats, &custom);
        assert!(kws.contains(&"fatura".to_string()), "financial kategorisi kelimeleri");
        assert!(kws.contains(&"sözleşme".to_string()), "legal kategorisi kelimeleri");
        assert!(kws.contains(&"proje gizli".to_string()), "ozel kelime eklenir");
        assert!(!kws.contains(&"özlük".to_string()), "secilmeyen kategori (hr) girmez");
        assert!(!kws.iter().any(|k| k.trim().is_empty()), "bos ozel kelime atlanir");
    }

    #[test]
    fn sensitivity_disabled_yields_no_keywords() {
        assert!(sensitivity_keyword_list(&[], &[]).is_empty());
    }
}
