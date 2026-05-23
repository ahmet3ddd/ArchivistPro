import { describe, it, expect, vi } from 'vitest';
import {
  batchAddTags,
  batchRemoveTags,
  batchUpdateField,
  batchMoveToTrash,
  emptyBatchResult,
  mergeBatchResults,
} from '../services/batchActions';

vi.mock('../services/logger', () => ({ auditLog: vi.fn(), debugLog: vi.fn() }));
vi.mock('../services/tagService', () => ({
  addTagToAsset: vi.fn(() => true),
  removeTagFromAsset: vi.fn(() => true),
}));

describe('Batch — Toplu Etiket', () => {
  it('batchAddTags birden fazla asset/tag ile çalışır', () => {
    const result = batchAddTags(['a1', 'a2', 'a3'], [1, 2]);
    expect(result.total).toBe(3);
    expect(result.success).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('batchRemoveTags çalışır', () => {
    const result = batchRemoveTags(['a1', 'a2'], [1]);
    expect(result.total).toBe(2);
    expect(result.success).toBe(2);
  });

  it('progress callback çağrılır', () => {
    const cb = vi.fn();
    batchAddTags(['a1', 'a2'], [1], cb);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenCalledWith(1, 2, 'a1');
    expect(cb).toHaveBeenCalledWith(2, 2, 'a2');
  });

  it('boş asset listesiyle 0 döner', () => {
    const result = batchAddTags([], [1]);
    expect(result.total).toBe(0);
    expect(result.success).toBe(0);
  });
});

describe('Batch — Toplu Metadata Güncelleme', () => {
  it('batchUpdateField başarılı günceller', () => {
    const updateFn = vi.fn(() => true);
    const result = batchUpdateField(['a1', 'a2'], 'projectPhase', 'Uygulama', updateFn);
    expect(result.success).toBe(2);
    expect(updateFn).toHaveBeenCalledTimes(2);
    expect(updateFn).toHaveBeenCalledWith('a1', 'projectPhase', 'Uygulama');
  });

  it('başarısız güncellemeler errors listesine eklenir', () => {
    const updateFn = vi.fn((id: string) => id !== 'a2');
    const result = batchUpdateField(['a1', 'a2', 'a3'], 'materialGroup', 'Beton', updateFn);
    expect(result.success).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0].assetId).toBe('a2');
  });
});

describe('Batch — Toplu Silme', () => {
  it('batchMoveToTrash başarılı taşır', async () => {
    const trashFn = vi.fn(async () => ({ trashName: 'x' }));
    const result = await batchMoveToTrash(
      ['a1', 'a2'],
      ['/path/file1.dwg', '/path/file2.max'],
      trashFn,
    );
    expect(result.success).toBe(2);
    expect(trashFn).toHaveBeenCalledTimes(2);
  });

  it('başarısız silme hata kaydeder', async () => {
    const trashFn = vi.fn(async (path: string) => {
      if (path.includes('file2')) return null;
      return { trashName: 'x' };
    });
    const result = await batchMoveToTrash(
      ['a1', 'a2'],
      ['/path/file1.dwg', '/path/file2.max'],
      trashFn,
    );
    expect(result.success).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('exception yakalıyor', async () => {
    const trashFn = vi.fn(async () => { throw new Error('Disk dolu'); });
    const result = await batchMoveToTrash(['a1'], ['/path/f.dwg'], trashFn);
    expect(result.failed).toBe(1);
    expect(result.errors[0].error).toContain('Disk dolu');
  });
});

describe('Batch — Yardımcılar', () => {
  it('emptyBatchResult boş sonuç döner', () => {
    const r = emptyBatchResult();
    expect(r.success).toBe(0);
    expect(r.total).toBe(0);
    expect(r.errors).toEqual([]);
  });

  it('mergeBatchResults iki sonucu birleştirir', () => {
    const a = { success: 3, failed: 1, total: 4, errors: [{ assetId: 'x', error: 'err' }] };
    const b = { success: 2, failed: 0, total: 2, errors: [] };
    const merged = mergeBatchResults(a, b);
    expect(merged.success).toBe(5);
    expect(merged.failed).toBe(1);
    expect(merged.total).toBe(6);
    expect(merged.errors.length).toBe(1);
  });
});
