/**
 * ArchivistPro — Arşivi Yedekten Geri Yükle Modal
 *
 * .archivistpro dosyasının manifest bilgisini gösterir, kullanıcıya import onayı verir.
 * Opsiyonel "yolları yeniden eşle" toggle ile başka bilgisayardan gelen yedekteki dosya
 * yollarını bu makinedeki yapıyla otomatik replace eder (assets.file_path).
 *
 * Çoklu eşleme: manifest sourceRoots içeriyorsa her kök için ayrı yeni-yol satırı.
 * Tek-eşleme fallback: sadece samplePathPrefix varsa tek-input UI.
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle, FolderOpen, Loader2, FolderTree } from 'lucide-react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import ModalErrorBoundary from './ModalErrorBoundary';

export interface RemapRow {
    oldRoot: string;
    newRoot: string;
    assetCount?: number;
}

export interface ImportRemapOptions {
    enabled: boolean;
    /** Boş newRoot olan satırlar uygulanmayacak. */
    remaps: RemapRow[];
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    /** Onay sonrası çağrılır. remap.enabled=true ise dolu satırlar import sonrası uygulanır. */
    onConfirm: (remap: ImportRemapOptions) => void | Promise<void>;
    /** Manifest'ten gelen ham DB boyutu (sıkıştırma öncesi). 0 ise eski yedek (boyut bilinmiyor). */
    dbSizeBytes: number;
    /** Yedekteki kök klasörler — çoklu eşleme listesi (yeni yedeklerde dolu) */
    sourceRoots?: Array<{ path: string; assetCount: number }>;
    /** Tek-eşleme fallback'i (sourceRoots yoksa ortak prefix varsayılanı) */
    defaultOldRoot?: string;
    /** Import devam ediyor mu (parent yönetir) */
    importing?: boolean;
}

