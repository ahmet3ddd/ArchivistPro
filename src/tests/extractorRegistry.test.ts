import { describe, it, expect } from 'vitest';
import {
    getExtractorsForFileType,
    computeCompositeVersion,
    getMissingExtractors,
    buildAppliedRecord,
    buildBaselineRecord,
    computeAllVersions,
    type ExtractorDef,
} from '../services/extractorRegistry';

describe('extractorRegistry', () => {
    describe('getExtractorsForFileType', () => {
        it('DWG için en az 1 çıkarıcı döndürür', () => {
            const extractors = getExtractorsForFileType('DWG');
            expect(extractors.length).toBeGreaterThanOrEqual(1);
        });

        it('DWG çıkarıcıları dwg:binary_meta içerir', () => {
            const extractors = getExtractorsForFileType('DWG');
            expect(extractors.some(e => e.name === 'dwg:binary_meta')).toBe(true);
        });

        it('MAX için çıkarıcı döndürür', () => {
            const extractors = getExtractorsForFileType('MAX');
            expect(extractors.length).toBeGreaterThanOrEqual(1);
            expect(extractors[0].name).toBe('max:rich');
        });

        it('bilinmeyen dosya tipi için boş dizi döndürür', () => {
            const extractors = getExtractorsForFileType('UNKNOWN_FORMAT');
            expect(extractors).toEqual([]);
        });

        it('her çıkarıcıda name, version ve producedFields var', () => {
            const all = getExtractorsForFileType('DWG');
            for (const ext of all) {
                expect(ext.name).toBeTruthy();
                expect(ext.version).toBeGreaterThanOrEqual(1);
                expect(ext.producedFields.length).toBeGreaterThan(0);
            }
        });

        it('PDF çıkarıcı var', () => {
            expect(getExtractorsForFileType('PDF').length).toBeGreaterThanOrEqual(1);
        });

        it('RVT çıkarıcı var', () => {
            expect(getExtractorsForFileType('RVT').length).toBeGreaterThanOrEqual(1);
        });

        it('Image formatları için çıkarıcı var', () => {
            expect(getExtractorsForFileType('JPEG').length).toBeGreaterThanOrEqual(1);
            expect(getExtractorsForFileType('PNG').length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('computeCompositeVersion', () => {
        it('DWG için pozitif versiyon döndürür', () => {
            const version = computeCompositeVersion('DWG');
            expect(version).toBeGreaterThan(0);
        });

        it('bilinmeyen tip için 1 döndürür', () => {
            expect(computeCompositeVersion('UNKNOWN')).toBe(1);
        });

        it('birden fazla çıkarıcısı olan tip için toplam > 1', () => {
            const dwg = getExtractorsForFileType('DWG');
            if (dwg.length > 1) {
                expect(computeCompositeVersion('DWG')).toBeGreaterThan(1);
            }
        });

        it('versiyon toplamı çıkarıcı sayısı × 1 eşittir (hepsi v1)', () => {
            const extractors = getExtractorsForFileType('DWG');
            expect(computeCompositeVersion('DWG')).toBe(extractors.length);
        });
    });

    describe('getMissingExtractors', () => {
        it('applied=undefined → tüm çıkarıcılar eksik', () => {
            const missing = getMissingExtractors('DWG', undefined);
            const all = getExtractorsForFileType('DWG');
            expect(missing.length).toBe(all.length);
        });

        it('tümü uygulanmış → boş dizi', () => {
            const applied = buildAppliedRecord('DWG');
            const missing = getMissingExtractors('DWG', applied);
            expect(missing.length).toBe(0);
        });

        it('kısmen uygulanmış → sadece eksikler döner', () => {
            const all = getExtractorsForFileType('DWG');
            if (all.length > 1) {
                const partial: Record<string, number> = {};
                partial[all[0].name] = all[0].version;
                const missing = getMissingExtractors('DWG', partial);
                expect(missing.length).toBe(all.length - 1);
            }
        });

        it('eski versiyonlu çıkarıcı eksik sayılır', () => {
            const all = getExtractorsForFileType('DWG');
            if (all.length > 0) {
                const oldApplied: Record<string, number> = {};
                oldApplied[all[0].name] = 0; // v0 < v1
                const missing = getMissingExtractors('DWG', oldApplied);
                expect(missing.some(e => e.name === all[0].name)).toBe(true);
            }
        });

        it('bilinmeyen tip → boş dizi', () => {
            expect(getMissingExtractors('UNKNOWN', undefined).length).toBe(0);
        });
    });

    describe('buildAppliedRecord', () => {
        it('DWG için tüm çıkarıcıları kaydeder', () => {
            const record = buildAppliedRecord('DWG');
            const all = getExtractorsForFileType('DWG');
            expect(Object.keys(record).length).toBe(all.length);
            for (const ext of all) {
                expect(record[ext.name]).toBe(ext.version);
            }
        });

        it('bilinmeyen tip → boş obje', () => {
            expect(Object.keys(buildAppliedRecord('UNKNOWN')).length).toBe(0);
        });
    });

    describe('buildBaselineRecord', () => {
        it('DWG için kayıt döndürür', () => {
            const baseline = buildBaselineRecord('DWG');
            expect(baseline).not.toBeNull();
            expect(Object.keys(baseline!).length).toBeGreaterThan(0);
        });

        it('bilinmeyen tip → null', () => {
            expect(buildBaselineRecord('UNKNOWN')).toBeNull();
        });
    });

    describe('computeAllVersions', () => {
        it('DWG, MAX, SKP, RVT, IFC, PDF anahtarlarını içerir', () => {
            const all = computeAllVersions();
            expect(all['DWG']).toBeGreaterThan(0);
            expect(all['MAX']).toBeGreaterThan(0);
            expect(all['SKP']).toBeGreaterThan(0);
            expect(all['RVT']).toBeGreaterThan(0);
            expect(all['IFC']).toBeGreaterThan(0);
            expect(all['PDF']).toBeGreaterThan(0);
        });

        it('tüm değerler pozitif', () => {
            const all = computeAllVersions();
            for (const val of Object.values(all)) {
                expect(val).toBeGreaterThan(0);
            }
        });
    });

    describe('otomatik versiyon artışı', () => {
        it('DWG compositeVersion = çıkarıcı sayısı (hepsi v1 iken)', () => {
            const extractors = getExtractorsForFileType('DWG');
            const version = computeCompositeVersion('DWG');
            expect(version).toBe(extractors.reduce((s, e) => s + e.version, 0));
        });
    });
});
