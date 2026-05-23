/**
 * ArchivistPro — Arşiv İşlem Servisi (Faz 2/3)
 *
 * Arşivler arası kopyalama, birleştirme (Join) ve filtreli çıkarma (Extract).
 * upsertAsset / saveEmbedding / tag fonksiyonları global `db` üzerinde çalıştığından,
 * `withArchive(targetId, op)` ile geçici olarak hedef arşivi aktif ederiz.
 */

import {
    withArchive,
    getAllAssetsFromArchive,
    getAllEmbeddingsFromArchive,
    getAllTextChunksFromArchive,
    getAllAssetSummariesFromArchive,
    getAllTagDataFromArchive,
    getAllFavoritesFromArchive,
    getArchiveSnapshot,
    restoreArchiveFromSnapshot,
    getArchiveSchemaEpoch,
    archiveIdToArchiveAt,
    tauriInvoke,
    tauriVoidInvoke,
    upsertAsset,
    saveAssetSummary,
    saveDatabase,
    isArchiveReady,
    createArchive,
    deleteAssetFromArchive,
    type ArchiveDef,
} from './database';
import type { Asset } from '../types';
import { debugLog, auditLog } from './logger';

/** Paralel merge engeli — aynı anda sadece bir join çalışabilir. */
let _joinInProgress = false;

/** Merge çalışmakta mı? UI için exposed. */
export function isJoinInProgress(): boolean {
    return _joinInProgress;
}

/** Merge'in zaten çalıştığını belirten hata sınıfı. */
export class JoinBusyError extends Error {
    constructor() {
        super('merge.error.alreadyRunning');
        this.name = 'JoinBusyError';
    }
}

/** Snapshot'tan restore başarısız olduğunda fırlatılan kritik hata. */
export class JoinRollbackFailedError extends Error {
    readonly originalError: unknown;
    readonly rollbackError: unknown;
    constructor(originalError: unknown, rollbackError: unknown) {
        super('merge.error.rollbackFailed');
        this.name = 'JoinRollbackFailedError';
        this.originalError = originalError;
        this.rollbackError = rollbackError;
    }
}

export type ConflictStrategy = 'keep_newer' | 'keep_both' | 'skip_existing';

export interface JoinOptions {
    sourceId: string;
    targetId: string;
    conflictStrategy: ConflictStrategy;
    includeEmbeddings: boolean;
    includeTags: boolean;
    includeFavorites: boolean;
    includeTextChunks: boolean;
    includeSummaries: boolean;
    onProgress?: (progress: JoinProgress) => void;
}

export interface JoinProgress {
    phase: 'assets' | 'tags' | 'embeddings' | 'chunks' | 'summaries' | 'favorites' | 'saving' | 'done';
    current: number;
    total: number;
    message: string;
}

export interface JoinResult {
    merged: number;
    skipped: number;
    overwritten: number;
    renamed: number;
    tagsCopied: number;
    embeddingsCopied: number;
    chunksCopied: number;
    summariesCopied: number;
    favoritesCopied: number;
    errors: string[];
}

export interface JoinPreview {
    sourceAssetCount: number;
    targetAssetCount: number;
    conflictCount: number;
    tagCount: number;
    embeddingCount: number;
}

/**
 * Join öncesi sayıları hesaplar. Herhangi bir yazma yapmaz.
 */
export function previewJoin(opts: Pick<JoinOptions, 'sourceId' | 'targetId'>): JoinPreview {
    if (!isArchiveReady(opts.sourceId) || !isArchiveReady(opts.targetId)) {
        return {
            sourceAssetCount: 0,
            targetAssetCount: 0,
            conflictCount: 0,
            tagCount: 0,
            embeddingCount: 0,
        };
    }
    const sourceAssets = getAllAssetsFromArchive(opts.sourceId);
    const targetAssets = getAllAssetsFromArchive(opts.targetId);
    const targetIds = new Set(targetAssets.map(a => a.id));
    const conflictCount = sourceAssets.filter(a => targetIds.has(a.id)).length;
    const tagData = getAllTagDataFromArchive(opts.sourceId);
    const embeddings = getAllEmbeddingsFromArchive(opts.sourceId);
    return {
        sourceAssetCount: sourceAssets.length,
        targetAssetCount: targetAssets.length,
        conflictCount,
        tagCount: tagData.tags.length,
        embeddingCount: embeddings.length,
    };
}

/**
 * Join için her asset'in çatışma durumunda ne olacağını döndürür.
 * UI scrollable list için kullanılır. previewJoin'in genişletilmiş hâli — yan yana çalışır.
 *
 * Disposition mantığı joinArchives ile aynıdır:
 * - 'merge'      → hedefte yok, eklenecek
 * - 'overwrite'  → çakışıyor + keep_newer, kaynak yeni
 * - 'skip'       → çakışıyor + skip_existing veya keep_newer (kaynak eski)
 * - 'rename'     → çakışıyor + keep_both
 */
export type JoinDisposition = 'merge' | 'overwrite' | 'skip' | 'rename';

export interface JoinDetailedItem {
    assetId: string;
    fileName: string;
    fileType: string;
    disposition: JoinDisposition;
}

export interface JoinDetailedPreview {
    items: JoinDetailedItem[];
    counts: Record<JoinDisposition, number>;
    sourceAssetCount: number;
    truncated: boolean;
    limit: number;
}

export function previewJoinDetailed(
    opts: Pick<JoinOptions, 'sourceId' | 'targetId' | 'conflictStrategy'>,
    limit = 500,
): JoinDetailedPreview {
    const empty: JoinDetailedPreview = {
        items: [],
        counts: { merge: 0, overwrite: 0, skip: 0, rename: 0 },
        sourceAssetCount: 0,
        truncated: false,
        limit,
    };
    if (!isArchiveReady(opts.sourceId) || !isArchiveReady(opts.targetId)) {
        return empty;
    }
    const sourceAssets = getAllAssetsFromArchive(opts.sourceId);
    const targetMap = new Map<string, Asset>(
        getAllAssetsFromArchive(opts.targetId).map(a => [a.id, a])
    );

    const counts: Record<JoinDisposition, number> = { merge: 0, overwrite: 0, skip: 0, rename: 0 };
    const items: JoinDetailedItem[] = [];

    for (const asset of sourceAssets) {
        const existing = targetMap.get(asset.id);
        let disposition: JoinDisposition;
        if (!existing) {
            disposition = 'merge';
        } else {
            switch (opts.conflictStrategy) {
                case 'skip_existing':
                    disposition = 'skip';
                    break;
                case 'keep_both':
                    disposition = 'rename';
                    break;
                case 'keep_newer': {
                    const sourceTime = new Date(asset.modifiedAt).getTime();
                    const targetTime = new Date(existing.modifiedAt).getTime();
                    disposition = sourceTime > targetTime ? 'overwrite' : 'skip';
                    break;
                }
            }
        }
        counts[disposition]++;
        if (items.length < limit) {
            items.push({
                assetId: asset.id,
                fileName: asset.fileName,
                fileType: asset.fileType,
                disposition,
            });
        }
    }

    return {
        items,
        counts,
        sourceAssetCount: sourceAssets.length,
        truncated: sourceAssets.length > limit,
        limit,
    };
}

