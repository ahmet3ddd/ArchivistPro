-- 0023_chat_sessions.sql — Kalici cok-oturumlu sohbet (H2 chat_sessions + chat_messages porti).
-- H3'te sohbet bugune dek TAMAMEN bellekteydi (ChatView useState<Turn[]>) → kapaninca kaybolurdu.
-- H2'nin RAG Q&A oturum/mesaj yapisi (database.ts 1042-1064) native SQLite'a tasinir; Rust veriyi
-- sahiplenir → .db tasininca sohbet gecmisi birlikte gider.
--
-- H3-NATIVE: TEK migration'da tam sema (H2'nin epoch-ALTER destani TEKRARLANMAZ). Ileri-yonluluk:
-- onceki migration'lar (0001-0022) asla duzenlenmez. Non-destructive (yalniz yeni tablo ekler).
--
-- ZAMAN DAMGASI: created_at/updated_at = **epoch ms** (INTEGER; Rust now_ms). H2 ISO metin yerine
-- sayisal — chrono bagimliligi yok, `ai_analyzed_at` (epoch ms) ile tutarli. SQL DEFAULT yok →
-- degeri daima Rust katmani saglar (tek dogruluk kaynagi; sema saati sizmaz).
--
-- FK CASCADE: chat_messages.session_id → chat_sessions(id) ON DELETE CASCADE. `connection.rs`
-- PRAGMA foreign_keys=ON (her baglantida) → session silinince mesajlari OTOMATIK gider
-- (delete_chat_session tek DELETE; elle cascade GEREKMEZ). Yetim mesaj yapisal olarak imkansiz.

-- Sohbet oturumu (baslik + kapsam + model). scope_json/model opsiyonel (NULL serbest).
CREATE TABLE chat_sessions (
  id         TEXT PRIMARY KEY,   -- cs_<epochms>_<atomik-sayac> (Rust; process-ici benzersiz)
  title      TEXT NOT NULL,
  scope_json TEXT,               -- opak JSON (or. {"type":"project","value":"X"}); NULL = belirsiz
  model      TEXT,               -- kullanilan Ollama modeli (nullable)
  created_at INTEGER NOT NULL,   -- epoch ms (Rust now_ms)
  updated_at INTEGER NOT NULL    -- epoch ms; append/rename ile tazelenir
);
-- Son-guncellenen ilk (sohbet listesi DESC) — listeleme ana sorgusu.
CREATE INDEX idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

-- Oturum mesaji (rol + icerik + atif/token). Oturum silinince CASCADE ile gider.
CREATE TABLE chat_messages (
  id             TEXT PRIMARY KEY,   -- cm_<epochms>_<atomik-sayac>
  session_id     TEXT NOT NULL,
  role           TEXT NOT NULL,      -- 'user' | 'assistant' | 'system' (db kelepcelemez; cagiran sozlesir)
  content        TEXT NOT NULL,
  citations_json TEXT,               -- opak JSON (RAG atif referanslari); NULL serbest
  tokens_in      INTEGER,            -- nullable (uretim istatistigi)
  tokens_out     INTEGER,            -- nullable
  created_at     INTEGER NOT NULL,   -- epoch ms (Rust now_ms)
  FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
);
CREATE INDEX idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX idx_chat_messages_created ON chat_messages(created_at);
