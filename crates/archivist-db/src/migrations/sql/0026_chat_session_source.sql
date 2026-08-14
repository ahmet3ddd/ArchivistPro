-- 0026_chat_session_source.sql — Sohbet oturumuna ARSIV KAYNAGI etiketi (LAN Faz 5 devami).
--
-- SORUN (kullanici bulgusu, canli test): "Ana arsiv" ile "Bu makine" arasinda gecince AYNI sohbet
-- listesi goruluyordu. Oysa uzak modda retrieval HOST'un indeksinden gelir → cevabin ATIFLARI
-- HOST asset id'leridir. Oturumda kaynak yazili olmadigi icin, uzak modda uretilmis bir sohbet
-- yerel moda gecildikten sonra acilip atifina tiklaninca `get_asset(hostId)` YEREL DB'de BASKA
-- dosyayi getiriyordu — sessizce. Bu, projenin Faz 2'de kapattigi "yanlis dosya" sinifinin ta
-- kendisi (`sourceSwitchReset` selectedId'yi tam bu yuzden temizler); sohbet gecmisi kapidan
-- kacmisti cunku store state DEGIL, DB'de kalici.
--
-- COZUM: oturum HANGI ARSIVLE konusuldugunu tasir → liste kaynaga gore suzulur, atif daima
-- oturumun kendi kaynagina gore cozulur. Yanlis-dosya yapisal olarak imkansiz olur.
--
-- Non-destructive: mevcut chat_sessions tablosuna IKI yeni kolon ekler (ileri-yonluluk; onceki
-- migration'lar 0001-0025 asla duzenlenmez). ALTER ADD COLUMN → var-olan satirlar DEFAULT alir.

-- source: 'local' = bu makinenin arsivi · 'remote' = LAN uzerinden ana arsiv.
--   DB kelepcelemez (chat_messages.role deseni: "cagiran sozlesir") — degerler `AssetSource` ile
--   BIREBIR ayni yazilir (frontend `store/assetSource.ts`).
--   ⚠️ DEFAULT 'local' geriye-donuk dolgu: bu migration'dan ONCEKI tum oturumlar yereldi (uzak
--   sohbet Faz 5 ile geldi ve surumlenmedi). Dolgu KASITLI olarak sessiz degil — 'local' dogru
--   cevaptir, "bilinmiyor" degil.
ALTER TABLE chat_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'local';

-- host_label: uzak oturumun HANGI ana arsivle konustugu ("192.168.1.5:9471"). NULL = yerel oturum.
--   ⚠️ Neden yalniz 'remote' YETMEZ: baska bir host'la eslesilince id UZAYI YINE degisir → eski
--   uzak sohbetin atiflari yeni host'ta baska dosyalara denk gelir. Etiket, "bu sohbet BU ana
--   arsive ait mi" sorusunu cevaplanabilir kilar (uyusmazlikta atif tiklamasi kapatilir).
ALTER TABLE chat_sessions ADD COLUMN host_label TEXT;

-- Aktif liste kaynaga gore suzulup updated_at DESC siralanir → bilesik indeks tam bu sorgu icin.
-- IF NOT EXISTS → migration idempotent kalir.
CREATE INDEX IF NOT EXISTS idx_chat_sessions_source ON chat_sessions(source, updated_at DESC);
