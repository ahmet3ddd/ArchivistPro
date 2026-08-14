import { describe, expect, it } from "vitest";

import { ancestors } from "./paths";

describe("ancestors", () => {
  it("Windows yolunu birikimli-yol + orijinal ayrac koruyarak boler", () => {
    expect(ancestors("C:\\A\\B")).toEqual([
      { path: "C:", name: "C:" },
      { path: "C:\\A", name: "A" },
      { path: "C:\\A\\B", name: "B" },
    ]);
  });
  it("POSIX yolunu boler (bas ayrac bos segment uretmez)", () => {
    expect(ancestors("/a/b")).toEqual([
      { path: "/a", name: "a" },
      { path: "/a/b", name: "b" },
    ]);
  });
  it("ardisik ayraci (UNC) daraltir — bos segment yok", () => {
    expect(ancestors("\\\\srv\\share")).toEqual([
      { path: "\\\\srv", name: "srv" },
      { path: "\\\\srv\\share", name: "share" },
    ]);
  });
  it("ayracsiz → tek segment", () => {
    expect(ancestors("dosya.dwg")).toEqual([{ path: "dosya.dwg", name: "dosya.dwg" }]);
  });
});
