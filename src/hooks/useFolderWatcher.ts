/**
 * useFolderWatcher
 *
 * Aktif scanned_roots'lar için Rust folder_watcher'ını başlatır ve
 * `folder_changed` Tauri event'lerini dinler.
 *
 * Phase 1: Sadece toast bildirim (otomatik tarama yok)
 * Phase 2: Settings'te toggle ile kapatılabilir; opt-in `auto_rescan`
 *          aktifse FS event sonrası 60sn sessizlik sağlanınca
 *          `archivist:folderWatchAutoRescan` window event'i dispatch edilir
 *          (App.tsx dinleyip scan.handleRescanFolder çağırır).
 *
 * Davranış:
 *  - Login + dbReady + folder_watch_enabled='true' sonrası watch başlatılır
 *  - FS event geldiğinde 30sn'de bir aynı root için tek toast gösterilir
 *  - Auto-rescan opt-in: 60sn boyunca yeni event gelmezse rescan tetiklenir
 *  - Logout/unmount'ta tüm watcher'lar kapatılır
 *  - scanned_roots veya settings değişirse yeniden bağlanır
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import {
    useFolderWatchSettings,
    FOLDER_WATCH_AUTO_RESCAN_EVENT,
    type FolderWatchAutoRescanDetail,
} from './useFolderWatchSettings';

const TOAST_DEBOUNCE_MS = 30_000;
const AUTO_RESCAN_QUIET_MS = 60_000;

interface FolderChangePayload {
    rootPath: string;
    kind: 'created' | 'modified' | 'removed' | 'other';
}

export function useFolderWatcher(dbReady: boolean) {
    const isLoggedIn = useStore((s) => s.isLoggedIn);
    const scannedRoots = useStore((s) => s.scannedRoots);
    const { enabled, autoRescan } = useFolderWatchSettings();
    const lastToastByRoot = useRef<Map<string, number>>(new Map());
    const rescanTimerByRoot = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    useEffect(() => {
        if (!isLoggedIn || !dbReady || !enabled) return;

        let cancelled = false;
        let unlisten: (() => void) | null = null;
        const timersSnapshot = rescanTimerByRoot.current;

        (async () => {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                const { listen } = await import('@tauri-apps/api/event');
                const { notifyInfo } = await import('../services/notificationCenter');
                const { default: i18n } = await import('../i18n');

                const activeRoots = scannedRoots.filter((r) => r.status === 'active');
                for (const root of activeRoots) {
                    if (cancelled) return;
                    try {
                        await invoke('start_watching_root', { path: root.path });
                    } catch (err) {
                        if (import.meta.env.DEV) {
                            console.warn('[folder_watcher] watch başarısız:', root.path, err);
                        }
                    }
                }

                if (cancelled) return;

                const unlistenFn = await listen<FolderChangePayload>('folder_changed', (event) => {
                    const { rootPath } = event.payload;
                    const now = Date.now();
                    const last = lastToastByRoot.current.get(rootPath) ?? 0;
                    if (now - last >= TOAST_DEBOUNCE_MS) {
                        lastToastByRoot.current.set(rootPath, now);
                        const message = i18n.t('folderWatcher.toast.message', { path: rootPath });
                        useStore.getState().addToast(message, 'info');
                        notifyInfo(i18n.t('folderWatcher.toast.title'), message);
                    }

                    // Auto-rescan opt-in: her event timer'ı sıfırlar; 60sn sessizlik = rescan
                    if (autoRescan) {
                        const existing = rescanTimerByRoot.current.get(rootPath);
                        if (existing) clearTimeout(existing);
                        const timer = setTimeout(() => {
                            rescanTimerByRoot.current.delete(rootPath);
                            const detail: FolderWatchAutoRescanDetail = { rootPath };
                            window.dispatchEvent(
                                new CustomEvent<FolderWatchAutoRescanDetail>(
                                    FOLDER_WATCH_AUTO_RESCAN_EVENT,
                                    { detail },
                                ),
                            );
                        }, AUTO_RESCAN_QUIET_MS);
                        rescanTimerByRoot.current.set(rootPath, timer);
                    }
                });

                if (cancelled) {
                    unlistenFn();
                    return;
                }
                unlisten = unlistenFn;
            } catch (err) {
                if (import.meta.env.DEV) {
                    console.warn('[folder_watcher] init hatası:', err);
                }
            }
        })();

        return () => {
            cancelled = true;
            if (unlisten) unlisten();
            // Bekleyen rescan timer'larını iptal et
            for (const t of timersSnapshot.values()) clearTimeout(t);
            timersSnapshot.clear();
            // Tüm Rust watcher'ları kapat (Drop ile thread biter)
            import('@tauri-apps/api/core').then(({ invoke }) => {
                invoke('stop_all_watchers').catch(() => { /* sessizce */ });
            }).catch(() => { /* test ortamında Tauri yok */ });
        };
    }, [isLoggedIn, dbReady, enabled, autoRescan, scannedRoots]);
}
