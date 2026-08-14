import { describe, expect, it } from "vitest";

import type { ScannedRoot } from "../../ipc/client";
import { showsNeverScannedHint } from "./rootBadges";

function root(over: Partial<ScannedRoot> = {}): ScannedRoot {
  return {
    id: 1,
    path: "H:\\PRJ",
    label: "PRJ",
    addedAt: 0,
    lastScan: null,
    status: "active",
    isFavorite: false,
    groupId: null,
    isDeleted: false,
    deletedAt: null,
    fileCount: 0,
    pendingCount: 0,
    tags: [],
    ...over,
  };
}

describe("showsNeverScannedHint", () => {
  it("shows the hint when the root truly has nothing in the archive", () => {
    expect(showsNeverScannedHint(root())).toBe(true);
  });

  it("hides the hint when files are already indexed under the root", () => {
    // Regresyon kilidi: kok kaydi 186eb33'ten (2026-08-05) once taranmis arsivlerde
    // lastScan NULL kalir ama binlerce dosya indekslidir. Ipucu orada "icerigi henuz
    // arsive alinmadi" diyerek dosya sayisi rozetiyle CELISIYORDU.
    expect(showsNeverScannedHint(root({ fileCount: 83301 }))).toBe(false);
  });

  it("hides the hint when a pending badge already states it with a number", () => {
    expect(showsNeverScannedHint(root({ pendingCount: 199 }))).toBe(false);
  });

  it("hides the hint once a scan has been recorded", () => {
    expect(showsNeverScannedHint(root({ lastScan: 1_786_440_182 }))).toBe(false);
  });

  it("hides the hint for roots removed from the list", () => {
    expect(showsNeverScannedHint(root({ status: "removed" }))).toBe(false);
  });
});
