/**
 * ArchivistPro — Şifre Kurtarma Servisi
 *
 * AppData dizininde recovery.key dosyasını yönetir.
 * Anahtar uygulama ilk açılışında üretilir ve bir daha değiştirilmez.
 */
import { invoke } from '@tauri-apps/api/core';

/** AppData/recovery.key dosyasını okur. Dosya yoksa null döner. */
export async function readRecoveryKey(): Promise<string | null> {
    return invoke<string | null>('read_recovery_key');
}

/** AppData/recovery.key dosyasına anahtar yazar. */
export async function writeRecoveryKey(key: string): Promise<void> {
    return invoke<void>('write_recovery_key', { key });
}

/** 48 karakterlik kriptografik kurtarma anahtarı üretir (hex). */
export function generateRecoveryKey(): string {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
