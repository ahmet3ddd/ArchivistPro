/** Arşiv Extract Modal — paylaşılan tip tanımları */
import type { ArchiveDef } from '../../services/database';
import type { Tag } from '../../services/tagService';

export type TargetMode = 'new' | 'existing';
export type ExtractMode = 'copy' | 'move';

export interface ConfigStepProps {
    archives: ArchiveDef[];
    availableTargets: ArchiveDef[];
    scannedRoots: Array<{ id: string; path: string; label: string; fileCount: number }>;
    availableTags: Tag[];
    sourceId: string;
    setSourceId: (id: string) => void;
    selectedFolders: Set<string>;
    setSelectedFolders: (s: Set<string>) => void;
    selectedFileTypes: Set<string>;
    setSelectedFileTypes: (s: Set<string>) => void;
    selectedPhases: Set<string>;
    setSelectedPhases: (s: Set<string>) => void;
    dateFrom: string;
    setDateFrom: (d: string) => void;
    dateTo: string;
    setDateTo: (d: string) => void;
    selectedTags: Set<string>;
    setSelectedTags: (s: Set<string>) => void;
    targetMode: TargetMode;
    setTargetMode: (m: TargetMode) => void;
    newArchiveName: string;
    setNewArchiveName: (n: string) => void;
    newArchiveType: 'shared' | 'personal';
    setNewArchiveType: (t: 'shared' | 'personal') => void;
    existingTargetId: string;
    setExistingTargetId: (id: string) => void;
    mode: ExtractMode;
    setMode: (m: ExtractMode) => void;
    includeTags: boolean;
    setIncludeTags: (b: boolean) => void;
    includeEmbeddings: boolean;
    setIncludeEmbeddings: (b: boolean) => void;
    includeTextChunks: boolean;
    setIncludeTextChunks: (b: boolean) => void;
    includeSummaries: boolean;
    setIncludeSummaries: (b: boolean) => void;
    includeFavorites: boolean;
    setIncludeFavorites: (b: boolean) => void;
    expandFolders: boolean;
    setExpandFolders: (b: boolean) => void;
    expandFileTypes: boolean;
    setExpandFileTypes: (b: boolean) => void;
    expandPhases: boolean;
    setExpandPhases: (b: boolean) => void;
    expandDates: boolean;
    setExpandDates: (b: boolean) => void;
    expandTags: boolean;
    setExpandTags: (b: boolean) => void;
    isAdmin: boolean;
}
