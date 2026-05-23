import { useState, useRef, useEffect } from 'react';
import { LayoutGrid, Table, BarChart3, FolderOpen, FolderTree, RefreshCw, FolderOutput, X, HelpCircle, Undo2, Redo2, XCircle, Trash2, Settings, ScrollText, MessageSquare, GitCompare, Image, Hexagon, ChevronLeft, Search, ChevronDown } from 'lucide-react';
import AIStatusBadge from './AIStatusBadge';
import { useTranslation } from 'react-i18next';
import type { ViewMode, IndexingStatus, FacetKey } from '../types';
import { ProtectedAction } from '../permissions';
import { useStore } from '../store/useStore';

interface TopBarProps {
    viewMode: ViewMode;
    onViewModeChange: (vm: ViewMode) => void;
    indexingStatus: IndexingStatus;
    resultCount: number;
    totalCount?: number;
    dbReady?: boolean; // unused but kept for backward compat
    onRefileClick?: () => void;
    hasSelectedAssets?: boolean;
    onAiConfigClick?: () => void;
    cardSize?: number;
    onCardSizeChange?: (size: number) => void;
    onToggleSidebar?: () => void;
    activeFilters?: Partial<Record<FacetKey, string[]>>;
    onClearFilters?: () => void;
    onRemoveFilter?: (key: FacetKey, value: string) => void;
    onHelpClick?: () => void;
    onUndoClick?: () => void;
    onRedoClick?: () => void;
    onDeleteClick?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    /** Sırada geri alınacak işlemin etiketi — Undo butonu yanında persistent gösterilir */
    undoLabel?: string | null;
    hasSelection?: boolean;
    onSettingsClick?: () => void;
    onTrashClick?: () => void;
    onLogViewerClick?: () => void;
    onFeedbackClick?: () => void;
    unreadMessageCount?: number;
    onDuplicateFinderClick?: () => void;
    trashCount?: { files: number; folders: number };
    /** Klasörler görünümünden drill-down yapıldıysa geri dönmek için */
    onBackToFolders?: () => void;
    /** Aktif klasör filtresi etiketi — geri chip'inde gösterilir */
    activeFolderLabel?: string | null;
}

