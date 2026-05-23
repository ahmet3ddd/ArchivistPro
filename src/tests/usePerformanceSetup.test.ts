import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mock hardwareDetect servisi
vi.mock('../services/hardwareDetect', () => ({
  detectHardware: vi.fn(() => ({
    cpuCores: 8,
    ramGB: 16,
    gpuName: 'NVIDIA RTX 3060',
    tier: 'high' as const,
  })),
  saveHardwareProfile: vi.fn(),
  hasSeenPerformanceSetup: vi.fn(() => false),
  markPerformanceSetupSeen: vi.fn(),
  getTierRecommendation: vi.fn((tier: string) => ({
    imageSearchProvider: tier === 'low' ? 'none' : 'ollama',
    ollamaModel: 'llava:7b',
    embeddingModel: 'nomic-embed-text',
  })),
}));

vi.mock('../services/systemCheck', () => ({
  hasSeenSetupWizard: vi.fn(() => false),
}));

// Store mock — hafif
vi.mock('../store/useStore', async () => {
  const { create } = await import('zustand');
  const store = create(() => ({
    setAiConfig: vi.fn(),
  }));
  return { useStore: store };
});

import { usePerformanceSetup } from '../hooks/usePerformanceSetup';
import { hasSeenPerformanceSetup, markPerformanceSetupSeen } from '../services/hardwareDetect';

describe('usePerformanceSetup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ilk kez çalıştığında hardware profil algılar ve setup gösterir', () => {
    const { result } = renderHook(() => usePerformanceSetup());

    expect(result.current.hwProfile).not.toBeNull();
    expect(result.current.hwProfile!.cpuCores).toBe(8);
    expect(result.current.showPerfSetup).toBe(true);
  });

  it('daha önce görüldüyse setup göstermez', () => {
    vi.mocked(hasSeenPerformanceSetup).mockReturnValue(true);

    const { result } = renderHook(() => usePerformanceSetup());

    expect(result.current.showPerfSetup).toBe(false);
    expect(result.current.hwProfile).toBeNull();
  });

  it('handleSkipPerfSetup setup kapatır ve markPerformanceSetupSeen çağırır', () => {
    vi.mocked(hasSeenPerformanceSetup).mockReturnValue(false);
    const { result } = renderHook(() => usePerformanceSetup());

    act(() => {
      result.current.handleSkipPerfSetup();
    });

    expect(result.current.showPerfSetup).toBe(false);
    expect(markPerformanceSetupSeen).toHaveBeenCalled();
  });

  it('handleRetestHardware profili yeniden algılar', async () => {
    const { result } = renderHook(() => usePerformanceSetup());

    act(() => {
      result.current.handleRetestHardware();
    });

    // detectHardware 2 kez çağrılmış olmalı (mount + retest)
    const { detectHardware } = await import('../services/hardwareDetect');
    expect(detectHardware).toHaveBeenCalledTimes(2);
  });
});
