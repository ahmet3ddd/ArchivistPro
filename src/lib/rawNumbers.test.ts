// JSX'te HAM sayi basma nobetcisi — `{x.count}` yerine `{formatNumber(x.count)}`.
//
// ## Neden (gercek vaka, 2026-08-12)
// i18n metinlerindeki sayilar `{{count, number}}` ile yerellestirildikten sonra kullanici
// arsiv listesinde hala **"83874"** gordu (ayracsiz). Sebep: o sayi i18n'den GECMIYORDU —
// `ArchiveSwitcher.tsx` onu dogrudan JSX'ten basiyordu (`{a.assetCount}`). i18n taramasi bu
// sinifi yapisal olarak goremez; ayri bir nobetci gerekir.
//
// ## Kapsam (kasten DAR)
// Yalniz "tek basina bir JSX satiri olarak basilan, adi sayim/uzunluk/toplam olan ifade"
// yakalanir. Amac tum sayilari kovalamak degil — kullaniciya SAYIM gosteren, buyuyebilen
// alanlari yakalamak. Bilincli istisnalar `ALLOWED` icinde GEREKCESIYLE durur.
//
// ⚠️ NEDEN `?raw` + `import.meta.glob`, `node:fs` DEGIL: uygulama tsconfig'inde `@types/node`
// yok → node builtin importu `tsc`'yi kirar. Ayni tuzak `lockScreenContract.test.ts`'te de
// yasanmis ve orada da `?raw` ile cozulmus; bu test o deseni izler.

import { describe, expect, it } from "vitest";

/** Tum uygulama TSX kaynaklari, metin olarak (test dosyalari haric — asagida elenir). */
const SOURCES = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Tek basina JSX ifadesi olarak basilan sayim-benzeri deger: `        {x.count}` */
const BARE_COUNT = /^[ \t]*\{[A-Za-z_][A-Za-z0-9_.]*(?:[Cc]ount|[Tt]otal|\.length)\}[ \t]*$/;

/** Bilincli istisnalar: `"dosya:satir"` → gerekce. Bos kalmasi normaldir. */
const ALLOWED: Record<string, string> = {};

describe("JSX'te ham sayi", () => {
  it("renders user-facing counts through formatNumber, not bare", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.includes(".test.")) continue;
      const rel = path.replace(/^\.\.\//, "");
      source.split(/\r?\n/).forEach((line, i) => {
        if (!BARE_COUNT.test(line)) return;
        const key = `${rel}:${i + 1}`;
        if (ALLOWED[key]) return;
        offenders.push(`${key} → ${line.trim()}  (formatNumber ile sar)`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("actually scans the app sources (nobetci bos calismasin)", () => {
    // Regex hic eslesmezse test SESSIZCE yesil kalirdi; taramanin gercekten dosya gordugunu
    // ve desenin calistigini ayrica kanitla.
    const files = Object.keys(SOURCES).filter((p) => !p.includes(".test."));
    expect(files.length).toBeGreaterThan(100);
    expect(BARE_COUNT.test("      {a.assetCount}")).toBe(true);
    expect(BARE_COUNT.test("      {formatNumber(a.assetCount)}")).toBe(false);
    expect(BARE_COUNT.test("      {asset.name}")).toBe(false);
  });
});
