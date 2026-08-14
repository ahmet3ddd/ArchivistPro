// IPC alan modulu: LAN istemci — bir host'a baglanip bildirimlerini poll eder (salt-okuma, Faz 2).
// Backend lan_client_commands.rs; komut adlari snake_case, DTO camelCase (serde rename_all).
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.
//
// Istemci host'un mini HTTP sunucusuna (bkz lan.ts) adres + 8-hane kodla baglanir; yapilandirma
// backend'de kalici tutulur. Tum komutlar backend'de Admin gerektirir (frontend izni yalniz UI).

import { invoke } from "@tauri-apps/api/core";

/** Kayitli istemci yapilandirmasi (backend `LanClientConfig`, camelCase). configured=false → alanlar null/varsayilan. */
export interface LanClientConfig {
  configured: boolean;
  host: string | null;
  port: number;
  code: string | null;
  /** En son "okundu" isaretlenen bildirim id'si (bundan buyuk id'ler "yeni"). */
  seenId: number;
}

/** Host'a erisilebilirlik yoklamasi (backend `LanClientPing`). ok=false → ulasilamiyor. */
export interface LanClientPing {
  ok: boolean;
  appVersion: string | null;
}

/** Host'tan cekilen tek bildirim (backend `LanClientNotif`, camelCase). createdAt: unix ms. */
export interface LanClientNotif {
  id: number;
  createdAt: number;
  kind: string;
  title: string;
  body: string | null;
}

/** LAN istemci komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const lanClientIpc = {
  /** Kayitli istemci yapilandirmasini getir (Admin). Yoksa configured=false. */
  lanClientGetConfig: (): Promise<LanClientConfig> =>
    invoke<LanClientConfig>("lan_client_get_config"),

  /** Yapilandirmayi kaydet (Admin) — backend seenId'yi 0'a sifirlar. */
  lanClientSaveConfig: (host: string, port: number, code: string): Promise<void> =>
    invoke<void>("lan_client_save_config", { host, port, code }),

  /** Yapilandirmayi temizle / baglantiyi kes (Admin). */
  lanClientClearConfig: (): Promise<void> => invoke<void>("lan_client_clear_config"),

  /** Host'a erisilebilirlik yoklamasi (Admin). ok + host uygulama surumu doner. */
  lanClientPing: (host: string, port: number): Promise<LanClientPing> =>
    invoke<LanClientPing>("lan_client_ping", { host, port }),

  /** Bildirimleri cek (Admin). since=0 → tam liste. Kod dogrulanir (yanlissa "unauthorized" reject). */
  lanClientFetch: (
    host: string,
    port: number,
    code: string,
    since: number,
  ): Promise<LanClientNotif[]> =>
    invoke<LanClientNotif[]>("lan_client_fetch", { host, port, code, since }),

  /** En son gorulen bildirim id'sini kaydet (Admin) — "yeni" rozetlerini temizler. */
  lanClientMarkSeen: (seenId: number): Promise<void> =>
    invoke<void>("lan_client_mark_seen", { seenId }),
};
