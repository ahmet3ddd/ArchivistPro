-- 0007_soft_delete.sql — §O cop kutusu (soft-delete) icin `deleted_at` sutunu.
-- Ilke: onceki migration'lar (0001-0006) asla duzenlenmez; degisiklik yeni numarali
-- migration ile gelir (ileri-yonluluk).
--
-- Tasarim (geri-alinabilir silme): bir asset'i fiziksel silmek yerine `deleted_at`
-- damgasi konur. NULL = aktif (tum gorunumlerde gozukur); unix-saniye = cop kutusunda
-- (TUM aktif sorgu/sayimlardan dislanir, yalniz cop gorunumunde gozukur). Geri-yukleme
-- = `deleted_at = NULL`; kalici silme (purge) = gercek `DELETE FROM assets` (FK CASCADE
-- + FTS trigger iliskili satirlari temizler; asset_vectors purge TX'inde elle temizlenir).
--
-- KRITIK DOGRULUK: bu sutun eklendikten sonra aktif-asset listeleyen/sayan HER sorgu
-- `deleted_at IS NULL` filtresini icermeli; aksi halde cop'e atilmis bir asset bir
-- gorunumde sizar. Kapsam query.rs/dashboard.rs/lib.rs::asset_count icinde uygulanir.

-- Nullable + varsayilan NULL → mevcut tum satirlar otomatik AKTIF (geriye-uyumlu).
ALTER TABLE assets ADD COLUMN deleted_at INTEGER;

-- Cop gorunumu (deleted_at DESC) + aktif-filtre kismi indeks: aktif sorgular
-- `deleted_at IS NULL` ile cogu satiri eler, cop sorgusu damgaya gore siralar.
CREATE INDEX idx_assets_deleted_at ON assets(deleted_at);
