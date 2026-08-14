// Dil secici — i18next dilini degistirir. Secim kalici (localStorage) + RTL otomatik
// (i18n/index.ts languageChanged dinleyicisi <html> dir/lang'i gunceller).

import { useTranslation } from "react-i18next";

import { SUPPORTED_LANGS } from "../../i18n";

export function LanguageSelect() {
  const { t, i18n } = useTranslation();

  return (
    <label className="flex items-center gap-1.5 text-xs text-text-secondary">
      <span className="hidden sm:inline">{t("lang.label")}</span>
      <select
        value={i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
        aria-label={t("lang.label")}
        className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-text-primary
                   transition focus:border-accent focus:outline-none"
      >
        {SUPPORTED_LANGS.map((l) => (
          <option key={l} value={l}>
            {t(`lang.${l}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
