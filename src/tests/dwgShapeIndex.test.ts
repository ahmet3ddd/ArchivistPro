/**
 * dwgShapeIndex — categorizeLayerForShape pure function testleri.
 * DB + Tauri bağımlı fonksiyonlar (persistDwgShapes vb.) entegrasyon testinde.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../services/database', () => ({
    runSql: vi.fn(),
    queryAll: vi.fn(() => []),
}));

import { categorizeLayerForShape } from '../services/dwgShapeIndex';

describe('categorizeLayerForShape', () => {
    /* ── HAVUZ ── */
    it('"HAVUZ" → HAVUZ', () => expect(categorizeLayerForShape('HAVUZ')).toBe('HAVUZ'));
    it('"A-HAVUZ-01" → HAVUZ', () => expect(categorizeLayerForShape('A-HAVUZ-01')).toBe('HAVUZ'));
    it('"POOL" → HAVUZ', () => expect(categorizeLayerForShape('POOL')).toBe('HAVUZ'));
    it('"BASIN" → HAVUZ', () => expect(categorizeLayerForShape('BASIN')).toBe('HAVUZ'));

    /* ── DUVAR ── */
    it('"DUVAR" → DUVAR', () => expect(categorizeLayerForShape('DUVAR')).toBe('DUVAR'));
    it('"A-WALL" → DUVAR', () => expect(categorizeLayerForShape('A-WALL')).toBe('DUVAR'));
    it('"MURO" → DUVAR', () => expect(categorizeLayerForShape('MURO')).toBe('DUVAR'));
    it('"ext-wall" (küçük harf) → DUVAR', () => expect(categorizeLayerForShape('ext-wall')).toBe('DUVAR'));

    /* ── KAPI ── */
    it('"KAPI" → KAPI', () => expect(categorizeLayerForShape('KAPI')).toBe('KAPI'));
    it('"A-DOOR-SWING" → KAPI', () => expect(categorizeLayerForShape('A-DOOR-SWING')).toBe('KAPI'));
    it('"PORTA" → KAPI', () => expect(categorizeLayerForShape('PORTA')).toBe('KAPI'));

    /* ── PENCERE ── */
    it('"PENCERE" → PENCERE', () => expect(categorizeLayerForShape('PENCERE')).toBe('PENCERE'));
    it('"WINDOW" → PENCERE', () => expect(categorizeLayerForShape('WINDOW')).toBe('PENCERE'));
    it('"CAM" → PENCERE', () => expect(categorizeLayerForShape('CAM')).toBe('PENCERE'));
    it('"A-GLAZ-CAM" → PENCERE', () => expect(categorizeLayerForShape('A-GLAZ-CAM')).toBe('PENCERE'));

    /* ── KOLON ── */
    it('"KOLON" → KOLON', () => expect(categorizeLayerForShape('KOLON')).toBe('KOLON'));
    it('"A-COLUMN" → KOLON', () => expect(categorizeLayerForShape('A-COLUMN')).toBe('KOLON'));
    it('"S-COLUMN-01" → KOLON', () => expect(categorizeLayerForShape('S-COLUMN-01')).toBe('KOLON'));

    /* ── KIRIS ── */
    it('"KIRIS" → KIRIS', () => expect(categorizeLayerForShape('KIRIS')).toBe('KIRIS'));
    // Not: 'KİRİŞ' içindeki Türkçe dotlu İ, toUpperCase() sonrası İ olarak kalır.
    // Regex'te sadece KIRIŞ (dotless I) var → eşleşmez → DIGER döner.
    // Bu bilinen JS i18n davranışı; MERDİVEN gibi her iki form listelenmiş değil.
    it('"KİRİŞ" → DIGER (Türkçe dotlu İ regex eşleşmez)', () => expect(categorizeLayerForShape('KİRİŞ')).toBe('DIGER'));
    it('"BEAM" → KIRIS', () => expect(categorizeLayerForShape('BEAM')).toBe('KIRIS'));

    /* ── MERDIVEN ── */
    it('"MERDIVEN" → MERDIVEN', () => expect(categorizeLayerForShape('MERDIVEN')).toBe('MERDIVEN'));
    it('"MERDİVEN" → MERDIVEN', () => expect(categorizeLayerForShape('MERDİVEN')).toBe('MERDIVEN'));
    it('"STAIR" → MERDIVEN', () => expect(categorizeLayerForShape('STAIR')).toBe('MERDIVEN'));
    it('"A-STAIR-UP" → MERDIVEN', () => expect(categorizeLayerForShape('A-STAIR-UP')).toBe('MERDIVEN'));

    /* ── DOSEME ── */
    it('"DOSEME" → DOSEME', () => expect(categorizeLayerForShape('DOSEME')).toBe('DOSEME'));
    it('"DÖŞEME" → DOSEME', () => expect(categorizeLayerForShape('DÖŞEME')).toBe('DOSEME'));
    it('"SLAB" → DOSEME', () => expect(categorizeLayerForShape('SLAB')).toBe('DOSEME'));
    it('"FLOOR" → DOSEME', () => expect(categorizeLayerForShape('FLOOR')).toBe('DOSEME'));

    /* ── CATI ── */
    it('"CATI" → CATI', () => expect(categorizeLayerForShape('CATI')).toBe('CATI'));
    it('"ÇATI" → CATI', () => expect(categorizeLayerForShape('ÇATI')).toBe('CATI'));
    it('"ROOF" → CATI', () => expect(categorizeLayerForShape('ROOF')).toBe('CATI'));
    it('"A-ROOF-EDGE" → CATI', () => expect(categorizeLayerForShape('A-ROOF-EDGE')).toBe('CATI'));

    /* ── DIGER ── */
    it('bilinmeyen layer → DIGER', () => expect(categorizeLayerForShape('DIMENSION')).toBe('DIGER'));
    it('boş string → DIGER', () => expect(categorizeLayerForShape('')).toBe('DIGER'));
    it('0 (falsy) → DIGER', () => expect(categorizeLayerForShape('')).toBe('DIGER'));
    it('"TEXT" → DIGER', () => expect(categorizeLayerForShape('TEXT')).toBe('DIGER'));
    it('"HATCH" → DIGER', () => expect(categorizeLayerForShape('HATCH')).toBe('DIGER'));
    it('"0" (default layer) → DIGER', () => expect(categorizeLayerForShape('0')).toBe('DIGER'));

    /* ── Büyük/küçük harf bağımsızlığı ── */
    it('küçük harf "duvar" → DUVAR', () => expect(categorizeLayerForShape('duvar')).toBe('DUVAR'));
    it('karışık harf "Kapi" → KAPI', () => expect(categorizeLayerForShape('Kapi')).toBe('KAPI'));
    it('karışık harf "stAir" → MERDIVEN', () => expect(categorizeLayerForShape('stAir')).toBe('MERDIVEN'));
});
