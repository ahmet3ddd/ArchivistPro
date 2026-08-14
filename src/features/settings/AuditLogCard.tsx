// Denetim Gunlugu karti (#8) — Ayarlar modali icindeki admin kart (AiModelsCard/backup deseni).
// Kendisi veri cekmez: kisa bir aciklama + "Denetim gunlugunu ac" dugmesi. Dugme ebeveyni (TopBar)
// tetikler → Ayarlar kapanir, tam-genis AuditLogPanel (sayfali tablo) acilir (backup.manage → onOpenBackup
// paritesi). Yalniz admin: SettingsModal `isAdmin` ile kosullu render eder (gercek gate backend'de).

import { useTranslation } from "react-i18next";

interface Props {
  /** "Denetim gunlugunu ac" → ebeveyn (TopBar) Ayarlar'i kapatip AuditLogPanel'i acar. */
  onOpen: () => void;
}

export function AuditLogCard({ onOpen }: Props) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("audit.title")}
      </h3>
      <p className="text-xs text-text-muted">{t("audit.hint")}</p>
      <button
        type="button"
        onClick={onOpen}
        className="self-start rounded-md border border-border px-3 py-1 text-xs text-text-secondary
                   transition hover:bg-bg-tertiary hover:border-border-hover focus:border-accent
                   focus:outline-none motion-reduce:transition-none"
      >
        {t("audit.open")}
      </button>
    </section>
  );
}
