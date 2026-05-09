/**
 * getAssetThumbnailSrc — önizleme URL öncelik testleri.
 * convertFileSrc Tauri bağımlı; mock edilir.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
    convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

import { getAssetThumbnailSrc } from '../utils/thumbnailSrc';
import type { Asset } from '../types';

function makeAsset(overrides: Partial<Asset> = {}): Asset {
    return {
        id: 'a1',
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

describe('getAssetThumbnailSrc', () => {
    it('thumbnailUrl varsa onu döner (Rust base64 — en yüksek öncelik)', () => {
        const a = makeAsset({
            thumbnailUrl: 'data:image/png;base64,iVBORw0K...',
            fileType: 'DWG',
        });
        expect(getAssetThumbnailSrc(a)).toBe('data:image/png;base64,iVBORw0K...');
    });

    it('PNG için thumbnailUrl yoksa convertFileSrc çağrılır', () => {
        const a = makeAsset({ fileType: 'PNG', filePath: 'C:\\photo.png' });
        const result = getAssetThumbnailSrc(a);
        expect(result).not.toBeNull();
        expect(result).toContain('photo.png');
    });

    it('JPEG için convertFileSrc çağrılır', () => {
        const a = makeAsset({ fileType: 'JPEG', filePath: 'C:\\img.jpg' });
        expect(getAssetThumbnailSrc(a)).not.toBeNull();
    });

    it('JPG için null döner (WEB_IMAGE_TYPES\'ta sadece JPEG var, JPG yok)', () => {
        // Tasarım notu: WEB_IMAGE_TYPES = ['JPEG', 'PNG', 'BMP', 'WEBP', 'SVG', 'GIF']
        // JPG alias eklenmemiş — thumbnailUrl olmayan JPG asset null döner.
        const a = makeAsset({ fileType: 'JPG', filePath: 'C:\\img.jpg' });
        expect(getAssetThumbnailSrc(a)).toBeNull();
    });

    it('BMP için convertFileSrc çağrılır', () => {
        const a = makeAsset({ fileType: 'BMP', filePath: 'C:\\img.bmp' });
        expect(getAssetThumbnailSrc(a)).not.toBeNull();
    });

    it('WEBP için convertFileSrc çağrılır', () => {
        const a = makeAsset({ fileType: 'WEBP', filePath: 'C:\\img.webp' });
        expect(getAssetThumbnailSrc(a)).not.toBeNull();
    });

    it('SVG için convertFileSrc çağrılır', () => {
        const a = makeAsset({ fileType: 'SVG', filePath: 'C:\\icon.svg' });
        expect(getAssetThumbnailSrc(a)).not.toBeNull();
    });

    it('GIF için convertFileSrc çağrılır', () => {
        const a = makeAsset({ fileType: 'GIF', filePath: 'C:\\anim.gif' });
        expect(getAssetThumbnailSrc(a)).not.toBeNull();
    });

    it('DWG için thumbnailUrl yok ve görsel tip değil → null döner', () => {
        const a = makeAsset({ fileType: 'DWG', thumbnailUrl: null });
        expect(getAssetThumbnailSrc(a)).toBeNull();
    });

    it('PDF için null döner (web-native değil)', () => {
        const a = makeAsset({ fileType: 'PDF', thumbnailUrl: null });
        expect(getAssetThumbnailSrc(a)).toBeNull();
    });

    it('MAX için null döner (web-native değil)', () => {
        const a = makeAsset({ fileType: 'MAX', thumbnailUrl: null });
        expect(getAssetThumbnailSrc(a)).toBeNull();
    });

    it('küçük harf fileType "png" → null döner (case sensitive check)', () => {
        // WEB_IMAGE_TYPES büyük harflerle tanımlı; küçük harf eşleşmez
        const a = makeAsset({ fileType: 'png', thumbnailUrl: null });
        expect(getAssetThumbnailSrc(a)).toBeNull();
    });

    it('thumbnailUrl varsa fileType göz ardı edilir', () => {
        // DWG ama base64 thumbnail var
        const a = makeAsset({ fileType: 'DWG', thumbnailUrl: 'data:image/jpeg;base64,abc' });
        expect(getAssetThumbnailSrc(a)).toBe('data:image/jpeg;base64,abc');
    });

    it('convertFileSrc exception atarsa null döner', async () => {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        vi.mocked(convertFileSrc).mockImplementationOnce(() => { throw new Error('Tauri error'); });
        const a = makeAsset({ fileType: 'PNG', filePath: 'C:\\test.png' });
        expect(getAssetThumbnailSrc(a)).toBeNull();
    });
});
