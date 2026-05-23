/**
 * RAG (Retrieval-Augmented Generation) orkestratörü.
 *
 * Tek bir sorgu için: embed → cosine top-K → prompt → Ollama → cevap + citation.
 *
 * İki mod:
 *  - `askQuestion`       — Faz 1 uyumlu, tek atışta JSON cevap (stream yok)
 *  - `askQuestionStream` — Faz 2, token-by-token streaming (onToken callback)
 *
 * Streaming, frontend fetch ile doğrudan localhost:11434'e bağlanır (CSP izinli).
 * Non-stream mod Rust ollama_proxy üzerinden geçer (SSRF koruma).
 *
 * Scope filtresi: all / project / tag / folder / assets (sentez) — getScopeAssetIds() ile uygulanır.
 */

import { generateEmbedding, cosineSimilarity, loadEmbeddingModel } from './embeddings';
import { expandQuery } from './queryExpansion';

import {
    getChunksByIdsAsync,
    queryAll,
    ftsSearchChunksAsync,
    getChunkEmbeddingsByAssetIdsAsync,
    getChunkStatsAsync,
    getAllChunkEmbeddings,
    getAllAssets,
    getExcludedAssetIds,
    findAssetIdsByKeywords,
    getSetting,
    getSchemaEpoch,
} from './database';
import { invokeWithTimeout } from '../utils/invokeWithTimeout';
import type { AIConfig } from '../components/AISettingsModal';
import type { Asset } from '../types';
import { chatModel, normalizeOllamaGenerateUrl, assertLocalOllamaUrl } from './ollamaService';
import { debugLog } from './logger';
import {
    buildFullSearchableText,
    computeKeywordScore,
    computeHybridFinalScore,
    semanticMatchThreshold,
} from '../utils/searchScoring';

export type RagScope =
    | { type: 'all' }
    | { type: 'project'; value: string }
    | { type: 'tag'; value: string }
    | { type: 'folder'; value: string }
    | { type: 'assets'; values: string[] };  // Çoklu dosya sentezi: explicit asset ID listesi

export type RagCitation = {
    index: number;        // [1], [2] ... — prompt'ta verilen sıra
    chunkId: string;
    assetId: string;
    fileName: string;
    filePath: string;
    page: number | null;
    score: number;
    snippet: string;      // chunk metninden kısa önizleme
};

export type RagAnswer = {
    answer: string;
    citations: RagCitation[];
    model: string;
    retrievedChunks: number;
    elapsedMs: number;
};

export type RagOptions = {
    topK?: number;          // varsayılan 8
    minScore?: number;      // varsayılan 0.25
    snippetChars?: number;  // citation snippet uzunluğu (varsayılan 180)
};

/**
 * Retrieve aşaması teşhis bilgisi — Stage C için UI'a pompalanır.
 * Kullanıcı kaç aday bulunduğunu, kaçının LLM'e gittiğini görür.
 * `dimMismatch` doluysa embedding boyutları uyumsuz — yeniden indeksleme gerek.
 */
export type RetrieveDiagnostics = {
    ftsHits: number;        // FTS5 keyword eşleşme sayısı
    embHits: number;        // Cosine > 0.1 olan chunk sayısı
    fusedHits: number;      // FTS + embedding + metadata birleşimi (topK öncesi)
    finalHits: number;      // topK + asset-cap sonrası LLM'e giden
    rerankedHits?: number;  // LLM rerank sonrası (varsa)
    dimMismatch?: {
        queryDim: number;
        skipped: number;
        observedDims: number[]; // DB'de gözlemlenen farklı boyutlar
    };
};

/* ─── RAG Cache — embedding + asset metadata ─────────────────────── */
let _ragEmbeddingCache: Array<{ assetId: string; chunkId: string; vector: number[] }> | null = null;
let _ragAssetSearchIndex: Map<string, string> | null = null; // assetId → searchableText
let _ragCacheVersion = 0;

/** Hem embedding hem metadata cache'ini temizler — yeni tarama/indeksleme sonrası çağır */
export function invalidateRagEmbeddingCache(): void {
    _ragCacheVersion++;
    _ragEmbeddingCache = null;
    _ragAssetSearchIndex = null;
}

function getRagCachedEmbeddings(): Array<{ assetId: string; chunkId: string; vector: number[] }> {
    if (!_ragEmbeddingCache) {
        const vBefore = _ragCacheVersion;
        const textEmbs = getAllChunkEmbeddings('chunk_text');
        const ocrEmbs = getAllChunkEmbeddings('chunk_ocr');
        if (_ragCacheVersion !== vBefore) return [...textEmbs, ...ocrEmbs];
        _ragEmbeddingCache = [...textEmbs, ...ocrEmbs];
    }
    return _ragEmbeddingCache;
}

/**
 * V3 Faz 3 — Adım A2: çift-yol embedding okuma (bayrak arkası).
 *
 * `ARCHIVIST_V3_EPOCH=on` VE şema-epoch ≥ 1 ise embedding'leri vec.db'den
 * (`vec_db_chunk_embeddings` invoke) çeker; aksi halde BİREBİR eski sync
 * sql.js yolu (`getRagCachedEmbeddings`). Bayrak **default kapalı** →
 * davranış değişmez, tek satır geri-alınabilir. Invoke başarısızsa sql.js
 * yoluna düşer (cutover öncesi sql.js verisi hâlâ var — RAG asla kırılmaz).
 * Bkz docs/v3/PHASE3-CUTOVER-PLAN.md A2.
 */
function v3EpochEnabled(): boolean {
    // **2026-05-22 — A6 flip: default AÇIK** (PRE-5/6 tamam; bkz database.ts
    // isV3EpochEnabled). Paylaşımlı anahtar/semantik. Opt-out: setItem('off').
    try {
        return localStorage.getItem('ARCHIVIST_V3_EPOCH') !== 'off';
    } catch {
        return true;
    }
}

async function getRagCachedEmbeddingsAsync(): Promise<
    Array<{ assetId: string; chunkId: string; vector: number[] }>
> {
    // Bayrak kapalı veya henüz taşınmamış → eski sync yol, BİREBİR.
    // getSchemaEpoch testlerde mock edilmemiş olabilir → defensive: hata
    // durumunda 0 varsay (eski yol). Production'da bu fn daima vardır.
    let epoch = 0;
    try { epoch = getSchemaEpoch(); } catch { epoch = 0; }
    if (!v3EpochEnabled() || epoch < 1) {
        return getRagCachedEmbeddings();
    }
    if (_ragEmbeddingCache) return _ragEmbeddingCache;
    try {
        const vBefore = _ragCacheVersion;
        type Row = { assetId: string; chunkId: string; vector: number[] };
        const [textEmbs, ocrEmbs] = await Promise.all([
            invokeWithTimeout<Row[]>(
                'vec_db_chunk_embeddings',
                { archiveAt: null, source: 'chunk_text' },
                60_000,
            ),
            invokeWithTimeout<Row[]>(
                'vec_db_chunk_embeddings',
                { archiveAt: null, source: 'chunk_ocr' },
                60_000,
            ),
        ]);
        const combined = [...textEmbs, ...ocrEmbs];
        // Yükleme sırasında cache invalidate edildiyse cache'leme (sync ile aynı koruma).
        if (_ragCacheVersion !== vBefore) return combined;
        _ragEmbeddingCache = combined;
        return _ragEmbeddingCache;
    } catch (err) {
        // Dayanıklılık: vec.db yolu patlarsa sql.js'e düş (DROP öncesi sağlam).
        debugLog('RAG', 'vec.db embedding yolu başarısız → sql.js fallback', err);
        return getRagCachedEmbeddings();
    }
}

/** Asset metadata aranabilir metin indeksi — bir kere hesapla, degisiklik olana kadar kullan */
function getRagAssetSearchIndex(): Map<string, string> {
    if (!_ragAssetSearchIndex) {
        const vBefore = _ragCacheVersion;
        const index = new Map<string, string>();
        try {
            const allAssets = getAllAssets();
            for (const asset of allAssets) {
                index.set(asset.id, buildFullSearchableText(asset));
            }
        } catch (err) {
            debugLog('RAG', 'asset search index build error', err);
        }
        if (_ragCacheVersion !== vBefore) return index;
        _ragAssetSearchIndex = index;
    }
    return _ragAssetSearchIndex;
}

/** UI thread'i kitlememek icin micro-yield */
const yieldToUI = (): Promise<void> => new Promise(r => setTimeout(r, 0));

const MAX_CHUNKS_PER_ASSET = 3;
const DEFAULT_TOP_K = 12;
const RERANK_POOL = 20;       // retrieve top-K for reranker input
const RERANK_KEEP = 6;        // rerank sonrası LLM'e verilecek sayı
const RERANK_SNIPPET = 280;   // rerank prompt'unda chunk başına karakter
const RERANK_TIMEOUT_MS = 25_000;

/** localStorage'dan boolean oku (yoksa/ hata varsa false). */
function _readPersistedBool(key: string): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
}
function _writePersistedBool(key: string, v: boolean): void {
    try { localStorage.setItem(key, String(v)); } catch { /* quota / private mode */ }
}

const LS_RERANKER_KEY = 'archivist_reranker_enabled';
let _rerankerEnabled = _readPersistedBool(LS_RERANKER_KEY);
export function isRerankerEnabled(): boolean { return _rerankerEnabled; }
export function setRerankerEnabled(v: boolean): void {
    _rerankerEnabled = v;
    _writePersistedBool(LS_RERANKER_KEY, v);
}

/* ─── Query Rewriting flag ───────────────────────────────────────── */
const QUERY_REWRITE_TIMEOUT_MS = 15_000;
const QUERY_REWRITE_MAX_SIGTOKENS = 5;  // bundan uzun sorgular zaten spesifik, dokunma
const LS_QUERY_REWRITE_KEY = 'archivist_query_rewrite_enabled';
let _queryRewriteEnabled = _readPersistedBool(LS_QUERY_REWRITE_KEY);
export function isQueryRewriteEnabled(): boolean { return _queryRewriteEnabled; }
export function setQueryRewriteEnabled(v: boolean): void {
    _queryRewriteEnabled = v;
    _writePersistedBool(LS_QUERY_REWRITE_KEY, v);
}

// Düşünme süreci görünürlüğü — kullanıcı isterse göster, varsayılan KAPALI.
// (Thinking zaten ayrı yakalanıyor; bu yalnız UI'da gösterilip gösterilmeyeceği.)
const LS_SHOW_THINKING_KEY = 'archivist_show_thinking';
let _showThinking = _readPersistedBool(LS_SHOW_THINKING_KEY);
export function isThinkingVisible(): boolean { return _showThinking; }
export function setThinkingVisible(v: boolean): void {
    _showThinking = v;
    _writePersistedBool(LS_SHOW_THINKING_KEY, v);
}

/* ─── Fallback uyarı izleme ────────────────────────────────────── */
let _lastQueryWarnings: string[] = [];
export function getLastQueryWarnings(): string[] { return _lastQueryWarnings; }
/**
 * RRF skor aralıkları (k=60, 2 liste):
 *   Her iki listede 1. sıra:  1/61 + 1/61 ≈ 0.0328
 *   Tek listede 1. sıra:      1/61 ≈ 0.0164
 *   Tek listede 10. sıra:     1/70 ≈ 0.0143
 *   Tek listede 50. sıra:     1/110 ≈ 0.0091
 *
 * STRONG eşiği: en az bir chunk bu skoru geçmeli yoksa LLM çağrılmaz (hallucination gate).
 * ~top-5 içinde her iki listede de yer alan chunk'ı hedefler.
 */
const DEFAULT_MIN_SCORE = 0;             // RRF'te pre-filter gereksiz, topK yeterli
const DEFAULT_SNIPPET = 180;

