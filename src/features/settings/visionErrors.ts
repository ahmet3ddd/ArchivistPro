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

import type { ImageAnalysisReport, VisionErrorKind } from "../../ipc/client";

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

/** Kosu BASLATMA reddi → i18n anahtari (`null` → bilinmeyen; cagiran ham metni gosterir).
 *  Backend kararli TOKEN doner (`vision_busy`), prose degil → cumle degisse de eslesme bozulmaz.
 *  `setup_check.trial_busy` ile ayni desen. */
export function visionStartErrorKey(e: unknown): string | null {
  return String(e).includes("vision_busy") ? "vision_index.busy" : null;
}

/** Bir kosu-sonu bildiriminin ekranda alacagi bicim: hangi metin, hangi degiskenler, hangi ton. */
export interface VisionOutcomeNotice {
  /** Ana cumleden ONCE gelecek cumle (`null` → yok). Su an tek kullanim: **devre kesici** kosuyu
   *  yarida kestiyse "Analiz durduruldu: art arda N hata." Toast bunu basa ekler; Pano karti
   *  KULLANMAZ (kendi kalici `aborted_notice` satirini zaten cizer → cift metin olmasin). */
  prefixKey: string | null;
  /** Ana cumlenin i18n anahtari. */
  key: string;
  /** Ana cumleden SONRA eklenecek tavsiye cumlesi (`null` → tavsiye yok). */
  adviceKey: string | null;
  /** Her iki cumlenin de kullandigi interpolasyon degiskenleri. */
  params: Record<string, string | number>;
  /** Toast tonu. `info` = koşu calisti, bir kismi elendi · `error` = hicbir sey kaydedilemedi. */
  kind: "info" | "error";
  /** Elenen gorseller `ai_attempt_failed` ile ISARETLENDI mi → cagiran "Bunlari goster" eylem
   *  butonunu yalniz o zaman koyar (isaretsiz bir listeye goturmek bos vaat olurdu). */
  markedForRetry: boolean;
}

/**
 * Analiz kosusu raporu → kullaniciya gosterilecek bildirim.
 *
 * **Neden (kullanici itirazi 2026-08-15):** eski davranis, koşuda TEK dosya elense bile tek tip bir
 * KIRMIZI cumle basiyordu: *"Model anlamlı bir analiz üretemedi; sonuç kaydedilmedi."* Sayi yoktu →
 * 60 gorselin 55'i basariyla kaydedilmisken kullanici tum koşunun bosa gittigini saniyordu. Ustelik
 * cumle "daha yetenekli bir model secin" diyordu; secili model ZATEN olculmus-kanitlanmis
 * (`qwen2.5vl:3b`) oldugunda bu yanlis yonlendirmeydi.
 *
 * Kurallar:
 * - Eleme (`unusable_output`) DISINDAKI hatalar (servis/surucu/bellek/yazma) eskisi gibi: tek sinif
 *   cumlesi, kirmizi. Onlar gercekten koşu arizasidir.
 * - Elemede cumle SAYILI kurulur ve "arsive yazilmadi, dosyalar duruyor, isaretlendi" der.
 * - Bir tek gorsel bile kaydedildiyse ton `info`dur: koşu calisti.
 * - Tavsiye modelin OLCULMUS kalitesine gore ayrisir (kanitlanmis modelde model degistirme onerisi
 *   YOK; bunun yerine "her gorsel betimlenemeyebilir" gercegi soylenir).
 * - **Devre kesici** kosuyu kestiyse ("art arda N hata") bu bir ON-EK olur, cumlenin YERINE
 *   GECMEZ (canli dogrulama 2026-08-15: `llava` ile kosuda ekranda yalniz "Analiz durduruldu:
 *   art arda 3 hata." yaziyordu → o 3 dosyaya ne oldugu, isaretlendikleri ve nerede bulunacaklari
 *   soylenmiyordu; kullanicinin sordugu sorunun aynisi bu yolda geri gelmisti).
 * - **Onizlemesi olmayan secim** (`skippedNoPreview`) kuyruga HIC girmez → ne `analyzed`e ne
 *   `failed`a yazilir. Bu dal olmadan kosu "0 analiz edildi, 0 basarisiz" ile BASARI tonunda
 *   kapaniyordu (kullanici bulgusu 2026-08-16: 142 mp4 secildi, hicbir sey olmadi ve hicbir sey
 *   de soylenmedi). Cumle ne oldugunu ve NE YAPILACAGINI (yeniden indeksle → onizleme uret) soyler.
 */
export function visionOutcomeNotice(report: ImageAnalysisReport): VisionOutcomeNotice {
  const analyzed = Math.max(0, report.analyzed);
  const failed = Math.max(0, report.failed);
  const total = analyzed + failed;
  const abortedAfter = report.abortedAfterConsecutiveFailures ?? null;
  const prefixKey = abortedAfter ? "vision_index.aborted_toast" : null;
  const skipped = Math.max(0, report.skippedNoPreview ?? 0);

  // Onizlemesizlik bir kosu ARIZASI degildir (model hic cagrilmadi) → hata siniflandirmasindan
  // ONCE ele alinir, ama yalniz baska bir basarisizlik YOKKEN: karisik bir kosuda gercek hata
  // cumlesi onceliklidir (o daha acil), onizlemesizlik onun kuyruguna eklenir.
  if (skipped > 0 && failed === 0 && !abortedAfter) {
    return {
      prefixKey: null,
      key: analyzed > 0 ? "vision_index.no_preview.partial" : "vision_index.no_preview.none",
      adviceKey: "vision_index.no_preview.advice",
      params: { analyzed, failed, total, skipped },
      // Hicbir sey analiz edilemediyse kullanicinin bekledigi is HIC olmadi → hata tonu.
      kind: analyzed > 0 ? "info" : "error",
      markedForRetry: false,
    };
  }
  // Eski surum sunucu `unusable` gondermez → tum basarisizliklari eleme say (sinif zaten
  // `unusable_output`); yeni sunucuda karisik koşuda yalniz elenen kismi sayar.
  const unusable = Math.max(0, report.unusable ?? failed);

  if (report.errorKind !== "unusable_output" || unusable === 0) {
    return {
      prefixKey,
      key: visionErrorKey(report.errorKind),
      adviceKey: null,
      params: { analyzed, failed, total, failures: abortedAfter ?? 0 },
      kind: "error",
      markedForRetry: false,
    };
  }

  const params = {
    analyzed,
    failed,
    total,
    unusable,
    failures: abortedAfter ?? 0,
    model: report.model ?? "",
  };
  return {
    prefixKey,
    key: analyzed > 0 ? "vision_index.unusable.partial" : "vision_index.unusable.none",
    adviceKey:
      report.modelQuality === "proven"
        ? "vision_index.unusable.advice_proven"
        : "vision_index.unusable.advice_weak",
    params,
    // Devre kesici kosuyu KESTIYSE bu bir kosu arizasidir → bir kismi kaydedilmis olsa bile hata
    // tonu (kalan is yapilmadi); aksi halde bir tek basari bile varsa bilgi tonu yeter.
    kind: abortedAfter || analyzed === 0 ? "error" : "info",
    markedForRetry: true,
  };
}
