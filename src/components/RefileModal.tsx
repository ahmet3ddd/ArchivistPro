import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { FolderOutput, X, Copy, Move, CheckCircle2, Loader2, AlertCircle, FolderTree } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Asset, CategoryType } from '../types';
import { isTauri } from '../services/tauriMock';
import { hasAdminFeatures } from '../services/buildFeatures';
import { getBackupsForAsset } from '../services/database';
import ModalErrorBoundary from './ModalErrorBoundary';

interface RefileModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedAssets: Asset[];
}

type RefileStructure = 'byProject' | 'byCategory' | 'byPhase' | 'byMaterial' | 'custom';


const CATEGORY_FOLDER_MAP: Record<CategoryType, string> = {
    '2D Çizim': '01-Cizimler',
    '3D Model': '02-Modeller',
    'Döküman': '03-Dokumanlar',
    'Render': '04-Renderlar',
    'Fotoğraf': '05-Fotograflar',
    'Doku': '06-Dokular',
    'Video': '07-Videolar',
};

// Maps original extension (before .bak) to the category folder it belongs to
const BAK_SOURCE_CATEGORY_FOLDER: Record<string, string> = {
    dwg: '01-Cizimler', dxf: '01-Cizimler', dwf: '01-Cizimler',
    rvt: '02-Modeller', rfa: '02-Modeller', ifc: '02-Modeller',
    max: '02-Modeller', skp: '02-Modeller', '3dm': '02-Modeller',
    blend: '02-Modeller', c4d: '02-Modeller', obj: '02-Modeller', fbx: '02-Modeller',
    psd: '04-Renderlar',
    jpg: '05-Fotograflar', jpeg: '05-Fotograflar', png: '05-Fotograflar',
    pdf: '03-Dokumanlar', doc: '03-Dokumanlar', docx: '03-Dokumanlar',
    xls: '03-Dokumanlar', xlsx: '03-Dokumanlar', ppt: '03-Dokumanlar', pptx: '03-Dokumanlar',
};

/** Returns the backing category folder for a BAK file.
 *  1. Uses bakSourceType from metadata (magic-byte based detection).
 *  2. Falls back to double-extension inspection (e.g. "file.dwg.bak").
 */
function getBakCategoryFolder(asset: Asset): string {
    // Priority 1: magic-byte detection stored by scanner (now more specific)
    const src = asset.metadata?.bakSourceType;
    if (src) {
        const magicMap: Record<string, string> = {
            dwg: '01-Cizimler',
            max: '02-Modeller', rvt: '02-Modeller', skp: '02-Modeller',
            blend: '02-Modeller', ifc: '02-Modeller', pln: '02-Modeller', glb: '02-Modeller',
            psd: '04-Renderlar',
            doc: '03-Dokumanlar', docx: '03-Dokumanlar',
            xls: '03-Dokumanlar', xlsx: '03-Dokumanlar',
            ppt: '03-Dokumanlar', pptx: '03-Dokumanlar',
            pdf: '03-Dokumanlar', txt: '03-Dokumanlar',
            ole: '02-Modeller', // Tanımlanamayan OLE → MAX olma olasılığı yüksek (mimari arşivde)
            zip: '03-Dokumanlar',
        };
        if (magicMap[src]) return magicMap[src];
    }

    // Priority 2: double extension "file.dwg.bak" → "dwg"
    const parts = asset.fileName.toLowerCase().split('.');
    const bakSuffixes = new Set(['bak', '~bak', 'dwl', 'dwl2', 'sv$', 'asv']);
    while (parts.length > 1 && bakSuffixes.has(parts[parts.length - 1])) {
        parts.pop();
    }
    const ext = parts.length > 1 ? parts[parts.length - 1] : '';
    return BAK_SOURCE_CATEGORY_FOLDER[ext] ?? '03-Dokumanlar';
}

// Document type → subfolder name under 03-Dokumanlar
const DOC_TYPE_SUBFOLDER: Partial<Record<string, string>> = {
    DOC:   'Raporlar_Belgeler',
    XLS:   'Tablolar_Hesaplamalar',
    PPT:   'Sunumlar',
    PDF:   'PDF_Belgeler',
    TXT:   'Metin_Dosyalari',
    CSV:   'Veri_Dosyalari',
    RTF:   'Belgeler',
    SAP2K: 'Analiz_Raporlari',
};

const PHASE_FOLDER_MAP: Record<string, string> = {
    'Konsept': '01-Konsept',
    'Avan': '02-Avan',
    'Ruhsat': '03-Ruhsat',
    'Uygulama': '04-Uygulama',
};

