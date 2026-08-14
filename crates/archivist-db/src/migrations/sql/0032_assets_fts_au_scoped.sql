-- 0032_assets_fts_au_scoped.sql — `assets_fts_au` trigger'i SUTUN-DUYARLI yapilir.
--
-- SORUN (uretimde olculdu, 2026-08-12): 0021'in `assets_fts_au` trigger'i `AFTER UPDATE ON
-- assets` idi — SET listesine BAKMAZ, her satir guncellemesinde ateslenir. FTS5'te bir UPDATE
-- satirin TUM kolonlarini (body + ai dahil) silip yeniden indeksler → `project_id` gibi
-- FTS-disi tek bir alanin guncellenmesi bile o asset'in tum cikartilmis metnini yeniden
-- tokenize ettiriyordu. Gercek vaka: oto proje atamasi (33 bin satir `SET project_id`)
-- ~6 dakika surdu; isin FTS ile HICBIR ilgisi yoktu.
--
-- COZUM: trigger yalniz FTS'in aynaladigi uc kolona baglanir (`AFTER UPDATE OF file_name,
-- title, description`) + WHEN muhafizi degeri GERCEKTEN degisenleri gecirir (re-ingest
-- upsert'i uc kolonu ayni degerle SET eder — o da atesleme sebebi olmamali; COALESCE
-- FTS'in NULL→'' depolama kuralina birebir uyar, NULL↔'' gecisi degisiklik sayilmaz).
-- Kapsam denetimi (tum `UPDATE assets` yollari tarandi): file_name/title/description'a yalniz
-- ingest upsert'i (write.rs) ve refile yazar — ikisi de OF listesinde. project_id / deleted_at /
-- rag_excluded / 0008 proje-durum alanlari / path-rewrite (portable.rs) artik trigger'i ateslemez.
--
-- `body`/`ai` kolonlarini trigger zaten YONETMIYORDU (0021: body=ingest, ai=set_ai_metadata) —
-- bu migration o davranisi degistirmez, yalniz gereksiz ateslemeyi keser.
--
-- Ilke (ileri-yonluluk): 0001/0021 DUZENLENMEZ; trigger yeni migration'da yeniden kurulur.

DROP TRIGGER IF EXISTS assets_fts_au;

CREATE TRIGGER assets_fts_au AFTER UPDATE OF file_name, title, description ON assets
WHEN new.file_name IS NOT old.file_name
  OR COALESCE(new.title, '')       <> COALESCE(old.title, '')
  OR COALESCE(new.description, '') <> COALESCE(old.description, '')
BEGIN
    UPDATE assets_fts
       SET file_name   = new.file_name,
           title       = COALESCE(new.title, ''),
           description = COALESCE(new.description, '')
     WHERE asset_id = old.id;
END;
