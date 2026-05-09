/**
 * tagServiceAdvanced.test.ts
 *
 * Ek test kapsamasi: tagService.ts icin uncovered fonksiyon ve branch'ler.
 * Hedef: %59 -> %90+ coverage.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';

// ── Mocks (import'lardan once) ──────────────────────────────────────────────

vi.mock('../services/logger', () => ({
  auditLog: vi.fn(),
  debugLog: vi.fn(),
}));

vi.mock('../services/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/database')>();
  return {
    ...actual,
    saveDatabase: vi.fn(),
    saveDatabaseDeferred: vi.fn(),
    saveUserDatabase: vi.fn(),
    getChunksByAssetId: vi.fn().mockReturnValue([]),
  };
});

vi.mock('../services/ollamaService', () => ({
  chatModel: vi.fn(() => 'qwen3:4b'),
  normalizeOllamaGenerateUrl: vi.fn((url: string) => url + '/api/generate'),
}));

vi.mock('../utils/invokeWithTimeout', () => ({
  invokeWithTimeout: vi.fn(() =>
    Promise.resolve(JSON.stringify({ response: 'etiket1, etiket2, etiket3' })),
  ),
}));

// ── Import'lar ──────────────────────────────────────────────────────────────

import {
  createTag,
  getAllTags,
  renameTag,
  updateTagColor,
  deleteTag,
  mergeTags,
  addTagToAsset,
  removeTagFromAsset,
  getTagsForAsset,
  getTagsForAssets,
  getAssetIdsByTag,
  getTagCounts,
  setTagsForAsset,
  searchTags,
  setTagDb,
  suggestTagsForAsset,
} from '../services/tagService';
import * as database from '../services/database';
import { invokeWithTimeout } from '../utils/invokeWithTimeout';
import type { AIConfig } from '../components/AISettingsModal';

// ── Yardimci ────────────────────────────────────────────────────────────────

function insertDummyAsset(db: any, id: string) {
  db.run(
    `INSERT INTO assets (id, file_name, file_path) VALUES (?, ?, ?)`,
    [id, `${id}.dwg`, `/test/${id}.dwg`],
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  1. Tag CRUD — ek edge case'ler                                           */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — CRUD edge cases', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('createTag trims whitespace around name', () => {
    const tag = createTag('  Spaced  ');
    expect(tag).not.toBeNull();
    expect(tag!.name).toBe('Spaced');
  });

  it('createTag duplicate name returns existing tag (INSERT OR IGNORE)', () => {
    const tag1 = createTag('Duplicate');
    const tag2 = createTag('Duplicate');
    expect(tag1).not.toBeNull();
    expect(tag2).not.toBeNull();
    expect(tag1!.id).toBe(tag2!.id);
  });

  it('createTag with DB null returns null', () => {
    setTagDb(null);
    expect(createTag('Test')).toBeNull();
  });

  it('createTag returns tag with createdAt field', () => {
    const tag = createTag('Timestamped');
    expect(tag).not.toBeNull();
    expect(tag!.createdAt).toBeDefined();
  });

  it('getAllTags returns empty array when no tags exist', () => {
    expect(getAllTags()).toEqual([]);
  });

  it('getAllTags returns empty array when DB null', () => {
    setTagDb(null);
    expect(getAllTags()).toEqual([]);
  });

  it('getAllTags returns full tag objects with all fields', () => {
    createTag('FullFields', '#ff0000');
    const tags = getAllTags();
    expect(tags.length).toBe(1);
    expect(tags[0]).toHaveProperty('id');
    expect(tags[0]).toHaveProperty('name', 'FullFields');
    expect(tags[0]).toHaveProperty('color', '#ff0000');
    expect(tags[0]).toHaveProperty('createdAt');
  });

  it('renameTag with empty name returns false', () => {
    const tag = createTag('Old');
    expect(renameTag(tag!.id, '')).toBe(false);
    expect(renameTag(tag!.id, '   ')).toBe(false);
  });

  it('renameTag with whitespace-only newName returns false', () => {
    const tag = createTag('SomeName');
    expect(renameTag(tag!.id, '  \t ')).toBe(false);
  });

  it('renameTag with DB null returns false', () => {
    setTagDb(null);
    expect(renameTag(999, 'NewName')).toBe(false);
  });

  it('renameTag trims the new name', () => {
    const tag = createTag('Before');
    expect(renameTag(tag!.id, '  After  ')).toBe(true);
    const tags = getAllTags();
    expect(tags[0].name).toBe('After');
  });

  it('updateTagColor with DB null returns false', () => {
    setTagDb(null);
    expect(updateTagColor(1, '#ff0000')).toBe(false);
  });

  it('updateTagColor updates and verifies', () => {
    const tag = createTag('ColorTest');
    expect(updateTagColor(tag!.id, '#ff0000')).toBe(true);
    const tags = getAllTags();
    expect(tags[0].color).toBe('#ff0000');
  });

  it('deleteTag with DB null returns false', () => {
    setTagDb(null);
    expect(deleteTag(1)).toBe(false);
  });

  it('deleteTag on non-existent id still returns true (no error)', () => {
    expect(deleteTag(99999)).toBe(true);
  });

  it('deleteTag also removes asset_tags relationships', () => {
    insertDummyAsset(db, 'a1');
    const tag = createTag('ToDelete');
    addTagToAsset('a1', tag!.id);
    expect(getTagsForAsset('a1').length).toBe(1);
    deleteTag(tag!.id);
    expect(getTagsForAsset('a1').length).toBe(0);
  });

  it('createTag with default color uses #6366f1', () => {
    const tag = createTag('DefaultColor');
    expect(tag!.color).toBe('#6366f1');
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  2. searchTags — branch coverage                                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — searchTags', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
    createTag('Architecture');
    createTag('Mechanical');
    createTag('Electrical');
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('searchTags with empty query returns all tags (fallback)', () => {
    const results = searchTags('');
    expect(results.length).toBe(3);
  });

  it('searchTags with whitespace-only query returns all tags', () => {
    const results = searchTags('   ');
    expect(results.length).toBe(3);
  });

  it('searchTags case-insensitive match', () => {
    const results = searchTags('ARCH');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Architecture');
  });

  it('searchTags partial match in the middle', () => {
    const results = searchTags('chan');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Mechanical');
  });

  it('searchTags no match returns empty array', () => {
    const results = searchTags('xyz_no_match');
    expect(results).toEqual([]);
  });

  it('searchTags with DB null and non-empty query returns empty', () => {
    setTagDb(null);
    const results = searchTags('test');
    expect(results).toEqual([]);
  });

  it('searchTags with DB null and empty query returns empty (getAllTags fallback with null DB)', () => {
    setTagDb(null);
    const results = searchTags('');
    expect(results).toEqual([]);
  });

  it('searchTags returns tags sorted by name', () => {
    const results = searchTags('');
    expect(results[0].name).toBe('Architecture');
    expect(results[1].name).toBe('Electrical');
    expect(results[2].name).toBe('Mechanical');
  });

  it('searchTags returns full tag objects', () => {
    const results = searchTags('Arch');
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
    expect(results[0]).toHaveProperty('color');
    expect(results[0]).toHaveProperty('createdAt');
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  3. getTagsForAssets (plural) — batch loading                             */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — getTagsForAssets (batch)', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('getTagsForAssets returns empty object when DB null', () => {
    setTagDb(null);
    expect(getTagsForAssets(['a1'])).toEqual({});
  });

  it('getTagsForAssets returns empty object for empty array', () => {
    expect(getTagsForAssets([])).toEqual({});
  });

  it('getTagsForAssets returns tags grouped by asset', () => {
    insertDummyAsset(db, 'a1');
    insertDummyAsset(db, 'a2');
    const t1 = createTag('Tag1')!;
    const t2 = createTag('Tag2')!;
    addTagToAsset('a1', t1.id);
    addTagToAsset('a1', t2.id);
    addTagToAsset('a2', t1.id);

    const result = getTagsForAssets(['a1', 'a2']);
    expect(Object.keys(result).length).toBe(2);
    expect(result['a1'].length).toBe(2);
    expect(result['a2'].length).toBe(1);
    expect(result['a2'][0].name).toBe('Tag1');
  });

  it('getTagsForAssets handles assets with no tags', () => {
    insertDummyAsset(db, 'a1');
    insertDummyAsset(db, 'a2');
    const t1 = createTag('OnlyForA1')!;
    addTagToAsset('a1', t1.id);

    const result = getTagsForAssets(['a1', 'a2']);
    expect(result['a1'].length).toBe(1);
    expect(result['a2']).toBeUndefined();
  });

  it('getTagsForAssets handles non-existent asset ids gracefully', () => {
    const result = getTagsForAssets(['nonexistent1', 'nonexistent2']);
    expect(Object.keys(result).length).toBe(0);
  });

  it('getTagsForAssets returns tags with all fields populated', () => {
    insertDummyAsset(db, 'a1');
    const t = createTag('Complete')!;
    addTagToAsset('a1', t.id);

    const result = getTagsForAssets(['a1']);
    const tag = result['a1'][0];
    expect(tag).toHaveProperty('id');
    expect(tag).toHaveProperty('name', 'Complete');
    expect(tag).toHaveProperty('color');
    expect(tag).toHaveProperty('createdAt');
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  4. mergeTags — ek edge case'ler                                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — mergeTags', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('mergeTags with DB null returns false', () => {
    setTagDb(null);
    expect(mergeTags(1, 2)).toBe(false);
  });

  it('mergeTags with same id returns false', () => {
    expect(mergeTags(5, 5)).toBe(false);
  });

  it('mergeTags deduplicates overlapping asset assignments', () => {
    insertDummyAsset(db, 'a1');
    const src = createTag('Source')!;
    const tgt = createTag('Target')!;
    // Both tags assigned to same asset
    addTagToAsset('a1', src.id);
    addTagToAsset('a1', tgt.id);

    expect(mergeTags(src.id, tgt.id)).toBe(true);
    // Source tag should be deleted
    expect(getAllTags().length).toBe(1);
    // Asset should have target tag only (no duplicate)
    const tags = getTagsForAsset('a1');
    expect(tags.length).toBe(1);
    expect(tags[0].id).toBe(tgt.id);
  });

  it('mergeTags with source having no assets still deletes source tag', () => {
    const src = createTag('EmptySource')!;
    const tgt = createTag('Target')!;
    expect(mergeTags(src.id, tgt.id)).toBe(true);
    const all = getAllTags();
    expect(all.length).toBe(1);
    expect(all[0].name).toBe('Target');
  });

  it('mergeTags moves multiple assets from source to target', () => {
    insertDummyAsset(db, 'a1');
    insertDummyAsset(db, 'a2');
    insertDummyAsset(db, 'a3');
    const src = createTag('MergeFrom')!;
    const tgt = createTag('MergeTo')!;
    addTagToAsset('a1', src.id);
    addTagToAsset('a2', src.id);
    addTagToAsset('a3', src.id);

    expect(mergeTags(src.id, tgt.id)).toBe(true);
    const ids = getAssetIdsByTag(tgt.id);
    expect(ids.length).toBe(3);
    expect(getAssetIdsByTag(src.id)).toEqual([]);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  5. setTagsForAsset — branch coverage                                     */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — setTagsForAsset', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('setTagsForAsset with DB null returns false', () => {
    setTagDb(null);
    expect(setTagsForAsset('a1', [1, 2])).toBe(false);
  });

  it('setTagsForAsset replaces existing tags', () => {
    insertDummyAsset(db, 'a1');
    const t1 = createTag('First')!;
    const t2 = createTag('Second')!;
    const t3 = createTag('Third')!;

    setTagsForAsset('a1', [t1.id, t2.id]);
    expect(getTagsForAsset('a1').length).toBe(2);

    // Replace with only Third
    setTagsForAsset('a1', [t3.id]);
    const tags = getTagsForAsset('a1');
    expect(tags.length).toBe(1);
    expect(tags[0].name).toBe('Third');
  });

  it('setTagsForAsset with empty tag array clears all tags', () => {
    insertDummyAsset(db, 'a1');
    const t1 = createTag('WillBeRemoved')!;
    addTagToAsset('a1', t1.id);
    expect(getTagsForAsset('a1').length).toBe(1);

    setTagsForAsset('a1', []);
    expect(getTagsForAsset('a1').length).toBe(0);
  });

  it('setTagsForAsset returns true on success', () => {
    insertDummyAsset(db, 'a1');
    const t1 = createTag('One')!;
    const t2 = createTag('Two')!;
    expect(setTagsForAsset('a1', [t1.id, t2.id])).toBe(true);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  6. Asset-Tag iliskisi — ek edge case'ler                                 */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — Asset-Tag edge cases', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('addTagToAsset with DB null returns false', () => {
    setTagDb(null);
    expect(addTagToAsset('a1', 1)).toBe(false);
  });

  it('addTagToAsset duplicate assignment is ignored (INSERT OR IGNORE)', () => {
    insertDummyAsset(db, 'a1');
    const tag = createTag('Dup')!;
    expect(addTagToAsset('a1', tag.id)).toBe(true);
    expect(addTagToAsset('a1', tag.id)).toBe(true); // no error
    expect(getTagsForAsset('a1').length).toBe(1);
  });

  it('removeTagFromAsset with DB null returns false', () => {
    setTagDb(null);
    expect(removeTagFromAsset('a1', 1)).toBe(false);
  });

  it('removeTagFromAsset on non-existent relationship still returns true', () => {
    insertDummyAsset(db, 'a1');
    expect(removeTagFromAsset('a1', 99999)).toBe(true);
  });

  it('getTagsForAsset with DB null returns empty array', () => {
    setTagDb(null);
    expect(getTagsForAsset('a1')).toEqual([]);
  });

  it('getTagsForAsset returns tags sorted by name', () => {
    insertDummyAsset(db, 'a1');
    const tZ = createTag('Zebra')!;
    const tA = createTag('Alpha')!;
    const tM = createTag('Middle')!;
    addTagToAsset('a1', tZ.id);
    addTagToAsset('a1', tA.id);
    addTagToAsset('a1', tM.id);

    const tags = getTagsForAsset('a1');
    expect(tags.length).toBe(3);
    expect(tags[0].name).toBe('Alpha');
    expect(tags[1].name).toBe('Middle');
    expect(tags[2].name).toBe('Zebra');
  });

  it('getAssetIdsByTag with DB null returns empty array', () => {
    setTagDb(null);
    expect(getAssetIdsByTag(1)).toEqual([]);
  });

  it('getAssetIdsByTag with non-existent tag returns empty array', () => {
    expect(getAssetIdsByTag(99999)).toEqual([]);
  });

  it('getTagsForAsset returns empty for asset with no tags', () => {
    insertDummyAsset(db, 'a1');
    expect(getTagsForAsset('a1')).toEqual([]);
  });

  it('addTagToAsset and removeTagFromAsset are idempotent', () => {
    insertDummyAsset(db, 'a1');
    const tag = createTag('Idem')!;
    addTagToAsset('a1', tag.id);
    addTagToAsset('a1', tag.id);
    expect(getTagsForAsset('a1').length).toBe(1);
    removeTagFromAsset('a1', tag.id);
    removeTagFromAsset('a1', tag.id);
    expect(getTagsForAsset('a1').length).toBe(0);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  7. getTagCounts — ek branch'ler                                          */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — getTagCounts', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('getTagCounts with DB null returns empty array', () => {
    setTagDb(null);
    expect(getTagCounts()).toEqual([]);
  });

  it('getTagCounts with no tags returns empty array', () => {
    expect(getTagCounts()).toEqual([]);
  });

  it('getTagCounts includes tags with zero assignments', () => {
    createTag('Orphan');
    const counts = getTagCounts();
    expect(counts.length).toBe(1);
    expect(counts[0].count).toBe(0);
    expect(counts[0].tagName).toBe('Orphan');
  });

  it('getTagCounts ordered by count descending then name', () => {
    insertDummyAsset(db, 'a1');
    insertDummyAsset(db, 'a2');
    insertDummyAsset(db, 'a3');
    const tA = createTag('AAA')!;
    const tB = createTag('BBB')!;
    const tC = createTag('CCC')!;

    addTagToAsset('a1', tB.id);
    addTagToAsset('a2', tB.id);
    addTagToAsset('a3', tB.id); // BBB = 3
    addTagToAsset('a1', tA.id); // AAA = 1
    // CCC = 0

    const counts = getTagCounts();
    expect(counts[0].tagName).toBe('BBB');
    expect(counts[0].count).toBe(3);
    expect(counts[1].tagName).toBe('AAA');
    expect(counts[1].count).toBe(1);
    expect(counts[2].tagName).toBe('CCC');
    expect(counts[2].count).toBe(0);
  });

  it('getTagCounts returns correct fields (tagId, tagName, count)', () => {
    const tag = createTag('FieldCheck')!;
    const counts = getTagCounts();
    expect(counts[0]).toHaveProperty('tagId', tag.id);
    expect(counts[0]).toHaveProperty('tagName', 'FieldCheck');
    expect(counts[0]).toHaveProperty('count', 0);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  8. suggestTagsForAsset — AI tag onerisi                                  */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — suggestTagsForAsset', () => {
  const ollamaConfig: AIConfig = {
    apiProvider: 'ollama',
    apiKey: '',
    apiUrl: 'http://localhost:11434',
    chatModel: 'qwen3:4b',
  };

  it('returns empty when provider is not ollama', async () => {
    const config: AIConfig = { ...ollamaConfig, apiProvider: 'openai' as any };
    const result = await suggestTagsForAsset('a1', config);
    expect(result).toEqual([]);
  });

  it('returns empty when apiUrl is empty', async () => {
    const config: AIConfig = { ...ollamaConfig, apiUrl: '' };
    const result = await suggestTagsForAsset('a1', config);
    expect(result).toEqual([]);
  });

  it('returns empty when provider is gemini', async () => {
    const config: AIConfig = { ...ollamaConfig, apiProvider: 'gemini' };
    const result = await suggestTagsForAsset('a1', config);
    expect(result).toEqual([]);
  });

  it('returns empty when provider is groq', async () => {
    const config: AIConfig = { ...ollamaConfig, apiProvider: 'groq' };
    const result = await suggestTagsForAsset('a1', config);
    expect(result).toEqual([]);
  });

  // getChunksByAssetId returns [] by default mock -> chunks.length === 0 -> early return
  it('returns empty when chunks are empty (default mock)', async () => {
    const result = await suggestTagsForAsset('a1', ollamaConfig);
    expect(result).toEqual([]);
  });

  // Helper: dynamic import with fresh modules for suggestTagsForAsset integration tests
  async function importWithMocks(
    chunks: any[],
    invokeResult: string | Error,
  ) {
    vi.resetModules();

    vi.doMock('../services/logger', () => ({ auditLog: vi.fn(), debugLog: vi.fn() }));
    vi.doMock('../services/ollamaService', () => ({
      chatModel: vi.fn(() => 'qwen3:4b'),
      normalizeOllamaGenerateUrl: vi.fn((url: string) => url + '/api/generate'),
    }));
    vi.doMock('../services/database', () => ({
      saveDatabase: vi.fn(),
      saveDatabaseDeferred: vi.fn(),
      getChunksByAssetId: vi.fn().mockReturnValue(chunks),
    }));

    if (invokeResult instanceof Error) {
      vi.doMock('../utils/invokeWithTimeout', () => ({
        invokeWithTimeout: vi.fn().mockRejectedValue(invokeResult),
      }));
    } else {
      vi.doMock('../utils/invokeWithTimeout', () => ({
        invokeWithTimeout: vi.fn().mockResolvedValue(invokeResult),
      }));
    }

    const mod = await import('../services/tagService');
    return mod.suggestTagsForAsset;
  }

  const sampleChunks = [
    { id: 'c1', chunkIndex: 0, page: null, text: 'Zemin kat plani detaylari', lang: 'tr' },
  ];

  it('parses comma-separated tags from Ollama response', async () => {
    const suggest = await importWithMocks(
      sampleChunks,
      JSON.stringify({ response: 'zemin kat, beton detay, cephe' }),
    );
    const result = await suggest('a1', ollamaConfig);
    expect(result).toEqual(['zemin kat', 'beton detay', 'cephe']);
  });

  it('filters short tags and strips prefixes', async () => {
    const suggest = await importWithMocks(
      sampleChunks,
      JSON.stringify({ response: '- zemin kat, a, * cephe, x, ok' }),
    );
    const result = await suggest('a1', ollamaConfig);
    expect(result).toContain('zemin kat');
    expect(result).toContain('cephe');
    expect(result).toContain('ok');
    expect(result).not.toContain('a');
    expect(result).not.toContain('x');
  });

  it('returns empty when Ollama call fails', async () => {
    const suggest = await importWithMocks(
      sampleChunks,
      new Error('connection refused'),
    );
    const result = await suggest('a1', ollamaConfig);
    expect(result).toEqual([]);
  });

  it('returns empty when response has no response field', async () => {
    const suggest = await importWithMocks(
      sampleChunks,
      JSON.stringify({}),
    );
    const result = await suggest('a1', ollamaConfig);
    expect(result).toEqual([]);
  });

  it('limits to max 6 tags', async () => {
    const suggest = await importWithMocks(
      sampleChunks,
      JSON.stringify({ response: 'tag1, tag2, tag3, tag4, tag5, tag6, tag7, tag8' }),
    );
    const result = await suggest('a1', ollamaConfig);
    expect(result.length).toBeLessThanOrEqual(6);
  });

  it('handles multiple chunks', async () => {
    const suggest = await importWithMocks(
      [
        { id: 'c1', chunkIndex: 0, page: 1, text: 'Zemin kat', lang: 'tr' },
        { id: 'c2', chunkIndex: 1, page: 2, text: 'Cephe detayi', lang: 'tr' },
      ],
      JSON.stringify({ response: 'zemin, cephe' }),
    );
    const result = await suggest('a1', ollamaConfig);
    expect(result).toEqual(['zemin', 'cephe']);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  9. suggestTagsForAsset — tag parsing logic                               */
/*     Ayni parsing mantigi dogrudan test ediliyor                           */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — tag parsing logic (mirrors suggestTagsForAsset internals)', () => {
  /**
   * This replicates the exact parsing logic from suggestTagsForAsset lines 360-364:
   *   raw.split(',').map(s => s.trim().replace(/^[-\u2013\u2022*]\s*\/, '')).filter(s => s.length >= 2 && s.length <= 50).slice(0, 6)
   */
  function parseTagResponse(raw: string): string[] {
    return raw
      .split(',')
      .map(s => s.trim().replace(/^[-\u2013\u2022*]\s*/, ''))
      .filter(s => s.length >= 2 && s.length <= 50)
      .slice(0, 6);
  }

  it('parses simple comma-separated tags', () => {
    expect(parseTagResponse('zemin kat, beton detay, cephe'))
      .toEqual(['zemin kat', 'beton detay', 'cephe']);
  });

  it('filters out very short tags (< 2 chars)', () => {
    expect(parseTagResponse('a, ok, valid tag, x'))
      .toEqual(['ok', 'valid tag']);
  });

  it('filters out tags longer than 50 chars', () => {
    const longTag = 'a'.repeat(51);
    expect(parseTagResponse(`normal tag, ${longTag}, ok tag`))
      .toEqual(['normal tag', 'ok tag']);
  });

  it('limits to max 6 tags', () => {
    const result = parseTagResponse('tag1, tag2, tag3, tag4, tag5, tag6, tag7, tag8');
    expect(result.length).toBe(6);
  });

  it('strips dash prefix', () => {
    const result = parseTagResponse('- zemin kat, - cephe');
    expect(result).toEqual(['zemin kat', 'cephe']);
  });

  it('strips bullet prefix', () => {
    const result = parseTagResponse('\u2022 zemin kat, \u2022 cephe');
    expect(result).toEqual(['zemin kat', 'cephe']);
  });

  it('strips asterisk prefix', () => {
    const result = parseTagResponse('* zemin kat, * cephe');
    expect(result).toEqual(['zemin kat', 'cephe']);
  });

  it('strips en-dash prefix', () => {
    const result = parseTagResponse('\u2013 zemin kat, \u2013 cephe');
    expect(result).toEqual(['zemin kat', 'cephe']);
  });

  it('handles empty response', () => {
    expect(parseTagResponse('')).toEqual([]);
  });

  it('handles whitespace-only response', () => {
    expect(parseTagResponse('   ')).toEqual([]);
  });

  it('trims whitespace around each tag', () => {
    expect(parseTagResponse('  zemin  ,  cephe  '))
      .toEqual(['zemin', 'cephe']);
  });

  it('exactly 50 chars is valid', () => {
    const tag50 = 'a'.repeat(50);
    const result = parseTagResponse(tag50);
    expect(result.length).toBe(1);
    expect(result[0]).toBe(tag50);
  });

  it('exactly 2 chars is valid', () => {
    const result = parseTagResponse('ab');
    expect(result).toEqual(['ab']);
  });

  it('exactly 1 char is filtered', () => {
    const result = parseTagResponse('a');
    expect(result).toEqual([]);
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  10. Error/catch branch coverage — DB error simulation                    */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — DB error handling (catch branches)', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
  });

  afterEach(() => {
    setTagDb(null);
    try { db.close(); } catch { /* already closed */ }
  });

  it('getTagCounts returns [] when DB throws (catch branch)', () => {
    // Drop the tags table to force SQL error
    db.run('DROP TABLE IF EXISTS asset_tags');
    db.run('DROP TABLE IF EXISTS tags');
    const counts = getTagCounts();
    expect(counts).toEqual([]);
  });

  it('searchTags returns [] when DB throws (catch branch)', () => {
    db.run('DROP TABLE IF EXISTS tags');
    const results = searchTags('test');
    expect(results).toEqual([]);
  });

  it('setTagsForAsset returns false and rolls back on error (catch branch)', () => {
    insertDummyAsset(db, 'a1');
    const tag = createTag('Good')!;
    addTagToAsset('a1', tag.id);

    // Drop asset_tags to force error during INSERT
    db.run('DROP TABLE IF EXISTS asset_tags');
    const result = setTagsForAsset('a1', [tag.id]);
    expect(result).toBe(false);
  });

  it('getAllTags returns [] when DB throws', () => {
    db.run('DROP TABLE IF EXISTS tags');
    expect(getAllTags()).toEqual([]);
  });

  it('getTagsForAsset returns [] when DB throws', () => {
    db.run('DROP TABLE IF EXISTS asset_tags');
    db.run('DROP TABLE IF EXISTS tags');
    expect(getTagsForAsset('a1')).toEqual([]);
  });

  it('getAssetIdsByTag returns [] when DB throws', () => {
    db.run('DROP TABLE IF EXISTS asset_tags');
    expect(getAssetIdsByTag(1)).toEqual([]);
  });

  it('getTagsForAssets returns {} when DB throws', () => {
    db.run('DROP TABLE IF EXISTS asset_tags');
    db.run('DROP TABLE IF EXISTS tags');
    expect(getTagsForAssets(['a1'])).toEqual({});
  });
});

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  11. setTagDb — edge cases                                                */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

describe('TagService Advanced — setTagDb', () => {
  it('setTagDb to null makes all operations safe', () => {
    setTagDb(null);
    expect(createTag('x')).toBeNull();
    expect(getAllTags()).toEqual([]);
    expect(renameTag(1, 'y')).toBe(false);
    expect(updateTagColor(1, '#000')).toBe(false);
    expect(deleteTag(1)).toBe(false);
    expect(mergeTags(1, 2)).toBe(false);
    expect(addTagToAsset('a', 1)).toBe(false);
    expect(removeTagFromAsset('a', 1)).toBe(false);
    expect(getTagsForAsset('a')).toEqual([]);
    expect(getTagsForAssets(['a'])).toEqual({});
    expect(getAssetIdsByTag(1)).toEqual([]);
    expect(getTagCounts()).toEqual([]);
    expect(setTagsForAsset('a', [1])).toBe(false);
    expect(searchTags('x')).toEqual([]);
  });

  it('setTagDb can be set and unset multiple times', async () => {
    const db1 = await createTestDatabase();
    setTagDb(db1);
    createTag('InDB1');
    expect(getAllTags().length).toBe(1);

    const db2 = await createTestDatabase();
    setTagDb(db2);
    expect(getAllTags().length).toBe(0); // new DB, no tags

    createTag('InDB2');
    expect(getAllTags().length).toBe(1);

    setTagDb(null);
    expect(getAllTags()).toEqual([]);

    db1.close();
    db2.close();
  });
});
