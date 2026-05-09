/**
 * ArchivistPro — Arşiv Birleştirme (Join) Modal (Faz 2)
 *
 * İki arşivin asset'lerini + ilişkili verilerini (tag/embedding/chunk/summary/favorite)
 * tek bir hedef arşivde birleştirir. Çakışma stratejisi seçilir, preview gösterilir.
 */

import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, GitMerge, AlertTriangle, CheckCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useStore } from '../store/useStore';
import { useIsAdmin } from '../permissions';
import {
    joinArchives,
    previewJoin,
    previewJoinDetailed,
    JoinBusyError,
    JoinRollbackFailedError,
    type ConflictStrategy,
    type JoinProgress,
    type JoinResult,
    type JoinPreview,
    type JoinDetailedPreview,
    type JoinDisposition,
} from '../services/archiveOps';
import {
    initArchive,
    initLocalDatabase,
    isArchiveReady,
    getAllAssetsFromArchive,
    MAIN_ARCHIVE_ID,
    LOCAL_ARCHIVE_ID,
} from '../services/database';
import { notifyError, notifySuccess } from '../services/notificationCenter';
import { mapTauriError } from '../services/errorMapper';
import ModalErrorBoundary from './ModalErrorBoundary';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

type Step = 'config' | 'preview' | 'running' | 'done';

