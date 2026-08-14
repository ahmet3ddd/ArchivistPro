-- 0011: RAG (Retrieval-Augmented Generation) — metin parcalari (chunk) + chunk vektorleri
--       + chunk FTS (keyword-gate icin). H2 pariti: text_chunks + embeddings + fts_chunks.
--
-- RAG akisi: dokuman metni overlap'li parcalara bolunur (govde) + her asset icin bir
-- METADATA chunk'i (chunk_index = -1: dosya-adi/proje/etiket/DWG katman/geometri ozeti →
-- metni olmayan DWG/MAX gibi asset'ler bile aranabilir). Her parca MiniLM ile embedlenir +
-- FTS'e yazilir. Soruya: hibrit retrieve (FTS-chunk + semantik + metadata) + keyword-gate
-- (birebir terim geceni garanti getir) → (Ollama varsa) kaynak-atifli cevap.
--
-- Parca embedding'i ASSET embedding'i ile AYNI model/uzay (MiniLM cok-dilli, 384) → ayni
-- vec_to_blob/kNN deseni; ayri tablo (parca-seviyesi granularite).

-- Parca metni + kaynak. asset_id FK CASCADE → asset silinince/purge parcalar gider.
-- chunk_index: govde parcalari 0,1,2...; METADATA chunk'i = -1 (govdeden ayrilir).
CREATE TABLE text_chunks (
    id          INTEGER PRIMARY KEY,
    asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    page        INTEGER,            -- sayfa no (bilinmiyorsa NULL)
    text        TEXT    NOT NULL,
    lang        TEXT                -- dil kodu (opsiyonel)
);

CREATE INDEX idx_text_chunks_asset ON text_chunks(asset_id);

-- Parca vektorleri (MiniLM cok-dilli, 384 — asset_vectors ile AYNI boyut/uzay).
-- chunk_id → text_chunks.id (uygulama-seviyesi; vec0 FK destekemez → purge ELLE siler).
CREATE VIRTUAL TABLE chunk_vectors USING vec0(
    chunk_id  INTEGER PRIMARY KEY,
    embedding FLOAT[384]
);

-- Parca FTS (keyword-gate + hibrit retrieve'in FTS dali). assets_fts ile ayni tokenizer.
-- Trigger YOK → set_asset_chunks/purge ELLE yonetir (chunk_vectors deseni; text_chunks
-- CASCADE'i bunu temizlemez).
CREATE VIRTUAL TABLE chunk_fts USING fts5(
    chunk_id UNINDEXED,
    asset_id UNINDEXED,
    text,
    tokenize = 'unicode61 remove_diacritics 2'
);
