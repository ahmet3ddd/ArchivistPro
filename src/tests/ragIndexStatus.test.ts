/**
 * ragIndexStatus — sabit ve pure logic testleri.
 *
 * DB bağımlı (analyzeRagIndex, purgeNonIndexableChunks, bulkIndexMetadataAll)
 * entegrasyon testleri burada değil. Sadece saf/pure mantık test edilir.
 */
import { describe, it, expect } from 'vitest';
import { RAG_INDEXABLE_TYPES } from '../services/ragIndexStatus';

describe('RAG_INDEXABLE_TYPES', () => {
    it('dizi olarak tanımlanmış', () => {
        expect(Array.isArray(RAG_INDEXABLE_TYPES)).toBe(true);
    });

    it('PDF dahil', () => {
        expect(RAG_INDEXABLE_TYPES).toContain('PDF');
    });

    it('DOC ve DOCX dahil', () => {
        expect(RAG_INDEXABLE_TYPES).toContain('DOC');
        expect(RAG_INDEXABLE_TYPES).toContain('DOCX');
    });

    it('XLS ve XLSX dahil', () => {
        expect(RAG_INDEXABLE_TYPES).toContain('XLS');
        expect(RAG_INDEXABLE_TYPES).toContain('XLSX');
    });

    it('PPT ve PPTX dahil', () => {
        expect(RAG_INDEXABLE_TYPES).toContain('PPT');
        expect(RAG_INDEXABLE_TYPES).toContain('PPTX');
    });

    it('TXT dahil', () => {
        expect(RAG_INDEXABLE_TYPES).toContain('TXT');
    });

    it('CSV dahil', () => {
        expect(RAG_INDEXABLE_TYPES).toContain('CSV');
    });

    it('RTF dahil', () => {
        expect(RAG_INDEXABLE_TYPES).toContain('RTF');
    });

    it('MD (Markdown) dahil', () => {
        expect(RAG_INDEXABLE_TYPES).toContain('MD');
    });

    it('DWG dahil değil (binary, metin çıkarımı yok)', () => {
        expect(RAG_INDEXABLE_TYPES).not.toContain('DWG');
    });

    it('MAX dahil değil', () => {
        expect(RAG_INDEXABLE_TYPES).not.toContain('MAX');
    });

    it('JPG dahil değil', () => {
        expect(RAG_INDEXABLE_TYPES).not.toContain('JPG');
    });

    it('BAK dahil değil', () => {
        expect(RAG_INDEXABLE_TYPES).not.toContain('BAK');
    });

    it('tüm tipler büyük harf', () => {
        RAG_INDEXABLE_TYPES.forEach((t) => {
            expect(t).toBe(t.toUpperCase());
        });
    });

    it('boş string içermiyor', () => {
        RAG_INDEXABLE_TYPES.forEach((t) => {
            expect(t.length).toBeGreaterThan(0);
        });
    });

    it('yineleme yok', () => {
        const unique = new Set(RAG_INDEXABLE_TYPES);
        expect(unique.size).toBe(RAG_INDEXABLE_TYPES.length);
    });
});
