import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderSearch, X, Loader2, AlertCircle, CheckCircle2, Brain, Zap, Pause, Play, Square, Palette } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { ScanProgress } from '../services/fileScanner';
import type { EmbeddingStatus } from '../services/embeddings';
import type { HardwareTier } from '../services/hardwareDetect';
import ModalErrorBoundary from './ModalErrorBoundary';
import { TIMINGS } from '../config/constants';
import { useStore } from '../store/useStore';
import { useAutoRagIndexEnabled } from '../hooks/useAutoRagIndexEnabled';

type ScanMode = 'merge' | 'replaceUnderPath' | 'fullReset';

interface ScanModalProps {
    isOpen: boolean;
    onClose: () => void;
    onStartScan: (mode: ScanMode, withColorExtract: boolean) => void;
    onScanFiles?: (withColorExtract: boolean) => void;
    onScanSpecificFiles?: (paths: string[], withColorExtract: boolean) => void;
    onClearPendingRescanPaths?: () => void;
    pendingRescanPaths?: string[] | null;
    scanProgress: ScanProgress | null;
    embeddingStatus: EmbeddingStatus;
    isScanPaused?: boolean;
    onPause?: () => void;
    onResume?: () => void;
    onCancel?: () => void;
    currentAssetCount?: number;
    hardwareTier?: HardwareTier;
}

