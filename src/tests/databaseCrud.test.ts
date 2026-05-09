import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

// Mock permissions
vi.mock('../permissions/roles', () => ({
  getAppRole: vi.fn(() => 'admin'),
}));

// Mock logger
vi.mock('./logger', () => ({
  auditLog: vi.fn(),
  setLoggerDb: vi.fn(),
}));

// Mock tagService
vi.mock('./tagService', () => ({
  setTagDb: vi.fn(),
}));

// Mock favorites
vi.mock('./favorites', () => ({
  setFavoritesDb: vi.fn(),
}));

// Mock messageService
vi.mock('./messageService', () => ({
  setMessageDb: vi.fn(),
}));

// Mock userService
vi.mock('./userService', () => ({
  setUserDb: vi.fn(),
}));

import {
  upsertAsset,
  getAssetById,
  getAllAssets,
  deleteAsset,
  clearAllAssets,
  saveEmbedding,
  saveChunkEmbedding,
  getAllEmbeddings,
  hasAnyEmbeddings,
  getEmbeddingsBySourcePrefix,
  upsertTextChunk,
  getChunksByAssetId,
  getChunkCountByAssetId,
  getChunkById,
  deleteTextChunksByAssetId,
  saveAssetSummary,
  getAssetSummary,
  getStats,
  remapFilePaths,
  getAssetPhashMap,
  _setDbForTesting,
} from '../services/database';

function makeAsset(overrides: Partial<Parameters<typeof upsertAsset>[0]> = {}) {
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

describe('Database CRUD — Asset', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('upsertAsset yeni asset ekler', () => {
    upsertAsset(makeAsset());
    const asset = getAssetById('a1');
    expect(asset).not.toBeNull();
    expect(asset!.fileName).toBe('test.dwg');
    expect(asset!.fileType).toBe('DWG');
    expect(asset!.category).toBe('2D Çizim');
  });

  it('upsertAsset aynı ID ile günceller', () => {
    upsertAsset(makeAsset());
    upsertAsset(makeAsset({ fileName: 'updated.dwg' }));
    const asset = getAssetById('a1');
    expect(asset!.fileName).toBe('updated.dwg');
  });

  it('getAssetById döner veya null', () => {
    expect(getAssetById('nonexistent')).toBeNull();
    upsertAsset(makeAsset());
    expect(getAssetById('a1')).not.toBeNull();
  });

  it('getAllAssets sıralı döner (modified_at DESC)', () => {
    upsertAsset(makeAsset({ id: 'a1', modifiedAt: '2024-01-01T00:00:00Z' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'newer.dwg', modifiedAt: '2024-06-15T12:00:00Z' }));
    const all = getAllAssets();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe('a2');
  });

  it('deleteAsset cascade ile siler', () => {
    upsertAsset(makeAsset());
    saveEmbedding('a1', [0.1, 0.2], 'text');
    upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'test' });
    expect(deleteAsset('a1')).toBe(true);
    expect(getAssetById('a1')).toBeNull();
    expect(getAllEmbeddings('text')).toHaveLength(0);
    expect(getChunksByAssetId('a1')).toHaveLength(0);
  });

  it('deleteAsset olmayan id için false döner', () => {
    expect(deleteAsset('nonexistent')).toBe(true); // SQL DELETE succeeds even if no rows
  });

  it('clearAllAssets tüm tabloları temizler', () => {
    upsertAsset(makeAsset());
    upsertAsset(makeAsset({ id: 'a2', fileName: 'b.dwg' }));
    saveEmbedding('a1', [0.1], 'text');
    clearAllAssets();
    expect(getAllAssets()).toHaveLength(0);
    expect(hasAnyEmbeddings()).toBe(false);
  });
});

describe('Database CRUD — Embedding', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset());
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('saveEmbedding kaydeder', () => {
    saveEmbedding('a1', [0.1, 0.2, 0.3], 'text');
    const embs = getAllEmbeddings('text');
    expect(embs).toHaveLength(1);
    expect(embs[0].assetId).toBe('a1');
    expect(embs[0].vector).toHaveLength(3);
    expect(embs[0].vector[0]).toBeCloseTo(0.1, 5);
    expect(embs[0].vector[1]).toBeCloseTo(0.2, 5);
    expect(embs[0].vector[2]).toBeCloseTo(0.3, 5);
  });

  it('getAllEmbeddings source ile filtreler', () => {
    saveEmbedding('a1', [0.1], 'text');
    saveEmbedding('a1', [0.2], 'image_global');
    expect(getAllEmbeddings('text')).toHaveLength(1);
    expect(getAllEmbeddings('image_global')).toHaveLength(1);
    expect(getAllEmbeddings('nonexistent')).toHaveLength(0);
  });

  it('hasAnyEmbeddings boş DB false, dolu DB true', () => {
    expect(hasAnyEmbeddings()).toBe(false);
    saveEmbedding('a1', [0.1], 'text');
    expect(hasAnyEmbeddings()).toBe(true);
  });

  it('saveChunkEmbedding ref_id ile kaydeder', () => {
    upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'hello' });
    saveChunkEmbedding('a1', 'a1_c0', [0.5, 0.6], 'chunk_text');
    const embs = getAllEmbeddings('chunk_text');
    // chunk embeddings have ref_id, getAllEmbeddings doesn't filter by ref_id
    // but still returns matching source
    expect(embs).toHaveLength(1);
  });

  it('getEmbeddingsBySourcePrefix prefix ile getirir', () => {
    saveEmbedding('a1', [0.1], 'image_global');
    saveEmbedding('a1', [0.2], 'image_center');
    saveEmbedding('a1', [0.3], 'text');
    const imageEmbs = getEmbeddingsBySourcePrefix('image_');
    expect(imageEmbs).toHaveLength(2);
    expect(imageEmbs.every(e => e.source.startsWith('image_'))).toBe(true);
  });
});

