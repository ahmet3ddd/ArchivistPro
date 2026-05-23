/**
 * Geometrik Şekil Arama Modalı — Faz 4.4
 *
 * 2 sekme:
 *   1. Görsel Yükle: drag&drop/dosya seç → Rust kontur çıkarma → benzer şekilleri bul
 *   2. Özellik Ara: vertex, düzgünlük, kompaktlık, dikdörtgensellik, kategori, açık/kapalı
 *
 * Sonuçlar: DWG asset grid'i + şekil bilgileri + 6 boyutlu skor (backend Rust)
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';
import { getAssetById } from '../services/database';
import { getAssetThumbnailSrc } from '../utils/thumbnailSrc';
import {
    searchShapesBySimilarity,
    searchShapesByFeatures,
    type ImageShapeResult,
    type ShapeMatch,
} from '../services/dwgShapeIndex';
import type { Asset } from '../types';
import DetailPanel from './DetailPanel';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

type Tab = 'image' | 'criteria';

const POLYGON_NAMES: Record<number, string> = {
    3: 'Üçgen', 4: 'Dörtgen', 5: 'Beşgen', 6: 'Altıgen',
    7: 'Yedigen', 8: 'Sekizgen', 9: 'Dokuzgen', 10: 'Ongen', 12: 'Onikigen',
};

const CATEGORIES = ['TUMU', 'CATI', 'DOSEME', 'DUVAR', 'HAVUZ', 'KAPI', 'KIRIS', 'KOLON', 'MERDIVEN', 'PENCERE', 'DIGER'];

function shapeLabel(vertexCount: number, regularity: number): string {
    if (regularity > 0.85 && POLYGON_NAMES[vertexCount]) {
        return `Düzgün ${POLYGON_NAMES[vertexCount]}`;
    }
    return POLYGON_NAMES[vertexCount] ?? `${vertexCount}-gen`;
}

/** Kompaktlık/dikdörtgensellik/solidity için mini bar gösterimi */
function MiniBar({ value, label, color }: { value: number; label: string; color: string }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#a0aec0' }}>
            <span style={{ minWidth: 28 }}>{label}</span>
            <div style={{ flex: 1, height: 4, background: '#1a202c', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${(value * 100).toFixed(0)}%`, height: '100%', background: color, borderRadius: 2 }} />
            </div>
            <span style={{ minWidth: 28, textAlign: 'right' }}>{(value * 100).toFixed(0)}%</span>
        </div>
    );
}

export default function ShapeSearchModal({ isOpen, onClose }: Props) {
    const { t } = useTranslation();
    const [tab, setTab] = useState<Tab>('image');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<Array<{ match: ShapeMatch; asset: Asset | null }>>([]);
    const [detectedShape, setDetectedShape] = useState<ImageShapeResult | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const setSelectedAssetId = useStore((s) => s.setSelectedAssetId);
    const assets = useStore((s) => s.scannedAssets);

    // Criteria tab state
    const [vertexCount, setVertexCount] = useState<string>('8');
    const [vertexTol, setVertexTol] = useState<string>('2');
    const [minRegularity, setMinRegularity] = useState<string>('0.3');
    const [minCompactness, setMinCompactness] = useState<string>('');
    const [minRectangularity, setMinRectangularity] = useState<string>('');
    const [category, setCategory] = useState('TUMU');
    const [includeOpen, setIncludeOpen] = useState(false);
    const [selectedTagIds, setSelectedTagIds] = useState<Set<number>>(new Set());
    const [selectedResult, setSelectedResult] = useState<{ match: ShapeMatch; asset: Asset | null } | null>(null);

    // DWG/DXF asset'lerindeki benzersiz tag'leri topla
    const dwgAssets = useMemo(() =>
        assets.filter((a) => a.fileType === 'DWG' || a.fileType === 'DXF'),
        [assets],
    );
    const availableTags = useMemo(() => {
        const map = new Map<number, { id: number; name: string; color: string }>();
        for (const a of dwgAssets) {
            for (const t of a.userTags ?? []) map.set(t.id, t);
        }
        return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    }, [dwgAssets]);

    // Panel açıldığında state'i sıfırla
    useEffect(() => {
        if (isOpen) {
            setTab('image');
            setBusy(false);
            setError(null);
            setResults([]);
            setDetectedShape(null);
            setVertexCount('8');
            setVertexTol('2');
            setMinRegularity('0.3');
            setMinCompactness('');
            setMinRectangularity('');
            setCategory('TUMU');
            setIncludeOpen(false);
            setSelectedTagIds(new Set());
            setSelectedResult(null);
        }
    }, [isOpen]);

    const resolveResults = useCallback((matches: ShapeMatch[]) => {
        const byAsset = new Map<string, ShapeMatch>();
        for (const m of matches) {
            const existing = byAsset.get(m.assetId);
            if (!existing || m.score > existing.score) {
                byAsset.set(m.assetId, m);
            }
        }
        const items = Array.from(byAsset.values()).map((m) => ({
            match: m,
            asset: getAssetById(m.assetId),
        }));
        items.sort((a, b) => b.match.score - a.match.score);
        setResults(items);
    }, []);

    // ── Görsel Yükle ─────────────────────────────────────────────────
    const handleImageFile = useCallback(async (file: File) => {
        setBusy(true);
        setError(null);
        setDetectedShape(null);
        setResults([]);
        try {
            const buffer = await file.arrayBuffer();
            const imageData = Array.from(new Uint8Array(buffer));
            const result = await invoke<ImageShapeResult>('extract_shape_from_image_bytes', { imageData });
            setDetectedShape(result);

            const matches = await searchShapesBySimilarity(result.shape, 40, includeOpen);
            resolveResults(matches);

            if (matches.length === 0) {
                setError(t('shapeSearch.noResultsHint'));
            }
        } catch (err) {
            setError(String((err as Error).message || err));
        } finally {
            setBusy(false);
        }
    }, [t, resolveResults, includeOpen]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void handleImageFile(file);
    }, [handleImageFile]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0];
        if (file) void handleImageFile(file);
    }, [handleImageFile]);

    // ── Özellik Ara ──────────────────────────────────────────────────
    const handleCriteriaSearch = useCallback(async () => {
        setBusy(true);
        setError(null);
        setDetectedShape(null);
        try {
            const vc = parseInt(vertexCount, 10);
            const tagFilteredIds = selectedTagIds.size > 0
                ? dwgAssets
                    .filter((a) => (a.userTags ?? []).some((tg) => selectedTagIds.has(tg.id)))
                    .map((a) => a.id)
                : undefined;
            const matches = await searchShapesByFeatures({
                vertexCount: isNaN(vc) ? undefined : vc,
                vertexTolerance: parseInt(vertexTol, 10) || 2,
                minRegularity: parseFloat(minRegularity) || undefined,
                minCompactness: parseFloat(minCompactness) || undefined,
                minRectangularity: parseFloat(minRectangularity) || undefined,
                layerCategory: category !== 'TUMU' ? category : undefined,
                includeOpen,
                assetIds: tagFilteredIds,
            }, 50);
            resolveResults(matches);
            if (matches.length === 0) {
                setError(t('shapeSearch.noResultsHint'));
            }
        } catch (err) {
            setError(String((err as Error).message || err));
        } finally {
            setBusy(false);
        }
    }, [vertexCount, vertexTol, minRegularity, minCompactness, minRectangularity, category, includeOpen, selectedTagIds, dwgAssets, t, resolveResults]);

    const onPick = useCallback((assetId: string) => {
        setSelectedAssetId(assetId);
        onClose();
    }, [onClose, setSelectedAssetId]);

    const stats = useMemo(() => {
        if (results.length === 0) return null;
        const top = results[0]?.match.score ?? 0;
        const closedCount = results.filter(r => r.match.isClosed).length;
        const openCount = results.length - closedCount;
        let s = `${results.length} ${t('shapeSearch.filesFound')} · ${t('shapeSearch.topScore')} ${top.toFixed(3)}`;
        if (openCount > 0) s += ` · ${openCount} ${t('shapeSearch.openShapes')}`;
        return s;
    }, [results, t]);

    if (!isOpen) return null;

    const ds = detectedShape?.shape;

    return (
        <div onClick={onClose} style={styles.overlay}>
            <div onClick={(e) => e.stopPropagation()} style={{
                    ...styles.modal,
                    width: selectedResult ? 'min(1380px, 96vw)' : 'min(1020px, 94vw)',
                }}>
                <header style={styles.header}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ fontSize: 16 }}>{t('shapeSearch.title')}</strong>
                        <span title={t('shapeSearch.dwgBadgeTitle')} style={styles.dwgBadge}>DWG · DXF</span>
                    </div>
                    <button onClick={onClose} style={styles.closeBtn}>{t('common.close')}</button>
                </header>

                {/* Tab bar */}
                <div style={styles.tabBar}>
                    <button
                        style={{ ...styles.tabBtn, ...(tab === 'image' ? styles.tabActive : {}) }}
                        onClick={() => setTab('image')}
                    >{t('shapeSearch.tab.image')}</button>
                    <button
                        style={{ ...styles.tabBtn, ...(tab === 'criteria' ? styles.tabActive : {}) }}
                        onClick={() => setTab('criteria')}
                    >{t('shapeSearch.tab.criteria')}</button>
                </div>

                {/* Tab: Görsel Yükle */}
                {tab === 'image' && (
                    <div style={styles.toolbar}>
                        <div
                            onDrop={handleDrop}
                            onDragOver={(e) => e.preventDefault()}
                            onClick={() => fileInputRef.current?.click()}
                            style={styles.dropZone}
                        >
                            {busy ? t('shapeSearch.analyzing') : (
                            <>
                                <div>{t('shapeSearch.dropHint')}</div>
                                <div style={{ fontSize: 10, color: '#718096', marginTop: 5 }}>
                                    {t('shapeSearch.dropSubHint')}
                                </div>
                            </>
                        )}
                        </div>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/bmp,image/tiff"
                            onChange={handleFileSelect}
                            style={{ display: 'none' }}
                        />
                        {ds && (
                            <div style={styles.shapeInfo}>
                                <div style={{ marginBottom: 6 }}>
                                    {t('shapeSearch.detected')}
                                    {' '}<b>{shapeLabel(ds.vertex_count, ds.regularity)}</b>
                                    {' '}({detectedShape!.simplified_point_count} vertex)
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                    <MiniBar value={ds.compactness ?? 0} label={t('shapeSearch.compact')} color="#4299e1" />
                                    <MiniBar value={ds.solidity ?? 0} label={t('shapeSearch.solid')} color="#48bb78" />
                                    <MiniBar value={ds.rectangularity ?? 0} label={t('shapeSearch.rect')} color="#ed8936" />
                                </div>
                            </div>
                        )}
                        {/* Açık şekil toggle (image tab'da da geçerli) */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 11, color: '#a0aec0', cursor: 'pointer' }}>
                            <input type="checkbox" checked={includeOpen} onChange={(e) => setIncludeOpen(e.target.checked)} />
                            {t('shapeSearch.includeOpen')}
                        </label>
                    </div>
                )}

                {/* Tab: Özellik Ara */}
                {tab === 'criteria' && (
                    <div style={styles.criteriaPanel}>
                        <div style={styles.criteriaRow}>
                            <label style={styles.label}>
                                {t('shapeSearch.vertexCount')}
                                <input type="number" min={3} max={50} value={vertexCount}
                                    onChange={(e) => setVertexCount(e.target.value)} style={styles.numInput} />
                            </label>
                            <label style={styles.label}>
                                &#xB1;
                                <input type="number" min={0} max={10} value={vertexTol}
                                    onChange={(e) => setVertexTol(e.target.value)} style={{ ...styles.numInput, width: 50 }} />
                            </label>
                            <label style={styles.label}>
                                {t('shapeSearch.minRegularity')}
                                <input type="number" min={0} max={1} step={0.1} value={minRegularity}
                                    onChange={(e) => setMinRegularity(e.target.value)} style={styles.numInput} />
                            </label>
                            <label style={styles.label}>
                                {t('shapeSearch.minCompactness')}
                                <input type="number" min={0} max={1} step={0.1} value={minCompactness}
                                    placeholder="0-1" onChange={(e) => setMinCompactness(e.target.value)} style={styles.numInput} />
                            </label>
                            <label style={styles.label}>
                                {t('shapeSearch.minRectangularity')}
                                <input type="number" min={0} max={1} step={0.1} value={minRectangularity}
                                    placeholder="0-1" onChange={(e) => setMinRectangularity(e.target.value)} style={styles.numInput} />
                            </label>
                        </div>
                        <div style={{ ...styles.criteriaRow, marginTop: 8 }}>
                            <label style={styles.label}>
                                {t('shapeSearch.category')}
                                <select value={category} onChange={(e) => setCategory(e.target.value)} style={styles.select}>
                                    {CATEGORIES.map((c) => (
                                        <option key={c} value={c}>
                                            {c === 'TUMU' ? t('shapeSearch.allCategories') : c}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#a0aec0', cursor: 'pointer', paddingBottom: 2 }}>
                                <input type="checkbox" checked={includeOpen} onChange={(e) => setIncludeOpen(e.target.checked)} />
                                {t('shapeSearch.includeOpen')}
                            </label>
                            <button onClick={handleCriteriaSearch} disabled={busy} style={styles.searchBtn}>
                                {busy ? '...' : t('shapeSearch.search')}
                            </button>
                        </div>
                        {availableTags.length > 0 && (
                            <div style={{ ...styles.criteriaRow, marginTop: 8, flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                <span style={{ ...styles.label, flexDirection: 'row', alignItems: 'center' }}>
                                    {t('shapeSearch.tagFilter')}:
                                </span>
                                {availableTags.map((tag) => (
                                    <button
                                        key={tag.id}
                                        onClick={() => setSelectedTagIds((prev) => {
                                            const next = new Set(prev);
                                            next.has(tag.id) ? next.delete(tag.id) : next.add(tag.id);
                                            return next;
                                        })}
                                        style={{
                                            ...styles.tagChip,
                                            background: selectedTagIds.has(tag.id) ? tag.color : '#2d3748',
                                            borderColor: tag.color,
                                        }}
                                    >
                                        {tag.name}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {error && <div style={styles.error}>{error}</div>}
                {stats && <div style={styles.stats}>{stats}</div>}

                {/* Sonuç alanı: grid + detay paneli */}
                <div style={styles.resultArea}>
                    <div style={styles.grid}>
                        {results.map(({ match, asset }) => {
                            const src = asset ? getAssetThumbnailSrc(asset) : null;
                            const fileName = asset?.fileName ?? match.assetId;
                            const isSelected = selectedResult?.match.shapeId === match.shapeId;
                            return (
                                <button
                                    key={match.shapeId}
                                    style={{
                                        ...styles.tile,
                                        border: isSelected ? '2px solid #4299e1' : '1px solid #4a5568',
                                        boxShadow: isSelected ? '0 0 0 2px #2c5282' : 'none',
                                    }}
                                    onClick={() => setSelectedResult({ match, asset })}
                                    title={asset?.filePath ?? ''}
                                >
                                    {src ? (
                                        <img src={src} alt={fileName} style={styles.thumb} loading="lazy" />
                                    ) : (
                                        <div style={styles.noThumb}>{match.isClosed ? 'DWG' : '〰 DWG'}</div>
                                    )}
                                    <div style={styles.tileMeta}>
                                        <div style={styles.tileName}>{fileName}</div>
                                        <div style={styles.tileShape}>
                                            {!match.isClosed && '〰 '}
                                            {shapeLabel(match.vertexCount, match.regularity)}
                                            {match.layerCategory !== 'DIGER' && ` · ${match.layerCategory}`}
                                        </div>
                                        <div style={{ display: 'flex', gap: 3, marginTop: 2 }}>
                                            <MiniBar value={match.compactness} label="C" color="#4299e1" />
                                            <MiniBar value={match.rectangularity} label="R" color="#ed8936" />
                                        </div>
                                        <div style={styles.tileScore}>
                                            {t('shapeSearch.scoreLabel')} {match.score.toFixed(3)}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    {/* Detay paneli */}
                    {selectedResult && (
                        <div style={styles.detailSidebar}>
                            <div style={styles.detailSidebarBar}>
                                <button
                                    onClick={() => onPick(selectedResult.match.assetId)}
                                    style={styles.showInArchiveBtn}
                                >
                                    {t('shapeSearch.showInArchive')} →
                                </button>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto' }}>
                                {selectedResult.asset ? (
                                    <DetailPanel
                                        asset={selectedResult.asset}
                                        onClose={() => setSelectedResult(null)}
                                        onUpdate={(updated) => {
                                            setResults((prev) => prev.map((r) =>
                                                r.match.assetId === updated.id ? { ...r, asset: updated } : r,
                                            ));
                                            setSelectedResult((prev) => prev ? { ...prev, asset: updated } : null);
                                        }}
                                    />
                                ) : (
                                    <div style={{ padding: 20, color: '#a0aec0', fontSize: 13 }}>
                                        {t('shapeSearch.assetNotFound')}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
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
    dwgBadge: {
        fontSize: 10, background: '#2c5282', color: '#90cdf4',
        padding: '2px 6px', borderRadius: 3, fontWeight: 600, letterSpacing: '0.03em',
    },
    tagChip: {
        padding: '3px 8px', borderRadius: 12, fontSize: 11,
        border: '1px solid', cursor: 'pointer', color: '#e2e8f0',
        transition: 'background 150ms', background: '#2d3748',
    },
    tabBar: { display: 'flex', borderBottom: '1px solid #2d3748' },
    tabBtn: {
        flex: 1, padding: '10px 0', background: 'transparent', color: '#a0aec0',
        border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
        borderBottom: '2px solid transparent',
    },
    tabActive: { color: '#90cdf4', borderBottomColor: '#4299e1' },
    toolbar: { padding: 12, borderBottom: '1px solid #2d3748' },
    dropZone: {
        border: '2px dashed #4a5568', borderRadius: 8, padding: '28px 16px',
        textAlign: 'center', color: '#a0aec0', fontSize: 13, cursor: 'pointer',
        transition: 'border-color 200ms',
    },
    shapeInfo: {
        marginTop: 10, padding: '8px 12px', background: '#2d3748', borderRadius: 6,
        fontSize: 12, color: '#e2e8f0',
    },
    criteriaPanel: { padding: 12, borderBottom: '1px solid #2d3748' },
    criteriaRow: { display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' },
    label: { display: 'flex', flexDirection: 'column', fontSize: 11, color: '#a0aec0', gap: 4 },
    numInput: {
        width: 70, padding: '6px 8px', background: '#2d3748', color: '#e2e8f0',
        border: '1px solid #4a5568', borderRadius: 4, fontSize: 13,
    },
    select: {
        padding: '6px 8px', background: '#2d3748', color: '#e2e8f0',
        border: '1px solid #4a5568', borderRadius: 4, fontSize: 13,
    },
    searchBtn: {
        background: '#2c5282', color: '#bee3f8', border: 'none',
        padding: '8px 18px', borderRadius: 4, cursor: 'pointer', fontWeight: 600,
        alignSelf: 'flex-end',
    },
    error: { padding: '8px 16px', color: '#feb2b2', fontSize: 13 },
    stats: { padding: '6px 16px', fontSize: 11, color: '#a0aec0' },
    resultArea: {
        flex: 1, display: 'flex', overflow: 'hidden',
    },
    grid: {
        flex: 1, overflowY: 'auto', padding: 12,
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10,
        alignContent: 'start',
    },
    detailSidebar: {
        flexShrink: 0, display: 'flex', flexDirection: 'column',
        borderLeft: '1px solid #2d3748', overflow: 'hidden',
    },
    detailSidebarBar: {
        padding: '8px 12px', borderBottom: '1px solid #2d3748',
        background: '#1a202c', display: 'flex', justifyContent: 'flex-end', flexShrink: 0,
    },
    showInArchiveBtn: {
        background: '#2c5282', color: '#bee3f8', border: 'none',
        padding: '6px 14px', borderRadius: 4, cursor: 'pointer',
        fontWeight: 600, fontSize: 12,
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
    tileShape: { fontSize: 10, color: '#90cdf4', marginTop: 2 },
    tileScore: { fontSize: 10, color: '#a0aec0', marginTop: 2 },
};