/**
 * Türkçe-aware normalize: küçük harfe çevir + aksanlı harfleri ASCII'ye indirger.
 * "Mesut Akçan" → "mesut akcan", "İnşaat" → "insaat"
 */
function normalizeTr(s: string): string {
    return s
        .toLocaleLowerCase('tr')
        .replace(/ı/g, 'i')
        .replace(/ç/g, 'c')
        .replace(/ğ/g, 'g')
        .replace(/ö/g, 'o')
        .replace(/ş/g, 's')
        .replace(/ü/g, 'u');
}

/**
 * Kelime sınırı eşleşmesi — substring yerine tam kelime kontrolü.
 * "cam" → "camilerin" eşleşmez, "cam profili" eşleşir.
 * normalizeTr ile ASCII'ye indirgenmiş metin üzerinde çalışır.
 */
function hasWordMatch(text: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`).test(text);
}

/**
 * Snippet'ı cümle sınırında keser — ortada kalan cümlelerden kaçınır.
 * Son cümle sonunu (. ? !) bulur; bulamazsa veya çok kısa kalırsa karakter sınırında keser.
 */
/**
 * LLM post-process: modelin Türkçe cevap yerine İngilizce meta-yorum veya
 * düşünme akışı (<think> tag'siz, direkt akan) sızdırdığı durumları temizle.
 *
 * İki katmanlı:
 *   1. Cümle cümle: İngilizce meta-yorum cümlelerini at
 *   2. Cümle içi: "The X:" gibi ASCII-only prefix'leri kaldır (citation değilse)
 *
 * Kriterler:
 *   - Türkçe göstergesi: ğüşıöç karakterleri VEYA "dosya/belge/proje/..." kelimeleri
 *   - Citation [N]: korunur, asla atılmaz
 *   - Sonuç boş kalırsa: raw cevap geri döner (safety fallback)
 */
export function cleanupLlmAnswer(raw: string): string {
    let text = raw.trim();
    if (!text) return text;

    // <think>...</think> kalıntısı (stream filter kaçırmışsa)
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

    // Sızan prompt iskeleti: küçük modeller (ör. qwen3:8b) girdi prompt'unu
    // cevap olarak kusabiliyor. Prompt çoğunlukla Türkçe olduğu için aşağıdaki
    // sentence-filtre onu "Türkçe içerik" sanıp koruyordu → kullanıcı [KESIN
    // KURAL]/KAYNAKLAR çöpünü görüyordu. buildPrompt'un SABİT şablon satırlarını
    // çıkar; bu literal ifadeler gerçek bir cevapta pratikte hiç geçmez (güvenli).
    {
        const scaffoldLine = /^\s*(\/no_?think|\/think|\[KESIN KURAL\].*|KAYNAKLAR:\s*|KAYNAKLAR soruya uygun değilse:.*|FORMAT:\s*"?\[N\].*|Mimari arşiv asistanısın\..*|ÖNCEKİ KONUŞMA\b.*|SORU:\s.*|CEVAP\s*\(Türkçe[^)]*\):?.*)\s*$/i;
        text = text
            .split(/\r?\n/)
            .filter((ln) => !scaffoldLine.test(ln))
            .join('\n')
            .replace(/\/no_?think/gi, '')   // satır-içi kalan token
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }
    // Model YALNIZCA prompt'u kusmuş (gerçek cevap yok) → çöpü değil, dürüst not
    if (!text) return 'Bu soru için kaynaklardan net bir cevap üretilemedi.';

    // Türkçe göstergesi: diakritik karakter VEYA yaygın Türkçe kelime
    const turkishMarker = /[ğüşıöçĞÜŞİÖÇ]|\b(dosya|dosyası|dosyada|belge|belgede|belgesi|proje|projede|arşiv|arşivde|seçili|bulundu|bulunamadı|mevcut|şartname|sözleşme|garanti|yalıtım|merdiven|kolon|duvar|cephe|pencere|zemin|tavan|katman|teminat|sayfa|başlık|yapı)/i;

    // İngilizce meta-yorum kalıpları (cümle başı)
    const englishMeta = /^(let me|the answer|possible answer|so the answer|so,|here is|here's|but the user|but,|however,|actually,|wait[,.]|the (user|document|subject|main|key|following|above|goal|purpose)|hmm[,.]|er[,.]|uh[,.]|ok[,.]|well,|i (need|should|think|will|can)|you (need|should|can)|okay,|right,)/i;

    const startsWithCitation = /^\[\d+\]/;

    const sentences = text.split(/(?<=[.!?])\s+/);
    const kept: string[] = [];

    for (const rawSentence of sentences) {
        let s = rawSentence.trim();
        if (!s) continue;

        // 1. ASCII-only prefix'i kaldır (ör. "The key points from BELGE 1:" → Türkçe içerik kalır)
        const colonIdx = s.indexOf(':');
        if (colonIdx > 0 && colonIdx < 80) {
            const prefix = s.slice(0, colonIdx).trim();
            const after = s.slice(colonIdx + 1).trim();
            const prefixAscii = /^[\x20-\x7E]+$/.test(prefix);
            const prefixHasTr = turkishMarker.test(prefix);
            const prefixIsCitation = startsWithCitation.test(prefix);
            const afterHasTr = turkishMarker.test(after);
            if (prefixAscii && !prefixHasTr && !prefixIsCitation && afterHasTr) {
                s = after;
            }
        }

        // 2. Meta-English cümle → at
        if (englishMeta.test(s)) continue;
        // 3. Saf İngilizce + citation yok → at
        if (!turkishMarker.test(s) && !startsWithCitation.test(s)) continue;

        kept.push(s);
    }

    const result = kept.join(' ').trim();
    // safety fallback: hiçbir cümle kalmadıysa scaffold/think TEMİZLENMİŞ tabana
    // dön (ham `raw` DEĞİL — yoksa sızan prompt iskeleti geri gelirdi).
    return result || text;
}

function truncateAtSentence(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const truncated = text.slice(0, maxChars);
    const lastBreak = Math.max(
        truncated.lastIndexOf('. '),
        truncated.lastIndexOf('.\n'),
        truncated.lastIndexOf('? '),
        truncated.lastIndexOf('! '),
    );
    if (lastBreak > maxChars * 0.5) {
        return truncated.slice(0, lastBreak + 1).trim() + '…';
    }
    return truncated.trim() + '…';
}

/** Yaygın sorgu kelimeleri — skor hesabında ağırlık azaltılır */
const STOP_WORDS = new Set([
    // Soru sözcükleri
    'kimdir', 'nedir', 'ne', 'nerede', 'nasil', 'nasıl', 'hangi', 'hangisi', 'var', 'yok',
    'kac', 'kaç', 'neden', 'niye', 'kim', 'kimin',
    // Bağlaçlar/zamirler
    'bir', 'bu', 'şu', 'o', 'ile', 'için', 'icin', 'mi', 'mı', 'mu', 'mü',
    'de', 'da', 'ki', 'ama', 'fakat', 'veya', 'hem', 'ya', 'yani',
    'olan', 'icinde', 'içinde', 'gecer', 'geçer', 'bulunur',
    // Arşiv meta-sözcükleri — her belgede geçer, seçici değil
    'dosya', 'dosyada', 'dosyanin', 'dosyanın', 'dosyalar', 'dosyalarda',
    'dosyasinda', 'dosyasında', 'dosyasinin', 'dosyasının',
    'belge', 'belgede', 'belgenin', 'belgeler', 'belgelerde',
    'dokuman', 'doküman', 'dokümanda', 'dokumanda',
    'arsiv', 'arşiv', 'arsivde', 'arşivde',
    // Dosya tipi adları — filtre intent'i, FTS match olarak her dosyayı çağırır
    'dwg', 'dxf', 'dwf', 'max', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'skp', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'psd', 'ai', 'svg',
    'rvt', 'ifc', 'obj', 'fbx', '3dm', '3ds', 'stl', 'mp4', 'avi', 'mov', 'mkv',
    // İngilizce
    'the', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'what', 'who',
    'file', 'files', 'document', 'documents',
]);

/**
 * "Bilgi bulamadım" cevabına teşhis eki üretir. Kullanıcı ve developer için:
 *   - Sorguda FTS5'e giden token'lar (expand dahil)
 *   - FTS5 ön-eşleşme sayısı
 *   - Metadata chunk sayısı (asset'lerin ne kadarı "aranabilir" durumda)
 *   - Toplam chunk sayısı
 * Kök neden genelde 0 metadata chunk (indexleme yapılmamış) veya token dışı sorgu.
 */
async function buildNoResultDiagnostic(query: string): Promise<string> {
    try {
        const expanded = expandQuery(query);
        // V3 PRE-5f: FTS + chunk sayımları epoch>=2'de vec.db'den.
        const ftsHits = await ftsSearchChunksAsync(expanded, 10);
        const stats = await getChunkStatsAsync();
        const chunkTotal = stats.total;
        const metaChunkTotal = stats.metaTotal;
        const tokens = expanded
            .toLocaleLowerCase('tr')
            .replace(/ı/g, 'i').replace(/ç/g, 'c').replace(/ğ/g, 'g')
            .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length >= 3);
        const uniqTokens = [...new Set(tokens)].slice(0, 12);

        // Per-token LIKE sayımı + örnek chunk: sql.js text_chunks'a substring
        // LIKE yapar. epoch>=2'de text_chunks vec.db'de (LIKE komutu yok) →
        // bu ayrıntılı teşhis yalnız epoch<2'de üretilir; FTS+sayım her
        // durumda gösterilir.
        let epoch = 0;
        try { epoch = getSchemaEpoch(); } catch { epoch = 0; }
        const tokenMatchCounts: string[] = [];
        let sampleText = '';
        if (epoch < 2) {
            for (const tok of uniqTokens.slice(0, 5)) {
                try {
                    const row = queryAll(
                        `SELECT COUNT(*) FROM text_chunks WHERE chunk_index = -1 AND LOWER(text) LIKE ?`,
                        [`%${tok}%`],
                    );
                    const n = Number((row[0] as unknown[] | undefined)?.[0] ?? 0);
                    tokenMatchCounts.push(`${tok}=${n}`);
                } catch { /* skip */ }
            }
            for (const tok of uniqTokens.slice(0, 5)) {
                try {
                    const row = queryAll(
                        `SELECT text FROM text_chunks WHERE chunk_index = -1 AND LOWER(text) LIKE ? LIMIT 1`,
                        [`%${tok}%`],
                    );
                    const t = (row[0] as unknown[] | undefined)?.[0];
                    if (typeof t === 'string' && t.length > 0) {
                        sampleText = `(LIKE '${tok}') ` + t.slice(0, 400);
                        break;
                    }
                } catch { /* skip */ }
            }
            if (!sampleText) {
                try {
                    const row = queryAll(`SELECT text FROM text_chunks WHERE chunk_index = -1 LIMIT 1`);
                    const t = (row[0] as unknown[] | undefined)?.[0];
                    if (typeof t === 'string') sampleText = '(rastgele chunk) ' + t.slice(0, 400);
                } catch { /* skip */ }
            }
        }

        const line1 = `_Teşhis: sorgu kelimeleri (${uniqTokens.length}): ${uniqTokens.join(', ') || '—'}_`;
        const line2 = `_FTS5 ön-eşleşme: ${ftsHits.size} · metadata chunk: ${metaChunkTotal} / toplam: ${chunkTotal}_`;
        const line3 = tokenMatchCounts.length > 0 ? `_LIKE eşleşmesi (meta chunk içinde): ${tokenMatchCounts.join(', ')}_` : '';
        const line4 = sampleText ? `\n\n\`\`\`\n${sampleText}\n\`\`\`` : '';
        return `\n\n${line1}\n${line2}${line3 ? '\n' + line3 : ''}${line4}`;
    } catch {
        return '';
    }
}

