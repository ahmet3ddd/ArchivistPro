import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { previewExtractDetailed, type ExtractPreview, type ExtractDetailedPreview, type ExtractFilter } from '../../services/archiveOps';
import type { ExtractMode } from './extractTypes';
import { StatRow } from './extractHelpers';

function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let n = bytes; let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

export default function PreviewStep({
    preview, mode, sourceId, filter,
}: {
    preview: ExtractPreview;
    mode: ExtractMode;
    sourceId: string;
    filter: ExtractFilter;
}) {
    const { t } = useTranslation();
    const [showDetails, setShowDetails] = useState(false);
    const [detailed, setDetailed] = useState<ExtractDetailedPreview | null>(null);

    const handleToggleDetails = useCallback(() => {
        if (!showDetails && !detailed) {
            setDetailed(previewExtractDetailed({ sourceId, filter }));
        }
        setShowDetails(v => !v);
    }, [showDetails, detailed, sourceId, filter]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {!preview.hasActiveFilters && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8 }}>
                    <AlertTriangle size={14} style={{ color: '#f59e0b', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.76rem', color: '#fbbf24' }}>{t('extract.filter.noActiveWarning')}</span>
                </div>
            )}
            {mode === 'move' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8 }}>
                    <AlertTriangle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                    <span style={{ fontSize: '0.76rem', color: '#fca5a5' }}>{t('extract.confirm.moveWarning')}</span>
                </div>
            )}
            {preview.matchedCount === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.82rem' }}>
                    {t('extract.preview.noMatch')}
                </div>
            ) : (
                <>
                    <StatRow label={t('extract.preview.matched')} value={preview.matchedCount} highlight />
                    <StatRow label={t('extract.preview.totalSize')} value={formatBytes(preview.totalSizeBytes)} />
                    {Object.keys(preview.fileTypeCounts).length > 0 && (
                        <div>
                            <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginTop: 8, marginBottom: 6 }}>
                                {t('extract.preview.byType')}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {Object.entries(preview.fileTypeCounts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                                    <span key={type} style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)', borderRadius: 999, color: 'var(--color-text-secondary)' }}>
                                        {type}: <strong>{count}</strong>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    <button type="button" onClick={handleToggleDetails} style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--color-accent)', fontSize: '0.78rem', padding: '4px 0', alignSelf: 'flex-start',
                    }}>
                        {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {t('extract.preview.toggleDetails', { defaultValue: 'Detaylı liste' })}
                    </button>
                    {showDetails && detailed && (
                        <div style={{ maxHeight: 240, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6, fontSize: '0.7rem', fontFamily: 'monospace', border: '1px solid var(--color-border)' }}>
                            {detailed.items.map(item => (
                                <div key={item.id} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                                    <span style={{ color: 'var(--color-accent)', minWidth: 40, flexShrink: 0 }}>[{item.fileType}]</span>
                                    <span style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{item.fileName}</span>
                                    <span style={{ color: 'var(--color-text-muted)', flexShrink: 0 }}>{formatBytes(item.fileSize)}</span>
                                </div>
                            ))}
                            {detailed.truncated && (
                                <div style={{ padding: '4px 0', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    … {t('extract.preview.truncated', { defaultValue: 'ilk {{limit}} kayıt gösteriliyor', limit: detailed.limit })}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
