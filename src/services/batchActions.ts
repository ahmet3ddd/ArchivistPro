/**
 * Archivist Pro — Toplu İşlem (Batch Actions)
 *
 * Birden fazla asset üzerinde aynı anda işlem yapma.
 * Desteklenen aksiyonlar:
 *   - Toplu etiket ekleme/çıkarma
 *   - Toplu taşıma
 *   - Toplu silme (çöp kutusuna)
 *   - Toplu metadata güncelleme
 *   - Toplu export
 */

import { addTagToAsset, removeTagFromAsset } from './tagService';
import { auditLog } from './logger';
import i18n from '../i18n';

/* ── Tipler ── */

export interface BatchResult {
  /** Başarıyla işlenen asset sayısı */
  success: number;
  /** Başarısız olan asset sayısı */
  failed: number;
  /** Toplam işlenen */
  total: number;
  /** Hata detayları (başarısız olanlar) */
  errors: Array<{ assetId: string; error: string }>;
}

export type BatchProgressCallback = (current: number, total: number, currentItem?: string) => void;

/* ── Toplu Etiket ── */

/** Birden fazla asset'e aynı etiket(ler)i ekler */
export function batchAddTags(
  assetIds: string[],
  tagIds: number[],
  onProgress?: BatchProgressCallback,
): BatchResult {
  const result: BatchResult = { success: 0, failed: 0, total: assetIds.length, errors: [] };

  for (let i = 0; i < assetIds.length; i++) {
    const assetId = assetIds[i];
    onProgress?.(i + 1, assetIds.length, assetId);

    let ok = true;
    for (const tagId of tagIds) {
      if (!addTagToAsset(assetId, tagId)) {
        ok = false;
      }
    }

    if (ok) {
      result.success++;
    } else {
      result.failed++;
      result.errors.push({ assetId, error: i18n.t('batchActions.tagAddFailed') });
    }
  }

  auditLog('SETTINGS_CHANGE', 'batch_add_tags', {
    assetCount: assetIds.length,
    tagIds,
    success: result.success,
    failed: result.failed,
  });

  return result;
}

/** Birden fazla asset'ten aynı etiket(ler)i kaldırır */
export function batchRemoveTags(
  assetIds: string[],
  tagIds: number[],
  onProgress?: BatchProgressCallback,
): BatchResult {
  const result: BatchResult = { success: 0, failed: 0, total: assetIds.length, errors: [] };

  for (let i = 0; i < assetIds.length; i++) {
    const assetId = assetIds[i];
    onProgress?.(i + 1, assetIds.length, assetId);

    let ok = true;
    for (const tagId of tagIds) {
      if (!removeTagFromAsset(assetId, tagId)) {
        ok = false;
      }
    }

    if (ok) {
      result.success++;
    } else {
      result.failed++;
      result.errors.push({ assetId, error: i18n.t('batchActions.tagRemoveFailed') });
    }
  }

  auditLog('SETTINGS_CHANGE', 'batch_remove_tags', {
    assetCount: assetIds.length,
    tagIds,
    success: result.success,
    failed: result.failed,
  });

  return result;
}

/* ── Toplu Metadata Güncelleme ── */

/** Birden fazla asset'in belirli alanlarını toplu günceller */
export function batchUpdateField(
  assetIds: string[],
  field: string,
  value: string,
  updateFn: (assetId: string, field: string, value: string) => boolean,
  onProgress?: BatchProgressCallback,
): BatchResult {
  const result: BatchResult = { success: 0, failed: 0, total: assetIds.length, errors: [] };

  for (let i = 0; i < assetIds.length; i++) {
    const assetId = assetIds[i];
    onProgress?.(i + 1, assetIds.length, assetId);

    if (updateFn(assetId, field, value)) {
      result.success++;
    } else {
      result.failed++;
      result.errors.push({ assetId, error: i18n.t('batchActions.updateFailed', { field }) });
    }
  }

  auditLog('METADATA_UPDATE', `batch_${field}`, {
    assetCount: assetIds.length,
    value,
    success: result.success,
  });

  return result;
}

/* ── Toplu Silme (Çöp Kutusuna) ── */

/** Birden fazla asset'i çöp kutusuna taşır */
export async function batchMoveToTrash(
  assetIds: string[],
  filePaths: string[],
  trashFn: (filePath: string) => Promise<unknown>,
  onProgress?: BatchProgressCallback,
): Promise<BatchResult> {
  const result: BatchResult = { success: 0, failed: 0, total: assetIds.length, errors: [] };

  for (let i = 0; i < assetIds.length; i++) {
    onProgress?.(i + 1, assetIds.length, filePaths[i]);

    try {
      const res = await trashFn(filePaths[i]);
      if (res !== null) {
        result.success++;
      } else {
        result.failed++;
        result.errors.push({ assetId: assetIds[i], error: i18n.t('batchActions.trashFailed') });
      }
    } catch (err) {
      result.failed++;
      result.errors.push({ assetId: assetIds[i], error: String(err) });
    }
  }

  auditLog('FILE_DELETE', 'batch_trash', {
    assetCount: assetIds.length,
    success: result.success,
    failed: result.failed,
  });

  return result;
}

/* ── Yardımcı ── */

/** Boş batch result oluşturur */
export function emptyBatchResult(): BatchResult {
  return { success: 0, failed: 0, total: 0, errors: [] };
}

/** Batch sonucunu birleştirir */
export function mergeBatchResults(a: BatchResult, b: BatchResult): BatchResult {
  return {
    success: a.success + b.success,
    failed: a.failed + b.failed,
    total: a.total + b.total,
    errors: [...a.errors, ...b.errors],
  };
}
