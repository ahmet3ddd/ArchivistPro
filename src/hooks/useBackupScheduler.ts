/**
 * Archivist Pro — Otomatik Yedekleme Zamanlayıcısı
 *
 * Belirlenen aralıklarla (1/4/8/24 saat) otomatik DB snapshot alır.
 * Ayar app_settings tablosunda 'backup_interval_hours' olarak saklanır.
 * 0 = devre dışı.
 */

import { useEffect, useRef } from 'react';
import { getSetting } from '../services/database';
import { createSnapshot } from '../services/dbSnapshot';
import { debugLog } from '../services/logger';

interface Options {
  /** Sadece admin giriş yapmışken aktif. */
  enabled: boolean;
}

export function useBackupScheduler({ enabled }: Options): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!enabled) return;

    const raw = getSetting('backup_interval_hours');
    const hours = raw ? parseInt(raw, 10) : 0;
    if (!hours || hours <= 0) return;

    const intervalMs = hours * 60 * 60 * 1000;

    debugLog('BackupScheduler', `Otomatik yedekleme aktif: her ${hours} saatte bir`);

    intervalRef.current = setInterval(async () => {
      try {
        debugLog('BackupScheduler', 'Zamanlanmış yedek alınıyor...');
        const info = await createSnapshot();
        if (info) {
          debugLog('BackupScheduler', `Yedek alındı: ${info.fileName} (${(info.fileSize / 1024).toFixed(0)} KB)`);
        }
      } catch (err) {
        debugLog('BackupScheduler', 'Yedek alma hatası', err);
      }
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled]);
}