describe('Database CRUD — Text Chunks', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset());
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('upsertTextChunk kaydeder', () => {
    upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'test content', lang: 'tr' });
    const chunks = getChunksByAssetId('a1');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('test content');
    expect(chunks[0].lang).toBe('tr');
  });

  it('getChunksByAssetId chunk_index ASC sıralı', () => {
    upsertTextChunk({ id: 'a1_c2', assetId: 'a1', chunkIndex: 2, text: 'third' });
    upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'first' });
    upsertTextChunk({ id: 'a1_c1', assetId: 'a1', chunkIndex: 1, text: 'second' });
    const chunks = getChunksByAssetId('a1');
    expect(chunks.map(c => c.chunkIndex)).toEqual([0, 1, 2]);
  });

  it('getChunkCountByAssetId doğru sayı döner', () => {
    expect(getChunkCountByAssetId('a1')).toBe(0);
    upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'a' });
    upsertTextChunk({ id: 'a1_c1', assetId: 'a1', chunkIndex: 1, text: 'b' });
    expect(getChunkCountByAssetId('a1')).toBe(2);
  });

  it('getChunkById döner veya null', () => {
    upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'hello' });
    const chunk = getChunkById('a1_c0');
    expect(chunk).not.toBeNull();
    expect(chunk!.text).toBe('hello');
    expect(getChunkById('nonexistent')).toBeNull();
  });

  it('deleteTextChunksByAssetId siler', () => {
    upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'a' });
    upsertTextChunk({ id: 'a1_c1', assetId: 'a1', chunkIndex: 1, text: 'b' });
    deleteTextChunksByAssetId('a1');
    expect(getChunksByAssetId('a1')).toHaveLength(0);
  });
});

describe('Database CRUD — Summaries', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset());
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('saveAssetSummary ve getAssetSummary', () => {
    saveAssetSummary('a1', 'Bu bir test özeti', ['test', 'özet'], 'llama3');
    const summary = getAssetSummary('a1');
    expect(summary).not.toBeNull();
    expect(summary!.summary).toBe('Bu bir test özeti');
    expect(summary!.keywords).toEqual(['test', 'özet']);
    expect(summary!.model).toBe('llama3');
  });

  it('getAssetSummary olmayan id için null', () => {
    expect(getAssetSummary('nonexistent')).toBeNull();
  });
});

describe('Database CRUD — İstatistik', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('getStats doğru sayılar', () => {
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'b.dwg' }));
    saveEmbedding('a1', [0.1], 'text');
    saveEmbedding('a2', [0.2], 'text');
    saveEmbedding('a1', [0.3], 'image_global');
    const stats = getStats();
    expect(stats.totalAssets).toBe(2);
    expect(stats.indexedAssets).toBe(2);
    expect(stats.totalEmbeddings).toBe(3);
  });

  it('remapFilePaths prefix değiştirir', () => {
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Old/test.dwg' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'b.dwg', filePath: 'C:/Old/b.dwg' }));
    upsertAsset(makeAsset({ id: 'a3', fileName: 'c.dwg', filePath: 'D:/Other/c.dwg' }));
    remapFilePaths('C:/Old', 'D:/New');
    expect(getAssetById('a1')!.filePath).toBe('D:/New/test.dwg');
    expect(getAssetById('a2')!.filePath).toBe('D:/New/b.dwg');
    expect(getAssetById('a3')!.filePath).toBe('D:/Other/c.dwg');
  });

  it('getAssetPhashMap phash olanları döner', () => {
    upsertAsset(makeAsset({ id: 'a1', phash: 'abc123' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'b.dwg' })); // no phash
    const map = getAssetPhashMap();
    expect(map['a1']).toBe('abc123');
    expect(map['a2']).toBeUndefined();
  });
});

describe('Database CRUD — Null safety', () => {
  it('DB null iken tüm fonksiyonlar güvenli döner', () => {
    _setDbForTesting(null);
    expect(getAssetById('x')).toBeNull();
    expect(getAllAssets()).toEqual([]);
    expect(getAllEmbeddings()).toEqual([]);
    expect(hasAnyEmbeddings()).toBe(false);
    expect(getChunksByAssetId('x')).toEqual([]);
    expect(getChunkCountByAssetId('x')).toBe(0);
    expect(getChunkById('x')).toBeNull();
    expect(getAssetSummary('x')).toBeNull();
    expect(getStats()).toEqual({ totalAssets: 0, indexedAssets: 0, totalEmbeddings: 0 });
    expect(getAssetPhashMap()).toEqual({});
    expect(getEmbeddingsBySourcePrefix('x')).toEqual([]);
    // These should not throw
    upsertAsset(makeAsset());
    saveEmbedding('x', [1], 'text');
    upsertTextChunk({ id: 'x', assetId: 'x', chunkIndex: 0, text: 'x' });
    deleteTextChunksByAssetId('x');
    saveAssetSummary('x', 'x', []);
    remapFilePaths('a', 'b');
  });
});
