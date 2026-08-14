//! Kanonik yol anahtari — YALNIZ eslestirme icindir, asla DB'ye/diske yazilmaz.
//!
//! Neden var: H2'nin sakladigi `file_path` ile H3 taramasinin urettigi `assets.path`
//! ayni dosyayi harf/ayrac duzeyinde farkli yazabilir (`D:/foo/BAR.jpg` vs `D:\foo\bar.jpg`).
//! H3 `Db::ingest` upsert'i BIREBIR dizge esitligi uzerindendir (`path = ?1`) → kor ingest
//! ayni dosyaya IKINCI satir acar. Bu anahtar iki tarafi ortak bicime katlar.
//!
//! Turkce katlama karari (bilincli asiri-katlama): Rust `to_lowercase` 'İ'yi `i + U+0307`
//! yapar; U+0307 silinince `İ ≡ i ≡ I` esitlenir. Bu NTFS'in varsayilan `$UpCase`
//! katlamasindan bir tik genistir, ama iki taraf da AYNI diskten okunmus adlar oldugundan
//! yanlis-birlesme pratikte olanaksiz; olsa bile eslestirmenin K2 kademesi (ad+boyut+mtime)
//! ayirt eder. `ı` (U+0131) kendi kucuk halidir, bozulmaz. NFC normalizasyonu YAPILMAZ
//! (ayni dosya sistemi → ayni baytlar gelir).

/// H2 yolunu H3'un tarayici-yazim bicimine getirir — **DB'ye yazilan bicim budur**.
/// Kurallar: uzun-yol oneki soyulur (`\\?\UNC\srv\p` → `\\srv\p`, `\\?\C:\` → `C:\`),
/// `/` → `\`, ardisik ayraclar teklenir (UNC bastaki `\\` korunur), sondaki ayrac atilir.
/// **KASA KORUNUR** — H3 diskteki kasayla yazar; kasa cevirisi eslestirme anahtarinin
/// ([`canonical_path_key`]) isidir, kayit biciminin degil.
pub fn normalize_h2_path(p: &str) -> String {
    let mut s = p.trim().replace('/', "\\");

    // 1) Uzun-yol onekleri (buyuk/kucuk duyarsiz).
    if let Some(rest) = strip_prefix_ci(&s, "\\\\?\\UNC\\") {
        s = format!("\\\\{rest}");
    } else if let Some(rest) = strip_prefix_ci(&s, "\\\\?\\") {
        s = rest.to_string();
    }

    // 2) Ayrac tekleme — UNC'nin bastaki cift ters-bolusu korunur.
    let is_unc = s.starts_with("\\\\");
    let mut out = String::with_capacity(s.len());
    let mut prev_sep = false;
    for c in s.chars() {
        if c == '\\' {
            if prev_sep {
                continue;
            }
            prev_sep = true;
        } else {
            prev_sep = false;
        }
        out.push(c);
    }
    let mut s = if is_unc { format!("\\{out}") } else { out };
    while s.len() > 1 && s.ends_with('\\') && !s.ends_with(":\\") {
        s.pop();
    }
    s
}

/// Windows yolunu ESLESTIRME anahtarina katlar: [`normalize_h2_path`] + Unicode lowercase
/// + U+0307 silme. Cift-yol kazanan gruplamasi ve var-olma yoklamasi bu anahtari kullanir.
pub fn canonical_path_key(p: &str) -> String {
    normalize_h2_path(p).to_lowercase().chars().filter(|&c| c != '\u{0307}').collect()
}

/// ASCII buyuk/kucuk duyarsiz onek soyma (yol onekleri salt-ASCII'dir).
fn strip_prefix_ci<'a>(s: &'a str, prefix: &str) -> Option<&'a str> {
    if s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&s[prefix.len()..])
    } else {
        None
    }
}

/// Dosya ADINI ayni kurallarla katlar (K2 kademesinin `(ad, boyut)` anahtari icin).
pub fn fold_name(name: &str) -> String {
    name.trim().to_lowercase().chars().filter(|&c| c != '\u{0307}').collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn case_and_separator_folding() {
        assert_eq!(canonical_path_key("D:/foo/BAR.jpg"), canonical_path_key("d:\\Foo\\bar.JPG"));
        assert_eq!(canonical_path_key("D:\\a\\\\b\\c\\"), canonical_path_key("D:/a/b/c"));
    }

    #[test]
    fn long_path_prefixes_stripped() {
        assert_eq!(canonical_path_key("\\\\?\\C:\\proj\\a.dwg"), canonical_path_key("C:\\proj\\a.dwg"));
        assert_eq!(
            canonical_path_key("\\\\?\\UNC\\DEPO\\Yedekler\\x.dwg"),
            canonical_path_key("\\\\DEPO\\Yedekler\\x.dwg")
        );
    }

    #[test]
    fn unc_double_backslash_preserved() {
        let k = canonical_path_key("\\\\DEPO\\Yedekler\\proje");
        assert!(k.starts_with("\\\\depo"), "UNC cift ayraci korunmali: {k}");
        // Tekleme UNC govdesinde calisir ama bastaki cifti bozmaz.
        assert_eq!(k, canonical_path_key("\\\\DEPO\\\\Yedekler\\\\proje\\"));
    }

    #[test]
    fn turkish_i_folding() {
        // İ ≡ i ≡ I (U+0307 silme + ASCII lowercase).
        assert_eq!(
            canonical_path_key("D:\\PROJE\\İSTANBUL.dwg"),
            canonical_path_key("d:\\proje\\istanbul.dwg")
        );
        assert_eq!(canonical_path_key("D:\\ISIK.jpg"), "d:\\isik.jpg");
        // `ı` BILINCLI olarak ayri kalir (i'ye katlanMAZ): ag paylasimlarindaki
        // buyuk/kucuk-duyarli dosya sistemlerinde "sık.jpg" ile "sik.jpg" farkli
        // dosyalar olabilir; yanlis birlesmektense mukerrer-yaz-ve-raporla yeglenir.
        assert_ne!(fold_name("yastık.jpg"), fold_name("yastik.jpg"));
        assert_eq!(fold_name("YASTIK KUMAŞ.jpg"), "yastik kumaş.jpg");
    }

    #[test]
    fn drive_root_keeps_colon_slash() {
        assert_eq!(canonical_path_key("C:\\"), "c:\\");
    }
}
