//! CLIP gorsel+metin embedding uctan-uca dogrulamasi (#[ignore] — gercek ONNX gerektirir).
//!
//! I/O varsayimlarini (cikti `image_embeds`/`text_embeds`, 512-boyut, paylasilan uzay)
//! GERCEK modelle kanitlar: uretilen duz-renk goruntuler ile renk metinleri capraz-modal
//! cosine'da dogru eslesir (kirmizi goruntu ↔ "red" metni). Model-bagimsiz kNN/filtre
//! mantigi ayrica `archivist-db/tests/image_search.rs`'te test edilir.
//!
//! Calistir:
//!   $env:ARSIV_CLIP_MODEL_DIR="C:\Arsiv-H2\public\models\Xenova\clip-vit-base-patch32"
//!   cargo test -p archivist-embed --test clip_real -- --ignored --nocapture

use archivist_embed::{ImageEmbedder, IMAGE_EMBED_DIM, IMAGE_REGION_COUNT};

/// Duz-renk 224×224 PNG bayti uret (CLIP on-isleme load_from_memory ile decode eder).
fn solid_png(r: u8, g: u8, b: u8) -> Vec<u8> {
    let img = image::RgbImage::from_pixel(224, 224, image::Rgb([r, g, b]));
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut buf, image::ImageOutputFormat::Png)
        .unwrap();
    buf.into_inner()
}

/// L2-normalize edilmis iki vektorun cosine benzerligi (= nokta carpim).
fn cosine(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

#[test]
#[ignore = "gercek CLIP ONNX modeli gerektirir (ARSIV_CLIP_MODEL_DIR)"]
fn clip_cross_modal_color_match() {
    let dir = std::env::var("ARSIV_CLIP_MODEL_DIR").expect("ARSIV_CLIP_MODEL_DIR ayarli olmali");
    let mut clip = ImageEmbedder::from_dir(&dir).expect("CLIP modeli yuklenmeli");

    // (1) Boyut + L2-norm sozlesmesi (her iki kol).
    let red_img = clip.embed_image(&solid_png(220, 20, 20)).unwrap();
    let blue_img = clip.embed_image(&solid_png(20, 20, 220)).unwrap();
    let red_txt = clip.embed_text("a photo of the color red").unwrap();
    let blue_txt = clip.embed_text("a photo of the color blue").unwrap();
    for (label, v) in [("red_img", &red_img), ("blue_img", &blue_img), ("red_txt", &red_txt), ("blue_txt", &blue_txt)] {
        assert_eq!(v.len(), IMAGE_EMBED_DIM, "{label} boyutu 512 olmali");
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "{label} L2-norm ~1 olmali, {norm}");
    }

    // (2) Capraz-modal dogruluk: her goruntu KENDI rengi metnine, diger renge gore daha yakin.
    let rr = cosine(&red_img, &red_txt);
    let rb = cosine(&red_img, &blue_txt);
    let bb = cosine(&blue_img, &blue_txt);
    let br = cosine(&blue_img, &red_txt);
    println!("cosine: kirmizi-goruntu·red={rr:.3} ·blue={rb:.3} | mavi-goruntu·blue={bb:.3} ·red={br:.3}");
    assert!(rr > rb, "kirmizi goruntu 'red' metnine 'blue'dan yakin olmali ({rr:.3} > {rb:.3})");
    assert!(bb > br, "mavi goruntu 'blue' metnine 'red'den yakin olmali ({bb:.3} > {br:.3})");

    // (3) Kontrastif: kirmizi goruntu 'red' metnine, mavi goruntuden daha yakin.
    assert!(rr > br, "kirmizi goruntu 'red'e mavi goruntuden yakin olmali ({rr:.3} > {br:.3})");
}

/// Cok-bolge (`embed_image_regions`): 300×200 gorsel → 5 (region, vektor) cifti, region ARTAN
/// sirada (0..4); her vektor 512 + L2-norm ~1. Bolge kirpim + CLIP hattini GERCEK modelle dogrular
/// (model-bagimsiz geometri/kNN mantigi archivist-embed unit + archivist-db image_search'te).
#[test]
#[ignore = "gercek CLIP ONNX modeli gerektirir (ARSIV_CLIP_MODEL_DIR)"]
fn clip_image_regions_five_normalized_vectors() {
    let dir = std::env::var("ARSIV_CLIP_MODEL_DIR").expect("ARSIV_CLIP_MODEL_DIR ayarli olmali");
    let mut clip = ImageEmbedder::from_dir(&dir).expect("CLIP modeli yuklenmeli");

    // 300×200 (kenarlar farkli → merkez/kose/kenar kirpimlari anlamli ayrisir).
    let img = image::RgbImage::from_fn(300, 200, |x, y| image::Rgb([(x % 256) as u8, (y % 256) as u8, 90]));
    let mut buf = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut buf, image::ImageOutputFormat::Png)
        .unwrap();

    let regions = clip.embed_image_regions(&buf.into_inner()).unwrap();
    assert_eq!(regions.len(), IMAGE_REGION_COUNT, "5 bolge (global + 4 kirpim)");
    assert_eq!(
        regions.iter().map(|(r, _)| *r).collect::<Vec<_>>(),
        vec![0, 1, 2, 3, 4],
        "region ARTAN sirada"
    );
    for (r, v) in &regions {
        assert_eq!(v.len(), IMAGE_EMBED_DIM, "region {r} boyutu 512 olmali");
        let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-3, "region {r} L2-norm ~1 olmali, {norm}");
    }
}
