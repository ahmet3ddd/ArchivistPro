/**
 * archiveShare — pure/exported fonksiyon testleri.
 * Tauri-bağımlı exportArchive/importArchive/peekArchive ayrı entegrasyon testinde.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock('../services/logger', () => ({ auditLog: vi.fn() }));
vi.mock('../appVersion', () => ({ APP_VERSION: '2.3.1' }));

import { suggestArchiveFileName, ARCHIVE_EXTENSION } from '../services/archiveShare';

describe('ARCHIVE_EXTENSION', () => {
    it('".archivistpro" uzantısıdır', () => {
        expect(ARCHIVE_EXTENSION).toBe('.archivistpro');
    });

    it('nokta ile başlar', () => {
        expect(ARCHIVE_EXTENSION.startsWith('.')).toBe(true);
    });
});

describe('suggestArchiveFileName', () => {
    it('arşiv adı + tarih + uzantı içerir', () => {
        const result = suggestArchiveFileName('mimarlik_ofisi');
        expect(result).toContain('mimarlik_ofisi');
        expect(result).toContain(ARCHIVE_EXTENSION);
        expect(result).toMatch(/\d{4}-\d{2}-\d{2}/); // YYYY-MM-DD tarih
    });

    it('arşiv adı verilmezse "arsiv" kullanır', () => {
        const result = suggestArchiveFileName();
        expect(result).toContain('arsiv');
        expect(result).toContain(ARCHIVE_EXTENSION);
    });

    it('boş string verilirse "arsiv" kullanır', () => {
        const result = suggestArchiveFileName('');
        expect(result).toContain('arsiv');
    });

    it('tarih formatı YYYY-MM-DD doğru', () => {
        const result = suggestArchiveFileName('test');
        const dateMatch = result.match(/(\d{4}-\d{2}-\d{2})/);
        expect(dateMatch).not.toBeNull();
        const date = new Date(dateMatch![1]);
        expect(date.getTime()).not.toBeNaN();
    });

    it('sonuç .archivistpro ile biter', () => {
        const result = suggestArchiveFileName('proje');
        expect(result.endsWith(ARCHIVE_EXTENSION)).toBe(true);
    });

    it('özel karakterler içeren isimde de çalışır', () => {
        const result = suggestArchiveFileName('ofis-2026_v2');
        expect(result).toContain('ofis-2026_v2');
        expect(result.endsWith(ARCHIVE_EXTENSION)).toBe(true);
    });

    it('format: {name}_{date}.archivistpro', () => {
        const result = suggestArchiveFileName('test');
        expect(result).toMatch(/^test_\d{4}-\d{2}-\d{2}\.archivistpro$/);
    });
});
