//! H2 satirindan H3 yazim degerlerine SAF donusum (IO yok → birim-testli).
//!
//! AI eslemesi `metadata_json`'daki dwg* alanlarini H3'un `ai_*` EAV anahtarlarina cevirir.
//! Iki uretim-kurali buraya da uygulanir (H3 vision hattiyla parite):
//! - **Kelepce:** `dwgDrawingType` kanonik listeye kelepcelenir (`normalize_tr` + en-uzun
//!   eslesme — vision.rs'in kuralinin aynisi). Listede karsiligi yoksa alan DUSER
//!   (uydurma "Diğer" yazilmaz) + sayac.
//! - **Asgari doluluk:** 2'den az icerik alani ureten analiz YAZILMAZ (`MIN_AI_FIELDS`;
//!   H3 `is_usable` esiginin aynisi). Tek alanli cop `ai_analyzed` damgasi basip dosyayi
//!   kalici "analizli" yapardi — H3'un kendi modeli bir daha denemezdi.

use base64::Engine as _;

use crate::time::parse_h2_timestamp;

/// H3 `is_usable` esiginin karsiligi (vision.rs `MIN_FILLED_FIELDS` = 2).
pub const MIN_AI_FIELDS: usize = 2;

/// AI eslemesinin sonucu.
#[derive(Debug, Default, Clone)]
pub struct MappedAi {
    /// `set_ai_metadata`'ya gidecek (anahtar, deger) ciftleri — `ai_model` dahil.
    pub fields: Vec<(String, String)>,
    /// `ai_gorsel_turu` icin deger (yalniz `Fotoğraf`/`Render`; ayri korumali kapidan yazilir).
    pub gorsel_turu: Option<String>,
    /// Kelepceye takilan (listede karsiligi olmayan) cizim turu — rapora.
    pub drawing_type_dropped: bool,
    /// `fields` esik altinda kaldi (yazilMAYACAK) — rapora.
    pub too_thin: bool,
}

