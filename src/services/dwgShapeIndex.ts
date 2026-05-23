/**
 * DWG/DXF geometrik shape index servisi — v2.4.8'den itibaren ayrı DB dosyasında
 * (`archivist_shapes*.db`), Rust shapes_db modülü tarafından yönetiliyor.
 *
 * Frontend artık doğrudan sql.js'e yazmaz — tüm CRUD invoke ile Rust'a delege.
 */

import { invoke } from '@tauri-apps/api/core';
import { getActiveArchive } from './database';
import { debugLog } from './logger';

/** Rust tarafı DxfShape struct'ıyla 1:1 eşleşir (serde Serialize). */
export interface DxfShapeRaw {
    entity_type: string;       // LINE | CIRCLE | ARC | LWPOLYLINE | POLYLINE | IMAGE_CONTOUR
    layer_name: string;
    vertex_count: number;
    is_closed: boolean;
    area: number;
    perimeter: number;
    aspect_ratio: number;
    regularity: number;
    bbox_w: number;
    bbox_h: number;
    centroid_x: number;
    centroid_y: number;
    // Faz 4.4 — gelişmiş geometrik özellikler
    compactness: number;       // 4π·area/perimeter² — daire=1, düzensiz<1
    solidity: number;          // alan/dışbükey_kabuk_alanı — dışbükey=1, içbükey<1
    rectangularity: number;    // alan/(bbox_w×bbox_h) — dikdörtgen=1, seyrek<1
}

/** Shape arama/sorgu için kısa kategori — Rust tarafı `categorize_layer` ile aynı. */
export function categorizeLayerForShape(layerName: string): string {
    const upper = (layerName || '').toUpperCase();
    if (/(HAVUZ|POOL|BASIN)/.test(upper)) return 'HAVUZ';
    if (/(DUVAR|WALL|MURO)/.test(upper)) return 'DUVAR';
    if (/(KAPI|DOOR|PORTA)/.test(upper)) return 'KAPI';
    if (/(PENCERE|WINDOW|CAM)/.test(upper)) return 'PENCERE';
    if (/(KOLON|COLUMN)/.test(upper)) return 'KOLON';
    if (/(KIRIS|KIRIŞ|BEAM)/.test(upper)) return 'KIRIS';
    if (/(MERDIVEN|MERDİVEN|STAIR)/.test(upper)) return 'MERDIVEN';
    if (/(DOSEME|DÖŞEME|SLAB|FLOOR)/.test(upper)) return 'DOSEME';
    if (/(CATI|ÇATI|ROOF)/.test(upper)) return 'CATI';
    return 'DIGER';
}

/** Asset'in mevcut shape kayıtlarını siler. */
export async function deleteDwgShapes(assetId: string): Promise<void> {
    try {
        await invoke<number>('delete_dwg_shapes', {
            assetId,
            archiveAt: getActiveArchive(),
        });
    } catch (err) {
        debugLog('dwgShapeIndex', 'delete_dwg_shapes failed', err);
    }
}

/** Shape'leri toplu yazar (Rust persist_dwg_shapes — eski kayıtları siler). */
export async function persistDwgShapes(assetId: string, shapes: DxfShapeRaw[]): Promise<void> {
    try {
        await invoke<number>('persist_dwg_shapes', {
            assetId,
            shapes,
            archiveAt: getActiveArchive(),
        });
    } catch (err) {
        debugLog('dwgShapeIndex', 'persist_dwg_shapes failed', err);
    }
}

/**
 * Shape index regen gerekiyor mu? Karar 2 — hibrit:
 *   - Hiç kayıt yok → evet
 *   - En son indexed_at < asset.modifiedAt → evet
 *   - Aksi halde hayır
 */
export async function needsShapeReindex(assetId: string, assetModifiedAt: string): Promise<boolean> {
    try {
        const lastIndexedRaw = await invoke<string | null>('query_dwg_shape_max_indexed', {
            assetId,
            archiveAt: getActiveArchive(),
        });
        if (!lastIndexedRaw) return true;
        const lastIndexed = new Date(lastIndexedRaw);
        const modified = new Date(assetModifiedAt);
        if (isNaN(lastIndexed.getTime()) || isNaN(modified.getTime())) return true;
        return modified.getTime() > lastIndexed.getTime();
    } catch (err) {
        debugLog('dwgShapeIndex', 'query_dwg_shape_max_indexed failed', err);
        return true; // hata durumunda regen tarafa düş
    }
}

