//! Arama yardimcilari — bulanik (fuzzy) eslesme: Levenshtein + SQL UDF kaydi.
//!
//! FTS5 yazim-hatasi toleransi sunmaz. `fuzzy_match(haystack, needle)` UDF'si
//! haystack'i kelimelere boler ve herhangi bir kelime needle'a (uzunluga gore
//! uyarlanan esik icinde) Levenshtein-yakin mi diye bakar. Bulanik arama **opt-in**
//! (ListOpts.fuzzy) ve tam-tarama oldugundan dusuk-QPS arsiv kullanimina uygundur;
//! mevcut FTS yollarini etkilemez (UDF yalniz cagrildiginda calisir).

use rusqlite::functions::FunctionFlags;
use rusqlite::Connection;

/// İki dizge arasi Levenshtein duzenleme mesafesi (DP, O(m*n) zaman, O(n) yer).
pub fn levenshtein(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.is_empty() {
        return b.len();
    }
    if b.is_empty() {
        return a.len();
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for (i, ca) in a.iter().enumerate() {
        cur[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + cost);
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// needle uzunluguna gore tolere edilen maks. mesafe: kisa terim kati, uzun gevsek.
fn max_distance(needle_len: usize) -> usize {
    match needle_len {
        0..=3 => 0, // cok kisa: yalniz tam kelime
        4..=6 => 1,
        _ => 2,
    }
}

/// haystack'teki herhangi bir kelime needle'a (lowercase) esik icinde mi?
/// Kelime ayrimi alfasayisal-olmayanda. Uzunluk on-filtresiyle erken eler.
pub fn fuzzy_word_match(haystack: &str, needle: &str) -> bool {
    let needle = needle.to_lowercase();
    let nlen = needle.chars().count();
    if nlen == 0 {
        return false;
    }
    let maxd = max_distance(nlen);
    for word in haystack.to_lowercase().split(|c: char| !c.is_alphanumeric()) {
        if word.is_empty() {
            continue;
        }
        let wlen = word.chars().count();
        if wlen.abs_diff(nlen) > maxd {
            continue; // uzunluk farki esikten buyuk → imkansiz
        }
        if maxd == 0 {
            if word == needle {
                return true;
            }
        } else if levenshtein(word, &needle) <= maxd {
            return true;
        }
    }
    false
}

/// `fuzzy_match(haystack TEXT, needle TEXT) -> 0/1` UDF'sini kaydet (deterministik).
/// Her acilan baglantida (connection.rs) cagrilir.
pub fn register_functions(conn: &Connection) -> rusqlite::Result<()> {
    conn.create_scalar_function(
        "fuzzy_match",
        2,
        FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| {
            let haystack = ctx.get::<String>(0)?;
            let needle = ctx.get::<String>(1)?;
            Ok(i64::from(fuzzy_word_match(&haystack, &needle)))
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levenshtein_basics() {
        assert_eq!(levenshtein("villa", "villa"), 0);
        assert_eq!(levenshtein("villa", "vila"), 1); // silme
        assert_eq!(levenshtein("villa", "vlila"), 2); // yer degis (2 ikame)
        assert_eq!(levenshtein("", "abc"), 3);
        assert_eq!(levenshtein("kitten", "sitting"), 3); // klasik ornek
    }

    #[test]
    fn fuzzy_word_match_threshold_and_words() {
        // 5 harf → esik 1: tek silme eslesir, alakasiz eslemez.
        assert!(fuzzy_word_match("villa salon", "vila")); // 1 silme
        assert!(!fuzzy_word_match("ofis plani", "vila"));
        // kelime-bazli: dosya adi icindeki kelimeye bakar (ayrac: _ . vb).
        assert!(fuzzy_word_match("2024_villa_kat1.dwg", "vila"));
        // uzun terim (>=7) → esik 2: iki ikame eslesir, uc eslemez.
        assert!(fuzzy_word_match("modern kitchen plan", "katchon")); // 2 ikame
        assert!(!fuzzy_word_match("modern kitchen plan", "katshun")); // 3 ikame
        // cok kisa terim (<=3) → yalniz tam kelime.
        assert!(fuzzy_word_match("ev plani", "ev"));
        assert!(!fuzzy_word_match("eski plan", "ev")); // 'eski' ev'e 1 ama esik 0
        // bos needle → false.
        assert!(!fuzzy_word_match("villa", ""));
    }
}
