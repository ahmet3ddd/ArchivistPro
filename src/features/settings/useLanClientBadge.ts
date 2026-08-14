import { useEffect } from "react";

import { ipc } from "../../ipc/client";
import { useUiStore } from "../../store/useUiStore";

const POLL_INTERVAL_MS = 15_000;

/** Ayarlar acik degilken de LAN istemci rozeti tazelensin diye kabukta calisan hafif poll. */
export function useLanClientBadge(enabled: boolean) {
  const setNewCount = useUiStore((s) => s.setLanClientNewCount);

  useEffect(() => {
    if (!enabled) {
      setNewCount(0);
      return;
    }

    let active = true;
    const refresh = async () => {
      try {
        const config = await ipc.lanClientGetConfig();
        if (!config.configured || !config.host || !config.code) {
          if (active) setNewCount(0);
          return;
        }
        const notifications = await ipc.lanClientFetch(
          config.host,
          config.port,
          config.code,
          config.seenId,
        );
        if (active) setNewCount(notifications.length);
      } catch {
        // Kart kendi satir-ici hata durumunu gosterir; global rozet poll hatasinda degismez.
      }
    };

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [enabled, setNewCount]);
}
