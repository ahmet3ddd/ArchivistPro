/**
 * RAG için metin parçalama (chunking) ve indexleme servisi.
 *
 * Akış: asset → Rust `extract_text_for_indexing` → chunk'lara böl →
 * her chunk için MiniLM embedding → text_chunks + embeddings tablolarına yaz.
 *
 * Chunk boyutu yaklaşık 500 "kelime-token" (whitespace bazlı basit tokenizer),
 * 50 token overlap. Gerçek bir BPE tokenizer gerekli değil — MiniLM kendi
 * içinde 512 token penceresine truncate eder.
 */

import { invoke } from '@tauri-apps/api/core';
import { generateBatchEmbeddings, generateEmbedding } from './embeddings';
import {
    upsertTextChunk,
    saveChunkEmbedding,
    deleteTextChunksByAssetId,
    deleteChunkEmbeddingsByAssetId,
    mirrorRagWriteToDisk,
    updateAssetRagStatus,
    getAssetById,
    runSql,
    queryAll,
    insertFtsChunk,
    deleteFtsChunksByAssetId,
    type TextChunkRow,
} from './database';
import { debugLog } from './logger';
import type { Asset } from '../types';
import { ocrImageToText } from './ocr';
import type { AIConfig } from '../components/AISettingsModal';

export type ChunkingOptions = {
    /** Chunk başına yaklaşık kelime sayısı (varsayılan 500) */
    chunkSize?: number;
    /** Komşu chunk'lar arası kelime overlap (varsayılan 50) */
    overlap?: number;
    /** Rust tarafından metin çekerken tavan karakter limiti */
    maxChars?: number;
    /** OCR fallback için Ollama/AI ayarları */
    aiConfig?: AIConfig;
    /** true ise saveDatabase() atlanır — toplu indekslemede caller batch-save yapar.
     *  Per-asset save 100MB+ DB'yi her dosyada disk'e yazıyor (UI bloku + N² maliyet). */
    skipSave?: boolean;
};

export type IndexingResult = {
    assetId: string;
    chunks: number;
    skipped: boolean;
    reason?: string;
    kind?: string;
};

type ExtractedText = {
    text: string;
    truncated: boolean;
    kind: string;
};

/**
 * Bir metni ~chunkSize kelimelik, `overlap` kelimelik örtüşmeli parçalara böler.
 * Boş metin veya çok kısa metin için tek parça döner (en az 1 kelime varsa).
 */
export function chunkText(
    text: string,
    chunkSize: number = 500,
    overlap: number = 50,
): string[] {
    // Süs/ayraç karakterlerini (▬ █ ─ ═ ▀ ▄ ░ ▒ ▓ ◆ ◇ ● ○ ■ □ • · etc.) boşluğa indir.
    // DOCX/PDF'lerde tablo ayracı veya imza satırı olarak yaygın; anlamsız chunk gürültüsü yaratır.
    const cleaned = text
        .replace(/[\u2500-\u257F\u2580-\u259F\u25A0-\u25FF\u2600-\u26FF■□▪▫●○◆◇▬─═▀▄░▒▓]{2,}/g, ' ')
        .replace(/\uFFFD/g, ' '); // replacement chars
    const normalized = cleaned.replace(/\s+/g, ' ').trim();
    if (!normalized) return [];

    const words = normalized.split(' ');
    if (words.length <= chunkSize) return [normalized];

    const step = Math.max(1, chunkSize - overlap);
    const chunks: string[] = [];
    for (let i = 0; i < words.length; i += step) {
        const slice = words.slice(i, i + chunkSize);
        if (slice.length === 0) break;
        chunks.push(slice.join(' '));
        if (i + chunkSize >= words.length) break;
    }
    return chunks;
}

/**
 * Bir asset'i RAG için indexler:
 *   1. Rust üzerinden metni çek (PDF/DOC/XLS/TXT vb.)
 *   2. Chunk'lara böl
 *   3. MiniLM ile batch embedding üret
 *   4. text_chunks + embeddings tablolarına yaz (eskiler silinir)
 *   5. saveDatabase ile diske yaz
 *
 * @returns Üretilen chunk sayısı ve durum.
 */
