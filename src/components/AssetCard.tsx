import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Box, Image, Palette, Video, Play, Check, Star, RefreshCw, AlertTriangle, FileX, Sparkles } from 'lucide-react';
import type { Asset } from '../types';
import { formatFileSize, formatDate, getTypeBadgeStyle } from '../data';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useStore } from '../store/useStore';

// Formats the browser webview can render directly via the asset:// protocol
const WEB_IMAGE_TYPES = new Set<string>(['JPEG', 'PNG', 'BMP', 'WEBP', 'SVG']);
const VIDEO_TYPES = new Set<string>(['MP4']);

interface AssetCardProps {
    asset: Asset;
    isSelected: boolean;
    /** Herhangi bir asset çoklu seçimde ise true — checkbox her zaman görünür */
    isMultiSelectMode: boolean;
    /** Normal tık — detay panelini açar */
    onOpen: () => void;
    /** Ctrl+Tık veya checkbox tıklaması — çoklu seçimi toggle eder */
    onToggle: () => void;
    /** Shift+Tık — aralık seçimi (ExplorerView handle eder) */
    onShiftClick: () => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    index: number;
    searchScore?: number;
}

/** Fallback icon rendered when no visual preview is available */
function ThumbIcon({ category }: { category: string }) {
    const iconMap: Record<string, React.ReactNode> = {
        '2D Çizim': <FileText size={36} />,
        '3D Model': <Box size={36} />,
        'Döküman': <FileText size={36} />,
        'Render': <Image size={36} />,
        'Fotoğraf': <Image size={36} />,
        'Doku': <Palette size={36} />,
        'Video': <Video size={36} />,
    };
    return (
        <div style={{ color: 'var(--color-text-muted)', opacity: 0.5 }}>
            {iconMap[category] || <FileText size={36} />}
        </div>
    );
}

