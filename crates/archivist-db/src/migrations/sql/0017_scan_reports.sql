-- 0017: scan_reports — tarama (ingest) raporu gecmisi (P2.5 ④).
--
-- Her ingest KOSUSUNUN kalici ozeti. H2'de "Tarama Raporlari" gecmisi vardi; H3'te
-- rapor yalniz gecici `IngestReport` struct'inda uretiliyordu (modal kapaninca kaybolurdu).
-- Bu tablo her kosunun ozetini denetim-kaydi gibi (best-effort) saklar → "Tarama Raporlari"
-- paneli gecmisi buradan okur.
--
-- type_counts / warnings / errors = JSON metin (uygulama katmani serilestirir/yorumlar):
--   type_counts : [[ext, count], ...]        (uzanti dagilimi; ext kucuk-harf noktasiz, "" = uzantisiz)
--   warnings    : [[path, message], ...]     (olumcul-olmayan; dosya indekslendi ama cikarim/parser uyardi)
--   errors      : [[path, message], ...]     (olumcul; dosya indekslenEMEDI — errors.len() == failed)
--
-- Kayit sayisi uygulama katmaninda son 50 ile sinirlanir (undo pariteli; record her eklemede
-- fazlasini id-sirasina gore budar). mode = "merge" | "replace" | "reset" (kanonik string).
CREATE TABLE scan_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,
    root_path   TEXT    NOT NULL,
    mode        TEXT    NOT NULL,
    added       INTEGER NOT NULL,
    updated     INTEGER NOT NULL,
    skipped     INTEGER NOT NULL,
    failed      INTEGER NOT NULL,
    removed     INTEGER NOT NULL,
    elapsed_ms  INTEGER NOT NULL,
    type_counts TEXT    NOT NULL,
    warnings    TEXT    NOT NULL,
    errors      TEXT    NOT NULL
);

-- Liste daima "en yeni once" (ts DESC) okunur.
CREATE INDEX idx_scan_reports_ts ON scan_reports(ts DESC);
