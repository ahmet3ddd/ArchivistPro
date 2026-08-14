//! Katman 1 — deterministik render/foto/doku siniflandirici (TAM OFFLINE, model GEREKMEZ).
//!
//! H2 `fileScanner.ts` `refineCategory` (satir 835) + `refineCategoryWithMetadata` (satir 924)
//! **birebir portu**: dosya-adi + klasor + kardes-uzanti + EXIF + boyut sinyallerinden gorselin
//! MEDYA turunu (Fotoğraf | Render | Doku) tayin eder. Saf fonksiyon — hem ingest hem backfill
//! cagirir; DB'ye BAGIMSIZ test edilebilir. Alt moduller: [`device`] (cihaz dosya-adi pattern'leri),
//! [`backfill`] (DB yazma + mevcut asset backfill).
//!
//! ## H2'den TEK kasitli sapma (H3)
//! H2'de raster'in taban kategorisi `Render`'dir → hicbir sinyal atesle­mese bile sonuc `Render`
//! olurdu. H3'te `ai_gorsel_turu` bir KATEGORI degil, AI-turevi bir MEDYA-turu alani (asset'in
//! turu zaten `ext`/`mime`'den bellidir). Bu yuzden **hicbir sinyal atesle­mezse `None`** doner
//! (yazma yapilmaz; belirsiz durumu Katman 2 [vision] doldurur). Pozitif dallarin HEPSI H2 ile
//! birebir. Cikis kanonik TR token frontend i18n/facet ile TAM eslesir.

mod backfill;
mod device;

use device::matches_photo_filename;

/// Gorselin MEDYA turu (icerikten bagimsiz eksen). Kanonik TR token'a [`ImageKind::as_token`]
/// ile cozulur; degerler frontend i18n/facet ile birebir eslesir (vision'un 5 token'inin alt kumesi).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageKind {
    /// "Fotoğraf" — gercek kamera fotografi.
    Fotograf,
    /// "Render" — 3B/bilgisayar uretimi gorsel.
    Render,
    /// "Doku" — texture/malzeme yuzeyi.
    Doku,
}

impl ImageKind {
    /// EAV'ye yazilan kanonik TR token (frontend rozeti bunu okur → yazim TAM bu olmali).
    pub fn as_token(self) -> &'static str {
        match self {
            ImageKind::Fotograf => "Fotoğraf",
            ImageKind::Render => "Render",
            ImageKind::Doku => "Doku",
        }
    }
}

/// Siniflandirmanin uygulandigi raster gorsel uzantilari (DWG/PDF/Office HARIC). Ingest + backfill
/// bu kume ile kapiyi kontrol eder.
pub const RASTER_IMAGE_EXTS: &[&str] =
    &["jpg", "jpeg", "png", "bmp", "tif", "tiff", "tga", "gif", "psd", "webp"];

/// `ext` (nokta­siz) bir raster gorsel mi? (kucuk-harf duyarsiz).
pub fn is_raster_image_ext(ext: &str) -> bool {
    let e = ext.to_ascii_lowercase();
    RASTER_IMAGE_EXTS.contains(&e.as_str())
}

// ── H2 anahtar-kelime sabitleri (birebir port; hepsi kucuk harf) ──────────────

/// STRONG: substring eslesmesi yeterli (bu kelimeler bir fotografta neredeyse hic gecmez).
const RENDER_STRONG_KEYWORDS: &[&str] = &[
    "render", "rendering", "rendered", "rendre", "vray", "v-ray", "corona", "lumion", "enscape",
    "twinmotion", "archviz", "cgi", "visualisation", "visualization", "gorsellestirme",
    "görsellestirme", "gorsellestirilmis", "arnold", "octane", "redshift", "maxwell", "mentalray",
    "mental_ray", "cycles", "eevee", "iray", "fstorm", "thearender", "beauty", "masterbeauty",
    "crypto", "cryptomatte", "denoised",
];

