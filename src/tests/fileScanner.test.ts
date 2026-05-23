import { describe, it, expect, vi } from 'vitest';

// Mock Tauri + dialog + fs dependencies (scanDirectory depends on them)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
  convertFileSrc: vi.fn((p: string) => p),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn(() => Promise.resolve([])),
  stat: vi.fn(() => Promise.resolve({ size: 0, mtime: new Date() })),
}));
vi.mock('../services/embeddings', () => ({
  generateEmbedding: vi.fn(() => Promise.resolve([])),
  generateImageEmbeddingsMulti: vi.fn(() => Promise.resolve([])),
  generateBatchEmbeddings: vi.fn(() => Promise.resolve([])),
}));
vi.mock('../services/database', () => ({
  upsertAsset: vi.fn(),
  saveEmbedding: vi.fn(),
  saveDatabase: vi.fn(),
  saveDatabaseDeferred: vi.fn(),
  getAssetById: vi.fn(() => null),
  upsertTextChunk: vi.fn(),
  saveChunkEmbedding: vi.fn(),
  getChunkCountByAssetIdAsync: vi.fn(async () => 0),
  getChunksByAssetIdAsync: vi.fn(async () => []),
  deleteTextChunksByAssetId: vi.fn(),
  deleteChunkEmbeddingsByAssetId: vi.fn(),
}));
vi.mock('../services/vision', () => ({
  classifyImageType: vi.fn(() => Promise.resolve({ type: 'Render', confidence: 0.9 })),
  detectMaterials: vi.fn(() => Promise.resolve({ materials: [] })),
  analyzeDWGContent: vi.fn(() => Promise.resolve({})),
}));
vi.mock('../services/textChunking', () => ({
  chunkTextForEmbedding: vi.fn(() => []),
}));
vi.mock('../services/ocr', () => ({
  ocrImageToText: vi.fn(() => Promise.resolve('')),
}));

import {
  ScanController,
  _guessPhase,
  _guessMaterial,
  _refineCategory,
  _refineCategoryWithMetadata,
  _guessProjectName,
  _guessBackupSourcePath,
  _analyzeDwgLayerCategories,
  _buildSearchableText,
  _EXTENSION_MAP,
  _CATEGORY_MAP,
} from '../services/fileScanner';
import type { CategoryType } from '../types';

describe('ScanController', () => {
  it('yeni controller varsayılan state', () => {
    const ctrl = new ScanController();
    expect(ctrl.isCancelled).toBe(false);
    expect(ctrl.isPaused).toBe(false);
  });

  it('pause / resume', () => {
    const ctrl = new ScanController();
    ctrl.pause();
    expect(ctrl.isPaused).toBe(true);
    ctrl.resume();
    expect(ctrl.isPaused).toBe(false);
  });

  it('cancel', () => {
    const ctrl = new ScanController();
    ctrl.cancel();
    expect(ctrl.isCancelled).toBe(true);
  });

  it('cancel duraklatılmışken resume çağrılır', () => {
    const ctrl = new ScanController();
    ctrl.pause();
    ctrl.cancel();
    expect(ctrl.isCancelled).toBe(true);
    expect(ctrl.isPaused).toBe(false);
  });

  it('checkPoint iptal edilmişse hata fırlatır', async () => {
    const ctrl = new ScanController();
    ctrl.cancel();
    await expect(ctrl.checkPoint()).rejects.toThrow('SCAN_CANCELLED');
  });

  it('checkPoint duraklama bekler, resume devam ettirir', async () => {
    const ctrl = new ScanController();
    ctrl.pause();
    let resolved = false;
    const promise = ctrl.checkPoint().then(() => { resolved = true; });
    // Should not resolve yet
    await new Promise(r => setTimeout(r, 50));
    expect(resolved).toBe(false);
    ctrl.resume();
    await promise;
    expect(resolved).toBe(true);
  });
});

describe('guessPhase', () => {
  it('dosya adından safha tahmin eder — uygulama', () => {
    expect(_guessPhase('plan_uygulama_v2.dwg', 'C:/Projects')).toBe('Uygulama');
  });

  it('dosya adından safha tahmin eder — konsept', () => {
    expect(_guessPhase('konsept_eskiz.dwg', 'C:/Projects')).toBe('Konsept');
  });

  it('klasör yolundan safha tahmin eder', () => {
    expect(_guessPhase('plan.dwg', 'C:/Projects/ruhsat_dosyalari')).toBe('Ruhsat');
  });

  it('varsayılan Konsept döner', () => {
    expect(_guessPhase('random_file.dwg', 'C:/Data')).toBe('Konsept');
  });
});

