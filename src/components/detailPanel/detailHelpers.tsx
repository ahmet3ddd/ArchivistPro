/**
 * DetailPanel — paylaşılan iç bileşenler ve sabitler.
 * Önceden DetailPanel.tsx içinde tanımlıydı.
 */
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Palette, RefreshCw } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { getColorInfo, type ColorInfo } from '../../utils/colorConvert';
import { turkishLower } from '../../utils/searchScoring';
import type { Asset } from '../../types';

export const WEB_IMAGE_TYPES = new Set<string>(['JPEG', 'PNG', 'BMP', 'WEBP', 'SVG']);
export const VIDEO_TYPES = new Set<string>(['MP4']);
export const COLOR_EXTRACT_TYPES_SET = new Set(['JPEG', 'PNG', 'BMP', 'TIFF', 'TGA']);
export const COLLAPSE_THRESHOLD = 10;

/* ── AssetPreview ── */

const PREVIEW_REASON_TYPES = new Set(['DWG', 'MAX']);

export function AssetPreview({ asset }: { asset: Asset }) {
    const { t } = useTranslation();
    const [imgFailed, setImgFailed] = useState(false);
    const previewStyle = { borderBottom: '1px solid var(--color-border)', background: '#0a0a0f' };
    const imgStyle: React.CSSProperties = { width: '100%', maxHeight: 220, objectFit: 'contain', display: 'block' };

    if (asset.thumbnailUrl) {
        return <div style={previewStyle}><img src={asset.thumbnailUrl} alt={asset.fileName} style={imgStyle} /></div>;
    }
    if (WEB_IMAGE_TYPES.has(asset.fileType) && !imgFailed) {
        let src = '';
        try { src = convertFileSrc(asset.filePath); } catch { /* not in Tauri */ }
        if (!src) return null;
        return <div style={previewStyle}><img src={src} alt={asset.fileName} style={imgStyle} onError={() => setImgFailed(true)} /></div>;
    }
    if (VIDEO_TYPES.has(asset.fileType)) {
        let src = '';
        try { src = convertFileSrc(asset.filePath); } catch { /* not in Tauri */ }
        if (!src) return null;
        return <div style={previewStyle}><video src={src} controls style={{ width: '100%', maxHeight: 200, display: 'block' }} /></div>;
    }

    // DWG/MAX onizleme yoksa sebebi gosterelim — kullanici "neden boş" diye merak etmesin
    const reason = asset.metadata?.thumbnailMissingReason;
    if (PREVIEW_REASON_TYPES.has(asset.fileType) && reason) {
        return (
            <div style={{
                ...previewStyle,
                padding: '20px 16px', textAlign: 'center',
                color: 'var(--color-text-muted)', fontSize: '0.78rem', lineHeight: 1.5,
            }}>
                {t(`previewReason.${reason}`, t('previewReason.unknown'))}
            </div>
        );
    }

    return null;
}

/* ── ColorRow ── */

