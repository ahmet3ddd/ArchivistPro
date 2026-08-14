// Tema kontrolleri (Faz 8.3) — acik/koyu gecisi + vurgu (accent) secici.
//
// H2'nin opsiyonel tema ekstralarinin UI'i. Sol: gunes/ay rozet butonu (tek tikla
// dark↔light). Sag: 4 kucuk renk ornegi (indigo/amber/lime/teal); aktif olan
// halkali (ring). Secim anlik uygulanir + kalici (useUiStore → src/theme →
// localStorage + <html data-theme/data-accent>). Yeni bagimlilik yok — TopBar'in
// mevcut Unicode-glif deseni (↶/↷/⚙) izlenir.

import { useTranslation } from "react-i18next";

import { ACCENTS, type Accent } from "../../theme";
import { useUiStore } from "../../store/useUiStore";

// Her semanin ornek (swatch) rengi — tanima icin sabit (koyu-tema temsil hue'su).
// CSS token'i degil: bu yalniz dugmedeki gorsel ipucu (hangi sema oldugunu gosterir).
const ACCENT_SWATCH: Record<Accent, string> = {
  indigo: "#6366f1",
  amber: "#ffa000",
  lime: "#98e504",
  teal: "#0accb3",
};

export function ThemeControls() {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const accent = useUiStore((s) => s.accent);
  const setTheme = useUiStore((s) => s.setTheme);
  const setAccent = useUiStore((s) => s.setAccent);

  const isLight = theme === "light";
  // Tikladiginda DIGER temaya gec; etiket/ipucu hedef temayi anlatir.
  const nextThemeLabel = isLight ? t("theme.dark") : t("theme.light");

  return (
    <div className="flex items-center gap-2">
      {/* Acik/koyu gecis — gunes (light) / ay (dark) glifi */}
      <button
        type="button"
        onClick={() => setTheme(isLight ? "dark" : "light")}
        aria-label={nextThemeLabel}
        title={nextThemeLabel}
        className="flex h-7 w-7 items-center justify-center rounded border border-border
                   text-sm text-text-secondary transition hover:border-border-hover
                   hover:text-text-primary focus:border-accent focus:outline-none"
      >
        <span aria-hidden>{isLight ? "☀" : "☾"}</span>
      </button>

      {/* Vurgu (accent) secici — 4 renk ornegi; aktif olan halkali */}
      <div
        className="flex items-center gap-1.5"
        role="radiogroup"
        aria-label={t("theme.accent")}
      >
        {ACCENTS.map((a) => {
          const active = a === accent;
          return (
            <button
              key={a}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setAccent(a)}
              aria-label={t(`theme.accent_${a}`)}
              title={t(`theme.accent_${a}`)}
              className={`h-4 w-4 rounded-full border border-border transition
                          focus:outline-none ${
                            active
                              ? "ring-2 ring-accent ring-offset-1 ring-offset-bg-secondary"
                              : "hover:scale-110"
                          }`}
              style={{ backgroundColor: ACCENT_SWATCH[a] }}
            />
          );
        })}
      </div>
    </div>
  );
}
