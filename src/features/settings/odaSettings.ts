// ODA (DWG→DXF) es-zamanlilik tercihi (localStorage) — scanSettings deseni. SettingsModal yazar;
// IngestModal tarama baslatirken okur → ipc.ingestFolder(..., odaConcurrency). Backend her tarama
// basinda ODA kapisini bu degere ayarlar (makine-yerel; H3'te app_settings KV yok → localStorage).
//
// GENEL tarama es-zamanliligindan (scanSettings) AYRI knob: ODA bir alt-surec (PowerShell + ODA Qt)
// baslatir + dosyayi temp'e kopyalar → darbogaz CPU degil, alt-surec + disk cekismesi. Bu yuzden
// dusuk tutulur (H2 PREPARE_CONCURRENCY varsayilani = 3). hash/raw-scan/gorsel genel havuzda tam
// genislikte kosmaya devam eder — bu knob YALNIZ es-zamanli ODA donusumunu kapilar.

const KEY = "archivist_oda_concurrency";

/** Kabul edilen UI araligi (backend ayrica [1,16] kelepceler; UI daha dar sunar: fazla ODA = temp-IO
 *  israfi + cekisme). */
const MIN = 1;
const MAX = 8;

/** ODA es-zamanlilik on-ayarlari (ham sayi). Ust sinir 8: ODA alt-surec+disk-bagli → fazlasi
 *  cekisme/temp-IO israfi. */
export const ODA_PRESETS = [1, 2, 3, 4, 6, 8] as const;

/** Onerilen ODA es-zamanliligi = H2 `PREPARE_CONCURRENCY` varsayilani. UI'da nokta ile isaretlenir. */
export const ODA_RECOMMENDED = 1;

function clamp(n: number): number {
  return Math.max(MIN, Math.min(MAX, n));
}

/** Secili ODA es-zamanliligi (worker sayisi). Gecersiz/eksik → [`ODA_RECOMMENDED`] (1). */
export function getOdaConcurrency(): number {
  const raw = localStorage.getItem(KEY);
  if (raw == null) return ODA_RECOMMENDED;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? clamp(n) : ODA_RECOMMENDED;
}

export function setOdaConcurrency(n: number): void {
  localStorage.setItem(KEY, String(clamp(n)));
}
