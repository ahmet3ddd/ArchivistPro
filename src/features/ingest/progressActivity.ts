import type { IngestProgress } from "../../ipc/client";

export const LONG_FILE_HINT_AFTER_MS = 8_000;

/** A quiet counter does not mean ingest stopped: all workers may be preparing long files. */
export function shouldShowLongFileHint(
  progress: IngestProgress | null,
  lastAdvanceAt: number,
  now: number,
  thresholdMs = LONG_FILE_HINT_AFTER_MS,
): boolean {
  return (
    progress != null &&
    progress.total > 0 &&
    progress.processed < progress.total &&
    now - lastAdvanceAt >= thresholdMs
  );
}

/** Tamamlanma yüzdesi (0..100, tam sayı). `total <= 0` → `null` (belirsiz durum: "taranıyor…").
 *
 *  NEDEN AYRI: aynı ifade kod tabanında dokuz kez tekrarlanıyordu ve iki nüsha ben eklemiştim
 *  (2026-08-11 kullanıcı denetimi). Kenar durum tek yerde tanımlı olmalı — `total=0`'da bölme,
 *  `processed > total`'da 100'ü aşma. Kalan altı nüsha (Dashboard kartları, bgtask/indexer
 *  bantları) ayrı bir saf-refactor commit'inin işi. */
export function progressPct(processed: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.min(100, Math.round((processed / total) * 100));
}
