/**
 * RAG Çoklu Dosya Sentezi (Faz 3) — unit testler
 *
 * Kapsam: buildSynthesisPrompt yapısal davranış + retrievePerAsset guard'lar.
 * Derinlemesine integration test (DB + embeddings) ayrı; bunlar pure/guard.
 */
import { describe, it, expect } from 'vitest';
import { buildSynthesisPrompt, retrievePerAsset } from '../services/ragService';

describe('buildSynthesisPrompt', () => {
    it('tek belge için belge başlığı + soru içerir', () => {
        const prompt = buildSynthesisPrompt(
            'Merdiven nerede?',
            [{
                assetId: 'a1',
                fileName: 'plan.dwg',
                chunks: [{ index: 1, page: null, text: 'Zemin katta merdiven var.' }],
            }],
        );
        expect(prompt).toContain('BELGE 1 — plan.dwg');
        expect(prompt).toContain('SORU: Merdiven nerede?');
        expect(prompt).toContain('Zemin katta merdiven var.');
    });

    it('çoklu belge için her belgeye ayrı bölüm üretir', () => {
        const prompt = buildSynthesisPrompt(
            'Katmanlar',
            [
                {
                    assetId: 'a1',
                    fileName: 'A.dwg',
                    chunks: [{ index: 1, page: null, text: 'MERDIVEN-1 katmanı' }],
                },
                {
                    assetId: 'a2',
                    fileName: 'B.dwg',
                    chunks: [{ index: 2, page: null, text: 'KOLON katmanı' }],
                },
            ],
        );
        expect(prompt).toContain('BELGE 1 — A.dwg');
        expect(prompt).toContain('BELGE 2 — B.dwg');
        expect(prompt).toContain('MERDIVEN-1');
        expect(prompt).toContain('KOLON');
    });

    it('chunk sayfa numarasını prompt\'a yazar', () => {
        const prompt = buildSynthesisPrompt(
            'Ne var?',
            [{
                assetId: 'a1',
                fileName: 'rapor.pdf',
                chunks: [{ index: 1, page: 42, text: 'Yangın maddesi' }],
            }],
        );
        expect(prompt).toContain('(s.42)');
    });

    it('çoklu chunk tek belgede sıralı gösterilir', () => {
        const prompt = buildSynthesisPrompt(
            'Kontrol',
            [{
                assetId: 'a1',
                fileName: 'x.pdf',
                chunks: [
                    { index: 1, page: null, text: 'birinci chunk' },
                    { index: 2, page: null, text: 'ikinci chunk' },
                ],
            }],
        );
        // chunk metinleri sıralı — benzersiz içerikle doğrula
        expect(prompt).toMatch(/birinci chunk[\s\S]*ikinci chunk/);
    });

    it('geçmiş konuşmayı ÖNCEKİ KONUŞMA bloğu ile ekler', () => {
        const prompt = buildSynthesisPrompt(
            'Devam',
            [{
                assetId: 'a1',
                fileName: 'x.pdf',
                chunks: [{ index: 1, page: null, text: 'metin' }],
            }],
            [
                { role: 'user', content: 'İlk soru' },
                { role: 'assistant', content: 'İlk cevap' },
            ],
        );
        // Bu header'lı blok sadece history varsa eklenir
        expect(prompt).toContain('ÖNCEKİ KONUŞMA (sadece sorunun bağlamını anlamak için)');
        expect(prompt).toContain('Kullanıcı: İlk soru');
        expect(prompt).toContain('Asistan: İlk cevap');
    });

    it('geçmişi son 4 mesajla sınırlar', () => {
        const longHistory = Array.from({ length: 10 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'assistant',
            content: `mesaj-${i}`,
        }));
        const prompt = buildSynthesisPrompt(
            'Test',
            [{ assetId: 'a1', fileName: 'x.pdf', chunks: [{ index: 1, page: null, text: 't' }] }],
            longHistory,
        );
        // Son 4 mesaj: 6,7,8,9
        expect(prompt).toContain('mesaj-9');
        expect(prompt).toContain('mesaj-6');
        // Eski mesajlar kesilmeli
        expect(prompt).not.toContain('mesaj-0');
        expect(prompt).not.toContain('mesaj-5');
    });

    it('uzun history mesajlarını 300 karakterle keser', () => {
        const longContent = 'X'.repeat(500);
        const prompt = buildSynthesisPrompt(
            'Test',
            [{ assetId: 'a1', fileName: 'x.pdf', chunks: [{ index: 1, page: null, text: 't' }] }],
            [{ role: 'user', content: longContent }],
        );
        // Ellipsis ile bitsin — ham 500 karakter promp'ta olmasın
        expect(prompt).not.toContain('X'.repeat(400));
        expect(prompt).toContain('…');
    });

    it('sentez direktifleri prompt\'ta bulunur', () => {
        const prompt = buildSynthesisPrompt(
            'test',
            [{ assetId: 'a1', fileName: 'x.pdf', chunks: [{ index: 1, page: null, text: 't' }] }],
        );
        // Kritik direktifler (prompt minimize + sertleşti)
        expect(prompt).toContain('[KESIN KURAL]');
        expect(prompt).toContain('TÜRKÇE');
        expect(prompt).toMatch(/\[N\]\s+dosya_adı/);
        expect(prompt).toContain('Seçili belgelerde bu konuda bilgi bulunamadı');
    });

    it('boş history geçildiğinde ÖNCEKİ KONUŞMA bloğu eklenmez', () => {
        const prompt = buildSynthesisPrompt(
            'test',
            [{ assetId: 'a1', fileName: 'x.pdf', chunks: [{ index: 1, page: null, text: 't' }] }],
        );
        // Kural #6 "ÖNCEKİ KONUŞMA" ifadesi promptta hep geçer; asıl bağlam bloğu farklı
        expect(prompt).not.toContain('ÖNCEKİ KONUŞMA (sadece sorunun bağlamını anlamak için)');
        expect(prompt).not.toContain('Kullanıcı:');
        expect(prompt).not.toContain('Asistan:');
    });
});

describe('retrievePerAsset — guard davranışları', () => {
    it('boş sorgu için boş dizi döner', async () => {
        const result = await retrievePerAsset('', ['a1', 'a2'], 3);
        expect(result).toEqual([]);
    });

    it('sadece whitespace sorgu için boş dizi döner', async () => {
        const result = await retrievePerAsset('   \n\t  ', ['a1'], 3);
        expect(result).toEqual([]);
    });

    it('boş asset listesi için boş dizi döner', async () => {
        const result = await retrievePerAsset('sorgu', [], 3);
        expect(result).toEqual([]);
    });
});
