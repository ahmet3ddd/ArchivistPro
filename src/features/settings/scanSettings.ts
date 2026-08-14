// Tarama (ingest) es-zamanlilik tercihi (localStorage) — aiSettings deseni. SettingsModal yazar;
// IngestModal tarama baslatirken buradan okur → ipc.ingestFolder(..., concurrency). Backend
// `concurrency: 0` → OTOMATIK cekirdek-bazli worker sayisi (H2 paritesi: depolama-turune gore
// HDD az / SSD orta / NVMe cok). DB yazimi DAIMA seri (SQLite tek-yazici) — bu yalniz paralel
// hash+extract'i etkiler. H3'te app_settings KV henuz yok → localStorage.

const KEY = "archivist_scan_concurrency";

/** Depolama-turu on-ayarlari → es-zamanli worker sayisi. `0` = OTOMATIK (backend cekirdek-bazli).
 *  HDD seek-bagimli → paralellik zarar verir (1); SSD orta (4); NVMe yuksek (8). */
export const SCAN_PRESETS = [
  { value: 0, labelKey: "scan_concurrency.auto" }, // otomatik (cekirdek-bazli) — onerilen
  { value: 1, labelKey: "scan_concurrency.hdd" }, // HDD (seri; seek-bagimli disk)
  { value: 4, labelKey: "scan_concurrency.ssd" }, // SSD (orta)
  { value: 8, labelKey: "scan_concurrency.nvme" }, // NVMe (yuksek)
] as const;

/** Secili tarama es-zamanlilik degeri (worker sayisi; `0` = otomatik). Gecersiz → `0`. */
export function getScanConcurrency(): number {
  const raw = localStorage.getItem(KEY);
  if (raw == null) return 0;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function setScanConcurrency(n: number): void {
  localStorage.setItem(KEY, String(n));
}