export default function ScanModal({ isOpen, onClose, onStartScan, onScanFiles, onScanSpecificFiles, onClearPendingRescanPaths, pendingRescanPaths, scanProgress, embeddingStatus, isScanPaused, onPause, onResume, onCancel, currentAssetCount = 0, hardwareTier }: ScanModalProps) {
    const { t } = useTranslation();
    const focusTrapRef = useFocusTrap(isOpen, onClose);
    const lastScanInfo = useStore((s) => s.lastScanInfoMap[s.activeArchive]);
    const autoRagIndexProgress = useStore((s) => s.autoRagIndexProgress);
    const autoRagIndexOn = useAutoRagIndexEnabled();
    const [withColorExtract, setWithColorExtract] = useState(false);
    const [scanMode, setScanMode] = useState<ScanMode>('merge');
    const startTimeRef = useRef<number | null>(null);
    const pausedAtRef = useRef<number | null>(null);
    const pausedTotalMsRef = useRef<number>(0);
    const emaSecondsPerFileRef = useRef<number | null>(null);
    const lastProcessedRef = useRef<number>(0);
    const [nowMs, setNowMs] = useState(() => Date.now());

    const isPreparing = scanProgress?.isPreparing === true;
    const isScanning = scanProgress !== null && !scanProgress.isComplete && !isPreparing;
    const isDone = scanProgress?.isComplete;
    const pct = scanProgress && scanProgress.total > 0
        ? Math.round((scanProgress.processed / scanProgress.total) * 100)
        : 0;

    useEffect(() => {
        if (!isScanning) {
            startTimeRef.current = null;
            pausedAtRef.current = null;
            pausedTotalMsRef.current = 0;
            emaSecondsPerFileRef.current = null;
            lastProcessedRef.current = 0;
            return;
        }

        if (startTimeRef.current === null) {
            startTimeRef.current = Date.now();
            pausedAtRef.current = null;
            pausedTotalMsRef.current = 0;
            emaSecondsPerFileRef.current = (lastScanInfo && lastScanInfo.fileCount > 0)
                ? lastScanInfo.durationMs / lastScanInfo.fileCount / 1000
                : null;
            lastProcessedRef.current = scanProgress?.processed ?? 0;
        }
    }, [isScanning]);

    useEffect(() => {
        if (!isScanning) return;
        const t = setInterval(() => setNowMs(Date.now()), TIMINGS.SCAN_CLOCK_UPDATE_MS);
        return () => clearInterval(t);
    }, [isScanning]);

    useEffect(() => {
        if (!isScanning) return;
        if (isScanPaused) {
            if (pausedAtRef.current === null) pausedAtRef.current = Date.now();
            return;
        }
        if (pausedAtRef.current !== null) {
            pausedTotalMsRef.current += Date.now() - pausedAtRef.current;
            pausedAtRef.current = null;
        }
    }, [isScanning, isScanPaused]);

    useEffect(() => {
        if (!isScanning || !scanProgress) return;
        const processed = scanProgress.processed ?? 0;
        const last = lastProcessedRef.current;
        if (processed <= last) return;

        const start = startTimeRef.current;
        if (!start) return;

        const elapsedMs = Math.max(0, Date.now() - start - pausedTotalMsRef.current);
        const elapsedSec = Math.max(0.001, elapsedMs / 1000);
        const secPerFileInstant = elapsedSec / processed;

        const alpha = 0.22; // EMA smoothing factor
        const prev = emaSecondsPerFileRef.current;
        emaSecondsPerFileRef.current = prev === null ? secPerFileInstant : (prev * (1 - alpha) + secPerFileInstant * alpha);
        lastProcessedRef.current = processed;
    }, [isScanning, scanProgress]);

    const eta = useMemo(() => {
        if (!isScanning || !scanProgress) return null;
        const start = startTimeRef.current;
        if (!start) return null;

        // Elapsed'i her zaman hesapla — süre akmalı
        const pausedExtra = isScanPaused && pausedAtRef.current ? (nowMs - pausedAtRef.current) : 0;
        const elapsedMs = Math.max(0, nowMs - start - pausedTotalMsRef.current - pausedExtra);
        const elapsedSec = Math.max(0, elapsedMs / 1000);

        const processed = scanProgress.processed ?? 0;
        const total = scanProgress.total ?? 0;

        // Geçmiş veri varsa file 0'dan itibaren; yoksa EMA ilk güncellemesini bekle (1. dosya)
        if (total <= 0 || emaSecondsPerFileRef.current === null) {
            return { elapsedSec: Math.round(elapsedSec), remainingSec: null as number | null };
        }

        const remainingFiles = Math.max(0, total - processed);
        const secPerFile = emaSecondsPerFileRef.current ?? (elapsedSec / processed);
        const remainingSec = remainingFiles > 0 ? Math.max(0, Math.round(remainingFiles * secPerFile)) : 0;

        return { elapsedSec: Math.round(elapsedSec), remainingSec };
    }, [isScanning, scanProgress, isScanPaused, nowMs]);

    function formatDuration(seconds: number): string {
        const s = Math.max(0, Math.floor(seconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return t('scan.duration.hours', { h, m, s: sec });
        if (m > 0) return t('scan.duration.minutes', { m, s: sec });
        return t('scan.duration.seconds', { s: sec });
    }

    if (!isOpen) return null;

    return (
        <ModalErrorBoundary onClose={onClose}>
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
            <div ref={focusTrapRef} className="glass-card animate-fade-in" role="dialog" aria-modal="true" style={{
                width: 'min(90vw, 520px)', maxHeight: '80vh', overflow: 'auto', padding: 0,
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '20px 24px', borderBottom: '1px solid var(--color-border)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <FolderSearch size={20} style={{ color: 'var(--color-accent)' }} />
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{autoRagIndexOn ? t('modals.scan') : t('modals.scanOnly')}</span>
                    </div>
                    {!isScanning && (
                        <button onClick={onClose} aria-label={t('common.aria.close')} style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-muted)', padding: 4,
                        }}>
                            <X size={18} />
                        </button>
                    )}
                </div>

                {/* Body */}
                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Pending re-scan notice — shown when duplicate finder sent files for re-scanning */}
                    {!isScanning && !isDone && !isPreparing && pendingRescanPaths && pendingRescanPaths.length > 0 && (
                        <div style={{
                            margin: '0 0 0 0', padding: '12px 16px',
                            background: 'var(--color-accent-glow, rgba(139,92,246,0.08))',
                            border: '1px solid var(--color-accent)',
                            borderRadius: 'var(--radius-md)', fontSize: '0.85rem',
                        }}>
                            <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--color-accent)' }}>
                                {t('scan.pendingRescanTitle', { count: pendingRescanPaths.length })}
                            </div>
                            <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: '0.78rem', color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                                {pendingRescanPaths.map((p, i) => (
                                    <div key={i} style={{ padding: '1px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p}>{p}</div>
                                ))}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    className="btn btn-primary"
                                    style={{ padding: '6px 16px', fontSize: '0.82rem' }}
                                    onClick={() => {
                                        if (onScanSpecificFiles) onScanSpecificFiles(pendingRescanPaths, withColorExtract);
                                        if (onClearPendingRescanPaths) onClearPendingRescanPaths();
                                    }}
                                >
                                    {t('scan.pendingRescanStart')}
                                </button>
                                <button
                                    className="btn btn-ghost"
                                    style={{ padding: '6px 12px', fontSize: '0.82rem' }}
                                    onClick={() => { if (onClearPendingRescanPaths) onClearPendingRescanPaths(); }}
                                >
                                    {t('common.cancel')}
                                </button>
                            </div>
                        </div>
                    )}
                    {isPreparing && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '24px 0' }}>
                            <Loader2 size={36} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                            <div style={{ textAlign: 'center' }}>
                                <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                    {t('scan.preparing')}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)', marginTop: 6 }}>
                                    {t('scan.preparingDetail')}
                                </div>
                            </div>
                        </div>
                    )}
                    {!isScanning && !isDone && !isPreparing && (!pendingRescanPaths || pendingRescanPaths.length === 0) && (
                        <>
                            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                                {t('scan.description')}
                            </p>

                            {/* Tarama modu: Listeye ekle / Sıfırdan tara */}
                            {(
                                <div style={{
                                    background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)',
                                    padding: 14, border: '1px solid var(--color-border)',
                                }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: 10, color: 'var(--color-text-primary)' }}>
                                        {t('scan.section.scanMode')}
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.85rem' }}>
                                            <input
                                                type="radio"
                                                name="scanMode"
                                                checked={scanMode === 'merge'}
                                                onChange={() => setScanMode('merge')}
                                                style={{ accentColor: 'var(--color-accent)' }}
                                            />
                                            <span><strong>{t('scan.mode.merge')}</strong> — {t('scan.mode.mergeDesc', { count: currentAssetCount })}</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.85rem' }}>
                                            <input
                                                type="radio"
                                                name="scanMode"
                                                checked={scanMode === 'replaceUnderPath'}
                                                onChange={() => setScanMode('replaceUnderPath')}
                                                style={{ accentColor: 'var(--color-accent)' }}
                                            />
                                            <span><strong>{t('scan.mode.replaceUnderPath')}</strong> — {t('scan.mode.replaceUnderPathDesc')}</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.85rem' }}>
                                            <input
                                                type="radio"
                                                name="scanMode"
                                                checked={scanMode === 'fullReset'}
                                                onChange={() => setScanMode('fullReset')}
                                                style={{ accentColor: 'var(--color-danger, #ef4444)' }}
                                            />
                                            <span style={{ color: 'var(--color-danger, #ef4444)' }}>
                                                <strong>{t('scan.mode.fullReset')}</strong>
                                                <span style={{ color: 'var(--color-text-secondary)' }}> — {t('scan.mode.fullResetDesc')}</span>
                                            </span>
                                        </label>
                                    </div>
                                </div>
                            )}

                            {/* AI Bilgisi */}
                            <div style={{
                                background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)',
                                padding: 16, border: '1px solid var(--color-border)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Brain size={16} style={{ color: 'var(--color-accent-secondary)' }} />
                                    <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('scan.section.aiVectors')}</span>
                                    <span style={{
                                        fontSize: '0.65rem', padding: '2px 6px', borderRadius: 999,
                                        background: 'rgba(203,166,247,0.15)', color: 'var(--color-accent)',
                                        fontWeight: 700,
                                    }}>{t('scan.badge.alwaysActive')}</span>
                                </div>
                                <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 6 }}>
                                    {t('scan.ai.description')}
                                </p>
                                {hardwareTier === 'low' && (
                                    <p style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: 4 }}>
                                        {t('scan.ai.lowHardwareWarning')}
                                    </p>
                                )}
                            </div>

                            {/* Color Palette Toggle */}
                            <div style={{
                                background: 'var(--color-bg-tertiary)', borderRadius: 'var(--radius-md)',
                                padding: 16, border: '1px solid var(--color-border)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Palette size={16} style={{ color: 'var(--color-accent)' }} />
                                        <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{t('scan.section.colorPalette')}</span>
                                    </div>
                                    <button
                                        onClick={() => setWithColorExtract(!withColorExtract)}
                                        style={{
                                            width: 44, height: 24, borderRadius: 12,
                                            background: withColorExtract
                                                ? 'linear-gradient(90deg, var(--color-accent), var(--color-accent-secondary))'
                                                : 'var(--color-bg-primary)',
                                            border: `1px solid ${withColorExtract ? 'transparent' : 'var(--color-border)'}`,
                                            cursor: 'pointer', position: 'relative', transition: 'all 0.2s',
                                        }}
                                    >
                                        <div style={{
                                            width: 18, height: 18, borderRadius: '50%', background: '#fff',
                                            position: 'absolute', top: 2, left: withColorExtract ? 22 : 2,
                                            transition: 'left 0.2s',
                                        }} />
                                    </button>
                                </div>
                                <p style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 6 }}>
                                    {withColorExtract
                                        ? t('scan.color.enabledDesc')
                                        : t('scan.color.disabledDesc')}
                                </p>
                            </div>

                            {/* Embedding Model Status */}
                            {(
                                <div style={{
                                    fontSize: '0.75rem', color: 'var(--color-text-muted)',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}>
                                    {embeddingStatus.isReady ? (
                                        <>
                                            <CheckCircle2 size={13} style={{ color: 'var(--color-success)' }} />
                                            <span>{t('scan.ai.modelReady')}</span>
                                        </>
                                    ) : embeddingStatus.isLoading ? (
                                        <>
                                            <Loader2 size={13} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                                            <span>{t('scan.ai.modelLoading', { progress: embeddingStatus.progress })}</span>
                                        </>
                                    ) : (
                                        <>
                                            <Zap size={13} style={{ color: 'var(--color-warning)' }} />
                                            <span>{t('scan.ai.modelWillLoad')}</span>
                                        </>
                                    )}
                                </div>
                            )}

                            {/* Start Buttons */}
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button className="btn btn-primary" onClick={() => onStartScan(scanMode, withColorExtract)} style={{
                                    flex: 1, justifyContent: 'center', padding: '12px 10px', fontSize: '0.85rem',
                                }}>
                                    <FolderSearch size={16} />
                                    {t('scan.button.selectFolder')}
                                </button>
                                {onScanFiles && (
                                    <button className="btn btn-primary" onClick={() => onScanFiles(withColorExtract)} style={{
                                        flex: 1, justifyContent: 'center', padding: '12px 10px', fontSize: '0.85rem',
                                        background: 'var(--color-bg-tertiary)',
                                        border: '1px solid var(--color-accent)',
                                        color: 'var(--color-accent)',
                                    }}>
                                        <FolderSearch size={16} />
                                        {t('scan.button.selectFiles')}
                                    </button>
                                )}
                            </div>
                        </>
                    )}

                    {/* Scanning Progress */}
                    {isScanning && scanProgress && (
                        <>
                            <div style={{ textAlign: 'center', marginBottom: 8 }}>
                                {isScanPaused ? (
                                    <Pause size={32} style={{ color: 'var(--color-warning)', marginBottom: 8 }} />
                                ) : (
                                    <Loader2 size={32} className="animate-spin" style={{ color: 'var(--color-accent)', marginBottom: 8 }} />
                                )}
                                <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{pct}%</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                    {t('scan.progress.filesProcessed', { processed: scanProgress.processed, total: scanProgress.total })}
                                    {(scanProgress.skipped ?? 0) > 0 && (
                                        <span> ({t('scan.cache', { count: scanProgress.skipped })})</span>
                                    )}
                                </div>
                                {eta && (
                                    <div style={{ marginTop: 6, fontSize: '0.74rem', color: 'var(--color-text-secondary)' }}>
                                        <div>
                                            {t('scan.eta.elapsed')} <strong>{formatDuration(eta.elapsedSec)}</strong>
                                        </div>
                                        <div>
                                            {t('scan.eta.remaining')}{' '}
                                            <strong>
                                                {eta.remainingSec === null ? t('scan.eta.calculating') : formatDuration(eta.remainingSec)}
                                            </strong>
                                        </div>
                                    </div>
                                )}
                                {isScanPaused && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-warning)', marginTop: 4, fontWeight: 600 }}>
                                        {t('scan.status.paused')}
                                    </div>
                                )}
                            </div>

                            {/* Progress bar */}
                            <div className="progress-bar-track" style={{ height: 8 }}>
                                <div
                                    className="progress-bar-fill"
                                    style={{
                                        width: `${pct}%`,
                                        background: isScanPaused
                                            ? 'var(--color-warning)'
                                            : undefined,
                                    }}
                                />
                            </div>

                            {/* Mevcut dosya */}
                            {!isScanPaused && (
                                <div style={{
                                    fontSize: '0.72rem', color: 'var(--color-text-secondary)',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    textAlign: 'center',
                                }}>
                                    📄 {scanProgress.current}
                                </div>
                            )}

                            {/* Hata sayısı */}
                            {scanProgress.errors.length > 0 && (
                                <div style={{
                                    fontSize: '0.7rem', color: 'var(--color-warning)',
                                    display: 'flex', alignItems: 'center', gap: 4,
                                }}>
                                    <AlertCircle size={12} />
                                    {t('scan.errors.count', { count: scanProgress.errors.length })}
                                </div>
                            )}

                            {/* Kontrol butonları */}
                            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                {isScanPaused ? (
                                    <button
                                        className="btn btn-primary"
                                        style={{ flex: 1, justifyContent: 'center', padding: '9px 14px', fontSize: '0.82rem' }}
                                        onClick={onResume}
                                    >
                                        <Play size={15} /> {t('scan.button.resume')}
                                    </button>
                                ) : (
                                    <button
                                        className="btn btn-ghost"
                                        style={{ flex: 1, justifyContent: 'center', padding: '9px 14px', fontSize: '0.82rem' }}
                                        onClick={onPause}
                                    >
                                        <Pause size={15} /> {t('scan.button.pause')}
                                    </button>
                                )}
                                <button
                                    className="btn btn-ghost"
                                    style={{
                                        flex: 1, justifyContent: 'center', padding: '9px 14px', fontSize: '0.82rem',
                                        color: 'var(--color-error)',
                                        borderColor: 'rgba(248,113,113,0.3)',
                                    }}
                                    onClick={onCancel}
                                >
                                    <Square size={14} /> {t('scan.button.cancel')}
                                </button>
                            </div>
                        </>
                    )}

                    {/* Complete / Cancelled */}
                    {isDone && scanProgress && (
                        <>
                            <div style={{ textAlign: 'center' }}>
                                {scanProgress.isCancelled ? (
                                    <>
                                        <Square size={40} style={{ color: 'var(--color-warning)', marginBottom: 8 }} />
                                        <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-warning)' }}>
                                            {t('scan.complete.cancelled')}
                                        </div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 6 }}>
                                            {t('scan.complete.cancelledDesc', { count: scanProgress.processed })}
                                            {(scanProgress.skipped ?? 0) > 0 && (
                                                <> ({t('scan.cacheLoaded', { count: scanProgress.skipped })})</>
                                            )}.
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <CheckCircle2 size={40} style={{ color: 'var(--color-success)', marginBottom: 8 }} />
                                        <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-success)' }}>
                                            {t('scan.complete.success')}
                                        </div>
                                        {lastScanInfo && (
                                            <div style={{ marginTop: 6, fontSize: '0.8rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                                                <span>⏱</span>
                                                <strong>{formatDuration(Math.round(lastScanInfo.durationMs / 1000))}</strong>
                                                <span>{t('scan.complete.durationSuffix')}</span>
                                            </div>
                                        )}
                                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)', marginTop: 6 }}>
                                            {(scanProgress.skipped ?? 0) > 0 ? (
                                                <>
                                                    <strong>{scanProgress.skipped}</strong> {t('scan.complete.cacheDetail')}{' '}
                                                    <strong>{scanProgress.processed - (scanProgress.skipped ?? 0)}</strong>{' '}
                                                    {autoRagIndexOn ? t('scan.complete.rescannedIndexedDetail') : t('scan.complete.rescannedDetail')}
                                                </>
                                            ) : (
                                                <>
                                                    <strong>{scanProgress.processed}</strong> {autoRagIndexOn ? t('scan.complete.indexedDetail') : t('scan.complete.scannedDetail')}
                                                </>
                                            )}
                                        </div>
                                        {/* Format dağılımı */}
                                        {scanProgress.typeCounts && Object.keys(scanProgress.typeCounts).length > 0 && (
                                            <div style={{ marginTop: 14, textAlign: 'left' }}>
                                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginBottom: 8, fontWeight: 600 }}>
                                                    {t('scan.complete.fileFormats')}
                                                </div>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                    {Object.entries(scanProgress.typeCounts)
                                                        .sort((a, b) => b[1] - a[1])
                                                        .map(([type, count]) => (
                                                            <span key={type} style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                                                background: 'var(--color-bg-tertiary)',
                                                                border: '1px solid var(--color-border)',
                                                                borderRadius: 6, padding: '3px 8px',
                                                                fontSize: '0.7rem', fontWeight: 600,
                                                            }}>
                                                                <span style={{ color: 'var(--color-accent)' }}>{type}</span>
                                                                <span style={{ color: 'var(--color-text-secondary)' }}>{count}</span>
                                                            </span>
                                                        ))
                                                    }
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            {scanProgress.errors.length > 0 && (
                                <div style={{ marginTop: 12, textAlign: 'left' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-warning)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8, justifyContent: 'center' }}>
                                        <AlertCircle size={14} />
                                        {t('scan.errors.occurred', { count: scanProgress.errors.length })}
                                    </div>
                                    <div style={{
                                        background: 'var(--color-bg-tertiary)', padding: 8, borderRadius: 6,
                                        maxHeight: 120, overflowY: 'auto', fontSize: '0.7rem', color: 'var(--color-text-secondary)',
                                        border: '1px solid var(--color-border)'
                                    }}>
                                        {scanProgress.errors.map((err, i) => (
                                            <div key={i} style={{ marginBottom: 4, wordBreak: 'break-all' }}>• {err}</div>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {!scanProgress.isCancelled && autoRagIndexProgress && (
                                <div style={{
                                    marginTop: 12, padding: '10px 12px', borderRadius: 6,
                                    background: 'rgba(99,102,241,0.06)',
                                    border: '1px solid rgba(99,102,241,0.18)',
                                    display: 'flex', gap: 8, alignItems: 'flex-start',
                                    fontSize: '0.74rem', color: 'var(--color-text-secondary)',
                                    lineHeight: 1.5,
                                }}>
                                    <Brain size={14} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 2 }} />
                                    <div>
                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                                            {t('scan.complete.autoRagActive')}
                                        </div>
                                        <div>
                                            {t('scan.complete.autoRagDesc', {
                                                current: autoRagIndexProgress.current,
                                                total: autoRagIndexProgress.total,
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}
                            <button className="btn btn-primary" onClick={onClose} style={{
                                width: '100%', justifyContent: 'center', padding: '10px 20px',
                            }}>
                                {t('scan.button.closeAndView')}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
        </ModalErrorBoundary>
    );
}
