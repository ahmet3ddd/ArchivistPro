// IPC alan modulu: adlandirilmis eszamanli YEREL arsivler (izole coklu DB).
// Kimlik/yonetim yalniz ANA arsivde; ek arsivler yalniz-icerik. Tuketiciler `./client`
// facade'inden import eder.

import { invoke } from "@tauri-apps/api/core";

/** Bir arsiv anahtari satiri (sunucu `ArchiveDto` ile birebir). `isMain`: implicit ANA arsiv
 *  (adi i18n'den — `name` bos gelir). `active`: su an secili. `assetCount`: yalniz AKTIF arsiv
 *  icin dolu (digerlerini saymak dosya acmayi gerektirir → null). */
export interface LocalArchive {
  id: string;
  name: string;
  color: string | null;
  isMain: boolean;
  active: boolean;
  assetCount: number | null;
}

/** Adlandirilmis yerel arsiv komut sarmalayicilari — facade `ipc`'ye yayilir. */
export const archivesIpc = {
  /** Tum yerel arsivler (implicit ANA ilk + ek registry satirlari; aktif isaretli). */
  listLocalArchives: (): Promise<LocalArchive[]> =>
    invoke<LocalArchive[]>("list_local_archives"),

  /** Yeni arsiv olustur (admin + ana arsiv). Yeni satir doner (aktif degil). */
  createLocalArchive: (name: string, color: string | null): Promise<LocalArchive> =>
    invoke<LocalArchive>("create_local_archive", { name, color }),

  /** Arsivi yeniden adlandir (admin + ana arsiv). */
  renameLocalArchive: (id: string, name: string): Promise<void> =>
    invoke<void>("rename_local_archive", { id, name }),

  /** Arsiv rengini ayarla (admin + ana arsiv). null → rozeti kaldirir. */
  setLocalArchiveColor: (id: string, color: string | null): Promise<void> =>
    invoke<void>("set_local_archive_color", { id, color }),

  /** Arsivi non-destructive sil (admin + ana arsiv; dosya .trash'e tasinir). */
  deleteLocalArchive: (id: string): Promise<void> =>
    invoke<void>("delete_local_archive", { id }),

  /** Silinmis arsivi geri yukle (admin + ana arsiv). */
  restoreLocalArchive: (id: string): Promise<void> =>
    invoke<void>("restore_local_archive", { id }),

  /** AKTIF arsivi degistir (admin). Yeni aktif arsiv doner. Ingest kosarken `archive_busy`
   *  ile reddedilebilir → cagiran hata token'ini kullaniciya cevirir. */
  switchArchive: (id: string): Promise<LocalArchive> =>
    invoke<LocalArchive>("switch_archive", { id }),
};