function extractSearchTokens(query: string): { tokens: string[]; significantTokens: string[] } {
    const tokens = normalizeTr(query)
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length >= 3);
    const significant = tokens.filter((t) => !STOP_WORDS.has(t));
    return { tokens, significantTokens: significant };
}

/* ─── Greeting Detection — Selam/sohbet kalıpları ─────────────────── */

/** Selamlama ve sohbet kalıpları — RAG'e gitmez, sabit cevap döner. */
const GREETING_PATTERNS: Array<{ match: RegExp; reply: string }> = [
    {
        match: /^\s*(merhaba|selam|selamun aleyk[uü]m|merhabalar|s[ae]l[aâ]m|hey|hi|hello|selamlar)\s*[!?.\s]*$/i,
        reply: 'Merhaba! Arşivde aradığınız bir şey var mı? Örneğin: _"merdiven hangi dwg dosyasında"_ ya da _"proje X hakkında ne var"_.',
    },
    {
        match: /^\s*(g[üu]nayd[ıi]n|iyi (g[üu]nler|ak[şs]amlar|geceler))\s*[!?.\s]*$/i,
        reply: 'İyi günler! Size nasıl yardımcı olabilirim? Arşivde aramak istediğiniz bir şey var mı?',
    },
    {
        match: /^\s*(te[şs]ekk[üu]rler?|te[şs]ekk[üu]r ederim|sa[ğg]\s?ol(un)?|eyvallah|thanks?)\s*[!?.\s]*$/i,
        reply: 'Rica ederim. Başka sorunuz olursa buradayım.',
    },
    {
        match: /^\s*(nas[ıi]ls[ıi]n(?:[ıi]z)?|naber|ne haber)\s*[!?.\s]*$/i,
        reply: 'İyi, teşekkürler. Sizin için ne bulabilirim?',
    },
    {
        match: /^\s*(g[öo]r[üu][şs][üu]r[üu]z|ho[şs][çc]akal|bay|hoscakal|g[üu]le g[üu]le)\s*[!?.\s]*$/i,
        reply: 'Görüşmek üzere! İhtiyacınız olursa tekrar sorun.',
    },
    {
        match: /^\s*(kimsin|sen kimsin|ne yapars[ıi]n|ne yapabilirsin|yard[ıi]m)\s*[!?.\s]*$/i,
        reply: 'Bu ofisin mimari arşiv asistanıyım. Arşivdeki dosyalar hakkında size bilgi verebilirim — dosya aramak, içerik sormak veya listeleme için Türkçe yazmanız yeterli.',
    },
];

function detectGreeting(query: string): string | null {
    for (const { match, reply } of GREETING_PATTERNS) {
        if (match.test(query)) return reply;
    }
    return null;
}

/* ─── Intent Detection — Liste sorularında LLM bypass ─────────────── */

/** "X hangi / nerede / listele / bul / göster / içeren" kalıpları */
const LIST_INTENT_MARKERS = new Set([
    'hangi', 'hangisi', 'hangisinde', 'hangileri',
    'nerede', 'nerelerde',
    'listele', 'listeleyin', 'liste',
    'bul', 'bulur', 'bulunur', 'bulunuyor', 'bulunmakta',
    'goster', 'göster', 'gosterin',
    'iceren', 'içeren', 'iceriyor', 'içeriyor',
    'olan', 'olanlar',
    'varmi', 'varmı',
    'gecer', 'geçer', 'geciyor', 'geçiyor',
    'ara', 'arama',
]);

/** "X dwg/max/pdf" → dosya tipi filtresi (normalize edilmiş token → extension listesi) */
const FILE_TYPE_HINTS: Record<string, string[]> = {
    dwg: ['dwg'], dxf: ['dxf'], max: ['max'], pdf: ['pdf'], skp: ['skp'],
    doc: ['doc', 'docx'], docx: ['docx', 'doc'],
    xls: ['xls', 'xlsx'], xlsx: ['xlsx', 'xls'],
    jpg: ['jpg', 'jpeg'], jpeg: ['jpeg', 'jpg'], png: ['png'],
    rvt: ['rvt'], ifc: ['ifc'],
};

export function detectListIntent(query: string): boolean {
    // normalizeTr ı/ü'yü i/u'ya indirgediği için yalnız "mi"/"mu" yeter.
    // Hem ham (ayrık) token'lar hem soru-ekini önceki kelimeye yapıştıran
    // birleşik token'lar kontrol edilir: marker listesi "varmi" (birleşik)
    // ve "gecer" (bare) ikisini de tutuyor → birleşim sayesinde "var mı"
    // ve "geçer mi" gibi soruların ikisi de tetikler.
    const normalized = normalizeTr(query).replace(/[^a-z0-9\s]/g, ' ');
    const baseTokens = normalized.split(/\s+/);
    const gluedTokens = normalized
        .replace(/([a-z0-9])\s+(mi|mu)\b/g, '$1$2')
        .split(/\s+/);
    for (const t of baseTokens) if (LIST_INTENT_MARKERS.has(t)) return true;
    for (const t of gluedTokens) if (LIST_INTENT_MARKERS.has(t)) return true;
    return false;
}

function detectFileTypeHint(query: string): string[] | null {
    const tokens = normalizeTr(query).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
    for (const t of tokens) {
        if (FILE_TYPE_HINTS[t]) return FILE_TYPE_HINTS[t];
    }
    return null;
}

/**
 * "X hangi dosyada" / "X'i listele" türü sorulara LLM'i bypass ederek doğrudan
 * asset metadata keyword araması ile yanıt üretir. Sol paneldeki
 * filterAssetsHybrid ile aynı mantık (buildFullSearchableText + computeKeywordScore).
 *
 * @returns null → liste niyeti var ama anlamlı token yok (RAG akışına düş)
 */
export async function directFileListAnswer(
    query: string,
    scope: RagScope,
    topK: number = 10,
): Promise<{ answer: string; citations: RagCitation[] } | null> {
    const { significantTokens } = extractSearchTokens(query);
    if (significantTokens.length === 0) return null;

    const fileTypeHint = detectFileTypeHint(query);
    const eligible = getScopeAssetIds(scope);
    const searchIndex = getRagAssetSearchIndex();
    const allAssets = getAllAssets();

    const matches: Array<{ asset: Asset; score: number }> = [];
    for (const asset of allAssets) {
        if (eligible && !eligible.has(asset.id)) continue;
        if (fileTypeHint && !fileTypeHint.includes((asset.fileType || '').toLowerCase())) continue;
        const searchText = searchIndex.get(asset.id) || '';
        // Kelime sınırı kontrolü — "cam" → "camii" eşleşmesin
        const matchedAny = significantTokens.some((tok) => hasWordMatch(searchText, tok));
        if (!matchedAny) continue;
        const score = computeKeywordScore(searchText, query);
        if (score > 0) matches.push({ asset, score });
    }

    // İçerik (text_chunks) araması — buildFullSearchableText yalnız dosya
    // adı/proje/etiket/metadata tarar, belge METNİNİ taramaz. "X hangi
    // belgede geçer/var" sorularında X çoğu zaman dosya adında değil belge
    // İÇERİĞİNDEdir → metadata-only arama "bulunamadı" derdi. ftsSearchChunks
    // (FTS5 + tr_norm fallback, kanıtlı) ile aday chunk'ları çek; anlamlı
    // token'ların TÜMÜNÜ birebir geçen belgeleri ekle (keyword-gate ile aynı
    // kesinlik). Metadata'da zaten eşleşenler yeniden eklenmez.
    {
        const matchedIds = new Set(matches.map((m) => m.asset.id));
        // V3 PRE-5d: epoch>=2'de keyword araması vec.db FTS5'e yönlenir.
        const kwChunks = await ftsSearchChunksAsync(query, 300);
        if (kwChunks.size > 0) {
            const assetById = new Map(allAssets.map((a): [string, Asset] => [a.id, a]));
            const contentIds = new Set<string>();
            for (const c of await getChunksByIdsAsync([...kwChunks.keys()])) {
                const norm = normalizeTr(c.text);
                if (significantTokens.every((tok) => hasWordMatch(norm, tok))) {
                    contentIds.add(c.assetId);
                }
            }
            for (const aid of contentIds) {
                if (matchedIds.has(aid)) continue;
                const asset = assetById.get(aid);
                if (!asset) continue;
                if (eligible && !eligible.has(asset.id)) continue;
                if (fileTypeHint && !fileTypeHint.includes((asset.fileType || '').toLowerCase())) continue;
                // İçerikte tüm anlamlı token'lar birebir geçiyor → yüksek kesinlik
                matches.push({ asset, score: 1 });
                matchedIds.add(aid);
            }
        }
    }

    const tokenList = significantTokens.join(', ');
    const typeStr = fileTypeHint ? ` (${fileTypeHint[0].toUpperCase()})` : '';

    if (matches.length === 0) {
        return {
            answer: `"${tokenList}"${typeStr} içeren dosya arşivde bulunamadı.`,
            citations: [],
        };
    }

    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, topK);

    const citations: RagCitation[] = top.map((m, i) => ({
        index: i + 1,
        chunkId: `direct:${m.asset.id}`,
        assetId: m.asset.id,
        fileName: m.asset.fileName,
        filePath: m.asset.filePath,
        page: null,
        score: m.score,
        snippet: [
            m.asset.projectName ? `Proje: ${m.asset.projectName}` : null,
            m.asset.fileType ? `Tür: ${m.asset.fileType.toUpperCase()}` : null,
        ].filter(Boolean).join(' · '),
    }));

    const moreStr = matches.length > topK ? ` (ilk ${topK} gösteriliyor, toplam ${matches.length})` : '';
    const header = `"${tokenList}"${typeStr} için ${matches.length} dosya bulundu${moreStr}:\n\n`;
    const body = citations.map((c) => `- [${c.index}] ${c.fileName}`).join('\n');

    return { answer: header + body, citations };
}

/**
 * Reciprocal Rank Fusion (RRF) — iki sıralı listeyi birleştirir.
 *
 * Formül: score(d) = Σ 1 / (k + rank_i(d))
 * k=60 standart değer (Cormack et al., 2009). Benchmark'larda karmaşık
 * fusion yöntemlerinden tutarlı şekilde daha iyi veya eşit sonuç verir.
 *
 * Avantajı: ham skorların ölçeğine bağımlı değil — sadece sıralamaya bakar.
 * Semantic cosine [0-1] ile keyword overlap [0-1] farklı dağılımda olsa bile
 * RRF bunları adil birleştirir.
 */
/**
 * Scope'a göre eligible asset ID setini döndürür.
 * 'all' → null (filtreleme yok), diğerleri → Set<assetId>.
 */
function getScopeAssetIds(scope: RagScope): Set<string> | null {
    if (scope.type === 'all') return null;

    if (scope.type === 'project') {
        const rows = queryAll(
            `SELECT id FROM assets WHERE project_name = ?`,
            [scope.value],
        );
        return new Set(rows.map((r) => r[0] as string));
    }

    if (scope.type === 'tag') {
        const rows = queryAll(
            `SELECT at.asset_id FROM asset_tags at
             JOIN tags t ON t.id = at.tag_id
             WHERE t.name = ?`,
            [scope.value],
        );
        return new Set(rows.map((r) => r[0] as string));
    }

    if (scope.type === 'folder') {
        // Klasör prefix eşleştirme — alt klasörler dahil
        const prefix = scope.value.replace(/\\/g, '/');
        const rows = queryAll(
            `SELECT id FROM assets WHERE REPLACE(file_path, '\\', '/') LIKE ?`,
            [prefix + '%'],
        );
        return new Set(rows.map((r) => r[0] as string));
    }

    if (scope.type === 'assets') {
        // Explicit asset ID listesi — sentez modu
        return new Set(scope.values);
    }

    return null;
}

