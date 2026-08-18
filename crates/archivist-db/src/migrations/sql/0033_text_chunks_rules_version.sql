-- 0033_text_chunks_rules_version.sql — Parcanin HANGI KURALLA uretildigini kaydet.
--
-- SORUN (2026-08-18): parcalama kelime sayisiyla (500), kirpma token sayisiyla (256)
-- yapiliyordu. Gercek arsiv metniyle olculdu: Turkce cikarilmis metinde oran
-- 3,29 token/kelime (max 13,3) → 500 kelimelik parcanin ancak **%25,8**'i vektore
-- giriyordu; gerisi hicbir embedding'e girmiyordu. Duzeltme parcalamayi TOKEN
-- butcesine gecirdi (`chunk_by_tokens`, 220 token).
--
-- AMA duzeltme YALNIZ YENI uretilen parcalari etkiler. Mevcut arsivlerdeki parcalar
-- eski kuralla uretilmistir ve kendiliginden yenilenmez. Bundan da kotusu: Pano
-- "Tum asset'ler indekslendi" diyordu → kullanici duzeltmenin kendisine ULASMADIGINI
-- goremezdi. (Bu, projenin daha once iki kez bedelini odedigi sinif: sessiz "basarili"
-- durumu — bkz 2026-08-16 "analiz edilmemis" sayimi ve sessiz AI taramasi.)
--
-- COZUM: her parca hangi kural surumuyle uretildigini TASIR. Bekleyen-is sorgusu
-- (`assets_without_chunks` / `pending_chunk_count`) bayat kuralli parcalari da
-- "bekliyor" sayar → mevcut indeksleme akisi (oto-indeks ya da "Indeksle" dugmesi)
-- onlari kendiliginden yeniden uretir. Ayrica elle tetikleme icin `reset_rag_chunks`.
--
-- Non-destructive: mevcut tabloya TEK kolon ekler (0031 deseni; tablo yeniden KURULMAZ).
-- Parca/vektor SILINMEZ — bayat parcalar yenisi yazilana dek aranabilir kalir
-- (`set_asset_chunks` asset basina atomik degistirir). Yani gerileme yok, sadece
-- kademeli iyilesme.

-- rules_version: parcayi ureten parcalama kuralinin surumu.
--   1 = eski, KELIME-bazli (500 kelime / 50 ortusme) — bu migration'dan onceki her parca.
--       DEFAULT 1 tam da bunu saglar: geriye donuk dolgu sorgusu GEREKMEZ.
--   2 = TOKEN-bazli (220 token / 40 ortusme) — `archivist_embed::CHUNK_TOKENS`.
--   Kod tarafi: `archivist_db::CHUNK_RULES_VERSION` (tek dogruluk kaynagi; artarak ilerler).
--   ⚠️ Baska bir arsivden BIRLESTIRILEN (merge) parcalar da 1 alir — dogru davranis:
--   kaynak arsivin hangi kuralla parcalandigi bilinmez, guvenli varsayim "bayat"tir.
ALTER TABLE text_chunks ADD COLUMN rules_version INTEGER NOT NULL DEFAULT 1;

-- Bekleyen-is sorgusu her asset icin "guncel kurallı parcasi var mi?" diye bakar
-- (NOT EXISTS ... WHERE asset_id = ? AND rules_version >= ?). Kapsayan indeks bunu
-- tam karsilar. IF NOT EXISTS → migration idempotent kalir.
CREATE INDEX IF NOT EXISTS idx_text_chunks_asset_rules
    ON text_chunks(asset_id, rules_version);
