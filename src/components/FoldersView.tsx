/**
 * ArchivistPro — Klasörler Görünümü
 *
 * Taranmış kaynak klasörleri büyük kart grid'i olarak gösterir.
 * Karta tıklayınca o klasörün filter'ı aktive edilip Explorer'a geçilir.
 */

import { useTranslation } from 'react-i18next';
import { Folder, Star, ScanSearch } from 'lucide-react';
import EmptyStateIllustration from './EmptyStateIllustration';
import type { ScannedRoot } from '../services/database';

interface FoldersViewProps {
    roots: ScannedRoot[];
    onOpenFolder: (root: ScannedRoot) => void;
    onStartScan?: () => void;
    onFolderRightClick?: (root: ScannedRoot) => void;
}

/** Uzun path'ten okunabilir kısa isim çıkar: son 2 segment */
function pathLabel(path: string): string {
    const segs = path.replace(/\\/g, '/').split('/').filter(Boolean);
    if (segs.length <= 2) return segs.join(' / ');
    return '…/' + segs.slice(-2).join('/');
}

export default function FoldersView({ roots, onOpenFolder, onStartScan, onFolderRightClick }: FoldersViewProps) {
    const { t } = useTranslation();

    const activeRoots = roots.filter(r => r.status === 'active');

    if (activeRoots.length === 0) {
        return (
            <div style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 16, padding: 40,
                color: 'var(--color-text-muted)',
            }}>
                <EmptyStateIllustration type="empty-archive" />
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-display)' }}>
                    {t('foldersView.empty.title')}
                </div>
                <div style={{ fontSize: '0.82rem', textAlign: 'center', maxWidth: 320, lineHeight: 1.6 }}>
                    {t('foldersView.empty.desc')}
                </div>
                {onStartScan && (
                    <button
                        className="btn btn-primary"
                        onClick={onStartScan}
                        style={{ padding: '10px 24px', gap: 8, marginTop: 8 }}
                    >
                        <ScanSearch size={16} />
                        {t('foldersView.empty.scanBtn')}
                    </button>
                )}
            </div>
        );
    }

    return (
        <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 16,
                padding: 24,
            }}>
                {activeRoots.map((root, idx) => {
                    const displayName = root.label || pathLabel(root.path);
                    return (
                        <button
                            key={root.id}
                            className="animate-card-enter"
                            onClick={() => onOpenFolder(root)}
                            onContextMenu={onFolderRightClick ? () => {
                                onFolderRightClick(root);
                            } : undefined}
                            title={root.path}
                            style={{
                                animationDelay: `${Math.min(idx * 50, 300)}ms`,
                                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                                gap: 10, padding: '20px 18px',
                                background: 'var(--color-bg-secondary)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-lg, 16px)',
                                cursor: 'pointer', textAlign: 'left',
                                transition: 'border-color 150ms, box-shadow 150ms, transform 120ms',
                            }}
                            onMouseEnter={e => {
                                const el = e.currentTarget;
                                el.style.borderColor = 'var(--color-accent)';
                                el.style.boxShadow = '0 4px 20px rgba(99,102,241,0.15)';
                                el.style.transform = 'translateY(-2px)';
                            }}
                            onMouseLeave={e => {
                                const el = e.currentTarget;
                                el.style.borderColor = 'var(--color-border)';
                                el.style.boxShadow = 'none';
                                el.style.transform = 'none';
                            }}
                        >
                            {/* Üst satır: ikon + favori işareti */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                                <div style={{
                                    width: 44, height: 44, borderRadius: 10,
                                    background: 'var(--color-accent-glow, rgba(99,102,241,0.12))',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}>
                                    <Folder size={22} style={{ color: 'var(--color-accent)' }} />
                                </div>
                                {root.isFavorite && (
                                    <Star
                                        size={14}
                                        fill="#f59e0b"
                                        color="#f59e0b"
                                        style={{ flexShrink: 0 }}
                                    />
                                )}
                            </div>

                            {/* Klasör adı */}
                            <div style={{
                                fontSize: '0.88rem', fontWeight: 700,
                                color: 'var(--color-text-primary)',
                                lineHeight: 1.3, wordBreak: 'break-word',
                            }}>
                                {displayName}
                            </div>

                            {/* Kısa path */}
                            <div style={{
                                fontSize: '0.68rem', color: 'var(--color-text-muted)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                width: '100%',
                            }}>
                                {pathLabel(root.path)}
                            </div>

                            {/* Dosya sayısı + son tarama */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', marginTop: 4 }}>
                                <span style={{
                                    fontSize: '0.72rem', fontWeight: 600,
                                    color: 'var(--color-accent)',
                                    background: 'var(--color-accent-glow, rgba(99,102,241,0.1))',
                                    padding: '2px 8px', borderRadius: 6,
                                }}>
                                    {root.fileCount > 0
                                        ? t('foldersView.card.fileCount', { count: root.fileCount })
                                        : t('foldersView.card.noFiles')}
                                </span>
                                {root.lastScan && (
                                    <span style={{ fontSize: '0.64rem', color: 'var(--color-text-muted)' }}>
                                        {new Date(root.lastScan).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
