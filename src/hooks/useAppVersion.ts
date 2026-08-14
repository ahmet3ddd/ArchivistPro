// Uygulama surumu (tauri.conf.json `version`) — Tauri core `getVersion` uzerinden.
// Neden IPC komutu DEGIL: `system_info` admin-kapili (Bakim karti); surum ise herkese
// acik bir kimlik bilgisidir (2026-08-12 "hangi surum kurulu?" karisikligi). Yeni kapisiz
// komut eklemek RBAC tarama testinin yuzeyini buyuturdu; `core:default` yetkisi zaten yeterli.

import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useState } from "react";

// Modul-duzeyi onbellek: surum calisirken degismez → ilk cozumden sonra yeniden sorulmaz.
let cached: string | null = null;

/** Uygulama surumunu doner; cozulene kadar (veya Tauri disi ortamda kalici) `null`. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(cached);
  useEffect(() => {
    if (cached != null) return;
    let active = true;
    getVersion()
      .then((v) => {
        cached = v;
        if (active) setVersion(v);
      })
      .catch(() => {
        // Tauri disi ortam (vitest/tarayici): surum bilinemez → gosterge hic cizilmez.
      });
    return () => {
      active = false;
    };
  }, []);
  return version;
}
