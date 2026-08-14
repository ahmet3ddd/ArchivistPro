-- 0006_users.sql — yerel kullanici hesaplari (Faz 6: auth + gercek RBAC).
-- B1 duzeltmesi: rol artik istemci IPC argumani DEGIL; sunucu-tarafi kimlik-dogrulanmis
-- oturumdan gelir. Bu tablo kullanici kimligini + argon2id parola ozetini saklar.
-- Ilke: onceki migration'lar (0001-0005) asla duzenlenmez; degisiklik yeni numarali
-- migration ile gelir (ileri-yonluluk).

-- Kullanici hesabi. Rol DB'de TEXT + CHECK (db katmani src-tauri'ye bagimli degil;
-- Role enum eslemesi komut katmaninda yapilir). Parola asla duz saklanmaz (argon2id).
-- `username` UNIQUE + COLLATE NOCASE → buyuk/kucuk harf duyarsiz benzersizlik.
-- `must_change_password`: admin parola sifirladiginda 1; ilk girişte degistirme zorunlu.
-- `failed_attempts` / `locked_until`: kaba-kuvvet sinirlama (esik sonrasi gecici kilit).
-- Seed YOK — ilk admin uygulama icinde (setup_admin komutu) olusturulur.
CREATE TABLE users (
    id                   INTEGER PRIMARY KEY,
    username             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    role                 TEXT    NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    password_hash        TEXT    NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    failed_attempts      INTEGER NOT NULL DEFAULT 0,
    locked_until         INTEGER NOT NULL DEFAULT 0,
    created_at           INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
