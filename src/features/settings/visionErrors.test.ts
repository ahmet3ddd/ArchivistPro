// Gorsel-analiz hata sinifi → i18n anahtari eslemesi. Sozlesme testi: sunucunun uretebilecegi HER
// kodun bir karsiligi olmali, bilinmeyen kod ASLA ham/bos ekrana dusmemeli.

import { describe, expect, it } from "vitest";

import tr from "../../i18n/locales/tr.json";
import en from "../../i18n/locales/en.json";
import { visionErrorKey } from "./visionErrors";

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
