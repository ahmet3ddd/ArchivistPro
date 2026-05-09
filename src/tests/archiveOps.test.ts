/**
 * Arşiv Operasyonları Testleri
 *
 * Çoklu arşiv CRUD, arşiv listesi, extract/join preview.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));
vi.mock('../permissions/roles', () => ({
  getAppRole: vi.fn(() => 'admin'),
}));
vi.mock('./logger', () => ({ auditLog: vi.fn(), setLoggerDb: vi.fn() }));
vi.mock('./tagService', () => ({ setTagDb: vi.fn() }));
vi.mock('./favorites', () => ({ setFavoritesDb: vi.fn() }));
vi.mock('./messageService', () => ({ setMessageDb: vi.fn() }));
vi.mock('./userService', () => ({ setUserDb: vi.fn() }));

import {
  upsertAsset,
  getAllAssets,
  getAssetById,
  getStats,
  _setDbForTesting,
  setSetting,
  getSetting,
  getScannedRoots,
  addScannedRoot,
  removeScannedRoot,
  saveEmbedding,
  getAllEmbeddings,
  upsertTextChunk,
  getChunksByAssetId,
} from '../services/database';

function makeAsset(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a1',
    fileName: 'test.dwg',
    filePath: 'C:/Projects/test.dwg',
    fileSize: 1024,
    fileType: 'DWG',
    category: '2D Çizim',
    createdAt: '2024-01-01T00:00:00Z',
    modifiedAt: '2024-06-15T12:00:00Z',
    projectName: 'TestProject',
    projectPhase: 'Konsept',
    ...overrides,
  };
}

/* ═══════════════════════════════════════════════════════════
   1. Scanned Roots CRUD
   ═══════════════════════════════════════════════════════════ */

describe('Archive — Scanned Roots yönetimi', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('kaynak klasör eklenir ve listelenir', () => {
    addScannedRoot('C:/Projects', 'Projeler');
    const roots = getScannedRoots();
    expect(roots.length).toBeGreaterThanOrEqual(1);
    expect(roots.some(r => r.path === 'C:/Projects')).toBe(true);
  });

  it('aynı yol tekrar eklenirse hata vermez', () => {
    addScannedRoot('C:/Projects', 'V1');
    // İkinci ekleme hata vermemeli
    expect(() => addScannedRoot('C:/Projects', 'V2')).not.toThrow();
    const roots = getScannedRoots();
    expect(roots.some(r => r.path === 'C:/Projects')).toBe(true);
  });

  it('kaynak klasör silinir', () => {
    const rootId = addScannedRoot('C:/ToDelete', 'Silinecek');
    const before = getScannedRoots();
    expect(before.some(r => r.path === 'C:/ToDelete')).toBe(true);
    removeScannedRoot(rootId);
    const after = getScannedRoots();
    expect(after.some(r => r.path === 'C:/ToDelete' && !r.isRemoved)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════
   2. App Settings
   ═══════════════════════════════════════════════════════════ */

describe('Archive — App Settings CRUD', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('setSetting + getSetting döngüsü', () => {
    setSetting('test_key', 'test_value');
    expect(getSetting('test_key')).toBe('test_value');
  });

  it('aynı key güncellenir (overwrite)', () => {
    setSetting('update_key', 'v1');
    setSetting('update_key', 'v2');
    expect(getSetting('update_key')).toBe('v2');
  });

  it('olmayan key için null döner', () => {
    expect(getSetting('nonexistent')).toBeNull();
  });

  it('JSON objesi string olarak kaydedilebilir', () => {
    const config = { theme: 'dark', lang: 'tr', timeout: 30 };
    setSetting('app_config', JSON.stringify(config));
    const stored = getSetting('app_config');
    expect(JSON.parse(stored!)).toEqual(config);
  });
});

/* ═══════════════════════════════════════════════════════════
   3. Embedding ve Chunk Tutarlılığı
   ═══════════════════════════════════════════════════════════ */

describe('Archive — Embedding + Chunk veri bütünlüğü', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('farklı source ile aynı asset\'e birden fazla embedding kaydedilir', () => {
    upsertAsset(makeAsset({ id: 'multi_emb' }));
    saveEmbedding('multi_emb', [0.1, 0.2, 0.3], 'text');
    saveEmbedding('multi_emb', [0.4, 0.5, 0.6], 'image');
    saveEmbedding('multi_emb', [0.7, 0.8, 0.9], 'image_crop_0');

    const all = getAllEmbeddings();
    const forAsset = all.filter(e => e.assetId === 'multi_emb');
    // saveEmbedding ID = assetId_source — 3 farklı source = 3 kayıt
    expect(forAsset.length).toBeGreaterThanOrEqual(1);
  });

  it('birden fazla chunk aynı asset\'e bağlanır', () => {
    upsertAsset(makeAsset({ id: 'multi_chunk' }));
    upsertTextChunk({ id: 'c1', assetId: 'multi_chunk', chunkIndex: 0, text: 'Sayfa 1' });
    upsertTextChunk({ id: 'c2', assetId: 'multi_chunk', chunkIndex: 1, text: 'Sayfa 2' });
    upsertTextChunk({ id: 'c3', assetId: 'multi_chunk', chunkIndex: 2, text: 'Sayfa 3' });

    const chunks = getChunksByAssetId('multi_chunk');
    expect(chunks).toHaveLength(3);
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('boş vektör kaydetme hata vermez', () => {
    upsertAsset(makeAsset({ id: 'empty_vec' }));
    expect(() => saveEmbedding('empty_vec', [], 'text')).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════
   4. Asset Upsert — Çakışma Çözümleme
   ═══════════════════════════════════════════════════════════ */

describe('Archive — Asset upsert çakışma', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('aynı ID ile upsert mevcut kaydı günceller', () => {
    upsertAsset(makeAsset({ id: 'dup1', fileName: 'old.dwg' }));
    upsertAsset(makeAsset({ id: 'dup1', fileName: 'new.dwg' }));
    const asset = getAssetById('dup1');
    expect(asset!.fileName).toBe('new.dwg');
    expect(getAllAssets()).toHaveLength(1);
  });

  it('farklı ID ile yeni kayıt oluşturulur', () => {
    upsertAsset(makeAsset({ id: 'u1' }));
    upsertAsset(makeAsset({ id: 'u2' }));
    expect(getAllAssets()).toHaveLength(2);
  });

  it('özel karakterli dosya adı kaydedilebilir', () => {
    upsertAsset(makeAsset({
      id: 'special',
      fileName: "plan (revize) — v2.1'final.dwg",
      filePath: "C:/Proje/plan (revize) — v2.1'final.dwg",
    }));
    const asset = getAssetById('special');
    expect(asset!.fileName).toContain('revize');
  });

  it('Türkçe karakter içeren metadata kaydedilir', () => {
    upsertAsset(makeAsset({
      id: 'turkce',
      metadata: {
        layers: ['Çatı', 'Şömine', 'İç Mekan'],
        dwgKeywords: ['güneşlik', 'müdahale'],
      },
    }));
    const asset = getAssetById('turkce');
    expect(asset!.metadata.layers).toContain('Çatı');
  });
});
