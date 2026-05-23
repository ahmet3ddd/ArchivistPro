/**
 * ArchivistPro — Kaynak Klasör Paneli (Faz 2)
 *
 * Gruplar, favoriler ve klasör etiketleri ile genişletilmiş kaynak klasör yönetimi.
 * Filtreleme mevcut activeRootFilters mekanizmasını kullanır (değişmedi).
 */

import { useState, useRef, useEffect, useCallback, useMemo, type ReactNode, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown, ChevronRight, Folder, FolderTree, MoreVertical,
  FolderOpen, X, Star,
} from 'lucide-react';
import type { ScannedRoot, RootGroup } from '../services/database';
import { useIsAdmin } from '../permissions';
import { getAllTags, type Tag } from '../services/tagService';
import { getTagsForRoots } from '../services/rootTagService';
import { commandCreateTag, commandSetTagsForRoot } from '../services/undoCommands';
import { getAllAssets, detectAndSaveSameStemRelationsAsync } from '../services/database';
import { writeXmpBatch } from '../services/xmpSidecar';
import { hasAdminFeatures } from '../services/buildFeatures';
import { notifyError } from '../services/notificationCenter';
import { setFolderRagExcluded } from '../services/database';
import { buildSubFolderTree, type FolderTreeNode } from '../utils/folderTree';
import { useStore } from '../store/useStore';
import ScanReportsModal from './ScanReportsModal';

interface Props {
  roots: ScannedRoot[];
  rootGroups: RootGroup[];
  activeFilters: string[];
  onToggle: (path: string) => void;
  onToggleGroup: (groupId: string) => void;
  onClearAll: () => void;
  onRescan: (root: ScannedRoot) => void;
  onRename: (root: ScannedRoot) => void;
  onRemove: (root: ScannedRoot) => void;
  onDeleteWithAssets: (root: ScannedRoot) => void;
  onToggleFavorite: (root: ScannedRoot) => void;
  onSetRootGroup: (root: ScannedRoot, groupId: string | null) => void;
  onAddGroup: () => void;
  onRenameGroup: (group: RootGroup) => void;
  onChangeGroupColor: (group: RootGroup, color: string) => void;
  onDeleteGroup: (group: RootGroup) => void;
  canManage: boolean;
}

