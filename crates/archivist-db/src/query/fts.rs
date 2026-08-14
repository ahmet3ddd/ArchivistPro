//! FTS5 MATCH ifadesi uretimi: kullanici sorgusundan boolean/tumce/paren-destekli
//! (guvenli geri-dususlu) sorgu + bulanik arama icin ciplak terim ayiklama. Saf metin
//! islemleri (rusqlite bagimsiz); `build_match_query`/`fts_query` `pub(crate)` → hibrit
//! arama (semantic.rs) `crate::query::` yoluyla list_assets ile AYNI ifadeyi kurar.

/// Guvenli (geri-dusus) FTS5 MATCH ifadesi: her token cift-tirnakli (FTS5 ozel
/// karakterleri literal olur) → implicit AND. Bos girdi → bos string. Boolean'in
/// hatali oldugu durumda (build_match_query syntax hatasi) bu kullanilir.
/// `pub(crate)`: hibrit arama (semantic.rs) FTS aday listesini ayni guvenli ifadeyle kurar.
pub(crate) fn fts_query(raw: &str) -> String {
    raw.split_whitespace()
        .map(quote_term)
        .collect::<Vec<_>>()
        .join(" ")
}

/// Bir terimi/tumceyi guvenli FTS5 dizgesi yap (cift-tirnak ikile → literal).
fn quote_term(t: &str) -> String {
    format!("\"{}\"", t.replace('"', "\"\""))
}

/// Bu uzunluktan (dahil) itibaren bare kelimeler FTS5 ONEK sorgusu (`"term"*`) olur → Turkce
/// ek/cekim yakalanir ("bulut"* → bulutlu/bulutlar). Kisa/belirsiz koku (or. "kat"→katman,
/// "cam"→cami) ONEK YAPMA → asiri-eslesme onlenir; kisa terim TAM eslesir.
const MIN_PREFIX_LEN: usize = 4;

/// Bare kelimeyi guvenli FTS5 dizgesine cevir; `>= MIN_PREFIX_LEN` ise ONEK (`"term"*`).
/// unicode61 tokenizer diakritigi SORGU-tarafinda da katlar → ham TR terim ("cini") indeksteki
/// katlanmis token'la eslesir; onek onun uzerine "ile-baslayan"i ekler ("cini"* → cinili).
fn quote_prefixed(w: &str) -> String {
    let q = quote_term(w);
    if w.chars().count() >= MIN_PREFIX_LEN {
        format!("{q}*")
    } else {
        q
    }
}

