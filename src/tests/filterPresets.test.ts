import { describe, it, expect, beforeEach } from 'vitest';
import {
    getAllPresets,
    savePreset,
    deletePreset,
    _resetPresetsForTest,
} from '../services/filterPresets';
import type { ExtractFilter } from '../services/archiveOps';

const SAMPLE_FILTER: ExtractFilter = {
    fileTypes: ['DWG', 'PDF'],
    projectName: 'Test Projesi',
    tags: [],
    dateFrom: null,
    dateTo: null,
    minFileSize: null,
    maxFileSize: null,
};

describe('filterPresets', () => {
    beforeEach(() => {
        _resetPresetsForTest();
    });

    /* ── getAllPresets ── */

    it('başlangıçta boş liste döner', () => {
        expect(getAllPresets()).toEqual([]);
    });

    it('bozuk JSON güvenli — boş liste döner', () => {
        localStorage.setItem('archivist_extract_filter_presets', '{not-an-array}');
        expect(getAllPresets()).toEqual([]);
    });

    it('geçersiz yapı filtreler — array değilse boş döner', () => {
        localStorage.setItem('archivist_extract_filter_presets', '{"foo": "bar"}');
        expect(getAllPresets()).toEqual([]);
    });

    /* ── savePreset ── */

    it('geçerli preset kaydedilir ve geri döner', () => {
        const result = savePreset('Test Preset', SAMPLE_FILTER);
        expect(result).not.toBeNull();
        expect(result!.name).toBe('Test Preset');
        expect(result!.filter).toEqual(SAMPLE_FILTER);
        expect(typeof result!.id).toBe('string');
        expect(result!.id.length).toBeGreaterThan(0);
    });

    it('boş isim kaydedilmez — null döner', () => {
        expect(savePreset('', SAMPLE_FILTER)).toBeNull();
        expect(savePreset('   ', SAMPLE_FILTER)).toBeNull();
    });

    it('isim trim edilir', () => {
        const result = savePreset('  Trimmed  ', SAMPLE_FILTER);
        expect(result!.name).toBe('Trimmed');
    });

    it('kayıt sonrası getAllPresets listede gösterir', () => {
        savePreset('Preset A', SAMPLE_FILTER);
        const list = getAllPresets();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('Preset A');
    });

    it('aynı isimde kayıt üzerine yazar (aynı id, aynı createdAt)', () => {
        const first = savePreset('Duplicate', SAMPLE_FILTER)!;
        const updatedFilter: ExtractFilter = { ...SAMPLE_FILTER, projectName: 'Yeni Proje' };
        const second = savePreset('Duplicate', updatedFilter)!;

        expect(second.id).toBe(first.id);
        expect(second.createdAt).toBe(first.createdAt);
        expect(second.filter.projectName).toBe('Yeni Proje');

        const list = getAllPresets();
        expect(list).toHaveLength(1); // Sadece 1 kayıt olmalı
    });

    it('farklı isimde birden fazla preset kaydedilebilir', () => {
        savePreset('A', SAMPLE_FILTER);
        savePreset('B', SAMPLE_FILTER);
        savePreset('C', SAMPLE_FILTER);
        expect(getAllPresets()).toHaveLength(3);
    });

    it('isim karşılaştırması case-insensitive', () => {
        const first = savePreset('BÜYÜK', SAMPLE_FILTER)!;
        const second = savePreset('büyük', SAMPLE_FILTER)!;
        expect(second.id).toBe(first.id);
        expect(getAllPresets()).toHaveLength(1);
    });

    /* ── deletePreset ── */

    it('mevcut preset silinir — true döner', () => {
        const p = savePreset('Silinecek', SAMPLE_FILTER)!;
        expect(deletePreset(p.id)).toBe(true);
        expect(getAllPresets()).toHaveLength(0);
    });

    it('bulunmayan id için false döner', () => {
        expect(deletePreset('non-existent-id')).toBe(false);
    });

    it('silinme sonrası diğer presetler korunur', () => {
        const a = savePreset('A', SAMPLE_FILTER)!;
        savePreset('B', SAMPLE_FILTER);
        deletePreset(a.id);
        const list = getAllPresets();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('B');
    });

    /* ── _resetPresetsForTest ── */

    it('reset sonrası liste boşalır', () => {
        savePreset('X', SAMPLE_FILTER);
        _resetPresetsForTest();
        expect(getAllPresets()).toHaveLength(0);
    });
});
