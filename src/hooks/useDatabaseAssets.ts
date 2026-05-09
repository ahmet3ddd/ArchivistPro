import { useEffect, useMemo, useCallback, useState } from 'react';
import { debugLog } from '../services/logger';
import type { Asset } from '../types';
import {
  initDatabase,
  initLocalDatabase,
  isArchiveReady,
  initArchive,
  setActiveArchive as setDbActiveArchive,
  setArchiveRegistry,
  getAllAssetsFromArchive,
  getScannedRoots,
  getRootGroups,
  hasAnyEmbeddings,
  upsertAsset,
  saveDatabaseDeferred,
  wasDbRecovered,
  clearDbRecovery,
  MAIN_ARCHIVE_ID,
  LOCAL_ARCHIVE_ID,
} from '../services/database';
import { useStore } from '../store/useStore';
import { getTagsForAssets } from '../services/tagService';
import { getAllFavoriteIds } from '../services/favorites';
import { loadEmbeddingModel } from '../services/embeddings';
import { invalidateEmbeddingCache } from './useEmbeddingSearch';
import { notifyError } from '../services/notificationCenter';
import i18n from '../i18n';
import { TIMINGS } from '../config/constants';

/** Asset'lere userTags alanını doldurur (batch sorgu ile N+1 önleme) */
function enrichWithTags(assets: Asset[]): Asset[] {
  const tagsMap = getTagsForAssets(assets.map(a => a.id));
  return assets.map(a => ({
    ...a,
    userTags: (tagsMap[a.id] || []).map(t => ({ id: t.id, name: t.name, color: t.color })),
  }));
}