/// WEAK: kelime siniri (word-boundary) ile eslesmeli (substring olarak fotograflarda da gecebilir).
const RENDER_WEAK_KEYWORDS: &[&str] = &[
    "viz", "3d", "final", "output", "view", "scene", "sahne", "gorunum", "görünüm", "visual",
    "gorsel", "görsel", "exterior", "interior", "perspective", "perspektif", "cam", "camera",
];

/// PHOTO: substring eslesmesi (marka/yapim/cihaz ipuclari).
const PHOTO_KEYWORDS: &[&str] = &[
    "foto", "fotograf", "fotoğraf", "photograph", "cek", "çek", "cekim", "çekim", "santiye",
    "şantiye", "mevcut", "existing", "as_built", "asbuilt", "screenshot", "ekran_goruntusu",
    "ekran_görüntüsü", "dcim", "photo_", "_photo", "photos", "canon", "nikon", "sony", "fujifilm",
    "leica", "panasonic", "olympus", "pentax", "lumix", "hasselblad", "iphone", "samsung", "galaxy",
    "xiaomi", "redmi", "huawei", "pixel", "oneplus", "oppo", "vivo", "dji", "mavic", "phantom",
    "inspire", "gopro", "whatsapp", "wechat", "telegram",
];

/// TEXTURE: substring eslesmesi (doku/map/malzeme ipuclari).
const TEXTURE_KEYWORDS: &[&str] = &[
    "doku", "texture", "material", "malzeme", "kaplama", "surface", "seamless", "tileable", "tile",
    "pattern", "desen", "map", "mapping", "pbr", "swatch",
];

/// Doku dosya-adi son ekleri (_diff, _norm, _2k...). `nameWithoutExt` bunlardan biriyle biterse Doku.
const TEXTURE_SUFFIX_PATTERNS: &[&str] = &[
    "_diff", "_diffuse", "_albedo", "_basecolor", "_base_color", "_col", "_color", "_norm",
    "_normal", "_nrm", "_normalmap", "_bump", "_height", "_disp", "_displacement", "_spec",
    "_specular", "_gloss", "_glossiness", "_rough", "_roughness", "_rgh", "_metal", "_metallic",
    "_metalness", "_met", "_ao", "_ambient_occlusion", "_occlusion", "_cavity", "_opacity", "_alpha",
    "_mask", "_transparency", "_emissive", "_emission", "_self_illumination", "_refl", "_reflection",
    "_ior", "_env", "_hdri", "_cubemap", "_1k", "_2k", "_4k", "_8k", "_16k", "_512", "_1024",
    "_2048", "_4096",
];

/// Klasor adlarinda doku/map ipuclari.
/// NOT: Turkce "malzeme"/"malzemeler" KALDIRILDI — "malzeme" hem doku-malzemesi (H2 render arsivi)
/// hem tedarik/parca (H3 karisik arsiv: 3D-yazici/donanim kayitli-web-sayfalari) demek → belirsiz;
/// "malzemeler\..." altindaki dokuntuyu yanlis Doku etiketliyordu. Kesin doku sinyalleri (doku/
/// texture/tex/map/pbr/kaplama/tileable/seamless + `_suffix` + 2^n boyut) korunur.
const TEXTURE_FOLDER_KEYWORDS: &[&str] = &[
    "texture", "textures", "tex", "doku", "dokular", "material", "materials", "map", "maps",
    "mapping", "kaplama", "kaplamalar", "surface", "surfaces", "pbr", "tileable", "seamless",
    "06-dokular",
];

/// Klasor adlarinda render ipuclari.
const RENDER_FOLDER_KEYWORDS: &[&str] = &[
    "render", "renders", "renderlar", "04-renderlar", "output", "outputs", "cikti", "final",
    "gorsel", "gorseller", "visual", "visuals", "vray", "v-ray", "corona", "lumion", "enscape",
    "archviz", "visualization",
];

/// Klasor adlarinda fotograf ipuclari.
const PHOTO_FOLDER_KEYWORDS: &[&str] = &[
    "foto", "fotograf", "fotograflar", "fotoğraf", "fotoğraflar", "photo", "photos", "photograph",
    "photographs", "santiye", "şantiye", "santiye_fotograflari", "mevcut_durum", "mevcut",
    "as_built", "asbuilt", "as-built", "dcim", "screenshot", "screenshots", "ekran_goruntusu",
    "ekran_görüntüsü", "site_photos", "site_photo", "survey", "field", "cekim", "çekim", "cekimler",
    "çekimler",
];