/**
 * Pipeline: DXF dosyasından shape çıkarıp tabloya yazar.
 * Sadece `needsReindex=true` ise çalışır; aksi halde no-op.
 * Hatalar sessiz — taramayı bozmamalı.
 */
export async function indexDxfShapes(
    assetId: string,
    filePath: string,
    assetModifiedAt: string,
): Promise<{ indexed: boolean; shapeCount: number }> {
    try {
        if (!(await needsShapeReindex(assetId, assetModifiedAt))) {
            return { indexed: false, shapeCount: 0 };
        }
        const shapes = await invoke<DxfShapeRaw[]>('extract_dxf_shapes', { path: filePath });
        await persistDwgShapes(assetId, shapes);
        return { indexed: true, shapeCount: shapes.length };
    } catch (err) {
        console.warn('[dwgShapeIndex] extract/persist failed:', err);
        return { indexed: false, shapeCount: 0 };
    }
}

/** Sadece extract — paralel prepare aşamasında çağrılır, DB yazma yapmaz. */
export async function extractDxfShapesOnly(filePath: string): Promise<DxfShapeRaw[]> {
    try {
        return await invoke<DxfShapeRaw[]>('extract_dxf_shapes', { path: filePath });
    } catch (err) {
        debugLog('dwgShapeIndex', 'DXF extract-only failed', err);
        return [];
    }
}

/**
 * DWG için ODA pipeline'ı (Faz 4.2): Rust tarafı cache'li DXF üretip parse eder.
 * ODA kurulu değilse Rust `Err` döner → ilk çağrıda UI uyarısı gösterilir.
 */
export async function indexDwgShapes(
    assetId: string,
    filePath: string,
    assetModifiedAt: string,
): Promise<{ indexed: boolean; shapeCount: number; odaMissing?: boolean }> {
    try {
        if (!(await needsShapeReindex(assetId, assetModifiedAt))) {
            return { indexed: false, shapeCount: 0 };
        }
        const shapes = await invoke<DxfShapeRaw[]>('extract_dwg_shapes', { path: filePath });
        await persistDwgShapes(assetId, shapes);
        return { indexed: true, shapeCount: shapes.length };
    } catch (err) {
        const msg = String(err || '');
        if (msg.includes('ODAFileConverter kurulu değil')) {
            return { indexed: false, shapeCount: 0, odaMissing: true };
        }
        debugLog('dwgShapeIndex', 'DWG extract/persist failed', err);
        return { indexed: false, shapeCount: 0 };
    }
}

/** Sadece extract — paralel prepare aşamasında çağrılır, DB yazma yapmaz. */
export async function extractDwgShapesOnly(
    filePath: string,
): Promise<{ shapes: DxfShapeRaw[]; odaMissing: boolean }> {
    try {
        const shapes = await invoke<DxfShapeRaw[]>('extract_dwg_shapes', { path: filePath });
        return { shapes, odaMissing: false };
    } catch (err) {
        const msg = String(err || '');
        if (msg.includes('ODAFileConverter kurulu değil')) {
            return { shapes: [], odaMissing: true };
        }
        debugLog('dwgShapeIndex', 'DWG extract-only failed', err);
        return { shapes: [], odaMissing: false };
    }
}

// ─── Şekil Arama (Faz 4.3) ────────────────────────────────────────────────

export interface ImageShapeResult {
    shape: DxfShapeRaw;
    contour_point_count: number;
    simplified_point_count: number;
    image_width: number;
    image_height: number;
}

export interface ShapeSearchCriteria {
    vertexCount?: number;
    vertexTolerance?: number;
    minRegularity?: number;
    layerCategory?: string;
    minAspectRatio?: number;
    maxAspectRatio?: number;
    minCompactness?: number;
    minRectangularity?: number;
    includeOpen?: boolean;
    assetIds?: string[];
}