// ── RAG Hassasiyet Filtresi ─────────────────────────────────────────────────

const SENSITIVITY_CATEGORIES: Record<string, string[]> = {
    financial: ['maaş','fatura','teklif','bütçe','ödeme','maliyet','hakediş','keşif','gelir','gider','banka','iban'],
    personal: ['tc kimlik','nüfus','telefon','adres','doğum','ehliyet','pasaport'],
    legal:    ['sözleşme','nda','gizlilik','mahkeme','ihtarname','vekaletname','noter','dava'],
    hr:       ['özlük','izin','sicil','performans','disiplin','işe alım','mülakat'],
};

/** Session-bazlı keyword cache — ayar değiştiğinde temizlenir. */
let _sensitivityCache: { key: string; excludedIds: Set<string> } | null = null;

/** Ayar değiştiğinde cache'i temizle (settings UI'dan çağrılır). */
export function clearSensitivityCache(): void { _sensitivityCache = null; }

/**
 * Hassasiyet filtresi: manuel hariç tutulanlar + keyword eşleşmeleri.
 * Sonuç: hariç tutulması gereken asset ID'leri.
 */
function getSensitivityExcludedIds(): Set<string> {
    if (getSetting('rag_sensitivity_enabled') !== 'true') return new Set();

    // Aktif kategorilerin kelimelerini topla
    const activeCategories: string[] = (() => {
        try { return JSON.parse(getSetting('rag_sensitivity_categories') || '[]'); }
        catch { return []; }
    })();
    const customKeywords: string[] = (() => {
        try { return JSON.parse(getSetting('rag_sensitivity_keywords') || '[]'); }
        catch { return []; }
    })();

    const allKeywords: string[] = [];
    for (const cat of activeCategories) {
        if (SENSITIVITY_CATEGORIES[cat]) allKeywords.push(...SENSITIVITY_CATEGORIES[cat]);
    }
    allKeywords.push(...customKeywords.filter(k => k.trim()));

    // Cache kontrolü — aynı kelime seti ile tekrar sorgulamayı önle
    const cacheKey = allKeywords.sort().join('|');
    if (_sensitivityCache && _sensitivityCache.key === cacheKey) {
        // Manuel hariç tutulanları cache'e ekle (her zaman güncel)
        const manual = getExcludedAssetIds();
        const combined = new Set(_sensitivityCache.excludedIds);
        for (const id of manual) combined.add(id);
        return combined;
    }

    // Manuel hariç tutulanlar
    const excluded = getExcludedAssetIds();

    // Keyword eşleşmeleri
    if (allKeywords.length > 0) {
        const keywordMatches = findAssetIdsByKeywords(allKeywords);
        for (const id of keywordMatches) excluded.add(id);
    }

    _sensitivityCache = { key: cacheKey, excludedIds: new Set(excluded) };
    return excluded;
}

/**
 * Scope sonucundan hassas asset'leri çıkarır.
 * eligible = null (tüm arşiv) ise, sadece hariç tutulanları Set olarak döndürmez —
 * bunun yerine retrieve fonksiyonlarında her hit kontrol edilir.
 */
function applySensitivityFilter(eligible: Set<string> | null): { eligible: Set<string> | null; excluded: Set<string> } {
    const excluded = getSensitivityExcludedIds();
    if (excluded.size === 0) return { eligible, excluded };

    if (eligible === null) {
        // 'all' scope — excluded set'i ayrı döndür, retrieve'de kontrol edilecek
        return { eligible: null, excluded };
    }

    // Filtered scope — eligible set'ten çıkar
    for (const id of excluded) eligible.delete(id);
    return { eligible, excluded };
}

const RRF_K = 60;

function rrfFuse(
    lists: Array<Map<string, { assetId: string; score: number }>>,
): Map<string, { assetId: string; score: number }> {
    // Her liste kendi içinde skora göre sıralanır → rank atanır
    const fused = new Map<string, { assetId: string; score: number }>();

    for (const list of lists) {
        // Skora göre sırala
        const sorted = [...list.entries()].sort((a, b) => b[1].score - a[1].score);

        for (let rank = 0; rank < sorted.length; rank++) {
            const [chunkId, { assetId }] = sorted[rank];
            const rrfScore = 1 / (RRF_K + rank + 1); // rank 0-based → +1
            const existing = fused.get(chunkId);
            if (existing) {
                existing.score += rrfScore;
            } else {
                fused.set(chunkId, { assetId, score: rrfScore });
            }
        }
    }

    return fused;
}

/**
 * Hibrit arama: semantic cosine + FTS5 keyword + asset metadata keyword.
 * Sol panel ile aynı skoring formülü (computeHybridFinalScore) kullanır.
 * Tüm embedding'ler RAM cache'den okunur — geniş scope'ta da tam semantic arama yapılır.
 */
export async function retrieve(
    query: string,
    scope: RagScope = { type: 'all' },
    topK: number = DEFAULT_TOP_K,
    _minScore: number = DEFAULT_MIN_SCORE,
    onPhase?: (phase: string) => void,
    onProgress?: (d: RetrieveDiagnostics) => void,
): Promise<Array<{ chunkId: string; assetId: string; score: number }>> {
    if (!query.trim()) return [];

    onPhase?.('loading_model');
    await loadEmbeddingModel();
    const queryVec = await generateEmbedding(query);
    const rawEligible = getScopeAssetIds(scope);
    const { eligible, excluded: sensitivityExcluded } = applySensitivityFilter(rawEligible);
    const dimStats = { skipped: 0, observedDims: new Set<number>() };

    // Stage 1: FTS5 keyword candidates (sub-ms)
    // Stop word'leri at — "merdiven hangi dwg dosyasında" → FTS5'e sadece "merdiven" gitsin.
    // İngilizce genişletmeler (stair, staircase) buraya DAHIL EDİLMEZ: 3D MAX modellerinin
    // İngilizce layer isimlerinde eşleşip alakasız sonuçlar getiriyordu. Multilingual embedding
    // zaten Türkçe↔İngilizce semantik eşleşmeyi kendisi yapıyor.
    const { significantTokens } = extractSearchTokens(query);
    const ftsQuery = significantTokens.length > 0 ? significantTokens.join(' ') : query;
    const keywordScores = await ftsSearchChunksAsync(ftsQuery, 300);
    for (const [chunkId, v] of keywordScores) {
        if (eligible && !eligible.has(v.assetId)) keywordScores.delete(chunkId);
        else if (sensitivityExcluded.has(v.assetId)) keywordScores.delete(chunkId);
    }

    // Stage 2: TÜM embedding'leri cache'den yükle (ilk seferde DB'den, sonra RAM'den)
    onPhase?.('loading_vectors');
    const allEmbeddings = await getRagCachedEmbeddingsAsync();
    await yieldToUI();

    // Stage 3: Cosine similarity — tüm vektörlerde ara
    onPhase?.('comparing');
    const semanticScores = new Map<string, { assetId: string; score: number }>();
    for (const row of allEmbeddings) {
        if (eligible && !eligible.has(row.assetId)) continue;
        if (sensitivityExcluded.has(row.assetId)) continue;
        if (row.vector.length !== queryVec.length) {
            dimStats.skipped++;
            dimStats.observedDims.add(row.vector.length);
            continue;
        }
        const score = cosineSimilarity(queryVec, row.vector);
        if (score > 0.1) {
            semanticScores.set(row.chunkId, { assetId: row.assetId, score });
        }
    }
    await yieldToUI();

    // Stage 4: Asset metadata keyword araması — cache'li indeks kullan.
    // Burada eş anlamlıları DA kullanıyoruz (stair/basamak vb.) — metadata'da İngilizce
    // etiket/layer olsa da skor eşik mantığı yanlış pozitifleri FTS5 gibi LIMIT'e itmiyor.
    onPhase?.('metadata_search');
    const expandedQuery = expandQuery(query);
    const metadataBoost = new Map<string, number>(); // assetId → keyword score
    const searchIndex = getRagAssetSearchIndex();
    for (const [assetId, searchText] of searchIndex) {
        if (eligible && !eligible.has(assetId)) continue;
        if (sensitivityExcluded.has(assetId)) continue;
        const kwScore = computeKeywordScore(searchText, expandedQuery);
        if (kwScore > 0) {
            metadataBoost.set(assetId, kwScore);
        }
    }

    // Stage 5: Tüm chunk'ları birleştir — hybrid scoring
    const threshold = semanticMatchThreshold(50); // varsayılan orta hassasiyet
    const chunkFinal = new Map<string, { assetId: string; score: number }>();

    // Semantic sonuçları ekle
    for (const [chunkId, { assetId, score: semScore }] of semanticScores) {
        const metaKw = metadataBoost.get(assetId) ?? 0;
        const hybrid = computeHybridFinalScore(metaKw, semScore, threshold);
        chunkFinal.set(chunkId, { assetId, score: hybrid });
    }

    // FTS5 keyword sonuçları — semantic'te olmayan chunk'ları ekle
    for (const [chunkId, { assetId, score: ftsScore }] of keywordScores) {
        if (chunkFinal.has(chunkId)) {
            // Zaten semantic'ten var — FTS match bonus ekle
            const existing = chunkFinal.get(chunkId)!;
            existing.score = Math.min(1, existing.score + ftsScore * 0.1);
        } else {
            // Sadece keyword match — metadata boost ile birleştir
            const metaKw = metadataBoost.get(assetId) ?? 0;
            const baseScore = Math.max(ftsScore * 0.5, metaKw);
            chunkFinal.set(chunkId, { assetId, score: baseScore });
        }
    }

    // Stage 6: Asset başına max chunk sınırı + topK
    const sorted = [...chunkFinal.entries()]
        .map(([chunkId, v]) => ({ chunkId, assetId: v.assetId, score: v.score }))
        .sort((a, b) => b.score - a.score);

    const result: Array<{ chunkId: string; assetId: string; score: number }> = [];
    const assetChunkCount = new Map<string, number>();

    // ── Keyword gate ──────────────────────────────────────────────────────
    // fts_chunks yoksa (pre-2.4.8 arşivler / sql.js FTS5 quirk) keyword skoru
    // çok zayıf kalır (fallback ftsScore×0.5 ≈ 0.25→0.02) ve semantik gürültü
    // bunu topK dışına iter — kullanıcı birebir bir terim (özel isim "Şenay"
    // vb.) yazsa bile o terimi GEÇEN chunk LLM'e ulaşmaz. Önlem: anlamlı
    // sorgu token'larının TÜMÜNÜ birebir (normalize, kelime sınırı) içeren
    // keyword-hit chunk'ları, normal topK doldurmadan ÖNCE, güçlü skor +
    // asset-başı sınır dahilinde GARANTİ dahil et. Yüksek-kesinlikli kanıt:
    // kullanıcının kelimeleri belgede aynen geçiyor → en üstte sıralanmalı,
    // tüm eşikleri geçmeli. Token yoksa/keyword hit yoksa hiç çalışmaz →
    // mevcut davranış birebir korunur.
    if (significantTokens.length > 0 && keywordScores.size > 0) {
        // V3 PRE-5c: epoch>=2'de text_chunks vec.db'de → async routing.
        const gated = (await getChunksByIdsAsync([...keywordScores.keys()]))
            .filter((c) => {
                const norm = normalizeTr(c.text);
                return significantTokens.every((tok) => hasWordMatch(norm, tok));
            })
            .map((c) => ({
                chunkId: c.id,
                assetId: c.assetId,
                kw: keywordScores.get(c.id)?.score ?? 0,
            }))
            .sort((a, b) => b.kw - a.kw);
        let gi = 0;
        for (const g of gated) {
            if (result.length >= topK) break;
            const count = assetChunkCount.get(g.assetId) ?? 0;
            if (count >= MAX_CHUNKS_PER_ASSET) continue;
            assetChunkCount.set(g.assetId, count + 1);
            // Güçlü skor tabanı: birebir tüm-token eşleşmesi en üstte sıralansın
            // ve STRONG/min-score eşiklerini geçsin; gated'ler kendi keyword
            // sırasını küçük epsilon ile korur.
            result.push({ chunkId: g.chunkId, assetId: g.assetId, score: 0.99 - gi * 0.001 });
            gi++;
        }
    }
    // ──────────────────────────────────────────────────────────────────────

    for (const item of sorted) {
        if (result.length >= topK) break;
        if (result.some((r) => r.chunkId === item.chunkId)) continue; // keyword gate'te eklendi
        const count = assetChunkCount.get(item.assetId) ?? 0;
        if (count >= MAX_CHUNKS_PER_ASSET) continue;
        assetChunkCount.set(item.assetId, count + 1);
        result.push(item);
    }

    // Stage C — teşhis sinyalini yay
    if (onProgress) {
        const diag: RetrieveDiagnostics = {
            ftsHits: keywordScores.size,
            embHits: semanticScores.size,
            fusedHits: chunkFinal.size,
            finalHits: result.length,
        };
        if (dimStats.skipped > 0) {
            diag.dimMismatch = {
                queryDim: queryVec.length,
                skipped: dimStats.skipped,
                observedDims: [...dimStats.observedDims].sort((a, b) => a - b),
            };
        }
        onProgress(diag);
    }

    return result;
}

