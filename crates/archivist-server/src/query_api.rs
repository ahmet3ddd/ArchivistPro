//! `/assets` uc noktasinin sorgu-parametresi katmani — cozme + sinir kelepceleri.
//!
//! **NEDEN `opts` = TEK bir JSON parametresi (alan-alan query string DEGIL):** `ListOpts`
//! ZATEN `Deserialize` (renderer→Tauri yolunda kullaniliyor). Alanlari tek tek query
//! parametresine acmak, `ListOpts`'un IKINCI bir ayristiricisini dogururdu; her yeni facet
//! iki yerde bakim isterdi. 2026-07-19 metadata-facet isinin dersi tam buydu: **tek genel
//! mekanizma** → yeni facet = sifir LAN degisikligi. Tel formati boylece yerel IPC ile
//! BIREBIR ayni kalir; kontrat kaymasi (drift) yapisal olarak imkansizdir.
//!
//! Bu modul DB'yi TANIMAZ — yalnizca metni gecirir (`archivist-server`'in DB'siz durusu korunur).

/// `opts` parametresinin (percent-encoded haliyle) en fazla uzunlugu. Asiri-uzun URL'e karsi
/// savunma: ayristirmadan ONCE reddedilir (serde'ye buyuk govde hic verilmez).
pub const MAX_OPTS_LEN: usize = 8192;

/// Ayristirma hatasi — tel formatindaki stabil hata kodu (istemci bunlara gore dallanabilir).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OptsError {
    /// `opts` MAX_OPTS_LEN'i asti.
    TooLong,
    /// percent-decode basarisiz (bozuk `%XX` kacisi veya gecersiz UTF-8).
    Decode,
}

impl OptsError {
    pub fn code(self) -> &'static str {
        match self {
            OptsError::TooLong => "opts_too_long",
            OptsError::Decode => "opts_decode",
        }
    }
}

/// `opts` JSON'unu URL query'sine gomulecek hale getir (RFC 3986: unreserved DISI her bayt `%XX`).
///
/// [`opts_from_url`]'in TERSI. **Ikisi bilincli olarak AYNI MODULDE durur:** tel formatinin iki
/// yakasi (istemci kodlar, host cozer) ayri crate'lerde yasasaydi biri digerinden sessizce kayabilirdi.
/// Burada round-trip testi ikisini birlikte kilitler.
pub fn encode_opts_param(opts_json: &str) -> String {
    let mut out = String::with_capacity(opts_json.len() * 2);
    for &b in opts_json.as_bytes() {
        // RFC 3986 unreserved: ALPHA / DIGIT / "-" / "." / "_" / "~"
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push('%');
            out.push_str(&format!("{b:02X}"));
        }
    }
    out
}

/// URL'den `opts` JSON metnini cikar. Parametre YOKSA `"{}"` doner
/// (→ `ListOpts::default()` → ilk sayfa, varsayilan boyut). Deger DB'ye degil, cagirana verilir.
pub fn opts_from_url(url: &str) -> Result<String, OptsError> {
    param_json_from_url(url, "opts")
}

/// `/rag` ucunun `req` JSON parametresini kodla — [`opts_from_url`]'in ikizi olan
/// [`req_from_url`]'in TERSI. Kodlama [`encode_opts_param`] ile BIREBIR ayni (RFC 3986
/// percent-encode); ayri bir govde YERINE ayni kodlayici cagrilir → iki uc arasinda kodlama
/// kaymasi olamaz. `req` JSON = `{"question":...,"scope":...,"options":...,"top_k":...}`.
pub fn encode_req_param(req_json: &str) -> String {
    encode_opts_param(req_json)
}

/// URL'den `/rag` ucunun `req` JSON metnini cikar ([`opts_from_url`] ikizi; ayni sinir/decode
/// kelepceleri). Parametre YOKSA `"{}"` (→ bos req; cagiran alanlari serde varsayilaniyla doldurur).
pub fn req_from_url(url: &str) -> Result<String, OptsError> {
    param_json_from_url(url, "req")
}

/// Tek bir JSON-tasiyan query parametresini (percent-encoded) coz — `opts`/`req` ORTAK yolu.
/// Yoksa `"{}"`; MAX_OPTS_LEN asimi → `TooLong`; bozuk kacis/UTF-8 → `Decode`.
fn param_json_from_url(url: &str, key: &str) -> Result<String, OptsError> {
    let Some(raw) = raw_param(url, key) else {
        return Ok("{}".to_string());
    };
    if raw.len() > MAX_OPTS_LEN {
        return Err(OptsError::TooLong);
    }
    percent_decode(raw).ok_or(OptsError::Decode)
}

