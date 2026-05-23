import { useStore } from '../store/useStore';
import { ProtectedAction, usePermission } from '../permissions';
import ScanModal from './ScanModal';
import RefileModal from './RefileModal';
import AISettingsModal from './AISettingsModal';
import AISetupWizard from './AISetupWizard';
import ChatPanel from './ChatPanel';
import VisualSearchModal from './VisualSearchModal';
import ShapeSearchModal from './ShapeSearchModal';
import DwgSimilarityModal from './DwgSimilarityModal';
import PerformanceSetupModal from './PerformanceSetupModal';
import FeedbackModal from './FeedbackModal';
import TrashModal from './TrashModal';
import LogViewerModal from './LogViewerModal';
import SettingsModal from './SettingsModal';
import HelpPanel from './HelpPanel';
import UserProfileModal from './UserProfileModal';
import UserManagementModal from './UserManagementModal';
import TagManagerModal from './TagManagerModal';
import ConfirmDialog from './ConfirmDialog';
import InputDialog from './InputDialog';
import ModalErrorBoundary from './ModalErrorBoundary';
import type { Asset } from '../types';
import type { HardwareTier } from '../services/hardwareDetect';
import type { EmbeddingStatus } from '../services/embeddings';

interface ModalPortalProps {
  // Local-state modals
  showHelp: boolean;
  setShowHelp: (v: boolean) => void;
  helpInitialMode?: string;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
  showTrash: boolean;
  setShowTrash: (v: boolean) => void;
  onTrashChanged?: () => void;
  showLogs: boolean;
  setShowLogs: (v: boolean) => void;
  showFeedback: boolean;
  setShowFeedback: (v: boolean) => void;
  // Scan workflow
  scan: {
    handleCloseScanModal: () => void;
    handleStartScan: (mode: 'merge' | 'replaceUnderPath' | 'fullReset', withColorExtract?: boolean) => Promise<void>;
    handleScanFiles: (withColorExtract?: boolean) => Promise<void>;
    handleScanSpecificFiles: (paths: string[], withColorExtract?: boolean) => Promise<void>;
    pendingRescanPaths: string[] | null;
    clearPendingRescanPaths: () => void;
    scanProgress: any;
    isScanPaused: boolean;
    handlePauseScan: () => void;
    handleResumeScan: () => void;
    handleCancelScan: () => void;
  };
  // Embedding
  embeddingStatus: EmbeddingStatus;
  // Performance
  perf: {
    showPerfSetup: boolean;
    hwProfile: any;
    handleApplyTier: (tier: HardwareTier) => void;
    handleSkipPerfSetup: () => void;
    handleRetestHardware: () => void;
  };
  // Data
  allAssets: Asset[];
  filteredAssets: Asset[];
  // AI config
  aiConfig: any;
  setAiConfig: (config: any) => void;
}

