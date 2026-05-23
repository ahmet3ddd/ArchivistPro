/**
 * Arama Sistemi — Gelişmiş Filtreleme Testleri
 *
 * Çoklu facet, tag filtresi, root filtresi, turkishLower,
 * hibrit skor, hassasiyet eşikleri, sınır durumları.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  isVisualVectorQueryString,
  buildFullSearchableText,
  computeKeywordScore,
  visualSearchThreshold,
  semanticMatchThreshold,
  computeHybridFinalScore,
  filterAssetsHybrid,
} from '../utils/searchScoring';
import type { Asset } from '../types';

vi.mock('../services/queryExpansion', () => ({
  expandQuery: (q: string) => q,
  findMatchSources: vi.fn(() => []),
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

/* ═══════════════════════════════════════════════════════════
   1. turkishLower & buildFullSearchableText Gelişmiş
   ═══════════════════════════════════════════════════════════ */

describe('Search — Türkçe karakter normalize', () => {
  it('İstanbul → istanbul (İ→i doğru çevrilir)', () => {
    const a = minimalAsset({ fileName: 'İstanbul_planı.dwg' });
    const text = buildFullSearchableText(a);
    expect(text).toContain('istanbul');
    expect(text).not.toContain('İ');
  });

  it('metadata içindeki Türkçe özel karakterler normalize edilir', () => {
    // Türkçe büyük harf: İ (dotted) → i, I (dotless) → ı
    const a = minimalAsset({
      metadata: {
        layers: ['ŞÖMİNE_KATMANI', 'ÇELİK_TAŞIYICI'],
        dwgKeywords: ['GÜNEŞLİK'],
      },
    });
    const text = buildFullSearchableText(a);
    expect(text).toContain('şömine');
    expect(text).toContain('çelik');
    expect(text).toContain('güneşlik');
  });

  it('boş asset hata vermez', () => {
    const a = minimalAsset({
      fileName: '',
      projectName: '',
      aiTags: [],
      metadata: {},
    });
    expect(() => buildFullSearchableText(a)).not.toThrow();
  });

  it('approval status aranabilir metne dahil edilir', () => {
    const a = minimalAsset({ approvalStatus: 'approved' } as any);
    const text = buildFullSearchableText(a);
    expect(text).toContain('approved');
  });
});

/* ═══════════════════════════════════════════════════════════
   2. computeKeywordScore Kenar Durumları
   ═══════════════════════════════════════════════════════════ */

