import type { DuplicateReport } from "../../ipc/client";

/** Tohumlu aramada yalniz secilen asset'i gercekten iceren gruplari korur. */
export function filterReportForSeed(rep: DuplicateReport, seedId: number): DuplicateReport {
  const groups = rep.groups.filter((g) => g.members.some((m) => m.id === seedId));
  return {
    groups,
    totalGroups: groups.length,
    totalFiles: groups.reduce((n, g) => n + g.members.length, 0),
    cancelled: rep.cancelled,
  };
}