/** Gelişmiş Arama — 4 özel arama aracını tek dropdown'da toplar */
function AdvancedSearchDropdown({ onDuplicateFinderClick }: { onDuplicateFinderClick?: () => void }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const gpuAvailable = useStore((s) => s.gpuAvailable);
    const noGpu = gpuAvailable === false;

    // Dışına tıklayınca kapat
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const items = [
        {
            icon: <MessageSquare size={14} />,
            label: t('topbar.advancedSearch.aiChat'),
            onClick: () => { setOpen(false); useStore.getState().setIsChatOpen(true); },
            disabled: noGpu,
            disabledTitle: noGpu ? t('topbar.aiChat.noGpu', 'GPU algılanamadı — AI sohbet kullanılamaz') : undefined,
            color: 'var(--color-accent)',
        },
        {
            icon: <Image size={14} />,
            label: t('topbar.advancedSearch.visualSearch'),
            onClick: () => { setOpen(false); useStore.getState().setIsVisualSearchOpen(true); },
            color: 'var(--color-accent)',
        },
        {
            icon: <GitCompare size={14} />,
            label: t('topbar.advancedSearch.duplicateFinder'),
            onClick: () => { setOpen(false); onDuplicateFinderClick?.(); },
            color: 'var(--color-text-secondary)',
        },
        {
            icon: <Hexagon size={14} />,
            label: t('topbar.advancedSearch.shapeSearch'),
            onClick: () => { setOpen(false); useStore.getState().setIsShapeSearchOpen(true); },
            color: 'var(--color-text-secondary)',
        },
    ];

    return (
        <div ref={ref} style={{ position: 'relative' }}>
            <button
                className="btn btn-ghost"
                onClick={() => setOpen(v => !v)}
                style={{
                    padding: '6px 10px', color: 'var(--color-accent)',
                    fontWeight: 600, fontSize: 12, gap: 4,
                }}
                title={t('topbar.advancedSearch.title')}
            >
                <Search size={14} />
                {t('topbar.advancedSearch.title')}
                <ChevronDown size={12} style={{ opacity: 0.6, transition: 'transform 150ms', transform: open ? 'rotate(180deg)' : 'none' }} />
            </button>
            {open && (
                <div style={{
                    position: 'absolute', top: '100%', right: 0, marginTop: 4,
                    background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
                    borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                    zIndex: 100, minWidth: 220, overflow: 'hidden',
                }}>
                    {items.map((item, i) => (
                        <button
                            key={i}
                            onClick={item.disabled ? undefined : item.onClick}
                            disabled={item.disabled}
                            title={item.disabledTitle}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                                padding: '10px 14px', background: 'none', border: 'none',
                                borderBottom: i < items.length - 1 ? '1px solid var(--color-border)' : 'none',
                                color: item.disabled ? 'var(--color-text-muted)' : item.color,
                                fontSize: '0.78rem', fontWeight: 500, cursor: item.disabled ? 'not-allowed' : 'pointer',
                                opacity: item.disabled ? 0.5 : 1, textAlign: 'left',
                            }}
                            onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'none'; }}
                        >
                            {item.icon}
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function TopBar({ viewMode, onViewModeChange, indexingStatus, resultCount, totalCount, dbReady: _dbReady, onRefileClick, hasSelectedAssets, onAiConfigClick, cardSize, onCardSizeChange, onToggleSidebar, activeFilters, onClearFilters, onRemoveFilter, onHelpClick, onUndoClick, onRedoClick, onDeleteClick, canUndo, canRedo, undoLabel, hasSelection, onSettingsClick, onTrashClick, onLogViewerClick, onFeedbackClick, unreadMessageCount, onDuplicateFinderClick, trashCount, onBackToFolders, activeFolderLabel }: TopBarProps) {
    const { t } = useTranslation();

    const viewModes: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
        { key: 'folders', label: t('topbar.viewMode.folders'), icon: <FolderTree size={15} /> },
        { key: 'explorer', label: t('topbar.viewMode.explorer'), icon: <LayoutGrid size={15} /> },
        { key: 'dashboard', label: t('topbar.viewMode.dashboard'), icon: <BarChart3 size={15} /> },
        { key: 'technical', label: t('topbar.viewMode.technical'), icon: <Table size={15} /> },
    ];

    const progress = indexingStatus.totalFiles > 0
        ? Math.round((indexingStatus.indexedFiles / indexingStatus.totalFiles) * 100)
        : 0;

    return (
        <div className="topbar" style={{ background: 'var(--color-bg-secondary)', backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--color-border)' }}>
            {/* Hamburger menu for mobile */}
            {onToggleSidebar && (
                <button
                    className="btn btn-ghost hamburger-btn"
                    aria-label={t('topbar.aria.openMenu')}
                    onClick={onToggleSidebar}
                    style={{ padding: 6, marginRight: 4, fontSize: '1.2rem', lineHeight: 1 }}
                >
                    &#9776;
                </button>
            )}
            {/* Left: View mode toggle */}
            <div data-tour="view-modes" style={{ display: 'flex', gap: 6, background: 'var(--color-bg-tertiary)', padding: 4, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                {viewModes.map(v => (
                    <button
                        key={v.key}
                        className={`btn ${viewMode === v.key ? 'btn-primary' : 'btn-ghost'}`}
                        aria-label={v.label}
                        aria-pressed={viewMode === v.key}
                        onClick={() => onViewModeChange(v.key)}
                        style={{ padding: '6px 14px', borderRadius: 'var(--radius-sm)', border: 'none' }}
                    >
                        {v.icon}
                        <span style={{ fontWeight: 600 }}>{v.label}</span>
                    </button>
                ))}
            </div>

            {/* Center: Result count + Active Filters */}
            <div style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 10, fontSize: '0.85rem', color: 'var(--color-text-secondary)', flexWrap: 'wrap',
            }}>
                <div style={{ width: 1, height: 24, background: 'var(--color-border)', marginRight: 10 }} />
                {/* Klasörler geri butonu — folder drill-down sırasında */}
                {onBackToFolders && activeFolderLabel && (
                    <button
                        onClick={onBackToFolders}
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            background: 'none', border: '1px solid var(--color-border)',
                            borderRadius: 999, padding: '2px 10px 2px 6px',
                            fontSize: '0.72rem', color: 'var(--color-text-secondary)',
                            cursor: 'pointer', fontWeight: 600, transition: 'border-color 150ms',
                        }}
                        title={t('topbar.backToFolders')}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                    >
                        <ChevronLeft size={12} />
                        {t('topbar.viewMode.folders')}
                    </button>
                )}
                <FolderOpen size={15} style={{ color: 'var(--color-accent)' }} />
                <span>
                  {viewMode === 'folders'
                    ? t('topbar.folderCount', { count: resultCount })
                    : t('topbar.resultCount', { count: resultCount }) + (totalCount !== undefined && totalCount !== resultCount ? ` / ${totalCount}` : '')}
                </span>
                {/* Active filter chips */}
                {activeFilters && Object.entries(activeFilters).map(([key, vals]) =>
                    (vals || []).map(val => (
                        <span key={`${key}-${val}`} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            background: 'var(--color-accent-glow)', border: '1px solid var(--color-accent)',
                            borderRadius: 999, padding: '2px 10px 2px 8px', fontSize: '0.72rem',
                            color: 'var(--color-accent)', fontWeight: 600,
                        }}>
                            {val}
                            <button
                                onClick={() => onRemoveFilter?.(key as FacetKey, val)}
                                aria-label={t('topbar.aria.removeFilter', { value: val })}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', padding: 0, display: 'flex', lineHeight: 1 }}
                            >
                                <X size={12} />
                            </button>
                        </span>
                    ))
                )}
                {activeFilters && Object.values(activeFilters).some(v => v && v.length > 0) && (
                    <button
                        onClick={onClearFilters}
                        style={{
                            background: 'none', border: '1px solid var(--color-border)',
                            borderRadius: 999, padding: '2px 10px', fontSize: '0.68rem',
                            color: 'var(--color-text-muted)', cursor: 'pointer', fontWeight: 600,
                        }}
                    >
                        {t('topbar.filters.clearAll')}
                    </button>
                )}
                <div style={{ width: 1, height: 24, background: 'var(--color-border)', marginLeft: 10 }} />
            </div>

            {/* Right: Refile + Indexing status + DB status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Card size slider */}
                {viewMode === 'explorer' && onCardSizeChange && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <LayoutGrid size={13} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                        <input
                            type="range"
                            aria-label={t('topbar.aria.cardSize')}
                            min={140}
                            max={380}
                            step={10}
                            value={cardSize}
                            onChange={e => onCardSizeChange(Number(e.target.value))}
                            style={{ width: 80, accentColor: 'var(--color-accent)', cursor: 'pointer' }}
                            title={t('topbar.tooltip.cardSize', { size: cardSize })}
                        />
                    </div>
                )}
                {/* Undo / Redo / Sil */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, borderRight: '1px solid var(--color-border)', paddingRight: 8, marginRight: 4 }}>
                    {onUndoClick && (
                        <button className="btn btn-ghost" onClick={onUndoClick} disabled={!canUndo}
                            aria-label={undoLabel ? `${t('topbar.tooltip.undo')}: ${undoLabel}` : t('topbar.tooltip.undo')}
                            style={{ padding: '5px 8px', opacity: canUndo ? 1 : 0.3 }}
                            title={undoLabel ? `${t('topbar.tooltip.undo')}: ${undoLabel}` : t('topbar.tooltip.undo')}>
                            <Undo2 size={14} aria-hidden="true" />
                        </button>
                    )}
                    {/* Son işlem etiketi — toast yerine persistent, sessiz gösterim */}
                    {canUndo && undoLabel && (
                        <span
                            title={undoLabel}
                            style={{
                                fontSize: '0.7rem',
                                color: 'var(--color-text-muted)',
                                maxWidth: 180,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                marginLeft: 4,
                                marginRight: 2,
                            }}
                        >
                            {undoLabel}
                        </span>
                    )}
                    {onRedoClick && (
                        <button className="btn btn-ghost" onClick={onRedoClick} disabled={!canRedo}
                            aria-label={t('topbar.tooltip.redo')}
                            style={{ padding: '5px 8px', opacity: canRedo ? 1 : 0.3 }} title={t('topbar.tooltip.redo')}>
                            <Redo2 size={14} aria-hidden="true" />
                        </button>
                    )}
                    {onDeleteClick && hasSelection && (
                        <button className="btn btn-ghost" onClick={onDeleteClick}
                            aria-label={t('topbar.tooltip.deleteFromArchive')}
                            style={{ padding: '5px 8px', color: 'var(--color-danger)' }} title={t('topbar.tooltip.deleteFromArchive')}>
                            <XCircle size={14} aria-hidden="true" />
                        </button>
                    )}
                </div>

                {/* Çöp Kutusu — ayrı konum */}
                {onTrashClick && (() => {
                    const trashFiles = trashCount?.files ?? 0;
                    const trashFolders = trashCount?.folders ?? 0;
                    const cap = (n: number) => (n > 99 ? '99+' : String(n));
                    let badgeText: string | null = null;
                    if (trashFiles > 0 && trashFolders > 0) badgeText = `${cap(trashFiles)} / ${cap(trashFolders)}`;
                    else if (trashFiles > 0) badgeText = cap(trashFiles);
                    else if (trashFolders > 0) badgeText = cap(trashFolders);
                    return (
                        <button className="btn btn-ghost" onClick={onTrashClick}
                            aria-label={t('topbar.tooltip.trash')}
                            style={{ padding: '5px 8px', color: 'var(--color-text-muted)', position: 'relative' }} title={t('topbar.tooltip.trash')}>
                            <Trash2 size={14} aria-hidden="true" />
                            {badgeText !== null && (
                                <span aria-hidden="true" style={{
                                    position: 'absolute', top: 1, right: 0,
                                    background: '#ef4444', color: '#fff', borderRadius: 8,
                                    padding: '0 4px', fontSize: '0.55rem', fontWeight: 700, lineHeight: '13px',
                                    minWidth: 13, textAlign: 'center',
                                }}>
                                    {badgeText}
                                </span>
                            )}
                        </button>
                    );
                })()}

                {/* Refile button — sadece admin */}
                <ProtectedAction permission="archive.refile" mode="disabled">
                {onRefileClick && hasSelectedAssets && (
                    <button className="btn btn-ghost" onClick={onRefileClick} style={{ padding: '6px 12px' }}>
                        <FolderOutput size={14} />
                        <span>{t('topbar.tooltip.organize')}</span>
                    </button>
                )}
                </ProtectedAction>

                {/* Gelişmiş Arama dropdown — AI Chat, Görsel, Şekil, Kopya Bulucu */}
                <AdvancedSearchDropdown onDuplicateFinderClick={onDuplicateFinderClick} />

                {/* AI Status Badge + Settings */}
                {onAiConfigClick && (
                    <AIStatusBadge
                        onClick={onAiConfigClick}
                        onSetupClick={() => useStore.getState().setIsAISetupOpen(true)}
                    />
                )}

                {/* Feedback / Mesaj */}
                {onFeedbackClick && (
                    <button
                        className="btn btn-ghost"
                        onClick={onFeedbackClick}
                        aria-label={t(unreadMessageCount ? 'topbar.aria.feedbackUnread' : 'topbar.tooltip.feedback', { count: unreadMessageCount })}
                        style={{ padding: '6px 10px', color: 'var(--color-text-muted)', position: 'relative' }}
                        title={t('topbar.tooltip.feedback')}
                    >
                        <MessageSquare size={15} aria-hidden="true" />
                        {(unreadMessageCount ?? 0) > 0 && (
                            <span aria-hidden="true" style={{
                                position: 'absolute', top: 2, right: 2,
                                background: '#ef4444', color: '#fff', borderRadius: 8,
                                padding: '0 4px', fontSize: '0.58rem', fontWeight: 700, lineHeight: '14px',
                                minWidth: 14, textAlign: 'center',
                            }}>
                                {unreadMessageCount}
                            </span>
                        )}
                    </button>
                )}

                {/* Help Button */}
                {onHelpClick && (
                    <button
                        className="btn btn-ghost"
                        onClick={onHelpClick}
                        aria-label={t('topbar.tooltip.help')}
                        style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}
                        title={t('topbar.tooltip.help')}
                    >
                        <HelpCircle size={15} aria-hidden="true" />
                    </button>
                )}

                {/* Log Viewer — sadece admin */}
                <ProtectedAction permission="logs.view" mode="disabled">
                {onLogViewerClick && (
                    <button
                        className="btn btn-ghost"
                        onClick={onLogViewerClick}
                        aria-label={t('topbar.tooltip.auditLog')}
                        style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}
                        title={t('topbar.tooltip.auditLog')}
                    >
                        <ScrollText size={15} aria-hidden="true" />
                    </button>
                )}
                </ProtectedAction>

                {/* Settings Button */}
                {onSettingsClick && (
                    <button
                        data-tour="settings-btn"
                        className="btn btn-ghost"
                        onClick={onSettingsClick}
                        aria-label={t('topbar.tooltip.settings')}
                        style={{ padding: '6px 10px', color: 'var(--color-text-muted)' }}
                        title={t('topbar.tooltip.settings')}
                    >
                        <Settings size={15} aria-hidden="true" />
                    </button>
                )}

                {/* İndeksleme durumu — sadece tarama aktifken göster */}
                {indexingStatus.isRunning && (
                    <>
                        <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                        <div style={{ width: 120 }}>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: 3 }}>
                                {t('topbar.indexing.progress', { progress })}
                            </div>
                            <div className="progress-bar-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t('topbar.indexing.progress', { progress })}>
                                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
