import { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, ChevronDown, ChevronRight, FolderSearch, Brain, Sparkles, Settings2, ImagePlus, X, Trash2, AlertTriangle, Loader2, Info } from 'lucide-react';
import { TIMINGS } from '../config/constants';
import type { Asset, FacetKey } from '../types';
import SidebarConfigModal from './SidebarConfigModal';
import ArchiveHealthBadge from './ArchiveHealthBadge';
import type { FacetConfig } from './SidebarConfigModal';
import { usePermission } from '../permissions';
import { useStore } from '../store/useStore';
import { useAutoRagIndexEnabled } from '../hooks/useAutoRagIndexEnabled';
import {
    getEmbeddingStatsAsync,
    getScannedRoots,
    getAllAssetsFromArchive,
    getRootGroups,
    type ScannedRoot,
    type RootGroup,
} from '../services/database';
import {
    commandRenameScannedRoot,
    commandRemoveScannedRoot,
    commandDeleteScannedRootWithAssets,
    commandSetRootFavorite,
    commandCreateRootGroup,
    commandRenameRootGroup,
    commandUpdateRootGroupColor,
    commandSetRootGroup,
    commandDeleteRootGroup,
} from '../services/undoCommands';
import { getTagsForAssets } from '../services/tagService';
import { notifyInfo } from '../services/notificationCenter';
import i18n from '../i18n';
import { getSearchHistory, addToSearchHistory, removeFromSearchHistory, clearSearchHistory } from '../services/searchHistory';
import { FACET_GROUPS } from '../data';
import SourceFoldersPanel from './SourceFoldersPanel';
import FilterPresetSelector from './FilterPresetSelector';
import FavoritesFilter from './sidebar/FavoritesFilter';
import TagFilter from './sidebar/TagFilter';
import DateRangeFilter from './sidebar/DateRangeFilter';
import ArchiveButton from './sidebar/ArchiveButton';

function formatScanDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}s ${m}dk`;
    if (m > 0) return `${m}dk ${sec}sn`;
    return `${sec}sn`;
}

interface SidebarProps {
    assets: Asset[];
    activeFilters: Partial<Record<FacetKey, string[]>>;
    onFilterChange: (key: FacetKey, value: string) => void;
    searchQuery: string;
    onSearchChange: (q: string) => void;
    onScanClick?: () => void;
    onRescanFolder?: (folderPath: string) => void | Promise<void>;
    isSearching?: boolean;
    semanticActive?: boolean;
    embeddingReady?: boolean;
    facetConfig: FacetConfig[];
    onFacetConfigChange: (newConfig: FacetConfig[]) => void;
    onImageSearch?: (file: File) => void;
    onCancelImageSearch?: () => void;
    isImageSearching?: boolean;
    searchSensitivity?: number;
    onSearchSensitivityChange?: (val: number) => void;
    showSensitivityControl?: boolean;
    sidebarOpen?: boolean;
    embeddingLoading?: boolean;
    embeddingProgress?: number;
    embeddingError?: string | null;
    onRetryEmbedding?: () => void;
    onOpenSettings?: () => void;
    onStartStalenessCheck?: () => void;
}

export default function Sidebar({
    assets, activeFilters, onFilterChange, searchQuery, onSearchChange,
    onScanClick, onRescanFolder, isSearching, semanticActive, embeddingReady,
    facetConfig, onFacetConfigChange, onImageSearch, onCancelImageSearch, isImageSearching,
    searchSensitivity, onSearchSensitivityChange, showSensitivityControl,
    sidebarOpen, embeddingLoading, embeddingProgress, embeddingError, onRetryEmbedding, onOpenSettings,
    onStartStalenessCheck,
}: SidebarProps) {
    const { t } = useTranslation();
    const autoRagIndexOn = useAutoRagIndexEnabled();
    const canScan = usePermission('archive.scan');
    const canManageLocal = usePermission('local_archive.manage');
    const activeArchive = useStore((s) => s.activeArchive);
    const archives = useStore((s) => s.archives);
    const currentArchiveDef = archives.find(a => a.id === activeArchive);
    const lastScanInfo = useStore((s) => s.lastScanInfoMap[s.activeArchive]);
    const scanAllowed = canScan || (currentArchiveDef?.type === 'personal' && canManageLocal);

    // Faz 1.5: Kaynak klasör paneli state'leri
    const scannedRoots = useStore((s) => s.scannedRoots);
    const activeRootFilters = useStore((s) => s.activeRootFilters);
    const toggleRootFilter = useStore((s) => s.toggleRootFilter);
    const clearRootFilters = useStore((s) => s.clearRootFilters);
    const setScannedRoots = useStore((s) => s.setScannedRoots);
    const showConfirmDialog = useStore((s) => s.showConfirmDialog);
    const showInputDialog = useStore((s) => s.showInputDialog);
    const setScannedAssets = useStore((s) => s.setScannedAssets);
    const canManageRoots = canScan || currentArchiveDef?.type === 'personal';

    // Faz 2: Grup state'leri
    const rootGroups = useStore((s) => s.rootGroups);
    const setRootGroups = useStore((s) => s.setRootGroups);
    const toggleGroupFilter = useStore((s) => s.toggleGroupFilter);

    const handleRescanRoot = useCallback((root: ScannedRoot) => {
        if (onRescanFolder) {
            void onRescanFolder(root.path);
        }
    }, [onRescanFolder]);

    const handleRenameRoot = useCallback((root: ScannedRoot) => {
        showInputDialog(t('sidebar.sourceFolders.renameLabel'), root.label, (newLabel) => {
            if (newLabel === root.label) return;
            void commandRenameScannedRoot(root.id, root.label, newLabel, () => {
                setScannedRoots(getScannedRoots());
            });
        });
    }, [showInputDialog, setScannedRoots, t]);

    const handleRemoveRoot = useCallback((root: ScannedRoot) => {
        showConfirmDialog(
            t('sidebar.sourceFolders.confirmRemove'),
            root.path,
            () => {
                void commandRemoveScannedRoot(root.id, root.label, () => {
                    setScannedRoots(getScannedRoots());
                });
                if (activeRootFilters.includes(root.path)) {
                    toggleRootFilter(root.path);
                }
            },
            undefined,
            false,
        );
    }, [showConfirmDialog, setScannedRoots, activeRootFilters, toggleRootFilter, t]);

    const handleDeleteRoot = useCallback((root: ScannedRoot) => {
        showConfirmDialog(
            t('sidebar.sourceFolders.confirmDelete'),
            `${root.path}\n\n${t('sidebar.sourceFolders.confirmDeleteCount', { count: root.fileCount })}`,
            async () => {
                const refreshStore = () => {
                    setScannedRoots(getScannedRoots());
                    const raw = getAllAssetsFromArchive(activeArchive);
                    const tagsMap = getTagsForAssets(raw.map(a => a.id));
                    setScannedAssets(raw.map(a => ({
                        ...a,
                        userTags: (tagsMap[a.id] || []).map(tag => ({ id: tag.id, name: tag.name, color: tag.color })),
                    })));
                };

                const onExecute = () => {
                    refreshStore();
                    if (activeRootFilters.includes(root.path)) toggleRootFilter(root.path);
                    notifyInfo(
                        i18n.t('sidebar.sourceFolders.deleted'),
                        i18n.t('sidebar.sourceFolders.deletedUndo'),
                    );
                };

                try {
                    await commandDeleteScannedRootWithAssets(root, onExecute, refreshStore);
                } catch (err) {
                    console.error('commandDeleteScannedRootWithAssets error', err);
                }
            },
            undefined,
            true, // isDanger
        );
    }, [showConfirmDialog, setScannedRoots, activeRootFilters, toggleRootFilter, setScannedAssets, activeArchive]);

    // Faz 2: Grup handler'ları
    const handleAddGroup = useCallback(() => {
        showInputDialog(t('sidebar.sourceFolders.groups.promptName'), undefined, (name) => {
            void commandCreateRootGroup(name, '#6366f1', () => {
                setRootGroups(getRootGroups());
            });
        });
    }, [showInputDialog, setRootGroups, t]);

    const handleRenameGroup = useCallback((group: RootGroup) => {
        showInputDialog(t('sidebar.sourceFolders.groups.promptRename'), group.name, (newName) => {
            if (newName === group.name) return;
            void commandRenameRootGroup(group.id, group.name, newName, () => {
                setRootGroups(getRootGroups());
            });
        });
    }, [showInputDialog, setRootGroups, t]);

    const handleChangeGroupColor = useCallback((group: RootGroup, color: string) => {
        void commandUpdateRootGroupColor(group.id, group.color, color, () => {
            setRootGroups(getRootGroups());
        });
    }, [setRootGroups]);

    const handleDeleteGroup = useCallback((group: RootGroup) => {
        showConfirmDialog(
            t('sidebar.sourceFolders.groups.confirmDelete'),
            `${group.name}\n\n(Ctrl+Z ile geri alabilirsiniz.)`,
            () => {
                void commandDeleteRootGroup(group.id, () => {
                    setRootGroups(getRootGroups());
                    setScannedRoots(getScannedRoots());
                });
            },
            undefined,
            true,
        );
    }, [showConfirmDialog, setRootGroups, setScannedRoots, t]);

    const handleSetRootGroup = useCallback((root: ScannedRoot, groupId: string | null) => {
        void commandSetRootGroup(root.id, root.groupId ?? null, groupId, root.label, () => {
            setScannedRoots(getScannedRoots());
        });
    }, [setScannedRoots]);

    const handleToggleFavorite = useCallback((root: ScannedRoot) => {
        void commandSetRootFavorite(root.id, !!root.isFavorite, !root.isFavorite, root.label, () => {
            setScannedRoots(getScannedRoots());
        });
    }, [setScannedRoots]);
    const [collapsed, setCollapsed] = useState<Partial<Record<FacetKey, boolean>>>({
        projectPhase: true,
        architecturalStyle: true,
        materialGroup: true,
        colorTheme: true,
    });
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [showSearchHistory, setShowSearchHistory] = useState(false);
    const [historyVersion, setHistoryVersion] = useState(0);
    // searchQuery dep'e gerek yok — callback içinde kullanılmıyor, her tuş vuruşunda
    // gereksiz localStorage parse'ını önler.
    const searchHistory = useMemo(() => getSearchHistory().slice(0, 8), [historyVersion]);

    // İçerik indexi durumu — embeddingReady, arşiv ya da asset listesi değişince yenile.
    // scannedAssetsSignal dependency'si kritik: arşiv değiştiğinde DB swap async,
    // assets yüklendikten sonra effect tekrar çalışıp doğru embeddingCount'u okur.
    const scannedAssetsSignal = useStore((s) => s.scannedAssets.length);
    const [embeddingCount, setEmbeddingCount] = useState<number>(-1);
    const [embeddedAssetCount, setEmbeddedAssetCount] = useState<number>(0);
    const totalAssetCount = assets.length;
    useEffect(() => {
        if (!embeddingReady) {
            setEmbeddingCount(-1);
            setEmbeddedAssetCount(0);
            return;
        }
        // V3 PRE-5b: epoch>=1'de embedding sayımı vec.db'den (async); epoch=0
        // birebir eski sync yol. cancelled guard arşiv değişimi yarışını keser.
        let cancelled = false;
        void getEmbeddingStatsAsync().then((s) => {
            if (cancelled) return;
            setEmbeddingCount(s.total);
            setEmbeddedAssetCount(s.distinctAssets);
        });
        return () => { cancelled = true; };
    }, [embeddingReady, activeArchive, scannedAssetsSignal]);

    const handleRemoveHistory = useCallback((query: string, e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        removeFromSearchHistory(query);
        setHistoryVersion(v => v + 1);
    }, []);

    const handleClearHistory = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        clearSearchHistory();
        setHistoryVersion(v => v + 1);
    }, []);
    const [selectedImageName, setSelectedImageName] = useState<string | null>(null);
    const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);

    // Blob URL'ini unmount'ta revoke et — aksi halde kullanıcı arama yaparken
    // pencereyi kapatsa/ekran kilitlense URL memory'de kalır.
    useEffect(() => {
        return () => {
            if (selectedImagePreview) URL.revokeObjectURL(selectedImagePreview);
        };
    }, [selectedImagePreview]);

    // onBlur timeout id'sini sakla — unmount'ta temizle.
    const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        return () => {
            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
        };
    }, []);

    const toggle = (key: FacetKey) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

    const facetCounts = useMemo(() => {
        const counts: Record<string, Record<string, number>> = {};
        for (const asset of assets) {
            for (const group of FACET_GROUPS) {
                const val = asset[group.key as keyof Asset];
                if (val && typeof val === 'string') {
                    if (!counts[group.key]) counts[group.key] = {};
                    counts[group.key][val] = (counts[group.key][val] || 0) + 1;
                }
            }
        }
        return counts;
    }, [assets]);

    const getCount = (key: FacetKey, value: string) => {
        return facetCounts[key]?.[value] ?? 0;
    };

    // Use full option arrays from FACET_GROUPS, filtered and ordered by facetConfig
    const renderGroups = facetConfig
        .filter(c => c.visible)
        .sort((a, b) => a.order - b.order)
        .map(configItem => {
            const originalGroup = FACET_GROUPS.find(g => g.key === configItem.key);
            if (!originalGroup) return null;
            return {
                ...originalGroup,
                label: configItem.label // Overwrite with custom label
            };
        }).filter(Boolean);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && onImageSearch) {
            if (selectedImagePreview) URL.revokeObjectURL(selectedImagePreview);
            setSelectedImageName(file.name);
            setSelectedImagePreview(URL.createObjectURL(file));
            onImageSearch(file);
        }
        if (e.target) {
            e.target.value = ''; // reset
        }
    };

    const clearImageSearch = useCallback(() => {
        if (selectedImagePreview) URL.revokeObjectURL(selectedImagePreview);
        setSelectedImageName(null);
        setSelectedImagePreview(null);
        onSearchChange('');
        // In-flight görsel analizi iptal et (AbortController ref).
        onCancelImageSearch?.();
    }, [selectedImagePreview, onSearchChange, onCancelImageSearch]);

    // Tüm arama durumunu tek çağrıda sıfırlar — metin + görsel chip + in-flight analiz.
    const clearAllSearch = useCallback(() => {
        if (selectedImageName || selectedImagePreview) {
            clearImageSearch();
        } else {
            onSearchChange('');
        }
    }, [selectedImageName, selectedImagePreview, clearImageSearch, onSearchChange]);

    const shouldShowSensitivityControl =
        Boolean(showSensitivityControl) && typeof searchSensitivity === 'number' && Boolean(onSearchSensitivityChange);

    return (
        <aside className={`sidebar${sidebarOpen ? ' sidebar--open' : ''}`} style={{ background: 'var(--color-bg-secondary)', borderRight: '1px solid var(--color-border)' }}>
            {/* Logo */}
            <div className="sidebar-section" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 'var(--radius-md)',
                        background: 'linear-gradient(135deg, var(--color-accent), var(--color-accent-secondary))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.2rem', fontWeight: 900, color: '#fff',
                        boxShadow: 'var(--shadow-glow)'
                    }}>A</div>
                    <div>
                        <div className="logo-text" style={{ fontSize: '1.2rem', letterSpacing: '-0.03em' }}>Archivist</div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: -2 }}>Architectural DAM</div>
                    </div>
                </div>
                <button
                    className="btn btn-ghost"
                    aria-label={t('sidebar.tooltip.editPanel')}
                    style={{ padding: 6, borderRadius: 'var(--radius-sm)' }}
                    onClick={() => setIsConfigOpen(true)}
                    title={t('sidebar.tooltip.editPanel')}
                >
                    <Settings2 size={16} aria-hidden="true" />
                </button>
            </div>

            {/* Arşiv Seçici */}
            <div className="sidebar-section" style={{ paddingTop: 8, paddingBottom: 8 }}>
                <div style={{ fontSize: '0.68rem', color: 'var(--color-text-muted)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {t('sidebar.section.archive')}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    {archives.map(arch => (
                        <ArchiveButton key={arch.id} archive={arch} />
                    ))}
                </div>
            </div>

            {/* Favori Filtresi */}
            <div className="sidebar-section" style={{ paddingTop: 4, paddingBottom: 4 }}>
                <FavoritesFilter />
            </div>

            {/* Etiket Filtresi */}
            <div className="sidebar-section" style={{ paddingTop: 4, paddingBottom: 4 }}>
                <TagFilter />
            </div>

            {/* Tarih Aralığı Filtresi */}
            <div className="sidebar-section" style={{ paddingTop: 4, paddingBottom: 4 }}>
                <DateRangeFilter />
            </div>

            {/* Filtre Preset'leri */}
            <div className="sidebar-section" style={{ paddingTop: 4, paddingBottom: 4 }}>
                <FilterPresetSelector />
            </div>

            {/* Scan Button — admin veya yerel arşivde viewer */}
            {scanAllowed && onScanClick && (
                <div data-tour="scan-button" className="sidebar-section" style={{ paddingTop: 10, paddingBottom: 6 }}>
                    <button
                        className="btn btn-primary"
                        onClick={onScanClick}
                        style={{ width: '100%', justifyContent: 'center', padding: '9px 16px', fontSize: '0.82rem' }}
                    >
                        <FolderSearch size={15} />
                        {autoRagIndexOn ? t('sidebar.button.scanAndIndex') : t('sidebar.button.scanOnly')}
                    </button>
                    {lastScanInfo && (
                        <div style={{
                            marginTop: 6, fontSize: '0.7rem',
                            color: 'var(--color-text-muted)',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                            <span>⏱</span>
                            <span>
                                {t('sidebar.lastScan.label')}
                                {' '}
                                <strong style={{ color: 'var(--color-text-secondary)' }}>
                                    {formatScanDuration(lastScanInfo.durationMs)}
                                </strong>
                                {' · '}
                                <span>{lastScanInfo.fileCount} {t('sidebar.lastScan.files')}</span>
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Search */}
            <div data-tour="search-input" className="sidebar-section" style={{ paddingTop: 8, paddingBottom: 8 }}>
                <div style={{ position: 'relative' }}>
                    <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                    <input
                        className="search-input sidebar-search-input"
                        aria-label={t('sidebar.aria.searchAssets')}
                        placeholder={embeddingReady ? t('sidebar.search.placeholderSemantic') : t('sidebar.search.placeholderText')}
                        value={searchQuery}
                        onChange={e => onSearchChange(e.target.value)}
                        onFocus={() => setShowSearchHistory(true)}
                        onBlur={() => {
                            if (blurTimerRef.current) clearTimeout(blurTimerRef.current);
                            blurTimerRef.current = setTimeout(() => setShowSearchHistory(false), TIMINGS.SEARCH_HISTORY_DELAY_MS);
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && searchQuery.trim()) {
                                addToSearchHistory(searchQuery.trim());
                            }
                            if (e.key === 'Escape') { clearAllSearch(); setShowSearchHistory(false); }
                        }}
                        style={{ paddingRight: onImageSearch ? ((searchQuery || selectedImageName) ? 80 : 56) : (searchQuery ? 36 : 28) }}
                    />
                    {/* Min. 3 karakter ipucu */}
                    {searchQuery.trim().length > 0 && searchQuery.trim().length < 3 && (
                        <div style={{ fontSize: '0.64rem', color: 'var(--color-text-muted)', marginTop: 4, paddingLeft: 2 }}>
                            {t('sidebar.search.minCharsHint')}
                        </div>
                    )}
                    {/* Arama geçmişi dropdown */}
                    {showSearchHistory && !searchQuery && searchHistory.length > 0 && (
                        <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                            background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)',
                            borderRadius: 8, maxHeight: 220, overflowY: 'auto', zIndex: 20,
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                padding: '5px 8px 5px 10px',
                                borderBottom: '1px solid var(--color-border)',
                            }}>
                                <span style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', fontWeight: 600 }}>
                                    {t('sidebar.search.recentSearches')}
                                </span>
                                <button
                                    onMouseDown={handleClearHistory}
                                    title={t('sidebar.search.clearAll')}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 3,
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        fontSize: '0.64rem', color: 'var(--color-text-muted)',
                                        padding: '2px 4px', borderRadius: 4,
                                    }}
                                >
                                    <Trash2 size={10} />
                                    {t('sidebar.search.clearAll')}
                                </button>
                            </div>
                            {searchHistory.map((h, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                                    <button
                                        onMouseDown={() => onSearchChange(h.query)}
                                        style={{
                                            flex: 1, padding: '6px 10px', border: 'none',
                                            background: 'none', cursor: 'pointer', textAlign: 'left',
                                            fontSize: '0.74rem', color: 'var(--color-text-secondary)',
                                        }}>
                                        {h.query}
                                    </button>
                                    <button
                                        onMouseDown={(e) => handleRemoveHistory(h.query, e)}
                                        title={t('sidebar.search.removeItem')}
                                        style={{
                                            background: 'none', border: 'none', cursor: 'pointer',
                                            padding: '4px 8px', color: 'var(--color-text-muted)',
                                            display: 'flex', alignItems: 'center', flexShrink: 0,
                                        }}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {/* Clear Button — hem metni hem görsel chip'i temizler, in-flight analizi iptal eder */}
                        {(searchQuery || selectedImageName) && (
                            <button
                                onMouseDown={e => { e.preventDefault(); clearAllSearch(); }}
                                title={t('sidebar.search.clear')}
                                style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                                    color: 'var(--color-text-muted)', borderRadius: 4,
                                    lineHeight: 1,
                                }}
                            >
                                <X size={14} />
                            </button>
                        )}
                        {/* Image Search Button */}
                        {onImageSearch && (
                            <>
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    style={{ display: 'none' }}
                                    accept="image/*"
                                    onChange={handleImageChange}
                                />
                                {isImageSearching ? (
                                    <Sparkles size={16} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                                ) : (
                                    <button
                                        className="btn btn-icon"
                                        aria-label={t('sidebar.aria.imageSearch')}
                                        style={{ padding: 4, background: 'var(--color-bg-secondary)' }}
                                        onClick={() => fileInputRef.current?.click()}
                                        title={t('sidebar.tooltip.imageSearch')}
                                        disabled={isSearching}
                                    >
                                        <ImagePlus size={14} style={{ color: 'var(--color-text-secondary)' }} />
                                    </button>
                                )}
                            </>
                        )}
                        {/* Text Search Indicator */}
                        {isSearching && !isImageSearching && (
                            <Sparkles size={14} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
                        )}
                    </div>
                </div>
                {/* Selected image chip */}
                {selectedImageName && (
                    <div style={{
                        marginTop: 6, display: 'flex', alignItems: 'center', gap: 6,
                        background: 'var(--color-accent-subtle)', border: '1px solid var(--color-accent)',
                        borderRadius: 'var(--radius-sm)', padding: '4px 8px',
                    }}>
                        {selectedImagePreview && (
                            <img src={selectedImagePreview} alt="" style={{ width: 20, height: 20, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-accent)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {isImageSearching ? t('sidebar.imageSearch.analyzing') : selectedImageName}
                        </span>
                        {!isImageSearching && (
                            <button
                                onClick={clearImageSearch}
                                aria-label={t('sidebar.tooltip.clearImage')}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', padding: 0, fontSize: '0.75rem', lineHeight: 1, flexShrink: 0 }}
                                title={t('sidebar.tooltip.clearImage')}
                            >
                                <span aria-hidden="true">✕</span>
                            </button>
                        )}
                    </div>
                )}

                {/* İçerik Arama Durum Banner'ı */}
                {(() => {
                    if (embeddingLoading) {
                        return (
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', fontSize: '0.69rem', color: 'var(--color-text-muted)' }}>
                                <Loader2 size={12} className="animate-spin" style={{ color: '#6366f1', flexShrink: 0 }} />
                                <span>
                                    {(embeddingProgress ?? 0) >= 100
                                        ? t('sidebar.contentSearch.preparing')
                                        : t('sidebar.contentSearch.loading')}
                                    {(embeddingProgress ?? 0) > 0 && (embeddingProgress ?? 0) < 100 && (
                                        <span style={{ marginLeft: 4, fontWeight: 600, color: '#818cf8' }}>%{embeddingProgress}</span>
                                    )}
                                </span>
                            </div>
                        );
                    }
                    if (embeddingError) {
                        return (
                            <div
                                style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, padding: '6px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', fontSize: '0.69rem', color: '#f87171' }}
                                title={embeddingError}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                                    <span style={{ flex: 1 }}>{t('sidebar.contentSearch.error')}</span>
                                    {onRetryEmbedding && (
                                        <button
                                            onMouseDown={e => { e.preventDefault(); onRetryEmbedding(); }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f87171', fontSize: '0.66rem', fontWeight: 600, padding: 0, textDecoration: 'underline', flexShrink: 0 }}
                                        >
                                            {t('sidebar.contentSearch.retry')}
                                        </button>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.64rem', color: 'rgba(248,113,113,0.85)', wordBreak: 'break-word', lineHeight: 1.35 }}>
                                    {embeddingError}
                                </div>
                            </div>
                        );
                    }
                    if (embeddingReady && embeddingCount === 0) {
                        return (
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', fontSize: '0.69rem', color: '#fbbf24' }}>
                                <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                                <span style={{ flex: 1 }}>{t('sidebar.contentSearch.notIndexed')}</span>
                                {onScanClick && (
                                    <button onMouseDown={e => { e.preventDefault(); onScanClick(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fbbf24', fontSize: '0.66rem', fontWeight: 600, padding: 0, textDecoration: 'underline', flexShrink: 0 }}>
                                        {t('sidebar.contentSearch.rescan')}
                                    </button>
                                )}
                            </div>
                        );
                    }
                    // "Devre dışı" sadece kullanıcı aktif arama yaparken göster —
                    // model henüz yüklenmemişken yanlış alarm vermemek için
                    if (!embeddingReady && !embeddingLoading && searchQuery.trim().length > 0) {
                        return (
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 6, background: 'rgba(100,116,139,0.07)', border: '1px solid rgba(100,116,139,0.2)', fontSize: '0.69rem', color: 'var(--color-text-muted)' }}>
                                <Info size={12} style={{ flexShrink: 0 }} />
                                <span style={{ flex: 1 }}>{t('sidebar.contentSearch.notReady')}</span>
                                {onOpenSettings && (
                                    <button onMouseDown={e => { e.preventDefault(); onOpenSettings(); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#818cf8', fontSize: '0.66rem', fontWeight: 600, padding: 0, textDecoration: 'underline', flexShrink: 0 }}>
                                        {t('sidebar.contentSearch.configure')}
                                    </button>
                                )}
                            </div>
                        );
                    }
                    return null;
                })()}

                {shouldShowSensitivityControl && (
                    <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-primary)' }}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                            {t('sidebar.sensitivity.label')}
                        </div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--color-text-muted)', marginTop: 2 }}>
                            {t('sidebar.sensitivity.description')}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                            <input
                                type="range"
                                aria-label={t('sidebar.aria.searchSensitivity')}
                                min="0"
                                max="100"
                                value={searchSensitivity}
                                onChange={(e) => onSearchSensitivityChange?.(parseInt(e.target.value, 10))}
                                style={{ flex: 1, cursor: 'pointer', accentColor: 'var(--color-accent)' }}
                            />
                            <span style={{ minWidth: 34, textAlign: 'right', fontSize: '0.72rem', color: 'var(--color-accent)', fontWeight: 700 }}>
                                %{searchSensitivity}
                            </span>
                        </div>
                    </div>
                )}

                {/* AI Status */}
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.68rem' }}>
                    {embeddingReady ? (
                        <span
                            style={{ color: embeddingCount === 0 ? '#f59e0b' : 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 4 }}
                            title={embeddingCount >= 0 ? t('sidebar.ai.embeddingCountTooltip', { count: embeddingCount }) : undefined}
                        >
                            <Brain size={11} />
                            {t('sidebar.ai.semanticActive')}
                            {embeddingCount >= 0 && (
                                <span style={{ opacity: 0.65, fontWeight: 400 }}>
                                    ({embeddingCount === 0
                                        ? t('sidebar.ai.noIndex')
                                        : t('sidebar.ai.chunkCount', { count: embeddingCount })})
                                </span>
                            )}
                        </span>
                    ) : embeddingLoading ? (
                        <span style={{ color: '#6366f1', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Brain size={11} /> {t('sidebar.ai.loading')}
                        </span>
                    ) : (
                        <span style={{ color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Brain size={11} /> {t('sidebar.ai.textBased')}
                        </span>
                    )}
                    {semanticActive && searchQuery && (
                        <span style={{ marginLeft: 'auto', color: 'var(--color-accent)', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Sparkles size={10} /> AI
                        </span>
                    )}
                </div>

                {/* Embedding Progress — asset-level coverage */}
                {embeddingReady && totalAssetCount > 0 && (
                    <div style={{ marginTop: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.66rem', color: 'var(--color-text-muted)', marginBottom: 3 }}>
                            <span>{t('sidebar.embedding.coverage')}</span>
                            <span style={{ fontWeight: 600, color: embeddedAssetCount === totalAssetCount ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>
                                {embeddedAssetCount} / {totalAssetCount}
                            </span>
                        </div>
                        <div
                            className="progress-bar-track"
                            role="progressbar"
                            aria-valuenow={Math.round((embeddedAssetCount / totalAssetCount) * 100)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={t('sidebar.embedding.coverageLabel')}
                            style={{ height: 4 }}
                        >
                            <div
                                className="progress-bar-fill"
                                style={{
                                    width: `${Math.round((embeddedAssetCount / totalAssetCount) * 100)}%`,
                                    background: embeddedAssetCount === totalAssetCount
                                        ? 'var(--color-success)'
                                        : 'var(--color-accent)',
                                    transition: 'width 0.3s ease',
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Scrollable alan: Kaynak Klasörler + Facet filtreler birlikte kayar */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {/* Kaynak Klasör Paneli (Faz 1.5) — semantik durum altında, facet'lerin üstünde */}
                <SourceFoldersPanel
                    roots={scannedRoots}
                    rootGroups={rootGroups}
                    activeFilters={activeRootFilters}
                    onToggle={toggleRootFilter}
                    onToggleGroup={toggleGroupFilter}
                    onClearAll={clearRootFilters}
                    onRescan={handleRescanRoot}
                    onRename={handleRenameRoot}
                    onRemove={handleRemoveRoot}
                    onDeleteWithAssets={handleDeleteRoot}
                    onToggleFavorite={handleToggleFavorite}
                    onSetRootGroup={handleSetRootGroup}
                    onAddGroup={handleAddGroup}
                    onRenameGroup={handleRenameGroup}
                    onChangeGroupColor={handleChangeGroupColor}
                    onDeleteGroup={handleDeleteGroup}
                    canManage={canManageRoots}
                />

                {/* Faceted Filters */}
                {renderGroups.map(group => {
                    if (!group) return null;
                    const isOpen = !collapsed[group.key as FacetKey];
                    const activeVals = activeFilters[group.key as FacetKey] || [];
                    return (
                        <div key={group.key} className="sidebar-section" style={{ paddingTop: 6, paddingBottom: 6 }}>
                            <div
                                className="sidebar-section-title"
                                role="button"
                                tabIndex={0}
                                aria-expanded={!collapsed[group.key as FacetKey]}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(group.key as FacetKey); } }}
                                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                                onClick={() => toggle(group.key as FacetKey)}
                            >
                                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                {group.label}
                                {activeVals.length > 0 && (
                                    <span style={{
                                        marginLeft: 'auto', background: 'var(--color-accent)', color: '#fff',
                                        fontSize: '0.6rem', padding: '1px 6px', borderRadius: 999,
                                    }}>{activeVals.length}</span>
                                )}
                            </div>
                            {isOpen && group.options.map(opt => {
                                const count = getCount(group.key, opt);
                                const isActive = activeVals.includes(opt);
                                return (
                                    <div
                                        key={opt}
                                        className={`facet-item ${isActive ? 'active' : ''}`}
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={isActive}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFilterChange(group.key as FacetKey, opt); } }}
                                        onClick={() => onFilterChange(group.key as FacetKey, opt)}
                                    >
                                        <div style={{
                                            width: 14, height: 14, borderRadius: 3,
                                            border: `1.5px solid ${isActive ? 'var(--color-accent)' : 'var(--color-border-hover)'}`,
                                            background: isActive ? 'var(--color-accent)' : 'transparent',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '0.6rem', color: '#fff', flexShrink: 0,
                                        }}>
                                            {isActive && '✓'}
                                        </div>
                                        <span>{group.optionLabels?.[opt] ?? opt}</span>
                                        <span className="facet-count">{count}</span>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>

            {/* Footer */}
            <div className="sidebar-section" style={{ borderTop: '1px solid var(--color-border)', fontSize: '0.68rem', color: 'var(--color-text-muted)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>{t('sidebar.footer.totalAssets')}</span>
                    <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{assets.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span>{t('sidebar.footer.indexed')}</span>
                    <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{assets.filter(a => a.isIndexed).length}</span>
                </div>
                <ArchiveHealthBadge
                    assets={assets}
                    onStartCheck={() => onStartStalenessCheck?.()}
                />
            </div>

            <SidebarConfigModal
                isOpen={isConfigOpen}
                onClose={() => setIsConfigOpen(false)}
                config={facetConfig}
                onSave={onFacetConfigChange}
                onReset={() => {
                    const defaultConfigs = FACET_GROUPS.map((g, i) => ({
                        key: g.key,
                        label: g.label,
                        visible: true,
                        order: i
                    }));
                    onFacetConfigChange(defaultConfigs);
                }}
            />
        </aside>
    );
}

// FavoritesFilter, TagFilter, ArchiveButton → src/components/sidebar/ dizinine taşındı

