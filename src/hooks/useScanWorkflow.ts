import { useState, useRef, useCallback, useEffect } from 'react';
import type { Asset } from '../types';
import type { AIConfig } from '../components/AISettingsModal';
import {
  clearAssetsUnderPath,
  clearAllAssets,
  addScannedRoot,
  ensureScannedRootActive,
  updateRootScanInfo,
  getScannedRootByExactPath,
  getScannedRoots,
  persistScannedRootToDisk,
  clearAssetsOnDisk,
  writeScanReportToDisk,
  setScanWriteLock,
  flushDeferredSave,
} from '../services/database';

export type ScanMode = 'merge' | 'replaceUnderPath' | 'fullReset';
import {
  loadEmbeddingModel,
  loadClipModel,
  warmupEmbeddingModel,
  warmupClipModel,
  getEmbeddingStatus,
} from '../services/embeddings';
import { open } from '@tauri-apps/plugin-dialog';
import { scanDirectory, ScanController, _EXTENSION_MAP } from '../services/fileScanner';
import type { ScanProgress, PreCountResult } from '../services/fileScanner';
import { invalidateEmbeddingCache } from './useEmbeddingSearch';
import { useStore } from '../store/useStore';
import { auditLog } from '../services/logger';
import { notifySuccess, notifyInfo, notifyWarning } from '../services/notificationCenter';
import { createSnapshot } from '../services/dbSnapshot';
import { acquireScanPriority, releaseScanPriority } from '../services/scanPriority';
import i18n from '../i18n';
import { useShallow } from 'zustand/react/shallow';

type Args = {
  aiConfig: AIConfig;
  embeddingReady: boolean;
  allAssets: Asset[];
};

