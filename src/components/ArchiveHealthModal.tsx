/**
 * ArchivistPro — Archive Health Modal
 *
 * Güncelliğini yitiren/silinen dosyaların listesi + toplu yeniden tarama.
 * Rescan akışı mevcut pendingRescanPaths → ScanModal yolunu kullanır.
 */

import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, RefreshCw, AlertTriangle, FileX, CheckCircle2, Sparkles, Zap, FileWarning, ShieldAlert, Play } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { detectLegacyFormats } from '../services/formatMigration';
import { runFixitySample, createFixityController, type FixitySummary, type FixityController } from '../services/fixityCheck';
import type { Asset } from '../types';

interface Props {
    assets: Asset[];
    onClose: () => void;
    onRecheck: () => void;
}

export default function ArchiveHealthModal({ assets, onClose, onRecheck }: Props) {
    const { t } = useTranslation();
    const modalRef = useFocusTrap(true, onClose);
    const sc = useStore((s) => s.stalenessCheck);
    const setPendingRescanPaths = useStore((s) => s.setPendingRescanPaths);
    const setIsScanModalOpen = useStore((s) => s.setIsScanModalOpen);

    const { staleAssets, missingAssets, versionAssets } = useMemo(() => {
        const stale: Asset[] = [];
        const missing: Asset[] = [];
        const version: Asset[] = [];
        for (const a of assets) {
            if (sc.missingIds.has(a.id)) missing.push(a);
            else if (sc.staleIds.has(a.id)) stale.push(a);
            else if (sc.versionOutdatedIds.has(a.id)) version.push(a);
        }
        return { staleAssets: stale, missingAssets: missing, versionAssets: version };
    }, [assets, sc.staleIds, sc.missingIds, sc.versionOutdatedIds]);

    // Version eskileri tip bazında grupla
    const versionGroups = useMemo(() => {
        const map = new Map<string, number>();
        for (const a of versionAssets) {
            map.set(a.fileType, (map.get(a.fileType) ?? 0) + 1);
        }
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
    }, [versionAssets]);

    // Legacy format tespiti — eski Office binary (.doc/.xls/.ppt) → modern öneri
    const legacyFormatGroups = useMemo(() => detectLegacyFormats(assets), [assets]);
    const legacyFormatCount = useMemo(
        () => legacyFormatGroups.reduce((sum, g) => sum + g.count, 0),
        [legacyFormatGroups],
    );

    const totalIssues = staleAssets.length + missingAssets.length + versionAssets.length + legacyFormatCount;

    const rescanPaths = (assetsToScan: Asset[]) => {
        if (assetsToScan.length === 0) return;
        const paths = assetsToScan.map((a) => a.filePath);
        setPendingRescanPaths(paths);
        setIsScanModalOpen(true);
        onClose();
    };
    const handleRescanStale = () => rescanPaths(staleAssets);
    const handleRescanVersion = () => rescanPaths(versionAssets);

    // Fixity check (bit-rot) — manuel tetikli, sample bazlı
    const [fixityPercent, setFixityPercent] = useState<number>(10);
    const [fixityProgress, setFixityProgress] = useState<{ done: number; total: number; current: string } | null>(null);
    const [fixitySummary, setFixitySummary] = useState<FixitySummary | null>(null);
    const fixityControllerRef = useRef<FixityController | null>(null);

    const handleRunFixity = async () => {
        if (fixityProgress) return;
        const controller = createFixityController();
        fixityControllerRef.current = controller;
        setFixitySummary(null);
        setFixityProgress({ done: 0, total: Math.max(1, Math.ceil(assets.length * fixityPercent / 100)), current: '' });
        try {
            const summary = await runFixitySample(
                assets,
                fixityPercent,
                (done, total, current) => setFixityProgress({ done, total, current }),
                controller,
            );
            setFixitySummary(summary);
        } catch (err) {
            console.error('Fixity check failed:', err);
        } finally {
            setFixityProgress(null);
            fixityControllerRef.current = null;
        }
    };

    const handleCancelFixity = () => {
        fixityControllerRef.current?.cancel();
    };

    // Delta tarama: sadece eksik çıkarıcıları çalıştır
    const [deltaProgress, setDeltaProgress] = useState<{ done: number; total: number } | null>(null);
    const handleDeltaScan = async () => {
        if (versionAssets.length === 0) return;
        try {
            const { deltaScanAssets } = await import('../services/fileScanner');
            setDeltaProgress({ done: 0, total: versionAssets.length });
            const updated = await deltaScanAssets(versionAssets, (done, total, _current) => {
                setDeltaProgress({ done, total });
            });
            // Store'u güncelle
            if (updated.length > 0) {
                const updatedMap = new Map(updated.map(a => [a.id, a]));
                useStore.getState().setScannedAssets((prev) =>
                    prev.map(a => updatedMap.get(a.id) ?? a)
                );
            }
            // Staleness check'i yeniden tetikle
            onRecheck();
        } catch (err) {
            console.error('Delta scan failed:', err);
        } finally {
            setDeltaProgress(null);
        }
    };

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 500,
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="health-modal-title"
                style={{
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg, 20px)',
                    width: 'min(92vw, 680px)',
                    maxHeight: '80vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                }}
            >
                {/* Header */}
                <div style={{
                    padding: '14px 20px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    borderBottom: '1px solid var(--color-border)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertTriangle size={18} style={{ color: totalIssues > 0 ? '#f59e0b' : 'var(--color-success)' }} />
                        <span id="health-modal-title" style={{ fontSize: '0.92rem', fontWeight: 600 }}>
                            {t('health.modal.title')}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button
                            onClick={onRecheck}
                            disabled={sc.status === 'checking'}
                            className="btn btn-ghost"
                            style={{ padding: '4px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                            title={t('health.modal.recheck')}
                        >
                            <RefreshCw size={12} className={sc.status === 'checking' ? 'animate-spin' : ''} />
                            {t('health.modal.recheck')}
                        </button>
                        <button
                            onClick={onClose}
                            aria-label={t('common.aria.close')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', padding: 4 }}
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Summary banner (özet veya freshness) */}
                {totalIssues === 0 ? (
                    <div style={{ padding: '20px 20px 12px', textAlign: 'center', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                        <CheckCircle2 size={28} style={{ color: 'var(--color-success)', marginBottom: 6 }} />
                        <div style={{ fontSize: '0.86rem', fontWeight: 600, marginBottom: 2 }}>
                            {t('health.modal.allFreshTitle')}
                        </div>
                        <div style={{ fontSize: '0.72rem' }}>
                            {sc.lastCheckedAt
                                ? t('health.modal.lastCheck', { time: new Date(sc.lastCheckedAt).toLocaleString() })
                                : ''}
                        </div>
                    </div>
                ) : (
                    <div style={{ padding: '10px 20px', fontSize: '0.76rem', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
                        {t('health.modal.summary', {
                            stale: staleAssets.length,
                            missing: missingAssets.length,
                            version: versionAssets.length,
                        })}
                    </div>
                )}

                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {totalIssues > 0 && (
                        <>
                            {/* Version outdated — önce, çünkü sadece iyileştirme */}
                            {versionAssets.length > 0 && (
                                <>
                                    <SectionHeader
                                        icon={<Sparkles size={14} style={{ color: '#60a5fa' }} />}
                                        label={t('health.modal.versionSection', { count: versionAssets.length })}
                                        action={
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button
                                                    onClick={handleDeltaScan}
                                                    disabled={!!deltaProgress}
                                                    className="btn btn-primary"
                                                    style={{ padding: '4px 12px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                                                    title={t('health.modal.deltaScanHint')}
                                                >
                                                    <Zap size={11} />
                                                    {deltaProgress
                                                        ? `${deltaProgress.done}/${deltaProgress.total}`
                                                        : t('health.modal.deltaScan')}
                                                </button>
                                                <button
                                                    onClick={handleRescanVersion}
                                                    disabled={!!deltaProgress}
                                                    className="btn btn-ghost"
                                                    style={{ padding: '4px 12px', fontSize: '0.72rem' }}
                                                >
                                                    {t('health.modal.rescanAll')}
                                                </button>
                                            </div>
                                        }
                                    />
                                    <div style={{ padding: '8px 20px', fontSize: '0.72rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-primary)' }}>
                                        {t('health.modal.versionHint')}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 20px 10px' }}>
                                        {versionGroups.map(([ftype, count]) => (
                                            <span
                                                key={ftype}
                                                style={{
                                                    fontSize: '0.7rem',
                                                    padding: '2px 8px',
                                                    borderRadius: 10,
                                                    background: 'rgba(96,165,250,0.1)',
                                                    border: '1px solid rgba(96,165,250,0.3)',
                                                    color: '#60a5fa',
                                                }}
                                            >
                                                {ftype}: {count}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}

                            {/* Stale (mtime değişmiş) */}
                            {staleAssets.length > 0 && (
                                <SectionHeader
                                    icon={<AlertTriangle size={14} style={{ color: '#f59e0b' }} />}
                                    label={t('health.modal.staleSection', { count: staleAssets.length })}
                                    action={
                                        <button
                                            onClick={handleRescanStale}
                                            className="btn btn-primary"
                                            style={{ padding: '4px 12px', fontSize: '0.72rem' }}
                                        >
                                            {t('health.modal.rescanAll')}
                                        </button>
                                    }
                                />
                            )}
                            {staleAssets.map((a) => (
                                <AssetRow key={a.id} asset={a} kind="stale" />
                            ))}

                            {/* Missing */}
                            {missingAssets.length > 0 && (
                                <SectionHeader
                                    icon={<FileX size={14} style={{ color: 'var(--color-error)' }} />}
                                    label={t('health.modal.missingSection', { count: missingAssets.length })}
                                />
                            )}
                            {missingAssets.map((a) => (
                                <AssetRow key={a.id} asset={a} kind="missing" />
                            ))}

                            {missingAssets.length > 0 && (
                                <div style={{ padding: '8px 20px 16px', fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    {t('health.modal.missingHint')}
                                </div>
                            )}

                            {/* Legacy format — eski Office binary öneri */}
                            {legacyFormatGroups.length > 0 && (
                                <>
                                    <SectionHeader
                                        icon={<FileWarning size={14} style={{ color: '#a78bfa' }} />}
                                        label={t('health.modal.legacyFormatSection', { count: legacyFormatCount })}
                                    />
                                    <div style={{ padding: '8px 20px', fontSize: '0.72rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-primary)' }}>
                                        {t('health.modal.legacyFormatHint')}
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '6px 20px 14px' }}>
                                        {legacyFormatGroups.map((g) => (
                                            <span
                                                key={g.legacyType}
                                                title={t('health.modal.legacyFormatChipTitle', {
                                                    legacy: g.legacyType,
                                                    recommended: g.recommendedType,
                                                })}
                                                style={{
                                                    fontSize: '0.7rem',
                                                    padding: '2px 8px',
                                                    borderRadius: 10,
                                                    background: 'rgba(167,139,250,0.1)',
                                                    border: '1px solid rgba(167,139,250,0.3)',
                                                    color: '#a78bfa',
                                                }}
                                            >
                                                {g.legacyType} → {g.recommendedType}: {g.count}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {/* Fixity Check (Bit-Rot) — manuel tetikli; her zaman görünür */}
                    <SectionHeader
                        icon={<ShieldAlert size={14} style={{ color: '#f87171' }} />}
                        label={t('health.modal.fixitySection')}
                        action={
                            fixityProgress ? (
                                <button onClick={handleCancelFixity} className="btn btn-ghost"
                                    style={{ padding: '4px 12px', fontSize: '0.72rem' }}>
                                    {t('common.cancel')}
                                </button>
                            ) : (
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                    <select
                                        value={fixityPercent}
                                        onChange={(e) => setFixityPercent(parseInt(e.target.value, 10))}
                                        style={{
                                            padding: '3px 6px', fontSize: '0.72rem', borderRadius: 4,
                                            border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)',
                                            color: 'var(--color-text-primary)', cursor: 'pointer',
                                        }}
                                        aria-label={t('health.modal.fixitySampleAria')}
                                    >
                                        <option value={5}>5%</option>
                                        <option value={10}>10%</option>
                                        <option value={25}>25%</option>
                                        <option value={50}>50%</option>
                                        <option value={100}>100%</option>
                                    </select>
                                    <button onClick={handleRunFixity} className="btn btn-primary"
                                        disabled={assets.length === 0}
                                        style={{ padding: '4px 12px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Play size={11} />
                                        {t('health.modal.fixityRun')}
                                    </button>
                                </div>
                            )
                        }
                    />
                    <div style={{ padding: '8px 20px', fontSize: '0.72rem', color: 'var(--color-text-muted)', background: 'var(--color-bg-primary)' }}>
                        {t('health.modal.fixityHint')}
                    </div>
                    {fixityProgress && (
                        <div style={{ padding: '8px 20px 4px', fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
                            {fixityProgress.done}/{fixityProgress.total}
                            {fixityProgress.current && (
                                <span style={{ marginLeft: 8, color: 'var(--color-text-muted)', fontSize: '0.68rem' }}>
                                    {fixityProgress.current}
                                </span>
                            )}
                        </div>
                    )}
                    {fixitySummary && !fixityProgress && (
                        <>
                            <div style={{ padding: '10px 20px', fontSize: '0.74rem' }}>
                                {fixitySummary.mismatch === 0 && fixitySummary.missing === 0 && fixitySummary.error === 0 ? (
                                    <span style={{ color: 'var(--color-success)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                        <CheckCircle2 size={14} />
                                        {t('health.modal.fixityClean', {
                                            sampled: fixitySummary.sampled,
                                            ok: fixitySummary.ok,
                                            seconds: Math.round(fixitySummary.durationMs / 1000),
                                        })}
                                    </span>
                                ) : (
                                    <span style={{ color: 'var(--color-error)' }}>
                                        {t('health.modal.fixityIssues', {
                                            sampled: fixitySummary.sampled,
                                            mismatch: fixitySummary.mismatch,
                                            missing: fixitySummary.missing,
                                            error: fixitySummary.error,
                                        })}
                                    </span>
                                )}
                            </div>
                            {fixitySummary.mismatches.map((m, idx) => {
                                const color = m.status === 'mismatch' ? 'var(--color-error)'
                                    : m.status === 'missing' ? '#f59e0b'
                                    : '#a78bfa';
                                return (
                                    <div key={`${m.asset.id}-${idx}`} style={{
                                        padding: '8px 20px', borderBottom: '1px solid var(--color-border)',
                                        display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.74rem',
                                    }}>
                                        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {m.asset.fileName}
                                            </div>
                                            <div style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                {t(`health.modal.fixityStatus.${m.status}`)}
                                                {m.error && <> — {m.error}</>}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                            {fixitySummary.noBaseline > 0 && (
                                <div style={{ padding: '8px 20px 14px', fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    {t('health.modal.fixityNoBaseline', { count: fixitySummary.noBaseline })}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

function SectionHeader({ icon, label, action }: { icon: React.ReactNode; label: string; action?: React.ReactNode }) {
    return (
        <div style={{
            padding: '10px 20px',
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--color-bg-primary)',
            borderBottom: '1px solid var(--color-border)',
            fontSize: '0.78rem', fontWeight: 600,
        }}>
            {icon}
            <span style={{ flex: 1 }}>{label}</span>
            {action}
        </div>
    );
}

function AssetRow({ asset, kind }: { asset: Asset; kind: 'stale' | 'missing' }) {
    const color = kind === 'stale' ? '#f59e0b' : 'var(--color-error)';
    return (
        <div style={{
            padding: '8px 20px',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex', alignItems: 'center', gap: 10,
            fontSize: '0.76rem',
        }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {asset.fileName}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {asset.filePath}
                </div>
            </div>
        </div>
    );
}
