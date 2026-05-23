import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHybridFilteredAssets } from '../hooks/useHybridFilteredAssets';
import { useStore } from '../store/useStore';
import type { Asset } from '../types';

// Minimal test asset factory
function makeAsset(id: string, overrides: Partial<Asset> = {}): Asset {
  return {
    id,
    fileName: `${id}.dwg`,
    filePath: `/test/${id}.dwg`,
    type: 'DWG',
    fileSize: 1000,
    category: '2D Çizim',
    tags: [],
    isIndexed: false,
    ...overrides,
  } as Asset;
}

describe('useHybridFilteredAssets', () => {
  beforeEach(() => {
    useStore.setState({
      searchQuery: '',
      activeFilters: {},
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 0.5,
      selectedAssetId: null,
    });
  });

  it('boş asset listesi → boş sonuçlar', () => {
    const { result } = renderHook(() =>
      useHybridFilteredAssets({
        allAssets: [],
        scanProgress: null,
        isVisualVectorQuery: false,
      })
    );

    expect(result.current.filteredAssets).toEqual([]);
    expect(result.current.selectedAsset).toBeNull();
  });

  it('selectedAssetId eşleşirse selectedAsset döner', () => {
    const assets = [makeAsset('a1'), makeAsset('a2')];
    useStore.setState({ selectedAssetId: 'a2' });

    const { result } = renderHook(() =>
      useHybridFilteredAssets({
        allAssets: assets,
        scanProgress: null,
        isVisualVectorQuery: false,
      })
    );

    expect(result.current.selectedAsset).not.toBeNull();
    expect(result.current.selectedAsset!.id).toBe('a2');
  });

  it('indexingStatus — scan yokken idle', () => {
    const assets = [makeAsset('a1', { isIndexed: true }), makeAsset('a2')];

    const { result } = renderHook(() =>
      useHybridFilteredAssets({
        allAssets: assets,
        scanProgress: null,
        isVisualVectorQuery: false,
      })
    );

    expect(result.current.indexingStatus.isRunning).toBe(false);
    expect(result.current.indexingStatus.totalFiles).toBe(2);
    expect(result.current.indexingStatus.indexedFiles).toBe(1);
  });

  it('indexingStatus — scan sırasında running', () => {
    const { result } = renderHook(() =>
      useHybridFilteredAssets({
        allAssets: [],
        scanProgress: {
          total: 100,
          processed: 40,
          current: 'plan.dwg',
          isComplete: false,
          errors: ['err1'],
          typeCounts: {},
        },
        isVisualVectorQuery: false,
      })
    );

    expect(result.current.indexingStatus.isRunning).toBe(true);
    expect(result.current.indexingStatus.totalFiles).toBe(100);
    expect(result.current.indexingStatus.indexedFiles).toBe(40);
    expect(result.current.indexingStatus.currentFile).toBe('plan.dwg');
    expect(result.current.indexingStatus.errors).toBe(1);
  });

  it('indexingStatus — scan tamamlanınca idle', () => {
    const assets = [makeAsset('a1', { isIndexed: true })];

    const { result } = renderHook(() =>
      useHybridFilteredAssets({
        allAssets: assets,
        scanProgress: {
          total: 1,
          processed: 1,
          current: '',
          isComplete: true,
          errors: [],
          typeCounts: {},
        },
        isVisualVectorQuery: false,
      })
    );

    expect(result.current.indexingStatus.isRunning).toBe(false);
  });
});
