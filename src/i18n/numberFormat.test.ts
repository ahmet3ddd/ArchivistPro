// i18n SAYI BICIMLENDIRME sozlesmesi — `{{deg}}` vs `{{deg, number}}`.
//
// ## Neden bu test var (2026-08-12)
// Gercek kullanimda goruldu: kok karti 83.301 dosyalik arsiv icin **"83301 dosya"** yaziyordu.
// Uygulama sayilari baska yerde yerel ayracla gosteriyordu (`lib/format.ts::formatNumber` → Pano),
// i18n metinleri ise ham `{{count}}` tasiyordu. Cozum i18next'in YERLESIK `number` bicimlendiricisi.
//
// ## Bu testin ASIL isi: NaN muhafizi
// OLCULDU (varsayim degil): `, number` bicimlendirmesi sayi OLMAYAN bir degere uygulanirsa ekrana
// duz **"NaN"** yazilir — `t("k", { v: "1.5 MB" })` → `"NaN sonuc"`; degisken hic gecilmezse de
// "NaN". Yani "hepsini bicimlendir" supurgesi sessiz bir uretim hatasi sinifidir.
// Cagri yerleri tek tek denetlendi; asagidaki iki liste o denetimin KALICI kaydidir:
//   · SWEPT     — cagri yeri ham `number` VE anlami sayim → bicimlendirilmeli.
//   · MUST_STAY — cagri yeri STRING (`formatBytes`/`formatDate`/`join(", ")`/`toFixed`) ya da
//                 ayrac istemeyen sayi (surum, sayfa no, yuzde, saniye) → ASLA bicimlendirilmemeli.
//
// Yeni bir metin eklenirken yanlis tarafa dusen interpolasyon burada kirilir — ekranda degil.

import { describe, expect, it } from "vitest";

import ar from "./locales/ar.json";
import en from "./locales/en.json";
import ja from "./locales/ja.json";
import tr from "./locales/tr.json";
import zh from "./locales/zh.json";

const LOCALES = { tr, en, ja, zh, ar } as const;

/** Her yerde bicimlendirilmesi gereken degiskenler (hepsi ham number + anlami sayim). */
const SWEPT = [
  "count", "accessible", "added", "already", "analyzed", "archives", "checked", "chunked",
  "chunks", "collectionsReconciled", "created", "done", "duplicateCount", "embedded", "errors",
  "extracted", "failed", "failures", "fields", "files", "found", "groups", "imageEmbedded",
  "imageVectors", "imported", "indexed", "kb", "loaded", "merged", "missing", "moved", "offline",
  "ok", "pathCollisionCount", "processed", "reindexed", "remapped", "removed", "reset",
  "reverted", "sampled", "samples", "shown", "skipped", "skippedDuplicate", "skippedPathConflict",
  "small", "stale", "tagsReconciled", "textVectors", "totalSource", "unusable", "updated",
];

/** Ham KALMASI gereken (anahtar → degiskenler) ciftleri + neden. Bicimlenirlerse UI "NaN" basar
 *  ya da anlamsiz ayrac cikar. */
