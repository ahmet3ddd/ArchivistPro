import { useTranslation } from 'react-i18next';
import { GitCompare, Trash2 } from 'lucide-react';
import type { Asset } from '../../types';
import type { DuplicateScanResult } from '../../services/duplicateDetection';
import { formatBytes, formatDate, assetThumbSrc } from './duplicateHelpers';

interface DuplicateCompareViewProps {
    compareIds: [string, string] | null;
    compareAssets: Array<Asset | undefined>;
    result: DuplicateScanResult | null;
    canDelete: boolean;
    onDeleteSingle: (asset: Asset) => void;
}

export default function DuplicateCompareView({
    compareIds, compareAssets, result, canDelete, onDeleteSingle,
}: DuplicateCompareViewProps) {
    const { t } = useTranslation();

    if (!compareIds) {
        return (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                <GitCompare size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
                <div>{t('duplicateFinder.comparePanelHint')}</div>
            </div>
        );
    }

    return (
        <div>
            {/* Karşılaştırma grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {compareAssets.map((asset, idx) => asset ? (
                    <div key={asset.id} style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                        {/* Thumbnail */}
                        <div style={{ height: 160, background: 'var(--color-bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                            {(() => {
                                const src = assetThumbSrc(asset);
                                return src ? (
                                    <img src={src} alt={asset.fileName} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                                ) : (
                                    <span style={{ fontSize: '2rem', opacity: 0.3 }}>{asset.fileType?.toUpperCase()}</span>
                                );
                            })()}
                        </div>
                        {/* Info */}
                        <div style={{ padding: '10px 12px' }}>
                            <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: 6 }}>{asset.fileName}</div>
                            <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                                <tbody>
                                    {[
                                        [t('duplicateFinder.fileSize'), formatBytes(asset.fileSize)],
                                        [t('duplicateFinder.modified'), formatDate(asset.modifiedAt)],
                                        ['Tür', asset.fileType],
                                        ['Konum', asset.filePath],
                                    ].map(([label, val]) => (
                                        <tr key={label as string}>
                                            <td style={{ color: 'var(--color-text-muted)', paddingRight: 8, paddingBottom: 3, whiteSpace: 'nowrap' }}>{label}</td>
                                            <td style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 160, whiteSpace: 'nowrap' }} title={val as string}>{val}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {canDelete && (
                                <button className="btn btn-ghost"
                                    style={{ marginTop: 8, width: '100%', padding: '5px', color: 'var(--color-danger)', fontSize: '0.8rem' }}
                                    onClick={() => onDeleteSingle(asset)}>
                                    <Trash2 size={13} style={{ marginRight: 4 }} />
                                    {idx === 0 ? t('duplicateFinder.compareDeleteLeft') : t('duplicateFinder.compareDeleteRight')}
                                </button>
                            )}
                        </div>
                    </div>
                ) : null)}
            </div>

            {/* Benzerlik rozeti */}
            {(() => {
                const match = result?.groups.find(g =>
                    g.assets.some(a => a.id === compareIds[0]) &&
                    g.assets.some(a => a.id === compareIds[1])
                );
                if (!match) return null;
                return (
                    <div style={{ textAlign: 'center', marginTop: 12, fontSize: '0.82rem', color: 'var(--color-accent)' }}>
                        {match.detail.reason}
                        {match.detail.matchedFields?.map((f, i) => (
                            <span key={i} style={{ marginLeft: 8, color: 'var(--color-text-muted)' }}>· {f}</span>
                        ))}
                    </div>
                );
            })()}
        </div>
    );
}
