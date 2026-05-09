/**
 * ArchivistPro — Staleness Checker
 *
 * Aktif arşivdeki asset'lerin dosya sistemi üzerindeki durumunu kontrol eder.
 * - missing: diskte yok (silinmiş/taşınmış)
 * - stale:   mtime tarama anındakinden yeni (değiştirilmiş)
 * - ok:      tutarlı
 * - unknown: fsMtime bilinmiyor (eski kayıt, aşamalı migration)
 *
 * Chunk'lı çalışır (1000 dosya/chunk), UI'yi blocklamaz, iptal edilebilir.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Asset } from '../types';
import { debugLog } from './logger';
import { expectedScannerVersion } from './fileScanner';

/** FS mtime ile tarama anındaki mtime arasında tolere edilen fark (saniye).
 *  OneDrive/Dropbox sync'i ±1sn dalgalanma yaratabilir. */
const DEFAULT_TOLERANCE_SECS = 2;

const CHUNK_SIZE = 1000;

export type StalenessStatus = 'ok' | 'stale' | 'missing' | 'unknown';

interface RustCheckItem {
    path: string;
    known_mtime: number | null;
}

interface RustCheckResult {
    path: string;
    status: StalenessStatus;
    current_mtime: number | null;
}

export interface StalenessSummary {
    staleIds: Set<string>;
    missingIds: Set<string>;
    /** Tarayıcı sürümü eski olan asset'ler — yeniden tarama daha fazla veri çıkarır */
    versionOutdatedIds: Set<string>;
    checkedCount: number;
    cancelled: boolean;
}

export interface StalenessController {
    cancel: () => void;
}

/**
 * Chunk'lı, iptal edilebilir staleness kontrolü.
 * `onProgress` her chunk'tan sonra çağrılır (ilerleme göstergesi için).
 */
export async function checkStalenessChunked(
    assets: Asset[],
    onProgress?: (done: number, total: number) => void,
    controller?: StalenessController,
): Promise<StalenessSummary> {
    const summary: StalenessSummary = {
        staleIds: new Set(),
        missingIds: new Set(),
        versionOutdatedIds: new Set(),
        checkedCount: 0,
        cancelled: false,
    };

    // Pahalı değil — tüm asset'leri tarayıp version eskimiş olanları topla
    for (const a of assets) {
        const actual = a.metadataVersion ?? 1;
        const expected = expectedScannerVersion(a.fileType);
        if (actual < expected) summary.versionOutdatedIds.add(a.id);
    }

    let cancelled = false;
    if (controller) {
        const origCancel = controller.cancel;
        controller.cancel = () => { cancelled = true; origCancel?.(); };
    }

    // Yalnızca yolu olan asset'leri kontrol et
    const items = assets.filter((a) => a.filePath);
    const total = items.length;

    for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        if (cancelled) {
            summary.cancelled = true;
            return summary;
        }

        const chunk = items.slice(i, i + CHUNK_SIZE);
        const payload: RustCheckItem[] = chunk.map((a) => ({
            path: a.filePath,
            known_mtime: a.fsMtime ?? null,
        }));

        try {
            const results = await invoke<RustCheckResult[]>('check_paths_staleness', {
                items: payload,
                toleranceSecs: DEFAULT_TOLERANCE_SECS,
            });

            // Path → asset id eşlemesi
            const pathToId = new Map(chunk.map((a) => [a.filePath, a.id]));

            for (const r of results) {
                const id = pathToId.get(r.path);
                if (!id) continue;
                if (r.status === 'missing') summary.missingIds.add(id);
                else if (r.status === 'stale') summary.staleIds.add(id);
            }
        } catch (err) {
            debugLog('StalenessChecker', `chunk ${i} error`, err);
            // Chunk hatası sessizce geçilir — sonraki chunk'ı dene
        }

        summary.checkedCount = Math.min(i + chunk.length, total);
        onProgress?.(summary.checkedCount, total);

        // UI'ye nefes aldır
        await new Promise((r) => setTimeout(r, 0));
    }

    return summary;
}
