import { describe, expect, it } from "vitest";

import { defaultFacetConfig, normalizeFacetConfig } from "./facetConfig";

describe("normalizeFacetConfig", () => {
  it("places favorites first and AI analysis beside the image filters by default", () => {
    expect(defaultFacetConfig().slice(0, 3).map((item) => item.id)).toEqual([
      "favorites",
      "aiAnalysis",
      "gorselTuru",
    ]);
  });

  it("migrates the new AI status facet beside image type in saved layouts", () => {
    const normalized = normalizeFacetConfig([
      { id: "type", visible: true, order: 0 },
      { id: "gorselTuru", visible: true, order: 1 },
    ]);
    const imageTypeIndex = normalized.findIndex((item) => item.id === "gorselTuru");

    expect(normalized[0]).toMatchObject({ id: "favorites", visible: true });
    expect(normalized[imageTypeIndex - 1]?.id).toBe("aiAnalysis");
  });

  it("falls back to visible defaults for malformed data", () => {
    expect(normalizeFacetConfig({ bad: true })).toEqual(defaultFacetConfig());
  });

  it("keeps known saved choices, removes duplicates, and appends new facets", () => {
    const normalized = normalizeFacetConfig([
      { id: "type", visible: false, order: 8, label: "Dosya türü" },
      { id: "type", visible: true, order: 0 },
      { id: "unknown", visible: false, order: 1 },
    ]);

    expect(normalized.find((item) => item.id === "type")).toMatchObject({
      id: "type",
      visible: false,
      label: "Dosya türü",
    });
    expect(normalized).toHaveLength(defaultFacetConfig().length);
    expect(normalized.map((item) => item.order)).toEqual(
      Array.from({ length: defaultFacetConfig().length }, (_, index) => index),
    );
  });
});