/**
 * Prompt template — Türkçe, kaynak-zorlamalı.
 * Halüsinasyonu azaltmak için "kaynak yetersizse 'bilmiyorum' de" talimatı.
 */
function buildPrompt(
    query: string,
    chunks: Array<{ index: number; fileName: string; page: number | null; text: string }>,
    history: Array<{ role: string; content: string }> = [],
): string {
    const sourcesBlock = chunks
        .map((c) => {
            const ref = c.page != null ? `${c.fileName} (s.${c.page})` : c.fileName;
            return `[${c.index}] (${ref})\n${c.text}`;
        })
        .join('\n\n---\n\n');

    // Konuşma bağlamı: sadece son 4 mesaj, her biri en fazla 400 karakter (prompt patlamasın)
    const trimmedHistory = history.slice(-4).map((m) => ({
        role: m.role,
        content: m.content.length > 400 ? m.content.slice(0, 400) + '…' : m.content,
    }));
    const historyBlock = trimmedHistory.length > 0
        ? `ÖNCEKİ KONUŞMA (sadece sorunun bağlamını anlamak için — cevap üretmek için kullanma):\n`
          + trimmedHistory.map((m) => `${m.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${m.content}`).join('\n')
          + '\n\n'
        : '';

    return `/no_think
[KESIN KURAL] Cevabın TAMAMI TÜRKÇE olacak. İngilizce TEK KELIME bile yazma.
[KESIN KURAL] Düşünme akışı, plan, ön yorum YAZMA. "Let me...", "The answer...", "Possible answer:", "So...", "er...", "Hmm..." gibi ifadeler YASAK.
[KESIN KURAL] DİREKT cevap yaz. Önsöz, tekrar, açıklama YOK.

Mimari arşiv asistanısın. Aşağıdaki KAYNAKLAR'dan DİREKT, KISA, TÜRKÇE cevap ver.

FORMAT: "[N] dosya_adı: bilgi" — tek satır veya 2-3 maddelik liste.
KAYNAKLAR soruya uygun değilse: "Bu konuda arşivde bilgi bulamadım."

KAYNAKLAR:
${sourcesBlock}

${historyBlock}SORU: ${query}

CEVAP (Türkçe, direkt):`;
}

// normalizeOllamaGenerateUrl → ollamaService.ts'e tasindi, re-export
export { normalizeOllamaGenerateUrl } from './ollamaService';

/**
 * Tam RAG pipeline: retrieve → prompt → Ollama generate → answer + citations.
 */
export async function askQuestion(
    query: string,
    config: AIConfig,
    options: RagOptions = {},
    scope: RagScope = { type: 'all' },
    history: Array<{ role: string; content: string }> = [],
): Promise<RagAnswer> {
    const t0 = performance.now();
    const rerank = _rerankerEnabled;
    const keepAfterRerank = options.topK ?? DEFAULT_TOP_K;
    const retrieveTopK = rerank ? Math.max(keepAfterRerank, RERANK_POOL) : keepAfterRerank;
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET;

    // Stage 0 — Selamlama: RAG bypass
    const greeting = detectGreeting(query);
    if (greeting) {
        return {
            answer: greeting,
            citations: [],
            model: 'greeting',
            retrievedChunks: 0,
            elapsedMs: performance.now() - t0,
        };
    }

    // Stage A — Liste niyetli sorguları LLM'siz cevapla
    if (detectListIntent(query)) {
        const direct = await directFileListAnswer(query, scope, options.topK ?? 10);
        if (direct) {
            return {
                answer: direct.answer,
                citations: direct.citations,
                model: 'direct-list',
                retrievedChunks: direct.citations.length,
                elapsedMs: performance.now() - t0,
            };
        }
    }

    // Query rewriting — kısa sorguyu eş anlamlı + İng karşılıklarla zenginleştir (recall artar).
    // retrieve() FTS5'i orijinal Türkçe token'larla çalıştırır; eş anlamlılar embedding/metadata'da.
    const searchQuery = _queryRewriteEnabled ? await enrichQuery(query, config) : query;

    const retrieveHits = await retrieve(searchQuery, scope, retrieveTopK, minScore);
    if (retrieveHits.length === 0) {
        return {
            answer: 'Bu konuda arşivde bilgi bulamadım. (Hiçbir chunk benzerlik eşiğini geçmedi.)' + await buildNoResultDiagnostic(searchQuery),
            citations: [],
            model: chatModel(config),
            retrievedChunks: 0,
            elapsedMs: performance.now() - t0,
        };
    }

    const chunkRows = await getChunksByIdsAsync(retrieveHits.map((h) => h.chunkId));
    const byId = new Map(chunkRows.map((c) => [c.id, c]));

    // LLM Rerank
    let hits = retrieveHits;
    if (rerank && retrieveHits.length > keepAfterRerank) {
        const rerankInput = retrieveHits.map((h) => {
            const row = byId.get(h.chunkId);
            return {
                chunkId: h.chunkId,
                assetId: h.assetId,
                score: h.score,
                fileName: row?.fileName || h.assetId,
                text: row?.text || '',
            };
        }).filter((c) => c.text);
        hits = await llmRerank(query, rerankInput, config, keepAfterRerank);
    } else if (retrieveHits.length > keepAfterRerank) {
        hits = retrieveHits.slice(0, keepAfterRerank);
    }

    const promptChunks: Array<{ index: number; fileName: string; page: number | null; text: string }> = [];
    const citations: RagCitation[] = [];
    hits.forEach((hit, i) => {
        const row = byId.get(hit.chunkId);
        if (!row) return;
        const idx = i + 1;
        promptChunks.push({
            index: idx,
            fileName: row.fileName || hit.assetId,
            page: row.page,
            text: row.text,
        });
        citations.push({
            index: idx,
            chunkId: hit.chunkId,
            assetId: hit.assetId,
            fileName: row.fileName || hit.assetId,
            filePath: row.filePath,
            page: row.page,
            score: hit.score,
            snippet: truncateAtSentence(row.text, snippetChars),
        });
    });

    const prompt = buildPrompt(query, promptChunks, history);
    const model = chatModel(config);
    const url = normalizeOllamaGenerateUrl(config.apiUrl);

    // Dinamik num_ctx: prompt uzunluğuna göre ayarla (token tahmini: karakter/4)
    const estimatedTokens = Math.ceil(prompt.length / 4);
    const numCtx = Math.max(4096, Math.min(16384, estimatedTokens * 2));

    const reqBody = JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
            temperature: 0.2,
            num_ctx: numCtx,
            num_predict: 350,      // kısa madde listeleri için yeter — loop'u keser
            repeat_penalty: 1.15,  // tekrarlayan cümleleri cezalandır
            repeat_last_n: 256,    // son 256 token penceresinde tekrar kontrolü
        },
    });

    let answer = '';
    try {
        const responseStr = await invokeWithTimeout<string>(
            'ollama_proxy',
            { url, body: reqBody },
            120_000,
        );
        const data = JSON.parse(responseStr);
        answer = (data.response || '').trim();
    } catch (err) {
        debugLog('ragService', 'ollama_proxy failed', err);
        throw new Error(`AI sunucusuna ulaşılamadı: ${String(err)}. Ollama çalışıyor mu? (ollama serve)`);
    }

    if (!answer) {
        answer = 'Model boş cevap döndürdü. Modelin yüklü olduğundan emin olun: `ollama pull ' + model + '`';
    }

    return {
        answer,
        citations,
        model,
        retrievedChunks: hits.length,
        elapsedMs: performance.now() - t0,
    };
}

/* ─── Streaming variant ─────────────────────────────────────────── */

export type TokenStats = {
    tokensIn: number | null;
    tokensOut: number | null;
};

export type StreamCallbacks = {
    /** Her yeni token geldiğinde çağrılır (kümülatif değil, delta). */
    onToken: (token: string) => void;
    /** Stream tamamlandığında çağrılır. */
    onDone?: (fullAnswer: string, tokenStats?: TokenStats) => void;
    /** Hata durumunda çağrılır. */
    onError?: (error: string) => void;
    /** Faz değiştiğinde çağrılır (ön-stream aşamaları için). */
    onPhase?: (phase: string) => void;
    /** Retrieve aşaması teşhis bilgisi (Stage C) — aday sayıları, dim uyumsuzluğu. */
    onProgress?: (d: RetrieveDiagnostics) => void;
};

/**
 * Streaming RAG pipeline: retrieve → prompt → Ollama generate (stream:true) → token-by-token callback.
 *
 * Frontend fetch ile doğrudan Ollama'ya bağlanır (CSP'de localhost:11434 izinli).
 * AbortSignal ile iptal edilebilir.
 *
 * @returns citations (retrieve aşamasında zaten hazır) + cleanup
 */
