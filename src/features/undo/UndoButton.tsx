// Geri Al gecmisi (P2.5 stabilite) — TopBar ↶ butonu + portal panel.
//
// Panel `list_undo_ops`'u listeler (en yeni once): tur + etiket (dil-notr veri; yol LTR) +
// oge sayisi + zaman + durum. Aktif kayitta "Geri Al" → `undo_op` (Channel ilerleme buton
// metninde) → ozet toast + bumpData/bumpFacets + liste tazele. `failed` varsa kayit AKTIF
// kalir (backend) → kullanici gecici sorunu (kilitli dosya vb.) cozup yeniden deneyebilir;
// bunu `undo.partial` toast'u soyler. Yetki: liste editor+ (buton ProtectedAction'la
// gorunur-pasif); geri-alma kind-bazli backend'de (tasima=admin, meta=editor).

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { RefileProgress, UndoOpRow } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { formatDate } from "../../lib/format";
import { ProtectedAction } from "../../permissions";
import { useUiStore } from "../../store/useUiStore";
import { useToast } from "../toast/useToast";

/** Tur → satir ikonu (dekoratif). */
const KIND_ICON: Record<string, string> = {
  refile_move: "📦",
  rename: "✏️",
  organize_move: "🗂️",
  project_meta_bulk: "🏷️",
  favorite_add: "★",
  favorite_remove: "☆",
  tag_add: "#",
  tag_remove: "#",
  collection_add: "📁",
  collection_remove: "📂",
  trash: "🗑️",
};

export function UndoButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <ProtectedAction require="editor" mode="disabled">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("undo.open")}
          title={t("undo.open")}
          className="flex h-7 w-7 items-center justify-center rounded border border-border text-sm
                     text-text-secondary transition hover:border-border-hover hover:text-text-primary
                     focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden>↶</span>
        </button>
      </ProtectedAction>
      {open && <UndoPanel onClose={() => setOpen(false)} />}
    </>
  );
}

/** TopBar ↷ — hizli "ileri al": EN SON geri-alinmis islemi tek tikla yeniden uygular. Geri-alinmis
 *  islem yoksa pasif. Granuler kontrol UndoPanel'de (↶). Editor+ (ProtectedAction gorunur-pasif). */