/** Asset metadata'sından arama-indeksli kısa metin üretir.
 * Filename + project + tags + DWG layers vb. — sidebar'ın gördüğü meta alanları.
 */
/**
 * DWG/DXF shape index'ten doğal dil özet üretir (Faz 4.1).
 * Format: "3 daire, 2 adet düzgün sekizgen (HAVUZ), 4 dikdörtgen | KATEGORİ: 2×HAVUZ, 15×DUVAR"
 * Tabloda kayıt yoksa null döner → çağıran satırı atlar.
 */
export function buildGeometricSummary(assetId: string): string | null {
    const rows = queryAll(
        `SELECT entity_type, layer_category, vertex_count, is_closed, regularity, aspect_ratio
         FROM dwg_shapes WHERE asset_id = ?`,
        [assetId],
    );
    if (!rows.length) return null;

    const gonNames: Record<number, string> = {
        3: 'üçgen', 5: 'beşgen', 6: 'altıgen', 7: 'yedigen',
        8: 'sekizgen', 9: 'dokuzgen', 10: 'ongen', 11: 'onbirgen', 12: 'onikigen',
    };

    let circleCount = 0;
    let rectCount = 0;
    let squareCount = 0;
    const regularByN = new Map<number, { count: number; categories: Set<string> }>();
    const byCategory = new Map<string, number>();

    for (const r of rows) {
        const entityType = String(r[0]);
        const cat = String(r[1] || 'DIGER');
        const n = Number(r[2]);
        const closed = Number(r[3]) === 1;
        const reg = Number(r[4]);
        const asp = Number(r[5]);

        if (cat !== 'DIGER') byCategory.set(cat, (byCategory.get(cat) || 0) + 1);

        if (entityType === 'CIRCLE') { circleCount++; continue; }
        if (entityType !== 'LWPOLYLINE' && entityType !== 'POLYLINE') continue;
        if (!closed || !Number.isFinite(n) || n < 3 || n > 20) continue;

        // 4-gen: kare vs dikdörtgen ayrımı
        if (n === 4) {
            const isSquare = reg > 0.9 && Math.abs(asp - 1) < 0.1;
            if (isSquare) { squareCount++; }
            else { rectCount++; }
            continue;
        }
        if (reg > 0.85) {
            const bucket = regularByN.get(n) || { count: 0, categories: new Set<string>() };
            bucket.count++;
            if (cat !== 'DIGER') bucket.categories.add(cat);
            regularByN.set(n, bucket);
        }
    }

    const parts: string[] = [];
    if (circleCount > 0) parts.push(`${circleCount} daire`);

    const ns = Array.from(regularByN.keys()).sort((a, b) => b - a); // büyükten küçüğe
    for (const n of ns) {
        const b = regularByN.get(n)!;
        const name = gonNames[n] || `${n}-kenarlı çokgen`;
        const catStr = b.categories.size > 0 ? ` (${Array.from(b.categories).join('/')})` : '';
        parts.push(`${b.count} adet düzgün ${name}${catStr}`);
    }
    if (squareCount > 0) parts.push(`${squareCount} kare`);
    if (rectCount > 0) parts.push(`${rectCount} dikdörtgen`);

    const catParts: string[] = [];
    for (const [cat, cnt] of Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])) {
        catParts.push(`${cnt}×${cat}`);
    }

    if (!parts.length && !catParts.length) return null;
    let out = parts.join(', ');
    if (catParts.length) out += (out ? ' | ' : '') + `KATEGORİ: ${catParts.join(', ')}`;
    return out;
}

