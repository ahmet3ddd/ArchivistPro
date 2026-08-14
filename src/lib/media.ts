/** Indeksleyici VideoExtractor + MIME allowlist ile ortak video uzanti sozlesmesi. */
export const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "avi",
  "mkv",
  "webm",
  "flv",
  "wmv",
]);

export function isVideoExt(ext: string | null | undefined): boolean {
  return ext != null && VIDEO_EXTENSIONS.has(ext.toLowerCase());
}
