import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getHelpSection,
  getAllHelpSections,
  getGuideFilePath,
  getGuidePath,
  fetchGuide,
  fetchChangelog,
  getSupportedLanguages,
  setHelpLanguage,
  getHelpLanguage,
} from '../services/helpSystem';

describe('HelpSystem', () => {
  beforeEach(() => {
    setHelpLanguage('tr');
  });

  it('getHelpSection explorer bölümü döner', () => {
    const section = getHelpSection('explorer');
    expect(section.id).toBe('explorer');
    expect(section.title).toBeDefined();
    expect(section.anchor).toBeDefined();
  });

  it('getHelpSection bilinmeyen context main döner', () => {
    const section = getHelpSection('nonexistent' as any);
    expect(section.id).toBe('main');
  });

  it('getAllHelpSections tüm bölümleri listeler', () => {
    const sections = getAllHelpSections();
    expect(sections.length).toBeGreaterThan(5);
    expect(sections.some(s => s.id === 'explorer')).toBe(true);
    expect(sections.some(s => s.id === 'tags')).toBe(true);
  });

  it('getGuideFilePath admin kılavuzu yolu', () => {
    const path = getGuideFilePath(true);
    expect(path).toContain('admin-guide.md');
    expect(path).toContain('tr');
  });

  it('getGuideFilePath kullanıcı kılavuzu yolu', () => {
    const path = getGuideFilePath(false);
    expect(path).toContain('user-guide.md');
  });

  it('dil değişikliği kılavuz yolunu etkiler', () => {
    setHelpLanguage('en');
    expect(getGuideFilePath(true)).toContain('en/admin-guide.md');
    expect(getHelpLanguage()).toBe('en');
  });

  it('getSupportedLanguages desteklenen dilleri listeler', () => {
    const langs = getSupportedLanguages();
    expect(langs.length).toBeGreaterThanOrEqual(2);
    expect(langs.some(l => l.code === 'tr')).toBe(true);
    expect(langs.some(l => l.code === 'en')).toBe(true);
  });
});

describe('HelpSystem — locale fallback', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    setHelpLanguage('tr');
  });

  it('getGuidePath: TR\'de scenarios → kullanim-senaryolari.md', () => {
    setHelpLanguage('tr');
    expect(getGuidePath('scenarios')).toBe('docs/tr/kullanim-senaryolari.md');
  });

  it('getGuidePath: EN dışı dillerde scenarios → scenarios.md', () => {
    setHelpLanguage('en');
    expect(getGuidePath('scenarios')).toBe('docs/en/scenarios.md');
    setHelpLanguage('zh');
    expect(getGuidePath('scenarios')).toBe('docs/zh/scenarios.md');
  });

  it('fetchGuide: istenen dil 404 ise EN fallback', async () => {
    setHelpLanguage('zh');
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/zh/')) return new Response(null, { status: 404 });
      if (url.includes('/en/')) return new Response('# user guide en', { status: 200 });
      return new Response(null, { status: 404 });
    }) as typeof global.fetch;

    const result = await fetchGuide('user');
    expect(result.locale).toBe('en');
    expect(result.markdown).toContain('en');
  });

  it('fetchGuide: EN de yoksa TR fallback', async () => {
    setHelpLanguage('ja');
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/tr/')) return new Response('# user guide tr', { status: 200 });
      return new Response(null, { status: 404 });
    }) as typeof global.fetch;

    const result = await fetchGuide('user');
    expect(result.locale).toBe('tr');
  });

  it('fetchGuide: hiçbir dilde dosya yoksa hata fırlatır', async () => {
    setHelpLanguage('ar');
    global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof global.fetch;
    await expect(fetchGuide('user')).rejects.toThrow();
  });

  it('fetchGuide: scenarios EN için scenarios.md ister, TR için kullanim-senaryolari.md', async () => {
    setHelpLanguage('en');
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/en/scenarios.md')) return new Response('# en scenarios', { status: 200 });
      return new Response(null, { status: 404 });
    }) as typeof global.fetch;

    const result = await fetchGuide('scenarios');
    expect(result.locale).toBe('en');
    expect(calls.some(u => u.includes('/en/scenarios.md'))).toBe(true);
  });

  it('fetchChangelog: docs/CHANGELOG.md fetch eder (dilsiz tek dosya)', async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes('/docs/CHANGELOG.md')) {
        return new Response('# Changelog\n\n## [3.0.0]', { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof global.fetch;

    const result = await fetchChangelog();
    expect(result.markdown).toContain('Changelog');
    expect(result.markdown).toContain('3.0.0');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/docs/CHANGELOG.md');
    // Dil ayrımı yok — sadece tek istek
    expect(calls.some(u => u.includes('/tr/') || u.includes('/en/'))).toBe(false);
  });

  it('fetchChangelog: 404 ise hata fırlatır', async () => {
    global.fetch = vi.fn(async () => new Response(null, { status: 404 })) as typeof global.fetch;
    await expect(fetchChangelog()).rejects.toThrow(/HTTP 404/);
  });
});
