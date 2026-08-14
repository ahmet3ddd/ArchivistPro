// localStorage → DB tek-seferlik goc: eski izlenen-kok listesi (`archivist_folder_watch_roots`)
// artik GERCEK DB entity'si (scanned_roots). Kullanicinin mevcut izleme listesi KAYBOLMASIN diye
// ilk acilista (admin) bir kez her yolu DB'ye ekler (idempotent — backend UNIQUE(path)), sonra
// "migrated" bayragi koyar + eski anahtari siler. Bir daha calismaz.
//
// AppShell ilk-kosuda (admin-gated) cagirir; migrasyon bir sey tasidiysa `true` doner →
// cagiran `bumpWatchConfig()` ile watcher'i yeni kok kumesiyle yeniden kurar.

import { ipc } from "../../ipc/client";
import { basename } from "../../lib/format";

const OLD_ROOTS_KEY = "archivist_folder_watch_roots";
const MIGRATED_FLAG = "archivist_watch_roots_migrated_v1";

/** Eski localStorage izleme koklerini DB'ye tasi (bir kez). Doner: en az bir kok tasindi mi. */
export async function migrateWatchRootsToDb(): Promise<boolean> {
  // Zaten yapildiysa dokunma (bayrak) — idempotent, ucuz erken cikis.
  if (localStorage.getItem(MIGRATED_FLAG) === "true") return false;

  let migratedAny = false;
  const raw = localStorage.getItem(OLD_ROOTS_KEY);
  if (raw) {
    let paths: string[] = [];
    try {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        paths = arr.filter((x): x is string => typeof x === "string" && x.trim() !== "");
      }
    } catch {
      /* bozuk JSON → tasinacak bir sey yok */
    }
    for (const path of paths) {
      const p = path.trim();
      try {
        // Elle-ekle semantigi: last_scan NULL (bu kokler henuz H3'te taranmadi; goc yalnizca
        // izleme listesini korur). newlyAdded'i onemsemeyiz — herhangi biri eklendiyse watcher tazele.
        await ipc.addScannedRoot(p, basename(p));
        migratedAny = true;
      } catch {
        /* backend UNIQUE/hata → idempotent, atla */
      }
    }
  }

  // Bayragi koy + eski anahtari temizle (tekrar calismasin; bayat localStorage kalmasin).
  localStorage.setItem(MIGRATED_FLAG, "true");
  localStorage.removeItem(OLD_ROOTS_KEY);
  return migratedAny;
}
