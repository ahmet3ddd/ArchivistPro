import { describe, expect, it } from "vitest";

import { mergeFolderSelections } from "./folderSelection";

describe("mergeFolderSelections", () => {
  it("deduplicates paths and replaces nested selections with their parent", () => {
    expect(
      mergeFolderSelections(
        ["C:\\Archive\\Projects", "D:\\Other"],
        ["c:/archive", "D:/Other/"],
      ),
    ).toEqual(["D:\\Other", "c:/archive"]);
  });

  it("keeps sibling folders whose names only share a prefix", () => {
    expect(mergeFolderSelections([], ["C:\\Project", "C:\\Projects"])).toEqual([
      "C:\\Project",
      "C:\\Projects",
    ]);
  });

  it("ignores empty selections", () => {
    expect(mergeFolderSelections(["C:\\Archive"], [" ", ""])).toEqual(["C:\\Archive"]);
  });
});
