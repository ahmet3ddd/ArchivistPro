// Yedekleme paneli (§O DB snapshot + restore) — overlay/modal (TrashPanel scrim+kart deseni).
//
// Yonetilen yedekler listesi (tarih + boyut + otomatik rozeti) + "Yedek Al" + "Ice Aktar"
// (harici .db) + satir basina "Geri Yukle" (UZERINE YAZAR → onayli) / "Disa Aktar" (harici
// konuma kopyala) / "Sil" (onayli). Hepsi ADMIN (backend de zorlar). Geri yukleme sonrasi
// bumpData() ile tum gorunum tazelenir. Portal: TopBar backdrop-blur containing-block tuzagi.

import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { SnapshotDto } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

interface Props {
  onClose: () => void;
}

/** Bayt → insan-okur (KB/MB/GB). */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function BackupPanel({ onClose }: Props) {
  const { t, i18n } = useTranslation();
  const dialogRef = useModalDialog<HTMLDivElement>(onClose);
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const { data, loading, error, refetch } = useIpcQuery<SnapshotDto[]>(() => ipc.listSnapshots(), []);
  const [actionError, setActionError] = useState<string | null>(null);
  // Su an islem altindaki anahtar (satir adi ya da "create"/"import") — cift-tik/yaris onleme.
  const [busy, setBusy] = useState<string | null>(null);

  const items = data ?? [];

  const run = useCallback(
    async (key: string, action: () => Promise<unknown>): Promise<boolean> => {
      setActionError(null);
      setBusy(key);
      try {
        await action();
        refetch();
        return true;
      } catch (err) {
        setActionError(String(err));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refetch],
  );

  // Yedek al (yeni snapshot).
  const create = () =>
    void run("create", () => ipc.createSnapshot()).then((ok) => {
      if (ok) toast.success(t("backup.created"));
    });

  // Ice aktar: harici .db sec → managed listeye kopyala.
  const importExternal = () =>
    void (async () => {
      const src = await open({
        multiple: false,
        filters: [{ name: "SQLite", extensions: ["db"] }],
        title: t("backup.import"),
      });
      if (typeof src !== "string") return;
      if (await run("import", () => ipc.importSnapshot(src))) toast.success(t("backup.imported"));
    })();

  // Geri yukle: UZERINE YAZAR (geri-alinamaz) → guclu onay. Sonra bumpData (tum gorunum).
  const restore = (s: SnapshotDto) =>
    void (async () => {
      const ok = await confirm(t("backup.restore_confirm", { name: s.name }), {
        title: t("backup.restore"),
        kind: "warning",
      });
      if (ok && (await run(s.name, () => ipc.restoreSnapshot(s.name)))) {
        bumpData(); // arsiv icerigi degisti → liste/facet/sayac/saglik tazele
        toast.success(t("backup.restored"));
      }
    })();

  // Disa aktar: kaydet-diyalogu → managed yedegi harici konuma kopyala (felaket-yedegi).
  const exportTo = (s: SnapshotDto) =>
    void (async () => {
      const dest = await save({
        defaultPath: s.name,
        filters: [{ name: "SQLite", extensions: ["db"] }],
        title: t("backup.export"),
      });
      if (typeof dest !== "string") return;
      if (await run(s.name, () => ipc.exportSnapshot(s.name, dest))) toast.success(t("backup.exported"));
    })();

  // Sil (onayli).
  const remove = (s: SnapshotDto) =>
    void (async () => {
      const ok = await confirm(t("backup.delete_confirm", { name: s.name }), {
        title: t("backup.delete"),
        kind: "warning",
      });
      if (ok && (await run(s.name, () => ipc.deleteSnapshot(s.name)))) toast.success(t("backup.deleted"));
    })();

  const fmtDate = (ms: number) => (ms > 0 ? new Date(ms).toLocaleString(i18n.language) : "—");
  const btn =
    "rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("backup.title")}
      >
        {/* Baslik + Yedek Al / Ice Aktar + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">
            {t("backup.title")}
            {items.length > 0 && (
              <span className="ms-2 text-xs font-normal text-text-muted">
                {t("backup.count", { count: items.length })}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button type="button" onClick={create} disabled={busy !== null} className={btn}>
              {t("backup.create")}
            </button>
            <button type="button" onClick={importExternal} disabled={busy !== null} className={btn}>
              {t("backup.import")}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          </div>
        </div>

        <p className="border-b border-border bg-bg-tertiary/40 px-5 py-2 text-xs text-text-muted">
          {t("backup.hint")}
        </p>
        {actionError && <p className="px-5 py-2 text-sm text-danger">{actionError}</p>}

        {/* Icerik: yukleniyor / hata / bos / liste */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-text-muted">{t("list.loading")}</p>
          ) : error ? (
            <div className="text-sm text-danger">
              <p>{t("list.error", { message: error })}</p>
              <button type="button" onClick={refetch} className={`mt-2 ${btn}`}>
                {t("common.retry")}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-text-secondary">{t("backup.empty")}</p>
              <p className="mt-1 text-xs text-text-muted">{t("backup.empty_hint")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center gap-3 rounded-md border border-border bg-bg-tertiary/40 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {fmtDate(s.createdAt)}
                      </span>
                      {s.auto && (
                        <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-warning">
                          {t("backup.auto")}
                        </span>
                      )}
                    </div>
                    <span dir="ltr" className="block truncate text-xs text-text-muted" title={s.name}>
                      {s.name} · {formatBytes(s.sizeBytes)}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => restore(s)}
                      disabled={busy !== null}
                      className="rounded-md border border-accent/40 px-2 py-1 text-xs text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("backup.restore")}
                    </button>
                    <button type="button" onClick={() => exportTo(s)} disabled={busy !== null} className={btn}>
                      {t("backup.export")}
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(s)}
                      disabled={busy !== null}
                      className="rounded-md border border-danger/40 px-2 py-1 text-xs text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {t("backup.delete")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
