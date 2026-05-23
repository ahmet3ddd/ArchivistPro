import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}));

// Mock permissions — admin role enables write access
vi.mock('../permissions/roles', () => ({
  getAppRole: vi.fn(() => 'admin'),
}));

// Mock logger
vi.mock('./logger', () => ({
  auditLog: vi.fn(),
  setLoggerDb: vi.fn(),
  debugLog: vi.fn(),
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

// Mock rootTagService
vi.mock('./rootTagService', () => ({
  setRootTagDb: vi.fn(),
}));

import {
  upsertAsset,
  getAssetById,
  getAllAssets,
  deleteAsset,
  saveEmbedding,
  saveChunkEmbedding,
  upsertTextChunk,
  getChunksByAssetId,
  deleteTextChunksByAssetId,
  saveAssetSummary,
  // Trash (soft delete)
  softDeleteAsset,
  restoreAsset,
  getDeletedAssets,
  getTrashCount,
  permanentlyDeleteAsset,
  emptyTrashDb,
  // Asset relations
  addAssetRelation,
  removeAssetRelation,
  getRelationsForAsset,
  detectAndSaveSameStemRelations,
  // Asset fields
  updateAssetFields,
  // Scanned roots
  addScannedRoot,
  removeScannedRoot,
  reactivateScannedRoot,
  deleteScannedRootWithAssets,
  getScannedRoots,
  getScannedRootForPath,
  getScannedRootByExactPath,
  renameScannedRoot,
  updateRootScanInfo,
  getAssetCountByRoot,
  // Root groups
  createRootGroup,
  recreateRootGroup,
  getRootGroups,
  renameRootGroup,
  updateRootGroupColor,
  deleteRootGroup,
  setRootGroup,
  setRootFavorite,
  snapshotRootGroup,
  restoreRootGroup,
  // Snapshot / restore
  snapshotScannedRootWithAssets,
  restoreScannedRootWithAssets,
  // FTS / chunk embeddings
  insertFtsChunk,
  ftsSearchChunks,
  deleteFtsChunksByAssetId,
  getChunkEmbeddingsByIds,
  getChunkEmbeddingsByAssetIds,
  // Folder trash (soft delete v2)
  softDeleteScannedRootWithAssets,
  restoreScannedRootFromTrash,
  getDeletedRoots,
  purgeExpiredTrash,
  // Settings
  getSetting,
  setSetting,
  // Utility
  getDatabase,
  clearAssetsUnderPath,
  getBackupsForAsset,
  getAllBackupAssets,
  searchTextChunksByKeyword,
  getEmbeddingCount,
  getAllChunkEmbeddings,
  getChunksByIds,
  deleteChunkEmbeddingsByAssetId,
  updateAssetRagStatus,
  // Archive utils
  unloadArchive,
  getArchiveSnapshot,
  setActiveArchive,
  getActiveArchive,
  isArchiveReady,
  isLocalDbReady,
  getAllAssetsFromArchive,
  assetExistsInArchive,
  getAllEmbeddingsFromArchive,
  getAllTextChunksFromArchive,
  getAllAssetSummariesFromArchive,
  getAllTagDataFromArchive,
  // withArchive
  withArchive,
  setArchiveRegistry,
  getArchiveDef,
  // Test helpers
  _setDbForTesting,
  MAIN_ARCHIVE_ID,
} from '../services/database';

import type { Asset } from '../types';

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

/* ══════════════════════════════════════════════════════════════
   1. Soft Delete / Trash (Asset-level)
   ══════════════════════════════════════════════════════════════ */
describe('Soft Delete — Asset Trash', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('softDeleteAsset moves asset to trash', () => {
    upsertAsset(makeAsset());
    expect(softDeleteAsset('a1')).toBe(true);
    // Soft-deleted asset should not appear in getAllAssets
    expect(getAllAssets()).toHaveLength(0);
    // But should appear in getDeletedAssets
    expect(getDeletedAssets()).toHaveLength(1);
    expect(getDeletedAssets()[0].id).toBe('a1');
  });

  it('restoreAsset brings back soft-deleted asset', () => {
    upsertAsset(makeAsset());
    softDeleteAsset('a1');
    expect(restoreAsset('a1')).toBe(true);
    expect(getAllAssets()).toHaveLength(1);
    expect(getDeletedAssets()).toHaveLength(0);
  });

  it('getTrashCount returns correct count', () => {
    expect(getTrashCount()).toBe(0);
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'b.dwg' }));
    softDeleteAsset('a1');
    expect(getTrashCount()).toBe(1);
    softDeleteAsset('a2');
    expect(getTrashCount()).toBe(2);
  });

  it('permanentlyDeleteAsset removes all related data', () => {
    upsertAsset(makeAsset());
    saveEmbedding('a1', [0.1, 0.2], 'text');
    upsertTextChunk({ id: 'a1_c0', assetId: 'a1', chunkIndex: 0, text: 'hello' });
    saveAssetSummary('a1', 'Test summary', ['key1']);
    softDeleteAsset('a1');
    expect(permanentlyDeleteAsset('a1')).toBe(true);
    expect(getAssetById('a1')).toBeNull();
    expect(getDeletedAssets()).toHaveLength(0);
    expect(getTrashCount()).toBe(0);
  });

  it('emptyTrashDb removes all trashed assets', () => {
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'b.dwg' }));
    upsertAsset(makeAsset({ id: 'a3', fileName: 'c.dwg' }));
    softDeleteAsset('a1');
    softDeleteAsset('a2');
    const count = emptyTrashDb();
    expect(count).toBe(2);
    expect(getTrashCount()).toBe(0);
    // a3 should still exist
    expect(getAllAssets()).toHaveLength(1);
    expect(getAllAssets()[0].id).toBe('a3');
  });

  it('emptyTrashDb returns 0 when trash is empty', () => {
    expect(emptyTrashDb()).toBe(0);
  });

  it('softDeleteAsset returns false when db is null', () => {
    _setDbForTesting(null);
    expect(softDeleteAsset('x')).toBe(false);
  });

  it('restoreAsset returns false when db is null', () => {
    _setDbForTesting(null);
    expect(restoreAsset('x')).toBe(false);
  });

  it('getDeletedAssets returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getDeletedAssets()).toEqual([]);
  });

  it('getTrashCount returns 0 when db is null', () => {
    _setDbForTesting(null);
    expect(getTrashCount()).toBe(0);
  });

  it('permanentlyDeleteAsset returns false when db is null', () => {
    _setDbForTesting(null);
    expect(permanentlyDeleteAsset('x')).toBe(false);
  });

  it('emptyTrashDb returns 0 when db is null', () => {
    _setDbForTesting(null);
    expect(emptyTrashDb()).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   2. Asset Relations
   ══════════════════════════════════════════════════════════════ */
describe('Asset Relations', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Projects/plan.dwg' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'plan.pdf', filePath: 'C:/Projects/plan.pdf', fileType: 'PDF' }));
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('addAssetRelation creates a relation', () => {
    const rel = addAssetRelation({
      sourceId: 'a1',
      targetId: 'a2',
      relationType: 'pdf_export',
      createdAt: '2024-01-01T00:00:00Z',
      createdBy: 'user',
    });
    expect(rel).not.toBeNull();
    expect(rel!.id).toBe('a1:a2:pdf_export');
  });

  it('getRelationsForAsset returns relations for both source and target', () => {
    addAssetRelation({
      sourceId: 'a1',
      targetId: 'a2',
      relationType: 'pdf_export',
      createdAt: '2024-01-01T00:00:00Z',
      createdBy: 'user',
    });
    const rels1 = getRelationsForAsset('a1');
    const rels2 = getRelationsForAsset('a2');
    expect(rels1).toHaveLength(1);
    expect(rels2).toHaveLength(1);
    expect(rels1[0].relationType).toBe('pdf_export');
  });

  it('removeAssetRelation deletes the relation', () => {
    addAssetRelation({
      sourceId: 'a1',
      targetId: 'a2',
      relationType: 'pdf_export',
      createdAt: '2024-01-01T00:00:00Z',
      createdBy: 'user',
    });
    removeAssetRelation('a1:a2:pdf_export');
    expect(getRelationsForAsset('a1')).toHaveLength(0);
  });

  it('addAssetRelation returns null when db is null', () => {
    _setDbForTesting(null);
    const rel = addAssetRelation({
      sourceId: 'a1',
      targetId: 'a2',
      relationType: 'pdf_export',
      createdAt: '2024-01-01T00:00:00Z',
      createdBy: 'user',
    });
    expect(rel).toBeNull();
  });

  it('getRelationsForAsset returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getRelationsForAsset('a1')).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════
   3. detectAndSaveSameStemRelations
   ══════════════════════════════════════════════════════════════ */
describe('detectAndSaveSameStemRelations', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('detects DWG→PDF relationship', () => {
    upsertAsset(makeAsset({ id: 'a1', fileName: 'plan.dwg', filePath: 'C:/Project/plan.dwg', fileType: 'DWG' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'plan.pdf', filePath: 'C:/Project/plan.pdf', fileType: 'PDF' }));
    const assets = [getAssetById('a1')!, getAssetById('a2')!];
    const count = detectAndSaveSameStemRelations(assets);
    expect(count).toBe(1);
    const rels = getRelationsForAsset('a1');
    expect(rels).toHaveLength(1);
    expect(rels[0].relationType).toBe('pdf_export');
  });

  it('detects 3D model → render relationship', () => {
    upsertAsset(makeAsset({ id: 'm1', fileName: 'scene.max', filePath: 'C:/Project/scene.max', fileType: 'MAX' }));
    upsertAsset(makeAsset({ id: 'r1', fileName: 'scene.png', filePath: 'C:/Project/scene.png', fileType: 'PNG' }));
    const assets = [getAssetById('m1')!, getAssetById('r1')!];
    const count = detectAndSaveSameStemRelations(assets);
    expect(count).toBe(1);
    const rels = getRelationsForAsset('m1');
    expect(rels[0].relationType).toBe('render_of');
  });

  it('does not create duplicate relations', () => {
    upsertAsset(makeAsset({ id: 'a1', fileName: 'plan.dwg', filePath: 'C:/Project/plan.dwg', fileType: 'DWG' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'plan.pdf', filePath: 'C:/Project/plan.pdf', fileType: 'PDF' }));
    const assets = [getAssetById('a1')!, getAssetById('a2')!];
    detectAndSaveSameStemRelations(assets);
    const count2 = detectAndSaveSameStemRelations(assets);
    expect(count2).toBe(0);
  });

  it('returns 0 when db is null', () => {
    _setDbForTesting(null);
    expect(detectAndSaveSameStemRelations([])).toBe(0);
  });

  it('returns 0 for assets in different directories', () => {
    upsertAsset(makeAsset({ id: 'a1', fileName: 'plan.dwg', filePath: 'C:/Dir1/plan.dwg', fileType: 'DWG' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'plan.pdf', filePath: 'C:/Dir2/plan.pdf', fileType: 'PDF' }));
    const assets = [getAssetById('a1')!, getAssetById('a2')!];
    const count = detectAndSaveSameStemRelations(assets);
    expect(count).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   4. updateAssetFields
   ══════════════════════════════════════════════════════════════ */
describe('updateAssetFields', () => {
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

  it('updates clientName field', () => {
    updateAssetFields('a1', { clientName: 'Acme Corp' });
    const asset = getAssetById('a1');
    expect(asset!.clientName).toBe('Acme Corp');
  });

  it('updates approvalStatus', () => {
    updateAssetFields('a1', { approvalStatus: 'approved' });
    const asset = getAssetById('a1');
    expect(asset!.approvalStatus).toBe('approved');
  });

  it('updates versionLabel and deadline', () => {
    updateAssetFields('a1', { versionLabel: 'v2.1', deadline: '2025-12-31' });
    const asset = getAssetById('a1');
    expect(asset!.versionLabel).toBe('v2.1');
    expect(asset!.deadline).toBe('2025-12-31');
  });

  it('clears field with null', () => {
    updateAssetFields('a1', { clientName: 'Test' });
    updateAssetFields('a1', { clientName: null });
    const asset = getAssetById('a1');
    expect(asset!.clientName).toBeUndefined();
  });

  it('no-op when no fields provided', () => {
    // Should not throw
    updateAssetFields('a1', {});
    expect(getAssetById('a1')).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   5. Scanned Roots
   ══════════════════════════════════════════════════════════════ */
describe('Scanned Roots CRUD', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('addScannedRoot creates a root and returns id', () => {
    const id = addScannedRoot('C:/Projects', 'My Projects');
    expect(id).toBeTruthy();
    const roots = getScannedRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].path).toBe('C:/Projects');
    expect(roots[0].label).toBe('My Projects');
    expect(roots[0].status).toBe('active');
  });

  it('addScannedRoot uses basename as default label', () => {
    addScannedRoot('C:/Work/Architecture');
    const roots = getScannedRoots();
    expect(roots[0].label).toBe('Architecture');
  });

  it('addScannedRoot with duplicate path returns existing id', () => {
    const id1 = addScannedRoot('C:/Projects');
    const id2 = addScannedRoot('C:/Projects');
    expect(id2).toBe(id1);
  });

  it('removeScannedRoot soft-removes the root', () => {
    const id = addScannedRoot('C:/Projects');
    removeScannedRoot(id);
    // getScannedRoots only shows active roots
    expect(getScannedRoots()).toHaveLength(0);
  });

  it('reactivateScannedRoot brings back removed root', () => {
    const id = addScannedRoot('C:/Projects');
    removeScannedRoot(id);
    reactivateScannedRoot(id);
    expect(getScannedRoots()).toHaveLength(1);
  });

  it('renameScannedRoot changes label', () => {
    const id = addScannedRoot('C:/Projects', 'Old Name');
    renameScannedRoot(id, 'New Name');
    const roots = getScannedRoots();
    expect(roots[0].label).toBe('New Name');
  });

  it('updateRootScanInfo updates last_scan and file_count', () => {
    const id = addScannedRoot('C:/Projects');
    updateRootScanInfo(id, 42);
    const roots = getScannedRoots();
    expect(roots[0].lastScan).toBeTruthy();
  });

  it('getScannedRootForPath returns best match (longest prefix)', () => {
    addScannedRoot('C:/Projects');
    addScannedRoot('C:/Projects/SubDir');
    const match = getScannedRootForPath('C:/Projects/SubDir/file.dwg');
    expect(match).not.toBeNull();
    expect(match!.path).toBe('C:/Projects/SubDir');
  });

  it('getScannedRootForPath returns null for unmatched path', () => {
    addScannedRoot('C:/Projects');
    expect(getScannedRootForPath('D:/Other/file.dwg')).toBeNull();
  });

  it('getScannedRootByExactPath returns matching root', () => {
    addScannedRoot('C:/Projects');
    const root = getScannedRootByExactPath('C:/Projects');
    expect(root).not.toBeNull();
    expect(root!.path).toBe('C:/Projects');
  });

  it('getScannedRootByExactPath returns null for non-existing path', () => {
    expect(getScannedRootByExactPath('C:/NoSuchPath')).toBeNull();
  });

  it('getAssetCountByRoot counts assets under root path', () => {
    addScannedRoot('C:/Projects');
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Projects/file1.dwg' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'file2.dwg', filePath: 'C:/Projects/sub/file2.dwg' }));
    upsertAsset(makeAsset({ id: 'a3', fileName: 'other.dwg', filePath: 'D:/Other/other.dwg' }));
    const count = getAssetCountByRoot('C:/Projects');
    expect(count).toBe(2);
  });

  it('getAssetCountByRoot returns 0 when db is null', () => {
    _setDbForTesting(null);
    expect(getAssetCountByRoot('C:/Projects')).toBe(0);
  });

  it('getScannedRoots returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getScannedRoots()).toEqual([]);
  });

  it('getScannedRootForPath returns null when db is null', () => {
    _setDbForTesting(null);
    expect(getScannedRootForPath('C:/x')).toBeNull();
  });

  it('getScannedRootByExactPath returns null when db is null', () => {
    _setDbForTesting(null);
    expect(getScannedRootByExactPath('C:/x')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   6. deleteScannedRootWithAssets
   ══════════════════════════════════════════════════════════════ */
describe('deleteScannedRootWithAssets', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('deletes root and its assets permanently', () => {
    const rootId = addScannedRoot('C:/Projects');
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Projects/file1.dwg' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'f2.dwg', filePath: 'C:/Projects/sub/f2.dwg' }));
    upsertAsset(makeAsset({ id: 'a3', fileName: 'other.dwg', filePath: 'D:/Other/other.dwg' }));

    const deleted = deleteScannedRootWithAssets(rootId);
    expect(deleted).toBe(2);
    expect(getAssetById('a1')).toBeNull();
    expect(getAssetById('a2')).toBeNull();
    // Asset outside root should survive
    expect(getAssetById('a3')).not.toBeNull();
    expect(getScannedRoots()).toHaveLength(0);
  });

  it('returns 0 for non-existing root', () => {
    expect(deleteScannedRootWithAssets('nonexistent')).toBe(0);
  });

  it('returns 0 when db is null', () => {
    _setDbForTesting(null);
    expect(deleteScannedRootWithAssets('x')).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   7. Snapshot & Restore Scanned Root
   ══════════════════════════════════════════════════════════════ */
describe('snapshotScannedRootWithAssets & restoreScannedRootWithAssets', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('snapshot captures root and assets, restore brings them back', async () => {
    const rootId = addScannedRoot('C:/Projects');
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Projects/file1.dwg' }));

    const snap = await snapshotScannedRootWithAssets(rootId);
    expect(snap).not.toBeNull();
    expect(snap!.root.id).toBe(rootId);
    expect(snap!.assets).toHaveLength(1);

    // Delete root + assets
    deleteScannedRootWithAssets(rootId);
    expect(getScannedRoots()).toHaveLength(0);
    expect(getAssetById('a1')).toBeNull();

    // Restore
    await restoreScannedRootWithAssets(snap!);
    expect(getScannedRoots()).toHaveLength(1);
    expect(getAssetById('a1')).not.toBeNull();
  });

  it('snapshot returns null for non-existing root', async () => {
    expect(await snapshotScannedRootWithAssets('nonexistent')).toBeNull();
  });

  it('snapshot with no assets under root returns empty arrays', async () => {
    const rootId = addScannedRoot('C:/Empty');
    const snap = await snapshotScannedRootWithAssets(rootId);
    expect(snap).not.toBeNull();
    expect(snap!.assets).toHaveLength(0);
    expect(snap!.embeddings).toHaveLength(0);
  });

  it('snapshot returns null when db is null', async () => {
    _setDbForTesting(null);
    expect(await snapshotScannedRootWithAssets('x')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   8. Root Groups
   ══════════════════════════════════════════════════════════════ */
describe('Root Groups CRUD', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('createRootGroup creates a group and returns id', () => {
    const id = createRootGroup('Architecture');
    expect(id).toBeTruthy();
    const groups = getRootGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('Architecture');
    expect(groups[0].color).toBe('#6366f1');
  });

  it('createRootGroup with custom color', () => {
    createRootGroup('Interior', '#ff0000');
    const groups = getRootGroups();
    expect(groups[0].color).toBe('#ff0000');
  });

  it('recreateRootGroup creates with specific id', () => {
    recreateRootGroup('fixed-id', 'Restored Group', '#00ff00', 5);
    const groups = getRootGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].id).toBe('fixed-id');
    expect(groups[0].sortOrder).toBe(5);
  });

  it('renameRootGroup changes group name', () => {
    const id = createRootGroup('Old');
    renameRootGroup(id, 'New Name');
    const groups = getRootGroups();
    expect(groups[0].name).toBe('New Name');
  });

  it('updateRootGroupColor changes group color', () => {
    const id = createRootGroup('Test');
    updateRootGroupColor(id, '#abcdef');
    const groups = getRootGroups();
    expect(groups[0].color).toBe('#abcdef');
  });

  it('deleteRootGroup removes group, keeps roots', () => {
    const gid = createRootGroup('ToDelete');
    const rid = addScannedRoot('C:/Projects');
    setRootGroup(rid, gid);
    deleteRootGroup(gid);
    expect(getRootGroups()).toHaveLength(0);
    // Root should still exist but without group
    const roots = getScannedRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].groupId).toBeNull();
  });

  it('setRootGroup assigns root to group', () => {
    const gid = createRootGroup('MyGroup');
    const rid = addScannedRoot('C:/Projects');
    setRootGroup(rid, gid);
    const roots = getScannedRoots();
    expect(roots[0].groupId).toBe(gid);
  });

  it('setRootGroup with null removes from group', () => {
    const gid = createRootGroup('MyGroup');
    const rid = addScannedRoot('C:/Projects');
    setRootGroup(rid, gid);
    setRootGroup(rid, null);
    const roots = getScannedRoots();
    expect(roots[0].groupId).toBeNull();
  });

  it('setRootFavorite toggles favorite status', () => {
    const rid = addScannedRoot('C:/Projects');
    setRootFavorite(rid, true);
    let roots = getScannedRoots();
    expect(roots[0].isFavorite).toBe(true);
    setRootFavorite(rid, false);
    roots = getScannedRoots();
    expect(roots[0].isFavorite).toBe(false);
  });

  it('getRootGroups returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getRootGroups()).toEqual([]);
  });

  it('groups are ordered by sort_order', () => {
    createRootGroup('B');
    createRootGroup('A');
    createRootGroup('C');
    const groups = getRootGroups();
    expect(groups).toHaveLength(3);
    // sort_order is assigned incrementally
    expect(groups[0].sortOrder).toBeLessThan(groups[1].sortOrder);
    expect(groups[1].sortOrder).toBeLessThan(groups[2].sortOrder);
  });
});

/* ══════════════════════════════════════════════════════════════
   9. snapshotRootGroup & restoreRootGroup
   ══════════════════════════════════════════════════════════════ */
describe('snapshotRootGroup & restoreRootGroup', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('snapshot and restore a root group with members', () => {
    const gid = createRootGroup('TestGroup', '#123456');
    const rid1 = addScannedRoot('C:/A');
    const rid2 = addScannedRoot('C:/B');
    setRootGroup(rid1, gid);
    setRootGroup(rid2, gid);

    const snap = snapshotRootGroup(gid);
    expect(snap).not.toBeNull();
    expect(snap!.group.name).toBe('TestGroup');
    expect(snap!.memberRootIds).toHaveLength(2);

    deleteRootGroup(gid);
    expect(getRootGroups()).toHaveLength(0);

    restoreRootGroup(snap!);
    const groups = getRootGroups();
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('TestGroup');
    // Member roots should be re-assigned
    const roots = getScannedRoots();
    const grouped = roots.filter(r => r.groupId === gid);
    expect(grouped).toHaveLength(2);
  });

  it('snapshotRootGroup returns null for non-existing group', () => {
    expect(snapshotRootGroup('nonexistent')).toBeNull();
  });

  it('snapshotRootGroup returns null when db is null', () => {
    _setDbForTesting(null);
    expect(snapshotRootGroup('x')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   10. Folder Trash (Soft Delete v2)
   ══════════════════════════════════════════════════════════════ */
describe('Folder Trash — softDeleteScannedRootWithAssets / restore / purge', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('softDeleteScannedRootWithAssets moves root and assets to trash', () => {
    const rootId = addScannedRoot('C:/Projects');
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Projects/file1.dwg' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'f2.dwg', filePath: 'C:/Projects/sub/f2.dwg' }));

    softDeleteScannedRootWithAssets(rootId);

    // Root should appear in deleted roots
    const deletedRoots = getDeletedRoots();
    expect(deletedRoots).toHaveLength(1);
    expect(deletedRoots[0].id).toBe(rootId);

    // Assets should be soft-deleted
    expect(getAllAssets()).toHaveLength(0);
    expect(getTrashCount()).toBe(2);

    // Active roots should not include it
    expect(getScannedRoots()).toHaveLength(0);
  });

  it('restoreScannedRootFromTrash restores root and assets', () => {
    const rootId = addScannedRoot('C:/Projects');
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Projects/file1.dwg' }));

    softDeleteScannedRootWithAssets(rootId);
    restoreScannedRootFromTrash(rootId);

    expect(getDeletedRoots()).toHaveLength(0);
    expect(getScannedRoots()).toHaveLength(1);
    expect(getAllAssets()).toHaveLength(1);
  });

  it('restoreScannedRootFromTrash does nothing for non-deleted root', () => {
    const rootId = addScannedRoot('C:/Projects');
    // root is not deleted — this should not throw
    restoreScannedRootFromTrash(rootId);
    expect(getScannedRoots()).toHaveLength(1);
  });

  it('getDeletedRoots returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getDeletedRoots()).toEqual([]);
  });

  it('purgeExpiredTrash removes old items', () => {
    upsertAsset(makeAsset({ id: 'a1' }));
    // Manually set deleted_at to 60 days ago
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    db.run('UPDATE assets SET is_deleted = 1, deleted_at = ? WHERE id = ?', [oldDate, 'a1']);

    const purged = purgeExpiredTrash(30);
    expect(purged).toBe(1);
    expect(getTrashCount()).toBe(0);
  });

  it('purgeExpiredTrash does not remove recent items', () => {
    upsertAsset(makeAsset({ id: 'a1' }));
    softDeleteAsset('a1');
    // Recently deleted — should not be purged
    const purged = purgeExpiredTrash(30);
    expect(purged).toBe(0);
    expect(getTrashCount()).toBe(1);
  });

  it('purgeExpiredTrash also removes old roots', () => {
    const rootId = addScannedRoot('C:/Projects');
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    db.run('UPDATE scanned_roots SET is_deleted = 1, deleted_at = ? WHERE id = ?', [oldDate, rootId]);

    const purged = purgeExpiredTrash(30);
    expect(purged).toBe(1);
  });

  it('purgeExpiredTrash returns 0 when db is null', () => {
    _setDbForTesting(null);
    expect(purgeExpiredTrash()).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   11. Settings (app_settings)
   ══════════════════════════════════════════════════════════════ */
describe('App Settings (getSetting / setSetting)', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('getSetting returns null for non-existing key', () => {
    expect(getSetting('nonexistent')).toBeNull();
  });

  it('setSetting and getSetting round-trip', () => {
    setSetting('theme', 'dark');
    expect(getSetting('theme')).toBe('dark');
  });

  it('setSetting overwrites existing value', () => {
    setSetting('lang', 'tr');
    setSetting('lang', 'en');
    expect(getSetting('lang')).toBe('en');
  });

  it('getSetting returns null when db is null', () => {
    _setDbForTesting(null);
    expect(getSetting('key')).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   12. clearAssetsUnderPath
   ══════════════════════════════════════════════════════════════ */
describe('clearAssetsUnderPath', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('deletes all assets under a root path', () => {
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Root/sub/file1.dwg' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'f2.dwg', filePath: 'C:/Root/file2.dwg' }));
    upsertAsset(makeAsset({ id: 'a3', fileName: 'other.dwg', filePath: 'D:/Other/other.dwg' }));

    const deleted = clearAssetsUnderPath('C:/Root');
    expect(deleted).toBe(2);
    expect(getAllAssets()).toHaveLength(1);
    expect(getAllAssets()[0].id).toBe('a3');
  });

  it('returns 0 when no matching assets', () => {
    upsertAsset(makeAsset({ id: 'a1', filePath: 'D:/Other/file.dwg' }));
    expect(clearAssetsUnderPath('C:/Root')).toBe(0);
  });

  it('returns 0 when db is null', () => {
    _setDbForTesting(null);
    expect(clearAssetsUnderPath('C:/Root')).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════
   13. Backup assets
   ══════════════════════════════════════════════════════════════ */
describe('Backup Assets', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('getAllBackupAssets returns BAK type files', () => {
    upsertAsset(makeAsset({ id: 'a1', fileName: 'plan.dwg', filePath: 'C:/P/plan.dwg', fileType: 'DWG' }));
    upsertAsset(makeAsset({ id: 'b1', fileName: 'plan.bak', filePath: 'C:/P/plan.bak', fileType: 'BAK' }));
    const backups = getAllBackupAssets();
    expect(backups).toHaveLength(1);
    expect(backups[0].id).toBe('b1');
  });

  it('getBackupsForAsset finds backups by same stem', () => {
    upsertAsset(makeAsset({ id: 'a1', fileName: 'plan.dwg', filePath: 'C:/P/plan.dwg', fileType: 'DWG' }));
    upsertAsset(makeAsset({ id: 'b1', fileName: 'plan.bak', filePath: 'C:/P/plan.bak', fileType: 'BAK' }));
    const backups = getBackupsForAsset('C:/P/plan.dwg');
    expect(backups).toHaveLength(1);
    expect(backups[0].id).toBe('b1');
  });

  it('getBackupsForAsset returns empty for no matches', () => {
    upsertAsset(makeAsset({ id: 'a1', fileName: 'plan.dwg', filePath: 'C:/P/plan.dwg', fileType: 'DWG' }));
    expect(getBackupsForAsset('C:/P/plan.dwg')).toHaveLength(0);
  });

  it('getAllBackupAssets returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getAllBackupAssets()).toEqual([]);
  });

  it('getBackupsForAsset returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getBackupsForAsset('C:/P/plan.dwg')).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════
   14. Text Chunk Search & RAG functions
   ══════════════════════════════════════════════════════════════ */
describe('searchTextChunksByKeyword', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'second.dwg' }));
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('finds asset ids by keyword in chunks', () => {
    upsertTextChunk({ id: 'c1', assetId: 'a1', chunkIndex: 0, text: 'mimari proje konsept tasarimi' });
    upsertTextChunk({ id: 'c2', assetId: 'a2', chunkIndex: 0, text: 'yapısal analiz raporu' });
    const results = searchTextChunksByKeyword('mimari');
    expect(results).toContain('a1');
    expect(results).not.toContain('a2');
  });

  it('returns empty for short query', () => {
    expect(searchTextChunksByKeyword('a')).toEqual([]);
  });

  it('returns empty for empty query', () => {
    expect(searchTextChunksByKeyword('')).toEqual([]);
  });

  it('returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(searchTextChunksByKeyword('test')).toEqual([]);
  });
});

describe('getChunksByIds', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertTextChunk({ id: 'c1', assetId: 'a1', chunkIndex: 0, text: 'chunk one' });
    upsertTextChunk({ id: 'c2', assetId: 'a1', chunkIndex: 1, text: 'chunk two' });
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('returns chunks with asset info', () => {
    const chunks = getChunksByIds(['c1', 'c2']);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].fileName).toBe('test.dwg');
    expect(chunks[0].text).toBe('chunk one');
  });

  it('returns empty for empty input', () => {
    expect(getChunksByIds([])).toEqual([]);
  });

  it('returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getChunksByIds(['c1'])).toEqual([]);
  });
});

describe('deleteChunkEmbeddingsByAssetId', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertTextChunk({ id: 'c1', assetId: 'a1', chunkIndex: 0, text: 'hello' });
    saveChunkEmbedding('a1', 'c1', [0.1, 0.2], 'chunk_text');
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('deletes chunk embeddings for an asset', () => {
    deleteChunkEmbeddingsByAssetId('a1');
    const embs = getAllChunkEmbeddings('chunk_text');
    expect(embs).toHaveLength(0);
  });

  it('does not throw when db is null', () => {
    _setDbForTesting(null);
    expect(() => deleteChunkEmbeddingsByAssetId('a1')).not.toThrow();
  });
});

describe('updateAssetRagStatus', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1' }));
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('updates rag_status to indexed', () => {
    updateAssetRagStatus('a1', 'indexed', 'all chunks processed');
    // Verify by reading raw DB
    const result = db.exec('SELECT rag_status, rag_status_reason FROM assets WHERE id = ?', ['a1']);
    expect(result[0].values[0][0]).toBe('indexed');
    expect(result[0].values[0][1]).toBe('all chunks processed');
  });

  it('updates rag_status to skipped', () => {
    updateAssetRagStatus('a1', 'skipped', 'binary file');
    const result = db.exec('SELECT rag_status FROM assets WHERE id = ?', ['a1']);
    expect(result[0].values[0][0]).toBe('skipped');
  });

  it('clears rag_status with null', () => {
    updateAssetRagStatus('a1', 'indexed');
    updateAssetRagStatus('a1', null);
    const result = db.exec('SELECT rag_status FROM assets WHERE id = ?', ['a1']);
    expect(result[0].values[0][0]).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════
   15. getEmbeddingCount & getAllChunkEmbeddings
   ══════════════════════════════════════════════════════════════ */
describe('getEmbeddingCount & getAllChunkEmbeddings', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1', fileType: 'DWG' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'photo.png', fileType: 'PNG' }));
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('getEmbeddingCount counts all embeddings', () => {
    expect(getEmbeddingCount()).toBe(0);
    saveEmbedding('a1', [0.1], 'text');
    saveEmbedding('a2', [0.2], 'image_global');
    expect(getEmbeddingCount()).toBe(2);
  });

  it('getEmbeddingCount returns 0 when db is null', () => {
    _setDbForTesting(null);
    expect(getEmbeddingCount()).toBe(0);
  });

  it('getAllChunkEmbeddings filters by source', () => {
    upsertTextChunk({ id: 'c1', assetId: 'a1', chunkIndex: 0, text: 'test' });
    saveChunkEmbedding('a1', 'c1', [0.1, 0.2], 'chunk_text');
    saveEmbedding('a1', [0.3], 'text');
    const chunkEmbs = getAllChunkEmbeddings('chunk_text');
    expect(chunkEmbs).toHaveLength(1);
    expect(chunkEmbs[0].chunkId).toBe('c1');
  });

  it('getAllChunkEmbeddings filters by allowedAssetTypes', () => {
    upsertTextChunk({ id: 'c1', assetId: 'a1', chunkIndex: 0, text: 'test' });
    upsertTextChunk({ id: 'c2', assetId: 'a2', chunkIndex: 0, text: 'test2' });
    saveChunkEmbedding('a1', 'c1', [0.1, 0.2], 'chunk_text');
    saveChunkEmbedding('a2', 'c2', [0.3, 0.4], 'chunk_text');
    const dwgOnly = getAllChunkEmbeddings('chunk_text', ['DWG']);
    expect(dwgOnly).toHaveLength(1);
    expect(dwgOnly[0].assetId).toBe('a1');
  });

  it('getAllChunkEmbeddings returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getAllChunkEmbeddings()).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════
   16. FTS / Chunk Embedding helpers
   ══════════════════════════════════════════════════════════════ */
describe('FTS chunk operations', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertTextChunk({ id: 'c1', assetId: 'a1', chunkIndex: 0, text: 'mimari proje detayi' });
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('insertFtsChunk does not throw', () => {
    expect(() => insertFtsChunk('c1', 'a1', 'mimari proje detayi')).not.toThrow();
  });

  it('deleteFtsChunksByAssetId does not throw', () => {
    insertFtsChunk('c1', 'a1', 'mimari proje detayi');
    expect(() => deleteFtsChunksByAssetId('a1')).not.toThrow();
  });

  it('insertFtsChunk does nothing when db is null', () => {
    _setDbForTesting(null);
    expect(() => insertFtsChunk('c1', 'a1', 'test')).not.toThrow();
  });

  it('deleteFtsChunksByAssetId does nothing when db is null', () => {
    _setDbForTesting(null);
    expect(() => deleteFtsChunksByAssetId('a1')).not.toThrow();
  });

  // Regresyon: FTS5 (ascii) 0 döndüğünde devreye giren fallback, eskiden
  // SQLite ASCII LOWER() kullandığı için Türkçe karakterli terimleri
  // (Ş/ş, ı, ç, ğ, ö, ü) kaçırırdı. Artık tr_norm SQL fonksiyonu ile
  // FTS index'iyle birebir aynı normalizasyon yapılıyor.
  it('ftsSearchChunks fallback Türkçe karakterli terimi bulur (tr_norm)', () => {
    // fts_chunks'a EKLEMEDEN ham metin → FTS5 MATCH 0 → fallback yolu.
    upsertTextChunk({ id: 'c_tr', assetId: 'a1', chunkIndex: 5, text: 'Proje sahibi Şenay Yılmaz — cephe görünüşü' });
    expect(ftsSearchChunks('Şenay').has('c_tr')).toBe(true);   // büyük harf + ş
    expect(ftsSearchChunks('şenay').has('c_tr')).toBe(true);   // küçük harf + ş
    expect(ftsSearchChunks('Yılmaz').has('c_tr')).toBe(true);  // ı (dotless i) — eski ASCII LOWER kaçırırdı
  });

  it('ftsSearchChunks fallback olmayan terimi eşleştirmez', () => {
    upsertTextChunk({ id: 'c_tr2', assetId: 'a1', chunkIndex: 6, text: 'Şenay Yılmaz' });
    expect(ftsSearchChunks('Mehmet').has('c_tr2')).toBe(false);
  });
});

describe('getChunkEmbeddingsByIds & getChunkEmbeddingsByAssetIds', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1' }));
    upsertTextChunk({ id: 'c1', assetId: 'a1', chunkIndex: 0, text: 'hello' });
    upsertTextChunk({ id: 'c2', assetId: 'a1', chunkIndex: 1, text: 'world' });
    saveChunkEmbedding('a1', 'c1', [0.1, 0.2, 0.3], 'chunk_text');
    saveChunkEmbedding('a1', 'c2', [0.4, 0.5, 0.6], 'chunk_text');
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('getChunkEmbeddingsByIds returns embeddings for given chunk IDs', () => {
    const results = getChunkEmbeddingsByIds(['c1']);
    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe('c1');
    expect(results[0].assetId).toBe('a1');
    expect(results[0].vector).toHaveLength(3);
  });

  it('getChunkEmbeddingsByIds returns empty for empty input', () => {
    expect(getChunkEmbeddingsByIds([])).toEqual([]);
  });

  it('getChunkEmbeddingsByIds returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getChunkEmbeddingsByIds(['c1'])).toEqual([]);
  });

  it('getChunkEmbeddingsByAssetIds returns embeddings for given asset IDs', () => {
    const results = getChunkEmbeddingsByAssetIds(['a1']);
    expect(results).toHaveLength(2);
    expect(results.every(r => r.assetId === 'a1')).toBe(true);
  });

  it('getChunkEmbeddingsByAssetIds returns empty for empty input', () => {
    expect(getChunkEmbeddingsByAssetIds([])).toEqual([]);
  });

  it('getChunkEmbeddingsByAssetIds returns empty when db is null', () => {
    _setDbForTesting(null);
    expect(getChunkEmbeddingsByAssetIds(['a1'])).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════
   17. Archive helpers (non-async, in-memory)
   ══════════════════════════════════════════════════════════════ */
describe('Archive helpers', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('getDatabase returns current db', () => {
    expect(getDatabase()).not.toBeNull();
  });

  it('getDatabase returns null after clearing', () => {
    _setDbForTesting(null);
    expect(getDatabase()).toBeNull();
  });

  it('isArchiveReady returns true for main', () => {
    expect(isArchiveReady(MAIN_ARCHIVE_ID)).toBe(true);
  });

  it('isArchiveReady returns false for unknown', () => {
    expect(isArchiveReady('nonexistent')).toBe(false);
  });

  it('isLocalDbReady returns false when local not loaded', () => {
    expect(isLocalDbReady()).toBe(false);
  });

  it('getActiveArchive returns current archive', () => {
    expect(getActiveArchive()).toBe(MAIN_ARCHIVE_ID);
  });

  it('unloadArchive for main is no-op', () => {
    unloadArchive(MAIN_ARCHIVE_ID);
    expect(isArchiveReady(MAIN_ARCHIVE_ID)).toBe(true);
  });

  it('getArchiveSnapshot returns Uint8Array for main', () => {
    const snapshot = getArchiveSnapshot(MAIN_ARCHIVE_ID);
    expect(snapshot).toBeInstanceOf(Uint8Array);
    expect(snapshot!.length).toBeGreaterThan(0);
  });

  it('getArchiveSnapshot returns null for unloaded archive', () => {
    expect(getArchiveSnapshot('nonexistent')).toBeNull();
  });

  it('setArchiveRegistry and getArchiveDef work', () => {
    setArchiveRegistry([
      { id: 'test', name: 'Test Archive', type: 'personal', createdAt: '2024-01-01' },
    ]);
    const def = getArchiveDef('test');
    expect(def).not.toBeUndefined();
    expect(def!.name).toBe('Test Archive');
    expect(getArchiveDef('nonexistent')).toBeUndefined();
    // Cleanup
    setArchiveRegistry([]);
  });
});

/* ══════════════════════════════════════════════════════════════
   18. Cross-archive queries (getAllAssetsFromArchive, etc.)
   ══════════════════════════════════════════════════════════════ */
describe('Cross-archive queries', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
    upsertAsset(makeAsset({ id: 'a1' }));
    saveEmbedding('a1', [0.1, 0.2], 'text');
    upsertTextChunk({ id: 'c1', assetId: 'a1', chunkIndex: 0, text: 'test chunk' });
    saveAssetSummary('a1', 'Summary text', ['key1', 'key2'], 'llama3');
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('getAllAssetsFromArchive returns assets from main', () => {
    const assets = getAllAssetsFromArchive(MAIN_ARCHIVE_ID);
    expect(assets).toHaveLength(1);
    expect(assets[0].id).toBe('a1');
  });

  it('getAllAssetsFromArchive returns empty for unloaded archive', () => {
    expect(getAllAssetsFromArchive('nonexistent')).toEqual([]);
  });

  it('assetExistsInArchive returns true for existing asset', () => {
    expect(assetExistsInArchive(MAIN_ARCHIVE_ID, 'a1')).toBe(true);
  });

  it('assetExistsInArchive returns false for non-existing asset', () => {
    expect(assetExistsInArchive(MAIN_ARCHIVE_ID, 'nonexistent')).toBe(false);
  });

  it('assetExistsInArchive returns false for unloaded archive', () => {
    expect(assetExistsInArchive('nonexistent', 'a1')).toBe(false);
  });

  it('getAllEmbeddingsFromArchive returns embeddings', () => {
    const embs = getAllEmbeddingsFromArchive(MAIN_ARCHIVE_ID);
    expect(embs).toHaveLength(1);
    expect(embs[0].assetId).toBe('a1');
    expect(embs[0].source).toBe('text');
  });

  it('getAllEmbeddingsFromArchive returns empty for unloaded archive', () => {
    expect(getAllEmbeddingsFromArchive('nonexistent')).toEqual([]);
  });

  it('getAllTextChunksFromArchive returns chunks', () => {
    const chunks = getAllTextChunksFromArchive(MAIN_ARCHIVE_ID);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe('test chunk');
  });

  it('getAllTextChunksFromArchive returns empty for unloaded archive', () => {
    expect(getAllTextChunksFromArchive('nonexistent')).toEqual([]);
  });

  it('getAllAssetSummariesFromArchive returns summaries', () => {
    const summaries = getAllAssetSummariesFromArchive(MAIN_ARCHIVE_ID);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].summary).toBe('Summary text');
    expect(summaries[0].keywords).toEqual(['key1', 'key2']);
    expect(summaries[0].model).toBe('llama3');
  });

  it('getAllAssetSummariesFromArchive returns empty for unloaded archive', () => {
    expect(getAllAssetSummariesFromArchive('nonexistent')).toEqual([]);
  });

  it('getAllTagDataFromArchive returns tag data', () => {
    // Insert a tag + asset_tag via raw SQL since tagService is mocked
    db.run("INSERT INTO tags (name, color) VALUES ('TestTag', '#ff0000')");
    const tagId = db.exec('SELECT id FROM tags WHERE name = ?', ['TestTag'])[0].values[0][0];
    db.run('INSERT INTO asset_tags (asset_id, tag_id) VALUES (?, ?)', ['a1', tagId]);

    const data = getAllTagDataFromArchive(MAIN_ARCHIVE_ID);
    expect(data.tags).toHaveLength(1);
    expect(data.tags[0].name).toBe('TestTag');
    expect(data.assetTags).toHaveLength(1);
    expect(data.assetTags[0].assetId).toBe('a1');
  });

  it('getAllTagDataFromArchive returns empty for unloaded archive', () => {
    const data = getAllTagDataFromArchive('nonexistent');
    expect(data.tags).toEqual([]);
    expect(data.assetTags).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════
   19. withArchive
   ══════════════════════════════════════════════════════════════ */
describe('withArchive', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('executes operation within target archive context', async () => {
    const result = await withArchive(MAIN_ARCHIVE_ID, () => {
      return getActiveArchive();
    });
    expect(result).toBe(MAIN_ARCHIVE_ID);
  });

  it('restores original archive after operation', async () => {
    const originalArchive = getActiveArchive();
    await withArchive(MAIN_ARCHIVE_ID, () => {
      // do something
    });
    expect(getActiveArchive()).toBe(originalArchive);
  });

  it('throws for unloaded archive', async () => {
    await expect(withArchive('nonexistent', () => {})).rejects.toThrow('Arşiv yüklü değil');
  });

  it('restores original archive even if operation throws', async () => {
    const originalArchive = getActiveArchive();
    try {
      await withArchive(MAIN_ARCHIVE_ID, () => {
        throw new Error('test error');
      });
    } catch {
      // expected
    }
    expect(getActiveArchive()).toBe(originalArchive);
  });
});

/* ══════════════════════════════════════════════════════════════
   20. Scanned Roots — live file count
   ══════════════════════════════════════════════════════════════ */
describe('getScannedRoots live file count', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    _setDbForTesting(db);
  });

  afterEach(() => {
    _setDbForTesting(null);
    db.close();
  });

  it('computes live file count excluding BAK files', () => {
    const rid = addScannedRoot('C:/Projects');
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Projects/file1.dwg', fileType: 'DWG' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'file.bak', filePath: 'C:/Projects/file.bak', fileType: 'BAK' }));

    const roots = getScannedRoots();
    expect(roots).toHaveLength(1);
    // BAK files should be excluded from live count
    expect(roots[0].fileCount).toBe(1);
  });

  it('assigns each asset to longest matching root', () => {
    addScannedRoot('C:/Projects');
    addScannedRoot('C:/Projects/SubDir');
    upsertAsset(makeAsset({ id: 'a1', filePath: 'C:/Projects/SubDir/file1.dwg', fileType: 'DWG' }));
    upsertAsset(makeAsset({ id: 'a2', fileName: 'f2.dwg', filePath: 'C:/Projects/other.dwg', fileType: 'DWG' }));

    const roots = getScannedRoots();
    const subDir = roots.find(r => r.path === 'C:/Projects/SubDir');
    const parent = roots.find(r => r.path === 'C:/Projects');
    expect(subDir!.fileCount).toBe(1);
    expect(parent!.fileCount).toBe(1);
  });

  it('returns 0 count when no assets exist', () => {
    addScannedRoot('C:/Empty');
    const roots = getScannedRoots();
    expect(roots[0].fileCount).toBe(0);
  });
});