export function buildMetadataText(asset: Asset): string {
    const lines: string[] = [];
    lines.push(`DOSYA: ${asset.fileName}`);
    if (asset.projectName) lines.push(`PROJE: ${asset.projectName}`);
    if (asset.category) lines.push(`KATEGORİ: ${asset.category}`);
    if (asset.materialGroup) lines.push(`MALZEME: ${asset.materialGroup}`);
    if (asset.architecturalStyle) lines.push(`STİL: ${asset.architecturalStyle}`);
    if (asset.colorTheme) lines.push(`RENK TEMASI: ${asset.colorTheme}`);
    if (asset.clientName) lines.push(`MÜŞTERİ: ${asset.clientName}`);
    if (asset.projectPhase) lines.push(`AŞAMA: ${asset.projectPhase}`);
    if (asset.versionLabel) lines.push(`VERSİYON: ${asset.versionLabel}`);
    if (asset.aiTags?.length) lines.push(`AI ETİKETLERİ: ${asset.aiTags.map((t) => t.label).join(', ')}`);
    if (asset.userTags?.length) lines.push(`ETİKETLER: ${asset.userTags.map((t) => t.name).join(', ')}`);
    // Format-spesifik metadata
    const m = asset.metadata as Record<string, unknown> | undefined;
    if (m) {
        // Slice limitleri 150'ye çıkarıldı: sol panel aramasi (buildFullSearchableText)
        // tüm metadata'yı tarıyor; RAG metadata chunk'ı da benzer kapsama sahip olmalı.
        // Mimari DWG'lerde 100+ layer normal — 30'luk eski limit spesifik katmanları (ör. "MINARE")
        // chunk dışına itiyordu → FTS5 bulmayabiliyordu.
        const dwgLayers = (m.dwgLayers as string[] | undefined) ?? (m.layers as string[] | undefined);
        if (dwgLayers?.length) lines.push(`KATMANLAR: ${dwgLayers.slice(0, 150).join(', ')}`);
        const dwgBlocks = m.dwgBlockNames as string[] | undefined;
        if (dwgBlocks?.length) lines.push(`BLOKLAR: ${dwgBlocks.slice(0, 150).join(', ')}`);
        const dwgText = m.dwgTextContents as string[] | undefined;
        if (dwgText?.length) lines.push(`ÇİZİM METİNLERİ: ${dwgText.slice(0, 150).join(', ')}`);
        const rooms = (m.rvtStoreyNames as string[] | undefined) ?? (m.ifcStoreyNames as string[] | undefined);
        if (rooms?.length) lines.push(`KAT/ODA İSİMLERİ: ${rooms.slice(0, 150).join(', ')}`);
        const desc = m.dwgDescription as string | undefined;
        if (desc) lines.push(`AÇIKLAMA: ${desc}`);
        const drawingType = m.dwgDrawingType as string | undefined;
        if (drawingType) lines.push(`ÇİZİM TİPİ: ${drawingType}`);
    }
    // Faz 4.1 — Geometrik shape özeti (dwg_shapes tablosundan)
    const geometric = buildGeometricSummary(asset.id);
    if (geometric) lines.push(`GEOMETRİK İÇERİK: ${geometric}`);

    // Sol panel (searchScoring.buildFullSearchableText) paritesi.
    // FTS5 + embedding sol panelle aynı alanları görmeli — aksi halde sol panel
    // "minare" bulur (layer/xref/tag'de) ama AI Chat bulmaz.
    const flatAddendum = buildFlatSearchableAddendum(asset);
    if (flatAddendum) lines.push(`EK ALANLAR: ${flatAddendum}`);

    return lines.join('\n');
}

/**
 * Yapısal `buildMetadataText` satırlarına dahil edilmeyen TÜM metadata alanlarını
 * flat bir metin olarak toplar. Sol panel aramasıyla paritet sağlar.
 * Kaynak: `searchScoring.ts:buildFullSearchableText` ile aynı alan seti.
 */
