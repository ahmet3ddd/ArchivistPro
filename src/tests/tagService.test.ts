import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';
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
  getAssetIdsByTag,
  getTagCounts,
  setTagsForAsset,
  searchTags,
  setTagDb,
} from '../services/tagService';

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
  };
});

describe('TagService — Tag CRUD', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('createTag yeni etiket oluşturur', () => {
    const tag = createTag('Önemli');
    expect(tag).not.toBeNull();
    expect(tag!.name).toBe('Önemli');
    expect(tag!.color).toBe('#6366f1');
    expect(tag!.id).toBeGreaterThan(0);
  });

  it('createTag custom renk ile', () => {
    const tag = createTag('Acil', '#ef4444');
    expect(tag).not.toBeNull();
    expect(tag!.color).toBe('#ef4444');
  });

  it('createTag boş isimle null döner', () => {
    expect(createTag('')).toBeNull();
    expect(createTag('   ')).toBeNull();
  });

  it('getAllTags tüm etiketleri sıralı getirir', () => {
    createTag('Beta');
    createTag('Alpha');
    const all = getAllTags();
    expect(all.length).toBe(2);
    expect(all[0].name).toBe('Alpha');
    expect(all[1].name).toBe('Beta');
  });

  it('renameTag etiketi yeniden adlandırır', () => {
    const tag = createTag('Eski');
    expect(renameTag(tag!.id, 'Yeni')).toBe(true);
  });

  it('updateTagColor renk değiştirir', () => {
    const tag = createTag('Test');
    expect(updateTagColor(tag!.id, '#10b981')).toBe(true);
  });

  it('deleteTag etiketi siler', () => {
    const tag = createTag('Silinecek');
    expect(deleteTag(tag!.id)).toBe(true);
    expect(getAllTags().length).toBe(0);
  });

  it('searchTags sorguya göre filtreler', () => {
    createTag('Mimari');
    createTag('Mekanik');
    createTag('Elektrik');
    const results = searchTags('mim');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Mimari');
  });

  it('DB null iken fonksiyonlar hata vermez', () => {
    setTagDb(null);
    expect(createTag('Test')).toBeNull();
    expect(getAllTags()).toEqual([]);
    expect(renameTag(1, 'X')).toBe(false);
    expect(deleteTag(1)).toBe(false);
  });
});

function insertDummyAsset(db: any, id: string) {
  db.run(
    `INSERT INTO assets (id, file_name, file_path) VALUES (?, ?, ?)`,
    [id, `${id}.dwg`, `/test/${id}.dwg`]
  );
}

describe('TagService — Asset-Tag İlişkisi', () => {
  let db: any;
  let tag1Id: number;
  let tag2Id: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
    // FK constraint için dummy asset'ler
    insertDummyAsset(db, 'asset_1');
    insertDummyAsset(db, 'asset_2');
    insertDummyAsset(db, 'asset_3');
    const t1 = createTag('Önemli');
    const t2 = createTag('Revize');
    tag1Id = t1!.id;
    tag2Id = t2!.id;
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('addTagToAsset etiket atar', () => {
    expect(addTagToAsset('asset_1', tag1Id)).toBe(true);
  });

  it('getTagsForAsset asset etiketlerini getirir', () => {
    addTagToAsset('asset_1', tag1Id);
    addTagToAsset('asset_1', tag2Id);
    const tags = getTagsForAsset('asset_1');
    expect(tags.length).toBe(2);
  });

  it('removeTagFromAsset etiket kaldırır', () => {
    addTagToAsset('asset_1', tag1Id);
    addTagToAsset('asset_1', tag2Id);
    removeTagFromAsset('asset_1', tag1Id);
    const tags = getTagsForAsset('asset_1');
    expect(tags.length).toBe(1);
    expect(tags[0].id).toBe(tag2Id);
  });

  it('getAssetIdsByTag tag ile asset listesi', () => {
    addTagToAsset('asset_1', tag1Id);
    addTagToAsset('asset_2', tag1Id);
    addTagToAsset('asset_3', tag2Id);
    const ids = getAssetIdsByTag(tag1Id);
    expect(ids.length).toBe(2);
    expect(ids).toContain('asset_1');
    expect(ids).toContain('asset_2');
  });

  it('getTagCounts etiket sayılarını döndürür', () => {
    addTagToAsset('asset_1', tag1Id);
    addTagToAsset('asset_2', tag1Id);
    addTagToAsset('asset_3', tag2Id);
    const counts = getTagCounts();
    expect(counts.length).toBe(2);
    const onemli = counts.find(c => c.tagName === 'Önemli');
    expect(onemli?.count).toBe(2);
  });

  it('setTagsForAsset toplu etiket atar', () => {
    setTagsForAsset('asset_1', [tag1Id, tag2Id]);
    const tags = getTagsForAsset('asset_1');
    expect(tags.length).toBe(2);
  });
});

describe('TagService — Merge', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setTagDb(db);
    createTag('Source');
    createTag('Target');
  });

  afterEach(() => {
    setTagDb(null);
    db.close();
  });

  it('mergeTags aynı id ile false döner', () => {
    expect(mergeTags(1, 1)).toBe(false);
  });

  it('mergeTags asset ilişkilerini taşır', () => {
    insertDummyAsset(db, 'asset_1');
    insertDummyAsset(db, 'asset_2');
    const src = getAllTags().find(t => t.name === 'Source')!;
    const tgt = getAllTags().find(t => t.name === 'Target')!;
    addTagToAsset('asset_1', src.id);
    addTagToAsset('asset_2', src.id);
    const result = mergeTags(src.id, tgt.id);
    expect(result).toBe(true);
    // Source tag silinmiş olmalı
    expect(getAllTags().length).toBe(1);
    // Asset'ler target'a taşınmış olmalı
    const ids = getAssetIdsByTag(tgt.id);
    expect(ids).toContain('asset_1');
    expect(ids).toContain('asset_2');
  });
});
