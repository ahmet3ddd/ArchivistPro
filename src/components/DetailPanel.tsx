import { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { X, ExternalLink, Copy, FolderOpen, Tag, FileDown, FileOutput, SearchCheck, Archive, ChevronDown, Briefcase, RefreshCw } from 'lucide-react';
import { TIMINGS } from '../config/constants';
import type { Asset, ApprovalStatus } from '../types';
import { formatFileSize, formatDate } from '../data';
import AssetTagsPanel from './AssetTagsPanel';
import AssetRelationsPanel from './AssetRelationsPanel';
import { invoke } from '@tauri-apps/api/core';
import { open as openShell } from '@tauri-apps/plugin-shell';
import type { MatchSource } from '../services/queryExpansion';
import { useStore } from '../store/useStore';
import { notifyError, notifySuccess, notifyInfo } from '../services/notificationCenter';
import { mapTauriError } from '../services/errorMapper';
import { hasAdminFeatures } from '../services/buildFeatures';
import { getChunkById, getChunkCountByAssetId, getChunksByAssetId, getBackupsForAsset, updateAssetFields, getAssetById } from '../services/database';
import { writeXmpSidecar } from '../services/xmpSidecar';
import ModalErrorBoundary from './ModalErrorBoundary';
import { AssetPreview, ColorPaletteSection, COLOR_EXTRACT_TYPES_SET } from './detailPanel/detailHelpers';
import DetailFormatProps from './detailPanel/DetailFormatProps';
import DetailTechMeta from './detailPanel/DetailTechMeta';

interface DetailPanelProps {
    asset: Asset | null;
    onClose: () => void;
    onUpdate?: (updated: Asset) => void;
    matchSources?: MatchSource[];
    onSelectAsset?: (assetId: string) => void;
}

/** Renders a visual preview for the asset in the detail panel */
export default function DetailPanel({ asset, onClose, onUpdate, matchSources, onSelectAsset }: DetailPanelProps) {
    const { t } = useTranslation();
    const [isConverting, setIsConverting] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [isExtractingColors, setIsExtractingColors] = useState(false);
    const [showVersionPicker, setShowVersionPicker] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isXmpExporting, setIsXmpExporting] = useState(false);
    const [clientNameLen, setClientNameLen] = useState(0);
    const [versionLabelLen, setVersionLabelLen] = useState(asset?.versionLabel?.length ?? 0);

    // Kullanıcı tanımlı proje alanları için yerel state (yeniden taramada korunur)
    const [editingClientName, setEditingClientName] = useState(false);

    // Hooks — React kuralı: koşullu return'den ÖNCE tüm hook'lar çağrılmalı
    const semanticResults = useStore((s) => s.semanticResults);
    const aiConfig = useStore((s) => s.aiConfig);
    const [ragIndexTick, setRagIndexTick] = useState(0);
    const [ragIndexing, setRagIndexing] = useState(false);
    const [chunkPreviewExpanded, setChunkPreviewExpanded] = useState(false);
    type ConvertMode = 'quick' | 'real';
    const [convertMode, setConvertMode] = useState<ConvertMode>('quick');
    const [maxInstalls, setMaxInstalls] = useState<Array<{ version: number; year: number; exe_path: string; min_save_version: number }> | null>(null);

    const matchedChunk = useMemo(() => {
        if (!asset || !semanticResults || semanticResults.length === 0) return null;
        const hit = semanticResults.find((r) => r.assetId === asset.id && r.chunkId);
        if (!hit?.chunkId) return null;
        return getChunkById(hit.chunkId);
    }, [semanticResults, asset]);

    const docIndexInfo = useMemo(() => {
        if (!asset) return null;
        const DOC_TYPES = new Set(['PDF', 'DOC', 'XLS', 'PPT', 'TXT', 'CSV', 'RTF', 'SAP2K']);
        if (!DOC_TYPES.has(asset.fileType)) return null;
        const chunkCount = getChunkCountByAssetId(asset.id);
        const previewLimit = chunkPreviewExpanded ? Math.min(chunkCount, 20) : 3;
        const previews = chunkCount > 0 ? getChunksByAssetId(asset.id, previewLimit) : [];
        return { chunkCount, previews };
    // ragIndexTick değişince yeniden okuyor
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [asset, ragIndexTick, chunkPreviewExpanded]);

    const handleRagIndex = useCallback(async () => {
        if (!asset || ragIndexing) return;
        setRagIndexing(true);
        try {
            const { indexAssetForRag } = await import('../services/textChunker');
            const { notifySuccess, notifyError: notifyErr } = await import('../services/notificationCenter');
            const result = await indexAssetForRag(asset.id, asset.filePath, { aiConfig });
            if (result.skipped) {
                notifyErr(`Indexlenemedi: ${result.reason}`);
            } else {
                const msg = result.kind === 'ocr'
                    ? `OCR ile ${result.chunks} parça oluşturuldu. AI Sohbet'e hazır.`
                    : `${result.chunks} parça (chunk) oluşturuldu. AI Sohbet'e hazır.`;
                notifySuccess(msg);
            }
            setRagIndexTick((v) => v + 1);
        } catch (err) {
            const { notifyError: notifyErr } = await import('../services/notificationCenter');
            notifyErr(`Hata: ${String((err as Error).message || err)}`);
        } finally {
            setRagIndexing(false);
        }
    }, [asset, ragIndexing, aiConfig]);

    const backupInfo = useMemo(() => {
        if (!asset) return null;
        if (asset.fileType === 'BAK') return null; // Yedek dosyanın kendisi zaten görünmüyor
        const backups = getBackupsForAsset(asset.filePath);
        if (backups.length === 0) return null;
        const totalSize = backups.reduce((sum, b) => sum + b.fileSize, 0);
        return { backups, totalSize };
    }, [asset]);

    const detectMaxInstalls = useCallback(async () => {
        if (maxInstalls !== null) return;
        try {
            const installs = await invoke<Array<{ version: number; year: number; exe_path: string; min_save_version: number }>>('detect_max_installations');
            setMaxInstalls(installs);
            if (installs.length > 0) setConvertMode('real');
        } catch {
            setMaxInstalls([]);
        }
    }, [maxInstalls]);

    const addConvertedAsset = useCallback(async (newPath: string, targetV: number) => {
        if (!asset) return;
        const targetYear = targetV + 1998;
        if (onUpdate) {
            const newFileName = newPath.split(/[/\\]/).pop() || '';
            const newAsset: Asset = {
                ...asset,
                id: `${asset.id}_v${targetYear}`,
                fileName: newFileName,
                filePath: newPath,
                modifiedAt: new Date().toISOString(),
                metadata: {
                    ...asset.metadata,
                    maxVersion: `${targetYear} (V${targetV})`,
                    convertedFrom: { path: asset.filePath, version: asset.metadata.maxVersion || i18n.t('common.unknown') },
                },
                aiTags: [
                    ...asset.aiTags.filter(t => t.label !== 'Sürüm Dönüştürülmüş'),
                    { label: 'Sürüm Dönüştürülmüş', confidence: 1, source: 'metadata' as const },
                ],
            };
            const { upsertAsset, saveDatabaseDeferred } = await import('../services/database');
            upsertAsset(newAsset);
            saveDatabaseDeferred();
            useStore.getState().setScannedAssets((prev: Asset[]) => [...prev, newAsset]);
        }
    }, [asset, onUpdate]);

    if (!asset) return null;

    const saveField = (fields: {
        clientName?: string | null;
        approvalStatus?: ApprovalStatus | null;
        rejectionReason?: string | null;
        versionLabel?: string | null;
        deadline?: string | null;
    }) => {
        updateAssetFields(asset.id, fields, useStore.getState().currentUser || undefined);
        const updated = getAssetById(asset.id);
        if (updated) onUpdate?.(updated);
        // Onay durumu değiştiğinde persistent bildirim
        if (fields.approvalStatus && fields.approvalStatus !== asset.approvalStatus) {
            const msg = t('approval.statusChanged', {
                file: asset.fileName,
                status: t(`assetStatus.status.${fields.approvalStatus}`),
            });
            if (fields.approvalStatus === 'approved') {
                notifySuccess(t('approval.title'), msg);
            } else if (fields.approvalStatus === 'rejected') {
                notifyInfo(t('approval.title'), msg);
            } else {
                useStore.getState().addToast(msg, 'info');
            }
        }
    };

    // Format-specific metadata var mı? (Format Özellikleri bölümünü göstermek için)
    const hasFormatProps = !!(
        ((asset.fileType === 'DWG' || asset.fileType === 'DXF') && (asset.metadata.dwgVersion || asset.metadata.dwgCreatedAt)) ||
        (asset.fileType === 'MAX' && (asset.metadata.maxVersion || asset.metadata.convertedFrom)) ||
        asset.metadata.convertedFrom ||
        (asset.fileType === 'SKP' && asset.metadata.skpVersion) ||
        (asset.fileType === 'RVT' && (asset.metadata.rvtVersion || asset.metadata.rvtProjectName || asset.metadata.rvtWorkshared || (asset.metadata.rvtStoreyCount != null && asset.metadata.rvtStoreyCount > 0))) ||
        (asset.fileType === 'IFC' && (asset.metadata.ifcSchema || asset.metadata.ifcProjectName || asset.metadata.ifcBuildingName || asset.metadata.ifcOriginatingSystem || (asset.metadata.ifcTotalEntities != null && asset.metadata.ifcTotalEntities > 0) || (asset.metadata.ifcStoreyCount != null && asset.metadata.ifcStoreyCount > 0) || (asset.metadata.ifcSpaceCount != null && asset.metadata.ifcSpaceCount > 0))) ||
        asset.omniclassCode
    );

    function cleanTextPreview(input: string): { text: string; isLikelyGarbage: boolean } {
        const s = (input || '').replace(/\r\n/g, '\n');
        if (!s.trim()) return { text: '', isLikelyGarbage: false };

        let out = '';
        let nonPrintable = 0;
        let replacement = 0;

        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            const code = ch.charCodeAt(0);
            if (ch === '\uFFFD') { replacement++; nonPrintable++; continue; }
            const isAllowedControl = ch === '\n' || ch === '\t';
            const isControl = code < 32 || code === 127;
            if (isControl && !isAllowedControl) { nonPrintable++; continue; }
            out += ch;
        }

        out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        const len = Math.max(1, s.length);
        const isLikelyGarbage = out.length < 20 || (nonPrintable / len) > 0.15 || (replacement / len) > 0.02;
        return { text: out, isLikelyGarbage };
    }

    const handleOpen = async () => {
        try {
            // Önce Rust native komutunu dene (en güvenilir yöntem)
            await invoke('open_file_native', { path: asset.filePath });
        } catch {
            // Yedek: Tauri shell plugin
            try {
                await openShell(asset.filePath);
            } catch (err) {
                notifyError(i18n.t('detail.error.openFileFailed', { error: err }));
            }
        }
    };

    const handleShowInFolder = async () => {
        try {
            await invoke('show_in_folder', { path: asset.filePath });
        } catch (err) {
            notifyError(i18n.t('detail.error.openFolderFailed', { error: err }));
        }
    };

    const COLOR_EXTRACT_TYPES = COLOR_EXTRACT_TYPES_SET;

    const handleRefreshColors = async () => {
        if (!onUpdate) return;
        setIsExtractingColors(true);
        try {
            const colors = await invoke<Array<{ hex: string; percentage: number }>>(
                'get_dominant_colors',
                { path: asset.filePath, numColors: 5 }
            );
            const colorPalette = colors.map(c => ({ hex: c.hex, percentage: Math.round(c.percentage) }));
            onUpdate({ ...asset, colorPalette });
        } catch (err) {
            notifyError(i18n.t('detail.error.colorExtractFailed', { error: err }));
        } finally {
            setIsExtractingColors(false);
        }
    };

    const handleCopyPath = async () => {
        try {
            await navigator.clipboard.writeText(asset.filePath);
            setIsCopying(true);
            setTimeout(() => setIsCopying(false), TIMINGS.COPY_FEEDBACK_MS);
        } catch {
            notifyError(i18n.t('detail.error.copyPathFailed'));
        }
    };

    // MAX sürüm listesi: internal version → year label
    const MAX_VERSIONS = [
        { v: 27, label: '2025 (V27)' }, { v: 26, label: '2024 (V26)' },
        { v: 25, label: '2023 (V25)' }, { v: 24, label: '2022 (V24)' },
        { v: 23, label: '2021 (V23)' }, { v: 22, label: '2020 (V22)' },
        { v: 21, label: '2019 (V21)' }, { v: 20, label: '2018 (V20)' },
        { v: 19, label: '2017 (V19)' }, { v: 18, label: '2016 (V18)' },
        { v: 17, label: '2015 (V17)' }, { v: 16, label: '2014 (V16)' },
        { v: 15, label: '2013 (V15)' }, { v: 14, label: '2012 (V14)' },
    ];

    const handleConvert = async (targetV: number) => {
        setIsConverting(true);
        setShowVersionPicker(false);
        const targetYear = targetV + 1998;
        try {
            if (convertMode === 'real') {
                // Max açık mı kontrol et
                const running = await invoke<boolean>('is_max_running');
                if (running) {
                    notifyError(i18n.t('detail.convert.maxRunning'));
                    setIsConverting(false);
                    return;
                }
                // Gerçek dönüştürme — kurulu Max ile
                const install = maxInstalls?.find(i => i.version >= targetV) || maxInstalls?.[maxInstalls.length - 1];
                if (!install) throw new Error(i18n.t('detail.convert.noInstall'));
                const newPath = await invoke<string>('convert_max_real', {
                    path: asset.filePath,
                    targetVersion: targetV,
                    maxExePath: install.exe_path,
                });
                useStore.getState().addToast(
                    `${i18n.t('detail.convert.successReal', { year: targetYear })}: ${newPath.split(/[/\\]/).pop()}`,
                    'success'
                );
                await addConvertedAsset(newPath, targetV);
            } else {
                // Hızlı dönüştürme — versiyon damgası
                const newPath = await invoke<string>('convert_max_version', {
                    path: asset.filePath,
                    targetVersion: targetV,
                });
                useStore.getState().addToast(
                    `${i18n.t('detail.convert.successQuick', { year: targetYear })}: ${newPath.split(/[/\\]/).pop()}`,
                    'success'
                );
                await addConvertedAsset(newPath, targetV);
            }
        } catch (err) {
            notifyError(i18n.t('detail.convert.error'), mapTauriError(err));
        } finally {
            setIsConverting(false);
        }
    };

    const handleExportMax = async (fmt: 'fbx' | 'obj') => {
        setIsExporting(true);
        try {
            // Max kurulumunu kontrol et
            let installs = maxInstalls;
            if (installs === null) {
                installs = await invoke<Array<{ version: number; year: number; exe_path: string; min_save_version: number }>>('detect_max_installations');
                setMaxInstalls(installs);
            }
            if (!installs || installs.length === 0) {
                notifyError(i18n.t('detail.convert.noInstall'));
                return;
            }
            const running = await invoke<boolean>('is_max_running');
            if (running) {
                notifyError(i18n.t('detail.convert.maxRunning'));
                return;
            }
            const install = installs[0]; // En yüksek sürüm
            const outPath = await invoke<string>('export_max_to_format', {
                path: asset.filePath,
                format: fmt,
                maxExePath: install.exe_path,
            });
            useStore.getState().addToast(
                `${t('detail.export.success', { format: fmt.toUpperCase() })}: ${outPath.split(/[/\\]/).pop()}`,
                'success'
            );
        } catch (err) {
            notifyError(i18n.t('detail.export.error'), mapTauriError(err));
        } finally {
            setIsExporting(false);
        }
    };

    const handleXmpExport = async () => {
        setIsXmpExporting(true);
        try {
            const actualPath = await writeXmpSidecar(asset);
            const expected = asset.filePath + '.xmp';
            const isFallback = actualPath.replace(/\\/g, '/') !== expected.replace(/\\/g, '/');
            let msg = t('xmp.exportSuccess', { file: actualPath.split(/[/\\]/).pop() });
            if (isFallback) msg += ' ' + t('xmp.fallbackSingle');
            useStore.getState().addToast(msg, isFallback ? 'warning' : 'success');
        } catch (err) {
            notifyError(i18n.t('xmp.exportError'), mapTauriError(err));
        } finally {
            setIsXmpExporting(false);
        }
    };

    return (
        <ModalErrorBoundary onClose={onClose}>
        <div className="detail-panel animate-slide-in-right">
            {/* Header */}
            <div className="detail-header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-primary)', wordBreak: 'break-all' }}>
                            {asset.fileName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: 4 }}>
                            {asset.projectName} · {asset.projectPhase}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label={t('common.aria.close')}
                        style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-muted)', padding: 4, borderRadius: 4,
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>
                {/* Etiketler & Favoriler */}
                <AssetTagsPanel assetId={asset.id} />

                {/* Quick Actions */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
                    <button
                        className="btn btn-primary"
                        style={{ fontSize: '0.75rem', padding: '6px 12px', flex: '1 0 auto' }}
                        onClick={handleOpen}
                    >
                        <ExternalLink size={13} /> {t('detail.button.openFile')}
                    </button>
                    {asset.fileType === 'MAX' && hasAdminFeatures() && (
                        <div style={{ position: 'relative', flex: '1 0 auto' }}>
                            <button
                                className="btn btn-ghost"
                                style={{ fontSize: '0.75rem', padding: '6px 12px', color: 'var(--color-warning)', width: '100%' }}
                                onClick={() => { setShowVersionPicker(v => !v); detectMaxInstalls(); }}
                                disabled={isConverting}
                            >
                                {isConverting ? <RefreshCw size={13} className="animate-spin" /> : <FileDown size={13} />}
                                {isConverting ? t('detail.button.converting') : t('detail.button.downgrade')}
                                {!isConverting && <ChevronDown size={12} />}
                            </button>
                            {showVersionPicker && (
                                <div style={{
                                    position: 'absolute', top: '100%', right: 0, zIndex: 50,
                                    width: 'min(260px, calc(100vw - 40px))', minWidth: 200,
                                    background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
                                    borderRadius: 8, marginTop: 4, padding: 0, maxHeight: 320, overflowY: 'auto',
                                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                                }}>
                                    {/* Mod seçici */}
                                    <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--color-border)' }}>
                                        {([
                                            { key: 'quick' as ConvertMode, label: t('detail.convertMode.quick'), desc: t('detail.convertMode.quickDesc') },
                                            { key: 'real' as ConvertMode, label: t('detail.convertMode.real'), desc: t('detail.convertMode.realDesc') },
                                        ]).map(m => {
                                            const isActive = convertMode === m.key;
                                            const isDisabled = m.key === 'real' && maxInstalls !== null && maxInstalls.length === 0;
                                            return (
                                                <button
                                                    key={m.key}
                                                    onClick={() => !isDisabled && setConvertMode(m.key)}
                                                    disabled={isDisabled}
                                                    style={{
                                                        flex: 1, padding: '8px 6px', border: 'none', cursor: isDisabled ? 'default' : 'pointer',
                                                        background: isActive ? 'rgba(249,200,70,0.1)' : 'transparent',
                                                        borderBottom: isActive ? '2px solid var(--color-warning)' : '2px solid transparent',
                                                        opacity: isDisabled ? 0.4 : 1,
                                                    }}
                                                >
                                                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: isActive ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>
                                                        {m.label}
                                                    </div>
                                                    <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>
                                                        {isDisabled ? t('detail.convertMode.notFound') : m.desc}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {/* Uyarı */}
                                    <div style={{
                                        fontSize: '0.62rem', color: 'var(--color-text-muted)', padding: '6px 10px',
                                        background: convertMode === 'quick' ? 'rgba(249,200,70,0.05)' : 'rgba(166,227,161,0.05)',
                                        borderBottom: '1px solid var(--color-border)',
                                        lineHeight: 1.4,
                                    }}>
                                        {convertMode === 'quick'
                                            ? t('detail.convertMode.quickWarning')
                                            : `${t('detail.convertMode.realWarning')}${
                                                maxInstalls && maxInstalls.length > 0
                                                    ? ` (${t('detail.convertMode.detected', { versions: maxInstalls.map(i => i.year).join(', ') })})`
                                                    : ''
                                            }`
                                        }
                                    </div>
                                    {/* Sürüm listesi — moda göre filtrelenir */}
                                    <div style={{ padding: 4 }}>
                                        {MAX_VERSIONS
                                            .filter(({ v }) => {
                                                if (convertMode === 'quick') return true; // Hızlı mod: tüm sürümler
                                                // Gerçek mod: kurulu Max'ın desteklediği aralık
                                                const best = maxInstalls?.[0]; // En yüksek sürüm
                                                if (!best) return false;
                                                return v >= best.min_save_version && v <= best.version;
                                            })
                                            .map(({ v, label }) => {
                                            const currentV = asset.metadata.maxVersion;
                                            const isCurrent = currentV?.includes(`V${v}`);
                                            return (
                                                <button
                                                    key={v}
                                                    disabled={isCurrent}
                                                    onClick={() => handleConvert(v)}
                                                    style={{
                                                        display: 'block', width: '100%', textAlign: 'left',
                                                        padding: '5px 8px', border: 'none', borderRadius: 4,
                                                        background: isCurrent ? 'rgba(249,200,70,0.1)' : 'transparent',
                                                        color: isCurrent ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                                                        fontSize: '0.74rem', cursor: isCurrent ? 'default' : 'pointer',
                                                        opacity: isCurrent ? 0.6 : 1,
                                                    }}
                                                    onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                                                    onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.background = 'transparent'; }}
                                                >
                                                    {label} {isCurrent && t('detail.version.current')}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    {asset.fileType === 'MAX' && hasAdminFeatures() && (
                        <>
                            <button
                                className="btn btn-ghost"
                                style={{ fontSize: '0.75rem', padding: '6px 12px', flex: '1 0 auto', color: 'var(--color-accent)' }}
                                onClick={() => handleExportMax('fbx')}
                                disabled={isExporting}
                                title={t('detail.export.fbxTitle')}
                            >
                                {isExporting ? <RefreshCw size={13} className="animate-spin" /> : <FileDown size={13} />}
                                {isExporting ? t('detail.export.exporting') : 'FBX'}
                            </button>
                            <button
                                className="btn btn-ghost"
                                style={{ fontSize: '0.75rem', padding: '6px 12px', flex: '1 0 auto', color: 'var(--color-accent)' }}
                                onClick={() => handleExportMax('obj')}
                                disabled={isExporting}
                                title={t('detail.export.objTitle')}
                            >
                                {isExporting ? <RefreshCw size={13} className="animate-spin" /> : <FileDown size={13} />}
                                {isExporting ? t('detail.export.exporting') : 'OBJ'}
                            </button>
                        </>
                    )}
                    {hasAdminFeatures() && (
                        <button
                            className="btn btn-ghost"
                            style={{ fontSize: '0.75rem', padding: '6px 12px', flex: '1 0 auto', color: 'var(--color-accent)' }}
                            onClick={handleXmpExport}
                            disabled={isXmpExporting}
                            title={t('xmp.exportTitle')}
                        >
                            {isXmpExporting ? <RefreshCw size={13} className="animate-spin" /> : <FileOutput size={13} />}
                            {isXmpExporting ? t('xmp.exporting') : 'XMP'}
                        </button>
                    )}
                    <button
                        className="btn btn-ghost"
                        style={{ fontSize: '0.75rem', padding: '6px 12px', flex: '1 0 auto' }}
                        onClick={handleShowInFolder}
                    >
                        <FolderOpen size={13} /> {t('detail.button.showInFolder')}
                    </button>
                    <button
                        className="btn btn-ghost"
                        style={{ fontSize: '0.75rem', padding: '6px 12px', flex: '1 0 auto' }}
                        onClick={handleCopyPath}
                    >
                        <Copy size={13} /> {isCopying ? t('detail.button.copied') : t('detail.button.copyPath')}
                    </button>
                </div>
            </div>

            {/* Preview */}
            <AssetPreview asset={asset} />

            {/* File Info — her formatta her zaman aynı 6 satır */}
            <div className="detail-section">
                <div className="detail-section-title">{t('detail.section.fileInfo')}</div>
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.size')}</span><span className="detail-row-value">{formatFileSize(asset.fileSize)}</span></div>
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.type')}</span><span className="detail-row-value">{asset.fileType}</span></div>
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.category')}</span><span className="detail-row-value">{asset.category}</span></div>
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.created')}</span><span className="detail-row-value">{formatDate(asset.createdAt)}</span></div>
                <div className="detail-row"><span className="detail-row-label">{t('detail.label.updated')}</span><span className="detail-row-value">{formatDate(asset.modifiedAt)}</span></div>
                <div className="detail-row">
                    <span className="detail-row-label">{t('detail.label.path')}</span>
                    <span className="detail-row-value" style={{ fontSize: '0.72rem' }}>{asset.filePath}</span>
                </div>
            </div>

            {/* Proje Durumu — kullanıcı tanımlı alanlar (key: asset değişince inputlar sıfırlanır) */}
            <div className="detail-section" key={`status-${asset.id}`}>
                <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Briefcase size={12} /> {t('assetStatus.section')}
                </div>

                {/* Müşteri */}
                <div className="detail-row" style={{ alignItems: 'center' }}>
                    <span className="detail-row-label">{t('assetStatus.clientName')}</span>
                    {editingClientName ? (
                        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                                autoFocus
                                maxLength={150}
                                defaultValue={asset.clientName ?? ''}
                                onChange={e => setClientNameLen(e.target.value.length)}
                                onBlur={e => {
                                    const v = e.target.value.trim() || null;
                                    saveField({ clientName: v });
                                    setEditingClientName(false);
                                }}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                        const v = (e.target as HTMLInputElement).value.trim() || null;
                                        saveField({ clientName: v });
                                        setEditingClientName(false);
                                    }
                                    if (e.key === 'Escape') setEditingClientName(false);
                                }}
                                style={{
                                    flex: 1, padding: '2px 6px', fontSize: '0.74rem',
                                    background: 'rgba(255,255,255,0.06)', border: '1px solid var(--color-accent)',
                                    borderRadius: 4, color: 'var(--color-text-primary)', outline: 'none',
                                }}
                            />
                            <span style={{ fontSize: '0.6rem', flexShrink: 0, color: clientNameLen >= 140 ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
                                {clientNameLen}/150
                            </span>
                        </div>
                    ) : (
                        <span
                            className="detail-row-value"
                            onClick={() => { setClientNameLen(asset.clientName?.length ?? 0); setEditingClientName(true); }}
                            style={{ cursor: 'pointer', minWidth: 60, color: asset.clientName ? 'var(--color-text-primary)' : 'var(--color-text-muted)', fontStyle: asset.clientName ? 'normal' : 'italic' }}
                        >
                            {asset.clientName || t('assetStatus.clickToEdit')}
                        </span>
                    )}
                </div>

                {/* Onay Durumu */}
                <div className="detail-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                    <span className="detail-row-label" style={{ marginRight: 4 }}>{t('assetStatus.approvalStatus')}</span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {(['draft', 'review', 'approved', 'rejected'] as ApprovalStatus[]).map(s => {
                            const isActive = (asset.approvalStatus ?? 'draft') === s;
                            const colors: Record<ApprovalStatus, string> = {
                                draft: '#94a3b8', review: '#f9c846', approved: '#a6e3a1', rejected: '#f38ba8',
                            };
                            return (
                                <button
                                    key={s}
                                    onClick={() => {
                                        const updates: Parameters<typeof saveField>[0] = { approvalStatus: s };
                                        // Onay verildiğinde eski red sebebini temizle
                                        if (s !== 'rejected') updates.rejectionReason = null;
                                        saveField(updates);
                                    }}
                                    style={{
                                        padding: '2px 8px', borderRadius: 4, fontSize: '0.65rem', cursor: 'pointer',
                                        border: `1px solid ${isActive ? colors[s] : 'var(--color-border)'}`,
                                        background: isActive ? `${colors[s]}22` : 'transparent',
                                        color: isActive ? colors[s] : 'var(--color-text-muted)',
                                        fontWeight: isActive ? 600 : 400,
                                    }}
                                >
                                    {t(`assetStatus.status.${s}`)}
                                </button>
                            );
                        })}
                    </div>
                </div>
                {/* Red Sebebi — sadece rejected durumunda göster */}
                {(asset.approvalStatus === 'rejected') && (
                    <div className="detail-row" style={{ flexDirection: 'column', gap: 4 }}>
                        <span className="detail-row-label">{t('approval.rejectionReason')}</span>
                        <textarea
                            defaultValue={asset.rejectionReason || ''}
                            placeholder={t('approval.rejectionReasonPlaceholder')}
                            onBlur={(e) => {
                                const val = e.target.value.trim();
                                if (val !== (asset.rejectionReason || '')) {
                                    saveField({ rejectionReason: val || null });
                                }
                            }}
                            style={{
                                width: '100%', minHeight: 48, maxHeight: 100, resize: 'vertical',
                                fontSize: '0.7rem', padding: '6px 8px', borderRadius: 4,
                                border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)',
                                color: 'var(--color-text-primary)', lineHeight: 1.4,
                            }}
                        />
                    </div>
                )}

                {/* Versiyon */}
                <div className="detail-row">
                    <span className="detail-row-label">{t('assetStatus.versionLabel')}</span>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input
                            maxLength={20}
                            defaultValue={asset.versionLabel ?? ''}
                            onChange={e => setVersionLabelLen(e.target.value.length)}
                            onBlur={e => saveField({ versionLabel: e.target.value.trim() || null })}
                            onKeyDown={e => {
                                if (e.key === 'Enter') saveField({ versionLabel: (e.target as HTMLInputElement).value.trim() || null });
                            }}
                            placeholder="v1.0, Rev-A..."
                            style={{
                                flex: 1, padding: '2px 6px', fontSize: '0.74rem',
                                background: 'rgba(255,255,255,0.04)', border: '1px solid transparent',
                                borderRadius: 4, color: 'var(--color-text-primary)', outline: 'none',
                                cursor: 'text',
                            }}
                            onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                            onBlurCapture={e => e.target.style.borderColor = 'transparent'}
                        />
                        <span style={{ fontSize: '0.6rem', flexShrink: 0, color: versionLabelLen >= 18 ? 'var(--color-warning)' : 'var(--color-text-muted)' }}>
                            {versionLabelLen}/20
                        </span>
                    </div>
                </div>

                {/* Teslim Tarihi */}
                <div className="detail-row">
                    <span className="detail-row-label">{t('assetStatus.deadline')}</span>
                    <input
                        type="date"
                        value={asset.deadline ?? ''}
                        onChange={e => saveField({ deadline: e.target.value || null })}
                        style={{
                            flex: 1, padding: '2px 6px', fontSize: '0.74rem',
                            background: 'rgba(255,255,255,0.04)', border: '1px solid transparent',
                            borderRadius: 4, color: 'var(--color-text-primary)', outline: 'none',
                            colorScheme: 'dark',
                        }}
                        onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                        onBlurCapture={e => e.target.style.borderColor = 'transparent'}
                    />
                </div>
            </div>

            {/* Bağlantılı Dosyalar */}
            <div className="detail-section">
                <AssetRelationsPanel
                    asset={asset}
                    onLinkClick={id => {
                        onSelectAsset?.(id);
                    }}
                />
            </div>

            {/* Format Özellikleri — yalnızca format'a özgü veri varsa görünür */}
            {hasFormatProps && <DetailFormatProps asset={asset} />}

            {/* Yedek Dosyalar */}
            {backupInfo && (
                <div className="detail-section" style={{
                    borderLeft: '3px solid #f9c846',
                    paddingLeft: 12,
                    background: 'rgba(249,200,70,0.06)',
                    borderRadius: '0 8px 8px 0',
                    padding: '12px 12px 12px 14px',
                    marginTop: 2,
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                    }}>
                        <div style={{
                            background: '#f9c846', borderRadius: 6, padding: '4px 6px',
                            display: 'flex', alignItems: 'center',
                        }}>
                            <Archive size={14} style={{ color: '#1a1a1a' }} />
                        </div>
                        <div>
                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f9c846' }}>
                                {t('detail.backup.title', { count: backupInfo.backups.length })}
                            </div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                                {t('detail.backup.totalSize', { size: formatFileSize(backupInfo.totalSize) })}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {backupInfo.backups.map((bak, i) => (
                            <div key={i} style={{
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                fontSize: '0.72rem', padding: '6px 10px',
                                background: 'rgba(249,200,70,0.08)',
                                border: '1px solid rgba(249,200,70,0.22)',
                                borderRadius: 6,
                            }}>
                                <span style={{
                                    color: '#f9c846', fontWeight: 600,
                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap', flex: 1, minWidth: 0,
                                }}>
                                    {bak.fileName}
                                </span>
                                <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, marginLeft: 8, fontSize: '0.68rem' }}>
                                    {formatFileSize(bak.fileSize)} · {formatDate(bak.modifiedAt)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Doküman içerik eşleşmesi (chunk alıntısı) */}
            {matchedChunk && (
                <div className="detail-section" style={{ borderLeft: '2px solid var(--color-success)', paddingLeft: 10 }}>
                    <div className="detail-section-title" style={{ color: 'var(--color-success)' }}>
                        {t('detail.section.docExcerpt')}
                    </div>
                    <div style={{
                        fontSize: '0.74rem',
                        color: 'var(--color-text-secondary)',
                        background: 'rgba(166,227,161,0.08)',
                        border: '1px solid rgba(166,227,161,0.22)',
                        borderRadius: 8,
                        padding: 10,
                        whiteSpace: 'pre-wrap',
                        maxHeight: 160,
                        overflow: 'auto',
                    }}>
                        {matchedChunk.text.slice(0, 1200)}
                        {matchedChunk.text.length > 1200 ? '…' : ''}
                    </div>
                    <div style={{ marginTop: 6, fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                        {matchedChunk.page != null
                            ? t('detail.chunk.info', { index: matchedChunk.chunkIndex + 1, page: matchedChunk.page })
                            : `Chunk: ${matchedChunk.chunkIndex + 1}`}
                    </div>
                </div>
            )}

            {/* Doküman index durumu (arama olmadan da görünür) */}
            {docIndexInfo && !matchedChunk && (
                <div className="detail-section" style={{ borderLeft: '2px solid var(--color-border)', paddingLeft: 10 }}>
                    <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span>{t('detail.section.docIndex')}</span>
                        <button
                            onClick={handleRagIndex}
                            disabled={ragIndexing}
                            style={{
                                fontSize: '0.68rem',
                                padding: '3px 8px',
                                borderRadius: 4,
                                border: '1px solid var(--color-border)',
                                background: 'var(--color-bg-subtle)',
                                color: 'var(--color-text-primary)',
                                cursor: ragIndexing ? 'wait' : 'pointer',
                                opacity: ragIndexing ? 0.6 : 1,
                            }}
                            title="AI Sohbet için bu dosyayı indexle"
                        >
                            {ragIndexing
                                ? 'İndexleniyor…'
                                : docIndexInfo.chunkCount > 0 ? 'Yeniden indexle' : 'AI için indexle'}
                        </button>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--color-text-secondary)', lineHeight: 1.45 }}>
                        {docIndexInfo.chunkCount > 0 ? (
                            <>
                                {t('detail.docIndex.hasChunks', { count: docIndexInfo.chunkCount })}
                                <div style={{ marginTop: 8, fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                                    {t('detail.docIndex.searchHint')}
                                </div>
                            </>
                        ) : (
                            <>
                                {t('detail.docIndex.noChunks')}
                                <div style={{ marginTop: 6, fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                                    {t('detail.docIndex.ocrHint')}
                                </div>
                            </>
                        )}
                    </div>

                    {docIndexInfo.previews.length > 0 && (() => {
                        const cleanedAll = docIndexInfo.previews.map((p) => ({
                            chunk: p,
                            cleaned: cleanTextPreview(p.text),
                        })).filter((c) => c.cleaned.text);
                        if (cleanedAll.length === 0) return null;
                        const allGarbage = cleanedAll.every((c) => c.cleaned.isLikelyGarbage);
                        if (allGarbage && docIndexInfo.chunkCount === 0) {
                            return (
                                <div style={{ marginTop: 10, fontSize: '0.7rem', color: 'var(--color-warning)' }}>
                                    {t('detail.docIndex.garbage')}
                                </div>
                            );
                        }
                        const hasMore = docIndexInfo.chunkCount > 3 && !chunkPreviewExpanded;
                        return (
                            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {cleanedAll.map(({ chunk, cleaned }) => (
                                    <div key={chunk.id} style={{
                                        fontSize: '0.74rem',
                                        color: 'var(--color-text-secondary)',
                                        background: 'rgba(148,163,184,0.06)',
                                        border: '1px solid rgba(148,163,184,0.18)',
                                        borderRadius: 8,
                                        padding: 10,
                                        whiteSpace: 'pre-wrap',
                                        maxHeight: 120,
                                        overflow: 'auto',
                                    }}>
                                        <div style={{
                                            fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em',
                                            textTransform: 'uppercase', color: 'var(--color-text-muted)',
                                            marginBottom: 4,
                                        }}>
                                            Chunk #{chunk.chunkIndex + 1}{chunk.page != null ? ` · s.${chunk.page}` : ''}
                                        </div>
                                        {cleaned.text.slice(0, 600)}
                                        {cleaned.text.length > 600 ? '…' : ''}
                                    </div>
                                ))}
                                {hasMore && (
                                    <button
                                        onClick={() => setChunkPreviewExpanded(true)}
                                        style={{
                                            alignSelf: 'flex-start', fontSize: '0.7rem',
                                            background: 'transparent', border: '1px solid rgba(148,163,184,0.28)',
                                            color: 'var(--color-text-secondary)',
                                            padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
                                        }}
                                    >
                                        Kalan {docIndexInfo.chunkCount - cleanedAll.length} chunk'ı göster
                                    </button>
                                )}
                                {chunkPreviewExpanded && docIndexInfo.chunkCount > 20 && (
                                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                        İlk 20 chunk gösteriliyor (toplam {docIndexInfo.chunkCount}).
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </div>
            )}

            {/* Eşleşme Kaynağı — sadece aktif arama varsa göster */}
            {matchSources && matchSources.length > 0 && (() => {
                const fileSources = matchSources.filter(s => s.group === 'file');
                const aiSources   = matchSources.filter(s => s.group === 'ai');
                const metaSources = matchSources.filter(s => s.group === 'meta');

                const renderGroup = (
                    sources: typeof matchSources,
                    title: string,
                    color: string,
                ) => sources.length === 0 ? null : (
                    <div style={{ marginBottom: 8 }}>
                        <div style={{
                            fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.05em',
                            textTransform: 'uppercase', color, marginBottom: 5
                        }}>{title}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {sources.map((src, i) => (
                                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                                        {src.label}:
                                    </span>
                                    {src.values.map((v, j) => (
                                        <span key={j} style={{
                                            fontSize: '0.72rem', fontWeight: 500,
                                            color: 'var(--color-text-secondary)',
                                            background: `${color}14`,
                                            border: `1px solid ${color}33`,
                                            borderRadius: 4, padding: '1px 6px'
                                        }}>
                                            {v}
                                        </span>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                );

                return (
                    <div className="detail-section" style={{ borderLeft: '2px solid var(--color-accent)', paddingLeft: 10 }}>
                        <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-accent)', marginBottom: 8 }}>
                            <SearchCheck size={12} /> {t('detail.section.match')}
                        </div>
                        {renderGroup(fileSources, t('detail.match.file'), '#89b4fa')}
                        {renderGroup(aiSources,   t('detail.match.ai'),   '#a6e3a1')}
                        {renderGroup(metaSources, t('detail.match.meta'), '#f9e2af')}
                    </div>
                );
            })()}

            {/* AI Tags */}
            <div className="detail-section">
                <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag size={12} /> {t('detail.section.aiTags')}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {asset.aiTags.map((tag, i) => (
                        <span
                            key={i}
                            className={`tag ${tag.source === 'clip' ? 'tag-accent' : tag.source === 'nlp' ? 'tag-success' : 'tag-warning'}`}
                        >
                            {tag.label}
                            <span style={{ opacity: 0.6, fontSize: '0.6rem' }}>{Math.round(tag.confidence * 100)}%</span>
                        </span>
                    ))}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 10, fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--color-accent)' }} /> CLIP
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--color-success)' }} /> NLP
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <span style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--color-warning)' }} /> Metadata
                    </span>
                </div>
            </div>

            {/* Color Palette */}
            {(asset.colorPalette.length > 0 || (onUpdate && COLOR_EXTRACT_TYPES.has(asset.fileType))) && (
                <ColorPaletteSection
                    asset={asset}
                    onUpdate={onUpdate}
                    onRefreshColors={handleRefreshColors}
                    isExtractingColors={isExtractingColors}
                />
            )}

            {/* Technical Metadata + Architectural Style — DetailTechMeta */}
            <DetailTechMeta asset={asset} />

        </div>
        </ModalErrorBoundary>
    );
}
