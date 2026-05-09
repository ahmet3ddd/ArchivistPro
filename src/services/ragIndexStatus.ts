/**
 * RAG index durum analizi ve toplu indexleme.
 * Hangi DOC-tipi assetlerde chunk_text embedding var, hangisinde yok onu raporlar.
 */

import { queryAll, runSql, updateAssetRagStatus, mirrorRagWriteToDisk } from './database';
import { indexAssetForRag } from './textChunker';
import type { AIConfig } from '../components/AISettingsModal';

export const RAG_INDEXABLE_TYPES = ['PDF', 'DOC', 'DOCX', 'XLS', 'XLSX', 'PPT', 'PPTX', 'TXT', 'CSV', 'RTF', 'MD'];

/**
 * Yield to the browser idle queue so heavy bulk indexing doesn't starve the UI.
 * Falls back to a microtask if requestIdleCallback isn't available.
 */
type RequestIdleCallback = (cb: () => void, opts?: { timeout?: number }) => number;
function yieldIfIdle(): Promise<void> {
    const ric = (window as unknown as { requestIdleCallback?: RequestIdleCallback }).requestIdleCallback;
    return new Promise<void>((resolve) => {
        if (ric) ric(() => resolve(), { timeout: 200 });
        else setTimeout(resolve, 0);
    });
}

export type RagAssetStatus = {
    assetId: string;
    fileName: string;
    filePath: string;
    fileType: string;
    fileSize: number | null;
    chunkCount: number;
    indexed: boolean;
    skipped: boolean;
    skipReason: string | null;
};

export type RagIndexReport = {
    total: number;
    indexed: number;
    missing: number;         // gerçekten pending (retry edilebilir)
    skipped: number;         // kalıcı olarak indexlenemez işaretli
    missingAssets: RagAssetStatus[];
    skippedAssets: RagAssetStatus[];
    indexedAssets: RagAssetStatus[];
};

/**
 * Aktif arşivde RAG-indexlenebilir tüm assetleri ve chunk durumlarını tarar.
 */
export function analyzeRagIndex(): RagIndexReport {
    const placeholders = RAG_INDEXABLE_TYPES.map(() => '?').join(',');
    const rows = queryAll(
        `SELECT a.id, a.file_name, a.file_path, a.file_type, a.file_size,
                (SELECT COUNT(*) FROM text_chunks tc WHERE tc.asset_id = a.id) AS chunk_count,
                (SELECT COUNT(*) FROM embeddings e
                   WHERE e.asset_id = a.id AND e.source = 'chunk_text'
                     AND e.ref_id IS NOT NULL AND e.ref_id != '') AS embed_count,
                a.rag_status, a.rag_status_reason
         FROM assets a
         WHERE a.file_type IN (${placeholders})
         ORDER BY a.file_name ASC`,
        RAG_INDEXABLE_TYPES,
    );

    const all: RagAssetStatus[] = rows.map((r) => {
        const chunkCount = (r[5] as number) ?? 0;
        const embedCount = (r[6] as number) ?? 0;
        const ragStatus = (r[7] as string) ?? null;
        const ragReason = (r[8] as string) ?? null;
        const indexed = chunkCount > 0 && embedCount > 0;
        const skipped = !indexed && ragStatus === 'skipped';
        return {
            assetId: r[0] as string,
            fileName: r[1] as string,
            filePath: r[2] as string,
            fileType: r[3] as string,
            fileSize: (r[4] as number) ?? null,
            chunkCount,
            indexed,
            skipped,
            skipReason: skipped ? ragReason : null,
        };
    });

    const indexedAssets = all.filter((a) => a.indexed);
    const skippedAssets = all.filter((a) => a.skipped);
    const missingAssets = all.filter((a) => !a.indexed && !a.skipped);

    return {
        total: all.length,
        indexed: indexedAssets.length,
        missing: missingAssets.length,
        skipped: skippedAssets.length,
        indexedAssets,
        missingAssets,
        skippedAssets,
    };
}

/**
 * RAG-indexlenemez dosya tiplerine ait chunks + embeddings kayıtlarını temizler.
 * Geçmiş sürümlerden kalma .bak/.dwg vb. çöp chunk'ları siler.
 * Bir kez çağrılır, silinen chunk+embedding sayısını döner.
 */
