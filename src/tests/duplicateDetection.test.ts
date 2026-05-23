/**
 * duplicateDetection — pure/exported fonksiyon testleri.
 *
 * runDuplicateScan DB bağımlı (entegrasyon testleri ayrı).
 * Burada: isVisualAsset, isStructuralAsset, hasStructuralMetadata + sabitler.
 */
import { describe, it, expect } from 'vitest';
import {
    isVisualAsset,
    isStructuralAsset,
    hasStructuralMetadata,
    DEFAULT_CRITERIA,
    DEFAULT_PERFORMANCE_FILTERS,
} from '../services/duplicateDetection';
import type { Asset } from '../types';

/* ── Test asset fabrikası ── */

function makeAsset(overrides: Partial<Asset> = {}): Asset {
    return {
        id: 'test-id',
        fileName: 'test.dwg',
        filePath: 'C:\\test.dwg',
        fileType: 'DWG',
        fileSize: 1024,
        category: 'Çizim',
        projectName: null,
        projectPhase: null,
        materialGroup: null,
        createdAt: '2024-01-01T00:00:00Z',
        modifiedAt: '2024-01-01T00:00:00Z',
        thumbnailUrl: null,
        phash: null,
        contentHash: null,
        colorPalette: [],
        colorTheme: null,
        userTags: [],
        aiTags: [],
        metadata: {},
        rawMetadata: null,
        ragStatus: null,
        ragStatusReason: null,
        versionLabel: null,
        clientName: null,
        approvalStatus: 'draft',
        deadline: null,
        isDeleted: 0,
        deletedAt: null,
        omniclassCode: null,
        fsMtime: null,
        metadataVersion: 1,
        appliedExtractors: null,
        extractedAt: null,
        ...overrides,
    };
}

describe('isVisualAsset', () => {
    const visualTypes = ['JPG', 'JPEG', 'PNG', 'BMP', 'WEBP', 'TIFF', 'TGA', 'PSD'];
    const nonVisualTypes = ['DWG', 'PDF', 'DOC', 'MAX', 'SKP', 'RVT', 'IFC', 'DXF', 'BAK'];

    visualTypes.forEach((ft) => {
        it(`${ft} görsel asset sayılır`, () => {
            expect(isVisualAsset(makeAsset({ fileType: ft }))).toBe(true);
        });
        it(`${ft.toLowerCase()} (küçük harf) görsel asset sayılır`, () => {
            expect(isVisualAsset(makeAsset({ fileType: ft.toLowerCase() }))).toBe(true);
        });
    });

    nonVisualTypes.forEach((ft) => {
        it(`${ft} görsel asset sayılmaz`, () => {
            expect(isVisualAsset(makeAsset({ fileType: ft }))).toBe(false);
        });
    });

    it('boş fileType false döner', () => {
        expect(isVisualAsset(makeAsset({ fileType: '' }))).toBe(false);
    });
});

describe('isStructuralAsset', () => {
    const structuralTypes = ['DWG', 'DXF', 'MAX', 'SKP', 'PDF', 'DOC', 'DOCX',
        'XLS', 'XLSX', 'PPT', 'PPTX', 'RVT', 'IFC'];
    const nonStructuralTypes = ['JPG', 'PNG', 'BAK', 'MP4', 'ZIP', 'unknown'];

    structuralTypes.forEach((ft) => {
        it(`${ft} yapısal asset sayılır`, () => {
            expect(isStructuralAsset(makeAsset({ fileType: ft }))).toBe(true);
        });
    });

    nonStructuralTypes.forEach((ft) => {
        it(`${ft} yapısal asset sayılmaz`, () => {
            expect(isStructuralAsset(makeAsset({ fileType: ft }))).toBe(false);
        });
    });

    it('küçük harf fileType da eşleşir', () => {
        expect(isStructuralAsset(makeAsset({ fileType: 'dwg' }))).toBe(true);
    });
});

describe('hasStructuralMetadata', () => {
    it('DWG — layers alanı varsa true', () => {
        const a = makeAsset({
            fileType: 'DWG',
            metadata: { layers: ['A-WALL', 'A-DOOR'] } as any,
        });
        expect(hasStructuralMetadata(a)).toBe(true);
    });

    it('DWG — dwgLayers alanı varsa true', () => {
        const a = makeAsset({
            fileType: 'DWG',
            metadata: { dwgLayers: ['Layer1'] } as any,
        });
        expect(hasStructuralMetadata(a)).toBe(true);
    });

    it('DWG — dwgBlockNames alanı varsa true', () => {
        const a = makeAsset({
            fileType: 'DWG',
            metadata: { dwgBlockNames: ['CHAIR', 'TABLE'] } as any,
        });
        expect(hasStructuralMetadata(a)).toBe(true);
    });

    it('DWG — metadata boşsa false', () => {
        const a = makeAsset({ fileType: 'DWG', metadata: {} });
        expect(hasStructuralMetadata(a)).toBe(false);
    });

    it('DWG — boş layers dizisi false döner', () => {
        const a = makeAsset({
            fileType: 'DWG',
            metadata: { layers: [] } as any,
        });
        expect(hasStructuralMetadata(a)).toBe(false);
    });

    it('rawMetadata öncelikli kullanılır (varsa)', () => {
        const a = makeAsset({
            fileType: 'DWG',
            metadata: {} as any,
            rawMetadata: { layers: ['A-WALL'] },
        });
        expect(hasStructuralMetadata(a)).toBe(true);
    });

    it('IFC — layers varsa true', () => {
        const a = makeAsset({
            fileType: 'IFC',
            metadata: { layers: ['IfcWall'] } as any,
        });
        expect(hasStructuralMetadata(a)).toBe(true);
    });

    // MAX, SKP, PDF vb. — metadata extraction eksik olduğu için daima true
    const alwaysTrueTypes = ['MAX', 'SKP', 'PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX'];
    alwaysTrueTypes.forEach((ft) => {
        it(`${ft} metadata yoksa bile true döner (extraction eksik)`, () => {
            const a = makeAsset({ fileType: ft, metadata: {} });
            expect(hasStructuralMetadata(a)).toBe(true);
        });
    });

    it('bilinmeyen tip false döner', () => {
        const a = makeAsset({ fileType: 'UNKNOWN', metadata: {} });
        expect(hasStructuralMetadata(a)).toBe(false);
    });
});

describe('DEFAULT_CRITERIA', () => {
    it('genel kriterler varsayılan olarak kapalı (geçmişe uyumlu)', () => {
        expect(DEFAULT_CRITERIA.sameSize).toBe(false);
        expect(DEFAULT_CRITERIA.sameModifiedWithinDays).toBe(0);
        expect(DEFAULT_CRITERIA.sameParentFolder).toBe(false);
    });

    it('DWG kriterleri varsayılan açık', () => {
        expect(DEFAULT_CRITERIA.dwgLayers).toBe(true);
        expect(DEFAULT_CRITERIA.dwgBlocks).toBe(true);
        expect(DEFAULT_CRITERIA.dwgTextContents).toBe(true);
        expect(DEFAULT_CRITERIA.dwgXrefs).toBe(true);
    });

    it('sizeTolerance varsayılan "exact"', () => {
        expect(DEFAULT_CRITERIA.sizeTolerance).toBe('exact');
    });
});

describe('DEFAULT_PERFORMANCE_FILTERS', () => {
    it('minFileSizeKb varsayılan 0 (devre dışı)', () => {
        expect(DEFAULT_PERFORMANCE_FILTERS.minFileSizeKb).toBe(0);
    });
});
