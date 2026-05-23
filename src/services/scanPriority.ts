/**
 * Tarama/embedding sirasinda Windows process priority'sini Below Normal'a
 * dusurur — kullanici diger uygulamalari rahat kullanabilsin.
 *
 * Reentrant: birden fazla tarama paralel calisirsa son biten Normal'a doner.
 */
import { invoke } from '@tauri-apps/api/core';

let activeCount = 0;

export async function acquireScanPriority(): Promise<void> {
    activeCount++;
    if (activeCount === 1) {
        try {
            await invoke('set_priority_background');
        } catch {
            // Tauri komutu yoksa veya OS desteklemiyorsa sessizce gec
        }
    }
}

export async function releaseScanPriority(): Promise<void> {
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount === 0) {
        try {
            await invoke('set_priority_normal');
        } catch {
            // sessizce gec
        }
    }
}
