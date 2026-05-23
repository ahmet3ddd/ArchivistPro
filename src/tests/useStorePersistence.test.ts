import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStorePersistence } from '../hooks/useStorePersistence';
import { useStore } from '../store/useStore';

// Zustand store direkt kullanılabilir, mock gerekmez

describe('useStorePersistence — localStorage senkronizasyonu', () => {
  beforeEach(() => {
    localStorage.clear();
    // Store'u varsayılan değerlere ayarla
    useStore.setState({
      facetConfig: [],
      aiConfig: { apiProvider: 'ollama', apiKey: 'SECRET_KEY', apiUrl: 'http://localhost:11434', enableClipVision: false, visionModel: '', embeddingModel: '' },
      searchSensitivity: 0.5,
      cardSize: 220,
    });
  });

  it('facetConfig localStorage a kaydedilir', () => {
    renderHook(() => useStorePersistence());

    const saved = localStorage.getItem('archivist_facet_config');
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!)).toEqual([]);
  });

  it('aiConfig kaydedilirken apiKey hariç tutulur', () => {
    renderHook(() => useStorePersistence());

    const saved = localStorage.getItem('archivist_ai_config');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed.apiKey).toBeUndefined();
    expect(parsed.apiProvider).toBe('ollama');
    expect(parsed.apiUrl).toBe('http://localhost:11434');
  });

  it('searchSensitivity string olarak kaydedilir', () => {
    renderHook(() => useStorePersistence());

    const saved = localStorage.getItem('archivist_search_sensitivity');
    expect(saved).toBe('0.5');
  });

  it('cardSize string olarak kaydedilir', () => {
    renderHook(() => useStorePersistence());

    const saved = localStorage.getItem('cardSize');
    expect(saved).toBe('220');
  });

  it('store değişince localStorage güncellenir', () => {
    renderHook(() => useStorePersistence());

    // Store'u güncelle
    useStore.setState({ cardSize: 300 });

    // Re-render gerekli (Zustand reactivity renderHook içinde çalışır)
    renderHook(() => useStorePersistence());

    expect(localStorage.getItem('cardSize')).toBe('300');
  });
});
