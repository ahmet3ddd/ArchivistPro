/**
 * RAG index durum analizi ve toplu indexleme.
 * Hangi DOC-tipi assetlerde chunk_text embedding var, hangisinde yok onu raporlar.
 */

import { queryAll, runSql, updateAssetRagStatus, mirrorRagWriteToDisk, getRagIndexCountMapsAsync, getBodyChunkCountsAsync, getSchemaEpoch } from './database';
import { indexAssetForRag } from './textChunker';
import { debugLog } from './logger';
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
export async function analyzeRagIndex(): Promise<RagIndexReport> {
    const placeholders = RAG_INDEXABLE_TYPES.map(() => '?').join(',');
    // V3 PRE-5f: chunk/embedding sayımları epoch>=1'de vec.db'de — sql.js
    // alt-sorgusu kırılır. Asset listesi sql.js'ten, sayımlar map merge ile.
    const rows = queryAll(
        `SELECT a.id, a.file_name, a.file_path, a.file_type, a.file_size,
                a.rag_status, a.rag_status_reason
         FROM assets a
         WHERE a.file_type IN (${placeholders})
         ORDER BY a.file_name ASC`,
        RAG_INDEXABLE_TYPES,
    );
    const { chunkCounts, embedCounts } = await getRagIndexCountMapsAsync();

    const all: RagAssetStatus[] = rows.map((r) => {
        const assetId = r[0] as string;
        const chunkCount = chunkCounts.get(assetId) ?? 0;
        const embedCount = embedCounts.get(assetId) ?? 0;
        const ragStatus = (r[5] as string) ?? null;
        const ragReason = (r[6] as string) ?? null;
        const indexed = chunkCount > 0 && embedCount > 0;
        const skipped = !indexed && ragStatus === 'skipped';
        return {
            assetId,
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
 * RAG-indexlenemez dosya tiplerine ait body chunks + embeddings kayıtlarını
 * temizler. Geçmiş sürümlerden kalma .bak/.dwg vb. çöp chunk'ları siler.
 * Metadata chunks (`chunk_index = -1`) korunur — tüm tipler için geçerli.
 *
 * **V3 PRE-6b — yazma-yolu epoch routing:**
 * - epoch<2 → BİREBİR eski sql.js yolu (epoch=1'de embeddings DELETE'i
 *   atlanır; tablo vec.db'de — gerçek silme aşağıdaki mirror ile).
 * - epoch>=2 → `text_chunks` vec.db'de: victim seçimi non-indexable
 *   file_type (sql.js) ∩ body-chunk sayımları (`getBodyChunkCountsAsync`).
 * Her durumda silme `mirrorRagWriteToDisk` → `scan_write_batch`
 * `delete_chunks_for` (PRE-3a epoch-aware) ile diske yansıtılır.
 */
export async function purgeNonIndexableChunks(): Promise<{ chunks: number; embeddings: number; assets: number }> {
    const placeholders = RAG_INDEXABLE_TYPES.map(() => '?').join(',');
    const epoch = getSchemaEpoch();

    let victims: string[];
    let chunks = 0;
    let embeddings = 0;

    if (epoch >= 2) {
        // text_chunks vec.db'de — non-indexable file_type'lar sql.js'ten,
        // body-chunk sayımları vec.db'den (metadata chunk'lar hariç).
        const nonIndexableIds = queryAll(
            `SELECT id FROM assets WHERE file_type NOT IN (${placeholders})`,
            RAG_INDEXABLE_TYPES,
        ).map((r) => r[0] as string);
        const { chunkCounts, embedCounts } = await getBodyChunkCountsAsync();
        victims = nonIndexableIds.filter((id) => (chunkCounts.get(id) ?? 0) > 0);
        for (const v of victims) {
            chunks += chunkCounts.get(v) ?? 0;
            embeddings += embedCounts.get(v) ?? 0;
        }
    } else {
        // epoch 0/1: text_chunks sql.js'te → eski victim sorgusu.
        const victimRows = queryAll(
            `SELECT DISTINCT a.id FROM assets a
             JOIN text_chunks tc ON tc.asset_id = a.id
             WHERE a.file_type NOT IN (${placeholders})
               AND tc.chunk_index >= 0`,
            RAG_INDEXABLE_TYPES,
        );
        victims = victimRows.map((r) => r[0] as string);
        for (const aid of victims) {
            const cRows = queryAll(`SELECT COUNT(*) FROM text_chunks WHERE asset_id = ? AND chunk_index >= 0`, [aid]);
            chunks += (cRows[0]?.[0] as number) ?? 0;
            // embeddings: epoch=0 → sql.js'te say + sil; epoch=1 → embeddings
            // vec.db'de (sayım atlanır, kozmetik; gerçek silme mirror ile).
            if (epoch < 1) {
                const bodyIds = queryAll(`SELECT id FROM text_chunks WHERE asset_id = ? AND chunk_index >= 0`, [aid]).map((r) => r[0] as string);
                for (const cid of bodyIds) {
                    const eRows = queryAll(`SELECT COUNT(*) FROM embeddings WHERE asset_id = ? AND ref_id = ? AND source = 'chunk_text'`, [aid, cid]);
                    embeddings += (eRows[0]?.[0] as number) ?? 0;
                    runSql(`DELETE FROM embeddings WHERE asset_id = ? AND ref_id = ? AND source = 'chunk_text'`, [aid, cid]);
                }
            }
            runSql(`DELETE FROM text_chunks WHERE asset_id = ? AND chunk_index >= 0`, [aid]);
            // rag_status'u indexed bırak — metadata chunks hâlâ var
        }
    }

    if (victims.length === 0) return { chunks: 0, embeddings: 0, assets: 0 };

    // Targeted rusqlite mirror — body chunks silmeyi diske yansıt. scan_write_batch
    // delete_chunks_for epoch-aware (PRE-3a): epoch>=2 vec.db delete_chunks_for_assets,
    // aksi halde main DB. Not: delete_chunks_for asset altındaki TÜM chunks'ı siler
    // (metadata dahil) — eski davranış birebir; ender çağrılan çöp temizliği.
    // await: epoch>=2'de RagIndexModal refresh()'i silme bitmeden vec.db okumasın.
    await mirrorRagWriteToDisk({ chunks: [], embeddings: [], deleteChunksFor: victims });
    return { chunks, embeddings, assets: victims.length };
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
                    debugLog('RAG', `İndex atlandı: ${a.fileName} → ${r.reason}`);
                } else {
                    progress.succeeded++;
                    debugLog('RAG', `İndexlendi: ${a.fileName} → ${r.chunks} chunk`);
                }
            } catch (err) {
                progress.failed++;
                debugLog('RAG', `İndex hatası: ${a.fileName}`, err);
            }
            onProgress({ ...progress });
            // requestIdleCallback ile yield: kullanıcı aktifken CPU'ya yer aç
            await yieldIfIdle();
        }
        return progress;
    })();

    return { handle, donePromise };
}
