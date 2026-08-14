// Sohbet oturum kenar-cubugu (ChatView'in sol paneli) — kalici cok-oturumlu sohbet.
//
// "＋ Yeni sohbet" + oturum listesi (baslik + tarih). Aktif oturum vurgulu. Her oturumda
// inline yeniden-adlandir (Enter/blur onay, Esc iptal) + sil (onayli). Saf sunum: veri +
// mutasyon geri-cagrilari ChatView'den gelir. RTL: border-e / ps- / ms- mantikli.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ChatSession } from "../../ipc/client";
import { ChatTrashList } from "./ChatTrashList";

interface Props {
  sessions: ChatSession[];
  currentSessionId: string | null;
  busy: boolean;
  onNewSession: () => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  /** Copteki (soft-delete) oturumlar + kurtarma geri-cagrilari — alt bolum (ChatTrashList). */
  trashed: ChatSession[];
  onRestoreTrashed: (id: string) => void;
  onPurgeTrashed: (id: string) => void;
  /** DIGER arsivin sohbetleri (v26) — gizlenmez, ayri katlanabilir bolumde durur.
   *  ⚠️ "Fazla kapatma" dersi: sessizce kaybolan gecmis veri kaybi gibi okunur. */
  otherSessions: ChatSession[];
  /** O bolumun hangi arsiga ait oldugu — baslik metnini secer. */
  otherSource: "local" | "remote";
  /** Oturumu ac = KAYNAK DEGISIMI (ChatView karari verir; burasi yalniz niyeti iletir). */
  onOpenOtherSession: (id: string) => void;
}

export function ChatSessionSidebar({
  sessions,
  currentSessionId,
  busy,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  trashed,
  onRestoreTrashed,
  onPurgeTrashed,
  otherSessions,
  otherSource,
  onOpenOtherSession,
}: Props) {
  const { t, i18n } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Diger arsivin sohbetleri varsayilan KAPALI — aktif kaynagin listesini bogmasin.
  const [otherOpen, setOtherOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId) inputRef.current?.focus();
  }, [editingId]);

  const startEdit = (s: ChatSession) => {
    setEditingId(s.id);
    setDraft(s.title);
  };

  const commitEdit = () => {
    const id = editingId;
    if (id) {
      const title = draft.trim();
      if (title) onRenameSession(id, title);
    }
    setEditingId(null);
    setDraft("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft("");
  };

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
    <aside className="flex w-60 shrink-0 flex-col border-e border-border bg-bg-secondary/30">
      <div className="p-2">
        <button
          type="button"
          onClick={onNewSession}
          disabled={busy}
          className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm font-medium text-text-primary transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden className="me-1">
            ＋
          </span>
          {t("chat.new_session")}
        </button>
      </div>

      <div className="px-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
        {t("chat.sessions_title")}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-text-muted">{t("chat.no_sessions")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((s) => {
              const active = s.id === currentSessionId;
              const isEditing = editingId === s.id;
              return (
                <li key={s.id} className="group relative">
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      className="w-full rounded-md border border-accent bg-bg-tertiary px-2.5 py-1.5 text-xs text-text-primary focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectSession(s.id)}
                      title={s.title || t("chat.untitled")}
                      className={`flex w-full flex-col rounded-md px-2.5 py-1.5 pe-12 text-start transition ${
                        active
                          ? "bg-accent/15 text-text-primary"
                          : "text-text-secondary hover:bg-bg-tertiary"
                      }`}
                    >
                      <span className="truncate text-xs font-medium">
                        {s.title || t("chat.untitled")}
                      </span>
                      <span className="mt-0.5 text-[10px] text-text-muted">
                        {fmtDate(s.updatedAt)}
                      </span>
                    </button>
                  )}

                  {!isEditing && (
                    <div className="absolute inset-y-0 end-1 flex items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() => startEdit(s)}
                        disabled={busy}
                        title={t("chat.rename")}
                        aria-label={t("chat.rename")}
                        className="rounded p-1 text-text-muted transition hover:bg-bg-secondary hover:text-text-primary disabled:opacity-40"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSession(s.id)}
                        disabled={busy}
                        title={t("chat.delete")}
                        aria-label={t("chat.delete")}
                        className="rounded p-1 text-text-muted transition hover:bg-danger/15 hover:text-danger disabled:opacity-40"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* DIGER ARSIVIN SOHBETLERI (v26) — kaynak ayrimi gorunur olsun diye burada durur.
          Acmak kaynak degistirir → dugme metni bunu ACIKCA soyler (sessiz yan etki yok). */}
      {otherSessions.length > 0 && (
        <div className="border-t border-border">
          <button
            type="button"
            onClick={() => setOtherOpen((v) => !v)}
            aria-expanded={otherOpen}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-text-muted transition hover:text-text-primary"
          >
            <span aria-hidden className={otherOpen ? "rotate-90" : ""}>
              ▸
            </span>
            <span className="truncate">
              {otherSource === "remote"
                ? t("chat.other_source.remote")
                : t("chat.other_source.local")}
            </span>
            <span className="ms-auto tabular-nums">{otherSessions.length}</span>
          </button>

          {otherOpen && (
            <ul className="flex max-h-40 flex-col gap-0.5 overflow-auto px-1.5 pb-2">
              {otherSessions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onOpenOtherSession(s.id)}
                    disabled={busy}
                    title={t("chat.other_source.open_hint")}
                    className="flex w-full flex-col rounded-md px-2.5 py-1.5 text-start text-text-secondary transition hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="truncate text-xs">{s.title || t("chat.untitled")}</span>
                    <span className="mt-0.5 text-[10px] text-text-muted">
                      {/* Uzak oturumda HANGI ana arsiv oldugu yazili — baska host'a eslesilmisse
                          atiflar gecersizdir, kullanici bunu bilmeli. */}
                      {s.hostLabel ? `${fmtDate(s.updatedAt)} · ${s.hostLabel}` : fmtDate(s.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ChatTrashList
        trashed={trashed}
        busy={busy}
        onRestore={onRestoreTrashed}
        onPurge={onPurgeTrashed}
      />
    </aside>
  );
}

function PencilIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
