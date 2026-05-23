/**
 * cleanupLlmAnswer — LLM çıktısı temizleme fonksiyonu testleri.
 *
 * Fonksiyon ragService.ts'den export edilir. DB/Tauri bağımlılığı yok — pure.
 */
import { describe, it, expect, vi } from 'vitest';

// ragService import'u için gerekli mock'lar
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../services/database', () => ({
    ftsSearchChunks: vi.fn(() => new Map()),
    ftsSearchChunksAsync: vi.fn(async () => new Map()),
    getChunkStatsAsync: vi.fn(async () => ({ total: 0, metaTotal: 0, metaAssets: 0, contentAssets: 0 })),
    getChunksByIds: vi.fn(() => []),
    getChunksByIdsAsync: vi.fn(async () => []),
    getAllChunkEmbeddings: vi.fn(() => []),
    getAllAssets: vi.fn(() => []),
    queryAll: vi.fn(() => []),
    getChunkEmbeddingsByAssetIds: vi.fn(() => []),
    getChunkEmbeddingsByAssetIdsAsync: vi.fn(async () => []),
}));
vi.mock('../services/embeddings', () => ({
    generateEmbedding: vi.fn(() => Promise.resolve([])),
    loadEmbeddingModel: vi.fn(() => Promise.resolve()),
}));
vi.mock('../services/logger', () => ({
    debugLog: vi.fn(),
}));
vi.mock('../services/queryExpansion', () => ({
    expandQuery: vi.fn((q: string) => q),
}));
vi.mock('../utils/invokeWithTimeout', () => ({
    invokeWithTimeout: vi.fn(() => Promise.resolve('{}')),
}));
vi.mock('../utils/searchScoring', () => ({
    buildFullSearchableText: vi.fn(() => ''),
    computeKeywordScore: vi.fn(() => 0),
    computeHybridFinalScore: vi.fn(() => 0),
    semanticMatchThreshold: vi.fn(() => 0.5),
}));

import { cleanupLlmAnswer } from '../services/ragService';

