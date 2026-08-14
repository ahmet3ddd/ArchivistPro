-- 0008_project_status.sql — Proje-durum alanlari (H2 pariti).
-- Kullanici-tanimli; ingest DOKUNMAZ (re-ingest korur). approval_status: draft|review|approved|rejected (NULL=ayarlanmamis).
ALTER TABLE assets ADD COLUMN client_name      TEXT;
ALTER TABLE assets ADD COLUMN approval_status  TEXT;
ALTER TABLE assets ADD COLUMN rejection_reason TEXT;
ALTER TABLE assets ADD COLUMN version_label    TEXT;
ALTER TABLE assets ADD COLUMN deadline         TEXT;
CREATE INDEX idx_assets_approval_status ON assets(approval_status);
