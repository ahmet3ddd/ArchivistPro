// Genel onay diyalogu — H2 `ConfirmDialog.tsx` paritesi.
//
// NEDEN VAR: H3'te hicbir genel onay diyalogu YOKTU (`src/components/` yalniz EmptyState +
// Spinner); onaylar modal-icine gomulmustu. 2026-07-18 H2-gerileme taramasi "pencere kapatma
// onayi yok" bulgusunu cikardi (uzun tarama sirasinda X'e basmak uyarisiz oldururdu) ve
// dayanacak bir diyalog bulunmadi. Bu bilesen o bosluktur.
//
// Davranis: Escape = iptal · arka-plan tik = iptal · acilinca onay butonuna odak
// (klavyeyle Enter dogrudan calisir). `danger` yikici eylemler icin kirmizi vurgu.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useModalDialog } from "../hooks/useModalDialog";

interface Props {
  title: string;
  message: string;
  /** Onay butonu metni (verilmezse `common.ok`). */
  confirmLabel?: string;
  /** Iptal butonu metni (verilmezse `common.cancel`). */
  cancelLabel?: string;
  /** Yikici eylem → onay butonu kirmizi. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Scrim/Escape davranisi iptal dugmesinden farkliysa acikca verilir. */
  onDismiss?: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dismiss = onDismiss ?? onCancel;
  const dialogRef = useModalDialog<HTMLDivElement>(dismiss);

  // Acilista onay butonuna odak; Escape/scrim ortak modal hook'undan gelir.
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={dismiss}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-lg border border-border bg-bg-secondary p-5 shadow-xl"
      >
        <h2 className="font-display text-base font-bold text-text-primary">{title}</h2>
        <p className="mt-2 text-sm text-text-secondary">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary hover:border-border-hover"
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-md px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 ${
              danger ? "bg-danger" : "bg-accent"
            }`}
          >
            {confirmLabel ?? t("common.ok")}
          </button>
        </div>
      </div>
    </div>
  );
}
