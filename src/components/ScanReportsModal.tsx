/**
 * Tarama Raporları modalı — APP_DATA/scan-reports altındaki TXT'leri listeler,
 * seçileni parse edip tablo + kategori filtresi ile gösterir. "Editörde aç"
 * sistemin default app'iyle (Notepad) açar; "Farklı kaydet" kullanıcının
 * seçtiği yere kopyalar.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileText, ExternalLink, Save, Filter } from 'lucide-react';
import {
    listScanReports,
    readScanReportFile,
    openScanReportInDefaultApp,
    parseScanReportText,
    type ScanReportFile,
    type ParsedScanReport,
} from '../services/scanReports';

interface Props {
    /** Sadece bu root path için raporları filtreler. Boş/null → tüm raporlar. */
    rootPath?: string | null;
    onClose: () => void;
}

export default function ScanReportsModal({ rootPath, onClose }: Props) {
    const { t } = useTranslation();
    const [files, setFiles] = useState<ScanReportFile[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [parsed, setParsed] = useState<ParsedScanReport | null>(null);
    const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
    const [contentLoading, setContentLoading] = useState(false);

    // İlk yükleme: tüm rapor dosyalarını listele
    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            const all = await listScanReports();
            if (cancelled) return;
            setFiles(all);
            // Bu root için filtre — root_label dosya adı içinde geçer
            // Sanitize sırasında özel karakterler '_'ye dönüşmüş olabilir; kaba match yeter.
            const sep = rootPath?.includes('\\') ? '\\' : '/';
            const label = rootPath ? (rootPath.split(sep).filter(Boolean).pop() || '') : '';
            const safeLabel: string = label
                .split('')
                .map(c => /[A-Za-z0-9\-_]/.test(c) ? c : '_')
                .join('')
                .slice(0, 80);
            const filtered = (rootPath && safeLabel)
                ? all.filter(f => f.name.startsWith(safeLabel + '-') || f.name.startsWith(safeLabel + '.'))
                : all;
            const list = filtered.length > 0 ? filtered : all;
            setLoading(false);
            if (list.length > 0) setSelectedPath(list[0].path);
        })();
        return () => { cancelled = true; };
    }, [rootPath]);

    // Seçili rapor değiştiğinde içeriği oku + parse et
    useEffect(() => {
        if (!selectedPath) { setParsed(null); return; }
        let cancelled = false;
        (async () => {
            setContentLoading(true);
            const raw = await readScanReportFile(selectedPath);
            if (cancelled) return;
            setContentLoading(false);
            if (raw) {
                const p = parseScanReportText(raw);
                setParsed(p);
                setActiveCategories(new Set(Object.keys(p.summary.byCategory)));
            } else {
                setParsed(null);
            }
        })();
        return () => { cancelled = true; };
    }, [selectedPath]);

    const filteredEntries = useMemo(() => {
        if (!parsed) return [];
        return parsed.entries.filter(e => activeCategories.has(e.category));
    }, [parsed, activeCategories]);

    const filteredFileList = useMemo(() => {
        const sep = rootPath?.includes('\\') ? '\\' : '/';
        const label = rootPath ? (rootPath.split(sep).filter(Boolean).pop() || '') : '';
        const safeLabel: string = label
            .split('')
            .map(c => /[A-Za-z0-9\-_]/.test(c) ? c : '_')
            .join('')
            .slice(0, 80);
        if (rootPath && safeLabel) {
            const matched = files.filter(f => f.name.startsWith(safeLabel + '-') || f.name.startsWith(safeLabel + '.'));
            if (matched.length > 0) return matched;
        }
        return files;
    }, [files, rootPath]);

    const toggleCategory = (cat: string) => {
        setActiveCategories(prev => {
            const next = new Set(prev);
            if (next.has(cat)) next.delete(cat); else next.add(cat);
            return next;
        });
    };

    const handleSaveAs = async () => {
        if (!parsed || !selectedPath) return;
        try {
            const { save } = await import('@tauri-apps/plugin-dialog');
            const dest = await save({
                title: t('scanReports.saveAs', 'Raporu Farklı Kaydet'),
                defaultPath: selectedPath.split(/[\\/]/).pop() || 'scan-report.txt',
                filters: [{ name: 'Text', extensions: ['txt'] }],
            });
            if (!dest) return;
            const { writeTextFile } = await import('@tauri-apps/plugin-fs');
            await writeTextFile(dest, parsed.rawText);
        } catch { /* sessiz */ }
    };

    return (
        <div
            onClick={onClose}
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.78)',
                backdropFilter: 'blur(2px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 9000,
            }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    width: '90vw', maxWidth: 1100, height: '85vh',
                    background: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border)',
                    outline: '1px solid rgba(99,102,241,0.25)',
                    borderRadius: 10,
                    boxShadow: '0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,102,241,0.15)',
                    display: 'flex', flexDirection: 'column',
                    color: 'var(--color-text-primary)',
                }}
            >
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 16px', borderBottom: '1px solid var(--color-border)',
                }}>
                    <FileText size={18} style={{ color: 'var(--color-accent)' }} />
                    <strong style={{ fontSize: '1rem', flex: 1 }}>
                        {t('scanReports.title', 'Tarama Raporları')}
                    </strong>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-muted)', padding: 4,
                            display: 'flex', alignItems: 'center',
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
                    {/* Sol — rapor listesi */}
                    <div style={{
                        width: 280, borderRight: '1px solid var(--color-border)',
                        overflowY: 'auto', padding: '8px 0',
                    }}>
                        {loading && (
                            <div style={{ padding: '20px 16px', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                {t('scanReports.loading', 'Raporlar yükleniyor...')}
                            </div>
                        )}
                        {!loading && filteredFileList.length === 0 && (
                            <div style={{ padding: '20px 16px', fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                                {t('scanReports.empty', 'Henüz rapor yok. Tarama bittikten sonra atlanan/hata veren dosyalar burada listelenir.')}
                            </div>
                        )}
                        {filteredFileList.map(f => {
                            const isActive = f.path === selectedPath;
                            return (
                                <button
                                    key={f.path}
                                    onClick={() => setSelectedPath(f.path)}
                                    style={{
                                        display: 'block', width: '100%',
                                        padding: '8px 14px',
                                        background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
                                        border: 'none',
                                        borderLeft: `3px solid ${isActive ? 'var(--color-accent)' : 'transparent'}`,
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)',
                                    }}
                                >
                                    <div style={{
                                        fontSize: '0.74rem', fontWeight: isActive ? 600 : 400,
                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                    }}>
                                        {f.name}
                                    </div>
                                    <div style={{
                                        fontSize: '0.66rem', color: 'var(--color-text-muted)',
                                        marginTop: 2,
                                    }}>
                                        {(f.size / 1024).toFixed(1)} KB
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Sağ — içerik */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        {!parsed && !contentLoading && (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flex: 1, color: 'var(--color-text-muted)', fontSize: '0.85rem',
                            }}>
                                {t('scanReports.selectReport', 'Soldan bir rapor seçin')}
                            </div>
                        )}
                        {contentLoading && (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flex: 1, color: 'var(--color-text-muted)',
                            }}>
                                {t('scanReports.loadingContent', 'Yükleniyor...')}
                            </div>
                        )}
                        {parsed && (
                            <>
                                {/* Özet + aksiyonlar */}
                                <div style={{
                                    padding: '12px 16px', borderBottom: '1px solid var(--color-border)',
                                    display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center',
                                }}>
                                    <div style={{ flex: 1, minWidth: 200 }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                                            {parsed.summary.rootLabel || t('scanReports.unknownRoot', '(klasör adı bilinmiyor)')}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                                            {parsed.summary.scannedCount} / {parsed.summary.totalFound} • {parsed.summary.entryCount} {t('scanReports.entries', 'kayıt')}
                                            {parsed.summary.finishedAt && ` • ${parsed.summary.finishedAt}`}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => selectedPath && openScanReportInDefaultApp(selectedPath)}
                                        title={t('scanReports.openInEditor', 'Editörde aç')}
                                        style={btnStyle}
                                    >
                                        <ExternalLink size={13} />
                                        <span>{t('scanReports.openInEditor', 'Editörde aç')}</span>
                                    </button>
                                    <button onClick={handleSaveAs} title={t('scanReports.saveAs', 'Farklı kaydet')} style={btnStyle}>
                                        <Save size={13} />
                                        <span>{t('scanReports.saveAs', 'Farklı kaydet')}</span>
                                    </button>
                                </div>

                                {/* Kategori filtresi */}
                                <div style={{
                                    padding: '8px 16px', borderBottom: '1px solid var(--color-border)',
                                    display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
                                }}>
                                    <Filter size={12} style={{ color: 'var(--color-text-muted)' }} />
                                    {Object.entries(parsed.summary.byCategory).map(([cat, count]) => {
                                        const on = activeCategories.has(cat);
                                        return (
                                            <button
                                                key={cat}
                                                onClick={() => toggleCategory(cat)}
                                                style={{
                                                    padding: '3px 9px', borderRadius: 999,
                                                    fontSize: '0.68rem', fontWeight: 600,
                                                    background: on ? 'rgba(99,102,241,0.18)' : 'transparent',
                                                    color: on ? 'var(--color-accent)' : 'var(--color-text-muted)',
                                                    border: `1px solid ${on ? 'var(--color-accent)' : 'var(--color-border)'}`,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {cat} <span style={{ opacity: 0.7 }}>({count})</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* Tablo */}
                                <div style={{ flex: 1, overflow: 'auto', padding: '0 0 8px 0' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                                        <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg-tertiary)', zIndex: 1, borderBottom: '1px solid var(--color-border)' }}>
                                            <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)', fontSize: '0.66rem', textTransform: 'uppercase' }}>
                                                <th style={{ padding: '8px 16px', fontWeight: 600 }}>{t('scanReports.col.path', 'Yol')}</th>
                                                <th style={{ padding: '8px 16px', fontWeight: 600, width: 160 }}>{t('scanReports.col.category', 'Kategori')}</th>
                                                <th style={{ padding: '8px 16px', fontWeight: 600 }}>{t('scanReports.col.reason', 'Sebep')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredEntries.map((e, idx) => (
                                                <tr key={idx} style={{ borderTop: '1px solid var(--color-border)' }}>
                                                    <td style={{ padding: '6px 16px', color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: '0.7rem', wordBreak: 'break-all' }}>
                                                        {e.filePath || '—'}
                                                    </td>
                                                    <td style={{ padding: '6px 16px', whiteSpace: 'nowrap' }}>
                                                        <span style={{
                                                            background: 'rgba(99,102,241,0.12)',
                                                            color: 'var(--color-accent)',
                                                            padding: '2px 8px', borderRadius: 4,
                                                            fontSize: '0.66rem', fontWeight: 600,
                                                        }}>
                                                            {e.category}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '6px 16px', color: 'var(--color-text-secondary)' }}>
                                                        {e.reason}
                                                    </td>
                                                </tr>
                                            ))}
                                            {filteredEntries.length === 0 && (
                                                <tr>
                                                    <td colSpan={3} style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                                        {t('scanReports.noEntriesFiltered', 'Filtre ile eşleşen kayıt yok')}
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '5px 10px', fontSize: '0.72rem', fontWeight: 500,
    background: 'rgba(99,102,241,0.10)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 6, cursor: 'pointer',
    color: 'var(--color-accent)',
};