/**
 * İki arşivi birleştirir: kaynak arşivden hedef arşive asset ve ilişkili verileri kopyalar.
 *
 * Önemli: target arşiv `dbMap`'te yüklü olmalı. Değilse çağıran taraf önce
 * initArchive/initLocalDatabase çağırmalı.
 *
 * Paralel merge engeli: bir merge çalışırken ikinci çağrı `JoinBusyError` fırlatır.
 * Hata durumunda: işlem öncesi alınan snapshot'tan hedef arşiv geri yüklenir.
 */
export async function joinArchives(opts: JoinOptions): Promise<JoinResult> {
    if (_joinInProgress) {
        throw new JoinBusyError();
    }

    const result: JoinResult = {
        merged: 0,
        skipped: 0,
        overwritten: 0,
        renamed: 0,
        tagsCopied: 0,
        embeddingsCopied: 0,
        chunksCopied: 0,
        summariesCopied: 0,
        favoritesCopied: 0,
        errors: [],
    };

    if (opts.sourceId === opts.targetId) {
        result.errors.push('Kaynak ve hedef arşiv aynı olamaz');
        return result;
    }
    if (!isArchiveReady(opts.sourceId)) {
        result.errors.push(`Kaynak arşiv yüklü değil: ${opts.sourceId}`);
        return result;
    }
    if (!isArchiveReady(opts.targetId)) {
        result.errors.push(`Hedef arşiv yüklü değil: ${opts.targetId}`);
        return result;
    }

    _joinInProgress = true;
    auditLog('ARCHIVE_JOIN_START', `${opts.sourceId}->${opts.targetId}`, {
        strategy: opts.conflictStrategy,
    });

    // Rollback snapshot — hata durumunda hedef arşivi bu byte'lardan geri yükleriz
    const snapshot = getArchiveSnapshot(opts.targetId);
    if (!snapshot) {
        _joinInProgress = false;
        result.errors.push(`Hedef arşiv snapshot alınamadı: ${opts.targetId}`);
        return result;
    }

    // Kaynak arşivden verileri oku (withArchive'a ihtiyaç yok — sadece okuma)
    const sourceAssets = getAllAssetsFromArchive(opts.sourceId);
    const targetAssetMap = new Map<string, Asset>(
        getAllAssetsFromArchive(opts.targetId).map(a => [a.id, a])
    );

    // ID eşleştirme: keep_both stratejisinde eski → yeni ID
    const idMap = new Map<string, string>();
    // Atlanan asset ID'leri — ilişkili verileri de atlamak için
    const skippedIds = new Set<string>();

    // ── Phase 1: Assets ──
    opts.onProgress?.({
        phase: 'assets',
        current: 0,
        total: sourceAssets.length,
        message: 'Asset\'ler kopyalanıyor',
    });

    try {
    await withArchive(opts.targetId, async () => {
        let i = 0;
        for (const asset of sourceAssets) {
            i++;
            try {
                const existing = targetAssetMap.get(asset.id);
                if (existing) {
                    switch (opts.conflictStrategy) {
                        case 'skip_existing':
                            result.skipped++;
                            skippedIds.add(asset.id);
                            break;
                        case 'keep_newer': {
                            const sourceTime = new Date(asset.modifiedAt).getTime();
                            const targetTime = new Date(existing.modifiedAt).getTime();
                            if (sourceTime > targetTime) {
                                upsertAsset(assetToUpsertPayload(asset));
                                result.overwritten++;
                            } else {
                                result.skipped++;
                                skippedIds.add(asset.id);
                            }
                            break;
                        }
                        case 'keep_both': {
                            const newId = crypto.randomUUID();
                            idMap.set(asset.id, newId);
                            upsertAsset(assetToUpsertPayload({ ...asset, id: newId }));
                            result.renamed++;
                            break;
                        }
                    }
                } else {
                    upsertAsset(assetToUpsertPayload(asset));
                    result.merged++;
                }
            } catch (err) {
                result.errors.push(`Asset ${asset.id}: ${String(err)}`);
                skippedIds.add(asset.id);
            }
            if (i % 25 === 0) {
                opts.onProgress?.({
                    phase: 'assets',
                    current: i,
                    total: sourceAssets.length,
                    message: 'Asset\'ler kopyalanıyor',
                });
                await yieldToUi();
            }
        }

        // ── Phase 2: Tags ──
        if (opts.includeTags) {
            opts.onProgress?.({
                phase: 'tags',
                current: 0,
                total: 0,
                message: 'Etiketler kopyalanıyor',
            });
            try {
                const sourceTagData = getAllTagDataFromArchive(opts.sourceId);
                // Hedefte mevcut tag'leri isim→id olarak eşle
                const targetTagData = getAllTagDataFromArchive(opts.targetId);
                const targetTagByName = new Map<string, number>(
                    targetTagData.tags.map(t => [t.name, t.id])
                );
                // source tag id → target tag id eşlemesi
                const tagIdMap = new Map<number, number>();
                for (const sourceTag of sourceTagData.tags) {
                    let targetTagId = targetTagByName.get(sourceTag.name);
                    if (targetTagId === undefined) {
                        // Yeni tag ekle — raw SQL ile, createTag saveDatabase çağırmasın
                        await withArchiveRaw(opts.targetId, (targetDb) => {
                            targetDb.run(
                                'INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)',
                                [sourceTag.name, sourceTag.color]
                            );
                            const idResult = targetDb.exec('SELECT id FROM tags WHERE name = ?', [sourceTag.name] as any);
                            if (idResult.length > 0 && idResult[0].values.length > 0) {
                                targetTagId = idResult[0].values[0][0] as number;
                            }
                        });
                        if (targetTagId !== undefined) {
                            result.tagsCopied++;
                        }
                    }
                    if (targetTagId !== undefined) {
                        tagIdMap.set(sourceTag.id, targetTagId);
                    }
                }
                // asset_tags ilişkilerini kopyala
                await withArchiveRaw(opts.targetId, (targetDb) => {
                    for (const link of sourceTagData.assetTags) {
                        if (skippedIds.has(link.assetId)) continue;
                        const targetAssetId = idMap.get(link.assetId) ?? link.assetId;
                        const targetTagId = tagIdMap.get(link.tagId);
                        if (targetTagId === undefined) continue;
                        try {
                            targetDb.run(
                                'INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)',
                                [targetAssetId, targetTagId]
                            );
                        } catch (err) {
                            result.errors.push(`Tag link: ${String(err)}`);
                        }
                    }
                });
            } catch (err) {
                result.errors.push(`Tags: ${String(err)}`);
            }
        }

        // ── Phase 3: Asset Summaries ──
        if (opts.includeSummaries) {
            opts.onProgress?.({
                phase: 'summaries',
                current: 0,
                total: 0,
                message: 'Özetler kopyalanıyor',
            });
            try {
                const summaries = getAllAssetSummariesFromArchive(opts.sourceId);
                for (const s of summaries) {
                    if (skippedIds.has(s.assetId)) continue;
                    const targetAssetId = idMap.get(s.assetId) ?? s.assetId;
                    try {
                        saveAssetSummary(targetAssetId, s.summary, s.keywords, s.model ?? undefined);
                        result.summariesCopied++;
                    } catch (err) {
                        result.errors.push(`Summary ${s.assetId}: ${String(err)}`);
                    }
                }
            } catch (err) {
                result.errors.push(`Summaries: ${String(err)}`);
            }
        }

        // ── Phase 4: Favorites ──
        if (opts.includeFavorites) {
            opts.onProgress?.({
                phase: 'favorites',
                current: 0,
                total: 0,
                message: 'Favoriler kopyalanıyor',
            });
            try {
                const sourceFavs = getAllFavoritesFromArchive(opts.sourceId);
                await withArchiveRaw(opts.targetId, (targetDb) => {
                    for (const favId of sourceFavs) {
                        if (skippedIds.has(favId)) continue;
                        const targetAssetId = idMap.get(favId) ?? favId;
                        try {
                            targetDb.run(
                                'INSERT OR IGNORE INTO favorites (asset_id) VALUES (?)',
                                [targetAssetId]
                            );
                            result.favoritesCopied++;
                        } catch (err) {
                            result.errors.push(`Favorite ${favId}: ${String(err)}`);
                        }
                    }
                });
            } catch (err) {
                result.errors.push(`Favorites: ${String(err)}`);
            }
        }

        // ── Phase 5: V3 verisi (embeddings + text_chunks) — epoch-aware ──
        // PRE-6e: kaynak/hedef epoch'a göre vec.db ⇄ sql.js (copyV3Data).
        // summaries+favorites SONRASI, save ÖNCESİ: hedef main(epoch>=1) ise
        // vec.db yazısı snapshot rollback kapsamı DIŞI → yetim penceresini
        // küçültmek için en sona alındı.
        if (opts.includeEmbeddings || opts.includeTextChunks) {
            opts.onProgress?.({
                phase: 'embeddings',
                current: 0,
                total: 0,
                message: 'AI vektörleri ve metin parçaları kopyalanıyor',
            });
            try {
                const v3 = await copyV3Data({
                    sourceId: opts.sourceId,
                    targetId: opts.targetId,
                    assetIds: sourceAssets.map(a => a.id),
                    idMap,
                    skippedIds,
                    includeEmbeddings: opts.includeEmbeddings,
                    includeTextChunks: opts.includeTextChunks,
                });
                result.embeddingsCopied += v3.embeddingsCopied;
                result.chunksCopied += v3.chunksCopied;
                result.errors.push(...v3.errors);
            } catch (err) {
                result.errors.push(`V3 kopya: ${String(err)}`);
            }
        }

        // ── Phase 6: Save ──
        opts.onProgress?.({
            phase: 'saving',
            current: 0,
            total: 0,
            message: 'Kaydediliyor',
        });
        try {
            saveDatabase();
        } catch (err) {
            result.errors.push(`Save: ${String(err)}`);
        }
    });
    } catch (err) {
        // Fatal hata — hedef arşivi snapshot'tan geri yükle
        auditLog('ARCHIVE_JOIN_FAILED', `${opts.sourceId}->${opts.targetId}`, {
            error: String(err),
        });
        try {
            await restoreArchiveFromSnapshot(opts.targetId, snapshot);
            debugLog('ArchiveOps', 'Hedef arşiv rollback başarılı', opts.targetId);
            result.errors.push(`Join başarısız, rollback yapıldı: ${String(err)}`);
        } catch (rollbackErr) {
            // Rollback bile başarısız — en kötü senaryo
            auditLog('ARCHIVE_JOIN_ROLLBACK_FAILED', `${opts.sourceId}->${opts.targetId}`, {
                error: String(err),
                rollbackError: String(rollbackErr),
            });
            _joinInProgress = false;
            throw new JoinRollbackFailedError(err, rollbackErr);
        }
    } finally {
        _joinInProgress = false;
    }

    opts.onProgress?.({
        phase: 'done',
        current: 1,
        total: 1,
        message: 'Tamamlandı',
    });

    auditLog('ARCHIVE_JOIN_COMPLETE', `${opts.sourceId}->${opts.targetId}`, {
        merged: result.merged,
        skipped: result.skipped,
        overwritten: result.overwritten,
        renamed: result.renamed,
        errors: result.errors.length,
    });

    return result;
}