/// `metadata_json` + `ai_tags_json` → H3 AI alanlari.
/// `drawing_types`: kanonik liste (vision.rs `DRAWING_TYPES` — komut katmani enjekte eder).
/// `extracted_at`: H2 analiz zamani → `ai_analyzed_at` (epoch-MS; H3 konvansiyonu).
pub fn map_ai(
    metadata_json: Option<&str>,
    ai_tags_json: Option<&str>,
    drawing_types: &[&str],
    extracted_at: Option<&str>,
) -> Option<MappedAi> {
    let meta: Option<serde_json::Value> =
        metadata_json.and_then(|s| serde_json::from_str(s).ok());
    let tags: Vec<String> = ai_tags_json
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.as_array().cloned())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| t.get("label").and_then(|l| l.as_str()).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let m = meta.as_ref();
    let s = |k: &str| -> Option<String> {
        m.and_then(|v| v.get(k)).and_then(|x| x.as_str()).map(str::trim).filter(|x| !x.is_empty()).map(String::from)
    };
    let arr = |k: &str| -> Vec<String> {
        m.and_then(|v| v.get(k))
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|e| e.as_str().map(str::trim).filter(|s| !s.is_empty()).map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    };

    let drawing_type_raw = s("dwgDrawingType");
    let description = s("dwgDescription");
    let elements = arr("dwgElements");
    let spaces = arr("dwgSpaces");
    let domain_terms = arr("dwgDomainTerms");
    let keywords = arr("dwgKeywords");
    let gorsel_turu = m
        .and_then(|v| v.get("aiClassification"))
        .and_then(|c| c.get("type"))
        .and_then(|t| t.as_str())
        .filter(|t| matches!(*t, "Fotoğraf" | "Render"))
        .map(String::from);

    // Hicbir AI icerigi yoksa esleme de yok (gorsel_turu tek basina gecerli sonuc olabilir).
    if drawing_type_raw.is_none()
        && description.is_none()
        && elements.is_empty()
        && spaces.is_empty()
        && domain_terms.is_empty()
        && keywords.is_empty()
        && tags.is_empty()
        && gorsel_turu.is_none()
    {
        return None;
    }

    // Kelepce: vision.rs kurali — normalize_tr + EN UZUN eslesme; yoksa alan duser.
    let mut drawing_type_dropped = false;
    let drawing_type = drawing_type_raw.as_deref().and_then(|raw| {
        let nm = archivist_db::normalize_tr(raw);
        let mut best: Option<&&str> = None;
        for k in drawing_types {
            if nm.contains(&archivist_db::normalize_tr(k)) && best.is_none_or(|b| k.len() > b.len())
            {
                best = Some(k);
            }
        }
        if best.is_none() {
            drawing_type_dropped = true;
        }
        best.map(|k| (*k).to_string())
    });

    // Anahtar-kelime harmani: dwgKeywords + AITag etiketleri; kasa-duyarsiz mukerrer ayikla.
    let mut merged_keywords: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for k in keywords.into_iter().chain(tags) {
        if seen.insert(archivist_db::normalize_tr(&k)) {
            merged_keywords.push(k);
        }
    }

    let mut fields: Vec<(String, String)> = Vec::new();
    if let Some(t) = drawing_type {
        fields.push(("ai_cizim_turu".into(), t));
    }
    if let Some(d) = description {
        fields.push(("ai_aciklama".into(), d));
    }
    if !elements.is_empty() {
        fields.push(("ai_elemanlar".into(), elements.join(", ")));
    }
    if !spaces.is_empty() {
        fields.push(("ai_mekanlar".into(), spaces.join(", ")));
    }
    if !domain_terms.is_empty() {
        fields.push(("ai_ozel_terimler".into(), domain_terms.join(", ")));
    }
    if !merged_keywords.is_empty() {
        fields.push(("ai_anahtar_kelimeler".into(), merged_keywords.join(", ")));
    }

    let content_count = fields.len();
    let too_thin = content_count > 0 && content_count < MIN_AI_FIELDS;
    if too_thin || content_count == 0 {
        // Icerik yazilmayacak — ama gorsel_turu hala tasinabilir.
        return Some(MappedAi {
            fields: Vec::new(),
            gorsel_turu,
            drawing_type_dropped,
            too_thin,
        });
    }

    // Koken izi: model + analiz zamani (H3 konvansiyonu: ai_analyzed_at epoch-MS).
    fields.push(("ai_model".into(), "h2-import".into()));
    if let Some(ts) = extracted_at.and_then(parse_h2_timestamp) {
        fields.push(("ai_analyzed_at".into(), (ts * 1000).to_string()));
    }

    Some(MappedAi { fields, gorsel_turu, drawing_type_dropped, too_thin: false })
}