describe('guessMaterial', () => {
  it('dosya adından malzeme tespit eder — beton', () => {
    expect(_guessMaterial('beton_detay.dwg')).toBe('Beton');
  });

  it('dosya adından malzeme tespit eder — cam', () => {
    expect(_guessMaterial('cephe_glass_panel.max')).toBe('Cam');
  });

  it('bilinmeyen dosya adı undefined döner', () => {
    expect(_guessMaterial('plan_v2.dwg')).toBeUndefined();
  });
});

describe('refineCategory', () => {
  it('RENDER klasörü Render döner', () => {
    expect(_refineCategory('Render', 'image.jpg', 'C:/Projects/renders/image.jpg')).toBe('Render');
  });

  it('texture suffix Doku döner', () => {
    expect(_refineCategory('Render', 'brick_diffuse.jpg', 'C:/textures/brick_diffuse.jpg')).toBe('Doku');
  });

  it('fotoğraf ipucu Fotoğraf döner (DSC pattern)', () => {
    expect(_refineCategory('Render', 'DSC_0001.jpg', 'C:/photos/DSC_0001.jpg')).toBe('Fotoğraf');
  });

  it('2D Çizim dokunulmaz', () => {
    expect(_refineCategory('2D Çizim' as CategoryType, 'plan.dwg', 'C:/Projects/plan.dwg')).toBe('2D Çizim');
  });

  // ── Cihaz dosya adı pattern'leri (yeni) ──
  it('IMG_xxxx pattern Fotoğraf döner', () => {
    expect(_refineCategory('Render', 'IMG_4521.jpg', 'C:/Anywhere/IMG_4521.jpg')).toBe('Fotoğraf');
  });

  it('WhatsApp pattern Fotoğraf döner', () => {
    expect(_refineCategory('Render', 'IMG-20240515-WA0021.jpg', 'C:/X/IMG-20240515-WA0021.jpg')).toBe('Fotoğraf');
  });

  it('Pixel kamera pattern Fotoğraf döner', () => {
    expect(_refineCategory('Render', 'PXL_20240515_133045.jpg', 'C:/X/PXL_20240515_133045.jpg')).toBe('Fotoğraf');
  });

  it('DJI drone pattern Fotoğraf döner', () => {
    expect(_refineCategory('Render', 'DJI_0042.jpg', 'C:/Projects/DJI_0042.jpg')).toBe('Fotoğraf');
  });

  it('GoPro pattern Fotoğraf döner', () => {
    expect(_refineCategory('Render', 'GOPR1234.jpg', 'C:/X/GOPR1234.jpg')).toBe('Fotoğraf');
  });

  it('YYYYMMDD_HHMMSS pattern Fotoğraf döner', () => {
    expect(_refineCategory('Render', '20240515_133045.jpg', 'C:/X/20240515_133045.jpg')).toBe('Fotoğraf');
  });

  it('Fujifilm DSCF pattern Fotoğraf döner', () => {
    expect(_refineCategory('Render', 'DSCF1234.jpg', 'C:/X/DSCF1234.jpg')).toBe('Fotoğraf');
  });

  // ── Foto klasör adı tespiti (yeni) ──
  it('santiye klasörü Fotoğraf döner', () => {
    expect(_refineCategory('Render', 'genel.jpg', 'C:/Project/santiye/genel.jpg')).toBe('Fotoğraf');
  });

  it('fotograflar klasörü Fotoğraf döner', () => {
    expect(_refineCategory('Render', 'cephe.jpg', 'C:/Project/fotograflar/cephe.jpg')).toBe('Fotoğraf');
  });

  // ── Yanlış-pozitif gürültü daraltma (eskiden render olarak yanlış sınıflandırılırdı) ──
  it('finally_kontrol.jpg word-boundary kontrolü ile false-positive yapmaz', () => {
    // RENDER_WEAK_KEYWORDS ('final') artık word-boundary kullanır.
    // 'finally_kontrol' içinde 'final' word-boundary'de yok ('finally' alfanümerik takip ediyor).
    const result = _refineCategory('Render', 'finally_kontrol.jpg', 'C:/X/finally_kontrol.jpg');
    expect(result).toBe('Render'); // baz korunur (foto/texture ipucu yok)
  });

  it('building3dprint.jpg false-positive 3d eşleşmesi yapmaz', () => {
    // '3d' word-boundary'de değil (alfanümerik karakterlerle çevrili).
    expect(_refineCategory('Render', 'building3dprint.jpg', 'C:/X/building3dprint.jpg'))
      .toBe('Render');
  });

  it('render_v01.jpg RENDER kalır (strong keyword)', () => {
    expect(_refineCategory('Render', 'render_v01.jpg', 'C:/X/render_v01.jpg')).toBe('Render');
  });

  it('vray_final_v02.jpg RENDER (strong keyword)', () => {
    expect(_refineCategory('Render', 'vray_final_v02.jpg', 'C:/X/vray_final_v02.jpg')).toBe('Render');
  });

  // ── Doku suffix öncelikli (yeni regression) ──
  it('DSC_0001 olsa bile texture suffix varsa Doku', () => {
    expect(_refineCategory('Render', 'DSC_0001_diff.jpg', 'C:/X/DSC_0001_diff.jpg')).toBe('Doku');
  });

  // ── Sibling render iş akışı tespiti (yeni — 3dsMax → PSD → JPG) ──
  it('JPG yanında PSD kardeşi varsa Render (Photoshop iş akışı)', () => {
    const siblings = new Set(['psd']);
    expect(_refineCategory('Render', 'living_room.jpg', 'C:/Project/living_room.jpg', siblings)).toBe('Render');
  });

  it('TGA yanında PSD kardeşi varsa Render (3dsMax ham → Photoshop)', () => {
    const siblings = new Set(['psd']);
    expect(_refineCategory('Render', 'exterior_v01.tga', 'C:/Project/exterior_v01.tga', siblings)).toBe('Render');
  });

  it('JPG yanında MAX kardeşi varsa Render', () => {
    const siblings = new Set(['max']);
    expect(_refineCategory('Render', 'cam01.jpg', 'C:/Project/cam01.jpg', siblings)).toBe('Render');
  });

  it('Sibling yoksa baz korunur', () => {
    expect(_refineCategory('Render', 'cam01.jpg', 'C:/Project/cam01.jpg', new Set())).toBe('Render');
  });

  it('Doku klasöründe sibling PSD olsa bile Doku (klasör daha güvenilir)', () => {
    const siblings = new Set(['psd']);
    expect(_refineCategory('Render', 'brick.jpg', 'C:/Project/textures/brick.jpg', siblings)).toBe('Doku');
  });

  it('Sibling sinyali olsa bile dosya adı doku ipucu içerirse Doku', () => {
    const siblings = new Set(['psd']);
    expect(_refineCategory('Render', 'brick_seamless.jpg', 'C:/Project/brick_seamless.jpg', siblings)).toBe('Doku');
  });
});

