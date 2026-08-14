// IPC alan modulu: LAN salt-okuma dagitim/bildirim sunucusu (S1-S2 MVP; admin-gated).
// Backend lan_commands.rs; komut adlari snake_case, DTO camelCase (serde rename_all).
// Tuketiciler dogrudan buradan degil, `./client` facade'inden import eder.
//
// Sunucu DEFAULT-KAPALI: yalniz lanStartServer cagrilinca calisir → offline-pure varsayilan
// deneyim etkilenmez. Tum komutlar backend'de Admin gerektirir (frontend izni yalniz UI).

import { invoke } from "@tauri-apps/api/core";

/** LAN sunucu durumu (backend `LanStatusDto`, camelCase). Calismiyorsa running=false + null alanlar. */
export interface LanStatus {
  running: boolean;
  port?: number | null;
  authCode?: string | null;
  localIp?: string | null;
  /** Calisan sunucu ORNEK (demo) arsivi mi sunuyor (UI "ÖRNEK arşiv" rozeti). */
  demo?: boolean;
}

/** LAN sunucu komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const lanIpc = {
  /** Sunucuyu baslat (Admin). Zaten calisiyorsa mevcut durum. Kalici 8-hane kod uretir/kullanir.
   *  `demo=true` → host, gercek DB yerine ayri seeded "ÖRNEK" arsivi sunar (tek-makine gozle test). */
  lanStartServer: (demo: boolean): Promise<LanStatus> =>
    invoke<LanStatus>("lan_start_server", { demo }),

  /** Sunucuyu durdur (Admin). Calismiyorsa no-op. */
  lanStopServer: (): Promise<void> => invoke<void>("lan_stop_server"),

  /** Guncel durum (Admin — kod'u icerir). Calismiyorsa running=false. */
  lanGetServerStatus: (): Promise<LanStatus> => invoke<LanStatus>("lan_get_server_status"),

  /** Auth kodunu yenile (Admin; sunucu calisiyor olmali). Yeni kod doner. */
  lanRegenerateAuthCode: (): Promise<string> => invoke<string>("lan_regenerate_auth_code"),

  /** Bildirim yayinla (Admin) — istemciler poll'la gorur. Olusan id doner. */
  lanAddNotification: (kind: string, title: string, body?: string | null): Promise<number> =>
    invoke<number>("lan_add_notification", { kind, title, body }),

  /** Host bildirim gecmisini temizle (Admin). Silinen satir sayisini doner. */
  lanClearNotifications: (): Promise<number> => invoke<number>("lan_clear_notifications"),
};
