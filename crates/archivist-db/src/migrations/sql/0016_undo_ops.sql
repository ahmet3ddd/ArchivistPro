-- 0016: undo_ops — geri-al gecmisi (P2.5 stabilite katmani).
--
-- Dosya-tasiyan (refile/rename/organize-tasi) ve metadata-yazan (toplu proje-durumu)
-- islemlerin geri-alinabilir KAYDI. Islem basarili bittiginde bir satir yazilir;
-- "Geri Al" bu kaydin payload'undaki ogeleri tersine uygular.
--
-- payload = kind'a ozgu JSON (uygulama katmani kurar/yorumlar):
--   refile_move / rename / organize_move : {"items":[{"id":N,"from":"...","to":"..."}]}
--   project_meta_bulk                    : {"fields":[...],"items":[{"id":N,<eski degerler>}]}
--
-- undone_at NULL = geri alinabilir; dolu = geri alindi (liste geri-alinmis olarak gosterir).
-- Kayit sayisi uygulama katmaninda son 50 ile sinirlanir (H2 undo-derinligi pariteli;
-- record_undo_op her eklemede fazlasini budar). Asset FK YOK — payload gecmis yollari
-- tasir, asset silinse de kayit anlamli kalir (geri-al o ogeyi zarifce atlar).
CREATE TABLE undo_ops (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    kind       TEXT    NOT NULL,
    label      TEXT    NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,
    payload    TEXT    NOT NULL,
    undone_at  INTEGER
);

-- Liste daima "en yeni once" okunur.
CREATE INDEX idx_undo_ops_created ON undo_ops(created_at DESC);
