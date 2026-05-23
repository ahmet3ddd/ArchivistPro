import { describe, it, expect } from 'vitest';
import { detectLegacyFormats, countLegacyAssets, LEGACY_FORMAT_RULES } from '../services/formatMigration';
import type { Asset, AssetType } from '../types';

/** Minimal asset stub — sadece detection için gerekli alanlar. */
function makeAsset(id: string, fileType: AssetType): Asset {
    return {
        id,
        fileName: `${id}.${fileType.toLowerCase()}`,
        filePath: `C:/Test/${id}.${fileType.toLowerCase()}`,
        fileSize: 1024,
        fileType,
        category: 'document',
        createdAt: '2026-01-01T00:00:00Z',
        modifiedAt: '2026-01-01T00:00:00Z',
        projectName: 'Test',
        projectPhase: 'concept',
        aiTags: [],
        colorPalette: [],
        metadata: {},
    } as unknown as Asset;
}

describe('formatMigration — detectLegacyFormats', () => {
    it('boş liste için boş sonuç döner', () => {
        expect(detectLegacyFormats([])).toEqual([]);
    });

    it('hiç legacy format yoksa boş döner', () => {
        const assets = [
            makeAsset('a1', 'DWG'),
            makeAsset('a2', 'PDF'),
            makeAsset('a3', 'JPEG'),
        ];
        expect(detectLegacyFormats(assets)).toEqual([]);
    });

    it('legacy Office formatlarını tespit eder', () => {
        const assets = [
            makeAsset('a1', 'DOC'),
            makeAsset('a2', 'XLS'),
            makeAsset('a3', 'PPT'),
            makeAsset('a4', 'DWG'), // legacy değil
        ];
        const result = detectLegacyFormats(assets);
        expect(result).toHaveLength(3);
        const types = result.map(g => g.legacyType);
        expect(types).toContain('DOC');
        expect(types).toContain('XLS');
        expect(types).toContain('PPT');
    });

    it('aynı tipten birden fazla asset için tek grup döner', () => {
        const assets = [
            makeAsset('a1', 'DOC'),
            makeAsset('a2', 'DOC'),
            makeAsset('a3', 'DOC'),
            makeAsset('a4', 'XLS'),
        ];
        const result = detectLegacyFormats(assets);
        expect(result).toHaveLength(2);
        const docGroup = result.find(g => g.legacyType === 'DOC');
        expect(docGroup?.count).toBe(3);
        expect(docGroup?.assets).toHaveLength(3);
    });

    it('en çok eşleşene göre sıralı döner', () => {
        const assets = [
            makeAsset('a1', 'XLS'),
            makeAsset('a2', 'DOC'),
            makeAsset('a3', 'DOC'),
            makeAsset('a4', 'DOC'),
            makeAsset('a5', 'PPT'),
            makeAsset('a6', 'PPT'),
        ];
        const result = detectLegacyFormats(assets);
        expect(result[0].legacyType).toBe('DOC');
        expect(result[0].count).toBe(3);
        expect(result[1].legacyType).toBe('PPT');
        expect(result[1].count).toBe(2);
        expect(result[2].legacyType).toBe('XLS');
        expect(result[2].count).toBe(1);
    });

    it('her grup recommendedType ve reasonKey içerir', () => {
        const assets = [makeAsset('a1', 'DOC')];
        const [group] = detectLegacyFormats(assets);
        expect(group.recommendedType).toBe('DOCX');
        expect(group.reasonKey).toBe('legacyOffice');
    });
});

describe('formatMigration — countLegacyAssets', () => {
    it('boş liste için 0 döner', () => {
        expect(countLegacyAssets([])).toBe(0);
    });

    it('legacy olmayan assetleri saymaz', () => {
        const assets = [makeAsset('a1', 'DWG'), makeAsset('a2', 'PDF')];
        expect(countLegacyAssets(assets)).toBe(0);
    });

    it('legacy assetleri toplar', () => {
        const assets = [
            makeAsset('a1', 'DOC'),
            makeAsset('a2', 'XLS'),
            makeAsset('a3', 'DWG'), // legacy değil
            makeAsset('a4', 'PPT'),
        ];
        expect(countLegacyAssets(assets)).toBe(3);
    });
});

describe('formatMigration — LEGACY_FORMAT_RULES', () => {
    it('Office binary üçlüsünü içerir', () => {
        expect(LEGACY_FORMAT_RULES.DOC).toBeDefined();
        expect(LEGACY_FORMAT_RULES.XLS).toBeDefined();
        expect(LEGACY_FORMAT_RULES.PPT).toBeDefined();
    });
});
