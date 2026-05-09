import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import type { ExtractResult } from '../../services/archiveOps';
import type { TargetMode } from './extractTypes';
import { StatRow } from './extractHelpers';

export default function DoneStep({ result, targetMode }: { result: ExtractResult; targetMode: TargetMode }) {
    const { t } = useTranslation();
    const hasErrors = result.errors.length > 0;
    const success = result.extractedCount > 0 && !hasErrors;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: 12,
                background: success ? 'rgba(16,185,129,0.08)' : hasErrors ? 'rgba(239,68,68,0.08)' : 'rgba(245,158,11,0.08)',
                border: `1px solid ${success ? 'rgba(16,185,129,0.3)' : hasErrors ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`,
                borderRadius: 8,
            }}>
                {success
                    ? <CheckCircle size={18} style={{ color: '#10b981' }} />
                    : <AlertTriangle size={18} style={{ color: hasErrors ? '#ef4444' : '#f59e0b' }} />}
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('extract.result.title')}</span>
            </div>
            <StatRow label={t('extract.result.matched')} value={result.matchedCount} />
            <StatRow label={t('extract.result.extracted')} value={result.extractedCount} highlight />
            {result.deletedFromSource > 0 && <StatRow label={t('extract.result.deletedFromSource')} value={result.deletedFromSource} />}
            {result.tagsCopied > 0 && <StatRow label={t('extract.include.tags')} value={result.tagsCopied} />}
            {result.embeddingsCopied > 0 && <StatRow label={t('extract.include.embeddings')} value={result.embeddingsCopied} />}
            {result.chunksCopied > 0 && <StatRow label={t('extract.include.textChunks')} value={result.chunksCopied} />}
            {result.summariesCopied > 0 && <StatRow label={t('extract.include.summaries')} value={result.summariesCopied} />}
            {result.favoritesCopied > 0 && <StatRow label={t('extract.include.favorites')} value={result.favoritesCopied} />}
            {hasErrors && (
                <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#ef4444', marginTop: 8, marginBottom: 6 }}>
                        {t('extract.result.errors')} ({result.errors.length})
                    </div>
                    <div style={{ maxHeight: 120, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6, fontSize: '0.7rem', color: '#fca5a5', fontFamily: 'monospace' }}>
                        {result.errors.slice(0, 50).map((e, i) => <div key={i}>{e}</div>)}
                    </div>
                </div>
            )}
            {void targetMode}
        </div>
    );
}
