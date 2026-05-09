import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import './index.css';
import { useShallow } from 'zustand/react/shallow';

import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import MainViewContainer from './components/MainViewContainer';
import StorageWarningBanner from './components/StorageWarningBanner';
import ModalPortal from './components/ModalPortal';
import ErrorBoundary from './components/ErrorBoundary';
import ToastContainer from './components/Toast';
import StatusBar from './components/StatusBar';
import LoginScreen from './components/LoginScreen';
import LockScreen from './components/LockScreen';
import SessionTimeoutManager from './components/SessionTimeoutManager';
import SetupWizard from './components/SetupWizard';
import OnboardingTour from './components/OnboardingTour';
import UpdateNotification from './components/UpdateNotification';
import AutoRagIndexBanner from './components/AutoRagIndexBanner';
import DbSavingIndicator from './components/DbSavingIndicator';
import { detectGpu } from './services/ollamaService';
import DuplicateFinderModal from './components/DuplicateFinderModal';
import BatchToolbar from './components/BatchToolbar';
import BatchTagModal from './components/BatchTagModal';

import { useStore } from './store/useStore';
import { useStorePersistence } from './hooks/useStorePersistence';
import { useOllamaHostAutoDetect } from './hooks/useOllamaHostAutoDetect';
import { useDatabaseAssets } from './hooks/useDatabaseAssets';
import { useStalenessMonitor } from './hooks/useStalenessMonitor';
import { useEmbeddingSearch } from './hooks/useEmbeddingSearch';
import { useHybridFilteredAssets } from './hooks/useHybridFilteredAssets';
import { useScanWorkflow } from './hooks/useScanWorkflow';
import { useImageSearch } from './hooks/useImageSearch';
import { usePerformanceSetup } from './hooks/usePerformanceSetup';
import { useStorageWarningListener } from './hooks/useStorageWarning';
import { useAppInitialization } from './hooks/useAppInitialization';
import { useAssetDeletion } from './hooks/useAssetDeletion';
import { useFolderWatcher } from './hooks/useFolderWatcher';
import {
  FOLDER_WATCH_AUTO_RESCAN_EVENT,
  type FolderWatchAutoRescanDetail,
} from './hooks/useFolderWatchSettings';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import { useDevFeedbackReceiver } from './hooks/useDevFeedbackReceiver';
import { useExitConfirmation } from './hooks/useExitConfirmation';
import { useBackupScheduler } from './hooks/useBackupScheduler';
import { undo, redo } from './services/undoRedo';
import { getTrashCount, getTrashFolderCount, getSetting } from './services/database';
import { retryEmbeddingModel } from './services/embeddings';
import { setRuntimeRole, setRuntimeDeveloper } from './permissions/roles';
import { getAllFavoriteIds } from './services/favorites';
import { hasSeenSetupWizard } from './services/systemCheck';
import { hasSeenPerformanceSetup } from './services/hardwareDetect';

