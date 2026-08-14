// Otomatik yedekleme zamanlayicisi (H2 useBackupScheduler pariti + iyilestirme).
//
// Admin girisliyken, ayarli aralikta (1/4/8/24 saat) otomatik DB snapshot alir; backend
// retention'i uygular (auto- yedeklerden en yeni `max` tutulur). **H2'den fark:** ACILISTA
// "gecikmis yedek" yakalama — uygulama interval boyunca kapali kaldiysa son yedek eskimisse
// hemen bir yedek alir (saf setInterval bunu kacirirdi). Ayar localStorage'da; degisince
// store `backupConfigVersion` artar → effect yeniden kurulur (taze ayarla).
//
// Arka-plan/sessiz: hata yutulur (sonraki tetikte tekrar denenir); UI'yi RAHATSIZ ETMEZ
// (bumpData YOK → kullanicinin secimi/listesi sifirlanmaz; yeni yedek panel acilinca gorulur).

import { useEffect } from "react";

import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";
import {
  getBackupIntervalHours,
  getLastAutoBackupMs,
  getMaxSnapshots,
  setLastAutoBackupMs,
} from "./backupSettings";

export function useBackupScheduler(enabled: boolean): void {
  const configVersion = useUiStore((s) => s.backupConfigVersion);

  useEffect(() => {
    if (!enabled) return;
    const hours = getBackupIntervalHours();
    if (hours <= 0) return; // kapali
    const intervalMs = hours * 60 * 60 * 1000;

    const runBackup = async () => {
      try {
        await ipc.createAutoSnapshot(getMaxSnapshots());
        setLastAutoBackupMs(Date.now());
      } catch {
        /* sessiz: arka-plan otomatik yedek; sonraki tetikte tekrar denenir */
      }
    };

    // Acilis yakalama: son otomatik yedek interval'dan eskiyse hemen al (kapaliyken kaciran).
    if (Date.now() - getLastAutoBackupMs() >= intervalMs) void runBackup();

    const timer = window.setInterval(() => void runBackup(), intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, configVersion]);
}
