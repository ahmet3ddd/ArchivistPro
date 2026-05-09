/**
 * DuplicateFinder — saf yardımcı fonksiyonlar, sabitler, tipler.
 * State/hook bağımlılığı yok — test edilebilir.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Asset } from '../../types';
import type { ComparisonCriteria } from '../../services/duplicateDetection';

export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(iso: string | undefined): string {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString(); } catch { return '—'; }
}

export const FORMAT_GROUPS = [
    { key: 'cad',    labelKey: 'fmtCad',    types: new Set(['DWG', 'DXF', 'DWF', 'DWFX']) },
    { key: 'bim3d',  labelKey: 'fmtBim3d',  types: new Set(['MAX', 'SKP', 'RVT', 'IFC', '3DS', 'FBX', 'OBJ', 'C4D', 'BLEND', 'GLB', 'DAE', 'STL', '3DM', 'PLN', 'VWX', 'NWD', 'STEP', 'E57']) },
    { key: 'doc',    labelKey: 'fmtDoc',    types: new Set(['PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'TXT', 'CSV', 'RTF']) },
    { key: 'image',  labelKey: 'fmtImage',  types: new Set(['JPEG', 'JPG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'PSD', 'EXR', 'HDR', 'SVG', 'AI', 'EPS']) },
    { key: 'video',  labelKey: 'fmtVideo',  types: new Set(['MP4']) },
    { key: 'backup', labelKey: 'fmtBackup', types: new Set(['BAK']) },
] as const;

export type FormatGroupKey = typeof FORMAT_GROUPS[number]['key'];

export type BoolCriterionKey = {
    [K in keyof ComparisonCriteria]: ComparisonCriteria[K] extends boolean ? K : never
}[keyof ComparisonCriteria];

export const CRITERIA_SECTIONS: { label: string; items: { key: BoolCriterionKey; labelKey: string }[] }[] = [
    { label: 'DWG / DXF', items: [
        { key: 'dwgLayers', labelKey: 'critDwgLayers' },
        { key: 'dwgBlocks', labelKey: 'critDwgBlocks' },
        { key: 'dwgTextContents', labelKey: 'critDwgText' },
        { key: 'dwgXrefs', labelKey: 'critDwgXrefs' },
    ]},
    { label: 'IFC', items: [
        { key: 'ifcStoreys', labelKey: 'critIfcStoreys' },
        { key: 'ifcEntities', labelKey: 'critIfcEntities' },
    ]},
    { label: '3DS MAX', items: [
        { key: 'maxMaterials', labelKey: 'critMaxMaterials' },
        { key: 'maxRenderEngine', labelKey: 'critMaxRenderEngine' },
        { key: 'maxVersion', labelKey: 'critMaxVersion' },
    ]},
    { label: 'SketchUp', items: [
        { key: 'skpComponents', labelKey: 'critSkpComponents' },
        { key: 'skpLayers', labelKey: 'critSkpLayers' },
        { key: 'skpVersion', labelKey: 'critSkpVersion' },
    ]},
    { label: 'Revit', items: [
        { key: 'rvtStoreys', labelKey: 'critRvtStoreys' },
        { key: 'rvtProjectName', labelKey: 'critRvtProjectName' },
    ]},
    { label: 'PDF / Office', items: [
        { key: 'officeTitle', labelKey: 'critOfficeTitle' },
        { key: 'officeAuthor', labelKey: 'critOfficeAuthor' },
        { key: 'pdfPageCount', labelKey: 'critPdfPages' },
    ]},
];

export const TYPE_LABELS: Record<string, string> = {
    'exact-hash': 'groupExactHash',
    'same-name': 'groupSameName',
    'visual-similar': 'groupVisual',
    'structural-similar': 'groupStructural',
};

export const TYPE_ORDER = ['exact-hash', 'same-name', 'visual-similar', 'structural-similar'];

export const FORMAT_COLORS: Record<string, string> = {
    DWG: '#3b82f6', DXF: '#3b82f6', DWF: '#3b82f6', DWFX: '#3b82f6',
    MAX: '#f97316', SKP: '#84cc16', RVT: '#06b6d4', IFC: '#06b6d4',
    PDF: '#ef4444',
    DOC: '#2563eb', DOCX: '#2563eb', XLS: '#16a34a', XLSX: '#16a34a',
    PPT: '#ea580c', PPTX: '#ea580c',
    PSD: '#7c3aed', AI: '#ff9800', EPS: '#ff9800',
    MP4: '#ec4899',
    BAK: '#6b7280',
};

const WEB_TYPES = new Set(['JPEG', 'JPG', 'PNG', 'BMP', 'WEBP', 'SVG', 'GIF']);

export function assetThumbSrc(asset: Asset): string | null {
    if (asset.thumbnailUrl) return asset.thumbnailUrl;
    if (WEB_TYPES.has(asset.fileType?.toUpperCase() ?? '')) return convertFileSrc(asset.filePath);
    return null;
}
