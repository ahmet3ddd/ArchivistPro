//! Katman 1 saf siniflandirici (`classify_image_kind`) katman-katman davranis testleri.
//!
//! Her katman + oncelik cakismalari + H3 sapmasi (sinyal yok → None). Ozel yardimci `matches_
//! photo_filename`/`has_word_token` modul-ici birim testlerinde; burada KAMU davranis sozlesmesi.

use archivist_db::{classify_image_kind, ImageKind};

/// Kisa sarmalayici (notr yol/ad; opsiyonel boyut/kardes). Argüman sirasi imza ile ayni.
#[allow(clippy::too_many_arguments)]
fn c(
    name: &str,
    path: &str,
    is_render: bool,
    sw: Option<&str>,
    cam: bool,
    gps: bool,
    focal: bool,
    exp: bool,
    iso: bool,
    w: Option<u32>,
    h: Option<u32>,
    sib: &[&str],
) -> Option<ImageKind> {
    classify_image_kind(name, path, is_render, sw, cam, gps, focal, exp, iso, w, h, sib)
}

#[test]
fn exif_camera_signals_photo() {
    // Kamera/GPS/focal/pozlama/ISO'dan HERHANGI biri → Fotograf (isim + klasor notr).
    let p = "C:/arsiv/kayit/x/sahne.jpg";
    for (cam, gps, focal, exp, iso) in [
        (true, false, false, false, false),
        (false, true, false, false, false),
        (false, false, true, false, false),
        (false, false, false, true, false),
        (false, false, false, false, true),
    ] {
        assert_eq!(
            c("kare.jpg", p, false, None, cam, gps, focal, exp, iso, None, None, &[]),
            Some(ImageKind::Fotograf)
        );
    }
}

#[test]
fn is_render_flag_and_engine_software() {
    let p = "C:/arsiv/kayit/kare.png";
    // is_render bayragi → Render.
    assert_eq!(c("kare.png", p, true, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Render));
    // Bilinen motor (renderSoftware) → Render.
    assert_eq!(c("kare.png", p, false, Some("V-Ray Next"), false, false, false, false, false, None, None, &[]), Some(ImageKind::Render));
    assert_eq!(c("kare.png", p, false, Some("Corona Renderer 8"), false, false, false, false, false, None, None, &[]), Some(ImageKind::Render));
    // Bilinmeyen software (Photoshop) + baska sinyal yok → None (motor listesinde degil).
    assert_eq!(c("kare.png", p, false, Some("Adobe Photoshop 25.0"), false, false, false, false, false, None, None, &[]), None);
}

#[test]
fn device_filename_photo() {
    let p = "C:/arsiv/kayit/";
    for name in ["IMG_0001.jpg", "DSC_0001.jpg", "DJI_0042.jpg", "PXL_20240515_133045.jpg", "20240515_133045.jpg"] {
        assert_eq!(c(name, p, false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Fotograf), "cihaz adi: {name}");
    }
}

#[test]
fn texture_suffix_and_size_doku() {
    let p = "C:/arsiv/kayit/";
    // _diff / _2k / _normal son ekleri → Doku.
    assert_eq!(c("wood_diff.jpg", p, false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Doku));
    assert_eq!(c("brick_2k.png", p, false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Doku));
    assert_eq!(c("metal_normal.png", p, false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Doku));
    // Kare + 2^n → Doku.
    assert_eq!(c("kare.png", p, false, None, false, false, false, false, false, Some(1024), Some(1024), &[]), Some(ImageKind::Doku));
    // Yaygin doku boyutu (her iki kenar da 2^n listesinde, kare olmasa da) → Doku.
    assert_eq!(c("kare.png", p, false, None, false, false, false, false, false, Some(2048), Some(1024), &[]), Some(ImageKind::Doku));
    // Kucuk 800x600 ARTIK blanket Doku DEGIL (H3 sapmasi; ≤1280 blanket kurali kaldirildi) →
    // sinyalsiz kucuk gorsel None → Katman 2 vision karar verir.
    assert_eq!(c("kare.png", p, false, None, false, false, false, false, false, Some(800), Some(600), &[]), None);
}

