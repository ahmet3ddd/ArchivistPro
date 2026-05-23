import { useState, useCallback, useMemo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { useStore } from '../store/useStore';
import { searchImagesByText } from '../services/visualSearch';
import { getAssetById } from '../services/database';
import { getAssetThumbnailSrc } from '../utils/thumbnailSrc';
import type { Asset } from '../types';
import type { AIConfig } from './AISettingsModal';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    aiConfig: AIConfig;
}

type ResultItem = { asset: Asset; score: number };

function formatBytes(n: number): string {
    if (!n || n < 0) return '—';
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function formatDate(iso: string | undefined): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('tr-TR', { year: 'numeric', month: 'short', day: '2-digit' });
}

// CSV alanı: tırnak/virgül/yeni satır içerebilir → her zaman tırnakla, içteki tırnağı ikile.
function csvCell(s: string): string {
    return `"${String(s ?? '').replace(/"/g, '""')}"`;
}

export default function VisualSearchModal({ isOpen, onClose, aiConfig }: Props) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<ResultItem[]>([]);
    const [effectiveQuery, setEffectiveQuery] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [translateOn, setTranslateOn] = useState(true);
    const [selected, setSelected] = useState<ResultItem | null>(null);
    const [exporting, setExporting] = useState(false);
    const setSelectedAssetId = useStore((s) => s.setSelectedAssetId);

    // Faz 4.4 — Yol C uyarısı: teknik çizimde CLIP diskriminasyonu zayıf
    const hasDwgResult = useMemo(() => results.some(r => r.asset.fileType === 'DWG'), [results]);

    // Modal her kapandığında seçimi sıfırla (yeniden açılışta temiz başla).
    useEffect(() => { if (!isOpen) setSelected(null); }, [isOpen]);

    const handleSearch = useCallback(async () => {
        const q = query.trim();
        if (!q || busy) return;
        setBusy(true);
        setError(null);
        setSelected(null);
        try {
            const { hits, effectiveQuery: eq } = await searchImagesByText(q, aiConfig, 30, { translate: translateOn });
            setEffectiveQuery(eq);
            const items: ResultItem[] = [];
            for (const h of hits) {
                const a = getAssetById(h.assetId);
                if (a) items.push({ asset: a, score: h.score });
            }
            setResults(items);
            if (items.length === 0) setError('Eşleşme bulunamadı. CLIP eşiğinin altında veya hiç görsel asset indekslenmemiş olabilir.');
        } catch (err) {
            setError(`Hata: ${String((err as Error).message || err)}`);
        } finally {
            setBusy(false);
        }
    }, [query, busy, aiConfig, translateOn]);

    // Eski davranış korunur: "Uygulamada Aç" → ana DetailPanel'de göster + modal kapan.
    const openInApp = useCallback((a: Asset) => {
        setSelectedAssetId(a.id);
        onClose();
    }, [onClose, setSelectedAssetId]);

    const openFile = useCallback(async (a: Asset) => {
        try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('open_file_native', { path: a.filePath });
        } catch (err) {
            setError(`Dosya açılamadı: ${String((err as Error).message || err)}`);
        }
    }, []);

    const copyPath = useCallback(async (a: Asset) => {
        try {
            await navigator.clipboard.writeText(a.filePath);
        } catch {
            setError('Yol kopyalanamadı.');
        }
    }, []);

    const handleExport = useCallback(async () => {
        if (results.length === 0 || exporting) return;
        setExporting(true);
        setError(null);
        try {
            const header = ['Dosya Adı', 'Yol', 'Tür', 'Kategori', 'Skor'];
            const rows = results.map(({ asset, score }) => [
                asset.fileName, asset.filePath, asset.fileType, asset.category, score.toFixed(4),
            ].map(csvCell).join(','));
            // Excel'in Türkçe karakter + UTF-8'i tanıması için BOM ekle.
            const csv = '﻿' + [header.map(csvCell).join(','), ...rows].join('\r\n');
            const safeQ = (effectiveQuery || query || 'arama').replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40);
            const stamp = new Date().toISOString().slice(0, 10);
            const { save } = await import('@tauri-apps/plugin-dialog');
            const dest = await save({
                defaultPath: `gorsel-arama-${safeQ}-${stamp}.csv`,
                filters: [{ name: 'CSV', extensions: ['csv'] }],
            });
            if (!dest) return; // kullanıcı iptal etti
            const { writeTextFile } = await import('@tauri-apps/plugin-fs');
            await writeTextFile(dest, csv);
        } catch (err) {
            setError(`Export hatası: ${String((err as Error).message || err)}`);
        } finally {
            setExporting(false);
        }
    }, [results, exporting, effectiveQuery, query]);

    const stats = useMemo(() => {
        if (results.length === 0) return null;
        const top = results[0]?.score ?? 0;
        const last = results[results.length - 1]?.score ?? 0;
        return `${results.length} sonuç · skor ${last.toFixed(3)} – ${top.toFixed(3)}`;
    }, [results]);

    if (!isOpen) return null;

    const sel = selected?.asset;
    const selSrc = sel ? getAssetThumbnailSrc(sel) : null;

    return (
        <div onClick={onClose} style={styles.overlay}>
            <div onClick={(e) => e.stopPropagation()} style={styles.modal}>
                <header style={styles.header}>
                    <strong style={{ fontSize: 16 }}>Görsel Ara — Metinden</strong>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button
                            onClick={() => void handleExport()}
                            disabled={results.length === 0 || exporting}
                            style={{ ...styles.exportBtn, ...(results.length === 0 || exporting ? styles.btnDisabled : {}) }}
                            title="Sonuç listesini CSV olarak dışa aktar"
                        >{exporting ? 'Export…' : 'Export'}</button>
                        <button onClick={onClose} style={styles.closeBtn}>Kapat</button>
                    </div>
                </header>

                <div style={styles.toolbar}>
                    <input
                        autoFocus
                        type="text"
                        placeholder="Örn: stair plan / merdiven planı / facade with arches…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void handleSearch(); }}
                        style={styles.input}
                        disabled={busy}
                    />
                    <button
                        onClick={() => void handleSearch()}
                        disabled={busy || !query.trim()}
                        style={styles.searchBtn}
                    >{busy ? 'Aranıyor…' : 'Ara'}</button>
                    <label style={styles.toggleLabel} title="Türkçe sorgu önce Ollama ile İngilizceye çevrilir (CLIP English-only).">
                        <input
                            type="checkbox"
                            checked={translateOn}
                            onChange={(e) => setTranslateOn(e.target.checked)}
                        /> TR→EN çevir
                    </label>
                </div>

                {effectiveQuery && effectiveQuery !== query && (
                    <div style={styles.translatedRow}>
                        Aramada kullanılan İngilizce: <b>{effectiveQuery}</b>
                    </div>
                )}

                {error && <div style={styles.error}>{error}</div>}

                {hasDwgResult && (
                    <div style={styles.dwgWarning}>
                        <div style={styles.dwgWarningTitle}>
                            <AlertTriangle size={14} />
                            <span>{t('visualSearch.dwgWarning.title')}</span>
                        </div>
                        <div style={styles.dwgWarningBody}>{t('visualSearch.dwgWarning.body')}</div>
                    </div>
                )}

                {stats && <div style={styles.stats}>{stats}</div>}

                <div style={styles.body}>
                    <div style={styles.grid}>
                        {results.map((item) => {
                            const { asset, score } = item;
                            const src = getAssetThumbnailSrc(asset);
                            const isSel = selected?.asset.id === asset.id;
                            return (
                                <button
                                    key={asset.id}
                                    style={{ ...styles.tile, ...(isSel ? styles.tileSelected : {}) }}
                                    onClick={() => setSelected(item)}
                                    onDoubleClick={() => openInApp(asset)}
                                    title={asset.filePath}
                                >
                                    {src ? (
                                        <img src={src} alt={asset.fileName} style={styles.thumb} loading="lazy" />
                                    ) : (
                                        <div style={styles.noThumb}>{asset.fileType}</div>
                                    )}
                                    <div style={styles.tileMeta}>
                                        <div style={styles.tileName}>{asset.fileName}</div>
                                        <div style={styles.tileScore}>skor {score.toFixed(3)}</div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {sel && (
                        <aside style={styles.detail}>
                            <div style={styles.detailHead}>
                                <span style={styles.detailTitle}>Detay</span>
                                <button onClick={() => setSelected(null)} style={styles.detailCloseBtn} title="Detayı kapat">✕</button>
                            </div>
                            <div style={styles.detailScroll}>
                                {selSrc ? (
                                    <img src={selSrc} alt={sel.fileName} style={styles.detailThumb} />
                                ) : (
                                    <div style={styles.detailNoThumb}>{sel.fileType}</div>
                                )}
                                <div style={styles.detailName} title={sel.fileName}>{sel.fileName}</div>
                                <div style={styles.detailScore}>Benzerlik skoru: <b>{(selected?.score ?? 0).toFixed(4)}</b></div>

                                <dl style={styles.dl}>
                                    <Row k="Tür" v={sel.fileType} />
                                    <Row k="Kategori" v={sel.category} />
                                    <Row k="Boyut" v={formatBytes(sel.fileSize)} />
                                    <Row k="Proje" v={sel.projectName || '—'} />
                                    <Row k="Faz" v={sel.projectPhase || '—'} />
                                    <Row k="Oluşturma" v={formatDate(sel.createdAt)} />
                                    <Row k="Değiştirme" v={formatDate(sel.modifiedAt)} />
                                    <Row k="Yol" v={sel.filePath} mono />
                                </dl>

                                {(sel.aiTags?.length ?? 0) > 0 && (
                                    <div style={styles.tagBlock}>
                                        <div style={styles.tagLabel}>AI Etiketleri</div>
                                        <div style={styles.tagWrap}>
                                            {sel.aiTags.slice(0, 12).map((tg, i) => (
                                                <span key={i} style={styles.tagChip}>{typeof tg === 'string' ? tg : tg.label}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {(sel.userTags?.length ?? 0) > 0 && (
                                    <div style={styles.tagBlock}>
                                        <div style={styles.tagLabel}>Kullanıcı Etiketleri</div>
                                        <div style={styles.tagWrap}>
                                            {sel.userTags!.map((tg) => (
                                                <span key={tg.id} style={{ ...styles.tagChip, background: tg.color || '#2c5282' }}>{tg.name}</span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div style={styles.detailActions}>
                                <button onClick={() => void openFile(sel)} style={styles.actBtn}>Dosyayı Aç</button>
                                <button onClick={() => void copyPath(sel)} style={styles.actBtn}>Yolu Kopyala</button>
                                <button onClick={() => openInApp(sel)} style={styles.actBtnPrimary}>Uygulamada Aç</button>
                            </div>
                        </aside>
                    )}
                </div>
            </div>
        </div>
    );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
    return (
        <div style={styles.row}>
            <dt style={styles.rowKey}>{k}</dt>
            <dd style={{ ...styles.rowVal, ...(mono ? styles.rowMono : {}) }} title={v}>{v}</dd>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    modal: {
        background: '#1a202c', color: '#e2e8f0', width: 'min(1200px, 96vw)',
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        borderRadius: 10, border: '1px solid #2d3748', overflow: 'hidden',
    },
    header: {
        padding: '12px 16px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', borderBottom: '1px solid #2d3748',
    },
    closeBtn: {
        background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568',
        padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
    },
    exportBtn: {
        background: '#22543d', color: '#c6f6d5', border: '1px solid #2f855a',
        padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
    },
    btnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
    toolbar: {
        padding: 12, display: 'flex', gap: 8, alignItems: 'center',
        borderBottom: '1px solid #2d3748',
    },
    input: {
        flex: 1, padding: '8px 12px', background: '#2d3748', color: '#e2e8f0',
        border: '1px solid #4a5568', borderRadius: 4, fontSize: 14,
    },
    searchBtn: {
        background: '#2c5282', color: '#bee3f8', border: 'none',
        padding: '8px 18px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
    },
    toggleLabel: { fontSize: 12, opacity: 0.85, display: 'flex', alignItems: 'center', gap: 4 },
    translatedRow: { padding: '6px 16px', fontSize: 12, color: '#a0aec0', borderBottom: '1px solid #2d3748' },
    error: { padding: 12, color: '#feb2b2', fontSize: 13 },
    dwgWarning: {
        padding: '8px 16px', margin: '0 12px 4px', borderRadius: 4,
        background: 'rgba(217, 119, 6, 0.12)', border: '1px solid rgba(217, 119, 6, 0.35)',
        borderLeft: '3px solid #d97706', color: '#fbbf24', fontSize: 12,
    },
    dwgWarningTitle: { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 },
    dwgWarningBody: { fontSize: 11, opacity: 0.9, marginTop: 4, lineHeight: 1.4 },
    stats: { padding: '6px 16px', fontSize: 11, color: '#a0aec0' },
    body: { flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' },
    grid: {
        flex: 1, overflowY: 'auto', padding: 12,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
        gap: 10, alignContent: 'start',
    },
    tile: {
        background: '#2d3748', border: '1px solid #4a5568', borderRadius: 6,
        cursor: 'pointer', padding: 0, overflow: 'hidden', display: 'flex',
        flexDirection: 'column', textAlign: 'left',
    },
    tileSelected: { border: '2px solid #4299e1', boxShadow: '0 0 0 1px #4299e1' },
    thumb: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', background: '#1a202c' },
    noThumb: {
        width: '100%', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#1a202c', color: '#a0aec0', fontSize: 12,
    },
    tileMeta: { padding: 6 },
    tileName: { fontSize: 11, color: '#e2e8f0', wordBreak: 'break-word', lineHeight: 1.3 },
    tileScore: { fontSize: 10, color: '#a0aec0', marginTop: 2 },
    detail: {
        width: 340, flexShrink: 0, borderLeft: '1px solid #2d3748',
        display: 'flex', flexDirection: 'column', background: '#171c26',
    },
    detailHead: {
        padding: '10px 14px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', borderBottom: '1px solid #2d3748',
    },
    detailTitle: { fontSize: 13, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.3 },
    detailCloseBtn: {
        background: 'transparent', color: '#a0aec0', border: 'none',
        cursor: 'pointer', fontSize: 14, padding: 2,
    },
    detailScroll: { flex: 1, overflowY: 'auto', padding: 14 },
    detailThumb: {
        width: '100%', maxHeight: 200, objectFit: 'contain',
        background: '#1a202c', borderRadius: 6, border: '1px solid #2d3748',
    },
    detailNoThumb: {
        width: '100%', height: 140, display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#1a202c', color: '#a0aec0',
        fontSize: 13, borderRadius: 6, border: '1px solid #2d3748',
    },
    detailName: { marginTop: 10, fontSize: 13, fontWeight: 600, color: '#e2e8f0', wordBreak: 'break-word' },
    detailScore: { marginTop: 4, fontSize: 12, color: '#90cdf4' },
    dl: { margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 6 },
    row: { display: 'flex', gap: 8, fontSize: 12, lineHeight: 1.4 },
    rowKey: { width: 86, flexShrink: 0, color: '#a0aec0' },
    rowVal: { flex: 1, color: '#e2e8f0', wordBreak: 'break-word' },
    rowMono: { fontFamily: 'monospace', fontSize: 11, opacity: 0.9 },
    tagBlock: { marginTop: 12 },
    tagLabel: { fontSize: 11, color: '#a0aec0', marginBottom: 4 },
    tagWrap: { display: 'flex', flexWrap: 'wrap', gap: 4 },
    tagChip: {
        background: '#2d3748', color: '#e2e8f0', fontSize: 10,
        padding: '2px 8px', borderRadius: 10, border: '1px solid #4a5568',
    },
    detailActions: {
        padding: 12, borderTop: '1px solid #2d3748',
        display: 'flex', flexWrap: 'wrap', gap: 6,
    },
    actBtn: {
        flex: '1 1 auto', background: '#2d3748', color: '#e2e8f0',
        border: '1px solid #4a5568', padding: '7px 10px', borderRadius: 4,
        cursor: 'pointer', fontSize: 12,
    },
    actBtnPrimary: {
        flex: '1 1 100%', background: '#2c5282', color: '#bee3f8',
        border: 'none', padding: '8px 10px', borderRadius: 4,
        cursor: 'pointer', fontSize: 12, fontWeight: 600,
    },
};