/** Icon + color swatch fallback for formats without a visual preview */
function FallbackThumb({ asset }: { asset: Asset }) {
    return (
        <div style={{
            width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
            background: `linear-gradient(135deg, var(--color-bg-tertiary) 0%, ${
                asset.colorPalette.length > 0
                    ? asset.colorPalette[0].hex + '22'
                    : 'var(--color-bg-secondary)'
            } 100%)`,
        }}>
            <ThumbIcon category={asset.category} />
            {asset.colorPalette.length > 0 && (
                <div style={{ display: 'flex', gap: 3 }}>
                    {asset.colorPalette.slice(0, 4).map((c, i) => (
                        <div
                            key={i}
                            className="color-swatch"
                            style={{ background: c.hex, width: 14, height: 14, borderRadius: 3 }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

/** Image with graceful fallback on error — falls back to FallbackThumb */
function PreviewImage({ src, alt, asset }: { src: string; alt: string; asset: Asset }) {
    const [failed, setFailed] = useState(false);
    if (failed) return <FallbackThumb asset={asset} />;
    return (
        <img
            src={src}
            alt={alt}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={() => setFailed(true)}
        />
    );
}

function AssetCard({ asset, isSelected, isMultiSelectMode, onOpen, onToggle, onShiftClick, onContextMenu, index, searchScore }: AssetCardProps) {
    const isFavorite = useStore((s) => s.favoriteIds.has(asset.id));
    const isRescanning = useStore((s) => s.rescanningAssetIds.has(asset.id));
    const isStale = useStore((s) => s.stalenessCheck.staleIds.has(asset.id));
    const isMissing = useStore((s) => s.stalenessCheck.missingIds.has(asset.id));
    const isVersionOutdated = useStore((s) => s.stalenessCheck.versionOutdatedIds.has(asset.id));
    const { t } = useTranslation();
    const [hovered, setHovered] = useState(false);
    const badgeStyle = getTypeBadgeStyle(asset.fileType);

    const handleClick = (e: React.MouseEvent) => {
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); onToggle(); }
        else if (e.shiftKey) { e.preventDefault(); onShiftClick(); }
        else { onOpen(); }
    };

    const showCheckbox = isSelected || hovered || isMultiSelectMode;

    // Determine which preview to show
    let previewContent: React.ReactNode;

    if (asset.thumbnailUrl) {
        // Rust-generated thumbnail (DWG, MAX, TGA, TIFF) — always prefer base64 data URL
        previewContent = (
            <img
                src={asset.thumbnailUrl}
                alt={asset.fileName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
        );

    } else if (WEB_IMAGE_TYPES.has(asset.fileType)) {
        // Native browser-renderable images — use Tauri asset:// protocol.
        // Eğer staleness kontrolü "missing" işaretlediyse ağa hiç çıkma — başarısız
        // load denemeleri (404) IPC kuyruğunu tıkıyor, DetailPanel açılışını yavaşlatıyor.
        if (isMissing) {
            previewContent = <FallbackThumb asset={asset} />;
        } else {
            let src = '';
            try { src = convertFileSrc(asset.filePath); } catch { /* not in Tauri */ }
            previewContent = src
                ? <PreviewImage src={src} alt={asset.fileName} asset={asset} />
                : <FallbackThumb asset={asset} />;
        }

    } else if (VIDEO_TYPES.has(asset.fileType)) {
        // Video placeholder with play icon
        previewContent = (
            <div style={{
                width: '100%', height: '100%', background: '#0a0a0f',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>
                <div style={{
                    width: 40, height: 40, borderRadius: '50%',
                    background: 'rgba(248,113,113,0.15)',
                    border: '1px solid rgba(248,113,113,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Play size={18} style={{ color: '#f87171', marginLeft: 2 }} />
                </div>
                <span style={{ fontSize: '0.62rem', color: 'var(--color-text-muted)' }}>
                    {t('assetCard.videoPreview')}
                </span>
            </div>
        );

    } else {
        previewContent = <FallbackThumb asset={asset} />;
    }

    return (
        <div
            className="asset-card animate-card-enter"
            role="button"
            tabIndex={0}
            aria-selected={isSelected}
            aria-label={asset.fileName}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onOpen(); }
                else if (e.key === ' ') { e.preventDefault(); onToggle(); }
            }}
            style={{
                animationDelay: `${Math.min(index * 30, 200)}ms`,
                borderColor: isSelected ? 'var(--color-accent)' : undefined,
                boxShadow: isSelected ? 'var(--shadow-glow)' : undefined,
            }}
            onClick={handleClick}
            onContextMenu={onContextMenu}
        >
            {/* Thumbnail area */}
            <div className="asset-card-thumb" style={{ position: 'relative' }}>
                {/* Çoklu seçim checkbox */}
                <div
                    onClick={(e) => { e.stopPropagation(); onToggle(); }}
                    style={{
                        position: 'absolute', top: 6, left: 6, zIndex: 10,
                        opacity: showCheckbox ? 1 : 0.22,
                        transition: 'opacity 0.15s',
                    }}
                >
                    <div style={{
                        width: 18, height: 18, borderRadius: 4,
                        background: isSelected ? 'var(--color-accent)' : 'rgba(0,0,0,0.65)',
                        border: `2px solid ${isSelected ? 'var(--color-accent)' : 'rgba(255,255,255,0.45)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', boxSizing: 'border-box',
                    }}>
                        {isSelected && <Check size={11} style={{ color: '#fff' }} />}
                    </div>
                </div>

                {searchScore !== undefined && (
                    <div className="tag tag-accent" style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, fontSize: '0.65rem' }}>
                        {t('assetCard.badge.similarity', { score: (searchScore * 100).toFixed(0) })}
                    </div>
                )}
                {previewContent}
                <span className="asset-type-badge" style={badgeStyle}>{asset.fileType}</span>
                {isRescanning && (
                    <div style={{
                        position: 'absolute', inset: 0, zIndex: 20,
                        background: 'rgba(0,0,0,0.6)',
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center', gap: 6,
                        backdropFilter: 'blur(2px)',
                        borderRadius: 'inherit',
                    }}>
                        <RefreshCw size={20} color="#fff" style={{ animation: 'spin 1s linear infinite' }} />
                        <span style={{ fontSize: '0.65rem', color: '#fff', fontWeight: 600, letterSpacing: '0.03em' }}>
                            {t('contextMenu.rescan.scanning')}
                        </span>
                    </div>
                )}
                {isFavorite && (
                    <div title="Favori" style={{
                        position: 'absolute', bottom: 8, left: 8, zIndex: 11,
                        background: 'rgba(0,0,0,0.55)', color: '#facc15',
                        borderRadius: '50%', width: 22, height: 22,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backdropFilter: 'blur(2px)',
                    }}>
                        <Star size={13} fill="#facc15" stroke="#facc15" />
                    </div>
                )}
                {(isStale || isMissing || isVersionOutdated) && (() => {
                    // Öncelik: missing > stale > versionOutdated
                    const variant = isMissing ? 'missing' : isStale ? 'stale' : 'version';
                    const conf = {
                        missing: { color: '#ef4444', borderRgba: 'rgba(239,68,68,0.45)', Icon: FileX, title: t('assetCard.badge.missing'), label: t('assetCard.badge.missingShort') },
                        stale:   { color: '#f59e0b', borderRgba: 'rgba(245,158,11,0.45)', Icon: AlertTriangle, title: t('assetCard.badge.stale'), label: t('assetCard.badge.staleShort') },
                        version: { color: '#60a5fa', borderRgba: 'rgba(96,165,250,0.45)', Icon: Sparkles, title: t('assetCard.badge.version'), label: t('assetCard.badge.versionShort') },
                    }[variant];
                    return (
                        <div
                            title={conf.title}
                            style={{
                                position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 11,
                                background: 'rgba(0,0,0,0.65)',
                                color: conf.color,
                                borderRadius: 10, padding: '2px 6px',
                                display: 'flex', alignItems: 'center', gap: 3,
                                fontSize: '0.62rem', fontWeight: 600,
                                backdropFilter: 'blur(2px)',
                                border: `1px solid ${conf.borderRgba}`,
                            }}
                        >
                            <conf.Icon size={10} />
                            <span>{conf.label}</span>
                        </div>
                    );
                })()}
            </div>

            {/* Card body */}
            <div className="asset-card-body">
                <div className="asset-card-title" title={asset.fileName}>{asset.fileName}</div>
                <div className="asset-card-meta">{asset.projectName}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                    <span className="asset-card-meta">{formatFileSize(asset.fileSize)}</span>
                    <span className="asset-card-meta">{formatDate(asset.modifiedAt)}</span>
                </div>
                {/* Versiyon etiketi (kullanıcı tanımlı, DetailPanel'den girilir) */}
                {asset.versionLabel && (
                    <div style={{ marginTop: 4 }}>
                        <span
                            title={t('assetStatus.versionLabel')}
                            style={{
                                display: 'inline-block',
                                fontSize: '0.62rem',
                                padding: '1px 6px',
                                borderRadius: 999,
                                background: 'rgba(167,139,250,0.15)',
                                border: '1px solid rgba(167,139,250,0.4)',
                                color: '#a78bfa',
                                fontWeight: 600,
                                lineHeight: 1.4,
                            }}
                        >
                            {asset.versionLabel}
                        </span>
                    </div>
                )}
                {/* Kullanıcı etiketleri (varsa) */}
                {asset.userTags && asset.userTags.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                        {asset.userTags.slice(0, 3).map((tag) => (
                            <span
                                key={tag.id}
                                className="tag"
                                style={{
                                    fontSize: '0.65rem',
                                    background: tag.color + '22',
                                    border: `1px solid ${tag.color}66`,
                                    color: tag.color,
                                    padding: '1px 6px',
                                    borderRadius: 3,
                                }}
                                title={tag.name}
                            >{tag.name}</span>
                        ))}
                        {asset.userTags.length > 3 && (
                            <span style={{ fontSize: '0.6rem', opacity: 0.6, alignSelf: 'center' }}>
                                +{asset.userTags.length - 3}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default React.memo(AssetCard);