#[test]
fn small_2n_icons_not_doku_but_strong_signal_wins() {
    let p = "C:/arsiv/kayit/sayfa_files/";
    // Kucuk 2^n kare (ikon/avatar/thumbnail dokuntusu) ARTIK Doku DEGIL (esik ≥512) → sinyalsiz None.
    assert_eq!(c("thumb.png", p, false, None, false, false, false, false, false, Some(64), Some(64), &[]), None);
    assert_eq!(c("icon.png", p, false, None, false, false, false, false, false, Some(256), Some(256), &[]), None);
    assert_eq!(c("web.jpg", p, false, None, false, false, false, false, false, Some(70), Some(70), &[]), None);
    // ≥512 gercek doku boyutu → Doku.
    assert_eq!(c("t.png", p, false, None, false, false, false, false, false, Some(512), Some(512), &[]), Some(ImageKind::Doku));
    // GUCLU sinyal (cihaz adi) boyuttan BAGIMSIZ kazanir — kucuk IMG_ hala Fotograf (ingest regresyonu).
    assert_eq!(c("IMG_0001.jpg", p, false, None, false, false, false, false, false, Some(80), Some(80), &[]), Some(ImageKind::Fotograf));
}

#[test]
fn size_render_and_fullhd_none() {
    let p = "C:/arsiv/kayit/";
    // QHD+ genis ekran → Render.
    assert_eq!(c("kare.png", p, false, None, false, false, false, false, false, Some(3840), Some(2160), &[]), Some(ImageKind::Render));
    assert_eq!(c("kare.png", p, false, None, false, false, false, false, false, Some(2560), Some(1440), &[]), Some(ImageKind::Render));
    // 1920x1080: modern telefon fotografi → ARTIK render degil; baska sinyal yok → None.
    assert_eq!(c("kare.png", p, false, None, false, false, false, false, false, Some(1920), Some(1080), &[]), None);
}

#[test]
fn folder_hints() {
    // Notr ad, klasor ipucu belirleyici.
    assert_eq!(c("kare01.jpg", "C:/proj/04-Renderlar/kare01.jpg", false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Render));
    assert_eq!(c("kare01.jpg", "C:/proj/06-Dokular/kare01.jpg", false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Doku));
    assert_eq!(c("kare01.jpg", "C:/proj/Fotograflar/kare01.jpg", false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Fotograf));
}

#[test]
fn priority_conflicts() {
    // Cihaz adi (IMG_) doku klasorunu YENER (en yuksek oncelik).
    assert_eq!(c("IMG_0001.jpg", "C:/proj/dokular/IMG_0001.jpg", false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Fotograf));
    // Doku suffix'i render klasorunu yener (suffix, klasorden once).
    assert_eq!(c("wall_norm.jpg", "C:/proj/render/wall_norm.jpg", false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Doku));
    // Render klasoru → ara-sonuc Render; ama kamera EXIF → Fotograf (metadata ezer).
    assert_eq!(c("kare.jpg", "C:/proj/render/kare.jpg", false, None, true, false, false, false, false, None, None, &[]), Some(ImageKind::Fotograf));
}

#[test]
fn sibling_render_workflow() {
    // Ayni stem'de PSD/MAX → render is akisi → Render (notr ad).
    assert_eq!(c("living_room.jpg", "C:/proj/x/living_room.jpg", false, None, false, false, false, false, false, None, None, &["psd"]), Some(ImageKind::Render));
    assert_eq!(c("kare.jpg", "C:/proj/x/kare.jpg", false, None, false, false, false, false, false, None, None, &["max"]), Some(ImageKind::Render));
    // Kardes render ama ad foto ipucu → Fotograf.
    assert_eq!(c("santiye_01.jpg", "C:/proj/x/santiye_01.jpg", false, None, false, false, false, false, false, None, None, &["max"]), Some(ImageKind::Fotograf));
}

#[test]
fn keyword_layers() {
    let p = "C:/arsiv/kayit/";
    // Strong substring.
    assert_eq!(c("vray_test.jpg", p, false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Render));
    // Weak word-boundary.
    assert_eq!(c("final_view.jpg", p, false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Render));
    // "finally" → 'final' word-token DEGIL, baska sinyal yok → None.
    assert_eq!(c("finally.jpg", p, false, None, false, false, false, false, false, None, None, &[]), None);
    // Photo keyword.
    assert_eq!(c("santiye_giris.jpg", p, false, None, false, false, false, false, false, None, None, &[]), Some(ImageKind::Fotograf));
}

#[test]
fn no_signal_is_none_h3_deviation() {
    // Notr ad + notr klasor + hicbir EXIF/boyut sinyali → None (H2 taban-Render YERINE; yazma).
    assert_eq!(c("abc.jpg", "C:/proj/kayit123/abc.jpg", false, None, false, false, false, false, false, None, None, &[]), None);
}
