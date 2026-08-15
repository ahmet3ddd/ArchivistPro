// Gorsel-analiz hata sinifi → i18n anahtari eslemesi. Sozlesme testi: sunucunun uretebilecegi HER
// kodun bir karsiligi olmali, bilinmeyen kod ASLA ham/bos ekrana dusmemeli.

import { describe, expect, it } from "vitest";

import tr from "../../i18n/locales/tr.json";
import en from "../../i18n/locales/en.json";
import type { ImageAnalysisReport } from "../../ipc/client";
import { visionErrorKey, visionOutcomeNotice } from "./visionErrors";

// `src-tauri/src/vision.rs::classify_vision_error` + cagiranin urettigi siniflar (BIREBIR).
const SERVER_KINDS = [
  "gpu_driver",
  "timeout",
  "ollama_down",
  "context_overflow",
  "model_missing",
  "out_of_memory",
  "unusable_output",
  "write_failed",
  "other",
] as const;

/** Nokta-yollu i18n anahtarini sozlukte coz (t() olmadan; saf dogrulama). */
function lookup(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in acc) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
}

describe("visionErrorKey", () => {
  it("sunucunun her hata sinifi icin anahtar dondurur", () => {
    for (const kind of SERVER_KINDS) {
      expect(visionErrorKey(kind), kind).toBe(`vision_index.error.${kind}`);
    }
  });

  it("bilinmeyen / bos / eksik kod `other` metnine duser", () => {
    // Eski surum sunucu (alan hic yok) ya da ileride eklenmis yeni kod → ham metin DEGIL, cumle.
    expect(visionErrorKey(undefined)).toBe("vision_index.error.other");
    expect(visionErrorKey(null)).toBe("vision_index.error.other");
    expect(visionErrorKey("")).toBe("vision_index.error.other");
    expect(visionErrorKey("gelecekte_eklenen_kod")).toBe("vision_index.error.other");
  });

  it("dondurulen anahtarlarin tr + en karsiligi GERCEKTEN var (bos anahtar ekrana basilmaz)", () => {
    for (const kind of SERVER_KINDS) {
      const key = visionErrorKey(kind);
      for (const [name, dict] of [
        ["tr", tr],
        ["en", en],
      ] as const) {
        const text = lookup(dict, key);
        expect(typeof text, `${name}: ${key}`).toBe("string");
        expect((text as string).length, `${name}: ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("devre-kesici ve teknik-ayrinti metinleri de tanimli", () => {
    for (const key of [
      "vision_index.aborted_toast",
      "vision_index.aborted_notice",
      "vision_index.error_detail",
    ]) {
      expect(typeof lookup(tr, key), `tr: ${key}`).toBe("string");
      expect(typeof lookup(en, key), `en: ${key}`).toBe("string");
    }
  });
});

// ---------------------------------------------------------------------------
// Kosu-sonu bildirimi (`visionOutcomeNotice`).
//
// Kullanici itirazi 2026-08-15: 60 gorselin 55'i BASARIYLA kaydedilmisken ekranda tek tip bir
// kirmizi cumle ("sonuç kaydedilmedi") cikiyordu → tum is bosa gitmis gibi okunuyordu. Ustelik
// "daha yetenekli bir model secin" diyordu; secili model ZATEN olculmus-kanitlanmisti.
// ---------------------------------------------------------------------------

/** Test raporu — alanlar `ImageAnalysisReport` ile ayni; yalniz gerekenler doldurulur. */
function report(over: Partial<ImageAnalysisReport> = {}): ImageAnalysisReport {
  return {
    analyzed: 0,
    failed: 0,
    elapsedMs: 1,
    stopped: false,
    ...over,
  };
}

describe("visionOutcomeNotice", () => {
  it("kismi elemede SAYILI cumle + bilgi tonu (kirmizi 'hepsi bosa gitti' DEGIL)", () => {
    const n = visionOutcomeNotice(
      report({
        analyzed: 55,
        failed: 5,
        unusable: 5,
        errorKind: "unusable_output",
        modelQuality: "proven",
        model: "qwen2.5vl:3b",
      }),
    );
    expect(n.key).toBe("vision_index.unusable.partial");
    expect(n.kind).toBe("info"); // 55 gorsel KAYDEDILDI — bu bir kosu arizasi degil
    expect(n.params).toMatchObject({ analyzed: 55, unusable: 5, total: 60 });
    expect(n.markedForRetry).toBe(true);
  });

  it("hicbir sey kaydedilemediyse hata tonu + 'none' cumlesi", () => {
    const n = visionOutcomeNotice(
      report({ analyzed: 0, failed: 3, unusable: 3, errorKind: "unusable_output" }),
    );
    expect(n.key).toBe("vision_index.unusable.none");
    expect(n.kind).toBe("error");
  });

  it("tavsiye modelin OLCULMUS kalitesine gore ayrisir", () => {
    const proven = visionOutcomeNotice(
      report({ analyzed: 1, failed: 1, unusable: 1, errorKind: "unusable_output", modelQuality: "proven" }),
    );
    expect(proven.adviceKey).toBe("vision_index.unusable.advice_proven");
    const weak = visionOutcomeNotice(
      report({ analyzed: 1, failed: 1, unusable: 1, errorKind: "unusable_output", modelQuality: "unusable" }),
    );
    expect(weak.adviceKey).toBe("vision_index.unusable.advice_weak");
  });

  it("eleme DISI hatalar eski davranista kalir: sinif cumlesi, kirmizi, isaret vaadi YOK", () => {
    const n = visionOutcomeNotice(report({ analyzed: 0, failed: 2, errorKind: "ollama_down" }));
    expect(n.key).toBe("vision_index.error.ollama_down");
    expect(n.adviceKey).toBeNull();
    expect(n.kind).toBe("error");
    expect(n.markedForRetry).toBe(false); // servis hatasinda dosya ISARETLENMEZ
  });

  it("eski surum sunucu `unusable` gondermese de sayim cumlesi kurulur", () => {
    const n = visionOutcomeNotice(report({ analyzed: 9, failed: 1, errorKind: "unusable_output" }));
    expect(n.key).toBe("vision_index.unusable.partial");
    expect(n.params.unusable).toBe(1);
    expect(n.params.total).toBe(10);
  });


  it("devre kesici kestiyse durdurma cumlesi ON-EK olur, eleme cumlesi KAYBOLMAZ", () => {
    // Canli dogrulama 2026-08-15 (`llava` ile kosu): ekranda yalniz "Analiz durduruldu: art arda
    // 3 hata." yaziyordu -> o 3 dosyaya ne oldugu ve nerede bulunacagi soylenmiyordu.
    const n = visionOutcomeNotice(
      report({
        analyzed: 0,
        failed: 3,
        unusable: 3,
        errorKind: "unusable_output",
        modelQuality: "unusable",
        model: "llava:latest",
        abortedAfterConsecutiveFailures: 3,
      }),
    );
    expect(n.prefixKey).toBe("vision_index.aborted_toast");
    expect(n.params.failures).toBe(3);
    expect(n.key).toBe("vision_index.unusable.none"); // eleme cümlesi duruyor
    expect(n.markedForRetry).toBe(true); // "Bu görselleri göster" düğmesi cıkar
    expect(n.kind).toBe("error");
  });

  it("devre kesici YOKKEN on-ek de yoktur", () => {
    const n = visionOutcomeNotice(
      report({ analyzed: 5, failed: 1, unusable: 1, errorKind: "unusable_output" }),
    );
    expect(n.prefixKey).toBeNull();
  });

  it("kismi elemede devre kesici devreye girdiyse ton HATA olur (kalan is yapilmadi)", () => {
    const n = visionOutcomeNotice(
      report({
        analyzed: 4,
        failed: 3,
        unusable: 3,
        errorKind: "unusable_output",
        abortedAfterConsecutiveFailures: 3,
      }),
    );
    expect(n.kind).toBe("error");
  });

  it("uretilen TUM anahtarlarin tr + en karsiligi var", () => {
    for (const key of [
      "vision_index.unusable.partial",
      "vision_index.unusable.none",
      "vision_index.unusable.advice_proven",
      "vision_index.unusable.advice_weak",
      "vision_index.unusable.show_action",
      "facet.ai_attempt_failed",
    ]) {
      expect(typeof lookup(tr, key), `tr: ${key}`).toBe("string");
      expect(typeof lookup(en, key), `en: ${key}`).toBe("string");
    }
  });
});
