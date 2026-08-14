import { describe, expect, it } from "vitest";

import { dominantColorHex, normalizeDominantColors } from "./dominantColors";

describe("dominant colors", () => {
  it("normalizes channels, percentages and the five-color cap", () => {
    const colors = normalizeDominantColors([
      { r: 200, g: 30, b: 30, percentage: 72.4 },
      { r: -5, g: 300, b: 10.4, percentage: 120 },
      { r: 1, g: 2, b: 3, percentage: 3 },
      { r: 4, g: 5, b: 6, percentage: 2 },
      { r: 7, g: 8, b: 9, percentage: 1 },
      { r: 10, g: 11, b: 12, percentage: 1 },
    ]);

    expect(colors).toHaveLength(5);
    expect(colors[1]).toEqual({ r: 0, g: 255, b: 10, percentage: 100 });
    expect(dominantColorHex(colors[0])).toBe("#c81e1e");
  });

  it("drops malformed or non-positive entries", () => {
    expect(
      normalizeDominantColors([
        { r: Number.NaN, g: 0, b: 0, percentage: 10 },
        { r: 0, g: 0, b: 0, percentage: 0 },
      ]),
    ).toEqual([]);
  });
});
