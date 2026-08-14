// Izleme-hatasi sinifi → i18n anahtari. Sunucunun (`folder_watcher.rs::WatchError.kind`)
// urettigi HER kodun bir karsiligi olmali; bilinmeyen kod ASLA ham anahtar/bos metin olarak
// ekrana dusmemeli. `features/settings/visionErrors.ts` ile AYNI desen.
//
// Ayni sinif IKI yuzeyde gorunur ve ikisi FARKLI seyler soyler:
//   · `watch.watch_failed_*` — GECICI toast: "su anda N klasor izlenemedi" (coklu, {{folders}}).
//   · `roots.watch_off_*`    — KALICI rozet: kok kartinda, durum duzelene kadar durur (tekil).
// Anahtar uretimi tek yerde: iki aile ayni siniflandirmayi paylasir, biri guncellenip digeri
// unutulamaz.

/** Sunucunun uretebilecegi izleme-hatasi siniflari (folder_watcher.rs ile BIREBIR). */
export const WATCH_ERROR_KINDS = [
  "folder_missing",
  "permission",
  "watch_limit",
  "forbidden",
  "other",
] as const;

export type WatchErrorKind = (typeof WATCH_ERROR_KINDS)[number];

/** Ham `kind` degerini bilinen bir sinifa daralt. Eksik/bos/tanimsiz (eski surum sunucu ya da
 *  ileride eklenmis yeni kod) → `other`: o metin ham hatayi `{{message}}` ile zaten tasir. */
export function watchErrorKind(raw: unknown): WatchErrorKind {
  return WATCH_ERROR_KINDS.includes(raw as WatchErrorKind) ? (raw as WatchErrorKind) : "other";
}

/** Toplu toast anahtari (gecici bildirim; `{{count}}`, `{{folders}}`, `{{message}}` alir). */
export function watchFailedKey(raw: unknown): string {
  return `watch.watch_failed_${watchErrorKind(raw)}`;
}

/** Kok karti rozeti anahtari (kalici durum; interpolasyonsuz — ham metin `title`'da durur). */
export function watchOffKey(raw: unknown): string {
  return `roots.watch_off_${watchErrorKind(raw)}`;
}
