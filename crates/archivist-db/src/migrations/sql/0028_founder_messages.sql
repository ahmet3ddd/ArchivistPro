-- 0028_founder_messages.sql — ana admin (founder) + tek yonlu yerel oneriler.
--
-- Ana admin, normal admin rolunun ustune eklenen tekil bir sorumluluktur. Mevcut
-- arsivlerde en eski admin terfi eder; yeni arsivlerde ilk kurulum komutu bu alani
-- dogrudan yazar. Birden fazla ana admin, partial UNIQUE index ile yapisal olarak
-- imkansizdir.
ALTER TABLE users ADD COLUMN is_founder INTEGER NOT NULL DEFAULT 0
    CHECK (is_founder IN (0, 1));

UPDATE users
SET is_founder = 1
WHERE id = (
    SELECT id FROM users
    WHERE role = 'admin'
    ORDER BY id ASC
    LIMIT 1
);

CREATE UNIQUE INDEX idx_users_single_founder
    ON users(is_founder)
    WHERE is_founder = 1;

-- Yerel kullanicilarin ana admin'e tek yonlu onerileri. Gonderen silinirse mesaj
-- korunur; adi gonderim anindan snapshot olarak saklanir. Alici ana admin silinemez
-- (uygulama katmani + founder korumasi), bu nedenle recipient FK'si RESTRICT'tir.
CREATE TABLE user_messages (
    id              INTEGER PRIMARY KEY,
    sender_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sender_username TEXT    NOT NULL,
    recipient_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body            TEXT    NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 2000),
    created_at      INTEGER NOT NULL,
    resolved_at     INTEGER,
    resolved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CHECK (
        (resolved_at IS NULL AND resolved_by IS NULL)
        OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    )
);

CREATE INDEX idx_user_messages_recipient_created
    ON user_messages(recipient_id, created_at DESC);

-- Okuma durumu mesajdan ayridir: gelecekte ana admin devri/audit ihtiyacinda ortak
-- okundu alanina donusmez. Bugun tek alici olsa da bu tablo paylasik-okuma hatasini
-- yapisal olarak engeller.
CREATE TABLE message_reads (
    message_id INTEGER NOT NULL REFERENCES user_messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at    INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)
);
