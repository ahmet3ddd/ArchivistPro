-- 0009: asset_vectors boyutunu Faz 5 embedding modeline gore SABITLE (768 → 384).
--
-- Faz 1'de boyut (768) bilincli GECICI placeholder'di (0001 yorumu): "embedding
-- modeli Faz 5'te kesinlesince yeni migration ile sabitlenecek." Faz 5'te metin
-- embedding modeli secildi: sentence-transformers `paraphrase-multilingual-MiniLM-
-- L12-v2` (BertModel, multilingual → Turkce dostu), config.json hidden_size = 384.
--
-- GUVENLIK (neden DROP+CREATE guvenli): embedding URETIMI Faz 5'e kadar HIC
-- calismadi → `asset_vectors` her ortamda BOS (uretilmis gercek vektor yok). vec0
-- sanal tablosunun boyutu CREATE'te sabittir (ALTER ile degistirilemez) → tek yol
-- DROP + yeniden olusturmak. Bos tabloda veri kaybi yok. Ileri-yonlu, tek TX
-- (migration runner her migration'i kendi TX'inde uygular → kismi-uygulama yok).
--
-- Gorsel embedding (CLIP, 512-boyut) ileride AYRI tabloyla gelecek (farkli boyut →
-- ayni vec0 tablosunda tutulamaz); bu migration yalniz METIN vektorunu kapsar.

DROP TABLE IF EXISTS asset_vectors;

CREATE VIRTUAL TABLE asset_vectors USING vec0(
    asset_id  INTEGER PRIMARY KEY,
    embedding FLOAT[384]
);
