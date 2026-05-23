import { describe, it, expect } from 'vitest';

/**
 * Base64 <-> Float32Array dönüşüm yardımcıları
 * (database.ts içindeki private fonksiyonlarla aynı mantık)
 */
function vectorToBase64(vector: number[]): string {
    const f32 = new Float32Array(vector);
    const bytes = new Uint8Array(f32.buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function base64ToVector(encoded: string): number[] {
    if (encoded.startsWith('[')) {
        return JSON.parse(encoded) as number[];
    }
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return Array.from(new Float32Array(bytes.buffer));
}

describe('Vector binary encoding', () => {
    it('round-trips a simple vector', () => {
        const original = [0.1, 0.5, -0.3, 1.0, 0.0];
        const encoded = vectorToBase64(original);
        const decoded = base64ToVector(encoded);
        expect(decoded).toHaveLength(original.length);
        decoded.forEach((v, i) => expect(v).toBeCloseTo(original[i], 4));
    });

    it('round-trips a 384-dim vector', () => {
        const original = Array.from({ length: 384 }, (_, i) => Math.sin(i * 0.01));
        const encoded = vectorToBase64(original);
        const decoded = base64ToVector(encoded);
        expect(decoded).toHaveLength(384);
        decoded.forEach((v, i) => expect(v).toBeCloseTo(original[i], 4));
    });

    it('base64 output is more compact than JSON', () => {
        const vector = Array.from({ length: 384 }, () => Math.random());
        const jsonSize = JSON.stringify(vector).length;
        const b64Size = vectorToBase64(vector).length;
        expect(b64Size).toBeLessThan(jsonSize);
    });

    it('decodes legacy JSON format for backward compatibility', () => {
        const original = [0.25, 0.75, -0.5];
        const jsonEncoded = JSON.stringify(original);
        const decoded = base64ToVector(jsonEncoded);
        expect(decoded).toEqual(original);
    });
});
