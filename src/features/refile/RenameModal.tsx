// Yeniden adlandirma modali (tekil asset; ADMIN) — kucuk scrim+kart (IngestModal portal deseni).
//
// Metin input mevcut `fileName` ile on-dolu (govde secili → uzanti degil, kolay duzenleme). Enter/
// "Yeniden adlandir" → renameAsset(id, newName) → basari toast + onDone (refetch + bumpData) + kapat.
// Hata → refileErrorMessage toast; modal ACIK kalir (kullanici duzeltip tekrar dener). Ad bos veya
// degismemis → buton pasif. Escape/scrim/kapat ile iptal (calisirken kilitli). i18n zorunlu; RTL-guvenli.

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { ipc } from "../../ipc/client";
import { useToast } from "../toast/useToast";
import { refileErrorMessage } from "./refileError";

interface Props {
  assetId: number;
  /** Mevcut dosya adi (input on-dolu deger). */
  currentName: string;
  onClose: () => void;
  /** Basarili yeniden-adlandirma sonrasi (refetch + bumpData). */
  onDone: () => void;
}

export function RenameModal({ assetId, currentName, onClose, onDone }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Acilista input'a odaklan + ad govdesini sec (uzanti haric) → hizli duzenleme.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dot = currentName.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : currentName.length);
  }, [currentName]);

  const requestClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestClose]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await ipc.renameAsset(assetId, trimmed);
      toast.success(t("refile.rename_done", { name: trimmed }));
      onDone();
      onClose();
    } catch (e) {
      toast.error(refileErrorMessage(e, t)); // modal acik kalir → duzelt/tekrar dene
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={requestClose}
    >
      <div
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-bg-primary p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("refile.rename_title")}
      >
        <h2 className="font-display text-base font-bold text-accent">{t("refile.rename_title")}</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-secondary">{t("refile.rename_label")}</span>
          <input
            ref={inputRef}
            type="text"
            dir="ltr"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder={t("refile.rename_placeholder")}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            className="w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-start
                       text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none
                       disabled:opacity-50"
          />
        </label>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={requestClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-primary transition
                       hover:bg-bg-tertiary disabled:opacity-50"
          >
            {t("common.close")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition
                       hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("refile.rename")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