function buildFlatSearchableAddendum(asset: Asset): string {
    const m = (asset.metadata ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | undefined => typeof v === 'string' && v.trim() ? v : undefined;
    const arr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];

    const parts: (string | undefined)[] = [
        // Zaten yapısal satırlarda geçebilen bazı alanlar yine flat'a da ekleniyor
        // (daha sağlam recall için — duplication zararsız).
        asset.fileType,
        str(m.fileType),
        // DWG ek alanları
        ...arr(m.dwgXrefNames),
        str((m.dwgProperties as { title?: unknown } | undefined)?.title),
        str((m.dwgProperties as { subject?: unknown } | undefined)?.subject),
        str((m.dwgProperties as { keywords?: unknown } | undefined)?.keywords),
        str((m.dwgProperties as { author?: unknown } | undefined)?.author),
        str((m.dwgProperties as { comments?: unknown } | undefined)?.comments),
        str((m.dwgProperties as { lastSavedBy?: unknown } | undefined)?.lastSavedBy),
        ...arr(m.dwgElements),
        ...arr(m.dwgSpaces),
        ...arr(m.dwgKeywords),
        ...arr(m.dwgDomainTerms),
        str(m.dwgEstimatedScale),
        str(m.dwgUnitType),
        str(m.dwgDrawingType),
        str(m.dwgDescription),
        // MAX / SKP / render
        str(m.maxVersion),
        str(m.skpVersion),
        str(m.renderSoftware),
        str(m.cameraInfo),
        ...arr(m.maxLayers),
        ...arr(m.maxObjects),
        // RVT / IFC
        str(m.rvtVersion),
        str(m.rvtProjectName),
        str(m.rvtFormat),
        ...arr(m.rvtStoreyNames),
        str(m.ifcSchema),
        str(m.ifcOriginatingSystem),
        str(m.ifcProjectName),
        str(m.ifcBuildingName),
        ...arr(m.ifcStoreyNames),
        // Görsel metadata
        str(m.colorProfile),
        // Kullanıcı tanımlı alanlar
        ...(asset.userTags ?? []).map((t) => t.name),
        asset.clientName,
        asset.approvalStatus,
        asset.versionLabel,
        asset.deadline,
    ];
    return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ').slice(0, 5000);
}

/** Metadata-only chunk: tüm asset tipleri için (DWG, MAX, vb. dahil) tek bir
 * "kim/ne/hangi proje" özeti. chunk_index = -1 ile işaretlenir, gövde chunks'larından ayrılır.
 *
 * @param options.skipSave — geriye uyum için tutulur; artık no-op. Mirror her zaman çalışır.
 *   Eskiden saveDatabase() loop içinde tüm DB'yi (50MB+) export ederek UI'yı kilitliyordu.
 *   Şimdi sql.js INSERT + targeted rusqlite mirror (mirrorRagWriteToDisk).
 */
