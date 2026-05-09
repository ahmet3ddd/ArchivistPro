/**
 * Archivist Pro — DB Snapshot
 *
 * Tarama/indeksleme öncesi veritabanının otomatik yedeğini alır.
 * Son 5 snapshot tutulur, en eskisi otomatik silinir.
 *
 * Snapshot yapısı:
 *   backups/
 *     snapshot-2026-04-02T14-30-00.db
 *     snapshot-2026-04-02T09-15-00.db
 *     ...
 */

import { auditLog } from './logger';
import { getSetting } from './database';

/* ── Tauri invoke ── */

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/* ── Sabitler ── */

const DEFAULT_MAX_SNAPSHOTS = 5;
const MIN_MAX_SNAPSHOTS = 3;
const MAX_MAX_SNAPSHOTS = 30;

/** Settings'ten okur; geçersizse default 5. Range 3-30. */
function getMaxSnapshots(): number {
  try {
    const raw = getSetting('max_snapshots');
    if (raw === null) return DEFAULT_MAX_SNAPSHOTS;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return DEFAULT_MAX_SNAPSHOTS;
    return Math.max(MIN_MAX_SNAPSHOTS, Math.min(MAX_MAX_SNAPSHOTS, n));
  } catch {
    return DEFAULT_MAX_SNAPSHOTS;
  }
}

/* ── Tipler ── */

export interface SnapshotInfo {
  /** Dosya adı (snapshot-{tarih}.db) */
  fileName: string;
  /** Oluşturulma zamanı (ISO) */
  createdAt: string;
  /** Dosya boyutu (bytes) */
  fileSize: number;
}

/* ── Public API ── */

/**
 * Mevcut veritabanının snapshot'ını alır.
 * Son 5'ten fazla varsa en eskisini siler.
 * Tarama/indeksleme başlamadan hemen önce çağrılmalı.
 * @param archiveType "main" veya "local" — varsayılan "main"
 * @param prefix dosya adı öneki — varsayılan "snapshot-"; pre-restore akışı
 *   "snapshot-pre-restore-" kullanır (aynı listede ama isimden ayırt edilir).
 */
export async function createSnapshot(
  archiveType?: string,
  prefix: string = 'snapshot-',
): Promise<SnapshotInfo | null> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `${prefix}${timestamp}.db`;

  const result = await tauriInvoke<number>('create_db_snapshot', { fileName, archiveType: archiveType ?? 'main' });
  if (result === null) return null;

  const info: SnapshotInfo = {
    fileName,
    createdAt: new Date().toISOString(),
    fileSize: result,
  };

  auditLog('DB_SNAPSHOT_CREATE', fileName, { fileSize: result, archiveType });

  // Eski snapshot'ları temizle
  await _pruneOldSnapshots(archiveType);

  return info;
}

/**
 * Snapshot listesini döndürür (en yeni ilk sırada).
 * @param archiveType "main" veya "local" — varsayılan "main"
 */
export async function listSnapshots(archiveType?: string): Promise<SnapshotInfo[]> {
  const result = await tauriInvoke<SnapshotInfo[]>('list_db_snapshots', { archiveType: archiveType ?? 'main' });
  return result || [];
}

/**
 * Belirli bir snapshot'tan veritabanını geri yükler.
 * BU İŞLEM GERİ ALINAMAZ — mevcut DB üzerine yazılır.
 *
 * GÜVENLİK: Restore'dan önce mevcut DB'nin "pre-restore" yedeği otomatik alınır.
 * Kullanıcı yanlış snapshot seçerse Settings → Snapshots'tan
 * `snapshot-pre-restore-*.db` dosyasını seçip geri yükleyerek dönebilir.
 *
 * @param archiveType "main" veya "local" — varsayılan "main"
 */
export async function restoreSnapshot(fileName: string, archiveType?: string): Promise<boolean> {
  // Restore'dan önce mevcut DB'nin yedeği — kritik güvenlik ağı
  let preRestoreSnapshot: SnapshotInfo | null = null;
  try {
    preRestoreSnapshot = await createSnapshot(archiveType, 'snapshot-pre-restore-');
  } catch (err) {
    console.warn('[Snapshot] Pre-restore yedek alınamadı, restore yine devam:', err);
    // Kritik değil — kullanıcı yedeği zaten kaybetmiş olabilir; restore'u engellemiyoruz
  }

  const result = await tauriInvoke<boolean>('restore_db_snapshot', { fileName, archiveType: archiveType ?? 'main' });
  if (result) {
    auditLog('DB_SNAPSHOT_RESTORE', fileName, {
      archiveType,
      preRestoreBackup: preRestoreSnapshot?.fileName ?? null,
    });
  }
  return result === true;
}

/**
 * Belirli bir snapshot'ı siler.
 * @param archiveType "main" veya "local" — varsayılan "main"
 */
export async function deleteSnapshot(fileName: string, archiveType?: string): Promise<boolean> {
  const result = await tauriInvoke<boolean>('delete_db_snapshot', { fileName, archiveType: archiveType ?? 'main' });
  return result === true;
}

/** Settings'teki max_snapshots'tan fazla varsa en eskileri siler */
async function _pruneOldSnapshots(archiveType?: string): Promise<void> {
  const max = getMaxSnapshots();
  const snapshots = await listSnapshots(archiveType);
  if (snapshots.length <= max) return;

  // En yeniden eskiye sıralı olduğunu varsayıyoruz
  const toDelete = snapshots.slice(max);
  for (const snap of toDelete) {
    await deleteSnapshot(snap.fileName, archiveType);
  }
}

/** Snapshot sayısını döndürür */
export async function getSnapshotCount(): Promise<number> {
  const snapshots = await listSnapshots();
  return snapshots.length;
}