/// Token listesinden OR'lu ONEK FTS5 MATCH: `"t1"* OR "t2"* ...` (her token length-gated onek).
/// Sozluk-genisletme (ARCH_SYNONYMS) fallback'i icin (list_assets 0-sonuc → "daha genis dene").
/// Bos liste → bos string. Token'lar zaten normalize-edilmis gelir (`expand_query_tokens`).
pub(crate) fn build_or_query(tokens: &[String]) -> String {
    tokens
        .iter()
        .filter(|t| !t.is_empty())
        .map(|t| quote_prefixed(t))
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// Token listesinden **implicit-AND** ONEK FTS5 MATCH: `"t1"* "t2"* ...` (FTS5'te bosluk = AND).
/// Liste-niyeti asset aramasi (`rag::list_intent_search`) icin — `build_match_query`'nin ciplak-terim
/// ciktisiyla BIREBIR AYNI bicim (quote + length-gated onek + implicit AND), boylece ayni anlamli
/// token kumesi Gezgin ana arama kutusunda da AYNI toplami verir ("tam liste icin Gezgin'de arayin"
/// tutarli). Bos liste → bos string. Token'lar zaten normalize gelir (`significant_tokens`).
pub(crate) fn build_and_query(tokens: &[String]) -> String {
    tokens
        .iter()
        .filter(|t| !t.is_empty())
        .map(|t| quote_prefixed(t))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Boolean/tumce-destekli FTS5 MATCH ifadesi uret (kullanici sorgusundan):
/// - `AND` / `OR` / `NOT` (buyuk/kucuk fark etmez) → FTS5 operatoru, ANCAK yalniz
///   iki yaninda da operand uretebilen bir token (literal kelime / tumce / `)` solda,
///   `(` sagda) varsa. Aksi halde rezerve kelime LITERAL terim olarak tirnaklanir
///   (or. tek basina `and`, asili/bitisik operatorler) — boylece kullanici "and"/"or"
///   kelimesini gercekten arayabilir ve sessiz-yanlis sonuc olmaz.
/// - `"..."` → tumce (ifade aynen, tirnaklanir; TAM eslesme — kullanici acik tirnak niyeti).
/// - `(` `)` → gruplama (aynen).
/// - ciplak terim → tirnaklanir (FTS5 ozel karakter → literal) + `>= MIN_PREFIX_LEN` ise ONEK
///   (`"term"*`) → Turkce cekim yakalanir ("bulut" hem bulut hem bulutlu/bulutlar bulur).
///
/// Yapisal olarak gecersiz operator dizilimi kalirsa (basta/sonda operator veya iki
/// operator yan yana — FTS5 bunlari reddeder, or. `OR OR`, `AND NOT`) GUVENLI
/// (hepsi-tirnakli) sorguya proaktif duser; boylece cagiran "syntax error" ya da
/// beklenmedik (sessiz-yanlis) sonuc gormez. Bos/yalniz-bosluk → bos string.
/// `pub(crate)`: hibrit arama (semantic.rs) FTS dalini list_assets ile AYNI sekilde kurar.
pub(crate) fn build_match_query(raw: &str) -> String {
    let tokens = tokenize(raw);
    if tokens.is_empty() {
        return String::new();
    }

    // Rezerve kelime (AND/OR/NOT) konumlari.
    let reserved: Vec<bool> =
        tokens.iter().map(|t| matches!(t, Token::Word(w) if is_reserved(w))).collect();

    // (a) PROAKTIF geri-dusus: rezerve kelime BASTA / SONDA / iki rezerve kelime YAN
    //     YANA (or. `OR OR`, `AND NOT`) → FTS5 bunlari reddeder; ifadeyi kurmadan
    //     hepsi-tirnakli GUVENLI sorguya dus. Boylece kullanici ne "syntax error" ne
    //     de beklenmedik (sessiz-yanlis) sonuc gorur. Cikti yine deterministik.
    let edge_or_adjacent = reserved.iter().enumerate().any(|(i, &r)| {
        r && (i == 0 || i + 1 == tokens.len() || reserved[i - 1] || reserved[i + 1])
    });
    if edge_or_adjacent {
        return fts_query(raw);
    }

    // (b) Kalan rezerve kelimeler: yalniz IKI yaninda da operand ureten token varsa
    //     (literal kelime / tumce / solda `)` / sagda `(`) OPERATOR; aksi halde
    //     (or. paren-bitisigi uyumsuzlugu) LITERAL terim olarak tirnaklanir.
    let mut out: Vec<String> = Vec::with_capacity(tokens.len());
    for (i, tok) in tokens.iter().enumerate() {
        match tok {
            Token::Paren(c) => out.push(c.to_string()),
            Token::Phrase(p) => out.push(quote_term(p)),
            Token::Word(w) if reserved[i] => {
                let left_ok = i
                    .checked_sub(1)
                    .and_then(|j| tokens.get(j))
                    .is_some_and(produces_left_operand);
                let right_ok = tokens.get(i + 1).is_some_and(produces_right_operand);
                if left_ok && right_ok {
                    // TR/EN kelime → FTS5'in ANLADIGI operator ("veya" → OR).
                    // `to_uppercase()` YETMEZ: "VEYA" gecerli FTS5 operatoru DEGILDIR.
                    out.push(fts_operator(w).unwrap_or("AND").to_string());
                } else {
                    out.push(quote_term(w)); // literal
                }
            }
            Token::Word(w) => out.push(quote_prefixed(w)),
        }
    }
    out.join(" ")
}

/// Kelimeyi FTS5 boolean operatorune esle (buyuk/kucuk fark etmez). Operator degilse `None`.
///
/// **TURKCE OPERATORLER (2026-07-18 H2-gerileme taramasi bulgusu):** H2
/// `utils/searchScoring.ts:126-131` `veya`→OR, `değil`/`degil`→NOT eslemesini yapiyordu;
/// H3'te YALNIZ Ingilizce taniniyordu. Sonuc: Turkce arayuzdeki kullanici `villa veya ofis`
/// yazinca "veya" LITERAL terime donuyor (`"veya"*`) ve ucu de AND'lendigi icin sorgu
/// neredeyse kesin **0 sonuc** veriyordu — hata mesaji da yoktu.
///
/// ⚠️ `ve`→AND **BILEREK ALINMADI** (H2'de vardi ve orada bir HATAYDI): "ve" siradan bir
/// Turkce tumcede gecer ("kat ve cephe planlari") → sessizce operatore donusup arama
/// anlamini degistirirdi. `veya`/`degil` ise arama niyetiyle yazilir; `ve` yazilmasa da
/// terimler ZATEN AND'lenir (FTS5 varsayilani) → kayip yok.
fn fts_operator(w: &str) -> Option<&'static str> {
    // Turkce buyuk 'İ' (U+0130) `to_lowercase()`'te "i" + birlesik nokta (U+0307) uretir →
    // "DEĞİL" ile "değil" eslesmezdi. Birlesik noktayi eleyerek normalize et.
    let lower: String = w.to_lowercase().chars().filter(|c| *c != '\u{0307}').collect();
    match lower.as_str() {
        "and" => Some("AND"),
        "or" | "veya" => Some("OR"),
        "not" | "değil" | "degil" => Some("NOT"),
        _ => None,
    }
}

/// Bir kelime FTS5 boolean operatoru mu (TR + EN; buyuk/kucuk fark etmez)?
fn is_reserved(w: &str) -> bool {
    fts_operator(w).is_some()
}

/// Bu token bir operatorun SOL operandi olabilir mi? (literal kelime / tumce / `)`).
/// Rezerve kelime (operator adayi) operand uretmez.
fn produces_left_operand(tok: &Token) -> bool {
    match tok {
        Token::Word(w) => !is_reserved(w),
        Token::Phrase(_) => true,
        Token::Paren(c) => *c == ')',
    }
}

/// Bu token bir operatorun SAG operandi olabilir mi? (literal kelime / tumce / `(`).
fn produces_right_operand(tok: &Token) -> bool {
    match tok {
        Token::Word(w) => !is_reserved(w),
        Token::Phrase(_) => true,
        Token::Paren(c) => *c == '(',
    }
}

/// Bulanik arama icin ciplak terimler: bosluk/tirnak/parantezle bol, operatorleri
/// (AND/OR/NOT) ele, bos olmayanlari lowercase dondur.
/// `pub(super)`: list.rs (fuzzy yolu) ayni ayiklamayi kullanir.
pub(super) fn fuzzy_terms(raw: &str) -> Vec<String> {
    raw.split(|c: char| c.is_whitespace() || c == '"' || c == '(' || c == ')')
        .map(str::trim)
        .filter(|t| !t.is_empty() && !is_reserved(t))
        .map(str::to_lowercase)
        .collect()
}

/// build_match_query icin token turu.
enum Token {
    Word(String),
    Phrase(String),
    Paren(char),
}

/// Sorguyu token'lara ayir: `"..."` tumce, `(`/`)` parantez, gerisi bosluk-ayrik kelime.
fn tokenize(raw: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut cur = String::new();
    let mut chars = raw.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' {
            if !cur.is_empty() {
                tokens.push(Token::Word(std::mem::take(&mut cur)));
            }
            // Kapanis tirnagina (veya girdi sonuna) kadar topla.
            let mut phrase = String::new();
            for pc in chars.by_ref() {
                if pc == '"' {
                    break;
                }
                phrase.push(pc);
            }
            let phrase = phrase.trim().to_string();
            if !phrase.is_empty() {
                tokens.push(Token::Phrase(phrase));
            }
        } else if c == '(' || c == ')' {
            if !cur.is_empty() {
                tokens.push(Token::Word(std::mem::take(&mut cur)));
            }
            tokens.push(Token::Paren(c));
        } else if c.is_whitespace() {
            if !cur.is_empty() {
                tokens.push(Token::Word(std::mem::take(&mut cur)));
            }
        } else {
            cur.push(c);
        }
    }
    if !cur.is_empty() {
        tokens.push(Token::Word(cur));
    }
    tokens
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_query_quotes_and_handles_specials() {
        assert_eq!(fts_query("villa proje"), "\"villa\" \"proje\"");
        // Ozel karakterler literal → syntax hatasi yok.
        assert_eq!(fts_query("c++ a:b"), "\"c++\" \"a:b\"");
        assert_eq!(fts_query("  "), "");
        assert_eq!(fts_query("de\"v"), "\"de\"\"v\"");
    }

    #[test]
    fn build_match_query_boolean_phrase_paren() {
        // Ciplak terimler tirnaklanir + ONEK (>=4 harf; implicit AND). "bulut" bulutlu'yu de bulur.
        assert_eq!(build_match_query("villa proje"), "\"villa\"* \"proje\"*");
        // Operatorler (buyuk/kucuk) korunur, uppercase'e cevrilir (iki yanda da operand); operandlar onek.
        assert_eq!(build_match_query("villa OR ofis"), "\"villa\"* OR \"ofis\"*");
        assert_eq!(build_match_query("villa AND ofis"), "\"villa\"* AND \"ofis\"*");
        // Tumce TAM eslesir (onek YOK — acik tirnak niyeti); yanindaki ciplak terim onek.
        assert_eq!(build_match_query("\"ic mimari\" villa"), "\"ic mimari\" \"villa\"*");
        assert_eq!(build_match_query("\"villa ofis\""), "\"villa ofis\"");
        // Parantez gruplama.
        assert_eq!(build_match_query("( villa OR ofis )"), "( \"villa\"* OR \"ofis\"* )");
        // Bos / yalniz tirnak → bos.
        assert_eq!(build_match_query("   "), "");
        assert_eq!(build_match_query("\""), "");
    }

    #[test]
    fn build_match_query_prefix_length_gate() {
        // >=4 harf → ONEK ("cami"* → camii/camiler). <4 harf → TAM (kisa/belirsiz koku genisletme).
        assert_eq!(build_match_query("cami"), "\"cami\"*");
        assert_eq!(build_match_query("kat"), "\"kat\""); // 3 harf → onek YOK (katman/katalog gurultu)
        assert_eq!(build_match_query("ev"), "\"ev\"");
        // Karisik: kisa + uzun.
        assert_eq!(build_match_query("kat plani"), "\"kat\" \"plani\"*");
    }

    #[test]
    fn build_or_query_ors_prefixed_tokens() {
        let toks = ["kubbe".to_string(), "dome".to_string(), "ev".to_string()];
        // >=4 onek, <4 tam; OR'la birlestir (sozluk-fallback recall).
        assert_eq!(build_or_query(&toks), "\"kubbe\"* OR \"dome\"* OR \"ev\"");
        assert_eq!(build_or_query(&[]), "");
    }

    /// M2: edge/bitisik operator → guvenli (hepsi-tirnakli) sorgu; rezerve kelime
    /// uygun konumda degilse LITERAL. Boylece "syntax error" ve sessiz-yanlis biter.
    #[test]
    fn build_match_query_edge_and_adjacent_operators_fall_back() {
        // Iki operator yan yana → yapisal gecersiz → hepsi-tirnakli guvenli sorgu.
        assert_eq!(build_match_query("villa OR OR ofis"), "\"villa\" \"OR\" \"OR\" \"ofis\"");
        // Basta/sonda operator → operandsiz → LITERAL terim (gecerli, sessiz-yanlis yok).
        assert_eq!(build_match_query("OR villa"), "\"OR\" \"villa\"");
        assert_eq!(build_match_query("villa AND"), "\"villa\" \"AND\"");
        // Tek basina rezerve kelime → LITERAL: kullanici "and" kelimesini gercekten arar.
        assert_eq!(build_match_query("and"), "\"and\"");
        // Iki terim arasinda → operator olarak yorumlanir (deterministik, gecerli FTS5); operandlar onek.
        assert_eq!(build_match_query("roof and beam"), "\"roof\"* AND \"beam\"*");
        // Lowercase zincir `and not` → iki operator yan yana olur, FTS5 reddederdi;
        // her ikisi de operandsiz kalir → LITERAL (eski cikti runtime'da gecersizdi).
        assert_eq!(
            build_match_query("villa and not mutfak"),
            "\"villa\" \"and\" \"not\" \"mutfak\""
        );
        // NOT cift terim arasinda gecerli (integration testte FTS5'e karsi dogrulanir); operandlar onek.
        assert_eq!(build_match_query("villa NOT bahce"), "\"villa\"* NOT \"bahce\"*");
    }

    /// TURKCE operatorler (H2 `searchScoring.ts:126-131` paritesi). Regresyon nobeti:
    /// "veya" cevrilmezse `"veya"*` literal terime doner ve sorgu ~0 sonuc verir.
    #[test]
    fn turkish_boolean_operators_map_to_fts5() {
        assert_eq!(build_match_query("villa veya ofis"), "\"villa\"* OR \"ofis\"*");
        assert_eq!(build_match_query("villa değil bahce"), "\"villa\"* NOT \"bahce\"*");
        // Noktasiz yazim (Turkce klavyesiz kullanici) da kabul.
        assert_eq!(build_match_query("villa degil bahce"), "\"villa\"* NOT \"bahce\"*");
        // BUYUK harf: "VEYA"/"DEĞİL" — Turkce 'İ' lowercase'te birlesik nokta uretir,
        // normalize edilmezse eslesmez (bu satir o tuzagin nobeti).
        assert_eq!(build_match_query("villa VEYA ofis"), "\"villa\"* OR \"ofis\"*");
        assert_eq!(build_match_query("villa DEĞİL bahce"), "\"villa\"* NOT \"bahce\"*");
        // Karisik: TR + EN ayni sorguda.
        assert_eq!(
            build_match_query("villa veya ofis NOT bahce"),
            "\"villa\"* OR \"ofis\"* NOT \"bahce\"*"
        );
    }

    /// ⚠️ `ve` operator DEGILDIR (H2'de vardi ve orada HATAYDI): siradan Turkce tumcedeki
    /// "ve" sessizce AND'e donup arama anlamini degistirirdi. Literal terim olarak kalmali.
    #[test]
    fn turkish_ve_is_not_an_operator() {
        // NOT: "kat"/"ve" MIN_PREFIX_LEN'den kisa → onek `*` ALMAZ (mevcut, gerekceli kural);
        // burada onemli olan ikisinin de LITERAL terim kalmasi, operatore donmemesi.
        assert_eq!(build_match_query("kat ve cephe"), "\"kat\" \"ve\" \"cephe\"*");
    }

    #[test]
    fn fuzzy_terms_strips_operators_and_quotes() {
        assert_eq!(fuzzy_terms("Villa OR Ofis"), vec!["villa", "ofis"]);
        assert_eq!(fuzzy_terms("\"ic mimari\" (kule)"), vec!["ic", "mimari", "kule"]);
        assert_eq!(fuzzy_terms("  AND  not  "), Vec::<String>::new());
    }
}
