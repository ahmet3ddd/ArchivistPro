/**
 * Veritabanı Bütünlük Testleri
 *
 * Şema doğrulaması, tablo varlığı, migration güvenliği,
 * foreign key kısıtlamaları, büyük veri dayanıklılığı.
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
  getAssetById,
  getAllAssets,
  deleteAsset,
  getStats,
  saveEmbedding,
  getAllEmbeddings,
  upsertTextChunk,
  getChunksByAssetId,
  saveAssetSummary,
  getAssetSummary,
  remapFilePaths,
  _setDbForTesting,
} from '../services/database';

/* ── Helper ── */

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
   1. Şema Doğrulaması — Tüm Tablolar
   ═══════════════════════════════════════════════════════════ */

describe('DB Şema — Tablo varlığı', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
  });

  afterEach(() => { db.close(); });

  const EXPECTED_TABLES = [
    'assets', 'embeddings', 'text_chunks', 'asset_summaries',
    'projects', 'scan_log', 'audit_log', 'tags', 'asset_tags',
    'favorites', 'collections', 'collection_items', 'scanned_roots',
    'root_groups', 'root_tags', 'user_messages', 'users',
    'app_settings', 'asset_relations', 'chat_sessions', 'chat_messages',
    // v2.4.8+: dwg_shapes ayrı DB dosyasında (archivist_shapes*.db, Rust shapes_db) — ana şemada değil
  ];

  it(`en az ${EXPECTED_TABLES.length} tablo mevcut olmalı`, () => {
    const result = db.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    const tables = result[0]?.values.map((r: any[]) => r[0]) || [];
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('assets tablosu tüm kritik sütunlara sahip', () => {
    const result = db.exec("PRAGMA table_info('assets')");
    const columns = result[0]?.values.map((r: any[]) => r[1]) || [];
    const required = [
      'id', 'file_name', 'file_path', 'file_size', 'file_type',
      'category', 'created_at', 'modified_at', 'project_name',
      'metadata_json', 'ai_tags_json', 'hash', 'phash', 'fs_mtime',
    ];
    for (const col of required) {
      expect(columns).toContain(col);
    }
  });

  it('users tablosu gerekli sütunlara sahip', () => {
    const result = db.exec("PRAGMA table_info('users')");
    const columns = result[0]?.values.map((r: any[]) => r[1]) || [];
    expect(columns).toContain('id');
    expect(columns).toContain('username');
    expect(columns).toContain('password_hash');
    expect(columns).toContain('role');
  });

  it('embeddings tablosu foreign key ile assets\'e bağlı', () => {
    const result = db.exec("PRAGMA foreign_key_list('embeddings')");
    const fks = result[0]?.values || [];
    const assetFk = fks.find((r: any[]) => r[2] === 'assets');
    expect(assetFk).toBeDefined();
  });

  it('text_chunks tablosu foreign key ile assets\'e bağlı', () => {
    const result = db.exec("PRAGMA foreign_key_list('text_chunks')");
    const fks = result[0]?.values || [];
    const assetFk = fks.find((r: any[]) => r[2] === 'assets');
    expect(assetFk).toBeDefined();
  });

  it('foreign keys aktif (PRAGMA foreign_keys)', () => {
    const result = db.exec('PRAGMA foreign_keys');
    const value = result[0]?.values[0][0];
    expect(value).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════
   2. Migration Güvenliği
   ═══════════════════════════════════════════════════════════ */

describe('DB Migration — İdempotent çalışma', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('veri kaybı olmadan migration tekrar çalıştırılabilir', async () => {
    // Önce veri ekle
    upsertAsset(makeAsset({ id: 'pre-migration' }));

    // Migration'ı tekrar çalıştır (createTestDatabase zaten çalıştırdı)
    const { _applyMigrationsForTesting } = await import('../services/database');
    _applyMigrationsForTesting(db);

    // Veri hâlâ sağlam
    const asset = getAssetById('pre-migration');
    expect(asset).not.toBeNull();
    expect(asset!.fileName).toBe('test.dwg');
  });

  it('legacy dwg_shapes tablosu migration ile kaldırılır (v2.4.8 ayrı-DB temizliği)', async () => {
    // Pre-2.4.8 arşiv simülasyonu: ana DB'de artık kullanılmayan ölü dwg_shapes
    db.run(`CREATE TABLE dwg_shapes (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, area REAL)`);
    db.run(`CREATE INDEX idx_dwg_shapes_asset_id ON dwg_shapes(asset_id)`);
    db.run(`INSERT INTO dwg_shapes (id, asset_id, area) VALUES ('s1','a1',1.0),('s2','a1',2.0)`);
    upsertAsset(makeAsset({ id: 'keep-me' }));

    const before = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='dwg_shapes'`);
    expect(before.length > 0 && before[0].values.length > 0).toBe(true);

    const { _applyMigrationsForTesting } = await import('../services/database');
    _applyMigrationsForTesting(db);

    // Ölü tablo + index kaldırıldı
    const afterTbl = db.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name='dwg_shapes'`);
    expect(afterTbl.length === 0 || afterTbl[0].values.length === 0).toBe(true);
    const afterIdx = db.exec(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_dwg_shapes_asset_id'`);
    expect(afterIdx.length === 0 || afterIdx[0].values.length === 0).toBe(true);
    // Veri kaybı yok — normal asset duruyor
    expect(getAssetById('keep-me')).not.toBeNull();
    // İdempotent: tablo yokken tekrar çalışınca patlamaz / VACUUM tetiklenmez
    expect(() => _applyMigrationsForTesting(db)).not.toThrow();
  });
});

/* ═══════════════════════════════════════════════════════════
   3. Foreign Key Kısıtlamaları
   ═══════════════════════════════════════════════════════════ */

describe('DB — Foreign key kısıtlamaları', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('asset silindiğinde embedding\'leri cascade silinir', () => {
    upsertAsset(makeAsset({ id: 'cascade_test' }));
    saveEmbedding('cascade_test', [0.1, 0.2, 0.3], 'text');

    const before = getAllEmbeddings();
    expect(before.some(e => e.assetId === 'cascade_test')).toBe(true);

    deleteAsset('cascade_test');

    const after = getAllEmbeddings();
    expect(after.some(e => e.assetId === 'cascade_test')).toBe(false);
  });

  it('asset silindiğinde text_chunks cascade silinir', () => {
    upsertAsset(makeAsset({ id: 'chunk_test' }));
    upsertTextChunk({
      id: 'c1',
      assetId: 'chunk_test',
      chunkIndex: 0,
      text: 'test içerik',
    });

    expect(getChunksByAssetId('chunk_test')).toHaveLength(1);
    deleteAsset('chunk_test');
    expect(getChunksByAssetId('chunk_test')).toHaveLength(0);
  });

  it('asset silindiğinde summary cascade silinir', () => {
    upsertAsset(makeAsset({ id: 'summary_test' }));
    saveAssetSummary('summary_test', 'özet', ['anahtar1'], 'model1');
    expect(getAssetSummary('summary_test')).not.toBeNull();
    deleteAsset('summary_test');
    expect(getAssetSummary('summary_test')).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════
   4. İstatistik Doğrulaması
   ═══════════════════════════════════════════════════════════ */

describe('DB — getStats doğruluğu', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('boş DB\'de stats sıfır döner', () => {
    const stats = getStats();
    expect(stats.totalAssets).toBe(0);
  });

  it('asset eklendikçe stats güncellenir', () => {
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertAsset(makeAsset({ id: 'a2', category: 'Render' }));
    upsertAsset(makeAsset({ id: 'a3', category: 'Render' }));
    const stats = getStats();
    expect(stats.totalAssets).toBe(3);
  });
});

/* ═══════════════════════════════════════════════════════════
   5. Veri Yolu Yeniden Eşleme
   ═══════════════════════════════════════════════════════════ */

describe('DB — remapFilePaths', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'r1', filePath: 'D:/Old/Project/file1.dwg' }));
    upsertAsset(makeAsset({ id: 'r2', filePath: 'D:/Old/Project/sub/file2.dwg' }));
    upsertAsset(makeAsset({ id: 'r3', filePath: 'E:/Other/file3.dwg' }));
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('eski yol yeni yol ile değiştirilir', () => {
    remapFilePaths('D:/Old/Project', 'C:/New/Project');
    expect(getAssetById('r1')!.filePath).toBe('C:/New/Project/file1.dwg');
    expect(getAssetById('r2')!.filePath).toBe('C:/New/Project/sub/file2.dwg');
  });

  it('eşleşmeyen yollar değişmez', () => {
    remapFilePaths('D:/Old/Project', 'C:/New/Project');
    expect(getAssetById('r3')!.filePath).toBe('E:/Other/file3.dwg');
  });
});

/* ═══════════════════════════════════════════════════════════
   6. Büyük Veri Dayanıklılığı
   ═══════════════════════════════════════════════════════════ */

describe('DB — Büyük veri dayanıklılığı', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => { _setDbForTesting(null); db.close(); });

  it('500 asset batch insert', () => {
    for (let i = 0; i < 500; i++) {
      upsertAsset(makeAsset({
        id: `batch_${i}`,
        fileName: `file_${i}.dwg`,
        filePath: `C:/Batch/file_${i}.dwg`,
      }));
    }
    expect(getAllAssets()).toHaveLength(500);
  });

  it('çok uzun metadata JSON kaydedilir', () => {
    const bigMeta = { layers: Array.from({ length: 100 }, (_, i) => `Layer_${i}`) };
    upsertAsset(makeAsset({
      id: 'bigmeta',
      metadata: bigMeta,
    }));
    const asset = getAssetById('bigmeta');
    expect(asset!.metadata.layers).toHaveLength(100);
  });
});
