import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';

/** localStorage ile store arasında yazma senkronu (okuma store create sırasında). */
export function useStorePersistence() {
  const { facetConfig, aiConfig, searchSensitivity, cardSize } = useStore(useShallow((s) => ({
    facetConfig: s.facetConfig,
    aiConfig: s.aiConfig,
    searchSensitivity: s.searchSensitivity,
    cardSize: s.cardSize,
  })));

  useEffect(() => {
    localStorage.setItem('archivist_facet_config', JSON.stringify(facetConfig));
  }, [facetConfig]);

  useEffect(() => {
    // API anahtarını güvenlik nedeniyle localStorage'a kaydetme
    const { apiKey: _apiKey, ...safeConfig } = aiConfig;
    localStorage.setItem('archivist_ai_config', JSON.stringify(safeConfig));
  }, [aiConfig]);

  useEffect(() => {
    localStorage.setItem('archivist_search_sensitivity', searchSensitivity.toString());
  }, [searchSensitivity]);

  useEffect(() => {
    localStorage.setItem('cardSize', String(cardSize));
  }, [cardSize]);
}
