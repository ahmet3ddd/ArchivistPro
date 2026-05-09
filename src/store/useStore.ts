import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { debugLog } from '../services/logger';
import type { Asset, ViewMode, SortBy, SortOrder, FacetKey } from '../types';
import type { FacetConfig } from '../components/SidebarConfigModal';
import type { AIConfig } from '../components/AISettingsModal';
import type { ToastItem, ToastType } from '../components/Toast';
import { FACET_GROUPS } from '../data';
import { type ArchiveType } from '../services/database';
import type { TaskInfo } from '../services/taskRunner';
import { type ModalSlice, createModalSlice } from './slices/modalSlice';
import { type AuthSlice, createAuthSlice } from './slices/authSlice';
import { type ArchiveSlice, createArchiveSlice, loadArchives } from './slices/archiveSlice';
import { DEFAULT_CHAT_MODEL, DEFAULT_VISION_MODEL, isVisionModel } from '../services/ollamaService';

export interface FilterPreset {
  id: string;
  name: string;
  activeFilters: Partial<Record<FacetKey, string[]>>;
  viewMode?: ViewMode;
  sortBy?: SortBy;
  sortOrder?: SortOrder;
  createdAt: string;
  // Faz 4.4 — genişletilmiş preset alanları
  activeTagFilters?: number[];
  searchQuery?: string;
  dateRangeFilter?: { from: string | null; to: string | null };
}

function loadFilterPresets(): FilterPreset[] {
  try {
    const saved = localStorage.getItem('archivist_filter_presets');
    return saved ? JSON.parse(saved) : [];
  } catch { return []; }
}

function persistFilterPresets(presets: FilterPreset[]) {
  localStorage.setItem('archivist_filter_presets', JSON.stringify(presets));
}

const defaultAiConfig: AIConfig = {
  mode: 'cloud',
  apiProvider: 'ollama',
  apiKey: '',
  apiUrl: 'http://localhost:11434/v1/chat/completions',
  chatModel: DEFAULT_CHAT_MODEL,
  visionModel: DEFAULT_VISION_MODEL,
};

export interface LastScanInfo {
  durationMs: number;
  fileCount: number;
  completedAt: string; // ISO 8601
  typeAvgMs?: Record<string, number>; // uzantı bazlı ortalama ms/dosya (ileriki taramalarda tip-ağırlıklı ETA için)
}

export interface AutoRagIndexProgress {
  current: number;
  total: number;
  currentFile: string;
  succeeded: number;
  skipped: number;
  failed: number;
}

function loadLastScanInfo(archive: ArchiveType): LastScanInfo | null {
  try {
    const s = localStorage.getItem(`archivist_last_scan_info_${archive}`);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

function loadFolderScanDurations(): Record<string, LastScanInfo> {
  try {
    const s = localStorage.getItem('archivist_folder_scan_durations');
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

// loadActiveArchive, loadArchives → store/slices/archiveSlice.ts

function loadCardSize(): number {
  if (typeof localStorage === 'undefined') return 220;
  const saved = localStorage.getItem('cardSize');
  return saved ? parseInt(saved, 10) : 220;
}

function loadFacetConfig(): FacetConfig[] {
  if (typeof localStorage === 'undefined') {
    return FACET_GROUPS.map((g, i) => ({
      key: g.key,
      label: g.label,
      visible: true,
      order: i,
    }));
  }
  const saved = localStorage.getItem('archivist_facet_config');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      /* fallback */
    }
  }
  return FACET_GROUPS.map((g, i) => ({
    key: g.key,
    label: g.label,
    visible: true,
    order: i,
  }));
}

function loadAiConfig(): AIConfig {
  if (typeof localStorage === 'undefined') return defaultAiConfig;
  const saved = localStorage.getItem('archivist_ai_config');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      // localStorage'dan okunan config'te apiKey olmamalı (güvenlik)
      delete parsed.apiKey;

      // Migration: eski ollamaModel → yeni chatModel + visionModel
      if (parsed.ollamaModel && !parsed.chatModel && !parsed.visionModel) {
        if (isVisionModel(parsed.ollamaModel)) {
          parsed.visionModel = parsed.ollamaModel;
          parsed.chatModel = DEFAULT_CHAT_MODEL;
        } else {
          parsed.chatModel = parsed.ollamaModel;
        }
      }

      return { ...defaultAiConfig, ...parsed };
    } catch {
      debugLog('Store', 'Failed to parse saved ai config');
    }
  }
  return defaultAiConfig;
}

