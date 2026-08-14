//! Offline TR→EN mimari terim sozlugu — gorsel arama (CLIP) icin (H2 `visualSearchDict.ts` porti).
//!
//! NEDEN: CLIP metin kodlayici (`clip-vit-base-patch32`) YALNIZ Ingilizce anlar. Turkce sorguyu
//! dogrudan cok-dilli CLIP'e (mclip) vermek cop sonuc uretiyordu (H3 gozlemi; H2 bunu YAPMAZ).
//! H2 yolu: Turkce sorgu → (kuratorlu offline sozluk) Ingilizceye cevir → duz Ingilizce CLIP metin
//! kodlayici. `image_commands::embed_query_text_clip` bu modulu kullanir.
//!
//! GENISLETME: yeni terim icin `TR_EN_ARCH_DICT`'e `("turkce", "english")` ekleyin. Notlar:
//!  - Cok kelimeli ifadeler (or. "kat plani") tek kelimelerden ONCE eslesir (en uzun anahtar
//!    once uygulanir; SORTED_ENTRIES uzunluga gore azalan sirali) → siralamayi dusunmeye gerek yok.
//!  - Kullanicilar Turkce karakter yazmadan da arar ("kapi", "cizim") → sik terimlerin hem
//!    diakritikli hem ASCII varyantini ekleyin.
//!  - Ingilizcesi Turkcesiyle AYNI olan kelimeleri (plan→plan, metal→metal) EKLEMEYIN — ceviriye
//!    gerek yok ve yanlis "Turkce sinyali" uretirler.

use std::sync::OnceLock;

/// Turkce-guvenli kucultme (H2 `turkishLower`): I→ı, İ→i, Ç→ç, Ğ→ğ, Ö→ö, Ş→ş, Ü→ü; kalan
/// `char::to_lowercase`. (WebView2'de `toLocaleLowerCase('tr')` platform-bagimli olabildigi icin
/// H2 elle donusturuyordu; Rust'ta da ayni kesin eslemeyi kullaniriz.)
pub fn turkish_lower(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            'I' => out.push('ı'),
            'İ' => out.push('i'),
            'Ç' => out.push('ç'),
            'Ğ' => out.push('ğ'),
            'Ö' => out.push('ö'),
            'Ş' => out.push('ş'),
            'Ü' => out.push('ü'),
            _ => out.extend(c.to_lowercase()),
        }
    }
    out
}

/// H2 `TURKISH_CHAR_RE` (`[çğıİöşüÇĞÖŞÜ]`) — Turkce'ye ozel karakter kumesi (birebir).
fn is_turkish_char(c: char) -> bool {
    matches!(
        c,
        'ç' | 'ğ' | 'ı' | 'İ' | 'ö' | 'ş' | 'ü' | 'Ç' | 'Ğ' | 'Ö' | 'Ş' | 'Ü'
    )
}

/// Metinde en az bir Turkce ozel karakter var mi.
fn has_turkish_char(s: &str) -> bool {
    s.chars().any(is_turkish_char)
}

/// Kelime-sinir karakteri mi (H2 `\p{L}\p{N}` yerine): unicode harf/rakam → kelime parcasi.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

/// `text` icinde `term` TAM-KELIME olarak geciyor mu (regexsiz; H2 `wholeWordRe` semantigi:
/// eslesme oncesi/sonrasi karakter unicode harf/rakam DEGILSE gecerli sinir). `text` ve `term`
/// zaten kucultulmus (turkish_lower) varsayilir.
fn contains_whole_word(text: &str, term: &str) -> bool {
    if term.is_empty() {
        return false;
    }
    let hay: Vec<char> = text.chars().collect();
    let pat: Vec<char> = term.chars().collect();
    let plen = pat.len();
    if plen > hay.len() {
        return false;
    }
    let mut i = 0usize;
    while i + plen <= hay.len() {
        if &hay[i..i + plen] == pat.as_slice() {
            let before_ok = i == 0 || !is_word_char(hay[i - 1]);
            let after_idx = i + plen;
            let after_ok = after_idx >= hay.len() || !is_word_char(hay[after_idx]);
            if before_ok && after_ok {
                return true;
            }
        }
        i += 1;
    }
    false
}

