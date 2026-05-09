/**
 * Asset için kullanılabilir bir önizleme URL'si döndürür.
 * Öncelik:
 *   1. asset.thumbnailUrl (Rust-üretilmiş base64 data URL — DWG/MAX/TGA/TIFF vb.)
 *   2. Web-native görsel ise Tauri asset:// protokolüyle dosyanın kendisi
 *   3. null → çağıran "thumbnail yok" göstersin
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Asset } from '../types';

const WEB_IMAGE_TYPES = new Set<string>(['JPEG', 'PNG', 'BMP', 'WEBP', 'SVG', 'GIF']);

export function getAssetThumbnailSrc(asset: Asset): string | null {
    if (asset.thumbnailUrl) return asset.thumbnailUrl;
    if (WEB_IMAGE_TYPES.has(asset.fileType)) {
        try { return convertFileSrc(asset.filePath); } catch { return null; }
    }
    return null;
}
