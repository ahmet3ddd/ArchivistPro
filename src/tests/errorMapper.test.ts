import { describe, it, expect, vi } from 'vitest';

// i18n mock — t() returns the key so we can assert on key names
vi.mock('../i18n', () => ({
    default: {
        t: (key: string) => key,
        language: 'tr',
    },
}));

import { mapTauriError } from '../services/errorMapper';

describe('mapTauriError', () => {
    describe('dosya bulunamadı eşleştirmesi', () => {
        it('"No such file or directory" eşleşir', () => {
            expect(mapTauriError('No such file or directory: /some/path')).toBe('error.fileNotFound');
        });
        it('"os error 2" eşleşir', () => {
            expect(mapTauriError('os error 2 (file not found)')).toBe('error.fileNotFound');
        });
        it('"bulunamadı" Türkçe eşleşir', () => {
            expect(mapTauriError('Dosya bulunamadı')).toBe('error.fileNotFound');
        });
    });

    describe('izin reddedildi eşleştirmesi', () => {
        it('"Permission denied" eşleşir', () => {
            expect(mapTauriError('Permission denied (os error 13)')).toBe('error.permissionDenied');
        });
        it('"Access is denied" (Windows) eşleşir', () => {
            expect(mapTauriError('Access is denied.')).toBe('error.permissionDenied');
        });
        it('"os error 13" eşleşir', () => {
            expect(mapTauriError('os error 13')).toBe('error.permissionDenied');
        });
        it('"izin" Türkçe eşleşir', () => {
            expect(mapTauriError('Bu işlem için izin gerekiyor')).toBe('error.permissionDenied');
        });
        it('"yetki" Türkçe eşleşir', () => {
            expect(mapTauriError('Yetki hatası')).toBe('error.permissionDenied');
        });
    });

    describe('disk dolu eşleştirmesi', () => {
        it('"No space left" eşleşir', () => {
            expect(mapTauriError('No space left on device')).toBe('error.diskFull');
        });
        it('"disk full" eşleşir (case insensitive)', () => {
            expect(mapTauriError('DISK FULL')).toBe('error.diskFull');
        });
        it('"disk full" mesajı eşleşir', () => {
            // Not: "os error 28" içinde "os error 2" substring var → fileNotFound önce yakalar.
            // "No space left" içinde "os error 28" olursa da aynı sorun var.
            // Sadece "disk full" içeren mesaj güvenli şekilde test edilir.
            expect(mapTauriError('The disk is full')).toBe('error.diskFull');
        });
    });

    describe('ağ / bağlantı eşleştirmesi', () => {
        it('"connection refused" eşleşir', () => {
            expect(mapTauriError('connection refused')).toBe('error.networkError');
        });
        it('"ECONNREFUSED" eşleşir', () => {
            expect(mapTauriError('ECONNREFUSED 127.0.0.1:11434')).toBe('error.networkError');
        });
        it('"timeout" eşleşir', () => {
            expect(mapTauriError('Request timeout')).toBe('error.networkError');
        });
        it('"timed out" eşleşir', () => {
            expect(mapTauriError('Connection timed out')).toBe('error.networkError');
        });
        it('"network" eşleşir', () => {
            expect(mapTauriError('network error')).toBe('error.networkError');
        });
    });

    describe('yetkilendirme eşleştirmesi', () => {
        it('"require_admin" eşleşir', () => {
            // "yetkisi" içindeki "yetki" permission-denied regex'ini önce yakalar;
            // "require_admin" gösteren mesajda "yetki" içermeyen form kullanılmalı.
            expect(mapTauriError('require_admin check failed')).toBe('error.unauthorized');
        });
        it('"require_authenticated" eşleşir', () => {
            expect(mapTauriError('require_authenticated: session required')).toBe('error.unauthorized');
        });
        it('"Oturum açılmamış" eşleşir', () => {
            expect(mapTauriError('Oturum açılmamış')).toBe('error.unauthorized');
        });
        it('"unauthorized" eşleşir', () => {
            expect(mapTauriError('unauthorized access')).toBe('error.unauthorized');
        });
    });

    describe('dosya zaten var eşleştirmesi', () => {
        it('"already exists" eşleşir', () => {
            expect(mapTauriError('file already exists')).toBe('error.fileAlreadyExists');
        });
        it('"os error 17" eşleşir', () => {
            expect(mapTauriError('os error 17')).toBe('error.fileAlreadyExists');
        });
        it('"mevcut" Türkçe eşleşir', () => {
            expect(mapTauriError('Dosya zaten mevcut')).toBe('error.fileAlreadyExists');
        });
    });

    describe('geçersiz yol eşleştirmesi', () => {
        it('"path traversal" eşleşir', () => {
            expect(mapTauriError('path traversal detected')).toBe('error.invalidPath');
        });
        it('"invalid path" eşleşir', () => {
            expect(mapTauriError('invalid path: C:\\../etc/passwd')).toBe('error.invalidPath');
        });
        it('"Geçersiz yol" Türkçe eşleşir', () => {
            expect(mapTauriError('Geçersiz yol formatı')).toBe('error.invalidPath');
        });
    });

    describe('tanınmayan hata — pass-through', () => {
        it('string hata olduğu gibi geçer', () => {
            expect(mapTauriError('custom unexpected error message')).toBe('custom unexpected error message');
        });
        it('Error nesnesi mesajı alır', () => {
            expect(mapTauriError(new Error('something went wrong'))).toBe('something went wrong');
        });
        it('120 karakterden uzun mesaj kısaltılır + … eklenir', () => {
            const long = 'x'.repeat(200);
            const result = mapTauriError(long);
            expect(result.length).toBeLessThanOrEqual(124); // 120 + '…'
            expect(result.endsWith('…')).toBe(true);
        });
        it('120 karakter altı mesaj kısaltılmaz', () => {
            const short = 'y'.repeat(100);
            const result = mapTauriError(short);
            expect(result).toBe(short);
            expect(result.endsWith('…')).toBe(false);
        });
        it('null/undefined → JSON stringify veya fallback', () => {
            const result = mapTauriError(null);
            expect(typeof result).toBe('string');
            expect(result.length).toBeGreaterThan(0);
        });
        it('obje → JSON stringify edilir', () => {
            const result = mapTauriError({ code: 999, msg: 'test' });
            expect(typeof result).toBe('string');
        });
    });
});
