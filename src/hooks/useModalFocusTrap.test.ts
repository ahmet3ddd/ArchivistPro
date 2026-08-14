import { describe, expect, it } from "vitest";

import { topmostVisibleIndex, trapTargetIndex } from "./useModalFocusTrap";

describe("trapTargetIndex", () => {
  it("odaklanabilir oge yoksa karisma", () => {
    expect(trapTargetIndex(0, -1, false)).toBeNull();
  });

  it("odak modal DISINDAysa ice alir (ilk oge)", () => {
    // activeIndex < 0 → odak modalin disinda (or. arkadaki grid) → hapse cek.
    expect(trapTargetIndex(3, -1, false)).toBe(0);
    expect(trapTargetIndex(3, -1, true)).toBe(0);
  });

  it("Tab son ogedeyken basa sarar", () => {
    expect(trapTargetIndex(3, 2, false)).toBe(0);
  });

  it("Shift+Tab ilk ogedeyken sona sarar", () => {
    expect(trapTargetIndex(3, 0, true)).toBe(2);
  });

  it("🔑 ORTADA normal Tab'a KARISMAZ (tarayici gezinmesi bozulmasin)", () => {
    // Regresyon nobeti: her Tab'i ele gecirmek modal ici gezinmeyi kirar; yalniz
    // SINIRLARDA mudahale edilmeli.
    expect(trapTargetIndex(3, 1, false)).toBeNull();
    expect(trapTargetIndex(3, 1, true)).toBeNull();
  });

  it("tek odaklanabilir oge: her iki yon de kendisine doner (disari kacis yok)", () => {
    expect(trapTargetIndex(1, 0, false)).toBe(0);
    expect(trapTargetIndex(1, 0, true)).toBe(0);
  });
});

describe("topmostVisibleIndex", () => {
  it("ic ice modallerde DOM sirasindaki son gorunur modali secer", () => {
    expect(topmostVisibleIndex([true, false, true])).toBe(2);
    expect(topmostVisibleIndex([true, true])).toBe(1);
    expect(topmostVisibleIndex([false, false])).toBe(-1);
  });
});
