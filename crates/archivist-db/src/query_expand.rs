//! Sorgu genisletme (H2 queryExpansion.ts ARCH_SYNONYMS sadik portu) — Turkce mimari domain
//! sozlugu ile arama terimini es-anlamli + ilgili kavramlarla zenginlestirir.
//!
//! ⚠️ Kapsam ilkesi (H3): genisletme YALNIZ FTS aday havuzunu buyutur (recall). Keyword-gate
//! (rag_search §4) ORIJINAL anlamli token'lari kullanmaya devam eder → sinonim eslesmesi
//! ZORUNLU KILINMAZ (halusinasyon onleme bozulmaz). H2'de expandQuery hem FTS hem skorlamayi
//! besliyordu; H3'te bilincle yalniz aday-recall'a uygulanir.

use std::collections::HashSet;

use crate::rag::{normalize_tr, significant_tokens};

/// Sinonime cevrilecek en fazla EK token (H2 `expansionTerms.slice(0, 20)` pariti).
const MAX_EXPANSION_TOKENS: usize = 20;

/// Mimari domain sozlugu (H2 ARCH_SYNONYMS sadik portu). Anahtar: tetikleyici terim
/// (normalize edilip sorguda aranir); deger: eklenecek es-anlamli/ilgili terimler (TR + EN).
/// Compound anahtarlar (bosluk iceren) alt-dizi olarak, tekil anahtarlar TAM kelime eslenir.
const ARCH_SYNONYMS: &[(&str, &[&str])] = &[
    // ── Geleneksel susleme & tezyinat ──
    ("mukarnas", &["muqarnas", "stalaktit", "honeycomb vault", "geometric carving", "stalactite vault"]),
    ("revzen", &["vitray", "stained glass", "pencere susu", "renkli cam"]),
    ("sebeke", &["lattice", "kafes", "kafes pencere", "openwork", "mashrabiya"]),
    ("rumi", &["arabesque", "islimi", "rumi motif", "kivrimdal"]),
    ("hatayi", &["hatayi", "floral arabesque", "cicek motifi"]),
    ("palmet", &["palmette", "anthemion", "palmiye yapragi"]),
    ("lotus", &["lotus", "nilufer", "su zambagi motifi"]),
    ("lale", &["tulip", "lale motifi", "osmanli lalesi"]),
    ("semse", &["medallion", "gunes motifi", "rozet"]),
    ("zencerek", &["interlace", "gecme bordur", "orgu bordur"]),
    ("bordur", &["border", "kenar susu", "cerceve", "frame"]),
    ("koselik", &["spandrel", "kose motifi", "corner ornament"]),
    ("tepelik", &["cresting", "tepe susu", "finial"]),
    ("karanfil", &["carnation", "karanfil motifi"]),
    ("fitil", &["cable motif", "halat motifi", "twisted cord"]),
    // ── Mimari elemanlar ──
    ("nis", &["niche", "alcove", "recess", "girintili", "oyuk", "mihrabiye"]),
    ("profil", &["profile", "molding", "silme", "kontur", "kesit detayi", "corniche"]),
    ("silme", &["molding", "cornice", "profil", "bant", "cikinti"]),
    ("kemer", &["arch", "portal", "tak", "arc", "vault"]),
    ("sutun", &["column", "kolon", "pillar", "pilaster", "direk"]),
    ("baslik", &["capital", "sutun basligi", "column capital", "capitel"]),
    ("kaide", &["base", "plinth", "podium", "temel kaidesi"]),
    ("kubbe", &["dome", "tonoz", "dome structure", "cupola"]),
    ("pandantif", &["pendentive", "kose tromp"]),
    ("tromp", &["squinch", "kose dolgusu"]),
    ("kasnak", &["drum", "tambour", "kubbe kasnak"]),
    ("alem", &["finial", "tepe alemi", "crescent finial"]),
    ("serefe", &["balcony", "minare serefesi", "muezzin balcony"]),
    ("minare", &["minaret", "kule", "cami kulesi"]),
    ("mihrap", &["mihrab", "prayer niche", "kible nisi"]),
    ("minber", &["minbar", "pulpit", "vaaz kursusu"]),
    ("fil gozu", &["oculus", "round window", "yuvarlak pencere", "porthole"]),
    ("vitray", &["stained glass", "renkli cam", "revzen"]),
    // ── Yapi turleri ──
    ("kulle", &["kulliye", "mosque complex", "dini kulliye"]),
    ("turbe", &["mausoleum", "tomb", "kumbet", "anit mezar"]),
    ("cesme", &["fountain", "su cesmesi", "sebil"]),
    ("sebil", &["public fountain", "su dagitim yapisi"]),
    ("han", &["caravanserai", "kervansaray", "inn"]),
    ("hamam", &["bathhouse", "turkish bath", "hamami"]),
    // ── Mekanlar ──
    ("avlu", &["courtyard", "ic bahce", "court", "atrium"]),
    ("eyvan", &["iwan", "alcove hall", "eyvan mekani", "vaulted hall"]),
    ("revak", &["portico", "arcade", "colonnade", "revakli gecit", "loggia"]),
    ("son cemaat", &["son cemaat yeri", "narthex", "pronaos", "giris revagi"]),
    ("sadirvan", &["ablution fountain", "wudu fountain", "sadirvan havuzu"]),
    ("sofa", &["hayat", "orta sofa", "central hall"]),
    ("hayat", &["sofa", "yari acik mekan", "semi-open space"]),
    ("selamlik", &["mens quarters", "reception area"]),
    ("harem", &["womens quarters", "private quarters"]),
    // ── Cizim turleri ──
    ("kat plani", &["floor plan", "zemin plani", "plan", "building plan"]),
    ("vaziyet", &["site plan", "vaziyet plani", "situation plan", "master plan"]),
    ("cephe", &["facade", "elevation", "on gorunus", "yan gorunus", "cephe cizimi"]),
    ("kesit", &["section", "cross section", "enine kesit", "boyuna kesit"]),
    ("detay", &["detail", "ayrinti", "yapim detayi", "construction detail"]),
    ("strüktür", &["structural", "tasiyici sistem", "statik", "structural plan"]),
    ("tesisat", &["mep", "mechanical", "plumbing", "hvac", "tesisat plani"]),
    ("elektrik", &["electrical", "electric plan", "elektrik plani"]),
    ("cati", &["roof plan", "cati plani", "roof", "roofing"]),
    ("susleme", &["ornament", "decoration", "tezyinat", "susleme detayi", "ornamental detail"]),
    ("restorasyon", &["restoration", "rehabilitation", "onarim", "renovasyon", "renovation"]),
    // ── Malzeme & yapim ──
    ("cini", &["tile", "ceramic tile", "iznik tile", "faience", "mosaic tile"]),
    ("kalem isi", &["painted decoration", "fresco", "duvar resmi", "mural painting"]),
    ("alci", &["stucco", "plaster", "gypsum", "alci isciligi", "plasterwork"]),
    ("mermer", &["marble", "mermer kaplama", "marble cladding"]),
    ("traverten", &["travertine", "kirec tasi", "dogal tas"]),
    ("kundekari", &["woodwork", "geometric woodwork", "ahsap gecme", "kundekari"]),
    ("ahsap oyma", &["wood carving", "carved wood"]),
    ("gecme", &["interlocking", "gecme teknigi", "interlace", "joinery"]),
    ("tas isciligi", &["stone carving", "tas oyma", "masonry", "stonework"]),
    // ── Genel arama iyilestirme ──
    ("salon", &["living room", "oturma odasi", "lounge", "sitting room"]),
    ("mutfak", &["kitchen", "yemek", "cooking area"]),
    ("yatak", &["bedroom", "yatak odasi", "sleeping"]),
    ("banyo", &["bathroom", "bath", "toilet"]),
    ("koridor", &["corridor", "hallway", "gecit", "hole"]),
    ("merdiven", &["stair", "staircase", "stairway", "basamak"]),
    ("cati kati", &["attic", "mansard", "loft"]),
    ("bodrum", &["basement", "underground", "yeralti", "zemin alti"]),
];

