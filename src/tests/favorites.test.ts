import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';
import {
  setFavoritesDb,
  addFavorite,
  removeFavorite,
  isFavorite,
  getAllFavoriteIds,
  getFavoriteCount,
  createCollection,
  getAllCollections,
  deleteCollection,
  renameCollection,
  addToCollection,
  removeFromCollection,
  getCollectionAssetIds,
  getCollectionsForAsset,
} from '../services/favorites';

vi.mock('../services/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/database')>();
  return {
    ...actual,
    saveDatabase: vi.fn(),
    saveDatabaseDeferred: vi.fn(),
  };
});

function insertDummyAsset(db: any, id: string) {
  db.run(`INSERT INTO assets (id, file_name, file_path) VALUES (?, ?, ?)`, [id, `${id}.dwg`, `/test/${id}.dwg`]);
}

describe('Favorites — Favori İşlemleri', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setFavoritesDb(db);
    insertDummyAsset(db, 'asset_1');
    insertDummyAsset(db, 'asset_2');
    insertDummyAsset(db, 'asset_3');
  });

  afterEach(() => {
    setFavoritesDb(null);
    db.close();
  });

  it('addFavorite asset ekler', () => {
    expect(addFavorite('asset_1')).toBe(true);
    expect(isFavorite('asset_1')).toBe(true);
  });

  it('removeFavorite asset kaldırır', () => {
    addFavorite('asset_1');
    expect(removeFavorite('asset_1')).toBe(true);
    expect(isFavorite('asset_1')).toBe(false);
  });

  it('isFavorite olmayan asset için false döner', () => {
    expect(isFavorite('asset_1')).toBe(false);
  });

  it('getAllFavoriteIds tüm favori ID listesi', () => {
    addFavorite('asset_1');
    addFavorite('asset_2');
    const ids = getAllFavoriteIds();
    expect(ids).toHaveLength(2);
    expect(ids).toContain('asset_1');
    expect(ids).toContain('asset_2');
  });

  it('getFavoriteCount doğru sayı döner', () => {
    expect(getFavoriteCount()).toBe(0);
    addFavorite('asset_1');
    addFavorite('asset_2');
    expect(getFavoriteCount()).toBe(2);
  });

  it('aynı asset iki kez eklenmez (INSERT OR IGNORE)', () => {
    addFavorite('asset_1');
    addFavorite('asset_1');
    expect(getFavoriteCount()).toBe(1);
  });

  it('DB null iken fonksiyonlar güvenli döner', () => {
    setFavoritesDb(null);
    expect(addFavorite('asset_1')).toBe(false);
    expect(removeFavorite('asset_1')).toBe(false);
    expect(isFavorite('asset_1')).toBe(false);
    expect(getAllFavoriteIds()).toEqual([]);
    expect(getFavoriteCount()).toBe(0);
  });
});

describe('Favorites — Koleksiyonlar', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setFavoritesDb(db);
    insertDummyAsset(db, 'asset_1');
    insertDummyAsset(db, 'asset_2');
    insertDummyAsset(db, 'asset_3');
  });

  afterEach(() => {
    setFavoritesDb(null);
    db.close();
  });

  it('createCollection yeni koleksiyon oluşturur', () => {
    const col = createCollection('Mimari Planlar');
    expect(col).not.toBeNull();
    expect(col!.name).toBe('Mimari Planlar');
    expect(col!.color).toBe('#a855f7');
  });

  it('createCollection custom renk ile', () => {
    const col = createCollection('Acil', '#ef4444');
    expect(col!.color).toBe('#ef4444');
  });

  it('createCollection boş isimle null döner', () => {
    expect(createCollection('')).toBeNull();
    expect(createCollection('   ')).toBeNull();
  });

  it('getAllCollections koleksiyonları listeler', () => {
    createCollection('Alpha');
    createCollection('Beta');
    const all = getAllCollections();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe('Alpha');
  });

  it('deleteCollection koleksiyonu siler', () => {
    const col = createCollection('Silinecek')!;
    expect(deleteCollection(col.id)).toBe(true);
    expect(getAllCollections()).toHaveLength(0);
  });

  it('renameCollection isim değiştirir', () => {
    const col = createCollection('Eski')!;
    expect(renameCollection(col.id, 'Yeni')).toBe(true);
  });

  it('addToCollection asset ekler', () => {
    const col = createCollection('Test')!;
    expect(addToCollection(col.id, 'asset_1')).toBe(true);
    expect(addToCollection(col.id, 'asset_2')).toBe(true);
    const ids = getCollectionAssetIds(col.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain('asset_1');
  });

  it('removeFromCollection asset kaldırır', () => {
    const col = createCollection('Test')!;
    addToCollection(col.id, 'asset_1');
    addToCollection(col.id, 'asset_2');
    removeFromCollection(col.id, 'asset_1');
    const ids = getCollectionAssetIds(col.id);
    expect(ids).toHaveLength(1);
    expect(ids).toContain('asset_2');
  });

  it('getCollectionsForAsset asset koleksiyonlarını döner', () => {
    const col1 = createCollection('Mimari')!;
    const col2 = createCollection('Mekanik')!;
    addToCollection(col1.id, 'asset_1');
    addToCollection(col2.id, 'asset_1');
    const cols = getCollectionsForAsset('asset_1');
    expect(cols).toHaveLength(2);
  });

  it('deleteCollection cascade ile item\'ları da siler', () => {
    const col = createCollection('Test')!;
    addToCollection(col.id, 'asset_1');
    deleteCollection(col.id);
    expect(getCollectionAssetIds(col.id)).toHaveLength(0);
  });

  it('getAllCollections itemCount hesaplar', () => {
    const col = createCollection('Test')!;
    addToCollection(col.id, 'asset_1');
    addToCollection(col.id, 'asset_2');
    const all = getAllCollections();
    expect(all[0].itemCount).toBe(2);
  });

  it('DB null iken koleksiyon fonksiyonları güvenli döner', () => {
    setFavoritesDb(null);
    expect(createCollection('Test')).toBeNull();
    expect(getAllCollections()).toEqual([]);
    expect(deleteCollection(1)).toBe(false);
    expect(renameCollection(1, 'X')).toBe(false);
    expect(addToCollection(1, 'x')).toBe(false);
    expect(removeFromCollection(1, 'x')).toBe(false);
    expect(getCollectionAssetIds(1)).toEqual([]);
    expect(getCollectionsForAsset('x')).toEqual([]);
  });
});
