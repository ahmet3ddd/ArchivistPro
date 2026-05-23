import { describe, it, expect } from 'vitest';
import { cosineSimilarity, semanticSearch } from '../services/embeddings';

describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
        const v = [0.5, 0.5, 0.5, 0.5];
        expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
    });

    it('should return 0 for orthogonal vectors', () => {
        const a = [1, 0, 0];
        const b = [0, 1, 0];
        expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
    });

    it('should return -1 for opposite vectors', () => {
        const a = [1, 0];
        const b = [-1, 0];
        expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
    });

    it('should return 0 for zero vectors', () => {
        expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it('should return 0 for mismatched dimensions', () => {
        expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    });
});

describe('semanticSearch', () => {
    const assetVectors = [
        { assetId: 'a1', vector: [1, 0, 0] },
        { assetId: 'a2', vector: [0, 1, 0] },
        { assetId: 'a3', vector: [0.9, 0.1, 0] },
        { assetId: 'a4', vector: [0, 0, 1] },
    ];

    it('should return results sorted by score descending', () => {
        const query = [1, 0, 0];
        const results = semanticSearch(query, assetVectors, 4, 0.0);
        expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
        expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);
    });

    it('should filter results below threshold', () => {
        const query = [1, 0, 0];
        const results = semanticSearch(query, assetVectors, 10, 0.5);
        results.forEach(r => expect(r.score).toBeGreaterThanOrEqual(0.5));
    });

    it('should respect topK limit', () => {
        const query = [1, 0, 0];
        const results = semanticSearch(query, assetVectors, 2, 0.0);
        expect(results.length).toBeLessThanOrEqual(2);
    });

    it('should return empty array for empty input', () => {
        const results = semanticSearch([1, 0, 0], [], 10, 0.0);
        expect(results).toHaveLength(0);
    });

    it('should return best matching assetId', () => {
        const query = [1, 0, 0];
        const results = semanticSearch(query, assetVectors, 1, 0.0);
        expect(results[0].assetId).toBe('a1');
    });
});