function ArchiveImportModalInner({ isOpen, onClose, onConfirm, dbSizeBytes, sourceRoots, defaultOldRoot, importing }: Props) {
    const { t } = useTranslation();
    const focusTrapRef = useFocusTrap(isOpen, onClose);

    const [remapEnabled, setRemapEnabled] = useState(false);
    const [rows, setRows] = useState<RemapRow[]>([]);

    // Modal her açıldığında satırları initialize et:
    // - sourceRoots varsa: her kök için ayrı satır
    // - yoksa defaultOldRoot fallback: tek satır
    // - hiçbiri yoksa: tek boş satır
    useEffect(() => {
        if (!isOpen) return;
        setRemapEnabled(false);
        if (sourceRoots && sourceRoots.length > 0) {
            setRows(sourceRoots.map(r => ({
                oldRoot: r.path,
                newRoot: '',
                assetCount: r.assetCount,
            })));
        } else if (defaultOldRoot) {
            setRows([{ oldRoot: defaultOldRoot, newRoot: '' }]);
        } else {
            setRows([{ oldRoot: '', newRoot: '' }]);
        }
    }, [isOpen, sourceRoots, defaultOldRoot]);

    if (!isOpen) return null;

    /** Bir path'in son klasör adını döndürür (örn. "D:\\X\\Ofis_A\\" → "Ofis_A") */
    const getBasename = (p: string): string => {
        const cleaned = p.replace(/[\\/]+$/, '');
        const lastSep = Math.max(cleaned.lastIndexOf('\\'), cleaned.lastIndexOf('/'));
        return lastSep >= 0 ? cleaned.slice(lastSep + 1) : cleaned;
    };

    /** Bir parent klasörün altına path'in son segmentini ekler. Separator OS-aware. */
    const joinPath = (parent: string, child: string): string => {
        const sep = parent.includes('\\') ? '\\' : '/';
        const cleanedParent = parent.replace(/[\\/]+$/, '');
        return `${cleanedParent}${sep}${child}${sep}`;
    };

    const handleApplyAllUnderOne = async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const picked = await open({ directory: true, multiple: false });
            if (!picked || typeof picked !== 'string') return;
            // Her satır için: yeniRoot = picked + basename(oldRoot)
            setRows(prev => prev.map(r => {
                if (!r.oldRoot.trim()) return r;
                const base = getBasename(r.oldRoot);
                return { ...r, newRoot: base ? joinPath(picked, base) : picked };
            }));
        } catch { /* sessiz */ }
    };

    const sizeText = dbSizeBytes > 0
        ? t('settings.archiveBackup.import.dbSize', { size: (dbSizeBytes / 1024 / 1024).toFixed(1) })
        : t('settings.archiveBackup.import.unknownSize');

    // En az bir satırın yeniRoot'u doluysa veya remap kapalıysa onay verilebilir
    const filledRows = rows.filter(r => r.oldRoot.trim() && r.newRoot.trim());
    const remapValid = !remapEnabled || filledRows.length > 0;

    const updateRow = (index: number, patch: Partial<RemapRow>) => {
        setRows(prev => prev.map((r, i) => i === index ? { ...r, ...patch } : r));
    };

    const handleBrowseNewRoot = async (index: number) => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const picked = await open({ directory: true, multiple: false });
            if (picked && typeof picked === 'string') updateRow(index, { newRoot: picked });
        } catch { /* sessiz */ }
    };

    const handleConfirm = () => {
        if (!remapValid || importing) return;
        onConfirm({
            enabled: remapEnabled,
            remaps: rows
                .map(r => ({ oldRoot: r.oldRoot.trim(), newRoot: r.newRoot.trim(), assetCount: r.assetCount }))
                .filter(r => r.oldRoot.length > 0),
        });
    };

    const isMulti = sourceRoots && sourceRoots.length > 0;

    return (
        <div
            ref={focusTrapRef as React.RefObject<HTMLDivElement>}
            style={{
                position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9999, padding: 20,
            }}
            onClick={(e) => { if (e.target === e.currentTarget && !importing) onClose(); }}
        >
            <div style={{
                width: '100%', maxWidth: 640,
                maxHeight: '90vh', overflowY: 'auto',
                background: 'var(--color-bg-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 12, padding: 20,
                color: 'var(--color-text-primary)',
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertTriangle size={18} style={{ color: '#f59e0b' }} />
                        <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: 0 }}>
                            {t('settings.archiveBackup.import.title')}
                        </h2>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={importing}
                        style={{
                            background: 'none', border: 'none', cursor: importing ? 'wait' : 'pointer',
                            color: 'var(--color-text-muted)', padding: 4, borderRadius: 4, display: 'flex',
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
                    {sizeText}<br />
                    {t('settings.archiveBackup.import.warning')}
                </div>

                <div style={{
                    border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, marginBottom: 14,
                    background: 'rgba(255,255,255,0.02)',
                }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: importing ? 'wait' : 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={remapEnabled}
                            disabled={importing}
                            onChange={(e) => setRemapEnabled(e.target.checked)}
                            style={{ marginTop: 2 }}
                        />
                        <div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>
                                {t('settings.archiveBackup.import.remapToggle')}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginTop: 2, lineHeight: 1.5 }}>
                                {isMulti
                                    ? t('settings.archiveBackup.import.remapHintMulti', { count: rows.length })
                                    : t('settings.archiveBackup.import.remapHint')}
                            </div>
                        </div>
                    </label>

                    {remapEnabled && (
                        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {isMulti && rows.length > 1 && (
                                <button
                                    type="button"
                                    onClick={handleApplyAllUnderOne}
                                    disabled={importing}
                                    style={{
                                        alignSelf: 'stretch',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        gap: 8,
                                        fontSize: '0.78rem', fontWeight: 500,
                                        padding: '10px 14px',
                                        borderRadius: 6,
                                        border: '1px dashed rgba(99,102,241,0.55)',
                                        background: 'rgba(99,102,241,0.12)',
                                        color: 'var(--color-accent)',
                                        cursor: importing ? 'not-allowed' : 'pointer',
                                        opacity: importing ? 0.5 : 1,
                                        transition: 'background 0.15s, border-color 0.15s',
                                    }}
                                    onMouseEnter={(e) => {
                                        if (importing) return;
                                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.2)';
                                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.8)';
                                    }}
                                    onMouseLeave={(e) => {
                                        (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.12)';
                                        (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(99,102,241,0.55)';
                                    }}
                                >
                                    <FolderTree size={14} />
                                    {t('settings.archiveBackup.import.allUnderOne')}
                                </button>
                            )}
                            {rows.map((row, idx) => (
                                <div
                                    key={idx}
                                    style={{
                                        padding: '10px 12px',
                                        background: 'rgba(255,255,255,0.03)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 6,
                                        display: 'flex', flexDirection: 'column', gap: 8,
                                    }}
                                >
                                    {row.assetCount !== undefined && (
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                                            {t('settings.archiveBackup.import.fileCount', { count: row.assetCount })}
                                        </div>
                                    )}
                                    <div>
                                        <label style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'block', marginBottom: 3 }}>
                                            {t('settings.archiveBackup.import.oldRootLabel')}
                                        </label>
                                        <input
                                            type="text"
                                            value={row.oldRoot}
                                            disabled={importing}
                                            onChange={(e) => updateRow(idx, { oldRoot: e.target.value })}
                                            placeholder={t('settings.archiveBackup.import.oldRootPlaceholder')}
                                            style={{
                                                width: '100%', fontSize: '0.74rem', padding: '6px 10px',
                                                background: 'rgba(255,255,255,0.04)',
                                                border: '1px solid var(--color-border)', borderRadius: 5,
                                                color: 'var(--color-text-primary)',
                                            }}
                                        />
                                    </div>
                                    <div>
                                        <label style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'block', marginBottom: 3 }}>
                                            {t('settings.archiveBackup.import.newRootLabel')}
                                        </label>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <input
                                                type="text"
                                                value={row.newRoot}
                                                disabled={importing}
                                                onChange={(e) => updateRow(idx, { newRoot: e.target.value })}
                                                placeholder={t('settings.archiveBackup.import.newRootPlaceholder')}
                                                style={{
                                                    flex: 1, fontSize: '0.74rem', padding: '6px 10px',
                                                    background: 'rgba(255,255,255,0.04)',
                                                    border: '1px solid var(--color-border)', borderRadius: 5,
                                                    color: 'var(--color-text-primary)',
                                                }}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handleBrowseNewRoot(idx)}
                                                disabled={importing}
                                                className="btn btn-ghost"
                                                style={{ fontSize: '0.72rem', padding: '5px 10px', gap: 5 }}
                                            >
                                                <FolderOpen size={12} />
                                                {t('settings.archiveBackup.import.browse')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {isMulti && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    {t('settings.archiveBackup.import.skipHint')}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={importing}
                        style={{
                            padding: '8px 16px', borderRadius: 8,
                            border: '1px solid var(--color-border)',
                            background: 'transparent', color: 'var(--color-text-primary)',
                            cursor: importing ? 'wait' : 'pointer', fontSize: '0.78rem',
                        }}
                    >
                        {t('settings.archiveBackup.import.cancelButton')}
                    </button>
                    <button
                        type="button"
                        onClick={handleConfirm}
                        disabled={importing || !remapValid}
                        style={{
                            padding: '8px 16px', borderRadius: 8, border: 'none',
                            background: '#ef4444', color: '#fff',
                            cursor: (importing || !remapValid) ? 'not-allowed' : 'pointer',
                            fontSize: '0.78rem', fontWeight: 600,
                            opacity: (importing || !remapValid) ? 0.6 : 1,
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}
                    >
                        {importing && <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />}
                        {t('settings.archiveBackup.import.confirmButton')}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default function ArchiveImportModal(props: Props) {
    return (
        <ModalErrorBoundary onClose={props.onClose}>
            <ArchiveImportModalInner {...props} />
        </ModalErrorBoundary>
    );
}