function docSubfolder(asset: Asset): string {
    return DOC_TYPE_SUBFOLDER[asset.fileType] || 'Diger_Belgeler';
}

function generateFolderPath(asset: Asset, structure: RefileStructure): string {
    const proj = asset.projectName.replace(/\s+/g, '_') || 'Bilinmiyor';
    const catFolder = CATEGORY_FOLDER_MAP[asset.category] || 'Diger';
    const isDoc = asset.category === 'Döküman';
    const isBak = asset.fileType === 'BAK';

    // BAK dosyaları: orijinal kaynak tipine göre ilgili klasörün Yedekler alt klasörüne
    if (isBak) {
        const bakTargetFolder = getBakCategoryFolder(asset);
        switch (structure) {
            case 'byProject':
                return `${proj}/${bakTargetFolder}/Yedekler`;
            case 'byCategory':
                return `${bakTargetFolder}/Yedekler/${proj}`;
            case 'byPhase':
                return `${PHASE_FOLDER_MAP[asset.projectPhase] || '00-Diger'}/${proj}/Yedekler`;
            default:
                return `${proj}/${bakTargetFolder}/Yedekler`;
        }
    }

    switch (structure) {
        case 'byProject':
            return isDoc
                ? `${proj}/${catFolder}/${docSubfolder(asset)}`
                : `${proj}/${catFolder}`;
        case 'byCategory':
            return isDoc
                ? `${catFolder}/${docSubfolder(asset)}/${proj}`
                : `${catFolder}/${proj}`;
        case 'byPhase':
            return `${PHASE_FOLDER_MAP[asset.projectPhase] || '00-Diger'}/${proj}`;
        case 'byMaterial':
            return `${asset.materialGroup || 'Genel'}/${proj}`;
        default:
            return proj;
    }
}

const REFILE_BATCH_SIZE = 20;

