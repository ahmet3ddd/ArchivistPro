import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDatabase } from './helpers/sqlJsTestDb';
import {
  setRootTagDb,
  addTagToRoot,
  removeTagFromRoot,
  getTagsForRoot,
  getTagsForRoots,
  setTagsForRoot,
} from '../services/rootTagService';

vi.mock('../services/logger', () => ({
  debugLog: vi.fn(),
  auditLog: vi.fn(),
  setLoggerDb: vi.fn(),
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

/** scanned_roots tablosuna dummy kaynak klasor ekler (FK constraint icin). */
function insertDummyRoot(db: any, id: string, path?: string) {
  db.run(
    `INSERT INTO scanned_roots (id, path, label) VALUES (?, ?, ?)`,
    [id, path ?? `/test/${id}`, `Label ${id}`]
  );
}

/** tags tablosuna etiket ekler ve id dondurur. */
function insertTag(db: any, name: string, color = '#6366f1'): number {
  db.run(
    `INSERT INTO tags (name, color) VALUES (?, ?)`,
    [name, color]
  );
  const rows = db.exec(`SELECT last_insert_rowid() as id`);
  return rows[0].values[0][0] as number;
}

describe('rootTagService — DB null iken', () => {
  beforeEach(() => {
    setRootTagDb(null);
  });

  it('addTagToRoot false doner', () => {
    expect(addTagToRoot('root1', 1)).toBe(false);
  });

  it('removeTagFromRoot false doner', () => {
    expect(removeTagFromRoot('root1', 1)).toBe(false);
  });

  it('getTagsForRoot bos dizi doner', () => {
    expect(getTagsForRoot('root1')).toEqual([]);
  });

  it('getTagsForRoots bos obje doner', () => {
    expect(getTagsForRoots(['root1'])).toEqual({});
  });

  it('setTagsForRoot false doner', () => {
    expect(setTagsForRoot('root1', [1, 2])).toBe(false);
  });
});

describe('rootTagService — addTagToRoot / removeTagFromRoot', () => {
  let db: any;
  let tagId1: number;
  let tagId2: number;

  beforeEach(async () => {
    db = await createTestDatabase();
    setRootTagDb(db);
    insertDummyRoot(db, 'root_a');
    insertDummyRoot(db, 'root_b');
    tagId1 = insertTag(db, 'Mimari');
    tagId2 = insertTag(db, 'Mekanik');
  });

  afterEach(() => {
    setRootTagDb(null);
    db.close();
  });

  it('addTagToRoot etiket atar ve true doner', () => {
    expect(addTagToRoot('root_a', tagId1)).toBe(true);
    const tags = getTagsForRoot('root_a');
    expect(tags.length).toBe(1);
    expect(tags[0].name).toBe('Mimari');
  });

  it('addTagToRoot ayni etiketi iki kez atamak INSERT OR IGNORE ile hata vermez', () => {
    expect(addTagToRoot('root_a', tagId1)).toBe(true);
    expect(addTagToRoot('root_a', tagId1)).toBe(true);
    const tags = getTagsForRoot('root_a');
    expect(tags.length).toBe(1);
  });

  it('addTagToRoot birden fazla etiket atar', () => {
    addTagToRoot('root_a', tagId1);
    addTagToRoot('root_a', tagId2);
    const tags = getTagsForRoot('root_a');
    expect(tags.length).toBe(2);
  });

  it('removeTagFromRoot etiket kaldirir ve true doner', () => {
    addTagToRoot('root_a', tagId1);
    addTagToRoot('root_a', tagId2);
    expect(removeTagFromRoot('root_a', tagId1)).toBe(true);
    const tags = getTagsForRoot('root_a');
    expect(tags.length).toBe(1);
    expect(tags[0].name).toBe('Mekanik');
  });

  it('removeTagFromRoot olmayan etiket icin hata vermez', () => {
    expect(removeTagFromRoot('root_a', 999)).toBe(true);
  });
});

describe('rootTagService — getTagsForRoot', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setRootTagDb(db);
    insertDummyRoot(db, 'root_x');
  });

  afterEach(() => {
    setRootTagDb(null);
    db.close();
  });

  it('etiket olmayan klasor icin bos dizi doner', () => {
    expect(getTagsForRoot('root_x')).toEqual([]);
  });

  it('etiketleri isme gore sirali getirir', () => {
    const t1 = insertTag(db, 'Zemin', '#ff0000');
    const t2 = insertTag(db, 'Altyapi', '#00ff00');
    const t3 = insertTag(db, 'Mekanik', '#0000ff');
    addTagToRoot('root_x', t1);
    addTagToRoot('root_x', t2);
    addTagToRoot('root_x', t3);
    const tags = getTagsForRoot('root_x');
    expect(tags.length).toBe(3);
    expect(tags[0].name).toBe('Altyapi');
    expect(tags[1].name).toBe('Mekanik');
    expect(tags[2].name).toBe('Zemin');
  });

  it('Tag nesnesinin tum alanlari dogru donduruyor', () => {
    const tid = insertTag(db, 'Ozel', '#abcdef');
    addTagToRoot('root_x', tid);
    const tags = getTagsForRoot('root_x');
    expect(tags.length).toBe(1);
    expect(tags[0].id).toBe(tid);
    expect(tags[0].name).toBe('Ozel');
    expect(tags[0].color).toBe('#abcdef');
    expect(tags[0].createdAt).toBeDefined();
  });

  it('var olmayan root id icin bos dizi doner', () => {
    expect(getTagsForRoot('nonexistent_root')).toEqual([]);
  });
});

