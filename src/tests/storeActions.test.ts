/**
 * useStore (Zustand) — extended action & state coverage tests
 * Covers: multi-select, sort, rescanning, favorites, user auth,
 *         archive management, root/tag filters, tasks, toasts edge cases,
 *         confirm dialog extras, pending rescan, last scan info, UI flags.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';
import type { Asset } from '../types';
import type { ArchiveDef, ScannedRoot, RootGroup } from '../services/database';
import type { TaskInfo } from '../services/taskRunner';

/* ── helpers ─────────────────────────────────────────────────────────── */

function resetStore() {
  useStore.setState({
    viewMode: 'explorer',
    scannedAssets: [],
    searchQuery: '',
    semanticResults: null,
    activeFilters: {},
    selectedAssetId: null,
    selectedAssetIds: [],
    cardSize: 220,
    sortBy: 'name',
    sortOrder: 'asc',
    rescanningAssetIds: new Set(),
    isScanModalOpen: false,
    isAiConfigOpen: false,
    isAISetupOpen: false,
    isChatOpen: false,
    isVisualSearchOpen: false,
    isShapeSearchOpen: false,
    isRefileModalOpen: false,
    isFeedbackModalOpen: false,
    isScanPaused: false,
    isImageSearching: false,
    dbReady: false,
    storageWarning: false,
    showOnlyFavorites: false,
    favoriteIds: new Set<string>(),
    unreadMessageCount: 0,
    currentUser: null,
    currentRole: null,
    currentUserId: null,
    isLoggedIn: false,
    isBlockedFromMain: false,
    isDeveloper: false,
    isSwitchingUser: false,
    isUserProfileOpen: false,
    isUserManagementOpen: false,
    activeArchive: 'main',
    scannedRoots: [],
    activeRootFilters: [],
    activeTagFilters: [],
    rootGroups: [],
    activeTask: null,
    taskHistory: [],
    toasts: [],
    confirmDialog: null,
    pendingRescanPaths: null,
  });
}

const mkAsset = (id: string, overrides: Partial<Asset> = {}): Asset => ({
  id,
  fileName: `${id}.dwg`,
  filePath: `/project/${id}.dwg`,
  fileSize: 1024,
  fileType: 'DWG',
  category: '2D Çizim',
  createdAt: '2025-01-01T00:00:00',
  modifiedAt: '2025-01-01T00:00:00',
  projectName: 'TestProje',
  projectPhase: 'Konsept',
  aiTags: [],
  colorPalette: [],
  metadata: {},
  isIndexed: true,
  ...overrides,
});

const mkTask = (id: string, overrides: Partial<TaskInfo> = {}): TaskInfo => ({
  id,
  type: 'scan',
  label: `Task ${id}`,
  status: 'running',
  progress: { current: 0, total: 100, percentage: 0 },
  startedAt: new Date().toISOString(),
  elapsedMs: 0,
  estimatedRemainingMs: 0,
  speed: 0,
  ...overrides,
} as TaskInfo);

const mkArchive = (id: string, overrides: Partial<ArchiveDef> = {}): ArchiveDef => ({
  id,
  name: `Archive ${id}`,
  type: 'shared',
  createdAt: new Date().toISOString(),
  color: '#10b981',
  ...overrides,
});

const mkRoot = (path: string, groupId: string | null = null): ScannedRoot => ({
  id: `root-${path}`,
  path,
  label: path.split('/').pop() || path,
  addedAt: new Date().toISOString(),
  lastScan: null,
  fileCount: 0,
  status: 'active',
  groupId,
});

const mkGroup = (id: string, name: string): RootGroup => ({
  id,
  name,
  color: '#3b82f6',
  sortOrder: 0,
  createdAt: new Date().toISOString(),
});

/* ── Multi-selection ──────────────────────────────────────────────────── */

