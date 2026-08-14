-- 0015_asset_shapes.sql — DWG/DXF geometrik sekil indeksi (Dilim 1: DB katmani).
--
-- BAGLAM: DWG-sekil-arama (gorsel-benzerlik + parametrik). Descriptor = SUREKLI skaler
--   ozellikler (hash/vektor DEGIL); metrik = agirlikli fark + Gaussian(vertex), Rust
--   brute-force (H2 `compute_shape_similarity` birebir portu).
--
-- KARAR (H2'den SAPMA — bilincli): H2 sekilleri AYRI `*_shapes.db` dosyasinda tutuyordu.
--   O ayrim yalniz H2'nin sql.js-heap OOM'u yuzundendi (renderer tum DB'yi bellege aliyordu).
--   H3'te renderer DB'yi bellege ALMAZ (tek motor sahipligi; yalniz sayfali sorgu API'si) →
--   ayri-dosya gerekcesi dusuyor. Sekiller ANA `archivist.db`'de → tek dogruluk kaynagi,
--   cross-DB orphan temizligi derdi YOK, asset ile ayni TX/backup/migration cemberinde.
--
-- 1:N: bir DXF dosyasi (asset) icinde COK sekil olur. FK ON DELETE CASCADE → asset
--   hard-delete edilince (reset/purge) sekilleri de otomatik temizlenir (index_skips /
--   asset_thumbnails deseni; foreign_keys=ON connection.rs'te sabit).
--
-- layer_category: yaziminda `categorize_layer` ile TURETILIR (HAVUZ/DUVAR/KAPI/... /DIGER);
--   layer yoksa NULL. Kismi indeks (WHERE is_closed = 1) parametrik kategori-aramasini
--   (kapali sekiller) hizlandirir — H2 `idx_dwg_shapes_layer_cat` pariti.
CREATE TABLE asset_shapes (
    id             INTEGER PRIMARY KEY,
    asset_id       INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    entity_type    TEXT    NOT NULL,          -- LINE|CIRCLE|ARC|LWPOLYLINE|POLYLINE
    layer_name     TEXT,                      -- ham layer adi (opsiyonel)
    layer_category TEXT,                      -- categorize_layer'dan turetilir (layer yoksa NULL)
    vertex_count   INTEGER NOT NULL,
    is_closed      INTEGER NOT NULL,          -- 0/1
    area           REAL,
    perimeter      REAL,
    aspect_ratio   REAL,
    regularity     REAL,
    compactness    REAL,
    solidity       REAL,
    rectangularity REAL,
    bbox_w         REAL,
    bbox_h         REAL,
    centroid_x     REAL,
    centroid_y     REAL
);
CREATE INDEX idx_asset_shapes_asset ON asset_shapes(asset_id);
CREATE INDEX idx_asset_shapes_cat   ON asset_shapes(layer_category) WHERE is_closed = 1;