export default function RefileModal({ isOpen, onClose, selectedAssets }: RefileModalProps) {
    const { t } = useTranslation();

    const REFILE_STRUCTURES: { key: RefileStructure; label: string; description: string; example: string }[] = [
        {
            key: 'byProject',
            label: t('refile.structure.byProject'),
            description: t('refile.structure.byProjectDesc'),
            example: '📁 Proje_Adi / 📁 Cizimler / dosya.dwg',
        },
        {
            key: 'byCategory',
            label: t('refile.structure.byCategory'),
            description: t('refile.structure.byCategoryDesc'),
            example: '📁 03-Dokumanlar / 📁 Tablolar / proje',
        },
        {
            key: 'byPhase',
            label: t('refile.structure.byType'),
            description: t('refile.structure.byTypeDesc'),
            example: '📁 01_Konsept / 📁 02_Avan / 📁 03_Uygulama',
        },
        {
            key: 'byMaterial',
            label: t('refile.structure.byDate'),
            description: t('refile.structure.byDateDesc'),
            example: '📁 Beton / 📁 Cam / 📁 Ahsap',
        },
    ];

    const focusTrapRef = useFocusTrap(isOpen, onClose);
    const [structure, setStructure] = useState<RefileStructure>('byProject');
    const [isProcessing, setIsProcessing] = useState(false);
    const [isDone, setIsDone] = useState(false);
    const [resultMessage, setResultMessage] = useState('');
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
    const [pendingConfirm, setPendingConfirm] = useState<{ mode: 'copy' | 'move'; dest: string } | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setIsDone(false);
            setResultMessage('');
            setProgress(null);
            setPendingConfirm(null);
            setIsProcessing(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    // Gather backup files for all selected assets
    const backupAssets: Asset[] = [];
    const seenBackupIds = new Set<string>();
    for (const asset of selectedAssets) {
        if (asset.fileType === 'BAK') continue; // Already a backup
        const backups = getBackupsForAsset(asset.filePath);
        for (const bak of backups) {
            if (!seenBackupIds.has(bak.id)) {
                seenBackupIds.add(bak.id);
                backupAssets.push(bak);
            }
        }
    }
    const allAssetsWithBackups = [...selectedAssets, ...backupAssets];

    // Preview the folder structure
    const preview = new Map<string, string[]>();
    allAssetsWithBackups.forEach(asset => {
        const folder = generateFolderPath(asset, structure);
        if (!preview.has(folder)) preview.set(folder, []);
        preview.get(folder)!.push(asset.fileName);
    });

    const totalFiles = allAssetsWithBackups.length;

    const handleSelectDest = async (mode: 'copy' | 'move') => {
        if (isTauri() && hasAdminFeatures()) {
            const destRoot = await open({
                title: t('refile.dialog.selectDest'),
                directory: true,
                multiple: false,
            });
            if (!destRoot || typeof destRoot !== 'string') return;
            setPendingConfirm({ mode, dest: destRoot });
        } else {
            handleRefile(mode);
        }
    };

    const handleRefile = async (mode: 'copy' | 'move', destOverride?: string) => {
        setPendingConfirm(null);
        setIsProcessing(true);
        setProgress({ current: 0, total: totalFiles });
        try {
            if (isTauri() && hasAdminFeatures()) {
                const destRoot = destOverride!;
                let processed = 0;
                for (let i = 0; i < allAssetsWithBackups.length; i += REFILE_BATCH_SIZE) {
                    const batch = allAssetsWithBackups.slice(i, i + REFILE_BATCH_SIZE);
                    const operations = batch.map(asset => {
                        const folder = generateFolderPath(asset, structure);
                        const relativeDestPath = `${folder}/${asset.fileName}`.replace(/\/+/g, '/');
                        return { source_path: asset.filePath, relative_dest_path: relativeDestPath };
                    });
                    const count = await invoke<number>('refile_organize', {
                        destRoot,
                        operations,
                        mode,
                    });
                    processed += count;
                    setProgress({ current: processed, total: totalFiles });
                }
                setIsDone(true);
                setResultMessage(
                    t('refile.result.success', {
                        processed,
                        action: mode === 'copy' ? t('refile.action.copied') : t('refile.action.moved'),
                        folders: preview.size,
                    })
                );
            } else {
                const destHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                let processed = 0;
                for (const [folderPath, files] of preview.entries()) {
                    const parts = folderPath.split('/');
                    let currentDir = destHandle;
                    for (const part of parts) {
                        currentDir = await currentDir.getDirectoryHandle(part, { create: true });
                    }
                    for (const fileName of files) {
                        const fileHandle = await currentDir.getFileHandle(fileName + '.ref', { create: true });
                        const writable = await fileHandle.createWritable();
                        const asset = allAssetsWithBackups.find(a => a.fileName === fileName);
                        const refContent = [
                            `[Archivist Pro Reference]`,
                            `Dosya: ${fileName}`,
                            `Orijinal Konum: ${asset?.filePath || 'bilinmiyor'}`,
                            `Proje: ${asset?.projectName || ''}`,
                            `Safha: ${asset?.projectPhase || ''}`,
                            `Kategori: ${asset?.category || ''}`,
                            `Malzeme: ${asset?.materialGroup || ''}`,
                            `İşlem: ${mode === 'copy' ? 'Kopyala' : 'Taşı'}`,
                            `Tarih: ${new Date().toISOString()}`,
                        ].join('\n');
                        await writable.write(refContent);
                        await writable.close();
                        processed++;
                        setProgress({ current: processed, total: totalFiles });
                    }
                }
                setIsDone(true);
                setResultMessage(t('refile.result.browserMode', { count: processed }));
            }
        } catch (err) {
            if ((err as Error).name !== 'AbortError') {
                setResultMessage(t('refile.result.error', { message: (err as Error).message }));
                setIsDone(true);
            }
        } finally {
            setIsProcessing(false);
            setProgress(null);
        }
    };

    const handleClose = () => {
        setIsDone(false);
        setResultMessage('');
        setProgress(null);
        setPendingConfirm(null);
        onClose();
    };

    return (
        <ModalErrorBoundary onClose={onClose}>
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }}>
            <div ref={focusTrapRef} className="glass-card animate-fade-in" role="dialog" aria-modal="true" style={{
                width: 'min(90vw, 580px)', maxHeight: '85vh', overflow: 'auto', padding: 0,
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '20px 24px', borderBottom: '1px solid var(--color-border)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <FolderOutput size={20} style={{ color: 'var(--color-accent-secondary)' }} />
                        <span style={{ fontWeight: 700, fontSize: '1rem' }}>{t('modals.refile')}</span>
                    </div>
                    {!isProcessing && (
                        <button onClick={handleClose} aria-label={t('common.aria.close')} style={{
                            background: 'transparent', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-muted)', padding: 4,
                        }}>
                            <X size={18} />
                        </button>
                    )}
                </div>

                <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {!isDone && !isProcessing && (
                        <>
                            <div style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                                {t('refile.summary', { fileCount: totalFiles })}{backupAssets.length > 0 && (
                                    <span> + <strong style={{ color: 'var(--color-warning)' }}>{backupAssets.length}</strong> {t('refile.backupFiles')}</span>
                                )}
                            </div>

                            {/* Structure selector */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                {REFILE_STRUCTURES.map(s => (
                                    <div
                                        key={s.key}
                                        onClick={() => setStructure(s.key)}
                                        style={{
                                            background: structure === s.key ? 'var(--color-accent-glow)' : 'var(--color-bg-tertiary)',
                                            border: `1px solid ${structure === s.key ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                            borderRadius: 'var(--radius-md)', padding: 12, cursor: 'pointer',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                                            {s.label}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>{s.description}</div>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: 4, fontFamily: 'monospace' }}>
                                            {s.example}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Preview */}
                            <div style={{
                                background: 'var(--color-bg-primary)', borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)', maxHeight: 200, overflowY: 'auto',
                            }}>
                                <div style={{
                                    padding: '8px 12px', fontSize: '0.72rem', fontWeight: 600,
                                    color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}>
                                    <FolderTree size={12} /> {t('refile.preview.title', { count: preview.size })}
                                </div>
                                <div style={{ padding: 8 }}>
                                    {Array.from(preview.entries()).map(([folder, files]) => (
                                        <div key={folder} style={{ marginBottom: 8 }}>
                                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-accent)', marginBottom: 2, fontFamily: 'monospace' }}>
                                                📁 {folder}/
                                            </div>
                                            {files.map((f, i) => (
                                                <div key={i} style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', paddingLeft: 16, fontFamily: 'monospace' }}>
                                                    └ {f}
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button className="btn btn-primary" onClick={() => handleSelectDest('copy')} style={{ flex: 1, justifyContent: 'center', padding: '10px 16px' }}>
                                        <Copy size={15} /> {t('refile.button.copy')}
                                    </button>
                                    <button className="btn btn-ghost" onClick={() => handleSelectDest('move')} style={{ flex: 1, justifyContent: 'center', padding: '10px 16px' }}>
                                        <Move size={15} /> {t('refile.button.move')}
                                    </button>
                                </div>
                                {!isTauri() && (
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                                        {t('refile.browser.note')}
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {isProcessing && (
                        <div style={{ padding: '8px 0' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
                                    {t('refile.processing.title')}
                                </span>
                                {progress && (
                                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-accent)' }}>
                                        {t('refile.processing.progress', { current: progress.current, total: progress.total })}
                                    </span>
                                )}
                            </div>
                            {progress && progress.total > 0 && (
                                <div style={{
                                    height: 8,
                                    borderRadius: 4,
                                    background: 'var(--color-bg-tertiary)',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        height: '100%',
                                        width: `${Math.round((progress.current / progress.total) * 100)}%`,
                                        background: 'var(--color-accent)',
                                        borderRadius: 4,
                                        transition: 'width 0.2s ease',
                                    }} />
                                </div>
                            )}
                            <div style={{ textAlign: 'center', marginTop: 16 }}>
                                <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                            </div>
                        </div>
                    )}

                    {isDone && (
                        <div style={{ textAlign: 'center', padding: 10 }}>
                            {resultMessage.startsWith('Hata') ? (
                                <AlertCircle size={36} style={{ color: 'var(--color-danger)', marginBottom: 8 }} />
                            ) : (
                                <CheckCircle2 size={36} style={{ color: 'var(--color-success)', marginBottom: 8 }} />
                            )}
                            <div style={{ fontSize: '0.9rem', color: 'var(--color-text-primary)', fontWeight: 600, marginBottom: 4 }}>
                                {resultMessage.startsWith('Hata') ? t('refile.done.error') : t('refile.done.success')}
                            </div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>{resultMessage}</div>
                            <button className="btn btn-primary" onClick={handleClose} style={{ marginTop: 16, justifyContent: 'center' }}>
                                {t('common.button.close')}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Onay Dialogu */}
            {pendingConfirm && (
                <div style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
                }}>
                    <div style={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 12, padding: 24, maxWidth: 420, width: '90vw',
                    }}>
                        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--color-text-primary)' }}>
                            {pendingConfirm.mode === 'move' ? t('refile.confirm.moveTitle') : t('refile.confirm.copyTitle')}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                            {t('refile.confirm.body', { count: totalFiles })}
                            <div style={{
                                marginTop: 8, padding: '6px 10px', borderRadius: 6,
                                background: 'var(--color-bg-tertiary)',
                                fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all',
                            }}>
                                {pendingConfirm.dest}
                            </div>
                            {pendingConfirm.mode === 'move' && (
                                <div style={{ color: '#f38ba8', marginTop: 10, fontWeight: 600 }}>
                                    {t('refile.confirm.moveWarning')}
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost" onClick={() => setPendingConfirm(null)}>
                                {t('common.button.cancel')}
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => handleRefile(pendingConfirm.mode, pendingConfirm.dest)}
                            >
                                {pendingConfirm.mode === 'move' ? t('refile.confirm.confirmMove') : t('refile.confirm.confirmCopy')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
        </ModalErrorBoundary>
    );
}
