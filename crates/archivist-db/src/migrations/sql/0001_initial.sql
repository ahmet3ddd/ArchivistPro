-- 0001_initial.sql — Arsiv-H3 ilk sema.
-- Ilke: migration 1. gunden (versiyonlu/ileri-yonlu/test'li). Bu dosya asla
-- duzenlenmez; degisiklik yeni numarali migration ile gelir (ileri-yonluluk).

-- ── Cekirdek varliklar ───────────────────────────────────────────────────────
CREATE TABLE assets (
    id           INTEGER PRIMARY KEY,
    path         TEXT    NOT NULL UNIQUE,        -- mutlak yol (tek dogruluk anahtari)
    file_name    TEXT    NOT NULL,
    ext          TEXT,                           -- normalize uzanti (kucuk harf)
    size_bytes   INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT,                           -- ingest-ani fixity + dedup (BLAKE3)
    mime         TEXT,
    title        TEXT,
    description  TEXT,
    created_at   INTEGER NOT NULL,               -- unix epoch (saniye)
    modified_at  INTEGER NOT NULL,
    indexed_at   INTEGER                         -- son indeksleme ani (NULL = bekliyor)
);
CREATE INDEX idx_assets_content_hash ON assets(content_hash);
CREATE INDEX idx_assets_ext          ON assets(ext);
CREATE INDEX idx_assets_modified_at  ON assets(modified_at);

CREATE TABLE tags (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'user'            -- user | auto | system
);

CREATE TABLE asset_tags (
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
    PRIMARY KEY (asset_id, tag_id)
);
CREATE INDEX idx_asset_tags_tag ON asset_tags(tag_id);

CREATE TABLE relations (
    id     INTEGER PRIMARY KEY,
    src_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    dst_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    kind   TEXT    NOT NULL,                      -- duplicate | version | xref | derived | backup
    UNIQUE (src_id, dst_id, kind)
);
CREATE INDEX idx_relations_dst ON relations(dst_id);

-- ── Anahtar-kelime arama: FTS5 (1. gunden) ───────────────────────────────────
-- Contentless-disi, bagimsiz FTS5 tablosu; assets ile triggerlarla senkron.
-- `body` = extractor'larin (Faz 2) dolduracagi tam metin; simdilik bos.
CREATE VIRTUAL TABLE assets_fts USING fts5(
    asset_id UNINDEXED,
    file_name,
    title,
    description,
    body,
    tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER assets_fts_ai AFTER INSERT ON assets BEGIN
    INSERT INTO assets_fts(asset_id, file_name, title, description, body)
    VALUES (new.id, new.file_name, COALESCE(new.title, ''), COALESCE(new.description, ''), '');
END;

CREATE TRIGGER assets_fts_ad AFTER DELETE ON assets BEGIN
    DELETE FROM assets_fts WHERE asset_id = old.id;
END;

CREATE TRIGGER assets_fts_au AFTER UPDATE ON assets BEGIN
    UPDATE assets_fts
       SET file_name   = new.file_name,
           title       = COALESCE(new.title, ''),
           description = COALESCE(new.description, '')
     WHERE asset_id = old.id;
END;

-- ── Vektor arama: sqlite-vec (DB-ici, transactional) ─────────────────────────
-- Karar (RATIONALE §2.3/§5.5): vektorler ayni DB icinde → asset ile ayni TX'te
-- yazilir, yetim chunk dogmaz. Boyut (768) GECICI placeholder — embedding modeli
-- Faz 5'te kesinlesince yeni migration ile sabitlenecek.
CREATE VIRTUAL TABLE asset_vectors USING vec0(
    asset_id  INTEGER PRIMARY KEY,
    embedding FLOAT[768]
);

-- ── Uygulama meta ────────────────────────────────────────────────────────────
CREATE TABLE app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO app_meta(key, value) VALUES ('schema_origin', 'h3');
