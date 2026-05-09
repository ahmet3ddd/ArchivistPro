/**
 * Archivist Pro — Export Servisi
 *
 * Arşiv verilerini dışa aktarma:
 * - CSV: Tablo formatında asset listesi
 * - JSON: Yapılandırılmış veri dışa aktarma
 */

import type { Asset } from '../types';
import { auditLog } from './logger';

/* ── Tipler ── */

export interface ExportOptions {
  /** Dışa aktarılacak asset'ler */
  assets: Asset[];
  /** Format: csv, json */
  format: 'csv' | 'json';
  /** Dahil edilecek alanlar (boş = hepsi) */
  fields?: string[];
  /** Dosya adı (uzantısız) */
  fileName?: string;
}


/* ── CSV Export ── */

/** Asset listesini CSV formatında string'e dönüştürür */
export function assetsToCSV(assets: Asset[], fields?: string[]): string {
  const defaultFields = [
    'fileName', 'filePath', 'fileSize', 'fileType', 'category',
    'projectName', 'projectPhase', 'materialGroup', 'colorTheme',
    'architecturalStyle', 'createdAt', 'modifiedAt', 'isIndexed',
  ];
  const cols = fields || defaultFields;

  // Header
  const header = cols.join(',');

  // Rows
  const rows = assets.map(asset => {
    return cols.map(field => {
      const value = (asset as unknown as Record<string, unknown>)[field];
      if (value === null || value === undefined) return '';
      const str = String(value);
      // CSV escape: çift tırnak ve virgül içeren değerleri sar
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  });

  return [header, ...rows].join('\n');
}

/** Asset listesini JSON formatında string'e dönüştürür */
export function assetsToJSON(assets: Asset[], fields?: string[]): string {
  if (!fields) return JSON.stringify(assets, null, 2);

  const filtered = assets.map(asset => {
    const obj: Record<string, unknown> = {};
    for (const field of fields) {
      obj[field] = (asset as unknown as Record<string, unknown>)[field];
    }
    return obj;
  });

  return JSON.stringify(filtered, null, 2);
}


/* ── Dosya İndirme ── */

/** String içeriği dosya olarak indirir (tarayıcı) */
export function downloadAsFile(content: string, fileName: string, mimeType = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Tam export akışı */
export function exportAssets(options: ExportOptions): void {
  const { assets, format, fields, fileName } = options;
  const name = fileName || `archivistpro_export_${new Date().toISOString().slice(0, 10)}`;

  let content: string;
  let ext: string;
  let mime: string;

  switch (format) {
    case 'csv':
      content = assetsToCSV(assets, fields);
      ext = 'csv';
      mime = 'text/csv;charset=utf-8';
      break;
    case 'json':
      content = assetsToJSON(assets, fields);
      ext = 'json';
      mime = 'application/json';
      break;
    default:
      return;
  }

  downloadAsFile(content, `${name}.${ext}`, mime);
  auditLog('ARCHIVE_EXPORT', `${name}.${ext}`, { format, assetCount: assets.length });
}