/// `/thumbs` icin tek istekte istenebilecek EN FAZLA id. Grid bir sayfada ~60 kart gosterir;
/// 200 rahat pay birakir. Asan istek KESILMEZ, REDDEDILIR (sessiz kirpma "hepsi geldi" gibi
/// okunurdu — projenin "sessiz kirpma yok" ilkesi).
pub const MAX_THUMB_IDS: usize = 200;

/// `/asset/{id}` yolundan id'yi cikar. Yalniz `/asset/<rakamlar>` kabul edilir.
///
/// 🔒 **Yol-gecisi (path traversal) burada oluyor mu?** HAYIR — ve bu bir tercih degil, olcum
/// sonucu: `/asset/{id}` ve `/thumbs` DB'den okur (`get_asset`, `asset_thumbnails` tablosu),
/// dosya sistemine HIC dokunmaz. Istemciden gelen deger bir SAYIYA cevrilir; sayi olmayan her
/// sey reddedilir ⇒ `..`, `/`, surucu harfi gibi diziler zaten ayristirmayi gecemez.
///
/// ⚠️ **GELECEK ICIN KURAL:** dosya BAYTLARI sunan bir uc (tasarim §8 Faz 4, su an kapsam disi)
/// eklenirse bu bagisiklik BITER. O gun kural: istemci yalniz `id` gonderir, yol DB'den cozulur
/// ve kayitli kok klasorlerin altinda mi diye dogrulanir (tasarim §6.1).
pub fn asset_id_from_path(path: &str) -> Option<i64> {
    let rest = path.strip_prefix("/asset/")?;
    // Alt-yol YOK: `/asset/12/x` reddedilir (gelecekteki bir alt-ucla karistirilmasin).
    if rest.is_empty() || rest.contains('/') {
        return None;
    }
    // `parse::<i64>` isaret kabul eder; negatif/`+` id anlamsiz → yalniz rakam.
    if !rest.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    rest.parse::<i64>().ok()
}

/// `?ids=1,2,3` → id listesi. Parametre yoksa bos liste (→ bos sonuc, hata DEGIL).
/// Rakam olmayan girdi veya [`MAX_THUMB_IDS`] asimi → [`OptsError`].
pub fn ids_from_url(url: &str) -> Result<Vec<i64>, OptsError> {
    let Some(raw) = raw_param(url, "ids") else {
        return Ok(Vec::new());
    };
    if raw.len() > MAX_OPTS_LEN {
        return Err(OptsError::TooLong);
    }
    let decoded = percent_decode(raw).ok_or(OptsError::Decode)?;
    let trimmed = decoded.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for part in trimmed.split(',') {
        let p = part.trim();
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            return Err(OptsError::Decode); // sayi olmayan → istek bozuk, sessizce atlanmaz
        }
        out.push(p.parse::<i64>().map_err(|_| OptsError::Decode)?);
        if out.len() > MAX_THUMB_IDS {
            return Err(OptsError::TooLong);
        }
    }
    Ok(out)
}

/// Query string'ten bir parametrenin HAM (henuz cozulmemis) degerini al.
/// Ilk eslesme kazanir; parametre yoksa `None`, degeri bossa `Some("")`.
fn raw_param<'a>(url: &'a str, key: &str) -> Option<&'a str> {
    let query = url.split('?').nth(1)?;
    let prefix = format!("{key}=");
    query.split('&').find_map(|kv| kv.strip_prefix(prefix.as_str()))
}

