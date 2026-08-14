// Crash/panik raporu goruntuleyici (P2.5 stabilite) — yalniz admin; salt-okuma + Temizle.
// Panik hook'un <db_parent>/logs/crash.log'a yazdigi raporlari (en yeni once) gosterir. AuditLogPanel
// deseni (portal/scrim/Esc; useIpcQuery). Sayfalama YOK (son N; backend 500 clamp). Backtrace
// <details> ile acilir (uzun olabilir). Bos → "kayit yok" (iyi haber). Temizle → clear + tazele.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import type { CrashReport } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { formatDate } from "../../lib/format";
import { useToast } from "../toast/useToast";

const LIMIT = 200;

interface Props {
  onClose: () => void;
}

export function CrashLogPanel({ onClose }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [reloadKey, setReloadKey] = useState(0);
  const { data, loading, error, refetch } = useIpcQuery<CrashReport[]>(
    () => ipc.crashReports(LIMIT),
    [reloadKey],
  );
  const [clearing, setClearing] = useState(false);
  const items = data ?? [];

  // Esc → kapat (capture; AuditLogPanel ile ayni).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const clearAll = async () => {
    if (clearing || items.length === 0) return;
    setClearing(true);
    try {
      await ipc.clearCrashReports();
      toast.success(t("crash.cleared"));
      setReloadKey((k) => k + 1);
    } catch {
      toast.error(t("crash.clear_failed"));
    } finally {
      setClearing(false);
    }
  };

  const btn =
    "rounded-md border border-border px-2 py-1 text-xs text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("crash.title")}
      >
        {/* Baslik + sayi + Temizle + kapat */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
          <h2 className="font-display text-base font-bold text-accent">
            {t("crash.title")}
            {items.length > 0 && (
              <span className="ms-2 text-xs font-normal text-text-muted">
                {t("crash.count", { count: items.length })}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void clearAll()}
              disabled={clearing || items.length === 0}
              className={btn}
            >
              {t("crash.clear")}
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
          {t("crash.hint")}
        </p>

        {/* Icerik: yukleniyor / hata / bos / liste */}
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          {loading ? (
            <p className="text-sm text-text-muted">{t("crash.loading")}</p>
          ) : error ? (
            <div className="text-sm text-danger">
              <p>{t("list.error", { message: error })}</p>
              <button type="button" onClick={refetch} className={`mt-2 ${btn}`}>
                {t("common.retry")}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-text-secondary">{t("crash.empty")}</p>
              <p className="mt-1 text-xs text-text-muted">{t("crash.empty_hint")}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((r, i) => (
                <CrashRowView key={`${r.ts}-${i}`} report={r} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Tek crash raporu — zaman · is parcacigi · konum · mesaj + (acilir) backtrace. */
function CrashRowView({ report }: { report: CrashReport }) {
  const { t } = useTranslation();
  return (
    <li className="rounded-md border border-border bg-bg-secondary/50 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="whitespace-nowrap text-text-secondary tabular-nums">
          {formatDate(report.ts)}
        </span>
        <span className="rounded bg-bg-tertiary px-1.5 py-px text-[10px] text-text-muted">
          {report.thread}
        </span>
        {report.location && (
          <span dir="ltr" className="truncate font-mono text-text-muted" title={report.location}>
            {report.location}
          </span>
        )}
      </div>
      <p className="mt-1 font-medium text-danger">{report.message}</p>
      {report.backtrace && (
        <details className="mt-1">
          <summary className="cursor-pointer text-text-muted hover:text-text-secondary">
            {t("crash.backtrace")}
          </summary>
          <pre
            dir="ltr"
            className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-bg-tertiary/60 p-2 font-mono text-[10px] text-text-secondary"
          >
            {report.backtrace}
          </pre>
        </details>
      )}
    </li>
  );
}