describe('refineCategoryWithMetadata', () => {
  it('kamera bilgisi varsa Fotoğraf döner', () => {
    expect(_refineCategoryWithMetadata('Render', { cameraInfo: 'Canon EOS R5' } as any)).toBe('Fotoğraf');
  });

  it('render yazılımı varsa Render döner', () => {
    expect(_refineCategoryWithMetadata('Render', { isRenderByExif: true } as any)).toBe('Render');
  });

  it('kare power-of-2 boyut Doku döner', () => {
    expect(_refineCategoryWithMetadata('Render', { resolution: { width: 1024, height: 1024 } } as any)).toBe('Doku');
  });

  // ── Genişletilmiş EXIF sinyalleri (yeni) ──
  it('GPS koordinatları varsa Fotoğraf döner', () => {
    expect(_refineCategoryWithMetadata('Render', { gpsLat: 41.0082, gpsLon: 28.9784 } as any)).toBe('Fotoğraf');
  });

  it('focalLength varsa Fotoğraf döner', () => {
    expect(_refineCategoryWithMetadata('Render', { focalLength: '24 mm' } as any)).toBe('Fotoğraf');
  });

  it('exposureTime varsa Fotoğraf döner', () => {
    expect(_refineCategoryWithMetadata('Render', { exposureTime: '1/250' } as any)).toBe('Fotoğraf');
  });

  it('isoSpeed varsa Fotoğraf döner', () => {
    expect(_refineCategoryWithMetadata('Render', { isoSpeed: 100 } as any)).toBe('Fotoğraf');
  });

  it('renderSoftware = V-Ray ise Render döner', () => {
    expect(_refineCategoryWithMetadata('Render', { renderSoftware: 'V-Ray Next 5.10.05' } as any)).toBe('Render');
  });

  it('renderSoftware = Photoshop ise Render demez (post-process aracı)', () => {
    // Photoshop fotoğraf düzenlemede de kullanılır — render motoru değil
    const result = _refineCategoryWithMetadata('Render', { renderSoftware: 'Adobe Photoshop CC 2024' } as any);
    expect(result).toBe('Render'); // baz korunur, render olarak işaretlenmez ama sınıflandırma da değişmez
  });

  // ── Boyut sezgisi düzeltmesi (yeni) ──
  it('1920x1080 + 16:9 + EXIF foto sinyali yok → render olarak işaretlenmez (eskiden işaretlenirdi)', () => {
    // Modern telefon fotoları bu boyutta — yanlış-pozitif önlemek için katılaştırıldı
    const result = _refineCategoryWithMetadata('Render', { resolution: { width: 1920, height: 1080 } } as any);
    expect(result).toBe('Render'); // baz Render kalır ama "Render" yeniden ataması yok — kategorize değişmez
  });

  it('2560x1440 + 16:9 + EXIF foto sinyali yok → Render (QHD eşiği geçti)', () => {
    expect(_refineCategoryWithMetadata('Render', { resolution: { width: 2560, height: 1440 } } as any)).toBe('Render');
  });

  it('3840x2160 (4K) + EXIF foto sinyali yok → Render', () => {
    expect(_refineCategoryWithMetadata('Render', { resolution: { width: 3840, height: 2160 } } as any)).toBe('Render');
  });

  it('4K render boyutu olsa bile cameraInfo varsa Fotoğraf', () => {
    expect(_refineCategoryWithMetadata('Render', {
      resolution: { width: 4032, height: 3024 },
      cameraInfo: 'Apple iPhone 15 Pro',
    } as any)).toBe('Fotoğraf');
  });

  it('Doku baz kategorisi EXIF foto sinyali olsa bile Fotoğraf\'a geçer (dışsal foto)', () => {
    // Bir dosya 'Doku' baz kategorisinde gelse bile profesyonel kamera EXIF varsa fotoğraf
    expect(_refineCategoryWithMetadata('Doku', { cameraInfo: 'Hasselblad H6D-100c' } as any)).toBe('Fotoğraf');
  });

  // ── Küçük boyut → Doku (yeni — kullanıcı iş akışı) ──
  it('800x600 küçük boyut → Doku (max ≤ 1280, render eşiği altı)', () => {
    expect(_refineCategoryWithMetadata('Render', { resolution: { width: 800, height: 600 } } as any)).toBe('Doku');
  });

  it('1280x720 (HD) küçük doku boyutu → Doku', () => {
    expect(_refineCategoryWithMetadata('Render', { resolution: { width: 1280, height: 720 } } as any)).toBe('Doku');
  });

  it('1281x720 (sınır üstü) → Render baz korunur', () => {
    // 1281 > 1280 olduğu için küçük-boyut kuralı tetiklenmez; QHD altı olduğu için render kuralı da değil
    expect(_refineCategoryWithMetadata('Render', { resolution: { width: 1281, height: 720 } } as any)).toBe('Render');
  });

  it('Küçük boyut + cameraInfo → yine de Fotoğraf (foto sinyali öncelikli)', () => {
    expect(_refineCategoryWithMetadata('Render', {
      resolution: { width: 800, height: 600 },
      cameraInfo: 'Apple iPhone 8',
    } as any)).toBe('Fotoğraf');
  });

  // ── Dosya boyutu sezgisi (resolution çıkarılamazsa fallback) ──
  it('resolution yok + 212KB → Doku (küçük dosya, render olamaz)', () => {
    expect(_refineCategoryWithMetadata('Render', {} as any, 212 * 1024)).toBe('Doku');
  });

  it('resolution yok + 49KB → Doku', () => {
    expect(_refineCategoryWithMetadata('Render', {} as any, 49 * 1024)).toBe('Doku');
  });

  it('resolution yok + 499KB → Doku (eşik altı)', () => {
    expect(_refineCategoryWithMetadata('Render', {} as any, 499 * 1024)).toBe('Doku');
  });

  it('resolution yok + 500KB → Render kalır (eşik üstü)', () => {
    expect(_refineCategoryWithMetadata('Render', {} as any, 500 * 1024)).toBe('Render');
  });

  it('resolution yok + 2MB → Render kalır', () => {
    expect(_refineCategoryWithMetadata('Render', {} as any, 2 * 1024 * 1024)).toBe('Render');
  });

  it('resolution var (büyük) + küçük dosya → resolution boyutu öncelikli', () => {
    // Çözünürlük biliniyorsa dosya boyutu devreye girmez
    expect(_refineCategoryWithMetadata('Render', { resolution: { width: 1920, height: 1080 } } as any, 100 * 1024)).toBe('Render');
  });

  it('cameraInfo var + küçük dosya → Fotoğraf (EXIF sinyali en öncelikli)', () => {
    expect(_refineCategoryWithMetadata('Render', { cameraInfo: 'Samsung Galaxy' } as any, 100 * 1024)).toBe('Fotoğraf');
  });
});

