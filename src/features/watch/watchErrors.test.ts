// Izleme-hatasi sinifi → i18n anahtari eslemesi. Sozlesme testi: sunucunun uretebilecegi HER
// kodun IKI yuzeyde de (gecici toast + kalici kok rozeti) BES dilde karsiligi olmali; bilinmeyen
// kod ham anahtar olarak ekrana dusmemeli.
//
// Neden bes dilin hepsi: rozet, izlenmeyen bir klasoru gorunur kilan TEK kalici yuzey. Ceviri
// eksikse o dilde rozet "roots.watch_off_permission" gibi bir anahtar basar — kullanici yine ne
// yapacagini bilemez, yani rozetin varlik sebebi ortadan kalkar.

import { describe, expect, it } from "vitest";

import ar from "../../i18n/locales/ar.json";
import en from "../../i18n/locales/en.json";
import ja from "../../i18n/locales/ja.json";
import tr from "../../i18n/locales/tr.json";
import zh from "../../i18n/locales/zh.json";
import { WATCH_ERROR_KINDS, watchErrorKind, watchFailedKey, watchOffKey } from "./watchErrors";

/** `src-tauri/src/folder_watcher.rs::WatchError` sinif kodlari (BIREBIR; orada degisirse burasi da). */
const SERVER_KINDS = ["folder_missing", "permission", "watch_limit", "forbidden", "other"] as const;

const LOCALES = [
  ["tr", tr],
  ["en", en],
  ["ar", ar],
  ["ja", ja],
  ["zh", zh],
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

describe("watchErrors", () => {
  it("sinif listesi sunucununkiyle BIREBIR ayni", () => {
    // Sunucuya sinif eklenip buraya eklenmezse yeni sinif sessizce `other`'a duserdi.
    expect([...WATCH_ERROR_KINDS]).toEqual([...SERVER_KINDS]);
  });

  it("bilinen sinif korunur; bilinmeyen/eksik `other`'a daralir", () => {
    for (const kind of SERVER_KINDS) expect(watchErrorKind(kind), kind).toBe(kind);
    for (const bad of [undefined, null, "", "gelecekte_eklenen_kod", 42]) {
      expect(watchErrorKind(bad), String(bad)).toBe("other");
    }
  });

  it("her sinif icin toast ve rozet anahtari BES dilde de dolu", () => {
    for (const kind of SERVER_KINDS) {
      for (const key of [watchFailedKey(kind), watchOffKey(kind)]) {
        for (const [name, dict] of LOCALES) {
          const text = lookup(dict, key);
          expect(typeof text, `${name}: ${key}`).toBe("string");
          expect((text as string).trim().length, `${name}: ${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("rozet metinleri interpolasyon BEKLEMEZ (kart onlari veremez)", () => {
    // Rozet tekil bir kok icindir: `{{count}}`/`{{folders}}` orada anlamsizdir, ham hata metni de
    // `title`'da durur. Bir ceviri yanlislikla toast metnini kopyalarsa kartta "{{folders}}" basardi.
    for (const kind of SERVER_KINDS) {
      const key = watchOffKey(kind);
      for (const [name, dict] of LOCALES) {
        expect(lookup(dict, key) as string, `${name}: ${key}`).not.toMatch(/\{\{/);
      }
    }
  });

  it("rozetin cevresindeki metinler (baslik / yeniden dene / sonuc) de bes dilde tanimli", () => {
    for (const key of [
      "roots.watch_off",
      "roots.watch_retry",
      "roots.watch_retry_ok",
      "roots.watch_retry_failed",
    ]) {
      for (const [name, dict] of LOCALES) {
        expect(typeof lookup(dict, key), `${name}: ${key}`).toBe("string");
      }
    }
  });
});