export async function askQuestionStream(
    query: string,
    config: AIConfig,
    callbacks: StreamCallbacks,
    options: RagOptions = {},
    scope: RagScope = { type: 'all' },
    history: Array<{ role: string; content: string }> = [],
    abortSignal?: AbortSignal,
): Promise<{ citations: RagCitation[]; model: string; retrievedChunks: number; tokenStats: TokenStats; thinking?: string }> {
    _lastQueryWarnings = [];
    const rerank = _rerankerEnabled;
    const retrieveTopK = rerank ? Math.max(options.topK ?? DEFAULT_TOP_K, RERANK_POOL) : (options.topK ?? DEFAULT_TOP_K);
    const keepAfterRerank = options.topK ?? DEFAULT_TOP_K;
    const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET;

    // Stage 0 — Selamlama/sohbet kalıpları: RAG'e gitme, sabit cevap dön.
    // "merhaba" gibi kelimeler bozuk PDF chunk'larında eşleşme buluyordu.
    const greeting = detectGreeting(query);
    if (greeting) {
        callbacks.onToken(greeting);
        callbacks.onDone?.(greeting);
        return {
            citations: [],
            model: 'greeting',
            retrievedChunks: 0,
            tokenStats: { tokensIn: null, tokensOut: null },
        };
    }

    // Stage A — Liste niyetli basit sorularda LLM'i bypass et.
    // "merdiven hangi dwg dosyasında" → doğrudan asset metadata araması, anında cevap.
    if (detectListIntent(query)) {
        const direct = await directFileListAnswer(query, scope, options.topK ?? 10);
        if (direct) {
            callbacks.onToken(direct.answer);
            callbacks.onDone?.(direct.answer);
            return {
                citations: direct.citations,
                model: 'direct-list',
                retrievedChunks: direct.citations.length,
                tokenStats: { tokensIn: null, tokensOut: null },
            };
        }
    }

    // Query rewriting — kısa sorguyu eş anlamlı + İng karşılıklarla zenginleştir.
    // retrieve() içinde FTS5 için stop-word filtresi uygulanıyor; genişletmeyi RETRIEVE'e
    // değil yalnızca metadata skoruna sokuyoruz (İng synonyms FTS5'i gürültüyle doldurmasın).
    callbacks.onPhase?.('searching');
    const searchQuery = _queryRewriteEnabled ? await enrichQuery(query, config) : query;

    // Retrieve diag'ını rerank sonrasında da kullanabilmek için yakala
    let lastDiag: RetrieveDiagnostics | null = null;
    const diagCapture = (d: RetrieveDiagnostics) => {
        lastDiag = d;
        callbacks.onProgress?.(d);
    };
    const retrieveHits = await retrieve(searchQuery, scope, retrieveTopK, minScore, callbacks.onPhase, diagCapture);
    if (retrieveHits.length === 0) {
        const msg = 'Bu konuda arşivde bilgi bulamadım. (Hiçbir chunk benzerlik eşiğini geçmedi.)' + await buildNoResultDiagnostic(searchQuery);
        callbacks.onToken(msg);
        callbacks.onDone?.(msg);
        return { citations: [], model: chatModel(config), retrievedChunks: 0, tokenStats: { tokensIn: null, tokensOut: null } };
    }

    // Rerank için chunk metinlerini çek
    const chunkRows = await getChunksByIdsAsync(retrieveHits.map((h) => h.chunkId));
    const byId = new Map(chunkRows.map((c) => [c.id, c]));

    // LLM Rerank — topK > keep ise LLM ile yeniden sırala
    let hits = retrieveHits;
    if (rerank && retrieveHits.length > keepAfterRerank) {
        callbacks.onPhase?.('reranking');
        const rerankInput = retrieveHits.map((h) => {
            const row = byId.get(h.chunkId);
            return {
                chunkId: h.chunkId,
                assetId: h.assetId,
                score: h.score,
                fileName: row?.fileName || h.assetId,
                text: row?.text || '',
            };
        }).filter((c) => c.text);
        hits = await llmRerank(query, rerankInput, config, keepAfterRerank);
        if (lastDiag !== null) {
            const prev = lastDiag as RetrieveDiagnostics;
            callbacks.onProgress?.({ ...prev, rerankedHits: hits.length });
        }
    } else if (retrieveHits.length > keepAfterRerank) {
        hits = retrieveHits.slice(0, keepAfterRerank);
    }

    const promptChunks: Array<{ index: number; fileName: string; page: number | null; text: string }> = [];
    const citations: RagCitation[] = [];
    hits.forEach((hit, i) => {
        const row = byId.get(hit.chunkId);
        if (!row) return;
        const idx = i + 1;
        promptChunks.push({ index: idx, fileName: row.fileName || hit.assetId, page: row.page, text: row.text });
        citations.push({
            index: idx,
            chunkId: hit.chunkId,
            assetId: hit.assetId,
            fileName: row.fileName || hit.assetId,
            filePath: row.filePath,
            page: row.page,
            score: hit.score,
            snippet: truncateAtSentence(row.text, snippetChars),
        });
    });

    const prompt = buildPrompt(query, promptChunks, history);
    const model = chatModel(config);

    // Dinamik num_ctx: prompt uzunluğuna göre ayarla (token tahmini: karakter/4)
    const estimatedTokens = Math.ceil(prompt.length / 4);
    const numCtx = Math.max(4096, Math.min(16384, estimatedTokens * 2));

    // Ollama URL'i: doğrudan fetch (stream için Rust proxy bypass).
    // SSRF koruması: frontend'te de localhost-only doğrulama yap (Rust'taki
    // validate_ollama_url ile aynı kurallar) — aksi halde uzak host'a sızıntı riski.
    let baseUrl = (config.apiUrl || 'http://localhost:11434').replace(/\/$/, '');
    baseUrl = baseUrl.replace(/\/(v1\/chat\/completions|api\/generate|api\/chat)\/?$/, '').replace(/\/$/, '');
    const streamUrl = baseUrl + '/api/generate';
    assertLocalOllamaUrl(streamUrl);

    let tokenStats: TokenStats = { tokensIn: null, tokensOut: null };

    callbacks.onPhase?.('generating');
    try {
        const resp = await fetch(streamUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: true,
                // Düşünen modellerde (Qwen3, DeepSeek-R1) thinking'i kapat —
                // aksi hâlde num_predict'i düşünme token'ları dolduruyor, cevap boş geliyor.
                // /no_think user-prompt'ta olsa da sistem seviyesinde garanti değil.
                think: false,
                options: {
                    temperature: 0.2,
                    num_ctx: numCtx,
                    num_predict: 350,
                    repeat_penalty: 1.15,
                    repeat_last_n: 256,
                },
            }),
            signal: abortSignal,
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => resp.statusText);
            throw new Error(`Ollama HTTP ${resp.status}: ${errText}`);
        }

        const reader = resp.body?.getReader();
        if (!reader) throw new Error('Stream body okunamadı');

        const decoder = new TextDecoder();
        let fullAnswer = '';
        let fullThinking = '';
        let buffer = '';
        // <think>...</think> içinde miyiz? Thinking UI'ya pompalanmaz, ayrı buffer'da
        // toplanır ve return'de verilir; UI collapsible olarak gösterir.
        let inThinkBlock = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Ollama NDJSON formatı: her satır bir JSON objesi
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // son eksik satırı buffer'da tut

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const obj = JSON.parse(trimmed);
                    if (obj.response) {
                        // <think> bloklarını stream içinde ayır
                        let chunk = obj.response as string;
                        let emit = '';
                        while (chunk.length > 0) {
                            if (inThinkBlock) {
                                const end = chunk.indexOf('</think>');
                                if (end === -1) {
                                    fullThinking += chunk;
                                    chunk = '';
                                    break;
                                }
                                fullThinking += chunk.slice(0, end);
                                chunk = chunk.slice(end + '</think>'.length);
                                inThinkBlock = false;
                            } else {
                                const start = chunk.indexOf('<think>');
                                if (start === -1) { emit += chunk; chunk = ''; break; }
                                emit += chunk.slice(0, start);
                                chunk = chunk.slice(start + '<think>'.length);
                                inThinkBlock = true;
                            }
                        }
                        if (emit) {
                            fullAnswer += emit;
                            callbacks.onToken(emit);
                        }
                    }
                    if (obj.done) {
                        // done=true satırında token istatistikleri mevcut
                        tokenStats = {
                            tokensIn: typeof obj.prompt_eval_count === 'number' ? obj.prompt_eval_count : null,
                            tokensOut: typeof obj.eval_count === 'number' ? obj.eval_count : null,
                        };
                        callbacks.onDone?.(fullAnswer, tokenStats);
                        return { citations, model, retrievedChunks: hits.length, tokenStats, thinking: fullThinking.trim() || undefined };
                    }
                } catch {
                    // JSON parse hatası — eksik satır, buffer'a geri bırak
                    debugLog('ragService', 'stream parse skip', trimmed.slice(0, 80));
                }
            }
        }

        // Stream doğal yoldan bittiyse (done flag gelmeden)
        if (fullAnswer) callbacks.onDone?.(fullAnswer, tokenStats);
    } catch (err) {
        if (abortSignal?.aborted) {
            // Kullanıcı iptal etti — hata değil
            debugLog('ragService', 'stream aborted by user');
            return { citations, model, retrievedChunks: hits.length, tokenStats };
        }
        const msg = `AI sunucusuna ulaşılamadı: ${String((err as Error).message || err)}. Ollama çalışıyor mu? (ollama serve)`;
        callbacks.onError?.(msg);
        throw new Error(msg);
    }

    return { citations, model, retrievedChunks: hits.length, tokenStats };
}

/* ─── Çoklu Dosya Sentezi (Faz 3) ────────────────────────────────── */

/**
 * Seçili asset listesinden her belge için en iyi N chunk'ı döner.
 * "Fair sampling": tek bir belge tüm top-K'yı domine edemez, her belge en az kendi en iyisini verir.
 *
 * Semantic + keyword RRF fusion her asset için ayrı hesaplanır — böylece her belgenin kendi iç
 * sıralaması korunur. Eğer bir belge hiç ilgili chunk üretmiyorsa listelenmez (sentez için
 * "bu belgede ilgili bilgi yok" bilinci ayrı bir ipucu).
 */
