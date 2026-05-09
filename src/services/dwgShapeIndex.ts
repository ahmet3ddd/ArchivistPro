/**
 * DWG/DXF geometrik shape index servisi — Faz 4.1.
 *
 * Rust `extract_dxf_shapes` komutundan gelen ham shape listesini alıp
 * `dwg_shapes` tablosuna persist eder. Mtime-based regen desteği de buradadır
 * (Karar 2 — hibrit strateji).
 */

import { invoke } from '@tauri-apps/api/core';
import { runSql, queryAll, getActiveArchive } from './database';
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

/** Shape arama/sorgu için kısa kategori — plan'daki 4.2 şemasında geçer. */
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
export function deleteDwgShapes(assetId: string): void {
    runSql(`DELETE FROM dwg_shapes WHERE asset_id = ?`, [assetId]);
}

/** Shape'leri toplu yazar (eski kayıtları siler). */
export function persistDwgShapes(assetId: string, shapes: DxfShapeRaw[]): void {
    deleteDwgShapes(assetId);
    if (!shapes.length) return;
    let idx = 0;
    for (const s of shapes) {
        const id = `${assetId}:${idx++}`;
        const category = categorizeLayerForShape(s.layer_name);
        runSql(
            `INSERT INTO dwg_shapes
             (id, asset_id, layer_name, layer_category, entity_type,
              vertex_count, is_closed, area, perimeter, aspect_ratio, regularity,
              bbox_w, bbox_h, centroid_x, centroid_y,
              compactness, solidity, rectangularity)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, assetId,
                s.layer_name || '0',
                category,
                s.entity_type,
                s.vertex_count,
                s.is_closed ? 1 : 0,
                s.area, s.perimeter, s.aspect_ratio, s.regularity,
                s.bbox_w, s.bbox_h, s.centroid_x, s.centroid_y,
                s.compactness ?? 0, s.solidity ?? 0, s.rectangularity ?? 0,
            ],
        );
    }
}

/**
 * Shape index regen gerekiyor mu? Karar 2 — hibrit:
 *   - Hiç kayıt yok → evet
 *   - En son indexed_at < asset.modifiedAt → evet
 *   - Aksi halde hayır
 */
export function needsShapeReindex(assetId: string, assetModifiedAt: string): boolean {
    const rows = queryAll(
        `SELECT MAX(indexed_at) FROM dwg_shapes WHERE asset_id = ?`,
        [assetId],
    );
    const lastIndexedRaw = rows?.[0]?.[0];
    if (!lastIndexedRaw) return true;
    const lastIndexed = new Date(String(lastIndexedRaw));
    const modified = new Date(assetModifiedAt);
    if (isNaN(lastIndexed.getTime()) || isNaN(modified.getTime())) return true;
    return modified.getTime() > lastIndexed.getTime();
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
        if (!needsShapeReindex(assetId, assetModifiedAt)) {
            return { indexed: false, shapeCount: 0 };
        }
        const shapes = await invoke<DxfShapeRaw[]>('extract_dxf_shapes', { path: filePath });
        persistDwgShapes(assetId, shapes);
        return { indexed: true, shapeCount: shapes.length };
    } catch (err) {
        console.warn('[dwgShapeIndex] extract/persist failed:', err);
        return { indexed: false, shapeCount: 0 };
    }
}

/**
 * Sadece extract — paralel prepare aşamasında çağrılır, DB yazma yapmaz.
 * Persist için processEntry içinde `persistDwgShapes(assetId, shapes)` çağrılmalı.
 */
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
        if (!needsShapeReindex(assetId, assetModifiedAt)) {
            return { indexed: false, shapeCount: 0 };
        }
        const shapes = await invoke<DxfShapeRaw[]>('extract_dwg_shapes', { path: filePath });
        persistDwgShapes(assetId, shapes);
        return { indexed: true, shapeCount: shapes.length };
    } catch (err) {
        const msg = String(err || '');
        if (msg.includes('ODAFileConverter kurulu değil')) {
            return { indexed: false, shapeCount: 0, odaMissing: true };
        }
        // Best-effort: shape extraction başarısız olabilir (corrupted DWG, parse error, vb.).
        // Tarama akışını bozmaz. Production console gürültüsünü önlemek için debugLog (DEV-only).
        debugLog('dwgShapeIndex', 'DWG extract/persist failed', err);
        return { indexed: false, shapeCount: 0 };
    }
}

/**
 * Sadece extract — paralel prepare aşamasında çağrılır, DB yazma yapmaz.
 * `odaMissing`: ODA File Converter kurulu değilse true → tek seferlik UI uyarısı için.
 */
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

/** Rust extract_shape_from_image sonuç tipi. */
export interface ImageShapeResult {
    shape: DxfShapeRaw;
    contour_point_count: number;
    simplified_point_count: number;
    image_width: number;
    image_height: number;
}

/** Arama kriterleri — tüm alanlar opsiyonel. */
export interface ShapeSearchCriteria {
    vertexCount?: number;
    vertexTolerance?: number;     // ±N vertex (varsayılan 1)
    minRegularity?: number;       // 0..1
    layerCategory?: string;       // HAVUZ | DUVAR | KAPI | ...
    minAspectRatio?: number;
    maxAspectRatio?: number;
    // Faz 4.4 — gelişmiş kriterler
    minCompactness?: number;      // 0..1 — daire=1
    minRectangularity?: number;   // 0..1 — dikdörtgen=1
    includeOpen?: boolean;        // açık şekilleri de dahil et
    assetIds?: string[];          // belirli asset'lerle sınırla (tag filtresi)
}

/** Tek bir eşleşme sonucu — Rust backend ShapeMatchResult ile 1:1 eşleşir. */
export interface ShapeMatch {
    assetId: string;
    shapeId: string;
    score: number;        // 0..1 benzerlik skoru
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

/** Rust backend sonucunu frontend ShapeMatch'e dönüştürür. */
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
 * Referans shape'e en çok benzeyen dwg_shapes kayıtlarını döner.
 * Faz 4.4: Scoring tamamen Rust backend'de — 6 özellik + açık/kapalı ayrımı.
 * Fallback: Tauri komutu başarısızsa eski JS skorlamasına düşer.
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
        debugLog('dwgShapeIndex', 'Backend search failed, falling back to JS', err);
        return searchShapesBySimilarityFallback(ref, topK);
    }
}

/** JS fallback — eski DB'lerde veya Tauri komutu yokken kullanılır. */
function searchShapesBySimilarityFallback(ref: DxfShapeRaw, topK: number): ShapeMatch[] {
    const rows = queryAll(`
        SELECT id, asset_id, vertex_count, regularity, aspect_ratio, area,
               perimeter, layer_category, layer_name, entity_type, is_closed,
               COALESCE(compactness, 0), COALESCE(solidity, 0), COALESCE(rectangularity, 0)
        FROM dwg_shapes WHERE is_closed = 1 AND vertex_count >= 3
    `);
    const results: ShapeMatch[] = [];
    for (const r of rows) {
        const vc = Number(r[2]); const reg = Number(r[3]); const ar = Number(r[4]);
        const sigma = Math.max(Math.max(ref.vertex_count, vc) * 0.3, 1.5);
        const vcDiff = ref.vertex_count - vc;
        const vcSim = Math.exp(-(vcDiff * vcDiff) / (2 * sigma * sigma));
        const regSim = 1.0 - Math.abs(ref.regularity - reg);
        const arMax = Math.max(ref.aspect_ratio, ar, 0.01);
        const arSim = 1.0 - Math.abs(ref.aspect_ratio - ar) / arMax;
        const cmpSim = 1.0 - Math.abs((ref.compactness ?? 0) - Number(r[11]));
        const rectSim = 1.0 - Math.abs((ref.rectangularity ?? 0) - Number(r[13]));
        const solidSim = 1.0 - Math.abs((ref.solidity ?? 0) - Number(r[12]));
        const score = 0.20*vcSim + 0.20*cmpSim + 0.15*regSim + 0.15*arSim + 0.15*rectSim + 0.10*solidSim + 0.05;
        results.push({
            assetId: String(r[1]), shapeId: String(r[0]),
            score: Math.max(0, Math.min(1, score)),
            vertexCount: vc, regularity: reg, aspectRatio: ar,
            compactness: Number(r[11]), solidity: Number(r[12]), rectangularity: Number(r[13]),
            area: Number(r[5]), perimeter: Number(r[6]),
            layerCategory: String(r[7]), layerName: String(r[8]),
            entityType: String(r[9]), isClosed: true,
        });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
}

/**
 * Kriter tabanlı arama — Faz 4.4: Rust backend'e delege.
 * Fallback: JS'te.
 */
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
        debugLog('dwgShapeIndex', 'Backend feature search failed, falling back to JS', err);
        return searchShapesByFeaturesFallback(criteria, topK);
    }
}

/** JS fallback kriter araması. */
function searchShapesByFeaturesFallback(criteria: ShapeSearchCriteria, topK: number): ShapeMatch[] {
    const conditions: string[] = ['is_closed = 1', 'vertex_count >= 3'];
    const params: unknown[] = [];
    if (criteria.vertexCount != null) {
        const tol = criteria.vertexTolerance ?? 1;
        conditions.push('vertex_count BETWEEN ? AND ?');
        params.push(criteria.vertexCount - tol, criteria.vertexCount + tol);
    }
    if (criteria.minRegularity != null) { conditions.push('regularity >= ?'); params.push(criteria.minRegularity); }
    if (criteria.layerCategory && criteria.layerCategory !== 'TUMU') {
        conditions.push('layer_category = ?'); params.push(criteria.layerCategory);
    }
    if (criteria.assetIds && criteria.assetIds.length > 0) {
        const ph = criteria.assetIds.map(() => '?').join(',');
        conditions.push(`asset_id IN (${ph})`);
        params.push(...criteria.assetIds);
    }
    const where = conditions.join(' AND ');
    const rows = queryAll(`
        SELECT id, asset_id, vertex_count, regularity, aspect_ratio, area,
               perimeter, layer_category, layer_name, entity_type,
               COALESCE(compactness,0), COALESCE(solidity,0), COALESCE(rectangularity,0)
        FROM dwg_shapes WHERE ${where} ORDER BY regularity DESC, area DESC LIMIT ?
    `, [...params, topK]);
    return rows.map((r) => ({
        assetId: String(r[1]), shapeId: String(r[0]),
        score: Number(r[3]),
        vertexCount: Number(r[2]), regularity: Number(r[3]), aspectRatio: Number(r[4]),
        compactness: Number(r[10]), solidity: Number(r[11]), rectangularity: Number(r[12]),
        area: Number(r[5]), perimeter: Number(r[6]),
        layerCategory: String(r[7]), layerName: String(r[8]),
        entityType: String(r[9]), isClosed: true,
    }));
}

/** Tüm shape index'i temizler (manuel regen için — Karar 2). */
export async function clearAllDwgShapes(): Promise<{ rowsDeleted: number; cacheBytesCleared: number }> {
    const before = queryAll(`SELECT COUNT(*) FROM dwg_shapes`);
    const rowsDeleted = Number(before?.[0]?.[0] ?? 0);
    runSql(`DELETE FROM dwg_shapes`);
    let cacheBytes = 0;
    try {
        cacheBytes = await invoke<number>('clear_dxf_cache_cmd');
    } catch (err) {
        console.warn('[dwgShapeIndex] DXF cache clear failed:', err);
    }
    return { rowsDeleted, cacheBytesCleared: cacheBytes };
}
