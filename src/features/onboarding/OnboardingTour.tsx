// İlk kullanım turu — yeni yerel kullanıcıya dört kısa adımda temel akışı anlatır.
//
// Vurgulu DOM “coach mark”ları yerine sakin, ekranı bozmayan bir dialog seçildi:
// uygulama ilk kullanımda boş bir arşiv de açabilir ve ekran çözünürlüğü/RTL her
// kullanıcıda farklıdır. Rehber atlanabilir, kullanıcı-bazlı localStorage'da
// tamamlandı olarak kalır ve Ayarlar → Genel'den tekrar açılabilir.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useSession } from "../../hooks/useSession";
import { completeOnboarding, hasCompletedOnboarding } from "./onboardingPrefs";
import { useOnboardingStore } from "./onboardingStore";

const STEP_KEYS = [
  { title: "onboarding.step_explore_title", body: "onboarding.step_explore_body" },
  { title: "onboarding.step_search_title", body: "onboarding.step_search_body" },
  { title: "onboarding.step_organize_title", body: "onboarding.step_organize_body" },
  { title: "onboarding.step_settings_title", body: "onboarding.step_settings_body" },
] as const;

export function OnboardingTour() {
  const { t } = useTranslation();
  const { session } = useSession();
  const open = useOnboardingStore((s) => s.open);
  const openTour = useOnboardingStore((s) => s.openTour);
  const closeTour = useOnboardingStore((s) => s.closeTour);
  const [step, setStep] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Oturum değişince her kullanıcı kendi local rehber kaydına göre karar verir.
  // Önceki kullanıcı turu açıkken çıkış yapılmış olsa bile yeni kullanıcıya sızmaz.
  useEffect(() => {
    if (!session) {
      closeTour();
      return;
    }
    if (hasCompletedOnboarding(session.user_id)) closeTour();
    else openTour();
  }, [session?.user_id, openTour, closeTour]);

  // Tekrar açılışta ilk adıma dön ve klavye odağını dialoga al.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    requestAnimationFrame(() => nextRef.current?.focus());
  }, [open]);

  const finish = () => {
    if (session) completeOnboarding(session.user_id);
    closeTour();
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, session?.user_id, closeTour]);

  if (!open || !session) return null;

  const current = STEP_KEYS[step];
  const last = step === STEP_KEYS.length - 1;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-4"
      onClick={finish}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-body"
        onClick={(event) => event.stopPropagation()}
        className="flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-border-hover bg-bg-primary shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border bg-bg-secondary px-5 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-accent">
              {t("onboarding.progress", { current: step + 1, total: STEP_KEYS.length })}
            </p>
            <h2 id="onboarding-title" className="font-display text-base font-bold text-text-primary">
              {t("onboarding.title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={finish}
            aria-label={t("common.close")}
            className="rounded px-2 text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-6">
          <div className="flex gap-1.5" aria-hidden>
            {STEP_KEYS.map((_, index) => (
              <span
                key={index}
                className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-accent" : "bg-border"}`}
              />
            ))}
          </div>
          <h3 className="font-display text-lg font-semibold text-text-primary">{t(current.title)}</h3>
          <p id="onboarding-body" className="text-sm leading-6 text-text-secondary">
            {t(current.body)}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border bg-bg-secondary px-5 py-3">
          <button
            type="button"
            onClick={finish}
            className="rounded px-2 py-1 text-xs text-text-muted transition hover:bg-bg-tertiary hover:text-text-primary"
          >
            {t("onboarding.skip")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setStep((currentStep) => Math.max(0, currentStep - 1))}
              disabled={step === 0}
              className="rounded border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("common.prev")}
            </button>
            <button
              ref={nextRef}
              type="button"
              onClick={() => (last ? finish() : setStep((currentStep) => currentStep + 1))}
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:bg-accent-hover"
            >
              {last ? t("onboarding.start") : t("common.next")}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}
