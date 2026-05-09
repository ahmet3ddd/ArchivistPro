import { useMemo } from 'react';
import type { Asset, IndexingStatus } from '../types';
import type { ScanProgress } from '../services/fileScanner';
import {
  filterAssetsHybrid,
  buildSearchScoreMap,
  collectMatchSources,
} from '../utils/searchScoring';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';

type Args = {
  allAssets: Asset[];
  scanProgress: ScanProgress | null;
  isVisualVectorQuery: boolean;
};

export function useHybridFilteredAssets({ allAssets, scanProgress, isVisualVectorQuery }: Args) {
  const { searchQuery, activeFilters, semanticResults, isImageSearching, searchSensitivity, selectedAssetId, activeRootFilters, activeTagFilters, dateRangeFilter } = useStore(useShallow((s) => ({
    searchQuery: s.searchQuery,
    activeFilters: s.activeFilters,
    semanticResults: s.semanticResults,
    isImageSearching: s.isImageSearching,
    searchSensitivity: s.searchSensitivity,
    selectedAssetId: s.selectedAssetId,
    activeRootFilters: s.activeRootFilters,
    activeTagFilters: s.activeTagFilters,
    dateRangeFilter: s.dateRangeFilter,
  })));

  const filteredAssets = useMemo(
    () =>
      filterAssetsHybrid({
        allAssets,
        activeFilters,
        searchQuery,
        semanticResults,
        isImageSearching,
        searchSensitivity,
        isVisualVectorQuery,
        activeRootFilters,
        activeTagFilters,
        dateRangeFilter,
      }),
    [
      allAssets,
      activeFilters,
      searchQuery,
      semanticResults,
      isImageSearching,
      searchSensitivity,
      isVisualVectorQuery,
      activeRootFilters,
      activeTagFilters,
      dateRangeFilter,
    ]
  );

  const selectedAsset = useMemo<Asset | null>(() => {
    return allAssets.find((a) => a.id === selectedAssetId) || null;
  }, [selectedAssetId, allAssets]);

  const matchSources = useMemo(() => {
    return collectMatchSources(selectedAsset, searchQuery, isImageSearching);
  }, [selectedAsset, searchQuery, isImageSearching]);

  const searchScoreMap = useMemo(() => {
    return buildSearchScoreMap({
      filteredAssets,
      searchQuery,
      semanticResults,
      isImageSearching,
      searchSensitivity,
      isVisualVectorQuery,
    });
  }, [
    filteredAssets,
    searchQuery,
    semanticResults,
    isImageSearching,
    searchSensitivity,
    isVisualVectorQuery,
  ]);

  const indexingStatus: IndexingStatus = useMemo(() => {
    if (scanProgress && !scanProgress.isComplete) {
      return {
        totalFiles: scanProgress.total,
        indexedFiles: scanProgress.processed,
        currentFile: scanProgress.current,
        isRunning: true,
        errors: scanProgress.errors.length,
      };
    }
    return {
      totalFiles: allAssets.length,
      indexedFiles: allAssets.filter((a) => a.isIndexed).length,
      isRunning: false,
      errors: 0,
    };
  }, [scanProgress, allAssets]);

  return {
    filteredAssets,
    selectedAsset,
    matchSources,
    searchScoreMap,
    indexingStatus,
  };
}
