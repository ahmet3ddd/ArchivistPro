// Ayarlar → Genel → "Oturum kilidi" karti (H2 Ayarlar→Guvenlik satirinin karsiligi).
//
// NEDEN VAR: bkz `securitySettings.ts` basligi. H2'de bu ayar Guvenlik sekmesindeydi
// (`SettingsSecurityTab.tsx:152-158`, 5/15/30/60/120 dk + "asla"); H3'te Guvenlik sekmesi
// olmadigi icin Genel'e konuldu — yeni sekme acmak yerine mevcut yapiya oturtuldu.
//
// Makine-YEREL tercih (localStorage) → paylasimli ofis makinesi ile tek-kullanici makinesi
// farkli deger tutabilir; ODA/tarama ayarlariyla ayni desen.

import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  getSessionTimeoutMin,
  SESSION_TIMEOUT_PRESETS,
  setSessionTimeoutMin,
} from "./securitySettings";

export function SessionLockCard() {
  const { t } = useTranslation();
  const [minutes, setMinutes] = useState(() => getSessionTimeoutMin());

  const onChange = (value: number) => {
    setMinutes(value);
    setSessionTimeoutMin(value);
  };

  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-secondary p-3">
      <h3 className="font-display text-xs font-semibold uppercase tracking-wide text-text-secondary">
        {t("settings.session_lock")}
      </h3>
      <p className="text-xs text-text-muted">{t("settings.session_lock_hint")}</p>
      <select
        value={minutes}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        aria-label={t("settings.session_lock")}
        className="w-fit rounded-md border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
      >
        {SESSION_TIMEOUT_PRESETS.map((m) => (
          <option key={m} value={m}>
            {m === 0 ? t("settings.session_lock_never") : t("settings.session_lock_minutes", { count: m })}
          </option>
        ))}
      </select>
    </section>
  );
}