describe('useStore - selectedAssetIds (multi-select)', () => {
  beforeEach(resetStore);

  it('toggleAssetSelection adds an asset', () => {
    useStore.getState().toggleAssetSelection('a1');
    expect(useStore.getState().selectedAssetIds).toEqual(['a1']);
  });

  it('toggleAssetSelection removes an already-selected asset', () => {
    useStore.getState().toggleAssetSelection('a1');
    useStore.getState().toggleAssetSelection('a1');
    expect(useStore.getState().selectedAssetIds).toEqual([]);
  });

  it('toggleAssetSelection accumulates multiple selections', () => {
    useStore.getState().toggleAssetSelection('a1');
    useStore.getState().toggleAssetSelection('a2');
    useStore.getState().toggleAssetSelection('a3');
    expect(useStore.getState().selectedAssetIds).toHaveLength(3);
  });

  it('selectAllAssets replaces current selection', () => {
    useStore.getState().toggleAssetSelection('a1');
    useStore.getState().selectAllAssets(['x1', 'x2', 'x3']);
    expect(useStore.getState().selectedAssetIds).toEqual(['x1', 'x2', 'x3']);
  });

  it('clearAssetSelection empties the array', () => {
    useStore.getState().selectAllAssets(['a1', 'a2']);
    useStore.getState().clearAssetSelection();
    expect(useStore.getState().selectedAssetIds).toEqual([]);
  });

  it('isAssetSelected returns correct boolean', () => {
    useStore.getState().selectAllAssets(['a1', 'a2']);
    expect(useStore.getState().isAssetSelected('a1')).toBe(true);
    expect(useStore.getState().isAssetSelected('a99')).toBe(false);
  });
});

/* ── Sort ──────────────────────────────────────────────────────────────── */

describe('useStore - sortBy / sortOrder', () => {
  beforeEach(resetStore);

  it('setSortBy updates sortBy', () => {
    useStore.getState().setSortBy('date');
    expect(useStore.getState().sortBy).toBe('date');
  });

  it('setSortBy persists to localStorage', () => {
    useStore.getState().setSortBy('size');
    expect(localStorage.getItem('archivist_sort_by')).toBe('size');
  });

  it('setSortOrder updates sortOrder', () => {
    useStore.getState().setSortOrder('desc');
    expect(useStore.getState().sortOrder).toBe('desc');
  });

  it('setSortOrder persists to localStorage', () => {
    useStore.getState().setSortOrder('desc');
    expect(localStorage.getItem('archivist_sort_order')).toBe('desc');
  });

  it('all SortBy values are accepted', () => {
    const values = ['name', 'date', 'type', 'size', 'aiScore'] as const;
    for (const v of values) {
      useStore.getState().setSortBy(v);
      expect(useStore.getState().sortBy).toBe(v);
    }
  });
});

/* ── Rescanning assets ────────────────────────────────────────────────── */

describe('useStore - rescanningAssetIds', () => {
  beforeEach(resetStore);

  it('addRescanningAsset adds an id to the Set', () => {
    useStore.getState().addRescanningAsset('a1');
    expect(useStore.getState().rescanningAssetIds.has('a1')).toBe(true);
  });

  it('addRescanningAsset can add multiple ids', () => {
    useStore.getState().addRescanningAsset('a1');
    useStore.getState().addRescanningAsset('a2');
    expect(useStore.getState().rescanningAssetIds.size).toBe(2);
  });

  it('removeRescanningAsset removes only the specified id', () => {
    useStore.getState().addRescanningAsset('a1');
    useStore.getState().addRescanningAsset('a2');
    useStore.getState().removeRescanningAsset('a1');
    expect(useStore.getState().rescanningAssetIds.has('a1')).toBe(false);
    expect(useStore.getState().rescanningAssetIds.has('a2')).toBe(true);
  });

  it('removing a non-existent id does not throw', () => {
    useStore.getState().removeRescanningAsset('nope');
    expect(useStore.getState().rescanningAssetIds.size).toBe(0);
  });
});

/* ── Favorites ────────────────────────────────────────────────────────── */

