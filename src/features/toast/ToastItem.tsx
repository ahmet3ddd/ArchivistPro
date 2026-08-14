// Tek toast satiri — kendi otomatik-kapanma zamanlayicisini tutar (bilesen yasam-
// dongusune bagli; ileride hover-duraklatma eklenebilir). Tur'e gore renkli ikon +
// baslangic-kenari serieti (RTL-guvenli: border-inline-start). Hareket azaltma
// tercihinde giris animasyonu kapanir (motion-reduce).

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import type { Toast, ToastKind } from "./toastStore";
import { useToastStore } from "./toastStore";

/**
 * Tur basina otomatik kapanma suresi. **`error` = null → KAPANMAZ** (kullanici kapatir).
 *
 * NEDEN (2026-07-18 H2-gerileme taramasi bulgusu): eskiden TUM turler 4 sn'de kayboluyordu.
 * Uzun bir tarama/indeksleme sirasinda olusan hata, kullanici ekrana bakmiyorsa IZSIZ yok
 * oluyordu. H2 `notificationCenter.ts:115` hatayi `autoDismissMs: 0` ile kullanici kapatana
 * kadar tutar (uyarilar 12 sn, bilgi kisa). Kapatma dugmesi zaten var → kalici hata birikmez.
 */
const AUTO_DISMISS_MS: Record<ToastKind, number | null> = {
  success: 4000,
  info: 4000,
  error: null,
};

// Tur → ikon + metin rengi (Tailwind token) + kenar rengi (CSS degiskeni, RTL-guvenli).
const KIND: Record<ToastKind, { icon: string; color: string; edge: string }> = {
  success: { icon: "✓", color: "text-success", edge: "var(--color-success)" },
  error: { icon: "⚠", color: "text-danger", edge: "var(--color-danger)" },
  info: { icon: "ℹ", color: "text-accent", edge: "var(--color-accent)" },
};

export function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    const ms = AUTO_DISMISS_MS[toast.kind];
    if (ms == null) return; // hata: kullanici kapatana kadar durur
    const id = window.setTimeout(() => dismiss(toast.id), ms);
    return () => window.clearTimeout(id);
  }, [toast.id, toast.kind, dismiss]);

  const k = KIND[toast.kind];

  return (
    <div
      // Hata ekran-okuyucuya ANINDA duyurulur (`alert`); basari/bilgi kibarca (`status`).
      role={toast.kind === "error" ? "alert" : "status"}
      // Baslangic-kenari serieti: inline stil (Tailwind sira-cakismasini eler; RTL-guvenli).
      style={{ borderInlineStartWidth: "2px", borderInlineStartColor: k.edge }}
      className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border
                 bg-bg-secondary/95 px-3.5 py-2.5 shadow-xl backdrop-blur-lg
                 animate-toast-in motion-reduce:animate-none"
    >
      <span className={`mt-0.5 shrink-0 text-sm leading-none ${k.color}`} aria-hidden="true">
        {k.icon}
      </span>
      <p className="flex-1 break-words text-sm text-text-primary">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
          className="-my-0.5 shrink-0 self-center rounded-md border border-border px-2 py-1 text-xs
                     font-medium text-accent transition hover:bg-accent/10"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label={t("toast.dismiss")}
        className="-me-1 shrink-0 px-1 leading-none text-text-muted transition hover:text-text-primary"
      >
        ×
      </button>
    </div>
  );
}
