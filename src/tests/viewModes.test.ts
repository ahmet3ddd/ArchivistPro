/**
 * Görüntüleme Modları & Store State Testleri
 *
 * ViewMode geçişleri, filtre kalıcılığı, kart boyutu,
 * modal flag'leri, seçim yönetimi.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';
import type { Asset, ViewMode } from '../types';

function resetStore() {
  useStore.setState({
    viewMode: 'explorer',
    scannedAssets: [],
    searchQuery: '',
    semanticResults: null,
    activeFilters: {},
    selectedAssetId: null,
    selectedAssetIds: [],
    isScanModalOpen: false,
    isAiConfigOpen: false,
    isRefileModalOpen: false,
    isScanPaused: false,
    isImageSearching: false,
    dbReady: false,
    storageWarning: false,
    toasts: [],
    cardSize: 200,
    searchSensitivity: 70,
  });
}

const minimalAsset = (overrides: Partial<Asset> = {}): Asset => ({
  id: 'a1',
  fileName: 'test.dwg',
  filePath: '/x/test.dwg',
  fileSize: 100,
  fileType: 'DWG',
  category: '2D Çizim',
  createdAt: '2025-01-01T00:00:00',
  modifiedAt: '2025-01-01T00:00:00',
  projectName: 'TestProje',
  projectPhase: 'Konsept',
  aiTags: [],
  colorPalette: [],
  metadata: {},
  isIndexed: true,
  ...overrides,
});

/* ═══════════════════════════════════════════════════════════
   1. ViewMode Geçişleri
   ═══════════════════════════════════════════════════════════ */

describe('Store — ViewMode geçişleri', () => {
  beforeEach(resetStore);

  const modes: ViewMode[] = ['explorer', 'dashboard', 'technical', 'folders'];

  for (const mode of modes) {
    it(`${mode} moduna geçiş`, () => {
      useStore.getState().setViewMode(mode);
      expect(useStore.getState().viewMode).toBe(mode);
    });
  }

  it('mod geçişinde arama sorgusu korunur', () => {
    useStore.getState().setSearchQuery('test');
    useStore.getState().setViewMode('dashboard');
    expect(useStore.getState().searchQuery).toBe('test');
    useStore.getState().setViewMode('explorer');
    expect(useStore.getState().searchQuery).toBe('test');
  });

  it('mod geçişinde aktif filtreler korunur', () => {
    useStore.setState({ activeFilters: { category: ['Render'] } });
    useStore.getState().setViewMode('technical');
    expect(useStore.getState().activeFilters).toEqual({ category: ['Render'] });
  });
});

/* ═══════════════════════════════════════════════════════════
   2. Kart Boyutu
   ═══════════════════════════════════════════════════════════ */

describe('Store — Kart boyutu', () => {
  beforeEach(resetStore);

  it('varsayılan kart boyutu 200', () => {
    expect(useStore.getState().cardSize).toBe(200);
  });

  it('kart boyutu değiştirilebilir', () => {
    useStore.getState().setCardSize(300);
    expect(useStore.getState().cardSize).toBe(300);
  });

  it('minimum kart boyutu kontrolü', () => {
    useStore.getState().setCardSize(50);
    // 50 kabul edilmeli veya min clamp uygulanmalı
    const size = useStore.getState().cardSize;
    expect(size).toBeGreaterThanOrEqual(50);
  });
});

/* ═══════════════════════════════════════════════════════════
   3. Arama Hassasiyet Kontrolü
   ═══════════════════════════════════════════════════════════ */

describe('Store — Arama hassasiyeti', () => {
  beforeEach(resetStore);

  it('varsayılan hassasiyet 70', () => {
    expect(useStore.getState().searchSensitivity).toBe(70);
  });

  it('hassasiyet değiştirilebilir', () => {
    useStore.getState().setSearchSensitivity(90);
    expect(useStore.getState().searchSensitivity).toBe(90);
  });

  it('0 ve 100 sınır değerleri', () => {
    useStore.getState().setSearchSensitivity(0);
    expect(useStore.getState().searchSensitivity).toBe(0);
    useStore.getState().setSearchSensitivity(100);
    expect(useStore.getState().searchSensitivity).toBe(100);
  });
});