describe('useStore - favoriteIds', () => {
  beforeEach(resetStore);

  it('setFavoriteIds replaces entire set', () => {
    useStore.getState().setFavoriteIds(new Set(['f1', 'f2']));
    expect(useStore.getState().favoriteIds.size).toBe(2);
    expect(useStore.getState().favoriteIds.has('f1')).toBe(true);
  });

  it('toggleFavoriteId with value=true adds the id', () => {
    useStore.getState().toggleFavoriteId('f1', true);
    expect(useStore.getState().favoriteIds.has('f1')).toBe(true);
  });

  it('toggleFavoriteId with value=false removes the id', () => {
    useStore.getState().setFavoriteIds(new Set(['f1', 'f2']));
    useStore.getState().toggleFavoriteId('f1', false);
    expect(useStore.getState().favoriteIds.has('f1')).toBe(false);
    expect(useStore.getState().favoriteIds.has('f2')).toBe(true);
  });

  it('showOnlyFavorites toggles correctly', () => {
    useStore.getState().setShowOnlyFavorites(true);
    expect(useStore.getState().showOnlyFavorites).toBe(true);
    useStore.getState().setShowOnlyFavorites(false);
    expect(useStore.getState().showOnlyFavorites).toBe(false);
  });
});

/* ── User auth ────────────────────────────────────────────────────────── */

describe('useStore - user authentication', () => {
  beforeEach(resetStore);

  it('setCurrentUser sets user, role, userId, isLoggedIn', () => {
    useStore.getState().setCurrentUser('ahmet', 'admin', 1);
    const s = useStore.getState();
    expect(s.currentUser).toBe('ahmet');
    expect(s.currentRole).toBe('admin');
    expect(s.currentUserId).toBe(1);
    expect(s.isLoggedIn).toBe(true);
  });

  it('setCurrentUser with null user sets isLoggedIn to false', () => {
    useStore.getState().setCurrentUser('ahmet', 'admin', 1);
    useStore.getState().setCurrentUser(null, null);
    const s = useStore.getState();
    expect(s.currentUser).toBeNull();
    expect(s.isLoggedIn).toBe(false);
  });

  it('setCurrentUser sets isBlockedFromMain and isDeveloper', () => {
    useStore.getState().setCurrentUser('dev', 'viewer', 2, true, true);
    const s = useStore.getState();
    expect(s.isBlockedFromMain).toBe(true);
    expect(s.isDeveloper).toBe(true);
  });

  it('setCurrentUser clears isSwitchingUser', () => {
    useStore.getState().startSwitchUser();
    expect(useStore.getState().isSwitchingUser).toBe(true);
    useStore.getState().setCurrentUser('new', 'viewer', 3);
    expect(useStore.getState().isSwitchingUser).toBe(false);
  });

  it('setIsBlockedFromMain updates the flag', () => {
    useStore.getState().setIsBlockedFromMain(true);
    expect(useStore.getState().isBlockedFromMain).toBe(true);
  });

  it('logout resets all user state', () => {
    useStore.getState().setCurrentUser('ahmet', 'admin', 1, false, true);
    useStore.getState().logout();
    const s = useStore.getState();
    expect(s.currentUser).toBeNull();
    expect(s.currentRole).toBeNull();
    expect(s.currentUserId).toBeNull();
    expect(s.isLoggedIn).toBe(false);
    expect(s.isBlockedFromMain).toBe(false);
    expect(s.isDeveloper).toBe(false);
    expect(s.isSwitchingUser).toBe(false);
  });

  it('startSwitchUser / cancelSwitchUser toggle the flag', () => {
    useStore.getState().startSwitchUser();
    expect(useStore.getState().isSwitchingUser).toBe(true);
    useStore.getState().cancelSwitchUser();
    expect(useStore.getState().isSwitchingUser).toBe(false);
  });
});

/* ── Archive management ───────────────────────────────────────────────── */