// ── CATEGORY_MAP regression: TGA artık Render baz (3dsMax workflow) ──
describe('CATEGORY_MAP — TGA/TIFF baz değişikliği', () => {
  it('TGA artık Render baz (eskiden Doku)', () => {
    expect(_CATEGORY_MAP['TGA']).toBe('Render');
  });

  it('TIFF artık Render baz (eskiden Doku)', () => {
    expect(_CATEGORY_MAP['TIFF']).toBe('Render');
  });

  it('JPEG hala Render baz', () => {
    expect(_CATEGORY_MAP['JPEG']).toBe('Render');
  });
});

describe('guessProjectName', () => {
  it('ilk parça proje adı olur', () => {
    expect(_guessProjectName(['MyProject', 'subfolder', 'file.dwg'])).toBe('MyProject');
  });

  it('tek parça "Genel Arşiv" döner', () => {
    expect(_guessProjectName(['file.dwg'])).toBe('Genel Arşiv');
  });
});

describe('guessBackupSourcePath', () => {
  it('.dwg.bak → .dwg', () => {
    expect(_guessBackupSourcePath('plan.dwg.bak', 'C:/Projects/plan.dwg.bak')).toBe('C:/Projects/plan.dwg');
  });

  it('.sv$ → .dwg', () => {
    expect(_guessBackupSourcePath('plan.sv$', 'C:/Projects/plan.sv$')).toBe('C:/Projects/plan.dwg');
  });

  it('.dwl → .dwg', () => {
    expect(_guessBackupSourcePath('plan.dwl', 'C:/Projects/plan.dwl')).toBe('C:/Projects/plan.dwg');
  });

  it('single .bak with source type', () => {
    expect(_guessBackupSourcePath('file.bak', 'C:/data/file.bak', 'psd')).toBe('C:/data/file.psd');
  });
});

