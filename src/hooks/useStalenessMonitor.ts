/**
 * ArchivistPro — Staleness Monitor
 *
 * Arka planda aktif arşivin güncellik durumunu takip eder.
 * Tetikleyiciler:
 *   - App mount + 2sn (DB + asset listesi hazır olduktan sonra)
 *   - Window focus, son kontrolden 5dk geçtiyse
 *   - Manuel "Şimdi kontrol et" (startCheck dönüşü)
 *   - Aktif arşiv değişimi → yeni kontrol
 */

import { useCallback, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { checkStalenessChunked } from '../services/stalenessChecker';
import type { Asset } from '../types';

const AUTO_CHECK_DELAY_MS = 2000;
const FOCUS_REFRESH_MIN_INTERVAL_MS = 5 * 60_000;

export function useStalenessMonitor(assets: Asset[], archiveKey: string | null) {
    const status = useStore((s) => s.stalenessCheck.status);
    const lastCheckedAt = useStore((s) => s.stalenessCheck.lastCheckedAt);
    const setStatus = useStore((s) => s.setStalenessStatus);
    const setProgress = useStore((s) => s.setStalenessProgress);
    const setResult = useStore((s) => s.setStalenessResult);
    const resetStaleness = useStore((s) => s.resetStaleness);

    const inflightRef = useRef(false);
    const lastArchiveRef = useRef<string | null>(null);

    const startCheck = useCallback(async () => {
        if (inflightRef.current) return;
        if (assets.length === 0) return;

        inflightRef.current = true;
        setStatus('checking');
        setProgress(0, assets.length);

        try {
            const summary = await checkStalenessChunked(
                assets,
                (done, total) => setProgress(done, total),
            );
            if (!summary.cancelled) {
                setResult(summary.staleIds, summary.missingIds, summary.versionOutdatedIds);
            } else {
                setStatus('idle');
            }
        } catch {
            setStatus('error');
        } finally {
            inflightRef.current = false;
        }
    }, [assets, setStatus, setProgress, setResult]);

    // Aktif arşiv değişirse durumu sıfırla
    useEffect(() => {
        if (lastArchiveRef.current !== null && lastArchiveRef.current !== archiveKey) {
            resetStaleness();
        }
        lastArchiveRef.current = archiveKey;
    }, [archiveKey, resetStaleness]);

    // Mount + 2sn → otomatik başlat (arşiv başına bir kez)
    useEffect(() => {
        if (!archiveKey || assets.length === 0) return;
        if (status !== 'idle') return;
        const timer = setTimeout(() => { startCheck(); }, AUTO_CHECK_DELAY_MS);
        return () => clearTimeout(timer);
    }, [archiveKey, assets.length, status, startCheck]);

    // Pencere tekrar odaklandığında, son kontrolden yeterince zaman geçtiyse yenile
    useEffect(() => {
        const handler = () => {
            if (document.hidden) return;
            if (!lastCheckedAt) return;
            if (Date.now() - lastCheckedAt < FOCUS_REFRESH_MIN_INTERVAL_MS) return;
            if (inflightRef.current) return;
            startCheck();
        };
        document.addEventListener('visibilitychange', handler);
        window.addEventListener('focus', handler);
        return () => {
            document.removeEventListener('visibilitychange', handler);
            window.removeEventListener('focus', handler);
        };
    }, [lastCheckedAt, startCheck]);

    return { startCheck };
}
