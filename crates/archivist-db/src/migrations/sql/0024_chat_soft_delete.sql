-- 0024_chat_soft_delete.sql — Sohbet oturumlarina cop-kutusu (soft-delete + restore + purge).
-- H2 pariti: assets/roots trash deseninin sohbet oturumlarina birebir porti (TrashModal semantigi).
--
-- Non-destructive: mevcut 0023 chat_sessions tablosuna TEK yeni kolon ekler (ileri-yonluluk;
-- onceki migration'lar 0001-0023 asla duzenlenmez). ALTER ADD COLUMN → var-olan satirlar NULL alir.
--
-- deleted_at: NULL = AKTIF (aktif listede gorunur), dolu = COP'te (yalniz cop gorunumu).
--   ⚠️ BIRIM: **epoch ms** (Rust now_ms — chat_sessions.created_at/updated_at ile AYNI birim).
--   assets/roots trash'inin strftime('%s','now') (SANIYE) deseni BURADA KULLANILMAZ; deger daima
--   Rust katmaninda (delete_chat_session → now_ms) uretilir → tek dogruluk kaynagi, birim tutarli.

ALTER TABLE chat_sessions ADD COLUMN deleted_at INTEGER;

-- Cop listesi / cop sayimi sorgusu (deleted_at IS NOT NULL) + aktif liste filtresi (IS NULL) icin
-- kismi-yararlanabilir indeks. IF NOT EXISTS → migration idempotent kalir.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_deleted ON chat_sessions(deleted_at);