export default function SourceFoldersPanel({
  roots, rootGroups, activeFilters,
  onToggle, onToggleGroup, onClearAll,
  onRescan, onRename, onRemove, onDeleteWithAssets,
  onToggleFavorite, onSetRootGroup,
  onAddGroup, onRenameGroup, onChangeGroupColor, onDeleteGroup,
  canManage,
}: Props) {
  const { t } = useTranslation();
  const isAdmin = useIsAdmin();
  const [collapsed, setCollapsed] = useState(roots.length >= 5);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [openGroupMenuId, setOpenGroupMenuId] = useState<string | null>(null);
  const [openSubMenuId, setOpenSubMenuId] = useState<string | null>(null);
  const [openTagPickerId, setOpenTagPickerId] = useState<string | null>(null);
  const [rootTagsMap, setRootTagsMap] = useState<Record<string, Tag[]>>({});
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#6366f1');
  const [favCollapsed, setFavCollapsed] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Alt-klasör ağacı: hangi root'lar expand edilmiş + tree node'ların kendi expand state'i
  const [expandedRoots, setExpandedRoots] = useState<Set<string>>(new Set());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  // AI hassasiyet: hangi root'lar AI'dan hariç tutulmuş
  const [ragExcludedRoots, setRagExcludedRoots] = useState<Set<string>>(new Set());
  // Tarama Raporları modal'ı için seçili root
  const [reportsModalRoot, setReportsModalRoot] = useState<ScannedRoot | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scannedAssets = useStore((s) => s.scannedAssets);

  // Sadece expand edilen root'lar için tree build et — büyük arşivde gereksiz hesaplama yok
  const treeMap = useMemo(() => {
    const map = new Map<string, FolderTreeNode[]>();
    if (expandedRoots.size === 0 || scannedAssets.length === 0) return map;
    for (const root of roots) {
      if (expandedRoots.has(root.id)) {
        map.set(root.id, buildSubFolderTree(root.path, scannedAssets));
      }
    }
    return map;
  }, [roots, scannedAssets, expandedRoots]);

  const toggleRootExpand = useCallback((rootId: string) => {
    setExpandedRoots(prev => {
      const next = new Set(prev);
      if (next.has(rootId)) next.delete(rootId); else next.add(rootId);
      return next;
    });
  }, []);

  const toggleNodeExpand = useCallback((fullPath: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath); else next.add(fullPath);
      return next;
    });
  }, []);

  const toggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
      return next;
    });
  }, []);

  // Etiket haritasını yükle
  useEffect(() => {
    if (roots.length === 0) { setRootTagsMap({}); return; }
    setRootTagsMap(getTagsForRoots(roots.map(r => r.id)));
  }, [roots]);

  // Tag picker açılınca mevcut etiketleri yükle
  useEffect(() => {
    if (openTagPickerId) setAllTags(getAllTags());
  }, [openTagPickerId]);

  // Click-outside ile tüm menüleri kapat
  useEffect(() => {
    const anyOpen = openMenuId || openGroupMenuId || openTagPickerId;
    if (!anyOpen) return;
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
        setOpenGroupMenuId(null);
        setOpenSubMenuId(null);
        setOpenTagPickerId(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenuId(null);
        setOpenGroupMenuId(null);
        setOpenSubMenuId(null);
        setOpenTagPickerId(null);
      }
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [openMenuId, openGroupMenuId, openTagPickerId]);

  const [relationScanToast, setRelationScanToast] = useState<string | null>(null);

  const closeAllMenus = useCallback(() => {
    setOpenMenuId(null);
    setOpenGroupMenuId(null);
    setOpenSubMenuId(null);
    setOpenTagPickerId(null);
  }, []);

  const handleScanRelations = useCallback(async () => {
    const allAssets = getAllAssets();
    // PRE-6a: async — epoch>=3'te asset_relations vec.db'ye yönlenir.
    const count = await detectAndSaveSameStemRelationsAsync(allAssets);
    setRelationScanToast(count > 0
      ? t('sidebar.sourceFolders.menu.scanRelationsDone', { count })
      : t('sidebar.sourceFolders.menu.scanRelationsNone'));
    setTimeout(() => setRelationScanToast(null), 3000);
  }, [t]);

  // Yeni etiket oluştur ve klasöre ata
  const handleCreateAndAssignTag = useCallback(async (rootId: string) => {
    const trimmed = newTagName.trim();
    if (!trimmed) return;
    const tag = await commandCreateTag(trimmed, newTagColor, () => setAllTags(getAllTags()));
    if (!tag) return;
    const current = rootTagsMap[rootId] ?? [];
    const previousIds = current.map(t => t.id);
    const updated = [...current.filter(t => t.id !== tag.id), tag];
    const rootLabel = roots.find(r => r.id === rootId)?.label ?? '';
    await commandSetTagsForRoot(rootId, previousIds, updated.map(t => t.id), rootLabel, () => {
      setRootTagsMap(prev => ({ ...prev, [rootId]: updated }));
    });
    setNewTagName('');
    setNewTagColor('#6366f1');
  }, [newTagName, newTagColor, rootTagsMap, roots]);

  // Bir klasördeki etiketi toggle et
  const handleToggleTag = useCallback((rootId: string, tag: Tag) => {
    const current = rootTagsMap[rootId] ?? [];
    const hasTag = current.some(t => t.id === tag.id);
    const updated = hasTag ? current.filter(t => t.id !== tag.id) : [...current, tag];
    const previousIds = current.map(t => t.id);
    const rootLabel = roots.find(r => r.id === rootId)?.label ?? '';
    void commandSetTagsForRoot(rootId, previousIds, updated.map(t => t.id), rootLabel, () => {
      setRootTagsMap(prev => ({ ...prev, [rootId]: updated }));
    });
  }, [rootTagsMap, roots]);

  const hasRoots = roots.length > 0;
  const hasActiveFilters = activeFilters.length > 0;
  const favorites = roots.filter(r => r.isFavorite);
  const ungrouped = roots.filter(r => !r.isFavorite && !r.groupId);

  // Grup → üyeleri haritası (favoriler hariç)
  const byGroup = new Map<string, ScannedRoot[]>();
  for (const root of roots.filter(r => !r.isFavorite)) {
    if (root.groupId) {
      const arr = byGroup.get(root.groupId) ?? [];
      arr.push(root);
      byGroup.set(root.groupId, arr);
    }
  }

  const renderTreeNode = (node: FolderTreeNode, depth: number): ReactNode => {
    const isActive = activeFilters.includes(node.fullPath);
    const isExpanded = expandedNodes.has(node.fullPath);
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.fullPath}>
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: `3px 8px 3px ${20 + depth * 12}px`,
            borderRadius: 4,
            cursor: 'pointer',
            background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
            border: `1px solid ${isActive ? 'var(--color-accent)' : 'transparent'}`,
            fontSize: '0.7rem',
            color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
            transition: 'background 0.15s',
          }}
          onClick={() => onToggle(node.fullPath)}
          onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.03)'; }}
          onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
          title={node.fullPath}
        >
          <span
            onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleNodeExpand(node.fullPath); }}
            style={{
              display: 'flex', alignItems: 'center', flexShrink: 0,
              width: 12, opacity: hasChildren ? 1 : 0.25, cursor: hasChildren ? 'pointer' : 'default',
            }}
          >
            {hasChildren && (isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
          </span>
          {isActive
            ? <FolderOpen size={12} style={{ color: '#e8a838', flexShrink: 0 }} />
            : <Folder size={12} style={{ color: '#e8a838', flexShrink: 0 }} />}
          <span style={{
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontWeight: isActive ? 600 : 400,
          }}>
            {node.name}
          </span>
          <span style={{ fontSize: '0.6rem', opacity: 0.55, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {node.fileCount}
          </span>
        </div>
        {hasChildren && isExpanded && node.children.map(c => renderTreeNode(c, depth + 1))}
      </div>
    );
  };

  const renderFolderRow = (root: ScannedRoot, indented = false) => {
    const isActive = activeFilters.includes(root.path);
    const isMenuOpen = openMenuId === root.id;
    const isSubMenuOpen = openSubMenuId === root.id;
    const isTagPickerOpen = openTagPickerId === root.id;
    const tags = rootTagsMap[root.id] ?? [];
    const isRootExpanded = expandedRoots.has(root.id);
    const subTree = treeMap.get(root.id) ?? [];
    const hasSubFolders = subTree.length > 0;

    return (
      <div key={root.id}>
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          padding: `5px ${indented ? '4px' : '8px'} 5px ${indented ? '20px' : '8px'}`,
          borderRadius: 4,
          cursor: 'pointer',
          background: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
          border: `1px solid ${isActive ? 'var(--color-accent)' : 'transparent'}`,
          fontSize: '0.72rem',
          color: isActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
          transition: 'background 0.15s',
        }}
        onClick={() => onToggle(root.path)}
        onMouseEnter={(e) => {
          if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)';
        }}
        onMouseLeave={(e) => {
          if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
        }}
        title={root.path}
      >
        <span
          onClick={(e) => { e.stopPropagation(); toggleRootExpand(root.id); }}
          title={isRootExpanded ? t('sidebar.sourceFolders.collapseTree', 'Ağacı kapat') : t('sidebar.sourceFolders.expandTree', 'Ağacı aç')}
          style={{
            display: 'flex', alignItems: 'center', flexShrink: 0,
            width: 13, cursor: 'pointer',
            opacity: hasSubFolders || !isRootExpanded ? 1 : 0.35,
          }}
        >
          {isRootExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        {isActive ? <FolderOpen size={15} style={{ color: '#e8a838' }} /> : <Folder size={15} style={{ color: '#e8a838' }} />}

        <span style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontWeight: isActive ? 600 : 400,
        }}>
          {root.label}
        </span>

        {/* Etiket noktaları */}
        {tags.length > 0 && (
          <span style={{ display: 'flex', gap: 2, alignItems: 'center', flexShrink: 0 }}>
            {tags.map(tag => (
              <span
                key={tag.id}
                title={tag.name}
                style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: tag.color, flexShrink: 0,
                  display: 'inline-block',
                }}
              />
            ))}
          </span>
        )}

        {/* Favori yıldızı */}
        {root.isFavorite && (
          <Star
            size={10}
            fill="currentColor"
            style={{ color: '#f59e0b', flexShrink: 0 }}
          />
        )}

        <span style={{ fontSize: '0.64rem', opacity: 0.6, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
          {root.fileCount}
        </span>

        {canManage && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isMenuOpen) { closeAllMenus(); } else { closeAllMenus(); setOpenMenuId(root.id); }
            }}
            title={t('sidebar.sourceFolders.menu.open')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 2, borderRadius: 3,
              color: 'var(--color-text-muted)',
              display: 'flex', alignItems: 'center', flexShrink: 0,
            }}
          >
            <MoreVertical size={12} />
          </button>
        )}

        {/* Klasör context menüsü */}
        {isMenuOpen && canManage && (
          <div
            style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 2,
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              zIndex: 60, minWidth: 190, overflow: 'visible',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuItem label={t('sidebar.sourceFolders.menu.rename')} onClick={() => { closeAllMenus(); onRename(root); }} />
            <MenuItem label={t('sidebar.sourceFolders.menu.rescan')} onClick={() => { closeAllMenus(); onRescan(root); }} />
            <MenuItem label={t('sidebar.sourceFolders.menu.scanReports', 'Tarama Raporları')} onClick={() => { closeAllMenus(); setReportsModalRoot(root); }} />
            <MenuItem label={t('sidebar.sourceFolders.menu.scanRelations')} onClick={() => { closeAllMenus(); handleScanRelations(); }} />
            {hasAdminFeatures() && (
              <MenuItem label={t('xmp.batchExport')} onClick={async () => {
                closeAllMenus();
                const allAssets = getAllAssets();
                const rootAssets = allAssets.filter(a => a.filePath.startsWith(root.path));
                if (rootAssets.length === 0) return;
                const { addToast } = useStore.getState();
                addToast(t('xmp.batchStarted', { count: rootAssets.length }), 'info');
                try {
                  const result = await writeXmpBatch(rootAssets);
                  let msg = t('xmp.batchDone', { written: result.written, errors: result.errors.length });
                  if (result.fallback > 0) msg += ' ' + t('xmp.fallbackNote', { count: result.fallback });
                  addToast(msg, result.errors.length > 0 ? 'warning' : 'success');
                } catch (err) {
                  notifyError(t('xmp.exportError'), err instanceof Error ? err.message : String(err));
                }
              }} />
            )}

            {/* AI'dan Hariç Tut */}
            {isAdmin && (
              <MenuItem
                label={ragExcludedRoots.has(root.path)
                  ? t('sidebar.ragIncludeFolder')
                  : t('sidebar.ragExcludeFolder')}
                onClick={() => {
                  closeAllMenus();
                  const exclude = !ragExcludedRoots.has(root.path);
                  setFolderRagExcluded(root.path, exclude);
                  setRagExcludedRoots(prev => {
                    const next = new Set(prev);
                    if (exclude) next.add(root.path); else next.delete(root.path);
                    return next;
                  });
                  const { addToast } = useStore.getState();
                  addToast(
                    exclude ? t('sidebar.ragExcludeFolder') : t('sidebar.ragIncludeFolder'),
                    'info'
                  );
                }}
              />
            )}

            {/* Favori toggle */}
            <MenuItem
              label={root.isFavorite
                ? t('sidebar.sourceFolders.favorites.remove')
                : t('sidebar.sourceFolders.favorites.add')}
              onClick={() => { closeAllMenus(); onToggleFavorite(root); }}
            />

            {/* Gruba Taşı — accordion (inline expand) */}
            <div>
              <button
                onClick={(e) => { e.stopPropagation(); setOpenSubMenuId(isSubMenuOpen ? null : root.id); }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', padding: '7px 12px',
                  background: isSubMenuOpen ? 'rgba(255,255,255,0.04)' : 'none',
                  border: 'none', borderBottom: '1px solid var(--color-border)',
                  cursor: 'pointer', fontSize: '0.74rem',
                  color: 'var(--color-text-primary)', textAlign: 'left',
                }}
              >
                <span>{t('sidebar.sourceFolders.menu.moveTo')}</span>
                {isSubMenuOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
              {isSubMenuOpen && (
                <div style={{ background: 'rgba(0,0,0,0.06)' }}>
                  {rootGroups.map(g => (
                    <MenuItem
                      key={g.id}
                      label={g.name}
                      labelPrefix={<span style={{ width: 8, height: 8, borderRadius: '50%', background: g.color, display: 'inline-block', marginRight: 6, flexShrink: 0 }} />}
                      active={root.groupId === g.id}
                      onClick={() => { closeAllMenus(); onSetRootGroup(root, root.groupId === g.id ? null : g.id); }}
                      indent
                    />
                  ))}
                  {root.groupId && (
                    <MenuItem
                      label={t('sidebar.sourceFolders.groups.noGroup')}
                      onClick={() => { closeAllMenus(); onSetRootGroup(root, null); }}
                      indent
                    />
                  )}
                  {rootGroups.length === 0 && (
                    <div style={{ padding: '6px 20px', fontSize: '0.7rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                      {t('sidebar.sourceFolders.groups.noGroup')}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Etiketler */}
            <MenuItem
              label={t('sidebar.sourceFolders.menu.setTags')}
              onClick={(e) => {
                e?.stopPropagation();
                setOpenMenuId(null);
                setOpenSubMenuId(null);
                setOpenTagPickerId(root.id);
              }}
            />

            <MenuItem label={t('sidebar.sourceFolders.menu.remove')} onClick={() => { closeAllMenus(); onRemove(root); }} />
            <MenuItem label={t('sidebar.sourceFolders.menu.deleteWithAssets')} onClick={() => { closeAllMenus(); onDeleteWithAssets(root); }} danger />
          </div>
        )}

        {/* Inline etiket seçici */}
        {isTagPickerOpen && (
          <div
            style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 2,
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              zIndex: 60, minWidth: 200, padding: '8px',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {allTags.length === 0 && (
              <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', padding: '2px 4px', marginBottom: 6 }}>
                {t('sidebar.sourceFolders.tags.noTags')}
              </div>
            )}
            {allTags.map(tag => {
              const assigned = tags.some(t => t.id === tag.id);
              return (
                <button
                  key={tag.id}
                  onClick={() => handleToggleTag(root.id, tag)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    width: '100%', padding: '5px 6px',
                    background: assigned ? 'rgba(99,102,241,0.10)' : 'none',
                    border: 'none', borderRadius: 4, cursor: 'pointer',
                    fontSize: '0.72rem', color: 'var(--color-text-primary)', textAlign: 'left',
                    marginBottom: 2,
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: tag.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{tag.name}</span>
                  {assigned && <span style={{ color: 'var(--color-accent)', fontSize: '0.65rem' }}>✓</span>}
                </button>
              );
            })}
            {/* Yeni etiket */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, borderTop: '1px solid var(--color-border)', paddingTop: 6 }}>
              <input
                type="color"
                value={newTagColor}
                onChange={e => setNewTagColor(e.target.value)}
                style={{ width: 22, height: 22, border: 'none', borderRadius: 3, cursor: 'pointer', padding: 0, flexShrink: 0 }}
              />
              <input
                type="text"
                value={newTagName}
                onChange={e => setNewTagName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateAndAssignTag(root.id); }}
                placeholder={t('sidebar.sourceFolders.tags.newTag')}
                style={{
                  flex: 1, padding: '3px 6px',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 4, fontSize: '0.7rem',
                  color: 'var(--color-text-primary)',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => handleCreateAndAssignTag(root.id)}
                disabled={!newTagName.trim()}
                style={{
                  padding: '3px 7px', background: 'var(--color-accent)',
                  color: '#fff', border: 'none', borderRadius: 4,
                  cursor: newTagName.trim() ? 'pointer' : 'not-allowed',
                  fontSize: '0.7rem', opacity: newTagName.trim() ? 1 : 0.5,
                }}
              >+</button>
            </div>
          </div>
        )}
      </div>
      {isRootExpanded && hasSubFolders && (
        <div style={{ marginLeft: 4 }}>
          {subTree.map(node => renderTreeNode(node, 0))}
        </div>
      )}
      {isRootExpanded && !hasSubFolders && scannedAssets.length > 0 && (
        <div style={{
          padding: '3px 8px 3px 32px', fontSize: '0.65rem',
          color: 'var(--color-text-muted)', fontStyle: 'italic',
        }}>
          {t('sidebar.sourceFolders.noSubFolders', 'Alt klasör yok')}
        </div>
      )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="sidebar-section"
      style={{
        paddingTop: 10, paddingBottom: 10, paddingLeft: 8,
        borderLeft: '2px solid var(--color-accent)',
        background: 'rgba(99,102,241,0.04)',
        borderRadius: '0 4px 4px 0',
      }}
    >
      {/* Panel başlığı */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: collapsed ? 0 : 6 }}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setCollapsed(!collapsed)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(!collapsed); } }}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            flex: 1, cursor: 'pointer',
            fontSize: '0.7rem', color: 'var(--color-text-secondary)',
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
          }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          <FolderTree size={13} style={{ color: 'var(--color-accent)' }} />
          <span>{t('sidebar.sourceFolders.title')}</span>
          {hasRoots && (
            <span style={{
              background: 'var(--color-accent)', color: '#fff',
              fontSize: '0.6rem', padding: '1px 7px',
              borderRadius: 999, fontWeight: 700,
            }}>
              {roots.length}
            </span>
          )}
        </div>
        {canManage && !collapsed && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddGroup(); }}
            title={t('sidebar.sourceFolders.groups.add')}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '1px 5px', borderRadius: 3,
              color: 'var(--color-text-muted)', fontSize: '0.7rem',
              fontWeight: 700,
            }}
          >
            {t('sidebar.sourceFolders.groups.add')}
          </button>
        )}
      </div>

      {!collapsed && (
        <>
          {!hasRoots && (
            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', padding: '8px 6px', fontStyle: 'italic' }}>
              {t('sidebar.sourceFolders.empty')}
            </div>
          )}

          {hasRoots && (
            <>
              {hasActiveFilters && (
                <button
                  onClick={onClearAll}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    width: '100%', padding: '3px 6px', marginBottom: 4,
                    background: 'rgba(99,102,241,0.08)',
                    border: '1px solid rgba(99,102,241,0.25)',
                    borderRadius: 4, cursor: 'pointer',
                    fontSize: '0.66rem', color: 'var(--color-accent)',
                  }}
                >
                  <X size={10} />
                  {t('sidebar.sourceFolders.clearFilters')}
                </button>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

                {/* FAVORİLER bölümü */}
                {favorites.length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setFavCollapsed(v => !v)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFavCollapsed(v => !v); } }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        padding: '3px 8px', fontSize: '0.66rem',
                        color: '#f59e0b', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.04em',
                        cursor: 'pointer', userSelect: 'none',
                      }}
                    >
                      {favCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                      <Star size={10} fill="currentColor" />
                      <span>{t('sidebar.sourceFolders.favorites.section')}</span>
                      <span style={{
                        background: '#f59e0b', color: '#fff',
                        fontSize: '0.58rem', padding: '1px 5px', borderRadius: 999,
                      }}>
                        {favorites.length}
                      </span>
                    </div>
                    {!favCollapsed && favorites.map(root => renderFolderRow(root, true))}
                  </div>
                )}

                {/* GRUP bölümleri */}
                {rootGroups.map(group => {
                  const members = byGroup.get(group.id) ?? [];
                  if (members.length === 0 && !canManage) return null;
                  const allActive = members.length > 0 && members.every(r => activeFilters.includes(r.path));
                  const isGroupMenuOpen = openGroupMenuId === group.id;
                  const isGroupCollapsed = collapsedGroups.has(group.id);

                  return (
                    <div key={group.id} style={{ marginBottom: 2 }}>
                      {/* Grup başlık satırı */}
                      <div
                        style={{
                          position: 'relative',
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '4px 8px', borderRadius: 4, cursor: 'pointer',
                          background: allActive ? 'rgba(99,102,241,0.10)' : 'transparent',
                          border: `1px solid ${allActive ? 'var(--color-accent)' : 'transparent'}`,
                          fontSize: '0.7rem',
                          color: allActive ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                          fontWeight: 700,
                        }}
                        onClick={() => members.length > 0 && onToggleGroup(group.id)}
                        onMouseEnter={(e) => {
                          if (!allActive) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)';
                        }}
                        onMouseLeave={(e) => {
                          if (!allActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent';
                        }}
                      >
                        {/* Kapatma/açma oku */}
                        <span
                          onClick={(e) => { e.stopPropagation(); toggleGroupCollapse(group.id); }}
                          style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                        >
                          {isGroupCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                        </span>
                        {/* Renk noktası */}
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: group.color, flexShrink: 0,
                        }} />
                        <span style={{ flex: 1 }}>{group.name}</span>
                        {members.length > 0 && (
                          <span style={{
                            background: allActive ? 'var(--color-accent)' : 'var(--color-bg-tertiary)',
                            color: allActive ? '#fff' : 'var(--color-text-muted)',
                            fontSize: '0.58rem', padding: '1px 5px', borderRadius: 999,
                          }}>
                            {members.length}
                          </span>
                        )}
                        {canManage && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isGroupMenuOpen) { setOpenGroupMenuId(null); } else { closeAllMenus(); setOpenGroupMenuId(group.id); }
                            }}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              padding: 2, borderRadius: 3,
                              color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center',
                            }}
                          >
                            <MoreVertical size={11} />
                          </button>
                        )}

                        {/* Grup context menüsü */}
                        {isGroupMenuOpen && canManage && (
                          <div
                            style={{
                              position: 'absolute', top: '100%', right: 0, marginTop: 2,
                              background: 'var(--color-bg-primary)',
                              border: '1px solid var(--color-border)',
                              borderRadius: 6,
                              boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                              zIndex: 60, minWidth: 170, overflow: 'hidden',
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MenuItem
                              label={t('sidebar.sourceFolders.groups.rename')}
                              onClick={() => { setOpenGroupMenuId(null); onRenameGroup(group); }}
                            />
                            {/* Renk değiştirici */}
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 8,
                              padding: '7px 12px',
                              borderBottom: '1px solid var(--color-border)',
                              fontSize: '0.74rem', color: 'var(--color-text-primary)',
                            }}>
                              <span style={{ flex: 1 }}>{t('sidebar.sourceFolders.groups.changeColor')}</span>
                              <input
                                type="color"
                                value={group.color}
                                onChange={(e) => onChangeGroupColor(group, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ width: 22, height: 22, border: 'none', borderRadius: 3, cursor: 'pointer', padding: 0 }}
                              />
                            </div>
                            <MenuItem
                              label={t('sidebar.sourceFolders.groups.delete')}
                              onClick={() => { setOpenGroupMenuId(null); onDeleteGroup(group); }}
                              danger
                            />
                          </div>
                        )}
                      </div>

                      {/* Grup üyeleri */}
                      {!isGroupCollapsed && members.map(root => renderFolderRow(root, true))}
                    </div>
                  );
                })}

                {/* GRUPSUZ klasörler */}
                {ungrouped.map(root => renderFolderRow(root, false))}
              </div>
            </>
          )}
        </>
      )}

      {/* Tarama Raporları modal'ı */}
      {reportsModalRoot && (
        <ScanReportsModal
          rootPath={reportsModalRoot.path}
          onClose={() => setReportsModalRoot(null)}
        />
      )}

      {/* İlişki tarama toast bildirimi */}
      {relationScanToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)',
          borderRadius: 8, padding: '8px 16px', fontSize: '0.78rem',
          color: 'var(--color-text-primary)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          zIndex: 9999, pointerEvents: 'none',
        }}>
          {relationScanToast}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label, onClick, danger, active, labelPrefix, indent,
}: {
  label: string;
  onClick: (e?: ReactMouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  active?: boolean;
  labelPrefix?: ReactNode;
  indent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center',
        width: '100%', padding: indent ? '6px 12px 6px 20px' : '7px 12px',
        background: active ? 'rgba(99,102,241,0.10)' : 'none',
        border: 'none', borderBottom: '1px solid var(--color-border)',
        cursor: 'pointer', fontSize: '0.74rem',
        color: danger ? '#ef4444' : active ? 'var(--color-accent)' : 'var(--color-text-primary)',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = danger
          ? 'rgba(239,68,68,0.08)'
          : active ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = active ? 'rgba(99,102,241,0.10)' : 'none';
      }}
    >
      {labelPrefix}
      {label}
    </button>
  );
}
