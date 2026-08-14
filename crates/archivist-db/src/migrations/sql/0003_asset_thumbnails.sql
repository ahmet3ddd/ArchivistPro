-- 0003_asset_thumbnails.sql — kucuk resim (thumbnail) deposu.
-- Ilke: 0001/0002 asla duzenlenmez; degisiklik yeni numarali migration ile.

-- 1:1 ayri tablo (assets yalin kalir; BLOB yalniz talep uzerine cekilir — grid).
-- `bytes`: extractor'in urettigi kodlanmis goruntu (genelde JPEG). ON DELETE CASCADE.
CREATE TABLE asset_thumbnails (
    asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    mime     TEXT    NOT NULL,        -- 'image/jpeg'
    width    INTEGER NOT NULL,
    height   INTEGER NOT NULL,
    bytes    BLOB    NOT NULL
);
