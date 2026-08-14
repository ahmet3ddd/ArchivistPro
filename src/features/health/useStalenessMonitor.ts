// Dosya guncelligi denetiminin ortak yolu.
//
// Hem AppShell'in otomatik kontrolu hem Doctor'un manuel "Denetle" dugmesi ayni Promise'i
// kullanir. Boylece ayni anda iki pahali dosya-sistemi taramasi baslamaz; sonuc da tek seferde
// store'a (durum cubugu, kart rozetleri, Doctor) dagitilir.

import { useEffect } from "react";

import type { StalenessReport } from "../../ipc/client";
import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";

const STARTUP_DELAY_MS = 2_000;

let activeRefresh: Promise<StalenessReport | null> | null = null;

/** Mevcut DB/mtime anina aitse sonucu store'a yazar; veri degismisse gecersiz sonucu atar. */
export function refreshStalenessReport(): Promise<StalenessReport | null> {
  if (activeRefresh) return activeRefresh;

  const startedAtDataVersion = useUiStore.getState().dataVersion;
  const request = ipc.checkStaleness().then((report) => {
    if (startedAtDataVersion !== useUiStore.getState().dataVersion) return null;
    useUiStore.getState().setStalenessReport(report);
    return report;
  });

  activeRefresh = request.finally(() => {
    activeRefresh = null;
  });
  return activeRefresh;
}

/** H2 davranisi: yerel arsiv acilistan iki saniye sonra, sonra her pencere odaginda denetlenir. */
export function useStalenessMonitor(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const runSilently = () => {
      void refreshStalenessReport().catch((error: unknown) => {
        // Otomatik denetim kullanicinin calismasini toast ile bolmez; gelistirme konsolunda
        // gorunur kalir. Manuel Doctor eylemi ayni hatayi toast olarak gosterir.
        console.warn("Automatic freshness check failed.", error);
      });
    };

    const timer = window.setTimeout(runSilently, STARTUP_DELAY_MS);
    window.addEventListener("focus", runSilently);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", runSilently);
    };
  }, [enabled]);
}
