-- 0021_assets_fts_ai.sql — Ana-kutu FTS'ine `ai` kolonu (AI vision-betim KOPRUSU).
--
-- SORUN (tespit): AI vision-analizi bir gorselin thumbnail'ini Ollama'ya yollayip METIN
-- betimlemeye cevirir ("cami, bulutlu gokyuzu, kubbe, minare") → `set_ai_metadata` bunu
-- `ai_*` EAV metadata + (ust katman) RAG chunk olarak yazar. AMA ana arama kutusu yolu
-- (`list_assets` → `assets_fts MATCH`) yalniz `assets_fts` tarar; `assets_fts.body` ingest'te
-- extracted.text'ten kurulur (bir gorselde ~= BOS) ve `set_ai_metadata` onu GUNCELLEMEZ →
-- analiz edilen gorselin AI betimi ana FTS'te GORUNMEZ (kullanici "cami bulut" yazinca cikmaz).
--
-- COZUM: `assets_fts`'e ayri bir `ai` kolonu. FTS5 `ALTER TABLE ADD COLUMN` DESTEKLEMEZ →
-- tabloyu YENIDEN KUR (yeni kolonlu) + veriyi tasi + trigger'lari yeni kolonla kur + mevcut
-- analizli asset'leri backfill et. Ana kutu (assets_fts MATCH, kolon-filtresiz) TUM kolonlari
-- (body + ai) tarar → analizli gorsel ana aramada gorunur; okuma+yazma AYNI anda ai-aware
-- (H2 dersi: yazma epoch-aware ama okuma degil → kismi bozulma; burada tek tablo/tek MATCH).
--
-- Ilke (ileri-yonluluk): onceki migration'lar (0001-0020) asla duzenlenmez. Tek TX (runner sarar).

-- 1) Eski 3 trigger'i dusur (yeni kolonla yeniden kurulacak).
DROP TRIGGER IF EXISTS assets_fts_ai;
DROP TRIGGER IF EXISTS assets_fts_ad;
DROP TRIGGER IF EXISTS assets_fts_au;

-- 2) `ai` kolonlu yeni FTS tablosu (0001 ile ayni tokenizer). `ai` = AI vision-betim metni.
CREATE VIRTUAL TABLE assets_fts_new USING fts5(
    asset_id UNINDEXED,
    file_name,
    title,
    description,
    body,
    ai,
    tokenize = 'unicode61 remove_diacritics 2'
);

-- 3) Mevcut veriyi tasi (body korunur; ai='' — analizli asset'ler adim 6'da backfill).
INSERT INTO assets_fts_new(asset_id, file_name, title, description, body, ai)
SELECT asset_id, file_name, title, description, body, '' FROM assets_fts;

-- 4) Eski tabloyu dusur + yenisini yerine koy (FTS5 rename shadow tablolari da tasir).
DROP TABLE assets_fts;
ALTER TABLE assets_fts_new RENAME TO assets_fts;

-- 5) 3 trigger'i YENI kolonla yeniden kur. body/ai yeni asset'te bos (analizsiz/cikarimsiz);
--    body'yi write.rs (ingest), ai'yi set_ai_metadata (vision) yonetir → UPDATE trigger'i
--    ikisine de DOKUNMAZ (yalniz name/title/description senkron).
CREATE TRIGGER assets_fts_ai AFTER INSERT ON assets BEGIN
    INSERT INTO assets_fts(asset_id, file_name, title, description, body, ai)
    VALUES (new.id, new.file_name, COALESCE(new.title, ''), COALESCE(new.description, ''), '', '');
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

-- 6) MEVCUT analizli asset'leri backfill: `ai_*` metadata (ai_analyzed HARIC) value_text
--    degerlerini bosluk-birlestir → `ai` kolonu. Boylece 0021 ONCESI analiz edilmis gorseller
--    de yukseltme sonrasi ana aramada bulunur (set_ai_metadata bundan boyle canli tutar).
UPDATE assets_fts SET ai = COALESCE(
    (SELECT group_concat(m.value_text, ' ') FROM asset_metadata m
      WHERE m.asset_id = assets_fts.asset_id
        AND m.key LIKE 'ai\_%' ESCAPE '\'
        AND m.key <> 'ai_analyzed'
        AND m.value_text IS NOT NULL), '')
WHERE asset_id IN (SELECT asset_id FROM asset_metadata WHERE key = 'ai_analyzed');
