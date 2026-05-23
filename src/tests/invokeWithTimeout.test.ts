/**
 * invokeWithTimeout.ts için testler
 * Tauri invoke çağrısı zaman aşımı davranışı
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Tauri core modülünü mock'la
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invokeWithTimeout } from '../utils/invokeWithTimeout';
import { invoke } from '@tauri-apps/api/core';

describe('invokeWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('başarılı invoke sonucunu döner', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce('test-result');

    const promise = invokeWithTimeout<string>('test_cmd', { arg: 1 }, 5000);
    vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('test-result');
    expect(mockInvoke).toHaveBeenCalledWith('test_cmd', { arg: 1 });
  });

  it('invoke hata fırlatırsa hata iletilir', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockRejectedValueOnce(new Error('backend error'));

    await expect(
      invokeWithTimeout('failing_cmd', {}, 5000)
    ).rejects.toThrow('backend error');
  });

  it('zaman aşımı gerçekleştiğinde Türkçe mesajla hata fırlatır', async () => {
    const mockInvoke = vi.mocked(invoke);
    // Hiç resolve olmayan promise simüle et
    mockInvoke.mockReturnValueOnce(new Promise(() => {}));

    const promise = invokeWithTimeout('slow_cmd', {}, 100);

    // Zamanlayıcıyı 100ms ilerlet
    vi.advanceTimersByTime(200);

    await expect(promise).rejects.toThrow('100ms sonra zaman aşımına uğradı');
  });

  it('zaman aşımı mesajı komut adını içerir', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockReturnValueOnce(new Promise(() => {}));

    const promise = invokeWithTimeout('my_special_command', {}, 50);
    vi.advanceTimersByTime(200);

    await expect(promise).rejects.toThrow("my_special_command");
  });

  it('invoke timeout süresi dolmadan tamamlanırsa başarılı döner', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce(42);

    const promise = invokeWithTimeout<number>('fast_cmd', {}, 1000);
    vi.advanceTimersByTime(100); // Timeout'tan önce

    const result = await promise;
    expect(result).toBe(42);
  });

  it('farklı tip sonuçları destekler', async () => {
    const mockInvoke = vi.mocked(invoke);
    const expected = { id: 1, name: 'test', data: [1, 2, 3] };
    mockInvoke.mockResolvedValueOnce(expected);

    const result = await invokeWithTimeout<typeof expected>('object_cmd', {}, 5000);
    expect(result).toEqual(expected);
  });

  it('boş args ile çalışır', async () => {
    const mockInvoke = vi.mocked(invoke);
    mockInvoke.mockResolvedValueOnce(null);

    const result = await invokeWithTimeout('no_args_cmd', {}, 5000);
    expect(result).toBeNull();
  });
});
