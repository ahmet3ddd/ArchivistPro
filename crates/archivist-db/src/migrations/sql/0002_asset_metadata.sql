-- 0002_asset_metadata.sql — zengin metadata (EAV) + algisal hash.
-- Ilke: 0001 asla duzenlenmez; degisiklik yeni numarali migration ile (ileri-yonlu).

-- ── Zengin metadata: EAV (Extracted.fields kalicilastirma) ───────────────────
-- Her extractor format'a ozgu serbest alanlar uretir (version, author, page_count,
-- layer_count...). EAV tablosu: sorgulanabilir + indekslenebilir (faceting/filtre).
CREATE TABLE asset_metadata (
    asset_id   INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    key        TEXT    NOT NULL,        -- 'version', 'author', 'page_count'...
    value_text TEXT,                    -- Str/Bool degerler
    value_num  REAL,                    -- Int/Float (aralik/siralama sorgusu)
    PRIMARY KEY (asset_id, key)
);
CREATE INDEX idx_meta_key_text ON asset_metadata(key, value_text);
CREATE INDEX idx_meta_key_num  ON asset_metadata(key, value_num);

-- ── Algisal hash (gorseller) — Faz 6 dedup; ingest doldurur ──────────────────
-- u64 pHash bit-deseni i64 olarak saklanir (SQLite INTEGER = i64). NULL = yok.
ALTER TABLE assets ADD COLUMN phash INTEGER;
