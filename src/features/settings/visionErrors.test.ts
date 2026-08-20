// Gorsel-analiz hata sinifi → i18n anahtari eslemesi. Sozlesme testi: sunucunun uretebilecegi HER
// kodun bir karsiligi olmali, bilinmeyen kod ASLA ham/bos ekrana dusmemeli.

import { describe, expect, it } from "vitest";

import tr from "../../i18n/locales/tr.json";
import en from "../../i18n/locales/en.json";
import ar from "../../i18n/locales/ar.json";
import ja from "../../i18n/locales/ja.json";
import zh from "../../i18n/locales/zh.json";
import type { ImageAnalysisReport } from "../../ipc/client";
import { visionErrorKey, visionOutcomeNotice, visionStartErrorKey } from "./visionErrors";

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

  // ── Onizlemesi olmayan secim (kullanici bulgusu 2026-08-16) ──────────────────
  // 142 mp4 secilip "AI ile tara" dendi; dosyalarin onizlemesi (thumbnail) olmadigi icin
  // analiz kuyruguna HIC girmediler → rapor 0 analiz / 0 hata dondu ve ekranda "basarili"
  // yazdi. Sessiz basari, kullaniciya "yapildi" demenin en kotu bicimidir.

  it("onizlemesiz secimde SESSIZ BASARI yerine aciklayici cumle uretir", () => {
    const n = visionOutcomeNotice(report({ analyzed: 0, failed: 0, skippedNoPreview: 142 }));
    expect(n.key).toBe("vision_index.no_preview.none");
    expect(n.kind).toBe("error"); // kullanicinin bekledigi is HIC olmadi
    expect(n.params).toMatchObject({ skipped: 142, analyzed: 0 });
    expect(n.adviceKey).toBe("vision_index.no_preview.advice"); // ne yapilacagi da soylenir
    // Bu dosyalar `ai_attempt_failed` ile ISARETLENMEZ (denenmediler) → o filtreye goturme vaadi YOK.
    expect(n.markedForRetry).toBe(false);
  });

  it("karisik secimde (bir kismi analiz edildi) ton bilgi olur ama atlananlar SOYLENIR", () => {
    const n = visionOutcomeNotice(report({ analyzed: 8, failed: 0, skippedNoPreview: 3 }));
    expect(n.key).toBe("vision_index.no_preview.partial");
    expect(n.kind).toBe("info");
    expect(n.params).toMatchObject({ analyzed: 8, skipped: 3 });
  });

  it("GERCEK bir hata varken onizlemesizlik cumleyi GASPETMEZ (hata daha acil)", () => {
    const n = visionOutcomeNotice(
      report({ analyzed: 0, failed: 2, errorKind: "ollama_down", skippedNoPreview: 5 }),
    );
    expect(n.key).toBe("vision_index.error.ollama_down");
  });

  it("devre kesici kestiyse de onizlemesizlik cumleyi gaspetmez", () => {
    const n = visionOutcomeNotice(
      report({
        analyzed: 0,
        failed: 3,
        unusable: 3,
        errorKind: "unusable_output",
        abortedAfterConsecutiveFailures: 3,
        skippedNoPreview: 5,
      }),
    );
    expect(n.prefixKey).toBe("vision_index.aborted_toast");
    expect(n.key).toBe("vision_index.unusable.none");
  });

  it("onizlemesiz secim YOKKEN eski davranis aynen korunur", () => {
    const n = visionOutcomeNotice(report({ analyzed: 0, failed: 0, skippedNoPreview: 0 }));
    expect(n.key).not.toContain("no_preview");
  });

  it("uretilen TUM anahtarlarin tr + en karsiligi var", () => {
    for (const key of [
      "vision_index.unusable.partial",
      "vision_index.unusable.none",
      "vision_index.unusable.advice_proven",
      "vision_index.unusable.advice_weak",
      "vision_index.unusable.show_action",
      "vision_index.no_preview.partial",
      "vision_index.no_preview.none",
      "vision_index.no_preview.advice",
      "facet.ai_attempt_failed",
    ]) {
      expect(typeof lookup(tr, key), `tr: ${key}`).toBe("string");
      expect(typeof lookup(en, key), `en: ${key}`).toBe("string");
    }
  });
});

describe("visionStartErrorKey", () => {
  // Sunucu kararli TOKEN doner (`vision_commands.rs`: `Err("vision_busy")`) — prose DEGIL. Tauri
  // hatayi renderer'a string olarak gecirir, bu yuzden `includes` ile eslenir.
  it("kosu zaten aktifken anlasilir anahtar dondurur", () => {
    expect(visionStartErrorKey("vision_busy")).toBe("vision_index.busy");
    expect(visionStartErrorKey(new Error("vision_busy"))).toBe("vision_index.busy");
  });

  it("bilinmeyen hatada null doner (cagiran ham metni gosterir → hata kaybolmaz)", () => {
    expect(visionStartErrorKey("status 500: llama-server terminated")).toBeNull();
    expect(visionStartErrorKey(null)).toBeNull();
  });

  it("uretilen anahtar BES dilde de karsiligi olan bir metne cozulur", () => {
    for (const [name, dict] of [
      ["tr", tr],
      ["en", en],
      ["ar", ar],
      ["ja", ja],
      ["zh", zh],
    ] as const) {
      expect(typeof lookup(dict, "vision_index.busy"), name).toBe("string");
    }
  });
});

/** Analiz kosarken KILITLENEN eylemlerin ipuclari — bes dilde de var olmali (sebebi soylemeyen
 *  kilit, "bozuk buton" gibi okunur). Anahtarlar `vision_index` altinda: kilidi DORT yuzey
 *  paylasir (secim arac cubugu · klasor baglam menusu · bos-alan menusu · detay paneli +
 *  sol Arsiv paneli) → `batch` isim alani yanlis ev olurdu. */
describe("analiz kilidi ipuclari", () => {
  const KEYS = [
    "vision_index.maintenance_locked",
    "vision_index.blocked_by_task",
    "vision_index.busy",
  ];
  it("bes dilde de tanimli", () => {
    for (const [name, dict] of [
      ["tr", tr],
      ["en", en],
      ["ar", ar],
      ["ja", ja],
      ["zh", zh],
    ] as const) {
      for (const key of KEYS) {
        expect(typeof lookup(dict, key), `${name}:${key}`).toBe("string");
      }
    }
  });
});
