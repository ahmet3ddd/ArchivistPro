/**
 * Tarama raporu servisleri — APP_DATA/scan-reports/ altındaki TXT'lere erişim,
 * okuma, sistem editöründe açma. Backend tarafı scan_db.rs Rust modülünde.
 */

import { invoke } from '@tauri-apps/api/core';
import { debugLog } from './logger';

export interface ScanReportFile {
    path: string;
    name: string;
    size: number;
    /** Unix epoch saniye (string) — disk modified time */
    modifiedIso: string;
}

export interface ScanReportSummary {
    rootLabel: string;
    rootPath: string;
    startedAt: string;
    finishedAt: string;
    totalFound: number;
    scannedCount: number;
    errorCount: number;
    entryCount: number;
    /** Kategori → sayım */
    byCategory: Record<string, number>;
}

export interface ParsedScanReportEntry {
    filePath: string;
    category: string;
    reason: string;
    timestamp: string;
}

export interface ParsedScanReport {
    summary: ScanReportSummary;
    entries: ParsedScanReportEntry[];
    /** Ham TXT içeriği (export ve fallback için) */
    rawText: string;
}

export async function listScanReports(): Promise<ScanReportFile[]> {
    try {
        const raw = await invoke<Array<{ path: string; name: string; size: number; modified_iso: string }>>('list_scan_reports');
        return raw.map(r => ({ path: r.path, name: r.name, size: r.size, modifiedIso: r.modified_iso }));
    } catch (err) {
        debugLog('ScanReports', 'list error', err);
        return [];
    }
}

export async function readScanReportFile(filePath: string): Promise<string | null> {
    try {
        return await invoke<string>('read_scan_report_file', { filePath });
    } catch (err) {
        debugLog('ScanReports', 'read error', err);
        return null;
    }
}

export async function openScanReportInDefaultApp(filePath: string): Promise<boolean> {
    try {
        await invoke<void>('open_scan_report_in_default_app', { filePath });
        return true;
    } catch (err) {
        debugLog('ScanReports', 'open error', err);
        return false;
    }
}

/**
 * write_scan_report'un ürettiği TXT formatını parse eder. Format başlık + özet
 * + kategori başına gruplanmış liste şeklindedir; bkz. scan_db.rs:write_scan_report.
 *
 * Parse edilemeyen alanlar boş döner — UI ham metni `rawText`'ten gösterebilir.
 */
export function parseScanReportText(raw: string): ParsedScanReport {
    const lines = raw.split(/\r?\n/);
    const summary: ScanReportSummary = {
        rootLabel: '',
        rootPath: '',
        startedAt: '',
        finishedAt: '',
        totalFound: 0,
        scannedCount: 0,
        errorCount: 0,
        entryCount: 0,
        byCategory: {},
    };
    const entries: ParsedScanReportEntry[] = [];

    let i = 0;
    // ─ Başlık alanları (Klasör, Yol, Başlangıç, Bitiş, Bulunan, İşlenen, Hata sayısı, Rapor giriş) ─
    const headerMap: Record<string, (val: string) => void> = {
        'Klasör': v => { summary.rootLabel = v; },
        'Yol': v => { summary.rootPath = v; },
        'Başlangıç': v => { summary.startedAt = v; },
        'Bitiş': v => { summary.finishedAt = v; },
        'Bulunan': v => { summary.totalFound = parseInt(v.replace(/[^\d]/g, ''), 10) || 0; },
        'İşlenen': v => { summary.scannedCount = parseInt(v.replace(/[^\d]/g, ''), 10) || 0; },
        'Hata sayısı': v => { summary.errorCount = parseInt(v.replace(/[^\d]/g, ''), 10) || 0; },
        'Rapor giriş': v => { summary.entryCount = parseInt(v.replace(/[^\d]/g, ''), 10) || 0; },
    };
    while (i < lines.length) {
        const line = lines[i];
        const m = /^(\S[^:]*?)\s*:\s*(.*)$/.exec(line);
        if (m) {
            const key = m[1].trim();
            const val = m[2].trim();
            if (headerMap[key]) headerMap[key](val);
            else if (key === 'Kategori Özeti') break;
        }
        if (line.startsWith('Kategori Özeti')) break;
        i++;
    }

    // ─ Kategori özet satırları: "  cat_name           : 12" ─
    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith('===')) { i++; break; }
        const m = /^\s+(\S+)\s+:\s+(\d+)\s*$/.exec(line);
        if (m) summary.byCategory[m[1]] = parseInt(m[2], 10);
        i++;
    }

    // ─ Detay grupları: "[ category ]  (N kayıt)" ardından her kayıt 3 satır ─
    let currentCategory = '';
    while (i < lines.length) {
        const line = lines[i];
        const groupHeader = /^\[\s*(\S+)\s*\]/.exec(line);
        if (groupHeader) {
            currentCategory = groupHeader[1];
            i++;
            continue;
        }
        // Entry: ilk satır path (2 boşluk indent), sonraki "      → reason", sonraki "      @ timestamp"
        if (currentCategory && /^ {2}\S/.test(line) && !line.startsWith('  →') && !line.startsWith('  @')) {
            const filePath = line.trim();
            const reasonLine = lines[i + 1] || '';
            const timestampLine = lines[i + 2] || '';
            const reason = reasonLine.replace(/^\s*→\s*/, '').trim();
            const timestamp = timestampLine.replace(/^\s*@\s*/, '').trim();
            entries.push({ filePath, category: currentCategory, reason, timestamp });
            i += 3;
            continue;
        }
        i++;
    }

    return { summary, entries, rawText: raw };
}