function loadSearchSensitivity(): number {
  if (typeof localStorage === 'undefined') return 70;
  const saved = localStorage.getItem('archivist_search_sensitivity');
  return saved ? parseInt(saved, 10) : 70;
}

interface AppState extends ModalSlice, AuthSlice, ArchiveSlice {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;

  scannedAssets: Asset[];
  setScannedAssets: (assets: Asset[] | ((prev: Asset[]) => Asset[])) => void;

  searchQuery: string;
  setSearchQuery: (query: string) => void;

  semanticResults: Array<{ assetId: string; score: number; chunkId?: string }> | null;
  setSemanticResults: (
    results:
      | Array<{ assetId: string; score: number; chunkId?: string }> | null
      | ((
          prev: Array<{ assetId: string; score: number; chunkId?: string }> | null
        ) => Array<{ assetId: string; score: number; chunkId?: string }> | null)
  ) => void;

  activeFilters: Partial<Record<FacetKey, string[]>>;
  setActiveFilters: (
    filters:
      | Partial<Record<FacetKey, string[]>>
      | ((prev: Partial<Record<FacetKey, string[]>>) => Partial<Record<FacetKey, string[]>>)
  ) => void;
  toggleFacetFilter: (key: FacetKey, value: string) => void;

  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;

  selectedAssetIds: string[];
  toggleAssetSelection: (id: string) => void;
  selectAllAssets: (ids: string[]) => void;
  clearAssetSelection: () => void;
  isAssetSelected: (id: string) => boolean;

  cardSize: number;
  setCardSize: (n: number) => void;

  sortBy: SortBy;
  setSortBy: (s: SortBy) => void;
  sortOrder: SortOrder;
  setSortOrder: (s: SortOrder) => void;

  rescanningAssetIds: Set<string>;
  addRescanningAsset: (id: string) => void;
  removeRescanningAsset: (id: string) => void;

  facetConfig: FacetConfig[];
  setFacetConfig: (config: FacetConfig[]) => void;

  aiConfig: AIConfig;
  setAiConfig: (config: AIConfig | ((prev: AIConfig) => AIConfig)) => void;

  searchSensitivity: number;
  setSearchSensitivity: (n: number) => void;

  /** Aktif tarama var mı — session timeout bu sırada devre dışı kalır. */
  isScanInProgress: boolean;
  setIsScanInProgress: (running: boolean) => void;
  /** GPU tespiti: null=henüz kontrol edilmedi, true=var, false=yok */
  gpuAvailable: boolean | null;
  setGpuAvailable: (v: boolean | null) => void;

  favoriteIds: Set<string>;
  setFavoriteIds: (ids: Set<string>) => void;
  toggleFavoriteId: (id: string, value: boolean) => void;

  unreadMessageCount: number;
  setUnreadMessageCount: (n: number) => void;

  isScanPaused: boolean;
  setIsScanPaused: (v: boolean) => void;
  isImageSearching: boolean;
  setIsImageSearching: (v: boolean) => void;
  /** Görsel arama sonuçları aktif mi — arama kutusu temiz olsa bile
   *  visual-vector modu açık tutar, sensitivity slider görünür kalır. */
  imageSearchActive: boolean;
  setImageSearchActive: (v: boolean) => void;

  dbReady: boolean;
  setDbReady: (v: boolean) => void;

  storageWarning: boolean;
  setStorageWarning: (v: boolean) => void;