describe('Search — Keyword skor kenar durumları', () => {
  it('tam eşleşme yüksek skor verir', () => {
    const score = computeKeywordScore('merdiven hol antre', 'merdiven');
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it('tüm kelimeler eşleşince ~1.0 skor', () => {
    const score = computeKeywordScore('salon mutfak banyo', 'salon mutfak banyo');
    expect(score).toBeGreaterThanOrEqual(0.95);
  });

  it('hiç eşleşme yoksa 0', () => {
    const score = computeKeywordScore('salon mutfak', 'garaj bahçe');
    expect(score).toBe(0);
  });

  it('kısmi eşleşme orantılı skor', () => {
    // 1/3 kelime eşleşmeli (maxExpected=3, match=1, exactBonus=0.2 → ~0.53)
    const score = computeKeywordScore('salonda mutfak tavan', 'salon yatak teras');
    // 'salon' substring eşleşir ama boundary yok ('salonda'), exactBonus düşük olabilir
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('boş sorgu 0 döner', () => {
    expect(computeKeywordScore('herhangi metin', '')).toBe(0);
  });

  it('boş metin 0 döner', () => {
    expect(computeKeywordScore('', 'sorgu')).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════
   3. Hibrit Skor Hesaplama
   ═══════════════════════════════════════════════════════════ */

describe('Search — Hibrit skor hesaplama', () => {
  it('sadece keyword → skor = keyword', () => {
    const score = computeHybridFinalScore(0.7, 0, 0.3);
    expect(score).toBeCloseTo(0.7, 1);
  });

  it('sadece semantik → skor pozitif', () => {
    const score = computeHybridFinalScore(0, 0.8, 0.3);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('her ikisi yüksekken 1\'e yaklaşır', () => {
    const score = computeHybridFinalScore(0.9, 0.9, 0.3);
    expect(score).toBeGreaterThan(0.9);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('her ikisi 0 → skor = 0', () => {
    expect(computeHybridFinalScore(0, 0, 0.3)).toBe(0);
  });

  it('skor asla 1\'i aşmaz', () => {
    const score = computeHybridFinalScore(1, 1, 0.01);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('negatif değerler güvenli', () => {
    const score = computeHybridFinalScore(-0.1, -0.2, 0.3);
    expect(Number.isFinite(score)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════
   4. Eşik Fonksiyonları
   ═══════════════════════════════════════════════════════════ */

describe('Search — Eşik hesaplamaları', () => {
  it('visual threshold 0→0.35, 50→0.60, 100→0.85', () => {
    expect(visualSearchThreshold(0)).toBeCloseTo(0.35);
    expect(visualSearchThreshold(50)).toBeCloseTo(0.60);
    expect(visualSearchThreshold(100)).toBeCloseTo(0.85);
  });

  it('semantic threshold 0→0.15, 50→0.30, 100→0.45', () => {
    expect(semanticMatchThreshold(0)).toBeCloseTo(0.15);
    expect(semanticMatchThreshold(50)).toBeCloseTo(0.30);
    expect(semanticMatchThreshold(100)).toBeCloseTo(0.45);
  });

  it('sınır dışı sensitivity güvenli', () => {
    expect(Number.isFinite(visualSearchThreshold(-10))).toBe(true);
    expect(Number.isFinite(visualSearchThreshold(200))).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════
   5. Çoklu Facet Filtre Kombinasyonları
   ═══════════════════════════════════════════════════════════ */

describe('Search — Çoklu facet filtreleri', () => {
  const assets: Asset[] = [
    minimalAsset({ id: '1', category: '2D Çizim', projectPhase: 'Konsept' }),
    minimalAsset({ id: '2', category: 'Render', projectPhase: 'Uygulama' }),
    minimalAsset({ id: '3', category: '2D Çizim', projectPhase: 'Uygulama' }),
    minimalAsset({ id: '4', category: '3D Model', projectPhase: 'Konsept' }),
    minimalAsset({ id: '5', category: 'Render', projectPhase: 'Konsept',
      materialGroup: 'Beton' } as any),
  ];

  const base = {
    searchQuery: '',
    semanticResults: null,
    isImageSearching: false,
    searchSensitivity: 50,
    isVisualVectorQuery: false,
  };

  it('tek kategori filtresi', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      activeFilters: { category: ['Render'] },
    });
    expect(out).toHaveLength(2);
    expect(out.every(a => a.category === 'Render')).toBe(true);
  });

  it('çoklu kategori (OR mantığı)', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      activeFilters: { category: ['Render', '3D Model'] },
    });
    expect(out).toHaveLength(3);
  });

  it('kategori + aşama (AND mantığı)', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      activeFilters: {
        category: ['2D Çizim'],
        projectPhase: ['Uygulama'],
      },
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('3');
  });

  it('hiç eşleşmeyen filtre boş dizi döner', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      activeFilters: { category: ['Video'] },
    });
    expect(out).toHaveLength(0);
  });

  it('boş filtre tüm asset\'leri döner', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      activeFilters: {},
    });
    expect(out).toHaveLength(5);
  });
});

/* ═══════════════════════════════════════════════════════════
   6. Tag Filtresi
   ═══════════════════════════════════════════════════════════ */

describe('Search — Tag filtresi', () => {
  const assets: Asset[] = [
    minimalAsset({ id: '1', userTags: [{ id: 1, name: 'önemli', color: '#f00', assetId: '1' }] } as any),
    minimalAsset({ id: '2', userTags: [{ id: 2, name: 'arşiv', color: '#0f0', assetId: '2' }] } as any),
    minimalAsset({ id: '3', userTags: [] } as any),
  ];

  const base = {
    searchQuery: '',
    semanticResults: null,
    isImageSearching: false,
    searchSensitivity: 50,
    isVisualVectorQuery: false,
    activeFilters: {},
    activeRootFilters: [],
  };

  it('tag filtresi eşleşenleri döner', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      activeTagFilters: [1],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1');
  });

  it('çoklu tag OR mantığıyla çalışır', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      activeTagFilters: [1, 2],
    });
    expect(out).toHaveLength(2);
  });

  it('boş tag filtresi tüm asset\'leri döner', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      activeTagFilters: [],
    });
    expect(out).toHaveLength(3);
  });
});

/* ═══════════════════════════════════════════════════════════
   7. Root Folder Filtresi
   ═══════════════════════════════════════════════════════════ */

describe('Search — Root folder filtresi', () => {
  const assets: Asset[] = [
    minimalAsset({ id: '1', filePath: 'C:/Projeler/A/plan.dwg' }),
    minimalAsset({ id: '2', filePath: 'C:/Projeler/B/render.jpg' }),
    minimalAsset({ id: '3', filePath: 'D:/Arşiv/eski.dwg' }),
  ];

  const base = {
    activeFilters: {},
    semanticResults: null,
    isImageSearching: false,
    searchSensitivity: 50,
    isVisualVectorQuery: false,
    activeTagFilters: [],
  };

  it('root filtresi arama yokken uygulanır', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      searchQuery: '',
      activeRootFilters: ['C:/Projeler/A/'],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1');
  });

  it('root filtresi arama varken bypass edilir', () => {
    // Arama aktif olduğunda root filtresi bypass edilir
    // Her iki asset'in dosya adında 'projeler' geçiyor
    const searchAssets: Asset[] = [
      minimalAsset({ id: '1', filePath: 'C:/Projeler/A/plan.dwg', fileName: 'projeler_plan.dwg' }),
      minimalAsset({ id: '2', filePath: 'C:/Projeler/B/render.jpg', fileName: 'projeler_render.jpg' }),
    ];
    const out = filterAssetsHybrid({
      ...base,
      allAssets: searchAssets,
      searchQuery: 'projeler',
      activeRootFilters: ['C:/Projeler/A/'],
    });
    // Arama aktif — root filtresi bypass, her iki klasördeki sonuç görünmeli
    expect(out).toHaveLength(2);
  });

  it('çoklu root filtresi (OR mantığı)', () => {
    const out = filterAssetsHybrid({
      ...base,
      allAssets: assets,
      searchQuery: '',
      activeRootFilters: ['C:/Projeler/A/', 'D:/Arşiv/'],
    });
    expect(out).toHaveLength(2);
  });
});

/* ═══════════════════════════════════════════════════════════
   8. Arama + Filtre Kombinasyonu
   ═══════════════════════════════════════════════════════════ */

describe('Search — Arama + facet kombinasyonu', () => {
  const assets: Asset[] = [
    minimalAsset({ id: '1', fileName: 'merdiven.dwg', category: '2D Çizim' }),
    minimalAsset({ id: '2', fileName: 'merdiven_render.jpg', category: 'Render' }),
    minimalAsset({ id: '3', fileName: 'salon.dwg', category: '2D Çizim' }),
  ];

  it('metin araması + kategori filtresi birlikte çalışır', () => {
    const out = filterAssetsHybrid({
      allAssets: assets,
      activeFilters: { category: ['2D Çizim'] },
      searchQuery: 'merdiven',
      semanticResults: null,
      isImageSearching: false,
      searchSensitivity: 50,
      isVisualVectorQuery: false,
    });
    // Sadece 2D Çizim + merdiven eşleşmesi
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('1');
  });
});

/* ═══════════════════════════════════════════════════════════
   9. isVisualVectorQueryString
   ═══════════════════════════════════════════════════════════ */

describe('Search — Visual query string tespiti', () => {
  it('CLIP prefix tanınır', () => {
    expect(isVisualVectorQueryString('🔍 Görsel Sonuçlar (CLIP + pHash)')).toBe(true);
    expect(isVisualVectorQueryString('🔍 Görsel Vektör Sonuçları (CLIP)')).toBe(true);
  });

  it('normal metin tanınmaz', () => {
    expect(isVisualVectorQueryString('merdiven planı')).toBe(false);
    expect(isVisualVectorQueryString('')).toBe(false);
    expect(isVisualVectorQueryString('CLIP')).toBe(false);
  });
});
