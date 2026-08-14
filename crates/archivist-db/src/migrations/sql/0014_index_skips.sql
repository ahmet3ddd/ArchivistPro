-- 0014_index_skips.sql — Oto-indeks kalici kuyrugu icin skip/basarisizlik izleri (P1).
--
-- BAGLAM: Tarama sonrasi AI indekslemeyi (metin/gorsel embedding · RAG chunk · vision) OTOMATIK
--   suren, app-restart'a dayanikli kuyruk. "Kalan is" zaten URUN tablolarindan turer
--   (NOT EXISTS asset_vectors / text_chunks / asset_image_vectors / ai_analyzed) → TEK dogruluk
--   kaynagi (H3 tezi: native SQLite tek kaynak; H2'nin cift-durum kaymasi TEKRARLANMAZ). Bu yuzden
--   per-asset bir "is" tablosu YOK (redundant + kayma riski olurdu).
--
-- BU TABLONUN VARLIK SEBEBI: Verinin ifade EDEMEDIGI tek durum = "bu adim denendi ve KALICI
--   basarisiz". NOT EXISTS altinda bu, "hic denenmedi"den ayirt edilemez → oto-surucu ayni
--   indekslenemez dosyayi sonsuza dek yeniden denerdi (bekleyen-sayisi hic 0'a inmez, banner
--   takili kalir). H2 tam bu duvara carpip `rag_status='skipped'` ekledi; burada ayni fikir
--   per-STAGE genellestirilir.
--
-- AYRIK KUMELER (kayma yok): bir (asset,stage) icin → BASARILI = urun tablosunda satir ·
--   ATLANDI = burada satir · BEKLEYEN = ikisi de degil. Bekleyen sorgulari her ikisini de dislar.
--   Kullanici "yeniden dene" → ilgili satir(lar) silinir (clear_index_skips) → asset yeniden bekleyen.
--
-- FK ON DELETE CASCADE: asset hard-delete edilince (reset/purge) skip izi de otomatik temizlenir
--   (asset_thumbnails deseni; foreign_keys=ON connection.rs'te sabit).
CREATE TABLE index_skips (
    asset_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    stage      TEXT    NOT NULL,   -- adim: 'text' | 'image' | 'chunk' | 'vision' (IndexStage)
    reason     TEXT,               -- kisa neden (or. "thumbnail decode", "ollama 400") — opsiyonel
    created_at INTEGER NOT NULL,   -- ilk/son isaretlenme (unix saniye)
    PRIMARY KEY (asset_id, stage)  -- asset basina her adimda en fazla 1 skip; (asset_id,stage) lookup indeksi
);

-- Stage-bazli sayim/temizleme (index_skip_count / clear_index_skips) icin.
CREATE INDEX idx_index_skips_stage ON index_skips(stage);
