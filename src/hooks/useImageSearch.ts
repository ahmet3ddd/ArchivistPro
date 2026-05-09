import { useRef, useCallback, useEffect } from 'react';
import { debugLog } from '../services/logger';
import type { AIConfig } from '../components/AISettingsModal';
import type { EmbeddingStatus } from '../services/embeddings';
import type { Asset } from '../types';
import {
  generateImageEmbeddingsMulti,
  cosineSimilarity,
} from '../services/embeddings';
import { getAllEmbeddings, getEmbeddingsBySourcePrefix, getAssetPhashMap } from '../services/database';
import { analyzeImage } from '../services/vision';
import { computeImagePhashFromFile, getHammingDistance } from '../services/imageHash';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { notifyError, notifyWarning } from '../services/notificationCenter';
import i18n from '../i18n';
import { invoke } from '@tauri-apps/api/core';
import { buildFullSearchableText, computeKeywordScore, turkishLower } from '../utils/searchScoring';
import { expandQuery } from '../services/queryExpansion';

/** WebView2, TIF/TGA dosyalarını <canvas> ile çözemez.
 *  Tauri'nin Rust thumbnail komutunu kullanarak JPEG base64'e dönüştür. */
async function toDecodableSrc(file: File): Promise<File | string> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext !== 'tif' && ext !== 'tiff' && ext !== 'tga') return file;
  const filePath = (file as File & { path?: string }).path;
  if (!filePath) return file;
  try {
    const assetType = ext === 'tga' ? 'TGA' : 'TIFF';
    const thumbB64 = await invoke<string>('generate_thumbnail', { path: filePath, assetType });
    if (thumbB64) return thumbB64; // "data:image/jpeg;base64,..."
  } catch (err) {
    debugLog('ImageSearch', 'TIF/TGA thumbnail dönüşümü başarısız', err);
  }
  return file;
}

type Args = {
  embeddingStatus: EmbeddingStatus;
  aiConfig: AIConfig;
  allAssets: Asset[];
};

