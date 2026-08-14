-- 0012: Hassasiyet filtresi (A1) — asset'i RAG'den MANUEL disla. H2 pariti: kullanici bir
--       dosyayi "RAG'den disla" ile isaretler → sohbet retrieve'i (rag_search) o asset'in
--       parcalarini ASLA getirmez. Oto anahtar-kelime tespiti (mali/kisisel/hukuki/IK) ust
--       katmanda DINAMIK uygulanir (sorgu-zamani; bu kolon yalniz kalici MANUEL istisna).
--
-- Varsayilan 0 (dahil) → mevcut davranis korunur. Re-ingest asset upsert'i bu kolona DOKUNMAZ
-- (yeni kolon, upsert SET listesinde yok) → manuel istisna re-index'te KORUNUR.
ALTER TABLE assets ADD COLUMN rag_excluded INTEGER NOT NULL DEFAULT 0;

-- Kismi indeks: yalniz isaretli (az sayida) asset → rag_search'in NOT-disla filtresi hizli.
CREATE INDEX idx_assets_rag_excluded ON assets(rag_excluded) WHERE rag_excluded = 1;
