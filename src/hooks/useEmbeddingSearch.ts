import { useState, useEffect, useMemo } from 'react';
import { debugLog } from '../services/logger';
import {
  generateEmbedding,
  getEmbeddingStatus,
  onEmbeddingStatusChange,
  cosineSimilarity,
} from '../services/embeddings';
import type { EmbeddingStatus } from '../services/embeddings';
import { getAllChunkEmbeddings, searchTextChunksByKeyword } from '../services/database';
import { expandQuery } from '../services/queryExpansion';
import { isVisualVectorQueryString, semanticMatchThreshold } from '../utils/searchScoring';
import { useStore } from '../store/useStore';
import { notifyError } from '../services/notificationCenter';
import i18n from '../i18n';
import { TIMINGS } from '../config/constants';

// Embedding cache — DB'den her sorguda çekmek yerine bellekte tut
let _embeddingCache: ReturnType<typeof getAllChunkEmbeddings> | null = null;
let _cacheVersion = 0;

export function invalidateEmbeddingCache() {
  _cacheVersion++;
  _embeddingCache = null;
}

function getCachedEmbeddings() {
  if (!_embeddingCache) {
    const versionBefore = _cacheVersion;
    // İki sorguyu tek seferde topla
    const textEmbs = getAllChunkEmbeddings('chunk_text');
    const ocrEmbs = getAllChunkEmbeddings('chunk_ocr');
    // Sorgular arasında invalidation olduysa cache'i atla
    if (_cacheVersion !== versionBefore) {
      return [...textEmbs, ...ocrEmbs];
    }
    _embeddingCache = [...textEmbs, ...ocrEmbs];
  }
  return _embeddingCache;
}

export function useEmbeddingSearch() {
  const searchQuery = useStore((s) => s.searchQuery);
  const setSemanticResults = useStore((s) => s.setSemanticResults);
  const searchSensitivity = useStore((s) => s.searchSensitivity);
  const isImageSearching = useStore((s) => s.isImageSearching);
  const imageSearchActive = useStore((s) => s.imageSearchActive);

  const [embeddingStatus, setEmbeddingStatus] = useState<EmbeddingStatus>(getEmbeddingStatus());
  const [isSearching, setIsSearching] = useState(false);

  const isVisualVectorQuery = useMemo(
    () => imageSearchActive || isVisualVectorQueryString(searchQuery),
    [imageSearchActive, searchQuery]
  );

  useEffect(() => {
    const unsub = onEmbeddingStatusChange(setEmbeddingStatus);
    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    // Görsel arama aktif/işlem halinde — semanticResults'a dokunma,
    // CLIP/keyword-fallback sonuçlarını koru.
    if (isImageSearching || isVisualVectorQuery) return;
    const trimmed = searchQuery.trim();
    if (!trimmed || !embeddingStatus.isReady) {
      setSemanticResults(null);
      return;
    }
    // Min 3 karakter — sidebar ipucuyla tutarlı olsun, kısa sorgularda
    // gereksiz embedding üretimini engelle (text-hybrid arama yine çalışır).
    if (trimmed.length < 3) {
      setSemanticResults(null);
      return;
    }

    let cancelled = false;
    const debounce = setTimeout(async () => {
      if (cancelled) return;
      setIsSearching(true);
      try {
        const queryVec = await generateEmbedding(expandQuery(searchQuery));
        if (cancelled) return;
        const allChunkEmbs = getCachedEmbeddings();
        const perAssetBest = new Map<string, { score: number; chunkId: string }>();

        // Semantik vektör araması
        if (allChunkEmbs.length > 0) {
          const threshold = semanticMatchThreshold(searchSensitivity);

          for (const row of allChunkEmbs) {
            const v = row.vector;
            if (v.length !== queryVec.length) continue;
            const score = cosineSimilarity(queryVec, v);
            if (score < threshold) continue;

            const prev = perAssetBest.get(row.assetId);
            if (!prev || score > prev.score) {
              perAssetBest.set(row.assetId, { score, chunkId: row.chunkId });
            }
          }
        }
        if (cancelled) return;

        // Keyword fallback — LIKE araması: özel isimler / birebir eşleşmeler için.
        // Semantic'in kaçırdığı exact keyword'leri yakalar (embedding olmasa da çalışır).
        const KEYWORD_SCORE = 0.62;
        for (const assetId of searchTextChunksByKeyword(searchQuery)) {
          if (!perAssetBest.has(assetId)) {
            perAssetBest.set(assetId, { score: KEYWORD_SCORE, chunkId: `kw_${assetId}` });
          }
        }

        const results = Array.from(perAssetBest.entries())
          .map(([assetId, v]) => ({ assetId, score: v.score, chunkId: v.chunkId }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 50);

        if (cancelled) return;
        setSemanticResults(results.length > 0 ? results : null);
      } catch (err) {
        if (cancelled) return;
        debugLog('EmbeddingSearch', 'Semantic search error', err);
        notifyError(i18n.t('embeddingSearch.error'), err instanceof Error ? err.message : i18n.t('embeddingSearch.errorDetail'));
        setSemanticResults(null);
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, TIMINGS.EMBEDDING_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
    };
  }, [searchQuery, embeddingStatus.isReady, isVisualVectorQuery, isImageSearching, setSemanticResults, searchSensitivity]);

  return {
    embeddingStatus,
    isSearching,
    isVisualVectorQuery,
  };
}