/** Asset tipini upsertAsset'ın beklediği payload'a çevirir. */
function assetToUpsertPayload(asset: Asset): Parameters<typeof upsertAsset>[0] {
    return {
        id: asset.id,
        fileName: asset.fileName,
        filePath: asset.filePath,
        fileSize: asset.fileSize,
        fileType: asset.fileType,
        category: asset.category,
        createdAt: asset.createdAt,
        modifiedAt: asset.modifiedAt,
        projectName: asset.projectName,
        projectPhase: asset.projectPhase,
        materialGroup: asset.materialGroup,
        colorTheme: asset.colorTheme,
        architecturalStyle: asset.architecturalStyle,
        omniclassCode: asset.omniclassCode,
        thumbnailUrl: asset.thumbnailUrl,
        hash: asset.hash,
        phash: asset.phash,
        contentHash: asset.contentHash,
        rawMetadata: asset.rawMetadata,
        metadata: asset.metadata,
        aiTags: asset.aiTags,
        colorPalette: asset.colorPalette,
    };
}

/**
 * withArchive'ın raw DB'ye doğrudan erişim sağlayan varyantı.
 * Tag/favorite gibi düşük seviyeli INSERT OR IGNORE işlemleri için.
 */
async function withArchiveRaw<T>(
    archiveId: string,
    op: (db: {
        run: (sql: string, params?: unknown[]) => void;
        exec: (sql: string, params?: unknown[]) => Array<{ columns: string[]; values: unknown[][] }>;
    }) => T | Promise<T>,
): Promise<T> {
    // withArchive setActiveArchive değiştirir, getDatabase aktif db'yi verir
    const { getDatabase } = await import('./database');
    return await withArchive(archiveId, async () => {
        const db = getDatabase();
        if (!db) throw new Error('DB yüklü değil');
        return await op(db as any);
    });
}