export async function indexAssetMetadata(
    assetId: string,
    _options: { skipSave?: boolean } = {},
): Promise<IndexingResult> {
    const asset = getAssetById(assetId);
    if (!asset) return { assetId, chunks: 0, skipped: true, reason: 'asset_not_found' };
    const text = buildMetadataText(asset);
    if (text.trim().length < 10) return { assetId, chunks: 0, skipped: true, reason: 'no_metadata' };

    // Eski metadata chunk'ı (chunk_index = -1) sil — re-index destek.
    // FTS5 virtual table sql.js WASM'de `LIKE` desteklemiyor → önce text_chunks'tan
    // eski meta chunk id'leri çek, sonra tam eşleşme ile fts_chunks'tan sil.
    runSql(`DELETE FROM embeddings WHERE asset_id = ? AND source = 'chunk_text' AND ref_id LIKE ?`, [assetId, `${assetId}_meta_%`]);
    const oldMetaIds = queryAll(
        `SELECT id FROM text_chunks WHERE asset_id = ? AND chunk_index = -1`,
        [assetId],
    ).map((r) => (r as unknown[])[0] as string);
    runSql(`DELETE FROM text_chunks WHERE asset_id = ? AND chunk_index = -1`, [assetId]);
    for (const cid of oldMetaIds) {
        try { runSql(`DELETE FROM fts_chunks WHERE chunk_id = ?`, [cid]); } catch { /* non-fatal */ }
    }

    const vec = await generateEmbedding(text);
    const chunkId = `${assetId}_meta_${Date.now()}`;
    const row: TextChunkRow = { id: chunkId, assetId, chunkIndex: -1, text };
    upsertTextChunk(row);
    saveChunkEmbedding(assetId, chunkId, vec, 'chunk_text');
    insertFtsChunk(chunkId, assetId, text);
    // Targeted rusqlite mirror — saveDatabase yerine. Fire-and-forget, UI bloku yok.
    // FTS5 satırı sql.js memory'de kalır; restart'ta self-healing migration ile rebuild edilir.
    const f32 = new Float32Array(vec);
    const vectorBlob = Array.from(new Uint8Array(f32.buffer));
    void mirrorRagWriteToDisk({
        chunks: [{ id: chunkId, asset_id: assetId, chunk_index: -1, page: null, text, lang: null }],
        embeddings: [{ id: `${chunkId}_chunk_text`, asset_id: assetId, ref_id: chunkId, vector_blob: vectorBlob, source: 'chunk_text' }],
        deleteChunksFor: [],
    });
    return { assetId, chunks: 1, skipped: false, kind: 'metadata' };
}

/** RAG-indexlenebilir dosya uzantıları. Bunun dışındaki dosyalar binary/çöp metin üretir. */
export const RAG_INDEXABLE_EXTENSIONS = new Set([
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'xlsm', 'xltx', 'xltm',
    'ppt', 'pptx', 'odp', 'ods', 'odt',
    'txt', 'md', 'csv', 'rtf',
]);

export function isRagIndexableExtension(filePath: string): boolean {
    const m = filePath.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!m) return false;
    return RAG_INDEXABLE_EXTENSIONS.has(m[1]);
}

