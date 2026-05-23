import { useState, useMemo, useCallback, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TableVirtuoso } from 'react-virtuoso';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { Asset } from '../types';
import { formatFileSize, formatDate, getTypeBadgeStyle } from '../data';
import AssetContextMenu from './AssetContextMenu';
import { useAssetContextMenu } from '../hooks/useAssetContextMenu';

interface TechnicalViewProps {
    assets: Asset[];
    selectedAssetId: string | null;
    onSelectAsset: (id: string) => void;
    searchScoreMap?: Record<string, number>;
}

type SortKey = keyof Asset;
type SortDirection = 'asc' | 'desc';

type VirtuosoCtx = {
    selectedAssetId: string | null;
    onSelectAsset: (id: string) => void;
    searchScoreMap?: Record<string, number>;
    data: Asset[];
    onRowContextMenu?: (e: React.MouseEvent, assetId: string) => void;
};

// Stable component definitions for react-virtuoso (defined outside to avoid re-creation)
const VTable = forwardRef<HTMLTableElement, React.HTMLProps<HTMLTableElement>>((props, ref) => (
    <table {...props} ref={ref} className="tech-table" />
));
VTable.displayName = 'VTable';

function VTableRow({ context: ctx, ...props }: any) {
    const asset = ctx?.data?.[props['data-index']];
    return (
        <tr
            {...props}
            className={asset?.id === ctx?.selectedAssetId ? 'selected' : ''}
            style={{ cursor: 'pointer' }}
            onClick={() => asset && ctx?.onSelectAsset(asset.id)}
            onContextMenu={(e: React.MouseEvent) => asset && ctx?.onRowContextMenu?.(e, asset.id)}
        />
    );
}

const virtuosoComponents = {
    Table: VTable,
    TableRow: VTableRow,
};

export default function TechnicalView({ assets, selectedAssetId, onSelectAsset, searchScoreMap }: TechnicalViewProps) {
    const { t } = useTranslation();
    const [sortKey, setSortKey] = useState<SortKey>('modifiedAt');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const { menuState, targetAsset, handleContextMenu, closeMenu } = useAssetContextMenu(assets);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDirection('asc');
        }
    };

    const sortedAssets = useMemo(() => {
        const sorted = [...assets].sort((a, b) => {
            const valA = a[sortKey];
            const valB = b[sortKey];

            if (valA === valB) return 0;
            if (valA == null) return sortDirection === 'asc' ? 1 : -1;
            if (valB == null) return sortDirection === 'asc' ? -1 : 1;

            if (typeof valA === 'string' && typeof valB === 'string') {
                return sortDirection === 'asc'
                    ? valA.localeCompare(valB)
                    : valB.localeCompare(valA);
            }
            if (typeof valA === 'number' && typeof valB === 'number') {
                return sortDirection === 'asc' ? valA - valB : valB - valA;
            }
            return 0;
        });
        return sorted;
    }, [assets, sortKey, sortDirection]);

    const context = useMemo<VirtuosoCtx>(() => ({
        selectedAssetId,
        onSelectAsset,
        searchScoreMap,
        data: sortedAssets,
        onRowContextMenu: handleContextMenu,
    }), [selectedAssetId, onSelectAsset, searchScoreMap, sortedAssets, handleContextMenu]);

    const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
        if (sortKey !== columnKey) return null;
        return sortDirection === 'asc'
            ? <ArrowUp size={12} style={{ marginLeft: 4, display: 'inline-block', verticalAlign: 'middle' }} />
            : <ArrowDown size={12} style={{ marginLeft: 4, display: 'inline-block', verticalAlign: 'middle' }} />;
    };

    const renderHeader = (label: string, key: SortKey, width?: number) => (
        <th
            style={{ width, cursor: 'pointer', userSelect: 'none' }}
            onClick={() => handleSort(key)}
            title={t('technical.tooltip.sortColumn')}
        >
            {label}
            <SortIcon columnKey={key} />
        </th>
    );

    const itemContent = useCallback((index: number, asset: Asset, ctx: VirtuosoCtx) => {
        const badgeStyle = getTypeBadgeStyle(asset.fileType);
        const scoreMap = ctx.searchScoreMap;
        return (
            <>
                <td style={{ color: 'var(--color-text-muted)', fontSize: '0.72rem' }}>{index + 1}</td>
                <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                            ...badgeStyle,
                            padding: '2px 6px',
                            borderRadius: 4,
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            flexShrink: 0,
                        }}>{asset.fileType}</span>
                        <span style={{
                            color: 'var(--color-text-primary)', fontWeight: 500,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220,
                        }}>
                            {asset.fileName}
                        </span>
                    </div>
                </td>
                <td>{asset.fileType}</td>
                <td>{asset.category}</td>
                <td style={{ fontSize: '0.72rem', color: 'var(--color-accent)' }}>
                    {asset.fileType === 'MAX'
                        ? (asset.metadata.maxVersion || '—')
                        : asset.fileType === 'SKP'
                        ? (asset.metadata.skpVersion || '—')
                        : (asset.fileType === 'DWG' || asset.fileType === 'DXF')
                        ? (asset.metadata.dwgVersion || '—')
                        : asset.fileType === 'RVT'
                        ? (asset.metadata.rvtVersion || '—')
                        : '—'}
                </td>
                <td style={{ color: 'var(--color-text-primary)' }}>{asset.projectName}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{formatFileSize(asset.fileSize)}</td>
                {scoreMap && (
                    <td>
                        {scoreMap[asset.id] !== undefined ? (
                            <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                                {(scoreMap[asset.id] * 100).toFixed(0)}%
                            </span>
                        ) : '—'}
                    </td>
                )}
                <td style={{ whiteSpace: 'nowrap' }}>{formatDate(asset.modifiedAt)}</td>
                <td>
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {asset.aiTags.slice(0, 2).map((tag, j) => (
                            <span key={j} className="tag tag-accent" style={{ fontSize: '0.6rem' }}>{tag.label}</span>
                        ))}
                    </div>
                </td>
            </>
        );
    }, []);

    if (assets.length === 0) {
        return (
            <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--color-text-muted)',
            }}>
                {t('technical.empty')}
            </div>
        );
    }

    return (
        <>
            <div style={{ flex: 1 }}>
                <TableVirtuoso
                    data={sortedAssets}
                    context={context}
                    overscan={300}
                    style={{ height: '100%' }}
                    components={virtuosoComponents}
                    fixedHeaderContent={() => (
                        <tr>
                            <th style={{ width: 40 }}>#</th>
                            {renderHeader(t('technical.col.fileName'), 'fileName')}
                            {renderHeader(t('technical.col.type'), 'fileType', 70)}
                            {renderHeader(t('technical.col.category'), 'category', 100)}
                            <th style={{ width: 90 }}>{t('technical.col.version')}</th>
                            {renderHeader(t('technical.col.project'), 'projectName', 140)}
                            {renderHeader(t('technical.col.size'), 'fileSize', 90)}
                            {searchScoreMap && <th style={{ width: 80 }}>{t('technical.col.score')}</th>}
                            {renderHeader(t('technical.col.updated'), 'modifiedAt', 120)}
                            <th>{t('technical.col.aiTags')}</th>
                        </tr>
                    )}
                    itemContent={itemContent}
                />
            </div>
            {menuState.visible && targetAsset && (
                <AssetContextMenu x={menuState.x} y={menuState.y} asset={targetAsset} onClose={closeMenu} />
            )}
        </>
    );
}
