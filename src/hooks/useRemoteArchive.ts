// Uzak (ana) arsiv baglanti durumu — LAN Faz 2. Kaynak degistiricinin ve ACILISTA
// OTO-BAGLANMANIN dayanagi.
//
// "Oto-baglan" ne demek (kullanici karari 2026-07-19): eslesme ZATEN kalicidir (host/port/kod
// app_meta'da, kod DPAPI ile sifreli). Bu hook acilista o kaydi kullanarak host'u sessizce
// yoklar → kullanici hicbir sey girmeden "Ana arsiv" secilebilir hale gelir. Elle "Baglan"
// adimi YOKTUR.
//
// ⚠️ Host kapaliysa bu bir HATA DEGILDIR (admin'in PC'si kapali olabilir) → sessizce
// `reachable:false`. Her acilista kirmizi uyari uretmek yanlis alarm olurdu; durum yalnizca
// kaynak degistiricide gorunur.

import { useCallback, useEffect, useState } from "react";

import type { RemoteArchiveStatus } from "../ipc/client";
import { ipc } from "../ipc/client";
import { useUiStore } from "../store/useUiStore";

const UNCONFIGURED: RemoteArchiveStatus = {
  configured: false,
  reachable: false,
  appVersion: null,
  hostLabel: null,
};

export interface RemoteArchiveState {
  status: RemoteArchiveStatus;
  /** Ilk yoklama surerken true (degistirici "kontrol ediliyor" gosterir). */
  checking: boolean;
  /** Yeniden yokla (kullanici "tekrar dene" veya uzak kaynaga gecis). */
  refresh: () => void;
}

export function useRemoteArchive(): RemoteArchiveState {
  const [status, setStatus] = useState<RemoteArchiveStatus>(UNCONFIGURED);
  const [checking, setChecking] = useState(true);
  // Eslesme (Ayarlar → LAN Istemci: baglan/kes) degisince artar → asagidaki effect yeniden
  // yoklar. Aksi halde durum yalniz acilista okunurdu → kullanici Ayarlar'dan eslesince kaynak
  // degistirici RELOAD'suz belirmezdi (staleness kusuru; LanClientCard bunu artirir).
  const pairingVersion = useUiStore((s) => s.remotePairingVersion);

  const refresh = useCallback(() => {
    setChecking(true);
    void ipc
      .remoteArchiveStatus()
      .then(setStatus)
      // Yetkisiz (viewer) VEYA beklenmedik hata → "yapilandirilmamis" gibi davran:
      // uzak secenegi HIC gorunmez. Viewer icin bu DOGRU davranis (uzak okuma editor+).
      .catch(() => setStatus(UNCONFIGURED))
      .finally(() => setChecking(false));
  }, []);

  // Acilista + her eslesme degisiminde yokla (= oto-baglan + staleness fix).
  useEffect(() => {
    refresh();
  }, [refresh, pairingVersion]);

  return { status, checking, refresh };
}
