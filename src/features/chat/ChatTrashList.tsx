// "Silinen sohbetler" kurtarma listesi — ChatSessionSidebar'in alt bolumu (katlanabilir).
//
// Soft-delete edilmis sohbet oturumlari (deleted_at dolu). Her satir: baslik · silinme tarihi ·
// "Geri yukle" (restore) / "Kalici sil" (purge; SERT onay ebeveynde). Saf sunum: veri + mutasyon
// geri-cagrilari ChatView'den gelir (RootTrashList deseni). RTL: border-t/ps-/pe- notrdur.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { ChatSession } from "../../ipc/client";
import { formatNumber } from "../../lib/format";

interface Props {
  trashed: ChatSession[];
  busy: boolean;
  onRestore: (id: string) => void;
  onPurge: (id: string) => void;
}

export function ChatTrashList({ trashed, busy, onRestore, onPurge }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);

  const fmtDate = (ms: number) => {
    try {
      return new Date(ms).toLocaleDateString(i18n.language, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-medium uppercase
                   tracking-wide text-text-muted transition hover:text-text-secondary"
      >
        <span className="flex items-center gap-1.5">
          <span>{t("chat.trash_title")}</span>
          {trashed.length > 0 && (
            <span className="rounded-full border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-text-secondary">
              {formatNumber(trashed.length)}
            </span>
          )}
        </span>
        <span aria-hidden className={`transition-transform ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>

      {open && (
        <div className="max-h-48 overflow-auto px-1.5 pb-2">
          {trashed.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-text-muted">{t("chat.trash_empty")}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {trashed.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-col gap-1 rounded-md border border-border bg-bg-secondary/40 px-2.5 py-1.5"
                >
                  <span
                    className="truncate text-xs font-medium text-text-secondary"
                    title={s.title || t("chat.untitled")}
                  >
                    {s.title || t("chat.untitled")}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {s.deletedAt != null ? t("chat.deleted_at", { date: fmtDate(s.deletedAt) }) : ""}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onRestore(s.id)}
                      disabled={busy}
                      className="rounded border border-border px-2 py-0.5 text-[11px] text-text-secondary
                                 transition hover:border-border-hover hover:text-text-primary disabled:opacity-40"
                    >
                      {t("chat.restore")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onPurge(s.id)}
                      disabled={busy}
                      className="rounded border border-danger/40 px-2 py-0.5 text-[11px] text-danger
                                 transition hover:border-danger hover:bg-danger/10 disabled:opacity-40"
                    >
                      {t("chat.purge")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
