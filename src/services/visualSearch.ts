/**
 * Text → Image semantik arama (CLIP shared embedding space).
 *
 * Akış:
 *  1. Türkçe sorgu varsa Ollama ile İngilizceye çevrilir (CLIP English-only).
 *  2. CLIP text encoder ile 512-dim vektöre dönüştürülür.
 *  3. embeddings tablosundaki tüm image_global vektörlerine cosine similarity.
 *  4. Top-N asset döner.
 */

import { generateClipTextEmbedding, cosineSimilarity, loadClipTextModel } from './embeddings';
import { getEmbeddingsBySourcePrefix } from './database';
import { invokeWithTimeout } from '../utils/invokeWithTimeout';
import type { AIConfig } from '../components/AISettingsModal';
import { chatModel, normalizeOllamaGenerateUrl } from './ollamaService';
import { debugLog } from './logger';

export type VisualHit = {
    assetId: string;
    score: number;
};

const TURKISH_RE = /[çğıİöşüÇĞÖŞÜ]/;

/**
 * Türkçe sorguyu İngilizceye çevirir. Latin-only ise olduğu gibi döner.
 * Hata durumunda orijinali döner.
 */
export async function translateToEnglish(query: string, config: AIConfig): Promise<string> {
    const trimmed = query.trim();
    if (!trimmed) return trimmed;
    // Türkçe karakter veya yaygın TR kelimeleri yoksa muhtemelen zaten İngilizce
    if (!TURKISH_RE.test(trimmed) && !/\b(ve|ile|için|hangi|nedir|var|bir)\b/i.test(trimmed)) {
        return trimmed;
    }

    const model = chatModel(config);
    const url = normalizeOllamaGenerateUrl(config.apiUrl);
    const prompt = `/no_think
Görev: Aşağıdaki Türkçe görsel arama sorgusunu kısa ve doğal İngilizceye çevir. Sadece çeviriyi yaz, başka açıklama yok.

ÖRNEKLER:
TR: merdiven planı
EN: stair plan

TR: cephe çizimi
EN: facade drawing

TR: ${trimmed}
EN:`;

    const reqBody = JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.1, num_ctx: 1024, num_predict: 30 },
    });

    try {
        const responseStr = await invokeWithTimeout<string>('ollama_proxy', { url, body: reqBody }, 12_000);
        const data = JSON.parse(responseStr);
        let text = String(data.response || '').trim();
        text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
        text = text.split(/\r?\n/)[0].trim();
        text = text.replace(/^(EN|English|Translation)\s*[:\-]\s*/i, '').trim();
        text = text.replace(/^["'`]+|["'`.!?]+$/g, '');
        return text || trimmed;
    } catch (err) {
        debugLog('visualSearch', 'translateToEnglish failed', err);
        return trimmed;
    }
}

/**
 * Metin sorgusuyla görsel arama. Türkçe sorgu otomatik İngilizceye çevrilir.
 * Asset başına en iyi crop skoru kullanılır (5 crop arasından max).
 */
export async function searchImagesByText(
    query: string,
    config: AIConfig,
    limit: number = 30,
    options: { translate?: boolean; minScore?: number } = {},
): Promise<{ hits: VisualHit[]; effectiveQuery: string }> {
    const translate = options.translate ?? true;
    const minScore = options.minScore ?? 0.18; // CLIP cosine için empirical floor

    await loadClipTextModel();
    const effectiveQuery = translate ? await translateToEnglish(query, config) : query;
    if (!effectiveQuery.trim()) return { hits: [], effectiveQuery };

    const queryVec = await generateClipTextEmbedding(effectiveQuery);

    // Tüm CLIP image embeddings (5 crop × N asset)
    const all = getEmbeddingsBySourcePrefix('image_');
    if (all.length === 0) return { hits: [], effectiveQuery };

    // Asset başına en iyi crop skoru
    const bestPerAsset = new Map<string, number>();
    for (const row of all) {
        const score = cosineSimilarity(queryVec, row.vector);
        const cur = bestPerAsset.get(row.assetId) ?? -1;
        if (score > cur) bestPerAsset.set(row.assetId, score);
    }

    const hits: VisualHit[] = [...bestPerAsset.entries()]
        .filter(([, s]) => s >= minScore)
        .map(([assetId, score]) => ({ assetId, score }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

    return { hits, effectiveQuery };
}
