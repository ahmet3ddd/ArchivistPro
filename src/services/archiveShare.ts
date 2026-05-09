/**
 * Archivist Pro — LAN Arşiv Paylaşımı (Faz 1: Export/Import)
 *
 * .archivistpro dosya formatı ile arşiv paylaşımı.
 * Dosya yapısı: ZIP içinde DB + manifest JSON.
 *
 * Faz 1: Export/Import (dosya bazlı paylaşım)
 * Faz 2: Mini HTTP sunucu (ileride eklenecek)
 */

import { auditLog } from './logger';
import { APP_VERSION } from '../appVersion';
import { getAllAssets, getScannedRoots } from './database';

/* ── Tauri invoke ── */

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/* ── Tipler ── */

export interface ArchiveManifest {
  /** Format versiyonu */
  version: number;
  /** Oluşturan uygulama versiyonu */
  appVersion: string;
  /** Oluşturma zamanı */
  createdAt: string;
  /** Oluşturan kullanıcı/rol */
  createdBy: string;
  /** Arşiv açıklaması (opsiyonel) */
  description?: string;
  /** Toplam asset sayısı */
  assetCount: number;
  /** Ham DB boyutu (sıkıştırma öncesi) */
  dbSizeBytes: number;
  /** Sıkıştırılmış .archivistpro dosyasının disk boyutu */
  fileSizeBytes?: number;
  /** Yedekteki dosya yollarının ortak en uzun prefix'i — import path remap için varsayılan değer (tek-eşleme fallback) */
  samplePathPrefix?: string;
  /** Yedekteki taranan kök klasörler — çoklu path remap için kaynak liste */
  sourceRoots?: Array<{ path: string; assetCount: number }>;
}

export interface ImportResult {
  success: boolean;
  assetCount: number;
  error?: string;
  rolledBack?: boolean;
}

/* ── Path prefix tespiti ── */

/**
 * Asset path'lerinden ortak en uzun prefix'i bulur — dosya separator sınırına trim edilir.
 * Boşsa veya çok kısaysa (kök sürücü altı) boş string döner.
 * Import sırasında "Eski kök yol" input'una varsayılan değer olarak yazılır.
 */
function _commonPathPrefix(paths: string[]): string {
    if (paths.length === 0) return '';
    let prefix = paths[0];
    for (let i = 1; i < paths.length; i++) {
        const p = paths[i];
        while (prefix.length > 0 && !p.startsWith(prefix)) {
            prefix = prefix.slice(0, -1);
        }
        if (prefix.length === 0) return '';
    }
    // Son separator'a kadar trim — yarım klasör adı bırakma ("C:\Pro" yerine "C:\Projeler\")
    const lastSep = Math.max(prefix.lastIndexOf('\\'), prefix.lastIndexOf('/'));
    if (lastSep > 0) prefix = prefix.slice(0, lastSep + 1);
    // Çok kısa (örn. "C:\" veya "/") → anlamsız, boş döndür
    if (prefix.length < 4) return '';
    return prefix;
}

/* ── Export ── */

/**
 * Mevcut arşivi .archivistpro dosyası olarak dışa aktarır.
 * Dosya yapısı: ZIP → manifest.json + archive.db
 *
 * @param destPath Hedef dosya yolu (.archivistpro)
 * @param description Opsiyonel açıklama
 * @returns Manifest bilgisi veya null
 */
export async function exportArchive(
  destPath: string,
  description?: string,
): Promise<ArchiveManifest | null> {
  // Path remap altyapısı için kaynak bilgisi:
  // 1. sourceRoots — taranan kök klasörler (her biri için ayrı eşleme)
  // 2. samplePathPrefix — fallback (sourceRoots boşsa veya tek prefix yeterliyse)
  let samplePathPrefix: string | undefined;
  let sourceRoots: Array<{ path: string; assetCount: number }> | undefined;
  try {
    const roots = getScannedRoots();
    if (roots.length > 0) {
      sourceRoots = roots
        .map(r => ({ path: r.path, assetCount: r.fileCount ?? 0 }))
        .filter(r => r.path && r.path.length > 0);
    }
    const assets = getAllAssets();
    if (assets.length > 0) {
      const samplePaths = assets.slice(0, 200).map(a => a.filePath).filter(Boolean);
      const prefix = _commonPathPrefix(samplePaths);
      if (prefix) samplePathPrefix = prefix;
    }
  } catch { /* sessiz — manifest bilgisi opsiyonel */ }

  const manifest: ArchiveManifest = {
    version: 1,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    createdBy: 'admin',
    description,
    assetCount: 0,
    dbSizeBytes: 0,
    samplePathPrefix,
    sourceRoots,
  };

  const result = await tauriInvoke<{ assetCount: number; dbSize: number; fileSize: number }>('export_archive', {
    destPath,
    manifest: JSON.stringify(manifest),
  });

  if (!result) return null;

  manifest.assetCount = result.assetCount;
  manifest.dbSizeBytes = result.dbSize;
  manifest.fileSizeBytes = result.fileSize;

  auditLog('ARCHIVE_EXPORT', destPath, {
    assetCount: manifest.assetCount,
    dbSize: manifest.dbSizeBytes,
    description,
  });

  return manifest;
}

/**
 * .archivistpro dosyasının manifest bilgisini okur (import öncesi önizleme).
 *
 * @param filePath .archivistpro dosya yolu
 * @returns Manifest veya null
 */
export async function peekArchive(filePath: string): Promise<ArchiveManifest | null> {
  const result = await tauriInvoke<string>('peek_archive_manifest', { filePath });
  if (!result) return null;

  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

/**
 * .archivistpro dosyasını içe aktarır.
 * Mevcut yerel arşive birleştirir veya üzerine yazar.
 *
 * @param filePath .archivistpro dosya yolu
 * @param replaceExisting true ise mevcut arşivi siler
 * @returns Import sonucu
 */
export async function importArchive(
  filePath: string,
  replaceExisting = false,
): Promise<ImportResult> {
  // Disk alanı kontrolü — düşükse uyarı (engellemez)
  try {
    const { checkDiskSpaceAndWarn } = await import('./database');
    await checkDiskSpaceAndWarn();
  } catch { /* sessiz */ }

  let result: ImportResult;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    result = await invoke<ImportResult>('import_archive', {
      filePath,
      replaceExisting,
    });
  } catch (err) {
    // Rust Err(String) — require_admin, dosya açma, ZIP parse hatası vb.
    return { success: false, assetCount: 0, error: String(err) };
  }

  if (result.success) {
    auditLog('ARCHIVE_IMPORT', filePath, {
      assetCount: result.assetCount,
      replaceExisting,
    });
  } else if (result.rolledBack) {
    auditLog('ARCHIVE_IMPORT_ROLLBACK', filePath, {
      error: result.error,
    });
  }

  return result;
}

/* ── Dosya Uzantısı ── */

/** ArchivistPro arşiv dosya uzantısı */
export const ARCHIVE_EXTENSION = '.archivistpro';

/** Dosya adı önerisi oluşturur */
export function suggestArchiveFileName(archiveName?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const name = archiveName || 'arsiv';
  return `${name}_${date}${ARCHIVE_EXTENSION}`;
}
