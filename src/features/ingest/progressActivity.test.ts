import { describe, expect, it } from "vitest";

import { progressPct, shouldShowLongFileHint } from "./progressActivity";

const progress = {
  processed: 12,
  total: 100,
  folders: 5,
  currentPath: "C:/archive/large.dwg",
  activePaths: ["C:/archive/large-2.tga"],
  rootIndex: 1,
  rootTotal: 1,
  currentRoot: "C:/archive",
  cancelled: false,
};

describe("shouldShowLongFileHint", () => {
  it("explains a long-running file after the quiet threshold", () => {
    expect(shouldShowLongFileHint(progress, 1_000, 8_999, 8_000)).toBe(false);
    expect(shouldShowLongFileHint(progress, 1_000, 9_000, 8_000)).toBe(true);
  });

  it("does not report a quiet period before progress starts or after completion", () => {
    expect(shouldShowLongFileHint(null, 0, 99_000)).toBe(false);
    expect(
      shouldShowLongFileHint({ ...progress, processed: progress.total }, 1_000, 99_000),
    ).toBe(false);
  });
});

describe("progressPct", () => {
  it("belirsiz durumu null ile ayirir (total<=0 → bolme yok)", () => {
    expect(progressPct(0, 0)).toBeNull();
    expect(progressPct(5, -1)).toBeNull();
  });

  it("yuvarlar ve 100'u ASMAZ (processed>total kenar durumu)", () => {
    expect(progressPct(1, 3)).toBe(33);
    expect(progressPct(2, 3)).toBe(67);
    expect(progressPct(124, 40)).toBe(100); // gercek gozlem: biten>toplam olabiliyordu
    expect(progressPct(0, 82)).toBe(0);
    expect(progressPct(82, 82)).toBe(100);
  });
});
