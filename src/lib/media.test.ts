import { describe, expect, it } from "vitest";

import { isVideoExt } from "./media";

describe("isVideoExt", () => {
  it("recognizes every indexed video family case-insensitively", () => {
    for (const ext of ["mp4", "m4v", "mov", "avi", "mkv", "webm", "flv", "wmv", "MP4"]) {
      expect(isVideoExt(ext)).toBe(true);
    }
  });

  it("rejects missing and non-video extensions", () => {
    expect(isVideoExt(undefined)).toBe(false);
    expect(isVideoExt(null)).toBe(false);
    expect(isVideoExt("jpg")).toBe(false);
  });
});
