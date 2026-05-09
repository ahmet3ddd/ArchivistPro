/**
 * DWG Composite Similarity Search — Faz 4.4
 *
 * DWG dosyaları için CLIP yerine katman/blok/metin/şekil/pHash
 * bazlı composite benzerlik araması. Rust backend'e delege eder.
 */

import { invoke } from '@tauri-apps/api/core';
import { getActiveArchive } from './database';

export interface DwgSimilarityResult {
    assetId: string;
    fileName: string;
    filePath: string;
    score: number;
    layerScore: number;
    blockScore: number;
    textScore: number;
    shapeScore: number;
    phashScore: number;
}

interface RustDwgSimilarityResult {
    asset_id: string;
    file_name: string;
    file_path: string;
    score: number;
    layer_score: number;
    block_score: number;
    text_score: number;
    shape_score: number;
    phash_score: number;
}

/**
 * Referans DWG asset'e en benzer DWG dosyalarını bulur.
 * Composite scoring: katman %25 + blok %20 + metin %20 + şekil %20 + pHash %15.
 */
export async function searchSimilarDwg(
    refAssetId: string,
    topK = 30,
): Promise<DwgSimilarityResult[]> {
    const results = await invoke<RustDwgSimilarityResult[]>('search_similar_dwg', {
        refAssetId,
        topK,
        archiveAt: getActiveArchive(),
    });
    return results.map((r) => ({
        assetId: r.asset_id,
        fileName: r.file_name,
        filePath: r.file_path,
        score: r.score,
        layerScore: r.layer_score,
        blockScore: r.block_score,
        textScore: r.text_score,
        shapeScore: r.shape_score,
        phashScore: r.phash_score,
    }));
}