/// "Ayni stem'de" bulununca render is akisi sinyali veren kardes uzantilar (or. `x.jpg` + `x.psd`).
const RENDER_SIBLING_EXTENSIONS: &[&str] =
    &["psd", "max", "3ds", "blend", "c4d", "skp", "rvt", "fbx", "obj", "exr", "hdr"];

/// Yazilim damgasindan render motorunu tanima (EXIF Software / renderSoftware alani).
const KNOWN_RENDER_ENGINES: &[&str] = &[
    "v-ray", "vray", "corona", "lumion", "enscape", "twinmotion", "arnold", "octane", "redshift",
    "maxwell", "mental ray", "mentalray", "cycles", "eevee", "iray", "fstorm", "3ds max", "3dsmax",
    "blender", "sketchup", "cinema 4d", "modo", "rhino", "keyshot", "thearender",
];

/// Yaygin doku boyutlari (her iki kenar da bu listedeyse → Doku; H2 `commonTexSizes`).
/// NOT: 64/128/256 CIKARILDI — H3 karisik arsivde bu boyutlar ikon/avatar/thumbnail (dokuntu);
/// gercek mimari dokular ≥512. Boylece kucuk 2^n gorseller yanlis Doku olmaz.
const COMMON_TEX_SIZES: &[u32] = &[512, 1024, 2048, 4096, 8192, 16384];

// ── Yardimcilar ───────────────────────────────────────────────────────────────

