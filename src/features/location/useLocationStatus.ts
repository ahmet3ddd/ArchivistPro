// Slice 2 lokasyon farkindaligi — AppShell acilista `location_status`'u BIR KEZ okur. Kaynak
// dosyalar bu makinede erisilemiyorsa (`likelyForeign`) LocationBanner gosterilir. recovery
// deseni ama TOAST degil KALICI banner (standing durum: oturum boyunca uzak lokasyondasin).

import { useEffect, useState } from "react";

import type { LocationStatus } from "../../ipc/client";
import { ipc } from "../../ipc/client";

export function useLocationStatus(): LocationStatus | null {
  const [status, setStatus] = useState<LocationStatus | null>(null);

  useEffect(() => {
    let active = true;
    void ipc
      .locationStatus()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        /* location_status okunamadi → sessiz (kritik degil) */
      });
    return () => {
      active = false;
    };
  }, []);

  return status;
}
