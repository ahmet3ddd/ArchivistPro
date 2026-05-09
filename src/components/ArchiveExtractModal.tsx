/**
 * ArchivistPro — Arşiv Çıkarma (Extract) Modal
 *
 * Orchestrator — state yönetimi + adım yönlendirmesi.
 * Alt bileşenler: src/components/archiveExtract/
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Package } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useStore } from '../store/useStore';
import { useIsAdmin } from '../permissions';
import {
    extractAssets, previewExtract,
    ExtractBusyError, ExtractRollbackFailedError,
    type ExtractFilter, type ExtractProgress, type ExtractResult, type ExtractPreview,
} from '../services/archiveOps';
import {
    initArchive, initLocalDatabase, isArchiveReady,
    getAllAssetsFromArchive, setActiveArchive as setDbActiveArchive,
    MAIN_ARCHIVE_ID, LOCAL_ARCHIVE_ID,
    type ArchiveDef,
} from '../services/database';
import { type Tag } from '../services/tagService';
import { getAllTagsFromArchive } from '../services/database';
import { getAllPresets, savePreset, deletePreset, type FilterPreset } from '../services/filterPresets';
import { notifyError, notifySuccess } from '../services/notificationCenter';
import { mapTauriError } from '../services/errorMapper';
import ModalErrorBoundary from './ModalErrorBoundary';
import ConfigStep from './archiveExtract/ConfigStep';
import PreviewStep from './archiveExtract/PreviewStep';
import RunningStep from './archiveExtract/RunningStep';
import DoneStep from './archiveExtract/DoneStep';
import PresetBar from './archiveExtract/PresetBar';
import type { TargetMode, ExtractMode } from './archiveExtract/extractTypes';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

type Step = 'config' | 'preview' | 'running' | 'done';

function ArchiveExtractModalInner({ isOpen, onClose }: Props) {
    const { t } = useTranslation();
    const focusTrapRef = useFocusTrap(isOpen, onClose);
    const isAdmin = useIsAdmin();
    const archives = useStore((s) => s.archives);
    const addArchive = useStore((s) => s.addArchive);
    const setActiveArchive = useStore((s) => s.setActiveArchive);
    const scannedRoots = useStore((s) => s.scannedRoots);
    const activeArchive = useStore((s) => s.activeArchive);
    const setScannedAssets = useStore((s) => s.setScannedAssets);

    const [step, setStep] = useState<Step>('config');
    const [sourceId, setSourceId] = useState('');
    const [selectedFolders, setSelectedFolders] = useState<Set<string>>(new Set());
    const [selectedFileTypes, setSelectedFileTypes] = useState<Set<string>>(new Set());
    const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set());
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
    const [availableTags, setAvailableTags] = useState<Tag[]>([]);
    const [targetMode, setTargetMode] = useState<TargetMode>('new');
    const [newArchiveName, setNewArchiveName] = useState('');
    const [newArchiveType, setNewArchiveType] = useState<'shared' | 'personal'>('personal');
    const [existingTargetId, setExistingTargetId] = useState('');
    const [mode, setMode] = useState<ExtractMode>('copy');
    const [includeTags, setIncludeTags] = useState(true);
    const [includeEmbeddings, setIncludeEmbeddings] = useState(true);
    const [includeTextChunks, setIncludeTextChunks] = useState(true);
    const [includeSummaries, setIncludeSummaries] = useState(true);
    const [includeFavorites, setIncludeFavorites] = useState(true);
    const [preview, setPreview] = useState<ExtractPreview | null>(null);
    const [progress, setProgress] = useState<ExtractProgress | null>(null);
    const [result, setResult] = useState<ExtractResult | null>(null);
    const [expandFolders, setExpandFolders] = useState(true);
    const [expandFileTypes, setExpandFileTypes] = useState(true);
    const [expandPhases, setExpandPhases] = useState(false);
    const [expandDates, setExpandDates] = useState(false);
    const [expandTags, setExpandTags] = useState(false);
    const [presets, setPresets] = useState<FilterPreset[]>([]);
    const [presetName, setPresetName] = useState('');
    const [presetsLoaded, setPresetsLoaded] = useState(false);

    useEffect(() => {
        if (!sourceId || !isArchiveReady(sourceId)) { setAvailableTags([]); return; }
        setAvailableTags(getAllTagsFromArchive(sourceId));
    }, [sourceId, activeArchive]);

    useEffect(() => {
        if (!presetsLoaded) { setPresets(getAllPresets()); setPresetsLoaded(true); }
    }, [presetsLoaded]);

    const availableTargets = useMemo(() => {
        const base = isAdmin ? archives : archives.filter(a => a.type === 'personal');
        return base.filter(a => a.id !== sourceId);
    }, [archives, isAdmin, sourceId]);

    const applyPreset = useCallback((preset: FilterPreset) => {
        const f = preset.filter;
        setSelectedFolders(new Set(f.folderPaths ?? []));
        setSelectedFileTypes(new Set(f.fileTypes ?? []));
        setSelectedPhases(new Set(f.projectPhases ?? []));
        setDateFrom(f.dateFrom ?? '');
        setDateTo(f.dateTo ?? '');
        setSelectedTags(new Set(f.tagNames ?? []));
    }, []);

    const handleSavePreset = useCallback(() => {
        const name = presetName.trim();
        if (!name) return;
        const saved = savePreset(name, {
            folderPaths: selectedFolders.size > 0 ? Array.from(selectedFolders) : undefined,
            fileTypes: selectedFileTypes.size > 0 ? Array.from(selectedFileTypes) : undefined,
            projectPhases: selectedPhases.size > 0 ? Array.from(selectedPhases) : undefined,
            dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
            tagNames: selectedTags.size > 0 ? Array.from(selectedTags) : undefined,
        });
        if (saved) { setPresets(getAllPresets()); setPresetName(''); }
    }, [presetName, selectedFolders, selectedFileTypes, selectedPhases, dateFrom, dateTo, selectedTags]);

    const handleDeletePreset = useCallback((id: string) => {
        if (deletePreset(id)) setPresets(getAllPresets());
    }, []);

    const buildFilter = useCallback((): ExtractFilter => ({
        folderPaths: selectedFolders.size > 0 ? Array.from(selectedFolders) : undefined,
        fileTypes: selectedFileTypes.size > 0 ? Array.from(selectedFileTypes) : undefined,
        projectPhases: selectedPhases.size > 0 ? Array.from(selectedPhases) : undefined,
        dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
        tagNames: selectedTags.size > 0 ? Array.from(selectedTags) : undefined,
    }), [selectedFolders, selectedFileTypes, selectedPhases, dateFrom, dateTo, selectedTags]);

    const canPreview = useMemo(() => {
        if (!sourceId) return false;
        if (targetMode === 'new') {
            if (!newArchiveName.trim()) return false;
            if (archives.some(a => a.name === newArchiveName.trim())) return false;
        } else {
            if (!existingTargetId || existingTargetId === sourceId) return false;
        }
        return true;
    }, [sourceId, targetMode, newArchiveName, existingTargetId, archives]);

    const resetState = useCallback(() => {
        setStep('config'); setSourceId('');
        setSelectedFolders(new Set()); setSelectedFileTypes(new Set()); setSelectedPhases(new Set());
        setDateFrom(''); setDateTo(''); setSelectedTags(new Set());
        setTargetMode('new'); setNewArchiveName(''); setNewArchiveType('personal');
        setExistingTargetId(''); setMode('copy');
        setPreview(null); setProgress(null); setResult(null);
    }, []);

    const handleClose = useCallback(() => {
        if (step === 'running') return;
        resetState(); onClose();
    }, [step, resetState, onClose]);

    const ensureLoaded = useCallback(async (id: string) => {
        if (isArchiveReady(id)) return;
        if (id === LOCAL_ARCHIVE_ID) await initLocalDatabase();
        else if (id === MAIN_ARCHIVE_ID) throw new Error('Ana arşiv yüklü değil');
        else await initArchive(id);
    }, []);

    const handlePreview = useCallback(async () => {
        if (!canPreview) return;
        try {
            await ensureLoaded(sourceId);
            if (targetMode === 'existing' && existingTargetId) await ensureLoaded(existingTargetId);
            setPreview(previewExtract({ sourceId, filter: buildFilter() }));
            setStep('preview');
        } catch (err) {
            notifyError(t('extract.error.targetNotLoaded'), mapTauriError(err));
        }
    }, [canPreview, sourceId, targetMode, existingTargetId, ensureLoaded, buildFilter, t]);

    const handleStart = useCallback(async () => {
        setStep('running');
        setProgress({ phase: 'filtering', current: 0, total: 0, message: '' });
        try {
            const res = await extractAssets({
                sourceId, targetMode,
                newArchiveName: targetMode === 'new' ? newArchiveName.trim() : undefined,
                newArchiveType: targetMode === 'new' ? newArchiveType : undefined,
                existingTargetId: targetMode === 'existing' ? existingTargetId : undefined,
                filter: buildFilter(), mode,
                includeTags, includeEmbeddings, includeTextChunks, includeSummaries, includeFavorites,
                onProgress: (p) => setProgress(p),
            });
            setResult(res); setStep('done');
            if (targetMode === 'new' && res.targetArchiveId && res.extractedCount > 0) {
                const def: ArchiveDef = { id: res.targetArchiveId, name: newArchiveName.trim(), type: newArchiveType, createdAt: new Date().toISOString() };
                addArchive(def);
            }
            if (sourceId === activeArchive && mode === 'move') setScannedAssets(getAllAssetsFromArchive(activeArchive));
            if (res.errors.length === 0) notifySuccess(t('extract.result.title'), '');
        } catch (err) {
            let msg: string;
            if (err instanceof ExtractBusyError) { msg = t('extract.error.alreadyRunning'); notifyError(t('extract.result.title'), msg); setStep('config'); return; }
            else if (err instanceof ExtractRollbackFailedError) msg = t('extract.error.rollbackFailed');
            else msg = mapTauriError(err);
            notifyError(t('extract.result.title'), msg);
            setStep('done');
            setResult({ matchedCount: 0, extractedCount: 0, deletedFromSource: 0, tagsCopied: 0, embeddingsCopied: 0, chunksCopied: 0, summariesCopied: 0, favoritesCopied: 0, targetArchiveId: '', errors: [msg] });
        }
    }, [sourceId, targetMode, newArchiveName, newArchiveType, existingTargetId, buildFilter, mode, includeTags, includeEmbeddings, includeTextChunks, includeSummaries, includeFavorites, addArchive, activeArchive, setScannedAssets, t]);

    const handleGoToTarget = useCallback(() => {
        if (result?.targetArchiveId) { setActiveArchive(result.targetArchiveId); setDbActiveArchive(result.targetArchiveId); }
        handleClose();
    }, [result, setActiveArchive, handleClose]);

    if (!isOpen) return null;

    return (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('extract.title')}
            style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
            onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}>
            <div ref={focusTrapRef} style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid var(--color-border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Package size={18} style={{ color: 'var(--color-accent)' }} />
                        <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>{t('extract.title')}</span>
                    </div>
                    <button onClick={handleClose} disabled={step === 'running'}
                        style={{ background: 'none', border: 'none', cursor: step === 'running' ? 'not-allowed' : 'pointer', color: 'var(--color-text-muted)', padding: 4, borderRadius: 4, opacity: step === 'running' ? 0.4 : 1 }}>
                        <X size={18} />
                    </button>
                </div>
                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
                    {step === 'config' && (
                        <>
                            <PresetBar presets={presets} presetName={presetName} setPresetName={setPresetName}
                                onApply={applyPreset} onSave={handleSavePreset} onDelete={handleDeletePreset} />
                            <ConfigStep
                                archives={archives} availableTargets={availableTargets}
                                scannedRoots={scannedRoots} availableTags={availableTags}
                                sourceId={sourceId} setSourceId={setSourceId}
                                selectedFolders={selectedFolders} setSelectedFolders={setSelectedFolders}
                                selectedFileTypes={selectedFileTypes} setSelectedFileTypes={setSelectedFileTypes}
                                selectedPhases={selectedPhases} setSelectedPhases={setSelectedPhases}
                                dateFrom={dateFrom} setDateFrom={setDateFrom}
                                dateTo={dateTo} setDateTo={setDateTo}
                                selectedTags={selectedTags} setSelectedTags={setSelectedTags}
                                targetMode={targetMode} setTargetMode={setTargetMode}
                                newArchiveName={newArchiveName} setNewArchiveName={setNewArchiveName}
                                newArchiveType={newArchiveType} setNewArchiveType={setNewArchiveType}
                                existingTargetId={existingTargetId} setExistingTargetId={setExistingTargetId}
                                mode={mode} setMode={setMode}
                                includeTags={includeTags} setIncludeTags={setIncludeTags}
                                includeEmbeddings={includeEmbeddings} setIncludeEmbeddings={setIncludeEmbeddings}
                                includeTextChunks={includeTextChunks} setIncludeTextChunks={setIncludeTextChunks}
                                includeSummaries={includeSummaries} setIncludeSummaries={setIncludeSummaries}
                                includeFavorites={includeFavorites} setIncludeFavorites={setIncludeFavorites}
                                expandFolders={expandFolders} setExpandFolders={setExpandFolders}
                                expandFileTypes={expandFileTypes} setExpandFileTypes={setExpandFileTypes}
                                expandPhases={expandPhases} setExpandPhases={setExpandPhases}
                                expandDates={expandDates} setExpandDates={setExpandDates}
                                expandTags={expandTags} setExpandTags={setExpandTags}
                                isAdmin={isAdmin}
                            />
                        </>
                    )}
                    {step === 'preview' && preview && <PreviewStep preview={preview} mode={mode} sourceId={sourceId} filter={buildFilter()} />}
                    {step === 'running' && progress && <RunningStep progress={progress} />}
                    {step === 'done' && result && <DoneStep result={result} targetMode={targetMode} />}
                </div>
                {/* Footer */}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--color-border)' }}>
                    {step === 'config' && (
                        <>
                            <button className="btn btn-ghost" onClick={handleClose}>{t('common.cancel')}</button>
                            <button className="btn btn-primary" onClick={handlePreview} disabled={!canPreview}>{t('extract.preview.button')}</button>
                        </>
                    )}
                    {step === 'preview' && (
                        <>
                            <button className="btn btn-ghost" onClick={() => setStep('config')}>{t('common.back')}</button>
                            <button className="btn btn-primary" onClick={handleStart} disabled={preview?.matchedCount === 0}
                                style={mode === 'move' ? { background: '#dc2626', borderColor: '#dc2626' } : undefined}>
                                {t('extract.confirm.button')}
                            </button>
                        </>
                    )}
                    {step === 'done' && (
                        <>
                            {targetMode === 'new' && result?.targetArchiveId && result.extractedCount > 0 && (
                                <button className="btn btn-ghost" onClick={handleGoToTarget}>{t('extract.result.goToTarget')}</button>
                            )}
                            <button className="btn btn-primary" onClick={handleClose}>{t('common.ok')}</button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function ArchiveExtractModal(props: Props) {
    if (!props.isOpen) return null;
    return (
        <ModalErrorBoundary onClose={props.onClose}>
            <ArchiveExtractModalInner {...props} />
        </ModalErrorBoundary>
    );
}