export default function ModalPortal({
  showHelp, setShowHelp, helpInitialMode,
  showSettings, setShowSettings,
  showTrash, setShowTrash, onTrashChanged,
  showLogs, setShowLogs,
  showFeedback, setShowFeedback,
  scan, embeddingStatus, perf,
  allAssets, filteredAssets,
  aiConfig, setAiConfig,
}: ModalPortalProps) {
  const isScanModalOpen = useStore((s) => s.isScanModalOpen);
  const isAiConfigOpen = useStore((s) => s.isAiConfigOpen);
  const setIsAiConfigOpen = useStore((s) => s.setIsAiConfigOpen);
  const isAISetupOpen = useStore((s) => s.isAISetupOpen);
  const setIsAISetupOpen = useStore((s) => s.setIsAISetupOpen);
  const isChatOpen = useStore((s) => s.isChatOpen);
  const setIsChatOpen = useStore((s) => s.setIsChatOpen);
  const isRefileModalOpen = useStore((s) => s.isRefileModalOpen);
  const setIsRefileModalOpen = useStore((s) => s.setIsRefileModalOpen);
  const isUserProfileOpen = useStore((s) => s.isUserProfileOpen);
  const isUserManagementOpen = useStore((s) => s.isUserManagementOpen);
  const isTagManagerOpen = useStore((s) => s.isTagManagerOpen);
  const activeArchive = useStore((s) => s.activeArchive);
  const archives = useStore((s) => s.archives);
  const currentArchiveDef = archives.find(a => a.id === activeArchive);
  const canScan = usePermission('archive.scan');
  const canManageLocal = usePermission('local_archive.manage');
  const scanAllowed = canScan || (currentArchiveDef?.type === 'personal' && canManageLocal);

  return (
    <>
      {scanAllowed && (
        <ModalErrorBoundary onClose={scan.handleCloseScanModal}>
          <ScanModal
            isOpen={isScanModalOpen}
            onClose={scan.handleCloseScanModal}
            onStartScan={scan.handleStartScan}
            onScanFiles={scan.handleScanFiles}
            onScanSpecificFiles={scan.handleScanSpecificFiles}
            pendingRescanPaths={scan.pendingRescanPaths}
            onClearPendingRescanPaths={scan.clearPendingRescanPaths}
            scanProgress={scan.scanProgress}
            embeddingStatus={embeddingStatus}
            isScanPaused={scan.isScanPaused}
            onPause={scan.handlePauseScan}
            onResume={scan.handleResumeScan}
            onCancel={scan.handleCancelScan}
            currentAssetCount={allAssets.length}
            hardwareTier={perf.hwProfile?.tier}
          />
        </ModalErrorBoundary>
      )}

      <ProtectedAction permission="archive.refile">
        <ModalErrorBoundary onClose={() => setIsRefileModalOpen(false)}>
          <RefileModal
            isOpen={isRefileModalOpen}
            onClose={() => setIsRefileModalOpen(false)}
            selectedAssets={filteredAssets}
          />
        </ModalErrorBoundary>
      </ProtectedAction>

      <ModalErrorBoundary onClose={() => setIsAiConfigOpen(false)}>
        <AISettingsModal
          isOpen={isAiConfigOpen}
          onClose={() => setIsAiConfigOpen(false)}
          config={aiConfig}
          onSave={(config) => {
            setAiConfig(config);
            import('../services/notificationCenter').then(m => {
              import('../i18n').then(i18nMod => m.notifySuccess(i18nMod.default.t('settings.ai.saved')));
            });
          }}
        />
      </ModalErrorBoundary>

      {isAISetupOpen && (
        <AISetupWizard
          isOpen={isAISetupOpen}
          onClose={() => setIsAISetupOpen(false)}
        />
      )}

      {perf.showPerfSetup && perf.hwProfile && (
        <ModalErrorBoundary onClose={perf.handleSkipPerfSetup}>
          <PerformanceSetupModal
            profile={perf.hwProfile}
            onApply={perf.handleApplyTier}
            onSkip={perf.handleSkipPerfSetup}
            onRetest={perf.handleRetestHardware}
          />
        </ModalErrorBoundary>
      )}

      <ModalErrorBoundary onClose={() => setShowFeedback(false)}>
        <FeedbackModal isOpen={showFeedback} onClose={() => setShowFeedback(false)} />
      </ModalErrorBoundary>
      <ModalErrorBoundary onClose={() => setShowTrash(false)}>
        <TrashModal isOpen={showTrash} onClose={() => setShowTrash(false)} onTrashChanged={onTrashChanged} />
      </ModalErrorBoundary>
      <ProtectedAction permission="logs.view">
        <ModalErrorBoundary onClose={() => setShowLogs(false)}>
          <LogViewerModal isOpen={showLogs} onClose={() => setShowLogs(false)} />
        </ModalErrorBoundary>
      </ProtectedAction>
      <ModalErrorBoundary onClose={() => setShowSettings(false)}>
        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </ModalErrorBoundary>
      <ModalErrorBoundary onClose={() => setShowHelp(false)}>
        <HelpPanel isOpen={showHelp} onClose={() => setShowHelp(false)} initialMode={helpInitialMode as any} />
      </ModalErrorBoundary>
      <ModalErrorBoundary onClose={() => useStore.getState().setIsUserProfileOpen(false)}>
        <UserProfileModal
          isOpen={isUserProfileOpen}
          onClose={() => useStore.getState().setIsUserProfileOpen(false)}
        />
      </ModalErrorBoundary>
      <ModalErrorBoundary onClose={() => useStore.getState().setIsUserManagementOpen(false)}>
        <UserManagementModal
          isOpen={isUserManagementOpen}
          onClose={() => useStore.getState().setIsUserManagementOpen(false)}
        />
      </ModalErrorBoundary>
      <ModalErrorBoundary onClose={() => useStore.getState().setIsTagManagerOpen(false)}>
        <TagManagerModal
          isOpen={isTagManagerOpen}
          onClose={() => useStore.getState().setIsTagManagerOpen(false)}
        />
      </ModalErrorBoundary>
      {isChatOpen && (
        <ModalErrorBoundary onClose={() => setIsChatOpen(false)}>
          <ChatPanel
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            aiConfig={aiConfig}
          />
        </ModalErrorBoundary>
      )}
      {useStore((s) => s.isVisualSearchOpen) && (
        <ModalErrorBoundary onClose={() => useStore.getState().setIsVisualSearchOpen(false)}>
          <VisualSearchModal
            isOpen
            onClose={() => useStore.getState().setIsVisualSearchOpen(false)}
            aiConfig={aiConfig}
          />
        </ModalErrorBoundary>
      )}
      {useStore((s) => s.isShapeSearchOpen) && (
        <ModalErrorBoundary onClose={() => useStore.getState().setIsShapeSearchOpen(false)}>
          <ShapeSearchModal
            isOpen
            onClose={() => useStore.getState().setIsShapeSearchOpen(false)}
          />
        </ModalErrorBoundary>
      )}
      {useStore((s) => s.dwgSimilarityAssetId) && (
        <ModalErrorBoundary onClose={() => useStore.getState().setDwgSimilarityAssetId(null)}>
          <DwgSimilarityModal />
        </ModalErrorBoundary>
      )}
      <ModalErrorBoundary onClose={() => {}}>
        <ConfirmDialog />
      </ModalErrorBoundary>
      <ModalErrorBoundary onClose={() => {}}>
        <InputDialog />
      </ModalErrorBoundary>
    </>
  );
}
