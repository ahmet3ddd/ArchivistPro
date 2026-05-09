/**
 * DWG Composite Benzerlik Arama Modalı — Faz 4.4
 *
 * Bir referans DWG dosyasına en benzer DWG'leri katman/blok/metin/şekil/pHash
 * composite scoring ile bulur. CLIP'e bağımlı değil.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store/useStore';
import { getAssetById } from '../services/database';
import { getAssetThumbnailSrc } from '../utils/thumbnailSrc';
import { searchSimilarDwg, type DwgSimilarityResult } from '../services/dwgSimilaritySearch';
import type { Asset } from '../types';

function ScoreBar({ value, label, color }: { value: number; label: string; color: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: '#a0aec0' }}>
            <span style={{ minWidth: 20 }}>{label}</span>
            <div style={{ flex: 1, height: 3, background: '#1a202c', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(value * 100).toFixed(0)}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
            <span style={{ minWidth: 24, textAlign: 'right' }}>{(value * 100).toFixed(0)}%</span>
        </div>
    );
}

export default function DwgSimilarityModal() {
    const { t } = useTranslation();
    const refAssetId = useStore((s) => s.dwgSimilarityAssetId);
    const close = useCallback(() => useStore.getState().setDwgSimilarityAssetId(null), []);
    const setSelectedAssetId = useStore((s) => s.setSelectedAssetId);

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<Array<{ result: DwgSimilarityResult; asset: Asset | null }>>([]);
    const [refAsset, setRefAsset] = useState<Asset | null>(null);

    useEffect(() => {
        if (!refAssetId) { setResults([]); setRefAsset(null); return; }
        const ref = getAssetById(refAssetId);
        setRefAsset(ref);
        setBusy(true);
        setError(null);
        searchSimilarDwg(refAssetId, 30)
            .then((res) => {
                setResults(res.map((r) => ({ result: r, asset: getAssetById(r.assetId) })));
                if (res.length === 0) setError(t('dwgSimilarity.noResults'));
            })
            .catch((err) => setError(String(err)))
            .finally(() => setBusy(false));
    }, [refAssetId, t]);

    const onPick = useCallback((assetId: string) => {
        setSelectedAssetId(assetId);
        close();
    }, [close, setSelectedAssetId]);

    if (!refAssetId) return null;

    return (
        <div onClick={close} style={styles.overlay}>
            <div onClick={(e) => e.stopPropagation()} style={styles.modal}>
                <header style={styles.header}>
                    <div>
                        <strong style={{ fontSize: 15 }}>{t('dwgSimilarity.title')}</strong>
                        {refAsset && (
                            <div style={{ fontSize: 11, color: '#a0aec0', marginTop: 2 }}>
                                {t('dwgSimilarity.reference')}: {refAsset.fileName}
                            </div>
                        )}
                    </div>
                    <button onClick={close} style={styles.closeBtn}>{t('common.close')}</button>
                </header>

                {/* Skor açıklaması */}
                <div style={styles.legend}>
                    <span style={{ color: '#63b3ed' }}>L={t('dwgSimilarity.layers')}</span>
                    <span style={{ color: '#68d391' }}>B={t('dwgSimilarity.blocks')}</span>
                    <span style={{ color: '#f6ad55' }}>T={t('dwgSimilarity.texts')}</span>
                    <span style={{ color: '#b794f4' }}>S={t('dwgSimilarity.shapes')}</span>
                    <span style={{ color: '#fc8181' }}>P=pHash</span>
                </div>

                {busy && <div style={styles.status}>{t('dwgSimilarity.searching')}</div>}
                {error && <div style={styles.error}>{error}</div>}
                {!busy && results.length > 0 && (
                    <div style={styles.status}>
                        {results.length} {t('dwgSimilarity.filesFound')} · {t('dwgSimilarity.topScore')} {results[0].result.score.toFixed(3)}
                    </div>
                )}

                <div style={styles.grid}>
                    {results.map(({ result, asset }) => {
                        const src = asset ? getAssetThumbnailSrc(asset) : null;
                        return (
                            <button
                                key={result.assetId}
                                style={styles.tile}
                                onClick={() => onPick(result.assetId)}
                                title={result.filePath}
                            >
                                {src ? (
                                    <img src={src} alt={result.fileName} style={styles.thumb} loading="lazy" />
                                ) : (
                                    <div style={styles.noThumb}>DWG</div>
                                )}
                                <div style={styles.tileMeta}>
                                    <div style={styles.tileName}>{result.fileName}</div>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: '#90cdf4', marginBottom: 3 }}>
                                        {(result.score * 100).toFixed(1)}%
                                    </div>
                                    <ScoreBar value={result.layerScore} label="L" color="#63b3ed" />
                                    <ScoreBar value={result.blockScore} label="B" color="#68d391" />
                                    <ScoreBar value={result.textScore} label="T" color="#f6ad55" />
                                    <ScoreBar value={result.shapeScore} label="S" color="#b794f4" />
                                    <ScoreBar value={result.phashScore} label="P" color="#fc8181" />
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
        background: '#1a202c', color: '#e2e8f0', width: 'min(1020px, 94vw)',
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
    legend: {
        padding: '6px 16px', display: 'flex', gap: 12, fontSize: 10,
        borderBottom: '1px solid #2d3748', background: '#171e2e',
    },
    status: { padding: '6px 16px', fontSize: 11, color: '#a0aec0' },
    error: { padding: '8px 16px', color: '#feb2b2', fontSize: 13 },
    grid: {
        flex: 1, overflowY: 'auto', padding: 12,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10,
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
    tileName: { fontSize: 11, color: '#e2e8f0', wordBreak: 'break-word', lineHeight: 1.3, marginBottom: 3 },
};