export interface ShapeMatch {
    assetId: string;
    shapeId: string;
    score: number;
    vertexCount: number;
    regularity: number;
    aspectRatio: number;
    compactness: number;
    solidity: number;
    rectangularity: number;
    area: number;
    perimeter: number;
    layerCategory: string;
    layerName: string;
    entityType: string;
    isClosed: boolean;
}

interface RustShapeMatchResult {
    shape_id: string;
    asset_id: string;
    score: number;
    vertex_count: number;
    regularity: number;
    aspect_ratio: number;
    compactness: number;
    solidity: number;
    rectangularity: number;
    area: number;
    perimeter: number;
    layer_category: string;
    layer_name: string;
    entity_type: string;
    is_closed: boolean;
}

function mapRustMatch(r: RustShapeMatchResult): ShapeMatch {
    return {
        assetId: r.asset_id, shapeId: r.shape_id, score: r.score,
        vertexCount: r.vertex_count, regularity: r.regularity,
        aspectRatio: r.aspect_ratio, compactness: r.compactness,
        solidity: r.solidity, rectangularity: r.rectangularity,
        area: r.area, perimeter: r.perimeter,
        layerCategory: r.layer_category, layerName: r.layer_name,
        entityType: r.entity_type, isClosed: r.is_closed,
    };
}

/**
 * Referans shape'e en çok benzeyen kayıtları döner — Rust shapes_db'ye delege.
 */
export async function searchShapesBySimilarity(
    ref: DxfShapeRaw,
    topK = 40,
    includeOpen = false,
): Promise<ShapeMatch[]> {
    try {
        const results = await invoke<RustShapeMatchResult[]>('search_shapes_by_similarity', {
            refShape: {
                vertex_count: ref.vertex_count,
                regularity: ref.regularity,
                aspect_ratio: ref.aspect_ratio,
                compactness: ref.compactness ?? 0,
                solidity: ref.solidity ?? 0,
                rectangularity: ref.rectangularity ?? 0,
                is_closed: ref.is_closed,
            },
            topK,
            includeOpen,
            archiveAt: getActiveArchive(),
        });
        return results.map(mapRustMatch);
    } catch (err) {
        debugLog('dwgShapeIndex', 'Backend search failed', err);
        return [];
    }
}

/** Kriter tabanlı arama — Rust shapes_db'ye delege. */
export async function searchShapesByFeatures(
    criteria: ShapeSearchCriteria,
    topK = 50,
): Promise<ShapeMatch[]> {
    try {
        const results = await invoke<RustShapeMatchResult[]>('search_shapes_by_features', {
            criteria: {
                vertex_count: criteria.vertexCount,
                vertex_tolerance: criteria.vertexTolerance ?? 1,
                min_regularity: criteria.minRegularity,
                layer_category: criteria.layerCategory,
                min_aspect_ratio: criteria.minAspectRatio,
                max_aspect_ratio: criteria.maxAspectRatio,
                min_compactness: criteria.minCompactness,
                min_rectangularity: criteria.minRectangularity,
                include_open: criteria.includeOpen,
                asset_ids: criteria.assetIds,
            },
            topK,
            archiveAt: getActiveArchive(),
        });
        return results.map(mapRustMatch);
    } catch (err) {
        debugLog('dwgShapeIndex', 'Backend feature search failed', err);
        return [];
    }
}

/** Tüm shape index'i temizler. */
export async function clearAllDwgShapes(): Promise<{ rowsDeleted: number; cacheBytesCleared: number }> {
    let rowsDeleted = 0;
    try {
        rowsDeleted = await invoke<number>('clear_all_dwg_shapes', {
            archiveAt: getActiveArchive(),
        });
    } catch (err) {
        console.warn('[dwgShapeIndex] clear_all_dwg_shapes failed:', err);
    }
    let cacheBytes = 0;
    try {
        cacheBytes = await invoke<number>('clear_dxf_cache_cmd');
    } catch (err) {
        console.warn('[dwgShapeIndex] DXF cache clear failed:', err);
    }
    return { rowsDeleted, cacheBytesCleared: cacheBytes };
}
