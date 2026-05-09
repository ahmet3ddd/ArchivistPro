import { describe, it, expect } from 'vitest';
import { APP_NAME, APP_VERSION, APP_BUILD_DATE, APP_DESCRIPTION } from '../appVersion';

describe('appVersion', () => {
  it('APP_NAME tanımlı ve boş değil', () => {
    expect(APP_NAME).toBe('ArchivistPro');
  });

  it('APP_VERSION semver formatında', () => {
    // semver: major.minor.patch[-prerelease]
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });

  it('APP_BUILD_DATE ISO tarih formatında', () => {
    // YYYY-MM-DD
    expect(APP_BUILD_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(APP_BUILD_DATE);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('APP_DESCRIPTION boş değil', () => {
    expect(APP_DESCRIPTION.length).toBeGreaterThan(5);
  });

  it('tüm export değerleri string', () => {
    expect(typeof APP_NAME).toBe('string');
    expect(typeof APP_VERSION).toBe('string');
    expect(typeof APP_BUILD_DATE).toBe('string');
    expect(typeof APP_DESCRIPTION).toBe('string');
  });
});