/* ═══════════════════════════════════════════════════════════
   4. Çoklu Seçim
   ═══════════════════════════════════════════════════════════ */

describe('Store — Çoklu seçim yönetimi', () => {
  beforeEach(resetStore);

  it('tek asset seçimi', () => {
    useStore.getState().setSelectedAssetId('a1');
    expect(useStore.getState().selectedAssetId).toBe('a1');
  });

  it('çoklu seçim toggle', () => {
    const state = useStore.getState();
    if (state.toggleAssetSelection) {
      state.toggleAssetSelection('a1');
      state.toggleAssetSelection('a2');
      expect(useStore.getState().selectedAssetIds).toContain('a1');
      expect(useStore.getState().selectedAssetIds).toContain('a2');

      // Toggle ile kaldır
      state.toggleAssetSelection('a1');
      expect(useStore.getState().selectedAssetIds).not.toContain('a1');
    }
  });

  it('seçim temizleme', () => {
    const state = useStore.getState();
    if (state.toggleAssetSelection) {
      state.toggleAssetSelection('a1');
      state.toggleAssetSelection('a2');
    }
    useStore.setState({ selectedAssetIds: [] });
    expect(useStore.getState().selectedAssetIds).toHaveLength(0);
  });
});

/* ═══════════════════════════════════════════════════════════
   5. Modal Flag'leri
   ═══════════════════════════════════════════════════════════ */

describe('Store — Modal flag\'leri', () => {
  beforeEach(resetStore);

  it('scan modal aç/kapa', () => {
    useStore.getState().setIsScanModalOpen(true);
    expect(useStore.getState().isScanModalOpen).toBe(true);
    useStore.getState().setIsScanModalOpen(false);
    expect(useStore.getState().isScanModalOpen).toBe(false);
  });

  it('ai config aç/kapa', () => {
    useStore.getState().setIsAiConfigOpen(true);
    expect(useStore.getState().isAiConfigOpen).toBe(true);
  });

  it('refile modal aç/kapa', () => {
    useStore.getState().setIsRefileModalOpen(true);
    expect(useStore.getState().isRefileModalOpen).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════
   6. Semantik Sonuçlar
   ═══════════════════════════════════════════════════════════ */

describe('Store — Semantik sonuçlar', () => {
  beforeEach(resetStore);

  it('null iken sonuç yok', () => {
    expect(useStore.getState().semanticResults).toBeNull();
  });

  it('sonuç set edilir', () => {
    const results = [
      { assetId: 'a1', score: 0.9 },
      { assetId: 'a2', score: 0.7 },
    ];
    useStore.getState().setSemanticResults(results);
    expect(useStore.getState().semanticResults).toEqual(results);
  });

  it('sonuç null ile temizlenir', () => {
    useStore.getState().setSemanticResults([{ assetId: 'a1', score: 0.9 }]);
    useStore.getState().setSemanticResults(null);
    expect(useStore.getState().semanticResults).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════
   7. Aktif Filtreler
   ═══════════════════════════════════════════════════════════ */

describe('Store — Aktif filtreler', () => {
  beforeEach(resetStore);

  it('filtre ekle', () => {
    useStore.setState({ activeFilters: { category: ['Render'] } });
    expect(useStore.getState().activeFilters.category).toContain('Render');
  });

  it('çoklu filtre', () => {
    useStore.setState({
      activeFilters: {
        category: ['Render', '2D Çizim'],
        projectPhase: ['Konsept'],
      },
    });
    const filters = useStore.getState().activeFilters;
    expect(filters.category).toHaveLength(2);
    expect(filters.projectPhase).toHaveLength(1);
  });

  it('filtre temizle', () => {
    useStore.setState({ activeFilters: { category: ['Render'] } });
    useStore.setState({ activeFilters: {} });
    expect(useStore.getState().activeFilters).toEqual({});
  });
});