function ArchiveMergeModalInner({ isOpen, onClose }: Props) {
    const { t } = useTranslation();
    const focusTrapRef = useFocusTrap(isOpen, onClose);
    const isAdmin = useIsAdmin();
    const archives = useStore((s) => s.archives);
    const activeArchive = useStore((s) => s.activeArchive);
    const setScannedAssets = useStore((s) => s.setScannedAssets);

    const [step, setStep] = useState<Step>('config');
    const [sourceId, setSourceId] = useState<string>('');
    const [targetId, setTargetId] = useState<string>('');
    const [strategy, setStrategy] = useState<ConflictStrategy>('keep_newer');
    const [includeTags, setIncludeTags] = useState(true);
    const [includeEmbeddings, setIncludeEmbeddings] = useState(true);
    const [includeTextChunks, setIncludeTextChunks] = useState(true);
    const [includeSummaries, setIncludeSummaries] = useState(true);
    const [includeFavorites, setIncludeFavorites] = useState(true);
    const [preview, setPreview] = useState<JoinPreview | null>(null);
    const [progress, setProgress] = useState<JoinProgress | null>(null);
    const [result, setResult] = useState<JoinResult | null>(null);

    // Viewer: sadece personal hedefe yazabilir
    const availableTargets = useMemo(() => {
        if (isAdmin) return archives;
        return archives.filter(a => a.type === 'personal');
    }, [archives, isAdmin]);

    const canPreview = sourceId && targetId && sourceId !== targetId;

    const resetState = useCallback(() => {
        setStep('config');
        setSourceId('');
        setTargetId('');
        setStrategy('keep_newer');
        setPreview(null);
        setProgress(null);
        setResult(null);
    }, []);

    const handleClose = useCallback(() => {
        if (step === 'running') return; // Çalışma sırasında kapatma yok
        resetState();
        onClose();
    }, [step, resetState, onClose]);

    const ensureLoaded = useCallback(async (id: string) => {
        if (isArchiveReady(id)) return;
        if (id === LOCAL_ARCHIVE_ID) {
            await initLocalDatabase();
        } else if (id === MAIN_ARCHIVE_ID) {
            // Main normalde yüklü olur; değilse hata
            throw new Error('Ana arşiv yüklü değil');
        } else {
            await initArchive(id);
        }
    }, []);

    const handlePreview = useCallback(async () => {
        if (!canPreview) return;
        try {
            await ensureLoaded(sourceId);
            await ensureLoaded(targetId);
            const p = previewJoin({ sourceId, targetId });
            setPreview(p);
            setStep('preview');
        } catch (err) {
            notifyError(t('merge.error.targetNotLoaded'), mapTauriError(err));
        }
    }, [canPreview, sourceId, targetId, ensureLoaded, t]);

    const handleStart = useCallback(async () => {
        setStep('running');
        setProgress({ phase: 'assets', current: 0, total: 0, message: '' });
        try {
            const res = await joinArchives({
                sourceId,
                targetId,
                conflictStrategy: strategy,
                includeEmbeddings,
                includeTags,
                includeTextChunks,
                includeSummaries,
                includeFavorites,
                onProgress: (p) => setProgress(p),
            });
            setResult(res);
            setStep('done');

            // Aktif arşiv hedef ise yeniden yükle
            if (targetId === activeArchive) {
                const fresh = getAllAssetsFromArchive(activeArchive);
                setScannedAssets(fresh);
            }

            if (res.errors.length === 0) {
                notifySuccess(t('merge.result.title'), '');
            }
        } catch (err) {
            // Özel hata tiplerini kullanıcı dostu mesajlara çevir
            let errorMessage: string;
            if (err instanceof JoinBusyError) {
                errorMessage = t('merge.error.alreadyRunning');
                notifyError(t('merge.result.title'), errorMessage);
                setStep('config'); // Config'e geri dön, modal'ı bozma
                return;
            } else if (err instanceof JoinRollbackFailedError) {
                errorMessage = t('merge.error.rollbackFailed');
            } else {
                errorMessage = mapTauriError(err);
            }
            notifyError(t('merge.result.title'), errorMessage);
            setStep('done');
            setResult({
                merged: 0, skipped: 0, overwritten: 0, renamed: 0,
                tagsCopied: 0, embeddingsCopied: 0, chunksCopied: 0,
                summariesCopied: 0, favoritesCopied: 0,
                errors: [errorMessage],
            });
        }
    }, [sourceId, targetId, strategy, includeEmbeddings, includeTags, includeTextChunks, includeSummaries, includeFavorites, activeArchive, setScannedAssets, t]);

    if (!isOpen) return null;

    return (
        <div
            className="modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={t('merge.title')}
            style={{
                position: 'fixed', inset: 0, zIndex: 9100,
                background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
        >
            <div
                ref={focusTrapRef}
                style={{
                    background: 'var(--color-bg-secondary)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    width: '100%', maxWidth: 620,
                    maxHeight: '90vh', display: 'flex', flexDirection: 'column',
                    overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '14px 20px', borderBottom: '1px solid var(--color-border)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <GitMerge size={18} style={{ color: 'var(--color-accent)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{t('merge.title')}</span>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={step === 'running'}
                        style={{
                            background: 'none', border: 'none', cursor: step === 'running' ? 'not-allowed' : 'pointer',
                            color: 'var(--color-text-muted)', padding: 4, borderRadius: 4,
                            opacity: step === 'running' ? 0.4 : 1,
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
                    {step === 'config' && (
                        <ConfigStep
                            archives={archives}
                            availableTargets={availableTargets}
                            sourceId={sourceId}
                            setSourceId={setSourceId}
                            targetId={targetId}
                            setTargetId={setTargetId}
                            strategy={strategy}
                            setStrategy={setStrategy}
                            includeTags={includeTags}
                            setIncludeTags={setIncludeTags}
                            includeEmbeddings={includeEmbeddings}
                            setIncludeEmbeddings={setIncludeEmbeddings}
                            includeTextChunks={includeTextChunks}
                            setIncludeTextChunks={setIncludeTextChunks}
                            includeSummaries={includeSummaries}
                            setIncludeSummaries={setIncludeSummaries}
                            includeFavorites={includeFavorites}
                            setIncludeFavorites={setIncludeFavorites}
                        />
                    )}

                    {step === 'preview' && preview && (
                        <PreviewStep preview={preview} strategy={strategy} sourceId={sourceId} targetId={targetId} />
                    )}

                    {step === 'running' && progress && (
                        <RunningStep progress={progress} />
                    )}

                    {step === 'done' && result && (
                        <DoneStep result={result} />
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    display: 'flex', gap: 8, justifyContent: 'flex-end',
                    padding: '12px 20px', borderTop: '1px solid var(--color-border)',
                }}>
                    {step === 'config' && (
                        <>
                            <button className="btn btn-ghost" onClick={handleClose}>
                                {t('common.cancel')}
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handlePreview}
                                disabled={!canPreview}
                            >
                                {t('merge.preview.button')}
                            </button>
                        </>
                    )}
                    {step === 'preview' && (
                        <>
                            <button className="btn btn-ghost" onClick={() => setStep('config')}>
                                {t('common.back')}
                            </button>
                            <button className="btn btn-primary" onClick={handleStart}>
                                {t('merge.confirm.button')}
                            </button>
                        </>
                    )}
                    {step === 'done' && (
                        <button className="btn btn-primary" onClick={handleClose}>
                            {t('common.ok')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ── Alt Adım Bileşenleri ── */

function ConfigStep(props: {
    archives: ReturnType<typeof useStore.getState>['archives'];
    availableTargets: ReturnType<typeof useStore.getState>['archives'];
    sourceId: string;
    setSourceId: (id: string) => void;
    targetId: string;
    setTargetId: (id: string) => void;
    strategy: ConflictStrategy;
    setStrategy: (s: ConflictStrategy) => void;
    includeTags: boolean;
    setIncludeTags: (b: boolean) => void;
    includeEmbeddings: boolean;
    setIncludeEmbeddings: (b: boolean) => void;
    includeTextChunks: boolean;
    setIncludeTextChunks: (b: boolean) => void;
    includeSummaries: boolean;
    setIncludeSummaries: (b: boolean) => void;
    includeFavorites: boolean;
    setIncludeFavorites: (b: boolean) => void;
}) {
    const { t } = useTranslation();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Kaynak */}
            <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>
                    {t('merge.source')}
                </label>
                <select
                    value={props.sourceId}
                    onChange={(e) => props.setSourceId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.82rem' }}
                >
                    <option value="">—</option>
                    {props.archives.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>
            </div>

            {/* Hedef */}
            <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>
                    {t('merge.target')}
                </label>
                <select
                    value={props.targetId}
                    onChange={(e) => props.setTargetId(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.82rem' }}
                >
                    <option value="">—</option>
                    {props.availableTargets
                        .filter(a => a.id !== props.sourceId)
                        .map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                </select>
                {props.sourceId && props.targetId && props.sourceId === props.targetId && (
                    <div style={{ fontSize: '0.72rem', color: '#ef4444', marginTop: 4 }}>
                        {t('merge.error.sameArchive')}
                    </div>
                )}
            </div>

            {/* Strateji */}
            <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>
                    {t('merge.strategy.title')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <RadioOption value="keep_newer" current={props.strategy} onChange={props.setStrategy} label={t('merge.strategy.keepNewer')} />
                    <RadioOption value="keep_both" current={props.strategy} onChange={props.setStrategy} label={t('merge.strategy.keepBoth')} />
                    <RadioOption value="skip_existing" current={props.strategy} onChange={props.setStrategy} label={t('merge.strategy.skipExisting')} />
                </div>
            </div>

            {/* Include */}
            <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: 6 }}>
                    {t('merge.include.title')}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <CheckboxOption checked={props.includeTags} onChange={props.setIncludeTags} label={t('merge.include.tags')} />
                    <CheckboxOption checked={props.includeEmbeddings} onChange={props.setIncludeEmbeddings} label={t('merge.include.embeddings')} />
                    <CheckboxOption checked={props.includeTextChunks} onChange={props.setIncludeTextChunks} label={t('merge.include.textChunks')} />
                    <CheckboxOption checked={props.includeSummaries} onChange={props.setIncludeSummaries} label={t('merge.include.summaries')} />
                    <CheckboxOption checked={props.includeFavorites} onChange={props.setIncludeFavorites} label={t('merge.include.favorites')} />
                </div>
            </div>
        </div>
    );
}

function RadioOption({ value, current, onChange, label }: { value: ConflictStrategy; current: ConflictStrategy; onChange: (v: ConflictStrategy) => void; label: string }) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem' }}>
            <input
                type="radio"
                checked={current === value}
                onChange={() => onChange(value)}
                style={{ accentColor: 'var(--color-accent)' }}
            />
            {label}
        </label>
    );
}

function CheckboxOption({ checked, onChange, label }: { checked: boolean; onChange: (b: boolean) => void; label: string }) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.82rem' }}>
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                style={{ accentColor: 'var(--color-accent)' }}
            />
            {label}
        </label>
    );
}

function PreviewStep({ preview, strategy, sourceId, targetId }: { preview: JoinPreview; strategy: ConflictStrategy; sourceId: string; targetId: string }) {
    const { t } = useTranslation();
    const [showDetails, setShowDetails] = useState(false);
    const [detailed, setDetailed] = useState<JoinDetailedPreview | null>(null);

    const handleToggleDetails = useCallback(() => {
        if (!showDetails && !detailed) {
            setDetailed(previewJoinDetailed({ sourceId, targetId, conflictStrategy: strategy }));
        }
        setShowDetails(v => !v);
    }, [showDetails, detailed, sourceId, targetId, strategy]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8 }}>
                <AlertTriangle size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
                <span style={{ fontSize: '0.78rem', color: '#fbbf24' }}>
                    {t('merge.confirm.warning')}
                </span>
            </div>

            <StatRow label={t('merge.preview.sourceAssets')} value={preview.sourceAssetCount} />
            <StatRow label={t('merge.preview.targetAssets')} value={preview.targetAssetCount} />
            <StatRow label={t('merge.preview.conflicts')} value={preview.conflictCount} highlight={preview.conflictCount > 0} />
            <StatRow label={t('merge.preview.tags')} value={preview.tagCount} />
            <StatRow label={t('merge.preview.embeddings')} value={preview.embeddingCount} />

            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                {t('merge.preview.strategyNote', { strategy: t(`merge.strategy.${strategy === 'keep_newer' ? 'keepNewer' : strategy === 'keep_both' ? 'keepBoth' : 'skipExisting'}`) })}
            </div>

            <button
                type="button"
                onClick={handleToggleDetails}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--color-accent)', fontSize: '0.78rem', padding: '4px 0',
                    alignSelf: 'flex-start',
                }}
            >
                {showDetails ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {t('merge.preview.toggleDetails', { defaultValue: 'Detaylı liste' })}
            </button>

            {showDetails && detailed && (
                <DispositionList detailed={detailed} />
            )}
        </div>
    );
}

function DispositionList({ detailed }: { detailed: JoinDetailedPreview }) {
    const { t } = useTranslation();
    const dispositionColor: Record<JoinDisposition, string> = {
        merge: '#10b981',
        overwrite: '#f59e0b',
        skip: 'var(--color-text-muted)',
        rename: '#3b82f6',
    };
    const dispositionLabel = (d: JoinDisposition): string =>
        t(`merge.disposition.${d}`, { defaultValue: d });
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', gap: 12, fontSize: '0.72rem', color: 'var(--color-text-muted)', flexWrap: 'wrap' }}>
                <span style={{ color: dispositionColor.merge }}>{dispositionLabel('merge')}: {detailed.counts.merge}</span>
                <span style={{ color: dispositionColor.overwrite }}>{dispositionLabel('overwrite')}: {detailed.counts.overwrite}</span>
                <span style={{ color: dispositionColor.skip }}>{dispositionLabel('skip')}: {detailed.counts.skip}</span>
                <span style={{ color: dispositionColor.rename }}>{dispositionLabel('rename')}: {detailed.counts.rename}</span>
            </div>
            <div style={{
                maxHeight: 240, overflowY: 'auto',
                background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6,
                fontSize: '0.7rem', fontFamily: 'monospace',
                border: '1px solid var(--color-border)',
            }}>
                {detailed.items.map(item => (
                    <div key={item.assetId} style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
                        <span style={{ color: dispositionColor[item.disposition], minWidth: 70, flexShrink: 0 }}>
                            [{dispositionLabel(item.disposition)}]
                        </span>
                        <span style={{ color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.fileName}
                        </span>
                    </div>
                ))}
                {detailed.truncated && (
                    <div style={{ padding: '4px 0', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                        … {t('merge.preview.truncated', { defaultValue: 'ilk {{limit}} kayıt gösteriliyor', limit: detailed.limit })}
                    </div>
                )}
            </div>
        </div>
    );
}

function StatRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
            <span style={{ fontWeight: 600, color: highlight ? '#f59e0b' : 'var(--color-text-primary)' }}>{value}</span>
        </div>
    );
}

function RunningStep({ progress }: { progress: JoinProgress }) {
    const { t } = useTranslation();
    const phaseLabel = t(`merge.progress.phase.${progress.phase}`, { defaultValue: progress.phase });
    const percent = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', padding: 24 }}>
            <Loader2 size={32} className="spinner" style={{ color: 'var(--color-accent)' }} />
            <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{phaseLabel}</div>
            {progress.total > 0 && (
                <>
                    <div style={{ width: '100%', height: 6, background: 'var(--color-bg-primary)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${percent}%`, height: '100%', background: 'var(--color-accent)', transition: 'width 0.2s' }} />
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)' }}>
                        {progress.current} / {progress.total}
                    </div>
                </>
            )}
        </div>
    );
}

function DoneStep({ result }: { result: JoinResult }) {
    const { t } = useTranslation();
    const hasErrors = result.errors.length > 0;
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: hasErrors ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)', border: `1px solid ${hasErrors ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`, borderRadius: 8 }}>
                {hasErrors ? (
                    <AlertTriangle size={18} style={{ color: '#ef4444' }} />
                ) : (
                    <CheckCircle size={18} style={{ color: '#10b981' }} />
                )}
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                    {t('merge.result.title')}
                </span>
            </div>

            <StatRow label={t('merge.result.merged')} value={result.merged} />
            <StatRow label={t('merge.result.overwritten')} value={result.overwritten} />
            <StatRow label={t('merge.result.skipped')} value={result.skipped} />
            <StatRow label={t('merge.result.renamed')} value={result.renamed} />
            {result.tagsCopied > 0 && <StatRow label={t('merge.include.tags')} value={result.tagsCopied} />}
            {result.embeddingsCopied > 0 && <StatRow label={t('merge.include.embeddings')} value={result.embeddingsCopied} />}
            {result.chunksCopied > 0 && <StatRow label={t('merge.include.textChunks')} value={result.chunksCopied} />}
            {result.summariesCopied > 0 && <StatRow label={t('merge.include.summaries')} value={result.summariesCopied} />}
            {result.favoritesCopied > 0 && <StatRow label={t('merge.include.favorites')} value={result.favoritesCopied} />}

            {hasErrors && (
                <div>
                    <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#ef4444', marginTop: 8, marginBottom: 6 }}>
                        {t('merge.result.errors')} ({result.errors.length})
                    </div>
                    <div style={{ maxHeight: 120, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 6, fontSize: '0.7rem', color: '#fca5a5', fontFamily: 'monospace' }}>
                        {result.errors.slice(0, 50).map((e, i) => (
                            <div key={i}>{e}</div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default function ArchiveMergeModal(props: Props) {
    if (!props.isOpen) return null;
    return (
        <ModalErrorBoundary onClose={props.onClose}>
            <ArchiveMergeModalInner {...props} />
        </ModalErrorBoundary>
    );
}
