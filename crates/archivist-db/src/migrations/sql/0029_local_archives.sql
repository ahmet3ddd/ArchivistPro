-- 0029_local_archives.sql — adlandirilmis eszamanli YEREL arsiv registry'si.
--
-- H3 artik birden cok, birbirinden VERI-IZOLE yerel DB dosyasi tasiyabilir; her arsiv tam
-- bagimsiz bir SQLite dosyasidir (kendi assets/tags/vektor/RAG'i). Bu tablo, ANA arsivde
-- (main) tutulan bir DEFTER'dir: hangi ek arsivler var, adlari/renkleri/dosya yollari.
--
-- ONEMLI: Migration seti TUM arsiv DB'lerine uygulanir → bu tablo her arsivde OLUSUR ama
-- YALNIZ main'de kullanilir (kimlik/yonetim main-only; bkz archive_commands.rs). Ek arsivdeki
-- bos kopya zararsizdir + arsiv dosyasini sema-olarak kendini-tanimlar tutar.
--
-- ANA arsiv IMPLICIT'tir — burada satiri YOKTUR. Yolu sabit `db_path`'tir (AppState),
-- her zaman vardir; UI'da id='main' ile ilk sirada gosterilir.
--
-- Ilke (ileri-yonluluk): onceki migration'lar (0001-0028) asla duzenlenmez. Tek TX (runner sarar).

CREATE TABLE local_archives (
    -- Uygulama katmaninda uretilen kararli kimlik (ust katman; db saf kalir). 'main' REZERVE
    -- (implicit ana arsiv) → registry'ye asla yazilmaz.
    id         TEXT    PRIMARY KEY CHECK (id <> 'main' AND length(trim(id)) > 0),
    name       TEXT    NOT NULL CHECK (length(trim(name)) > 0),
    -- #RRGGBB veya NULL (renk secici; ust katman dogrular).
    color      TEXT,
    -- Arsiv DB dosyasinin <db_dir>'e GORELI yolu (or. 'archives/<id>/archive.db'). Goreli →
    -- arsiv klasoru tasinsa bile (yedek/geri-yukle) yol bozulmaz; ust katman mutlak'a cevirir.
    rel_path   TEXT    NOT NULL CHECK (length(trim(rel_path)) > 0),
    created_at INTEGER NOT NULL,
    -- Non-destructive silme: dosya `.trash`'e tasinir, satir burada deleted_at ile isaretlenir
    -- (geri-yuklenebilir). NULL = aktif.
    deleted_at INTEGER
);

-- Aktif arsivler ada gore benzersiz olmali (kullanici iki ayni-adli arsiv olusturamaz);
-- silinmis (deleted_at dolu) satirlar ad-cakismasini engellemez → ayni ad yeniden kullanilabilir.
CREATE UNIQUE INDEX idx_local_archives_active_name
    ON local_archives(name)
    WHERE deleted_at IS NULL;