export async function retrievePerAsset(
    query: string,
    assetIds: string[],
    topPerAsset: number = 3,
    onProgress?: (d: RetrieveDiagnostics) => void,
): Promise<Array<{ chunkId: string; assetId: string; score: number }>> {
    if (!query.trim() || assetIds.length === 0) return [];

    await loadEmbeddingModel();
    const queryVec = await generateEmbedding(query);
    const eligible = new Set(assetIds);
    const dimStats = { skipped: 0, observedDims: new Set<number>() };

    // Yalnızca seçili asset'lerin vektörlerini SQL ile çek (tam tablo taraması yok)
    // V3 PRE-5b: epoch>=1'de embeddings vec.db'de → async routing.
    const vectorRows = await getChunkEmbeddingsByAssetIdsAsync(assetIds);
    if (vectorRows.length === 0) return [];

    // Asset bazlı semantic skor tabloları
    const perAssetSemantic = new Map<string, Map<string, { assetId: string; score: number }>>();
    for (const row of vectorRows) {
        if (row.vector.length !== queryVec.length) {
            dimStats.skipped++;
            dimStats.observedDims.add(row.vector.length);
            continue;
        }
        const score = cosineSimilarity(queryVec, row.vector);
        if (score > 0.1) {
            let m = perAssetSemantic.get(row.assetId);
            if (!m) { m = new Map(); perAssetSemantic.set(row.assetId, m); }
            m.set(row.chunkId, { assetId: row.assetId, score });
        }
    }

    // Keyword skorları: FTS5 ile çek, eligible ile filtrele
    const keywordAll = await ftsSearchChunksAsync(query, 300);
    const perAssetKeyword = new Map<string, Map<string, { assetId: string; score: number }>>();
    for (const [chunkId, v] of keywordAll) {
        if (!eligible.has(v.assetId)) continue;
        let m = perAssetKeyword.get(v.assetId);
        if (!m) { m = new Map(); perAssetKeyword.set(v.assetId, m); }
        m.set(chunkId, v);
    }

    // Her asset için ayrı RRF — kendi içinde top-N
    const result: Array<{ chunkId: string; assetId: string; score: number }> = [];
    for (const assetId of assetIds) {
        const sem = perAssetSemantic.get(assetId) || new Map();
        const kw = perAssetKeyword.get(assetId) || new Map();
        if (sem.size === 0 && kw.size === 0) continue;
        const fused = rrfFuse([sem, kw]);
        const sorted = [...fused.entries()]
            .map(([chunkId, v]) => ({ chunkId, assetId: v.assetId, score: v.score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, topPerAsset);
        // Sentezde alakasız belgeleri atla — en iyi chunk'ı bile eşik altındaysa boş token israfı
        const SYNTHESIS_MIN_SCORE = 0.012;
        if (sorted.length > 0 && sorted[0].score < SYNTHESIS_MIN_SCORE) continue;
        result.push(...sorted);
    }

    // Stage C — teşhis sinyali (sentez bağlamında aday sayımları asset başına)
    if (onProgress) {
        let totalSem = 0;
        let totalKw = 0;
        for (const m of perAssetSemantic.values()) totalSem += m.size;
        for (const m of perAssetKeyword.values()) totalKw += m.size;
        const diag: RetrieveDiagnostics = {
            ftsHits: totalKw,
            embHits: totalSem,
            fusedHits: result.length,
            finalHits: result.length,
        };
        if (dimStats.skipped > 0) {
            diag.dimMismatch = {
                queryDim: queryVec.length,
                skipped: dimStats.skipped,
                observedDims: [...dimStats.observedDims].sort((a, b) => a - b),
            };
        }
        onProgress(diag);
    }

    return result;
}

/**
 * Sentez prompt'u: her belgenin chunk'ları ayrı bir bölüm olarak verilir.
 * LLM her belgeden kısa özet + karşılaştırma/sentez üretmeye yönlendirilir.
 *
 * Kaynak gösterimi standart `[N] dosya_adı` formatı — citation entegrasyonu bozulmaz.
 *
 * @internal Test edilebilirlik için export edildi.
 */
export function buildSynthesisPrompt(
    query: string,
    chunksByAsset: Array<{
        assetId: string;
        fileName: string;
        chunks: Array<{ index: number; page: number | null; text: string }>;
    }>,
    history: Array<{ role: string; content: string }> = [],
): string {
    // Her belge için ayrı bölüm
    const docBlocks = chunksByAsset
        .map((doc, docIdx) => {
            const header = `BELGE ${docIdx + 1} — ${doc.fileName}`;
            const chunkLines = doc.chunks
                .map((c) => {
                    const pageRef = c.page != null ? ` (s.${c.page})` : '';
                    return `[${c.index}]${pageRef} ${c.text}`;
                })
                .join('\n\n');
            return `${header}\n${'─'.repeat(60)}\n${chunkLines}`;
        })
        .join('\n\n');

    const trimmedHistory = history.slice(-4).map((m) => ({
        role: m.role,
        content: m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content,
    }));
    const historyBlock = trimmedHistory.length > 0
        ? `ÖNCEKİ KONUŞMA (sadece sorunun bağlamını anlamak için):\n`
          + trimmedHistory.map((m) => `${m.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${m.content}`).join('\n')
          + '\n\n'
        : '';

    return `/no_think
[KESIN KURAL] Cevabın TAMAMI TÜRKÇE olacak. İngilizce TEK KELIME bile yazma.
[KESIN KURAL] Düşünme akışı, plan, ön yorum YAZMA. "Let me...", "The answer...", "Possible answer:", "So...", "er...", "Hmm..." gibi ifadeler YASAK.
[KESIN KURAL] DİREKT cevap yaz. Önsöz, tekrar, açıklama YOK.

Mimari arşiv asistanısın. Aşağıdaki BELGELER'den soruya DİREKT, KISA, TÜRKÇE cevap ver.

FORMAT: "[N] dosya_adı: bilgi" — tek satır veya 2-3 maddelik liste.
BELGELERDE bilgi yoksa: "Seçili belgelerde bu konuda bilgi bulunamadı."

BELGELER:
${docBlocks}

${historyBlock}SORU: ${query}

CEVAP (Türkçe, direkt):`;
}

/**
 * Çoklu dosya sentezi — non-stream variant (Ollama proxy üzerinden).
 * askSynthesisStream'in Ollama fetch yapmayan eşleniği, testler ve CLI kullanımı için.
 */
export async function askSynthesis(
    query: string,
    assetIds: string[],
    config: AIConfig,
    options: RagOptions & { topPerAsset?: number } = {},
    history: Array<{ role: string; content: string }> = [],
): Promise<RagAnswer> {
    const t0 = performance.now();
    const topPerAsset = options.topPerAsset ?? 3;
    const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET;

    if (assetIds.length < 1) {
        return {
            answer: 'Sentez için en az 1 belge seçilmeli.',
            citations: [],
            model: chatModel(config),
            retrievedChunks: 0,
            elapsedMs: performance.now() - t0,
        };
    }

    // Query rewriting ile geri çağırmayı artır
    const searchQuery = _queryRewriteEnabled ? await enrichQuery(query, config) : expandQuery(query);

    const hits = await retrievePerAsset(searchQuery, assetIds, topPerAsset);
    if (hits.length === 0) {
        return {
            answer: `Seçili ${assetIds.length} belgede bu konuda ilgili bilgi bulunamadı.`,
            citations: [],
            model: chatModel(config),
            retrievedChunks: 0,
            elapsedMs: performance.now() - t0,
        };
    }

    const chunkRows = await getChunksByIdsAsync(hits.map((h) => h.chunkId));
    const byId = new Map(chunkRows.map((c) => [c.id, c]));

    // Citation + prompt için asset bazlı grupla
    const byAsset = new Map<string, Array<{ hit: typeof hits[0]; index: number }>>();
    let idx = 0;
    const citations: RagCitation[] = [];
    for (const hit of hits) {
        const row = byId.get(hit.chunkId);
        if (!row) continue;
        idx++;
        const existing = byAsset.get(hit.assetId) || [];
        existing.push({ hit, index: idx });
        byAsset.set(hit.assetId, existing);
        citations.push({
            index: idx,
            chunkId: hit.chunkId,
            assetId: hit.assetId,
            fileName: row.fileName || hit.assetId,
            filePath: row.filePath,
            page: row.page,
            score: hit.score,
            snippet: truncateAtSentence(row.text, snippetChars),
        });
    }

    // Asset sırasını orijinal assetIds sırasına göre koru
    const chunksByAsset = assetIds
        .filter((id) => byAsset.has(id))
        .map((id) => {
            const entries = byAsset.get(id)!;
            const first = byId.get(entries[0].hit.chunkId)!;
            return {
                assetId: id,
                fileName: first.fileName || id,
                chunks: entries.map((e) => {
                    const row = byId.get(e.hit.chunkId)!;
                    return { index: e.index, page: row.page, text: row.text };
                }),
            };
        });

    const prompt = buildSynthesisPrompt(query, chunksByAsset, history);
    const model = chatModel(config);
    const url = normalizeOllamaGenerateUrl(config.apiUrl);

    // Dinamik num_ctx: sentez promptları daha uzun olabilir
    const estimatedTokens = Math.ceil(prompt.length / 4);
    const numCtx = Math.max(4096, Math.min(16384, estimatedTokens * 2));

    const reqBody = JSON.stringify({
        model,
        prompt,
        stream: false,
        think: false, // Qwen3/DeepSeek-R1 düşünme token'larını kapat
        options: {
            temperature: 0.2,
            num_ctx: numCtx,
            num_predict: 700,
            repeat_penalty: 1.15,
            repeat_last_n: 256,
        },
    });

    let answer = '';
    try {
        const responseStr = await invokeWithTimeout<string>(
            'ollama_proxy',
            { url, body: reqBody },
            180_000,
        );
        const data = JSON.parse(responseStr);
        answer = (data.response || '').trim();
        // Emniyet kemeri: <think>...</think> bloklarını temizle
        answer = answer.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    } catch (err) {
        debugLog('ragService', 'askSynthesis ollama_proxy failed', err);
        throw new Error(`AI sunucusuna ulaşılamadı: ${String(err)}. Ollama çalışıyor mu?`);
    }

    if (!answer) {
        answer = 'Model boş cevap döndürdü. Modelin yüklü olduğundan emin olun: `ollama pull ' + model + '`';
    }

    return {
        answer,
        citations,
        model,
        retrievedChunks: hits.length,
        elapsedMs: performance.now() - t0,
    };
}

/**
 * Çoklu dosya sentezi — streaming variant.
 * ChatPanel doğrudan bunu çağırır; AbortSignal ile iptal edilebilir.
 */
export async function askSynthesisStream(
    query: string,
    assetIds: string[],
    config: AIConfig,
    callbacks: StreamCallbacks,
    options: RagOptions & { topPerAsset?: number } = {},
    history: Array<{ role: string; content: string }> = [],
    abortSignal?: AbortSignal,
): Promise<{ citations: RagCitation[]; model: string; retrievedChunks: number; tokenStats: TokenStats; thinking?: string }> {
    const topPerAsset = options.topPerAsset ?? 3;
    const snippetChars = options.snippetChars ?? DEFAULT_SNIPPET;
    const model = chatModel(config);

    if (assetIds.length < 1) {
        const msg = 'Sentez için en az 1 belge seçilmeli.';
        callbacks.onToken(msg);
        callbacks.onDone?.(msg);
        return { citations: [], model, retrievedChunks: 0, tokenStats: { tokensIn: null, tokensOut: null } };
    }

    callbacks.onPhase?.('searching');
    const searchQuery = _queryRewriteEnabled ? await enrichQuery(query, config) : expandQuery(query);
    const hits = await retrievePerAsset(searchQuery, assetIds, topPerAsset, callbacks.onProgress);

    if (hits.length === 0) {
        const msg = `Seçili ${assetIds.length} belgede bu konuda ilgili bilgi bulunamadı.`;
        callbacks.onToken(msg);
        callbacks.onDone?.(msg);
        return { citations: [], model, retrievedChunks: 0, tokenStats: { tokensIn: null, tokensOut: null } };
    }

    const chunkRows = await getChunksByIdsAsync(hits.map((h) => h.chunkId));
    const byId = new Map(chunkRows.map((c) => [c.id, c]));

    // Citation + prompt için asset bazlı grupla
    const byAsset = new Map<string, Array<{ hit: typeof hits[0]; index: number }>>();
    let idx = 0;
    const citations: RagCitation[] = [];
    for (const hit of hits) {
        const row = byId.get(hit.chunkId);
        if (!row) continue;
        idx++;
        const existing = byAsset.get(hit.assetId) || [];
        existing.push({ hit, index: idx });
        byAsset.set(hit.assetId, existing);
        citations.push({
            index: idx,
            chunkId: hit.chunkId,
            assetId: hit.assetId,
            fileName: row.fileName || hit.assetId,
            filePath: row.filePath,
            page: row.page,
            score: hit.score,
            snippet: truncateAtSentence(row.text, snippetChars),
        });
    }

    const chunksByAsset = assetIds
        .filter((id) => byAsset.has(id))
        .map((id) => {
            const entries = byAsset.get(id)!;
            const first = byId.get(entries[0].hit.chunkId)!;
            return {
                assetId: id,
                fileName: first.fileName || id,
                chunks: entries.map((e) => {
                    const row = byId.get(e.hit.chunkId)!;
                    return { index: e.index, page: row.page, text: row.text };
                }),
            };
        });

    const prompt = buildSynthesisPrompt(query, chunksByAsset, history);

    // Dinamik num_ctx: prompt uzunluğuna göre ayarla (sentez promptları daha uzun olabilir)
    const estimatedTokens = Math.ceil(prompt.length / 4);
    const numCtx = Math.max(4096, Math.min(16384, estimatedTokens * 2));

    // Stream: Ollama fetch doğrudan (frontend). SSRF koruması için localhost-only
    // doğrulama — Rust ollama_proxy'deki validate_ollama_url ile aynı kurallar.
    let baseUrl = (config.apiUrl || 'http://localhost:11434').replace(/\/$/, '');
    baseUrl = baseUrl.replace(/\/(v1\/chat\/completions|api\/generate|api\/chat)\/?$/, '').replace(/\/$/, '');
    const streamUrl = baseUrl + '/api/generate';
    assertLocalOllamaUrl(streamUrl);

    let tokenStats: TokenStats = { tokensIn: null, tokensOut: null };

    callbacks.onPhase?.('generating');
    try {
        const resp = await fetch(streamUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt,
                stream: true,
                // Qwen3 / DeepSeek-R1 thinking kapalı — aksi hâlde num_predict'i
                // düşünme token'ları dolduruyor, cevap boş geliyor.
                think: false,
                options: {
                    temperature: 0.2,
                    num_ctx: numCtx,
                    num_predict: 700,
                    repeat_penalty: 1.15,
                    repeat_last_n: 256,
                },
            }),
            signal: abortSignal,
        });

        if (!resp.ok) {
            const errText = await resp.text().catch(() => resp.statusText);
            throw new Error(`Ollama HTTP ${resp.status}: ${errText}`);
        }

        const reader = resp.body?.getReader();
        if (!reader) throw new Error('Stream body okunamadı');

        const decoder = new TextDecoder();
        let fullAnswer = '';
        let fullThinking = '';
        let buffer = '';
        // Thinking yakalanır ama UI'ya pompalanmaz — return'de verilir, UI collapsible gösterir
        let inThinkBlock = false;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                try {
                    const obj = JSON.parse(trimmed);
                    if (obj.response) {
                        let chunk = obj.response as string;
                        let emit = '';
                        while (chunk.length > 0) {
                            if (inThinkBlock) {
                                const end = chunk.indexOf('</think>');
                                if (end === -1) {
                                    fullThinking += chunk;
                                    chunk = '';
                                    break;
                                }
                                fullThinking += chunk.slice(0, end);
                                chunk = chunk.slice(end + '</think>'.length);
                                inThinkBlock = false;
                            } else {
                                const start = chunk.indexOf('<think>');
                                if (start === -1) { emit += chunk; chunk = ''; break; }
                                emit += chunk.slice(0, start);
                                chunk = chunk.slice(start + '<think>'.length);
                                inThinkBlock = true;
                            }
                        }
                        if (emit) {
                            fullAnswer += emit;
                            callbacks.onToken(emit);
                        }
                    }
                    if (obj.done) {
                        tokenStats = {
                            tokensIn: typeof obj.prompt_eval_count === 'number' ? obj.prompt_eval_count : null,
                            tokensOut: typeof obj.eval_count === 'number' ? obj.eval_count : null,
                        };
                        callbacks.onDone?.(fullAnswer, tokenStats);
                        return { citations, model, retrievedChunks: hits.length, tokenStats, thinking: fullThinking.trim() || undefined };
                    }
                } catch {
                    debugLog('ragService', 'synth stream parse skip', trimmed.slice(0, 80));
                }
            }
        }

        if (fullAnswer) callbacks.onDone?.(fullAnswer, tokenStats);
    } catch (err) {
        if (abortSignal?.aborted) {
            debugLog('ragService', 'synth stream aborted by user');
            return { citations, model, retrievedChunks: hits.length, tokenStats };
        }
        const msg = `AI sunucusuna ulaşılamadı: ${String((err as Error).message || err)}. Ollama çalışıyor mu?`;
        callbacks.onError?.(msg);
        throw new Error(msg);
    }

    return { citations, model, retrievedChunks: hits.length, tokenStats };
}

