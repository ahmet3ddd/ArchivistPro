// Ayarlar → "Genel" sekmesi: gorunum (tema/vurgu) + dil. State yok (kontroller
// kendi state'ini yonetir). SettingsModal kabugu tarafindan render edilir.

import { useTranslation } from "react-i18next";

import { useAppVersion } from "../../../hooks/useAppVersion";
import { useSession } from "../../../hooks/useSession";
import { ChangePasswordCard } from "../../auth/ChangePasswordCard";
import { LanguageSelect } from "../LanguageSelect";
import { LegacyArchiveCard } from "../LegacyArchiveCard";
import { LoginLockoutCard } from "../LoginLockoutCard";
import { SessionLockCard } from "../SessionLockCard";
import { SuggestionsCard } from "../SuggestionsCard";
import { ThemeControls } from "../ThemeControls";
import { useOnboardingStore } from "../../onboarding/onboardingStore";

export function GeneralTab() {
  const { t } = useTranslation();
  const { isAdmin } = useSession();
  const openTour = useOnboardingStore((s) => s.openTour);
  const version = useAppVersion();
  return (
    <>
      {/* Gorunum: acik/koyu tema + vurgu rengi */}
      <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {t("settings.appearance")}
        </h3>
        <p className="text-xs text-text-muted">{t("settings.appearance_hint")}</p>
        <ThemeControls />
      </section>

      {/* Dil (RTL otomatik) */}
      <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {t("settings.language")}
        </h3>
        <LanguageSelect />
      </section>

      <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
        <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {t("onboarding.restart_title")}
        </h3>
        <p className="text-xs text-text-muted">{t("onboarding.restart_hint")}</p>
        <button
          type="button"
          onClick={openTour}
          className="self-start rounded-md border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:border-border-hover hover:bg-bg-tertiary"
        >
          {t("onboarding.restart")}
        </button>
      </section>

      {/* Onceki surum (H2) bu makinede duruyorsa bildir — bulunacak sey yoksa hic gorunmez. */}
      <LegacyArchiveCard />

      {/* Oturum kilidi (bostakalma suresi) — H2 Guvenlik sekmesi paritesi */}
      <SessionLockCard />

      <ChangePasswordCard />
      <SuggestionsCard />

      {/* Kaba-kuvvet kilidi arşiv-geneli güvenlik politikasıdır; yalnız admin düzenler. */}
      {isAdmin && <LoginLockoutCard />}

      {/* Surum satiri — Bakim'daki Sistem bilgisi kartinin aksine admin sarti YOK; "hangi
          surum kurulu?" herkese aciktir. Surum degeri ceviri gerektirmez (kimlik dizesi). */}
      {version != null && (
        <p className="text-center text-xs text-text-muted" dir="ltr">
          {t("app.title")} v{version}
        </p>
      )}
    </>
  );
}