export function useScanWorkflow({ aiConfig, embeddingReady: _embeddingReady, allAssets: _allAssets }: Args) {
  const setScannedAssets = useStore((s) => s.setScannedAssets);
  const setIsScanModalOpen = useStore((s) => s.setIsScanModalOpen);
  const { pendingRescanPaths, setPendingRescanPaths } = useStore(
    useShallow((s) => ({ pendingRescanPaths: s.pendingRescanPaths, setPendingRescanPaths: s.setPendingRescanPaths }))
  );
  const setLastScanInfo = useStore((s) => s.setLastScanInfo);
  const setFolderScanDuration = useStore((s) => s.setFolderScanDuration);
  const activeArchive = useStore((s) => s.activeArchive);
  const setIsScanInProgress = useStore((s) => s.setIsScanInProgress);

  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [isScanPaused, setIsScanPaused] = useState(false);

  // scanProgress → store bayrağı. Session timeout bu bayrağa göre duraklatılır.
  useEffect(() => {
    const running = !!scanProgress && !scanProgress.isComplete;
    setIsScanInProgress(running);
    setScanWriteLock(running); // sql.js dump'ının rusqlite verisini ezmesini engelle
    // Tarama bittiğinde lock açılır → bekleyen deferred save'leri flush et
    if (!running && scanProgress?.isComplete) {
      flushDeferredSave();
    }
    return () => {
      // Unmount'ta bayrak kilitli kalmasın (failsafe)
      if (running) { setIsScanInProgress(false); setScanWriteLock(false); }
    };
  }, [scanProgress, setIsScanInProgress]);

  const scanControllerRef = useRef<ScanController | null>(null);
  const scanStartMsRef = useRef<number>(0);

  /** Büyük klasör uyarısı: kullanıcıya onay diyalogu gösterir */
  const confirmLargeScan = useCallback((info: PreCountResult): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      let dismissCheck: ReturnType<typeof setInterval> | null = null;
      const { showConfirmDialog } = useStore.getState();
      const msg = i18n.t('scan.largeScan.title');
      const detail = i18n.t('scan.largeScan.detail', {
        fileCount: info.fileCount.toLocaleString(),
        folderCount: info.folderCount.toLocaleString(),
      });
      showConfirmDialog(
        msg,
        detail,
        () => { if (dismissCheck) clearInterval(dismissCheck); resolve(true); },
        i18n.t('scan.largeScan.confirm'),
        false, // isDanger
        false, // hideCancel
      );
      // İptal/ESC/overlay-click → dialog dismiss edilir, store null olur
      dismissCheck = setInterval(() => {
        if (!useStore.getState().confirmDialog) {
          clearInterval(dismissCheck!);
          resolve(false);
        }
      }, 200);
    });
  }, []);

  /**
   * Belirli bir klasör için tam tarama akışını çalıştırır (OS dialog atlanır).
   * handleStartScan ve handleRescanFolder ortak gövdesi.
   */
  const _runFolderScan = useCallback(
    async (selectedFolder: string, mode: ScanMode, withColorExtract: boolean) => {
      // Disk alanı ön kontrolü — yetersizse uyar (engellemez)
      try {
        const { checkDiskSpaceAndWarn } = await import('../services/database');
        await checkDiskSpaceAndWarn();
      } catch { /* sessiz */ }

      auditLog('SCAN_START', 'directory', { mode, withColorExtract, targetPath: selectedFolder });
      const startMsg =
        mode === 'fullReset' ? i18n.t('scanWorkflow.willFullReset')
        : mode === 'replaceUnderPath' ? i18n.t('scanWorkflow.willClear')
        : i18n.t('scanWorkflow.willAppend');
      notifyInfo(i18n.t('scanWorkflow.started'), startMsg);

      // Tarama öncesi otomatik DB yedeği
      await createSnapshot(activeArchive);

      // Process priority'i dusur — kullanici diger uygulamalari rahat kullansin
      await acquireScanPriority();

      // Cleanup modlarında (fullReset/replaceUnderPath) hem sql.js hem rusqlite (disk)
      // tarafı temizlenir. Eskiden cleanup sonrası saveDatabaseAsync çağrılıyordu —
      // sql.js dump atomik rename ile diski ezdiği için rusqlite'taki canlı tarama
      // verisini siler (28 GB veri kaybı riski). Çözüm: rusqlite'ı doğrudan
      // scan_clear_assets ile temizle, saveDatabase'i tamamen kaldır.
      if (mode === 'fullReset') {
        // 1. sql.js: UI tutarlılığı için aynı tabloları boşalt (skipSave — disk'e yazma yok)
        clearAllAssets({ skipSave: true });
        // 2. rusqlite (disk): TÜM tabloları targeted DELETE ile temizle
        await clearAssetsOnDisk('all');
        setScannedAssets(() => []);
        useStore.getState().setScannedRoots([]);
      } else if (mode === 'replaceUnderPath') {
        // 1. sql.js: path altındaki asset'leri sil
        clearAssetsUnderPath(selectedFolder, { skipSave: true });
        // 2. rusqlite (disk): aynı path prefix'i altındaki asset'leri ve bağlı kayıtları sil
        await clearAssetsOnDisk('under_path', selectedFolder);
        const sep = selectedFolder.includes('\\') ? '\\' : '/';
        const safePrefix = selectedFolder.endsWith(sep) ? selectedFolder : selectedFolder + sep;
        setScannedAssets((prev) => prev.filter((a) => !a.filePath.startsWith(safePrefix)));
      }

      const controller = new ScanController();
      scanControllerRef.current = controller;

      try {
        await loadEmbeddingModel();
        if (aiConfig.enableClipVision) await loadClipModel();
        // Warmup: ONNX inference graph JIT cold-start'ını ilk dosyadan önce öde.
        // Aksi halde kullanıcı ilk dosya için 1-3 sn bekler, sonrakiler hızlı olur.
        await Promise.all([
          warmupEmbeddingModel(),
          aiConfig.enableClipVision ? warmupClipModel() : Promise.resolve(),
        ]);
      } catch {
        notifyWarning(i18n.t('scanWorkflow.modelFailed'), i18n.t('scanWorkflow.continueWithout'));
      }

      // Tarama timer'ı warmup'lardan SONRA başlatılır — model load ve ONNX JIT
      // süreleri "tarama süresi"ne sayılmaz (UX'te "Hazırlanıyor" ekranındalar zaten).
      scanStartMsRef.current = Date.now();

      const visionConfig = (aiConfig.apiKey || aiConfig.apiProvider === 'ollama') ? aiConfig : undefined;

      const lpRef: { current: ScanProgress | null } = { current: null };
      let assets: Asset[];
      try {
        assets = await scanDirectory(
          (progress) => {
            lpRef.current = progress;
            setScanProgress({ ...progress });
          },
          getEmbeddingStatus().isReady,
          controller,
          withColorExtract,
          visionConfig,
          selectedFolder,
          undefined, // forcePaths
          confirmLargeScan,
          true, // skipFinalSave — bu hook sonda tek konsolide save yapar
        );
      } catch (err) {
        // Hata durumunda isScanInProgress bayrağı kilit kalmasın
        setScanProgress((prev) => prev ? { ...prev, isComplete: true } : null);
        const msg = err instanceof Error ? err.message : String(err);
        auditLog(
          'SCAN_ERROR',
          selectedFolder,
          {
            error: msg.substring(0, 500),
            processed: lpRef.current?.processed ?? 0,
            total: lpRef.current?.total ?? 0,
          },
          'FAIL',
        );
        await releaseScanPriority();
        throw err;
      }

      // Tarama başarılı ama içinde per-file hataları varsa özet log kaydet
      const errs = lpRef.current?.errors;
      if (errs && errs.length > 0) {
        auditLog(
          'SCAN_ERRORS',
          selectedFolder,
          {
            errorCount: errs.length,
            assetCount: assets.length,
            samples: errs.slice(0, 20),
          },
        );
      }

      scanControllerRef.current = null;
      setIsScanPaused(false);
      const durationMs = Date.now() - scanStartMsRef.current;
      const globalAvgMs = assets.length > 0 ? durationMs / assets.length : 0;
      const typeGroups: Record<string, number> = {};
      for (const asset of assets) {
        const ext = (asset.fileName?.split('.').pop() ?? 'UNKNOWN').toUpperCase();
        typeGroups[ext] = (typeGroups[ext] ?? 0) + 1;
      }
      const typeAvgMs: Record<string, number> = Object.fromEntries(
        Object.keys(typeGroups).map(t => [t, globalAvgMs])
      );
      const scanInfo = { durationMs, fileCount: assets.length, completedAt: new Date().toISOString(), typeAvgMs };
      setLastScanInfo(scanInfo, activeArchive);
      setFolderScanDuration(selectedFolder, scanInfo);

      // İptal halinde post-scan kaydı atla — banner'ı gereksiz yere açma.
      // Asset/embedding/text_chunk zaten rusqlite ile periyodik checkpoint'lerde diske yazıldı.
      const wasCancelled = !!lpRef.current?.isCancelled;

      if (wasCancelled) {
        auditLog('SCAN_CANCEL', 'directory', { assetCount: assets.length, durationMs, partial: true });
        notifyInfo(i18n.t('scanWorkflow.cancelled'), i18n.t('scanWorkflow.cancelledByUser'));
      } else {
        auditLog('SCAN_COMPLETE', 'directory', { assetCount: assets.length, durationMs });
        notifySuccess(i18n.t('scanWorkflow.completed'), i18n.t('scanWorkflow.filesScanned', { count: assets.length }));
      }

      // İptal'de bile kalıcı veri varsa (writeBuffer rusqlite ile diske yazdı) klasör
      // kaydını ve sql.js → disk export'unu yap — yoksa "33 asset var ama 0 klasör"
      // tutarsızlığı kalır (orphan asset'ler). Banner kısa süre çıkar; tutarlılık için
      // kabul edilebilir trade-off.
      const shouldPersist = !wasCancelled || assets.length > 0;

      let persistedRootId: string | null = null;
      if (shouldPersist) {
        // Taranan kök klasörü kaydet/güncelle (skipSave — persist aşağıda targeted yapılır)
        // İptal'de partial count yazılır (assets.length kadarı diske flushlandı).
        try {
          const existing = getScannedRootByExactPath(selectedFolder);
          let rootId: string;
          if (existing) {
            // Çöpteki klasörü yeniden tarıyorsa otomatik geri yükle (klasör + altındaki asset'ler).
            ensureScannedRootActive(existing.id);
            rootId = existing.id;
          } else {
            rootId = addScannedRoot(selectedFolder, undefined, { skipSave: true });
          }
          updateRootScanInfo(rootId, assets.length, { skipSave: true });
          useStore.getState().setScannedRoots(getScannedRoots());
          persistedRootId = rootId;
        } catch (err) {
          auditLog('SCANNED_ROOT_ERROR', selectedFolder, { error: String(err) });
        }
      }

      invalidateEmbeddingCache();
      setScannedAssets((prev) => {
        const merged = new Map(prev.map((a) => [a.id, a]));
        assets.forEach((a) => merged.set(a.id, a));
        return Array.from(merged.values());
      });

      // Persist stratejisi (mode'dan bağımsız): cleanup zaten clearAssetsOnDisk ile diske
      // yansıtıldı, asset/embedding/text_chunks rusqlite checkpoint'leriyle yazıldı —
      // sadece scanned_roots tek satır mirror gerekir. saveDatabaseAsync ARTIK ÇAĞRILMAZ
      // (sql.js dump'ı diski ezerek rusqlite verisini silme riski taşıyordu).
      if (shouldPersist && persistedRootId) {
        try { await persistScannedRootToDisk(persistedRootId); } catch { /* non-fatal */ }
      }

      // Tarama raporu — atlanan/hata veren dosyaların TXT kaydı APP_DATA altına.
      // Yazma fail olsa bile tarama akışı zaten bitti, kullanıcıya zarar yok.
      const reportEntries = lpRef.current?.report ?? [];
      if (reportEntries.length > 0) {
        try {
          const sep = selectedFolder.includes('\\') ? '\\' : '/';
          const rootLabel = selectedFolder.split(sep).filter(Boolean).pop() || 'Klasor';
          const reportPath = await writeScanReportToDisk({
            rootPath: selectedFolder,
            rootLabel,
            startedAt: new Date(scanStartMsRef.current).toISOString(),
            finishedAt: new Date().toISOString(),
            totalFound: lpRef.current?.total ?? assets.length,
            scannedCount: assets.length,
            errorCount: lpRef.current?.errors?.length ?? 0,
            entries: reportEntries,
          });
          if (reportPath) {
            auditLog('SCAN_REPORT_WRITTEN', selectedFolder, { reportPath, entries: reportEntries.length });
            notifyInfo(
              i18n.t('scanWorkflow.reportSaved', 'Tarama raporu kaydedildi'),
              i18n.t('scanWorkflow.reportSavedDetail', '{{count}} kayıt — {{path}}', { count: reportEntries.length, path: reportPath }),
            );
          }
        } catch { /* non-fatal */ }
      }

      await releaseScanPriority();
    },
    [aiConfig, setScannedAssets, activeArchive, setLastScanInfo, setFolderScanDuration, confirmLargeScan]
  );

  const handleStartScan = useCallback(
    async (mode: ScanMode, withColorExtract = false) => {
      // Native dialog kapanınca kurulum ekranı bir an görünmesin: hazırlanıyor durumunu dialogdan önce aç
      setScanProgress({ total: 0, processed: 0, current: '', errors: [], isComplete: false, isPreparing: true });
      setIsScanPaused(false);

      let selectedFolder: string | null = null;
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const result = await open({
          title: i18n.t('scanWorkflow.selectFolder'),
          directory: true,
          multiple: false,
        });
        selectedFolder = result as string | null;
      } catch {
        setScanProgress(null);
        return;
      }
      if (!selectedFolder) {
        setScanProgress(null);
        return;
      }

      // fullReset yıkıcıdır — onay iste
      if (mode === 'fullReset') {
        const confirmed = await new Promise<boolean>((resolve) => {
          let dismissCheck: ReturnType<typeof setInterval> | null = null;
          const { showConfirmDialog } = useStore.getState();
          showConfirmDialog(
            i18n.t('scanWorkflow.fullResetConfirm'),
            i18n.t('scanWorkflow.fullResetConfirmDetail'),
            () => { if (dismissCheck) clearInterval(dismissCheck); resolve(true); },
            i18n.t('scanWorkflow.fullResetConfirmButton'),
            true,  // isDanger
            false, // hideCancel
          );
          dismissCheck = setInterval(() => {
            if (!useStore.getState().confirmDialog) {
              clearInterval(dismissCheck!);
              resolve(false);
            }
          }, 200);
        });
        if (!confirmed) {
          setScanProgress(null);
          return;
        }
      }

      await _runFolderScan(selectedFolder, mode, withColorExtract);
    },
    [_runFolderScan]
  );

  /**
   * Mevcut bir kaynak klasörü diyaloğu atlayarak yeniden tarar.
   * Kullanım: Sidebar'daki "Yeniden Tara" menü maddesi.
   * Replace mode: o klasör altındaki assetler silinir, ardından taranır.
   */
  const handleRescanFolder = useCallback(
    async (folderPath: string, withColorExtract = false) => {
      if (!folderPath) return;
      // Klasöre özgü geçmiş süre varsa EMA tohumunu önceden yükle
      const folderHistory = useStore.getState().folderScanDurations[folderPath];
      if (folderHistory) {
        setLastScanInfo(folderHistory, activeArchive);
      }
      // Modal'ı aç ki kullanıcı ilerlemeyi görsün
      setIsScanModalOpen(true);
      setScanProgress({ total: 0, processed: 0, current: '', errors: [], isComplete: false, isPreparing: true });
      setIsScanPaused(false);
      await _runFolderScan(folderPath, 'replaceUnderPath', withColorExtract);
    },
    [_runFolderScan, setIsScanModalOpen, setLastScanInfo, activeArchive]
  );

  const handlePauseScan = useCallback(() => {
    scanControllerRef.current?.pause();
    setIsScanPaused(true);
    notifyInfo(i18n.t('scanWorkflow.paused'), i18n.t('scanWorkflow.pausedHint'));
  }, []);

  const handleResumeScan = useCallback(() => {
    scanControllerRef.current?.resume();
    setIsScanPaused(false);
    notifyInfo(i18n.t('scanWorkflow.resumed'), '');
  }, []);

  const handleCancelScan = useCallback(() => {
    scanControllerRef.current?.cancel();
    setIsScanPaused(false);
    // Audit log post-scan'de assetCount + durationMs ile birlikte atılıyor (duplicate atmıyoruz).
    notifyWarning(i18n.t('scanWorkflow.cancelled'), i18n.t('scanWorkflow.cancelledByUser'));
  }, []);

  const handleScanFiles = useCallback(async (withColorExtract = false) => {
    setScanProgress({ total: 0, processed: 0, current: '', errors: [], isComplete: false, isPreparing: true });
    setIsScanPaused(false);

    let selectedPaths: string[] | null = null;
    try {
      const result = await open({
        title: i18n.t('scanWorkflow.selectFiles'),
        directory: false,
        multiple: true,
        filters: [
          { name: 'Desteklenen Dosyalar', extensions: Object.keys(_EXTENSION_MAP) },
          { name: i18n.t('scanWorkflow.allFiles'), extensions: ['*'] },
        ],
      });
      selectedPaths = result as string[] | null;
    } catch {
      setScanProgress(null);
      return;
    }
    if (!selectedPaths || selectedPaths.length === 0) {
      setScanProgress(null);
      return;
    }

    // Tarama öncesi otomatik DB yedeği
    await createSnapshot(activeArchive);

    await acquireScanPriority();

    auditLog('SCAN_START', 'files', { fileCount: selectedPaths.length, withColorExtract });

    const controller = new ScanController();
    scanControllerRef.current = controller;

    // 3. Model yüklemesi "hazırlanıyor" ekranı görünürken yapılıyor
    try {
      await loadEmbeddingModel();
      if (aiConfig.enableClipVision) await loadClipModel();
      // Warmup: ONNX cold-start'ı ilk dosyadan önce öde
      await Promise.all([
        warmupEmbeddingModel(),
        aiConfig.enableClipVision ? warmupClipModel() : Promise.resolve(),
      ]);
    } catch { /* Model yüklenemedi, embedding olmadan devam */ }

    const visionConfig = (aiConfig.apiKey || aiConfig.apiProvider === 'ollama') ? aiConfig : undefined;

    const lpRef: { current: ScanProgress | null } = { current: null };
    let assets: Asset[];
    try {
      assets = await scanDirectory(
        (progress) => { lpRef.current = progress; setScanProgress({ ...progress }); },
        getEmbeddingStatus().isReady,
        controller,
        withColorExtract,
        visionConfig,
        selectedPaths,
        undefined, // forcePaths
        undefined, // onConfirmLargeScan
        true,      // skipFinalSave — bu hook sonda tek konsolide save yapar
      );
    } catch (err) {
      setScanProgress((prev) => prev ? { ...prev, isComplete: true } : null);
      const msg = err instanceof Error ? err.message : String(err);
      auditLog('SCAN_ERROR', 'files', {
        error: msg.substring(0, 500),
        processed: lpRef.current?.processed ?? 0,
        total: lpRef.current?.total ?? 0,
      }, 'FAIL');
      await releaseScanPriority();
      throw err;
    }

    const errs = lpRef.current?.errors;
    if (errs && errs.length > 0) {
      auditLog('SCAN_ERRORS', 'files', {
        errorCount: errs.length,
        assetCount: assets.length,
        samples: errs.slice(0, 20),
      });
    }

    scanControllerRef.current = null;
    setIsScanPaused(false);
    invalidateEmbeddingCache();
    setScannedAssets((prev) => {
      const merged = new Map(prev.map((a) => [a.id, a]));
      assets.forEach((a) => merged.set(a.id, a));
      return Array.from(merged.values());
    });

    const wasCancelled = !!lpRef.current?.isCancelled;
    // İptal'de bile kalıcı veri varsa parent klasörleri kaydet ve save'i tetikle —
    // yoksa orphan asset tutarsızlığı kalır.
    const shouldPersist = !wasCancelled || assets.length > 0;

    // Faz 1.5: Seçilen dosyaların parent dizinlerini kaynak klasör olarak kaydet
    const persistedRootIds: string[] = [];
    if (shouldPersist) {
      try {
        const parentDirs = new Set<string>();
        for (const p of selectedPaths) {
          const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
          if (idx > 0) parentDirs.add(p.slice(0, idx));
        }
        for (const dir of parentDirs) {
          const existing = getScannedRootByExactPath(dir);
          let rootId: string;
          if (existing) {
            // Çöpteki klasörü yeniden tarıyorsa otomatik geri yükle.
            ensureScannedRootActive(existing.id);
            rootId = existing.id;
          } else {
            rootId = addScannedRoot(dir, undefined, { skipSave: true });
          }
          const count = assets.filter(a => a.filePath.startsWith(dir)).length;
          updateRootScanInfo(rootId, count, { skipSave: true });
          persistedRootIds.push(rootId);
        }
        useStore.getState().setScannedRoots(getScannedRoots());
      } catch { /* Kök kaydı başarısız olsa bile tarama sonucunu bozmayalım */ }
    }

    // Cleanup yok bu akışta → tam saveDatabase'e gerek yok; her root için tek satır mirror yeter.
    if (shouldPersist) {
      for (const rootId of persistedRootIds) {
        try { await persistScannedRootToDisk(rootId); } catch { /* non-fatal */ }
      }
    }

    await releaseScanPriority();
  }, [aiConfig, setScannedAssets, activeArchive]);

  /** Scan a pre-determined list of file paths without showing a file-picker dialog. */
  const handleScanSpecificFiles = useCallback(async (paths: string[], withColorExtract = false) => {
    if (!paths || paths.length === 0) return;
    setScanProgress({ total: 0, processed: 0, current: '', errors: [], isComplete: false, isPreparing: true });
    setIsScanPaused(false);

    // Tarama öncesi otomatik DB yedeği
    await createSnapshot(activeArchive);

    await acquireScanPriority();

    const controller = new ScanController();
    scanControllerRef.current = controller;

    try {
      await loadEmbeddingModel();
      if (aiConfig.enableClipVision) await loadClipModel();
      // Warmup: ONNX cold-start'ı ilk dosyadan önce öde
      await Promise.all([
        warmupEmbeddingModel(),
        aiConfig.enableClipVision ? warmupClipModel() : Promise.resolve(),
      ]);
    } catch { /* Model yüklenemedi, embedding olmadan devam */ }

    const visionConfig = (aiConfig.apiKey || aiConfig.apiProvider === 'ollama') ? aiConfig : undefined;

    auditLog('SCAN_START', 'specific-files', { fileCount: paths.length, withColorExtract });

    const forcePaths = new Set(paths);
    const lpRef: { current: ScanProgress | null } = { current: null };
    let assets: Asset[];
    try {
      assets = await scanDirectory(
        (progress) => { lpRef.current = progress; setScanProgress({ ...progress }); },
        getEmbeddingStatus().isReady,
        controller,
        withColorExtract,
        visionConfig,
        paths,
        forcePaths,
        undefined, // onConfirmLargeScan
        true,      // skipFinalSave — bu hook sonda tek konsolide save yapar
      );
    } catch (err) {
      setScanProgress((prev) => prev ? { ...prev, isComplete: true } : null);
      const msg = err instanceof Error ? err.message : String(err);
      auditLog('SCAN_ERROR', 'specific-files', {
        error: msg.substring(0, 500),
        processed: lpRef.current?.processed ?? 0,
        total: lpRef.current?.total ?? 0,
      }, 'FAIL');
      await releaseScanPriority();
      throw err;
    }

    const errs = lpRef.current?.errors;
    if (errs && errs.length > 0) {
      auditLog('SCAN_ERRORS', 'specific-files', {
        errorCount: errs.length,
        assetCount: assets.length,
        samples: errs.slice(0, 20),
      });
    }

    scanControllerRef.current = null;
    setIsScanPaused(false);
    invalidateEmbeddingCache();
    setScannedAssets((prev) => {
      const merged = new Map(prev.map((a) => [a.id, a]));
      assets.forEach((a) => merged.set(a.id, a));
      return Array.from(merged.values());
    });

    // Tüm yeni veri rusqlite ile diske yazıldı (assets/embeddings/chunks/dwg_shapes/relations).
    // scanned_roots değişikliği yok bu akışta → ek persist gereksiz.

    await releaseScanPriority();
  }, [aiConfig, setScannedAssets, activeArchive]);

  const handleCloseScanModal = useCallback(() => {
    setIsScanModalOpen(false);
    setScanProgress(null);
  }, [setIsScanModalOpen]);

  const clearPendingRescanPaths = useCallback(() => {
    setPendingRescanPaths(null);
  }, [setPendingRescanPaths]);

  return {
    scanProgress,
    isScanPaused,
    scanControllerRef,
    handleStartScan,
    handleRescanFolder,
    handlePauseScan,
    handleResumeScan,
    handleCancelScan,
    handleCloseScanModal,
    handleScanFiles,
    handleScanSpecificFiles,
    pendingRescanPaths,
    clearPendingRescanPaths,
  };
}
