// K1 NOBETCISI — kilit ekrani modal sozlesmesini ILAN ETMEK ZORUNDA.
//
// NEDEN (2026-07-28 UI/UX denetimi K1 — GUVENLIK): `LockScreen` koku `role="dialog"` ve
// `aria-modal="true"` TASIMIYORDU. Iki bagimsiz mekanizma bu ilana bakar:
//   · `useModalFocusTrap` → yalniz `[aria-modal="true"]` arar (Tab hapsi)
//   · `useGlobalShortcuts.isOverlayOpen()` → yalniz `[role="dialog"]|[role="menu"]` arar
//     (global kisayollarin susmasi)
// Ilan yokken kilitli ekranda Tab ile parola alanindan cikilip Ctrl+A → Delete → Enter ile
// dosyalar cope atilabiliyordu; parola HIC girilmeden.
//
// ⚠️ NEDEN KAYNAK-TARAMASI: repoda bilesen-testi kosumu (testing-library) kurulu DEGIL →
// render edip DOM'u sorgulayamiyoruz. Bu yuzden `rbac_coverage.rs` deseni: kaynagi oku,
// sozlesmenin ILAN EDILDIGINI dogrula. Kaba ama gercek bir regresyon kilidi; testing-library
// eklendigi gun bu test render-tabanli hale getirilmeli.

import { describe, expect, it } from "vitest";

// `?raw` (Vite) ile kaynagi metin olarak al — `node:fs` KULLANILMAZ: uygulama tsconfig'inde
// `@types/node` yok, node builtin'i `tsc`'yi kirardi (`vite/client` ise `?raw`'i tanir).
import SRC from "./LockScreen.tsx?raw";

describe("K1 — LockScreen modal sozlesmesi", () => {
  it('role="dialog" ilan eder (isOverlayOpen → global kisayollar susar)', () => {
    expect(SRC).toMatch(/role="dialog"/);
  });

  it('aria-modal="true" ilan eder (useModalFocusTrap → Tab hapsi kurulur)', () => {
    expect(SRC).toMatch(/aria-modal="true"/);
  });

  it("ilan KOK elemanda (ic ice bir kutuda degil) — hapis tum ekrani kapsamali", () => {
    // Kok div: `return (` sonrasi ILK eleman. Sozlesme o blokta gecmeli.
    const body = SRC.slice(SRC.indexOf("return ("));
    const firstTag = body.slice(0, body.indexOf(">") + 1);
    expect(firstTag).toContain("<div");
    const rootBlock = body.slice(0, body.indexOf("<span"));
    expect(rootBlock).toMatch(/role="dialog"/);
    expect(rootBlock).toMatch(/aria-modal="true"/);
  });

  /** Falsifiability: tarama gercekten dosyayi okuyor mu (bos-gecis nobetcisi). */
  it("kaynak okundu (test tabani anlamli)", () => {
    expect(SRC).toContain("export function LockScreen");
  });
});