export function useImageSearch({ embeddingStatus, aiConfig, allAssets }: Args) {
  // allAssets'i ref içinde tut — her render'da yeniden callback oluşturmaktan kaçın
  const allAssetsRef = useRef<Asset[]>(allAssets);
  allAssetsRef.current = allAssets;

  // Not: shadow-setter pattern — handleImageSearch içinde isStale() kontrollü
  // local setter'lar kullanılıyor. Burada ham store setter'larına _Store eki verildi.
  const { setSearchQuery: _setSearchQueryStore, setSemanticResults: _setSemanticResultsStore, setIsImageSearching: _setIsImageSearchingStore, setImageSearchActive: _setImageSearchActiveStore } = useStore(useShallow((s) => ({
    setSearchQuery: s.setSearchQuery,
    setSemanticResults: s.setSemanticResults,
    setIsImageSearching: s.setIsImageSearching,
    setImageSearchActive: s.setImageSearchActive,
  })));

  const legacyIndexNoticeShownRef = useRef(false);
  const activeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // İstek id — her handleImageSearch çağrısında artar. cancelImageSearch
  // veya yeni çağrı sırasında in-flight isteğin setState'leri yok sayılır.
  const requestIdRef = useRef(0);

  // Component unmount'ta aktif interval'ı temizle
  useEffect(() => {
    return () => {
      if (activeTimerRef.current) {
        clearInterval(activeTimerRef.current);
        activeTimerRef.current = null;
      }
    };
  }, []);

  const cancelImageSearch = useCallback(() => {
    // Aktif requestId'yi geçersiz kıl — devam eden analyzeImage tamamlansa
    // bile setSearchQuery/setSemanticResults çağrıları yok sayılır.
    requestIdRef.current += 1;
    if (activeTimerRef.current) {
      clearInterval(activeTimerRef.current);
      activeTimerRef.current = null;
    }
    _setIsImageSearchingStore(false);
    _setImageSearchActiveStore(false);
    _setSearchQueryStore('');
    _setSemanticResultsStore(null);
  }, [_setIsImageSearchingStore, _setImageSearchActiveStore, _setSearchQueryStore, _setSemanticResultsStore]);

  const handleImageSearch = useCallback(
    async (file: File) => {
      if (!embeddingStatus.isReady) {
        notifyWarning(i18n.t('imageSearch.enableAiFirst'));
        return;
      }

      if (aiConfig.apiProvider === 'ollama') {
        if (!aiConfig.apiUrl) {
          notifyWarning(i18n.t('imageSearch.noOllamaUrl'));
          return;
        }
      } else if (!aiConfig.apiKey) {
        notifyWarning(i18n.t('imageSearch.noApiKey', { provider: aiConfig.apiProvider }));
        return;
      }

      const myId = ++requestIdRef.current;
      const isStale = () => requestIdRef.current !== myId;
      // Stale-guarded local setter'lar — cancelImageSearch veya yeni istek
      // tetiklendiğinde mevcut in-flight isteğin state yazımları sessizce atlanır.
      const setSearchQuery = (q: string) => { if (!isStale()) _setSearchQueryStore(q); };
      const setSemanticResults: typeof _setSemanticResultsStore = (r) => { if (!isStale()) _setSemanticResultsStore(r); };
      const setIsImageSearching = (v: boolean) => { if (!isStale()) _setIsImageSearchingStore(v); };
      const setImageSearchActive = (v: boolean) => { if (!isStale()) _setImageSearchActiveStore(v); };

      setIsImageSearching(true);
      setImageSearchActive(false);
      setSearchQuery('');

      if (aiConfig.enableClipVision) {
        try {
          const clipSource = await toDecodableSrc(file);
          const queryVectors = await generateImageEmbeddingsMulti(clipSource);
          const sourceVectors = getEmbeddingsBySourcePrefix('image_');
          const legacyVectors = sourceVectors.length === 0 ? getAllEmbeddings('image') : [];

          if (queryVectors.length > 0 && (sourceVectors.length > 0 || legacyVectors.length > 0)) {
            const clipPerAsset = new Map<string, { score: number; hitCount: number }>();

            if (sourceVectors.length > 0) {
              const vectorsBySource = new Map<string, Array<{ assetId: string; vector: number[] }>>();
              for (const row of sourceVectors) {
                const arr = vectorsBySource.get(row.source) || [];
                arr.push({ assetId: row.assetId, vector: row.vector });
                vectorsBySource.set(row.source, arr);
              }

              for (const q of queryVectors) {
                const candidates = vectorsBySource.get(q.source) || vectorsBySource.get('image_global') || [];
                for (const candidate of candidates) {
                  const sim = cosineSimilarity(q.vector, candidate.vector);
                  const prev = clipPerAsset.get(candidate.assetId);
                  if (!prev || sim > prev.score) {
                    clipPerAsset.set(candidate.assetId, { score: sim, hitCount: (prev?.hitCount || 0) + 1 });
                  } else {
                    prev.hitCount += 1;
                  }
                }
              }
            } else {
              if (!legacyIndexNoticeShownRef.current) {
                legacyIndexNoticeShownRef.current = true;
                notifyWarning(i18n.t('imageSearch.oldIndex'));
              }
              const qGlobal = queryVectors.find((v) => v.source === 'image_global') || queryVectors[0];
              for (const candidate of legacyVectors) {
                const sim = cosineSimilarity(qGlobal.vector, candidate.vector);
                clipPerAsset.set(candidate.assetId, { score: sim, hitCount: 1 });
              }
            }

            const topClip = Array.from(clipPerAsset.entries())
              .map(([assetId, val]) => ({ assetId, clipScore: val.score, hitCount: val.hitCount }))
              .sort((a, b) => b.clipScore - a.clipScore)
              .slice(0, 100);

            const queryPhash = await computeImagePhashFromFile(file).catch(() => '');
            const phashMap = getAssetPhashMap();

            const reranked: Array<{ assetId: string; score: number }> = [];
            for (const item of topClip) {
              const clipNorm = Math.max(0, Math.min(1, (item.clipScore + 1) / 2));
              const cropBoost = Math.min(0.08, Math.max(0, item.hitCount - 1) * 0.02);

              let phashScore = 0;
              let hd = 64;
              const candidatePhash = phashMap[item.assetId];
              if (queryPhash && candidatePhash) {
                hd = await getHammingDistance(queryPhash, candidatePhash).catch(() => 64);
                phashScore = Math.max(0, 1 - hd / 64);
              }

              // Ağırlıklar: CLIP 0.60, pHash 0.30, cropBoost 0.10 (toplam = 1.0)
              let finalScore = clipNorm * 0.60 + phashScore * 0.30 + Math.min(1, cropBoost / 0.08) * 0.10;
              if (hd <= 4) finalScore = Math.max(finalScore, 0.995);
              reranked.push({ assetId: item.assetId, score: Math.max(0, Math.min(1, finalScore)) });
            }

            const results = reranked.sort((a, b) => b.score - a.score).slice(0, 50);

            setSemanticResults(results);
            setImageSearchActive(true);
            setSearchQuery('');
            setIsImageSearching(false);
            return;
          } else {
            // CLIP verisi yok — Ollama/keyword fallback'e düş
            debugLog('ImageSearch', 'No CLIP data in current archive, falling back to keyword analysis');
            // Ollama/API ayarı yoksa kullanıcıyı bilgilendir
            if (aiConfig.apiProvider === 'ollama' && !aiConfig.apiUrl) {
              notifyWarning(i18n.t('imageSearch.noClipMap'));
              setSearchQuery('');
              setIsImageSearching(false);
              return;
            }
            if (aiConfig.apiProvider !== 'ollama' && !aiConfig.apiKey) {
              notifyWarning(i18n.t('imageSearch.noClipMap'));
              setSearchQuery('');
              setIsImageSearching(false);
              return;
            }
          }
        } catch (err) {
          debugLog('ImageSearch', 'CLIP Search Error', err);
          notifyWarning(i18n.t('imageSearch.clipError'));
        }
      }

      const isOllama = aiConfig.apiProvider === 'ollama';
      // Fallback yolunda artık arama kutusunu kirletmiyoruz; ilerleme
      // state değişkeni olarak saklanacak (sidebar "analiz ediliyor" rozeti
      // gösterebilir — şimdilik isImageSearching bayrağı yeterli).
      activeTimerRef.current = null;

      try {
        debugLog('ImageSearch', 'Analyzing image: ' + file.name + ' provider: ' + aiConfig.apiProvider);

        const timeoutMs = isOllama ? 600000 : 60000;
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  isOllama
                    ? i18n.t('imageSearch.ollamaTimeout')
                    : i18n.t('imageSearch.apiTimeout')
                )
              ),
            timeoutMs
          )
        );

        const result = await Promise.race([analyzeImage(file, aiConfig), timeoutPromise]);
        debugLog('ImageSearch', 'Result', result);
        if (result.error) {
          notifyError(i18n.t('imageSearch.analysisError', { error: result.error }));
        } else if (!result.description || result.description.trim() === '') {
          notifyError(i18n.t('imageSearch.emptyResponse'));
        } else {
          const dict: Record<string, string> = {
            basketball: 'basketbol',
            court: 'saha',
            red: 'kırmızı',
            green: 'yeşil',
            blue: 'mavi',
            white: 'beyaz',
            black: 'siyah',
            yellow: 'sarı',
            brown: 'kahverengi',
            wood: 'ahşap',
            wooden: 'ahşap',
            floor: 'zemin',
            flooring: 'zemin',
            wall: 'duvar',
            building: 'bina',
            house: 'ev',
            room: 'oda',
            interior: 'iç mekan',
            exterior: 'dış mekan',
            modern: 'modern',
            window: 'pencere',
            door: 'kapı',
            glass: 'cam',
            metal: 'metal',
            stone: 'taş',
            concrete: 'beton',
            brick: 'tuğla',
            roof: 'çatı',
            stair: 'merdiven',
            stairs: 'merdiven',
            pool: 'havuz',
            garden: 'bahçe',
            tree: 'ağaç',
            street: 'sokak',
            road: 'yol',
            car: 'araba',
            city: 'şehir',
            diagram: 'çizim',
            plan: 'plan',
            render: 'görsel',
            photo: 'fotoğraf',
            architecture: 'mimari',
            sport: 'spor',
            sports: 'spor',
            facility: 'tesis',
            ground: 'alan',
            playground: 'oyun alanı',
            indoor: 'kapalı',
            outdoor: 'açık',
            lines: 'çizgi',
            hoop: 'pota',
          };

          const translatedKeywords: string[] = [];
          for (const kw of result.keywords || []) {
            let trKw = kw.toLowerCase().trim();
            for (const [en, tr] of Object.entries(dict)) {
              const regex = new RegExp(`\\b${en}\\b`, 'g');
              trKw = trKw.replace(regex, tr);
            }
            translatedKeywords.push(trKw);
          }

          const cleanKeywords = Array.from(new Set(translatedKeywords))
            .filter((k) => k.length > 2 && k.length < 35);

          let queryTerms: string[] = cleanKeywords;
          if (queryTerms.length === 0) {
            const descFallback = result.description.substring(0, 80).replace(/[-;\n]/g, ' ').trim();
            queryTerms = descFallback ? [descFallback] : [];
          }

          // Keyword'leri arama kutusuna yazmak yerine, asset keyword skorlaması
          // yapıp semanticResults'a yaz. Böylece görsel arama modu korunur.
          if (queryTerms.length > 0) {
            const combinedQuery = expandQuery(turkishLower(queryTerms.join(' ')));
            const scored: Array<{ assetId: string; score: number }> = [];
            for (const asset of allAssetsRef.current) {
              const text = buildFullSearchableText(asset);
              const kwScore = computeKeywordScore(text, combinedQuery);
              if (kwScore > 0) scored.push({ assetId: asset.id, score: kwScore });
            }
            scored.sort((a, b) => b.score - a.score);
            const top = scored.slice(0, 100);
            debugLog('ImageSearch', `Fallback keyword match → ${top.length} assets (keywords: ${queryTerms.join(', ')})`);
            if (top.length === 0) {
              notifyWarning(i18n.t('imageSearch.noMatches'));
            }
            setSemanticResults(top);
            setImageSearchActive(true);
          } else {
            notifyWarning(i18n.t('imageSearch.emptyResponse'));
          }
        }
      } catch (err: unknown) {
        debugLog('ImageSearch', 'Caught error', err);
        const msg = err instanceof Error ? err.message : String(err);
        notifyError(i18n.t('imageSearch.searchError', { error: msg }));
      } finally {
        activeTimerRef.current = null;
        setIsImageSearching(false);
      }
    },
    [embeddingStatus.isReady, aiConfig, _setSearchQueryStore, _setSemanticResultsStore, _setIsImageSearchingStore, _setImageSearchActiveStore]
  );

  return { handleImageSearch, cancelImageSearch };
}
