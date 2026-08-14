// Otomatik yedekleme ayarlari (localStorage) — H3'te `app_settings` KV tablosu henuz yok
// (`presets.ts`/`facetCollapse.ts`/`searchHistory.ts` deseni). Scheduler (useBackupScheduler)
// + Ayarlar paneli bunu paylasir; ayar degisince store `bumpBackupConfig` ile scheduler
// yeniden kurulur. (Ileride app_settings KV gelince buraya tasinabilir.)

const INTERVAL_KEY = "archivist_backup_interval_hours";
const MAX_KEY = "archivist_backup_max";
const LAST_KEY = "archivist_backup_last_ms";

/** Secilebilir otomatik-yedek araliklari (saat). 0 = kapali (H2 pariti: kapali/1/4/8/24). */
export const BACKUP_INTERVALS = [0, 1, 4, 8, 24] as const;

/** Varsayilan retention (saklanacak en fazla otomatik yedek) — H2 pariti (5). */
export const DEFAULT_MAX_SNAPSHOTS = 5;

export function getBackupIntervalHours(): number {
  const n = parseInt(localStorage.getItem(INTERVAL_KEY) ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0; // varsayilan kapali
}

export function setBackupIntervalHours(hours: number): void {
  localStorage.setItem(INTERVAL_KEY, String(Math.max(0, Math.floor(hours))));
}

export function getMaxSnapshots(): number {
  const n = parseInt(localStorage.getItem(MAX_KEY) ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_SNAPSHOTS;
}

export function setMaxSnapshots(max: number): void {
  localStorage.setItem(MAX_KEY, String(Math.max(1, Math.floor(max))));
}

/** Son otomatik yedek zamani (unix ms) — acilista "gecikmis yedek" yakalama icin. */
export function getLastAutoBackupMs(): number {
  const n = parseInt(localStorage.getItem(LAST_KEY) ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

export function setLastAutoBackupMs(ms: number): void {
  localStorage.setItem(LAST_KEY, String(ms));
}