/// Sorguyu mimari sozlukle genislet: `base` (orijinal anlamli token'lar) + tetiklenen
/// sinonimlerin anlamli token'lari (en fazla `MAX_EXPANSION_TOKENS` EK). Sira: once base,
/// sonra eklenenler. FTS aday havuzu icin (keyword-gate'e DOKUNMAZ — bkz modul dok).
///
/// Eslesme: tekil anahtar (boslukSUZ) → sorgunun KELIME kumesinde TAM kelime; compound anahtar
/// (bosluk iceren) → normalize sorguda alt-dizi (H2 `includes` pariti). Tekil anahtarda tam-kelime
/// (alt-dizi DEGIL) → "han" anahtari "hangi" sorusunu tetiklemez (H2'nin asiri-genisleme zayifligi
/// giderildi; yalniz aday-recall'i etkiler).
pub fn expand_query_tokens(query: &str, base: &[String]) -> Vec<String> {
    let norm = normalize_tr(query);
    let word_set: HashSet<&str> =
        norm.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).collect();

    let mut out: Vec<String> = base.to_vec();
    let mut seen: HashSet<String> = base.iter().cloned().collect();
    let mut added = 0usize;

    for (key, syns) in ARCH_SYNONYMS {
        if added >= MAX_EXPANSION_TOKENS {
            break;
        }
        let nkey = normalize_tr(key);
        let triggered = if nkey.contains(' ') {
            norm.contains(&nkey)
        } else {
            word_set.contains(nkey.as_str())
        };
        if !triggered {
            continue;
        }
        for syn in *syns {
            for tok in significant_tokens(syn) {
                if added >= MAX_EXPANSION_TOKENS {
                    break;
                }
                if seen.insert(tok.clone()) {
                    out.push(tok);
                    added += 1;
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rag::significant_tokens;

    #[test]
    fn expands_known_term_with_synonyms() {
        let base = significant_tokens("merdiven nerede");
        let expanded = expand_query_tokens("merdiven nerede", &base);
        // Orijinal korunur + EN/TR sinonimleri eklenir.
        assert!(expanded.contains(&"merdiven".to_string()), "orijinal token korunur");
        assert!(expanded.contains(&"stair".to_string()), "ingilizce sinonim eklenir");
        assert!(expanded.contains(&"basamak".to_string()), "turkce sinonim eklenir");
        assert!(expanded.len() > base.len());
    }

    #[test]
    fn single_word_key_requires_whole_word_not_substring() {
        // "hangi" → "han" alt-dizisi icerir AMA tekil anahtar tam-kelime eslesir → tetiklenMEZ.
        let base = significant_tokens("villa hangi dosyada");
        let expanded = expand_query_tokens("villa hangi dosyada", &base);
        assert!(
            !expanded.contains(&"kervansaray".to_string()),
            "'han' anahtari 'hangi' icinde alt-dizi olsa da tetiklenmemeli"
        );
    }

    #[test]
    fn compound_key_matches_as_substring() {
        let base = significant_tokens("zemin kat plani lazim");
        let expanded = expand_query_tokens("zemin kat plani lazim", &base);
        // "kat plani" compound anahtari alt-dizi olarak eslesir.
        assert!(expanded.contains(&"floor".to_string()) || expanded.contains(&"plan".to_string()));
    }

    #[test]
    fn unknown_query_returns_base_unchanged() {
        let base = significant_tokens("xyzzy qwerty");
        let expanded = expand_query_tokens("xyzzy qwerty", &base);
        assert_eq!(expanded, base, "sozlukte yoksa base aynen doner");
    }
}
