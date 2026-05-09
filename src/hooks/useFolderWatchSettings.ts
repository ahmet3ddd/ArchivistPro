/**
 * Klasör izleme (folder watcher) ayarları için reactive hook.
 *
 * DB anahtarları:
 *  - folder_watch_enabled       ('true' | 'false', default = 'true')  → genel açma/kapama
 *  - folder_watch_auto_rescan   ('true' | 'false', default = 'false') → opt-in otomatik yeniden tarama
 *
 * Settings'te toggle değişince `archivist:folderWatchChanged` window event'i
 * dispatch edilir; abone bileşenler/hook'lar anında yeniden render olur.
 */

import { useEffect, useState } from 'react';
import { getSetting } from '../services/database';
import { useStore } from '../store/useStore';

export const FOLDER_WATCH_CHANGED_EVENT = 'archivist:folderWatchChanged';
export const FOLDER_WATCH_AUTO_RESCAN_EVENT = 'archivist:folderWatchAutoRescan';

export interface FolderWatchAutoRescanDetail {
    rootPath: string;
}

function readEnabled(): boolean {
    return getSetting('folder_watch_enabled') !== 'false';
}

function readAutoRescan(): boolean {
    return getSetting('folder_watch_auto_rescan') === 'true';
}

export function useFolderWatchSettings(): { enabled: boolean; autoRescan: boolean } {
    const dbReady = useStore((s) => s.dbReady);
    const [, setTick] = useState(0);

    useEffect(() => {
        const handler = () => setTick((n) => n + 1);
        window.addEventListener(FOLDER_WATCH_CHANGED_EVENT, handler);
        return () => window.removeEventListener(FOLDER_WATCH_CHANGED_EVENT, handler);
    }, []);

    void dbReady; // dbReady değişince re-render → DB değerleri güncel okunur
    return { enabled: readEnabled(), autoRescan: readAutoRescan() };
}
