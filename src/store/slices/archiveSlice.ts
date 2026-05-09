/**
 * Arşiv, kaynak klasör, etiket filtresi ve kök grup state'i.
 */
import { type ArchiveType, type ArchiveDef, type ScannedRoot, type RootGroup, MAIN_ARCHIVE_ID, LOCAL_ARCHIVE_ID } from '../../services/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SetFn = (partial: any) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GetFn = () => any;

/* ── localStorage helpers ── */

export function loadActiveArchive(): ArchiveType {
    try {
        const s = localStorage.getItem('archivist_active_archive');
        return s ?? MAIN_ARCHIVE_ID;
    } catch { return MAIN_ARCHIVE_ID; }
}

export function loadArchives(): ArchiveDef[] {
    try {
        const saved = localStorage.getItem('archivist_archives');
        if (saved) return JSON.parse(saved);
    } catch { /* fallback */ }
    return [
        { id: MAIN_ARCHIVE_ID, name: 'Ana Arşiv', type: 'shared', createdAt: new Date().toISOString(), color: '#10b981' },
        { id: LOCAL_ARCHIVE_ID, name: 'Yerel Arşiv', type: 'personal', createdAt: new Date().toISOString(), color: '#a855f7' },
    ];
}

/* ── Slice interface ── */

export interface ArchiveSlice {
    activeArchive: ArchiveType;
    setActiveArchive: (archive: ArchiveType) => void;

    archives: ArchiveDef[];
    setArchives: (archives: ArchiveDef[]) => void;
    addArchive: (def: ArchiveDef) => void;
    removeArchive: (id: string) => void;
    updateArchive: (id: string, updates: Partial<Pick<ArchiveDef, 'name' | 'color'>>) => void;

    scannedRoots: ScannedRoot[];
    setScannedRoots: (roots: ScannedRoot[]) => void;
    activeRootFilters: string[];
    setActiveRootFilters: (paths: string[]) => void;
    toggleRootFilter: (path: string) => void;
    clearRootFilters: () => void;

    activeTagFilters: number[];
    toggleTagFilter: (tagId: number) => void;
    clearTagFilters: () => void;

    rootGroups: RootGroup[];
    setRootGroups: (groups: RootGroup[]) => void;
    toggleGroupFilter: (groupId: string) => void;

    // Faz 4.4 — Tarih aralığı filtresi
    dateRangeFilter: { from: string | null; to: string | null };
    setDateRangeFilter: (range: { from: string | null; to: string | null }) => void;
    clearDateRangeFilter: () => void;
}

export function createArchiveSlice(set: SetFn, get: GetFn): ArchiveSlice {
    return {
        activeArchive: loadActiveArchive(),
        setActiveArchive: (activeArchive) => {
            localStorage.setItem('archivist_active_archive', activeArchive);
            set({ activeArchive });
        },

        archives: loadArchives(),
        setArchives: (archives) => {
            localStorage.setItem('archivist_archives', JSON.stringify(archives));
            set({ archives });
        },
        addArchive: (def) => {
            const next = [...get().archives, def];
            localStorage.setItem('archivist_archives', JSON.stringify(next));
            set({ archives: next });
        },
        removeArchive: (id) => {
            const next = get().archives.filter((a: ArchiveDef) => a.id !== id);
            localStorage.setItem('archivist_archives', JSON.stringify(next));
            set({ archives: next });
        },
        updateArchive: (id, updates) => {
            const next = get().archives.map((a: ArchiveDef) => a.id === id ? { ...a, ...updates } : a);
            localStorage.setItem('archivist_archives', JSON.stringify(next));
            set({ archives: next });
        },

        scannedRoots: [],
        setScannedRoots: (scannedRoots) => set({ scannedRoots }),
        activeRootFilters: [],
        setActiveRootFilters: (activeRootFilters) => set({ activeRootFilters }),
        toggleRootFilter: (path) => {
            const state = get();
            const isActive = state.activeRootFilters.includes(path);
            set({ activeRootFilters: isActive ? state.activeRootFilters.filter((p: string) => p !== path) : [...state.activeRootFilters, path] });
        },
        clearRootFilters: () => set({ activeRootFilters: [] }),

        activeTagFilters: [],
        toggleTagFilter: (tagId) => {
            const state = get();
            const has = state.activeTagFilters.includes(tagId);
            set({ activeTagFilters: has ? state.activeTagFilters.filter((id: number) => id !== tagId) : [...state.activeTagFilters, tagId] });
        },
        clearTagFilters: () => set({ activeTagFilters: [] }),

        rootGroups: [],
        setRootGroups: (rootGroups) => set({ rootGroups }),
        toggleGroupFilter: (groupId) => {
            const state = get();
            const paths = state.scannedRoots
                .filter((r: ScannedRoot) => r.groupId === groupId)
                .map((r: ScannedRoot) => r.path);
            const allActive = paths.length > 0 && paths.every((p: string) => state.activeRootFilters.includes(p));
            set({ activeRootFilters: allActive ? state.activeRootFilters.filter((p: string) => !paths.includes(p)) : Array.from(new Set([...state.activeRootFilters, ...paths])) });
        },

        // Faz 4.4 — Tarih aralığı filtresi
        dateRangeFilter: { from: null, to: null },
        setDateRangeFilter: (dateRangeFilter) => set({ dateRangeFilter }),
        clearDateRangeFilter: () => set({ dateRangeFilter: { from: null, to: null } }),
    };
}
