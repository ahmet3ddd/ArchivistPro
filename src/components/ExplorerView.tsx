import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderSearch, FilterX } from 'lucide-react';
import { VirtuosoGrid } from 'react-virtuoso';
import type { Asset } from '../types';
import AssetCard from './AssetCard';
import AssetContextMenu from './AssetContextMenu';
import EmptyStateIllustration from './EmptyStateIllustration';
import { useStore } from '../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { useAssetContextMenu } from '../hooks/useAssetContextMenu';
import { useAutoRagIndexEnabled } from '../hooks/useAutoRagIndexEnabled';

interface ExplorerViewProps {
    assets: Asset[];
    selectedAssetId: string | null;
    onSelectAsset: (id: string) => void;
    searchScoreMap?: Record<string, number>;
    cardSize?: number;
    /** Toplam arşiv asset sayısı (boş arşiv vs sonuç yok ayrımı için) */
    totalAssetCount?: number;
}

const VIRTUALIZE_THRESHOLD = 200;

export default function ExplorerView({ assets, selectedAssetId, onSelectAsset, searchScoreMap, cardSize, totalAssetCount = 0 }: ExplorerViewProps) {
    const { t } = useTranslation();
    const autoRagIndexOn = useAutoRagIndexEnabled();
    const { setIsScanModalOpen, setActiveFilters, setSearchQuery, selectedAssetIds, toggleAssetSelection, clearAssetSelection, selectAllAssets } = useStore(useShallow((s) => ({
        setIsScanModalOpen: s.setIsScanModalOpen,
        setActiveFilters: s.setActiveFilters,
        setSearchQuery: s.setSearchQuery,
        selectedAssetIds: s.selectedAssetIds,
        toggleAssetSelection: s.toggleAssetSelection,
        clearAssetSelection: s.clearAssetSelection,
        selectAllAssets: s.selectAllAssets,
    })));

    const minColWidth = cardSize ?? 220;
    const isMultiSelectMode = selectedAssetIds.length > 0;

    // Shift+Click aralık seçimi için son tıklanan index
    const lastClickedIndexRef = useRef<number>(-1);

    const { menuState, targetAsset, handleContextMenu, closeMenu } = useAssetContextMenu(assets);

    const handleShiftClick = useCallback((index: number) => {
        const last = lastClickedIndexRef.current;
        if (last < 0) {
            toggleAssetSelection(assets[index].id);
            lastClickedIndexRef.current = index;
            return;
        }
        const start = Math.min(last, index);
        const end = Math.max(last, index);
        const rangeIds = assets.slice(start, end + 1).map(a => a.id);
        const existing = useStore.getState().selectedAssetIds;
        selectAllAssets(Array.from(new Set([...existing, ...rangeIds])));
    }, [assets, toggleAssetSelection, selectAllAssets]);

    const gridComponents = useMemo(() => ({
        List: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
            <div
                ref={ref}
                {...props}
                style={{
                    ...props.style,
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fill, minmax(${minColWidth}px, 1fr))`,
                    gap: 12,
                    alignContent: 'start',
                }}
            />
        )),
        Item: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
            <div {...props} style={{ ...props.style }}>
                {children}
            </div>
        ),
    }), [minColWidth]);

    const scrollerRef = useRef<HTMLDivElement>(null);

    const renderItem = useCallback((index: number) => {
        const asset = assets[index];
        return (
            <AssetCard
                key={asset.id}
                asset={asset}
                isSelected={asset.id === selectedAssetId || selectedAssetIds.includes(asset.id)}
                isMultiSelectMode={isMultiSelectMode}
                onOpen={() => { clearAssetSelection(); onSelectAsset(asset.id); lastClickedIndexRef.current = index; }}
                onToggle={() => { toggleAssetSelection(asset.id); lastClickedIndexRef.current = index; }}
                onShiftClick={() => handleShiftClick(index)}
                onContextMenu={(e) => handleContextMenu(e, asset.id)}
                index={index}
                searchScore={searchScoreMap ? searchScoreMap[asset.id] : undefined}
            />
        );
    }, [assets, selectedAssetId, selectedAssetIds, isMultiSelectMode, onSelectAsset, clearAssetSelection, toggleAssetSelection, handleShiftClick, handleContextMenu, searchScoreMap]);

    if (assets.length === 0) {
        const isArchiveEmpty = totalAssetCount === 0;

        return (
            <div style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', gap: 16, color: 'var(--color-text-muted)',
                padding: 40,
            }}>
                {isArchiveEmpty ? (
                    <>
                        <EmptyStateIllustration type="empty-archive" />
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}>
                            {t('explorer.empty.title')}
                        </div>
                        <div style={{ fontSize: '0.82rem', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
                            {t('explorer.empty.description')}
                        </div>
                        <button
                            className="btn btn-primary"
                            onClick={() => setIsScanModalOpen(true)}
                            style={{ marginTop: 8, padding: '10px 24px' }}
                        >
                            <FolderSearch size={16} />
                            {autoRagIndexOn ? t('explorer.empty.scanButton') : t('explorer.empty.scanButtonOnly')}
                        </button>
                    </>
                ) : (
                    <>
                        <EmptyStateIllustration type="no-results" />
                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}>
                            {t('explorer.noResults.title')}
                        </div>
                        <div style={{ fontSize: '0.82rem', textAlign: 'center', maxWidth: 360, lineHeight: 1.6 }}>
                            {t('explorer.noResults.description')}
                        </div>
                        <button
                            className="btn btn-ghost"
                            onClick={() => { setActiveFilters({}); setSearchQuery(''); }}
                            style={{ marginTop: 8, padding: '8px 20px' }}
                        >
                            <FilterX size={14} />
                            {t('explorer.noResults.clearFilters')}
                        </button>
                    </>
                )}
            </div>
        );
    }

    const contextMenuPortal = menuState.visible && targetAsset
        ? <AssetContextMenu x={menuState.x} y={menuState.y} asset={targetAsset} onClose={closeMenu} />
        : null;

    // Az sayıda asset varsa virtualization overhead'ı gereksiz — düz render
    if (assets.length < VIRTUALIZE_THRESHOLD) {
        return (
            <>
                <div style={{
                    flex: 1, overflowY: 'auto', padding: '16px 16px 16px 16px',
                }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: `repeat(auto-fill, minmax(${minColWidth}px, 1fr))`,
                        gap: 12,
                        alignContent: 'start',
                        minHeight: '100%',
                    }}>
                        {assets.map((asset, i) => (
                            <AssetCard
                                key={asset.id}
                                asset={asset}
                                isSelected={asset.id === selectedAssetId || selectedAssetIds.includes(asset.id)}
                                isMultiSelectMode={isMultiSelectMode}
                                onOpen={() => { clearAssetSelection(); onSelectAsset(asset.id); lastClickedIndexRef.current = i; }}
                                onToggle={() => { toggleAssetSelection(asset.id); lastClickedIndexRef.current = i; }}
                                onShiftClick={() => handleShiftClick(i)}
                                onContextMenu={(e) => handleContextMenu(e, asset.id)}
                                index={i}
                                searchScore={searchScoreMap ? searchScoreMap[asset.id] : undefined}
                            />
                        ))}
                    </div>
                </div>
                {contextMenuPortal}
            </>
        );
    }

    return (
        <>
            <div ref={scrollerRef} style={{ flex: 1, padding: '16px 16px 16px 16px' }}>
                <VirtuosoGrid
                    totalCount={assets.length}
                    components={gridComponents}
                    itemContent={renderItem}
                    overscan={300}
                    style={{ height: '100%' }}
                />
            </div>
            {contextMenuPortal}
        </>
    );
}