/** UI'nın nefes almasını sağlar — uzun işlemlerde yield. */
function yieldToUi(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/* ══════════════════════════════════════════════════════════════════
 *        PRE-6e — Cross-archive V3 veri kopyası (epoch-aware)
 * ══════════════════════════════════════════════════════════════════
 * embeddings (epoch>=1) ve text_chunks (epoch>=2) migrasyon sonrası
 * vec.db'de yaşar. joinArchives/extractAssets'in eski embedding/chunk
 * kopyası `saveEmbedding`/`upsertTextChunk` kullanıyordu — bunlar GLOBAL
 * `_schemaEpoch`'a (yalnız main'i yansıtır) guard'lı → cross-archive'de
 * yanlış taraf. Bu modül kaynağı VE hedefi `getArchiveSchemaEpoch` ile
 * ayrı ayrı epoch-aware ele alır.
 *
 * NOT: `saveEmbedding`/`saveChunkEmbedding`/`upsertTextChunk` BİLİNÇLİ
 * kullanılmaz — global epoch guard'ı cross-archive bağlamda hatalı NOOP
 * üretir. Raw sql.js INSERT (epoch=0 hedef) / `vec_db_import_assets`
 * (epoch>=N hedef) ile yazılır.
 */

/** Kaynak/hedef şeklinden bağımsız kanonik embedding satırı.
 *  `vectorBytes` = `vector_blob` ham baytları (number[]). */
interface CanonEmbedding {
    id: string;
    assetId: string;
    refId: string | null;
    vectorBytes: number[];
    source: string;
}
interface CanonChunk {
    id: string;
    assetId: string;
    chunkIndex: number;
    page: number | null;
    text: string;
    lang: string | null;
}

interface CopyV3Options {
    sourceId: string;
    targetId: string;
    assetIds: string[];
    idMap: Map<string, string>;
    skippedIds: Set<string>;
    includeEmbeddings: boolean;
    includeTextChunks: boolean;
}

/** f32 değer dizisini `vector_blob` ham baytlarına (number[]) kodlar.
 *  `getAllEmbeddingsFromArchive` çözülmüş f32 döndürür; sink'ler ham bayt ister. */
function f32ValuesToBytes(vec: number[]): number[] {
    return Array.from(new Uint8Array(new Float32Array(vec).buffer));
}

/** Kaynak arşivden V3 verisini (embeddings + text_chunks) epoch-aware OKU. */
async function readV3FromArchive(
    sourceId: string,
    assetIds: string[],
): Promise<{ embeddings: CanonEmbedding[]; chunks: CanonChunk[]; errors: string[] }> {
    const errors: string[] = [];
    const srcEpoch = getArchiveSchemaEpoch(sourceId);
    const idSet = new Set(assetIds);
    let embeddings: CanonEmbedding[] = [];
    let chunks: CanonChunk[] = [];

    // epoch>=1 → embeddings vec.db'de; epoch>=2 → text_chunks da. Tek
    // vec_db_export_assets çağrısı ikisini birden döndürür (assetIds ile sınırlı).
    if (srcEpoch >= 1) {
        const exp = await tauriInvoke<{
            embeddings: Array<{ id: string; asset_id: string; ref_id: string | null; vector_blob: number[]; source: string }>;
            textChunks: Array<{ id: string; asset_id: string; chunk_index: number; page: number | null; text: string; lang: string | null }>;
        }>('vec_db_export_assets', { archiveAt: archiveIdToArchiveAt(sourceId), assetIds });
        if (exp) {
            embeddings = exp.embeddings.map((e) => ({
                id: e.id, assetId: e.asset_id, refId: e.ref_id ?? null,
                vectorBytes: e.vector_blob, source: e.source,
            }));
            if (srcEpoch >= 2) {
                chunks = exp.textChunks.map((c) => ({
                    id: c.id, assetId: c.asset_id, chunkIndex: c.chunk_index,
                    page: c.page ?? null, text: c.text, lang: c.lang ?? null,
                }));
            }
        } else {
            errors.push('vec_db_export_assets null — kaynak V3 verisi okunamadı');
        }
    }
    // epoch<1 → embeddings sql.js'te; epoch<2 → text_chunks sql.js'te.
    if (srcEpoch < 1) {
        embeddings = getAllEmbeddingsFromArchive(sourceId)
            .filter((e) => idSet.has(e.assetId))
            .map((e) => ({
                id: e.id, assetId: e.assetId, refId: e.refId,
                vectorBytes: f32ValuesToBytes(e.vector), source: e.source,
            }));
    }
    if (srcEpoch < 2) {
        chunks = getAllTextChunksFromArchive(sourceId)
            .filter((c) => idSet.has(c.assetId))
            .map((c) => ({
                id: c.id, assetId: c.assetId, chunkIndex: c.chunkIndex,
                page: c.page, text: c.text, lang: c.lang,
            }));
    }
    return { embeddings, chunks, errors };
}

/** Kanonik V3 satırlarını hedef arşive epoch-aware YAZ.
 *  embeddings epoch>=1, text_chunks epoch>=2 → vec.db (tek `vec_db_import_assets`);
 *  aksi → sql.js raw INSERT (tek transaction). Bir sink başarısızsa o satırlar
 *  0 kopyalanmış sayılır + `errors`'a eklenir. */
async function writeV3ToArchive(
    targetId: string,
    embeddings: CanonEmbedding[],
    chunks: CanonChunk[],
): Promise<{ embeddingsCopied: number; chunksCopied: number; errors: string[] }> {
    const errors: string[] = [];
    const tgtEpoch = getArchiveSchemaEpoch(targetId);
    let embeddingsCopied = 0;
    let chunksCopied = 0;

    // Hangi tablo nereye: epoch>=1 emb / epoch>=2 chunk → vec.db; aksi sql.js.
    const vecEmb = tgtEpoch >= 1 ? embeddings : [];
    const vecChunks = tgtEpoch >= 2 ? chunks : [];
    const sqlEmb = tgtEpoch < 1 ? embeddings : [];
    const sqlChunks = tgtEpoch < 2 ? chunks : [];

    // ── vec.db sink: tek vec_db_import_assets çağrısı ──
    if (vecEmb.length > 0 || vecChunks.length > 0) {
        const ok = await tauriVoidInvoke('vec_db_import_assets', {
            archiveAt: archiveIdToArchiveAt(targetId),
            data: {
                embeddings: vecEmb.map((e) => ({
                    id: e.id, asset_id: e.assetId, ref_id: e.refId,
                    vector_blob: e.vectorBytes, source: e.source,
                })),
                textChunks: vecChunks.map((c) => ({
                    id: c.id, asset_id: c.assetId, chunk_index: c.chunkIndex,
                    page: c.page, text: c.text, lang: c.lang,
                })),
                assetRelations: [],
            },
        });
        if (ok) {
            embeddingsCopied += vecEmb.length;
            chunksCopied += vecChunks.length;
        } else {
            errors.push('vec_db_import_assets başarısız');
        }
    }

    // ── sql.js sink: raw INSERT OR REPLACE (tek transaction) ──
    if (sqlEmb.length > 0 || sqlChunks.length > 0) {
        try {
            await withArchiveRaw(targetId, (tdb) => {
                tdb.run('BEGIN TRANSACTION');
                try {
                    for (const e of sqlEmb) {
                        tdb.run(
                            `INSERT OR REPLACE INTO embeddings (id, asset_id, ref_id, vector_json, vector_blob, source) VALUES (?, ?, ?, '', ?, ?)`,
                            [e.id, e.assetId, e.refId, new Uint8Array(e.vectorBytes), e.source],
                        );
                    }
                    for (const c of sqlChunks) {
                        tdb.run(
                            `INSERT OR REPLACE INTO text_chunks (id, asset_id, chunk_index, page, text, lang) VALUES (?, ?, ?, ?, ?, ?)`,
                            [c.id, c.assetId, c.chunkIndex, c.page, c.text, c.lang],
                        );
                    }
                    tdb.run('COMMIT');
                } catch (err) {
                    tdb.run('ROLLBACK');
                    throw err;
                }
            });
            embeddingsCopied += sqlEmb.length;
            chunksCopied += sqlChunks.length;
        } catch (err) {
            errors.push(`V3 sql.js INSERT: ${String(err)}`);
        }
    }
    return { embeddingsCopied, chunksCopied, errors };
}

/** PRE-6e — cross-archive V3 (embeddings + text_chunks) kopyası.
 *  joinArchives + extractAssets ortak fazı. Kaynak/hedef epoch'a göre
 *  vec.db ⇄ sql.js yönlendirir; `skippedIds` süzer, `idMap` ile asset_id
 *  remap eder (keep_both: yalnız asset_id — chunk/embedding id sabit kalır,
 *  epoch=0 davranışıyla aynı). */
async function copyV3Data(opts: CopyV3Options): Promise<{
    embeddingsCopied: number; chunksCopied: number; errors: string[];
}> {
    const errors: string[] = [];
    const read = await readV3FromArchive(opts.sourceId, opts.assetIds);
    errors.push(...read.errors);

    const remap = (assetId: string): string => opts.idMap.get(assetId) ?? assetId;
    const embeddings = opts.includeEmbeddings
        ? read.embeddings
            .filter((e) => !opts.skippedIds.has(e.assetId))
            .map((e) => ({ ...e, assetId: remap(e.assetId) }))
        : [];
    const chunks = opts.includeTextChunks
        ? read.chunks
            .filter((c) => !opts.skippedIds.has(c.assetId))
            .map((c) => ({ ...c, assetId: remap(c.assetId) }))
        : [];

    const write = await writeV3ToArchive(opts.targetId, embeddings, chunks);
    errors.push(...write.errors);
    return {
        embeddingsCopied: write.embeddingsCopied,
        chunksCopied: write.chunksCopied,
        errors,
    };
}

// ESLint unused import suppression — debugLog ileride eklenebilir
void debugLog;

/* ══════════════════════════════════════════════════════════════════
 *                  FAZ 3 — EXTRACT (Filtrelenmiş Çıkarma)
 * ══════════════════════════════════════════════════════════════════ */

/** Paralel extract engeli — aynı anda sadece bir extract çalışabilir. */
let _extractInProgress = false;

export function isExtractInProgress(): boolean {
    return _extractInProgress;
}

export class ExtractBusyError extends Error {
    constructor() {
        super('extract.error.alreadyRunning');
        this.name = 'ExtractBusyError';
    }
}

export class ExtractRollbackFailedError extends Error {
    readonly originalError: unknown;
    readonly rollbackError: unknown;
    constructor(originalError: unknown, rollbackError: unknown) {
        super('extract.error.rollbackFailed');
        this.name = 'ExtractRollbackFailedError';
        this.originalError = originalError;
        this.rollbackError = rollbackError;
    }
}

export interface ExtractFilter {
    folderPaths?: string[];
    fileTypes?: string[];
    projectNames?: string[];
    projectPhases?: string[];
    materialGroups?: string[];
    architecturalStyles?: string[];
    tagNames?: string[];
    dateFrom?: string;
    dateTo?: string;
}

export interface ExtractOptions {
    sourceId: string;
    targetMode: 'new' | 'existing';
    newArchiveName?: string;
    newArchiveType?: 'shared' | 'personal';
    existingTargetId?: string;
    filter: ExtractFilter;
    mode: 'copy' | 'move';
    includeEmbeddings: boolean;
    includeTags: boolean;
    includeTextChunks: boolean;
    includeSummaries: boolean;
    includeFavorites: boolean;
    onProgress?: (progress: ExtractProgress) => void;
}

export interface ExtractProgress {
    phase: 'filtering' | 'creating_target' | 'assets' | 'tags' | 'embeddings' | 'chunks' | 'summaries' | 'favorites' | 'deleting_source' | 'saving' | 'done';
    current: number;
    total: number;
    message: string;
}

export interface ExtractResult {
    matchedCount: number;
    extractedCount: number;
    deletedFromSource: number;
    tagsCopied: number;
    embeddingsCopied: number;
    chunksCopied: number;
    summariesCopied: number;
    favoritesCopied: number;
    targetArchiveId: string;
    errors: string[];
}

export interface ExtractPreview {
    matchedCount: number;
    fileTypeCounts: Record<string, number>;
    totalSizeBytes: number;
    hasActiveFilters: boolean;
}

/** Bir filtrede en az bir kriter aktif mi kontrolü. */
function hasAnyActiveFilter(filter: ExtractFilter): boolean {
    return !!(
        (filter.folderPaths && filter.folderPaths.length > 0) ||
        (filter.fileTypes && filter.fileTypes.length > 0) ||
        (filter.projectNames && filter.projectNames.length > 0) ||
        (filter.projectPhases && filter.projectPhases.length > 0) ||
        (filter.materialGroups && filter.materialGroups.length > 0) ||
        (filter.architecturalStyles && filter.architecturalStyles.length > 0) ||
        (filter.tagNames && filter.tagNames.length > 0) ||
        filter.dateFrom ||
        filter.dateTo
    );
}

/** Asset listesine filtre uygular. tagMap = asset_id → tag name Set. */
function applyExtractFilter(
    assets: Asset[],
    filter: ExtractFilter,
    tagMap: Map<string, Set<string>>,
): Asset[] {
    if (!hasAnyActiveFilter(filter)) return assets;

    return assets.filter(asset => {
        // Folder paths — prefix match (OR içinde) + genel AND
        if (filter.folderPaths && filter.folderPaths.length > 0) {
            const match = filter.folderPaths.some(root => asset.filePath.startsWith(root));
            if (!match) return false;
        }
        // File types — IN
        if (filter.fileTypes && filter.fileTypes.length > 0) {
            if (!filter.fileTypes.includes(asset.fileType)) return false;
        }
        // Project names
        if (filter.projectNames && filter.projectNames.length > 0) {
            if (!filter.projectNames.includes(asset.projectName)) return false;
        }
        // Project phases
        if (filter.projectPhases && filter.projectPhases.length > 0) {
            if (!filter.projectPhases.includes(asset.projectPhase)) return false;
        }
        // Material groups
        if (filter.materialGroups && filter.materialGroups.length > 0) {
            if (!asset.materialGroup || !filter.materialGroups.includes(asset.materialGroup)) return false;
        }
        // Architectural styles
        if (filter.architecturalStyles && filter.architecturalStyles.length > 0) {
            if (!asset.architecturalStyle || !filter.architecturalStyles.includes(asset.architecturalStyle)) return false;
        }
        // Tags — asset'in herhangi bir tag'i filtre listesiyle kesişiyor mu
        if (filter.tagNames && filter.tagNames.length > 0) {
            const assetTags = tagMap.get(asset.id);
            if (!assetTags) return false;
            const hasMatch = filter.tagNames.some(tn => assetTags.has(tn));
            if (!hasMatch) return false;
        }
        // Date range
        if (filter.dateFrom || filter.dateTo) {
            const assetTime = new Date(asset.modifiedAt).getTime();
            if (filter.dateFrom && assetTime < new Date(filter.dateFrom).getTime()) return false;
            if (filter.dateTo && assetTime > new Date(filter.dateTo).getTime()) return false;
        }
        return true;
    });
}

/** Verilen arşiv için asset_id → tag name Set eşlemesi oluşturur. */
function buildTagMapForArchive(archiveId: string): Map<string, Set<string>> {
    const tagData = getAllTagDataFromArchive(archiveId);
    const tagIdToName = new Map<number, string>(
        tagData.tags.map(t => [t.id, t.name])
    );
    const result = new Map<string, Set<string>>();
    for (const link of tagData.assetTags) {
        const tagName = tagIdToName.get(link.tagId);
        if (!tagName) continue;
        let set = result.get(link.assetId);
        if (!set) {
            set = new Set();
            result.set(link.assetId, set);
        }
        set.add(tagName);
    }
    return result;
}

/**
 * Extract için her asset'in detaylı eşleşme bilgisini döndürür.
 * UI scrollable list için kullanılır. previewExtract'in genişletilmiş hâli — yan yana çalışır.
 *
 * Limit ile büyük arşivlerde DOM yükünü sınırlar (varsayılan 500).
 */
export interface ExtractDetailedItem {
    id: string;
    fileName: string;
    filePath: string;
    fileType: string;
    fileSize: number;
    modifiedAt: string;
}

export interface ExtractDetailedPreview {
    items: ExtractDetailedItem[];
    matchedCount: number;
    truncated: boolean;
    limit: number;
}

export function previewExtractDetailed(
    opts: Pick<ExtractOptions, 'sourceId' | 'filter'>,
    limit = 500,
): ExtractDetailedPreview {
    if (!isArchiveReady(opts.sourceId)) {
        return { items: [], matchedCount: 0, truncated: false, limit };
    }
    const assets = getAllAssetsFromArchive(opts.sourceId);
    const tagMap = buildTagMapForArchive(opts.sourceId);
    const matched = applyExtractFilter(assets, opts.filter, tagMap);
    const items: ExtractDetailedItem[] = matched.slice(0, limit).map(a => ({
        id: a.id,
        fileName: a.fileName,
        filePath: a.filePath,
        fileType: a.fileType,
        fileSize: a.fileSize || 0,
        modifiedAt: a.modifiedAt,
    }));
    return {
        items,
        matchedCount: matched.length,
        truncated: matched.length > limit,
        limit,
    };
}

/**
 * Extract öncesi sayıları ve eşleşmeleri hesaplar. Yazma yapmaz.
 */
export function previewExtract(opts: Pick<ExtractOptions, 'sourceId' | 'filter'>): ExtractPreview {
    if (!isArchiveReady(opts.sourceId)) {
        return { matchedCount: 0, fileTypeCounts: {}, totalSizeBytes: 0, hasActiveFilters: false };
    }
    const assets = getAllAssetsFromArchive(opts.sourceId);
    const tagMap = buildTagMapForArchive(opts.sourceId);
    const matched = applyExtractFilter(assets, opts.filter, tagMap);
    const fileTypeCounts: Record<string, number> = {};
    let totalSize = 0;
    for (const a of matched) {
        fileTypeCounts[a.fileType] = (fileTypeCounts[a.fileType] ?? 0) + 1;
        totalSize += a.fileSize || 0;
    }
    return {
        matchedCount: matched.length,
        fileTypeCounts,
        totalSizeBytes: totalSize,
        hasActiveFilters: hasAnyActiveFilter(opts.filter),
    };
}

/**
 * Kaynak arşivden filtre kriterlerine uyan asset'leri hedef arşive kopyalar/taşır.
 *
 * Hedef arşiv ya mevcut bir arşivdir (targetMode='existing') ya da yeni oluşturulur
 * (targetMode='new'). Yeni arşiv oluşturulma başarısız olursa hata fırlatır.
 *
 * Rollback stratejisi:
 * - targetMode='existing': Hedef snapshot alınır, hata olursa restore edilir
 * - targetMode='new': Hata olursa yeni arşiv tamamen silinir (delete_archive_file + store.removeArchive)
 * - mode='move': Kaynak snapshot ayrıca alınır, kaynaktan silme hata verirse kaynak restore edilir
 *
 * Store senkronizasyonu: yeni arşiv oluşturulduğunda çağıran taraf (UI) store'a
 * addArchive çağırmalı. extractAssets sadece `targetArchiveId` döndürür.
 */
export async function extractAssets(opts: ExtractOptions): Promise<ExtractResult> {
    if (_extractInProgress) {
        throw new ExtractBusyError();
    }

    const result: ExtractResult = {
        matchedCount: 0,
        extractedCount: 0,
        deletedFromSource: 0,
        tagsCopied: 0,
        embeddingsCopied: 0,
        chunksCopied: 0,
        summariesCopied: 0,
        favoritesCopied: 0,
        targetArchiveId: '',
        errors: [],
    };

    // Validasyon
    if (!isArchiveReady(opts.sourceId)) {
        result.errors.push(`Kaynak arşiv yüklü değil: ${opts.sourceId}`);
        return result;
    }
    if (opts.targetMode === 'existing') {
        if (!opts.existingTargetId) {
            result.errors.push('Mevcut hedef arşiv ID belirtilmedi');
            return result;
        }
        if (opts.existingTargetId === opts.sourceId) {
            result.errors.push('Hedef kaynaktan farklı olmalı');
            return result;
        }
        if (!isArchiveReady(opts.existingTargetId)) {
            result.errors.push(`Hedef arşiv yüklü değil: ${opts.existingTargetId}`);
            return result;
        }
    } else {
        if (!opts.newArchiveName || opts.newArchiveName.trim() === '') {
            result.errors.push('Yeni arşiv adı boş olamaz');
            return result;
        }
    }

    _extractInProgress = true;
    auditLog('ARCHIVE_EXTRACT_START', opts.sourceId, {
        targetMode: opts.targetMode,
        mode: opts.mode,
    });

    // Phase 0 — Filtreleme
    opts.onProgress?.({ phase: 'filtering', current: 0, total: 0, message: 'Filtreleniyor' });
    const sourceAssets = getAllAssetsFromArchive(opts.sourceId);
    const sourceTagMap = buildTagMapForArchive(opts.sourceId);
    const matched = applyExtractFilter(sourceAssets, opts.filter, sourceTagMap);
    result.matchedCount = matched.length;

    if (matched.length === 0) {
        _extractInProgress = false;
        result.errors.push('Filtre ile eşleşen asset yok');
        return result;
    }

    const matchedIds = new Set(matched.map(a => a.id));

    // Phase 0.5 — Hedef arşivi belirle / oluştur
    let targetId: string;
    let targetCreated = false;
    let targetSnapshot: Uint8Array | null = null;

    try {
        if (opts.targetMode === 'new') {
            opts.onProgress?.({ phase: 'creating_target', current: 0, total: 0, message: 'Yeni arşiv oluşturuluyor' });
            const newId = crypto.randomUUID();
            const def: ArchiveDef = {
                id: newId,
                name: opts.newArchiveName!.trim(),
                type: opts.newArchiveType ?? 'personal',
                createdAt: new Date().toISOString(),
            };
            await createArchive(def);
            targetId = newId;
            targetCreated = true;
            result.targetArchiveId = newId;
            // Snapshot alma — yeni arşiv boş, snapshot alabiliriz ama hata durumunda
            // tamamen silmek daha temiz, snapshot'a gerek yok
        } else {
            targetId = opts.existingTargetId!;
            result.targetArchiveId = targetId;
            targetSnapshot = getArchiveSnapshot(targetId);
            if (!targetSnapshot) {
                throw new Error(`Hedef snapshot alınamadı: ${targetId}`);
            }
        }
    } catch (err) {
        _extractInProgress = false;
        result.errors.push(`Hedef hazırlanamadı: ${String(err)}`);
        auditLog('ARCHIVE_EXTRACT_FAILED', opts.sourceId, { phase: 'target_prep', error: String(err) });
        return result;
    }

    // Source snapshot — move modunda source'tan silme başarısız olursa restore için
    let sourceSnapshot: Uint8Array | null = null;
    if (opts.mode === 'move') {
        sourceSnapshot = getArchiveSnapshot(opts.sourceId);
        if (!sourceSnapshot) {
            _extractInProgress = false;
            result.errors.push(`Kaynak snapshot alınamadı: ${opts.sourceId}`);
            return result;
        }
    }

    // Ana kopyalama — hata olursa rollback
    try {
        await withArchive(targetId, async () => {
            // Phase 1: Assets
            opts.onProgress?.({ phase: 'assets', current: 0, total: matched.length, message: 'Asset\'ler kopyalanıyor' });
            let i = 0;
            for (const asset of matched) {
                i++;
                try {
                    upsertAsset(assetToUpsertPayload(asset));
                    result.extractedCount++;
                } catch (err) {
                    result.errors.push(`Asset ${asset.id}: ${String(err)}`);
                }
                if (i % 25 === 0) {
                    opts.onProgress?.({ phase: 'assets', current: i, total: matched.length, message: 'Asset\'ler kopyalanıyor' });
                    await yieldToUi();
                }
            }

            // Phase 2: Tags
            if (opts.includeTags) {
                opts.onProgress?.({ phase: 'tags', current: 0, total: 0, message: 'Etiketler kopyalanıyor' });
                try {
                    const sourceTagData = getAllTagDataFromArchive(opts.sourceId);
                    const targetTagData = getAllTagDataFromArchive(targetId);
                    const targetTagByName = new Map<string, number>(
                        targetTagData.tags.map(t => [t.name, t.id])
                    );
                    const tagIdMap = new Map<number, number>();
                    for (const sourceTag of sourceTagData.tags) {
                        let targetTagId = targetTagByName.get(sourceTag.name);
                        if (targetTagId === undefined) {
                            await withArchiveRaw(targetId, (targetDb) => {
                                targetDb.run(
                                    'INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)',
                                    [sourceTag.name, sourceTag.color]
                                );
                                const idResult = targetDb.exec('SELECT id FROM tags WHERE name = ?', [sourceTag.name] as any);
                                if (idResult.length > 0 && idResult[0].values.length > 0) {
                                    targetTagId = idResult[0].values[0][0] as number;
                                }
                            });
                            if (targetTagId !== undefined) result.tagsCopied++;
                        }
                        if (targetTagId !== undefined) tagIdMap.set(sourceTag.id, targetTagId);
                    }
                    await withArchiveRaw(targetId, (targetDb) => {
                        for (const link of sourceTagData.assetTags) {
                            if (!matchedIds.has(link.assetId)) continue;
                            const targetTagId = tagIdMap.get(link.tagId);
                            if (targetTagId === undefined) continue;
                            try {
                                targetDb.run(
                                    'INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)',
                                    [link.assetId, targetTagId]
                                );
                            } catch (err) {
                                result.errors.push(`Tag link: ${String(err)}`);
                            }
                        }
                    });
                } catch (err) {
                    result.errors.push(`Tags: ${String(err)}`);
                }
            }

            // Phase 3: Summaries
            if (opts.includeSummaries) {
                opts.onProgress?.({ phase: 'summaries', current: 0, total: 0, message: 'Özetler kopyalanıyor' });
                try {
                    const summaries = getAllAssetSummariesFromArchive(opts.sourceId);
                    for (const s of summaries) {
                        if (!matchedIds.has(s.assetId)) continue;
                        try {
                            saveAssetSummary(s.assetId, s.summary, s.keywords, s.model ?? undefined);
                            result.summariesCopied++;
                        } catch (err) {
                            result.errors.push(`Summary ${s.assetId}: ${String(err)}`);
                        }
                    }
                } catch (err) {
                    result.errors.push(`Summaries: ${String(err)}`);
                }
            }

            // Phase 4: Favorites
            if (opts.includeFavorites) {
                opts.onProgress?.({ phase: 'favorites', current: 0, total: 0, message: 'Favoriler kopyalanıyor' });
                try {
                    const sourceFavs = getAllFavoritesFromArchive(opts.sourceId);
                    await withArchiveRaw(targetId, (targetDb) => {
                        for (const favId of sourceFavs) {
                            if (!matchedIds.has(favId)) continue;
                            try {
                                targetDb.run(
                                    'INSERT OR IGNORE INTO favorites (asset_id) VALUES (?)',
                                    [favId]
                                );
                                result.favoritesCopied++;
                            } catch (err) {
                                result.errors.push(`Favorite ${favId}: ${String(err)}`);
                            }
                        }
                    });
                } catch (err) {
                    result.errors.push(`Favorites: ${String(err)}`);
                }
            }

            // Phase 5: V3 verisi (embeddings + text_chunks) — epoch-aware ──
            // PRE-6e: copyV3Data, kaynak/hedef epoch'a göre vec.db ⇄ sql.js.
            // summaries+favorites SONRASI / save ÖNCESİ (rollback boşluğu azaltma).
            if (opts.includeEmbeddings || opts.includeTextChunks) {
                opts.onProgress?.({ phase: 'embeddings', current: 0, total: 0, message: 'AI vektörleri ve metin parçaları kopyalanıyor' });
                try {
                    const v3 = await copyV3Data({
                        sourceId: opts.sourceId,
                        targetId,
                        assetIds: matched.map(a => a.id),
                        idMap: new Map(),
                        skippedIds: new Set(),
                        includeEmbeddings: opts.includeEmbeddings,
                        includeTextChunks: opts.includeTextChunks,
                    });
                    result.embeddingsCopied += v3.embeddingsCopied;
                    result.chunksCopied += v3.chunksCopied;
                    result.errors.push(...v3.errors);
                } catch (err) {
                    result.errors.push(`V3 kopya: ${String(err)}`);
                }
            }

            // Phase 6: Save target
            opts.onProgress?.({ phase: 'saving', current: 0, total: 0, message: 'Kaydediliyor' });
            saveDatabase();
        });
    } catch (err) {
        // Hedefte hata — rollback
        auditLog('ARCHIVE_EXTRACT_FAILED', opts.sourceId, { phase: 'target_write', error: String(err) });
        try {
            if (targetCreated) {
                // Yeni arşivi tamamen sil (config'den + diskten)
                const { invoke } = await import('@tauri-apps/api/core');
                await invoke('delete_archive_file', { archiveId: targetId }).catch(() => {});
                const { unloadArchive } = await import('./database');
                unloadArchive(targetId);
            } else if (targetSnapshot) {
                await restoreArchiveFromSnapshot(targetId, targetSnapshot);
            }
        } catch (rollbackErr) {
            _extractInProgress = false;
            throw new ExtractRollbackFailedError(err, rollbackErr);
        }
        _extractInProgress = false;
        result.errors.push(`Extract başarısız, rollback yapıldı: ${String(err)}`);
        return result;
    }

    // Phase 8 — Move modunda kaynaktan sil
    if (opts.mode === 'move') {
        opts.onProgress?.({ phase: 'deleting_source', current: 0, total: matched.length, message: 'Kaynaktan siliniyor' });
        try {
            let i = 0;
            for (const asset of matched) {
                i++;
                try {
                    const deleted = deleteAssetFromArchive(asset.id, opts.sourceId);
                    if (deleted) result.deletedFromSource++;
                } catch (err) {
                    result.errors.push(`Delete ${asset.id}: ${String(err)}`);
                }
                if (i % 25 === 0) {
                    opts.onProgress?.({ phase: 'deleting_source', current: i, total: matched.length, message: 'Kaynaktan siliniyor' });
                    await yieldToUi();
                }
            }
        } catch (err) {
            // Kaynaktan silme fatal hata — kaynak snapshot'tan restore
            auditLog('ARCHIVE_EXTRACT_FAILED', opts.sourceId, { phase: 'source_delete', error: String(err) });
            if (sourceSnapshot) {
                try {
                    await restoreArchiveFromSnapshot(opts.sourceId, sourceSnapshot);
                    result.errors.push(`Kaynaktan silme başarısız, kaynak restore edildi: ${String(err)}`);
                } catch (rollbackErr) {
                    _extractInProgress = false;
                    throw new ExtractRollbackFailedError(err, rollbackErr);
                }
            }
        }
    }

    _extractInProgress = false;
    opts.onProgress?.({ phase: 'done', current: 1, total: 1, message: 'Tamamlandı' });
    auditLog('ARCHIVE_EXTRACT_COMPLETE', opts.sourceId, {
        targetArchiveId: result.targetArchiveId,
        matched: result.matchedCount,
        extracted: result.extractedCount,
        deletedFromSource: result.deletedFromSource,
        errors: result.errors.length,
    });
    return result;
}
