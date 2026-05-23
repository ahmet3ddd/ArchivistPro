import { useState, useCallback } from 'react';
import ExplorerView from './ExplorerView';
import DashboardView from './DashboardView';
import TechnicalView from './TechnicalView';
import FoldersView from './FoldersView';
import DetailPanel from './DetailPanel';
import DropZone from './DropZone';
import ModalErrorBoundary from './ModalErrorBoundary';
import BlankContextMenu from './BlankContextMenu';
import SkeletonGrid from './SkeletonGrid';
import type { Asset } from '../types';
import type { MatchSource } from '../services/queryExpansion';
import type { ScannedRoot } from '../services/database';

interface MainViewContainerProps {
  viewMode: string;
  filteredAssets: Asset[];
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;
  searchScoreMap?: Record<string, number>;
  cardSize: number;
  totalAssetCount: number;
  selectedAsset: Asset | null;
  onUpdateAsset: (updated: Asset) => void;
  matchSources?: MatchSource[];
  scannedRoots?: ScannedRoot[];
  onOpenFolder?: (root: ScannedRoot) => void;
  onStartScan?: () => void;
  onRescanFolder?: (path: string) => void;
  isLoading?: boolean;
}

export default function MainViewContainer({
  viewMode,
  filteredAssets,
  selectedAssetId,
  setSelectedAssetId,
  searchScoreMap,
  cardSize,
  totalAssetCount,
  selectedAsset,
  onUpdateAsset,
  matchSources,
  scannedRoots,
  onOpenFolder,
  onStartScan,
  onRescanFolder,
  isLoading,
}: MainViewContainerProps) {
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [rescanFolderPath, setRescanFolderPath] = useState<string | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-context-menu]')) return;
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }, []);

  const handleFolderDrop = useCallback(async (folderPath: string) => {
    try {
      const { notifyInfo } = await import('../services/notificationCenter');
      const { useStore: getStore } = await import('../store/useStore');
      notifyInfo('Drop', `${folderPath}`);
      getStore.getState().setIsScanModalOpen(true);
    } catch { /* sessiz */ }
  }, []);

  return (
    <DropZone onFolderDrop={handleFolderDrop}>
    <div
      style={{ flex: 1, display: 'flex', overflow: 'hidden' }}
      onContextMenu={handleContextMenu}
    >
      <div key={viewMode} className="animate-view-enter" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {isLoading && viewMode !== 'dashboard' && <SkeletonGrid cardSize={cardSize} />}
        {!isLoading && viewMode === 'folders' && (
          <FoldersView
            roots={scannedRoots ?? []}
            onOpenFolder={onOpenFolder ?? (() => {})}
            onStartScan={onStartScan}
            onFolderRightClick={(root) => setRescanFolderPath(root.path)}
          />
        )}
        {!isLoading && viewMode === 'explorer' && (
          <ExplorerView
            assets={filteredAssets}
            selectedAssetId={selectedAssetId}
            onSelectAsset={setSelectedAssetId}
            searchScoreMap={searchScoreMap}
            cardSize={cardSize}
            totalAssetCount={totalAssetCount}
          />
        )}
        {!isLoading && viewMode === 'dashboard' && <DashboardView assets={filteredAssets} />}
        {!isLoading && viewMode === 'technical' && (
          <TechnicalView
            assets={filteredAssets}
            selectedAssetId={selectedAssetId}
            onSelectAsset={setSelectedAssetId}
            searchScoreMap={searchScoreMap}
          />
        )}
      </div>

      {selectedAsset && viewMode !== 'dashboard' && (
        <ModalErrorBoundary onClose={() => setSelectedAssetId(null)}>
          <DetailPanel
            asset={selectedAsset}
            onClose={() => setSelectedAssetId(null)}
            onUpdate={onUpdateAsset}
            matchSources={matchSources}
          />
        </ModalErrorBoundary>
      )}

      {menuPos && (
        <BlankContextMenu
          x={menuPos.x}
          y={menuPos.y}
          assetIds={filteredAssets.map(a => a.id)}
          onClose={() => { setMenuPos(null); setRescanFolderPath(null); }}
          rescanFolderPath={rescanFolderPath ?? undefined}
          onRescanFolder={onRescanFolder}
        />
      )}
    </div>
    </DropZone>
  );
}
