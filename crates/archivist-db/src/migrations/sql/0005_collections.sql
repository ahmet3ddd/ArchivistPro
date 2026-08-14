-- 0005_collections.sql — kullanici kurasyonu: koleksiyonlar (adli asset gruplari).
-- H2 pariti: collections + collection_items. Ilke: onceki migration'lar (0001-0004)
-- asla duzenlenmez; degisiklik yeni numarali migration ile gelir (ileri-yonluluk).

-- Koleksiyon: kullanicinin olusturdugu adli grup. Ad UNIQUE (find-or-create deseni).
-- `color` parite-hazir (tags.color gibi; secici UI sonraki artim) — NULL = varsayilan.
CREATE TABLE collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL UNIQUE,
    color      TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

-- Uyelik (M:N) — bir asset bir koleksiyonda. Asset veya koleksiyon silinince CASCADE.
CREATE TABLE collection_items (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    asset_id      INTEGER NOT NULL REFERENCES assets(id)      ON DELETE CASCADE,
    added_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    PRIMARY KEY (collection_id, asset_id)
);
-- asset → koleksiyonlari sorgusu (detay paneli) icin ters indeks.
CREATE INDEX idx_collection_items_asset ON collection_items(asset_id);