describe('cleanupLlmAnswer', () => {
    /* ── Boş / doğrudan pass-through ── */

    it('boş string için boş string döner', () => {
        expect(cleanupLlmAnswer('')).toBe('');
    });

    it('sadece whitespace için boş string döner', () => {
        expect(cleanupLlmAnswer('   \n\t  ')).toBe('');
    });

    /* ── <think> bloğu temizleme ── */

    it('<think>...</think> bloğu kaldırılır', () => {
        const input = '<think>Bu benim düşünce sürecim.</think>\nMerdiven zemin katta.';
        expect(cleanupLlmAnswer(input)).not.toContain('<think>');
        expect(cleanupLlmAnswer(input)).toContain('Merdiven');
    });

    it('çoklu <think> bloğu kaldırılır', () => {
        const input = '<think>İlk düşünce.</think> Zemin katta duvar var. <think>İkinci düşünce.</think> Kolon sayısı 4.';
        const result = cleanupLlmAnswer(input);
        expect(result).not.toContain('<think>');
        expect(result).toContain('duvar');
    });

    /* ── İngilizce meta-yorum filtreleme ── */

    it('"Let me" ile başlayan cümle atılır', () => {
        const input = 'Let me analyze this. Merdiven dosyada mevcut.';
        expect(cleanupLlmAnswer(input)).not.toContain('Let me');
    });

    it('"The answer is" ile başlayan cümle atılır', () => {
        const input = 'The answer is clear. [1] plan.dwg: zemin kat merdiveni var.';
        const result = cleanupLlmAnswer(input);
        expect(result).not.toMatch(/^The answer/i);
    });

    it('"However," ile başlayan cümle atılır', () => {
        const input = 'However, the data shows something. Duvar kalınlığı 20 cm.';
        const result = cleanupLlmAnswer(input);
        expect(result).not.toContain('However');
        expect(result).toContain('Duvar');
    });

    it('"Actually," ile başlayan cümle atılır', () => {
        const input = 'Actually, looking at the data. Şartname dosyasında yalıtım bilgisi var.';
        const result = cleanupLlmAnswer(input);
        expect(result).not.toMatch(/^Actually/i);
    });

    it('"I need to" ile başlayan cümle atılır', () => {
        const input = 'I need to look at this carefully. Zemin kat planı dosyada mevcut.';
        const result = cleanupLlmAnswer(input);
        expect(result).not.toMatch(/^I need/i);
    });

    /* ── ASCII prefix + Türkçe içerik kurtarma ── */

    it('ASCII prefix:Türkçe → prefix kaldırılır, Türkçe korunur', () => {
        const input = 'Key finding: Merdiven zemin katta mevcut.';
        const result = cleanupLlmAnswer(input);
        expect(result).not.toContain('Key finding:');
        expect(result).toContain('Merdiven');
    });

    it('citation prefix [1] korunur', () => {
        const input = '[1] plan.dwg: merdiven zemin katta';
        const result = cleanupLlmAnswer(input);
        expect(result).toContain('[1]');
    });

    /* ── Türkçe içerik korunur ── */

    it('Türkçe diakritik karakter içeren cümle korunur', () => {
        const input = 'Merdiven zemin katta bulunmaktadır. Kolon sayısı 4\'tür.';
        const result = cleanupLlmAnswer(input);
        expect(result).toContain('Merdiven');
        expect(result).toContain('Kolon');
    });

    it('citation ile başlayan cümle Türkçe yoksa da korunur', () => {
        const input = '[1] plan.dwg (s.3)';
        expect(cleanupLlmAnswer(input)).toContain('[1]');
    });

    it('Türkçe dosya/proje kelimeleri korunur', () => {
        const words = ['dosya', 'proje', 'arşiv', 'yapı', 'katman', 'şartname'];
        words.forEach((word) => {
            const input = `${word} içeriğinde ilgili bilgi mevcut.`;
            expect(cleanupLlmAnswer(input)).toContain(word);
        });
    });

    /* ── Safety fallback ── */

    it('hiçbir cümle kalmadıysa raw döner (safety fallback)', () => {
        // Tamamen İngilizce meta — hepsi atılır, fallback devreye girer
        const input = 'Let me think about this. Actually, I need to analyze.';
        const result = cleanupLlmAnswer(input);
        // Fallback: raw string döner
        expect(result.length).toBeGreaterThan(0);
        expect(result).toBe(input.trim());
    });

    /* ── Mikst senaryo ── */

    it('karışık İngilizce meta + Türkçe cevap → sadece Türkçe kalır', () => {
        const input = `Let me analyze this document.
The answer to your question is as follows.
Merdiven zemin katta bulunmaktadır.
However, there are some caveats.
Kolon sayısı 8 adettir.`;
        const result = cleanupLlmAnswer(input);
        expect(result).not.toContain('Let me');
        expect(result).not.toContain('The answer');
        expect(result).not.toContain('However');
        expect(result).toContain('Merdiven');
        expect(result).toContain('Kolon');
    });

    it('sadece Türkçe cümle varsa değişmeden döner', () => {
        const input = 'Merdiven zemin katta mevcut. Kolon sayısı 4.';
        expect(cleanupLlmAnswer(input)).toBe(input);
    });

    /* ── Sızan prompt iskeleti (qwen3:8b regresyonu) ── */

    it('sızan prompt iskeleti ([KESIN KURAL]/KAYNAKLAR/no_think) çıkarılır', () => {
        const input = `/no_think
[KESIN KURAL] Cevabın TAMAMI TÜRKÇE olacak. İngilizce TEK KELIME bile yazma.
[KESIN KURAL] DİREKT cevap yaz. Önsöz, tekrar, açıklama YOK.
Mimari arşiv asistanısın. Aşağıdaki KAYNAKLAR'dan DİREKT, KISA, TÜRKÇE cevap ver.
KAYNAKLAR:
Şenay Gök, 3d dizayn yetki.docx belgesinde imza yetkilisi olarak geçer.`;
        const result = cleanupLlmAnswer(input);
        expect(result).not.toContain('[KESIN KURAL]');
        expect(result).not.toContain('/no_think');
        expect(result).not.toContain('KAYNAKLAR:');
        expect(result).not.toContain('Mimari arşiv asistanısın');
        expect(result).toContain('Şenay Gök');               // gerçek cevap korunur
    });

    it('model SADECE prompt kustuysa raw değil dürüst not döner', () => {
        const input = `/no_think
[KESIN KURAL] Cevabın TAMAMI TÜRKÇE olacak.
[KESIN KURAL] DİREKT cevap yaz.
KAYNAKLAR soruya uygun değilse: "Bu konuda arşivde bilgi bulamadım."
KAYNAKLAR:`;
        const result = cleanupLlmAnswer(input);
        expect(result).not.toContain('[KESIN KURAL]');
        expect(result).not.toContain('KAYNAKLAR');
        expect(result.length).toBeGreaterThan(0);             // boş/çöp değil
    });

    it('scaffold yokken davranış değişmez (mevcut safety fallback korunur)', () => {
        const input = 'Let me think about this. Actually, I need to analyze.';
        expect(cleanupLlmAnswer(input)).toBe(input.trim());   // eskisi gibi raw'a eş
    });
});
