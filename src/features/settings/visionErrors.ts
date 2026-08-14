// Gorsel-analiz hata sinifi → i18n anahtari. TEK dogruluk kaynagi: uc ayri yuzey (Pano karti,
// secim araç çubuğu, detay paneli) ayni kosunun raporunu gosterir; esleme kopyalanirsa biri
// guncellenip digerleri ham metinde kalirdi.
//
// Neden ham metin gosterilmiyor (kullanici bulgusu 2026-08-07): ekranda
// `Ollama vision hatasi: status 500: {"error":"llama-server process has terminated: exit status
// 0xc0000409: The system detected an overrun of a stack-based buffer... CUDA error"}` cikiyordu —
// hem anlasilmaz, hem Windows'un guvenlik metni yuzunden gereksiz korkutucu. Ham metin KAYBOLMAZ:
// cagiran onu "Teknik ayrıntı" olarak katlanabilir sekilde gosterir (Pano) ya da konsola birakir.
//
// Kodlar sunucu `vision::classify_vision_error` ile BIREBIR; oradaki her kodun burada ve 5 dil
// dosyasinda karsiligi vardir.

import type { VisionErrorKind } from "../../ipc/client";

const KEYS: Record<VisionErrorKind, string> = {
  gpu_driver: "vision_index.error.gpu_driver",
  timeout: "vision_index.error.timeout",
  ollama_down: "vision_index.error.ollama_down",
  context_overflow: "vision_index.error.context_overflow",
  model_missing: "vision_index.error.model_missing",
  out_of_memory: "vision_index.error.out_of_memory",
  unusable_output: "vision_index.error.unusable_output",
  write_failed: "vision_index.error.write_failed",
  other: "vision_index.error.other",
};

/** Hata sinifi kodu → i18n anahtari. Bilinmeyen/eksik kod (eski surum sunucu, yeni kod) →
 *  `other` metnine duser; asla bos/anahtar-adi ekrana basmaz. */
export function visionErrorKey(kind?: string | null): string {
  if (kind && kind in KEYS) return KEYS[kind as VisionErrorKind];
  return KEYS.other;
}
