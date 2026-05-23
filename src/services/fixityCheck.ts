/**
 * Fixity Check (Bit-Rot Tespit)
 *
 * Asset'lerin diskteki SHA-256 hash'ini yeniden hesaplayıp DB'deki
 * `contentHash` ile karşılaştırır. Eşleşmeyen kayıtlar bit-rot şüphelisi
 * olarak işaretlenir (depolama bozulması, donanım hatası, manipülasyon).
 *
 * Mimarisi:
 *  - Tarama sırasında zaten doldurulan `contentHash`'i baseline olarak alır
 *  - Sample (varsayılan %10) ile rastgele asset seçer — büyük arşivlerde tam
 *    rehash maliyetli olur (TB ölçeği saatler sürer); örnekleme yeterlidir
 *  - Rust `compute_file_hash` komutunu yeniden kullanır (image_analysis.rs:11)
 *  - DB'ye yazma YOK — sadece in-memory rapor; kullanıcı sonucu görüp karar verir
 *
 * Phase 1: kullanıcı tetikli (Health Modal'dan butonla); auto-schedule yok.
 */

import { invoke } from '@tauri-apps/api/core';
import type { Asset } from '../types';

export type FixityStatus = 'ok' | 'mismatch' | 'missing' | 'no_baseline' | 'error';

export interface FixityResult {
    asset: Asset;
    status: FixityStatus;
    /** Hesaplanan yeni hash (status=mismatch ise farklı, ok ise eşit) */
    computedHash?: string;
    /** Hata mesajı (status=error veya missing) */
    error?: string;
}

export interface FixitySummary {
    total: number;
    sampled: number;
    ok: number;
    mismatch: number;
    missing: number;
    noBaseline: number;
    error: number;
    mismatches: FixityResult[];
    durationMs: number;
}

export interface FixityController {
    cancelled: boolean;
    cancel: () => void;
}

export function createFixityController(): FixityController {
    const c: FixityController = {
        cancelled: false,
        cancel: () => { c.cancelled = true; },
    };
    return c;
}

/** Fisher-Yates shuffle (immutable input) */
function sampleAssets(assets: Asset[], percent: number): Asset[] {
    const clamped = Math.max(1, Math.min(100, Math.round(percent)));
    if (clamped >= 100) return assets.slice();
    const count = Math.max(1, Math.ceil((assets.length * clamped) / 100));
    const arr = assets.slice();
    // Sadece ihtiyacımız olan ilk `count` öğeyi karıştır — partial shuffle
    for (let i = 0; i < count && i < arr.length - 1; i++) {
        const j = i + Math.floor(Math.random() * (arr.length - i));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, count);
}

/**
 * Sample bazlı bit-rot taraması.
 *
 * @param assets    Aktif arşivin tüm asset'leri
 * @param percent   1-100 arası örnek yüzdesi (default 10)
 * @param onProgress İlerleme callback'i
 * @param controller İptal kontrolü (opsiyonel)
 */
export async function runFixitySample(
    assets: Asset[],
    percent: number = 10,
    onProgress?: (done: number, total: number, current: string) => void,
    controller?: FixityController,
): Promise<FixitySummary> {
    const startMs = Date.now();
    const sample = sampleAssets(assets, percent);
    const summary: FixitySummary = {
        total: assets.length,
        sampled: sample.length,
        ok: 0,
        mismatch: 0,
        missing: 0,
        noBaseline: 0,
        error: 0,
        mismatches: [],
        durationMs: 0,
    };

    for (let i = 0; i < sample.length; i++) {
        if (controller?.cancelled) break;
        const asset = sample[i];
        onProgress?.(i, sample.length, asset.fileName);

        const baseline = asset.contentHash;
        if (!baseline) {
            summary.noBaseline += 1;
            continue;
        }

        try {
            const computed = await invoke<string>('compute_file_hash', { path: asset.filePath });
            if (computed === baseline) {
                summary.ok += 1;
            } else {
                summary.mismatch += 1;
                summary.mismatches.push({ asset, status: 'mismatch', computedHash: computed });
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            // "Dosya açılamadı" → diskten silinmiş; ayrı kategori
            if (/açılamadı|not found|cannot find/i.test(msg)) {
                summary.missing += 1;
                summary.mismatches.push({ asset, status: 'missing', error: msg });
            } else {
                summary.error += 1;
                summary.mismatches.push({ asset, status: 'error', error: msg });
            }
        }
    }

    onProgress?.(sample.length, sample.length, '');
    summary.durationMs = Date.now() - startMs;
    return summary;
}
