/**
 * useStore (Zustand) için kapsamlı testler
 * Başlangıç durumu, aksiyon geçişleri, toast yönetimi
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useStore } from '../store/useStore';
import type { Asset } from '../types';

// Her test öncesi store'u sıfırla
function resetStore() {
  useStore.setState({
    viewMode: 'explorer',
    scannedAssets: [],
    searchQuery: '',
    semanticResults: null,
    activeFilters: {},
    selectedAssetId: null,
    isScanModalOpen: false,
    isAiConfigOpen: false,
    isRefileModalOpen: false,
    isScanPaused: false,
    isImageSearching: false,
    dbReady: false,
    storageWarning: false,
    toasts: [],
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

describe('useStore - başlangıç durumu', () => {
  beforeEach(resetStore);

  it('viewMode varsayılan explorer olur', () => {
    expect(useStore.getState().viewMode).toBe('explorer');
  });

  it('scannedAssets varsayılan boş dizi', () => {
    expect(useStore.getState().scannedAssets).toHaveLength(0);
  });

  it('searchQuery varsayılan boş string', () => {
    expect(useStore.getState().searchQuery).toBe('');
  });

  it('semanticResults varsayılan null', () => {
    expect(useStore.getState().semanticResults).toBeNull();
  });

  it('activeFilters varsayılan boş obje', () => {
    expect(useStore.getState().activeFilters).toEqual({});
  });

  it('selectedAssetId varsayılan null', () => {
    expect(useStore.getState().selectedAssetId).toBeNull();
  });

  it('modal flag\'leri varsayılan false', () => {
    const s = useStore.getState();
    expect(s.isScanModalOpen).toBe(false);
    expect(s.isAiConfigOpen).toBe(false);
    expect(s.isRefileModalOpen).toBe(false);
  });

  it('dbReady varsayılan false', () => {
    expect(useStore.getState().dbReady).toBe(false);
  });

  it('storageWarning varsayılan false', () => {
    expect(useStore.getState().storageWarning).toBe(false);
  });

  it('toasts varsayılan boş dizi', () => {
    expect(useStore.getState().toasts).toHaveLength(0);
  });
});

// ── setViewMode ────────────────────────────────────────────────────────────────

describe('useStore - setViewMode', () => {
  beforeEach(resetStore);

  it('viewMode güncellenir', () => {
    useStore.getState().setViewMode('dashboard');
    expect(useStore.getState().viewMode).toBe('dashboard');
  });

  it('tüm geçerli viewMode değerleri ayarlanabilir', () => {
    const modes = ['explorer', 'dashboard', 'technical'] as const;
    for (const mode of modes) {
      useStore.getState().setViewMode(mode);
      expect(useStore.getState().viewMode).toBe(mode);
    }
  });
});

// ── setScannedAssets ──────────────────────────────────────────────────────────

describe('useStore - setScannedAssets', () => {
  beforeEach(resetStore);

  it('direkt dizi ile güncellenir', () => {
    const assets = [minimalAsset({ id: '1' }), minimalAsset({ id: '2' })];
    useStore.getState().setScannedAssets(assets);
    expect(useStore.getState().scannedAssets).toHaveLength(2);
  });

  it('fonksiyon ile güncellenir (append)', () => {
    const initial = [minimalAsset({ id: '1' })];
    useStore.getState().setScannedAssets(initial);

    useStore.getState().setScannedAssets((prev) => [
      ...prev,
      minimalAsset({ id: '2' }),
    ]);
    expect(useStore.getState().scannedAssets).toHaveLength(2);
    expect(useStore.getState().scannedAssets[1].id).toBe('2');
  });

  it('boş dizi ile temizlenir', () => {
    useStore.getState().setScannedAssets([minimalAsset()]);
    useStore.getState().setScannedAssets([]);
    expect(useStore.getState().scannedAssets).toHaveLength(0);
  });
});

// ── searchQuery ────────────────────────────────────────────────────────────────

describe('useStore - setSearchQuery', () => {
  beforeEach(resetStore);

  it('arama sorgusu güncellenir', () => {
    useStore.getState().setSearchQuery('sütun detay');
    expect(useStore.getState().searchQuery).toBe('sütun detay');
  });

  it('boş string ile temizlenir', () => {
    useStore.getState().setSearchQuery('test');
    useStore.getState().setSearchQuery('');
    expect(useStore.getState().searchQuery).toBe('');
  });
});

// ── semanticResults ───────────────────────────────────────────────────────────

describe('useStore - setSemanticResults', () => {
  beforeEach(resetStore);

  it('sonuçlar direkt değer ile güncellenir', () => {
    const results = [{ assetId: 'a1', score: 0.9 }];
    useStore.getState().setSemanticResults(results);
    expect(useStore.getState().semanticResults).toEqual(results);
  });

  it('null ile temizlenir', () => {
    useStore.getState().setSemanticResults([{ assetId: 'a1', score: 0.8 }]);
    useStore.getState().setSemanticResults(null);
    expect(useStore.getState().semanticResults).toBeNull();
  });

  it('fonksiyon güncelleme çalışır', () => {
    const initial = [{ assetId: 'a1', score: 0.7 }];
    useStore.getState().setSemanticResults(initial);
    useStore.getState().setSemanticResults((prev) =>
      prev ? [...prev, { assetId: 'a2', score: 0.85 }] : null
    );
    expect(useStore.getState().semanticResults).toHaveLength(2);
  });
});

// ── activeFilters & toggleFacetFilter ─────────────────────────────────────────

describe('useStore - activeFilters', () => {
  beforeEach(resetStore);

  it('setActiveFilters direkt değer ile güncellenir', () => {
    useStore.getState().setActiveFilters({ category: ['Render', '3D Model'] });
    expect(useStore.getState().activeFilters.category).toEqual(['Render', '3D Model']);
  });

  it('toggleFacetFilter değer ekler', () => {
    useStore.getState().toggleFacetFilter('category', 'Render');
    expect(useStore.getState().activeFilters.category).toContain('Render');
  });

  it('toggleFacetFilter mevcut değeri kaldırır (toggle)', () => {
    useStore.getState().toggleFacetFilter('category', 'Render');
    useStore.getState().toggleFacetFilter('category', 'Render');
    expect(useStore.getState().activeFilters.category).not.toContain('Render');
  });

  it('toggleFacetFilter aynı key için birden fazla değer destekler', () => {
    useStore.getState().toggleFacetFilter('category', 'Render');
    useStore.getState().toggleFacetFilter('category', '3D Model');
    expect(useStore.getState().activeFilters.category).toContain('Render');
    expect(useStore.getState().activeFilters.category).toContain('3D Model');
    expect(useStore.getState().activeFilters.category).toHaveLength(2);
  });

  it('farklı facet key\'leri bağımsız çalışır', () => {
    useStore.getState().toggleFacetFilter('category', 'Render');
    useStore.getState().toggleFacetFilter('projectPhase', 'Konsept');
    expect(useStore.getState().activeFilters.category).toContain('Render');
    expect(useStore.getState().activeFilters.projectPhase).toContain('Konsept');
  });

  it('fonksiyon ile güncelleme çalışır', () => {
    useStore.getState().setActiveFilters({ category: ['Render'] });
    useStore.getState().setActiveFilters((prev) => ({
      ...prev,
      projectPhase: ['Avan'],
    }));
    expect(useStore.getState().activeFilters.category).toEqual(['Render']);
    expect(useStore.getState().activeFilters.projectPhase).toEqual(['Avan']);
  });
});

// ── selectedAssetId ───────────────────────────────────────────────────────────

describe('useStore - selectedAssetId', () => {
  beforeEach(resetStore);

  it('seçili asset id güncellenir', () => {
    useStore.getState().setSelectedAssetId('asset-123');
    expect(useStore.getState().selectedAssetId).toBe('asset-123');
  });

  it('null ile seçim temizlenir', () => {
    useStore.getState().setSelectedAssetId('asset-123');
    useStore.getState().setSelectedAssetId(null);
    expect(useStore.getState().selectedAssetId).toBeNull();
  });
});

// ── Modal flag'leri ───────────────────────────────────────────────────────────

describe('useStore - modal flag\'leri', () => {
  beforeEach(resetStore);

  it('isScanModalOpen toggle çalışır', () => {
    useStore.getState().setIsScanModalOpen(true);
    expect(useStore.getState().isScanModalOpen).toBe(true);
    useStore.getState().setIsScanModalOpen(false);
    expect(useStore.getState().isScanModalOpen).toBe(false);
  });

  it('isAiConfigOpen toggle çalışır', () => {
    useStore.getState().setIsAiConfigOpen(true);
    expect(useStore.getState().isAiConfigOpen).toBe(true);
  });

  it('isRefileModalOpen toggle çalışır', () => {
    useStore.getState().setIsRefileModalOpen(true);
    expect(useStore.getState().isRefileModalOpen).toBe(true);
  });

  it('dbReady güncellenir', () => {
    useStore.getState().setDbReady(true);
    expect(useStore.getState().dbReady).toBe(true);
  });

  it('storageWarning güncellenir', () => {
    useStore.getState().setStorageWarning(true);
    expect(useStore.getState().storageWarning).toBe(true);
  });

  it('isImageSearching güncellenir', () => {
    useStore.getState().setIsImageSearching(true);
    expect(useStore.getState().isImageSearching).toBe(true);
  });

  it('isScanPaused güncellenir', () => {
    useStore.getState().setIsScanPaused(true);
    expect(useStore.getState().isScanPaused).toBe(true);
  });
});

// ── Toast sistemi ─────────────────────────────────────────────────────────────

describe('useStore - toast sistemi', () => {
  beforeEach(resetStore);

  it('addToast yeni toast ekler', () => {
    useStore.getState().addToast('Test mesajı');
    expect(useStore.getState().toasts).toHaveLength(1);
    expect(useStore.getState().toasts[0].message).toBe('Test mesajı');
  });

  it('addToast varsayılan tip info olur', () => {
    useStore.getState().addToast('Info mesajı');
    expect(useStore.getState().toasts[0].type).toBe('info');
  });

  it('addToast farklı tipleri destekler', () => {
    useStore.getState().addToast('Başarılı', 'success');
    useStore.getState().addToast('Hata', 'error');
    useStore.getState().addToast('Uyarı', 'warning');

    const toasts = useStore.getState().toasts;
    expect(toasts[0].type).toBe('success');
    expect(toasts[1].type).toBe('error');
    expect(toasts[2].type).toBe('warning');
  });

  it('her toast benzersiz id alır', () => {
    useStore.getState().addToast('Mesaj 1');
    useStore.getState().addToast('Mesaj 2');
    const toasts = useStore.getState().toasts;
    expect(toasts[0].id).not.toBe(toasts[1].id);
  });

  it('removeToast id\'ye göre kaldırır', () => {
    useStore.getState().addToast('Silinecek toast');
    const id = useStore.getState().toasts[0].id;
    useStore.getState().removeToast(id);
    expect(useStore.getState().toasts).toHaveLength(0);
  });

  it('removeToast sadece belirtilen toast\'ı kaldırır', () => {
    useStore.getState().addToast('Mesaj A');
    useStore.getState().addToast('Mesaj B');
    const idA = useStore.getState().toasts[0].id;
    useStore.getState().removeToast(idA);

    const remaining = useStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].message).toBe('Mesaj B');
  });

  it('birden fazla toast sırayla eklenir', () => {
    for (let i = 0; i < 5; i++) {
      useStore.getState().addToast(`Mesaj ${i}`);
    }
    expect(useStore.getState().toasts).toHaveLength(5);
  });
});

// ── searchSensitivity ─────────────────────────────────────────────────────────

describe('useStore - searchSensitivity', () => {
  beforeEach(resetStore);

  it('searchSensitivity güncellenir', () => {
    useStore.getState().setSearchSensitivity(85);
    expect(useStore.getState().searchSensitivity).toBe(85);
  });

  it('sınır değerleri (0 ve 100) kabul edilir', () => {
    useStore.getState().setSearchSensitivity(0);
    expect(useStore.getState().searchSensitivity).toBe(0);
    useStore.getState().setSearchSensitivity(100);
    expect(useStore.getState().searchSensitivity).toBe(100);
  });
});

// ── cardSize ──────────────────────────────────────────────────────────────────

describe('useStore - cardSize', () => {
  beforeEach(resetStore);

  it('cardSize güncellenir', () => {
    useStore.getState().setCardSize(320);
    expect(useStore.getState().cardSize).toBe(320);
  });
});

// ── aiConfig ──────────────────────────────────────────────────────────────────

describe('useStore - aiConfig', () => {
  beforeEach(resetStore);

  it('aiConfig direkt değer ile güncellenir', () => {
    useStore.getState().setAiConfig({
      mode: 'cloud',
      apiProvider: 'gemini',
      apiKey: 'test-key',
      apiUrl: 'https://api.example.com',
    });
    expect(useStore.getState().aiConfig.apiProvider).toBe('gemini');
    expect(useStore.getState().aiConfig.apiKey).toBe('test-key');
  });

  it('aiConfig fonksiyon ile kısmen güncellenir', () => {
    useStore.getState().setAiConfig((prev) => ({
      ...prev,
      apiProvider: 'openai',
    }));
    expect(useStore.getState().aiConfig.apiProvider).toBe('openai');
  });
});

// ── confirmDialog ────────────────────────────────────────────────────────────

describe('useStore - confirmDialog', () => {
  beforeEach(resetStore);

  it('confirmDialog varsayılan null', () => {
    expect(useStore.getState().confirmDialog).toBeNull();
  });

  it('showConfirmDialog diyalog açar', () => {
    const onConfirm = () => {};
    useStore.getState().showConfirmDialog('Silinsin mi?', 'Detay', onConfirm);
    const d = useStore.getState().confirmDialog;
    expect(d).not.toBeNull();
    expect(d!.message).toBe('Silinsin mi?');
    expect(d!.detail).toBe('Detay');
    expect(d!.onConfirm).toBe(onConfirm);
  });

  it('showConfirmDialog detail opsiyonel', () => {
    useStore.getState().showConfirmDialog('Emin misiniz?', undefined, () => {});
    expect(useStore.getState().confirmDialog!.detail).toBeUndefined();
  });

  it('dismissConfirmDialog diyaloğu kapatır', () => {
    useStore.getState().showConfirmDialog('Test', undefined, () => {});
    expect(useStore.getState().confirmDialog).not.toBeNull();
    useStore.getState().dismissConfirmDialog();
    expect(useStore.getState().confirmDialog).toBeNull();
  });

  it('onConfirm callback çağrılabilir', () => {
    let called = false;
    useStore.getState().showConfirmDialog('Test', undefined, () => { called = true; });
    useStore.getState().confirmDialog!.onConfirm();
    expect(called).toBe(true);
  });
});