export async function indexAssetForRag(
    assetId: string,
    filePath: string,
    options: ChunkingOptions = {},
): Promise<IndexingResult> {
    const chunkSize = options.chunkSize ?? 500;
    const overlap = options.overlap ?? 50;
    const maxChars = options.maxChars ?? 350_000;

    // Body chunks/embeddings için biriktirilen mirror payload — tek IPC ile rusqlite'a yansıtılır.
    // updateAssetRagStatus ve indexAssetMetadata kendi mirror'larını yapar; burada body kapsamı.
    const collectedChunks: Array<{ id: string; asset_id: string; chunk_index: number; page: number | null; text: string; lang: string | null }> = [];
    const collectedEmbeddings: Array<{ id: string; asset_id: string; ref_id: string | null; vector_blob: number[]; source: string }> = [];
    let collectedDeletes: string[] = [];

    const persist = () => {
        // saveDatabase yerine targeted rusqlite mirror. Fire-and-forget — UI bloku yok.
        // Boş payload ise mirrorRagWriteToDisk early-return → IPC atlanır.
        void mirrorRagWriteToDisk({
            chunks: collectedChunks,
            embeddings: collectedEmbeddings,
            deleteChunksFor: collectedDeletes,
        });
    };

    if (!isRagIndexableExtension(filePath)) {
        // Body extraction yok ama metadata chunk üret — DWG/MAX/SKP için sidebar-aware arama.
        const metaResult = await indexAssetMetadata(assetId);
        if (metaResult.skipped) {
            updateAssetRagStatus(assetId, 'skipped', metaResult.reason ?? 'no_metadata');
        } else {
            updateAssetRagStatus(assetId, 'indexed', null);
        }
        persist();
        return metaResult;
    }

    let extracted: ExtractedText;
    try {
        extracted = await invoke<ExtractedText>('extract_text_for_indexing', {
            path: filePath,
            maxChars,
        });
    } catch (err) {
        debugLog('textChunker', 'extract_text_for_indexing failed', { assetId, err });
        const reason = `extract_failed: ${String(err)}`;
        updateAssetRagStatus(assetId, 'skipped', reason);
        persist();
        return { assetId, chunks: 0, skipped: true, reason };
    }

    if (extracted.kind === 'too_large') {
        updateAssetRagStatus(assetId, 'skipped', 'file_too_large');
        persist();
        return { assetId, chunks: 0, skipped: true, reason: 'file_too_large', kind: extracted.kind };
    }

    let ocrUsed = false;
    if (!extracted.text || extracted.text.trim().length < 20) {
        // OCR fallback: taranmış PDF'ler için thumbnail üzerinde Ollama vision modeli dene
        let ocrText = '';
        if (options.aiConfig?.apiProvider === 'ollama') {
            const asset = getAssetById(assetId);
            const thumbUrl = asset?.thumbnailUrl;
            if (thumbUrl && !thumbUrl.includes('image/svg+xml')) {
                ocrText = await ocrImageToText(thumbUrl, options.aiConfig).catch(() => '');
            }
        }
        if (ocrText.trim().length >= 120) {
            // OCR başarılı — bu metni body chunk olarak kullan
            extracted = { ...extracted, text: ocrText };
            ocrUsed = true;
            // chunking bloğuna fall-through
        } else {
            updateAssetRagStatus(assetId, 'skipped', 'empty_or_too_short');
            persist();
            return { assetId, chunks: 0, skipped: true, reason: 'empty_or_too_short', kind: extracted.kind };
        }
    }

    const pieces = chunkText(extracted.text, chunkSize, overlap);
    if (pieces.length === 0) {
        updateAssetRagStatus(assetId, 'skipped', 'no_chunks');
        persist();
        return { assetId, chunks: 0, skipped: true, reason: 'no_chunks', kind: extracted.kind };
    }

    // Eski chunk/embedding kayıtlarını temizle (re-index desteği) — sql.js + mirror'a delete instruction
    deleteChunkEmbeddingsByAssetId(assetId, 'chunk_text');
    deleteTextChunksByAssetId(assetId);
    deleteFtsChunksByAssetId(assetId);
    collectedDeletes = [assetId];

    const vectors = await generateBatchEmbeddings(pieces);
    if (vectors.length !== pieces.length) {
        debugLog('textChunker', 'vector count mismatch', {
            assetId,
            chunks: pieces.length,
            vectors: vectors.length,
        });
    }

    const now = Date.now();
    for (let i = 0; i < pieces.length; i++) {
        const chunkId = `${assetId}_c${i}_${now}`;
        const row: TextChunkRow = {
            id: chunkId,
            assetId,
            chunkIndex: i,
            text: pieces[i],
        };
        upsertTextChunk(row);
        collectedChunks.push({ id: chunkId, asset_id: assetId, chunk_index: i, page: null, text: pieces[i], lang: null });
        const vec = vectors[i];
        if (vec) {
            saveChunkEmbedding(assetId, chunkId, vec, 'chunk_text');
            const f32 = new Float32Array(vec);
            const vectorBlob = Array.from(new Uint8Array(f32.buffer));
            collectedEmbeddings.push({ id: `${chunkId}_chunk_text`, asset_id: assetId, ref_id: chunkId, vector_blob: vectorBlob, source: 'chunk_text' });
        }
        insertFtsChunk(chunkId, assetId, pieces[i]);
    }

    updateAssetRagStatus(assetId, 'indexed', null);

    // Metadata chunk'ı da ekle (filename/proje/etiketler için arama kapısı).
    // indexAssetMetadata kendi mirror'unu yapar; burada body chunks ayrı bir mirror IPC olur.
    try { await indexAssetMetadata(assetId); } catch (err) {
        debugLog('textChunker', 'metadata chunk failed (non-fatal)', err);
    }

    persist();
    return { assetId, chunks: pieces.length, skipped: false, kind: ocrUsed ? 'ocr' : extracted.kind };
}