export function useDatabaseAssets() {
  const scannedAssets = useStore((s) => s.scannedAssets);
  const setScannedAssets = useStore((s) => s.setScannedAssets);
  const dbReady = useStore((s) => s.dbReady);
  const setDbReady = useStore((s) => s.setDbReady);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (!cancelled && !useStore.getState().dbReady) {
        setDbError(i18n.t('dbAssets.timeout'));
        notifyError(i18n.t('dbAssets.dbError'), i18n.t('dbAssets.wasmTimeout'));
      }
    }, TIMINGS.DB_INIT_TIMEOUT_MS);

    initDatabase()
      .then(async () => {
        if (cancelled) return;
        setDbReady(true);

        // Bozuk DB recovery olduysa kullanıcıyı bilgilendir
        if (wasDbRecovered()) {
          clearDbRecovery();
          useStore.getState().showConfirmDialog(
            i18n.t('dbAssets.recoveryTitle'),
            i18n.t('dbAssets.recoveryDetail'),
            () => {},
            i18n.t('common.ok'),
            false,
            true, // hideCancel — sadece Tamam butonu
          );
        }

        // Rust config'den ekstra arşivleri çek ve store ile birleştir (N-arşiv sync)
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const extras = await invoke<Array<{ id: string; name: string; db_path: string; archive_type: string }>>('list_extra_archives');
          if (extras && extras.length > 0 && !cancelled) {
            const currentArchives = useStore.getState().archives;
            const existingIds = new Set(currentArchives.map(a => a.id));
            const newDefs = extras
              .filter(e => !existingIds.has(e.id))
              .map(e => ({
                id: e.id,
                name: e.name,
                type: (e.archive_type === 'shared' ? 'shared' : 'personal') as 'shared' | 'personal',
                dbPath: e.db_path,
                createdAt: new Date().toISOString(),
              }));
            if (newDefs.length > 0) {
              useStore.getState().setArchives([...currentArchives, ...newDefs]);
            }
          }
        } catch (err) {
          debugLog('DatabaseAssets', 'list_extra_archives failed (Tauri yoksa normal)', err);
        }

        if (cancelled) return;

        // Arşiv kayıt defterini database.ts'e aktar
        setArchiveRegistry(useStore.getState().archives);

        // activeArchive geçerliliğini doğrula — silinmiş bir arşive işaret ediyorsa main'e düş
        const currentArchives = useStore.getState().archives;
        const currentActive = useStore.getState().activeArchive;
        if (!currentArchives.find(a => a.id === currentActive)) {
          useStore.getState().setActiveArchive(MAIN_ARCHIVE_ID);
          setDbActiveArchive(MAIN_ARCHIVE_ID);
        }

        // İlk yüklemede ana arşiv asset'lerini oku.
        // Eğer aktif arşiv 'local' ise ikinci efekt (activeArchive değişimi)
        // local DB'yi başlatıp doğru asset'leri yükleyecek.
        const initialArchive = useStore.getState().activeArchive;
        if (initialArchive === MAIN_ARCHIVE_ID) {
          const stored = getAllAssetsFromArchive(MAIN_ARCHIVE_ID);
          if (stored.length > 0) {
            setScannedAssets(enrichWithTags(stored));
          }
        }
        // Faz 1.5: Kaynak klasör listesini yükle
        useStore.getState().setScannedRoots(getScannedRoots());
        useStore.getState().setRootGroups(getRootGroups());
        // Favori ID setini global store'a yükle (kart render'ları için)
        try { useStore.getState().setFavoriteIds(new Set(getAllFavoriteIds())); } catch { /* ignore */ }
        // DB'de embedding verisi varsa modeli arka planda yükle (semantik arama için)
        if (hasAnyEmbeddings()) {
          loadEmbeddingModel().catch((err) => debugLog('DatabaseAssets', 'Embedding model load failed', err));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setDbError(i18n.t('dbAssets.initFailed', { message: msg }));
        notifyError(i18n.t('dbAssets.dbError'), msg);
      })
      .finally(() => clearTimeout(timer));

    return () => { cancelled = true; clearTimeout(timer); };
  }, [setDbReady, setScannedAssets]);

  // Arşiv değiştiğinde asset'leri yeniden yükle
  const activeArchive = useStore((s) => s.activeArchive);
  useEffect(() => {
    if (!dbReady) return;
    let cancelled = false;

    (async () => {
      try {
        if (!isArchiveReady(activeArchive)) {
          if (activeArchive === LOCAL_ARCHIVE_ID) {
            await initLocalDatabase();
          } else {
            await initArchive(activeArchive);
          }
        }
        if (cancelled) return;
        setDbActiveArchive(activeArchive);
        // Arşiv değişince embedding cache invalidate et — yoksa eski arşivin
        // chunk vektörleri kullanılıp yanlış semantik sonuçlar dönebilir.
        invalidateEmbeddingCache();
        const stored = getAllAssetsFromArchive(activeArchive);
        setScannedAssets(enrichWithTags(stored));
        // Faz 1.5: Kaynak klasör listesini yükle (her arşivin kendi root'u var)
        useStore.getState().setScannedRoots(getScannedRoots());
        useStore.getState().setRootGroups(getRootGroups());
        try { useStore.getState().setFavoriteIds(new Set(getAllFavoriteIds())); } catch { /* ignore */ }
        useStore.getState().clearRootFilters(); // Arşiv değişince filtreleri sıfırla
      } catch (err) {
        if (cancelled) return;
        debugLog('DatabaseAssets', 'Archive load error', err);
        setScannedAssets([]);
      }
    })();

    return () => { cancelled = true; };
  }, [activeArchive, dbReady, setScannedAssets]);

  const allAssets = useMemo(() => {
    const seen = new Set<string>();
    const filtered = scannedAssets.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      if (a.fileType === 'BAK') return false;
      return true;
    });
    // Her render'da etiketleri güncelle (etiket ekleme/çıkarma sonrası)
    return enrichWithTags(filtered);
  }, [scannedAssets]);

  const handleUpdateAsset = useCallback((updated: Asset) => {
    setScannedAssets((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    upsertAsset(updated);
    saveDatabaseDeferred();
  }, [setScannedAssets]);

  return {
    scannedAssets,
    setScannedAssets,
    dbReady,
    dbError,
    allAssets,
    handleUpdateAsset,
  };
}
