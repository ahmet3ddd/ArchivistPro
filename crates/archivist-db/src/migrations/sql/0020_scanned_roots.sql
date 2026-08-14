-- 0020_scanned_roots.sql — Kaynak-klasor yonetimi (H2 Faz-4 pariti): izlenen/taranan
-- kok klasor KAYDI + gruplar + kok-etiketleri. H3'te izlenen kokler bugune dek localStorage'
-- daydi (watchSettings) → GERCEK entity'ye tasinir (Rust veriyi sahiplenir; .db tasininca
-- kokler birlikte gider).
--
-- H3-NATIVE: TEK migration'da tam sema (H2'nin epoch-ALTER destani TEKRARLANMAZ). Ilke
-- (ileri-yonluluk): onceki migration'lar (0001-0019) asla duzenlenmez.
--
-- IKI AKSIYON (H2 modeli birebir):
--   status='removed' → LISTEDEN CIKAR: kok kaynak/izleme listesinden kalkar ama altindaki
--     asset'ler ARSIVDE KALIR (dokunulmaz); geri-alinabilir (reactivate).
--   is_deleted=1     → KLASOR COPU: kok cope, altindaki asset'ler de soft-delete (birlikte);
--     restore ikisini de dondurur, purge kalici siler.
--
-- file_count SAKLANMAZ → `assets` tablosundan CANLI turetilir (longest-prefix; H2 de stored
-- degere guvenmez). Sorgu API'sinde hesaplanir.

-- Kaynak-klasor gruplari (opsiyonel gruplama; renk + sira). Kok silinmeden grup silinince
-- scanned_roots.group_id NULL olur (ON DELETE SET NULL).
CREATE TABLE root_groups (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6366f1',   -- HEX; UI kelepceler
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL                    -- unix saniye (H3 konvansiyonu)
);

-- Izlenen/taranan kok klasor kaydi.
CREATE TABLE scanned_roots (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,              -- mutlak kok yolu; UNIQUE → idempotent add / reactivate
  label       TEXT NOT NULL,                     -- gorunen ad (varsayilan: klasor adi; duzenlenebilir)
  added_at    INTEGER NOT NULL,                  -- unix saniye
  last_scan   INTEGER,                           -- son tarama zamani (nullable; ingest gunceller)
  status      TEXT NOT NULL DEFAULT 'active',    -- 'active' | 'removed' (soft-remove; asset'ler KALIR)
  is_favorite INTEGER NOT NULL DEFAULT 0,        -- 0/1 (sidebar favori)
  group_id    INTEGER REFERENCES root_groups(id) ON DELETE SET NULL,
  is_deleted  INTEGER NOT NULL DEFAULT 0,        -- 0/1 (klasor copu — asset'ler de soft-delete)
  deleted_at  INTEGER                            -- cope atilma zamani (nullable)
);
CREATE INDEX idx_scanned_roots_path ON scanned_roots(path);
CREATE INDEX idx_scanned_roots_status ON scanned_roots(status);
CREATE INDEX idx_scanned_roots_deleted ON scanned_roots(is_deleted);

-- Kok basina etiket — mevcut `tags` tablosuna baglanir (asset_tags deseni). Kok/etiket
-- silinince baglanti CASCADE ile temizlenir.
CREATE TABLE root_tags (
  root_id INTEGER NOT NULL REFERENCES scanned_roots(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (root_id, tag_id)
);
CREATE INDEX idx_root_tags_tag ON root_tags(tag_id);
