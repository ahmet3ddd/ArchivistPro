-- 0030_approval_log.sql — onay durumu GECIS gecmisi (H2 `approval_log` pariti).
--
-- H2, bir asset'in onay durumu (draft→review→approved→rejected) her degistiginde bir satir
-- yaziyordu. H3 bugune dek toplu proje-durum yazimini yalniz GENEL audit'e kaydediyor; tekil
-- yazim ve asset-bazli GECIS gecmisi yoktu. Bu tablo o bosluğu kapatir: her onay durumu
-- degisikligi (eski→yeni) burada, kim/ne zaman/sebep ile birlikte saklanir.
--
-- Kayit KOMUT katmanindadir (set_project_meta / bulk_set_project_meta): eski durum yazmadan
-- once okunur, degistiyse (from <> to) bir satir eklenir — mevcut audit deseni (record_on)
-- ile ayni (yazma sonrasi, ayni db kilidi altinda). from/to NULL olabilir = "durum yok".
--
-- Ilke (ileri-yonluluk): onceki migration'lar (0001-0029) asla duzenlenmez. Tek TX (runner sarar).

CREATE TABLE approval_log (
    id          INTEGER PRIMARY KEY,
    -- Asset silinince (purge) gecmisi de gider (CASCADE) — yetim kayit kalmaz.
    asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    -- Onceki/yeni durum: draft|review|approved|rejected ya da NULL (durum atanmamis).
    from_status TEXT,
    to_status   TEXT,
    -- Reddedilme sebebi (yalniz 'rejected' gecislerinde anlamli; digerinde NULL).
    reason      TEXT,
    -- Degisikligi yapan kullanici adi (oturumdan snapshot; hesap silinse de metin korunur).
    changed_by  TEXT    NOT NULL,
    changed_at  INTEGER NOT NULL
);

-- Asset-bazli gecmis (detay paneli): tek asset'in gecisleri, en yeni once.
CREATE INDEX idx_approval_log_asset ON approval_log(asset_id, changed_at DESC);
-- Global son etkinlik (gelecekte pano akisi): zaman sirasi.
CREATE INDEX idx_approval_log_time ON approval_log(changed_at DESC);
