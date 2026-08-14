import { describe, expect, it } from "vitest";

import {
  parseProcessPriority,
  PROCESS_PRIORITY_DEFAULT,
} from "./processPrioritySettings";

describe("processPrioritySettings", () => {
  it("accepts only the two safe process-priority modes", () => {
    expect(parseProcessPriority("normal")).toBe("normal");
    expect(parseProcessPriority("background")).toBe("background");
  });

  it("falls back to normal for missing or unsafe stored values", () => {
    expect(parseProcessPriority(null)).toBe(PROCESS_PRIORITY_DEFAULT);
    expect(parseProcessPriority("high")).toBe(PROCESS_PRIORITY_DEFAULT);
    expect(parseProcessPriority("Background")).toBe(PROCESS_PRIORITY_DEFAULT);
  });
});
