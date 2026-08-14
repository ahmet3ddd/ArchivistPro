-- 0019_projects.sql — GERCEK `projects` entity'si (H2 isim=kimlik hatasinin duzeltmesi).
--
-- H2 DERSI: H2'de `projects` tablosu OLUYDU; "proje" aslinda `assets.project_name`
-- denormalize string'iydi (klasorden tahmin) → iki farkli klasor ayni ustad ise
-- ISTEMEDEN birlesirdi (isim=kimlik hatasi). H3 GERCEK entity + FK yapar: kimlik = `id`,
-- ad yalniz gorunen etiket. Ilke (ileri-yonluluk): onceki migration'lar (0001-0018) asla
-- duzenlenmez; degisiklik yeni numarali migration ile gelir.
--
-- UZLASTIRMA (MVP): per-asset 0008 proje-durum alanlari (client_name/approval_status/...)
-- BAGIMSIZ KALIR (bu migration onlara DOKUNMAZ). `projects` = KATKISAL gruplama + proje-
-- duzeyi metadata. Asset'ler opsiyonel `project_id` (FK) ile baglanir.

CREATE TABLE projects (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  client_name  TEXT,
  phase        TEXT,                     -- Konsept|Avan|Ruhsat|Uygulama (serbest; UI kelepceler)
  status       TEXT,                     -- aktif|arsiv|beklemede (serbest)
  description  TEXT,
  deadline     TEXT,
  created_at   INTEGER NOT NULL,         -- unix saniye (H3 konvansiyonu; assets.created_at gibi)
  updated_at   INTEGER
);
-- Ada gore listeleme/arama indeksi. UNIQUE(name) KOYULMAZ: H2 isim-cakisma tuzagi —
-- ayni ad AYRI kimliktir (birlesme yok); "ayni ada zaten var" UYARISI uygulama-duzeyidir.
CREATE INDEX idx_projects_name ON projects(name);

-- Asset → proje baglantisi (opsiyonel). ON DELETE SET NULL: proje silinince atanmis
-- asset'ler KALIR, yalniz project_id NULL olur (asset asla proje ile birlikte silinmez).
-- foreign_keys=ON gerektirir (connection.rs pragma politikasinda zaten ON).
ALTER TABLE assets ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX idx_assets_project ON assets(project_id);
