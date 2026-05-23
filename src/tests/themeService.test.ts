import { describe, it, expect, beforeEach } from 'vitest';
import { getTheme, setTheme, toggleTheme, initTheme } from '../services/themeService';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('varsayılan tema dark', () => {
    expect(getTheme()).toBe('dark');
  });

  it('setTheme temayı kaydeder ve DOM\'a uygular', () => {
    setTheme('light');
    expect(localStorage.getItem('archivist_theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('getTheme kaydedilmiş temayı okur', () => {
    localStorage.setItem('archivist_theme', 'light');
    expect(getTheme()).toBe('light');
  });

  it('toggleTheme dark→light geçer', () => {
    setTheme('dark');
    const result = toggleTheme();
    expect(result).toBe('light');
    expect(getTheme()).toBe('light');
  });

  it('toggleTheme light→dark geçer', () => {
    setTheme('light');
    const result = toggleTheme();
    expect(result).toBe('dark');
    expect(getTheme()).toBe('dark');
  });

  it('initTheme kaydedilmiş temayı uygular', () => {
    localStorage.setItem('archivist_theme', 'light');
    initTheme();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