describe('analyzeDwgLayerCategories', () => {
  it('AIA prefix → kategori', () => {
    const categories = _analyzeDwgLayerCategories(['A-WALL', 'S-BEAM', 'E-LIGHT', 'P-PLUMB']);
    expect(categories).toContain('Mimari');
    expect(categories).toContain('Strüktür');
    expect(categories).toContain('Elektrik');
    expect(categories).toContain('Tesisat');
  });

  it('content keyword → kategori', () => {
    const categories = _analyzeDwgLayerCategories(['CUSTOM-DOOR', 'WINDOW-DETAIL']);
    expect(categories).toContain('Kapı');
    expect(categories).toContain('Pencere');
  });

  it('boş dizi → boş sonuç', () => {
    expect(_analyzeDwgLayerCategories([])).toEqual([]);
  });
});

describe('EXTENSION_MAP', () => {
  it('DWG uzantısı doğru AssetType', () => {
    expect(_EXTENSION_MAP['dwg']).toBe('DWG');
  });

  it('MAX uzantısı doğru AssetType', () => {
    expect(_EXTENSION_MAP['max']).toBe('MAX');
  });

  it('jpg/jpeg JPEG', () => {
    expect(_EXTENSION_MAP['jpg']).toBe('JPEG');
    expect(_EXTENSION_MAP['jpeg']).toBe('JPEG');
  });

  it('bak BAK', () => {
    expect(_EXTENSION_MAP['bak']).toBe('BAK');
    expect(_EXTENSION_MAP['sv$']).toBe('BAK');
  });

  it('pdf PDF', () => {
    expect(_EXTENSION_MAP['pdf']).toBe('PDF');
  });
});

describe('buildSearchableText', () => {
  it('temel alanları birleştirir', () => {
    const text = _buildSearchableText({
      fileName: 'plan_v2.dwg',
      projectName: 'Tower',
      category: '2D Çizim',
      fileType: 'DWG',
      projectPhase: 'Uygulama',
    } as any);
    expect(text).toContain('plan v2 dwg');
    expect(text).toContain('Tower');
    expect(text).toContain('2D Çizim');
    expect(text).toContain('DWG');
    expect(text).toContain('Uygulama');
  });

  it('DWG metadata dahil eder', () => {
    const text = _buildSearchableText({
      fileName: 'plan.dwg',
      metadata: {
        dwgLayers: ['A-WALL', 'S-BEAM'],
        dwgBlockNames: ['DOOR-01'],
        dwgDescription: 'Kat planı',
      },
    } as any);
    expect(text).toContain('A WALL');
    expect(text).toContain('DOOR 01');
    expect(text).toContain('Kat planı');
  });
});