/// `data:image/...;base64,...` inline thumbnail'ini coz ve DOGRULA.
/// Donen: `(mime, genislik, yukseklik, baytlar)`. Bozuk base64/gorsel → `None`
/// (cagiran satiri atlar + rapora yazar; bozuk bayt `asset_thumbnails`'a sizmasin).
pub fn decode_thumbnail(data_url: &str) -> Option<(String, i64, i64, Vec<u8>)> {
    let rest = data_url.strip_prefix("data:")?;
    let (mime, b64) = rest.split_once(";base64,")?;
    if !mime.starts_with("image/") {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).ok()?;
    let img = image::load_from_memory(&bytes).ok()?;
    Some((mime.to_string(), i64::from(img.width()), i64::from(img.height()), bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    const TYPES: &[&str] = &["Kat Planı", "Cephe", "Kesit", "Detay", "Diğer"];

    #[test]
    fn maps_full_metadata_to_ai_fields() {
        let meta = r#"{"dwgDrawingType":"Kat Planı","dwgDescription":"3. kat","dwgElements":["duvar","kapı"],"dwgSpaces":["salon"],"dwgKeywords":["konut"],"dwgDomainTerms":["mukarnas"]}"#;
        let ai = map_ai(Some(meta), None, TYPES, Some("2026-06-27T10:00:00Z")).unwrap();
        let get = |k: &str| ai.fields.iter().find(|(kk, _)| kk == k).map(|(_, v)| v.clone());
        assert_eq!(get("ai_cizim_turu").as_deref(), Some("Kat Planı"));
        assert_eq!(get("ai_aciklama").as_deref(), Some("3. kat"));
        assert_eq!(get("ai_elemanlar").as_deref(), Some("duvar, kapı"));
        assert_eq!(get("ai_model").as_deref(), Some("h2-import"));
        // extracted_at → epoch-MS.
        let ms: i64 = get("ai_analyzed_at").unwrap().parse().unwrap();
        assert_eq!(ms % 1000, 0);
        assert!(!ai.too_thin && !ai.drawing_type_dropped);
    }

    #[test]
    fn clamps_drawing_type_and_drops_unknown() {
        // ASCII/kucuk-harf "kat plani" kanonik "Kat Planı"na oturur (normalize_tr paritesi).
        let ai = map_ai(
            Some(r#"{"dwgDrawingType":"kat plani","dwgDescription":"taslak"}"#),
            None,
            TYPES,
            None,
        )
        .unwrap();
        assert_eq!(ai.fields[0], ("ai_cizim_turu".into(), "Kat Planı".into()));
        // Listede olmayan tur DUSER — "Diğer" UYDURULMAZ; kalan tek alan esik alti → too_thin.
        let ai = map_ai(
            Some(r#"{"dwgDrawingType":"Uydurma Tur","dwgDescription":"x"}"#),
            None,
            TYPES,
            None,
        )
        .unwrap();
        assert!(ai.drawing_type_dropped);
        assert!(ai.too_thin, "tek alan (aciklama) esik altinda");
        assert!(ai.fields.is_empty());
    }

    #[test]
    fn keyword_blend_dedupes_case_insensitive() {
        let ai = map_ai(
            Some(r#"{"dwgDescription":"cami","dwgKeywords":["Minare","kubbe"]}"#),
            Some(r#"[{"label":"minare","source":"clip"},{"label":"cami","source":"clip"}]"#),
            TYPES,
            None,
        )
        .unwrap();
        let kw = ai.fields.iter().find(|(k, _)| k == "ai_anahtar_kelimeler").unwrap().1.clone();
        // "Minare" bir kez (AITag'in "minare"si mukerrer ayiklanir), "cami" eklenir.
        assert_eq!(kw, "Minare, kubbe, cami");
    }

    #[test]
    fn classification_only_yields_gorsel_turu_without_fields() {
        let ai = map_ai(
            Some(r#"{"aiClassification":{"type":"Render","confidence":0.8}}"#),
            None,
            TYPES,
            None,
        )
        .unwrap();
        assert_eq!(ai.gorsel_turu.as_deref(), Some("Render"));
        assert!(ai.fields.is_empty(), "icerik alani yok → set_ai_metadata cagrilmaz");
        // Bilinmeyen siniflandirma tasinmaz.
        let ai =
            map_ai(Some(r#"{"aiClassification":{"type":"Kolaj"}}"#), None, TYPES, None);
        assert!(ai.is_none(), "gecersiz tur + baska icerik yok → esleme yok");
    }

    #[test]
    fn empty_or_garbage_json_maps_to_none() {
        assert!(map_ai(None, None, TYPES, None).is_none());
        assert!(map_ai(Some("bozuk{"), None, TYPES, None).is_none());
        assert!(map_ai(Some("{}"), Some("[]"), TYPES, None).is_none());
    }

    #[test]
    fn thumbnail_decode_validates_image_bytes() {
        // 1x1 PNG.
        const PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
        let (mime, w, h, bytes) = decode_thumbnail(&format!("data:image/png;base64,{PNG}")).unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!((w, h), (1, 1));
        assert!(!bytes.is_empty());
        // Bozuk base64 / gorsel-olmayan icerik → None.
        assert!(decode_thumbnail("data:image/png;base64,***bozuk***").is_none());
        assert!(decode_thumbnail("data:text/plain;base64,aGV5").is_none());
        let fake = base64::engine::general_purpose::STANDARD.encode(b"gorsel degil");
        assert!(decode_thumbnail(&format!("data:image/png;base64,{fake}")).is_none());
    }
}