describe('useStore - archive management', () => {
  beforeEach(resetStore);

  it('setActiveArchive updates and persists', () => {
    useStore.getState().setActiveArchive('local');
    expect(useStore.getState().activeArchive).toBe('local');
    expect(localStorage.getItem('archivist_active_archive')).toBe('local');
  });

  it('setArchives replaces archives and persists', () => {
    const defs = [mkArchive('a1'), mkArchive('a2')];
    useStore.getState().setArchives(defs);
    expect(useStore.getState().archives).toHaveLength(2);
    const stored = JSON.parse(localStorage.getItem('archivist_archives') || '[]');
    expect(stored).toHaveLength(2);
  });

  it('addArchive appends to existing archives', () => {
    useStore.getState().setArchives([mkArchive('main')]);
    useStore.getState().addArchive(mkArchive('extra'));
    expect(useStore.getState().archives).toHaveLength(2);
    expect(useStore.getState().archives[1].id).toBe('extra');
  });

  it('removeArchive filters out by id', () => {
    useStore.getState().setArchives([mkArchive('main'), mkArchive('local'), mkArchive('extra')]);
    useStore.getState().removeArchive('extra');
    expect(useStore.getState().archives).toHaveLength(2);
    expect(useStore.getState().archives.find(a => a.id === 'extra')).toBeUndefined();
  });

  it('updateArchive updates name and color', () => {
    useStore.getState().setArchives([mkArchive('main', { name: 'Old', color: '#000' })]);
    useStore.getState().updateArchive('main', { name: 'New Name', color: '#fff' });
    const a = useStore.getState().archives.find(x => x.id === 'main');
    expect(a?.name).toBe('New Name');
    expect(a?.color).toBe('#fff');
  });

  it('updateArchive does not affect non-matching archives', () => {
    useStore.getState().setArchives([mkArchive('a'), mkArchive('b', { name: 'B' })]);
    useStore.getState().updateArchive('a', { name: 'Updated A' });
    expect(useStore.getState().archives.find(x => x.id === 'b')?.name).toBe('B');
  });
});

/* ── ScannedRoots & root filters ──────────────────────────────────────── */

describe('useStore - scannedRoots & root filters', () => {
  beforeEach(resetStore);

  it('setScannedRoots sets roots', () => {
    useStore.getState().setScannedRoots([mkRoot('/a'), mkRoot('/b')]);
    expect(useStore.getState().scannedRoots).toHaveLength(2);
  });

  it('setActiveRootFilters replaces filters', () => {
    useStore.getState().setActiveRootFilters(['/a', '/b']);
    expect(useStore.getState().activeRootFilters).toEqual(['/a', '/b']);
  });

  it('toggleRootFilter adds a path', () => {
    useStore.getState().toggleRootFilter('/a');
    expect(useStore.getState().activeRootFilters).toContain('/a');
  });

  it('toggleRootFilter removes an already-active path', () => {
    useStore.getState().toggleRootFilter('/a');
    useStore.getState().toggleRootFilter('/a');
    expect(useStore.getState().activeRootFilters).not.toContain('/a');
  });

  it('clearRootFilters empties the array', () => {
    useStore.getState().setActiveRootFilters(['/a', '/b']);
    useStore.getState().clearRootFilters();
    expect(useStore.getState().activeRootFilters).toEqual([]);
  });
});

/* ── Tag filters ──────────────────────────────────────────────────────── */

describe('useStore - tag filters', () => {
  beforeEach(resetStore);

  it('toggleTagFilter adds a tag id', () => {
    useStore.getState().toggleTagFilter(1);
    expect(useStore.getState().activeTagFilters).toContain(1);
  });

  it('toggleTagFilter removes already-active tag', () => {
    useStore.getState().toggleTagFilter(1);
    useStore.getState().toggleTagFilter(1);
    expect(useStore.getState().activeTagFilters).not.toContain(1);
  });

  it('multiple tags can be active', () => {
    useStore.getState().toggleTagFilter(1);
    useStore.getState().toggleTagFilter(2);
    useStore.getState().toggleTagFilter(3);
    expect(useStore.getState().activeTagFilters).toHaveLength(3);
  });

  it('clearTagFilters empties the array', () => {
    useStore.getState().toggleTagFilter(1);
    useStore.getState().toggleTagFilter(2);
    useStore.getState().clearTagFilters();
    expect(useStore.getState().activeTagFilters).toEqual([]);
  });
});

/* ── Root groups & toggleGroupFilter ──────────────────────────────────── */

