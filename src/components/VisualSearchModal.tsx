import { useState, useCallback, useMemo } from 'react';
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

export default function VisualSearchModal({ isOpen, onClose, aiConfig }: Props) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [busy, setBusy] = useState(false);
    const [results, setResults] = useState<ResultItem[]>([]);
    const [effectiveQuery, setEffectiveQuery] = useState<string>('');
    const [error, setError] = useState<string | null>(null);
    const [translateOn, setTranslateOn] = useState(true);
    const setSelectedAssetId = useStore((s) => s.setSelectedAssetId);

    // Faz 4.4 — Yol C uyarısı: teknik çizimde CLIP diskriminasyonu zayıf
    const hasDwgResult = useMemo(() => results.some(r => r.asset.fileType === 'DWG'), [results]);

    const handleSearch = useCallback(async () => {
        const q = query.trim();
        if (!q || busy) return;
        setBusy(true);
        setError(null);
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

    const onPick = useCallback((a: Asset) => {
        setSelectedAssetId(a.id);
        onClose();
    }, [onClose, setSelectedAssetId]);

    const stats = useMemo(() => {
        if (results.length === 0) return null;
        const top = results[0]?.score ?? 0;
        const last = results[results.length - 1]?.score ?? 0;
        return `${results.length} sonuç · skor ${last.toFixed(3)} – ${top.toFixed(3)}`;
    }, [results]);

    if (!isOpen) return null;

    return (
        <div onClick={onClose} style={styles.overlay}>
            <div onClick={(e) => e.stopPropagation()} style={styles.modal}>
                <header style={styles.header}>
                    <strong style={{ fontSize: 16 }}>Görsel Ara — Metinden</strong>
                    <button onClick={onClose} style={styles.closeBtn}>Kapat</button>
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

                <div style={styles.grid}>
                    {results.map(({ asset, score }) => {
                        const src = getAssetThumbnailSrc(asset);
                        return (
                            <button key={asset.id} style={styles.tile} onClick={() => onPick(asset)} title={asset.filePath}>
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
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    modal: {
        background: '#1a202c', color: '#e2e8f0', width: 'min(960px, 94vw)',
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
    grid: {
        flex: 1, overflowY: 'auto', padding: 12,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10,
    },
    tile: {
        background: '#2d3748', border: '1px solid #4a5568', borderRadius: 6,
        cursor: 'pointer', padding: 0, overflow: 'hidden', display: 'flex',
        flexDirection: 'column', textAlign: 'left',
    },
    thumb: { width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', background: '#1a202c' },
    noThumb: {
        width: '100%', aspectRatio: '1 / 1', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#1a202c', color: '#a0aec0', fontSize: 12,
    },
    tileMeta: { padding: 6 },
    tileName: { fontSize: 11, color: '#e2e8f0', wordBreak: 'break-word', lineHeight: 1.3 },
    tileScore: { fontSize: 10, color: '#a0aec0', marginTop: 2 },
};