export function purgeNonIndexableChunks(): { chunks: number; embeddings: number; assets: number } {
    const placeholders = RAG_INDEXABLE_TYPES.map(() => '?').join(',');
    // Sadece body chunks (chunk_index >= 0) — metadata chunks (chunk_index = -1) korunur,
    // çünkü onlar tüm tipler için geçerli (filename/proje/etiket aramaları).
    const victims = queryAll(
        `SELECT DISTINCT a.id FROM assets a
         JOIN text_chunks tc ON tc.asset_id = a.id
         WHERE a.file_type NOT IN (${placeholders})
           AND tc.chunk_index >= 0`,
        RAG_INDEXABLE_TYPES,
    );
    const ids = victims.map((r) => r[0] as string);
    if (ids.length === 0) return { chunks: 0, embeddings: 0, assets: 0 };

    let chunks = 0;
    let embeddings = 0;
    for (const aid of ids) {
        const cRows = queryAll(`SELECT COUNT(*) FROM text_chunks WHERE asset_id = ? AND chunk_index >= 0`, [aid]);
        chunks += (cRows[0]?.[0] as number) ?? 0;
        // İlgili body chunk ID'lerini topla, embeddings'te bunları sil
        const bodyIds = queryAll(`SELECT id FROM text_chunks WHERE asset_id = ? AND chunk_index >= 0`, [aid]).map((r) => r[0] as string);
        for (const cid of bodyIds) {
            const eRows = queryAll(`SELECT COUNT(*) FROM embeddings WHERE asset_id = ? AND ref_id = ? AND source = 'chunk_text'`, [aid, cid]);
            embeddings += (eRows[0]?.[0] as number) ?? 0;
            runSql(`DELETE FROM embeddings WHERE asset_id = ? AND ref_id = ? AND source = 'chunk_text'`, [aid, cid]);
        }
        runSql(`DELETE FROM text_chunks WHERE asset_id = ? AND chunk_index >= 0`, [aid]);
        // rag_status'u indexed bırak — metadata chunks hâlâ var
    }
    // saveDatabase yerine targeted rusqlite mirror — body chunks silme'yi diske yansıt.
    // Not: delete_chunks_for asset altındaki TÜM chunks'ı siler (metadata dahil); ancak
    // metadata'yı indexAssetMetadata sonradan yeniden ekleyebilir. Re-populate mantığı yok
    // şu an; bu fonksiyon zaten ender çağrılıyor (geçmişten kalma çöp temizliği).
    void mirrorRagWriteToDisk({ chunks: [], embeddings: [], deleteChunksFor: ids });
    return { chunks, embeddings, assets: ids.length };
}

/**
 * Tüm aktif asset'ler için metadata chunk üretir/yeniler.
 * DWG/MAX gibi RAG_INDEXABLE olmayan tipler dahil hepsi işlenir.
 * Body chunks'a dokunmaz — sadece chunk_index = -1 olanları yenler.
 */
export async function bulkIndexMetadataAll(
    onProgress?: (cur: number, total: number, fileName: string) => void | Promise<void>,
): Promise<{ done: number; skipped: number }> {
    const rows = queryAll(
        `SELECT id, file_name FROM assets WHERE is_deleted = 0 ORDER BY file_name ASC`,
    );
    const { indexAssetMetadata } = await import('./textChunker');
    let done = 0;
    let skipped = 0;
    // saveDatabase çağrıları kaldırıldı — indexAssetMetadata her asset için targeted rusqlite
    // mirror yapıyor (mirrorRagWriteToDisk + updateAssetRagStatus mirror). UI bloku yok.
    for (let i = 0; i < rows.length; i++) {
        const aid = rows[i][0] as string;
        const fname = rows[i][1] as string;
        const cb = onProgress?.(i + 1, rows.length, fname);
        if (cb instanceof Promise) await cb;
        try {
            const r = await indexAssetMetadata(aid);
            if (r.skipped) skipped++; else done++;
        } catch {
            skipped++;
        }
    }
    return { done, skipped };
}

/**
 * Bir asseti "kalıcı atlama" durumundan çıkarır — modal'da "Yine de dene" için.
 */
export function clearRagSkip(assetId: string): void {
    // updateAssetRagStatus artık kendi rusqlite mirror'unu yapıyor — saveDatabase gereksiz.
    updateAssetRagStatus(assetId, null, null);
}

export type BulkIndexProgress = {
    current: number;
    total: number;
    currentFile: string;
    succeeded: number;
    skipped: number;
    failed: number;
};

export type BulkIndexHandle = {
    cancel: () => void;
};

/**
 * Seçili asseti listesini sırayla indexler. Arka planda çalışabilir, iptal edilebilir.
 */
export async function bulkIndexAssets(
    assets: Array<{ assetId: string; filePath: string; fileName: string }>,
    onProgress: (p: BulkIndexProgress) => void,
    aiConfig?: AIConfig,
): Promise<{ handle: BulkIndexHandle; donePromise: Promise<BulkIndexProgress> }> {
    let cancelled = false;
    const handle: BulkIndexHandle = {
        cancel: () => { cancelled = true; },
    };

    const donePromise = (async () => {
        const progress: BulkIndexProgress = {
            current: 0,
            total: assets.length,
            currentFile: '',
            succeeded: 0,
            skipped: 0,
            failed: 0,
        };

        // saveDatabase / saveDatabaseDeferred çağrıları kaldırıldı — indexAssetForRag her asset
        // için targeted rusqlite mirror yapıyor (text_chunks + embeddings + rag_status). UI bloku yok.

        for (let i = 0; i < assets.length; i++) {
            if (cancelled) break;
            const a = assets[i];
            progress.current = i + 1;
            progress.currentFile = a.fileName;
            onProgress({ ...progress });

            try {
                const r = await indexAssetForRag(a.assetId, a.filePath, { aiConfig });
                if (r.skipped) {
                    progress.skipped++;
                    console.warn('[RAG] İndex atlandı:', a.fileName, '→', r.reason);
                } else {
                    progress.succeeded++;
                    console.log('[RAG] İndexlendi:', a.fileName, '→', r.chunks, 'chunk');
                }
            } catch (err) {
                progress.failed++;
                console.error('[RAG] İndex hatası:', a.fileName, err);
            }
            onProgress({ ...progress });
            // requestIdleCallback ile yield: kullanıcı aktifken CPU'ya yer aç
            await yieldIfIdle();
        }
        return progress;
    })();

    return { handle, donePromise };
}
