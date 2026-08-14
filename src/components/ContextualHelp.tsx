// Baglam-ici yardim katmani (H2 parite kalemi §11) — karmasik yuzeylerde "bu ne ise yarar?"
//
// H2'de yuzey-basi ayri bilesenler vardi (`ChatHelpOverlay.tsx`, `DuplicateFinderModal`
// `onHelpClick`, genel `HelpPanel.tsx`). H3'te TEK yeniden-kullanilabilir bilesen var: cagiran
// yalniz ICERIGI (bolum/madde i18n anahtarlari) verir, kabuk burada. Boylece yeni bir yuzeye
// yardim eklemek = bir dizi sabit yazmak; kopyala-yapistir modal kabugu yok.
//
// Portal/modal deseni ShortcutHelpOverlay pariti: createPortal(document.body) → TopBar
// backdrop-blur containing-block tuzagindan kacar; scrim tik + Esc kapatir.
//
// ⚠️ Bu bilesen KLAVYE yardimi DEGIL (o `ShortcutHelpOverlay`, '?' ile global). Bu, acildigi
// yuzeyin KAVRAMLARINI anlatir.

import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

/** Yardim maddesi: solda rozet, sagda aciklama. */
export interface HelpItem {
  /** Cevrilmeyen sabit rozet — teknik terim (or. "Ollama"). `labelKey` ile birlikte verilmez. */
  label?: string;
  /** Cevrilecek rozet anahtari (UI'daki dugme/alan adi). */
  labelKey?: string;
  /** Aciklama i18n anahtari. */
  descKey: string;
}

export interface HelpSection {
  titleKey: string;
  items: HelpItem[];
}

interface Props {
  /** Modal basligi i18n anahtari. */
  titleKey: string;
  /** Baslik altinda tek cumlelik ozet (opsiyonel). */
  introKey?: string;
  sections: HelpSection[];
  /** Altta gri ipucu satiri (opsiyonel) — genelde "X yoksa ne olur" gibi sinir bilgisi. */
  hintKey?: string;
  /** Tetikleyici dugmenin erisilebilir adi (or. "Sohbet yardimi"). */
  buttonLabelKey: string;
}

/** "?" dugmesi + acildiginda yuzeyin kavramlarini anlatan modal. */
export function ContextualHelp({
  titleKey,
  introKey,
  sections,
  hintKey,
  buttonLabelKey,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const headingId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation(); // yuzeyin kendi Esc davranisi (or. secim temizleme) tetiklenmesin
        setOpen(false);
      }
    };
    // capture: alttaki global dinleyicilerden ONCE yakala.
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t(buttonLabelKey)}
        title={t(buttonLabelKey)}
        className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-bold text-text-muted transition hover:border-border-hover hover:text-accent"
      >
        ?
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={headingId}
              onClick={(e) => e.stopPropagation()}
              className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-bg-primary shadow-xl"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3">
                <h2 id={headingId} className="font-display text-base font-bold text-accent">
                  {t(titleKey)}
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("common.close")}
                  className="rounded px-2 text-text-secondary transition hover:text-text-primary"
                >
                  ×
                </button>
              </div>

              <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
                {introKey && <p className="text-sm text-text-secondary">{t(introKey)}</p>}

                {sections.map((sec) => (
                  <section key={sec.titleKey} className="flex flex-col gap-2">
                    <h3 className="border-b border-border pb-1 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                      {t(sec.titleKey)}
                    </h3>
                    <dl className="flex flex-col gap-2">
                      {sec.items.map((item) => (
                        <div key={item.descKey} className="flex flex-col gap-0.5">
                          <dt className="text-xs font-semibold text-text-primary">
                            {item.labelKey ? t(item.labelKey) : item.label}
                          </dt>
                          <dd className="text-xs leading-relaxed text-text-secondary">
                            {t(item.descKey)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>

              {hintKey && (
                <p className="border-t border-border px-5 py-2.5 text-xs text-text-muted">
                  {t(hintKey)}
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