const MUST_STAY: Array<[string, string[], string]> = [
  ["system_info.disk_usage", ["free", "total"], "formatBytes() ciktisi — STRING"],
  ["archive.export_done", ["size"], "formatBytes() ciktisi — STRING"],
  ["shape.image_too_large", ["size", "max"], "formatBytes() ciktisi — STRING"],
  ["legacy.data_found", ["size", "assets"], "formatBytes()/formatNumber() ciktisi — STRING"],
  ["legacy.import.handoff", ["roots", "pending"], "H2ImportWizard num() = onceden bicimli STRING"],
  ["legacy.import.not_carried", ["users", "chats"], "username listesi join(', ') — STRING"],
  ["legacy.import.users_note", ["users"], "username listesi join(', ') — STRING"],
  ["location.foreign_no_host", ["current"], "makine ADI — STRING"],
  ["location.foreign_with_host", ["current"], "makine ADI — STRING"],
  ["watch.watch_failed_folder_missing", ["folders"], "yol listesi join(', ') — STRING"],
  ["watch.watch_failed_permission", ["folders"], "yol listesi join(', ') — STRING"],
  ["watch.watch_failed_watch_limit", ["folders"], "yol listesi join(', ') — STRING"],
  ["watch.watch_failed_forbidden", ["folders"], "yol listesi join(', ') — STRING"],
  ["watch.watch_failed_other", ["folders"], "yol listesi join(', ') — STRING"],
  ["ingest.eta", ["time"], "formatTimer() ciktisi — STRING"],
  ["setup_check.trial_estimate", ["hours"], "estimateHours() STRING dondurur"],
  ["shape.top_score", ["score"], "toFixed(3) — STRING"],
  ["roots.last_scan", ["date"], "formatDate() ciktisi — STRING"],
  ["health.schema", ["v"], "sema SURUMU — ayrac anlamsiz (v31 ≠ v3.1)"],
  ["onboarding.progress", ["current", "total"], "adim numarasi — ayrac anlamsiz"],
  ["list.page", ["page", "pages"], "sayfa numarasi — ayrac anlamsiz"],
  ["audit.page", ["page", "pages"], "sayfa numarasi — ayrac anlamsiz"],
  ["dedup.threshold_value", ["pct"], "yuzde — ayrac anlamsiz"],
  ["lock.warning_message", ["seconds"], "geri sayim saniyesi — ayrac anlamsiz"],
];

/** Bir locale agacini "tam.anahtar → metin" ciftlerine duzlestir. */
function flatten(node: unknown, prefix = ""): Array<[string, string]> {
  if (typeof node === "string") return [[prefix, node]];
  if (node && typeof node === "object") {
    return Object.entries(node).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

function lookup(bundle: unknown, key: string): string | undefined {
  const hit = flatten(bundle).find(([k]) => k === key);
  return hit?.[1];
}

async function instance(lng: string, translation: Record<string, unknown>) {
  const i18n = (await import("i18next")).default.createInstance();
  await i18n.init({
    lng,
    resources: { [lng]: { translation } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

describe("i18n sayi bicimlendirme", () => {
  it("renders a five-digit count with the Turkish thousands separator", async () => {
    const i18n = await instance("tr", tr);
    // Gercek vaka: H:\PRJ → 83.301 dosya (once "83301 dosya" yaziyordu).
    expect(i18n.t("roots.file_count", { count: 83301 })).toBe("83.301 dosya");
    expect(i18n.t("ingest.progress_count", { done: 1234, total: 83301 })).toBe(
      "1.234 / 83.301 dosya",
    );
    // Dort haneden kucuk sayi ayrac ALMAZ — bicimlendirici devrede ama gurultu uretmiyor.
    expect(i18n.t("roots.file_count", { count: 298 })).toBe("298 dosya");
  });

  it("keeps English pluralisation working alongside the number format", async () => {
    const i18n = await instance("en", en);
    // `count` hem cogul secici hem bicimlendirilen deger — ikisi birlikte calismali.
    const one = i18n.t("roots.file_count", { count: 1 });
    const many = i18n.t("roots.file_count", { count: 2500 });
    expect(one).toContain("1");
    expect(many).toContain("2,500");
    expect(one).not.toBe(many);
  });

  it("formats every swept variable in all five languages", () => {
    const offenders: string[] = [];
    const raw = new RegExp(`{{\\s*(${SWEPT.join("|")})\\s*}}`, "g");
    for (const [lang, bundle] of Object.entries(LOCALES)) {
      for (const [key, text] of flatten(bundle)) {
        const hits = text.match(raw);
        if (hits) offenders.push(`${lang}: ${key} → ${hits.join(", ")}`);
      }
    }
    // Bir dil unutulursa orada sayilar sessizce ham doner; burasi kirilir.
    expect(offenders).toEqual([]);
  });

  it("never formats interpolations whose call site passes a string", () => {
    const offenders: string[] = [];
    for (const [lang, bundle] of Object.entries(LOCALES)) {
      for (const [key, vars, why] of MUST_STAY) {
        const text = lookup(bundle, key);
        if (text === undefined) {
          offenders.push(`${lang}: ${key} ANAHTARI YOK (liste bayatladi mi?)`);
          continue;
        }
        for (const v of vars) {
          if (new RegExp(`{{\\s*${v}\\s*,`).test(text)) {
            offenders.push(`${lang}: ${key} → {{${v}}} bicimlendirilmis ama ${why}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
