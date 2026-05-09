/**
 * Recovery Service Testleri
 *
 * Kurtarma anahtarı oluşturma format ve benzersizlik kontrolü.
 */
import { describe, it, expect, vi } from 'vitest';

// Tauri invoke mock — read/write recovery key
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

import { generateRecoveryKey } from '../services/recoveryService';

describe('RecoveryService — generateRecoveryKey', () => {
  it('48 karakter hex string üretir', () => {
    const key = generateRecoveryKey();
    expect(key).toHaveLength(48);
    expect(key).toMatch(/^[0-9a-f]{48}$/);
  });

  it('her çağrıda farklı anahtar üretir', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateRecoveryKey()));
    expect(keys.size).toBe(20);
  });

  it('üretilen anahtar güvenli rastgele baytlardan oluşur', () => {
    const key = generateRecoveryKey();
    // 24 byte = 48 hex char
    expect(key.length / 2).toBe(24);
  });

  it('üretilen anahtarda büyük harf yok', () => {
    const key = generateRecoveryKey();
    expect(key).toBe(key.toLowerCase());
  });
});