/// `text` icindeki `from` teriminin TUM tam-kelime eslesmelerini `to` ile degistir (regexsiz;
/// H2 `text.replace(wholeWordRe(tr), en)` global degistirme). Kelime siniri `contains_whole_word`
/// ile ayni. Yerine konan `to` (Ingilizce) tekrar taranmaz — cikti bir sonraki terime aktarilir.
fn replace_whole_word(text: &str, from: &str, to: &str) -> String {
    if from.is_empty() {
        return text.to_string();
    }
    let hay: Vec<char> = text.chars().collect();
    let pat: Vec<char> = from.chars().collect();
    let plen = pat.len();
    if plen == 0 || plen > hay.len() {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < hay.len() {
        if i + plen <= hay.len() && &hay[i..i + plen] == pat.as_slice() {
            let before_ok = i == 0 || !is_word_char(hay[i - 1]);
            let after_idx = i + plen;
            let after_ok = after_idx >= hay.len() || !is_word_char(hay[after_idx]);
            if before_ok && after_ok {
                out.push_str(to);
                i += plen;
                continue;
            }
        }
        out.push(hay[i]);
        i += 1;
    }
    out
}

/// TR→EN mimari sozluk (H2 `TR_EN_ARCH_DICT` porti + kullanici-test'li sahne/hava/mobilya terimleri).
/// Anahtarlar zaten kucuk-harf; `SORTED_ENTRIES` uzunluga gore siralar (en-uzun-eslesir-once).
const TR_EN_ARCH_DICT: &[(&str, &str)] = &[
    // — Cizim turleri —
    ("kat planı", "floor plan"), ("kat plani", "floor plan"),
    ("vaziyet planı", "site plan"), ("vaziyet plani", "site plan"),
    ("cephe", "facade"), ("cephesi", "facade"),
    ("cephe çizimi", "facade drawing"), ("cephe cizimi", "facade drawing"),
    ("kesit", "section"), ("kesiti", "section"),
    ("görünüş", "elevation"), ("gorunus", "elevation"),
    ("görünüşü", "elevation"), ("gorunusu", "elevation"),
    ("çizim", "drawing"), ("cizim", "drawing"), ("çizimi", "drawing"), ("cizimi", "drawing"),
    ("detay", "detail"), ("detayı", "detail"), ("detayi", "detail"),
    // Turkce cekim ekleri (planı = plan + iyelik): yarim ceviriyi onler.
    ("planı", "plan"), ("plani", "plan"), ("planları", "plans"), ("planlari", "plans"),
    ("perspektif", "perspective"), ("maket", "scale model"), ("eskiz", "sketch"),
    ("şema", "diagram"), ("sema", "diagram"), ("şeması", "diagram"), ("semasi", "diagram"),
    ("kroki", "sketch"),

    // — Yapi elemanlari —
    ("merdiven", "staircase"), ("merdiven boşluğu", "stairwell"), ("merdiven boslugu", "stairwell"),
    ("asansör", "elevator"), ("asansor", "elevator"),
    ("pencere", "window"), ("kapı", "door"), ("kapi", "door"), ("duvar", "wall"),
    ("çatı", "roof"), ("cati", "roof"), ("çatı katı", "attic"), ("tavan", "ceiling"),
    ("zemin", "floor"), ("döşeme", "flooring"), ("doseme", "flooring"),
    ("kolon", "column"), ("kiriş", "beam"), ("kiris", "beam"), ("temel", "foundation"),
    ("balkon", "balcony"), ("teras", "terrace"), ("avlu", "courtyard"),
    ("koridor", "corridor"), ("giriş", "entrance"), ("giris", "entrance"),
    ("korkuluk", "railing"), ("saçak", "eaves"), ("sacak", "eaves"),

    // — Mekanlar —
    ("oda", "room"), ("mutfak", "kitchen"), ("banyo", "bathroom"), ("tuvalet", "toilet"),
    ("salon", "living room"), ("yatak odası", "bedroom"), ("yatak odasi", "bedroom"),
    ("ofis", "office"), ("depo", "storage"), ("garaj", "garage"), ("otopark", "parking"),
    ("bahçe", "garden"), ("bahce", "garden"), ("havuz", "pool"), ("mağaza", "shop"), ("magaza", "shop"),

    // — Yapi turleri —
    ("bina", "building"), ("ev", "house"), ("apartman", "apartment"),
    ("okul", "school"), ("hastane", "hospital"), ("cami", "mosque"),
    ("köprü", "bridge"), ("kopru", "bridge"),
    ("kule", "tower"), ("otel", "hotel"), ("fabrika", "factory"),

    // — Osmanli / dini mimari (CLIP'e uygun Ingilizce karsiliklar) —
    ("şadırvan", "ablution fountain"), ("sadirvan", "ablution fountain"),
    ("çeşme", "fountain"), ("cesme", "fountain"), ("sebil", "fountain kiosk"),
    ("külliye", "mosque complex"), ("kulliye", "mosque complex"),
    ("türbe", "mausoleum"), ("turbe", "mausoleum"), ("kümbet", "tomb"), ("kumbet", "tomb"),
    ("minare", "minaret"), ("mihrap", "prayer niche"), ("minber", "pulpit"), ("mimber", "pulpit"),
    ("kubbe", "dome"), ("kemer", "arch"), ("revak", "arcade"), ("eyvan", "vaulted hall"),
    ("hamam", "bathhouse"), ("kervansaray", "caravanserai"),
    ("çini", "tile work"), ("cini", "tile work"),

    // — Malzemeler —
    ("ahşap", "wood"), ("ahsap", "wood"), ("beton", "concrete"), ("çelik", "steel"), ("celik", "steel"),
    ("tuğla", "brick"), ("tugla", "brick"), ("taş", "stone"), ("cam", "glass"),
    ("mermer", "marble"), ("alçı", "plaster"), ("alci", "plaster"),

    // — Sahne / cevre —
    ("mimari", "architecture"), ("iç mekan", "interior"), ("ic mekan", "interior"),
    ("dış mekan", "exterior"), ("dis mekan", "exterior"), ("peyzaj", "landscape"),
    ("sokak", "street"), ("yol", "road"), ("şehir", "city"), ("sehir", "city"),
    ("ağaç", "tree"), ("agac", "tree"), ("araba", "car"),
    ("aydınlatma", "lighting"), ("aydinlatma", "lighting"), ("mobilya", "furniture"),

    // — Renkler —
    ("kırmızı", "red"), ("kirmizi", "red"), ("yeşil", "green"), ("yesil", "green"),
    ("mavi", "blue"), ("beyaz", "white"), ("siyah", "black"), ("sarı", "yellow"), ("sari", "yellow"),
    ("kahverengi", "brown"), ("gri", "gray"),

    // — Hava / gokyuzu (H3 ek; kullanici-test'li) — cok-kelimeli ONCE eslesir (longest-first).
    // NOT (OLCULDU 2026-07-13): "bulutlu hava" → "cloudy sky" CLIP'te KAPALI/gri hava okunur → gri
    // render'lar uste cikiyordu. Bu arsivde kullanici niyeti = GORSEL "gokte beyaz bulutlar" (kapali
    // hava DEGIL). Gercek CLIP olcumu: "blue sky with white clouds" mavi-bulutlu gorselleri gri'nin
    // ustune tasidi → o cevriye gecildi (meteorolojik "kapali" degil, gorsel "bulutlu").
    ("bulutlu hava", "blue sky with white clouds"),
    ("bulutlu gökyüzü", "blue sky with white clouds"),
    ("bulutlu gokyuzu", "blue sky with white clouds"),
    ("bulut", "cloud"), ("bulutlu", "cloudy blue sky"),
    ("gökyüzü", "sky"), ("gokyuzu", "sky"),
    ("gün batımı", "sunset"), ("gun batimi", "sunset"),
    ("gündoğumu", "sunrise"), ("gundogumu", "sunrise"),
    ("kar", "snow"), ("yağmur", "rain"), ("yagmur", "rain"), ("sis", "fog"),
    ("güneş", "sun"), ("gunes", "sun"), ("gece", "night"),

    // — Doga (H3 ek) —
    ("dağ", "mountain"), ("dag", "mountain"), ("deniz", "sea"), ("göl", "lake"), ("gol", "lake"),
    ("nehir", "river"), ("orman", "forest"), ("çimen", "grass"), ("cimen", "grass"),
    ("çiçek", "flower"), ("cicek", "flower"), ("gökdelen", "skyscraper"), ("gokdelen", "skyscraper"),

    // — Mobilya (H3 ek) —
    ("koltuk", "armchair"), ("kanepe", "sofa"), ("sandalye", "chair"), ("masa", "table"),
    ("halı", "carpet"), ("hali", "carpet"), ("perde", "curtain"), ("dolap", "cabinet"),
    ("yatak", "bed"), ("lamba", "lamp"), ("avize", "chandelier"),

    // — Baglaclar (H3 ek) — cevrilmezse Ingilizce sorguya Turkce sizar ("cloudy sky ve mosque").
    // Whole-word → yalniz bagimsiz kelime eslesir ("cami"/"kaya" ici "ve"/"ya" tetiklenmez);
    // uzun sozluk anahtarlari (or. "yatak odası") longest-first zaten once eslesir.
    ("ve", "and"), ("ile", "with"), ("veya", "or"), ("ya", "or"),
];

/// Uzunluga gore AZALAN sirali sozluk (cok-kelimeli ifadeler tek kelimelerden ONCE eslessin).
/// Anahtarlar `turkish_lower`'lanir (kaynak zaten kucuk → idempotent). Bir kez kurulur (OnceLock —
/// MSRV 1.77 uyumlu; `LazyLock` 1.80 workspace rust-version'ini asardi).
fn sorted_entries() -> &'static [(String, &'static str)] {
    static ENTRIES: OnceLock<Vec<(String, &'static str)>> = OnceLock::new();
    ENTRIES
        .get_or_init(|| {
            let mut v: Vec<(String, &'static str)> = TR_EN_ARCH_DICT
                .iter()
                .map(|&(tr, en)| (turkish_lower(tr), en))
                .collect();
            // char sayisina gore AZALAN (H2 UTF-16 length ~ Turkce BMP karakterleri icin char sayisi).
            v.sort_by_key(|e| std::cmp::Reverse(e.0.chars().count()));
            v
        })
        .as_slice()
}

/// Ceviriyi tetikleyen yaygin Turkce baglac/soru kelimeleri (H2 `TR_STOPWORD_RE`; whole-word).
const TR_STOPWORDS: &[&str] = &[
    "ve", "ile", "için", "icin", "hangi", "nedir", "var", "bir", "veya", "ya",
];

/// Yerel LLM cevirisinin GUVENILMEZ oldugu ozel/donemsel mimari terimler (H2
/// `SPECIALIZED_ARCH_TERMS`; Osmanli/dini). Bu terimleri iceren sorgularda H2 kuratorlu sozlugu
/// tercih ederdi. Kaynak zaten kucuk-harf (whole-word karsilastirma).
const SPECIALIZED_ARCH_TERMS: &[&str] = &[
    "şadırvan", "sadirvan", "çeşme", "cesme", "sebil", "külliye", "kulliye",
    "türbe", "turbe", "kümbet", "kumbet", "mihrap", "minber", "mimber",
    "revak", "eyvan", "kervansaray", "çini", "cini", "hamam",
];

/// Sorguyu offline sozlukle Ingilizceye cevir (kelime/ifade bazli tam-kelime degistirme).
/// Donus: (`cevrilmis metin`, `residual_turkish` = hala Turkce ozel karakter iceren, benzersiz
/// cevrilemeyen kelimeler — ekleme sirasi korunur). H2 `translateWithDictionary` porti.
pub fn translate_with_dictionary(query: &str) -> (String, Vec<String>) {
    let mut text = turkish_lower(query);
    for (tr, en) in sorted_entries().iter() {
        text = replace_whole_word(&text, tr, en);
    }
    let mut residual: Vec<String> = Vec::new();
    for w in text.split_whitespace() {
        if has_turkish_char(w) && !residual.iter().any(|r| r == w) {
            residual.push(w.to_string());
        }
    }
    (text.trim().to_string(), residual)
}

/// Sorguda Turkce sinyali var mi? (ozel karakter / yaygin TR kelime / sozluk terimi). Ceviri
/// denenip denenmeyecegine karar vermek icin (H2 `hasTurkishSignal` birebir).
pub fn has_turkish_signal(query: &str) -> bool {
    if has_turkish_char(query) {
        return true;
    }
    let q = turkish_lower(query);
    if TR_STOPWORDS.iter().any(|s| contains_whole_word(&q, s)) {
        return true;
    }
    sorted_entries().iter().any(|(tr, _)| contains_whole_word(&q, tr))
}

/// Sorgu, kuratorlu sozlugun kesin, LLM'in yanlis cevirdigi ozel mimari terimlerden birini
/// iceriyor mu (H2 `hasSpecializedArchTerm`; ileride Ollama eklenirse sozluk-oncelik dali icin).
pub fn has_specialized_arch_term(query: &str) -> bool {
    let q = turkish_lower(query);
    SPECIALIZED_ARCH_TERMS.iter().any(|t| contains_whole_word(&q, t))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turkish_lower_maps_turkish_uppercase() {
        assert_eq!(turkish_lower("İSTANBUL"), "istanbul");
        assert_eq!(turkish_lower("IŞIK"), "ışık");
        assert_eq!(turkish_lower("ÇÖĞÜŞ"), "çöğüş");
    }

    #[test]
    fn translates_single_terms() {
        assert_eq!(translate_with_dictionary("cami").0, "mosque");
        assert_eq!(translate_with_dictionary("minare").0, "minaret");
    }

    #[test]
    fn translates_multiword_phrase_before_single_words() {
        // "bulutlu hava" cok-kelimeli → tek "bulut"/"bulutlu"/"hava" yerine butun ifade
        // ("blue sky with white clouds"; gorsel-bulutlu niyeti, meteorolojik "kapali" degil).
        assert_eq!(translate_with_dictionary("bulutlu hava").0, "blue sky with white clouds");
    }

    #[test]
    fn translates_color_plus_furniture() {
        assert_eq!(translate_with_dictionary("kırmızı koltuk").0, "red armchair");
    }

    #[test]
    fn translates_conjunctions() {
        // Baglaclar Ingilizce'ye cevrilir → sorguya Turkce sizmaz.
        assert_eq!(
            translate_with_dictionary("bulutlu hava ve cami").0,
            "blue sky with white clouds and mosque"
        );
        assert_eq!(translate_with_dictionary("cami ile deniz").0, "mosque with sea");
        assert_eq!(translate_with_dictionary("cami veya kule").0, "mosque or tower");
        // "ya"/"ve" whole-word: "kaya" ve "yatak odası" bozulmaz (uzun anahtar once + sinir).
        assert_eq!(translate_with_dictionary("kaya").0, "kaya");
        assert_eq!(translate_with_dictionary("yatak odası").0, "bedroom");
    }

    #[test]
    fn whole_word_does_not_match_substring() {
        // "cami" kelimesi "camic" icinde eslesmemeli (kelime siniri) → metin degismez.
        assert_eq!(translate_with_dictionary("camic").0, "camic");
    }

    #[test]
    fn residual_captures_untranslatable_turkish_word() {
        // "büyük" sozlukte yok + Turkce karakter iceriyor → residual'da; "cami" cevrilir.
        let (text, residual) = translate_with_dictionary("büyük cami");
        assert_eq!(text, "büyük mosque");
        assert!(residual.iter().any(|w| w == "büyük"), "residual: {residual:?}");
    }

    #[test]
    fn turkish_signal_detects_dictionary_term_without_special_char() {
        // "cami" ozel karakter/stopword icermez ama sozluk terimi → sinyal var.
        assert!(has_turkish_signal("cami"));
        // Duz Ingilizce → sinyal yok (ceviri atlanir).
        assert!(!has_turkish_signal("mosque"));
    }

    #[test]
    fn specialized_arch_term_detected() {
        assert!(has_specialized_arch_term("şadırvan planı"));
        assert!(!has_specialized_arch_term("merdiven cephe"));
    }
}
