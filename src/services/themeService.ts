/**
 * ArchivistPro — Tema Servisi (Dark/Light + Accent Color)
 */

export type Theme = 'dark' | 'light';
export type AccentColor = 'default' | 'amber' | 'lime' | 'teal';

const STORAGE_KEY = 'archivist_theme';
const ACCENT_STORAGE_KEY = 'archivist_accent_color';

export function getTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'dark';
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'dark';
}

export function setTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(STORAGE_KEY, theme);
}

export function toggleTheme(): Theme {
  const current = getTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

export function getAccentColor(): AccentColor {
  if (typeof localStorage === 'undefined') return 'default';
  return (localStorage.getItem(ACCENT_STORAGE_KEY) as AccentColor) || 'default';
}

export function setAccentColor(color: AccentColor): void {
  if (color === 'default') {
    document.documentElement.removeAttribute('data-accent');
  } else {
    document.documentElement.setAttribute('data-accent', color);
  }
  localStorage.setItem(ACCENT_STORAGE_KEY, color);
}

/** Uygulama başlangıcında kaydedilmiş temayı uygula */
export function initTheme(): void {
  setTheme(getTheme());
  setAccentColor(getAccentColor());
}
