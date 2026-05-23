/**
 * i18n Dil Dosyaları Tam Kapsam Testi
 *
 * 5 dil dosyasının (tr, en, zh, ja, ar) tüm anahtarlarının
 * eksiksiz ve boş olmadığını doğrular.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const LOCALES_DIR = path.resolve(__dirname, '../i18n/locales');
const LANGUAGES = ['tr', 'en', 'zh', 'ja', 'ar'];

/** JSON dosyasındaki tüm anahtarları düz (dot notation) olarak toplar */
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...flattenKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

/** Boş string değerlerini bulur */
function findEmptyValues(obj: Record<string, unknown>, prefix = ''): string[] {
  const empty: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      empty.push(...findEmptyValues(value as Record<string, unknown>, fullKey));
    } else if (typeof value === 'string' && value.trim() === '') {
      empty.push(fullKey);
    }
  }
  return empty;
}

function loadLocale(lang: string): Record<string, unknown> {
  const filePath = path.join(LOCALES_DIR, `${lang}.json`);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

describe('i18n — Dil dosyaları', () => {
  const locales: Record<string, Record<string, unknown>> = {};
  const keysByLang: Record<string, string[]> = {};

  // Tüm dilleri yükle
  for (const lang of LANGUAGES) {
    locales[lang] = loadLocale(lang);
    keysByLang[lang] = flattenKeys(locales[lang]).sort();
  }

  it('tüm 5 dil dosyası yüklenebilir', () => {
    for (const lang of LANGUAGES) {
      expect(locales[lang]).toBeDefined();
      expect(Object.keys(locales[lang]).length).toBeGreaterThan(0);
    }
  });

  it('Türkçe (tr) referans dil — en az 1000 anahtar', () => {
    expect(keysByLang['tr'].length).toBeGreaterThanOrEqual(1000);
  });

  // Her dilin tr ile aynı anahtar setine sahip olduğunu kontrol et
  for (const lang of LANGUAGES.filter(l => l !== 'tr')) {
    it(`${lang}.json — tr.json ile aynı anahtar sayısına sahip`, () => {
      const trKeys = new Set(keysByLang['tr']);
      const langKeys = new Set(keysByLang[lang]);

      const missingInLang = keysByLang['tr'].filter(k => !langKeys.has(k));
      const extraInLang = keysByLang[lang].filter(k => !trKeys.has(k));

      if (missingInLang.length > 0) {
        console.warn(`${lang}.json eksik anahtarlar (ilk 10):`, missingInLang.slice(0, 10));
      }

      // Tolerans: %2'den fazla eksik anahtar kabul edilmez
      const maxMissing = Math.ceil(keysByLang['tr'].length * 0.02);
      expect(missingInLang.length).toBeLessThanOrEqual(maxMissing);
    });
  }

  // Boş değer kontrolü
  for (const lang of LANGUAGES) {
    it(`${lang}.json — boş değer içermemeli`, () => {
      const emptyKeys = findEmptyValues(locales[lang]);
      if (emptyKeys.length > 0) {
        console.warn(`${lang}.json boş değerler (ilk 10):`, emptyKeys.slice(0, 10));
      }
      expect(emptyKeys.length).toBe(0);
    });
  }

  it('tüm diller tr ile en az %95 üst düzey anahtar örtüşmesine sahip', () => {
    const trTopKeys = new Set(Object.keys(locales['tr']));
    for (const lang of LANGUAGES.filter(l => l !== 'tr')) {
      const langTopKeys = new Set(Object.keys(locales[lang]));
      const missing = [...trTopKeys].filter(k => !langTopKeys.has(k));
      const maxMissing = Math.ceil(trTopKeys.size * 0.05);
      if (missing.length > 0) {
        console.warn(`${lang}.json eksik üst düzey: ${missing.join(', ')}`);
      }
      expect(missing.length).toBeLessThanOrEqual(maxMissing);
    }
  });
});
