// K2 NOBETCISI — grid klavye dinleyicisinin ODAK KAPSAMI.
//
// NEDEN (2026-07-28 UI/UX denetimi K2): dinleyici `document`'te ve guard'i yalnizca
// isEditableTarget + isOverlayOpen idi. Gezgin'de kenar cubugu / grid / detay paneli AYNI ANDA
// ekranda oldugu icin, imlec kurulduktan sonra odak NEREDE olursa olsun Enter odakli dugmeyi
// degil grid detayini aciyor ve coklu secimi siliyordu; Space dugme yerine grid secimini
// degistiriyordu; oklar odakli bilesenin gezinmesini kaciriyordu.
//
// Bu test SAF karar fonksiyonlarini surer (`focusZone` + `gridOwnsKey`). Ordek-tiplemesi
// sayesinde jsdom gerekmez — sahte hedefler yeterli (vitest ortami "node").

import { describe, expect, it } from "vitest";

import { focusZone, gridOwnsKey, GRID_SCOPE_SELECTOR } from "./gridKeyboardScope";

/** `closest` tasiyan sahte DOM hedefi. */
function fakeTarget(opts: { tagName?: string; inGrid?: boolean }) {
  return {
    tagName: opts.tagName ?? "BUTTON",
    closest: (sel: string) => (opts.inGrid && sel === GRID_SCOPE_SELECTOR ? {} : null),
  };
}

describe("K2 — grid klavye odak kapsami", () => {
  describe("focusZone", () => {
    it("odak hicbir yerde (body) → 'none'", () => {
      expect(focusZone(fakeTarget({ tagName: "BODY" }) as unknown as EventTarget)).toBe("none");
    });

    it("hedef yok / document (closest'siz) → 'none'", () => {
      expect(focusZone(null)).toBe("none");
      expect(focusZone({} as unknown as EventTarget)).toBe("none");
    });

    it("grid kabinin icindeki oge → 'grid'", () => {
      expect(focusZone(fakeTarget({ inGrid: true }) as unknown as EventTarget)).toBe("grid");
    });

    it("grid DISINDAKI dugme (kenar cubugu / detay sekmesi) → 'elsewhere'", () => {
      expect(focusZone(fakeTarget({ inGrid: false }) as unknown as EventTarget)).toBe("elsewhere");
    });
  });

  describe("gridOwnsKey", () => {
    it("odak grid'de → tuslar grid'in", () => {
      expect(gridOwnsKey("grid")).toBe(true);
    });

    /** Kritik dal: blurFocusedCard() sonrasi odak body'ye duser; klavye-only gezinme SURMELI. */
    it("odak hicbir yerde → tuslar yine grid'in (blur sonrasi gezinme surer)", () => {
      expect(gridOwnsKey("none")).toBe(true);
    });

    /** K2'nin ta kendisi: baska bir bilesende odak varken DOKUNMA. */
    it("odak baska bilesende → tuslar grid'in DEGIL", () => {
      expect(gridOwnsKey("elsewhere")).toBe(false);
    });
  });

  /** Denetimdeki somut senaryo: kenar cubugu dugmesine Tab'lanmis kullanici Enter'a basar. */
  it("senaryo: kenar cubugu dugmesinde Enter grid'e GITMEZ", () => {
    const sidebarButton = fakeTarget({ tagName: "BUTTON", inGrid: false });
    expect(gridOwnsKey(focusZone(sidebarButton as unknown as EventTarget))).toBe(false);
  });

  /** Karsit senaryo (fazla-kisitlama nobetcisi): grid kartinda Enter CALISMAYA devam etmeli. */
  it("senaryo: grid kartinda Enter grid'in kalir", () => {
    const card = fakeTarget({ tagName: "BUTTON", inGrid: true });
    expect(gridOwnsKey(focusZone(card as unknown as EventTarget))).toBe(true);
  });
});
