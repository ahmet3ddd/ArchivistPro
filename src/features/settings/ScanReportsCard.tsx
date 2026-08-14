// Tarama raporlari karti (P2.5 ④) — Ayarlar modali icindeki admin kart (CrashLogCard deseni birebir).
// Kendisi veri cekmez: kisa aciklama + "Tarama raporlarini ac" dugmesi → ebeveyn (TopBar) tetikler,
// Ayarlar kapanir, tam-genis ScanReportsPanel acilir. Yalniz admin: SettingsModal `isAdmin` ile kosullu.

import { useTranslation } from "react-i18next";

interface Props {
  /** "Tarama raporlarini ac" → ebeveyn (TopBar) Ayarlar'i kapatip ScanReportsPanel'i acar. */
  onOpen: () => void;
}

export function ScanReportsCard({ onOpen }: Props) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("scanReport.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("scanReport.hint")}</p>
      <button
        type="button"
        onClick={onOpen}
        className="self-start rounded-md border border-border px-3 py-1 text-xs text-text-secondary
                   transition hover:bg-bg-tertiary hover:border-border-hover focus:border-accent
                   focus:outline-none motion-reduce:transition-none"
      >
        {t("scanReport.open")}
      </button>
    </section>
  );
}