export function RedoButton() {
  const { t } = useTranslation();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const bumpFacets = useUiStore((s) => s.bumpFacets);
  const dataVersion = useUiStore((s) => s.dataVersion);
  const [redoable, setRedoable] = useState<UndoOpRow | null>(null);
  const [busy, setBusy] = useState(false);

  // En son geri-alinmis kayit (liste yeni-once → ilk `undone`). Undo/redo sonrasi bumpData →
  // dataVersion degisir → tazele. Viewer'da liste komutu Err atar → sessizce pasif (catch).
  useEffect(() => {
    let active = true;
    ipc
      .listUndoOps(50)
      .then((ops) => {
        if (active) setRedoable(ops.find((o) => o.undone) ?? null);
      })
      .catch(() => {
        if (active) setRedoable(null);
      });
    return () => {
      active = false;
    };
  }, [dataVersion]);

  const doRedo = async () => {
    if (!redoable || busy) return;
    setBusy(true);
    try {
      const report = await ipc.redoOp(redoable.id);
      toast.success(
        t("undo.redone", {
          reverted: report.reverted,
          skipped: report.skipped.length,
          failed: report.failed.length,
        }),
      );
      if (report.failed.length > 0) toast.info(t("undo.partial"));
      bumpData();
      bumpFacets();
    } catch {
      toast.error(t("undo.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ProtectedAction require="editor" mode="disabled">
      <button
        type="button"
        onClick={() => void doRedo()}
        disabled={!redoable || busy}
        aria-label={t("undo.open_redo")}
        title={redoable ? t("undo.open_redo") : t("undo.redo_none")}
        className="flex h-7 w-7 items-center justify-center rounded border border-border text-sm
                   text-text-secondary transition hover:border-border-hover hover:text-text-primary
                   focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span aria-hidden>↷</span>
      </button>
    </ProtectedAction>
  );
}

function UndoPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const bumpData = useUiStore((s) => s.bumpData);
  const bumpFacets = useUiStore((s) => s.bumpFacets);

  const [ops, setOps] = useState<UndoOpRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Su an geri-alinan kayit (buton kilidi + ilerleme metni). null = bos.
  const [busyId, setBusyId] = useState<number | null>(null);
  const [progress, setProgress] = useState<RefileProgress | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOps(await ipc.listUndoOps(50));
    } catch {
      setOps([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const requestClose = useCallback(() => {
    if (busyId != null) return; // geri-alma surerken kilitli
    onClose();
  }, [busyId, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  // Tek yon: forward=false → Geri Al (undo); forward=true → Ileri Al (redo). Islem sonunda hep
  // liste + grid + facet tazelenir; kismi hata (failed>0) → kayit aktif kaldi bilgisi.
  const run = async (op: UndoOpRow, forward: boolean) => {
    if (busyId != null) return;
    setBusyId(op.id);
    setProgress(null);
    try {
      const report = forward
        ? await ipc.redoOp(op.id, (p) => setProgress(p))
        : await ipc.undoOp(op.id, (p) => setProgress(p));
      toast.success(
        t(forward ? "undo.redone" : "undo.done", {
          reverted: report.reverted,
          skipped: report.skipped.length,
          failed: report.failed.length,
        }),
      );
      // Kalici hata varsa kayit durumu tam degismedi (yeniden denenebilir).
      if (report.failed.length > 0) toast.info(t("undo.partial"));
      bumpData(); // liste/grid tazelensin (yollar/meta/uyelik degisti)
      bumpFacets(); // meta/favori/etiket/koleksiyon facet'lerini etkiler
      await refresh();
    } catch (e) {
      const code = String(e);
      const known =
        code === "already_undone"
          ? "undo.err.already_undone"
          : code === "not_undone"
            ? "undo.err.not_undone"
            : null;
      toast.error(known ? t(known) : t("undo.failed"));
      await refresh(); // durum degismis olabilir (yaris) → listeyi tazele
    } finally {
      setBusyId(null);
      setProgress(null);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={requestClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("undo.title")}
      >
        {/* Baslik */}
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <span aria-hidden className="text-lg">
            ↶
          </span>
          <h2 className="font-display text-base font-bold text-text-primary">{t("undo.title")}</h2>
          {busyId == null && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="ms-auto rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          )}
        </div>

        {/* Liste */}
        <div className="min-h-[8rem] flex-1 overflow-auto p-2">
          {loading ? (
            <p className="px-3 py-8 text-center text-sm text-text-muted">{t("list.loading")}</p>
          ) : ops.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-text-muted">{t("undo.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {ops.map((op) => {
                const busy = busyId === op.id;
                return (
                  <li
                    key={op.id}
                    className={`flex items-center gap-2 rounded-md border border-border px-3 py-2 ${
                      op.undone ? "opacity-55" : ""
                    }`}
                  >
                    <span aria-hidden className="shrink-0">
                      {KIND_ICON[op.kind] ?? "↶"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-medium text-text-primary">
                          {t(`undo.kind.${op.kind}`, { defaultValue: op.kind })}
                        </span>
                        <span className="rounded bg-bg-tertiary px-1.5 py-px text-[11px] tabular-nums text-text-muted">
                          {t("undo.items", { count: op.itemCount })}
                        </span>
                      </div>
                      {op.label !== "" && (
                        <div dir="ltr" title={op.label} className="truncate text-xs text-text-muted">
                          {op.label}
                        </div>
                      )}
                      <div className="text-[11px] text-text-muted">
                        {formatDate(op.createdAt)}
                      </div>
                    </div>
                    {/* Aktif kayit → Geri Al; geri-alinmis kayit → Ileri Al (cift-yon toggle). */}
                    <button
                      type="button"
                      onClick={() => void run(op, op.undone)}
                      disabled={busyId != null}
                      className={`shrink-0 rounded-md border px-2.5 py-1 text-xs transition
                                 disabled:cursor-not-allowed disabled:opacity-50
                                 ${
                                   op.undone
                                     ? "border-accent/40 text-accent hover:border-accent hover:bg-accent/10"
                                     : "border-border text-text-primary hover:border-accent hover:text-accent"
                                 }`}
                    >
                      {busy && progress
                        ? t(op.undone ? "undo.redoing" : "undo.reverting", {
                            processed: progress.processed,
                            total: progress.total,
                          })
                        : busy
                          ? t(op.undone ? "undo.redoing_simple" : "undo.reverting_simple")
                          : t(op.undone ? "undo.redo" : "undo.revert")}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