  showOnlyFavorites: boolean;
  setShowOnlyFavorites: (v: boolean) => void;

  filterPresets: FilterPreset[];
  saveFilterPreset: (name: string) => void;
  loadFilterPreset: (id: string) => void;
  deleteFilterPreset: (id: string) => void;

  activeTask: TaskInfo | null;
  setActiveTask: (task: TaskInfo | null) => void;
  taskHistory: TaskInfo[];
  setTaskHistory: (history: TaskInfo[]) => void;
  addToTaskHistory: (task: TaskInfo) => void;
  removeFromTaskHistory: (taskId: string) => void;
  clearTaskHistory: () => void;

  toasts: ToastItem[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;

  pendingRescanPaths: string[] | null;
  setPendingRescanPaths: (paths: string[] | null) => void;

  /** Staleness check: aktif arşivdeki asset'lerin güncellik durumu */
  stalenessCheck: {
    status: 'idle' | 'checking' | 'done' | 'error';
    staleIds: Set<string>;
    missingIds: Set<string>;
    versionOutdatedIds: Set<string>;
    lastCheckedAt: number | null;
    progress: { done: number; total: number } | null;
  };
  setStalenessStatus: (status: 'idle' | 'checking' | 'done' | 'error') => void;
  setStalenessProgress: (done: number, total: number) => void;
  setStalenessResult: (staleIds: Set<string>, missingIds: Set<string>, versionOutdatedIds: Set<string>) => void;
  resetStaleness: () => void;

  lastScanInfoMap: Record<ArchiveType, LastScanInfo | null>;
  setLastScanInfo: (info: LastScanInfo | null, archive: ArchiveType) => void;
  folderScanDurations: Record<string, LastScanInfo>;
  setFolderScanDuration: (folderPath: string, info: LastScanInfo) => void;

  /** Tarama sonrası otomatik RAG indeksleme — banner ve durdurma butonu için */
  autoRagIndexProgress: AutoRagIndexProgress | null;
  setAutoRagIndexProgress: (p: AutoRagIndexProgress | null) => void;
  /** Aktif indeksleme işinin iptal handle'ı — banner Durdur ve modal İptal aynı kanaldan tetikler */
  autoRagIndexCancel: (() => void) | null;
  setAutoRagIndexCancel: (fn: (() => void) | null) => void;
}

export const useStore: UseBoundStore<StoreApi<AppState>> = create<AppState>((set, get) => ({
  ...createModalSlice(set),
  ...createAuthSlice(set),
  ...createArchiveSlice(set, get),
  viewMode: 'explorer',
  setViewMode: (viewMode) => set({ viewMode }),

  scannedAssets: [],
  setScannedAssets: (update) =>
    set((state) => ({
      scannedAssets: typeof update === 'function' ? update(state.scannedAssets) : update,
    })),

  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  semanticResults: null,
  setSemanticResults: (update) =>
    set((state) => ({
      semanticResults:
        typeof update === 'function' ? update(state.semanticResults) : update,
    })),

  activeFilters: {},
  setActiveFilters: (update) =>
    set((state) => ({
      activeFilters: typeof update === 'function' ? update(state.activeFilters) : update,
    })),

  toggleFacetFilter: (key, value) =>
    set((state) => {
      const current = state.activeFilters[key] || [];
      const updated = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { activeFilters: { ...state.activeFilters, [key]: updated } };
    }),

  selectedAssetId: null,
  setSelectedAssetId: (selectedAssetId) => set({ selectedAssetId }),

  selectedAssetIds: [],
  toggleAssetSelection: (id) =>
    set((state) => {
      const exists = state.selectedAssetIds.includes(id);
      return {
        selectedAssetIds: exists
          ? state.selectedAssetIds.filter((x) => x !== id)
          : [...state.selectedAssetIds, id],
      };
    }),
  selectAllAssets: (ids) => set({ selectedAssetIds: [...ids] }),
  clearAssetSelection: () => set({ selectedAssetIds: [] }),
  isAssetSelected: (id) => useStore.getState().selectedAssetIds.includes(id),

  cardSize: loadCardSize(),
  setCardSize: (cardSize) => set({ cardSize }),

  sortBy: (localStorage.getItem('archivist_sort_by') as SortBy) || 'name',
  setSortBy: (sortBy) => { set({ sortBy }); localStorage.setItem('archivist_sort_by', sortBy); },
  sortOrder: (localStorage.getItem('archivist_sort_order') as SortOrder) || 'asc',
  setSortOrder: (sortOrder) => { set({ sortOrder }); localStorage.setItem('archivist_sort_order', sortOrder); },

  rescanningAssetIds: new Set(),
  addRescanningAsset: (id) => set((s) => ({ rescanningAssetIds: new Set([...s.rescanningAssetIds, id]) })),
  removeRescanningAsset: (id) => set((s) => { const next = new Set(s.rescanningAssetIds); next.delete(id); return { rescanningAssetIds: next }; }),

  facetConfig: loadFacetConfig(),
  setFacetConfig: (facetConfig) => set({ facetConfig }),

  aiConfig: loadAiConfig(),
  setAiConfig: (config) =>
    set((state) => ({
      aiConfig: typeof config === 'function' ? config(state.aiConfig) : config,
    })),

  searchSensitivity: loadSearchSensitivity(),
  setSearchSensitivity: (searchSensitivity) => set({ searchSensitivity }),

  isScanInProgress: false,
  setIsScanInProgress: (isScanInProgress) => set({ isScanInProgress }),
  gpuAvailable: null,
  setGpuAvailable: (gpuAvailable) => set({ gpuAvailable }),
  favoriteIds: new Set<string>(),
  setFavoriteIds: (favoriteIds) => set({ favoriteIds: new Set(favoriteIds) }),
  toggleFavoriteId: (id, value) => set((state) => {
    const next = new Set(state.favoriteIds);
    if (value) next.add(id); else next.delete(id);
    return { favoriteIds: next };
  }),
  unreadMessageCount: 0,
  setUnreadMessageCount: (unreadMessageCount) => set({ unreadMessageCount }),

  isScanPaused: false,
  setIsScanPaused: (isScanPaused) => set({ isScanPaused }),
  isImageSearching: false,
  setIsImageSearching: (isImageSearching) => set({ isImageSearching }),
  imageSearchActive: false,
  setImageSearchActive: (imageSearchActive) => set({ imageSearchActive }),

  dbReady: false,
  setDbReady: (dbReady) => set({ dbReady }),

  storageWarning: false,
  setStorageWarning: (storageWarning) => set({ storageWarning }),

  showOnlyFavorites: false,
  setShowOnlyFavorites: (showOnlyFavorites) => set({ showOnlyFavorites }),


  filterPresets: loadFilterPresets(),
  saveFilterPreset: (name) => set((state) => {
    const preset: FilterPreset = {
      id: `fp_${Date.now()}`,
      name,
      activeFilters: { ...state.activeFilters },
      viewMode: state.viewMode,
      sortBy: state.sortBy,
      sortOrder: state.sortOrder,
      createdAt: new Date().toISOString(),
      // Faz 4.4 — genişletilmiş alanlar
      activeTagFilters: state.activeTagFilters.length > 0 ? [...state.activeTagFilters] : undefined,
      searchQuery: state.searchQuery || undefined,
      dateRangeFilter: (state.dateRangeFilter.from || state.dateRangeFilter.to) ? { ...state.dateRangeFilter } : undefined,
    };
    const next = [...state.filterPresets, preset];
    persistFilterPresets(next);
    return { filterPresets: next };
  }),
  loadFilterPreset: (id) => set((state) => {
    const preset = state.filterPresets.find(p => p.id === id);
    if (!preset) return {};
    const updates: Partial<AppState> = { activeFilters: { ...preset.activeFilters } };
    if (preset.viewMode) updates.viewMode = preset.viewMode;
    if (preset.sortBy) updates.sortBy = preset.sortBy;
    if (preset.sortOrder) updates.sortOrder = preset.sortOrder;
    // Faz 4.4 — genişletilmiş alanları yükle
    if (preset.activeTagFilters) updates.activeTagFilters = preset.activeTagFilters;
    if (preset.searchQuery != null) updates.searchQuery = preset.searchQuery;
    if (preset.dateRangeFilter) updates.dateRangeFilter = preset.dateRangeFilter;
    return updates;
  }),
  deleteFilterPreset: (id) => set((state) => {
    const next = state.filterPresets.filter(p => p.id !== id);
    persistFilterPresets(next);
    return { filterPresets: next };
  }),

  activeTask: null,
  setActiveTask: (activeTask) => set({ activeTask }),
  taskHistory: [],
  setTaskHistory: (taskHistory) => set({ taskHistory }),
  addToTaskHistory: (task) => set((state) => ({ taskHistory: [task, ...state.taskHistory] })),
  removeFromTaskHistory: (taskId) =>
    set((state) => ({ taskHistory: state.taskHistory.filter((t) => t.id !== taskId) })),
  clearTaskHistory: () => set({ taskHistory: [] }),

  toasts: [],
  addToast: (message, type = 'info') =>
    set((state) => {
      const next = [...state.toasts, { id: `${Date.now()}-${Math.random()}`, type, message }];
      // Max 5 toast: en eskisini sil
      return { toasts: next.length > 5 ? next.slice(next.length - 5) : next };
    }),
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),


  pendingRescanPaths: null,
  setPendingRescanPaths: (pendingRescanPaths) => set({ pendingRescanPaths }),

  stalenessCheck: {
    status: 'idle',
    staleIds: new Set<string>(),
    missingIds: new Set<string>(),
    versionOutdatedIds: new Set<string>(),
    lastCheckedAt: null,
    progress: null,
  },
  setStalenessStatus: (status) => set((s) => ({
    stalenessCheck: { ...s.stalenessCheck, status },
  })),
  setStalenessProgress: (done, total) => set((s) => ({
    stalenessCheck: { ...s.stalenessCheck, progress: { done, total } },
  })),
  setStalenessResult: (staleIds, missingIds, versionOutdatedIds) => set((s) => ({
    stalenessCheck: {
      ...s.stalenessCheck,
      status: 'done',
      staleIds,
      missingIds,
      versionOutdatedIds,
      lastCheckedAt: Date.now(),
      progress: null,
    },
  })),
  resetStaleness: () => set({
    stalenessCheck: {
      status: 'idle',
      staleIds: new Set<string>(),
      missingIds: new Set<string>(),
      versionOutdatedIds: new Set<string>(),
      lastCheckedAt: null,
      progress: null,
    },
  }),

  lastScanInfoMap: Object.fromEntries(loadArchives().map(a => [a.id, loadLastScanInfo(a.id)])),
  setLastScanInfo: (info, archive) => {
    const key = `archivist_last_scan_info_${archive}`;
    if (info) localStorage.setItem(key, JSON.stringify(info));
    else localStorage.removeItem(key);
    set((state) => ({ lastScanInfoMap: { ...state.lastScanInfoMap, [archive]: info } }));
  },

  folderScanDurations: loadFolderScanDurations(),
  setFolderScanDuration: (folderPath, info) => {
    set((state) => {
      const next = { ...state.folderScanDurations, [folderPath]: info };
      localStorage.setItem('archivist_folder_scan_durations', JSON.stringify(next));
      return { folderScanDurations: next };
    });
  },

  autoRagIndexProgress: null,
  setAutoRagIndexProgress: (autoRagIndexProgress) => set({ autoRagIndexProgress }),
  autoRagIndexCancel: null,
  setAutoRagIndexCancel: (autoRagIndexCancel) => set({ autoRagIndexCancel }),

}));