describe('useStore - rootGroups & toggleGroupFilter', () => {
  beforeEach(resetStore);

  it('setRootGroups sets groups', () => {
    useStore.getState().setRootGroups([mkGroup('g1', 'Group 1')]);
    expect(useStore.getState().rootGroups).toHaveLength(1);
    expect(useStore.getState().rootGroups[0].name).toBe('Group 1');
  });

  it('toggleGroupFilter activates all roots in the group', () => {
    useStore.getState().setScannedRoots([
      mkRoot('/a', 'g1'),
      mkRoot('/b', 'g1'),
      mkRoot('/c', 'g2'),
    ]);
    useStore.getState().toggleGroupFilter('g1');
    expect(useStore.getState().activeRootFilters).toEqual(
      expect.arrayContaining(['/a', '/b'])
    );
    expect(useStore.getState().activeRootFilters).not.toContain('/c');
  });

  it('toggleGroupFilter deactivates when all group roots are already active', () => {
    useStore.getState().setScannedRoots([mkRoot('/a', 'g1'), mkRoot('/b', 'g1')]);
    // Activate all roots in g1
    useStore.getState().toggleGroupFilter('g1');
    expect(useStore.getState().activeRootFilters).toHaveLength(2);
    // Toggle again — removes them
    useStore.getState().toggleGroupFilter('g1');
    expect(useStore.getState().activeRootFilters).toHaveLength(0);
  });

  it('toggleGroupFilter with no matching roots is a no-op (all active = false for empty)', () => {
    useStore.getState().setScannedRoots([mkRoot('/a', 'g2')]);
    useStore.getState().toggleGroupFilter('g1');
    // No roots match g1 => paths.length === 0 => allActive is false => union (still empty)
    expect(useStore.getState().activeRootFilters).toEqual([]);
  });

  it('toggleGroupFilter merges with existing root filters', () => {
    useStore.getState().setScannedRoots([mkRoot('/a', 'g1'), mkRoot('/b', 'g2')]);
    useStore.getState().setActiveRootFilters(['/b']);
    useStore.getState().toggleGroupFilter('g1');
    expect(useStore.getState().activeRootFilters).toEqual(
      expect.arrayContaining(['/a', '/b'])
    );
  });
});

/* ── Task management ──────────────────────────────────────────────────── */

describe('useStore - task management', () => {
  beforeEach(resetStore);

  it('setActiveTask sets the active task', () => {
    const t = mkTask('t1');
    useStore.getState().setActiveTask(t);
    expect(useStore.getState().activeTask).toEqual(t);
  });

  it('setActiveTask(null) clears it', () => {
    useStore.getState().setActiveTask(mkTask('t1'));
    useStore.getState().setActiveTask(null);
    expect(useStore.getState().activeTask).toBeNull();
  });

  it('setTaskHistory replaces entire history', () => {
    useStore.getState().setTaskHistory([mkTask('t1'), mkTask('t2')]);
    expect(useStore.getState().taskHistory).toHaveLength(2);
  });

  it('addToTaskHistory prepends to existing history', () => {
    useStore.getState().setTaskHistory([mkTask('t1')]);
    useStore.getState().addToTaskHistory(mkTask('t2'));
    expect(useStore.getState().taskHistory).toHaveLength(2);
    expect(useStore.getState().taskHistory[0].id).toBe('t2');
  });

  it('removeFromTaskHistory removes by id', () => {
    useStore.getState().setTaskHistory([mkTask('t1'), mkTask('t2'), mkTask('t3')]);
    useStore.getState().removeFromTaskHistory('t2');
    expect(useStore.getState().taskHistory).toHaveLength(2);
    expect(useStore.getState().taskHistory.find(t => t.id === 't2')).toBeUndefined();
  });

  it('clearTaskHistory empties the array', () => {
    useStore.getState().setTaskHistory([mkTask('t1'), mkTask('t2')]);
    useStore.getState().clearTaskHistory();
    expect(useStore.getState().taskHistory).toEqual([]);
  });
});

/* ── Toast edge cases ─────────────────────────────────────────────────── */

describe('useStore - toast edge cases', () => {
  beforeEach(resetStore);

  it('addToast caps at 5 toasts (oldest dropped)', () => {
    for (let i = 0; i < 7; i++) {
      useStore.getState().addToast(`msg-${i}`);
    }
    const toasts = useStore.getState().toasts;
    expect(toasts).toHaveLength(5);
    // The first two (msg-0, msg-1) should have been dropped
    expect(toasts[0].message).toBe('msg-2');
    expect(toasts[4].message).toBe('msg-6');
  });

  it('removeToast with non-existent id is harmless', () => {
    useStore.getState().addToast('a');
    useStore.getState().removeToast('does-not-exist');
    expect(useStore.getState().toasts).toHaveLength(1);
  });
});

