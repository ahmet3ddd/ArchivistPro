-- 0022_image_region_vectors.sql — COK-BOLGE CLIP gorsel embedding (kompozisyon aramasi).
--
-- SORUN: 0010 `asset_image_vectors(asset_id PK, FLOAT[512])` her gorseli TEK global vektorle
--   temsil eder → "cami VE bulut birlikte" gibi KOMPOZISYON sorgularinda zayif (tek vektor tum
--   sahneyi ortalar; gokyuzu ile yapi ayirt edilmez). H2 dersi (`generateImageEmbeddingsMulti`):
--   her gorseli 5 uzamsal BOLGE (global + center + top-left + top-right + bottom-center) olarak
--   ayri ayri CLIP'le → aramada asset basina BOLGE-MAX cosine (gokyuzu bolgesi "bulut"a, yapi
--   bolgesi "cami"ye AYRI eslesir). Bu, asset basina COK satir gerektirir.
--
-- MIMARI: vec0'da KANITLI tek anahtar `INTEGER PRIMARY KEY` (metadata-kolon destegine GUVENILMEZ)
--   → PK-KODLAMASI: id = asset_id*8 + region (region 0..4, STRIDE=8). Okurken asset_id = id/8,
--   region = id%8. Boylece tek INTEGER PK ile asset basina 5 satir ayrilir.
--
-- NON-DESTRUCTIVE TASIMA: mevcut her tek-vektor satiri region 0'a (global) tasinir → yukseltme
--   sonrasi gorsel arama HEMEN calisir (yalniz global bolge; eski davranis). Yeniden-embed 1-4
--   bolgelerini ekler (kompozisyon kazanci). Tek TX (runner sarar) → kismi-tasima imkansiz.
--
-- Ilke (ileri-yonluluk): onceki migration'lar (0001-0021) asla duzenlenmez.

-- 1) Cok-satirli region tablosu (PK-kodlamali id). Boyut 512 = 0010 ile ayni (CLIP ViT-B/32).
CREATE VIRTUAL TABLE asset_image_region_vectors USING vec0(
    id        INTEGER PRIMARY KEY,
    embedding FLOAT[512]
);

-- 2) Non-destructive tasima: her eski (asset_id, embedding) → region 0 (id = asset_id*8 + 0).
INSERT INTO asset_image_region_vectors(id, embedding)
SELECT asset_id * 8 + 0, embedding FROM asset_image_vectors;

-- 3) Eski tek-vektor tablosunu dusur (veri region 0'a tasindi; artik region tablosu tek kaynak).
DROP TABLE asset_image_vectors;
