// Ayarlar → Genel: herkes ana admin'e tek yonlu oneriyi gonderebilir. Ana admin ayni
// kartta yerel gelen kutusunu gorur; yanit/konu/LAN aktarimi bilerek yoktur.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "../../hooks/useSession";
import { useIpcQuery } from "../../hooks/useIpcQuery";
import { useUiStore } from "../../store/useUiStore";
import { ipc, type UserMessage } from "../../ipc/client";
import { MainArchiveNotice } from "../archives/MainArchiveNotice";

const MAX_BODY_CHARS = 2_000;

function formatMessageDate(seconds: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(
    new Date(seconds * 1_000),
  );
}

function FounderInbox({ showTitle = true }: { showTitle?: boolean }) {
  const { t } = useTranslation();
  const { data, loading, error, refetch } = useIpcQuery<UserMessage[]>(
    () => ipc.listReceivedUserMessages(),
    [],
  );
  const [busyId, setBusyId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const markRead = async (messageId: number) => {
    setBusyId(messageId);
    setActionError(null);
    try {
      await ipc.markUserMessageRead(messageId);
      refetch();
    } catch {
      setActionError(t("suggestions.inbox_failed"));
    } finally {
      setBusyId(null);
    }
  };

  const resolve = async (messageId: number) => {
    setBusyId(messageId);
    setActionError(null);
    try {
      await ipc.resolveUserMessage(messageId);
      refetch();
    } catch {
      setActionError(t("suggestions.inbox_failed"));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className={showTitle ? "mt-3 border-t border-border pt-3" : ""}>
      {showTitle && <h4 className="text-xs font-semibold text-text-secondary">{t("suggestions.inbox")}</h4>}
      {loading && <p className="mt-2 text-xs text-text-muted">{t("list.loading")}</p>}
      {error && <p className="mt-2 text-xs text-danger">{t("suggestions.inbox_failed")}</p>}
      {actionError && <p className="mt-2 text-xs text-danger">{actionError}</p>}
      {data?.length === 0 && <p className="mt-2 text-xs text-text-muted">{t("suggestions.empty")}</p>}
      {data && data.length > 0 && (
        <ul className="mt-2 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {data.map((message) => {
            const busy = busyId === message.id;
            const resolved = message.resolvedAt != null;
            return (
              <li
                key={message.id}
                className={`rounded border p-2 ${
                  resolved ? "border-border bg-bg-tertiary/50" : "border-border-hover bg-bg-tertiary"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium text-text-primary">{message.senderUsername}</p>
                  <time className="shrink-0 text-[11px] text-text-muted">
                    {formatMessageDate(message.createdAt)}
                  </time>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-text-secondary">{message.body}</p>
                <div className="mt-2 flex items-center gap-2">
                  {resolved ? (
                    <span className="text-[11px] text-success">{t("suggestions.resolved")}</span>
                  ) : (
                    <>
                      {message.readAt == null && (
                        <button
                          type="button"
                          onClick={() => void markRead(message.id)}
                          disabled={busy}
                          className="rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition hover:border-border-hover hover:text-text-primary disabled:opacity-50"
                        >
                          {t("suggestions.mark_read")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void resolve(message.id)}
                        disabled={busy}
                        className="rounded border border-success/40 px-2 py-1 text-[11px] text-success transition hover:bg-success/10 disabled:opacity-50"
                      >
                        {t("suggestions.resolve")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function SuggestionsCard() {
  const { t } = useTranslation();
  const { isFounder } = useSession();
  const activeIsMain = useUiStore((s) => s.activeArchiveIsMain);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const canSend = body.trim().length > 0 && body.trim().length <= MAX_BODY_CHARS && !sending;

  const send = async () => {
    if (!canSend) return;
    setError(null);
    setSent(false);
    setSending(true);
    try {
      await ipc.sendUserMessage(body);
      setBody("");
      setSent(true);
    } catch {
      setError(t("suggestions.send_failed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {isFounder ? t("suggestions.inbox") : t("suggestions.title")}
      </h3>
      {/* Oneri/gelen-kutusu ANA arsivde (mesajlar merkezi). Ek arsivdeyken not goster. */}
      {!activeIsMain ? (
        <MainArchiveNotice />
      ) : isFounder ? (
        <FounderInbox showTitle={false} />
      ) : (
        <>
          <p className="text-xs text-text-muted">{t("suggestions.hint")}</p>
          <label className="sr-only" htmlFor="suggestion-body">
            {t("suggestions.body")}
          </label>
          <textarea
            id="suggestion-body"
            value={body}
            maxLength={MAX_BODY_CHARS}
            onChange={(event) => {
              setBody(event.target.value);
              setSent(false);
            }}
            placeholder={t("suggestions.placeholder")}
            rows={3}
            className="resize-y rounded-md border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-text-muted">
              {t("suggestions.remaining", { count: MAX_BODY_CHARS - body.length })}
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSend}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {sending ? t("auth.change.busy") : t("suggestions.send")}
            </button>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          {sent && <p className="text-xs text-success">{t("suggestions.sent")}</p>}
        </>
      )}
    </section>
  );
}
