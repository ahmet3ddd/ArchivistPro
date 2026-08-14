//! Cok-dilli CLIP metin kodlayici uctan-uca dogrulamasi (#[ignore] — gercek modeller gerekir).
//!
//! KRITIK: cok-dilli metin kodlayicinin (DistilBERT→pool→Dense) ciktisinin, INGILIZCE CLIP
//! GORUNTU kodlayicisinin uzayina hizali oldugunu — ve **Turkce** sorgularin dogru eslestigini —
//! kanitlar. Kirmizi goruntu "kirmizi" metnine, "mavi"den daha yakin olmali (ve tersi).
//!
//! Calistir (iki model de gerekir):
//!   $env:ARSIV_CLIP_MODEL_DIR="C:\Arsiv-H2\public\models\Xenova\clip-vit-base-patch32"
//!   $env:ARSIV_MCLIP_MODEL_DIR="C:\Arsiv-H3\models\clip-ViT-B-32-multilingual-v1"
//!   cargo test -p archivist-embed --test mclip_real -- --ignored --nocapture

use archivist_embed::{ImageEmbedder, MultilingualTextEmbedder, IMAGE_EMBED_DIM};

fn solid_png(r: u8, g: u8, b: u8) -> Vec<u8> {
    let img = image::RgbImage::from_pixel(224, 224, image::Rgb([r, g, b]));
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut buf, image::ImageOutputFormat::Png)
        .unwrap();
    buf.into_inner()
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[test]
#[ignore = "gercek CLIP + cok-dilli ONNX modelleri gerektirir (ARSIV_CLIP_MODEL_DIR + ARSIV_MCLIP_MODEL_DIR)"]
fn multilingual_text_aligns_with_clip_image_space_turkish() {
    let clip_dir = std::env::var("ARSIV_CLIP_MODEL_DIR").expect("ARSIV_CLIP_MODEL_DIR ayarli olmali");
    let mclip_dir =
        std::env::var("ARSIV_MCLIP_MODEL_DIR").expect("ARSIV_MCLIP_MODEL_DIR ayarli olmali");

    // Goruntuler: INGILIZCE CLIP vision (mevcut gorsel vektorlerle ayni motor).
    let mut clip = ImageEmbedder::from_dir(&clip_dir).expect("CLIP yuklenmeli");
    let red_img = clip.embed_image(&solid_png(220, 20, 20)).unwrap();
    let blue_img = clip.embed_image(&solid_png(20, 20, 220)).unwrap();

    // Metin: COK-DILLI kodlayici, TURKCE sorgular.
    let mut mclip = MultilingualTextEmbedder::from_dir(&mclip_dir).expect("cok-dilli model yuklenmeli");
    let kirmizi = mclip.embed_text("kırmızı renk").unwrap();
    let mavi = mclip.embed_text("mavi renk").unwrap();

    // (1) Boyut + L2-norm.
    for (label, v) in [("red_img", &red_img), ("blue_img", &blue_img), ("kirmizi", &kirmizi), ("mavi", &mavi)] {
        assert_eq!(v.len(), IMAGE_EMBED_DIM, "{label} boyutu 512 olmali");
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "{label} L2-norm ~1 olmali, {norm}");
    }

    // (2) TURKCE capraz-modal: her goruntu KENDI renginin Turkce metnine daha yakin.
    let rk = cosine(&red_img, &kirmizi);
    let rm = cosine(&red_img, &mavi);
    let bm = cosine(&blue_img, &mavi);
    let bk = cosine(&blue_img, &kirmizi);
    println!("TR cosine: kirmizi-goruntu·kirmizi={rk:.3} ·mavi={rm:.3} | mavi-goruntu·mavi={bm:.3} ·kirmizi={bk:.3}");
    assert!(rk > rm, "kirmizi goruntu 'kirmizi'ya 'mavi'den yakin olmali ({rk:.3} > {rm:.3})");
    assert!(bm > bk, "mavi goruntu 'mavi'ye 'kirmizi'dan yakin olmali ({bm:.3} > {bk:.3})");
}
