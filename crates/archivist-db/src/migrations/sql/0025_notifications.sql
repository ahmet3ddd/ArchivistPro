-- 0025: LAN bildirimleri (host-otoriter S1-S2 MVP; docs/design/LAN_MESSAGING_SPIKE.md §4).
-- Host uretir; istemciler `GET /notifications?since=<id>` ile poll eder (salt-okuma, host-otoriter
-- → tek dogruluk kaynagi bildirime de uygulanir; istemci yerel kopya TUTMAZ). append-only.
--
-- Poll imleci = `id` (AUTOINCREMENT, kesin artan) → ms-cakismasi riski YOK (created_at yalniz
-- goruntu/siralama; iki bildirim ayni ms'de olusabilir, id olusamaz). Istemci gordugu en buyuk
-- id'yi saklar, `?since=` ile gonderir; sunucu `WHERE id > since` doner.
CREATE TABLE notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,   -- epoch ms (chat.rs now_ms ile ayni birim; goruntu/siralama)
    kind       TEXT    NOT NULL,   -- 'info' | 'index' | 'project' ... (db yorumlamaz; cagiran sozlesir)
    title      TEXT    NOT NULL,
    body       TEXT                -- opsiyonel govde
);

-- Poll (id > since ORDER BY id) zaten PK ile hizli; created_at indeksi zaman-bazli gorunum/temizlik icin.
CREATE INDEX idx_notifications_created ON notifications(created_at);
