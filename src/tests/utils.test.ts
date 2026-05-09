import { describe, it, expect } from 'vitest';
import { formatFileSize, formatDate, getCategoryIcon } from '../data';

describe('Utility Functions', () => {
    describe('formatFileSize', () => {
        it('should format bytes correctly', () => {
            expect(formatFileSize(500)).toBe('500 B');
            expect(formatFileSize(1024)).toBe('1.0 KB');
            expect(formatFileSize(1048576)).toBe('1.0 MB');
            expect(formatFileSize(1073741824)).toBe('1.00 GB');
        });
    });

    describe('formatDate', () => {
        it('should format ISO dates correctly', () => {
            // Adjusting for local Turkish locale if necessary, but testing general structure
            const date = '2025-10-20T09:00:00';
            const formatted = formatDate(date);
            expect(formatted).toContain('2025');
        });
    });

    describe('getCategoryIcon', () => {
        it('should return correct icons for categories', () => {
            expect(getCategoryIcon('2D Çizim')).toBe('📐');
            expect(getCategoryIcon('3D Model')).toBe('🧊');
            expect(getCategoryIcon('Unknown')).toBe('📁');
        });
    });
});