/* ── Confirm dialog extras ────────────────────────────────────────────── */

describe('useStore - confirmDialog (extended)', () => {
  beforeEach(resetStore);

  it('showConfirmDialog stores confirmLabel and isDanger', () => {
    useStore.getState().showConfirmDialog('Delete?', 'details', () => {}, 'Yes delete', true);
    const d = useStore.getState().confirmDialog!;
    expect(d.confirmLabel).toBe('Yes delete');
    expect(d.isDanger).toBe(true);
  });

  it('showConfirmDialog stores hideCancel', () => {
    useStore.getState().showConfirmDialog('Info', undefined, () => {}, undefined, false, true);
    expect(useStore.getState().confirmDialog!.hideCancel).toBe(true);
  });
});

/* ── Pending rescan paths ─────────────────────────────────────────────── */

describe('useStore - pendingRescanPaths', () => {
  beforeEach(resetStore);

  it('setPendingRescanPaths sets paths', () => {
    useStore.getState().setPendingRescanPaths(['/a', '/b']);
    expect(useStore.getState().pendingRescanPaths).toEqual(['/a', '/b']);
  });

  it('setPendingRescanPaths(null) clears', () => {
    useStore.getState().setPendingRescanPaths(['/a']);
    useStore.getState().setPendingRescanPaths(null);
    expect(useStore.getState().pendingRescanPaths).toBeNull();
  });
});

/* ── Last scan info ───────────────────────────────────────────────────── */

describe('useStore - lastScanInfo', () => {
  beforeEach(resetStore);

  it('setLastScanInfo stores info for an archive', () => {
    const info = { durationMs: 5000, fileCount: 120, completedAt: '2025-06-01T12:00:00Z' };
    useStore.getState().setLastScanInfo(info, 'main');
    expect(useStore.getState().lastScanInfoMap['main']).toEqual(info);
  });

  it('setLastScanInfo persists to localStorage', () => {
    const info = { durationMs: 3000, fileCount: 50, completedAt: '2025-06-01T13:00:00Z' };
    useStore.getState().setLastScanInfo(info, 'local');
    const stored = localStorage.getItem('archivist_last_scan_info_local');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!)).toEqual(info);
  });

  it('setLastScanInfo(null) removes from localStorage', () => {
    const info = { durationMs: 1000, fileCount: 10, completedAt: '2025-06-01T14:00:00Z' };
    useStore.getState().setLastScanInfo(info, 'main');
    useStore.getState().setLastScanInfo(null, 'main');
    expect(useStore.getState().lastScanInfoMap['main']).toBeNull();
    expect(localStorage.getItem('archivist_last_scan_info_main')).toBeNull();
  });
});

/* ── Additional UI modal/panel flags ──────────────────────────────────── */

describe('useStore - additional UI flags', () => {
  beforeEach(resetStore);

  it('isChatOpen toggles', () => {
    useStore.getState().setIsChatOpen(true);
    expect(useStore.getState().isChatOpen).toBe(true);
    useStore.getState().setIsChatOpen(false);
    expect(useStore.getState().isChatOpen).toBe(false);
  });

  it('isVisualSearchOpen toggles', () => {
    useStore.getState().setIsVisualSearchOpen(true);
    expect(useStore.getState().isVisualSearchOpen).toBe(true);
  });

  it('isShapeSearchOpen toggles', () => {
    useStore.getState().setIsShapeSearchOpen(true);
    expect(useStore.getState().isShapeSearchOpen).toBe(true);
  });

  it('isAISetupOpen toggles', () => {
    useStore.getState().setIsAISetupOpen(true);
    expect(useStore.getState().isAISetupOpen).toBe(true);
  });

  it('isFeedbackModalOpen toggles', () => {
    useStore.getState().setIsFeedbackModalOpen(true);
    expect(useStore.getState().isFeedbackModalOpen).toBe(true);
  });

  it('unreadMessageCount updates', () => {
    useStore.getState().setUnreadMessageCount(5);
    expect(useStore.getState().unreadMessageCount).toBe(5);
  });

  it('isUserProfileOpen toggles', () => {
    useStore.getState().setIsUserProfileOpen(true);
    expect(useStore.getState().isUserProfileOpen).toBe(true);
  });

  it('isUserManagementOpen toggles', () => {
    useStore.getState().setIsUserManagementOpen(true);
    expect(useStore.getState().isUserManagementOpen).toBe(true);
  });
});