export default function App() {
  const isLoggedIn = useStore((s) => s.isLoggedIn);
  const isSwitchingUser = useStore((s) => s.isSwitchingUser);
  const cancelSwitchUser = useStore((s) => s.cancelSwitchUser);
  const logout = useStore((s) => s.logout);
  const setCurrentUser = useStore((s) => s.setCurrentUser);
  const isLocked = useStore((s) => s.isLocked);
  const lockScreen = useStore((s) => s.lockScreen);
  const unlockScreen = useStore((s) => s.unlockScreen);
  const currentUser = useStore((s) => s.currentUser);

  const [wizardDone, setWizardDone] = useState(
    () => hasSeenSetupWizard() || hasSeenPerformanceSetup()
  );
  const isOnboardingTourOpen = useStore((s) => s.isOnboardingTourOpen);
  const setIsOnboardingTourOpen = useStore((s) => s.setIsOnboardingTourOpen);


  useStorePersistence();
  useOllamaHostAutoDetect();

  // GPU tespiti — uygulama başında bir kere
  useEffect(() => {
    detectGpu().then((has) => useStore.getState().setGpuAvailable(has));
  }, []);
  useStorageWarningListener();
  useDevFeedbackReceiver();
  useExitConfirmation({ enabled: isLoggedIn && !isSwitchingUser });
  useBackupScheduler({ enabled: isLoggedIn && !isSwitchingUser });
  const isScanInProgress = useStore((s) => s.isScanInProgress);
  const sessionTimeoutEnabled = isLoggedIn && !isSwitchingUser && !isLocked && !isScanInProgress;

  const { t } = useTranslation();

  const db = useDatabaseAssets();
  const { undoRedoState, recoveryReady, isFirstRun, setIsFirstRun, showHelp, setShowHelp } = useAppInitialization(db.dbReady);
  const [helpInitialMode, setHelpInitialMode] = useState<string | undefined>(undefined);
  useFolderWatcher(db.dbReady);

  // Global event: ayarlardan veya başka yerden HelpPanel'i belirli sekmeyle açma
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.mode) setHelpInitialMode(detail.mode);
      setShowHelp(true);
    };
    window.addEventListener('archivistpro:help-open', handler);
    return () => window.removeEventListener('archivistpro:help-open', handler);
  }, [setShowHelp]);

  // Arka planda dosya güncellik takibi — Sidebar sağlık rozeti için
  const activeArchiveForStaleness = useStore((s) => s.activeArchive);
  const { startCheck: startStalenessCheck } = useStalenessMonitor(
    db.allAssets,
    db.dbReady ? activeArchiveForStaleness : null,
  );

  // Session timeout ayarını DB'den oku (DB hazır oldugunda)
  const setSessionTimeoutMinutes = useStore((s) => s.setSessionTimeoutMinutes);
  useEffect(() => {
    if (!db.dbReady) return;
    const saved = getSetting('session_timeout_minutes');
    if (saved !== null) {
      const val = parseInt(saved, 10);
      if (!isNaN(val) && val >= 0) setSessionTimeoutMinutes(val);
    }
  }, [db.dbReady, setSessionTimeoutMinutes]);

  // Başlangıç görünümü: 2+ kaynak klasör varsa 'folders' ile aç
  const setViewMode = useStore((s) => s.setViewMode);
  const _viewModeInitialized = useRef(false);
  useEffect(() => {
    if (!isLoggedIn || !db.dbReady || _viewModeInitialized.current) return;
    _viewModeInitialized.current = true;
    const roots = useStore.getState().scannedRoots.filter(r => r.status === 'active');
    if (roots.length >= 2) {
      setViewMode('folders');
    }
  }, [isLoggedIn, db.dbReady, setViewMode]);



  const ui = useStore(
    useShallow((s) => ({
      viewMode: s.viewMode,
      setViewMode: s.setViewMode,
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      activeFilters: s.activeFilters,
      selectedAssetId: s.selectedAssetId,
      setSelectedAssetId: s.setSelectedAssetId,
      setIsScanModalOpen: s.setIsScanModalOpen,
      setIsAiConfigOpen: s.setIsAiConfigOpen,
      setIsRefileModalOpen: s.setIsRefileModalOpen,
      isImageSearching: s.isImageSearching,
      imageSearchActive: s.imageSearchActive,
      setImageSearchActive: s.setImageSearchActive,
      toggleFacetFilter: s.toggleFacetFilter,
      cardSize: s.cardSize,
      setCardSize: s.setCardSize,
      facetConfig: s.facetConfig,
      setFacetConfig: s.setFacetConfig,
      aiConfig: s.aiConfig,
      setAiConfig: s.setAiConfig,
      searchSensitivity: s.searchSensitivity,
      setSearchSensitivity: s.setSearchSensitivity,
    }))
  );

  const semanticResults = useStore((s) => s.semanticResults);
  const { embeddingStatus, isSearching, isVisualVectorQuery } = useEmbeddingSearch();
  const perf = usePerformanceSetup();

  const scan = useScanWorkflow({
    aiConfig: ui.aiConfig,
    embeddingReady: embeddingStatus.isReady,
    allAssets: db.allAssets,
  });

  // Folder watcher → opt-in otomatik yeniden tarama: useFolderWatcher 60sn sessizlik sonrası
  // bu event'i yayar; burada scan tetiklenir (scan zaten aktifse atlanır).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<FolderWatchAutoRescanDetail>).detail;
      if (!detail?.rootPath) return;
      if (useStore.getState().isScanInProgress) return;
      void scan.handleRescanFolder(detail.rootPath);
    };
    window.addEventListener(FOLDER_WATCH_AUTO_RESCAN_EVENT, handler);
    return () => window.removeEventListener(FOLDER_WATCH_AUTO_RESCAN_EVENT, handler);
  }, [scan]);

  const { handleImageSearch, cancelImageSearch } = useImageSearch({
    embeddingStatus,
    aiConfig: ui.aiConfig,
    allAssets: db.allAssets,
  });

  const { filteredAssets: hybridFiltered, selectedAsset, matchSources, searchScoreMap, indexingStatus } =
    useHybridFilteredAssets({
      allAssets: db.allAssets,
      scanProgress: scan.scanProgress,
      isVisualVectorQuery,
    });

  // Kullanıcı arama kutusuna yazmaya başladığında görsel arama modunu kapat —
  // böylece metin araması devreye girer, eski görsel sonuçlar kalıcı kalmaz.
  useEffect(() => {
    if (ui.imageSearchActive && ui.searchQuery.trim().length > 0) {
      ui.setImageSearchActive(false);
    }
  }, [ui.searchQuery, ui.imageSearchActive, ui.setImageSearchActive]);

  const showOnlyFavorites = useStore((s) => s.showOnlyFavorites);
  const filteredAssets = useMemo(() => {
    if (!showOnlyFavorites) return hybridFiltered;
    const favIds = new Set(getAllFavoriteIds());
    return hybridFiltered.filter(a => favIds.has(a.id));
  }, [hybridFiltered, showOnlyFavorites]);

  const sortBy = useStore((s) => s.sortBy);
  const sortOrder = useStore((s) => s.sortOrder);
  const sortedAssets = useMemo(() => {
    const arr = [...filteredAssets];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.fileName.localeCompare(b.fileName, 'tr', { sensitivity: 'base' });
      else if (sortBy === 'date') cmp = (a.createdAt || '').localeCompare(b.createdAt || '');
      else if (sortBy === 'modified') cmp = (a.modifiedAt || '').localeCompare(b.modifiedAt || '');
      else if (sortBy === 'type') cmp = a.fileType.localeCompare(b.fileType);
      else if (sortBy === 'size') cmp = (a.fileSize || 0) - (b.fileSize || 0);
      else if (sortBy === 'aiScore') {
        const score = (x: typeof a) => x.aiTags?.filter(t => t.source === 'clip').reduce((m, t) => Math.max(m, t.confidence), 0) ?? 0;
        cmp = score(a) - score(b);
      }
      // Secondary sort: eşitlikte modifiedAt ile kır (en yeni önce)
      if (cmp === 0 && sortBy !== 'modified') {
        cmp = (b.modifiedAt || '').localeCompare(a.modifiedAt || '');
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [filteredAssets, sortBy, sortOrder]);

  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);
  const unreadMessageCount = useStore((s) => s.unreadMessageCount);

  const { handleDelete } = useAssetDeletion(filteredAssets);
  const updateChecker = useUpdateChecker(isLoggedIn);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Klasörler görünümünden drill-down yapıldı mı — geri chip'i için
  const [folderDrillDown, setFolderDrillDown] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const showDuplicateFinder = useStore((s) => s.duplicateFinderOpen);
  const duplicateFinderSeedAssetId = useStore((s) => s.duplicateFinderSeedAssetId);
  const duplicateFinderInitialThreshold = useStore((s) => s.duplicateFinderInitialThreshold);
  const setDuplicateFinderOpen = useStore((s) => s.setDuplicateFinderOpen);
  const [showBatchTagModal, setShowBatchTagModal] = useState(false);
  const [trashCount, setTrashCount] = useState<{ files: number; folders: number }>({ files: 0, folders: 0 });

  const selectedAssetIds = useStore((s) => s.selectedAssetIds);
  const clearAssetSelection = useStore((s) => s.clearAssetSelection);
  const selectAllAssets = useStore((s) => s.selectAllAssets);
  const showConfirmDialog = useStore((s) => s.showConfirmDialog);

  const scannedRoots = useStore((s) => s.scannedRoots);

  const refreshTrashCount = useCallback(() => {
    if (db.dbReady) setTrashCount({ files: getTrashCount(), folders: getTrashFolderCount() });
  }, [db.dbReady]);

  // Çöp kutusu sayılarını: DB hazır olduğunda, asset listesi veya kök klasör listesi değiştiğinde güncelle.
  // scannedRoots dep'i — bir klasör soft-delete edildiğinde badge anlık güncellensin.
  useEffect(() => {
    refreshTrashCount();
  }, [refreshTrashCount, db.allAssets, scannedRoots]);
  const setActiveRootFilters = useStore((s) => s.setActiveRootFilters);
  const clearRootFilters = useStore((s) => s.clearRootFilters);
  const activeRootFilters = useStore((s) => s.activeRootFilters);
  const activeTagFilters = useStore((s) => s.activeTagFilters);

  // Klasörler → Explorer drill-down
  const handleOpenFolder = useCallback((root: import('./services/database').ScannedRoot) => {
    setActiveRootFilters([root.path]);
    ui.setViewMode('explorer');
    setFolderDrillDown(true);
  }, [setActiveRootFilters, ui]);

  const handleBackToFolders = useCallback(() => {
    clearRootFilters();
    ui.setViewMode('folders');
    setFolderDrillDown(false);
  }, [clearRootFilters, ui]);

  // Aktif klasör etiketi — geri chip'i için
  const activeFolderLabel = useMemo(() => {
    if (!folderDrillDown || activeRootFilters.length === 0) return null;
    const root = scannedRoots.find(r => r.path === activeRootFilters[0]);
    return root?.label || activeRootFilters[0].split(/[\\/]/).pop() || null;
  }, [folderDrillDown, activeRootFilters, scannedRoots]);

  // Context-first kuralı: bağlam yoksa → FoldersView; bağlam varsa → Explorer
  const _cfViewMode = ui.viewMode;
  const _cfSearch = ui.searchQuery;
  const _cfFacets = ui.activeFilters;
  useEffect(() => {
    const hasContext =
      activeRootFilters.length > 0 ||
      activeTagFilters.length > 0 ||
      _cfSearch.trim().length > 0 ||
      ui.imageSearchActive ||
      showOnlyFavorites ||
      Object.values(_cfFacets || {}).some((v) => v && v.length > 0);

    // Bağlam yok + Explorer/Technical → FoldersView'a yönlendir
    if ((_cfViewMode === 'explorer' || _cfViewMode === 'technical') && !hasContext) {
      ui.setViewMode('folders');
      setFolderDrillDown(false);
      return;
    }
    // Bağlam oluştu (search/tag/facet/root) + FoldersView'daysa → Explorer'a geç
    if (_cfViewMode === 'folders' && hasContext) {
      ui.setViewMode('explorer');
      setFolderDrillDown(false);
    }
  }, [activeRootFilters, activeTagFilters, _cfSearch, _cfFacets, _cfViewMode, ui.imageSearchActive, showOnlyFavorites, ui]);
  // ui.setViewMode dep'e girmeyecek — sadece reaktif okuma, döngü riski yok

  // Setup wizard guard — ilk calistirilmada gosterilir
  if (db.dbReady && !wizardDone) {
    return <SetupWizard onComplete={() => setWizardDone(true)} />;
  }

  // Kilit ekranı guard — timeout sonrası oturum açık ama ekran kilitli
  if (isLoggedIn && isLocked) {
    return (
      <LockScreen
        username={currentUser || ''}
        onUnlock={unlockScreen}
        onSwitchUser={logout}
      />
    );
  }

  // Login guard (ilk giriş veya kullanıcı değiştirme)
  if (!isLoggedIn || isSwitchingUser) {
    const handleLogin = (username: string, role: 'admin' | 'viewer', userId: number, isBlocked: boolean, isDeveloper: boolean) => {
      // Kullanıcı değiştirme modundaysa önce mevcut oturumu kapat
      if (isSwitchingUser) {
        import('./services/logger').then(m => m.auditLog('USER_LOGOUT', useStore.getState().currentUser || ''));
        logout();
        setRuntimeRole(null);
        setRuntimeDeveloper(false);
      }
      setCurrentUser(username, role, userId, isBlocked, isDeveloper);
      setRuntimeRole(role);
      setRuntimeDeveloper(isDeveloper);
      import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('tauri_set_session_role', { role }).catch(() => {});
        invoke('tauri_set_session_developer', { isDeveloper }).catch(() => {});
      });
      if (isBlocked) {
        import('./services/database').then(({ setActiveArchive: setDbArchive, LOCAL_ARCHIVE_ID }) => {
          useStore.getState().setActiveArchive(LOCAL_ARCHIVE_ID);
          setDbArchive(LOCAL_ARCHIVE_ID);
        });
        import('./services/notificationCenter').then(m =>
          m.notifyWarning(i18n.t('userMgmt.blockNotification.subject'), i18n.t('userMgmt.blockNotification.body'))
        );
      } else {
        import('./services/notificationCenter').then(m =>
          m.notifySuccess(i18n.t('login.toast.success'), i18n.t('login.toast.successBody', { username, role: i18n.t(role === 'admin' ? 'common.role.admin' : 'common.role.viewer') }))
        );
      }
      import('./services/logger').then(m => m.auditLog('USER_LOGIN', username));
    };

    return (
      <LoginScreen
        dbReady={db.dbReady && recoveryReady}
        dbError={db.dbError}
        isFirstRun={isFirstRun}
        onFirstRunComplete={() => setIsFirstRun(false)}
        onLogin={handleLogin}
        onCancel={isSwitchingUser ? cancelSwitchUser : undefined}
      />
    );
  }

  // DB yükleniyor
  if (!db.dbReady) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        flexDirection: 'column', gap: 12,
      }}>
        {db.dbError ? (
          <>
            <div style={{ fontSize: 32, opacity: 0.4 }}>⚠</div>
            <div style={{ fontSize: 14, color: '#f87171', textAlign: 'center', maxWidth: 400 }}>{db.dbError}</div>
            <button className="btn btn-primary" onClick={() => window.location.reload()} style={{ marginTop: 8 }}>
              {t('common.reload')}
            </button>
          </>
        ) : (
          <>
            <div className="spinner" />
            <div style={{ fontSize: 14 }}>{t('app.db.loading')}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' }}
      onContextMenu={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable) return;
        e.preventDefault();
      }}
    >
    <UpdateNotification {...updateChecker} />
    <AutoRagIndexBanner />
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div
        className={`sidebar-backdrop${sidebarOpen ? ' sidebar-backdrop--visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        assets={db.allAssets}
        activeFilters={ui.activeFilters}
        onFilterChange={ui.toggleFacetFilter}
        searchQuery={ui.searchQuery}
        onSearchChange={ui.setSearchQuery}
        onScanClick={() => ui.setIsScanModalOpen(true)}
        onRescanFolder={scan.handleRescanFolder}
        isSearching={isSearching}
        semanticActive={semanticResults !== null && semanticResults.length > 0}
        embeddingReady={embeddingStatus.isReady}
        embeddingLoading={embeddingStatus.isLoading}
        embeddingProgress={embeddingStatus.progress}
        embeddingError={embeddingStatus.error}
        onRetryEmbedding={() => {
          retryEmbeddingModel().catch(() => { /* hata state'e yazıldı */ });
        }}
        facetConfig={ui.facetConfig}
        onFacetConfigChange={ui.setFacetConfig}
        onImageSearch={handleImageSearch}
        onCancelImageSearch={cancelImageSearch}
        isImageSearching={ui.isImageSearching}
        searchSensitivity={ui.searchSensitivity}
        onSearchSensitivityChange={ui.setSearchSensitivity}
        showSensitivityControl={Boolean(ui.aiConfig.enableClipVision || ui.isImageSearching || ui.imageSearchActive)}
        sidebarOpen={sidebarOpen}
        onOpenSettings={() => setShowSettings(true)}
        onStartStalenessCheck={startStalenessCheck}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <StorageWarningBanner />
        <TopBar
          viewMode={ui.viewMode}
          onViewModeChange={(mode) => {
            // Klasörler'e gidilince root filter temizle — context-first rule ile çakışmasın
            if (mode === 'folders') {
              clearRootFilters();
              setFolderDrillDown(false);
            }
            ui.setViewMode(mode);
          }}
          indexingStatus={indexingStatus}
          resultCount={ui.viewMode === 'folders' ? scannedRoots.filter(r => r.status === 'active').length : filteredAssets.length}
          totalCount={db.allAssets.length}
          dbReady={db.dbReady}
          onRefileClick={() => ui.setIsRefileModalOpen(true)}
          hasSelectedAssets={filteredAssets.length > 0}
          onAiConfigClick={() => ui.setIsAiConfigOpen(true)}
          cardSize={ui.cardSize}
          onCardSizeChange={ui.setCardSize}
          onToggleSidebar={() => setSidebarOpen(prev => !prev)}
          activeFilters={ui.activeFilters}
          onRemoveFilter={ui.toggleFacetFilter}
          onClearFilters={() => useStore.getState().setActiveFilters({})}
          onUndoClick={() => undo()}
          onRedoClick={() => redo()}
          canUndo={undoRedoState.canUndo}
          canRedo={undoRedoState.canRedo}
          undoLabel={undoRedoState.undoLabel}
          onDeleteClick={handleDelete}
          hasSelection={!!ui.selectedAssetId}
          onTrashClick={() => setShowTrash(true)}
          onLogViewerClick={() => setShowLogs(true)}
          onSettingsClick={() => setShowSettings(true)}
          onHelpClick={() => setShowHelp(!showHelp)}
          onFeedbackClick={() => setShowFeedback(true)}
          unreadMessageCount={unreadMessageCount}
          trashCount={trashCount}
          onDuplicateFinderClick={() => setDuplicateFinderOpen(true)}
          onBackToFolders={activeFolderLabel ? handleBackToFolders : undefined}
          activeFolderLabel={activeFolderLabel}
        />

        <MainViewContainer
          viewMode={ui.viewMode}
          filteredAssets={sortedAssets}
          selectedAssetId={ui.selectedAssetId}
          setSelectedAssetId={ui.setSelectedAssetId}
          searchScoreMap={searchScoreMap}
          cardSize={ui.cardSize}
          totalAssetCount={db.allAssets.length}
          selectedAsset={selectedAsset}
          onUpdateAsset={db.handleUpdateAsset}
          matchSources={matchSources}
          scannedRoots={scannedRoots}
          onOpenFolder={handleOpenFolder}
          onStartScan={() => ui.setIsScanModalOpen(true)}
          onRescanFolder={scan.handleRescanFolder}
          isLoading={!db.dbReady}
        />
      </div>

    </div>

      <ModalPortal
        showHelp={showHelp} setShowHelp={(v) => { setShowHelp(v); if (!v) setHelpInitialMode(undefined); }} helpInitialMode={helpInitialMode}
        showSettings={showSettings} setShowSettings={setShowSettings}
        showTrash={showTrash} setShowTrash={setShowTrash} onTrashChanged={refreshTrashCount}
        showLogs={showLogs} setShowLogs={setShowLogs}
        showFeedback={showFeedback} setShowFeedback={setShowFeedback}
        scan={scan}
        embeddingStatus={embeddingStatus}
        perf={perf}
        allAssets={db.allAssets}
        filteredAssets={filteredAssets}
        aiConfig={ui.aiConfig}
        setAiConfig={ui.setAiConfig}
      />
      <DuplicateFinderModal
        isOpen={showDuplicateFinder}
        onClose={() => setDuplicateFinderOpen(false)}
        onHelpClick={() => { setDuplicateFinderOpen(false); setShowHelp(true); }}
        seedAssetId={duplicateFinderSeedAssetId}
        initialThreshold={duplicateFinderInitialThreshold}
      />
      <DbSavingIndicator />
      {selectedAssetIds.length > 0 && (
        <BatchToolbar
          selectedCount={selectedAssetIds.length}
          totalCount={filteredAssets.length}
          onAddTags={() => setShowBatchTagModal(true)}
          onSelectAll={() => {
            const ids = filteredAssets.map(a => a.id);
            if (ids.length > 50) {
              showConfirmDialog(
                t('batchToolbar.selectAllConfirmMessage', { count: ids.length }),
                t('batchToolbar.selectAllConfirmDetail'),
                () => selectAllAssets(ids),
                t('batchToolbar.confirmSelectLabel'),
                false,
              );
            } else {
              selectAllAssets(ids);
            }
          }}
          onClearSelection={clearAssetSelection}
        />
      )}
      <BatchTagModal
        isOpen={showBatchTagModal}
        onClose={() => { setShowBatchTagModal(false); clearAssetSelection(); }}
        assetIds={selectedAssetIds}
      />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <SessionTimeoutManager
        enabled={sessionTimeoutEnabled}
        onTimeout={lockScreen}
      />
      <StatusBar />
      {isOnboardingTourOpen && (
        <OnboardingTour onComplete={() => setIsOnboardingTourOpen(false)} />
      )}
    </div>
    </ErrorBoundary>
  );
}
