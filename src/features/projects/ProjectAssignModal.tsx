// Toplu "Projeye Ata" secici (BatchToolbar'dan acilir) — secili asset id'lerini bir projeye
// atar (`assets.project_id`) ya da atamayi kaldirir. Portal modal (BulkProjectStatusModal deseni).
//
// Icerik: proje listesi (her satir ad + atanmis asset sayisi) → tikla → ata; ayrica "Atamayi
// kaldir" (projectId=null). Basari → toast (etkilenen sayi) + onDone (bumpData). Yazma editor+
// (backend zorlar; UI ProtectedAction ile kesif). Proje yoksa → Projeler panelinde olusturma ipucu.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { authErrorMessage } from "../auth/authError";
import { useToast } from "../toast/useToast";

interface Props {
  /** Atanacak asset id'leri (toplu secim). */
  ids: number[];
  onClose: () => void;
  /** Basarili atama sonrasi (grid + facet tazeleme). */
  onDone: () => void;
}

export function ProjectAssignModal({ ids, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, loading, error, refetch } = useIpcQuery(() => ipc.listProjects(), []);
  const projects = data ?? [];
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, busy]);

  const assign = (projectId: number | null) =>
    void (async () => {
      if (busy) return;
      setBusy(true);
      try {
        const n = await ipc.assignAssetsToProject(ids, projectId);
        toast.success(t("projects.assigned_toast", { count: n }));
        onDone();
        onClose();
      } catch (e) {
        toast.error(authErrorMessage(e, t));
      } finally {
        setBusy(false);
      }
    })();

  const rowCls =
    "flex w-full items-center gap-2 rounded-md border border-border bg-bg-secondary px-3 py-2 text-start " +
    "transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
      onClick={() => !busy && onClose()}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("projects.assign_to")}
      >
        {/* Baslik + secili sayisi + kapat */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-text-primary">
              {t("projects.assign_to")}
            </h2>
            <p className="mt-0.5 text-xs text-text-secondary">
              {t("projects.assign_subtitle", { count: ids.length })}
            </p>
          </div>
          {!busy && (
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="ms-auto shrink-0 rounded px-2 text-text-secondary transition hover:text-text-primary"
            >
              ×
            </button>
          )}
        </div>

        {/* Govde: atamayi kaldir + proje listesi. (Erisim BatchToolbar'da canWrite ile gate'li;
            gercek yetki Rust'ta — viewer backend Err → toast.) */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="flex flex-col gap-2">
            {/* Atamayi kaldir (projectId=null) */}
            <button type="button" onClick={() => assign(null)} disabled={busy} className={rowCls}>
              <span className="text-text-secondary">✕ {t("projects.unassign")}</span>
            </button>

            {loading ? (
              <p className="py-6 text-center text-sm text-text-muted">{t("projects.loading")}</p>
            ) : error ? (
              <div className="py-6 text-center text-sm text-danger">
                <p>{t("projects.load_error")}</p>
                <button
                  type="button"
                  onClick={refetch}
                  className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs text-text-primary
                             transition hover:border-border-hover hover:bg-bg-tertiary"
                >
                  {t("common.retry")}
                </button>
              </div>
            ) : projects.length === 0 ? (
              <p className="py-6 text-center text-xs text-text-muted">{t("projects.assign_empty")}</p>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => assign(p.id)}
                  disabled={busy}
                  className={rowCls}
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-text-primary">
                    {p.name}
                  </span>
                  <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                    {t("projects.asset_count", { count: p.assetCount })}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
