-- 0004_tags_favorites.sql — kullanici kurasyonu: etiket rengi + favoriler.
-- Ilke: onceki migration'lar (0001-0003) asla duzenlenmez; degisiklik yeni numarali
-- migration ile gelir (ileri-yonluluk).

-- Etiket rengi (H2 pariti: etiketlerin rengi olabilir). NULL = varsayilan cip.
ALTER TABLE tags ADD COLUMN color TEXT;

-- Favoriler — hizli erisim isareti (1:1 asset). Asset silinince CASCADE.
CREATE TABLE favorites (
    asset_id   INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);
