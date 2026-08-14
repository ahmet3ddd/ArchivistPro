// Tema kurulumu (Faz 8.3) — acik/koyu + vurgu (accent) semasi.
//
// i18n/index.ts dil-init deseninin esi: secim localStorage'da kalici; render
// ONCESI <html data-theme / data-accent> erkenden uygulanir (FOUC yok). Bilesenler
// CSS token'larini okur (src/index.css), tema degisince anlik (reload yok) yansir.
//
// Varsayilan: koyu (dark) + indigo. Indigo, :root'taki varsayilan oldugu icin
// data-accent="indigo" yine de yazilir (acik tutarlilik + degisim izlenebilirligi).

export const THEMES = ["dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

export const ACCENTS = ["indigo", "amber", "lime", "teal"] as const;
export type Accent = (typeof ACCENTS)[number];

const THEME_KEY = "archivist_theme";
const ACCENT_KEY = "archivist_accent";

const DEFAULT_THEME: Theme = "dark";
const DEFAULT_ACCENT: Accent = "indigo";

function readStored<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const saved = localStorage.getItem(key);
    if (saved && (allowed as readonly string[]).includes(saved)) {
      return saved as T;
    }
  } catch {
    // localStorage erisilemez → varsayilana dus.
  }
  return fallback;
}

/** Kayitli (ya da varsayilan) tema. */
export function initialTheme(): Theme {
  return readStored(THEME_KEY, THEMES, DEFAULT_THEME);
}

/** Kayitli (ya da varsayilan) vurgu semasi. */
export function initialAccent(): Accent {
  return readStored(ACCENT_KEY, ACCENTS, DEFAULT_ACCENT);
}

/** <html data-theme> ata + secimi kalici yap. CSS token'lari bunu okur. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // kalicilik kritik degil — sessizce gec.
  }
}

/** <html data-accent> ata + secimi kalici yap. CSS accent token'larini okur. */
export function applyAccent(accent: Accent): void {
  document.documentElement.dataset.accent = accent;
  try {
    localStorage.setItem(ACCENT_KEY, accent);
  } catch {
    // kalicilik kritik degil — sessizce gec.
  }
}

// Render ONCESI ilk uygula (i18n applyDocumentLang deseni). main.tsx bu modulu
// index.css'ten once import eder → <html> dataset render basinda dogru.
applyTheme(initialTheme());
applyAccent(initialAccent());