describe('rootTagService — getTagsForRoots (batch)', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setRootTagDb(db);
  });

  afterEach(() => {
    setRootTagDb(null);
    db.close();
  });

  it('bos rootIds dizisi icin bos obje doner', () => {
    expect(getTagsForRoots([])).toEqual({});
  });

  it('birden fazla klasorun etiketlerini tek seferde getirir', () => {
    insertDummyRoot(db, 'r1');
    insertDummyRoot(db, 'r2');
    insertDummyRoot(db, 'r3');
    const t1 = insertTag(db, 'A');
    const t2 = insertTag(db, 'B');
    const t3 = insertTag(db, 'C');

    addTagToRoot('r1', t1);
    addTagToRoot('r1', t2);
    addTagToRoot('r2', t3);
    // r3 has no tags

    const result = getTagsForRoots(['r1', 'r2', 'r3']);
    expect(result['r1']).toBeDefined();
    expect(result['r1'].length).toBe(2);
    expect(result['r2']).toBeDefined();
    expect(result['r2'].length).toBe(1);
    expect(result['r2'][0].name).toBe('C');
    // r3 should not appear (no tags)
    expect(result['r3']).toBeUndefined();
  });

  it('etiketler isme gore siralidir', () => {
    insertDummyRoot(db, 'rr1');
    const tZ = insertTag(db, 'Zemin');
    const tA = insertTag(db, 'Altyapi');
    addTagToRoot('rr1', tZ);
    addTagToRoot('rr1', tA);

    const result = getTagsForRoots(['rr1']);
    expect(result['rr1'][0].name).toBe('Altyapi');
    expect(result['rr1'][1].name).toBe('Zemin');
  });

  it('500den fazla root id batch islemi yapar', () => {
    // 510 root olustur, her birine bir etiket ata
    const tagId = insertTag(db, 'BatchTest');
    const rootIds: string[] = [];
    for (let i = 0; i < 510; i++) {
      const rid = `batch_root_${i}`;
      rootIds.push(rid);
      insertDummyRoot(db, rid, `/batch/${i}`);
      addTagToRoot(rid, tagId);
    }

    const result = getTagsForRoots(rootIds);
    // Her root icin etiket donmus olmali
    let count = 0;
    for (const rid of rootIds) {
      if (result[rid]) count++;
    }
    expect(count).toBe(510);
  });
});

