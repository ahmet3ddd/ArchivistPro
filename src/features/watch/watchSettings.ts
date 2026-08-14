// Klasor watcher (canli izleme) MAKINE-YEREL tercihleri (localStorage) — H2 folder_watch_* pariti.
//
// Iki ayar: enabled (varsayilan AÇIK — H2 default 'true') · autoRescan (varsayilan KAPALI —
// H2 default 'false', opt-in). Bunlar makine-yerel kalir (localStorage): hangi makinenin izleme
// yaptigi kullaniciya degil cihaza baglidir. SettingsModal yazar/yonetir; useFolderWatcher okur.
// Degisince store `bumpWatchConfig` → hook watcher'lari yeniden kurar.
//
// NOT: Izlenen kok klasorler ARTIK localStorage'da DEGIL — GERCEK DB entity'si (scanned_roots).
// Erisim `ipc.listScannedRoots()` / `rootsIpc` uzerinden (bkz `src/ipc/roots.ts`,
// `src/features/roots/`). Eski `archivist_folder_watch_roots` anahtari tek-seferlik goc ile
// DB'ye tasinir (bkz `migrateWatchRootsToDb`).

const ENABLED_KEY = "archivist_folder_watch_enabled";
const AUTO_RESCAN_KEY = "archivist_folder_watch_auto_rescan";

/** Canli izleme acik mi (varsayilan AÇIK). */
export function getWatchEnabled(): boolean {
  return (localStorage.getItem(ENABLED_KEY) ?? "true") === "true";
}
export function setWatchEnabled(on: boolean): void {
  localStorage.setItem(ENABLED_KEY, String(on));
}

/** Degisiklik tespit edilince otomatik yeniden tara (varsayilan KAPALI — opt-in). */
export function getWatchAutoRescan(): boolean {
  return (localStorage.getItem(AUTO_RESCAN_KEY) ?? "false") === "true";
}
export function setWatchAutoRescan(on: boolean): void {
  localStorage.setItem(AUTO_RESCAN_KEY, String(on));
}
