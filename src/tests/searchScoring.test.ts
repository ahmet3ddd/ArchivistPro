import { describe, it, expect, vi } from 'vitest';
import {
  isVisualVectorQueryString,
  buildFullSearchableText,
  computeKeywordScore,
  visualSearchThreshold,
  semanticMatchThreshold,
  computeHybridFinalScore,
  filterAssetsHybrid,
  collectMatchSources,
  buildSearchScoreMap,
} from '../utils/searchScoring';
import type { Asset } from '../types';

// queryExpansion mock — findMatchSources ve expandQuery'yi stub'la
vi.mock('../services/queryExpansion', () => ({
  expandQuery: (q: string) => q,
  findMatchSources: vi.fn(() => [{ type: 'keyword', word: 'test', field: 'fileName' }]),
}));

const minimalAsset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  fileName: 'test.dwg',
  filePath: '/x/test.dwg',
  fileSize: 100,
  fileType: 'DWG',
  category: '2D Çizim',
  createdAt: '',
  modifiedAt: '',
  projectName: 'ProjA',
  projectPhase: 'Konsept',
  aiTags: [],
  colorPalette: [],
  metadata: {},
  isIndexed: true,
  ...overrides,
});

describe('searchScoring', () => {
  it('isVisualVectorQueryString detects CLIP result prefixes', () => {
    expect(isVisualVectorQueryString('🔍 Görsel Sonuçlar (CLIP + pHash)')).toBe(true);
    expect(isVisualVectorQueryString('🔍 Görsel Vektör Sonuçları (CLIP)')).toBe(true);
    expect(isVisualVectorQueryString('normal arama')).toBe(false);
  });

  it('buildFullSearchableText joins fields in lowercase', () => {
    const a = minimalAsset({
      fileName: 'Foo.dwg',
      projectName: 'Bar',
      aiTags: [{ label: 'Tag1', confidence: 1, source: 'nlp' }],
      metadata: { layers: ['L1'], dwgKeywords: ['kw'] },
    });
    const t = buildFullSearchableText(a);
    expect(t).toContain('foo.dwg');
    expect(t).toContain('bar');
    expect(t).toContain('tag1');
    expect(t).toContain('l1');
    expect(t).toContain('kw');
  });

  it('computeKeywordScore returns 0 for empty query words', () => {
    expect(computeKeywordScore('hello world', 'a')).toBe(0);
  });

  it('computeKeywordScore matches substring', () => {
    const s = computeKeywordScore('merdiven hol antre', 'merdiven hol');
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('threshold helpers scale with sensitivity', () => {
    expect(visualSearchThreshold(0)).toBeCloseTo(0.35);
    expect(visualSearchThreshold(100)).toBeCloseTo(0.85);
    expect(semanticMatchThreshold(0)).toBeCloseTo(0.15);
    expect(semanticMatchThreshold(100)).toBeCloseTo(0.45);
  });

  it('computeHybridFinalScore combines kw and sem', () => {
    const t = semanticMatchThreshold(50);
    const score = computeHybridFinalScore(0.5, 0.4, t);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('computeHybridFinalScore threshold=1.0 NaN koruması', () => {
    const score = computeHybridFinalScore(0.5, 0.8, 1.0);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('computeHybridFinalScore threshold=0.999 sınır', () => {
    const score = computeHybridFinalScore(0.3, 0.999, 0.999);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('computeHybridFinalScore her iki skor sıfırken 0 döner', () => {
    const score = computeHybridFinalScore(0, 0, 0.3);
    expect(score).toBe(0);
  });

  it('computeHybridFinalScore sadece kw skoruyla çalışır', () => {
    const score = computeHybridFinalScore(0.8, 0, 0.3);
    expect(score).toBeCloseTo(0.8, 1);
  });

  it('collectMatchSources boş sorgu için boş dizi döner', () => {
    const a = minimalAsset();
    expect(collectMatchSources(a, '', false)).toEqual([]);
  });

  it('collectMatchSources null asset için boş dizi döner', () => {
    expect(collectMatchSources(null, 'test', false)).toEqual([]);
  });

  it('collectMatchSources isImageSearching true iken boş dizi döner', () => {
    const a = minimalAsset();
    expect(collectMatchSources(a, 'test', true)).toEqual([]);
  });

  it('collectMatchSources geçerli girişlerde kaynak döner', () => {
    const a = minimalAsset({ fileName: 'test.dwg' });
    const sources = collectMatchSources(a, 'test', false);
    expect(Array.isArray(sources)).toBe(true);
  });

  it('filterAssetsHybrid applies facet filters', () => {
    const a = minimalAsset({ id: '1', category: '2D Çizim' });
    const b = minimalAsset({ id: '2', category: 'Render' });
    const out = filterAssetsHybrid({
      allAssets: [a, b],
      activeFilters: { category: ['Render'] },
      searchQuery: '',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 70,
      isVisualVectorQuery: false,
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('2');
  });

  it('filterAssetsHybrid visual vector query ile filtreler', () => {
    const a = minimalAsset({ id: '1' });
    const b = minimalAsset({ id: '2' });
    const out = filterAssetsHybrid({
      allAssets: [a, b],
      activeFilters: {},
      searchQuery: '🔍 Görsel Vektör Sonuçları (CLIP)',
      semanticResults: [{ assetId: '1', score: 0.9 }],
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1');
  });

  it('filterAssetsHybrid isImageSearching true iken sıralamaz', () => {
    const a = minimalAsset({ id: '1' });
    const out = filterAssetsHybrid({
      allAssets: [a],
      activeFilters: {},
      searchQuery: 'test',
      semanticResults: null,
      isImageSearching: true,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
    });
    expect(out).toHaveLength(1);
  });

  it('filterAssetsHybrid boş sorgu tüm varlıkları döndürür', () => {
    const a = minimalAsset({ id: '1' });
    const b = minimalAsset({ id: '2' });
    const out = filterAssetsHybrid({
      allAssets: [a, b],
      activeFilters: {},
      searchQuery: '',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
    });
    expect(out).toHaveLength(2);
  });

  it('filterAssetsHybrid text sorgu ile keyword skoru hesaplar', () => {
    const a = minimalAsset({ id: '1', fileName: 'merdiven.dwg', projectName: 'Proje' });
    const b = minimalAsset({ id: '2', fileName: 'baska.dwg', projectName: 'Proje' });
    const out = filterAssetsHybrid({
      allAssets: [a, b],
      activeFilters: {},
      searchQuery: 'merdiven',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
    });
    // merdiven içeren dosya eşleşmeli
    expect(out.some(x => x.id === '1')).toBe(true);
  });

  it('filterAssetsHybrid slider=90 iken düşük skorlu keyword eşleşmesi gizlenir', () => {
    // "proje tasarım sunum" sorgusunda sadece "proje" kelimesi eşleşir →
    // kwScore ≈ 0.53 (1/3 match + exactBonus) → finalScore < 0.90 → görünmemeli
    const a = minimalAsset({ id: '1', fileName: 'proje.dwg', projectName: 'Test' });
    const out90 = filterAssetsHybrid({
      allAssets: [a],
      activeFilters: {},
      searchQuery: 'proje tasarım sunum',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 90,
      isVisualVectorQuery: false,
    });
    expect(out90).toHaveLength(0);
  });

  it('filterAssetsHybrid slider=0 iken zayıf keyword eşleşmesi dahil edilir', () => {
    const a = minimalAsset({ id: '1', fileName: 'proje.dwg', projectName: 'Test' });
    const out0 = filterAssetsHybrid({
      allAssets: [a],
      activeFilters: {},
      searchQuery: 'proje tasarım sunum',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 0,
      isVisualVectorQuery: false,
    });
    expect(out0.some(x => x.id === '1')).toBe(true);
  });

  it('filterAssetsHybrid slider=90 iken tam keyword eşleşmesi hâlâ görünür', () => {
    // Tek kelime, tam eşleşme → kwScore ≈ 1.0 → finalScore ≈ 1.0 → 90 eşiğini geçer
    const a = minimalAsset({ id: '1', fileName: 'merdiven.dwg', projectName: 'Test' });
    const out = filterAssetsHybrid({
      allAssets: [a],
      activeFilters: {},
      searchQuery: 'merdiven',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 90,
      isVisualVectorQuery: false,
    });
    expect(out.some(x => x.id === '1')).toBe(true);
  });

  it('buildSearchScoreMap boş sorgu undefined döner', () => {
    const a = minimalAsset({ id: '1' });
    const result = buildSearchScoreMap({
      filteredAssets: [a],
      searchQuery: '',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
    });
    expect(result).toBeUndefined();
  });

  it('buildSearchScoreMap isImageSearching true iken undefined döner', () => {
    const a = minimalAsset({ id: '1' });
    const result = buildSearchScoreMap({
      filteredAssets: [a],
      searchQuery: 'test',
      semanticResults: null,
      isImageSearching: true,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
    });
    expect(result).toBeUndefined();
  });

  it('buildSearchScoreMap visual query ile skor haritası döner', () => {
    const a = minimalAsset({ id: '1' });
    const result = buildSearchScoreMap({
      filteredAssets: [a],
      searchQuery: '🔍 Görsel Vektör Sonuçları (CLIP)',
      semanticResults: [{ assetId: '1', score: 0.8 }],
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: true,
    });
    expect(result).toBeDefined();
    expect(result!['1']).toBe(0.8);
  });

  it('buildSearchScoreMap keyword sorgu ile skor haritası döner', () => {
    const a = minimalAsset({ id: '1', fileName: 'merdiven.dwg' });
    const result = buildSearchScoreMap({
      filteredAssets: [a],
      searchQuery: 'merdiven',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
    });
    // merdiven eşleşmeli — skor > 0
    expect(result).toBeDefined();
    expect(result!['1']).toBeGreaterThan(0);
  });

  it('buildSearchScoreMap hiç eşleşme yoksa undefined döner', () => {
    const a = minimalAsset({ id: '1', fileName: 'xyz.dwg' });
    const result = buildSearchScoreMap({
      filteredAssets: [a],
      searchQuery: 'tamamenfarklıkelime',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
    });
    // tamamen farklı kelime — eşleşme yok → undefined
    expect(result).toBeUndefined();
  });

  it('buildFullSearchableText userTags dahil eder', () => {
    const a = minimalAsset({
      userTags: [{ id: 1, name: 'özel_etiket', color: '#fff', assetId: 'a1' }] as any,
    });
    const t = buildFullSearchableText(a);
    expect(t).toContain('özel_etiket');
  });

  it('computeKeywordScore tek karakterlik kelimeler atlanır, 2 char geçer', () => {
    // Filtre: w.length > 1 — 1 karakter kelimeler atlanır, 2+ geçer
    const score1 = computeKeywordScore('bu at test', 'x y'); // "x"=1, "y"=1 → her ikisi filtrelenir
    expect(score1).toBe(0);
    // 2 karakterlik mimari kodlar (A1, C3) eşleşmeli
    const score2 = computeKeywordScore('bu at test', 'bu at');
    expect(score2).toBeGreaterThan(0);
  });

  it('filterAssetsHybrid görsel arama klasör filtresini bypass eder', () => {
    const inFolder = minimalAsset({ id: '1', filePath: '/projeler/A/plan.dwg' });
    const outsideFolder = minimalAsset({ id: '2', filePath: '/projeler/B/render.jpg' });
    const out = filterAssetsHybrid({
      allAssets: [inFolder, outsideFolder],
      activeFilters: {},
      searchQuery: '🔍 Görsel Vektör Sonuçları (CLIP)',
      semanticResults: [
        { assetId: '1', score: 0.7 },
        { assetId: '2', score: 0.9 },
      ],
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: true,
      activeRootFilters: ['/projeler/A/'],
      activeTagFilters: [],
    });
    // Klasör filtresi bypass — B klasöründeki asset de görünmeli
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe('2'); // en yüksek skor önce
    expect(out[1].id).toBe('1');
  });

  it('filterAssetsHybrid isImageSearching aktifken klasör filtresini bypass eder', () => {
    const a = minimalAsset({ id: '1', filePath: '/x/a.dwg' });
    const b = minimalAsset({ id: '2', filePath: '/y/b.jpg' });
    const out = filterAssetsHybrid({
      allAssets: [a, b],
      activeFilters: {},
      searchQuery: 'analiz ediliyor...',
      semanticResults: null,
      isImageSearching: true,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
      activeRootFilters: ['/x/'],
    });
    // isImageSearching aktif — /y/ klasöründeki asset de dahil
    expect(out).toHaveLength(2);
  });

  it('filterAssetsHybrid metin arama da klasör filtresini bypass eder', () => {
    const a = minimalAsset({ id: '1', filePath: '/projeler/A/merdiven.dwg', fileName: 'merdiven.dwg' });
    const b = minimalAsset({ id: '2', filePath: '/projeler/B/merdiven.dwg', fileName: 'merdiven.dwg' });
    const out = filterAssetsHybrid({
      allAssets: [a, b],
      activeFilters: {},
      searchQuery: 'merdiven',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
      activeRootFilters: ['/projeler/A/'],
    });
    // Metin araması — klasör filtresi bypass, her iki klasördeki sonuç görünmeli
    expect(out).toHaveLength(2);
  });

  it('filterAssetsHybrid arama yokken klasör filtresi uygulanır', () => {
    const a = minimalAsset({ id: '1', filePath: '/projeler/A/plan.dwg' });
    const b = minimalAsset({ id: '2', filePath: '/projeler/B/render.dwg' });
    const out = filterAssetsHybrid({
      allAssets: [a, b],
      activeFilters: {},
      searchQuery: '',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
      activeRootFilters: ['/projeler/A/'],
    });
    // Arama yok — klasör filtresi aktif, sadece A görünmeli (drill-down)
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1');
  });
});
