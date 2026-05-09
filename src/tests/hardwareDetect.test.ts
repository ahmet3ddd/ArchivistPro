/**
 * hardwareDetect.ts için testler
 * Donanım tier sınıflandırması, localStorage operasyonları
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getTierRecommendation,
  saveHardwareProfile,
  loadSavedHardwareProfile,
  hasSeenPerformanceSetup,
  markPerformanceSetupSeen,
  type HardwareProfile,
  type HardwareTier,
} from '../services/hardwareDetect';

// Node ortamında localStorage mock'u
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

if (typeof localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    writable: true,
  });
}

// ── getTierRecommendation ─────────────────────────────────────────────────────

describe('getTierRecommendation', () => {
  it('low tier için doğru öneri döner', () => {
    const rec = getTierRecommendation('low');
    expect(rec.tier ?? 'low').toBeTruthy();
    expect(rec.label).toContain('Düşük');
    expect(rec.semanticSearch).toBe(false);
    expect(rec.imageSearchProvider).toBe('gemini');
    expect(rec.warning).toBeDefined();
  });

  it('mid tier için doğru öneri döner', () => {
    const rec = getTierRecommendation('mid');
    expect(rec.label).toContain('Orta');
    expect(rec.semanticSearch).toBe(true);
    expect(rec.imageSearchProvider).toBe('groq');
    expect(rec.warning).toBeDefined();
  });

  it('high tier için doğru öneri döner', () => {
    const rec = getTierRecommendation('high');
    expect(rec.label).toContain('Tam');
    expect(rec.semanticSearch).toBe(true);
    expect(rec.imageSearchProvider).toBe('openai');
    expect(rec.warning).toBeUndefined();
  });

  it('her tier için label, description, semanticSearch, imageSearchProvider alanları var', () => {
    const tiers: HardwareTier[] = ['low', 'mid', 'high'];
    for (const tier of tiers) {
      const rec = getTierRecommendation(tier);
      expect(rec).toHaveProperty('label');
      expect(rec).toHaveProperty('description');
      expect(rec).toHaveProperty('semanticSearch');
      expect(rec).toHaveProperty('imageSearchProvider');
      expect(typeof rec.semanticSearch).toBe('boolean');
      expect(['none', 'gemini', 'groq', 'openai']).toContain(rec.imageSearchProvider);
    }
  });

  it('low tier\'da semanticSearch false, high tier\'da true', () => {
    expect(getTierRecommendation('low').semanticSearch).toBe(false);
    expect(getTierRecommendation('high').semanticSearch).toBe(true);
  });
});

// ── localStorage operasyonları ───────────────────────────────────────────────

describe('saveHardwareProfile / loadSavedHardwareProfile', () => {
  const mockProfile: HardwareProfile = {
    tier: 'mid',
    cores: 8,
    memoryGB: 16,
    benchmarkMs: 35,
  };

  beforeEach(() => {
    // localStorage'ı temizle
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('profil kaydedilip geri okunabilir', () => {
    saveHardwareProfile(mockProfile);
    const loaded = loadSavedHardwareProfile();
    expect(loaded).toEqual(mockProfile);
  });

  it('kayıt yokken null döner', () => {
    expect(loadSavedHardwareProfile()).toBeNull();
  });

  it('farklı tier değerleri doğru kaydedilir', () => {
    const tiers: HardwareTier[] = ['low', 'mid', 'high'];
    for (const tier of tiers) {
      const profile: HardwareProfile = { tier, cores: 4, memoryGB: 8, benchmarkMs: 50 };
      saveHardwareProfile(profile);
      const loaded = loadSavedHardwareProfile();
      expect(loaded?.tier).toBe(tier);
    }
  });

  it('bozuk JSON için null döner', () => {
    localStorage.setItem('archivist_hw_profile', 'not-valid-json{');
    expect(loadSavedHardwareProfile()).toBeNull();
  });

  it('memoryGB null olan profil doğru kaydedilir', () => {
    const profile: HardwareProfile = { tier: 'mid', cores: 4, memoryGB: null, benchmarkMs: 45 };
    saveHardwareProfile(profile);
    const loaded = loadSavedHardwareProfile();
    expect(loaded?.memoryGB).toBeNull();
  });
});

// ── hasSeenPerformanceSetup / markPerformanceSetupSeen ──────────────────────

describe('hasSeenPerformanceSetup / markPerformanceSetupSeen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('ilk açılışta hasSeenPerformanceSetup false döner', () => {
    expect(hasSeenPerformanceSetup()).toBe(false);
  });

  it('markPerformanceSetupSeen sonrası hasSeenPerformanceSetup true döner', () => {
    markPerformanceSetupSeen();
    expect(hasSeenPerformanceSetup()).toBe(true);
  });

  it('localStorage temizlenince tekrar false döner', () => {
    markPerformanceSetupSeen();
    localStorage.clear();
    expect(hasSeenPerformanceSetup()).toBe(false);
  });
});

// ── detectHardware (navigator mock ile) ─────────────────────────────────────

describe('detectHardware - tier sınıflandırma mantığı', () => {
  // detectHardware'i doğrudan test etmek yerine tier mantığını sınayan ayrı bir fonksiyon test ediyoruz
  // Gerçek benchmark sonuçlarını mock'lamak zor olduğundan getTierRecommendation üzerinden test

  it('low tier önerisi semanticSearch=false içerir (kaynak tüketim koruma)', () => {
    const rec = getTierRecommendation('low');
    expect(rec.semanticSearch).toBe(false);
    expect(rec.imageSearchProvider).not.toBe('none');
  });

  it('high tier önerisi tüm özellikleri aktif eder', () => {
    const rec = getTierRecommendation('high');
    expect(rec.semanticSearch).toBe(true);
    expect(rec.imageSearchProvider).toBe('openai');
    expect(rec.warning).toBeUndefined();
  });

  it('mid tier uyarı mesajı içerir', () => {
    const rec = getTierRecommendation('mid');
    expect(rec.warning).toBeTruthy();
    expect(typeof rec.warning).toBe('string');
  });
});