export function ColorRow({ hex, percentage, name, defaultOpen }: {
    hex: string; percentage: number; name?: string; defaultOpen?: boolean;
}) {
    const [expanded, setExpanded] = useState(defaultOpen ?? false);
    const [hovered, setHovered] = useState(false);
    const info = useMemo<ColorInfo>(() => getColorInfo(hex), [hex]);
    const cellStyle: React.CSSProperties = { fontSize: '0.68rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' };
    const labelStyle: React.CSSProperties = { fontSize: '0.62rem', color: 'var(--color-text-muted)', fontWeight: 600, letterSpacing: '0.03em', minWidth: 34 };

    return (
        <div>
            <div onClick={() => setExpanded(e => !e)} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer', userSelect: 'none', borderRadius: 6, background: hovered ? 'rgba(255,255,255,0.04)' : 'transparent', transition: 'background 0.15s' }}>
                <span style={{ background: hex, width: 18, height: 18, borderRadius: 4, flexShrink: 0, border: '1px solid rgba(255,255,255,0.1)', boxShadow: `0 0 6px ${hex}44` }} />
                <span style={{ flex: 1, fontSize: '0.76rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{name || hex}</span>
                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-muted)', marginRight: 4 }}>{percentage}%</span>
                <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0, transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
            </div>
            {expanded && (
                <div style={{ background: 'var(--color-bg-tertiary)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', marginBottom: 6, marginTop: 2, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={labelStyle}>RGB</span><span style={cellStyle}>{info.rgb.r}, {info.rgb.g}, {info.rgb.b}</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={labelStyle}>CMYK</span><span style={cellStyle}>{info.cmyk.c}, {info.cmyk.m}, {info.cmyk.y}, {info.cmyk.k}</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={labelStyle}>HSL</span><span style={cellStyle}>{info.hsl.h}°, {info.hsl.s}%, {info.hsl.l}%</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={labelStyle}>W&B</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                            <div style={{ width: 40, height: 8, borderRadius: 4, overflow: 'hidden', background: '#000', display: 'flex' }}>
                                <div style={{ width: `${info.wb.white}%`, background: '#fff' }} />
                            </div>
                            <span style={cellStyle}>{info.wb.white}%B {info.wb.black}%S</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={labelStyle}>HEX</span><span style={cellStyle}>{hex.toUpperCase()}</span></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={labelStyle}>RAL</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ background: info.ral.hex, width: 10, height: 10, borderRadius: 2, border: '1px solid rgba(255,255,255,0.15)' }} />
                            <span style={cellStyle}>{info.ral.code}</span>
                        </div>
                    </div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <span style={{ ...labelStyle, minWidth: 34 }}></span>
                        <span style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                            {info.ral.name}
                            {info.ral.distance > 0 && <span style={{ opacity: 0.6 }}> (ΔE {info.ral.distance})</span>}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── ColorPaletteSection ── */

export function ColorPaletteSection({ asset, onUpdate, onRefreshColors, isExtractingColors }: {
    asset: Asset; onUpdate?: (updated: Asset) => void; onRefreshColors: () => void; isExtractingColors: boolean;
}) {
    const { t } = useTranslation();
    return (
        <div className="detail-section">
            <div className="detail-section-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Palette size={12} /> {t('detail.section.colorPalette')}</span>
                {onUpdate && COLOR_EXTRACT_TYPES_SET.has(asset.fileType) && (
                    <button className="btn btn-ghost" style={{ fontSize: '0.65rem', padding: '2px 8px' }} onClick={onRefreshColors} disabled={isExtractingColors}>
                        <RefreshCw size={10} className={isExtractingColors ? 'animate-spin' : ''} />
                        {isExtractingColors ? t('detail.color.analyzing') : t('detail.color.refresh')}
                    </button>
                )}
            </div>
            {asset.colorPalette.length > 0 && (
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', height: 24, marginBottom: 8 }}>
                    {asset.colorPalette.map((c, i) => <div key={i} style={{ background: c.hex, flex: c.percentage }} title={`${c.name || c.hex} (${c.percentage}%)`} />)}
                </div>
            )}
            {asset.colorPalette.map((c, i) => <ColorRow key={i} hex={c.hex} percentage={c.percentage} name={c.name} defaultOpen={i === 0} />)}
            {asset.colorTheme && <div style={{ marginTop: 6 }}><span className="tag">{asset.colorTheme}</span></div>}
        </div>
    );
}

/* ── CollapsibleList ── */

export function CollapsibleList({ label, count, icon, children }: {
    label: string; count: number; icon?: React.ReactNode; children: React.ReactNode;
}) {
    const [open, setOpen] = useState(count <= COLLAPSE_THRESHOLD);
    return (
        <div style={{ marginTop: 8 }}>
            <button onClick={() => setOpen(o => !o)} style={{
                display: 'flex', alignItems: 'center', gap: 4, width: '100%',
                background: 'transparent', border: 'none', padding: '2px 0', cursor: 'pointer',
                color: 'var(--color-text-secondary)', fontSize: '0.72rem', textAlign: 'left',
            }}>
                {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                {icon}
                <span>{label} ({count})</span>
            </button>
            {open && <div style={{ marginTop: 4 }}>{children}</div>}
        </div>
    );
}

/* ── FilterableTextList ── */

export function FilterableTextList({ items, initialLimit = 30 }: { items: string[]; initialLimit?: number }) {
    const [filter, setFilter] = useState('');
    const [showAll, setShowAll] = useState(false);

    const filtered = useMemo(() => {
        const needle = turkishLower(filter.trim());
        if (!needle) return items;
        return items.filter(t => turkishLower(t).includes(needle));
    }, [items, filter]);

    const isFiltering = filter.trim().length > 0;
    const limit = isFiltering || showAll ? filtered.length : Math.min(initialLimit, filtered.length);
    const visible = filtered.slice(0, limit);
    const hidden = filtered.length - limit;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
                placeholder="Listede ara (Türkçe güvenli)…"
                style={{ padding: '3px 6px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.04)', border: '1px solid transparent', borderRadius: 4, color: 'var(--color-text-primary)', outline: 'none' }}
                onFocus={e => e.target.style.borderColor = 'var(--color-accent)'}
                onBlur={e => e.target.style.borderColor = 'transparent'}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {visible.map((t, i) => <span key={i} className="tag">{t}</span>)}
                {hidden > 0 && (
                    <button type="button" onClick={() => setShowAll(true)} className="tag"
                        style={{ opacity: 0.75, cursor: 'pointer', background: 'transparent', border: '1px dashed var(--color-border)' }}>
                        +{hidden} tümünü göster
                    </button>
                )}
                {isFiltering && filtered.length === 0 && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>"{filter}" için eşleşme yok</span>
                )}
            </div>
        </div>
    );
}
