/**
 * Archivist Pro — Soft Delete Çöp Kutusu
 *
 * Dosyalar silindiğinde .archivistpro-trash/ klasörüne taşınır.
 * Undo ile geri alınabilir.
 * Çöp kutusu boşaltma undo edilemez (öncesinde uyarı gösterilir).
 *
 * Çöp kutusu yapısı:
 *   .archivistpro-trash/
 *     {timestamp}_{orijinal_dosya_adı}
 *     _manifest.json  → orijinal yol eşlemeleri
 */

import { auditLog } from './logger';

/* ── Tipler ── */

export interface TrashEntry {
  /** Çöp kutusundaki dosya adı */
  trashName: string;
  /** Orijinal tam dosya yolu */
  originalPath: string;
  /** Silinme zamanı (ISO) */
  deletedAt: string;
  /** Dosya boyutu (bytes) */
  fileSize: number;
}

export interface TrashManifest {
  entries: TrashEntry[];
}

/* ── Tauri invoke ── */

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/* ── Çöp kutusu yolu ── */

let _trashDir: string | null = null;

/** Çöp kutusu dizinini ayarlar (uygulama başlangıcında çağrılmalı) */
export function setTrashDir(dir: string): void {
  _trashDir = dir;
}

/** Çöp kutusu dizinini döndürür */
export function getTrashDir(): string | null {
  return _trashDir;
}

/* ── Manifest yönetimi ── */

async function _readManifest(): Promise<TrashManifest> {
  if (!_trashDir) return { entries: [] };
  try {
    const data = await tauriInvoke<string>('read_trash_manifest', { trashDir: _trashDir });
    return data ? JSON.parse(data) : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

async function _writeManifest(manifest: TrashManifest): Promise<void> {
  if (!_trashDir) return;
  await tauriInvoke('write_trash_manifest', {
    trashDir: _trashDir,
    data: JSON.stringify(manifest, null, 2),
  });
}

/* ── Public API ── */

/**
 * Dosyayı çöp kutusuna taşır (soft delete).
 * Orijinal yol manifest'e kaydedilir.
 * Döndürülen TrashEntry undo için kullanılır.
 */
export async function moveToTrash(filePath: string): Promise<TrashEntry | null> {
  if (!_trashDir) return null;

  const fileName = filePath.split(/[/\\]/).pop() || 'unknown';
  const timestamp = Date.now();
  const trashName = `${timestamp}_${fileName}`;

  const result = await tauriInvoke<number>('trash_move_file', {
    sourcePath: filePath,
    trashDir: _trashDir,
    trashName,
  });

  if (result === null) return null;

  const entry: TrashEntry = {
    trashName,
    originalPath: filePath,
    deletedAt: new Date().toISOString(),
    fileSize: result,
  };

  // Manifest'e ekle
  const manifest = await _readManifest();
  manifest.entries.push(entry);
  await _writeManifest(manifest);

  auditLog('FILE_DELETE', filePath, { trashName, fileSize: result });
  return entry;
}

/**
 * Çöp kutusundan geri yükler (undo).
 * Dosya orijinal konumuna taşınır.
 */
export async function restoreFromTrash(entry: TrashEntry): Promise<boolean> {
  if (!_trashDir) return false;

  const result = await tauriInvoke<boolean>('trash_restore_file', {
    trashDir: _trashDir,
    trashName: entry.trashName,
    originalPath: entry.originalPath,
  });

  if (!result) return false;

  // Manifest'ten kaldır
  const manifest = await _readManifest();
  manifest.entries = manifest.entries.filter((e) => e.trashName !== entry.trashName);
  await _writeManifest(manifest);

  return true;
}

/** Çöp kutusundaki dosyaları listeler */
export async function listTrash(): Promise<TrashEntry[]> {
  const manifest = await _readManifest();
  return manifest.entries;
}

/** Çöp kutusundaki toplam boyutu hesaplar */
export async function getTrashSize(): Promise<number> {
  const manifest = await _readManifest();
  return manifest.entries.reduce((sum, e) => sum + e.fileSize, 0);
}

/**
 * Çöp kutusunu tamamen boşaltır.
 * BU İŞLEM GERİ ALINAMAZ — UI'da uyarı gösterilmeli.
 */
export async function emptyTrash(): Promise<number> {
  if (!_trashDir) return 0;

  const manifest = await _readManifest();
  const count = manifest.entries.length;

  await tauriInvoke('trash_empty', { trashDir: _trashDir });
  await _writeManifest({ entries: [] });

  auditLog('FILE_DELETE', '.archivistpro-trash', { action: 'empty', count });
  return count;
}