/* ── facetConfig ──────────────────────────────────────────────────────── */

describe('useStore - facetConfig', () => {
  beforeEach(resetStore);

  it('setFacetConfig replaces the config', () => {
    const config = [
      { key: 'category' as const, label: 'Kategori', visible: false, order: 0 },
    ];
    useStore.getState().setFacetConfig(config);
    expect(useStore.getState().facetConfig).toEqual(config);
  });
});

/* ── setScannedAssets updater edge case ────────────────────────────────── */

describe('useStore - setScannedAssets updater function', () => {
  beforeEach(resetStore);

  it('updater function can filter assets', () => {
    useStore.getState().setScannedAssets([mkAsset('a1'), mkAsset('a2'), mkAsset('a3')]);
    useStore.getState().setScannedAssets(prev => prev.filter(a => a.id !== 'a2'));
    expect(useStore.getState().scannedAssets).toHaveLength(2);
    expect(useStore.getState().scannedAssets.find(a => a.id === 'a2')).toBeUndefined();
  });

  it('updater function can update an asset', () => {
    useStore.getState().setScannedAssets([mkAsset('a1', { fileName: 'old.dwg' })]);
    useStore.getState().setScannedAssets(prev =>
      prev.map(a => a.id === 'a1' ? { ...a, fileName: 'new.dwg' } : a)
    );
    expect(useStore.getState().scannedAssets[0].fileName).toBe('new.dwg');
  });
});

/* ── setActiveFilters functional update ───────────────────────────────── */

describe('useStore - setActiveFilters functional update', () => {
  beforeEach(resetStore);

  it('functional update can clear a single facet key', () => {
    useStore.getState().setActiveFilters({ category: ['Render'], projectPhase: ['Konsept'] });
    useStore.getState().setActiveFilters(prev => {
      const next = { ...prev };
      delete next.category;
      return next;
    });
    expect(useStore.getState().activeFilters.category).toBeUndefined();
    expect(useStore.getState().activeFilters.projectPhase).toEqual(['Konsept']);
  });
});

/* ── setAiConfig functional update edge ───────────────────────────────── */

describe('useStore - setAiConfig functional update', () => {
  beforeEach(resetStore);

  it('functional update preserves other fields', () => {
    useStore.getState().setAiConfig({
      mode: 'cloud',
      apiProvider: 'ollama',
      apiKey: '',
      apiUrl: 'http://localhost:11434/v1/chat/completions',
      chatModel: 'qwen3:4b',
      visionModel: 'llava',
    });
    useStore.getState().setAiConfig(prev => ({ ...prev, chatModel: 'llama3' }));
    const cfg = useStore.getState().aiConfig;
    expect(cfg.chatModel).toBe('llama3');
    expect(cfg.apiProvider).toBe('ollama');
    expect(cfg.visionModel).toBe('llava');
  });
});

/* ── setSemanticResults functional edge ───────────────────────────────── */

describe('useStore - setSemanticResults functional from null', () => {
  beforeEach(resetStore);

  it('functional update from null returns null when callback returns null', () => {
    useStore.getState().setSemanticResults(null);
    useStore.getState().setSemanticResults(prev => prev);
    expect(useStore.getState().semanticResults).toBeNull();
  });
});

/* ── searchSensitivity ────────────────────────────────────────────────── */

describe('useStore - searchSensitivity edge', () => {
  beforeEach(resetStore);

  it('multiple sequential updates yield final value', () => {
    useStore.getState().setSearchSensitivity(10);
    useStore.getState().setSearchSensitivity(50);
    useStore.getState().setSearchSensitivity(90);
    expect(useStore.getState().searchSensitivity).toBe(90);
  });
});