/// H2 `hasWordToken`: `needle`, `haystack`'te kelime-siniriyla gecer mi? Sinir = string basi/sonu
/// veya ASCII alfanumerik OLMAYAN karakter (regex `(^|[^a-z0-9])needle([^a-z0-9]|$)` karsiligi;
/// diakritik/`_`/`-`/`.` sinirdir). `haystack` cagiran tarafinda kucuk-harfe cevrilmis varsayilir.
fn has_word_token(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    for (i, m) in haystack.match_indices(needle) {
        let before_ok =
            i == 0 || !haystack[..i].chars().next_back().is_some_and(|c| c.is_ascii_alphanumeric());
        let after = i + m.len();
        let after_ok = after >= haystack.len()
            || !haystack[after..].chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// Son `.uzanti`'yi at (H2 `replace(/\.[^.]+$/, '')`). Nokta yoksa aynen.
fn strip_ext(name: &str) -> &str {
    match name.rfind('.') {
        Some(pos) if pos > 0 => &name[..pos],
        _ => name,
    }
}

#[inline]
fn is_power_of_two(n: u32) -> bool {
    n > 0 && (n & (n - 1)) == 0
}

// ── Ana siniflandirici ─────────────────────────────────────────────────────────

/// **Saf siniflandirici** — gorselin medya turunu duz sinyallerden tayin et (H2 iki-asamali
/// `refineCategory` + `refineCategoryWithMetadata` zinciri).
///
/// Oncelik: cihaz-adi > doku-suffix > klasor > kardes > isim-anahtar → sonra (Render/Doku ise)
/// EXIF-foto > render-bayrak/motor > boyut. Cihaz-adi/klasor/isim FOTOGRAF verdiyse KESIN. Aksi
/// halde (Render/Doku ara-sonuc) metadata onu EZEBILIR (or. kamera EXIF → Fotograf). Hicbir sinyal
/// yoksa `None` (yazma; H3 sapmasi — modul dokumanina bak).
///
/// - `render_software`: EXIF Software (varsa) — H3'te `is_render` zaten bundan turer; ikisi de gecer.
/// - `siblings`: ayni stem'deki diger dosyalarin uzanti kumesi (BEST-EFFORT; bos → kardes katmani atlanir).
/// - `width`/`height`: `None` → boyut sezgileri uygulanmaz.
#[allow(clippy::too_many_arguments)]
pub fn classify_image_kind(
    file_name: &str,
    path: &str,
    is_render: bool,
    render_software: Option<&str>,
    has_camera: bool,
    has_gps: bool,
    has_focal: bool,
    has_exposure: bool,
    has_iso: bool,
    width: Option<u32>,
    height: Option<u32>,
    siblings: &[&str],
) -> Option<ImageKind> {
    let meta = |current: ImageKind| {
        refine_with_metadata(
            current,
            is_render,
            render_software,
            has_camera,
            has_gps,
            has_focal,
            has_exposure,
            has_iso,
            width,
            height,
        )
    };
    match refine_by_name(file_name, path, siblings) {
        // Isim FOTOGRAF dediyse KESIN (H2: metadata asamasi no-op).
        Some(ImageKind::Fotograf) => Some(ImageKind::Fotograf),
        // Render/Doku ara-sonuc → metadata ezebilir; ezmezse ara-sonuc kalir.
        Some(k) => Some(meta(k).unwrap_or(k)),
        // Hicbir isim sinyali yok → taban Render uzerinden metadata dene; atesle­mezse None (yazma).
        None => meta(ImageKind::Render),
    }
}

/// H2 `refineCategory` — isim + klasor + kardes. `Some` = karar; `None` = taban (sinyal yok).
fn refine_by_name(file_name: &str, path: &str, siblings: &[&str]) -> Option<ImageKind> {
    let lower = file_name.to_lowercase();
    let name_wo_ext = strip_ext(&lower);
    let path_lower = path.to_lowercase().replace('\\', "/");
    // Klasor parcalari = dosya adi (son segment) HARIC.
    let mut segs: Vec<&str> = path_lower.split('/').collect();
    segs.pop();

    // 1) Cihaz dosya-adi pattern → Fotograf (ama once doku suffix'i disla: DSC_0001_diff gibi).
    let has_tex_suffix = TEXTURE_SUFFIX_PATTERNS.iter().any(|s| name_wo_ext.ends_with(s));
    if !has_tex_suffix && matches_photo_filename(name_wo_ext) {
        return Some(ImageKind::Fotograf);
    }
    // 2) Doku suffix'i kesin Doku.
    if has_tex_suffix {
        return Some(ImageKind::Doku);
    }
    // 3) Klasor ipuclari (seg.includes(kw) — `===` ust kume).
    let in_tex = segs.iter().any(|s| TEXTURE_FOLDER_KEYWORDS.iter().any(|kw| s.contains(kw)));
    let in_render = segs.iter().any(|s| RENDER_FOLDER_KEYWORDS.iter().any(|kw| s.contains(kw)));
    let in_photo = segs.iter().any(|s| PHOTO_FOLDER_KEYWORDS.iter().any(|kw| s.contains(kw)));
    if in_photo && !in_tex {
        return Some(ImageKind::Fotograf);
    }
    if in_tex && !in_render && !in_photo {
        return Some(ImageKind::Doku);
    }
    if in_render && !in_tex && !in_photo {
        if PHOTO_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
            return Some(ImageKind::Fotograf);
        }
        return Some(ImageKind::Render);
    }
    // 4) Kardes render sinyali (ayni stem'de PSD/MAX/3DS... → render is akisi).
    for ext in siblings {
        let e = ext.to_ascii_lowercase();
        if RENDER_SIBLING_EXTENSIONS.contains(&e.as_str()) {
            if PHOTO_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                return Some(ImageKind::Fotograf);
            }
            if TEXTURE_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
                return Some(ImageKind::Doku);
            }
            return Some(ImageKind::Render);
        }
    }
    // 5) Dosya-adi anahtar kelime: Foto > Doku > Render-strong (substring) > Render-weak (word).
    if PHOTO_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
        return Some(ImageKind::Fotograf);
    }
    if TEXTURE_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
        return Some(ImageKind::Doku);
    }
    if RENDER_STRONG_KEYWORDS.iter().any(|kw| lower.contains(kw)) {
        return Some(ImageKind::Render);
    }
    if RENDER_WEAK_KEYWORDS.iter().any(|kw| has_word_token(&lower, kw)) {
        return Some(ImageKind::Render);
    }
    None
}

