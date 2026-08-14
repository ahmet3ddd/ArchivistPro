import { describe, expect, it } from "vitest";

import type { DuplicateReport } from "../../ipc/client";
import { filterReportForSeed } from "./filterReportForSeed";

const report: DuplicateReport = {
  groups: [
    {
      kind: "exact_hash",
      score: 100,
      members: [
        { id: 1, path: "a", fileName: "same.dwg", sizeBytes: 10 },
        { id: 2, path: "b", fileName: "copy.dwg", sizeBytes: 10 },
      ],
    },
    {
      kind: "same_name",
      score: 100,
      members: [
        { id: 3, path: "c", fileName: "same.dwg", sizeBytes: 20 },
        { id: 4, path: "d", fileName: "same.dwg", sizeBytes: 30 },
      ],
    },
  ],
  totalGroups: 2,
  totalFiles: 4,
  cancelled: false,
};

describe("filterReportForSeed", () => {
  it("yalniz tohum asset kimligini iceren gruplari ve sayaclari korur", () => {
    expect(filterReportForSeed(report, 1)).toEqual({
      groups: [report.groups[0]],
      totalGroups: 1,
      totalFiles: 2,
      cancelled: false,
    });
  });

  it("ayni dosya adi tek basina eslesme sayilmaz", () => {
    expect(filterReportForSeed(report, 99)).toEqual({
      groups: [],
      totalGroups: 0,
      totalFiles: 0,
      cancelled: false,
    });
  });
});