/* ─── Oturum başlığı otomasyonu ──────────────────────────────────── */

/**
 * İlk soru + cevap çiftinden LLM ile kısa (2-5 kelime) Türkçe başlık üretir.
 * Hata durumunda null döner — çağıran fallback başlığa düşer.
 */
export async function generateSessionTitle(
    userQuery: string,
    assistantAnswer: string,
    config: AIConfig,
): Promise<string | null> {
    const model = chatModel(config);
    const url = normalizeOllamaGenerateUrl(config.apiUrl);

    const answerSnippet = assistantAnswer.length > 400 ? assistantAnswer.slice(0, 400) + '…' : assistantAnswer;
    const prompt = `/no_think\nAşağıdaki soru ve cevaba göre 2-5 kelimelik, Türkçe, kısa ve açıklayıcı bir SOHBET BAŞLIĞI üret. Sadece başlığı yaz — tırnak, açıklama, emoji, noktalama (sonda) yok.\n\nSORU: ${userQuery}\nCEVAP: ${answerSnippet}\n\nBAŞLIK:`;

    const reqBody = JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.3, num_ctx: 2048, num_predict: 24 },
    });

    try {
        const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url, body: reqBody }, 30_000);
        const data = JSON.parse(responseStr);
        let title = String(data.response || '').trim();
        // Temizlik: <think> blokları, tırnaklar, "BAŞLIK:" ön eki, çok satır
        title = title.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        title = title.split(/\r?\n/)[0].trim();
        title = title.replace(/^["'`*_\-\s]+|["'`*_\-\s.!?:;]+$/g, '');
        title = title.replace(/^(BAŞLIK|Başlık|Title)\s*[:\-]\s*/i, '').trim();
        if (!title) return null;
        if (title.length > 60) title = title.slice(0, 60).trim() + '…';
        return title;
    } catch (err) {
        debugLog('ragService', 'generateSessionTitle failed', err);
        return null;
    }
}

/* ─── Query Rewriting / Enrichment ──────────────────────────────── */

/**
 * Kısa Türkçe sorguyu eş anlamlı + ilgili teknik terim + İngilizce karşılıklarla zenginleştirir.
 * Mimari/inşaat arşivi domain'ine özel prompt — embedding ve keyword retrieval'ın geri çağırma
 * (recall) oranını artırır.
 *
 * Davranış:
 *  - Sorgu çok spesifikse (>QUERY_REWRITE_MAX_SIGTOKENS) orijinali döner — dokunma
 *  - Hata/timeout/kötü yanıt → orijinali döner (sessiz fallback)
 *  - Orijinal kelimeler her zaman sonuçta korunur
 */
export async function enrichQuery(query: string, config: AIConfig): Promise<string> {
    const trimmed = query.trim();
    if (!trimmed) return trimmed;

    const { significantTokens } = extractSearchTokens(trimmed);
    if (significantTokens.length === 0) return trimmed;
    if (significantTokens.length > QUERY_REWRITE_MAX_SIGTOKENS) return trimmed;

    const model = chatModel(config);
    const url = normalizeOllamaGenerateUrl(config.apiUrl);

    const prompt = `/no_think
Görev: Aşağıdaki Türkçe arama sorgusunu, mimari/inşaat arşivinde semantic + keyword arama için zenginleştir. Eş anlamlılar, ilgili teknik terimler ve varsa İngilizce karşılıklarını ekle. Orijinal kelimeleri MUTLAKA koru.

KURALLAR (kesin uy):
- Sadece zenginleştirilmiş arama metnini yaz, başka açıklama yok.
- Maksimum 12 kelime.
- Kelimeleri boşlukla ayır, virgül/madde işareti yok.
- Tırnak, açıklama, "Cevap:" gibi etiketler yok.

ÖRNEKLER:
Sorgu: merdiven
Cevap: merdiven basamak korkuluk rıht stair staircase

Sorgu: zemin kat planı
Cevap: zemin kat planı kat planı plan ground floor plan

Sorgu: ${trimmed}
Cevap:`;

    const reqBody = JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_ctx: 2048, num_predict: 40, repeat_penalty: 1.1 },
    });

    try {
        const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url, body: reqBody }, QUERY_REWRITE_TIMEOUT_MS);
        const data = JSON.parse(responseStr);
        let enriched = String(data.response || '').trim();
        // Temizlik: <think> bloğu, "Cevap:" prefix, ilk satır
        enriched = enriched.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        enriched = enriched.split(/\r?\n/)[0].trim();
        enriched = enriched.replace(/^(Cevap|Answer|Sonuç)\s*[:\-]\s*/i, '').trim();
        enriched = enriched.replace(/^["'`*\-\s]+|["'`*\s.!?]+$/g, '');

        if (!enriched || enriched.length < trimmed.length) {
            debugLog('ragService', 'enrichQuery returned shorter/empty, fallback to original', { enriched });
            return trimmed;
        }
        // Orijinal kelimeler korunmuş mu hızlı kontrol
        const norm = normalizeTr(enriched);
        const allKept = significantTokens.every((t) => hasWordMatch(norm, t));
        if (!allKept) {
            debugLog('ragService', 'enrichQuery dropped original tokens, fallback', { enriched });
            return trimmed;
        }
        // 12 kelime cap
        const words = enriched.split(/\s+/).slice(0, 12);
        return words.join(' ');
    } catch (err) {
        debugLog('ragService', 'enrichQuery failed', err);
        _lastQueryWarnings.push('query_rewrite_failed');
        return trimmed;
    }
}

/* ─── LLM-based Reranker ────────────────────────────────────────── */

/**
 * Retrieve sonrası aday chunk'ları soruyla alakalarına göre LLM ile yeniden sıralar.
 * Tek Ollama çağrısı — batch prompt ile hepsine birden skor verir.
 * Hata/timeout durumunda orijinal sırayı döner (sessiz fallback).
 */
export async function llmRerank(
    query: string,
    candidates: Array<{ chunkId: string; assetId: string; score: number; fileName: string; text: string }>,
    config: AIConfig,
    keep: number = RERANK_KEEP,
): Promise<Array<{ chunkId: string; assetId: string; score: number }>> {
    if (candidates.length <= keep) return candidates;

    const model = chatModel(config);
    const url = normalizeOllamaGenerateUrl(config.apiUrl);

    const listBlock = candidates
        .map((c, i) => {
            const snippet = c.text.length > RERANK_SNIPPET ? c.text.slice(0, RERANK_SNIPPET) + '…' : c.text;
            return `[${i + 1}] (${c.fileName}) ${snippet}`;
        })
        .join('\n\n');

    const prompt = `/no_think
Görevin: Aşağıdaki soruyu cevaplamak için EN YARARLI ${keep} METİN PARÇASINI seç ve numaralarını alakadan çok-aza doğru sırala.

SORU: ${query}

PARÇALAR:
${listBlock}

Cevap BİÇİMİ (kesin uy):
- Sadece virgülle ayrılmış parça numaraları, tek satır.
- En fazla ${keep} numara.
- Açıklama, başlık, metin ekleme YOK.
Örnek: 3,1,7,2,${keep}

CEVAP:`;

    const reqBody = JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
            temperature: 0.1,
            num_ctx: 8192,
            num_predict: 80,
            repeat_penalty: 1.1,
        },
    });

    try {
        const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url, body: reqBody }, RERANK_TIMEOUT_MS);
        const data = JSON.parse(responseStr);
        let text = String(data.response || '').trim();
        // <think> temizliği
        text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        // İlk satırı al
        text = text.split(/\r?\n/)[0].trim();
        // Virgülle ayrılmış sayı dizisini bul (prose'daki stray sayıları atla)
        // "En iyi 3 sonuç: 1,5,2" → "1,5,2" yakalanır, "3" atlanır
        const csvPattern = text.match(/\d+(?:\s*,\s*\d+)+/);
        const numSource = csvPattern ? csvPattern[0] : text;
        const nums = numSource
            .split(/[,\s]+/)
            .map((s) => parseInt(s, 10))
            .filter((n) => !isNaN(n) && n >= 1 && n <= candidates.length);
        if (nums.length === 0) {
            debugLog('ragService', 'rerank parse failed, fallback to original order', { raw: text });
            return candidates.slice(0, keep);
        }
        // Uniq + keep sayısına cap
        const seen = new Set<number>();
        const ordered: number[] = [];
        for (const n of nums) {
            if (!seen.has(n)) { seen.add(n); ordered.push(n); }
            if (ordered.length >= keep) break;
        }
        const result = ordered.map((n) => candidates[n - 1]).filter(Boolean)
            .map((c) => ({ chunkId: c.chunkId, assetId: c.assetId, score: c.score }));
        // LLM eksik numara dönerse kalan slotları orijinal sırayla doldur
        if (result.length < keep) {
            const used = new Set(result.map((r) => r.chunkId));
            for (const c of candidates) {
                if (result.length >= keep) break;
                if (!used.has(c.chunkId)) {
                    result.push({ chunkId: c.chunkId, assetId: c.assetId, score: c.score });
                }
            }
        }
        return result;
    } catch (err) {
        debugLog('ragService', 'llmRerank failed, fallback to original', err);
        _lastQueryWarnings.push('reranker_failed');
        return candidates.slice(0, keep);
    }
}