/// H2 `refineCategoryWithMetadata` — EXIF/boyut ile Render/Doku ara-sonucu netlestir. `Some` =
/// bir kural atesle­di (yeni deger); `None` = hicbir metadata kurali atesle­medi (ara-sonuc kalir).
#[allow(clippy::too_many_arguments)]
fn refine_with_metadata(
    current: ImageKind,
    is_render: bool,
    render_software: Option<&str>,
    has_camera: bool,
    has_gps: bool,
    has_focal: bool,
    has_exposure: bool,
    has_iso: bool,
    width: Option<u32>,
    height: Option<u32>,
) -> Option<ImageKind> {
    // 1) EXIF foto sinyali → Fotograf (render motorlari kamera/GPS/optik metadata yazmaz).
    if has_camera || has_gps || has_focal || has_exposure || has_iso {
        return Some(ImageKind::Fotograf);
    }
    // 2) EXIF render bayragi.
    if is_render {
        return Some(ImageKind::Render);
    }
    // 3) Bilinen render motoru (renderSoftware).
    if let Some(sw) = render_software {
        let sw = sw.to_lowercase();
        if !sw.trim().is_empty() && KNOWN_RENDER_ENGINES.iter().any(|e| sw.contains(e)) {
            return Some(ImageKind::Render);
        }
    }
    // 4) Boyut sezgileri.
    if let (Some(w), Some(h)) = (width, height) {
        if w > 0 && h > 0 {
            // Kare + 2^n (≥512) → Doku. (64/128/256 kare = ikon/avatar dokuntusu; ≥512 = gercek doku.)
            if w == h && is_power_of_two(w) && w >= 512 {
                return Some(ImageKind::Doku);
            }
            // Her iki kenar da yaygin doku boyutu → Doku.
            if COMMON_TEX_SIZES.contains(&w) && COMMON_TEX_SIZES.contains(&h) {
                return Some(ImageKind::Doku);
            }
            // NOT: H2'nin `maxSide <= 1280 → Doku` BLANKET kurali KALDIRILDI. H3 karisik arsivde
            // (indirilen urun/web gorselleri, ikonlar) her kucuk gorseli yanlis Doku etiketliyordu
            // (onizleme: 917 gorselin 686'si Doku). Yalniz KESIN doku sinyalleri kalir (2^n kare /
            // yaygin-doku boyut / _suffix / doku klasoru); belirsiz kucuk gorsel None → Katman 2 vision.
            // QHD+ genis ekran (yalniz ara-sonuc Render iken) → Render.
            let aspect = f64::from(w) / f64::from(h);
            let widescreen = (1.3..=2.4).contains(&aspect);
            let ultra = w >= 2560 || h >= 1440;
            if widescreen && ultra && current == ImageKind::Render {
                return Some(ImageKind::Render);
            }
        }
    }
    // NOT: H2'nin `fileSize < 500KB → Doku` son-care dali BU imzada YOK (dosya boyutu parametresi
    // yok; boyut sezgileri pixel-boyutundan turer). Kasitli — bkz gorev notu.
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_canonical_turkish() {
        assert_eq!(ImageKind::Fotograf.as_token(), "Fotoğraf");
        assert_eq!(ImageKind::Render.as_token(), "Render");
        assert_eq!(ImageKind::Doku.as_token(), "Doku");
    }

    #[test]
    fn raster_ext_gate() {
        assert!(is_raster_image_ext("JPG") && is_raster_image_ext("png") && is_raster_image_ext("webp"));
        assert!(!is_raster_image_ext("dwg") && !is_raster_image_ext("pdf") && !is_raster_image_ext("docx"));
    }

    #[test]
    fn word_token_boundaries() {
        assert!(has_word_token("final_view", "final"));
        assert!(has_word_token("3d_kat", "3d"));
        assert!(has_word_token("cam_01", "cam"));
        assert!(!has_word_token("finally", "final"));
        assert!(!has_word_token("scamera", "cam"));
    }
}