describe('rootTagService — setTagsForRoot (transaction)', () => {
  let db: any;

  beforeEach(async () => {
    db = await createTestDatabase();
    setRootTagDb(db);
    insertDummyRoot(db, 'root_set');
  });

  afterEach(() => {
    setRootTagDb(null);
    db.close();
  });

  it('bos tagIds dizisi ile tum etiketleri siler', () => {
    const t1 = insertTag(db, 'One');
    const t2 = insertTag(db, 'Two');
    addTagToRoot('root_set', t1);
    addTagToRoot('root_set', t2);
    expect(getTagsForRoot('root_set').length).toBe(2);

    expect(setTagsForRoot('root_set', [])).toBe(true);
    expect(getTagsForRoot('root_set')).toEqual([]);
  });

  it('mevcut etiketleri yenileriyle degistirir', () => {
    const t1 = insertTag(db, 'Eski1');
    const t2 = insertTag(db, 'Eski2');
    const t3 = insertTag(db, 'Yeni1');
    addTagToRoot('root_set', t1);
    addTagToRoot('root_set', t2);

    expect(setTagsForRoot('root_set', [t3])).toBe(true);
    const tags = getTagsForRoot('root_set');
    expect(tags.length).toBe(1);
    expect(tags[0].name).toBe('Yeni1');
  });

  it('birden fazla etiket toplu olarak atar', () => {
    const t1 = insertTag(db, 'Tag1');
    const t2 = insertTag(db, 'Tag2');
    const t3 = insertTag(db, 'Tag3');

    expect(setTagsForRoot('root_set', [t1, t2, t3])).toBe(true);
    const tags = getTagsForRoot('root_set');
    expect(tags.length).toBe(3);
  });

  it('ayni tag id tekrar ettiginde hata vermez', () => {
    const t1 = insertTag(db, 'Dup');
    // PRIMARY KEY constraint hatasi beklenir — transaction rollback yapilmali
    // Ancak root_tags PK (root_id, tag_id) oldugu icin duplicate INSERT hata verir
    // setTagsForRoot icinde try-catch ile ROLLBACK yapilir
    const result = setTagsForRoot('root_set', [t1, t1]);
    // Duplicate PK hatasi ROLLBACK tetikler, false doner
    expect(result).toBe(false);
    // ROLLBACK yapildigi icin eski durum korunur (oncesinde tag yoktu)
    expect(getTagsForRoot('root_set')).toEqual([]);
  });
});

describe('rootTagService — error handling (DB hata senaryolari)', () => {
  afterEach(() => {
    setRootTagDb(null);
  });

  it('addTagToRoot DB hatasi durumunda false doner', () => {
    const brokenDb = {
      run: () => { throw new Error('DB write error'); },
      exec: () => [],
      prepare: () => ({ bind: () => {}, step: () => false, getAsObject: () => ({}), free: () => {} }),
    };
    setRootTagDb(brokenDb as any);
    expect(addTagToRoot('x', 1)).toBe(false);
  });

  it('removeTagFromRoot DB hatasi durumunda false doner', () => {
    const brokenDb = {
      run: () => { throw new Error('DB write error'); },
      exec: () => [],
      prepare: () => ({ bind: () => {}, step: () => false, getAsObject: () => ({}), free: () => {} }),
    };
    setRootTagDb(brokenDb as any);
    expect(removeTagFromRoot('x', 1)).toBe(false);
  });

  it('getTagsForRoot DB hatasi durumunda bos dizi doner', () => {
    const brokenDb = {
      run: () => {},
      exec: () => [],
      prepare: () => { throw new Error('prepare failed'); },
    };
    setRootTagDb(brokenDb as any);
    expect(getTagsForRoot('x')).toEqual([]);
  });

  it('getTagsForRoots DB hatasi durumunda bos obje doner', () => {
    const brokenDb = {
      run: () => {},
      exec: () => [],
      prepare: () => { throw new Error('prepare failed'); },
    };
    setRootTagDb(brokenDb as any);
    expect(getTagsForRoots(['x'])).toEqual({});
  });

  it('setTagsForRoot transaction hatasi durumunda ROLLBACK yapar ve false doner', () => {
    let callCount = 0;
    const brokenDb = {
      run: (sql: string) => {
        callCount++;
        // BEGIN basarili, DELETE hata verir
        if (sql.startsWith('DELETE')) throw new Error('delete error');
      },
      exec: () => [],
      prepare: () => ({ bind: () => {}, step: () => false, getAsObject: () => ({}), free: () => {} }),
    };
    setRootTagDb(brokenDb as any);
    expect(setTagsForRoot('x', [1, 2])).toBe(false);
  });

  it('setTagsForRoot ROLLBACK da basarisiz olsa bile false doner', () => {
    const brokenDb = {
      run: (sql: string) => {
        if (sql === 'BEGIN TRANSACTION') return;
        throw new Error('all queries fail');
      },
      exec: () => [],
      prepare: () => ({ bind: () => {}, step: () => false, getAsObject: () => ({}), free: () => {} }),
    };
    setRootTagDb(brokenDb as any);
    // ROLLBACK da hata verecek ama catch icinde ignore ediliyor
    expect(setTagsForRoot('x', [1, 2])).toBe(false);
  });
});
