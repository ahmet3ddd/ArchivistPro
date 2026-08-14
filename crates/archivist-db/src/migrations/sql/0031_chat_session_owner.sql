-- 0031_chat_session_owner.sql — Sohbet oturumuna SAHIP (user_id) → kullanici-basi izolasyon.
--
-- SORUN (2026-07-26, rbac_coverage.rs kurulurken bulundu): `chat_commands.rs` modul yorumu
-- "RBAC gate YOK — sohbet kisisel bir ozellik" diyordu, AMA sema bunu karsilamiyordu: 0023'te
-- chat_sessions'ta sahip alani YOK ve `list_chat_sessions` kullaniciya gore SUZMUYORDU. Yani
-- sohbet fiilen kisisel degil, ARSIV-GENELIYDI → cok-kullanicili bir arsivde her rol (viewer
-- dahil) baskasinin sohbetini gorur, yeniden adlandirir, cope atar ve KALICI silerdi
-- (`chat_purge_session`). Gerekce ile kod celisiyordu; kod duzeltildi.
--
-- H2 KONTROLU (proje kurali: once H2'nin calisan cozumune bak): **H2'de de yok.** H2
-- `database.ts:1042` chat_sessions'ta da user_id yoktur ve `chatStorage.ts` kullaniciya gore
-- suzmez — H2 de cok-kullanicilidir (users + rol + is_founder). Yani bu bir H3 gerilemesi DEGIL,
-- H2'den sadakatle tasinmis bir bosluk. Tasinacak hazir cozum olmadigi icin H3'un KENDI deseni
-- izlendi: 0028 `user_messages` — sahip daima OTURUMDAN gelir, asla IPC parametresi degildir.
--
-- ZAMANLAMA GEREKCESI: migration bugun en ucuz. Arsivde tek kullanici var (founder) → mevcut
-- oturumlarin sahibi tartismasiz. Birkac hesap ve gercek sohbet gecmisi biriktikten sonra
-- "bu oturum kimindi?" sorusunun dogru cevabi kalmaz; geriye donuk atama tahmine donerdi.
--
-- Non-destructive: mevcut tabloya TEK kolon ekler (0024/0026 deseni; tablo yeniden KURULMAZ,
-- onceki migration'lar 0001-0030 asla duzenlenmez). Mesajlara dokunulmaz — sahiplik oturumdadir,
-- mesaj oturumun altindadir (chat_messages.session_id FK CASCADE).

-- user_id: oturumun sahibi. NULL = sahipsiz (yalniz "hic kullanicisi olmayan DB" halinde olusur;
--   uretimde imkansiz — `needs_setup`/`setup_admin` uygulamadan ONCE kosar. Testlerde olusur.)
--   ⚠️ SQLite kurali: FK'li kolon ALTER ile ancak varsayilani NULL ise eklenebilir → NOT NULL
--   yapilamaz. Gercek zorunluluk uygulama katmanindadir (komut sahibi oturumdan alir) ve
--   sorgular `user_id = ?` ile suzdugu icin sahipsiz satir kimseye GORUNMEZ (sizinti yonu guvenli:
--   fazladan gizler, fazladan gostermez).
--   ON DELETE CASCADE (kullanici karari, 2026-07-26): kullanici silinince kisisel sohbetleri de
--   gider. Alternatifi (oksuz birakmak) kimsenin goremedigi ama DB'de duran cop uretirdi.
--   0028 `user_messages`'ta icerik korunmustu cunku orada ALICININ hala ihtiyaci vardi; burada yok.
ALTER TABLE chat_sessions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- Geriye-donuk dolgu: mevcut oturumlar ana admin'e (founder) atanir; founder yoksa en eski
-- kullaniciya. Hicbir kullanici yoksa NULL kalir (taze/test DB — sahiplenecek kimse yok).
-- ⚠️ Dolgu KASITLI olarak "tahmin" degil: bu migration'dan ONCE sohbet arsiv-geneliydi ve
-- arsivin sahibi founder'dir → founder tek savunulabilir cevaptir ("bilinmiyor" degil).
UPDATE chat_sessions
SET user_id = COALESCE(
        (SELECT id FROM users WHERE is_founder = 1 LIMIT 1),
        (SELECT id FROM users ORDER BY id ASC LIMIT 1)
    )
WHERE user_id IS NULL;

-- Aktif liste sahibe gore suzulup updated_at DESC siralanir → bilesik indeks tam bu sorgu icin
-- (0026'nin idx_chat_sessions_source deseni). IF NOT EXISTS → migration idempotent kalir.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);
