-- 0013: Genel eylem audit'i (#8 / H2 pariti §A) — KIM / NE / NE ZAMAN / NEYE.
--       RBAC tamamlayicisi: yazma + yikici eylemler kaydedilir (kim hangi asset'i sildi,
--       kim kullanici ekledi, kim arsivi sifirladi...). `schema_migrations` SEMA audit'idir;
--       bu KULLANICI eylem audit'i — ayri amac, ayri tablo.
--
-- Tasarim:
--  - Append-only iz: UPDATE/DELETE beklenmez (gecmis degismez). v1'de tamper-evidence
--    (fixity hash-chain) YOK — H2 "fixity chain" notu ileri-gelistirme; cekirdek kim/ne/ne-zaman.
--  - Aktor alanlari (username/role) eylem anindaki SNAPSHOT'tur (kullanici sonradan silinse /
--    rolu degisse bile iz dogru kalir) → `users`'a FK YOK (iz korunur; kullanici purge'unde de durur).
--  - target_* serbest metin (heterojen hedef: asset id / kullanici adi / klasor yolu).
CREATE TABLE audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,   -- eylem zamani (unix saniye)
    user_id     INTEGER NOT NULL,   -- aktor kullanici id (0 = sistem/oturumsuz)
    username    TEXT    NOT NULL,   -- aktor adi (snapshot)
    role        TEXT    NOT NULL,   -- aktor rolu (snapshot: admin/editor/viewer)
    action      TEXT    NOT NULL,   -- ne yapildi (or. ingest, trash, restore, purge, reset, user_create)
    target_type TEXT,               -- hedef turu (or. asset, user, collection, folder) — opsiyonel
    target_id   TEXT,               -- hedef kimligi (serbest: asset id / kullanici adi / yol) — opsiyonel
    detail      TEXT                -- ek baglam (or. "12 dosya", "viewer->editor") — opsiyonel
);

-- En yeni-once listeleme (log viewer) → ts azalan (esitlikte id azalan) indeks.
CREATE INDEX idx_audit_ts ON audit_log(ts DESC, id DESC);
-- Aktore / eyleme gore filtre (ileride log viewer filtreleri).
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_action ON audit_log(action);
