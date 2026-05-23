/**
 * ArchivistPro — Archive Health Badge
 *
 * Sidebar footer'ında duran, aktif arşivdeki dosya güncellik durumunu
 * özetleyen rozet. Tıklanınca detay modalı açılır.
 *
 * Durumlar:
 *   🔄 checking  — kontrol devam ediyor
 *   🟢 done      — hepsi güncel
 *   🟡 done      — N dosya güncelliğini yitirmiş
 *   🔴 done      — N dosya silinmiş/taşınmış
 *   ⚫ idle/error
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, FileX, Loader2, ShieldAlert, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { Asset } from '../types';
import ArchiveHealthModal from './ArchiveHealthModal';

interface Props {
    assets: Asset[];
    onStartCheck: () => void;
}

export default function ArchiveHealthBadge({ assets, onStartCheck }: Props) {
    const { t } = useTranslation();
    const [modalOpen, setModalOpen] = useState(false);
    const sc = useStore((s) => s.stalenessCheck);

    const staleCount = sc.staleIds.size;
    const missingCount = sc.missingIds.size;
    const versionCount = sc.versionOutdatedIds.size;

    const { icon, color, label } = useMemo(() => {
        if (sc.status === 'checking') {
            return {
                icon: <Loader2 size={12} className="animate-spin" />,
                color: 'var(--color-text-muted)',
                label: sc.progress
                    ? t('health.checking.progress', { done: sc.progress.done, total: sc.progress.total })
                    : t('health.checking.label'),
            };
        }
        if (sc.status === 'error') {
            return {
                icon: <ShieldAlert size={12} />,
                color: 'var(--color-text-muted)',
                label: t('health.error'),
            };
        }
        if (sc.status === 'done') {
            // Önceliğe göre renk seç: missing > stale > versionOutdated > ok
            if (missingCount > 0) {
                return {
                    icon: <FileX size={12} />,
                    color: 'var(--color-error)',
                    label: t('health.missing', { count: missingCount }),
                };
            }
            if (staleCount > 0) {
                return {
                    icon: <AlertTriangle size={12} />,
                    color: '#f59e0b',
                    label: t('health.stale', { count: staleCount }),
                };
            }
            if (versionCount > 0) {
                return {
                    icon: <Sparkles size={12} />,
                    color: '#60a5fa',
                    label: t('health.versionOutdated', { count: versionCount }),
                };
            }
            return {
                icon: <CheckCircle2 size={12} />,
                color: 'var(--color-success)',
                label: t('health.allFresh'),
            };
        }
        return {
            icon: <Loader2 size={12} />,
            color: 'var(--color-text-muted)',
            label: t('health.idle'),
        };
    }, [sc.status, sc.progress, staleCount, missingCount, versionCount, t]);

    const hasIssues = sc.status === 'done' && (staleCount + missingCount + versionCount > 0);
    const clickable = sc.status !== 'checking';

    return (
        <>
            <button
                onClick={() => { if (clickable) setModalOpen(true); }}
                disabled={!clickable}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', marginTop: 6,
                    padding: '4px 6px',
                    background: hasIssues ? `${color}15` : 'transparent',
                    border: `1px solid ${hasIssues ? `${color}40` : 'transparent'}`,
                    borderRadius: 4,
                    cursor: clickable ? 'pointer' : 'default',
                    color,
                    fontSize: '0.68rem',
                    textAlign: 'left',
                }}
                title={sc.lastCheckedAt ? new Date(sc.lastCheckedAt).toLocaleString() : ''}
            >
                {icon}
                <span style={{ flex: 1, color: hasIssues ? color : 'var(--color-text-muted)' }}>
                    {label}
                </span>
            </button>

            {modalOpen && (
                <ArchiveHealthModal
                    assets={assets}
                    onClose={() => setModalOpen(false)}
                    onRecheck={onStartCheck}
                />
            )}
        </>
    );
}
