-- 0010: GORSEL (CLIP) embedding icin AYRI vektor tablosu — 512-boyut.
--
-- Metin embedding (MiniLM, 384-dim, `asset_vectors`) ile gorsel embedding (CLIP
-- ViT-B/32, 512-dim) FARKLI uzaylar + FARKLI boyut → ayni vec0 tablosunda tutulamaz
-- (vec0 boyutu CREATE'te sabit). 0009 zaten bunu ongormustu: "Gorsel embedding (CLIP,
-- 512-boyut) ileride AYRI tabloyla gelecek."
--
-- Boyut 512: `openai/clip-vit-base-patch32` config.json `projection_dim=512` (metin ve
-- gorsel kodlayici AYNI 512-boyut paylasilan uzaya projekte eder → cosine kIyaslanabilir).
--
-- Iliski: `asset_id` → assets.id (uygulama-seviyesi; vec0 FK destekemez). Asset silinin
-- ce purge yolu bu satiri da temizler (trash::purge — kod tarafi). FILTER_FRAG ile cop/
-- facet dislama arama-zamani uygulanir (semantik metin desenIyle ayni).

CREATE VIRTUAL TABLE asset_image_vectors USING vec0(
    asset_id  INTEGER PRIMARY KEY,
    embedding FLOAT[512]
);