/// RFC 3986 percent-decode. Bozuk kacis veya gecersiz UTF-8 → `None` (sessizce bozuk metin
/// uretmez; cagiran 400 doner).
///
/// ⚠️ **`+` BOSLUGA CEVRILMEZ** — bu bilincli. `+`→bosluk yalniz `x-www-form-urlencoded`
/// kuralidir; bizim istemcimiz `encodeURIComponent` kullanir ve o `+` karakterini
/// KACIRMAZ. `+`'yi bosluk saysaydik, icinde `+` gecen bir arama sorgusu (`"a+b"`) telde
/// sessizce bozulurdu.
fn percent_decode(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return None; // yarim kacis (`%A` / `%`)
            }
            let hi = (bytes[i + 1] as char).to_digit(16)?;
            let lo = (bytes[i + 2] as char).to_digit(16)?;
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parametre_yoksa_bos_nesne() {
        assert_eq!(opts_from_url("/assets").unwrap(), "{}");
        assert_eq!(opts_from_url("/assets?foo=1").unwrap(), "{}", "baska param → yine varsayilan");
    }

    #[test]
    fn json_cozulur() {
        // encodeURIComponent('{"page":2,"query":"villa"}') ciktisi
        let url = "/assets?opts=%7B%22page%22%3A2%2C%22query%22%3A%22villa%22%7D";
        assert_eq!(opts_from_url(url).unwrap(), r#"{"page":2,"query":"villa"}"#);
    }

    #[test]
    fn coklu_parametre_arasindan_secer() {
        let url = "/assets?x=1&opts=%7B%7D&y=2";
        assert_eq!(opts_from_url(url).unwrap(), "{}");
    }

    #[test]
    fn utf8_turkce_korunur() {
        // encodeURIComponent('{"query":"Fotoğraf"}')
        let url = "/assets?opts=%7B%22query%22%3A%22Foto%C4%9Fraf%22%7D";
        assert_eq!(opts_from_url(url).unwrap(), r#"{"query":"Fotoğraf"}"#);
    }

    #[test]
    fn arti_isareti_bosluga_cevrilmez() {
        // Bilincli sapma: `+` literal kalir (bkz percent_decode dokumani).
        let url = "/assets?opts=a+b";
        assert_eq!(opts_from_url(url).unwrap(), "a+b");
    }

    #[test]
    fn bozuk_kacis_reddedilir() {
        assert_eq!(opts_from_url("/assets?opts=%").unwrap_err(), OptsError::Decode);
        assert_eq!(opts_from_url("/assets?opts=%A").unwrap_err(), OptsError::Decode);
        assert_eq!(opts_from_url("/assets?opts=%ZZ").unwrap_err(), OptsError::Decode);
    }

    #[test]
    fn gecersiz_utf8_reddedilir() {
        // %FF tek basina gecerli UTF-8 degil.
        assert_eq!(opts_from_url("/assets?opts=%FF").unwrap_err(), OptsError::Decode);
    }

    #[test]
    fn asiri_uzun_reddedilir() {
        let long = "a".repeat(MAX_OPTS_LEN + 1);
        assert_eq!(opts_from_url(&format!("/assets?opts={long}")).unwrap_err(), OptsError::TooLong);
        // Tam sinirda GECER (off-by-one kontrolu).
        let edge = "a".repeat(MAX_OPTS_LEN);
        assert!(opts_from_url(&format!("/assets?opts={edge}")).is_ok());
    }

    /// 🔑 TEL SOZLESMESI: istemcinin kodladigi, host'un COZDUGU seydir. Bu test iki yakayi
    /// birbirine kilitler — biri degisip digeri degismezse burasi duser.
    #[test]
    fn kodla_coz_round_trip() {
        let cases = [
            "{}",
            r#"{"page":2,"page_size":60}"#,
            r#"{"query":"villa veya ofis"}"#,          // bosluk
            r#"{"query":"Fotoğraf çizim ölçü"}"#,      // UTF-8 (cok baytli)
            r#"{"query":"a+b"}"#,                      // + literal kalmali
            r#"{"query":"a&b=c"}"#,                    // query ayiricilari
            r#"{"query":"kesir 1/50 #etiket"}"#,       // / ve # (fragment ayiricisi)
            r#"{"path_prefix":"C:\\Proje\\Villa"}"#,   // ters bolu + iki nokta
            r#"{"metadata":[{"key":"unit_type","values":["Santimetre","Metre"]}]}"#,
        ];
        for original in cases {
            let encoded = encode_opts_param(original);
            let url = format!("/assets?opts={encoded}");
            let decoded = opts_from_url(&url).expect("cozulmeli");
            assert_eq!(decoded, original, "round-trip bozuldu: {original}");
        }
    }

    /// 🔑 `/rag` TEL SOZLESMESI: `req` kodlayici/cozucusu (`encode_req_param`/`req_from_url`)
    /// `opts` ikiziyle AYNI kodlamayi paylasir; bu test iki yakayi kilitler. Zor vakalar:
    /// Turkce · bosluk · `+` · `&`/`=`/`#` (query ayiricilari) · `\` (ters bolu) · `/`.
    #[test]
    fn req_kodla_coz_round_trip() {
        let cases = [
            "{}",
            r#"{"question":"merdiven hangi dosyada","topK":6}"#,
            r#"{"question":"Fotoğraf çizim ölçü nerede a+b"}"#,        // UTF-8 + bosluk + `+`
            r#"{"question":"a&b=c #etiket kesir 1/50"}"#,              // & = # / ayiricilar
            r#"{"question":"C:\\Proje\\Villa yolu"}"#,                 // ters bolu
            r#"{"question":"q","scope":{"kind":"ids","ids":[1,2,3]},"options":{"rerank":true}}"#,
        ];
        for original in cases {
            let encoded = encode_req_param(original);
            let url = format!("/rag?req={encoded}");
            let decoded = req_from_url(&url).expect("cozulmeli");
            assert_eq!(decoded, original, "req round-trip bozuldu: {original}");
        }
    }

    #[test]
    fn req_yoksa_bos_nesne_ve_sinirlar() {
        assert_eq!(req_from_url("/rag").unwrap(), "{}", "req yok → varsayilan");
        assert_eq!(req_from_url("/rag?foo=1").unwrap(), "{}", "baska param → yine varsayilan");
        // opts ile ayni sinir/decode kelepceleri (param_json_from_url paylasimi).
        assert_eq!(req_from_url("/rag?req=%").unwrap_err(), OptsError::Decode);
        let long = "a".repeat(MAX_OPTS_LEN + 1);
        assert_eq!(req_from_url(&format!("/rag?req={long}")).unwrap_err(), OptsError::TooLong);
    }

    #[test]
    fn kodlama_query_ayiricilarini_kacirir() {
        // & = # bosluk kacirilmazsa URL'in kendisi parcalanirdi (parametre siniri kayar).
        let encoded = encode_opts_param(r#"{"q":"a&b"}"#);
        assert!(!encoded.contains('&'), "& kacirilmali: {encoded}");
        assert!(!encoded.contains('='), "= kacirilmali: {encoded}");
        assert!(!encoded.contains('#'), "# kacirilmali: {encoded}");
        assert!(!encoded.contains(' '), "bosluk kacirilmali: {encoded}");
        // Unreserved karakterler GEREKSIZ yere sismez (URL kisa kalir).
        assert_eq!(encode_opts_param("abcXYZ019-._~"), "abcXYZ019-._~");
    }

    #[test]
    fn asset_id_yalniz_rakam_kabul_eder() {
        assert_eq!(asset_id_from_path("/asset/42"), Some(42));
        assert_eq!(asset_id_from_path("/asset/0"), Some(0));
        // 🔒 Yol-gecisi denemeleri ayristirmayi GECEMEZ (sayi degil).
        assert_eq!(asset_id_from_path("/asset/../../etc/passwd"), None);
        assert_eq!(asset_id_from_path("/asset/..%2F..%2Fx"), None);
        assert_eq!(asset_id_from_path("/asset/C:\\Windows\\win.ini"), None);
        assert_eq!(asset_id_from_path("/asset/12/thumb"), None, "alt-yol reddedilir");
        // Diger bozuk girdiler.
        assert_eq!(asset_id_from_path("/asset/"), None);
        assert_eq!(asset_id_from_path("/asset/abc"), None);
        assert_eq!(asset_id_from_path("/asset/-5"), None, "negatif id anlamsiz");
        assert_eq!(asset_id_from_path("/asset/+5"), None);
        assert_eq!(asset_id_from_path("/asset/1e3"), None);
        assert_eq!(asset_id_from_path("/assets/5"), None, "baska uc");
    }

    #[test]
    fn ids_listesi_ayristirilir() {
        assert_eq!(ids_from_url("/thumbs?ids=1,2,3").unwrap(), vec![1, 2, 3]);
        assert_eq!(ids_from_url("/thumbs?ids=7").unwrap(), vec![7]);
        // Percent-kodlu virgul (encodeURIComponent `,` → `%2C`) da calisir.
        assert_eq!(ids_from_url("/thumbs?ids=1%2C2").unwrap(), vec![1, 2]);
        // Parametre yok / bos → bos liste (hata DEGIL; bos sonuc dogal).
        assert!(ids_from_url("/thumbs").unwrap().is_empty());
        assert!(ids_from_url("/thumbs?ids=").unwrap().is_empty());
    }

    #[test]
    fn ids_bozuk_girdiyi_sessizce_atlamaz() {
        // Sayi olmayan bir oge tum istegi bozuk yapar — "bir kismini yok say" davranisi
        // eksik sonucu "tam sonuc" gibi gosterirdi.
        assert_eq!(ids_from_url("/thumbs?ids=1,abc,3").unwrap_err(), OptsError::Decode);
        assert_eq!(ids_from_url("/thumbs?ids=1,,3").unwrap_err(), OptsError::Decode);
        assert_eq!(ids_from_url("/thumbs?ids=-1").unwrap_err(), OptsError::Decode);
        assert_eq!(ids_from_url("/thumbs?ids=../../x").unwrap_err(), OptsError::Decode);
    }

    #[test]
    fn ids_tavani_reddedilir_kirpilmaz() {
        let many = (1..=MAX_THUMB_IDS + 1).map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        assert_eq!(ids_from_url(&format!("/thumbs?ids={many}")).unwrap_err(), OptsError::TooLong);
        // Tam sinirda GECER (off-by-one).
        let edge = (1..=MAX_THUMB_IDS).map(|i| i.to_string()).collect::<Vec<_>>().join(",");
        assert_eq!(ids_from_url(&format!("/thumbs?ids={edge}")).unwrap().len(), MAX_THUMB_IDS);
    }

    #[test]
    fn hata_kodlari_stabil() {
        assert_eq!(OptsError::TooLong.code(), "opts_too_long");
        assert_eq!(OptsError::Decode.code(), "opts_decode");
    }
}
